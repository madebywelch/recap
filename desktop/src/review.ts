import { localDate } from "./brief";

/**
 * SM-2 scheduling, per docs/desktop-app-spec.md §Review — the Anki
 * grandfather, nothing fancier. Three grades map onto its quality scale:
 * Got it 5, Fuzzy 3, Lost it 1. Ease starts at 2.5, updates after every
 * grade as `ease += 0.1 − (5−q) × (0.08 + (5−q) × 0.02)`, and is floored
 * at 1.3. A success's interval: first 1 day, second 6 days, then
 * previous × ease, capped at 90 days. A lapse resets to 1 day and counts.
 */
export type Grade = "got-it" | "fuzzy" | "lost-it";

/** One `review_state` row, as the scheduler reads and writes it. */
export interface ReviewState {
  dueOn: string;
  intervalDays: number;
  ease: number;
  reviews: number;
  lapses: number;
  lastGrade: Grade | null;
  lastReviewedAt: string | null;
}

/** A concept entering review: first interval 1 day, due tomorrow. */
export const EASE_FLOOR = 1.3;
export const INTERVAL_CAP = 90;

const QUALITY: Record<Grade, number> = { "got-it": 5, fuzzy: 3, "lost-it": 1 };

export function seedState(dueOn: string): ReviewState {
  return {
    dueOn,
    intervalDays: 1,
    ease: 2.5,
    reviews: 0,
    lapses: 0,
    lastGrade: null,
    lastReviewedAt: null,
  };
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

/** The next ease after a grade: `ease + 0.1 − (5−q)×(0.08 + (5−q)×0.02)`,
 *  floored at 1.3. */
export function nextEase(ease: number, grade: Grade): number {
  const q = QUALITY[grade];
  const gap = 5 - q;
  return Math.max(EASE_FLOOR, ease + 0.1 - gap * (0.08 + gap * 0.02));
}

/** The interval a grade schedules, in days: a lapse resets to 1; a
 *  success takes 1 day for the first in its streak, 6 for the second,
 *  then previous × the new ease, capped. The streak is encoded in the
 *  stored interval — a lapse or a first success leaves it at 1, so the
 *  interval distinguishes "first again" from "growing". */
export function nextInterval(
  state: Pick<ReviewState, "intervalDays" | "lastGrade">,
  grade: Grade,
  ease: number,
): number {
  if (grade === "lost-it") return 1;
  if (state.lastGrade === null || state.lastGrade === "lost-it") return 1;
  if (state.intervalDays === 1) return 6;
  return Math.min(INTERVAL_CAP, state.intervalDays * ease);
}

/** Grades one concept: returns the row to persist. `now` is the grading
 *  moment; the due date is a calendar day at `now + interval`. */
export function applyGrade(state: ReviewState, grade: Grade, now: Date): ReviewState {
  const ease = nextEase(state.ease, grade);
  const intervalDays = nextInterval(state, grade, ease);
  return {
    dueOn: localDate(addDays(now, Math.round(intervalDays))),
    intervalDays,
    ease,
    reviews: state.reviews + 1,
    lapses: state.lapses + (grade === "lost-it" ? 1 : 0),
    lastGrade: grade,
    lastReviewedAt: now.toISOString(),
  };
}

/** "next review in 8 days", "tomorrow", "today" — the confirmation line
 *  after a grade and the done-state's next check-in. */
export function dueInWords(dueOn: string, today: string): string {
  const days = Math.round((Date.parse(dueOn) - Date.parse(today)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
