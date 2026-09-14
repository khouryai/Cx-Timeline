/**
 * The look-ahead calendar, drawn for print.
 *
 * A screenshot of the grid is what people were doing instead, and it is a poor
 * document: the frozen columns come out twice, the scroll clips the weeks
 * nobody happened to be looking at, and the colours are whatever the monitor
 * did to them. This draws the same calendar as vector geometry, at whatever
 * scale puts it on **one sheet**, because a four-week look-ahead reassembled
 * from four pages on a meeting-room table is not a four-week look-ahead.
 *
 * Two rules shape the whole module.
 *
 * **It draws the window it is given, not the one on screen.** Every choice the
 * dialog offers — how many weeks, whether the resource names come, whether the
 * rows with nothing scheduled come — is an argument here. The screen's own
 * switches are only the *defaults* the dialog opens with, so exporting cannot
 * quietly depend on what somebody last clicked.
 *
 * **Nothing is truncated to make it fit.** A description too long for its
 * column wraps and the row grows, the same answer the timeline gives. What
 * gives instead is the scale, and `fitScale()` says what that came to before
 * anything is written — a print at 40% is a decision somebody should make
 * knowingly, by choosing a bigger sheet or fewer weeks, not a surprise in a
 * downloads folder.
 *
 * No DOM and no network: it takes a parsed view and returns bytes, which is
 * what lets `tools/test_lookahead.js` check the geometry without a browser.
 *
 * Imports: io/pdf, io/lookahead, core/lookahead.
 */

import { fitToPdf, fitScale, pageBox, textWidth, PAGE_SIZES } from './pdf.js';
import { isDark } from './lookahead.js';
import { marksOf, ABSENCE_LABELS } from '../core/lookahead.js';

/* ── Metrics, in points at scale 1 ─────────────────────────────────────── */

const META_FONT = 7.2;
const DAY_FONT = 6.2;
const HEAD_FONT = 6.4;
const LINE_H = 8.6;
const ROW_PAD = 3.4;
const MIN_ROW_H = 12;
const MONTH_H = 11;
const NUM_H = 10;
const WEEKDAY_H = 11;
const LEGEND_H = 13;

/** The whole activity block, however many columns the sheet keeps it in. */
const META_W = 208;
const MIN_COL_W = 24;

const INK = {
  text: '#1a1a1a',
  subtle: '#6b6b6b',
  rule: '#d8d8d8',
  weekRule: '#9a9a9a',
  band: '#eeeeee',
  heading: '#e4e4e4',
  weekend: '#f5f5f5',
  today: '#e60012',
  onDark: '#ffffff',
};

/** Greedy word wrap. Returns the lines a string needs at this width. */
function wrap(text, width, size) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size) <= width || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
    /* A single word wider than the column — a part number, a path — is broken
       on characters rather than left to run over its neighbour. Nothing is
       dropped; the row grows instead. */
    while (textWidth(line, size) > width && line.length > 1) {
      let cut = line.length;
      while (cut > 1 && textWidth(line.slice(0, cut), size) > width) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * How wide each activity column gets.
 *
 * Proportional to what is actually in it, so the description — the column
 * anybody reads — is not given the same strip as a four-character CDRL code.
 * A floor per column, because a column squeezed to nothing still costs a
 * vertical rule and looks like a mistake.
 */
function metaWidths(rows, meta) {
  if (!meta.length) return [];
  const longest = meta.map((_, i) =>
    Math.max(12, ...rows.map((r) => textWidth(String(r.meta[i] || ''), META_FONT))));
  const total = longest.reduce((a, b) => a + b, 0) || 1;
  const spare = Math.max(0, META_W - MIN_COL_W * meta.length);
  return longest.map((w) => MIN_COL_W + (w / total) * spare);
}

/**
 * Which rows the export draws, and in what shape.
 *
 * Deliberately a separate pass from `readGrid()`: the same activity is one row
 * on screen and one or two here depending on whether the names were asked for,
 * and working that out while drawing is how the two get out of step.
 */
function linesOf(view, { showResources, showAway }) {
  const out = [];
  for (const a of view.activities) {
    if (a.absence && !showAway) continue;
    out.push({
      meta: a.meta,
      marks: a.marks,
      heading: Boolean(a.heading),
      muted: Boolean(a.absence),
      label: a.absence ? ABSENCE_LABELS[a.absence] : null,
    });
    if (a.resource && showResources) {
      out.push({ meta: a.resource.meta, marks: a.resource.marks, heading: false, muted: true });
    }
  }
  return out;
}

/**
 * The calendar as scene items: `{ width, height, items, meta }`.
 *
 * The same shape `io/scene.js` produces for the timeline, so it goes through
 * the same writer and gets the same true-vector output — selectable text and
 * no raster anywhere.
 */
export function calendarScene(view, {
  showResources = true,
  showAway = true,
  legend = [],
  showLegend = true,
  today = null,
  rowPad = 0,
  dayPad = 0,
} = {}) {
  const items = [];
  const days = view.days || [];
  const rows = linesOf(view, { showResources, showAway });
  const meta = view.meta || [];
  const headings = view.headings || [];
  const widths = metaWidths(rows, meta);
  const metaW = widths.reduce((a, b) => a + b, 0);

  /* A day column is as wide as the widest *word* anybody writes in one, not the
     widest cell. The marks are "X", "X.WIT", "X.TCE"; the Resource row's cells
     are "Priya, Dan", which is three times as wide and would either set the
     whole grid's column width or run over its neighbours. Sizing on the word
     and wrapping the rest is what lets a name sit in a day column at all. */
  const widestWord = Math.max(0, ...rows.flatMap((r) =>
    String(r.marks.map((m) => m.value || '').join(' '))
      .split(/[\s,;/&+]+/).filter(Boolean)
      .map((w) => textWidth(w, DAY_FONT))));
  const dayW = Math.max(12, Math.min(30, widestWord + 5)) + dayPad;

  const headH = MONTH_H + NUM_H + WEEKDAY_H;
  const width = metaW + days.length * dayW;

  const colX = new Map();
  days.forEach((d, i) => colX.set(d.col, metaW + i * dayW));

  /* ── Header ─────────────────────────────────────────────────────────── */

  // The month band, one label per run of days, which is what the merged cell in
  // the workbook meant.
  let runStart = 0;
  for (let i = 0; i <= days.length; i++) {
    if (i < days.length && days[i].month === days[runStart].month) continue;
    const x = metaW + runStart * dayW;
    const w = (i - runStart) * dayW;
    items.push({ type: 'rect', x, y: 0, w, h: MONTH_H, fill: INK.band });
    const label = days[runStart].month || '';
    if (label && textWidth(label, HEAD_FONT) < w - 4) {
      items.push({
        type: 'text', x: x + w / 2, y: MONTH_H - 3, text: label,
        size: HEAD_FONT, fill: INK.subtle, anchor: 'middle', weight: 700,
      });
    }
    runStart = i;
  }

  /* What the workbook calls its own columns. `readGrid()` already reads these
     to find the Location column, so printing "Activity" over all of them would
     be throwing away a heading the sheet supplies. */
  widths.forEach((w, i) => {
    const x = widths.slice(0, i).reduce((a, b) => a + b, 0);
    const label = String(headings[i] || (i === 0 ? 'Activity' : ''));
    if (!label) return;
    const lines = wrap(label, w - 4, HEAD_FONT - 0.4);
    lines.slice(0, 2).forEach((line, n) => {
      items.push({
        type: 'text', x: x + 2, y: MONTH_H + NUM_H - 2 + n * (HEAD_FONT + 0.8),
        text: line, size: HEAD_FONT - 0.4, fill: INK.subtle, weight: 700,
      });
    });
  });

  for (const d of days) {
    const x = colX.get(d.col);
    if (d.weekend) {
      items.push({ type: 'rect', x, y: MONTH_H, w: dayW, h: headH - MONTH_H, fill: INK.weekend });
    }
    const isToday = Boolean(d.date) && d.date === today;
    items.push({
      type: 'text', x: x + dayW / 2, y: MONTH_H + NUM_H - 2.5, text: String(d.day || ''),
      size: HEAD_FONT, fill: isToday ? INK.today : INK.text, anchor: 'middle', weight: 700,
    });
    items.push({
      type: 'text', x: x + dayW / 2, y: headH - 3, text: String(d.weekday || ''),
      size: HEAD_FONT - 0.6, fill: isToday ? INK.today : INK.subtle, anchor: 'middle',
    });
  }

  /* ── Rows ───────────────────────────────────────────────────────────── */

  const dayLineH = DAY_FONT + 1.6;
  const laid = rows.map((row) => {
    const cells = widths.map((w, i) => wrap(row.meta[i], w - 4, META_FONT));
    const inDay = new Map();
    for (const m of row.marks) {
      if (!m.value) continue;
      inDay.set(m.col, wrap(String(m.value), dayW - 2.5, DAY_FONT));
    }
    /* The row is as tall as its tallest cell, wherever that cell is. Measuring
       only the description is what let a Resource row's names run across three
       days of somebody else's work. */
    const metaLines = Math.max(1, ...cells.map((c) => c.length));
    const dayLines = Math.max(1, ...[...inDay.values()].map((l) => l.length), 1);
    return {
      ...row,
      cells,
      inDay,
      h: Math.max(MIN_ROW_H, metaLines * LINE_H + ROW_PAD, dayLines * dayLineH + ROW_PAD) + rowPad,
    };
  });

  let y = headH;
  const bodyTop = y;

  for (const row of laid) {
    // Weekend tint first, so a painted cell sits on top of it rather than
    // under it.
    for (const d of days) {
      if (d.weekend) {
        items.push({ type: 'rect', x: colX.get(d.col), y, w: dayW, h: row.h, fill: INK.weekend });
      }
    }
    if (row.heading) {
      items.push({ type: 'rect', x: 0, y, w: width, h: row.h, fill: INK.heading });
    }

    row.cells.forEach((lines, i) => {
      const x = widths.slice(0, i).reduce((a, b) => a + b, 0);
      lines.forEach((line, n) => {
        items.push({
          type: 'text', x: x + 2, y: y + ROW_PAD + (n + 1) * LINE_H - 2.4, text: line,
          size: META_FONT, fill: row.muted ? INK.subtle : INK.text,
          weight: row.heading ? 700 : 400,
        });
      });
    });

    for (const mark of row.marks) {
      const x = colX.get(mark.col);
      if (x == null) continue;                       // a day outside the window
      if (!mark.hex && !mark.value) continue;        // an empty cell draws nothing
      if (mark.hex) {
        items.push({ type: 'rect', x, y, w: dayW, h: row.h, fill: `#${mark.hex}` });
      }
      const lines = row.inDay.get(mark.col);
      if (lines?.length) {
        const fill = mark.hex && isDark(mark.hex) ? INK.onDark : INK.text;
        const block = lines.length * dayLineH;
        lines.forEach((line, n) => {
          items.push({
            type: 'text', x: x + dayW / 2,
            y: y + (row.h - block) / 2 + (n + 1) * dayLineH - 1.8,
            text: line, size: DAY_FONT, fill, anchor: 'middle',
          });
        });
      }
    }

    y += row.h;
    items.push({ type: 'line', x1: 0, y1: y, x2: width, y2: y, stroke: INK.rule, strokeWidth: 0.3 });
  }

  const bodyBottom = y;

  /* ── Rules ──────────────────────────────────────────────────────────── */

  // A hairline per day makes it a calendar rather than a block of colour; the
  // Monday rules are what let somebody count weeks across a hundred columns.
  for (const d of days) {
    const x = colX.get(d.col);
    const monday = String(d.weekday || '').toUpperCase() === 'M';
    items.push({
      type: 'line', x1: x, y1: MONTH_H, x2: x, y2: bodyBottom,
      stroke: monday ? INK.weekRule : INK.rule, strokeWidth: monday ? 0.5 : 0.25,
    });
  }
  items.push({
    type: 'line', x1: metaW, y1: 0, x2: metaW, y2: bodyBottom,
    stroke: INK.weekRule, strokeWidth: 0.7,
  });
  items.push({
    type: 'line', x1: 0, y1: bodyTop, x2: width, y2: bodyTop,
    stroke: INK.weekRule, strokeWidth: 0.7,
  });
  items.push({
    type: 'line', x1: width, y1: 0, x2: width, y2: bodyBottom,
    stroke: INK.rule, strokeWidth: 0.25,
  });

  // Today, where the window carries it. Drawn last so nothing paints over it.
  const todayCol = days.find((d) => d.date && d.date === today);
  if (todayCol) {
    const x = colX.get(todayCol.col) + dayW / 2;
    /* Through the body only. Run up into the header it strikes out the very
       date it is marking, so the column head says "today" by going red and the
       rule says where it falls. */
    items.push({
      type: 'line', x1: x, y1: bodyTop, x2: x, y2: bodyBottom,
      stroke: INK.today, strokeWidth: 0.9,
    });
  }

  /* ── The key ────────────────────────────────────────────────────────── */

  let height = bodyBottom;
  if (showLegend && legend.length) {
    const top = bodyBottom + 7;
    let x = 0;
    let line = 0;
    for (const entry of legend) {
      const label = String(entry.meaning || '');
      const w = 11 + textWidth(label, HEAD_FONT) + 12;
      if (x + w > width && x > 0) { x = 0; line++; }
      const ly = top + line * LEGEND_H;
      items.push({
        type: 'rect', x, y: ly, w: 7, h: 7, fill: `#${entry.argb}`,
        stroke: INK.rule, strokeWidth: 0.3,
      });
      items.push({
        type: 'text', x: x + 10, y: ly + 6, text: label,
        size: HEAD_FONT, fill: INK.text,
      });
      x += w;
    }
    height = top + (line + 1) * LEGEND_H;
  }

  return {
    width,
    height,
    items,
    meta: { palette: { bg: '#ffffff', text: INK.text, textSubtle: INK.subtle, brand: INK.today } },
    // What the caller needs to describe what it just made, without counting the
    // items itself.
    // `bodyH` is what the rows came to naturally, which is what lets the
    // filling pass cap its padding at "twice as tall" rather than at a
    // number that means nothing on a sheet of two-line descriptions.
    counts: { rows: rows.length, days: days.length, bodyH: bodyBottom - bodyTop },
  };
}

/**
 * The calendar laid out to *fill* the page it is going on.
 *
 * Fitting alone is not enough. A four-week window is much wider than it is
 * tall, so the scale is set by the width and the drawing stops less than half
 * way down the sheet — a page that is two-thirds white, which reads as
 * something that went wrong rather than as a document. What is left over is
 * spent on the axis that is not binding: taller rows when the width binds,
 * wider day columns when the height does.
 *
 * Two passes, because the answer depends on the layout and the layout depends
 * on the answer. The first measures; the second is built knowing what there is
 * to fill. It cannot overshoot: the padding is worked out from the scale the
 * first pass already proved fits, and the type never changes size — the rows
 * simply get more air, which is the difference between a cramped print and a
 * comfortable one.
 */
export function calendarLayout(view, opts = {}) {
  const first = calendarScene(view, opts);
  const scale = fitScale(first, opts);
  const box = pageBox(opts);
  const margin = opts.margin ?? 26;
  const contentW = box.w - margin * 2;
  const contentH = box.h - margin * 2 - ((opts.title || opts.subtitle) ? 34 : 12) - 18;

  const rows = Math.max(1, first.counts.rows);
  const days = Math.max(1, first.counts.days);

  /* How much scene there is room for at this scale, against how much there is.
     A row is given at most twice its natural height: past that the grid stops
     being a calendar and becomes a list with coloured gaps in it. */
  const spareH = Math.max(0, contentH / scale - first.height);
  const spareW = Math.max(0, contentW / scale - first.width);
  const rowPad = Math.min(spareH / rows, (first.counts.bodyH || MIN_ROW_H * rows) / rows);
  const dayPad = Math.min(spareW / days, 14);

  if (rowPad < 0.4 && dayPad < 0.4) return { scene: first, scale };

  const scene = calendarScene(view, { ...opts, rowPad, dayPad });
  // Re-measured rather than assumed: wrapping can change with a wider column.
  return { scene, scale: fitScale(scene, opts) };
}

/**
 * The calendar as a PDF, on one page. Returns a Blob.
 *
 * The caller hands it to `saveFile()`, which is what announces it — a download
 * is the one action with no visible result, and a second quiet path is exactly
 * the bug that rule exists to prevent.
 */
export function calendarPdf(view, opts = {}) {
  const { scene } = calendarLayout(view, opts);
  return fitToPdf(scene, {
    pageSize: opts.pageSize || 'a3',
    orientation: opts.orientation || 'landscape',
    margin: opts.margin,
    title: opts.title || 'Four-week look-ahead',
    subtitle: opts.subtitle || '',
    author: opts.author || 'CX Timeline',
    footer: opts.footer,
  });
}

/**
 * What the export would come out at, before anything is written.
 *
 * `{ scale, pt, width, height, rows, days }` — `pt` being the size the marks in
 * the cells actually print at, which is the number the dialog puts on screen.
 * "It fits on one page" is true of anything if you shrink it far enough; what
 * somebody needs to know is whether they will be able to read it.
 */
export function calendarFit(view, opts = {}) {
  const { scene, scale } = calendarLayout(view, opts);
  return {
    scale,
    pt: DAY_FONT * scale,
    width: scene.width,
    height: scene.height,
    rows: scene.counts.rows,
    days: scene.counts.days,
    page: pageBox(opts).label,
  };
}

/** The page sizes the dialog offers, landscape or portrait. */
export const PAGE_CHOICES = Object.entries(PAGE_SIZES)
  .map(([id, size]) => ({ id, label: size.label.replace(' landscape', '') }));
