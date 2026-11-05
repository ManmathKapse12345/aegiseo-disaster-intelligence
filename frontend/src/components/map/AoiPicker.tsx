import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crop, LocateFixed, MapPin, Pencil, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { usePlaces } from "@/api/hooks";
import { type BBox, bboxAreaKm2 } from "@/lib/geo";
import type { Place } from "@/api/types";
import { friendlyError, areaPicture, areaVerdict } from "@/lib/plain";
import { BASEMAPS, type BasemapId, getBaseStyle, setBasemap as applyBasemap } from "./basemap";

export type { BBox };
export { bboxAreaKm2 };

const poly = (b: BBox): GeoJSON.Feature => ({
  type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] },
});
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const round = (b: number[]) => b.map((v) => Number(v.toFixed(5))) as BBox;
/** Inset of the framing box, as fractions of the map size (kept in sync with .map-frame-box in CSS). */
const FRAME = { x: 0.12, y: 0.14 };

interface Props {
  value: BBox | null;
  onChange: (b: BBox, label?: string) => void;
  maxKm2?: number;
  height?: number | string;
}

/**
 * Choose an area by (1) searching for a place, (2) moving the map until the frame covers it and
 * pressing "Use this area" - or by drawing a box. Works with mouse, touch and keyboard
 * (the map itself pans with the arrow keys and zooms with + / -).
 */
export function AoiPicker({ value, onChange, maxKm2 = 1500, height = 460 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"frame" | "draw" | "chosen">(value ? "chosen" : "frame");
  const [basemap, setBasemap] = useState<BasemapId>("satellite");
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [frameKm2, setFrameKm2] = useState<number | null>(null);
  const [noMap, setNoMap] = useState(false);
  const places = usePlaces(term);
  const start = useRef<[number, number] | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const placeLabel = useRef<string | undefined>(undefined);

  const frameBounds = useCallback((): BBox | null => {
    const map = mapRef.current;
    if (!map) return null;
    const c = map.getContainer();
    const w = c.clientWidth;
    const h = c.clientHeight;
    const tl = map.unproject([w * FRAME.x, h * FRAME.y]);
    const br = map.unproject([w * (1 - FRAME.x), h * (1 - FRAME.y)]);
    return round([Math.min(tl.lng, br.lng), Math.min(tl.lat, br.lat), Math.max(tl.lng, br.lng), Math.max(tl.lat, br.lat)]);
  }, []);

  // ------------------------------------------------------------------ create the map once
  useEffect(() => {
    if (!host.current) return;
    let cancelled = false;
    let created: MLMap | null = null;
    getBaseStyle().then(({ style }) => {
      if (cancelled || !host.current) return;
      try {
        const map = new maplibregl.Map({
          container: host.current, style, center: [20, 18], zoom: 1.4, attributionControl: { compact: true }, dragRotate: false,
          ...(value ? { bounds: [[value[0], value[1]], [value[2], value[3]]], fitBoundsOptions: { padding: 60 } } : {}),
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
        map.on("load", () => {
          map.addSource("box", { type: "geojson", data: value ? poly(value) : EMPTY });
          map.addLayer({ id: "box-fill", type: "fill", source: "box", paint: { "fill-color": "#1f6fd1", "fill-opacity": 0.14 } });
          map.addLayer({ id: "box-line", type: "line", source: "box", paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.9 } });
          map.addLayer({ id: "box-line2", type: "line", source: "box", paint: { "line-color": "#15213b", "line-width": 2.5 } });
          setReady(true);
        });
        const measure = () => {
          const b = frameBounds();
          setFrameKm2(b ? bboxAreaKm2(b) : null);
        };
        map.on("moveend", measure);
        map.on("resize", measure);
        map.once("idle", measure);
        mapRef.current = map;
        created = map;
      } catch {
        setNoMap(true); // WebGL unavailable
      }
    });
    return () => {
      cancelled = true;
      created?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ready && mapRef.current) applyBasemap(mapRef.current, basemap);
  }, [ready, basemap]);

  // ------------------------------------------------------------------ external value -> map
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("box") as GeoJSONSource).setData(value ? poly(value) : EMPTY);
    if (value) map.fitBounds([[value[0], value[1]], [value[2], value[3]]], { padding: 70, maxZoom: 13, duration: 700 });
  }, [ready, value]);

  useEffect(() => {
    if (value && mode === "frame") setMode("chosen");
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ draw mode (mouse + touch)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (mode !== "draw") {
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
      return;
    }
    map.dragPan.disable();
    map.getCanvas().style.cursor = "crosshair";
    const src = () => map.getSource("box") as GeoJSONSource;
    const down = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if ("points" in e && e.points.length > 1) return; // let two-finger gestures zoom
      e.preventDefault();
      start.current = [e.lngLat.lng, e.lngLat.lat];
    };
    const move = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!start.current) return;
      const [x0, y0] = start.current;
      src().setData(poly([Math.min(x0, e.lngLat.lng), Math.min(y0, e.lngLat.lat), Math.max(x0, e.lngLat.lng), Math.max(y0, e.lngLat.lat)]));
    };
    const up = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!start.current) return;
      const [x0, y0] = start.current;
      start.current = null;
      const b = round([Math.min(x0, e.lngLat.lng), Math.min(y0, e.lngLat.lat), Math.max(x0, e.lngLat.lng), Math.max(y0, e.lngLat.lat)]);
      if (b[2] - b[0] > 1e-4 && b[3] - b[1] > 1e-4) {
        changeRef.current(b, placeLabel.current);
        setMode("chosen");
      }
    };
    map.on("mousedown", down);
    map.on("touchstart", down);
    map.on("mousemove", move);
    map.on("touchmove", move);
    map.on("mouseup", up);
    map.on("touchend", up);
    return () => {
      map.off("mousedown", down);
      map.off("touchstart", down);
      map.off("mousemove", move);
      map.off("touchmove", move);
      map.off("mouseup", up);
      map.off("touchend", up);
    };
  }, [ready, mode]);

  // ------------------------------------------------------------------ actions
  const search = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setTerm(q);
    setShowResults(true);
  };

  const goToPlace = (p: Place) => {
    const map = mapRef.current;
    setShowResults(false);
    placeLabel.current = p.kind === "coordinates" ? undefined : [p.name, p.context].filter(Boolean).join(", ");
    setMode("frame");
    if (!map) return;
    const small = p.bbox && bboxAreaKm2(p.bbox) <= maxKm2 && bboxAreaKm2(p.bbox) >= 4;
    if (small && p.bbox) map.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { padding: 40, duration: 1200 });
    else map.flyTo({ center: [p.lon, p.lat], zoom: 11, duration: 1200 });
  };

  const useFrame = () => {
    const b = frameBounds();
    if (!b) return;
    changeRef.current(b, placeLabel.current);
    setMode("chosen");
  };

  const restartFrame = () => {
    setMode("frame");
    const map = mapRef.current;
    if (map && value) map.fitBounds([[value[0], value[1]], [value[2], value[3]]], { padding: { top: 90, bottom: 90, left: 90, right: 90 }, duration: 500 });
  };

  const verdictFrame = areaVerdict(frameKm2, maxKm2);
  const chosenKm2 = value ? bboxAreaKm2(value) : null;
  const verdictChosen = areaVerdict(chosenKm2, maxKm2);

  return (
    <div>
      <div className="map-frame" style={{ height }}>
        <div ref={host} className="map-host" style={{ position: "absolute", inset: 0 }} role="application" aria-label="Map for choosing an area. Use arrow keys to move and plus or minus to zoom." />
        {noMap && <div className="empty" style={{ position: "absolute", inset: 0 }}><h3>The map can't be shown</h3><p className="small">This browser has WebGL turned off. Pick a past disaster or a current alert instead.</p></div>}
        {mode === "frame" && !noMap && (
          <div className="map-frame-box" aria-hidden><span className="corner c1" /><span className="corner c2" /><span className="corner c3" /><span className="corner c4" /></div>
        )}

        <div className="map-overlay map-toolbar">
          <form onSubmit={search} role="search" style={{ position: "relative", flex: "1 1 260px", maxWidth: 420 }}>
            <div className="input-group" style={{ boxShadow: "var(--shadow-2)" }}>
              <Search size={18} aria-hidden />
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a town, region or 'lat, lon'"
                aria-label="Search for a place" onFocus={() => term && setShowResults(true)} />
              {query && <button type="button" className="btn btn-ghost btn-sm icon-btn" aria-label="Clear search" onClick={() => { setQuery(""); setShowResults(false); }}><X size={16} /></button>}
              <button type="submit" className="btn btn-primary btn-sm">Find</button>
            </div>
            {showResults && term && (
              <div className="place-results" role="listbox" aria-label="Places found">
                {places.isLoading && <div className="loading" style={{ padding: "12px 16px" }}><span className="spinner" aria-hidden /> Searching…</div>}
                {places.isError && <div className="small" style={{ padding: "12px 16px", color: "var(--danger)" }}>{friendlyError(places.error)}</div>}
                {places.data?.results.length === 0 && <div className="small muted" style={{ padding: "12px 16px" }}>No place called "{term}" was found. Try a bigger town or region nearby.</div>}
                {places.data?.results.map((p, i) => (
                  <button key={`${p.lat},${p.lon},${i}`} type="button" role="option" aria-selected={false} onClick={() => goToPlace(p)}>
                    <strong><MapPin size={14} aria-hidden style={{ verticalAlign: -2, marginRight: 6 }} />{p.name}</strong>
                    <span>{p.context || p.kind}</span>
                  </button>
                ))}
                {!!places.data?.results.length && <div className="caption muted" style={{ padding: "8px 16px" }}>Search by OpenStreetMap Nominatim</div>}
              </div>
            )}
          </form>
          <div className="map-pill" role="group" aria-label="Background map" style={{ marginLeft: "auto" }}>
            {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => <button key={id} type="button" aria-pressed={basemap === id} onClick={() => setBasemap(id)}>{BASEMAPS[id].label}</button>)}
          </div>
        </div>

        <div className="map-overlay map-bottom">
          {mode === "frame" && (
            <>
              <div className="area-badge" aria-live="polite">
                <span>Inside the frame: <strong>{frameKm2 == null ? "-" : `${frameKm2 < 10 ? frameKm2.toFixed(1) : Math.round(frameKm2).toLocaleString("en")} km²`}</strong></span>
                <span className={`chip ${verdictFrame.tone}`}>{verdictFrame.ok ? "Good size" : frameKm2 != null && frameKm2 > maxKm2 ? "Zoom in" : "Zoom out"}</span>
              </div>
              <div className="row-wrap">
                <button type="button" className="btn btn-sm" onClick={() => setMode("draw")}><Pencil size={15} aria-hidden /> Draw a box instead</button>
                <button type="button" className="btn btn-primary" onClick={useFrame} disabled={!verdictFrame.ok}><Crop size={17} aria-hidden /> Use this area</button>
              </div>
            </>
          )}
          {mode === "draw" && (
            <>
              <div className="area-badge" role="status"><Pencil size={16} aria-hidden /> Press and drag on the map to draw your box.</div>
              <button type="button" className="btn btn-sm" onClick={() => setMode(value ? "chosen" : "frame")}>Cancel drawing</button>
            </>
          )}
          {mode === "chosen" && value && (
            <>
              <div className="area-badge" aria-live="polite">
                <span>Your area: <strong>{chosenKm2! < 10 ? chosenKm2!.toFixed(1) : Math.round(chosenKm2!).toLocaleString("en")} km²</strong></span>
                <span className={`chip ${verdictChosen.tone}`}>{verdictChosen.ok ? "Good size" : "Needs a change"}</span>
              </div>
              <div className="row-wrap">
                <button type="button" className="btn btn-sm" onClick={() => mapRef.current?.fitBounds([[value[0], value[1]], [value[2], value[3]]], { padding: 70, duration: 600 })}>
                  <LocateFixed size={15} aria-hidden /> Show my area
                </button>
                <button type="button" className="btn btn-sm" onClick={restartFrame}><Crop size={15} aria-hidden /> Change area</button>
              </div>
            </>
          )}
        </div>
      </div>
      <p className="caption muted" style={{ marginTop: 10 }} aria-live="polite">
        {mode === "frame" && (verdictFrame.ok ? `The frame covers ${areaPicture(frameKm2)}. Press "Use this area" to choose it.` : verdictFrame.text)}
        {mode === "chosen" && value && (verdictChosen.ok ? `Chosen: ${areaPicture(chosenKm2)}.` : verdictChosen.text)}
        {mode === "draw" && "Two fingers still zoom the map on touch screens."}
      </p>
    </div>
  );
}
