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
