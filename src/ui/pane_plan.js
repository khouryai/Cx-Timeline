/**
 * The plan's own panes: lanes, the palette, the registers, dependencies, baselines, the legend and history.
 *
 * Split out of `ui/panels.js`; see `ui/pane_util.js` for how a pane reaches the dock.
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

import { refreshPane, goToPane, iconBtn, statRow } from './pane_util.js';

/* ══════════════════════════════════════════════════════════════════════════
   Lanes
   ═══════════════════════════════════════════════════════════════════════ */

export function paneLanes(root) {
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

export function panePalette(root) {
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
            refreshPane();
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
          refreshPane();
        },
      }),
    ])
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Outline / registers
   ═══════════════════════════════════════════════════════════════════════ */

export function paneOutline(root) {
  const doc = store.getDoc();
  renderObjectRegister(root, doc.objects, {
    emptyTitle: 'No objects yet',
    emptyMessage: 'Add activities, milestones and releases from the Add menu or by double-clicking the timeline.',
    groupByLane: true,
  });
}

export function paneReleases(root) {
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

export function paneCampaigns(root) {
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

export function paneRisks(root) {
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

export function paneLinks(root) {
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
          el('button', { class: 'cx-btn mini primary', text: 'Reschedule all', onClick: () => { cmd.resolveAllViolations(); refreshPane(); } }),
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
                refreshPane();
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

export function paneBaselines(root) {
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
          refreshPane();
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
              refreshPane();
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
  root.appendChild(el('div', {
    class: 'cx-hint',
    text: 'Click the striped baseline area on the timeline to write why something moved. A row '
      + 'marked "actual" was measured against the dates somebody recorded rather than against the '
      + 'schedule — it has happened, rather than being forecast to.',
  }));
}

/**
 * One variance row, in words.
 *
 * It says whether the numbers were measured against recorded dates or against
 * the schedule, because the same "+7d" means two different things: one has
 * happened and one is a forecast, and a review that reads them alike acts on
 * the wrong half of the list.
 */
function varianceText(row) {
  if (row.change === 'added') return 'Added since baseline';
  if (row.change === 'removed') return 'Removed since baseline';
  const parts = [];
  if (row.startShift) parts.push(`start ${row.startShift > 0 ? '+' : ''}${row.startShift}d`);
  if (row.endShift) parts.push(`finish ${row.endShift > 0 ? '+' : ''}${row.endShift}d`);
  if (row.durationChange) parts.push(`duration ${row.durationChange > 0 ? '+' : ''}${row.durationChange}d`);
  const said = parts.join(' · ') || 'Reshaped';
  return row.actual ? `${said} · actual` : said;
}

/* ══════════════════════════════════════════════════════════════════════════
   Legend settings
   ═══════════════════════════════════════════════════════════════════════ */

export function paneLegendSettings(root) {
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

  const health = projectHealth(doc);
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

export function paneHistory(root) {
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
            refreshPane();
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

