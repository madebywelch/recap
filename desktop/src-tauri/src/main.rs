//! Recap desktop shell. Runs the bundled Go engine as a sidecar: `run_scan`
//! spawns it with the app's scan recipe and returns the raw JSON envelope
//! for the frontend to validate against the engine contract
//! (docs/engine-json.md) and ingest into SQLite via the SQL plugin.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

/// The app's scan recipe from docs/desktop-app-spec.md: everything the
/// engine scored, no cut — the same `--raw` shape the CLI prints, so the
/// calibration data the Signal Explorer needs lands in the store intact.
const SCAN_ARGS: [&str; 7] = [
    "--raw",
    "--days",
    "1",
    "--min-score",
    "-100",
    "--top",
    "0",
];

/// GUI-launched apps inherit a minimal PATH and never see `~/.local/bin`,
/// homebrew, or npm-global installs — which breaks the engine's inference
/// CLI detection (docs/desktop-app-spec.md §Inference). The app owns the
/// environment it spawns the sidecar with: the spec's common install
/// locations go in front, the inherited PATH behind. Npm-global discovery
/// beyond these lands with the Settings work in M3.
fn augmented_path(home: &Path) -> std::ffi::OsString {
    let mut dirs: Vec<PathBuf> = vec![
        home.join(".local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(path) = std::env::var_os("PATH") {
        dirs.push(PathBuf::from(path));
    }
    std::env::join_paths(dirs).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

/// Spawns the bundled recap sidecar and returns its stdout: the versioned
/// scan envelope as JSON. Validation of that payload happens in the
/// frontend, next to the client types it must agree with.
///
/// The bundler places the sidecar next to the app binary under the plain
/// name `recap` (the externalBin path with the target triple stripped), and
/// sidecar paths resolve relative to the executable, so the program string
/// is just "recap" — not the "binaries/recap" path from tauri.conf.json.
#[tauri::command]
async fn run_scan(app: tauri::AppHandle) -> Result<String, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("could not resolve the home directory: {e}"))?;
    let output = app
        .shell()
        .sidecar("recap")
        .map_err(|e| format!("sidecar binary not found: {e}"))?
        .args(SCAN_ARGS)
        .env("PATH", augmented_path(&home))
        .output()
        .await
        .map_err(|e| format!("failed to run sidecar: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "recap exited with {}: {}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    String::from_utf8(output.stdout).map_err(|e| format!("sidecar output was not UTF-8: {e}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![run_scan])
        .run(tauri::generate_context!())
        .expect("error while running recap");
}
