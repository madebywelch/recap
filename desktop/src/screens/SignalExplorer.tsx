import { useExplorer } from "../useExplorer";
import type { StoreState } from "../store";
import {
  allSignalNames,
  assistantSignals,
  cappedAt,
  scoreBounds,
  userSignals,
  type ExplorerFilters,
} from "../explorer-filters";
import type { Candidate, Signal } from "../fixtures";

/** Presentation is deliberately thin — the design pass (see the spec's
 *  build order) replaces the look; the state and filtering live in
 *  useExplorer and explorer-filters. */

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

function fullTs(ts: string): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function Chip({ signal }: { signal: Signal }) {
  return (
    <span className={signal.weight >= 0 ? "chip pos" : "chip neg"}>
      {signal.name} {signed(signal.weight)}
    </span>
  );
}

function FilterBar({
  candidates,
  filters,
  onChange,
}: {
  candidates: Candidate[];
  filters: ExplorerFilters;
  onChange: (next: ExplorerFilters) => void;
}) {
  const { min, max } = scoreBounds(candidates);
  const toggleSignal = (name: string) => {
    const has = filters.signals.includes(name);
    onChange({
      ...filters,
      signals: has
        ? filters.signals.filter((s) => s !== name)
        : [...filters.signals, name],
    });
  };
  return (
    <div className="filter-bar">
      <label className="filter">
        <span className="filter-label">min score</span>
        <input
          type="range"
          min={min}
          max={max}
          value={filters.minScore}
          onChange={(e) => onChange({ ...filters, minScore: Number(e.target.value) })}
        />
        <span className="filter-value">{filters.minScore}</span>
      </label>
      <label className="filter">
        <span className="filter-label">tool</span>
        <select
          value={filters.tool}
          onChange={(e) =>
            onChange({ ...filters, tool: e.target.value as ExplorerFilters["tool"] })
          }
        >
          <option value="all">all</option>
          <option value="claude">claude</option>
          <option value="codex">codex</option>
        </select>
      </label>
      <label className="filter">
        <span className="filter-label">from</span>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
        />
      </label>
      <label className="filter">
        <span className="filter-label">to</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
        />
      </label>
      <label className="filter grow">
        <span className="filter-label">search</span>
        <input
          type="search"
          placeholder="in the redacted exchange"
          value={filters.text}
          onChange={(e) => onChange({ ...filters, text: e.target.value })}
        />
      </label>
      <div className="filter signal-filters">
        {allSignalNames(candidates).map((name) => (
          <button
            key={name}
            className={filters.signals.includes(name) ? "chip toggle on" : "chip toggle"}
            aria-pressed={filters.signals.includes(name)}
            onClick={() => toggleSignal(name)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SignalExplorer({ store }: { store: StoreState | null }) {
  const { filters, setFilters, visible, selected, select } = useExplorer(store);

  if (!store) {
    return (
      <div className="explorer">
        <header className="screen-header">
          <h1>Signal Explorer</h1>
        </header>
        <div className="explorer-panes">
          <div className="pane-message">Scanning sessions…</div>
        </div>
      </div>
    );
  }

  const cap = selected ? cappedAt(selected) : null;

  return (
    <div className="explorer">
      <header className="screen-header">
        <h1>Signal Explorer</h1>
        <p>
          {store.source === "live"
            ? `${store.candidates.length} candidates in the store, live from the last scan (since ${store.since}) — the heuristics engine made visible. Filter, select, and read the arithmetic behind each rank.`
            : "Committed fixture data — the browser build can't run the engine sidecar. Run the app shell for a live scan."}
        </p>
        {store.error && <p className="error-note">Live scan failed: {store.error}</p>}
      </header>
      <FilterBar candidates={store.candidates} filters={filters} onChange={setFilters} />
      <div className="explorer-panes">
        <div className="candidate-list">
          {visible.map((cand) => (
            <button
              key={cand.id}
              className={selected && cand.id === selected.id ? "candidate active" : "candidate"}
              onClick={() => select(cand.id)}
            >
              <span
                className={
                  "score-badge " + (cand.score >= 8 ? "high" : cand.score >= 5 ? "mid" : "low")
                }
              >
                {cand.score}
              </span>
              <span className="candidate-line">{firstLine(cand.userMessage)}</span>
              <span className="candidate-meta">
                {cand.tool} · {formatTs(cand.ts)}
              </span>
              <span className="candidate-chips">
                {cand.signals.map((s) => (
                  <span key={s.name} className="chip">
                    {s.name} {signed(s.weight)}
                  </span>
                ))}
              </span>
            </button>
          ))}
          {visible.length === 0 && (
            <div className="pane-message">No candidates match the current filters.</div>
          )}
        </div>
        {selected ? (
          <div className="candidate-detail">
            <div className="detail-meta">
              <span className="tool-tag">{selected.tool}</span>
              <span className="detail-cwd">{selected.cwd}</span>
              <span className="detail-time">{formatTs(selected.ts)}</span>
            </div>
            <section className="arithmetic">
              <h2>Score arithmetic</h2>
              <div className="score-block">
                <div className="block-head">
                  user score <span className="block-val">{selected.userScore}</span>
                </div>
                <div className="chip-row">
                  {userSignals(selected).map((s) => (
                    <Chip key={s.name} signal={s} />
                  ))}
                  {userSignals(selected).length === 0 && (
                    <span className="muted">no user signals fired</span>
                  )}
                </div>
              </div>
              <div className="score-block">
                <div className="block-head">
                  assistant bonus{" "}
                  <span className="block-val">{signed(selected.assistantBonus)}</span>
                </div>
                <div className="chip-row">
                  {assistantSignals(selected).map((s) => (
                    <Chip key={s.name} signal={s} />
                  ))}
                  {assistantSignals(selected).length === 0 && (
                    <span className="muted">no assistant signals — bonus 0</span>
                  )}
                </div>
                {cap !== null && (
                  <p className="cap-note">
                    assistant bonus capped at {cap} — the reply can amplify a learning
                    moment, never create one
                  </p>
                )}
              </div>
              <div className="score-total">
                total <span className="total-val">{selected.score}</span>
                <span className="total-expr">
                  {selected.userScore} {signed(selected.assistantBonus)}
                </span>
              </div>
            </section>
            <section className="exchange">
              <h2>The exchange</h2>
              <pre className="exchange-user">{selected.userMessage}</pre>
              <pre className="exchange-assistant">{selected.assistantExcerpt}</pre>
              <div className="session-meta">
                <span>session {selected.sessionId}</span>
                {selected.cwd && <span>{selected.cwd}</span>}
                <span>{fullTs(selected.ts)}</span>
              </div>
            </section>
          </div>
        ) : (
          <div className="candidate-detail">
            <div className="pane-message">Select a candidate.</div>
          </div>
        )}
      </div>
    </div>
  );
}
