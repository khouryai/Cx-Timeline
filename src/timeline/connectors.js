/**
 * Dependency connectors.
 *
 * Routes the four precedence relationships (FS, SS, FF, SF) between object
 * rectangles in three styles — orthogonal, curved and straight. Routing is
 * recomputed from the layout every frame, which is what makes connectors
 * follow their activities automatically when anything moves.
 *
 * Imports: model, layout.
 */

import { LINK_TYPES } from '../core/model.js';
import { anchorPoint } from './layout.js';

/** How far a connector stubs out of an activity before turning. */
const STUB = 13;
/** Vertical clearance used when a link has to route backwards. */
const DETOUR = 12;
/** Arrowhead size. */
const ARROW = 6;

/**
 * Compute the SVG path for one link.
 * @returns {{d:string, from:{x,y}, to:{x,y}, mid:{x,y}, arrow:string}|null}
 */
export function routeLink(link, fromRect, toRect, style = 'orthogonal') {
  if (!fromRect || !toRect) return null;

  const spec = LINK_TYPES[link.type] || LINK_TYPES.FS;
  const a = anchorPoint(fromRect, spec.from);
  const b = anchorPoint(toRect, spec.to);
  if (!a || !b) return null;

  // Which way does the connector leave the source and enter the target?
  const outDir = spec.from === 'end' ? 1 : -1;
  const inDir = spec.to === 'start' ? -1 : 1;

  const effective = link.style || style;
  let d;
  let mid;

  if (effective === 'straight') {
    d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  } else if (effective === 'curved') {
    const dx = Math.max(28, Math.abs(b.x - a.x) * 0.45);
    const c1 = { x: a.x + outDir * dx, y: a.y };
    const c2 = { x: b.x + inDir * dx, y: b.y };
    d = `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
    mid = bezierMid(a, c1, c2, b);
  } else {
    const path = orthogonal(a, b, outDir, inDir, fromRect, toRect);
    d = path.d;
    mid = path.mid;
  }

  return { d, from: a, to: b, mid, arrow: arrowHead(b, inDir) };
}

/**
 * Orthogonal (elbow) routing.
 *
 * The easy case is a forward link with room between the two activities: stub
 * out, run vertically at the midpoint, stub in. When the target starts before
 * the source finishes — which happens constantly in a real plan — the route
 * has to double back, so it drops below the taller of the two rows and
 * returns underneath rather than cutting through both bars.
 */
function orthogonal(a, b, outDir, inDir, fromRect, toRect) {
  const startX = a.x + outDir * STUB;
  const endX = b.x + inDir * STUB;
  const points = [];

  const forward = outDir === 1 ? endX > startX : endX < startX;

  if (forward) {
    const midX = (startX + endX) / 2;
    points.push([a.x, a.y], [startX, a.y]);
    if (Math.abs(a.y - b.y) > 1) {
      points.push([midX, a.y], [midX, b.y]);
    }
    points.push([endX, b.y], [b.x, b.y]);
  } else {
    // Route around: leave the source, drop past both rows, come back in.
    const belowA = fromRect.bottom + DETOUR;
    const belowB = toRect.bottom + DETOUR;
    const y = Math.max(belowA, belowB);
    points.push([a.x, a.y], [startX, a.y], [startX, y], [endX, y], [endX, b.y], [b.x, b.y]);
  }

  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p[0])} ${round(p[1])}`).join(' ');
  const mid = midpointOfPolyline(points);
  return { d, mid };
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function midpointOfPolyline(points) {
  let total = 0;
  const lengths = [];
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lengths.push(len);
    total += len;
  }
  let target = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i]) {
      const t = lengths[i] ? target / lengths[i] : 0;
      return {
        x: points[i][0] + (points[i + 1][0] - points[i][0]) * t,
        y: points[i][1] + (points[i + 1][1] - points[i][1]) * t,
      };
    }
    target -= lengths[i];
  }
  return { x: points[0][0], y: points[0][1] };
}

/** Point at t = 0.5 on a cubic Bézier — where the link's label sits. */
function bezierMid(p0, p1, p2, p3) {
  const t = 0.5;
  const mt = 1 - t;
  const at = (k) => mt ** 3 * p0[k] + 3 * mt ** 2 * t * p1[k] + 3 * mt * t ** 2 * p2[k] + t ** 3 * p3[k];
  return { x: at('x'), y: at('y') };
}

/** Filled triangle at the target end, pointing the way the link enters. */
function arrowHead(point, inDir) {
  const tipX = point.x;
  // inDir is -1 when the link arrives from the left, +1 from the right, so
  // the base of the triangle always sits behind the tip.
  const baseX = point.x + inDir * ARROW;
  return `M ${round(tipX)} ${round(point.y)} L ${round(baseX)} ${round(point.y - ARROW * 0.62)} L ${round(baseX)} ${round(point.y + ARROW * 0.62)} Z`;
}

/**
 * Route every link that has both endpoints laid out.
 * Returns render descriptors ready for the SVG layer and the exporters.
 */
export function routeAll(links, layoutById, style = 'orthogonal', { criticalIds = null } = {}) {
  const out = [];
  for (const link of links) {
    const fromRect = layoutById.get(link.from);
    const toRect = layoutById.get(link.to);
    if (!fromRect || !toRect) continue;
    const route = routeLink(link, fromRect, toRect, style);
    if (!route) continue;
    out.push({
      link,
      ...route,
      dimmed: fromRect.dimmed || toRect.dimmed,
      critical: criticalIds ? criticalIds.has(link.from) && criticalIds.has(link.to) : false,
      label: link.label || (link.lag ? `${LINK_TYPES[link.type]?.short || link.type}${link.lag > 0 ? '+' : ''}${link.lag}d` : ''),
    });
  }
  return out;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Render routed connectors into an existing <svg> element. */
export function renderConnectors(svg, routed, { selectedLinkIds = new Set(), onSelect = null } = {}) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  for (const item of routed) {
    const group = document.createElementNS(SVG_NS, 'g');
    group.dataset.linkId = item.link.id;

    // A wide invisible stroke underneath makes thin connectors clickable.
    const hit = document.createElementNS(SVG_NS, 'path');
    hit.setAttribute('d', item.d);
    hit.setAttribute('class', 'tl-link-hit');
    group.appendChild(hit);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', item.d);
    let cls = 'tl-link';
    if (item.critical) cls += ' critical';
    if (item.dimmed) cls += ' dim';
    if (selectedLinkIds.has(item.link.id)) cls += ' selected';
    path.setAttribute('class', cls);
    if (item.link.color) path.setAttribute('stroke', item.link.color);
    group.appendChild(path);

    const arrow = document.createElementNS(SVG_NS, 'path');
    arrow.setAttribute('d', item.arrow);
    arrow.setAttribute('class', cls);
    arrow.setAttribute('fill', item.link.color || 'currentColor');
    arrow.style.fill = item.critical ? 'var(--bad)' : item.link.color || 'var(--connector)';
    arrow.style.stroke = 'none';
    group.appendChild(arrow);

    if (item.label) {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', item.mid.x);
      text.setAttribute('y', item.mid.y - 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'tl-link-label');
      text.textContent = item.label;
      group.appendChild(text);
    }

    if (onSelect) {
      hit.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        onSelect(item.link, e);
      });
    }

    svg.appendChild(group);
  }
}

/** Preview path drawn while the user drags a new dependency. */
export function previewPath(fromRect, side, x, y, style = 'orthogonal') {
  const a = anchorPoint(fromRect, side);
  if (!a) return '';
  if (style === 'straight') return `M ${a.x} ${a.y} L ${x} ${y}`;
  const dir = side === 'end' ? 1 : -1;
  const dx = Math.max(24, Math.abs(x - a.x) * 0.45);
  return `M ${a.x} ${a.y} C ${a.x + dir * dx} ${a.y}, ${x - dir * dx} ${y}, ${x} ${y}`;
}
