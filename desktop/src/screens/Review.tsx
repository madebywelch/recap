import briefSource from "../../fixtures/daily-brief.md?raw";
import { count, parseEntries } from "../brief";

const due = parseEntries(briefSource).length;

/** Designed empty state: today's concepts are seeded into review for
 * tomorrow, so nothing is due on the day they were learned. */
export default function Review() {
  return (
    <div className="folio-scroll">
      <div className="sheet review-sheet">
        <div className="kicker">Review</div>
        <h1 className="display">Nothing due today.</h1>
        <p className="dek">
          Next: {count(due, "concept")} tomorrow, from today's brief. A session is bounded, ten at most, and
          ends when the due list does.
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
