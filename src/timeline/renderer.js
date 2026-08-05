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

import { el, clear, rafBatch, escapeHtml, withAlpha, readableInk, clamp, truncate } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { MS_DAY, ticks, fmtDate, toISO, isoWeek, startOfDay } from '../core/dates.js';
import { TYPES, statusOf, objectColor, effectiveToday, durationDays, subsystemOf } from '../core/model.js';
import { getDoc, getSelection, isSelected, getFilters, hasActiveFilters, activeBaseline } from '../core/store.js';
import { filterPredicate } from '../core/query.js';
import * as viewport from './viewport.js';
import { computeLayout, stageHeight, ROW_HEIGHT } from './layout.js';
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
  const layout = computeLayout({ filterFn: predicate });
  lastLayout = layout;

  dom.stage.style.height = `${stageHeight(layout.geometry)}px`;

  renderRuler(doc, settings);
  renderGutter(layout);
  renderGrid(doc, settings, layout);
  renderLaneRows(layout);
  renderObjects(layout, settings);
  renderBaseline(layout, settings);
  renderLinks(doc, layout, settings);
  renderToday(doc, settings, layout);

  emit(EV.RENDER_DONE, { objects: layout.rects.length });
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
    for (const tick of ticks(header.id, from, to, { weekStart: settings.weekStart })) {
      const x = viewport.msToPx(tick.start);
      const width = viewport.msToPx(tick.end) - x;
      if (width < 3) continue;
      const node = el('div', {
        class: 'tl-tick major',
        style: { left: `${x}px`, width: `${width}px` },
      });
      // A tick that begins off the left edge would otherwise have its label
      // scrolled out of the box; nudge the text back into view so the current
      // month/quarter is always readable.
      if (x < 0) node.style.paddingLeft = `${Math.min(-x + 7, width - 46)}px`;
      node.appendChild(el('span', { text: labelFor(header.id, tick) }));
      dom.bandUpper.appendChild(node);
    }
  }

  // Lower band — the working unit.
  const list = ticks(scale.id, from, to, { weekStart: settings.weekStart });
  const stride = strideFor(list, scale.id);
  list.forEach((tick, i) => {
    const x = viewport.msToPx(tick.start);
    const width = viewport.msToPx(tick.end) - x;
    if (width < 1.5) return;

    let cls = 'tl-tick';
    if (tick.major) cls += ' major';
    if (tick.weekend && settings.showWeekends) cls += ' weekend';
    if (scale.id === 'day' && toISO(tick.start) === todayIso) cls += ' today';
    if (width < 26) cls += ' narrow';
    if (stride > 1 && i % stride !== 0) cls += ' hide-label';

    const node = el('div', { class: cls, style: { left: `${x}px`, width: `${width}px` } });
    if (x < 0 && width > 40) node.style.paddingLeft = `${Math.min(-x + 7, width - 34)}px`;
    node.appendChild(el('span', { text: tick.label }));
    if (tick.sub && width > 62) node.appendChild(el('span', { class: 'tk-sub', text: tick.sub }));
    dom.bandLower.appendChild(node);
  });
}

/** Thin out labels when ticks get too dense to read. */
function strideFor(list, scaleId) {
  if (!list.length) return 1;
  const px = viewport.msToPx(list[0].end) - viewport.msToPx(list[0].start);
  const need = scaleId === 'day' ? 22 : 34;
  return px >= need ? 1 : Math.ceil(need / Math.max(px, 1));
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
        el('div', { class: 'll-name', style: { color: 'var(--text)' }, text: lane.name, title: lane.name }),
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

function renderObjects(layout, settings) {
  const seen = new Set();
  const selection = new Set(getSelection());

  for (const rect of layout.rects) {
    seen.add(rect.id);
    let node = objectNodes.get(rect.id);
    if (!node) {
      node = el('div', { class: 'tl-obj', dataset: { objId: rect.id }, tabindex: '0' });
      objectNodes.set(rect.id, node);
      dom.objects.appendChild(node);
    }
    paintObject(node, rect, settings, selection.has(rect.id));
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
function paintObject(node, rect, settings, selected) {
  const obj = rect.obj;
  const def = TYPES[obj.type] || TYPES.activity;
  const style = obj.style || {};
  const color = objectColor(obj, rect.lane);

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
    Math.round(rect.w / 8),
    obj.notes ? 1 : 0,
    (obj.attachments || []).length,
  ].join('|');

  if (node.dataset.sig !== signature) {
    node.dataset.sig = signature;
    buildObjectMarkup(node, rect, def, color, settings);
  }

  node.className = objectClass(rect, def, selected);
  node.style.setProperty('--obj-radius', `${style.radius ?? 6}px`);
  node.style.opacity = String(style.opacity ?? 1);
  if (style.rotation) node.style.transform = `rotate(${style.rotation}deg)`;
  else node.style.transform = '';
}

function objectClass(rect, def, selected) {
  let cls = `tl-obj shape-${def.shape}`;
  if (selected) cls += ' selected';
  if (rect.obj.locked) cls += ' locked';
  if (rect.dimmed) cls += ' filtered-out';
  if (rect.obj.groupId) cls += ' grouped';
  return cls;
}

function buildObjectMarkup(node, rect, def, color, settings) {
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
 * Title, plus the subtitle when the object has one and the bar has room.
 *
 * A tall bar stacks the two lines; a short but wide one runs them together
 * with the subtitle dimmed, which keeps the extra context visible without
 * pushing the title out of the bar.
 */
function titleBlock(obj, rect, style) {
  const subtitle = (obj.subtitle || '').trim();
  const fontSize = style.fontSize || 12;

  if (!subtitle) return el('span', { class: 'ob-text', text: obj.title });

  const stacked = rect.h >= fontSize * 2 + 8 && rect.w > 64;
  if (stacked) {
    return el('span', { class: 'ob-textwrap' }, [
      el('span', { class: 'ob-text', text: obj.title }),
      el('span', { class: 'ob-sub', text: subtitle }),
    ]);
  }

  if (rect.w > 130) {
    return el('span', { class: 'ob-textwrap inline' }, [
      el('span', { class: 'ob-text', text: obj.title }),
      el('span', { class: 'ob-sub', text: subtitle }),
    ]);
  }

  return el('span', { class: 'ob-text', text: obj.title, title: `${obj.title} — ${subtitle}` });
}

/** Label drawn beside a bar too narrow to hold text. */
function outsideText(obj) {
  const subtitle = (obj.subtitle || '').trim();
  return subtitle ? `${obj.title} · ${subtitle}` : obj.title;
}

/** Two-line label under a milestone, release flag or risk pin. */
function pointLabel(obj, { above = false, max = 34 } = {}) {
  const subtitle = (obj.subtitle || '').trim();
  const node = el('div', { class: 'ob-point-label' + (above ? ' above' : '') }, [
    el('span', { text: truncate(obj.title, max) }),
  ]);
  if (subtitle) node.appendChild(el('span', { class: 'ob-sub', text: truncate(subtitle, max) }));
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

  if (obj.icon && rect.w > 34) {
    label.appendChild(el('span', { class: 'ob-icon', html: icon(obj.icon, { size: Math.min(14, rect.h - 6) }) }));
  }
  label.appendChild(titleBlock(obj, rect, style));
  if (settings.showProgress && TYPES[obj.type]?.progress && rect.w > 86 && obj.progress > 0) {
    label.appendChild(el('span', { class: 'ob-pct', text: `${Math.round(obj.progress)}%` }));
  }

  if (rect.labelOutside) {
    node.appendChild(el('div', { class: 'ob-outside', text: outsideText(obj) }));
  } else {
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
  label.appendChild(titleBlock(obj, rect, style));
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
  node.appendChild(pointLabel(obj, { max: 30 }));
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
  // The title normally sits above the chip, but on the topmost row that would
  // slide under the ruler — drop it below instead.
  node.appendChild(pointLabel(obj, { above: rect.y > 22, max: 26 }));
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
  node.appendChild(pointLabel(obj, { max: 34 }));
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
  note.appendChild(el('span', { text: obj.title }));
  if ((obj.subtitle || '').trim()) {
    note.appendChild(el('span', { class: 'ob-sub', style: { display: 'block', marginTop: '2px' }, text: obj.subtitle }));
  }
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
  label.appendChild(titleBlock(obj, rect, style));
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
  label.appendChild(titleBlock(obj, rect, style));
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

/* ── Baseline ghosts ───────────────────────────────────────────────────── */

function renderBaseline(layout, settings) {
  const existing = dom.overlay.querySelectorAll('.tl-baseline, .tl-slip-arrow');
  existing.forEach((n) => n.remove());
  if (!settings.showBaseline) return;

  const baseline = activeBaseline();
  if (!baseline) return;

  const snapshot = new Map(baseline.snapshot.map((s) => [s.id, s]));
  const fragment = document.createDocumentFragment();

  for (const rect of layout.rects) {
    const snap = snapshot.get(rect.id);
    if (!snap) continue;
    const startShift = rect.obj.start - snap.start;
    const endShift = (rect.obj.end ?? rect.obj.start) - (snap.end ?? snap.start);
    if (!startShift && !endShift) continue;

    const x = viewport.msToPx(snap.start);
    const width = TYPES[rect.obj.type]?.duration
      ? Math.max(4, viewport.msToPx(snap.end) - x)
      : 14;
    const slipped = endShift > 0;

    fragment.appendChild(
      el('div', {
        class: 'tl-baseline ' + (slipped ? 'slip' : 'ahead'),
        style: {
          left: `${TYPES[rect.obj.type]?.duration ? x : x - 7}px`,
          width: `${width}px`,
          top: `${rect.y + rect.h + 2}px`,
          height: '6px',
        },
        title: `Baseline: ${fmtDate(snap.start, 'medium')}${TYPES[rect.obj.type]?.duration ? ' → ' + fmtDate(snap.end, 'medium') : ''}`,
      })
    );
  }

  dom.overlay.appendChild(fragment);
}

/* ── Connectors ────────────────────────────────────────────────────────── */

let criticalIds = new Set();

/** Interactions and analysis set the highlighted critical set. */
export function setCriticalIds(ids) {
  criticalIds = ids instanceof Set ? ids : new Set(ids || []);
}

function renderLinks(doc, layout, settings) {
  if (!settings.showConnectors) {
    while (dom.connectors.firstChild) dom.connectors.removeChild(dom.connectors.firstChild);
    return;
  }
  const routed = routeAll(doc.links, layout.byId, settings.connectorStyle, {
    criticalIds: settings.criticalPath ? criticalIds : null,
  });
  renderConnectors(dom.connectors, routed, {
    selectedLinkIds: selectedLinks,
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

/** Force a rebuild of every object node — used after a theme change. */
export function invalidateAll() {
  for (const node of objectNodes.values()) node.dataset.sig = '';
  requestRender();
}
