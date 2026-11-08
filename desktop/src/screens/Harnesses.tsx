import { TOOLS, TOOL_LABELS, type SourcesResult } from "../fixtures";
import type { Detection } from "../generation";

/**
 * What this machine has, per harness: the transcripts recap can read
 * (from `recap --sources`) and the inference CLI it could write the brief
 * with (from the shell's PATH probe). Every supported harness gets a row,
 * installed or not, so "detected" never silently means "the first one
 * auto found". Shared by Settings and the first-run sheet.
 */
export default function Harnesses({
  detection,
  sources,
  sourcesError,
}: {
  detection: Detection | null;
  sources: SourcesResult | null;
  sourcesError?: string | null;
}) {
  return (
    <ul className="harnesses">
      {TOOLS.map((tool) => {
        const source = sources?.sources.find((s) => s.tool === tool);
        const cli = detection?.clis.find((c) => c.name === tool);
        const writes = detection?.cli === tool;
        return (
          <li key={tool} className={writes ? "harness writes" : "harness"}>
            <div className="harness-name">
              {TOOL_LABELS[tool]}
              {writes && <span className="harness-badge">writes the brief</span>}
            </div>
            <div className="harness-line">
              <span className="harness-kind">Transcripts</span>
              {source ? (
                source.found ? (
                  <span>
                    {count(source.sessions, "session")}, {source.recentSessions} in the last day{" "}
                    <code>{source.root}</code>
                  </span>
                ) : (
                  <span className="harness-missing">
                    none at <code>{source.root}</code>
                  </span>
                )
              ) : (
                <span className="harness-missing">{sourcesError ? "couldn't check" : "checking…"}</span>
              )}
            </div>
            <div className="harness-line">
              <span className="harness-kind">Writing tool</span>
              {!cli ? (
                <span className="harness-missing">checking…</span>
              ) : !cli.path ? (
                <span className="harness-missing">
                  <code>{tool}</code> wasn't found
                </span>
              ) : cli.runs ? (
                <span>
                  {cli.version ?? "installed"} <code>{cli.path}</code>
                </span>
              ) : (
                <span className="harness-warn">
                  found at <code>{cli.path}</code>, but couldn't run — it may need a runtime
                  such as Node.js
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
