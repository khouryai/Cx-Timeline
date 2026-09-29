/**
 * Dock panes.
 *
 * The left dock hosts sixteen panes reached from the sidebar. Each is a small
 * pure-render function over the store; the router below tracks which is
 * showing and re-renders it when the document changes, so no pane has to
 * manage its own subscriptions.
 *
 * Imports: util, events, dates, model, store, storage, filestore, query, analysis,
 *          viewport, renderer, io, icons, components, lists, notes, dialogs,
 *          theme.
 */

import { el, clear, debounce, bytes, download } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import { fmtDate, fmtTimestamp, fmtDuration, toISO, toMs, MS_DAY, DATE_ORDERS } from '../core/dates.js';
import {
  TYPES,
  listOptions,
  typeGroups,
  statusOf,
  subsystemOf,
  durationDays,
  effectiveToday,
  makeBaseline,
  makeProject,
  isDerivedBaseline,
} from '../core/model.js';
import * as store from '../core/store.js';
import { listBackups, loadBackup, deleteBackup, makeBackup, usage, refreshBackupSchedule, isFallback, collectGarbage, switchProject, createCloudProject, isHosted, isFileMode, purgeLocalCopy } from '../core/storage.js';
import * as cloud from '../core/cloud.js';
import * as filestore from '../core/filestore.js';
import * as access from '../core/access.js';
import { search, summarise, facet, filterPredicate } from '../core/query.js';
import { criticalPath, compareBaseline, projectHealth, objectHealth, slipByLane, linkViolations, evaluateLink } from '../core/analysis.js';
import * as viewport from '../timeline/viewport.js';
import * as renderer from '../timeline/renderer.js';
import { icon } from './icons.js';
import {
  field,
  textInput,
  numberInput,
  selectInput,
  checkbox,
  toggle,
  segmented,
  section,
  emptyState,
  badge,
  chipStat,
  confirmDialog,
  promptDialog,
  skeleton,
  toast,
  openModal,
  progressBar,
  contextMenu,
} from './components.js';
import * as cmd from './commands.js';
import { listEditor } from './lists.js';
import { openShareDialog, paneTeam } from './auth.js';
import { paneP6 } from './p6.js';
import { paneLookahead } from './lookahead.js';
import { openObjectDialog, openLaneDialog } from './dialogs.js';
import { THEMES, applyTheme, getTheme } from './theme.js';
import * as exporters from '../io/exporters.js';
import { importFile, buildDocFromRows } from '../io/importers.js';
import { pickFiles } from '../core/util.js';

import { paneLanes, panePalette, paneOutline, paneReleases, paneCampaigns, paneRisks, paneLinks,
  paneBaselines, paneLegendSettings, paneHistory } from './pane_plan.js';
import { paneSearch, paneFilters } from './pane_filters.js';
import { paneIo, exportMenu } from './pane_io.js';
import { paneProjects, paneBackups } from './pane_projects.js';
import { paneSettings, paneLists } from './pane_settings.js';
export const PANES = [
  'projects', 'team', 'p6', 'lookahead', 'lanes', 'palette', 'outline', 'releases', 'campaigns', 'risks', 'links',
  'baselines', 'search', 'filters', 'legend', 'history', 'io', 'backups', 'lists',
  'settings',
];

let dockEl = null;
let bodyEl = null;
let headEl = null;
let active = 'lanes';
/** Set when a rebuild was suppressed because the user was mid-edit. */
let pendingRender = false;

/**
 * True when focus is in a text-entry control inside the dock.
 *
 * Panes write straight to the store as you type, and the store publishes
 * `doc:changed`, which would rebuild the pane and destroy the input under the
 * caret. While the user is typing the pane holds still and the rebuild is
 * deferred until focus leaves. Discrete controls (selects, checkboxes) are
 * excluded so choosing one refreshes the pane immediately.
 */
function isTypingInDock() {
  const active_ = document.activeElement;
  if (!dockEl || !active_ || !dockEl.contains(active_)) return false;
  const tag = active_.tagName.toLowerCase();
  if (tag === 'textarea' || active_.isContentEditable) return true;
  return tag === 'input' && !['checkbox', 'radio', 'color', 'range', 'file'].includes(active_.type);
}

export function buildPanels() {
  dockEl = document.getElementById('dock');
  clear(dockEl);

  headEl = el('div', { class: 'pane-head' });
  bodyEl = el('div', { class: 'dock-body' });
  dockEl.append(headEl, bodyEl);

  const resizer = el('div', { class: 'resizer right' });
  dockEl.appendChild(resizer);
  installResizer(resizer, dockEl, 190, 480);

  dockEl.addEventListener('focusout', () => {
    setTimeout(() => {
      if (pendingRender && !isTypingInDock()) renderPane();
    }, 0);
  });

  const rerender = debounce(() => {
    if (isTypingInDock()) {
      pendingRender = true;
      return;
    }
    renderPane();
  }, 70);
  on(EV.DOC_CHANGED, (p) => {
    if (p?.transient) return;
    rerender();
  });
  on(EV.DOC_REPLACED, rerender);
  on(EV.PANE_OPEN, ({ pane }) => showPane(pane));
  on(EV.PANE_REFRESH, (p) => {
    if (p?.pane && p.pane !== active) return;
    // A pane asking for its own rebuild is subject to the same rule as any
    // other: never replace a text field someone is typing into. Prefer
    // redrawing just the part that changed; this is the backstop.
    if (isTypingInDock()) {
      pendingRender = true;
      return;
    }
    renderPane();
  });
  on(EV.SELECTION_CHANGED, () => {
    if (['outline', 'releases', 'campaigns', 'risks', 'links'].includes(active)) rerender();
  });
  on(EV.FILTER_CHANGED, () => {
    if (active === 'filters' || active === 'search') rerender();
  });
  // Connecting a folder, or a colleague picking up or dropping the pen, changes
  // what the Import / export pane says about where the plan lives.
  on(EV.FILE_STATE, () => {
    if (active === 'io' || active === 'settings') rerender();
  });
  on('ui:focus-search', () => {
    const input = bodyEl.querySelector('[data-search-input]');
    if (input) {
      input.focus();
      input.select();
    }
  });
  on('ui:export-menu', ({ anchor }) => exportMenu(anchor));
  on('ui:print', () => exporters.printPlan());

  showPane(active);
}

export function currentPane() {
  return active;
}

export function showPane(name) {
  if (!PANES.includes(name)) return;
  active = name;
  // Un-collapse the dock when a pane is chosen from the sidebar.
  dockEl.classList.remove('collapsed');
  renderPane();
  emit(EV.PANEL_CHANGED, { pane: name });
}

export function toggleDock() {
  dockEl.classList.toggle('collapsed');
  setTimeout(() => {
    renderer.measure();
    renderer.requestRender();
  }, 40);
}

/* ── Router ────────────────────────────────────────────────────────────── */

const RENDERERS = {
  projects: paneProjects,
  team: paneTeam,
  p6: paneP6,
  lookahead: paneLookahead,
  lanes: paneLanes,
  palette: panePalette,
  outline: paneOutline,
  releases: paneReleases,
  campaigns: paneCampaigns,
  risks: paneRisks,
  links: paneLinks,
  baselines: paneBaselines,
  search: paneSearch,
  filters: paneFilters,
  legend: paneLegendSettings,
  history: paneHistory,
  io: paneIo,
  backups: paneBackups,
  lists: paneLists,
  settings: paneSettings,
};

export const TITLES = {
  projects: 'Projects', team: 'Team & access', p6: 'P6 schedule', lookahead: 'Look-ahead',
  lanes: 'Lanes', palette: 'Add objects', outline: 'Outline', releases: 'Software releases',
  campaigns: 'Commissioning campaigns', risks: 'Risks & issues', links: 'Dependencies',
  baselines: 'Baselines', search: 'Global search', filters: 'Filters', legend: 'Legend',
  history: 'Version history', io: 'Import / export', backups: 'Backups',
  lists: 'Dropdown lists', settings: 'Settings',
};

function renderPane() {
  if (!bodyEl) return;
  pendingRender = false;
  // Keep the reader's place across rebuilds.
  const scroll = bodyEl.querySelector('.pane-scroll')?.scrollTop || 0;

  clear(headEl);
  clear(bodyEl);

  headEl.append(
    el('span', { class: 'ph-title', text: TITLES[active] || active }),
    el('button', {
      class: 'cx-btn icon mini ghost',
      title: 'Hide panel',
      'aria-label': 'Hide panel',
      html: icon('chevron-left', { size: 12 }),
      onClick: toggleDock,
    })
  );

  const pane = el('div', { class: 'pane-scroll' });
  bodyEl.appendChild(pane);
  (RENDERERS[active] || paneLanes)(pane);
  pane.scrollTop = scroll;

  // Dock lists stay single-line for density, so make sure a row that is too
  // narrow for its text still surfaces the whole thing on hover.
  for (const node of pane.querySelectorAll('.lr-title, .lr-meta')) {
    if (!node.title) node.title = node.textContent;
  }
}

export function installResizer(handle, target, min, max) {
  let startX = 0;
  let startWidth = 0;
  let dragging = false;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = target.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = handle.classList.contains('left') ? startX - e.clientX : e.clientX - startX;
    target.style.width = `${Math.max(min, Math.min(max, startWidth + delta))}px`;
    renderer.measure();
    renderer.requestRender();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
  });
}

