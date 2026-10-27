/**
 * Lists → Settings: the calendar's settings, changed on screen.
 *
 * Each is one row in `rc_settings`, one field and a Save, written through
 * `rc.setSetting()`. The calendar is in the shared folder, so a setting
 * changed here is changed for everybody who opens it.
 *
 * Imports: util, rc, components, rc_util, io/exporters.
 */

import { el } from '../core/util.js';
import * as rc from '../core/rc.js';
import { textInput, toast } from './components.js';
import { notifyChanged, dayLabel, todayISO } from './rc_util.js';
import { saveFile } from '../io/exporters.js';

/** How long an editor-published reading is kept whole, unless somebody says otherwise. */
export const DEFAULT_KEEP_DAYS = 60;

const value = (settings, key) => settings.find((r) => r.key === key)?.value ?? null;

export async function renderSettings(host) {
  const settings = await rc.listSettings().catch(() => []);

  host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Settings' })]));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'What the calendar is set to. They are kept in the shared folder, so they are the same for everybody who opens it.',
  }));

  const list = el('div', { class: 'rc-settings' });
  host.appendChild(list);

  /* ── The look-ahead ─────────────────────────────────────────────────── */
  list.appendChild(group('The look-ahead'));

  list.appendChild(textRow({
    key: 'lookahead_title',
    label: 'Title on the export',
    hint: 'Printed across the top of the Excel export.',
    current: value(settings, 'lookahead_title') || '',
    placeholder: 'Four Week Look-Ahead',
    said: (v) => (v ? `The export is titled "${v}".` : 'The export has no title.'),
  }));

  list.appendChild(textRow({
    key: 'cancellation_log_from',
    label: 'Cancellation log starts on',
    hint: 'The first day the cancellation log counts — a date from the contract, not from the code.',
    current: value(settings, 'cancellation_log_from') || '',
    type: 'date',
    required: true,
    said: (v) => `The cancellation log starts on ${dayLabel(v)}.`,
  }));

  /* ── Keeping the record tidy ────────────────────────────────────────── */
  list.appendChild(group('Housekeeping'));
  list.appendChild(textRow({
    key: 'snapshot_keep_days',
    label: 'Keep every editor reading for',
    hint: 'The editor takes a reading when you finish editing, and when it has been quiet a while. Older than this, only the last reading of each day keeps its grid; '
      + 'every workbook read, every reading\'s rows and the change register are kept regardless.',
    current: value(settings, 'snapshot_keep_days') || String(DEFAULT_KEEP_DAYS),
    type: 'number',
    suffix: 'days',
    required: true,
    check: (v) => (Number.isInteger(Number(v)) && Number(v) >= 14 ? null : 'At least 14 days, in whole days.'),
    said: (v) => `Editor readings are kept whole for ${v} days.`,
  }));

  list.appendChild(row({
    label: 'Tidy the readings now',
    hint: 'The editor does this once a day on its own. Only the grids of superseded editor readings go — the readings, their rows and every link to them stay.',
    control: el('div', { class: 'rc-settings-inline' }, [
      el('button', {
        class: 'cx-btn mini', type: 'button', text: 'Tidy now',
        onClick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const n = await rc.compactSnapshots();
            toast({
              tone: 'good',
              message: n ? `${n} older reading${n === 1 ? '' : 's'} compacted.` : 'Nothing to tidy — every reading is within the keep period or the last of its day.',
            });
          } catch (err) {
            toast({ tone: 'bad', message: err?.message || String(err) });
          } finally {
            e.currentTarget.disabled = false;
          }
        },
      }),
    ]),
  }));

  /* ── Where it is ─────────────────────────────────────────────────────── */
  list.appendChild(group('Where it is'));
  list.appendChild(row({
    label: 'Folder',
    hint: 'The calendar is the calendar/ folder inside the shared folder the plan is in. '
      + 'OneDrive keeps every version of every file in it, under Version history.',
    control: el('span', { class: 'rc-settings-mono', text: `${rc.status().folder || '—'}/calendar` }),
  }));
  list.appendChild(row({
    label: 'A copy of everything',
    hint: 'Every table as one file, with BART\'s blank TAWR form. It opens in an empty folder through the same import the old calendar came in by.',
    control: el('button', {
      class: 'cx-btn mini', type: 'button', text: 'Back it up',
      onClick: async () => {
        try {
          const data = await rc.exportEverything();
          const rows = Object.values(data.tables).reduce((n, t) => n + (Array.isArray(t) ? t.length : 0), 0);
          saveFile(`resource-calendar-${todayISO()}.json`, JSON.stringify(data), 'application/json',
            `${rows} rows across ${Object.keys(data.tables).length} tables`);
        } catch (err) {
          toast({ tone: 'bad', message: err?.message || String(err) });
        }
      },
    }),
  }));
}

function group(title) {
  return el('div', { class: 'rc-settings-group', text: title });
}

function row({ label, hint, control }) {
  return el('div', { class: 'rc-settings-row' }, [
    el('div', { class: 'rc-settings-label' }, [
      el('div', { class: 'rc-settings-name', text: label }),
      hint ? el('div', { class: 'rc-hint', text: hint }) : null,
    ].filter(Boolean)),
    el('div', { class: 'rc-settings-control' }, [control]),
  ]);
}

/**
 * A setting that is a piece of text, a date or a number: the field, and a Save
 * that stays greyed until something changed. Enter saves too.
 */
function textRow({ key, label, hint, current, placeholder = '', type = 'text', suffix = '', required = false, check = null, said }) {
  const input = textInput({ value: current, placeholder });
  input.type = type;
  input.setAttribute('aria-label', label);
  input.dataset.setting = key;
  if (type === 'number') { input.min = '14'; input.step = '1'; input.style.width = '90px'; }
  const button = el('button', { class: 'cx-btn mini', type: 'button', text: 'Save', disabled: true });
  const sync = () => { button.disabled = input.value.trim() === String(current).trim(); };
  input.addEventListener('input', sync);
  const commit = async () => {
    const v = input.value.trim();
    if (v === String(current).trim()) return;
    if (required && !v) {
      toast({ tone: 'warn', message: `${label} cannot be empty.` });
      return;
    }
    const problem = check?.(v);
    if (problem) {
      toast({ tone: 'warn', message: problem });
      return;
    }
    if (await save(key, v, said(v))) {
      current = v;
      sync();
    }
  };
  button.addEventListener('click', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
  return row({
    label,
    hint,
    control: el('div', { class: 'rc-settings-inline' }, [
      input,
      suffix ? el('span', { class: 'rc-hint', style: 'margin:0', text: suffix }) : null,
      button,
    ].filter(Boolean)),
  });
}

async function save(key, v, message) {
  try {
    await rc.setSetting(key, v);
    toast({ tone: 'good', message });
    notifyChanged('settings');
    return true;
  } catch (err) {
    toast({ tone: 'bad', message: err?.message || String(err) });
    return false;
  }
}
