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
    how: "Compares radar and camera photos from before and after. Radar works through clouds, so floods can be seen even in bad weather.",
    technical: "Gated-fusion U-Net on Sentinel-1 + Sentinel-2, post-classification comparison, JRC permanent water removed, SAR log-ratio and MNDWI cross-checks, terrain constraints.",
  },
  wildfire: {
    label: "Wildfire", noun: "burned land", found: "burned", areaName: "burned area", color: "var(--wildfire)", soft: "var(--wildfire-soft)",
    icon: (s = 18) => <Flame size={s} aria-hidden />,
    question: "Land that has burned",
    lookFor: "Burn scars: places where plants turned to ash, and how badly each part burned.",
    how: "Measures how much healthy plants changed into burned ground between a clear photo before and a clear photo after the fire.",
    technical: "dNBR burn severity (USGS FIREMON classes) with radar and NASA FIRMS active-fire corroboration.",
    caution: "Works best with a cloud-free camera photo before and after the fire. If clouds or smoke block them, radar is used instead - that result is much less certain.",
  },
  landslide: {
    label: "Landslide", noun: "possible landslides", found: "possibly hit by landslides", areaName: "possible landslide area", color: "var(--landslide)", soft: "var(--landslide-soft)",
    icon: (s = 18) => <Mountain size={s} aria-hidden />,
    question: "Hillsides that slid down",
    lookFor: "Fresh scars on steep slopes where plants and soil were suddenly stripped away.",
    how: "Looks for plant loss, ground change seen by radar and steep slopes all in the same place. Results are only 'possible' landslides.",
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
    meaning: "Partly hit, or few people there. Watch it when the next satellite photo arrives." },
  Low: { color: "var(--p-low)", bg: "var(--p-low-bg)", ink: "var(--p-low-ink)", icon: (s = 14) => <CircleDot size={s} aria-hidden />,
    short: "Routine watch",
    meaning: "Little damage seen near people. Routine monitoring is enough for now." },
};
/** Validated severity palette (docs/design.md) - shared with the PDF report and the explainer images. */
export const PRIORITY_HEX: Record<Category, string> = { Critical: "#c62828", High: "#ef6c00", Moderate: "#e9b308", Low: "#2a9d8f" };

/** Status names as people would say them. "help" explains what happened and what it means for you. */
export const STATUS: Record<AnalysisStatus, { label: string; tone: string; icon: ReactNode; help: string }> = {
  queued: { label: "Waiting to start", tone: "", icon: <Clock3 size={14} aria-hidden />, help: "Waiting for a free worker. It starts on its own." },
  running: { label: "Working on it", tone: "info", icon: <Hourglass size={14} aria-hidden />, help: "AegisEO is gathering photos and looking for changes." },
  completed: { label: "Done", tone: "ok", icon: <CircleCheck size={14} aria-hidden />, help: "Finished with no problems." },
  completed_with_warnings: { label: "Done, with notes", tone: "warn", icon: <Info size={14} aria-hidden />,
    help: "Finished. Some notes about photo quality apply - read them before relying on the results." },
  needs_review: { label: "Needs a person to check", tone: "warn", icon: <ShieldAlert size={14} aria-hidden />,
    help: "Finished, but some findings were unsure or important, so a person should look at them first." },
  failed: { label: "Something went wrong", tone: "danger", icon: <CircleX size={14} aria-hidden />, help: "An unexpected error stopped it. Try running it again." },
  cancelled: { label: "Stopped", tone: "", icon: <XOctagon size={14} aria-hidden />, help: "Someone stopped it before it finished." },
  insufficient_data: { label: "Not enough photos", tone: "warn", icon: <CircleDashed size={14} aria-hidden />,
    help: "No usable satellite photo was found for this place and time." },
  rejected: { label: "Couldn't start", tone: "danger", icon: <XOctagon size={14} aria-hidden />, help: "Some of the choices weren't valid, so it didn't run." },
  interrupted: { label: "Interrupted", tone: "warn", icon: <CircleDashed size={14} aria-hidden />, help: "The server restarted while it was running. Run it again." },
};
export const FINISHED = new Set<AnalysisStatus>(["completed", "completed_with_warnings", "needs_review"]);
export const ACTIVE = new Set<AnalysisStatus>(["queued", "running"]);

export const CONFIDENCE: Record<string, { label: string; level: 1 | 2 | 3; text: string }> = {
  High: { label: "High", level: 3, text: "The computer was sure, an independent method agrees, and no data was missing." },
  Medium: { label: "Medium", level: 2, text: "Mostly consistent, but the computer was less sure in places or some data was missing." },
  Low: { label: "Low", level: 1, text: "The computer was unsure or the methods disagree. Treat these results as a first guess and check them." },
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
    case "s2_pre_rgb": return { name: "Photo before", hint: "Normal colour photo (camera) from before the event" };
    case "s2_post_rgb": return { name: "Photo after", hint: "Normal colour photo (camera) from after the event" };
    case "s1_pre_vv": return { name: "Radar picture before", hint: "Radar sees through clouds. Calm water looks dark" };
    case "s1_post_vv": return { name: "Radar picture after", hint: "Radar sees through clouds. Calm water looks dark" };
    case "affected": return hazard === "wildfire"
      ? { name: "Burned area (how badly)", hint: "Burned land, coloured by how severe the burn was" }
      : { name: capitalise(HAZARDS[hazard].areaName), hint: "The final result after all checks" };
    case "hazard_probability": return hazard === "wildfire"
      ? { name: "Burn strength", hint: "How strongly each spot changed from plants to burned ground" }
      : { name: "How likely, spot by spot", hint: `The computer's estimate of how likely each spot is ${found}` };
    case "uncertainty": return { name: "Where the computer is unsure", hint: "Brighter = less sure. Unsure spots deserve a closer look" };
    case "sar_reliance": return { name: "Radar or camera?", hint: "Which kind of photo the computer relied on at each spot" };
    case "sar_change": return { name: "Radar change", hint: "How much the radar signal changed between before and after" };
    default: return { name: id.replace(/_/g, " "), hint: "" };
  }
}

/**
 * What each safety check (backend/aegis/agents/guardrails.py) means for a person.
 * title: what happened, in plain words. why: why it matters. look: what a reviewer can do.
 */
export const CHECKS: Record<string, { title: string; why: string; look?: string }> = {
  G01: { title: "This kind of disaster isn't supported", why: "Only floods, wildfires and landslides can be mapped from these satellite photos." },
  G02: { title: "The area is too big or too small", why: "Very large areas take too long, and tiny ones are smaller than what the photos can show." },
  G03: { title: "The dates don't fit together", why: "The 'before' search must end by the event date and the 'after' search must not end before it." },
  G04: { title: "No usable 'after' photo", why: "Without a photo taken after the event, there is nothing to compare." },
  G05: { title: "No 'before' photo was found", why: "The change was judged against long-term records instead of a fresh 'before' photo, which is less precise." },
  G06: { title: "The 'before' and 'after' photos are far apart in time", why: "Over many weeks, crops grow and rivers change by season. Those normal changes can look like damage." },
  G07: { title: "The radar photos were taken from different angles", why: "Radar compares best when both photos come from the same orbit. This comparison is less reliable." },
  G08: { title: "Clouds blocked the camera", why: "Normal photos can't see through cloud. When radar is available it takes the lead; without radar, very little can be seen.",
    look: "Check whether the marked areas look sensible on the radar pictures." },
  G09: { title: "The newest photo is a few days old", why: "Things may have changed since the satellite last passed over." },
  G10: { title: "A simpler backup method was used", why: "The main computer model wasn't available, so simple rules were used. They make more mistakes.",
    look: "Compare the marked area with the 'before' and 'after' photos." },
  G11: { title: "This place looks unusual to the computer", why: "The computer learned from floods in 11 places. This area's photos look different from all of them (for example desert, snow or dense city), so its answers may be less reliable.",
    look: "Turn on 'Photo before' and 'Photo after' on the map. Does the marked area really look changed?" },
  G12: { title: "An unusually large area was marked", why: "When most of the area is marked, it may be a systematic mistake, such as cloud shadows or a seasonal change.",
    look: "Compare the 'before' and 'after' photos across the whole area." },
  G13: { title: "The computer isn't sure about this result", why: "Two independent ways of finding the change disagree, or the computer was unsure about many spots.",
    look: "Turn on 'Where the computer is unsure' and compare the photos. Is the marked area real?" },
  G14: { title: "Many spots were removed because of hills", why: "On steep slopes radar makes shadows that look like water, so those spots were removed. A real flood there could be missed." },
  G15: { title: "Possible landslides always need a person to check", why: "Landslide marks are only 'possible' landslides. A person must confirm them, for example with sharper photos or a field report.",
    look: "Look at the marked spots on the 'Photo before' and 'Photo after' layers." },
  G16: { title: "Warning text was checked against the numbers", why: "Every number in a warning must match a measured value, otherwise the text is withheld." },
  G17: { title: "Warning text uses careful wording", why: "Warnings may not claim deaths, give orders or sound more certain than the evidence allows." },
  G18: { title: "Only a named person can send a warning", why: "The system never sends anything on its own. Practice-data warnings can never be sent." },
  HITL: { title: "An uncertain high-priority square", why: "This square ranks high, but the evidence is weak. It should be checked before anyone acts on it." },
};

export function checkCode(title: string | null | undefined, payload?: Record<string, unknown> | null): string | null {
  const fromPayload = typeof payload?.code === "string" ? payload.code : null;
  if (fromPayload) return fromPayload;
  const m = title?.match(/^(G\d{2})\b/);
  return m ? m[1] : null;
}

export const GLOSSARY: { term: string; def: string }[] = [
  { term: "Radar (Sentinel-1)", def: "A satellite that sends out its own radio waves and listens for the echo. It sees through clouds and at night. Calm water reflects the waves away, so it looks dark." },
  { term: "Camera photos (Sentinel-2)", def: "A satellite that takes normal colour photos (plus colours our eyes can't see). Very sharp in clear weather, but it can't see through clouds." },
  { term: "Before and after", def: "A photo from shortly before the disaster and one from just after. What changed between them is what the disaster did." },
  { term: "Priority square", def: "The area is split into small squares (usually 1 km across). Each square gets a score from 0 to 100 based on how badly it was hit and who and what is there." },
  { term: "People in the area", def: "An estimate of how many people normally live in the part that was hit. It does not mean they were hurt or had to leave." },
  { term: "Important places", def: "Hospitals, clinics, schools, fire and police stations, shelters, power and water works, taken from OpenStreetMap." },
  { term: "How sure we are", def: "Confidence comes from three things: whether two independent methods agree, how unsure the computer was, and whether any data was missing." },
  { term: "Needs a person to check", def: "When something is unsure or very important, AegisEO stops and asks a person instead of guessing." },
  { term: "Draft warning", def: "A short message AegisEO writes about a high-priority place. It is only a draft until a person approves it." },
  { term: "Practice data", def: "Made-up satellite data used to try AegisEO and to test it. It never shows a real place, and its warnings can never be sent." },
  { term: "Safety checks", def: "Automatic checks that stop bad inputs, flag weak evidence and make sure nothing is sent without a person's approval." },
  { term: "Overlap score (IoU)", def: "How well a mapped area matches the true area: the shared part divided by everything either of them marked. 100% would be a perfect match." },
];
