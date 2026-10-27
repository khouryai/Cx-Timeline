/**
 * The resource calendar's front door: the states that are not the calendar.
 *
 * The calendar lives in the shared folder the plan is in, under `calendar/`.
 * Before it can be drawn there has to be a folder, and the folder has to hold
 * a calendar — so the door is those two questions, and the one-time answer to
 * the second: bring the old calendar in from its backup, or start an empty one.
 *
 * Nothing here is a permission. Whoever can open the folder can open the
 * calendar; the folder's sharing is who may.
 *
 * Imports: util, events, rc, rc_import, filestore, icons, components, commands.
 */

import { el } from '../core/util.js';
import * as rc from '../core/rc.js';
import * as filestore from '../core/filestore.js';
import { readBackup } from '../core/rc_import.js';
import { writeBytes } from '../core/rc_folder.js';
import { icon } from './icons.js';
import { textInput, toast, openModal } from './components.js';
import { connectFolder, reconnectFolder } from './commands.js';

/** The registers a new calendar starts with — what `rc_schema.sql` seeded. */
export function starterTables(today) {
  return {
    rc_parties: ['Hitachi', 'BART', 'Other team', 'Vendor'].map((name) => ({ name })),
    rc_leave_kinds: [
      ['Annual leave', '#3a76e8', true], ['Sick', '#e0803a', false], ['TOIL', '#16a571', true],
      ['Training', '#9333d9', false], ['Parental', '#0d9488', false], ['Unpaid', '#6b7280', false],
    ].map(([name, color, counts]) => ({ name, color, counts_against_entitlement: counts })),
    rc_support_codes: [['X', 'EIC', 10], ['WIT', 'BART witness', 20], ['TCE', 'TCE', 30]]
      .map(([code, name, sort]) => ({ code, name, party: 'BART', sort })),
    rc_p6_flags: [['Troubleshooting', 10], ['Regression', 20], ['Support', 30]].map(([label, sort]) => ({ label, sort })),
    rc_settings: [
      { key: 'lookahead_sheet', value: '4WLA' },
      { key: 'lookahead_source', value: 'editor' },
      { key: 'cancellation_log_from', value: today },
    ],
  };
}

/** This build cannot open a folder at all: a browser without the File System Access API. */
export function notConfigured() {
  return el('div', { class: 'rc-state' }, [
    el('div', { class: 'rc-state-icon', html: icon('database', { size: 32 }) }),
    el('h2', { text: 'The calendar needs a folder' }),
    el('p', {
      text: 'The resource calendar is kept in the shared folder beside the plan. Opening a folder '
        + 'needs the CX Timeline desktop application, or Edge or Chrome.',
    }),
  ]);
}

/** Who you are: the name the pen shows and the calendar stamps what you write with. */
function nameField() {
  const input = textInput({ value: rc.displayName(), placeholder: 'Your name, as the roster has it' });
  input.setAttribute('aria-label', 'Your name');
  input.dataset.field = 'your-name';
  return input;
}

function saveName(input) {
  const name = input.value.trim();
  if (!name) throw new Error('Say who you are first — your name, as the roster has it.');
  if (name !== rc.displayName()) filestore.setDisplayName(name);
}

/** No folder connected yet. */
export function noFolder({ onDone = () => {} } = {}) {
  const remembered = el('div');
  filestore.storedFolder().then((last) => {
    if (!last?.folder || filestore.state().desktop) return;
    remembered.appendChild(el('button', {
      class: 'cx-btn ghost', type: 'button', text: `Reconnect to ${last.folder}`,
      onClick: async () => { if (await reconnectFolder()) onDone(); },
    }));
  }).catch(() => {});
  return el('div', { class: 'rc-state' }, [
    el('div', { class: 'rc-state-icon', html: icon('folder', { size: 32 }) }),
    el('h2', { text: 'Open the shared folder' }),
    el('p', {
      text: 'The calendar is kept in the same OneDrive folder as the plan, under calendar/. '
        + 'Open that folder and the calendar opens with it — nothing is kept anywhere else.',
    }),
    el('div', { class: 'rc-signin' }, [
      el('button', {
        class: 'cx-btn primary', type: 'button', text: 'Open the folder…',
        onClick: async () => { if (await connectFolder()) onDone(); },
      }),
      remembered,
    ]),
  ]);
}

/**
 * A folder with no calendar in it: bring the old one in, or start empty.
 *
 * The import is offered first because it is the one that matters: the old
 * calendar's backup carries every reading, edit, reason and TAWR, and an
 * empty calendar started by mistake would have to be cleared before it could
 * be brought in.
 */
export function emptyFolder({ onDone = () => {} } = {}) {
  const name = nameField();
  const error = el('div', { class: 'rc-error', hidden: true });
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.dataset.field = 'backup';

  const say = (err) => {
    error.textContent = err?.message || String(err);
    error.hidden = false;
  };

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      saveName(name);
      const parsed = readBackup(JSON.parse(await file.text()));
      await confirmImport(parsed, file.name, onDone);
    } catch (err) {
      say(err);
    }
  });

  return el('div', { class: 'rc-state' }, [
    el('div', { class: 'rc-state-icon', html: icon('database', { size: 32 }) }),
    el('h2', { text: 'This folder has no calendar yet' }),
    el('p', {
      text: `${filestore.state().folder || 'The folder'} is open, and there is no calendar/ in it. `
        + 'Bring the old calendar in from its backup — taken in the old calendar under Reports → Back it up — '
        + 'or start an empty one.',
    }),
    el('div', { class: 'rc-signin' }, [
      name,
      error,
      el('button', {
        class: 'cx-btn primary', type: 'button', text: 'Import the old calendar…',
        dataset: { action: 'import' },
        onClick: () => {
          try {
            saveName(name);
            fileInput.click();
          } catch (err) {
            say(err);
          }
        },
      }),
      el('button', {
        class: 'cx-btn ghost', type: 'button', text: 'Start an empty calendar',
        dataset: { action: 'start-empty' },
        onClick: async () => {
          try {
            saveName(name);
            await rc.createCalendar(starterTables(new Date().toISOString().slice(0, 10)), { source: 'new' });
            toast({ tone: 'good', message: 'An empty calendar is ready in calendar/.' });
            onDone();
          } catch (err) {
            say(err);
          }
        },
      }),
      fileInput,
    ]),
  ]);
}

/** What is in the backup, and what is not coming, before anything is written. */
function confirmImport(parsed, fileName, onDone) {
  return new Promise((resolve) => {
    const kept = parsed.summary.filter((s) => !s.dropped);
    const dropped = parsed.summary.filter((s) => s.dropped);
    const total = kept.reduce((n, s) => n + s.rows, 0);
    const list = (items, render) => el('ul', { class: 'rc-import-list' }, items.map((s) => el('li', { text: render(s) })));
    const body = el('div', { class: 'cx-form' }, [
      el('p', {
        text: `${fileName}${parsed.exportedAt ? `, taken ${new Date(parsed.exportedAt).toLocaleString()}` : ''}`
          + `${parsed.exportedBy ? ` by ${parsed.exportedBy}` : ''}: ${total} rows in ${kept.length} tables.`,
      }),
      parsed.warnings.length
        ? el('div', { class: 'rc-error', role: 'alert' }, [list(parsed.warnings.map((w) => ({ w })), (x) => x.w)])
        : null,
      list(kept, (s) => `${s.table.replace(/^rc_/, '').replace(/_/g, ' ')} — ${s.rows}`),
      dropped.length
        ? el('p', {
          class: 'rc-hint',
          text: `Not brought across, because the calendar no longer has them: ${[...new Set(dropped.map((d) => d.dropped))].join(', ')}.`,
        })
        : null,
    ].filter(Boolean));
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    openModal({
      title: 'Bring the old calendar in?',
      body,
      onClose: () => done(false),
      actions: [
        { label: 'Cancel', onClick: () => done(false) },
        {
          label: 'Import',
          kind: 'primary',
          keepOpen: true,
          onClick: async (handle) => {
            try {
              await rc.createCalendar(parsed.tables, { source: 'import' });
              for (const [path, bytes] of Object.entries(parsed.files)) await writeBytes(path, bytes);
              done(true);
              handle.close();
              toast({ tone: 'good', title: 'The old calendar is in the folder', message: `${total} rows, every id kept.` });
              onDone();
            } catch (err) {
              toast({ tone: 'bad', title: 'The import did not finish', message: err?.message || String(err) });
            }
          },
        },
      ],
    });
  });
}

/** The folder could not be read — half-synced, or written by a newer version. */
export function readFailed(message, { onDone = () => {} } = {}) {
  return el('div', { class: 'rc-state' }, [
    el('div', { class: 'rc-state-icon', html: icon('warning', { size: 32 }) }),
    el('h2', { text: 'The calendar could not be read' }),
    el('p', { text: message || 'Something in calendar/ could not be read.' }),
    el('button', {
      class: 'cx-btn', type: 'button', text: 'Try again',
      onClick: async () => { await rc.init(); onDone(); },
    }),
  ]);
}
