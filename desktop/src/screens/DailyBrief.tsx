import { useState } from "react";
import briefSource from "../../fixtures/daily-brief.md?raw";
import { brief, candidates, type Candidate } from "../fixtures";
import { clock, count, inline, leadOf, parseEntries, project, readMinutes, signed, type BriefEntry } from "../brief";

const entries = parseEntries(briefSource);
const byId = new Map(candidates.map((c) => [c.id, c]));
const sourced = new Set(entries.flatMap((e) => e.sources));
const belowCut = candidates.filter((c) => !sourced.has(c.id)).length;
const minutes = readMinutes(entries);

/** Disclosure depth of one card: collapsed, explainer, source exchange. */
type Level = 0 | 1 | 2;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function briefDate(): Date {
  return new Date(brief.meta.generatedAt.replace(" ", "T"));
}

function Html({ as: Tag = "span", md, className }: { as?: "span" | "p" | "h2" | "pre"; md: string; className?: string }) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: inline(md) }} />;
}

function Exchange({ c }: { c: Candidate }) {
  return (
    <div className="exchange-sheet">
      <div className="turn">
        <div className="turn-who">
          You
          <span>{clock(c.ts)}</span>
        </div>
        <pre>{c.userMessage}</pre>
      </div>
      <div className="turn">
        <div className="turn-who">{c.tool}</div>
        <pre>{c.assistantExcerpt}</pre>
      </div>
    </div>
  );
}

function Entry({ entry, index, level, onLevel }: { entry: BriefEntry; index: number; level: Level; onLevel: (l: Level) => void }) {
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
          </section>
        )}
      </div>
    </article>
  );
}

function Done({ onBack }: { onBack: () => void }) {
  const date = briefDate();
  const today = (date.getDay() + 6) % 7;
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
      </div>
    </div>
  );
}

export default function DailyBrief() {
  const [levels, setLevels] = useState<Level[]>(() => entries.map(() => 0));
  const [done, setDone] = useState(false);
  const { meta } = brief;
  const date = briefDate();

  if (done)
    return (
      <div className="folio-scroll">
        <Done onBack={() => setDone(false)} />
      </div>
    );

  return (
    <div className="folio-scroll">
      <div className="sheet">
        <div className="kicker">Daily brief · {date.toLocaleDateString([], { weekday: "long" })}</div>
        <h1 className="display">{date.toLocaleDateString([], { month: "long", day: "numeric" })}</h1>
        <p className="dek">
          {count(entries.length, "idea", true)} from yesterday's sessions, ranked by how much they looked like learning. About{" "}
          {count(minutes, "minute")}, then you're done.
        </p>
        <div className="facts">
          <span>
            Window <b>since {new Date(meta.since + "T00:00").toLocaleDateString([], { month: "short", day: "numeric" })}</b>
          </span>
          <span>
            <b>{meta.tools.replace("+", " + ")}</b>
          </span>
          <span>
            <b>{meta.sessions}</b> sessions
          </span>
          <span>
            <b>{meta.pairs}</b> pairs
          </span>
          <span>
            <b>{meta.candidates}</b> candidates
          </span>
          <span>
            written by <b>{meta.inference}</b> at {meta.generatedAt.split(" ")[1]}
          </span>
        </div>

        {entries.map((e, i) => (
          <Entry
            key={e.title}
            entry={e}
            index={i}
            level={levels[i]}
            onLevel={(l) => setLevels((prev) => prev.map((v, j) => (j === i ? l : v)))}
          />
        ))}

        <div className="brief-end">
          {belowCut > 0 && (
            <p className="quiet-note">
              {count(belowCut, "more candidate", true)} from today scored below the cut. They're in
              the Signal Explorer.
            </p>
          )}
          <button className="button primary" onClick={() => setDone(true)}>
            I'm done for today
          </button>
        </div>
      </div>
    </div>
  );
}
