import { useState } from "react";
import briefSource from "../../fixtures/daily-brief.md?raw";
import Exchange from "../Exchange";
import { Html } from "../md";
import { brief } from "../fixtures";
import { localDate, parseEntries, leadOf, signed } from "../brief";
import { dueText, firstSentence } from "../library-filters";
import { useLibrary } from "../useLibrary";
import type { Concept, StoreState } from "../store";
import type { Candidate } from "../fixtures";
import type { Navigate } from "../App";

/**
 * The spec's Concept Library: FTS search over everything learned so far, a
 * date-grouped list, and a reader that carries the same three levels as
 * the Brief — explainer first, then the exchange behind it. On first run
 * the store imports the recap-*.md archives from ~/.claude/morning-recap,
 * so months of CLI history show up immediately.
 */

function dayLabel(date: string): string {
  return new Date(date + "T00:00").toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** The reader for one concept: full explainer at reading measure, the
 *  review status with its add/remove action, then the source exchange. */
function Reader({
  concept,
  sources,
  inWindow,
  onNavigate,
  onBack,
  onAdd,
  onRemove,
}: {
  concept: Concept;
  sources: Candidate[] | null;
  inWindow: (id: string) => boolean;
  onNavigate: Navigate;
  onBack: () => void;
  onAdd: (c: Concept) => void;
  onRemove: (c: Concept) => void;
}) {
  const [open, setOpen] = useState(false);
  const [primary, ...others] = sources ?? [];
  return (
    <div className="folio-scroll">
      <div className="sheet">
        <button className="text-button" onClick={onBack}>
          ← Back to the library
        </button>
        <div className="kicker">Concept Library · {dayLabel(concept.date)}</div>
        <h1 className="display">
          <Html md={concept.title} />
        </h1>
        <p className="entry-what reader-body">
          <Html md={concept.body} />
        </p>
        <p className="reader-meta">
          {concept.review ? (
            <>
              In review — <b>{dueText(concept.review.dueOn, localDate(new Date()))}</b>
              {concept.review.reviews > 0
                ? ` · ${concept.review.reviews} check-in${concept.review.reviews === 1 ? "" : "s"}`
                : " · first check-in tomorrow"}
            </>
          ) : (
            "Not in review yet."
          )}
        </p>
        <div className="closing">
          {concept.review ? (
            <button className="button" onClick={() => onRemove(concept)}>
              Remove from review
            </button>
          ) : (
            <button className="button primary" onClick={() => onAdd(concept)}>
              Add to review
            </button>
          )}
        </div>

        {concept.sourceIds === null ? (
          <p className="quiet-note">
            This concept came from a pre-app archive — the exchange behind it wasn't recorded.
          </p>
        ) : sources === null ? (
          <p className="quiet-note">Reading the archive…</p>
        ) : sources.length === 0 ? (
          <p className="quiet-note">The exchanges behind this concept are no longer in the store.</p>
        ) : (
          <>
            <button className="disclose" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Hide the exchange ↑" : "Show the exchange ↓"}
            </button>
            {open && (
              <section className="source">
                <h4 className="label">The exchange that started it</h4>
                <Exchange c={primary} />
                <div className="why">
                  <span>
                    Why it surfaced · <b>score {primary.score}</b>
                  </span>
                  {primary.signals.map((s) => (
                    <span
                      key={s.name}
                      className={"signal" + (s.side === "user" ? " user" : "") + (s.weight < 0 ? " neg" : "")}
                    >
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
                {inWindow(primary.id) ? (
                  <button className="link" onClick={() => onNavigate("signals", primary.id)}>
                    Open in Signal Explorer →
                  </button>
                ) : (
                  <p className="quiet-note">From an earlier scan window — rescan that day to open it in the Explorer.</p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The browser build has no store; the shelf shows the fixture brief as a
 *  designed preview, honestly labeled. */
function FixtureShelf() {
  const entries = parseEntries(briefSource);
  const date = new Date(brief.meta.generatedAt.replace(" ", "T"));
  return (
    <div className="folio-scroll">
      <div className="sheet">
        <div className="kicker">Concept Library</div>
        <h1 className="display">Everything you've learned, kept.</h1>
        <p className="dek">
          Every concept from every brief lands here, searchable and grouped by day. Open one and it reads like the brief
          did: the explainer first, then the exchange that produced it.
        </p>
        <div className="shelf">
          <div className="shelf-head">
            <span className="label">{date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>
            <span className="shelf-note">fixture data — the library lives in the app</span>
          </div>
          {entries.map((e) => (
            <div key={e.title} className="shelf-row">
              <span className="shelf-title">
                <Html md={e.title} />
              </span>
              <span className="shelf-lede">
                <Html md={e.lede} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ConceptLibrary({ store, onNavigate }: { store: StoreState | null; onNavigate: Navigate }) {
  const { concepts, query, setQuery, groups, selected, sources, open, close, addReview, removeReview, inWindow } =
    useLibrary(store);

  if (store?.source === "fixture") return <FixtureShelf />;

  if (selected) {
    return (
      <Reader
        concept={selected}
        sources={sources}
        inWindow={inWindow}
        onNavigate={onNavigate}
        onBack={close}
        onAdd={addReview}
        onRemove={removeReview}
      />
    );
  }

  if (!concepts) {
    return (
      <div className="folio-scroll">
        <div className="sheet">
          <div className="kicker">Concept Library</div>
          <p className="dek">Reading the library…</p>
        </div>
      </div>
    );
  }

  const total = groups.reduce((n, g) => n + g.concepts.length, 0);
  return (
    <div className="folio-scroll">
      <div className="sheet">
        <div className="kicker">Concept Library</div>
        <h1 className="display">Everything you've learned, kept.</h1>
        <p className="dek">
          Every concept from every brief lands here, searchable and grouped by day. Open one and it reads like the brief
          did: the explainer first, then the exchange that produced it.
        </p>
        <label className="xsearch library-search">
          <span aria-hidden>⌕</span>
          <input
            type="search"
            placeholder="Search titles and explainers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <p className="library-count">
          {query.trim()
            ? `${total === 1 ? "One match" : `${total} matches`} for “${query.trim()}”`
            : total === 1
              ? "One concept so far"
              : `${total} concepts so far`}
        </p>

        {groups.length === 0 && (
          <p className="quiet-note">
            Nothing here yet. Write a brief, or drop recap-*.md archives into ~/.claude/morning-recap and relaunch —
            they're imported on open.
          </p>
        )}

        {groups.map((g) => (
          <div key={g.date} className="shelf">
            <div className="shelf-head">
              <span className="label">{dayLabel(g.date)}</span>
              <span className="shelf-note">
                {g.concepts.length === 1 ? "one concept" : `${g.concepts.length} concepts`}
              </span>
            </div>
            {g.concepts.map((c) => (
              <div
                key={c.id}
                className="shelf-row is-link"
                role="button"
                tabIndex={0}
                onClick={() => open(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") open(c);
                }}
              >
                <span className="shelf-title">
                  <Html md={c.title} />
                </span>
                <span className="shelf-lede">
                  <Html md={firstSentence(c.body)} />
                </span>
                {c.review && (
                  <span className="tag">{dueText(c.review.dueOn, localDate(new Date()))}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
