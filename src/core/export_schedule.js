/**
 * When a repeating export is due — the rule alone, no DOM and no clock of its
 * own, so `tools/test_la_edit.js` can walk it across days in Node.
 *
 * A schedule is `{ every, at, weekday, hours }`:
 *   - `every: 'off'`   — never;
 *   - `every: 'day'`   — each day at `at` ("HH:MM", this computer's time);
 *   - `every: 'week'`  — each week on `weekday` (1 Monday … 7 Sunday) at `at`;
 *   - `every: 'hours'` — every `hours` hours since the last run.
 *
 * **A slot missed is run late, once.** The export runs in the page, so it runs
 * only while the calendar is open; a computer that was off at six in the
 * morning exports when somebody opens the calendar at eight, and a week
 * closed does not come back as seven files. What is compared is the latest
 * slot that has passed against the last run: one run covers every slot
 * before it.
 *
 * Imports: nothing.
 */

export const EVERY = ['off', 'day', 'week', 'hours'];

/** "06:30" → [6, 30], or the fallback when it is not a time. */
function hoursMinutes(at, fallback = [6, 0]) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(at ?? '').trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? [h, min] : fallback;
}

/** A schedule with every field present and in range — what is stored and compared. */
export function cleanSchedule(s = {}) {
  const every = EVERY.includes(s.every) ? s.every : 'off';
  const [h, m] = hoursMinutes(s.at);
  const weekday = Number.isInteger(Number(s.weekday)) && s.weekday >= 1 && s.weekday <= 7 ? Number(s.weekday) : 1;
  const hours = Math.min(168, Math.max(1, Math.round(Number(s.hours) || 24)));
  return { every, at: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, weekday, hours };
}

/**
 * The most recent slot at or before `now` (ms), or null for a schedule that
 * has no fixed slots ('off', 'hours'). Local time: "six in the morning" is the
 * clock on this computer's wall, not Greenwich's.
 */
export function lastSlot(schedule, now) {
  const s = cleanSchedule(schedule);
  if (s.every !== 'day' && s.every !== 'week') return null;
  const [h, m] = hoursMinutes(s.at);
  const d = new Date(now);
  const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
  if (s.every === 'day') {
    if (slot.getTime() > now) slot.setDate(slot.getDate() - 1);
    return slot.getTime();
  }
  const weekday = slot.getDay() || 7; // 1 Monday … 7 Sunday
  slot.setDate(slot.getDate() - ((weekday - s.weekday + 7) % 7));
  if (slot.getTime() > now) slot.setDate(slot.getDate() - 7);
  return slot.getTime();
}

/** The next slot after `now` (ms) — what the dialog says is coming. Null when off. */
export function nextSlot(schedule, lastRun, now) {
  const s = cleanSchedule(schedule);
  if (s.every === 'off') return null;
  if (s.every === 'hours') return (lastRun ?? now) + s.hours * 3600000;
  const last = lastSlot(s, now);
  const step = new Date(last);
  step.setDate(step.getDate() + (s.every === 'day' ? 1 : 7));
  return step.getTime();
}

/**
 * Whether an export is due now: a slot has passed since the last run (or, for
 * 'hours', that many hours have). `lastRun` null means never — and a schedule
 * that has never run waits for its first slot rather than firing the moment
 * it is saved, so `since` (when it was switched on) stands in for it.
 */
export function isDue(schedule, { lastRun = null, since = null } = {}, now) {
  const s = cleanSchedule(schedule);
  if (s.every === 'off') return false;
  const from = lastRun ?? since;
  if (s.every === 'hours') return from == null || now - from >= s.hours * 3600000;
  const slot = lastSlot(s, now);
  return slot != null && (from == null || from < slot);
}
