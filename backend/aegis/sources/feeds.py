"""Hazard and weather context feeds.

GDACS      Global Disaster Alert and Coordination System event list (near-real-time alerts)
USGS       earthquakes M4.5+ past 7 days (GeoJSON summary feed, updated every minute)
NASA FIRMS active fires: public NOAA-20 VIIRS global CSV (last 24 h / 7 d, no key) or the
           area API for historical dates (requires a free MAP_KEY)
Open-Meteo ERA5-based historical daily precipitation (reanalysis, ~5 day latency)
"""

from __future__ import annotations

import csv
import io
import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

from aegis.config import Settings, get_settings
from aegis.net.http import ResilientHttpClient, SourceUnavailableError

log = logging.getLogger(__name__)

GDACS_TYPES = {"FL": "flood", "TC": "tropical_cyclone", "EQ": "earthquake", "WF": "wildfire", "DR": "drought", "VO": "volcano"}


class HazardFeeds:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.gdacs = ResilientHttpClient("gdacs", settings=self.settings, timeout_s=40, cache_ttl_s=900)
        self.usgs = ResilientHttpClient("usgs_earthquakes", settings=self.settings, timeout_s=30, cache_ttl_s=600)
        self.firms = ResilientHttpClient("nasa_firms", settings=self.settings, timeout_s=90, cache_ttl_s=3 * 3600)
        self.meteo = ResilientHttpClient("open_meteo", settings=self.settings, timeout_s=30, cache_ttl_s=12 * 3600)

    # ------------------------------------------------------------------ GDACS
    def gdacs_events(self, days: int = 21, min_alert: str = "Green") -> tuple[list[dict[str, Any]], dict[str, Any]]:
        to_d = datetime.now(UTC).date()
        from_d = to_d - timedelta(days=days)
        levels = {"Green": "Green;Orange;Red", "Orange": "Orange;Red", "Red": "Red"}[min_alert]
        res = self.gdacs.get(self.settings.gdacs_url, params={
            "eventlist": "FL;TC;EQ;WF;DR;VO", "fromDate": from_d.isoformat(), "toDate": to_d.isoformat(), "alertlevel": levels})
        data = res.json()
        events = []
        for f in data.get("features", []):
            p = f.get("properties", {})
            geom = f.get("geometry") or {}
            if geom.get("type") != "Point":
                continue
            url = p.get("url") if isinstance(p.get("url"), dict) else {}
            sev = p.get("severitydata") if isinstance(p.get("severitydata"), dict) else {}
            events.append({
                "id": f"gdacs/{p.get('eventtype')}/{p.get('eventid')}",
                "source": "GDACS",
                "hazard": GDACS_TYPES.get(p.get("eventtype"), p.get("eventtype")),
                "name": p.get("name") or p.get("eventname"),
                "alert_level": p.get("alertlevel"),
                "country": p.get("country"),
                "from": p.get("fromdate"),
                "to": p.get("todate"),
                "is_current": str(p.get("iscurrent")).lower() == "true",
                "severity_text": sev.get("severitytext"),
                "lon": geom["coordinates"][0],
                "lat": geom["coordinates"][1],
                "url": url.get("report"),
                "modified": p.get("datemodified"),
            })
        events.sort(key=lambda e: ({"Red": 0, "Orange": 1, "Green": 2}.get(e["alert_level"], 3), e["from"] or ""), reverse=False)
        return events, {"status": "ok", "provenance": res.provenance(), "stale": res.stale}

    # ------------------------------------------------------------------ USGS
    def earthquakes(self) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        res = self.usgs.get(self.settings.usgs_feed_url)
        data = res.json()
        out = []
        for f in data.get("features", []):
            p, g = f.get("properties", {}), f.get("geometry", {})
            coords = g.get("coordinates") or [None, None, None]
            out.append({
                "id": f"usgs/{f.get('id')}", "source": "USGS", "hazard": "earthquake", "name": p.get("title"),
                "magnitude": p.get("mag"), "alert_level": (p.get("alert") or "").capitalize() or None,
                "time": datetime.fromtimestamp(p["time"] / 1000, tz=UTC).isoformat() if p.get("time") else None,
                "lon": coords[0], "lat": coords[1], "depth_km": coords[2], "url": p.get("url"), "tsunami": bool(p.get("tsunami")),
            })
        meta = data.get("metadata", {})
        return out, {"status": "ok", "provenance": res.provenance(), "stale": res.stale,
                     "generated": datetime.fromtimestamp(meta["generated"] / 1000, tz=UTC).isoformat() if meta.get("generated") else None}

    # ------------------------------------------------------------------ FIRMS
    def active_fires(self, bbox: tuple[float, float, float, float], start: date, end: date) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        minx, miny, maxx, maxy = bbox
        key = self.settings.firms_map_key.get_secret_value()
        today = datetime.now(UTC).date()
        rows: list[dict[str, str]]
        if key:
            days = min(10, max(1, (end - start).days + 1))
            url = f"{self.settings.firms_api_url}/{key}/VIIRS_NOAA20_NRT/{minx:.4f},{miny:.4f},{maxx:.4f},{maxy:.4f}/{days}/{start.isoformat()}"
            res = self.firms.get(url)
            rows = list(csv.DictReader(io.StringIO(res.text)))
            mode = "FIRMS area API (MAP_KEY)"
        elif (today - start).days <= 6:
            res = self.firms.get(self.settings.firms_public_url)
            rows = list(csv.DictReader(io.StringIO(res.text)))
            mode = "FIRMS public 7-day global file"
        else:
            raise SourceUnavailableError("nasa_firms", "historical active-fire data require AEGIS_FIRMS_MAP_KEY (free at firms.modaps.eosdis.nasa.gov)")
        out = []
        for r in rows:
            try:
                lat, lon = float(r["latitude"]), float(r["longitude"])
                d = date.fromisoformat(r["acq_date"])
            except (KeyError, ValueError):
                continue
            if minx <= lon <= maxx and miny <= lat <= maxy and start <= d <= end:
                out.append({"lon": lon, "lat": lat, "acq_date": r["acq_date"], "acq_time": r.get("acq_time"),
                            "confidence": r.get("confidence"), "frp": float(r.get("frp") or 0), "satellite": r.get("satellite")})
        return out, {"status": "ok", "mode": mode, "provenance": res.provenance(), "stale": res.stale}

    # ------------------------------------------------------------------ Open-Meteo
    def rainfall(self, lon: float, lat: float, start: date, end: date) -> tuple[dict[str, Any], dict[str, Any]]:
        end = min(end, datetime.now(UTC).date() - timedelta(days=5))
        if end < start:
            raise SourceUnavailableError("open_meteo", "reanalysis precipitation not yet available for these dates (~5 day latency)")
        res = self.meteo.get(self.settings.open_meteo_archive_url, params={
            "latitude": round(lat, 4), "longitude": round(lon, 4), "start_date": start.isoformat(), "end_date": end.isoformat(),
            "daily": "precipitation_sum", "timezone": "UTC"})
        data = res.json()
        days = (data.get("daily") or {}).get("time", [])
        vals = (data.get("daily") or {}).get("precipitation_sum", [])
        series = [{"date": d, "mm": v} for d, v in zip(days, vals, strict=False) if v is not None]
        total = round(sum(s["mm"] for s in series), 1) if series else None
        peak = max(series, key=lambda s: s["mm"]) if series else None
        return {"series": series, "total_mm": total, "peak_day": peak, "lat": data.get("latitude"), "lon": data.get("longitude")}, {
            "status": "ok", "provenance": res.provenance(), "stale": res.stale,
            "note": "ERA5-based reanalysis at the AOI centroid (~25 km grid); not a gauge observation"}

    def health(self, which: str) -> dict[str, Any]:
        try:
            if which == "gdacs":
                ev, _ = self.gdacs_events(days=3)
                return {"status": "operational", "detail": f"{len(ev)} events in last 3 days"}
            if which == "usgs":
                ev, _ = self.earthquakes()
                return {"status": "operational", "detail": f"{len(ev)} M4.5+ events in last 7 days"}
            if which == "open_meteo":
                d = datetime.now(UTC).date() - timedelta(days=10)
                self.rainfall(0.0, 0.0, d, d)
                return {"status": "operational"}
        except SourceUnavailableError as exc:
            return {"status": "unavailable", "error": exc.reason}
        except Exception as exc:  # unexpected payload format
            return {"status": "degraded", "error": f"{type(exc).__name__}: {exc}"[:200]}
        return {"status": "unknown"}
