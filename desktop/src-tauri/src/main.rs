//! Recap desktop shell. The frontend runs entirely on committed fixtures
//! (desktop/fixtures) and calls no Tauri commands yet. The recap engine will
//! be spawned as a sidecar — the plan is in desktop/README.md.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running recap");
}
