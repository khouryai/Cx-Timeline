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
    /// The request itself was not allowed — an unsafe path, or a destination
    /// that already holds something else. Distinct from an I/O failure,
    /// because a caller should not retry it.
    Refused(String),
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
            PlanError::Refused(why) => write!(f, "{why}"),
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
            PlanError::Refused(_) => "refused",
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
   The intake folders

   The look-ahead workbook and the SAR PDFs arrive by hand, in subfolders of
   the same folder the plan lives in. Everything below reaches into those, and
   none of it is allowed the freedoms the plan commands have: `read_plan` takes
   a name the application chose, while these take names that came off a file
   somebody dropped in, or out of a spreadsheet cell.
   ═══════════════════════════════════════════════════════════════════════ */

/// Is this a single, safe path component?
///
/// The existing attachment commands join an id straight into the folder path,
/// which is safe only because that id is generated by the application. SAR
/// numbers, week folders and inbox filenames are not: they come from a file
/// name or a spreadsheet cell, and the front end is not a boundary — anything
/// reaching this crate must assume the string is hostile.
///
/// So: one component, no separators, no `..`, no control characters, and none
/// of the characters Windows refuses in a name. A rejected name is an error,
/// never a sanitised guess — silently writing `SAR12345` when asked for
/// `SAR/12345` would file evidence somewhere nobody would look for it.
pub fn is_safe_component(name: &str) -> bool {
    if name.is_empty() || name.len() > 200 {
        return false;
    }
    if name == "." || name == ".." {
        return false;
    }
    // A trailing dot or space is silently stripped by Windows, so a name that
    // relies on one is a different file than it claims to be.
    if name.ends_with('.') || name.ends_with(' ') || name.starts_with(' ') {
        return false;
    }
    !name.chars().any(|c| {
        matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || (c as u32) < 0x20
    })
}

/// Join a relative path onto the folder, refusing anything that could escape.
///
/// Each component is checked separately rather than the joined string, because
/// `a/../../b` contains no illegal characters and still leaves the folder.
fn safe_join(dir: &Path, rel: &str) -> Result<PathBuf> {
    let mut out = dir.to_path_buf();
    let mut any = false;
    for part in rel.split('/') {
        if part.is_empty() {
            continue;
        }
        if !is_safe_component(part) {
            return Err(PlanError::Refused(format!("unsafe path component: {part}")));
        }
        out.push(part);
        any = true;
    }
    if !any {
        return Err(PlanError::Refused("empty path".into()));
    }
    Ok(out)
}

/// A OneDrive conflict copy, for any extension.
///
/// When two machines edit one file, OneDrive cannot merge them, so it keeps
/// both and appends the machine name: `Look-Ahead-HRUSPITLT02820.xlsx`, then
/// `-2`, `-3`. `is_lock_name` already does this for lock files; the intake
/// folders need the same rule, because ingesting a conflict copy would snapshot
/// the same week twice from two slightly different files and manufacture a
/// change event that never happened.
///
/// Deliberately conservative: it wants a separator followed by something that
/// looks like a machine name or a copy number, so an ordinary file with a
/// hyphen in it — `Four-Week Look-Ahead.xlsx` — is not mistaken for one.
pub fn is_conflict_copy(name: &str) -> bool {
    let stem = match name.rfind('.') {
        Some(at) => &name[..at],
        None => name,
    };
    // A machine name is upper-case and long; a copy marker is a bare number.
    match stem.rfind('-') {
        None => false,
        Some(at) => {
            let tail = &stem[at + 1..];
            if tail.is_empty() {
                return false;
            }
            let numeric = tail.chars().all(|c| c.is_ascii_digit()) && tail.len() <= 3;
            let machine = tail.len() >= 8
                && tail.chars().all(|c| c.is_ascii_alphanumeric())
                && tail.chars().any(|c| c.is_ascii_digit())
                && tail.chars().filter(|c| c.is_ascii_alphabetic()).all(|c| c.is_ascii_uppercase());
            numeric || machine
        }
    }
}

/// One file in an intake folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub size: u64,
    pub modified: u64,
    /// True for a OneDrive conflict copy. Reported rather than hidden: two
    /// versions of the look-ahead means somebody's edits are about to be lost,
    /// which is worth saying out loud rather than quietly skipping.
    pub conflict: bool,
}

/// List a subfolder. Missing is empty, not an error — the folder is created
/// by whoever first drops something in it.
pub fn list_files(dir: &Path, rel: &str) -> Result<Vec<FileInfo>> {
    let folder = safe_join(dir, rel)?;
    if !folder.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&folder)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = match entry.metadata() {
            Ok(meta) if meta.is_file() => meta,
            _ => continue,
        };
        // Excel's own sidecar while a workbook is open. Never a file to read.
        if name.starts_with("~$") {
            continue;
        }
        let stamp = stamp_of(&meta);
        out.push(FileInfo {
            conflict: is_conflict_copy(&name),
            name,
            size: stamp.size,
            modified: stamp.modified,
        });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

/// Read a file from a subfolder, as bytes.
pub fn read_file(dir: &Path, rel: &str) -> Result<Vec<u8>> {
    let path = safe_join(dir, rel)?;
    fs::read(&path).map_err(|_| PlanError::NotFound(rel.to_string()))
}

/// The size and modified time of a file, without reading it.
///
/// This is what the look-ahead watcher polls. Note what the modified time
/// actually is on a synced folder: OneDrive stamps a file when it *syncs*, not
/// when somebody edited it, so it is evidence of arrival rather than of
/// authorship — which is why a snapshot records this and its own observation
/// time as two separate facts.
pub fn stat_file(dir: &Path, rel: &str) -> Result<Stamp> {
    let path = safe_join(dir, rel)?;
    let meta = fs::metadata(&path).map_err(|_| PlanError::NotFound(rel.to_string()))?;
    Ok(stamp_of(&meta))
}

/// Write bytes into a subfolder, atomically, creating it if needed.
pub fn write_file(dir: &Path, rel: &str, bytes: &[u8]) -> Result<Stamp> {
    let path = safe_join(dir, rel)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!(
        "{}.tmp",
        path.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default()
    ));
    fs::write(&temp, bytes)?;
    fs::rename(&temp, &path)?;
    let meta = fs::metadata(&path)?;
    Ok(stamp_of(&meta))
}

/// Move a file within the folder — the inbox to where it is filed.
///
/// Copy, verify, then delete, rather than a bare rename. A rename is atomic
/// but only within one filesystem, and a synced folder is not a guarantee of
/// that. Verifying the copy before removing the source means an interruption
/// leaves the file in the inbox — a duplicate to re-file, never a loss.
///
/// Idempotent: if the destination already holds identical bytes, the source is
/// simply removed. Re-running an ingest is therefore always safe.
pub fn move_file(dir: &Path, from_rel: &str, to_rel: &str) -> Result<Stamp> {
    let from = safe_join(dir, from_rel)?;
    let to = safe_join(dir, to_rel)?;
    let bytes = fs::read(&from).map_err(|_| PlanError::NotFound(from_rel.to_string()))?;

    if to.exists() {
        let existing = fs::read(&to)?;
        if existing != bytes {
            return Err(PlanError::Refused(format!(
                "{to_rel} already exists and holds something else"
            )));
        }
        fs::remove_file(&from)?;
        return Ok(stamp_of(&fs::metadata(&to)?));
    }

    let stamp = write_file(dir, to_rel, &bytes)?;
    if fs::read(&to)? != bytes {
        return Err(PlanError::Refused(format!("{to_rel} did not verify after writing")));
    }
    fs::remove_file(&from)?;
    Ok(stamp)
}

/// Delete a file from an intake folder.
///
/// Refuses anything that is not inside a subfolder, so the plan itself can
/// never be reached through this door — the same care `file_remove` takes with
/// lock names.
pub fn delete_file(dir: &Path, rel: &str) -> Result<bool> {
    if !rel.contains('/') {
        return Err(PlanError::Refused(
            "only files inside a subfolder can be deleted".into(),
        ));
    }
    let path = safe_join(dir, rel)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(PlanError::Io(err)),
    }
}

/// SHA-256 of a file's bytes, as lower-case hex.
///
/// Implemented here rather than pulled in, to keep the "no runtime
/// dependencies" rule the rest of the project holds to. It is a real
/// cryptographic digest and not a checksum on purpose: it dedupes snapshots,
/// and it is what an archived workbook is identified by when somebody asks,
/// months later, whether the file behind a change event is the one they are
/// looking at.
pub fn sha256_hex(bytes: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];

    let mut msg = bytes.to_vec();
    let bit_len = (bytes.len() as u64) * 8;
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);

            hh = g; g = f; f = e;
            e = d.wrapping_add(t1);
            d = c; c = b; b = a;
            a = t1.wrapping_add(t2);
        }
        h[0] = h[0].wrapping_add(a); h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c); h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e); h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g); h[7] = h[7].wrapping_add(hh);
    }

    h.iter().map(|v| format!("{v:08x}")).collect()
}

/// The digest of a file in the folder.
pub fn hash_file(dir: &Path, rel: &str) -> Result<String> {
    Ok(sha256_hex(&read_file(dir, rel)?))
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

    /* ── The intake folders ────────────────────────────────────────────── */

    #[test]
    fn a_path_that_escapes_the_folder_is_refused() {
        let dir = Scratch::new("escape");
        // The attachment commands join an id straight in, which is safe only
        // because the application generates it. These take names off a dropped
        // file or a spreadsheet cell, so the front end cannot be the boundary.
        for bad in [
            "../outside.txt",
            "sars/../../outside.txt",
            "sars/..",
            "sars/a:b.pdf",
            "sars/a|b.pdf",
        ] {
            let err = write_file(dir.path(), bad, b"x").unwrap_err();
            assert_eq!(err.kind(), "refused", "{bad} should have been refused, got {err}");
        }
        // And nothing was created on the way to refusing.
        assert!(!dir.path().join("outside.txt").exists());
    }

    #[test]
    fn a_name_windows_would_quietly_change_is_refused() {
        // Windows strips a trailing dot or space, so a file saved under one is
        // not the file that was asked for — which for evidence is worse than
        // an error.
        assert!(!is_safe_component("SAR-1."));
        assert!(!is_safe_component("SAR-1 "));
        assert!(!is_safe_component(" SAR-1"));
        assert!(!is_safe_component(""));
        assert!(!is_safe_component(".."));
        assert!(is_safe_component("SAR-12345.pdf"));
        assert!(is_safe_component("2026-W35"));
    }

    #[test]
    fn a_onedrive_conflict_copy_is_recognised() {
        // Two machines editing one workbook leaves two files. Ingesting both
        // would snapshot the same week twice from slightly different data and
        // invent a change that never happened.
        assert!(is_conflict_copy("Four-Week Look-Ahead-HRUSPITLT02820.xlsx"));
        assert!(is_conflict_copy("Look-Ahead-2.xlsx"));
        assert!(is_conflict_copy("SAR-12345-DESKTOP7788.pdf"));

        // But an ordinary hyphenated name is not one, or every look-ahead ever
        // saved would be flagged.
        assert!(!is_conflict_copy("Four-Week Look-Ahead.xlsx"));
        assert!(!is_conflict_copy("SAR-12345.pdf"));
        assert!(!is_conflict_copy("2026-W35.pdf"));
    }

    #[test]
    fn listing_reports_conflict_copies_rather_than_hiding_them() {
        let dir = Scratch::new("intake");
        write_file(dir.path(), "lookahead/Four-Week Look-Ahead.xlsx", b"real").unwrap();
        write_file(dir.path(), "lookahead/Four-Week Look-Ahead-HRUSPITLT02820.xlsx", b"copy").unwrap();
        // Excel's sidecar while the workbook is open is never a file to read.
        fs::write(dir.path().join("lookahead").join("~$Four-Week Look-Ahead.xlsx"), b"lock").unwrap();

        let files = list_files(dir.path(), "lookahead").unwrap();
        assert_eq!(files.len(), 2, "the ~$ sidecar should not be listed");
        assert_eq!(files.iter().filter(|f| f.conflict).count(), 1);
    }

    #[test]
    fn listing_a_folder_that_does_not_exist_yet_is_empty_not_an_error() {
        let dir = Scratch::new("empty-intake");
        assert!(list_files(dir.path(), "sars/inbox").unwrap().is_empty());
    }

    #[test]
    fn filing_a_file_leaves_no_duplicate_and_no_loss() {
        let dir = Scratch::new("file-it");
        write_file(dir.path(), "sars/inbox/SAR-12345.pdf", b"%PDF-1.4 body").unwrap();

        move_file(dir.path(), "sars/inbox/SAR-12345.pdf", "sars/2026-W35/SAR-12345.pdf").unwrap();

        assert!(!dir.path().join("sars/inbox/SAR-12345.pdf").exists(), "the source is gone");
        assert_eq!(
            fs::read(dir.path().join("sars/2026-W35/SAR-12345.pdf")).unwrap(),
            b"%PDF-1.4 body",
            "and arrived intact"
        );
        assert!(list_files(dir.path(), "sars/inbox").unwrap().is_empty());
    }

    #[test]
    fn re_running_an_ingest_is_harmless() {
        let dir = Scratch::new("idempotent");
        write_file(dir.path(), "sars/inbox/SAR-1.pdf", b"same").unwrap();
        move_file(dir.path(), "sars/inbox/SAR-1.pdf", "sars/2026-W35/SAR-1.pdf").unwrap();

        // The same file dropped in again, after the first pass filed it.
        write_file(dir.path(), "sars/inbox/SAR-1.pdf", b"same").unwrap();
        move_file(dir.path(), "sars/inbox/SAR-1.pdf", "sars/2026-W35/SAR-1.pdf").unwrap();

        assert!(list_files(dir.path(), "sars/inbox").unwrap().is_empty());
        assert_eq!(list_files(dir.path(), "sars/2026-W35").unwrap().len(), 1);
    }

    #[test]
    fn filing_over_something_different_is_refused_rather_than_overwritten() {
        let dir = Scratch::new("no-clobber");
        write_file(dir.path(), "sars/2026-W35/SAR-1.pdf", b"the real one").unwrap();
        write_file(dir.path(), "sars/inbox/SAR-1.pdf", b"a different one").unwrap();

        let err = move_file(dir.path(), "sars/inbox/SAR-1.pdf", "sars/2026-W35/SAR-1.pdf").unwrap_err();
        assert_eq!(err.kind(), "refused");
        // Neither side was touched: the evidence stands and the new file is
        // still in the inbox to be dealt with.
        assert_eq!(fs::read(dir.path().join("sars/2026-W35/SAR-1.pdf")).unwrap(), b"the real one");
        assert!(dir.path().join("sars/inbox/SAR-1.pdf").exists());
    }

    #[test]
    fn the_plan_cannot_be_deleted_through_the_intake_door() {
        let dir = Scratch::new("no-delete-plan");
        write_plan(dir.path(), "plan.json", "{}", None).unwrap();

        let err = delete_file(dir.path(), "plan.json").unwrap_err();
        assert_eq!(err.kind(), "refused");
        assert!(dir.path().join("plan.json").exists());

        // A file genuinely inside an intake folder still goes.
        write_file(dir.path(), "sars/inbox/junk.pdf", b"x").unwrap();
        assert!(delete_file(dir.path(), "sars/inbox/junk.pdf").unwrap());
    }

    #[test]
    fn an_intake_write_leaves_no_temporary_behind() {
        let dir = Scratch::new("no-temp-intake");
        write_file(dir.path(), "lookahead/x.xlsx", b"bytes").unwrap();
        let names: Vec<String> = fs::read_dir(dir.path().join("lookahead"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["x.xlsx".to_string()]);
    }

    #[test]
    fn stat_reports_the_stamp_without_reading_the_file() {
        let dir = Scratch::new("stat");
        write_file(dir.path(), "lookahead/x.xlsx", b"twelve bytes").unwrap();
        let stamp = stat_file(dir.path(), "lookahead/x.xlsx").unwrap();
        assert_eq!(stamp.size, 12);
        assert!(stamp.modified > 0);
        assert_eq!(stat_file(dir.path(), "lookahead/gone.xlsx").unwrap_err().kind(), "not-found");
    }

    #[test]
    fn the_digest_matches_the_published_vectors() {
        // Against the standard test vectors, so a mistake in the
        // implementation cannot hide behind self-consistency.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn an_unchanged_file_hashes_the_same_and_a_changed_one_does_not() {
        let dir = Scratch::new("hash");
        write_file(dir.path(), "lookahead/x.xlsx", b"week 35").unwrap();
        let first = hash_file(dir.path(), "lookahead/x.xlsx").unwrap();

        // A file re-synced with no edit must not look like a new snapshot.
        write_file(dir.path(), "lookahead/x.xlsx", b"week 35").unwrap();
        assert_eq!(hash_file(dir.path(), "lookahead/x.xlsx").unwrap(), first);

        write_file(dir.path(), "lookahead/x.xlsx", b"week 36").unwrap();
        assert_ne!(hash_file(dir.path(), "lookahead/x.xlsx").unwrap(), first);
    }
}
