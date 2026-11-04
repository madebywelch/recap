import type { Concept } from "./store";

/** One day of the date-grouped list. */
export interface ConceptGroup {
  date: string;
  concepts: Concept[];
}

/** Groups concepts by day, newest first — the list arrives sorted, so runs
 *  of equal dates collapse into one group. */
export function groupByDate(concepts: Concept[]): ConceptGroup[] {
  const groups: ConceptGroup[] = [];
  for (const c of concepts) {
    const last = groups[groups.length - 1];
    if (last && last.date === c.date) last.concepts.push(c);
    else groups.push({ date: c.date, concepts: [c] });
  }
  return groups;
}

/** The list's one-line preview of a concept: its first sentence. */
export function firstSentence(body: string): string {
  return body.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? body;
}

/** "due in 3 days", "due tomorrow", "due today" — the review chip's text. */
export function dueText(dueOn: string, today: string): string {
  const days = Math.round((Date.parse(dueOn) - Date.parse(today)) / 86_400_000);
  if (days <= 0) return "due today";
  return days === 1 ? "due tomorrow" : `due in ${days} days`;
}
