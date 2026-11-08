import { marked } from "marked";
import briefSource from "../fixtures/daily-brief.md?raw";
import scanSource from "../fixtures/engine-scan.json";

/**
 * Client types for the engine's JSON contract (docs/engine-json.md) and the
 * runtime validation that enforces it. The committed fixture is genuine
 * `recap --raw` output; when the sidecar lands (M2), its stdout goes through
 * the same validateScanResult call.
 */

/** The engine major this build understands. A newer major means a breaking
 * contract change, so the payload is refused rather than rendered. Within a
 * major, changes are additive only. */
export const SUPPORTED_ENGINE_MAJOR = 1;

/** One named signal as the engine reports it. side is redundant with the
 * name but explicit for the UI. */
export interface Signal {
  name: string;
  weight: number;
  side: "user" | "assistant";
}

/** A scored candidate. score is always userScore + assistantBonus: the user
 * side decides whether a pair is a learning moment, the assistant side at
 * most doubles one. signal_strings is the compact "name:+N" form the CLI
 * has always printed; consumers of signals can ignore it. */
/** The session sources the engine reads (engine.Tools), in scan order. */
export const TOOLS = ["claude", "codex", "pi"] as const;
export type Tool = (typeof TOOLS)[number];

/** Display names for the harnesses behind each tool id. */
export const TOOL_LABELS: Record<Tool, string> = {
  claude: "Claude Code",
  codex: "Codex",
  pi: "Pi",
};

export function toolLabel(name: string): string {
  return Object.prototype.hasOwnProperty.call(TOOL_LABELS, name) ? TOOL_LABELS[name as Tool] : name;
}

export interface Candidate {
  id: string;
  tool: Tool;
  sessionId: string;
  cwd?: string;
  ts: string;
  userMessage: string;
  assistantExcerpt: string;
  score: number;
  userScore: number;
  assistantBonus: number;
  signals: Signal[];
  signal_strings?: string[];
}

/** The versioned scan envelope `recap --raw` prints. */
export interface ScanResult {
  engineVersion: string;
  scannedAt: string;
  since: string;
  tools: string[];
  sessions: number;
  pairs: number;
  candidates: Candidate[];
}

/** A payload failed contract validation. The message names the violation. */
export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvelopeError";
  }
}

function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EnvelopeError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string, what: string): string {
  if (typeof obj[key] !== "string") {
    throw new EnvelopeError(`${what} must be a string`);
  }
  return obj[key] as string;
}

function requireInt(obj: Record<string, unknown>, key: string, what: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new EnvelopeError(`${what} must be an integer`);
  }
  return v;
}

function requireArray(obj: Record<string, unknown>, key: string, what: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new EnvelopeError(`${what} must be an array`);
  }
  return v;
}

function requireStringArray(obj: Record<string, unknown>, key: string, what: string): string[] {
  const v = requireArray(obj, key, what);
  if (v.some((x) => typeof x !== "string")) {
    throw new EnvelopeError(`${what} must be an array of strings`);
  }
  return v as string[];
}

function isTool(value: string): value is Tool {
  return (TOOLS as readonly string[]).includes(value);
}

/** The version handshake every envelope passes: a newer major is refused. */
function requireSupportedVersion(env: Record<string, unknown>): string {
  const engineVersion = requireString(env, "engineVersion", "engineVersion");
  const major = Number(engineVersion.split(".")[0]);
  if (!Number.isInteger(major) || major < 0) {
    throw new EnvelopeError(`engineVersion "${engineVersion}" is not a version string`);
  }
  if (major > SUPPORTED_ENGINE_MAJOR) {
    throw new EnvelopeError(
      `engine version ${engineVersion} is newer than this app understands (major ${SUPPORTED_ENGINE_MAJOR}); refusing to render`,
    );
  }
  return engineVersion;
}

function validateSignal(data: unknown): Signal {
  const s = requireObject(data, "signal");
  const side = requireString(s, "side", "signal.side");
  if (side !== "user" && side !== "assistant") {
    throw new EnvelopeError(`signal.side must be "user" or "assistant", got "${side}"`);
  }
  return {
    name: requireString(s, "name", "signal.name"),
    weight: requireInt(s, "weight", "signal.weight"),
    side,
  };
}

function validateCandidate(data: unknown): Candidate {
  const c = requireObject(data, "candidate");
  const tool = requireString(c, "tool", "candidate.tool");
  if (!isTool(tool)) {
    throw new EnvelopeError(`candidate.tool must be one of ${TOOLS.join(", ")}, got "${tool}"`);
  }
  if (c.cwd !== undefined && typeof c.cwd !== "string") {
    throw new EnvelopeError("candidate.cwd must be a string when present");
  }
  const signalStrings =
    c.signal_strings === undefined ? undefined : requireStringArray(c, "signal_strings", "candidate.signal_strings");
  return {
    id: requireString(c, "id", "candidate.id"),
    tool,
    sessionId: requireString(c, "sessionId", "candidate.sessionId"),
    cwd: c.cwd as string | undefined,
    ts: requireString(c, "ts", "candidate.ts"),
    userMessage: requireString(c, "userMessage", "candidate.userMessage"),
    assistantExcerpt: requireString(c, "assistantExcerpt", "candidate.assistantExcerpt"),
    score: requireInt(c, "score", "candidate.score"),
    userScore: requireInt(c, "userScore", "candidate.userScore"),
    assistantBonus: requireInt(c, "assistantBonus", "candidate.assistantBonus"),
    signals: requireArray(c, "signals", "candidate.signals").map(validateSignal),
    signal_strings: signalStrings,
  };
}

/**
 * Validates a raw payload against the scan-envelope contract and returns it
 * typed. Refuses payloads whose engineVersion major is newer than
 * SUPPORTED_ENGINE_MAJOR, and any payload missing required fields or
 * carrying values of the wrong shape.
 */
export function validateScanResult(data: unknown): ScanResult {
  const env = requireObject(data, "envelope");
  return {
    engineVersion: requireSupportedVersion(env),
    scannedAt: requireString(env, "scannedAt", "scannedAt"),
    since: requireString(env, "since", "since"),
    tools: requireStringArray(env, "tools", "tools"),
    sessions: requireInt(env, "sessions", "sessions"),
    pairs: requireInt(env, "pairs", "pairs"),
    candidates: requireArray(env, "candidates", "candidates").map(validateCandidate),
  };
}

/** One session source as `recap --sources` reports it: the transcript
 *  directory, whether it exists, its session files, and how many of them
 *  fall in the scan window. Tools this build doesn't know pass through as
 *  plain strings, since the engine may add sources within a major. */
export interface Source {
  tool: string;
  root: string;
  found: boolean;
  sessions: number;
  recentSessions: number;
}

/** The `recap --sources` envelope (docs/engine-json.md). */
export interface SourcesResult {
  engineVersion: string;
  since: string;
  sources: Source[];
}

export function validateSourcesResult(data: unknown): SourcesResult {
  const env = requireObject(data, "sources envelope");
  return {
    engineVersion: requireSupportedVersion(env),
    since: requireString(env, "since", "since"),
    sources: requireArray(env, "sources", "sources").map((item) => {
      const s = requireObject(item, "source");
      if (typeof s.found !== "boolean") throw new EnvelopeError("source.found must be a boolean");
      return {
        tool: requireString(s, "tool", "source.tool"),
        root: requireString(s, "root", "source.root"),
        found: s.found,
        sessions: requireInt(s, "sessions", "source.sessions"),
        recentSessions: requireInt(s, "recentSessions", "source.recentSessions"),
      };
    }),
  };
}

/** The committed scan fixture, validated at load. */
export const scan: ScanResult = validateScanResult(scanSource);
export const candidates: Candidate[] = scan.candidates;

// --- daily brief -----------------------------------------------------------

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
