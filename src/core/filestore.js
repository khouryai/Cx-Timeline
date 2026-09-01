/**
 * The shared folder.
 *
 * This module owns "the plan is a file in a folder" for both builds. It is the
 * only place that knows the browser's File System Access API exists, and — via
 * `core/desktop.js` — the only place that knows the desktop shell exists.
 * Everything above it (storage, the panels, the status bar) is unaware of which.
 *
 * It is inert unless a folder is connected. With nothing connected
 * `isConnected()` returns false, nothing here is ever called, and CX Timeline
 * behaves exactly as it always has.
 *
 * What lives in a connected folder
 * --------------------------------
 *   <plan>.json         the project, in exactly the format Export → JSON writes
 *   <plan>.lock.json    who currently has the pen, and when they last touched it
 *   attachments/<id>    attachment bytes, one file each
 *
 * The format is deliberately unchanged: a folder full of these opens in the
 * importer, reads in a text editor, and is versioned by whatever the folder is
 * synced with. Nothing here is a proprietary container.
 *
 * Two backends, one set of rules
 * ------------------------------
 * The I/O layer near the top is the *only* place the two builds differ — a
 * directory handle in a browser, a path string on the desktop. Every rule that
 * matters (whose lock it is, when a lock is stale, when a save is refused) lives
 * below that line and runs identically in both, because two implementations of
 * those rules is how they drift apart. `tools/smoke_folder.js` exercises them
 * through both backends for that reason.
 *
 * On two people at once
 * --------------------
 * The lock file says who is editing, and the other person opens read-only. But
 * a synced folder is not a database: the lock takes as long to arrive as the
 * sync does, so two people opening within the same few seconds can both believe
 * they hold it. The lock is therefore *courtesy*, and the guard that actually
 * protects the work is `savePlan()` — a mismatch between the plan on disk and
 * the one we last saw refuses the write. You may be told to reload; you can
 * never silently overwrite someone.
 *
 * What that guard compares is the point. The file's size and modified time say
 * whether the *file* moved, which a sync client does routinely without any
 * human touching the plan; the digest below says whether the *document* moved,
 * which is the only thing worth refusing a save or interrupting somebody over.
 * See "What `changed` means" further down: everything noisy about working
 * alongside a colleague came from answering the first question and reporting it
 * as the second.
 *
 * Imports: events, desktop.
 */

import { emit, EV } from './events.js';
import * as desktop from './desktop.js';

/** How often a session restates its claim, in ms. */
const HEARTBEAT_MS = 30000;
/**
 * A claim older than this is treated as abandoned — a crash, or a closed lid.
 *
 * Four minutes, not the seventy-five seconds this started at, and the reason is
 * the folder rather than the people: OneDrive routinely takes a minute or more
 * to carry a small file between two machines, and a window narrower than the
 * sync latency makes each side see the other's claim *lapse* and come back. The
 * pen then bounces — read-only, editable, read-only — while nothing at all is
 * wrong. Eight heartbeats of margin costs a crashed session four minutes of
 * somebody else's patience, and `takeOver()` is there for anyone with less.
 */
const STALE_MS = 240000;
/**
 * A claim file this old is deleted rather than merely ignored.
 *
 * Far wider than staleness on purpose: ignoring a claim costs its owner
 * nothing, but deleting the file loses their place in the queue, and a laptop
 * that went to sleep for an hour should find its turn still there.
 */
const ABANDONED_CLAIM_MS = 6 * 3600000;
/**
 * How long our *own* device's claim may go unbeaten before it is our own ghost.
 *
 * Deliberately far shorter than `STALE_MS`, and the reason is whose file it is:
 * a colleague's claim reaches us through OneDrive and may be minutes behind,
 * but a claim written by this machine is read straight off this machine's disk,
 * so a beat that is two heartbeats old means that window is gone rather than
 * slow. Two live windows of one install then recognise each other — which is
 * the whole point — and a crashed one still hands the plan back in about a
 * minute rather than in four.
 */
const OWN_WINDOW_STALE_MS = HEARTBEAT_MS * 2 + 5000;
/**
 * An editor who has saved nothing for this long hands the pen back.
 *
 * Somebody who opened a plan before lunch should not hold it until they
 * remember to close the window. The pen is released and this session drops to
 * read-only, so a colleague can pick it up without having to ask.
 */
const IDLE_RELEASE_MS = 3600000;
/** How often we look for someone else's save landing in the folder. */
const POLL_MS = 12000;
/**
 * How many polls apart the claims are re-read.
 *
 * Settling the pen lists the folder and reads every claim in it, which is real
 * I/O against a synced drive; doing it every twelve seconds was most of this
 * module's traffic and bought nothing — a claim only matters within `STALE_MS`,
 * and that is now eight times this interval.
 */
const SETTLE_EVERY = 2;
/** Where a browser remembers its folder handle. Desktop uses its own settings. */
const DB_NAME = 'cx-timeline-folder';
const DB_STORE = 'handles';
const HANDLE_KEY = 'folder';

/* ── State ─────────────────────────────────────────────────────────────── */

/** A directory handle in a browser; a path string on the desktop. */
let folderRef = null;
/** What to call the folder in the interface. */
let folderName = '';
let planName = '';
/**
 * The plan as we last saw it: size, modified time *and* a digest of the
 * document itself — the write guard's evidence, and the answer to "has this
 * actually changed".
 */
let stamp = null;
/**
 * A newer version sitting in the folder, `{ hash, at }`, or null.
 *
 * Held rather than acted on: reloading under somebody mid-sentence is worse
 * than telling them and letting them choose.
 */
let behind = null;
/** The digest of the version we have already announced, so we say it once. */
let announced = '';
/** True while a save is in flight, so the poll cannot read a half-written file. */
let saving = false;
/**
 * Set when another window of *this* install is the one holding the pen.
 *
 * Two tabs on one machine share a claim file — it is keyed on the device — so
 * each read back a claim it recognised as its own and both concluded they were
 * editing. They then took turns being refused by the write guard, which is
 * exactly the stream of alerts this module is supposed to prevent. The second
 * window now defers instead, and stops writing the claim so the first window's
 * statement of it stands.
 */
let deferring = false;
/** 'editor' when we hold the lock, 'viewer' when someone else does. */
let role = null;
/** Who holds the lock, when it is not us. */
let holder = '';
/** This window's identity — distinguishes two windows of the same install. */
const sessionId = `s_${Math.random().toString(36).slice(2, 10)}`;
let displayName = '';
let deviceIdCache = '';
/** When this session last wrote the plan; drives the idle release above. */
let lastSaveAt = 0;
let heartbeatTimer = null;
let pollTimer = null;

/* ══════════════════════════════════════════════════════════════════════════
   The I/O layer — the only place the two builds differ
   ═══════════════════════════════════════════════════════════════════════ */

const onDesktop = () => desktop.isAvailable();

/** True when this build can open a folder at all. */
export function isSupported() {
  if (onDesktop()) return true;
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** Ask for a folder. Resolves to `{ ref, name }`, or null when cancelled. */
async function ioPickFolder() {
  if (onDesktop()) {
    const path = await desktop.pickFolder();
    if (!path) return null;
    return { ref: path, name: basename(path) };
  }
  const handle = await window.showDirectoryPicker({ id: 'cx-timeline-plans', mode: 'readwrite' });
  if (!handle) return null;
  if (!(await ensureWebPermission(handle))) throw new Error('Permission to edit that folder was declined.');
  return { ref: handle, name: handle.name };
}

/** The folder this device used last, or null. `prompt` allows a permission ask. */
async function ioRecall({ prompt = false } = {}) {
  if (onDesktop()) {
    const settings = adoptSettings(await desktop.readSettings());
    if (!settings || !settings.folder) return null;
    return { ref: settings.folder, name: basename(settings.folder), plan: settings.plan || '' };
  }
  const record = await recallHandle();
  if (!record || !record.handle) return null;
  const granted = prompt ? await ensureWebPermission(record.handle) : await queryWebPermission(record.handle);
  if (!granted) return null;
  return { ref: record.handle, name: record.handle.name, plan: record.plan || '' };
}

async function ioRemember(ref, plan) {
  if (onDesktop()) {
    await desktop.writeSettings({ folder: ref, plan, displayName });
    return;
  }
  await rememberHandle(ref, plan);
}

async function ioForget() {
  if (onDesktop()) {
    await desktop.writeSettings({ folder: '', plan: '', displayName }).catch(() => {});
    return;
  }
  await forgetHandle();
}

/**
 * `[{ name, size, modified }]`, newest first. Lock files are not plans.
 *
 * The desktop list is filtered here as well as in Rust: the shell is installed
 * and updates on its own schedule, while this file arrives with every deploy,
 * so this is the copy that reaches a machine today.
 */
async function ioListPlans(ref) {
  if (onDesktop()) return (await desktop.listPlans(ref)).filter((entry) => !isLockFile(entry.name));

  const out = [];
  for await (const [name, handle] of ref.entries()) {
    if (handle.kind !== 'file') continue;
    const lower = name.toLowerCase();
    if (!lower.endsWith('.json') || isLockFile(lower)) continue;
    let size = 0;
    let modified = 0;
    try {
      const file = await handle.getFile();
      size = file.size;
      modified = file.lastModified;
    } catch {
      /* listed but unreadable — still worth showing */
    }
    out.push({ name, size, modified });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/** `{ text, stamp }` */
async function ioReadPlan(ref, name) {
  if (onDesktop()) {
    const read = await desktop.readPlan(ref, name);
    return { text: read.text, stamp: read.stamp };
  }
  const handle = await ref.getFileHandle(name);
  const file = await handle.getFile();
  return { text: await file.text(), stamp: { size: file.size, modified: file.lastModified } };
}

/**
 * Size and modified time, without reading the file.
 *
 * The poll asks this every twelve seconds and reads the plan only when the
 * answer has moved, which on a folder of any size is the difference between
 * watching it and dragging it. Null when the file cannot be stat'd at all —
 * absent, or mid-sync — which the caller treats as "ask again next time".
 *
 * The desktop falls back to a full read if the shell is old enough not to have
 * the stat command: slower, never wrong.
 */
async function ioStatPlan(ref, name) {
  try {
    if (onDesktop()) {
      try {
        return await desktop.intakeStat(ref, name);
      } catch {
        return (await desktop.readPlan(ref, name)).stamp;
      }
    }
    const file = await (await ref.getFileHandle(name)).getFile();
    return { size: file.size, modified: file.lastModified };
  } catch {
    return null;
  }
}

/**
 * Write a plan, refusing when it moved since `expected`.
 *
 * Throws an error carrying `kind: 'conflict'` in that case — the same shape from
 * both backends, so the caller never has to know which one answered. On the
 * desktop the comparison and the write happen inside one call, and the write is
 * atomic; in a browser they are two calls and a truncating stream, which is the
 * best the platform offers.
 */
async function ioWritePlan(ref, name, text, expected) {
  if (onDesktop()) return desktop.writePlan(ref, name, text, expected);

  const handle = await ref.getFileHandle(name, { create: true });
  if (expected) {
    const current = await handle.getFile();
    if (current.size !== expected.size || current.lastModified !== expected.modified) {
      const err = new Error('this plan changed on disk since you opened it, so the save was refused');
      err.kind = 'conflict';
      err.current = { size: current.size, modified: current.lastModified };
      err.expected = expected;
      throw err;
    }
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  const after = await handle.getFile();
  return { size: after.size, modified: after.lastModified };
}

async function ioReadLock(ref, name) {
  if (onDesktop()) return desktop.readLockText(ref, name);
  try {
    const handle = await ref.getFileHandle(lockNameFor(name));
    return await (await handle.getFile()).text();
  } catch {
    return null; // absent, unreadable or mid-sync — treat as free
  }
}

async function ioWriteLock(ref, name, text) {
  if (onDesktop()) return desktop.writeLockText(ref, name, text);
  const handle = await ref.getFileHandle(lockNameFor(name), { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function ioRemoveLock(ref, name) {
  if (onDesktop()) return desktop.removeLock(ref, name);
  await ref.removeEntry(lockNameFor(name));
}

/* ── Claims ────────────────────────────────────────────────────────────────
   One file per device, and the device that owns it is the only thing that ever
   writes it. That is the whole point: two machines sharing one lock file gave a
   sync client two versions to reconcile, and it cannot merge — so each machine
   went on reading back its own copy and both believed they held the pen. */

/** Every claim on this plan, as `{ name, text }`. */
async function ioReadClaims(ref, plan) {
  if (onDesktop()) return desktop.readClaims(ref, plan).catch(() => []);

  const out = [];
  for await (const [name, handle] of ref.entries()) {
    if (handle.kind !== 'file' || !isClaimFor(plan, name)) continue;
    try {
      out.push({ name, text: await (await handle.getFile()).text() });
    } catch {
      /* mid-sync or unreadable — it simply does not count this time round */
    }
  }
  return out;
}

/** Delete one claim file by name. Used to retire claims that stopped beating. */
async function ioRemoveNamed(ref, name) {
  if (onDesktop()) return desktop.removeNamed(ref, name).catch(() => false);
  try {
    await ref.removeEntry(name);
    return true;
  } catch {
    return false;
  }
}

async function ioWriteClaim(ref, plan, device, text) {
  if (onDesktop()) return desktop.writeClaim(ref, plan, device, text);
  const handle = await ref.getFileHandle(claimNameFor(plan, device), { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function ioRemoveClaim(ref, plan, device) {
  if (onDesktop()) return desktop.removeClaim(ref, plan, device).catch(() => false);
  try {
    await ref.removeEntry(claimNameFor(plan, device));
  } catch {
    /* already gone */
  }
}

/**
 * Delete the conflict copies a sync client has made of the lock files.
 *
 * On the desktop this needs the shell, which only gains the command when the
 * installer is rebuilt — an older shell simply sweeps nothing, and the listing
 * filter above still keeps the litter out of sight until it catches up.
 */
async function ioSweepLocks(ref) {
  if (onDesktop()) return desktop.sweepLocks(ref).catch(() => 0);

  let removed = 0;
  for await (const [name, handle] of ref.entries()) {
    if (handle.kind !== 'file' || !isLockLitter(name)) continue;
    try {
      await ref.removeEntry(name);
      removed++;
    } catch {
      /* someone else got there first, or the folder is read-only */
    }
  }
  return removed;
}

async function ioPutBlob(ref, id, file) {
  if (onDesktop()) return desktop.writeAttachment(ref, id, file);
  const dir = await ref.getDirectoryHandle('attachments', { create: true });
  const handle = await dir.getFileHandle(id, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
  return { id, name: file.name, type: file.type, size: file.size };
}

async function ioGetBlob(ref, id) {
  if (onDesktop()) return desktop.readAttachment(ref, id).catch(() => null);
  try {
    const dir = await ref.getDirectoryHandle('attachments');
    const file = await (await dir.getFileHandle(id)).getFile();
    return { id, blob: file, name: file.name || id, type: file.type, size: file.size };
  } catch {
    return null;
  }
}

async function ioDeleteBlob(ref, id) {
  if (onDesktop()) return desktop.deleteAttachment(ref, id).catch(() => false);
  try {
    const dir = await ref.getDirectoryHandle('attachments');
    await dir.removeEntry(id);
  } catch {
    /* already gone */
  }
}

async function ioBlobUsage(ref) {
  if (onDesktop()) return desktop.attachmentUsage(ref).catch(() => ({ count: 0, bytes: 0 }));
  let count = 0;
  let total = 0;
  try {
    const dir = await ref.getDirectoryHandle('attachments');
    for await (const [, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue;
      count++;
      total += (await handle.getFile()).size;
    }
  } catch {
    /* no attachments folder yet, or a partial answer */
  }
  return { count, bytes: total };
}

/**
 * Take on the identity the shell keeps for this machine.
 *
 * There must be exactly one device id per machine, and on the desktop it is the
 * shell's: `settings.json` mints it, and `startup_lock_check` compares against
 * it before any window exists. Letting the browser side mint a second one in
 * localStorage would recreate, on the desktop, the precise bug that made the web
 * build lock you out of your own plan — your last lock would look like a
 * stranger's, and you would wait out a staleness timeout to edit your own file.
 *
 * Called from every path that reads the settings, so the identity is in hand
 * before any lock is ever compared. The display name comes along for the same
 * reason: it lives beside the folder rather than in browser storage, so clearing
 * the webview's data does not turn a colleague's name back into "Someone".
 */
function adoptSettings(settings) {
  if (settings && settings.device) deviceIdCache = settings.device;
  if (settings && settings.display_name && !displayName) displayName = settings.display_name;
  return settings;
}

function basename(path) {
  const parts = String(path).split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || String(path);
}

function lockNameFor(name) {
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
function isLockFile(name) {
  return /\.(?:lock|pen)(?:[-_. (][^\\/]*)?\.json$/i.test(String(name));
}

/** One session's claim on the pen: `<plan>.pen-<device>.json`. */
function claimNameFor(plan, device) {
  const stem = String(plan).replace(/\.json$/i, '');
  return `${stem}.pen-${String(device).replace(/[^A-Za-z0-9_-]/g, '')}.json`;
}

/** True for any claim file belonging to this plan, whoever wrote it. */
function isClaimFor(plan, name) {
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
function isLockLitter(name) {
  const lower = String(name).toLowerCase();
  // Copies of the old single lock file only. A claim file is *not* litter: it
  // is somebody's turn, written by the one device allowed to write it, and it
  // is retired by age below rather than on sight.
  return /\.lock[-_. (][^\\/]*\.json$/.test(lower);
}

/* ── The browser's handle store ────────────────────────────────────────── */

/**
 * Directory handles survive a reload, but only through IndexedDB — they cannot
 * be serialised. This is a database of its own rather than a table in the main
 * one, so `core/storage.js` can import this module without the reverse.
 *
 * The desktop build needs none of this: it remembers a path.
 */
function openHandleDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rememberHandle(handle, plan) {
  try {
    const db = await openHandleDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({ handle, plan }, HANDLE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[cx-timeline] could not remember the folder:', err.message);
  }
}

async function recallHandle() {
  try {
    const db = await openHandleDb();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE);
      const req = tx.objectStore(DB_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return record;
  } catch {
    return null;
  }
}

async function forgetHandle() {
  try {
    const db = await openHandleDb();
    await new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(HANDLE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
    db.close();
  } catch {
    /* nothing to forget */
  }
}

async function queryWebPermission(handle) {
  try {
    return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

async function ensureWebPermission(handle) {
  if (await queryWebPermission(handle)) return true;
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Identity
   ═══════════════════════════════════════════════════════════════════════ */

/** True when a plan in a connected folder is the live document. */
export function isConnected() {
  return !!(folderRef && planName);
}

/**
 * True when a folder has been granted at all, whether or not a plan is open.
 *
 * The intake folders live beside the plan but do not need one, and the
 * difference matters to the message somebody reads: "no workbook in
 * lookahead/" and "this browser was never given the folder" are the same
 * outcome and completely different problems.
 */
export function hasFolder() {
  return !!folderRef;
}

/** True when someone else holds the pen, so this session must not write. */
export function isViewer() {
  return isConnected() && role === 'viewer';
}

/** Everything the interface needs to describe the current state. */
export function state() {
  return {
    supported: isSupported(),
    desktop: onDesktop(),
    connected: isConnected(),
    folder: folderName,
    plan: planName,
    role: role || null,
    holder,
    savedAt: stamp ? stamp.modified : null,
    /* A newer version is sitting in the folder. Said once out loud and then
       kept here, so the status bar can go on showing it without anybody being
       asked twice. */
    behind: !!behind,
    behindAt: behind ? behind.at : null,
  };
}

/**
 * A stable identity for this install.
 *
 * The window id is not enough. It is regenerated on every launch, so closing the
 * application and reopening it made your own abandoned lock look like a
 * stranger's — you were locked out of your own plan until it went stale. A
 * device id persists, so a returning session recognises its own lock and takes
 * it straight back.
 */
function deviceId() {
  if (deviceIdCache) return deviceIdCache;
  let id = readPref('device');
  if (!id) {
    id = `d_${Math.random().toString(36).slice(2, 10)}`;
    writePref('device', id);
  }
  deviceIdCache = id;
  return id;
}

/** Small device-scoped values. */
function readPref(key) {
  try {
    return localStorage.getItem(`cxtl.folder.${key}`) || '';
  } catch {
    return '';
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(`cxtl.folder.${key}`, String(value || ''));
  } catch {
    /* best effort */
  }
}

/** The name a colleague sees in the lock. */
export function setDisplayName(name) {
  displayName = String(name || '').trim();
  writePref('name', displayName);
  if (onDesktop() && folderRef) ioRemember(folderRef, planName).catch(() => {});
}

export function getDisplayName() {
  return displayName || readPref('name') || 'Someone';
}

/** The folder remembered from last time, so the UI can offer it by name. */
export async function storedFolder() {
  if (onDesktop()) {
    const settings = adoptSettings(await desktop.readSettings().catch(() => null));
    if (!settings || !settings.folder) return null;
    return { folder: basename(settings.folder), plan: settings.plan || '' };
  }
  const record = await recallHandle();
  if (!record || !record.handle) return null;
  return { folder: record.handle.name, plan: record.plan || '' };
}

/**
 * Who has the pen, as the shell saw it before the window opened.
 *
 * Desktop only, and the reason it exists: the interface can announce that a
 * colleague is in the plan up front, instead of drawing a canvas and then
 * walking it back. Resolves to null in a browser, which has no such moment.
 */
export async function startupPen() {
  if (!onDesktop()) return null;
  try {
    // Take on the shell's device id first, so everything downstream compares
    // locks against the identity the shell just used to answer this question.
    adoptSettings(await desktop.readSettings().catch(() => null));
    return await desktop.startupLockCheck();
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Connecting
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Ask for a folder and remember it. Must be called from a user gesture in a
 * browser — no engine will open a picker nobody clicked for.
 *
 * Returns the plans found inside so the caller can choose, rather than guessing
 * on the user's behalf when a folder holds several.
 */
export async function chooseFolder() {
  if (!isSupported()) throw new Error('This browser cannot open a folder. Use Edge or Chrome.');
  const picked = await ioPickFolder();
  if (!picked) return null;

  folderRef = picked.ref;
  folderName = picked.name;
  planName = '';
  await ioRemember(folderRef, '');
  emitState();
  return { folder: folderName, plans: await listPlans() };
}

/**
 * Reconnect to the remembered folder without prompting.
 *
 * On the desktop this simply works — the folder is a path and needs no grant,
 * which is what lets the application open your plan on launch. In a browser it
 * resolves to null when the grant has lapsed, so the caller can offer a
 * one-click reconnect rather than throwing the user into a dialog on boot.
 */
export async function reconnectSilently() {
  if (!isSupported()) return null;
  const recalled = await ioRecall({ prompt: false });
  if (!recalled) return null;

  folderRef = recalled.ref;
  folderName = recalled.name;
  planName = '';
  emitState();
  return { folder: folderName, plans: await listPlans(), lastPlan: recalled.plan };
}

/** Reconnect from a user gesture, prompting for permission if it has lapsed. */
export async function reconnectWithPrompt() {
  if (!isSupported()) return null;
  const recalled = await ioRecall({ prompt: true });
  if (!recalled) return null;

  folderRef = recalled.ref;
  folderName = recalled.name;
  planName = '';
  emitState();
  return { folder: folderName, plans: await listPlans(), lastPlan: recalled.plan };
}

/** Stop using the folder: release the lock and forget where it was. */
export async function disconnect() {
  await sweepLockLitter();
  await releaseLock();
  stopTimers();
  folderRef = null;
  folderName = '';
  planName = '';
  stamp = null;
  behind = null;
  announced = '';
  deferring = false;
  role = null;
  holder = '';
  await ioForget();
  emitState();
}

/* ══════════════════════════════════════════════════════════════════════════
   Plans
   ═══════════════════════════════════════════════════════════════════════ */

/** Every plan in the connected folder, newest first. */
export async function listPlans() {
  if (!folderRef) return [];
  try {
    return await ioListPlans(folderRef);
  } catch (err) {
    console.warn('[cx-timeline] could not read the folder:', err.message);
    return [];
  }
}

/**
 * Open a plan and take the pen if it is free.
 *
 * Returns `{ doc, role, holder }`. A `viewer` role is not a failure — it means a
 * colleague is in there, and the document is still returned so it can be read.
 */
export async function openPlan(name) {
  if (!folderRef) throw new Error('No folder is connected.');
  const read = await ioReadPlan(folderRef, name);

  let doc;
  try {
    doc = JSON.parse(read.text);
  } catch (err) {
    throw new Error(`${name} is not a valid project file: ${err.message}`);
  }

  planName = name;
  stamp = { ...read.stamp, hash: fingerprint(read.text) };
  behind = null;
  announced = '';
  saving = false;
  deferring = false;
  await ioRemember(folderRef, name);

  // State the claim first, then read every claim including our own and see who
  // it belongs to. Claiming before reading is deliberate: two sessions opening
  // together both end up in the list, so both settle on the same holder instead
  // of each seeing an empty folder and taking the pen.
  claimedAt = Date.now();
  takeoverAt = 0;
  role = null;
  holder = '';
  /* Ask before writing. The claim file is keyed on the device, so writing ours
     is precisely what would erase another window's statement of it — and then
     neither window could see the other at all. */
  deferring = (await readClaims()).some(otherWindow);
  await writeClaim();
  await settlePen();
  await stampLegacyLock();

  lastSaveAt = Date.now();
  startTimers();
  emitState();
  sweepLockLitter();
  return { doc, role, holder };
}

/** Write a new plan into the folder and open it. */
export async function createPlan(name, doc) {
  if (!folderRef) throw new Error('No folder is connected.');
  const safe = name.toLowerCase().endsWith('.json') ? name : `${name}.json`;

  const fresh = serialise(doc);
  stamp = { ...(await ioWritePlan(folderRef, safe, fresh, null)), hash: fingerprint(fresh) };
  behind = null;
  announced = '';
  planName = safe;
  role = 'editor';
  holder = '';
  await ioRemember(folderRef, safe);
  lastSaveAt = Date.now();
  claimedAt = Date.now();
  takeoverAt = 0;
  await writeClaim();
  await stampLegacyLock();
  startTimers();
  emitState();
  sweepLockLitter();
  return safe;
}

/* ══════════════════════════════════════════════════════════════════════════
   What "changed" means

   Size and modified time are how the filesystem answers "did this file move",
   and for a long time this module treated that as the same question as "did the
   plan change". On a synced folder it is not, and the difference is most of
   what made two people working together unpleasant:

     · OneDrive rewrites a file it has just uploaded or brought down. Same
       bytes, new modified time — and the author of the save was told a
       colleague had changed their plan underneath them.
     · The same touch made the *next* save fail the write guard, so a legitimate
       save was refused over a file nobody had edited.
     · A file caught mid-sync is short and unparseable. Metadata says it moved,
       so it was announced as a version to catch up with; it was not a version
       at all.

   So the stamp carries a digest of the *document* as well. The metadata check
   stays — it is free, and it is what decides whether to read the file at all —
   but nothing is announced, and no save is refused, until the content itself
   turns out to differ. The `exported` block is left out of the digest because
   it carries the time of the save: including it would make every re-save of an
   identical plan look like a change, which is the very thing this is for.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A digest of the plan in `text`, or null if it is not a readable plan.
 *
 * Null is a real answer and the callers depend on it: a half-written file is
 * not a version to announce, not a conflict to refuse over, and not something
 * to overwrite the stamp with. It means "ask again next time".
 */
function fingerprint(text) {
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
function hash64(text) {
  let a = 0x811c9dc5;
  let b = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ (c + i), 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** Just the two fields the write guard compares — the backends expect no more. */
function metaOf(st) {
  return st ? { size: st.size, modified: st.modified } : null;
}

/**
 * Write the document back, but never over someone else's work.
 *
 * The guard is the whole safety property of this mode: the file's size and
 * modified time are checked against what we last saw, and a mismatch refuses the
 * write. The caller is told to reload rather than being allowed to clobber.
 *
 * A refusal is now checked before it is believed. A sync client touching the
 * file moves its metadata without changing a word of the plan, and refusing
 * that save protected nothing while making the application look broken to the
 * only person editing.
 */
export async function savePlan(doc) {
  if (!isConnected()) return { ok: false, reason: 'not-connected' };
  if (role === 'viewer') return { ok: false, reason: 'read-only' };

  saving = true;
  try {
    return await writeGuarded(serialise(doc));
  } finally {
    saving = false;
  }
}

async function writeGuarded(text, retried = false) {
  try {
    const written = await ioWritePlan(folderRef, planName, text, metaOf(stamp));
    stamp = { ...written, hash: fingerprint(text) };
    // Whatever we were behind, we are not behind it now: this document is the
    // one on disk, and it is ours.
    behind = null;
    announced = '';
    lastSaveAt = Date.now();
    return { ok: true, at: stamp.modified };
  } catch (err) {
    if (err && err.kind === 'conflict') {
      // The file moved. Whether the *plan* moved is a different question, and
      // it is the one worth refusing over.
      const verdict = await reconcile();
      if (verdict === 'same' && !retried) return writeGuarded(text, true);
      // The caller raises its own notice about this refusal, so the poll must
      // not repeat it a few seconds later in different words.
      if (behind) announced = behind.hash;
      emit(EV.FILE_CONFLICT, { plan: planName });
      return { ok: false, reason: 'conflict', conflict: true };
    }
    // A lapsed permission grant is the common browser failure, and it reads as
    // a generic error unless we say so.
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    return { ok: false, reason: denied ? 'permission' : 'error', error: err };
  }
}

/**
 * What the file on disk actually is, compared with the one we last saw.
 *
 *   'same'     the metadata moved and the document did not — a sync client
 *              rewriting our own bytes. The new metadata is adopted so the
 *              write guard stops refusing over it.
 *   'newer'    a genuine version we have not got. Recorded in `behind`, and
 *              *not* announced — saying so is the caller's decision, which is
 *              what stops a refused save and the next poll from reporting the
 *              same fact twice.
 *   'unknown'  unreadable — mid-sync, or gone. Not evidence of anything, so
 *              nothing is adopted and nothing is claimed.
 */
async function reconcile() {
  if (!stamp) return 'unknown';
  let read;
  try {
    read = await ioReadPlan(folderRef, planName);
  } catch {
    return 'unknown';
  }
  const hash = fingerprint(read.text);
  if (!hash) return 'unknown';

  if (hash === stamp.hash) {
    stamp = { ...read.stamp, hash };
    if (behind) {
      behind = null;
      emitState();
    }
    return 'same';
  }

  behind = { hash, at: read.stamp.modified };
  emitState();
  return 'newer';
}

/** Re-read the plan from the folder — the "they saved, catch up" path. */
export async function refreshFromDisk() {
  if (!isConnected()) return null;
  const read = await ioReadPlan(folderRef, planName);
  try {
    const doc = JSON.parse(read.text);
    stamp = { ...read.stamp, hash: fingerprint(read.text) };
    behind = null;
    announced = '';
    emitState();
    return doc;
  } catch (err) {
    throw new Error(`${planName} could not be read: ${err.message}`);
  }
}

/** The document as it is written to disk: the Export → JSON format, verbatim. */
function serialise(doc) {
  return JSON.stringify(
    {
      ...doc,
      exported: {
        at: new Date().toISOString(),
        application: 'CX Timeline',
        note: 'Attachment file contents live in the attachments folder beside this file.',
      },
    },
    null,
    2
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The pen

   Every rule here runs identically in both builds. The I/O layer above moves
   the bytes; this decides what they mean.

   Each session states its own claim, in its own file, and nobody else ever
   writes that file. Who holds the pen is then a *reading* — the earliest live
   claim wins — rather than a race to own one shared file.

   That distinction is the whole design. With one `<plan>.lock.json` rewritten
   by every holder on every heartbeat, two machines on a synced folder handed
   the sync client two versions of one file several times a minute. It cannot
   merge them: it keeps one and renames the other after the machine that lost.
   So each machine mostly read back *its own* stamp, each concluded the pen was
   theirs, and both edited — for as long as the plan was open. Files nobody
   writes together cannot conflict, so the claims always arrive intact and both
   sides settle on the same answer within a poll of the sync landing.
   ═══════════════════════════════════════════════════════════════════════ */

/** When this session first claimed the pen, and when it last said so. */
let claimedAt = 0;
/** Set when the user has explicitly taken the pen from someone else. */
let takeoverAt = 0;

/**
 * Every live-looking claim on this plan, ours included.
 *
 * A session that has not been updated yet still writes the old single lock
 * file, so that is read as a claim too — a colleague running yesterday's copy
 * is still a colleague, and must still be respected.
 */
async function readClaims() {
  if (!folderRef || !planName) return [];

  const claims = [];
  for (const { name, text } of await ioReadClaims(folderRef, planName)) {
    const claim = parseClaim(text);
    if (claim) claims.push({ ...claim, file: name });
  }

  const legacy = parseClaim(await ioReadLock(folderRef, planName));
  // Ours is already in the list under its own name; a second copy of it would
  // only compete with itself.
  if (legacy && !isOurs(legacy)) claims.push({ ...legacy, legacy: true });

  return claims;
}

function parseClaim(text) {
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
function penHolder(claims) {
  const live = claims.filter((claim) => !isStale(claim));
  if (!live.length) return null;

  return live.reduce((best, claim) => {
    const a = claim.takeover || 0;
    const b = best.takeover || 0;
    if (a !== b) return a > b ? claim : best;
    if ((claim.since || 0) !== (best.since || 0)) return (claim.since || 0) < (best.since || 0) ? claim : best;
    return String(claim.device || '') < String(best.device || '') ? claim : best;
  });
}

/**
 * State our claim, or restate it.
 *
 * Written on open and on every heartbeat — by readers as well as editors, which
 * is what lets the pen pass to whoever has been waiting longest the moment the
 * holder leaves, with no handover and nothing to negotiate.
 */
async function writeClaim() {
  if (!folderRef || !planName) return;
  /* The claim file is keyed on the device, so writing ours would overwrite the
     window that is actually holding it — and the two would then take turns
     claiming to be each other. One window per install states it; this one is
     already represented by that statement. */
  if (deferring) return;
  if (!claimedAt) claimedAt = Date.now();
  try {
    await ioWriteClaim(
      folderRef,
      planName,
      deviceId(),
      JSON.stringify(
        {
          id: sessionId,
          device: deviceId(),
          holder: getDisplayName(),
          since: claimedAt,
          beat: Date.now(),
          ...(takeoverAt ? { takeover: takeoverAt } : {}),
        },
        null,
        2
      )
    );
  } catch (err) {
    // Failing to claim is not fatal: the write guard still protects the work,
    // so the session continues without the courtesy.
    console.warn('[cx-timeline] could not write the claim file:', err.message);
  }
}

/**
 * Read the folder and settle who is holding the pen.
 *
 * The single place the role is decided, so the answer cannot differ between
 * opening a plan, polling and taking over. Announces itself only on a change.
 */
async function settlePen() {
  const claims = await readClaims();
  const winner = penHolder(claims);

  /* Is another window of this install already standing in for this machine?
     That is a question about our own claim file rather than about who won: it
     is keyed on the device, so both windows write to one file, and whichever
     wrote last would otherwise read it back, recognise the device as its own
     and conclude it was the editor. Both did, all afternoon, taking turns
     being refused by the write guard. */
  deferring = claims.some(otherWindow);

  const nextRole = (!winner || ours(winner)) && !deferring ? 'editor' : 'viewer';
  const nextHolder = nextRole === 'editor'
    ? ''
    : !winner || ours(winner)
      ? 'another window of yours'
      : winner.holder || 'Someone';

  if (nextRole === role && nextHolder === holder) return { role, holder, changed: false };

  // Handing the pen over is not this module's decision to announce: it flushes
  // through the same state event everything else uses.
  role = nextRole;
  holder = nextHolder;
  emitState();
  return { role, holder, changed: true };
}

/**
 * The old single lock file, kept stamped while we hold the pen.
 *
 * Purely for colleagues still running a copy from before claims existed: they
 * read this file and nothing else, so without it they would see a free plan and
 * start editing beside us. We never *rely* on it — a stale one is ignored — and
 * only the holder writes it, so there is no longer a crowd fighting over it.
 */
async function stampLegacyLock() {
  if (!folderRef || !planName || role !== 'editor') return;
  try {
    await ioWriteLock(
      folderRef,
      planName,
      JSON.stringify(
        { id: sessionId, device: deviceId(), holder: getDisplayName(), since: claimedAt || Date.now(), beat: Date.now() },
        null,
        2
      )
    );
  } catch {
    /* the claim is the real statement; this is a courtesy to old copies */
  }
}

/**
 * Take the sync client's litter back out of the folder.
 *
 * The lock is meant to be temporary — one file, deleted when the last session
 * leaves. What survives it are the conflict copies, which nothing reads and
 * nothing would ever remove. So the session that holds the pen clears them:
 * when a plan is opened, every few minutes while it is held, and on the way
 * out. Only the holder, because a reader has no business writing to the folder
 * at all; and never the live `<plan>.lock.json` of any plan, which may be
 * somebody's.
 *
 * Best effort throughout. Failing to tidy up is not a reason to fail anything
 * the user actually asked for.
 */
async function sweepLockLitter() {
  if (!folderRef || role !== 'editor') return 0;
  let removed = 0;
  try {
    removed = await ioSweepLocks(folderRef);
  } catch (err) {
    console.warn('[cx-timeline] could not clear old lock files:', err.message);
  }

  // A session that crashed leaves its claim behind. It stops counting after
  // STALE_MS — this is only about the file, so the margin is wide enough that
  // no laptop coming back from lunch has its turn deleted out from under it.
  try {
    for (const claim of await readClaims()) {
      if (!claim.file || isOurs(claim)) continue;
      if (Date.now() - (claim.beat || 0) < ABANDONED_CLAIM_MS) continue;
      if (await ioRemoveNamed(folderRef, claim.file)) removed++;
    }
  } catch {
    /* tidying is never worth failing a session over */
  }
  return removed;
}

/**
 * Withdraw this session's claim.
 *
 * Only ever our own file, so leaving can never disturb anyone else's turn —
 * and whoever has been waiting longest becomes the holder on their next poll,
 * without being handed anything.
 */
async function releaseLock() {
  if (!folderRef || !planName) return;
  claimedAt = 0;
  takeoverAt = 0;
  // While deferring, the claim on disk belongs to another window of this
  // install. Withdrawing "ours" would withdraw theirs.
  if (deferring) {
    deferring = false;
    return;
  }
  try {
    await ioRemoveClaim(folderRef, planName, deviceId());
    // The compatibility stamp is ours to clear only while it is ours.
    if (role === 'editor') {
      const legacy = parseClaim(await ioReadLock(folderRef, planName));
      if (!legacy || isOurs(legacy)) await ioRemoveLock(folderRef, planName);
    }
  } catch {
    /* the staleness timeout is the real release mechanism */
  }
}

/**
 * Is this claim ours to take?
 *
 * Same window is obviously ours. Same *machine* counts too, and deliberately:
 * it is either our own abandoned claim — the case that used to lock people out
 * of their own plan after a crash — or another window of the same install, and
 * the person sitting in front of both should not have to negotiate with
 * themselves about which machine may edit.
 *
 * Which of those two it is, is `otherWindow()`'s question, and it decides
 * something different: not whether this machine may edit, but which of its
 * windows does.
 */
function isOurs(lock) {
  if (!lock) return false;
  if (lock.id === sessionId) return true;
  return !!lock.device && lock.device === deviceId();
}

/** Kept for readability at the call site: "is the holder us". */
const ours = isOurs;

/**
 * A claim from this machine, written by a window that is still running.
 *
 * The beat is what tells the two apart, and it can be read strictly because the
 * file is ours: no sync carried it here, so a stale beat means gone rather than
 * delayed. `id` alone would not do — a claim we wrote ourselves a moment ago
 * carries our own id and must never make us defer to ourselves.
 */
function otherWindow(claim) {
  if (!claim || claim.id === sessionId) return false;
  if (!claim.device || claim.device !== deviceId()) return false;
  return Date.now() - (claim.beat || 0) <= OWN_WINDOW_STALE_MS;
}

function isStale(lock) {
  return !lock || !lock.beat || Date.now() - lock.beat > STALE_MS;
}

/**
 * Take the pen.
 *
 * This never refuses. It used to, whenever the existing lock looked live, which
 * left the one situation that matters most — "I know that lock is dead, let me
 * work" — with no way out. Refusing is also unnecessary: the write guard means
 * whoever loses the race is *told* to reload rather than silently overwritten.
 * Warning the user is `ui/commands.js`'s job; deciding for them is not this
 * module's.
 */
export async function takeOver() {
  if (!isConnected()) return false;
  // Stated in our own claim rather than by overwriting theirs: they find out by
  // reading, on their next poll, and drop to read-only the same way we would.
  takeoverAt = Date.now();
  lastSaveAt = Date.now();
  // Including from another window of this install: "take over" means it, and
  // deferring is a courtesy rather than a lock.
  deferring = false;
  await writeClaim();
  role = 'editor';
  holder = '';
  await stampLegacyLock();
  emitState();
  return true;
}

/**
 * Who holds the pen right now, for a caller about to offer a takeover.
 * `live` means someone else is actively restating their claim — the only case
 * worth a confirmation prompt.
 */
export async function lockStatus() {
  const winner = penHolder(await readClaims());
  if (!winner) return { live: false, mine: false, holder: '', idleMs: 0 };
  const mine = isOurs(winner);
  return {
    live: !mine,
    mine,
    holder: winner.holder || 'Someone',
    idleMs: winner.beat ? Date.now() - winner.beat : 0,
  };
}

/**
 * Hand the pen back without disconnecting: this session becomes a reader.
 * Used by the idle release, once the caller has flushed a final save.
 */
export async function yieldPen() {
  if (!isConnected() || role !== 'editor') return false;
  await releaseLock();
  role = 'viewer';
  holder = '';
  emitState();
  return true;
}

/**
 * Who holds the pen right now, re-read from the folder.
 *
 * Both directions come out of the same reading. A reader whose turn has come —
 * the holder closed the plan, or stopped beating — is promoted without asking
 * anyone; and an editor who turns out to be the *later* claim yields, which is
 * the case a synced folder makes routine: two people can open within one sync
 * window and neither sees the other for a minute.
 */
export async function checkLock() {
  if (!isConnected()) return null;
  const before = role;
  const settled = await settlePen();
  // Whoever holds it keeps the old lock file stamped, for colleagues still
  // running a copy from before claims existed.
  if (settled.role === 'editor' && before !== 'editor') await stampLegacyLock();
  return { role: settled.role, holder: settled.holder, stale: false };
}

/* ══════════════════════════════════════════════════════════════════════════
   Watching the folder
   ═══════════════════════════════════════════════════════════════════════ */

function startTimers() {
  stopTimers();
  heartbeatTimer = setInterval(() => {
    // Idle long enough that holding the pen is just in the way. Ask the
    // application to flush a save and hand it back — this module cannot save the
    // document itself, it only knows the file.
    if (role === 'editor' && lastSaveAt && Date.now() - lastSaveAt > IDLE_RELEASE_MS) {
      emit(EV.FILE_IDLE, { plan: planName, since: lastSaveAt });
      return;
    }
    // Readers restate their claim as well as editors: a claim that stopped
    // beating is a claim that has given up, and a reader waiting for its turn
    // has not. Nobody else writes this file, so it costs no one anything.
    writeClaim();
    stampLegacyLock();
  }, HEARTBEAT_MS);

  pollTimer = setInterval(() => { pollOnce(); }, POLL_MS);

  /* A window nobody is looking at does not need to know, and a stack of
     answers waiting for somebody who has come back from a meeting is exactly
     the noise this module is meant not to make. Look once on the way in
     instead. */
  if (typeof document !== 'undefined' && !visibilityBound) {
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pollOnce();
    });
  }
}

/**
 * One turn of watching the folder.
 *
 * Three things, in order of what they cost: settle the pen (a folder listing,
 * so not every turn), check the plan's metadata (one stat), and only if that
 * moved, read the file and ask whether the *document* is different.
 */
let polls = 0;
let visibilityBound = false;
async function pollOnce() {
  if (!isConnected()) return;
  // Mid-save, the file on disk is ours and may be half-written. Reading it here
  // would compare our own work against itself and, in a browser, against a
  // truncated copy of it.
  if (saving) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  // A sync client can mint a conflict copy at any point during a session, so
  // one sweep at open is not enough — but they are litter, not a problem, so
  // this rides the poll every twenty-fifth turn (about five minutes) rather
  // than listing the folder every twelve seconds.
  polls++;
  if (polls % 25 === 0) sweepLockLitter();

  try {
    if (polls % SETTLE_EVERY === 0) await checkLock();
    if (!stamp) return;

    // The cheap question first: has the file moved at all? Almost every turn
    // ends here, which is what makes polling a synced folder every twelve
    // seconds reasonable.
    const now = await ioStatPlan(folderRef, planName);
    if (!now || (now.size === stamp.size && now.modified === stamp.modified)) return;

    // It moved. Whether the plan moved is what `reconcile()` answers — and it
    // leaves the stamp alone unless the answer is "not really", so the write
    // guard goes on refusing until the document has actually been reloaded.
    if ((await reconcile()) !== 'newer') return;

    // Once per version. Repeating it every twelve seconds is how a useful
    // sentence turns into something people click away without reading.
    if (announced === behind.hash) return;
    announced = behind.hash;
    emit(EV.FILE_EXTERNAL_CHANGE, { plan: planName, at: behind.at });
  } catch {
    /* the folder went away — the next save will report it properly */
  }
}

function stopTimers() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (pollTimer) clearInterval(pollTimer);
  heartbeatTimer = null;
  pollTimer = null;
}

/** Release the lock on the way out. Best effort — unload cannot await. */
export function handleUnload() {
  releaseLock();
  stopTimers();
}

function emitState() {
  emit(EV.FILE_STATE, state());
}

/* ══════════════════════════════════════════════════════════════════════════
   Attachments
   ═══════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
   The intake folders

   The look-ahead workbook and the SAR PDFs live in subfolders of the same
   folder as the plan, and arrive by hand rather than through the application.
   They belong here because this module owns the folder handle — nothing else
   should ever hold one — but they are otherwise unrelated to the plan: no pen,
   no write guard, no locking. Nobody edits these through CX Timeline; it reads
   them, and files what somebody dropped in.

   Both backends again: a path on the desktop, a directory handle in a browser.
   The desktop side checks every path component in Rust, because these names
   come off a dropped file rather than from the application.
   ═══════════════════════════════════════════════════════════════════════ */

/** Walk a relative path to its directory handle. `create` makes it on the way. */
async function webFolder(rel, { create = false } = {}) {
  let dir = folderRef;
  const parts = rel.split('/').filter(Boolean);
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

/**
 * What is in an intake folder.
 *
 * A conflict copy is reported rather than skipped: two versions of the
 * look-ahead means OneDrive could not merge somebody's edits, and quietly
 * ingesting one of them would snapshot the same week twice and manufacture a
 * change that never happened.
 */
export async function intakeList(rel) {
  if (!folderRef) return [];
  if (onDesktop()) return desktop.intakeList(folderRef, rel);

  try {
    const dir = await webFolder(rel);
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue;
      // Excel's sidecar while a workbook is open is never a file to read.
      if (name.startsWith('~$')) continue;
      const file = await handle.getFile();
      out.push({ name, size: file.size, modified: file.lastModified, conflict: isConflictCopy(name) });
    }
    return out.sort((a, b) => b.modified - a.modified);
  } catch {
    // A folder nobody has created yet is empty, not broken.
    return [];
  }
}

/**
 * A OneDrive conflict copy, for any extension — the same rule
 * `isLockFile()` applies to locks, widened to the intake folders.
 *
 * Conservative on purpose: it wants a machine-name or copy-number tail, so an
 * ordinary hyphenated name like `Four-Week Look-Ahead.xlsx` is not caught.
 * `plan.rs::is_conflict_copy` is the same rule in Rust, and the two have to
 * agree or the desktop and the browser would ingest different files.
 */
export function isConflictCopy(name) {
  const stem = String(name).replace(/\.[^.]*$/, '');
  const at = stem.lastIndexOf('-');
  if (at < 0) return false;
  const tail = stem.slice(at + 1);
  if (!tail) return false;
  if (/^\d{1,3}$/.test(tail)) return true;
  return tail.length >= 8 && /^[A-Z0-9]+$/.test(tail) && /\d/.test(tail);
}

/** Read an intake file as an ArrayBuffer. */
export async function intakeRead(rel) {
  if (!folderRef) throw new Error('No folder is connected.');
  if (onDesktop()) return desktop.intakeRead(folderRef, rel);
  const parts = rel.split('/');
  const name = parts.pop();
  const dir = await webFolder(parts.join('/'));
  const file = await (await dir.getFileHandle(name)).getFile();
  return file.arrayBuffer();
}

/**
 * Size and modified time, without reading it — what the watcher polls.
 *
 * On a synced folder the modified time is when OneDrive *delivered* the file,
 * not when somebody edited it. A snapshot therefore records this and its own
 * observation time as two separate facts, because for evidence the difference
 * between "changed at" and "seen at" matters.
 */
export async function intakeStat(rel) {
  if (!folderRef) throw new Error('No folder is connected.');
  if (onDesktop()) return desktop.intakeStat(folderRef, rel);
  const parts = rel.split('/');
  const name = parts.pop();
  const dir = await webFolder(parts.join('/'));
  const file = await (await dir.getFileHandle(name)).getFile();
  return { size: file.size, modified: file.lastModified };
}

/** Write bytes into an intake folder, creating it if needed. */
export async function intakeWrite(rel, data) {
  if (!folderRef) throw new Error('No folder is connected.');
  if (onDesktop()) return desktop.intakeWrite(folderRef, rel, data);
  const parts = rel.split('/');
  const name = parts.pop();
  const dir = await webFolder(parts.join('/'), { create: true });
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
  const file = await handle.getFile();
  return { size: file.size, modified: file.lastModified };
}

/**
 * File something out of the inbox.
 *
 * Copy, verify, then delete — never a bare rename. An interruption then leaves
 * the file in the inbox to be re-filed, which is a duplicate rather than a
 * loss. Idempotent: a destination already holding identical bytes just
 * consumes the source, so re-running an ingest is always safe.
 */
export async function intakeMove(from, to) {
  if (!folderRef) throw new Error('No folder is connected.');
  if (onDesktop()) return desktop.intakeMove(folderRef, from, to);

  const bytes = await intakeRead(from);
  const stamp = await intakeWrite(to, bytes);
  const parts = from.split('/');
  const name = parts.pop();
  const dir = await webFolder(parts.join('/'));
  await dir.removeEntry(name);
  return stamp;
}

/** SHA-256 of an intake file, for deduping snapshots. */
export async function intakeHash(rel) {
  if (!folderRef) throw new Error('No folder is connected.');
  if (onDesktop()) return desktop.intakeHash(folderRef, rel);
  const bytes = await intakeRead(rel);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function putBlob(id, file) {
  if (!folderRef) throw new Error('No folder is connected.');
  return ioPutBlob(folderRef, id, file);
}

export async function getBlob(id) {
  if (!folderRef) return null;
  return ioGetBlob(folderRef, id);
}

export async function deleteBlob(id) {
  if (!folderRef) return;
  await ioDeleteBlob(folderRef, id);
}

/** Total bytes held in the attachments folder — shown in Settings. */
export async function blobUsage() {
  if (!folderRef) return { count: 0, bytes: 0 };
  return ioBlobUsage(folderRef);
}
