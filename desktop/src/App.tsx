import { useState } from "react";
import DailyBrief from "./screens/DailyBrief";
import SignalExplorer from "./screens/SignalExplorer";
import ConceptLibrary from "./screens/ConceptLibrary";
import Review from "./screens/Review";

type Screen = "brief" | "library" | "signals" | "review";

const NAV: { id: Screen; label: string }[] = [
  { id: "brief", label: "Daily Brief" },
  { id: "library", label: "Concept Library" },
  { id: "signals", label: "Signal Explorer" },
  { id: "review", label: "Review" },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("brief");

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="wordmark">
          recap<span className="wordmark-tag">desktop</span>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={screen === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setScreen(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">running on committed fixtures</div>
      </aside>
      <main className="content">
        {screen === "brief" && <DailyBrief />}
        {screen === "library" && <ConceptLibrary />}
        {screen === "signals" && <SignalExplorer />}
        {screen === "review" && <Review />}
      </main>
    </div>
  );
}
