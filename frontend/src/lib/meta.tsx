import {
  AlertOctagon, AlertTriangle, CircleCheck, CircleDashed, CircleDot, CircleX, Clock3, Droplets, Flame, Hourglass, Info, Mountain,
  ShieldAlert, Siren, XOctagon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AnalysisStatus, Category, Hazard } from "@/api/types";

export const HAZARDS: Record<Hazard, { label: string; icon: (s?: number) => ReactNode; color: string; blurb: string; method: string }> = {
  flood: {
    label: "Flood", color: "#2a78d6", icon: (s = 16) => <Droplets size={s} aria-hidden />,
    blurb: "New surface water from radar and optical imagery, with permanent water removed.",
    method: "Gated-fusion deep model (Sentinel-1 + Sentinel-2), cross-checked with classical SAR/optical methods.",
  },
  wildfire: {
    label: "Wildfire", color: "#eb6834", icon: (s = 16) => <Flame size={s} aria-hidden />,
    blurb: "Burn scars and severity from the change in the Normalized Burn Ratio.",
    method: "dNBR burn severity (USGS FIREMON classes) with radar and active-fire corroboration.",
  },
  landslide: {
    label: "Landslide", color: "#8d5524", icon: (s = 16) => <Mountain size={s} aria-hidden />,
    blurb: "Vegetation loss and surface disturbance on steep slopes - candidates for verification.",
    method: "Multi-indicator candidates (NDVI loss, SAR change, slope); always analyst-verified.",
  },
};

export const CATEGORIES: Category[] = ["Critical", "High", "Moderate", "Low"];
export const PRIORITY: Record<Category, { color: string; bg: string; icon: (s?: number) => ReactNode; meaning: string }> = {
  Critical: { color: "var(--p-critical)", bg: "var(--p-critical-bg)", icon: (s = 13) => <Siren size={s} aria-hidden />,
    meaning: "Severe hazard with high exposure of people or life-safety facilities - verify and coordinate first." },
  High: { color: "var(--p-high)", bg: "var(--p-high-bg)", icon: (s = 13) => <AlertOctagon size={s} aria-hidden />,
    meaning: "Significant hazard and exposure - schedule rapid verification." },
  Moderate: { color: "var(--p-moderate)", bg: "var(--p-moderate-bg)", icon: (s = 13) => <AlertTriangle size={s} aria-hidden />,
    meaning: "Limited exposure or partial hazard - monitor with the next acquisition." },
  Low: { color: "var(--p-low)", bg: "var(--p-low-bg)", icon: (s = 13) => <CircleDot size={s} aria-hidden />,
    meaning: "Little exposure detected - routine monitoring." },
};
export const PRIORITY_HEX: Record<Category, string> = { Critical: "#c62828", High: "#ef6c00", Moderate: "#e9b308", Low: "#2a9d8f" };

export const STATUS: Record<AnalysisStatus, { label: string; tone: string; icon: ReactNode; help: string }> = {
  queued: { label: "Queued", tone: "", icon: <Clock3 size={13} aria-hidden />, help: "Waiting for a worker." },
  running: { label: "Running", tone: "info", icon: <Hourglass size={13} aria-hidden />, help: "The agent is working." },
  completed: { label: "Completed", tone: "ok", icon: <CircleCheck size={13} aria-hidden />, help: "Finished without issues." },
  completed_with_warnings: { label: "Completed with warnings", tone: "warn", icon: <Info size={13} aria-hidden />,
    help: "Finished; some data-quality warnings apply." },
  needs_review: { label: "Needs review", tone: "warn", icon: <ShieldAlert size={13} aria-hidden />,
    help: "Uncertain or high-impact findings were routed to an analyst." },
  failed: { label: "Failed", tone: "danger", icon: <CircleX size={13} aria-hidden />, help: "An unexpected error stopped the run." },
  cancelled: { label: "Cancelled", tone: "", icon: <XOctagon size={13} aria-hidden />, help: "Stopped by a user." },
  insufficient_data: { label: "Insufficient data", tone: "warn", icon: <CircleDashed size={13} aria-hidden />,
    help: "No usable observation for this area and period." },
  rejected: { label: "Rejected input", tone: "danger", icon: <XOctagon size={13} aria-hidden />, help: "The request failed input guardrails." },
  interrupted: { label: "Interrupted", tone: "warn", icon: <CircleDashed size={13} aria-hidden />, help: "The server restarted during the run." },
};

export const FACILITY_LABEL: Record<string, string> = {
  hospital: "Hospital", clinic: "Clinic / health post", fire_station: "Fire station", ambulance_station: "Ambulance station",
  police: "Police", shelter: "Shelter", school: "School", power: "Power", water_works: "Water works", settlement: "Settlement",
};

export const FACTOR_LABEL: Record<string, string> = {
  extent: "Affected extent", intensity: "Hazard intensity", population: "Population", critical_facilities: "Critical facilities", access: "Road access",
};
export const FACTOR_COLOR: Record<string, string> = {
  extent: "var(--series-1)", intensity: "var(--series-2)", population: "var(--series-3)", critical_facilities: "var(--series-4)", access: "var(--series-5)",
};

export const GLOSSARY: { term: string; def: string }[] = [
  { term: "SAR (Sentinel-1)", def: "Synthetic Aperture Radar: an active sensor that sees through cloud, day and night. Calm water looks dark because it reflects the radar pulse away." },
  { term: "Optical (Sentinel-2)", def: "A multispectral camera (13 bands). Precise in clear weather, blind under cloud." },
  { term: "MNDWI", def: "Modified Normalized Difference Water Index, (Green - SWIR) / (Green + SWIR). Positive over open water." },
  { term: "dNBR", def: "Differenced Normalized Burn Ratio, NBR before minus after a fire. Larger values mean more severe burning." },
  { term: "Sensor fusion", def: "Combining radar and optical evidence. AegisEO's model learns per pixel how much to trust each sensor." },
  { term: "Calibrated probability", def: "A probability adjusted on held-out data so that '80 %' really is right about 80 % of the time." },
  { term: "Uncertainty", def: "How unsure the model is (Monte-Carlo dropout spread). High uncertainty triggers analyst review." },
  { term: "Cross-method agreement", def: "Share of detections confirmed by an independent classical method (SAR change or optical water index)." },
  { term: "IoU", def: "Intersection over Union: overlap between predicted and true area divided by their union (1 = perfect)." },
  { term: "Potentially exposed", def: "Inside the detected hazard extent. Exposure is not impact - it does not mean injured or displaced." },
  { term: "Human in the loop (HITL)", def: "The agent drafts; trained people review, approve, reject or override before anything is acted on." },
  { term: "Guardrail", def: "An explicit automatic check that blocks, warns or escalates (e.g. heavy cloud, implausible extent, ungrounded text)." },
];
