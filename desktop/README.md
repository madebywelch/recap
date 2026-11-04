# recap desktop

A Tauri 2 shell for the learning-center app: where recap's output becomes screens you check in on instead of a markdown file you scroll once. This directory is the scaffold — lean plumbing, two screens proven end to end on committed fixtures, honest placeholders for the rest. The crew builds the real screens on top of it.

## What's real, what's placeholder

| Screen | Status | What it does today |
| --- | --- | --- |
| Daily Brief | real | Live: reads the persisted generation run for the scanned window, or offers "Write today's brief" when there isn't one. Generation runs the engine sidecar with the inference CLI, shows phase progress (scan → writing, elapsed, Cancel), and renders the result in the Folio card layout. Falls back to the committed fixture outside the shell. |
| Signal Explorer | real | Live data: the app scans on open via the bundled engine sidecar, upserts the scan into SQLite, and renders the store — every candidate with score and signal chips, filters (min score, tool, signal, date range, text), and the selected one's score arithmetic (user gate, assistant amplification, the cap called out) over the redacted exchange. Falls back to the committed fixture outside the shell. |
| Concept Library | real | Live: FTS5 search over every concept from past briefs, grouped by day, with a reader at reading measure that expands to the source exchange and links into the Explorer. On open, the store imports the shared archive (~/.claude/morning-recap) through the same parser generation uses — idempotent, so relaunching adds nothing — and pre-app entries carry an honest "no candidate data" note. Review seeding adds/removes the `review_state` row (due tomorrow, interval 1, ease 2.5). |
| Review | real | Live: a bounded session over what's due (at most ten, oldest first) — title and recall prompt only, Space reveals the explainer with the exchange one expand further, then Got it / Fuzzy / Lost it (1/2/3 on the keyboard). SM-2 reschedules every grade (ease 2.5 start, 1.3 floor, 90-day cap, lapses reset to tomorrow) with the confirmation line before moving on, and the session ends in a done-state with kept/lost counts, the next check-in, and weekly progress. A due-count badge rides the nav entry; a generated brief's concepts seed themselves, due tomorrow. |
| Settings | real | The inference CLI (auto, claude, codex, or a custom path), the generation timeout (60–900s), the augmented PATH display, and preflight detection so a missing CLI is never a surprise mid-generation. Persisted in settings.json next to the store. |
| First run | real | Shows once, before the app reads anything: what recap reads, that transcripts never leave the machine, that generation spends your own CLI tokens, and which inference CLI this machine has (or hasn't). Dismissal persists `onboarded` in settings.json, so it never shows again. |

Two app-level states ride above the screens. First run is the welcome sheet above. And when the bundled engine's envelope fails the version handshake or contract validation, the app refuses — a full-screen explanation of what mismatched, instead of silently rendering fixture data and pretending nothing happened.

No component libraries, plain CSS, no router — four screens don't need one. Markdown rendering uses `marked`; that is the only runtime dependency beyond React.

## Dev setup

Node 20+ and pnpm; Rust for the shell. On Linux, Tauri needs the webkit2gtk stack:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev build-essential libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Then, from this directory:

```sh
pnpm install
pnpm dev            # frontend only, in a browser — fixture data, no sidecar
pnpm sidecar        # build the recap Go engine as the sidecar for this platform
pnpm tauri dev      # the actual shell window (builds the sidecar first)
pnpm build          # typecheck (tsc) + production frontend bundle
pnpm test           # contract + filter tests (vitest)
pnpm sidecar && cargo check   # in src-tauri/; the Rust side needs the sidecar present
pnpm tauri build    # release shell + installers (builds the sidecar first)
```

`cargo check` and `cargo build` need the sidecar binary present — `externalBin` is a build input — so build it with `pnpm sidecar` first; `tauri dev` and `tauri build` do that automatically via their before-commands. Go and rustc are both required.

`pnpm dev` is enough to work on the screens: they call no Tauri APIs yet, so the browser build and the shell build are identical.

## Fixtures

The app runs on fixtures alone — no sidecar, no transcripts, no network.

- `fixtures/engine-scan.json` — literal `recap --raw` output from the engine on current main, run against six synthetic session transcripts (four Claude Code, two Codex). It is the versioned scan envelope from `docs/engine-json.md`: `engineVersion` stamped by the engine, structured per-signal reasoning (`signals` with `name`/`weight`/`side`), the `userScore`/`assistantBonus` split, stable candidate ids, and the legacy `signal_strings`. Every score in it is what `score.go` actually computed.
- `fixtures/engine-scan-corrupted.json` — the same payload with two deliberate contract violations (a required field removed, an invalid signal side). `src/fixtures.test.ts` proves validation rejects it.
- `fixtures/daily-brief.md` — the archive format `archive()` in `main.go` writes: `# Recap <timestamp>`, a blank line, the `_window: …_` metadata line, then the markdown body. The body here is hand-written in the style of the README's example output.

Both data fixtures load through `src/fixtures.ts`, which is also the client for the engine contract: the `ScanResult`/`Candidate`/`Signal` types mirror `docs/engine-json.md`, and `validateScanResult` checks every payload at load — hand-rolled guards, no validation library. The major version is the handshake: a payload stamped with a newer engine major than `SUPPORTED_ENGINE_MAJOR` is refused rather than rendered, since within a major the contract only ever adds fields. Swap the fixture import for sidecar output and the screens don't change.

## The engine ships as a sidecar

Wired, per docs/desktop-app-spec.md:

- **Build per target triple.** `scripts/build-sidecar.sh` (`pnpm sidecar`) builds the Go engine into `src-tauri/binaries/recap-<target-triple>` for the host platform; the before-commands in `tauri.conf.json` run it before `tauri dev` and `tauri build`, and the release bundler packs the platform-matching binary into the app. It also cross-compiles on demand — `pnpm sidecar aarch64-apple-darwin` builds the macOS binary from anywhere (Go cross-compiles the stdlib-only engine without cgo), which is the primary target's build path.
- **Register in config.** `"bundle": { "externalBin": ["binaries/recap"] }`. One Tauri constraint bit us: a sidecar may not share the name of the Cargo package, so the app crate is `recap-desktop` while the engine binary keeps the name `recap`.
- **Spawn from Rust.** The `run_scan` command in `src-tauri/src/main.rs` spawns the sidecar through the shell plugin with the spec's scan recipe — `--raw --days 1 --min-score -100 --top 0`, everything the engine scored, no cut — and returns its stdout. One wrinkle: the bundler flattens the externalBin path, so the binary lands *next to the app executable* as plain `recap`, and the spawn's program string is `"recap"` — not the `binaries/recap` from the config. The spawn is app-side Rust, so no shell permission is granted to the webview.
- **Validate, then store.** The frontend pushes the payload through `validateScanResult` (version handshake, shape guards), then upserts into SQLite via the SQL plugin — one `runs` row per scan, candidates keyed by the engine-stable id so a rescan replaces rather than duplicates. The schema is the `runs` + `candidates` tables from the spec's App storage section; the database file lives in the OS app-config dir for this app (`~/.config/com.madebywelch.recap/recap.db` on Linux). If the scan fails — no sidecar, no transcripts, engine too new — the app says so and shows the fixture.
- **PATH augmentation.** GUI-launched apps see a minimal PATH, so the spawn owns the environment per the spec: `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` go in front of the inherited PATH before the sidecar runs, keeping the engine's inference-CLI detection working when the app is launched from Finder/Dock.

## Generation and Settings

The Brief screen writes today's brief through the same sidecar: the `generate_brief` shell command runs `recap --days 1 --inference <cli> --timeout <N>` (the spec's generation invocation), forwards the engine's stderr phase events to the frontend, and returns the brief markdown from stdout. The frontend parses it with `src/brief.ts` — the same parser the archive uses, extended to accept header-less generation output — records the run (`raw_output`, `archive_path`, `inference_cli` in the runs table), and renders it. The engine writes the archive to the shared `~/.claude/morning-recap` dir exactly as the CLI does, so app users and cron users see the same history.

Cancellation is process-group clean: the app SIGTERMs the sidecar, the engine traps the signal and kills the inference CLI's whole process group (it starts the CLI with setpgid), and the app SIGKILLs after a grace period. Quitting the app mid-generation does the same. The Go side is covered by `inference_test.go`, which spawns a stub CLI with a grandchild, cancels, and asserts nothing survives.

Settings persist in `settings.json` next to the SQLite store: the inference CLI (auto, claude, codex, or a custom path passed to `--inference` and run claude-style), the timeout (60–900s), and the preflight detection display. The app spawns every sidecar run with the spec's augmented PATH, so the engine finds CLI installs GUI launches normally miss.

## Concept Library

The Library is the accumulating half of the learning center: every concept the engine has written lands in the `concepts` table, searchable end to end.

- **Concepts on generation.** Recording a generation also upserts its parsed entries into `concepts` (date, title, body, source ids) keyed by `(date, title)`, so regenerating a day replaces its explainers instead of stacking duplicates. The `concepts_fts` FTS5 index (external-content over `concepts`) is kept in sync by insert/update/delete triggers, per the spec's App storage schema.
- **First-run import.** On open, the store reads every `recap-*.md` in the shared archive dir through the `read_archives` shell command and parses each with the same `src/brief.ts` parser generation uses — one `runs` row per file with the header's window facts, then its concepts. Files the app itself recorded (their run row carries the archive path) are skipped, which is what makes the import idempotent: relaunching with the same history adds nothing. Entries whose brief omitted the `sources:` line — and pre-app runs generally — surface in the reader with an honest note that no candidate data is behind them.
- **Search and the reader.** The search box is an FTS5 MATCH over titles and bodies, bm25-ranked; the list groups by day with a review chip per seeded concept. The reader shows the full explainer at reading measure, the review status with add/remove (a `review_state` row: due tomorrow, interval 1, ease 2.5 — the Review screen in M5 grades against it), and the source exchange, with "Open in Signal Explorer" when the source is in the current scan window.

## Review

The check-in that makes the brief stick: active recall over what's due, graded into SM-2 — the Anki grandfather, nothing fancier.

- **The session.** At most ten due concepts, oldest due first: only the concept's name and the recall prompt, Space (or the button) reveals the explainer, the exchange sits one expand further, and Got it / Fuzzy / Lost it grade — 1/2/3 on the keyboard. Each grade confirms the reschedule ("Kept — next review in 8 days") before moving on, and the session ends in a real done-state: kept and lost counts, the next check-in, and a gentle weekly row. No streaks, no reminders, nothing to feel guilty about skipping.
- **Scheduling.** `src/review.ts` is the spec's SM-2 table exactly: quality 5/3/1, ease starting at 2.5 updating as `ease += 0.1 − (5−q) × (0.08 + (5−q) × 0.02)` (floored at 1.3), intervals first success 1 day, second 6, then previous × ease capped at 90 days; Lost it resets to tomorrow and counts a lapse. The success streak is encoded in the stored interval, so a concept relearns from the first rung after a lapse. All state persists in `review_state` and survives restarts.
- **Seeding.** A generated brief's concepts enter review automatically the day they're written (due tomorrow; a manual seed's schedule is never overwritten), and the Library's add/remove keeps working. The nav entry carries the due count, refreshed whenever seeding, grading, or a generation moves due dates.

## Releases and signing

The macOS build — aarch64-apple-darwin, the primary target — is produced by [`/.github/workflows/release.yml`](../.github/workflows/release.yml). Run it manually (workflow_dispatch) and the dmg lands as a run artifact; push a `v*` tag and it also publishes a GitHub Release with the dmg attached. The workflow is the only place the macOS bundle is built: a Linux dev box cross-compiles the sidecar but never the app.

**The build is unsigned by default.** The workflow needs no credentials to run and sends nothing to Apple; the bundle is ad-hoc signed instead (`signingIdentity: "-"` in tauri.conf.json), so its seal is valid without an Apple identity. On first open, Gatekeeper still stops an unidentified developer — but on current macOS the working paths are System Settings → Privacy & Security → Open Anyway, or clearing the quarantine flag outright:

```sh
xattr -dr com.apple.quarantine /Applications/Recap.app
```

Right-click → Open no longer bypasses Gatekeeper on recent macOS, and a quarantined bundle with a broken signature reads as "damaged" rather than "unidentified" — which is why the release workflow fails the job unless `codesign --verify --deep --strict` passes on the whole bundle, sidecar included.

### Signing and notarization

Tauri reads Apple credentials from the environment, and the release workflow passes through exactly the non-empty `APPLE_*` repository secrets — so real signing and notarization turn themselves on when the secrets exist, and the build stays ad-hoc signed when they don't:

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | The signing certificate as base64 of the `.p12` file: `openssl base64 -A -in Cert.p12 -out cert-base64.txt` |
| `APPLE_CERTIFICATE_PASSWORD` | The password used when exporting that `.p12` |
| `APPLE_SIGNING_IDENTITY` | The identity to sign with, e.g. `Developer ID Application: Your Name (TEAMID)`; replaces the config's ad-hoc default when set |
| `APPLE_ID` | The Apple ID that notarizes |
| `APPLE_PASSWORD` | An app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | The team the certificate belongs to |

Signing needs the first three; notarization additionally needs the last three. Add them as repository secrets and the next release run signs and notarizes with no workflow change. Unsigned-by-default is deliberate: whether recap stays a personal tool or becomes a public product is undecided, and an unsigned build answers both.

## What remains for later milestones

- The release workflow ships macOS only; packaging for other platforms waits on the same decision as signing.
- The fixtures stay: offline test data, the shape contract for the engine's output, and the corrupted copy that keeps proving the validator rejects bad payloads.

## Project layout

```
fixtures/          daily-brief.md (archive format), engine-scan.json + corrupted copy (the --raw envelope)
scripts/           build-sidecar.sh (engine binary as the Tauri sidecar)
src/               React frontend
  fixtures.ts      engine contract client: types, validateScanResult, fixture imports
  fixtures.test.ts contract validation tests (vitest)
  brief.ts         the archive/generation entry parser + Brief presentation helpers
  brief.test.ts    its tests
  explorer-filters.ts  pure Explorer filter + arithmetic helpers
  explorer-filters.test.ts their tests
  generation.ts    generation client: settings, detection, generate/cancel, error classification
  store.ts         scan → validate → SQLite upsert → load; brief run persistence; concepts + FTS + review seeding; the archive import; fixture fallback
  useExplorer.ts   Explorer state (filters, selection)
  useBrief.ts      Daily Brief state machine (ready / cta / generating / error)
  useLibrary.ts    Library state (FTS search, reader, review seeding)
  useReview.ts     Review session (queue, reveal, grades, done-state)
  review.ts        SM-2 scheduling (pure; graded sequences tested)
  App.tsx          sidebar nav, launch scan, screen switch
  screens/         DailyBrief, SignalExplorer, ConceptLibrary, Review, Settings
src-tauri/         the Rust shell
  src/main.rs      plugins + commands: run_scan, generate/cancel with phase events, settings, detection, read_archives
  tauri.conf.json  window, build commands, externalBin
  capabilities/    main-window permissions (core, sql)
  binaries/        sidecar build output (gitignored)
```
