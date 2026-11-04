import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import {
  EnvelopeError,
  validateScanResult,
  type Candidate,
  type ScanResult,
  type Signal,
} from "./fixtures";
import { localDate, parseArchiveMeta, parseEntries, type BriefEntry } from "./brief";
import { applyGrade, type Grade, type ReviewState } from "./review";
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
  /** Set when the engine's envelope failed the version handshake or the
   *  contract validation: the app refuses to render rather than fall back
   *  to fixture data, and shows the message instead. */
  refusal?: string;
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
  /** The brief's local date, YYYY-MM-DD — the day its concepts belong to. */
  date: string;
  since: string;
  tools: string;
  sessions: number;
  pairs: number;
  status: "done" | "failed" | "cancelled";
  inferenceCli: string;
  archivePath: string | null;
  rawOutput: string;
}

/** One concept as the Library reads it (the spec's concepts table, joined
 *  with its review row when one exists). */
export interface Concept {
  id: number;
  date: string;
  title: string;
  body: string;
  /** Source candidate ids; null when the brief omitted the sources line. */
  sourceIds: string[] | null;
  /** The review row, when the concept is seeded. */
  review: {
    dueOn: string;
    reviews: number;
    lapses: number;
    lastGrade: string | null;
  } | null;
}

const DB_NAME = "sqlite:recap.db";

const inTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// docs/desktop-app-spec.md §App storage. A scan run needs runs +
// candidates; M4 adds the concept tables with their FTS index.
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

// docs/desktop-app-spec.md §App storage — the M4 tables. concepts_fts is
// an external-content index over concepts, kept in sync by triggers so the
// Library's search can never drift from what the rows hold.
const CREATE_CONCEPTS = `
  CREATE TABLE IF NOT EXISTS concepts (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES runs(id),
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    source_candidate_ids TEXT
  )`;

const CREATE_REVIEW_STATE = `
  CREATE TABLE IF NOT EXISTS review_state (
    concept_id INTEGER PRIMARY KEY REFERENCES concepts(id),
    due_on TEXT NOT NULL,
    interval_days REAL NOT NULL DEFAULT 1,
    ease REAL NOT NULL DEFAULT 2.5,
    reviews INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    last_grade TEXT,
    last_reviewed_at TEXT
  )`;

const CREATE_CONCEPTS_FTS = `
  CREATE VIRTUAL TABLE IF NOT EXISTS concepts_fts USING fts5(
    title, body, content='concepts', content_rowid='id'
  )`;

const CONCEPT_FTS_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS concepts_ai AFTER INSERT ON concepts BEGIN
    INSERT INTO concepts_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
  END;
  CREATE TRIGGER IF NOT EXISTS concepts_ad AFTER DELETE ON concepts BEGIN
    INSERT INTO concepts_fts(concepts_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, old.body);
  END;
  CREATE TRIGGER IF NOT EXISTS concepts_au AFTER UPDATE ON concepts BEGIN
    INSERT INTO concepts_fts(concepts_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, old.body);
    INSERT INTO concepts_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
  END`;

// Regenerating a day rewrites its archive file, so a (date, title) pair is
// the natural key: the upsert replaces the day's explainer instead of
// stacking a duplicate row.
const CREATE_CONCEPTS_KEY = `
  CREATE UNIQUE INDEX IF NOT EXISTS concepts_day_title ON concepts(date, title)`;

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
/** How a failed launch scan classifies (the initStore catch): a contract
 *  failure refuses the whole app; anything else is a scan failure and
 *  falls back to the committed fixture. */
export function classifyLaunchFailure(e: unknown): { refusal?: string; error?: string } {
  if (e instanceof EnvelopeError) return { refusal: e.message };
  return { error: e instanceof Error ? e.message : String(e) };
}

export async function initStore(): Promise<StoreState> {
  if (!inTauri()) return fixtureStore();
  try {
    db = await Database.load(DB_NAME);
    await db.execute(CREATE_RUNS);
    await db.execute(CREATE_CANDIDATES);
    await db.execute(CREATE_CONCEPTS);
    await db.execute(CREATE_REVIEW_STATE);
    await db.execute(CREATE_CONCEPTS_FTS);
    await db.execute(CONCEPT_FTS_TRIGGERS);
    await db.execute(CREATE_CONCEPTS_KEY);
    const raw = await invoke<string>("run_scan");
    const scan = validateScanResult(JSON.parse(raw));
    await ingest(scan);
    // Idempotent: an already-recorded file (its run row exists) is skipped,
    // so relaunching with the same history adds nothing.
    await importArchives().catch(() => undefined);
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
    // A failed launch scan falls back to the committed fixture — but a
    // contract failure (EnvelopeError) is not a scan failure: it means the
    // engine beside this app isn't the one it was built with, so the app
    // refuses to render anything rather than show data it can't validate.
    const { refusal, error } = classifyLaunchFailure(e);
    if (refusal) {
      return {
        source: "fixture",
        since: "",
        candidates: [],
        sessions: 0,
        pairs: 0,
        windowCandidates: 0,
        refusal,
      };
    }
    return fixtureStore(error);
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
 *  in-flight state, not the store) — and its concepts, upserted by
 *  (date, title) so regenerating the day replaces instead of stacking. */
export async function recordGeneration(rec: GenerationRecord): Promise<void> {
  if (!db) return;
  const run = await db.execute(
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
  if (rec.status === "done" && run.lastInsertId !== undefined) {
    await upsertConcepts(run.lastInsertId, rec.date, parseEntries(rec.rawOutput));
    // The spec's learning loop: the day's concepts enter review
    // automatically, due tomorrow. The OR IGNORE keeps a manual seed's
    // schedule (M4's Library add) untouched.
    const tomorrow = localDate(new Date(Date.now() + 86_400_000));
    await db!.execute(
      `INSERT INTO review_state (concept_id, due_on)
       SELECT id, $2 FROM concepts WHERE date = $1
       ON CONFLICT(concept_id) DO NOTHING`,
      [rec.date, tomorrow],
    );
    emitDueChanged();
  }
}

/** One archive file as the shell reads it for the first-run import. */
interface ArchiveFile {
  name: string;
  path: string;
  content: string;
}

/** The first-run import: every recap-*.md in the shared archive dir
 *  (~/.claude/morning-recap) parsed with the same entry parser as
 *  generation, one run row per file. Files the app itself recorded — their
 *  run row already carries archive_path — are skipped, and a relaunch
 *  finds the rows it wrote and skips them again. */
export async function importArchives(): Promise<number> {
  if (!db) return 0;
  const files = await invoke<ArchiveFile[]>("read_archives");
  let imported = 0;
  for (const file of files) {
    const entries = parseEntries(file.content);
    if (entries.length === 0) continue;
    const known = await db.select<{ n: number }[]>(
      `SELECT COUNT(*) AS n FROM runs WHERE archive_path = $1`,
      [file.path],
    );
    if ((known[0]?.n ?? 0) > 0) continue;
    const meta = parseArchiveMeta(file.content);
    const date =
      file.name.match(/^recap-(\d{4}-\d{2}-\d{2})\.md$/)?.[1] ?? meta?.generatedAt.slice(0, 10) ?? "";
    if (!date) continue;
    const run = await db.execute(
      `INSERT INTO runs
         (started_at, finished_at, since, tools, sessions, pairs, status, inference_cli, archive_path, raw_output)
       VALUES ($1, $1, $2, $3, $4, $5, 'done', $6, $7, $8)`,
      [
        meta ? meta.generatedAt.replace(" ", "T") + ":00" : `${date}T00:00:00`,
        meta?.since ?? date,
        meta?.tools ?? "unknown",
        meta?.sessions ?? null,
        meta?.pairs ?? null,
        meta?.inference ?? null,
        file.path,
        file.content,
      ],
    );
    if (run.lastInsertId === undefined) continue;
    await upsertConcepts(run.lastInsertId, date, entries);
    imported += 1;
  }
  return imported;
}

function upsertConcepts(runId: number, date: string, entries: BriefEntry[]): Promise<void> {
  const insert = async (e: BriefEntry) => {
    await db!.execute(
      `INSERT INTO concepts (run_id, date, title, body, source_candidate_ids)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(date, title) DO UPDATE SET
         run_id = excluded.run_id, body = excluded.body,
         source_candidate_ids = excluded.source_candidate_ids`,
      [runId, date, e.title, e.body, e.sources.length ? JSON.stringify(e.sources) : null],
    );
  };
  let chain = Promise.resolve();
  for (const e of entries) chain = chain.then(() => insert(e));
  return chain;
}

interface ConceptRow {
  id: number;
  date: string;
  title: string;
  body: string;
  source_candidate_ids: string | null;
  due_on: string | null;
  reviews: number | null;
  lapses: number | null;
  last_grade: string | null;
}

function toConcept(r: ConceptRow): Concept {
  return {
    id: r.id,
    date: r.date,
    title: r.title,
    body: r.body,
    sourceIds: r.source_candidate_ids ? (JSON.parse(r.source_candidate_ids) as string[]) : null,
    review: r.due_on === null ? null : {
      dueOn: r.due_on,
      reviews: r.reviews ?? 0,
      lapses: r.lapses ?? 0,
      lastGrade: r.last_grade,
    },
  };
}

const CONCEPT_COLUMNS = `c.id, c.date, c.title, c.body, c.source_candidate_ids,
  r.due_on, r.reviews, r.lapses, r.last_grade`;

/** The Library's list: with a query, FTS over titles and bodies ranked by
 *  bm25; without, every concept newest first. */
export async function loadConcepts(query: string): Promise<Concept[]> {
  if (!db) return [];
  const trimmed = query.trim();
  if (!trimmed) {
    const rows = await db.select<ConceptRow[]>(
      `SELECT ${CONCEPT_COLUMNS} FROM concepts c
       LEFT JOIN review_state r ON r.concept_id = c.id
       ORDER BY c.date DESC, c.id ASC`,
    );
    return rows.map(toConcept);
  }
  const match = trimmed
    .split(/\s+/)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" ");
  const rows = await db.select<ConceptRow[]>(
    `SELECT ${CONCEPT_COLUMNS} FROM concepts_fts f
     JOIN concepts c ON c.id = f.rowid
     LEFT JOIN review_state r ON r.concept_id = c.id
     WHERE concepts_fts MATCH $1
     ORDER BY rank, c.date DESC`,
    [match],
  );
  return rows.map(toConcept);
}

/** Seeds a concept into review, due tomorrow — the spec's first interval. */
export async function seedReview(conceptId: number, dueOn: string): Promise<void> {
  if (!db) return;
  await db.execute(
    `INSERT INTO review_state (concept_id, due_on) VALUES ($1, $2)
     ON CONFLICT(concept_id) DO UPDATE SET due_on = excluded.due_on`,
    [conceptId, dueOn],
  );
  emitDueChanged();
}

/** Removes a concept from review; its grade history goes with it. */
export async function unseedReview(conceptId: number): Promise<void> {
  if (!db) return;
  await db.execute(`DELETE FROM review_state WHERE concept_id = $1`, [conceptId]);
  emitDueChanged();
}

/** Screens that show due counts (the nav badge, the Review screen) hear
 *  about changes: seeding, unseeding, grading, and generation's auto
 *  seed all move due dates. */
type DueListener = () => void;
const dueListeners = new Set<DueListener>();

export function onDueChanged(cb: DueListener): () => void {
  dueListeners.add(cb);
  return () => {
    dueListeners.delete(cb);
  };
}

function emitDueChanged(): void {
  for (const cb of dueListeners) cb();
}

/** A review session's queue: the due concepts, oldest due first, at most
 *  ten — the spec's bounded check-in. */
export async function loadDueConcepts(today: string, limit = 10): Promise<Concept[]> {
  if (!db) return [];
  const rows = await db.select<ConceptRow[]>(
    `SELECT ${CONCEPT_COLUMNS}
     FROM review_state r
     JOIN concepts c ON c.id = r.concept_id
     WHERE r.due_on <= $1
     ORDER BY r.due_on ASC, c.id ASC
     LIMIT $2`,
    [today, limit],
  );
  return rows.map(toConcept);
}

/** Grades one concept and persists the reschedule. */
export async function applyReview(conceptId: number, grade: Grade): Promise<ReviewState> {
  if (!db) throw new Error("no store");
  const rows = await db.select<
    { interval_days: number; ease: number; reviews: number; lapses: number; last_grade: Grade | null; due_on: string; last_reviewed_at: string | null }[]
  >(`SELECT interval_days, ease, reviews, lapses, last_grade, due_on, last_reviewed_at
     FROM review_state WHERE concept_id = $1`, [conceptId]);
  const row = rows[0];
  if (!row) throw new Error("concept is not in review");
  const next = applyGrade(
    {
      dueOn: row.due_on,
      intervalDays: row.interval_days,
      ease: row.ease,
      reviews: row.reviews,
      lapses: row.lapses,
      lastGrade: row.last_grade,
      lastReviewedAt: row.last_reviewed_at,
    },
    grade,
    new Date(),
  );
  await db.execute(
    `UPDATE review_state
     SET due_on = $2, interval_days = $3, ease = $4, reviews = $5,
         lapses = $6, last_grade = $7, last_reviewed_at = $8
     WHERE concept_id = $1`,
    [
      conceptId,
      next.dueOn,
      next.intervalDays,
      next.ease,
      next.reviews,
      next.lapses,
      next.lastGrade,
      next.lastReviewedAt,
    ],
  );
  emitDueChanged();
  return next;
}

/** What the badge and the empty states need: how much is due now, what
 *  the next check-in holds, and gentle weekly progress. */
export interface DueOverview {
  due: number;
  inReview: number;
  next: { on: string; count: number } | null;
  learnedThisWeek: number;
}

export async function loadDueOverview(today: string): Promise<DueOverview> {
  if (!db) return { due: 0, inReview: 0, next: null, learnedThisWeek: 0 };
  const due = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM review_state WHERE due_on <= $1`, [today]);
  const inReview = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM review_state`);
  const next = await db.select<{ next_on: string; n: number }[]>(
    `SELECT due_on AS next_on, COUNT(*) AS n FROM review_state WHERE due_on > $1 GROUP BY due_on ORDER BY due_on ASC LIMIT 1`,
    [today],
  );
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const learned = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM review_state WHERE last_grade = 'got-it' AND last_reviewed_at >= $1`,
    [weekAgo],
  );
  return {
    due: due[0]?.n ?? 0,
    inReview: inReview[0]?.n ?? 0,
    next: next[0] ? { on: next[0].next_on, count: next[0].n } : null,
    learnedThisWeek: learned[0]?.n ?? 0,
  };
}

/** The exchanges behind a concept's sources, for the reader's expand. */
export async function loadCandidatesByIds(ids: string[]): Promise<Candidate[]> {  if (!db || ids.length === 0) return [];
  const rows = await db.select<CandidateRow[]>(
    `SELECT id, tool, session, cwd, ts, user_message, assistant_excerpt,
            score, user_score, assistant_bonus, signals
     FROM candidates WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(", ")})
     ORDER BY score DESC`,
    ids,
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
