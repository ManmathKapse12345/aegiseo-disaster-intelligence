"""Resilient HTTP access to external data sources.

Every outbound request in the application goes through :class:`ResilientHttpClient`,
which provides:

* explicit connect/read timeouts,
* bounded retries with exponential back-off and full jitter (honouring ``Retry-After``),
* a per-source circuit breaker so a failing provider is not hammered and does not
  stall analysis runs,
* an on-disk response cache with TTL and *stale-if-error* fallback - when a source
  is down, the last good response is served and explicitly flagged as stale,
* an offline mode that never touches the network,
* provenance records (URL with secrets stripped, fetch time, cache status).
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from aegis.config import Settings, get_settings
from aegis.observability import HTTP_OUT_LATENCY, HTTP_OUT_REQUESTS

log = logging.getLogger(__name__)

RETRY_STATUS = {429, 500, 502, 503, 504}
_SENSITIVE_PARAMS = {"key", "api_key", "apikey", "map_key", "token", "sig", "se", "st", "sp", "sv", "sr", "skoid",
                     "sktid", "skt", "ske", "sks", "skv", "spr", "srt", "ss"}


class SourceUnavailableError(RuntimeError):
    """Raised when a source cannot provide data (network down, circuit open, offline, HTTP error)."""

    def __init__(self, source: str, reason: str, status_code: int | None = None):
        super().__init__(f"{source}: {reason}")
        self.source = source
        self.reason = reason
        self.status_code = status_code


def redact_url(url: str) -> str:
    """Strip credential-like query parameters (SAS tokens, API keys) from a URL."""
    parts = urlsplit(url)
    if not parts.query:
        return url
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k.lower() not in _SENSITIVE_PARAMS]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment))


@dataclass
class FetchResult:
    source: str
    url: str
    status_code: int
    content: bytes
    headers: dict[str, str]
    fetched_at: datetime
    elapsed_ms: float
    from_cache: bool = False
    stale: bool = False
    attempts: int = 1

    def json(self) -> Any:
        return json.loads(self.content.decode("utf-8"))

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def provenance(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "url": redact_url(self.url),
            "fetched_at": self.fetched_at.isoformat(),
            "from_cache": self.from_cache,
            "stale": self.stale,
            "status_code": self.status_code,
        }


# ----------------------------------------------------------------------------- circuit breaker
@dataclass
class CircuitBreaker:
    failure_threshold: int = 4
    reset_after_s: float = 60.0
    failures: int = 0
    opened_at: float | None = None
    last_error: str | None = None
    last_success_at: float | None = None
    last_failure_at: float | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    @property
    def state(self) -> str:
        if self.opened_at is None:
            return "closed"
        if time.monotonic() - self.opened_at >= self.reset_after_s:
            return "half_open"
        return "open"

    def allow(self) -> bool:
        return self.state != "open"

    def record_success(self) -> None:
        with self._lock:
            self.failures = 0
            self.opened_at = None
            self.last_success_at = time.time()

    def record_failure(self, error: str) -> None:
        with self._lock:
            self.failures += 1
            self.last_error = error[:300]
            self.last_failure_at = time.time()
            if self.failures >= self.failure_threshold or self.state == "half_open":
                self.opened_at = time.monotonic()

    def snapshot(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "consecutive_failures": self.failures,
            "last_error": self.last_error,
            "last_success_at": self.last_success_at,
            "last_failure_at": self.last_failure_at,
        }


_BREAKERS: dict[str, CircuitBreaker] = {}
_BREAKERS_LOCK = threading.Lock()


def get_breaker(source: str) -> CircuitBreaker:
    with _BREAKERS_LOCK:
        if source not in _BREAKERS:
            _BREAKERS[source] = CircuitBreaker()
        return _BREAKERS[source]


def breaker_snapshots() -> dict[str, dict[str, Any]]:
    with _BREAKERS_LOCK:
        return {k: v.snapshot() for k, v in _BREAKERS.items()}


def reset_breakers() -> None:
    with _BREAKERS_LOCK:
        _BREAKERS.clear()


# ----------------------------------------------------------------------------- cache
class HttpCache:
    """Simple content-addressed file cache: ``<dir>/<source>/<k[:2]>/<k>.bin`` + ``.json`` metadata."""

    def __init__(self, root: Path):
        self.root = root

    @staticmethod
    def make_key(method: str, url: str, params: dict | None, body: bytes | None) -> str:
        h = hashlib.sha256()
        h.update(method.upper().encode())
        h.update(url.encode())
        if params:
            h.update(json.dumps(sorted((str(k), str(v)) for k, v in params.items())).encode())
        if body:
            h.update(body)
        return h.hexdigest()

    def _paths(self, source: str, key: str) -> tuple[Path, Path]:
        # source ids such as "overpass:overpass-api.de" contain characters that are illegal in Windows paths
        safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in source)
        base = self.root / safe / key[:2]
        return base / f"{key}.bin", base / f"{key}.json"

    def get(self, source: str, key: str) -> tuple[FetchResult | None, float]:
        """Return (cached result, age in seconds) or (None, inf)."""
        bin_path, meta_path = self._paths(source, key)
        if not (bin_path.exists() and meta_path.exists()):
            return None, float("inf")
        try:
            meta = json.loads(meta_path.read_text("utf-8"))
            content = bin_path.read_bytes()
        except (OSError, ValueError):
            return None, float("inf")
        fetched_at = datetime.fromisoformat(meta["fetched_at"])
        age = (datetime.now(UTC) - fetched_at).total_seconds()
        res = FetchResult(
            source=source,
            url=meta["url"],
            status_code=meta["status_code"],
            content=content,
            headers=meta.get("headers", {}),
            fetched_at=fetched_at,
            elapsed_ms=0.0,
            from_cache=True,
        )
        return res, age

    def put(self, key: str, res: FetchResult) -> None:
        bin_path, meta_path = self._paths(res.source, key)
        try:
            bin_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = bin_path.with_suffix(".tmp")
            tmp.write_bytes(res.content)
            tmp.replace(bin_path)
            meta = {
                "url": redact_url(res.url),
                "status_code": res.status_code,
                "fetched_at": res.fetched_at.isoformat(),
                "headers": {k: v for k, v in res.headers.items() if k.lower() in ("content-type", "last-modified", "etag")},
            }
            meta_path.write_text(json.dumps(meta), "utf-8")
        except OSError as exc:  # cache failures must never break a request
            log.warning("http cache write failed", extra={"error": str(exc)})


# ----------------------------------------------------------------------------- client
class ResilientHttpClient:
    def __init__(
        self,
        source: str,
        *,
        settings: Settings | None = None,
        timeout_s: float | None = None,
        retries: int | None = None,
        backoff_base_s: float = 0.8,
        max_backoff_s: float = 20.0,
        cache_ttl_s: float = 3600.0,
        transport: httpx.BaseTransport | None = None,
    ):
        self.settings = settings or get_settings()
        self.source = source
        self.timeout_s = timeout_s or self.settings.http_timeout_s
        self.retries = self.settings.http_retries if retries is None else retries
        self.backoff_base_s = backoff_base_s
        self.max_backoff_s = max_backoff_s
        self.cache_ttl_s = cache_ttl_s
        self.cache = HttpCache(self.settings.cache_dir / "http")
        self.breaker = get_breaker(source)
        self._transport = transport

    def _client(self, timeout: float) -> httpx.Client:
        return httpx.Client(
            timeout=httpx.Timeout(timeout, connect=min(10.0, timeout)),
            headers={"User-Agent": self.settings.user_agent},
            follow_redirects=True,
            transport=self._transport,
        )

    def request(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | str | None = None,
        headers: dict[str, str] | None = None,
        cache_ttl_s: float | None = None,
        timeout_s: float | None = None,
        use_cache: bool = True,
    ) -> FetchResult:
        ttl = self.cache_ttl_s if cache_ttl_s is None else cache_ttl_s
        body = data.encode() if isinstance(data, str) else (urlencode(data).encode() if isinstance(data, dict) else None)
        key = HttpCache.make_key(method, url, params, body)
        cached, age = self.cache.get(self.source, key) if use_cache else (None, float("inf"))

        if cached is not None and age <= ttl:
            HTTP_OUT_REQUESTS.labels(self.source, "cache_hit").inc()
            return cached

        def _stale_or_raise(reason: str, status: int | None = None) -> FetchResult:
            if cached is not None:
                HTTP_OUT_REQUESTS.labels(self.source, "stale_served").inc()
                log.warning("serving stale cache", extra={"source": self.source, "reason": reason, "age_s": round(age)})
                cached.stale = True
                return cached
            raise SourceUnavailableError(self.source, reason, status)

        if self.settings.offline:
            HTTP_OUT_REQUESTS.labels(self.source, "offline").inc()
            return _stale_or_raise("offline mode enabled and no cached response available")
        if not self.breaker.allow():
            HTTP_OUT_REQUESTS.labels(self.source, "circuit_open").inc()
            return _stale_or_raise(f"circuit open after repeated failures ({self.breaker.last_error})")

        timeout = timeout_s or self.timeout_s
        last_error = "unknown error"
        last_status: int | None = None
        attempts = 0
        with self._client(timeout) as client:
            for attempt in range(self.retries + 1):
                attempts = attempt + 1
                start = time.perf_counter()
                try:
                    resp = client.request(method, url, params=params, content=body, headers={
                        **({"Content-Type": "application/x-www-form-urlencoded"} if isinstance(data, dict) else {}),
                        **(headers or {}),
                    })
                    elapsed = time.perf_counter() - start
                    HTTP_OUT_LATENCY.labels(self.source).observe(elapsed)
                    if resp.status_code < 400:
                        result = FetchResult(
                            source=self.source,
                            url=str(resp.request.url),
                            status_code=resp.status_code,
                            content=resp.content,
                            headers=dict(resp.headers),
                            fetched_at=datetime.now(UTC),
                            elapsed_ms=elapsed * 1000,
                            attempts=attempts,
                        )
                        self.breaker.record_success()
                        HTTP_OUT_REQUESTS.labels(self.source, "ok").inc()
                        if use_cache and ttl > 0:
                            self.cache.put(key, result)
                        return result
                    last_status = resp.status_code
                    last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
                    if resp.status_code not in RETRY_STATUS:
                        # A 4xx means the request itself is wrong; retrying will not help.
                        HTTP_OUT_REQUESTS.labels(self.source, "http_error").inc()
                        if resp.status_code >= 500 or resp.status_code == 429:
                            self.breaker.record_failure(last_error)
                        raise SourceUnavailableError(self.source, last_error, resp.status_code)
                    delay = self._retry_after(resp) or self._backoff(attempt)
                except httpx.TransportError as exc:
                    HTTP_OUT_LATENCY.labels(self.source).observe(time.perf_counter() - start)
                    last_error = f"{type(exc).__name__}: {exc}"
                    delay = self._backoff(attempt)
                if attempt < self.retries:
                    log.info("retrying request", extra={"source": self.source, "attempt": attempts, "delay_s": round(delay, 2),
                                                        "error": last_error[:160]})
                    time.sleep(delay)
        HTTP_OUT_REQUESTS.labels(self.source, "network_error").inc()
        self.breaker.record_failure(last_error)
        return _stale_or_raise(f"failed after {attempts} attempts: {last_error}", last_status)

    def get(self, url: str, **kw: Any) -> FetchResult:
        return self.request("GET", url, **kw)

    def post(self, url: str, **kw: Any) -> FetchResult:
        return self.request("POST", url, **kw)

    def _backoff(self, attempt: int) -> float:
        return random.uniform(0, min(self.max_backoff_s, self.backoff_base_s * (2**attempt)))

    def _retry_after(self, resp: httpx.Response) -> float | None:
        value = resp.headers.get("Retry-After")
        if not value:
            return None
        try:
            return min(self.max_backoff_s, max(0.0, float(value)))
        except ValueError:
            return None


def post_json(client: ResilientHttpClient, url: str, payload: dict, **kw: Any) -> FetchResult:
    """POST a JSON body (used for STAC searches)."""
    return client.request("POST", url, data=json.dumps(payload), headers={"Content-Type": "application/json"}, **kw)
