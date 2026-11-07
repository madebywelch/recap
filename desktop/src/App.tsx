import { useEffect, useState } from "react";
import DailyBrief from "./screens/DailyBrief";
import SignalExplorer from "./screens/SignalExplorer";
import ConceptLibrary from "./screens/ConceptLibrary";
import Review from "./screens/Review";
import SettingsScreen from "./screens/Settings";
import FirstRun from "./screens/FirstRun";
import EngineRefusal from "./screens/EngineRefusal";
import { localDate } from "./brief";
import { initStore, loadDueOverview, onDueChanged, type StoreState } from "./store";
import type { SourcesResult } from "./fixtures";
import { detectInference, detectSources, getSettings, type Detection, type Settings } from "./generation";

export type Screen = "brief" | "library" | "signals" | "review" | "settings";

/** Switch screens; a candidate id opens the Explorer on that candidate. */
export type Navigate = (to: Screen, candidateId?: string) => void;

const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: "brief", label: "Daily Brief", icon: "◫" },
  { id: "library", label: "Concept Library", icon: "▦" },
  { id: "signals", label: "Signal Explorer", icon: "⌁" },
  { id: "review", label: "Review", icon: "◎" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

/** The welcome sheet's lifecycle: unknown until settings load, shown until
 *  dismissed (or outside the shell, where settings don't exist). */
type Welcome =
  | { phase: "pending" }
  | { phase: "show"; settings: Settings; detection: Detection | null; sources: SourcesResult | null }
  | { phase: "done" };

export default function App() {
  const [screen, setScreen] = useState<Screen>("brief");
  const [store, setStore] = useState<StoreState | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [dueCount, setDueCount] = useState(0);
  const [welcome, setWelcome] = useState<Welcome>({ phase: "pending" });
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

  // First run: once the store is up, show the welcome sheet until the
  // persisted onboarded flag says otherwise. Outside the shell the
  // settings command doesn't exist, so there is nothing to show.
  useEffect(() => {
    if (!store || store.refusal) return;
    let alive = true;
    (async () => {
      try {
        const settings = await getSettings();
        if (settings.onboarded || !alive) return;
        const [detection, sources] = await Promise.all([
          detectInference().catch(() => null),
          detectSources().catch(() => null),
        ]);
        if (alive) setWelcome({ phase: "show", settings, detection, sources });
      } catch {
        // browser build, or the shell never answered: no sheet
      }
    })();
    return () => {
      alive = false;
    };
  }, [store]);

  // The Review nav badge: whatever is due now. Seeding, grading, and
  // generation's auto-seed all move due dates, so the store tells us;
  // the count also refreshes once the launch scan has opened the db.
  useEffect(() => {
    if (!store) return;
    const refresh = () => {
      loadDueOverview(localDate(new Date()))
        .then((o) => setDueCount(o.due))
        .catch(() => undefined);
    };
    refresh();
    return onDueChanged(refresh);
  }, [store]);

  // The engine handshake refused: render the readable refusal instead of
  // the app. Nothing is shown from the store — that is the point.
  if (store?.refusal) {
    return <EngineRefusal message={store.refusal} />;
  }

  return (
    <div className="app">
      <div className="titlebar" data-tauri-drag-region />
      <aside className="sidebar">
        <div className="wordmark">
          <span className="wordmark-icon" aria-hidden>✳</span> recap
        </div>
        <div className="nav-label">Your learning</div>
        <nav className="nav" aria-label="Your learning">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={screen === item.id ? "nav-item active" : "nav-item"}
              onClick={() => go(item.id)}
              aria-current={screen === item.id ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden>{item.icon}</span>{item.label}
              {item.id === "review" && dueCount > 0 && <span className="nav-badge">{dueCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" aria-hidden /> {store
            ? store.source === "live"
              ? "Local workspace"
              : "Example data"
            : "Scanning sessions…"}
        </div>
      </aside>
      <main className="content">
        <header className="workspace-bar"><span>Your space <span aria-hidden> / </span> <strong>{NAV.find((item) => item.id === screen)?.label}</strong></span><span>{store?.source === "fixture" ? "Example data" : "All local, all yours"}</span></header>
        {screen === "brief" && <DailyBrief store={store} onNavigate={go} />}
        {screen === "library" && <ConceptLibrary store={store} onNavigate={go} />}
        {screen === "signals" && <SignalExplorer store={store} focus={focus} onNavigate={go} />}
        {screen === "review" && <Review store={store} onNavigate={go} />}
        {screen === "settings" && <SettingsScreen />}
      </main>
      {welcome.phase === "show" && (
        <FirstRun
          settings={welcome.settings}
          detection={welcome.detection}
          sources={welcome.sources}
          onDone={() => setWelcome({ phase: "done" })}
        />
      )}
    </div>
  );
}
