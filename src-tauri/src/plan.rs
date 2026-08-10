//! Plans, locks and the write guard — the part worth testing.
//!
//! This module deliberately knows nothing about Tauri, a webview or a window.
//! It is plain `std::fs` plus serde, so the rules that protect somebody's
//! afternoon can be unit-tested on any machine, including one with no webview
//! toolchain installed. `main.rs` is a thin set of command wrappers over this.
//!
//! Two things it does that the browser could not
//! ---------------------------------------------
//! **Writes are atomic.** The plan is written to a temporary file in the same
//! directory and then renamed over the target. A rename within one filesystem
//! is atomic, so a crash — or OneDrive reading the file mid-write — can never
//! see a half-written plan. The browser's `createWritable()` truncates first
//! and streams, which leaves exactly that window open.
//!
//! **The guard compares before writing, in the same call.** The check and the
//! write are one operation here rather than two round-trips through a
//! permission-gated API, so there is less room between them for a colleague's
//! sync to land.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// A lock older than this is treated as abandoned. Matches the web build.
pub const STALE_MS: u64 = 75_000;

/// Size and modified time as we last saw them — the write guard's evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stamp {
    pub size: u64,
    /// Milliseconds since the Unix epoch, to match `File.lastModified` in JS.
    pub modified: u64,
}

/// One plan file in a folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanInfo {
    pub name: String,
    pub size: u64,
    pub modified: u64,
}

/// The contents of a plan, plus the stamp to hand back on the next write.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanRead {
    pub text: String,
    pub stamp: Stamp,
}

/// Who has the pen.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lock {
    /// The window that took it — distinguishes two windows of one install.
    pub id: String,
    /// The machine. A returning session recognises its own lock by this.
    pub device: String,
    pub holder: String,
    pub since: u64,
    pub beat: u64,
}

/// What a lock means for the session asking about it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockState {
    /// No lock file, or one whose heartbeat has stopped.
    pub free: bool,
    /// Ours: same window, or same machine as a session that has gone away.
    pub mine: bool,
    /// Someone else is actively stamping it.
    pub live: bool,
    pub holder: String,
    /// Milliseconds since the holder last stamped it, when there is a holder.
    pub idle_ms: u64,
}

/// Why an operation could not be completed.
#[derive(Debug)]
pub enum PlanError {
    /// The file moved since it was last read: a colleague's save landed.
    Conflict { current: Stamp, expected: Stamp },
    NotFound(String),
    Io(io::Error),
    Parse(String),
}

impl std::fmt::Display for PlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PlanError::Conflict { .. } => write!(
                f,
                "this plan changed on disk since you opened it, so the save was refused"
            ),
            PlanError::NotFound(what) => write!(f, "{what} was not found"),
            PlanError::Io(err) => write!(f, "{err}"),
            PlanError::Parse(why) => write!(f, "{why}"),
        }
    }
}

impl From<io::Error> for PlanError {
    fn from(err: io::Error) -> Self {
        PlanError::Io(err)
    }
}

/// Serialisable shape for the frontend: a tag it can branch on, and a message.
impl PlanError {
    pub fn kind(&self) -> &'static str {
        match self {
            PlanError::Conflict { .. } => "conflict",
            PlanError::NotFound(_) => "not-found",
            PlanError::Io(_) => "io",
            PlanError::Parse(_) => "parse",
        }
    }
}

pub type Result<T> = std::result::Result<T, PlanError>;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn stamp_of(meta: &fs::Metadata) -> Stamp {
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Stamp {
        size: meta.len(),
        modified,
    }
}

/// `<plan>.json` → `<plan>.lock.json`
fn lock_path(dir: &Path, plan: &str) -> PathBuf {
    let stem = plan.strip_suffix(".json").unwrap_or(plan);
    dir.join(format!("{stem}.lock.json"))
}

/* ── Plans ──────────────────────────────────────────────────────────────── */

/// Every plan in a folder, newest first. Lock files are not plans.
pub fn list_plans(dir: &Path) -> Result<Vec<PlanInfo>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if !lower.ends_with(".json") || lower.ends_with(".lock.json") {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(meta) if meta.is_file() => meta,
            _ => continue,
        };
        let stamp = stamp_of(&meta);
        out.push(PlanInfo {
            name,
            size: stamp.size,
            modified: stamp.modified,
        });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

pub fn read_plan(dir: &Path, plan: &str) -> Result<PlanRead> {
    let path = dir.join(plan);
    let meta = fs::metadata(&path).map_err(|_| PlanError::NotFound(plan.to_string()))?;
    let text = fs::read_to_string(&path)?;
    Ok(PlanRead {
        text,
        stamp: stamp_of(&meta),
    })
}

/// Write a plan, refusing if the file moved since `expected`.
///
/// `expected` of `None` means "this is a new file" — used when creating a plan,
/// and the only case in which an existing file is overwritten unconditionally.
pub fn write_plan(dir: &Path, plan: &str, text: &str, expected: Option<Stamp>) -> Result<Stamp> {
    let path = dir.join(plan);

    if let Some(expected) = expected {
        // The guard. A missing file is not a conflict: somebody deleted or moved
        // it, and refusing to write would leave the user with nowhere to save.
        if let Ok(meta) = fs::metadata(&path) {
            let current = stamp_of(&meta);
            if current != expected {
                return Err(PlanError::Conflict { current, expected });
            }
        }
    }

    // Atomic: write beside the target, then rename over it. A reader — including
    // the OneDrive sync client — sees either the old file or the new one.
    let temp = dir.join(format!(".{plan}.tmp"));
    fs::write(&temp, text)?;
    fs::rename(&temp, &path)?;

    let meta = fs::metadata(&path)?;
    Ok(stamp_of(&meta))
}

/* ── The lock ───────────────────────────────────────────────────────────── */

pub fn read_lock(dir: &Path, plan: &str) -> Option<Lock> {
    let text = fs::read_to_string(lock_path(dir, plan)).ok()?;
    serde_json::from_str(&text).ok()
}

/// What the current lock means for this window on this machine.
pub fn lock_state(dir: &Path, plan: &str, session: &str, device: &str) -> LockState {
    let Some(lock) = read_lock(dir, plan) else {
        return LockState {
            free: true,
            mine: false,
            live: false,
            holder: String::new(),
            idle_ms: 0,
        };
    };

    let idle_ms = now_ms().saturating_sub(lock.beat);
    let stale = idle_ms > STALE_MS;
    // Same window is ours. So is the same machine: it is either our own
    // abandoned lock or another window of this install, and the person in front
    // of both should not have to negotiate with themselves.
    let mine = lock.id == session || (!lock.device.is_empty() && lock.device == device);

    LockState {
        free: mine || stale,
        mine,
        live: !mine && !stale,
        holder: lock.holder.clone(),
        idle_ms,
    }
}

pub fn write_lock(dir: &Path, plan: &str, session: &str, device: &str, holder: &str) -> Result<Lock> {
    let now = now_ms();
    let existing = read_lock(dir, plan);
    let lock = Lock {
        id: session.to_string(),
        device: device.to_string(),
        holder: holder.to_string(),
        // Keep the original claim time when re-stamping our own lock, so the
        // interface can say how long someone has had it.
        since: existing
            .filter(|l| l.id == session)
            .map(|l| l.since)
            .unwrap_or(now),
        beat: now,
    };
    let text = serde_json::to_string_pretty(&lock).map_err(|e| PlanError::Parse(e.to_string()))?;
    fs::write(lock_path(dir, plan), text)?;
    Ok(lock)
}

/// Release the lock, but never somebody else's.
pub fn release_lock(dir: &Path, plan: &str, session: &str, device: &str) -> Result<bool> {
    match read_lock(dir, plan) {
        None => Ok(false),
        Some(lock) => {
            let ours = lock.id == session || (!lock.device.is_empty() && lock.device == device);
            if !ours {
                return Ok(false);
            }
            fs::remove_file(lock_path(dir, plan))?;
            Ok(true)
        }
    }
}

/* ── Attachments ────────────────────────────────────────────────────────── */

fn attachments_dir(dir: &Path) -> PathBuf {
    dir.join("attachments")
}

pub fn write_attachment(dir: &Path, id: &str, bytes: &[u8]) -> Result<u64> {
    let folder = attachments_dir(dir);
    fs::create_dir_all(&folder)?;
    let path = folder.join(id);
    let temp = folder.join(format!(".{id}.tmp"));
    fs::write(&temp, bytes)?;
    fs::rename(&temp, &path)?;
    Ok(bytes.len() as u64)
}

pub fn read_attachment(dir: &Path, id: &str) -> Result<Vec<u8>> {
    let path = attachments_dir(dir).join(id);
    fs::read(&path).map_err(|_| PlanError::NotFound(id.to_string()))
}

pub fn delete_attachment(dir: &Path, id: &str) -> Result<bool> {
    let path = attachments_dir(dir).join(id);
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(PlanError::Io(err)),
    }
}

/// Count and total bytes held in the attachments folder.
pub fn attachment_usage(dir: &Path) -> Result<(u64, u64)> {
    let folder = attachments_dir(dir);
    if !folder.exists() {
        return Ok((0, 0));
    }
    let mut count = 0;
    let mut total = 0;
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                count += 1;
                total += meta.len();
            }
        }
    }
    Ok((count, total))
}

/* ══════════════════════════════════════════════════════════════════════════
   Tests

   These are the rules that lose work when they are wrong, so they are tested
   against a real filesystem rather than a mock.
   ═══════════════════════════════════════════════════════════════════════ */

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch directory that cleans itself up.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("cx-plan-{tag}-{}", now_ms()));
            fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Modified times have limited resolution, so a test that writes twice in
    /// the same millisecond would see an unchanged stamp. Nudge time along.
    fn tick() {
        std::thread::sleep(std::time::Duration::from_millis(12));
    }

    #[test]
    fn writes_and_reads_a_plan() {
        let s = Scratch::new("rw");
        let stamp = write_plan(s.path(), "a.json", "{\"objects\":[]}", None).unwrap();
        assert!(stamp.size > 0);

        let read = read_plan(s.path(), "a.json").unwrap();
        assert_eq!(read.text, "{\"objects\":[]}");
        assert_eq!(read.stamp, stamp);
    }

    #[test]
    fn lists_plans_but_not_locks() {
        let s = Scratch::new("list");
        write_plan(s.path(), "one.json", "{}", None).unwrap();
        write_plan(s.path(), "two.json", "{}", None).unwrap();
        write_lock(s.path(), "one.json", "sess", "dev", "Aik").unwrap();

        let names: Vec<String> = list_plans(s.path()).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names.len(), 2, "got {names:?}");
        assert!(names.contains(&"one.json".to_string()));
        assert!(names.contains(&"two.json".to_string()));
        assert!(!names.iter().any(|n| n.contains("lock")));
    }

    #[test]
    fn a_matching_stamp_writes() {
        let s = Scratch::new("guard-ok");
        let first = write_plan(s.path(), "a.json", "one", None).unwrap();
        tick();
        let second = write_plan(s.path(), "a.json", "two", Some(first)).unwrap();
        assert_ne!(first, second, "the stamp must move when the file is written");
        assert_eq!(read_plan(s.path(), "a.json").unwrap().text, "two");
    }

    #[test]
    fn a_colleagues_save_is_never_overwritten() {
        let s = Scratch::new("guard-conflict");
        let mine = write_plan(s.path(), "a.json", "mine", None).unwrap();

        // A colleague's save lands: same path, different contents and stamp.
        tick();
        write_plan(s.path(), "a.json", "theirs", None).unwrap();

        // My save, still believing the file is as I last read it.
        let err = write_plan(s.path(), "a.json", "mine again", Some(mine)).unwrap_err();
        assert_eq!(err.kind(), "conflict", "expected a refusal, got {err}");

        // And theirs is intact, byte for byte.
        assert_eq!(read_plan(s.path(), "a.json").unwrap().text, "theirs");
    }

    #[test]
    fn a_deleted_file_is_not_a_conflict() {
        // Somebody moved the plan. Refusing to write would leave the user with
        // nowhere to save their work, which is worse than recreating it.
        let s = Scratch::new("guard-missing");
        let stamp = write_plan(s.path(), "a.json", "one", None).unwrap();
        fs::remove_file(s.path().join("a.json")).unwrap();
        assert!(write_plan(s.path(), "a.json", "two", Some(stamp)).is_ok());
    }

    #[test]
    fn no_temporary_file_is_left_behind() {
        let s = Scratch::new("atomic");
        write_plan(s.path(), "a.json", "one", None).unwrap();
        let leftovers: Vec<String> = fs::read_dir(s.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "left behind {leftovers:?}");
    }

    #[test]
    fn an_empty_folder_has_a_free_lock() {
        let s = Scratch::new("lock-free");
        let state = lock_state(s.path(), "a.json", "sess", "dev");
        assert!(state.free && !state.live && !state.mine);
    }

    #[test]
    fn a_colleagues_fresh_lock_is_live() {
        let s = Scratch::new("lock-live");
        write_lock(s.path(), "a.json", "their-window", "their-machine", "Dana").unwrap();
        let state = lock_state(s.path(), "a.json", "my-window", "my-machine");
        assert!(state.live, "a fresh lock from another machine must read as live");
        assert!(!state.free);
        assert_eq!(state.holder, "Dana");
    }

    #[test]
    fn our_own_lock_from_a_previous_run_is_ours() {
        // The bug this exists to prevent: closing the app and reopening it left
        // the user locked out of their own plan, because the window id changed.
        let s = Scratch::new("lock-mine");
        write_lock(s.path(), "a.json", "yesterdays-window", "my-machine", "Aik").unwrap();
        let state = lock_state(s.path(), "a.json", "todays-window", "my-machine");
        assert!(state.mine, "same machine must be recognised as ours");
        assert!(state.free, "and therefore immediately editable");
        assert!(!state.live);
    }

    #[test]
    fn an_abandoned_lock_goes_stale() {
        let s = Scratch::new("lock-stale");
        let old = now_ms() - (STALE_MS + 10_000);
        let lock = Lock {
            id: "gone".into(),
            device: "their-machine".into(),
            holder: "Dana".into(),
            since: old,
            beat: old,
        };
        fs::write(
            lock_path(s.path(), "a.json"),
            serde_json::to_string(&lock).unwrap(),
        )
        .unwrap();

        let state = lock_state(s.path(), "a.json", "my-window", "my-machine");
        assert!(state.free, "a lock with no heartbeat must not hold anyone out");
        assert!(!state.live);
        assert!(state.idle_ms > STALE_MS);
    }

    #[test]
    fn re_stamping_keeps_the_original_claim_time() {
        let s = Scratch::new("lock-since");
        let first = write_lock(s.path(), "a.json", "sess", "dev", "Aik").unwrap();
        tick();
        let second = write_lock(s.path(), "a.json", "sess", "dev", "Aik").unwrap();
        assert_eq!(first.since, second.since, "since must not move on a heartbeat");
        assert!(second.beat >= first.beat);
    }

    #[test]
    fn releasing_never_removes_someone_elses_lock() {
        let s = Scratch::new("lock-release");
        write_lock(s.path(), "a.json", "their-window", "their-machine", "Dana").unwrap();
        assert!(!release_lock(s.path(), "a.json", "my-window", "my-machine").unwrap());
        assert!(read_lock(s.path(), "a.json").is_some(), "theirs must survive");

        write_lock(s.path(), "a.json", "my-window", "my-machine", "Aik").unwrap();
        assert!(release_lock(s.path(), "a.json", "my-window", "my-machine").unwrap());
        assert!(read_lock(s.path(), "a.json").is_none());
    }

    #[test]
    fn attachments_round_trip() {
        let s = Scratch::new("att");
        write_attachment(s.path(), "att_1", b"hello bytes").unwrap();
        assert_eq!(read_attachment(s.path(), "att_1").unwrap(), b"hello bytes");

        let (count, bytes) = attachment_usage(s.path()).unwrap();
        assert_eq!(count, 1);
        assert_eq!(bytes, 11);

        assert!(delete_attachment(s.path(), "att_1").unwrap());
        assert!(!delete_attachment(s.path(), "att_1").unwrap(), "twice is not an error");
    }
}
