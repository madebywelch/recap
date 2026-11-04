import { useCallback, useEffect, useMemo, useState } from "react";
import { localDate } from "./brief";
import type { Candidate } from "./fixtures";
import { groupByDate } from "./library-filters";
import {
  loadCandidatesByIds,
  loadConcepts,
  seedReview,
  unseedReview,
  type Concept,
  type StoreState,
} from "./store";

/**
 * The Concept Library's state: FTS search over concepts (empty query lists
 * everything, newest first), the reader for one concept with its source
 * exchange loaded on demand, and review seeding. Fixture stores have no
 * database behind them, so `concepts` stays null and the screen shows its
 * fixture shelf.
 */
export function useLibrary(store: StoreState | null) {
  const [concepts, setConcepts] = useState<Concept[] | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sources, setSources] = useState<Candidate[] | null>(null);

  const live = store?.source === "live";

  useEffect(() => {
    if (!live) return;
    let alive = true;
    const t = setTimeout(() => {
      loadConcepts(query)
        .then((rows) => {
          if (alive) setConcepts(rows);
        })
        .catch(() => {
          if (alive) setConcepts([]);
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, live]);

  const selected = useMemo(
    () => (selectedId === null ? null : concepts?.find((c) => c.id === selectedId) ?? null),
    [concepts, selectedId],
  );

  const open = useCallback((c: Concept) => {
    setSelectedId(c.id);
    if (!c.sourceIds) {
      setSources([]);
      return;
    }
    setSources(null);
    loadCandidatesByIds(c.sourceIds)
      .then((rows) => setSources(rows))
      .catch(() => setSources([]));
  }, []);

  const close = useCallback(() => {
    setSelectedId(null);
    setSources(null);
  }, []);

  /** Seeds the concept, due tomorrow — the spec's first interval. */
  const addReview = useCallback(
    async (concept: Concept) => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await seedReview(concept.id, localDate(tomorrow)).catch(() => undefined);
      const rows = await loadConcepts(query).catch(() => concepts ?? []);
      setConcepts(rows);
    },
    [query, concepts],
  );

  const removeReview = useCallback(
    async (concept: Concept) => {
      await unseedReview(concept.id).catch(() => undefined);
      const rows = await loadConcepts(query).catch(() => concepts ?? []);
      setConcepts(rows);
    },
    [query, concepts],
  );

  /** Whether the Explorer can land on a candidate — only ids in the
 *  current scan window resolve to a selected row there. */
  const inWindow = useCallback(
    (id: string) => store?.candidates.some((c) => c.id === id) ?? false,
    [store],
  );

  return {
    concepts: live ? concepts : null,
    query,
    setQuery,
    groups: useMemo(() => groupByDate(concepts ?? []), [concepts]),
    selected,
    sources,
    open,
    close,
    addReview,
    removeReview,
    inWindow,
  };
}
