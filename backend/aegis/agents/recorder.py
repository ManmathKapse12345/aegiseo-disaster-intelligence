"""Persists the agent's decision trace (steps, tool calls, guardrails) and progress."""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

import numpy as np

from aegis.db import AgentStep, Analysis, GuardrailCheck, ToolCall, session_scope
from aegis.observability import GUARDRAIL_OUTCOMES, TOOL_CALLS, TOOL_LATENCY

log = logging.getLogger(__name__)


class CancelledError(RuntimeError):
    pass


def jsonable(v: Any, depth: int = 0) -> Any:
    """Compact, JSON-safe representation of tool arguments / results (no raw arrays)."""
    if depth > 4:
        return "..."
    if v is None or isinstance(v, (bool, int, str)):
        return v if not isinstance(v, str) or len(v) < 500 else v[:500] + "..."
    if isinstance(v, float):
        return None if not np.isfinite(v) else round(v, 6)
    if isinstance(v, np.ndarray):
        return f"<array {v.dtype} {list(v.shape)}>"
    if isinstance(v, (np.floating, np.integer)):
        return jsonable(v.item(), depth)
    if isinstance(v, dict):
        return {str(k): jsonable(x, depth + 1) for k, x in list(v.items())[:40]}
    if isinstance(v, (list, tuple, set)):
        items = list(v)
        out = [jsonable(x, depth + 1) for x in items[:25]]
        if len(items) > 25:
            out.append(f"... (+{len(items) - 25})")
        return out
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if hasattr(v, "summary") and callable(v.summary):
        try:
            return jsonable(v.summary(), depth + 1)
        except Exception:  # summary must never break tracing; fall through to the type name
            return f"<{type(v).__name__}>"
    return f"<{type(v).__name__}>"


class TraceRecorder:
    def __init__(self, analysis_id: str | None, persist: bool = True):
        self.analysis_id = analysis_id
        self.persist = persist and analysis_id is not None
        self.seq = 0
        self.tool_seq = 0
        self._lock = threading.Lock()
        self._last_cancel_check = 0.0
        self._cancelled = False
        self.steps: list[dict[str, Any]] = []
        self.tools: list[dict[str, Any]] = []
        self.guardrails: list[dict[str, Any]] = []

    def step(self, phase: str, agent: str, title: str, detail: str | None = None, rationale: str | None = None,
             data: dict[str, Any] | None = None, status: str = "ok", duration_ms: float | None = None) -> None:
        with self._lock:
            self.seq += 1
            rec = {"seq": self.seq, "phase": phase, "agent": agent, "title": title[:300], "detail": detail,
                   "rationale": rationale, "data": jsonable(data) if data else None, "status": status, "duration_ms": duration_ms}
            self.steps.append(rec)
        if self.persist:
            with session_scope() as s:
                s.add(AgentStep(analysis_id=self.analysis_id, **rec))

    def tool(self, agent: str, tool: str, side_effect: str, args: dict[str, Any], status: str, latency_ms: float,
             error: str | None = None, result_summary: Any = None, attempts: int = 1) -> None:
        TOOL_CALLS.labels(tool, status).inc()
        TOOL_LATENCY.labels(tool).observe(latency_ms / 1000)
        with self._lock:
            self.tool_seq += 1
            rec = {"seq": self.tool_seq, "agent": agent, "tool": tool, "side_effect": side_effect, "args": jsonable(args),
                   "status": status, "error": error[:2000] if error else None, "attempts": attempts,
                   "latency_ms": round(latency_ms, 1), "result_summary": jsonable(result_summary)}
            self.tools.append(rec)
        if self.persist:
            with session_scope() as s:
                s.add(ToolCall(analysis_id=self.analysis_id, **rec))

    def guardrail(self, code: str, name: str, stage: str, outcome: str, message: str, value: Any = None,
                  threshold: Any = None) -> None:
        GUARDRAIL_OUTCOMES.labels(code, outcome).inc()
        rec = {"code": code, "name": name, "stage": stage, "outcome": outcome, "message": message,
               "value": jsonable(value), "threshold": jsonable(threshold)}
        with self._lock:
            self.guardrails.append(rec)
        if self.persist:
            with session_scope() as s:
                s.add(GuardrailCheck(analysis_id=self.analysis_id, **rec))

    def progress(self, stage: str, pct: float, message: str | None = None) -> None:
        if not self.persist:
            return
        with session_scope() as s:
            a = s.get(Analysis, self.analysis_id)
            if a is not None:
                a.stage, a.progress = stage, round(float(pct), 3)
                if message:
                    a.message = message[:1000]

    def check_cancel(self) -> None:
        """Cooperative cancellation (DB flag polled at most once per second)."""
        if self._cancelled:
            raise CancelledError("analysis cancelled by user")
        if not self.persist:
            return
        now = time.monotonic()
        if now - self._last_cancel_check < 1.0:
            return
        self._last_cancel_check = now
        with session_scope() as s:
            a = s.get(Analysis, self.analysis_id)
            if a is not None and a.cancel_requested:
                self._cancelled = True
                raise CancelledError("analysis cancelled by user")
