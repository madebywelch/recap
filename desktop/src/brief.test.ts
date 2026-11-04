import { describe, expect, it } from "vitest";
import briefSource from "../fixtures/daily-brief.md?raw";
import { candidates } from "./fixtures";
import { count, leadOf, localDate, parseArchiveMeta, parseEntries, readMinutes } from "./brief";

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
      {
        title: "Plain entry",
        lede: "One sentence.",
        rest: "Two sentences.",
        rule: "",
        sources: [],
        body: "One sentence. Two sentences.",
      },
    ]);
  });

  it("keeps the archive's full explainer paragraph as the body", () => {
    const withRule = entries.find((e) => e.rule);
    expect(withRule?.body).toContain("Rule of thumb:");
    expect(withRule?.body.startsWith(withRule?.lede ?? "")).toBe(true);
  });

  it("estimates a bounded reading time", () => {
    expect(readMinutes(entries)).toBeGreaterThanOrEqual(1);
  });
  it("parses the raw markdown a generation run prints, with no archive header", () => {
    const raw = [
      "**SQLite locking modes and WAL.** One sentence lede here. The body follows.",
      "",
      "**EADDRINUSE.** Another entry. Rule of thumb: kill the holder.",
      "",
      "sources: nope",  // dropped: not part of a matching entry
    ].join("\n");
    const entries = parseEntries(raw);
    expect(entries.map((e) => e.title)).toEqual([
      "SQLite locking modes and WAL",
      "EADDRINUSE",
    ]);
    expect(entries[1].rule).toBe("Kill the holder.");
  });

  it("yields zero entries for output that parses to nothing", () => {
    expect(parseEntries("The model ignored every format instruction here.")).toEqual([]);
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

describe("parseArchiveMeta", () => {
  const raw = [
    "# Recap 2026-10-12 07:04",
    "",
    "_window: since 2026-10-11 | tools: claude+codex | sessions: 5 | pairs: 9 | candidates: 11 | inference: claude_",
    "",
    "**A concept.** Body.",
  ].join("\n");

  it("reads the header the engine writes", () => {
    expect(parseArchiveMeta(raw)).toEqual({
      generatedAt: "2026-10-12 07:04",
      since: "2026-10-11",
      tools: "claude+codex",
      sessions: 5,
      pairs: 9,
      candidates: 11,
      inference: "claude",
    });
  });

  it("parses the same file into entries and meta together", () => {
    expect(parseEntries(raw).map((e) => e.title)).toEqual(["A concept"]);
    expect(parseArchiveMeta(raw)?.since).toBe("2026-10-11");
  });

  it("returns null for a file with no archive header", () => {
    expect(parseArchiveMeta("**Just a brief.** No header.")).toBeNull();
  });
});

describe("localDate", () => {
  it("formats the way the engine dates archive files", () => {
    expect(localDate(new Date(2026, 10, 4, 23, 30))).toBe("2026-11-04");
  });
});
