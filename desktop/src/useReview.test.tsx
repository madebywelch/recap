// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "./fixtures";
import { seedState } from "./review";
import type { Concept, StoreState } from "./store";
import { useReview } from "./useReview";
import Review from "./screens/Review";
import { applyReview, loadCandidatesByIds, loadDueConcepts, loadDueOverview } from "./store";

vi.mock("./store", () => ({
  applyReview: vi.fn(),
  loadCandidatesByIds: vi.fn(),
  loadDueConcepts: vi.fn(),
  loadDueOverview: vi.fn(),
}));

const store: StoreState = { source: "live", since: "2026-01-01", candidates: [], sessions: 0, pairs: 0, tools: [], windowCandidates: 0 };
const concepts: Concept[] = [
  { id: 1, date: "2026-01-01", title: "First", body: "First answer", sourceIds: ["first"], review: null },
  { id: 2, date: "2026-01-01", title: "Second", body: "Second answer", sourceIds: ["second"], review: null },
];
const overview = { due: 2, inReview: 2, next: null, learnedThisWeek: 0 };
const firstSource = { id: "first" } as Candidate;
const secondSource = { id: "second" } as Candidate;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadDueConcepts).mockResolvedValue(concepts);
  vi.mocked(loadDueOverview).mockResolvedValue(overview);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useReview", () => {
  it("renders load and grade errors with working retry controls", async () => {
    vi.mocked(loadDueConcepts).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(applyReview).mockRejectedValueOnce(new Error("write failed")).mockResolvedValueOnce(seedState("2026-12-01"));
    render(<Review store={store} onNavigate={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't load your review list");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(await screen.findByRole("button", { name: /Show answer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Got it/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't save your grade");
    fireEvent.click(screen.getByRole("button", { name: /Got it/ }));
    expect((await screen.findByRole("status")).textContent).toMatch(/^Kept/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders source disclosure and reuses the loaded exchange after collapse", async () => {
    vi.mocked(loadCandidatesByIds).mockResolvedValue([]);
    render(<Review store={store} onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Show answer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Show the exchange/ }));
    expect(await screen.findByText("No exchange was found in the archive.")).toBeTruthy();
    const hide = screen.getByRole("button", { name: /Hide the exchange/ });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(hide);
    expect(screen.queryByText("No exchange was found in the archive.")).toBeNull();
    const show = screen.getByRole("button", { name: /Show the exchange/ });
    expect(show.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(show);
    expect(screen.getByText("No exchange was found in the archive.")).toBeTruthy();
    expect(loadCandidatesByIds).toHaveBeenCalledOnce();
  });

  it("reports an initial load failure and retries the complete load", async () => {
    vi.mocked(loadDueConcepts).mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useReview(store));

    await waitFor(() => expect(result.current.loadError).toBe(true));
    expect(result.current.queue).toBeNull();
    await act(async () => result.current.refresh());

    expect(result.current.loadError).toBe(false);
    expect(result.current.queue).toEqual(concepts);
    expect(result.current.overview).toEqual(overview);
    expect(loadDueConcepts).toHaveBeenCalledTimes(2);
    expect(loadDueOverview).toHaveBeenCalledTimes(2);
  });

  it("keeps the current concept on grade failure and advances after retry", async () => {
    vi.mocked(applyReview).mockRejectedValueOnce(new Error("write failed")).mockResolvedValueOnce(seedState("2026-12-01"));
    const { result } = renderHook(() => useReview(store));
    await waitFor(() => expect(result.current.current?.id).toBe(1));
    act(() => result.current.reveal());
    await act(async () => result.current.grade("got-it"));

    expect(result.current.gradeError).toBe(true);
    expect(result.current.current?.id).toBe(1);
    expect(result.current.revealed).toBe(true);
    expect(result.current.tally.kept).toBe(0);

    vi.useFakeTimers();
    await act(async () => result.current.grade("got-it"));
    expect(result.current.gradeError).toBe(false);
    expect(result.current.reschedule).toMatch(/^Kept/);
    expect(result.current.tally.kept).toBe(1);
    expect(applyReview).toHaveBeenCalledTimes(2);
    expect(applyReview).toHaveBeenLastCalledWith(1, "got-it");
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.current?.id).toBe(2);
    expect(result.current.revealed).toBe(false);
  });

  it("expands, collapses, and reopens cached sources", async () => {
    vi.mocked(loadCandidatesByIds).mockResolvedValue([firstSource]);
    const { result } = renderHook(() => useReview(store));
    await waitFor(() => expect(result.current.current?.id).toBe(1));
    act(() => result.current.expand());
    await waitFor(() => expect(result.current.sources).toEqual([firstSource]));
    expect(result.current.expanded).toBe(true);
    act(() => result.current.expand());
    expect(result.current.expanded).toBe(false);
    act(() => result.current.expand());
    expect(result.current.expanded).toBe(true);
    expect(loadCandidatesByIds).toHaveBeenCalledOnce();
    expect(loadCandidatesByIds).toHaveBeenCalledWith(["first"]);
  });

  it("reports a source failure and retries the exchange", async () => {
    vi.mocked(loadCandidatesByIds).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    render(<Review store={store} onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Show answer/ }));
    fireEvent.click(screen.getByRole("button", { name: /Show the exchange/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't load the exchange");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No exchange was found in the archive.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(loadCandidatesByIds).toHaveBeenCalledTimes(2);
  });

  it("ignores a source response from the previous concept", async () => {
    let resolveFirst!: (sources: Candidate[]) => void;
    vi.mocked(loadCandidatesByIds)
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce([secondSource]);
    vi.mocked(applyReview).mockResolvedValue(seedState("2026-12-01"));
    const { result } = renderHook(() => useReview(store));
    await waitFor(() => expect(result.current.current?.id).toBe(1));
    act(() => result.current.expand());
    expect(result.current.sourceLoading).toBe(true);
    vi.useFakeTimers();
    await act(async () => result.current.grade("fuzzy"));
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.current?.id).toBe(2);
    expect(result.current.expanded).toBe(false);
    act(() => result.current.expand());
    await act(async () => {});
    expect(result.current.sources).toEqual([secondSource]);
    await act(async () => resolveFirst([firstSource]));
    expect(result.current.sources).toEqual([secondSource]);
    expect(result.current.sourceLoading).toBe(false);
    expect(loadCandidatesByIds).toHaveBeenLastCalledWith(["second"]);
  });
});
