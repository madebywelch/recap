import { marked } from "marked";
import briefSource from "../fixtures/daily-brief.md?raw";
import candidatesSource from "../fixtures/candidates.json";

/**
 * One scored candidate, the shape `recap --raw` prints: parse.go's Pair with
 * JSON tags tool, session, cwd, ts, user, assistant_excerpt, score, signals.
 */
export interface Candidate {
  tool: string;
  session: string;
  cwd?: string;
  ts: string;
  user: string;
  assistant_excerpt: string;
  score: number;
  signals?: string[];
}

/** A signal string as recap prints it, e.g. "wh-question:+3". */
export interface Signal {
  name: string;
  weight: number;
}

export function parseSignal(raw: string): Signal {
  const i = raw.lastIndexOf(":");
  return { name: raw.slice(0, i), weight: parseInt(raw.slice(i + 1), 10) };
}

export const candidates: Candidate[] = candidatesSource;

/** The window line of an archive file, main.go's archive() header. */
export interface BriefMeta {
  generatedAt: string;
  since: string;
  tools: string;
  sessions: number;
  pairs: number;
  candidates: number;
  inference: string;
}

export interface Brief {
  meta: BriefMeta;
  html: string;
}

const WINDOW_RE =
  /^_window: since (\S+) \| tools: (\S+) \| sessions: (\d+) \| pairs: (\d+) \| candidates: (\d+) \| inference: (\S+)_$/;

/**
 * Parse the archive format from main.go: a `# Recap <timestamp>` line, a
 * blank line, the `_window: ..._` metadata line, then the markdown body.
 */
export function parseBrief(raw: string): Brief {
  const lines = raw.split("\n");
  const generatedAt = lines[0].replace(/^# Recap /, "");
  const m = lines[2].match(WINDOW_RE);
  if (!m) throw new Error("fixture does not match the archive header format");
  const meta: BriefMeta = {
    generatedAt,
    since: m[1],
    tools: m[2],
    sessions: parseInt(m[3], 10),
    pairs: parseInt(m[4], 10),
    candidates: parseInt(m[5], 10),
    inference: m[6],
  };
  const body = lines.slice(3).join("\n").trim();
  return { meta, html: marked.parse(body, { async: false }) };
}

export const brief: Brief = parseBrief(briefSource);
