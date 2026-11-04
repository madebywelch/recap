import briefSource from "../../fixtures/daily-brief.md?raw";
import { brief } from "../fixtures";
import { inline, parseEntries } from "../brief";

const entries = parseEntries(briefSource);

/** Designed first-run state: the reader and search arrive with M4, so the
 * shelf shows what today's brief will add rather than an empty box. */
export default function ConceptLibrary() {
  const date = new Date(brief.meta.generatedAt.replace(" ", "T"));
  return (
    <div className="folio-scroll">
      <div className="sheet">
        <div className="kicker">Concept Library</div>
        <h1 className="display">Everything you've learned, kept.</h1>
        <p className="dek">
          Every concept from every brief lands here, searchable and grouped by day. Open one and it reads like the brief did:
          the explainer first, then the exchange that produced it.
        </p>
        <div className="shelf">
          <div className="shelf-head">
            <span className="label">{date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>
            <span className="shelf-note">first entries, from today's brief</span>
          </div>
          {entries.map((e) => (
            <div key={e.title} className="shelf-row">
              <span className="shelf-title" dangerouslySetInnerHTML={{ __html: inline(e.title) }} />
              <span className="shelf-lede" dangerouslySetInnerHTML={{ __html: inline(e.lede) }} />
            </div>
          ))}
        </div>
        <p className="quiet-note">
          Older recaps in your archive folder are imported on first run, so months of CLI history show up here too. Search and
          the reader come with the Library milestone.
        </p>
      </div>
    </div>
  );
}
