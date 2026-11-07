import { useEffect, useState } from "react";
import briefSource from "../../fixtures/daily-brief.md?raw";
import { useExplorer } from "../useExplorer";
import { loadBriefRun, type StoreState } from "../store";
import type { Navigate } from "../App";
import {
  allSignalNames,
  assistantSignals,
  cappedAt,
  rawAssistantBonus,
  scoreBounds,
  userSignals,
  type ExplorerFilters,
} from "../explorer-filters";
import { TOOLS, TOOL_LABELS, type Candidate, type Signal } from "../fixtures";
import { count, parseEntries, project, signed } from "../brief";
import "./signal-explorer.css";

const FIXTURE_IN_BRIEF = new Set(parseEntries(briefSource).flatMap((e) => e.sources));

const TOOL_FILTERS: ExplorerFilters["tool"][] = ["all", ...TOOLS];

function num(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : String(n);
}

function shortTs(ts: string): string {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function Filters({
  candidates,
  filters,
  onChange,
}: {
  candidates: Candidate[];
  filters: ExplorerFilters;
  onChange: (next: ExplorerFilters) => void;
}) {
  const { min, max } = scoreBounds(candidates);
  const toggleSignal = (name: string) =>
    onChange({
      ...filters,
      signals: filters.signals.includes(name)
        ? filters.signals.filter((s) => s !== name)
        : [...filters.signals, name],
    });
  return (
    <div className="xfilters">
      <label className="xsearch">
        <span aria-hidden>⌕</span>
        <input
          type="search"
          placeholder="Search messages"
          value={filters.text}
          onChange={(e) => onChange({ ...filters, text: e.target.value })}
        />
      </label>
      <div className="xrow">
        <label className="xslider">
          <span>Min score</span>
          <input
            type="range"
            min={min}
            max={max}
            value={filters.minScore}
            onChange={(e) => onChange({ ...filters, minScore: Number(e.target.value) })}
          />
          <b>{num(filters.minScore)}</b>
        </label>
        <div className="seg" role="group" aria-label="Tool">
          {TOOL_FILTERS.map((t) => (
            <button
              key={t}
              className={filters.tool === t ? "on" : ""}
              aria-pressed={filters.tool === t}
              onClick={() => onChange({ ...filters, tool: t })}
            >
              {t === "all" ? "All" : TOOL_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="xrow">
        <span>Window</span>
        <input
          type="date"
          aria-label="From"
          value={filters.dateFrom}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
        />
        <span>to</span>
        <input
          type="date"
          aria-label="To"
          value={filters.dateTo}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
        />
      </div>
      <div className="xchips">
        {allSignalNames(candidates).map((name) => (
          <button
            key={name}
            className={filters.signals.includes(name) ? "signal on" : "signal"}
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

function Line({ s, cap }: { s: Signal; cap?: boolean }) {
  return (
    <div className={cap ? "li capr" : "li"}>
      <span>{s.name}</span>
      <span className="dots" />
      <span className="v">{signed(s.weight)}</span>
    </div>
  );
}

function Ledger({ c }: { c: Candidate }) {
  const user = userSignals(c);
  const assistant = assistantSignals(c).filter((s) => s.name !== "assistant-cap");
  const capSignal = assistantSignals(c).find((s) => s.name === "assistant-cap");
  const cap = cappedAt(c);
  const raw = rawAssistantBonus(c);
  return (
    <>
      <div className="ledger">
        <div className="sec">
          User side <em>— the gate. Only what you wrote can make a moment count.</em>
        </div>
        {user.map((s) => (
          <Line key={s.name} s={s} />
        ))}
        {user.length === 0 && <div className="li none">no user signals fired</div>}
        <div className="li sub">
          <span>User score</span>
          <span className="v">{num(c.userScore)}</span>
        </div>
        <div className="sec">
          Assistant side <em>— amplification, never more than the gate</em>
        </div>
        {assistant.map((s) => (
          <Line key={s.name} s={s} />
        ))}
        {capSignal && <Line s={capSignal} cap />}
        {assistant.length === 0 && <div className="li none">no assistant signals fired</div>}
        <div className="li sub">
          <span>
            Assistant bonus{" "}
            <i>
              {cap !== null
                ? `(${raw} raw, capped at ${cap})`
                : assistant.length > 0
                  ? `(cap ${num(c.userScore)}, not reached)`
                  : ""}
            </i>
          </span>
          <span className="v">{signed(c.assistantBonus)}</span>
        </div>
        <div className="li total">
          <span>Score</span>
          <span className="v">{num(c.score)}</span>
        </div>
      </div>
      {cap !== null ? (
        <p className="note">
          The reply earned {raw}, but the bonus is capped at the user score of {cap}. The assistant can amplify a learning
          moment; it can never create one.
        </p>
      ) : (
        <p className="note quiet">
          The assistant bonus is capped at the user score, so the reply can amplify a learning moment but never create one.
        </p>
      )}
    </>
  );
}

function Detail({ c, inBrief, onNavigate }: { c: Candidate; inBrief: Set<string>; onNavigate: Navigate }) {
  return (
    <div className="xsheet">
      <div className="signal-selected"><div className="kicker">
        Selected candidate · <span className="xid">{c.id}</span>
      </div>
      <p className="dq">“{oneLine(c.userMessage)}”</p>
      <div className="who">
        {c.tool} · {project(c)} · {shortTs(c.ts)}
        {inBrief.has(c.id) && (
          <>
            {" · "}
            <button className="link" onClick={() => onNavigate("brief")}>
              In today's brief →
            </button>
          </>
        )}
      </div>
      </div>
      <div className="signal-score"><span>Total signal</span><strong>{num(c.score)}</strong><span>points</span><p>A stronger signal helps this moment bubble up into your brief.</p></div>
      <div className="signal-ledger"><h2>How the score adds up</h2>
      <Ledger c={c} />
      </div>
      <details className="source signal-source" open>
        <summary>The exchange</summary>
        <div className="exchange-sheet">
          <div className="turn">
            <div className="turn-who">You</div>
            <pre>{c.userMessage}</pre>
          </div>
          <div className="turn">
            <div className="turn-who">{c.tool}</div>
            <pre>{c.assistantExcerpt}</pre>
          </div>
        </div>
        <dl className="meta">
          <dt>Tool</dt>
          <dd>{c.tool}</dd>
          <dt>Session</dt>
          <dd>{c.sessionId}</dd>
          <dt>Working dir</dt>
          <dd>{c.cwd || "—"}</dd>
          <dt>Time</dt>
          <dd>{c.ts}</dd>
        </dl>
      </details>
    </div>
  );
}

export default function SignalExplorer({
  store,
  focus,
  onNavigate,
}: {
  store: StoreState | null;
  focus: string | null;
  onNavigate: Navigate;
}) {
  const { filters, setFilters, visible, selected, select } = useExplorer(store);

  // "In brief" tags follow the brief the reader actually sees: the latest
  // live run's sources, or the fixture brief when running on fixtures.
  const [inBrief, setInBrief] = useState<Set<string>>(FIXTURE_IN_BRIEF);
  const [briefError, setBriefError] = useState<string | null>(null);
  useEffect(() => {
    setBriefError(null);
    if (!store || store.source === "fixture") {
      setInBrief(FIXTURE_IN_BRIEF);
      return;
    }
    let alive = true;
    loadBriefRun(store.since)
      .then((run) => {
        if (alive) setInBrief(new Set(parseEntries(run?.raw_output ?? "").flatMap((e) => e.sources)));
      })
      .catch((error: unknown) => {
        if (alive) {
          setInBrief(new Set());
          setBriefError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      alive = false;
    };
  }, [store]);

  // A cross-link names a candidate: widen the filters until it is listed.
  useEffect(() => {
    const target = focus ? store?.candidates.find((c) => c.id === focus) : undefined;
    if (!target) return;
    const day = target.ts.slice(0, 10);
    setFilters((f) => ({
      ...f,
      minScore: Math.min(f.minScore, target.score),
      tool: "all",
      signals: [],
      text: "",
      dateFrom: f.dateFrom && day < f.dateFrom ? "" : f.dateFrom,
      dateTo: f.dateTo && day > f.dateTo ? "" : f.dateTo,
    }));
    select(target.id);
  }, [focus, store, setFilters, select]);

  if (!store) {
    return (
      <div className="split signal-explorer">
        <header className="lhead">
          <div className="kicker">Signal Explorer</div>
          <h1>Why the engine chose</h1>
          <p>Scanning this machine's sessions…</p>
        </header>
      </div>
    );
  }

  return (
    <div className="split signal-explorer">
      <header className="lhead">
        <div className="kicker">Signal Explorer</div>
        <h1>Why the engine chose</h1>
        <p>
          {store.source === "live" ? "Live scan" : "Engine fixture"} · {count(store.candidates.length, "candidate")} since{" "}
          {new Date(store.since + "T00:00").toLocaleDateString([], { month: "short", day: "numeric" })} · sorted by score
        </p>
        {store.source === "fixture" && !store.error && (
          <p className="xnote">The browser build can't run the engine sidecar. The app shell scans live.</p>
        )}
        {store.error && <p className="xnote error">Live scan failed, so this is the fixture: {store.error}</p>}
        {briefError && <p className="xnote error" role="alert">Couldn't load brief links: {briefError}</p>}
      </header>
      <details className="signal-filters">
        <summary>Filters <span>{count(visible.length, "candidate")} shown</span></summary>
        <Filters candidates={store.candidates} filters={filters} onChange={setFilters} />
      </details>
      <div className="xlist">
        <h2 className="signal-list-heading">Candidates <span>{visible.length}</span></h2>
        <div className="xrows">
          {visible.map((c) => (
            <button
              key={c.id}
              className={"xrowc" + (selected && c.id === selected.id ? " sel" : "") + (c.score < 3 ? " low" : "")}
              aria-current={selected?.id === c.id}
              onClick={() => select(c.id)}
            >
              <span className="n">{num(c.score)}</span>
              <span>
                <span className="u">{oneLine(c.userMessage)}</span>
                <span className="m">
                  {c.tool} · {project(c)} · {shortTs(c.ts)}
                  {inBrief.has(c.id) && <span className="tag">in brief</span>}
                </span>
              </span>
            </button>
          ))}
          {store.candidates.length === 0 ? (
            <p className="quiet-note xempty">
              The last scan found no learning moments in this window. New Claude Code, Codex and Pi sessions show up here after
              the next scan.
            </p>
          ) : (
            visible.length === 0 && (
              <p className="quiet-note xempty">
                No candidates match these filters. Lower the minimum score or clear a signal to see more.
              </p>
            )
          )}
        </div>
      </div>
      <div className="xdetail">
        {selected ? (
          <Detail c={selected} inBrief={inBrief} onNavigate={onNavigate} />
        ) : (
          <div className="xsheet">
            <p className="quiet-note">
              {store.candidates.length === 0
                ? "Once a scan finds a candidate, its score arithmetic and the full exchange appear here."
                : "Every candidate is filtered out. Widen the filters to read one."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
