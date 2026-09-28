/**
 * Organisation → Settings: the calendar's settings, changed on screen.
 *
 * They were always rows in `rc_settings`, and some could only be changed in the
 * SQL editor — which meant they were not changed. Each is one field and a Save,
 * written through `rc.setSetting()`, and the policy on `rc_settings` is what
 * lets only an administrator write them; this screen is only shown to one.
 *
 * Switching the look-ahead's source is the one setting with consequences, so
 * it is not a field: going back to the workbook asks first, exactly as the
 * editor's own menu does, and adopting the editor goes to the editor, which
 * has to import something before there is anything to write in.
 *
 * Imports: util, rc, components, rc_util, rc_la_state.
 */

import { el } from '../core/util.js';
import * as rc from '../core/rc.js';
import { textInput, toast, confirmDialog, badge } from './components.js';
import { notifyChanged, goToTab, dayLabel } from './rc_util.js';
import { la } from './rc_la_state.js';

/** How long an editor-published reading is kept whole, unless somebody says otherwise. */
export const DEFAULT_KEEP_DAYS = 60;

const value = (settings, key) => settings.find((r) => r.key === key)?.value ?? null;

export async function renderSettings(host) {
  const settings = await rc.listSettings().catch(() => []);
  const source = value(settings, 'lookahead_source') || 'workbook';

  host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Settings' })]));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'What the calendar is set to. Only an administrator can change these — the database refuses anybody else.',
  }));

  const list = el('div', { class: 'rc-settings' });
  host.appendChild(list);

  /* ── The look-ahead ─────────────────────────────────────────────────── */
  list.appendChild(group('The look-ahead'));

  list.appendChild(row({
    label: 'Where it is written',
    hint: source === 'editor'
      ? 'In the calendar\'s own editor. "Check now" does not read the workbook while this is set.'
      : 'In the Excel workbook, read on "Check now". Start writing it in the calendar from Look-ahead → Editor.',
    control: el('div', { class: 'rc-settings-inline' }, [
      badge(source === 'editor' ? 'The editor' : 'The workbook', source === 'editor' ? 'good' : 'neutral'),
      source === 'editor'
        ? el('button', {
          class: 'cx-btn mini ghost danger', type: 'button', text: 'Go back to the workbook…',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Go back to reading the workbook?',
              message: 'The calendar will read the .xlsx again the next time somebody presses Check now. '
                + 'Nothing written in the editor is deleted — it stays for the record, and you can come back to it.',
              confirmLabel: 'Go back to the workbook',
              danger: true,
            });
            if (!ok) return;
            await save('lookahead_source', 'workbook', 'The look-ahead is read from the workbook again.');
            la.source = 'workbook';
            la.section = 'calendar';
          },
        })
        : el('button', {
          class: 'cx-btn mini', type: 'button', text: 'Open the editor',
          onClick: () => {
            la.section = 'editor';
            la.sectionChosen = true;
            goToTab('lookahead');
          },
        }),
    ]),
  }));

  list.appendChild(textRow({
    key: 'lookahead_title',
    label: 'Title on the export',
    hint: 'Printed across the top of the Excel export.',
    current: value(settings, 'lookahead_title') || '',
    placeholder: 'Four Week Look-Ahead',
    said: (v) => (v ? `The export is titled "${v}".` : 'The export has no title.'),
  }));

  list.appendChild(textRow({
    key: 'lookahead_sheet',
    label: 'Sheet in the workbook',
    hint: 'The tab the grid is on, when the look-ahead is read from the workbook. Never guessed.',
    current: value(settings, 'lookahead_sheet') || '4WLA',
    placeholder: '4WLA',
    required: true,
    said: (v) => `The workbook is read from the "${v}" sheet.`,
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
    hint: 'The editor publishes a reading whenever it goes quiet. Older than this, only the last reading of each day is kept; '
      + 'every workbook read, every reading a SAR or a cancellation points at, and the change register are kept regardless.',
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

  /* ── What this is ───────────────────────────────────────────────────── */
  list.appendChild(group('About'));
  const status = await rc.schemaStatus().catch(() => ({ state: 'unknown' }));
  list.appendChild(row({
    label: 'Database version',
    hint: status.state === 'behind'
      ? 'Behind this application. Run supabase/migrate.sql and then supabase/rc_schema.sql in the Supabase SQL editor.'
      : 'Set by rc_schema.sql when it is run.',
    control: el('div', { class: 'rc-settings-inline' }, [
      el('span', { class: 'rc-settings-mono', text: String(status.found ?? value(settings, 'schema_version') ?? '—') }),
      status.state === 'behind' ? badge('Needs updating', 'bad') : null,
    ].filter(Boolean)),
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
