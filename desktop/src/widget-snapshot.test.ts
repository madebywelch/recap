import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import scan from "../fixtures/engine-scan.json";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: async () => ({ execute: mocks.execute, select: mocks.select }) },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { applyReview, initStore, recordGeneration, seedReview, unseedReview } from "./store";

describe("widget snapshot", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    mocks.execute.mockReset().mockResolvedValue({ lastInsertId: 1 });
    mocks.select.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT title FROM concepts")) return [{ title: "Ownership" }];
      if (sql.includes("COUNT(*) AS n FROM review_state WHERE")) return [{ n: 2 }];
      if (sql.includes("SELECT interval_days")) return [{ interval_days: 1, ease: 2.5, reviews: 0, lapses: 0, last_grade: null, due_on: "2026-01-01", last_reviewed_at: null }];
      return [];
    });
    mocks.invoke.mockReset().mockImplementation(async (command: string) => {
      if (command === "run_scan") return JSON.stringify(scan);
      if (command === "read_archives") return [];
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("publishes after startup, generation, and review changes", async () => {
    expect((await initStore()).source).toBe("live");
    const snapshots = () => mocks.invoke.mock.calls.filter(([command]) => command === "write_widget_snapshot");
    await vi.waitFor(() => expect(snapshots()).toHaveLength(2));
    expect(snapshots()[0][1]).toEqual({ concepts: ["Ownership"], date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), dueCount: 2 });
    await recordGeneration({ startedAt: "", finishedAt: "", date: "2026-01-01", since: "", tools: "", sessions: 0, pairs: 0, status: "done", inferenceCli: "", archivePath: null, rawOutput: "" });
    await seedReview(1, "2026-01-01");
    await unseedReview(1);
    await applyReview(1, "got-it");
    await vi.waitFor(() => expect(snapshots()).toHaveLength(6));
  });

  it("preserves core operations when the widget container is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "write_widget_snapshot") throw new Error("container missing");
      if (command === "run_scan") return JSON.stringify(scan);
      if (command === "read_archives") return [];
    });
    expect((await initStore()).source).toBe("live");
    await expect(applyReview(1, "got-it")).resolves.toBeDefined();
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
  });

  it("initializes from persisted data even if the scan fails", async () => {
    mocks.select.mockImplementation(async (sql: string) => sql.includes("COUNT(*)") ? [{ n: 0 }] : []);
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "run_scan") throw new Error("scan failed");
    });
    expect((await initStore()).source).toBe("fixture");
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("write_widget_snapshot", { concepts: [], date: expect.any(String), dueCount: 0 }));
  });
});
