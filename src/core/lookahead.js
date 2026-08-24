/**
 * Comparing two look-ahead snapshots.
 *
 * The look-ahead is the contractual source of truth and the resource calendar
 * is the execution record; the difference between two snapshots is what a
 * delay claim is eventually built from. So the rules here are about being
 * *honest* rather than clever — the system logs what it can see and asks a
 * person about what it cannot.
 *
 * Two rules do most of the work, and both exist because the obvious version
 * produces numbers that flatter or damn the wrong party.
 *
 * **Only weeks in both snapshots are compared.** A four-week window rolls
 * forward, so a week appearing at the far edge is not scope being added and a
 * week dropping off the back is not scope being removed. Counting them as such
 * would book a batch of phantom additions every single week, and would count
 * finished work as deleted scope — inflating exactly the number you would most
 * want to defend.
 *
 * **A crew moving site is not inferred.** When work finishes early and a team
 * moves, one row disappears and another appears with the same resources. The
 * activity text is not reliable enough to match on — the spec says so and it is
 * right — so it is logged honestly as a removal and an addition, and a person
 * can relink the pair afterwards. Guessing would be the one failure mode
 * nobody could audit.
 *
 * Imports: nothing (leaf).
 */

/* ── Row identity ──────────────────────────────────────────────────────── */

/**
 * A key for a row that survives the file being edited.
 *
 * The look-ahead has no activity IDs — no P6 numbers, nothing stable — and its
 * descriptions are not matchable. Location, week and subsystem are what remain,
 * plus an ordinal to separate two rows that share all three.
 *
 * The ordinal is the weak part, and knowingly so: inserting a row in the middle
 * of a group shifts everything below it and produces a false removed/added
 * pair. That is tolerable only because the manual relink exists to fix it, and
 * because the alternative — matching on text — would produce *wrong* answers
 * rather than noisy ones.
 */
export function rowKey({ weekStart, location, subsystem = '', ordinal = 0 }) {
  return [weekStart, String(location || '').trim(), String(subsystem || '').trim(), ordinal].join('|');
}

/** Assign ordinals within each (week, location, subsystem) group. */
export function keyRows(rows) {
  const seen = new Map();
  return rows.map((row) => {
    const group = [row.weekStart, row.location, row.subsystem || ''].join('|');
    const ordinal = seen.get(group) || 0;
    seen.set(group, ordinal + 1);
    return { ...row, rowKey: rowKey({ ...row, ordinal }) };
  });
}

/* ── Reading the grid as a calendar ────────────────────────────────────── */

const WEEKDAYS = ['M', 'TU', 'W', 'TH', 'F', 'SA', 'SU'];

const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/**
 * The one month a label names, or -1.
 *
 * A week straddling a boundary is labelled "August/September" in this
 * workbook, and a label naming two months anchors nothing — it is skipped
 * rather than resolved to the first of them.
 */
function oneMonth(label) {
  const text = String(label || '').toUpperCase();
  const hits = new Set();
  MONTH_NAMES.forEach((name, i) => {
    if (text.includes(name) || new RegExp(`\\b${name.slice(0, 3)}\\b`).test(text)) hits.add(i);
  });
  return hits.size === 1 ? [...hits][0] : -1;
}

/**
 * Give every day column a real date, or none of them one.
 *
 * The sheet carries months and day numbers and no year at all, so a year has
 * to come from somewhere else. Two things supply it, and the second is what
 * makes this safe to rely on rather than a guess:
 *
 * **The snapshot's own timestamp** says roughly when the window was current.
 * The look-ahead is maintained four to six weeks out, so the window brackets
 * the day it was read; that narrows the year to one of three candidates.
 *
 * **The weekday letters check the answer.** The sheet writes M, Tu, W beside
 * every day, and only one of the candidate years makes those letters come out
 * right — the same date is a different weekday in adjacent years. So the year
 * is not inferred and hoped for, it is *verified* against something the file
 * already says, and where the letters do not agree no dates are claimed at
 * all and everything that depends on them stands down.
 *
 * Mutates `days`, adding `date` (an ISO string) where it can.
 */
function datePlease(days, anchorISO) {
  if (!days.length) return false;

  /* Day numbers first: they are always present, and a drop from 30 to 1 is a
     month boundary whether or not anybody labelled it. That matters because
     the visible window often starts mid-month, with the label for that month
     sitting in a column the workbook has hidden. */
  const nums = [];
  for (let i = 0; i < days.length; i++) {
    const n = parseInt(String(days[i].day).replace(/\D/g, ''), 10);
    nums.push(Number.isFinite(n) && n >= 1 && n <= 31 ? n : (nums[i - 1] || 0) + 1);
  }

  let anchorAt = -1;
  let anchorMonth = -1;
  for (let i = 0; i < days.length; i++) {
    const m = oneMonth(days[i].label);
    if (m >= 0) { anchorAt = i; anchorMonth = m; break; }
  }
  if (anchorAt < 0) return false;

  const months = new Array(days.length).fill(-1);
  months[anchorAt] = anchorMonth;
  for (let i = anchorAt + 1; i < days.length; i++) {
    months[i] = nums[i] < nums[i - 1] ? (months[i - 1] + 1) % 12 : months[i - 1];
  }
  for (let i = anchorAt - 1; i >= 0; i--) {
    months[i] = nums[i] > nums[i + 1] ? (months[i + 1] + 11) % 12 : months[i + 1];
  }

  // Relative years: the axis only ever runs forwards, so a month going
  // backwards is the turn of a year.
  const rel = [0];
  for (let i = 1; i < days.length; i++) rel.push(rel[i - 1] + (months[i] < months[i - 1] ? 1 : 0));

  const anchorMs = Date.parse(`${String(anchorISO || '').slice(0, 10)}T00:00:00Z`);
  const base = Number.isFinite(anchorMs)
    ? new Date(anchorMs).getUTCFullYear()
    : new Date().getUTCFullYear();

  const LETTERS = ['SU', 'M', 'TU', 'W', 'TH', 'F', 'SA'];
  let bestYear = null;
  let bestScore = -1;
  for (const year of [base - 1, base, base + 1]) {
    let agree = 0;
    for (let i = 0; i < days.length; i++) {
      const ms = Date.UTC(year + rel[i], months[i], nums[i]);
      if (LETTERS[new Date(ms).getUTCDay()] === String(days[i].weekday).trim().toUpperCase()) agree++;
    }
    // Closeness to the snapshot breaks a tie; the letters decide otherwise.
    const mid = Date.UTC(year + rel[rel.length >> 1], months[days.length >> 1], nums[days.length >> 1]);
    const near = Number.isFinite(anchorMs) ? 1 - Math.min(1, Math.abs(mid - anchorMs) / 3.2e10) : 0;
    const score = agree + near;
    if (score > bestScore) { bestScore = score; bestYear = year; }
  }

  // Below this the letters are not agreeing and the reading is wrong. Saying
  // nothing is the only honest answer: a today line on the wrong column is
  // worse than no today line.
  const agreement = Math.floor(bestScore) / days.length;
  if (agreement < 0.9) return false;

  for (let i = 0; i < days.length; i++) {
    days[i].date = new Date(Date.UTC(bestYear + rel[i], months[i], nums[i]))
      .toISOString().slice(0, 10);
    days[i].month = `${MONTH_NAMES[months[i]].slice(0, 3)} ${bestYear + rel[i]}`;
  }
  return true;
}

/**
 * Turn a parsed sheet into something that can be drawn: days across the top,
 * activities down the side.
 *
 * Everything here is *found* rather than configured, and that is the point.
 * The look-ahead is a spreadsheet somebody maintains by hand: rows get
 * inserted, the window scrolls, columns are hidden and unhidden as the weeks
 * move. A layout pinned to "dates start at column H" would be wrong the first
 * time anybody inserted a column, and wrong silently — the grid would still
 * draw, against the wrong days.
 *
 * So the date axis is located by looking for the row of weekday letters, which
 * is the one row on the sheet whose content cannot be mistaken for anything
 * else. The day numbers sit directly above it and the month labels above
 * those; the columns it occupies are the calendar, and everything to the left
 * of them is what the activity *is*.
 *
 * No year is invented. The sheet does not carry one, and a date is not
 * something to infer from a month name — the axis is drawn as the workbook
 * writes it.
 */
export function readGrid(grid, { anchorISO = null } = {}) {
  const rows = (grid?.rows || []).slice().sort((a, b) => a.row - b.row);
  const empty = { days: [], meta: [], activities: [], header: null };
  if (!rows.length) return empty;

  // The weekday row: the one where most values are M/Tu/W/Th/F/Sa/Su.
  let header = null;
  let best = 0;
  for (const row of rows) {
    const hits = row.cells.filter((c) => WEEKDAYS.includes(String(c.value ?? '').trim().toUpperCase()));
    if (hits.length > best && hits.length >= 7) {
      best = hits.length;
      header = row;
    }
  }
  if (!header) return empty;

  const dayCols = header.cells
    .filter((c) => WEEKDAYS.includes(String(c.value ?? '').trim().toUpperCase()))
    .map((c) => c.col)
    .sort((a, b) => a - b);
  const dayCol = new Set(dayCols);
  const firstDay = dayCols[0];

  const at = (row, col) => row?.cells.find((c) => c.col === col);
  const above = (n) => rows.filter((r) => r.row < header.row).slice(-n)[0] || null;
  const numbers = above(1);
  const months = above(2);

  /* The month label is a merged cell, so only the leftmost column of each
     block carries it. Carrying the last one forward is what merged means. */
  let month = '';
  const days = dayCols.map((col) => {
    const label = String(at(months, col)?.value ?? '').trim();
    if (label) month = label;
    return {
      col,
      month,
      // What the sheet actually wrote here, as opposed to what was carried
      // across the merge. Only a real label can anchor the calendar.
      label,
      day: String(at(numbers, col)?.value ?? '').trim(),
      weekday: String(at(header, col)?.value ?? '').trim(),
      weekend: ['SA', 'SU'].includes(String(at(header, col)?.value ?? '').trim().toUpperCase()),
    };
  });

  datePlease(days, anchorISO);

  /* The activity columns are whatever is used to the left of the calendar.
     Their headings are not reliably on any one row — this file labels some and
     not others — so they are numbered by position and named where a heading
     happens to exist above the first activity. */
  const body = rows.filter((r) => r.row > header.row);
  const metaCols = [...new Set(
    body.flatMap((r) => r.cells.filter((c) => c.col < firstDay && String(c.value ?? '').trim()).map((c) => c.col))
  )].sort((a, b) => a - b);

  const activities = [];
  for (const row of body) {
    const meta = metaCols.map((col) => String(at(row, col)?.value ?? '').trim());
    const marks = row.cells
      .filter((c) => dayCol.has(c.col) && (String(c.value ?? '').trim() || c.hex))
      .map((c) => ({
        col: c.col,
        value: String(c.value ?? '').trim(),
        hex: c.hex || null,
        meaning: c.meaning || null,
        role: c.role || (c.hex ? 'shift' : null),
      }));

    // A row with neither a description nor a mark is spacing, not work.
    if (!meta.some(Boolean) && !marks.some((m) => m.value)) continue;

    /* A heading is a row whose *activity* cells are painted.
       That is a structural fact rather than a reading of the colour, and it is
       what makes it reliable: the shading that runs along the day columns of
       every row paints only the calendar, never the description beside it. So
       a section title is recognised without anybody having to tell the legend
       which of several near-identical greys means "divider". */
    const heading = row.cells.some((c) => !dayCol.has(c.col) && c.hex);

    /* "Highlighted" means at least one day carries paint that is not shading.
       An unmapped colour counts: until somebody says what it is, the honest
       assumption is that it might be work, and hiding it would bury the rows
       that most need attention. */
    const highlighted = marks.some((m) => m.hex && m.role !== 'ignore');

    activities.push({ row: row.row, meta, marks, heading, highlighted });
  }

  return { days, meta: metaCols, activities, header: header.row };
}

/* ── The window ────────────────────────────────────────────────────────── */

/**
 * The weeks a snapshot actually covers, read from the snapshot itself.
 *
 * Deliberately not a constant. The spec calls it a four-week look-ahead and
 * says it is maintained four to six weeks out, so a hard-coded 4 would
 * misclassify the sixth week every time it appeared.
 */
export function windowOf(rows) {
  const weeks = [...new Set(rows.map((r) => r.weekStart))].sort();
  return { weeks, first: weeks[0] || null, last: weeks[weeks.length - 1] || null };
}

/* ── Comparing ─────────────────────────────────────────────────────────── */

/**
 * Classify the difference between two keyed snapshots.
 *
 * `before` and `after` are arrays of `{ rowKey, weekStart, location, subsystem,
 * label, cells, marks }`, where `cells` maps a date to a shift meaning and
 * `marks` holds BART's own resource requests.
 *
 * Returns a list of `{ kind, weekStart, rowKey, before, after }`.
 */
export function classify(before, after, { cancelledMeaning = 'cancelled' } = {}) {
  const beforeWindow = windowOf(before);
  const afterWindow = windowOf(after);

  // Only weeks present on both sides can be compared at all. Everything else
  // is the window moving, which is recorded and kept out of the KPIs.
  const shared = new Set(beforeWindow.weeks.filter((w) => afterWindow.weeks.includes(w)));

  const events = [];
  const beforeByKey = new Map(before.map((r) => [r.rowKey, r]));
  const afterByKey = new Map(after.map((r) => [r.rowKey, r]));

  /* Weeks entering and leaving the window. Not scope, and named so. */
  for (const week of afterWindow.weeks) {
    if (!beforeWindow.weeks.includes(week)) {
      events.push({ kind: 'window_advanced', weekStart: week, rowKey: null, before: null, after: null });
    }
  }
  for (const week of beforeWindow.weeks) {
    if (!afterWindow.weeks.includes(week)) {
      events.push({ kind: 'window_retired', weekStart: week, rowKey: null, before: null, after: null });
    }
  }

  /* Rows added to, and removed from, a week that was already in view. */
  for (const row of after) {
    if (!shared.has(row.weekStart)) continue;
    if (!beforeByKey.has(row.rowKey)) {
      events.push({ kind: 'scope_added', weekStart: row.weekStart, rowKey: row.rowKey, before: null, after: row });
    }
  }
  for (const row of before) {
    if (!shared.has(row.weekStart)) continue;
    if (!afterByKey.has(row.rowKey)) {
      events.push({ kind: 'scope_removed', weekStart: row.weekStart, rowKey: row.rowKey, before: row, after: null });
    }
  }

  /* Rows present on both sides: what changed inside them. */
  for (const row of after) {
    const prior = beforeByKey.get(row.rowKey);
    if (!prior || !shared.has(row.weekStart)) continue;

    const dates = [...new Set([...Object.keys(prior.cells || {}), ...Object.keys(row.cells || {})])].sort();
    for (const date of dates) {
      const was = (prior.cells || {})[date] || null;
      const now = (row.cells || {})[date] || null;
      if (was === now) continue;

      // A shift turning red is a cancellation, and the colour alone cannot say
      // whose. Whoever reviews it is asked; nothing is assumed.
      const kind = now === cancelledMeaning && was && was !== cancelledMeaning
        ? 'cancellation'
        : 'shift_changed';

      events.push({
        kind,
        weekStart: row.weekStart,
        rowKey: row.rowKey,
        date,
        before: was,
        after: now,
        needsResponsibility: kind === 'cancellation',
      });
    }

    // BART's own resource marks — an EIC added to an otherwise unchanged
    // shift. The shift did not move, and the request still changed, so it is
    // logged rather than folded into the row above.
    const marksBefore = JSON.stringify(prior.marks || {});
    const marksAfter = JSON.stringify(row.marks || {});
    if (marksBefore !== marksAfter) {
      events.push({
        kind: 'resource_changed',
        weekStart: row.weekStart,
        rowKey: row.rowKey,
        before: prior.marks || {},
        after: row.marks || {},
      });
    }
  }

  return events;
}

/**
 * Removals and additions in the same week that could be one crew moving site.
 *
 * Only ever a *suggestion*, surfaced for somebody to confirm. Work finishing
 * early at one location and starting at another is not a cancellation, but the
 * only evidence is that the same BART resources appear on both — and the
 * activity text, which cannot be trusted. So the pairing is a human judgement
 * by design, and the system's job is to make it easy rather than to guess.
 */
export function relinkCandidates(events) {
  const removed = events.filter((e) => e.kind === 'scope_removed');
  const added = events.filter((e) => e.kind === 'scope_added');
  const out = [];

  for (const gone of removed) {
    for (const arrived of added) {
      if (gone.weekStart !== arrived.weekStart) continue;
      const a = JSON.stringify(gone.before?.marks || {});
      const b = JSON.stringify(arrived.after?.marks || {});
      if (a !== '{}' && a === b) {
        out.push({ removed: gone, added: arrived, because: 'the same resources were requested' });
      }
    }
  }
  return out;
}

/**
 * Which events count toward the change KPIs.
 *
 * The window moving is real and recorded, and it is not a change of scope.
 * Keeping the two apart is what stops the scope-added figure being meaningless
 * within a month.
 */
export const KPI_KINDS = ['scope_added', 'scope_removed', 'cancellation', 'resource_changed', 'shift_changed'];

export function countable(events) {
  return events.filter((e) => KPI_KINDS.includes(e.kind));
}

/** A short, plain description of an event, for the change log. */
export function describe(event) {
  switch (event.kind) {
    case 'scope_added': return `Added: ${event.after?.label || event.rowKey}`;
    case 'scope_removed': return `Removed: ${event.before?.label || event.rowKey}`;
    case 'cancellation': return `Cancelled on ${event.date}: was ${event.before}`;
    case 'shift_changed': return `${event.date}: ${event.before || 'nothing'} → ${event.after || 'nothing'}`;
    case 'resource_changed': return 'BART resource request changed';
    case 'window_advanced': return `Week ${event.weekStart} came into the window`;
    case 'window_retired': return `Week ${event.weekStart} left the window`;
    case 'location_shift': return 'Relinked as one crew moving site';
    default: return event.kind;
  }
}
