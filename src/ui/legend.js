/**
 * Dynamic legend.
 *
 * Generated from what is actually in the document — object types, statuses
 * and subsystems that appear at least once — so it never claims a key that
 * isn't on the chart, and never omits one that is. Clicking an entry filters
 * the timeline to it, which makes the legend a navigation control rather than
 * decoration.
 *
 * Imports: util, events, model, store, query, renderer, icons.
 */

import { el, clear, rafBatch } from '../core/util.js';
import { on, EV } from '../core/events.js';
import { TYPES, listIds, listOptions, statusOf } from '../core/model.js';
import { getDoc, getSettings, getFilters, setFilters } from '../core/store.js';
import { summarise } from '../core/query.js';
import * as renderer from '../timeline/renderer.js';
import { icon } from './icons.js';

let root = null;

export function buildLegend(hostEl) {
  root = el('div', { class: 'tl-legend' });
  hostEl.appendChild(root);

  on(EV.DOC_CHANGED, (p) => {
    if (p?.transient) return;
    scheduleDraw();
  });
  on(EV.DOC_REPLACED, scheduleDraw);
  on(EV.FILTER_CHANGED, scheduleDraw);
  on(EV.THEME_CHANGED, scheduleDraw);

  scheduleDraw();
  return root;
}

const scheduleDraw = rafBatch(() => draw());

function draw() {
  if (!root) return;
  const settings = getSettings();
  root.classList.toggle('hidden', !settings.showLegend);
  if (!settings.showLegend) return;

  const doc = getDoc();
  const stats = summarise(doc);
  const filters = getFilters();
  clear(root);

  root.appendChild(
    el('div', { class: 'tl-legend-title' }, [
      el('span', { text: 'Legend' }),
      el('button', {
        class: 'cx-btn icon mini ghost',
        title: 'Hide legend',
        'aria-label': 'Hide legend',
        html: icon('x', { size: 11 }),
        onClick: () => {
          root.classList.add('hidden');
          settings.showLegend = false;
        },
      }),
    ])
  );

  // Object types present in the plan.
  const typeIds = Array.from(stats.byType.keys()).filter((id) => TYPES[id]);
  if (typeIds.length) {
    root.appendChild(
      group('Object types', typeIds.map((id) => ({
        label: TYPES[id].label,
        color: TYPES[id].accent,
        count: stats.byType.get(id),
        active: !filters.types.length || filters.types.includes(id),
        onClick: () => toggleFilter('types', id),
        icon: TYPES[id].icon,
      })))
    );
  }

  // Statuses present, in canonical order.
  const statusIds = listIds('status').filter((id) => stats.byStatus.has(id));
  if (statusIds.length) {
    root.appendChild(
      group('Status', statusIds.map((id) => ({
        label: statusOf(id).label,
        color: statusOf(id).color,
        count: stats.byStatus.get(id),
        active: !filters.statuses.length || filters.statuses.includes(id),
        onClick: () => toggleFilter('statuses', id),
      })))
    );
  }

  // Subsystems present.
  const subsystemIds = listOptions('subsystem').filter((s) => stats.bySubsystem.has(s.id));
  if (subsystemIds.length) {
    root.appendChild(
      group('Subsystems', subsystemIds.map((s) => ({
        label: s.label,
        color: s.color,
        count: stats.bySubsystem.get(s.id),
        active: !filters.subsystems.length || filters.subsystems.includes(s.id),
        onClick: () => toggleFilter('subsystems', s.id),
      })))
    );
  }

  // Fixed chart keys that are not derived from counts.
  root.appendChild(
    group('Chart', [
      { label: 'Today', color: 'var(--today-line)', plain: true },
      settings.showBaseline ? { label: 'Baseline', color: 'var(--text-subtle)', plain: true } : null,
      settings.criticalPath ? { label: 'Critical path', color: 'var(--bad)', plain: true } : null,
      settings.showConnectors ? { label: 'Dependency', color: 'var(--connector)', plain: true } : null,
    ].filter(Boolean))
  );
}

function group(title, items) {
  return el('div', { class: 'tl-legend-group' }, [
    el('div', { class: 'eyebrow', style: { marginBottom: '5px' }, text: title }),
    el('div', { class: 'tl-legend-items' }, items.map(itemRow)),
  ]);
}

function itemRow(item) {
  const node = el('div', {
    class: 'tl-legend-item' + (item.active === false ? ' off' : ''),
    title: item.plain ? item.label : `Click to filter by ${item.label}`,
    onClick: item.onClick || null,
    style: item.plain ? { cursor: 'default' } : {},
  }, [
    el('span', { class: 'cx-dot', style: { background: item.color } }),
    el('span', { text: item.label }),
    item.count != null ? el('span', { class: 'li-count', text: String(item.count) }) : null,
  ]);
  return node;
}

/** Toggle one value in a multi-select filter dimension. */
function toggleFilter(dimension, value) {
  const current = getFilters()[dimension] || [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  setFilters({ [dimension]: next });
  renderer.requestRender();
}
