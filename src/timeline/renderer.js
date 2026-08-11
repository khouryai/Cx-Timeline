/**
 * The renderer — document + viewport → DOM.
 *
 * Objects are real DOM nodes rather than canvas draws. That costs a little
 * raw throughput but buys everything the brief asks for: gradients, pattern
 * fills, shadows, rounded corners, live text, CSS transitions and hit-testing
 * the browser does for us. Virtualisation keeps the node count proportional to
 * what is on screen, not to the size of the plan, so a five-year programme
 * scrolls as smoothly as a five-week one.
 *
 * Element reuse is keyed by object id: a drag updates `style.left` on an
 * existing node instead of rebuilding it, which is what keeps interaction at
 * frame rate.
 *
 * Imports: util, dates, model, store, query, viewport, layout, connectors, icons.
 */

import { el, clear, rafBatch, withAlpha, readableInk, clamp } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { MS_DAY, ticks, fmtDate, toISO, isoWeek, startOfDay } from '../core/dates.js';
import { TYPES, statusOf, objectColor, effectiveToday, durationDays, subsystemOf } from '../core/model.js';
import { getDoc, getSelection, isSelected, getFilters, hasActiveFilters, activeBaseline } from '../core/store.js';
import { filterPredicate } from '../core/query.js';
import { linkViolations, criticalPath, predecessorsOf } from '../core/analysis.js';
import * as viewport from './viewport.js';
import { computeLayout, stageHeight, ROW_HEIGHT } from './layout.js';
import { fontString, textWidth, wrapText, resetTextCache } from './text.js';
import { routeAll, renderConnectors } from './connectors.js';
import { icon } from '../ui/icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** DOM handles, populated by mount(). */
const dom = {
  root: null,
  corner: null,
  ruler: null,
  bandUpper: null,
  bandLower: null,
  gutter: null,
  gutterInner: null,
  canvas: null,
  scroll: null,
  stage: null,
  grid: null,
  laneRows: null,
  objects: null,
  connectors: null,
  overlay: null,
  today: null,
  todayFlag: null,
};

/** id → element, for keyed reuse across frames. */
const objectNodes = new Map();

let lastLayout = null;
let scrollTop = 0;
let mounted = false;

/* ══════════════════════════════════════════════════════════════════════════
   Mount
   ═══════════════════════════════════════════════════════════════════════ */

/** Build the canvas scaffold inside `host` once. */
export function mount(host) {
  clear(host);

  dom.root = el('div', { class: 'tl-root' });

  dom.corner = el('div', { class: 'tl-corner' }, [
    el('div', { class: 'tc-label', text: 'Lanes' }),
    el('div', { class: 'tc-actions' }),
  ]);

  dom.bandUpper = el('div', { class: 'tl-band upper' });
  dom.bandLower = el('div', { class: 'tl-band lower' });
  dom.ruler = el('div', { class: 'tl-ruler' }, [dom.bandUpper, dom.bandLower]);
  dom.todayFlag = el('div', { class: 'tl-today-flag' });
  dom.ruler.appendChild(dom.todayFlag);

  dom.gutterInner = el('div', { class: 'tl-gutter-inner' });
  dom.gutter = el('div', { class: 'tl-gutter' }, [dom.gutterInner]);

  dom.grid = el('div', { class: 'tl-grid' });
  dom.laneRows = el('div', { class: 'tl-lane-rows' });
  dom.objects = el('div', { class: 'tl-objects' });
  dom.connectors = document.createElementNS(SVG_NS, 'svg');
  dom.connectors.setAttribute('class', 'tl-connectors');
  dom.overlay = el('div', { class: 'tl-overlay' });
  dom.today = el('div', { class: 'tl-today' });

  dom.stage = el('div', { class: 'tl-stage' }, [dom.grid, dom.laneRows, dom.connectors, dom.objects, dom.today, dom.overlay]);
  dom.scroll = el('div', { class: 'tl-scroll' }, [dom.stage]);
  // tabindex makes the canvas programmatically focusable: clicking it takes
  // keyboard focus back from the toolbar and panels so shortcuts keep working.
  dom.canvas = el('div', { class: 'tl-canvas', tabindex: '-1' }, [dom.scroll]);

  dom.root.append(dom.corner, dom.ruler, dom.gutter, dom.canvas);
  host.appendChild(dom.root);

  // The gutter mirrors the canvas's vertical scroll so lane labels stay
  // aligned with their rows.
  dom.scroll.addEventListener('scroll', () => {
    scrollTop = dom.scroll.scrollTop;
    dom.gutterInner.style.transform = `translateY(${-scrollTop}px)`;
  });

  mounted = true;
  measure();
  return dom;
}

/** Current DOM handles — interactions and overlays reach in through this. */
export function elements() {
  return dom;
}

export function getScrollTop() {
  return scrollTop;
}

export function getLayout() {
  return lastLayout;
}

/** The DOM node drawn for an object, if it is currently on screen. */
export function elementFor(id) {
  return objectNodes.get(id) || null;
}

/** Tell the viewport how much room it has. */
export function measure() {
  if (!mounted) return;
  const rect = dom.canvas.getBoundingClientRect();
  viewport.setSize(rect.width, rect.height);
}

/* ══════════════════════════════════════════════════════════════════════════
   Render
   ═══════════════════════════════════════════════════════════════════════ */

/** Coalesced render — safe to call as often as you like. */
export const requestRender = rafBatch(() => renderNow());

export function renderNow() {
  if (!mounted) return;
  const doc = getDoc();
  const settings = doc.settings;

  const predicate = hasActiveFilters() ? filterPredicate(doc, getFilters()) : null;
  const layout = computeLayout({ filterFn: predicate, hideFiltered: settings.filterMode === 'hide' });
  lastLayout = layout;

  dom.stage.style.height = `${stageHeight(layout.geometry)}px`;

  const upstream = upstreamHighlight(doc);

  renderRuler(doc, settings);
  renderGutter(layout);
  renderGrid(doc, settings, layout);
  renderLaneRows(layout);
  renderObjects(layout, settings, upstream);
  renderNotes(layout);
  renderBaseline(layout, settings);
  renderLinks(doc, layout, settings, upstream);
  renderToday(doc, settings, layout);
  if (upstream.flash) flashUpstream(upstream.objects);

  emit(EV.RENDER_DONE, { objects: layout.rects.length });
}

/* ── What the selection is waiting on ──────────────────────────────────── */

/** How long the one-shot flash on a new selection runs, in ms. */
const FLASH_MS = 1200;
/** The selection the highlight currently stands for, so the flash fires once. */
let upstreamKey = '';
let flashTimer = null;
/** When the current flash is due to finish — see `flashing` below. */
let flashUntil = 0;

/**
 * The predecessors of the current selection, and how to flash them.
 *
 * Selecting a bar answers "what am I waiting on" — the objects feeding it and
 * the arrows arriving from them stay marked for as long as the selection
 * stands, so it can be read at leisure. The flash is separate and one-shot: it
 * says *where to look*, and repeating it on every frame of a drag would make
 * the canvas unreadable. It fires when the selection changes, which is the
 * moment the answer is new.
 *
 * Two flags, because the two layers behave differently. Object nodes persist
 * across frames, so `flash` tells the one frame where the selection changed to
 * start their animation. The connector layer is rebuilt from scratch every
 * frame, so it gets `flashing` instead — true for the whole window — otherwise
 * the very next repaint (the mouseup after the click that selected, say) would
 * rebuild the arrows without it and cut the flash off after one frame.
 */
function upstreamHighlight(doc) {
  const selection = getSelection();
  const key = selection.slice().sort().join(',');
  const flash = key !== upstreamKey;
  upstreamKey = key;
  if (flash) startFlashWindow();
  return { ...predecessorsOf(doc, selection), flash, flashing: Date.now() < flashUntil };
}

/**
 * Open the flash window, and arrange for it to close itself.
 *
 * The closing repaint is the point: the connector layer only stops asking for
 * the animation when it is next rebuilt, and without this it would carry the
 * request until something else happened to redraw the canvas.
 */
function startFlashWindow() {
  flashUntil = Date.now() + FLASH_MS;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashTimer = null;
    for (const node of objectNodes.values()) node.classList.remove('upstream-flash');
    requestRender();
  }, FLASH_MS + 30);
}

/**
 * Start the flash on the predecessor nodes.
 *
 * Object nodes are reused across frames, so the class has to be taken off and
 * put back for the animation to restart — otherwise selecting two successors of
 * the same bar in turn would flash it only the first time. Reading `offsetWidth`
 * between the two is what forces the style to settle in between.
 */
function flashUpstream(ids) {
  for (const id of ids) {
    const node = objectNodes.get(id);
    if (!node) continue;
    node.classList.remove('upstream-flash');
    void node.offsetWidth;
    node.classList.add('upstream-flash');
  }
}

/* ── Ruler ─────────────────────────────────────────────────────────────── */

function renderRuler(doc, settings) {
  const scale = viewport.currentScale();
  const header = viewport.headerScale();
  const { from, to } = viewport.visibleRange(120);
  const todayIso = toISO(effectiveToday(doc));

  clear(dom.bandUpper);
  clear(dom.bandLower);

  // Upper band — the coarser unit (month over week, quarter over month, …).
  if (header.id !== scale.id) {
    const upper = ticks(header.id, from, to, { weekStart: settings.weekStart });
    const upperFont = fontString({ size: 11, weight: 700, mono: true });
    const upperStride = strideFor(upper, (t) => labelFor(header.id, t), upperFont, 16);

    upper.forEach((tick, i) => {
      const x = viewport.msToPx(tick.start);
      const width = viewport.msToPx(tick.end) - x;
      if (width < 2) return;

      const node = el('div', { class: 'tl-tick major', style: { left: `${x}px`, width: `${width}px` } });
      if (i % upperStride === 0) {
        placeTickLabel(node, x, width, labelFor(header.id, tick), upperFont, { stride: upperStride });
      }
      dom.bandUpper.appendChild(node);
    });
  }

  // Lower band — the working unit.
  const list = ticks(scale.id, from, to, { weekStart: settings.weekStart });
  const lowerFont = fontString({ size: 10, weight: 500, mono: true });
  const stride = strideFor(list, (t) => t.label, lowerFont, 12);

  list.forEach((tick, i) => {
    const x = viewport.msToPx(tick.start);
    const width = viewport.msToPx(tick.end) - x;
    if (width < 1.5) return;

    let cls = 'tl-tick';
    if (tick.major) cls += ' major';
    if (tick.weekend && settings.showWeekends) cls += ' weekend';
    if (scale.id === 'day' && toISO(tick.start) === todayIso) cls += ' today';

    const node = el('div', { class: cls, style: { left: `${x}px`, width: `${width}px` } });

    // Only label every `stride`-th tick. Every label that *is* drawn is drawn
    // in full — labels are never clipped or ellipsised, just spaced out far
    // enough that they cannot collide.
    if (i % stride === 0) {
      placeTickLabel(node, x, width, tick.label, lowerFont, { stride, sub: tick.sub || '' });
    }
    dom.bandLower.appendChild(node);
  });
}

/**
 * Place a ruler tick's label, nudging it into view when the tick starts off
 * the left edge — but only when the visible sliver is genuinely wide enough
 * to hold it.
 *
 * Without that second condition the nudge pushes the label of a mostly
 * off-screen tick rightwards until it prints on top of the next tick's label,
 * which is exactly the overlap this guards against. When it will not fit, the
 * label is dropped: the next tick along still names the period, so nothing is
 * lost, and no text is ever drawn over other text.
 *
 * @returns {boolean} whether the label was drawn.
 */
function placeTickLabel(node, x, width, text, font, { stride = 1, sub = '', gap = 12 } = {}) {
  const inset = 7;
  const subGap = 5; // matches .tk-sub's margin-left

  // Room this label has before the *next labelled* tick begins. Unlabelled
  // ticks in between are just rules, so the text may run over them.
  const reach = width * stride;
  const available = (x < 0 ? x + reach : reach) - inset - gap;

  if (textWidth(text, font) > available) return false;

  if (x < 0) node.style.paddingLeft = `${-x + inset}px`;
  node.appendChild(el('span', { text }));

  // The secondary label (a date under a week, a year under a month) is
  // optional: it only appears when it too fits inside the same reach.
  if (sub && textWidth(text, font) + subGap + textWidth(sub, font) <= available) {
    node.appendChild(el('span', { class: 'tk-sub', text: sub }));
  }
  return true;
}

/**
 * How many ticks to skip between labels so that no two labels can touch.
 *
 * Derived from the measured width of the widest label in view rather than a
 * guessed character count, which is what lets the ruler drop the *number* of
 * labels without ever shortening one.
 */
function strideFor(list, labelOf, font, gap) {
  if (!list.length) return 1;
  const px = viewport.msToPx(list[0].end) - viewport.msToPx(list[0].start);
  if (px <= 0) return 1;

  let widest = 0;
  // Sampling a slice is enough: labels within one scale are near-uniform.
  const step = Math.max(1, Math.floor(list.length / 24));
  for (let i = 0; i < list.length; i += step) {
    widest = Math.max(widest, textWidth(labelOf(list[i]), font));
  }
  return Math.max(1, Math.ceil((widest + gap) / px));
}

function labelFor(scaleId, tick) {
  if (scaleId === 'month') return `${tick.label} ${tick.sub}`;
  if (scaleId === 'quarter') return `${tick.label} ${tick.sub}`;
  if (scaleId === 'week') return `${tick.label} · ${tick.sub}`;
  return tick.label;
}

/* ── Lane gutter ───────────────────────────────────────────────────────── */

function renderGutter(layout) {
  clear(dom.gutterInner);
  const doc = getDoc();

  for (const entry of layout.geometry.lanes) {
    const lane = entry.lane;
    const count = doc.objects.filter((o) => o.lane === lane.id).length;

    const node = el('div', {
      class: 'tl-lane-label' + (lane.locked ? ' locked' : '') + (lane.collapsed ? ' collapsed' : ''),
      style: { height: `${entry.height}px`, color: lane.color },
      dataset: { laneId: lane.id },
    }, [
      el('div', { class: 'll-bar' }),
      el('div', { class: 'll-grip', html: icon('move', { size: 12 }), dataset: { laneDrag: lane.id }, title: 'Drag to reorder' }),
      el('div', { class: 'll-main' }, [
        el('div', { class: 'll-name', style: { color: 'var(--text)' }, text: lane.name }),
        el('div', { class: 'll-meta', text: `${count} item${count === 1 ? '' : 's'}${lane.locked ? ' · locked' : ''}` }),
      ]),
      el('div', { class: 'll-actions' }, [
        el('button', {
          class: 'cx-btn icon mini ghost',
          title: lane.collapsed ? 'Expand lane' : 'Collapse lane',
          'aria-label': lane.collapsed ? 'Expand lane' : 'Collapse lane',
          html: icon(lane.collapsed ? 'chevron-right' : 'chevron-down', { size: 12 }),
          dataset: { laneAction: 'collapse', laneId: lane.id },
        }),
        el('button', {
          class: 'cx-btn icon mini ghost',
          title: 'Lane options',
          'aria-label': 'Lane options',
          html: icon('more', { size: 12 }),
          dataset: { laneAction: 'menu', laneId: lane.id },
        }),
      ]),
      el('div', { class: 'tl-lane-resize', dataset: { laneResize: lane.id } }),
    ]);

    dom.gutterInner.appendChild(node);
  }

  dom.gutterInner.style.transform = `translateY(${-scrollTop}px)`;
}

/* ── Grid ──────────────────────────────────────────────────────────────── */

function renderGrid(doc, settings, layout) {
  clear(dom.grid);
  if (!settings.gridlines && !settings.showWeekends) return;

  const scale = viewport.currentScale();
  const { from, to } = viewport.visibleRange(60);
  const list = ticks(scale.id, from, to, { weekStart: settings.weekStart });
  const spacing = list.length > 1 ? viewport.msToPx(list[1].start) - viewport.msToPx(list[0].start) : 40;

  // Below ~4px between lines the grid reads as noise; drop to the major unit.
  const showMinor = settings.gridlines && spacing >= 4 && settings.gridDensity !== 'major';
  const showMajor = settings.gridlines && settings.gridDensity !== 'off';

  const fragment = document.createDocumentFragment();

  for (const tick of list) {
    const x = Math.round(viewport.msToPx(tick.start));
    if (settings.showWeekends && tick.weekend && scale.id === 'day') {
      const width = viewport.msToPx(tick.end) - viewport.msToPx(tick.start);
      fragment.appendChild(el('div', { class: 'tl-gridband', style: { left: `${x}px`, width: `${width}px` } }));
    }
    if (tick.major ? showMajor : showMinor) {
      fragment.appendChild(el('div', { class: 'tl-gridline' + (tick.major ? ' major' : ''), style: { left: `${x}px` } }));
    }
  }

  dom.grid.appendChild(fragment);
}

/* ── Lane bands ────────────────────────────────────────────────────────── */

function renderLaneRows(layout) {
  clear(dom.laneRows);
  const fragment = document.createDocumentFragment();
  layout.geometry.lanes.forEach((entry, i) => {
    fragment.appendChild(
      el('div', {
        class: 'tl-lane-row' + (i % 2 ? ' alt' : '') + (entry.lane.locked ? ' locked' : ''),
        style: { top: `${entry.y}px`, height: `${entry.height}px` },
        dataset: { laneRow: entry.lane.id },
      })
    );
  });
  dom.laneRows.appendChild(fragment);
}

/* ── Objects ───────────────────────────────────────────────────────────── */

function renderObjects(layout, settings, upstream) {
  const seen = new Set();
  const selection = new Set(getSelection());
  const violations = linkViolations(getDoc());

  for (const rect of layout.rects) {
    seen.add(rect.id);
    let node = objectNodes.get(rect.id);
    if (!node) {
      node = el('div', { class: 'tl-obj', dataset: { objId: rect.id }, tabindex: '0' });
      objectNodes.set(rect.id, node);
      dom.objects.appendChild(node);
    }
    paintObject(node, rect, settings, selection.has(rect.id), violations.objects.get(rect.id) || null, {
      upstream: upstream.objects.has(rect.id),
    });
  }

  // Retire nodes for objects that scrolled out of view or were deleted.
  for (const [id, node] of objectNodes) {
    if (!seen.has(id)) {
      node.remove();
      objectNodes.delete(id);
    }
  }
}

/**
 * Paint one object. Rebuilds the node's inner markup only when the visual
 * signature changes; position and size are always applied directly, which is
 * the path a drag takes.
 */
function paintObject(node, rect, settings, selected, breaches, marks = {}) {
  const obj = rect.obj;
  const def = TYPES[obj.type] || TYPES.activity;
  const style = obj.style || {};
  const color = objectColor(obj, rect.lane);

  // The full, unwrapped label is the object's accessible name and the handle
  // tests and tooling use to find it.
  const fullLabel = [obj.title, obj.subtitle].filter(Boolean).join(' — ');
  node.setAttribute('aria-label', `${def.label}: ${fullLabel}`);
  node.dataset.label = fullLabel;

  node.style.left = `${rect.x}px`;
  node.style.top = `${rect.y}px`;
  node.style.width = `${rect.w}px`;
  node.style.height = `${rect.h}px`;
  // Backdrop shapes live in their own stacking band so a container or a
  // freeze period can never cover the activities drawn inside it, whatever
  // order they were created in.
  const zBase = def.shape === 'container' ? 0 : def.shape === 'band' ? 40 : 100;
  node.style.zIndex = String(zBase + (obj.z || 0));

  const signature = [
    obj.type,
    obj.title,
    obj.status,
    obj.progress,
    obj.icon,
    obj.locked,
    obj.groupId,
    color,
    rect.w < 52,
    rect.dimmed,
    selected,
    settings.showProgress,
    JSON.stringify(style),
    obj.subtitle,
    Math.round(rect.h),
    rect.label.placement,
    rect.label.lines.join('\u0001'),
    rect.label.subLines.join('\u0001'),
    breaches ? breaches.map((b) => `${b.role}:${b.shortfallDays}`).join(',') : '',
    obj.notes ? 1 : 0,
    (obj.attachments || []).length,
  ].join('|');

  if (node.dataset.sig !== signature) {
    node.dataset.sig = signature;
    buildObjectMarkup(node, rect, def, color, settings, breaches);
  }

  // The flash is a transient class the render pass does not own; a repaint in
  // the middle of one (an autosave, a panel edit) must not cut it short.
  node.className = objectClass(rect, def, selected, breaches, marks)
    + (node.classList.contains('upstream-flash') ? ' upstream-flash' : '');
  if (breaches) node.dataset.violated = String(breaches.length);
  else delete node.dataset.violated;
  node.style.setProperty('--obj-radius', `${style.radius ?? 6}px`);
  node.style.opacity = String(style.opacity ?? 1);
  if (style.rotation) node.style.transform = `rotate(${style.rotation}deg)`;
  else node.style.transform = '';
}

function objectClass(rect, def, selected, breaches, marks = {}) {
  let cls = `tl-obj shape-${def.shape}`;
  if (selected) cls += ' selected';
  if (marks.upstream) cls += ' upstream';
  if (rect.obj.locked) cls += ' locked';
  if (rect.dimmed) cls += ' filtered-out';
  if (rect.obj.groupId) cls += ' grouped';
  if (breaches) cls += ' violated';
  return cls;
}

function buildObjectMarkup(node, rect, def, color, settings, breaches) {
  clear(node);
  const obj = rect.obj;
  const style = obj.style || {};
  const shape = def.shape;
  const ink = style.textColor || readableInk(resolveColor(color));

  switch (shape) {
    case 'diamond':
      buildDiamond(node, rect, color, ink);
      break;
    case 'release':
      buildRelease(node, rect, color);
      break;
    case 'marker':
      buildMarker(node, rect, color);
      break;
    case 'sticky':
      buildSticky(node, rect, color);
      break;
    case 'callout':
      buildCallout(node, rect, color, ink);
      break;
    case 'text':
      buildText(node, rect);
      break;
    case 'image':
      buildImage(node, rect);
      break;
    case 'band':
    case 'container':
      buildBand(node, rect, color, shape);
      break;
    case 'shape':
    case 'bar':
    default:
      buildBar(node, rect, color, ink, settings);
      break;
  }

  if (breaches) node.appendChild(violationFlag(breaches));

  // Interaction affordances — only for things the user can actually grab.
  if (!obj.locked && rect.hasDuration && shape !== 'band') {
    node.appendChild(el('div', { class: 'tl-handle left', dataset: { handle: 'start' } }));
    node.appendChild(el('div', { class: 'tl-handle right', dataset: { handle: 'end' } }));
  }
  if (!obj.locked && shape !== 'text' && shape !== 'sticky') {
    node.appendChild(el('div', { class: 'tl-anchor start', dataset: { anchor: 'start' }, title: 'Drag to link' }));
    node.appendChild(el('div', { class: 'tl-anchor end', dataset: { anchor: 'end' }, title: 'Drag to link' }));
  }
}

/**
 * Render a measured label block: one <span> per wrapped line.
 *
 * The layout pass has already decided the wrap points and reserved the space,
 * so nothing here needs to shorten, clip or ellipsise anything — it just
 * prints the lines it was given.
 */
function labelBlock(label, { className = 'ob-textwrap' } = {}) {
  // The line spans are visual fragments of one sentence, so they are hidden
  // from assistive technology; the object node carries the whole string as
  // its accessible name instead.
  const wrap = el('span', { class: className, 'aria-hidden': 'true' });
  for (const line of label.lines) {
    wrap.appendChild(el('span', { class: 'ob-line', text: line }));
  }
  for (const line of label.subLines) {
    wrap.appendChild(el('span', { class: 'ob-line ob-sub', text: line }));
  }
  return wrap;
}

/** Full label placed beside a bar too narrow to hold it. */
function outsideLabel(rect) {
  const node = labelBlock(rect.label, { className: 'ob-outside' });
  node.style.width = `${rect.label.width}px`;
  return node;
}

/** Centred label above or below a point glyph. */
function pointLabel(rect) {
  const label = rect.label;
  const node = labelBlock(label, { className: 'ob-point-label' + (label.placement === 'above' ? ' above' : '') });
  node.style.width = `${label.width}px`;
  return node;
}

/* ── Shape builders ────────────────────────────────────────────────────── */

function buildBar(node, rect, color, ink, settings) {
  const obj = rect.obj;
  const style = obj.style || {};

  const body = el('div', { class: 'ob-body' });
  const fill = el('div', { class: 'ob-fill' });
  applyFill(fill, color, style);
  body.appendChild(fill);

  if (settings.showProgress && TYPES[obj.type]?.progress && obj.progress > 0) {
    body.appendChild(el('div', { class: 'ob-progress', style: { width: `${clamp(obj.progress, 0, 100)}%` } }));
  }

  node.style.background = 'transparent';
  node.style.border = `${style.strokeWidth ?? 1}px solid ${style.stroke || withAlpha(resolveColor(color), 0.55)}`;
  node.style.borderRadius = `${style.radius ?? 6}px`;
  if (style.shadow) node.style.boxShadow = 'var(--shadow-md)';
  node.appendChild(body);

  const label = el('div', { class: 'ob-label' });
  applyTextStyle(label, style, ink);

  if (rect.label.placement === 'outside') {
    // The bar is too narrow to hold its text, so the full label — wrapped,
    // never shortened — sits immediately to its right. The packer reserved
    // that space, so it cannot be overprinted by the next object.
    node.appendChild(outsideLabel(rect));
    if (settings.showProgress && TYPES[obj.type]?.progress && obj.progress > 0 && rect.w > 34) {
      label.appendChild(el('span', { class: 'ob-pct', text: `${Math.round(obj.progress)}%` }));
      node.appendChild(label);
    }
  } else {
    if (obj.icon && rect.w > 34) {
      label.appendChild(el('span', { class: 'ob-icon', html: icon(obj.icon, { size: Math.min(14, rect.h - 6) }) }));
    }
    label.appendChild(labelBlock(rect.label));
    if (settings.showProgress && TYPES[obj.type]?.progress && obj.progress > 0) {
      label.appendChild(el('span', { class: 'ob-pct', text: `${Math.round(obj.progress)}%` }));
    }
    node.appendChild(label);
  }

  appendMarks(node, obj, rect);
}

function buildBand(node, rect, color, shape) {
  const obj = rect.obj;
  const style = obj.style || {};
  const resolved = resolveColor(color);

  const body = el('div', { class: 'ob-body' });
  const fill = el('div', { class: 'ob-fill' });
  applyFill(fill, color, style);
  body.appendChild(fill);

  node.style.background = 'transparent';
  node.style.borderRadius = `${style.radius ?? 6}px`;
  node.style.border = `${style.strokeWidth ?? 1}px ${shape === 'band' ? 'dashed' : 'solid'} ${style.stroke || withAlpha(resolved, 0.6)}`;
  node.appendChild(body);

  const label = el('div', { class: 'ob-label' });
  applyTextStyle(label, style, style.textColor || resolved);
  if (obj.icon) label.appendChild(el('span', { class: 'ob-icon', html: icon(obj.icon, { size: 13 }) }));
  if (rect.label.placement === 'outside') node.appendChild(outsideLabel(rect));
  else label.appendChild(labelBlock(rect.label));
  node.appendChild(label);
}

function buildDiamond(node, rect, color, ink) {
  const obj = rect.obj;
  const resolved = resolveColor(color);
  node.style.background = 'transparent';
  node.style.border = 'none';

  node.appendChild(
    el('div', { class: 'ob-glyph' }, [
      el('div', {
        class: 'ob-diamond',
        style: {
          background: resolved,
          border: `1.5px solid ${obj.style?.stroke || withAlpha(resolved, 0.9)}`,
          boxShadow: obj.style?.shadow ? 'var(--shadow-md)' : 'none',
        },
      }),
    ])
  );
  node.appendChild(pointLabel(rect));
  appendMarks(node, obj, rect);
}

function buildRelease(node, rect, color) {
  const obj = rect.obj;
  const status = statusOf(obj.status);
  const resolved = resolveColor(obj.style?.fill || status.color);
  node.style.background = 'transparent';
  node.style.border = 'none';
  node.style.width = `${Math.max(rect.w, 30)}px`;

  node.appendChild(el('div', { class: 'ob-flag', style: { background: resolved } }));
  node.appendChild(
    el('div', {
      class: 'ob-chip',
      style: {
        background: withAlpha(resolved, 0.18),
        borderColor: withAlpha(resolved, 0.6),
        color: resolved,
      },
    }, [
      el('span', { style: { display: 'flex' }, html: icon(obj.icon || 'package', { size: 11 }) }),
      el('span', { text: obj.data?.version ? `v${obj.data.version}` : obj.title }),
    ])
  );
  node.appendChild(pointLabel(rect));
  appendMarks(node, obj, rect);
}

function buildMarker(node, rect, color) {
  const obj = rect.obj;
  const severity = obj.data?.severity;
  const resolved = resolveColor(
    obj.style?.fill || (severity === 'critical' || severity === 'high' ? 'var(--bad)' : color)
  );
  node.style.background = 'transparent';
  node.style.border = 'none';

  node.appendChild(
    el('div', { class: 'ob-glyph' }, [
      el('div', { class: 'ob-pin', style: { background: resolved, color: readableInk(resolved) } }, [
        el('span', { html: icon(obj.icon || 'alert', { size: 11 }) }),
      ]),
    ])
  );
  node.appendChild(pointLabel(rect));
  appendMarks(node, obj, rect);
}

function buildSticky(node, rect, color) {
  const obj = rect.obj;
  const style = obj.style || {};
  const resolved = resolveColor(style.fill || color);
  node.style.background = 'transparent';
  node.style.border = 'none';
  node.style.borderRadius = `${style.radius ?? 4}px`;

  const body = el('div', { class: 'ob-body', style: { background: resolved, borderRadius: `${style.radius ?? 4}px` } });
  node.appendChild(body);

  const note = el('div', { class: 'ob-note' });
  applyTextStyle(note, style, style.textColor || readableInk(resolved));
  note.appendChild(labelBlock(rect.label));
  node.appendChild(note);
}

function buildCallout(node, rect, color, ink) {
  const obj = rect.obj;
  const style = obj.style || {};
  const resolved = resolveColor(style.fill || color);
  node.style.background = withAlpha(resolved, 0.16);
  node.style.border = `1px solid ${withAlpha(resolved, 0.65)}`;
  node.style.borderRadius = `${style.radius ?? 8}px`;

  const label = el('div', { class: 'ob-label' });
  applyTextStyle(label, style, style.textColor || 'var(--text)');
  if (obj.icon) label.appendChild(el('span', { class: 'ob-icon', html: icon(obj.icon, { size: 13 }) }));
  label.appendChild(labelBlock(rect.label));
  node.appendChild(label);
  node.appendChild(
    el('div', {
      class: 'ob-tail',
      style: { background: withAlpha(resolved, 0.16), borderColor: withAlpha(resolved, 0.65) },
    })
  );
}

function buildText(node, rect) {
  const obj = rect.obj;
  const style = obj.style || {};
  const label = el('div', { class: 'ob-label' });
  applyTextStyle(label, style, style.textColor || 'var(--text)');
  label.appendChild(labelBlock(rect.label));
  node.appendChild(label);
}

function buildImage(node, rect) {
  const obj = rect.obj;
  const style = obj.style || {};
  node.style.borderRadius = `${style.radius ?? 6}px`;
  node.style.border = `${style.strokeWidth ?? 1}px solid ${style.stroke || 'var(--border-strong)'}`;
  node.style.overflow = 'hidden';

  if (obj.data?.src) {
    const img = el('img', { class: 'ob-img', src: obj.data.src, alt: obj.title || 'Image' });
    node.appendChild(img);
  } else {
    node.appendChild(el('div', { class: 'ob-img-missing', html: icon('image', { size: 18 }) }));
  }
}

/**
 * The flag shown on both ends of a broken dependency.
 *
 * Sits outside the bar's top-left corner so it is visible even on a bar only
 * a few pixels wide, and states the worst shortfall in days rather than just
 * asserting that something is wrong.
 */
function violationFlag(breaches) {
  const worst = breaches.reduce((max, b) => Math.max(max, b.shortfallDays), 0);
  const asSuccessor = breaches.some((b) => b.role === 'successor');
  const detail = asSuccessor
    ? `Starts ${worst} day${worst === 1 ? '' : 's'} before its predecessor allows`
    : `Finishes ${worst} day${worst === 1 ? '' : 's'} after its successor starts`;

  // Deliberately not `.ob-flag` — that class is the release shape's coloured
  // pole, and reusing it here restyled every release marker.
  return el('div', {
    class: 'ob-breach',
    title: `Dependency broken — ${detail}`,
    'aria-label': `Dependency broken. ${detail}`,
  }, [
    el('span', { html: icon('warning', { size: 9 }), style: { display: 'flex' } }),
    el('span', { text: `${worst}d` }),
  ]);
}

/** Small indicators: notes, attachments, lock, group membership. */
function appendMarks(node, obj, rect) {
  const marks = [];
  if (obj.notes) marks.push('comment');
  if ((obj.attachments || []).length) marks.push('paperclip');
  if (obj.locked) marks.push('lock');
  if (!marks.length || rect.w < 44) return;

  const strip = el('div', {
    style: {
      position: 'absolute',
      right: '4px',
      top: '2px',
      display: 'flex',
      gap: '3px',
      opacity: '0.75',
      pointerEvents: 'none',
      zIndex: '4',
    },
  });
  for (const name of marks) strip.appendChild(el('span', { html: icon(name, { size: 9 }), style: { display: 'flex' } }));
  node.appendChild(strip);
}

/* ── Style application ─────────────────────────────────────────────────── */

/** Resolve a CSS custom property to a concrete colour for luminance maths. */
function resolveColor(color) {
  if (!color) return '#5b93f5';
  if (!String(color).startsWith('var(')) return color;
  const name = String(color).slice(4, -1).trim();
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || '#5b93f5';
}

/** Background: flat, gradient or pattern fill. */
function applyFill(node, color, style) {
  const resolved = resolveColor(style.fill || color);

  if (style.gradient) {
    node.style.background = `linear-gradient(180deg, ${withAlpha(resolved, 0.95)} 0%, ${withAlpha(resolved, 0.55)} 100%)`;
  } else {
    node.style.background = resolved;
  }

  if (style.pattern && style.pattern !== 'none') {
    const ink = withAlpha(readableInk(resolved) === '#ffffff' ? '#ffffff' : '#000000', 0.22);
    const patterns = {
      stripes: `repeating-linear-gradient(45deg, transparent, transparent 5px, ${ink} 5px, ${ink} 10px)`,
      hatch: `repeating-linear-gradient(-45deg, transparent, transparent 4px, ${ink} 4px, ${ink} 6px)`,
      dots: `radial-gradient(${ink} 1.4px, transparent 1.5px)`,
      grid: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px)`,
    };
    const overlay = patterns[style.pattern];
    if (overlay) {
      node.style.backgroundImage = `${overlay}, ${node.style.background}`;
      if (style.pattern === 'dots') node.style.backgroundSize = '8px 8px, auto';
      if (style.pattern === 'grid') node.style.backgroundSize = '10px 10px, 10px 10px, auto';
    }
  }
}

function applyTextStyle(node, style, ink) {
  node.style.color = ink;
  node.style.fontSize = `${style.fontSize || 12}px`;
  if (style.font) node.style.fontFamily = style.font;
  node.style.fontWeight = style.bold ? '700' : '500';
  node.style.fontStyle = style.italic ? 'italic' : 'normal';
  node.style.textDecoration = style.underline ? 'underline' : 'none';
  node.style.justifyContent = style.align === 'center' ? 'center' : style.align === 'right' ? 'flex-end' : 'flex-start';
  node.style.textAlign = style.align || 'left';
}

/* ── Baseline comparison ───────────────────────────────────────────────── */

/**
 * Where the plan *was*, drawn against where it is now.
 *
 * A baseline is only useful if the difference is obvious at a glance, so this
 * draws three things rather than one marker:
 *
 *   the ghost      the object at its baseline dates, behind the live bar at
 *                  the same height — so the two read as one object that moved,
 *                  not as two unrelated shapes,
 *   the shift      an arrow from the baseline finish to the current finish,
 *                  labelled with the number of days, coloured by direction.
 *                  This is the part that makes a slip legible across a lane,
 *   the reason     what the user typed into the striped area to explain the
 *                  move — the one part of the comparison that cannot be
 *                  derived, and the part a PMO reads first,
 *   what is gone   objects that were in the baseline and are no longer in the
 *                  plan, drawn as hollow outlines where they used to sit.
 *                  Nothing else in the application shows those at all.
 *
 * Everything but the reason is derived from the document and the snapshot on
 * every frame; no comparison state is stored, so it cannot go stale. The
 * reason is stored on the object, and it is placed by `computeLayout` like any
 * other text on the canvas — this only prints what it was handed.
 */
/**
 * The notes objects are showing, drawn under them.
 *
 * Whole, wrapped exactly as `computeLayout` measured them, in the band it
 * reserved — so a note can no more land on a neighbour than a label can, and
 * none of it is ever shortened to fit. Rebuilt each frame like the comparison:
 * a note is text on the canvas, not a node with state to keep.
 */
function renderNotes(layout) {
  dom.overlay.querySelectorAll('.tl-note').forEach((n) => n.remove());

  const fragment = document.createDocumentFragment();
  for (const rect of layout.rects) {
    const note = rect.note;
    if (!note || rect.dimmed) continue;

    const node = el('div', {
      class: 'tl-note',
      'data-note-for': rect.obj.id,
      'aria-label': `${rect.obj.title} — note: ${note.text}`,
      title: note.text,
      style: {
        left: `${note.x}px`,
        top: `${note.y}px`,
        width: `${note.w}px`,
        height: `${note.h}px`,
      },
    });
    for (const line of note.lines) {
      node.appendChild(el('span', { class: 'tn-line', text: line, 'aria-hidden': 'true' }));
    }
    fragment.appendChild(node);
  }
  dom.overlay.appendChild(fragment);
}

function renderBaseline(layout, settings) {
  dom.overlay
    .querySelectorAll('.tl-baseline, .tl-shift, .tl-baseline-gone, .tl-baseline-reason')
    .forEach((n) => n.remove());
  const banner = dom.root?.querySelector('.tl-baseline-bar');

  const baseline = settings.showBaseline ? activeBaseline() : null;
  if (!baseline) {
    banner?.remove();
    return;
  }

  const fragment = document.createDocumentFragment();
  const counts = { slip: 0, ahead: 0, reshaped: 0, gone: 0 };

  // Every rectangle here was measured and packed by `computeLayout` — including
  // the ghosts, which is why nothing below has to ask whether it fits.
  for (const rect of layout.rects) {
    const ghost = rect.ghost;
    if (!ghost) continue;

    const { snap, startShift, endShift } = ghost;
    const tone = endShift > 0 ? 'slip' : endShift < 0 ? 'ahead' : 'reshaped';
    counts[tone]++;

    const reason = ghost.reason;
    const node = el('div', {
      class: `tl-baseline ${tone}${ghost.stacked ? ' stacked' : ''}${reason ? ' annotated' : ''}`,
      // The striped area is where the reason is written, so it is a target
      // rather than decoration; interactions turns a press on it into an
      // editor over this box.
      'data-reason-for': rect.obj.id,
      role: 'button',
      'aria-label': `${rect.obj.title} — ${reason ? `reason: ${reason.text}` : 'add a reason for this change'}`,
      style: {
        left: `${ghost.x}px`,
        top: `${ghost.y}px`,
        width: `${ghost.w}px`,
        height: `${ghost.h}px`,
      },
      title: `${baselineTitle(rect.obj, snap, startShift, endShift, rect.hasDuration)}\n${
        reason ? `Reason: ${reason.text}\nClick to edit it.` : 'Click to write the reason for this change.'
      }`,
    });
    if (reason && reason.placement === 'inside') {
      node.appendChild(el('span', { class: 'bl-reason', text: reason.text, 'aria-hidden': 'true' }));
    }
    fragment.appendChild(node);

    // Too long to sit in the striped area: it goes in the band layout reserved
    // along the bottom of the row, wrapped exactly as it was measured.
    if (reason && reason.placement === 'below') {
      fragment.appendChild(reasonNote(rect.obj, reason, tone));
    }

    // The arrow runs between the two finish edges, which is the movement the
    // reader cares about. A reshape (same finish, different start) gets the
    // start edges instead, or there would be nothing to draw. It rides the
    // ghost's own centre line, so a stacked ghost still points at its bar.
    const shift = tone === 'reshaped' ? startShift : endShift;
    const fromX = tone === 'reshaped' ? ghost.x : ghost.x + ghost.w;
    const toX = tone === 'reshaped' ? rect.x : rect.right;
    if (shift) {
      fragment.appendChild(shiftArrow(fromX, toX, ghost.y + ghost.h / 2, shift, tone));
    }
  }

  // Objects the baseline had and the plan no longer does. They have no object
  // to hang off, so layout packs a phantom one into the lane they used to be in
  // — a removed bar gets a row of its own rather than the top of the lane,
  // where it used to sit on top of whatever replaced it.
  for (const item of layout.removed) {
    fragment.appendChild(
      el('div', {
        class: 'tl-baseline-gone',
        style: {
          left: `${item.x}px`,
          top: `${item.y}px`,
          width: `${item.w}px`,
          height: `${item.h}px`,
        },
        title: `Removed since the baseline: ${item.snap.title}`,
      }, [el('span', { class: 'bg-label', text: item.snap.title })])
    );
    counts.gone++;
  }

  dom.overlay.appendChild(fragment);
  renderBaselineBar(baseline, counts);
}

/**
 * A strip naming the baseline and counting the differences.
 *
 * Comparison mode changes what every bar on the canvas means, so it says so
 * rather than leaving the reader to infer it from the hatching.
 */
function renderBaselineBar(baseline, counts) {
  if (!dom.root) return;
  let bar = dom.root.querySelector('.tl-baseline-bar');
  if (!bar) {
    bar = el('div', { class: 'tl-baseline-bar', role: 'status' });
    dom.root.appendChild(bar);
  }
  clear(bar);

  const total = counts.slip + counts.ahead + counts.reshaped + counts.gone;
  bar.append(
    el('span', { class: 'bb-eyebrow', text: 'Baseline' }),
    el('span', { class: 'bb-name', text: baseline.name, title: baseline.name }),
    el('span', { class: 'bb-sep' }),
    ...(total
      ? [
          counts.slip ? el('span', { class: 'bb-stat slip', text: `${counts.slip} slipped` }) : null,
          counts.ahead ? el('span', { class: 'bb-stat ahead', text: `${counts.ahead} ahead` }) : null,
          counts.reshaped ? el('span', { class: 'bb-stat reshaped', text: `${counts.reshaped} reshaped` }) : null,
          counts.gone ? el('span', { class: 'bb-stat gone', text: `${counts.gone} removed` }) : null,
        ].filter(Boolean)
      : [el('span', { class: 'bb-stat none', text: 'unchanged' })])
  );
}

/**
 * The reason for a move, written under the row when it will not fit inside the
 * striped area.
 *
 * One span per measured line, like every other wrapped label on the canvas, so
 * what is drawn is exactly what was measured and nothing is ever shortened to
 * fit. The whole sentence lives on the node as `aria-label`, because the line
 * spans are fragments of it.
 */
function reasonNote(obj, reason, tone) {
  const node = el('div', {
    class: `tl-baseline-reason ${tone}`,
    'data-reason-for': obj.id,
    role: 'button',
    'aria-label': `${obj.title} — reason: ${reason.text}`,
    title: `Reason: ${reason.text}\nClick to edit it.`,
    style: {
      left: `${reason.x}px`,
      top: `${reason.y}px`,
      width: `${reason.w}px`,
      height: `${reason.h}px`,
    },
  });
  for (const line of reason.lines) {
    node.appendChild(el('span', { class: 'br-line', text: line, 'aria-hidden': 'true' }));
  }
  return node;
}

/** A measured arrow between the baseline edge and the current one. */
function shiftArrow(fromX, toX, y, days, tone) {
  const left = Math.min(fromX, toX);
  const width = Math.abs(toX - fromX);
  const label = `${days > 0 ? '+' : '−'}${Math.abs(days)}d`;

  return el('div', {
    class: `tl-shift ${tone} ${toX >= fromX ? 'right' : 'left'}`,
    style: { left: `${left}px`, top: `${y}px`, width: `${Math.max(width, 1)}px` },
  }, [
    el('span', { class: 'sh-line' }),
    el('span', { class: 'sh-head' }),
    // The label is placed outside the line's own box so a short shift still
    // shows its day count rather than clipping it to nothing.
    el('span', { class: 'sh-days', text: label }),
  ]);
}

function baselineTitle(obj, snap, startShift, endShift, hasDuration) {
  const was = hasDuration
    ? `${fmtDate(snap.start, 'medium')} → ${fmtDate(snap.end ?? snap.start, 'medium')}`
    : fmtDate(snap.start, 'medium');
  const moved = [
    startShift ? `starts ${Math.abs(startShift)}d ${startShift > 0 ? 'later' : 'earlier'}` : null,
    hasDuration && endShift ? `finishes ${Math.abs(endShift)}d ${endShift > 0 ? 'later' : 'earlier'}` : null,
  ].filter(Boolean).join(', ');
  return `Baseline: ${was}${moved ? ` — now ${moved}` : ''}`;
}

/* ── Connectors ────────────────────────────────────────────────────────── */

let criticalIds = new Set();

/** Interactions and analysis set the highlighted critical set. */
export function setCriticalIds(ids) {
  criticalIds = ids instanceof Set ? ids : new Set(ids || []);
}

function renderLinks(doc, layout, settings, upstream) {
  if (!settings.showConnectors) {
    while (dom.connectors.firstChild) dom.connectors.removeChild(dom.connectors.firstChild);
    return;
  }
  // Memoised on document identity, so asking every frame of a drag is free
  // once the document has settled.
  const violations = linkViolations(doc);
  // A hidden link stays off the canvas only while it holds — the moment a drag
  // makes it violated it has to be seen, so this checks live rather than
  // trusting the stored flag. `installHiddenLinkGuard()` in main.js clears the
  // flag for good once the gesture commits, which is what makes "hidden" not
  // survive the thing it was hiding turning into a problem.
  const visible = doc.links.filter((l) => !l.hidden || violations.byLink.get(l.id)?.violated);
  const routed = routeAll(visible, layout.byId, settings.connectorStyle, {
    criticalIds: settings.criticalPath ? criticalIds : null,
    violations,
    upstreamIds: upstream.links,
  });
  renderConnectors(dom.connectors, routed, {
    selectedLinkIds: selectedLinks,
    // The connector layer is rebuilt from scratch every frame, so the flash has
    // to be asked for at build time rather than added to a node afterwards.
    flashUpstream: upstream.flashing,
    onSelect: (link, e) => emit('link:select', { link, event: e }),
  });
}

let selectedLinks = new Set();

export function setSelectedLinks(ids) {
  selectedLinks = new Set(ids || []);
  requestRender();
}

export function getSelectedLinks() {
  return Array.from(selectedLinks);
}

/* ── Today marker ──────────────────────────────────────────────────────── */

function renderToday(doc, settings, layout) {
  if (!settings.showToday) {
    dom.today.style.display = 'none';
    dom.todayFlag.style.display = 'none';
    return;
  }

  const simulated = !!settings.todayOverride;
  const ms = effectiveToday(doc);
  const x = viewport.msToPx(ms);

  dom.today.style.display = '';
  dom.today.style.left = `${x}px`;
  dom.today.className = 'tl-today' + (simulated ? ' simulated' : '');

  const onScreen = x > -60 && x < viewport.getWidth() + 60;
  dom.todayFlag.style.display = onScreen ? '' : 'none';
  dom.todayFlag.className = 'tl-today-flag' + (simulated ? ' simulated' : '');
  dom.todayFlag.style.left = `${x}px`;
  dom.todayFlag.textContent = simulated ? `SIMULATED ${fmtDate(ms, 'compact')}` : 'TODAY';
}

/* ── Overlay helpers (marquee, guides, link preview) ───────────────────── */

export function showMarquee(x1, y1, x2, y2) {
  let node = dom.overlay.querySelector('.tl-marquee');
  if (!node) {
    node = el('div', { class: 'tl-marquee' });
    dom.overlay.appendChild(node);
  }
  node.style.left = `${Math.min(x1, x2)}px`;
  node.style.top = `${Math.min(y1, y2)}px`;
  node.style.width = `${Math.abs(x2 - x1)}px`;
  node.style.height = `${Math.abs(y2 - y1)}px`;
}

export function hideMarquee() {
  dom.overlay.querySelector('.tl-marquee')?.remove();
}

/** Vertical guide with a date label, shown while dragging. */
export function showGuide(x, label) {
  let line = dom.overlay.querySelector('.tl-guide');
  let tag = dom.overlay.querySelector('.tl-guide-label');
  if (!line) {
    line = el('div', { class: 'tl-guide' });
    dom.overlay.appendChild(line);
  }
  if (!tag) {
    tag = el('div', { class: 'tl-guide-label' });
    dom.overlay.appendChild(tag);
  }
  line.style.left = `${x}px`;
  tag.style.left = `${x}px`;
  tag.style.top = `${scrollTop + 6}px`;
  tag.textContent = label;
}

export function hideGuide() {
  dom.overlay.querySelector('.tl-guide')?.remove();
  dom.overlay.querySelector('.tl-guide-label')?.remove();
}

/** Dashed path shown while dragging a new dependency. */
export function showLinkPreview(d) {
  let path = dom.connectors.querySelector('.tl-link-preview');
  if (!path) {
    path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'tl-link-preview');
    dom.connectors.appendChild(path);
  }
  path.setAttribute('d', d);
}

export function hideLinkPreview() {
  dom.connectors.querySelector('.tl-link-preview')?.remove();
}

/** Scroll the canvas so an object is comfortably in view. */
export function revealObject(id, { center = true } = {}) {
  const doc = getDoc();
  const obj = doc.objects.find((o) => o.id === id);
  if (!obj) return;

  if (!viewport.rangeVisible(obj.start, obj.end || obj.start, -80)) {
    viewport.centerOn(obj.start + (TYPES[obj.type]?.duration ? (obj.end - obj.start) / 2 : 0), center ? 0.5 : 0.3);
  }

  renderNow();
  const rect = lastLayout?.byId.get(id);
  if (rect) {
    const target = rect.y - dom.scroll.clientHeight / 2 + rect.h / 2;
    dom.scroll.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  const node = objectNodes.get(id);
  if (node) {
    node.classList.add('search-hit');
    setTimeout(() => node.classList.remove('search-hit'), 3200);
  }
}

/** The DOM node currently representing an object, if it is on screen. */
export function nodeFor(id) {
  return objectNodes.get(id) || null;
}

/**
 * Force a rebuild of every object node — used after a theme change.
 * A theme may swap the interface font (Engineering uses the monospace stack),
 * so cached text measurements are discarded at the same time.
 */
export function invalidateAll() {
  resetTextCache();
  for (const node of objectNodes.values()) node.dataset.sig = '';
  requestRender();
}
