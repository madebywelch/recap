import { useEffect, useState } from "react";
import { toolLabel, type SourcesResult } from "../fixtures";
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
export default function SettingsScreen({ onSaved }: { onSaved: (settings: Settings) => void }) {
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
        if (alive) setError("Couldn't load settings. Close and reopen recap, then try again.");
      });
    detectSources()
      .then((found) => alive && setSources(found))
      .catch(() => alive && setSourcesError("Transcript check failed. Try again later."));
    return () => {
      alive = false;
    };
  }, []);

  if (!settings) {
    return (
      <div className="folio-scroll">
        <div className="sheet settings-sheet">
          <h1 className="display">Settings</h1>
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
      onSaved(settings);
      setNote("Saved.");
      setDetection(await detectInference().catch(() => null));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message === "a custom CLI needs a path"
        ? "Enter a path to your writing tool."
        : message === "timeout must be between 60 and 900 seconds"
          ? "Choose a time limit between 60 and 900 seconds."
          : "Couldn't save settings. Please try again.");
    }
  };

  return (
    <div className="folio-scroll">
      <div className="sheet settings-sheet">
        <header>
          <h1 className="display">Settings</h1>
          <p className="dek">Choose how to write briefs and see what recap found on this machine.</p>
        </header>

        <section className="settings-group">
          <h2 className="settings-section-title">Writing briefs</h2>
          <div className="settings-card settings-generation">
          <label className="label" htmlFor="inference-cli">Writing tool</label>
          <div className="settings-row">
            <select
              id="inference-cli"
              value={settings.inference_cli}
              onChange={(e) =>
                update({ inference_cli: e.target.value as Settings["inference_cli"] })
              }
            >
              <option value="auto">Automatic — first available tool</option>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="pi">Pi</option>
              <option value="custom">Custom tool</option>
            </select>
            {settings.inference_cli === "custom" && (
              <input
                type="text"
                aria-label="Custom writing tool path"
                placeholder="/opt/tools/claude"
                value={settings.custom_cli_path}
                onChange={(e) => update({ custom_cli_path: e.target.value })}
              />
            )}
          </div>
          <div className="settings-hint">
            {settings.inference_cli === "custom"
              ? "The custom tool must accept input like Claude Code."
              : "Choose which tool writes briefs."}
          </div>
          <div className="settings-field">
            <label className="label" htmlFor="generation-timeout">Time limit</label>
            <div className="settings-row">
              <input id="generation-timeout" type="number" min={60} max={900} step={30}
                value={settings.timeout_sec}
                onChange={(e) => update({ timeout_sec: Number(e.target.value) })} />
              <span className="settings-hint">seconds, 60–900</span>
            </div>
          </div>
          </div>
        </section>

        <section className="settings-group">
          <h2 className="settings-section-title">Detected on this machine</h2>
          <Harnesses detection={detection} sources={sources} sourcesError={sourcesError} />
          <div className="settings-hint">
            {detection === null
              ? "Checking for writing tools…"
              : detection.cli
                ? `Briefs are written by ${toolLabel(detection.cli)}.`
                : "No writing tool found for this setting. Choose or install a tool to write briefs."}
            {sourcesError && ` ${sourcesError}`}
          </div>
        </section>

        <section className="settings-group">
          <h2 className="settings-section-title">Tool locations</h2>
          <details className="settings-card settings-path">
          <summary>Where recap looks for tools</summary>
          <p className="settings-hint">
            Recap checks your usual tool locations and the locations provided by your system
            {detection && !detection.login_shell ? ", though it couldn't read your shell's locations this time" : ""}.
          </p>
          {detection && (
            <pre className="path-dirs">{detection.path_dirs.join("\n")}{"\n…then your system locations"}</pre>
          )}
          </details>
        </section>

        <section className="settings-group">
          <h2 className="settings-section-title">Advanced</h2>
          <div className="settings-card">
            <label>
              <input type="checkbox" checked={settings.show_engine_details}
                onChange={(e) => update({ show_engine_details: e.target.checked })} />{" "}
              Show engine details
            </label>
          </div>
        </section>

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
