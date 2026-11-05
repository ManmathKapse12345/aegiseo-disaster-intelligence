import { ApiError } from "@/api/client";
import type { AnalysisDetail, CellProps } from "@/api/types";
import {
  areaPicture, areaVerdict, autoName, dateProblems, decisionEffects, defaultWindows, friendlyError, headline, oneLiner, reviewStory,
  runStageIndex, squareReasons, topCategory,
} from "./plain";

const summary = (over: Partial<NonNullable<AnalysisDetail["summary"]>> = {}) => ({
  status: "completed", mode: "real", hazard: "flood", affected_area_km2: 78.21, population_exposed: 7274, population_source: "HRSL",
  facilities_inside: 0, facilities_near: 2, road_km_affected: 1.4, top_priority: "High", distribution: { Critical: 0, High: 24, Moderate: 49, Low: 92 },
  confidence: "Medium", post_observation_date: "2022-08-27", sensors_post: "S1, S2", model_version: "x", escalations: 1, warnings: 1, duration_s: 20, ...over,
}) as NonNullable<AnalysisDetail["summary"]>;

const analysis = (s = summary(), frac = 0.362) =>
  ({ hazard: "flood", area_km2: 216, summary: s, results: { hazard: { quality: { affected_fraction_of_aoi: frac } } } }) as unknown as AnalysisDetail;

describe("sizes", () => {
  it("pictures areas in everyday terms", () => {
    expect(areaPicture(0.5)).toBe("about the size of 70 football pitches");
    expect(areaPicture(216)).toBe("like a square about 15 km on each side");
    expect(areaPicture(4)).toBe("like a square about 2.0 km on each side");
    expect(areaPicture(0)).toBeNull();
  });
  it("explains whether an area can be checked", () => {
    expect(areaVerdict(2000, 1500)).toMatchObject({ ok: false, tone: "danger" });
    expect(areaVerdict(0.1, 1500).text).toMatch(/Too small/);
    expect(areaVerdict(900, 1500)).toMatchObject({ ok: true, tone: "warn" });
    expect(areaVerdict(200, 1500)).toMatchObject({ ok: true, tone: "ok" });
    expect(areaVerdict(null, 1500).ok).toBe(false);
  });
});

describe("dates", () => {
  it("uses the same default search periods as the backend", () => {
    expect(defaultWindows("2022-08-26", "2026-01-01")).toEqual({ pre: ["2022-07-12", "2022-08-25"], post: ["2022-08-26", "2022-09-07"] });
    expect(defaultWindows("2025-12-28", "2026-01-01").post).toEqual(["2025-12-28", "2026-01-01"]); // capped at today
  });
  it("catches every problem the backend would reject, in plain words", () => {
    const today = "2026-01-10";
    expect(dateProblems("2026-02-01", defaultWindows("2026-02-01", "2026-02-20"), today).errors.join(" ")).toMatch(/can't be in the future/);
    expect(dateProblems("2025-06-01", { pre: ["2025-01-01", "2025-05-31"], post: ["2025-06-01", "2025-06-10"] }, today).errors.join(" ")).toMatch(/at most 120 days/);
    expect(dateProblems("2025-06-01", { pre: ["2025-05-01", "2025-06-05"], post: ["2025-06-01", "2025-06-10"] }, today).errors.join(" ")).toMatch(/end on or before/);
    expect(dateProblems("2025-06-01", defaultWindows("2025-06-01", today), today)).toEqual({ errors: [], warnings: [] });
  });
  it("warns (without blocking) when photos would be far apart in time", () => {
    const p = dateProblems("2025-06-01", { pre: ["2025-02-01", "2025-03-01"], post: ["2025-06-01", "2025-06-10"] }, "2026-01-01");
    expect(p.errors).toEqual([]);
    expect(p.warnings.join(" ")).toMatch(/more than 60 days apart/);
  });
});

describe("progress", () => {
  it("maps the orchestrator's stages to five plain steps", () => {
    expect(runStageIndex("planning", 0.02)).toBe(0);
    expect(runStageIndex("acquiring data", 0.1)).toBe(1);
    expect(runStageIndex("detecting change", 0.45)).toBe(2);
    expect(runStageIndex("assessing impact", 0.65)).toBe(3);
    expect(runStageIndex("writing reports", 0.95)).toBe(4);
    expect(runStageIndex(null, 0.7)).toBe(3);
  });
});

describe("the short answer", () => {
  it("states the result using only numbers from the summary", () => {
    const h = headline(analysis())!;
    expect(h.sentence).toBe("About 78.2 km² looks newly flooded. That's 36% of the area that was checked.");
    expect(h.detail[0]).toMatch(/7,274 people normally live/);
    expect(h.detail[0]).toMatch(/doesn't mean they were hurt/);
    expect(h.detail[1]).toBe("No important places are inside it, but 2 are within 500 m.");
    expect(h.detail[2]).toBe("24 squares are marked High - that's where to look first.");
  });
  it("says plainly when nothing was found, and why that can happen", () => {
    const h = headline(analysis(summary({ affected_area_km2: 0, distribution: null })))!;
    expect(h.nothingFound).toBe(true);
    expect(h.sentence).toBe("No flooding was found in this area.");
    expect(h.detail[0]).toMatch(/drained away/);
  });
  it("does not invent population numbers when they are missing", () => {
    expect(headline(analysis(summary({ population_exposed: null })))!.detail[0]).toBe("Population numbers weren't available for this place.");
  });
  it("summarises a result in one line for lists", () => {
    expect(oneLiner({ hazard: "flood", status: "needs_review", summary: summary() })).toBe("78.2 km² flooded · ~7,274 people there");
    expect(oneLiner({ hazard: "flood", status: "failed", summary: null })).toBe("");
    expect(topCategory({ Critical: 0, High: 3, Moderate: 1, Low: 0 })).toBe("High");
  });
});

describe("priority squares", () => {
  const cell = {
    cell_id: "C001-002", rank: 1, score: 72, category: "High", affected_fraction: 0.4, affected_km2: 0.4, population_exposed: 120,
    built_up_affected_km2: null, road_km_affected: 0.3, floor_rule_applied: true, missing_factors: [],
    facilities: [{ id: "a", category: "hospital", name: "City Hospital", status: "inside", distance_m: 0, lon: 0, lat: 0 },
      { id: "b", category: "school", name: "School 4", status: "near", distance_m: 120, lon: 0, lat: 0 }],
  } as unknown as CellProps;
  it("lists the real reasons behind a square's rank", () => {
    const r = squareReasons(cell, "flood", 1).map((x) => x.text);
    expect(r[0]).toBe("40% of this 1 km square looks flooded (0.4 km²).");
    expect(r).toContain("About 120 people normally live in the hit part.");
    expect(r).toContain("Inside the hit part: City Hospital (hospital).");
    expect(r).toContain("1 important place within 500 m: School 4.");
    expect(r).toContain("Raised to High because a hospital, clinic, emergency station or shelter is inside the hit part.");
  });
});

describe("review items", () => {
  it("explains a failed safety check in plain words and keeps the technical text", () => {
    const s = reviewStory({ kind: "quality_check", title: "G11 Input distribution shift", reason: "max channel z-score 4.00 vs training data (S2_post_B12)",
      payload: { code: "G11" } });
    expect(s.title).toBe("This place looks unusual to the computer");
    expect(s.why).toMatch(/learned from floods in 11 places/);
    expect(s.technical).toMatch(/z-score 4.00/);
  });
  it("describes exactly what each decision does (mirrors the backend)", () => {
    expect(decisionEffects({ payload: { cell_id: "C001-002" } }).false_positive.effect).toMatch(/C001-002 is lowered to Low/);
    expect(decisionEffects({ payload: null }).false_positive.effect).toMatch(/Priorities stay as they are/);
    expect(reviewStory({ kind: "verify_detection", title: "Verify", reason: "x", payload: { cell_id: "C003-004" } }).title).toMatch(/C003-004/);
  });
});

describe("errors and names", () => {
  it("turns API errors into messages people can act on", () => {
    expect(friendlyError(new ApiError("Cannot reach the AegisEO API.", 0))).toMatch(/Can't reach the AegisEO server/);
    expect(friendlyError(new ApiError("invalid request", 422, [{ field: "event_date", message: "invalid date" }]))).toBe("Some choices need fixing: Date - invalid date.");
    expect(friendlyError(new ApiError("too many requests", 429))).toMatch(/wait a few seconds/);
    expect(friendlyError(new ApiError("internal error", 500, undefined, "abc123"))).toMatch(/reference abc123/);
    expect(friendlyError(new ApiError("alert already decided (status 'approved')", 409))).toMatch(/^Alert already decided.*refreshed\.$/);
  });
  it("suggests a readable name", () => {
    expect(autoName("flood", "Dadu, Dadu District, Sindh, Pakistan", "2022-08-26")).toBe("Flood check - Dadu, Dadu District - Aug 2022");
    expect(autoName("wildfire", null, "2025-01-07")).toBe("Wildfire check - Jan 2025");
  });
});
