/**
 * Reading a look-ahead: the workbook's grid as a calendar, the marks and names
 * on it, who is away, and what it offers the timeline.
 *
 * Every bundle carries this — the timeline reads the look-ahead for its
 * suggestions, the phone app for its days — so it holds what reading needs and
 * nothing else. Storing a reading as rows and comparing two of them, which
 * only the calendar does, is `core/la_register.js`.
 *
 * **A Resource row belongs to the activity above it.** The workbook names who
 * is on an activity by adding a row underneath whose description reads
 * "Resource", with the names typed into the day cells; where and when are left
 * blank because they are the line above's. So it is read as part of that
 * activity rather than as one of its own — otherwise half the sheet is rows
 * called "Resource" with no location — and a name is never matched to a person
 * here. That happens against the roster, where an unmatched spelling can be
 * shown to somebody instead of guessed at.
 *
 * Imports: nothing (leaf).
 */

/* ── The Resource row ──────────────────────────────────────────────────── */

/**
 * Is this what the workbook writes under an activity to name who is on it?
 *
 * The 4WLA carries a row directly beneath each activity whose description cell
 * reads "Resource", and the day cells on it hold the names typed against that
 * activity. It is recognised by that one word and nothing else — folded for
 * case and punctuation, but not loosened any further. "Resource Names" is not
 * it: a rule that matched anything containing the word would swallow an
 * activity called "Resource mobilisation", and a row misread as a label is a
 * row of work that vanishes off the calendar.
 */
export function isResourceLabel(text) {
  return /^resources?$/.test(String(text ?? '').toLowerCase().replace(/[^a-z]/g, ''));
}

/**
 * Which kind of absence a row's description names, or null.
 *
 * The workbook carries rows at the bottom that are not site work: "PTO",
 * "Office" and "Other Group / Project", with names typed into the day cells the
 * same way the Resource row carries them. They say where somebody is when they
 * are not on the project — off, at their desk, or on another group's work —
 * which is a fact about the person rather than about an activity, and it is the
 * fact the week plan and the huddle are otherwise missing entirely: a blank
 * against a name reads as "nobody planned this", when the sheet said exactly
 * why. Only PTO means they were not working; the rest are days like any other,
 * and they carry a category so the reports can group them.
 *
 * Strict for the reason `isResourceLabel()` is strict, and with the same two
 * failures in mind. A row misread as a label is a row of work that vanishes off
 * the calendar; a label misread as work is a row of names at no location that
 * every report then counts as scope. So the spellings are enumerated rather than
 * matched loosely — "Other" alone is not one of them, because it names nothing.
 */
export function absenceKind(text) {
  const folded = String(text ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (/^(pto|paidtimeoff|timeoff|vacation|annualleave|holiday)$/.test(folded)) return 'pto';
  if (/^(office|officeday|inoffice|officebased)$/.test(folded)) return 'office';
  if (/^other(group|project)/.test(folded)) return 'other';
  return null;
}

/**
 * The three facts about each kind, in one table.
 *
 * They were spread across three modules — the label here, whether it counts as
 * leave inside `availability()`, and nothing at all about which category the
 * day belongs to — and the first time a kind was added that was three places to
 * remember. What each one *is*:
 *
 * **`leave`** decides whether the person was there at all. PTO is the only one:
 * somebody in the office or on another group's project is working, they can be
 * asked how the day went, and folding them into leave would put a person who
 * was at their desk down as absent.
 *
 * **`category`** is the seeded `rc_categories` row the day belongs to, matched
 * by name because that is what the schema seeds it as. A renamed category
 * simply stops matching and the day arrives uncategorised — ungrouped in the
 * reports rather than grouped wrongly, which is the right way for a
 * name match to fail.
 */
export const ABSENCE_KINDS = {
  pto:    { label: 'PTO',                   leave: true,  category: null },
  office: { label: 'Office',                leave: false, category: 'Office' },
  other:  { label: 'Other group / project', leave: false, category: 'Other project' },
};

/** What each kind is called on screen. One place, so three views cannot differ. */
export const ABSENCE_LABELS = Object.fromEntries(
  Object.entries(ABSENCE_KINDS).map(([kind, it]) => [kind, it.label])
);

/**
 * The people named in one cell.
 *
 * Typed by hand, so the separator is whatever was to hand: a comma, a slash, a
 * newline, an ampersand, a plus, the word "and", or simply two spaces where somebody
 * pressed the bar twice. Nothing is matched to a person here — that is the
 * roster's job, through the alias register — this only splits what was written.
 *
 * **Spacing is noise, not a name.** A cell reading `Victor ,Rosa` and one
 * reading `Victor, Rosa` are the same two people, so each piece is trimmed and
 * its own internal runs of whitespace are collapsed before it is handed on: a
 * name carrying a stray double space would otherwise fold to a different string
 * from the same name typed once, and match nobody for a reason no reader could
 * see. A newline inside a cell is a separator rather than a space, because that
 * is how a second name gets into one cell in Excel.
 */
export function resourceNames(text) {
  return String(text ?? '')
    /* "and" is tried before the two-space rule on purpose: an alternation is
       read left to right, so `\s{2,}` would otherwise eat the spaces around a
       spelled-out "and" and leave the word behind as a person. */
    .split(/\s+and\s+|[,;/\n&+]|\s{2,}/i)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/**
 * Every mark on an activity, the ones on its Resource row included.
 *
 * Whether a row has work on it is a question about the pair, not about the
 * activity line alone: the workbook sometimes paints the shift on the Resource
 * row instead. Both places that ask — `readGrid()` and the calendar's window —
 * have to ask it the same way, which is why it is a function and not two loops.
 */
export function marksOf(activity) {
  return activity?.resource ? [...activity.marks, ...activity.resource.marks] : (activity?.marks || []);
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
  const empty = { days: [], meta: [], headings: [], activities: [], header: null };
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

  /* The row the sheet writes its column headings on.
     "Activity ID, Description of Work Activity, Location, SSWP, Party to Action,
     Work hours" sit together on one row above the calendar, and that row is found
     the way the weekday row is: it is the one, at or above the weekday row, with
     the most text left of the first day. Reading each column's nearest text
     upwards instead — which is what this did — takes whatever is closest, so a
     note typed in a gap row, or a label on the weekday row itself, stood in for
     the real heading of its column and the row of headings never showed. A
     single stray cell cannot win against a row of six. */
  const labelled = (row) => row.cells.filter((c) => c.col < firstDay && String(c.value ?? '').trim());
  let headingRow = null;
  for (const row of rows) {
    if (row.row > header.row) break;
    const count = labelled(row).length;
    if (count >= 2 && count >= (headingRow ? labelled(headingRow).length : 0)) headingRow = row;
  }

  /* The activity columns: every column left of the calendar that the body uses
     or the heading row names. A named column whose cells are all empty is still
     one of the sheet's columns — leaving it out would shift every heading after
     it onto the wrong values in the reader's head. */
  const metaCols = [...new Set([
    ...body.flatMap((r) => labelled(r).map((c) => c.col)),
    ...(headingRow ? labelled(headingRow).map((c) => c.col) : []),
  ])].sort((a, b) => a - b);

  /* What the sheet calls each of those columns: its cell on the heading row,
     and only where that row says nothing, the nearest text above the weekday
     row — the reading a sheet with its headings scattered over rows still needs.
     It is worth reading rather than guessing because one of these columns is the
     location, and knowing *which* is the difference between recording where the
     work is and recording nothing. An unlabelled column is ''. */
  const headings = metaCols.map((col) => {
    const own = String(at(headingRow, col)?.value ?? '').trim();
    if (own) return own;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].row > header.row) continue;
      const text = String(at(rows[i], col)?.value ?? '').trim();
      if (text) return text;
    }
    return '';
  });

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
       which of several near-identical greys means "divider".
       Only the columns *left* of the calendar count. `!dayCol.has(col)` also
       took in anything painted to the right of the last day — a totals column,
       a trailing border — and one of those turns every row in the workbook
       into a heading, which is how a whole file arrived on screen at once. */
    const heading = row.cells.some((c) => c.col < firstDay && c.hex);

    /* "PTO", "Office", "Other Group / Project": rows of names that are not
       site work.
       Unlike the Resource row they stand on their own — they sit at the bottom
       of the sheet and belong to nobody above them, because what they say is
       about the *person*, not about an activity. So they are emitted as rows in
       their own right, marked with the kind, and everything downstream reads
       `absence` to know this is not scope: `rowsFrom()` skips them so they can
       never be counted as work added or removed, and the calendar draws them
       with the names rather than with the activities. */
    const absence = absenceKind(meta.find((value) => absenceKind(value)) || '');
    if (!heading && absence) {
      activities.push({
        row: row.row, id: row.id || null, meta, marks, heading: false, highlighted: false,
        named: true, resource: null, absence,
      });
      continue;
    }

    /* The Resource row the workbook writes under an activity.
       It belongs to the activity above it rather than being one of its own: it
       carries no work of its own, it inherits where and when from the line it
       sits under, and drawn as a separate activity it would be a hundred and
       forty rows of the word "Resource". Its day cells are the names.

       **Directly above means the row directly above, on the sheet.** This used
       to take whichever activity happened to have been pushed last, however far
       up the sheet it was — so anything the parser stepped over on the way down
       silently re-parented the names. A hidden row is the case that bit: the
       workbook hides an activity, `parseSheet()` drops it before this ever sees
       it, and the Resource row underneath attached itself to the activity above
       the hidden one. Nothing on the calendar showed it, because the names were
       drawn against the row they were typed on — but the derived plan booked
       somebody onto an activity that is not in the 4WLA at all, which is exactly
       how it was found. `above.row === row.row - 1` is the whole test: a gap in
       the numbering means *something* was between them — hidden, skipped as
       spacing, or a band — and there is no honest way to say whose names these
       are.

       An orphan is dropped rather than drawn. It is a label row whatever it is
       attached to: pushed as an activity it would be the word "Resource" at no
       location, counted as scope by every report, which is worse than the wrong
       parent it replaces. */
    if (!heading && meta.some(isResourceLabel)) {
      const above = activities[activities.length - 1];
      if (above && above.row === row.row - 1 && !above.heading && !above.absence) {
        above.resource = {
          row: row.row,
          id: row.id || null,
          /* Where and when come from the activity above — that is what the
             workbook means by leaving them blank on this row. Anything typed
             here wins, so a resource working different hours can say so. */
          meta: meta.map((value, i) => value || above.meta[i] || ''),
          marks,
          names: marks.filter((m) => m.value).map((m) => ({ col: m.col, names: resourceNames(m.value) })),
        };
        above.highlighted = marksOf(above).some((m) => m.hex && m.role === 'shift');
      }
      continue;
    }

    /* "Highlighted" means at least one day carries paint that is *work*.
       Tested as `role === 'shift'` rather than `role !== 'ignore'`, which is
       not the same question and got the answer wrong: a `divider` is the grey
       the workbook paints its section bands in, and a row whose only colour is
       a divider or a weekend band has nothing scheduled on it — but it read as
       highlighted and survived into the grid.
       An unmapped colour still counts, because `applyLegend()` gives it
       `shift`: until somebody says what a colour is, the honest assumption is
       that it might be work, and hiding it would bury the rows that most need
       attention. */
    const highlighted = marks.some((m) => m.hex && m.role === 'shift');

    /* Whether anybody wrote down what this row *is*.
       A row of paint with no description is not an activity — it is a band, a
       spacer, or a fill somebody dragged too far — and putting it on the
       calendar asks the reader to work out which. It is hidden with the
       unscheduled rows rather than dropped, so the switch still brings it back. */
    const named = meta.some(Boolean);

    activities.push({ row: row.row, id: row.id || null, meta, marks, heading, highlighted, named, resource: null, absence: null });
  }

  return { days, meta: metaCols, headings, activities, header: header.row };
}

/**
 * Several stretches of the look-ahead as one calendar.
 *
 * A window that reaches past the newest reading is drawn from more than one
 * source — the weeks before the editor from the workbook reading that had
 * each, the rest from the editor — and those used to be a grid each, one under
 * the other, so "Everything" was a stack of calendars with the same activity
 * in every one. This lays them side by side instead: one set of rows, the days
 * of every stretch across, in date order.
 *
 * `parts` is `[{ view, snapshotId? }]` in date order, each view already
 * narrowed to its own days (they never overlap). The newest is the authority:
 * its columns, headings and rows, in its order, with its words. Another
 * stretch's columns are matched to them by heading, and by position where a
 * sheet left a heading blank. Its rows join the row that is the same activity —
 * the editor's id where both carry one, else the same words, else the same
 * words but the Activity ID, which is often typed in later — and a row no newer
 * stretch has is put in after the row it followed on its own sheet, so a
 * section keeps its rows. Day columns are renumbered past every sheet's own,
 * since each stretch numbers its columns from its own sheet. Each merged row
 * keeps the reading it was first found in (`snapshotId`), and the first day of
 * a stretch from another source than the one before it says so (`sourceStart`,
 * by `snapshotId` — the editor's stretches are all null, one source), so the
 * grid can draw where one source hands over to the next.
 */
export function mergeViews(parts) {
  const list = (parts || []).filter((p) => p?.view);
  if (!list.length) return { days: [], meta: [], headings: [], activities: [], header: null };
  if (list.length === 1) return list[0].view;
  const base = list[list.length - 1].view;
  const norm = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const width = base.meta.length;
  const baseHeads = base.meta.map((_, i) => norm(base.headings?.[i]));
  const idCol = baseHeads.findIndex((h) => /activity\s*id/.test(h));

  /** For each of the newest stretch's columns, the column of `view` that says the same thing, or -1. */
  const columnsOf = (view) => {
    if (view === base) return base.meta.map((_, i) => i);
    const heads = view.meta.map((_, i) => norm(view.headings?.[i]));
    const out = baseHeads.map((h) => (h ? heads.indexOf(h) : -1));
    const taken = new Set(out.filter((j) => j >= 0));
    return out.map((j, i) => (j >= 0 ? j : i < heads.length && !taken.has(i) ? i : -1));
  };

  let next = 1 + Math.max(0, ...list.flatMap(({ view }) => [...view.meta, ...view.days.map((d) => d.col)]));
  const days = [];
  const colMaps = list.map(({ view }, k) => {
    const map = new Map();
    view.days.forEach((d, i) => {
      map.set(d.col, next);
      days.push({ ...d, col: next++, sourceStart: k > 0 && i === 0 && (list[k].snapshotId ?? null) !== (list[k - 1].snapshotId ?? null) });
    });
    return map;
  });

  const kindOf = (a) => (a.heading ? 'h' : a.absence ? `a:${a.absence}` : 'r');
  const keysOf = (a) => {
    const words = a.meta.map(norm);
    const keys = [];
    if (a.id) keys.push(`id:${a.id}`);
    if (words.some(Boolean)) keys.push(`w:${kindOf(a)}:${words.join('|')}`);
    if (idCol >= 0 && words.some((w, i) => w && i !== idCol)) {
      keys.push(`d:${kindOf(a)}:${words.map((w, i) => (i === idCol ? '' : w)).join('|')}`);
    }
    return keys;
  };

  /* A row joins one row of another stretch, never one of its own sheet's —
     two lines worded alike on one sheet are two lines — and each row of a
     newer stretch is joined by one row of an older one at most. */
  const rows = [];
  const index = new Map();
  const partOf = new Map();
  const remember = (key, row) => {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  };

  for (let k = list.length - 1; k >= 0; k--) {
    const { view, snapshotId = null } = list[k];
    const cols = columnsOf(view);
    const align = (meta) => Array.from({ length: width }, (_, i) => (cols[i] >= 0 ? meta[cols[i]] ?? '' : ''));
    const remap = (marks) => (marks || []).filter((m) => colMaps[k].has(m.col)).map((m) => ({ ...m, col: colMaps[k].get(m.col) }));
    const resourceOf = (r) => (r ? {
      ...r,
      meta: align(r.meta),
      marks: remap(r.marks),
      names: (r.names || []).filter((n) => colMaps[k].has(n.col)).map((n) => ({ ...n, col: colMaps[k].get(n.col) })),
    } : null);

    let anchor = -1;
    const claimed = new Set();
    for (const a of view.activities) {
      const own = { ...a, meta: align(a.meta), marks: remap(a.marks), resource: resourceOf(a.resource) };
      const keys = keysOf(own);
      const found = keys.map((key) => (index.get(key) || []).find((r) => partOf.get(r) !== k && !claimed.has(r)))
        .find(Boolean);
      if (found) {
        claimed.add(found);
        found.marks.push(...own.marks);
        if (own.resource) {
          if (!found.resource) found.resource = own.resource;
          else {
            found.resource.marks.push(...own.resource.marks);
            found.resource.names = [...(found.resource.names || []), ...(own.resource.names || [])];
          }
        }
        found.highlighted = found.highlighted || own.highlighted;
        found.named = found.named || own.named;
        if (!found.id && own.id) found.id = own.id;
        for (const key of keys) remember(key, found);
        anchor = rows.indexOf(found);
        continue;
      }
      const row = { ...own, snapshotId };
      partOf.set(row, k);
      rows.splice(anchor + 1, 0, row);
      anchor += 1;
      for (const key of keys) remember(key, row);
    }
  }

  return {
    ...base,
    days,
    activities: rows,
    unknown: [...new Set(list.flatMap(({ view }) => view.unknown || []))],
  };
}

/**
 * Who the sheet says is away, and on which day.
 *
 * One entry per day cell written on a "PTO" or "Other Group / Project" row:
 * `{ kind, row, date, written }`, where `written` is the spelling that was
 * typed. Nothing is matched to a person here — that is the register's job, the
 * same as for the Resource row — and nothing is invented for a day the sheet
 * left blank.
 *
 * Derived at paint time rather than stored, for the reason the whole 4WLA
 * reading is: `rc_leave` is the record of leave somebody *booked*, and writing
 * the workbook into it would make the sheet's authorship indistinguishable from
 * a decision, go stale the moment somebody edited a cell, and need cancelling to
 * correct something nobody ever booked.
 */
export function absencesFrom(view) {
  const dayByCol = new Map((view?.days || []).map((d) => [d.col, d]));
  const out = [];
  for (const activity of view?.activities || []) {
    if (!activity.absence) continue;
    for (const mark of activity.marks) {
      const written = String(mark.value || '').trim();
      if (!written) continue;
      const day = dayByCol.get(mark.col);
      if (!day?.date) continue;
      out.push({ kind: activity.absence, row: activity.row, date: day.date, written });
    }
  }
  return out;
}

/**
 * Which of the activity columns is the location, off the sheet's own heading.
 *
 * Found, like the date axis, rather than configured — for the same reason and
 * with the same failure in mind: a column pinned by letter or by position is
 * wrong the first time somebody inserts one, and wrong *silently*, because the
 * rows still write and every one of them records the wrong place.
 *
 * The heading is what the workbook calls the column, so that is what is read.
 * `-1` means it says nothing recognisable, and the caller falls back to asking
 * the alias register which cell it knows — which is what this module did
 * everywhere before, and still the only answer available on a sheet with no
 * headings at all.
 */
export function locationColumnOf(view) {
  const headings = view?.headings || [];
  for (let i = 0; i < headings.length; i++) {
    if (/\blocations?\b/i.test(headings[i])) return i;
  }
  // "Site" is the other word this project's sheets use for it. Deliberately a
  // short list: a near miss here misfiles every row on the sheet at once.
  for (let i = 0; i < headings.length; i++) {
    if (/\bsite\b/i.test(headings[i])) return i;
  }
  return -1;
}

/**
 * The codes typed on an activity's day, each with whether it is struck out.
 *
 * "X.WIT" is one EIC and one BART witness, pieces between dots, spacing and
 * case ignored. A piece with a leading tilde — "X.~WIT" — is a resource that
 * was asked for and then cancelled while the activity itself went ahead: the
 * editor writes it, the calendar draws it struck through in red, and
 * `rc_cancelled_support_days` puts it in the cancellation log. Written into the
 * text rather than a column of its own so that it travels wherever the cell
 * already does — undo, copy, the published grid, every stored read.
 */
export function cellTokens(text) {
  const out = [];
  for (const piece of String(text ?? '').split('.')) {
    const t = piece.trim();
    const cancelled = t.startsWith('~');
    const code = (cancelled ? t.slice(1) : t).trim().toUpperCase();
    if (code) out.push({ code, cancelled });
  }
  return out;
}

/** "3 X · 1 WIT" — codes counted across days, in the order first met. */
export function countCodes(values, { cancelled = false } = {}) {
  const counts = new Map();
  for (const v of values || []) {
    for (const t of cellTokens(v)) {
      if (t.cancelled !== cancelled) continue;
      counts.set(t.code, (counts.get(t.code) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Whether a legend meaning says a day was cancelled — the one rule, the same
 * word `ingest()` looks for in the legend and `rc_cancelled_days` looks for in
 * the stored cells.
 */
export function isCancelMeaning(meaning) {
  return /cancel/i.test(String(meaning || ''));
}

/* ── Suggestions for the timeline ──────────────────────────────────────── */

/**
 * The look-ahead as bars somebody might want on the plan.
 *
 * One suggestion per **run of painted cells**: consecutive day columns on one
 * activity whose paint counts as work (`role === 'shift'`, the same test that
 * decides whether a row is highlighted at all). Two runs on one row are two
 * suggestions, because a gap in the paint is the workbook saying the work
 * stops there — joining them would put a bar across the days nobody is on it.
 * Adjacent means adjacent *on the sheet*: a weekend the workbook hides is not a
 * gap, because nobody reading the sheet sees one there.
 *
 * Headings, absence rows and rows nobody described are not work and never
 * suggest anything — the same three exclusions the calendar makes.
 *
 * Dates come back as UTC-midnight milliseconds, half-open like a bar on the
 * timeline: `end` is the day *after* the last painted cell, so a single
 * painted day is a one-day bar rather than a zero-width one. A sheet whose
 * axis could not be dated (`datePlease()` refused it) suggests nothing, since
 * a bar at a guessed date is worse than no bar.
 */
export function suggestionsFrom(view) {
  const days = (view?.days || []).filter((d) => d.date);
  if (!days.length || days.length !== (view?.days || []).length) return [];

  const locCol = locationColumnOf(view);
  const titleCol = titleColumnOf(view, locCol);
  const out = [];

  for (const activity of view.activities || []) {
    if (activity.heading || activity.absence || !activity.named) continue;

    const workAt = new Map();
    for (const mark of marksOf(activity)) {
      if (!mark.hex || mark.role !== 'shift') continue;
      if (!workAt.has(mark.col)) workAt.set(mark.col, []);
      workAt.get(mark.col).push(mark);
    }
    if (!workAt.size) continue;

    const namesAt = new Map();
    for (const entry of activity.resource?.names || []) namesAt.set(entry.col, entry.names);

    const meta = activity.meta || [];
    const location = locCol >= 0 ? (meta[locCol] || '') : '';
    const title = (titleCol >= 0 ? meta[titleCol] : '') || longest(meta.filter((_, i) => i !== locCol)) || location;
    const label = meta.filter(Boolean).join(' · ');

    let run = null;
    const close = () => {
      if (!run) return;
      out.push({
        key: suggestionKey(label),
        title,
        location,
        label,
        row: activity.row,
        start: isoMs(run.first),
        end: isoMs(run.last) + 86400000,
        days: run.count,
        meanings: [...run.meanings],
        resources: [...run.resources],
      });
      run = null;
    };

    for (const day of days) {
      const marks = workAt.get(day.col);
      if (!marks) {
        close();
        continue;
      }
      if (!run) run = { first: day.date, last: day.date, count: 0, meanings: new Set(), resources: new Set() };
      run.last = day.date;
      run.count++;
      for (const mark of marks) run.meanings.add(mark.meaning || `#${mark.hex}`);
      for (const name of namesAt.get(day.col) || []) run.resources.add(name);
    }
    close();
  }

  return out;
}

/**
 * What the look-ahead has on one day: the sheet read down a single column.
 *
 * The phone's reading of the calendar. A hundred days across by a hundred and
 * forty rows down is the workbook's shape and a laptop's, and on a phone it is a
 * spreadsheet viewed through a letterbox — so the phone asks the question
 * somebody standing on site actually has, "what is on today, and who is on it",
 * and this is the answer. It is the same view every other screen draws: the
 * same `readGrid()` output, the same rule for work (`role === 'shift'` on the
 * activity line or its Resource row, via `marksOf()`), the same three
 * exclusions — headings as titles, rows of names about people, rows nobody
 * described.
 *
 * An activity is on the day when the day carries work paint **or** when its
 * Resource row names somebody on it. The second clause is not a loosening: a
 * name on a day is what makes it that person's plan (`assignmentIndex()`), and
 * an agenda that left out a day the week plan shows as somebody's task would be
 * the two screens disagreeing about the same cell.
 *
 * Each item carries the section heading it sits under, the legend's word for
 * the paint (`meaning`, null when the day is only named), what the activity cell
 * itself says ("X.WIT"), the names, and every other labelled column as a
 * `details` pair — the phone draws those rather than guess which matter. The
 * rows that say who is away come back apart, in `away`, grouped by kind.
 *
 * Null when the day is not on the sheet's dated axis: a sheet whose year could
 * not be resolved has no "Tuesday the 8th" to answer for, and inventing one
 * would be the guess `datePlease()` refused.
 */
export function agendaFor(view, iso) {
  const day = (view?.days || []).find((d) => d.date === iso);
  if (!day) return null;

  const locCol = locationColumnOf(view);
  const titleCol = titleColumnOf(view, locCol);
  const headings = view.headings || [];
  const items = [];
  const awayByKind = new Map();
  let section = '';

  for (const activity of view.activities || []) {
    const meta = activity.meta || [];

    if (activity.absence) {
      const mark = activity.marks.find((m) => m.col === day.col && String(m.value || '').trim());
      if (!mark) continue;
      const held = awayByKind.get(activity.absence) || [];
      for (const name of resourceNames(mark.value)) if (!held.includes(name)) held.push(name);
      awayByKind.set(activity.absence, held);
      continue;
    }

    /* A heading opens a section whatever else it is. One carrying a shift is
       also work — the calendar judges it that way, for the reason `drawn()`
       gives — so it falls through to be read as an activity too. */
    if (activity.heading) section = meta.filter(Boolean)[0] || section;
    if (!activity.named) continue;

    const work = marksOf(activity).filter((m) => m.col === day.col && m.hex && m.role === 'shift');
    // The activity line's own paint first: the Resource row's only fills in.
    const paint = work.find((m) => activity.marks.includes(m)) || work[0] || null;
    const names = (activity.resource?.names || []).find((n) => n.col === day.col)?.names || [];
    if (!paint && !names.length) continue;
    if (activity.heading && !paint) continue;

    const location = locCol >= 0 ? (meta[locCol] || '') : '';
    const title = (titleCol >= 0 ? meta[titleCol] : '')
      || longest(meta.filter((_, i) => i !== locCol)) || location;
    const cell = activity.marks.find((m) => m.col === day.col)?.value || '';

    items.push({
      row: activity.row,
      section: activity.heading ? '' : section,
      title,
      location,
      meaning: paint?.meaning || null,
      hex: paint?.hex || null,
      cancelled: isCancelMeaning(paint?.meaning),
      value: cell,
      names,
      details: meta
        .map((value, i) => ({ heading: String(headings[i] || '').trim(), value, i }))
        .filter((d) => d.value && d.i !== locCol && d.value !== title)
        .map(({ heading, value }) => ({ heading, value })),
    });
  }

  const away = [...awayByKind.entries()].map(([kind, names]) => ({
    kind, label: ABSENCE_LABELS[kind] || kind, names,
  }));
  return { date: iso, weekday: day.weekday, weekend: day.weekend, items, away };
}

/**
 * The column that says what the work *is*, off the sheet's own heading.
 * Found like the location column is, and for the same reason; -1 when nothing
 * is labelled, and the caller falls back to the longest description it has.
 *
 * **A description beats an activity, and an identifier is never either.** BART's
 * sheet opens "Activity ID, Description of Work Activity, …", and the first
 * heading with "activit" in it is the ID — so a single pass over one pattern
 * titled every suggestion, and every row on the phone's agenda, with a CDRL
 * number. The fixture the suggestions were tested on had no ID column, which is
 * why it read correctly there and nowhere else.
 */
function titleColumnOf(view, locCol) {
  const headings = view?.headings || [];
  /* In order of preference, and a heading shaped like an identifier is never
     taken whichever word it carries — "Activity ID", "Task No.", "Scope Ref". */
  const identifier = /\b(id|no|nos|number|ref|code)\b|#/i;
  const wants = [/\bdescr/i, /\b(task|scope)/i, /\bactivit/i];
  for (const re of wants) {
    for (let i = 0; i < headings.length; i++) {
      if (i !== locCol && re.test(headings[i]) && !identifier.test(headings[i])) return i;
    }
  }
  return -1;
}

function longest(values) {
  return values.reduce((best, v) => (String(v || '').length > best.length ? String(v) : best), '');
}

function isoMs(iso) {
  return Date.parse(`${iso}T00:00:00Z`);
}

/**
 * What identifies a suggestion from one read of the sheet to the next.
 *
 * The workbook has no IDs, so this is the activity's own words, folded for case
 * and spacing — the only thing a row carries from one week to the next. It is
 * a weak key and knowingly so, for the reason `rowKey()` is: rewording a row
 * makes it a new suggestion and the old one gone, which is noisy but visible,
 * where matching on anything looser would quietly move somebody's bar onto a
 * different piece of work.
 */
export function suggestionKey(label) {
  return String(label || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** How far apart two runs of one activity may start and still be one run moved. */
const SAME_RUN_DAYS = 14;

/**
 * Bring a register of suggestions up to date with a new read of the sheet.
 *
 * `existing` is `{ id → entry }`, `incoming` what `suggestionsFrom()` returned.
 * A run is matched to an entry with the same key — overlapping dates first, then
 * the nearest start within a fortnight — so an entry keeps its id, and therefore
 * its links and its dismissal, while the sheet moves its dates. What cannot be
 * matched is new, and what is left over is one of two very different things:
 *
 * - **It ended before the file's window starts.** The window rolled past it;
 *   nothing was removed. Kept (as `past`) only if a bar is linked to it —
 *   otherwise it is a suggestion for work already over, and a register that
 *   kept every one of them would grow by a sheet's worth every week.
 * - **It is inside the window and the sheet no longer carries it.** Kept and
 *   flagged `missing` when a bar points at it, never removed; an unlinked one
 *   simply goes, because nothing depends on it.
 *
 * Pure, with the id generator and the linked set injected, so the whole thing
 * is tested with no browser. Returns `{ activities, added, moved, unchanged,
 * missing, retired }`, where the lists hold ids and `moved` carries the shift.
 */
export function reconcileSuggestions(existing, incoming, {
  linked = new Set(), makeId = counterId(), windowStart = null,
} = {}) {
  const before = Object.values(existing || {});
  const byKey = new Map();
  for (const entry of before) {
    if (!byKey.has(entry.key)) byKey.set(entry.key, []);
    byKey.get(entry.key).push(entry);
  }

  const pairs = [];
  incoming.forEach((run, index) => {
    for (const entry of byKey.get(run.key) || []) {
      const overlap = run.start < entry.end && entry.start < run.end;
      const apart = Math.abs(run.start - entry.start) / 86400000;
      if (!overlap && apart > SAME_RUN_DAYS) continue;
      pairs.push({ index, entry, overlap, apart, finish: Math.abs(run.end - entry.end) });
    }
  });
  pairs.sort((a, b) => (b.overlap - a.overlap) || (a.apart - b.apart) || (a.finish - b.finish) || (a.index - b.index));

  const takenRun = new Set();
  const takenEntry = new Set();
  const activities = {};
  const report = { added: [], moved: [], unchanged: [], missing: [], retired: 0 };

  for (const pair of pairs) {
    if (takenRun.has(pair.index) || takenEntry.has(pair.entry.id)) continue;
    takenRun.add(pair.index);
    takenEntry.add(pair.entry.id);
    const run = incoming[pair.index];
    const entry = pair.entry;
    const changed = run.start !== entry.start || run.end !== entry.end;
    activities[entry.id] = {
      ...entry,
      ...run,
      id: entry.id,
      order: pair.index,
      previous: changed ? { start: entry.start, end: entry.end } : null,
      missing: false,
      past: false,
    };
    if (changed) {
      report.moved.push({
        id: entry.id,
        startShift: Math.round((run.start - entry.start) / 86400000),
        finishShift: Math.round((run.end - entry.end) / 86400000),
      });
    } else {
      report.unchanged.push(entry.id);
    }
  }

  incoming.forEach((run, index) => {
    if (takenRun.has(index)) return;
    const id = makeId();
    activities[id] = { ...run, id, order: index, previous: null, missing: false, past: false, dismissed: false };
    report.added.push(id);
  });

  for (const entry of before) {
    if (takenEntry.has(entry.id)) continue;
    if (!linked.has(entry.id)) {
      report.retired++;
      continue;
    }
    const rolledOff = windowStart != null && entry.end <= windowStart;
    activities[entry.id] = { ...entry, previous: null, missing: !rolledOff, past: rolledOff };
    if (!rolledOff) report.missing.push(entry.id);
  }

  return { activities, ...report };
}

function counterId() {
  let n = 0;
  return () => `la_${++n}`;
}

/* ── The cancellation log ──────────────────────────────────────────────── */

/**
 * Red days, as cancellation events.
 *
 * `days` is what `rc_cancelled_days` returns: one row per activity, location
 * and day that any read showed as cancelled. Cells side by side on one activity
 * are one event — a cancelled week is one thing that happened, not five — so
 * consecutive days on the same activity and location are joined, and a gap of a
 * single uncancelled day starts a new event. Days before `from` are left out.
 *
 * Returns events oldest first: `{ key, label, location, locationId, start, end,
 * days, firstSeen, lastSeen, reads }`, with `start` and `end` as ISO dates, both
 * inclusive, because that is how a person reads "cancelled 7–11 September".
 */
/**
 * Whether a stored label is a names row rather than an activity — "Resource",
 * or a row whose columns include it. Readings taken before orphaned names rows
 * were dropped stored some as activities; they are never cancellations.
 */
function isNamesLabel(label) {
  return String(label || '').split(' · ').some(isResourceLabel);
}

/** An activity and its location, as words — how a note found it before rows had ids. */
function wordsKey(r) {
  return `${suggestionKey(r.raw_label)}|${suggestionKey(r.raw_location)}`;
}

/* A later day of the same editor row whose words have changed since — its
   Activity ID filled in, its description corrected — is still the same event:
   it takes the newer words, and keeps the older ones a note may have been
   written against. */
function joinWords(event, d) {
  const k = wordsKey(d);
  if (event.keys.includes(k)) return;
  event.keys.push(k);
  event.key = k;
  event.label = d.raw_label || '';
  event.location = d.raw_location || '';
}

/**
 * Days cancelled outright, as events.
 *
 * Consecutive days of one activity are one event. An activity is the editor's
 * row where the reading carries it (`la_row_id`), so changing the row's words
 * neither splits an event nor loses what was said about it; a reading from the
 * workbook has only the words, and is grouped by them and the location.
 */
export function cancellationEvents(days, { from = null } = {}) {
  const groups = new Map();
  for (const d of days || []) {
    const day = String(d.day || '').slice(0, 10);
    if (!day || (from && day < from) || isNamesLabel(d.raw_label)) continue;
    const group = d.la_row_id ? `row:${d.la_row_id}` : wordsKey(d);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ ...d, day });
  }

  /** @type {any[]} */
  const out = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    let event = null;
    for (const d of list) {
      if (event && isoMs(d.day) - isoMs(event.end) === 86400000) {
        event.end = d.day;
        event.days++;
        event.firstSeen = earlier(event.firstSeen, d.first_seen);
        event.lastSeen = later(event.lastSeen, d.last_seen);
        event.reads = Math.max(event.reads, d.reads || 0);
        event.locationId = event.locationId || d.location_id || null;
        event.marks.push(d.marks || '');
        joinWords(event, d);
        continue;
      }
      if (event) out.push(event);
      event = {
        key: wordsKey(d),
        keys: [wordsKey(d)],
        laRowId: d.la_row_id || null,
        kind: 'activity',
        codes: '',
        label: d.raw_label || '',
        location: d.raw_location || '',
        locationId: d.location_id || null,
        start: d.day,
        end: d.day,
        days: 1,
        firstSeen: d.first_seen || null,
        lastSeen: d.last_seen || null,
        reads: d.reads || 0,
        marks: [d.marks || ''],
      };
    }
    if (event) out.push(event);
  }
  /* What BART had been asked for on those days went with them: "X.WIT" on a
     red day is an EIC and a witness cancelled as well as the work. */
  for (const e of out) e.resources = countCodes(e.marks);
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label));
}

/**
 * BART resources struck out of an activity that still went ahead, as events.
 *
 * `days` is what `rc_cancelled_support_days` returns. Consecutive days on one
 * activity and location that struck out the same codes are one event — the
 * witness taken off Monday to Wednesday is one thing that happened — and a day
 * that struck out something else starts another. Shaped like
 * `cancellationEvents()`, with `kind: 'support'`, `codes` ("WIT", "TCE.WIT")
 * and `resources`, the struck codes counted across the days.
 */
export function supportCancellationEvents(days, { from = null } = {}) {
  const groups = new Map();
  for (const d of days || []) {
    const day = String(d.day || '').slice(0, 10);
    if (!day || (from && day < from) || isNamesLabel(d.raw_label)) continue;
    const codes = [...new Set(cellTokens(d.marks).filter((t) => t.cancelled).map((t) => t.code))].sort().join('.');
    if (!codes) continue;
    const group = `${d.la_row_id ? `row:${d.la_row_id}` : wordsKey(d)}|${codes}`;
    if (!groups.has(group)) groups.set(group, { codes, list: [] });
    groups.get(group).list.push({ ...d, day });
  }

  /** @type {any[]} */
  const out = [];
  for (const { codes, list } of groups.values()) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    let event = null;
    for (const d of list) {
      if (event && isoMs(d.day) - isoMs(event.end) === 86400000) {
        event.end = d.day;
        event.days++;
        event.firstSeen = earlier(event.firstSeen, d.first_seen);
        event.lastSeen = later(event.lastSeen, d.last_seen);
        event.reads = Math.max(event.reads, d.reads || 0);
        event.locationId = event.locationId || d.location_id || null;
        event.marks.push(d.marks || '');
        joinWords(event, d);
        continue;
      }
      if (event) out.push(event);
      event = {
        key: wordsKey(d),
        keys: [wordsKey(d)],
        laRowId: d.la_row_id || null,
        kind: 'support',
        codes,
        label: d.raw_label || '',
        location: d.raw_location || '',
        locationId: d.location_id || null,
        start: d.day,
        end: d.day,
        days: 1,
        firstSeen: d.first_seen || null,
        lastSeen: d.last_seen || null,
        reads: d.reads || 0,
        marks: [d.marks || ''],
      };
    }
    if (event) out.push(event);
  }
  for (const e of out) e.resources = countCodes(e.marks, { cancelled: true });
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label));
}

/**
 * Only the codes BART provides, from a count of codes.
 *
 * The support-code register says who provides each code (`party`). The
 * cancellation log is about what BART was asked for and lost, so a code the
 * register gives to Hitachi — or anybody else — is left out. A code the
 * register has never heard of is kept: dropping it would be guessing who it
 * belongs to.
 */
export function bartCodes(counts, codes) {
  const party = new Map((codes || []).map((c) => [String(c.code).toUpperCase(), String(c.party || 'BART')]));
  const out = new Map();
  for (const [code, n] of counts || new Map()) {
    const who = party.get(code);
    if (who == null || /^bart$/i.test(who)) out.set(code, n);
  }
  return out;
}

/** "3 X · 1 WIT" from a count of codes. */
export function describeCodeCounts(counts) {
  return [...(counts || new Map()).entries()].map(([code, n]) => `${n} ${code}`).join(' · ');
}

function earlier(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(a) < String(b) ? a : b;
}

function later(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(a) > String(b) ? a : b;
}

/**
 * Put each event beside what somebody said about it.
 *
 * A note is kept against the activity and the dates it was made about, not an
 * event id — the event has none, and the sheet keeps moving: a week cancelled on
 * Monday grows to a fortnight by Wednesday, and Monday's reason has to follow
 * it. So a note belongs to the event on the same activity and location whose
 * days it overlaps. Only notes nobody has superseded count; the newest of those
 * is the answer, and every note that touched the event is kept as its history.
 *
 * Returns the events, each with `note` (or null) and `history`.
 */
export function attachCancellationNotes(events, notes) {
  const superseded = new Set((notes || []).map((n) => n.supersedes_id).filter(Boolean));
  const byKey = new Map();
  for (const n of notes || []) {
    const key = `${suggestionKey(n.raw_label)}|${suggestionKey(n.raw_location)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(n);
  }
  /* A note about struck-out resources ("WIT") belongs to a resource event that
     struck out one of those codes, never to the day's own cancellation, and a
     note about the day never to a resource event — the same activity and the
     same dates can carry both, and they are different judgements. */
  const codesOf = (v) => new Set(String(v || '').split('.').map((c) => c.trim().toUpperCase()).filter(Boolean));
  const sameKind = (n, event) => {
    const mine = codesOf(event.codes);
    const theirs = codesOf(n.codes);
    if (!mine.size || !theirs.size) return !mine.size && !theirs.size;
    return [...theirs].some((c) => mine.has(c));
  };
  /* The row first: a note written about an editor row is that row's, whatever
     its words say now — and never another row's that happens to read the same.
     A note or an event with no row falls back to the words. */
  const about = (event) => {
    const byWords = (event.keys || [event.key]).flatMap((k) => byKey.get(k) || []);
    const byRow = event.laRowId ? (notes || []).filter((n) => n.la_row_id === event.laRowId) : [];
    return [...new Set([...byRow, ...byWords])]
      .filter((n) => !(event.laRowId && n.la_row_id) || n.la_row_id === event.laRowId);
  };
  return events.map((event) => {
    const touching = about(event)
      .filter((n) => sameKind(n, event))
      .filter((n) => String(n.start_date) <= event.end && String(n.end_date) >= event.start)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const current = touching.filter((n) => !superseded.has(n.id));
    const note = current[current.length - 1] || null;
    // Taken out of the log by somebody who said it was never a cancellation.
    return { ...event, note, history: touching, dismissed: !!note?.dismissed };
  });
}

/**
 * The note logged for one cancelled day of one activity on the grid — what a
 * hover over a red day, or a struck-out code, says the reason was.
 *
 * Matched the way `attachCancellationNotes()` matches an event: the activity's
 * own words, a location the row carries, a date the note covers, and the same
 * kind — a note about struck-out codes ("WIT") is never the day's, and a note
 * about the day never a code's. The newest note still standing wins; one that
 * took the day out of the log says it was never a cancellation, so it gives
 * no reason. `meta` is the row's frozen cells, whichever of them is the
 * location. `rowId` is the editor's row, where the grid knows it: a note
 * written about that row is found whatever the row's words have become.
 */
export function cancellationNoteFor(notes, { label, meta = [], day, codes = '', rowId = null }) {
  if (!notes?.length || !day) return null;
  const superseded = new Set(notes.map((n) => n.supersedes_id).filter(Boolean));
  const key = suggestionKey(label);
  const places = new Set(meta.map(suggestionKey).filter(Boolean));
  const codesOf = (v) => new Set(String(v || '').split('.').map((c) => c.trim().toUpperCase()).filter(Boolean));
  const mine = codesOf(codes);
  const hit = notes
    .filter((n) => !superseded.has(n.id))
    .filter((n) => (rowId && n.la_row_id
      ? n.la_row_id === rowId
      : suggestionKey(n.raw_label) === key
        && (!suggestionKey(n.raw_location) || places.has(suggestionKey(n.raw_location)))))
    .filter((n) => String(n.start_date).slice(0, 10) <= day && String(n.end_date).slice(0, 10) >= day)
    .filter((n) => {
      const theirs = codesOf(n.codes);
      if (!mine.size || !theirs.size) return !mine.size && !theirs.size;
      return [...theirs].some((c) => mine.has(c));
    })
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .pop();
  return hit && !hit.dismissed ? hit : null;
}

/** A note as a hover reads it: "BART — possession not granted". */
export function cancellationReasonText(note) {
  if (!note) return '';
  const reason = String(note.reason || '').trim();
  return [note.party, reason].filter(Boolean).join(' — ');
}

/* ══════════════════════════════════════════════════════════════════════════
   Progress from the calendar

   The daily huddle records what each person actually did, and the timeline
   has had `actualStart` / `actualEnd` fields nobody filled in. This joins the
   two: an outcome is traced to the look-ahead row it was recorded against, the
   row to the suggestion a bar is linked to, and the bar is offered the first
   and last day anybody worked on it.

   Offered, never written. The same rule as the rest of the register: a read of
   the calendar proposes, and somebody says yes. A bar may stand for several
   activities, and each is read on its own: the start is the first day any of
   them was worked, and a finish is only offered when *every* one has nothing
   left on the look-ahead and its own last word was "completed" — a gap in the
   outcomes is not the end of the work, and one activity finishing is not the
   bar finishing.
   ═══════════════════════════════════════════════════════════════════════ */

/** Statuses that say somebody worked on the task that day. */
export const WORKED_STATUSES = ['completed', 'partial', 'carried'];

/**
 * What the outcomes say about each linked bar.
 *
 * `objects` are the plan's objects (only those with `data.laIds` count);
 * `activities` is the register's id → entry map; `actuals` are rows of
 * `rc_actuals_current`; `rows` are the `rc_lookahead_rows` those outcomes (or
 * their plan entries in `plan`) point at. An outcome with a row is matched
 * through the row's label; one without falls back to its task text, which a
 * day read off the sheet carries verbatim. Both go through `suggestionKey()`,
 * so a match is exact or nothing.
 *
 * A bar's linked runs are grouped by that key — several runs of one row are one
 * activity — and each activity is summarised on its own in `activities`:
 * `{ key, title, days, first, last, lastStatus, ahead, recorded, done }`.
 *
 * Returns one proposal per bar with at least one worked day:
 * `{ objectId, first, last, days, people, lastStatus, start, end, byRow,
 *    byTask, activities, holding }` with `start` / `end` as UTC-midnight ms (end
 * half-open, like the bar). `end` is null unless every activity is `done`;
 * `holding` names the ones that are not.
 */
export function outcomeProgress({ objects = [], activities = {}, actuals = [], rows = [], plan = [], todayMs = Date.now() } = {}) {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const planById = new Map(plan.map((p) => [p.id, p]));

  // Each bar's activities, by key, and the bars each key belongs to.
  const barKeys = new Map(); // bar id → Map(key → { title, ahead })
  const barsByKey = new Map();
  for (const obj of objects) {
    const ids = Array.isArray(obj?.data?.laIds) ? obj.data.laIds : [];
    for (const id of ids) {
      const entry = activities[id];
      if (!entry?.key) continue;
      if (!barKeys.has(obj.id)) barKeys.set(obj.id, new Map());
      const keys = barKeys.get(obj.id);
      const known = keys.get(entry.key) || { title: entry.title || entry.label || '', ahead: false };
      if (!entry.dismissed && Number.isFinite(entry.end) && entry.end > todayMs) known.ahead = true;
      keys.set(entry.key, known);
      if (!barsByKey.has(entry.key)) barsByKey.set(entry.key, new Set());
      barsByKey.get(entry.key).add(obj.id);
    }
  }
  if (!barsByKey.size) return [];

  // What was recorded against each key: the day's word, who, and how it matched.
  const byKey = new Map();
  for (const a of actuals) {
    if (!WORKED_STATUSES.includes(a.status) || !a.work_date) continue;
    const rowId = a.lookahead_row_id || planById.get(a.plan_entry_id)?.lookahead_row_id || null;
    const row = rowId ? rowById.get(rowId) : null;
    const key = suggestionKey(row ? row.raw_label : a.task);
    if (!key || !barsByKey.has(key)) continue;
    if (!byKey.has(key)) byKey.set(key, { dates: new Map(), people: new Set(), byRow: 0, byTask: 0 });
    const acc = byKey.get(key);
    const prev = acc.dates.get(a.work_date);
    // Several people on one day: "completed" from anybody is the day's word.
    if (!prev || a.status === 'completed') acc.dates.set(a.work_date, a.status);
    if (a.person_id) acc.people.add(a.person_id);
    if (row) acc.byRow++;
    else acc.byTask++;
  }

  const out = [];
  for (const obj of objects) {
    const keys = barKeys.get(obj.id);
    if (!keys || ![...keys.keys()].some((k) => byKey.has(k))) continue;
    const people = new Set();
    let byRow = 0;
    let byTask = 0;
    const summary = [];
    for (const [key, { title, ahead }] of keys) {
      const acc = byKey.get(key);
      const dates = acc ? [...acc.dates.keys()].sort() : [];
      const last = dates[dates.length - 1] || null;
      const lastStatus = last ? acc.dates.get(last) : null;
      if (acc) {
        acc.people.forEach((p) => people.add(p));
        byRow += acc.byRow;
        byTask += acc.byTask;
      }
      summary.push({
        key,
        title,
        days: dates.length,
        first: dates[0] || null,
        last,
        lastStatus,
        ahead,
        recorded: dates.length > 0,
        done: !ahead && lastStatus === 'completed',
      });
    }
    const worked = summary.filter((a) => a.recorded);
    const first = worked.map((a) => a.first).sort()[0];
    const last = worked.map((a) => a.last).sort().pop();
    const allDates = new Set();
    for (const a of worked) for (const d of byKey.get(a.key).dates.keys()) allDates.add(d);
    const done = summary.every((a) => a.done);
    out.push({
      objectId: obj.id,
      first,
      last,
      days: allDates.size,
      people: people.size,
      lastStatus: worked.find((a) => a.last === last)?.lastStatus || null,
      start: isoMs(first),
      end: done ? isoMs(last) + 86400000 : null,
      byRow,
      byTask,
      activities: summary,
      holding: summary.filter((a) => !a.done).map((a) => a.title),
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   Only my rows

   The look-ahead is a hundred-odd activities for the whole team, and somebody
   on it wants the handful they are on. A names row belongs to the activity
   line above it — that line is the work, and the names row says who lands on
   each day of it — so the activity is what is kept, and it is drawn with its
   names row under it as always. Section headings above a kept activity are
   kept too, for the same reason they are in the editor's search: a row of work
   with no section over it has lost where it sits in the plan.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The activities (and away rows) whose names name this person, in the days
 * given, with the headings above them.
 *
 * `isMe(written)` answers whether a written name is this person — injected,
 * because the register lives with the calendar. `cols`, when given, limits the
 * question to the columns on screen: being named in a week nobody is looking
 * at does not make a row yours this week. Rows with nothing scheduled are not
 * dropped here: a row that names you is yours whether or not it is painted.
 */
export function rowsNaming(activities, isMe, cols = null) {
  const rows = activities || [];
  const inView = (col) => !cols || cols.has(col);
  const names = (a) => (a.absence
    ? (a.marks || []).filter((m) => m.value && inView(m.col)).flatMap((m) => resourceNames(m.value))
    : (a.resource?.names || []).filter((n) => inView(n.col)).flatMap((n) => n.names));
  const keep = new Array(rows.length).fill(false);
  let sectionHasMine = false;
  let belowIsKeptTitle = false;
  for (let i = rows.length - 1; i >= 0; i--) {
    const a = rows[i];
    if (a.heading && !a.absence) {
      keep[i] = sectionHasMine || belowIsKeptTitle;
      sectionHasMine = false;
      belowIsKeptTitle = keep[i];
      continue;
    }
    keep[i] = names(a).some((n) => isMe(n));
    if (keep[i] && !a.absence) sectionHasMine = true;
    belowIsKeptTitle = false;
  }
  return rows.filter((_, i) => keep[i]);
}

/* ══════════════════════════════════════════════════════════════════════════
   One activity, whole

   What somebody sees when they tap a task: every column of the activity's
   line under the sheet's own headings, and every day it has anything on —
   the shift the paint means, whether it was cancelled, what is written in the
   cell, and who the names row puts on it.
   ═══════════════════════════════════════════════════════════════════════ */

/** The activity's name, found the way a suggestion's title is. */
export function activityTitle(view, activity) {
  const meta = activity?.meta || [];
  const locCol = locationColumnOf(view);
  const titleCol = titleColumnOf(view, locCol);
  return (titleCol >= 0 ? meta[titleCol] : '') || longest(meta.filter((_, i) => i !== locCol)) || meta.find(Boolean) || '';
}

/**
 * Every day the activity carries something on, from `fromISO` on (all of them
 * when the axis is undated): `[{ date, col, meaning, hex, shift, cancelled,
 * text, names, mine }]`. `shift` is true when the paint is work; `mine` when
 * `isMe` answers yes for a name on that day.
 *
 * @param {object} view
 * @param {object} activity
 * @param {{ fromISO?: string | null, isMe?: (name: string) => boolean }} [options]
 */
export function activityDays(view, activity, { fromISO = null, isMe = () => false } = {}) {
  const marks = new Map((activity?.marks || []).map((m) => [m.col, m]));
  const names = new Map((activity?.resource?.names || []).map((n) => [n.col, n.names]));
  const out = [];
  for (const d of view?.days || []) {
    if (fromISO && d.date && d.date < fromISO) continue;
    const mark = marks.get(d.col);
    const who = names.get(d.col) || [];
    const shift = Boolean(mark?.hex && mark.role === 'shift');
    if (!shift && !mark?.value && !who.length && !(mark?.hex && isCancelMeaning(mark.meaning))) continue;
    out.push({
      date: d.date || null,
      col: d.col,
      label: d.date || `${d.month || ''} ${d.day || ''}`.trim(),
      meaning: mark?.meaning || '',
      hex: mark?.hex || null,
      shift,
      cancelled: Boolean(mark?.hex && isCancelMeaning(mark.meaning)),
      text: mark?.value || '',
      names: who,
      mine: who.some((n) => isMe(n)),
    });
  }
  return out;
}
