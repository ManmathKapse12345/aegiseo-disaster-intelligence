"""Persistent storage (SQLAlchemy 2.0).

SQLite is the zero-configuration default (WAL mode, foreign keys, busy timeout so the
API and background analysis threads can write concurrently). PostgreSQL is used in the
container deployment; when the PostGIS extension is available, generated geometry
columns with GiST indexes are added so detections and priority cells can be queried
spatially with ``ST_Intersects``. Geometries are always also stored as GeoJSON with
bounding-box columns, so every feature works on both back-ends.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    create_engine,
    event,
    text,
)
from sqlalchemy.engine import Dialect, Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.types import TypeDecorator

from aegis.config import get_settings

log = logging.getLogger(__name__)


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """Timezone-aware UTC timestamps on every back-end.

    SQLite has no timezone type and returns naive values, which clients would read as local
    time; values are normalised to UTC on the way in and tagged as UTC on the way out.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(UTC)
        return value

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class Analysis(Base):
    __tablename__ = "analyses"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200))
    hazard: Mapped[str] = mapped_column(String(32), index=True)
    mode: Mapped[str] = mapped_column(String(16), default="real")  # real | synthetic
    status: Mapped[str] = mapped_column(String(32), index=True, default="queued")
    stage: Mapped[str | None] = mapped_column(String(64), nullable=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    aoi_geojson: Mapped[dict[str, Any]] = mapped_column(JSON)
    min_lon: Mapped[float] = mapped_column(Float)
    min_lat: Mapped[float] = mapped_column(Float)
    max_lon: Mapped[float] = mapped_column(Float)
    max_lat: Mapped[float] = mapped_column(Float)
    area_km2: Mapped[float] = mapped_column(Float)
    event_date: Mapped[date] = mapped_column(Date)
    pre_start: Mapped[date] = mapped_column(Date)
    pre_end: Mapped[date] = mapped_column(Date)
    post_start: Mapped[date] = mapped_column(Date)
    post_end: Mapped[date] = mapped_column(Date)
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    results: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    scenario_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    top_priority: Mapped[str | None] = mapped_column(String(16), nullable=True)
    confidence: Mapped[str | None] = mapped_column(String(16), nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(String(100), default="anonymous")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    __table_args__ = (Index("ix_analyses_bbox", "min_lon", "min_lat", "max_lon", "max_lat"),)


class AgentStep(Base):
    __tablename__ = "agent_steps"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    phase: Mapped[str] = mapped_column(String(24))
    agent: Mapped[str] = mapped_column(String(48))
    title: Mapped[str] = mapped_column(String(300))
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="ok")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)


class ToolCall(Base):
    __tablename__ = "tool_calls"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    analysis_id: Mapped[str | None] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True, nullable=True)
    seq: Mapped[int] = mapped_column(Integer, default=0)
    agent: Mapped[str] = mapped_column(String(48), default="")
    tool: Mapped[str] = mapped_column(String(64), index=True)
    side_effect: Mapped[str] = mapped_column(String(24))
    args: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), index=True)  # ok | error | blocked | degraded
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    result_summary: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)


class GuardrailCheck(Base):
    __tablename__ = "guardrail_checks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(120))
    stage: Mapped[str] = mapped_column(String(24))
    outcome: Mapped[str] = mapped_column(String(16), index=True)  # pass | warn | escalate | block
    message: Mapped[str] = mapped_column(Text)
    value: Mapped[Any] = mapped_column(JSON, nullable=True)
    threshold: Mapped[Any] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Observation(Base):
    __tablename__ = "observations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    sensor: Mapped[str] = mapped_column(String(8))
    role: Mapped[str] = mapped_column(String(8))
    acquired_at: Mapped[datetime] = mapped_column(UTCDateTime())
    collection: Mapped[str] = mapped_column(String(64))
    item_ids: Mapped[list[Any]] = mapped_column(JSON)
    cloud_fraction: Mapped[float | None] = mapped_column(Float, nullable=True)
    valid_fraction: Mapped[float] = mapped_column(Float)
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class Detection(Base):
    __tablename__ = "detections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    hazard: Mapped[str] = mapped_column(String(32))
    geometry: Mapped[dict[str, Any]] = mapped_column(JSON)
    min_lon: Mapped[float] = mapped_column(Float)
    min_lat: Mapped[float] = mapped_column(Float)
    max_lon: Mapped[float] = mapped_column(Float)
    max_lat: Mapped[float] = mapped_column(Float)
    area_km2: Mapped[float] = mapped_column(Float)
    mean_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    mean_uncertainty: Mapped[float | None] = mapped_column(Float, nullable=True)
    agreement: Mapped[float | None] = mapped_column(Float, nullable=True)
    props: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    __table_args__ = (Index("ix_detections_bbox", "min_lon", "min_lat", "max_lon", "max_lat"),)


class PriorityCell(Base):
    __tablename__ = "priority_cells"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    cell_id: Mapped[str] = mapped_column(String(24))
    rank: Mapped[int] = mapped_column(Integer)
    score: Mapped[float] = mapped_column(Float)
    category: Mapped[str] = mapped_column(String(16), index=True)
    confidence: Mapped[str] = mapped_column(String(16))
    confidence_score: Mapped[float] = mapped_column(Float)
    geometry: Mapped[dict[str, Any]] = mapped_column(JSON)
    centroid_lon: Mapped[float] = mapped_column(Float)
    centroid_lat: Mapped[float] = mapped_column(Float)
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    override_category: Mapped[str | None] = mapped_column(String(16), nullable=True)
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    overridden_by: Mapped[str | None] = mapped_column(String(100), nullable=True)


class ExposedFeature(Base):
    __tablename__ = "exposed_features"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    feature_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    category: Mapped[str] = mapped_column(String(32))
    name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    lon: Mapped[float] = mapped_column(Float)
    lat: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16))
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    tags: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    cell_id: Mapped[str | None] = mapped_column(String(24), nullable=True)
    severity: Mapped[str] = mapped_column(String(16), index=True)
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list[Any]] = mapped_column(JSON, default=list)
    grounding: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(String(24), index=True, default="pending_review")
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=True)
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    delivery: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)


class ReviewTask(Base):
    __tablename__ = "review_tasks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    alert_id: Mapped[str | None] = mapped_column(ForeignKey("alerts.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(300))
    reason: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), index=True, default="open")
    decision: Mapped[str | None] = mapped_column(String(24), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    analysis_id: Mapped[str] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    filename: Mapped[str] = mapped_column(String(200))
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)


class BenchmarkRun(Base):
    __tablename__ = "benchmark_runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    suite: Mapped[str] = mapped_column(String(64))
    summary: Mapped[dict[str, Any]] = mapped_column(JSON)
    results: Mapped[list[Any]] = mapped_column(JSON)
    duration_s: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, index=True)


# ----------------------------------------------------------------------------- engine/session
_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None
POSTGIS_AVAILABLE = False


def _sqlite_pragmas(dbapi_conn, _record) -> None:  # pragma: no cover - trivial
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=30000")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


def get_engine() -> Engine:
    global _engine, _SessionLocal
    if _engine is None:
        url = get_settings().sqlalchemy_url
        if url.startswith("sqlite"):
            _engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30}, pool_pre_ping=True)
            event.listen(_engine, "connect", _sqlite_pragmas)
        else:
            _engine = create_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=20, pool_recycle=1800)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def reset_engine() -> None:
    global _engine, _SessionLocal, POSTGIS_AVAILABLE
    if _engine is not None:
        _engine.dispose()
    _engine, _SessionLocal, POSTGIS_AVAILABLE = None, None, False


def init_db() -> None:
    global POSTGIS_AVAILABLE
    engine = get_engine()
    Base.metadata.create_all(engine)
    if engine.dialect.name == "postgresql":
        try:
            with engine.begin() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
                for table in ("detections", "priority_cells"):
                    conn.execute(text(
                        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS geom geometry(Geometry, 4326) "
                        f"GENERATED ALWAYS AS (ST_SetSRID(ST_GeomFromGeoJSON(geometry::text), 4326)) STORED"))
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_geom ON {table} USING GIST (geom)"))
            POSTGIS_AVAILABLE = True
            log.info("PostGIS spatial columns enabled")
        except Exception as exc:  # extension not installed / insufficient privilege
            log.warning("PostGIS unavailable; using bbox + shapely spatial filtering", extra={"error": str(exc)[:300]})


@contextmanager
def session_scope() -> Iterator[Session]:
    get_engine()
    assert _SessionLocal is not None
    s = _SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency."""
    get_engine()
    assert _SessionLocal is not None
    s = _SessionLocal()
    try:
        yield s
    finally:
        s.close()


def audit(session: Session, actor: str, action: str, entity_type: str, entity_id: str | None, **details: Any) -> None:
    session.add(AuditLog(actor=actor, action=action, entity_type=entity_type, entity_id=entity_id, details=details or None))
