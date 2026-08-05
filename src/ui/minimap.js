/**
 * Minimap — a navigator overview of the whole programme.
 *
 * Draws every object as a coloured tick across the project's full extent,
 * with a draggable window showing what the main canvas is looking at. On a
 * five-year plan this is the difference between navigating and hunting.
 *
 * Imports: util, events, model, store, viewport, renderer, icons.
 */

import { el, clear, rafBatch, clamp } from '../core/util.js';
import { on, EV } from '../core/events.js';
import { projectExtent, objectColor, effectiveToday, TYPES } from '../core/model.js';
import { getDoc, orderedLanes, getSettings } from '../core/store.js';
import * as viewport from '../timeline/viewport.js';
import * as renderer from '../timeline/renderer.js';
import { icon } from './icons.js';

let root = null;
let body = null;
let viewBox = null;
let extent = { start: 0, end: 1 };
let dragging = null;

export function buildMinimap(hostEl) {
  root = el('div', { class: 'tl-minimap' });
  body = el('div', { class: 'tl-minimap-body' });

  const head = el('div', { class: 'tl-minimap-head' }, [
    el('span', { text: 'Navigator' }),
    el('span', { dataset: { mmRange: '1' } }),
  ]);

  viewBox = el('div', { class: 'tl-mini-view' });
  root.append(head, body);
  body.appendChild(viewBox);
  hostEl.appendChild(root);

  body.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', () => {
    dragging = null;
  });

  on(EV.DOC_CHANGED, (p) => {
    if (p?.transient) return;
    scheduleDraw();
  });
  on(EV.DOC_REPLACED, scheduleDraw);
  on(EV.VIEW_CHANGED, scheduleView);
  on(EV.THEME_CHANGED, scheduleDraw);

  scheduleDraw();
  return root;
}

const scheduleDraw = rafBatch(() => draw());
const scheduleView = rafBatch(() => updateViewBox());

/** Re-render the object ticks. */
function draw() {
  if (!root) return;
  const settings = getSettings();
  root.classList.toggle('hidden', !settings.showMinimap);
  if (!settings.showMinimap) return;

  const doc = getDoc();
  extent = projectExtent(doc);
  // Always include the current viewport so the window stays representable.
  extent.start = Math.min(extent.start, viewport.getOrigin());
  extent.end = Math.max(extent.end, viewport.endMs());

  clear(body);
  body.appendChild(viewBox);

  const span = Math.max(1, extent.end - extent.start);
  const width = body.clientWidth || 300;
  const height = body.clientHeight || 56;

  const lanes = orderedLanes(false);
  const laneIndex = new Map(lanes.map((l, i) => [l.id, i]));
  const rowH = lanes.length ? Math.max(2, Math.min(5, (height - 6) / lanes.length)) : 4;

  const fragment = document.createDocumentFragment();
  for (const obj of doc.objects) {
    if (obj.hidden) continue;
    const row = laneIndex.get(obj.lane);
    if (row === undefined) continue;

    const x = ((obj.start - extent.start) / span) * width;
    const hasDuration = TYPES[obj.type]?.duration;
    const w = hasDuration ? Math.max(1.5, ((obj.end - obj.start) / span) * width) : 2.5;

    fragment.appendChild(
      el('div', {
        class: 'tl-mini-obj',
        style: {
          left: `${x}px`,
          width: `${w}px`,
          top: `${3 + row * rowH}px`,
          height: `${Math.max(2, rowH - 1)}px`,
          background: objectColor(obj, { color: lanes[row]?.color }),
        },
      })
    );
  }

  const todayX = ((effectiveToday(doc) - extent.start) / span) * width;
  if (todayX >= 0 && todayX <= width) {
    fragment.appendChild(el('div', { class: 'tl-mini-today', style: { left: `${todayX}px` } }));
  }

  body.appendChild(fragment);

  const label = root.querySelector('[data-mm-range]');
  if (label) {
    const years = (span / 31_557_600_000).toFixed(1);
    label.textContent = `${years}y`;
  }

  updateViewBox();
}

function updateViewBox() {
  if (!root || !viewBox || root.classList.contains('hidden')) return;
  const span = Math.max(1, extent.end - extent.start);
  const width = body.clientWidth || 300;
  const left = ((viewport.getOrigin() - extent.start) / span) * width;
  const boxWidth = (viewport.spanMs() / span) * width;

  viewBox.style.left = `${clamp(left, -4, width)}px`;
  viewBox.style.width = `${clamp(boxWidth, 6, width + 8)}px`;
}

/* ── Interaction ───────────────────────────────────────────────────────── */

function onMouseDown(e) {
  const rect = body.getBoundingClientRect();
  const span = Math.max(1, extent.end - extent.start);
  const onBox = e.target === viewBox;

  if (onBox) {
    dragging = { offset: e.clientX - viewBox.getBoundingClientRect().left };
  } else {
    // Click anywhere to centre the viewport there.
    const fraction = (e.clientX - rect.left) / rect.width;
    viewport.centerOn(extent.start + span * fraction, 0.5);
    renderer.requestRender();
    dragging = { offset: viewBox.getBoundingClientRect().width / 2 };
  }
  e.preventDefault();
}

function onMouseMove(e) {
  if (!dragging) return;
  const rect = body.getBoundingClientRect();
  const span = Math.max(1, extent.end - extent.start);
  const x = e.clientX - rect.left - dragging.offset;
  viewport.setOrigin(extent.start + (x / rect.width) * span, 'minimap');
  renderer.requestRender();
}

/** Force a redraw — called after a resize. */
export function refreshMinimap() {
  scheduleDraw();
}
