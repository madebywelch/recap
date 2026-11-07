// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Candidate } from "../fixtures";
import type { Concept, StoreState } from "../store";
import ConceptLibrary from "./ConceptLibrary";

vi.mock("../store", () => ({
  loadConcepts: vi.fn(),
  loadCandidatesByIds: vi.fn(),
  seedReview: vi.fn(),
  unseedReview: vi.fn(),
}));
import { loadCandidatesByIds, loadConcepts, seedReview } from "../store";

const store: StoreState = {
  source: "live", since: "2026-11-01", candidates: [], sessions: 0, pairs: 0, tools: [], windowCandidates: 0,
};
const row: Concept = { id: 1, date: "2026-11-01", title: "A concept", body: "An explanation.", sourceIds: ["source"], review: null };
const source: Candidate = {
  id: "source", sessionId: "session", ts: "2026-11-01T12:00:00Z", tool: "claude", userMessage: "Source question", assistantExcerpt: "Source answer", score: 3, userScore: 3, assistantBonus: 0, signals: [],
};

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it("renders load retry, source retry and exchange disclosure", async () => {
  vi.mocked(loadConcepts).mockRejectedValueOnce(new Error()).mockResolvedValue([row]);
  vi.mocked(loadCandidatesByIds).mockRejectedValueOnce(new Error()).mockResolvedValue([source]);
  vi.mocked(seedReview).mockRejectedValue(new Error());
  render(<ConceptLibrary store={store} onNavigate={vi.fn()} />);

  const loadAlert = await screen.findByRole("alert");
  expect(loadAlert.textContent).toContain("Couldn't load the library.");
  fireEvent.click(within(loadAlert).getByRole("button", { name: "Try again" }));
  fireEvent.click(await screen.findByRole("button", { name: /A concept/ }));

  const sourceAlert = await screen.findByRole("alert");
  expect(sourceAlert.textContent).toContain("Couldn't load the exchanges");
  fireEvent.click(within(sourceAlert).getByRole("button", { name: "Try again" }));
  const disclosure = await screen.findByRole("button", { name: /Show the exchange/ });
  expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Source question")).toBeNull();
  fireEvent.click(disclosure);
  expect(screen.getByText("Source question")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Hide the exchange/ }).getAttribute("aria-expanded")).toBe("true");

  fireEvent.click(screen.getByRole("button", { name: "Add to review" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Couldn't add this concept to review.");
});
