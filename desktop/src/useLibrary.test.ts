// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "./fixtures";
import type { Concept, StoreState } from "./store";
import { useLibrary } from "./useLibrary";

vi.mock("./store", () => ({
  loadConcepts: vi.fn(),
  loadCandidatesByIds: vi.fn(),
  seedReview: vi.fn(),
  unseedReview: vi.fn(),
}));

import { loadCandidatesByIds, loadConcepts, seedReview, unseedReview } from "./store";

const live: StoreState = {
  source: "live", since: "2026-11-01", candidates: [], sessions: 0, pairs: 0, tools: [], windowCandidates: 0,
};
const concept = (id: number, sourceIds: string[] | null = null): Concept => ({
  id, date: "2026-11-01", title: `Concept ${id}`, body: "Body", sourceIds, review: null,
});

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe("useLibrary", () => {
  it("reports a load failure and retries successfully", async () => {
    const row = concept(1);
    vi.mocked(loadConcepts).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([row]);
    const { result } = renderHook(() => useLibrary(live));

    await waitFor(() => expect(result.current.loadError).toBe("Couldn't load the library."));
    expect(result.current.loading).toBe(false);
    act(() => result.current.retry());
    expect(result.current.loading).toBe(true);
    expect(result.current.loadError).toBeNull();
    await waitFor(() => expect(result.current.concepts).toEqual([row]));
    expect(result.current.loading).toBe(false);
    expect(loadConcepts).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["add", seedReview, "Couldn't add this concept to review. Please try again."],
    ["remove", unseedReview, "Couldn't remove this concept from review. Please try again."],
  ] as const)("reports %s failure without refreshing the library", async (action, mutation, message) => {
    const row = concept(1);
    vi.mocked(loadConcepts).mockResolvedValue([row]);
    vi.mocked(mutation).mockRejectedValue(new Error("write failed"));
    const { result } = renderHook(() => useLibrary(live));
    await waitFor(() => expect(result.current.concepts).toEqual([row]));

    await act(async () => {
      await (action === "add" ? result.current.addReview(row) : result.current.removeReview(row));
    });
    expect(result.current.reviewError).toBe(message);
    expect(result.current.reviewPending).toBe(false);
    expect(result.current.concepts).toEqual([row]);
    expect(loadConcepts).toHaveBeenCalledTimes(1);
  });

  it("reports source failures and clears them when another concept opens", async () => {
    const first = concept(1, ["missing"]);
    const second = concept(2, ["found"]);
    const sources = [{ id: "found" }] as Candidate[];
    vi.mocked(loadConcepts).mockResolvedValue([first, second]);
    vi.mocked(loadCandidatesByIds).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(sources);
    const { result } = renderHook(() => useLibrary(live));
    await waitFor(() => expect(result.current.concepts).toEqual([first, second]));

    act(() => result.current.open(first));
    await waitFor(() => expect(result.current.sourceError).toBe("Couldn't load the exchanges for this concept."));
    act(() => result.current.open(second));
    expect(result.current.sourceError).toBeNull();
    await waitFor(() => expect(result.current.sources).toEqual(sources));
    expect(loadCandidatesByIds).toHaveBeenCalledWith(["missing"]);
    expect(loadCandidatesByIds).toHaveBeenCalledWith(["found"]);
  });

  it("ignores a delayed source response after switching concepts", async () => {
    const first = concept(1, ["first"]);
    const second = concept(2, ["second"]);
    const secondSources = [{ id: "second" }] as Candidate[];
    let resolveFirst!: (rows: Candidate[]) => void;
    vi.mocked(loadConcepts).mockResolvedValue([first, second]);
    vi.mocked(loadCandidatesByIds)
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(secondSources);
    const { result } = renderHook(() => useLibrary(live));
    await waitFor(() => expect(result.current.concepts).toEqual([first, second]));

    act(() => result.current.open(first));
    act(() => result.current.open(second));
    await waitFor(() => expect(result.current.sources).toEqual(secondSources));
    await act(async () => resolveFirst([{ id: "first" }] as Candidate[]));
    expect(result.current.selected).toEqual(second);
    expect(result.current.sources).toEqual(secondSources);
  });
});
