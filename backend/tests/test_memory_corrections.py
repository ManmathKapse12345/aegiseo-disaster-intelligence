"""Analyst corrections recalled from earlier analyses of the same area (episodic memory)."""

from aegis.agents.memory import analyst_corrections


def test_false_positives_and_overrides_are_counted_once():
    cases = [{
        "review_decisions": [
            {"kind": "quality_check", "decision": "false_positive", "comment": "cloud shadow"},
            {"kind": "quality_check", "decision": "confirm", "comment": None},
            {"kind": "verify_detection", "decision": "acknowledge", "comment": None},
        ],
        # side effects of the false-positive verdict must not be counted a second time
        "rejected_alerts": [{"title": "High priority: cell C001-002", "note": "rejected via review: false positive"},
                            {"title": "Flood situation summary", "note": "wrong place"}],
        "priority_overrides": [{"cell": "C001-002", "from": "High", "to": "Low", "reason": "analyst: false positive - cloud shadow"},
                               {"cell": "C003-004", "from": "Low", "to": "High", "reason": "field team: road cut"}],
    }]
    notes = analyst_corrections(cases)
    kinds = sorted(next(iter(n)) for n in notes)
    assert kinds == ["false_positive", "priority_override", "rejected_alert"]


def test_no_feedback_means_no_notes():
    assert analyst_corrections([]) == []
    assert analyst_corrections([{"review_decisions": [{"decision": "confirm"}], "rejected_alerts": [], "priority_overrides": []}]) == []
