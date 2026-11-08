import { useState } from "react";
import { TOOLS, TOOL_LABELS, type SourcesResult } from "../fixtures";
import { setSettings, type Detection, type Settings } from "../generation";

/**
 * First-run onboarding (docs/desktop-app-spec.md §First run): the four
 * facts a new user should have before the app reads anything — what recap
 * reads, that transcripts never leave the machine, that generation spends
 * their own CLI tokens, and which inference CLI this machine actually
 * has, harness by harness. Dismissing persists settings.onboarded, so it shows exactly once;
 * if the save fails the flag stays false and the sheet returns next
 * launch.
 */
export default function FirstRun({
  settings,
  detection,
  sources,
  onDone,
}: {
  settings: Settings;
  detection: Detection | null;
  sources: SourcesResult | null;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismiss = async () => {
    setBusy(true);
    setError(null);
    try {
      await setSettings({ ...settings, onboarded: true });
      onDone();
    } catch {
      setError("Couldn't save your settings. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="first-run" role="dialog" aria-label="Welcome to recap">
      <div className="first-run-backdrop" />
      <div className="sheet">
        <div className="kicker">Getting started</div>
        <h1 className="display">Welcome to recap.</h1>
        <p className="dek">A quick look at what this app does before it reads anything.</p>

        <div className="first-run-facts">
          <div className="first-run-fact">
            <div className="label">What it reads</div>
            <p>
              Your Claude Code, Codex and Pi conversation transcripts on this machine,
              plus your past morning-recap archives.
            </p>
          </div>
          <div className="first-run-fact">
            <div className="label">Where the data goes</div>
            <p>
              Recap reads your transcripts and keeps your library on this machine.
              When you ask for a brief, it sends selected excerpts to your chosen AI tool,
              which may send them to its provider.
            </p>
          </div>
          <div className="first-run-fact">
            <div className="label">What generation costs</div>
            <p>
              Writing a brief uses your own AI tool and account, so it can use your
              tokens. This happens only when you ask for a brief.
            </p>
          </div>
          <div className="first-run-fact">
            <div className="label">What it found</div>
            <ul className="harnesses">
              {TOOLS.map((tool) => {
                const source = sources?.sources.find((item) => item.tool === tool);
                return (
                  <li key={tool} className="harness">
                    <div className="harness-name">{TOOL_LABELS[tool]}</div>
                    <div className="harness-line">
                      {!source ? "Couldn't check for conversations" : source.found ? `${source.sessions} ${source.sessions === 1 ? "session" : "sessions"} found` : "No conversations found"}
                    </div>
                  </li>
                );
              })}
            </ul>
            {detection?.cli ? (
              <p>
                {detection.cli} will write your briefs. You can choose another tool in
                Settings.
              </p>
            ) : detection ? (
              <p>
                No writing tool found yet. You can still read, use your library and
                review. To write a brief, install Claude Code, Codex or Pi, or set a
                custom tool path in Settings.
              </p>
            ) : <p>Couldn't check for a tool to write briefs. Check Settings to choose one.</p>}
          </div>
        </div>

        <div className="first-run-actions">
          {error && <p className="first-run-error">{error}</p>}
          <button className="button primary" onClick={dismiss} disabled={busy}>
            Get started
          </button>
        </div>
      </div>
    </div>
  );
}
