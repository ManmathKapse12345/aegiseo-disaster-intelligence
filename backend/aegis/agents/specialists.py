"""Specialist agents. Each has one responsibility, acts only through tools, and records its
decisions (question, choice, rationale, alternatives) in the shared agent state."""

from __future__ import annotations

import time
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any

import numpy as np

from aegis.agents.narrative import (
    allowed_dates,
    build_alerts,
    evidence_values,
    llm_summary,
    strip_citations,
    template_summary,
    verify_text,
)
from aegis.agents.state import Phase
from aegis.agents.tools import ToolBlockedError, ToolFailedError
from aegis.analysis.bundle import ContextLayers, SceneBundle
from aegis.analysis.hazards import HazardResult
from aegis.analysis.impact import ImpactResult, PopulationEstimate
from aegis.geo.grid import Grid
from aegis.sources.stac import Acquisition

if TYPE_CHECKING:
    from aegis.agents.orchestrator import AgentOrchestrator

MIN_COVERAGE = 0.5
S2_UNUSABLE_VALID = 0.05
MAX_WINDOW_EXTENSIONS = 2


class Specialist:
    name = "agent"

    def __init__(self, orch: AgentOrchestrator):
        self.o = orch
        self.state = orch.state
        self.tools = orch.tools
        self.rec = orch.recorder

    def call(self, tool: str, **kw: Any) -> Any:
        return self.tools.call(self.name, tool, **kw)

    def decide(self, question: str, chosen: str, rationale: str, alternatives: list[str] | None = None, rule: str | None = None) -> None:
        self.state.decide(self.name, question, chosen, rationale, alternatives, rule)
        self.rec.step(Phase.PLAN, self.name, f"Decision: {question}", detail=chosen, rationale=rationale,
                      data={"alternatives": alternatives or [], "rule": rule})


# ============================================================================ acquisition
class DataAcquisitionAgent(Specialist):
    name = "data_acquisition"

    def run(self) -> SceneBundle:
        g = self.state.goal
        if g.mode == "synthetic":
            return self._synthetic()
        settings = self.o.services.settings
        grid = Grid.for_aoi(g.aoi, self.o.cfg.resolution_m, settings.max_grid_pixels)
        aoi_mask = grid.aoi_mask(g.aoi)
        if grid.resolution > self.o.cfg.resolution_m:
            self.decide("analysis resolution", f"{grid.resolution:.0f} m",
                        f"requested {self.o.cfg.resolution_m:.0f} m would exceed the {settings.max_grid_pixels:,}-pixel processing "
                        "budget for this AOI; resolution coarsened to bound memory and runtime", [f"{self.o.cfg.resolution_m:.0f} m"], "P0")
        self.rec.step(Phase.OBSERVE, self.name, "Analysis grid defined",
                      detail=f"{grid.crs}, {grid.resolution:.0f} m, {grid.width}x{grid.height} px", data=grid.to_dict())
        bundle = SceneBundle(grid=grid, aoi_mask=aoi_mask)
        for sensor in ("S1", "S2"):
            post = self._select_post(sensor, grid, aoi_mask)
            pre = self._select_pre(sensor, post, grid, aoi_mask) if post is not None else None
            for role, acq in (("post", post), ("pre", pre)):
                if acq is None:
                    continue
                self.rec.check_cancel()
                try:
                    obs = self.call("load_s1" if sensor == "S1" else "load_s2", acquisition=acq, grid=grid, role=role, aoi_mask=aoi_mask)
                except (ToolFailedError, ToolBlockedError) as exc:
                    self.state.flags.add(f"{sensor.lower()}_{role}_load_failed")
                    self.decide(f"{sensor} {role}-event data unreadable", "continue without it",
                                f"loading failed ({str(exc)[:160]}); the analysis proceeds with the remaining sensors (graceful degradation)",
                                rule="P8")
                    continue
                bundle.observations[(sensor, role)] = obs
                eid = self.state.add_evidence(
                    f"scene:{sensor}:{role}", "scene",
                    f"{'Sentinel-1 RTC' if sensor == 'S1' else 'Sentinel-2 L2A'} {role}-event, {obs.acquired_at:%Y-%m-%d %H:%M} UTC",
                    collection=obs.collection, item_ids=obs.item_ids, acquired_at=obs.acquired_at.isoformat(),
                    stac_items=[f"{settings.stac_url}/collections/{obs.collection}/items/{i}" for i in obs.item_ids])
                self.rec.step(Phase.OBSERVE, self.name, f"Loaded {sensor} {role}-event observation",
                              detail=f"{obs.acquired_at:%Y-%m-%d}, valid {obs.valid_fraction:.0%}"
                                     + (f", cloud {obs.cloud_fraction:.0%}" if obs.cloud_fraction is not None else ""),
                              data={"evidence": eid, **obs.summary()})
        try:
            bundle.context = self.call("load_context_layers", aoi=g.aoi, grid=grid)
            for layer, info in bundle.context.provenance.items():
                if info.get("status") == "ok":
                    self.state.add_evidence(f"context:{layer}", "context", f"{layer} (Planetary Computer)", items=info.get("items"))
                else:
                    self.state.flags.add(f"context_{layer}_unavailable")
        except (ToolFailedError, ToolBlockedError) as exc:
            bundle.context = ContextLayers(provenance={"error": str(exc)[:200]})
            self.state.flags.add("context_unavailable")
            self.decide("context layers unavailable", "continue without DEM / permanent water / land cover",
                        "terrain plausibility, permanent-water exclusion and land-cover exposure will be reduced", rule="P8")
        return bundle

    def _synthetic(self) -> SceneBundle:
        cfg = self.o.cfg.synthetic
        scene = self.call("load_synthetic_scene", config=cfg)
        b = scene.bundle
        for (sensor, role), obs in b.observations.items():
            self.state.add_evidence(f"scene:{sensor}:{role}", "scene", f"SIMULATED {sensor} {role}-event scene (seed {cfg.seed})",
                                    collection=obs.collection, item_ids=obs.item_ids, acquired_at=obs.acquired_at.isoformat())
        self.rec.step(Phase.OBSERVE, self.name, "Loaded simulated multi-sensor scene",
                      detail=scene.label, data={"availability": b.availability(), "grid": b.grid.to_dict()})
        self.state.flags.add("synthetic")
        return b

    # ---------------------------------------------------------------- scene selection
    def _search(self, sensor: str, start: date, end: date) -> list[Acquisition]:
        try:
            acqs = self.call("search_imagery", sensor=sensor, aoi=self.state.goal.aoi, start=start, end=end)
        except (ToolFailedError, ToolBlockedError) as exc:
            self.state.flags.add("catalog_unavailable")
            self.state.warnings.append(f"{sensor} catalogue search failed: {str(exc)[:160]}")
            return []
        return [a for a in acqs if a.aoi_coverage >= MIN_COVERAGE]

    def _select_post(self, sensor: str, grid: Grid, aoi_mask: np.ndarray) -> Acquisition | None:
        g = self.state.goal
        start, end = g.post_window
        today = datetime.now(UTC).date()
        acqs = self._search(sensor, start, end)
        ext = 0
        while not acqs and ext < MAX_WINDOW_EXTENSIONS and end + timedelta(days=7) <= today + timedelta(days=1):
            new_end = end + timedelta(days=7)
            self.decide(f"no {sensor} post-event acquisition in window", f"extend window to {new_end.isoformat()}",
                        f"no {sensor} scene covering >= {MIN_COVERAGE:.0%} of the AOI between {start} and {end}; "
                        "a later acquisition can still show the hazard", rule="P3")
            end, ext = new_end, ext + 1
            acqs = self._search(sensor, start, end)
        if not acqs:
            self.state.flags.add(f"{sensor.lower()}_post_missing")
            self.rec.step(Phase.OBSERVE, self.name, f"No {sensor} post-event acquisition found", status="warn",
                          detail=f"searched {start} to {end}")
            return None
        if sensor == "S1":
            choice = min(acqs, key=lambda a: a.datetime)
            self.decide("Sentinel-1 post-event acquisition", f"{choice.datetime:%Y-%m-%d} (orbit {choice.relative_orbit} {choice.orbit_state})",
                        "earliest post-event SAR pass: closest to the event and unaffected by cloud",
                        [f"{a.datetime:%Y-%m-%d} orbit {a.relative_orbit}" for a in acqs if a is not choice][:5], "P1")
            return choice
        return self._best_optical(acqs, grid, aoi_mask, prefer_late=False, role="post")

    def _select_pre(self, sensor: str, post: Acquisition, grid: Grid, aoi_mask: np.ndarray) -> Acquisition | None:
        g = self.state.goal
        start, end = g.pre_window
        acqs = self._search(sensor, start, end)
        if sensor == "S1":
            same = [a for a in acqs if a.relative_orbit == post.relative_orbit and a.orbit_state == post.orbit_state]
            if not same:
                ext_start = start - timedelta(days=24)
                more = self._search(sensor, ext_start, end)
                same = [a for a in more if a.relative_orbit == post.relative_orbit and a.orbit_state == post.orbit_state]
                if same:
                    self.decide("Sentinel-1 pre-event reference", "extend pre window to find the same relative orbit",
                                f"no orbit-{post.relative_orbit} pass in the requested pre window; repeat-pass geometry is required "
                                "for a reliable log-ratio change", rule="P4")
                acqs = acqs or more
            if same:
                choice = max(same, key=lambda a: a.datetime)
                self.decide("Sentinel-1 pre-event acquisition", f"{choice.datetime:%Y-%m-%d} (orbit {choice.relative_orbit})",
                            "latest pass on the same relative orbit and direction as the post-event image (identical viewing geometry)",
                            [f"{a.datetime:%Y-%m-%d} orbit {a.relative_orbit}" for a in acqs if a is not choice][:5], "P4")
                return choice
            if acqs:
                choice = max(acqs, key=lambda a: a.datetime)
                self.state.flags.add("s1_orbit_mismatch")
                self.decide("Sentinel-1 pre-event acquisition", f"{choice.datetime:%Y-%m-%d} (different orbit {choice.relative_orbit})",
                            "no same-orbit reference available; using the closest pass with reduced confidence in SAR change", rule="P4")
                return choice
            self.state.flags.add("s1_pre_missing")
            return None
        if not acqs:
            self.state.flags.add("s2_pre_missing")
            return None
        return self._best_optical(acqs, grid, aoi_mask, prefer_late=True, role="pre")

    def _best_optical(self, acqs: list[Acquisition], grid: Grid, aoi_mask: np.ndarray, prefer_late: bool, role: str) -> Acquisition | None:
        event = self.state.goal.event_date
        ranked = sorted(acqs, key=lambda a: (a.cloud_cover if a.cloud_cover is not None else 100.0,
                                             -a.datetime.timestamp() if prefer_late else a.datetime.timestamp()))[:3]
        scored = []
        for a in ranked:
            try:
                cc = self.call("assess_cloud_cover", acquisition=a, grid=grid, aoi_mask=aoi_mask)
            except (ToolFailedError, ToolBlockedError):
                continue
            days = abs((a.datetime.date() - event).days)
            scored.append((cc["valid_fraction"] - 0.004 * days, cc, a))
        if not scored:
            self.state.flags.add(f"s2_{role}_unassessed")
            return None
        score, cc, best = max(scored, key=lambda t: t[0])
        alts = [f"{a.datetime:%Y-%m-%d}: AOI valid {c['valid_fraction']:.0%}" for _, c, a in scored if a is not best]
        if cc["valid_fraction"] < S2_UNUSABLE_VALID:
            self.state.flags.add(f"s2_{role}_unusable")
            self.decide(f"Sentinel-2 {role}-event acquisition", "none usable",
                        f"best candidate {best.datetime:%Y-%m-%d} has only {cc['valid_fraction']:.0%} cloud-free AOI pixels; "
                        "optical evidence discarded, SAR leads the analysis", alts, "P2")
            return None
        self.decide(f"Sentinel-2 {role}-event acquisition", f"{best.datetime:%Y-%m-%d} (AOI cloud-free {cc['valid_fraction']:.0%})",
                    "highest share of cloud-free AOI pixels measured from the scene classification layer "
                    "(tile-level cloud cover is not representative of a small AOI), with a small penalty per day from the event",
                    alts, "P2")
        return best


# ============================================================================ perception
class PerceptionAgent(Specialist):
    name = "perception"

    def run(self, bundle: SceneBundle, exclude: tuple[str, ...] = ()) -> HazardResult:
        g = self.state.goal
        hotspots = None
        if g.hazard == "wildfire":
            try:
                hotspots, info = self.call("query_active_fires", bbox=g.aoi.bbox, start=g.event_date - timedelta(days=3),
                                           end=g.post_window[1])
                self.state.add_evidence("fires:firms", "context", f"Active-fire detections ({info.get('mode')})", count=len(hotspots))
            except (ToolFailedError, ToolBlockedError) as exc:
                self.state.flags.add("firms_unavailable")
                self.state.warnings.append(f"Active-fire corroboration unavailable: {str(exc)[:200]}")
        t0 = time.perf_counter()
        result = self.call("detect_change", hazard=g.hazard, bundle=bundle, params=self.o.cfg.detection, hotspots=hotspots,
                           exclude=exclude)
        self.state.add_evidence("model", "model", f"{result.method} ({result.model_info.get('version')})", **{
            k: result.model_info.get(k) for k in ("variant", "version", "temperature", "mc_samples", "val_iou") if k in result.model_info})
        self.rec.step(Phase.PERCEIVE, self.name, f"Change detection: {result.stats.get('affected_area_km2', 0):.2f} km2 affected",
                      detail=" ".join(result.methodology), data={"quality": result.quality, "stats": result.stats,
                                                                  "excluded_sensors": list(exclude)},
                      duration_ms=(time.perf_counter() - t0) * 1000)
        return result


# ============================================================================ impact
class ImpactAgent(Specialist):
    name = "impact_assessment"

    def run(self, result: HazardResult, bundle: SceneBundle) -> tuple[ImpactResult, dict[str, Any]]:
        g = self.state.goal
        context: dict[str, Any] = {}
        infra = None
        try:
            infra, info = self.call("query_infrastructure", bbox=g.aoi.bbox)
            self.state.add_evidence("infrastructure", "infrastructure", f"Infrastructure: {info.get('source') or 'OpenStreetMap (Overpass)'}",
                                    endpoint=info.get("endpoint"), osm_base=info.get("osm_base"), features=len(infra),
                                    license=info.get("license"))
        except (ToolFailedError, ToolBlockedError) as exc:
            self.state.flags.add("infrastructure_unavailable")
            self.decide("infrastructure source unavailable", "continue with population and land-cover exposure",
                        f"OpenStreetMap could not be queried ({str(exc)[:160]}); facility and road factors are marked missing "
                        "and confidence is reduced instead of inventing values", rule="P8")
        pop: PopulationEstimate | None
        try:
            pop = self.call("query_population", aoi=g.aoi, grid=bundle.grid, aoi_mask=bundle.aoi_mask,
                            landcover=bundle.context.landcover)
            if pop.available:
                self.state.add_evidence("population", "population", pop.source, method=pop.method, note=pop.note)
            else:
                self.state.flags.add("population_unavailable")
                self.decide("population source unavailable", "use built-up area as exposure proxy",
                            f"no gridded population ({pop.note[:160]}); ESA WorldCover built-up area is used and labelled as a proxy",
                            rule="P9")
        except (ToolFailedError, ToolBlockedError) as exc:
            pop = PopulationEstimate(available=False, source="none", note=str(exc)[:200])
            self.state.flags.add("population_unavailable")
            self.decide("population source failed", "use built-up area as exposure proxy",
                        f"population query failed ({str(exc)[:160]})", rule="P9")
        if g.mode == "real" and g.hazard in ("flood", "landslide"):
            try:
                lon, lat = g.aoi.centroid
                rain, info = self.call("query_rainfall", lon=lon, lat=lat, start=g.event_date - timedelta(days=14), end=g.post_window[1])
                context["rainfall"] = {**rain, "note": info.get("note")}
                self.state.add_evidence("rainfall", "context", "ERA5 reanalysis precipitation (Open-Meteo)", note=info.get("note"))
            except (ToolFailedError, ToolBlockedError) as exc:
                context["rainfall"] = {"unavailable": str(exc)[:200]}
        if g.mode == "real":
            try:
                events, _ = self.call("query_hazard_alerts", aoi=g.aoi)
                context["gdacs_nearby"] = events[:10]
            except (ToolFailedError, ToolBlockedError) as exc:
                context["gdacs_nearby"] = {"unavailable": str(exc)[:200]}
        impact = self.call("compute_impact", result=result, bundle=bundle, infrastructure=infra, population=pop)
        self.rec.step(Phase.ACT, self.name, "Exposure assessed", detail=(
            f"population exposed: {impact.population.get('potentially_exposed', 'n/a')}, facilities inside: "
            f"{sum(v['inside'] for v in impact.facility_counts.values())}, roads affected: {impact.roads.get('affected_km', 'n/a')} km"),
            data={"impact": impact.summary(), "context": context})
        return impact, context


# ============================================================================ prioritisation
class PrioritizationAgent(Specialist):
    name = "prioritization"

    def run(self, result: HazardResult, impact: ImpactResult, bundle: SceneBundle) -> dict[str, Any]:
        pri = self.call("prioritize_cells", result=result, impact=impact, bundle=bundle, weights=self.o.cfg.weights)
        for c in pri["cells"][:50]:
            self.state.add_evidence(f"cell:{c['cell_id']}", "priority_cell", f"Response cell {c['cell_id']} ({c['category']}, score {c['score']})")
        self.rec.step(Phase.ACT, self.name, f"Prioritised {len(pri['cells'])} response cells", detail=str(pri["distribution"]),
                      data={"weights": pri["weights"], "sensitivity": pri["sensitivity"], "cell_km": pri["cell_km"],
                            "exposure_basis": pri["exposure_basis"]})
        return pri


# ============================================================================ reporting
class ReportingAgent(Specialist):
    name = "reporting"

    def run(self, result: HazardResult, priorities: dict[str, Any]) -> dict[str, Any]:
        g = self.state.goal
        settings = self.o.services.settings
        terms = [g.hazard, "limitations confidence"]
        flags = self.state.flags
        if "s1_orbit_mismatch" in flags:
            terms.append("orbit consistency")
        if any(f.startswith("s2_post_unusable") for f in flags) or (result.quality.get("s2_post_cloud_fraction") or 0) > 0.4:
            terms.append("clouds optical")
        if g.hazard == "flood":
            terms.append("urban double-bounce built-up")
        if self.state.escalations:
            terms.append("escalate analyst review")
        passages = []
        try:
            passages = self.call("retrieve_guidance", query=" ".join(terms), tags=[g.hazard], k=4)
            for p in passages:
                self.state.add_evidence(f"kb:{p['ref']}", "guidance", f"{p['doc_title']} - {p['section']}")
        except (ToolFailedError, ToolBlockedError):
            self.state.warnings.append("guidance retrieval failed")
        self.rec.step(Phase.MEMORY, self.name, f"Retrieved {len(passages)} guidance passages (RAG)",
                      data={"refs": [p["ref"] for p in passages]})

        summary = template_summary(self.state, priorities)
        allowed = evidence_values(self.state, priorities)
        dates = allowed_dates(self.state)
        llm_text, llm_info = llm_summary(self.state, passages, settings)
        summary_source = "template"
        if llm_text:
            ok, checks = verify_text(llm_text, allowed, set(self.state.facts), dates)
            for c in checks:
                self.rec.guardrail(c.code, c.name, c.stage, c.outcome, f"LLM summary: {c.message}", c.value, c.threshold)
            if ok:
                summary, summary_source = strip_citations(llm_text), f"llm:{llm_info.get('model')}"
                self.decide("executive summary source", "LLM draft accepted", "all numbers and citations verified against the fact sheet")
            else:
                self.decide("executive summary source", "deterministic template",
                            "LLM draft failed grounding or language checks and was discarded")
        else:
            self.rec.step(Phase.ACT, self.name, "Executive summary from deterministic template", detail=llm_info.get("reason") or llm_info.get("status"))

        alerts = build_alerts(self.state, priorities)
        created = []
        for a in alerts:
            extra = a.pop("_allowed_extra", [])
            ok, checks = verify_text(a["body"], allowed + extra, set(self.state.facts), dates)
            for c in checks:
                self.rec.guardrail(c.code, c.name, c.stage, c.outcome, f"Alert '{a['title'][:60]}': {c.message}", c.value, c.threshold)
            grounding = {"verified": ok, "checks": [c.__dict__ for c in checks]}
            if not ok:
                a["body"] = (f"{a['severity']} priority finding in {g.hazard} analysis; see the attached evidence. "
                             "Automatically generated text failed verification and was withheld.")
                grounding["regenerated"] = True
            alert_id = self.call("draft_alert", alert={**a, "grounding": grounding})
            created.append(alert_id)
        self.rec.step(Phase.ACT, self.name, f"Drafted {len(created)} evidence-grounded alerts (pending human review)")
        return {"summary": summary, "summary_source": summary_source, "llm": llm_info, "alerts": created,
                "guidance": passages}
