import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { LiveEvent } from "@/api/types";
import { fmtDate } from "@/lib/format";
import { getBaseStyle, popupContent } from "./basemap";

import { EVENT_NAME, HAZARD_COLOR } from "@/lib/events";

export function EventsMap({ events, onSelect, selectedId, height = 380 }: { events: LiveEvent[]; onSelect?: (e: LiveEvent) => void; selectedId?: string | null; height?: number | string }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [noMap, setNoMap] = useState(false);
  const selRef = useRef(onSelect);
  selRef.current = onSelect;

  useEffect(() => {
    if (!host.current) return;
    let cancelled = false;
    let created: MLMap | null = null;
    getBaseStyle().then(({ style }) => {
      if (cancelled || !host.current) return;
      try {
        const map = new maplibregl.Map({ container: host.current, style, center: [20, 14], zoom: 0.6, minZoom: 0, attributionControl: { compact: true },
          dragRotate: false, renderWorldCopies: true });
        map.touchZoomRotate.disableRotation();
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
        map.on("load", () => {
          map.addSource("events", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "ev-halo", type: "circle", source: "events", paint: {
            "circle-radius": ["match", ["get", "alert_level"], "Red", 18, "Orange", 13, 9], "circle-color": ["get", "color"], "circle-opacity": 0.18 } });
          map.addLayer({ id: "ev", type: "circle", source: "events", paint: {
            "circle-radius": ["match", ["get", "alert_level"], "Red", 7.5, "Orange", 6.5, 5], "circle-color": ["get", "color"],
            "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
          map.addLayer({ id: "ev-sel", type: "circle", source: "events", filter: ["==", ["get", "id"], ""], paint: {
            "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#15213b", "circle-stroke-width": 3 } });
          const popup = new maplibregl.Popup({ maxWidth: "300px" });
          map.on("click", "ev", (e) => {
            const p = e.features?.[0]?.properties as Record<string, string> | undefined;
            if (!p) return;
            popup.setLngLat(e.lngLat).setDOMContent(popupContent(p.name, [["What", EVENT_NAME[p.hazard] ?? p.hazard.replace(/_/g, " ")],
              ["Alert level", p.alert_level || "-"], ["Since", fmtDate(p.from || p.time)], ["Reported by", p.source]], p.severity_text || undefined)).addTo(map);
            selRef.current?.(JSON.parse(p.raw) as LiveEvent);
          });
          map.on("mouseenter", "ev", () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", "ev", () => (map.getCanvas().style.cursor = ""));
          setReady(true);
        });
        mapRef.current = map;
        created = map;
      } catch {
        setNoMap(true); // WebGL unavailable - the list beside the map still shows every event
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
    (map.getSource("events") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: events.filter((e) => Number.isFinite(e.lon) && Number.isFinite(e.lat)).map((e) => ({
        type: "Feature", geometry: { type: "Point", coordinates: [e.lon, e.lat] },
        properties: { ...e, color: HAZARD_COLOR[e.hazard] ?? "#5c677a", raw: JSON.stringify(e) },
      })),
    });
  }, [ready, events]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setFilter("ev-sel", ["==", ["get", "id"], selectedId ?? ""]);
    const ev = events.find((e) => e.id === selectedId);
    if (ev) map.flyTo({ center: [ev.lon, ev.lat], zoom: Math.max(map.getZoom(), 3), duration: 900 });
  }, [ready, selectedId, events]);

  return (
    <div className="map-frame" style={{ height }}>
      <div ref={host} className="map-host" style={{ position: "absolute", inset: 0 }} role="region" aria-label="World map of current disaster alerts" />
      {noMap && <div className="empty" style={{ position: "absolute", inset: 0 }}><p className="small">The map can't be shown in this browser, but every alert is listed.</p></div>}
    </div>
  );
}
