"""Read Planetary Computer COGs onto the analysis grid (with a local raster cache)."""

from __future__ import annotations

import hashlib
import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np
from rasterio.enums import Resampling

from aegis.analysis.bundle import ContextLayers, SensorObservation
from aegis.config import Settings, get_settings
from aegis.geo.aoi import AOI
from aegis.geo.grid import Grid
from aegis.geo.raster import RasterReadError, read_geotiff, read_to_grid, write_geotiff
from aegis.ml.features import S2_BANDS, gamma0_to_sigma0_db
from aegis.net.http import SourceUnavailableError
from aegis.sources.stac import (
    DEM_COLLECTION,
    JRC_COLLECTION,
    WORLDCOVER_COLLECTION,
    Acquisition,
    PlanetaryComputer,
    SceneItem,
)

log = logging.getLogger(__name__)

# Sentinel-2 L2A Scene Classification (SCL)
SCL_NODATA, SCL_DEFECTIVE, SCL_DARK, SCL_SHADOW = 0, 1, 2, 3
SCL_CLOUD_MED, SCL_CLOUD_HIGH, SCL_CIRRUS, SCL_SNOW = 8, 9, 10, 11
SCL_VALID = (2, 4, 5, 6, 7)          # dark area, vegetation, not-vegetated, water, unclassified
SCL_CLOUDY = (3, 8, 9, 10)           # cloud shadow, medium/high-probability cloud, thin cirrus


def s2_offset(item: SceneItem) -> float:
    """BOA_ADD_OFFSET: -1000 DN for processing baseline >= 04.00 (from 25 Jan 2022)."""
    pb = item.processing_baseline
    try:
        return -1000.0 if pb is not None and float(pb) >= 4.0 else 0.0
    except ValueError:
        return 0.0


class ImageryReader:
    def __init__(self, pc: PlanetaryComputer | None = None, settings: Settings | None = None, max_workers: int = 4):
        self.settings = settings or get_settings()
        self.pc = pc or PlanetaryComputer(self.settings)
        self.cache_dir: Path = self.settings.cache_dir / "rasters"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.max_workers = max_workers
        self.reads = {"remote": 0, "cache": 0, "failed": 0}
        self._lock = threading.Lock()

    def _count(self, key: str) -> None:
        with self._lock:
            self.reads[key] += 1

    def read_item(self, item: SceneItem, asset: str, grid: Grid, resampling: Resampling) -> np.ndarray:
        key = hashlib.sha1(f"{item.collection}|{item.id}|{asset}|{grid.key()}|{resampling.name}".encode(), usedforsecurity=False).hexdigest()
        path = self.cache_dir / f"{key}.tif"
        if path.exists():
            try:
                self._count("cache")
                return read_geotiff(path)["data"]
            except Exception:  # corrupt cache entry: re-download
                path.unlink(missing_ok=True)
        if self.settings.offline:
            raise SourceUnavailableError("planetary_computer_cog", "offline mode and raster not cached")
        if asset not in item.assets:
            raise RasterReadError(f"asset {asset!r} missing from item {item.id}")
        last: Exception | None = None
        for attempt in range(3):
            try:
                href = self.pc.sign(item.assets[asset], item.collection)
                arr = read_to_grid(href, grid, resampling=resampling)
                write_geotiff(path, {"data": arr}, grid)
                self._count("remote")
                return arr
            except (RasterReadError, SourceUnavailableError) as exc:
                last = exc
                log.warning("COG read failed", extra={"item": item.id, "asset": asset, "attempt": attempt + 1, "error": str(exc)[:200]})
        self._count("failed")
        raise RasterReadError(f"could not read {asset} of {item.id}: {last}")

    def mosaic(self, items: list[SceneItem], asset: str, grid: Grid, resampling: Resampling,
               transform: Callable[[SceneItem, np.ndarray], np.ndarray] | None = None) -> np.ndarray:
        out: np.ndarray | None = None
        errors = []
        for it in items:
            try:
                arr = self.read_item(it, asset, grid, resampling)
            except RasterReadError as exc:
                errors.append(str(exc))
                continue
            if transform is not None:
                arr = transform(it, arr)
            out = arr if out is None else np.where(np.isfinite(out), out, arr)
        if out is None:
            raise RasterReadError("; ".join(errors) or f"no readable items for {asset}")
        return out.astype(np.float32)

    # ------------------------------------------------------------------ sensors
    def read_s1(self, acq: Acquisition, grid: Grid, role: str, aoi_mask: np.ndarray) -> SensorObservation:
        with ThreadPoolExecutor(max_workers=2) as pool:
            fv = pool.submit(self.mosaic, acq.items, "vv", grid, Resampling.average)
            fh = pool.submit(self.mosaic, acq.items, "vh", grid, Resampling.average)
            vv_lin, vh_lin = fv.result(), fh.result()
        vv, vh = gamma0_to_sigma0_db(vv_lin), gamma0_to_sigma0_db(vh_lin)
        valid = np.isfinite(vv) & np.isfinite(vh)
        return SensorObservation(
            sensor="S1", role=role, acquired_at=acq.datetime, collection=acq.items[0].collection,
            item_ids=[i.id for i in acq.items], bands={"vv_db": vv, "vh_db": vh}, valid=valid,
            valid_fraction=float((valid & aoi_mask).sum() / max(1, aoi_mask.sum())),
            meta={"relative_orbit": acq.relative_orbit, "orbit_state": acq.orbit_state, "platform": acq.platform,
                  "product": "RTC gamma0 (terrain corrected), harmonised to sigma0 dB (-1.1 dB at 39 deg incidence)",
                  "aoi_coverage": round(acq.aoi_coverage, 4)},
        )

    def scl_fractions(self, acq: Acquisition, grid: Grid, aoi_mask: np.ndarray) -> tuple[float, float]:
        """(cloud fraction, valid fraction) over the AOI from the Scene Classification layer."""
        scl = self.mosaic(acq.items, "SCL", grid, Resampling.nearest)
        has = np.isfinite(scl) & (np.nan_to_num(scl) != SCL_NODATA) & aoi_mask
        codes = np.nan_to_num(scl, nan=0).astype(np.int16)
        cloudy = np.isin(codes, SCL_CLOUDY) & has
        valid = np.isin(codes, SCL_VALID) & has
        n_aoi = max(1, int(aoi_mask.sum()))
        return float(cloudy.sum() / max(1, has.sum())), float(valid.sum() / n_aoi)

    def read_s2(self, acq: Acquisition, grid: Grid, role: str, aoi_mask: np.ndarray) -> SensorObservation:
        def to_refl(item: SceneItem, dn: np.ndarray) -> np.ndarray:
            r = (dn + s2_offset(item)) / 10000.0
            r[dn <= 0] = np.nan
            return np.clip(r, 0.0, None)

        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            futs = {b: pool.submit(self.mosaic, acq.items, b, grid, Resampling.average, to_refl) for b in S2_BANDS}
            f_scl = pool.submit(self.mosaic, acq.items, "SCL", grid, Resampling.nearest)
            bands = {b: f.result() for b, f in futs.items()}
            scl = f_scl.result()
        codes = np.nan_to_num(scl, nan=0).astype(np.int16)
        has = codes != SCL_NODATA
        valid = np.isin(codes, SCL_VALID) & np.all(np.stack([np.isfinite(v) for v in bands.values()]), axis=0)
        cloudy = np.isin(codes, SCL_CLOUDY)
        n_has = max(1, int((has & aoi_mask).sum()))
        return SensorObservation(
            sensor="S2", role=role, acquired_at=acq.datetime, collection=acq.items[0].collection,
            item_ids=[i.id for i in acq.items], bands=bands, valid=valid,
            cloud_fraction=float((cloudy & aoi_mask).sum() / n_has),
            valid_fraction=float((valid & aoi_mask).sum() / max(1, aoi_mask.sum())),
            meta={"platform": acq.platform, "processing_baselines": acq.meta.get("processing_baselines"),
                  "mgrs_tiles": acq.meta.get("mgrs_tiles"), "tile_cloud_cover": acq.cloud_cover,
                  "product": "L2A surface reflectance (BOA offset applied), SCL cloud/shadow mask",
                  "aoi_coverage": round(acq.aoi_coverage, 4)},
        )

    # ------------------------------------------------------------------ context
    def read_context(self, aoi: AOI, grid: Grid) -> ContextLayers:
        ctx = ContextLayers()
        prov: dict[str, Any] = {}

        def layer(collection: str, asset: str, resampling: Resampling, clean: Callable[[np.ndarray], np.ndarray]):
            try:
                items = self.pc.context_items(collection, aoi)
                if not items:
                    prov[collection] = {"status": "unavailable", "reason": "no items cover the AOI"}
                    return None
                arr = clean(self.mosaic(items, asset, grid, resampling))
                prov[collection] = {"status": "ok", "items": [i.id for i in items][:6]}
                return arr
            except (RasterReadError, SourceUnavailableError) as exc:
                prov[collection] = {"status": "unavailable", "reason": str(exc)[:300]}
                return None

        with ThreadPoolExecutor(max_workers=3) as pool:
            f_dem = pool.submit(layer, DEM_COLLECTION, "data", Resampling.bilinear, lambda a: np.where(a < -500, np.nan, a))
            f_occ = pool.submit(layer, JRC_COLLECTION, "occurrence", Resampling.bilinear,
                                lambda a: np.where((a < 0) | (a > 100), np.nan, a))
            f_lc = pool.submit(layer, WORLDCOVER_COLLECTION, "map", Resampling.mode,
                               lambda a: np.where(a <= 0, np.nan, a))
            ctx.dem, ctx.water_occurrence, ctx.landcover = f_dem.result(), f_occ.result(), f_lc.result()
        if ctx.water_occurrence is not None:
            # JRC occurrence is undefined (no-data) where water was never observed: that means 0 %
            ctx.water_occurrence = np.nan_to_num(ctx.water_occurrence, nan=0.0).astype(np.float32)
        ctx.provenance = prov
        return ctx
