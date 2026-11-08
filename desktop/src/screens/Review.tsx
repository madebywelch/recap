import Exchange from "../Exchange";
import { Html } from "../md";
import { count } from "../brief";
import { dueInWords } from "../review";
import { useReview } from "../useReview";
import type { Navigate } from "../App";
import type { StoreState } from "../store";
import "./review.css";

/**
 * The spec's Review screen: active recall over what's due. A session
 * pulls at most ten concepts, oldest due first, shows only the concept's
 * name until the answer is revealed, and ends in a real done-state with
 * gentle progress — no streaks, nothing to feel guilty about skipping.
 */
export default function Review({ store, onNavigate }: { store: StoreState | null; onNavigate: Navigate }) {
  const { queue, overview, current, done, index, revealed, expanded, sources, sourceLoading, sourceError, loadError, gradeError, refresh, reschedule, tally, reveal, expand, grade, today } =
    useReview(store);

  if (store && store.source === "fixture") {
    return (
      <div className="folio-scroll">
        <div className="sheet review-sheet studio-review-state">
          <div className="kicker">Make it stick · Review</div>
          <p className="dek">Open the app to review your concepts.</p>
        </div>
      </div>
    );
  }

  if (loadError && !queue) {
    return (
      <div className="folio-scroll">
        <div className="sheet review-sheet studio-review-state">
          <div className="kicker">Make it stick · Review</div>
          <p className="dek" role="alert">Couldn't load your review list.</p>
          <button className="button" onClick={() => void refresh()}>Try again</button>
        </div>
      </div>
    );
  }

  if (!queue) {
    return (
      <div className="folio-scroll">
        <div className="sheet review-sheet studio-review-state">
          <div className="kicker">Review</div>
          <p className="dek">Reading what's due…</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="folio-scroll">
        <div className="sheet review-sheet studio-review-state">
          <div className="kicker">Make it stick · Review complete</div>
          <h1 className="display">That's everything due.</h1>
          {loadError && <p role="alert">Couldn't refresh your next check-in and weekly progress.</p>}
          <p className="dek">
            {count(tally.kept, "concept", true)} kept
            {tally.fuzzy > 0 ? `, ${count(tally.fuzzy, "fuzzy one", true)}` : ""}
            {tally.lost > 0 ? `, ${count(tally.lost, "lost one", true)} — they're back tomorrow` : ""}.
            {overview?.next
              ? ` Next check-in ${dueInWords(overview.next.on, today)}`
              : " Next check-in: the first concept you add"}
            .
          </p>
          <div className="review-week">
            <span className="label">This week</span>
            <p className="review-week-row">
              {overview ? count(overview.learnedThisWeek, "concept", true) : "No concepts"} learned
              {overview && overview.learnedThisWeek > 0 ? " — kept when they came back" : " yet this week"}.
            </p>
          </div>
          <p className="quiet-note">
            No streaks and no reminders. Skip a day and the due list just waits for you.
          </p>
          <div className="closing">
            <button className="button" onClick={() => onNavigate("brief")}>
              Back to today's brief
            </button>
          </div>
          <div className="fleuron" aria-hidden>
            ❧
          </div>
        </div>
      </div>
    );
  }

  if (!current) {
    const next = overview?.next;
    const noneAtAll = (overview?.inReview ?? 0) === 0;
    return (
      <div className="folio-scroll">
        <div className="sheet review-sheet studio-review-state">
          <div className="kicker">Make it stick · Review</div>
          <h1 className="display">{noneAtAll ? "Nothing is in review yet." : "Nothing due today."}</h1>
          <p className="dek">
            {noneAtAll
              ? "Write a brief and its concepts enter review automatically, due tomorrow — or add any Library concept by hand."
              : next
                ? `Next: ${count(next.count, "concept", true)} ${dueInWords(next.on, today) === "tomorrow" ? "tomorrow" : `on ${new Date(next.on + "T00:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}`}.`
                : "The due list is empty."}
          </p>
          <ol className="steps">
            <li>
              <span className="step-num">1</span>
              <b>Recall</b>
              <span>You see only the concept's name. Say what it is and how it works, out loud or in your head.</span>
            </li>
            <li>
              <span className="step-num">2</span>
              <b>Reveal</b>
              <span>The explainer opens, and the exchange it came from is one more click away.</span>
            </li>
            <li>
              <span className="step-num">3</span>
              <b>Grade</b>
              <span>Got it, Fuzzy, or Lost it. Kept concepts come back less often; lost ones return tomorrow.</span>
            </li>
          </ol>
          <p className="quiet-note">No streaks and no reminders. Skip a day and the due list just waits for you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="folio-scroll">
      <div className="sheet studio-review">
        <header className="studio-review-header">
          <div className="kicker">Make it stick</div>
          <h1>Let's think it through.</h1>
          <p>One concept at a time, from ideas you encountered.</p>
        </header>
        <div className="studio-review-layout">
          <main className="studio-review-stage">
            <div className="kicker">Practice · {index + 1} / {queue.length}</div>
            <div className="studio-review-progress" role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={index + 1}>
              <span style={{ width: `${((index + 1) / queue.length) * 100}%` }} />
            </div>
            <h2><Html md={current.title} /></h2>
            <p className="studio-review-prompt">Say what this is and how it works, out loud or in your head.</p>

        {reschedule ? (
          <p className="review-confirm" role="status">
            <span className="gen-dot" aria-hidden />
            {reschedule}
          </p>
        ) : revealed ? (
          <>
            <div className="studio-review-answer">
              <div className="kicker">The explainer</div>
              <p className="entry-what reader-body">
                <Html md={current.body} />
              </p>
            </div>
            {current.sourceIds === null ? (
              <p className="quiet-note">The conversation behind this concept wasn't saved.</p>
            ) : (
              <button className="disclose" aria-expanded={expanded} onClick={() => expand()}>
                {expanded ? "Hide the exchange ↑" : "Show the exchange ↓"}
              </button>
            )}
            {expanded && sourceLoading && <p className="quiet-note" role="status">Reading the archive…</p>}
            {expanded && sourceError && <p role="alert">Couldn't load the exchange. <button className="disclose" onClick={() => expand(true)}>Try again</button></p>}
            {expanded && sources && sources.length === 0 && <p className="quiet-note">No exchange was found in the archive.</p>}
            {expanded && sources && sources.length > 0 && (
              <section className="source">
                <h4 className="label">The exchanges that started it</h4>
                {sources.map((source) => (
                  <div key={source.id} className="studio-review-source">
                    <Exchange c={source} />
                  </div>
                ))}
              </section>
            )}
            <p className="studio-review-grade-prompt">How well did you remember?</p>
            <div className="grade-row" aria-label="Grade your recall">
              <button className="button primary" onClick={() => grade("got-it")}>
                Got it <span className="kbd">1</span>
              </button>
              <button className="button" onClick={() => grade("fuzzy")}>
                Fuzzy <span className="kbd">2</span>
              </button>
              <button className="button" onClick={() => grade("lost-it")}>
                Lost it <span className="kbd">3</span>
              </button>
            </div>
            {gradeError && <p role="alert">Couldn't save your grade. Please try again.</p>}
          </>
        ) : (
          <div className="closing studio-review-action">
            <span>Recall first, then check your thinking.</span>
            <button className="button primary" onClick={reveal}>
              Show answer <span className="kbd">Space</span>
            </button>
          </div>
        )}
          </main>
          <aside className="studio-review-aside">
            <div className="studio-review-panel">
              <div className="kicker">Your practice</div>
              <h2>{count(queue.length, "concept", true)} to revisit.</h2>
              <p>A manageable check-in, one idea at a time.</p>
              <ol>
                {queue.map((concept, i) => (
                  <li key={concept.id} aria-current={i === index ? "step" : undefined}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <Html md={concept.title} />
                  </li>
                ))}
              </ol>
            </div>
            <div className="studio-review-tip">
              <div className="kicker">Remember, then revisit</div>
              <p>Trying to recall before seeing the answer makes the moment an active one.</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
