/**
 * Layout — the geometry pass.
 *
 * Turns the document plus the current viewport into a flat list of rectangles
 * the renderer can draw without thinking. Keeping this pure (no DOM, no side
 * effects) means the same geometry feeds the screen renderer, the SVG
 * exporter, the PDF writer and the minimap — so what you export is exactly
 * what you saw.
 *
 * Labels are never clipped, ellipsised or hidden at any zoom. That constraint
 * drives the whole design here: every label is measured before it is placed,
 * a label that will not fit inside its bar is moved beside it, packing
 * reserves the space the label occupies as well as the bar, and rows and
 * lanes grow to whatever height the wrapped text needs.
 *
 * Baseline ghosts obey the same rule. A ghost is a rectangle on the canvas
 * like any other, so it is measured here and packed here: its span is part of
 * what its object occupies, and when it covers the same dates as the live bar
 * it drops to a tier of its own below it and the row grows. Comparison mode
 * therefore never prints one bar on top of another, at any zoom.
 *
 * Imports: util, dates, model, store, viewport, text.
 */

import { clamp } from '../core/util.js';
import { MS_DAY, daysBetween } from '../core/dates.js';
import { TYPES, objectRange, baselineSnapshot } from '../core/model.js';
import { getDoc, orderedLanes, getLane, activeBaseline } from '../core/store.js';
import { msToPx, durationToPx, pxToDuration, visibleRange, rangeVisible } from './viewport.js';
import { fontString, textWidth, wrapText, fitWidth } from './text.js';

/* ── Metrics ───────────────────────────────────────────────────────────── */

/** Vertical padding inside a lane band. */
const LANE_PAD = 7;
/** Smallest a packed row may be. */
export const ROW_HEIGHT = 24;
/** Gap between stacked rows. */
const ROW_GAP = 4;
/** Minimum drawn width of a bar so a one-day task stays clickable. */
const MIN_BAR_PX = 6;
/** Point objects (milestones, markers) occupy a fixed square glyph. */
const POINT_SIZE = 26;
/** Horizontal padding inside a bar's label. */
const LABEL_PAD_X = 8;
/** Vertical padding around a wrapped label inside a bar. */
const LABEL_PAD_Y = 4;
/** Gap between a bar and a label placed beside it. */
const OUTSIDE_GAP = 7;
/** Widest a label placed beside a bar may be before it wraps. */
const OUTSIDE_MAX_W = 250;
/** A bar narrower than this never holds its label internally. */
const MIN_INSIDE_W = 54;
/** Above this many wrapped lines, a label moves outside rather than stack up. */
const MAX_INSIDE_LINES = 3;
/** Space an icon takes inside a bar label. */
const ICON_W = 18;
/** Space the percentage readout takes inside a bar label. */
const PCT_W = 30;
/** Height of a baseline ghost that has to stack below its own bar. */
const GHOST_HEIGHT = 11;
/** Gap between a bar and the ghost stacked under it. */
const GHOST_GAP = 3;
/** Height of the outline drawn where a removed object used to sit. */
const GONE_HEIGHT = 20;
/** Room the day-count badge on a shift arrow needs, centred on the arrow. */
const SHIFT_BADGE_W = 48;

/* ── Fonts ─────────────────────────────────────────────────────────────── */

function titleFont(obj) {
  const style = obj.style || {};
  return fontString({
    size: style.fontSize || 12,
    weight: style.bold ? 700 : 500,
    italic: !!style.italic,
    family: style.font || null,
  });
}

function subtitleFont(obj) {
  const style = obj.style || {};
  return fontString({
    size: Math.max(9, Math.round((style.fontSize || 12) * 0.84)),
    weight: 400,
    italic: !!style.italic,
    family: style.font || null,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Label measurement
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Decide where an object's label goes and how much room it needs.
 *
 * `placement` is one of:
 *   'inside'  — wrapped within the bar
 *   'outside' — wrapped in a block to the right of a bar too narrow to hold it
 *   'below' / 'above' — centred under (or over) a point glyph
 *   'fill'    — free-form annotation; the whole object grows to fit the text
 */
export function measureLabel(obj, barWidthPx) {
  const def = TYPES[obj.type] || TYPES.activity;
  const shape = def.shape;
  const title = String(obj.title || '');
  const subtitle = String(obj.subtitle || '').trim();
  const tFont = titleFont(obj);
  const sFont = subtitleFont(obj);

  /* Point objects: the label always sits outside the glyph, centred. */
  if (!def.duration) {
    const fitted = fitWidth(title, tFont, { maxWidth: 200, maxLines: 3, minWidth: 40 });
    const titleWrap = wrapText(title, fitted.width, tFont);
    const subWrap = subtitle ? wrapText(subtitle, Math.max(fitted.width, 90), sFont) : null;
    const width = Math.max(titleWrap.width, subWrap ? subWrap.width : 0);
    const height = titleWrap.height + (subWrap ? subWrap.height : 0);

    return {
      placement: shape === 'release' ? 'above' : 'below',
      lines: titleWrap.lines,
      subLines: subWrap ? subWrap.lines : [],
      lineHeight: titleWrap.lineHeight,
      subLineHeight: subWrap ? subWrap.lineHeight : 0,
      width: Math.ceil(width),
      height: Math.ceil(height),
      // Centred text spreads equally either side of the glyph.
      extraLeft: Math.ceil(width / 2) + 4,
      extraRight: Math.ceil(width / 2) + 4,
      extraBelow: shape === 'release' ? 0 : Math.ceil(height) + 4,
      extraAbove: shape === 'release' ? Math.ceil(height) + 4 : 0,
    };
  }

  /* Free-form annotations: the box grows around the text. */
  if (shape === 'sticky' || shape === 'text' || shape === 'callout' || shape === 'image') {
    const inner = Math.max(40, barWidthPx - LABEL_PAD_X * 2);
    const titleWrap = wrapText(title, inner, tFont);
    const subWrap = subtitle ? wrapText(subtitle, inner, sFont) : null;
    return {
      placement: 'fill',
      lines: titleWrap.lines,
      subLines: subWrap ? subWrap.lines : [],
      lineHeight: titleWrap.lineHeight,
      subLineHeight: subWrap ? subWrap.lineHeight : 0,
      width: Math.ceil(Math.max(titleWrap.width, subWrap ? subWrap.width : 0)),
      height: Math.ceil(titleWrap.height + (subWrap ? subWrap.height : 0)),
      extraLeft: 0,
      extraRight: 0,
      extraBelow: 0,
      extraAbove: 0,
    };
  }

  /* Bars and bands: inside when the text fits, beside the bar when it does not. */
  const reserved = LABEL_PAD_X * 2 + (obj.icon ? ICON_W : 0) + (def.progress && obj.progress > 0 ? PCT_W : 0);
  const inner = barWidthPx - reserved;

  if (inner >= MIN_INSIDE_W) {
    const titleWrap = wrapText(title, inner, tFont);
    const subWrap = subtitle ? wrapText(subtitle, inner, sFont) : null;
    const totalLines = titleWrap.lines.length + (subWrap ? subWrap.lines.length : 0);

    if (totalLines <= MAX_INSIDE_LINES) {
      return {
        placement: 'inside',
        lines: titleWrap.lines,
        subLines: subWrap ? subWrap.lines : [],
        lineHeight: titleWrap.lineHeight,
        subLineHeight: subWrap ? subWrap.lineHeight : 0,
        width: Math.ceil(Math.max(titleWrap.width, subWrap ? subWrap.width : 0)),
        height: Math.ceil(titleWrap.height + (subWrap ? subWrap.height : 0)),
        extraLeft: 0,
        extraRight: 0,
        extraBelow: 0,
        extraAbove: 0,
      };
    }
  }

  const fitted = fitWidth(title, tFont, { maxWidth: OUTSIDE_MAX_W, maxLines: 3, minWidth: 70 });
  const titleWrap = wrapText(title, fitted.width, tFont);
  const subWrap = subtitle ? wrapText(subtitle, Math.max(fitted.width, 90), sFont) : null;
  const width = Math.ceil(Math.max(titleWrap.width, subWrap ? subWrap.width : 0));
  const height = Math.ceil(titleWrap.height + (subWrap ? subWrap.height : 0));

  return {
    placement: 'outside',
    lines: titleWrap.lines,
    subLines: subWrap ? subWrap.lines : [],
    lineHeight: titleWrap.lineHeight,
    subLineHeight: subWrap ? subWrap.lineHeight : 0,
    width,
    height,
    extraLeft: 0,
    extraRight: width + OUTSIDE_GAP + 4,
    extraBelow: 0,
    extraAbove: 0,
  };
}

/** Height one object needs on its packed row, label and ghost included. */
function rowHeightFor(obj, label, ghost = null) {
  const def = TYPES[obj.type] || TYPES.activity;
  // A ghost that has to stack takes a tier of its own under the bar.
  const tier = ghost && ghost.stacked ? GHOST_HEIGHT + GHOST_GAP : 0;

  if (!def.duration) {
    return Math.max(ROW_HEIGHT, POINT_SIZE + label.extraBelow + label.extraAbove) + tier;
  }
  if (label.placement === 'fill') {
    return Math.max(46, label.height + LABEL_PAD_Y * 2 + 8) + tier;
  }
  if (label.placement === 'outside') {
    // The bar itself stays slim; the row must still clear the label beside it.
    return Math.max(ROW_HEIGHT, label.height + LABEL_PAD_Y * 2) + tier;
  }
  return Math.max(ROW_HEIGHT, label.height + LABEL_PAD_Y * 2) + tier;
}

/* ══════════════════════════════════════════════════════════════════════════
   Baseline comparison
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The comparison rows for this frame, keyed by object id — or null when the
 * document is not comparing against anything.
 *
 * Derived from the snapshot on every frame like the rest of the comparison, so
 * there is no state to go stale. Layout reads it because a ghost occupies room
 * on the canvas: a packer that only knew about live bars would put the next
 * object along straight underneath one.
 */
function comparisonRows(doc) {
  if (!doc.settings || !doc.settings.showBaseline) return null;
  const baseline = activeBaseline();
  if (!baseline) return null;
  const rows = baselineSnapshot(doc, baseline);
  if (!rows.length) return null;
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Where an object's baseline ghost goes and how much room it needs.
 *
 * `stacked` is the answer to the overlap question. While the ghost and the
 * live bar cover different dates they can share a height — the ghost behind,
 * the arrow between their finish edges — and the pair reads as one object that
 * moved. The moment they cover the same dates that reading is a pile: the
 * ghost then takes a slim tier below the bar, and `rowHeightFor` grows the row
 * to hold it. Because the test is in pixels, zooming out until two dates touch
 * splits them, and zooming back in re-joins them.
 *
 * `from`/`to` are the span the ghost occupies, arrow badge included, which is
 * what `packRows` reserves. No label term: a ghost carries no text of its own,
 * and its neighbours reserve the room their labels need themselves.
 */
function measureGhost(obj, snap, barWidth) {
  if (!snap) return null;
  const def = TYPES[obj.type] || TYPES.activity;
  const hasDuration = !!def.duration;

  const snapStart = snap.start;
  const snapEnd = hasDuration ? (snap.end ?? snap.start) : snap.start;
  const startShift = daysBetween(snapStart, obj.start);
  const endShift = hasDuration ? daysBetween(snapEnd, obj.end) : startShift;
  // Nothing moved: there is no ghost to draw and nothing to reserve.
  if (!startShift && !endShift) return null;

  const left = hasDuration ? msToPx(snapStart) : msToPx(snapStart) - POINT_SIZE / 2;
  const width = hasDuration ? Math.max(4, durationToPx(Math.max(snapEnd - snapStart, 0))) : POINT_SIZE;
  const barLeft = hasDuration ? msToPx(obj.start) : msToPx(obj.start) - POINT_SIZE / 2;
  const barRight = barLeft + (hasDuration ? barWidth : POINT_SIZE);

  // A reshape (same finish, different start) is measured at the start edges
  // instead, or the arrow would have no length. Mirrors the renderer.
  const reshaped = endShift === 0;
  const fromX = reshaped ? left : left + width;
  const toX = reshaped ? barLeft : barRight;
  const mid = (fromX + toX) / 2;

  // Bands and containers are lane-tall backdrops with nothing to stack under,
  // and a point glyph's label already owns the space below it.
  const canStack = hasDuration && def.shape !== 'band' && def.shape !== 'container';

  return {
    snap,
    startShift,
    endShift,
    startMs: snapStart,
    endMs: snapEnd,
    left,
    width,
    stacked: canStack && left < barRight + GHOST_GAP && left + width > barLeft - GHOST_GAP,
    from: Math.min(left, mid - SHIFT_BADGE_W / 2),
    to: Math.max(left + width, mid + SHIFT_BADGE_W / 2),
  };
}

/**
 * A stand-in for an object the baseline had and the plan no longer does.
 *
 * It has no object to hang off, so it gets a phantom one and joins the pack
 * like everything else. Drawing these at the top of the lane instead — which
 * is what happened before — put them straight on top of whatever now occupies
 * the first row.
 */
function measureGone(snap) {
  const font = fontString({ size: 10, weight: 500, italic: true });
  const left = msToPx(snap.start);
  const width = Math.max(10, msToPx(snap.end ?? snap.start) - left);
  // The struck-through name is not clipped either, so if it is wider than the
  // outline the packer has to know the outline is effectively that wide.
  const textW = Math.ceil(textWidth(String(snap.title || ''), font)) + 14;

  return {
    obj: {
      id: `gone:${snap.id}`,
      type: 'activity',
      lane: snap.lane,
      start: snap.start,
      end: snap.end ?? snap.start,
      z: -1,
      row: null,
    },
    gone: snap,
    label: { extraLeft: 0, extraRight: Math.max(0, textW - width), extraAbove: 0, extraBelow: 0 },
    barWidth: width,
    ghost: null,
    height: Math.max(ROW_HEIGHT, GONE_HEIGHT),
    left,
    width,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Packing
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Assign a stacking row to every object in a lane so neither bars nor their
 * labels overlap.
 *
 * The occupied span of an object is the bar plus whatever its label needs on
 * either side, plus — in comparison mode — its baseline ghost and the badge on
 * the arrow that measures the move, converted from pixels to time at the
 * current zoom. That is what guarantees a label placed beside a narrow bar, or
 * a ghost reaching back weeks before the bar it belongs to, can never be
 * overprinted by the next object along.
 *
 * Objects keep an explicit `row` when the user has set one; otherwise a
 * first-fit packer places them on the lowest free row, in start order, which
 * keeps the result stable as the plan is edited.
 */
export function packRows(entries, { minGapPx = 6 } = {}) {
  const sorted = entries.slice().sort((a, b) => a.obj.start - b.obj.start || a.obj.z - b.obj.z);
  const rowEnds = []; // last occupied end (px) per row
  const assigned = new Map();

  for (const entry of sorted) {
    const { obj, label, barWidth, ghost } = entry;
    const startPx = msToPx(obj.start);
    const hasDuration = !!TYPES[obj.type]?.duration;

    let from = (hasDuration ? startPx : startPx - POINT_SIZE / 2) - label.extraLeft;
    let to = (hasDuration ? startPx + barWidth : startPx + POINT_SIZE / 2) + label.extraRight;

    if (ghost) {
      from = Math.min(from, ghost.from);
      to = Math.max(to, ghost.to);
    }

    if (Number.isFinite(obj.row) && obj.row > 0) {
      const row = Math.min(obj.row, 24);
      assigned.set(obj.id, row);
      rowEnds[row] = Math.max(rowEnds[row] ?? -Infinity, to + minGapPx);
      continue;
    }

    let row = 0;
    while (row < rowEnds.length && (rowEnds[row] ?? -Infinity) > from) row++;
    rowEnds[row] = to + minGapPx;
    assigned.set(obj.id, row);
  }

  // Explicit rows can leave gaps; normalise the count to the highest used.
  let rows = 0;
  for (const row of assigned.values()) rows = Math.max(rows, row + 1);
  return { assigned, rows: Math.max(1, rows) };
}

/* ══════════════════════════════════════════════════════════════════════════
   Full layout
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The render model for the current frame.
 *
 * `filterFn` receives an object and returns true when it passes the active
 * filters. What happens to the failures is the user's choice:
 *
 *   dim (default)  they are laid out and marked `dimmed`, so the shape of the
 *                  plan stays readable and nothing moves as filters change.
 *   hide           they are dropped before packing, so rows reflow and lanes
 *                  shrink to what is left — the plan closes up around them.
 *
 * Dropping them before packing rather than skipping them at paint time is what
 * makes the second mode worth having: skipping later would leave the gaps the
 * hidden objects were occupying.
 *
 * In comparison mode the baseline is part of the geometry: every object's ghost
 * is measured with it, removed objects get a packed row of their own, and both
 * are returned ready to draw (`rect.ghost`, `layout.removed`) so no consumer
 * has to work out where they went a second time.
 */
export function computeLayout({ filterFn = null, hideFiltered = false, includeOffscreen = false, gutterWidth = 190 } = {}) {
  const doc = getDoc();
  const lanes = orderedLanes(false);
  const rects = [];
  const byId = new Map();
  const removed = [];

  const snapshot = comparisonRows(doc);
  const goneByLane = new Map();
  if (snapshot) {
    const liveIds = new Set(doc.objects.map((o) => o.id));
    const laneIds = new Set(lanes.map((l) => l.id));
    for (const snap of snapshot.values()) {
      if (liveIds.has(snap.id)) continue;
      // A snapshot can name a lane that has since been deleted too; those fall
      // to the first lane, which is the only place left to say they existed.
      const laneId = laneIds.has(snap.lane) ? snap.lane : lanes[0]?.id;
      if (!laneId) continue;
      if (!goneByLane.has(laneId)) goneByLane.set(laneId, []);
      goneByLane.get(laneId).push(snap);
    }
  }

  const laneEntries = [];
  let y = 0;

  for (const lane of lanes) {
    const laneObjects = doc.objects.filter(
      (o) => o.lane === lane.id && !o.hidden && !(hideFiltered && filterFn && !filterFn(o))
    );

    // Measure every object in the lane, not just the visible ones: row heights
    // must not change as the plan is scrolled sideways.
    const measured = laneObjects.map((obj) => {
      const hasDuration = !!TYPES[obj.type]?.duration;
      const barWidth = hasDuration
        ? Math.max(MIN_BAR_PX, durationToPx(Math.max(obj.end - obj.start, MS_DAY * 0.25)))
        : POINT_SIZE;
      const label = measureLabel(obj, barWidth);
      const ghost = snapshot ? measureGhost(obj, snapshot.get(obj.id), barWidth) : null;
      return { obj, label, barWidth, ghost, height: rowHeightFor(obj, label, ghost) };
    });

    // Outlines for what the baseline had and the plan has not. They pack with
    // the live objects rather than beside them, so a removed bar cannot land on
    // top of whatever took its place.
    const goneItems = (goneByLane.get(lane.id) || []).map(measureGone);

    const collapsed = lane.collapsed;
    const packable = goneItems.length ? measured.concat(goneItems) : measured;
    const { assigned, rows } = collapsed
      ? { assigned: new Map(packable.map((m) => [m.obj.id, 0])), rows: 1 }
      : packRows(packable);

    // Each row is as tall as the tallest thing standing on it. A row holding a
    // ghost that had to stack also reserves a tier along its bottom edge — for
    // the whole row, not just that one object, so bars sharing a row keep
    // sharing a height and the row does not come out ragged.
    const rowHeights = new Array(rows).fill(ROW_HEIGHT);
    const rowTiers = new Array(rows).fill(0);
    if (!collapsed) {
      for (const entry of packable) {
        const row = assigned.get(entry.obj.id) || 0;
        rowHeights[row] = Math.max(rowHeights[row], entry.height);
        if (entry.ghost && entry.ghost.stacked) rowTiers[row] = GHOST_HEIGHT + GHOST_GAP;
      }
    }

    const rowTops = [];
    let cursor = 0;
    for (let r = 0; r < rows; r++) {
      rowTops.push(cursor);
      cursor += rowHeights[r] + ROW_GAP;
    }
    const contentHeight = Math.max(ROW_HEIGHT, cursor - ROW_GAP);

    // The lane's stored height is a minimum: it grows to fit its content and
    // its own name in the gutter, and never shrinks below what the user set.
    const gutterHeight = laneLabelHeight(lane, gutterWidth);
    const height = collapsed
      ? 26
      : Math.max(lane.height, contentHeight + LANE_PAD * 2, gutterHeight);

    const entry = {
      lane,
      id: lane.id,
      y,
      height,
      contentY: y + LANE_PAD,
      contentH: Math.max(10, height - LANE_PAD * 2),
      rowTops,
      rowHeights,
      rowTiers,
      rows,
    };
    laneEntries.push(entry);
    y += height;

    for (const item of measured) {
      // A ghost can reach well outside its own object's dates, and the pair has
      // to appear and leave together, so the span tested is both of them.
      const from = Math.min(item.obj.start, item.ghost ? item.ghost.startMs : item.obj.start);
      const liveEnd = TYPES[item.obj.type]?.duration ? item.obj.end : item.obj.start;
      const to = Math.max(liveEnd, item.ghost ? item.ghost.endMs : liveEnd);
      const visible =
        includeOffscreen ||
        rangeVisible(from - pxToDuration(item.label.extraLeft), to + pxToDuration(item.label.extraRight), 400);
      if (!visible) continue;

      const row = assigned.get(item.obj.id) || 0;
      const rect = objectRect(item.obj, entry, row, item, collapsed);
      rect.dimmed = filterFn ? !filterFn(item.obj) : false;
      rects.push(rect);
      byId.set(item.obj.id, rect);
    }

    for (const item of goneItems) {
      if (!includeOffscreen && !rangeVisible(item.obj.start, item.obj.end, 400)) continue;
      const row = collapsed ? 0 : assigned.get(item.obj.id) || 0;
      const rowTop = entry.contentY + (entry.rowTops[row] ?? 0);
      removed.push({
        snap: item.gone,
        laneEntry: entry,
        row,
        x: item.left,
        w: item.width,
        y: collapsed ? entry.y + 4 : rowTop,
        h: collapsed ? Math.max(8, entry.height - 8) : Math.min(GONE_HEIGHT, entry.rowHeights[row] ?? GONE_HEIGHT),
      });
    }
  }

  const geometry = {
    lanes: laneEntries,
    totalHeight: y,
    byId: new Map(laneEntries.map((e) => [e.id, e])),
  };

  // Draw order: containers and bands behind everything else so they read as
  // backdrops rather than covering the work they contain.
  rects.sort((a, b) => backdropRank(a) - backdropRank(b) || a.obj.z - b.obj.z);

  return { geometry, rects, byId, removed, range: visibleRange() };
}

function backdropRank(rect) {
  const shape = TYPES[rect.obj.type]?.shape;
  if (shape === 'container') return 0;
  if (shape === 'band') return 1;
  return 2;
}

/** Height the lane's own name needs in the gutter, wrapped to its width. */
function laneLabelHeight(lane, gutterWidth) {
  const font = fontString({ size: 12, weight: 600 });
  // Matches the gutter label's CSS box: 24px left inset, 30px right inset.
  const available = Math.max(60, gutterWidth - 54);
  const wrapped = wrapText(lane.name || '', available, font);
  return wrapped.height + 22; // meta line plus padding
}

/**
 * Screen rectangle for one object.
 * Coordinates are canvas-relative: x from the viewport origin, y from the top
 * of the lane stack (the scroll container handles vertical offset).
 */
export function objectRect(obj, laneEntry, row, measured, collapsed = false) {
  const def = TYPES[obj.type] || TYPES.activity;
  const shape = def.shape;
  const hasDuration = def.duration;
  const label = measured.label;

  const x = msToPx(obj.start);
  const rowTop = laneEntry.contentY + (laneEntry.rowTops[row] ?? 0);
  const fullRowH = laneEntry.rowHeights[row] ?? ROW_HEIGHT;

  // A ghost that overlaps its own bar in time cannot share its height, so it
  // takes a tier along the bottom of the row and the bars keep what is above.
  // A collapsed lane has no room for tiers: there, the ghost stays behind.
  const stacked = !!(measured.ghost && measured.ghost.stacked) && !collapsed;
  const tier = collapsed ? 0 : (laneEntry.rowTiers?.[row] ?? 0);
  const rowH = Math.max(ROW_HEIGHT, fullRowH - tier);

  let width;
  let left;
  let height;
  let top;

  if (hasDuration) {
    width = measured.barWidth;
    left = x;
  } else {
    width = POINT_SIZE;
    left = x - POINT_SIZE / 2;
  }

  if (shape === 'band' || shape === 'container') {
    top = laneEntry.y + 1;
    height = laneEntry.height - 2;
  } else if (collapsed) {
    top = laneEntry.y + 4;
    height = Math.max(8, laneEntry.height - 8);
  } else if (!hasDuration) {
    // Glyph sits above its label (or below it, for a release flag).
    top = rowTop + label.extraAbove;
    height = POINT_SIZE;
  } else if (label.placement === 'fill') {
    top = rowTop;
    height = rowH;
  } else {
    height = label.placement === 'outside' ? Math.min(rowH, Math.max(ROW_HEIGHT, label.lineHeight + LABEL_PAD_Y * 2)) : rowH;
    top = rowTop + (rowH - height) / 2;
  }

  return {
    id: obj.id,
    obj,
    lane: laneEntry.lane,
    laneEntry,
    shape,
    row,
    label,
    /**
     * Where the baseline ghost is drawn, in the same coordinates as the bar —
     * behind it when the two are clear of each other, in its own tier under the
     * row when they are not. Null unless the document is comparing.
     */
    ghost: measured.ghost
      ? {
          ...measured.ghost,
          stacked,
          x: measured.ghost.left,
          w: measured.ghost.width,
          y: stacked ? rowTop + rowH + GHOST_GAP : top,
          h: stacked ? GHOST_HEIGHT : height,
        }
      : null,
    x: left,
    y: top,
    w: width,
    h: height,
    right: left + width,
    bottom: top + height,
    centerX: hasDuration ? left + width / 2 : x,
    centerY: top + height / 2,
    hasDuration,
    /** Full extent including the label — used for hit-testing and marquees. */
    labelLeft: left - label.extraLeft,
    labelRight: left + width + label.extraRight,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Queries
   ═══════════════════════════════════════════════════════════════════════ */

/** Which lane sits at a given canvas y coordinate. */
export function laneAtY(geometry, y) {
  for (const entry of geometry.lanes) {
    if (y >= entry.y && y < entry.y + entry.height) return entry;
  }
  return geometry.lanes[geometry.lanes.length - 1] || null;
}

/** Which packed row within a lane a canvas y coordinate falls on. */
export function rowAtY(laneEntry, y) {
  if (!laneEntry || !laneEntry.rowTops.length) return 0;
  const offset = y - laneEntry.contentY;
  for (let r = laneEntry.rowTops.length - 1; r >= 0; r--) {
    if (offset >= laneEntry.rowTops[r]) return r;
  }
  return 0;
}

/**
 * Hit-test: the topmost object rectangle containing a canvas point.
 * Iterates back to front so the object drawn last wins, matching what the
 * user sees. Only the bar or glyph is a target — a label beside a bar is
 * informative, not a handle.
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

/** Vertical geometry only — used where object placement is irrelevant. */
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
