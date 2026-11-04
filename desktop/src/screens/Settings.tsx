import { useEffect, useState } from "react";
import type { SourcesResult } from "../fixtures";
import {
  detectInference,
  detectSources,
  getSettings,
  setSettings,
  type Detection,
  type Settings,
} from "../generation";
import Harnesses from "./Harnesses";

/**
 * Settings per docs/desktop-app-spec.md §Inference: the inference CLI
 * (auto / claude / codex / pi / a custom path), the generation timeout,
 * the augmented PATH the sidecar is spawned with, and what this machine
 * has per harness — transcripts and CLI — so "no CLI installed" is never
 * a surprise mid-generation.
 */
export default function SettingsScreen() {
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [sources, setSources] = useState<SourcesResult | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getSettings(), detectInference()])
      .then(([loaded, found]) => {
        if (!alive) return;
        setSettingsState(loaded);
        setDetection(found);
      })
      .catch(() => {
        if (alive) setError("Settings live in the app shell — run the app, not the browser build.");
      });
    detectSources()
      .then((found) => alive && setSources(found))
      .catch((e) => alive && setSourcesError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (!settings) {
    return (
      <div className="folio-scroll">
        <div className="sheet settings-sheet">
          <div className="kicker">Settings</div>
          {error ? <p className="dek">{error}</p> : <p className="dek">Reading settings…</p>}
        </div>
      </div>
    );
  }

  const update = (patch: Partial<Settings>) => {
    setSettingsState({ ...settings, ...patch });
    setNote(null);
  };

  const save = async () => {
    setError(null);
    try {
      await setSettings(settings);
      setDetection(await detectInference());
      setNote("Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="folio-scroll">
      <div className="sheet settings-sheet">
        <div className="kicker">Settings</div>

        <div className="settings-group">
          <div className="label">Inference CLI</div>
          <div className="settings-row">
            <select
              value={settings.inference_cli}
              onChange={(e) =>
                update({ inference_cli: e.target.value as Settings["inference_cli"] })
              }
            >
              <option value="auto">auto — the first installed of claude, codex, pi</option>
              <option value="claude">claude</option>
              <option value="codex">codex</option>
              <option value="pi">pi</option>
              <option value="custom">custom path</option>
            </select>
            {settings.inference_cli === "custom" && (
              <input
                type="text"
                placeholder="/opt/tools/claude"
                value={settings.custom_cli_path}
                onChange={(e) => update({ custom_cli_path: e.target.value })}
              />
            )}
          </div>
          <div className="settings-hint">
            {settings.inference_cli === "custom"
              ? "The custom path is passed to the engine as --inference and run claude-style (-p)."
              : "Passed to the engine as --inference."}
          </div>
        </div>

        <div className="settings-group">
          <div className="label">Detected on this machine</div>
          <Harnesses detection={detection} sources={sources} sourcesError={sourcesError} />
          <div className="settings-hint">
            {detection === null
              ? "Checking the app's PATH…"
              : detection.cli
                ? `The brief will be written by ${detection.cli} (${detection.path}).`
                : `No CLI for this setting on the app's PATH (checked ${detection.considered.join(", ")}). Generation will say so when it runs; scanning and the Signal Explorer still work.`}
            {sourcesError && ` Transcript check failed: ${sourcesError}`}
          </div>
        </div>

        <div className="settings-group">
          <div className="label">Generation timeout</div>
          <div className="settings-row">
            <input
              type="number"
              min={60}
              max={900}
              step={30}
              value={settings.timeout_sec}
              onChange={(e) => update({ timeout_sec: Number(e.target.value) })}
            />
            <span className="settings-hint">seconds, 60–900</span>
          </div>
        </div>

        <div className="settings-group">
          <div className="label">Augmented PATH</div>
          <p className="settings-hint">
            GUI-launched apps see a minimal PATH, so the app asks your login shell
            for its PATH{detection && !detection.login_shell ? " (it didn't answer this time)" : ""},
            adds the common install locations, and puts both in front of the
            inherited PATH before spawning the engine — that's where it looks for
            the inference CLI.
          </p>
          {detection && (
            <ul className="path-dirs">
              {detection.path_dirs.slice(0, 3).map((dir) => (
                <li key={dir}>{dir}</li>
              ))}
              <li className="settings-hint">…then the inherited PATH</li>
            </ul>
          )}
        </div>

        {error && <p className="settings-error">{error}</p>}
        <div className="closing">
          <button className="button primary" onClick={save}>
            Save
          </button>
          {note && <span className="settings-hint">{note}</span>}
        </div>
      </div>
    </div>
  );
}
