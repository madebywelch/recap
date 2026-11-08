import { clock } from "./brief";
import { toolLabel, type Candidate } from "./fixtures";

/** The redacted exchange behind a concept or candidate, as the Brief's
 *  source level and the Explorer's detail sheet both show it. */
export default function Exchange({ c }: { c: Candidate }) {
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
        <div className="turn-who">{toolLabel(c.tool)}</div>
        <pre>{c.assistantExcerpt}</pre>
      </div>
    </div>
  );
}
