"""Prometheus metrics shared across the application (exposed at ``/metrics``)."""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram

REGISTRY = CollectorRegistry(auto_describe=True)

HTTP_OUT_REQUESTS = Counter(
    "aegis_external_requests_total",
    "Outbound requests to external data sources",
    ["source", "outcome"],  # outcome: ok | http_error | network_error | cache_hit | stale_served | circuit_open | offline
    registry=REGISTRY,
)
HTTP_OUT_LATENCY = Histogram(
    "aegis_external_request_seconds",
    "Latency of outbound requests",
    ["source"],
    buckets=(0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 40, 80),
    registry=REGISTRY,
)
API_REQUESTS = Counter(
    "aegis_api_requests_total", "Inbound API requests", ["method", "route", "status"], registry=REGISTRY
)
API_LATENCY = Histogram(
    "aegis_api_request_seconds",
    "Inbound API request latency",
    ["method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
    registry=REGISTRY,
)
TOOL_CALLS = Counter("aegis_agent_tool_calls_total", "Agent tool calls", ["tool", "status"], registry=REGISTRY)
TOOL_LATENCY = Histogram(
    "aegis_agent_tool_seconds",
    "Agent tool call latency",
    ["tool"],
    buckets=(0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300),
    registry=REGISTRY,
)
ANALYSES = Counter("aegis_analyses_total", "Completed analysis runs by final status", ["status"], registry=REGISTRY)
ANALYSIS_DURATION = Histogram(
    "aegis_analysis_seconds",
    "End-to-end analysis duration",
    buckets=(5, 10, 20, 30, 60, 120, 240, 480, 900, 1800),
    registry=REGISTRY,
)
GUARDRAIL_OUTCOMES = Counter(
    "aegis_guardrail_outcomes_total", "Guardrail evaluations", ["guardrail", "outcome"], registry=REGISTRY
)
JOBS_RUNNING = Gauge("aegis_jobs_running", "Analysis jobs currently executing", registry=REGISTRY)
