import { addDays, fmtArea, fmtCompact, fmtDate, fmtDuration, fmtInt, fmtNum, fmtPct, sentence } from "./format";

describe("formatting", () => {
  it("formats numbers defensively", () => {
    expect(fmtInt(12345.6)).toBe("12,346");
    expect(fmtInt(null)).toBe("-");
    expect(fmtNum(Number.NaN)).toBe("-");
    expect(fmtNum(0.84357, 3)).toBe("0.844");
    expect(fmtCompact(2500)).toBe("2,500");
    expect(fmtCompact(125000)).toBe("125K");
    expect(fmtPct(0.973)).toBe("97%");
    expect(fmtPct(undefined)).toBe("-");
  });
  it("formats areas with sensible units", () => {
    expect(fmtArea(0)).toBe("0 km²");
    expect(fmtArea(0.004)).toBe("0 ha");
    expect(fmtArea(4.583)).toBe("4.58 km²");
    expect(fmtArea(79.01)).toBe("79 km²");
  });
  it("handles dates in UTC", () => {
    expect(fmtDate("2022-08-26")).toBe("26 Aug 2022");
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(fmtDate(null)).toBe("-");
    expect(fmtDuration(75)).toBe("1 min 15 s");
    expect(sentence("needs_review")).toBe("Needs review");
  });
});
