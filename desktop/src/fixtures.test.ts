import { describe, expect, it } from "vitest";
import realSource from "../fixtures/engine-scan.json";
import corruptedSource from "../fixtures/engine-scan-corrupted.json";
import {
  EnvelopeError,
  SUPPORTED_ENGINE_MAJOR,
  validateScanResult,
} from "./fixtures";

describe("validateScanResult", () => {
  it("accepts the committed engine fixture", () => {
    const scan = validateScanResult(realSource);
    expect(scan.engineVersion).toBe("1.0.0");
    expect(scan.candidates).toHaveLength(12);
    expect(scan.sessions).toBe(6);
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
});
