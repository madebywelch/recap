import { useState } from "react";
import { candidates, scan } from "../fixtures";

function firstLine(text: string): string {
  const line = text.split("\n")[0];
  return line.length > 96 ? line.slice(0, 96) + "…" : line;
}

function formatTs(ts: string): string {
  return new Date(ts).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function scoreClass(score: number): string {
  return score >= 8 ? "high" : score >= 5 ? "mid" : "low";
}

export default function SignalExplorer() {
  const [selected, setSelected] = useState(0);
  const current = candidates[selected];

  return (
    <div className="explorer">
      <header className="screen-header">
        <h1>Signal Explorer</h1>
        <p>
          What the heuristics engine kept: {candidates.length} candidates above
          the score floor, best first, out of {scan.sessions} sessions and{" "}
          {scan.pairs} pairs. Pick one to see the exchange it came from and
          the arithmetic behind its rank.
        </p>
      </header>
      <div className="explorer-panes">
        <div className="candidate-list">
          {candidates.map((cand, i) => (
            <button
              key={cand.id}
              className={i === selected ? "candidate active" : "candidate"}
              onClick={() => setSelected(i)}
            >
              <span className={"score-badge " + scoreClass(cand.score)}>
                {cand.score}
              </span>
              <span className="candidate-line">{firstLine(cand.userMessage)}</span>
              <span className="candidate-chips">
                {cand.signals.map((s) => (
                  <span key={s.name} className="chip">
                    {s.name} {s.weight >= 0 ? "+" : ""}
                    {s.weight}
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
        <div className="candidate-detail">
          <div className="detail-meta">
            <span className="tool-tag">{current.tool}</span>
            <span className="detail-cwd">{current.cwd}</span>
            <span className="detail-time">{formatTs(current.ts)}</span>
          </div>
          <section className="exchange">
            <h2>You asked</h2>
            <p className="exchange-user">{current.userMessage}</p>
            <h2>The agent answered</h2>
            <p className="exchange-assistant">{current.assistantExcerpt}</p>
          </section>
          <section className="arithmetic">
            <h2>Why it scored {current.score}</h2>
            <div className="chip-row">
              {current.signals.map((s) => (
                <span
                  key={s.name}
                  className={s.weight >= 0 ? "chip pos" : "chip neg"}
                >
                  {s.name} {s.weight >= 0 ? "+" : ""}
                  {s.weight}
                </span>
              ))}
              <span className="chip total">= {current.score}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
