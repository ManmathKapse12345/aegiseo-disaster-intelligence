/**
 * Plain-language text built from real results.
 *
 * Every number shown comes straight from the API response - these functions only choose
 * words, units and comparisons. They are pure so they can be unit tested
 * (see plain.test.ts) and reused on any page.
 */
import { ApiError } from "@/api/client";
import type { AnalysisDetail, AnalysisStatus, Category, CellProps, Hazard, ReviewTask } from "@/api/types";
import { addDays, fmtArea, fmtCompact, fmtDate, fmtInt, isNum } from "./format";
import { CATEGORIES, CHECKS, FACILITY_LABEL, HAZARDS, checkCode } from "./meta";

// ----------------------------------------------------------------------------- sizes
const PITCH_KM2 = 0.00714; // a 105 m x 68 m football pitch

/** A relatable way to picture an area. */
export function areaPicture(km2: number | null | undefined): string | null {
  if (!isNum(km2) || km2 <= 0) return null;
  if (km2 < 1) {
    const pitches = Math.round(km2 / PITCH_KM2);
    return pitches <= 1 ? "about the size of one football pitch" : `about the size of ${fmtInt(pitches)} football pitches`;
  }
  const side = Math.sqrt(km2);
  return `like a square about ${side < 10 ? side.toFixed(1) : Math.round(side)} km on each side`;
}

export function areaVerdict(km2: number | null, maxKm2: number, minKm2 = 0.25): { ok: boolean; tone: "ok" | "warn" | "danger"; text: string } {
  if (km2 == null) return { ok: false, tone: "warn", text: "Choose an area first." };
  if (km2 > maxKm2) return { ok: false, tone: "danger", text: `Too big. The largest area that can be checked is ${fmtInt(maxKm2)} km². Zoom in or draw a smaller box.` };
  if (km2 < minKm2) return { ok: false, tone: "danger", text: "Too small for the satellite photos to show detail. Zoom out or draw a bigger box." };
  if (km2 > maxKm2 * 0.5) return { ok: true, tone: "warn", text: "Good, but large. It will take a few minutes longer." };
  return { ok: true, tone: "ok", text: "Good size." };
}

// ----------------------------------------------------------------------------- dates
export interface Windows { pre: [string, string]; post: [string, string] }
export const MAX_WINDOW_DAYS = 120; // backend guardrail G03
export const MAX_GAP_DAYS = 60; // backend guardrail G06 (warning)

/** Same defaults as backend/aegis/jobs.py default_windows(). */
export function defaultWindows(event: string, today: string): Windows {
  const post1 = addDays(event, 12);
  return { pre: [addDays(event, -45), addDays(event, -1)], post: [event, post1 > today ? today : post1] };
}

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Problems that would make the backend reject the request (block) plus soft warnings. */
export function dateProblems(event: string, w: Windows, today: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event)) return { errors: ["Choose the date when it happened."], warnings };
  if (event > today) errors.push("The date can't be in the future. Pick the day the disaster happened.");
  if (w.pre[0] > w.pre[1]) errors.push("The 'before' search must start before it ends.");
  if (w.post[0] > w.post[1]) errors.push("The 'after' search must start before it ends.");
  if (w.pre[1] > event) errors.push("The 'before' search must end on or before the day it happened.");
  if (w.post[1] < event) errors.push("The 'after' search must end on or after the day it happened.");
  if (w.post[1] > today) errors.push("The 'after' search can't end in the future.");
  if (days(w.pre[0], w.pre[1]) > MAX_WINDOW_DAYS || days(w.post[0], w.post[1]) > MAX_WINDOW_DAYS)
    errors.push(`Each search can be at most ${MAX_WINDOW_DAYS} days long.`);
  if (!errors.length && days(w.pre[1], w.post[0]) > MAX_GAP_DAYS)
    warnings.push("The 'before' and 'after' searches are more than 60 days apart. Normal seasonal changes (crops, rivers) may then look like damage.");
  if (!errors.length && days(event, today) < 3)
    warnings.push("This was only a few days ago. Satellites pass every few days, so there may not be an 'after' photo yet.");
  return { errors, warnings };
}

// ----------------------------------------------------------------------------- run progress
/** Plain progress stages, mapped from the orchestrator's stage names (backend/aegis/agents/orchestrator.py). */
export const RUN_STAGES = [
  { key: "start", title: "Getting ready", text: "Checking your choices and making a plan." },
  { key: "photos", title: "Finding satellite photos", text: "Searching for radar and camera photos from before and after." },
  { key: "change", title: "Spotting what changed", text: "Comparing the photos to find what the disaster did." },
  { key: "people", title: "Checking who and what is there", text: "Looking up people, hospitals, schools and roads in the hit area." },
  { key: "report", title: "Writing up the results", text: "Ranking where to look first and preparing the report." },
] as const;

export function runStageIndex(stage: string | null | undefined, progress: number): number {
  const s = (stage ?? "").toLowerCase();
  if (s.includes("acquir")) return 1;
  if (s.includes("detect")) return 2;
  if (s.includes("impact") || s.includes("assess")) return 3;
  if (s.includes("report") || s === "done") return 4;
  if (s.includes("plan") || s.includes("queue")) return 0;
  return progress >= 0.85 ? 4 : progress >= 0.65 ? 3 : progress >= 0.45 ? 2 : progress >= 0.1 ? 1 : 0;
}

// ----------------------------------------------------------------------------- the answer
export interface Headline {
  sentence: string;
  /** short phrases to highlight inside the sentence */
  marks: string[];
  detail: string[];
  nothingFound: boolean;
}

export function headline(a: Pick<AnalysisDetail, "hazard" | "summary" | "results" | "area_km2">): Headline | null {
  const s = a.summary;
  if (!s) return null;
  const h = HAZARDS[a.hazard];
  const km2 = s.affected_area_km2 ?? 0;
  const frac = a.results?.hazard?.quality?.affected_fraction_of_aoi;
  const detail: string[] = [];
  if (!(km2 > 0)) {
    return {
      sentence: `No ${h.noun} was found in this area.`,
      marks: [`No ${h.noun}`],
      detail: [noFindReason(a.hazard)],
      nothingFound: true,
    };
  }
  const area = fmtArea(km2);
  const share = isNum(frac) && frac > 0 ? ` That's ${frac < 0.01 ? "less than 1%" : `${Math.round(frac * 100)}%`} of the area that was checked.` : "";
  const verb = a.hazard === "landslide" ? "may have been hit by landslides" : a.hazard === "wildfire" ? "looks burned" : "looks newly flooded";
  const sentence = `About ${area} ${verb}.${share}`;
  const marks = [`${area} ${verb}`];
  if (isNum(s.population_exposed)) {
    detail.push(s.population_exposed > 0
      ? `Around ${fmtInt(s.population_exposed)} people normally live in that part (an estimate - it doesn't mean they were hurt).`
      : "No one is estimated to live in that part.");
  } else {
    detail.push("Population numbers weren't available for this place.");
  }
  const fin = s.facilities_inside ?? null;
  const fnear = s.facilities_near ?? null;
  if (fin != null && fnear != null) {
    if (fin > 0) detail.push(`${fin} important place${fin === 1 ? " is" : "s are"} inside it, and ${fnear} more within 500 m.`);
    else if (fnear > 0) detail.push(`No important places are inside it, but ${fnear} ${fnear === 1 ? "is" : "are"} within 500 m.`);
    else detail.push("No mapped hospitals, schools or emergency services are inside it or within 500 m.");
  }
  const d = s.distribution;
  if (d) {
    const top = CATEGORIES.find((c) => (d[c] ?? 0) > 0);
    if (top) detail.push(`${fmtInt(d[top])} square${d[top] === 1 ? " is" : "s are"} marked ${top} - ${top === "Critical" || top === "High" ? "that's where to look first" : "nothing ranks higher"}.`);
  }
  return { sentence, marks, detail, nothingFound: false };
}

export function noFindReason(hazard: Hazard): string {
  if (hazard === "flood") return "Either there was no new water, or it had already drained away before the satellite passed over. Flash floods often disappear within a day.";
  if (hazard === "wildfire") return "Either nothing burned here, or clouds and smoke hid the ground in the photos.";
  return "Either there were no fresh slides on the hillsides, or clouds hid them. Small slides can be too small for these photos.";
}

/** One line describing an analysis in a list. */
export function oneLiner(a: { hazard: Hazard; status: AnalysisStatus; summary: AnalysisDetail["summary"] }): string {
  const s = a.summary;
  if (!s || !["completed", "completed_with_warnings", "needs_review"].includes(a.status)) return "";
  const km2 = s.affected_area_km2 ?? 0;
  if (!(km2 > 0)) return `No ${HAZARDS[a.hazard].noun} found`;
  const ppl = isNum(s.population_exposed) && s.population_exposed > 0 ? ` · ~${fmtCompact(s.population_exposed)} people there` : "";
  return `${fmtArea(km2)} ${HAZARDS[a.hazard].found}${ppl}`;
}

// ----------------------------------------------------------------------------- priority squares
const looks = (h: Hazard) => (h === "flood" ? "looks flooded" : h === "wildfire" ? "looks burned" : "shows possible landslides");
export interface Reason { icon: "area" | "people" | "place" | "road" | "rule" | "sure" | "missing"; text: string }

export function squareReasons(c: CellProps, hazard: Hazard, cellKm: number | null | undefined): Reason[] {
  const out: Reason[] = [];
  const size = isNum(cellKm) ? `${cellKm % 1 === 0 ? cellKm : cellKm.toFixed(1)} km` : "";
  out.push({ icon: "area", text: `${Math.round(c.affected_fraction * 100)}% of this ${size ? size + " " : ""}square ${looks(hazard)} (${fmtArea(c.affected_km2)}).` });
  if (isNum(c.population_exposed)) {
    out.push({ icon: "people", text: c.population_exposed > 0 ? `About ${fmtInt(c.population_exposed)} people normally live in the hit part.` : "No one is estimated to live in the hit part." });
  } else if (isNum(c.built_up_affected_km2)) {
    out.push({ icon: "people", text: `No population numbers here, so buildings were used instead: ${fmtArea(c.built_up_affected_km2)} of built-up land is in the hit part.` });
  }
  const inside = c.facilities.filter((f) => f.status === "inside");
  const near = c.facilities.filter((f) => f.status === "near");
  if (inside.length) out.push({ icon: "place", text: `Inside the hit part: ${inside.slice(0, 4).map((f) => `${f.name ?? "unnamed"} (${(FACILITY_LABEL[f.category] ?? f.category).toLowerCase()})`).join(", ")}${inside.length > 4 ? ` and ${inside.length - 4} more` : ""}.` });
  if (near.length) out.push({ icon: "place", text: `${near.length} important place${near.length === 1 ? "" : "s"} within 500 m: ${near.slice(0, 3).map((f) => f.name ?? (FACILITY_LABEL[f.category] ?? f.category).toLowerCase()).join(", ")}${near.length > 3 ? "…" : ""}.` });
  if (isNum(c.road_km_affected) && c.road_km_affected > 0) out.push({ icon: "road", text: `${c.road_km_affected < 0.1 ? "A short stretch" : `${c.road_km_affected.toFixed(1)} km`} of road crosses the hit part.` });
  if (c.floor_rule_applied) out.push({ icon: "rule", text: "Raised to High because a hospital, clinic, emergency station or shelter is inside the hit part." });
  if (c.missing_factors.length) out.push({ icon: "missing", text: `Some information was missing here, so the score may be too low: ${c.missing_factors.map((m) => m.replace(/_/g, " ")).join(", ")}.` });
  return out;
}

// ----------------------------------------------------------------------------- review
export interface CheckStory { title: string; why: string; look?: string; technical: string; code: string | null }

export function reviewStory(t: Pick<ReviewTask, "kind" | "title" | "reason" | "payload">): CheckStory {
  if (t.kind === "verify_detection") {
    const cell = typeof t.payload?.cell_id === "string" ? t.payload.cell_id : null;
    return { ...CHECKS.HITL, title: `Check an unsure high-priority square${cell ? ` (${cell})` : ""}`,
      look: "Open the result, find the square on the map, and compare the 'before' and 'after' photos.", technical: t.reason, code: "HITL" };
  }
  const code = checkCode(t.title, t.payload);
  const c = code ? CHECKS[code] : undefined;
  return c ? { ...c, technical: `${t.title}: ${t.reason}`, code } : { title: t.title, why: t.reason, technical: t.reason, code };
}

export type ReviewDecisionKind = "confirm" | "false_positive" | "acknowledge" | "request_rerun";
/** What each review button does - mirrors decide_review() in backend/aegis/actions.py. */
export function decisionEffects(task: Pick<ReviewTask, "payload">): Record<ReviewDecisionKind, { label: string; effect: string }> {
  const cell = typeof task.payload?.cell_id === "string" ? task.payload.cell_id : null;
  return {
    confirm: { label: "Looks right", effect: "Mark it as checked. The results stay as they are." },
    false_positive: { label: "It's wrong", effect: cell
      ? `Square ${cell} is lowered to Low and its waiting draft warnings are rejected.`
      : "All draft warnings from this check that are still waiting are rejected. Priorities stay as they are." },
    acknowledge: { label: "Noted", effect: "Mark it as seen without judging the result. Nothing else changes." },
    request_rerun: { label: "Run it again", effect: "Start a fresh copy of this check with the same settings." },
  };
}

// ----------------------------------------------------------------------------- errors
const FIELD_NAMES: Record<string, string> = {
  name: "Name", hazard: "Type of disaster", bbox: "Area", aoi: "Area", event_date: "Date", pre_window: "'Before' dates",
  post_window: "'After' dates", resolution_m: "Detail level", q: "Search text", reason: "Reason", category: "Priority",
};

/** Error messages people can act on. Technical detail (request id) is kept short and last. */
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    const ref = e.requestId ? ` (reference ${e.requestId})` : "";
    switch (true) {
      case e.status === 0: return e.message.includes("too long")
        ? "The server took too long to answer. Please try again."
        : "Can't reach the AegisEO server. Check your connection, then try again.";
      case e.status === 401: return "Please sign in to do this.";
      case e.status === 403: return "Your account isn't allowed to do this. Ask an administrator for access.";
      case e.status === 404: return "We couldn't find that. It may have been deleted.";
      case e.status === 409: return `${capitalise(e.message)}. The page has been refreshed.`;
      case e.status === 429: return e.message && !/too many requests/i.test(e.message) ? e.message : "Too many requests at once. Please wait a few seconds and try again.";
      case e.status === 422 && !!e.details?.length:
        return `Some choices need fixing: ${e.details!.map((d) => `${FIELD_NAMES[d.field.split(".")[0]] ?? d.field ?? "value"} - ${d.message}`).join("; ")}.`;
      case e.status >= 500: return `Something went wrong on the server. Please try again${ref}.`;
      default: return capitalise(e.message) + (e.message.endsWith(".") ? "" : ".");
    }
  }
  return e instanceof Error ? e.message : String(e);
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ----------------------------------------------------------------------------- names
export function autoName(hazard: Hazard, place: string | null | undefined, event: string): string {
  const where = (place ?? "").split(",").slice(0, 2).join(",").trim();
  const when = /^\d{4}-\d{2}-\d{2}$/.test(event) ? fmtDate(event, { month: "short", year: "numeric" }) : "";
  return [`${HAZARDS[hazard].label} check`, where, when].filter(Boolean).join(" - ").slice(0, 120);
}

export function topCategory(d: Partial<Record<Category, number>> | null | undefined): Category | null {
  if (!d) return null;
  return CATEGORIES.find((c) => (d[c] ?? 0) > 0) ?? null;
}
