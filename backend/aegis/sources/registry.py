"""Catalogue of integrated data sources with provenance metadata and live health checks."""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from aegis.config import Settings, get_settings
from aegis.net.http import breaker_snapshots

SOURCES: list[dict[str, Any]] = [
    {
        "id": "sentinel-1-rtc", "name": "Sentinel-1 SAR (RTC)", "provider": "ESA Copernicus via Microsoft Planetary Computer",
        "category": "observation", "provides": "C-band radar backscatter VV + VH, radiometrically terrain corrected (gamma0)",
        "coverage": "Global land, 2014-present", "spatial_resolution": "10 m pixel (~20 m resolution, IW GRD)",
        "temporal_resolution": "6-12 day repeat per orbit (Sentinel-1A; Sentinel-1C since 2025)",
        "update_frequency": "New scenes typically within days of acquisition", "timeliness": "archive / near-real-time (days)",
        "access": "Free; anonymous SAS token", "license": "Copernicus open data licence",
        "limitations": "Double-bounce in built-up areas, flooded vegetation, wind-roughened water, layover/shadow in mountains",
        "url": "https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc", "health": "stac",
    },
    {
        "id": "sentinel-2-l2a", "name": "Sentinel-2 MSI (L2A)", "provider": "ESA Copernicus via Microsoft Planetary Computer",
        "category": "observation", "provides": "Surface reflectance, 13 bands, scene classification (clouds, shadows)",
        "coverage": "Global land, 2015-present", "spatial_resolution": "10 / 20 / 60 m",
        "temporal_resolution": "5-day revisit at the equator (2-3 satellites)", "update_frequency": "Within ~1 day of acquisition",
        "timeliness": "archive / near-real-time (days)", "access": "Free; anonymous SAS token", "license": "Copernicus open data licence",
        "limitations": "Blocked by cloud; cloud shadows resemble water; processing-baseline offset since 2022",
        "url": "https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a", "health": "stac",
    },
    {
        "id": "cop-dem-glo-30", "name": "Copernicus DEM GLO-30", "provider": "ESA / Airbus via Planetary Computer", "category": "context",
        "provides": "Surface elevation for slope and height-above-drainage constraints", "coverage": "Global",
        "spatial_resolution": "30 m", "temporal_resolution": "Static (data 2011-2015)", "update_frequency": "Static",
        "timeliness": "static reference", "access": "Free", "license": "Copernicus DEM licence (free, attribution)",
        "limitations": "Surface model (includes buildings / canopy)", "url": "https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30",
        "health": "stac",
    },
    {
        "id": "jrc-gsw", "name": "JRC Global Surface Water", "provider": "European Commission JRC via Planetary Computer",
        "category": "context", "provides": "Water occurrence 1984-2021 (permanent-water reference)", "coverage": "Global",
        "spatial_resolution": "30 m", "temporal_resolution": "Long-term statistics", "update_frequency": "Static (v1.4)",
        "timeliness": "static reference", "access": "Free", "license": "Free with attribution (Pekel et al., 2016)",
        "limitations": "Seasonal water and recent river changes may be mis-represented", "url": "https://global-surface-water.appspot.com",
        "health": "stac",
    },
    {
        "id": "esa-worldcover", "name": "ESA WorldCover 2021", "provider": "ESA via Planetary Computer", "category": "context",
        "provides": "Land cover (built-up, cropland, forest...) for exposure and dasymetric population", "coverage": "Global",
        "spatial_resolution": "10 m", "temporal_resolution": "2021 snapshot", "update_frequency": "Static",
        "timeliness": "static reference", "access": "Free", "license": "CC BY 4.0", "limitations": "Snapshot of 2021",
        "url": "https://esa-worldcover.org", "health": "stac",
    },
    {
        "id": "hrsl", "name": "High Resolution Settlement Layer", "provider": "Meta Data for Good & CIESIN (AWS Open Data)",
        "category": "context", "provides": "Gridded population counts", "coverage": "Most countries (gaps exist)",
        "spatial_resolution": "~30 m (1 arc-second)", "temporal_resolution": "Single vintage per country (2015-2020)",
        "update_frequency": "Irregular", "timeliness": "static estimate", "access": "Free (public COGs)", "license": "CC BY 4.0",
        "limitations": "Model-based estimate; vintage varies; does not capture displacement or seasonal movement",
        "url": "https://dataforgood.facebook.com/dfg/tools/high-resolution-population-density-maps", "health": "hrsl",
    },
    {
        "id": "worldpop", "name": "WorldPop", "provider": "University of Southampton", "category": "context",
        "provides": "Population totals for an area (zonal statistics API), 2000-2020", "coverage": "Global",
        "spatial_resolution": "100 m", "temporal_resolution": "Annual estimates to 2020", "update_frequency": "Static for 2000-2020",
        "timeliness": "static estimate", "access": "Free public API", "license": "CC BY 4.0",
        "limitations": "Unconstrained model spreads population into unbuilt areas; 2020 latest year in this API",
        "url": "https://www.worldpop.org", "health": "worldpop",
    },
    {
        "id": "openstreetmap", "name": "OpenStreetMap (Overpass API)", "provider": "OpenStreetMap contributors", "category": "context",
        "provides": "Hospitals, clinics, schools, emergency services, shelters, utilities, settlements, roads",
        "coverage": "Global (completeness varies by region)", "spatial_resolution": "Vector", "temporal_resolution": "Continuously edited",
        "update_frequency": "Minutes (live database)", "timeliness": "live", "access": "Free public Overpass instances (rate limited)",
        "license": "ODbL 1.0", "limitations": "Missing features are common in some regions; absence is not evidence of absence",
        "url": "https://www.openstreetmap.org", "health": "overpass",
    },
    {
        "id": "gdacs", "name": "GDACS disaster alerts", "provider": "European Commission JRC & UN OCHA", "category": "feed",
        "provides": "Current floods, cyclones, earthquakes, wildfires, droughts, volcanoes with alert levels",
        "coverage": "Global", "spatial_resolution": "Event level", "temporal_resolution": "Event updates",
        "update_frequency": "Minutes to hours", "timeliness": "near-real-time", "access": "Free public API", "license": "Free use with attribution",
        "limitations": "Model-based impact estimates; event geometry is approximate", "url": "https://www.gdacs.org", "health": "gdacs",
    },
    {
        "id": "usgs-earthquakes", "name": "USGS earthquake feed", "provider": "U.S. Geological Survey", "category": "feed",
        "provides": "Earthquakes M4.5+ in the past 7 days", "coverage": "Global", "spatial_resolution": "Epicentre",
        "temporal_resolution": "Event", "update_frequency": "Every minute", "timeliness": "real-time (minutes)",
        "access": "Free GeoJSON feed", "license": "Public domain", "limitations": "Earthquake damage mapping is not supported by this platform",
        "url": "https://earthquake.usgs.gov/earthquakes/feed/", "health": "usgs",
    },
    {
        "id": "nasa-firms", "name": "NASA FIRMS active fires", "provider": "NASA LANCE / FIRMS", "category": "feed",
        "provides": "VIIRS (375 m) active-fire detections", "coverage": "Global", "spatial_resolution": "375 m",
        "temporal_resolution": "Several overpasses per day", "update_frequency": "Within ~3 h of overpass",
        "timeliness": "near-real-time", "access": "Public 7-day files; historical area API needs a free MAP_KEY",
        "license": "NASA open data", "limitations": "Detects active fire at overpass time, not burned area; clouds hide fires",
        "url": "https://firms.modaps.eosdis.nasa.gov", "health": "firms",
    },
    {
        "id": "open-meteo", "name": "Open-Meteo historical weather (ERA5)", "provider": "Open-Meteo / ECMWF ERA5", "category": "context",
        "provides": "Daily precipitation at the AOI centroid", "coverage": "Global", "spatial_resolution": "~9-25 km reanalysis grid",
        "temporal_resolution": "Daily", "update_frequency": "~5 day latency", "timeliness": "archive", "access": "Free API (no key)",
        "license": "CC BY 4.0", "limitations": "Reanalysis, not gauge observations; coarse resolution", "url": "https://open-meteo.com",
        "health": "open_meteo",
    },
    {
        "id": "sen1floods11", "name": "Sen1Floods11 (training labels)", "provider": "Cloud to Street (Bonafilia et al., 2020)",
        "category": "training", "provides": "446 hand-labelled 512x512 chips with Sentinel-1 / Sentinel-2 for 11 flood events",
        "coverage": "11 events on 6 continents", "spatial_resolution": "10 m", "temporal_resolution": "Single date per event",
        "update_frequency": "Static", "timeliness": "static training data", "access": "Public Google Cloud bucket",
        "license": "See dataset repository; cite Bonafilia et al. (2020)", "limitations": "Few events; L1C optical (TOA)",
        "url": "https://github.com/cloudtostreet/Sen1Floods11", "health": None,
    },
    {
        "id": "anthropic-claude", "name": "Claude (optional narrative)", "provider": "Anthropic", "category": "service",
        "provides": "Optional executive-summary drafting from verified facts (grounding-checked)", "coverage": "-",
        "spatial_resolution": "-", "temporal_resolution": "-", "update_frequency": "-", "timeliness": "on demand",
        "access": "Requires AEGIS_ANTHROPIC_API_KEY", "license": "Commercial API", "limitations": "Never produces measurements",
        "url": "https://www.anthropic.com", "health": "llm",
    },
]

_CACHE: dict[str, Any] = {"at": 0.0, "data": {}}
_LOCK = threading.Lock()


def _check(kind: str, settings: Settings, services: Any) -> dict[str, Any]:
    t0 = time.perf_counter()
    try:
        if kind == "stac":
            r = services.pc.health()
        elif kind == "overpass":
            r = services.osm.health()
        elif kind == "worldpop":
            r = services.population.health()
        elif kind == "hrsl":
            import rasterio

            from aegis.geo.raster import GDAL_ENV
            from aegis.sources.population import HRSL_URL

            with rasterio.Env(**GDAL_ENV), rasterio.open(HRSL_URL):
                r = {"status": "operational"}
        elif kind in ("gdacs", "usgs", "open_meteo"):
            r = services.feeds.health(kind)
        elif kind == "firms":
            key = bool(settings.firms_map_key.get_secret_value())
            r = {"status": "operational" if not settings.offline else "unavailable",
                 "detail": "MAP_KEY configured (historical queries enabled)" if key else "public 7-day files only; set AEGIS_FIRMS_MAP_KEY for history"}
        elif kind == "llm":
            r = {"status": "operational" if settings.llm_available else "not_configured",
                 "detail": f"model {settings.llm_model}" if settings.llm_available else "template summaries in use"}
        else:
            r = {"status": "unknown"}
    except Exception as exc:  # health checks must never raise
        r = {"status": "unavailable", "error": f"{type(exc).__name__}: {exc}"[:200]}
    if settings.offline and kind not in ("llm",):
        r = {"status": "offline", "detail": "offline mode: cached data only"}
    r.setdefault("latency_ms", round((time.perf_counter() - t0) * 1000))
    r["checked_at"] = datetime.now(UTC).isoformat()
    return r


def source_status(services: Any, refresh: bool = False, max_age_s: float = 300.0) -> list[dict[str, Any]]:
    settings = get_settings()
    with _LOCK:
        fresh = (time.time() - _CACHE["at"]) < max_age_s and _CACHE["data"]
    if refresh or not fresh:
        kinds = sorted({s["health"] for s in SOURCES if s["health"]})
        with ThreadPoolExecutor(max_workers=len(kinds)) as pool:
            res = dict(zip(kinds, pool.map(lambda k: _check(k, settings, services), kinds), strict=True))
        with _LOCK:
            _CACHE["at"], _CACHE["data"] = time.time(), res
    with _LOCK:
        data = dict(_CACHE["data"])
    breakers = breaker_snapshots()
    out = []
    for s in SOURCES:
        h = data.get(s["health"]) if s["health"] else {"status": "static"}
        out.append({**s, "status": (h or {}).get("status", "unknown"), "health": h,
                    "circuit_breakers": {k: v for k, v in breakers.items() if s["health"] and s["health"] in k.replace("planetary_computer", "stac")}})
    return out
