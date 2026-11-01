"""Critical infrastructure from OpenStreetMap via the Overpass API (ODbL).

Multiple public Overpass instances are tried in order, each behind its own circuit
breaker; responses are cached for 24 h. Categories are mapped conservatively: e.g.
``amenity=shelter`` (mostly bus/picnic shelters) is NOT treated as an emergency shelter.
"""

from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import urlsplit

from aegis.config import Settings, get_settings
from aegis.net.http import ResilientHttpClient, SourceUnavailableError

log = logging.getLogger(__name__)

ROAD_CLASSES = "motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link"


def build_query(south: float, west: float, north: float, east: float, roads: str = ROAD_CLASSES, timeout: int = 90) -> str:
    bb = f"({south:.6f},{west:.6f},{north:.6f},{east:.6f})"
    return f"""[out:json][timeout:{timeout}][maxsize:134217728];
(
  nwr["amenity"~"^(hospital|clinic|doctors|fire_station|police|school|college|university|kindergarten)$"]{bb};
  nwr["healthcare"~"^(hospital|clinic|centre)$"]{bb};
  nwr["emergency"~"^(ambulance_station|assembly_point)$"]{bb};
  nwr["social_facility"="shelter"]{bb};
  nwr["power"~"^(plant|substation)$"]{bb};
  nwr["man_made"~"^(water_works|wastewater_plant)$"]{bb};
  node["place"~"^(city|town|village|hamlet|suburb)$"]{bb};
);
out center tags;
way["highway"~"^({roads})$"]{bb};
out geom tags;"""


def categorize(tags: dict[str, str]) -> str | None:
    a, h = tags.get("amenity"), tags.get("healthcare")
    if a == "hospital" or h == "hospital":
        return "hospital"
    if a in ("clinic", "doctors") or h in ("clinic", "centre"):
        return "clinic"
    if a == "fire_station":
        return "fire_station"
    if tags.get("emergency") == "ambulance_station":
        return "ambulance_station"
    if a == "police":
        return "police"
    if tags.get("social_facility") == "shelter" or tags.get("emergency") == "assembly_point":
        return "shelter"
    if a in ("school", "college", "university", "kindergarten"):
        return "school"
    if tags.get("power") in ("plant", "substation"):
        return "power"
    if tags.get("man_made") in ("water_works", "wastewater_plant"):
        return "water_works"
    if tags.get("place") in ("city", "town", "village", "hamlet", "suburb"):
        return "settlement"
    if tags.get("highway"):
        return "road"
    return None


def parse_elements(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for el in elements:
        tags = el.get("tags") or {}
        cat = categorize(tags)
        if cat is None:
            continue
        fid = f"osm/{el.get('type')}/{el.get('id')}"
        if fid in seen:
            continue
        seen.add(fid)
        name = tags.get("name:en") or tags.get("name")
        if cat == "road":
            geom = el.get("geometry") or []
            coords = [[round(p["lon"], 6), round(p["lat"], 6)] for p in geom if "lon" in p and "lat" in p]
            if len(coords) < 2:
                continue
            out.append({"id": fid, "category": "road", "name": name or tags.get("ref"), "tags": {"highway": tags["highway"]},
                        "geometry": {"type": "LineString", "coordinates": coords}})
            continue
        if el.get("type") == "node":
            lon, lat = el.get("lon"), el.get("lat")
        else:
            c = el.get("center") or {}
            lon, lat = c.get("lon"), c.get("lat")
        if lon is None or lat is None:
            continue
        keep = {k: v for k, v in tags.items() if k in ("amenity", "healthcare", "emergency", "place", "population", "power",
                                                      "man_made", "beds", "operator", "capacity", "addr:city")}
        out.append({"id": fid, "category": cat, "name": name, "tags": keep,
                    "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}})
    return out


class OverpassClient:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.clients = [
            (url, ResilientHttpClient(f"overpass:{urlsplit(url).netloc}", settings=self.settings, timeout_s=120,
                                      retries=1, cache_ttl_s=24 * 3600))
            for url in self.settings.overpass_url_list
        ]

    def fetch(self, bbox: tuple[float, float, float, float]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """Infrastructure features for a (minx, miny, maxx, maxy) lon/lat box."""
        minx, miny, maxx, maxy = bbox
        attempts: list[dict[str, Any]] = []
        for roads in (ROAD_CLASSES, "motorway|trunk|primary|secondary"):
            q = build_query(miny, minx, maxy, maxx, roads=roads)
            for url, client in self.clients:
                t0 = time.perf_counter()
                try:
                    res = client.post(url, data={"data": q})
                    payload = res.json()
                    if payload.get("remark") and "runtime error" in payload["remark"]:
                        raise SourceUnavailableError(client.source, payload["remark"][:200])
                    feats = parse_elements(payload.get("elements", []))
                    return feats, {
                        "status": "ok", "endpoint": url, "provenance": res.provenance(), "stale": res.stale,
                        "osm_base": (payload.get("osm3s") or {}).get("timestamp_osm_base"),
                        "road_classes": roads, "features": len(feats), "attempts": attempts,
                        "license": "OpenStreetMap contributors, ODbL 1.0",
                    }
                except (SourceUnavailableError, ValueError) as exc:
                    attempts.append({"endpoint": url, "error": str(exc)[:200], "ms": round((time.perf_counter() - t0) * 1000)})
                    log.warning("overpass endpoint failed", extra={"endpoint": url, "error": str(exc)[:200]})
        raise SourceUnavailableError("overpass", f"all Overpass endpoints failed: {attempts}")

    def health(self) -> dict[str, Any]:
        url, client = self.clients[0]
        t0 = time.perf_counter()
        try:
            client.post(url, data={"data": '[out:json][timeout:10];node(1);out ids;'}, use_cache=False, timeout_s=20)
            return {"status": "operational", "latency_ms": round((time.perf_counter() - t0) * 1000), "endpoint": url}
        except SourceUnavailableError as exc:
            return {"status": "degraded" if len(self.clients) > 1 else "unavailable", "error": exc.reason, "endpoint": url}
