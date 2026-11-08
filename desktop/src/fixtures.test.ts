import { describe, expect, it } from "vitest";
import realSource from "../fixtures/engine-scan.json";
import corruptedSource from "../fixtures/engine-scan-corrupted.json";
import {
  EnvelopeError,
  SUPPORTED_ENGINE_MAJOR,
  TOOLS,
  toolLabel,
  validateScanResult,
  validateSourcesResult,
} from "./fixtures";

it("labels known tools and preserves unknown names", () => {
  expect(["claude", "codex", "pi", "custom", "constructor"].map(toolLabel)).toEqual(["Claude Code", "Codex", "Pi", "custom", "constructor"]);
});

describe("validateScanResult", () => {
  it("accepts the committed engine fixture", () => {
    const scan = validateScanResult(realSource);
    expect(scan.engineVersion).toBe("1.1.0");
    expect(scan.candidates).toHaveLength(15);
    expect(scan.sessions).toBe(8);
    expect(scan.tools).toEqual(["claude", "codex", "pi"]);
  });

  it("rejects the deliberately corrupted fixture", () => {
    expect(() => validateScanResult(corruptedSource)).toThrow(EnvelopeError);
  });

  it("refuses a newer engine major and accepts an older one", () => {
    const scan = validateScanResult(realSource);
    const newer = { ...scan, engineVersion: `${SUPPORTED_ENGINE_MAJOR + 1}.0.0` };
    expect(() => validateScanResult(newer)).toThrow(/newer than this app understands/);
    const additive = { ...scan, engineVersion: "1.9.9" };
    expect(() => validateScanResult(additive)).not.toThrow();
  });

  it("upholds the contract's invariants on the real fixture", () => {
    const scan = validateScanResult(realSource);
    const ids = new Set<string>();
    for (const c of scan.candidates) {
      expect(c.score).toBe(c.userScore + c.assistantBonus);
      expect(c.signals.reduce((sum, s) => sum + s.weight, 0)).toBe(c.score);
      ids.add(c.id);
    }
    expect(ids.size).toBe(scan.candidates.length);
  });

  it("rejects shape violations", () => {
    const scan = validateScanResult(realSource);
    const missingField = {
      ...scan,
      candidates: [{ ...scan.candidates[0], userMessage: undefined }],
    };
    expect(() => validateScanResult(missingField)).toThrow(EnvelopeError);
    const badSide = {
      ...scan,
      candidates: [
        { ...scan.candidates[1], signals: [{ name: "wh-question", weight: 3, side: "engine" }] },
      ],
    };
    expect(() => validateScanResult(badSide)).toThrow(EnvelopeError);
    const badType = { ...scan, sessions: "six" };
    expect(() => validateScanResult(badType)).toThrow(EnvelopeError);
    const noList = { ...scan, candidates: null };
    expect(() => validateScanResult(noList)).toThrow(EnvelopeError);
  });

  it("accepts every engine tool, Pi included, and rejects unknown ones", () => {
    const scan = validateScanResult(realSource);
    expect(new Set(scan.candidates.map((c) => c.tool))).toEqual(new Set(TOOLS));
    const unknown = { ...scan, candidates: [{ ...scan.candidates[0], tool: "gemini" }] };
    expect(() => validateScanResult(unknown)).toThrow(/candidate.tool must be one of claude, codex, pi/);
  });
});

describe("validateSourcesResult", () => {
  const sources = {
    engineVersion: "1.1.0",
    since: "2026-11-03",
    sources: [
      { tool: "claude", root: "/Users/r/.claude/projects", found: true, sessions: 412, recentSessions: 3 },
      { tool: "codex", root: "/Users/r/.codex/sessions", found: true, sessions: 57, recentSessions: 1 },
      { tool: "pi", root: "/Users/r/.pi/agent/sessions", found: false, sessions: 0, recentSessions: 0 },
    ],
  };

  it("accepts the recap --sources envelope", () => {
    const res = validateSourcesResult(sources);
    expect(res.sources.map((s) => s.tool)).toEqual(["claude", "codex", "pi"]);
    expect(res.sources[0].recentSessions).toBe(3);
  });

  it("enforces the version handshake and the shape", () => {
    expect(() => validateSourcesResult({ ...sources, engineVersion: "2.0.0" })).toThrow(/newer than this app/);
    const badFound = { ...sources, sources: [{ ...sources.sources[0], found: "yes" }] };
    expect(() => validateSourcesResult(badFound)).toThrow(EnvelopeError);
    const badCount = { ...sources, sources: [{ ...sources.sources[0], sessions: 1.5 }] };
    expect(() => validateSourcesResult(badCount)).toThrow(EnvelopeError);
  });
});
