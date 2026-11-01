import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crop, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BASEMAPS, type BasemapId, getBaseStyle, setBasemap as applyBasemap } from "./basemap";

export type BBox = [number, number, number, number];

export function bboxAreaKm2(b: BBox): number {
  const [minx, miny, maxx, maxy] = b;
  const latMid = ((miny + maxy) / 2) * (Math.PI / 180);
  return Math.abs((maxx - minx) * 111.32 * Math.cos(latMid) * (maxy - miny) * 110.574);
}

const poly = (b: BBox): GeoJSON.Feature => ({
  type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] },
});

export function AoiPicker({ value, onChange, maxKm2 = 1500, height = 420 }: { value: BBox | null; onChange: (b: BBox) => void; maxKm2?: number; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>("satellite");
  const [query, setQuery] = useState("");
  const start = useRef<[number, number] | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    let cancelled = false;
    let created: MLMap | null = null;
    getBaseStyle().then(({ style }) => {
      if (cancelled || !host.current) return;
      try {
        const map = new maplibregl.Map({ container: host.current, style, center: [78, 22], zoom: 3.2, attributionControl: { compact: true }, dragRotate: false });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
        map.on("load", () => {
          map.addSource("box", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "box-fill", type: "fill", source: "box", paint: { "fill-color": "#0ea5e9", "fill-opacity": 0.14 } });
          map.addLayer({ id: "box-line", type: "line", source: "box", paint: { "line-color": "#0e7490", "line-width": 2.5 } });
          setReady(true);
        });
        mapRef.current = map;
        created = map;
      } catch {
        /* WebGL unavailable: the numeric bounding box still works */
      }
    });
    return () => {
      cancelled = true;
      created?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    applyBasemap(map, basemap);
  }, [ready, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("box") as GeoJSONSource).setData(value ? poly(value) : { type: "FeatureCollection", features: [] });
    if (value && !drawing) map.fitBounds([[value[0], value[1]], [value[2], value[3]]], { padding: 60, maxZoom: 12, duration: 600 });
  }, [ready, value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!drawing) {
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
      return;
    }
    map.dragPan.disable();
    map.getCanvas().style.cursor = "crosshair";
    const down = (e: maplibregl.MapMouseEvent) => {
      start.current = [e.lngLat.lng, e.lngLat.lat];
    };
    const move = (e: maplibregl.MapMouseEvent) => {
      if (!start.current) return;
      const [x0, y0] = start.current;
      const b: BBox = [Math.min(x0, e.lngLat.lng), Math.min(y0, e.lngLat.lat), Math.max(x0, e.lngLat.lng), Math.max(y0, e.lngLat.lat)];
      (map.getSource("box") as GeoJSONSource).setData(poly(b));
    };
    const up = (e: maplibregl.MapMouseEvent) => {
      if (!start.current) return;
      const [x0, y0] = start.current;
      start.current = null;
      const b: BBox = [Math.min(x0, e.lngLat.lng), Math.min(y0, e.lngLat.lat), Math.max(x0, e.lngLat.lng), Math.max(y0, e.lngLat.lat)].map((v) => Number(v.toFixed(5))) as BBox;
      if (b[2] - b[0] > 1e-4 && b[3] - b[1] > 1e-4) changeRef.current(b);
      setDrawing(false);
    };
    map.on("mousedown", down);
    map.on("mousemove", move);
    map.on("mouseup", up);
    return () => {
      map.off("mousedown", down);
      map.off("mousemove", move);
      map.off("mouseup", up);
    };
  }, [ready, drawing]);

  const goTo = () => {
    const m = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (m && mapRef.current) {
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) mapRef.current.flyTo({ center: [lon, lat], zoom: 11 });
    }
  };

  const area = value ? bboxAreaKm2(value) : null;
  return (
    <div style={{ position: "relative", height, borderRadius: "var(--r-lg)", overflow: "hidden", border: "1px solid var(--line)" }}>
      <div ref={host} style={{ position: "absolute", inset: 0, height: "100%" }} role="region" aria-label="Area of interest map" />
      <div className="map-overlay" style={{ top: 12, left: 12, right: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className={`btn btn-sm ${drawing ? "btn-primary" : ""}`} onClick={() => setDrawing((d) => !d)} aria-pressed={drawing}>
          <Crop size={14} aria-hidden /> {drawing ? "Click and drag on the map" : "Draw area"}
        </button>
        <form className="row" style={{ background: "#fff", borderRadius: 8, boxShadow: "var(--shadow-1)", paddingLeft: 8 }} onSubmit={(e) => { e.preventDefault(); goTo(); }}>
          <Search size={14} className="muted" aria-hidden />
          <input className="input" style={{ border: 0, height: 32, width: 190, boxShadow: "none" }} placeholder="Go to lat, lon" value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label="Go to coordinates (latitude, longitude)" />
        </form>
        <div className="basemap-switch" style={{ position: "static", marginLeft: "auto" }} role="group" aria-label="Basemap">
          {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => <button key={id} aria-pressed={basemap === id} onClick={() => setBasemap(id)}>{BASEMAPS[id].label}</button>)}
        </div>
      </div>
      {area != null && (
        <div className="map-overlay" style={{ bottom: 12, left: 12 }}>
          <span className={`chip ${area > maxKm2 || area < 0.25 ? "danger" : "brand"}`} style={{ height: 28, background: "#fff", boxShadow: "var(--shadow-1)" }}>
            Area {area.toFixed(area < 10 ? 2 : 0)} km² {area > maxKm2 ? `- exceeds the ${maxKm2} km² limit` : area < 0.25 ? "- too small" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
