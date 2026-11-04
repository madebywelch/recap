import type { Candidate, Signal } from "./fixtures";

/**
 * Pure filter and arithmetic helpers for the Signal Explorer. The store
 * loads candidates wholesale (a scan window is small); filtering happens
 * client-side so the Explorer, the tests, and the browser fallback all
 * share one implementation.
 */

export interface ExplorerFilters {
  minScore: number;
  tool: "all" | "claude" | "codex";
  /** Signal names, any-of semantics: empty list means no filter. */
  signals: string[];
  /** Window edges as YYYY-MM-DD, "" for open. Compared against the
   *  candidate's own local date (ts is RFC3339 with its offset). */
  dateFrom: string;
  dateTo: string;
  /** Case-insensitive substring over the redacted user and assistant text. */
  text: string;
}

/** The CLI's default candidate floor; the Explorer opens here. */
export const DEFAULT_MIN_SCORE = 2;

export function applyFilters(candidates: Candidate[], f: ExplorerFilters): Candidate[] {
  const q = f.text.trim().toLowerCase();
  return candidates.filter((c) => {
    if (c.score < f.minScore) return false;
    if (f.tool !== "all" && c.tool !== f.tool) return false;
    if (f.signals.length > 0 && !c.signals.some((s) => f.signals.includes(s.name))) {
      return false;
    }
    const day = c.ts.slice(0, 10);
    if (f.dateFrom && day < f.dateFrom) return false;
    if (f.dateTo && day > f.dateTo) return false;
    if (
      q &&
      !c.userMessage.toLowerCase().includes(q) &&
      !c.assistantExcerpt.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
}

/** Every signal name in the data, most frequent first, alphabetical on ties. */
export function allSignalNames(candidates: Candidate[]): string[] {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    for (const s of c.signals) {
      counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

export function scoreBounds(candidates: Candidate[]): { min: number; max: number } {
  if (candidates.length === 0) return { min: -3, max: 10 };
  let min = Infinity;
  let max = -Infinity;
  for (const c of candidates) {
    min = Math.min(min, c.score);
    max = Math.max(max, c.score);
  }
  return { min, max };
}

export function userSignals(c: Candidate): Signal[] {
  return c.signals.filter((s) => s.side === "user");
}

export function assistantSignals(c: Candidate): Signal[] {
  return c.signals.filter((s) => s.side === "assistant");
}

/** The assistant bonus before the cap: every assistant signal except
 *  assistant-cap. Adding the cap's (negative) weight lands the bonus. */
export function rawAssistantBonus(c: Candidate): number {
  return assistantSignals(c)
    .filter((s) => s.name !== "assistant-cap")
    .reduce((sum, s) => sum + s.weight, 0);
}

/**
 * The user score the assistant bonus was clamped to when the cap fired,
 * null when it didn't. The engine emits the assistant-cap signal (a
 * negative weight) only when the raw bonus would have exceeded the user
 * score; the contract lands the bonus at exactly the user score.
 */
export function cappedAt(c: Candidate): number | null {
  return c.signals.some((s) => s.name === "assistant-cap") ? c.userScore : null;
}
