import { useEffect, useState } from "react";
import {
  DEFAULT_MIN_SCORE,
  applyFilters,
  type ExplorerFilters,
} from "./explorer-filters";
import type { StoreState } from "./store";

/**
 * The Signal Explorer's state and derived data, kept out of the component
 * so the upcoming redesign can replace the presentation without touching
 * the logic (see the desktop-app spec's build order notes).
 *
 * The list always shows the filtered candidates in engine order (best
 * first); `selected` tracks a stable candidate id and falls back to the
 * first visible candidate, so refocusing a filter never shows an empty
 * detail pane while candidates are visible.
 */
export function useExplorer(store: StoreState | null) {
  const [filters, setFilters] = useState<ExplorerFilters>({
    minScore: DEFAULT_MIN_SCORE,
    tool: "all",
    signals: [],
    dateFrom: "",
    dateTo: "",
    text: "",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default the window to the scan's own range once the store lands.
  useEffect(() => {
    if (store) {
      setFilters((f) => ({ ...f, dateFrom: store.since }));
    }
  }, [store]);

  const visible = store ? applyFilters(store.candidates, filters) : [];
  const selected = visible.find((c) => c.id === selectedId) ?? visible[0];

  return { filters, setFilters, visible, selected, select: setSelectedId };
}
