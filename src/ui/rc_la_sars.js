/**
 * Look-ahead → Site access: SARs, filed and linked to the rows they cover.
 *
 * Imports: util, rc, filestore, components, rc_util, rc_la_state.
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

const SAR_INBOX = 'sars/inbox';
/** Where a recorded SAR is filed, under the week it authorised. */
const SAR_ARCHIVE = 'sars';

/* ══════════════════════════════════════════════════════════════════════════
   Site access
   ═══════════════════════════════════════════════════════════════════════ */

export async function renderSars(host) {
  const [sars, locations, without, unlinked, waiting] = await Promise.all([
    rc.listSars(),
    rc.listLocations(),
    rc.listRowsWithoutSar(),
    rc.listSarsWithoutRows(),
    // What is sitting in the inbox, unrecorded. The folder is the front door
    // for these — somebody saves the PDF from an email and that is the whole
    // filing step they should have to do.
    filestore.hasFolder()
      ? filestore.intakeList(SAR_INBOX).catch(() => [])
      : Promise.resolve([]),
  ]);
  const locs = byId(locations);

  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'Site access requests' }),
    el('button', {
      class: 'cx-btn mini primary',
      html: icon('plus', { size: 12 }) + '<span>Record a SAR</span>',
      onClick: () => recordSar(locations, null, host),
    }),
  ]));

  /* The inbox. Left first because it is the only thing here that is a task. */
  const pdfs = waiting.filter((f) => /\.pdf$/i.test(f.name));
  if (pdfs.length) {
    host.appendChild(table(
      [`${pdfs.length} PDF(s) waiting in ${SAR_INBOX}/`, 'Dropped', ''],
      pdfs.map((f) => el('tr', {}, [
        el('td', { text: f.name }),
        el('td', { class: 'rc-hint', text: new Date(f.modified).toISOString().slice(0, 10) }),
        el('td', {}, [
          el('button', {
            class: 'cx-btn mini primary',
            text: 'Record it',
            onClick: () => recordSar(locations, f, host),
          }),
        ]),
      ]))
    ));
    host.appendChild(el('div', { style: 'height:20px' }));
  } else if (filestore.hasFolder()) {
    host.appendChild(el('p', { class: 'rc-hint', text: `Nothing waiting in ${SAR_INBOX}/.` }));
  }

  /* The alert the spec did not ask for and that nothing else surfaces: work
     planned into a week with no access confirmed against it. */
  if (without.length) {
    host.appendChild(el('p', { class: 'rc-error' }, [
      el('strong', { text: `${without.length} look-ahead row(s) have no SAR. ` }),
      el('span', { text: 'That is work planned without confirmed access.' }),
    ]));
  }
  if (unlinked.length) {
    host.appendChild(el('p', { class: 'rc-hint', text:
      `${unlinked.length} SAR(s) match no look-ahead row — access booked for work that has gone.` }));
  }

  if (!sars.length) {
    host.appendChild(el('p', { class: 'rc-hint', text: 'No SARs recorded.' }));
  } else {
    const links = await rc.listSarLinks().catch(() => []);
    const covers = new Map();
    for (const k of links) covers.set(k.sar_id, (covers.get(k.sar_id) || 0) + 1);

    host.appendChild(table(
      ['SAR', 'Rev', 'Location', 'Week', 'Hours', 'Covers', ''],
      sars.map((s) => el('tr', {}, [
        el('td', { text: s.sar_number }),
        el('td', { class: 'rc-num', text: String(s.revision) }),
        el('td', { text: locs.get(s.location_id)?.name || s.raw_location || '—' }),
        el('td', { text: s.week_start || '—' }),
        el('td', { class: 'rc-num', text: s.authorized_hours ?? '—' }),
        el('td', { class: 'rc-num', text: covers.get(s.id) ? `${covers.get(s.id)} row(s)` : '—' }),
        el('td', {}, [
          el('button', {
            class: 'cx-btn mini ghost',
            text: 'What it covers',
            title: 'Confirm which look-ahead rows this access is for. Offered by date and '
              + 'location; never matched on the activity text.',
            onClick: () => linkSar(s, host),
          }),
          s.storage_path ? el('button', {
            class: 'cx-btn mini ghost',
            text: 'Open',
            onClick: async () => {
              try {
                window.open(await rc.sarUrl(s.storage_path), '_blank', 'noopener');
              } catch (err) {
                toast({ tone: 'bad', message: err.message });
              }
            },
          }) : null,
        ].filter(Boolean)),
      ]))
    ));
  }

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: `Drop a SAR PDF into ${SAR_INBOX}/ and record it here; it is then filed under its week. `
      + 'Matching to look-ahead rows is by date and location only — never by activity text, which '
      + 'is worded differently on the two sides and is not reliable enough to carry evidence. '
      + 'One SAR covering several rows at a location is expected, not an ambiguity.',
  }));
}

/**
 * Record a SAR, and file the PDF that came with it.
 *
 * Three things happen and all three can fail independently, so they are done
 * in the order that leaves the least mess: the row first, then the upload,
 * then the move out of the inbox. A PDF that uploaded but could not be moved
 * is a duplicate somebody sees; a PDF moved before the row existed would be a
 * file nobody can find.
 *
 * The number and week are read off the filename where it says them, because
 * "SAR-12345 W36.pdf" is what these are actually called — but only as a
 * *suggestion* in a field somebody confirms. Nothing here is matched on
 * activity text, which is the rule everywhere in this module.
 */
function recordSar(locations, file, root) {
  const guess = /(?:SAR[-_ ]?)?(\d{4,})/i.exec(file?.name || '')?.[1] || '';
  const number = textInput({ placeholder: 'SAR-12345', value: guess ? `SAR-${guess}` : '' });
  const location = selectInput({
    value: locations[0]?.id,
    options: locations.map((l) => ({ value: l.id, label: l.name })),
  });
  const week = el('input', { type: 'date', class: 'cx-input' });
  const hours = el('input', { type: 'number', class: 'cx-input', step: '0.5', min: '0' });

  formModal({
    title: file ? `Record ${file.name}` : 'Record a SAR',
    body: el('div', { class: 'cx-form' }, [
      file ? el('p', {
        class: 'rc-hint',
        text: 'The PDF goes up so it opens in a browser — it has to be readable by whoever is '
          + 'asked about it later — and the file is then moved out of the inbox into its week. '
          + 'The look-ahead workbook is deliberately not uploaded; this is.',
      }) : null,
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Number' }), number]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Location' }), location]),
      el('div', { class: 'cx-field' }, [
        el('label', { class: 'cx-label', text: 'Week beginning' }), week,
        el('div', { class: 'cx-hint', text: 'The Monday, matching how the look-ahead is keyed.' }),
      ]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Authorised hours' }), hours]),
    ].filter(Boolean)),
    confirmLabel: 'Record',
    onConfirm: async () => {
      if (!number.value.trim()) throw new Error('A SAR number is needed.');
      if (file && !week.value) throw new Error('A week is needed to file it under.');

      const row = await rc.addSar({
        sar_number: number.value.trim(),
        location_id: location.value || null,
        week_start: week.value || null,
        authorized_hours: hours.value ? Number(hours.value) : null,
      });

      if (file) {
        const rel = `${SAR_INBOX}/${file.name}`;
        const filed = `${SAR_ARCHIVE}/${week.value}/${file.name}`;
        try {
          const bytes = await filestore.intakeRead(rel);
          await rc.uploadSar(`${week.value}/${row.id}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
          await rc.updateSar(row.id, { storage_path: `${week.value}/${row.id}.pdf` });
          await filestore.intakeMove(rel, filed);
        } catch (err) {
          // The record exists either way, which is the part that matters. Say
          // what did not happen rather than rolling back a row somebody has
          // already been told about.
          toast({
            tone: 'warn',
            message: `${number.value.trim()} recorded, but the PDF was not filed — ${err.message}`,
            timeout: 10000,
          });
        }
      }

      notifyChanged('sars');
      if (root) {
        // Straight on to the question the SAR exists to answer.
        linkSar(row, root);
      }
    },
  });
}

/**
 * Which look-ahead rows this access covers.
 *
 * Offered by **date and location only**. The activity text is worded
 * differently on the two sides and is not reliable enough to carry evidence —
 * that rule is why the alias register exists — so the candidates are every row
 * at that location in that week and a person confirms. One SAR covering
 * several rows is expected rather than an ambiguity, so this is checkboxes and
 * not a radio.
 */
async function linkSar(sar, root) {
  const [rows, links] = await Promise.all([
    sar.week_start ? rc.lookaheadForWeek(sar.week_start).catch(() => []) : Promise.resolve([]),
    rc.listSarLinks().catch(() => []),
  ]);
  const already = new Set(links.filter((k) => k.sar_id === sar.id).map((k) => k.lookahead_row_id));
  const candidates = rows.filter((r) => !sar.location_id || !r.location_id || r.location_id === sar.location_id);

  if (!candidates.length) {
    toast({
      message: sar.week_start
        ? 'No look-ahead rows read for that week and location yet — read the look-ahead first.'
        : 'This SAR has no week against it, so there is nothing to match it to.',
      timeout: 8000,
    });
    return;
  }

  const boxes = candidates.map((r) => {
    const box = checkbox({
      label: [r.raw_location, r.raw_label].filter(Boolean).join(' · ').slice(0, 78),
      checked: already.has(r.id),
    });
    box.querySelector('input').dataset.row = r.id;
    return box;
  });
  const wrap = el('div', { style: 'display:grid;gap:6px;max-height:40vh;overflow:auto' }, boxes);

  formModal({
    title: `${sar.sar_number} — what it covers`,
    body: el('div', { class: 'cx-form' }, [
      el('p', {
        class: 'rc-hint',
        text: 'Every row at this location in this week. Matched on date and location, never on '
          + 'the activity text — the two sides word it differently, and a wrong match here would '
          + 'be a claim that access was granted for work it was not.',
      }),
      wrap,
    ]),
    confirmLabel: 'Confirm',
    onConfirm: async () => {
      const picked = [...wrap.querySelectorAll('input:checked')].map((b) => b.dataset.row);
      const added = picked.filter((id) => !already.has(id));
      if (added.length) {
        await rc.addSarLinks(added.map((id) => ({ sar_id: sar.id, lookahead_row_id: id })));
      }
      notifyChanged('sars');
      toast({
        tone: 'good',
        message: `${sar.sar_number} covers ${picked.length} look-ahead row(s).`,
      });
    },
  });
}

