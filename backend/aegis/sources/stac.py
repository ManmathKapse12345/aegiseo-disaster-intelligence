"""Microsoft Planetary Computer STAC access (Sentinel-1 RTC, Sentinel-2 L2A, DEM, JRC GSW, WorldCover).

Planetary Computer data are free to read; asset URLs must be signed with a short-lived
SAS token obtained anonymously from the token endpoint (no account required).
"""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from shapely.geometry import shape
from shapely.ops import unary_union

from aegis.config import Settings, get_settings
from aegis.geo.aoi import AOI
from aegis.net.http import ResilientHttpClient, SourceUnavailableError, post_json

log = logging.getLogger(__name__)

S1_COLLECTION = "sentinel-1-rtc"
S2_COLLECTION = "sentinel-2-l2a"
DEM_COLLECTION = "cop-dem-glo-30"
JRC_COLLECTION = "jrc-gsw"
WORLDCOVER_COLLECTION = "esa-worldcover"


@dataclass
class SceneItem:
    id: str
    collection: str
    datetime: datetime
    geometry: dict[str, Any]
    bbox: list[float]
    properties: dict[str, Any]
    assets: dict[str, str]

    @property
    def platform(self) -> str:
        return str(self.properties.get("platform", "")).upper()

    @property
    def cloud_cover(self) -> float | None:
        v = self.properties.get("eo:cloud_cover")
        return None if v is None else float(v)

    @property
    def relative_orbit(self) -> int | None:
        v = self.properties.get("sat:relative_orbit")
        return None if v is None else int(v)

    @property
    def orbit_state(self) -> str | None:
        return self.properties.get("sat:orbit_state")

    @property
    def processing_baseline(self) -> str | None:
        return self.properties.get("s2:processing_baseline")


@dataclass
class Acquisition:
    """All items from one satellite pass covering (part of) the AOI."""

    sensor: str
    key: str
    datetime: datetime
    items: list[SceneItem]
    aoi_coverage: float
    cloud_cover: float | None = None
    relative_orbit: int | None = None
    orbit_state: str | None = None
    platform: str = ""
    meta: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        return {
            "sensor": self.sensor,
            "key": self.key,
            "datetime": self.datetime.isoformat(),
            "item_ids": [i.id for i in self.items],
            "aoi_coverage": round(self.aoi_coverage, 4),
            "tile_cloud_cover": None if self.cloud_cover is None else round(self.cloud_cover, 2),
            "relative_orbit": self.relative_orbit,
            "orbit_state": self.orbit_state,
            "platform": self.platform,
            **self.meta,
        }


def _parse_dt(v: str) -> datetime:
    return datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone(UTC)


def _item_datetime(props: dict[str, Any]) -> datetime:
    """STAC items may carry ``datetime: null`` with a start/end range instead (e.g. WorldCover)."""
    v = props.get("datetime") or props.get("start_datetime") or props.get("end_datetime")
    if not v:
        raise ValueError("item has no datetime")
    return _parse_dt(v)


class PlanetaryComputer:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.http = ResilientHttpClient("planetary_computer_stac", settings=self.settings, cache_ttl_s=6 * 3600, timeout_s=45)
        self.token_http = ResilientHttpClient("planetary_computer_sas", settings=self.settings, timeout_s=20)
        self._tokens: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ signing
    def token(self, collection: str) -> str:
        with self._lock:
            tok = self._tokens.get(collection)
            if tok and tok[1] - time.time() > 300:
                return tok[0]
        res = self.token_http.get(f"{self.settings.pc_sas_url}/{collection}", use_cache=False)
        data = res.json()
        expiry = _parse_dt(data["msft:expiry"]).timestamp() if "msft:expiry" in data else time.time() + 1800
        with self._lock:
            self._tokens[collection] = (data["token"], expiry)
        return data["token"]

    def sign(self, href: str, collection: str) -> str:
        if not href.startswith("https://") or ".blob.core.windows.net" not in href:
            return href
        sep = "&" if "?" in href else "?"
        return f"{href}{sep}{self.token(collection)}"

    # ------------------------------------------------------------------ search
    def search(
        self,
        collection: str,
        aoi: AOI,
        start: datetime,
        end: datetime,
        query: dict[str, Any] | None = None,
        limit: int = 100,
        max_pages: int = 4,
    ) -> list[SceneItem]:
        body: dict[str, Any] = {
            "collections": [collection],
            "intersects": aoi.to_geojson(),
            "datetime": f"{start.strftime('%Y-%m-%dT%H:%M:%SZ')}/{end.strftime('%Y-%m-%dT%H:%M:%SZ')}",
            "limit": limit,
        }
        if query:
            body["query"] = query
        items: list[SceneItem] = []
        url = f"{self.settings.stac_url}/search"
        for _ in range(max_pages):
            res = post_json(self.http, url, body)
            page = res.json()
            for f in page.get("features", []):
                try:
                    items.append(SceneItem(
                        id=f["id"], collection=f.get("collection", collection), datetime=_item_datetime(f["properties"]),
                        geometry=f["geometry"], bbox=f.get("bbox", []), properties=f["properties"],
                        assets={k: a["href"] for k, a in f.get("assets", {}).items() if "href" in a},
                    ))
                except (KeyError, ValueError) as exc:
                    log.warning("skipping malformed STAC item", extra={"error": str(exc)})
            nxt = next((link for link in page.get("links", []) if link.get("rel") == "next"), None)
            if not nxt or not nxt.get("body"):
                break
            body = nxt["body"]
        return items

    # ------------------------------------------------------------------ grouping
    @staticmethod
    def dedupe_s2(items: list[SceneItem]) -> list[SceneItem]:
        """Keep one item per (datatake, tile): the most recent processing baseline/generation."""
        best: dict[tuple[str, str], SceneItem] = {}
        for it in items:
            p = it.properties
            # original and reprocessed (e.g. baseline 04.00 vs 05.10) items share sensing time, platform and tile
            key = (it.datetime.strftime("%Y%m%dT%H%M") + it.platform, str(p.get("s2:mgrs_tile", "")))
            rank = (p.get("s2:processing_baseline") or "00.00", p.get("s2:generation_time") or "")
            cur = best.get(key)
            if cur is None or rank > (cur.properties.get("s2:processing_baseline") or "00.00", cur.properties.get("s2:generation_time") or ""):
                best[key] = it
        return list(best.values())

    @staticmethod
    def group_acquisitions(sensor: str, items: list[SceneItem], aoi: AOI) -> list[Acquisition]:
        groups: dict[str, list[SceneItem]] = defaultdict(list)
        for it in items:
            day = it.datetime.strftime("%Y-%m-%d")
            key = f"{it.platform}|{day}|{it.relative_orbit}|{it.orbit_state}"
            groups[key].append(it)
        out: list[Acquisition] = []
        for key, its in groups.items():
            try:
                union = unary_union([shape(i.geometry) for i in its])
                cov = union.intersection(aoi.geometry).area / aoi.geometry.area if aoi.geometry.area > 0 else 0.0
            except Exception:  # invalid footprints: fall back to "unknown" coverage
                cov = 0.0
            ccs = [i.cloud_cover for i in its if i.cloud_cover is not None]
            meta: dict[str, Any] = {}
            if sensor == "S2":
                meta["processing_baselines"] = sorted({i.processing_baseline for i in its if i.processing_baseline})
                meta["mgrs_tiles"] = sorted({str(i.properties.get("s2:mgrs_tile")) for i in its})
            out.append(Acquisition(
                sensor=sensor, key=key, datetime=min(i.datetime for i in its), items=its, aoi_coverage=float(min(1.0, cov)),
                cloud_cover=(sum(ccs) / len(ccs)) if ccs else None, relative_orbit=its[0].relative_orbit,
                orbit_state=its[0].orbit_state, platform=its[0].platform, meta=meta,
            ))
        out.sort(key=lambda a: a.datetime)
        return out

    def find_acquisitions(self, sensor: str, aoi: AOI, start: datetime, end: datetime, max_cloud: float = 80.0) -> list[Acquisition]:
        if sensor == "S1":
            items = self.search(S1_COLLECTION, aoi, start, end, query={"sar:instrument_mode": {"eq": "IW"}})
            items = [i for i in items if "vv" in i.assets and "vh" in i.assets]
        elif sensor == "S2":
            items = self.search(S2_COLLECTION, aoi, start, end, query={"eo:cloud_cover": {"lt": max_cloud}})
            items = self.dedupe_s2(items)
        else:
            raise ValueError(sensor)
        return self.group_acquisitions(sensor, items, aoi)

    def context_items(self, collection: str, aoi: AOI) -> list[SceneItem]:
        start, end = datetime(1980, 1, 1, tzinfo=UTC), datetime(2100, 1, 1, tzinfo=UTC)
        items = self.search(collection, aoi, start, end, limit=50, max_pages=1)
        if collection == WORLDCOVER_COLLECTION:  # prefer the 2021 v200 product
            items.sort(key=lambda i: i.datetime, reverse=True)
            if items:
                latest = items[0].datetime.year
                items = [i for i in items if i.datetime.year == latest]
        return items

    def health(self) -> dict[str, Any]:
        t0 = time.perf_counter()
        try:
            self.http.get(f"{self.settings.stac_url}/collections/{S2_COLLECTION}", cache_ttl_s=0, use_cache=False, timeout_s=15)
            return {"status": "operational", "latency_ms": round((time.perf_counter() - t0) * 1000)}
        except SourceUnavailableError as exc:
            return {"status": "unavailable", "error": exc.reason}
