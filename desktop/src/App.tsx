import { useEffect, useState } from "react";
import DailyBrief from "./screens/DailyBrief";
import SignalExplorer from "./screens/SignalExplorer";
import ConceptLibrary from "./screens/ConceptLibrary";
import Review from "./screens/Review";
import { initStore, type StoreState } from "./store";

export type Screen = "brief" | "library" | "signals" | "review";

/** Switch screens; a candidate id opens the Explorer on that candidate. */
export type Navigate = (to: Screen, candidateId?: string) => void;

const NAV: { id: Screen; label: string }[] = [
  { id: "brief", label: "Daily Brief" },
  { id: "library", label: "Concept Library" },
  { id: "signals", label: "Signal Explorer" },
  { id: "review", label: "Review" },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("brief");
  const [store, setStore] = useState<StoreState | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const go: Navigate = (to, candidateId) => {
    setScreen(to);
    setFocus(candidateId ?? null);
  };

  // The spec's launch flow: scan on open so the Explorer (and the store)
  // reflect this machine's sessions, falling back to the fixture.
  useEffect(() => {
    let cancelled = false;
    initStore().then((state) => {
      if (!cancelled) setStore(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <div className="titlebar" data-tauri-drag-region />
      <aside className="sidebar">
        <div className="wordmark">
          recap<span className="wordmark-tag">desktop</span>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={screen === item.id ? "nav-item active" : "nav-item"}
              onClick={() => go(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {store
            ? store.source === "live"
              ? "live · engine sidecar"
              : "fixture data"
            : "scanning…"}
        </div>
      </aside>
      <main className="content">
        {screen === "brief" && <DailyBrief onNavigate={go} />}
        {screen === "library" && <ConceptLibrary onNavigate={go} />}
        {screen === "signals" && <SignalExplorer store={store} focus={focus} onNavigate={go} />}
        {screen === "review" && <Review />}
      </main>
    </div>
  );
}
