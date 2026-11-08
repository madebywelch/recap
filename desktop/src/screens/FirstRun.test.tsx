// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setSettings, type Settings } from "../generation";
import FirstRun from "./FirstRun";

vi.mock("../generation", () => ({ setSettings: vi.fn() }));

const settings: Settings = { inference_cli: "auto", custom_cli_path: "", timeout_sec: 300, onboarded: false, show_engine_details: false };
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("explains where excerpts go and reports an unavailable check", () => {
  render(<FirstRun settings={settings} detection={null} sources={null} onDone={vi.fn()} />);
  expect(screen.getByText(/sends selected excerpts to your chosen AI tool/)).toBeTruthy();
  expect(screen.getByText(/Couldn't check for a tool to write briefs/)).toBeTruthy();
  expect(screen.queryByText(/No writing tool found/)).toBeNull();
});

it("shows found sessions and the selected writing tool without technical details", () => {
  render(<FirstRun settings={settings} onDone={vi.fn()} detection={{ cli: "claude", path: "/private/bin/claude", considered: [], clis: [], login_shell: true, path_dirs: [] }} sources={{ engineVersion: "1.0.0", since: "2026-11-01", sources: [{ tool: "claude", root: "/private/sessions", found: true, sessions: 2, recentSessions: 1 }] }} />);
  expect(screen.getByText("2 sessions found")).toBeTruthy();
  expect(screen.getByText(/Claude Code will write your briefs/)).toBeTruthy();
  expect(screen.queryByText(/\/private/)).toBeNull();
});

it("hides raw save errors and allows another attempt", async () => {
  vi.mocked(setSettings).mockRejectedValueOnce(new Error("private error details")).mockResolvedValueOnce();
  const onDone = vi.fn();
  render(<FirstRun settings={settings} detection={null} sources={null} onDone={onDone} />);
  fireEvent.click(screen.getByRole("button", { name: "Get started" }));
  expect(await screen.findByText("Couldn't save your settings. Please try again.")).toBeTruthy();
  expect(screen.queryByText("private error details")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Get started" }));
  await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  expect(setSettings).toHaveBeenLastCalledWith({ ...settings, onboarded: true });
});
