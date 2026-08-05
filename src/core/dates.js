/**
 * Date & time-axis mathematics.
 *
 * Everything in this application works in **UTC** internally. Project dates
 * are calendar dates, not instants — a release planned for "12 March" must not
 * shift by a day because the user flew to another timezone or the clocks went
 * forward. So: the model stores `YYYY-MM-DD` strings, the engine works in
 * milliseconds at UTC midnight, and nothing ever calls a local-time getter.
 *
 * Leaf module: imports nothing.
 */

export const MS_MINUTE = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;
export const MS_WEEK = MS_DAY * 7;

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_MIN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/* ── Conversion ────────────────────────────────────────────────────────── */

/**
 * Parse a value into UTC-midnight milliseconds.
 * Accepts `YYYY-MM-DD`, full ISO strings, Date objects and raw numbers.
 * Returns NaN for anything unparseable so callers can guard.
 */
export function toMs(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  const s = String(value).trim();
  const simple = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (simple) return Date.UTC(+simple[1], +simple[2] - 1, +simple[3]);
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? NaN : parsed;
}

/** Milliseconds → `YYYY-MM-DD` (UTC). */
export function toISO(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Milliseconds → `YYYY-MM-DDTHH:MM` (UTC) for datetime inputs. */
export function toISOMinutes(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${toISO(ms)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Today at UTC midnight, from the system clock. */
export function todayMs() {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/* ── Truncation ────────────────────────────────────────────────────────── */

export function startOfDay(ms) {
  return Math.floor(ms / MS_DAY) * MS_DAY;
}

export function endOfDay(ms) {
  return startOfDay(ms) + MS_DAY - 1;
}

/** Start of week. `weekStart` is 0 (Sunday) or 1 (Monday, the default). */
export function startOfWeek(ms, weekStart = 1) {
  const d = startOfDay(ms);
  const dow = new Date(d).getUTCDay();
  const delta = (dow - weekStart + 7) % 7;
  return d - delta * MS_DAY;
}

export function startOfMonth(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function endOfMonth(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - MS_DAY;
}

export function startOfQuarter(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
}

export function startOfYear(ms) {
  return Date.UTC(new Date(ms).getUTCFullYear(), 0, 1);
}

/* ── Arithmetic ────────────────────────────────────────────────────────── */

export function addDays(ms, n) {
  return ms + n * MS_DAY;
}

export function addWeeks(ms, n) {
  return ms + n * MS_WEEK;
}

export function addMonths(ms, n) {
  const d = new Date(ms);
  const targetMonth = d.getUTCMonth() + n;
  const year = d.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  // Clamp the day so 31 Jan + 1 month lands on 28/29 Feb rather than 3 March.
  const day = Math.min(d.getUTCDate(), daysInMonth(year, month));
  return Date.UTC(year, month, day);
}

export function addYears(ms, n) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), Math.min(d.getUTCDate(), daysInMonth(d.getUTCFullYear() + n, d.getUTCMonth())));
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Whole days between two instants (b − a). */
export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / MS_DAY);
}

export function isWeekend(ms) {
  const dow = new Date(ms).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Working days between two dates, exclusive of the end date, skipping
 * weekends and any date listed in `holidays` (array of `YYYY-MM-DD`).
 */
export function workingDaysBetween(a, b, holidays = []) {
  const set = new Set(holidays);
  let count = 0;
  let cur = startOfDay(Math.min(a, b));
  const end = startOfDay(Math.max(a, b));
  while (cur < end) {
    if (!isWeekend(cur) && !set.has(toISO(cur))) count++;
    cur += MS_DAY;
  }
  return a <= b ? count : -count;
}

/** Advance `ms` by `n` working days. */
export function addWorkingDays(ms, n, holidays = []) {
  const set = new Set(holidays);
  const step = n >= 0 ? MS_DAY : -MS_DAY;
  let remaining = Math.abs(n);
  let cur = startOfDay(ms);
  while (remaining > 0) {
    cur += step;
    if (!isWeekend(cur) && !set.has(toISO(cur))) remaining--;
  }
  return cur;
}

/** ISO-8601 week number (weeks start Monday; week 1 contains 4 January). */
export function isoWeek(ms) {
  const d = startOfDay(ms);
  const dow = (new Date(d).getUTCDay() + 6) % 7; // Mon = 0
  const thursday = d + (3 - dow) * MS_DAY;
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4Dow * MS_DAY;
  return { week: Math.round((thursday - week1Monday) / MS_WEEK) + 1, year };
}

export function quarterOf(ms) {
  return Math.floor(new Date(ms).getUTCMonth() / 3) + 1;
}

/* ── Formatting ────────────────────────────────────────────────────────── */

/**
 * Format a date for display.
 * Presets: 'iso' | 'short' (12 Mar 26) | 'medium' (12 Mar 2026) |
 *          'long' (12 March 2026) | 'day' (Thu 12 Mar) | 'monthYear' |
 *          'quarter' (Q1 2026) | 'week' (W07 2026) | 'compact' (12/03/26)
 */
export function fmtDate(ms, preset = 'medium') {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const day = d.getUTCDate();
  const mon = d.getUTCMonth();
  const year = d.getUTCFullYear();
  switch (preset) {
    case 'iso':
      return toISO(ms);
    case 'short':
      return `${day} ${MONTHS_SHORT[mon]} ${String(year).slice(2)}`;
    case 'long':
      return `${day} ${MONTHS[mon]} ${year}`;
    case 'day':
      return `${DAYS_SHORT[d.getUTCDay()]} ${day} ${MONTHS_SHORT[mon]}`;
    case 'dayFull':
      return `${DAYS_SHORT[d.getUTCDay()]} ${day} ${MONTHS_SHORT[mon]} ${year}`;
    case 'monthYear':
      return `${MONTHS_SHORT[mon]} ${year}`;
    case 'quarter':
      return `Q${quarterOf(ms)} ${year}`;
    case 'week': {
      const w = isoWeek(ms);
      return `W${String(w.week).padStart(2, '0')} ${w.year}`;
    }
    case 'compact':
      return `${pad(day)}/${pad(mon + 1)}/${String(year).slice(2)}`;
    case 'medium':
    default:
      return `${day} ${MONTHS_SHORT[mon]} ${year}`;
  }
}

/** Human duration from a day count: "3d", "2w 1d", "4mo". */
export function fmtDuration(days) {
  const n = Math.abs(Math.round(days));
  const sign = days < 0 ? '−' : '';
  if (n === 0) return '0d';
  if (n < 14) return `${sign}${n}d`;
  if (n < 70) {
    const w = Math.floor(n / 7);
    const d = n % 7;
    return `${sign}${w}w${d ? ` ${d}d` : ''}`;
  }
  if (n < 730) return `${sign}${Math.round(n / 30.44)}mo`;
  return `${sign}${(n / 365.25).toFixed(1)}y`;
}

/** Relative phrasing against a reference date: "in 4 days", "2 weeks ago". */
export function fmtRelative(ms, ref = todayMs()) {
  const d = daysBetween(ref, ms);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  const abs = fmtDuration(Math.abs(d));
  return d > 0 ? `in ${abs}` : `${abs} ago`;
}

/** Timestamp for version history and backups. */
export function fmtTimestamp(ms) {
  const d = new Date(ms);
  return `${pad(d.getDate())} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ── Time-axis tick generation ─────────────────────────────────────────── */

/**
 * The scale ladder. `minPxPerDay` is the zoom level at which a scale becomes
 * the sensible primary unit; the viewport picks the finest scale that fits.
 */
export const SCALES = [
  { id: 'day', label: 'Day', minPxPerDay: 26, step: MS_DAY },
  { id: 'week', label: 'Week', minPxPerDay: 5.2, step: MS_WEEK },
  { id: 'month', label: 'Month', minPxPerDay: 1.5, step: MS_DAY * 30.44 },
  { id: 'quarter', label: 'Quarter', minPxPerDay: 0.55, step: MS_DAY * 91.3 },
  { id: 'year', label: 'Year', minPxPerDay: 0, step: MS_DAY * 365.25 },
];

/** The scale one rung coarser than `id` — used for the ruler's upper band. */
export function coarserScale(id) {
  const i = SCALES.findIndex((s) => s.id === id);
  return SCALES[Math.min(SCALES.length - 1, i + 1)];
}

/**
 * Generate ruler ticks for a scale across [fromMs, toMs].
 * Each tick is `{ start, end, label, sub, major, weekend }`.
 * Generation is bounded (`limit`) so a pathological zoom can never lock the
 * main thread building a million DOM nodes.
 */
export function ticks(scale, fromMs, toMs, opts = {}) {
  const { weekStart = 1, limit = 4000 } = opts;
  const out = [];
  let cur;
  let guard = 0;

  switch (scale) {
    case 'day':
      cur = startOfDay(fromMs);
      while (cur <= toMs && guard++ < limit) {
        const d = new Date(cur);
        const dow = d.getUTCDay();
        out.push({
          start: cur,
          end: cur + MS_DAY,
          label: String(d.getUTCDate()),
          sub: DAYS_MIN[dow],
          major: dow === weekStart,
          weekend: dow === 0 || dow === 6,
        });
        cur += MS_DAY;
      }
      break;

    case 'week':
      cur = startOfWeek(fromMs, weekStart);
      while (cur <= toMs && guard++ < limit) {
        const w = isoWeek(cur);
        out.push({
          start: cur,
          end: cur + MS_WEEK,
          label: `W${String(w.week).padStart(2, '0')}`,
          sub: fmtDate(cur, 'compact'),
          major: w.week === 1 || new Date(cur).getUTCDate() <= 7,
          weekend: false,
        });
        cur += MS_WEEK;
      }
      break;

    case 'month':
      cur = startOfMonth(fromMs);
      while (cur <= toMs && guard++ < limit) {
        const d = new Date(cur);
        const next = addMonths(cur, 1);
        out.push({
          start: cur,
          end: next,
          label: MONTHS_SHORT[d.getUTCMonth()],
          sub: String(d.getUTCFullYear()),
          major: d.getUTCMonth() % 3 === 0,
          weekend: false,
        });
        cur = next;
      }
      break;

    case 'quarter':
      cur = startOfQuarter(fromMs);
      while (cur <= toMs && guard++ < limit) {
        const d = new Date(cur);
        const next = addMonths(cur, 3);
        out.push({
          start: cur,
          end: next,
          label: `Q${quarterOf(cur)}`,
          sub: String(d.getUTCFullYear()),
          major: d.getUTCMonth() === 0,
          weekend: false,
        });
        cur = next;
      }
      break;

    case 'year':
    default:
      cur = startOfYear(fromMs);
      while (cur <= toMs && guard++ < limit) {
        const next = addYears(cur, 1);
        out.push({
          start: cur,
          end: next,
          label: String(new Date(cur).getUTCFullYear()),
          sub: '',
          major: true,
          weekend: false,
        });
        cur = next;
      }
      break;
  }

  return out;
}

/**
 * Snap a timestamp to a grid.
 * `mode`: 'off' | 'day' | 'week' | 'month' | 'quarter' | 'workday'
 */
export function snap(ms, mode, opts = {}) {
  const { weekStart = 1, holidays = [] } = opts;
  switch (mode) {
    case 'day':
      return Math.round(ms / MS_DAY) * MS_DAY;
    case 'week': {
      const s = startOfWeek(ms, weekStart);
      return ms - s > MS_WEEK / 2 ? s + MS_WEEK : s;
    }
    case 'month': {
      const s = startOfMonth(ms);
      const e = addMonths(s, 1);
      return ms - s > (e - s) / 2 ? e : s;
    }
    case 'quarter': {
      const s = startOfQuarter(ms);
      const e = addMonths(s, 3);
      return ms - s > (e - s) / 2 ? e : s;
    }
    case 'workday': {
      let d = Math.round(ms / MS_DAY) * MS_DAY;
      const set = new Set(holidays);
      let guard = 0;
      while ((isWeekend(d) || set.has(toISO(d))) && guard++ < 14) d += MS_DAY;
      return d;
    }
    case 'off':
    default:
      return ms;
  }
}

/** Inclusive-exclusive overlap test for two date ranges. */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
