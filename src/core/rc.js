/**
 * The Resource Calendar's data.
 *
 * The calendar used to live in Postgres, behind Supabase, with accounts, roles
 * and row-level security. It lives in the shared folder now, beside the plan:
 * `core/rc_db.js` keeps its tables as JSON files under `calendar/` and answers
 * the same questions the Supabase client did, so every function here asks
 * exactly what it asked before and the screens did not change. Nothing leaves
 * this computer but the files OneDrive syncs.
 *
 * There are no accounts. Whoever has the application and the folder is an
 * editor; the folder's sharing is who may. One person writes the calendar at a
 * time — the **pen**, `core/rc_folder.js`, the plan's rules — and anybody else
 * opens it read-only and is told who has it. Who you are is the name set in the
 * application (the name the plan's pen already shows), matched to the roster.
 *
 * Imports: events, filestore, rc_db, rc_folder.
 */

import { emit, on, EV } from './events.js';
import * as filestore from './filestore.js';
import { createDb, TABLE_NAMES, FORMAT } from './rc_db.js';
import * as folder from './rc_folder.js';

/* ── State ─────────────────────────────────────────────────────────────── */

/** The database over the connected folder, or null. */
let db = null;
/** Which folder `db` is over, so connecting another starts again. */
let openFolder = '';
/** 'no-folder' | 'empty' | 'open' | 'failed' */
let state = 'no-folder';
let problem = null;
/** The roster row the name in the application matches, or a stand-in for it. */
let person = null;
let pollTimer = null;
let starting = null;

const POLL_MS = 15000;

/* ── Configuration ─────────────────────────────────────────────────────── */

/**
 * True when this build can hold a calendar at all: it needs a folder, which
 * the desktop application always can and a browser can only in Edge or Chrome.
 */
export function isConfigured() {
  return filestore.isSupported();
}

/** Where the calendar stands: no folder, a folder with none in it, open, or failed. */
export function status() {
  return { state, problem: problem ? String(problem.message || problem) : null, folder: openFolder };
}

/* ── Who is working ────────────────────────────────────────────────────── */

/** The name set in the application, or '' while nobody has set one. */
export function displayName() {
  const name = filestore.getDisplayName();
  return name === 'Someone' ? '' : name;
}

const fold = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Match the name in the application to somebody on the roster.
 *
 * Exactly, folded — the rule every name in this calendar is matched by. A name
 * nobody on the roster has is still somebody: they are drawn as themselves,
 * and what they write is stamped with their name.
 */
async function refreshPerson() {
  const name = displayName();
  let people = [];
  try {
    people = state === 'open' ? (await select('rc_people', (q) => q.eq('active', true))) : [];
  } catch {
    people = [];
  }
  const key = fold(name);
  const hit = key ? people.find((p) => fold(p.name) === key) : null;
  person = hit
    ? { ...hit, role: 'admin' }
    : { id: name ? `name:${name}` : 'name:', name: name || 'You', user_id: null, role: 'admin', active: true, title: null, subsystem: null };
  return person;
}

/**
 * The author id a write is stamped with. A roster person keeps the account id
 * they had in the old calendar, so their history stays theirs; anybody else
 * is `local:<their roster id>`, or `name:<the name typed>` when they are not
 * on it. `authorName()` in `ui/rc_util.js` reads all three back.
 */
function authorId() {
  const p = person;
  if (!p) return null;
  if (p.user_id) return p.user_id;
  if (String(p.id).startsWith('name:')) return p.id;
  return `local:${p.id}`;
}

export function currentUser() {
  return state === 'open' ? { id: authorId(), email: null } : null;
}

/** True once a calendar is open — the old "signed in". */
export function isSignedIn() {
  return state === 'open';
}

/** The caller's own person row, or the stand-in for somebody not on the roster. */
export function me() {
  return state === 'open' ? person : null;
}

/**
 * Everybody with the application is an editor: there are no members or
 * viewers any more, only whoever holds the pen and whoever is waiting.
 */
export function isAdmin() {
  return state === 'open';
}

export function role() {
  return state === 'open' ? 'admin' : null;
}

/** True while this window holds the pen and may write. */
export function canWrite() {
  return state === 'open' && folder.holdsPen();
}

export function isViewer() {
  return state === 'open' && !folder.holdsPen();
}

export function accountLabel() {
  return person?.name || displayName() || '';
}

/** Who has the pen, for the header. */
export function penState() {
  return folder.penState();
}

export const takePen = () => folder.takePen();
export const releasePen = () => folder.releasePen();

/** Why a write cannot be made here, or true. */
function writable() {
  // 'empty' is the one moment a calendar is being written into a folder that has none.
  if (state !== 'open' && state !== 'empty') return 'No calendar is open.';
  if (folder.holdsPen()) return true;
  const { holder } = folder.penState();
  return `Read only — ${holder || 'somebody else'} is editing the calendar. `
    + 'Take over at the top of the calendar if they have finished.';
}

/** The name given to the database for stamping its files. */
function who() {
  return { userId: authorId(), personId: person?.id || null, name: person?.name || displayName() };
}

/* ── Opening ───────────────────────────────────────────────────────────── */

/**
 * Open the calendar in the connected folder, if it has one.
 *
 * Never throws: a folder with no calendar yet, or none connected, is a state
 * the calendar's front door explains (`ui/rc_gate.js`), not an error.
 */
export function init() {
  asked = true;
  if (!starting) starting = start().finally(() => { starting = null; });
  return starting;
}

/** Whether anything has asked for the calendar yet. */
let asked = false;

async function start() {
  if (!isConfigured()) {
    state = 'no-folder';
    return null;
  }
  const where = filestore.state().folder;
  if (!filestore.hasFolder()) {
    reset('no-folder');
    return null;
  }
  if (db && where === openFolder && state === 'open') return currentUser();
  if (where !== openFolder) reset('no-folder');
  openFolder = where;
  if (!db) {
    db = createDb({
      storage: folder.storage(),
      who,
      canWrite: writable,
      now: () => new Date(),
      record: typeof window !== 'undefined' && Boolean(window.__rcRecord),
    });
    db.onChange(() => {
      refreshPerson().catch(() => {});
      ring();
    });
  }
  try {
    const manifest = await db.manifest();
    if (!manifest) {
      state = 'empty';
      problem = null;
      emit(EV.RC_AUTH_CHANGED, { user: null, event: 'EMPTY' });
      return null;
    }
    state = 'open';
    problem = null;
  } catch (err) {
    state = 'failed';
    problem = err;
    emit(EV.RC_AUTH_CHANGED, { user: null, event: 'FAILED' });
    return null;
  }
  await refreshPerson();
  startPolling();
  emit(EV.RC_AUTH_CHANGED, { user: currentUser(), event: 'OPENED' });
  return currentUser();
}

/**
 * Join the queue for the pen — called when somebody opens the calendar, not
 * when the timeline reads the look-ahead. Reading the calendar never needs
 * it; only writing does, so somebody who only ever uses the timeline is never
 * shown to a colleague as editing the calendar.
 */
export async function enterCalendar() {
  await init();
  if (state !== 'open') return null;
  await folder.startPen();
  return folder.penState();
}

function reset(next) {
  folder.stopPen();
  clearInterval(pollTimer);
  pollTimer = null;
  db = null;
  person = null;
  state = next;
  openFolder = '';
}

/** Look for another computer's saves while the calendar is open and on screen. */
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!db || state !== 'open') return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    db.refresh().catch(() => {});
    if (db.unsaved()) db.retry().catch(() => {});
  }, POLL_MS);
}

// Another folder is another calendar; and the name set later is who we are.
if (typeof window !== 'undefined') {
  on(EV.FILE_STATE, (st) => {
    // Nothing has asked for the calendar yet: nothing to follow.
    if (!db && state === 'no-folder' && !asked) return;
    if ((st?.folder || '') !== openFolder) {
      const hadPen = folder.penState().role !== null;
      reset('no-folder');
      init()
        .then(() => (hadPen ? enterCalendar() : null))
        .then(() => emit(EV.RC_AUTH_CHANGED, { user: currentUser(), event: 'FOLDER' }));
    }
  });
  window.addEventListener('beforeunload', () => folder.stopPen());
}

/** Read the name in the application again — after somebody sets it. */
export async function refreshMe() {
  await refreshPerson();
  emit(EV.RC_AUTH_CHANGED, { user: currentUser(), event: 'ROLE_CHANGED' });
  return person;
}

/**
 * Start a calendar in this folder: an empty one, or everything from a backup
 * of the old calendar (`core/rc_import.js` turns the backup into rows).
 *
 * @param {Record<string, any[]>} [tables]
 * @param {{ source?: string, replace?: boolean }} [options]
 */
export async function createCalendar(tables = {}, { source = 'new', replace = false } = {}) {
  if (!filestore.hasFolder()) throw new Error('Open the shared folder first.');
  await init();
  if (!db) throw new Error('The folder could not be opened.');
  // Nobody else is writing a calendar that does not exist yet.
  await folder.startPen();
  if (!folder.holdsPen() && !replace) await folder.takePen();
  await db.create(tables, { source, replace });
  state = 'open';
  problem = null;
  await refreshPerson();
  startPolling();
  emit(EV.RC_AUTH_CHANGED, { user: currentUser(), event: 'CREATED' });
}

/** The database itself — for the tests, which count what was asked and read the rows. */
export function debugDb() {
  return db;
}

/* ── Reading ───────────────────────────────────────────────────────────── */

function requireDb() {
  if (!db || state !== 'open') throw new Error('No calendar is open — open the shared folder first.');
}

/**
 * Every read goes through here so a failure has one shape. Answers are read
 * from memory once a file has been read, so there is nothing to remember
 * between tabs: `forgetReads()` survives only for the callers that still say it.
 */
async function select(table, build, { columns = '*' } = {}) {
  requireDb();
  let query = db.from(table).select(columns);
  if (build) query = build(query);
  const { data, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || [];
}

/** The same, for a question that once had to be paged. */
const selectAll = (table, build) => select(table, build);

/**
 * Forget what was derived from the tables — the views, which are remembered
 * until the next change. Nothing else is remembered between reads.
 */
export function forgetReads() {
  db?.invalidate();
}

export function listPeople({ includeInactive = false, scheduledOnly = false } = {}) {
  return select('rc_people', (q) => {
    let out = includeInactive ? q : q.eq('active', true);
    if (scheduledOnly) out = out.eq('scheduled', true);
    return out.order('name');
  });
}

export function listLocations({ includeInactive = false } = {}) {
  return select('rc_locations', (q) => (includeInactive ? q : q.eq('active', true)).order('name'));
}

export function listLocationAliases() {
  return select('rc_location_alias', (q) => q.order('alias'));
}

/** The other spellings of a person, for matching the look-ahead's Resource row. */
export function listPersonAliases() {
  return select('rc_person_alias', (q) => q.order('alias'));
}

export function listCategories({ includeInactive = false } = {}) {
  return select('rc_categories', (q) => (includeInactive ? q : q.eq('active', true)).order('sort'));
}

export function listParties() {
  return select('rc_parties', (q) => q.eq('active', true).order('name'));
}

/**
 * The legend the look-ahead's colours are read against. Versioned by
 * `valid_from`, newest first, so a caller taking the first entry for a colour
 * gets the one in force.
 */
export function listLegend({ includeInactive = false } = {}) {
  return select('rc_legend', (q) =>
    (includeInactive ? q : q.eq('active', true)).order('valid_from', { ascending: false }));
}

/**
 * Everything, as one file, in the shape the old calendar's backup had — so a
 * copy taken here can be put back into an empty folder by the same importer.
 */
export async function exportEverything() {
  requireDb();
  const out = {
    format: FORMAT,
    exported_at: new Date().toISOString(),
    exported_by: accountLabel() || null,
    note: 'Every table of the resource calendar. BART\'s blank TAWR form is under files, as base64.',
    tables: {},
  };
  for (const table of TABLE_NAMES) out.tables[table] = await select(table);
  const form = await folder.readBytes('tawr/template.pdf');
  if (form) {
    let binary = '';
    for (let i = 0; i < form.length; i += 0x8000) binary += String.fromCharCode(...form.subarray(i, i + 0x8000));
    out.files = { 'tawr/template.pdf': btoa(binary) };
  }
  return out;
}

/* ── The look-ahead, edited here ───────────────────────────────────────── */

export function listLaRows() {
  return selectAll('rc_la_rows', (q) => q.order('sort').order('id'));
}

/** The cells between two dates, both inclusive. */
export function listLaCells(fromISO, toISO) {
  return selectAll('rc_la_cells', (q) => q.gte('day', fromISO).lte('day', toISO).order('day').order('row_id'));
}

/** The first and last day anything is written on the look-ahead, or null days. */
export async function laCellSpan() {
  const edge = (ascending) => select('rc_la_cells', (q) => q.order('day', { ascending }).limit(1), { columns: 'day' })
    .then((rows) => (rows[0]?.day ? String(rows[0].day).slice(0, 10) : null));
  const [first, last] = await Promise.all([edge(true), edge(false)]);
  return { first, last };
}

/**
 * Apply a batch of look-ahead ops (see `core/la_edit.js`), all or nothing.
 * Answers with the version each op made; a stale op refuses the whole batch
 * with a message starting "conflict:".
 */
export const applyLookaheadOps = (ops) => rpc('rc_la_apply', { p_ops: ops });

/**
 * Look in the folder for another computer's saves now, rather than at the next
 * poll — when the window gets the focus back, say. Answers whether anything
 * changed; the bell rings if it did.
 */
export function checkFolder() {
  return db && state === 'open' ? db.refresh().catch(() => false) : Promise.resolve(false);
}

/** The newest change anybody has made, as a number. */
export async function lookaheadRevision() {
  requireDb();
  const { data, error } = await db.rpc('rc_la_revision', {});
  if (error) throw new Error(`rc_la_revision: ${error.message}`);
  return Number(data) || 0;
}

/* ── The bell: told when the look-ahead changes ───────────────────────────
   Rung by the database when an edit is logged or a reading taken here, and
   when the folder brings down another computer's save. A listener asks what
   changed, exactly as its poll does. */

const bellListeners = new Set();

function ring() {
  for (const fn of [...bellListeners]) {
    try { fn(); } catch (err) { console.warn('[cx-timeline] a look-ahead listener failed:', err); }
  }
}

/** Call `fn` whenever the look-ahead changes. Answers with the function that stops it. */
export function onLookaheadChange(fn) {
  bellListeners.add(fn);
  return () => bellListeners.delete(fn);
}

/** True while the calendar is open: the folder is watched, so the polls may slow down. */
export function lookaheadLive() {
  return state === 'open';
}

/** The edit log, newest first: the last `limit` changes, or every change from `sinceId` on. */
export function listLaEdits({ sinceId = null, limit = 2000 } = {}) {
  if (sinceId != null) return selectAll('rc_la_edits', (q) => q.gte('id', sinceId).order('id', { ascending: false }));
  return select('rc_la_edits', (q) => q.order('id', { ascending: false }).limit(limit));
}

/** Every edit made in a span of time, oldest first. */
export function listLaEditsBetween(fromISO, toISO) {
  return selectAll('rc_la_edits', (q) => q.gte('at', fromISO).lte('at', toISO).order('id'));
}

/** Everything the log says about one row and its days, newest first. */
export function listLaEditsForRow(rowId) {
  return select('rc_la_edits', (q) => q.eq('row_id', rowId).order('id', { ascending: false }).limit(1000));
}

/** Slim the grids of superseded editor readings past the keep period, and say how many. */
export const compactSnapshots = () => rpc('rc_compact_snapshots', {});

/** One reading's stored rows. */
export function snapshotRows(snapshotId) {
  return selectAll('rc_lookahead_rows', (q) => q.eq('snapshot_id', snapshotId).order('id'));
}

export function listSupportCodes({ includeRetired = false } = {}) {
  return select('rc_support_codes', (q) => (includeRetired ? q.order('sort').order('code') : q.eq('active', true).order('sort').order('code')));
}
export const addSupportCode = (row) => insert('rc_support_codes', [row]).then((r) => r[0]);
export const updateSupportCode = (id, patch) => update('rc_support_codes', id, patch);

/* ── P6 activities, for the look-ahead's rows to name ─────────────────── */

export function listP6Activities() {
  return selectAll('rc_p6_activities', (q) => q.order('activity_id'));
}

/** The activities a reading names, by ID. */
export async function p6ActivitiesByIds(ids) {
  const want = [...new Set((ids || []).filter(Boolean))];
  if (!want.length) return [];
  return select('rc_p6_activities', (q) => q.in('activity_id', want), { columns: 'activity_id,name,wbs,missing' });
}

/** Why a row has no P6 activity: the list a row is flagged from. */
export function listP6Flags({ includeRetired = false } = {}) {
  return select('rc_p6_flags', (q) => (includeRetired ? q : q.eq('active', true)).order('sort').order('label'));
}
export const addP6Flag = (row) => insert('rc_p6_flags', [row]).then((r) => r[0]);
export const updateP6Flag = (id, patch) => update('rc_p6_flags', id, patch);

/**
 * Import an extract's activities through `rc_p6_import()`, in batches that
 * share one import id, the last of which marks every activity the extract
 * left out as missing.
 *
 * @param {Array<{ activity_id: string, name?: string, wbs?: string }>} activities
 * @param {{ importId: string, batch?: number }} options
 */
export async function importP6Activities(activities, { importId, batch = 1000 }) {
  if (!activities?.length) throw new Error('There are no activities to import.');
  let written = 0;
  let missing = 0;
  for (let i = 0; i < activities.length; i += batch) {
    const done = await rpc('rc_p6_import', {
      p_import: importId,
      p_rows: activities.slice(i, i + batch),
      p_finish: i + batch >= activities.length,
    });
    written += Number(done?.written) || 0;
    missing += Number(done?.missing) || 0;
  }
  return { written, missing };
}

/* ── Problems ──────────────────────────────────────────────────────────── */

const reported = new Set();

/**
 * Say a failure in the console, once per message. There is nowhere else to
 * send it: the calendar has no server, and nothing leaves this computer.
 */
export function reportError(area, err) {
  try {
    const message = String(err?.message || err || 'unknown').slice(0, 500);
    const key = `${area}\u0000${message}`;
    if (reported.has(key)) return;
    reported.add(key);
    console.warn(`[cx-timeline] calendar (${area}):`, message);
  } catch {
    /* reporting a failure must never be a second one */
  }
}

export function listSettings() {
  return select('rc_settings');
}

export function listLeaveKinds() {
  return select('rc_leave_kinds', (q) => q.eq('active', true).order('name'));
}

/** Leave overlapping a window. Both ends are inclusive, as a calendar is. */
export function listLeave(fromISO, toISO) {
  return select('rc_leave', (q) =>
    q.lte('start_date', toISO).gte('end_date', fromISO).neq('status', 'cancelled'));
}

/** Look-ahead rows by id. */
export async function lookaheadRowsByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return [];
  return select('rc_lookahead_rows', (q) => q.in('id', unique), { columns: 'id,raw_label,raw_location,snapshot_id,sheet_row' });
}

export function listIngestRuns({ limit = 100 } = {}) {
  return select('rc_ingest_runs', (q) => q.order('ran_at', { ascending: false }).limit(limit));
}

/** The readings, newest first, **without their grids**. */
export function listSnapshotMeta({ limit = 50 } = {}) {
  return select('rc_lookahead_snapshot_meta', (q) => q.order('taken_at', { ascending: false }).limit(limit));
}

/** Those readings' metadata, by id. */
export async function snapshotMetaByIds(ids) {
  const want = [...new Set((ids || []).filter(Boolean))];
  if (!want.length) return [];
  return select('rc_lookahead_snapshot_meta', (q) => q.in('id', want));
}

/** The newest reading with its grid, or null. The only full-grid read there is. */
export function latestSnapshot() {
  return select('rc_lookahead_snapshots', (q) => q.order('taken_at', { ascending: false }).limit(1))
    .then((rows) => rows[0] || null);
}

/** The newest reading's id, asked afresh. */
export async function newestSnapshotId() {
  const rows = await select('rc_lookahead_snapshot_meta', (q) => q.order('taken_at', { ascending: false }).limit(1), { columns: 'id' });
  return rows[0]?.id ?? null;
}

export function listSnapshots({ limit = 1 } = {}) {
  return select('rc_lookahead_snapshots', (q) => q.order('taken_at', { ascending: false }).limit(limit));
}

/** Each week the workbook's readings hold, and the newest of them that has it. */
export function workbookWeeks() {
  return select('rc_lookahead_workbook_weeks', (q) => q.order('week_start'));
}

/** One reading with its grid, by id. */
export function snapshotById(id) {
  return select('rc_lookahead_snapshots', (q) => q.eq('id', id).limit(1)).then((rows) => rows[0] || null);
}

export function listSnapshotRows(snapshotId) {
  return select('rc_lookahead_rows', (q) => q.eq('snapshot_id', snapshotId).order('sheet_row'));
}

export function listChangeEvents(fromISO, toISO) {
  return select('rc_change_events', (q) =>
    q.gte('detected_at', fromISO).lte('detected_at', toISO).order('detected_at', { ascending: false }));
}

export function listAnnotations(eventIds) {
  return select('rc_change_annotations', (q) => q.in('change_event_id', eventIds).order('created_at'));
}

/** Every day the look-ahead currently shows cancelled, from `fromISO` on. */
export function listCancelledDays(fromISO) {
  return select('rc_cancelled_days', (q) => q.gte('day', fromISO).order('day'));
}

/** Every day a BART resource is struck out on an activity still going ahead. */
export function listCancelledSupportDays(fromISO) {
  return select('rc_cancelled_support_days', (q) => q.gte('day', fromISO).order('day'));
}

/** What somebody said about a cancellation, every version. Newest last. */
export function listCancellationNotes() {
  return select('rc_cancellation_notes', (q) => q.order('created_at'));
}

/**
 * Look-ahead rows across a span of weeks, from every reading — the caller
 * keeps the newest per week.
 */
export function lookaheadBetween(fromISO, toISO) {
  return select('rc_lookahead_rows', (q) =>
    q.gte('week_start', fromISO).lte('week_start', toISO).order('sheet_row'));
}

/** The look-ahead day by day, each week from the newest reading of it. */
export function lookaheadDays(fromISO = null, toISO = null) {
  return selectAll('rc_lookahead_days', (q) => {
    let out = q;
    if (fromISO) out = out.gte('day', fromISO);
    if (toISO) out = out.lte('day', toISO);
    return out.order('day').order('row_id');
  });
}

/** Every row of a table or view, optionally where `column` falls between two dates. */
export function readAll(table, { column = null, from = null, to = null } = {}) {
  const key = { rc_settings: 'key', rc_tawr_settings: 'key', rc_tawr_profiles: 'person_id', rc_p6_activities: 'activity_id' }[table] || 'id';
  return selectAll(table, (q) => {
    let out = q;
    if (column && from) out = out.gte(column, from);
    if (column && to) out = out.lte(column, to);
    if (column) out = out.order(column);
    return out.order(key);
  });
}

/* ── Writing ───────────────────────────────────────────────────────────── */

async function insert(table, rows) {
  requireDb();
  const { data, error } = await db.from(table).insert(rows).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  folder.noteWrite();
  return data || [];
}

async function rpc(name, args) {
  requireDb();
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  if (name !== 'rc_resolve_location' && name !== 'rc_la_revision') folder.noteWrite();
  return data;
}

/**
 * Update reference data. An update that matched nothing reports success in
 * the builder, so this checks the rows that came back and raises instead.
 */
async function update(table, id, patch) {
  requireDb();
  const key = { rc_settings: 'key', rc_tawr_settings: 'key', rc_tawr_profiles: 'person_id' }[table] || 'id';
  const { data, error } = await db.from(table).update(patch).eq(key, id).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  if (!data || !data.length) throw new Error(`${table}: that change was not made — it may have been removed.`);
  folder.noteWrite();
  return data[0];
}

async function upsert(table, rows, onConflict) {
  requireDb();
  const { data, error } = await db.from(table).upsert(rows, { onConflict }).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  folder.noteWrite();
  return data || [];
}

export const addPerson = (row) => insert('rc_people', [row]).then((r) => r[0]);
export const updatePerson = (id, patch) => update('rc_people', id, patch);
export const addLocation = (row) => insert('rc_locations', [row]).then((r) => r[0]);
export const updateLocation = (id, patch) => update('rc_locations', id, patch);
export const addLocationAlias = (locationId, alias) =>
  insert('rc_location_alias', [{ location_id: locationId, alias }]).then((r) => r[0]);
export const addPersonAlias = (personId, alias) =>
  insert('rc_person_alias', [{ person_id: personId, alias }]).then((r) => r[0]);
export const addCategory = (row) => insert('rc_categories', [row]).then((r) => r[0]);
export const updateCategory = (id, patch) => update('rc_categories', id, patch);
export const addParty = (name) => insert('rc_parties', [{ name }]).then((r) => r[0]);
export const addLeaveKind = (row) => insert('rc_leave_kinds', [row]).then((r) => r[0]);
export const updateLeaveKind = (id, patch) => update('rc_leave_kinds', id, patch);

/**
 * Map colours, or re-map them — an upsert on `(valid_from, argb)`, because
 * mapping the same colour twice in one day is the commonest thing anybody
 * does here. A colour mapped again on a later day gets a row of its own.
 */
export const addLegend = (rows) => upsert('rc_legend', rows, 'valid_from,argb');
export const updateLegend = (id, patch) => update('rc_legend', id, patch);

/** Delete a reference row where nothing has been recorded against it; retire it otherwise. */
export const deletePerson = (id) => rpc('rc_delete_person', { p_person: id });
export const deleteLocation = (id) => rpc('rc_delete_location', { p_location: id });
export const deleteCategory = (id) => rpc('rc_delete_category', { p_category: id });
export const deleteLegend = (id) => rpc('rc_delete_legend', { p_entry: id });

/** Write a setting — an upsert, because the first time there is no row to update. */
export async function setSetting(key, value) {
  const rows = await upsert('rc_settings', { key, value, updated_at: new Date().toISOString() }, 'key');
  return rows[0];
}

/** Book leave. Everybody with the application books it; nobody asks. */
export const addLeave = (row) => insert('rc_leave', [{ status: 'approved', ...row }]).then((r) => r[0]);
export const updateLeave = (id, patch) => update('rc_leave', id, patch);

export const resolveLocation = (raw) => rpc('rc_resolve_location', { p_raw: raw });

export const addIngestRun = (row) => insert('rc_ingest_runs', [row]).then((r) => r[0]);
export const addSnapshot = (row) => insert('rc_lookahead_snapshots', [row]).then((r) => r[0]);
export const addSnapshotRows = (rows) => insert('rc_lookahead_rows', rows);
export const addChangeEvents = (rows) => insert('rc_change_events', rows);

/**
 * Annotate a change event. Insert only: correcting one means adding another
 * that supersedes it, because this is the record a delay claim is built on.
 */
export const addAnnotation = (row) => insert('rc_change_annotations', [row]).then((r) => r[0]);

/** Replace what a stored row says each day was painted as — a re-derivation under today's rules. */
export const updateLookaheadRowCells = (id, cells) => update('rc_lookahead_rows', id, { cells });

/** Log what somebody said about a cancellation. Append-only: a correction supersedes. */
export const addCancellationNote = (row) => insert('rc_cancellation_notes', [row]).then((r) => r[0]);

/* ── Track access work requests ──────────────────────────────────────────── */

/** The live requests (drafts and approved) for one week, by its Monday. */
export function listTawrs(weekStartISO) {
  return select('rc_tawrs', (q) => q.eq('week_start', weekStartISO).neq('status', 'superseded').order('created_at'));
}

/** Every live request from a Monday on. */
export function listTawrsFrom(fromISO) {
  return select('rc_tawrs', (q) => q.gte('week_start', fromISO).neq('status', 'superseded').order('week_start'));
}

export const addTawr = (row) => insert('rc_tawrs', [row]).then((r) => r[0]);
export const updateTawr = (id, patch) => update('rc_tawrs', id, patch);

/** Throw a draft away. An approved request cannot be: the delete matches nothing, and this says so. */
export async function discardTawr(id) {
  requireDb();
  const { data, error } = await db.from('rc_tawrs').delete().eq('id', id).select();
  if (error) throw new Error(`rc_tawrs: ${error.message}`);
  if (!data || !data.length) throw new Error('That request was not discarded — only a draft can be.');
  folder.noteWrite();
  return data[0];
}

/** Supersede an approved request with a draft carrying its fields; answers the draft's id. */
export const reviseTawr = (id) => rpc('rc_tawr_revise', { p_tawr: id });

export function listTawrSettings() {
  return select('rc_tawr_settings');
}

export async function setTawrSetting(key, value) {
  const rows = await upsert('rc_tawr_settings', { key, value, updated_at: new Date().toISOString() }, 'key');
  return rows[0];
}

/** Every requestor's details and signature. */
export function listTawrProfiles() {
  return select('rc_tawr_profiles');
}

/** Save your own requestor details and signature. */
export async function saveTawrProfile(patch) {
  const who = me();
  if (!who) throw new Error('No calendar is open.');
  const rows = await upsert('rc_tawr_profiles', { ...patch, person_id: who.id, updated_at: new Date().toISOString() }, 'person_id');
  return rows[0];
}

export function listTawrDescriptions() {
  return select('rc_tawr_descriptions', (q) => q.order('activity'));
}
export const addTawrDescription = (row) => insert('rc_tawr_descriptions', [row]).then((r) => r[0]);
export const updateTawrDescription = (id, patch) => update('rc_tawr_descriptions', id, { ...patch, updated_at: new Date().toISOString() });

export async function deleteTawrDescription(id) {
  requireDb();
  const { data, error } = await db.from('rc_tawr_descriptions').delete().eq('id', id).select();
  if (error) throw new Error(`rc_tawr_descriptions: ${error.message}`);
  if (!data || !data.length) throw new Error('That wording was not removed.');
  folder.noteWrite();
  return data[0];
}

const TAWR_TEMPLATE = 'tawr/template.pdf';

/** Put BART's blank form in the calendar's folder, replacing the one there. */
export async function uploadTawrTemplate(blob) {
  requireDb();
  const allowed = writable();
  if (allowed !== true) throw new Error(allowed);
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(await blob.arrayBuffer());
  await folder.writeBytes(TAWR_TEMPLATE, bytes);
  folder.noteWrite();
  return TAWR_TEMPLATE;
}

/** BART's blank form, as bytes; null when none has been put in the folder. */
export async function downloadTawrTemplate() {
  requireDb();
  return folder.readBytes(TAWR_TEMPLATE);
}
