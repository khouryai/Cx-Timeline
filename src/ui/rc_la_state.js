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
  /** 'workbook' until the look-ahead is written in the calendar, then 'editor'. */
  source: 'workbook',
  /**
   * Whether the calendar is switched to editing. The editor used to be a
   * section of its own, drawing the same four weeks as the calendar beside it;
   * it is the calendar's Edit switch now, an administrator's, off by default.
   */
  editing: false,
  /** Whether somebody picked a section, so the tab stops choosing one for them. */
  sectionChosen: false,
  /** How many weeks the editor shows: four, or five to see one more ahead. */
  editorWeeks: 4,
  /**
   * Only the rows that name the person looking. Null until somebody chooses:
   * then it is on for the team and off for an administrator, who is usually
   * reading the whole sheet.
   */
  onlyMine: null,
  /** Whose choice `onlyMine` is. */
  onlyMineFor: null,
};

export const WEEK_CHOICES = [
  { weeks: 2, label: '2 weeks' },
  { weeks: 3, label: '3 weeks' },
  { weeks: 4, label: '4 weeks' },
  { weeks: 5, label: '5 weeks' },
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
