"""Structured JSON logging with request / analysis correlation IDs."""

from __future__ import annotations

import contextvars
import json
import logging
import sys
from datetime import UTC, datetime

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)
analysis_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("analysis_id", default=None)

_RESERVED = set(vars(logging.LogRecord("x", 0, "x", 0, "x", None, None)).keys()) | {"message", "asctime"}
_SECRET_HINTS = ("token", "key", "secret", "password", "authorization")


def _redact(key: str, value: object) -> object:
    if any(h in key.lower() for h in _SECRET_HINTS):
        return "***"
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        rid, aid = request_id_var.get(), analysis_id_var.get()
        if rid:
            payload["request_id"] = rid
        if aid:
            payload["analysis_id"] = aid
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = _redact(key, value)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


_configured = False


def configure_logging(level: str = "INFO") -> None:
    global _configured
    if _configured:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for noisy in ("rasterio", "urllib3", "httpx", "httpcore", "matplotlib", "PIL", "fiona"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    _configured = True
