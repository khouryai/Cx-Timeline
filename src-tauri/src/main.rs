//! The desktop shell.
//!
//! Thin command wrappers over `plan.rs`, which holds every rule worth testing.
//! Nothing here makes a decision: it converts arguments, calls the library, and
//! turns its errors into something the frontend can branch on.
//!
//! Why the window loads a *local* page that fetches remote code
//! -----------------------------------------------------------
//! The requirement is that pushing to the web deployment reaches this app
//! without anyone reinstalling. Two ways to do that:
//!
//!   point the window at the remote URL — then the whole app runs on a remote
//!   origin, and every command it may call has to be granted to that origin.
//!
//!   load the bundled page and let *it* fetch the current bundle — the app runs
//!   on the local origin, so the command surface needs no remote grant, and the
//!   bundled copy is a natural offline fallback.
//!
//! The second is what `index.html` in `dist-desktop/` does. Both execute code
//! fetched from the deployment, so the trust boundary is the same either way;
//! this one simply needs less privilege to achieve it, and still starts on a
//! plane. See `tools/shell/loader.js` for the fetch-with-fallback, and the CSP
//! in `tauri.conf.json` for the host it is allowed to fetch from.
//!
//! The CSP there is worth reading before changing anything here. The loader
//! fetches the deployment's code as *text* and runs it from a blob URL, so
//! `script-src` stays at `'self' blob:` — no remote script tag, no
//! `'unsafe-inline'`, and the deployment appears in `connect-src` only. Whatever
//! that code turns out to be, it can reach nothing on this machine except the
//! commands below, and the commands below touch nothing except the folder the
//! user picked.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use cx_plan as plan;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// An error shaped for the frontend: a tag to branch on, and words for a human.
#[derive(Debug, Serialize)]
struct Failure {
    kind: String,
    message: String,
    /// Present on a conflict, so the interface can say how far apart they are.
    #[serde(skip_serializing_if = "Option::is_none")]
    current: Option<plan::Stamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expected: Option<plan::Stamp>,
}

impl From<plan::PlanError> for Failure {
    fn from(err: plan::PlanError) -> Self {
        let (current, expected) = match &err {
            plan::PlanError::Conflict { current, expected } => (Some(*current), Some(*expected)),
            _ => (None, None),
        };
        Failure {
            kind: err.kind().to_string(),
            message: err.to_string(),
            current,
            expected,
        }
    }
}

type Reply<T> = std::result::Result<T, Failure>;

/// Device-scoped settings: which folder, which plan, who you are.
///
/// A plain file in the OS config directory. The folder is stored as a *path* —
/// unlike the browser, which can only persist an opaque handle through
/// IndexedDB and has to ask permission again when the grant lapses. This is why
/// the desktop build can open your plan on launch with no prompt at all.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Settings {
    #[serde(default)]
    folder: String,
    #[serde(default)]
    plan: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    device: String,
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = std::fs::create_dir_all(&dir);
    dir.join("settings.json")
}

fn load_settings(app: &tauri::AppHandle) -> Settings {
    std::fs::read_to_string(settings_path(app))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_settings(app: &tauri::AppHandle, settings: &Settings) -> Reply<()> {
    let text = serde_json::to_string_pretty(settings).map_err(|e| Failure {
        kind: "io".into(),
        message: e.to_string(),
        current: None,
        expected: None,
    })?;
    std::fs::write(settings_path(app), text).map_err(|e| Failure {
        kind: "io".into(),
        message: e.to_string(),
        current: None,
        expected: None,
    })
}

#[tauri::command]
fn settings_read(app: tauri::AppHandle) -> Settings {
    let mut settings = load_settings(&app);
    // A device id is minted once and then never changes, which is what lets a
    // reopened app recognise the lock it left behind.
    if settings.device.is_empty() {
        settings.device = format!("d_{:x}", std::process::id() as u64 ^ now_seed());
        let _ = save_settings(&app, &settings);
    }
    settings
}

fn now_seed() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

#[tauri::command]
fn settings_write(app: tauri::AppHandle, folder: String, plan: String, display_name: String) -> Reply<()> {
    let mut settings = load_settings(&app);
    if !folder.is_empty() {
        settings.folder = folder;
    }
    settings.plan = plan;
    if !display_name.is_empty() {
        settings.display_name = display_name;
    }
    save_settings(&app, &settings)
}

/// Ask for a folder with the OS picker. Returns an empty string if cancelled.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> String {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("Choose the folder holding your plans")
        .pick_folder(move |picked| {
            let _ = tx.send(picked.map(|p| p.to_string()).unwrap_or_default());
        });
    rx.recv().unwrap_or_default()
}

#[tauri::command]
fn list_plans(folder: String) -> Reply<Vec<plan::PlanInfo>> {
    plan::list_plans(Path::new(&folder)).map_err(Failure::from)
}

#[tauri::command]
fn read_plan(folder: String, name: String) -> Reply<plan::PlanRead> {
    plan::read_plan(Path::new(&folder), &name).map_err(Failure::from)
}

#[tauri::command]
fn write_plan(
    folder: String,
    name: String,
    text: String,
    expected: Option<plan::Stamp>,
) -> Reply<plan::Stamp> {
    plan::write_plan(Path::new(&folder), &name, &text, expected).map_err(Failure::from)
}

/// Raw lock access. The *rules* — whose lock it is, whether it has gone stale —
/// live in `core/filestore.js` and are covered by its suite. Reimplementing them
/// here would mean two sources of truth for the one behaviour that decides
/// whether somebody loses an afternoon, so this deliberately only moves bytes.
///
/// `plan::lock_state` still exists and is still tested: `startup_lock_check`
/// below uses it before any window exists, which the frontend cannot do.
#[tauri::command]
fn lock_read(folder: String, name: String) -> Option<String> {
    let stem = name.strip_suffix(".json").unwrap_or(&name);
    std::fs::read_to_string(Path::new(&folder).join(format!("{stem}.lock.json"))).ok()
}

#[tauri::command]
fn lock_write(folder: String, name: String, text: String) -> Reply<()> {
    let stem = name.strip_suffix(".json").unwrap_or(&name);
    std::fs::write(Path::new(&folder).join(format!("{stem}.lock.json")), text).map_err(|e| Failure {
        kind: "io".into(),
        message: e.to_string(),
        current: None,
        expected: None,
    })
}

/* ── Claims on the pen ─────────────────────────────────────────────────── */

#[tauri::command]
fn claims_read(folder: String, plan: String) -> Vec<plan::ClaimFile> {
    plan::read_claims(Path::new(&folder), &plan).unwrap_or_default()
}

#[tauri::command]
fn claim_write(folder: String, plan: String, device: String, text: String) -> Reply<()> {
    plan::write_claim(Path::new(&folder), &plan, &device, &text).map_err(|e| Failure {
        kind: "io".into(),
        message: e.to_string(),
        current: None,
        expected: None,
    })
}

#[tauri::command]
fn claim_remove(folder: String, plan: String, device: String) -> bool {
    plan::remove_claim(Path::new(&folder), &plan, &device)
}

/// Delete one file in the folder by name — used to retire a dead claim.
/// Refuses anything that is not a lock or a claim, so a plan can never be
/// deleted through this door.
#[tauri::command]
fn file_remove(folder: String, name: String) -> bool {
    if !plan::is_lock_name(&name) {
        return false;
    }
    std::fs::remove_file(Path::new(&folder).join(name)).is_ok()
}

/// Clear a sync client's conflict copies of the lock files out of the folder.
/// Answers how many went, so the caller can say nothing when there were none.
#[tauri::command]
fn lock_sweep(folder: String) -> u32 {
    plan::sweep_lock_litter(Path::new(&folder)).unwrap_or(0)
}

#[tauri::command]
fn lock_remove(folder: String, name: String) -> bool {
    let stem = name.strip_suffix(".json").unwrap_or(&name);
    std::fs::remove_file(Path::new(&folder).join(format!("{stem}.lock.json"))).is_ok()
}

/// Who has the pen, answered before the window is built.
///
/// This is what the desktop build can do that the web build cannot: find out
/// that a colleague is in the plan and say so in a native dialog *before*
/// loading an interface that would have to walk it back.
#[tauri::command]
fn startup_lock_check(app: tauri::AppHandle) -> plan::LockState {
    let settings = load_settings(&app);
    if settings.folder.is_empty() || settings.plan.is_empty() {
        return plan::LockState {
            free: true,
            mine: false,
            live: false,
            holder: String::new(),
            idle_ms: 0,
        };
    }
    plan::lock_state(
        Path::new(&settings.folder),
        &settings.plan,
        "startup",
        &settings.device,
    )
}

#[tauri::command]
fn attachment_write(folder: String, id: String, bytes: Vec<u8>) -> Reply<u64> {
    plan::write_attachment(Path::new(&folder), &id, &bytes).map_err(Failure::from)
}

#[tauri::command]
fn attachment_read(folder: String, id: String) -> Reply<Vec<u8>> {
    plan::read_attachment(Path::new(&folder), &id).map_err(Failure::from)
}

#[tauri::command]
fn attachment_delete(folder: String, id: String) -> Reply<bool> {
    plan::delete_attachment(Path::new(&folder), &id).map_err(Failure::from)
}

#[tauri::command]
fn attachment_usage(folder: String) -> Reply<(u64, u64)> {
    plan::attachment_usage(Path::new(&folder)).map_err(Failure::from)
}

/// Put the plan and the pen in the window title, so the state is legible from
/// the taskbar without bringing the window forward.
#[tauri::command]
fn set_window_title(window: tauri::Window, title: String) {
    let _ = window.set_title(&title);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            settings_read,
            settings_write,
            pick_folder,
            list_plans,
            read_plan,
            write_plan,
            lock_read,
            lock_write,
            lock_remove,
            lock_sweep,
            claims_read,
            claim_write,
            claim_remove,
            file_remove,
            startup_lock_check,
            attachment_write,
            attachment_read,
            attachment_delete,
            attachment_usage,
            set_window_title,
        ])
        .run(tauri::generate_context!())
        .expect("CX Timeline failed to start");
}
