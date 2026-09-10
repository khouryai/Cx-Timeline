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
import { resourceNames } from '../core/lookahead.js';
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
 * Two sources and no third: the roster's own names, and the aliases somebody
 * has recorded. There is deliberately no partial or surname match — a shift
 * attributed to the wrong engineer is worse than one attributed to nobody,
 * because nobody looks at it again. An unrecognised spelling is shown as
 * unmatched instead, which is a question somebody answers once.
 *
 * The roster name wins over an alias pointing somewhere else: a name that *is*
 * somebody's is theirs.
 */
export function nameRegister(people, aliases = []) {
  const map = new Map();
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
