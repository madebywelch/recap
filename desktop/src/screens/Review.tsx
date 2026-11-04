import Exchange from "../Exchange";
import { Html } from "../md";
import { count } from "../brief";
import { dueInWords } from "../review";
import { useReview } from "../useReview";
import type { Navigate } from "../App";
import type { StoreState } from "../store";

/**
 * The spec's Review screen: active recall over what's due. A session
 * pulls at most ten concepts, oldest due first, shows only the concept's
 * name until the answer is revealed, and ends in a real done-state with
 * gentle progress — no streaks, nothing to feel guilty about skipping.
 */
export default function Review({ store, onNavigate }: { store: StoreState | null; onNavigate: Navigate }) {
  const { queue, overview, current, done, index, revealed, expanded, sources, reschedule, tally, reveal, expand, grade, today } =
    useReview(store);

  if (store && store.source === "fixture") {
    return (
      <div className="folio-scroll">
        <div className="sheet review-sheet">
          <div className="kicker">Review</div>
          <p className="dek">Review needs the app's store — outside the shell there is nothing to grade.</p>
        </div>
      </div>
    );
  }

  if (!queue) {
    return (
      <div className="folio-scroll">
        <div className="sheet review-sheet">
          <div className="kicker">Review</div>
          <p className="dek">Reading what's due…</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="folio-scroll">
        <div className="sheet review-sheet">
          <div className="kicker">Review · done</div>
          <h1 className="display">That's everything due.</h1>
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
        <div className="sheet review-sheet">
          <div className="kicker">Review</div>
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
      <div className="sheet review-sheet">
        <div className="kicker">
          Review · {index + 1} of {queue.length}
        </div>
        <h1 className="display">
          <Html md={current.title} />
        </h1>
        <p className="review-prompt">Say what this is and how it works, out loud or in your head.</p>

        {reschedule ? (
          <p className="review-confirm" role="status">
            <span className="gen-dot" aria-hidden />
            {reschedule}
          </p>
        ) : revealed ? (
          <>
            <p className="entry-what reader-body">
              <Html md={current.body} />
            </p>
            {current.sourceIds === null ? (
              <p className="quiet-note">This concept came from a pre-app archive — the exchange behind it wasn't recorded.</p>
            ) : sources === null ? (
              <p className="quiet-note">Reading the archive…</p>
            ) : (
              <button className="disclose" aria-expanded={expanded} onClick={() => (expanded ? undefined : expand())}>
                {expanded ? "Hide the exchange ↑" : "Show the exchange ↓"}
              </button>
            )}
            {expanded && sources && sources.length > 0 && (
              <section className="source">
                <h4 className="label">The exchange that started it</h4>
                <Exchange c={sources[0]} />
              </section>
            )}
            <div className="grade-row">
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
          </>
        ) : (
          <div className="closing">
            <button className="button primary" onClick={reveal}>
              Show answer <span className="kbd">Space</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
