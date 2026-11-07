import { afterEach, describe, expect, it, vi } from "vitest";
import { startVibrancy } from "./vibrancy";
import baseConfig from "../src-tauri/tauri.conf.json";
import macConfig from "../src-tauri/tauri.macos.conf.json";
import opaqueConfig from "../src-tauri/tauri.opaque.conf.json";

describe("sidebar vibrancy", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps macOS and opaque window settings aligned except transparency", () => {
    const base = baseConfig.app.windows[0];
    expect(macConfig.app.windows[0]).toEqual({ ...base, transparent: true });
    expect(opaqueConfig.app.windows[0]).toEqual({ ...base, transparent: false });
  });

  it("does not poll unsupported or opaque builds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setInterval });
    const check = vi.fn().mockResolvedValue(null);
    const setEnabled = vi.fn();
    startVibrancy(check, setEnabled);
    await vi.advanceTimersByTimeAsync(3000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  it("tracks macOS preference changes and falls back on failure", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setInterval });
    const check = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("failed"));
    const setEnabled = vi.fn();
    startVibrancy(check, setEnabled);
    await vi.advanceTimersByTimeAsync(2100);
    expect(setEnabled.mock.calls).toEqual([[true], [false], [false]]);
  });
});
