import { marked } from "marked";
import type { Candidate } from "./fixtures";

/**
 * The Daily Brief's presentation model. An archive entry is one paragraph,
 * `**Concept name.** explainer…`, optionally followed by the spec's
 * `sources: id1,id2` line linking it to the candidates that produced it.
 * Each entry splits into the three disclosure levels: the lede (first
 * sentence) for the collapsed card, the rest of the explainer plus its rule
 * of thumb, and the source exchanges behind it.
 */
export interface BriefEntry {
  title: string;
  lede: string;
  rest: string;
  rule: string;
  sources: string[];
  /** The full explainer paragraph as the archive holds it — title and
   *  sources line stripped, the rule of thumb inline. The Library stores
   *  this verbatim as the concept body. */
  body: string;
}

const ENTRY_RE = /^\*\*(.+?)\*\*\s+([\s\S]+)$/;
const RULE_MARK = "Rule of thumb:";

/** The entry body of a brief: an archive file starts with its `# Recap`
 *  header and window line (three lines before the first entry); the raw
 *  markdown a generation run prints on stdout has no header at all. */
export function briefBody(raw: string): string {
  const lines = raw.split("\n");
  return lines[0].startsWith("# Recap ") ? lines.slice(3).join("\n") : raw;
}

export function parseEntries(raw: string): BriefEntry[] {
  const body = briefBody(raw);
  return body
    .split(/\n\s*\n/)
    .map((block) => block.trim().split("\n"))
    .flatMap((lines) => {
      let sources: string[] = [];
      const last = lines[lines.length - 1];
      if (last.startsWith("sources:")) {
        sources = last
          .slice("sources:".length)
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        lines = lines.slice(0, -1);
      }
      const m = lines.join(" ").match(ENTRY_RE);
      if (!m) return [];
      let text = m[2].trim();
      let rule = "";
      const at = text.indexOf(RULE_MARK);
      if (at >= 0) {
        rule = text.slice(at + RULE_MARK.length).trim();
        text = text.slice(0, at).trim();
      }
      const lede = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
      return [
        {
          title: m[1].replace(/\.$/, ""),
          lede,
          rest: text.slice(lede.length).trim(),
          rule: rule.replace(/^([^A-Za-z]*)([a-z])/, (_, pre: string, ch: string) => pre + ch.toUpperCase()),
          sources,
          body: m[2].trim(),
        },
      ];
    });
}

/** The header every engine-written archive carries (main.go's archive()):
 *  a `# Recap <timestamp>` line, a blank line, then the `_window: ..._`
 *  facts line. Lenient for the Library's first-run import: an older or
 *  hand-edited file without the header parses to null. */
export interface ArchiveMeta {
  /** When the archive was written, "YYYY-MM-DD HH:MM" local. */
  generatedAt: string;
  since: string;
  tools: string;
  sessions: number;
  pairs: number;
  candidates: number;
  inference: string;
}

const WINDOW_LINE_RE =
  /^_window: since (\S+) \| tools: (\S+) \| sessions: (\d+) \| pairs: (\d+) \| candidates: (\d+) \| inference: (\S+)_/;

export function parseArchiveMeta(raw: string): ArchiveMeta | null {
  const lines = raw.split("\n");
  if (!lines[0].startsWith("# Recap ")) return null;
  const m = lines[2].match(WINDOW_LINE_RE);
  if (!m) return null;
  return {
    generatedAt: lines[0].slice("# Recap ".length).trim(),
    since: m[1],
    tools: m[2],
    sessions: parseInt(m[3], 10),
    pairs: parseInt(m[4], 10),
    candidates: parseInt(m[5], 10),
    inference: m[6],
  };
}

/** Local YYYY-MM-DD — the way the engine dates archive files and review
 *  due days. */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Inline markdown (code spans, emphasis) to HTML for one line of text. */
export function inline(md: string): string {
  return marked.parseInline(md, { async: false }) as string;
}

/** The curiosity-gap lead for a card: the pasted error line when there is
 * one, otherwise the first question or sentence the user wrote. */
export function leadOf(c: Candidate): { kind: "error" | "question"; text: string } {
  const err = c.userMessage
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^(Error|error|fatal|Traceback)\b/.test(l));
  if (err) return { kind: "error", text: err };
  const first = c.userMessage.match(/^[\s\S]+?[?.](?=\s|$)/)?.[0] ?? c.userMessage;
  return { kind: "question", text: first.trim() };
}

/** Reading time at 220 words a minute, never less than one. */
export function readMinutes(entries: BriefEntry[]): number {
  const words = entries.reduce(
    (n, e) => n + `${e.lede} ${e.rest} ${e.rule}`.split(/\s+/).length,
    0,
  );
  return Math.max(1, Math.round(words / 220));
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** Editorial counts: numbers under ten spelled out, nouns pluralized. */
export function count(n: number, noun: string, capitalize = false): string {
  const num = n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
  const text = `${num} ${noun}${n === 1 ? "" : "s"}`;
  return capitalize ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function clock(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function project(c: Candidate): string {
  return c.cwd ? c.cwd.split("/").pop() || c.cwd : "no folder";
}

export function signed(w: number): string {
  return w > 0 ? `+${w}` : w < 0 ? `−${Math.abs(w)}` : "0";
}
