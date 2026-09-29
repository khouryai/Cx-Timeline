/**
 * Projects and Backups.
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
   Backups
   ═══════════════════════════════════════════════════════════════════════ */

export function paneBackups(root) {
  root.appendChild(
    el('div', { style: { display: 'flex', gap: '6px', marginBottom: '11px' } }, [
      el('button', {
        class: 'cx-btn mini primary',
        html: icon('save', { size: 12 }) + '<span>Back up now</span>',
        onClick: async () => {
          await makeBackup('manual');
          refreshPane();
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
              refreshPane();
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
export function paneProjects(root) {
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
                refreshPane();
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
    refreshPane();
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
  const name = await promptDialog({ title: 'New project', label: 'Name', value: 'Untitled Project' });
  if (!name) return;
  try {
    const doc = makeProject(name);
    await createCloudProject(doc);
    store.replaceDoc(doc, 'load');
    renderer.requestRender();
    refreshPane();
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
    else refreshPane();
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
