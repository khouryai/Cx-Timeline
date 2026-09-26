/**
 * Import / Export, and the shared folder.
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
    /* The pen is a turn among people who can write. An account the calendar
       says may not edit the plan has no turn to take, so the button is not
       offered and the reason is said instead — `filestore.takeOver()` would
       refuse it anyway, and a button that always refuses is worse than none. */
    if (!editing && access.planLocked()) {
      rows.push(el('div', { class: 'cx-hint', text: access.lockReason() }));
    } else if (!editing) {
      rows.push(wideBtn('Take over editing', 'refresh', () => cmd.takeOverEditing()));
    }
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

  // Other plans sitting in the folder, so switching projects does not mean
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

export function paneIo(root) {
  root.appendChild(sharedFolderSection());

  root.appendChild(
    section('Export', [
      el('div', { class: 'cx-hint', text: 'PDF, print, SVG, PNG and JPEG all draw the same picture. What goes in it is up to you.' }),
      el('button', {
        class: 'cx-btn mini',
        style: { justifyContent: 'flex-start', width: '100%', marginBottom: '4px' },
        html: icon('sliders', { size: 12 }) + '<span>Drawing options…</span>',
        onClick: () => openExportOptions(() => refreshPane()),
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

export function exportMenu(anchor) {
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

export function openExportOptions(onClose = () => {}) {
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
      toggle({ label: 'Notes written on objects', checked: cfg.showNotes !== false, onChange: (v) => set({ showNotes: v }) }),
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
              refreshPane();
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
    cfg.showNotes !== false ? 'notes' : null,
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

