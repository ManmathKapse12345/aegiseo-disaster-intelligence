"""Narrative generation: executive summaries and evidence-grounded alerts.

Deterministic templates are the default and are grounded by construction (every number is
formatted from a recorded fact). When ``AEGIS_ANTHROPIC_API_KEY`` is configured, Claude can
draft a more readable executive summary from the same fact sheet; the draft is accepted only
if every number in it matches a recorded value, every cited fact key exists and the language
check passes - otherwise the template summary is used. The LLM never sees raw imagery and
never produces measurements.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from aegis.agents.guardrails import GuardrailResult, check_grounding, check_language, numbers_in
from aegis.agents.state import AgentState
from aegis.config import Settings

log = logging.getLogger(__name__)

HAZARD_NOUN = {"flood": "new surface water (flooding)", "wildfire": "burn scars", "landslide": "landslide candidates"}
_CITE = re.compile(r"\[F:([a-z0-9_]+)\]")


def numeric_values(obj: Any, out: list[float] | None = None) -> list[float]:
    """All numbers inside facts / nested structures, plus common display transforms."""
    out = [] if out is None else out
    if isinstance(obj, bool):
        return out
    if isinstance(obj, (int, float)):
        v = float(obj)
        out += [v, round(v, 0), round(v, 1), round(v, 2), round(v * 100, 0), round(v * 100, 1)]
    elif isinstance(obj, dict):
        for x in obj.values():
            numeric_values(x, out)
    elif isinstance(obj, (list, tuple)):
        for x in obj:
            numeric_values(x, out)
    return out


def evidence_values(state: AgentState, priorities: dict[str, Any]) -> list[float]:
    """Numbers generated text may state: recorded facts, the priority distribution and counts,
    and numbers that are part of data-source labels quoted verbatim (e.g. "HRSL (~30 m)")."""
    facts = {k: f.value for k, f in state.facts.items()}
    dist = priorities.get("distribution", {})
    out = numeric_values(facts) + numeric_values(dist) + [sum(dist.values()), len(state.escalations)]
    out += [v for k, x in facts.items() if k.endswith("_source") and isinstance(x, str) for v in numbers_in(x)]
    return out


def fact_sheet(state: AgentState) -> dict[str, Any]:
    return {k: {"value": f.value, "unit": f.unit, "description": f.description, "source": f.source}
            for k, f in state.facts.items()}


def _fmt(v: float | None, nd: int = 2) -> str:
    return "n/a" if v is None else f"{v:,.{nd}f}"


def template_summary(state: AgentState, priorities: dict[str, Any] | None) -> str:
    f = {k: v.value for k, v in state.facts.items()}
    hazard = state.goal.hazard
    parts = []
    synthetic = state.goal.mode == "synthetic"
    if synthetic:
        parts.append("SIMULATED DATA - this analysis uses a synthetic scene for testing and demonstration.")
    parts.append(
        f"Satellite analysis detected {_fmt(f.get('affected_area_km2'))} km2 of {HAZARD_NOUN.get(hazard, 'change')} "
        f"in the {_fmt(f.get('aoi_area_km2'), 1)} km2 area of interest, observed on {f.get('post_observation_date', 'n/a')}."
    )
    if f.get("population_exposed") is not None:
        parts.append(f"An estimated {f['population_exposed']:,} residents live inside the detected extent "
                     f"(potentially exposed; source: {f.get('population_source', 'n/a')}).")
    fac_in = f.get("facilities_inside") or 0
    fac_near = f.get("facilities_near") or 0
    if f.get("infrastructure_available"):
        parts.append(f"{fac_in} mapped critical facilit{'y is' if fac_in == 1 else 'ies are'} inside the extent and "
                     f"{fac_near} more within 500 m; {_fmt(f.get('road_km_affected'), 1)} km of mapped roads cross it.")
    if priorities:
        d = priorities.get("distribution", {})
        parts.append(f"Response prioritisation ranked {sum(d.values())} cells: {d.get('Critical', 0)} critical, "
                     f"{d.get('High', 0)} high, {d.get('Moderate', 0)} moderate and {d.get('Low', 0)} low.")
    conf = f.get("overall_confidence")
    if conf:
        agree = f.get("cross_method_agreement")
        parts.append(f"Overall confidence is {conf.lower()}"
                     + (f" (independent-method agreement {agree * 100:.0f}%)" if isinstance(agree, (int, float)) else "") + ".")
    if state.escalations:
        parts.append(f"{len(state.escalations)} issue(s) were routed to an analyst for review before any alert is published.")
    return " ".join(parts)


def llm_summary(state: AgentState, passages: list[dict[str, Any]], settings: Settings) -> tuple[str | None, dict[str, Any]]:
    """Optional Claude-written summary; returns (text or None, status info)."""
    if not settings.llm_available:
        return None, {"status": "disabled", "reason": "AEGIS_ANTHROPIC_API_KEY not configured (template summary used)"}
    try:
        import anthropic
    except ImportError:
        return None, {"status": "unavailable", "reason": "anthropic package not installed"}
    sheet = fact_sheet(state)
    system = (
        "You write executive summaries of satellite-based disaster analyses for emergency coordinators. "
        "Use ONLY the facts in the provided fact sheet. Copy every number exactly as it appears there and cite the fact "
        "key after each claim, like [F:affected_area_km2]. Never introduce numbers, places, causes or impacts that are not "
        "in the fact sheet. Describe people inside the detected extent as 'potentially exposed', never as affected, "
        "displaced or casualties. Do not give orders; frame actions as considerations for authorised responders. "
        "Mention the confidence level and the most important limitation. Plain prose, at most 150 words."
    )
    user = json.dumps({"hazard": state.goal.hazard, "synthetic_data": state.goal.mode == "synthetic", "facts": sheet,
                       "guidance": [{"ref": p["ref"], "text": p["text"][:600]} for p in passages[:3]]}, default=str)
    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key.get_secret_value(), timeout=60.0, max_retries=1)
        resp = client.beta.messages.create(
            model=settings.llm_model,
            max_tokens=8000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "medium"},
            system=system,
            messages=[{"role": "user", "content": user}],
        )
    except anthropic.APITimeoutError:
        return None, {"status": "error", "reason": "LLM request timed out"}
    except anthropic.RateLimitError:
        return None, {"status": "error", "reason": "LLM rate limited"}
    except anthropic.APIStatusError as exc:
        return None, {"status": "error", "reason": f"LLM API error {exc.status_code}"}
    except anthropic.APIConnectionError:
        return None, {"status": "error", "reason": "LLM API unreachable"}
    if resp.stop_reason == "refusal":
        return None, {"status": "refused"}
    if resp.stop_reason == "max_tokens":
        return None, {"status": "error", "reason": "LLM output truncated"}
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    return (text or None), {"status": "ok", "model": resp.model, "output_tokens": resp.usage.output_tokens}


def allowed_dates(state: AgentState) -> set[str]:
    """Dates that may appear in generated text: recorded observation / event dates."""
    out = {state.goal.event_date.isoformat()}
    out |= {str(f.value)[:10] for f in state.facts.values() if isinstance(f.value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", f.value)}
    out |= {str(e["acquired_at"])[:10] for e in state.evidence.values() if e.get("acquired_at")}
    return out


def verify_text(text: str, allowed: list[float], known_keys: set[str], dates: set[str] | None = None) -> tuple[bool, list[GuardrailResult]]:
    unknown = [k for k in _CITE.findall(text) if k not in known_keys]
    plain = _CITE.sub("", text)
    g = check_grounding(plain, allowed, dates)
    lang = check_language(plain)
    checks = [g, lang]
    if unknown:
        checks.append(GuardrailResult("G16", "Alert grounding", "reporting", "block", f"citations to unknown facts: {unknown}"))
    return all(c.outcome == "pass" for c in checks), checks


def strip_citations(text: str) -> str:
    return re.sub(r"\s+([.,;])", r"\1", _CITE.sub("", text)).strip()


def build_alerts(state: AgentState, priorities: dict[str, Any] | None, max_cell_alerts: int = 5) -> list[dict[str, Any]]:
    """Event-level situation alert plus one alert per Critical/High cell (all pending human review)."""
    f = {k: v.value for k, v in state.facts.items()}
    hazard = state.goal.hazard
    cells = (priorities or {}).get("cells", [])
    top = cells[0]["category"] if cells else "Low"
    scene_ev = [k for k, v in state.evidence.items() if v["kind"] == "scene"]
    base_ev = scene_ev + [k for k, v in state.evidence.items() if v["kind"] in ("model", "population", "infrastructure")]
    prefix = "[SIMULATED] " if state.goal.mode == "synthetic" else ""
    alerts: list[dict[str, Any]] = []
    body = template_summary(state, priorities)
    alerts.append({
        "cell_id": None,
        "severity": top,
        "title": f"{prefix}{hazard.capitalize()} situation summary - {f.get('affected_area_km2', 0):.2f} km2 detected",
        "body": body,
        "evidence": base_ev,
        "confidence": f.get("overall_confidence"),
    })
    for c in [c for c in cells if c["category"] in ("Critical", "High")][:max_cell_alerts]:
        inside = [x for x in c["facilities"] if x["status"] == "inside"]
        where = inside[0]["name"] if inside else f"cell {c['cell_id']}"
        text = c["explanation"] + " Suggested considerations: " + " ".join(c["recommended_actions"][:3])
        alerts.append({
            "cell_id": c["cell_id"],
            "severity": c["category"],
            "title": f"{prefix}{c['category']} priority: {where}",
            "body": text,
            "evidence": base_ev + [f"cell:{c['cell_id']}"] + [x["id"] for x in c["facilities"] if x.get("id")][:6],
            "confidence": c["confidence"],
            # numbers inside facility names (e.g. "School No. 4") are evidence from the infrastructure source
            "_allowed_extra": numeric_values(c) + [len(cells)] + [v for x in c["facilities"] for v in numbers_in(x.get("name") or "")],
        })
    return alerts
