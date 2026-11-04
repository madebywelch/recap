import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import {
  validateScanResult,
  type Candidate,
  type ScanResult,
  type Signal,
} from "./fixtures";
import fixtureScanSource from "../fixtures/engine-scan.json";

/**
 * The app's candidate store. In the shell, `initStore` runs the spec's
 * launch flow: spawn the bundled recap sidecar, validate its envelope
 * against the engine contract, upsert the scan into SQLite (schema from
 * docs/desktop-app-spec.md §App storage), and read the accumulated store
 * back. Outside the shell, or when the sidecar fails, it falls back to the
 * committed fixture so the screens always have data.
 */

export type StoreSource = "live" | "fixture";

export interface StoreState {
  source: StoreSource;
  /** Start of the scan window the data came from, YYYY-MM-DD. */
  since: string;
  candidates: Candidate[];
  /** The launch scan's counts, for the Brief's facts strip and the
   *  write-the-brief decision. */
  sessions: number;
  pairs: number;
  /** Candidates the launch scan kept for this window. */
  windowCandidates: number;
  /** Set when a live scan was attempted and failed; the fixture is shown. */
  error?: string;
}

/** One persisted run row, as the Brief reads it back. */
export interface BriefRecord {
  id: number;
  since: string;
  started_at: string;
  finished_at: string | null;
  inference_cli: string | null;
  raw_output: string;
}

/** A generation run to record (the spec's runs table; a generation is its
 *  own run, with raw_output and the archive path filled in). */
export interface GenerationRecord {
  startedAt: string;
  finishedAt: string;
  since: string;
  tools: string;
  sessions: number;
  pairs: number;
  status: "done" | "failed" | "cancelled";
  inferenceCli: string;
  archivePath: string | null;
  rawOutput: string;
}

const DB_NAME = "sqlite:recap.db";

const inTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// docs/desktop-app-spec.md §App storage. concepts / review_state / FTS are
// created by their own milestones; a scan run needs runs + candidates only.
const CREATE_RUNS = `
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    since TEXT NOT NULL,
    tools TEXT NOT NULL,
    sessions INTEGER, pairs INTEGER,
    status TEXT NOT NULL,
    inference_cli TEXT,
    archive_path TEXT,
    raw_output TEXT
  )`;

const CREATE_CANDIDATES = `
  CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id),
    tool TEXT, session TEXT, cwd TEXT, ts TEXT,
    user_message TEXT NOT NULL,
    assistant_excerpt TEXT NOT NULL,
    score INTEGER NOT NULL,
    user_score INTEGER NOT NULL,
    assistant_bonus INTEGER NOT NULL,
    signals TEXT NOT NULL
  )`;

interface CandidateRow {
  id: string;
  tool: string;
  session: string;
  cwd: string | null;
  ts: string;
  user_message: string;
  assistant_excerpt: string;
  score: number;
  user_score: number;
  assistant_bonus: number;
  signals: string;
}

let db: Database | null = null;

function fixtureStore(error?: string): StoreState {
  const scan = validateScanResult(fixtureScanSource);
  return {
    source: "fixture",
    since: scan.since,
    candidates: scan.candidates,
    sessions: scan.sessions,
    pairs: scan.pairs,
    windowCandidates: scan.candidates.length,
    error,
  };
}

/** Records one validated scan: a run row, then each candidate upserted by
 *  its engine-stable id so a rescan replaces instead of duplicating. */
async function ingest(scan: ScanResult): Promise<void> {
  const run = await db!.execute(
    `INSERT INTO runs (started_at, finished_at, since, tools, sessions, pairs, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'done')`,
    [
      scan.scannedAt,
      scan.scannedAt,
      scan.since,
      scan.tools.join("+"),
      scan.sessions,
      scan.pairs,
    ],
  );
  if (run.lastInsertId === undefined) {
    throw new Error("inserting the run row returned no id");
  }
  const runId = run.lastInsertId;
  for (const c of scan.candidates) {
    await db!.execute(
      `INSERT INTO candidates
         (id, run_id, tool, session, cwd, ts, user_message, assistant_excerpt,
          score, user_score, assistant_bonus, signals)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT(id) DO UPDATE SET
         run_id = excluded.run_id, tool = excluded.tool, session = excluded.session,
         cwd = excluded.cwd, ts = excluded.ts, user_message = excluded.user_message,
         assistant_excerpt = excluded.assistant_excerpt, score = excluded.score,
         user_score = excluded.user_score, assistant_bonus = excluded.assistant_bonus,
         signals = excluded.signals`,
      [
        c.id,
        runId,
        c.tool,
        c.sessionId,
        c.cwd ?? null,
        c.ts,
        c.userMessage,
        c.assistantExcerpt,
        c.score,
        c.userScore,
        c.assistantBonus,
        JSON.stringify(c.signals),
      ],
    );
  }
}

async function loadCandidates(): Promise<Candidate[]> {
  const rows = await db!.select<CandidateRow[]>(
    `SELECT id, tool, session, cwd, ts, user_message, assistant_excerpt,
            score, user_score, assistant_bonus, signals
     FROM candidates ORDER BY score DESC, ts DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    tool: r.tool as Candidate["tool"],
    sessionId: r.session,
    cwd: r.cwd ?? undefined,
    ts: r.ts,
    userMessage: r.user_message,
    assistantExcerpt: r.assistant_excerpt,
    score: r.score,
    userScore: r.user_score,
    assistantBonus: r.assistant_bonus,
    signals: JSON.parse(r.signals) as Signal[],
  }));
}

/**
 * Runs once on app open: scan → validate → upsert → read the store back.
 * Resolves rather than rejects on failure; the error rides in StoreState
 * so the Explorer can say why it is showing fixture data.
 */
export async function initStore(): Promise<StoreState> {
  if (!inTauri()) return fixtureStore();
  try {
    db = await Database.load(DB_NAME);
    await db.execute(CREATE_RUNS);
    await db.execute(CREATE_CANDIDATES);
    const raw = await invoke<string>("run_scan");
    const scan = validateScanResult(JSON.parse(raw));
    await ingest(scan);
    const candidates = await loadCandidates();
    return {
      source: "live",
      since: scan.since,
      candidates,
      sessions: scan.sessions,
      pairs: scan.pairs,
      windowCandidates: scan.candidates.length,
    };
  } catch (e) {
    return fixtureStore(e instanceof Error ? e.message : String(e));
  }
}

/** The latest generated brief for a scan window, when one exists. */
export async function loadBriefRun(since: string): Promise<BriefRecord | null> {
  if (!db) return null;
  const rows = await db.select<
    { id: number; since: string; started_at: string; finished_at: string | null; inference_cli: string | null; raw_output: string }[]
  >(
    `SELECT id, since, started_at, finished_at, inference_cli, raw_output
     FROM runs WHERE raw_output IS NOT NULL AND since = $1
     ORDER BY id DESC LIMIT 1`,
    [since],
  );
  return rows[0] ?? null;
}

/** Records a finished generation run — post-hoc, so a crash mid-run never
 *  leaves a stale "generating" row behind (the live progress panel holds
 *  in-flight state, not the store). */
export async function recordGeneration(rec: GenerationRecord): Promise<void> {
  if (!db) return;
  await db.execute(
    `INSERT INTO runs
       (started_at, finished_at, since, tools, sessions, pairs, status, inference_cli, archive_path, raw_output)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      rec.startedAt,
      rec.finishedAt,
      rec.since,
      rec.tools,
      rec.sessions,
      rec.pairs,
      rec.status,
      rec.inferenceCli,
      rec.archivePath,
      rec.rawOutput,
    ],
  );
}
