# recap desktop

A Tauri 2 shell for the learning-center app: where recap's output becomes screens you check in on instead of a markdown file you scroll once. This directory is the scaffold — lean plumbing, two screens proven end to end on committed fixtures, honest placeholders for the rest. The crew builds the real screens on top of it.

## What's real, what's placeholder

| Screen | Status | What it does today |
| --- | --- | --- |
| Daily Brief | real | Parses `fixtures/daily-brief.md` (the archive format from `main.go`: header line, window line, markdown body) and renders it as the day's brief, with the run's metadata from the header. |
| Signal Explorer | real | Live data: the app scans on open via the bundled engine sidecar, upserts the scan into SQLite, and renders the store — every candidate with score and signal chips, filters (min score, tool, signal, date range, text), and the selected one's score arithmetic (user gate, assistant amplification, the cap called out) over the redacted exchange. Falls back to the committed fixture outside the shell. |
| Concept Library | placeholder | Not built yet. The plan: concept entries harvested from past briefs, deduplicated, linked back to the sessions where they came up. |
| Review | placeholder | Not built yet. The plan: a short daily pass over saved concepts, drawn from your own sessions. |

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

## What remains for later milestones

- **M3 — generation.** The `brief` screen still reads the committed fixture. The sidecar's generation run (`recap --days 1`) with its stderr phase events and the archive-file read-back replaces it; the explorer's `raw_output`/`archive_path` columns are already in the runs table.
- **M4/M5 — Library and Review.** The `concepts`, `review_state`, and FTS tables join this database when those screens are built.
- The fixtures stay: offline test data, the shape contract for the engine's output, and the corrupted copy that keeps proving the validator rejects bad payloads.

## Project layout

```
fixtures/          daily-brief.md (archive format), engine-scan.json + corrupted copy (the --raw envelope)
scripts/           build-sidecar.sh (engine binary as the Tauri sidecar)
src/               React frontend
  fixtures.ts      engine contract client: types, validateScanResult, fixture imports, brief parsing
  fixtures.test.ts contract validation tests (vitest)
  explorer-filters.ts  pure Explorer filter + arithmetic helpers
  explorer-filters.test.ts their tests
  store.ts         scan → validate → SQLite upsert → load; fixture fallback
  App.tsx          sidebar nav, launch scan, screen switch
  screens/         DailyBrief, SignalExplorer, ConceptLibrary, Review, Placeholder
src-tauri/         the Rust shell
  src/main.rs      plugins + the run_scan sidecar command
  tauri.conf.json  window, build commands, externalBin
  capabilities/    main-window permissions (core, sql)
  binaries/        sidecar build output (gitignored)
```
