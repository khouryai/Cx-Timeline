/**
 * The look-ahead as an .xlsx, laid out the way the 4WLA has always been.
 *
 * Whoever keeps the project's master look-ahead copies rows out of this file
 * and pastes them into theirs, so the layout is not a matter of taste: the six
 * activity columns B to G with their headings merged down B2:B6 … G2:G6, the
 * month band on row 4 merged across each month, day numbers on 5, weekday
 * letters on 6, Arial 10 with a thin border on every cell, section headings
 * bold on the grey band, weekends shaded darker, and each PTO / Office / Other
 * group written as a grey label band over its row of names — every one of
 * those measured off BART's own workbook. Painted days carry the legend colour
 * and their support codes ("X.WIT"), bold and centred.
 *
 * Only the window asked for, and only the rows with something in it
 * (`rowsWithWork()`): no hidden columns, no history, nothing the reader has to
 * scroll past.
 *
 * No DOM — `tools/test_la_edit.js` writes one and reads it back through
 * `parseSheet()`, the same reader that reads BART's file.
 *
 * Imports: core/la_edit, io/xlsx_write, io/lookahead.
 */

import {
  FIELDS, LAYOUT, SECTION_BAND, rowsWithWork, getCell, metaValues, colLetters,
  isWeekend, weekdayLetter, monthLabel, cancelledTokens,
} from '../core/la_edit.js';
import { zipStore, xmlEscape, styleBook, workbookParts } from './xlsx_write.js';
import { isDark } from './lookahead.js';
import { cellTokens } from '../core/lookahead.js';

const WEEKEND = '7F7F7F';
const DAY_WIDTH = 12.7109375;
const LINE = 12.75;

/**
 * How many lines some text wraps to in a column `width` characters wide.
 * Excel does not grow a row to fit wrapped text when it opens a file, so the
 * height is worked out here — otherwise three names in a day cell show as one.
 */
function lines(text, width) {
  const per = Math.max(1, Math.floor(width * 1.15));
  let count = 0;
  for (const para of String(text ?? '').split(/\r?\n/)) {
    let line = 0;
    count++;
    for (const word of para.split(/(?<=[ ,])/)) {
      if (line && line + word.length > per) { count++; line = 0; }
      line += word.length;
      while (line > per) { count++; line -= per; }
    }
  }
  return count;
}

/**
 * The workbook's bytes.
 *
 * @param {object} o
 * @param {object} o.model     the editor's model
 * @param {string[]} o.days    ISO dates, Monday first
 * @param {object[]} o.legend  `{ argb, meaning, role }` — the shift colours are keyed at the bottom
 * @param {object[]} o.codes   `{ code, name, party }` — the support codes, keyed too
 * @param {string} o.title
 * @param {string} o.sheetName
 */
export function lookaheadWorkbook({ model, days, legend = [], codes = [], title = '', sheetName = '4WLA', resources = true }) {
  const L = LAYOUT;
  const styles = styleBook();
  const all = 'lrtb';
  const S = {
    title: styles.id({ bold: true, size: 16, color: 'FF0000', v: 'center' }),
    headTop: styles.id({ border: 'lrt', h: 'center', v: 'center', wrap: true }),
    headMid: styles.id({ border: 'lr', h: 'center', v: 'center', wrap: true }),
    headBottom: styles.id({ border: 'lrb', h: 'center', v: 'center', wrap: true }),
    monthFirst: styles.id({ border: 'ltb', h: 'center', v: 'center' }),
    monthMid: styles.id({ border: 'tb', h: 'center', v: 'center' }),
    monthLast: styles.id({ border: 'rtb', h: 'center', v: 'center' }),
    monthOnly: styles.id({ border: all, h: 'center', v: 'center' }),
    dayNum: styles.id({ border: all, h: 'center', v: 'top' }),
    weekday: styles.id({ border: all, h: 'center', v: 'center', wrap: true }),
    metaCenter: styles.id({ border: all, h: 'center', v: 'center', wrap: true }),
    metaLeft: styles.id({ border: all, h: 'left', v: 'center', wrap: true }),
    metaShrink: styles.id({ border: all, h: 'center', v: 'center', shrink: true }),
    band: styles.id({ border: all, fill: SECTION_BAND, h: 'center', v: 'center', wrap: true }),
    bandTitle: styles.id({ border: all, fill: SECTION_BAND, bold: true, h: 'left', v: 'center', wrap: true }),
    day: styles.id({ border: all, h: 'left', v: 'top' }),
    names: styles.id({ border: all, h: 'left', v: 'top', wrap: true }),
    weekend: styles.id({ border: all, fill: WEEKEND, h: 'center', v: 'center', wrap: true }),
    keyHead: styles.id({ bold: true, h: 'left', v: 'center' }),
    keyText: styles.id({ h: 'left', v: 'center' }),
    code: styles.id({ border: all, bold: true, h: 'center', v: 'center' }),
  };
  const paint = (hex) => styles.id({
    border: all, fill: hex, bold: true, color: isDark(hex) ? 'FFFFFF' : '000000', h: 'center', v: 'center', wrap: true,
  });

  const lastCol = L.firstDayCol + days.length - 1;
  const rowsXml = [];
  const merges = [];
  const str = (col, row, text, s) => (text === '' || text == null
    ? `<c r="${colLetters(col)}${row}" s="${s}"/>`
    : `<c r="${colLetters(col)}${row}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`);
  /* A day with a struck-out resource ("X.~WIT") is written as rich text: the
     live codes in the cell's own font, each cancelled one — tilde kept, so the
     file reads back as cancelled — struck through in red, as the calendar
     draws it. Whoever pastes the row into the master sees what was taken off. */
  const struckRun = (text, dark) => `<r><rPr><b/><strike/><sz val="10"/><color rgb="${dark ? 'FFFFFFFF' : 'FFFF0000'}"/>`
    + `<rFont val="Arial"/><family val="2"/></rPr><t xml:space="preserve">${xmlEscape(text)}</t></r>`;
  const plainRun = (text) => `<r><t xml:space="preserve">${xmlEscape(text)}</t></r>`;
  const codesCell = (col, row, text, s, dark = false) => {
    const runs = [];
    let pending = '';
    cellTokens(text).forEach((t, i) => {
      if (i) pending += '.';
      if (t.cancelled) {
        if (pending) runs.push(plainRun(pending));
        pending = '';
        runs.push(struckRun(`~${t.code}`, dark));
      } else pending += t.code;
    });
    if (pending) runs.push(plainRun(pending));
    return `<c r="${colLetters(col)}${row}" s="${s}" t="inlineStr"><is>${runs.join('')}</is></c>`;
  };
  const num = (col, row, n, s) => `<c r="${colLetters(col)}${row}" s="${s}"><v>${n}</v></c>`;
  const blank = (col, row, s) => `<c r="${colLetters(col)}${row}" s="${s}"/>`;
  const addRow = (r, cells, { ht = null, hidden = false } = {}) => {
    rowsXml.push(`<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}${hidden ? ' hidden="1"' : ''}>${cells.join('')}</row>`);
  };

  /* ── The header: title, headings, month band, day numbers, weekday letters ── */
  addRow(L.titleRow, [str(L.firstMetaCol, L.titleRow, title, S.title)], { ht: 20.25 });

  const headStyle = (r) => (r === L.headingRow ? S.headTop : r === L.weekdayRow ? S.headBottom : S.headMid);
  for (let r = L.headingRow; r <= L.weekdayRow; r++) {
    const cells = FIELDS.map((f, i) => (r === L.headingRow
      ? str(L.firstMetaCol + i, r, f.heading, headStyle(r))
      : blank(L.firstMetaCol + i, r, headStyle(r))));
    if (r === L.monthRow) {
      days.forEach((d, i) => {
        const first = i === 0 || monthLabel(days[i - 1]) !== monthLabel(d);
        const last = i === days.length - 1 || monthLabel(days[i + 1]) !== monthLabel(d);
        const s = first && last ? S.monthOnly : first ? S.monthFirst : last ? S.monthLast : S.monthMid;
        cells.push(first ? str(L.firstDayCol + i, r, monthLabel(d), s) : blank(L.firstDayCol + i, r, s));
      });
    } else if (r === L.dayRow) {
      days.forEach((d, i) => cells.push(num(L.firstDayCol + i, r, Number(d.slice(8, 10)), S.dayNum)));
    } else if (r === L.weekdayRow) {
      days.forEach((d, i) => cells.push(str(L.firstDayCol + i, r, weekdayLetter(d), S.weekday)));
    }
    // The heading block's own two rows are hidden, as on BART's sheet: the
    // merged headings then show against the three visible header rows.
    const ht = { 2: 102, 3: 89.25, 4: 38.25, 6: 25.5 }[r] || null;
    addRow(r, cells, { ht, hidden: r === 2 || r === 3 });
  }
  FIELDS.forEach((_, i) => {
    const c = colLetters(L.firstMetaCol + i);
    merges.push(`${c}${L.headingRow}:${c}${L.weekdayRow}`);
  });
  let runStart = 0;
  days.forEach((d, i) => {
    const last = i === days.length - 1 || monthLabel(days[i + 1]) !== monthLabel(d);
    if (!last) return;
    if (i > runStart) merges.push(`${colLetters(L.firstDayCol + runStart)}${L.monthRow}:${colLetters(L.firstDayCol + i)}${L.monthRow}`);
    runStart = i + 1;
  });

  /* ── The body ── */
  let r = L.firstBodyRow;
  const metaStyle = [S.metaCenter, S.metaLeft, S.metaCenter, S.metaShrink, S.metaCenter, S.metaCenter];
  let anyStruck = false;
  const dayCell = (col, row, cell, { names = false } = {}, iso) => {
    if (!names && cell?.text && cancelledTokens(cell.text).length) {
      anyStruck = true;
      if (cell.color) return codesCell(col, row, cell.text, paint(cell.color), isDark(cell.color));
      return codesCell(col, row, cell.text, isWeekend(iso) ? S.weekend : S.day);
    }
    if (cell?.color) return str(col, row, cell.text || '', paint(cell.color));
    if (isWeekend(iso)) return str(col, row, cell?.text || '', S.weekend);
    return str(col, row, cell?.text || '', names ? S.names : S.day);
  };
  const height = (texts) => {
    let n = 1;
    for (const [text, width] of texts) n = Math.max(n, lines(text, width));
    return n > 1 ? +(n * LINE + 1.5).toFixed(2) : null;
  };

  /* Without resources the sheet is the work alone: no names rows under the
     activities, and none of the rows that are about people rather than work —
     PTO, Office, Other group / project. */
  for (const row of rowsWithWork(model, days)) {
    if (!resources && (row.kind === 'resource' || row.kind === 'absence')) continue;
    if (row.kind === 'section') {
      const cells = FIELDS.map((f, i) => str(L.firstMetaCol + i, r, i === 1 ? row.description : '', i === 1 ? S.bandTitle : S.band));
      days.forEach((d, i) => cells.push(blank(L.firstDayCol + i, r, isWeekend(d) ? S.weekend : S.band)));
      addRow(r, cells, { ht: height([[row.description, FIELDS[1].width]]) });
      r++;
      continue;
    }
    if (row.kind === 'absence') {
      /* BART's sheet writes each of these as two rows: a grey band carrying
         the label, and under it the names. */
      const label = metaValues(row)[1];
      const band = FIELDS.map((f, i) => str(L.firstMetaCol + i, r, i === 1 ? label : '', i === 1 ? S.bandTitle : S.band));
      days.forEach((d, i) => band.push(blank(L.firstDayCol + i, r, isWeekend(d) ? S.weekend : S.band)));
      addRow(r, band);
      r++;
    }
    const meta = metaValues(row);
    const cells = meta.map((value, i) => str(L.firstMetaCol + i, r, value, metaStyle[i]));
    const texts = meta.map((value, i) => [value, FIELDS[i].width]);
    const names = row.kind !== 'activity';
    days.forEach((d, i) => {
      const cell = getCell(model, row.id, d);
      cells.push(dayCell(L.firstDayCol + i, r, cell, { names }, d));
      if (cell?.text) texts.push([cell.text, DAY_WIDTH]);
    });
    addRow(r, cells, { ht: height(texts) });
    r++;
  }

  /* ── The key: what each colour and each code means ── */
  const shifts = (legend || []).filter((e) => (e.role || 'shift') === 'shift' && e.meaning);
  if (shifts.length || codes.length) {
    r++;
    if (shifts.length) {
      addRow(r, [str(L.firstMetaCol + 1, r, 'Legend', S.keyHead)]);
      r++;
      for (const e of shifts) {
        addRow(r, [
          blank(L.firstMetaCol, r, paint(String(e.argb).toUpperCase())),
          str(L.firstMetaCol + 1, r, e.meaning, S.keyText),
        ]);
        r++;
      }
    }
    const live = (codes || []).filter((c) => c.active !== false);
    if (live.length) {
      r++;
      addRow(r, [str(L.firstMetaCol + 1, r, 'Support requested', S.keyHead)]);
      r++;
      for (const c of live) {
        addRow(r, [
          str(L.firstMetaCol, r, String(c.code).toUpperCase(), S.code),
          str(L.firstMetaCol + 1, r, [c.name, c.party ? `(${c.party})` : ''].filter(Boolean).join(' '), S.keyText),
        ]);
        r++;
      }
      if (anyStruck) {
        addRow(r, [
          codesCell(L.firstMetaCol, r, '~WIT', S.code),
          str(L.firstMetaCol + 1, r, 'Struck through in red, with a ~: cancelled — asked for, then taken off', S.keyText),
        ]);
        r++;
      }
    }
  }

  const colsXml = [
    '<col min="1" max="1" width="7.85546875" hidden="1" customWidth="1"/>',
    ...FIELDS.map((f, i) => `<col min="${L.firstMetaCol + i}" max="${L.firstMetaCol + i}" width="${f.width}" customWidth="1"/>`),
    days.length ? `<col min="${L.firstDayCol}" max="${lastCol}" width="${DAY_WIDTH}" customWidth="1"/>` : '',
  ].join('');

  const lastRef = `${colLetters(Math.max(lastCol, L.firstMetaCol + FIELDS.length - 1))}${Math.max(r - 1, L.weekdayRow)}`;
  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + `<dimension ref="A1:${lastRef}"/>`
    + '<sheetViews><sheetView tabSelected="1" zoomScale="80" zoomScaleNormal="80" workbookViewId="0">'
    + `<pane xSplit="${L.firstDayCol - 1}" ySplit="${L.weekdayRow}" topLeftCell="${colLetters(L.firstDayCol)}${L.firstBodyRow}" activePane="bottomRight" state="frozen"/>`
    + '<selection pane="topRight"/><selection pane="bottomLeft"/>'
    + `<selection pane="bottomRight" activeCell="${colLetters(L.firstDayCol)}${L.firstBodyRow}" sqref="${colLetters(L.firstDayCol)}${L.firstBodyRow}"/>`
    + '</sheetView></sheetViews>'
    + `<sheetFormatPr defaultRowHeight="${LINE}"/>`
    + `<cols>${colsXml}</cols>`
    + `<sheetData>${rowsXml.join('')}</sheetData>`
    + (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '')
    + '<pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="17" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + '</worksheet>';

  return zipStore(workbookParts({
    sheetName,
    sheetXml,
    stylesXml: styles.xml(),
    printTitles: `$${L.titleRow}:$${L.weekdayRow}`,
    title,
  }));
}

/** "4WLA 2026-09-21 to 2026-10-18.xlsx" — the window is in the name, so two exports never look alike. */
export function lookaheadFileName(days, sheetName = '4WLA') {
  const safe = String(sheetName || '4WLA').replace(/[\\/:*?"<>|]+/g, ' ').trim() || '4WLA';
  return `${safe} ${days[0]} to ${days[days.length - 1]}.xlsx`;
}

/**
 * The cancellations as a calendar workbook: one row per activity, the days of
 * the period across, and each cancelled run one merged cell carrying what was
 * cancelled, who was responsible and why.
 *
 * `rows` is `[{ label, location, events: [{ start, end, kind, text }] }]` —
 * `kind` 'activity' for a day cancelled outright (filled red, as on the sheet)
 * or 'support' for a BART resource struck out of an activity that went ahead
 * (red writing, no fill, because the work itself went ahead). `text` is what
 * the cell says. Weekends are the sheet's grey, like the look-ahead export.
 *
 * @param {object} o
 * @param {string[]} o.days     ISO dates, both ends inclusive
 * @param {object[]} o.rows
 * @param {string} o.title
 * @param {string} o.subtitle
 * @param {string} o.red        the legend's cancellation colour, `RRGGBB`
 */
export function cancellationWorkbook({ days, rows, title = 'Cancellations', subtitle = '', red = 'FF0000' }) {
  const styles = styleBook();
  const all = 'lrtb';
  const S = {
    title: styles.id({ bold: true, size: 14, v: 'center' }),
    sub: styles.id({ v: 'center' }),
    head: styles.id({ border: all, bold: true, h: 'left', v: 'center', wrap: true }),
    month: styles.id({ border: all, bold: true, h: 'left', v: 'center' }),
    num: styles.id({ border: all, h: 'center', v: 'center' }),
    meta: styles.id({ border: all, h: 'left', v: 'top', wrap: true }),
    day: styles.id({ border: all }),
    weekend: styles.id({ border: all, fill: WEEKEND }),
    cancelled: styles.id({ border: all, fill: red, bold: true, color: isDark(red) ? 'FFFFFF' : '000000', h: 'center', v: 'center', wrap: true }),
    support: styles.id({ border: all, bold: true, color: 'FF0000', h: 'center', v: 'center', wrap: true }),
    keyText: styles.id({ h: 'left', v: 'center' }),
  };
  const META = [{ heading: 'Activity', width: 44 }, { heading: 'Location', width: 14 }];
  const first = META.length + 1;
  const str = (col, row, text, s) => (text === '' || text == null
    ? `<c r="${colLetters(col)}${row}" s="${s}"/>`
    : `<c r="${colLetters(col)}${row}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`);
  const num = (col, row, n, s) => `<c r="${colLetters(col)}${row}" s="${s}"><v>${n}</v></c>`;
  const rowsXml = [];
  const merges = [];
  const addRow = (r, cells, ht = null) => rowsXml.push(`<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells.join('')}</row>`);

  addRow(1, [str(1, 1, title, S.title)], 21);
  addRow(2, [str(1, 2, subtitle, S.sub)]);

  // The month band, day numbers and weekday letters, as the look-ahead has them.
  const monthCells = [str(1, 4, '', S.head), str(2, 4, '', S.head)];
  let runStart = 0;
  days.forEach((d, i) => {
    const head = i === 0 || monthLabel(days[i - 1]) !== monthLabel(d);
    monthCells.push(head ? str(first + i, 4, monthLabel(d), S.month) : str(first + i, 4, '', S.month));
    const last = i === days.length - 1 || monthLabel(days[i + 1]) !== monthLabel(d);
    if (last) {
      if (i > runStart) merges.push(`${colLetters(first + runStart)}4:${colLetters(first + i)}4`);
      runStart = i + 1;
    }
  });
  addRow(4, monthCells);
  addRow(5, [str(1, 5, META[0].heading, S.head), str(2, 5, META[1].heading, S.head),
    ...days.map((d, i) => num(first + i, 5, Number(d.slice(8, 10)), S.num))]);
  addRow(6, [str(1, 6, '', S.head), str(2, 6, '', S.head),
    ...days.map((d, i) => str(first + i, 6, weekdayLetter(d), S.num))]);
  merges.push('A5:A6', 'B5:B6');

  let r = 7;
  const index = new Map(days.map((d, i) => [d, i]));
  for (const row of rows) {
    const cells = [str(1, r, row.label, S.meta), str(2, r, row.location || '', S.meta)];
    let height = Math.max(lines(row.label, META[0].width), lines(row.location, META[1].width));
    const covered = new Map(); // day index → { event, startIndex, endIndex }
    for (const e of row.events) {
      const a = index.get(e.start < days[0] ? days[0] : e.start);
      const b = index.get(e.end > days[days.length - 1] ? days[days.length - 1] : e.end);
      if (a == null || b == null || b < a) continue;
      for (let i = a; i <= b; i++) covered.set(i, { e, a, b });
      if (b > a) merges.push(`${colLetters(first + a)}${r}:${colLetters(first + b)}${r}`);
      height = Math.max(height, lines(e.text, DAY_WIDTH * (b - a + 1)));
    }
    days.forEach((d, i) => {
      const hit = covered.get(i);
      if (hit) {
        const s = hit.e.kind === 'support' ? S.support : S.cancelled;
        cells.push(i === hit.a ? str(first + i, r, hit.e.text, s) : str(first + i, r, '', s));
      } else cells.push(str(first + i, r, '', isWeekend(d) ? S.weekend : S.day));
    });
    addRow(r, cells, height > 1 ? +(height * LINE + 1.5).toFixed(2) : null);
    r++;
  }

  r++;
  addRow(r, [str(first, r, '', S.cancelled), str(first + 1, r, 'Day cancelled — the activity did not go ahead', S.keyText)]);
  r++;
  addRow(r, [str(first, r, 'WIT', S.support), str(first + 1, r, 'BART resource cancelled — the activity went ahead without it', S.keyText)]);

  const lastCol = first + Math.max(days.length, 2) - 1;
  const colsXml = [
    ...META.map((m, i) => `<col min="${i + 1}" max="${i + 1}" width="${m.width}" customWidth="1"/>`),
    days.length ? `<col min="${first}" max="${first + days.length - 1}" width="${DAY_WIDTH}" customWidth="1"/>` : '',
  ].join('');
  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + `<dimension ref="A1:${colLetters(lastCol)}${r}"/>`
    + '<sheetViews><sheetView tabSelected="1" zoomScale="80" zoomScaleNormal="80" workbookViewId="0">'
    + `<pane xSplit="${first - 1}" ySplit="6" topLeftCell="${colLetters(first)}7" activePane="bottomRight" state="frozen"/>`
    + '</sheetView></sheetViews>'
    + `<sheetFormatPr defaultRowHeight="${LINE}"/>`
    + `<cols>${colsXml}</cols>`
    + `<sheetData>${rowsXml.join('')}</sheetData>`
    + (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '')
    + '<pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="17" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + '</worksheet>';

  return zipStore(workbookParts({ sheetName: 'Cancellations', sheetXml, stylesXml: styles.xml(), printTitles: '$4:$6', title }));
}
