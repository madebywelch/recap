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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewPending, setReviewPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [sourceAttempt, setSourceAttempt] = useState(0);

  const live = store?.source === "live";

  useEffect(() => {
    if (!live) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    const t = setTimeout(() => {
      loadConcepts(query)
        .then((rows) => {
          if (alive) {
            setConcepts(rows);
            setLoading(false);
          }
        })
        .catch(() => {
          if (alive) {
            setLoadError("Couldn't load the library.");
            setLoading(false);
          }
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, live, attempt]);

  const selected = useMemo(
    () => (selectedId === null ? null : concepts?.find((c) => c.id === selectedId) ?? null),
    [concepts, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setSources(null);
    setSourceError(null);
    if (selected.sourceIds === null) return;
    loadCandidatesByIds(selected.sourceIds)
      .then((rows) => { if (alive) setSources(rows); })
      .catch(() => { if (alive) setSourceError("Couldn't load the exchanges for this concept."); });
    return () => { alive = false; };
  }, [selectedId, sourceAttempt]);

  const open = useCallback((c: Concept) => {
    setReviewError(null);
    setSelectedId(c.id);
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
      setReviewPending(true);
      setReviewError(null);
      try {
        await seedReview(concept.id, localDate(tomorrow));
      } catch {
        setReviewError("Couldn't add this concept to review. Please try again.");
        setReviewPending(false);
        return;
      }
      try {
        setConcepts(await loadConcepts(query));
      } catch {
        setReviewError("Added to review, but couldn't refresh its status. Reopen the library to see it.");
      } finally {
        setReviewPending(false);
      }
    },
    [query, concepts],
  );

  const removeReview = useCallback(
    async (concept: Concept) => {
      setReviewPending(true);
      setReviewError(null);
      try {
        await unseedReview(concept.id);
      } catch {
        setReviewError("Couldn't remove this concept from review. Please try again.");
        setReviewPending(false);
        return;
      }
      try {
        setConcepts(await loadConcepts(query));
      } catch {
        setReviewError("Removed from review, but couldn't refresh its status. Reopen the library to see it.");
      } finally {
        setReviewPending(false);
      }
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
    loading,
    loadError,
    sourceError,
    reviewError,
    reviewPending,
    retry: () => setAttempt((n) => n + 1),
    retrySources: () => setSourceAttempt((n) => n + 1),
    open,
    close,
    addReview,
    removeReview,
    inWindow,
  };
}
