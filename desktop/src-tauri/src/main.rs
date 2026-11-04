//! Recap desktop shell. Runs the bundled Go engine as a sidecar: `run_scan`
//! returns the raw scan envelope, `generate_brief` drives a generation run
//! with the engine's stderr phase events forwarded to the frontend and the
//! inference CLI's whole process group cleaned up on cancel or app exit.
//! Settings persist next to the SQLite store in the app-config dir.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandEvent, CommandChild};
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

// --- settings ---------------------------------------------------------------

/// The user's generation preferences (docs/desktop-app-spec.md §Inference).
/// `inference_cli` is "auto" | "claude" | "codex" | "custom"; when it is
/// "custom", `custom_cli_path` holds the executable passed through to the
/// engine as `--inference` (the engine runs it claude-style, `-p`).
/// `onboarded` is the first-run flag: the welcome sheet shows until the
/// user dismisses it, and then never again.
#[derive(Serialize, Deserialize)]
struct Settings {
    inference_cli: String,
    custom_cli_path: String,
    timeout_sec: u32,
    #[serde(default)]
    onboarded: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            inference_cli: "auto".into(),
            custom_cli_path: String::new(),
            timeout_sec: 240,
            onboarded: false,
        }
    }
}

impl Settings {
    /// The value passed to the engine's `--inference` flag.
    fn cli_value(&self) -> String {
        if self.inference_cli == "custom" {
            self.custom_cli_path.trim().to_string()
        } else {
            self.inference_cli.clone()
        }
    }

    fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let dir = app
            .path()
            .app_config_dir()
            .map_err(|e| format!("could not resolve the app config dir: {e}"))?;
        Ok(dir.join("settings.json"))
    }

    fn load(app: &tauri::AppHandle) -> Settings {
        let Ok(path) = Self::settings_path(app) else {
            return Settings::default();
        };
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let path = Self::settings_path(app)?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("could not create the config dir: {e}"))?;
        }
        let body = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, body).map_err(|e| format!("could not write settings: {e}"))
    }
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Settings {
    Settings::load(&app)
}

#[tauri::command]
fn set_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    if !matches!(
        settings.inference_cli.as_str(),
        "auto" | "claude" | "codex" | "custom"
    ) {
        return Err("inference_cli must be auto, claude, codex or custom".into());
    }
    if settings.inference_cli == "custom" && settings.custom_cli_path.trim().is_empty() {
        return Err("a custom CLI needs a path".into());
    }
    if !(60..=900).contains(&settings.timeout_sec) {
        return Err("timeout must be between 60 and 900 seconds".into());
    }
    settings.save(&app)
}

// --- CLI detection ----------------------------------------------------------

/// GUI-launched apps inherit a minimal PATH and never see `~/.local/bin`,
/// homebrew, or npm-global installs — which breaks the engine's inference
/// CLI detection (docs/desktop-app-spec.md §Inference). The app owns the
/// environment it spawns the sidecar with: the spec's common install
/// locations go in front, the inherited PATH behind. Npm-global discovery
/// beyond these lands with future Settings work.
/// The common install locations a GUI launch misses (the spec's PATH
/// augmentation, hardened for a clean machine with no shell PATH): the
/// user's own bin dirs plus the node/npm version managers the CLIs are
/// typically installed through. Only directories that exist are
/// prepended, so a clean machine gets a short, honest PATH.
fn augmented_path(home: &std::path::Path) -> OsString {
    let mut dirs: Vec<PathBuf> = vec![
        home.join(".local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        home.join(".npm-global/bin"),
        home.join(".volta/bin"),
        home.join("Library/pnpm"),
        home.join(".local/share/pnpm"),
    ];
    // nvm keeps one bin per node version; use the newest by version
    // number, not lexically (v10 sorts after v9 as a string).
    if let Ok(versions) = std::fs::read_dir(home.join(".nvm/versions/node")) {
        let mut bins: Vec<(Vec<u64>, PathBuf)> = versions
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                let nums: Vec<u64> = name
                    .trim_start_matches('v')
                    .split('.')
                    .filter_map(|p| p.parse().ok())
                    .collect();
                let path = entry.path().join("bin");
                (!nums.is_empty() && path.is_dir()).then_some((nums, path))
            })
            .collect();
        bins.sort();
        if let Some((_, newest)) = bins.pop() {
            dirs.push(newest);
        }
    }
    dirs.retain(|d| d.is_dir());
    // The inherited PATH joins as elements, not as one string: join_paths
    // rejects an element containing the separator itself, so folding the
    // whole PATH in as one entry silently discarded the augmented dirs
    // (and every launch behaved as a bare shell launch). Empty elements
    // — a stray ':' — are dropped so join_paths always succeeds.
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(
            std::env::split_paths(&path).filter(|d| !d.as_os_str().is_empty()),
        );
    }
    std::env::join_paths(dirs).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

fn is_executable(path: &std::path::Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

/// Find `name` the way the engine's exec.LookPath will: a value containing a
/// separator is checked directly, otherwise each augmented-PATH dir.
fn find_cli(name: &str, path: &OsString) -> Option<String> {
    let value = PathBuf::from(name);
    if value.components().count() > 1 {
        return is_executable(&value).then(|| name.to_string());
    }
    let dirs = std::env::split_paths(path);
    dirs.map(|dir| dir.join(name))
        .find(|p| is_executable(p))
        .and_then(|p| p.to_str().map(String::from))
}

/// Preflight detection for Settings: which CLI the engine would find with
/// the app's augmented PATH, and where.
#[derive(Serialize)]
struct Detection {
    /// The CLI the current settings resolve to, or null if none found.
    cli: Option<String>,
    /// The executable path for `cli` when found.
    path: Option<String>,
    /// The names checked, in order — what "auto" would fall through to.
    considered: Vec<String>,
    /// The augmented PATH the sidecar is spawned with, for display.
    path_dirs: Vec<String>,
}

#[tauri::command]
fn detect_inference(app: tauri::AppHandle) -> Detection {
    let settings = Settings::load(&app);
    let home = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())
        .unwrap_or_default();
    let path = augmented_path(&home);
    let path_dirs = std::env::split_paths(&path)
        .filter_map(|d| d.to_str().map(String::from))
        .collect();

    let mut considered = vec![];
    let candidates: Vec<String> = match settings.inference_cli.as_str() {
        "auto" => vec!["claude".into(), "codex".into()],
        "custom" => vec![settings.cli_value()],
        other => vec![other.to_string()],
    };
    for name in &candidates {
        considered.push(name.clone());
        if let Some(found) = find_cli(name, &path) {
            return Detection {
                cli: Some(name.clone()),
                path: Some(found),
                considered,
                path_dirs,
            };
        }
    }
    Detection {
        cli: None,
        path: None,
        considered,
        path_dirs,
    }
}

// --- generation -------------------------------------------------------------

/// A generation run in flight, registered for cancellation and app-exit
/// hygiene: SIGTERM first (the engine traps it and kills the inference
/// CLI's process group), SIGKILL as the fallback.
struct GenChild {
    child: CommandChild,
    pid: u32,
}

#[derive(Default)]
struct GenState(Mutex<Option<GenChild>>);

/// Cancels a running generation. SIGTERM first — the engine traps it and
/// kills the inference CLI's process group — then SIGKILL after a grace
/// period. The frontend's `generate_brief` call resolves to an error it
/// maps to the cancelled state itself.
fn take_and_terminate(state: &GenState) {
    let Some(child) = state.0.lock().unwrap().take() else {
        return;
    };
    #[cfg(unix)]
    unsafe {
        libc::kill(child.pid as i32, libc::SIGTERM);
    }
    #[cfg(not(unix))]
    {
        let _ = child.child.kill();
    }
    // The engine traps SIGTERM, kills the CLI's process group, and exits;
    // give it a moment before the SIGKILL fallback.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        let _ = child.child.kill();
    });
}

/// What the generation produced: the brief markdown from the engine's
/// stdout. The archive path is known to the frontend (the engine writes
/// ~/.claude/morning-recap/recap-<local date>.md, and the JS side has the
/// home dir and local clock).
///
/// Runs the generation: `recap --days 1 --inference <cli> --timeout <N>` —
/// the engine rescans, pipes the top candidates to the inference CLI, prints
/// the brief markdown on stdout, and writes the archive. The engine's
/// single-line JSON phase events arrive on stderr and are forwarded to the
/// frontend as `generation://phase` events; older engines without events
/// degrade to the frontend's indeterminate progress.
#[tauri::command]
async fn generate_brief(
    app: tauri::AppHandle,
    state: tauri::State<'_, GenState>,
) -> Result<String, String> {
    if state.0.lock().unwrap().is_some() {
        return Err("a generation is already running".into());
    }
    let settings = Settings::load(&app);
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("could not resolve the home directory: {e}"))?;

    let cli = settings.cli_value();
    let timeout = settings.timeout_sec.to_string();
    let (mut rx, child) = app
        .shell()
        .sidecar("recap")
        .map_err(|e| format!("sidecar binary not found: {e}"))?
        .args(["--days", "1", "--inference", &cli, "--timeout", &timeout])
        .env("PATH", augmented_path(&home))
        .spawn()
        .map_err(|e| format!("failed to spawn the sidecar: {e}"))?;

    let pid = child.pid();
    *state.0.lock().unwrap() = Some(GenChild { child, pid });

    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr_tail: Vec<String> = Vec::new();
    let mut status: Option<i32> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(chunk) => stdout.extend_from_slice(&chunk),
            CommandEvent::Stderr(chunk) => {
                let line = String::from_utf8_lossy(&chunk).trim_end().to_string();
                if serde_json::from_str::<serde_json::Value>(&line)
                    .ok()
                    .and_then(|v| v.get("event").cloned())
                    .and_then(|v| v.as_str().map(String::from))
                    .is_some()
                {
                    let _ = app.emit("generation://phase", line);
                } else if !line.is_empty() {
                    stderr_tail.push(line);
                    if stderr_tail.len() > 12 {
                        stderr_tail.remove(0);
                    }
                }
            }
            CommandEvent::Terminated(payload) => {
                status = payload.code;
            }
            CommandEvent::Error(err) => {
                *state.0.lock().unwrap() = None;
                return Err(format!("sidecar stream error: {err}"));
            }
            _ => {}
        }
        if status.is_some() {
            break;
        }
    }
    *state.0.lock().unwrap() = None;

    if status != Some(0) {
        let tail = stderr_tail.join("\n");
        return Err(if tail.is_empty() {
            format!("recap exited with status {status:?}")
        } else {
            tail
        });
    }

    let markdown =
        String::from_utf8(stdout).map_err(|e| format!("sidecar output was not UTF-8: {e}"))?;
    if markdown.trim().is_empty() {
        return Err("generation produced no output".into());
    }
    Ok(markdown)
}

/// Cancels a running generation: SIGTERM so the engine can kill the
/// inference CLI's process group, SIGKILL after a grace period. The
/// frontend's `generate_brief` call then resolves to an error it maps to
/// the cancelled state itself.
#[tauri::command]
fn cancel_generation(state: tauri::State<'_, GenState>) {
    take_and_terminate(&state);
}

// --- scanning ---------------------------------------------------------------

/// One archive file for the Library's first-run import: the spec's shared
/// archive dir (~/.claude/morning-recap) holds recap-*.md files written by
/// both the CLI and this app; the frontend parses them with the same brief
/// parser generation uses.
#[derive(serde::Serialize)]
struct ArchiveFile {
    name: String,
    path: String,
    content: String,
}

#[tauri::command]
async fn read_archives(app: tauri::AppHandle) -> Result<Vec<ArchiveFile>, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("could not resolve the home directory: {e}"))?;
    let dir = home.join(".claude").join("morning-recap");
    let mut files = Vec::new();
    // A missing dir just means no history yet — not an error.
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(files),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("recap-") || !name.ends_with(".md") {
            continue;
        }
        let path = entry.path();
        let content =
            std::fs::read_to_string(&path).map_err(|e| format!("reading {}: {e}", path.display()))?;
        files.push(ArchiveFile {
            name,
            path: path.display().to_string(),
            content,
        });
    }
    files.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(files)
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
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(GenState::default())
        .invoke_handler(tauri::generate_handler![
            run_scan,
            get_settings,
            set_settings,
            detect_inference,
            generate_brief,
            cancel_generation,
            read_archives
        ])
        .build(tauri::generate_context!())
        .expect("error while building the recap app");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Process hygiene: quitting the app mid-generation must not
            // orphan the engine or the inference CLI it spawned.
            let state = app_handle.state::<GenState>();
            take_and_terminate(&state);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The clean-machine contract for augmented_path: a CLI installed in
    /// the user's own bin dir is found with no shell PATH at all, missing
    /// directories are dropped instead of padding the PATH, and nvm picks
    /// the newest version numerically (v10 beats v9, where a lexical sort
    /// would pick v9).
    #[test]
    fn augmented_path_finds_user_bins_without_shell_path() {
        let home = std::env::temp_dir().join("recap-augmented-path-test");
        let _ = std::fs::remove_dir_all(&home);
        let user_bin = home.join(".local/bin");
        std::fs::create_dir_all(&user_bin).unwrap();
        let cli = user_bin.join("claude");
        std::fs::write(&cli, "#!/bin/sh\n").unwrap();
        make_executable_helper(&cli);

        let path = augmented_path(&home);
        let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
        assert_eq!(dirs.first(), Some(&user_bin));
        // /opt/homebrew/bin and friends do not exist in this sandbox, and
        // must not appear as dead entries.
        assert!(!dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert_eq!(
            find_cli("claude", &path),
            Some(cli.to_string_lossy().to_string())
        );
        assert_eq!(find_cli("nothing-by-this-name", &path), None);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn augmented_path_picks_the_newest_nvm_node_numerically() {
        let home = std::env::temp_dir().join("recap-augmented-nvm-test");
        let _ = std::fs::remove_dir_all(&home);
        for v in ["v9.0.0", "v10.0.0"] {
            std::fs::create_dir_all(home.join(format!(".nvm/versions/node/{v}/bin"))).unwrap();
        }

        let path = augmented_path(&home);
        let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
        assert!(
            dirs.contains(&home.join(".nvm/versions/node/v10.0.0/bin")),
            "the newest node must be on the PATH: {dirs:?}"
        );
        assert!(
            !dirs.contains(&home.join(".nvm/versions/node/v9.0.0/bin")),
            "older node versions must not be: {dirs:?}"
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    fn make_executable_helper(path: &std::path::Path) {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).unwrap();
    }

    /// The settings round-trip carries the first-run flag, and an old
    /// settings.json written before onboarding existed still parses.
    #[test]
    fn settings_parse_without_onboarded() {
        let old = r#"{"inference_cli":"auto","custom_cli_path":"","timeout_sec":240}"#;
        let parsed: Settings = serde_json::from_str(old).unwrap();
        assert!(!parsed.onboarded);
        let round: Settings = serde_json::from_str(
            &serde_json::to_string(&Settings {
                inference_cli: "auto".into(),
                custom_cli_path: String::new(),
                timeout_sec: 60,
                onboarded: true,
            })
            .unwrap(),
        )
        .unwrap();
        assert!(round.onboarded);
    }
}
