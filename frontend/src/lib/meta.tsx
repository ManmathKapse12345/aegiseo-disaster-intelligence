/**
 * The product's vocabulary: every technical concept the backend uses, named and explained in
 * ordinary words. Pages import from here so the same thing is always called the same thing.
 * Plain wording never changes the meaning: each entry was checked against the backend code
 * that produces the value (see the comments for the source of truth).
 */
import {
  AlertOctagon, AlertTriangle, CircleCheck, CircleDashed, CircleDot, CircleX, Clock3, Droplets, Flame, Hourglass, Info, Mountain,
  ShieldAlert, Siren, XOctagon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AnalysisStatus, Category, Hazard } from "@/api/types";

type IconFn = (s?: number) => ReactNode;

export const HAZARDS: Record<Hazard, {
  label: string; noun: string; found: string; areaName: string; icon: IconFn; color: string; soft: string; question: string;
  lookFor: string; how: string; technical: string; caution?: string;
}> = {
  flood: {
    label: "Flood", noun: "flooding", found: "flooded", areaName: "flooded area", color: "var(--flood)", soft: "var(--flood-soft)",
    icon: (s = 18) => <Droplets size={s} aria-hidden />,
    question: "Water where it shouldn't be",
    lookFor: "New water that wasn't there before the event. Rivers and lakes that are always there are ignored.",
    how: "Compares radar images (Sentinel-1) and optical images (Sentinel-2) from before and after. Radar images can be taken through clouds, so floods can be mapped even in bad weather.",
    technical: "Gated-fusion U-Net on Sentinel-1 + Sentinel-2, post-classification comparison, JRC permanent water removed, SAR log-ratio and MNDWI cross-checks, terrain constraints.",
  },
  wildfire: {
    label: "Wildfire", noun: "burned land", found: "burned", areaName: "burned area", color: "var(--wildfire)", soft: "var(--wildfire-soft)",
    icon: (s = 18) => <Flame size={s} aria-hidden />,
    question: "Land that has burned",
    lookFor: "Burn scars: places where vegetation was burned, and how badly each part burned.",
    how: "Compares a cloud-free optical image from before the fire with one from after it, and measures how much healthy vegetation changed to burned ground (the dNBR burn index).",
    technical: "dNBR burn severity (USGS FIREMON classes) with radar and NASA FIRMS active-fire corroboration.",
    caution: "Works best with cloud-free optical images from before and after the fire. If clouds or smoke hide the ground, AegisEO uses the radar images instead, and that result is much less certain.",
  },
  landslide: {
    label: "Landslide", noun: "possible landslides", found: "possibly hit by landslides", areaName: "possible landslide area", color: "var(--landslide)", soft: "var(--landslide-soft)",
    icon: (s = 18) => <Mountain size={s} aria-hidden />,
    question: "Hillsides that slid down",
    lookFor: "Fresh scars on steep slopes where vegetation and soil were suddenly stripped away.",
    how: "Looks for places where vegetation was lost (optical images), the radar signal changed, and the ground is steep, all at the same spot. Results are only 'possible' landslides.",
    technical: "Multi-indicator candidates (NDVI loss, SAR change, slope from Copernicus DEM); always routed to analyst verification.",
    caution: "A person must always confirm possible landslides before anyone acts on them.",
  },
};

export const CATEGORIES: Category[] = ["Critical", "High", "Moderate", "Low"];
/** Meanings follow backend/aegis/analysis/prioritize.py (score thresholds, life-safety floor rule, recommend()). */
export const PRIORITY: Record<Category, { color: string; bg: string; ink: string; icon: IconFn; short: string; meaning: string }> = {
  Critical: { color: "var(--p-critical)", bg: "var(--p-critical-bg)", ink: "var(--p-critical-ink)", icon: (s = 14) => <Siren size={s} aria-hidden />,
    short: "Look here first",
    meaning: "Badly hit and many people or important places like hospitals are there. Check and coordinate help here first." },
  High: { color: "var(--p-high)", bg: "var(--p-high-bg)", ink: "var(--p-high-ink)", icon: (s = 14) => <AlertOctagon size={s} aria-hidden />,
    short: "Check soon",
    meaning: "Clearly hit and people or important places are nearby. Check soon." },
  Moderate: { color: "var(--p-moderate)", bg: "var(--p-moderate-bg)", ink: "var(--p-moderate-ink)", icon: (s = 14) => <AlertTriangle size={s} aria-hidden />,
    short: "Keep an eye on it",
    meaning: "Partly hit, or few people there. Check it again when the next satellite image is available." },
  Low: { color: "var(--p-low)", bg: "var(--p-low-bg)", ink: "var(--p-low-ink)", icon: (s = 14) => <CircleDot size={s} aria-hidden />,
    short: "Routine watch",
    meaning: "Little damage seen near people. Routine monitoring is enough for now." },
};
/** Validated severity palette (docs/design.md) - shared with the PDF report and the explainer images. */
export const PRIORITY_HEX: Record<Category, string> = { Critical: "#c62828", High: "#ef6c00", Moderate: "#e9b308", Low: "#2a9d8f" };

/** Status names as people would say them. "help" explains what happened and what it means for you. */
export const STATUS: Record<AnalysisStatus, { label: string; tone: string; icon: ReactNode; help: string }> = {
  queued: { label: "Waiting to start", tone: "", icon: <Clock3 size={14} aria-hidden />, help: "Waiting for a free worker. It starts on its own." },
  running: { label: "Working on it", tone: "info", icon: <Hourglass size={14} aria-hidden />, help: "AegisEO is downloading satellite images and looking for changes." },
  completed: { label: "Done", tone: "ok", icon: <CircleCheck size={14} aria-hidden />, help: "Finished. Every automatic safety check passed." },
  completed_with_warnings: { label: "Done, with notes", tone: "warn", icon: <Info size={14} aria-hidden />,
    help: "Finished. Automatic safety checks recorded notes (for example about image quality). Read them before relying on the results; no action is required." },
  needs_review: { label: "Needs a person to check", tone: "warn", icon: <ShieldAlert size={14} aria-hidden />,
    help: "Finished, but a safety check found something that needs a person's judgement, or a high-priority square has weak evidence. The items are listed under To review." },
  failed: { label: "Something went wrong", tone: "danger", icon: <CircleX size={14} aria-hidden />, help: "An unexpected error stopped it. Try running it again." },
  cancelled: { label: "Stopped", tone: "", icon: <XOctagon size={14} aria-hidden />, help: "Someone stopped it before it finished." },
  insufficient_data: { label: "No usable images", tone: "warn", icon: <CircleDashed size={14} aria-hidden />,
    help: "No usable satellite image taken after the event was found for this place and these dates." },
  rejected: { label: "Couldn't start", tone: "danger", icon: <XOctagon size={14} aria-hidden />, help: "Some of the choices weren't valid, so it didn't run." },
  interrupted: { label: "Interrupted", tone: "warn", icon: <CircleDashed size={14} aria-hidden />, help: "The server restarted while it was running. Run it again." },
};
export const FINISHED = new Set<AnalysisStatus>(["completed", "completed_with_warnings", "needs_review"]);
export const ACTIVE = new Set<AnalysisStatus>(["queued", "running"]);

export const CONFIDENCE: Record<string, { label: string; level: 1 | 2 | 3; text: string }> = {
  High: { label: "High", level: 3, text: "The model was confident, an independent method agrees, and no data was missing." },
  Medium: { label: "Medium", level: 2, text: "Mostly consistent, but the model was less confident in places, or some data was missing." },
  Low: { label: "Low", level: 1, text: "The model was uncertain or the two methods disagree. Treat these results as a first estimate and check them." },
};

export const FACILITY_LABEL: Record<string, string> = {
  hospital: "Hospital", clinic: "Clinic", fire_station: "Fire station", ambulance_station: "Ambulance station",
  police: "Police station", shelter: "Shelter", school: "School", power: "Power facility", water_works: "Water works", settlement: "Village or town",
};

export const FACTOR_LABEL: Record<string, string> = {
  extent: "How much of the square is hit", intensity: "How strong the signal is", population: "People living there",
  critical_facilities: "Important places", access: "Roads affected",
};
export const FACTOR_COLOR: Record<string, string> = {
  extent: "var(--series-1)", intensity: "var(--series-2)", population: "var(--series-3)", critical_facilities: "var(--series-4)", access: "var(--series-5)",
};

/** Map layers (ids from backend/aegis/reports/layers.py) in plain words. */
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function layerName(id: string, hazard: Hazard): { name: string; hint: string } {
  const found = HAZARDS[hazard].found;
  switch (id) {
    case "s2_pre_rgb": return { name: "Optical image, before", hint: "Natural-colour Sentinel-2 image taken before the event" };
    case "s2_post_rgb": return { name: "Optical image, after", hint: "Natural-colour Sentinel-2 image taken after the event" };
    case "s1_pre_vv": return { name: "Radar image, before", hint: "Sentinel-1 radar works through clouds. Calm water looks dark" };
    case "s1_post_vv": return { name: "Radar image, after", hint: "Sentinel-1 radar works through clouds. Calm water looks dark" };
    case "affected": return hazard === "wildfire"
      ? { name: "Burned area (how badly)", hint: "Burned land, coloured by how severe the burn was" }
      : { name: capitalise(HAZARDS[hazard].areaName), hint: "The final result after all checks" };
    case "hazard_probability": return hazard === "wildfire"
      ? { name: "Burn strength (dNBR)", hint: "How strongly each pixel changed from vegetation to burned ground" }
      : { name: "Probability, pixel by pixel", hint: `The model's estimated probability that each pixel is ${found}` };
    case "uncertainty": return { name: "Model uncertainty", hint: "Brighter = the model is less certain. Uncertain areas deserve a closer look" };
    case "sar_reliance": return { name: "Radar or optical?", hint: "Which image type the model relied on more at each pixel" };
    case "sar_change": return { name: "Radar change", hint: "How much the radar signal changed between before and after" };
    default: return { name: id.replace(/_/g, " "), hint: "" };
  }
}

/**
 * What each safety check (backend/aegis/agents/guardrails.py) means for a person.
 * title: what happened, in plain words. why: why it matters. look: what a reviewer can do.
 */
export const CHECKS: Record<string, { title: string; why: string; look?: string }> = {
  G01: { title: "This kind of disaster isn't supported", why: "Only floods, wildfires and landslides can be mapped from these satellite images." },
  G02: { title: "The area is too big or too small", why: "Areas above the size limit would take too long and need too much memory; very small areas are smaller than what the images can show." },
  G03: { title: "The dates don't fit together", why: "The 'before' search must end by the event date, the 'after' search must not end before it, and each search can be at most 120 days long." },
  G04: { title: "No usable 'after' image", why: "Without an image taken after the event, there is nothing to compare." },
  G05: { title: "No 'before' image was found", why: "The change was judged against long-term water records instead of a fresh 'before' image, which is less precise." },
  G06: { title: "The 'before' and 'after' images are far apart in time", why: "They are more than 60 days apart. Over many weeks, crops grow and rivers change with the seasons, and those normal changes can look like flooding or damage." },
  G07: { title: "The radar images were taken from different orbits", why: "Radar images compare best when both were taken from the same orbit (the same viewing angle). This comparison is less reliable." },
  G08: { title: "Clouds hid the ground in the optical image", why: "Optical images cannot see through cloud. When radar images are available they take the lead; without radar, very little can be seen.",
    look: "Check whether the marked areas look sensible on the radar images." },
  G09: { title: "The newest 'after' image is more than 10 days old", why: "The situation on the ground may have changed since that image was taken." },
  G10: { title: "A simpler backup method was used", why: "The flood model could not be loaded, so simpler fixed rules (thresholds) were used. They make more mistakes.",
    look: "Compare the marked area with the 'before' and 'after' images." },
  G11: { title: "This place looks unusual to the model", why: "The flood model was trained on floods in 11 places. This area's images look different from all of them (for example desert, snow or dense city), so its answers may be less reliable.",
    look: "Turn on 'Optical image, before' and 'Optical image, after' on the map. Does the marked area really look changed?" },
  G12: { title: "An unusually large area was marked", why: "More than 60% of the area was marked. That can be a systematic mistake, such as cloud shadows or a seasonal change.",
    look: "Compare the 'before' and 'after' images across the whole area." },
  G13: { title: "The model is uncertain about this result", why: "Two independent methods disagree about where the change is, or the model was uncertain about many pixels.",
    look: "Turn on 'Model uncertainty' and compare the images. Is the marked area real?" },
  G14: { title: "Many pixels were removed because of hills", why: "On steep slopes, radar creates shadows that look like water, so those pixels were removed. A real flood there could be missed." },
  G15: { title: "Possible landslides always need a person to check", why: "Landslide marks are only 'possible' landslides. A person must confirm them, for example with higher-resolution images or a report from the ground.",
    look: "Look at the marked areas on the 'Optical image, before' and 'Optical image, after' layers." },
  G16: { title: "Warning text was checked against the numbers", why: "Every number and date in a warning must match a measured value; otherwise the text is withheld." },
  G17: { title: "Warning text uses careful wording", why: "Warnings may not claim deaths, give orders or sound more certain than the evidence allows." },
  G18: { title: "Only a named person can approve a warning", why: "The system never sends anything on its own. Practice-data warnings can never be sent." },
  HITL: { title: "A high-priority square with weak evidence", why: "This square ranks Critical or High, but its confidence is low. It should be checked before anyone acts on it." },
};

export function checkCode(title: string | null | undefined, payload?: Record<string, unknown> | null): string | null {
  const fromPayload = typeof payload?.code === "string" ? payload.code : null;
  if (fromPayload) return fromPayload;
  const m = title?.match(/^(G\d{2})\b/);
  return m ? m[1] : null;
}

export const GLOSSARY: { term: string; def: string }[] = [
  { term: "Radar images (Sentinel-1)", def: "Images from a synthetic-aperture radar (SAR): the satellite sends its own microwave pulses to the ground and measures the echo. It works through clouds and at night. Calm water reflects the pulses away from the satellite, so it looks dark." },
  { term: "Optical images (Sentinel-2)", def: "Images made from sunlight reflected by the ground, like a normal camera photo, plus infrared light that our eyes can't see. Very sharp in clear weather (10 m pixels), but clouds and smoke block them." },
  { term: "Pixel", def: "One small square of a satellite image. AegisEO normally works with 20 m × 20 m pixels; anything much smaller than a pixel can't be seen." },
  { term: "Before and after", def: "An image from shortly before the disaster and one from just after it. What changed between them is what AegisEO maps." },
  { term: "Priority square", def: "The area is divided into squares (0.5 km across for areas under 50 km², 1 km for most areas, larger above 900 km²). Each square gets a score from 0 to 100 from how much change was found and who and what is there." },
  { term: "People in the area", def: "An estimate of how many people normally live in the part where change was found. It does not mean they were hurt or had to leave." },
  { term: "Important places", def: "Hospitals, clinics, schools, fire and police stations, shelters, power and water works, taken from OpenStreetMap." },
  { term: "How sure we are", def: "Confidence comes from three things: whether two independent methods agree, how uncertain the model was, and whether any data was missing." },
  { term: "Safety checks", def: "18 automatic tests that run during every check. Each one passes, records a note, asks for a person, or stops something unsafe (a bad request or unchecked warning text)." },
  { term: "Note", def: "A safety-check result that needs no action but should be read before relying on the result, for example 'the radar images were taken from different orbits'." },
  { term: "Finding to double-check", def: "An item a person must decide on: created when a safety check needs human judgement, or when a Critical or High square has weak evidence. It is listed under To review." },
  { term: "Draft warning", def: "A short message AegisEO writes about the whole area and about each Critical or High square (at most 5). It stays a draft until a named person approves or rejects it." },
  { term: "Practice data", def: "Made-up satellite data used to try AegisEO and to test it. It never shows a real place, and its warnings can never be sent." },
  { term: "Overlap score (IoU)", def: "How well a mapped area matches the true area: the shared part divided by everything either of them marked. 100% would be a perfect match." },
];
