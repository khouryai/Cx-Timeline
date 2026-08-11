/**
 * Export scene builder.
 *
 * Produces a backend-independent list of drawing primitives (rectangles,
 * lines, text, polygons, paths) describing the whole plan at a chosen
 * density. Both the SVG writer and the PDF writer consume this, which is why
 * an exported PDF and an exported SVG are pixel-for-pixel the same drawing
 * rather than two independent re-implementations of the timeline.
 *
 * Colours are resolved to concrete hex here — no CSS custom properties leave
 * this module, because neither an SVG file opened standalone nor a PDF has
 * any way to resolve them.
 *
 * Imports: util, dates, model, analysis.
 */

import { clamp, withAlpha, readableInk } from '../core/util.js';
import { MS_DAY, ticks, fmtDate, toISO, startOfDay, addDays } from '../core/dates.js';
import { TYPES, statusOf, objectColor, effectiveToday, projectExtent, LINK_TYPES, durationDays, baselineSnapshot, delayReason } from '../core/model.js';
import { criticalPath, linkViolations } from '../core/analysis.js';
import { fontString, textWidth, wrapText, fitWidth } from '../timeline/text.js';

/** Layout constants for exported drawings, in points/pixels. */
const M = {
  gutter: 168,
  rulerUpper: 22,
  rulerLower: 22,
  headerH: 62,
  lanePadY: 6,
  rowH: 20,
  rowGap: 4,
  barMinW: 3,
  pointR: 7,
  footerH: 26,
  labelPadX: 5,
  outsideGap: 5,
  outsideMaxW: 210,
  minInsideW: 44,
  ghostH: 7,
  ghostGap: 2,
  goneH: 12,
  shiftBadgeW: 30,
  reasonPadX: 4,
  reasonGap: 2,
  reasonLineH: 7.5,
  reasonMaxW: 190,
  reasonMinW: 70,
};

/* Fonts used by exported drawings, measured the same way the canvas is. */
const EXPORT_FONTS = {
  title: fontString({ size: 8.5, weight: 600 }),
  titleBold: fontString({ size: 8.5, weight: 700 }),
  sub: fontString({ size: 7, weight: 400 }),
  mono: fontString({ size: 6.8, weight: 400, mono: true }),
  lane: fontString({ size: 9.5, weight: 600 }),
  reason: fontString({ size: 6.5, weight: 600 }),
};

/** The dates an object covers, in the project's own display order. */
function dateLabel(obj) {
  const def = TYPES[obj.type] || TYPES.activity;
  if (!def.duration) return fmtDate(obj.start, 'numeric');
  const days = Math.max(1, Math.round((obj.end - obj.start) / MS_DAY));
  return `${fmtDate(obj.start, 'numeric')} → ${fmtDate(obj.end, 'numeric')}  (${days}d)`;
}
const EXPORT_LINE_H = 10;
const EXPORT_SUB_LINE_H = 8.5;

/**
 * Where an exported object's label goes, and the room it needs.
 *
 * Mirrors the on-screen rule exactly — inside when the text fits, beside the
 * bar when it does not, centred under a point glyph — so a printed plan reads
 * the same as the screen and, like the screen, never truncates a label.
 */
function exportLabel(obj, barWidth, showDates = false) {
  const def = TYPES[obj.type] || TYPES.activity;
  const title = String(obj.title || '');
  const subtitle = String(obj.subtitle || '').trim();
  const font = obj.style?.bold ? EXPORT_FONTS.titleBold : EXPORT_FONTS.title;

  // Printed plans get cross-referenced against a row in a spreadsheet, and a
  // bar on a month-scale ruler cannot be read to the day. The dates go on the
  // object itself — measured here, so the packer reserves the room and the
  // line never lands on top of the next row.
  const dates = showDates ? dateLabel(obj) : '';

  const build = (width, placement) => {
    const t = wrapText(title, width, font, { lineHeight: EXPORT_LINE_H });
    const sub = subtitle ? wrapText(subtitle, width, EXPORT_FONTS.sub, { lineHeight: EXPORT_SUB_LINE_H }) : null;
    const dateW = dates ? textWidth(dates, EXPORT_FONTS.mono) : 0;
    return {
      placement,
      lines: t.lines,
      subLines: sub ? sub.lines : [],
      dates,
      width: Math.ceil(Math.max(t.width, sub ? sub.width : 0, dateW)),
      height:
        t.lines.length * EXPORT_LINE_H +
        (sub ? sub.lines.length * EXPORT_SUB_LINE_H : 0) +
        (dates ? EXPORT_SUB_LINE_H : 0),
    };
  };

  if (!def.duration) {
    const fitted = fitWidth(title, font, { maxWidth: 150, maxLines: 3, minWidth: 34 });
    const label = build(fitted.width, def.shape === 'release' ? 'above' : 'below');
    label.extraLeft = label.width / 2 + 3;
    label.extraRight = label.width / 2 + 3;
    label.extraVert = label.height + 4;
    return label;
  }

  const inner = barWidth - M.labelPadX * 2;
  if (inner >= M.minInsideW) {
    const label = build(inner, 'inside');
    if (label.lines.length + label.subLines.length <= 3) {
      label.extraLeft = 0;
      label.extraRight = 0;
      label.extraVert = 0;
      return label;
    }
  }

  const fitted = fitWidth(title, font, { maxWidth: M.outsideMaxW, maxLines: 3, minWidth: 60 });
  const label = build(fitted.width, 'outside');
  label.extraLeft = 0;
  label.extraRight = label.width + M.outsideGap + 3;
  label.extraVert = 0;
  return label;
}

/**
 * Resolve the palette for an export. Themes live in CSS, so we read the
 * computed values off the document once and hand concrete colours downstream.
 */
export function resolvePalette(overrides = {}) {
  const read = (name, fallback) => {
    try {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return value || fallback;
    } catch {
      return fallback;
    }
  };

  const palette = {
    bg: read('--canvas-bg', '#ffffff'),
    surface: read('--surface', '#ffffff'),
    surface2: read('--surface-2', '#f7f8fa'),
    chrome: read('--chrome-bg', '#ffffff'),
    text: read('--text', '#111827'),
    textMuted: read('--text-muted', '#6b7280'),
    textSubtle: read('--text-subtle', '#9ca3af'),
    border: read('--border-strong', '#d8d8d8'),
    grid: read('--grid-line', '#eceef2'),
    gridMajor: read('--grid-line-major', '#d6dae1'),
    weekend: read('--grid-weekend', '#f4f5f7'),
    today: read('--today-line', '#e60012'),
    connector: read('--connector', '#8b93a3'),
    bad: read('--bad', '#c01017'),
    good: read('--good', '#0d7a4f'),
    warn: read('--warn', '#a8550a'),
    info: read('--info', '#1d4eaf'),
    brand: read('--hitachi-red', '#e60012'),
  };

  return { ...palette, ...overrides };
}

/** Resolve a colour that may be a `var(--x)` reference. */
function solid(color, palette, fallback = '#5b93f5') {
  if (!color) return fallback;
  const value = String(color);
  if (!value.startsWith('var(')) return value;
  const name = value.slice(4, -1).trim();
  try {
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return resolved || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Build the scene.
 *
 * @param {object} doc
 * @param {object} opts
 * @param {number} [opts.pxPerDay]   Density; defaults to fitting `maxWidth`.
 * @param {number} [opts.maxWidth]   Target drawing width in points.
 * @param {[number,number]} [opts.range] Explicit [startMs, endMs].
 * @param {boolean} [opts.showGrid]
 * @param {boolean} [opts.showLinks]
 * @param {boolean} [opts.showToday]
 * @param {boolean} [opts.showLegend]
 * @param {Function} [opts.filter]   Object predicate.
 * @param {object} [opts.palette]
 * @returns {{width:number, height:number, items:Array, meta:object}}
 */
export function buildScene(doc, opts = {}) {
  const palette = opts.palette || resolvePalette();
  const filter = opts.filter || null;

  const extent = opts.range ? { start: opts.range[0], end: opts.range[1] } : projectExtent(doc);
  const days = Math.max(1, (extent.end - extent.start) / MS_DAY);
  const maxWidth = opts.maxWidth || 2400;
  const pxPerDay = opts.pxPerDay || clamp((maxWidth - M.gutter - 24) / days, 0.2, 60);

  const items = [];
  const msToX = (ms) => M.gutter + ((ms - extent.start) / MS_DAY) * pxPerDay;

  /* ── Lane geometry ─────────────────────────────────────────────────── */
  const lanes = doc.laneOrder
    .map((id) => doc.lanes.find((l) => l.id === id))
    .filter((l) => l && !l.hidden);

  // Comparison rows are resolved before the lanes are packed: a ghost takes up
  // room in the drawing, so the packer has to know about it or the baseline
  // prints on top of the plan. Same rule the canvas follows.
  const comparison = comparisonRows(doc, opts);
  const goneByLane = new Map();
  if (comparison) {
    const liveIds = new Set(doc.objects.map((o) => o.id));
    const laneIds = new Set(lanes.map((l) => l.id));
    for (const snap of comparison.byId.values()) {
      if (liveIds.has(snap.id)) continue;
      const laneId = laneIds.has(snap.lane) ? snap.lane : lanes[0]?.id;
      if (!laneId) continue;
      if (!goneByLane.has(laneId)) goneByLane.set(laneId, []);
      goneByLane.get(laneId).push(snap);
    }
  }

  const laneGeom = [];
  let y = M.headerH + M.rulerUpper + M.rulerLower;
  const contentTop = y;

  for (const lane of lanes) {
    const objects = doc.objects
      .filter((o) => o.lane === lane.id && !o.hidden && (!filter || filter(o)))
      .sort((a, b) => a.start - b.start);

    const measured = objects.map((obj) => {
      const hasDuration = !!TYPES[obj.type]?.duration;
      const barWidth = hasDuration
        ? Math.max(M.barMinW, ((obj.end - obj.start) / MS_DAY) * pxPerDay)
        : M.pointR * 2;
      const label = exportLabel(obj, barWidth, opts.showDates === true);
      const ghost = comparison
        ? exportGhost(obj, comparison.byId.get(obj.id), barWidth, msToX, pxPerDay, comparison.baseline.id)
        : null;
      const height = hasDuration
        ? Math.max(M.rowH, label.height + 5)
        : Math.max(M.rowH, M.pointR * 2 + label.extraVert);
      return { obj, label, barWidth, ghost, height: height + exportGhostTier(ghost) };
    });

    // Outlines for what the baseline had and the plan has not. They pack with
    // the live objects, so a removed bar gets a row rather than the top of the
    // lane and whatever replaced it.
    const goneItems = (goneByLane.get(lane.id) || []).map((snap) => exportGone(snap, msToX));

    const packable = goneItems.length ? measured.concat(goneItems) : measured;
    const packed = packRowsForExport(packable, msToX);
    const rowHeights = new Array(packed.rows).fill(M.rowH);
    for (const item of packable) {
      const row = packed.assigned.get(item.obj.id) || 0;
      rowHeights[row] = Math.max(rowHeights[row], item.height);
    }
    const rowTops = [];
    let cursor = 0;
    for (let r = 0; r < packed.rows; r++) {
      rowTops.push(cursor);
      cursor += rowHeights[r] + M.rowGap;
    }

    const laneNameWrap = wrapText(lane.name || '', M.gutter - 24, EXPORT_FONTS.lane, { lineHeight: 11 });
    const height = Math.max(
      34,
      Math.max(M.rowH, cursor - M.rowGap) + M.lanePadY * 2,
      laneNameWrap.lines.length * 11 + 20
    );
    laneGeom.push({ lane, y, height, objects, measured, goneItems, rows: packed.assigned, rowTops, rowHeights, laneNameWrap });
    y += height;
  }

  const contentHeight = y - contentTop;
  const width = M.gutter + days * pxPerDay + 24;
  const legendHeight = opts.showLegend === false ? 0 : legendRows(doc, filter).length * 15 + 30;
  const height = y + M.footerH + legendHeight;

  /* ── Background ────────────────────────────────────────────────────── */
  items.push({ type: 'rect', x: 0, y: 0, w: width, h: height, fill: palette.bg });

  /* ── Header ────────────────────────────────────────────────────────── */
  items.push({ type: 'rect', x: 0, y: 0, w: width, h: M.headerH, fill: palette.chrome });
  items.push({ type: 'rect', x: 20, y: 15, w: 4, h: 30, fill: palette.brand, radius: 2 });
  items.push({ type: 'text', x: 32, y: 28, text: doc.name || 'Untitled Programme', size: 15, weight: 700, fill: palette.text });
  items.push({
    type: 'text',
    x: 32,
    y: 44,
    text: [doc.client, doc.programme].filter(Boolean).join('  ·  ') || 'CX Timeline',
    size: 8.5,
    fill: palette.textSubtle,
    family: 'mono',
  });
  items.push({
    type: 'text',
    x: width - 20,
    y: 28,
    text: `${fmtDate(extent.start, 'medium')}  →  ${fmtDate(extent.end, 'medium')}`,
    size: 9,
    fill: palette.textMuted,
    anchor: 'end',
    family: 'mono',
  });
  items.push({
    type: 'text',
    x: width - 20,
    y: 44,
    text: `${doc.objects.length} objects · ${lanes.length} lanes · exported ${fmtDate(Date.now(), 'medium')}`,
    size: 8,
    fill: palette.textSubtle,
    anchor: 'end',
    family: 'mono',
  });
  items.push({ type: 'line', x1: 0, y1: M.headerH, x2: width, y2: M.headerH, stroke: palette.border, strokeWidth: 1 });

  /* ── Ruler ─────────────────────────────────────────────────────────── */
  const scaleId = pickScale(pxPerDay);
  const upperId = coarser(scaleId);
  const rulerTop = M.headerH;

  items.push({ type: 'rect', x: 0, y: rulerTop, w: width, h: M.rulerUpper + M.rulerLower, fill: palette.chrome });

  for (const tick of ticks(upperId, extent.start, extent.end, { weekStart: doc.settings.weekStart })) {
    const x = msToX(tick.start);
    if (x < M.gutter - 2) continue;
    items.push({ type: 'line', x1: x, y1: rulerTop, x2: x, y2: rulerTop + M.rulerUpper, stroke: palette.border, strokeWidth: 0.8 });
    items.push({
      type: 'text',
      x: x + 4,
      y: rulerTop + 15,
      text: upperId === 'month' || upperId === 'quarter' ? `${tick.label} ${tick.sub}` : tick.label,
      size: 8.5,
      weight: 700,
      fill: palette.textMuted,
      family: 'mono',
    });
  }

  const lowerTicks = ticks(scaleId, extent.start, extent.end, { weekStart: doc.settings.weekStart });
  const tickWidth = lowerTicks.length > 1 ? msToX(lowerTicks[1].start) - msToX(lowerTicks[0].start) : 40;
  // Label every Nth tick, sized from the measured widest label, so exported
  // ruler labels are spaced out rather than shortened.
  const tickFont = fontString({ size: 7.5, weight: 500, mono: true });
  const widestTick = lowerTicks.reduce((max, t) => Math.max(max, textWidth(t.label, tickFont)), 0);
  const labelStride = Math.max(1, Math.ceil((widestTick + 10) / Math.max(tickWidth, 1)));

  lowerTicks.forEach((tick, i) => {
    const x = msToX(tick.start);
    if (x < M.gutter - 2) return;
    const lineTop = rulerTop + M.rulerUpper;

    if (tick.weekend && scaleId === 'day' && doc.settings.showWeekends) {
      items.push({ type: 'rect', x, y: lineTop, w: Math.max(1, tickWidth), h: M.rulerLower + contentHeight, fill: palette.weekend });
    }
    items.push({ type: 'line', x1: x, y1: lineTop, x2: x, y2: lineTop + M.rulerLower, stroke: palette.grid, strokeWidth: 0.6 });
    if (i % labelStride === 0) {
      items.push({ type: 'text', x: x + 3, y: lineTop + 15, text: tick.label, size: 7.5, fill: palette.textSubtle, family: 'mono' });
    }
    if (opts.showGrid !== false) {
      items.push({
        type: 'line',
        x1: x,
        y1: contentTop,
        x2: x,
        y2: contentTop + contentHeight,
        stroke: tick.major ? palette.gridMajor : palette.grid,
        strokeWidth: tick.major ? 0.7 : 0.4,
      });
    }
  });

  items.push({ type: 'line', x1: 0, y1: contentTop, x2: width, y2: contentTop, stroke: palette.border, strokeWidth: 1 });

  /* ── Lanes ─────────────────────────────────────────────────────────── */
  items.push({ type: 'rect', x: 0, y: contentTop, w: M.gutter, h: contentHeight, fill: palette.chrome });

  const rectsById = new Map();
  const goneRects = [];

  laneGeom.forEach((entry, index) => {
    const laneColor = solid(entry.lane.color, palette);

    if (index % 2) {
      items.push({ type: 'rect', x: M.gutter, y: entry.y, w: width - M.gutter, h: entry.height, fill: withAlpha(palette.textSubtle, 0.035) });
    }
    items.push({ type: 'line', x1: 0, y1: entry.y + entry.height, x2: width, y2: entry.y + entry.height, stroke: palette.grid, strokeWidth: 0.6 });
    items.push({ type: 'rect', x: 0, y: entry.y, w: 3, h: entry.height, fill: laneColor });
    entry.laneNameWrap.lines.forEach((line, i) => {
      items.push({ type: 'text', x: 12, y: entry.y + 15 + i * 11, text: line, size: 9.5, weight: 600, fill: palette.text });
    });
    items.push({
      type: 'text',
      x: 12,
      y: entry.y + 16 + entry.laneNameWrap.lines.length * 11,
      text: `${entry.objects.length} item${entry.objects.length === 1 ? '' : 's'}`,
      size: 7,
      fill: palette.textSubtle,
      family: 'mono',
    });

    for (const item of entry.measured) {
      const row = entry.rows.get(item.obj.id) || 0;
      const top = entry.y + M.lanePadY + (entry.rowTops[row] ?? 0);
      const rect = drawObject(items, item, entry.lane, {
        top,
        msToX,
        palette,
        // The export's own choice wins over the document's on-screen setting.
        settings: { ...doc.settings, showProgress: opts.showProgress !== false && doc.settings.showProgress },
      });
      if (rect) {
        rect.ghost = item.ghost;
        rectsById.set(item.obj.id, rect);
      }
    }

    for (const item of entry.goneItems) {
      const row = entry.rows.get(item.obj.id) || 0;
      goneRects.push({
        snap: item.gone,
        x: item.left,
        w: item.width,
        y: entry.y + M.lanePadY + (entry.rowTops[row] ?? 0),
      });
    }
  });

  /* ── Baseline comparison ───────────────────────────────────────────── */
  // Drawn after the objects so the ghosts and their arrows sit on top, and
  // only when the document is actually in comparison mode — an export is
  // supposed to be the drawing on the screen, not a different one.
  if (comparison) {
    drawBaseline(items, { rectsById, goneRects, palette });
  }

  items.push({ type: 'line', x1: M.gutter, y1: contentTop, x2: M.gutter, y2: contentTop + contentHeight, stroke: palette.border, strokeWidth: 1 });

  /* ── Dependencies ──────────────────────────────────────────────────── */
  if (opts.showLinks !== false && doc.settings.showConnectors) {
    const critical = doc.settings.criticalPath ? criticalPath(doc).critical : null;
    // An export is the drawing on screen, not a different one: a link stays
    // hidden here exactly as it does on the canvas — unhidden the moment it is
    // violated, never by the mere fact of being exported.
    const violations = linkViolations(doc);
    for (const link of doc.links) {
      if (link.hidden && !violations.byLink.get(link.id)?.violated) continue;
      const from = rectsById.get(link.from);
      const to = rectsById.get(link.to);
      if (!from || !to) continue;
      const spec = LINK_TYPES[link.type] || LINK_TYPES.FS;
      const a = { x: spec.from === 'end' ? from.right : from.x, y: from.cy };
      const b = { x: spec.to === 'start' ? to.x : to.right, y: to.cy };
      const isCritical = critical && critical.has(link.from) && critical.has(link.to);
      const stroke = isCritical ? palette.bad : solid(link.color, palette, palette.connector);

      const mid = (a.x + b.x) / 2;
      const d =
        b.x > a.x + 12
          ? `M ${a.x} ${a.y} L ${a.x + 8} ${a.y} L ${mid} ${a.y} L ${mid} ${b.y} L ${b.x - 8} ${b.y} L ${b.x} ${b.y}`
          : `M ${a.x} ${a.y} L ${a.x + 8} ${a.y} L ${a.x + 8} ${from.bottom + 6} L ${b.x - 10} ${from.bottom + 6} L ${b.x - 10} ${b.y} L ${b.x} ${b.y}`;

      items.push({ type: 'path', d, stroke, strokeWidth: isCritical ? 1.4 : 0.9, fill: 'none' });
      items.push({
        type: 'polygon',
        points: [[b.x, b.y], [b.x - 5, b.y - 3], [b.x - 5, b.y + 3]],
        fill: stroke,
      });
    }
  }

  /* ── Today ─────────────────────────────────────────────────────────── */
  if (opts.showToday !== false && doc.settings.showToday) {
    const todayMs = effectiveToday(doc);
    const x = msToX(todayMs);
    if (x >= M.gutter && x <= width) {
      items.push({ type: 'line', x1: x, y1: contentTop - M.rulerLower, x2: x, y2: contentTop + contentHeight, stroke: palette.today, strokeWidth: 1.6 });
      items.push({ type: 'rect', x: x - 24, y: contentTop - 15, w: 48, h: 13, fill: palette.today, radius: 2 });
      items.push({ type: 'text', x, y: contentTop - 5.5, text: 'TODAY', size: 7, weight: 700, fill: '#ffffff', anchor: 'middle', family: 'mono' });
    }
  }

  /* ── Legend ────────────────────────────────────────────────────────── */
  if (opts.showLegend !== false) {
    const rows = legendRows(doc, filter);
    let ly = y + 18;
    items.push({ type: 'line', x1: 0, y1: y + 4, x2: width, y2: y + 4, stroke: palette.border, strokeWidth: 0.8 });
    items.push({ type: 'text', x: 20, y: ly, text: 'LEGEND', size: 8, weight: 700, fill: palette.textSubtle, family: 'mono' });
    ly += 14;
    for (const row of rows) {
      items.push({ type: 'rect', x: 20, y: ly - 7, w: 9, h: 9, fill: solid(row.color, palette), radius: 2 });
      items.push({ type: 'text', x: 34, y: ly, text: `${row.label}  (${row.count})`, size: 8, fill: palette.textMuted });
      ly += 15;
    }
  }

  /* ── Footer ────────────────────────────────────────────────────────── */
  items.push({
    type: 'text',
    x: 20,
    y: height - 10,
    text: `CX Timeline · ${doc.name} · ${toISO(Date.now())}`,
    size: 7,
    fill: palette.textSubtle,
    family: 'mono',
  });

  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
    items,
    meta: { extent, pxPerDay, gutter: M.gutter, contentTop, contentHeight, palette, scaleId },
  };
}

/* ── Object drawing ────────────────────────────────────────────────────── */

/**
 * Draw one object plus its label.
 *
 * The label was measured and placed by `exportLabel`; this only prints the
 * lines it was given, so nothing is shortened on the way to paper.
 */
function drawObject(items, measured, lane, { top, msToX, palette, settings }) {
  const { obj, label, barWidth } = measured;
  const def = TYPES[obj.type] || TYPES.activity;
  const color = solid(objectColor(obj, lane), palette);
  const style = obj.style || {};
  const opacity = style.opacity ?? 1;

  /** Print a wrapped block from a given baseline. */
  const printBlock = (x, baseline, ink, anchor) => {
    let y = baseline;
    for (const line of label.lines) {
      items.push({
        type: 'text',
        x,
        y,
        text: line,
        size: 8.5,
        weight: style.bold ? 700 : 600,
        fill: ink,
        anchor,
        opacity,
      });
      y += EXPORT_LINE_H;
    }
    for (const line of label.subLines) {
      items.push({ type: 'text', x, y, text: line, size: 7, fill: ink, anchor, opacity: opacity * 0.8 });
      y += EXPORT_SUB_LINE_H;
    }
    if (label.dates) {
      items.push({
        type: 'text',
        x,
        y,
        text: label.dates,
        size: 6.8,
        family: 'mono',
        fill: ink,
        anchor,
        // Only slightly quieter than the title: this line exists to be read
        // off a printed page, often photocopied.
        opacity: opacity * 0.88,
      });
      y += EXPORT_SUB_LINE_H;
    }
  };

  if (def.duration) {
    const x = msToX(obj.start);
    const isBand = def.shape === 'band' || def.shape === 'container';
    const h = label.placement === 'inside' ? Math.max(M.rowH, label.height + 5) : M.rowH;
    const w = Math.max(M.barMinW, barWidth);
    const radius = Math.min(style.radius ?? 4, h / 2);

    items.push({
      type: 'rect',
      x,
      y: top,
      w,
      h,
      fill: isBand ? withAlpha(color, 0.18) : color,
      stroke: isBand ? color : withAlpha(color, 0.7),
      strokeWidth: style.strokeWidth ?? 0.8,
      radius,
      opacity,
      dash: isBand ? [4, 3] : null,
    });

    if (settings.showProgress && def.progress && obj.progress > 0) {
      const pw = (w * clamp(obj.progress, 0, 100)) / 100;
      items.push({ type: 'rect', x, y: top, w: pw, h, fill: withAlpha('#ffffff', 0.3), radius, opacity });
    }

    if (label.placement === 'inside') {
      const ink = style.textColor || (isBand ? color : readableInk(color));
      const blockH = label.lines.length * EXPORT_LINE_H + label.subLines.length * EXPORT_SUB_LINE_H;
      printBlock(x + M.labelPadX, top + (h - blockH) / 2 + 7, ink, 'start');
    } else {
      // Too narrow to hold the text: the full label sits beside the bar, in
      // space the packer already reserved for it.
      const blockH = label.lines.length * EXPORT_LINE_H + label.subLines.length * EXPORT_SUB_LINE_H;
      printBlock(x + w + M.outsideGap, top + (h - blockH) / 2 + 7, palette.text, 'start');
    }

    return { x, right: x + w, cy: top + h / 2, bottom: top + h, top };
  }

  /* Point objects: milestone diamond, release flag, risk/issue pin. */
  const cx = msToX(obj.start);
  const glyphTop = label.placement === 'above' ? top + label.extraVert : top;
  const cy = glyphTop + M.pointR;
  const r = M.pointR;

  if (def.shape === 'release') {
    const statusColor = solid(style.fill || statusOf(obj.status).color, palette);
    items.push({ type: 'rect', x: cx - 1, y: glyphTop, w: 2, h: r * 2, fill: statusColor });
    const chip = obj.data?.version ? `v${obj.data.version}` : '';
    if (chip) {
      const chipW = textWidth(chip, EXPORT_FONTS.title) + 10;
      items.push({ type: 'rect', x: cx - chipW / 2, y: cy - 7, w: chipW, h: 14, fill: withAlpha(statusColor, 0.2), stroke: statusColor, strokeWidth: 0.8, radius: 3 });
      items.push({ type: 'text', x: cx, y: cy + 3.2, text: chip, size: 7.5, weight: 700, fill: statusColor, anchor: 'middle', family: 'mono' });
    }
    printBlock(cx, top + 8, palette.text, 'middle');
  } else if (def.shape === 'diamond') {
    items.push({
      type: 'polygon',
      points: [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]],
      fill: color,
      stroke: withAlpha(color, 0.9),
      strokeWidth: 0.8,
    });
    printBlock(cx, cy + r + 8, palette.text, 'middle');
  } else {
    const severity = obj.data?.severity;
    const pinColor = severity === 'critical' || severity === 'high' ? palette.bad : color;
    items.push({ type: 'circle', cx, cy, r: r - 1, fill: pinColor, stroke: withAlpha(pinColor, 0.9), strokeWidth: 0.8 });
    printBlock(cx, cy + r + 8, palette.text, 'middle');
  }

  return { x: cx - r, right: cx + r, cy, bottom: glyphTop + r * 2, top: glyphTop };
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

/**
 * First-fit row packing over the *label* extent — and, in comparison mode, over
 * the baseline ghost and its day badge as well — not just the bar, so nothing
 * exported can be overprinted by the next object along.
 */
function packRowsForExport(measured, msToX) {
  const rowEnds = [];
  const assigned = new Map();

  for (const item of measured.slice().sort((a, b) => a.obj.start - b.obj.start)) {
    const hasDuration = !!TYPES[item.obj.type]?.duration;
    const startX = msToX(item.obj.start);
    let from = (hasDuration ? startX : startX - M.pointR) - item.label.extraLeft;
    let to = (hasDuration ? startX + item.barWidth : startX + M.pointR) + item.label.extraRight;

    if (item.ghost) {
      from = Math.min(from, item.ghost.from);
      to = Math.max(to, item.ghost.to);
    }

    let row = 0;
    while (row < rowEnds.length && (rowEnds[row] ?? -Infinity) > from) row++;
    rowEnds[row] = to + 5;
    assigned.set(item.obj.id, row);
  }

  return { assigned, rows: Math.max(1, rowEnds.length) };
}

function pickScale(pxPerDay) {
  if (pxPerDay >= 22) return 'day';
  if (pxPerDay >= 4.5) return 'week';
  if (pxPerDay >= 1.3) return 'month';
  if (pxPerDay >= 0.5) return 'quarter';
  return 'year';
}

function coarser(id) {
  const order = ['day', 'week', 'month', 'quarter', 'year'];
  const i = order.indexOf(id);
  return order[Math.min(order.length - 1, i + 1)];
}

/**
 * The comparison rows for an export, keyed by object id, or null when the
 * export is not comparing.
 */
function comparisonRows(doc, opts) {
  if (!opts.showBaseline || !(doc.baselines || []).length) return null;
  const id = opts.baselineId || doc.settings.activeBaseline;
  const baseline = (doc.baselines || []).find((b) => b.id === id)
    || (doc.baselines || [])[doc.baselines.length - 1];
  if (!baseline) return null;
  const rows = baselineSnapshot(doc, baseline);
  // The baseline itself comes along: a ghost carries the reason written
  // against that baseline, and the reason is text in the drawing.
  return rows.length ? { baseline, byId: new Map(rows.map((row) => [row.id, row])) } : null;
}

/**
 * An object's ghost in an exported drawing, measured the way the canvas
 * measures it: behind the bar while the two cover different dates, in a tier of
 * its own below the bar the moment they do not. Printed at whatever density the
 * export was asked for, so — as on screen — the split follows the scale.
 */
function exportGhost(obj, snap, barWidth, msToX, pxPerDay, baselineId) {
  if (!snap) return null;
  const def = TYPES[obj.type] || TYPES.activity;
  const hasDuration = !!def.duration;

  const snapEnd = hasDuration ? (snap.end ?? snap.start) : snap.start;
  const startShift = Math.round((obj.start - snap.start) / MS_DAY);
  const endShift = hasDuration ? Math.round((obj.end - snapEnd) / MS_DAY) : startShift;
  if (!startShift && !endShift) return null;

  const x = hasDuration ? msToX(snap.start) : msToX(snap.start) - M.pointR;
  const w = hasDuration ? Math.max(3, ((snapEnd - snap.start) / MS_DAY) * pxPerDay) : M.pointR * 2;
  const barLeft = hasDuration ? msToX(obj.start) : msToX(obj.start) - M.pointR;
  const barRight = barLeft + (hasDuration ? barWidth : M.pointR * 2);

  const reshaped = endShift === 0;
  const fromX = reshaped ? x : x + w;
  const toX = reshaped ? barLeft : barRight;
  const mid = (fromX + toX) / 2;
  const canStack = hasDuration && def.shape !== 'band' && def.shape !== 'container';
  const stacked = canStack && x < barRight + M.ghostGap && x + w > barLeft - M.ghostGap;

  const reason = exportReason(delayReason(obj, baselineId), w, stacked);
  const reasonRight = reason && reason.placement === 'below' ? x + reason.width + M.reasonPadX * 2 : -Infinity;

  return {
    snap,
    startShift,
    endShift,
    x,
    w,
    stacked,
    reason,
    from: Math.min(x, mid - M.shiftBadgeW / 2),
    to: Math.max(x + w, mid + M.shiftBadgeW / 2, reasonRight),
  };
}

/**
 * The reason for a move, measured for print exactly as the canvas measures it
 * for the screen: inside the striped area when the sentence fits on one line
 * there, otherwise wrapped into a note under the row. Measured rather than
 * guessed, so the packer reserves the room and the sentence is never shortened
 * on the way to paper.
 */
function exportReason(text, ghostWidth, stacked) {
  const value = String(text || '').trim();
  if (!value) return null;

  const oneLine = textWidth(value, EXPORT_FONTS.reason);
  if (!stacked && oneLine + M.reasonPadX * 2 + 1 <= ghostWidth) {
    return { text: value, placement: 'inside', lines: [value], width: oneLine, height: M.reasonLineH };
  }

  const fitted = fitWidth(value, EXPORT_FONTS.reason, { maxWidth: M.reasonMaxW, maxLines: 3, minWidth: M.reasonMinW });
  const wrapped = wrapText(value, fitted.width, EXPORT_FONTS.reason, { lineHeight: M.reasonLineH });
  return {
    text: value,
    placement: 'below',
    lines: wrapped.lines,
    width: Math.ceil(wrapped.width),
    height: wrapped.lines.length * M.reasonLineH,
  };
}

/** The band an exported comparison reserves below its row. Mirrors `ghostTier`. */
function exportGhostTier(ghost) {
  if (!ghost) return 0;
  const stack = ghost.stacked ? M.ghostH + M.ghostGap : 0;
  const note = ghost.reason && ghost.reason.placement === 'below' ? ghost.reason.height + M.reasonGap : 0;
  return stack + note;
}

/** A phantom entry so a removed object packs like everything else. */
function exportGone(snap, msToX) {
  const x = msToX(snap.start);
  const w = Math.max(8, msToX(snap.end ?? snap.start) - x);
  const textW = textWidth(String(snap.title || ''), EXPORT_FONTS.mono) + 8;
  return {
    obj: { id: `gone:${snap.id}`, type: 'activity', start: snap.start, end: snap.end ?? snap.start },
    gone: snap,
    label: { extraLeft: 0, extraRight: Math.max(0, textW - w) },
    barWidth: w,
    ghost: null,
    height: M.goneH,
    left: x,
    width: w,
  };
}

/**
 * Where the plan was, in the export.
 *
 * The canvas draws this too; without it here, a comparison taken into a
 * meeting as a PDF would show the current dates and no sign that anything had
 * moved — which is the one thing the reader is there to see. Every rectangle
 * below was measured and packed with the objects, so nothing here has to work
 * out whether it fits.
 */
function drawBaseline(items, { rectsById, goneRects, palette }) {
  for (const rect of rectsById.values()) {
    const ghost = rect.ghost;
    if (!ghost) continue;

    const { startShift, endShift } = ghost;
    const ink = endShift > 0 ? palette.bad : endShift < 0 ? palette.good : palette.warn;
    const gx = ghost.x;
    const gw = ghost.w;
    const gy = ghost.stacked ? rect.bottom + M.ghostGap : rect.top;
    const gh = ghost.stacked ? M.ghostH : Math.max(6, rect.bottom - rect.top);

    items.push({
      type: 'rect',
      x: gx,
      y: gy,
      w: gw,
      h: gh,
      radius: 3,
      fill: withAlpha(ink, 0.12),
      stroke: ink,
      strokeWidth: 0.8,
      dash: [3, 2],
    });

    // Why it moved, if anyone said. Inside the striped area when it was
    // measured to fit there, otherwise in the band packing reserved below the
    // row — the same two places the canvas uses, so the PDF a PMO is handed is
    // the drawing the planner was looking at.
    const reason = ghost.reason;
    if (reason && reason.placement === 'inside') {
      items.push({
        type: 'text',
        x: gx + M.reasonPadX,
        y: gy + gh / 2 + 2.3,
        text: reason.text,
        size: 6.5,
        weight: 600,
        fill: ink,
      });
    } else if (reason) {
      const noteTop = (ghost.stacked ? gy + gh : rect.bottom) + M.reasonGap;
      items.push({
        type: 'rect',
        x: gx,
        y: noteTop,
        w: 1.4,
        h: reason.height,
        fill: ink,
      });
      reason.lines.forEach((line, i) => {
        items.push({
          type: 'text',
          x: gx + M.reasonPadX,
          y: noteTop + (i + 1) * M.reasonLineH - 1.5,
          text: line,
          size: 6.5,
          weight: 600,
          fill: ink,
        });
      });
    }

    // The arrow between the two finish edges, with its day count. It rides the
    // ghost's own centre line, so a stacked ghost still points at its bar.
    const reshaped = endShift === 0;
    const fromX = reshaped ? gx : gx + gw;
    const toX = reshaped ? rect.x : rect.right;
    const shift = reshaped ? startShift : endShift;
    const y = gy + gh / 2;
    if (Math.abs(toX - fromX) > 1) {
      const dir = toX >= fromX ? 1 : -1;
      items.push({ type: 'line', x1: fromX, y1: y, x2: toX, y2: y, stroke: ink, strokeWidth: 1.1 });
      items.push({
        type: 'polygon',
        points: [[toX, y], [toX - 4 * dir, y - 2.6], [toX - 4 * dir, y + 2.6]],
        fill: ink,
      });
      items.push({
        type: 'text',
        x: (fromX + toX) / 2,
        y: y - 4,
        text: `${shift > 0 ? '+' : '\u2212'}${Math.abs(shift)}d`,
        size: 6.5,
        weight: 700,
        family: 'mono',
        fill: ink,
        anchor: 'middle',
      });
    }
  }

  // Objects the baseline had and the plan no longer does, on the row they were
  // packed onto.
  for (const gone of goneRects) {
    const { snap, x, w, y } = gone;
    items.push({
      type: 'rect',
      x,
      y,
      w,
      h: M.goneH,
      radius: 3,
      fill: withAlpha(palette.bad, 0.08),
      stroke: palette.bad,
      strokeWidth: 0.8,
      dash: [3, 2],
    });
    items.push({
      type: 'text',
      x: x + 4,
      y: y + M.goneH - 3.5,
      text: snap.title,
      size: 6.5,
      family: 'mono',
      fill: palette.bad,
    });
  }
}

function legendRows(doc, filter) {
  const counts = new Map();
  for (const obj of doc.objects) {
    if (obj.hidden || (filter && !filter(obj))) continue;
    counts.set(obj.type, (counts.get(obj.type) || 0) + 1);
  }
  return Array.from(counts, ([type, count]) => ({
    label: TYPES[type]?.label || type,
    color: TYPES[type]?.accent || 'var(--type-activity)',
    count,
  })).sort((a, b) => b.count - a.count);
}

export const SCENE_METRICS = M;
