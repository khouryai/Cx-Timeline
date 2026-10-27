/**
 * Backups: the plan's own snapshots, kept on this computer.
 *
 * Split out of `ui/panels.js`; see `ui/pane_util.js` for how a pane reaches the dock.
 */

import { el, clear, bytes, download } from '../core/util.js';
import { fmtTimestamp, toISO } from '../core/dates.js';
import * as store from '../core/store.js';
import { listBackups, loadBackup, deleteBackup, makeBackup } from '../core/storage.js';
import { icon } from './icons.js';
import { emptyState, confirmDialog, toast } from './components.js';
import * as cmd from './commands.js';

import { refreshPane, iconBtn } from './pane_util.js';

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
