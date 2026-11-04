import { useEffect, useState } from "react";
import {
  detectInference,
  getSettings,
  setSettings,
  type Detection,
  type Settings,
} from "../generation";

/**
 * Settings per docs/desktop-app-spec.md §Inference: the inference CLI
 * (auto / claude / codex / a custom path), the generation timeout, the
 * augmented PATH the sidecar is spawned with, and the preflight detection
 * so "no CLI installed" is never a surprise mid-generation.
 */
export default function SettingsScreen() {
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
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
              <option value="auto">auto — prefer claude, fall back to codex</option>
              <option value="claude">claude</option>
              <option value="codex">codex</option>
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
          <div className="label">Preflight</div>
          <div className="settings-row detection">
            {detection === null ? (
              <span className="settings-hint">Checking the app's PATH…</span>
            ) : detection.cli ? (
              <span>
                <b>{detection.cli}</b> — {detection.path}
              </span>
            ) : (
              <span>
                None found on the app's PATH (checked {detection.considered.join(", ")}).
                Generation will say so when it runs; scanning and the Signal Explorer
                still work.
              </span>
            )}
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
            GUI-launched apps see a minimal PATH, so the shell puts these in front
            of the inherited PATH before spawning the engine — that's where it
            looks for the inference CLI.
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
