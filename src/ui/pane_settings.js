/**
 * Settings and Dropdown Lists.
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
   Dropdown lists
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every editable vocabulary in one place. The same editor is behind the
 * "Manage…" row at the foot of each dropdown, so there is one behaviour to
 * learn and one implementation to maintain.
 */
export function paneLists(root) {
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

export function paneSettings(root) {
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
      toggle({
        label: 'Notes on the timeline',
        checked: settings.showNotes !== false,
        onChange: (v) => {
          set('showNotes', v, 'Toggle notes on the timeline');
          renderer.requestRender();
        },
      }),
      el('div', { class: 'cx-hint', text: 'Each object can be switched off on its own in the inspector; this hides them all at once.' }),
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
        refreshPane();
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
        refreshPane();
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

