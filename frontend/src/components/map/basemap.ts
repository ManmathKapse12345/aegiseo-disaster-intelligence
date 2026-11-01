import type { Map as MLMap, StyleSpecification } from "maplibre-gl";

export type BasemapId = "light" | "satellite";

export const BASEMAPS: Record<BasemapId, { label: string }> = {
  light: { label: "Map" },
  satellite: { label: "Satellite" },
};

// Free, key-less basemaps: OpenFreeMap (OpenMapTiles vector, OSM data) and EOX Sentinel-2 cloudless.
const LIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const SATELLITE = {
  tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"],
  attribution: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless 2020</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)',
};

function blankStyle(): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#eef2f6" } }] };
}

function withSatellite(style: StyleSpecification): StyleSpecification {
  const s = structuredClone(style);
  s.sources = { ...s.sources, "base-satellite": { type: "raster", tiles: SATELLITE.tiles, tileSize: 256, maxzoom: 14, attribution: SATELLITE.attribution } };
  // Above every vector base layer, below the analysis overlays added later.
  s.layers = [...s.layers, { id: "base-satellite", type: "raster", source: "base-satellite", layout: { visibility: "none" } }];
  return s;
}

let stylePromise: Promise<{ style: StyleSpecification; vectorOk: boolean }> | null = null;

/** Fetch the base style once per page load (8 s timeout); fall back to a plain background offline. */
export function getBaseStyle(): Promise<{ style: StyleSpecification; vectorOk: boolean }> {
  if (!stylePromise) {
    stylePromise = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(LIGHT_STYLE_URL, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`style HTTP ${res.status}`);
        const style = (await res.json()) as StyleSpecification;
        return { style: withSatellite(style), vectorOk: true };
      } catch {
        return { style: withSatellite(blankStyle()), vectorOk: false };
      } finally {
        clearTimeout(timer);
      }
    })();
  }
  return stylePromise.then((r) => ({ style: structuredClone(r.style), vectorOk: r.vectorOk }));
}

export function setBasemap(map: MLMap, id: BasemapId): void {
  if (map.getLayer("base-satellite")) map.setLayoutProperty("base-satellite", "visibility", id === "satellite" ? "visible" : "none");
}

export function el(tag: string, text?: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

/** Safe popup content from (label, value) rows - text only, never HTML. */
export function popupContent(title: string, rows: [string, string][], note?: string): HTMLElement {
  const root = el("div");
  const h = el("div", title);
  h.style.cssText = "font-weight:700;margin-bottom:6px;color:#0f1b2d";
  root.appendChild(h);
  for (const [k, v] of rows) {
    const r = el("div");
    r.style.cssText = "display:flex;justify-content:space-between;gap:14px;font-size:12px;line-height:1.6";
    const kk = el("span", k);
    kk.style.color = "#66758a";
    const vv = el("strong", v);
    vv.style.fontWeight = "600";
    r.append(kk, vv);
    root.appendChild(r);
  }
  if (note) {
    const n = el("div", note);
    n.style.cssText = "margin-top:6px;font-size:11.5px;color:#3c4a5e;line-height:1.45";
    root.appendChild(n);
  }
  return root;
}
