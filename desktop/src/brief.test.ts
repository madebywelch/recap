import { describe, expect, it } from "vitest";
import briefSource from "../fixtures/daily-brief.md?raw";
import { candidates } from "./fixtures";
import { count, leadOf, parseEntries, readMinutes } from "./brief";

describe("parseEntries", () => {
  const entries = parseEntries(briefSource);

  it("reads every entry of the committed brief", () => {
    expect(entries.map((e) => e.title)).toEqual([
      "SQLite locking modes and WAL",
      "EADDRINUSE, TIME_WAIT, and `SO_REUSEADDR`",
      "Shell quoting and expansion order",
      "APNs and PDP contexts",
      "Container CA bundles",
      "React StrictMode's double mount",
    ]);
  });

  it("splits lede, body, and rule of thumb", () => {
    const [sqlite] = entries;
    expect(sqlite.lede).toBe(
      "`database is locked` with a single process almost always means there are more connections than you think, not that SQLite is broken.",
    );
    expect(sqlite.rest.startsWith("In the default rollback-journal mode")).toBe(true);
    expect(sqlite.rest).not.toContain("Rule of thumb");
    expect(sqlite.rule.startsWith('"Database is locked"')).toBe(true);
  });

  it("links sources to real candidates", () => {
    const ids = new Set(candidates.map((c) => c.id));
    for (const e of entries) {
      expect(e.sources.length).toBeGreaterThan(0);
      for (const id of e.sources) expect(ids.has(id)).toBe(true);
    }
  });

  it("tolerates an entry without a sources line", () => {
    const raw = "# Recap 2026-11-03 07:04\n\n_window: x_\n\n**Plain entry.** One sentence. Two sentences.";
    expect(parseEntries(raw)).toEqual([
      { title: "Plain entry", lede: "One sentence.", rest: "Two sentences.", rule: "", sources: [] },
    ]);
  });

  it("estimates a bounded reading time", () => {
    expect(readMinutes(entries)).toBeGreaterThanOrEqual(1);
  });
});

describe("count", () => {
  it("spells out small numbers and pluralizes", () => {
    expect(count(6, "idea", true)).toBe("Six ideas");
    expect(count(1, "minute")).toBe("one minute");
    expect(count(12, "candidate")).toBe("12 candidates");
  });
});

describe("leadOf", () => {
  it("leads with a pasted error line", () => {
    const c = candidates.find((x) => x.id === "0c9c9f5fa5eb5727")!;
    expect(leadOf(c)).toEqual({
      kind: "error",
      text: "Error: failed to bind to port 1420: EADDRINUSE address already in use",
    });
  });

  it("otherwise leads with the first question", () => {
    const c = candidates.find((x) => x.id === "af22bca7674a177b")!;
    expect(leadOf(c)).toEqual({ kind: "question", text: "why does it need the APN at all?" });
  });
});
