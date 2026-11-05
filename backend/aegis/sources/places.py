"""Place-name search so people can choose an area by typing a name instead of coordinates.

Backed by OpenStreetMap Nominatim and run on the server so the browser talks to one origin.
The public instance's usage policy is respected:

* at most one request per second for the whole application (requests queue briefly;
  if the queue is longer than a few seconds the caller is told to retry),
* results are cached for a week (identical searches never reach Nominatim twice),
* an identifying User-Agent is sent (``AEGIS_USER_AGENT``),
* no type-ahead: the UI searches only when the user submits.

Typing coordinates ("26.7, 67.8") is answered locally without any network call.
"""

from __future__ import annotations

import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from aegis.config import Settings, get_settings
from aegis.net.http import HttpCache, ResilientHttpClient, SourceUnavailableError

_COORDS = re.compile(r"^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$")
CACHE_TTL_S = 7 * 24 * 3600
MAX_QUEUE_S = 5.0


class PlaceSearchBusyError(RuntimeError):
    """Too many searches are queued; the caller should retry shortly."""


@dataclass(frozen=True)
class Place:
    name: str
    context: str
    lat: float
    lon: float
    bbox: tuple[float, float, float, float] | None  # min_lon, min_lat, max_lon, max_lat
    kind: str

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.name, "context": self.context, "lat": self.lat, "lon": self.lon,
                "bbox": list(self.bbox) if self.bbox else None, "kind": self.kind}


def normalise_query(q: str) -> str:
    return " ".join(q.split())[:200]


def parse_coordinates(q: str) -> Place | None:
    """'lat, lon' typed by the user -> a single place, or None if the text is not coordinates."""
    m = _COORDS.match(q)
    if not m:
        return None
    lat, lon = float(m.group(1)), float(m.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return Place(name=f"{lat:.4f}, {lon:.4f}", context="Coordinates (latitude, longitude)", lat=lat, lon=lon, bbox=None,
                 kind="coordinates")


def parse_results(payload: Any) -> list[Place]:
    """Nominatim ``jsonv2`` -> places. Malformed entries are skipped, never fatal."""
    out: list[Place] = []
    if not isinstance(payload, list):
        return out
    for r in payload:
        try:
            lat, lon = float(r["lat"]), float(r["lon"])
            display = str(r.get("display_name") or "").strip()
            parts = [p.strip() for p in display.split(",") if p.strip()]
            name = str(r.get("name") or (parts[0] if parts else "")).strip() or f"{lat:.3f}, {lon:.3f}"
            context = ", ".join(p for p in parts if p != name)[:160]
            bb = r.get("boundingbox")
            bbox = None
            if isinstance(bb, list) and len(bb) == 4:
                min_lat, max_lat, min_lon, max_lon = (float(v) for v in bb)
                bbox = (min_lon, min_lat, max_lon, max_lat)
            kind = str(r.get("addresstype") or r.get("type") or r.get("category") or "place").replace("_", " ")
        except (KeyError, TypeError, ValueError):
            continue
        out.append(Place(name=name[:120], context=context, lat=lat, lon=lon, bbox=bbox, kind=kind))
    return out


class PlaceSearch:
    def __init__(self, settings: Settings | None = None, *, transport: httpx.BaseTransport | None = None,
                 min_interval_s: float = 1.0, clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep):
        self.settings = settings or get_settings()
        self.client = ResilientHttpClient("nominatim", settings=self.settings, timeout_s=15, retries=1,
                                          cache_ttl_s=CACHE_TTL_S, transport=transport)
        self.min_interval_s = min_interval_s
        self._clock, self._sleep = clock, sleep
        self._lock = threading.Lock()
        self._next_slot = 0.0

    def _params(self, q: str, limit: int) -> dict[str, Any]:
        return {"q": q, "format": "jsonv2", "limit": limit, "accept-language": "en"}

    def _cached(self, q: str, limit: int) -> bool:
        key = HttpCache.make_key("GET", self.settings.nominatim_url, self._params(q, limit), None)
        hit, age = self.client.cache.get(self.client.source, key)
        return hit is not None and age <= CACHE_TTL_S

    def _wait_for_slot(self) -> None:
        """Global 1 request/second spacing; refuse rather than queue for long."""
        with self._lock:
            now = self._clock()
            slot = max(now, self._next_slot)
            if slot - now > MAX_QUEUE_S:
                raise PlaceSearchBusyError("place search is busy, please try again in a few seconds")
            self._next_slot = slot + self.min_interval_s
        delay = slot - self._clock()
        if delay > 0:
            self._sleep(delay)

    def search(self, query: str, limit: int = 6) -> list[Place]:
        q = normalise_query(query)
        if len(q) < 2:
            return []
        coords = parse_coordinates(q)
        if coords is not None:
            return [coords]
        limit = max(1, min(10, limit))
        if not self._cached(q, limit) and not self.settings.offline:
            self._wait_for_slot()
        res = self.client.get(self.settings.nominatim_url, params=self._params(q, limit))
        return parse_results(res.json())

    def health(self) -> dict[str, Any]:
        url = self.settings.nominatim_url.rsplit("/", 1)[0] + "/status"
        try:
            res = self.client.get(url, params={"format": "json"}, cache_ttl_s=300)
            body = res.json()
            ok = isinstance(body, dict) and body.get("status") == 0
            return {"status": "operational" if ok else "degraded", "detail": None if ok else str(body)[:120]}
        except SourceUnavailableError as exc:
            return {"status": "unavailable", "error": exc.reason}
        except ValueError:
            return {"status": "degraded", "error": "unexpected status response"}


_INSTANCE: PlaceSearch | None = None
_INSTANCE_LOCK = threading.Lock()


def get_place_search() -> PlaceSearch:
    """Process-wide instance, so the one-request-per-second spacing applies to every caller."""
    global _INSTANCE
    with _INSTANCE_LOCK:
        if _INSTANCE is None:
            _INSTANCE = PlaceSearch()
        return _INSTANCE


def reset_place_search() -> None:
    global _INSTANCE
    with _INSTANCE_LOCK:
        _INSTANCE = None
