"""Report generation (PDF, CSV, GeoJSON) from persisted analysis records.

Reports are rebuilt from the database, so they can be regenerated at any time and always
reflect analyst overrides. Every figure in the PDF is taken from stored results.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select
from sqlalchemy.orm import Session

from aegis.db import Alert, Analysis, Detection, ExposedFeature, GuardrailCheck, Observation, PriorityCell, ReviewTask

log = logging.getLogger(__name__)

# Same validated severity palette as the UI (docs/design.md); "Low" is teal so it reads as calm, not "safe".
CAT_COLORS = {"Critical": "#C62828", "High": "#EF6C00", "Moderate": "#E9B308", "Low": "#2A9D8F"}
INK, MUTED, ACCENT, LINE = "#16263A", "#5B6B7F", "#0E7C86", "#D9E1EA"
ATTRIBUTION = [
    "Contains modified Copernicus Sentinel data (Sentinel-1 RTC and Sentinel-2 L2A via Microsoft Planetary Computer).",
    "Copernicus DEM GLO-30: produced using Copernicus WorldDEM-30, (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.",
    "JRC Global Surface Water (Pekel et al., 2016), European Commission Joint Research Centre.",
    "ESA WorldCover 10 m 2021 v200 (c) ESA WorldCover project, CC BY 4.0.",
    "Infrastructure (c) OpenStreetMap contributors, ODbL 1.0.",
    "Population: High Resolution Settlement Layer, Meta and CIESIN (CC BY 4.0); WorldPop (CC BY 4.0).",
    "Water model trained on Sen1Floods11 (Bonafilia et al., 2020).",
]


def _rel(a: Analysis) -> str:
    return a.id


def load_bundle(s: Session, analysis_id: str) -> dict[str, Any]:
    a = s.get(Analysis, analysis_id)
    if a is None:
        raise KeyError(analysis_id)
    q = lambda model: s.scalars(select(model).where(model.analysis_id == analysis_id)).all()  # noqa: E731
    cells = sorted(q(PriorityCell), key=lambda c: c.rank)
    return {
        "analysis": a, "cells": cells, "detections": q(Detection), "facilities": q(ExposedFeature),
        "guardrails": q(GuardrailCheck), "observations": q(Observation), "alerts": q(Alert), "reviews": q(ReviewTask),
    }


def effective_category(c: PriorityCell) -> str:
    return c.override_category or c.category


# ----------------------------------------------------------------------------- CSV
def priorities_csv(data: dict[str, Any]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["rank", "cell_id", "category", "model_category", "override_reason", "score", "confidence", "confidence_score",
                "hazard_subscore", "exposure_subscore", "affected_km2", "affected_fraction", "mean_confidence", "mean_uncertainty",
                "population_exposed", "facilities_inside", "facilities_near", "road_km_affected", "data_completeness",
                "missing_factors", "centroid_lon", "centroid_lat", "explanation"])
    for c in data["cells"]:
        d = c.data
        w.writerow([c.rank, c.cell_id, effective_category(c), c.category, c.override_reason or "", c.score, c.confidence,
                    c.confidence_score, d.get("hazard_subscore"), d.get("exposure_subscore"), d.get("affected_km2"),
                    d.get("affected_fraction"), d.get("mean_confidence"), d.get("mean_uncertainty"), d.get("population_exposed"),
                    sum(1 for f in d.get("facilities", []) if f["status"] == "inside"),
                    sum(1 for f in d.get("facilities", []) if f["status"] == "near"), d.get("road_km_affected"),
                    d.get("data_completeness"), ";".join(d.get("missing_factors", [])), c.centroid_lon, c.centroid_lat,
                    d.get("explanation")])
    return buf.getvalue().encode("utf-8")


# ----------------------------------------------------------------------------- GeoJSON
def analysis_geojson(data: dict[str, Any]) -> bytes:
    a: Analysis = data["analysis"]
    feats = [{"type": "Feature", "geometry": a.aoi_geojson, "properties": {"layer": "aoi", "name": a.name}}]
    for d in data["detections"]:
        feats.append({"type": "Feature", "geometry": d.geometry, "properties": {
            "layer": "detection", "hazard": d.hazard, "area_km2": d.area_km2, "mean_confidence": d.mean_confidence,
            "mean_uncertainty": d.mean_uncertainty, "agreement": d.agreement, **(d.props or {})}})
    for c in data["cells"]:
        feats.append({"type": "Feature", "geometry": c.geometry, "properties": {
            "layer": "priority_cell", "cell_id": c.cell_id, "rank": c.rank, "category": effective_category(c),
            "model_category": c.category, "score": c.score, "confidence": c.confidence,
            "population_exposed": c.data.get("population_exposed"), "explanation": c.data.get("explanation")}})
    for f in data["facilities"]:
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [f.lon, f.lat]}, "properties": {
            "layer": "facility", "id": f.feature_id, "category": f.category, "name": f.name, "status": f.status,
            "distance_m": f.distance_m}})
    fc = {"type": "FeatureCollection", "features": feats,
          "aegis": {"analysis_id": a.id, "name": a.name, "hazard": a.hazard, "mode": a.mode,
                    "synthetic": a.mode == "synthetic", "generated_at": datetime.now(UTC).isoformat(),
                    "summary": a.summary}}
    return json.dumps(fc, default=str).encode("utf-8")


# ----------------------------------------------------------------------------- PDF
def _map_figure(data: dict[str, Any]) -> bytes | None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.patches import Polygon as MplPolygon

        a: Analysis = data["analysis"]
        fig, ax = plt.subplots(figsize=(7.2, 5.4), dpi=160)
        ax.set_facecolor("#F4F7FA")

        def rings(geom: dict) -> list[list[list[float]]]:
            if geom["type"] == "Polygon":
                return [geom["coordinates"][0]]
            if geom["type"] == "MultiPolygon":
                return [p[0] for p in geom["coordinates"]]
            return []

        for c in data["cells"]:
            for r in rings(c.geometry):
                ax.add_patch(MplPolygon(r, closed=True, facecolor=CAT_COLORS[effective_category(c)], alpha=0.28,
                                        edgecolor=CAT_COLORS[effective_category(c)], lw=0.6))
        for d in data["detections"]:
            for r in rings(d.geometry):
                ax.add_patch(MplPolygon(r, closed=True, facecolor="#1565C0" if a.hazard == "flood" else "#D84315",
                                        alpha=0.75, lw=0))
        for r in rings(a.aoi_geojson):
            xs, ys = zip(*r, strict=False)
            ax.plot(xs, ys, color=INK, lw=1.2, ls="--")
        marks = {"hospital": ("P", "#C62828"), "clinic": ("P", "#E57373"), "school": ("s", "#6A1B9A"),
                 "fire_station": ("^", "#EF6C00"), "shelter": ("D", "#2E7D32")}
        for f in data["facilities"]:
            if f.status == "outside":
                continue
            m, col = marks.get(f.category, ("o", "#37474F"))
            ax.scatter(f.lon, f.lat, marker=m, s=34, color=col, edgecolor="white", lw=0.6, zorder=5)
        ax.set_xlim(a.min_lon, a.max_lon)
        ax.set_ylim(a.min_lat, a.max_lat)
        ax.set_aspect(1 / max(0.2, math.cos(math.radians((a.min_lat + a.max_lat) / 2))))
        ax.tick_params(labelsize=7, colors=MUTED)
        for sp in ax.spines.values():
            sp.set_color(LINE)
        ax.set_title("Detected extent (blue/orange), response cells by priority, affected facilities", fontsize=8.5, color=INK)
        fig.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format="png")
        plt.close(fig)
        return buf.getvalue()
    except Exception as exc:  # figures are optional; the report must still be produced
        log.warning("report map figure failed", extra={"error": str(exc)[:200]})
        return None


def _table(rows: list[list[Any]], widths: list[float], header: bool = True, font: float = 7.5) -> Table:
    style = getSampleStyleSheet()["BodyText"]
    cell = ParagraphStyle("cell", parent=style, fontSize=font, leading=font + 2, textColor=colors.HexColor(INK))
    data = [[Paragraph(str(v) if v is not None else "-", cell) for v in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    cmds = [("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor(LINE)), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]
    if header:
        cmds += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAF4F5"))]
    t.setStyle(TableStyle(cmds))
    return t


def report_pdf(data: dict[str, Any]) -> bytes:
    a: Analysis = data["analysis"]
    res = a.results or {}
    summ = a.summary or {}
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=17, textColor=colors.HexColor(INK), alignment=TA_LEFT, spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=11.5, textColor=colors.HexColor(ACCENT), spaceBefore=10, spaceAfter=4)
    body = ParagraphStyle("b", parent=styles["BodyText"], fontSize=8.8, leading=12, textColor=colors.HexColor(INK))
    small = ParagraphStyle("s", parent=body, fontSize=7.4, leading=9.6, textColor=colors.HexColor(MUTED))
    banner = ParagraphStyle("banner", parent=body, backColor=colors.HexColor("#FFF3E0"), borderPadding=5,
                            textColor=colors.HexColor("#8A4B00"), fontSize=9)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f"AegisEO report - {a.name}", author="AegisEO")
    W = A4[0] - 32 * mm
    el: list[Any] = []

    def footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor(MUTED))
        canvas.drawString(16 * mm, 8 * mm, f"AegisEO - analysis {a.id[:8]} - generated {datetime.now(UTC):%Y-%m-%d %H:%M} UTC"
                          + (" - SIMULATED DATA" if a.mode == "synthetic" else "") + " - decision support only")
        canvas.drawRightString(A4[0] - 16 * mm, 8 * mm, f"page {_doc.page}")
        canvas.restoreState()

    el.append(Paragraph("AegisEO Disaster Intelligence Report", h1))
    el.append(Paragraph(f"<b>{a.name}</b> - {a.hazard.capitalize()} analysis - status: {a.status.replace('_', ' ')}", body))
    el.append(Paragraph(f"Event date {a.event_date:%d %b %Y}; pre-event window {a.pre_start} to {a.pre_end}; post-event window "
                        f"{a.post_start} to {a.post_end}. AOI {a.area_km2:.1f} km2, bbox [{a.min_lon:.4f}, {a.min_lat:.4f}, "
                        f"{a.max_lon:.4f}, {a.max_lat:.4f}].", small))
    if a.mode == "synthetic":
        el.append(Spacer(1, 4))
        el.append(Paragraph("SIMULATED DATA: this report was produced from a synthetic test scene located at Null Island (0N 0E). "
                            "It does not describe a real place or event and must not be used operationally.", banner))
    el.append(Paragraph("Executive summary", h2))
    el.append(Paragraph(res.get("narrative", {}).get("summary") or "No summary available.", body))
    el.append(Paragraph(f"Summary source: {res.get('narrative', {}).get('summary_source', 'template')}.", small))

    el.append(Paragraph("Key figures", h2))
    pop = (res.get("impact") or {}).get("population") or {}
    rows = [["Indicator", "Value", "Basis"],
            ["Detected affected area", f"{summ.get('affected_area_km2', 0):.2f} km2", "satellite change detection"],
            ["Potentially exposed population", f"{pop.get('potentially_exposed'):,}" if pop.get("potentially_exposed") is not None else "unavailable",
             pop.get("source") or pop.get("note") or "-"],
            ["Critical facilities inside / near extent", f"{summ.get('facilities_inside', 0)} / {summ.get('facilities_near', 0)}", "OpenStreetMap"],
            ["Mapped roads crossing extent", f"{summ.get('road_km_affected') if summ.get('road_km_affected') is not None else 'n/a'} km", "OpenStreetMap"],
            ["Response cells (C / H / M / L)", " / ".join(str((summ.get("distribution") or {}).get(k, 0)) for k in ("Critical", "High", "Moderate", "Low")),
             "hazard x exposure scoring"],
            ["Overall confidence", summ.get("confidence") or "-", "uncertainty, cross-method agreement, completeness"]]
    el.append(_table(rows, [W * 0.38, W * 0.22, W * 0.40]))

    png = _map_figure(data)
    if png:
        el.append(Spacer(1, 6))
        el.append(Image(io.BytesIO(png), width=W, height=W * 0.75))

    el.append(Paragraph("Observations used", h2))
    rows = [["Sensor", "Role", "Acquired (UTC)", "Cloud", "Valid", "Items"]]
    for o in sorted(data["observations"], key=lambda o: (o.sensor, o.role)):
        rows.append([o.sensor, o.role, f"{o.acquired_at:%Y-%m-%d %H:%M}", "-" if o.cloud_fraction is None else f"{o.cloud_fraction:.0%}",
                     f"{o.valid_fraction:.0%}", ", ".join(o.item_ids)[:160]])
    el.append(_table(rows, [W * 0.08, W * 0.08, W * 0.17, W * 0.08, W * 0.08, W * 0.51], font=6.8))

    el.append(Paragraph("Methodology", h2))
    for m in (res.get("hazard") or {}).get("methodology", []):
        el.append(Paragraph(f"- {m}", body))

    el.append(PageBreak())
    el.append(Paragraph("Response priorities", h2))
    el.append(Paragraph("Priority = 100 x Hazard^a x Exposure^(1-a); confidence is reported separately and never lowers priority. "
                        "Analyst overrides are shown where applied.", small))
    rows = [["#", "Cell", "Priority", "Score", "Conf.", "Pop.", "Explanation"]]
    for c in data["cells"][:15]:
        cat = effective_category(c) + (" (override)" if c.override_category else "")
        rows.append([c.rank, c.cell_id, cat, f"{c.score:.0f}", c.confidence,
                     c.data.get("population_exposed") if c.data.get("population_exposed") is not None else "n/a",
                     (c.data.get("explanation") or "")[:420]])
    el.append(_table(rows, [W * 0.04, W * 0.11, W * 0.11, W * 0.06, W * 0.08, W * 0.07, W * 0.53], font=6.8))

    fac = [f for f in data["facilities"] if f.status != "outside"]
    if fac:
        el.append(Paragraph("Facilities inside or within 500 m of the extent", h2))
        rows = [["Facility", "Type", "Status", "Distance (m)"]] + [
            [f.name or "-", f.category, f.status, "0" if f.status == "inside" else f"{f.distance_m:.0f}"] for f in fac[:40]]
        el.append(_table(rows, [W * 0.5, W * 0.18, W * 0.14, W * 0.18]))

    el.append(Paragraph("Guardrails and quality checks", h2))
    rows = [["Code", "Check", "Outcome", "Detail"]] + [[g.code, g.name, g.outcome, g.message[:220]] for g in data["guardrails"]
                                                       if g.stage != "reporting"]
    el.append(_table(rows, [W * 0.07, W * 0.27, W * 0.1, W * 0.56], font=6.8))

    el.append(Paragraph("Limitations and uncertainty", h2))
    for lim in (res.get("limitations") or []):
        el.append(Paragraph(f"- {lim}", body))

    decisions = (res.get("agent") or {}).get("decisions", [])
    if decisions:
        el.append(Paragraph("Agent decision trace", h2))
        rows = [["Agent", "Decision", "Choice", "Rationale"]] + [[d["agent"], d["question"], d["chosen"], d["rationale"][:260]] for d in decisions]
        el.append(_table(rows, [W * 0.14, W * 0.22, W * 0.2, W * 0.44], font=6.6))

    el.append(Paragraph("Data sources and attribution", h2))
    for line in ATTRIBUTION:
        el.append(Paragraph(line, small))
    el.append(Spacer(1, 6))
    el.append(KeepTogether([Paragraph("Disclaimer", h2), Paragraph(
        "This report is automated decision support derived from satellite observations and open data. Detected extents, "
        "exposure estimates and priorities are indicative, may contain errors and must be verified with local information "
        "by authorised personnel before operational decisions are taken. People inside a detected extent are potentially "
        "exposed, not confirmed as affected.", small)]))
    doc.build(el, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


def write_reports(s: Session, analysis_id: str, out_dir: Path) -> list[dict[str, Any]]:
    data = load_bundle(s, analysis_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for kind, fname, fn in (("pdf", "report.pdf", report_pdf), ("csv", "priorities.csv", priorities_csv),
                            ("geojson", "analysis.geojson", analysis_geojson)):
        try:
            blob = fn(data)
        except Exception as exc:
            log.exception("report generation failed", extra={"kind": kind})
            files.append({"kind": kind, "error": str(exc)[:300]})
            continue
        path = out_dir / fname
        path.write_bytes(blob)
        files.append({"kind": kind, "filename": fname, "sha256": hashlib.sha256(blob).hexdigest(), "size_bytes": len(blob)})
    return files
