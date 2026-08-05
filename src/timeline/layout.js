/**
 * Layout — the geometry pass.
 *
 * Turns the document plus the current viewport into a flat list of rectangles
 * the renderer can draw without thinking. Keeping this pure (no DOM, no side
 * effects) means the same geometry feeds the screen renderer, the SVG
 * exporter, the PDF writer and the minimap — so what you export is exactly
 * what you saw.
 *
 * Imports: util, dates, model, store, viewport.
 */

import { clamp } from '../core/util.js';
import { MS_DAY } from '../core/dates.js';
import { TYPES, objectRange } from '../core/model.js';
import { getDoc, orderedLanes, getLane } from '../core/store.js';
import { msToPx, durationToPx, pxToDuration, visibleRange, rangeVisible } from './viewport.js';

/** Vertical padding inside a lane band. */
const LANE_PAD = 7;
/** Height of a stacked row inside a lane. */
export const ROW_HEIGHT = 24;
/** Gap between stacked rows. */
const ROW_GAP = 3;
/** Minimum drawn width of a bar so a one-day task stays clickable. */
const MIN_BAR_PX = 6;
/** Point objects (milestones, markers) occupy a fixed square. */
const POINT_SIZE = 26;

/**
 * Vertical geometry for every visible lane.
 * @returns {{lanes: Array, totalHeight: number, byId: Map}}
 */
export function laneLayout() {
  const lanes = orderedLanes(false);
  const out = [];
  const byId = new Map();
  let y = 0;

  for (const lane of lanes) {
    const height = lane.collapsed ? 26 : lane.height;
    const entry = { lane, id: lane.id, y, height, contentY: y + LANE_PAD, contentH: Math.max(10, height - LANE_PAD * 2) };
    out.push(entry);
    byId.set(lane.id, entry);
    y += height;
  }

  return { lanes: out, totalHeight: y, byId };
}

/**
 * Assign a stacking row to every object in a lane so overlapping bars sit
 * above one another instead of on top of one another.
 *
 * Objects keep an explicit `row` when the user has dragged them vertically;
 * otherwise a first-fit packer places them on the lowest free row. Packing
 * runs in start order, which keeps the result stable as the plan is edited.
 */
export function packRows(objects, { minGapMs = 0, pointPadMs = MS_DAY } = {}) {
  const sorted = objects.slice().sort((a, b) => a.start - b.start || a.z - b.z);
  const rowEnds = []; // last occupied end (ms) per row
  const assigned = new Map();

  for (const obj of sorted) {
    const { start, end } = objectRange(obj);
    // A milestone or risk pin draws as a small glyph but reads as a centred
    // label several times wider, so it is packed against the width of that
    // label — otherwise two markers a few days apart overprint each other.
    const isPoint = !TYPES[obj.type]?.duration;
    const labelPad = isPoint ? Math.max(pointPadMs, pointPadMs * Math.min(1.6, (obj.title || '').length / 18)) : 0;
    const from = isPoint ? start - labelPad / 2 : start;
    const to = isPoint ? end + labelPad / 2 : end;

    if (Number.isFinite(obj.row) && obj.row > 0) {
      assigned.set(obj.id, obj.row);
      rowEnds[obj.row] = Math.max(rowEnds[obj.row] || -Infinity, to + minGapMs);
      continue;
    }

    let row = 0;
    while (row < rowEnds.length && rowEnds[row] > from) row++;
    rowEnds[row] = to + minGapMs;
    assigned.set(obj.id, row);
  }

  const rows = Math.max(1, rowEnds.length);
  return { assigned, rows };
}

/**
 * The full render model for the current frame.
 *
 * `filterFn` receives an object and returns true when it passes the active
 * filters; failing objects are still laid out (so the plan does not reflow as
 * filters change) but are marked `dimmed`.
 */
export function computeLayout({ filterFn = null, includeOffscreen = false } = {}) {
  const doc = getDoc();
  const geometry = laneLayout();
  const { from, to } = visibleRange();
  const rects = [];
  const byId = new Map();

  for (const laneEntry of geometry.lanes) {
    const laneObjects = doc.objects.filter((o) => o.lane === laneEntry.id && !o.hidden);
    if (!laneObjects.length) continue;

    // Convert a comfortable label width in pixels into a time span, so
    // clearance stays visually constant as the user zooms.
    const { assigned, rows } = packRows(laneObjects, { pointPadMs: Math.abs(pxToDuration(96)) });
    const collapsed = laneEntry.lane.collapsed;

    // Distribute the lane's content height across the packed rows, but never
    // squeeze a row below a legible height — the lane grows visually instead.
    const usable = laneEntry.contentH;
    const rowH = collapsed ? Math.max(8, usable) : clamp(Math.floor((usable - (rows - 1) * ROW_GAP) / rows), 12, 44);

    for (const obj of laneObjects) {
      const visible = includeOffscreen || rangeVisible(obj.start, TYPES[obj.type]?.duration ? obj.end : obj.start, 400);
      if (!visible) continue;

      const row = assigned.get(obj.id) || 0;
      const rect = objectRect(obj, laneEntry, row, rowH, collapsed);
      rect.dimmed = filterFn ? !filterFn(obj) : false;
      rects.push(rect);
      byId.set(obj.id, rect);
    }
  }

  // Draw order: explicit z, then containers/bands behind everything else so
  // they read as backdrops rather than covering the work they contain.
  rects.sort((a, b) => backdropRank(a) - backdropRank(b) || a.obj.z - b.obj.z);

  return { geometry, rects, byId, range: { from, to } };
}

function backdropRank(rect) {
  const shape = TYPES[rect.obj.type]?.shape;
  if (shape === 'container') return 0;
  if (shape === 'band') return 1;
  return 2;
}

/**
 * Screen rectangle for one object.
 * Coordinates are canvas-relative: x from the viewport origin, y from the top
 * of the lane stack (the scroll container handles vertical offset).
 */
export function objectRect(obj, laneEntry, row = 0, rowH = ROW_HEIGHT, collapsed = false) {
  const def = TYPES[obj.type] || TYPES.activity;
  const shape = def.shape;
  const hasDuration = def.duration;

  const x = msToPx(obj.start);
  const rawWidth = hasDuration ? durationToPx(Math.max(obj.end - obj.start, MS_DAY * 0.25)) : 0;

  let width;
  let left;
  let height;
  let top;

  if (hasDuration) {
    width = Math.max(MIN_BAR_PX, rawWidth);
    left = x;
  } else {
    width = POINT_SIZE;
    left = x - POINT_SIZE / 2;
  }

  if (shape === 'band' || shape === 'container') {
    // Bands span the whole lane rather than sitting on a packed row.
    top = laneEntry.y + 1;
    height = laneEntry.height - 2;
  } else if (collapsed) {
    top = laneEntry.y + 4;
    height = Math.max(8, laneEntry.height - 8);
  } else {
    top = laneEntry.contentY + row * (rowH + ROW_GAP);
    height = rowH;
    if (!hasDuration) {
      // Point glyphs are centred on their row rather than filling it.
      top = laneEntry.contentY + row * (rowH + ROW_GAP) + rowH / 2 - POINT_SIZE / 2;
      height = POINT_SIZE;
    }
    if (shape === 'sticky' || shape === 'callout' || shape === 'text' || shape === 'image') {
      // Free-form annotations get more vertical room than a schedule bar.
      height = Math.max(height, obj.style?.height || 54);
      top = laneEntry.contentY + row * (rowH + ROW_GAP);
      const maxBottom = laneEntry.y + laneEntry.height - 4;
      if (top + height > maxBottom) top = Math.max(laneEntry.contentY, maxBottom - height);
    }
  }

  return {
    id: obj.id,
    obj,
    lane: laneEntry.lane,
    laneEntry,
    shape,
    row,
    x: left,
    y: top,
    w: width,
    h: height,
    right: left + width,
    bottom: top + height,
    centerX: hasDuration ? left + width / 2 : x,
    centerY: top + height / 2,
    hasDuration,
    truncatedLeft: rawWidth > 0 && left < -2000,
    labelOutside: hasDuration && width < 52,
  };
}

/** Which lane sits at a given canvas y coordinate. */
export function laneAtY(geometry, y) {
  for (const entry of geometry.lanes) {
    if (y >= entry.y && y < entry.y + entry.height) return entry;
  }
  return geometry.lanes[geometry.lanes.length - 1] || null;
}

/** Which packed row within a lane a canvas y coordinate falls on. */
export function rowAtY(laneEntry, y, rows = 1) {
  if (!laneEntry) return 0;
  const usable = laneEntry.contentH;
  const rowH = clamp(Math.floor((usable - (rows - 1) * ROW_GAP) / rows), 12, 44);
  const offset = y - laneEntry.contentY;
  return clamp(Math.floor(offset / (rowH + ROW_GAP)), 0, Math.max(0, rows - 1));
}

/**
 * Hit-test: the topmost object rectangle containing a canvas point.
 * Iterates back to front so the object drawn last wins, matching what the
 * user sees.
 */
export function hitTest(layout, x, y, tolerance = 0) {
  for (let i = layout.rects.length - 1; i >= 0; i--) {
    const r = layout.rects[i];
    if (r.dimmed) continue;
    if (x >= r.x - tolerance && x <= r.right + tolerance && y >= r.y - tolerance && y <= r.bottom + tolerance) {
      return r;
    }
  }
  return null;
}

/** Every rectangle intersecting a marquee box. */
export function hitTestBox(layout, x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return layout.rects.filter(
    (r) => !r.dimmed && !r.obj.locked && r.right >= left && r.x <= right && r.bottom >= top && r.y <= bottom
  );
}

/**
 * Anchor points for a dependency endpoint.
 * `side` is 'start' or 'end' per the link type.
 */
export function anchorPoint(rect, side) {
  if (!rect) return null;
  if (!rect.hasDuration) {
    return { x: side === 'start' ? rect.centerX - 9 : rect.centerX + 9, y: rect.centerY };
  }
  return { x: side === 'start' ? rect.x : rect.right, y: rect.centerY };
}

/** Total canvas height including a comfortable scroll margin at the bottom. */
export function stageHeight(geometry) {
  return geometry.totalHeight + 80;
}

/** Lane entry for an object id, or null. */
export function laneEntryFor(geometry, laneId) {
  return geometry.byId.get(laneId) || null;
}

/** Convenience: the lane record an object belongs to. */
export function laneOf(obj) {
  return getLane(obj.lane);
}
