/**
 * The application shell: side navigation, toolbar and status bar.
 *
 * The shell owns no document state — it reads the store, renders controls and
 * dispatches actions. Everything it shows updates from events, so a change
 * made in the inspector, by a shortcut or by an import all light up the same
 * indicators.
 *
 * Imports: util, events, dates, model, store, storage, query, viewport,
 *          renderer, icons, components, theme, panels.
 */

import { el, clear, debounce } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import { fmtDate, fmtTimestamp, toISO } from '../core/dates.js';
import { TYPES, typeGroups, effectiveToday, projectExtent } from '../core/model.js';
import * as store from '../core/store.js';
import { isFallback, isHosted } from '../core/storage.js';
import * as cloud from '../core/cloud.js';
import { linkViolations } from '../core/analysis.js';
import * as viewport from '../timeline/viewport.js';
import * as renderer from '../timeline/renderer.js';
import { icon } from './icons.js';
import { contextMenu, popover, closePopover, promptDialog, toast, segmented, keyHint, attachTooltip } from './components.js';
import { THEMES, applyTheme, getTheme } from './theme.js';
import { showPane, currentPane, PANES } from './panels.js';
import { accountBlock, openShareDialog } from './auth.js';

/** Sidebar structure — sections of dock panes. */
const NAV = [
  {
    section: 'Workspace',
    items: [
      { pane: 'projects', label: 'Projects', icon: 'folder', hosted: true },
      { pane: 'lanes', label: 'Lanes', icon: 'layers' },
      { pane: 'palette', label: 'Add Objects', icon: 'plus' },
      { pane: 'outline', label: 'Outline', icon: 'list' },
    ],
  },
  {
    section: 'Plan',
    items: [
      { pane: 'releases', label: 'Releases', icon: 'package' },
      { pane: 'campaigns', label: 'Campaigns', icon: 'target' },
      { pane: 'risks', label: 'Risks & Issues', icon: 'warning' },
      { pane: 'links', label: 'Dependencies', icon: 'link' },
      { pane: 'baselines', label: 'Baselines', icon: 'bookmark' },
    ],
  },
  {
    section: 'Review',
    items: [
      { pane: 'search', label: 'Search', icon: 'search' },
      { pane: 'filters', label: 'Filters', icon: 'filter' },
      { pane: 'legend', label: 'Legend', icon: 'palette' },
      { pane: 'history', label: 'Version History', icon: 'history' },
    ],
  },
  {
    section: 'Data',
    items: [
      { pane: 'io', label: 'Import / Export', icon: 'download' },
      { pane: 'backups', label: 'Backups', icon: 'save' },
      { pane: 'lists', label: 'Dropdown Lists', icon: 'list' },
      { pane: 'settings', label: 'Settings', icon: 'gear' },
    ],
  },
];

const dom = {};

/* ══════════════════════════════════════════════════════════════════════════
   Build
   ═══════════════════════════════════════════════════════════════════════ */

export function buildShell() {
  dom.sidenav = document.getElementById('sidenav');
  dom.toolbar = document.getElementById('toolbar');
  dom.statusbar = document.getElementById('statusbar');

  buildSidenav();
  buildToolbar();
  buildStatusbar();
  wireEvents();
}

/* ── Side navigation ───────────────────────────────────────────────────── */

function buildSidenav() {
  clear(dom.sidenav);
  const doc = store.getDoc();

  dom.sidenav.appendChild(
    el('div', { class: 'sidenav-brand' }, [
      el('div', { class: 'brand-mark' }),
      el('div', { class: 'sidenav-brand-text' }, [
        el('div', { class: 'sidenav-brand-name', text: 'CX Timeline' }),
        el('div', { class: 'sidenav-brand-sub', text: 'Commissioning Planner' }),
      ]),
    ])
  );

  dom.navLinks = el('div', { class: 'sidenav-links' });
  for (const group of NAV) {
    dom.navLinks.appendChild(el('div', { class: 'sidenav-section-label', text: group.section }));
    for (const item of group.items) {
      // Some panes only mean anything with a backend behind them.
      if (item.hosted && !cloud.isConfigured()) continue;
      const link = el('a', {
        class: 'nav-link',
        href: '#',
        dataset: { pane: item.pane },
        onClick: (e) => {
          e.preventDefault();
          showPane(item.pane);
        },
      }, [
        el('span', { class: 'nav-icon', html: icon(item.icon, { size: 16 }) }),
        el('span', { class: 'nav-label', text: item.label }),
        el('span', { class: 'nav-count', dataset: { countFor: item.pane } }),
      ]);
      dom.navLinks.appendChild(link);
    }
  }
  dom.sidenav.appendChild(dom.navLinks);

  dom.sidenav.appendChild(
    el('div', { class: 'sidenav-footer' }, [
      cloud.isConfigured() ? accountBlock() : null,
      el('div', { class: 'sidenav-project-tag', dataset: { projectTag: '1' }, text: doc.programme || doc.client || fallbackTag() }),
      el('button', {
        class: 'cx-btn mini',
        html: icon('maximize', { size: 12 }) + '<span>Present</span>',
        onClick: () => emit(EV.PRESENT_MODE, { on: !document.body.classList.contains('presenting') }),
      }),
    ].filter(Boolean))
  );

  updateNav();
}

/** What to call a project that has not been given a client or programme. */
function fallbackTag() {
  if (!cloud.isConfigured()) return 'Local project';
  return { owner: 'You own this', editor: 'Shared with you', viewer: 'View only' }[cloud.getRole()] || 'Untitled';
}

function updateNav() {
  const doc = store.getDoc();
  const counts = {
    lanes: doc.lanes.length,
    outline: doc.objects.length,
    releases: doc.objects.filter((o) => o.type === 'release').length,
    campaigns: doc.objects.filter((o) => o.type === 'campaign').length,
    risks: doc.objects.filter((o) => o.type === 'risk' || o.type === 'issue').length,
    links: doc.links.length,
    baselines: doc.baselines.length,
  };

  for (const link of dom.navLinks.querySelectorAll('.nav-link')) {
    link.classList.toggle('active', link.dataset.pane === currentPane());
  }
  for (const node of dom.navLinks.querySelectorAll('[data-count-for]')) {
    const value = counts[node.dataset.countFor];
    node.textContent = value ? String(value) : '';
  }

  const tag = dom.sidenav.querySelector('[data-project-tag]');
  if (tag) tag.textContent = doc.programme || doc.client || fallbackTag();
}

/* ── Toolbar ───────────────────────────────────────────────────────────── */

function buildToolbar() {
  clear(dom.toolbar);

  /* Project title */
  dom.title = el('div', { class: 'tb-title', title: 'Click to rename the project' }, [
    el('div', { class: 'tt-name' }),
    el('div', { class: 'tt-meta' }),
  ]);
  dom.title.addEventListener('click', renameProject);
  dom.toolbar.append(dom.title, el('div', { class: 'tb-sep' }));

  /* Undo / redo */
  dom.undoBtn = toolButton('undo', 'Undo', () => store.undo(), 'mod+z');
  dom.redoBtn = toolButton('redo', 'Redo', () => store.redo(), 'mod+shift+z');
  dom.toolbar.append(el('div', { class: 'tb-group editing' }, [dom.undoBtn, dom.redoBtn]), el('div', { class: 'tb-sep' }));

  /* Tools */
  dom.selectBtn = toolButton('cursor', 'Select', () => store.setTool('select'), 'v');
  dom.panBtn = toolButton('hand', 'Pan (or hold Space)', () => store.setTool('pan'), 'h');
  dom.addBtn = el('button', {
    class: 'cx-btn',
    html: icon('plus', { size: 14 }) + '<span>Add</span>' + icon('chevron-down', { size: 11 }),
    onClick: (e) => openAddMenu(e.currentTarget),
  });
  // The Add tool is an editing affordance; select and pan are how a reader
  // moves around, so they stay.
  dom.toolbar.append(
    el('div', { class: 'tb-group' }, [dom.selectBtn, dom.panBtn]),
    el('div', { class: 'tb-group editing' }, [dom.addBtn]),
    el('div', { class: 'tb-sep' })
  );

  /* Scale */
  dom.scaleSeg = segmented({
    value: viewport.currentScale().id,
    options: [
      { value: 'day', label: 'D', title: 'Day scale' },
      { value: 'week', label: 'W', title: 'Week scale' },
      { value: 'month', label: 'M', title: 'Month scale' },
      { value: 'quarter', label: 'Q', title: 'Quarter scale' },
      { value: 'year', label: 'Y', title: 'Year scale' },
    ],
    onChange: (id) => {
      viewport.setScalePreset(id);
      renderer.requestRender();
    },
  });
  dom.toolbar.append(el('div', { class: 'tb-group' }, [dom.scaleSeg]));

  /* Zoom & navigation */
  dom.toolbar.append(
    el('div', { class: 'tb-group' }, [
      toolButton('zoom-out', 'Zoom out', () => {
        viewport.zoomBy(0.7);
        renderer.requestRender();
      }),
      toolButton('zoom-in', 'Zoom in', () => {
        viewport.zoomBy(1.42);
        renderer.requestRender();
      }),
      toolButton('expand', 'Fit whole plan', fitAll, 'mod+0'),
      toolButton('calendar', 'Go to today', goToToday, 't'),
    ]),
    el('div', { class: 'tb-sep' })
  );

  /* Snap */
  dom.snapSelect = el('select', {
    class: 'cx-select mini',
    title: 'Snap dragged dates to…',
    style: { width: '108px' },
    onChange: (e) => store.setSetting('snap', e.target.value, 'Change snapping'),
  });
  for (const [value, label] of [
    ['off', 'No snap'],
    ['day', 'Snap: day'],
    ['workday', 'Snap: workday'],
    ['week', 'Snap: week'],
    ['month', 'Snap: month'],
    ['quarter', 'Snap: quarter'],
  ]) {
    dom.snapSelect.appendChild(el('option', { value, text: label }));
  }
  dom.toolbar.append(el('div', { class: 'tb-group' }, [dom.snapSelect]), el('div', { class: 'tb-sep' }));

  /* View toggles */
  dom.toggles = el('div', { class: 'tb-group' });
  for (const [key, iconName, title] of [
    ['gridlines', 'grid', 'Gridlines'],
    ['showConnectors', 'link', 'Dependency arrows'],
    ['showProgress', 'activity', 'Progress fill'],
    ['criticalPath', 'route', 'Critical path'],
    ['showBaseline', 'compare', 'Baseline comparison'],
    ['showMinimap', 'map', 'Minimap'],
    ['showLegend', 'palette', 'Legend'],
  ]) {
    const button = el('button', {
      class: 'cx-btn icon',
      title,
      'aria-label': title,
      dataset: { toggle: key },
      html: icon(iconName, { size: 14 }),
      onClick: () => {
        store.setSetting(key, !store.getSettings()[key], `Toggle ${title.toLowerCase()}`);
        renderer.requestRender();
      },
    });
    dom.toggles.appendChild(button);
  }
  dom.toolbar.append(dom.toggles, el('div', { class: 'tb-spacer' }));

  /* Right cluster */
  dom.toolbar.append(
    el('div', { class: 'tb-group' }, [
      el('button', {
        class: 'cx-btn icon',
        title: 'Theme',
        'aria-label': 'Choose theme',
        html: icon('palette', { size: 14 }),
        onClick: (e) => openThemeMenu(e.currentTarget),
      }),
      el('button', {
        class: 'cx-btn',
        title: 'Export the plan',
        html: icon('download', { size: 14 }) + '<span>Export</span>',
        onClick: (e) => emit('ui:export-menu', { anchor: e.currentTarget }),
      }),
      el('button', {
        class: 'cx-btn icon',
        title: 'Keyboard shortcuts',
        'aria-label': 'Keyboard shortcuts',
        html: icon('keyboard', { size: 14 }),
        onClick: () => emit('ui:shortcuts'),
      }),
      el('button', {
        class: 'cx-btn icon',
        title: 'Presentation mode',
        'aria-label': 'Presentation mode',
        html: icon('maximize', { size: 14 }),
        onClick: () => emit(EV.PRESENT_MODE, { on: !document.body.classList.contains('presenting') }),
      }),
    ].filter(Boolean))
  );

  refreshToolbar();
}

function toolButton(iconName, title, onClick, key) {
  const button = el('button', {
    class: 'cx-btn icon',
    title: key ? `${title} · ${keyHint(key)}` : title,
    'aria-label': title,
    html: icon(iconName, { size: 14 }),
    onClick,
  });
  return button;
}

function refreshToolbar() {
  const doc = store.getDoc();
  const settings = doc.settings;
  const history = store.historyState();

  dom.title.querySelector('.tt-name').textContent = doc.name;
  dom.title.querySelector('.tt-meta').textContent =
    [doc.client, doc.programme].filter(Boolean).join(' · ') || fallbackTag();

  dom.undoBtn.disabled = !history.canUndo;
  dom.redoBtn.disabled = !history.canRedo;

  const tool = store.getTool();
  dom.selectBtn.classList.toggle('active', tool === 'select');
  dom.panBtn.classList.toggle('active', tool === 'pan');

  dom.snapSelect.value = settings.snap;

  for (const button of dom.toggles.querySelectorAll('[data-toggle]')) {
    button.classList.toggle('active', !!settings[button.dataset.toggle]);
  }

  const scale = viewport.currentScale().id;
  for (const button of dom.scaleSeg.querySelectorAll('button')) {
    const label = button.textContent.trim().toLowerCase();
    const map = { d: 'day', w: 'week', m: 'month', q: 'quarter', y: 'year' };
    button.classList.toggle('active', map[label] === scale);
  }
}

/* ── Add-object menu ───────────────────────────────────────────────────── */

function openAddMenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  const items = [];
  for (const group of typeGroups()) {
    items.push({ heading: group.name });
    for (const type of group.items) {
      items.push({
        label: type.label,
        icon: type.icon,
        onClick: () => {
          store.setTool(type.id);
          toast({ tone: 'info', title: `${type.label} tool`, message: 'Click on the timeline to place it.', timeout: 2600 });
        },
      });
    }
  }
  contextMenu(rect.left, rect.bottom + 4, items);
}

function openThemeMenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  contextMenu(
    rect.left,
    rect.bottom + 4,
    [
      { heading: 'Theme' },
      ...THEMES.map((theme) => ({
        label: theme.label + (theme.id === getTheme() ? '  ✓' : ''),
        icon: theme.icon,
        onClick: () => applyTheme(theme.id),
      })),
    ]
  );
}

/* ── Actions ───────────────────────────────────────────────────────────── */

async function renameProject() {
  const doc = store.getDoc();
  const name = await promptDialog({ title: 'Rename project', label: 'Project name', value: doc.name });
  if (name && name.trim()) store.setMeta({ name: name.trim() }, 'Rename project');
}

export function fitAll() {
  const extent = projectExtent(store.getDoc());
  viewport.fitRange(extent.start, extent.end, 30);
  renderer.requestRender();
}

export function goToToday() {
  viewport.centerOn(effectiveToday(store.getDoc()), 0.42);
  renderer.requestRender();
}

/* ── Status bar ────────────────────────────────────────────────────────── */

function buildStatusbar() {
  clear(dom.statusbar);

  dom.saveDot = el('span', { class: 'sb-dot' });
  dom.saveText = el('span', { text: 'Saved' });
  dom.statusbar.appendChild(el('span', { class: 'sb-item', title: 'Autosave status' }, [dom.saveDot, dom.saveText]));

  dom.countText = el('span', { class: 'sb-item' });
  dom.statusbar.appendChild(dom.countText);

  dom.selText = el('span', { class: 'sb-item' });
  dom.statusbar.appendChild(dom.selText);

  dom.violationText = el('span', {
    class: 'sb-item clickable sb-warn',
    title: 'Show broken dependencies',
    onClick: () => showPane('links'),
  });
  dom.statusbar.appendChild(dom.violationText);

  dom.statusbar.appendChild(el('span', { class: 'sb-spacer' }));

  dom.cursorText = el('span', { class: 'sb-item', title: 'Date under the cursor' });
  dom.statusbar.appendChild(dom.cursorText);

  dom.zoomText = el('span', {
    class: 'sb-item clickable',
    title: 'Fit the whole plan',
    onClick: fitAll,
  });
  dom.statusbar.appendChild(dom.zoomText);

  dom.storageText = el('span', {
    class: 'sb-item clickable',
    title: 'Open storage settings',
    onClick: () => showPane('settings'),
  });
  dom.statusbar.appendChild(dom.storageText);

  refreshStatus();
}

function refreshStatus() {
  const doc = store.getDoc();
  const selection = store.getSelection();
  const zoom = viewport.describeZoom();

  dom.countText.textContent = `${doc.objects.length} objects · ${doc.lanes.length} lanes · ${doc.links.length} links`;
  dom.selText.textContent = selection.length ? `${selection.length} selected` : '';

  const violations = linkViolations(doc);
  dom.violationText.textContent = violations.count
    ? `⚠ ${violations.count} broken ${violations.count === 1 ? 'dependency' : 'dependencies'}`
    : '';
  dom.violationText.style.display = violations.count ? '' : 'none';
  dom.zoomText.textContent = `${zoom.scale} · ${zoom.span}`;
  dom.storageText.textContent = isHosted() ? 'Supabase' : isFallback() ? 'localStorage' : 'IndexedDB';
}

const refreshCursor = debounce((ms) => {
  if (dom.cursorText) dom.cursorText.textContent = Number.isFinite(ms) ? fmtDate(ms, 'dayFull') : '';
}, 30);

function setSaveState(state, at) {
  if (!dom.saveDot) return;
  dom.saveDot.className = 'sb-dot' + (state === 'saving' ? ' saving' : state === 'error' ? ' error' : '');
  dom.saveText.textContent =
    state === 'saving' ? 'Saving…' : state === 'error' ? 'Save failed' : at ? `Saved ${fmtTimestamp(at)}` : 'Saved';
}

/* ── Wiring ────────────────────────────────────────────────────────────── */

function wireEvents() {
  const refresh = debounce(() => {
    refreshToolbar();
    refreshStatus();
    updateNav();
  }, 40);

  on(EV.DOC_CHANGED, (payload) => {
    if (payload?.transient) return;
    refresh();
  });
  on(EV.DOC_REPLACED, refresh);
  on(EV.HISTORY_CHANGED, refresh);
  on(EV.SELECTION_CHANGED, () => refreshStatus());
  on(EV.TOOL_CHANGED, () => refreshToolbar());
  on(EV.VIEW_CHANGED, debounce(() => {
    refreshToolbar();
    refreshStatus();
  }, 60));
  on(EV.PANEL_CHANGED, () => updateNav());

  on(EV.SAVE_START, () => setSaveState('saving'));
  on(EV.SAVE_DONE, (p) => setSaveState('saved', p?.at));
  on(EV.SAVE_ERROR, () => setSaveState('error'));

  on('canvas:cursor', (p) => refreshCursor(p.ms));

  on(EV.PRESENT_MODE, ({ on: enabled }) => {
    document.body.classList.toggle('presenting', enabled);
    setTimeout(() => {
      renderer.measure();
      renderer.requestRender();
    }, 60);
  });
}

/** Public refresh hook for modules that change shell-visible state. */
export function refreshShell() {
  refreshToolbar();
  refreshStatus();
  updateNav();
}
