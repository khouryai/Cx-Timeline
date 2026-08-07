/**
 * Reading a Primavera P6 export.
 *
 * P6 exports whatever columns the scheduler's layout happens to show, in
 * whatever order, with whatever headings that version uses. So the reader
 * asks for four things and takes the rest if it finds them:
 *
 *   required   Activity ID, Activity Name, Start, Finish
 *   optional   WBS, % Complete, Activity Status, Total Float
 *
 * Requiring four columns means the scheduler can send a minimal export and it
 * works; recognising more means a richer layout costs nothing extra.
 *
 * Two things here have bitten every P6 importer ever written:
 *
 *   Finish times. P6 writes a finish as `30-Oct-26 17:00` — the last working
 *   moment of the 30th. Truncating the time is right; rounding up puts every
 *   activity a day long, and the error is invisible until someone checks a
 *   date against the schedule in a meeting.
 *
 *   Milestones. A start milestone has a finish and a finish milestone has a
 *   start, both equal to the other. They are not zero-length bugs.
 *
 * Imports: util, dates, model, importers.
 */

import { MS_DAY } from '../core/dates.js';
import { makeP6Activity } from '../core/model.js';
import { parseDate, splitDelimited, readXlsx } from './importers.js';

/* ── Column recognition ────────────────────────────────────────────────── */

/**
 * Header patterns, most specific first.
 *
 * P6 and its various export layouts disagree on names — "Activity ID" is also
 * "Task ID" and "Act ID"; "Finish" is also "End" and "Finish Date". These are
 * matched against a folded heading, so spacing and case do not matter.
 */
const COLUMNS = {
  id: [/^activity ?id$/, /^act(ivity)? ?(id|code)$/, /^task ?id$/, /^id$/],
  name: [/^activity ?name$/, /^act(ivity)? ?(name|description)$/, /^task ?name$/, /^description$/, /^name$/],
  start: [/^(bl|baseline) ?(project )?start/, /^start( date)?$/, /^early start$/, /^actual start$/],
  end: [/^(bl|baseline) ?(project )?finish/, /^finish( date)?$/, /^end( date)?$/, /^early finish$/, /^actual finish$/],
  wbs: [/^wbs( ?(path|code|name))?$/, /^work breakdown/, /^phase$/],
  percent: [/^(activity )?% ?(complete|comp)$/, /^percent ?complete$/, /^progress$/],
  status: [/^(activity )?status$/, /^state$/],
  float: [/^(total )?float$/, /^slack$/],
};

/** Lower-cased, collapsed, punctuation-light form of a heading. */
function fold(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Work out which column is which.
 *
 * Returns the index of each field, or -1. The caller decides whether what was
 * found is enough — this does not throw, because a preview that says "I could
 * not find a Finish column" is far more use than an exception.
 */
export function mapColumns(headerRow) {
  const headings = (headerRow || []).map(fold);
  const found = {};

  for (const [field, patterns] of Object.entries(COLUMNS)) {
    found[field] = -1;
    for (const pattern of patterns) {
      const index = headings.findIndex((h, i) => pattern.test(h) && !Object.values(found).includes(i));
      if (index >= 0) {
        found[field] = index;
        break;
      }
    }
  }
  return found;
}

/**
 * Find the header row.
 *
 * P6's own Excel export puts the project name, a filter description and a
 * blank line above the headings, so the first row is rarely the one wanted.
 * The header is the first row within the top twenty that yields both an ID
 * and a name column.
 */
export function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const mapped = mapColumns(rows[i]);
    if (mapped.id >= 0 && mapped.name >= 0) return i;
  }
  return -1;
}

/* ── Dates ─────────────────────────────────────────────────────────────── */

/**
 * A P6 date cell to a UTC-midnight day.
 *
 * The time is dropped rather than rounded: `30-Oct-26 17:00` is the 30th, and
 * treating it as the 31st would lengthen every activity in the schedule by a
 * day. `parseDate` handles the formats; this strips the P6 decorations first
 * — a trailing `A` marks an actual date and `*` marks a constraint.
 */
export function parseP6Date(value) {
  if (value == null) return null;
  const text = String(value).trim().replace(/\s*[A*]$/i, '');
  if (!text || /^(tbd|n\/?a|-+)$/i.test(text)) return null;

  // Drop a time component; the day is what a plan is drawn against.
  const dayOnly = text.replace(/[ T]\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$/i, '').trim();
  const parsed = parseDate(dayOnly);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ── Reading ───────────────────────────────────────────────────────────── */

/**
 * Read a P6 export into activities.
 *
 * @returns {{activities: Array, mapping: object, headerRow: number,
 *            skipped: number, duplicates: string[], warnings: string[]}}
 */
export function parseP6Rows(rows) {
  const warnings = [];
  const headerRow = findHeaderRow(rows);

  if (headerRow < 0) {
    return {
      activities: [],
      mapping: {},
      headerRow: -1,
      skipped: 0,
      duplicates: [],
      warnings: ['No Activity ID and Activity Name columns were found in the first 20 rows.'],
    };
  }

  const mapping = mapColumns(rows[headerRow]);
  const missing = ['id', 'name', 'start', 'end'].filter((f) => mapping[f] < 0);
  if (missing.length) {
    warnings.push(
      `Missing column${missing.length === 1 ? '' : 's'}: ${missing
        .map((f) => ({ id: 'Activity ID', name: 'Activity Name', start: 'Start', end: 'Finish' }[f]))
        .join(', ')}.`
    );
  }

  const cell = (row, field) => (mapping[field] >= 0 ? row[mapping[field]] : undefined);
  const seen = new Map();
  const duplicates = [];
  const activities = [];
  let skipped = 0;
  let order = 0;
  let undated = 0;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;

    const id = String(cell(row, 'id') ?? '').trim();
    if (!id) {
      skipped++;
      continue;
    }
    // P6 layouts repeat the header when grouped by WBS.
    if (fold(id) === 'activity id') continue;

    const start = parseP6Date(cell(row, 'start'));
    const end = parseP6Date(cell(row, 'end'));
    if (start == null && end == null) {
      undated++;
      skipped++;
      continue;
    }

    // A milestone has one date; using it for both keeps every downstream
    // calculation (duration, slip, variance) working without a special case.
    const from = start ?? end;
    const to = end ?? start;

    if (seen.has(id)) {
      duplicates.push(id);
      continue;
    }

    const percentRaw = cell(row, 'percent');
    const percent = percentRaw == null || percentRaw === ''
      ? null
      : Math.max(0, Math.min(100, Math.round(parseFloat(String(percentRaw).replace('%', '')) || 0)));

    const activity = makeP6Activity({
      id,
      name: String(cell(row, 'name') ?? '').trim() || id,
      wbs: String(cell(row, 'wbs') ?? '').trim(),
      percent,
      status: String(cell(row, 'status') ?? '').trim(),
      order: order++,
    });
    activity.dates = { start: Math.min(from, to), end: Math.max(from, to) };

    seen.set(id, activity);
    activities.push(activity);
  }

  if (undated) warnings.push(`${undated} row${undated === 1 ? '' : 's'} had no readable dates and were skipped.`);
  if (duplicates.length) {
    warnings.push(
      `${duplicates.length} duplicate activity ID${duplicates.length === 1 ? '' : 's'} ignored ` +
        `(${duplicates.slice(0, 3).join(', ')}${duplicates.length > 3 ? '…' : ''}). ` +
        'A multi-project export can repeat IDs.'
    );
  }

  return { activities, mapping, headerRow, skipped, duplicates, warnings };
}

/** Read a `.xlsx`, `.csv` or `.txt` P6 export. */
export async function readP6File(file) {
  const name = (file.name || '').toLowerCase();

  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const buffer = await file.arrayBuffer();
    return parseP6Rows(await readXlsx(buffer));
  }

  const text = await file.text();
  return parseP6Rows(splitDelimited(text));
}

/* ── Reconciliation ────────────────────────────────────────────────────── */

/**
 * Work out what an import would do, without doing it.
 *
 * The result is shown before anything is written, because an import that
 * silently moved forty dates would be indistinguishable from one that
 * silently moved four hundred.
 *
 * @param {object} register   The current `doc.p6`.
 * @param {Array}  incoming   Activities from `parseP6Rows`.
 * @param {string} kind       'baseline' | 'progress'
 * @param {Set}    placedIds  Activity ids that appear on the timeline.
 */
export function reconcile(register, incoming, kind, placedIds = new Set()) {
  const existing = register.activities || {};
  const added = [];
  const moved = [];
  const unchanged = [];
  const renamed = [];

  for (const activity of incoming) {
    const before = existing[activity.id];
    const dates = activity.dates;

    if (!before) {
      added.push({ id: activity.id, name: activity.name, dates });
      continue;
    }

    // What "moved" means depends on what we already knew. The first progress
    // import has no previous progress, so the honest comparison is against the
    // baseline — otherwise every activity reports "unchanged" on the very
    // import that first shows the slip.
    const previous = kind === 'baseline'
      ? before.baseline
      : before.progress || before.baseline;
    const against = kind === 'baseline'
      ? 'the previous baseline'
      : before.progress ? 'the last progress import' : 'the baseline';

    const startShift = previous ? Math.round((dates.start - previous.start) / MS_DAY) : null;
    const finishShift = previous ? Math.round((dates.end - previous.end) / MS_DAY) : null;

    if (before.name && activity.name && before.name !== activity.name) {
      renamed.push({ id: activity.id, from: before.name, to: activity.name });
    }

    if (!previous || startShift !== 0 || finishShift !== 0) {
      moved.push({
        id: activity.id,
        name: activity.name,
        from: previous || null,
        to: dates,
        against,
        startShift,
        finishShift,
        placed: placedIds.has(activity.id),
      });
    } else {
      unchanged.push(activity.id);
    }
  }

  // Activities the register knows about that this file does not mention.
  // They are marked, never deleted: something on the timeline may point at
  // one, and losing it silently would leave a bar with no explanation.
  const incomingIds = new Set(incoming.map((a) => a.id));
  const absent = Object.values(existing)
    .filter((a) => !incomingIds.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, placed: placedIds.has(a.id) }));

  return {
    kind,
    added,
    moved,
    renamed,
    unchanged,
    absent,
    total: incoming.length,
    placedAffected: moved.filter((m) => m.placed).length,
  };
}
