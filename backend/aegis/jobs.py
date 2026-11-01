"""Background execution of analysis runs.

Runs execute on a bounded thread pool (NumPy, GDAL and PyTorch release the GIL for the
heavy work). The database row is the source of truth for status and progress; on start-up
runs that were executing when the process stopped are marked ``interrupted`` and runs
still ``queued`` are re-submitted, so no job is silently lost.
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import date
from typing import Any

from sqlalchemy import select

from aegis.agents.orchestrator import AgentOrchestrator, RunConfig
from aegis.agents.toolbox import Services
from aegis.analysis.hazards import DetectionParams
from aegis.analysis.prioritize import PriorityWeights
from aegis.config import get_settings
from aegis.db import Analysis, session_scope, utcnow
from aegis.geo.aoi import AOI
from aegis.logging_config import analysis_id_var
from aegis.synthetic import SyntheticConfig

log = logging.getLogger(__name__)


def run_config_from_row(a: Analysis) -> RunConfig:
    p = a.params or {}
    synthetic = None
    if a.mode == "synthetic":
        sp = p.get("synthetic") or {}
        synthetic = SyntheticConfig(hazard=a.hazard, **{k: v for k, v in sp.items() if k in SyntheticConfig.__dataclass_fields__ and k != "hazard"})
    return RunConfig(
        analysis_id=a.id, name=a.name, hazard=a.hazard, aoi=AOI.from_geojson(a.aoi_geojson), event_date=a.event_date,
        pre_window=(a.pre_start, a.pre_end), post_window=(a.post_start, a.post_end), mode=a.mode,
        resolution_m=float(p.get("resolution_m", get_settings().default_resolution_m)),
        weights=PriorityWeights(**(p.get("weights") or {})),
        detection=DetectionParams(**(p.get("detection") or {})),
        synthetic=synthetic,
        fail_tools=set(p.get("fail_tools") or []) if a.mode == "synthetic" else set(),
    )


class JobManager:
    def __init__(self, workers: int | None = None):
        self.settings = get_settings()
        self.pool = ThreadPoolExecutor(max_workers=workers or self.settings.worker_threads, thread_name_prefix="analysis")
        self.futures: dict[str, Future] = {}
        self._services: Services | None = None
        self._lock = threading.Lock()

    @property
    def services(self) -> Services:
        with self._lock:
            if self._services is None:
                self._services = Services.default(self.settings)
            return self._services

    def submit(self, analysis_id: str) -> None:
        with self._lock:
            fut = self.futures.get(analysis_id)
            if fut is not None and not fut.done():
                return
            self.futures[analysis_id] = self.pool.submit(self._run, analysis_id)

    def _run(self, analysis_id: str) -> dict[str, Any] | None:
        token = analysis_id_var.set(analysis_id)
        try:
            with session_scope() as s:
                a = s.get(Analysis, analysis_id)
                if a is None or a.status not in ("queued", "interrupted"):
                    return None
                if a.cancel_requested:
                    a.status, a.completed_at, a.message = "cancelled", utcnow(), "cancelled before start"
                    return None
                cfg = run_config_from_row(a)
            out = AgentOrchestrator(cfg, self.services).run()
            return out.summary
        except Exception as exc:  # last line of defence: never leave a row "running"
            log.exception("analysis job crashed")
            with session_scope() as s:
                a = s.get(Analysis, analysis_id)
                if a is not None:
                    a.status, a.error, a.completed_at = "failed", f"{type(exc).__name__}: {exc}", utcnow()
            return None
        finally:
            analysis_id_var.reset(token)

    def recover(self) -> dict[str, int]:
        interrupted = requeued = 0
        with session_scope() as s:
            for a in s.scalars(select(Analysis).where(Analysis.status == "running")):
                a.status, a.message = "interrupted", "process restarted while running; use re-run to execute again"
                interrupted += 1
            queued = [a.id for a in s.scalars(select(Analysis).where(Analysis.status == "queued"))]
        for aid in queued:
            self.submit(aid)
            requeued += 1
        return {"interrupted": interrupted, "requeued": requeued}

    def active(self) -> int:
        return sum(1 for f in self.futures.values() if not f.done())

    def shutdown(self) -> None:
        self.pool.shutdown(wait=False, cancel_futures=True)


_manager: JobManager | None = None


def get_job_manager() -> JobManager:
    global _manager
    if _manager is None:
        _manager = JobManager()
    return _manager


def reset_job_manager() -> None:
    global _manager
    if _manager is not None:
        _manager.shutdown()
    _manager = None


def default_windows(event: date, today: date) -> tuple[tuple[date, date], tuple[date, date]]:
    from datetime import timedelta

    pre = (event - timedelta(days=45), event - timedelta(days=1))
    post = (event, min(today, event + timedelta(days=12)))
    return pre, post
