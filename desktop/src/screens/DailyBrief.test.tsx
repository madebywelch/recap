// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useBrief } from "../useBrief";
import type { StoreState } from "../store";
import DailyBrief from "./DailyBrief";

vi.mock("../useBrief", () => ({ useBrief: vi.fn() }));

const store: StoreState = { source: "live", since: "2026-11-01", candidates: [], sessions: 1, pairs: 2, tools: ["claude"], windowCandidates: 3 };
const source = { id: "one", sessionId: "s", ts: "2026-11-01T12:00:00Z", tool: "claude" as const, cwd: "/work", userMessage: "Why this?", assistantExcerpt: "An answer", score: 9, userScore: 3, assistantBonus: 6, signals: [{ name: "confusion", side: "user" as const, weight: 3 }] };
const base = {
  status: "ready" as const,
  view: { date: "2026-11-01", since: "2026-11-01", tools: "claude", sessions: 1, pairs: 2, candidateCount: 3, inferenceCli: "claude", generatedAt: null, candidatesById: new Map([[source.id, source]]), entries: [{ title: "An idea", lede: "Something useful.", rest: "More detail.", rule: "", sources: ["one"], body: "Something useful. More detail." }] },
  error: null, loadError: false, phase: null, elapsed: 0, detection: null,
  generate: vi.fn(), cancel: vi.fn(), dismissError: vi.fn(),
};

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("shows session facts and preserves exchange disclosure without diagnostics", () => {
  vi.mocked(useBrief).mockReturnValue(base);
  const navigate = vi.fn();
  const { container } = render(<DailyBrief store={{ ...store, since: "2026-11-02", tools: ["claude", "codex"] }} onNavigate={navigate} />);
  expect(screen.getByText("From your sessions")).toBeTruthy();
  expect(screen.getByText("From 1 session with Claude Code since Nov 1, 2026.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Read the explainer/ }));
  fireEvent.click(screen.getByRole("button", { name: /Show the exchange/ }));
  expect(screen.getByText("An answer")).toBeTruthy();
  expect(container.textContent).not.toMatch(/candidate|score|signal explorer|confusion/i);
  fireEvent.click(screen.getByRole("button", { name: /Hide the exchange/ }));
  expect(screen.queryByText("An answer")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /I'm done/ }));
  expect(screen.getByText("That's today's brief.")).toBeTruthy();
});

it("omits unavailable provenance instead of using the current scan", () => {
  vi.mocked(useBrief).mockReturnValue({ ...base, view: { ...base.view, since: null, tools: null, sessions: null } });
  render(<DailyBrief store={store} onNavigate={vi.fn()} />);
  expect(screen.getByText("Session details aren't available.")).toBeTruthy();
});

it("hides raw diagnostics in errors while keeping retry and back", () => {
  const retry = vi.fn();
  const back = vi.fn();
  vi.mocked(useBrief).mockReturnValue({ ...base, status: "error", error: { kind: "no-cli", title: "Signal Explorer", detail: "secret raw output" }, generate: retry, dismissError: back });
  const { container } = render(<DailyBrief store={store} onNavigate={vi.fn()} />);
  expect(container.textContent).not.toMatch(/Signal Explorer|secret raw output/);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(back).toHaveBeenCalledOnce();
});
