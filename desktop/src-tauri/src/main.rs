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
const SCAN_ARGS: [&str; 9] = [
    "--raw",
    "--tool",
    "all",
    "--days",
    "1",
    "--min-score",
    "-100",
    "--top",
    "0",
];

// --- settings ---------------------------------------------------------------

/// The user's generation preferences (docs/desktop-app-spec.md §Inference).
/// `inference_cli` is "auto" | "claude" | "codex" | "pi" | "custom"; when it is
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
    #[serde(default)]
    show_engine_details: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            inference_cli: "auto".into(),
            custom_cli_path: String::new(),
            timeout_sec: 240,
            onboarded: false,
            show_engine_details: false,
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
        "auto" | "claude" | "codex" | "pi" | "custom"
    ) {
        return Err("inference_cli must be auto, claude, codex, pi or custom".into());
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

/// The inference CLIs the engine knows, in the order "auto" tries them
/// (inferenceCLIs in inference.go).
const INFERENCE_CLIS: [&str; 3] = ["claude", "codex", "pi"];

/// GUI-launched apps inherit a minimal PATH (docs/desktop-app-spec.md
/// §Inference), so the app owns the PATH it spawns the sidecar with. Three
/// layers, deduplicated, first occurrence wins:
///
/// 1. the user's login-shell PATH, resolved once per launch — the PATH
///    their terminal has, in their order, so the app finds the same
///    `claude`, `codex` or `pi` that `which` does, and the `node` an
///    npm-installed CLI's shebang needs;
/// 2. the common install locations, in case the shell can't be asked (or
///    sets PATH only for interactive use somewhere it can't see): the
///    user's own bin dirs, Homebrew, and the node/npm/toolchain managers
///    these CLIs are typically installed through. Only directories that
///    exist are added, so a clean machine gets a short, honest PATH;
/// 3. the inherited PATH.
fn augmented_path(home: &std::path::Path, login: Option<&std::ffi::OsStr>) -> OsString {
    let mut dirs: Vec<PathBuf> = login
        .map(|p| std::env::split_paths(p).collect())
        .unwrap_or_default();
    let mut known: Vec<PathBuf> = vec![
        home.join(".local/bin"),
        home.join("bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/home/linuxbrew/.linuxbrew/bin"),
        home.join(".npm-global/bin"),
        home.join(".volta/bin"),
        home.join(".bun/bin"),
        home.join(".cargo/bin"),
        home.join(".pi/agent/bin"),
        home.join(".asdf/shims"),
        home.join(".local/share/mise/shims"),
        home.join(".local/share/fnm/aliases/default/bin"),
        home.join("Library/Application Support/fnm/aliases/default/bin"),
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
            known.push(newest);
        }
    }
    known.retain(|d| d.is_dir());
    dirs.extend(known);
    // The inherited PATH joins as elements, not as one string: join_paths
    // rejects an element containing the separator itself, so folding the
    // whole PATH in as one entry silently discarded the augmented dirs
    // (and every launch behaved as a bare shell launch).
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    // Empty elements — a stray ':' — are dropped so join_paths succeeds.
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()));
    std::env::join_paths(dirs).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

/// Runs `cmd` with no stdin and returns its stdout if it exits 0 within
/// `timeout`. The command gets its own process group, and a timeout kills
/// the whole group, so a hung shell rc file or CLI can't outlive the probe.
fn capture(mut cmd: std::process::Command, timeout: Duration) -> Option<String> {
    use std::io::Read;
    use std::process::Stdio;
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    match rx.recv_timeout(timeout) {
        Ok(buf) => {
            let status = child.wait().ok()?;
            status
                .success()
                .then(|| String::from_utf8_lossy(&buf).into_owned())
        }
        Err(_) => {
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

const ENV_MARK: &str = "__RECAP_LOGIN_ENV__";

/// Asks `shell` for the PATH a login, interactive session gets: the env
/// printed between two markers, so whatever the rc files echo on startup
/// is ignored. `env` instead of `echo $PATH` keeps it shell-agnostic (fish
/// prints a list PATH as space-separated words). None on any failure.
fn read_login_shell_path(shell: &std::path::Path, timeout: Duration) -> Option<OsString> {
    let mut cmd = std::process::Command::new(shell);
    cmd.args([
        "-l",
        "-i",
        "-c",
        &format!("echo {ENV_MARK}; /usr/bin/env; echo {ENV_MARK}"),
    ]);
    let out = capture(cmd, timeout)?;
    out.split(ENV_MARK)
        .nth(1)?
        .lines()
        .find_map(|line| line.strip_prefix("PATH="))
        .filter(|path| !path.is_empty())
        .map(OsString::from)
}

/// The login-shell PATH, resolved once per launch: $SHELL (zsh on a
/// macOS without one), five seconds at most, None when it can't be had.
fn login_shell_path() -> Option<OsString> {
    static CACHE: std::sync::OnceLock<Option<OsString>> = std::sync::OnceLock::new();
    CACHE
        .get_or_init(|| {
            if cfg!(not(unix)) {
                return None;
            }
            let shell = std::env::var_os("SHELL")
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("/bin/zsh"));
            read_login_shell_path(&shell, Duration::from_secs(5))
        })
        .clone()
}

/// The PATH every sidecar spawn and CLI probe uses. Resolving the login
/// shell can block for its timeout on first use, so it runs off the async
/// runtime.
async fn app_path(app: &tauri::AppHandle) -> Result<OsString, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("could not resolve the home directory: {e}"))?;
    let login = tauri::async_runtime::spawn_blocking(login_shell_path)
        .await
        .unwrap_or(None);
    Ok(augmented_path(&home, login.as_deref()))
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

/// One supported inference CLI as this machine has it.
#[derive(Serialize)]
struct CliStatus {
    name: String,
    /// Where the app's PATH resolves it; null when it isn't installed.
    path: Option<String>,
    /// First line of `<cli> --version`, run with the app's PATH; null when
    /// missing or when the probe failed (see `runs`).
    version: Option<String>,
    /// Whether `--version` ran and exited 0. A CLI that is found but
    /// doesn't run usually needs a runtime (node) the app's PATH lacks.
    runs: bool,
}

fn probe_cli(name: &str, path: &OsString) -> CliStatus {
    let Some(found) = find_cli(name, path) else {
        return CliStatus { name: name.into(), path: None, version: None, runs: false };
    };
    let mut cmd = std::process::Command::new(&found);
    cmd.arg("--version").env("PATH", path);
    let version = capture(cmd, Duration::from_secs(10)).map(|out| {
        out.lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or("")
            .chars()
            .take(80)
            .collect::<String>()
    });
    CliStatus {
        name: name.into(),
        runs: version.is_some(),
        version: version.filter(|v| !v.is_empty()),
        path: Some(found),
    }
}

/// Preflight detection for Settings and first run: every supported CLI
/// with its resolved path and version, and which one the current settings
/// hand the brief to.
#[derive(Serialize)]
struct Detection {
    /// The CLI the current settings resolve to, or null if none found.
    cli: Option<String>,
    /// The executable path for `cli` when found.
    path: Option<String>,
    /// The names checked, in order — what "auto" would fall through to.
    considered: Vec<String>,
    /// Every supported CLI, installed or not, in "auto" order.
    clis: Vec<CliStatus>,
    /// Whether the login shell's PATH was resolved and is in front.
    login_shell: bool,
    /// The augmented PATH the sidecar is spawned with, for display.
    path_dirs: Vec<String>,
}

#[tauri::command]
async fn detect_inference(app: tauri::AppHandle) -> Result<Detection, String> {
    let settings = Settings::load(&app);
    let path = app_path(&app).await?;
    let login_shell = login_shell_path().is_some();
    tauri::async_runtime::spawn_blocking(move || {
        let clis: Vec<CliStatus> = std::thread::scope(|scope| {
            let probes: Vec<_> = INFERENCE_CLIS
                .iter()
                .map(|name| scope.spawn(|| probe_cli(name, &path)))
                .collect();
            probes.into_iter().map(|p| p.join().unwrap()).collect()
        });
        let considered: Vec<String> = match settings.inference_cli.as_str() {
            "auto" => INFERENCE_CLIS.iter().map(|s| s.to_string()).collect(),
            "custom" => vec![settings.cli_value()],
            other => vec![other.to_string()],
        };
        let (cli, found) = considered
            .iter()
            .find_map(|name| find_cli(name, &path).map(|p| (Some(name.clone()), Some(p))))
            .unwrap_or((None, None));
        Detection {
            cli,
            path: found,
            considered,
            clis,
            login_shell,
            path_dirs: std::env::split_paths(&path)
                .filter_map(|d| d.to_str().map(String::from))
                .collect(),
        }
    })
    .await
    .map_err(|e| format!("detection failed: {e}"))
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
    let path = app_path(&app).await?;

    let cli = settings.cli_value();
    let timeout = settings.timeout_sec.to_string();
    let (mut rx, child) = app
        .shell()
        .sidecar("recap")
        .map_err(|e| format!("sidecar binary not found: {e}"))?
        .args(["--days", "1", "--inference", &cli, "--timeout", &timeout])
        .env("PATH", path)
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
    sidecar_stdout(&app, &SCAN_ARGS).await
}

/// The transcript half of detection: `recap --sources --days 1` reports
/// each tool's session directory and how many sessions it holds (and how
/// many fall in the scan window), as JSON the frontend validates.
#[tauri::command]
async fn detect_sources(app: tauri::AppHandle) -> Result<String, String> {
    sidecar_stdout(&app, &["--sources", "--days", "1"]).await
}

async fn sidecar_stdout(app: &tauri::AppHandle, args: &[&str]) -> Result<String, String> {
    let path = app_path(app).await?;
    let output = app
        .shell()
        .sidecar("recap")
        .map_err(|e| format!("sidecar binary not found: {e}"))?
        .args(args)
        .env("PATH", path)
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WidgetSnapshot {
    concepts: Vec<String>,
    date: String,
    due_count: u32,
}

#[cfg(any(target_os = "macos", test))]
fn save_widget_snapshot(data_dir: &std::path::Path, snapshot: &WidgetSnapshot) -> Result<(), String> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);

    let data = serde_json::to_vec(snapshot).map_err(|e| e.to_string())?;
    let temp = data_dir.join(format!(".widget-data-{}-{}.tmp", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(&data)?;
        file.sync_all()?;
        std::fs::rename(&temp, data_dir.join("widget-data.json"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_widget_snapshot(concepts: Vec<String>, date: String, due_count: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
        let data_dir = PathBuf::from(home).join("Library/Containers/com.madebywelch.recap.widget/Data");
        save_widget_snapshot(&data_dir, &WidgetSnapshot { concepts, date, due_count })?;
        match std::env::current_exe() {
            Ok(exe) => {
                if let Some(dir) = exe.parent() {
                    let helper = dir.join("recap-widget-reload");
                    if helper.exists() {
                        match std::process::Command::new(helper).status() {
                            Ok(status) if status.success() => (),
                            Ok(status) => eprintln!("Widget reload helper failed: {status}"),
                            Err(error) => eprintln!("Could not start widget reload helper: {error}"),
                        }
                    }
                }
            }
            Err(error) => eprintln!("Could not locate widget reload helper: {error}"),
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (concepts, date, due_count);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct VibrancyState(Mutex<bool>);

#[tauri::command]
async fn sidebar_vibrancy(window: tauri::WebviewWindow) -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSWorkspace;
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

        if !window.app_handle().config().app.windows.iter().any(|config| {
            config.label == window.label() && config.transparent
        }) {
            return None;
        }
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let native_window = window.clone();
        if window
            .run_on_main_thread(move || {
                let enabled = (|| {
                    if NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency() {
                        return false;
                    }
                    let state = native_window.state::<VibrancyState>();
                    let Ok(mut applied) = state.0.lock() else { return false };
                    if !*applied {
                        if apply_vibrancy(
                            &native_window,
                            NSVisualEffectMaterial::Sidebar,
                            Some(NSVisualEffectState::FollowsWindowActiveState),
                            None,
                        ).is_err() {
                            return false;
                        }
                        *applied = true;
                    }
                    true
                })();
                let _ = tx.send(enabled);
            })
            .is_err()
        {
            return Some(false);
        }
        Some(tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(2)).unwrap_or(false))
            .await
            .unwrap_or(false))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        None
    }
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(GenState::default());
    #[cfg(target_os = "macos")]
    let builder = builder.manage(VibrancyState::default());
    let app = builder
        .invoke_handler(tauri::generate_handler![
            run_scan,
            get_settings,
            set_settings,
            detect_inference,
            detect_sources,
            generate_brief,
            cancel_generation,
            read_archives,
            write_widget_snapshot,
            sidebar_vibrancy
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

    #[test]
    fn widget_snapshot_is_atomic_and_does_not_create_container() {
        let root = std::env::temp_dir().join(format!("recap-widget-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let data = root.join("Data");
        let snapshot = WidgetSnapshot { concepts: vec![], date: "2026-01-01".into(), due_count: 3 };
        assert!(save_widget_snapshot(&data, &snapshot).is_err());
        assert!(!root.exists());
        std::fs::create_dir_all(&data).unwrap();
        save_widget_snapshot(&data, &snapshot).unwrap();
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&std::fs::read(data.join("widget-data.json")).unwrap()).unwrap(), serde_json::json!({"concepts": [], "date": "2026-01-01", "dueCount": 3}));
        save_widget_snapshot(&data, &WidgetSnapshot { concepts: vec!["Ownership".into()], date: "2026-01-02".into(), due_count: 0 }).unwrap();
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&std::fs::read(data.join("widget-data.json")).unwrap()).unwrap(), serde_json::json!({"concepts": ["Ownership"], "date": "2026-01-02", "dueCount": 0}));
        assert_eq!(std::fs::read_dir(&data).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

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

        let path = augmented_path(&home, None);
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

        let path = augmented_path(&home, None);
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

    /// The login shell's PATH goes first, in the user's order, and a dir it
    /// shares with the known locations or the inherited PATH appears once.
    #[test]
    fn augmented_path_puts_the_login_shell_path_first() {
        let home = std::env::temp_dir().join("recap-augmented-login-test");
        let _ = std::fs::remove_dir_all(&home);
        let user_bin = home.join(".local/bin");
        std::fs::create_dir_all(&user_bin).unwrap();
        let login = std::env::join_paths([PathBuf::from("/opt/brew-first"), user_bin.clone()]).unwrap();

        let dirs: Vec<PathBuf> = std::env::split_paths(&augmented_path(&home, Some(&login))).collect();
        assert_eq!(dirs[0], PathBuf::from("/opt/brew-first"));
        assert_eq!(dirs[1], user_bin);
        assert_eq!(dirs.iter().filter(|d| **d == user_bin).count(), 1, "{dirs:?}");

        let _ = std::fs::remove_dir_all(&home);
    }

    fn fake_shell(name: &str, body: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("recap-fake-shell-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let shell = dir.join("sh");
        std::fs::write(&shell, format!("#!/bin/sh\n{body}")).unwrap();
        make_executable_helper(&shell);
        shell
    }

    /// The login shell is asked with -l -i -c, and only the PATH printed
    /// between the markers counts: rc-file chatter before it (including a
    /// line that looks like PATH=) is ignored.
    #[test]
    fn login_shell_path_reads_path_between_markers() {
        let shell = fake_shell(
            "ok",
            "echo 'Welcome back!'\necho PATH=/not/this\n\
             [ \"$1 $2 $3\" = '-l -i -c' ] || exit 3\n\
             echo __RECAP_LOGIN_ENV__\necho HOME=/h\necho PATH=/login/bin:/opt/homebrew/bin\necho __RECAP_LOGIN_ENV__\n",
        );
        assert_eq!(
            read_login_shell_path(&shell, Duration::from_secs(5)),
            Some(OsString::from("/login/bin:/opt/homebrew/bin"))
        );
    }

    /// A shell whose rc files hang, or that fails, yields None — the known
    /// locations still apply — and never blocks past the timeout.
    #[test]
    fn login_shell_path_times_out_and_fails_soft() {
        let slow = fake_shell("slow", "sleep 30\n");
        let started = std::time::Instant::now();
        assert_eq!(read_login_shell_path(&slow, Duration::from_millis(300)), None);
        assert!(started.elapsed() < Duration::from_secs(5));

        let failing = fake_shell("fail", "exit 1\n");
        assert_eq!(read_login_shell_path(&failing, Duration::from_secs(5)), None);
        assert_eq!(
            read_login_shell_path(std::path::Path::new("/nonexistent/shell"), Duration::from_secs(1)),
            None
        );
    }

    /// Every supported CLI is reported, not just the first auto finds:
    /// installed ones with path and version, one that is on PATH but can't
    /// run flagged as such, missing ones with no path.
    #[test]
    fn probe_cli_reports_path_version_and_runnability() {
        let dir = std::env::temp_dir().join("recap-probe-cli-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for (name, body) in [
            ("codex", "#!/bin/sh\necho\necho 'codex-cli 0.98.0'\n"),
            ("pi", "#!/bin/sh\nexit 127\n"),
        ] {
            let p = dir.join(name);
            std::fs::write(&p, body).unwrap();
            make_executable_helper(&p);
        }
        let path = std::env::join_paths([&dir]).unwrap();

        let codex = probe_cli("codex", &path);
        assert_eq!(codex.path.as_deref(), dir.join("codex").to_str());
        assert_eq!(codex.version.as_deref(), Some("codex-cli 0.98.0"));
        assert!(codex.runs);

        let pi = probe_cli("pi", &path);
        assert!(pi.path.is_some() && !pi.runs && pi.version.is_none());

        let claude = probe_cli("claude", &path);
        assert!(claude.path.is_none() && !claude.runs);

        let _ = std::fs::remove_dir_all(&dir);
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
        let old = r#"{"inference_cli":"custom","custom_cli_path":"/usr/local/bin/claude","timeout_sec":300}"#;
        let parsed: Settings = serde_json::from_str(old).unwrap();
        assert!(!parsed.onboarded);
        assert!(!parsed.show_engine_details);
        assert_eq!(parsed.inference_cli, "custom");
        assert_eq!(parsed.custom_cli_path, "/usr/local/bin/claude");
        assert_eq!(parsed.timeout_sec, 300);
        let round: Settings = serde_json::from_str(
            &serde_json::to_string(&Settings {
                inference_cli: "auto".into(),
                custom_cli_path: String::new(),
                timeout_sec: 60,
                onboarded: true,
                show_engine_details: true,
            })
            .unwrap(),
        )
        .unwrap();
        assert!(round.onboarded);
        assert!(round.show_engine_details);
    }
}
