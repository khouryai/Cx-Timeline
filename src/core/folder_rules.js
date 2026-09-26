/**
 * The shared folder's rules, with nothing attached: names, digests, and whose
 * turn the pen is.
 *
 * They lived inside `core/filestore.js` among the I/O, the timers and the
 * handle store, which meant the only way to test them was a browser with a fake
 * folder. They are pure, so they are here — a leaf — and `tools/test_folder_rules.js`
 * checks them in Node. `src-tauri/src/plan.rs` makes the same readings in Rust
 * (`is_lock_name`, `pen_holder`, `is_conflict_copy`); the two must agree, or the
 * desktop and the browser would disagree about who is editing.
 *
 * Imports: nothing.
 */

/** A claim not restated for this long belongs to a session that has gone. */
export const STALE_MS = 240000;

export function basename(path) {
  const parts = String(path).split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || String(path);
}

export function lockNameFor(name) {
  return `${String(name).replace(/\.json$/i, '')}.lock.json`;
}

/**
 * A lock file — including the litter a sync client makes of one.
 *
 * The lock is rewritten every heartbeat, and OneDrive cannot merge two edits of
 * the same file: it keeps both and appends the machine name, giving
 * `plan.lock-HRUSPITLT02820.json`, then `-2`, `-3`, … A plan open on two
 * machines for an afternoon mints a pile of them.
 *
 * They matter for two reasons. They are `.json` files sitting beside the plan,
 * so anything listing plans has to know they are not plans — and nothing ever
 * reads them, so they would otherwise stay in the folder for ever.
 *
 * The `[-_. (]` after `.lock` is deliberate: it matches every sync client's
 * naming without swallowing a plan legitimately called `lockheed.json`.
 */
export function isLockFile(name) {
  return /\.(?:lock|pen)(?:[-_. (][^\\/]*)?\.json$/i.test(String(name));
}

/** One session's claim on the pen: `<plan>.pen-<device>.json`. */
export function claimNameFor(plan, device) {
  const stem = String(plan).replace(/\.json$/i, '');
  return `${stem}.pen-${String(device).replace(/[^A-Za-z0-9_-]/g, '')}.json`;
}

/** True for any claim file belonging to this plan, whoever wrote it. */
export function isClaimFor(plan, name) {
  const stem = String(plan).replace(/\.json$/i, '').toLowerCase();
  const lower = String(name).toLowerCase();
  return lower.startsWith(`${stem}.pen-`) && lower.endsWith('.json');
}

/**
 * A lock file no session will ever read: a conflict copy rather than the lock
 * itself. Nothing in either build opens a name like this, whichever plan it
 * belongs to, so it is safe to delete without knowing whose it was — while a
 * real `<plan>.lock.json` is left alone, because someone may be holding it.
 */
export function isLockLitter(name) {
  const lower = String(name).toLowerCase();
  // Copies of the old single lock file only. A claim file is *not* litter: it
  // is somebody's turn, written by the one device allowed to write it, and it
  // is retired by age below rather than on sight.
  return /\.lock[-_. (][^\\/]*\.json$/.test(lower);
}

/**
 * A digest of the plan in `text`, or null if it is not a readable plan.
 *
 * Null is a real answer and the callers depend on it: a half-written file is
 * not a version to announce, not a conflict to refuse over, and not something
 * to overwrite the stamp with. It means "ask again next time".
 */
export function fingerprint(text) {
  if (typeof text !== 'string' || !text) return null;
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;
  delete doc.exported;
  return hash64(JSON.stringify(doc));
}

/**
 * Sixty-four bits of FNV-1a, in two lanes.
 *
 * Not a cryptographic digest and it does not need to be: the question is
 * whether a file we wrote is still the file on disk, and nobody is trying to
 * forge one. `crypto.subtle` would be the stronger answer and is asynchronous
 * and unavailable outside a secure context — the plan opens from `file://` with
 * no server, which is a shape of this application that has to keep working.
 */
export function hash64(text) {
  let a = 0x811c9dc5;
  let b = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ (c + i), 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function parseClaim(text) {
  if (!text) return null;
  try {
    const claim = JSON.parse(text);
    return claim && typeof claim === 'object' ? claim : null;
  } catch {
    return null; // truncated or mid-sync — it does not count this time round
  }
}

/**
 * Which claim holds the pen.
 *
 * The earliest one still beating, so opening a plan to read it can never take
 * the pen off whoever was already working. An explicit takeover outranks that —
 * it is the one case where somebody has said "I know that session is gone" —
 * and the latest takeover wins, so two of them still settle on one answer. The
 * device id breaks a tie that is otherwise exact, only so that both sides break
 * it the same way.
 */
export function penHolder(claims, now = Date.now()) {
  const live = claims.filter((claim) => !isStale(claim, now));
  if (!live.length) return null;

  return live.reduce((best, claim) => {
    const a = claim.takeover || 0;
    const b = best.takeover || 0;
    if (a !== b) return a > b ? claim : best;
    if ((claim.since || 0) !== (best.since || 0)) return (claim.since || 0) < (best.since || 0) ? claim : best;
    return String(claim.device || '') < String(best.device || '') ? claim : best;
  });
}

export function isStale(lock, now = Date.now()) {
  return !lock || !lock.beat || now - lock.beat > STALE_MS;
}

export function isConflictCopy(name) {
  const stem = String(name).replace(/\.[^.]*$/, '');
  const at = stem.lastIndexOf('-');
  if (at < 0) return false;
  const tail = stem.slice(at + 1);
  if (!tail) return false;
  if (/^\d{1,3}$/.test(tail)) return true;
  return tail.length >= 8 && /^[A-Z0-9]+$/.test(tail) && /\d/.test(tail);
}

