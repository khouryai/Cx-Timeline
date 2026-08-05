/**
 * Pointer and gesture handling for the canvas.
 *
 * All direct manipulation lives here: panning, wheel zoom, selection,
 * marquee, moving and resizing objects, drawing dependencies, and dragging
 * lanes. Gestures use `store.preview()` for live feedback and commit exactly
 * once on release, so a drag across fifty pixels produces one undo step.
 *
 * The module never imports UI code — it publishes events (`object:activated`,
 * `canvas:contextmenu`, …) that the UI layer subscribes to.
 *
 * Imports: util, events, dates, model, store, viewport, layout, renderer, connectors.
 */

import { clamp, closestData, hasMod, isTyping } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { MS_DAY, snap as snapMs, fmtDate, toISO } from '../core/dates.js';
import { TYPES } from '../core/model.js';
import * as store from '../core/store.js';
import * as viewport from './viewport.js';
import { hitTest, hitTestBox, laneAtY, packRows } from './layout.js';
import * as renderer from './renderer.js';
import { previewPath } from './connectors.js';

/** Pixels the pointer must travel before a click becomes a drag. */
const DRAG_THRESHOLD = 3;
/** Wheel zoom sensitivity. */
const ZOOM_STEP = 1.0016;

let dom = null;
let gesture = null; // the in-flight gesture, or null
let spaceHeld = false;
let hoveredId = null;

/* ══════════════════════════════════════════════════════════════════════════
   Attach
   ═══════════════════════════════════════════════════════════════════════ */

export function attach() {
  dom = renderer.elements();

  dom.canvas.addEventListener('mousedown', onCanvasMouseDown);
  dom.canvas.addEventListener('mousemove', onCanvasMouseMove);
  dom.canvas.addEventListener('mouseleave', onCanvasMouseLeave);
  dom.canvas.addEventListener('dblclick', onCanvasDoubleClick);
  dom.canvas.addEventListener('contextmenu', onCanvasContextMenu);
  dom.canvas.addEventListener('wheel', onWheel, { passive: false });

  dom.ruler.addEventListener('mousedown', onRulerMouseDown);
  dom.ruler.addEventListener('wheel', onWheel, { passive: false });
  dom.ruler.addEventListener('dblclick', onRulerDoubleClick);

  dom.gutter.addEventListener('mousedown', onGutterMouseDown);
  dom.gutter.addEventListener('click', onGutterClick);
  dom.gutter.addEventListener('contextmenu', onGutterContextMenu);
  dom.gutter.addEventListener('wheel', onGutterWheel, { passive: false });

  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);
  window.addEventListener('keydown', onSpaceDown);
  window.addEventListener('keyup', onSpaceUp);
  window.addEventListener('blur', () => {
    spaceHeld = false;
    dom.canvas.classList.remove('pan-ready');
  });
}

/* ── Coordinate helpers ────────────────────────────────────────────────── */

/** Screen event → canvas coordinates (x from viewport origin, y in stage). */
function toCanvas(e) {
  const rect = dom.canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top + renderer.getScrollTop(),
    clientX: e.clientX,
    clientY: e.clientY,
  };
}

function snapDate(ms) {
  const settings = store.getSettings();
  return snapMs(ms, settings.snap, { weekStart: settings.weekStart, holidays: settings.holidays });
}

/* ══════════════════════════════════════════════════════════════════════════
   Wheel — zoom and scroll
   ═══════════════════════════════════════════════════════════════════════ */

function onWheel(e) {
  const settings = store.getSettings();
  const wheelZooms = settings.wheelMode !== 'scroll';
  const zoom = hasMod(e) || (wheelZooms && !e.shiftKey);

  if (zoom) {
    e.preventDefault();
    const rect = dom.canvas.getBoundingClientRect();
    const anchor = clamp(e.clientX - rect.left, 0, rect.width);
    // Normalise the delta: line-mode wheels report ~3, pixel-mode ~100.
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    viewport.zoomBy(ZOOM_STEP ** -delta, anchor);
    renderer.requestRender();
    return;
  }

  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    // Horizontal pan — shift+wheel, or a trackpad's horizontal axis.
    e.preventDefault();
    viewport.panBy(-(e.deltaX || e.deltaY));
    renderer.requestRender();
    return;
  }

  // Vertical: let the scroll container handle it natively.
}

function onGutterWheel(e) {
  // The gutter has no scrollbar of its own; forward to the canvas.
  e.preventDefault();
  dom.scroll.scrollTop += e.deltaY;
}

/* ══════════════════════════════════════════════════════════════════════════
   Canvas pointer
   ═══════════════════════════════════════════════════════════════════════ */

function onCanvasMouseDown(e) {
  if (e.button === 2) return; // right-click handled by contextmenu
  const point = toCanvas(e);
  const tool = store.getTool();

  // Middle button, space-drag or the pan tool always pans.
  if (e.button === 1 || spaceHeld || tool === 'pan') {
    e.preventDefault();
    startPan(point);
    return;
  }

  const anchorEl = closestData(e.target, 'anchor', dom.canvas);
  if (anchorEl) {
    const objEl = closestData(anchorEl, 'objId', dom.canvas);
    if (objEl) {
      e.preventDefault();
      startLink(objEl.dataset.objId, anchorEl.dataset.anchor, point);
      return;
    }
  }

  const handleEl = closestData(e.target, 'handle', dom.canvas);
  if (handleEl) {
    const objEl = closestData(handleEl, 'objId', dom.canvas);
    if (objEl) {
      e.preventDefault();
      startResize(objEl.dataset.objId, handleEl.dataset.handle, point);
      return;
    }
  }

  const objEl = closestData(e.target, 'objId', dom.canvas);
  if (objEl) {
    e.preventDefault();
    onObjectMouseDown(objEl.dataset.objId, point, e);
    return;
  }

  // Empty canvas: place a new object with a creation tool, else marquee.
  if (tool !== 'select' && TYPES[tool]) {
    e.preventDefault();
    placeObject(tool, point);
    return;
  }

  startMarquee(point, e);
}

function onObjectMouseDown(id, point, e) {
  const obj = store.getObject(id);
  if (!obj) return;

  const lane = store.getLane(obj.lane);
  const locked = obj.locked || lane?.locked;

  if (e.shiftKey || hasMod(e)) {
    store.toggleSelection(id);
    renderer.requestRender();
    return;
  }

  if (!store.isSelected(id)) {
    store.setSelection(store.expandGroupSelection([id]));
    renderer.requestRender();
  }

  if (locked) return;
  startMove(point);
}

function onCanvasMouseMove(e) {
  if (gesture) return;
  const point = toCanvas(e);
  const layout = renderer.getLayout();
  if (!layout) return;

  const hit = hitTest(layout, point.x, point.y);
  const id = hit ? hit.id : null;
  if (id !== hoveredId) {
    hoveredId = id;
    store.setHover(id);
    emit('canvas:hover', { id, rect: hit, clientX: e.clientX, clientY: e.clientY });
  } else if (id) {
    emit('canvas:hovermove', { id, clientX: e.clientX, clientY: e.clientY });
  }

  emit('canvas:cursor', { ms: viewport.pxToMs(point.x), x: point.x, y: point.y });
}

function onCanvasMouseLeave() {
  if (hoveredId) {
    hoveredId = null;
    store.setHover(null);
    emit('canvas:hover', { id: null });
  }
}

function onCanvasDoubleClick(e) {
  const objEl = closestData(e.target, 'objId', dom.canvas);
  if (objEl) {
    emit(EV.OBJECT_ACTIVATED, { id: objEl.dataset.objId });
    return;
  }
  const point = toCanvas(e);
  const layout = renderer.getLayout();
  const laneEntry = layout ? laneAtY(layout.geometry, point.y) : null;
  emit('canvas:createat', {
    ms: snapDate(viewport.pxToMs(point.x)),
    laneId: laneEntry?.id || null,
    x: point.x,
    y: point.y,
  });
}

function onCanvasContextMenu(e) {
  e.preventDefault();
  const point = toCanvas(e);
  const objEl = closestData(e.target, 'objId', dom.canvas);
  const layout = renderer.getLayout();
  const laneEntry = layout ? laneAtY(layout.geometry, point.y) : null;

  if (objEl) {
    const id = objEl.dataset.objId;
    if (!store.isSelected(id)) {
      store.setSelection(store.expandGroupSelection([id]));
      renderer.requestRender();
    }
    emit('canvas:contextmenu', { target: 'object', id, clientX: e.clientX, clientY: e.clientY });
  } else {
    emit('canvas:contextmenu', {
      target: 'canvas',
      ms: snapDate(viewport.pxToMs(point.x)),
      laneId: laneEntry?.id || null,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Gestures
   ═══════════════════════════════════════════════════════════════════════ */

function startPan(point) {
  gesture = { kind: 'pan', startX: point.clientX, startY: point.clientY, startScroll: renderer.getScrollTop() };
  dom.canvas.classList.add('panning');
}

function startMarquee(point, e) {
  if (!e.shiftKey && !hasMod(e)) store.clearSelection();
  gesture = { kind: 'marquee', x0: point.x, y0: point.y, x1: point.x, y1: point.y, additive: e.shiftKey || hasMod(e), moved: false };
}

function startMove(point) {
  const ids = store.getSelection().filter((id) => {
    const obj = store.getObject(id);
    return obj && !obj.locked && !store.getLane(obj.lane)?.locked;
  });
  if (!ids.length) return;

  const originals = new Map(
    ids.map((id) => {
      const o = store.getObject(id);
      return [id, { start: o.start, end: o.end, lane: o.lane, row: o.row }];
    })
  );
  gesture = { kind: 'move', ids, originals, startX: point.x, startY: point.y, moved: false, lastDelta: 0 };
}

function startResize(id, edge, point) {
  const obj = store.getObject(id);
  if (!obj || obj.locked) return;
  gesture = {
    kind: 'resize',
    id,
    edge,
    original: { start: obj.start, end: obj.end },
    startX: point.x,
    moved: false,
  };
}

function startLink(id, side, point) {
  gesture = { kind: 'link', from: id, side, x: point.x, y: point.y, moved: false };
  dom.canvas.classList.add('connecting');
}

function placeObject(type, point) {
  const layout = renderer.getLayout();
  const laneEntry = layout ? laneAtY(layout.geometry, point.y) : null;
  const ms = snapDate(viewport.pxToMs(point.x));
  const def = TYPES[type];
  const id = store.addObject(
    {
      type,
      lane: laneEntry?.id || null,
      start: ms,
      end: def.duration ? ms + (def.defaultDays || 1) * MS_DAY : ms,
    },
    `Add ${def.label.toLowerCase()}`
  );
  store.setSelection([id]);
  store.setTool('select');
  renderer.requestRender();
  emit('object:created', { id, type });
}

/* ── Window-level drag continuation ────────────────────────────────────── */

function onWindowMouseMove(e) {
  if (!gesture) return;

  const rect = dom.canvas.getBoundingClientRect();
  const point = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top + renderer.getScrollTop(),
    clientX: e.clientX,
    clientY: e.clientY,
  };

  switch (gesture.kind) {
    case 'pan':
      viewport.panBy(e.clientX - gesture.startX);
      gesture.startX = e.clientX;
      dom.scroll.scrollTop = gesture.startScroll - (e.clientY - gesture.startY);
      renderer.requestRender();
      break;

    case 'marquee': {
      gesture.x1 = point.x;
      gesture.y1 = point.y;
      if (!gesture.moved && Math.hypot(gesture.x1 - gesture.x0, gesture.y1 - gesture.y0) > DRAG_THRESHOLD) gesture.moved = true;
      if (gesture.moved) {
        renderer.showMarquee(gesture.x0, gesture.y0, gesture.x1, gesture.y1);
        autoPanEdge(point.x);
      }
      break;
    }

    case 'move':
      moveDrag(point, e);
      break;

    case 'resize':
      resizeDrag(point, e);
      break;

    case 'link': {
      gesture.x = point.x;
      gesture.y = point.y;
      gesture.moved = true;
      const layout = renderer.getLayout();
      const fromRect = layout?.byId.get(gesture.from);
      if (fromRect) {
        renderer.showLinkPreview(previewPath(fromRect, gesture.side, point.x, point.y, store.getSettings().connectorStyle));
      }
      const hit = layout ? hitTest(layout, point.x, point.y) : null;
      gesture.target = hit && hit.id !== gesture.from ? hit.id : null;
      break;
    }

    case 'lane-drag':
      laneDragMove(e);
      break;

    case 'lane-resize':
      laneResizeMove(e);
      break;

    case 'ruler-pan':
      viewport.panBy(e.clientX - gesture.startX);
      gesture.startX = e.clientX;
      renderer.requestRender();
      break;

    default:
      break;
  }
}

function moveDrag(point, e) {
  const dx = point.x - gesture.startX;
  const dy = point.y - gesture.startY;
  if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  gesture.moved = true;

  const deltaMs = viewport.pxToDuration(dx);
  const layout = renderer.getLayout();
  const targetLane = layout ? laneAtY(layout.geometry, point.y) : null;
  // Alt suppresses lane changes, so a purely horizontal nudge stays in place.
  const laneChange = !e.altKey && targetLane ? targetLane.id : null;

  store.preview((draft) => {
    for (const id of gesture.ids) {
      const obj = draft.objects.find((o) => o.id === id);
      const original = gesture.originals.get(id);
      if (!obj || !original) continue;

      const rawStart = original.start + deltaMs;
      const snapped = snapDate(rawStart);
      const shift = snapped - original.start;
      obj.start = original.start + shift;
      if (TYPES[obj.type]?.duration) obj.end = original.end + shift;

      if (laneChange && gesture.ids.length === 1) {
        const lane = draft.lanes.find((l) => l.id === laneChange);
        if (lane && !lane.locked) {
          obj.lane = laneChange;
          obj.row = 0; // let the packer re-place it in the new lane
        }
      }
    }
  });

  const first = store.getObject(gesture.ids[0]);
  if (first) {
    renderer.showGuide(viewport.msToPx(first.start), fmtDate(first.start, 'day'));
  }
  autoPanEdge(point.x);
  renderer.requestRender();
}

function resizeDrag(point, e) {
  const dx = point.x - gesture.startX;
  if (!gesture.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
  gesture.moved = true;

  const deltaMs = viewport.pxToDuration(dx);
  const { start, end } = gesture.original;

  store.preview((draft) => {
    const obj = draft.objects.find((o) => o.id === gesture.id);
    if (!obj) return false;
    if (gesture.edge === 'start') {
      const next = snapDate(start + deltaMs);
      obj.start = Math.min(next, obj.end - MS_DAY);
    } else {
      const next = snapDate(end + deltaMs);
      obj.end = Math.max(next, obj.start + MS_DAY);
    }
  });

  const obj = store.getObject(gesture.id);
  if (obj) {
    const edgeMs = gesture.edge === 'start' ? obj.start : obj.end;
    const days = Math.round((obj.end - obj.start) / MS_DAY);
    renderer.showGuide(viewport.msToPx(edgeMs), `${fmtDate(edgeMs, 'day')} · ${days}d`);
  }
  autoPanEdge(point.x);
  renderer.requestRender();
}

/** Scroll the timeline when a drag reaches the edge of the viewport. */
function autoPanEdge(x) {
  const margin = 48;
  const width = viewport.getWidth();
  if (x < margin) viewport.panBy(Math.min(18, (margin - x) / 2));
  else if (x > width - margin) viewport.panBy(-Math.min(18, (x - (width - margin)) / 2));
}

function onWindowMouseUp(e) {
  if (!gesture) return;
  const finished = gesture;
  gesture = null;

  dom.canvas.classList.remove('panning', 'connecting');
  renderer.hideGuide();
  renderer.hideMarquee();
  renderer.hideLinkPreview();

  switch (finished.kind) {
    case 'marquee': {
      if (finished.moved) {
        const layout = renderer.getLayout();
        if (layout) {
          const hits = hitTestBox(layout, finished.x0, finished.y0, finished.x1, finished.y1).map((r) => r.id);
          store.setSelection(finished.additive ? [...store.getSelection(), ...hits] : hits);
        }
      }
      break;
    }

    case 'move': {
      if (!finished.moved) break;
      // Commit the whole gesture as one edit; preview() already staged it.
      const ids = finished.ids;
      const snapshot = new Map(ids.map((id) => {
        const o = store.getObject(id);
        return [id, { start: o.start, end: o.end, lane: o.lane, row: o.row }];
      }));
      store.cancelPreview();
      store.edit(ids.length > 1 ? `Move ${ids.length} objects` : 'Move object', (draft) => {
        for (const id of ids) {
          const obj = draft.objects.find((o) => o.id === id);
          const next = snapshot.get(id);
          if (obj && next) Object.assign(obj, next);
        }
      });
      break;
    }

    case 'resize': {
      if (!finished.moved) break;
      const obj = store.getObject(finished.id);
      const next = { start: obj.start, end: obj.end };
      store.cancelPreview();
      store.updateObject(finished.id, next, 'Resize object');
      break;
    }

    case 'link': {
      if (finished.target) {
        const created = store.addLink({ from: finished.from, to: finished.target, type: 'FS' });
        if (!created) {
          emit(EV.TOAST, {
            tone: 'warn',
            title: 'Dependency not created',
            message: 'That link already exists, or it would create a circular dependency.',
          });
        }
      } else if (finished.moved) {
        emit('link:dropped', { from: finished.from, x: finished.x, y: finished.y, clientX: e.clientX, clientY: e.clientY });
      }
      break;
    }

    case 'lane-drag':
      laneDragEnd(finished);
      break;

    case 'lane-resize':
      laneResizeEnd(finished);
      break;

    default:
      break;
  }

  renderer.requestRender();
}

/* ══════════════════════════════════════════════════════════════════════════
   Ruler
   ═══════════════════════════════════════════════════════════════════════ */

function onRulerMouseDown(e) {
  if (e.button === 2) return;
  e.preventDefault();
  gesture = { kind: 'ruler-pan', startX: e.clientX };
}

function onRulerDoubleClick(e) {
  const rect = dom.ruler.getBoundingClientRect();
  const ms = viewport.pxToMs(e.clientX - rect.left);
  emit('ruler:activated', { ms });
}

/* ══════════════════════════════════════════════════════════════════════════
   Lane gutter
   ═══════════════════════════════════════════════════════════════════════ */

function onGutterMouseDown(e) {
  const resizeEl = closestData(e.target, 'laneResize', dom.gutter);
  if (resizeEl) {
    e.preventDefault();
    const lane = store.getLane(resizeEl.dataset.laneResize);
    gesture = { kind: 'lane-resize', id: lane.id, startY: e.clientY, startHeight: lane.height };
    return;
  }

  const dragEl = closestData(e.target, 'laneDrag', dom.gutter);
  if (dragEl) {
    e.preventDefault();
    const id = dragEl.dataset.laneDrag;
    gesture = { kind: 'lane-drag', id, startY: e.clientY, targetIndex: store.getDoc().laneOrder.indexOf(id) };
    dom.gutter.querySelector(`[data-lane-id="${id}"]`)?.classList.add('dragging');
  }
}

function laneDragMove(e) {
  const labels = Array.from(dom.gutter.querySelectorAll('.tl-lane-label'));
  let index = 0;
  for (const label of labels) {
    const rect = label.getBoundingClientRect();
    label.classList.remove('drop-target');
    if (e.clientY > rect.top + rect.height / 2) index++;
  }
  gesture.targetIndex = clamp(index, 0, labels.length - 1);
  labels[gesture.targetIndex]?.classList.add('drop-target');
}

/** Commit the reorder to wherever the label was dropped. */
function laneDragEnd(finished) {
  dom.gutter.querySelectorAll('.dragging, .drop-target').forEach((n) => n.classList.remove('dragging', 'drop-target'));
  if (finished.targetIndex == null) return;
  store.moveLane(finished.id, finished.targetIndex);
}

function laneResizeMove(e) {
  const next = clamp(gesture.startHeight + (e.clientY - gesture.startY), 28, 480);
  store.preview((draft) => {
    const lane = draft.lanes.find((l) => l.id === gesture.id);
    if (!lane) return false;
    lane.height = next;
  });
  renderer.requestRender();
}

/** Roll back the live preview, then re-apply the height as one undoable edit. */
function laneResizeEnd(finished) {
  const lane = store.getLane(finished.id);
  if (!lane) return;
  const height = lane.height;
  if (height === finished.startHeight) return;
  store.cancelPreview();
  store.updateLane(finished.id, { height }, 'Resize lane');
}

/* ══════════════════════════════════════════════════════════════════════════
   Keyboard modifiers
   ═══════════════════════════════════════════════════════════════════════ */

function onSpaceDown(e) {
  if (e.code === 'Space' && !isTyping(e.target) && !spaceHeld) {
    spaceHeld = true;
    dom.canvas.classList.add('pan-ready');
    e.preventDefault();
  }
}

function onSpaceUp(e) {
  if (e.code === 'Space') {
    spaceHeld = false;
    dom.canvas.classList.remove('pan-ready');
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Gutter clicks (collapse / menu)
   ═══════════════════════════════════════════════════════════════════════ */

function onGutterClick(e) {
  const actionEl = closestData(e.target, 'laneAction', dom.gutter);
  if (!actionEl) return;
  const id = actionEl.dataset.laneId;
  const action = actionEl.dataset.laneAction;

  if (action === 'collapse') {
    const lane = store.getLane(id);
    store.updateLane(id, { collapsed: !lane.collapsed }, lane.collapsed ? 'Expand lane' : 'Collapse lane');
    renderer.requestRender();
  } else if (action === 'menu') {
    const rect = actionEl.getBoundingClientRect();
    emit('lane:menu', { id, clientX: rect.left, clientY: rect.bottom + 4 });
  }
}

function onGutterContextMenu(e) {
  const labelEl = closestData(e.target, 'laneId', dom.gutter);
  if (!labelEl) return;
  e.preventDefault();
  emit('lane:menu', { id: labelEl.dataset.laneId, clientX: e.clientX, clientY: e.clientY });
}

/* ══════════════════════════════════════════════════════════════════════════
   Programmatic helpers used by shortcuts and the inspector
   ═══════════════════════════════════════════════════════════════════════ */

/** Nudge the selection by whole days. */
export function nudgeSelection(days) {
  const ids = store.getSelection().filter((id) => !store.getObject(id)?.locked);
  if (!ids.length) return;
  store.updateObjects(
    ids,
    (obj) => {
      const shift = days * MS_DAY;
      return TYPES[obj.type]?.duration
        ? { start: obj.start + shift, end: obj.end + shift }
        : { start: obj.start + shift };
    },
    days > 0 ? 'Move later' : 'Move earlier',
    { mergeKey: 'nudge' }
  );
  renderer.requestRender();
}

/** Grow or shrink the selection's duration by whole days. */
export function stretchSelection(days) {
  const ids = store.getSelection().filter((id) => {
    const obj = store.getObject(id);
    return obj && !obj.locked && TYPES[obj.type]?.duration;
  });
  if (!ids.length) return;
  store.updateObjects(
    ids,
    (obj) => ({ end: Math.max(obj.start + MS_DAY, obj.end + days * MS_DAY) }),
    'Change duration',
    { mergeKey: 'stretch' }
  );
  renderer.requestRender();
}

/** True while a gesture is in flight — the renderer avoids heavy work then. */
export function isDragging() {
  return gesture !== null;
}

export function currentGesture() {
  return gesture;
}
