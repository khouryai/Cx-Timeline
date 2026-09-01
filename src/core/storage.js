/**
 * Persistence.
 *
 * There is no Save button. Every committed edit is written back within a few
 * hundred milliseconds, and the document survives a browser restart, a crash,
 * or the tab being closed mid-drag.
 *
 * Where it is written depends on how the application is deployed, and every
 * caller is deliberately unaware of which:
 *
 *   local mode   IndexedDB — the original behaviour, no account, no server.
 *   hosted mode  Postgres via `core/cloud.js`, with IndexedDB demoted to an
 *                offline cache so a dropped connection loses nothing.
 *   file mode    a JSON file in a folder the user picked, via
 *                `core/filestore.js` — a shared drive or a synced OneDrive
 *                folder, with IndexedDB again demoted to a cache. No account
 *                and no server: the folder's own permissions are the access
 *                control, and a lock file plus a write guard keep two people
 *                from overwriting each other.
 *
 * Storage stack (local, and the cache in hosted mode)
 * --------------------------------------------------
 * IndexedDB is the primary store — it takes megabytes without complaint,
 * holds binary attachments natively, and writes off the main thread.
 * localStorage is kept as a mirror for the small stuff (preferences) and as a
 * complete fallback when IndexedDB is unavailable, which happens in private
 * browsing on some engines and when a page is opened from `file://` under a
 * hardened profile. The fallback is transparent to every caller.
 *
 * Imports: util, events, cloud, filestore, model, store.
 */

import { debounce, bytes } from './util.js';
import { emit, on, EV } from './events.js';
import * as cloud from './cloud.js';
import * as filestore from './filestore.js';
import { normalise, makeStarterProject } from './model.js';
import { getDoc, markClean, isDirty } from './store.js';

const DB_NAME = 'cx-timeline';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_BACKUPS = 'backups';
const STORE_BLOBS = 'blobs';
const STORE_PREFS = 'prefs';

const LS_PREFIX = 'cxtl.';
const LS_DOC = LS_PREFIX + 'doc';
const LS_BACKUPS = LS_PREFIX + 'backups';

let db = null;
let usingFallback = false;
let editsSinceBackup = 0;
let backupTimer = null;
let lastSaveError = null;

/**
 * True once a signed-in session has a project open on the server. Everything
 * that has two implementations branches on this one flag, so there is a single
 * answer to "where does this go" rather than a scattering of checks.
 */
let hosted = false;

/**
 * True once a plan in a connected folder is the live document. Mutually
 * exclusive with `hosted`: a deployment has a backend or it has a folder, and
 * the folder is only reachable when there is no backend to contradict it.
 */
let fileMode = false;

/* ── IndexedDB plumbing ────────────────────────────────────────────────── */

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_PROJECTS)) {
        database.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_BACKUPS)) {
        const s = database.createObjectStore(STORE_BACKUPS, { keyPath: 'key', autoIncrement: true });
        s.createIndex('time', 'time');
        s.createIndex('projectId', 'projectId');
      }
      if (!database.objectStoreNames.contains(STORE_BLOBS)) {
        database.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_PREFS)) {
        database.createObjectStore(STORE_PREFS, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
  });
}

function tx(storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ── localStorage fallback ─────────────────────────────────────────────── */

function lsAvailable() {
  try {
    const probe = LS_PREFIX + 'probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function lsGetJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function lsSetJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ── Lifecycle ─────────────────────────────────────────────────────────── */

/**
 * Open the store and return the document to load.
 *
 * Hosted: the project last open on this device, or the most recent one the
 * account can reach, or a fresh starter project created on the server.
 * Local: the most recently saved project, or a seeded starter on first run.
 */
export async function init() {
  try {
    db = await openDb();
    usingFallback = false;
  } catch (err) {
    usingFallback = true;
    console.warn('[cx-timeline] IndexedDB unavailable, falling back to localStorage:', err.message);
    if (!lsAvailable()) {
      console.error('[cx-timeline] No persistent storage available — changes will not survive a reload.');
    }
  }

  wireAutosave();

  if (cloud.isSignedIn()) {
    const opened = await openFromCloud();
    if (opened) return opened;
    // Signing in and then failing to reach the data is worth saying out loud
    // rather than silently dropping the user into an unrelated local project.
    console.warn('[cx-timeline] signed in but could not open a project; falling back to local storage');
  }

  if (!cloud.isConfigured()) {
    const opened = await openFromFolder();
    if (opened) return opened;
  }

  const saved = await loadLatest();
  if (saved) return { doc: normalise(saved), fresh: false };
  return { doc: normalise(makeStarterProject()), fresh: true };
}

/**
 * Re-open the plan this device was last working on in its shared folder.
 *
 * Only succeeds when the browser still considers the folder grant live. When it
 * has lapsed — which is the common case after a browser restart — this returns
 * null on purpose: re-granting needs a click, so the last local copy is loaded
 * instead and the interface offers to reconnect. Booting into a permission
 * dialog nobody asked for would be worse than booting into a cached plan.
 */
async function openFromFolder() {
  if (!filestore.isSupported()) return null;
  try {
    const connected = await filestore.reconnectSilently();
    if (!connected) return null;

    const wanted = connected.lastPlan || (connected.plans.length === 1 ? connected.plans[0].name : '');
    if (!wanted) return null;

    const { doc } = await filestore.openPlan(wanted);
    fileMode = true;
    editsSinceBackup = 0;
    return { doc: normalise(doc), fresh: false };
  } catch (err) {
    console.warn('[cx-timeline] could not reopen the shared folder:', err.message);
    return null;
  }
}

/**
 * Open a plan from the connected folder and make it the live document.
 * Called by the Shared folder pane once a folder has been picked.
 */
export async function openFolderPlan(name) {
  const { doc, role, holder } = await filestore.openPlan(name);
  fileMode = true;
  hosted = false;
  editsSinceBackup = 0;
  return { doc: normalise(doc), role, holder };
}

/** Write the current document into the connected folder as a new plan. */
export async function createFolderPlan(name, doc) {
  const written = await filestore.createPlan(name, normalise(doc));
  fileMode = true;
  hosted = false;
  editsSinceBackup = 0;
  return written;
}

/** Stop using the folder and fall back to this device's own storage. */
export async function leaveFolder() {
  await filestore.disconnect();
  fileMode = false;
}

/** True when the live document is a file in a connected folder. */
export function isFileMode() {
  return fileMode;
}

/**
 * Choose and open a project on the server.
 * Returns the same shape as `init()`, or null when nothing could be opened.
 */
async function openFromCloud() {
  try {
    const projects = await cloud.listProjects();

    // Prefer whatever this device had open, so a reload lands where you were.
    const remembered = getPref('lastProject');
    const wanted = projects.find((p) => p.id === remembered) || projects[0];

    if (!wanted) {
      const doc = normalise(makeStarterProject());
      await cloud.createProject(doc);
      hosted = true;
      setPref('lastProject', cloud.getProjectId());
      return { doc, fresh: true };
    }

    const doc = await cloud.openProject(wanted.id);
    if (!doc) return null;
    hosted = true;
    setPref('lastProject', wanted.id);
    return { doc: normalise(doc), fresh: false };
  } catch (err) {
    console.warn('[cx-timeline] could not load from the server:', err.message);
    return null;
  }
}

/** Open a different project. Used by the Projects pane. */
export async function switchProject(id) {
  const doc = await cloud.openProject(id);
  if (!doc) throw new Error('That project is no longer available.');
  hosted = true;
  setPref('lastProject', id);
  editsSinceBackup = 0;
  return normalise(doc);
}

/** Create a project on the server from a document, and open it. */
export async function createCloudProject(doc) {
  const id = await cloud.createProject(normalise(doc));
  hosted = true;
  setPref('lastProject', id);
  editsSinceBackup = 0;
  return id;
}

/** True when the document is being kept on the server. */
export function isHosted() {
  return hosted;
}

/** True when running on the localStorage fallback path. */
export function isFallback() {
  return usingFallback;
}

async function loadLatest() {
  if (usingFallback) return lsGetJSON(LS_DOC);
  try {
    const all = await wrap(tx(STORE_PROJECTS).getAll());
    if (!all || !all.length) return null;
    all.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    return all[0].doc;
  } catch (err) {
    console.warn('[cx-timeline] load failed:', err);
    return null;
  }
}

/** Every project on disk, newest first — the "Open project" dialog uses this. */
export async function listProjects() {
  if (usingFallback) {
    const d = lsGetJSON(LS_DOC);
    return d ? [{ id: d.id, name: d.name, savedAt: d.modified, objects: (d.objects || []).length }] : [];
  }
  try {
    const all = await wrap(tx(STORE_PROJECTS).getAll());
    return all
      .map((r) => ({ id: r.id, name: r.doc?.name || 'Untitled', savedAt: r.savedAt, objects: (r.doc?.objects || []).length }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function loadProject(id) {
  if (usingFallback) {
    const d = lsGetJSON(LS_DOC);
    return d && d.id === id ? d : null;
  }
  const record = await wrap(tx(STORE_PROJECTS).get(id));
  return record ? record.doc : null;
}

export async function deleteProject(id) {
  if (usingFallback) {
    localStorage.removeItem(LS_DOC);
    return;
  }
  await wrap(tx(STORE_PROJECTS, 'readwrite').delete(id));
}

/* ── Saving ────────────────────────────────────────────────────────────── */

/**
 * Write the current document. Resolves once the write is durable.
 * Callers never need this directly — autosave handles it — but export and
 * "close window" paths flush explicitly.
 */
export async function saveNow() {
  const doc = getDoc();
  emit(EV.SAVE_START);
  try {
    const record = { id: doc.id, savedAt: Date.now(), doc };

    if (hosted) {
      const result = await cloud.saveProject(doc);

      if (!result.ok) {
        // A read-only refusal is not a failure to report as one: the user is
        // simply browsing, and the write guard has already told them.
        if (result.reason === 'read-only') {
          markClean();
          emit(EV.SAVE_DONE, { at: Date.now(), skipped: true });
          return true;
        }
        if (result.conflict) {
          // Never overwrite: keep the work in the local cache so it can be
          // recovered, and let the UI decide what to offer.
          await cacheLocally(record);
          emit(EV.SAVE_ERROR, { error: new Error('conflict'), conflict: true });
          return false;
        }
        throw new Error(result.reason || 'save failed');
      }

      // A local copy of every successful save is what makes a dropped
      // connection survivable, and what the crash-recovery path reads.
      await cacheLocally(record);
    } else if (fileMode) {
      const result = await filestore.savePlan(doc);

      if (!result.ok) {
        /* Somebody else has the pen. The user has already been told by the
           banner, so this is not an error to raise again — but it is not a save
           either, and it used to be recorded as one. Marking the document clean
           here said "saved" about work that had been written nowhere, and the
           unload warning then let it go without a word. Cache it and leave it
           dirty: the store refuses new edits while the pen is elsewhere, so
           what is here is whatever was in flight when it changed hands. */
        if (result.reason === 'read-only') {
          await cacheLocally(record);
          // Whether that matters depends entirely on whether there was
          // anything to save. Opening a plan someone else is holding attempts
          // one too, and telling a reader their work is unsaved when they have
          // not touched anything is its own small lie.
          emit(EV.SAVE_DONE, { at: Date.now(), skipped: true, unsaved: isDirty() });
          return true;
        }
        // The file moved underneath us, or the grant lapsed. Keep the work in
        // the local cache either way, so nothing is lost while it is resolved.
        await cacheLocally(record);
        if (result.reason === 'conflict') {
          emit(EV.SAVE_ERROR, { error: new Error('conflict'), conflict: true });
          return false;
        }
        if (result.reason === 'permission') {
          emit(EV.SAVE_ERROR, { error: new Error('permission'), permission: true });
          return false;
        }
        throw result.error || new Error('the folder refused the write');
      }

      await cacheLocally(record);
    } else if (usingFallback) {
      lsSetJSON(LS_DOC, doc);
    } else {
      await wrap(tx(STORE_PROJECTS, 'readwrite').put(record));
    }

    markClean();
    lastSaveError = null;
    emit(EV.SAVE_DONE, { at: record.savedAt });

    editsSinceBackup++;
    const every = doc.settings.backupEveryEdits || 0;
    if (every > 0 && editsSinceBackup >= every) {
      editsSinceBackup = 0;
      makeBackup('edit-count').catch(() => {});
    }
    return true;
  } catch (err) {
    lastSaveError = err;
    console.error('[cx-timeline] save failed:', err);
    emit(EV.SAVE_ERROR, { error: err });
    // A quota failure is the common case; surface it rather than silently
    // dropping the user's work.
    if (err && /quota/i.test(err.name || err.message || '')) {
      emit(EV.TOAST, {
        tone: 'bad',
        title: 'Storage full',
        message: 'Delete old backups or attachments to free space. Recent changes are not saved.',
        sticky: true,
      });
    }
    return false;
  }
}

/** Mirror a save into IndexedDB. Best-effort: the server is the record. */
async function cacheLocally(record) {
  if (usingFallback) {
    try {
      lsSetJSON(LS_DOC, record.doc);
    } catch {
      /* the cache is a convenience, not the record */
    }
    return;
  }
  try {
    await wrap(tx(STORE_PROJECTS, 'readwrite').put(record));
  } catch {
    /* a full local cache must never block a successful server save */
  }
}

const scheduleSave = debounce(() => {
  saveNow();
}, 500);

export function getLastSaveError() {
  return lastSaveError;
}

function wireAutosave() {
  on(EV.DOC_CHANGED, (payload) => {
    if (payload?.transient) return; // mid-drag previews never hit disk
    scheduleSave();
  });

  // A close or reload must not lose the last few hundred milliseconds of work.
  window.addEventListener('beforeunload', () => {
    if (isDirty()) {
      scheduleSave.cancel();
      // Synchronous best-effort mirror; IndexedDB cannot complete here.
      try {
        lsSetJSON(LS_DOC + '.recovery', getDoc());
      } catch {
        /* out of space — nothing more we can do at unload time */
      }
    }
  });

  // Flush when the tab is hidden — on mobile and on OS sleep this is often
  // the last callback a page receives.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isDirty()) {
      scheduleSave.flush();
    }
  });

  startBackupTimer();
}

/**
 * Recover a document written by the unload handler after an unclean exit,
 * if it is newer than what made it into IndexedDB.
 */
export function takeRecovery(currentDoc) {
  const recovery = lsGetJSON(LS_DOC + '.recovery');
  localStorage.removeItem(LS_DOC + '.recovery');
  if (!recovery || !recovery.id) return null;
  if (currentDoc && recovery.id === currentDoc.id && (recovery.modified || 0) <= (currentDoc.modified || 0)) return null;
  return recovery;
}

/* ── Backups ───────────────────────────────────────────────────────────── */

function startBackupTimer() {
  clearInterval(backupTimer);
  const minutes = getDoc().settings.autoBackupMinutes || 60;
  if (minutes <= 0) return;
  backupTimer = setInterval(() => {
    makeBackup('scheduled').catch(() => {});
  }, minutes * 60_000);
}

/** Restart the timer after the interval setting changes. */
export function refreshBackupSchedule() {
  startBackupTimer();
}

/** Snapshot the current document into the backup store. */
export async function makeBackup(reason = 'manual') {
  const doc = getDoc();
  const entry = {
    time: Date.now(),
    reason,
    projectId: doc.id,
    name: doc.name,
    objects: doc.objects.length,
    doc,
  };
  try {
    if (hosted) {
      const written = await cloud.createBackup(doc, reason);
      if (!written) return false; // read-only, or the server said no
      await cloud.pruneBackups(doc.settings.backupKeep || 20);
    } else if (usingFallback) {
      const list = lsGetJSON(LS_BACKUPS, []);
      list.push({ ...entry, key: entry.time });
      // localStorage is tight; keep far fewer snapshots on the fallback path.
      while (list.length > 5) list.shift();
      lsSetJSON(LS_BACKUPS, list);
    } else {
      await wrap(tx(STORE_BACKUPS, 'readwrite').add(entry));
      await pruneBackups(doc.settings.backupKeep || 20);
    }
    emit(EV.BACKUP_MADE, { reason, time: entry.time });
    return true;
  } catch (err) {
    console.warn('[cx-timeline] backup failed:', err);
    return false;
  }
}

export async function listBackups() {
  if (hosted) {
    try {
      return await cloud.listBackups();
    } catch (err) {
      console.warn('[cx-timeline] could not list backups:', err.message);
      return [];
    }
  }
  if (usingFallback) {
    return lsGetJSON(LS_BACKUPS, [])
      .map((b) => ({ key: b.key, time: b.time, reason: b.reason, name: b.name, objects: b.objects, size: 0 }))
      .sort((a, b) => b.time - a.time);
  }
  try {
    const all = await wrap(tx(STORE_BACKUPS).getAll());
    return all
      .map((b) => ({
        key: b.key,
        time: b.time,
        reason: b.reason,
        name: b.name,
        objects: b.objects,
        size: estimateSize(b.doc),
      }))
      .sort((a, b) => b.time - a.time);
  } catch {
    return [];
  }
}

export async function loadBackup(key) {
  if (hosted) return cloud.loadBackup(key);
  if (usingFallback) {
    const found = lsGetJSON(LS_BACKUPS, []).find((b) => b.key === key);
    return found ? found.doc : null;
  }
  const record = await wrap(tx(STORE_BACKUPS).get(key));
  return record ? record.doc : null;
}

export async function deleteBackup(key) {
  if (hosted) {
    await cloud.deleteBackup(key);
    return;
  }
  if (usingFallback) {
    lsSetJSON(LS_BACKUPS, lsGetJSON(LS_BACKUPS, []).filter((b) => b.key !== key));
    return;
  }
  await wrap(tx(STORE_BACKUPS, 'readwrite').delete(key));
}

/** Trim the backup history to the newest `keep` entries. */
export async function pruneBackups(keep = 20) {
  if (hosted) {
    await cloud.pruneBackups(keep);
    return;
  }
  if (usingFallback || keep <= 0) return;
  const all = await wrap(tx(STORE_BACKUPS).getAll());
  if (all.length <= keep) return;
  all.sort((a, b) => a.time - b.time);
  const store = tx(STORE_BACKUPS, 'readwrite');
  for (const record of all.slice(0, all.length - keep)) store.delete(record.key);
}

function estimateSize(doc) {
  try {
    return JSON.stringify(doc).length;
  } catch {
    return 0;
  }
}

/* ── Attachment blobs ──────────────────────────────────────────────────── */

/**
 * Store a file's bytes. Attachments live outside the document so a project
 * with 200 MB of logs still autosaves in milliseconds.
 */
export async function putBlob(id, file) {
  if (hosted) return cloud.putBlob(id, file);
  // In a shared folder the bytes go beside the plan, so a colleague who syncs
  // the folder gets the attachments along with it.
  if (fileMode) return filestore.putBlob(id, file);
  const record = { id, name: file.name, type: file.type, size: file.size, added: Date.now(), blob: file };
  if (usingFallback) {
    throw new Error('Attachments require IndexedDB, which is not available in this browser session.');
  }
  await wrap(tx(STORE_BLOBS, 'readwrite').put(record));
  return { id, name: file.name, type: file.type, size: file.size };
}

export async function getBlob(id) {
  if (hosted) {
    const blob = await cloud.getBlob(id);
    return blob ? { id, blob, name: id, type: blob.type, size: blob.size } : null;
  }
  if (fileMode) return filestore.getBlob(id);
  if (usingFallback) return null;
  const record = await wrap(tx(STORE_BLOBS).get(id));
  return record || null;
}

export async function deleteBlob(id) {
  if (hosted) {
    await cloud.deleteBlob(id);
    return;
  }
  if (fileMode) {
    await filestore.deleteBlob(id);
    return;
  }
  if (usingFallback) return;
  await wrap(tx(STORE_BLOBS, 'readwrite').delete(id));
}

/** Total bytes held in the blob store — shown in Settings. */
export async function blobUsage() {
  if (fileMode) {
    const used = await filestore.blobUsage();
    return { ...used, label: bytes(used.bytes) };
  }
  if (usingFallback) return { count: 0, bytes: 0, label: '0 B' };
  try {
    const all = await wrap(tx(STORE_BLOBS).getAll());
    const total = all.reduce((sum, r) => sum + (r.size || 0), 0);
    return { count: all.length, bytes: total, label: bytes(total) };
  } catch {
    return { count: 0, bytes: 0, label: '0 B' };
  }
}

/**
 * Delete blobs no longer referenced by the document. Called after bulk
 * deletions so removed attachments do not linger and consume quota.
 */
export async function collectGarbage() {
  if (usingFallback) return 0;
  const doc = getDoc();
  const live = new Set(doc.attachments.map((a) => a.id));
  const all = await wrap(tx(STORE_BLOBS).getAll());
  const store = tx(STORE_BLOBS, 'readwrite');
  let removed = 0;
  for (const record of all) {
    if (!live.has(record.id)) {
      store.delete(record.id);
      removed++;
    }
  }
  return removed;
}

/**
 * Delete this browser's copy of the work.
 *
 * In file mode the folder is the record and everything here is a convenience:
 * a cache of the last save, local snapshot history, and the copy the unload
 * handler leaves for crash recovery. On a shared or borrowed machine that
 * convenience is the one place a plan lingers after you have finished with it,
 * so it can be thrown away deliberately.
 *
 * The folder connection is left alone — the plan itself is untouched on disk,
 * and re-picking the folder would be a pointless chore.
 */
export async function purgeLocalCopy() {
  let cleared = 0;

  for (const key of [LS_DOC, LS_DOC + '.recovery', LS_BACKUPS]) {
    try {
      if (localStorage.getItem(key) !== null) cleared++;
      localStorage.removeItem(key);
    } catch {
      /* nothing we can do, and nothing lost */
    }
  }

  if (!usingFallback && db) {
    for (const store of [STORE_PROJECTS, STORE_BACKUPS, STORE_BLOBS]) {
      try {
        const all = await wrap(tx(store).getAll());
        cleared += all.length;
        await wrap(tx(store, 'readwrite').clear());
      } catch (err) {
        console.warn(`[cx-timeline] could not clear ${store}:`, err.message);
      }
    }
  }

  return cleared;
}

/* ── Preferences (device-scoped, not part of the document) ─────────────── */

export function getPref(key, fallback = null) {
  const value = lsGetJSON(LS_PREFIX + key);
  return value === null || value === undefined ? fallback : value;
}

export function setPref(key, value) {
  try {
    lsSetJSON(LS_PREFIX + key, value);
  } catch {
    /* preferences are best-effort */
  }
}

/* ── Diagnostics ───────────────────────────────────────────────────────── */

/** Storage report for the Settings panel. */
export async function usage() {
  const doc = getDoc();
  const docBytes = estimateSize(doc);
  const blobs = await blobUsage();
  let quota = null;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      quota = { used: est.usage, total: est.quota };
    }
  } catch {
    /* not supported — the report simply omits the quota line */
  }
  return {
    backend: hosted
      ? 'Supabase (this device keeps an offline copy)'
      : fileMode
        ? `Shared folder — ${filestore.state().folder}/${filestore.state().plan}`
        : usingFallback
          ? 'localStorage (fallback)'
          : 'IndexedDB',
    document: { bytes: docBytes, label: bytes(docBytes) },
    attachments: blobs,
    quota,
  };
}
