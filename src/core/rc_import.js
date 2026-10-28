/**
 * The old calendar, brought into the folder.
 *
 * The calendar lived in Supabase until it moved to the shared folder. Its
 * "Back it up" file — `exportEverything()`, every table as rows, BART's blank
 * TAWR form as base64 — is what is read here, once, into an empty folder.
 * Every id is kept, so a cell still points at its row, an edit at what it
 * changed, a reading's rows at the reading, a reason at its cancellation and a
 * TAWR at the request it revised; an account id in `by` or `author` is still
 * named, because a person's roster row still carries the account it had.
 *
 * Only the tables the calendar still keeps come across. The daily huddle, the
 * week plan, the SARs and "Got it" are not carried, and the summary says so,
 * so nobody wonders where they went.
 *
 * Pure — no folder, no DOM — so `tools/test_rc_import.js` holds it in Node.
 *
 * Imports: rc_db.
 */

import { TABLE_NAMES } from './rc_db.js';

/** What the old calendar kept that this one does not, and why it is not needed. */
export const DROPPED = {
  rc_plan_entries: 'the week plan',
  rc_actuals: 'the daily huddle\'s outcomes',
  rc_blockers: 'the huddle\'s blockers',
  rc_blocker_updates: 'the huddle\'s blockers',
  rc_sars: 'SARs',
  rc_sar_links: 'SARs',
  rc_la_seen: 'My day\'s "Got it"',
  rc_client_errors: 'problems reported to the server',
};

const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}(:?\d{2})?|Z)$/;

/**
 * One instant in the one spelling this calendar writes. Postgres answered
 * `2026-10-15T14:02:11.123456+00:00`; this calendar writes `…11.123Z`, and the
 * log is ordered by comparing them as text, so they have to agree.
 */
function normaliseInstant(value) {
  if (typeof value !== 'string' || !INSTANT.test(value)) return value;
  const ms = Date.parse(value.replace(' ', 'T'));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

function normaliseRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = normaliseInstant(v);
  return out;
}

/**
 * Read a backup of the old calendar into rows for `createCalendar()`.
 *
 * Answers `{ tables, files, summary, warnings }`. Throws when the file is not
 * a backup of the calendar at all, and when a table it keeps could not be read
 * when the backup was taken: the calendar is made from this file once, and one
 * made without its readings would hold rows, changes and cancellations that
 * point at nothing — so the answer is a new backup, never an import of this one.
 * Warns, and does not refuse, when it only may be incomplete.
 *
 * @param {any} backup  the parsed JSON
 */
export function readBackup(backup) {
  if (!backup || typeof backup !== 'object' || !backup.tables || typeof backup.tables !== 'object') {
    throw new Error('That file is not a backup of the resource calendar — it has no tables in it.');
  }
  const known = Object.keys(backup.tables).filter((t) => TABLE_NAMES.includes(t) || DROPPED[t]);
  if (!known.length) throw new Error('That file holds no table the calendar knows.');

  const tables = {};
  const summary = [];
  const warnings = [];
  const unread = TABLE_NAMES
    .filter((name) => backup.tables[name] !== undefined && !Array.isArray(backup.tables[name]))
    .map((name) => `${name} (${backup.tables[name]?.error || 'no rows'})`);
  if (unread.length) {
    throw new Error(`This backup is incomplete, so nothing has been written: ${unread.join('; ')} could not be read `
      + 'when it was taken. Take the backup again on the old calendar and import that one.');
  }
  for (const name of TABLE_NAMES) {
    const held = backup.tables[name];
    if (held === undefined) continue;
    tables[name] = held.map(normaliseRow);
    summary.push({ table: name, rows: held.length });
    // PostgREST answered a thousand rows at most, and the backup read each table
    // once until the fix that pages through them.
    if (held.length === 1000) {
      warnings.push(`${name} has exactly 1,000 rows, which is where the old backup stopped. `
        + 'Take a new backup from the old calendar and import that instead.');
    }
  }
  if (!('rc_cancellation_notes' in backup.tables)) {
    warnings.push('This backup has no cancellation reasons in it — it was taken before they were included. '
      + 'Take a new one from the old calendar to keep them.');
  }
  for (const name of Object.keys(backup.tables)) {
    if (!DROPPED[name] || !Array.isArray(backup.tables[name]) || !backup.tables[name].length) continue;
    summary.push({ table: name, rows: backup.tables[name].length, dropped: DROPPED[name] });
  }

  /* A reading's grid can say it was compacted; anything else that is not an
     object is a reading this calendar cannot draw, and is said rather than
     dropped. */
  for (const s of tables.rc_lookahead_snapshots || []) {
    if (s.grid !== null && typeof s.grid !== 'object') {
      warnings.push(`Reading ${s.id} has no grid that can be read.`);
      s.grid = { rows: [], merges: [], hiddenColumns: [], unknown: [], missing: true };
    }
  }

  const files = {};
  const form = backup.files?.['tawr/template.pdf'];
  if (typeof form === 'string' && form) {
    const binary = atob(form);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    files['tawr/template.pdf'] = bytes;
  } else if ((tables.rc_tawrs || []).length) {
    warnings.push('BART\'s blank TAWR form is not in this backup. Put it in under TAWR → Settings before downloading a form.');
  }

  return { tables, files, summary, warnings, exportedAt: backup.exported_at || null, exportedBy: backup.exported_by || null };
}
