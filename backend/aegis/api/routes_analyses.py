"""Analysis lifecycle, results and artefact endpoints."""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from aegis.actions import clone_analysis, override_priority, purge_analysis
from aegis.api.deps import Identity, require
from aegis.api.schemas import AnalysisCreate, PriorityOverride
from aegis.config import get_settings
from aegis.db import (
    AgentStep,
    Alert,
    Analysis,
    Detection,
    ExposedFeature,
    GuardrailCheck,
    Observation,
    PriorityCell,
    Report,
    ReviewTask,
    ToolCall,
    audit,
    get_db,
    new_id,
    session_scope,
)
from aegis.geo.aoi import AOI, AOIValidationError
from aegis.jobs import default_windows, get_job_manager
from aegis.reports.documents import write_reports
from aegis.scenarios import get_scenario
from aegis.synthetic import SYNTHETIC_BBOX

router = APIRouter(prefix="/api/analyses", tags=["analyses"])
_ID = re.compile(r"^[0-9a-f]{32}$")
_LAYER = re.compile(r"^[a-z0-9_]{1,40}$")
TERMINAL = {"completed", "completed_with_warnings", "needs_review", "failed", "cancelled", "insufficient_data", "rejected", "interrupted"}


def _get(s: Session, aid: str) -> Analysis:
    if not _ID.match(aid):
        raise HTTPException(400, "invalid analysis id")
    a = s.get(Analysis, aid)
    if a is None:
        raise HTTPException(404, "analysis not found")
    return a


def analysis_brief(a: Analysis) -> dict[str, Any]:
    return {
        "id": a.id, "name": a.name, "hazard": a.hazard, "mode": a.mode, "status": a.status, "stage": a.stage,
        "progress": a.progress, "message": a.message, "bbox": [a.min_lon, a.min_lat, a.max_lon, a.max_lat], "area_km2": round(a.area_km2, 2),
        "event_date": a.event_date.isoformat(), "pre_window": [a.pre_start.isoformat(), a.pre_end.isoformat()],
        "post_window": [a.post_start.isoformat(), a.post_end.isoformat()], "summary": a.summary, "top_priority": a.top_priority,
        "confidence": a.confidence, "scenario_id": a.scenario_id, "created_by": a.created_by,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "completed_at": a.completed_at.isoformat() if a.completed_at else None, "error": a.error,
    }


@router.post("", status_code=201)
def create_analysis(body: AnalysisCreate, s: Session = Depends(get_db), who: Identity = Depends(require("analyst"))) -> dict[str, Any]:
    settings = get_settings()
    params: dict[str, Any] = {"resolution_m": body.resolution_m}
    synthetic = body.synthetic
    if body.scenario_id:
        sc = get_scenario(body.scenario_id)
        if sc is None:
            raise HTTPException(400, f"unknown scenario '{body.scenario_id}'")
        if sc.get("synthetic") and synthetic is None:
            from aegis.api.schemas import SyntheticIn

            synthetic = SyntheticIn(**sc["synthetic"])
    try:
        if body.mode == "synthetic":
            aoi = AOI.from_bbox(*SYNTHETIC_BBOX)
        elif body.aoi is not None:
            aoi = AOI.from_geojson(body.aoi)
        else:
            aoi = AOI.from_bbox(*body.bbox)  # type: ignore[misc]
        if body.mode == "real":
            aoi.validate_size(settings.min_aoi_km2, settings.max_aoi_km2)
    except AOIValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    today = datetime.now(UTC).date()
    if body.event_date > today:
        raise HTTPException(400, "event_date cannot be in the future")
    d_pre, d_post = default_windows(body.event_date, today)
    pre = body.pre_window or d_pre
    post = body.post_window or d_post
    if body.weights:
        params["weights"] = body.weights.model_dump()
    if body.detection:
        params["detection"] = body.detection.model_dump()
    if body.mode == "synthetic":
        params["synthetic"] = (synthetic.model_dump() if synthetic else {})
        params["fail_tools"] = body.fail_tools
    a = Analysis(id=new_id(), name=body.name, hazard=body.hazard, mode=body.mode, status="queued", aoi_geojson=aoi.to_geojson(),
                 min_lon=aoi.bbox[0], min_lat=aoi.bbox[1], max_lon=aoi.bbox[2], max_lat=aoi.bbox[3], area_km2=aoi.area_km2,
                 event_date=body.event_date, pre_start=pre[0], pre_end=pre[1], post_start=post[0], post_end=post[1], params=params,
                 scenario_id=body.scenario_id, created_by=who.user, progress=0.0, stage="queued")
    s.add(a)
    audit(s, who.user, "analysis.create", "analysis", a.id, hazard=body.hazard, mode=body.mode)
    s.commit()
    get_job_manager().submit(a.id)
    return analysis_brief(a)


@router.get("")
def list_analyses(
    s: Session = Depends(get_db),
    status: str | None = Query(None, max_length=32),
    hazard: str | None = Query(None, max_length=32),
    mode: str | None = Query(None, max_length=16),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    q = select(Analysis)
    cq = select(func.count()).select_from(Analysis)
    for col, val in ((Analysis.status, status), (Analysis.hazard, hazard), (Analysis.mode, mode)):
        if val:
            q, cq = q.where(col == val), cq.where(col == val)
    total = s.scalar(cq) or 0
    rows = s.scalars(q.order_by(Analysis.created_at.desc()).limit(limit).offset(offset)).all()
    return {"total": total, "items": [analysis_brief(a) for a in rows], "limit": limit, "offset": offset}


@router.get("/{aid}")
def get_analysis(aid: str, s: Session = Depends(get_db)) -> dict[str, Any]:
    a = _get(s, aid)
    out = analysis_brief(a)
    out["aoi"] = a.aoi_geojson
    out["params"] = a.params
    out["results"] = a.results
    out["observations"] = [{"sensor": o.sensor, "role": o.role, "acquired_at": o.acquired_at.isoformat(), "collection": o.collection,
                            "item_ids": o.item_ids, "cloud_fraction": o.cloud_fraction, "valid_fraction": o.valid_fraction,
                            "meta": o.meta, "synthetic": o.synthetic}
                           for o in s.scalars(select(Observation).where(Observation.analysis_id == aid))]
    out["reports"] = [{"kind": r.kind, "filename": r.filename, "sha256": r.sha256, "size_bytes": r.size_bytes,
                       "created_at": r.created_at.isoformat(), "url": f"/api/analyses/{aid}/reports/{r.kind}"}
                      for r in s.scalars(select(Report).where(Report.analysis_id == aid).order_by(Report.created_at.desc()))]
    out["counts"] = {
        "alerts_pending": s.scalar(select(func.count()).select_from(Alert).where(Alert.analysis_id == aid, Alert.status == "pending_review")),
        "reviews_open": s.scalar(select(func.count()).select_from(ReviewTask).where(ReviewTask.analysis_id == aid, ReviewTask.status == "open")),
    }
    return out


@router.get("/{aid}/status")
def get_status(aid: str, s: Session = Depends(get_db)) -> dict[str, Any]:
    a = _get(s, aid)
    last = s.scalars(select(AgentStep).where(AgentStep.analysis_id == aid).order_by(AgentStep.seq.desc()).limit(6)).all()
    return {"id": a.id, "status": a.status, "stage": a.stage, "progress": a.progress, "message": a.message,
            "recent_steps": [{"seq": st.seq, "phase": st.phase, "agent": st.agent, "title": st.title, "status": st.status} for st in last]}


@router.post("/{aid}/cancel")
def cancel(aid: str, s: Session = Depends(get_db), who: Identity = Depends(require("analyst"))) -> dict[str, Any]:
    a = _get(s, aid)
    if a.status in TERMINAL:
        raise HTTPException(409, f"analysis already finished ({a.status})")
    a.cancel_requested = True
    audit(s, who.user, "analysis.cancel", "analysis", aid)
    s.commit()
    return {"id": aid, "cancel_requested": True}


@router.post("/{aid}/rerun", status_code=201)
def rerun(aid: str, s: Session = Depends(get_db), who: Identity = Depends(require("analyst"))) -> dict[str, Any]:
    src = _get(s, aid)
    clone = clone_analysis(s, src, who)
    s.commit()
    get_job_manager().submit(clone.id)
    return analysis_brief(clone)


@router.delete("/{aid}", status_code=204)
def delete(aid: str, s: Session = Depends(get_db), who: Identity = Depends(require("admin"))) -> Response:
    a = _get(s, aid)
    if a.status in ("queued", "running"):
        raise HTTPException(409, "cancel the analysis before deleting it")
    purge_analysis(s, aid)
    audit(s, who.user, "analysis.delete", "analysis", aid)
    s.commit()
    return Response(status_code=204)


# ----------------------------------------------------------------------------- results
@router.get("/{aid}/detections")
def detections(aid: str, s: Session = Depends(get_db), bbox: str | None = Query(None, max_length=100)) -> dict[str, Any]:
    _get(s, aid)
    q = select(Detection).where(Detection.analysis_id == aid)
    if bbox:
        try:
            minx, miny, maxx, maxy = (float(v) for v in bbox.split(","))
        except ValueError as exc:
            raise HTTPException(400, "bbox must be 'minx,miny,maxx,maxy'") from exc
        q = q.where(Detection.max_lon >= minx, Detection.min_lon <= maxx, Detection.max_lat >= miny, Detection.min_lat <= maxy)
    rows = s.scalars(q.order_by(Detection.area_km2.desc())).all()
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": d.id, "geometry": d.geometry,
         "properties": {"id": d.id, "hazard": d.hazard, "area_km2": round(d.area_km2, 4),
                        "mean_confidence": None if d.mean_confidence is None else round(d.mean_confidence, 3),
                        "mean_uncertainty": None if d.mean_uncertainty is None else round(d.mean_uncertainty, 3),
                        "agreement": None if d.agreement is None else round(d.agreement, 3), **(d.props or {})}} for d in rows]}


@router.get("/{aid}/priorities")
def priorities(aid: str, s: Session = Depends(get_db)) -> dict[str, Any]:
    _get(s, aid)
    rows = s.scalars(select(PriorityCell).where(PriorityCell.analysis_id == aid).order_by(PriorityCell.rank)).all()
    feats = []
    for c in rows:
        props = {**c.data, "category": c.override_category or c.category, "model_category": c.category,
                 "override_reason": c.override_reason, "overridden_by": c.overridden_by}
        props.pop("i", None)
        props.pop("j", None)
        feats.append({"type": "Feature", "id": c.cell_id, "geometry": c.geometry, "properties": props})
    return {"type": "FeatureCollection", "features": feats}


@router.patch("/{aid}/priorities/{cell_id}")
def patch_priority(aid: str, cell_id: str, body: PriorityOverride, s: Session = Depends(get_db),
                   who: Identity = Depends(require("analyst"))) -> dict[str, Any]:
    _get(s, aid)
    if not re.match(r"^C\d{3}-\d{3}$", cell_id):
        raise HTTPException(400, "invalid cell id")
    c = override_priority(s, aid, cell_id, body.category, body.reason, who)
    s.commit()
    return {"cell_id": c.cell_id, "category": c.override_category or c.category, "model_category": c.category,
            "override_reason": c.override_reason, "overridden_by": c.overridden_by}


@router.get("/{aid}/facilities")
def facilities(aid: str, s: Session = Depends(get_db), status: str | None = Query(None, pattern="^(inside|near|outside)$")) -> dict[str, Any]:
    _get(s, aid)
    q = select(ExposedFeature).where(ExposedFeature.analysis_id == aid)
    if status:
        q = q.where(ExposedFeature.status == status)
    rows = s.scalars(q).all()
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": f.id, "geometry": {"type": "Point", "coordinates": [f.lon, f.lat]},
         "properties": {"id": f.feature_id, "category": f.category, "name": f.name, "status": f.status, "distance_m": f.distance_m,
                        "tags": f.tags}} for f in rows]}


@router.get("/{aid}/trace")
def trace(aid: str, s: Session = Depends(get_db)) -> dict[str, Any]:
    a = _get(s, aid)
    steps = s.scalars(select(AgentStep).where(AgentStep.analysis_id == aid).order_by(AgentStep.seq)).all()
    tools = s.scalars(select(ToolCall).where(ToolCall.analysis_id == aid).order_by(ToolCall.created_at, ToolCall.id)).all()
    guards = s.scalars(select(GuardrailCheck).where(GuardrailCheck.analysis_id == aid).order_by(GuardrailCheck.id)).all()
    agent = (a.results or {}).get("agent") or {}
    return {
        "goal": agent.get("goal"), "plan": agent.get("plan"), "decisions": agent.get("decisions", []), "facts": agent.get("facts", {}),
        "evidence": agent.get("evidence", {}), "flags": agent.get("flags", []), "escalations": agent.get("escalations", []),
        "metrics": (a.results or {}).get("agent_metrics"),
        "steps": [{"seq": x.seq, "phase": x.phase, "agent": x.agent, "title": x.title, "detail": x.detail, "rationale": x.rationale,
                   "data": x.data, "status": x.status, "duration_ms": x.duration_ms, "at": x.created_at.isoformat()} for x in steps],
        "tool_calls": [{"seq": t.seq, "agent": t.agent, "tool": t.tool, "side_effect": t.side_effect, "args": t.args, "status": t.status,
                        "error": t.error, "latency_ms": t.latency_ms, "result": t.result_summary, "at": t.created_at.isoformat()} for t in tools],
        "guardrails": [{"code": g.code, "name": g.name, "stage": g.stage, "outcome": g.outcome, "message": g.message, "value": g.value,
                        "threshold": g.threshold} for g in guards],
    }


@router.get("/{aid}/layers")
def layers(aid: str, s: Session = Depends(get_db)) -> list[dict[str, Any]]:
    a = _get(s, aid)
    out = []
    for layer in (a.results or {}).get("layers") or []:
        out.append({**layer, "url": f"/api/analyses/{aid}/layers/{layer['id']}.png"})
    return out


def _artifact(aid: str, *parts: str) -> Path:
    base = (get_settings().artifacts_dir / aid).resolve()
    path = base.joinpath(*parts).resolve()
    if base not in path.parents:  # path traversal guard
        raise HTTPException(400, "invalid path")
    return path


@router.get("/{aid}/layers/{name}.png")
def layer_png(aid: str, name: str, s: Session = Depends(get_db)) -> FileResponse:
    _get(s, aid)
    if not _LAYER.match(name):
        raise HTTPException(400, "invalid layer name")
    path = _artifact(aid, "layers", f"{name}.png")
    if not path.exists():
        raise HTTPException(404, "layer not found")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/{aid}/reports/{kind}")
def report(aid: str, kind: str, s: Session = Depends(get_db), regenerate: bool = False) -> FileResponse:
    a = _get(s, aid)
    names = {"pdf": ("report.pdf", "application/pdf"), "csv": ("priorities.csv", "text/csv"),
             "geojson": ("analysis.geojson", "application/geo+json")}
    if kind not in names:
        raise HTTPException(404, "unknown report kind")
    if a.status not in ("completed", "completed_with_warnings", "needs_review"):
        raise HTTPException(409, f"reports are available once the analysis has completed (status '{a.status}')")
    fname, media = names[kind]
    path = _artifact(aid, "reports", fname)
    if regenerate or not path.exists():
        with session_scope() as s2:
            write_reports(s2, aid, path.parent)
    if not path.exists():
        raise HTTPException(500, "report generation failed")
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", a.name)[:60]
    return FileResponse(path, media_type=media, filename=f"aegis_{safe}_{fname}")


@router.get("/{aid}/exports/products.tif")
def export_tif(aid: str, s: Session = Depends(get_db)) -> FileResponse:
    a = _get(s, aid)
    path = _artifact(aid, "exports", f"{a.hazard}_products.tif")
    if not path.exists():
        raise HTTPException(404, "export not available")
    return FileResponse(path, media_type="image/tiff", filename=f"aegis_{a.id[:8]}_{a.hazard}_products.tif")


def iso(d: date | datetime | None) -> str | None:
    return d.isoformat() if d else None
