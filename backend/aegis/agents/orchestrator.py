"""Closed-loop agent orchestrator.

    Observe -> Perceive -> Semantic state -> Memory/RAG -> Reason/Plan -> Act (tools)
            -> Guardrails/HITL -> Outcome -> Feedback

The orchestrator owns the goal, the explicit plan and the shared state; specialist agents
do the work through the tool executor. Guardrails run between phases and either block,
warn or escalate to a human analyst. The agent never publishes anything: alerts are
drafted for human approval (autonomy level "advisory").
"""

from __future__ import annotations

import logging
import time
import traceback
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import numpy as np
from rasterio.features import shapes
from scipy import ndimage
from shapely.geometry import shape

from aegis.agents import guardrails as G
from aegis.agents.memory import analyst_corrections
from aegis.agents.recorder import CancelledError, TraceRecorder
from aegis.agents.specialists import (
    DataAcquisitionAgent,
    ImpactAgent,
    PerceptionAgent,
    PrioritizationAgent,
    ReportingAgent,
)
from aegis.agents.state import AgentState, Goal, Phase, PlanStep
from aegis.agents.toolbox import Services, SyntheticBinding, build_tools
from aegis.agents.tools import SideEffect, Tool, ToolBlockedError, ToolExecutor, ToolFailedError
from aegis.analysis.bundle import SceneBundle
from aegis.analysis.hazards import DetectionParams, HazardResult, InsufficientDataError
from aegis.analysis.impact import ImpactResult
from aegis.analysis.prioritize import PriorityWeights
from aegis.db import (
    Alert,
    Analysis,
    Detection,
    ExposedFeature,
    Observation,
    PriorityCell,
    Report,
    ReviewTask,
    session_scope,
    utcnow,
)
from aegis.geo.aoi import AOI
from aegis.geo.vector import round_coords, to_wgs84
from aegis.observability import ANALYSES, ANALYSIS_DURATION, JOBS_RUNNING
from aegis.reports.documents import write_reports
from aegis.reports.layers import export_rasters, render_layers
from aegis.synthetic import SyntheticConfig

log = logging.getLogger(__name__)

MAX_POLYGONS = 1500


class InputRejectedError(RuntimeError):
    pass


@dataclass
class RunConfig:
    analysis_id: str
    name: str
    hazard: str
    aoi: AOI
    event_date: date
    pre_window: tuple[date, date]
    post_window: tuple[date, date]
    mode: str = "real"
    resolution_m: float = 20.0
    weights: PriorityWeights = field(default_factory=PriorityWeights)
    detection: DetectionParams = field(default_factory=DetectionParams)
    synthetic: SyntheticConfig | None = None
    fail_tools: set[str] = field(default_factory=set)
    persist: bool = True


@dataclass
class RunOutcome:
    status: str
    summary: dict[str, Any]
    error: str | None = None
    duration_s: float = 0.0


class AgentOrchestrator:
    name = "orchestrator"

    def __init__(self, cfg: RunConfig, services: Services):
        self.cfg = cfg
        self.services = services
        self.recorder = TraceRecorder(cfg.analysis_id, persist=cfg.persist)
        self.synthetic = SyntheticBinding(config=cfg.synthetic or SyntheticConfig(hazard=cfg.hazard)) if cfg.mode == "synthetic" else None
        if self.synthetic is not None:
            self.cfg.synthetic = self.synthetic.config
        self.tools = ToolExecutor(build_tools(services, cfg.fail_tools, self.synthetic) + self._draft_tools(), self.recorder)
        objective = {
            "flood": "Detect and localise new flooding, estimate exposure, prioritise response cells and draft evidence-grounded alerts",
            "wildfire": "Map burn scars and severity, estimate exposure, prioritise response cells and draft evidence-grounded alerts",
            "landslide": "Identify landslide candidates, estimate exposure, prioritise verification and draft evidence-grounded alerts",
        }.get(cfg.hazard, "Assess hazard change")
        self.state = AgentState(cfg.analysis_id, Goal(objective, cfg.hazard, cfg.aoi, cfg.event_date, cfg.pre_window, cfg.post_window, cfg.mode))
        self.phase_ms: dict[str, float] = {}
        self.artifacts = services.settings.artifacts_dir / cfg.analysis_id
        # kept for evaluation / introspection (benchmarks compare against synthetic ground truth)
        self.result: HazardResult | None = None
        self.bundle: SceneBundle | None = None

    # ------------------------------------------------------------------ write-draft tools (internal, human-gated)
    def _draft_tools(self) -> list[Tool]:
        aid = self.cfg.analysis_id
        synthetic = self.cfg.mode == "synthetic"

        def draft_alert(alert: dict[str, Any]) -> str:
            if not self.cfg.persist:
                return "not-persisted"
            with session_scope() as s:
                row = Alert(analysis_id=aid, cell_id=alert.get("cell_id"), severity=alert["severity"], title=alert["title"][:300],
                            body=alert["body"], evidence=alert.get("evidence", []), grounding=alert.get("grounding"),
                            confidence=alert.get("confidence"), status="pending_review", requires_approval=True, synthetic=synthetic)
                s.add(row)
                s.flush()
                return row.id

        def escalate_to_analyst(kind: str, severity: str, title: str, reason: str, payload: dict | None = None,
                                alert_id: str | None = None) -> str:
            if not self.cfg.persist:
                return "not-persisted"
            with session_scope() as s:
                row = ReviewTask(analysis_id=aid, alert_id=alert_id, kind=kind, severity=severity, title=title[:300], reason=reason,
                                 payload=payload)
                s.add(row)
                s.flush()
                return row.id

        def render_map_layers(bundle: SceneBundle, result: HazardResult) -> list[dict]:
            layers = render_layers(bundle, result, self.artifacts / "layers")
            export_rasters(bundle, result, self.artifacts / "exports")
            return layers

        def generate_reports() -> list[dict]:
            if not self.cfg.persist:
                return []
            with session_scope() as s:
                files = write_reports(s, aid, self.artifacts / "reports")
                for f in files:
                    if "error" not in f:
                        s.add(Report(analysis_id=aid, kind=f["kind"], filename=f["filename"], sha256=f["sha256"], size_bytes=f["size_bytes"]))
            return files

        return [
            Tool("draft_alert", "Create an alert draft that requires human approval before publication", SideEffect.WRITE_DRAFT,
                 draft_alert, lambda v: {"alert_id": v}),
            Tool("escalate_to_analyst", "Open a human-review task (HITL) explaining why the agent is uncertain", SideEffect.WRITE_DRAFT,
                 escalate_to_analyst, lambda v: {"review_task_id": v}),
            Tool("render_map_layers", "Render map overlays and export GeoTIFF products", SideEffect.WRITE_DRAFT, render_map_layers,
                 lambda v: {"layers": [x["id"] for x in v]}),
            Tool("generate_reports", "Generate PDF, CSV and GeoJSON reports from stored results", SideEffect.WRITE_DRAFT,
                 generate_reports, lambda v: v),
        ]

    # ------------------------------------------------------------------ helpers
    def _phase(self, name: str, t0: float) -> None:
        self.phase_ms[name] = self.phase_ms.get(name, 0.0) + (time.perf_counter() - t0) * 1000

    def _guard(self, results: list[G.GuardrailResult]) -> list[G.GuardrailResult]:
        for r in results:
            self.recorder.guardrail(r.code, r.name, r.stage, r.outcome, r.message, r.value, r.threshold)
            if r.outcome == "warn":
                self.state.warnings.append(f"{r.code} {r.name}: {r.message}")
            elif r.outcome == "escalate":
                self.state.escalations.append({"code": r.code, "name": r.name, "message": r.message, "stage": r.stage})
        return results

    def _plan(self) -> None:
        h = self.cfg.hazard
        method = {"flood": "gated-fusion water model (post-classification comparison)", "wildfire": "dNBR burn-severity index",
                  "landslide": "multi-indicator landslide candidate model"}[h]
        steps = [
            ("validate", self.name, "check_inputs", "Validate AOI, hazard and observation windows (G01-G03)"),
            ("recall", self.name, "recall_similar_cases", "Retrieve earlier analyses and analyst feedback for this area (episodic memory)"),
            ("acquire", "data_acquisition", "search_imagery, assess_cloud_cover, load_s1/s2, load_context_layers",
             "Find, select and load pre/post Sentinel-1 and Sentinel-2 and context layers" if self.cfg.mode == "real"
             else "Generate the simulated multi-sensor scene"),
            ("data_qc", self.name, "guardrails", "Check data sufficiency, cloud cover, orbit consistency and baselines (G04-G09)"),
            ("perceive", "perception", "detect_change", f"Map {h} change with the {method}"),
            ("perception_qc", self.name, "guardrails", "Check model availability, distribution shift, plausibility, confidence (G10-G15)"),
            ("impact", "impact_assessment", "query_infrastructure, query_population, compute_impact",
             "Estimate potentially exposed people, facilities, roads and land"),
            ("prioritize", "prioritization", "prioritize_cells", "Rank response cells with explanations and weight sensitivity"),
            ("report", "reporting", "retrieve_guidance, draft_alert, escalate_to_analyst",
             "Grounded summary and alerts for human approval; route issues to analysts"),
            ("deliver", self.name, "render_map_layers, generate_reports", "Render map layers and PDF/CSV/GeoJSON reports"),
        ]
        self.state.plan = [PlanStep(*s) for s in steps]
        self.recorder.step(Phase.PLAN, self.name, "Plan formulated", detail=self.state.goal.objective,
                           data={"goal": self.state.goal.describe(), "plan": [asdict(s) for s in self.state.plan],
                                 "tools": self.tools.describe()})

    # ------------------------------------------------------------------ main loop
    def run(self) -> RunOutcome:
        t_start = time.perf_counter()
        JOBS_RUNNING.inc()
        status, error = "failed", None
        result: HazardResult | None = None
        impact: ImpactResult | None = None
        priorities: dict[str, Any] | None = None
        context: dict[str, Any] = {}
        narrative: dict[str, Any] = {}
        layers: list[dict] = []
        bundle: SceneBundle | None = None
        try:
            self._mark_running()
            # ---------------- OBSERVE (inputs) + PLAN
            t0 = time.perf_counter()
            self._plan()
            checks = self._guard(G.check_inputs(self.cfg.hazard, self.cfg.aoi.area_km2, self.services.settings.min_aoi_km2,
                                                self.services.settings.max_aoi_km2, self.cfg.event_date,
                                                self.cfg.pre_window, self.cfg.post_window))
            blocked = [c for c in checks if c.outcome == "block"]
            if blocked:
                self.state.set_step("validate", "failed", "; ".join(c.message for c in blocked))
                raise InputRejectedError("; ".join(c.message for c in blocked))
            self.state.set_step("validate", "done")
            self._phase("observe", t0)

            # ---------------- MEMORY (episodic)
            t0 = time.perf_counter()
            try:
                cases = self.tools.call(self.name, "recall_similar_cases", bbox=self.cfg.aoi.bbox, hazard=self.cfg.hazard,
                                        exclude_id=self.cfg.analysis_id)
            except (ToolFailedError, ToolBlockedError):
                cases = []
            self.state.memory["similar_cases"] = cases
            notes = analyst_corrections(cases)
            if notes:
                self.state.flags.add("prior_analyst_corrections")
                self.state.warnings.append(f"{len(notes)} analyst correction(s) recorded for earlier analyses of this area; "
                                           "see memory for details")
            self.recorder.step(Phase.MEMORY, self.name, f"Recalled {len(cases)} earlier analyses of this area",
                               data={"cases": cases[:3], "analyst_corrections": notes[:5]})
            self.state.set_step("recall", "done")
            self._phase("memory", t0)

            # ---------------- OBSERVE (data)
            t0 = time.perf_counter()
            self.recorder.progress("acquiring data", 0.1, "Searching and loading satellite observations")
            self.state.set_step("acquire", "running")
            bundle = DataAcquisitionAgent(self).run()
            self.state.set_step("acquire", "done")
            self._phase("acquire", t0)
            self._data_guardrails(bundle)
            self.state.set_step("data_qc", "done")

            # ---------------- PERCEIVE
            t0 = time.perf_counter()
            self.recorder.progress("detecting change", 0.45, "Running multi-sensor change detection")
            self.state.set_step("perceive", "running")
            perception = PerceptionAgent(self)
            result = perception.run(bundle)
            result = self._adaptive_replan(result, bundle, perception)
            self.state.set_step("perceive", "done")
            self._phase("perceive", t0)
            self._semantic_state_perception(result, bundle)
            self._guard(G.check_perception(result))
            self.state.set_step("perception_qc", "done")

            # ---------------- ACT: impact + prioritisation
            t0 = time.perf_counter()
            self.recorder.progress("assessing impact", 0.65, "Estimating exposure of people and infrastructure")
            impact, context = ImpactAgent(self).run(result, bundle)
            self.state.set_step("impact", "done")
            priorities = PrioritizationAgent(self).run(result, impact, bundle)
            self.state.set_step("prioritize", "done")
            self._semantic_state_impact(result, impact, priorities)
            self._phase("act", t0)

            # ---------------- persist core results before reporting (reports read the DB)
            self._persist_core(bundle, result, impact, priorities)

            # ---------------- REPORT + HITL
            t0 = time.perf_counter()
            self.recorder.progress("reporting", 0.85, "Drafting grounded alerts and reports")
            narrative = ReportingAgent(self).run(result, priorities)
            self._escalate(priorities, narrative)
            self.state.set_step("report", "done")
            layers = self.tools.call(self.name, "render_map_layers", bundle=bundle, result=result)
            self._phase("report", t0)

            status = "needs_review" if self.state.escalations else ("completed_with_warnings" if self.state.warnings else "completed")
        except InputRejectedError as exc:
            status, error = "rejected", str(exc)
        except InsufficientDataError as exc:
            status, error = "insufficient_data", str(exc)
            self.recorder.step(Phase.OUTCOME, self.name, "Insufficient data for a reliable analysis", detail=str(exc), status="warn")
        except CancelledError:
            status, error = "cancelled", "cancelled by user"
        except ToolBlockedError as exc:
            status, error = "failed", f"blocked action: {exc}"
        except Exception as exc:  # unexpected failure: record and fail gracefully
            status, error = "failed", f"{type(exc).__name__}: {exc}"
            log.error("analysis failed", extra={"analysis_id": self.cfg.analysis_id, "trace": traceback.format_exc()[-3000:]})
        finally:
            JOBS_RUNNING.dec()
        duration = time.perf_counter() - t_start
        self.result, self.bundle = result, bundle
        summary = self._outcome(status, error, result, impact, priorities, narrative, layers, context, bundle, duration)
        ANALYSES.labels(status).inc()
        ANALYSIS_DURATION.observe(duration)
        return RunOutcome(status=status, summary=summary, error=error, duration_s=duration)

    # ------------------------------------------------------------------ phases
    def _mark_running(self) -> None:
        if not self.cfg.persist:
            return
        with session_scope() as s:
            a = s.get(Analysis, self.cfg.analysis_id)
            if a is not None:
                a.status, a.started_at, a.progress, a.stage = "running", utcnow(), 0.02, "planning"

    def _data_guardrails(self, bundle: SceneBundle) -> None:
        av = bundle.availability()
        s2p, s1p = bundle.get("S2", "post"), bundle.get("S1", "post")
        s1q = bundle.get("S1", "pre")
        orbit_ok = None
        if s1p is not None and s1q is not None:
            orbit_ok = s1p.meta.get("relative_orbit") == s1q.meta.get("relative_orbit")
            if not orbit_ok:
                self.state.flags.add("s1_orbit_mismatch")

        def gap(sensor: str) -> float | None:
            a, b = bundle.get(sensor, "pre"), bundle.get(sensor, "post")
            return None if a is None or b is None else round(abs((b.acquired_at - a.acquired_at).days), 1)

        latest = max((o.acquired_at for (s, r), o in bundle.observations.items() if r == "post"), default=None)
        now = datetime.now(UTC)
        recent = (now.date() - self.cfg.event_date).days <= 30 and self.cfg.mode == "real"
        results = self._guard(G.check_data(
            av, None if s2p is None else s2p.cloud_fraction, s2p is not None and s2p.valid_fraction > 0.02, orbit_ok,
            {"S1": gap("S1"), "S2": gap("S2")}, None if latest is None else (now - latest).total_seconds() / 86400, recent))
        if any(r.outcome == "block" for r in results):
            raise InsufficientDataError("no usable post-event observation could be acquired for the AOI and windows "
                                        "(try a later post-event window or a different area)")

    def _adaptive_replan(self, result: HazardResult, bundle: SceneBundle, perception: PerceptionAgent) -> HazardResult:
        """Reason -> act -> evaluate loop: if cloudy optical data disagree with SAR, try a SAR-led run."""
        q = result.quality
        cloud = q.get("s2_post_cloud_fraction") or 0.0
        agree = q.get("cross_method_agreement")
        if (self.cfg.hazard == "flood" and bundle.has("S1", "post") and "S2" in (q.get("sensors_post") or [])
                and cloud > 0.4 and agree is not None and agree < G.AGREEMENT_ESCALATE):
            self.state.decide(self.name, "re-run perception without cloudy optical data?", "yes - SAR-led run",
                              f"post-event optical cloud cover {cloud:.0%} and cross-method agreement {agree:.0%}; residual cloud "
                              "and shadow may be corrupting the optical branch", ["keep fused result"], "P5")
            self.recorder.step(Phase.PLAN, self.name, "Replanning: SAR-led perception", rationale="low agreement under heavy cloud")
            alt = perception.run(bundle, exclude=("S2_post", "S2_pre"))
            a2 = alt.quality.get("cross_method_agreement")
            if a2 is not None and a2 > agree + 0.05:
                self.state.decide(self.name, "which perception result to keep", "SAR-led result",
                                  f"agreement improved from {agree:.0%} to {a2:.0%}", ["fused result"], "P5")
                alt.methodology.insert(0, "Adaptive replanning: cloudy Sentinel-2 excluded after low cross-method agreement.")
                return alt
            self.state.decide(self.name, "which perception result to keep", "fused result",
                              f"SAR-led agreement {a2 if a2 is None else f'{a2:.0%}'} did not improve on {agree:.0%}", ["SAR-led"], "P5")
        return result

    def _semantic_state_perception(self, result: HazardResult, bundle: SceneBundle) -> None:
        st, q = self.state, result.quality
        post = [o for (s, r), o in bundle.observations.items() if r == "post"]
        pre = [o for (s, r), o in bundle.observations.items() if r == "pre"]
        st.add_fact("aoi_area_km2", round(result.stats["aoi_area_km2"], 2), "km2", "goal", "Area of interest")
        st.add_fact("affected_area_km2", round(result.stats["affected_area_km2"], 2), "km2", "model", f"Detected {result.hazard} extent")
        if post:
            st.add_fact("post_observation_date", min(o.acquired_at for o in post).date().isoformat(), None,
                        "scene:" + ("S1:post" if bundle.has("S1", "post") else "S2:post"), "Earliest post-event observation used")
        if pre:
            st.add_fact("pre_observation_date", max(o.acquired_at for o in pre).date().isoformat(), None, "scene", "Pre-event reference")
        st.add_fact("sensors_post", ", ".join(q.get("sensors_post") or []), None, "scene", "Post-event sensors used")
        if q.get("s2_post_cloud_fraction") is not None:
            st.add_fact("optical_cloud_fraction", round(q["s2_post_cloud_fraction"], 3), "fraction", "scene:S2:post", "Post-event cloud cover over AOI")
        for k in ("cross_method_agreement", "mean_uncertainty_detected", "mean_probability_detected", "affected_fraction_of_aoi"):
            if q.get(k) is not None:
                st.add_fact(k if k != "mean_uncertainty_detected" else "mean_uncertainty", round(q[k], 3), "fraction", "model", k.replace("_", " "))
        st.add_fact("model_version", result.model_info.get("version"), None, "model", "Perception model version")
        self.recorder.step(Phase.STATE, self.name, "Semantic state updated (perception)", data={k: asdict(v) for k, v in st.facts.items()})

    def _semantic_state_impact(self, result: HazardResult, impact: ImpactResult, pri: dict[str, Any]) -> None:
        st = self.state
        pop = impact.population
        if pop.get("available") and pop.get("potentially_exposed") is not None:
            st.add_fact("population_exposed", pop["potentially_exposed"], "people", "population", "Residents inside the detected extent (estimate)")
            st.add_fact("population_source", pop.get("source"), None, "population", "Population dataset")
        infra_ok = impact.roads.get("available", False)
        st.add_fact("infrastructure_available", infra_ok, None, "infrastructure", "Infrastructure data available")
        st.add_fact("near_distance_m", 500, "m", "method", "Distance within which a facility counts as 'near' the extent")
        if infra_ok:
            st.add_fact("facilities_inside", sum(v["inside"] for v in impact.facility_counts.values()), "count", "infrastructure",
                        "Critical facilities inside the extent")
            st.add_fact("facilities_near", sum(v["near"] for v in impact.facility_counts.values()), "count", "infrastructure",
                        "Critical facilities within 500 m")
            st.add_fact("road_km_affected", round(impact.roads.get("affected_km", 0.0), 2), "km", "infrastructure", "Mapped roads crossing the extent")
        if impact.built_up_affected_km2 is not None:
            st.add_fact("built_up_affected_km2", round(impact.built_up_affected_km2, 3), "km2", "context:esa-worldcover", "Built-up land affected")
        if impact.landcover_affected_ha and "Cropland" in impact.landcover_affected_ha:
            st.add_fact("cropland_affected_ha", round(impact.landcover_affected_ha["Cropland"], 1), "ha", "context:esa-worldcover", "Cropland affected")
        d = pri["distribution"]
        st.add_fact("cells_total", len(pri["cells"]), "count", "prioritization", "Prioritised response cells")
        st.add_fact("cells_critical", d.get("Critical", 0), "count", "prioritization", "Critical cells")
        st.add_fact("cells_high", d.get("High", 0), "count", "prioritization", "High cells")
        st.add_fact("overall_confidence", self._overall_confidence(result, impact), None, "model", "Overall analysis confidence")
        self.recorder.step(Phase.STATE, self.name, "Semantic state updated (impact and priorities)",
                           data={k: asdict(v) for k, v in st.facts.items()})

    def _overall_confidence(self, result: HazardResult, impact: ImpactResult) -> str:
        q = result.quality
        unc = q.get("mean_uncertainty_detected")
        unc = 0.1 if unc is None else unc
        agree = q.get("cross_method_agreement")
        agree = 0.6 if agree is None else agree
        complete = np.mean([bool(impact.population.get("available")), bool(impact.roads.get("available")),
                            bool(q.get("sensors_pre"))])
        score = 0.45 * (1 - min(1.0, unc / 0.2)) + 0.35 * agree + 0.2 * complete
        level = "High" if score >= 0.75 else ("Medium" if score >= 0.55 else "Low")
        capped = q.get("model_method") == "classical_fallback" or result.hazard == "landslide" or any(
            e["stage"] == "perception" for e in self.state.escalations)
        if capped and level == "High":
            level = "Medium"
        return level

    def _escalate(self, priorities: dict[str, Any], narrative: dict[str, Any]) -> None:
        for e in self.state.escalations:
            self.tools.call(self.name, "escalate_to_analyst", kind="quality_check", severity="High" if e["stage"] == "perception" else "Moderate",
                            title=f"{e['code']} {e['name']}", reason=e["message"], payload=e)
        for c in priorities["cells"]:
            if c["needs_verification"]:
                self.state.escalations.append({"code": "HITL", "name": "Verify uncertain high-priority cell",
                                               "message": f"{c['cell_id']} is {c['category']} with low confidence", "stage": "priority"})
                self.tools.call(self.name, "escalate_to_analyst", kind="verify_detection", severity=c["category"],
                                title=f"Verify {c['category'].lower()}-priority cell {c['cell_id']} before acting",
                                reason=c["explanation"], payload={"cell_id": c["cell_id"], "centroid": c["centroid"]})
        self.recorder.step(Phase.GUARDRAIL, self.name, f"{len(self.state.escalations)} item(s) routed to human review",
                           data={"escalations": self.state.escalations})

    # ------------------------------------------------------------------ persistence
    def _detections(self, result: HazardResult, bundle: SceneBundle) -> list[dict[str, Any]]:
        mask = result.affected & bundle.aoi_mask
        if not mask.any():
            return []
        labels, n = ndimage.label(mask, structure=np.ones((3, 3), bool))
        idx = np.arange(1, n + 1)
        area = ndimage.sum(np.ones_like(labels, float), labels, idx) * bundle.grid.pixel_area_km2
        conf = ndimage.mean(np.nan_to_num(result.confidence), labels, idx)
        unc = ndimage.mean(np.nan_to_num(result.uncertainty), labels, idx)
        corr = result.corroboration
        agree = None
        if corr is not None:
            fin = np.isfinite(corr)
            s = ndimage.sum(np.where(fin, corr, 0), labels, idx)
            c = ndimage.sum(fin.astype(float), labels, idx)
            agree = np.where(c > 0, s / np.maximum(c, 1), np.nan)
        keep = set((np.argsort(-area)[:MAX_POLYGONS] + 1).tolist())
        out = []
        tol = bundle.grid.resolution * 0.75
        for geom, val in shapes(labels.astype(np.int32), mask=mask, transform=bundle.grid.transform, connectivity=8):
            lab = int(val)
            if lab not in keep:
                continue
            poly = shape(geom).simplify(tol, preserve_topology=True)
            if poly.is_empty:
                continue
            gj = round_coords(to_wgs84(poly, bundle.grid).__geo_interface__)
            props: dict[str, Any] = {"component": lab}
            if result.severity is not None:
                sev = result.severity[labels == lab]
                props["severity_px"] = {result.severity_labels.get(int(k), str(k)): int(v) for k, v in zip(*np.unique(sev, return_counts=True), strict=True) if k > 0}
            out.append({"geometry": gj, "area_km2": float(area[lab - 1]), "mean_confidence": float(conf[lab - 1]),
                        "mean_uncertainty": float(unc[lab - 1]),
                        "agreement": None if agree is None or not np.isfinite(agree[lab - 1]) else float(agree[lab - 1]), "props": props})
        return out

    def _persist_core(self, bundle: SceneBundle, result: HazardResult, impact: ImpactResult, pri: dict[str, Any]) -> None:
        if not self.cfg.persist:
            return
        aid = self.cfg.analysis_id
        dets = self._detections(result, bundle)
        with session_scope() as s:
            for (sensor, role), o in bundle.observations.items():
                s.add(Observation(analysis_id=aid, sensor=sensor, role=role, acquired_at=o.acquired_at, collection=o.collection,
                                  item_ids=o.item_ids, cloud_fraction=o.cloud_fraction, valid_fraction=o.valid_fraction,
                                  meta={k: v for k, v in o.meta.items() if k != "aoi_mask"}, synthetic=o.synthetic))
            for d in dets:
                xs = [c[0] for c in _coords(d["geometry"])]
                ys = [c[1] for c in _coords(d["geometry"])]
                s.add(Detection(analysis_id=aid, hazard=result.hazard, geometry=d["geometry"], min_lon=min(xs), min_lat=min(ys),
                                max_lon=max(xs), max_lat=max(ys), area_km2=round(d["area_km2"], 5),
                                mean_confidence=d["mean_confidence"], mean_uncertainty=d["mean_uncertainty"],
                                agreement=d["agreement"], props=d["props"]))
            for c in pri["cells"]:
                data = {k: v for k, v in c.items() if k not in ("geometry",)}
                s.add(PriorityCell(analysis_id=aid, cell_id=c["cell_id"], rank=c["rank"], score=c["score"], category=c["category"],
                                   confidence=c["confidence"], confidence_score=c["confidence_score"], geometry=c["geometry"],
                                   centroid_lon=c["centroid"][0], centroid_lat=c["centroid"][1], data=data))
            for f in impact.facilities + impact.settlements:
                s.add(ExposedFeature(analysis_id=aid, feature_id=f.get("id"), category=f["category"], name=(f.get("name") or "")[:300] or None,
                                     lon=f["lon"], lat=f["lat"], status=f["status"], distance_m=f.get("distance_m"), tags=f.get("tags")))
        self.recorder.step(Phase.ACT, self.name, "Results persisted", detail=f"{len(dets)} detection polygons, {len(pri['cells'])} cells, "
                           f"{len(impact.facilities)} facilities")

    def _outcome(self, status: str, error: str | None, result: HazardResult | None, impact: ImpactResult | None,
                 pri: dict[str, Any] | None, narrative: dict[str, Any], layers: list[dict], context: dict[str, Any],
                 bundle: SceneBundle | None, duration: float) -> dict[str, Any]:
        f = {k: v.value for k, v in self.state.facts.items()}
        top = pri["cells"][0]["category"] if pri and pri["cells"] else None
        summary = {
            "status": status,
            "mode": self.cfg.mode,
            "hazard": self.cfg.hazard,
            "affected_area_km2": f.get("affected_area_km2"),
            "population_exposed": f.get("population_exposed"),
            "population_source": f.get("population_source"),
            "facilities_inside": f.get("facilities_inside"),
            "facilities_near": f.get("facilities_near"),
            "road_km_affected": f.get("road_km_affected"),
            "top_priority": top,
            "distribution": pri["distribution"] if pri else None,
            "confidence": f.get("overall_confidence"),
            "post_observation_date": f.get("post_observation_date"),
            "sensors_post": f.get("sensors_post"),
            "model_version": f.get("model_version"),
            "escalations": len(self.state.escalations),
            "warnings": len(self.state.warnings),
            "duration_s": round(duration, 1),
        }
        limitations = list(dict.fromkeys((result.limitations if result else []) + (impact.limitations if impact else [])
                                         + ([] if not pri or pri["exposure_basis"] == "population" else
                                            ["Population exposure unavailable - built-up area used as a proxy."])
                                         + ["Vulnerability and coping capacity are not included in the priority score."]))
        tool_stats = self.tools.stats.as_dict()
        gr = {}
        for g in self.recorder.guardrails:
            gr[g["outcome"]] = gr.get(g["outcome"], 0) + 1
        self.recorder.step(Phase.OUTCOME, self.name, f"Outcome: {status.replace('_', ' ')}", detail=error,
                           data={"summary": summary}, status="ok" if status in ("completed", "completed_with_warnings", "needs_review") else "warn")
        self.recorder.step(Phase.FEEDBACK, self.name, "Run metrics recorded for benchmarking",
                           data={"tool_stats": tool_stats, "guardrail_outcomes": gr, "phase_ms": self.phase_ms})
        results = {
            "hazard": None if result is None else {
                "method": result.method, "methodology": result.methodology, "quality": result.quality, "stats": result.stats,
                "model_info": result.model_info, "limitations": result.limitations},
            "impact": None if impact is None else impact.summary(),
            "context": context,
            "priorities": None if pri is None else {k: v for k, v in pri.items() if k != "cells"},
            "narrative": narrative and {k: v for k, v in narrative.items() if k != "guidance"},
            "guidance": (narrative or {}).get("guidance", []),
            "layers": layers,
            "limitations": limitations,
            "agent": self.state.snapshot(),
            "agent_metrics": {"tool_stats": tool_stats, "guardrail_outcomes": gr, "phase_ms": {k: round(v) for k, v in self.phase_ms.items()},
                              "duration_s": round(duration, 2), "llm": (narrative or {}).get("llm")},
            "grid": None if bundle is None else bundle.grid.to_dict(),
        }
        if self.cfg.persist:
            # 1) store results while the run still reads as "running" (reports are built from the DB)
            with session_scope() as s:
                a = s.get(Analysis, self.cfg.analysis_id)
                if a is not None:
                    a.summary, a.results = summary, _json_safe(results)
                    a.top_priority, a.confidence = top, f.get("overall_confidence")
                    a.stage, a.progress = "writing reports", 0.95
            # 2) reports, 3) only then flip to the terminal status, so clients never see a
            #    completed analysis without its reports
            if status in ("completed", "completed_with_warnings", "needs_review"):
                try:
                    self.tools.call(self.name, "generate_reports")
                except (ToolFailedError, ToolBlockedError) as exc:
                    log.warning("report generation failed", extra={"error": str(exc)[:300]})
            with session_scope() as s:
                a = s.get(Analysis, self.cfg.analysis_id)
                if a is not None:
                    a.status, a.error = status, error
                    a.progress, a.stage = 1.0, "done"
                    a.completed_at = utcnow()
                    a.message = error or f"{status.replace('_', ' ')} in {duration:.0f} s"
        return summary


def _coords(geom: dict[str, Any]):
    t = geom["type"]
    if t == "Polygon":
        yield from geom["coordinates"][0]
    elif t == "MultiPolygon":
        for p in geom["coordinates"]:
            yield from p[0]


def _json_safe(v: Any) -> Any:
    if isinstance(v, dict):
        return {str(k): _json_safe(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [_json_safe(x) for x in v]
    if isinstance(v, float):
        return v if np.isfinite(v) else None
    if isinstance(v, (np.floating, np.integer, np.bool_)):
        return _json_safe(v.item())
    if isinstance(v, np.ndarray):
        return None
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Path):
        return str(v)
    return v
