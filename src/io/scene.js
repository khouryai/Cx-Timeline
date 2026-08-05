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

import { clamp, withAlpha, readableInk, truncate } from '../core/util.js';
import { MS_DAY, ticks, fmtDate, toISO, startOfDay, addDays } from '../core/dates.js';
import { TYPES, statusOf, objectColor, effectiveToday, projectExtent, LINK_TYPES, durationDays } from '../core/model.js';
import { criticalPath } from '../core/analysis.js';

/** Layout constants for exported drawings, in points/pixels. */
const M = {
  gutter: 168,
  rulerUpper: 22,
  rulerLower: 22,
  headerH: 62,
  lanePadY: 6,
  rowH: 20,
  rowGap: 3,
  barMinW: 3,
  pointR: 7,
  footerH: 26,
};

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

  const laneGeom = [];
  let y = M.headerH + M.rulerUpper + M.rulerLower;
  const contentTop = y;

  for (const lane of lanes) {
    const objects = doc.objects
      .filter((o) => o.lane === lane.id && !o.hidden && (!filter || filter(o)))
      .sort((a, b) => a.start - b.start);

    const rows = packRowsForExport(objects);
    const rowCount = Math.max(1, rows.rows);
    const height = Math.max(34, rowCount * (M.rowH + M.rowGap) + M.lanePadY * 2);
    laneGeom.push({ lane, y, height, objects, rows: rows.assigned });
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
  const labelStride = Math.max(1, Math.ceil(24 / Math.max(tickWidth, 1)));

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

  laneGeom.forEach((entry, index) => {
    const laneColor = solid(entry.lane.color, palette);

    if (index % 2) {
      items.push({ type: 'rect', x: M.gutter, y: entry.y, w: width - M.gutter, h: entry.height, fill: withAlpha(palette.textSubtle, 0.035) });
    }
    items.push({ type: 'line', x1: 0, y1: entry.y + entry.height, x2: width, y2: entry.y + entry.height, stroke: palette.grid, strokeWidth: 0.6 });
    items.push({ type: 'rect', x: 0, y: entry.y, w: 3, h: entry.height, fill: laneColor });
    items.push({
      type: 'text',
      x: 12,
      y: entry.y + 15,
      text: truncate(entry.lane.name, 26),
      size: 9.5,
      weight: 600,
      fill: palette.text,
    });
    items.push({
      type: 'text',
      x: 12,
      y: entry.y + 27,
      text: `${entry.objects.length} item${entry.objects.length === 1 ? '' : 's'}`,
      size: 7,
      fill: palette.textSubtle,
      family: 'mono',
    });

    for (const obj of entry.objects) {
      const row = entry.rows.get(obj.id) || 0;
      const top = entry.y + M.lanePadY + row * (M.rowH + M.rowGap);
      const rect = drawObject(items, obj, entry.lane, { top, msToX, palette, pxPerDay, settings: doc.settings });
      if (rect) rectsById.set(obj.id, rect);
    }
  });

  items.push({ type: 'line', x1: M.gutter, y1: contentTop, x2: M.gutter, y2: contentTop + contentHeight, stroke: palette.border, strokeWidth: 1 });

  /* ── Dependencies ──────────────────────────────────────────────────── */
  if (opts.showLinks !== false && doc.settings.showConnectors) {
    const critical = doc.settings.criticalPath ? criticalPath(doc).critical : null;
    for (const link of doc.links) {
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

function drawObject(items, obj, lane, { top, msToX, palette, pxPerDay, settings }) {
  const def = TYPES[obj.type] || TYPES.activity;
  const color = solid(objectColor(obj, lane), palette);
  const style = obj.style || {};
  const opacity = style.opacity ?? 1;

  if (def.duration) {
    const x = msToX(obj.start);
    const w = Math.max(M.barMinW, msToX(obj.end) - x);
    const h = def.shape === 'band' || def.shape === 'container' ? M.rowH : M.rowH;
    const radius = Math.min(style.radius ?? 4, h / 2);
    const isBand = def.shape === 'band' || def.shape === 'container';

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

    const ink = style.textColor || (isBand ? color : readableInk(color));
    const subtitle = (obj.subtitle || '').trim();
    const charBudget = Math.max(4, Math.floor(w / 5.4));
    if (w > 26) {
      // With a subtitle the label splits into two lines, matching what the
      // canvas draws; without one it stays vertically centred.
      if (subtitle && h >= 18) {
        items.push({
          type: 'text',
          x: x + 5,
          y: top + h / 2 - 0.6,
          text: truncate(obj.title, charBudget),
          size: Math.min(8.5, style.fontSize || 8.5),
          weight: style.bold ? 700 : 600,
          fill: ink,
        });
        items.push({
          type: 'text',
          x: x + 5,
          y: top + h / 2 + 7.4,
          text: truncate(subtitle, charBudget),
          size: 7,
          fill: ink,
          opacity: 0.78,
        });
      } else {
        items.push({
          type: 'text',
          x: x + 5,
          y: top + h / 2 + 3.2,
          text: truncate(obj.title, charBudget),
          size: Math.min(9, style.fontSize || 9),
          weight: style.bold ? 700 : 500,
          fill: ink,
        });
      }
    } else {
      items.push({
        type: 'text',
        x: x + w + 4,
        y: top + h / 2 + 3.2,
        text: truncate(subtitle ? `${obj.title} · ${subtitle}` : obj.title, 46),
        size: 8,
        fill: palette.textMuted,
      });
    }

    return { x, right: x + w, cy: top + h / 2, bottom: top + h, top };
  }

  /* Point objects: milestone diamond, release flag, risk/issue pin. */
  const cx = msToX(obj.start);
  const cy = top + M.rowH / 2;
  const r = M.pointR;

  if (def.shape === 'release') {
    const statusColor = solid(style.fill || statusOf(obj.status).color, palette);
    items.push({ type: 'rect', x: cx - 1, y: top, w: 2, h: M.rowH, fill: statusColor });
    const label = obj.data?.version ? `v${obj.data.version}` : truncate(obj.title, 14);
    const w = 10 + label.length * 5;
    items.push({ type: 'rect', x: cx - w / 2, y: cy - 7, w, h: 14, fill: withAlpha(statusColor, 0.2), stroke: statusColor, strokeWidth: 0.8, radius: 3 });
    items.push({ type: 'text', x: cx, y: cy + 3.2, text: label, size: 7.5, weight: 700, fill: statusColor, anchor: 'middle', family: 'mono' });
    items.push({ type: 'text', x: cx, y: top - 3, text: truncate(obj.title, 26), size: 7.5, fill: palette.textMuted, anchor: 'middle' });
  } else if (def.shape === 'diamond') {
    items.push({
      type: 'polygon',
      points: [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]],
      fill: color,
      stroke: withAlpha(color, 0.9),
      strokeWidth: 0.8,
    });
    items.push({ type: 'text', x: cx, y: cy + r + 9, text: truncate(obj.title, 30), size: 7.5, weight: 600, fill: palette.text, anchor: 'middle' });
    if (obj.subtitle) {
      items.push({ type: 'text', x: cx, y: cy + r + 18, text: truncate(obj.subtitle, 30), size: 6.5, fill: palette.textMuted, anchor: 'middle' });
    }
  } else {
    const severity = obj.data?.severity;
    const pinColor = severity === 'critical' || severity === 'high' ? palette.bad : color;
    items.push({ type: 'circle', cx, cy, r: r - 1, fill: pinColor, stroke: withAlpha(pinColor, 0.9), strokeWidth: 0.8 });
    items.push({ type: 'text', x: cx, y: cy + r + 9, text: truncate(obj.title, 30), size: 7.5, fill: palette.text, anchor: 'middle' });
    if (obj.subtitle) {
      items.push({ type: 'text', x: cx, y: cy + r + 18, text: truncate(obj.subtitle, 30), size: 6.5, fill: palette.textMuted, anchor: 'middle' });
    }
  }

  return { x: cx - r, right: cx + r, cy, bottom: top + M.rowH, top };
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function packRowsForExport(objects) {
  const rowEnds = [];
  const assigned = new Map();
  for (const obj of objects) {
    const hasDuration = !!TYPES[obj.type]?.duration;
    const from = hasDuration ? obj.start : obj.start - MS_DAY * 2;
    const to = hasDuration ? obj.end : obj.start + MS_DAY * 2;
    let row = 0;
    while (row < rowEnds.length && rowEnds[row] > from) row++;
    rowEnds[row] = to;
    assigned.set(obj.id, row);
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
