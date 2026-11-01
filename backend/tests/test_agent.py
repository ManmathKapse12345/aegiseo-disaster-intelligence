"""Closed-loop orchestrator runs on synthetic scenes (persisted to the test database)."""

from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import func, select

from aegis.agents.orchestrator import AgentOrchestrator, RunConfig
from aegis.agents.toolbox import Services
from aegis.db import (
    AgentStep,
    Alert,
    Analysis,
    GuardrailCheck,
    PriorityCell,
    Report,
    ReviewTask,
    ToolCall,
    new_id,
    session_scope,
)
from aegis.geo.aoi import AOI
from aegis.ml.inference import WaterSegmenter
from aegis.synthetic import SYNTHETIC_BBOX, SyntheticConfig

EV = date(2024, 8, 20)
_SERVICES: dict = {}


def services(fallback=False) -> Services:
    key = "fb" if fallback else "default"
    if key not in _SERVICES:
        s = Services.default()
        if fallback:
            s = Services(**{**s.__dict__, "segmenter": WaterSegmenter(Path("nowhere"))})
        _SERVICES[key] = s
    return _SERVICES[key]


def run(hazard="flood", event=EV, fallback=False, cancel=False, **syn):
    fail = set(syn.pop("fail_tools", []))
    aoi = AOI.from_bbox(*SYNTHETIC_BBOX)
    pre, post = (event - timedelta(30), event - timedelta(1)), (event, event + timedelta(10))
    aid = new_id()
    with session_scope() as s:
        s.add(Analysis(id=aid, name=f"test {hazard}", hazard=hazard, mode="synthetic", status="queued", aoi_geojson=aoi.to_geojson(),
                       min_lon=aoi.bbox[0], min_lat=aoi.bbox[1], max_lon=aoi.bbox[2], max_lat=aoi.bbox[3], area_km2=aoi.area_km2,
                       event_date=event, pre_start=pre[0], pre_end=pre[1], post_start=post[0], post_end=post[1], params={},
                       cancel_requested=cancel))
    cfg = RunConfig(analysis_id=aid, name="t", hazard=hazard, aoi=aoi, event_date=event, pre_window=pre, post_window=post,
                    mode="synthetic", synthetic=SyntheticConfig(hazard=hazard, **syn), fail_tools=fail)
    orch = AgentOrchestrator(cfg, services(fallback))
    return aid, orch.run(), orch


def count(model, aid, *where):
    with session_scope() as s:
        return s.scalar(select(func.count()).select_from(model).where(model.analysis_id == aid, *where))


def test_full_flood_run_persists_trace_results_and_reports():
    aid, out, orch = run(seed=7)
    assert out.status in ("completed", "completed_with_warnings"), out.error
    assert out.summary["affected_area_km2"] > 1 and out.summary["population_exposed"] > 0
    phases = {st["phase"] for st in orch.recorder.steps}
    assert {"observe", "perceive", "semantic_state", "memory", "plan", "act", "guardrail", "outcome", "feedback"} <= phases
    assert count(AgentStep, aid) > 10 and count(ToolCall, aid) >= 8 and count(GuardrailCheck, aid) >= 8
    assert count(PriorityCell, aid) > 0
    with session_scope() as s:
        alerts = s.scalars(select(Alert).where(Alert.analysis_id == aid)).all()
        assert alerts and all(a.status == "pending_review" and a.synthetic and a.grounding["verified"] for a in alerts)
        assert {r.kind for r in s.scalars(select(Report).where(Report.analysis_id == aid))} == {"pdf", "csv", "geojson"}
        a = s.get(Analysis, aid)
        assert a.status == out.status and a.results["layers"] and a.results["agent"]["plan"]
        assert all(p["status"] == "done" for p in a.results["agent"]["plan"] if p["id"] != "deliver")
    assert orch.tools.stats.blocked == 0


def test_landslide_is_escalated_to_humans():
    aid, out, _ = run("landslide", seed=3, cloud_cover_post=0.1)
    assert out.status == "needs_review"
    assert count(ReviewTask, aid, ReviewTask.kind == "quality_check") >= 1


def test_graceful_degradation_when_context_sources_fail():
    aid, out, orch = run(seed=7, fail_tools=["query_infrastructure", "query_population"])
    assert out.status in ("completed", "completed_with_warnings")
    assert {"infrastructure_unavailable", "population_unavailable"} <= orch.state.flags
    assert {d.rule for d in orch.state.decisions} >= {"P8", "P9"}
    assert out.summary["population_exposed"] is None
    assert orch.tools.stats.errors == 2


def test_low_observability_escalates():
    _, out, _ = run(seed=5, include_s1=False, cloud_cover_post=0.85)
    assert out.status == "needs_review"


def test_invalid_input_rejected_by_guardrail():
    aid, out, _ = run(event=date.today() + timedelta(30), seed=7)
    assert out.status == "rejected" and "future" in out.error
    assert count(GuardrailCheck, aid, GuardrailCheck.code == "G03", GuardrailCheck.outcome == "block") == 1


def test_no_observations_is_insufficient_data():
    _, out, _ = run(seed=7, include_s1=False, include_s2=False)
    assert out.status == "insufficient_data"


def test_cancellation_is_honoured():
    _, out, _ = run(seed=7, cancel=True)
    assert out.status == "cancelled"


def test_classical_fallback_is_escalated():
    _, out, orch = run(seed=7, fallback=True)
    assert out.status == "needs_review"
    assert any(e["code"] == "G10" for e in orch.state.escalations)


def test_episodic_memory_recalls_previous_runs():
    run(seed=7)
    _, _, orch = run(seed=7)
    assert len(orch.state.memory["similar_cases"]) >= 1
