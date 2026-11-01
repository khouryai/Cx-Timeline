/**
 * The 4WLA as an .xlsx — Export to Excel in the editor and in the calendar's
 * read view, and `4WLA_Latest.xlsx` for the schedule.
 *
 * Built from the editor's own state when it is open, and otherwise from the
 * same rows and cells read afresh, so both places offer the identical
 * workbook. The schedule's dialog is shown in the export dialog, and the
 * schedule is handed the builder (`provide4wla()`) rather than importing it.
 *
 * Imports: util, rc, filestore, core/la_edit, io/la_xlsx, io/exporters,
 *          components, rc_util, rc_ingest, rc_la_state, rc_la_schedule,
 *          rc_la_editor_state.
 */

import { el } from '../core/util.js';
import * as rc from '../core/rc.js';
import * as filestore from '../core/filestore.js';
import * as ed from '../core/la_edit.js';
import { lookaheadWorkbook, lookaheadFileName, lookaheadLatestName } from '../io/la_xlsx.js';
import { saveFile } from '../io/exporters.js';
import { toast, openModal, selectInput, segmented, checkbox } from './components.js';
import { todayISO } from './rc_util.js';
import { EDITOR_SOURCE } from './rc_ingest.js';
import { la } from './rc_la_state.js';
import { provide4wla, scheduleSection } from './rc_la_schedule.js';
import { E, fmt, legendInForce, ensureWindow } from './rc_la_editor_state.js';

/**
 * What an export is built from. The editor's own state when it is open — it
 * holds exactly what was just typed — and otherwise the same rows and cells
 * read afresh, so the calendar's read view offers the identical workbook
 * without opening the editor, to anybody who can see the look-ahead.
 */
async function exportSource() {
  if (E.model) {
    return { model: E.model, legend: E.legend, codes: E.codes, title: E.title, weeks: E.weeks, ensure: ensureWindow };
  }
  const [settings, legend, codes, rows] = await Promise.all([
    rc.listSettings().catch(() => []),
    rc.listLegend().catch(() => []),
    rc.listSupportCodes({ includeRetired: true }).catch(() => []),
    rc.listLaRows(),
  ]);
  const src = {
    model: ed.makeModel(rows.map(ed.cleanRow), []),
    legend: legendInForce(legend).shifts,
    codes,
    title: settings.find((r) => r.key === 'lookahead_title')?.value || '',
    weeks: ed.WINDOW_WEEKS.includes(la.editorWeeks) ? la.editorWeeks : 4,
    loaded: null,
  };
  src.ensure = async (days) => {
    const from = days[0];
    const to = days[days.length - 1];
    if (src.loaded && from >= src.loaded.from && to <= src.loaded.to) return;
    const cells = await rc.listLaCells(from, to);
    src.model = ed.makeModel(rows.map(ed.cleanRow), cells.map(ed.cleanCell));
    src.loaded = { from, to };
  };
  return src;
}

/**
 * The 4WLA as an .xlsx, built without asking — names rows included — filed as
 * `4WLA_Latest.xlsx` by the schedule in Export to Excel: every week written here, from the
 * first day anything was (`laCellSpan()`) to the last, and never less than this
 * week and the next three. `from` and `to` are the export's own dates, and
 * narrow it; weeks nothing was ever written in are never drawn, however far
 * back the dates reach. It used to be this week and the next three only, so
 * the record of what the look-ahead said went out of the file as each week
 * passed. Null until the look-ahead is written here: before that the workbook
 * in the folder is the 4WLA, and the editor's tables would be an old copy of
 * it — and null when the dates asked for hold nothing written.
 */
export async function lookaheadFileNow({ from = null, to = null } = {}) {
  const settings = await rc.listSettings().catch(() => []);
  const said = (key) => settings.find((r) => r.key === key)?.value;
  if (said('lookahead_source') !== EDITOR_SOURCE) return null;
  const span = await rc.laCellSpan().catch(() => ({ first: null, last: null }));
  const thisMonday = ed.mondayOf(todayISO());
  const first = [span.first, thisMonday].filter(Boolean).sort()[0];
  const last = [span.last, ed.addDaysISO(thisMonday, 27)].filter(Boolean).sort().pop();
  const start = ed.mondayOf(from && from > first ? from : first);
  const end = to && to < last ? to : last;
  if (end < start) return null;
  const weeks = Math.floor((Date.parse(end) - Date.parse(start)) / (7 * 864e5)) + 1;
  const days = ed.windowDays(start, weeks);
  const src = await exportSource();
  await src.ensure(days);
  const sheetName = said('lookahead_sheet') || '4WLA';
  const bytes = lookaheadWorkbook({
    model: src.model, days, legend: src.legend, codes: src.codes.filter((c) => c.active !== false), title: src.title, sheetName,
    resources: true,
  });
  return { bytes, name: lookaheadLatestName(sheetName), from: days[0], to: days[days.length - 1] };
}

// 4WLA_Latest.xlsx on a schedule is built here; that module files it.
provide4wla({ xlsx: () => lookaheadFileNow() });

/** The 4WLA as an .xlsx — from the editor, or from the calendar's read view. */
export async function openExcelExport() {
  let src;
  try {
    src = await exportSource();
  } catch (err) {
    toast({ tone: 'bad', message: err.message, timeout: 10000 });
    rc.reportError('lookahead:export', err);
    return;
  }
  const thisMonday = ed.mondayOf(todayISO());
  const starts = [-7, 0, 7, 14].map((d) => ed.addDaysISO(thisMonday, d));
  const start = selectInput({
    value: thisMonday,
    options: starts.map((d, i) => ({ value: d, label: `${['Last week', 'This week', 'Next week', 'In two weeks'][i]} — from ${fmt(d)}` })),
  });
  let weeks = src.weeks;
  const size = segmented({
    value: weeks,
    options: ed.WINDOW_WEEKS.map((w) => ({ value: w, label: `${w} weeks` })),
    onChange: (w) => { weeks = w; update(); },
  });
  const summary = el('div', { class: 'rc-hint' });
  const update = async () => {
    const days = ed.windowDays(start.value, weeks);
    await src.ensure(days).catch(() => {});
    const rows = ed.rowsWithWork(src.model, days);
    const n = rows.filter((r) => r.kind === 'activity').length;
    summary.textContent = `${n} activit${n === 1 ? 'y' : 'ies'} with work between ${fmt(days[0])} and ${fmt(days[days.length - 1])}, `
      + (la.exportResources
        ? 'with their sections, names rows and the PTO / Office / Other group rows'
        : 'with their sections — no names rows, and no PTO / Office / Other group rows')
      + ' — in the 4WLA layout, ready to copy into the master file.';
  };
  const resourcesBox = checkbox({
    label: 'Show resources — names under each activity, and the PTO, Office and Other group / project rows',
    checked: la.exportResources,
    onChange: (on) => { la.exportResources = on; update(); },
  });
  resourcesBox.classList.add('lae-export-resources');
  start.addEventListener('change', update);
  await update();

  const canFolder = filestore.hasFolder?.();
  const build = async () => {
    const days = ed.windowDays(start.value, weeks);
    await src.ensure(days);
    const settings = await rc.listSettings().catch(() => []);
    const sheetName = settings.find((r) => r.key === 'lookahead_sheet')?.value || '4WLA';
    const bytes = lookaheadWorkbook({
      model: src.model, days, legend: src.legend, codes: src.codes.filter((c) => c.active !== false), title: src.title, sheetName,
      resources: la.exportResources,
    });
    return { bytes, name: lookaheadFileName(days, sheetName) };
  };
  openModal({
    title: 'Export to Excel',
    subtitle: 'The same columns, merged headings and colours as the 4WLA',
    body: el('div', { class: 'lae-form' }, [
      el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Starting' }), start]),
      el('div', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Weeks' }), size]),
      resourcesBox,
      summary,
      // The same 4WLA, filed as 4WLA_Latest on a schedule for sending on.
      scheduleSection(),
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
