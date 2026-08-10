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
 * protects the work is `savePlan()` — the file's size and modified time are
 * checked against what we last saw, and a mismatch refuses the write. You may
 * be told to reload; you can never silently overwrite someone.
 *
 * Imports: events, desktop.
 */

import { emit, EV } from './events.js';
import * as desktop from './desktop.js';

/** How often the holder re-stamps the lock, in ms. */
const HEARTBEAT_MS = 20000;
/** A lock older than this is treated as abandoned — a crash, or a closed lid. */
const STALE_MS = 75000;
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
/** Size and modified time of the plan as we last saw it — the write guard. */
let stamp = null;
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

/** `[{ name, size, modified }]`, newest first. Lock files are not plans. */
async function ioListPlans(ref) {
  if (onDesktop()) return desktop.listPlans(ref);

  const out = [];
  for await (const [name, handle] of ref.entries()) {
    if (handle.kind !== 'file') continue;
    const lower = name.toLowerCase();
    if (!lower.endsWith('.json') || lower.endsWith('.lock.json')) continue;
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
  await releaseLock();
  stopTimers();
  folderRef = null;
  folderName = '';
  planName = '';
  stamp = null;
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
  stamp = read.stamp;
  await ioRemember(folderRef, name);

  const lock = await readLock();
  if (lock && !isOurs(lock) && !isStale(lock)) {
    role = 'viewer';
    holder = lock.holder || 'Someone';
  } else {
    role = 'editor';
    holder = '';
    await writeLock();
  }

  lastSaveAt = Date.now();
  startTimers();
  emitState();
  return { doc, role, holder };
}

/** Write a new plan into the folder and open it. */
export async function createPlan(name, doc) {
  if (!folderRef) throw new Error('No folder is connected.');
  const safe = name.toLowerCase().endsWith('.json') ? name : `${name}.json`;

  stamp = await ioWritePlan(folderRef, safe, serialise(doc), null);
  planName = safe;
  role = 'editor';
  holder = '';
  await ioRemember(folderRef, safe);
  lastSaveAt = Date.now();
  await writeLock();
  startTimers();
  emitState();
  return safe;
}

/**
 * Write the document back, but never over someone else's work.
 *
 * The guard is the whole safety property of this mode: the file's size and
 * modified time are checked against what we last saw, and a mismatch refuses the
 * write. The caller is told to reload rather than being allowed to clobber.
 */
export async function savePlan(doc) {
  if (!isConnected()) return { ok: false, reason: 'not-connected' };
  if (role === 'viewer') return { ok: false, reason: 'read-only' };

  try {
    stamp = await ioWritePlan(folderRef, planName, serialise(doc), stamp);
    lastSaveAt = Date.now();
    return { ok: true, at: stamp.modified };
  } catch (err) {
    if (err && err.kind === 'conflict') {
      emit(EV.FILE_CONFLICT, { plan: planName });
      return { ok: false, reason: 'conflict', conflict: true };
    }
    // A lapsed permission grant is the common browser failure, and it reads as
    // a generic error unless we say so.
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    return { ok: false, reason: denied ? 'permission' : 'error', error: err };
  }
}

/** Re-read the plan from the folder — the "they saved, catch up" path. */
export async function refreshFromDisk() {
  if (!isConnected()) return null;
  const read = await ioReadPlan(folderRef, planName);
  stamp = read.stamp;
  try {
    return JSON.parse(read.text);
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
   The lock

   Every rule here runs identically in both builds. The I/O layer above moves
   the bytes; this decides what they mean.
   ═══════════════════════════════════════════════════════════════════════ */

async function readLock() {
  if (!folderRef || !planName) return null;
  const text = await ioReadLock(folderRef, planName);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null; // mid-sync, or truncated — treat as free
  }
}

async function writeLock() {
  if (!folderRef || !planName) return;
  try {
    await ioWriteLock(
      folderRef,
      planName,
      JSON.stringify(
        { id: sessionId, device: deviceId(), holder: getDisplayName(), since: Date.now(), beat: Date.now() },
        null,
        2
      )
    );
  } catch (err) {
    // Failing to take the lock is not fatal: the write guard still protects the
    // work, so the session continues without the courtesy.
    console.warn('[cx-timeline] could not write the lock file:', err.message);
  }
}

async function releaseLock() {
  if (!folderRef || !planName || role !== 'editor') return;
  try {
    const lock = await readLock();
    if (lock && !isOurs(lock)) return; // someone took over; leave theirs alone
    await ioRemoveLock(folderRef, planName);
  } catch {
    /* the staleness timeout is the real release mechanism */
  }
}

/**
 * Is this lock ours to take?
 *
 * Same window is obviously ours. Same *machine* counts too, and deliberately:
 * it is either our own abandoned lock — the case that used to lock people out —
 * or another window of the same install, and the person sitting in front of both
 * should not have to negotiate with themselves. The other window finds out
 * through `checkLock()` and drops to read-only, which is the same handling a
 * colleague's takeover already gets.
 */
function isOurs(lock) {
  if (!lock) return false;
  if (lock.id === sessionId) return true;
  return !!lock.device && lock.device === deviceId();
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
  role = 'editor';
  holder = '';
  lastSaveAt = Date.now();
  await writeLock();
  emitState();
  return true;
}

/**
 * Who holds the lock right now, for a caller about to offer a takeover.
 * `live` means someone else is actively stamping it — the only case worth a
 * confirmation prompt.
 */
export async function lockStatus() {
  const lock = await readLock();
  if (!lock) return { live: false, mine: false, holder: '', idleMs: 0 };
  const mine = isOurs(lock);
  return {
    live: !mine && !isStale(lock),
    mine,
    holder: lock.holder || 'Someone',
    idleMs: lock.beat ? Date.now() - lock.beat : 0,
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

/** Who holds the pen right now, re-read from the folder. */
export async function checkLock() {
  if (!isConnected()) return null;
  const lock = await readLock();

  if (!lock || isOurs(lock) || isStale(lock)) {
    // Nobody is in there. Promote a viewer that has been waiting.
    if (role === 'viewer') {
      role = 'editor';
      holder = '';
      await writeLock();
      emitState();
    }
    return { role, holder, stale: !!lock && isStale(lock) };
  }

  if (role === 'editor') {
    // Somebody else stamped the lock while we thought we had it — two sessions
    // opened inside one sync window. Yield: their save would beat ours anyway.
    role = 'viewer';
    holder = lock.holder || 'Someone';
    emitState();
  } else if (holder !== (lock.holder || 'Someone')) {
    holder = lock.holder || 'Someone';
    emitState();
  }
  return { role, holder, stale: false };
}

/* ══════════════════════════════════════════════════════════════════════════
   Watching the folder
   ═══════════════════════════════════════════════════════════════════════ */

function startTimers() {
  stopTimers();
  heartbeatTimer = setInterval(() => {
    if (role !== 'editor') return;
    // Idle long enough that holding the pen is just in the way. Ask the
    // application to flush a save and hand it back — this module cannot save the
    // document itself, it only knows the file.
    if (lastSaveAt && Date.now() - lastSaveAt > IDLE_RELEASE_MS) {
      emit(EV.FILE_IDLE, { plan: planName, since: lastSaveAt });
      return;
    }
    writeLock();
  }, HEARTBEAT_MS);

  pollTimer = setInterval(async () => {
    if (!isConnected()) return;
    try {
      await checkLock();
      const read = await ioReadPlan(folderRef, planName);
      if (stamp && (read.stamp.size !== stamp.size || read.stamp.modified !== stamp.modified)) {
        // Do not update the stamp — the write guard needs to keep refusing until
        // the document has actually been reloaded.
        emit(EV.FILE_EXTERNAL_CHANGE, { plan: planName, at: read.stamp.modified });
      }
    } catch {
      /* the folder went away — the next save will report it properly */
    }
  }, POLL_MS);
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
