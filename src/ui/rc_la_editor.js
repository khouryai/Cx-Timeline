/**
 * The look-ahead editor: the 4WLA, written in the calendar.
 *
 * It looks like the calendar grid it replaces the workbook for, and it behaves
 * like a spreadsheet, because that is what the two people who keep it are used
 * to: click a day and type "X.WIT", drag across a week and press a colour, drag
 * the corner to repeat it, copy a block and paste it — into Excel as well,
 * colours included — undo anything, insert a row or a section where it goes and
 * drag rows to where they belong. Five weeks at most, from any Monday; next week
 * simply appears when this one ends.
 *
 * Everything it does is an op from `core/la_edit.js`: applied here at once,
 * so typing never waits on the network, then saved in order through
 * `rc_la_apply()`. Every op expects the version it last saw, so when the other
 * administrator changes the same day at the same moment the save is refused and
 * the sheet reloads with their version, rather than one of them silently
 * losing. Once saves go quiet the look-ahead is published
 * (`publishFromEditor()`), which is what the calendar, the week plan, the huddle,
 * PTO and the cancellation log read.
 *
 * Only an administrator reaches it; `rc_la_apply()` refuses anybody else.
 *
 * Imports: util, rc, core/la_edit, core/lookahead, io/lookahead, io/la_xlsx,
 *          io/exporters, filestore, icons, components, rc_util, rc_ingest,
 *          rc_la_state.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import * as filestore from '../core/filestore.js';
import * as ed from '../core/la_edit.js';
import { readGrid, isCancelMeaning } from '../core/lookahead.js';
import { parseSheet, applyLegend, readLegend, isDark } from '../io/lookahead.js';
import { lookaheadWorkbook, lookaheadFileName } from '../io/la_xlsx.js';
import { saveFile } from '../io/exporters.js';
import { icon } from './icons.js';
import {
  toast, confirmDialog, contextMenu, openModal, textInput, selectInput, segmented, emptyState,
  attachTooltip,
} from './components.js';
import { notifyChanged, todayISO, nameRegister, foldName } from './rc_util.js';
import { publishFromEditor, publishDays, EDITOR_SOURCE } from './rc_ingest.js';
import { la } from './rc_la_state.js';

/* ══════════════════════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════════════════ */

const META = ed.FIELDS.length; // six activity columns, then the days
const SAVE_BATCH = 400;
const POLL_MS = 20000;
const PUBLISH_QUIET_MS = 2500;

/**
 * The editor's state, kept for the life of the page so a redraw of the tab —
 * which any calendar write causes — never loses the selection, the undo
 * history or unsaved work.
 */
const E = {
  model: null,
  loaded: null, // { from, to } — the days whose cells are in the model
  legend: [], // shift colours only: what the palette paints with
  legendAll: [],
  codes: [],
  title: '',
  start: null, // the Monday the window starts on
  weeks: 4,
  filter: '',
  showArchived: false,
  collapsed: new Set(),
  anchor: { r: 0, c: META },
  focus: { r: 0, c: META },
  undo: [],
  redo: [],
  queue: [],
  saving: false,
  status: 'saved', // saved | saving | retry | conflict
  retryIn: 0,
  server: new Map(), // 'row:<id>' | 'cell:<row>|<day>' → the version the server holds
  revision: 0,
  dirtySincePublish: false,
  publishTimer: null,
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
};

/* ══════════════════════════════════════════════════════════════════════════
   Entry
   ═══════════════════════════════════════════════════════════════════════ */

export async function renderEditor(host) {
  E.root = host;
  if (!rc.isAdmin()) {
    host.appendChild(emptyState({
      iconName: 'lock',
      title: 'Administrators only',
      message: 'The look-ahead is written by its two owners. Everybody else sees it under Calendar.',
    }));
    return;
  }

  const [settings, legend, codes, people, aliases, leaveKinds] = await Promise.all([
    rc.listSettings().catch(() => []),
    rc.listLegend().catch(() => []),
    rc.listSupportCodes({ includeRetired: true }).catch(() => []),
    rc.listPeople().catch(() => []),
    rc.listPersonAliases().catch(() => []),
    rc.listLeaveKinds().catch(() => []),
  ]);
  /* The same exact register the week plan reads names with — full name, alias,
     or a first name only one person has. A name it cannot place is somebody
     else's person, and the staffing check leaves it alone. */
  const register = nameRegister(people, aliases);
  const byId = new Map(people.map((p) => [p.id, p]));
  E.resolveName = (written) => {
    const id = register.get(foldName(written));
    return id ? { id, name: byId.get(id)?.name || String(written).trim() } : null;
  };
  E.leaveKinds = new Map(leaveKinds.map((k) => [k.id, k.name]));
  E.legendAll = legend.map((r) => ({ argb: String(r.argb).toUpperCase(), meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from }));
  const inForce = new Map();
  for (const r of E.legendAll) {
    const held = inForce.get(r.argb);
    if (!held || String(r.valid_from || '') > String(held.valid_from || '')) inForce.set(r.argb, r);
  }
  E.legend = [...inForce.values()].filter((r) => r.role === 'shift' && r.meaning);
  E.codes = codes;
  E.names = ed.nameChoices(people);
  E.title = settings.find((r) => r.key === 'lookahead_title')?.value || '';
  if (!E.start) E.start = ed.mondayOf(todayISO());
  E.weeks = ed.WINDOW_WEEKS.includes(la.editorWeeks) ? la.editorWeeks : 4;

  if (la.source !== EDITOR_SOURCE) {
    await renderStart(host);
    return;
  }

  const first = !E.model;
  if (!E.model) await load();
  else await ensureLoaded();
  if (first) {
    // The caret starts on the first day of the first activity — the cell
    // somebody opening the look-ahead is most likely to want.
    const rows = visibleRows();
    const at = Math.max(0, rows.findIndex((r) => r.kind === 'activity'));
    const today = windowDays().indexOf(todayISO());
    E.anchor = { r: at, c: META + Math.max(0, today) };
    E.focus = { ...E.anchor };
  }
  draw();
  startPolling();
}

/**
 * Save, then publish, now — called before another section is opened so it
 * reads the look-ahead as it stands rather than as it stood a few seconds ago.
 */
export async function flushEditor() {
  await drain();
  if (E.dirtySincePublish) await publish();
}

/* ══════════════════════════════════════════════════════════════════════════
   Loading
   ═══════════════════════════════════════════════════════════════════════ */

function windowDays() {
  return ed.windowDays(E.start, E.weeks);
}

/** The days the model must hold: what is on screen, and what a publish covers. */
function neededRange() {
  const pub = publishDays(todayISO());
  const view = windowDays();
  const from = [pub[0], view[0]].sort()[0];
  const to = [pub[pub.length - 1], view[view.length - 1]].sort().reverse()[0];
  return { from, to };
}

async function load() {
  const { from, to } = neededRange();
  const [rows, cells] = await Promise.all([rc.listLaRows(), rc.listLaCells(from, to)]);
  E.model = ed.makeModel(rows.map(cleanRow), cells.map(cleanCell));
  E.loaded = { from, to };
  E.server = new Map();
  for (const r of E.model.rows) E.server.set(`row:${r.id}`, r.version || 0);
  for (const c of ed.cellList(E.model)) E.server.set(`cell:${c.row_id}|${c.day}`, c.version || 0);
  E.revision = await rc.lookaheadRevision().catch(() => E.revision);
  await loadLeave();
}

/** Leave booked across the loaded days — what the staffing check reads. */
async function loadLeave() {
  if (!E.loaded) return;
  const rows = await rc.listLeave(E.loaded.from, E.loaded.to).catch(() => []);
  E.leave = rows.map((l) => ({ ...l, kind: E.leaveKinds.get(l.kind_id) || 'leave' }));
}

/** Widen what is loaded when somebody pages back or forward past it. */
async function ensureLoaded() {
  const { from, to } = neededRange();
  if (E.loaded && from >= E.loaded.from && to <= E.loaded.to) return;
  const lo = E.loaded ? [from, E.loaded.from].sort()[0] : from;
  const hi = E.loaded ? [to, E.loaded.to].sort().reverse()[0] : to;
  const fetchFrom = E.loaded && from >= E.loaded.from ? ed.addDaysISO(E.loaded.to, 1) : lo;
  const fetchTo = E.loaded && to <= E.loaded.to ? ed.addDaysISO(E.loaded.from, -1) : hi;
  const cells = await rc.listLaCells(fetchFrom, fetchTo);
  for (const c of cells.map(cleanCell)) {
    const key = ed.cellKey(c.row_id, c.day);
    if (!E.model.cells.has(key)) {
      E.model.cells.set(key, c);
      E.server.set(`cell:${key}`, c.version || 0);
    }
  }
  E.loaded = { from: lo, to: hi };
  await loadLeave();
}

function cleanRow(r) {
  return {
    ...ed.blankRow(r.kind, {}),
    ...r,
    sort: Number(r.sort) || 0,
    level: Number(r.level) || 0,
    archived: !!r.archived,
  };
}

function cleanCell(c) {
  return {
    row_id: c.row_id,
    day: String(c.day).slice(0, 10),
    color: c.color ? String(c.color).toUpperCase() : null,
    text: c.text || '',
    version: c.version || 0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Starting: from the workbook, from a file, or from nothing
   ═══════════════════════════════════════════════════════════════════════ */

async function renderStart(host) {
  const snapshot = await rc.latestSnapshot().catch(() => null);
  const existing = await rc.listLaRows().catch(() => []);

  const card = el('div', { class: 'lae-start' });
  card.append(
    el('div', { class: 'lae-start-icon', html: icon('edit', { size: 28 }) }),
    el('h2', { text: 'Write the look-ahead here' }),
    el('p', {
      class: 'rc-hint',
      text: 'Edit activities, sections, shifts and support codes directly in the calendar, and export an Excel '
        + 'copy in the 4WLA layout whenever the track allocation manager needs one. The workbook stops being read: '
        + 'from here on, the calendar is the look-ahead.',
    }),
  );

  const options = el('div', { class: 'lae-start-options' });
  if (existing.length) {
    options.appendChild(startOption({
      title: 'Carry on with the look-ahead already here',
      detail: `${plural(existing.filter((r) => r.kind === 'activity').length, 'activity', 'activities')} were written here before.`,
      label: 'Open the editor',
      primary: true,
      run: () => adopt(null),
    }));
  }
  if (snapshot?.grid?.rows?.length) {
    const preview = importPreview(snapshot.grid, snapshot.taken_at);
    options.appendChild(startOption({
      title: 'Start from the last reading of the workbook',
      detail: `${describeImport(preview.report)} — read ${new Date(snapshot.taken_at).toLocaleDateString()}.`,
      label: 'Start from it',
      primary: !existing.length,
      run: () => adopt(preview.model),
    }));
  }
  const file = el('input', { type: 'file', accept: '.xlsx', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const settings = await rc.listSettings().catch(() => []);
      const sheet = settings.find((r) => r.key === 'lookahead_sheet')?.value || '4WLA';
      const grid = parseSheet(await f.arrayBuffer(), sheet);
      const legend = await legendFor(grid);
      const preview = importPreview(applyLegend(grid, legend), new Date().toISOString(), legend);
      const ok = await confirmDialog({
        title: `Start from ${f.name}`,
        message: `${describeImport(preview.report)}. Past weeks, hidden rows and columns, and `
          + 'shading stay behind in the file.',
        confirmLabel: 'Start from it',
      });
      if (ok) await adopt(preview.model, titleOf(grid));
    } catch (err) {
      toast({ tone: 'bad', message: err.message, timeout: 12000 });
    }
  });
  options.appendChild(startOption({
    title: 'Start from a workbook',
    detail: 'Pick the current .xlsx. Only what is still ahead comes across.',
    label: 'Choose a file…',
    run: () => file.click(),
  }));
  options.appendChild(startOption({
    title: 'Start with an empty look-ahead',
    detail: 'Build it up from sections and activities.',
    label: 'Start empty',
    run: () => adopt(ed.makeModel([ed.blankRow('section', { sort: 1024, description: 'Section' })], [])),
  }));
  card.append(options, file);
  host.appendChild(card);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 activities in 4 sections, 90 filled days" — what a start would carry across. */
function describeImport(report) {
  return `${plural(report.activities, 'activity', 'activities')} in ${plural(report.sections, 'section')}, `
    + `${plural(report.cells, 'filled day')} from this week on`;
}

function startOption({ title, detail, label, run, primary = false }) {
  let busy = false;
  return el('div', { class: 'lae-start-option' }, [
    el('div', {}, [el('strong', { text: title }), el('div', { class: 'rc-hint', text: detail })]),
    el('button', {
      class: `cx-btn mini${primary ? ' primary' : ''}`,
      type: 'button',
      text: label,
      onClick: async (e) => {
        if (busy) return;
        busy = true;
        e.currentTarget.disabled = true;
        try {
          await run();
        } catch (err) {
          toast({ tone: 'bad', message: err.message, timeout: 12000 });
          rc.reportError('lookahead:editor-start', err);
        } finally {
          busy = false;
        }
      },
    }),
  ]);
}

/** The legend a file is read against: the register, or the file's own key. */
async function legendFor(grid) {
  const rows = await rc.listLegend().catch(() => []);
  if (rows.length) return rows.map((r) => ({ argb: r.argb, meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from }));
  return readLegend(grid).map((d) => ({ argb: d.argb, meaning: d.meaning, role: 'shift' }));
}

function titleOf(grid) {
  const first = (grid.rows || []).find((r) => r.row === 1);
  return first?.label || first?.cells?.find((c) => c.value)?.value || '';
}

function importPreview(grid, takenAt, legend = null) {
  const lg = legend || (grid.legend || []);
  const view = readGrid(grid, { anchorISO: String(takenAt || '').slice(0, 10) || null });
  return ed.modelFromView(view, { fromISO: ed.mondayOf(todayISO()), legend: lg.length ? lg : E.legendAll });
}

/** Make the editor the source: write the starting rows, flip the setting, publish. */
async function adopt(model, title = null) {
  if (model) {
    const ops = [];
    for (const r of ed.orderedRows(model.rows, { archived: true })) {
      const { id, version, ...set } = r;
      ops.push({ op: 'row', id, set, expect: 0 });
    }
    for (const c of ed.cellList(model)) {
      ops.push({ op: 'cell', row_id: c.row_id, day: c.day, color: c.color, text: c.text, expect: 0 });
    }
    for (let i = 0; i < ops.length; i += SAVE_BATCH) await rc.applyLookaheadOps(ops.slice(i, i + SAVE_BATCH));
  }
  if (title) await rc.setSetting('lookahead_title', title).catch(() => {});
  await rc.setSetting('lookahead_source', EDITOR_SOURCE);
  la.source = EDITOR_SOURCE;
  la.section = 'editor';
  E.model = null;
  await load();
  E.dirtySincePublish = true;
  await publish();
  toast({ tone: 'good', message: 'The look-ahead is written here now. The workbook is no longer read.' });
  notifyChanged('lookahead');
}

/* ══════════════════════════════════════════════════════════════════════════
   Drawing
   ═══════════════════════════════════════════════════════════════════════ */

function visibleRows() {
  const ordered = ed.orderedRows(E.model.rows, { archived: E.showArchived });
  const needle = E.filter.trim().toLowerCase();
  const out = [];
  let hiddenUntilLevel = null;
  for (let i = 0; i < ordered.length; i++) {
    const r = ordered[i];
    if (hiddenUntilLevel != null) {
      if (r.kind === 'section' && (r.level || 0) <= hiddenUntilLevel) hiddenUntilLevel = null;
      else continue;
    }
    out.push(r);
    if (r.kind === 'section' && E.collapsed.has(r.id)) hiddenUntilLevel = r.level || 0;
  }
  if (!needle) return out;
  // A filter keeps the rows that match, the names under them and the sections above.
  const text = (r) => [r.activity_id, r.description, r.location, r.sswp, r.party, r.work_hours].join(' ').toLowerCase();
  const keep = new Set();
  out.forEach((r) => {
    if (r.kind !== 'resource' && text(r).includes(needle)) keep.add(r.id);
  });
  for (const r of out) if (r.kind === 'resource' && keep.has(r.parent_id)) keep.add(r.id);
  let section = [];
  const result = [];
  for (const r of out) {
    if (r.kind === 'section') {
      section = section.filter((s) => (s.level || 0) < (r.level || 0));
      section.push(r);
      continue;
    }
    if (!keep.has(r.id)) continue;
    for (const s of section) if (!result.includes(s)) result.push(s);
    result.push(r);
  }
  return result.length ? result : [];
}

function draw() {
  const host = E.root;
  if (!host) return;
  const days = windowDays();
  const rows = visibleRows();
  E.view = { rows, days, cols: META + days.length };
  clampSelection();
  E.staff = staffing(days);

  const prevScroll = host.querySelector('.lae-scroll');
  if (prevScroll) E.scroll = { left: prevScroll.scrollLeft, top: prevScroll.scrollTop };
  /* A redraw replaces the grid, and with it whatever had the keyboard. Unless
     somebody is in a dialog or the search box, the keyboard goes back to the
     grid — otherwise every edit would leave the next shortcut talking to
     nothing, and Ctrl+Z straight after a paste would do nothing at all. */
  const active = document.activeElement;
  const refocus = !active || active === document.body || (host.contains(active) && !active.classList.contains('lae-search'));
  clear(host);

  host.append(toolbar(days), grid(rows, days));
  const scroller = host.querySelector('.lae-scroll');
  scroller.scrollLeft = E.scroll.left;
  scroller.scrollTop = E.scroll.top;
  paintSelection();
  if (refocus) scroller.focus({ preventScroll: true });
}

/**
 * Is everybody on the team named where they can be? Only the names rows and
 * the PTO row, against the roster and the leave booked in the calendar — never
 * the support an activity asks for (`staffingIssues()` in `core/la_edit.js`).
 */
function staffing(days) {
  if (!E.resolveName) return { issues: [], byCell: new Map() };
  const meaning = (hex) => E.legendAll.find((e) => e.argb === hex)?.meaning || '';
  return ed.staffingIssues(E.model, days, {
    resolve: E.resolveName,
    leave: E.leave,
    isShift: (hex) => !!meaning(hex) && !isCancelMeaning(meaning(hex)),
    shiftOf: (hex) => meaning(hex) || `#${hex}`,
  });
}

/** Every clash in the window, by day, each one a click from its cell. */
function clashesDialog() {
  const issues = E.staff.issues;
  const rowsOnScreen = E.view.rows;
  const body = el('div', { class: 'lae-form lae-clashes' });
  const byDay = new Map();
  for (const i of issues) {
    if (!byDay.has(i.day)) byDay.set(i.day, []);
    byDay.get(i.day).push(i);
  }
  let handle = null;
  for (const [day, list] of [...byDay.entries()].sort()) {
    body.appendChild(el('div', { class: 'lae-clash-day', text: fmtLong(day) }));
    const seen = new Set();
    for (const i of list) {
      const key = `${i.person_id}|${i.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = rowsOnScreen.findIndex((row) => row.id === i.row_id);
      const c = META + E.view.days.indexOf(day);
      body.appendChild(el('div', { class: 'lae-clash-item' }, [
        el('span', { class: `cx-badge ${i.kind === 'shifts' ? 'warn' : 'bad'}`, text: CLASH_LABELS[i.kind] }),
        el('span', { class: 'lae-clash-detail', text: i.detail }),
        r >= 0 && c >= META
          ? el('button', {
            class: 'cx-btn mini ghost', type: 'button', text: 'Show',
            onClick: () => { handle?.close(); select(r, c); focusGrid(); },
          })
          : el('span', { class: 'rc-hint', text: 'in a folded section' }),
      ]));
    }
  }
  handle = openModal({
    title: 'Who is named where they cannot be',
    subtitle: 'Your team only: names rows against the PTO row, the leave booked in the calendar, and one shift a day. Support requested is not counted.',
    body,
    actions: [{ label: 'Close' }],
  });
}

const CLASH_LABELS = { leave: 'On leave', pto: 'On PTO', shifts: 'Two shifts' };

function fmtLong(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function toolbar(days) {
  const bar = el('div', { class: 'lae-toolbar' });

  /* The window: which Monday, and four weeks or five. */
  const range = el('div', { class: 'lae-group' }, [
    iconButton('chevron-left', 'Previous week', () => moveWindow(-7)),
    el('button', {
      class: 'cx-btn mini ghost', type: 'button', text: 'This week',
      title: 'Start the window on this week\'s Monday', onClick: () => { E.start = ed.mondayOf(todayISO()); redrawWindow(); },
    }),
    iconButton('chevron-right', 'Next week', () => moveWindow(7)),
    el('span', { class: 'lae-range', text: `${fmt(days[0])} – ${fmt(days[days.length - 1])}` }),
    segmented({
      value: E.weeks,
      options: ed.WINDOW_WEEKS.map((w) => ({ value: w, label: `${w} weeks` })),
      onChange: (w) => { E.weeks = w; la.editorWeeks = w; redrawWindow(); },
    }),
  ]);

  const add = el('div', { class: 'lae-group' }, [
    el('button', {
      class: 'cx-btn mini primary', type: 'button', html: icon('plus', { size: 12 }) + '<span>Activity</span>',
      title: 'Add an activity below the selected row', onClick: () => insertRow('activity'),
    }),
    el('button', {
      class: 'cx-btn mini', type: 'button', html: icon('plus', { size: 12 }) + '<span>Section</span>',
      title: 'Add a section heading below the selected row', onClick: () => insertRow('section'),
    }),
  ]);

  /* Paint: the legend's shift colours, and nothing else. */
  const palette = el('div', { class: 'lae-group lae-palette', role: 'group', 'aria-label': 'Paint the selected days' });
  E.legend.forEach((entry, i) => {
    const swatch = el('button', {
      class: 'lae-swatch', type: 'button',
      style: `background-color:#${entry.argb}`,
      'aria-label': `Paint ${entry.meaning}`,
      onClick: () => paint(entry.argb),
    });
    attachTooltip(swatch, `${entry.meaning}${i < 9 ? `  ·  Alt+${i + 1}` : ''}`);
    palette.appendChild(swatch);
  });
  const eraser = el('button', {
    class: 'lae-swatch lae-swatch-none', type: 'button', 'aria-label': 'Remove the colour',
    html: icon('x', { size: 12 }), onClick: () => paint(null),
  });
  attachTooltip(eraser, 'No colour  ·  Alt+0');
  palette.appendChild(eraser);

  /* Support: one press adds a code to every selected day. */
  const support = el('div', { class: 'lae-group lae-codes', role: 'group', 'aria-label': 'Add support to the selected days' });
  for (const code of E.codes.filter((c) => c.active !== false)) {
    const chip = el('button', {
      class: 'lae-code', type: 'button', text: String(code.code).toUpperCase(),
      'aria-label': `Add ${code.name || code.code}`,
      onClick: (e) => addCode(String(code.code).toUpperCase(), e.shiftKey ? -1 : 1),
    });
    attachTooltip(chip, `${code.name || code.code}${code.party ? ` (${code.party})` : ''} — click to add, Shift+click to take one away`);
    support.appendChild(chip);
  }

  const status = el('span', { class: `lae-status lae-status-${E.status}`, role: 'status', 'aria-live': 'polite' }, [
    el('span', { class: 'lae-status-dot' }),
    el('span', { text: statusText() }),
  ]);

  const clashCount = new Set(E.staff.issues.map((i) => `${i.person_id}|${i.day}|${i.kind}`)).size;
  const right = el('div', { class: 'lae-group lae-right' }, [
    clashCount
      ? el('button', {
        class: 'cx-btn mini lae-clash-btn', type: 'button',
        html: icon('alert', { size: 12 }) + `<span>${clashCount} staffing clash${clashCount === 1 ? '' : 'es'}</span>`,
        title: 'People on your team named on a day they are off, or on two shifts',
        onClick: () => clashesDialog(),
      })
      : null,
    iconButton('undo', 'Undo  (Ctrl+Z)', () => undo(), !E.undo.length),
    iconButton('redo', 'Redo  (Ctrl+Y)', () => redo(), !E.redo.length),
    status,
    el('button', {
      class: 'cx-btn mini primary', type: 'button', html: icon('download', { size: 12 }) + '<span>Export to Excel</span>',
      onClick: () => openExport(),
    }),
    iconButton('settings', 'More', (e) => moreMenu(e)),
  ].filter(Boolean));

  const search = textInput({
    value: E.filter,
    placeholder: 'Find a row…',
    mini: true,
    'aria-label': 'Find a row',
    onInput: (v) => {
      E.filter = v;
      // Only the grid is redrawn, never the box being typed in.
      const old = E.root.querySelector('.lae-scroll');
      const days2 = windowDays();
      const rows = visibleRows();
      E.view = { rows, days: days2, cols: META + days2.length };
      clampSelection();
      old.replaceWith(grid(rows, days2));
      paintSelection();
    },
  });
  search.classList.add('lae-search');

  bar.append(range, add, palette, support, search, right);
  return bar;
}

function statusText() {
  if (E.status === 'saving') return 'Saving…';
  if (E.status === 'retry') return `Not saved — retrying${E.retryIn ? ` in ${E.retryIn}s` : ''}`;
  if (E.status === 'conflict') return 'Reloaded';
  return 'All changes saved';
}

function refreshStatus() {
  const node = E.root?.querySelector('.lae-status');
  if (!node) return;
  node.className = `lae-status lae-status-${E.status}`;
  node.lastChild.textContent = statusText();
  const buttons = E.root.querySelectorAll('.lae-right .cx-btn.icon');
  if (buttons[0]) buttons[0].disabled = !E.undo.length;
  if (buttons[1]) buttons[1].disabled = !E.redo.length;
}

function iconButton(name, label, onClick, disabled = false) {
  return el('button', {
    class: 'cx-btn mini ghost icon', type: 'button', 'aria-label': label, title: label,
    html: icon(name, { size: 14 }), disabled, onClick,
  });
}

function fmt(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

async function moveWindow(delta) {
  E.start = ed.addDaysISO(E.start, delta);
  await redrawWindow();
}

async function redrawWindow() {
  await ensureLoaded();
  draw();
}

function grid(rows, days) {
  const today = todayISO();
  const table = el('table', { class: 'lae-grid', role: 'grid', 'aria-label': 'Look-ahead editor' });

  /* Three header rows, as on the sheet: the month band, day numbers, weekday letters. */
  const h1 = el('tr');
  const h2 = el('tr');
  const h3 = el('tr');
  h1.appendChild(el('th', { class: 'lae-handle-head', rowspan: '3' }));
  ed.FIELDS.forEach((f, i) => h1.appendChild(el('th', {
    class: `lae-meta lae-meta-${f.key}${i === META - 1 ? ' lae-meta-last' : ''}`, rowspan: '3', text: f.heading,
  })));
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && ed.monthLabel(days[j + 1]) === ed.monthLabel(days[i])) j++;
    h1.appendChild(el('th', { class: 'lae-month', colspan: String(j - i + 1), text: ed.monthLabel(days[i]) }));
    i = j + 1;
  }
  days.forEach((d) => {
    const cls = `${ed.isWeekend(d) ? 'lae-weekend' : ''}${d === today ? ' lae-today' : ''}`;
    h2.appendChild(el('th', { class: `lae-num ${cls}`, text: String(Number(d.slice(8, 10))) }));
    h3.appendChild(el('th', { class: `lae-wd ${cls}`, text: ed.weekdayLetter(d), title: d === today ? 'Today' : '' }));
  });
  table.appendChild(el('thead', {}, [h1, h2, h3]));

  const body = el('tbody');
  rows.forEach((row, r) => body.appendChild(bodyRow(row, r, days, today)));
  table.appendChild(body);

  /* What is asked for, day by day. */
  const totals = ed.supportTotals(E.model, days);
  const foot = el('tr', { class: 'lae-totals' });
  foot.appendChild(el('td', { class: 'lae-handle' }));
  foot.appendChild(el('td', {
    class: 'lae-meta lae-meta-last lae-totals-label', colspan: String(META),
    text: 'Support requested',
    title: 'Every support code on every activity, counted per day',
  }));
  days.forEach((d) => {
    const counts = totals.byDay.get(d);
    const text = counts && counts.size ? ed.describeCounts(counts, E.codes).replace(/ · /g, '\n') : '';
    foot.appendChild(el('td', {
      class: `lae-total${ed.isWeekend(d) ? ' lae-weekend' : ''}${d === today ? ' lae-today' : ''}`,
      text,
      title: text ? `${d}: ${ed.describeCounts(counts, E.codes)}` : '',
    }));
  });
  table.appendChild(el('tfoot', {}, [foot]));

  const scroller = el('div', { class: 'lae-scroll', tabindex: '0', 'aria-label': 'Look-ahead editor grid' }, [table]);
  if (!rows.length) {
    scroller.appendChild(emptyState({
      iconName: E.filter ? 'search' : 'list',
      title: E.filter ? 'No rows match' : 'Nothing here yet',
      message: E.filter ? 'Try other words, or clear the search.' : 'Add a section, then the activities under it.',
      action: E.filter ? null : { label: 'Add a section', onClick: () => insertRow('section') },
    }));
  }
  wire(scroller);
  return scroller;
}

function bodyRow(row, r, days, today) {
  const tr = el('tr', { class: `lae-row lae-${row.kind}${row.archived ? ' lae-archived' : ''}`, dataset: { r: String(r), id: row.id } });
  const handle = el('td', { class: 'lae-handle', title: 'Drag to move · right-click for more' }, [
    el('span', { class: 'lae-grip', html: icon('move', { size: 12 }), 'aria-label': 'Move row' }),
  ]);
  if (row.kind === 'section') {
    const open = !E.collapsed.has(row.id);
    handle.appendChild(el('button', {
      class: 'lae-fold', type: 'button', 'aria-expanded': String(open),
      'aria-label': open ? 'Fold this section' : 'Unfold this section',
      html: icon(open ? 'chevron-down' : 'chevron-right', { size: 12 }),
      onClick: (e) => {
        e.stopPropagation();
        if (open) E.collapsed.add(row.id);
        else E.collapsed.delete(row.id);
        draw();
      },
    }));
  }
  tr.appendChild(handle);

  const meta = ed.metaValues(row);
  meta.forEach((value, c) => {
    const td = el('td', {
      class: `lae-cell lae-meta lae-meta-${ed.FIELDS[c].key}${c === META - 1 ? ' lae-meta-last' : ''}`,
      dataset: { c: String(c) },
      text: value,
    });
    if (row.kind === 'section' && c === 1) td.style.paddingLeft = `${8 + (row.level || 0) * 14}px`;
    if (!editable(row, c)) td.classList.add('lae-fixed');
    tr.appendChild(td);
  });

  days.forEach((d, i) => {
    const c = META + i;
    const cell = row.kind === 'section' ? null : ed.getCell(E.model, row.id, d);
    const cls = ['lae-cell', 'lae-day'];
    if (ed.isWeekend(d)) cls.push('lae-weekend');
    if (d === today) cls.push('lae-today');
    if (cell?.color) {
      cls.push('lae-painted');
      if (isDark(cell.color)) cls.push('lae-dark');
      const known = E.legendAll.find((e) => e.argb === cell.color);
      if (known && /cancel/i.test(known.meaning || '')) cls.push('lae-cancel');
    }
    let title = '';
    if (row.kind === 'activity' && cell?.text) {
      const parsed = ed.parseSupport(cell.text, E.codes);
      if (parsed.unknown.length && looksLikeCodes(cell.text)) {
        cls.push('lae-unknown-code');
        title = `Not a support code yet: ${parsed.unknown.join(', ')} — add it under Legend → Support codes`;
      } else if (parsed.tokens.length && looksLikeCodes(cell.text)) {
        title = parsed.tokens.map((t) => codeName(t.code)).join(' + ');
      }
    }
    if (cell?.color) {
      const meaning = E.legendAll.find((e) => e.argb === cell.color)?.meaning;
      if (meaning) title = [meaning, title].filter(Boolean).join(' · ');
    }
    // Names are wider than a day; the whole list is one hover away.
    if (!title && cell?.text) title = cell.text;
    const clashes = E.staff.byCell.get(ed.cellKey(row.id, d));
    if (clashes?.length) {
      cls.push('lae-clash');
      title = [...new Set(clashes.map((x) => x.detail))].join('\n') + (title ? `\n${title}` : '');
    }
    const td = el('td', { class: cls.join(' '), dataset: { c: String(c) }, text: cell?.text || '', title });
    if (cell?.color) td.style.backgroundColor = `#${cell.color}`;
    if (!editable(row, c)) td.classList.add('lae-fixed');
    tr.appendChild(td);
  });
  return tr;
}

function codeName(code) {
  const c = E.codes.find((x) => String(x.code).toUpperCase() === code);
  return c ? (c.name || c.code) : code;
}

function looksLikeCodes(text) {
  return /^[A-Za-z0-9]{1,8}(\.[A-Za-z0-9]{1,8})*$/.test(String(text).trim());
}

/** What may be typed where. */
function editable(row, c) {
  if (!row) return false;
  if (c < META) {
    if (row.kind === 'activity') return true;
    if (row.kind === 'section' || row.kind === 'absence') return c === 1;
    return false; // a Resource row's left-hand side is its activity's
  }
  return row.kind !== 'section';
}

function paintable(row, c) {
  return row?.kind === 'activity' && c >= META;
}

/* ══════════════════════════════════════════════════════════════════════════
   Selection
   ═══════════════════════════════════════════════════════════════════════ */

function clampSelection() {
  const maxR = Math.max(0, (E.view?.rows.length || 1) - 1);
  const maxC = Math.max(0, (E.view?.cols || 1) - 1);
  for (const p of [E.anchor, E.focus]) {
    p.r = Math.min(Math.max(0, p.r), maxR);
    p.c = Math.min(Math.max(0, p.c), maxC);
  }
}

function rect() {
  return {
    r0: Math.min(E.anchor.r, E.focus.r),
    r1: Math.max(E.anchor.r, E.focus.r),
    c0: Math.min(E.anchor.c, E.focus.c),
    c1: Math.max(E.anchor.c, E.focus.c),
  };
}

function tdAt(r, c) {
  return E.root?.querySelector(`.lae-grid tbody tr[data-r="${r}"] td[data-c="${c}"]`) || null;
}

function paintSelection() {
  const root = E.root;
  if (!root) return;
  for (const n of root.querySelectorAll('.lae-sel, .lae-cur, .lae-sel-row')) n.classList.remove('lae-sel', 'lae-cur', 'lae-sel-row');
  root.querySelector('.lae-fill-handle')?.remove();
  if (!E.view?.rows.length) return;
  const { r0, r1, c0, c1 } = rect();
  for (let r = r0; r <= r1; r++) {
    const tr = root.querySelector(`.lae-grid tbody tr[data-r="${r}"]`);
    if (!tr) continue;
    if (c0 === 0 && c1 === E.view.cols - 1) tr.classList.add('lae-sel-row');
    for (let c = c0; c <= c1; c++) tr.querySelector(`td[data-c="${c}"]`)?.classList.add('lae-sel');
  }
  const cur = tdAt(E.focus.r, E.focus.c);
  cur?.classList.add('lae-cur');
  const corner = tdAt(r1, c1);
  if (corner) {
    corner.appendChild(el('span', { class: 'lae-fill-handle', title: 'Drag to repeat the selection', 'aria-hidden': 'true' }));
  }
  E.root.querySelector('.lae-range-info')?.remove();
}

function select(r, c, extend = false) {
  E.focus = { r, c };
  if (!extend) E.anchor = { r, c };
  clampSelection();
  paintSelection();
  tdAt(E.focus.r, E.focus.c)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** The selected cells as `{ row, c, day }`. */
function selectedCells() {
  const { r0, r1, c0, c1 } = rect();
  const out = [];
  for (let r = r0; r <= r1; r++) {
    const row = E.view.rows[r];
    for (let c = c0; c <= c1; c++) out.push({ row, r, c, day: c >= META ? E.view.days[c - META] : null });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   Input
   ═══════════════════════════════════════════════════════════════════════ */

function wire(scroller) {
  scroller.addEventListener('scroll', () => { E.scroll = { left: scroller.scrollLeft, top: scroller.scrollTop }; });
  scroller.addEventListener('keydown', onKey);

  let dragging = null;
  scroller.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (E.editing && !E.editing.input.contains(e.target)) commitEdit();
    if (e.target.closest('.lae-fold')) return;

    if (e.target.classList.contains('lae-fill-handle')) {
      e.preventDefault();
      dragging = { kind: 'fill', from: rect(), to: { ...E.focus } };
      scroller.focus({ preventScroll: true });
      return;
    }
    const handle = e.target.closest('td.lae-handle');
    if (handle) {
      const tr = handle.closest('tr[data-r]');
      if (!tr) return;
      e.preventDefault();
      const r = Number(tr.dataset.r);
      E.anchor = { r, c: 0 };
      E.focus = { r, c: E.view.cols - 1 };
      paintSelection();
      scroller.focus({ preventScroll: true });
      dragging = { kind: 'row', from: r, over: r, moved: false, y: e.clientY };
      return;
    }
    const td = e.target.closest('td[data-c]');
    const tr = td?.closest('tr[data-r]');
    if (!td || !tr) return;
    e.preventDefault();
    scroller.focus({ preventScroll: true });
    select(Number(tr.dataset.r), Number(td.dataset.c), e.shiftKey);
    dragging = { kind: 'select' };
  });

  scroller.addEventListener('mouseover', (e) => {
    if (!dragging) return;
    const td = e.target.closest('td[data-c], td.lae-handle');
    const tr = td?.closest('tr[data-r]');
    if (!tr) return;
    const r = Number(tr.dataset.r);
    if (dragging.kind === 'select' && td.dataset.c != null) {
      E.focus = { r, c: Number(td.dataset.c) };
      paintSelection();
    } else if (dragging.kind === 'fill' && td.dataset.c != null) {
      dragging.to = { r, c: Number(td.dataset.c) };
      showFillPreview(dragging);
    } else if (dragging.kind === 'row') {
      dragging.over = r;
      dragging.moved = dragging.moved || r !== dragging.from;
      showDropLine(r > dragging.from ? r + 1 : r);
    }
  });

  const end = () => {
    if (!dragging) return;
    const d = dragging;
    dragging = null;
    E.root?.querySelector('.lae-drop-line')?.remove();
    for (const n of E.root?.querySelectorAll('.lae-fill-preview') || []) n.classList.remove('lae-fill-preview');
    if (d.kind === 'fill') applyFill(d.from, d.to);
    if (d.kind === 'row' && d.moved) moveRowTo(d.from, d.over);
  };
  document.addEventListener('mouseup', end);

  scroller.addEventListener('dblclick', (e) => {
    const td = e.target.closest('td[data-c]');
    const tr = td?.closest('tr[data-r]');
    if (!td || !tr) return;
    select(Number(tr.dataset.r), Number(td.dataset.c));
    startEdit(null);
  });

  scroller.addEventListener('contextmenu', (e) => {
    const td = e.target.closest('td[data-c], td.lae-handle');
    const tr = td?.closest('tr[data-r]');
    if (!tr) return;
    e.preventDefault();
    const r = Number(tr.dataset.r);
    const c = td.dataset.c != null ? Number(td.dataset.c) : null;
    const { r0, r1, c0, c1 } = rect();
    const inside = r >= r0 && r <= r1 && (c == null || (c >= c0 && c <= c1));
    if (!inside) {
      if (c == null) {
        E.anchor = { r, c: 0 };
        E.focus = { r, c: E.view.cols - 1 };
        paintSelection();
      } else {
        select(r, c);
      }
    }
    cellMenu(e.clientX, e.clientY, E.view.rows[r]);
  });

  /* The clipboard, through the events every browser raises — no permission
     prompt, and the HTML flavour is what carries colours to and from Excel. */
  const mine = () => E.root && document.activeElement === scroller && !E.editing;
  const onCopy = (e) => { if (mine()) { e.preventDefault(); copy(e.clipboardData, false); } };
  const onCut = (e) => { if (mine()) { e.preventDefault(); copy(e.clipboardData, true); } };
  const onPaste = (e) => { if (mine()) { e.preventDefault(); paste(e.clipboardData); } };
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);
  // A redraw replaces the scroller; the old one's document listeners go with it.
  const stop = new MutationObserver(() => {
    if (!scroller.isConnected) {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('mouseup', end);
      stop.disconnect();
    }
  });
  if (E.root) stop.observe(E.root, { childList: true, subtree: true });
}

function onKey(e) {
  if (E.editing) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key;
  const { rows, cols } = E.view;
  if (!rows.length) return;
  const move = (dr, dc, extend) => {
    e.preventDefault();
    const base = E.focus;
    select(Math.min(Math.max(0, base.r + dr), rows.length - 1), Math.min(Math.max(0, base.c + dc), cols - 1), extend);
  };

  if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k.toLowerCase() === 'a') {
    e.preventDefault();
    E.anchor = { r: 0, c: 0 };
    E.focus = { r: rows.length - 1, c: cols - 1 };
    paintSelection();
    return;
  }
  if (mod && k.toLowerCase() === 'd') { e.preventDefault(); fillDown(); return; }
  if (mod && k.toLowerCase() === 'r') { e.preventDefault(); fillRight(); return; }
  if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); nudgeRow(k === 'ArrowUp' ? -1 : 1); return; }
  if (e.altKey && /^[0-9]$/.test(k)) {
    e.preventDefault();
    if (k === '0') paint(null);
    else if (E.legend[Number(k) - 1]) paint(E.legend[Number(k) - 1].argb);
    return;
  }
  if (e.altKey && /^Digit[0-9]$/.test(e.code)) {
    // Alt+digit types a symbol on some layouts; the physical key still says which.
    e.preventDefault();
    const n = Number(e.code.slice(5));
    if (n === 0) paint(null);
    else if (E.legend[n - 1]) paint(E.legend[n - 1].argb);
    return;
  }

  switch (k) {
    case 'ArrowUp': return move(-1, 0, e.shiftKey);
    case 'ArrowDown': return move(1, 0, e.shiftKey);
    case 'ArrowLeft': return move(0, -1, e.shiftKey);
    case 'ArrowRight': return move(0, 1, e.shiftKey);
    case 'Tab': return move(0, e.shiftKey ? -1 : 1, false);
    case 'Enter': return move(e.shiftKey ? -1 : 1, 0, false);
    case 'Home': return move(0, -E.focus.c + (mod ? 0 : 0), e.shiftKey);
    case 'End': return move(0, cols - 1 - E.focus.c, e.shiftKey);
    case 'F2': e.preventDefault(); startEdit(null); return;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      clearSelection({ colour: e.shiftKey });
      return;
    case 'Escape':
      E.clip = null;
      E.root?.querySelectorAll('.lae-clip').forEach((n) => n.classList.remove('lae-clip'));
      return;
    default:
      break;
  }
  // Typing starts an edit, replacing what was there — as a spreadsheet does.
  if (!mod && !e.altKey && k.length === 1) {
    e.preventDefault();
    startEdit(k);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Editing a cell in place
   ═══════════════════════════════════════════════════════════════════════ */

function startEdit(initial) {
  const { r, c } = E.focus;
  const row = E.view.rows[r];
  if (!editable(row, c)) {
    if (row?.kind === 'section' && c >= META) toast({ message: 'A section heading has no days — type its title instead.' });
    return;
  }
  const td = tdAt(r, c);
  const scroller = E.root.querySelector('.lae-scroll');
  if (!td || !scroller) return;
  const current = c < META ? String(row[ed.FIELDS[c].key] ?? (row.kind === 'section' || row.kind === 'absence' ? row.description : ''))
    : (ed.getCell(E.model, row.id, E.view.days[c - META])?.text || '');
  const value = initial != null ? initial : (c === 1 && row.kind !== 'activity' ? row.description : current);

  const box = td.getBoundingClientRect();
  const host = scroller.getBoundingClientRect();
  const wide = c < META ? Math.max(box.width, 160) : Math.max(box.width, 120);
  const input = el('input', {
    class: 'lae-editor',
    type: 'text',
    value,
    'aria-label': c < META ? ed.FIELDS[c].heading : `${row.description || 'Row'} on ${E.view.days[c - META]}`,
    style: `left:${box.left - host.left + scroller.scrollLeft}px;top:${box.top - host.top + scroller.scrollTop}px;`
      + `width:${wide}px;height:${box.height}px`,
  });
  input.value = value;
  scroller.appendChild(input);

  // Support codes, one press each, while typing into an activity's day.
  let hint = null;
  if (row.kind === 'activity' && c >= META && E.codes.length) {
    hint = el('div', {
      class: 'lae-edit-hint',
      style: `left:${box.left - host.left + scroller.scrollLeft}px;top:${box.bottom - host.top + scroller.scrollTop + 2}px`,
    }, E.codes.filter((x) => x.active !== false).map((x) => el('button', {
      class: 'lae-code', type: 'button', text: String(x.code).toUpperCase(),
      title: x.name || x.code,
      onMouseDown: (ev) => {
        ev.preventDefault();
        const code = String(x.code).toUpperCase();
        input.value = ed.normaliseSupport(input.value ? `${input.value}.${code}` : code);
        input.focus();
      },
    })));
    scroller.appendChild(hint);
  }

  /* Names from the roster, while typing into a row of names. The sheet is
     written in first names, and what is suggested is what the name register
     will place — a first name where only one person has it, the full name
     where two do — so a name typed here is never one somebody has to correct
     on the week plan later. */
  let names = null;
  let pick = -1;
  let found = [];
  if ((row.kind === 'resource' || row.kind === 'absence') && c >= META && E.names?.length) {
    names = el('div', {
      class: 'lae-edit-hint lae-names', role: 'listbox', 'aria-label': 'People on the roster',
      style: `left:${box.left - host.left + scroller.scrollLeft}px;top:${box.bottom - host.top + scroller.scrollTop + 2}px`,
    });
    scroller.appendChild(names);
    hint = names;
    const drawNames = () => {
      found = ed.suggestNames(input.value, E.names);
      pick = found.length ? Math.min(Math.max(pick, 0), found.length - 1) : -1;
      clear(names);
      names.hidden = !found.length;
      found.forEach((n, i) => names.appendChild(el('button', {
        class: `lae-name${i === pick ? ' lae-name-on' : ''}`, type: 'button', role: 'option',
        'aria-selected': String(i === pick), text: n.insert, title: n.full,
        onMouseDown: (ev) => { ev.preventDefault(); take(i); },
      })));
    };
    const take = (i) => {
      input.value = ed.acceptName(input.value, found[i].insert);
      pick = -1;
      drawNames();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    };
    input.addEventListener('input', () => { pick = 0; drawNames(); });
    names.take = take;
    drawNames();
  }

  E.editing = { input, hint, r, c, row };
  input.focus();
  if (initial == null) input.select();
  else input.setSelectionRange(input.value.length, input.value.length);

  input.addEventListener('keydown', (e) => {
    // With a name on offer, the arrows choose and Enter or Tab takes it;
    // with none, they do what they always do.
    if (names && found.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      pick = (pick + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
      for (const [i, b] of [...names.children].entries()) {
        b.classList.toggle('lae-name-on', i === pick);
        b.setAttribute('aria-selected', String(i === pick));
      }
      e.stopPropagation();
      return;
    }
    if (names && found.length && pick >= 0 && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
      e.preventDefault();
      names.take(pick);
      e.stopPropagation();
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); select(Math.min(r + (e.shiftKey ? -1 : 1), E.view.rows.length - 1), c); focusGrid(); }
    else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); select(r, Math.min(Math.max(0, c + (e.shiftKey ? -1 : 1)), E.view.cols - 1)); focusGrid(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); focusGrid(); }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => { if (E.editing?.input === input) commitEdit(); });
}

function focusGrid() {
  E.root?.querySelector('.lae-scroll')?.focus({ preventScroll: true });
}

function cancelEdit() {
  if (!E.editing) return;
  // Cleared first: removing a focused input fires its blur, and the blur
  // handler must find nothing left to commit.
  const { input, hint } = E.editing;
  E.editing = null;
  input.remove();
  hint?.remove();
}

function commitEdit() {
  if (!E.editing) return;
  const { input, r, c, row } = E.editing;
  let value = input.value;
  cancelEdit();
  if (!E.model.rows.some((x) => x.id === row.id)) return;
  if (c < META) {
    const key = row.kind === 'activity' ? ed.FIELDS[c].key : 'description';
    if ((row[key] ?? '') === value) return;
    commit([{ op: 'row', id: row.id, set: { [key]: value } }]);
    return;
  }
  const day = E.view.days[c - META];
  const cell = ed.getCell(E.model, row.id, day);
  if (row.kind === 'activity' && looksLikeCodes(value.replace(/\s+/g, ''))) value = ed.normaliseSupport(value);
  value = value.trim();
  if ((cell?.text || '') === value) return;
  commit([{ op: 'cell', row_id: row.id, day, color: cell?.color || null, text: value }]);
  if (row.kind === 'activity') warnUnknown([value]);
}

function warnUnknown(texts) {
  const unknown = new Set();
  for (const t of texts) {
    if (!looksLikeCodes(t)) continue;
    for (const code of ed.parseSupport(t, E.codes).unknown) unknown.add(code);
  }
  if (unknown.size) {
    toast({
      tone: 'warn',
      message: `${[...unknown].join(', ')} ${unknown.size === 1 ? 'is' : 'are'} not a support code yet. It is kept as typed and `
        + 'marked on the grid — add it under Legend → Support codes to count it.',
      timeout: 9000,
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Commands
   ═══════════════════════════════════════════════════════════════════════ */

/** Apply ops here, remember how to undo them, and queue them for saving. */
function commit(ops, { keepRedo = false } = {}) {
  const useful = ops.filter((op) => {
    if (op.op !== 'cell') return true;
    const was = ed.getCell(E.model, op.row_id, op.day);
    return (was?.color || null) !== (op.color ? String(op.color).toUpperCase() : null) || (was?.text || '') !== String(op.text ?? '');
  });
  if (!useful.length) return;
  const inverse = ed.applyOps(E.model, useful);
  E.undo.push({ ops: useful, inverse });
  if (E.undo.length > 200) E.undo.shift();
  if (!keepRedo) E.redo = [];
  enqueue(useful);
  draw();
}

function undo() {
  const entry = E.undo.pop();
  if (!entry) return;
  cancelEdit();
  const again = ed.applyOps(E.model, entry.inverse);
  E.redo.push({ ops: entry.inverse, inverse: again });
  enqueue(entry.inverse);
  draw();
}

function redo() {
  const entry = E.redo.pop();
  if (!entry) return;
  const again = ed.applyOps(E.model, entry.inverse);
  E.undo.push({ ops: entry.inverse, inverse: again });
  enqueue(entry.inverse);
  draw();
}

function paint(color) {
  const ops = [];
  let skipped = 0;
  for (const s of selectedCells()) {
    if (s.c < META) continue;
    if (!paintable(s.row, s.c)) { if (s.row?.kind !== 'section') skipped++; continue; }
    const cell = ed.getCell(E.model, s.row.id, s.day);
    ops.push({ op: 'cell', row_id: s.row.id, day: s.day, color, text: cell?.text || '' });
  }
  if (!ops.length) {
    toast({ message: skipped ? 'Only an activity\'s days take a colour — names and PTO rows stay plain.' : 'Select the days to paint first.' });
    return;
  }
  // Only the days that were not already this colour are newly cancelled.
  const fresh = ops.filter((o) => (ed.getCell(E.model, o.row_id, o.day)?.color || null) !== color);
  commit(ops);
  const meaning = color ? E.legendAll.find((e) => e.argb === color)?.meaning : null;
  if (meaning && isCancelMeaning(meaning) && fresh.length) {
    const rows = new Map(E.model.rows.map((r) => [r.id, r]));
    askWhyCancelled(ed.dayRuns(fresh.map((o) => ({ row: rows.get(o.row_id), day: o.day })).filter((x) => x.row)));
  }
}

/**
 * Who cancelled it, and why — asked at the moment the day turns red.
 *
 * The cancellation log used to be filled in afterwards, from a list, by
 * whoever remembered; by then "BART pulled the possession on Tuesday night" is
 * a guess. So painting a day in the cancellation colour asks, there and then,
 * and writes the same note the log's own dialog writes — keyed the way the log
 * will key the event (`cancellationKey()`), so it is waiting there when the
 * look-ahead is published. "Not now" is always an answer: the log still lists
 * the event, unexplained, for later.
 */
function askWhyCancelled(runs) {
  if (!runs.length) return;
  const party = selectInput({ value: 'BART', options: ['BART', 'Hitachi', 'Other'] });
  const reason = el('textarea', { class: 'cx-input', rows: 3, placeholder: 'What happened — e.g. possession withdrawn by BART' });
  const list = el('ul', { class: 'lae-cancel-runs' }, runs.map((r) => el('li', {
    text: `${r.row.description || 'Activity'}${r.row.location ? ` at ${r.row.location}` : ''} — `
      + `${r.start === r.end ? fmt(r.start) : `${fmt(r.start)} – ${fmt(r.end)}`}`,
  })));
  openModal({
    title: runs.length === 1 ? 'Why was this cancelled?' : `Why were these ${runs.length} cancelled?`,
    subtitle: 'Recorded in the cancellation log, attributed and dated',
    body: el('div', { class: 'lae-form lae-cancel-form' }, [
      list,
      el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Responsible party' }), party]),
      el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Reason' }), reason]),
    ]),
    actions: [
      { label: 'Not now' },
      {
        label: 'Record', kind: 'primary', autofocus: true, onClick: async () => {
          try {
            for (const r of runs) {
              await rc.addCancellationNote({
                ...ed.cancellationKey(r.row),
                start_date: r.start,
                end_date: r.end,
                party: party.value,
                reason: reason.value.trim() || null,
              });
            }
            toast({ tone: 'good', message: `Recorded in the cancellation log — ${party.value}.` });
          } catch (err) {
            toast({ tone: 'bad', message: err.message, timeout: 10000 });
            rc.reportError('lookahead:cancel-note', err);
          }
        },
      },
    ],
  });
}

function addCode(code, direction) {
  const ops = [];
  for (const s of selectedCells()) {
    if (!paintable(s.row, s.c)) continue;
    const cell = ed.getCell(E.model, s.row.id, s.day);
    const tokens = ed.supportTokens(cell?.text || '');
    if (direction > 0) tokens.push(code);
    else {
      const at = tokens.lastIndexOf(code);
      if (at < 0) continue;
      tokens.splice(at, 1);
    }
    ops.push({ op: 'cell', row_id: s.row.id, day: s.day, color: cell?.color || null, text: tokens.join('.') });
  }
  if (!ops.length) {
    toast({ message: 'Select an activity\'s days first — support is asked for on activities.' });
    return;
  }
  commit(ops);
}

function clearSelection({ colour = false } = {}) {
  const ops = [];
  for (const s of selectedCells()) {
    if (!editable(s.row, s.c)) continue;
    if (s.c < META) {
      const key = s.row.kind === 'activity' ? ed.FIELDS[s.c].key : 'description';
      if (s.row[key]) ops.push({ op: 'row', id: s.row.id, set: { [key]: '' } });
      continue;
    }
    const cell = ed.getCell(E.model, s.row.id, s.day);
    if (!cell) continue;
    ops.push({ op: 'cell', row_id: s.row.id, day: s.day, color: colour ? null : cell.color, text: '' });
  }
  commit(ops);
}

/** The selection as a block of `{ color, text }`, for copying and filling. */
function block(sel = rect()) {
  const out = [];
  for (let r = sel.r0; r <= sel.r1; r++) {
    const row = E.view.rows[r];
    const line = [];
    for (let c = sel.c0; c <= sel.c1; c++) {
      if (c < META) {
        const v = ed.metaValues(row)[c];
        line.push({ color: null, text: v });
      } else {
        const cell = row.kind === 'section' ? null : ed.getCell(E.model, row.id, E.view.days[c - META]);
        line.push({ color: cell?.color || null, text: cell?.text || '' });
      }
    }
    out.push(line);
  }
  return out;
}

/** Write a block into the grid from (r, c), within what each cell allows. */
function writeBlock(data, r0, c0) {
  const ops = [];
  let droppedColour = 0;
  const shift = new Set(E.legend.map((e) => e.argb));
  data.forEach((line, dr) => {
    const row = E.view.rows[r0 + dr];
    if (!row) return;
    line.forEach((v, dc) => {
      const c = c0 + dc;
      if (c >= E.view.cols || !editable(row, c)) return;
      if (c < META) {
        const key = row.kind === 'activity' ? ed.FIELDS[c].key : 'description';
        if ((row[key] ?? '') !== v.text) ops.push({ op: 'row', id: row.id, set: { [key]: v.text } });
        return;
      }
      let color = v.color ? String(v.color).toUpperCase() : null;
      if (color && (!paintable(row, c) || !shift.has(color))) { droppedColour++; color = null; }
      let text = String(v.text ?? '');
      if (row.kind === 'activity' && looksLikeCodes(text.replace(/\s+/g, ''))) text = ed.normaliseSupport(text);
      ops.push({ op: 'cell', row_id: row.id, day: E.view.days[c - META], color, text });
    });
  });
  // Several ops on one row's fields collapse into the last, so undo is one step.
  commit(ops);
  if (droppedColour) {
    toast({
      tone: 'warn',
      message: `${droppedColour} colour${droppedColour === 1 ? '' : 's'} left off: only the legend's shift colours are `
        + 'painted, and only on an activity\'s days. The text came across.',
      timeout: 8000,
    });
  }
  return ops;
}

function copy(data, cut) {
  const b = block();
  E.clip = { block: b, tsv: ed.toTSV(b) };
  data?.setData('text/plain', E.clip.tsv);
  data?.setData('text/html', ed.toHTML(b));
  E.root?.querySelectorAll('.lae-clip').forEach((n) => n.classList.remove('lae-clip'));
  for (const n of E.root?.querySelectorAll('.lae-sel') || []) n.classList.add('lae-clip');
  if (cut) clearSelection({ colour: true });
  const n = b.length * (b[0]?.length || 0);
  toast({ message: `${cut ? 'Cut' : 'Copied'} ${n} cell${n === 1 ? '' : 's'} — paste here or into Excel.`, timeout: 2500 });
}

function paste(data) {
  const html = data?.getData('text/html') || '';
  const text = data?.getData('text/plain') || '';
  let incoming = null;
  if (E.clip && text && text === E.clip.tsv) incoming = E.clip.block;
  else if (/<table/i.test(html)) incoming = fromHtml(html);
  if (!incoming && text) incoming = ed.fromTSV(text);
  if (!incoming?.length) return;
  const sel = rect();
  const h = incoming.length;
  const w = incoming[0].length;
  // A single value, or a block that divides the selection evenly, fills it.
  const selH = sel.r1 - sel.r0 + 1;
  const selW = sel.c1 - sel.c0 + 1;
  const fill = (selH > h || selW > w) && selH % h === 0 && selW % w === 0;
  writeBlock(fill ? ed.tile(incoming, selH, selW) : incoming, sel.r0, sel.c0);
  const lastR = Math.min(sel.r0 + (fill ? selH : h) - 1, E.view.rows.length - 1);
  const lastC = Math.min(sel.c0 + (fill ? selW : w) - 1, E.view.cols - 1);
  E.anchor = { r: sel.r0, c: sel.c0 };
  E.focus = { r: lastR, c: lastC };
  paintSelection();
}

/** An HTML table from Excel or anywhere else: text, and each cell's fill as hex. */
function fromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  // Excel puts the fills in a stylesheet keyed by class.
  const classFill = new Map();
  for (const style of doc.querySelectorAll('style')) {
    for (const m of style.textContent.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      const bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(m[2]);
      if (bg) classFill.set(m[1], bg[1].trim());
    }
  }
  const probe = el('span');
  document.body.appendChild(probe);
  const toHex = (value) => {
    if (!value) return null;
    const v = value.trim().replace(/\s+none$/i, '');
    if (/^#?[0-9a-f]{6}$/i.test(v)) return v.replace('#', '').toUpperCase();
    probe.style.color = '';
    probe.style.color = v;
    if (!probe.style.color) return null;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color);
    return m ? [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
  };
  const out = [];
  for (const tr of table.querySelectorAll('tr')) {
    const line = [];
    for (const td of tr.querySelectorAll('td, th')) {
      const inline = /background(?:-color)?\s*:\s*([^;]+)/i.exec(td.getAttribute('style') || '')?.[1]
        || td.getAttribute('bgcolor')
        || [...td.classList].map((c) => classFill.get(c)).find(Boolean)
        || null;
      let color = toHex(inline);
      if (color === 'FFFFFF') color = null; // white is no fill, on the sheet as here
      const span = Number(td.getAttribute('colspan')) || 1;
      for (let i = 0; i < span; i++) line.push({ color, text: td.textContent.replace(/\s+/g, ' ').trim() });
    }
    out.push(line);
  }
  probe.remove();
  const width = Math.max(...out.map((l) => l.length));
  return out.map((l) => [...l, ...Array.from({ length: width - l.length }, () => ({ color: null, text: '' }))]);
}

function showFillPreview(d) {
  for (const n of E.root.querySelectorAll('.lae-fill-preview')) n.classList.remove('lae-fill-preview');
  const target = fillTarget(d.from, d.to);
  if (!target) return;
  for (let r = target.r0; r <= target.r1; r++) {
    for (let c = target.c0; c <= target.c1; c++) tdAt(r, c)?.classList.add('lae-fill-preview');
  }
}

/** Drag the corner: across or down, whichever the pointer went further. */
function fillTarget(from, to) {
  const down = to.r - from.r1;
  const up = from.r0 - to.r;
  const right = to.c - from.c1;
  const left = from.c0 - to.c;
  const vertical = Math.max(down, up);
  const horizontal = Math.max(right, left);
  if (vertical <= 0 && horizontal <= 0) return null;
  if (horizontal >= vertical) {
    return right > 0
      ? { r0: from.r0, r1: from.r1, c0: from.c1 + 1, c1: to.c }
      : { r0: from.r0, r1: from.r1, c0: to.c, c1: from.c0 - 1 };
  }
  return down > 0
    ? { r0: from.r1 + 1, r1: to.r, c0: from.c0, c1: from.c1 }
    : { r0: to.r, r1: from.r0 - 1, c0: from.c0, c1: from.c1 };
}

function applyFill(from, to) {
  const target = fillTarget(from, to);
  if (!target) return;
  const source = block(from);
  const tiled = ed.tile(source, target.r1 - target.r0 + 1, target.c1 - target.c0 + 1);
  writeBlock(tiled, target.r0, target.c0);
  E.anchor = { r: Math.min(from.r0, target.r0), c: Math.min(from.c0, target.c0) };
  E.focus = { r: Math.max(from.r1, target.r1), c: Math.max(from.c1, target.c1) };
  paintSelection();
}

function fillDown() {
  const sel = rect();
  if (sel.r1 === sel.r0) return;
  const top = block({ ...sel, r1: sel.r0 });
  writeBlock(ed.tile(top, sel.r1 - sel.r0, sel.c1 - sel.c0 + 1), sel.r0 + 1, sel.c0);
}

function fillRight() {
  const sel = rect();
  if (sel.c1 === sel.c0) return;
  const left = block({ ...sel, c1: sel.c0 });
  writeBlock(ed.tile(left, sel.r1 - sel.r0 + 1, sel.c1 - sel.c0), sel.r0, sel.c0 + 1);
}

/* ── Rows ───────────────────────────────────────────────────────────────── */

/** Where a new row goes: after the selected row's block, or at the end. */
function insertionPoint(where = 'below') {
  const ordered = ed.orderedRows(E.model.rows, { archived: true });
  const row = E.view.rows[E.focus.r];
  if (!row) {
    const last = ordered.filter((r) => r.kind !== 'resource').pop();
    return { before: last ? last.sort : null, after: null };
  }
  const idx = ordered.findIndex((r) => r.id === (row.kind === 'resource' ? row.parent_id : row.id));
  const top = ordered.filter((r) => r.kind !== 'resource');
  if (where === 'above') {
    const at = top.findIndex((r) => r.id === ordered[idx].id);
    return { before: top[at - 1]?.sort ?? null, after: top[at].sort };
  }
  // Below: past the whole block — an activity's names, or a section's rows
  // when the section itself is what is selected and folded.
  const [, end] = row.kind === 'section' && E.collapsed.has(row.id) ? ed.sectionBlock(ordered, idx) : ed.rowBlock(ordered, idx);
  const lastTop = [...ordered.slice(idx, end + 1)].reverse().find((r) => r.kind !== 'resource');
  const at = top.findIndex((r) => r.id === lastTop.id);
  return { before: top[at].sort, after: top[at + 1]?.sort ?? null };
}

function insertRow(kind, where = 'below', extra = {}) {
  cancelEdit();
  const { before, after } = insertionPoint(where);
  const id = ed.newId();
  const set = { kind, sort: ed.sortBetween(before, after), ...extra };
  if (kind === 'section') set.description = extra.description ?? 'New section';
  const ops = [{ op: 'row', id, set }];
  if (kind === 'activity') ops.push({ op: 'row', id: ed.newId(), set: { kind: 'resource', parent_id: id, sort: set.sort + 0.001 } });
  commit(ops);
  respaceIfNeeded();
  const r = E.view.rows.findIndex((x) => x.id === id);
  if (r >= 0) {
    select(r, 1);
    focusGrid();
    startEdit(null);
  }
}

function addNamesRow(row) {
  if (E.model.rows.some((r) => r.kind === 'resource' && r.parent_id === row.id)) return;
  commit([{ op: 'row', id: ed.newId(), set: { kind: 'resource', parent_id: row.id, sort: row.sort + 0.001 } }]);
}

function duplicateRow(row) {
  const ordered = ed.orderedRows(E.model.rows, { archived: true });
  const top = ordered.filter((r) => r.kind !== 'resource');
  const at = top.findIndex((r) => r.id === row.id);
  const sort = ed.sortBetween(row.sort, top[at + 1]?.sort ?? null);
  const id = ed.newId();
  const { id: _, version, ...fields } = row;
  const ops = [{ op: 'row', id, set: { ...fields, sort } }];
  for (const c of ed.cellList(E.model).filter((x) => x.row_id === row.id)) {
    ops.push({ op: 'cell', row_id: id, day: c.day, color: c.color, text: c.text });
  }
  for (const kid of E.model.rows.filter((r) => r.kind === 'resource' && r.parent_id === row.id)) {
    const kidId = ed.newId();
    ops.push({ op: 'row', id: kidId, set: { kind: 'resource', parent_id: id, sort: sort + 0.001 } });
    for (const c of ed.cellList(E.model).filter((x) => x.row_id === kid.id)) {
      ops.push({ op: 'cell', row_id: kidId, day: c.day, color: c.color, text: c.text });
    }
  }
  commit(ops);
  respaceIfNeeded();
}

function deleteRows(rows) {
  const ids = [...new Set(rows.filter(Boolean).map((r) => (r.kind === 'resource' ? r.id : r.id)))];
  if (!ids.length) return;
  const ops = ed.deleteOps(E.model, ids);
  commit(ops);
  toast({
    message: `Deleted ${ids.length} row${ids.length === 1 ? '' : 's'}.`,
    action: { label: 'Undo', onClick: () => undo() },
    timeout: 6000,
  });
}

function archiveRows(rows, archived) {
  const ops = rows.filter((r) => r && r.kind !== 'resource').map((r) => ({ op: 'row', id: r.id, set: { archived } }));
  commit(ops);
  if (archived && ops.length) {
    toast({
      message: `Archived ${ops.length} row${ops.length === 1 ? '' : 's'} — off the sheet and out of the export, `
        + 'kept for the record. "Show archived rows" brings them back.',
      action: { label: 'Undo', onClick: () => undo() },
      timeout: 7000,
    });
  }
}

/**
 * Move a row — with everything that belongs to it — to where another is.
 *
 * An activity carries its names; a section carries its whole block. The
 * block lands before the target row when moving up and after it when moving
 * down, which is where the drop line said it would.
 */
function moveRowTo(fromR, toR) {
  const rows = E.view.rows;
  const moving = rows[fromR];
  const target = rows[toR];
  if (!moving || !target || moving.id === target.id) return;
  const ordered = ed.orderedRows(E.model.rows, { archived: true });
  const head = moving.kind === 'resource' ? ordered.find((r) => r.id === moving.parent_id) : moving;
  const idx = ordered.findIndex((r) => r.id === head.id);
  const [s, e] = head.kind === 'section' ? ed.sectionBlock(ordered, idx) : ed.rowBlock(ordered, idx);
  const blockRows = ordered.slice(s, e + 1).filter((r) => r.kind !== 'resource');
  if (blockRows.some((r) => r.id === (target.kind === 'resource' ? target.parent_id : target.id))) return;

  const rest = ordered.filter((r, i) => (i < s || i > e) && r.kind !== 'resource');
  const tHead = target.kind === 'resource' ? rest.find((r) => r.id === target.parent_id) : target;
  let at = rest.findIndex((r) => r.id === tHead.id);
  if (toR > fromR) {
    // After the target's own block.
    const tIdx = ordered.findIndex((r) => r.id === tHead.id);
    const [, te] = tHead.kind === 'section' && E.collapsed.has(tHead.id) ? ed.sectionBlock(ordered, tIdx) : ed.rowBlock(ordered, tIdx);
    const lastTop = [...ordered.slice(tIdx, te + 1)].reverse().find((r) => r.kind !== 'resource');
    at = rest.findIndex((r) => r.id === lastTop.id) + 1;
  }
  const before = rest[at - 1]?.sort ?? null;
  const after = rest[at]?.sort ?? null;
  const n = blockRows.length;
  const lo = before ?? (after != null ? after - 1024 * (n + 1) : 0);
  const hi = after ?? lo + 1024 * (n + 1);
  const ops = blockRows.map((r, i) => ({ op: 'row', id: r.id, set: { sort: lo + ((hi - lo) * (i + 1)) / (n + 1) } }));
  // Names follow their activity by `parent_id`; their own sort just keeps them in order.
  for (const kid of ordered.slice(s, e + 1).filter((r) => r.kind === 'resource')) {
    const parentOp = ops.find((o) => o.id === kid.parent_id);
    if (parentOp) ops.push({ op: 'row', id: kid.id, set: { sort: parentOp.set.sort + 0.001 } });
  }
  commit(ops);
  respaceIfNeeded();
  const r = E.view.rows.findIndex((x) => x.id === moving.id);
  if (r >= 0) {
    E.anchor = { r, c: 0 };
    E.focus = { r, c: E.view.cols - 1 };
    paintSelection();
  }
}

function nudgeRow(direction) {
  const r = E.focus.r;
  const rows = E.view.rows;
  const row = rows[r];
  if (!row) return;
  // The next row that is not one of this row's own, in that direction.
  let t = r + direction;
  while (rows[t] && (rows[t].parent_id === row.id || (row.kind === 'resource' && rows[t].id === row.parent_id))) t += direction;
  if (!rows[t]) return;
  moveRowTo(r, t);
}

function respaceIfNeeded() {
  const ordered = ed.orderedRows(E.model.rows, { archived: true });
  if (ed.needsRespace(ordered)) {
    const ops = ed.respace(ordered);
    for (const kid of ordered.filter((r) => r.kind === 'resource')) {
      const parent = ops.find((o) => o.id === kid.parent_id);
      if (parent) ops.push({ op: 'row', id: kid.id, set: { sort: parent.set.sort + 0.001 } });
    }
    commit(ops, { keepRedo: true });
  }
}

function showDropLine(r) {
  const scroller = E.root.querySelector('.lae-scroll');
  let line = scroller.querySelector('.lae-drop-line');
  if (!line) {
    line = el('div', { class: 'lae-drop-line' });
    scroller.appendChild(line);
  }
  const tr = E.root.querySelector(`.lae-grid tbody tr[data-r="${Math.min(r, E.view.rows.length - 1)}"]`);
  if (!tr) return;
  const host = scroller.getBoundingClientRect();
  const box = tr.getBoundingClientRect();
  const y = (r >= E.view.rows.length ? box.bottom : box.top) - host.top + scroller.scrollTop;
  line.style.top = `${y - 1}px`;
}

/* ── Menus ─────────────────────────────────────────────────────────────── */

function selectedRows() {
  const { r0, r1 } = rect();
  return E.view.rows.slice(r0, r1 + 1);
}

function cellMenu(x, y, row) {
  const rows = selectedRows();
  const one = rows.length === 1 ? rows[0] : null;
  const days = E.focus.c >= META;
  const items = [
    { label: 'Cut', icon: 'copy', key: 'mod+x', onClick: () => clipboardCommand('cut') },
    { label: 'Copy', icon: 'copy', key: 'mod+c', onClick: () => clipboardCommand('copy') },
    E.clip ? { label: 'Paste', icon: 'clipboard', key: 'mod+v', onClick: () => pasteInternal() } : null,
    days ? { label: 'Clear text', icon: 'x', key: 'del', onClick: () => clearSelection() } : null,
    days ? { label: 'Clear text and colour', icon: 'x', onClick: () => clearSelection({ colour: true }) } : null,
    one && one.kind !== 'section' && days
      ? { label: 'History of this day…', icon: 'history', onClick: () => historyDialog(one, E.view.days[E.focus.c - META]) }
      : null,
    one ? { label: 'History of this row…', icon: 'history', onClick: () => historyDialog(one, null) } : null,
    'sep',
    { heading: 'Row' },
    { label: 'Insert activity above', icon: 'plus', onClick: () => insertRow('activity', 'above') },
    { label: 'Insert activity below', icon: 'plus', onClick: () => insertRow('activity', 'below') },
    { label: 'Insert section above', icon: 'layers', onClick: () => insertRow('section', 'above') },
    { label: 'Insert section below', icon: 'layers', onClick: () => insertRow('section', 'below') },
    one?.kind === 'activity' && !E.model.rows.some((r) => r.kind === 'resource' && r.parent_id === one.id)
      ? { label: 'Add a names row', icon: 'users', onClick: () => addNamesRow(one) } : null,
    { label: 'Add a PTO / Office row', icon: 'calendar', onClick: () => insertRow('absence', 'below', { absence_kind: 'pto', description: 'PTO' }) },
    one && one.kind !== 'resource' ? { label: 'Duplicate', icon: 'copy', onClick: () => duplicateRow(one) } : null,
    one && one.kind !== 'resource' ? { label: 'Move up', icon: 'chevron-up', key: 'alt+↑', onClick: () => nudgeRow(-1) } : null,
    one && one.kind !== 'resource' ? { label: 'Move down', icon: 'chevron-down', key: 'alt+↓', onClick: () => nudgeRow(1) } : null,
    one?.kind === 'section' ? { label: 'Indent', icon: 'chevron-right', disabled: (one.level || 0) >= 3, onClick: () => commit([{ op: 'row', id: one.id, set: { level: (one.level || 0) + 1 } }]) } : null,
    one?.kind === 'section' ? { label: 'Outdent', icon: 'chevron-left', disabled: !(one.level > 0), onClick: () => commit([{ op: 'row', id: one.id, set: { level: one.level - 1 } }]) } : null,
    one?.kind === 'absence' ? { label: 'Kind…', icon: 'calendar', onClick: () => absenceKindDialog(one) } : null,
    one?.kind === 'activity' ? { label: 'Details and support…', icon: 'list', onClick: () => detailsDialog(one) } : null,
    'sep',
    rows.some((r) => r.archived)
      ? { label: 'Restore', icon: 'eye', onClick: () => archiveRows(rows, false) }
      : { label: 'Archive', icon: 'eye-off', onClick: () => archiveRows(rows, true) },
    { label: rows.length > 1 ? `Delete ${rows.length} rows` : 'Delete row', icon: 'trash', danger: true, onClick: () => deleteRows(rows) },
  ];
  contextMenu(x, y, items);
}

/**
 * Copy or cut from the menu. Through the browser's own command where it will
 * run one — so the system clipboard gets the HTML Excel pastes — and straight
 * into the editor's clipboard where it will not.
 */
function clipboardCommand(kind) {
  focusGrid();
  let done = false;
  try {
    done = document.execCommand(kind);
  } catch {
    done = false;
  }
  if (!done) copy(null, kind === 'cut');
}

function pasteInternal() {
  if (!E.clip) return;
  const sel = rect();
  writeBlock(E.clip.block, sel.r0, sel.c0);
}

function moreMenu(e) {
  const box = e.currentTarget.getBoundingClientRect();
  contextMenu(box.left, box.bottom + 4, [
    { label: E.showArchived ? 'Hide archived rows' : 'Show archived rows', icon: E.showArchived ? 'eye-off' : 'eye', onClick: () => { E.showArchived = !E.showArchived; draw(); } },
    { label: 'Fold every section', icon: 'chevron-up', onClick: () => { for (const r of E.model.rows) if (r.kind === 'section') E.collapsed.add(r.id); draw(); } },
    { label: 'Unfold every section', icon: 'chevron-down', onClick: () => { E.collapsed.clear(); draw(); } },
    { label: 'Sheet title…', icon: 'type', onClick: () => titleDialog() },
    { label: 'Keyboard and mouse…', icon: 'help', onClick: () => helpDialog() },
    'sep',
    { label: 'Take me back to an earlier moment…', icon: 'history', onClick: () => restoreDialog() },
    { label: 'Reload from the server', icon: 'refresh', onClick: async () => { await drain(); await reload(); } },
    { label: 'Go back to reading the workbook…', icon: 'unlink', danger: true, onClick: () => revertDialog() },
  ]);
}

/* ── Dialogs ───────────────────────────────────────────────────────────── */

function detailsDialog(row) {
  const inputs = {};
  const form = el('div', { class: 'lae-form' });
  for (const f of ed.FIELDS) {
    inputs[f.key] = textInput({ value: row[f.key] || '' });
    form.appendChild(el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: f.heading }), inputs[f.key]]));
  }
  const days = E.view.days;
  const totals = ed.supportTotals(E.model, days).byRow.get(row.id);
  const kids = E.model.rows.filter((r) => r.kind === 'resource' && r.parent_id === row.id);
  const lines = days.map((d) => {
    const cell = ed.getCell(E.model, row.id, d);
    const names = kids.map((k) => ed.getCell(E.model, k.id, d)?.text).filter(Boolean).join('; ');
    if (!cell && !names) return null;
    const meaning = cell?.color ? E.legendAll.find((e) => e.argb === cell.color)?.meaning || `#${cell.color}` : '';
    const codes = cell?.text && looksLikeCodes(cell.text)
      ? ed.supportTokens(cell.text).map((t) => codeName(t)).join(' + ') : (cell?.text || '');
    return el('tr', {}, [
      el('td', { text: fmt(d) + ' ' + ed.weekdayLetter(d) }),
      el('td', {}, [cell?.color ? el('span', { class: 'la-swatch', style: `background:#${cell.color}` }) : null, meaning].filter(Boolean)),
      el('td', { text: codes }),
      el('td', { text: names }),
    ]);
  }).filter(Boolean);
  const summary = el('div', { class: 'lae-summary' }, [
    el('div', { class: 'rc-eyebrow', text: `Support requested, ${fmt(days[0])} – ${fmt(days[days.length - 1])}` }),
    el('div', { class: 'lae-summary-total', text: totals ? ed.describeCounts(totals, E.codes).replace(/(\d+) (\w+)/g, (_, n, c) => `${n} × ${codeName(c)}`) : 'None asked for in these weeks.' }),
    lines.length
      ? el('div', { class: 'rc-scroll' }, [el('table', { class: 'rc-table', dataset: { plain: '1' } }, [
        el('thead', {}, [el('tr', {}, ['Day', 'Shift', 'Support', 'Names'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, lines),
      ])])
      : null,
  ].filter(Boolean));
  openModal({
    title: row.description || 'Activity',
    subtitle: 'Its columns on the sheet, and what it asks for',
    size: 'wide',
    body: el('div', {}, [form, summary]),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save', kind: 'primary', onClick: () => {
          const set = {};
          for (const f of ed.FIELDS) if ((row[f.key] || '') !== inputs[f.key].value) set[f.key] = inputs[f.key].value;
          if (Object.keys(set).length) commit([{ op: 'row', id: row.id, set }]);
        },
      },
    ],
  });
}

function absenceKindDialog(row) {
  const kind = selectInput({
    value: row.absence_kind || 'pto',
    options: [
      { value: 'pto', label: 'PTO — away' },
      { value: 'office', label: 'Office — at their desk' },
      { value: 'other', label: 'Other group / project' },
    ],
  });
  const label = textInput({ value: row.description || '' });
  openModal({
    title: 'What this row records',
    body: el('div', { class: 'lae-form' }, [
      el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Kind' }), kind]),
      el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Label on the sheet' }), label]),
    ]),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save', kind: 'primary', onClick: () => {
          const set = {};
          if (kind.value !== row.absence_kind) set.absence_kind = kind.value;
          const words = { pto: 'PTO', office: 'Office', other: 'Other Group / Project' };
          const text = label.value.trim() || words[kind.value];
          if (text !== row.description) set.description = text;
          if (Object.keys(set).length) commit([{ op: 'row', id: row.id, set }]);
        },
      },
    ],
  });
}

function titleDialog() {
  const input = textInput({ value: E.title });
  openModal({
    title: 'Sheet title',
    subtitle: 'Printed across the top of the exported workbook',
    body: input,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save', kind: 'primary', onClick: async () => {
          try {
            await rc.setSetting('lookahead_title', input.value.trim());
            E.title = input.value.trim();
            toast({ tone: 'good', message: 'Title saved.' });
          } catch (err) {
            toast({ tone: 'bad', message: err.message });
          }
        },
      },
    ],
  });
}

function helpDialog() {
  const rows = [
    ['Click, then Shift+click or drag', 'Select a range of days'],
    ['Type', 'Replace what is in the cell'],
    ['F2 or double-click', 'Edit what is in the cell'],
    ['Enter / Tab', 'Save and move down / right'],
    ['Delete', 'Clear the text (Shift+Delete: the colour too)'],
    ['Alt+1 … Alt+9', 'Paint with a legend colour (Alt+0 clears it)'],
    ['Code buttons', 'Add support to every selected day (Shift+click takes one away)'],
    ['Drag the square at the corner', 'Repeat the selection across or down'],
    ['Ctrl+D / Ctrl+R', 'Fill down / fill right'],
    ['Ctrl+C, Ctrl+X, Ctrl+V', 'Copy, cut and paste — to and from Excel, colours included'],
    ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
    ['Drag the grip on the left', 'Move a row — an activity takes its names, a section its rows'],
    ['Alt+↑ / Alt+↓', 'Move the selected row'],
    ['Right-click', 'Insert, duplicate, archive, delete, details'],
  ];
  openModal({
    title: 'Editing the look-ahead',
    size: 'wide',
    body: el('div', { class: 'rc-scroll' }, [el('table', { class: 'rc-table', dataset: { plain: '1' } }, [
      el('tbody', {}, rows.map(([k, v]) => el('tr', {}, [el('td', { class: 'rc-mono', text: k }), el('td', { text: v })]))),
    ])]),
    actions: [{ label: 'Close', kind: 'primary' }],
  });
}

async function revertDialog() {
  const ok = await confirmDialog({
    title: 'Go back to reading the workbook?',
    message: 'The calendar will read the .xlsx in the look-ahead folder again, the next time somebody presses Check now. '
      + 'Nothing written here is deleted — it stays for the record, and you can come back to it.',
    confirmLabel: 'Go back to the workbook',
    danger: true,
  });
  if (!ok) return;
  await drain();
  await rc.setSetting('lookahead_source', 'workbook');
  la.source = 'workbook';
  la.section = 'calendar';
  notifyChanged('lookahead');
}

/* ── Going back ─────────────────────────────────────────────────────────── */

/**
 * "Put it back the way it was at 9:00 on Monday."
 *
 * The edit log already holds every change with what was there before it, so
 * any moment it covers can be returned to: pick the save to go back to before,
 * see how much that undoes, and the editor writes the difference as ordinary
 * edits (`restoreOps()`). Nothing is erased — the log keeps the changes being
 * reversed and the reversal itself — and one Ctrl+Z takes the restore back.
 */
/**
 * Who changed this — one day of a row, or the row's own fields — read from
 * the edit log. The log is only ever appended to, so this is the whole story.
 */
async function historyDialog(row, day) {
  await drain();
  let edits;
  let people;
  try {
    [edits, people] = await Promise.all([
      rc.listLaEditsForRow(row.id),
      rc.listPeople({ includeInactive: true }).catch(() => []),
    ]);
  } catch (err) {
    toast({ tone: 'bad', message: err.message });
    return;
  }
  const who = new Map(people.filter((p) => p.user_id).map((p) => [p.user_id, p.name]));
  const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const meaning = (hex) => E.legendAll.find((e) => e.argb === hex)?.meaning || '';
  const name = ed.metaValues(row).filter(Boolean)[0] || (row.kind === 'resource' ? 'Names row' : 'Row');
  const list = el('ol', { class: 'lae-history', 'aria-label': 'Changes, newest first' });

  if (day) {
    for (const h of ed.cellHistory(edits, row.id, day)) {
      list.appendChild(el('li', { class: 'lae-history-item' }, [
        el('span', { class: 'lae-history-when', text: when(h.at) }),
        el('span', { class: 'lae-history-who', text: who.get(h.by) || 'Somebody' }),
        el('span', { class: 'lae-history-what' }, [
          el('span', { class: 'lae-history-from', text: ed.describeCellValue(h.before, meaning) }),
          el('span', { class: 'lae-history-arrow', html: icon('chevron-right', { size: 11 }), 'aria-label': 'became' }),
          el('span', { class: 'lae-history-to', text: ed.describeCellValue(h.after, meaning) }),
        ]),
      ]));
    }
  } else {
    for (const h of ed.rowHistory(edits, row.id)) {
      const what = h.action === 'insert' ? 'Added'
        : h.action === 'delete' ? 'Deleted'
          : h.changes.map((c) => `${c.field}: ${c.from === '' ? 'empty' : c.from} → ${c.to === '' ? 'empty' : c.to}`).join('; ');
      list.appendChild(el('li', { class: 'lae-history-item' }, [
        el('span', { class: 'lae-history-when', text: when(h.at) }),
        el('span', { class: 'lae-history-who', text: who.get(h.by) || 'Somebody' }),
        el('span', { class: 'lae-history-what', text: what }),
      ]));
    }
  }
  const body = list.childElementCount
    ? list
    : el('p', { class: 'rc-hint', text: day ? 'Nothing has been written on this day yet.' : 'This row has not been changed since it was added.' });
  openModal({
    title: day ? `History of ${fmtLong(day)}` : 'History of this row',
    subtitle: name,
    body: el('div', { class: 'lae-form' }, [body]),
    actions: [{ label: 'Close' }],
  });
}

async function restoreDialog() {
  await drain();
  let edits;
  let people;
  try {
    [edits, people] = await Promise.all([rc.listLaEdits({ limit: 3000 }), rc.listPeople({ includeInactive: true }).catch(() => [])]);
  } catch (err) {
    toast({ tone: 'bad', message: err.message });
    return;
  }
  const who = new Map(people.filter((p) => p.user_id).map((p) => [p.user_id, p.name]));
  const points = ed.restorePoints(edits).slice(0, 60);
  if (!points.length) {
    toast({ message: 'Nothing has been changed here yet, so there is nowhere to go back to.' });
    return;
  }
  const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  let chosen = points[0];
  const summary = el('div', { class: 'rc-hint' });
  const listEl = el('div', { class: 'lae-restore-list', role: 'listbox', 'aria-label': 'Saves' });
  const drawList = () => {
    clear(listEl);
    for (const p of points) {
      listEl.appendChild(el('button', {
        class: `lae-restore-point${p === chosen ? ' on' : ''}`, type: 'button', role: 'option',
        'aria-selected': String(p === chosen),
        onClick: () => { chosen = p; drawList(); },
      }, [
        el('span', { class: 'lae-restore-when', text: when(p.at) }),
        el('span', { text: who.get(p.by) || 'Somebody' }),
        el('span', { class: 'rc-hint', text: `${p.count} change${p.count === 1 ? '' : 's'} on ${p.rows} row${p.rows === 1 ? '' : 's'}` }),
      ]));
    }
    const since = points.filter((p) => p.firstId >= chosen.firstId);
    const n = since.reduce((t, p) => t + p.count, 0);
    summary.textContent = `Goes back to just before ${when(chosen.at)}: reverses ${n} change${n === 1 ? '' : 's'} in `
      + `${since.length} save${since.length === 1 ? '' : 's'}. Nothing is erased — the reversal is itself a change you can undo.`;
  };
  drawList();
  openModal({
    title: 'Take me back to an earlier moment',
    subtitle: 'Choose the save to go back to before',
    body: el('div', { class: 'lae-form lae-restore' }, [listEl, summary]),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Go back', kind: 'primary', onClick: async () => {
          try {
            const later = edits.filter((e) => Number(e.id) >= chosen.firstId);
            const days = later.filter((e) => e.day).map((e) => String(e.day).slice(0, 10)).sort();
            if (days.length) await ensureWindow([days[0], days[days.length - 1]]);
            const ops = ed.restoreOps(E.model, later);
            if (!ops.length) {
              toast({ message: 'The look-ahead is already as it was then.' });
              return;
            }
            commit(ops);
            toast({
              tone: 'good',
              message: `Back to how it was before ${when(chosen.at)} — ${ops.length} change${ops.length === 1 ? '' : 's'} made.`,
              action: { label: 'Undo', onClick: () => undo() },
              timeout: 8000,
            });
          } catch (err) {
            toast({ tone: 'bad', message: err.message, timeout: 10000 });
            rc.reportError('lookahead:restore', err);
          }
        },
      },
    ],
  });
}

/* ── Export ────────────────────────────────────────────────────────────── */

function openExport() {
  const thisMonday = ed.mondayOf(todayISO());
  const starts = [-7, 0, 7, 14].map((d) => ed.addDaysISO(thisMonday, d));
  const start = selectInput({
    value: thisMonday,
    options: starts.map((d, i) => ({ value: d, label: `${['Last week', 'This week', 'Next week', 'In two weeks'][i]} — from ${fmt(d)}` })),
  });
  let weeks = E.weeks;
  const size = segmented({
    value: weeks,
    options: ed.WINDOW_WEEKS.map((w) => ({ value: w, label: `${w} weeks` })),
    onChange: (w) => { weeks = w; update(); },
  });
  const summary = el('div', { class: 'rc-hint' });
  const update = () => {
    const days = ed.windowDays(start.value, weeks);
    const rows = ed.rowsWithWork(E.model, days);
    const n = rows.filter((r) => r.kind === 'activity').length;
    summary.textContent = `${n} activit${n === 1 ? 'y' : 'ies'} with work between ${fmt(days[0])} and ${fmt(days[days.length - 1])}, `
      + 'with their sections, names rows and the PTO / Office rows — in the 4WLA layout, ready to copy into the master file.';
  };
  start.addEventListener('change', update);
  update();

  const canFolder = filestore.hasFolder?.();
  const build = async () => {
    const days = ed.windowDays(start.value, weeks);
    await ensureWindow(days);
    const settings = await rc.listSettings().catch(() => []);
    const sheetName = settings.find((r) => r.key === 'lookahead_sheet')?.value || '4WLA';
    const bytes = lookaheadWorkbook({
      model: E.model, days, legend: E.legend, codes: E.codes.filter((c) => c.active !== false), title: E.title, sheetName,
    });
    return { bytes, name: lookaheadFileName(days, sheetName) };
  };
  openModal({
    title: 'Export to Excel',
    subtitle: 'The same columns, merged headings and colours as the 4WLA',
    body: el('div', { class: 'lae-form' }, [
      el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Starting' }), start]),
      el('div', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Weeks' }), size]),
      summary,
    ]),
    actions: [
      { label: 'Cancel' },
      canFolder ? {
        label: 'Save to the shared folder', onClick: async () => {
          try {
            const { bytes, name } = await build();
            await filestore.intakeWrite(`lookahead/${name}`, bytes);
            toast({ tone: 'good', title: 'Saved to the shared folder', message: `lookahead/${name}` });
          } catch (err) {
            toast({ tone: 'bad', message: err.message, timeout: 10000 });
          }
        },
      } : null,
      {
        label: 'Download', kind: 'primary', autofocus: true, onClick: async () => {
          try {
            const { bytes, name } = await build();
            saveFile(name, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Look-ahead');
          } catch (err) {
            toast({ tone: 'bad', message: err.message, timeout: 10000 });
            rc.reportError('lookahead:export', err);
          }
        },
      },
    ].filter(Boolean),
  });
}

/** Make sure the cells of a window outside the one on screen are loaded. */
async function ensureWindow(days) {
  const from = days[0];
  const to = days[days.length - 1];
  if (E.loaded && from >= E.loaded.from && to <= E.loaded.to) return;
  const cells = await rc.listLaCells(from, to);
  for (const c of cells.map(cleanCell)) {
    const key = ed.cellKey(c.row_id, c.day);
    if (!E.model.cells.has(key)) {
      E.model.cells.set(key, c);
      E.server.set(`cell:${key}`, c.version || 0);
    }
  }
  E.loaded = { from: [from, E.loaded?.from || from].sort()[0], to: [to, E.loaded?.to || to].sort().reverse()[0] };
}

/* ══════════════════════════════════════════════════════════════════════════
   Saving, publishing and noticing the other editor
   ═══════════════════════════════════════════════════════════════════════ */

function enqueue(ops) {
  E.queue.push(...ops);
  E.dirtySincePublish = true;
  clearTimeout(E.publishTimer);
  setTimeout(() => drain(), 0);
}

/**
 * Send what is queued, in order, stamped with the versions the server holds.
 *
 * Stamped here rather than when the edit was made, and simulated forward op by
 * op, so two quick edits to one cell expect 0 and then 1 — not 0 twice.
 */
async function drain() {
  if (E.saving) return E.saving;
  E.saving = (async () => {
    while (E.queue.length) {
      const batch = E.queue.slice(0, SAVE_BATCH);
      const shadow = new Map(E.server);
      const stamped = batch.map((op) => {
        const key = op.op === 'cell' ? `cell:${op.row_id}|${op.day}` : `row:${op.id}`;
        const expect = shadow.get(key) || 0;
        if (op.op === 'delete_row') shadow.delete(key);
        else if (op.op === 'cell' && !op.color && !op.text) shadow.delete(key);
        else shadow.set(key, expect + 1);
        return { ...op, expect };
      });
      E.status = 'saving';
      refreshStatus();
      try {
        const results = await rc.applyLookaheadOps(stamped);
        E.queue.splice(0, batch.length);
        for (const r of results || []) {
          if (r.kind === 'cell') {
            const key = `cell:${r.row_id}|${String(r.day).slice(0, 10)}`;
            if (r.version) E.server.set(key, r.version);
            else E.server.delete(key);
          } else if (r.deleted) E.server.delete(`row:${r.id}`);
          else E.server.set(`row:${r.id}`, r.version);
        }
        ed.acknowledge(E.model, (results || []).map((r) => ({ ...r, day: r.day ? String(r.day).slice(0, 10) : r.day })));
        E.retryIn = 0;
      } catch (err) {
        if (/conflict/i.test(err.message)) {
          await onConflict(err);
          break;
        }
        E.status = 'retry';
        E.retryIn = Math.min(30, (E.retryIn || 2) * 2);
        refreshStatus();
        rc.reportError('lookahead:save', err);
        const wait = E.retryIn;
        setTimeout(() => { E.saving = null; drain(); }, wait * 1000);
        return;
      }
    }
    if (!E.queue.length && E.status !== 'conflict') E.status = 'saved';
    refreshStatus();
    E.revision = await rc.lookaheadRevision().catch(() => E.revision);
    schedulePublish();
  })().finally(() => { E.saving = null; });
  return E.saving;
}

async function onConflict(err) {
  E.queue = [];
  E.undo = [];
  E.redo = [];
  await reload();
  E.status = 'conflict';
  refreshStatus();
  toast({
    tone: 'warn',
    title: 'Somebody else changed the same thing',
    message: 'The look-ahead was reloaded with their version, and your last change was not saved. Make it again if it still needs making.',
    timeout: 12000,
  });
  rc.reportError('lookahead:conflict', err);
}

async function reload() {
  cancelEdit();
  E.model = null;
  await load();
  draw();
}

function schedulePublish() {
  clearTimeout(E.publishTimer);
  if (!E.dirtySincePublish) return;
  E.publishTimer = setTimeout(() => { publish(); }, PUBLISH_QUIET_MS);
}

async function publish() {
  clearTimeout(E.publishTimer);
  if (!E.model || E.queue.length) return;
  E.dirtySincePublish = false;
  try {
    await publishFromEditor({ model: E.model, title: E.title, silent: true });
  } catch (err) {
    E.dirtySincePublish = true;
    rc.reportError('lookahead:publish', err);
  }
}

/** Look for the other editor's changes, quietly, while nobody is mid-edit. */
function startPolling() {
  if (E.pollTimer) return;
  const tick = async () => {
    if (!E.root?.isConnected || document.hidden || E.editing || E.queue.length || E.saving) return;
    try {
      const rev = await rc.lookaheadRevision();
      if (rev > E.revision) {
        await reload();
        toast({ message: 'The look-ahead was updated with changes made by the other editor.', timeout: 4000 });
      }
    } catch {
      /* the next tick will ask again */
    }
  };
  E.pollTimer = setInterval(tick, POLL_MS);
  window.addEventListener('focus', tick);
  window.addEventListener('beforeunload', (e) => {
    if (E.queue.length) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
