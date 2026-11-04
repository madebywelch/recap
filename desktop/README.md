# recap desktop

A Tauri 2 shell for the learning-center app: where recap's output becomes screens you check in on instead of a markdown file you scroll once. This directory is the scaffold — lean plumbing, two screens proven end to end on committed fixtures, honest placeholders for the rest. The crew builds the real screens on top of it.

## What's real, what's placeholder

| Screen | Status | What it does today |
| --- | --- | --- |
| Daily Brief | real | Parses `fixtures/daily-brief.md` (the archive format from `main.go`: header line, window line, markdown body) and renders it as the day's brief, with the run's metadata from the header. |
| Signal Explorer | real | Renders `fixtures/candidates.json` as a list/detail view: every candidate with its score and signal chips, the selected one showing the redacted exchange and the score arithmetic. First rough visual of the heuristics engine. |
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
pnpm dev            # frontend only, in a browser — the screens work here
pnpm tauri dev      # the actual shell window
pnpm build          # typecheck (tsc) + production frontend bundle
cargo check          # in src-tauri/, the Rust side compiles
pnpm tauri build    # release shell + installers
```

`pnpm dev` is enough to work on the screens: they call no Tauri APIs yet, so the browser build and the shell build are identical.

## Fixtures

The app runs on fixtures alone — no sidecar, no transcripts, no network.

- `fixtures/daily-brief.md` — the archive format `archive()` in `main.go` writes: `# Recap <timestamp>`, a blank line, the `_window: since … | tools: … | sessions: … | pairs: … | candidates: … | inference: …_` line, then the markdown body. The body here is hand-written in the style of the README's example output.
- `fixtures/candidates.json` — literal `recap --raw` output. It was produced by running the real engine against six synthetic session transcripts (four Claude Code, two Codex), so every `name:+N` signal string and every score is what `score.go` actually computed — the arithmetic the Signal Explorer shows is engine-true, not hand-typed.

Both are loaded as static Vite imports (`?raw` for the markdown, JSON import for the candidates) and parsed in `src/fixtures.ts` — that module is the only place that knows the fixture shapes. Swap its internals for sidecar output and the screens don't change.

## Shipping the engine as a sidecar

The recap Go binary will ship inside the app as a Tauri sidecar. The plan, not yet wired:

- **Build per target triple.** `externalBin` entries resolve as `<name>-<target-triple>`, so `src-tauri/binaries/` (currently a stub with just this README) receives `recap-aarch64-apple-darwin`, `recap-x86_64-pc-windows-msvc.exe`, `recap-x86_64-unknown-linux-gnu`, and so on. Build them with `GOOS`/`GOARCH` or a script in `beforeBuildCommand`.
- **Register in config.** `tauri.conf.json` has the stub path already: `"bundle": { "externalBin": [] }`. When the binary exists, it becomes `["binaries/recap"]` and Tauri bundles the platform-matching copy into the app.
- **Spawn from the frontend.** Tauri 2 sidecars run through the shell plugin (`tauri-plugin-shell` in Cargo.toml, `@tauri-apps/plugin-shell` in package.json) via `Command.sidecar("binaries/recap", args)`. The capability in `src-tauri/capabilities/default.json` then needs `shell:allow-execute` scoped to that sidecar name — core:default alone doesn't grant it.
- **Dev vs release.** Release bundling is automatic once `externalBin` is set. Dev needs the same platform-suffixed binary present on disk, so the first wiring change should be a small script (make target or `beforeDevCommand` prefix) that builds it from the Go checkout before `tauri dev` starts.

## Wiring the real engine later

When the sidecar exists, the change is small and contained:

1. Add the shell plugin (Rust dependency + `tauri.plugin()` registration + JS package) and the scoped capability above.
2. Replace the two exports at the top of `src/fixtures.ts`: `brief` becomes the output of `recap --days 1` (or a cached archive file read back), `candidates` the stdout of `recap --raw`. The parse functions and both screens stay as they are — they already consume exactly the formats the engine emits.
3. Keep the fixtures. They stay useful as offline test data and as the shape contract for the engine's output.

## Project layout

```
fixtures/          daily-brief.md (archive format), candidates.json (--raw output)
src/               React frontend
  fixtures.ts      fixture imports + parsing; the engine's output shapes live here
  App.tsx          sidebar nav + screen switch
  screens/         DailyBrief, SignalExplorer, ConceptLibrary, Review, Placeholder
src-tauri/         the Rust shell
  tauri.conf.json  window, build commands, bundle config (externalBin stub)
  capabilities/    main-window permissions
  binaries/        stub dir where sidecar binaries will land
```
