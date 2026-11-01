"""Tool registry and safe execution.

Every action the agent takes goes through :class:`ToolExecutor`, which enforces:

* an allow-list (unknown tools are blocked),
* a side-effect policy: ``read_only`` and ``compute`` tools run freely, ``write_draft`` tools
  may only create internal drafts (alerts pending review, review tasks, reports), and
  ``external`` tools (outbound notifications) are blocked unless a human approval token
  is supplied - the autonomous agent never holds one,
* a per-run call budget,
* cooperative cancellation,
* full tracing (arguments, status, latency, attempts, compact result summary).
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from aegis.agents.recorder import TraceRecorder


class SideEffect(StrEnum):
    READ_ONLY = "read_only"
    COMPUTE = "compute"
    WRITE_DRAFT = "write_draft"
    EXTERNAL = "external"


class ToolBlockedError(RuntimeError):
    pass


class ToolFailedError(RuntimeError):
    def __init__(self, tool: str, cause: BaseException):
        super().__init__(f"{tool} failed: {type(cause).__name__}: {cause}")
        self.tool = tool
        self.cause = cause


@dataclass
class Tool:
    name: str
    description: str
    side_effect: SideEffect
    fn: Callable[..., Any]
    summarize: Callable[[Any], Any] | None = None
    passthrough: tuple[type[BaseException], ...] = ()  # domain exceptions re-raised unchanged


@dataclass
class ToolPolicy:
    allowed: frozenset[SideEffect] = frozenset({SideEffect.READ_ONLY, SideEffect.COMPUTE, SideEffect.WRITE_DRAFT})
    max_calls: int = 120


@dataclass
class ToolStats:
    calls: int = 0
    ok: int = 0
    errors: int = 0
    blocked: int = 0
    latency_ms: float = 0.0
    by_tool: dict[str, dict[str, int]] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        executed = self.ok + self.errors
        return {"calls": self.calls, "ok": self.ok, "errors": self.errors, "blocked": self.blocked,
                "success_rate": round(self.ok / executed, 4) if executed else None,
                "total_latency_ms": round(self.latency_ms, 1), "by_tool": self.by_tool}


class ToolExecutor:
    def __init__(self, tools: list[Tool], recorder: TraceRecorder, policy: ToolPolicy | None = None):
        self.tools = {t.name: t for t in tools}
        self.recorder = recorder
        self.policy = policy or ToolPolicy()
        self.stats = ToolStats()

    def describe(self) -> list[dict[str, str]]:
        return [{"name": t.name, "side_effect": t.side_effect.value, "description": t.description} for t in self.tools.values()]

    def _bump(self, name: str, key: str) -> None:
        self.stats.by_tool.setdefault(name, {"ok": 0, "error": 0, "blocked": 0})[key] += 1

    def call(self, agent: str, name: str, *, approval: str | None = None, **kwargs: Any) -> Any:
        self.stats.calls += 1
        tool = self.tools.get(name)
        if tool is None:
            self.stats.blocked += 1
            self.recorder.tool(agent, name, "unknown", kwargs, "blocked", 0.0, error="tool is not on the allow-list")
            raise ToolBlockedError(f"tool {name!r} is not registered")
        if tool.side_effect not in self.policy.allowed and not (tool.side_effect == SideEffect.EXTERNAL and approval):
            self.stats.blocked += 1
            self._bump(name, "blocked")
            self.recorder.tool(agent, name, tool.side_effect.value, kwargs, "blocked", 0.0,
                               error=f"side effect '{tool.side_effect.value}' requires human approval")
            raise ToolBlockedError(f"tool {name!r} requires human approval")
        if self.stats.calls > self.policy.max_calls:
            self.stats.blocked += 1
            self._bump(name, "blocked")
            self.recorder.tool(agent, name, tool.side_effect.value, kwargs, "blocked", 0.0, error="tool-call budget exhausted")
            raise ToolBlockedError("tool-call budget exhausted")
        self.recorder.check_cancel()
        t0 = time.perf_counter()
        try:
            value = tool.fn(**kwargs)
        except tool.passthrough as exc:
            ms = (time.perf_counter() - t0) * 1000
            self.stats.errors += 1
            self.stats.latency_ms += ms
            self._bump(name, "error")
            self.recorder.tool(agent, name, tool.side_effect.value, kwargs, "error", ms, error=f"{type(exc).__name__}: {exc}")
            raise
        except Exception as exc:
            ms = (time.perf_counter() - t0) * 1000
            self.stats.errors += 1
            self.stats.latency_ms += ms
            self._bump(name, "error")
            self.recorder.tool(agent, name, tool.side_effect.value, kwargs, "error", ms, error=f"{type(exc).__name__}: {exc}")
            raise ToolFailedError(name, exc) from exc
        ms = (time.perf_counter() - t0) * 1000
        self.stats.ok += 1
        self.stats.latency_ms += ms
        self._bump(name, "ok")
        summary = tool.summarize(value) if tool.summarize else None
        self.recorder.tool(agent, name, tool.side_effect.value, kwargs, "ok", ms, result_summary=summary)
        return value
