import { useState } from "react";
import type { SourcesResult } from "../fixtures";
import { setSettings, type Detection, type Settings } from "../generation";
import Harnesses from "./Harnesses";

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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="first-run" role="dialog" aria-label="Welcome to recap">
      <div className="first-run-backdrop" />
      <div className="sheet">
        <div className="kicker">recap desktop · first run</div>
        <h1 className="display">Welcome to recap.</h1>
        <p className="dek">A quick look at what this app does before it reads anything.</p>

        <div className="first-run-facts">
          <div className="first-run-fact">
            <div className="label">What it reads</div>
            <p>
              The session transcripts your AI CLIs already keep on this machine — Claude
              Code, Codex and Pi sessions — plus your past morning-recap archives.
              Nothing is fetched from anywhere else.
            </p>
          </div>
          <div className="first-run-fact">
            <div className="label">Where the data goes</div>
            <p>
              Nowhere. Transcripts never leave this machine: scanning, scoring, and the
              concept library all run in the bundled engine, on your disk.
            </p>
          </div>
          <div className="first-run-fact">
            <div className="label">What generation costs</div>
            <p>
              Writing a brief runs your own inference CLI, so it spends your tokens, on
              your account — and only when you ask for a brief.
            </p>
          </div>
          <div className="first-run-fact">
            <div className="label">What it found</div>
            <Harnesses detection={detection} sources={sources} />
            {detection?.cli ? (
              <p>
                <code>{detection.cli}</code> will write your briefs; pick another in
                Settings.
              </p>
            ) : (
              <p>
                No inference CLI found yet. Reading, the library, and review all work
                without one; writing a brief needs <code>claude</code>, <code>codex</code>{" "}
                or <code>pi</code> on this machine, or a custom path in Settings.
              </p>
            )}
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
