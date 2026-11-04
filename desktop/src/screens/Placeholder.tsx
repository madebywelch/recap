interface PlaceholderProps {
  title: string;
  blurb: string;
  intent: string;
}

/** Shared shell for screens that exist in the nav but aren't built yet. */
export default function Placeholder({ title, blurb, intent }: PlaceholderProps) {
  return (
    <div className="screen">
      <header className="screen-header">
        <h1>{title}</h1>
        <p>{blurb}</p>
      </header>
      <div className="placeholder">
        <h2>Not built yet</h2>
        <p>{intent}</p>
        <p>
          The shell and the fixture data this screen will eventually read are
          already in place — see desktop/README.md for the wiring plan.
        </p>
      </div>
    </div>
  );
}
