import { useCallback, useEffect, useRef, useState } from "react";
import { localDate } from "./brief";
import type { Candidate } from "./fixtures";
import { dueInWords, type Grade } from "./review";
import {
  applyReview,
  loadCandidatesByIds,
  loadDueConcepts,
  loadDueOverview,
  type Concept,
  type DueOverview,
  type StoreState,
} from "./store";

/** How long the reschedule confirmation stays before the next concept:
 *  long enough to read "next review in 8 days", short enough to keep a
 *  session moving. */
const CONFIRM_MS = 1500;

/**
 * The Review session, per the spec: up to ten due concepts, oldest due
 * first. Each shows only its title until Space reveals the explainer
 * (the exchange one expand further), then the three grades — 1/2/3 on the
 * keyboard. Every grade confirms the reschedule before moving on, and a
 * finished session ends in a real done-state.
 */
export function useReview(store: StoreState | null) {
  const [queue, setQueue] = useState<Concept[] | null>(null);
  const [overview, setOverview] = useState<DueOverview | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sources, setSources] = useState<Candidate[] | null>(null);
  const [reschedule, setReschedule] = useState<string | null>(null);
  const [tally, setTally] = useState({ kept: 0, fuzzy: 0, lost: 0 });
  const timer = useRef<number | null>(null);

  const live = store?.source === "live";
  const today = localDate(new Date());

  const refresh = useCallback(async () => {
    if (!live) return;
    const [due, state] = await Promise.all([loadDueConcepts(today), loadDueOverview(today)]);
    setQueue(due);
    setOverview(state);
  }, [live, today]);

  // The session is a snapshot: it loads once, and due-changed events do
  // not reorder it mid-session (the nav badge listens for those).
  useEffect(() => {
    if (!live) return;
    refresh().catch(() => setQueue([]));
  }, [live, refresh]);

  const current = queue && index < queue.length ? queue[index] : null;
  // Done means a session ran its course — an empty queue is the empty
  // state, not a finished session.
  const done = queue !== null && queue.length > 0 && index >= queue.length;

  // The done-state's next check-in and weekly row need the post-session
  // view, but the queue itself is never reloaded mid-session.
  useEffect(() => {
    if (!done || !live) return;
    loadDueOverview(today)
      .then(setOverview)
      .catch(() => undefined);
  }, [done, live, today]);

  const reveal = useCallback(() => setRevealed(true), []);

  const expand = useCallback(() => {
    setExpanded(true);
    if (!current) return;
    if (!current.sourceIds) {
      setSources([]);
      return;
    }
    setSources(null);
    loadCandidatesByIds(current.sourceIds)
      .then(setSources)
      .catch(() => setSources([]));
  }, [current]);

  const grade = useCallback(
    async (g: Grade) => {
      if (!current || reschedule) return;
      const next = await applyReview(current.id, g).catch(() => null);
      if (!next) return;
      const word = g === "got-it" ? "Kept" : g === "fuzzy" ? "Fuzzy" : "Lost";
      setReschedule(`${word} — next review ${dueInWords(next.dueOn, today)}`);
      setTally((t) => ({
        kept: t.kept + (g === "got-it" ? 1 : 0),
        fuzzy: t.fuzzy + (g === "fuzzy" ? 1 : 0),
        lost: t.lost + (g === "lost-it" ? 1 : 0),
      }));
      timer.current = window.setTimeout(() => {
        setReschedule(null);
        setRevealed(false);
        setExpanded(false);
        setSources(null);
        setIndex((i) => i + 1);
      }, CONFIRM_MS);
    },
    [current, reschedule, today],
  );

  // The spec's keyboard support: Space reveals, 1/2/3 grade.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done || !current) return;
      if (e.code === "Space" && !revealed && !reschedule) {
        e.preventDefault();
        reveal();
        return;
      }
      if (!revealed || reschedule) return;
      if (e.key === "1") grade("got-it");
      if (e.key === "2") grade("fuzzy");
      if (e.key === "3") grade("lost-it");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, done, grade, reveal, revealed, reschedule]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  return {
    queue,
    overview,
    current,
    done,
    index,
    revealed,
    expanded,
    sources,
    reschedule,
    tally,
    reveal,
    expand,
    grade,
    today,
  };
}
