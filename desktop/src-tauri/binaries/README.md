# Sidecar binaries

Per-platform builds of the recap Go engine live here, built by
`pnpm sidecar` (scripts/build-sidecar.sh) before `tauri dev` and
`tauri build`. Tauri resolves the `externalBin` entry in
../tauri.conf.json as `<path>-<target-triple>`, so the files are named
like:

    recap-aarch64-apple-darwin
    recap-x86_64-pc-windows-msvc.exe
    recap-x86_64-unknown-linux-gnu

The build script covers the host platform, which is what dev and local
builds need; cross-platform release builds (M6) cross-compile the same
binary with GOOS/GOARCH for each target. The binaries are gitignored —
they are build artifacts, not sources.
