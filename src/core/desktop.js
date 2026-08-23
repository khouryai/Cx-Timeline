/**
 * The desktop shell's file bridge.
 *
 * This module is the *only* one that knows Tauri exists, the same way
 * `core/cloud.js` is the only one that knows about Supabase and
 * `core/filestore.js` owns the browser's File System Access API.
 *
 * It is inert in a browser: `isAvailable()` returns false, nothing here is ever
 * called, and the web build behaves exactly as it always has.
 *
 * What the desktop build gets that the browser cannot have
 * -------------------------------------------------------
 *   real paths      A folder is remembered as a path, not an opaque handle, so
 *                   the plan opens on launch with no permission prompt at all.
 *                   The browser has to re-ask whenever its grant lapses.
 *   atomic writes   The plan is written to a temporary file and renamed over the
 *                   target, so a crash — or OneDrive reading mid-write — never
 *                   sees a half-written plan.
 *   one round trip  The guard compares the file and writes it inside a single
 *                   call, narrowing the window a colleague's sync can land in.
 *
 * What it deliberately does *not* do is decide anything. Whose lock it is,
 * whether a lock has gone stale, when to refuse a save — all of that lives in
 * `core/filestore.js` and is covered by `tools/smoke_folder.js`. Two
 * implementations of those rules is how they drift apart, so this only moves
 * bytes.
 *
 * Imports: nothing (leaf).
 */

/** Tauri v2 exposes its bridge here. Nothing else in a browser does. */
function bridge() {
  return typeof window !== 'undefined' ? window.__TAURI_INTERNALS__ : null;
}

/** True when running inside the desktop shell. */
export function isAvailable() {
  const api = bridge();
  return !!api && typeof api.invoke === 'function';
}

/**
 * Call a command in the shell.
 *
 * Rust returns its failures as `{ kind, message, current?, expected? }`. Those
 * are rethrown as an Error carrying the same fields, so a caller can branch on
 * `err.kind === 'conflict'` exactly as it branches on the browser's stamp check.
 */
async function call(command, args = {}) {
  const api = bridge();
  if (!api) throw new Error('The desktop bridge is not available.');
  try {
    return await api.invoke(command, args);
  } catch (raw) {
    if (raw && typeof raw === 'object' && raw.kind) {
      const err = new Error(raw.message || 'The desktop shell refused that.');
      err.kind = raw.kind;
      err.current = raw.current;
      err.expected = raw.expected;
      throw err;
    }
    throw raw instanceof Error ? raw : new Error(String(raw));
  }
}

/* ── Settings: which folder, which plan, who you are ───────────────────── */

export function readSettings() {
  return call('settings_read');
}

export function writeSettings({ folder = '', plan = '', displayName = '' } = {}) {
  return call('settings_write', { folder, plan, displayName });
}

/** The OS folder picker. Resolves to '' when cancelled. */
export function pickFolder() {
  return call('pick_folder');
}

/* ── Plans ─────────────────────────────────────────────────────────────── */

export function listPlans(folder) {
  return call('list_plans', { folder });
}

/** `{ text, stamp: { size, modified } }` */
export function readPlan(folder, name) {
  return call('read_plan', { folder, name });
}

/**
 * Write a plan, refusing if it moved since `expected`.
 * Pass `null` for `expected` when creating a file for the first time.
 */
export function writePlan(folder, name, text, expected) {
  return call('write_plan', { folder, name, text, expected: expected || null });
}

/* ── The lock file, as bytes only ──────────────────────────────────────── */

export async function readLockText(folder, name) {
  const text = await call('lock_read', { folder, name });
  return text || null;
}

export function writeLockText(folder, name, text) {
  return call('lock_write', { folder, name, text });
}

export function removeLock(folder, name) {
  return call('lock_remove', { folder, name });
}

/**
 * Delete the conflict copies a sync client has made of the lock files, and
 * answer how many went.
 *
 * A shell built before this command existed rejects the call; the caller treats
 * that as "swept nothing", which is exactly what happened.
 */
export function sweepLocks(folder) {
  return call('lock_sweep', { folder });
}

/* ── Claims on the pen, one file per device ────────────────────────────── */

/** `[{ name, text }]` for every device that has claimed this plan. */
export async function readClaims(folder, plan) {
  const claims = await call('claims_read', { folder, plan });
  return Array.isArray(claims) ? claims : [];
}

export function writeClaim(folder, plan, device, text) {
  return call('claim_write', { folder, plan, device, text });
}

export function removeClaim(folder, plan, device) {
  return call('claim_remove', { folder, plan, device });
}

/** Delete one file in the folder by name — used to retire a dead claim. */
export function removeNamed(folder, name) {
  return call('file_remove', { folder, name });
}

/**
 * Who has the pen, as the shell saw it before the window opened.
 *
 * The one thing the desktop build can genuinely do better than the web build:
 * answer this before any interface exists, so a colleague holding the plan can
 * be announced up front rather than walked back after the canvas has drawn.
 */
export function startupLockCheck() {
  return call('startup_lock_check');
}

/* ── Attachments ───────────────────────────────────────────────────────── */

export async function writeAttachment(folder, id, file) {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  await call('attachment_write', { folder, id, bytes });
  return { id, name: file.name, type: file.type, size: file.size };
}

export async function readAttachment(folder, id, type = '') {
  const bytes = await call('attachment_read', { folder, id });
  const blob = new Blob([new Uint8Array(bytes)], { type: type || 'application/octet-stream' });
  return { id, blob, name: id, type: blob.type, size: blob.size };
}

export function deleteAttachment(folder, id) {
  return call('attachment_delete', { folder, id });
}

export async function attachmentUsage(folder) {
  const [count, bytes] = await call('attachment_usage', { folder });
  return { count, bytes };
}

/* ── The intake folders ────────────────────────────────────────────────── */

/**
 * Subfolders of the plan's folder, where the look-ahead workbook and the SAR
 * PDFs arrive by hand.
 *
 * Every path is checked component by component on the Rust side, because these
 * names come off a dropped file or a spreadsheet cell rather than from the
 * application. Nothing here sanitises: an unsafe name comes back as
 * `err.kind === 'refused'` and stays refused, since quietly writing
 * `SAR12345` when asked for `SAR/12345` would file evidence somewhere nobody
 * would ever look for it.
 */
export function intakeList(folder, path) {
  return call('intake_list', { folder, path });
}

export async function intakeRead(folder, path) {
  const bytes = await call('intake_read', { folder, path });
  return new Uint8Array(bytes).buffer;
}

/**
 * Size and modified time, without reading the file — what the look-ahead
 * watcher polls.
 *
 * The modified time on a synced folder is when OneDrive *delivered* the file,
 * not when it was edited, so it is evidence of arrival rather than authorship.
 * A snapshot records it and its own observation time as two separate facts.
 */
export function intakeStat(folder, path) {
  return call('intake_stat', { folder, path });
}

export async function intakeWrite(folder, path, data) {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  return call('intake_write', { folder, path, bytes: Array.from(new Uint8Array(buffer)) });
}

/** File something from the inbox. Idempotent, and never overwrites. */
export function intakeMove(folder, from, to) {
  return call('intake_move', { folder, from, to });
}

export function intakeDelete(folder, path) {
  return call('intake_delete', { folder, path });
}

/** SHA-256 of a file, for deduping snapshots and identifying an archived one. */
export function intakeHash(folder, path) {
  return call('intake_hash', { folder, path });
}

/* ── Window ────────────────────────────────────────────────────────────── */

/**
 * Put the plan and the pen in the window title, so the state reads from the
 * taskbar without bringing the window forward. Best effort: a failure here is
 * cosmetic and must never interrupt a save.
 */
export function setWindowTitle(title) {
  return call('set_window_title', { title }).catch(() => {});
}
