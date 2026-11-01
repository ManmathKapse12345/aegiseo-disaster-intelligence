"""Population data for exposure estimation.

Primary  Meta / CIESIN High Resolution Settlement Layer (HRSL), population counts at
         1 arc-second (~30 m), served as Cloud-Optimized GeoTIFFs on AWS Open Data
         (CC BY 4.0). Read per pixel and resampled onto the analysis grid while conserving
         totals (counts -> density -> area-weighted average -> counts).
Check    WorldPop Global 2000-2020 (100 m, unconstrained) zonal statistics API for the AOI
         total, reported alongside as an independent estimate.
Fallback WorldPop AOI total distributed dasymetrically over ESA WorldCover classes when
         HRSL has no coverage (clearly labelled approximate).
"""

from __future__ import annotations

import json
import logging
import math
import re
from typing import Any

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject
from rasterio.windows import from_bounds

from aegis.config import Settings, get_settings
from aegis.geo.aoi import AOI
from aegis.geo.grid import Grid
from aegis.geo.raster import GDAL_ENV
from aegis.net.http import ResilientHttpClient, SourceUnavailableError

log = logging.getLogger(__name__)

HRSL_URL = "https://dataforgood-fb-data.s3.amazonaws.com/hrsl-cogs/hrsl_general/hrsl_general-latest.vrt"


class PopulationSource:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.worldpop = ResilientHttpClient("worldpop", settings=self.settings, timeout_s=60, cache_ttl_s=30 * 86400)

    # ------------------------------------------------------------------ HRSL
    def hrsl_on_grid(self, aoi: AOI, grid: Grid) -> tuple[np.ndarray | None, dict[str, Any]]:
        """People per analysis-grid pixel from HRSL, or (None, reason)."""
        if self.settings.offline:
            return None, {"status": "unavailable", "reason": "offline mode"}
        cache = self.settings.cache_dir / "population" / f"hrsl_{grid.key()}.npy"
        if cache.exists():
            arr = np.load(cache)
            return arr, {"status": "ok", "source": "HRSL (cached)", "url": HRSL_URL}
        minx, miny, maxx, maxy = grid.bounds_wgs84()
        pad = 0.01
        try:
            with rasterio.Env(**GDAL_ENV), rasterio.open(HRSL_URL) as src:
                win = from_bounds(minx - pad, miny - pad, maxx + pad, maxy + pad, src.transform).round_offsets().round_lengths()
                counts = src.read(1, window=win, boundless=True, fill_value=np.nan).astype(np.float64)
                win_tr = src.window_transform(win)
        except rasterio.errors.RasterioIOError as exc:
            return None, {"status": "unavailable", "reason": f"HRSL read failed: {exc}"[:300]}
        finite = np.isfinite(counts)
        if not finite.any():
            return None, {"status": "no_coverage", "reason": "HRSL has no data for this area"}
        counts = np.where(finite, counts, 0.0)
        # convert counts to density (people / m^2) with latitude-dependent pixel area
        rows = np.arange(counts.shape[0])
        lat = win_tr.f + (rows + 0.5) * win_tr.e
        px_area = (abs(win_tr.a) * 111_320.0 * np.cos(np.deg2rad(lat))) * (abs(win_tr.e) * 110_574.0)
        density = (counts / px_area[:, None]).astype(np.float32)
        out = np.zeros(grid.shape, np.float32)
        reproject(density, out, src_transform=win_tr, src_crs="EPSG:4326", dst_transform=grid.transform,
                  dst_crs=grid.crs, resampling=Resampling.average, src_nodata=None, dst_nodata=0)
        people = (out * grid.resolution**2).astype(np.float32)
        cache.parent.mkdir(parents=True, exist_ok=True)
        np.save(cache, people)
        return people, {"status": "ok", "source": "Meta/CIESIN HRSL (general population, ~30 m)", "url": HRSL_URL,
                        "native_window_total": round(float(counts.sum()))}

    # ------------------------------------------------------------------ WorldPop zonal stats
    @staticmethod
    def _extract_json(text: str) -> dict[str, Any]:
        """The WorldPop API sometimes surrounds its JSON with PHP deprecation notices (HTML)."""
        decoder = json.JSONDecoder()
        for m in re.finditer(r"\{", text):
            try:
                obj, _ = decoder.raw_decode(text, m.start())  # parses one value, ignores trailing text
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict) and ("data" in obj or "error" in obj or "status" in obj):
                return obj
        raise ValueError("no JSON object in WorldPop response")

    def worldpop_total(self, geometry: dict[str, Any], year: int = 2020) -> tuple[float | None, dict[str, Any]]:
        fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": geometry}]}
        gj = json.dumps(fc, separators=(",", ":"))
        if len(gj) > 6000:
            return None, {"status": "skipped", "reason": "geometry too complex for the WorldPop GET API"}
        try:
            res = self.worldpop.get(self.settings.worldpop_stats_url, params={
                "dataset": "wpgppop", "year": str(min(max(year, 2000), 2020)), "geojson": gj, "runasync": "false"})
            data = self._extract_json(res.text)
        except (SourceUnavailableError, ValueError) as exc:
            return None, {"status": "unavailable", "reason": str(exc)[:300]}
        if data.get("error"):
            return None, {"status": "error", "reason": str(data.get("error_message"))[:300]}
        total = (data.get("data") or {}).get("total_population")
        if total is None:
            return None, {"status": "error", "reason": "no total_population in response"}
        return float(total), {"status": "ok", "source": f"WorldPop Global 100 m unconstrained ({min(max(year, 2000), 2020)})",
                              "provenance": res.provenance(), "stale": res.stale}

    def health(self) -> dict[str, Any]:
        tiny = {"type": "Polygon", "coordinates": [[[67.70, 26.60], [67.71, 26.60], [67.71, 26.61], [67.70, 26.61], [67.70, 26.60]]]}
        total, info = self.worldpop_total(tiny)
        return {"status": "operational" if total is not None else "unavailable", **({} if total is not None else {"error": info.get("reason")})}


def dasymetric_weights(landcover: np.ndarray) -> np.ndarray:
    from aegis.analysis.impact import DASYMETRIC_WEIGHTS

    codes = np.nan_to_num(landcover, nan=0).astype(np.int32)
    w = np.zeros(landcover.shape, np.float32)
    for code, wt in DASYMETRIC_WEIGHTS.items():
        w[codes == code] = wt
    return w


def dasymetric_raster(total: float, landcover: np.ndarray, aoi_mask: np.ndarray) -> np.ndarray | None:
    w = dasymetric_weights(landcover) * aoi_mask
    s = float(w.sum())
    if s <= 0 or not math.isfinite(total):
        return None
    return (w / s * total).astype(np.float32)
