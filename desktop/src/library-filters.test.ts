import { describe, expect, it } from "vitest";
import { dueText, firstSentence, groupByDate } from "./library-filters";
import type { Concept } from "./store";

function concept(id: number, date: string, overrides: Partial<Concept> = {}): Concept {
  return { id, date, title: `Concept ${id}`, body: "Body.", sourceIds: null, review: null, ...overrides };
}

describe("groupByDate", () => {
  it("collapses consecutive same-day concepts into one group", () => {
    const groups = groupByDate([
      concept(1, "2026-11-04"),
      concept(2, "2026-11-04"),
      concept(3, "2026-11-02"),
    ]);
    expect(groups.map((g) => [g.date, g.concepts.length])).toEqual([
      ["2026-11-04", 2],
      ["2026-11-02", 1],
    ]);
  });

  it("keeps two groups when a day recurs non-consecutively", () => {
    const groups = groupByDate([concept(1, "2026-11-04"), concept(2, "2026-11-03"), concept(3, "2026-11-04")]);
    expect(groups).toHaveLength(3);
  });

  it("returns nothing for an empty library", () => {
    expect(groupByDate([])).toEqual([]);
  });
});

describe("firstSentence", () => {
  it("takes the first sentence of a body", () => {
    expect(firstSentence("One sentence. Two sentences.")).toBe("One sentence.");
  });

  it("falls back to the whole body when no terminator exists", () => {
    expect(firstSentence("no terminator here")).toBe("no terminator here");
  });
});

describe("dueText", () => {
  it("reads a future due day as a count", () => {
    expect(dueText("2026-11-08", "2026-11-05")).toBe("due in 3 days");
  });

  it("collapses one day out to tomorrow", () => {
    expect(dueText("2026-11-06", "2026-11-05")).toBe("due tomorrow");
  });

  it("a due day at or before today reads as today", () => {
    expect(dueText("2026-11-05", "2026-11-05")).toBe("due today");
    expect(dueText("2026-11-04", "2026-11-05")).toBe("due today");
  });
});
