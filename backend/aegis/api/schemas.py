"""Request / response models for the HTTP API."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Hazard = Literal["flood", "wildfire", "landslide"]


class WeightsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    extent: float = Field(0.55, ge=0, le=10)
    intensity: float = Field(0.45, ge=0, le=10)
    population: float = Field(0.45, ge=0, le=10)
    critical_facilities: float = Field(0.35, ge=0, le=10)
    access: float = Field(0.20, ge=0, le=10)
    hazard_exponent: float = Field(0.5, ge=0.05, le=0.95)


class DetectionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prob_threshold: float = Field(0.5, ge=0.2, le=0.9)
    min_mapping_unit_ha: float = Field(0.5, ge=0.05, le=20)
    mc_samples: int = Field(6, ge=1, le=16)
    max_hand_m: float = Field(15.0, ge=2, le=100)
    max_slope_deg: float = Field(8.0, ge=1, le=45)
    dnbr_threshold: float = Field(0.10, ge=0.05, le=0.5)


class SyntheticIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seed: int = Field(7, ge=0, le=10_000)
    cloud_cover_post: float = Field(0.3, ge=0, le=1)
    cloud_cover_pre: float = Field(0.05, ge=0, le=1)
    include_s1: bool = True
    include_s2: bool = True
    include_pre: bool = True
    s1_same_orbit: bool = True
    corrupt_s2_post: bool = False
    flood_level_m: float = Field(5.0, ge=1, le=12)


class AnalysisCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=3, max_length=120)
    hazard: Hazard
    mode: Literal["real", "synthetic"] = "real"
    aoi: dict[str, Any] | None = Field(None, description="GeoJSON Polygon/MultiPolygon (or Feature) in EPSG:4326")
    bbox: tuple[float, float, float, float] | None = Field(None, description="[min_lon, min_lat, max_lon, max_lat]")
    event_date: date
    pre_window: tuple[date, date] | None = None
    post_window: tuple[date, date] | None = None
    resolution_m: float = Field(20.0, ge=10, le=100)
    weights: WeightsIn | None = None
    detection: DetectionIn | None = None
    synthetic: SyntheticIn | None = None
    scenario_id: str | None = Field(None, max_length=64)
    fail_tools: list[str] = Field(default_factory=list, max_length=10, description="fault injection (synthetic mode only)")

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if any(c in v for c in "<>{}"):
            raise ValueError("name must not contain angle or curly brackets")
        return v

    @model_validator(mode="after")
    def _aoi_required(self) -> AnalysisCreate:
        if self.mode == "real" and self.aoi is None and self.bbox is None:
            raise ValueError("provide either 'aoi' (GeoJSON) or 'bbox' for real-data analyses")
        if self.fail_tools and self.mode != "synthetic":
            raise ValueError("fault injection is only available for synthetic analyses")
        return self


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approve", "reject"]
    note: str | None = Field(None, max_length=2000)


class ReviewDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["confirm", "false_positive", "acknowledge", "request_rerun"]
    comment: str | None = Field(None, max_length=2000)


class PriorityOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Literal["Critical", "High", "Moderate", "Low"] | None = Field(None, description="null clears the override")
    reason: str = Field(min_length=5, max_length=2000)


class CatalogPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bbox: tuple[float, float, float, float]
    event_date: date
    pre_window: tuple[date, date] | None = None
    post_window: tuple[date, date] | None = None


class BenchmarkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    suite: Literal["agent", "quick"] = "agent"
