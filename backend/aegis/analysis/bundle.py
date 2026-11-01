"""Co-registered multi-sensor data for one analysis (the agent's observation)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

import numpy as np

from aegis.geo.grid import Grid

Sensor = Literal["S1", "S2"]
Role = Literal["pre", "post"]


@dataclass
class SensorObservation:
    """One sensor at one epoch, resampled onto the analysis grid.

    S1 bands: ``vv_db``, ``vh_db`` (sigma0-harmonised backscatter in dB, NaN = no data)
    S2 bands: ``B02 B03 B04 B08 B11 B12`` surface reflectance (0-1); ``valid`` excludes
    no-data, cloud, cloud shadow, cirrus and snow according to the scene classification.
    """

    sensor: Sensor
    role: Role
    acquired_at: datetime
    collection: str
    item_ids: list[str]
    bands: dict[str, np.ndarray]
    valid: np.ndarray
    cloud_fraction: float | None = None      # share of AOI pixels flagged cloud/shadow (S2)
    valid_fraction: float = 0.0              # share of AOI pixels with usable data
    meta: dict[str, Any] = field(default_factory=dict)
    synthetic: bool = False

    def summary(self) -> dict[str, Any]:
        return {
            "sensor": self.sensor,
            "role": self.role,
            "acquired_at": self.acquired_at.isoformat(),
            "collection": self.collection,
            "item_ids": self.item_ids,
            "cloud_fraction": None if self.cloud_fraction is None else round(float(self.cloud_fraction), 4),
            "valid_fraction": round(float(self.valid_fraction), 4),
            "meta": self.meta,
            "synthetic": self.synthetic,
        }


@dataclass
class ContextLayers:
    dem: np.ndarray | None = None                 # metres above sea level
    water_occurrence: np.ndarray | None = None    # JRC GSW occurrence, percent of time water 1984-2021
    landcover: np.ndarray | None = None           # ESA WorldCover 2021 class codes
    population: np.ndarray | None = None          # people per pixel (only for synthetic scenes)
    provenance: dict[str, Any] = field(default_factory=dict)

    @property
    def permanent_water(self) -> np.ndarray | None:
        if self.water_occurrence is None:
            return None
        return np.nan_to_num(self.water_occurrence, nan=0.0) >= 80.0


@dataclass
class SceneBundle:
    grid: Grid
    aoi_mask: np.ndarray
    observations: dict[tuple[str, str], SensorObservation] = field(default_factory=dict)
    context: ContextLayers = field(default_factory=ContextLayers)
    synthetic: bool = False
    truth: dict[str, np.ndarray] = field(default_factory=dict)   # synthetic ground truth only

    def get(self, sensor: str, role: str) -> SensorObservation | None:
        return self.observations.get((sensor, role))

    def has(self, sensor: str, role: str) -> bool:
        return (sensor, role) in self.observations

    def availability(self) -> dict[str, bool]:
        return {f"{s}_{r}": self.has(s, r) for s in ("S1", "S2") for r in ("pre", "post")}


# ESA WorldCover 2021 legend
WORLDCOVER_CLASSES: dict[int, str] = {
    10: "Tree cover",
    20: "Shrubland",
    30: "Grassland",
    40: "Cropland",
    50: "Built-up",
    60: "Bare / sparse vegetation",
    70: "Snow and ice",
    80: "Permanent water bodies",
    90: "Herbaceous wetland",
    95: "Mangroves",
    100: "Moss and lichen",
}
