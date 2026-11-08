// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loadBriefRun, type StoreState } from "./store";
import { useBrief } from "./useBrief";

vi.mock("./store", () => ({ loadBriefRun: vi.fn(), recordGeneration: vi.fn() }));

const store: StoreState = { source: "live", since: "2026-11-02", tools: ["codex"], sessions: 20, pairs: 0, candidates: [], windowCandidates: 0 };
const run = { id: 1, since: "2026-11-01", tools: "claude+pi", sessions: 8, started_at: "2026-11-02T12:00:00Z", finished_at: null, inference_cli: null, raw_output: "" };

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("uses the saved run's provenance instead of a later scan", async () => {
  vi.mocked(loadBriefRun).mockResolvedValue(run);
  const { result } = renderHook(() => useBrief(store));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.view).toMatchObject({ since: "2026-11-01", tools: "claude+pi", sessions: 8 });
});

it("omits unavailable provenance from older imports", async () => {
  vi.mocked(loadBriefRun).mockResolvedValue({ ...run, tools: "unknown", sessions: null });
  const { result } = renderHook(() => useBrief(store));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.view).toMatchObject({ since: null, tools: null, sessions: null });
});
