/**
 * The 4WLA and the delay log, as one .zip.
 *
 * What goes out to the people the look-ahead is sent to, in one file: the 4WLA
 * workbook exactly as Export to Excel saves it (`lookaheadChoices()` and
 * `lookaheadBook()` are that dialog's own), and the delay log for the days
 * just gone — the cancellation log over that span, read by
 * `cancellationLog()` as the Cancellations tab reads it — twice: as a PDF (the
 * list as the tab draws it, then the same events as a calendar) and as an
 * Excel workbook (the list on one sheet, the calendar on the next).
 *
 * The span is the last ten days up to and including today unless somebody
 * says otherwise, and every file says which days it covers. A cancellation is
 * in it when it starts inside the span, and is listed whole — the log's own
 * rule, so the zip and the tab with the same dates agree.
 *
 * Imports: util, rc, filestore, core/la_edit, core/lookahead, io/la_xlsx,
 *          io/cancel_log, io/xlsx_write, io/exporters, icons, components,
 *          rc_util, rc_la_export.
 */

import { el } from '../core/util.js';
import * as rc from '../core/rc.js';
import * as filestore from '../core/filestore.js';
import * as ed from '../core/la_edit.js';
import { isCancelMeaning } from '../core/lookahead.js';
import { delayLogWorkbook, lookaheadFileName } from '../io/la_xlsx.js';
import { delayLogPdf, logLines, logStats, calendarCells, spanDays, dayText } from '../io/cancel_log.js';
import { zipDeflate } from '../io/xlsx_write.js';
import { saveFile } from '../io/exporters.js';
import { icon } from './icons.js';
import { toast, openModal } from './components.js';
import { todayISO, cancellationLog, authorNames } from './rc_util.js';
import { exportSource, lookaheadChoices, lookaheadBook } from './rc_la_export.js';

/** How many days the delay log covers unless somebody says otherwise. */
export const DELAY_DAYS = 10;
const MAX_DAYS = 92;
const EXPORT_DIR = 'exports';

/** The span: `count` days, up to and including `to`. */
export function delaySpan(to = todayISO(), count = DELAY_DAYS) {
  const n = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(count) || DELAY_DAYS)));
  return { from: ed.addDaysISO(to, -(n - 1)), to, days: n };
}

/** The cancellations that start inside the span, kept whole, none of those removed from the log. */
export async function delayEvents(from, to) {
  return (await cancellationLog(from)).filter((e) => e.start <= to && !e.dismissed);
}

/** The legend's own cancellation red, `RRGGBB` — what BART's days are filled with. */
function cancelRed(legendRows) {
  return String(legendRows.find((l) => isCancelMeaning(l.meaning || ''))?.argb || 'FF0000').toUpperCase();
}

/**
 * The delay log for a span, as a PDF and a workbook: `{ events, pdf, xlsx }`,
 * each file `{ name, bytes }`.
 */
export async function delayLogFiles({ from, to, today = todayISO() }) {
  const [events, legendRows, people] = await Promise.all([
    delayEvents(from, to),
    rc.listLegend().catch(() => []),
    rc.listPeople({ includeInactive: true }).catch(() => []),
  ]);
  const red = cancelRed(legendRows);
  const who = authorNames(people);
  const days = spanDays(from, to);
  const span = `${dayText(from)} to ${dayText(to)}`;
  const empty = `Nothing was cancelled from ${span}.`;
  const base = `Delay log ${from} to ${to}`;
  const xlsx = delayLogWorkbook({
    lines: logLines(events, { who }),
    stats: logStats(events),
    days,
    rows: calendarCells(events),
    title: 'Delay log',
    subtitle: `${span}  ·  ${events.length} cancellation${events.length === 1 ? '' : 's'}`,
    red,
    empty,
  });
  const pdf = delayLogPdf({
    events, days, red, today, who,
    title: 'Delay log',
    subtitle: span,
    note: `Every day the look-ahead shows cancelled from ${span}, and every BART resource struck out of work that `
      + 'went ahead — as the cancellation log has it now, without the ones removed from it. A cancellation '
      + `that runs on past ${dayText(to)} is listed whole; the calendar shows its days up to then.`,
  });
  return {
    events,
    pdf: { name: `${base}.pdf`, bytes: new Uint8Array(await pdf.arrayBuffer()) },
    xlsx: { name: `${base}.xlsx`, bytes: xlsx },
  };
}

/**
 * The zip: the 4WLA for `days` and the delay log for the span. Answers `{
 * name, bytes, files, events }` — `files` the names inside, in order.
 */
export async function buildDelayPack({ src = null, days, resources, from, to, today = todayISO() }) {
  const source = src || await exportSource();
  const book = await lookaheadBook(source, days, { resources });
  const log = await delayLogFiles({ from, to, today });
  const files = [
    { name: book.name, data: book.bytes },
    { name: log.pdf.name, data: log.pdf.bytes },
    { name: log.xlsx.name, data: log.xlsx.bytes },
  ];
  return {
    name: `4WLA and delay log ${today}.zip`,
    bytes: await zipDeflate(files),
    files: files.map((f) => f.name),
    events: log.events.length,
  };
}

/** The dialog: the 4WLA's weeks as Export to Excel offers them, and the delay log's days. */
export async function openDelayExport() {
  let src;
  try {
    src = await exportSource();
  } catch (err) {
    toast({ tone: 'bad', message: err.message, timeout: 10000 });
    rc.reportError('lookahead:delay-export', err);
    return;
  }
  const choices = await lookaheadChoices(src, { weeks: 4 });
  const sheetName = (await rc.listSettings().catch(() => [])).find((r) => r.key === 'lookahead_sheet')?.value || '4WLA';
  const today = todayISO();
  const count = el('input', {
    type: 'number', class: 'cx-input la-delay-days', min: '1', max: String(MAX_DAYS), value: String(DELAY_DAYS),
    'aria-label': 'How many days the delay log covers', style: 'width:90px',
  });
  const end = el('input', {
    type: 'date', class: 'cx-input la-delay-end', value: today,
    'aria-label': 'The last day the delay log covers', style: 'width:160px',
  });
  const said = el('p', { class: 'rc-hint la-delay-summary', role: 'status' });
  const inside = el('ul', { class: 'rc-hint la-delay-files', style: 'margin:4px 0 0;padding-left:18px' });
  const span = () => delaySpan(end.value || today, count.value);

  /* What the zip will hold, named as it will be — redrawn whenever a choice
     changes, the 4WLA's weeks (buttons, not a field) included. */
  const names = () => {
    const { from, to } = span();
    inside.replaceChildren(...[
      `${lookaheadFileName(choices.days(), sheetName)} — the look-ahead, as Export to Excel saves it`,
      `Delay log ${from} to ${to}.pdf — the list, then the same days as a calendar`,
      `Delay log ${from} to ${to}.xlsx — the list on one sheet, the calendar on the next`,
    ].map((t) => el('li', { text: t })));
  };
  let asked = 0;
  const update = async () => {
    names();
    const mine = ++asked;
    const { from, to } = span();
    said.textContent = `${dayText(from)} to ${dayText(to)} — counting…`;
    const events = await delayEvents(from, to).catch(() => null);
    if (mine !== asked) return;
    if (!events) {
      said.textContent = `${dayText(from)} to ${dayText(to)} — the cancellation log could not be read.`;
      return;
    }
    const open = events.filter((e) => !e.note).length;
    said.textContent = `${dayText(from)} to ${dayText(to)}: `
      + (events.length
        ? `${events.length} cancellation${events.length === 1 ? '' : 's'}`
          + `${open ? `, ${open} with no reason yet` : ''}.`
        : 'nothing was cancelled — the files say so.');
  };
  for (const input of [count, end]) input.addEventListener('change', update);
  for (const field of choices.fields) {
    field.addEventListener('change', names);
    field.addEventListener('click', names);
  }
  await update();

  const build = async () => {
    const { from, to } = span();
    return buildDelayPack({ src, days: choices.days(), resources: choices.resources(), from, to, today });
  };
  const canFolder = filestore.hasFolder?.();
  openModal({
    title: '4WLA and delay log',
    subtitle: 'One .zip: the look-ahead in Excel, and the delay log as a PDF and in Excel',
    body: el('div', { class: 'lae-form la-delay-form' }, [
      el('div', { class: 'cx-label', text: 'The 4WLA' }),
      ...choices.fields,
      el('div', { class: 'cx-label', style: 'margin-top:10px', text: 'The delay log' }),
      el('div', { class: 'cx-field', style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
        el('span', { text: 'The last' }), count, el('span', { text: 'days, up to and including' }), end,
      ]),
      said,
      el('div', { class: 'cx-label', style: 'margin-top:10px', text: 'In the .zip' }),
      inside,
    ]),
    actions: [
      { label: 'Cancel' },
      canFolder ? {
        label: 'Save to the shared folder', onClick: async () => {
          try {
            const pack = await build();
            await filestore.intakeWrite(`${EXPORT_DIR}/${pack.name}`, pack.bytes);
            toast({ tone: 'good', title: 'Saved to the shared folder', message: `${EXPORT_DIR}/${pack.name}` });
          } catch (err) {
            rc.reportError('lookahead:delay-export', err);
            toast({ tone: 'bad', message: err.message, timeout: 10000 });
          }
        },
      } : null,
      {
        label: 'Download', kind: 'primary', autofocus: true, onClick: async () => {
          try {
            const pack = await build();
            saveFile(pack.name, pack.bytes, 'application/zip', '4WLA and delay log');
          } catch (err) {
            rc.reportError('lookahead:delay-export', err);
            toast({ tone: 'bad', message: err.message, timeout: 10000 });
          }
        },
      },
    ].filter(Boolean),
  });
}

/** The button that opens it — beside Export to Excel, in the read view and in Edit. */
export function delayExportButton() {
  return el('button', {
    class: 'cx-btn mini la-export-delay',
    type: 'button',
    html: icon('download', { size: 12 }) + '<span>4WLA + delay log</span>',
    title: `One .zip: the 4WLA in Excel, and the delay log of the last ${DELAY_DAYS} days as a PDF (a list and a calendar) and in Excel`,
    onClick: () => openDelayExport(),
  });
}
