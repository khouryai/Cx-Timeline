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
import { search, summarise, facet, filterPredicate } from '../core/query.js';
import { criticalPath, compareBaseline, programmeHealth, objectHealth, slipByLane, linkViolations, evaluateLink } from '../core/analysis.js';
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
import { openObjectDialog, openLaneDialog } from './dialogs.js';
import { THEMES, applyTheme, getTheme } from './theme.js';
import * as exporters from '../io/exporters.js';
import { importFile, buildDocFromRows } from '../io/importers.js';
import { pickFiles } from '../core/util.js';

export const PANES = [
  'projects', 'team', 'p6', 'lanes', 'palette', 'outline', 'releases', 'campaigns', 'risks', 'links',
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

const TITLES = {
  projects: 'Projects', team: 'Team & access', p6: 'P6 schedule',
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

/* ══════════════════════════════════════════════════════════════════════════
   Lanes
   ═══════════════════════════════════════════════════════════════════════ */

function paneLanes(root) {
  const doc = store.getDoc();
  const list = el('div', { class: 'cx-list' });

  doc.laneOrder.forEach((laneId, index) => {
    const lane = store.getLane(laneId);
    if (!lane) return;
    const count = doc.objects.filter((o) => o.lane === laneId).length;

    list.appendChild(
      el('div', { class: 'cx-listrow' }, [
        el('span', { class: 'cx-dot', style: { background: lane.color } }),
        el('div', { class: 'lr-main', onClick: () => openLaneDialog(laneId) }, [
          el('div', { class: 'lr-title', text: lane.name }),
          el('div', { class: 'lr-meta', text: `${count} item${count === 1 ? '' : 's'}${lane.locked ? ' · locked' : ''}${lane.hidden ? ' · hidden' : ''}` }),
        ]),
        el('div', { class: 'lr-actions' }, [
          iconBtn(lane.hidden ? 'eye-off' : 'eye', lane.hidden ? 'Show lane' : 'Hide lane', () => {
            store.updateLane(laneId, { hidden: !lane.hidden }, 'Toggle lane visibility');
            renderer.requestRender();
          }),
          iconBtn(lane.locked ? 'lock' : 'unlock', lane.locked ? 'Unlock lane' : 'Lock lane', () => {
            store.updateLane(laneId, { locked: !lane.locked }, 'Toggle lane lock');
            renderer.requestRender();
          }),
          iconBtn('chevron-up', 'Move up', () => {
            store.moveLane(laneId, index - 1);
            renderer.requestRender();
          }),
          iconBtn('chevron-down', 'Move down', () => {
            store.moveLane(laneId, index + 1);
            renderer.requestRender();
          }),
          iconBtn('more', 'Lane options', (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            emit('lane:menu', { id: laneId, clientX: rect.left, clientY: rect.bottom + 4 });
          }),
        ]),
      ])
    );
  });

  if (!doc.lanes.length) {
    root.appendChild(emptyState({ iconName: 'layers', title: 'No lanes yet', message: 'Lanes are the horizontal rows of your plan — one per subsystem, team or workstream.' }));
  } else {
    root.appendChild(list);
  }

  root.appendChild(
    el('div', { style: { marginTop: '10px', display: 'flex', gap: '6px' } }, [
      el('button', { class: 'cx-btn mini', html: icon('plus', { size: 12 }) + '<span>Add lane</span>', onClick: () => cmd.addLane() }),
      el('button', { class: 'cx-btn mini', html: icon('package', { size: 12 }) + '<span>Standard set</span>', title: 'Add the standard rail signalling lanes', onClick: addStandardLanes }),
    ])
  );
}

function addStandardLanes() {
  const existing = new Set(store.getDoc().lanes.map((l) => l.name.toLowerCase()));
  const standard = [
    ['Software Releases', '#5b93f5'], ['Regression Testing', '#a855f7'], ['ATS', '#3a76e8'],
    ['IXL', '#9333d9'], ['SCADA', '#0d9488'], ['Communications', '#0ea5e9'],
    ['Wayside', '#e0900b'], ['Vehicle', '#e51b22'], ['Commissioning', '#16a571'],
    ['Customer', '#64748b'], ['Risks & Issues', '#f97316'],
  ].filter(([name]) => !existing.has(name.toLowerCase()));

  if (!standard.length) {
    toast({ tone: 'info', title: 'All standard lanes already exist' });
    return;
  }
  for (const [name, color] of standard) store.addLane({ name, color });
  renderer.requestRender();
  toast({ tone: 'good', title: `${standard.length} lanes added` });
}

/* ══════════════════════════════════════════════════════════════════════════
   Object palette
   ═══════════════════════════════════════════════════════════════════════ */

function panePalette(root) {
  root.appendChild(el('div', { class: 'cx-hint', style: { marginBottom: '10px' }, text: 'Pick a tool, then click on the timeline to place it. Double-clicking empty canvas always creates an activity.' }));

  for (const group of typeGroups()) {
    const grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' } });
    for (const type of group.items) {
      grid.appendChild(
        el('button', {
          class: 'cx-btn mini' + (store.getTool() === type.id ? ' active' : ''),
          style: { justifyContent: 'flex-start' },
          title: `${type.label} — click the timeline to place`,
          html: icon(type.icon, { size: 13 }) + `<span style="overflow:hidden;text-overflow:ellipsis">${type.label}</span>`,
          onClick: () => {
            store.setTool(type.id);
            renderPane();
            toast({ tone: 'info', title: `${type.label} tool`, message: 'Click the timeline to place it.', timeout: 2400 });
          },
        })
      );
    }
    root.appendChild(section(group.name, [grid]));
  }

  root.appendChild(
    el('div', { style: { marginTop: '10px' } }, [
      el('button', {
        class: 'cx-btn mini',
        html: icon('cursor', { size: 12 }) + '<span>Back to select tool</span>',
        onClick: () => {
          store.setTool('select');
          renderPane();
        },
      }),
    ])
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Outline / registers
   ═══════════════════════════════════════════════════════════════════════ */

function paneOutline(root) {
  const doc = store.getDoc();
  renderObjectRegister(root, doc.objects, {
    emptyTitle: 'No objects yet',
    emptyMessage: 'Add activities, milestones and releases from the Add menu or by double-clicking the timeline.',
    groupByLane: true,
  });
}

function paneReleases(root) {
  const doc = store.getDoc();
  const releases = doc.objects.filter((o) => o.type === 'release').sort((a, b) => a.start - b.start);

  const counts = {};
  for (const r of releases) counts[r.status] = (counts[r.status] || 0) + 1;

  root.appendChild(
    el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' } },
      Object.entries(counts).map(([status, n]) => chipStat(statusOf(status).label, n, toneOf(status))))
  );

  renderObjectRegister(root, releases, {
    emptyTitle: 'No software releases',
    emptyMessage: 'Add a release object to track versions, builds, deployment dates and approvals.',
    subtitle: (o) => [o.data?.version ? `v${o.data.version}` : null, o.data?.buildNumber, o.owner].filter(Boolean).join(' · '),
    action: { label: 'Add release', onClick: () => cmd.createObject('release') },
  });
}

function paneCampaigns(root) {
  const doc = store.getDoc();
  const campaigns = doc.objects.filter((o) => o.type === 'campaign' || o.type === 'testwindow').sort((a, b) => a.start - b.start);
  const today = effectiveToday(doc);

  renderObjectRegister(root, campaigns, {
    emptyTitle: 'No campaigns',
    emptyMessage: 'Commissioning campaigns carry an area, subsystem, test package, planned and actual dates.',
    subtitle: (o) => [o.area, o.data?.testPackage, subsystemOf(o.subsystem)?.label, `${Math.round(o.progress)}%`].filter(Boolean).join(' · '),
    showProgress: true,
    action: { label: 'Add campaign', onClick: () => cmd.createObject('campaign') },
  });
}

function paneRisks(root) {
  const doc = store.getDoc();
  const items = doc.objects.filter((o) => o.type === 'risk' || o.type === 'issue').sort((a, b) => severityRank(b) - severityRank(a) || a.start - b.start);

  renderObjectRegister(root, items, {
    emptyTitle: 'No risks or issues',
    emptyMessage: 'Log risks and open issues against the dates they threaten.',
    subtitle: (o) => [o.data?.severity ? o.data.severity.toUpperCase() : null, o.data?.reference, o.owner].filter(Boolean).join(' · '),
    action: { label: 'Add risk', onClick: () => cmd.createObject('risk') },
  });
}

function severityRank(obj) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[obj.data?.severity] || 0;
}

/**
 * Shared register renderer for the outline and the domain panes.
 */
function renderObjectRegister(root, objects, opts = {}) {
  if (!objects.length) {
    root.appendChild(emptyState({
      iconName: 'inbox',
      title: opts.emptyTitle || 'Nothing here yet',
      message: opts.emptyMessage,
      action: opts.action,
    }));
    return;
  }

  const doc = store.getDoc();
  const today = effectiveToday(doc);
  const selection = new Set(store.getSelection());

  const groups = opts.groupByLane
    ? doc.laneOrder
        .map((laneId) => ({ lane: store.getLane(laneId), items: objects.filter((o) => o.lane === laneId) }))
        .filter((g) => g.lane && g.items.length)
    : [{ lane: null, items: objects }];

  for (const group of groups) {
    const list = el('div', { class: 'cx-list' });

    for (const obj of group.items) {
      const health = objectHealth(obj, today);
      const row = el('div', {
        class: 'cx-listrow' + (selection.has(obj.id) ? ' active' : ''),
        onClick: (e) => {
          if (e.target.closest('.lr-actions')) return;
          cmd.revealObject(obj.id);
        },
        onDblclick: () => openObjectDialog(obj.id),
        onContextmenu: (e) => {
          e.preventDefault();
          store.setSelection([obj.id]);
          emit('canvas:contextmenu', { target: 'object', id: obj.id, clientX: e.clientX, clientY: e.clientY });
        },
      }, [
        el('span', { class: 'cx-dot', style: { background: TYPES[obj.type]?.accent || 'var(--neutral)' }, title: TYPES[obj.type]?.label }),
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: obj.title }),
          el('div', { class: 'lr-meta', text: (opts.subtitle ? opts.subtitle(obj) + ' · ' : '') + fmtDate(obj.start, 'compact') + (TYPES[obj.type]?.duration ? ` → ${fmtDate(obj.end, 'compact')}` : '') }),
          opts.showProgress && TYPES[obj.type]?.progress ? progressBar(obj.progress, statusOf(obj.status).color) : null,
        ]),
        healthDot(health),
        el('div', { class: 'lr-actions' }, [
          iconBtn('edit', 'Open editor', () => openObjectDialog(obj.id)),
        ]),
      ]);
      list.appendChild(row);
    }

    if (group.lane) {
      root.appendChild(section(`${group.lane.name}  (${group.items.length})`, [list], { collapsed: false }));
    } else {
      root.appendChild(list);
    }
  }
}

function healthDot(health) {
  const tone =
    health.state === 'overdue' || health.state === 'behind' || health.state === 'late' ? 'var(--bad)'
    : health.state === 'done' || health.state === 'ahead' ? 'var(--good)'
    : health.state === 'ontrack' ? 'var(--info)'
    : 'var(--text-subtle)';
  return el('span', { class: 'cx-dot round', style: { background: tone }, title: health.label });
}

function toneOf(status) {
  return statusOf(status).tone === 'neutral' ? 'muted' : statusOf(status).tone;
}

/* ══════════════════════════════════════════════════════════════════════════
   Dependencies
   ═══════════════════════════════════════════════════════════════════════ */

function paneLinks(root) {
  const doc = store.getDoc();
  const analysis = criticalPath(doc);
  const violations = linkViolations(doc);

  root.appendChild(
    el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' } }, [
      chipStat('Links', doc.links.length, 'info'),
      chipStat('Broken', violations.count, violations.count ? 'bad' : 'good'),
      chipStat('Critical', analysis.critical.size, analysis.critical.size ? 'warn' : 'muted'),
    ])
  );

  if (violations.count) {
    root.appendChild(
      el('div', { class: 'insp-alert', style: { marginBottom: '11px' } }, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
          el('span', { html: icon('warning', { size: 13 }), style: { display: 'flex' } }),
          el('span', { style: { fontWeight: 700 }, text: `${violations.count} broken ${violations.count === 1 ? 'dependency' : 'dependencies'}` }),
        ]),
        el('div', { style: { fontSize: 'var(--fs-tiny)', marginTop: '4px', color: 'var(--text-muted)' }, text: `Worst is ${violations.worst} day${violations.worst === 1 ? '' : 's'} out.` }),
        el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, [
          el('button', { class: 'cx-btn mini', text: 'Show on timeline', onClick: () => cmd.selectViolations() }),
          el('button', { class: 'cx-btn mini primary', text: 'Reschedule all', onClick: () => { cmd.resolveAllViolations(); renderPane(); } }),
        ]),
      ])
    );
  }

  root.appendChild(
    el('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px', marginBottom: '12px' } }, [
      field('Connector style', segmented({
        value: doc.settings.connectorStyle,
        stretch: true,
        options: [
          { value: 'orthogonal', label: 'Elbow' },
          { value: 'curved', label: 'Curved' },
          { value: 'straight', label: 'Straight' },
        ],
        onChange: (v) => {
          store.setSetting('connectorStyle', v, 'Change connector style');
          renderer.requestRender();
        },
      })),
      toggle({
        label: 'Highlight critical path',
        checked: doc.settings.criticalPath,
        onChange: (v) => {
          store.setSetting('criticalPath', v, 'Toggle critical path');
          renderer.setCriticalIds(criticalPath(store.getDoc()).critical);
          renderer.requestRender();
        },
      }),
    ])
  );

  if (!doc.links.length) {
    root.appendChild(emptyState({
      iconName: 'link',
      title: 'No dependencies',
      message: 'Hover an object and drag from its round anchor onto another object to create a link.',
    }));
    return;
  }

  const titles = new Map(doc.objects.map((o) => [o.id, o.title]));
  const list = el('div', { class: 'cx-list' });

  // Broken links first: they are the ones needing a decision.
  const ordered = doc.links
    .slice()
    .sort((a, b) => (violations.links.has(b.id) ? 1 : 0) - (violations.links.has(a.id) ? 1 : 0));

  for (const link of ordered) {
    const critical = analysis.critical.has(link.from) && analysis.critical.has(link.to);
    const evaluated = violations.byLink.get(link.id);
    const broken = !!evaluated?.violated;

    list.appendChild(
      el('div', { class: 'cx-listrow' + (broken ? ' danger' : ''), onClick: () => cmd.revealObject(link.to) }, [
        el('span', {
          style: { display: 'flex', color: broken ? 'var(--bad)' : critical ? 'var(--warn)' : 'var(--text-subtle)' },
          html: icon(broken ? 'warning' : critical ? 'route' : 'link', { size: 12 }),
        }),
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: `${titles.get(link.from) || '?'} → ${titles.get(link.to) || '?'}` }),
          el('div', {
            class: 'lr-meta',
            text: `${link.type}${link.lag ? ` ${link.lag > 0 ? '+' : ''}${link.lag}d` : ''}${
              broken ? ` · broken by ${evaluated.shortfallDays}d` : evaluated ? ` · ${evaluated.slackDays}d slack` : ''
            }${critical ? ' · critical' : ''}`,
          }),
        ]),
        el('div', { class: 'lr-actions' }, [
          broken
            ? iconBtn('refresh', 'Move the successor to the earliest allowed date', () => {
                cmd.resolveViolation(link.id);
                renderPane();
              })
            : null,
          iconBtn('unlink', 'Delete dependency', () => {
            store.removeLinks([link.id]);
            renderer.requestRender();
          }),
        ].filter(Boolean)),
      ])
    );
  }
  root.appendChild(list);
}

/* ══════════════════════════════════════════════════════════════════════════
   Baselines
   ═══════════════════════════════════════════════════════════════════════ */

function paneBaselines(root) {
  const doc = store.getDoc();
  const active_ = store.activeBaseline();

  root.appendChild(
    el('div', { style: { display: 'flex', gap: '6px', marginBottom: '11px' } }, [
      el('button', { class: 'cx-btn mini primary', html: icon('bookmark', { size: 12 }) + '<span>Take baseline</span>', onClick: () => cmd.takeBaseline() }),
      el('button', {
        class: 'cx-btn mini',
        html: icon('download', { size: 12 }) + '<span>Export variance</span>',
        disabled: !active_,
        onClick: () => exporters.exportBaselineCsv(),
      }),
    ])
  );

  if (!doc.baselines.length) {
    root.appendChild(emptyState({
      iconName: 'bookmark',
      title: 'No baselines yet',
      message: 'A baseline freezes the current dates so later slippage can be measured against it.',
    }));
    return;
  }

  const list = el('div', { class: 'cx-list' });
  for (const baseline of doc.baselines.slice().reverse()) {
    list.appendChild(
      el('div', {
        class: 'cx-listrow' + (baseline.id === doc.settings.activeBaseline ? ' active' : ''),
        onClick: () => {
          store.setSetting('activeBaseline', baseline.id, 'Select baseline');
          store.setSetting('showBaseline', true, 'Show baseline');
          renderer.requestRender();
          renderPane();
        },
      }, [
        el('span', { style: { display: 'flex', color: 'var(--text-subtle)' }, html: icon('bookmark', { size: 12 }) }),
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: baseline.name }),
          el('div', { class: 'lr-meta', text: isDerivedBaseline(baseline)
            // A P6 baseline holds no rows: the count is whatever is linked
            // right now, so it is read live rather than from the entry.
            ? `Tracks P6 · ${store.snapshotOf(baseline).length} linked activities`
            : `${fmtTimestamp(baseline.created)} · ${baseline.snapshot.length} objects` }),
        ]),
        el('div', { class: 'lr-actions' }, [
          iconBtn('trash', 'Delete baseline', async () => {
            const ok = await confirmDialog({ title: 'Delete baseline', message: `Delete "${baseline.name}"?`, confirmLabel: 'Delete', danger: true });
            if (ok) {
              store.removeBaseline(baseline.id);
              renderer.requestRender();
              renderPane();
            }
          }),
        ]),
      ])
    );
  }
  root.appendChild(list);

  root.appendChild(
    el('div', { style: { marginTop: '11px' } }, [
      toggle({
        label: 'Show baseline on the timeline',
        checked: doc.settings.showBaseline,
        onChange: (v) => {
          store.setSetting('showBaseline', v, 'Toggle baseline');
          renderer.requestRender();
        },
      }),
    ])
  );

  if (!active_) return;

  /* Variance report */
  const { rows, summary } = compareBaseline(doc, active_);
  root.appendChild(
    el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', margin: '13px 0 8px' } }, [
      chipStat('Slipped', summary.slipped, summary.slipped ? 'bad' : 'muted'),
      chipStat('Ahead', summary.ahead, summary.ahead ? 'good' : 'muted'),
      chipStat('Added', summary.added, 'info'),
      chipStat('Removed', summary.removed, 'muted'),
      summary.worstSlip ? chipStat('Worst', `${summary.worstSlip}d`, 'bad') : null,
    ].filter(Boolean))
  );

  if (!rows.length) {
    root.appendChild(el('div', { class: 'cx-hint', text: 'The plan matches this baseline exactly.' }));
    return;
  }

  const varianceList = el('div', { class: 'cx-list' });
  for (const row of rows.slice(0, 80)) {
    const tone = row.change === 'slip' ? 'var(--bad)' : row.change === 'ahead' ? 'var(--good)' : 'var(--text-subtle)';
    varianceList.appendChild(
      el('div', { class: 'cx-listrow', onClick: () => row.current && cmd.revealObject(row.id) }, [
        el('span', { class: 'cx-dot', style: { background: tone } }),
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: row.title }),
          el('div', { class: 'lr-meta', text: varianceText(row) }),
          // Written into the striped area on the canvas; repeated here because
          // this pane is what gets read out in a review.
          row.reason ? el('div', { class: 'lr-meta', style: { color: 'var(--text)' }, text: `“${row.reason}”` }) : null,
        ].filter(Boolean)),
      ])
    );
  }
  root.appendChild(section(`Variance (${rows.length})`, [varianceList]));
  root.appendChild(el('div', { class: 'cx-hint', text: 'Click the striped baseline area on the timeline to write why something moved.' }));
}

function varianceText(row) {
  if (row.change === 'added') return 'Added since baseline';
  if (row.change === 'removed') return 'Removed since baseline';
  const parts = [];
  if (row.startShift) parts.push(`start ${row.startShift > 0 ? '+' : ''}${row.startShift}d`);
  if (row.endShift) parts.push(`finish ${row.endShift > 0 ? '+' : ''}${row.endShift}d`);
  if (row.durationChange) parts.push(`duration ${row.durationChange > 0 ? '+' : ''}${row.durationChange}d`);
  return parts.join(' · ') || 'Reshaped';
}

/* ══════════════════════════════════════════════════════════════════════════
   Search
   ═══════════════════════════════════════════════════════════════════════ */

function paneSearch(root) {
  const input = textInput({
    value: '',
    placeholder: 'Search titles, notes, owners, versions…',
    type: 'search',
  });
  input.dataset.searchInput = '1';

  const results = el('div', { style: { marginTop: '10px' } });

  const run = debounce(() => {
    clear(results);
    const query = input.value.trim();
    if (!query) {
      results.appendChild(el('div', { class: 'cx-hint', text: 'Searches every object title, note, owner, subsystem, area, tag, version, build and reference in the project.' }));
      return;
    }

    const hits = search(store.getDoc(), query);
    if (!hits.length) {
      results.appendChild(emptyState({ iconName: 'search', title: 'No matches', message: `Nothing in this project matches “${query}”.` }));
      return;
    }

    results.appendChild(el('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: `${hits.length} result${hits.length === 1 ? '' : 's'}` }));
    const list = el('div', { class: 'cx-list' });
    for (const hit of hits) {
      list.appendChild(
        el('div', {
          class: 'cx-listrow',
          onClick: () => {
            if (hit.kind === 'lane') showPane('lanes');
            else cmd.revealObject(hit.id);
          },
          onDblclick: () => hit.kind === 'object' && openObjectDialog(hit.id),
        }, [
          el('span', { class: 'cx-dot', style: { background: TYPES[hit.type]?.accent || 'var(--neutral)' } }),
          el('div', { class: 'lr-main' }, [
            el('div', { class: 'lr-title', text: hit.title }),
            el('div', { class: 'lr-meta', text: `${hit.typeLabel}${hit.lane ? ' · ' + hit.lane : ''} · matched in ${hit.matchedIn}` }),
            hit.excerpt ? el('div', { style: { fontSize: 'var(--fs-tiny)', color: 'var(--text-subtle)', marginTop: '2px' }, text: hit.excerpt }) : null,
          ]),
        ])
      );
    }
    results.appendChild(list);
  }, 160);

  input.addEventListener('input', run);
  root.append(input, results);
  run();
  setTimeout(() => input.focus(), 40);
}

/* ══════════════════════════════════════════════════════════════════════════
   Filters
   ═══════════════════════════════════════════════════════════════════════ */

function paneFilters(root) {
  const doc = store.getDoc();
  const filters = store.getFilters();

  root.appendChild(
    el('div', { style: { display: 'flex', gap: '6px', marginBottom: '11px' } }, [
      el('button', {
        class: 'cx-btn mini',
        html: icon('refresh', { size: 12 }) + '<span>Clear all</span>',
        disabled: !store.hasActiveFilters(),
        onClick: () => {
          store.resetFilters();
          renderer.requestRender();
          renderPane();
        },
      }),
      el('button', {
        class: 'cx-btn mini',
        html: icon('cursor', { size: 12 }) + '<span>Select matches</span>',
        disabled: !store.hasActiveFilters(),
        onClick: selectFiltered,
      }),
    ])
  );

  // What a filter does to everything else. Dimming keeps the shape of the plan
  // legible and nothing moves; hiding closes the rows up around what is left,
  // which reads better when you are down to a handful of objects.
  root.appendChild(
    field(
      'Non-matching objects',
      segmented({
        value: doc.settings.filterMode || 'dim',
        stretch: true,
        options: [
          { value: 'dim', label: 'Dim' },
          { value: 'hide', label: 'Hide' },
        ],
        onChange: (v) => {
          store.setSetting('filterMode', v, 'Change filter display');
          renderer.invalidateAll();
          renderer.requestRender();
        },
      }),
      'Hiding reflows the lanes around what is left. Exports always hide.'
    )
  );

  root.appendChild(field('Text contains', textInput({
    value: filters.text,
    placeholder: 'Free text',
    onInput: debounce((v) => {
      store.setFilters({ text: v });
      renderer.requestRender();
    }, 200),
  })));

  root.appendChild(
    el('div', { class: 'cx-row', style: { marginTop: '10px' } }, [
      field('From', textInput({
        type: 'date',
        value: filters.from || '',
        onChange: (v) => {
          store.setFilters({ from: v || null });
          renderer.requestRender();
        },
      })),
      field('To', textInput({
        type: 'date',
        value: filters.to || '',
        onChange: (v) => {
          store.setFilters({ to: v || null });
          renderer.requestRender();
        },
      })),
    ])
  );

  root.appendChild(checkGroup('Type', 'types', Object.entries(TYPES).map(([id, t]) => ({ value: id, label: t.label })), filters.types));
  root.appendChild(checkGroup('Status', 'statuses', listOptions('status').map((o) => ({ value: o.id, label: o.label })), filters.statuses));
  root.appendChild(checkGroup('Lane', 'lanes', store.orderedLanes().map((l) => ({ value: l.id, label: l.name })), filters.lanes));
  root.appendChild(checkGroup('Subsystem', 'subsystems', listOptions('subsystem').map((s) => ({ value: s.id, label: s.label })), filters.subsystems));

  const owners = facet(doc, 'owner');
  if (owners.length) {
    root.appendChild(checkGroup('Owner', 'owners', owners.map((o) => ({ value: o.value, label: `${o.value} (${o.count})` })), filters.owners));
  }
  const areas = facet(doc, 'area');
  if (areas.length) {
    root.appendChild(checkGroup('Area', 'areas', areas.map((a) => ({ value: a.value, label: `${a.value} (${a.count})` })), filters.areas));
  }
  const tags = facet(doc, 'tag');
  if (tags.length) {
    root.appendChild(checkGroup('Tag', 'tags', tags.map((t) => ({ value: t.value, label: `${t.value} (${t.count})` })), filters.tags));
  }
}

function checkGroup(title, dimension, options, selected) {
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } });
  for (const option of options) {
    wrap.appendChild(
      checkbox({
        label: option.label,
        checked: selected.includes(option.value),
        onChange: (on_) => {
          const current = store.getFilters()[dimension] || [];
          const next = on_ ? [...current, option.value] : current.filter((v) => v !== option.value);
          store.setFilters({ [dimension]: next });
          renderer.requestRender();
        },
      })
    );
  }
  return section(`${title}${selected.length ? ` (${selected.length})` : ''}`, [wrap], { collapsed: !selected.length });
}

/** Select every object that passes the active filters. */
function selectFiltered() {
  const doc = store.getDoc();
  const predicate = filterPredicate(doc, store.getFilters());
  store.setSelection(doc.objects.filter(predicate).map((o) => o.id));
  renderer.requestRender();
}

/* ══════════════════════════════════════════════════════════════════════════
   Legend settings
   ═══════════════════════════════════════════════════════════════════════ */

function paneLegendSettings(root) {
  const doc = store.getDoc();
  const stats = summarise(doc);

  root.appendChild(
    el('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px', marginBottom: '12px' } }, [
      toggle({
        label: 'Show legend on the canvas',
        checked: doc.settings.showLegend,
        onChange: (v) => {
          store.setSetting('showLegend', v, 'Toggle legend');
          renderer.requestRender();
        },
      }),
      toggle({
        label: 'Show minimap',
        checked: doc.settings.showMinimap,
        onChange: (v) => {
          store.setSetting('showMinimap', v, 'Toggle minimap');
          renderer.requestRender();
        },
      }),
    ])
  );

  const health = programmeHealth(doc);
  root.appendChild(
    el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' } }, [
      chipStat('Complete', `${health.percentComplete}%`, health.percentComplete > 60 ? 'good' : 'info'),
      chipStat('At risk', health.atRisk, health.atRisk ? 'bad' : 'good'),
      chipStat('Objects', stats.total, 'muted'),
    ])
  );

  const typeList = el('div', { class: 'cx-list' });
  for (const [type, count] of Array.from(stats.byType).sort((a, b) => b[1] - a[1])) {
    typeList.appendChild(
      el('div', { class: 'cx-listrow' }, [
        el('span', { class: 'cx-dot', style: { background: TYPES[type]?.accent || 'var(--neutral)' } }),
        el('div', { class: 'lr-main' }, [el('div', { class: 'lr-title', text: TYPES[type]?.label || type })]),
        el('span', { class: 'mono', style: { fontSize: 'var(--fs-tiny)', color: 'var(--text-subtle)' }, text: String(count) }),
      ])
    );
  }
  root.appendChild(section('Object types in this plan', [typeList]));

  const statusList = el('div', { class: 'cx-list' });
  for (const [status, count] of Array.from(stats.byStatus).sort((a, b) => b[1] - a[1])) {
    statusList.appendChild(
      el('div', { class: 'cx-listrow' }, [
        el('span', { class: 'cx-dot', style: { background: statusOf(status).color } }),
        el('div', { class: 'lr-main' }, [el('div', { class: 'lr-title', text: statusOf(status).label })]),
        el('span', { class: 'mono', style: { fontSize: 'var(--fs-tiny)', color: 'var(--text-subtle)' }, text: String(count) }),
      ])
    );
  }
  root.appendChild(section('Statuses in this plan', [statusList]));
}

/* ══════════════════════════════════════════════════════════════════════════
   Version history
   ═══════════════════════════════════════════════════════════════════════ */

function paneHistory(root) {
  const entries = store.recentHistory(60);
  const state = store.historyState();

  root.appendChild(
    el('div', { style: { display: 'flex', gap: '6px', marginBottom: '11px' } }, [
      el('button', { class: 'cx-btn mini', html: icon('undo', { size: 12 }) + '<span>Undo</span>', disabled: !state.canUndo, onClick: () => { store.undo(); renderer.requestRender(); } }),
      el('button', { class: 'cx-btn mini', html: icon('redo', { size: 12 }) + '<span>Redo</span>', disabled: !state.canRedo, onClick: () => { store.redo(); renderer.requestRender(); } }),
    ])
  );

  if (!entries.length) {
    root.appendChild(emptyState({ iconName: 'history', title: 'No changes yet', message: 'Every edit is recorded here. Click an entry to roll the project back to just before it.' }));
    return;
  }

  const list = el('div', { class: 'cx-list' });
  for (const entry of entries) {
    list.appendChild(
      el('div', {
        class: 'cx-listrow',
        title: 'Roll back to just before this change',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Roll back',
            message: `Undo everything up to and including “${entry.label}”? You can redo afterwards.`,
            confirmLabel: 'Roll back',
          });
          if (ok) {
            store.revertTo(entry.id);
            renderer.requestRender();
            renderPane();
          }
        },
      }, [
        el('span', { style: { display: 'flex', color: 'var(--text-subtle)' }, html: icon('history', { size: 11 }) }),
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: entry.label }),
          el('div', { class: 'lr-meta', text: `${fmtTimestamp(entry.time)} · ${entry.summary}` }),
        ]),
      ])
    );
  }
  root.appendChild(list);
}

/* ══════════════════════════════════════════════════════════════════════════
   Import / export
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The shared-folder controls.
 *
 * This is the whole of file mode's interface: connect a folder, see which plan
 * is live and who has the pen, and open another. It sits at the top of Import /
 * export because that is where someone goes looking for "where does my data
 * live", and it is hidden entirely on a hosted deployment, where the answer is
 * the server and this would only confuse.
 */
function sharedFolderSection() {
  const st = filestore.state();

  // A hosted build saves to the server, so the folder controls would not work
  // — but rendering nothing was worse: the section simply vanished, with no way
  // to tell that from a build where the feature was missing. Say which one it is.
  if (isHosted()) {
    return section('Shared folder', [
      el('div', {
        class: 'cx-hint',
        text:
          'This build saves to its server, so the plan cannot also live in a folder. ' +
          'A folder deployment is a separate build with no backend — see DEPLOY.md.',
      }),
    ], { id: 'shared-folder' });
  }

  if (!st.supported) {
    return section('Shared folder', [
      el('div', {
        class: 'cx-hint',
        text:
          'Saving straight into a shared or synced folder needs Edge or Chrome. ' +
          'This browser keeps your work in its own storage instead — use Export → JSON to move a plan.',
      }),
    ], { id: 'shared-folder' });
  }

  const rows = [];
  const wideBtn = (label, iconName, onClick, primary = false) =>
    el('button', {
      class: 'cx-btn mini' + (primary ? ' primary' : ''),
      style: { justifyContent: 'flex-start', width: '100%' },
      html: icon(iconName, { size: 12 }) + `<span>${label}</span>`,
      onClick,
    });

  // Three states, and the middle one is easy to forget: a folder can be
  // connected with no plan open yet, which happens whenever it holds more than
  // one. Offering "connect a folder" again there is just confusing.
  if (st.connected) {
    const editing = st.role === 'editor';
    rows.push(
      el('div', { class: 'cx-listrow' + (editing ? ' active' : '') }, [
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: st.plan }),
          el('div', {
            class: 'lr-meta',
            text: editing ? `${st.folder} · you have the pen` : `${st.folder} · ${st.holder} is editing`,
          }),
        ]),
      ])
    );
    if (!editing) rows.push(wideBtn('Take over editing', 'refresh', () => cmd.takeOverEditing()));
    rows.push(
      wideBtn('Reload from the folder', 'download', () => cmd.reloadFromFolder()),
      wideBtn('Disconnect', 'x', () => cmd.disconnectFolder())
    );
  } else if (st.folder) {
    rows.push(
      el('div', { class: 'cx-hint', text: `${st.folder} is connected. Choose the plan to work on.` }),
      wideBtn('New plan in this folder…', 'plus', () => cmd.createFolderPlanFromCurrent()),
      wideBtn('Pick a different folder…', 'folder', () => cmd.connectFolder())
    );
  } else {
    rows.push(
      el('div', {
        class: 'cx-hint',
        text:
          'Keep the plan as a file in a shared or OneDrive-synced folder. ' +
          'Both of you open the same file; whoever gets there first has the pen, the other reads.',
      }),
      wideBtn('Connect a folder…', 'folder', () => cmd.connectFolder(), true)
    );
  }

  // Other plans sitting in the folder, so switching programmes does not mean
  // going back through the picker.
  const list = el('div', { class: 'cx-list', style: { marginTop: '8px' } });
  if (st.folder) {
    filestore
      .listPlans()
      .then((found) => {
        clear(list);
        const others = found.filter((plan) => plan.name !== st.plan);
        if (!others.length) return;
        list.appendChild(el('div', { class: 'cx-hint', text: st.connected ? 'Also in this folder' : 'Plans in this folder' }));
        for (const plan of others) {
          list.appendChild(
            el('div', { class: 'cx-listrow', onClick: () => cmd.openFolderPlanByName(plan.name) }, [
              el('div', { class: 'lr-main' }, [
                el('div', { class: 'lr-title', text: plan.name }),
                el('div', { class: 'lr-meta', text: plan.modified ? fmtTimestamp(plan.modified) : '' }),
              ]),
            ])
          );
        }
      })
      .catch(() => {
        /* the folder went away — the state row already says so */
      });
  }
  rows.push(list);

  // Whose name goes in the lock. Without this both people see "Someone", which
  // defeats the point of saying who has the pen. Written on blur rather than per
  // keystroke: it is a device preference, not document data, so nothing rebuilds
  // underneath the caret.
  if (st.supported) {
    const nameInput = textInput({
      value: filestore.getDisplayName() === 'Someone' ? '' : filestore.getDisplayName(),
      placeholder: 'Your name',
    });
    nameInput.addEventListener('change', () => filestore.setDisplayName(nameInput.value));
    rows.push(
      el('div', { style: { marginTop: '10px' } }, [
        field('Your name in the lock', nameInput, 'What your colleague sees when you have the plan open.'),
      ])
    );
  }

  if (!st.connected && !st.folder) {
    // A remembered folder whose permission has lapsed: one click gets it back,
    // which is much better than making someone find it in the picker again.
    const reconnect = el('div');
    filestore
      .storedFolder()
      .then((stored) => {
        if (!stored) return;
        reconnect.appendChild(
          el('button', {
            class: 'cx-btn mini',
            style: { justifyContent: 'flex-start', width: '100%', marginTop: '6px' },
            html: icon('refresh', { size: 12 }) + `<span>Reconnect to ${stored.folder}</span>`,
            onClick: () => cmd.reconnectFolder(),
          })
        );
      })
      .catch(() => {});
    rows.push(reconnect);
  }

  return section('Shared folder', rows, { id: 'shared-folder' });
}

function paneIo(root) {
  root.appendChild(sharedFolderSection());

  root.appendChild(
    section('Export', [
      el('div', { class: 'cx-hint', text: 'PDF, print, SVG, PNG and JPEG all draw the same picture. What goes in it is up to you.' }),
      el('button', {
        class: 'cx-btn mini',
        style: { justifyContent: 'flex-start', width: '100%', marginBottom: '4px' },
        html: icon('sliders', { size: 12 }) + '<span>Drawing options…</span>',
        onClick: () => openExportOptions(() => renderPane()),
      }),
      el('div', { class: 'cx-hint', style: { marginBottom: '8px' }, text: exportSummary() }),
      exportButton('PDF (vector, multi-page)', 'print', () => openPdfDialog()),
      exportButton('Print / Save as PDF', 'print', () => exporters.printPlan()),
      exportButton('SVG (vector)', 'image', () => exporters.exportSvg()),
      exportButton('PNG (raster)', 'image', () => exporters.exportPng({ scale: 2 })),
      exportButton('JPEG (raster)', 'image', () => exporters.exportJpeg({ scale: 2 })),
      exportButton('CSV (objects)', 'table', () => exporters.exportCsv()),
      exportButton('CSV (dependencies)', 'table', () => exporters.exportLinksCsv()),
      exportButton('JSON (full project)', 'save', () => exporters.exportJson()),
    ], { id: 'export' })
  );

  root.appendChild(
    section('Import', [
      el('div', { class: 'cx-hint', text: 'JSON restores a whole project. CSV, TSV and Excel files are mapped by column name — Microsoft Project CSV exports are recognised automatically.' }),
      el('button', {
        class: 'cx-btn mini',
        style: { justifyContent: 'flex-start', width: '100%' },
        html: icon('upload', { size: 12 }) + '<span>Choose a file…</span>',
        onClick: chooseImport,
      }),
      el('div', {
        class: 'att-drop',
        style: { marginTop: '8px' },
        html: icon('download', { size: 14 }) + ' <span>…or drop a file here</span>',
        onDragover: (e) => {
          e.preventDefault();
          e.currentTarget.classList.add('over');
        },
        onDragleave: (e) => e.currentTarget.classList.remove('over'),
        onDrop: async (e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('over');
          const files = Array.from(e.dataTransfer?.files || []);
          if (files.length) await runImport(files[0]);
        },
      }),
    ])
  );

  root.appendChild(
    section('Project', [
      el('button', { class: 'cx-btn mini', style: { justifyContent: 'flex-start', width: '100%' }, html: icon('plus', { size: 12 }) + '<span>New project…</span>', onClick: () => cmd.newProject() }),
      el('button', { class: 'cx-btn mini', style: { justifyContent: 'flex-start', width: '100%' }, html: icon('save', { size: 12 }) + '<span>Save a restore point</span>', onClick: () => cmd.saveSnapshot() }),
    ])
  );
}

function exportButton(label, iconName, onClick) {
  return el('button', {
    class: 'cx-btn mini',
    style: { justifyContent: 'flex-start', width: '100%' },
    html: icon(iconName, { size: 12 }) + `<span>${label}</span>`,
    onClick,
  });
}

function exportMenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  contextMenu(rect.left, rect.bottom + 4, [
    { heading: 'Export' },
    { label: 'PDF…', icon: 'print', onClick: () => openPdfDialog() },
    { label: 'Print / Save as PDF', icon: 'print', key: 'mod+p', onClick: () => exporters.printPlan() },
    'sep',
    { label: 'SVG', icon: 'image', onClick: () => exporters.exportSvg() },
    { label: 'PNG', icon: 'image', onClick: () => exporters.exportPng({ scale: 2 }) },
    { label: 'JPEG', icon: 'image', onClick: () => exporters.exportJpeg({ scale: 2 }) },
    'sep',
    { label: 'CSV — objects', icon: 'table', onClick: () => exporters.exportCsv() },
    { label: 'CSV — dependencies', icon: 'table', onClick: () => exporters.exportLinksCsv() },
    { label: 'CSV — baseline variance', icon: 'compare', onClick: () => exporters.exportBaselineCsv() },
    'sep',
    { label: 'JSON — full project', icon: 'save', onClick: () => exporters.exportJson() },
    'sep',
    { label: 'Import a file…', icon: 'upload', onClick: chooseImport },
  ]);
}

function openPdfDialog() {
  let pageSize = 'a3';
  let density = 'normal';
  let multiPage = true;

  openModal({
    title: 'Export PDF',
    subtitle: 'Vector output — text stays selectable and the drawing stays sharp at any zoom.',
    body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } }, [
      field('Page size', selectInput({
        value: pageSize,
        options: exporters.PDF_PAGE_SIZES,
        onChange: (v) => {
          pageSize = v;
        },
      })),
      field('Detail', segmented({
        value: density,
        stretch: true,
        options: [
          { value: 'coarse', label: 'Overview' },
          { value: 'normal', label: 'Standard' },
          { value: 'fine', label: 'Detailed' },
        ],
        onChange: (v) => {
          density = v;
        },
      }), 'Detailed produces more pages but wider bars and more readable labels.'),
      toggle({ label: 'Split wide plans across multiple pages', checked: true, onChange: (v) => { multiPage = v; } }),
    ]),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Export PDF',
        kind: 'primary',
        // The exporter announces the file it wrote — including its name and
        // size, and only when there is one. Saying it here as well both
        // repeated the message and claimed success for a failed export.
        onClick: () => exporters.exportPdf({ pageSize, density, multiPage }),
      },
    ],
  });
}

async function chooseImport() {
  const files = await pickFiles({ accept: '.json,.csv,.tsv,.txt,.xlsx,.xlsm' });
  if (files.length) await runImport(files[0]);
}

async function runImport(file) {
  toast({ tone: 'info', title: 'Reading file…', message: file.name, timeout: 1500 });
  const result = await importFile(file);

  if (result.kind === 'error') {
    openModal({
      title: 'Import failed',
      body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
        el('div', { class: 'cx-hint', text: `${file.name} could not be imported.` }),
        ...result.errors.map((e) => el('div', { style: { color: 'var(--bad)', fontSize: 'var(--fs-small)' }, text: e })),
      ]),
      actions: [{ label: 'Close', kind: 'primary' }],
    });
    return;
  }

  const warnings = result.warnings.length
    ? el('div', { style: { marginTop: '10px' } }, [
        el('div', { class: 'eyebrow', style: { marginBottom: '4px' }, text: 'Notes' }),
        ...result.warnings.map((w) => el('div', { style: { color: 'var(--warn)', fontSize: 'var(--fs-tiny)', marginBottom: '3px' }, text: w })),
      ])
    : null;

  if (result.kind === 'project') {
    openModal({
      title: 'Import project',
      subtitle: file.name,
      body: el('div', {}, [
        el('div', { style: { fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }, text: `“${result.doc.name}” — ${result.summary}.` }),
        el('div', { class: 'cx-hint', style: { marginTop: '8px' }, text: 'Your current project is backed up first and can be restored from Backups.' }),
        warnings,
      ]),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Replace current project',
          kind: 'primary',
          onClick: async () => {
            await makeBackup('before-import');
            store.replaceDoc(result.doc, 'import');
            cmd.fitAll();
            toast({ tone: 'good', title: 'Project imported', message: result.summary });
          },
        },
      ],
    });
    return;
  }

  /* Row-based import: offer merge or replace. */
  const preview = el('div', { class: 'cx-list', style: { maxHeight: '220px', overflowY: 'auto', marginTop: '10px' } });
  for (const obj of result.objects.slice(0, 12)) {
    preview.appendChild(
      el('div', { class: 'cx-listrow' }, [
        el('span', { class: 'cx-dot', style: { background: TYPES[obj.type]?.accent } }),
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: obj.title }),
          el('div', { class: 'lr-meta', text: `${TYPES[obj.type]?.label} · ${fmtDate(obj.start, 'medium')}${TYPES[obj.type]?.duration ? ` → ${fmtDate(obj.end, 'medium')}` : ''}` }),
        ]),
      ])
    );
  }
  if (result.objects.length > 12) {
    preview.appendChild(el('div', { class: 'cx-hint', style: { padding: '6px 8px' }, text: `…and ${result.objects.length - 12} more.` }));
  }

  openModal({
    title: 'Import data',
    subtitle: file.name,
    size: 'wide',
    body: el('div', {}, [
      el('div', { style: { fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }, text: result.summary }),
      warnings,
      preview,
    ]),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Add to current project',
        onClick: async () => {
          await makeBackup('before-import');
          store.replaceDoc(buildDocFromRows(result, { mode: 'merge' }), 'import');
          cmd.fitAll();
          toast({ tone: 'good', title: 'Rows imported', message: result.summary });
        },
      },
      {
        label: 'Replace project',
        kind: 'primary',
        onClick: async () => {
          await makeBackup('before-import');
          store.replaceDoc(buildDocFromRows(result, { mode: 'replace', name: file.name.replace(/\.[^.]+$/, '') }), 'import');
          cmd.fitAll();
          toast({ tone: 'good', title: 'Project imported', message: result.summary });
        },
      },
    ],
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Backups
   ═══════════════════════════════════════════════════════════════════════ */

function paneBackups(root) {
  root.appendChild(
    el('div', { style: { display: 'flex', gap: '6px', marginBottom: '11px' } }, [
      el('button', {
        class: 'cx-btn mini primary',
        html: icon('save', { size: 12 }) + '<span>Back up now</span>',
        onClick: async () => {
          await makeBackup('manual');
          renderPane();
          toast({ tone: 'good', title: 'Backup created' });
        },
      }),
    ])
  );

  const list = el('div', { class: 'cx-list' });
  root.appendChild(list);
  list.appendChild(el('div', { class: 'cx-hint', text: 'Loading backups…' }));

  listBackups().then((backups) => {
    clear(list);
    if (!backups.length) {
      list.appendChild(emptyState({
        iconName: 'save',
        title: 'No backups yet',
        message: 'Backups are taken automatically every hour and every 100 edits, and before any import.',
      }));
      return;
    }

    for (const backup of backups) {
      list.appendChild(
        el('div', { class: 'cx-listrow' }, [
          el('span', { style: { display: 'flex', color: 'var(--text-subtle)' }, html: icon('save', { size: 11 }) }),
          el('div', { class: 'lr-main' }, [
            el('div', { class: 'lr-title', text: backup.name || 'Project' }),
            el('div', { class: 'lr-meta', text: `${fmtTimestamp(backup.time)} · ${backup.objects} objects · ${backup.reason}${backup.size ? ' · ' + bytes(backup.size) : ''}` }),
          ]),
          el('div', { class: 'lr-actions' }, [
            iconBtn('refresh', 'Restore this backup', () => restoreBackup(backup)),
            iconBtn('download', 'Download as JSON', async () => {
              const doc = await loadBackup(backup.key);
              if (!doc) {
                toast({ tone: 'bad', title: 'Backup unavailable', message: 'The stored copy could not be read.' });
                return;
              }
              const filename = `${doc.name || 'project'}-${toISO(backup.time)}.json`;
              const json = JSON.stringify(doc, null, 2);
              download(filename, json, 'application/json');
              toast({ tone: 'good', title: 'Backup downloaded', message: `${filename} · ${bytes(json.length)} — saved to your downloads.` });
            }),
            iconBtn('trash', 'Delete backup', async () => {
              await deleteBackup(backup.key);
              renderPane();
            }),
          ]),
        ])
      );
    }
  });
}

async function restoreBackup(backup) {
  const ok = await confirmDialog({
    title: 'Restore backup',
    message: `Replace the current project with the backup from ${fmtTimestamp(backup.time)}? The current state is backed up first.`,
    confirmLabel: 'Restore',
  });
  if (!ok) return;

  await makeBackup('before-restore');
  const doc = await loadBackup(backup.key);
  if (!doc) {
    toast({ tone: 'bad', title: 'Backup could not be read' });
    return;
  }
  store.replaceDoc(doc, 'restore');
  cmd.fitAll();
  toast({ tone: 'good', title: 'Backup restored' });
}

/* ══════════════════════════════════════════════════════════════════════════
   Projects (hosted deployments only)
   ═══════════════════════════════════════════════════════════════════════ */

const ROLE_TONE = { owner: 'good', editor: 'info', viewer: 'muted' };
const ROLE_WORD = { owner: 'Owner', editor: 'Editor', viewer: 'View only' };

/**
 * Every plan this account can reach, with the role that governs it.
 *
 * The role badge is the whole point of the pane: knowing *before* you open
 * something whether you will be able to change it is the difference between a
 * read-only project and a broken one.
 */
function paneProjects(root) {
  if (!cloud.isConfigured()) {
    root.appendChild(
      emptyState({
        iconName: 'folder',
        title: 'Local project',
        message: 'This build keeps everything in this browser. Projects and sharing appear when it is connected to a backend.',
      })
    );
    return;
  }

  if (!cloud.isSignedIn()) {
    root.appendChild(
      emptyState({
        iconName: 'user',
        title: 'Not signed in',
        message: 'Sign in to keep projects on the server and share them.',
        action: { label: 'Sign in', onClick: () => window.location.reload() },
      })
    );
    return;
  }

  const actions = el('div', { style: { display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' } }, [
    el('button', {
      class: 'cx-btn mini primary',
      html: icon('plus', { size: 12 }) + '<span>New project</span>',
      onClick: () => newCloudProject(),
    }),
    el('button', {
      class: 'cx-btn mini',
      html: icon('share', { size: 12 }) + '<span>Share</span>',
      title: 'Who can see the open project',
      disabled: !cloud.getProjectId(),
      onClick: () => openShareDialog(cloud.getProjectId(), store.getDoc().name),
    }),
  ]);
  root.appendChild(actions);

  const list = el('div', { class: 'cx-list' });
  root.appendChild(list);
  list.appendChild(skeleton(3));

  cloud
    .listProjects()
    .then((projects) => {
      clear(list);
      if (!projects.length) {
        list.appendChild(emptyState({ iconName: 'folder', title: 'No projects yet', message: 'Create one to get started.' }));
        return;
      }
      for (const project of projects) list.appendChild(projectRow(project));
    })
    .catch((err) => {
      clear(list);
      list.appendChild(
        emptyState({ iconName: 'warning', title: 'Could not load your projects', message: err.message })
      );
    });
}

function projectRow(project) {
  const open = project.id === cloud.getProjectId();

  return el('div', {
    class: 'cx-listrow' + (open ? ' active' : ''),
    dataset: { project: project.id },
    onClick: () => (open ? null : openCloudProject(project)),
  }, [
    el('span', { class: 'cx-dot', style: { background: open ? 'var(--accent)' : 'var(--text-subtle)' } }),
    el('div', { class: 'lr-main' }, [
      el('div', { class: 'lr-title', text: project.name }),
      el('div', {
        class: 'lr-meta',
        text: [
          `${project.objects} object${project.objects === 1 ? '' : 's'}`,
          fmtTimestamp(project.savedAt),
          project.role === 'owner' ? null : `owner ${project.ownerEmail || '—'}`,
          project.members > 1 ? `${project.members} people` : null,
        ].filter(Boolean).join(' · '),
      }),
    ]),
    badge(ROLE_WORD[project.role] || project.role, ROLE_TONE[project.role] || 'muted'),
    el('div', { class: 'lr-actions' }, [
      el('button', {
        class: 'cx-btn icon mini ghost',
        title: 'Share',
        'aria-label': `Share ${project.name}`,
        html: icon('share', { size: 11 }),
        onClick: (e) => {
          e.stopPropagation();
          openShareDialog(project.id, project.name);
        },
      }),
      project.role === 'owner'
        ? el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Rename',
            'aria-label': `Rename ${project.name}`,
            html: icon('edit', { size: 11 }),
            onClick: async (e) => {
              e.stopPropagation();
              const name = await promptDialog({ title: 'Rename project', label: 'Name', value: project.name });
              if (!name || name === project.name) return;
              try {
                await cloud.renameProject(project.id, name);
                if (project.id === cloud.getProjectId()) store.setMeta({ name }, 'Rename project');
                renderPane();
              } catch (err) {
                toast({ tone: 'bad', title: 'Could not rename', message: err.message });
              }
            },
          })
        : null,
      project.role === 'owner'
        ? el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Delete',
            'aria-label': `Delete ${project.name}`,
            html: icon('trash', { size: 11 }),
            onClick: (e) => {
              e.stopPropagation();
              removeCloudProject(project);
            },
          })
        : null,
    ].filter(Boolean)),
  ]);
}

async function openCloudProject(project) {
  try {
    const doc = await switchProject(project.id);
    store.replaceDoc(doc, 'load');
    renderer.requestRender();
    renderPane();
    toast({
      tone: 'good',
      title: `Opened "${project.name}"`,
      message: project.role === 'viewer' ? 'You have view-only access to this project.' : undefined,
    });
  } catch (err) {
    toast({ tone: 'bad', title: 'Could not open', message: err.message });
  }
}

async function newCloudProject() {
  const name = await promptDialog({ title: 'New project', label: 'Name', value: 'Untitled Programme' });
  if (!name) return;
  try {
    const doc = makeProject(name);
    await createCloudProject(doc);
    store.replaceDoc(doc, 'load');
    renderer.requestRender();
    renderPane();
    toast({ tone: 'good', title: 'Project created', message: `"${name}" is yours — share it from here.` });
  } catch (err) {
    toast({ tone: 'bad', title: 'Could not create the project', message: err.message });
  }
}

async function removeCloudProject(project) {
  const ok = await confirmDialog({
    title: `Delete "${project.name}"?`,
    message: 'The project, its backups and everyone\'s access to it are removed. This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await cloud.deleteProject(project.id);
    toast({ tone: 'good', title: 'Deleted' });
    if (project.id === cloud.getProjectId()) window.location.reload();
    else renderPane();
  } catch (err) {
    toast({ tone: 'bad', title: 'Could not delete', message: err.message });
  }
}

/**
 * What a drawn export contains.
 *
 * A printed plan gets cross-referenced against other documents, and the one
 * thing it could not do was tell you what dates an object actually covers —
 * a month-scale ruler cannot be read to the day. That is now a toggle, along
 * with the rest of what makes a drawing worth printing.
 *
 * The choices live in the document, so a plan exports the same way for
 * whoever opens it, and so the same settings apply to every image format.
 */
function openExportOptions(onClose = () => {}) {
  const doc = store.getDoc();
  const cfg = exporters.exportSettings();
  const baselines = doc.baselines || [];

  const set = (patch) => {
    store.setSetting('exportOptions', { ...exporters.exportSettings(), ...patch }, 'Change export options');
  };

  const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, [
    section('Content', [
      toggle({
        label: 'Dates on every object',
        checked: cfg.showDates !== false,
        onChange: (v) => set({ showDates: v }),
      }),
      el('div', { class: 'cx-hint', text: 'Start, finish and duration printed under each label, so a bar can be cross-referenced without reading it off the ruler.' }),
      toggle({ label: 'Dependencies', checked: cfg.showLinks !== false, onChange: (v) => set({ showLinks: v }) }),
      toggle({ label: 'Progress fill', checked: cfg.showProgress !== false, onChange: (v) => set({ showProgress: v }) }),
      toggle({ label: 'Legend', checked: cfg.showLegend !== false, onChange: (v) => set({ showLegend: v }) }),
      toggle({ label: 'Gridlines', checked: cfg.showGrid !== false, onChange: (v) => set({ showGrid: v }) }),
      toggle({ label: 'Today marker', checked: cfg.showToday !== false, onChange: (v) => set({ showToday: v }) }),
    ], { id: 'exp-content' }),

    section('Baseline', baselines.length
      ? [
          toggle({
            label: 'Show the comparison',
            checked: cfg.showBaseline === true,
            onChange: (v) => {
              set({ showBaseline: v, baselineId: cfg.baselineId || doc.settings.activeBaseline || baselines[baselines.length - 1].id });
              renderPane();
            },
          }),
          field('Which baseline', selectInput({
            value: cfg.baselineId || doc.settings.activeBaseline || '',
            options: baselines.map((b) => ({ value: b.id, label: b.name })),
            onChange: (v) => set({ baselineId: v }),
          }), 'The export can compare against a different baseline from the one on screen.'),
        ]
      : [el('div', { class: 'cx-hint', text: 'No baselines yet. Take one from the Baselines pane and it can be drawn into an export.' })],
      { id: 'exp-baseline' }),

    section('Scope', [
      toggle({
        label: 'Apply the active filters',
        checked: cfg.respectFilters !== false,
        onChange: (v) => set({ respectFilters: v }),
      }),
      el('div', {
        class: 'cx-hint',
        text: store.hasActiveFilters()
          ? 'Filters are active — with this off, the export shows the whole plan.'
          : 'No filters are active, so this changes nothing right now.',
      }),
      field('Date range', segmented({
        value: cfg.range || 'all',
        stretch: true,
        options: [
          { value: 'all', label: 'Whole plan' },
          { value: 'visible', label: 'On screen' },
        ],
        onChange: (v) => set({ range: v }),
      })),
      field('Density', segmented({
        value: cfg.density || 'fit',
        stretch: true,
        options: [
          { value: 'compact', label: 'Compact' },
          { value: 'fit', label: 'Fit' },
          { value: 'detailed', label: 'Detailed' },
        ],
        onChange: (v) => set({ density: v }),
      }), 'Fit sizes the drawing to the page. Detailed gives each day more room, which suits a short window.'),
    ], { id: 'exp-scope' }),
  ]);

  return openModal({
    title: 'Drawing options',
    subtitle: 'Applies to PDF, print, SVG, PNG and JPEG. Saved with the project.',
    body,
    actions: [{ label: 'Done', kind: 'primary' }],
    onClose: () => {
      renderer.requestRender();
      onClose();
    },
  });
}

/** One line describing what the next drawn export will contain. */
function exportSummary() {
  const cfg = exporters.exportSettings();
  const on = [
    cfg.showDates !== false ? 'dates' : null,
    cfg.showLinks !== false ? 'dependencies' : null,
    cfg.showBaseline ? 'baseline' : null,
    cfg.showLegend !== false ? 'legend' : null,
  ].filter(Boolean);
  const scope = [
    cfg.range === 'visible' ? 'the window on screen' : 'the whole plan',
    cfg.respectFilters !== false && store.hasActiveFilters() ? 'filtered' : null,
  ].filter(Boolean).join(', ');
  return `Drawing ${scope}${on.length ? ` with ${on.join(', ')}` : ' with nothing but the bars'}.`;
}

/* ══════════════════════════════════════════════════════════════════════════
   Dropdown lists
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every editable vocabulary in one place. The same editor is behind the
 * "Manage…" row at the foot of each dropdown, so there is one behaviour to
 * learn and one implementation to maintain.
 */
function paneLists(root) {
  root.appendChild(
    el('div', { class: 'cx-hint', style: { marginBottom: '12px' } }, [
      el('span', { text: 'Statuses, subsystems and the rest are project data — add, rename, recolour, reorder or remove them. Changes are undoable and travel with the file.' }),
    ])
  );
  root.appendChild(listEditor().node);
}

/* ══════════════════════════════════════════════════════════════════════════
   Settings
   ═══════════════════════════════════════════════════════════════════════ */

function paneSettings(root) {
  const doc = store.getDoc();
  const settings = doc.settings;
  const set = (key, value, label) => {
    store.setSetting(key, value, label || 'Change setting');
    renderer.requestRender();
  };

  root.appendChild(
    section('Appearance', [
      field('Theme', selectInput({
        value: getTheme(),
        options: THEMES.map((t) => ({ value: t.id, label: t.label })),
        onChange: (v) => applyTheme(v),
      })),
      toggle({ label: 'Gridlines', checked: settings.gridlines, onChange: (v) => set('gridlines', v, 'Toggle gridlines') }),
      field('Grid density', segmented({
        value: settings.gridDensity,
        stretch: true,
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'major', label: 'Major' },
          { value: 'off', label: 'Off' },
        ],
        onChange: (v) => set('gridDensity', v, 'Change grid density'),
      })),
      toggle({ label: 'Shade weekends', checked: settings.showWeekends, onChange: (v) => set('showWeekends', v, 'Toggle weekends') }),
      toggle({ label: 'Show progress fill', checked: settings.showProgress, onChange: (v) => set('showProgress', v, 'Toggle progress') }),
      toggle({ label: 'Show dependency arrows', checked: settings.showConnectors, onChange: (v) => set('showConnectors', v, 'Toggle connectors') }),
    ])
  );

  root.appendChild(
    section('Timeline behaviour', [
      field('Snap dragged dates to', selectInput({
        value: settings.snap,
        options: [
          { value: 'off', label: 'No snapping' },
          { value: 'day', label: 'Day' },
          { value: 'workday', label: 'Working day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'quarter', label: 'Quarter' },
        ],
        onChange: (v) => set('snap', v, 'Change snapping'),
      })),
      field('Date format', selectInput({
        value: settings.dateOrder || 'mdy',
        options: DATE_ORDERS.map((o) => ({ value: o.id, label: o.label })),
        onChange: (v) => set('dateOrder', v, 'Change date format'),
      }), 'Display only — files always store dates as YYYY-MM-DD.'),
      field('Week starts on', segmented({
        value: String(settings.weekStart),
        stretch: true,
        options: [
          { value: '1', label: 'Monday' },
          { value: '0', label: 'Sunday' },
        ],
        onChange: (v) => set('weekStart', Number(v), 'Change week start'),
      })),
      field('Count durations in', segmented({
        value: settings.durationUnit === 'calendar' ? 'calendar' : 'working',
        stretch: true,
        options: [
          { value: 'working', label: 'Working days' },
          { value: 'calendar', label: 'Calendar days' },
        ],
        onChange: (v) => {
          set('durationUnit', v, 'Change duration counting');
          renderer.requestRender();
        },
      }), 'Working days are Monday to Friday, minus the holidays below. Counting only — it never moves a bar.'),
      field('Mouse wheel', segmented({
        value: settings.wheelMode || 'zoom',
        stretch: true,
        options: [
          { value: 'zoom', label: 'Zooms' },
          { value: 'scroll', label: 'Scrolls' },
        ],
        onChange: (v) => set('wheelMode', v, 'Change wheel behaviour'),
      }), 'Ctrl/⌘ + wheel always zooms, whichever is chosen.'),
      field('Simulate "today" as', textInput({
        type: 'date',
        value: settings.todayOverride || '',
        onChange: (v) => set('todayOverride', v || null, 'Change planning date'),
      }), 'Leave empty to follow the system clock.'),
    ])
  );

  root.appendChild(
    section('Autosave & backups', [
      el('div', { class: 'cx-hint', text: 'Every edit is saved automatically. There is no Save button, and nothing is sent anywhere.' }),
      field('Automatic backup interval (minutes)', numberInput({
        value: settings.autoBackupMinutes,
        min: 0,
        max: 720,
        step: 15,
        onChange: (v) => {
          set('autoBackupMinutes', v, 'Change backup interval');
          refreshBackupSchedule();
        },
      }), '0 disables scheduled backups.'),
      field('Backup after this many edits', numberInput({
        value: settings.backupEveryEdits,
        min: 0,
        max: 1000,
        step: 25,
        onChange: (v) => set('backupEveryEdits', v, 'Change backup frequency'),
      })),
      field('Backups to keep', numberInput({
        value: settings.backupKeep,
        min: 1,
        max: 200,
        onChange: (v) => set('backupKeep', v, 'Change backup retention'),
      })),
    ])
  );

  const storageBox = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
  storageBox.appendChild(el('div', { class: 'cx-hint', text: 'Reading storage…' }));
  root.appendChild(section('Storage', [
    storageBox,
    el('button', {
      class: 'cx-btn mini',
      html: icon('trash', { size: 12 }) + '<span>Remove orphaned attachment data</span>',
      onClick: async () => {
        const removed = await collectGarbage();
        toast({ tone: 'good', title: `${removed} orphaned file${removed === 1 ? '' : 's'} removed` });
        renderPane();
      },
    }),
    // The one place a plan lingers on a machine after you have finished with
    // it. Worth being able to throw away on purpose, especially on a shared or
    // borrowed computer.
    el('button', {
      class: 'cx-btn mini danger',
      html: icon('shield', { size: 12 }) + "<span>Clear this browser's copy…</span>",
      onClick: async () => {
        const inFolder = isFileMode();
        const ok = await confirmDialog({
          title: "Clear this browser's copy?",
          message: inFolder
            ? 'Deletes the cached copy of the plan, the local snapshot history and the crash-recovery copy from this browser. ' +
              'The plan itself stays in the connected folder and is untouched — this only removes what is left behind on this machine.'
            : 'Deletes the plan, the snapshot history and any attachments held in this browser. ' +
              'This is the only copy unless you have exported one — export JSON first if you are not sure.',
          confirmLabel: 'Clear it',
          danger: true,
        });
        if (!ok) return;
        const cleared = await purgeLocalCopy();
        toast({
          tone: 'good',
          title: 'This browser is clear',
          message: inFolder
            ? `${cleared} local record${cleared === 1 ? '' : 's'} removed. The folder copy is untouched.`
            : `${cleared} local record${cleared === 1 ? '' : 's'} removed.`,
        });
        renderPane();
      },
    }),
  ]));

  usage().then((report) => {
    clear(storageBox);
    storageBox.append(
      statRow('Backend', report.backend),
      statRow('Project size', report.document.label),
      statRow('Attachments', `${report.attachments.count} file${report.attachments.count === 1 ? '' : 's'} · ${report.attachments.label}`),
      report.quota ? statRow('Browser quota', `${bytes(report.quota.used)} of ${bytes(report.quota.total)} used`) : null
    );
    if (isFallback()) {
      storageBox.appendChild(el('div', { style: { color: 'var(--warn)', fontSize: 'var(--fs-tiny)', marginTop: '4px' }, text: 'IndexedDB is unavailable in this browser session, so attachments are disabled and only a small number of backups can be kept.' }));
    }
  });

  root.appendChild(
    section('About', [
      el('div', { class: 'cx-hint', text: 'CX Timeline — a local-first interactive timeline and commissioning planner. All data stays on this computer.' }),
      el('button', { class: 'cx-btn mini', html: icon('keyboard', { size: 12 }) + '<span>Keyboard shortcuts</span>', onClick: () => cmd.showShortcuts() }),
    ])
  );
}

function statRow(label, value) {
  return el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: 'var(--fs-tiny)' } }, [
    el('span', { style: { color: 'var(--text-subtle)' }, text: label }),
    el('span', { class: 'mono', style: { color: 'var(--text-muted)' }, text: value }),
  ]);
}

/* ── Shared helpers ────────────────────────────────────────────────────── */

function iconBtn(name, title, onClick) {
  return el('button', {
    class: 'cx-btn icon mini ghost',
    title,
    'aria-label': title,
    html: icon(name, { size: 11 }),
    onClick: (e) => {
      e.stopPropagation();
      onClick(e);
    },
  });
}

/** Drag-to-resize for the dock and inspector. */
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
