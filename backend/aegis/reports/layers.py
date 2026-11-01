"""Map overlays (Web-Mercator PNG + corner coordinates) and GeoTIFF exports for an analysis."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np

from aegis.analysis.bundle import SceneBundle
from aegis.analysis.hazards import HazardResult
from aegis.geo.raster import (
    categorical_composite,
    colormap_composite,
    gray_composite,
    rgb_composite,
    save_overlay,
    write_geotiff,
)

log = logging.getLogger(__name__)

PROB_STOPS = [(0.2, (186, 230, 253, 0)), (0.35, (125, 196, 245, 140)), (0.6, (56, 132, 230, 200)), (1.0, (13, 58, 160, 235))]
UNC_STOPS = [(0.02, (255, 255, 255, 0)), (0.05, (255, 236, 179, 120)), (0.15, (255, 167, 38, 190)), (0.30, (211, 47, 47, 225))]
RELIANCE_STOPS = [(0.0, (46, 160, 67, 170)), (0.5, (240, 240, 240, 50)), (1.0, (123, 31, 162, 170))]
CHANGE_STOPS = [(-10, (33, 102, 172, 215)), (-3, (146, 197, 222, 150)), (-1, (247, 247, 247, 0)), (1, (247, 247, 247, 0)),
                (3, (244, 165, 130, 150)), (10, (178, 24, 43, 215))]
DNBR_STOPS = [(0.1, (255, 255, 255, 0)), (0.1001, (255, 236, 140, 170)), (0.27, (253, 174, 97, 190)), (0.44, (244, 109, 67, 205)),
              (0.66, (215, 48, 39, 220)), (1.0, (120, 20, 30, 235))]
SEVERITY_PALETTE = {1: (255, 236, 140, 200), 2: (253, 174, 97, 210), 3: (244, 109, 67, 220), 4: (165, 15, 21, 230)}
EXTENT_COLOR = {"flood": (21, 101, 192, 185), "wildfire": (216, 67, 21, 190), "landslide": (141, 85, 36, 210)}


def render_layers(bundle: SceneBundle, result: HazardResult, out_dir: Path) -> list[dict[str, Any]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    layers: list[dict[str, Any]] = []
    g = bundle.grid

    def add(lid: str, title: str, rgba: np.ndarray, group: str, legend: dict[str, Any], *, description: str,
            date: str | None = None, default: bool = False, opacity: float = 0.85) -> None:
        try:
            corners = save_overlay(out_dir / f"{lid}.png", rgba, g)
        except Exception as exc:  # one failed overlay must not break the analysis
            log.warning("overlay render failed", extra={"layer": lid, "error": str(exc)[:200]})
            return
        layers.append({"id": lid, "title": title, "group": group, "url": f"layers/{lid}.png", "corners": corners,
                       "legend": legend, "description": description, "date": date, "default": default, "opacity": opacity,
                       "synthetic": bundle.synthetic})

    for role in ("pre", "post"):
        s2 = bundle.get("S2", role)
        if s2 is not None:
            add(f"s2_{role}_rgb", f"Sentinel-2 true colour ({role}-event)", rgb_composite(s2.bands["B04"], s2.bands["B03"], s2.bands["B02"]),
                "imagery", {"type": "image"}, date=s2.acquired_at.isoformat(), default=(role == "post"), opacity=1.0,
                description=f"Surface reflectance RGB, {s2.acquired_at:%Y-%m-%d}; clouds visible as acquired.")
        s1 = bundle.get("S1", role)
        if s1 is not None:
            add(f"s1_{role}_vv", f"Sentinel-1 VV backscatter ({role}-event)", gray_composite(s1.bands["vv_db"], -25, 0),
                "imagery", {"type": "gradient", "min": "-25 dB (dark: water)", "max": "0 dB (bright)"},
                date=s1.acquired_at.isoformat(), opacity=1.0,
                description=f"Radar backscatter {s1.acquired_at:%Y-%m-%d}; calm water appears dark.")
    h = result.hazard
    L = result.layers
    if "flood_probability" in L:
        add("hazard_probability", "Flood probability", colormap_composite(L["flood_probability"], PROB_STOPS, transparent_below=0.2),
            "analysis", {"type": "gradient", "min": "0.2", "max": "1.0", "colors": ["#7DC4F5", "#3884E6", "#0D3AA0"]},
            description="Calibrated probability of new surface water, P(after) x (1 - P(before)).")
    if "dnbr" in L:
        add("hazard_probability", "dNBR burn severity index", colormap_composite(L["dnbr"], DNBR_STOPS, transparent_below=0.1),
            "analysis", {"type": "gradient", "min": "0.10 low", "max": ">0.66 high", "colors": ["#FFEC8C", "#F46D43", "#780F1E"]},
            description="Differenced Normalized Burn Ratio (pre minus post).")
    if "landslide_score" in L:
        add("hazard_probability", "Landslide indicator score", colormap_composite(L["landslide_score"], PROB_STOPS, transparent_below=0.3),
            "analysis", {"type": "gradient", "min": "0.3", "max": "1.0"}, description="Share of landslide indicators present.")
    if result.severity is not None and h == "wildfire":
        rgba = categorical_composite(result.severity.astype(np.float32), SEVERITY_PALETTE)
        add("affected", "Burn severity classes", rgba, "analysis",
            {"type": "classes", "items": [{"label": result.severity_labels[k], "color": "#{:02x}{:02x}{:02x}".format(*v[:3])} for k, v in SEVERITY_PALETTE.items()]},
            default=True, description="USGS FIREMON dNBR severity classes inside the mapped burn scar.")
    else:
        c = EXTENT_COLOR.get(h, (21, 101, 192, 185))
        rgba = categorical_composite(result.affected.astype(np.float32), {1: c})
        add("affected", {"flood": "Detected flood extent", "landslide": "Landslide candidates"}.get(h, "Detected extent"), rgba,
            "analysis", {"type": "classes", "items": [{"label": "detected", "color": "#{:02x}{:02x}{:02x}".format(*c[:3])}]}, default=True,
            description="Final detected extent after thresholding, terrain constraints and minimum mapping unit.")
    if "uncertainty" in L:
        add("uncertainty", "Model uncertainty", colormap_composite(L["uncertainty"], UNC_STOPS, transparent_below=0.02),
            "diagnostics", {"type": "gradient", "min": "0.05", "max": "0.30", "colors": ["#FFECB3", "#FFA726", "#D32F2F"]},
            description="Epistemic uncertainty (Monte-Carlo dropout std) of the hazard probability.")
    if "sar_reliance" in L:
        add("sar_reliance", "Sensor reliance (SAR vs optical)", colormap_composite(L["sar_reliance"], RELIANCE_STOPS),
            "diagnostics", {"type": "gradient", "min": "optical", "max": "SAR", "colors": ["#2EA043", "#F0F0F0", "#7B1FA2"]},
            description="Learned per-pixel gate of the fusion model: which sensor drove the decision.")
    for key, title in (("sar_change_db", "SAR VV change (dB)"), ("sar_change_vh_db", "SAR VH change (dB)")):
        if key in L:
            add("sar_change", title, colormap_composite(L[key], CHANGE_STOPS), "diagnostics",
                {"type": "gradient", "min": "-10 dB (decrease)", "max": "+10 dB (increase)", "colors": ["#2166AC", "#F7F7F7", "#B2182B"]},
                description="Lee-filtered log-ratio of post- to pre-event backscatter.")
            break
    (out_dir / "layers.json").write_text(json.dumps(layers, indent=1))
    return layers


def export_rasters(bundle: SceneBundle, result: HazardResult, out_dir: Path) -> Path:
    bands = {"affected": result.affected.astype(np.float32), "confidence": result.confidence.astype(np.float32),
             "uncertainty": result.uncertainty.astype(np.float32)}
    for key in ("flood_probability", "dnbr", "landslide_score", "sar_reliance"):
        if key in result.layers:
            bands[key] = result.layers[key].astype(np.float32)
    return write_geotiff(out_dir / f"{result.hazard}_products.tif", bands, bundle.grid)
