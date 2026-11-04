import { useEffect, useState } from "react";
import DailyBrief from "./screens/DailyBrief";
import SignalExplorer from "./screens/SignalExplorer";
import ConceptLibrary from "./screens/ConceptLibrary";
import Review from "./screens/Review";
import SettingsScreen from "./screens/Settings";
import { initStore, type StoreState } from "./store";

type Screen = "brief" | "library" | "signals" | "review" | "settings";

const NAV: { id: Screen; label: string }[] = [
  { id: "brief", label: "Daily Brief" },
  { id: "library", label: "Concept Library" },
  { id: "signals", label: "Signal Explorer" },
  { id: "review", label: "Review" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("brief");
  const [store, setStore] = useState<StoreState | null>(null);

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
        <div className="sidebar-foot">
          {store
            ? store.source === "live"
              ? "live · engine sidecar"
              : "fixture data"
            : "scanning…"}
        </div>
      </aside>
      <main className="content">
        {screen === "brief" && <DailyBrief store={store} />}
        {screen === "library" && <ConceptLibrary />}
        {screen === "signals" && <SignalExplorer store={store} />}
        {screen === "review" && <Review />}
        {screen === "settings" && <SettingsScreen />}
      </main>
    </div>
  );
}
