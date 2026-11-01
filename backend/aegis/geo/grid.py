"""The common analysis grid onto which every sensor and context layer is co-registered."""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from functools import cached_property

import numpy as np
import shapely
from affine import Affine
from pyproj import CRS, Transformer
from rasterio.features import rasterize

from aegis.geo.aoi import AOI


@dataclass(frozen=True)
class Grid:
    crs: str
    transform: Affine
    width: int
    height: int

    @property
    def resolution(self) -> float:
        return float(self.transform.a)

    @property
    def shape(self) -> tuple[int, int]:
        return (self.height, self.width)

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        minx, maxy = self.transform.c, self.transform.f
        return (minx, maxy - self.height * self.resolution, minx + self.width * self.resolution, maxy)

    @property
    def pixel_area_km2(self) -> float:
        return (self.resolution**2) / 1e6

    @cached_property
    def to_wgs84(self) -> Transformer:
        return Transformer.from_crs(CRS.from_user_input(self.crs), CRS.from_epsg(4326), always_xy=True)

    @cached_property
    def from_wgs84(self) -> Transformer:
        return Transformer.from_crs(CRS.from_epsg(4326), CRS.from_user_input(self.crs), always_xy=True)

    def bounds_wgs84(self) -> tuple[float, float, float, float]:
        minx, miny, maxx, maxy = self.bounds
        xs, ys = self.to_wgs84.transform([minx, maxx, maxx, minx], [miny, miny, maxy, maxy])
        return (min(xs), min(ys), max(xs), max(ys))

    def key(self) -> str:
        raw = f"{self.crs}|{tuple(round(v, 6) for v in self.transform[:6])}|{self.width}x{self.height}"
        return hashlib.sha1(raw.encode(), usedforsecurity=False).hexdigest()[:16]

    def to_dict(self) -> dict:
        return {
            "crs": self.crs,
            "transform": list(self.transform)[:6],
            "width": self.width,
            "height": self.height,
            "resolution_m": self.resolution,
        }

    @classmethod
    def from_dict(cls, d: dict) -> Grid:
        return cls(crs=d["crs"], transform=Affine(*d["transform"]), width=int(d["width"]), height=int(d["height"]))

    def aoi_mask(self, aoi: AOI) -> np.ndarray:
        geom = shapely.transform(aoi.geometry, self.from_wgs84.transform, interleaved=False)
        return rasterize([(geom, 1)], out_shape=self.shape, transform=self.transform, fill=0, dtype="uint8").astype(bool)

    def pixel_centers_wgs84(self, rows: np.ndarray, cols: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        xs = self.transform.c + (cols + 0.5) * self.resolution
        ys = self.transform.f - (rows + 0.5) * self.resolution
        lon, lat = self.to_wgs84.transform(xs, ys)
        return np.asarray(lon), np.asarray(lat)

    # ------------------------------------------------------------------ constructor
    @classmethod
    def for_aoi(cls, aoi: AOI, resolution_m: float, max_pixels: int) -> Grid:
        """UTM grid covering the AOI, snapped to the resolution.

        If the AOI at the requested resolution would exceed ``max_pixels`` the resolution
        is coarsened (in 10 m steps) so memory and runtime stay bounded.
        """
        epsg = aoi.utm_epsg
        tr = Transformer.from_crs(CRS.from_epsg(4326), CRS.from_epsg(epsg), always_xy=True)
        geom = shapely.transform(aoi.geometry, tr.transform, interleaved=False)
        minx, miny, maxx, maxy = geom.bounds
        res = float(resolution_m)
        while True:
            x0, y1 = math.floor(minx / res) * res, math.ceil(maxy / res) * res
            x1, y0 = math.ceil(maxx / res) * res, math.floor(miny / res) * res
            w, h = int(round((x1 - x0) / res)), int(round((y1 - y0) / res))
            if w * h <= max_pixels:
                break
            res = math.ceil(res * math.sqrt((w * h) / max_pixels) / 10.0) * 10.0
        return cls(crs=f"EPSG:{epsg}", transform=Affine(res, 0.0, x0, 0.0, -res, y1), width=max(w, 1), height=max(h, 1))
