import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { LiveEvent } from "@/api/types";
import { fmtDate } from "@/lib/format";
import { getBaseStyle, popupContent } from "./basemap";

const HAZARD_COLOR: Record<string, string> = {
  flood: "#2a78d6", tropical_cyclone: "#6250d6", earthquake: "#8d5524", wildfire: "#eb6834", drought: "#c99a00", volcano: "#c62828",
};

export function EventsMap({ events, onSelect, height = 340 }: { events: LiveEvent[]; onSelect?: (e: LiveEvent) => void; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const selRef = useRef(onSelect);
  selRef.current = onSelect;

  useEffect(() => {
    if (!host.current) return;
    let cancelled = false;
    let created: MLMap | null = null;
    getBaseStyle().then(({ style }) => {
      if (cancelled || !host.current) return;
      try {
        created = build(host.current, style);
      } catch {
        /* WebGL unavailable - the list beside the map still shows every event */
      }
    });
    return () => {
      cancelled = true;
      created?.remove();
      mapRef.current = null;
    };
  }, []);

  function build(container: HTMLDivElement, style: maplibregl.StyleSpecification): MLMap {
    const map = new maplibregl.Map({ container, style, center: [20, 12], zoom: 0.35, minZoom: 0, attributionControl: { compact: true },
      dragRotate: false, renderWorldCopies: true });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => {
      map.addSource("events", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "ev-halo", type: "circle", source: "events", paint: {
        "circle-radius": ["match", ["get", "alert_level"], "Red", 16, "Orange", 12, 8], "circle-color": ["get", "color"], "circle-opacity": 0.18 } });
      map.addLayer({ id: "ev", type: "circle", source: "events", paint: {
        "circle-radius": ["match", ["get", "alert_level"], "Red", 7, "Orange", 6, 4.5], "circle-color": ["get", "color"],
        "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      const popup = new maplibregl.Popup({ maxWidth: "300px" });
      map.on("click", "ev", (e) => {
        const p = e.features?.[0]?.properties as Record<string, string> | undefined;
        if (!p) return;
        popup.setLngLat(e.lngLat).setDOMContent(popupContent(p.name, [["Source", p.source], ["Hazard", p.hazard.replace(/_/g, " ")],
          ["Alert level", p.alert_level || "-"], ["Date", fmtDate(p.from || p.time)]], p.severity_text || undefined)).addTo(map);
        const ev = JSON.parse(p.raw) as LiveEvent;
        selRef.current?.(ev);
      });
      map.on("mouseenter", "ev", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "ev", () => (map.getCanvas().style.cursor = ""));
      setReady(true);
    });
    mapRef.current = map;
    return map;
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("events") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: events.filter((e) => Number.isFinite(e.lon) && Number.isFinite(e.lat)).map((e) => ({
        type: "Feature", geometry: { type: "Point", coordinates: [e.lon, e.lat] },
        properties: { ...e, color: HAZARD_COLOR[e.hazard] ?? "#64748b", raw: JSON.stringify(e) },
      })),
    });
  }, [ready, events]);

  return <div ref={host} style={{ height, borderRadius: "var(--r-lg)", overflow: "hidden" }} role="region" aria-label="Map of current hazard alerts" />;
}

export { HAZARD_COLOR };
