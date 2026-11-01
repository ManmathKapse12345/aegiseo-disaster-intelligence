"""Guardrails: explicit, testable checks that gate the agent loop.

Outcomes
    pass      check satisfied
    warn      proceed, record a warning (shown in results and reports)
    escalate  proceed, but route the analysis to a human analyst (HITL review task)
    block     stop the current action (invalid input, unsafe text, unauthorised action)

Thresholds are module constants so they are documented, reviewable and covered by tests.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from aegis.analysis.hazards import HazardResult

MAX_PRE_POST_GAP_DAYS = 60
MAX_WINDOW_DAYS = 120
CLOUD_ESCALATE = 0.60
SHIFT_WARN, SHIFT_ESCALATE = 1.5, 2.5
EXTENT_FRACTION_ESCALATE = 0.60
UNCERTAINTY_ESCALATE = 0.15
AGREEMENT_ESCALATE = 0.55
TERRAIN_SUPPRESSED_WARN = 0.30
STALE_DAYS = 10
SUPPORTED_HAZARDS = ("flood", "wildfire", "landslide")

BANNED_PHRASES = [
    r"\bconfirmed (dead|deaths|casualties|fatalities)\b",
    r"\bcasualt(y|ies)\b",
    r"\bdeath toll\b",
    r"\b(everyone|all residents) must evacuate\b",
    r"\bevacuate (now|immediately)\b",
    r"\bguarantee[sd]?\b",
    r"\b(certainly|definitely) (flooded|burned|destroyed)\b",
    r"\bdispatch (teams|resources) (now|immediately)\b",
]


@dataclass
class GuardrailResult:
    code: str
    name: str
    stage: str
    outcome: str
    message: str
    value: Any = None
    threshold: Any = None


def check_inputs(hazard: str, aoi_area_km2: float, min_km2: float, max_km2: float, event: date,
                 pre: tuple[date, date], post: tuple[date, date], today: date | None = None) -> list[GuardrailResult]:
    today = today or datetime.now(UTC).date()
    out: list[GuardrailResult] = []
    out.append(GuardrailResult("G01", "Supported hazard type", "input",
                               "pass" if hazard in SUPPORTED_HAZARDS else "block",
                               f"hazard '{hazard}'" + ("" if hazard in SUPPORTED_HAZARDS else f" is not supported ({', '.join(SUPPORTED_HAZARDS)})"),
                               hazard, list(SUPPORTED_HAZARDS)))
    ok_size = min_km2 <= aoi_area_km2 <= max_km2
    out.append(GuardrailResult("G02", "AOI size within processing limits", "input", "pass" if ok_size else "block",
                               f"AOI area {aoi_area_km2:.1f} km2" + ("" if ok_size else f" outside [{min_km2}, {max_km2}] km2"),
                               round(aoi_area_km2, 2), [min_km2, max_km2]))
    problems = []
    if not pre[0] <= pre[1]:
        problems.append("pre-event window start is after its end")
    if not post[0] <= post[1]:
        problems.append("post-event window start is after its end")
    if pre[1] > event:
        problems.append("pre-event window must end on or before the event date")
    if post[1] < event:
        problems.append("post-event window must end on or after the event date")
    if event > today:
        problems.append("event date is in the future")
    if (pre[1] - pre[0]).days > MAX_WINDOW_DAYS or (post[1] - post[0]).days > MAX_WINDOW_DAYS:
        problems.append(f"search windows longer than {MAX_WINDOW_DAYS} days are not allowed")
    out.append(GuardrailResult("G03", "Temporal logic of observation windows", "input", "block" if problems else "pass",
                               "; ".join(problems) or "windows are consistent with the event date",
                               {"event": event.isoformat(), "pre": [d.isoformat() for d in pre], "post": [d.isoformat() for d in post]}))
    return out


def check_data(availability: dict[str, bool], s2_post_cloud: float | None, s2_post_usable: bool,
               s1_orbit_consistent: bool | None, gaps: dict[str, float | None], post_age_days: float | None,
               event_is_recent: bool) -> list[GuardrailResult]:
    out: list[GuardrailResult] = []
    post_any = availability.get("S1_post") or (availability.get("S2_post") and s2_post_usable)
    out.append(GuardrailResult("G04", "Post-event observation available", "data", "pass" if post_any else "block",
                               "at least one usable post-event sensor" if post_any else "no usable post-event observation",
                               availability))
    if not (availability.get("S1_pre") or availability.get("S2_pre")):
        out.append(GuardrailResult("G05", "Pre-event reference available", "data", "warn",
                                   "no pre-event observation; change is inferred against the long-term water record only"))
    big_gap = {k: v for k, v in gaps.items() if v is not None and v > MAX_PRE_POST_GAP_DAYS}
    out.append(GuardrailResult("G06", "Pre/post temporal baseline", "data", "warn" if big_gap else "pass",
                               f"baseline over {MAX_PRE_POST_GAP_DAYS} days ({big_gap}); seasonal change may be mistaken for hazard"
                               if big_gap else "pre/post baselines within limits", gaps, MAX_PRE_POST_GAP_DAYS))
    if s1_orbit_consistent is not None:
        out.append(GuardrailResult("G07", "Sentinel-1 orbit consistency", "data", "pass" if s1_orbit_consistent else "warn",
                                   "same relative orbit before and after" if s1_orbit_consistent
                                   else "different relative orbits; SAR change evidence is less reliable", s1_orbit_consistent))
    if s2_post_cloud is not None:
        heavy = s2_post_cloud > CLOUD_ESCALATE
        sar = bool(availability.get("S1_post"))
        outcome = "pass" if not heavy else ("warn" if sar else "escalate")
        msg = (f"post-event optical cloud cover {s2_post_cloud:.0%}"
               + ("" if not heavy else ("; SAR leads the analysis" if sar else "; no SAR available - low observability")))
        out.append(GuardrailResult("G08", "Optical cloud cover", "data", outcome, msg, round(s2_post_cloud, 3), CLOUD_ESCALATE))
    if event_is_recent and post_age_days is not None:
        stale = post_age_days > STALE_DAYS
        out.append(GuardrailResult("G09", "Evidence freshness", "data", "warn" if stale else "pass",
                                   f"latest post-event image is {post_age_days:.0f} days old" + ("; situation may have changed" if stale else ""),
                                   round(post_age_days, 1), STALE_DAYS))
    return out


def check_perception(result: HazardResult) -> list[GuardrailResult]:
    q = result.quality
    out: list[GuardrailResult] = []
    if q.get("model_method") == "classical_fallback":
        out.append(GuardrailResult("G10", "Deep model availability", "perception", "escalate",
                                   "deep fusion model unavailable; classical rules used - analyst review required"))
    shift = (q.get("distribution_shift") or {}).get("max_z")
    if shift is not None:
        outcome = "escalate" if shift > SHIFT_ESCALATE else ("warn" if shift > SHIFT_WARN else "pass")
        out.append(GuardrailResult("G11", "Input distribution shift", "perception", outcome,
                                   f"max channel z-score {shift:.2f} vs training data"
                                   + (f" ({q['distribution_shift'].get('worst_channel')})" if outcome != "pass" else ""),
                                   shift, [SHIFT_WARN, SHIFT_ESCALATE]))
    frac = q.get("affected_fraction_of_aoi") or 0.0
    out.append(GuardrailResult("G12", "Plausibility of detected extent", "perception",
                               "escalate" if frac > EXTENT_FRACTION_ESCALATE else "pass",
                               f"{frac:.0%} of the AOI detected as affected" + (" - implausibly large, possible systematic error"
                                                                               if frac > EXTENT_FRACTION_ESCALATE else ""),
                               round(frac, 4), EXTENT_FRACTION_ESCALATE))
    unc = q.get("mean_uncertainty_detected")
    agree = q.get("cross_method_agreement")
    cov = q.get("cross_method_coverage") or 0.0
    reasons = []
    if unc is not None and unc > UNCERTAINTY_ESCALATE:
        reasons.append(f"mean uncertainty {unc:.2f} > {UNCERTAINTY_ESCALATE}")
    if agree is not None and cov >= 0.2 and agree < AGREEMENT_ESCALATE:
        reasons.append(f"independent-method agreement {agree:.0%} < {AGREEMENT_ESCALATE:.0%}")
    out.append(GuardrailResult("G13", "Detection confidence", "perception", "escalate" if reasons else "pass",
                               "; ".join(reasons) or "uncertainty and cross-method agreement acceptable",
                               {"uncertainty": unc, "agreement": agree, "coverage": cov},
                               {"uncertainty": UNCERTAINTY_ESCALATE, "agreement": AGREEMENT_ESCALATE}))
    ts = q.get("terrain_suppressed_fraction")
    if ts is not None and ts > TERRAIN_SUPPRESSED_WARN:
        out.append(GuardrailResult("G14", "Terrain-suppressed detections", "perception", "warn",
                                   f"{ts:.0%} of candidate pixels removed by the terrain constraint (radar shadow or hillside artefacts)",
                                   round(ts, 3), TERRAIN_SUPPRESSED_WARN))
    if q.get("requires_verification"):
        out.append(GuardrailResult("G15", "Hazard type requires verification", "perception", "escalate",
                                   "landslide candidates are indicative and must be verified by an analyst"))
    return out


_NUM = re.compile(r"(?<![\w.])-?\d[\d,]*(?:\.\d+)?")
_DATE = re.compile(r"\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?\b")


def dates_in(text: str) -> list[str]:
    return [m.group()[:10] for m in _DATE.finditer(text)]


def numbers_in(text: str) -> list[float]:
    """Numbers in free text, excluding ISO dates (validated separately)."""
    vals = []
    for m in _NUM.finditer(_DATE.sub(" ", text)):
        try:
            vals.append(float(m.group().replace(",", "")))
        except ValueError:
            continue
    return vals


def check_grounding(text: str, allowed: list[float], allowed_dates: set[str] | None = None,
                    rel_tol: float = 0.02) -> GuardrailResult:
    """Every number and date in generated text must match an evidence-backed value (within rounding)."""
    unsupported: list[Any] = []
    for v in numbers_in(text):
        if v in (0.0, 1.0) or (1900 <= v <= 2100 and float(v).is_integer()):
            continue  # trivial counts and calendar years
        if not any(abs(v - a) <= max(rel_tol * abs(a), 0.51 if abs(a) >= 1 else 0.006) or abs(v - a * 100) <= 0.6 for a in allowed):
            unsupported.append(v)
    if allowed_dates is not None:
        unsupported += [d for d in dates_in(text) if d not in allowed_dates]
    return GuardrailResult("G16", "Alert grounding", "reporting", "block" if unsupported else "pass",
                           f"unsupported values: {unsupported}" if unsupported else "all numbers and dates trace to recorded evidence",
                           {"unsupported": unsupported, "checked": len(numbers_in(text)) + len(dates_in(text))})


def check_language(text: str) -> GuardrailResult:
    hits = [p for p in BANNED_PHRASES if re.search(p, text, flags=re.I)]
    return GuardrailResult("G17", "Hedged, non-directive language", "reporting", "block" if hits else "pass",
                           f"prohibited phrasing: {hits}" if hits else "language is hedged and non-directive", hits)


def check_publication(alert_status: str, synthetic: bool, approved_by: str | None) -> GuardrailResult:
    if synthetic:
        return GuardrailResult("G18", "Publication authorisation", "action", "block",
                               "alerts derived from synthetic data can never be published")
    if not approved_by:
        return GuardrailResult("G18", "Publication authorisation", "action", "block", "a named human approver is required")
    if alert_status not in ("pending_review", "approved"):
        return GuardrailResult("G18", "Publication authorisation", "action", "block", f"alert in status '{alert_status}' cannot be published")
    return GuardrailResult("G18", "Publication authorisation", "action", "pass", f"approved by {approved_by}")
