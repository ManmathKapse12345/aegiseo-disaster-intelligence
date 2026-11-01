"""Raster I/O: reading remote Cloud-Optimized GeoTIFFs onto the analysis grid,
local GeoTIFF caching, and rendering display overlays in Web Mercator."""

from __future__ import annotations

import io
import logging
from collections.abc import Callable
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from rasterio.warp import calculate_default_transform, reproject

from aegis.geo.grid import Grid

log = logging.getLogger(__name__)

# GDAL settings for efficient and resilient HTTP range reads of COGs.
GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.tiff,.TIF,.TIFF,.vrt",
    "GDAL_HTTP_MAX_RETRY": "4",
    "GDAL_HTTP_RETRY_DELAY": "1.5",
    # A hard per-request timeout makes multi-MB range reads fail and retry forever on a slow or
    # shared link; abort only stalled transfers (< 2 KB/s for 45 s) and keep a generous ceiling.
    "GDAL_HTTP_TIMEOUT": "300",
    "GDAL_HTTP_LOW_SPEED_TIME": "45",
    "GDAL_HTTP_LOW_SPEED_LIMIT": "2048",
    "GDAL_HTTP_CONNECTTIMEOUT": "15",
    "GDAL_HTTP_MULTIRANGE": "YES",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "VSI_CACHE": "TRUE",
    "VSI_CACHE_SIZE": str(64 * 1024 * 1024),
    "GDAL_NUM_THREADS": "ALL_CPUS",
}


class RasterReadError(RuntimeError):
    pass


def read_to_grid(
    href: str,
    grid: Grid,
    *,
    band: int = 1,
    resampling: Resampling = Resampling.bilinear,
    src_nodata: float | None = None,
    scale: float = 1.0,
    offset: float = 0.0,
) -> np.ndarray:
    """Warp one band of a (local or remote) raster onto ``grid``; invalid pixels become NaN."""
    warp = {"crs": grid.crs, "transform": grid.transform, "width": grid.width, "height": grid.height, "resampling": resampling}
    try:
        with rasterio.Env(**GDAL_ENV), rasterio.open(href) as src:
            nodata = src_nodata if src_nodata is not None else src.nodata
            if nodata is not None:
                with WarpedVRT(src, src_nodata=nodata, nodata=nodata, **warp) as vrt:
                    data = vrt.read(band, out_dtype="float32", masked=True).filled(np.nan)
            else:
                # No declared no-data: an alpha band marks pixels outside the source footprint,
                # so genuine zero values are preserved (no value rewriting by the warper).
                with WarpedVRT(src, add_alpha=True, **warp) as vrt:
                    data = vrt.read(band, out_dtype="float32")
                    data[vrt.read(vrt.count) == 0] = np.nan
    except (rasterio.errors.RasterioIOError, rasterio.errors.WarpOperationError) as exc:
        raise RasterReadError(f"cannot read raster: {exc}") from exc
    if scale != 1.0 or offset != 0.0:
        data = data * scale + offset
    return data


def write_geotiff(path: Path, bands: dict[str, np.ndarray], grid: Grid, *, dtype: str = "float32") -> Path:
    """Write named bands as a compressed, tiled GeoTIFF (band names stored as descriptions)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    names = list(bands)
    tmp = path.with_suffix(".tmp.tif")
    profile = {
        "driver": "GTiff",
        "height": grid.height,
        "width": grid.width,
        "count": len(names),
        "dtype": dtype,
        "crs": grid.crs,
        "transform": grid.transform,
        "compress": "deflate",
        "predictor": 3 if dtype.startswith("float") else 2,
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
        "nodata": np.nan if dtype.startswith("float") else None,
    }
    if grid.width < 256 or grid.height < 256:
        profile.update(tiled=False)
        profile.pop("blockxsize")
        profile.pop("blockysize")
    with rasterio.open(tmp, "w", **profile) as dst:
        for i, name in enumerate(names, start=1):
            dst.write(bands[name].astype(dtype), i)
            dst.set_band_description(i, name)
    tmp.replace(path)
    return path


def read_geotiff(path: Path) -> dict[str, np.ndarray]:
    with rasterio.open(path) as src:
        return {src.descriptions[i - 1] or f"b{i}": src.read(i) for i in range(1, src.count + 1)}


# ----------------------------------------------------------------------------- display rendering
def percentile_stretch(arr: np.ndarray, lo: float = 2, hi: float = 98, valid: np.ndarray | None = None) -> np.ndarray:
    m = np.isfinite(arr) if valid is None else (valid & np.isfinite(arr))
    if not m.any():
        return np.zeros(arr.shape, dtype=np.uint8)
    p_lo, p_hi = np.percentile(arr[m], [lo, hi])
    if p_hi <= p_lo:
        p_hi = p_lo + 1e-6
    out = np.clip((arr - p_lo) / (p_hi - p_lo), 0, 1)
    return (np.nan_to_num(out) * 255).astype(np.uint8)


def rgb_composite(r: np.ndarray, g: np.ndarray, b: np.ndarray, *, gain: float = 3.2, gamma: float = 1.0) -> np.ndarray:
    """True-colour composite from reflectance (0-1) with a fixed gain (comparable across dates)."""
    stack = np.stack([r, g, b], axis=-1)
    valid = np.all(np.isfinite(stack), axis=-1)
    img = np.clip(np.nan_to_num(stack) * gain, 0, 1) ** (1.0 / gamma)
    rgba = np.zeros((*r.shape, 4), dtype=np.uint8)
    rgba[..., :3] = (img * 255).astype(np.uint8)
    rgba[..., 3] = np.where(valid, 255, 0)
    return rgba


def gray_composite(arr: np.ndarray, vmin: float, vmax: float) -> np.ndarray:
    valid = np.isfinite(arr)
    v = (np.clip((np.nan_to_num(arr, nan=vmin) - vmin) / (vmax - vmin), 0, 1) * 255).astype(np.uint8)
    rgba = np.stack([v, v, v, np.where(valid, 255, 0).astype(np.uint8)], axis=-1)
    return rgba


def colormap_composite(
    arr: np.ndarray,
    stops: list[tuple[float, tuple[int, int, int, int]]],
    *,
    transparent_below: float | None = None,
) -> np.ndarray:
    """Piecewise-linear colour ramp; ``stops`` = [(value, (r, g, b, a)), ...] sorted by value."""
    vals = np.array([s[0] for s in stops], dtype=np.float32)
    cols = np.array([s[1] for s in stops], dtype=np.float32)
    x = np.nan_to_num(arr, nan=vals[0] - 1)
    out = np.zeros((*arr.shape, 4), dtype=np.uint8)
    for ch in range(4):
        out[..., ch] = np.interp(x, vals, cols[:, ch]).astype(np.uint8)
    invalid = ~np.isfinite(arr)
    if transparent_below is not None:
        invalid |= np.nan_to_num(arr, nan=-np.inf) < transparent_below
    out[invalid, 3] = 0
    return out


def categorical_composite(arr: np.ndarray, palette: dict[int, tuple[int, int, int, int]]) -> np.ndarray:
    out = np.zeros((*arr.shape, 4), dtype=np.uint8)
    a = np.nan_to_num(arr, nan=-1).astype(np.int32)
    for value, color in palette.items():
        out[a == value] = color
    return out


def rgba_to_web_mercator(rgba: np.ndarray, grid: Grid, max_dim: int = 2048) -> tuple[np.ndarray, list[list[float]]]:
    """Reproject an RGBA overlay to EPSG:3857 and return it with MapLibre image-source corners."""
    src_bounds = grid.bounds
    dst_crs = "EPSG:3857"
    transform, width, height = calculate_default_transform(
        grid.crs, dst_crs, grid.width, grid.height, *src_bounds
    )
    scale = max(width, height) / max_dim
    if scale > 1:
        width, height = int(width / scale), int(height / scale)
        transform, width, height = calculate_default_transform(
            grid.crs, dst_crs, grid.width, grid.height, *src_bounds, dst_width=width, dst_height=height
        )
    out = np.zeros((4, height, width), dtype=np.uint8)
    for ch in range(4):
        reproject(
            source=np.ascontiguousarray(rgba[..., ch]),
            destination=out[ch],
            src_transform=grid.transform,
            src_crs=grid.crs,
            dst_transform=transform,
            dst_crs=dst_crs,
            resampling=Resampling.nearest,
            src_nodata=0,  # 0 = transparent; declaring it avoids GDAL rewriting real zeros to 1
            dst_nodata=0,
        )
    from pyproj import Transformer

    tr = Transformer.from_crs(dst_crs, "EPSG:4326", always_xy=True)
    x0, y0 = transform.c, transform.f
    x1, y1 = x0 + width * transform.a, y0 + height * transform.e
    corners = [tr.transform(x0, y0), tr.transform(x1, y0), tr.transform(x1, y1), tr.transform(x0, y1)]
    return np.moveaxis(out, 0, -1), [[round(c[0], 7), round(c[1], 7)] for c in corners]


def png_bytes(rgba: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def save_overlay(path: Path, rgba: np.ndarray, grid: Grid) -> list[list[float]]:
    """Write a Web-Mercator PNG overlay and return its corner coordinates."""
    merc, corners = rgba_to_web_mercator(rgba, grid)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png_bytes(merc))
    return corners


Renderer = Callable[[np.ndarray], np.ndarray]
