/**
 * The viewport — the mapping between time and screen space.
 *
 * The timeline is conceptually infinite: there is no scroll container sized to
 * the project, and no maximum date. Instead the viewport holds two numbers —
 * the instant at the left edge (`originMs`) and the horizontal density
 * (`pxPerDay`) — and every pixel position is derived from them. Panning
 * changes the origin, zooming changes the density around an anchor point, and
 * only the currently visible slice is ever rendered.
 *
 * Imports: util, events, dates.
 */

import { clamp } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { MS_DAY, SCALES, startOfDay } from '../core/dates.js';

/** Zoom bounds: ~28 years across a 1600px window, down to ~6 days. */
export const MIN_PX_PER_DAY = 0.16;
export const MAX_PX_PER_DAY = 260;

/** Named zoom stops the toolbar's scale buttons jump to. */
export const ZOOM_PRESETS = {
  day: 44,
  week: 12,
  month: 3.4,
  quarter: 1.15,
  year: 0.34,
};

let originMs = 0;
let pxPerDay = 3.4;
let width = 1000;
let height = 600;
let listenersSuspended = false;

/* ── Accessors ─────────────────────────────────────────────────────────── */

export function getOrigin() {
  return originMs;
}

export function getPxPerDay() {
  return pxPerDay;
}

export function getWidth() {
  return width;
}

export function getHeight() {
  return height;
}

/** Milliseconds visible across the whole viewport. */
export function spanMs() {
  return (width / pxPerDay) * MS_DAY;
}

/** The instant at the right edge. */
export function endMs() {
  return originMs + spanMs();
}

/** Current view as a plain object — handy for persistence and the minimap. */
export function state() {
  return { originMs, pxPerDay, width, height, endMs: endMs(), scale: currentScale().id };
}

/* ── Conversion ────────────────────────────────────────────────────────── */

/** Time → x pixels, relative to the left edge of the canvas. */
export function msToPx(ms) {
  return ((ms - originMs) / MS_DAY) * pxPerDay;
}

/** x pixels → time. */
export function pxToMs(px) {
  return originMs + (px / pxPerDay) * MS_DAY;
}

/** Width in pixels of a duration in milliseconds. */
export function durationToPx(ms) {
  return (ms / MS_DAY) * pxPerDay;
}

/** Duration in milliseconds for a pixel width. */
export function pxToDuration(px) {
  return (px / pxPerDay) * MS_DAY;
}

/* ── Mutation ──────────────────────────────────────────────────────────── */

function publish(reason) {
  if (listenersSuspended) return;
  emit(EV.VIEW_CHANGED, { ...state(), reason });
}

/** Batch several viewport changes into one notification. */
export function batch(fn) {
  listenersSuspended = true;
  try {
    fn();
  } finally {
    listenersSuspended = false;
    publish('batch');
  }
}

export function setSize(w, h) {
  const changed = w !== width || h !== height;
  width = Math.max(1, w);
  height = Math.max(1, h);
  if (changed) publish('resize');
}

export function setOrigin(ms, reason = 'pan') {
  if (ms === originMs) return;
  originMs = ms;
  publish(reason);
}

export function panBy(dxPx) {
  if (!dxPx) return;
  originMs -= pxToDuration(dxPx);
  publish('pan');
}

/** Scroll so `ms` sits at a given fraction across the viewport. */
export function centerOn(ms, fraction = 0.5) {
  originMs = ms - spanMs() * fraction;
  publish('center');
}

/**
 * Zoom by a multiplicative factor, holding the instant currently under
 * `anchorPx` fixed. This is what makes wheel-zoom feel anchored to the cursor
 * rather than to the edge of the screen.
 */
export function zoomBy(factor, anchorPx = width / 2) {
  const anchorMs = pxToMs(anchorPx);
  const next = clamp(pxPerDay * factor, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
  if (next === pxPerDay) return;
  pxPerDay = next;
  originMs = anchorMs - (anchorPx / pxPerDay) * MS_DAY;
  publish('zoom');
}

/** Set absolute density, keeping `anchorPx` fixed. */
export function setPxPerDay(value, anchorPx = width / 2) {
  const anchorMs = pxToMs(anchorPx);
  pxPerDay = clamp(value, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
  originMs = anchorMs - (anchorPx / pxPerDay) * MS_DAY;
  publish('zoom');
}

/** Jump to a named zoom preset, keeping the viewport centre stable. */
export function setScalePreset(scaleId) {
  const target = ZOOM_PRESETS[scaleId];
  if (!target) return;
  setPxPerDay(target, width / 2);
  emit(EV.SCALE_CHANGED, { scale: scaleId });
}

/**
 * Fit a time range into the viewport with a little breathing room.
 * `padPx` reserves space on both sides (for the lane gutter, for instance).
 */
export function fitRange(startMs, stopMs, padPx = 40) {
  const usable = Math.max(120, width - padPx * 2);
  const days = Math.max(1, (stopMs - startMs) / MS_DAY);
  pxPerDay = clamp(usable / days, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
  originMs = startMs - pxToDuration(padPx);
  publish('fit');
}

/** Restore a persisted view. */
export function restore({ originMs: o, pxPerDay: p }) {
  if (Number.isFinite(p)) pxPerDay = clamp(p, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
  if (Number.isFinite(o)) originMs = o;
  publish('restore');
}

/* ── Scale selection ───────────────────────────────────────────────────── */

/**
 * The finest scale whose ticks stay legible at the current density.
 * SCALES is ordered fine → coarse, so the first match wins.
 */
export function currentScale() {
  for (const scale of SCALES) {
    if (pxPerDay >= scale.minPxPerDay) return scale;
  }
  return SCALES[SCALES.length - 1];
}

/** The scale one step coarser — the ruler's upper band. */
export function headerScale() {
  const current = currentScale();
  const i = SCALES.findIndex((s) => s.id === current.id);
  return SCALES[Math.min(SCALES.length - 1, i + 1)];
}

/**
 * The visible time window, padded by `overscanPx` on each side so objects
 * partially off-screen still render and scrolling stays seamless.
 */
export function visibleRange(overscanPx = 240) {
  const pad = pxToDuration(overscanPx);
  return { from: originMs - pad, to: endMs() + pad };
}

/** True when `ms` currently falls inside the viewport. */
export function isVisible(ms, overscanPx = 0) {
  const { from, to } = visibleRange(overscanPx);
  return ms >= from && ms <= to;
}

/** True when a time range intersects the viewport. */
export function rangeVisible(startMs, stopMs, overscanPx = 240) {
  const { from, to } = visibleRange(overscanPx);
  return stopMs >= from && startMs <= to;
}

/**
 * A readable description of the current zoom, e.g. "3.4 px/day · Month".
 * Shown in the status bar so the user always knows where they are.
 */
export function describeZoom() {
  const scale = currentScale();
  const days = spanMs() / MS_DAY;
  let span;
  if (days < 60) span = `${Math.round(days)} days`;
  else if (days < 730) span = `${(days / 30.44).toFixed(1)} months`;
  else span = `${(days / 365.25).toFixed(1)} years`;
  return { scale: scale.label, span, pxPerDay: pxPerDay.toFixed(2) };
}

/** Snap the origin to a whole day so gridlines land on exact pixels. */
export function alignOriginToDay() {
  originMs = startOfDay(originMs);
  publish('align');
}
