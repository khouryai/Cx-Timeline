/**
 * The shared folder.
 *
 * This module is the *only* one that knows the File System Access API exists,
 * the same way `core/cloud.js` is the only one that knows about Supabase.
 * Everything above it — storage, the panels, the status bar — talks to the
 * functions here and would keep working against a different file backend.
 *
 * It is inert unless the browser supports the API and the user has connected a
 * folder. With nothing connected `isConnected()` returns false, nothing here is
 * ever called, and CX Timeline behaves exactly as it always has.
 *
 * What lives in a connected folder
 * --------------------------------
 *   <plan>.json         the project, in exactly the format Export → JSON writes
 *   <plan>.lock.json    who currently has the pen, and when they last touched it
 *   attachments/<id>    attachment bytes, one file each
 *
 * The plan file format is deliberately unchanged: a folder full of these opens
 * in the importer, reads in a text editor, and is versioned by whatever the
 * folder is synced with. Nothing here is a proprietary container.
 *
 * On two people at once
 * --------------------
 * The lock file says who is editing, and the other person opens read-only. But
 * a synced folder is not a database: the lock takes as long to arrive as the
 * sync does, so two people opening within the same few seconds can both believe
 * they hold it. The lock is therefore *courtesy*, and the guard that actually
 * protects the work is `savePlan()` — it re-reads the file's size and modified
 * time before every write and refuses if either moved since we last read it.
 * That is the same promise the hosted path makes with its revision check: you
 * may be told to reload, but you can never silently overwrite someone.
 *
 * Imports: util, events.
 */

import { emit, EV } from './events.js';

/** How often the holder re-stamps the lock, in ms. */
const HEARTBEAT_MS = 30000;
/** A lock older than this is treated as abandoned — a crash, or a closed lid. */
const STALE_MS = 150000;
/** How often we look for someone else's save landing in the folder. */
const POLL_MS = 12000;
/** Where the folder handle is remembered between sessions. */
const DB_NAME = 'cx-timeline-folder';
const DB_STORE = 'handles';
const HANDLE_KEY = 'folder';

/* ── State ─────────────────────────────────────────────────────────────── */

let dirHandle = null;
let fileHandle = null;
let planName = '';
/** Size and modified time of the plan as we last saw it — the write guard. */
let stamp = null;
/** 'editor' when we hold the lock, 'viewer' when someone else does. */
let role = null;
/** Who holds the lock, when it is not us. */
let holder = '';
/** This tab's identity, so we recognise our own lock across a reload. */
const sessionId = `s_${Math.random().toString(36).slice(2, 10)}`;
let displayName = '';
let heartbeatTimer = null;
let pollTimer = null;

/* ── Capability ────────────────────────────────────────────────────────── */

/** True when this browser can open a folder at all. Chromium-based only. */
export function isSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** True when a plan in a connected folder is the live document. */
export function isConnected() {
  return !!(dirHandle && fileHandle);
}

/** True when someone else holds the pen, so this session must not write. */
export function isViewer() {
  return isConnected() && role === 'viewer';
}

/** Everything the interface needs to describe the current state. */
export function state() {
  return {
    supported: isSupported(),
    connected: isConnected(),
    folder: dirHandle ? dirHandle.name : '',
    plan: planName,
    role: role || null,
    holder,
    savedAt: stamp ? stamp.lastModified : null,
  };
}

/** The name a colleague will see in the lock. Set once, from the settings pane. */
export function setDisplayName(name) {
  displayName = String(name || '').trim();
  writePref('name', displayName);
}

export function getDisplayName() {
  return displayName || readPref('name') || 'Someone';
}

/* ── Remembering the folder between sessions ───────────────────────────── */

/**
 * Directory handles survive a reload, but only in IndexedDB — they are
 * structured-cloneable and cannot be serialised to JSON. This is a database of
 * its own rather than a table in the main one, so `core/storage.js` can import
 * this module without this module importing it back.
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

/** Small device-scoped values (the display name, the last plan opened). */
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

/** The folder we remembered, if any — so the UI can offer to reconnect by name. */
export async function storedFolder() {
  const record = await recallHandle();
  if (!record || !record.handle) return null;
  return { folder: record.handle.name, plan: record.plan || '' };
}

/* ── Connecting ────────────────────────────────────────────────────────── */

/**
 * Ask for a folder and remember it. Must be called from a user gesture — the
 * browser refuses a picker that nobody clicked for.
 *
 * Returns the plans found inside so the caller can choose, rather than guessing
 * on the user's behalf when a folder holds several.
 */
export async function chooseFolder() {
  if (!isSupported()) throw new Error('This browser cannot open a folder. Use Edge or Chrome.');
  const handle = await window.showDirectoryPicker({ id: 'cx-timeline-plans', mode: 'readwrite' });
  if (!handle) return null;
  if (!(await ensurePermission(handle))) throw new Error('Permission to edit that folder was declined.');

  dirHandle = handle;
  fileHandle = null;
  planName = '';
  await rememberHandle(handle, '');
  emitState();
  return { folder: handle.name, plans: await listPlans() };
}

/**
 * Reconnect to the remembered folder without prompting.
 *
 * Resolves to the folder's plans when the browser still considers the grant
 * live, and to null when it needs a click — which is why the caller shows a
 * "reconnect" affordance rather than throwing the user into a dialog on boot.
 */
export async function reconnectSilently() {
  if (!isSupported()) return null;
  const record = await recallHandle();
  if (!record || !record.handle) return null;

  const granted = await queryPermission(record.handle);
  if (!granted) return null;

  dirHandle = record.handle;
  fileHandle = null;
  planName = '';
  emitState();
  return { folder: dirHandle.name, plans: await listPlans(), lastPlan: record.plan || '' };
}

/** Reconnect from a user gesture, prompting for permission if it has lapsed. */
export async function reconnectWithPrompt() {
  if (!isSupported()) return null;
  const record = await recallHandle();
  if (!record || !record.handle) return null;
  if (!(await ensurePermission(record.handle))) return null;

  dirHandle = record.handle;
  fileHandle = null;
  planName = '';
  emitState();
  return { folder: dirHandle.name, plans: await listPlans(), lastPlan: record.plan || '' };
}

async function queryPermission(handle) {
  try {
    return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

async function ensurePermission(handle) {
  if (await queryPermission(handle)) return true;
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** Stop using the folder: release the lock and forget the handle. */
export async function disconnect() {
  await releaseLock();
  stopTimers();
  dirHandle = null;
  fileHandle = null;
  planName = '';
  stamp = null;
  role = null;
  holder = '';
  await forgetHandle();
  emitState();
}

/* ── Plans in the folder ───────────────────────────────────────────────── */

/** Every plan in the connected folder, newest first. Lock files are not plans. */
export async function listPlans() {
  if (!dirHandle) return [];
  const out = [];
  try {
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind !== 'file') continue;
      if (!name.toLowerCase().endsWith('.json')) continue;
      if (name.toLowerCase().endsWith('.lock.json')) continue;
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
  } catch (err) {
    console.warn('[cx-timeline] could not read the folder:', err.message);
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/**
 * Open a plan and take the pen if it is free.
 *
 * Returns `{ doc, role, holder }`. A `viewer` role is not a failure — it means
 * a colleague is in there, and the document is still returned so it can be read.
 */
export async function openPlan(name) {
  if (!dirHandle) throw new Error('No folder is connected.');
  const handle = await dirHandle.getFileHandle(name);
  const file = await handle.getFile();
  const text = await file.text();

  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new Error(`${name} is not a valid project file: ${err.message}`);
  }

  fileHandle = handle;
  planName = name;
  stamp = { size: file.size, lastModified: file.lastModified };
  await rememberHandle(dirHandle, name);

  const lock = await readLock();
  if (lock && !isOurs(lock) && !isStale(lock)) {
    role = 'viewer';
    holder = lock.holder || 'Someone';
  } else {
    role = 'editor';
    holder = '';
    await writeLock();
  }

  startTimers();
  emitState();
  return { doc, role, holder };
}

/** Write a new plan into the folder and open it. */
export async function createPlan(name, doc) {
  if (!dirHandle) throw new Error('No folder is connected.');
  const safe = name.toLowerCase().endsWith('.json') ? name : `${name}.json`;
  const handle = await dirHandle.getFileHandle(safe, { create: true });

  const writable = await handle.createWritable();
  await writable.write(serialise(doc));
  await writable.close();

  fileHandle = handle;
  planName = safe;
  const file = await handle.getFile();
  stamp = { size: file.size, lastModified: file.lastModified };
  role = 'editor';
  holder = '';
  await rememberHandle(dirHandle, safe);
  await writeLock();
  startTimers();
  emitState();
  return safe;
}

/* ── Saving, with the guard ────────────────────────────────────────────── */

/**
 * Write the document back, but never over someone else's work.
 *
 * The file is stat-ed first: if its size or modified time moved since we last
 * read or wrote it, a colleague's save landed in between and this one is
 * refused. That is the whole safety property of this mode — the caller is told
 * to reload rather than being allowed to clobber.
 */
export async function savePlan(doc) {
  if (!fileHandle) return { ok: false, reason: 'not-connected' };
  if (role === 'viewer') return { ok: false, reason: 'read-only' };

  try {
    const current = await fileHandle.getFile();
    if (stamp && (current.size !== stamp.size || current.lastModified !== stamp.lastModified)) {
      emit(EV.FILE_CONFLICT, { plan: planName });
      return { ok: false, reason: 'conflict', conflict: true };
    }

    const writable = await fileHandle.createWritable();
    await writable.write(serialise(doc));
    await writable.close();

    const after = await fileHandle.getFile();
    stamp = { size: after.size, lastModified: after.lastModified };
    return { ok: true, at: after.lastModified };
  } catch (err) {
    // A lapsed permission grant is the common failure here, and it reads as a
    // generic error unless we say so.
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    return { ok: false, reason: denied ? 'permission' : 'error', error: err };
  }
}

/** Re-read the plan from the folder — the "they saved, catch up" path. */
export async function refreshFromDisk() {
  if (!fileHandle) return null;
  const file = await fileHandle.getFile();
  const text = await file.text();
  stamp = { size: file.size, lastModified: file.lastModified };
  try {
    return JSON.parse(text);
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

/* ── The lock ──────────────────────────────────────────────────────────── */

function lockName() {
  return `${planName.replace(/\.json$/i, '')}.lock.json`;
}

async function readLock() {
  if (!dirHandle || !planName) return null;
  try {
    const handle = await dirHandle.getFileHandle(lockName());
    const text = await (await handle.getFile()).text();
    return JSON.parse(text);
  } catch {
    return null; // absent, unreadable or mid-sync — treat as free
  }
}

async function writeLock() {
  if (!dirHandle || !planName) return;
  try {
    const handle = await dirHandle.getFileHandle(lockName(), { create: true });
    const writable = await handle.createWritable();
    await writable.write(
      JSON.stringify({ id: sessionId, holder: getDisplayName(), since: Date.now(), beat: Date.now() }, null, 2)
    );
    await writable.close();
  } catch (err) {
    // Failing to take the lock is not fatal: the write guard still protects the
    // work, so the session continues without the courtesy.
    console.warn('[cx-timeline] could not write the lock file:', err.message);
  }
}

async function releaseLock() {
  if (!dirHandle || !planName || role !== 'editor') return;
  try {
    const lock = await readLock();
    if (lock && !isOurs(lock)) return; // someone took over; leave theirs alone
    await dirHandle.removeEntry(lockName());
  } catch {
    /* the staleness timeout is the real release mechanism */
  }
}

function isOurs(lock) {
  return !!lock && lock.id === sessionId;
}

function isStale(lock) {
  return !lock || !lock.beat || Date.now() - lock.beat > STALE_MS;
}

/**
 * Claim a lock whose holder has gone away.
 *
 * Offered only when the lock reads as stale, so this is "the other session
 * crashed" rather than "barge in on a colleague".
 */
export async function takeOver() {
  if (!isConnected()) return false;
  const lock = await readLock();
  if (lock && !isOurs(lock) && !isStale(lock)) return false;
  role = 'editor';
  holder = '';
  await writeLock();
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

/* ── Watching the folder ───────────────────────────────────────────────── */

function startTimers() {
  stopTimers();
  heartbeatTimer = setInterval(() => {
    if (role === 'editor') writeLock();
  }, HEARTBEAT_MS);

  pollTimer = setInterval(async () => {
    if (!fileHandle) return;
    try {
      await checkLock();
      const file = await fileHandle.getFile();
      if (stamp && (file.size !== stamp.size || file.lastModified !== stamp.lastModified)) {
        // Do not update the stamp — the write guard needs to keep refusing
        // until the document has actually been reloaded.
        emit(EV.FILE_EXTERNAL_CHANGE, { plan: planName, at: file.lastModified });
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

/* ── Attachments ───────────────────────────────────────────────────────── */

async function attachmentsDir(create = false) {
  if (!dirHandle) return null;
  try {
    return await dirHandle.getDirectoryHandle('attachments', { create });
  } catch {
    return null;
  }
}

export async function putBlob(id, file) {
  const dir = await attachmentsDir(true);
  if (!dir) throw new Error('Could not create the attachments folder.');
  const handle = await dir.getFileHandle(id, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
  return { id, name: file.name, type: file.type, size: file.size };
}

export async function getBlob(id) {
  const dir = await attachmentsDir(false);
  if (!dir) return null;
  try {
    const handle = await dir.getFileHandle(id);
    const file = await handle.getFile();
    return { id, blob: file, name: file.name || id, type: file.type, size: file.size };
  } catch {
    return null;
  }
}

export async function deleteBlob(id) {
  const dir = await attachmentsDir(false);
  if (!dir) return;
  try {
    await dir.removeEntry(id);
  } catch {
    /* already gone */
  }
}

/** Total bytes held in the attachments folder — shown in Settings. */
export async function blobUsage() {
  const dir = await attachmentsDir(false);
  if (!dir) return { count: 0, bytes: 0 };
  let count = 0;
  let total = 0;
  try {
    for await (const [, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue;
      count++;
      total += (await handle.getFile()).size;
    }
  } catch {
    /* partial answer is better than none */
  }
  return { count, bytes: total };
}
