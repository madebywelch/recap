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
  id: "source", sessionId: "session", ts: "2026-11-01T12:00:00Z", tool: "claude", cwd: "/work/recap", userMessage: "Source question", assistantExcerpt: "Source answer", score: 3, userScore: 3, assistantBonus: 0, signals: [{ name: "internal-signal", weight: 3, side: "user" }],
};

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it("renders load retry, source retry and exchange disclosure", async () => {
  vi.mocked(loadConcepts).mockRejectedValueOnce(new Error("private diagnostic")).mockResolvedValue([row]);
  vi.mocked(loadCandidatesByIds).mockRejectedValueOnce(new Error("private diagnostic")).mockResolvedValue([source]);
  vi.mocked(seedReview).mockRejectedValue(new Error("private diagnostic"));
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
  expect(screen.queryByText(/score|internal-signal|Signal Explorer|scan window/i)).toBeNull();
  expect(screen.getByText("Source question").closest(".concept-source-card")?.parentElement?.className).toBe("concept-reader-layout");
  expect(screen.getByRole("button", { name: /Hide the exchange/ }).getAttribute("aria-expanded")).toBe("true");

  fireEvent.click(screen.getByRole("button", { name: "Add to review" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Couldn't add this concept to review.");
  expect(screen.queryByText(/private diagnostic/)).toBeNull();
});

it("shows the first sentence and known source metadata on the shelf, then the full body in the reader", async () => {
  const body = "The first sentence is complete. The second sentence belongs in the reader.\nThe final detail remains visible.";
  vi.mocked(loadConcepts).mockResolvedValue([{ ...row, body }]);
  vi.mocked(loadCandidatesByIds).mockResolvedValue([source]);
  render(<ConceptLibrary store={{ ...store, candidates: [source] }} onNavigate={vi.fn()} />);

  const card = await screen.findByRole("button", { name: /A concept/ });
  expect(card.textContent).toContain("The first sentence is complete.");
  expect(card.textContent).not.toContain("The second sentence");
  expect(card.textContent).not.toContain("Conversation source");
  expect(card.textContent).toContain("Claude Code");
  expect(card.textContent).toContain("recap");
  fireEvent.click(card);
  expect(screen.getByText(/The second sentence belongs in the reader/).textContent).toContain("The final detail remains visible.");
});

it("omits source metadata when the referenced candidate is unavailable", async () => {
  vi.mocked(loadConcepts).mockResolvedValue([row]);
  render(<ConceptLibrary store={store} onNavigate={vi.fn()} />);
  const card = await screen.findByRole("button", { name: /A concept/ });
  expect(card.textContent).not.toContain("Conversation source");
  expect(card.textContent).not.toContain("Claude Code");
});

it("shows matched fixture source metadata without exposing the full explainer", () => {
  render(<ConceptLibrary store={{ ...store, source: "fixture", candidates: [{ ...source, id: "20a4768e4f88e03b" }] }} onNavigate={vi.fn()} />);
  const card = screen.getByText("SQLite locking modes and WAL").closest(".shelf-row")!;
  expect(card.textContent).not.toContain("Conversation source");
  expect(card.textContent).toContain("Claude Code");
  expect(card.textContent).toContain("recap");
  expect(card.textContent).not.toContain("rollback-journal");
});
