import { brief } from "../fixtures";

export default function DailyBrief() {
  const { meta } = brief;
  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Daily Brief</h1>
        <div className="meta-row">
          <span className="meta-chip">generated {meta.generatedAt}</span>
          <span className="meta-chip">since {meta.since}</span>
          <span className="meta-chip">tools: {meta.tools}</span>
          <span className="meta-chip">{meta.sessions} sessions</span>
          <span className="meta-chip">{meta.pairs} pairs</span>
          <span className="meta-chip">{meta.candidates} candidates</span>
          <span className="meta-chip">inference: {meta.inference}</span>
        </div>
      </header>
      <div
        className="markdown brief-body"
        dangerouslySetInnerHTML={{ __html: brief.html }}
      />
    </div>
  );
}
