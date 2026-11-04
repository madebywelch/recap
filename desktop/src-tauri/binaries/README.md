# Sidecar binaries

Per-platform builds of the recap Go engine will land here when the sidecar
wiring happens. Nothing is bundled yet — the app runs on committed fixtures.

Tauri resolves `externalBin` entries as `<path>-<target-triple>`, so the
files are named like:

    recap-aarch64-apple-darwin
    recap-x86_64-pc-windows-msvc.exe
    recap-x86_64-unknown-linux-gnu

The `externalBin` key in `../tauri.conf.json` is the stub: it is an empty
array until `"binaries/recap"` is added there. See desktop/README.md for
the full plan.
