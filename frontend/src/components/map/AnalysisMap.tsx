import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ChevronsLeftRight, Columns2, Eye, EyeOff, Layers, Maximize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CellProps, Hazard, LayerInfo } from "@/api/types";
import { PRIORITY_HEX } from "@/lib/meta";
import { fmtArea, fmtDate, fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { BASEMAPS, type BasemapId, getBaseStyle, popupContent, setBasemap as applyBasemap } from "./basemap";

type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: "FeatureCollection", features: [] };
const STATUS_COLOR = ["match", ["get", "status"], "inside", "#c62828", "near", "#ef6c00", "#64748b"];

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

export function AnalysisMap({ aoi, bbox, hazard, layers, detections, cells, facilities, selectedCell, onSelectCell }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const beforeHost = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const beforeRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>("light");
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [overlayOpacity, setOverlayOpacity] = useState(0.85);
  const [showCells, setShowCells] = useState(true);
  const [showFacilities, setShowFacilities] = useState(true);
  // the layer panel would hide much of a narrow map: start collapsed unless the screen is wide
  const [panelOpen, setPanelOpen] = useState(window.innerWidth >= 1600);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [noGL] = useState(() => !webglAvailable());

  const imagery = useMemo(() => layers.filter((l) => l.group === "imagery"), [layers]);
  const preImg = imagery.find((l) => l.id === "s2_pre_rgb") ?? imagery.find((l) => l.id === "s1_pre_vv");
  const postImg = imagery.find((l) => l.id === "s2_post_rgb") ?? imagery.find((l) => l.id === "s1_post_vv");

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
      map.addLayer({ id: "cells-fill", type: "fill", source: "cells", paint: {
        "fill-color": ["match", ["get", "category"], "Critical", PRIORITY_HEX.Critical, "High", PRIORITY_HEX.High, "Moderate", PRIORITY_HEX.Moderate, PRIORITY_HEX.Low],
        "fill-opacity": 0.16 } });
      map.addLayer({ id: "cells-line", type: "line", source: "cells", paint: {
        "line-color": ["match", ["get", "category"], "Critical", PRIORITY_HEX.Critical, "High", PRIORITY_HEX.High, "Moderate", PRIORITY_HEX.Moderate, PRIORITY_HEX.Low],
        "line-width": 1, "line-opacity": 0.7 } });
      map.addLayer({ id: "det-line", type: "line", source: "detections", paint: { "line-color": hazard === "flood" ? "#0d3aa0" : "#9a3412", "line-width": 1.2, "line-opacity": 0.9 } });
      map.addLayer({ id: "det-hit", type: "fill", source: "detections", paint: { "fill-color": "#000", "fill-opacity": 0 } });
      map.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#0f1b2d", "line-width": 2, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "cells-selected", type: "line", source: "cells", filter: ["==", ["get", "cell_id"], ""], paint: { "line-color": "#0f1b2d", "line-width": 3 } });
      map.addLayer({ id: "fac", type: "circle", source: "facilities", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 14, 7], "circle-color": STATUS_COLOR as never,
        "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });

      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "320px" });
      map.on("click", "fac", (e) => {
        const p = e.features?.[0]?.properties as Record<string, string | number | null> | undefined;
        if (!p) return;
        popup.setLngLat(e.lngLat).setDOMContent(popupContent(String(p.name ?? p.category), [
          ["Type", String(p.category).replace(/_/g, " ")], ["Status", String(p.status)],
          ["Distance to extent", p.status === "inside" ? "inside" : `${fmtInt(Number(p.distance_m))} m`]],
          "Source: OpenStreetMap (or simulated). Inside the extent means potentially affected, not confirmed.")).addTo(map);
      });
      map.on("click", "det-hit", (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ["fac"] }).length) return;
        const p = e.features?.[0]?.properties as Record<string, number | null> | undefined;
        if (!p) return;
        popup.setLngLat(e.lngLat).setDOMContent(popupContent(hazard === "flood" ? "Detected flood area" : hazard === "wildfire" ? "Burn scar" : "Landslide candidate", [
          ["Area", fmtArea(p.area_km2 as number)], ["Mean confidence", fmtNum(p.mean_confidence, 2)],
          ["Mean uncertainty", fmtNum(p.mean_uncertainty, 2)], ["Independent agreement", p.agreement == null ? "n/a" : fmtPct(p.agreement)]])).addTo(map);
      });
      map.on("click", "cells-fill", (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ["fac"] }).length) return;
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as unknown as Record<string, unknown>;
        onSelectCellRef.current?.(String(p.cell_id));
      });
      for (const id of ["fac", "det-hit", "cells-fill"]) {
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
    const firstVector = "cells-fill";
    for (const l of [...layers].sort((a, b) => (a.group === "imagery" ? -1 : 1) - (b.group === "imagery" ? -1 : 1))) {
      addOverlay(map, l, visible[l.id] ?? l.default, l.group === "imagery" ? 1 : overlayOpacity, firstVector);
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
    for (const [lid, show] of [["cells-fill", showCells], ["cells-line", showCells], ["fac", showFacilities]] as const) {
      if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", show ? "visible" : "none");
    }
    applyBasemap(map, basemap);
  }, [ready, visible, overlayOpacity, showCells, showFacilities, basemap, layers, compare, postImg]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("cells") as GeoJSONSource | undefined)?.setData(cells ?? EMPTY);
    (map.getSource("detections") as GeoJSONSource | undefined)?.setData(detections ?? EMPTY);
    (map.getSource("facilities") as GeoJSONSource | undefined)?.setData(
      facilities ? { ...facilities, features: facilities.features.filter((f) => (f.properties as { status?: string })?.status !== "outside" || (f.properties as { category?: string })?.category === "hospital") } : EMPTY);
  }, [ready, cells, detections, facilities]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setFilter("cells-selected", ["==", ["get", "cell_id"], selectedCell ?? ""]);
    if (!selectedCell || !cells) return;
    const f = cells.features.find((x) => x.properties.cell_id === selectedCell);
    if (!f) return;
    const ring = f.geometry.coordinates[0];
    const xs = ring.map((c) => c[0]);
    const ys = ring.map((c) => c[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 120, maxZoom: 14, duration: 700 });
    const p = f.properties;
    new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(p.centroid as [number, number]).setDOMContent(popupContent(`${p.category} priority - cell ${p.cell_id}`, [
      ["Score", `${fmtNum(p.score, 0)}/100 (rank ${p.rank})`], ["Confidence", p.confidence], ["Affected", `${fmtPct(p.affected_fraction)} of cell`],
      ["People potentially exposed", p.population_exposed == null ? "n/a" : fmtInt(p.population_exposed)]])).addTo(map);
  }, [ready, selectedCell, cells]);

  // ---------------------------------------------------------------- compare (swipe) map
  useEffect(() => {
    const main = mapRef.current;
    if (!compare || !ready || !main || !beforeHost.current || !preImg) return;
    let cancelled = false;
    let b: MLMap | null = null;
    const sync = () => b?.jumpTo({ center: main.getCenter(), zoom: main.getZoom(), bearing: main.getBearing() });
    getBaseStyle().then(({ style }) => {
      if (cancelled || !beforeHost.current) return;
      b = new maplibregl.Map({ container: beforeHost.current, style, center: main.getCenter(), zoom: main.getZoom(),
        interactive: false, attributionControl: false });
      b.on("load", () => {
        if (!b) return;
        applyBasemap(b, basemap);
        addOverlay(b, preImg, true, 1);
        b.addSource("aoi", { type: "geojson", data: { type: "Feature", geometry: aoi, properties: {} } });
        b.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#0f1b2d", "line-width": 2, "line-dasharray": [2, 1.5] } });
      });
      main.on("move", sync);
      beforeRef.current = b;
    });
    return () => {
      cancelled = true;
      main.off("move", sync);
      b?.remove();
      beforeRef.current = null;
    };
  }, [compare, ready, preImg, aoi, basemap]);

  const dragging = useRef(false);
  const onDividerMove = (clientX: number) => {
    const r = host.current?.getBoundingClientRect();
    if (!r) return;
    setSplit(Math.min(0.95, Math.max(0.05, (clientX - r.left) / r.width)));
  };

  if (noGL) {
    return <div className="empty" style={{ height: "100%" }}><strong>Interactive map unavailable</strong><span className="small">This browser has WebGL disabled. All results remain available in the panels and reports.</span></div>;
  }

  const groups: [string, LayerInfo[]][] = [["Imagery", imagery], ["Analysis", layers.filter((l) => l.group === "analysis")], ["Diagnostics", layers.filter((l) => l.group === "diagnostics")]];
  const legendLayers = layers.filter((l) => l.group !== "imagery" && visible[l.id]);

  return (
    <>
      {/* inline positioning: maplibre-gl.css sets .maplibregl-map{position:relative}, which would collapse the host */}
      <div ref={host} className="map-host" style={{ position: "absolute", inset: 0 }} aria-label="Analysis map" role="region" />
      {compare && preImg && (
        <>
          <div ref={beforeHost} className="map-host"
            style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${100 - split * 100}% 0 0)`, pointerEvents: "none", zIndex: 4 }} />
          <div className="compare-divider" style={{ left: `calc(${split * 100}% - 1.5px)` }}
            onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => dragging.current && onDividerMove(e.clientX)} onPointerUp={() => (dragging.current = false)}
            role="slider" aria-label="Before / after comparison" aria-valuenow={Math.round(split * 100)} aria-valuemin={5} aria-valuemax={95} tabIndex={0}
            onKeyDown={(e) => { if (e.key === "ArrowLeft") setSplit((s) => Math.max(0.05, s - 0.05)); if (e.key === "ArrowRight") setSplit((s) => Math.min(0.95, s + 0.05)); }}>
            <div className="compare-handle"><ChevronsLeftRight size={18} aria-hidden /></div>
          </div>
          <span className="compare-label" style={{ left: 12, top: 56 }}>Before - {fmtDate(preImg.date)}</span>
          <span className="compare-label" style={{ right: 12, top: 56 }}>After - {fmtDate(postImg?.date)}</span>
        </>
      )}

      <div className={`map-overlay layer-panel ${panelOpen ? "" : "collapsed"}`}>
        <button className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "space-between", height: 38 }} onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
          <span className="row"><Layers size={15} aria-hidden /> Layers</span>
          {panelOpen ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
        </button>
        {panelOpen && (
          <div style={{ paddingBottom: 8 }}>
            {groups.map(([g, ls]) => ls.length > 0 && (
              <div key={g}>
                <div className="nav-section" style={{ padding: "8px 12px 2px" }}>{g}</div>
                {ls.map((l) => (
                  <label key={l.id} className="layer-row" title={l.description}>
                    <input type="checkbox" checked={!!visible[l.id]} onChange={(e) => setVisible((v) => ({ ...v, [l.id]: e.target.checked }))} />
                    <span className="grow">{l.title}{l.date ? <span className="muted xs"> · {fmtDate(l.date, { day: "numeric", month: "short" })}</span> : null}</span>
                  </label>
                ))}
              </div>
            ))}
            <div className="nav-section" style={{ padding: "8px 12px 2px" }}>Vectors</div>
            <label className="layer-row"><input type="checkbox" checked={showCells} onChange={(e) => setShowCells(e.target.checked)} /> Response priority cells</label>
            <label className="layer-row"><input type="checkbox" checked={showFacilities} onChange={(e) => setShowFacilities(e.target.checked)} /> Facilities near the extent</label>
            <div style={{ padding: "8px 12px 4px" }}>
              <div className="row between xs muted"><span>Overlay opacity</span><span>{Math.round(overlayOpacity * 100)}%</span></div>
              <input type="range" min={0.2} max={1} step={0.05} value={overlayOpacity} onChange={(e) => setOverlayOpacity(Number(e.target.value))} aria-label="Overlay opacity" />
            </div>
            {preImg && postImg && (
              <div style={{ padding: "4px 12px" }}>
                <button className={`btn btn-sm ${compare ? "btn-primary" : ""}`} style={{ width: "100%" }} onClick={() => setCompare((c) => !c)} aria-pressed={compare}>
                  <Columns2 size={14} aria-hidden /> {compare ? "Exit before / after" : "Compare before / after"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="map-overlay basemap-switch" role="group" aria-label="Basemap">
        {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => (
          <button key={id} aria-pressed={basemap === id} onClick={() => setBasemap(id)}>{BASEMAPS[id].label}</button>
        ))}
        <button title="Zoom to area of interest" aria-label="Zoom to area of interest" onClick={() => mapRef.current?.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 48, duration: 600 })}>
          <Maximize2 size={13} aria-hidden />
        </button>
      </div>

      {(legendLayers.length > 0 || showCells || showFacilities) && (
        <div className="map-overlay legend" aria-label="Legend">
          {legendLayers.slice(0, 3).map((l) => (
            <div key={l.id} style={{ marginBottom: 8 }}>
              <strong>{l.title}</strong>
              {l.legend.type === "gradient" && (
                <>
                  <div className="legend-ramp" style={{ background: `linear-gradient(90deg, ${(l.legend.colors ?? ["#cfe0f6", "#0d3aa0"]).join(",")})` }} />
                  <div className="row between muted"><span>{l.legend.min}</span><span>{l.legend.max}</span></div>
                </>
              )}
              {l.legend.type === "classes" && (
                <div className="row-wrap" style={{ marginTop: 4 }}>
                  {l.legend.items?.map((it) => <span key={it.label} className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: it.color }} />{it.label}</span>)}
                </div>
              )}
            </div>
          ))}
          {showCells && (
            <div className="row-wrap" style={{ marginBottom: showFacilities ? 6 : 0 }}>
              {(Object.keys(PRIORITY_HEX) as (keyof typeof PRIORITY_HEX)[]).map((c) => (
                <span key={c} className="row" style={{ gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, border: `2px solid ${PRIORITY_HEX[c]}`, background: `${PRIORITY_HEX[c]}33` }} />{c}</span>
              ))}
            </div>
          )}
          {showFacilities && (
            <div className="row-wrap">
              {[["inside", "#c62828"], ["within 500 m", "#ef6c00"], ["hospital (outside)", "#64748b"]].map(([k, c]) => (
                <span key={k} className="row" style={{ gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: c, boxShadow: "0 0 0 2px #fff" }} />{k}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
