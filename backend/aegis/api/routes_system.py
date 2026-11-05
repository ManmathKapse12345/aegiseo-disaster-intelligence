"""Health, data sources, live events, scenarios, catalogue preview, model card, knowledge, dashboard."""

from __future__ import annotations

import json
import re
import time
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from aegis import __version__
from aegis import db as dbmod
from aegis.api.deps import Identity, get_identity, require
from aegis.api.schemas import CatalogPreview
from aegis.config import REPO_ROOT, get_settings
from aegis.db import Alert, Analysis, AuditLog, PriorityCell, ReviewTask, ToolCall, get_db, get_engine
from aegis.geo.aoi import AOI, AOIValidationError
from aegis.jobs import default_windows, get_job_manager
from aegis.net.http import SourceUnavailableError
from aegis.observability import REGISTRY
from aegis.scenarios import SCENARIOS
from aegis.sources.registry import source_status

router = APIRouter(tags=["system"])
_EVENTS_CACHE: dict[str, Any] = {"at": 0.0, "data": None}


@router.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "version": __version__, "time": datetime.now(UTC).isoformat()}


@router.get("/api/health/ready")
def ready(response: Response) -> dict[str, Any]:
    checks: dict[str, Any] = {}
    ok = True
    try:
        with get_engine().connect() as c:
            c.execute(text("SELECT 1"))
        checks["database"] = {"status": "ok", "dialect": get_engine().dialect.name, "postgis": dbmod.POSTGIS_AVAILABLE}
    except Exception as exc:
        ok = False
        checks["database"] = {"status": "error", "error": str(exc)[:200]}
    seg = get_job_manager().services.segmenter
    info = seg.info()
    checks["model"] = {"status": "ok" if seg.available else "degraded", **info}
    checks["jobs"] = {"active": get_job_manager().active(), "workers": get_settings().worker_threads}
    response.status_code = 200 if ok else 503
    return {"status": "ready" if ok else "not_ready", "checks": checks}


@router.get("/metrics", include_in_schema=False)
def metrics() -> Response:
    return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)


@router.get("/api/me")
def me(who: Identity = Depends(get_identity)) -> dict[str, Any]:
    return {"user": who.user, "role": who.role, "auth_enabled": get_settings().auth_enabled}


@router.get("/api/sources")
def sources(refresh: bool = False) -> list[dict[str, Any]]:
    return source_status(get_job_manager().services, refresh=refresh)


@router.get("/api/events/live")
def live_events() -> dict[str, Any]:
    """Current GDACS alerts and USGS earthquakes (cached 10 minutes)."""
    if _EVENTS_CACHE["data"] is not None and time.time() - _EVENTS_CACHE["at"] < 600:
        return _EVENTS_CACHE["data"]
    feeds = get_job_manager().services.feeds
    out: dict[str, Any] = {"events": [], "sources": {}}
    try:
        ev, info = feeds.gdacs_events(days=21)
        out["events"] += ev
        out["sources"]["gdacs"] = info
    except SourceUnavailableError as exc:
        out["sources"]["gdacs"] = {"status": "unavailable", "error": exc.reason}
    try:
        eq, info = feeds.earthquakes()
        out["events"] += [e for e in eq if (e.get("magnitude") or 0) >= 5.5][:25]
        out["sources"]["usgs"] = info
    except SourceUnavailableError as exc:
        out["sources"]["usgs"] = {"status": "unavailable", "error": exc.reason}
    out["fetched_at"] = datetime.now(UTC).isoformat()
    _EVENTS_CACHE.update(at=time.time(), data=out)
    return out


@router.get("/api/scenarios")
def scenarios() -> list[dict[str, Any]]:
    return SCENARIOS


@router.get("/api/places")
def places(q: str = Query(..., min_length=2, max_length=200), limit: int = Query(6, ge=1, le=10)) -> dict[str, Any]:
    """Find places by name (OpenStreetMap Nominatim) or parse typed coordinates, to help choose an area."""
    from aegis.sources.places import PlaceSearchBusyError, get_place_search

    try:
        results = get_place_search().search(q, limit=limit)
    except PlaceSearchBusyError as exc:
        raise HTTPException(429, "Place search is busy. Please try again in a few seconds.", headers={"Retry-After": "3"}) from exc
    except SourceUnavailableError as exc:
        raise HTTPException(503, "Place search is not available right now. You can still move the map by hand "
                                 "or type coordinates such as 26.7, 67.8.") from exc
    return {"query": q, "results": [p.as_dict() for p in results],
            "attribution": "Search by OpenStreetMap Nominatim, data (c) OpenStreetMap contributors (ODbL)"}


@router.post("/api/catalog/preview")
def catalog_preview(body: CatalogPreview, who: Identity = Depends(require("viewer"))) -> dict[str, Any]:
    """Which Sentinel acquisitions exist for an AOI and windows (search only, no pixel reads)."""
    try:
        aoi = AOI.from_bbox(*body.bbox)
        aoi.validate_size(get_settings().min_aoi_km2, get_settings().max_aoi_km2)
    except AOIValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    today = datetime.now(UTC).date()
    d_pre, d_post = default_windows(body.event_date, today)
    pre, post = body.pre_window or d_pre, body.post_window or d_post
    pc = get_job_manager().services.pc
    out: dict[str, Any] = {"pre_window": [pre[0].isoformat(), pre[1].isoformat()], "post_window": [post[0].isoformat(), post[1].isoformat()],
                           "aoi_area_km2": round(aoi.area_km2, 1), "sensors": {}}
    for sensor in ("S1", "S2"):
        res: dict[str, Any] = {}
        for role, (a, b) in (("pre", pre), ("post", post)):
            try:
                acqs = pc.find_acquisitions(sensor, aoi, datetime(a.year, a.month, a.day, tzinfo=UTC),
                                            datetime(b.year, b.month, b.day, 23, 59, tzinfo=UTC))
                res[role] = [x.summary() for x in acqs]
            except SourceUnavailableError as exc:
                res[role] = {"error": exc.reason}
        out["sensors"][sensor] = res
    return out


# ----------------------------------------------------------------------------- model card / evaluation
@router.get("/api/model")
def model_card() -> dict[str, Any]:
    settings = get_settings()
    seg = get_job_manager().services.segmenter
    ev_path = settings.models_dir / "evaluation.json"
    evaluation = json.loads(ev_path.read_text()) if ev_path.exists() else None
    variants = {}
    for p in sorted(settings.models_dir.glob("*_unet.json")):
        d = json.loads(p.read_text())
        variants[d["variant"]] = {k: d.get(k) for k in ("variant", "description", "parameters", "temperature", "best_epoch",
                                                        "val_metrics", "train_seconds", "trained_at", "dataset", "config", "history")}
    return {"active": seg.info(), "variants": variants, "evaluation": evaluation,
            "figures": [f"/api/model/figures/{p.name}" for p in sorted((REPO_ROOT / "docs" / "figures").glob("*.png"))]}


@router.get("/api/model/figures/{name}")
def model_figure(name: str) -> FileResponse:
    if not re.match(r"^[a-z0-9_]+\.png$", name):
        raise HTTPException(400, "invalid figure name")
    path = REPO_ROOT / "docs" / "figures" / name
    if not path.exists():
        raise HTTPException(404, "figure not found")
    return FileResponse(path, media_type="image/png")


# ----------------------------------------------------------------------------- knowledge (RAG)
@router.get("/api/knowledge/search")
def knowledge_search(q: str = Query(..., min_length=2, max_length=300), k: int = Query(5, ge=1, le=10)) -> list[dict[str, Any]]:
    kb = get_job_manager().services.kb
    return [p.as_dict(score) for p, score in kb.search(q, k=k)]


@router.get("/api/knowledge")
def knowledge_list() -> list[dict[str, Any]]:
    kb = get_job_manager().services.kb
    docs: dict[str, dict[str, Any]] = {}
    for p in kb.passages:
        d = docs.setdefault(p.doc_id, {"doc_id": p.doc_id, "title": p.doc_title, "tags": list(p.tags), "sections": []})
        d["sections"].append({"ref": p.ref, "section": p.section, "text": p.text})
    return list(docs.values())


# ----------------------------------------------------------------------------- dashboard
@router.get("/api/dashboard")
def dashboard(s: Session = Depends(get_db)) -> dict[str, Any]:
    by_status = dict(s.execute(select(Analysis.status, func.count()).group_by(Analysis.status)).all())
    by_hazard = dict(s.execute(select(Analysis.hazard, func.count()).group_by(Analysis.hazard)).all())
    by_mode = dict(s.execute(select(Analysis.mode, func.count()).group_by(Analysis.mode)).all())
    done = s.scalars(select(Analysis).where(Analysis.status.in_(("completed", "completed_with_warnings", "needs_review")))
                     .order_by(Analysis.created_at.desc()).limit(500)).all()
    real_done = [a for a in done if a.mode == "real"]

    def total(key: str, rows: list[Analysis]) -> float:
        return round(sum(((a.summary or {}).get(key) or 0) for a in rows), 2)

    cats = dict(s.execute(select(func.coalesce(PriorityCell.override_category, PriorityCell.category), func.count())
                          .group_by(func.coalesce(PriorityCell.override_category, PriorityCell.category))).all())
    n_cells = sum(cats.values())
    overrides = s.scalar(select(func.count()).select_from(PriorityCell).where(PriorityCell.override_category.is_not(None))) or 0
    tool_rows = dict(s.execute(select(ToolCall.status, func.count()).group_by(ToolCall.status)).all())
    executed = tool_rows.get("ok", 0) + tool_rows.get("error", 0)
    reviewed_alerts = dict(s.execute(select(Alert.status, func.count()).group_by(Alert.status)).all())
    decided = sum(v for k, v in reviewed_alerts.items() if k in ("approved", "published", "rejected"))
    escalated = sum(1 for a in done if (a.summary or {}).get("escalations"))
    resolved_reviews = s.scalars(select(ReviewTask).where(ReviewTask.status == "resolved")).all()
    latencies = sorted((a.summary or {}).get("duration_s") or 0 for a in done)
    recent = s.scalars(select(Analysis).order_by(Analysis.created_at.desc()).limit(8)).all()
    activity = s.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(12)).all()
    from aegis.api.routes_analyses import analysis_brief

    return {
        "analyses": {"total": sum(by_status.values()), "by_status": by_status, "by_hazard": by_hazard, "by_mode": by_mode,
                     "running": by_status.get("running", 0) + by_status.get("queued", 0)},
        "impact_real": {"analyses": len(real_done), "affected_area_km2": total("affected_area_km2", real_done),
                        "population_exposed": int(total("population_exposed", real_done)),
                        "facilities_inside": int(total("facilities_inside", real_done))},
        "priority_distribution": {c: cats.get(c, 0) for c in ("Critical", "High", "Moderate", "Low")},
        "review": {"open_tasks": s.scalar(select(func.count()).select_from(ReviewTask).where(ReviewTask.status == "open")) or 0,
                   "alerts_pending": reviewed_alerts.get("pending_review", 0), "alerts_by_status": reviewed_alerts},
        "agent_metrics": {
            "tool_calls": sum(tool_rows.values()), "tool_success_rate": round(tool_rows.get("ok", 0) / executed, 4) if executed else None,
            "tool_status": tool_rows,
            "escalation_rate": round(escalated / len(done), 4) if done else None,
            "priority_override_rate": round(overrides / n_cells, 4) if n_cells else None,
            "alert_rejection_rate": round(reviewed_alerts.get("rejected", 0) / decided, 4) if decided else None,
            "review_false_positive_rate": round(sum(1 for r in resolved_reviews if r.decision == "false_positive") / len(resolved_reviews), 4)
            if resolved_reviews else None,
            "median_latency_s": latencies[len(latencies) // 2] if latencies else None,
            "p90_latency_s": latencies[int(len(latencies) * 0.9)] if latencies else None,
        },
        "recent": [analysis_brief(a) for a in recent],
        "activity": [{"actor": x.actor, "action": x.action, "entity_type": x.entity_type, "entity_id": x.entity_id,
                      "at": x.created_at.isoformat()} for x in activity],
        "generated_at": datetime.now(UTC).isoformat(),
    }
