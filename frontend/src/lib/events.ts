/** Live-alert vocabulary shared by pages and the events map (kept free of the map library so pages stay light). */
import type { Hazard } from "@/api/types";

export const HAZARD_COLOR: Record<string, string> = {
  flood: "#1f6fd1", tropical_cyclone: "#6250d6", earthquake: "#8a5a2b", wildfire: "#d9480f", drought: "#c99a00", volcano: "#c62828",
};
export const EVENT_NAME: Record<string, string> = {
  flood: "Flood", tropical_cyclone: "Tropical storm", earthquake: "Earthquake", wildfire: "Wildfire", drought: "Drought", volcano: "Volcano",
};
/** GDACS event types that can be mapped: storms through the flooding they cause. */
export const SUPPORTED_EVENT: Record<string, Hazard> = { flood: "flood", tropical_cyclone: "flood", wildfire: "wildfire" };
