// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import type { Settings } from "./generation";

vi.mock("./store", () => ({
  initStore: async () => ({ source: "fixture" }),
  loadDueOverview: async () => ({ due: 0 }),
  onDueChanged: () => () => {},
}));
vi.mock("./generation", () => ({
  getSettings: async () => ({ ...persisted }),
  setSettings: async (settings: Settings) => { persisted = { ...settings }; },
  detectInference: async () => ({ cli: null, considered: [], clis: [], path_dirs: [], login_shell: false }),
  detectSources: async () => null,
}));
vi.mock("./screens/DailyBrief", () => ({ default: ({ onNavigate }: { onNavigate: (to: string) => void }) => <button onClick={() => onNavigate("signals")}>Open details</button> }));
vi.mock("./screens/SignalExplorer", () => ({ default: () => <div>Diagnostics content</div> }));
vi.mock("./screens/ConceptLibrary", () => ({ default: () => null }));
vi.mock("./screens/Review", () => ({ default: () => null }));
vi.mock("./screens/Harnesses", () => ({ default: () => null }));

let persisted: Settings = { inference_cli: "codex", custom_cli_path: "", timeout_sec: 300, onboarded: true, show_engine_details: false };
afterEach(cleanup);

it("gates navigation and persists the setting across launches", async () => {
  persisted = { inference_cli: "codex", custom_cli_path: "", timeout_sec: 300, onboarded: true, show_engine_details: false };
  const app = render(<App />);
  await waitFor(() => expect(screen.getAllByText("Example data").length).toBeGreaterThan(0));
  expect(screen.queryByRole("button", { name: /Signal Explorer/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open details" }));
  expect(screen.queryByText("Diagnostics content")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
  expect(await screen.findByRole("heading", { name: "Advanced" })).toBeTruthy();
  expect(screen.getByText(/Choose or install a tool to write briefs/)).toBeTruthy();
  expect(screen.queryByText(/scanning and the Signal Explorer/)).toBeNull();
  fireEvent.click(await screen.findByLabelText("Show engine details"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: /Signal Explorer/ });
  expect(persisted).toMatchObject({ inference_cli: "codex", timeout_sec: 300, onboarded: true, show_engine_details: true });
  app.unmount();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /Signal Explorer/ }));
  expect(screen.getByText("Diagnostics content")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
  fireEvent.click(await screen.findByLabelText("Show engine details"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: /Signal Explorer/ })).toBeNull());
  expect(persisted.show_engine_details).toBe(false);
});

it("preserves the setting when first-run onboarding is dismissed", async () => {
  persisted = { inference_cli: "claude", custom_cli_path: "", timeout_sec: 360, onboarded: false, show_engine_details: true };
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Get started" }));
  await waitFor(() => expect(persisted.onboarded).toBe(true));
  expect(persisted).toMatchObject({ inference_cli: "claude", timeout_sec: 360, show_engine_details: true });
  expect(screen.getByRole("button", { name: /Signal Explorer/ })).toBeTruthy();
});
