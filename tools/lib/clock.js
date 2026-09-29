/**
 * One "now" for every suite, in Node and in the page alike.
 *
 * The calendar is about days — this week, yesterday's huddle, the Monday a
 * week back, whether today is a column at all — and a suite that reads the
 * wall clock is a different suite on a Saturday from the one on a Wednesday.
 * Several checks had grown branches for the weekend, and one failed on a
 * Monday for months before anybody ran it on one. So the clock is pinned: a
 * Wednesday afternoon, in UTC, by default.
 *
 * It is an *offset*, not a frozen instant. Time still passes — timers fire,
 * a heartbeat is still a heartbeat, a TTL still expires — it merely started
 * on the pinned date. Node and every page share one offset, taken once when
 * this module loads, so a fixture built here and a date read in the page
 * agree to the millisecond.
 *
 *   CX_TEST_NOW=2026-12-28T09:00:00Z npm test   — run as though it were then
 *   CX_TEST_NOW=real npm test                   — run against the wall clock
 *
 * Only `Date` moves. `performance.now()` and the timers measure durations,
 * which is what they are for, and they are left alone.
 */

const DEFAULT_NOW = '2026-09-23T14:00:00Z'; // a Wednesday

function pinnedInstant() {
  const raw = process.env.CX_TEST_NOW || DEFAULT_NOW;
  if (raw === 'real') return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) throw new Error(`CX_TEST_NOW is not a date: ${raw}`);
  return ms;
}

const PINNED = pinnedInstant();
const OFFSET = PINNED === null ? 0 : PINNED - Date.now();

/**
 * Replace `Date` in whatever global it runs in, shifted by `offset`.
 *
 * Written as a self-contained function because it is serialised into every
 * page as well as run here; it must close over nothing.
 */
function shiftDate(offset) {
  const Real = Date;
  if (!offset || Real.__cxShifted) return;
  function Shifted(...args) {
    if (!new.target) return new Real(Real.now() + offset).toString();
    return args.length ? new Real(...args) : new Real(Real.now() + offset);
  }
  Shifted.prototype = Real.prototype;
  Shifted.now = () => Real.now() + offset;
  Shifted.parse = Real.parse;
  Shifted.UTC = Real.UTC;
  Object.defineProperty(Shifted, '__cxShifted', { value: true });
  Object.setPrototypeOf(Shifted, Real);
  globalThis.Date = Shifted;
}

/** The script a page runs before anything of its own. */
export const clockScript = `(${shiftDate})(${OFFSET});`;

/** The instant the suites run as, or null against the wall clock. */
export function pinnedNow() {
  return PINNED;
}

/** Shift this process's clock. Call once, at the top of a suite. */
export function pinNodeClock() {
  shiftDate(OFFSET);
  if (PINNED !== null) console.log(`  (clock pinned to ${new Date().toISOString().slice(0, 16)}Z — CX_TEST_NOW=real to unpin)`);
}

/**
 * Pin every page this context opens.
 *
 * `addInitScript` runs in the order it was added, per page, and the suites
 * add their own fakes — which read the date — straight after `newPage()`. So
 * the clock goes in *inside* `newPage()`, before the caller can add anything.
 */
export function pinClock(context) {
  if (!OFFSET) return context;
  const open = context.newPage.bind(context);
  context.newPage = async (...args) => {
    const page = await open(...args);
    await page.addInitScript(clockScript);
    return page;
  };
  return context;
}
