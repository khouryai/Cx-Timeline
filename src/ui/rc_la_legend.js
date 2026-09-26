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

