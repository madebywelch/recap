import { useState } from "react";
import briefSource from "../../fixtures/daily-brief.md?raw";
import Exchange from "../Exchange";
import { Html } from "../md";
import { brief, toolLabel } from "../fixtures";
import { localDate, parseEntries, project } from "../brief";
import { dueText, firstSentence } from "../library-filters";
import { useLibrary } from "../useLibrary";
import type { Concept, StoreState } from "../store";
import type { Candidate } from "../fixtures";
import type { Navigate } from "../App";
import "./concept-library.css";

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

function SourceMetadata({ candidates }: { candidates: Candidate[] }) {
  const labels = [...new Set(candidates.flatMap((candidate) => [toolLabel(candidate.tool), ...(candidate.cwd ? [project(candidate)] : [])]))];
  return labels.map((label) => <span key={label}>{label}</span>);
}

/** The reader for one concept: full explainer at reading measure, the
 *  review status with its add/remove action, then the source exchange. */
function Reader({
  concept,
  sources,
  onBack,
  onAdd,
  onRemove,
  sourceError,
  reviewError,
  reviewPending,
  onRetrySources,
}: {
  concept: Concept;
  sources: Candidate[] | null;
  onBack: () => void;
  onAdd: (c: Concept) => void;
  onRemove: (c: Concept) => void;
  sourceError: string | null;
  reviewError: string | null;
  reviewPending: boolean;
  onRetrySources: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="folio-scroll concept-library">
      <div className="sheet concept-sheet">
        <button className="text-button" onClick={onBack}>
          ← Back to the library
        </button>
        <div className="concept-reader-layout">
        <article className="concept-reader-card">
        <div className="kicker">Concept Library · {dayLabel(concept.date)}</div>
        <h1 className="display">
          <Html md={concept.title} />
        </h1>
        <p className="entry-what reader-body">
          <Html md={concept.body} />
        </p>
        </article>
        <aside className="concept-reader-aside">
        <section className="concept-review-card">
        <div className="kicker">Review</div>
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
            <button className="button" disabled={reviewPending} onClick={() => onRemove(concept)}>
              Remove from review
            </button>
          ) : (
            <button className="button primary" disabled={reviewPending} onClick={() => onAdd(concept)}>
              Add to review
            </button>
          )}
        </div>
        {reviewPending && <p className="quiet-note" role="status">Updating review…</p>}
        {reviewError && <p className="quiet-note" role="alert">{reviewError}</p>}
        </section>
        </aside>

        <section className="concept-source-card">
        <div className="kicker">From your conversations</div>
        {concept.sourceIds === null ? (
          <p className="quiet-note">
            The conversation behind this concept wasn't saved.
          </p>
        ) : sourceError ? (
          <p className="quiet-note" role="alert">{sourceError} <button className="link" onClick={onRetrySources}>Try again</button></p>
        ) : sources === null ? (
          <p className="quiet-note">Reading the archive…</p>
        ) : sources.length === 0 ? (
          <p className="quiet-note">The conversations behind this concept are no longer available.</p>
        ) : (
          <>
            <button className="disclose" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Hide the exchange ↑" : "Show the exchange ↓"}
            </button>
            {open && (
              <div className="concept-sources">
              {sources.map((source) => <section className="source" key={source.id}>
                <h4 className="label">The exchange that started it</h4>
                <Exchange c={source} />
              </section>)}
              </div>
            )}
          </>
        )}
        </section>
        </div>
      </div>
    </div>
  );
}

/** The browser build has no store; the shelf shows the fixture brief as a
 *  designed preview, honestly labeled. */
function FixtureShelf({ store }: { store: StoreState }) {
  const entries = parseEntries(briefSource);
  const date = new Date(brief.meta.generatedAt.replace(" ", "T"));
  return (
    <div className="folio-scroll concept-library">
      <div className="sheet concept-sheet">
        <div className="kicker">Concept Library</div>
        <h1 className="display">Everything you've learned, kept.</h1>
        <p className="dek">
          Every concept from every brief lands here, searchable and grouped by day. Open one and it reads like the brief
          did: the explainer first, then the exchange that produced it.
        </p>
        <div className="shelf">
          <div className="shelf-head">
            <span className="label">{date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>
            <span className="shelf-note">Example concepts</span>
          </div>
          {entries.map((e) => (
            <div key={e.title} className="shelf-row">
              <span className="shelf-title">
                <Html md={e.title} />
              </span>
              <span className="shelf-lede">
                <Html md={firstSentence(e.body.trim().replace(/\s+/g, " "))} />
              </span>
              <span className="shelf-meta">
                <span>{date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>
                <SourceMetadata candidates={store.candidates.filter((candidate) => e.sources.includes(candidate.id))} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ConceptLibrary({ store }: { store: StoreState | null; onNavigate: Navigate }) {
  const { concepts, query, setQuery, groups, selected, sources, loading, loadError, sourceError, reviewError, reviewPending, retry, retrySources, open, close, addReview, removeReview } =
    useLibrary(store);

  if (store?.source === "fixture") return <FixtureShelf store={store} />;

  if (selected) {
    return (
      <Reader
        concept={selected}
        sources={sources}
        onBack={close}
        onAdd={addReview}
        onRemove={removeReview}
        sourceError={sourceError}
        reviewError={reviewError}
        reviewPending={reviewPending}
        onRetrySources={retrySources}
      />
    );
  }

  if (!store) {
    return (
      <div className="folio-scroll concept-library">
        <div className="sheet concept-sheet">
          <div className="kicker">Concept Library</div>
          <p className="dek">Reading the library…</p>
        </div>
      </div>
    );
  }

  const total = groups.reduce((n, g) => n + g.concepts.length, 0);
  return (
    <div className="folio-scroll concept-library">
      <div className="sheet concept-sheet">
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
        {loading && <p className="quiet-note" role="status">Reading the library…</p>}
        {loadError && <p className="quiet-note" role="alert">{loadError} <button className="link" onClick={retry}>Try again</button></p>}
        {concepts && !loading && !loadError && <>
        <p className="library-count">
          {query.trim()
            ? `${total === 1 ? "One match" : `${total} matches`} for “${query.trim()}”`
            : total === 1
              ? "One concept so far"
              : `${total} concepts so far`}
        </p>

        {groups.length === 0 && (
          <p className="quiet-note">
            {query.trim() ? "No concepts match this search. Try a different search." :
              "Nothing here yet. Create a brief to start your library."}
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
                  <Html md={firstSentence(c.body.trim().replace(/\s+/g, " "))} />
                </span>
                <span className="shelf-meta">
                  <span>{dayLabel(c.date)}</span>
                  {c.review && <span className="tag">{dueText(c.review.dueOn, localDate(new Date()))}</span>}
                  <SourceMetadata candidates={store.candidates.filter((candidate) => c.sourceIds?.includes(candidate.id))} />
                </span>
              </div>
            ))}
          </div>
        ))}
        </>}
      </div>
    </div>
  );
}
