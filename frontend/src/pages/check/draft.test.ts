import type { LiveEvent, Scenario } from "@/api/types";
import { displayName, emptyDraft, reducer, stepStatus } from "./draft";

const sindh: Scenario = {
  id: "pakistan-sindh-2022", title: "Sindh floods, Pakistan (2022)", hazard: "flood", mode: "real", bbox: [67.72, 26.62, 67.86, 26.76],
  event_date: "2022-08-26", pre_window: ["2022-06-01", "2022-07-05"], post_window: ["2022-08-26", "2022-09-10"], region: "Dadu district, Sindh",
  summary: "", why: "",
};
const practice: Scenario = { ...sindh, id: "synthetic-flood", title: "Synthetic river flood (SIMULATED)", mode: "synthetic", pre_window: undefined, post_window: undefined };

describe("check wizard state", () => {
  it("fills everything in from a past disaster", () => {
    const d = reducer(emptyDraft(), { type: "scenario", s: sindh });
    expect(d).toMatchObject({ source: "past", scenarioId: sindh.id, synthetic: false, hazard: "flood", event: "2022-08-26", bbox: sindh.bbox });
    expect(d.windows).toEqual({ pre: ["2022-06-01", "2022-07-05"], post: ["2022-08-26", "2022-09-10"] });
    expect(displayName(d)).toBe(sindh.title);
    for (const step of [0, 1, 2, 3]) expect(stepStatus(d, step).ok).toBe(true);
  });

  it("forgets the case study when the area is moved, but keeps type and dates", () => {
    const d = reducer(reducer(emptyDraft(), { type: "scenario", s: sindh }), { type: "area", bbox: [67.7, 26.6, 67.9, 26.8], place: null });
    expect(d.scenarioId).toBeNull();
    expect(d.hazard).toBe("flood");
    expect(d.event).toBe("2022-08-26");
    // a newly drawn box may be somewhere else entirely, so the old place name is not reused
    expect(d.place).toBeNull();
    expect(displayName(d)).toBe("Flood check - Aug 2022");
    // a found place names the area; adjusting without a new name keeps the current one
    const named = reducer(d, { type: "area", bbox: [67.7, 26.6, 67.9, 26.8], place: "Dadu, Sindh, Pakistan" });
    expect(displayName(named)).toBe("Flood check - Dadu, Sindh - Aug 2022");
    expect(reducer(named, { type: "area", bbox: [67.71, 26.6, 67.9, 26.8], place: undefined, keepSource: true }).place).toBe("Dadu, Sindh, Pakistan");
  });

  it("draws an 18 km box around a live alert and pre-selects the hazard", () => {
    const e = { id: "gdacs/TC/1", source: "GDACS", hazard: "tropical_cyclone", name: "Cyclone X", alert_level: "Red", country: "Mozambique",
      from: "2024-03-10T00:00:00", lon: 35, lat: -18 } as LiveEvent;
    const d = reducer(emptyDraft(), { type: "liveEvent", e });
    expect(d.bbox).toEqual([34.92, -18.08, 35.08, -17.92]);
    expect(d.hazard).toBe("flood"); // storms are mapped through their flooding
    expect(d.event).toBe("2024-03-10");
    expect(d.place).toBe("Cyclone X, Mozambique");
  });

  it("explains why a step can't be finished yet", () => {
    const d = emptyDraft();
    expect(stepStatus(d, 0)).toEqual({ ok: false, why: "Choose a place to continue." });
    expect(stepStatus(d, 1).why).toMatch(/kind of disaster/);
    const huge = reducer(d, { type: "area", bbox: [0, 0, 2, 2] });
    expect(stepStatus(huge, 0).why).toMatch(/Too big/);
    const named = reducer(d, { type: "name", name: "ab" });
    expect(stepStatus(named, 3).why).toMatch(/at least 3 letters/);
  });

  it("treats practice scenes as fixed and resets the dates when the event date changes", () => {
    const p = reducer(emptyDraft(), { type: "scenario", s: practice });
    expect(p.synthetic).toBe(true);
    expect(stepStatus(p, 0).ok && stepStatus(p, 2).ok).toBe(true);
    const custom = reducer(reducer(emptyDraft(), { type: "windows", windows: { pre: ["2024-01-01", "2024-01-31"], post: ["2024-02-01", "2024-02-10"] } }),
      { type: "date", event: "2024-02-01" });
    expect(custom.customDates).toBe(false);
    expect(custom.windows.pre[1]).toBe("2024-01-31");
  });
});
