/**
 * Small shared helpers for the resource calendar's tabs.
 *
 * These live in a leaf of their own rather than in `ui/rc.js` because `rc.js`
 * imports the tabs and the tabs need the helpers — putting them together would
 * be a cycle, and the build rejects those outright rather than letting one
 * quietly half-initialise.
 *
 * Imports: util, events, dates, components.
 */

import { el } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { toISO, todayMs, fmtDate, addDays, MS_DAY } from '../core/dates.js';
import { resourceNames, readGrid } from '../core/lookahead.js';
import { applyLegend } from '../io/lookahead.js';
import * as rc from '../core/rc.js';
import { openModal } from './components.js';

/**
 * A modal whose confirm button does something that can fail.
 *
 * `openModal` closes on click unless the handler returns false, which is right
 * for a menu and wrong for a form that writes to a database over a network.
 * Here the dialog stays open, the button says what is happening, and a refusal
 * is shown in place rather than as a toast over a form that has already gone —
 * every write in this module can be refused by a policy, so that case is the
 * normal one rather than the exception.
 */
export function formModal({ title, body, confirmLabel = 'Save', onConfirm }) {
  const error = el('div', { class: 'rc-error', hidden: true });
  const wrap = el('div', {}, [body, error]);
  let busy = false;

  const modal = openModal({
    title,
    body: wrap,
    actions: [
      { label: 'Cancel' },
      {
        label: confirmLabel,
        kind: 'primary',
        keepOpen: true,
        autofocus: true,
        onClick: async (handle) => {
          if (busy) return;
          busy = true;
          error.hidden = true;
          try {
            await onConfirm();
            handle.close();
          } catch (err) {
            error.textContent = err?.message || String(err);
            error.hidden = false;
          } finally {
            busy = false;
          }
        },
      },
    ],
  });
  return modal;
}

/**
 * The Monday of the week containing `ms`.
 *
 * Mondays because that is what the look-ahead is keyed on, and matching the
 * source's idea of a week is what lets a plan row and a look-ahead row be
 * compared at all. `getUTCDay()` and not `getDay()`: a calendar date must not
 * move because of a timezone.
 */
export function weekStart(ms) {
  const day = new Date(ms).getUTCDay();
  return ms - ((day + 6) % 7) * MS_DAY;
}

/** The five working days of a week, as ISO strings. */
export function weekDays(startMs) {
  return [0, 1, 2, 3, 4].map((n) => toISO(addDays(startMs, n)));
}

/** The seven days, for a view that has to show a weekend possession. */
export function allWeekDays(startMs) {
  return [0, 1, 2, 3, 4, 5, 6].map((n) => toISO(addDays(startMs, n)));
}

export function todayISO() {
  return toISO(todayMs());
}

/** An ISO date back to the millisecond scale the rest of the app uses. */
export function isoToMs(iso) {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

export function dayLabel(iso, preset = 'short') {
  return fmtDate(isoToMs(iso), preset);
}

/** Index rows by id, so a join costs one pass rather than a query per row. */
export function byId(rows) {
  const map = new Map();
  for (const row of rows || []) map.set(row.id, row);
  return map;
}

/** Group rows under a key, for a grid that is people down and days across. */
export function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows || []) {
    const k = typeof key === 'function' ? key(row) : row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

/** A row was written. Whatever is on screen reloads. */
export function notifyChanged(what) {
  emit(EV.RC_CHANGED, { what });
}

/**
 * The five statuses, split into the two families that must never be averaged.
 *
 * Performance is what an individual did. Health is what was done to them — a
 * possession released late is not underperformance, and counting it as such
 * would make the number worse than useless, because people would stop saying
 * they were blocked.
 */
export const STATUSES = [
  { id: 'completed', label: 'Completed', key: 'c', family: 'performance', tone: 'good' },
  { id: 'partial', label: 'Partial', key: 'p', family: 'performance', tone: 'warn' },
  { id: 'carried', label: 'Carried over', key: 'x', family: 'performance', tone: 'warn' },
  { id: 'blocked', label: 'Blocked', key: 'b', family: 'health', tone: 'bad' },
  { id: 'reassigned', label: 'Reassigned', key: 'r', family: 'health', tone: 'info' },
  { id: 'absent', label: 'Away', key: 'a', family: 'absence', tone: 'muted' },
];

export const STATUS_BY_ID = new Map(STATUSES.map((s) => [s.id, s]));

export const SHIFTS = [
  { id: 'day', label: 'Day' },
  { id: 'night', label: 'Night' },
  { id: 'possession', label: 'Possession' },
];

/* ══════════════════════════════════════════════════════════════════════════
   Names written in a spreadsheet, and the people they are
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Fold a name so spelling noise cannot decide whether it matches.
 *
 * Case and punctuation only. Nothing about the *words* is loosened: "R. Okafor"
 * and "r okafor" are the same name written twice, while "Okafor" is a different
 * string and matches only because somebody said so in the alias register.
 */
export function foldName(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A lookup from a written name to a person id.
 *
 * Three sources and no fourth: somebody's own full name, an alias somebody
 * recorded, and a **first name that belongs to exactly one person** — which is
 * what the 4WLA's Resource row is actually filled in with. There is still no
 * surname match and no near miss: a shift attributed to the wrong engineer is
 * worse than one attributed to nobody, because nobody looks at it again. An
 * unrecognised spelling is shown as unmatched instead, which is a question
 * somebody answers once.
 *
 * They are added weakest first so the stronger answer wins. A full name beats an
 * alias pointing elsewhere — a name that *is* somebody's is theirs — and both
 * beat a first name, which is the loosest of the three.
 */
export function nameRegister(people, aliases = []) {
  const map = new Map();

  /* Weakest first, so the stronger answer overwrites it. A first name is the
     loosest of the three and an alias somebody typed is worth more than it;
     somebody's own full name is worth more than either. */
  for (const [key, id] of uniqueFirstNames(people)) map.set(key, id);
  for (const a of aliases || []) {
    const key = foldName(a.alias);
    if (key) map.set(key, a.person_id);
  }
  for (const p of people || []) {
    const key = foldName(p.name);
    if (key) map.set(key, p.id);
  }
  return map;
}

/**
 * First name to person, for the names that belong to exactly one of them.
 *
 * The 4WLA's Resource row is filled in by hand at speed and it says "Victor",
 * not "Victor Okonkwo" — so a register that only knew full names matched almost
 * nothing on a real sheet. A first name is a deliberate convention here rather
 * than a guess at a spelling, which is what makes this different from matching
 * on a surname or a near miss.
 *
 * **Only where it is unambiguous.** Two people called Victor and the name maps
 * to neither: picking one would put a shift against the wrong engineer, which is
 * the one outcome this module is built to avoid, and it would do it silently
 * because both answers look equally plausible on screen. The pair goes to the
 * unmatched list instead, where `ambiguousFirstNames()` lets the interface say
 * *why* it could not place the name — the answer is an alias, once, and then it
 * is settled for good.
 *
 * A roster name that is already one word registers as a full name anyway, so
 * this only ever adds keys; it never changes what a complete name means.
 */
export function uniqueFirstNames(people) {
  const seen = new Map();
  for (const person of people || []) {
    const first = foldName(String(person.name || '').trim().split(/\s+/)[0]);
    if (!first) continue;
    if (seen.has(first)) seen.get(first).push(person.id);
    else seen.set(first, [person.id]);
  }
  return [...seen.entries()]
    .filter(([, ids]) => ids.length === 1)
    .map(([key, ids]) => [key, ids[0]]);
}

/**
 * The first names more than one person answers to.
 *
 * Reported rather than resolved. "Nobody on the roster is called that" and "two
 * people are, and I will not choose between them" are different problems with
 * different fixes, and a list that ran them together would send somebody looking
 * for a missing person who is already there twice.
 */
export function ambiguousFirstNames(people) {
  const seen = new Map();
  for (const person of people || []) {
    const first = foldName(String(person.name || '').trim().split(/\s+/)[0]);
    if (!first) continue;
    seen.set(first, (seen.get(first) || 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key));
}

/**
 * One row per (week, row key), from the newest snapshot that carries it.
 *
 * `rc_lookahead_rows` keeps every read, so asking for a span of weeks returns
 * the same activity once per snapshot — and drawn straight out, that is the same
 * person at the same place four times over. `rank` maps a snapshot id to its
 * position in `listSnapshots()` output, which is newest first, so the lowest
 * rank wins. A row whose snapshot is not in the map is treated as oldest rather
 * than dropped: it is still a read that happened.
 */
export function newestPerKey(rows, rank) {
  const best = new Map();
  const at = (row) => (rank.has(row.snapshot_id) ? rank.get(row.snapshot_id) : Number.MAX_SAFE_INTEGER);
  for (const row of rows || []) {
    const key = `${row.week_start}|${row.row_key}`;
    const held = best.get(key);
    if (!held || at(row) < at(held)) best.set(key, row);
  }
  return [...best.values()];
}

/**
 * The look-ahead's rows for a span of weeks, with who it names on each.
 *
 * The one place the three views ask, so they cannot disagree about where
 * somebody is — the week plan, the Resources tab and the huddle all come
 * through here.
 *
 * **The names are taken from the snapshot, not from the stored column.** They
 * are stored too, in `rc_lookahead_rows.resources`, and that is what a join
 * wants — but a database built before that column existed refuses the insert
 * over it, and the only symptom was three screens quietly reporting that the
 * workbook named nobody while the calendar, which re-reads the snapshot, showed
 * the names perfectly well. So the snapshot is the authority here for the same
 * reason it is for the legend: it is re-read at paint time, so it is right the
 * moment somebody edits the sheet rather than at the next successful write.
 *
 * Grafted onto the stored rows rather than replacing them, because those carry
 * the id a plan entry links to and the location the alias register resolved.
 * The join is `sheet_row` within a week, which is the same identity the row key
 * is built on and has the same weakness: a row inserted mid-sheet between two
 * reads shifts the ones below it. That is what the stored column is for once it
 * exists, and why this fills a gap rather than overruling one.
 */
export async function lookaheadWithResources(fromISO, toISO) {
  const [stored, snapshots, legendRows] = await Promise.all([
    rc.lookaheadBetween(fromISO, toISO).catch(() => []),
    rc.listSnapshots({ limit: 20 }).catch(() => []),
    rc.listLegend().catch(() => []),
  ]);

  const laRows = newestPerKey(stored, new Map(snapshots.map((s, i) => [s.id, i])));
  const snapshot = snapshots[0];
  if (!snapshot?.grid) return laRows;

  const view = readGrid(
    applyLegend(snapshot.grid, legendRows.map((r) => ({
      argb: r.argb, meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from,
    }))),
    { anchorISO: snapshot.taken_at }
  );
  return graftResources(laRows, view);
}

/** Fill in each row's `resources` from the grid, where the sheet still says so. */
export function graftResources(laRows, view) {
  const dayByCol = new Map((view?.days || []).map((d) => [d.col, d]));

  const bySheetRow = new Map();
  for (const activity of view?.activities || []) {
    if (!activity.resource) continue;
    const perDay = {};
    for (const mark of activity.resource.marks) {
      if (!mark.value) continue;
      const day = dayByCol.get(mark.col);
      if (day?.date) perDay[day.date] = mark.value;
    }
    if (Object.keys(perDay).length) bySheetRow.set(activity.row, perDay);
  }
  if (!bySheetRow.size) return laRows;

  const mondayOf = (iso) => toISO(weekStart(isoToMs(iso)));
  return (laRows || []).map((row) => {
    const perDay = bySheetRow.get(row.sheet_row);
    if (!perDay) return row;
    // A row belongs to one week; a name on a day in another week belongs to that
    // week's copy of the row, not to this one.
    const mine = {};
    for (const [date, names] of Object.entries(perDay)) {
      if (mondayOf(date) === row.week_start) mine[date] = names;
    }
    return Object.keys(mine).length
      ? { ...row, resources: { ...(row.resources || {}), ...mine } }
      : row;
  });
}

/**
 * Who the look-ahead's Resource rows put where, per day.
 *
 * Returns `byPerson` — a person id to a map of date to the rows naming them —
 * and `unmatched`, the spellings the register does not know. The second half is
 * the point as much as the first: a name nobody has mapped is a person missing
 * from the picture, and reporting it is the difference between a view that is
 * incomplete and one that is quietly wrong.
 */
export function resourceAssignments(laRows, register) {
  const byPerson = new Map();
  const unmatched = new Map();

  for (const row of laRows || []) {
    for (const [date, text] of Object.entries(row.resources || {})) {
      for (const written of resourceNames(text)) {
        const key = foldName(written);
        if (!key) continue;
        const personId = register.get(key);
        if (!personId) {
          const seen = unmatched.get(key) || { name: written, days: new Set(), rows: [] };
          seen.days.add(date);
          if (!seen.rows.some((r) => r.id === row.id)) seen.rows.push(row);
          unmatched.set(key, seen);
          continue;
        }
        if (!byPerson.has(personId)) byPerson.set(personId, new Map());
        const days = byPerson.get(personId);
        if (!days.has(date)) days.set(date, []);
        if (!days.get(date).some((r) => r.id === row.id)) days.get(date).push(row);
      }
    }
  }

  return { byPerson, unmatched: [...unmatched.values()] };
}

/**
 * Whether somebody is available on a date.
 *
 * Leave is the reason this exists. Absence is a different fact from "carried
 * over" or "reassigned", and without somewhere for it to go it gets silently
 * distributed across the performance statuses — which is precisely what the
 * five-status split is designed to prevent.
 */
export function availability(person, iso, leaveRows) {
  const ms = isoToMs(iso);
  const weekday = new Date(ms).getUTCDay() || 7; // ISO: Monday 1 … Sunday 7
  const working = Array.isArray(person?.working_days) ? person.working_days : [1, 2, 3, 4, 5];

  const leave = (leaveRows || []).find(
    (l) => l.person_id === person.id && l.start_date <= iso && l.end_date >= iso
      && l.status !== 'cancelled' && l.status !== 'declined'
  );
  if (leave) return { state: 'leave', leave };
  if (!working.includes(weekday)) return { state: 'non-working' };
  return { state: 'available' };
}
