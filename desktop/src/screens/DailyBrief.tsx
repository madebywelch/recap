import { useState } from "react";
import Exchange from "../Exchange";
import { Html } from "../md";
import { type Candidate } from "../fixtures";
import {
  clock,
  count,
  leadOf,
  project,
  readMinutes,
  signed,
  type BriefEntry,
} from "../brief";
import { useBrief, type BriefView } from "../useBrief";
import type { StoreState } from "../store";
import type { GenerationError, PhaseEvent } from "../generation";
import type { Navigate } from "../App";

/** Disclosure depth of one card: collapsed, explainer, source exchange. */
type Level = 0 | 1 | 2;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Entry({
  entry,
  index,
  level,
  byId,
  onLevel,
  onNavigate,
}: {
  entry: BriefEntry;
  index: number;
  level: Level;
  byId: Map<string, Candidate>;
  onLevel: (l: Level) => void;
  onNavigate: Navigate;
}) {
  const sources = entry.sources.map((id) => byId.get(id)).filter((c): c is Candidate => !!c);
  const [primary, ...others] = sources;
  const lead = primary ? leadOf(primary) : null;

  return (
    <article className={"entry" + (level > 0 ? " open" : "")}>
      <div className="entry-num">{String(index + 1).padStart(2, "0")}</div>
      <div>
        {lead && primary && (
          <>
            <p className={lead.kind === "error" ? "entry-lead error" : "entry-lead"}>{lead.text}</p>
            <div className="entry-who">
              {lead.kind === "error" ? "You pasted this into " : "You asked "}
              {primary.tool} · {project(primary)} · {clock(primary.ts)}
            </div>
          </>
        )}
        <Html as="h2" className="entry-title" md={entry.title} />
        <Html as="p" className="entry-what" md={entry.lede} />

        {level === 0 && (
          <button className="disclose" aria-expanded={false} onClick={() => onLevel(1)}>
            Read the explainer <span aria-hidden>↓</span>
          </button>
        )}

        {level > 0 && (
          <div className="entry-more">
            {entry.rest && <Html as="p" className="entry-body" md={entry.rest} />}
            {entry.rule && (
              <aside className="thumb">
                <div className="thumb-label">Rule of thumb</div>
                <Html as="p" md={entry.rule} />
              </aside>
            )}
            <div className="entry-actions">
              <span className="entry-status">Back for recall tomorrow</span>
              <button className="text-button" onClick={() => onLevel(0)}>
                Collapse
              </button>
              {primary && (
                <button className="disclose push" aria-expanded={level === 2} onClick={() => onLevel(level === 2 ? 1 : 2)}>
                  {level === 2 ? "Hide the exchange ↑" : "Show the exchange ↓"}
                </button>
              )}
            </div>
          </div>
        )}

        {level === 2 && primary && (
          <section className="source">
            <h4 className="label">The exchange that started it</h4>
            <Exchange c={primary} />
            <div className="why">
              <span>
                Why it surfaced · <b>score {primary.score}</b>
              </span>
              {primary.signals.map((s) => (
                <span key={s.name} className={"signal" + (s.side === "user" ? " user" : "") + (s.weight < 0 ? " neg" : "")}>
                  {s.name} {signed(s.weight)}
                </span>
              ))}
            </div>
            {others.length > 0 && (
              <p className="also">
                Also drawn from {others.length === 1 ? "1 more exchange" : `${others.length} more exchanges`}:{" "}
                {others.map((o) => `“${leadOf(o).text}”`).join(", ")}
              </p>
            )}
            <button className="link" onClick={() => onNavigate("signals", primary.id)}>
              Open in Signal Explorer →
            </button>
          </section>
        )}
      </div>
    </article>
  );
}

function Facts({ view }: { view: BriefView }) {
  const since = new Date(view.since + "T00:00");
  return (
    <div className="facts">
      <span>
        Window <b>since {since.toLocaleDateString([], { month: "short", day: "numeric" })}</b>
      </span>
      <span>
        <b>{view.tools}</b>
      </span>
      <span>
        <b>{view.sessions}</b> sessions
      </span>
      <span>
        <b>{view.pairs}</b> pairs
      </span>
      <span>
        <b>{view.candidateCount}</b> candidates
      </span>
      <span>
        written by <b>{view.inferenceCli ?? "recap"}</b>
        {view.generatedAt ? ` at ${view.generatedAt}` : ""}
      </span>
    </div>
  );
}

function Done({ view, onBack, onNavigate }: { view: BriefView; onBack: () => void; onNavigate: Navigate }) {
  const entries = view.entries;
  const date = new Date(view.date + "T00:00");
  const today = (date.getDay() + 6) % 7;
  const minutes = readMinutes(entries);
  return (
    <div className="sheet">
      <div className="kicker">
        Daily brief · {date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
      </div>
      <h1 className="display">That's today's brief.</h1>
      <p className="dek">
        {count(entries.length, "concept", true)}, about {count(minutes, "minute")} of reading. Each one comes back tomorrow as a single recall
        question. Nothing else to do today.
      </p>
      <ol className="recap-list">
        {entries.map((e, i) => (
          <li key={e.title}>
            <span className="entry-num">{String(i + 1).padStart(2, "0")}</span>
            <Html className="recap-title" md={e.title} />
            <span className="recap-when">review tomorrow</span>
          </li>
        ))}
      </ol>
      <div className="label week-label">This week</div>
      <div className="week">
        {DAYS.map((d, i) => (
          <div key={d} className={i === today ? "on" : i > today ? "ahead" : ""}>
            {d}
            <b>{i === today ? entries.length : "·"}</b>
          </div>
        ))}
      </div>
      <p className="quiet-note">
        {count(entries.length, "concept", true)} this week. Skipped days don't count against you.
      </p>
      <div className="fleuron" aria-hidden>
        ❧
      </div>
      <div className="closing">
        <button className="button" onClick={onBack}>
          Back to the brief
        </button>
        <button className="link" onClick={() => onNavigate("library")}>
          Kept in your Concept Library →
        </button>
      </div>
    </div>
  );
}

/** The spec's progress panel: phase, elapsed, and Cancel, replacing the card
 *  list while a generation runs. Degrades to an indeterminate phase when the
 *  engine sends no events (an older sidecar). */
function Generating({
  phase,
  elapsed,
  onCancel,
}: {
  phase: PhaseEvent | null;
  elapsed: number;
  onCancel: () => void;
}) {
  const secs = Math.floor(elapsed / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const line =
    phase === null
      ? "Running today's recap…"
      : phase.event === "scan_done"
        ? `Scanned ${phase.sessions ?? "?"} sessions — picking what to learn from ${phase.candidates ?? "?"} candidates…`
        : `Writing with ${phase.cli ?? "the inference CLI"}…`;
  return (
    <div className="sheet gen-sheet">
      <div className="kicker">Daily brief · generation</div>
      <div className="gen-phase">
        <span className="gen-dot" aria-hidden />
        {line}
      </div>
      <div className="gen-elapsed">
        <b>{clock}</b> elapsed
        {phase?.timeout_s ? ` · timeout ${phase.timeout_s}s` : ""}
      </div>
      <button className="button" onClick={onCancel}>
        Cancel
      </button>
      <p className="quiet-note">
        The engine is reading the scanned window and asking the inference CLI to
        write it up. Cancelling stops the whole process tree.
      </p>
    </div>
  );
}

/** The spec's error-state table, one card per row. */
function ErrorCard({ error, loadError, onRetry, onDismiss }: { error: GenerationError; loadError: boolean; onRetry: () => void; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const recourse =
    loadError
      ? "Try loading the brief again."
      : error.kind === "no-cli"
      ? "Install a CLI, or set a custom path in Settings."
      : error.kind === "timeout"
        ? "Raise the timeout in Settings and retry."
        : "Retry, or widen the window and rescan.";
  return (
    <div className="sheet gen-sheet">
      <div className="kicker">Daily brief · {loadError ? "loading" : "generation"}</div>
      <h1 className="display">{error.title}</h1>
      <p className="dek">{recourse}</p>
      {error.detail && (
        <>
          <button className="text-button" onClick={() => setOpen(!open)}>
            {open ? "Hide the raw output ↑" : "Show the raw output ↓"}
          </button>
          {open && <pre className="error-detail">{error.detail}</pre>}
        </>
      )}
      <div className="closing">
        <button className="button primary" onClick={onRetry}>
          Retry
        </button>
        <button className="button" onClick={onDismiss}>
          Back
        </button>
      </div>
    </div>
  );
}

function ScanningSheet() {
  return (
    <div className="folio-scroll">
      <div className="sheet gen-sheet">
        <div className="kicker">Daily brief</div>
        <div className="gen-phase">
          <span className="gen-dot" aria-hidden />
          Scanning sessions…
        </div>
      </div>
    </div>
  );
}

export default function DailyBrief({ store, onNavigate }: { store: StoreState | null; onNavigate: Navigate }) {
  const { status, view, error, loadError, phase, elapsed, detection, generate, cancel, dismissError } = useBrief(store);
  const [levels, setLevels] = useState<Level[]>([]);
  const [done, setDone] = useState(false);

  if (status === "loading") {
    return <ScanningSheet />;
  }

  if (status === "generating") {
    return (
      <div className="folio-scroll">
        <Generating phase={phase} elapsed={elapsed} onCancel={cancel} />
      </div>
    );
  }

  if (status === "error" && error) {
    return (
      <div className="folio-scroll">
        <ErrorCard error={error} loadError={loadError} onRetry={loadError ? dismissError : generate} onDismiss={dismissError} />
      </div>
    );
  }

  if (status === "empty") {
    return (
      <div className="folio-scroll">
        <div className="sheet gen-sheet">
          <div className="kicker">Daily brief</div>
          <h1 className="display">Nothing to recap.</h1>
          <p className="dek">
            Nothing in the last day's sessions — your recap would be empty. That's
            correct behavior, not a bug.
          </p>
          <p className="quiet-note">
            Widen the window (for example three days) and scan again from the
            Signal Explorer.
          </p>
        </div>
      </div>
    );
  }

  if (status === "cta" && store) {
    const noCli = detection !== null && detection.cli === null;
    return (
      <div className="folio-scroll">
        <div className="sheet gen-sheet">
          <div className="kicker">Daily brief · {new Date().toLocaleDateString([], { weekday: "long" })}</div>
          <h1 className="display">Today's brief isn't written yet.</h1>
          <p className="dek">
            {count(store.windowCandidates, "candidate", true)} from the last day's
            sessions are ready to learn from. Writing the brief takes a few
            minutes of the inference CLI's time.
          </p>
          <Facts
            view={{
              date: "",
              entries: [],
              since: store.since,
              tools: store.tools.join(" + "),
              sessions: store.sessions,
              pairs: store.pairs,
              candidateCount: store.windowCandidates,
              inferenceCli: null,
              generatedAt: null,
              candidatesById: new Map(),
            }}
          />
          {noCli ? (
            <>
              <h1 className="display cta-block">Generation needs the claude, codex or pi CLI.</h1>
              <p className="dek">Scanning and the Signal Explorer still work. Install a CLI, or set a custom path in Settings.</p>
            </>
          ) : (
            <div className="closing">
              <button className="button primary" onClick={generate}>
                Write today's brief
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!view) {
    return <ScanningSheet />;
  }

  const entries = view.entries;
  const belowCut = Math.max(0, view.candidateCount - new Set(entries.flatMap((e) => e.sources)).size);

  if (done) {
    return (
      <div className="folio-scroll">
        <Done view={view} onBack={() => setDone(false)} onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div className="folio-scroll">
      <div className="sheet">
        <div className="kicker">{new Date(view.date + "T00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} · Your daily brief</div>
        <h1 className="display">Follow your curiosity.</h1>
        <p className="dek">
          {count(entries.length, "idea", true)} from the last day's sessions, ranked by how much they looked like learning. About{" "}
          {count(readMinutes(entries), "minute")}, then you're done.
        </p>
        <div className="brief-head">
          {store?.source === "live" && (
            <button className="text-button" onClick={generate}>
              Rewrite today's brief
            </button>
          )}
        </div>

        <div className="brief-layout"><div className="brief-entries">
        {entries.map((e, i) => (
          <Entry
            key={e.title}
            entry={e}
            index={i}
            level={levels[i] ?? 0}
            byId={view.candidatesById}
            onNavigate={onNavigate}
            onLevel={(l) =>
              setLevels((prev) => {
                const next = [...prev];
                while (next.length <= i) next.push(0);
                next[i] = l;
                return next;
              })
            }
          />
        ))}

        <div className="brief-end">
          {belowCut > 0 && (
            <p className="quiet-note">
              {count(belowCut, "more candidate", true)} from today scored below the cut.{" "}
              <button className="link" onClick={() => onNavigate("signals")}>
                More from today in the Explorer →
              </button>
            </p>
          )}
          <button className="button primary" onClick={() => setDone(true)}>
            I'm done for today
          </button>
        </div>
        </div><aside className="brief-aside">
          <div className="practice-card"><div className="kicker">Your next small step</div><h2>Remember the idea, not just the answer.</h2><p>Try a short recall question when you're ready.</p><button className="button primary" onClick={() => onNavigate("review")}>Start practice →</button></div>
          <div className="brief-facts-card"><div className="kicker">Behind this brief</div><Facts view={view} /></div>
        </aside></div>
      </div>
    </div>
  );
}
