import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Lets a map fill the whole browser window and return to its normal size.
 *
 * Layout is pure CSS (`.map-frame.map-expanded` is fixed to the viewport), so the map is never re-created and keeps
 * its zoom, layers and selection; MapLibre resizes itself when its container changes size (ResizeObserver).
 * Escape returns to normal size (unless a dialog is open, which handles Escape itself), and the page behind
 * does not scroll while the map is expanded.
 */
export function useMapExpand() {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".modal-backdrop")) setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("map-is-expanded");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("map-is-expanded");
    };
  }, [expanded]);
  const toggle = useCallback(() => setExpanded((x) => !x), []);
  return { expanded, toggle, setExpanded };
}

/** The button that switches between the normal map and the expanded (full-window) map. Its label always says what it will do. */
export function ExpandMapButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <div className="map-pill">
      <button type="button" className="map-expand-btn" onClick={onToggle}
        title={expanded ? "Return the map to its normal size (Esc)" : "Make the map fill the whole window"}>
        {expanded ? <Minimize2 size={16} aria-hidden /> : <Maximize2 size={16} aria-hidden />}
        {expanded ? "Back to normal size" : "Expand map"}
      </button>
    </div>
  );
}
