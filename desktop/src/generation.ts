import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { validateSourcesResult } from "./fixtures";

/**
 * The generation flow's client: the settings the shell persists, the CLI
 * preflight for Settings, and the generate/cancel pair. The engine's phase
 * events arrive on stderr while it runs and are forwarded by the shell as
 * `generation://phase` events carrying the JSON line verbatim.
 */

/** One engine phase event, docs/engine-json.md §stderr phase events. */
export interface PhaseEvent {
  event: "scan_done" | "inference_start";
  sessions?: number;
  pairs?: number;
  candidates?: number;
  cli?: string;
  timeout_s?: number;
}

export interface Settings {
  inference_cli: "auto" | "claude" | "codex" | "pi" | "custom";
  custom_cli_path: string;
  timeout_sec: number;
  /** First-run flag: the welcome sheet shows until dismissed. */
  onboarded: boolean;
}

/** One supported inference CLI as the app's PATH resolves it. */
export interface CliStatus {
  name: string;
  /** null when it isn't installed. */
  path: string | null;
  /** First line of `<cli> --version`; null when missing or it didn't run. */
  version: string | null;
  /** Found and `--version` exited 0. Found but not running usually means a
   *  runtime (node) the app's PATH lacks. */
  runs: boolean;
}

export interface Detection {
  /** The CLI the current settings hand the brief to, null if none found. */
  cli: string | null;
  path: string | null;
  considered: string[];
  /** Every supported CLI, installed or not, in "auto" order. */
  clis: CliStatus[];
  /** Whether the login shell's PATH was resolved and put in front. */
  login_shell: boolean;
  path_dirs: string[];
}

export const getSettings = () => invoke<Settings>("get_settings");
export const setSettings = (settings: Settings) => invoke<void>("set_settings", { settings });
export const detectInference = () => invoke<Detection>("detect_inference");

/** The transcript half of detection: each tool's session directory and
 *  counts, from `recap --sources`, validated like every engine payload. */
export const detectSources = () =>
  invoke<string>("detect_sources").then((raw) => validateSourcesResult(JSON.parse(raw)));

/** Runs a generation and resolves with the brief markdown from the
 *  engine's stdout. Rejects with the engine's stderr (or a spawn error) —
 *  classifyGenerationError maps that onto the spec's error table. */
export const generateBrief = () => invoke<string>("generate_brief");

/** Stops a running generation: SIGTERM to the sidecar, which the engine
 *  traps to kill the inference CLI's process group. */
export const cancelGeneration = () => invoke<void>("cancel_generation");

/** Listen for phase events during a generation run; resolves with the
 *  unlisten function. */
export function onPhase(handler: (phase: PhaseEvent) => void): Promise<() => void> {
  return listen<string>("generation://phase", (e) => {
    try {
      handler(JSON.parse(e.payload) as PhaseEvent);
    } catch {
      // not a JSON event; the shell only forwards events
    }
  }).then((un) => un);
}

/** The spec's error-state table for generation, §Inference. */
export type GenerationErrorKind = "no-cli" | "timeout" | "failed";

export interface GenerationError {
  kind: GenerationErrorKind;
  title: string;
  detail: string;
}

export function classifyGenerationError(message: string): GenerationError {
  if (/no inference CLI found/i.test(message)) {
    return {
      kind: "no-cli",
      title: "Generation needs the `claude`, `codex` or `pi` CLI. Scanning and the Signal Explorer still work.",
      detail: message,
    };
  }
  const missing = message.match(/(.+?) CLI not found on PATH/);
  if (missing) {
    return {
      kind: "no-cli",
      title: `The ${missing[1]} CLI wasn't found on the app's PATH. Scanning and the Signal Explorer still work.`,
      detail: message,
    };
  }
  if (/timed out/i.test(message)) {
    return {
      kind: "timeout",
      title: "Timed out — the CLI didn't finish.",
      detail: message,
    };
  }
  return { kind: "failed", title: "Generation failed.", detail: message };
}
