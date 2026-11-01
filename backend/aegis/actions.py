"""Human-in-the-loop actions: alert approval/publication, review decisions, priority overrides.

These are the only code paths that can produce outward-facing effects, and each requires a
named human. Publication runs the ``publish_alert`` tool (side effect ``external``) through
the same :class:`ToolExecutor` policy as the agent, with the approver's identity as the
approval token - the autonomous agent never holds one.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from aegis.agents.guardrails import check_publication
from aegis.agents.recorder import TraceRecorder
from aegis.agents.tools import SideEffect, Tool, ToolBlockedError, ToolExecutor, ToolFailedError
from aegis.api.deps import Identity
from aegis.config import get_settings
from aegis.db import Alert, Analysis, GuardrailCheck, PriorityCell, ReviewTask, audit, new_id, utcnow
from aegis.net.http import ResilientHttpClient


def _publish_tool() -> Tool:
    def publish(alert: dict[str, Any]) -> dict[str, Any]:
        url = get_settings().alert_webhook_url.get_secret_value()
        if not url:
            return {"channel": "internal", "delivered": False, "note": "no AEGIS_ALERT_WEBHOOK_URL configured; alert is visible in AegisEO only"}
        client = ResilientHttpClient("alert_webhook", timeout_s=15, retries=2, cache_ttl_s=0)
        res = client.request("POST", url, data=json.dumps(alert, default=str), headers={"Content-Type": "application/json"},
                             use_cache=False)
        return {"channel": "webhook", "delivered": True, "status_code": res.status_code}

    return Tool("publish_alert", "Deliver an approved alert to the configured outbound channel", SideEffect.EXTERNAL, publish,
                lambda v: v)


def decide_alert(s: Session, alert_id: str, decision: str, note: str | None, who: Identity) -> Alert:
    alert = s.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(404, "alert not found")
    if alert.status != "pending_review":
        raise HTTPException(409, f"alert already decided (status '{alert.status}')")
    alert.decided_by, alert.decided_at, alert.decision_note = who.user, utcnow(), note
    if decision == "reject":
        alert.status = "rejected"
        audit(s, who.user, "alert.reject", "alert", alert.id, note=note)
        return alert
    gr = check_publication(alert.status, alert.synthetic, who.user)
    s.add(GuardrailCheck(analysis_id=alert.analysis_id, code=gr.code, name=gr.name, stage=gr.stage, outcome=gr.outcome,
                         message=f"Alert '{alert.title[:60]}': {gr.message}"))
    alert.status = "approved"
    if gr.outcome == "block":
        alert.delivery = {"channel": "none", "delivered": False, "reason": gr.message}
        audit(s, who.user, "alert.approve_internal_only", "alert", alert.id, reason=gr.message)
        return alert
    executor = ToolExecutor([_publish_tool()], TraceRecorder(alert.analysis_id, persist=True))
    payload = {"id": alert.id, "severity": alert.severity, "title": alert.title, "body": alert.body, "evidence": alert.evidence,
               "confidence": alert.confidence, "approved_by": who.user, "analysis_id": alert.analysis_id}
    try:
        delivery = executor.call("human_reviewer", "publish_alert", approval=who.user, alert=payload)
        alert.delivery = delivery
        if delivery.get("delivered"):
            alert.status, alert.published_at = "published", utcnow()
    except (ToolFailedError, ToolBlockedError) as exc:
        alert.delivery = {"channel": "webhook", "delivered": False, "error": str(exc)[:300]}
    audit(s, who.user, "alert.approve", "alert", alert.id, delivery=alert.delivery, note=note)
    return alert


def decide_review(s: Session, task_id: str, decision: str, comment: str | None, who: Identity) -> dict[str, Any]:
    task = s.get(ReviewTask, task_id)
    if task is None:
        raise HTTPException(404, "review task not found")
    if task.status != "open":
        raise HTTPException(409, "review task already resolved")
    task.status, task.decision, task.decided_by, task.decided_at, task.comment = "resolved", decision, who.user, utcnow(), comment
    out: dict[str, Any] = {"task_id": task.id, "decision": decision}
    cell_id = (task.payload or {}).get("cell_id")
    if decision == "false_positive":
        q = select(PriorityCell).where(PriorityCell.analysis_id == task.analysis_id)
        if cell_id:
            q = q.where(PriorityCell.cell_id == cell_id)
            for c in s.scalars(q):
                c.override_category, c.override_reason, c.overridden_by = "Low", f"analyst: false positive - {comment or ''}".strip(), who.user
        alerts = select(Alert).where(Alert.analysis_id == task.analysis_id, Alert.status == "pending_review")
        if cell_id:
            alerts = alerts.where(Alert.cell_id == cell_id)
        for a in s.scalars(alerts):
            a.status, a.decided_by, a.decided_at, a.decision_note = "rejected", who.user, utcnow(), "rejected via review: false positive"
        out["effect"] = "linked alerts rejected" + (f", cell {cell_id} set to Low" if cell_id else "")
    elif decision == "request_rerun":
        src = s.get(Analysis, task.analysis_id)
        if src is not None:
            clone = clone_analysis(s, src, who)
            out["rerun_analysis_id"] = clone.id
    audit(s, who.user, f"review.{decision}", "review_task", task.id, comment=comment, kind=task.kind)
    remaining = s.scalar(select(ReviewTask.id).where(ReviewTask.analysis_id == task.analysis_id, ReviewTask.status == "open",
                                                     ReviewTask.id != task.id).limit(1))
    a = s.get(Analysis, task.analysis_id)
    if a is not None and a.status == "needs_review" and remaining is None:
        a.status = "completed_with_warnings"
        a.message = "all review items resolved by analysts"
        out["analysis_status"] = a.status
    return out


def override_priority(s: Session, analysis_id: str, cell_id: str, category: str | None, reason: str, who: Identity) -> PriorityCell:
    cell = s.scalar(select(PriorityCell).where(PriorityCell.analysis_id == analysis_id, PriorityCell.cell_id == cell_id))
    if cell is None:
        raise HTTPException(404, "priority cell not found")
    before = cell.override_category or cell.category
    cell.override_category, cell.override_reason, cell.overridden_by = category, reason if category else None, who.user if category else None
    audit(s, who.user, "priority.override" if category else "priority.override_cleared", "priority_cell", f"{analysis_id}:{cell_id}",
          before=before, after=category or cell.category, reason=reason)
    return cell


def purge_analysis(s: Session, analysis_id: str) -> None:
    """Delete an analysis, every dependent row and its artefact directory."""
    import shutil

    from aegis.db import AgentStep, Detection, ExposedFeature, Observation, Report, ToolCall

    for model in (AgentStep, ToolCall, GuardrailCheck, Observation, Detection, PriorityCell, ExposedFeature, ReviewTask, Alert, Report):
        s.query(model).filter(model.analysis_id == analysis_id).delete(synchronize_session=False)
    a = s.get(Analysis, analysis_id)
    if a is not None:
        s.delete(a)
    shutil.rmtree(get_settings().artifacts_dir / analysis_id, ignore_errors=True)


def clone_analysis(s: Session, src: Analysis, who: Identity) -> Analysis:
    clone = Analysis(id=new_id(), name=f"{src.name} (re-run)"[:200], hazard=src.hazard, mode=src.mode, status="queued",
                     aoi_geojson=src.aoi_geojson, min_lon=src.min_lon, min_lat=src.min_lat, max_lon=src.max_lon, max_lat=src.max_lat,
                     area_km2=src.area_km2, event_date=src.event_date, pre_start=src.pre_start, pre_end=src.pre_end,
                     post_start=src.post_start, post_end=src.post_end, params=src.params, scenario_id=src.scenario_id,
                     created_by=who.user)
    s.add(clone)
    audit(s, who.user, "analysis.rerun", "analysis", clone.id, source=src.id)
    return clone
