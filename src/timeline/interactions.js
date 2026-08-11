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

import { clamp, closestData, el, hasMod, isTyping } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { MS_DAY, snap as snapMs, fmtDate, toISO, addMonths, addWeeks, addWorkingDays } from '../core/dates.js';
import { TYPES, LINK_TYPES, linkTypeBetween } from '../core/model.js';
import * as store from '../core/store.js';
import * as viewport from './viewport.js';
import { hitTest, hitTestBox, laneAtY } from './layout.js';
import * as renderer from './renderer.js';
import { previewPath, anchorUnder } from './connectors.js';

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
  dom.canvas.addEventListener('dragover', onCanvasDragOver);
  dom.canvas.addEventListener('dragleave', onCanvasDragLeave);
  dom.canvas.addEventListener('drop', onCanvasDrop);

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

/* ── Dropping onto the canvas ──────────────────────────────────────────── */

/**
 * Something is being dragged over the plan.
 *
 * This layer reports *where* a thing landed — on which bar, in which lane —
 * and deliberately not what it means. The P6 register decides that; the
 * canvas would otherwise have to know about Primavera to accept a drop.
 *
 * File drags are left alone: `main.js` handles those, and claiming them here
 * would break opening a project by dropping it on the window.
 */
function isDataDrag(e) {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).some((t) => t.startsWith('application/x-cx-'));
}

let dropTargetId = null;

function markDropTarget(id) {
  if (id === dropTargetId) return;
  if (dropTargetId) renderer.elementFor(dropTargetId)?.classList.remove('drop-target');
  dropTargetId = id;
  if (id) renderer.elementFor(id)?.classList.add('drop-target');
}

function onCanvasDragOver(e) {
  if (!isDataDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';

  const layout = renderer.getLayout();
  if (!layout) return;
  const point = toCanvas(e);
  const hit = hitTest(layout, point.x, point.y);
  markDropTarget(hit ? hit.id : null);
}

function onCanvasDragLeave(e) {
  // `dragleave` fires when crossing into a child element too, so only clear
  // the highlight when the pointer has genuinely left the canvas.
  if (e.relatedTarget && dom.canvas.contains(e.relatedTarget)) return;
  markDropTarget(null);
}

function onCanvasDrop(e) {
  if (!isDataDrag(e)) return;
  e.preventDefault();
  markDropTarget(null);

  const data = {};
  for (const type of Array.from(e.dataTransfer.types)) {
    if (type.startsWith('application/x-cx-')) data[type] = e.dataTransfer.getData(type);
  }

  const layout = renderer.getLayout();
  if (!layout) return;
  const point = toCanvas(e);
  const hit = hitTest(layout, point.x, point.y);
  const laneEntry = laneAtY(layout.geometry, point.y);

  emit('canvas:drop', {
    data,
    objectId: hit ? hit.id : null,
    laneId: laneEntry ? laneEntry.id : null,
    ms: viewport.pxToMs(point.x),
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

/** Human name of the active snap unit, shown on the drag guide. */
function snapLabel() {
  const mode = store.getSettings().snap;
  return { day: 'day', workday: 'working day', week: 'week', month: 'month', quarter: 'quarter' }[mode] || '';
}

/**
 * Advance an instant by one snap unit.
 *
 * Keyboard nudging steps by whatever the snap dropdown says, so the two
 * controls agree: with week snapping, an arrow key moves a week. Stepping by a
 * single day under month snapping would round straight back to where it
 * started and look like the key had done nothing.
 */
export function stepBySnap(ms, direction, large = false) {
  const settings = store.getSettings();
  const n = direction * (large ? snapLargeMultiplier(settings.snap) : 1);
  switch (settings.snap) {
    case 'week':
      return addWeeks(ms, n);
    case 'month':
      return addMonths(ms, n);
    case 'quarter':
      return addMonths(ms, n * 3);
    case 'workday':
      return addWorkingDays(ms, n, settings.holidays);
    default:
      return ms + n * MS_DAY;
  }
}

function snapLargeMultiplier(mode) {
  return mode === 'week' ? 4 : mode === 'month' || mode === 'quarter' ? 3 : 7;
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

  // A press on the striped baseline area is a request to say why the plan
  // moved, and it is answered before anything else here: the handlers below
  // would take it for a press on empty canvas and start a marquee.
  const reasonEl = closestData(e.target, 'reasonFor', dom.canvas);
  if (reasonEl && e.button === 0 && !spaceHeld && tool !== 'pan') {
    e.preventDefault();
    openReasonEditor(reasonEl.dataset.reasonFor);
    return;
  }
  // Clicking away from an open field saves it, the way leaving any other input
  // does. `blur` alone would not: this press lands before it, and the handlers
  // below would tear the canvas down underneath the field first.
  commitReason();

  // Object and handle presses call preventDefault to stop text selection,
  // which also suppresses the focus change a click would normally make. Left
  // alone, focus would stay in whatever toolbar dropdown or panel field was
  // last touched, and every keyboard shortcut would quietly stop working.
  if (!dom.canvas.contains(document.activeElement)) {
    dom.canvas.focus({ preventScroll: true });
  }

  // Middle button, space-drag or the pan tool always pans.
  if (e.button === 1 || spaceHeld || tool === 'pan') {
    e.preventDefault();
    startPan(point);
    return;
  }

  // By target first, then by point: a dependency already drawn out of this
  // anchor is painted over it, so the press lands on the line rather than the
  // handle — and drawing a second dependency from the same edge has to keep
  // working.
  const anchorEl = closestData(e.target, 'anchor', dom.canvas) || anchorUnder(e);
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
  // The striped area belongs to the reason editor, which the first click of
  // this pair already opened. Without this, the second click would read as a
  // double-click on empty canvas and offer to create an object there.
  if (closestData(e.target, 'reasonFor', dom.canvas)) return;

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
    return;
  }

  // Objects paint over the connector layer, so this is only reached when the
  // click landed on empty canvas or a connector showing through a gap.
  const linkEl = closestData(e.target, 'linkId', dom.canvas);
  if (linkEl) {
    const id = linkEl.dataset.linkId;
    store.clearSelection();
    renderer.setSelectedLinks([id]);
    emit('canvas:contextmenu', { target: 'link', id, clientX: e.clientX, clientY: e.clientY });
    return;
  }

  emit('canvas:contextmenu', {
    target: 'canvas',
    ms: snapDate(viewport.pxToMs(point.x)),
    laneId: laneEntry?.id || null,
    clientX: e.clientX,
    clientY: e.clientY,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Why the plan moved
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Type the reason for a change straight into the striped area.
 *
 * A comparison already says *what* moved and by how many days; the reason is
 * the one part of it nothing can derive, and the place to ask for it is the
 * shape the reader is looking at. So the editor opens over the ghost itself —
 * over the note beneath it once there is one — rather than in a dialog with the
 * plan hidden behind it.
 *
 * The field is transient by design: it commits on Enter or on losing focus,
 * abandons on Escape, and writes through `store.setDelayReason`, so one undo
 * takes the sentence back like any other edit. Nothing about it is stored on
 * the layout, which is free to reflow underneath the moment it closes.
 */
let reasonEditor = null;

function openReasonEditor(objectId) {
  // Moving from one striped area to the next saves the first, rather than
  // quietly dropping what was typed into it.
  commitReason();

  const baseline = store.activeBaseline();
  const rect = renderer.getLayout()?.byId.get(objectId);
  const ghost = rect?.ghost;
  if (!ghost || !baseline) return;

  // A ghost stands for a real bar, and the question "why did this move" is
  // usually asked with the rest of the activity in front of you — its notes,
  // its dependencies, the P6 activities it is tracked against. So the press
  // selects the object first: the inspector then shows all of it, with the
  // comparison and the same reason field in its Baseline section. That part
  // happens for a viewer too — reading the plan is not a write.
  if (!store.isSelected(objectId)) {
    store.setSelection([objectId]);
    renderer.requestRender();
  }

  // A viewer may read the reason but not write one; the store would refuse the
  // write anyway, and an editor that cannot save is worse than none.
  if (store.isDocReadOnly()) return;

  const box = ghost.reason || ghost;
  const current = ghost.reason ? ghost.reason.text : '';

  const input = el('textarea', {
    class: 'tl-reason-input',
    rows: '2',
    placeholder: 'Why did this move?',
    'aria-label': `Reason ${rect.obj.title} moved from the baseline`,
    spellcheck: 'true',
  });
  input.value = current;
  input.style.left = `${Math.round(box.x)}px`;
  input.style.top = `${Math.round(box.y)}px`;
  input.style.width = `${Math.round(Math.max(200, box.w))}px`;

  // The canvas focuses itself on mousedown and its shortcuts listen on the
  // window, so a press inside the field must not reach either.
  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeReasonEditor();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitReason();
    }
  });
  input.addEventListener('blur', () => commitReason());

  dom.overlay.appendChild(input);
  reasonEditor = { input, objectId, baselineId: baseline.id, original: current };
  input.focus({ preventScroll: true });
  input.select();
}

/** Save what was typed, if it says something different, and close. */
function commitReason() {
  if (!reasonEditor) return;
  const { input, objectId, baselineId, original } = reasonEditor;
  const value = input.value;
  closeReasonEditor();

  if (value.trim() === original.trim()) return;
  if (store.setDelayReason(objectId, baselineId, value)) renderer.requestRender();
}

/** Take the field away without saving. Safe to call when none is open. */
function closeReasonEditor() {
  const open = reasonEditor;
  if (!open) return;
  // Cleared first: removing the node fires `blur`, which would otherwise come
  // straight back in here and commit a field that is already gone.
  reasonEditor = null;
  open.input.remove();
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
  gesture = { kind: 'link', from: id, side, x: point.x, y: point.y, moved: false, targetSide: 'start' };
  dom.canvas.classList.add('connecting');
}

/**
 * Light up the end of the target the link is about to arrive at.
 *
 * Which edge the pointer is over now decides what kind of dependency this
 * becomes, so it has to be visible before the mouse is released — otherwise
 * dropping on the tail of a bar silently produces a different relationship
 * from dropping on its head.
 */
let linkTargetKey = null;

function markLinkTarget(id, side) {
  const key = id ? `${id}:${side}` : null;
  if (key === linkTargetKey) return;

  if (linkTargetKey) {
    const prev = renderer.nodeFor(linkTargetKey.split(':')[0]);
    prev?.classList.remove('link-target');
    prev?.querySelector('.tl-link-end')?.remove();
  }
  linkTargetKey = key;

  const node = id ? renderer.nodeFor(id) : null;
  if (!node) return;
  node.classList.add('link-target');
  node.appendChild(el('div', { class: `tl-link-end ${side === 'end' ? 'at-end' : 'at-start'}` }));
}

/**
 * Which end of the target a dependency was dropped on.
 *
 * The far end of a bar means "finish"; anywhere else means "start", so the
 * ordinary drag onto a bar still produces the finish-to-start link it always
 * did, and reaching for the bar's tail is what asks for the other kind. A point
 * object has one date and therefore only a start to arrive at.
 */
function dropSide(rect, x) {
  if (!rect.hasDuration) return 'start';
  const zone = Math.min(rect.w / 3, 44);
  return x >= rect.right - zone ? 'end' : 'start';
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
      const onTarget = hit && hit.id !== gesture.from ? hit : null;
      gesture.target = onTarget ? onTarget.id : null;
      gesture.targetSide = onTarget ? dropSide(onTarget, point.x) : 'start';
      markLinkTarget(gesture.target, gesture.targetSide);
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

  const targetLaneRecord = laneChange ? store.getLane(laneChange) : null;
  const canChangeLane = targetLaneRecord && !targetLaneRecord.locked && gesture.ids.length === 1;

  store.previewObjects(gesture.ids, (obj) => {
    const original = gesture.originals.get(obj.id);
    if (!original) return false;

    const snapped = snapDate(original.start + deltaMs);
    const shift = snapped - original.start;
    obj.start = original.start + shift;
    if (TYPES[obj.type]?.duration) obj.end = original.end + shift;

    if (canChangeLane) {
      obj.lane = laneChange;
      obj.row = 0; // let the packer re-place it in the new lane
    }
  });

  const first = store.getObject(gesture.ids[0]);
  if (first) {
    const unit = snapLabel();
    renderer.showGuide(viewport.msToPx(first.start), fmtDate(first.start, 'day') + (unit ? ` · snap ${unit}` : ''));
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

  store.previewObjects([gesture.id], (obj) => {
    if (gesture.edge === 'start') {
      const next = snapDate(start + deltaMs);
      // Clamping to the minimum duration can knock the edge off the grid, so
      // snap once more after the clamp rather than leaving a stray date.
      obj.start = next <= obj.end - MS_DAY ? next : snapDate(obj.end - MS_DAY);
    } else {
      const next = snapDate(end + deltaMs);
      obj.end = next >= obj.start + MS_DAY ? next : snapDate(obj.start + MS_DAY);
    }
  });

  const obj = store.getObject(gesture.id);
  if (obj) {
    const edgeMs = gesture.edge === 'start' ? obj.start : obj.end;
    const days = Math.round((obj.end - obj.start) / MS_DAY);
    const unit = snapLabel();
    renderer.showGuide(viewport.msToPx(edgeMs), `${fmtDate(edgeMs, 'day')} · ${days}d${unit ? ` · snap ${unit}` : ''}`);
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
  markLinkTarget(null, null);

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
        // The two edges the user dragged between name the relationship, which
        // is what lets a second arrow join a pair that already has one: the
        // same two bars can be start-to-start and finish-to-finish at once.
        const type = linkTypeBetween(finished.side, finished.targetSide || 'start');
        const created = store.addLink({ from: finished.from, to: finished.target, type });
        if (!created) {
          emit(EV.TOAST, {
            tone: 'warn',
            title: 'Dependency not created',
            message: `These two are already joined ${LINK_TYPES[type]?.short || type}, or the link would create a circular dependency.`,
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
  const height = lane ? lane.height : null;
  // Always unwind the preview: leaving one open would make the next edit diff
  // against a stale snapshot.
  store.cancelPreview();
  if (!lane || height === finished.startHeight) return;
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

/**
 * Move the selection by one snap unit (or several, with `large`).
 * The result is snapped to the grid, so the first press also aligns an object
 * that was sitting off it.
 */
export function nudgeSelection(direction, large = false) {
  const ids = store.getSelection().filter((id) => !store.getObject(id)?.locked);
  if (!ids.length) return;

  store.updateObjects(
    ids,
    (obj) => {
      const stepped = stepBySnap(obj.start, direction, large);
      let next = snapDate(stepped);
      // Snapping must never cancel the movement out entirely.
      if (next === obj.start) next = stepped;
      const shift = next - obj.start;
      return TYPES[obj.type]?.duration ? { start: next, end: obj.end + shift } : { start: next };
    },
    direction > 0 ? 'Move later' : 'Move earlier',
    { mergeKey: 'nudge' }
  );
  renderer.requestRender();
}

/** Grow or shrink the selection's duration by one snap unit. */
export function stretchSelection(direction) {
  const ids = store.getSelection().filter((id) => {
    const obj = store.getObject(id);
    return obj && !obj.locked && TYPES[obj.type]?.duration;
  });
  if (!ids.length) return;

  store.updateObjects(
    ids,
    (obj) => {
      const stepped = stepBySnap(obj.end, direction, false);
      let next = snapDate(stepped);
      if (next === obj.end) next = stepped;
      return { end: Math.max(obj.start + MS_DAY, next) };
    },
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
