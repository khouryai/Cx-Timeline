/**
 * P6 activities for the look-ahead: the schedule's own IDs, read from an
 * extract, searched by name, and what a row's Activity ID says about it.
 *
 * The look-ahead's first column has always been the Activity ID, and the IDs
 * are P6's — typed by hand, when they were typed at all. A row carrying its P6
 * ID can be joined to the schedule and to anything else keyed on it; a row with
 * a typo in it can be joined to nothing, and looks exactly like one that can.
 * So the calendar keeps the schedule's own list (`rc_p6_activities`), imported
 * from whatever extract the scheduler sends, and the editor offers it as the
 * column is typed into.
 *
 * Not every row is in P6. Troubleshooting, a regression run, support for
 * somebody else — real work the schedule does not carry. Those rows say why
 * instead, with a word from a short list (`rc_p6_flags`) written in the same
 * column, so the column always answers one of three ways: a P6 activity, a
 * stated reason, or — marked, never guessed at — neither yet. Several rows may
 * name one activity; one commissioning activity is routinely a week of lines on
 * the sheet.
 *
 * No DOM and no network, so every rule here is tested in Node
 * (`tools/test_la_edit.js`).
 *
 * Imports: nothing (a leaf).
 */

/* ══════════════════════════════════════════════════════════════════════════
   Reading an extract
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Lower case, accents off, everything that is not a letter or a digit one
 * space — so "(*)Activity ID", "activity_id" and "Activity  ID" are one heading,
 * and "Réglage" is found by typing "reglage".
 */
export function foldP6(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The headings each field answers to, folded, most specific first.
 *
 * P6 names a column after whatever the layout called it, and its own
 * spreadsheet export writes the database names above the labels — `task_code`
 * over "Activity ID", `task_name` over "Activity Name". "Activity Code" is left
 * out on purpose: in P6 an activity code is a classification ("Phase", "Area"),
 * and reading one as the ID would link every row to the wrong thing.
 */
const HEADINGS = {
  activity_id: [/^activity id$/, /^act(ivity)? (id|no|number)$/, /^task (id|code)$/, /^id$/],
  name: [/^activity name$/, /^act(ivity)? (name|description|title)$/, /^task name$/, /^description$/, /^name$/],
  wbs: [/^wbs$/, /^wbs (code|path|name|id|short name)$/, /^work breakdown/],
};

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Which column is which: an index per field, or -1. */
export function mapP6Columns(headerRow) {
  const headings = (headerRow || []).map(foldP6);
  const used = new Set();
  /** @type {Object<string, number>} */
  const found = {};
  for (const [field, patterns] of Object.entries(HEADINGS)) {
    found[field] = -1;
    for (const pattern of patterns) {
      const at = headings.findIndex((h, i) => !used.has(i) && pattern.test(h));
      if (at >= 0) {
        found[field] = at;
        used.add(at);
        break;
      }
    }
  }
  return found;
}

/**
 * The header is the first row, within the top twenty-five, with both an ID and
 * a name column. P6 puts a title, a filter description and a blank line above
 * its headings, so the first row is rarely the one.
 */
function findHeader(rows) {
  const limit = Math.min((rows || []).length, 25);
  for (let i = 0; i < limit; i++) {
    const m = mapP6Columns(rows[i]);
    if (m.activity_id >= 0 && m.name >= 0) return i;
  }
  return -1;
}

const isIdHeading = (value) => HEADINGS.activity_id.some((p) => p.test(foldP6(value)));

/**
 * An extract's rows of cells, as activities: `{ activity_id, name, wbs }`.
 *
 * Every activity once, by its ID — the only thing P6 gives that survives a
 * rename. A row with an ID and no name is left out and counted: in a layout
 * exported grouped by WBS those are the group bands, and a P6 activity always
 * has a name. A heading repeated further down (each group's, or the labels P6
 * writes under its field names) is skipped without comment.
 *
 * @returns {{ activities: Array<{ activity_id: string, name: string, wbs: string }>,
 *   headerRow: number, mapping: Object<string, number>, duplicates: string[], unnamed: number,
 *   warnings: string[] }}
 */
export function readP6Rows(rows) {
  const headerRow = findHeader(rows);
  if (headerRow < 0) {
    return {
      activities: [], headerRow, mapping: {}, duplicates: [], unnamed: 0,
      warnings: ['No "Activity ID" and "Activity Name" columns were found in the first 25 rows.'],
    };
  }
  const mapping = mapP6Columns(rows[headerRow]);
  const byId = new Map();
  const duplicates = new Set();
  let unnamed = 0;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const id = clean(row[mapping.activity_id]);
    if (!id || isIdHeading(id)) continue;
    const name = clean(row[mapping.name]);
    if (!name) {
      unnamed++;
      continue;
    }
    if (byId.has(id)) {
      duplicates.add(id);
      continue;
    }
    byId.set(id, { activity_id: id, name, wbs: mapping.wbs >= 0 ? clean(row[mapping.wbs]) : '' });
  }
  const warnings = [];
  if (unnamed) {
    warnings.push(`${unnamed} row${unnamed === 1 ? '' : 's'} with an ID and no name ${unnamed === 1 ? 'was' : 'were'} left out — group headings, most likely.`);
  }
  if (duplicates.size) {
    const some = [...duplicates].slice(0, 3).join(', ');
    warnings.push(`${duplicates.size} ID${duplicates.size === 1 ? '' : 's'} appeared more than once (${some}${duplicates.size > 3 ? '…' : ''}); `
      + 'the first of each was kept. An extract of several projects can repeat an ID.');
  }
  return { activities: [...byId.values()], headerRow, mapping, duplicates: [...duplicates], unnamed, warnings };
}

/**
 * A delimited text file as rows of cells: commas, semicolons or tabs, whichever
 * the first lines use most, with quoted fields as a spreadsheet writes them.
 */
export function splitTable(text) {
  let s = String(text ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const head = s.split(/\r\n|\n|\r/).slice(0, 30);
  const count = (ch) => head.reduce((n, line) => n + line.split(ch).length - 1, 0);
  // Ties go left to right: a tab is never in a name, a comma often is.
  const delimiter = ['\t', ';', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), '\t');
  const sep = count(delimiter) ? delimiter : ',';

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * P6's own export format, a `.xer`: tables of tab-separated records. The
 * activities are the TASK table — `task_code` is the Activity ID, `task_name`
 * its name — and the WBS is written out from PROJWBS as P6 shows its code,
 * every level's short name joined by dots.
 */
export function readXer(text) {
  const tables = new Map();
  let table = null;
  let fields = null;
  for (const line of String(text ?? '').split(/\r\n|\n|\r/)) {
    if (line.startsWith('%T\t')) {
      table = line.slice(3).trim();
      fields = null;
      if (!tables.has(table)) tables.set(table, []);
    } else if (line.startsWith('%F\t')) {
      fields = line.slice(3).split('\t');
    } else if (line.startsWith('%R\t') && table && fields) {
      const values = line.slice(3).split('\t');
      const record = {};
      fields.forEach((f, i) => { record[f] = values[i] ?? ''; });
      tables.get(table).push(record);
    }
  }
  const tasks = tables.get('TASK') || [];
  if (!tasks.length) {
    return {
      activities: [], headerRow: -1, mapping: {}, duplicates: [], unnamed: 0,
      warnings: ['That .xer file has no TASK table, so there are no activities in it.'],
    };
  }
  const wbs = new Map((tables.get('PROJWBS') || []).map((w) => [w.wbs_id, w]));
  const code = (id) => {
    const parts = [];
    const seen = new Set();
    for (let w = wbs.get(id); w && !seen.has(w.wbs_id); w = wbs.get(w.parent_wbs_id)) {
      seen.add(w.wbs_id);
      parts.unshift(w.wbs_short_name || w.wbs_name || '');
    }
    return parts.filter(Boolean).join('.');
  };
  return readP6Rows([
    ['Activity ID', 'Activity Name', 'WBS'],
    ...tasks.map((t) => [t.task_code, t.task_name, code(t.wbs_id)]),
  ]);
}

/**
 * A parsed worksheet (`parseSheet()` in `io/lookahead.js`) as rows of cells,
 * each value at its column — the shape `readP6Rows()` reads.
 */
export function gridRows(grid) {
  return (grid?.rows || [])
    .slice()
    .sort((a, b) => a.row - b.row)
    .map((r) => {
      const out = [];
      for (const c of r.cells || []) out[c.col - 1] = c.value;
      return Array.from(out, (v) => v ?? '');
    });
}

/** What kind of file an extract is, by its name: 'xlsx', 'xer', 'text', or null. */
export function p6FileKind(name) {
  const n = String(name || '').toLowerCase();
  if (/\.(xlsx|xlsm)$/.test(n)) return 'xlsx';
  if (/\.xer$/.test(n)) return 'xer';
  if (/\.(csv|tsv|txt)$/.test(n)) return 'text';
  return null;
}

/**
 * What importing would do to the register, before anything is written:
 * activities new to it, ones whose name or WBS moved, ones a previous extract
 * left out that are back, and ones this extract leaves out — which are marked
 * `missing`, never deleted, because a row of the look-ahead may still name one.
 */
export function p6Diff(register, incoming) {
  const before = new Map((register || []).map((a) => [a.activity_id, a]));
  const present = new Set();
  const added = [];
  const changed = [];
  const back = [];
  let unchanged = 0;
  for (const a of incoming || []) {
    present.add(a.activity_id);
    const was = before.get(a.activity_id);
    if (!was) {
      added.push(a);
      continue;
    }
    if (was.missing) back.push(a);
    if ((was.name || '') !== (a.name || '') || (was.wbs || '') !== (a.wbs || '')) changed.push({ ...a, from: was.name || '' });
    else if (!was.missing) unchanged++;
  }
  const missing = (register || []).filter((a) => !present.has(a.activity_id) && !a.missing);
  return { total: (incoming || []).length, added, changed, back, unchanged, missing };
}

/* ══════════════════════════════════════════════════════════════════════════
   Finding one
   ═══════════════════════════════════════════════════════════════════════ */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The activities that fit what was typed, best first.
 *
 * Every word typed has to be somewhere in the ID, the name or the WBS, in any
 * order — "regression ixl" finds "IXL Regression Testing" — and the ID is also
 * read with its punctuation gone, so "cx1040" finds "CX-1040". Then the ID typed
 * whole, an ID starting with it, a name whose words start with every word
 * typed, and the rest; an activity the latest extract left out comes after all
 * of those, and ties go in the ID's own order. Nothing typed finds nothing:
 * fifteen hundred activities in ID order is not an answer.
 */
export function searchP6(entries, query, { limit = 50 } = {}) {
  const q = foldP6(query);
  const terms = q.split(' ').filter(Boolean);
  if (!terms.length) return [];
  const compactQ = q.replace(/ /g, '');
  const scored = [];
  for (const e of entries || []) {
    const id = foldP6(e.activity_id);
    const name = foldP6(e.name);
    const hay = `${id} ${name} ${foldP6(e.wbs)}`;
    const compact = hay.replace(/ /g, '');
    if (!terms.every((t) => hay.includes(t) || compact.includes(t))) continue;
    const idCompact = id.replace(/ /g, '');
    const words = name.split(' ');
    let score = 5;
    if (idCompact === compactQ) score = 0;
    else if (idCompact.startsWith(compactQ)) score = 1;
    else if (terms.every((t) => words.some((w) => w.startsWith(t)))) score = 2;
    else if (idCompact.includes(compactQ)) score = 3;
    else if (name.includes(q)) score = 4;
    if (e.missing) score += 10;
    scored.push({ e, score });
  }
  scored.sort((a, b) => a.score - b.score || collator.compare(a.e.activity_id, b.e.activity_id));
  return scored.slice(0, limit).map((x) => x.e);
}

/** The reasons on the list that fit what was typed — every live one when nothing was. */
export function matchFlags(flags, query) {
  const q = foldP6(query);
  return (flags || []).filter((f) => f.active !== false && (!q || foldP6(f.label).includes(q)));
}

/* ══════════════════════════════════════════════════════════════════════════
   What a row's Activity ID says
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The register and the reasons, as lookups. An ID is matched exactly, or — when
 * only one activity has it in any case — whatever the case it was typed in;
 * two IDs that differ only in case are both left to the exact match.
 */
export function p6Index(entries = [], flags = []) {
  const byId = new Map();
  const byFold = new Map();
  for (const e of entries || []) {
    byId.set(e.activity_id, e);
    const k = String(e.activity_id).toLowerCase();
    byFold.set(k, byFold.has(k) ? null : e);
  }
  const byFlag = new Map();
  for (const f of flags || []) byFlag.set(String(f.label).trim().toLowerCase(), f);
  return { byId, byFold, flags: byFlag, size: byId.size };
}

/**
 * One of four answers about what is written in a row's Activity ID:
 * `linked` (a P6 activity — `entry`), `flagged` (a reason it has none —
 * `flag`), `unknown` (something neither list has), or `empty`.
 */
export function p6Status(value, index) {
  const v = String(value ?? '').trim();
  if (!v) return { kind: 'empty' };
  const entry = index?.byId.get(v) || index?.byFold.get(v.toLowerCase()) || null;
  if (entry) return { kind: 'linked', entry };
  const flag = index?.flags.get(v.toLowerCase()) || null;
  if (flag) return { kind: 'flagged', flag };
  return { kind: 'unknown' };
}

/**
 * What to write for what was typed: the register's own spelling of an ID it
 * has, or the list's spelling of a reason — "cx-1040 " is written "CX-1040" —
 * and anything else exactly as typed.
 */
export function p6Canonical(value, index) {
  const status = p6Status(value, index);
  if (status.kind === 'linked') return status.entry.activity_id;
  if (status.kind === 'flagged') return status.flag.label;
  return String(value ?? '').trim();
}

/**
 * How the look-ahead's activities stand against the register: how many are
 * linked, flagged, carry something neither list has, or carry nothing — and
 * how many rows name each activity and each reason. Archived rows are off the
 * sheet and are not counted.
 */
export function p6Coverage(rows, index) {
  const out = { activities: 0, linked: 0, flagged: 0, unknown: 0, empty: 0, uses: new Map(), byFlag: new Map() };
  for (const r of rows || []) {
    if (r.kind !== 'activity' || r.archived) continue;
    out.activities++;
    const status = p6Status(r.activity_id, index);
    out[status.kind]++;
    if (status.kind === 'linked') {
      const id = status.entry.activity_id;
      out.uses.set(id, (out.uses.get(id) || 0) + 1);
    } else if (status.kind === 'flagged') {
      const label = status.flag.label;
      out.byFlag.set(label, (out.byFlag.get(label) || 0) + 1);
    }
  }
  return out;
}
