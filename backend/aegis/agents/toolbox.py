"""Concrete tools available to the agents, bound to data sources and analysis services.

Real and synthetic runs expose the *same tool names*; in synthetic mode the acquisition and
context tools are backed by the simulated scene, so the agent logic is identical. Fault
injection (``fail_tools``) makes chosen tools raise ``SourceUnavailableError`` to test
graceful degradation in benchmarks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time
from typing import Any

import numpy as np

from aegis.agents.memory import KnowledgeBase, get_knowledge_base, similar_cases
from aegis.agents.tools import SideEffect, Tool
from aegis.analysis.bundle import ContextLayers, SceneBundle
from aegis.analysis.hazards import (
    DetectionParams,
    HazardResult,
    InsufficientDataError,
    detect_burn,
    detect_flood,
    detect_landslide,
)
from aegis.analysis.impact import ImpactResult, PopulationEstimate, assess_impact
from aegis.analysis.prioritize import PriorityWeights, prioritize
from aegis.config import Settings, get_settings
from aegis.db import session_scope
from aegis.geo.aoi import AOI
from aegis.geo.grid import Grid
from aegis.ml.inference import WaterSegmenter, get_segmenter
from aegis.net.http import SourceUnavailableError
from aegis.sources.feeds import HazardFeeds
from aegis.sources.imagery import ImageryReader
from aegis.sources.osm import OverpassClient
from aegis.sources.population import PopulationSource, dasymetric_raster
from aegis.sources.stac import Acquisition, PlanetaryComputer
from aegis.synthetic import SyntheticConfig, SyntheticScene, make_scene


@dataclass
class Services:
    settings: Settings
    pc: PlanetaryComputer
    reader: ImageryReader
    osm: OverpassClient
    population: PopulationSource
    feeds: HazardFeeds
    segmenter: WaterSegmenter
    kb: KnowledgeBase

    @classmethod
    def default(cls, settings: Settings | None = None) -> Services:
        s = settings or get_settings()
        pc = PlanetaryComputer(s)
        variant, specialist = s.deployed_model()
        return cls(settings=s, pc=pc, reader=ImageryReader(pc, s), osm=OverpassClient(s), population=PopulationSource(s),
                   feeds=HazardFeeds(s), segmenter=get_segmenter(s.models_dir, variant, s.torch_device, s.mc_dropout_samples, specialist),
                   kb=get_knowledge_base())


@dataclass
class SyntheticBinding:
    scene: SyntheticScene | None = None
    config: SyntheticConfig = field(default_factory=SyntheticConfig)


def _acq_summary(v: list[Acquisition]) -> dict[str, Any]:
    return {"acquisitions": len(v), "dates": [a.datetime.date().isoformat() for a in v][:12]}


def _obs_summary(o: Any) -> dict[str, Any]:
    return o.summary() if o is not None else {"observation": None}


def _result_summary(r: HazardResult) -> dict[str, Any]:
    return {"method": r.method, "affected_area_km2": r.stats.get("affected_area_km2"),
            "agreement": r.quality.get("cross_method_agreement"), "model": r.model_info.get("version")}


def _impact_summary(r: ImpactResult) -> dict[str, Any]:
    return {"population_exposed": r.population.get("potentially_exposed"), "facility_counts": r.facility_counts,
            "road_km_affected": r.roads.get("affected_km")}


def build_tools(services: Services, fail_tools: set[str] | None = None, synthetic: SyntheticBinding | None = None) -> list[Tool]:
    fail_tools = fail_tools or set()
    s = services

    def guard(name: str):
        if name in fail_tools:
            raise SourceUnavailableError(name, "simulated outage (fault injection)")

    # ---------------------------------------------------------------- acquisition
    def search_imagery(sensor: str, aoi: AOI, start: date, end: date) -> list[Acquisition]:
        guard("search_imagery")
        return s.pc.find_acquisitions(sensor, aoi, datetime.combine(start, time.min, tzinfo=UTC),
                                      datetime.combine(end, time.max, tzinfo=UTC))

    def assess_cloud_cover(acquisition: Acquisition, grid: Grid, aoi_mask: np.ndarray) -> dict[str, float]:
        guard("assess_cloud_cover")
        cloud, valid = s.reader.scl_fractions(acquisition, grid, aoi_mask)
        return {"cloud_fraction": cloud, "valid_fraction": valid}

    def load_s1(acquisition: Acquisition, grid: Grid, role: str, aoi_mask: np.ndarray):
        guard("load_s1")
        return s.reader.read_s1(acquisition, grid, role, aoi_mask)

    def load_s2(acquisition: Acquisition, grid: Grid, role: str, aoi_mask: np.ndarray):
        guard("load_s2")
        return s.reader.read_s2(acquisition, grid, role, aoi_mask)

    def load_context_layers(aoi: AOI, grid: Grid) -> ContextLayers:
        guard("load_context_layers")
        return s.reader.read_context(aoi, grid)

    def load_synthetic_scene(config: SyntheticConfig) -> SyntheticScene:
        scene = make_scene(config)
        if synthetic is not None:
            synthetic.scene = scene
        return scene

    # ---------------------------------------------------------------- perception
    def detect_change(hazard: str, bundle: SceneBundle, params: DetectionParams, hotspots: list[dict] | None = None,
                      exclude: tuple[str, ...] = ()) -> HazardResult:
        guard("detect_change")
        b = bundle
        if exclude:
            b = SceneBundle(grid=bundle.grid, aoi_mask=bundle.aoi_mask, context=bundle.context, synthetic=bundle.synthetic,
                            truth=bundle.truth,
                            observations={k: v for k, v in bundle.observations.items() if f"{k[0]}_{k[1]}" not in exclude})
        if hazard == "flood":
            return detect_flood(b, s.segmenter, params)
        if hazard == "wildfire":
            return detect_burn(b, params, hotspots)
        if hazard == "landslide":
            return detect_landslide(b, params)
        raise InsufficientDataError(f"unsupported hazard {hazard}")

    # ---------------------------------------------------------------- context / exposure
    def query_infrastructure(bbox: tuple[float, float, float, float]) -> tuple[list[dict], dict]:
        guard("query_infrastructure")
        if synthetic is not None and synthetic.scene is not None:
            return synthetic.scene.infrastructure, {"status": "ok", "source": "synthetic infrastructure (simulated)",
                                                    "features": len(synthetic.scene.infrastructure)}
        return s.osm.fetch(bbox)

    def query_population(aoi: AOI, grid: Grid, aoi_mask: np.ndarray, landcover: np.ndarray | None,
                         affected_geometry: dict | None = None) -> PopulationEstimate:
        guard("query_population")
        if synthetic is not None and synthetic.scene is not None:
            return PopulationEstimate(available=True, source="synthetic population raster (simulated)", year=None,
                                      pixel_raster=synthetic.scene.bundle.context.population, method="synthetic gridded population")
        raster, info = s.population.hrsl_on_grid(aoi, grid)
        wp_total, wp_info = s.population.worldpop_total(aoi.to_geojson())
        if raster is not None:
            return PopulationEstimate(
                available=True, source="Meta/CIESIN High Resolution Settlement Layer (~30 m)", year=None,
                pixel_raster=raster * aoi_mask, method="sum of HRSL population inside the detected extent (totals conserved when resampled)",
                note="HRSL is a model-based estimate (vintage varies by country, typically 2015-2020)."
                     + (f" WorldPop 2020 AOI estimate for comparison: {wp_total:,.0f}." if wp_total else ""),
                aoi_total=float((raster * aoi_mask).sum()),
                provenance={"hrsl": info, "worldpop": wp_info, "worldpop_aoi_total": wp_total},
            )
        if wp_total is not None and landcover is not None:
            ras = dasymetric_raster(wp_total, landcover, aoi_mask)
            if ras is not None:
                return PopulationEstimate(
                    available=True, source="WorldPop 2020 (100 m) AOI total, distributed dasymetrically over ESA WorldCover",
                    year=2020, pixel_raster=ras, method="dasymetric approximation (HRSL unavailable)",
                    note="Approximate: WorldPop AOI total allocated by land-cover class weights.", aoi_total=wp_total,
                    provenance={"hrsl": info, "worldpop": wp_info})
        reason = f"HRSL: {info.get('reason', info.get('status'))}; WorldPop: {wp_info.get('reason', wp_info.get('status'))}"
        return PopulationEstimate(available=False, source="none", note=reason, provenance={"hrsl": info, "worldpop": wp_info})

    def query_rainfall(lon: float, lat: float, start: date, end: date) -> tuple[dict, dict]:
        guard("query_rainfall")
        if synthetic is not None:
            raise SourceUnavailableError("open_meteo", "not queried for synthetic scenes")
        return s.feeds.rainfall(lon, lat, start, end)

    def query_active_fires(bbox: tuple[float, float, float, float], start: date, end: date) -> tuple[list[dict], dict]:
        guard("query_active_fires")
        if synthetic is not None and synthetic.scene is not None:
            return synthetic.scene.hotspots, {"status": "ok", "mode": "synthetic hotspots (simulated)"}
        return s.feeds.active_fires(bbox, start, end)

    def query_hazard_alerts(aoi: AOI) -> tuple[list[dict], dict]:
        guard("query_hazard_alerts")
        if synthetic is not None:
            return [], {"status": "skipped", "reason": "synthetic scene"}
        events, info = s.feeds.gdacs_events(days=30)
        lon, lat = aoi.centroid
        near = [e for e in events if abs(e["lon"] - lon) < 3 and abs(e["lat"] - lat) < 3]
        return near, info

    def compute_impact(result: HazardResult, bundle: SceneBundle, infrastructure: list[dict] | None,
                       population: PopulationEstimate | None) -> ImpactResult:
        return assess_impact(result, bundle, infrastructure, population)

    def prioritize_cells(result: HazardResult, impact: ImpactResult, bundle: SceneBundle, weights: PriorityWeights) -> dict:
        return prioritize(result, impact, bundle, weights)

    # ---------------------------------------------------------------- memory
    def retrieve_guidance(query: str, tags: list[str] | None = None, k: int = 4) -> list[dict]:
        return [p.as_dict(score) for p, score in s.kb.search(query, k=k, tags=tags)]

    def recall_similar_cases(bbox: tuple[float, float, float, float], hazard: str, exclude_id: str | None) -> list[dict]:
        with session_scope() as sess:
            return similar_cases(sess, bbox, hazard, exclude_id)

    return [
        Tool("search_imagery", "Search the Planetary Computer STAC catalogue for Sentinel-1/2 acquisitions", SideEffect.READ_ONLY,
             search_imagery, _acq_summary),
        Tool("assess_cloud_cover", "Measure AOI-level cloud and valid fractions from the Sentinel-2 scene classification",
             SideEffect.READ_ONLY, assess_cloud_cover, lambda v: v),
        Tool("load_s1", "Read Sentinel-1 RTC backscatter onto the analysis grid", SideEffect.READ_ONLY, load_s1, _obs_summary),
        Tool("load_s2", "Read Sentinel-2 L2A reflectance and cloud mask onto the analysis grid", SideEffect.READ_ONLY, load_s2, _obs_summary),
        Tool("load_context_layers", "Read Copernicus DEM, JRC surface water and ESA WorldCover", SideEffect.READ_ONLY,
             load_context_layers, lambda c: c.provenance),
        Tool("load_synthetic_scene", "Generate a simulated multi-sensor scene with ground truth (SIMULATED DATA)", SideEffect.COMPUTE,
             load_synthetic_scene, lambda sc: {"hazard": sc.config.hazard, "seed": sc.config.seed, "label": sc.label}),
        Tool("detect_change", "Run the hazard-specific multi-sensor change detector (perception)", SideEffect.COMPUTE,
             detect_change, _result_summary, passthrough=(InsufficientDataError,)),
        Tool("query_infrastructure", "Fetch hospitals, schools, emergency services, utilities, settlements and roads from OpenStreetMap",
             SideEffect.READ_ONLY, query_infrastructure, lambda v: {"features": len(v[0]), **{k: v[1].get(k) for k in ("status", "endpoint", "osm_base")}}),
        Tool("query_population", "Estimate gridded population (HRSL; WorldPop cross-check / fallback)", SideEffect.READ_ONLY,
             query_population, lambda p: {"available": p.available, "source": p.source, "aoi_total": p.aoi_total}),
        Tool("query_rainfall", "Daily precipitation (ERA5 reanalysis via Open-Meteo) at the AOI centroid", SideEffect.READ_ONLY,
             query_rainfall, lambda v: {"total_mm": v[0].get("total_mm"), "peak_day": v[0].get("peak_day")}),
        Tool("query_active_fires", "NASA FIRMS VIIRS active-fire detections in the AOI", SideEffect.READ_ONLY, query_active_fires,
             lambda v: {"detections": len(v[0]), "mode": v[1].get("mode")}),
        Tool("query_hazard_alerts", "GDACS disaster alerts near the AOI", SideEffect.READ_ONLY, query_hazard_alerts,
             lambda v: {"events": len(v[0])}),
        Tool("compute_impact", "Intersect hazard extent with population, facilities, roads and land cover", SideEffect.COMPUTE,
             compute_impact, _impact_summary),
        Tool("prioritize_cells", "Score and rank response cells with explanations and weight sensitivity", SideEffect.COMPUTE,
             prioritize_cells, lambda p: {"cells": len(p["cells"]), "distribution": p["distribution"]}),
        Tool("retrieve_guidance", "Retrieve methodology / guidance passages from the knowledge base (RAG)", SideEffect.READ_ONLY,
             retrieve_guidance, lambda v: [x["ref"] for x in v]),
        Tool("recall_similar_cases", "Recall earlier analyses of this area and analyst decisions (episodic memory)",
             SideEffect.READ_ONLY, recall_similar_cases, lambda v: {"cases": len(v)}),
    ]
