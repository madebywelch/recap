import { describe, expect, it } from "vitest";
import { applyGrade, dueInWords, nextEase, nextInterval, seedState } from "./review";

const TODAY = new Date(2026, 10, 4, 9, 0); // 2026-11-04 09:00 local

function daysFrom(state: { dueOn: string }): number {
  return Math.round((Date.parse(state.dueOn) - Date.parse("2026-11-04")) / 86_400_000);
}

describe("nextEase", () => {
  it("rewards a kept concept and decays on fuzzy and lost", () => {
    expect(nextEase(2.5, "got-it")).toBeCloseTo(2.6);
    expect(nextEase(2.5, "fuzzy")).toBeCloseTo(2.36);
    expect(nextEase(2.5, "lost-it")).toBeCloseTo(1.96);
  });

  it("never drops below the 1.3 floor", () => {
    let ease = 2.5;
    ease = nextEase(ease, "lost-it"); // 1.96
    ease = nextEase(ease, "lost-it"); // 1.42
    ease = nextEase(ease, "lost-it"); // would be 0.88
    expect(ease).toBe(1.3);
  });
});

describe("applyGrade — a kept run", () => {
  it("walks first 1 day, second 6 days, then previous × ease, capped at 90", () => {
    let s = seedState("2026-11-05");
    s = applyGrade(s, "got-it", TODAY);
    expect(daysFrom(s)).toBe(1);
    expect(s.intervalDays).toBe(1);
    expect(s.ease).toBeCloseTo(2.6);
    expect(s.reviews).toBe(1);
    expect(s.lapses).toBe(0);

    s = applyGrade(s, "got-it", TODAY);
    expect(daysFrom(s)).toBe(6);
    expect(s.intervalDays).toBe(6);
    expect(s.ease).toBeCloseTo(2.7);

    s = applyGrade(s, "got-it", TODAY);
    expect(s.intervalDays).toBeCloseTo(6 * 2.8);
    expect(daysFrom(s)).toBe(17); // round(16.8)

    s = applyGrade(s, "got-it", TODAY);
    expect(s.intervalDays).toBeCloseTo(16.8 * 2.9); // 48.72
    expect(daysFrom(s)).toBe(49);

    s = applyGrade(s, "got-it", TODAY);
    expect(s.intervalDays).toBe(90); // 48.72 × 3 = 146.16, capped
    expect(daysFrom(s)).toBe(90);
    expect(s.reviews).toBe(5);
  });
});

describe("applyGrade — fuzzy grows slower", () => {
  it("uses the same progression with a decaying ease", () => {
    let s = seedState("2026-11-05");
    s = applyGrade(s, "fuzzy", TODAY);
    expect(s.intervalDays).toBe(1);
    expect(s.ease).toBeCloseTo(2.36);
    s = applyGrade(s, "fuzzy", TODAY);
    expect(s.intervalDays).toBe(6);
    s = applyGrade(s, "fuzzy", TODAY);
    expect(s.ease).toBeCloseTo(2.08);
    expect(s.intervalDays).toBeCloseTo(6 * 2.08); // the ease updated at this grade
  });
});

describe("applyGrade — a lapse", () => {
  it("resets to one day and counts the lapse", () => {
    let s = seedState("2026-11-05");
    s = applyGrade(s, "got-it", TODAY);
    s = applyGrade(s, "got-it", TODAY); // 6 days out
    s = applyGrade(s, "lost-it", TODAY);
    expect(daysFrom(s)).toBe(1);
    expect(s.intervalDays).toBe(1);
    expect(s.lapses).toBe(1);
    expect(s.ease).toBeCloseTo(2.7 - 0.54);
    expect(s.lastGrade).toBe("lost-it");
  });

  it("treats the success after a lapse as a first success", () => {
    let s = seedState("2026-11-05");
    s = applyGrade(s, "got-it", TODAY);
    s = applyGrade(s, "got-it", TODAY); // second — 6 days
    s = applyGrade(s, "lost-it", TODAY); // reset
    s = applyGrade(s, "got-it", TODAY);
    expect(s.intervalDays).toBe(1);
    expect(daysFrom(s)).toBe(1);
    s = applyGrade(s, "got-it", TODAY);
    expect(s.intervalDays).toBe(6); // second success again
  });
});

describe("nextInterval", () => {
  it("uses the updated ease for the third success", () => {
    const state = { intervalDays: 6, ease: 2.7, reviews: 2, lapses: 0, lastGrade: "got-it" as const };
    expect(nextInterval(state, "got-it", 2.8)).toBeCloseTo(16.8);
  });
});

describe("dueInWords", () => {
  it("phrases the reschedule confirmation", () => {
    expect(dueInWords("2026-11-05", "2026-11-04")).toBe("tomorrow");
    expect(dueInWords("2026-11-12", "2026-11-04")).toBe("in 8 days");
    expect(dueInWords("2026-11-04", "2026-11-04")).toBe("today");
  });
});
