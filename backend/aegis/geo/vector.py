"""Raster-to-vector conversion and geometry utilities."""

from __future__ import annotations

from typing import Any

import numpy as np
import shapely
from rasterio.features import shapes
from scipy import ndimage
from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry

from aegis.geo.grid import Grid


def remove_small_components(mask: np.ndarray, min_pixels: int) -> np.ndarray:
    """Drop connected components (8-connectivity) smaller than ``min_pixels``."""
    if min_pixels <= 1 or not mask.any():
        return mask.copy()
    labels, n = ndimage.label(mask, structure=np.ones((3, 3), dtype=bool))
    if n == 0:
        return mask.copy()
    sizes = np.bincount(labels.ravel())
    keep = sizes >= min_pixels
    keep[0] = False
    return keep[labels]


def clean_mask(mask: np.ndarray, min_pixels: int, open_iter: int = 1) -> np.ndarray:
    """Morphological opening (removes speckle) + minimum-mapping-unit filter."""
    m = mask.astype(bool)
    if open_iter > 0 and m.any():
        m = ndimage.binary_opening(m, structure=np.ones((3, 3), dtype=bool), iterations=open_iter)
    return remove_small_components(m, min_pixels)


def label_components(mask: np.ndarray) -> tuple[np.ndarray, int]:
    return ndimage.label(mask, structure=np.ones((3, 3), dtype=bool))


def mask_to_polygons(mask: np.ndarray, grid: Grid, simplify_m: float | None = None) -> list[BaseGeometry]:
    """Vectorise a boolean mask into polygons in the grid CRS."""
    if not mask.any():
        return []
    tol = grid.resolution * 0.5 if simplify_m is None else simplify_m
    polys = []
    for geom, value in shapes(mask.astype(np.uint8), mask=mask.astype(bool), transform=grid.transform, connectivity=8):
        if value != 1:
            continue
        poly = shape(geom)
        if tol > 0:
            poly = poly.simplify(tol, preserve_topology=True)
        if not poly.is_empty and poly.area > 0:
            polys.append(poly)
    return polys


def to_wgs84(geom: BaseGeometry, grid: Grid) -> BaseGeometry:
    return shapely.transform(geom, grid.to_wgs84.transform, interleaved=False)


def from_wgs84(geom: BaseGeometry, grid: Grid) -> BaseGeometry:
    return shapely.transform(geom, grid.from_wgs84.transform, interleaved=False)


def feature(geom: BaseGeometry, properties: dict[str, Any], fid: str | None = None) -> dict[str, Any]:
    f: dict[str, Any] = {"type": "Feature", "geometry": mapping(geom), "properties": properties}
    if fid is not None:
        f["id"] = fid
    return f


def feature_collection(features: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": features, **extra}


def round_coords(geojson_geom: dict[str, Any], ndigits: int = 6) -> dict[str, Any]:
    """Round coordinates to keep payloads compact (6 decimals ~ 0.1 m)."""

    def _r(c: Any) -> Any:
        if isinstance(c, (list, tuple)):
            if c and isinstance(c[0], (int, float)):
                return [round(float(v), ndigits) for v in c]
            return [_r(x) for x in c]
        return c

    return {**geojson_geom, "coordinates": _r(geojson_geom["coordinates"])}
