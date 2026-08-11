/**
 * Attachments.
 *
 * File bytes live in IndexedDB, keyed by attachment id; the document holds
 * only a lightweight record (name, type, size, when it was added). That split
 * is what lets a project carry a 40 MB test log without every autosave having
 * to rewrite it.
 *
 * The storage layer is deliberately behind one small interface here, so a
 * future "link to a file on disk" or "sync to SharePoint" backend can be added
 * without touching the UI.
 *
 * Imports: util, events, dates, storage, store, icons, components.
 */

import { el, clear, uid, bytes, download, pickFiles } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { fmtTimestamp } from '../core/dates.js';
import { putBlob, getBlob, deleteBlob, isFallback } from '../core/storage.js';
import { getDoc, getObject, updateObject, addAttachmentRecord, removeAttachmentRecord, getAttachment } from '../core/store.js';
import { icon } from './icons.js';
import { toast, confirmDialog } from './components.js';

/** Icon for a file, chosen from its extension. */
export function iconForFile(name = '', type = '') {
  const ext = String(name).split('.').pop().toLowerCase();
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'document';
  if (['xls', 'xlsx', 'xlsm', 'csv', 'tsv'].includes(ext)) return 'table';
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'file';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'package';
  if (['log', 'txt', 'md'].includes(ext)) return 'list';
  if (['json', 'xml', 'yml', 'yaml'].includes(ext)) return 'cpu';
  return 'paperclip';
}

/**
 * Attach files to an object. Returns the ids that were stored.
 * Failures are reported per file so one bad file does not lose the rest.
 */
export async function attachFiles(objectId, files) {
  if (isFallback()) {
    toast({
      tone: 'warn',
      title: 'Attachments unavailable',
      message: 'This browser session has no IndexedDB, so file bytes cannot be stored locally.',
    });
    return [];
  }

  const obj = getObject(objectId);
  if (!obj) return [];

  const stored = [];
  for (const file of files) {
    const id = uid('att');
    try {
      await putBlob(id, file);
      addAttachmentRecord({
        id,
        name: file.name,
        type: file.type || '',
        size: file.size,
        added: Date.now(),
        storage: 'idb',
      });
      stored.push(id);
    } catch (err) {
      console.error('[cx-timeline] attachment failed:', err);
      toast({ tone: 'bad', title: `Could not attach ${file.name}`, message: err.message });
    }
  }

  if (stored.length) {
    const current = getObject(objectId);
    updateObject(objectId, { attachments: [...(current.attachments || []), ...stored] }, 'Attach files');
    toast({ tone: 'good', title: `${stored.length} file${stored.length === 1 ? '' : 's'} attached` });
  }
  return stored;
}

/** Open the picker and attach whatever the user chooses. */
export async function promptAttach(objectId) {
  const files = await pickFiles({ multiple: true });
  if (files.length) await attachFiles(objectId, files);
}

/** Save an attachment back out to the user's disk. */
export async function downloadAttachment(id) {
  const record = getAttachment(id);
  const stored = await getBlob(id);
  if (!stored || !stored.blob) {
    toast({ tone: 'bad', title: 'File missing', message: 'The stored bytes for this attachment could not be found.' });
    return;
  }
  const filename = record?.name || stored.name || 'attachment';
  download(filename, stored.blob, stored.type);
  // Nothing on screen changes when a file leaves the browser, so say it did.
  toast({ tone: 'good', title: 'File downloaded', message: `${filename} · ${bytes(stored.blob.size)} — saved to your downloads.` });
}

/** Open an attachment in a new tab where the browser can display it. */
export async function openAttachment(id) {
  const stored = await getBlob(id);
  if (!stored || !stored.blob) {
    toast({ tone: 'bad', title: 'File missing' });
    return;
  }
  const url = URL.createObjectURL(stored.blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Detach from one object, and delete the bytes if nothing else refers to it. */
export async function detachFile(objectId, attachmentId) {
  const obj = getObject(objectId);
  if (!obj) return;

  updateObject(objectId, { attachments: (obj.attachments || []).filter((a) => a !== attachmentId) }, 'Remove attachment');

  const stillUsed = getDoc().objects.some((o) => (o.attachments || []).includes(attachmentId));
  if (!stillUsed) {
    removeAttachmentRecord(attachmentId);
    try {
      await deleteBlob(attachmentId);
    } catch {
      /* the record is gone either way; orphaned bytes are collected later */
    }
  }
}

/**
 * The attachment list widget used by the inspector and the object editor.
 * Supports click-to-pick and drag-and-drop.
 */
export function attachmentList(objectId, { onChange = null } = {}) {
  const root = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
  const list = el('div', { class: 'att-list' });

  const drop = el('div', {
    class: 'att-drop',
    html: icon('paperclip', { size: 14 }) + ' <span>Drop files here, or click to browse</span>',
    onClick: async () => {
      await promptAttach(objectId);
      refresh();
      onChange?.();
    },
  });

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) {
      await attachFiles(objectId, files);
      refresh();
      onChange?.();
    }
  });

  function refresh() {
    clear(list);
    const obj = getObject(objectId);
    const ids = obj?.attachments || [];
    if (!ids.length) {
      list.appendChild(el('div', { class: 'cx-hint', text: 'No files attached.' }));
      return;
    }
    for (const id of ids) {
      const record = getAttachment(id);
      if (!record) continue;
      list.appendChild(
        el('div', { class: 'att-row' }, [
          el('span', { class: 'att-icon', html: icon(iconForFile(record.name, record.type), { size: 14 }) }),
          el('div', { class: 'att-main' }, [
            el('div', { class: 'att-name', text: record.name, title: record.name }),
            el('div', { class: 'att-meta', text: `${bytes(record.size)} · ${fmtTimestamp(record.added)}` }),
          ]),
          el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Open',
            'aria-label': `Open ${record.name}`,
            html: icon('external', { size: 12 }),
            onClick: () => openAttachment(id),
          }),
          el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Download',
            'aria-label': `Download ${record.name}`,
            html: icon('download', { size: 12 }),
            onClick: () => downloadAttachment(id),
          }),
          el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Remove',
            'aria-label': `Remove ${record.name}`,
            html: icon('trash', { size: 12 }),
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Remove attachment',
                message: `Remove "${record.name}" from this object? The stored file is deleted if nothing else references it.`,
                confirmLabel: 'Remove',
                danger: true,
              });
              if (!ok) return;
              await detachFile(objectId, id);
              refresh();
              onChange?.();
            },
          }),
        ])
      );
    }
  }

  refresh();
  root.append(list, drop);
  return { root, refresh };
}
