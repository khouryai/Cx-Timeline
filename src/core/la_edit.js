/**
 * The look-ahead, edited in the application rather than in Excel.
 *
 * The workbook used to be the source of truth and the calendar read it. Now the
 * calendar *is* the source: two administrators edit rows and cells here, and
 * an Excel file is something the calendar produces for whoever copies the rows
 * into the project's master look-ahead. This module is the whole of that model
 * with nothing attached — no DOM, no network — so every rule in it is tested in
 * Node (`tools/test_lookahead.js`).
 *
 * The model is two lists, mirroring the two tables in `rc_schema.sql`:
 *
 *   rows   { id, kind, parent_id, sort, level, activity_id, description,
 *            location, sswp, party, work_hours, absence_kind, archived, version }
 *   cells  { row_id, day, color, text, version }       (keyed `row_id|day`)
 *
 * `kind` is one of four things a row on the 4WLA has always been:
 *
 *   section   a heading band ("W40 — Testing and Commissioning")
 *   activity  a line of work, painted by day, with the support it needs typed
 *             in the cell ("X.WIT")
 *   resource  the names under an activity — `parent_id` is that activity, and
 *             it moves with it
 *   absence   a PTO / Office / Other group row of names, belonging to nobody
 *
 * **The editor publishes the same shape the workbook used to produce.**
 * `gridFromModel()` writes a grid exactly as `parseSheet()` would have read it
 * from an .xlsx — heading row, month band, day numbers, weekday letters, then
 * the rows — so the calendar, the week plan, the huddle, PTO, the cancellation
 * log and the change register all keep reading what they always read. Nothing
 * downstream had to learn that the workbook went away.
 *
 * Every edit is an *op*, and every op has an inverse (`applyOps()` returns it),
 * which is the whole of undo. The same ops go to the database through
 * `rc_la_apply()`, stamped with the versions they expect (`stamp()`), so two
 * people changing one cell at once get a refusal rather than a silent winner.
 *
 * Imports: core/lookahead (a leaf).
 */

import { absenceKind, ABSENCE_LABELS } from './lookahead.js';

/* ══════════════════════════════════════════════════════════════════════════
   Days
   ═══════════════════════════════════════════════════════════════════════ */

const MS_DAY = 86400000;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAY_LETTERS = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];

/** The editor shows four weeks by default and five at most. */
export const WINDOW_WEEKS = [4, 5];

const isoMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const msIso = (ms) => new Date(ms).toISOString().slice(0, 10);

export function addDaysISO(iso, n) {
  return msIso(isoMs(iso) + n * MS_DAY);
}

/** The Monday on or before a date. */
export function mondayOf(iso) {
  const dow = new Date(isoMs(iso)).getUTCDay();
  return addDaysISO(iso, -((dow + 6) % 7));
}

/** Seven days a week for `weeks` weeks, from the Monday of `fromISO`. */
export function windowDays(fromISO, weeks = 4) {
  const start = mondayOf(fromISO);
  return Array.from({ length: weeks * 7 }, (_, i) => addDaysISO(start, i));
}

export function isWeekend(iso) {
  const dow = new Date(isoMs(iso)).getUTCDay();
  return dow === 0 || dow === 6;
}

export function weekdayLetter(iso) {
  return WEEKDAY_LETTERS[new Date(isoMs(iso)).getUTCDay()];
}

export function monthLabel(iso) {
  return MONTHS[new Date(isoMs(iso)).getUTCMonth()];
}

/* ══════════════════════════════════════════════════════════════════════════
   Rows
   ═══════════════════════════════════════════════════════════════════════ */

export const KINDS = ['section', 'activity', 'resource', 'absence'];

/** The six columns left of the calendar, in the order the 4WLA prints them. */
export const FIELDS = [
  { key: 'activity_id', heading: 'Activity ID', width: 20.5703125 },
  { key: 'description', heading: 'Description of Work Activity', width: 57.140625 },
  { key: 'location', heading: 'Location', width: 28.5703125 },
  { key: 'sswp', heading: 'SSWP#', width: 8.140625 },
  { key: 'party', heading: 'Party to Action', width: 8.140625 },
  { key: 'work_hours', heading: 'Work Hours', width: 15.5703125 },
];

export function blankRow(kind, extra = {}) {
  return {
    id: extra.id || newId(),
    kind,
    parent_id: null,
    sort: 0,
    level: 0,
    activity_id: '',
    description: kind === 'resource' ? 'Resource' : '',
    location: '',
    sswp: '',
    party: '',
    work_hours: '',
    absence_kind: null,
    archived: false,
    version: 0,
    ...extra,
  };
}

/** A uuid made here, so a row exists — and can be undone — before the server has it. */
export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

/**
 * The rows in the order the sheet shows them.
 *
 * Top-level rows by `sort`, and each activity followed by its Resource rows —
 * so moving an activity carries its names with it without anybody having to
 * move them too, which is the mistake the workbook invited every week.
 */
export function orderedRows(rows, { archived = false } = {}) {
  const live = rows.filter((r) => archived || !r.archived);
  const bySort = (a, b) => (a.sort - b.sort) || String(a.id).localeCompare(String(b.id));
  const children = new Map();
  for (const r of live) {
    if (r.kind === 'resource' && r.parent_id) {
      if (!children.has(r.parent_id)) children.set(r.parent_id, []);
      children.get(r.parent_id).push(r);
    }
  }
  const top = live.filter((r) => !(r.kind === 'resource' && r.parent_id && live.some((p) => p.id === r.parent_id)));
  const out = [];
  for (const r of top.sort(bySort)) {
    out.push(r);
    for (const c of (children.get(r.id) || []).sort(bySort)) out.push(c);
  }
  return out;
}

/**
 * A section and everything under it, as indexes into `ordered`.
 *
 * Down to the next section at the same level or above. That is what "the rows
 * in this section" has always meant on the sheet, and it is what moving,
 * collapsing and deleting a section act on.
 */
export function sectionBlock(ordered, index) {
  const head = ordered[index];
  if (!head || head.kind !== 'section') return [index, index];
  let end = index;
  for (let i = index + 1; i < ordered.length; i++) {
    const r = ordered[i];
    if (r.kind === 'section' && (r.level || 0) <= (head.level || 0)) break;
    end = i;
  }
  return [index, end];
}

/** An activity with its Resource rows; any other row alone. */
export function rowBlock(ordered, index) {
  const row = ordered[index];
  if (!row) return [index, index];
  if (row.kind === 'section') return sectionBlock(ordered, index);
  let end = index;
  if (row.kind === 'activity') {
    while (ordered[end + 1]?.kind === 'resource' && ordered[end + 1].parent_id === row.id) end++;
  }
  return [index, end];
}

/**
 * A sort key between two neighbours.
 *
 * Plain numbers, midpoints between them. A thousand inserts at one spot would
 * run out of precision, which is what `respace()` is for — the editor calls it
 * when two neighbours come within a hair of each other.
 */
export function sortBetween(before, after) {
  if (before == null && after == null) return 1024;
  if (before == null) return after - 1024;
  if (after == null) return before + 1024;
  return (before + after) / 2;
}

export function needsRespace(ordered) {
  const top = ordered.filter((r) => r.kind !== 'resource');
  for (let i = 1; i < top.length; i++) {
    if (Math.abs(top[i].sort - top[i - 1].sort) < 1e-6) return true;
  }
  return false;
}

/** Evenly spaced sort keys for every top-level row, as ops. */
export function respace(ordered) {
  let n = 0;
  const ops = [];
  for (const r of ordered) {
    if (r.kind === 'resource') continue;
    n += 1024;
    if (r.sort !== n) ops.push({ op: 'row', id: r.id, set: { sort: n } });
  }
  return ops;
}

/**
 * The rows worth printing for a window of days, in sheet order.
 *
 * An activity with a colour, a code or a name on one of those days — its own
 * cells or its Resource row's — with its Resource rows whatever they hold,
 * because the pair is one thing on the sheet; the sections that have such an
 * activity under them, nested sections included; and the PTO / Office / Other
 * group rows always, because they are the frame the track allocation manager
 * copies. This is what "only the current data" means for the export.
 */
export function rowsWithWork(model, days) {
  const ordered = orderedRows(model.rows);
  const inDays = new Set(days);
  const busy = new Set(cellList(model).filter((c) => inDays.has(c.day) && (c.text || c.color)).map((c) => c.row_id));
  const keep = new Array(ordered.length).fill(false);
  let liveBelow = false;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const r = ordered[i];
    if (r.kind === 'resource') continue;
    if (r.kind === 'absence') { keep[i] = true; continue; }
    if (r.kind === 'activity') {
      const kids = ordered.filter((k) => k.kind === 'resource' && k.parent_id === r.id);
      keep[i] = busy.has(r.id) || kids.some((k) => busy.has(k.id));
      if (keep[i]) liveBelow = true;
      continue;
    }
    keep[i] = liveBelow || (ordered[i + 1]?.kind === 'section' && keep[i + 1]);
    liveBelow = false;
  }
  return ordered.filter((r, i) => (r.kind === 'resource'
    ? keep[ordered.findIndex((p) => p.id === r.parent_id)]
    : keep[i]));
}

/* ══════════════════════════════════════════════════════════════════════════
   Support codes
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The support written in one cell: "X.WIT" is an EIC and a BART witness,
 * "X.X" is two EICs.
 *
 * The workbook's own convention, read as it is typed: pieces between dots,
 * spacing ignored, case ignored. A piece nobody has registered is still
 * returned — marked, never dropped and never guessed at, because an unknown
 * code is a request nobody can staff until somebody says what it is.
 */
export function supportTokens(text) {
  return String(text ?? '')
    .split('.')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
}

export function parseSupport(text, codes) {
  const known = new Set((codes || []).filter((c) => c.active !== false).map((c) => String(c.code).toUpperCase()));
  const tokens = supportTokens(text).map((code) => ({ code, known: known.has(code) }));
  return { tokens, unknown: [...new Set(tokens.filter((t) => !t.known).map((t) => t.code))] };
}

/** Tidy what was typed into the form the sheet writes: "x . wit" → "X.WIT". */
export function normaliseSupport(text) {
  const tokens = supportTokens(text);
  return tokens.length ? tokens.join('.') : '';
}

/**
 * How much of each kind of support is asked for.
 *
 * Counted over activity rows only — a Resource row holds names, not codes — and
 * per day, per code; `byRow` gives the same count for each activity across the
 * whole window, which is what the activity's own panel shows.
 */
export function supportTotals(model, days) {
  const daySet = new Set(days);
  const byDay = new Map(days.map((d) => [d, new Map()]));
  const byRow = new Map();
  const kinds = new Map(model.rows.map((r) => [r.id, r]));
  for (const cell of cellList(model)) {
    const row = kinds.get(cell.row_id);
    if (!row || row.kind !== 'activity' || row.archived || !daySet.has(cell.day)) continue;
    for (const code of supportTokens(cell.text)) {
      const day = byDay.get(cell.day);
      day.set(code, (day.get(code) || 0) + 1);
      if (!byRow.has(row.id)) byRow.set(row.id, new Map());
      const r = byRow.get(row.id);
      r.set(code, (r.get(code) || 0) + 1);
    }
  }
  return { byDay, byRow };
}

/** "2 X · 1 WIT", in the order the register lists the codes. */
export function describeCounts(counts, codes) {
  if (!counts || !counts.size) return '';
  const order = (codes || []).map((c) => String(c.code).toUpperCase());
  return [...counts.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a[0].localeCompare(b[0]);
    })
    .map(([code, n]) => `${n} ${code}`)
    .join(' · ');
}

/* ══════════════════════════════════════════════════════════════════════════
   Cancellations, as the log will know them
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The label and location the cancellation log will give this row's days.
 *
 * The log is derived from what is published (`rowsFrom()` → `rc_lookahead_rows`
 * → `rc_cancelled_days`), and a note is matched to an event by exactly these
 * two strings — so a note recorded at the moment somebody paints a day red has
 * to be keyed the way the log will key the event, or it will never be found.
 * `tools/test_la_edit.js` holds this to what `rowsFrom()` actually produces.
 */
export function cancellationKey(row) {
  const meta = metaValues(row);
  return {
    raw_label: meta.filter(Boolean).join(' · '),
    raw_location: row.location || '',
  };
}

/**
 * Runs of consecutive days per row, from a list of `{ row, day }` — "Monday to
 * Wednesday on the IXL row" is one cancellation, as the log counts it.
 */
export function dayRuns(items) {
  const byRow = new Map();
  for (const { row, day } of items) {
    if (!byRow.has(row.id)) byRow.set(row.id, { row, days: new Set() });
    byRow.get(row.id).days.add(day);
  }
  const runs = [];
  for (const { row, days } of byRow.values()) {
    const sorted = [...days].sort();
    let start = sorted[0];
    let prev = sorted[0];
    for (const d of sorted.slice(1)) {
      if (d === addDaysISO(prev, 1)) { prev = d; continue; }
      runs.push({ row, start, end: prev });
      start = d;
      prev = d;
    }
    if (start) runs.push({ row, start, end: prev });
  }
  return runs;
}

/* ══════════════════════════════════════════════════════════════════════════
   Names from the roster
   ═══════════════════════════════════════════════════════════════════════ */

const foldWord = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * What to write for each person on the roster.
 *
 * The sheet is written in first names — "Adam, Jimmy" — and the calendar's
 * name register matches a first name only when exactly one person answers to
 * it. So a suggestion writes the first name where that is unambiguous and the
 * full name where two people share it: what is written is always something the
 * register will place, which is the point of suggesting it.
 */
export function nameChoices(people) {
  const live = (people || []).filter((p) => p && p.name && p.active !== false);
  const firsts = new Map();
  for (const p of live) {
    const first = foldWord(p.name).split(' ')[0];
    firsts.set(first, (firsts.get(first) || 0) + 1);
  }
  return live
    .map((p) => {
      const first = String(p.name).trim().split(/\s+/)[0];
      const unique = firsts.get(foldWord(first)) === 1;
      return { insert: unique ? first : String(p.name).trim(), full: String(p.name).trim() };
    })
    .sort((a, b) => a.insert.localeCompare(b.insert));
}

/** The name being typed: whatever follows the last separator. */
export function currentToken(text) {
  const pieces = String(text ?? '').split(/,|\/|&|\+|\n|\band\b/i);
  return pieces[pieces.length - 1].replace(/^\s+/, '');
}

/**
 * Roster names that fit what is being typed, best first — a first name or a
 * surname starting with it — leaving out anybody already in the cell.
 */
export function suggestNames(text, choices, limit = 6) {
  const token = foldWord(currentToken(text));
  if (!token) return [];
  const already = new Set(String(text ?? '').split(/[,/&+\n]|\band\b/i).map(foldWord).filter(Boolean));
  const scored = [];
  for (const c of choices || []) {
    if (already.has(foldWord(c.insert)) || already.has(foldWord(c.full))) continue;
    const words = foldWord(c.full).split(' ');
    let score = -1;
    if (foldWord(c.insert).startsWith(token)) score = 0;
    else if (words.some((w) => w.startsWith(token))) score = 1;
    else if (foldWord(c.full).includes(token)) score = 2;
    if (score >= 0) scored.push({ ...c, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.insert.localeCompare(b.insert)).slice(0, limit);
}

/** The cell's text with the name being typed replaced by a chosen one. */
export function acceptName(text, insert) {
  const t = String(text ?? '');
  const token = currentToken(t);
  const head = t.slice(0, t.length - token.length);
  return `${head}${head && !/[\s]$/.test(head) ? ' ' : ''}${insert}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   The model and its ops
   ═══════════════════════════════════════════════════════════════════════ */

export const cellKey = (rowId, day) => `${rowId}|${day}`;

export function makeModel(rows = [], cells = []) {
  const map = new Map();
  for (const c of cells) map.set(cellKey(c.row_id, c.day), { ...c });
  return { rows: rows.map((r) => ({ ...r })), cells: map };
}

export function cellList(model) {
  return [...model.cells.values()];
}

export function getCell(model, rowId, day) {
  return model.cells.get(cellKey(rowId, day)) || null;
}

const ROW_FIELDS = ['kind', 'parent_id', 'sort', 'level', 'activity_id', 'description', 'location',
  'sswp', 'party', 'work_hours', 'absence_kind', 'archived'];

/**
 * Apply ops to the model in place, and return the ops that undo them.
 *
 *   { op: 'row', id, set: {…fields} }          create (with `kind`) or change a row
 *   { op: 'delete_row', id }                    remove a row (its cells go with it)
 *   { op: 'cell', row_id, day, color, text }    set a cell; blank both to clear it
 *
 * The inverse of a batch is its ops' inverses in reverse order, so an undo puts
 * back exactly what was there — a deleted activity returns with its cells, its
 * Resource rows and their names, because deleting it was all of those ops.
 */
export function applyOps(model, ops) {
  const inverse = [];
  for (const op of ops) {
    if (op.op === 'row') {
      const at = model.rows.findIndex((r) => r.id === op.id);
      if (at < 0) {
        const row = { ...blankRow(op.set?.kind || 'activity', { id: op.id }), ...op.set, version: 0 };
        model.rows.push(row);
        inverse.push({ op: 'delete_row', id: op.id });
      } else {
        const row = model.rows[at];
        const before = {};
        for (const k of Object.keys(op.set || {})) {
          if (!ROW_FIELDS.includes(k)) continue;
          before[k] = row[k];
        }
        model.rows[at] = { ...row, ...pick(op.set, ROW_FIELDS) };
        inverse.push({ op: 'row', id: op.id, set: before });
      }
    } else if (op.op === 'delete_row') {
      const at = model.rows.findIndex((r) => r.id === op.id);
      if (at < 0) continue;
      const row = model.rows[at];
      // The cells first, so undoing recreates the row before it refills them.
      const cells = cellList(model).filter((c) => c.row_id === op.id);
      for (const c of cells) model.cells.delete(cellKey(c.row_id, c.day));
      model.rows.splice(at, 1);
      const restore = [{ op: 'row', id: row.id, set: pick(row, ROW_FIELDS) }];
      for (const c of cells) restore.push({ op: 'cell', row_id: c.row_id, day: c.day, color: c.color || null, text: c.text || '' });
      inverse.push(...restore.reverse());
    } else if (op.op === 'cell') {
      const key = cellKey(op.row_id, op.day);
      const was = model.cells.get(key) || null;
      const color = op.color ? String(op.color).toUpperCase() : null;
      const text = String(op.text ?? '');
      if (!color && !text) model.cells.delete(key);
      else model.cells.set(key, { row_id: op.row_id, day: op.day, color, text, version: was?.version || 0 });
      inverse.push({ op: 'cell', row_id: op.row_id, day: op.day, color: was?.color || null, text: was?.text || '' });
    }
  }
  return inverse.reverse();
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && k in obj) out[k] = obj[k];
  return out;
}

/**
 * The versions each op expects to find, from the model *before* it is applied.
 *
 * Done at send time rather than when the op was made, because an undo is sent
 * long after it was recorded, against whatever the row has become since.
 */
export function stamp(model, ops) {
  return ops.map((op) => {
    if (op.op === 'cell') return { ...op, expect: getCell(model, op.row_id, op.day)?.version || 0 };
    const row = model.rows.find((r) => r.id === op.id);
    return { ...op, expect: row ? row.version || 0 : 0 };
  });
}

/** Record the versions the server answered with. */
export function acknowledge(model, results) {
  for (const r of results || []) {
    if (r.kind === 'cell') {
      const c = model.cells.get(cellKey(r.row_id, r.day));
      if (c) c.version = r.version;
    } else if (r.kind === 'row') {
      const row = model.rows.find((x) => x.id === r.id);
      if (row) row.version = r.version;
    }
  }
}

/** Ops that delete a row and everything that belongs to it, cells first. */
export function deleteOps(model, ids) {
  const want = new Set(ids);
  for (const r of model.rows) if (r.kind === 'resource' && want.has(r.parent_id)) want.add(r.id);
  const ops = [];
  for (const c of cellList(model)) {
    if (want.has(c.row_id)) ops.push({ op: 'cell', row_id: c.row_id, day: c.day, color: null, text: '' });
  }
  // Children before parents: a Resource row points at its activity.
  const rows = model.rows.filter((r) => want.has(r.id)).sort((a, b) => (b.kind === 'resource') - (a.kind === 'resource'));
  for (const r of rows) ops.push({ op: 'delete_row', id: r.id });
  return ops;
}

/* ══════════════════════════════════════════════════════════════════════════
   Selections: fill and clipboard
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Repeat a block of cells across a larger area, the way Excel's fill handle
 * does: the pattern tiles, so dragging "X.WIT on yellow, blank, blank" along a
 * row repeats it every three days.
 */
export function tile(source, height, width) {
  const h = source.length;
  const w = source[0]?.length || 0;
  if (!h || !w) return [];
  return Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => ({ ...source[r % h][c % w] })));
}

/** A block of `{ color, text }` as tab-separated text, which every spreadsheet reads. */
export function toTSV(block) {
  return block.map((row) => row.map((c) => String(c.text ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n');
}

export function fromTSV(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  return lines.map((line) => line.split('\t').map((t) => ({ color: null, text: t.trim() })));
}

const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The same block as an HTML table, colours included — which is what Excel
 * reads on paste, so painted cells arrive painted.
 */
export function toHTML(block) {
  const rows = block.map((row) => `<tr>${row.map((c) => {
    const bg = c.color ? ` style="background:#${c.color};mso-pattern:#${c.color} none"` : '';
    return `<td${bg}>${escapeHtml(c.text)}</td>`;
  }).join('')}</tr>`).join('');
  return `<table>${rows}</table>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   The published grid — the shape the rest of the calendar reads
   ═══════════════════════════════════════════════════════════════════════ */

/** Spreadsheet column letters. */
export function colLetters(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** The grey the section bands are painted in, on the sheet and on the grid. */
export const SECTION_BAND = 'D9D9D9';

/** Where things go on the sheet — shared by the published grid and the export. */
export const LAYOUT = {
  firstMetaCol: 2, // B
  firstDayCol: 8, // H
  titleRow: 1,
  headingRow: 2, // B2:B6 … G2:G6, merged
  monthRow: 4,
  dayRow: 5,
  weekdayRow: 6,
  firstBodyRow: 7,
};

/**
 * The model as a parsed workbook.
 *
 * Laid out as the 4WLA is — headings on row 2, the month band on 4, day numbers
 * on 5, weekday letters on 6, rows from 7 — so `readGrid()` finds it exactly the
 * way it found the file: by the weekday letters, not by a column number. A
 * section band is painted across its six activity columns, which is how
 * `readGrid()` has always told a heading from work, and never across the days,
 * where paint would read as a shift.
 */
export function gridFromModel(model, days, { title = '' } = {}) {
  const L = LAYOUT;
  const rows = [];
  const cell = (row, col, value, hex = null) => ({ col, ref: `${colLetters(col)}${row}`, value: value ?? '', hex });
  const merges = [];

  rows.push({ row: L.titleRow, label: '', cells: [cell(L.titleRow, L.firstMetaCol, title)] });
  rows.push({
    row: L.headingRow, label: '',
    cells: FIELDS.map((f, i) => cell(L.headingRow, L.firstMetaCol + i, f.heading)),
  });
  FIELDS.forEach((_, i) => {
    const col = colLetters(L.firstMetaCol + i);
    merges.push(`${col}${L.headingRow}:${col}${L.weekdayRow}`);
  });

  const monthCells = [];
  let lastMonth = null;
  let runStart = 0;
  days.forEach((d, i) => {
    const m = monthLabel(d);
    if (m !== lastMonth) {
      if (lastMonth !== null && i - 1 > runStart) {
        merges.push(`${colLetters(L.firstDayCol + runStart)}${L.monthRow}:${colLetters(L.firstDayCol + i - 1)}${L.monthRow}`);
      }
      monthCells.push(cell(L.monthRow, L.firstDayCol + i, m));
      lastMonth = m;
      runStart = i;
    }
  });
  if (days.length && days.length - 1 > runStart) {
    merges.push(`${colLetters(L.firstDayCol + runStart)}${L.monthRow}:${colLetters(L.firstDayCol + days.length - 1)}${L.monthRow}`);
  }
  rows.push({ row: L.monthRow, label: '', cells: monthCells });
  rows.push({
    row: L.dayRow, label: '',
    cells: days.map((d, i) => cell(L.dayRow, L.firstDayCol + i, String(Number(d.slice(8, 10))))),
  });
  rows.push({
    row: L.weekdayRow, label: '',
    cells: days.map((d, i) => cell(L.weekdayRow, L.firstDayCol + i, weekdayLetter(d))),
  });

  let r = L.firstBodyRow;
  for (const row of orderedRows(model.rows)) {
    const cells = [];
    const meta = metaValues(row);
    const band = row.kind === 'section' ? SECTION_BAND : null;
    meta.forEach((value, i) => {
      if (value || band) cells.push(cell(r, L.firstMetaCol + i, value, band));
    });
    if (row.kind !== 'section') {
      days.forEach((d, i) => {
        const c = getCell(model, row.id, d);
        if (c && (c.text || c.color)) cells.push(cell(r, L.firstDayCol + i, c.text || '', c.color || null));
      });
    }
    rows.push({ row: r, label: '', cells });
    r++;
  }

  return { sheet: '4WLA', rows, merges, hiddenColumns: [], conditional: [], unknown: [] };
}

/** The six activity-column values a row prints, in `FIELDS` order. */
export function metaValues(row) {
  if (row.kind === 'resource') return ['', 'Resource', '', '', '', ''];
  if (row.kind === 'absence') {
    const label = row.description || ABSENCE_LABELS[row.absence_kind] || 'PTO';
    return ['', label, '', '', '', ''];
  }
  if (row.kind === 'section') return ['', row.description || '', '', '', '', ''];
  return FIELDS.map((f) => String(row[f.key] ?? ''));
}

/* ══════════════════════════════════════════════════════════════════════════
   Starting from the workbook
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Which of the sheet's activity columns is which field.
 *
 * By column where the sheet uses the 4WLA's own columns — B is the Activity ID
 * and G the work hours whatever is filled in, and BART's file hides the heading
 * row, so there is often no heading to read — and by heading otherwise.
 */
function fieldIndexes(headings, metaCols) {
  const cols = metaCols || [];
  if (cols.length && cols.every((c) => c >= LAYOUT.firstMetaCol && c < LAYOUT.firstMetaCol + FIELDS.length)) {
    const out = {};
    FIELDS.forEach((f, i) => {
      const at = cols.indexOf(LAYOUT.firstMetaCol + i);
      if (at >= 0) out[f.key] = at;
    });
    return out;
  }
  return fieldIndexesByHeading(headings);
}

function fieldIndexesByHeading(headings) {
  const tests = {
    activity_id: /activity\s*id/i,
    description: /descr|activity/i,
    location: /location/i,
    sswp: /sswp/i,
    party: /party/i,
    work_hours: /hour/i,
  };
  const out = {};
  const used = new Set();
  for (const key of ['activity_id', 'location', 'sswp', 'party', 'work_hours', 'description']) {
    const i = (headings || []).findIndex((h, idx) => !used.has(idx) && tests[key].test(String(h || '')));
    if (i >= 0) { out[key] = i; used.add(i); }
  }
  FIELDS.forEach((f, pos) => {
    if (out[f.key] == null && !used.has(pos) && pos < (headings || []).length) { out[f.key] = pos; used.add(pos); }
  });
  return out;
}

/**
 * The editor's first contents, from a reading of the old workbook.
 *
 * `view` is `readGrid()` of a legend-applied grid, dated. What comes across is
 * what is still ahead: an activity with a shift, a support code or a name from
 * `fromISO` on; the sections that have such activities under them; the
 * PTO / Office / Other group rows always, because they are the frame of the
 * sheet. The past, the hidden rows and columns and the weekend shading stay
 * behind with the old file.
 *
 * Only paint the legend calls a **shift** is carried — Day, Swing, Night,
 * Blanket, Cancellation — because the editor paints with nothing else. Shading,
 * section bands and colours nobody has named are counted in the report and
 * left behind, never guessed at.
 */
export function modelFromView(view, { fromISO, toISO = null, legend = [] } = {}) {
  const shift = new Map();
  for (const e of legend || []) {
    if ((e.role || 'shift') === 'shift' && e.meaning) shift.set(String(e.argb).toUpperCase(), e.meaning);
  }
  const report = { activities: 0, sections: 0, resources: 0, absences: 0, cells: 0, droppedColours: 0, past: 0 };
  const dayOf = new Map((view.days || []).filter((d) => d.date).map((d) => [d.col, d.date]));
  const inWindow = (date) => date && date >= fromISO && (!toISO || date <= toISO);
  const idx = fieldIndexes(view.headings, view.meta);

  const pending = []; // rows in sheet order, each with its cells
  const cellsOf = (marks, keepColour) => {
    const out = [];
    for (const m of marks || []) {
      const day = dayOf.get(m.col);
      if (!day) continue;
      if (!inWindow(day)) { report.past++; continue; }
      let color = m.hex ? String(m.hex).toUpperCase() : null;
      if (color && (!keepColour || !shift.has(color))) {
        report.droppedColours++;
        color = null;
      }
      const text = String(m.value ?? '').trim();
      if (!color && !text) continue;
      out.push({ day, color, text });
    }
    return out;
  };

  for (const a of view.activities || []) {
    if (a.heading) {
      pending.push({ kind: 'section', description: a.meta.find(Boolean) || '', cells: [] });
      continue;
    }
    if (a.absence) {
      pending.push({
        kind: 'absence',
        absence_kind: a.absence,
        description: a.meta.find((v) => absenceKind(v)) || ABSENCE_LABELS[a.absence],
        cells: cellsOf(a.marks, false),
      });
      continue;
    }
    const fields = {};
    for (const f of FIELDS) fields[f.key] = idx[f.key] != null ? (a.meta[idx[f.key]] || '') : '';
    const cells = cellsOf(a.marks, true);
    const names = a.resource ? cellsOf(a.resource.marks, false) : [];
    pending.push({ kind: 'activity', ...fields, cells, resource: a.resource ? names : null, live: cells.length > 0 || names.length > 0 });
  }

  /* Which sections stay: those with a live activity under them, and a section
     directly above another kept section — the workbook nests "PHASE 2" over
     "W40 — Testing" over "IXL (W40)", and keeping only the innermost would
     orphan the others. Walked backwards, as `drawn()` does. */
  const keep = new Array(pending.length).fill(false);
  let liveBelow = false;
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i];
    if (p.kind === 'activity') {
      keep[i] = p.live;
      if (p.live) liveBelow = true;
    } else if (p.kind === 'absence') {
      keep[i] = true;
    } else {
      keep[i] = liveBelow || (pending[i + 1]?.kind === 'section' && keep[i + 1]);
      liveBelow = false;
    }
  }

  const rows = [];
  const cells = [];
  let sort = 0;
  pending.forEach((p, i) => {
    if (!keep[i]) return;
    sort += 1024;
    const row = blankRow(p.kind, {
      sort,
      description: p.description || '',
      absence_kind: p.absence_kind || null,
    });
    if (p.kind === 'activity') for (const f of FIELDS) row[f.key] = p[f.key] || '';
    rows.push(row);
    report[{ section: 'sections', activity: 'activities', absence: 'absences' }[p.kind]]++;
    for (const c of p.cells) {
      const text = p.kind === 'activity' ? normaliseSupportIfCodes(c.text) : c.text;
      cells.push({ row_id: row.id, day: c.day, color: c.color, text, version: 0 });
    }
    if (p.resource) {
      const res = blankRow('resource', { parent_id: row.id, sort: sort + 1 });
      rows.push(res);
      report.resources++;
      for (const c of p.resource) cells.push({ row_id: res.id, day: c.day, color: null, text: c.text, version: 0 });
    }
  });
  report.cells = cells.length;
  return { model: makeModel(rows, cells), report };
}

/** "X " → "X", "x.wit" → "X.WIT" — but only when it *looks* like codes, so a note survives. */
function normaliseSupportIfCodes(text) {
  const t = String(text).trim();
  return /^[A-Za-z]{1,6}(\s*\.\s*[A-Za-z]{1,6})*\.?$/.test(t) ? normaliseSupport(t) : t;
}
