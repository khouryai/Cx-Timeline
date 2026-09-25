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
 * Stored days whose look-ahead row now names somebody else.
 *
 * The 4WLA's Resource row is the plan for the days it names, so a stored
 * `rc_plan_entries` row carrying a `lookahead_row_id` is somebody having
 * confirmed or overridden what that row said. When a later read of the sheet
 * puts a different name on the same row for the same day, the work has moved —
 * and until this existed the entry stayed against whoever it was first written
 * for. The visible cost is somebody turning up for a shift that is not theirs
 * any more while the person who now has it has a blank against their name.
 *
 * `resolve` is the name lookup, **injected** for the reason `rowsFrom()` takes
 * `locate`: the register lives two layers up, this module is a leaf, and the
 * whole pipeline has to be testable with no browser and no network. It answers
 * a person id for a written name, or null.
 *
 * Returns `[{ entry, from, to }]`, and returns nothing at all unless it is
 * certain:
 *
 * **The row has to say something about that day.** A day the sheet no longer
 * names anybody on is not a reassignment — it is the sheet going quiet, which
 * happens whenever an activity is rescheduled, and moving a task to nobody is
 * not a thing that can be written.
 *
 * **It has to name exactly one person the roster knows.** Two names on a day is
 * a crew, and a crew is not "this task moved to Victor" — it is several entries,
 * which is a decision somebody takes rather than one this can derive. An
 * unmatched spelling stops it too: those are reported and answered with an
 * alias, and guessing here would be the near-miss matching the register refuses.
 *
 * **It has to be somebody else.** A re-read that changed nothing must produce
 * nothing, or every ingest would supersede every linked entry with a revision
 * saying the same thing. `rc_reassign_plan()` refuses that case as well, so it
 * is checked on both sides on purpose.
 */
export function reassignments({ planRows, laRows, resolve }) {
  const byRow = new Map();
  for (const row of laRows || []) {
    if (row?.id) byRow.set(row.id, row);
  }

  const out = [];
  for (const entry of planRows || []) {
    if (!entry?.id || !entry.lookahead_row_id) continue;
    const row = byRow.get(entry.lookahead_row_id);
    if (!row) continue;
    const written = resourceNames(row.resources?.[entry.work_date] || '');
    if (!written.length) continue;

    const ids = new Set();
    let unknown = false;
    for (const name of written) {
      const id = resolve ? resolve(name) : null;
      if (id) ids.add(id);
      else unknown = true;
    }
    // One person, and every name on the day accounted for. Anything else is a
    // crew or a spelling nobody has mapped, and neither is a move.
    if (unknown || ids.size !== 1) continue;
    const [to] = [...ids];
    if (to === entry.person_id) continue;
    out.push({ entry, from: entry.person_id, to });
  }
  return out;
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
  const metaCols = [...new Set(
    body.flatMap((r) => r.cells.filter((c) => c.col < firstDay && String(c.value ?? '').trim()).map((c) => c.col))
  )].sort((a, b) => a - b);

  /* What the sheet calls each of those columns.
     The nearest thing written in that column at or above the weekday row —
     which is where a heading is, whichever row somebody put it on. It is worth
     reading rather than guessing because one of these columns is the location,
     and knowing *which* is the difference between recording where the work is
     and recording nothing. Nothing depends on a heading existing: an unlabelled
     column is '' and is treated as it always was. */
  const headings = metaCols.map((col) => {
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
        row: row.row, meta, marks, heading: false, highlighted: false,
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

    activities.push({ row: row.row, meta, marks, heading, highlighted, named, resource: null, absence: null });
  }

  return { days, meta: metaCols, headings, activities, header: header.row };
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
 * A read grid, as rows something else can point at.
 *
 * One row per activity per *week*, because that is the grain the look-ahead is
 * maintained at and the grain a plan is made at. Two rules, both of which hold
 * everywhere else in this module:
 *
 * **The location is read from the column the sheet keeps it in, and kept
 * whether or not it resolves.** `locationColumnOf()` finds that column by its
 * heading; `locate` — the alias register, injected so this stays testable
 * without a network — turns the spelling into an id where it knows it. Nothing
 * is matched on the description: the wording differs on the two sides and is
 * not reliable enough to carry evidence, which is what the alias list is for.
 *
 * The text surviving an unresolved spelling is the part that was missing. The
 * location used to be recorded *only* where the register already knew it, so a
 * column full of "W30" and "Y10" was discarded on every deployment that had not
 * registered them — and with nothing kept there was nothing for anybody to map,
 * which is the one state this module is built to make impossible. An unresolved
 * spelling is exactly like an unmapped colour or an unmatched name: shown, and
 * one click from being answered.
 *
 * **A row with nothing scheduled that week is not a row.** The sheet carries
 * activities for reference with no shift against them, and writing those would
 * make the register mostly noise — and, worse, make every one of them look
 * like scope the first time it *did* get a shift.
 */
export async function rowsFrom(view, {
  snapshotId = null, locate = async () => null, locationColumn = null,
} = {}) {
  if (!view?.days?.length) return [];

  // Told which column, or read off the sheet's own heading. `null` is "work it
  // out"; `-1` is "there is no heading", which is the register scan below.
  const locCol = Number.isInteger(locationColumn) ? locationColumn : locationColumnOf(view);

  const dayByCol = new Map(view.days.map((d) => [d.col, d]));
  const out = [];
  const ordinals = new Map();

  for (const activity of view.activities) {
    if (activity.heading) continue;
    /* Not work, so not a row. Emitting one would put "PTO" in the register as an
       activity at no location, and `classify()` would then book it as scope
       added the first week it appeared and scope removed the week it did not. */
    if (activity.absence) continue;

    // Group this activity's marks by the week they fall in.
    const weeks = new Map();
    for (const mark of marksOf(activity)) {
      if (!mark.hex || mark.role === 'ignore') continue;
      const day = dayByCol.get(mark.col);
      if (!day?.date) continue;
      const week = mondayOf(day.date);
      if (!weeks.has(week)) weeks.set(week, { cells: {}, marks: {}, resources: {} });
      const bucket = weeks.get(week);
      bucket.cells[day.date] = mark.meaning || `#${mark.hex}`;
      if (mark.value) bucket.marks[day.date] = mark.value;
    }
    if (!weeks.size) continue;

    /* Who the Resource row names, per day, in the words the workbook used.
       Only into weeks that already have a shift in them: a name typed against a
       day nobody is scheduled on is the same kind of stray as a colour on an
       empty row, and writing it would invent a week of scope. Nothing is
       matched to a person here — that happens against the roster, where an
       unmatched name can be shown to somebody rather than guessed at. */
    for (const mark of activity.resource?.marks || []) {
      if (!mark.value) continue;
      const day = dayByCol.get(mark.col);
      const week = day?.date ? mondayOf(day.date) : null;
      if (!week || !weeks.has(week)) continue;
      weeks.get(week).resources[day.date] = mark.value;
    }

    /* Where the work is, from the column the sheet keeps it in.
       **The text is kept whether or not it resolves.** It used to be recorded
       only when the alias register already knew it, so a location column full of
       "W30" and "Y10" was *discarded* on a deployment that had not registered
       them yet — and with nothing kept there was nothing for anybody to map,
       which is the one state this design is supposed to make impossible. An
       unresolved spelling is exactly like an unmapped colour or an unmatched
       name: shown, and one click from being answered. */
    let locationId = null;
    let rawLocation = null;
    if (locCol >= 0) {
      rawLocation = activity.meta[locCol] || null;
      locationId = rawLocation ? await locate(rawLocation) : null;
    } else {
      // Nobody has said which column it is, so the register decides: the first
      // cell it recognises is the location. Still never the *description* —
      // that is matched on nothing, here or anywhere else in this module.
      for (const value of activity.meta) {
        const hit = await locate(value);
        if (hit) { locationId = hit; rawLocation = value; break; }
      }
    }
    const label = activity.meta.filter(Boolean).join(' · ');

    for (const [week, bucket] of weeks) {
      const groupKey = [week, rawLocation || '', ''].join('|');
      const ordinal = ordinals.get(groupKey) || 0;
      ordinals.set(groupKey, ordinal + 1);
      out.push({
        snapshot_id: snapshotId,
        week_start: week,
        sheet_row: activity.row,
        row_key: rowKey({ weekStart: week, location: rawLocation || '', subsystem: '', ordinal }),
        location_id: locationId,
        raw_location: rawLocation,
        raw_label: label,
        cells: bucket.cells,
        bart_marks: bucket.marks,
        resources: bucket.resources,
      });
    }
  }

  return out;
}

/** The Monday of an ISO date's week, in UTC. A calendar date must not shift. */
function mondayOf(iso) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  const back = (new Date(ms).getUTCDay() + 6) % 7;
  return new Date(ms - back * 86400000).toISOString().slice(0, 10);
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
 *
 * **A read that started recording the location is not a read where everything
 * moved.** The row key is built from the week and the location, so the first read
 * after the location began coming off the sheet's own column — rather than only
 * where the alias register already knew the spelling — keys every row
 * differently. Compared naively that is every row removed and every row added:
 * a batch of phantom scope on the one screen somebody reads a year later, booked
 * into the KPIs, over a change that is about the *keying* and not the work. It is
 * the same judgement the window rule makes, and drawn as narrowly as it can be —
 * one side recording no location at all, the other recording one, and not a
 * single key in common. A crew genuinely moving site is still a removal and an
 * addition, which is what `relinkCandidates()` is for.
 */
export function classify(before, after, { cancelledMeaning = 'cancelled' } = {}) {
  const beforeWindow = windowOf(before);
  const afterWindow = windowOf(after);

  if (before.length && after.length) {
    const keys = new Set(after.map((r) => r.rowKey));
    const located = (rows) => rows.filter((r) => String(r.location || '').trim()).length;
    const sided = located(before) === 0 !== (located(after) === 0);
    if (sided && !before.some((r) => keys.has(r.rowKey))) return [];
  }

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
        field: 'marks',
        weekStart: row.weekStart,
        rowKey: row.rowKey,
        before: prior.marks || {},
        after: row.marks || {},
      });
    }

    /* And the Resource row underneath: who is on it.
       The same kind as a mark changing rather than a kind of its own, because
       it is the same fact — the request against this activity moved without the
       shift moving — and a new kind would need the `rc_change_events` check
       constraint widened in every project that already has one. `field` is what
       tells the two apart when somebody reads the row back. */
    const whoBefore = JSON.stringify(prior.resources || {});
    const whoAfter = JSON.stringify(row.resources || {});
    if (whoBefore !== whoAfter) {
      events.push({
        kind: 'resource_changed',
        field: 'resources',
        weekStart: row.weekStart,
        rowKey: row.rowKey,
        before: prior.resources || {},
        after: row.resources || {},
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
/**
 * One line saying what an event was.
 *
 * Reads the *stored* shape: `before` and `after` are jsonb, because the table
 * has no column for a date and a row-level change needs one. `sideOf()` in
 * `ui/rc_lookahead.js` is what writes them, and the two have to agree — a
 * mismatch here shows up as "undefined → undefined" on the one screen somebody
 * reads a year later.
 */
export function describe(event) {
  const day = event.date || event.after?.date || event.before?.date || 'a day';
  switch (event.kind) {
    case 'scope_added': return `Added: ${event.after?.label || event.rowKey}`;
    case 'scope_removed': return `Removed: ${event.before?.label || event.rowKey}`;
    case 'cancellation': return `Cancelled on ${day}: was ${event.before?.value ?? event.before}`;
    case 'shift_changed':
      return `${day}: ${event.before?.value || 'nothing'} → ${event.after?.value || 'nothing'}`;
    case 'resource_changed': {
      /* The *stored* shape decides which of the two this was: `sideOf()` writes
         `{ resources }` for the Resource row and `{ marks }` for a mark on the
         activity line. A row written before Resource rows existed carries only
         the latter, and it still prints the sentence it always did rather than
         "undefined → undefined" on the one screen somebody reads a year later. */
      const who = (side) => {
        const map = side?.resources;
        if (!map || typeof map !== 'object') return null;
        return [...new Set(Object.values(map).flatMap((v) => resourceNames(v)))].join(', ');
      };
      const was = who(event.before);
      const now = who(event.after);
      if (was === null && now === null) return 'BART resource request changed';
      return `Resource: ${was || 'nobody'} → ${now || 'nobody'}`;
    }
    case 'window_advanced': return `Week ${event.weekStart} came into the window`;
    case 'window_retired': return `Week ${event.weekStart} left the window`;
    case 'location_shift': return 'Relinked as one crew moving site';
    default: return event.kind;
  }
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
 * The column that says what the work *is*, off the sheet's own heading.
 * Found like the location column is, and for the same reason; -1 when nothing
 * is labelled, and the caller falls back to the longest description it has.
 */
function titleColumnOf(view, locCol) {
  const headings = view?.headings || [];
  for (let i = 0; i < headings.length; i++) {
    if (i !== locCol && /\b(descr|activit|task|scope)/i.test(headings[i])) return i;
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
