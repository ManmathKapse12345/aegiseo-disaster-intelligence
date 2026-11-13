import { useMemo } from "react";
import { useConfig } from "@/api/hooks";

/**
 * The server's processing limits as plain numbers (GET /api/config).
 *
 * The UI must never contradict the backend: the area limit is a server setting (AEGIS_MAX_AOI_KM2),
 * so it is read from the server rather than copied into the frontend. The fallbacks below equal the
 * backend defaults (backend/aegis/config.py, agents/guardrails.py) and are used only until the
 * server has answered, or if it can't be reached.
 */
export interface Limits {
  minKm2: number;
  maxKm2: number;
  /** Largest area that keeps the default pixel size; above it the server coarsens the grid (rule P0). */
  fullDetailKm2: number;
  defaultResolutionM: number;
  maxGridPixels: number;
  maxWindowDays: number;
  maxGapDays: number;
}

export const DEFAULT_LIMITS: Limits = {
  minKm2: 0.25, maxKm2: 1500, fullDetailKm2: 1040, defaultResolutionM: 20, maxGridPixels: 2_600_000, maxWindowDays: 120, maxGapDays: 60,
};

export function useLimits(): Limits {
  const l = useConfig().data?.limits;
  return useMemo(() => (l ? {
    minKm2: l.min_aoi_km2, maxKm2: l.max_aoi_km2, fullDetailKm2: l.full_detail_max_km2, defaultResolutionM: l.default_resolution_m,
    maxGridPixels: l.max_grid_pixels, maxWindowDays: l.max_window_days, maxGapDays: l.max_pre_post_gap_days,
  } : DEFAULT_LIMITS), [l]);
}

/**
 * Pixel size the server will actually use for an area (same rule as Grid.for_aoi in backend/aegis/geo/grid.py:
 * coarsen in 10 m steps until the grid fits the pixel budget). Approximate, because the server grids the area's
 * bounding box in UTM, which is slightly larger than the area itself.
 */
export function effectiveResolution(km2: number, requestedM: number, maxGridPixels: number): number {
  const px = (km2 * 1e6) / (requestedM * requestedM);
  if (px <= maxGridPixels) return requestedM;
  return Math.ceil((requestedM * Math.sqrt(px / maxGridPixels)) / 10) * 10;
}
