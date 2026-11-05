import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ChevronsLeftRight, Columns2, Info, Layers, Maximize2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CellProps, Hazard, LayerInfo } from "@/api/types";
import { fmtArea, fmtDate, fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { useMediaQuery } from "@/lib/hooks";
import { FACILITY_LABEL, HAZARDS, PRIORITY_HEX, layerName } from "@/lib/meta";
import { BASEMAPS, type BasemapId, getBaseStyle, popupContent, setBasemap as applyBasemap } from "./basemap";

type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: "FeatureCollection", features: [] };
const FAC_COLOR = ["match", ["get", "status"], "inside", "#c62828", "near", "#ef6c00", "#5c677a"];
const CAT_COLOR = ["match", ["get", "category"], "Critical", PRIORITY_HEX.Critical, "High", PRIORITY_HEX.High, "Moderate", PRIORITY_HEX.Moderate, PRIORITY_HEX.Low];

interface Props {
  aoi: GeoJSON.Geometry;
  bbox: [number, number, number, number];
  hazard: Hazard;
  layers: LayerInfo[];
  detections?: FC;
  cells?: GeoJSON.FeatureCollection<GeoJSON.Polygon, CellProps>;
  facilities?: FC;
  selectedCell?: string | null;
  onSelectCell?: (id: string | null) => void;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function addOverlay(map: MLMap, l: LayerInfo, visible: boolean, opacity: number, before?: string) {
  const src = `img-${l.id}`;
  if (map.getSource(src)) return;
  map.addSource(src, { type: "image", url: l.url, coordinates: l.corners as [[number, number], [number, number], [number, number], [number, number]] });
  map.addLayer({ id: `lyr-${l.id}`, type: "raster", source: src, layout: { visibility: visible ? "visible" : "none" },
    paint: { "raster-opacity": opacity, "raster-resampling": l.group === "imagery" ? "linear" : "nearest", "raster-fade-duration": 0 } }, before);
}

const isSettlement = (f: GeoJSON.Feature) => (f.properties as { category?: string } | null)?.category === "settlement";

export function AnalysisMap({ aoi, bbox, hazard, layers, detections, cells, facilities, selectedCell, onSelectCell }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const beforeHost = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const wide = useMediaQuery("(min-width: 1500px)");
  const [basemap, setBasemap] = useState<BasemapId>("light");
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [overlayOpacity, setOverlayOpacity] = useState(0.85);
  const [showCells, setShowCells] = useState(true);
  const [showFacilities, setShowFacilities] = useState(true);
  const [showSettlements, setShowSettlements] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const narrow = useMediaQuery("(max-width: 720px)");
  const [legendOpen, setLegendOpen] = useState(() => !window.matchMedia?.("(max-width: 720px)").matches);
  useEffect(() => setLegendOpen(!narrow), [narrow]);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [noGL] = useState(() => !webglAvailable());
  const h = HAZARDS[hazard];

  const imagery = useMemo(() => layers.filter((l) => l.group === "imagery"), [layers]);
  const preImg = imagery.find((l) => l.id === "s2_pre_rgb") ?? imagery.find((l) => l.id === "s1_pre_vv");
  const postImg = imagery.find((l) => l.id === "s2_post_rgb") ?? imagery.find((l) => l.id === "s1_post_vv");
  const nFacilities = facilities?.features.filter((f) => !isSettlement(f) && (f.properties as { status?: string })?.status !== "outside").length ?? 0;
  const nSettlements = facilities?.features.filter((f) => isSettlement(f) && (f.properties as { status?: string })?.status !== "outside").length ?? 0;

  useEffect(() => setPanelOpen(wide), [wide]);
  useEffect(() => {
    setVisible(Object.fromEntries(layers.map((l) => [l.id, l.default])));
  }, [layers]);

  // ---------------------------------------------------------------- create map
  useEffect(() => {
    if (noGL || !host.current) return;
    let cancelled = false;
    let created: MLMap | null = null;
    getBaseStyle().then(({ style }) => {
      if (cancelled || !host.current) return;
      created = buildMap(host.current, style);
    });
    return () => {
      cancelled = true;
      created?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noGL]);

  function buildMap(container: HTMLDivElement, style: maplibregl.StyleSpecification): MLMap {
    const map = new maplibregl.Map({
      container, style, bounds: [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
      fitBoundsOptions: { padding: 48 }, attributionControl: { compact: true }, maxPitch: 0, dragRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    map.on("error", (e) => console.warn("map error", e.error?.message));
    map.on("load", () => {
      map.addSource("aoi", { type: "geojson", data: { type: "Feature", geometry: aoi, properties: {} } });
      map.addSource("cells", { type: "geojson", data: EMPTY, promoteId: "cell_id" });
      map.addSource("detections", { type: "geojson", data: EMPTY });
      map.addSource("facilities", { type: "geojson", data: EMPTY });
      map.addSource("settlements", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "cells-fill", type: "fill", source: "cells", paint: { "fill-color": CAT_COLOR as never, "fill-opacity": 0.16 } });
      map.addLayer({ id: "cells-line", type: "line", source: "cells", paint: { "line-color": CAT_COLOR as never, "line-width": 1, "line-opacity": 0.75 } });
      map.addLayer({ id: "det-line", type: "line", source: "detections", paint: { "line-color": hazard === "flood" ? "#0d3aa0" : "#8a2c0c", "line-width": 1.2, "line-opacity": 0.9 } });
      map.addLayer({ id: "det-hit", type: "fill", source: "detections", paint: { "fill-color": "#000", "fill-opacity": 0 } });
      map.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#15213b", "line-width": 2, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "cells-selected", type: "line", source: "cells", filter: ["==", ["get", "cell_id"], ""], paint: { "line-color": "#15213b", "line-width": 3.5 } });
      // villages and towns: small neutral squares - context, not "important places"
      map.addLayer({ id: "set", type: "circle", source: "settlements", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 5.5], "circle-color": "#ffffff",
        "circle-stroke-color": "#15213b", "circle-stroke-width": 1.6 } });
      map.addLayer({ id: "set-label", type: "symbol", source: "settlements", minzoom: 11, layout: {
        "text-field": ["coalesce", ["get", "name"], ""], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
        paint: { "text-color": "#15213b", "text-halo-color": "#ffffff", "text-halo-width": 1.6 } });
      map.addLayer({ id: "fac", type: "circle", source: "facilities", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 4.5, 14, 8], "circle-color": FAC_COLOR as never,
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.2 } });

      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "320px" });
      const placeStatus = (s: unknown, d: unknown) => (s === "inside" ? `Inside the ${h.areaName}` : s === "near" ? `${fmtInt(Number(d))} m from the ${h.areaName}` : "Further away");
      map.on("click", "fac", (e) => {
        const p = e.features?.[0]?.properties as Record<string, string | number | null> | undefined;
        if (!p) return;
        popup.setLngLat(e.lngLat).setDOMContent(popupContent(String(p.name ?? FACILITY_LABEL[String(p.category)] ?? "Unnamed place"), [
          ["What it is", FACILITY_LABEL[String(p.category)] ?? String(p.category).replace(/_/g, " ")], ["Where", placeStatus(p.status, p.distance_m)]],
          "From OpenStreetMap. Being inside the area means it may be affected - not that it is damaged.")).addTo(map);
      });
      map.on("click", "set", (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ["fac"] }).length) return;
        const p = e.features?.[0]?.properties as Record<string, string | number | null> | undefined;
        if (!p) return;
        popup.setLngLat(e.lngLat).setDOMContent(popupContent(String(p.name ?? "Unnamed village or town"), [
          ["What it is", "Village or town"], ["Where", placeStatus(p.status, p.distance_m)]], "From OpenStreetMap.")).addTo(map);
      });
      map.on("click", "det-hit", (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ["fac", "set"] }).length) return;
        const p = e.features?.[0]?.properties as Record<string, number | null> | undefined;
        if (!p) return;
        popup.setLngLat(e.lngLat).setDOMContent(popupContent(hazard === "flood" ? "Area found flooded" : hazard === "wildfire" ? "Burned area" : "Possible landslide", [
          ["Size", fmtArea(p.area_km2 as number)], ["How likely (average)", fmtPct(p.mean_confidence)],
          ["Computer unsure (0 = sure)", fmtNum(p.mean_uncertainty, 2)], ["Second method agrees", p.agreement == null ? "not checked" : fmtPct(p.agreement)]])).addTo(map);
      });
      map.on("click", "cells-fill", (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ["fac", "set"] }).length) return;
        const f = e.features?.[0];
        if (!f) return;
        onSelectCellRef.current?.(String((f.properties as Record<string, unknown>).cell_id));
      });
      for (const id of ["fac", "set", "det-hit", "cells-fill"]) {
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      }
      setReady(true);
    });
    mapRef.current = map;
    return map;
  }

  const onSelectCellRef = useRef(onSelectCell);
  onSelectCellRef.current = onSelectCell;

  // ---------------------------------------------------------------- overlays
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const l of [...layers].sort((a, b) => (a.group === "imagery" ? -1 : 1) - (b.group === "imagery" ? -1 : 1))) {
      addOverlay(map, l, visible[l.id] ?? l.default, l.group === "imagery" ? 1 : overlayOpacity, "cells-fill");
    }
  }, [ready, layers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const l of layers) {
      const id = `lyr-${l.id}`;
      if (!map.getLayer(id)) continue;
      const show = compare ? (l.group === "imagery" ? l.id === postImg?.id : visible[l.id]) : visible[l.id];
      map.setLayoutProperty(id, "visibility", show ? "visible" : "none");
      if (l.group !== "imagery") map.setPaintProperty(id, "raster-opacity", overlayOpacity);
    }
    for (const [lid, show] of [["cells-fill", showCells], ["cells-line", showCells], ["fac", showFacilities], ["set", showSettlements], ["set-label", showSettlements]] as const) {
      if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", show ? "visible" : "none");
    }
    applyBasemap(map, basemap);
  }, [ready, visible, overlayOpacity, showCells, showFacilities, showSettlements, basemap, layers, compare, postImg]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("cells") as GeoJSONSource | undefined)?.setData(cells ?? EMPTY);
    (map.getSource("detections") as GeoJSONSource | undefined)?.setData(detections ?? EMPTY);
    const feats = facilities?.features ?? [];
    const status = (f: GeoJSON.Feature) => (f.properties as { status?: string } | null)?.status;
    const category = (f: GeoJSON.Feature) => (f.properties as { category?: string } | null)?.category;
    // important places inside / near the area (+ hospitals further away for orientation); villages and towns separately
    (map.getSource("facilities") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection",
      features: feats.filter((f) => !isSettlement(f) && (status(f) !== "outside" || category(f) === "hospital")) });
    (map.getSource("settlements") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: feats.filter((f) => isSettlement(f)) });
  }, [ready, cells, detections, facilities]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setFilter("cells-selected", ["==", ["get", "cell_id"], selectedCell ?? ""]);
    if (!selectedCell || !cells || compare) return;
    const f = cells.features.find((x) => x.properties.cell_id === selectedCell);
    if (!f) return;
    const ring = f.geometry.coordinates[0];
    const xs = ring.map((c) => c[0]);
    const ys = ring.map((c) => c[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 120, maxZoom: 14, duration: 700 });
    const p = f.properties;
    const pop = new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(p.centroid as [number, number]).setDOMContent(popupContent(`${p.category} priority square`, [
      ["Rank", `${p.rank} (score ${fmtNum(p.score, 0)} of 100)`], ["Part that looks hit", fmtPct(p.affected_fraction)],
      ["People living in that part", p.population_exposed == null ? "not known" : `about ${fmtInt(p.population_exposed)}`], ["How sure", p.confidence]])).addTo(map);
    return () => {
      pop.remove();
    };
  }, [ready, selectedCell, cells, compare]);

  // ---------------------------------------------------------------- compare (swipe) map
  useEffect(() => {
    const main = mapRef.current;
    if (!compare || !ready || !main || !beforeHost.current || !preImg) return;
    let cancelled = false;
    let b: MLMap | null = null;
    const sync = () => b?.jumpTo({ center: main.getCenter(), zoom: main.getZoom(), bearing: main.getBearing() });
    getBaseStyle().then(({ style }) => {
      if (cancelled || !beforeHost.current) return;
      b = new maplibregl.Map({ container: beforeHost.current, style, center: main.getCenter(), zoom: main.getZoom(), interactive: false, attributionControl: false });
      b.on("load", () => {
        if (!b) return;
        applyBasemap(b, basemap);
        addOverlay(b, preImg, true, 1);
        b.addSource("aoi", { type: "geojson", data: { type: "Feature", geometry: aoi, properties: {} } });
        b.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#15213b", "line-width": 2, "line-dasharray": [2, 1.5] } });
      });
      main.on("move", sync);
    });
    return () => {
      cancelled = true;
      main.off("move", sync);
      b?.remove();
    };
  }, [compare, ready, preImg, aoi, basemap]);

  const dragging = useRef(false);
  const onDividerMove = (clientX: number) => {
    const r = host.current?.getBoundingClientRect();
    if (!r) return;
    setSplit(Math.min(0.95, Math.max(0.05, (clientX - r.left) / r.width)));
  };

  if (noGL) {
    return <div className="empty" style={{ height: "100%" }}><h3>The map can't be shown</h3><p className="small">This browser has WebGL turned off. Every result is still listed beside the map and in the PDF report.</p></div>;
  }

  const main = layers.filter((l) => l.group !== "diagnostics");
  const extra = layers.filter((l) => l.group === "diagnostics");
  const legendLayers = layers.filter((l) => l.group !== "imagery" && visible[l.id]);
  const row = (l: LayerInfo) => {
    const n = layerName(l.id, hazard);
    return (
      <label key={l.id} className="layer-row" title={l.description}>
        <input type="checkbox" checked={!!visible[l.id]} onChange={(e) => setVisible((v) => ({ ...v, [l.id]: e.target.checked }))} />
        <span className="lr-text">{n.name}{l.date ? ` · ${fmtDate(l.date, { day: "numeric", month: "short", year: "numeric" })}` : ""}<small>{n.hint}</small></span>
      </label>
    );
  };

  return (
    <>
      {/* inline positioning: maplibre-gl.css sets .maplibregl-map{position:relative}, which would collapse the host */}
      <div ref={host} className="map-host" style={{ position: "absolute", inset: 0 }} aria-label="Map of the results" role="region" />
      {compare && preImg && (
        <>
          <div ref={beforeHost} className="map-host" style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${100 - split * 100}% 0 0)`, pointerEvents: "none", zIndex: 4 }} />
          <div className="compare-divider" style={{ left: `calc(${split * 100}% - 1.5px)` }}
            onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => dragging.current && onDividerMove(e.clientX)} onPointerUp={() => (dragging.current = false)}
            role="slider" aria-label="Slide to compare the photo before and after" aria-valuenow={Math.round(split * 100)} aria-valuemin={5} aria-valuemax={95} tabIndex={0}
            onKeyDown={(e) => { if (e.key === "ArrowLeft") setSplit((s) => Math.max(0.05, s - 0.05)); if (e.key === "ArrowRight") setSplit((s) => Math.min(0.95, s + 0.05)); }}>
            <div className="compare-handle"><ChevronsLeftRight size={20} aria-hidden /></div>
          </div>
          <span className="compare-label" style={{ left: 12 }}>Before · {fmtDate(preImg.date)}</span>
          <span className="compare-label" style={{ right: 12 }}>After · {fmtDate(postImg?.date)}</span>
        </>
      )}

      <div className="map-overlay map-toolbar">
        {!panelOpen && (
          <div className="map-pill"><button type="button" onClick={() => setPanelOpen(true)} aria-expanded={false}><Layers size={16} aria-hidden /> What's shown</button></div>
        )}
        <div className="row-wrap" style={{ marginLeft: "auto", justifyContent: "flex-end" }}>
          {preImg && postImg && (
            <div className="map-pill">
              <button type="button" aria-pressed={compare} onClick={() => setCompare((c) => !c)}><Columns2 size={16} aria-hidden /> {compare ? "Stop comparing" : "Compare before / after"}</button>
            </div>
          )}
          <div className="map-pill" role="group" aria-label="Background map">
            {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => (
              <button key={id} type="button" aria-pressed={basemap === id} onClick={() => setBasemap(id)}>{BASEMAPS[id].label}</button>
            ))}
            <button type="button" title="Zoom to the whole area" aria-label="Zoom to the whole area" onClick={() => mapRef.current?.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 48, duration: 600 })}>
              <Maximize2 size={15} aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {panelOpen && (
        <div className="map-overlay layer-panel" style={{ top: 64 }}>
          <div className="layer-panel-head">
            <strong className="small">What's shown on the map</strong>
            <button type="button" className="btn btn-ghost btn-sm icon-btn" aria-label="Hide this list" onClick={() => setPanelOpen(false)}><X size={16} /></button>
          </div>
          <div className="layer-group-title">Results</div>
          <label className="layer-row"><input type="checkbox" checked={showCells} onChange={(e) => setShowCells(e.target.checked)} />
            <span className="lr-text">Priority squares<small>Coloured by where to look first</small></span></label>
          <label className="layer-row"><input type="checkbox" checked={showFacilities} onChange={(e) => setShowFacilities(e.target.checked)} />
            <span className="lr-text">Important places ({nFacilities} in or near the area)<small>Hospitals, schools, emergency services…</small></span></label>
          <label className="layer-row"><input type="checkbox" checked={showSettlements} onChange={(e) => setShowSettlements(e.target.checked)} />
            <span className="lr-text">Villages and towns ({nSettlements} in or near the area)<small>Named places from OpenStreetMap</small></span></label>
          {main.filter((l) => l.group === "analysis").map(row)}
          <div className="layer-group-title">Satellite photos</div>
          {main.filter((l) => l.group === "imagery").map(row)}
          {extra.length > 0 && (
            <details style={{ padding: "4px 0 6px" }}>
              <summary className="layer-group-title" style={{ cursor: "pointer" }}>For experts</summary>
              {extra.map(row)}
            </details>
          )}
          <div style={{ padding: "8px 14px 12px" }}>
            <div className="row between caption muted"><span>See-through</span><span>{Math.round((1 - overlayOpacity) * 100)}%</span></div>
            <input type="range" min={0} max={0.8} step={0.05} value={1 - overlayOpacity} onChange={(e) => setOverlayOpacity(1 - Number(e.target.value))} aria-label="How see-through the result layers are" />
          </div>
        </div>
      )}

      {(legendLayers.length > 0 || showCells || showFacilities || showSettlements) && !compare && !legendOpen && (
        <div className="map-overlay legend-toggle map-pill">
          <button type="button" onClick={() => setLegendOpen(true)} aria-expanded={false}><Info size={15} aria-hidden /> Map key</button>
        </div>
      )}
      {(legendLayers.length > 0 || showCells || showFacilities || showSettlements) && !compare && legendOpen && (
        <div className="map-overlay legend" aria-label="Map key">
          <button type="button" className="btn btn-ghost btn-sm icon-btn" aria-label="Hide the map key" onClick={() => setLegendOpen(false)}
            style={{ position: "absolute", top: 4, right: 4, minHeight: 30, width: 30 }}><X size={15} /></button>
          {legendLayers.slice(0, 2).map((l) => (
            <div key={l.id} style={{ marginBottom: 8 }}>
              <div className="legend-title">{layerName(l.id, hazard).name}</div>
              {l.legend.type === "gradient" && (
                <>
                  <div className="legend-ramp" style={{ background: `linear-gradient(90deg, ${(l.legend.colors ?? ["#cfe0f6", "#0d3aa0"]).join(",")})` }} />
                  <div className="row between muted"><span>{l.legend.min}</span><span>{l.legend.max}</span></div>
                </>
              )}
              {l.legend.type === "classes" && (
                <div className="row-wrap">
                  {l.legend.items?.map((it) => <span key={it.label} className="legend-item"><span className="lg-sw" style={{ background: it.color }} />{it.label === "detected" ? h.areaName : it.label}</span>)}
                </div>
              )}
            </div>
          ))}
          {showCells && (
            <div style={{ marginBottom: 6 }}>
              <div className="legend-title">Priority squares</div>
              {(Object.keys(PRIORITY_HEX) as (keyof typeof PRIORITY_HEX)[]).map((c) => (
                <span key={c} className="legend-item"><span className="lg-sw" style={{ border: `2px solid ${PRIORITY_HEX[c]}`, background: `${PRIORITY_HEX[c]}33` }} />{c}</span>
              ))}
            </div>
          )}
          {showFacilities && (
            <div style={{ marginBottom: showSettlements ? 6 : 0 }}>
              <div className="legend-title">Important places</div>
              {[["Inside", "#c62828"], ["Within 500 m", "#ef6c00"], ["Hospital further away", "#5c677a"]].map(([k, c]) => (
                <span key={k} className="legend-item"><span className="lg-dot" style={{ background: c }} />{k}</span>
              ))}
            </div>
          )}
          {showSettlements && (
            <span className="legend-item"><span className="lg-dot" style={{ background: "#fff", border: "1.6px solid #15213b", boxShadow: "none" }} />Village or town</span>
          )}
        </div>
      )}
    </>
  );
}
