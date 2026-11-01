"""Human-in-the-loop endpoints: alerts and the review queue."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from aegis.actions import decide_alert, decide_review
from aegis.api.deps import Identity, require
from aegis.api.schemas import Decision, ReviewDecision
from aegis.db import Alert, Analysis, ReviewTask, get_db
from aegis.jobs import get_job_manager

router = APIRouter(prefix="/api", tags=["review"])


def alert_dict(a: Alert, analysis: Analysis | None = None) -> dict[str, Any]:
    return {"id": a.id, "analysis_id": a.analysis_id, "analysis_name": analysis.name if analysis else None,
            "hazard": analysis.hazard if analysis else None, "cell_id": a.cell_id, "severity": a.severity, "title": a.title,
            "body": a.body, "evidence": a.evidence, "grounding": a.grounding, "confidence": a.confidence, "status": a.status,
            "requires_approval": a.requires_approval, "synthetic": a.synthetic, "created_at": a.created_at.isoformat(),
            "decided_by": a.decided_by, "decided_at": a.decided_at.isoformat() if a.decided_at else None,
            "decision_note": a.decision_note, "delivery": a.delivery,
            "published_at": a.published_at.isoformat() if a.published_at else None}


def task_dict(t: ReviewTask, analysis: Analysis | None = None) -> dict[str, Any]:
    return {"id": t.id, "analysis_id": t.analysis_id, "analysis_name": analysis.name if analysis else None,
            "hazard": analysis.hazard if analysis else None, "mode": analysis.mode if analysis else None, "alert_id": t.alert_id,
            "kind": t.kind, "severity": t.severity, "title": t.title, "reason": t.reason, "payload": t.payload, "status": t.status,
            "decision": t.decision, "decided_by": t.decided_by, "decided_at": t.decided_at.isoformat() if t.decided_at else None,
            "comment": t.comment, "created_at": t.created_at.isoformat()}


@router.get("/alerts")
def list_alerts(s: Session = Depends(get_db), status: str | None = Query(None, max_length=24),
                analysis_id: str | None = Query(None, max_length=32), limit: int = Query(100, ge=1, le=500)) -> dict[str, Any]:
    q = select(Alert, Analysis).join(Analysis, Analysis.id == Alert.analysis_id)
    if status:
        q = q.where(Alert.status == status)
    if analysis_id:
        q = q.where(Alert.analysis_id == analysis_id)
    rows = s.execute(q.order_by(Alert.created_at.desc()).limit(limit)).all()
    counts = dict(s.execute(select(Alert.status, func.count()).group_by(Alert.status)).all())
    return {"items": [alert_dict(a, an) for a, an in rows], "counts": counts}


@router.post("/alerts/{alert_id}/decision")
def alert_decision(alert_id: str, body: Decision, s: Session = Depends(get_db), who: Identity = Depends(require("analyst"))) -> dict[str, Any]:
    a = decide_alert(s, alert_id, body.decision, body.note, who)
    s.commit()
    return alert_dict(a, s.get(Analysis, a.analysis_id))


@router.get("/reviews")
def list_reviews(s: Session = Depends(get_db), status: str | None = Query("open", max_length=16),
                 limit: int = Query(100, ge=1, le=500)) -> dict[str, Any]:
    q = select(ReviewTask, Analysis).join(Analysis, Analysis.id == ReviewTask.analysis_id)
    if status:
        q = q.where(ReviewTask.status == status)
    rows = s.execute(q.order_by(ReviewTask.created_at.desc()).limit(limit)).all()
    counts = dict(s.execute(select(ReviewTask.status, func.count()).group_by(ReviewTask.status)).all())
    return {"items": [task_dict(t, an) for t, an in rows], "counts": counts}


@router.post("/reviews/{task_id}/decision")
def review_decision(task_id: str, body: ReviewDecision, s: Session = Depends(get_db),
                    who: Identity = Depends(require("analyst"))) -> dict[str, Any]:
    out = decide_review(s, task_id, body.decision, body.comment, who)
    s.commit()
    if out.get("rerun_analysis_id"):
        get_job_manager().submit(out["rerun_analysis_id"])
    return out
