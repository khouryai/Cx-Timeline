/**
 * The look-ahead editor's state (`E`), and the little the editor shares with
 * its export.
 *
 * Here rather than in `ui/rc_la_editor.js` so that the export
 * (`ui/rc_la_export.js`), which builds the workbook from what the editor holds,
 * can read it without importing the editor — which imports the export for its
 * toolbar, and the build rejects the cycle.
 *
 * Imports: rc, core/la_edit, core/la_p6.
 */

import * as rc from '../core/rc.js';
import * as ed from '../core/la_edit.js';
import * as p6 from '../core/la_p6.js';

export const META = ed.FIELDS.length; // six activity columns, then the days

/**
 * The editor's state, kept for the life of the page so a redraw of the tab —
 * which any calendar write causes — never loses the selection, the undo
 * history or unsaved work.
 */
export const E = {
  model: null,
  loaded: null, // { from, to } — the days whose cells are in the model
  legend: [], // shift colours only: what the palette paints with
  legendAll: [],
  codes: [],
  title: '',
  start: null, // the Monday the window starts on
  weeks: 4,
  firstWritten: null, // the first day anything is written here — the editor holds nothing before its week
  filter: '',
  showArchived: false,
  collapsed: new Set(),
  anchor: { r: 0, c: META },
  focus: { r: 0, c: META },
  undo: [],
  redo: [],
  queue: [],
  saving: null, // the save under way, if any
  status: 'saved', // saved | saving | retry | conflict
  retryIn: 0,
  server: new Map(), // 'row:<id>' | 'cell:<row>|<day>' → the version the server holds
  revision: 0,
  dirtySincePublish: false,
  publishTimer: null,
  publishing: null, // the publish under way, so a flush can wait for it
  publishError: null, // why the last publish failed, so Done editing can say so
  pollTimer: null,
  clip: null,
  editing: null,
  root: null,
  view: null, // what is drawn: { rows, days, cols }
  // Who is on the team, for the staffing check: a lookup from a written name to
  // a person, and the leave booked in the calendar across the loaded days.
  resolveName: null,
  leave: [],
  leaveKinds: new Map(),
  staff: { issues: [], byCell: new Map() },
  scroll: { left: 0, top: 0 },
  // The schedule's activities and the reasons a row has none (`loadP6()`).
  p6: { available: false, entries: [], flags: [], index: p6.p6Index() },
};

/** The legend as the editor paints with it: every row, and the shifts in force. */
export function legendInForce(rows) {
  const all = rows.map((r) => ({ argb: String(r.argb).toUpperCase(), meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from }));
  const inForce = new Map();
  for (const r of all) {
    const held = inForce.get(r.argb);
    if (!held || String(r.valid_from || '') > String(held.valid_from || '')) inForce.set(r.argb, r);
  }
  return { all, shifts: [...inForce.values()].filter((r) => r.role === 'shift' && r.meaning) };
}

/** A day as the editor's headings and summaries say it: "12 Oct". */
export function fmt(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Make sure the cells of a window outside the one on screen are loaded. */
export async function ensureWindow(days) {
  const from = days[0];
  const to = days[days.length - 1];
  if (E.loaded && from >= E.loaded.from && to <= E.loaded.to) return;
  const cells = await rc.listLaCells(from, to);
  for (const c of cells.map(ed.cleanCell)) {
    const key = ed.cellKey(c.row_id, c.day);
    if (!E.model.cells.has(key)) {
      E.model.cells.set(key, c);
      E.server.set(`cell:${key}`, c.version || 0);
    }
  }
  E.loaded = { from: [from, E.loaded?.from || from].sort()[0], to: [to, E.loaded?.to || to].sort().reverse()[0] };
}
