"""FastAPI application factory.

    uvicorn aegis.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from aegis import __version__
from aegis.api import routes_analyses, routes_review, routes_system
from aegis.api.deps import RateLimiter, require
from aegis.config import REPO_ROOT, get_settings
from aegis.db import init_db
from aegis.jobs import get_job_manager, reset_job_manager
from aegis.logging_config import configure_logging, request_id_var
from aegis.observability import API_LATENCY, API_REQUESTS

log = logging.getLogger("aegis.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings = get_settings()
    init_db()
    recovered = get_job_manager().recover()
    log.info("startup", extra={"version": __version__, "env": settings.environment, "db": settings.sqlalchemy_url.split(":")[0],
                               "recovered": recovered, "auth": settings.auth_enabled, "offline": settings.offline})

    def warm() -> None:  # load the model and knowledge base in the background
        try:
            svc = get_job_manager().services
            svc.segmenter.load()
            _ = svc.kb
        except Exception:
            log.exception("warm-up failed")

    threading.Thread(target=warm, daemon=True, name="warmup").start()
    yield
    reset_job_manager()  # shut the pool down and let a later app instance start a fresh one


# Same page policy that nginx sends in the compose deployment; applied when the API serves the UI itself.
PAGE_CSP = ("default-src 'self'; img-src 'self' data: blob: https://tiles.maps.eox.at https://tiles.openfreemap.org; "
            "connect-src 'self' https://tiles.openfreemap.org https://tiles.maps.eox.at; worker-src 'self' blob:; "
            "style-src 'self' 'unsafe-inline'; font-src 'self' data: https://tiles.openfreemap.org; script-src 'self'")
NO_FRAMING = "'none'"


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="AegisEO API", version=__version__, lifespan=lifespan,
                  description="Agentic multi-sensor disaster change detection and response prioritisation.")
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False,
                       allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])
    limiter = RateLimiter(settings.rate_limit_per_minute)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        token = request_id_var.set(rid)
        t0 = time.perf_counter()
        route = request.url.path
        try:
            if request.method in ("POST", "PATCH", "DELETE"):
                ok, retry = limiter.allow(request.client.host if request.client else "unknown")
                if not ok:
                    return JSONResponse({"error": {"code": "rate_limited", "message": "too many requests", "request_id": rid}},
                                        status_code=429, headers={"Retry-After": str(int(retry) + 1)})
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        r = request.scope.get("route")
        route = getattr(r, "path", route)
        dt = time.perf_counter() - t0
        API_REQUESTS.labels(request.method, route, str(response.status_code)).inc()
        API_LATENCY.labels(request.method, route).observe(dt)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        ancestors = settings.frame_ancestors.strip()
        if not route.startswith("/api"):
            response.headers["Content-Security-Policy"] = f"{PAGE_CSP}; frame-ancestors {ancestors or NO_FRAMING}"
        if not ancestors:
            response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if route.startswith("/api") and response.status_code >= 500:
            log.error("request failed", extra={"method": request.method, "route": route, "status": response.status_code})
        elif not route.startswith(("/api/analyses/{aid}/status", "/api/health")):
            log.info("request", extra={"method": request.method, "route": route, "status": response.status_code,
                                       "ms": round(dt * 1000, 1)})
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        return JSONResponse({"error": {"code": exc.status_code, "message": exc.detail, "request_id": request_id_var.get()}},
                            status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        details = [{"field": ".".join(str(p) for p in e.get("loc", [])[1:]), "message": e.get("msg")} for e in exc.errors()]
        return JSONResponse({"error": {"code": 422, "message": "invalid request", "details": details,
                                       "request_id": request_id_var.get()}}, status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("unhandled error")
        return JSONResponse({"error": {"code": 500, "message": "internal error", "request_id": request_id_var.get()}}, status_code=500)

    app.include_router(routes_system.router)
    app.include_router(routes_analyses.router)
    app.include_router(routes_review.router)
    app.include_router(benchmark_router())

    # Serve a built frontend (single-process deployment) when available.
    dist = REPO_ROOT / "frontend" / "dist"
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
        async def spa(path: str):
            target = (dist / path).resolve()
            if path and target.is_file() and dist.resolve() in target.parents:
                return FileResponse(target)
            if path.startswith("api/"):
                raise HTTPException(404, "not found")
            return FileResponse(dist / "index.html")

    return app


def benchmark_router():
    from fastapi import APIRouter, Depends
    from sqlalchemy import select

    from aegis.api.schemas import BenchmarkRequest
    from aegis.db import BenchmarkRun, get_db

    router = APIRouter(prefix="/api/benchmarks", tags=["benchmarks"])
    state = {"running": False, "last_error": None}

    @router.get("")
    def list_runs(s=Depends(get_db)):
        rows = s.scalars(select(BenchmarkRun).order_by(BenchmarkRun.created_at.desc()).limit(20)).all()
        return {"running": state["running"], "last_error": state["last_error"], "items": [
            {"id": r.id, "suite": r.suite, "summary": r.summary, "duration_s": r.duration_s, "created_at": r.created_at.isoformat()}
            for r in rows]}

    @router.get("/{run_id}")
    def get_run(run_id: str, s=Depends(get_db)):
        r = s.get(BenchmarkRun, run_id)
        if r is None:
            raise HTTPException(404, "benchmark run not found")
        return {"id": r.id, "suite": r.suite, "summary": r.summary, "results": r.results, "duration_s": r.duration_s,
                "created_at": r.created_at.isoformat()}

    @router.post("/run", status_code=202)
    def run(body: BenchmarkRequest, who=Depends(require("admin"))):
        if state["running"]:
            raise HTTPException(409, "a benchmark is already running")

        def work() -> None:
            from aegis.benchmark import run_suite

            state["running"], state["last_error"] = True, None
            try:
                run_suite(body.suite, get_job_manager().services)
            except Exception as exc:
                state["last_error"] = f"{type(exc).__name__}: {exc}"[:300]
                log.exception("benchmark failed")
            finally:
                state["running"] = False

        threading.Thread(target=work, daemon=True, name="benchmark").start()
        return {"started": True, "suite": body.suite}

    return router


app = create_app()


def run() -> None:  # console entry point
    import uvicorn

    uvicorn.run("aegis.main:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    run()


__all__ = ["app", "create_app", "Path"]
