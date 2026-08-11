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

/// One device's claim on the pen, as it sits in the folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimFile {
    pub name: String,
    pub text: String,
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

/* ── Claims on the pen ──────────────────────────────────────────────────────
   One file per device, written only by that device. Two machines sharing a
   single lock file gave OneDrive two versions of one file to reconcile several
   times a minute; it cannot merge them, so each machine went on reading back
   its own stamp and both believed they held the pen. Files nobody writes
   together cannot conflict. */

/// `<plan>.json` + a device → `<plan>.pen-<device>.json`
fn claim_path(dir: &Path, plan: &str, device: &str) -> PathBuf {
    let stem = plan.strip_suffix(".json").unwrap_or(plan);
    let safe: String = device
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    dir.join(format!("{stem}.pen-{safe}.json"))
}

fn is_claim_for(plan: &str, name: &str) -> bool {
    let stem = plan.strip_suffix(".json").unwrap_or(plan).to_lowercase();
    let lower = name.to_lowercase();
    lower.starts_with(&format!("{stem}.pen-")) && lower.ends_with(".json")
}

/// Every claim on a plan, as `{ name, text }`. Unreadable ones are skipped:
/// a claim that cannot be read this time round simply does not count.
pub fn read_claims(dir: &Path, plan: &str) -> Result<Vec<ClaimFile>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_claim_for(plan, &name) {
            continue;
        }
        if let Ok(text) = fs::read_to_string(entry.path()) {
            out.push(ClaimFile { name, text });
        }
    }
    Ok(out)
}

pub fn write_claim(dir: &Path, plan: &str, device: &str, text: &str) -> Result<()> {
    fs::write(claim_path(dir, plan, device), text)?;
    Ok(())
}

pub fn remove_claim(dir: &Path, plan: &str, device: &str) -> bool {
    fs::remove_file(claim_path(dir, plan, device)).is_ok()
}

/// Which claim holds the pen — the same reading `penHolder()` makes in
/// filestore.js, and it has to stay the same or the shell would announce one
/// holder before the window opens and the application another after.
///
/// Earliest claim still beating, so opening a plan to read it never takes the
/// pen off somebody already working. An explicit takeover outranks that, latest
/// first; the device id breaks an exact tie, only so both sides break it alike.
pub fn pen_holder(dir: &Path, plan: &str) -> Option<Lock> {
    let now = now_ms();
    let mut best: Option<(u64, Lock)> = None;

    for claim in read_claims(dir, plan).unwrap_or_default() {
        let Ok(lock) = serde_json::from_str::<Lock>(&claim.text) else {
            continue;
        };
        if now.saturating_sub(lock.beat) > STALE_MS {
            continue;
        }
        let takeover = serde_json::from_str::<serde_json::Value>(&claim.text)
            .ok()
            .and_then(|v| v.get("takeover").and_then(|t| t.as_u64()))
            .unwrap_or(0);

        best = Some(match best {
            None => (takeover, lock),
            Some((best_takeover, best_lock)) => {
                let wins = if takeover != best_takeover {
                    takeover > best_takeover
                } else if lock.since != best_lock.since {
                    lock.since < best_lock.since
                } else {
                    lock.device < best_lock.device
                };
                if wins {
                    (takeover, lock)
                } else {
                    (best_takeover, best_lock)
                }
            }
        });
    }

    best.map(|(_, lock)| lock)
}

/// A lock file, conflict copies included. Mirrors `isLockFile` in filestore.js.
///
/// OneDrive cannot merge two edits of one file: it keeps both and appends the
/// machine name, so the heartbeat leaves `plan.lock-HRUSPITLT02820.json` behind,
/// then `-2`, `-3`. Those are `.json` files beside the plan, so they must never
/// be listed as plans. The separator test keeps a plan called `lockheed.json`
/// out of it.
pub fn is_lock_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    let Some(rest) = lower.strip_suffix(".json") else {
        return false;
    };
    // `.lock` is the old single lock and its conflict copies; `.pen-<device>`
    // is one session's claim. Neither is a plan.
    [".lock", ".pen"].iter().any(|marker| match rest.rfind(marker) {
        None => false,
        Some(at) => {
            let tail = &rest[at + marker.len()..];
            tail.is_empty() || tail.starts_with(['-', '_', '.', ' ', '('])
        }
    })
}

/// A lock file nothing will ever read: a conflict copy rather than a lock.
///
/// Deleting one is always safe, whichever plan it belongs to — no code path in
/// either build opens a name like this. A real `<plan>.lock.json` is left
/// alone, because somebody may be holding it.
pub fn is_lock_litter(name: &str) -> bool {
    let lower = name.to_lowercase();
    let Some(rest) = lower.strip_suffix(".json") else {
        return false;
    };
    // Copies of the old single lock file only. A claim file is *not* litter: it
    // is somebody's turn, written by the one device allowed to write it, and it
    // is retired by age rather than on sight.
    match rest.rfind(".lock") {
        None => false,
        Some(at) => {
            let tail = &rest[at + ".lock".len()..];
            !tail.is_empty() && tail.starts_with(['-', '_', '.', ' ', '('])
        }
    }
}

/// Clear the conflict copies out of a folder. Answers how many went.
///
/// The lock is meant to be temporary — one file, removed when the last session
/// leaves. Its conflict copies are what outlive it, and nothing else would ever
/// tidy them up.
pub fn sweep_lock_litter(dir: &Path) -> Result<u32> {
    let mut removed = 0;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_lock_litter(&name) {
            continue;
        }
        match entry.metadata() {
            Ok(meta) if meta.is_file() => {}
            _ => continue,
        }
        // A copy that has already gone is a success, not a failure.
        if fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/* ── Plans ──────────────────────────────────────────────────────────────── */

/// Every plan in a folder, newest first. Lock files are not plans.
pub fn list_plans(dir: &Path) -> Result<Vec<PlanInfo>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if !lower.ends_with(".json") || is_lock_name(&name) {
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
    // Claims first — they are what the application itself goes by. The old
    // single lock file is still read, so a colleague running a copy from before
    // claims existed is still announced before the window opens.
    let Some(lock) = pen_holder(dir, plan).or_else(|| read_lock(dir, plan)) else {
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

    /// OneDrive's conflict copies are `.json` files sitting beside the plan.
    /// Listed as plans — which is what used to happen — the folder picker fills
    /// up with junk that cannot be opened.
    #[test]
    fn a_sync_clients_copies_of_a_lock_are_not_plans() {
        let s = Scratch::new("list-litter");
        write_plan(s.path(), "one.json", "{}", None).unwrap();
        write_plan(s.path(), "lockheed.json", "{}", None).unwrap();
        write_lock(s.path(), "one.json", "sess", "dev", "Aik").unwrap();
        fs::write(s.path().join("one.lock-HRUSPITLT02820.json"), "{}").unwrap();
        fs::write(s.path().join("one.lock-HRUSPITLT02820-21.json"), "{}").unwrap();

        let names: Vec<String> = list_plans(s.path()).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names.len(), 2, "got {names:?}");
        assert!(names.contains(&"one.json".to_string()));
        // A plan is not a lock just because its name contains the letters.
        assert!(names.contains(&"lockheed.json".to_string()), "got {names:?}");
    }

    /// The bug this design exists to kill: two machines, both editing.
    ///
    /// With one shared lock file each machine mostly read back its own stamp,
    /// because a sync client cannot merge two versions of one file. Claims are
    /// per device and only that device writes one, so both sides read the same
    /// set and come to the same answer — the earlier claim.
    #[test]
    fn the_earlier_claim_holds_the_pen() {
        let s = Scratch::new("claims");
        let now = now_ms();
        let claim = |device: &str, holder: &str, since: u64| {
            let text = format!(
                r#"{{"id":"{device}-win","device":"{device}","holder":"{holder}","since":{since},"beat":{now}}}"#
            );
            write_claim(s.path(), "a.json", device, &text).unwrap();
        };

        claim("dev-aik", "Aik", now - 60_000);
        claim("dev-coworker", "Sam", now - 20_000);

        let holder = pen_holder(s.path(), "a.json").expect("someone holds it");
        assert_eq!(holder.holder, "Aik", "the one who opened it first keeps it");

        // Reading it does not steal it, however many readers arrive.
        claim("dev-third", "Rae", now - 5_000);
        assert_eq!(pen_holder(s.path(), "a.json").unwrap().holder, "Aik");
    }

    #[test]
    fn a_claim_that_stopped_beating_does_not_hold_the_pen() {
        let s = Scratch::new("claims-stale");
        let now = now_ms();
        write_claim(
            s.path(),
            "a.json",
            "dev-gone",
            &format!(r#"{{"id":"x","device":"dev-gone","holder":"Aik","since":{},"beat":{}}}"#,
                now - 900_000, now - 600_000),
        )
        .unwrap();
        assert!(pen_holder(s.path(), "a.json").is_none(), "a crashed session holds nothing");

        write_claim(
            s.path(),
            "a.json",
            "dev-here",
            &format!(r#"{{"id":"y","device":"dev-here","holder":"Sam","since":{},"beat":{now}}}"#, now - 10_000),
        )
        .unwrap();
        assert_eq!(pen_holder(s.path(), "a.json").unwrap().holder, "Sam");
    }

    /// Taking over is a statement in your own file, never a write to theirs.
    #[test]
    fn an_explicit_takeover_outranks_an_earlier_claim() {
        let s = Scratch::new("claims-takeover");
        let now = now_ms();
        write_claim(
            s.path(),
            "a.json",
            "dev-aik",
            &format!(r#"{{"id":"x","device":"dev-aik","holder":"Aik","since":{},"beat":{now}}}"#, now - 60_000),
        )
        .unwrap();
        write_claim(
            s.path(),
            "a.json",
            "dev-sam",
            &format!(
                r#"{{"id":"y","device":"dev-sam","holder":"Sam","since":{},"beat":{now},"takeover":{now}}}"#,
                now - 5_000
            ),
        )
        .unwrap();

        assert_eq!(pen_holder(s.path(), "a.json").unwrap().holder, "Sam");
        assert!(remove_claim(s.path(), "a.json", "dev-sam"));
        assert_eq!(
            pen_holder(s.path(), "a.json").unwrap().holder,
            "Aik",
            "and leaving hands it straight back"
        );
    }

    /// Claims are not plans, and a claim file is not litter to be swept.
    #[test]
    fn claims_are_neither_plans_nor_litter() {
        let s = Scratch::new("claims-listing");
        write_plan(s.path(), "a.json", "{}", None).unwrap();
        write_claim(s.path(), "a.json", "dev-aik", "{}").unwrap();
        fs::write(s.path().join("a.lock-HRUSPITLT02820.json"), "{}").unwrap();

        let names: Vec<String> = list_plans(s.path()).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["a.json".to_string()], "got {names:?}");

        assert_eq!(sweep_lock_litter(s.path()).unwrap(), 1);
        assert!(pen_holder(s.path(), "a.json").is_none(), "an empty claim parses as nothing");
        assert_eq!(read_claims(s.path(), "a.json").unwrap().len(), 1, "but the file is still there");
    }

    /// The litter is cleared; the live lock is somebody's and stays.
    #[test]
    fn sweeping_removes_the_copies_and_keeps_the_lock() {
        let s = Scratch::new("sweep");
        write_plan(s.path(), "one.json", "{}", None).unwrap();
        write_lock(s.path(), "one.json", "sess", "dev", "Aik").unwrap();
        fs::write(s.path().join("one.lock-HRUSPITLT02820.json"), "{}").unwrap();
        fs::write(s.path().join("one.lock-HRUSPITLT02820-2.json"), "{}").unwrap();
        fs::write(s.path().join("one.lock-HRusOAKLT05731.json"), "{}").unwrap();

        assert_eq!(sweep_lock_litter(s.path()).unwrap(), 3);
        assert!(read_lock(s.path(), "one.json").is_some(), "the live lock survives");
        assert!(read_plan(s.path(), "one.json").is_ok(), "so does the plan");
        assert_eq!(sweep_lock_litter(s.path()).unwrap(), 0, "nothing left to sweep");
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
