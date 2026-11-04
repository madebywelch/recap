import { useState } from "react";
import { candidates, parseSignal } from "../fixtures";

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

export default function SignalExplorer() {
  const [selected, setSelected] = useState(0);
  const current = candidates[selected];
  const signals = (current.signals ?? []).map(parseSignal);

  return (
    <div className="explorer">
      <header className="screen-header">
        <h1>Signal Explorer</h1>
        <p>
          What the heuristics engine kept: {candidates.length} candidates above
          the score floor, best first. Pick one to see the exchange it came
          from and the arithmetic behind its rank.
        </p>
      </header>
      <div className="explorer-panes">
        <div className="candidate-list">
          {candidates.map((cand, i) => (
            <button
              key={`${cand.session}-${cand.ts}`}
              className={i === selected ? "candidate active" : "candidate"}
              onClick={() => setSelected(i)}
            >
              <span className={"score-badge " + (cand.score >= 8 ? "high" : cand.score >= 5 ? "mid" : "low")}>
                {cand.score}
              </span>
              <span className="candidate-line">{firstLine(cand.user)}</span>
              <span className="candidate-chips">
                {(cand.signals ?? []).map((s) => (
                  <span key={s} className="chip">
                    {s}
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
            <p className="exchange-user">{current.user}</p>
            <h2>The agent answered</h2>
            <p className="exchange-assistant">{current.assistant_excerpt}</p>
          </section>
          <section className="arithmetic">
            <h2>Why it scored {current.score}</h2>
            <div className="chip-row">
              {signals.map((s) => (
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
