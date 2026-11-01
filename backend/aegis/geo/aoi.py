"""Area-of-interest parsing, validation and projection helpers."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from pyproj import Geod
from shapely import make_valid
from shapely.geometry import MultiPolygon, Polygon, box, mapping, shape
from shapely.geometry.base import BaseGeometry

_GEOD = Geod(ellps="WGS84")


class AOIValidationError(ValueError):
    """Raised for malformed or unsupported areas of interest (message is user-facing)."""


def geodesic_area_km2(geom: BaseGeometry) -> float:
    """Area on the WGS84 ellipsoid of a lon/lat geometry, in km^2."""
    if geom.is_empty:
        return 0.0
    area, _ = _GEOD.geometry_area_perimeter(geom)
    return abs(area) / 1e6


def utm_epsg_for(lon: float, lat: float) -> int:
    zone = int(math.floor((lon + 180.0) / 6.0)) % 60 + 1
    return (32600 if lat >= 0 else 32700) + zone


@dataclass(frozen=True)
class AOI:
    geometry: Polygon | MultiPolygon  # WGS84 lon/lat

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return tuple(round(v, 7) for v in self.geometry.bounds)  # type: ignore[return-value]

    @property
    def area_km2(self) -> float:
        return geodesic_area_km2(self.geometry)

    @property
    def centroid(self) -> tuple[float, float]:
        c = self.geometry.centroid
        return (c.x, c.y)

    @property
    def utm_epsg(self) -> int:
        lon, lat = self.centroid
        return utm_epsg_for(lon, lat)

    def to_geojson(self) -> dict[str, Any]:
        return mapping(self.geometry)  # type: ignore[return-value]

    # ------------------------------------------------------------------ constructors
    @classmethod
    def from_bbox(cls, minx: float, miny: float, maxx: float, maxy: float) -> AOI:
        if not (minx < maxx and miny < maxy):
            raise AOIValidationError("bounding box must satisfy min < max for both axes")
        return cls._validated(box(minx, miny, maxx, maxy))

    @classmethod
    def from_geojson(cls, obj: dict[str, Any]) -> AOI:
        if not isinstance(obj, dict) or "type" not in obj:
            raise AOIValidationError("AOI must be a GeoJSON object with a 'type'")
        if obj["type"] == "FeatureCollection":
            feats = obj.get("features") or []
            if len(feats) != 1:
                raise AOIValidationError("FeatureCollection AOI must contain exactly one feature")
            obj = feats[0]
        if obj["type"] == "Feature":
            obj = obj.get("geometry") or {}
        try:
            geom = shape(obj)
        except Exception as exc:  # shapely raises various errors for malformed input
            raise AOIValidationError(f"invalid GeoJSON geometry: {exc}") from exc
        return cls._validated(geom)

    @classmethod
    def _validated(cls, geom: BaseGeometry) -> AOI:
        if geom.is_empty:
            raise AOIValidationError("AOI geometry is empty")
        if geom.geom_type not in ("Polygon", "MultiPolygon"):
            raise AOIValidationError(f"AOI must be a Polygon or MultiPolygon, got {geom.geom_type}")
        if not geom.is_valid:
            geom = make_valid(geom)
            polys = [g for g in getattr(geom, "geoms", [geom]) if g.geom_type in ("Polygon", "MultiPolygon")]
            if not polys:
                raise AOIValidationError("AOI geometry is invalid and could not be repaired")
            geom = polys[0] if len(polys) == 1 else MultiPolygon([p for g in polys for p in getattr(g, "geoms", [g])])
        minx, miny, maxx, maxy = geom.bounds
        if not all(math.isfinite(v) for v in (minx, miny, maxx, maxy)):
            raise AOIValidationError("AOI coordinates must be finite numbers")
        if minx < -180 or maxx > 180 or miny < -90 or maxy > 90:
            raise AOIValidationError(
                "AOI coordinates are outside lon/lat range; coordinates must be WGS84 (EPSG:4326) longitude, latitude"
            )
        if maxx - minx > 180:
            raise AOIValidationError("AOIs crossing the antimeridian are not supported; split the area in two")
        if miny < -80 or maxy > 84:
            raise AOIValidationError("AOI must lie between 80S and 84N (UTM processing domain)")
        return cls(geometry=geom)  # type: ignore[arg-type]

    def validate_size(self, min_km2: float, max_km2: float) -> None:
        a = self.area_km2
        if a < min_km2:
            raise AOIValidationError(f"AOI is too small ({a:.3f} km2); minimum is {min_km2} km2")
        if a > max_km2:
            raise AOIValidationError(
                f"AOI is too large ({a:.0f} km2); maximum is {max_km2:.0f} km2 per analysis. "
                "Split the area into smaller analyses."
            )
