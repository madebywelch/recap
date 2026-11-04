# Recap desktop app spec

recap today is a morning CLI: it scans yesterday's Claude Code / Codex transcripts, scores each (user message, assistant turn) pair for learning-moment likelihood, pipes the top candidates to the user's own `claude` or `codex` CLI, and archives 4–6 concept explainers as a dated markdown file. This spec turns that into a desktop learning center: the same engine, the same local-first rules, but with a place to check in, read what was learned, see *why* the engine picked what it picked, and review it until it sticks.

The engine stays Go and stays a CLI. The app is a Tauri 2 + React frontend that treats the engine as a bundled sidecar binary. No accounts, no cloud, no telemetry. Transcripts never leave the machine except through the inference CLI the user already trusts.

## What exists today (the contract we build on)

- `recap --raw` prints scored candidates as JSON: `Pair{tool, session, cwd, ts, user, assistant_excerpt, score, signals[]}` — signals are strings like `"wh-question:+3"`.
- Scoring (`score.go`): user-side signals gate a candidate (`reactive +4`, `wh-question +3`, `confusion +3`, `error-paste +2`, `question +1`, demotions `imperative -1`, `ui-feedback -1`, `long -1/-2`, `slash-command -3`); assistant signals only amplify a positive user score (`assistant-depth +1/+2`, `assistant-code +1`, `assistant-explains +1`, `assistant-thin -1`) and are clamped to the user score by `assistant-cap`.
- Redaction (`redact.go`) runs inside the parser, so every `Pair` that leaves the engine is already redacted (`sk_` keys, GitHub/Slack/AWS/Google tokens, JWTs, bearer headers, `key: value` forms, private key blocks, long hex blobs → `[REDACTED]`).
- Inference (`inference.go`): detect `claude` or `codex` on PATH, pipe the prompt via stdin to `claude -p` / `codex exec -`, kill on timeout (default 240s).
- Archive: `~/.claude/morning-recap/recap-YYYY-MM-DD.md`, plain markdown with a one-line header. Nothing is uploaded anywhere.
- The explainer format is stable and parseable: blank-line-separated paragraphs, each entry opening with `**Bold concept name.**`.

A parallel thread is refactoring the engine into a package whose `--raw` JSON gains a structured `signals` field; the client types below are the contract that refactor must satisfy. A scaffold thread is creating the Tauri 2 + React shell under `desktop/` with placeholder nav for the four screens and fixture-driven views. This spec sequences on top of both.

## Stack

### Tauri 2, not Electron — confirmed

The Captain's lean is right. Recap is a daily companion the user opens over coffee: it should start instantly, sit quietly, and install small next to dev tooling. Tauri 2 gives that (~10–15 MB bundles vs 100 MB+, no bundled Chromium) and — the deciding factor — has first-class support for bundling and spawning an external binary (the "sidecar"), which is exactly the shape our Go engine needs. React runs identically in both, so the frontend choice is unaffected.

The honest costs, so nobody is surprised later:

- **Webview variance.** Tauri uses the OS webview: WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux. Rendering is *mostly* uniform but not bit-identical; stick to standard CSS, avoid bleeding-edge web APIs, and test on every target OS. WebKitGTK is the weakest link — Linux is best-effort until someone asks for it.
- **Rust toolchain in CI.** Builds need `cargo` plus the Tauri CLI; GitHub Actions handles this fine but it's a second toolchain to maintain.
- **Auto-update needs signing keys** (`tauri-plugin-updater` requires a signing keypair and published manifests). Electron's updater story is more turnkey. See Open decisions.

### The Go engine ships as a sidecar — confirmed

Three options were on the table:

- **Sidecar (recommended, chosen).** The engine is compiled per target platform, named with the Tauri target-triple suffix (e.g. `recap-x86_64-apple-darwin`), declared in `tauri.conf.json` `externalBin`, and spawned by the app on demand. The CLI surface is the app↔engine protocol — no new RPC layer to invent, crash isolation for free, and the engine keeps working standalone for cron users. The engine team works in Go; the app team in TypeScript; the only shared artifact is the JSON contract below.
- **Local daemon.** A resident `recap` server the app talks to. The workload is one bursty scan a day (sub-second, per the README) — a resident process buys nothing and costs lifecycle management: who starts it, what happens after an app upgrade leaves a stale daemon, socket/port conflicts. Rejected.
- **Port the engine to Rust/TS.** Throws away a tested Go engine (`parse_test.go`, `score_test.go`, the redaction patterns), duplicates the heuristics in a second language forever, and breaks the CLI. Rejected.

Version skew between app and bundled engine is handled by a handshake: the engine reports its version in every JSON response, and the app refuses to render payloads from a newer major version than it understands.

### App ↔ engine invocation contract

The app only ever spawns the bundled sidecar and parses stdout/stderr. Keeping the engine invocable exactly as today is a requirement — the CLI must survive unchanged for cron users — so the app uses the existing flag surface, extended where marked:

| App action | Invocation today | Notes |
| --- | --- | --- |
| Scan + score | `recap --raw --days 1 --min-score -100 --top 0` | `--min-score -100` + `--top 0` = everything the engine scored, no cut (the same recipe the README documents for recalibration). App persists all of it for Signal Explorer. |
| Generate brief | `recap --days 1 --timeout <N>` | Engine rescans (sub-second), pipes top candidates to the inference CLI, prints markdown on stdout, writes the archive. |
| Engine version | emitted in the JSON envelope | **New (engine thread)**: required. |

Additions the engine refactor must provide (all small, all additive): structured `signals` on each candidate, a stable `id` per candidate, a scan-stats envelope around the candidate array, its version string, and phase events on stderr during generation (single-line JSON, see *Inference*). If the engine team prefers to surface these as subcommands (`recap scan --all`, `recap run`) over flags, that's their call — the app only needs the semantics.

## Data model

### Engine JSON — the client-side contract

```ts
export type SignalName =
  | "reactive" | "wh-question" | "confusion" | "error-paste" | "question"
  | "imperative" | "ui-feedback" | "long" | "slash-command"
  | "assistant-depth" | "assistant-code" | "assistant-explains"
  | "assistant-thin" | "assistant-cap";

export type SignalSide = "user" | "assistant";

export interface Signal {
  name: SignalName;
  weight: number;       // signed, as applied — e.g. assistant-cap carries the clamped remainder
  side: SignalSide;     // redundant with name, but explicit for the UI
}

export interface Candidate {
  id: string;            // stable across rescans of the same window (see below)
  tool: "claude" | "codex";
  sessionId: string;
  cwd: string | null;
  ts: string;            // RFC3339
  userMessage: string;   // redacted before it ever left the parser
  assistantExcerpt: string; // redacted; head+tail truncated by the engine
  score: number;
  userScore: number;     // user-side sum — the gate
  assistantBonus: number; // assistant-side sum *after* the cap; always <= userScore
  signals: Signal[];     // structured — this is the new field the engine refactor adds
}

export interface ScanResult {
  engineVersion: string;
  scannedAt: string;     // RFC3339
  since: string;         // YYYY-MM-DD
  tools: Array<"claude" | "codex">;
  sessions: number;
  pairs: number;
  candidates: Candidate[];
}
```

`userScore` and `assistantBonus` as separate fields are what make the score *arithmetic* displayable: Signal Explorer shows the gate, each fired signal, the amplification, and the clamp without recomputing anything. The legacy string-array `signals` field may remain alongside for CLI readability; the app ignores it when the structured field is present.

**Stable candidate ids.** Requirement: scanning the same window twice yields identical ids, so the app can upsert instead of duplicating rows. Suggested scheme (engine team owns the final call): first 16 hex chars of SHA-256 over `tool|session|ts-unix-nano|dedupKey(user)` — the existing normalized-user-text dedup key from `score.go`.

**Explainer→source linkage** (which candidates produced which concept) does not exist today: the inference prompt asks for concepts, not citations. It stays out of v1. When wanted, the engine adds candidate ids to the prompt payload and a trailing `sources:` marker per entry; the parser below tolerates its absence.

### App storage

SQLite, one file in the OS app-data dir (`~/Library/Application Support/recap`, `%APPDATA%\recap`, `~/.local/share/recap`), via Tauri's SQL plugin. The plain-markdown archive remains the portable source of truth — SQLite is an index over it, not a vault. The app keeps writing to the shared default archive dir (`~/.claude/morning-recap`), so CLI users and app users see the same history.

```sql
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,     -- RFC3339
  finished_at TEXT,
  since TEXT NOT NULL,           -- YYYY-MM-DD
  tools TEXT NOT NULL,           -- "claude+codex"
  sessions INTEGER, pairs INTEGER,
  status TEXT NOT NULL,          -- scanning | generating | done | failed | cancelled
  inference_cli TEXT,            -- null for scan-only runs
  archive_path TEXT,            -- recap-YYYY-MM-DD.md written by the engine
  raw_output TEXT                -- full markdown stdout from generation
);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,           -- engine-stable id
  run_id INTEGER NOT NULL REFERENCES runs(id),
  tool TEXT, session TEXT, cwd TEXT, ts TEXT,
  user_message TEXT NOT NULL,       -- redacted
  assistant_excerpt TEXT NOT NULL,  -- redacted
  score INTEGER NOT NULL,
  user_score INTEGER NOT NULL,
  assistant_bonus INTEGER NOT NULL,
  signals TEXT NOT NULL            -- JSON array of Signal
);

CREATE TABLE concepts (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  date TEXT NOT NULL,           -- YYYY-MM-DD
  title TEXT NOT NULL,           -- "Bold concept name." without markup
  body TEXT NOT NULL,            -- full explainer paragraph
  source_candidate_ids TEXT      -- JSON array; null until linkage exists
);

CREATE TABLE review_state (
  concept_id INTEGER PRIMARY KEY REFERENCES concepts(id),
  due_on TEXT NOT NULL,           -- YYYY-MM-DD
  interval_days REAL NOT NULL DEFAULT 1,
  reviews INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_grade TEXT,                -- got-it | fuzzy | lost-it
  last_reviewed_at TEXT
);

CREATE VIRTUAL TABLE concepts_fts USING fts5(
  title, body, content='concepts', content_rowid='id'
);
-- concepts_fts is an external-content index: keep it in sync with
-- insert/update/delete triggers on concepts.
```

Size sanity: ~200 candidates/day at ~2 KB each plus ~5 concepts/day is ~150 MB/year — fine for SQLite, and candidates below a floor score (default −2) can be pruned by a retention job if it ever matters. Concepts are never pruned automatically.

**Markdown entry parser.** Generation output is parsed with a documented grammar: split on blank lines; a paragraph whose first line matches `^\*\*(.+?)\.\*\*` starts an entry — captured group is the title, the rest is the body; non-matching leading paragraphs are discarded (prompt violations), and a paragraph without a bold opener is appended to the current entry's body. Fixtures for this parser come from real runs, including a deliberately malformed one.

## The four screens

### Daily Brief

The default screen, and what the app is opened for. A header strip carries the run facts the archive header carries today — window, tools, sessions scanned, pairs, candidates, inference CLI — so the day's brief is self-describing. Below it, the day's 4–6 explainer entries as stacked cards: bold concept name, dense 3–5-sentence body, markdown rendered (code spans styled, no other sources). If the window has been scanned but no brief generated yet, the screen shows the candidate count and a single primary action, "Write today's brief," which starts the generation flow. If the day is quiet, it says so plainly ("Nothing in the last day's sessions — your recap would be empty. That's correct behavior, not a bug."). Every card carries two secondary actions: "Review this" (seeds the concept into review state) and a link to the concept in the Library. When a brief is being generated, the card list is replaced by the progress panel described under *Inference*.

### Concept Library

The searchable archive of everything learned so far — the accumulating half of "learning center." A search box (FTS over titles and bodies) plus a date-grouped list: day headers, one row per concept (title, first sentence, review status chip). Clicking opens a reader view with the full explainer, its date, its review status ("due in 3 days", "not in review"), and actions to add/remove it from review. On first run, the Library imports the existing `recap-*.md` files from the shared archive dir using the same entry parser as generation, so a user with months of CLI history sees it immediately — with an honest note that pre-app runs have no candidate data behind them. The Library is also where duplicates surface; cross-day concept merging ("APN config" appearing three weeks apart) is deliberately out of scope for v1 — each explainer is an entry.

### Signal Explorer

The centerpiece: the heuristics engine made visible. A two-pane screen. The left pane lists every candidate the engine scored for the scanned window — score, tool, timestamp, user-message snippet — with filters above it: minimum-score slider, per-signal checkboxes (show me everything `confusion` fired on), tool, date range, text search. Selecting a row fills the right pane with the score arithmetic, top to bottom: the user score with each fired signal as a signed chip (`wh-question +3`, `question +1`, `imperative −1`), then the assistant block (`assistant-depth +2`, `assistant-code +1`, `assistant-explains +1`, and when the bonus exceeded the user score, the clamp called out explicitly — "assistant bonus capped at 3 — the reply can amplify a learning moment, never create one"), then the total. Below the arithmetic, the full redacted exchange — user message and assistant excerpt in a monospace block — plus session metadata (tool, session id, cwd, time). This is the `--raw` promise ("a surprising rank is diagnosable in one look") as a first-class UI, and it doubles as the calibration tool: dump a week, drag the score slider, and see exactly what the thresholds do.

### Review

Spaced check-ins so the brief actually sticks. The mechanism is prompted self-recall, not rereading: a session pulls up to 10 due concepts (oldest due first) and shows only the bold concept title with the prompt "Say what this is and how it works, out loud or in your head." The user clicks "Show answer" to reveal the full explainer, then self-grades with three buttons: **Got it**, **Fuzzy**, **Lost it**. After each grade the app confirms the reschedule ("next review in 8 days") and moves on; a session ends with a summary (x got it, y fuzzy, z lost it) and the current streak (consecutive days with ≥1 graded item). Scheduling is Leitner-style fixed intervals, chosen deliberately over FSRS/SM-2 — three self-grades are too coarse to feed a fancy scheduler, and the mechanism should stay explicable to the user who just asked "why 8 days":

| Grade | Effect on interval | Due |
| --- | --- | --- |
| (new concept) | starts at 1 day | tomorrow |
| Got it | interval × 2.5, rounded (1 → 3 → 8 → 20 → 50 → 90, capped) | now + interval |
| Fuzzy | interval × 1.2, minimum 1 day | now + interval |
| Lost it | reset to 1 day, `lapses++` | tomorrow |

All state lives in `review_state` keyed by concept id, so it survives app reinstalls alongside the SQLite file. New concepts enter review automatically the day they're generated (the "tomorrow" of the learning loop), or manually from any concept card. The nav badge shows the due count; the empty state is "Nothing due today — next: N tomorrow."

### Navigation

A persistent left sidebar with the four sections — Daily Brief (default), Concept Library, Signal Explorer, Review (with due badge) — matching the scaffold's placeholder nav, plus keyboard shortcuts ⌘/Ctrl+1–4. Cross-links carry the loop: a Brief card links to its Library entry; a Library entry links to its review status; a Review item links to the full Library entry for re-reading; an Explorer row is a dead end until explainer→source linkage exists, at which point Library entries gain "see the exchange that produced this." Back behaves like a browser history per pane; deep links (e.g., open a concept by id from a notification) map to `library/<id>`.

## The learning loop, end to end

1. **Open the app.** On launch, the app runs a local scan via the sidecar (`--raw --days 1 --min-score -100 --top 0`). Scanning is local, sub-second, and free — it auto-runs on open. The scan populates Signal Explorer and the candidate store.
2. **Write the brief.** Generation is always an explicit action (it spends the user's own CLI tokens; the app never triggers it unprompted). The engine rescans, dedups, and pipes the top 30 candidates to the user's `claude` or `codex`; the app shows progress, then parses the markdown into concepts, stores them, and the engine writes the dated archive file in the shared dir. Daily Brief now shows today's 4–6 entries. The markdown file on disk remains the portable artifact — cat it, grep it, sync it anywhere.
3. **Check in and learn.** The user reads the Brief, wanders into Signal Explorer to see why the engine chose what it chose (and to calibrate by browsing), and the day's concepts are automatically seeded into review, due tomorrow.
4. **Tomorrow it comes back.** On next open: fresh scan, fresh brief, and Review shows what's due. Grading reschedules — got-it items fade toward 90-day intervals, lost ones return tomorrow. The loop is: generate → read → sleep → recall.

Local-first throughout: no accounts, no cloud, no telemetry. The app itself makes no network calls; the only network is the user's own inference CLI sending redacted candidates through their own account, exactly as the CLI does today. Redaction happens inside the parser before the engine ever emits a pair — so the app's SQLite store only ever holds `[REDACTED]`-scrubbed text. The archive is plain markdown in a known location. A "reset app data" command clears SQLite while leaving the archive untouched.

## Inference in a desktop context

**Detection.** The engine detects `claude`/`codex` via `PATH` lookup — which breaks in the classic desktop way: an app launched from Finder/Dock gets a minimal GUI environment PATH and won't see `~/.local/bin` or npm-global installs. The app therefore owns the environment it spawns the sidecar with: it augments `PATH` with the common install locations (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, the user's npm global bin if discoverable) before spawning, and Settings exposes **Inference CLI: auto | claude | codex | custom path**, passed through as `--inference`. Preflight surfaces detection results *before* generation: Settings shows which CLI was found and where, so "no CLI installed" is never a surprise mid-generation.

**States during generation.** The progress panel on Daily Brief shows the current phase and elapsed time, with a Cancel button. The engine emits phase transitions on stderr as single-line JSON events — `{"event":"scan_done","sessions":12,"pairs":340,"candidates":58}` and `{"event":"inference_start","cli":"claude","timeout_s":240}` — which is the only engine addition here, and the app degrades gracefully to an indeterminate spinner if events are absent (old sidecar).

| State | Display | User recourse |
| --- | --- | --- |
| No CLI installed | Blocking panel on generation: "Generation needs the `claude` or `codex` CLI. Scanning and the Signal Explorer still work." | Install a CLI, or set a custom path in Settings |
| Explicit CLI not on PATH | Same panel, naming the missing CLI | Fix path or switch to auto |
| Running | Phase + elapsed + candidates count + CLI in use | Cancel |
| Timeout (default 240s, configurable 60–900s) | "Timed out after Ns — the CLI didn't finish." | Raise timeout in Settings and retry |
| Nonzero exit / stderr output | Error card with stderr shown in a collapsible | Retry; raw text is inspectable |
| No candidates in window | Not an error — Daily Brief empty state | Widen the window (`--days 3`) and rescan |
| Output parses to zero entries | "Generation returned nothing usable" with raw output viewable | Retry; parser fix if format drift |

**Process hygiene.** Cancellation must not orphan the inference child. The engine should run the CLI in a process group (setpgid) and kill the group on timeout — it already kills the child on timeout today; the desktop addition is that the app killing the *sidecar* must also take down the CLI. The app treats generation as idempotent per day: re-running overwrites the day's archive file, exactly as the CLI does.

## Build order

Each milestone is a PR-sized unit with a hard exit criterion; M2 and M3 are the largest and may split in two. M0 is the scaffold thread's shell (in flight): Tauri 2 + React, placeholder nav, fixture-driven screens.

1. **M1 — Engine contract + client types.** Engine refactor lands the structured `signals`, stable `id`, scan envelope, version string (engine thread). App side: `Candidate`/`ScanResult` types with runtime validation, plus a real fixture — actual `recap --raw --days 7` output committed under `desktop/src/fixtures/` — replacing scaffold placeholders. *Exit: types validate the fixture; fixture renders in the scaffold screens.*
2. **M2 — Sidecar integration + Signal Explorer.** Bundle the engine as `externalBin` with target-triple names, spawn from a Rust command, ingest a real scan into SQLite, and make Signal Explorer render live data: list, filters, score arithmetic, redacted exchange. *Exit: opening the app on a machine with real transcripts shows the actual scored window.*
3. **M3 — Generation pipeline + Daily Brief.** Settings (inference CLI, timeout, PATH augmentation), generate flow with progress/cancel/error states, markdown entry parser with fixtures, run persistence, real Daily Brief. *Exit: end-of-day demo — open app, scan, generate, read the brief, archive file written to the shared dir.*
4. **M4 — Concept Library.** FTS search, date grouping, reader view, review seeding, first-run import of existing archives. *Exit: a month of CLI history imports and is searchable.*
5. **M5 — Review.** Session UI, three-button grading, scheduling table, streak, badge, empty states. *Exit: a graded session reschedules correctly and survives app restart.*
6. **M6 — First releasable build.** Packaging (dmg/msi/deb per OS decision), first-run onboarding (what recap reads, what generation costs, which CLI), CLI detection hardening on a clean machine, signing per Robert's decision, version handshake enforcement. *Exit: a non-developer installs it and gets a brief on day one.*

Sequencing rationale: Signal Explorer first because it's pure-local (no inference dependency) and exercises the whole sidecar contract early, de-risking the engine refactor; inference next; the accumulation features (Library, Review) last because they need days of real data to be meaningfully testable.

## Open decisions for Robert

1. **OS targets and order.** Recommendation: macOS first (the transcript paths, the CLIs, and the current user base are all Mac-centric), Windows second (WebView2 is solid; `HOME` resolves to `%USERPROFILE%` in Go so the engine scans work), Linux best-effort. Each target adds CI and signing surface — his call on how far v1 goes.
2. **Installer signing and updates.** Distributing beyond his own machines means Apple Developer ID + notarization ($99/yr) or Gatekeeper will scare users; Windows signing costs more; the Tauri updater requires signing keys and update infrastructure. Recommendation: unsigned/ad-hoc builds for v1 if it's personal + friends, decide on signing before any public release. Needs his intent: personal tool or public product?
3. **CLI + app coexistence.** Recommendation: the app always uses its bundled sidecar (never a PATH `recap`, which would version-skew), and both write to the shared `~/.claude/morning-recap` archive. Cron users keep the CLI. Confirm he's happy with two binaries sharing one archive dir.
4. **Auto-scan on open.** Recommendation: yes for the candidate scan (local, free, fast), never for generation (spends his CLI tokens). Confirm.
5. **Direct API-key inference in the app.** Out of scope for v1 — the README's "no API keys, inherits your CLI auth" story is a feature, and in-app keys mean secret-handling obligations. Flagging in case he wants it eventually.
6. **Per-candidate "explain this exchange."** A natural learning-center extension: run inference on one Explorer row on demand. Needs a small engine addition (generate from explicit candidate ids). Cheap, but it's new engine surface — defer until v1 ships unless he wants it sooner.

## Risks

- **Transcript format drift.** Both source formats are undocumented internals (README says so). The parser tolerates unknown fields, but a major schema break needs an engine fix. Mitigation: the app surfaces scan failures as readable states and shows the engine version, so breakage is diagnosable, not mysterious.
- **Model output format drift.** The entry parser is tolerant, but a model that ignores the format yields fewer salvageable entries. Mitigation: salvage parsing, raw output always inspectable, fixtures for the malformed case.
- **GUI PATH detection.** The classic desktop failure: `claude` installed but invisible to a GUI-spawned process. Mitigated by augmentation + explicit setting + preflight display; residual risk is exotic install locations.
- **Webview variance** across Tauri targets — kept to standard CSS; macOS and Windows get tested, Linux is best-effort.
- **Orphaned processes** on cancel/quit if process-group handling is wrong on any platform — needs explicit tests (spawn, cancel, verify no surviving `claude`/`codex` process).
- **DB growth** if every sub-threshold candidate is kept forever — bounded by the numbers above; a retention prune is a one-liner if it ever matters.
- **The loop depends on opening the app.** Review schedules don't nag; a week unopened just means a bigger due batch next time. If adherence matters later, that's a notifications decision, not a schema change.
- **Scope pull toward "learning center."** Quizzes, streak mechanics, spaced decks — the pull is real. v1 is generate → read → recall; everything else waits for evidence it's used.
