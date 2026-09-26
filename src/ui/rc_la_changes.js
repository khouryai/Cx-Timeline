/**
 * Look-ahead → Changes and Snapshots: what moved between reads, and the reads.
 *
 * Imports: util, rc, core/lookahead, icons, components, rc_util, rc_la_state,
 *          rc_ingest.
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
   Changes
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The weeks a change is worth reading about.
 *
 * From the Monday a week back, to the last day the calendar covers. Everything
 * outside that is either finished — a shift that moved in July cannot be
 * planned around now — or beyond what the workbook has been filled in to, which
 * is nothing at all. The register keeps the lot either way; this is which of it
 * gets drawn, and "Everything recorded" is one click away for the times the
 * question really is what happened in March.
 *
 * The far end comes from the calendar rather than from a constant, for the same
 * reason `windowOf()` does: the look-ahead is maintained four to six weeks out,
 * and a fixed four would hide the sixth week every time it appeared.
 */
function changeWindow(view, today) {
  const ms = new Date(`${today}T00:00:00Z`).getTime();
  const monday = ms - ((new Date(ms).getUTCDay() + 6) % 7) * 86400000;
  const from = new Date(monday - 7 * 86400000).toISOString().slice(0, 10);

  const dated = (view?.days || []).map((d) => d.date).filter(Boolean);
  // No axis, or no year resolved from it: fall back to six weeks out rather
  // than to nothing, which would hide every change there is.
  const to = dated.length
    ? dated[dated.length - 1]
    : new Date(monday + 42 * 86400000).toISOString().slice(0, 10);

  return { from, to };
}

/** Whether the changes list is narrowed to that window. It is, by default. */
let changesInWindow = true;

export async function renderChanges(host) {
  const today = todayISO();
  const from = `${Number(today.slice(0, 4)) - 1}-01-01`;
  const [all, runs, parties, snapshot, legendRows] = await Promise.all([
    rc.listChangeEvents(from, `${today}T23:59:59Z`),
    rc.listIngestRuns({ limit: 60 }),
    rc.listParties(),
    rc.latestSnapshot(),
    rc.listLegend(),
  ]);

  /* The window is read off the calendar the last snapshot draws, so the two
     screens cannot disagree about where the look-ahead ends. */
  const view = snapshot?.grid ? parsedView(snapshot, legendRows) : null;
  const window_ = changeWindow(view, today);
  const events = changesInWindow
    ? all.filter((e) => !e.week_start || (e.week_start >= window_.from && e.week_start <= window_.to))
    : all;

  /* The judgements somebody has already made. These were being written and
     never read: an attribution recorded in a meeting was invisible the moment
     the dialog closed, so the same cancellation got asked about every week and
     the record it was creating could not be checked. Superseded rather than
     edited, so the newest row for an event is the answer and the ones under it
     are the history. */
  const annotations = events.length
    ? await rc.listAnnotations(events.map((e) => e.id)).catch(() => [])
    : [];
  const saidOf = new Map();
  for (const a of [...annotations].sort((x, y) => String(x.created_at).localeCompare(y.created_at))) {
    saidOf.set(a.change_event_id, a);
  }

  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'What the look-ahead did' }),
    checkNowButton(),
  ]));

  /* Coverage before content. Ingestion only happens when somebody has the
     application open, so the history has holes — and a hole that is not drawn
     reads as a quiet week. */
  host.appendChild(coverageNote(runs));

  /* What span this is a list of, and the way out of it. Said before the rows
     rather than under them: a list that has been narrowed and does not say so
     reads as a list of everything, which is how somebody concludes nothing
     happened in a fortnight that was simply out of view. */
  host.appendChild(el('div', {
    style: 'display:flex;align-items:center;gap:16px;margin:0 0 10px;flex-wrap:wrap',
  }, [
    el('span', {
      class: 'rc-hint',
      style: 'margin:0',
      text: changesInWindow
        ? `Weeks ${window_.from} to ${window_.to} — from a week back to the end of the calendar `
          + `as it was last read${all.length - events.length
            ? `. ${all.length - events.length} older or further-out change(s) are not listed`
            : ''}.`
        : `Everything recorded — ${all.length} change(s), whatever week they are about.`,
    }),
    checkbox({
      label: 'Everything recorded',
      checked: !changesInWindow,
      onChange: (on) => { changesInWindow = !on; notifyChanged('changes'); },
    }),
  ]));

  if (!events.length) {
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: all.length
        ? `Nothing changed in the weeks on the calendar. ${all.length} change(s) are recorded `
          + 'outside that window — tick "Everything recorded" to see them.'
        : 'No changes recorded yet.',
    }));
    return;
  }

  const partyById = byId(parties);
  const counted = countable(events);
  host.appendChild(el('p', { class: 'rc-hint' }, [
    el('span', { text: `${counted.length} change(s) that count, ` }),
    el('span', { text: `${events.length - counted.length} window movement(s) that do not.` }),
  ]));

  const rows = events.map((e) => el('tr', {}, [
    el('td', { text: e.week_start || '—' }),
    el('td', {}, [badge(kindLabel(e.kind), kindTone(e.kind))]),
    el('td', { text: describe({ ...e, weekStart: e.week_start, rowKey: e.row_key }) }),
    el('td', { class: 'rc-hint', text: e.detected_at ? dayLabel(e.detected_at.slice(0, 10)) : '' }),
    el('td', {}, [(() => {
      const said = saidOf.get(e.id);
      if (said) {
        return el('div', {}, [
          el('div', { text: partyById.get(said.party_id)?.name || said.note || 'Recorded' }),
          said.note && said.party_id ? el('div', { class: 'rc-hint', text: said.note }) : null,
          el('button', {
            class: 'cx-btn mini ghost',
            text: 'Correct it',
            title: 'A correction is a new row that supersedes this one. Nothing is edited away.',
            onClick: () => attribute(e, parties),
          }),
        ].filter(Boolean));
      }
      return e.kind === 'cancellation'
        ? el('button', {
          class: 'cx-btn mini ghost',
          text: 'Whose?',
          title: 'Red says a shift was cancelled. It cannot say by whom.',
          onClick: () => attribute(e, parties),
        })
        : el('span', { class: 'rc-hint', text: '' });
    })()]),
  ]));

  host.appendChild(table(['Week', 'Kind', 'What', 'Seen', 'Down to'], rows));

  const unanswered = events.filter((e) => e.kind === 'cancellation' && !saidOf.has(e.id)).length;
  if (unanswered) {
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: `${unanswered} cancellation(s) have nobody against them yet. Red says a shift was `
        + 'cancelled and cannot say by whom — and a cancellation with no party is the one row '
        + 'in here that cannot be used for anything later.',
    }));
  }

  const pairs = relinkCandidates(events.map((e) => ({
    kind: e.kind, weekStart: e.week_start, rowKey: e.row_key, before: e.before, after: e.after,
  })));
  if (pairs.length) {
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: `${pairs.length} removal/addition pair(s) share the same requested resources, which `
        + 'usually means a crew finished early and moved rather than anything being cancelled. '
        + 'That cannot be told apart automatically — the activity text is not reliable enough to '
        + 'match on — so it is offered rather than assumed.',
    }));
  }
}

/**
 * Say where the history has holes.
 *
 * This is the honest half of "ingestion runs when the application is open".
 * Without it the change log would look continuous and somebody would read a
 * silent fortnight as a fortnight in which nothing moved.
 */
function coverageNote(runs) {
  if (!runs.length) {
    return el('p', { class: 'rc-hint', text: 'The look-ahead has never been read on this account.' });
  }
  const last = runs[0];
  const age = Math.floor((Date.now() - new Date(last.ran_at).getTime()) / 86400000);
  const stale = age >= 7;

  return el('p', {
    class: stale ? 'rc-error' : 'rc-hint',
    text: stale
      ? `The look-ahead has not been read for ${age} days. Anything that changed and changed `
        + 'back in that time is not in the log below — the gap is real, not a quiet spell.'
      : `Last read ${age === 0 ? 'today' : `${age} day(s) ago`} — ${last.outcome}.`,
  });
}

function attribute(event, parties) {
  const party = selectInput({
    value: parties[0]?.id,
    options: parties.map((p) => ({ value: p.id, label: p.name })),
  });
  const note = textInput({ placeholder: 'What happened' });

  formModal({
    title: 'Who was this down to?',
    body: el('div', { class: 'cx-form' }, [
      el('p', {
        class: 'rc-hint',
        text: 'This is the record a claim gets challenged on, so it is attributed and dated, '
          + 'and it cannot be edited afterwards — a correction is a new entry that supersedes '
          + 'this one.',
      }),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Down to' }), party]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Note' }), note]),
    ]),
    confirmLabel: 'Record',
    onConfirm: async () => {
      await rc.addAnnotation({
        change_event_id: event.id,
        kind: 'responsibility',
        party_id: party.value,
        note: note.value.trim() || null,
      });
      notifyChanged('annotations');
    },
  });
}

const KIND_LABELS = {
  scope_added: 'Scope added', scope_removed: 'Scope removed', cancellation: 'Cancelled',
  shift_changed: 'Shift changed', resource_changed: 'Resources', location_shift: 'Moved site',
  window_advanced: 'Window advanced', window_retired: 'Window retired',
};
const kindLabel = (k) => KIND_LABELS[k] || k;
const kindTone = (k) => ({
  cancellation: 'bad', scope_removed: 'warn', scope_added: 'info',
  window_advanced: 'muted', window_retired: 'muted',
}[k] || 'neutral');

/* ══════════════════════════════════════════════════════════════════════════
   Snapshots
   ═══════════════════════════════════════════════════════════════════════ */

export async function renderSnapshots(host) {
  /* Forty rows of metadata, not forty grids: the two numbers this table prints
     off each snapshot are computed in the database by the view. */
  const snapshots = await rc.listSnapshotMeta({ limit: 40 });

  host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Snapshots' })]));

  if (!snapshots.length) {
    host.appendChild(el('p', { class: 'rc-hint', text: 'Nothing captured yet.' }));
    return;
  }

  host.appendChild(table(
    ['Seen', 'File changed', 'Sheet', 'Rows', 'Unmapped colours'],
    snapshots.map((s) => el('tr', {}, [
      el('td', { text: s.taken_at ? s.taken_at.slice(0, 16).replace('T', ' ') : '—' }),
      el('td', { text: s.file_mtime ? s.file_mtime.slice(0, 16).replace('T', ' ') : '—' }),
      el('td', { text: s.sheet_name }),
      el('td', { class: 'rc-num', text: String(s.row_count ?? 0) }),
      el('td', { class: 'rc-num', text: String(s.unmapped_count ?? 0) }),
    ]))
  ));

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Two times, deliberately. "File changed" is what OneDrive stamped, which is when it '
      + 'synced rather than when anybody edited it; "seen" is when this application read it. '
      + 'For evidence the difference matters, so neither stands in for the other.',
  }));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'The parsed grid is stored, not the workbook. A .xlsx carries every other tab, hidden '
      + 'row and forgotten pasted sheet along with the part that was wanted — the original bytes '
      + 'stay in the folder archive instead.',
  }));
}

