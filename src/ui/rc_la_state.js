/**
 * What the look-ahead tab is showing, shared by its sections.
 *
 * The tab was one 2,400-line module, and its sections reached into each other's
 * `let`s — "Show cells" in the cancellation log set the calendar's filter and
 * section directly. Split into a module per section, that state lives here as
 * one object, because an ES module cannot reassign another's binding and the
 * linker forbids `export let` anyway. Also the one table helper they share.
 *
 * Imports: util.
 */

import { el } from '../core/util.js';

export const la = {
  /** Which section is on screen. */
  section: 'calendar',
  /** Free text filter on the calendar, kept across a redraw of the section. */
  calendarFilter: '',
  /**
   * Whether rows nobody highlighted are drawn. Off by default: most of the sheet
   * is activities carried for reference with nothing scheduled against them.
   */
  showQuietRows: false,
  /** Whether the names on each activity's Resource row are drawn. */
  showResources: true,
  /** How much of the calendar to show, in weeks from this one; 0 is everything. */
  calendarWeeks: 4,
};

export const WEEK_CHOICES = [
  { weeks: 2, label: '2 weeks' },
  { weeks: 3, label: '3 weeks' },
  { weeks: 4, label: '4 weeks' },
  { weeks: 0, label: 'Everything' },
];

/* ── Shared ────────────────────────────────────────────────────────────── */

export function table(headers, rows) {
  return el('div', { class: 'rc-scroll' }, [
    el('table', { class: 'rc-table' }, [
      el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { text: h })))]),
      el('tbody', {}, rows),
    ]),
  ]);
}
