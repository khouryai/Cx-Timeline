/**
 * Look-ahead → Legend: the register of what each colour means and does.
 *
 * Imports: util, rc, io/lookahead, core/lookahead, icons, components, rc_util,
 *          rc_la_state, rc_ingest.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import * as filestore from '../core/filestore.js';
import { parseSheet, applyLegend, readLegend, isDark } from '../io/lookahead.js';
import { calendarPdf, calendarFit, PAGE_CHOICES } from '../io/rc_pdf.js';
import { saveFile } from '../io/exporters.js';
import {
  keyRows, classify, relinkCandidates, countable, describe, readGrid, rowsFrom, marksOf,
  reassignments, ABSENCE_LABELS, cancellationEvents, attachCancellationNotes,
} from '../core/lookahead.js';
import { icon } from './icons.js';
import {
  selectInput, textInput, toast, badge, emptyState, field, checkbox, confirmDialog, chipStat,
} from './components.js';
import {
  notifyChanged, byId, dayLabel, todayISO, formModal, parsedView,
  isoToMs, nameRegister, foldName,
} from './rc_util.js';
import { toISO, addDays } from '../core/dates.js';

import { la, table, WEEK_CHOICES } from './rc_la_state.js';
import { checkNowButton } from './rc_ingest.js';

/* ══════════════════════════════════════════════════════════════════════════
   The legend
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * What the colours mean, and which sheet to read.
 *
 * The register is the authority, not the workbook: the file's own key is
 * adopted once into an empty register and never again, so a colour somebody
 * has mapped by hand cannot be silently reinterpreted by an edit to the
 * spreadsheet. Where the two disagree, both are shown and the person decides.
 */
export async function renderLegend(host) {
  const [legend, snapshot, settings] = await Promise.all([
    rc.listLegend({ includeInactive: true }),
    rc.latestSnapshot(),
    rc.listSettings().catch(() => []),
  ]);
  const sheet = settings.find((r) => r.key === 'lookahead_sheet')?.value || '4WLA';

  /* ── Which sheet ─────────────────────────────────────────────────────── */
  host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Which sheet' })]));
  const sheetField = textInput({ value: sheet, placeholder: '4WLA' });
  host.appendChild(el('div', { style: 'display:flex;gap:8px;max-width:420px' }, [
    sheetField,
    el('button', {
      class: 'cx-btn mini',
      text: 'Save',
      onClick: async () => {
        try {
          await rc.setSetting('lookahead_sheet', sheetField.value.trim());
          toast({ tone: 'good', message: `The look-ahead will be read from "${sheetField.value.trim()}".` });
        } catch (err) {
          toast({ tone: 'bad', message: err.message });
        }
      },
    }),
  ]));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'The tab the grid is on. It is never guessed: if no sheet by this name is visible, the '
      + 'read stops and says so, because falling back to the first sheet would report a cover '
      + 'page as a week of no work.',
  }));

  /* ── Support codes ───────────────────────────────────────────────────── */
  host.appendChild(el('div', { style: 'height:24px' }));
  await supportCodes(host);

  /* ── The register ────────────────────────────────────────────────────── */
  host.appendChild(el('div', { style: 'height:24px' }));
  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'What the colours mean' }),
    el('button', {
      class: 'cx-btn mini primary',
      html: icon('plus', { size: 12 }) + '<span>Add colour</span>',
      onClick: () => editLegend(null),
    }),
  ]));

  if (!legend.length) {
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Nothing mapped yet. The first read adopts the key the workbook writes down about '
        + 'itself, if it has one — a block of rows painted one colour each with a label beside '
        + 'them. After that the register is the authority and the file cannot overrule it.',
    }));
  } else {
    host.appendChild(table(
      ['', 'Colour', 'Means', 'Counts as', 'In force from', ''],
      legend.map((entry) => el('tr', { class: entry.active ? '' : 'rc-inactive' }, [
        el('td', {}, [el('span', { class: 'la-swatch', style: `background:#${entry.argb}` })]),
        el('td', { class: 'rc-num', text: `#${entry.argb}` }),
        el('td', { text: entry.meaning }),
        el('td', {}, [roleBadge(entry.role || 'shift')]),
        el('td', { text: entry.valid_from || '—' }),
        el('td', {}, [
          el('button', { class: 'cx-btn mini ghost', text: 'Edit', onClick: () => editLegend(entry) }),
          el('button', {
            class: 'cx-btn mini ghost',
            text: entry.active ? 'Retire' : 'Restore',
            title: 'Retiring keeps it against every snapshot already read with it.',
            onClick: async () => {
              await rc.updateLegend(entry.id, { active: !entry.active });
              notifyChanged('legend');
            },
          }),
          /* Delete, beside Retire, because the two differ on one thing and it
             matters here more than anywhere. A retired row still *shadows* an
             older row for the same colour — `inForce()` picks the newest before
             the active filter is applied on some paths — so retiring a mistake
             leaves the mistake deciding what the colour means. Deleting it puts
             the colour back where a wrong answer belongs: in the "not in the
             legend" list, one click from being answered again. */
          el('button', {
            class: 'cx-btn mini ghost danger',
            text: 'Delete',
            title: 'Removes the mapping outright. The colour goes back to unmapped, and every '
              + 'snapshot is re-read against the register at paint time, so nothing is lost.',
            onClick: async () => {
              const ok = await confirmDialog({
                title: `Delete the mapping for #${entry.argb}?`,
                message: `"${entry.meaning}" stops being what that colour means. It goes back into `
                  + '"Seen in the workbook, not in the legend", where it can be mapped again. '
                  + 'Retire it instead if you want the mapping kept on the record.',
                confirmLabel: 'Delete',
                danger: true,
              });
              if (!ok) return;
              try {
                await rc.deleteLegend(entry.id);
                toast({ tone: 'good', message: 'Deleted.' });
                notifyChanged('legend');
              } catch (err) {
                toast({ tone: 'bad', message: err?.message || String(err) });
              }
            },
          }),
        ]),
      ]))
    ));
  }

  /* ── What is not mapped ──────────────────────────────────────────────── */
  const unknown = snapshot?.grid
    ? parsedView(snapshot, legend.filter((l) => l.active)).unknown
    : [];

  host.appendChild(el('div', { style: 'height:24px' }));
  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'Seen in the workbook, not in the legend' }),
  ]));

  if (!unknown.length) {
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: snapshot ? 'Every colour on the last snapshot is accounted for.' : 'Nothing read yet.',
    }));
  } else {
    host.appendChild(table(
      ['', 'Colour', 'Cells', 'For example', ''],
      unknown.map((u) => el('tr', {}, [
        el('td', {}, [el('span', { class: 'la-swatch', style: `background:#${u.hex}` })]),
        el('td', { class: 'rc-num', text: `#${u.hex}` }),
        el('td', { class: 'rc-num', text: String(u.count) }),
        el('td', { text: (u.samples || []).join(', ') }),
        el('td', {}, [
          /* One click, no dialog. The common case by a wide margin is a grey
             the spreadsheet shades its layout with, and making somebody name
             it before they can dismiss it is why forty rows of shading sat on
             screen counting as work. */
          el('button', {
            class: 'cx-btn mini',
            text: 'Just shading',
            title: 'Structure in the spreadsheet, not somebody on site. Rows whose only paint is '
              + 'this will drop out of the calendar.',
            onClick: async () => {
              try {
                await rc.addLegend([{ argb: u.hex, meaning: 'Shading', role: 'ignore' }]);
                notifyChanged('legend');
                toast({ tone: 'good', message: `#${u.hex} is shading — rows painted only with it are out.` });
              } catch (err) {
                toast({ tone: 'bad', message: err.message });
              }
            },
          }),
          el('button', {
            class: 'cx-btn mini primary',
            text: 'Say what it means',
            onClick: () => editLegend({ argb: u.hex }),
          }),
        ]),
      ]))
    ));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Nothing here was guessed, and that is deliberate — guessing would classify a shift '
        + 'wrongly with nothing on screen to show it happened. Until somebody says, a colour '
        + 'counts as work and keeps its rows on the calendar, drawn with a hatch. Most of these '
        + 'are one of two things: a grey the spreadsheet shades its layout with, which is what '
        + '"Just shading" is for, or a near miss of a legend colour picked out of Excel’s recent '
        + 'colours, which wants naming properly.',
    }));
  }
}

/**
 * What a colour *does*, as opposed to what it is called.
 *
 * The distinction exists because this workbook greys most of its calendar for
 * structure: forty-odd rows are shaded right across the window with no work in
 * them at all. Reading that as a shift made every row look busy every day, and
 * no wording of the meaning would have fixed it — "not scheduled" is still a
 * meaning. So the register says what to *do* with the colour, separately.
 */
const LEGEND_ROLES = [
  { value: 'shift', label: 'Work — somebody is on site that day' },
  { value: 'ignore', label: 'Shading — structure, not work' },
  { value: 'divider', label: 'Section band' },
];

function roleBadge(role) {
  if (role === 'ignore') return badge('Shading', 'neutral');
  if (role === 'divider') return badge('Section', 'neutral');
  return badge('Work', 'info');
}

function editLegend(entry) {
  const argb = textInput({
    value: entry?.argb || '',
    placeholder: 'FFFF00',
  });
  const meaning = textInput({ value: entry?.meaning || '', placeholder: 'Day Shift' });
  const role = selectInput({ value: entry?.role || 'shift', options: LEGEND_ROLES });
  const swatch = el('span', { class: 'la-swatch', style: `background:#${entry?.argb || 'ffffff'}` });
  argb.addEventListener('input', () => {
    swatch.style.background = `#${argb.value.replace(/[^0-9a-f]/gi, '')}`;
  });

  formModal({
    title: entry?.id ? 'Edit what this colour means' : 'Map a colour',
    body: el('div', { class: 'cx-form' }, [
      field('Colour', el('div', { style: 'display:flex;align-items:center;gap:8px' }, [swatch, argb]),
        'The six hex digits, as the workbook painted it. Every notation Excel uses — a literal '
        + 'value, a theme colour with a tint, the legacy palette — is resolved to this one form '
        + 'before it is looked up, so the legend is keyed on the colour rather than on how it '
        + 'happened to be written.'),
      field('Means', meaning, 'In the words the look-ahead uses: Day Shift, Cancellation, Blanket.'),
      field('Counts as', role, 'Whether a day painted this colour is work. The look-ahead greys '
        + 'most of its calendar for structure rather than for shifts, and counting that as work '
        + 'would make every row look busy on every day.'),
    ]),
    confirmLabel: entry?.id ? 'Save' : 'Map it',
    onConfirm: async () => {
      const hex = argb.value.replace(/[^0-9a-f]/gi, '').toUpperCase();
      if (hex.length !== 6) throw new Error('Six hex digits, like FFFF00.');
      if (!meaning.value.trim()) throw new Error('Say what it means.');
      const patch = { argb: hex, meaning: meaning.value.trim(), role: role.value };
      if (entry?.id) await rc.updateLegend(entry.id, patch);
      else await rc.addLegend([patch]);
      notifyChanged('legend');
      toast({ tone: 'good', message: `#${hex} means "${meaning.value.trim()}".` });
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Support codes
   ═══════════════════════════════════════════════════════════════════════ */

const PARTIES = ['BART', 'Hitachi', 'Other'];

/**
 * What each code typed into a day asks for.
 *
 * "X.WIT" on a day is one EIC and one BART witness; "X.X" is two EICs. The
 * register lives here, beside the colours, because it is the same kind of
 * thing: the sheet's shorthand, written down once so the editor can count it,
 * the export can key it and nobody has to remember what "TCE" stood for. A
 * code is retired rather than deleted — days already written with it keep
 * meaning what they meant.
 */
async function supportCodes(host) {
  const codes = await rc.listSupportCodes({ includeRetired: true }).catch(() => []);
  const wrap = el('div', { class: 'lae-codes-admin' });
  wrap.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'Support codes' }),
    el('button', {
      class: 'cx-btn mini primary',
      html: icon('plus', { size: 12 }) + '<span>Add a code</span>',
      onClick: () => editCode(null, codes),
    }),
  ]));
  wrap.appendChild(el('p', {
    class: 'rc-hint',
    text: 'What the letters typed into a day ask for: "X.WIT" is one of each, "X.X" is two. The editor offers '
      + 'these as one-press buttons, totals them per day and per activity, and the Excel export prints this key '
      + 'under the sheet. A code nobody has registered is kept as typed and marked, never guessed at.',
  }));
  if (!codes.length) {
    wrap.appendChild(el('p', { class: 'rc-hint', text: 'No codes yet.' }));
  } else {
    wrap.appendChild(table(
      ['Code', 'Asks for', 'Party', ''],
      codes.map((c) => el('tr', { class: c.active === false ? 'rc-inactive' : '' }, [
        el('td', {}, [el('span', { class: 'lae-code', text: String(c.code).toUpperCase() })]),
        el('td', { text: c.name || '—' }),
        el('td', { text: c.party || '—' }),
        el('td', { style: 'text-align:right;white-space:nowrap' }, [
          el('button', { class: 'cx-btn mini ghost', text: 'Edit', onClick: () => editCode(c, codes) }),
          el('button', {
            class: 'cx-btn mini ghost',
            text: c.active === false ? 'Restore' : 'Retire',
            title: c.active === false ? 'Offer it again' : 'Stop offering it. Days already written with it are left as they are.',
            onClick: async () => {
              try {
                await rc.updateSupportCode(c.id, { active: c.active === false });
                notifyChanged('support-codes');
              } catch (err) {
                toast({ tone: 'bad', message: err.message });
              }
            },
          }),
        ]),
      ])),
    ));
  }
  host.appendChild(wrap);
}

function editCode(existing, codes) {
  const code = textInput({ value: existing?.code || '', placeholder: 'X', maxlength: '8' });
  const name = textInput({ value: existing?.name || '', placeholder: 'EIC' });
  const party = selectInput({ value: existing?.party || 'BART', options: PARTIES });
  formModal({
    title: existing ? `Support code ${String(existing.code).toUpperCase()}` : 'Add a support code',
    confirmLabel: existing ? 'Save' : 'Add',
    body: el('div', { class: 'lae-form' }, [
      el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Code, as typed on the sheet' }), code]),
      el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'What it asks for' }), name]),
      el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Who provides it' }), party]),
    ]),
    onConfirm: async () => {
      const value = code.value.trim().toUpperCase();
      if (!/^[A-Z0-9]{1,8}$/.test(value)) throw new Error('A code is one to eight letters or digits, with no dots — the dots separate codes.');
      const clash = codes.find((c) => String(c.code).toUpperCase() === value && c.id !== existing?.id);
      if (clash) throw new Error(`${value} is already a code${clash.active === false ? ' (retired — restore it instead)' : ''}.`);
      const row = { code: value, name: name.value.trim(), party: party.value };
      if (existing) await rc.updateSupportCode(existing.id, row);
      else await rc.addSupportCode({ ...row, active: true, sort: Math.max(0, ...codes.map((c) => c.sort || 0)) + 10 });
      notifyChanged('support-codes');
    },
  });
}
