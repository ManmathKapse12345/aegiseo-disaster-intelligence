import type { Hazard, LiveEvent, Scenario } from "@/api/types";
import { type BBox, bboxAreaKm2 } from "@/lib/geo";
import { isoDate } from "@/lib/format";
import { DEFAULT_LIMITS, type Limits } from "@/lib/limits";
import { areaVerdict, autoName, dateProblems, defaultWindows, type Windows } from "@/lib/plain";

export const DRAFT_KEY = "aegis.check.draft.v2";
export type Source = "past" | "live" | "map";

export interface Expert {
  touched: boolean;
  resolution: number;
  threshold: number; // flood only (backend DetectionParams.prob_threshold)
  mc: number; // flood only (Monte-Carlo dropout samples of the deep model)
  dnbr: number; // wildfire only (DetectionParams.dnbr_threshold)
  mmu: number; // all hazards: minimum mapping unit, hectares
  weights: { extent: number; intensity: number; population: number; critical_facilities: number; access: number; hazard_exponent: number };
}
export const DEFAULT_EXPERT: Expert = {
  touched: false, resolution: 20, threshold: 0.5, mc: 6, dnbr: 0.1, mmu: 0.5,
  weights: { extent: 0.55, intensity: 0.45, population: 0.45, critical_facilities: 0.35, access: 0.2, hazard_exponent: 0.5 },
};

export interface Draft {
  source: Source;
  scenarioId: string | null;
  synthetic: boolean;
  eventId: string | null;
  bbox: BBox | null;
  place: string | null;
  hazard: Hazard | null;
  suggestedHazard: Hazard | null;
  event: string;
  windows: Windows;
  customDates: boolean;
  name: string;
  nameTouched: boolean;
  expert: Expert;
}

export const todayIso = () => isoDate(new Date());

export function emptyDraft(source: Source = "map"): Draft {
  const t = todayIso();
  const ev = isoDate(new Date(Date.now() - 7 * 86_400_000));
  return {
    source, scenarioId: null, synthetic: false, eventId: null, bbox: null, place: null, hazard: null, suggestedHazard: null,
    event: ev, windows: defaultWindows(ev, t), customDates: false, name: "", nameTouched: false, expert: DEFAULT_EXPERT,
  };
}

export { SUPPORTED_EVENT } from "@/lib/events";
import { SUPPORTED_EVENT } from "@/lib/events";
/** A live alert gives one point; check a box of 0.16 x 0.16 degrees around it (about 18 km north-south; east-west it
 *  narrows with latitude, e.g. about 13 km at 45 degrees, so the UI shows the measured size instead of a fixed figure). */
export const EVENT_HALF_DEG = 0.08;

export type Action =
  | { type: "source"; source: Source }
  | { type: "scenario"; s: Scenario }
  | { type: "liveEvent"; e: LiveEvent }
  | { type: "area"; bbox: BBox; place?: string | null; keepSource?: boolean }
  | { type: "hazard"; hazard: Hazard }
  | { type: "date"; event: string }
  | { type: "windows"; windows: Windows }
  | { type: "resetWindows" }
  | { type: "name"; name: string }
  | { type: "expert"; patch: Partial<Expert> }
  | { type: "prefill"; patch: Partial<Draft> }
  | { type: "reset"; source?: Source };

export function reducer(d: Draft, a: Action): Draft {
  const t = todayIso();
  switch (a.type) {
    case "source":
      return { ...d, source: a.source };
    case "scenario": {
      const w = defaultWindows(a.s.event_date, t);
      return {
        ...d, source: "past", scenarioId: a.s.id, synthetic: a.s.mode === "synthetic", eventId: null, bbox: a.s.bbox, place: a.s.region,
        hazard: a.s.hazard, suggestedHazard: a.s.hazard, event: a.s.event_date,
        windows: { pre: a.s.pre_window ?? w.pre, post: a.s.post_window ?? w.post }, customDates: false,
        name: d.nameTouched ? d.name : a.s.title, nameTouched: false,
      };
    }
    case "liveEvent": {
      const e = a.e;
      const date = (e.from || e.time || "").slice(0, 10);
      const event = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= t ? date : d.event;
      const k = EVENT_HALF_DEG;
      const hz = SUPPORTED_EVENT[e.hazard] ?? null;
      return {
        ...d, source: "live", scenarioId: null, synthetic: false, eventId: e.id,
        bbox: [+(e.lon - k).toFixed(4), +(e.lat - k).toFixed(4), +(e.lon + k).toFixed(4), +(e.lat + k).toFixed(4)],
        place: [e.name, e.country].filter(Boolean).join(", "), hazard: hz ?? d.hazard, suggestedHazard: hz,
        event, windows: defaultWindows(event, t), customDates: false, nameTouched: false, name: "",
      };
    }
    case "area":
      return {
        ...d, bbox: a.bbox, place: a.place !== undefined ? a.place : d.place, synthetic: false,
        // a moved or redrawn area is no longer the curated case study, but keeps its hazard and dates
        scenarioId: a.keepSource ? d.scenarioId : null, eventId: a.keepSource ? d.eventId : null,
        name: a.keepSource || d.nameTouched ? d.name : "",
      };
    case "hazard":
      return { ...d, hazard: a.hazard };
    case "date":
      return { ...d, event: a.event, windows: defaultWindows(a.event, t), customDates: false };
    case "windows":
      return { ...d, windows: a.windows, customDates: true };
    case "resetWindows":
      return { ...d, windows: defaultWindows(d.event, t), customDates: false };
    case "name":
      return { ...d, name: a.name, nameTouched: true };
    case "expert":
      return { ...d, expert: { ...d.expert, ...a.patch, touched: true } };
    case "prefill":
      return { ...d, ...a.patch };
    case "reset":
      return emptyDraft(a.source ?? d.source);
  }
}

export const areaKm2 = (d: Draft) => (d.bbox ? bboxAreaKm2(d.bbox) : null);
export const displayName = (d: Draft) => (d.nameTouched || d.name ? d.name : d.hazard ? autoName(d.hazard, d.place, d.event) : "");

/** The ranking needs at least one positive weight on each side of the score (same rule as the API, backend/aegis/api/schemas.py). */
export function weightProblem(w: Expert["weights"]): string | null {
  if (w.extent + w.intensity <= 0) return "Give at least one of the two 'change found' weights a value above 0.";
  if (w.population + w.critical_facilities + w.access <= 0) return "Give at least one of the three 'people and places' weights a value above 0.";
  return null;
}

/** Why each step is (not yet) complete - shown next to the Continue button. Limits come from the server (GET /api/config). */
export function stepStatus(d: Draft, step: number, limits: Limits = DEFAULT_LIMITS): { ok: boolean; why: string } {
  if (step === 0) {
    if (d.synthetic) return { ok: true, why: "" };
    if (!d.bbox) return { ok: false, why: "Choose a place to continue." };
    const v = areaVerdict(areaKm2(d), limits.maxKm2, limits.minKm2, limits.fullDetailKm2);
    return v.ok ? { ok: true, why: "" } : { ok: false, why: v.text };
  }
  if (step === 1) return d.hazard ? { ok: true, why: "" } : { ok: false, why: "Choose what kind of disaster to look for." };
  if (step === 2) {
    if (d.synthetic) return { ok: true, why: "" };
    const p = dateProblems(d.event, d.windows, todayIso(), limits.maxWindowDays, limits.maxGapDays);
    return p.errors.length ? { ok: false, why: p.errors[0] } : { ok: true, why: "" };
  }
  const n = displayName(d).trim();
  if (n.length < 3) return { ok: false, why: "Give it a name of at least 3 letters." };
  const wp = d.expert.touched && !d.synthetic ? weightProblem(d.expert.weights) : null;
  return wp ? { ok: false, why: `Ranking settings: ${wp}` } : { ok: true, why: "" };
}
