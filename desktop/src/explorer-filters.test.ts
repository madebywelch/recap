import { describe, expect, it } from "vitest";
import scanSource from "../fixtures/engine-scan.json";
import { validateScanResult, type Candidate } from "./fixtures";
import {
  DEFAULT_MIN_SCORE,
  allSignalNames,
  applyFilters,
  assistantSignals,
  cappedAt,
  rawAssistantBonus,
  scoreBounds,
  userSignals,
  type ExplorerFilters,
} from "./explorer-filters";

const scan = validateScanResult(scanSource);

const base: ExplorerFilters = {
  minScore: -100,
  tool: "all",
  signals: [],
  dateFrom: "",
  dateTo: "",
  text: "",
};

/** A candidate whose raw assistant bonus (+4) exceeded its user score (1),
 *  so the engine emitted assistant-cap and landed the bonus at 1. */
const capped: Candidate = {
  id: "cap-demo",
  tool: "claude",
  sessionId: "demo",
  ts: "2026-11-02T09:30:00-05:00",
  userMessage: "is that the same in production?",
  assistantExcerpt: "In production the policy evaluator…",
  score: 2,
  userScore: 1,
  assistantBonus: 1,
  signals: [
    { name: "question", weight: 1, side: "user" },
    { name: "assistant-depth", weight: 2, side: "assistant" },
    { name: "assistant-code", weight: 1, side: "assistant" },
    { name: "assistant-explains", weight: 1, side: "assistant" },
    { name: "assistant-cap", weight: -3, side: "assistant" },
  ],
};

describe("applyFilters", () => {
  it("passes everything with the base filter set", () => {
    expect(applyFilters(scan.candidates, base)).toHaveLength(scan.candidates.length);
  });

  it("keeps only candidates at or above the minimum score", () => {
    const top = applyFilters(scan.candidates, { ...base, minScore: 8 });
    expect(top.map((c) => c.score)).toEqual([10, 9, 9, 8]);
    expect(applyFilters(scan.candidates, { ...base, minScore: DEFAULT_MIN_SCORE })).toHaveLength(
      scan.candidates.length,
    );
  });

  it("filters by tool", () => {
    const claude = applyFilters(scan.candidates, { ...base, tool: "claude" });
    expect(claude.every((c) => c.tool === "claude")).toBe(true);
    expect(claude.length).toBeLessThan(scan.candidates.length);
  });

  it("filters by any-of signal names", () => {
    const confused = applyFilters(scan.candidates, { ...base, signals: ["confusion"] });
    expect(confused.every((c) => c.signals.some((s) => s.name === "confusion"))).toBe(true);
    expect(confused.length).toBeGreaterThan(0);
    expect(confused.length).toBeLessThan(scan.candidates.length);
  });

  it("filters by date range and text", () => {
    expect(applyFilters(scan.candidates, { ...base, dateFrom: "2026-11-03" })).toHaveLength(0);
    expect(applyFilters(scan.candidates, { ...base, dateTo: "2026-11-01" })).toHaveLength(0);
    const sqlite = applyFilters(scan.candidates, { ...base, text: "sqlite" });
    expect(sqlite).toHaveLength(1);
    expect(sqlite[0].id).toBe(scan.candidates[0].id);
  });

  it("combines filters conjunctively", () => {
    const both = applyFilters(scan.candidates, {
      ...base,
      minScore: 9,
      tool: "claude",
      text: "time_wait",
    });
    expect(both).toHaveLength(1);
    expect(both[0].userMessage).toMatch(/TIME_WAIT/);
  });
});

describe("arithmetic helpers", () => {
  it("splits signals by side", () => {
    const c = scan.candidates[0];
    expect(userSignals(c).map((s) => s.name)).toEqual(["wh-question", "confusion"]);
    expect(assistantSignals(c).map((s) => s.name)).toEqual([
      "assistant-depth",
      "assistant-code",
      "assistant-explains",
    ]);
  });

  it("reports the cap only when assistant-cap fired", () => {
    expect(cappedAt(capped)).toBe(1);
    expect(scan.candidates.some((c) => cappedAt(c) !== null)).toBe(false);
  });

  it("reports the raw bonus the cap clamped", () => {
    expect(rawAssistantBonus(capped)).toBe(4);
    const cap = capped.signals.find((s) => s.name === "assistant-cap")!;
    expect(rawAssistantBonus(capped) + cap.weight).toBe(capped.assistantBonus);
    for (const c of scan.candidates) expect(rawAssistantBonus(c)).toBe(c.assistantBonus);
  });

  it("keeps the capped candidate's arithmetic consistent", () => {
    expect(capped.score).toBe(capped.userScore + capped.assistantBonus);
    expect(capped.signals.reduce((sum, s) => sum + s.weight, 0)).toBe(capped.score);
  });

  it("lists signal names most frequent first and bounds scores to the data", () => {
    const names = allSignalNames([capped, scan.candidates[0]]);
    expect(names[0]).toBe("assistant-code");
    expect(names).toContain("assistant-cap");
    expect(scoreBounds(scan.candidates)).toEqual({ min: 2, max: 10 });
    expect(scoreBounds([])).toEqual({ min: -3, max: 10 });
  });
});
