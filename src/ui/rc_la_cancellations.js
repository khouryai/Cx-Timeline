/**
 * Look-ahead → Cancellations: every red run since the log's start.
 *
 * Imports: util, dates, rc, io/lookahead, core/lookahead, icons, components,
 *          rc_util, rc_la_state, rc_ingest.
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
   Cancellations
   ═══════════════════════════════════════════════════════════════════════ */

/** Whose cancellation it can be. The contract's three answers, as the schema checks them. */
const CANCEL_PARTIES = ['BART', 'Hitachi', 'Other'];
const PARTY_TONE = { BART: 'warn', Hitachi: 'bad', Other: 'neutral' };

/** The span the log covers, when somebody has changed it on screen. A blank end is no end. */
let cancellationsFrom = null;
let cancellationsTo = '';
let cancellationsUnansweredOnly = false;

/**
 * Every red run the look-ahead has shown, since the log's start, with whose it
 * was and why.
 *
 * The events are derived — `rc_cancelled_days` reads the rows every ingest
 * already wrote, and `cancellationEvents()` joins side-by-side days on one
 * activity into one event — so a week cancelled on the sheet is one line here
 * however many reads showed it, and a week that was red and later turned back
 * is still here, because it was cancelled when those reads were taken. What is
 * stored is only the judgement: a party (BART, Hitachi or Other) and a reason,
 * append-only, corrected by superseding.
 *
 * This is the whole history rather than the Changes list's per-day
 * transitions, which only catch a cell turning red *between* two reads — a
 * cell already red the first time the sheet was read was never an event there.
 */
export async function renderCancellations(host) {
  const settings = await rc.listSettings().catch(() => []);
  const configured = settings.find((x) => x.key === 'cancellation_log_from')?.value;
  const from = cancellationsFrom || configured || `${new Date().getUTCFullYear()}-09-01`;

  const [days, notes] = await Promise.all([
    rc.listCancelledDays(from).catch((err) => { toast({ tone: 'bad', title: 'Could not read the cancellations', message: err.message }); return []; }),
    rc.listCancellationNotes().catch(() => []),
  ]);
  const to = cancellationsTo && cancellationsTo >= from ? cancellationsTo : '';
  /* An event is in the span when it starts inside it. One that runs past the
     end is kept whole rather than cut at the boundary: a cancelled week is one
     event, and half of it in a report is a different claim. */
  const events = attachCancellationNotes(cancellationEvents(days, { from }), notes)
    .filter((e) => !to || e.start <= to);

  const dateBox = (value, label, onPick) => {
    const box = el('input', {
      type: 'date', class: 'cx-input mini', value, 'aria-label': label, style: 'width:150px',
    });
    box.addEventListener('change', () => onPick(box.value));
    return box;
  };
  const fromInput = dateBox(from, 'Log starts on', (v) => {
    if (!v) return;
    cancellationsFrom = v;
    notifyChanged('cancellations');
  });
  const toInput = dateBox(to, 'Log ends on', (v) => {
    cancellationsTo = v;
    notifyChanged('cancellations');
  });
  const span = to ? `${dayLabel(from)} to ${dayLabel(to)}` : `since ${dayLabel(from)}`;

  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'Cancellation log' }),
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end' }, [
      el('span', { class: 'rc-hint', style: 'margin:0;white-space:nowrap', text: 'From' }),
      fromInput,
      el('span', { class: 'rc-hint', style: 'margin:0;white-space:nowrap', text: 'To' }),
      toInput,
      el('button', {
        class: 'cx-btn mini ghost',
        html: `${icon('refresh', { size: 12 })}<span>Re-read saved snapshots</span>`,
        title: 'Apply today\'s rules — Resource rows are never cancellations — to every read the log covers',
        onClick: () => rederiveCancellations(from),
      }),
      checkNowButton(),
    ].filter(Boolean)),
  ]));

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: `Every run of red cells any read of the look-ahead has shown ${span}. Cells side by `
      + 'side on one activity are one event, and red on a Resource row is never a cancellation. '
      + 'A cancellation stays in the log after the sheet moves on — it was red when those reads '
      + 'were taken.',
  }));

  if (!events.length) {
    host.appendChild(emptyState({
      iconName: 'calendar',
      title: 'No cancellations',
      message: `No read of the look-ahead ${span} has a cell painted in the colour the Legend calls a cancellation.`,
    }));
    return;
  }

  const tally = { BART: 0, Hitachi: 0, Other: 0 };
  let open = 0;
  let dayCount = 0;
  for (const e of events) {
    dayCount += e.days;
    if (e.note) tally[e.note.party] = (tally[e.note.party] || 0) + 1;
    else open++;
  }
  host.appendChild(el('div', { class: 'cx-chipstats', style: 'margin:0 0 12px' }, [
    chipStat('Events', events.length, 'info'),
    chipStat('Days', dayCount, 'muted'),
    ...CANCEL_PARTIES.map((p) => chipStat(p, tally[p], tally[p] ? PARTY_TONE[p] : 'muted')),
    chipStat('No reason yet', open, open ? 'bad' : 'muted'),
  ]));

  host.appendChild(checkbox({
    label: 'Only the ones with no reason yet',
    checked: cancellationsUnansweredOnly,
    onChange: (on) => { cancellationsUnansweredOnly = on; notifyChanged('cancellations'); },
  }));

  const shown = cancellationsUnansweredOnly ? events.filter((e) => !e.note) : events;

  /* The extract is what is on screen: the span above, and the "no reason yet"
     narrowing when it is ticked. The file says which span in its name, because
     a log that is quietly a fortnight of a quarter reads as the whole quarter. */
  host.appendChild(el('div', { style: 'margin:8px 0 10px' }, [
    el('button', {
      class: 'cx-btn mini',
      html: `${icon('download', { size: 12 })}<span>Export ${shown.length} to CSV</span>`,
      onClick: () => saveFile(
        `cancellations-${from}-to-${to || todayISO()}.csv`,
        cancellationCsv(shown),
        'text/csv',
        'Cancellation log',
      ),
    }),
  ]));
  const rows = shown.map((e) => el('tr', { class: 'rc-cancel-row', dataset: { start: e.start, label: e.label } }, [
    el('td', {}, [
      el('div', { class: 'rc-cancel-cells', 'aria-hidden': 'true' },
        [...Array(Math.min(e.days, 14))].map(() => el('span', { class: 'rc-cancel-cell' }))),
    ]),
    el('td', {}, [
      el('div', { text: e.label || '—' }),
      e.location ? el('div', { class: 'rc-hint', text: e.location }) : null,
    ].filter(Boolean)),
    el('td', { text: e.start === e.end ? dayLabel(e.start) : `${dayLabel(e.start)} – ${dayLabel(e.end)}` }),
    el('td', { text: `${e.days} day${e.days === 1 ? '' : 's'}` }),
    el('td', {
      class: 'rc-hint',
      title: 'How many reads of the sheet showed any of these days red, and when it was first seen',
      text: `${e.reads} read${e.reads === 1 ? '' : 's'}${e.firstSeen ? ` · first ${dayLabel(String(e.firstSeen).slice(0, 10))}` : ''}`,
    }),
    el('td', {}, [e.note ? badge(e.note.party, PARTY_TONE[e.note.party] || 'neutral') : el('span', { class: 'rc-hint', text: '—' })]),
    el('td', {}, [
      e.note?.reason ? el('div', { text: e.note.reason }) : null,
      e.history.length > 1
        ? el('div', { class: 'rc-hint', text: `Corrected ${e.history.length - 1} time(s)`, title: e.history.map((n) => `${n.party}: ${n.reason || ''}`).join('\n') })
        : null,
    ].filter(Boolean)),
    el('td', {}, [
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
        el('button', {
          class: 'cx-btn mini' + (e.note ? ' ghost' : ' primary'),
          text: e.note ? 'Correct' : 'Add reason',
          title: e.note ? 'A correction is a new entry that supersedes this one. Nothing is edited away.' : '',
          onClick: () => recordCancellation(e),
        }),
        el('button', {
          class: 'cx-btn mini ghost',
          text: 'Show cells',
          title: 'Open the calendar on this activity, over the whole sheet',
          onClick: () => {
            la.calendarFilter = e.label;
            la.calendarWeeks = 0;
            la.showQuietRows = true;
            la.section = 'calendar';
            notifyChanged('cancellations');
          },
        }),
      ]),
    ]),
  ]));

  host.appendChild(table(['', 'Activity', 'Cancelled', 'Length', 'Seen', 'Responsible', 'Reason', ''], rows));
}

/**
 * Re-derive what every read since the log's start said each day was painted as.
 *
 * `rc_cancelled_days` reads the cells each ingest wrote, and those were written
 * under the rules of the day. Red on a Resource row used to go in with the rest
 * of the row's paint — and over the activity line's own colour — so a week of
 * names marked in red read as a week cancelled. The rule is fixed in
 * `rowsFrom()`; this applies it to the reads already taken. The snapshot is the
 * durable record and `cells` is derived from it, so this rewrites a derivation
 * and nothing else: rows are matched on `row_key` within their own snapshot,
 * and a row the new reading does not produce is left exactly as it was.
 *
 * Reads up to six weeks before the start are included, because a sheet read in
 * August already shows the first weeks of September.
 */
async function rederiveCancellations(from) {
  const ok = await confirmDialog({
    title: 'Re-read the saved snapshots?',
    message: 'Every read since six weeks before the log starts is read again under today\'s rules, '
      + 'and what each stored row says about each day is rewritten to match. Nothing else changes — '
      + 'not the snapshots, not the change log, not any reason already recorded.',
    confirmLabel: 'Re-read',
  });
  if (!ok) return;

  try {
    const since = toISO(addDays(isoToMs(from), -42));
    const [metas, legendRows] = await Promise.all([rc.listSnapshotMeta({ limit: 1000 }), rc.listLegend()]);
    const legend = legendRows.map((r) => ({ argb: r.argb, meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from }));
    const wanted = metas.filter((m) => String(m.taken_at || '').slice(0, 10) >= since);
    const same = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());

    let changed = 0;
    for (const meta of wanted) {
      const snapshot = await rc.snapshotById(meta.id);
      if (!snapshot?.grid) continue;
      const view = readGrid(applyLegend(snapshot.grid, legend), { anchorISO: snapshot.taken_at });
      const fresh = new Map((await rowsFrom(view, { snapshotId: snapshot.id })).map((r) => [r.row_key, r]));
      for (const row of await rc.listSnapshotRows(snapshot.id)) {
        const again = fresh.get(row.row_key);
        if (!again || same(again.cells, row.cells)) continue;
        await rc.updateLookaheadRowCells(row.id, again.cells);
        changed++;
      }
    }
    toast({
      tone: 'good',
      title: 'Saved snapshots re-read',
      message: `${wanted.length} read(s) checked, ${changed} row(s) corrected.`,
    });
    notifyChanged('cancellations');
  } catch (err) {
    toast({ tone: 'bad', title: 'Could not re-read the snapshots', message: err.message });
  }
}

/** Say whose it was and why — or correct what was said. */
function recordCancellation(event) {
  const current = event.note;
  const party = selectInput({
    value: current?.party || CANCEL_PARTIES[0],
    options: CANCEL_PARTIES,
  });
  const reason = el('textarea', { class: 'cx-input', rows: 3, placeholder: 'Why it was cancelled' });
  reason.value = current?.reason || '';

  formModal({
    title: current ? 'Correct the cancellation' : 'Why was this cancelled?',
    body: el('div', { class: 'cx-form' }, [
      el('p', {
        class: 'rc-hint',
        text: `${event.label}${event.location ? ` at ${event.location}` : ''}, `
          + `${event.start === event.end ? dayLabel(event.start) : `${dayLabel(event.start)} – ${dayLabel(event.end)}`}. `
          + 'This is the record a claim gets challenged on, so it is attributed and dated and cannot '
          + 'be edited afterwards — a correction is a new entry that supersedes this one.',
      }),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Responsible party' }), party]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Reason' }), reason]),
    ]),
    confirmLabel: current ? 'Record correction' : 'Record',
    onConfirm: async () => {
      const said = reason.value.trim();
      // A correction that says what is already said writes nothing.
      if (current && current.party === party.value && (current.reason || '') === said) return;
      await rc.addCancellationNote({
        raw_label: event.label,
        raw_location: event.location,
        start_date: event.start,
        end_date: event.end,
        party: party.value,
        reason: said || null,
        supersedes_id: current?.id || null,
      });
      notifyChanged('cancellations');
    },
  });
}

function cancellationCsv(events) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['activity', 'location', 'start', 'end', 'days', 'reads', 'first_seen', 'last_seen', 'responsible', 'reason', 'recorded_at'].join(',')];
  for (const e of events) {
    lines.push([
      e.label, e.location, e.start, e.end, e.days, e.reads,
      e.firstSeen || '', e.lastSeen || '', e.note?.party || '', e.note?.reason || '', e.note?.created_at || '',
    ].map(q).join(','));
  }
  return lines.join('\n') + '\n';
}

