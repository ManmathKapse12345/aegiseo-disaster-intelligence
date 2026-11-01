from datetime import date, timedelta

import numpy as np
import pytest

from aegis.agents import guardrails as G
from aegis.agents.narrative import (
    allowed_dates,
    build_alerts,
    evidence_values,
    numeric_values,
    strip_citations,
    verify_text,
)
from aegis.agents.recorder import TraceRecorder, jsonable
from aegis.agents.state import AgentState, Goal
from aegis.agents.tools import SideEffect, Tool, ToolBlockedError, ToolExecutor, ToolFailedError, ToolPolicy
from aegis.analysis.hazards import HazardResult, InsufficientDataError
from aegis.geo.aoi import AOI

E = date(2024, 8, 20)


def outcomes(results):
    return {r.code: r.outcome for r in results}


def test_input_guardrails():
    ok = outcomes(G.check_inputs("flood", 100, 0.25, 1500, E, (E - timedelta(30), E - timedelta(1)), (E, E + timedelta(10))))
    assert set(ok.values()) == {"pass"}
    bad = outcomes(G.check_inputs("tsunami", 5000, 0.25, 1500, E + timedelta(400), (E, E - timedelta(5)), (E, E + timedelta(1))))
    assert bad == {"G01": "block", "G02": "block", "G03": "block"}
    late_pre = outcomes(G.check_inputs("flood", 10, 0.25, 1500, E, (E - timedelta(5), E + timedelta(2)), (E, E + timedelta(3))))
    assert late_pre["G03"] == "block"
    long = outcomes(G.check_inputs("flood", 10, 0.25, 1500, E, (E - timedelta(300), E - timedelta(1)), (E, E + timedelta(3))))
    assert long["G03"] == "block"


def test_data_guardrails():
    av = {"S1_post": True, "S2_post": True, "S1_pre": True, "S2_pre": False}
    r = outcomes(G.check_data(av, 0.9, True, True, {"S1": 12, "S2": None}, 2, True))
    assert r["G04"] == "pass" and r["G08"] == "warn" and r["G07"] == "pass" and r["G09"] == "pass"
    no_sar = {"S1_post": False, "S2_post": True}
    assert outcomes(G.check_data(no_sar, 0.9, True, None, {}, None, False))["G08"] == "escalate"
    nothing = {"S1_post": False, "S2_post": True}
    assert outcomes(G.check_data(nothing, 1.0, False, None, {}, None, False))["G04"] == "block"
    r2 = outcomes(G.check_data({"S1_post": True}, None, False, False, {"S1": 90}, 25, True))
    assert r2["G05"] == "warn" and r2["G06"] == "warn" and r2["G07"] == "warn" and r2["G09"] == "warn"


def _result(**q):
    z = np.zeros((2, 2))
    return HazardResult("flood", "m", [], z.astype(bool), z, z, quality=q)


def test_perception_guardrails():
    good = outcomes(G.check_perception(_result(model_method="deep_fusion_model", distribution_shift={"max_z": 0.5},
                                               affected_fraction_of_aoi=0.1, mean_uncertainty_detected=0.05,
                                               cross_method_agreement=0.9, cross_method_coverage=0.9)))
    assert set(good.values()) == {"pass"}
    bad = outcomes(G.check_perception(_result(model_method="classical_fallback", distribution_shift={"max_z": 3.2, "worst_channel": "S2_B12"},
                                              affected_fraction_of_aoi=0.8, mean_uncertainty_detected=0.3,
                                              cross_method_agreement=0.3, cross_method_coverage=0.9,
                                              terrain_suppressed_fraction=0.5, requires_verification=True)))
    assert bad == {"G10": "escalate", "G11": "escalate", "G12": "escalate", "G13": "escalate", "G14": "warn", "G15": "escalate"}
    low_cov = outcomes(G.check_perception(_result(affected_fraction_of_aoi=0.1, cross_method_agreement=0.1, cross_method_coverage=0.05)))
    assert low_cov["G13"] == "pass"  # agreement on <20 % coverage is not evidence of disagreement


def test_grounding_numbers_dates_and_citations():
    allowed = numeric_values({"area": 4.58, "pop": 2896, "agree": 0.97, "n": 38})
    ok, checks = verify_text("Detected 4.58 km2 [F:area]; about 2,896 residents [F:pop]; agreement 97% across 38 cells, observed 2024-08-22.",
                             allowed, {"area", "pop"}, {"2024-08-22"})
    assert ok, checks
    bad_num, _ = verify_text("About 12,000 residents [F:pop].", allowed, {"pop"})
    bad_date, _ = verify_text("Observed 2023-01-01.", allowed, set(), {"2024-08-22"})
    bad_cite, _ = verify_text("Detected 4.58 km2 [F:made_up].", allowed, {"area"})
    assert not bad_num and not bad_date and not bad_cite
    assert G.check_grounding("In 2024 there was 1 event.", []).outcome == "pass"  # years and trivial counts
    assert strip_citations("Area 4.58 km2 [F:area].") == "Area 4.58 km2."


def test_template_alerts_pass_grounding_with_real_source_labels():
    # Regression (found on the real Derna run): the situation-summary alert quotes the population
    # source label "... (~30 m)", whose number was not registered as evidence, so G16 withheld it.
    state = AgentState("t", Goal("test", "flood", AOI.from_bbox(22.58, 32.71, 22.7, 32.78), E, (E - timedelta(30), E - timedelta(1)),
                                 (E, E + timedelta(14))))
    for key, value in {"affected_area_km2": 0.0312, "aoi_area_km2": 87.31, "post_observation_date": "2024-08-21",
                       "population_exposed": 18, "population_source": "Meta/CIESIN High Resolution Settlement Layer (~30 m)",
                       "infrastructure_available": True, "facilities_inside": 0, "facilities_near": 2, "road_km_affected": 0.52,
                       "near_distance_m": 500, "overall_confidence": "Medium", "cross_method_agreement": 0.972}.items():
        state.add_fact(key, value, None, "test", key)
    state.escalations.append({"code": "G11"})
    priorities = {"distribution": {"Critical": 0, "High": 0, "Moderate": 1, "Low": 0},
                  "cells": [{"category": "Moderate", "cell_id": "c1", "facilities": []}]}
    alerts = build_alerts(state, priorities)
    assert "(~30 m)" in alerts[0]["body"]
    for a in alerts:
        ok, checks = verify_text(a["body"], evidence_values(state, priorities) + a.pop("_allowed_extra", []), set(state.facts),
                                 allowed_dates(state))
        assert ok, [c.message for c in checks]
    # ...but numbers in other free-text facts are still not accepted as evidence
    assert not verify_text("About 66 residents.", evidence_values(state, priorities), set(state.facts))[0]


def test_language_guardrail():
    assert G.check_language("Residents are potentially exposed; verification is recommended.").outcome == "pass"
    for text in ("There are confirmed deaths.", "Everyone must evacuate now", "This is guaranteed safe", "casualties expected"):
        assert G.check_language(text).outcome == "block", text


def test_publication_guardrail():
    assert G.check_publication("pending_review", False, "ana").outcome == "pass"
    assert G.check_publication("pending_review", True, "ana").outcome == "block"
    assert G.check_publication("pending_review", False, None).outcome == "block"
    assert G.check_publication("rejected", False, "ana").outcome == "block"


def _executor(policy=None):
    calls = []

    def boom():
        raise RuntimeError("kaboom")

    def domain():
        raise InsufficientDataError("no data")

    tools = [
        Tool("read", "r", SideEffect.READ_ONLY, lambda x=1: calls.append(x) or x * 2, lambda v: {"v": v}),
        Tool("draft", "d", SideEffect.WRITE_DRAFT, lambda: "id-1"),
        Tool("publish", "p", SideEffect.EXTERNAL, lambda: "sent"),
        Tool("boom", "b", SideEffect.COMPUTE, boom),
        Tool("domain", "x", SideEffect.COMPUTE, domain, passthrough=(InsufficientDataError,)),
    ]
    rec = TraceRecorder(None, persist=False)
    return ToolExecutor(tools, rec, policy), rec


def test_tool_policy_and_tracing():
    ex, rec = _executor()
    assert ex.call("agent", "read", x=3) == 6 and ex.call("agent", "draft") == "id-1"
    with pytest.raises(ToolBlockedError):
        ex.call("agent", "publish")  # external effects need a human approval token
    assert ex.call("human", "publish", approval="analyst-1") == "sent"
    with pytest.raises(ToolBlockedError):
        ex.call("agent", "rm_rf")
    with pytest.raises(ToolFailedError) as e:
        ex.call("agent", "boom")
    assert "kaboom" in str(e.value)
    with pytest.raises(InsufficientDataError):
        ex.call("agent", "domain")
    s = ex.stats.as_dict()
    assert s["ok"] == 3 and s["errors"] == 2 and s["blocked"] == 2
    statuses = [t["status"] for t in rec.tools]
    assert statuses.count("blocked") == 2 and statuses.count("error") == 2
    assert rec.tools[0]["result_summary"] == {"v": 6}


def test_tool_budget():
    ex, _ = _executor(ToolPolicy(max_calls=2))
    ex.call("a", "read")
    ex.call("a", "read")
    with pytest.raises(ToolBlockedError, match="budget"):
        ex.call("a", "read")


def test_jsonable_compacts_values():
    v = jsonable({"arr": np.zeros((3, 4)), "f": float("nan"), "n": np.int64(3), "lst": list(range(40)), "d": date(2024, 1, 2)})
    assert v["arr"] == "<array float64 [3, 4]>" and v["f"] is None and v["n"] == 3 and len(v["lst"]) == 26 and v["d"] == "2024-01-02"
