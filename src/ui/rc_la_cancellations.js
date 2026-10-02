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
  reassignments, ABSENCE_LABELS, describeCodeCounts, isCancelMeaning,
} from '../core/lookahead.js';
import { cancellationWorkbook } from '../io/la_xlsx.js';
import { monthLabel, weekdayLetter, isWeekend } from '../core/la_edit.js';
import { icon } from './icons.js';
import {
  selectInput, textInput, toast, badge, emptyState, field, checkbox, confirmDialog, chipStat,
} from './components.js';
import {
  notifyChanged, byId, dayLabel, todayISO, formModal, parsedView,
  isoToMs, nameRegister, foldName, cancellationLog,
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
/** Whether cancellations somebody removed from the log are listed too. */
let cancellationsShowRemoved = false;
/** Which kind of cancellation is listed: everything, whole days, or BART resources. */
let cancellationsKind = 'all';
/** The log as a list, or as a calendar of the period like the look-ahead. */
let cancellationsView = 'list';

const KIND_LABEL = { activity: 'Activity cancelled', support: 'BART support cancelled' };

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

  const all = await cancellationLog(from)
    .catch((err) => { toast({ tone: 'bad', title: 'Could not read the cancellations', message: err.message }); return []; });
  const to = cancellationsTo && cancellationsTo >= from ? cancellationsTo : '';
  /* An event is in the span when it starts inside it. One that runs past the
     end is kept whole rather than cut at the boundary: a cancelled week is one
     event, and half of it in a report is a different claim. */
  const inSpan = all.filter((e) => !to || e.start <= to);
  /* Removed from the log — "this was never a cancellation" — is a judgement
     like any other: kept, and listed again when somebody asks to see them. */
  const removedCount = inSpan.filter((e) => e.dismissed).length;
  const events = inSpan.filter((e) => cancellationsShowRemoved || !e.dismissed);

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
    text: `Every red cell the look-ahead currently has ${span}, with the BART resources those days `
      + 'had asked for — and every BART resource currently struck out of an activity that still goes '
      + 'ahead ("X.~WIT": the witness cancelled, the EIC still wanted). Only what the look-ahead says '
      + 'now: a day turned back from red, a row taken off the sheet or a resource reinstated drops '
      + 'out. For a day the window has rolled past, it is what the last reading to show that day '
      + 'said. Cells side by side on one activity are one event; red on a Resource row is never a '
      + 'cancellation; only resources BART provides are listed; and a resource removed in the '
      + 'editor with "Just remove" is not tracked.',
  }));

  if (!events.length) {
    host.appendChild(emptyState({
      iconName: 'calendar',
      title: 'No cancellations',
      message: `No read of the look-ahead ${span} has a cell painted in the colour the Legend calls a `
        + 'cancellation, or a BART resource struck out of an activity.',
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
  const resourceEvents = events.filter((e) => e.kind === 'support').length;
  host.appendChild(el('div', { class: 'cx-chipstats', style: 'margin:0 0 12px' }, [
    chipStat('Events', events.length, 'info'),
    chipStat('Cancelled activities', events.length - resourceEvents, 'muted'),
    chipStat('BART support', resourceEvents, resourceEvents ? 'warn' : 'muted'),
    chipStat('Days', dayCount, 'muted'),
    ...CANCEL_PARTIES.map((p) => chipStat(p, tally[p], tally[p] ? PARTY_TONE[p] : 'muted')),
    chipStat('No reason yet', open, open ? 'bad' : 'muted'),
  ]));

  host.appendChild(el('div', { style: 'display:flex;gap:18px;flex-wrap:wrap' }, [
    checkbox({
      label: 'Only the ones with no reason yet',
      checked: cancellationsUnansweredOnly,
      onChange: (on) => { cancellationsUnansweredOnly = on; notifyChanged('cancellations'); },
    }),
    removedCount || cancellationsShowRemoved ? checkbox({
      label: `Show the ${removedCount} removed from the log`,
      checked: cancellationsShowRemoved,
      onChange: (on) => { cancellationsShowRemoved = on; notifyChanged('cancellations'); },
    }) : null,
  ].filter(Boolean)));

  const tabs = (klass, choices, current, pick) => el('div', { class: `rc-tabs ${klass}`, style: 'margin:0' },
    choices.map(([id, label]) => el('button', {
      class: 'rc-tab',
      type: 'button',
      text: label,
      'aria-pressed': String(current === id),
      onClick: () => { pick(id); notifyChanged('cancellations'); },
    })));
  host.appendChild(el('div', { style: 'display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:8px 0 0' }, [
    tabs('la-cancel-kinds',
      [['all', 'Everything'], ['activity', 'Cancelled activities'], ['support', 'BART support only']],
      cancellationsKind, (id) => { cancellationsKind = id; }),
    tabs('la-cancel-views', [['list', 'As a list'], ['calendar', 'As a calendar']],
      cancellationsView, (id) => { cancellationsView = id; }),
  ]));

  const shown = events
    .filter((e) => cancellationsKind === 'all' || e.kind === cancellationsKind)
    .filter((e) => !cancellationsUnansweredOnly || !e.note);

  if (cancellationsView === 'calendar') {
    host.appendChild(await cancellationCalendar(shown, from, to));
    return;
  }

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
  const rows = shown.map((e) => el('tr', {
    class: `rc-cancel-row rc-cancel-${e.kind}${e.dismissed ? ' rc-cancel-removed' : ''}`,
    dataset: { start: e.start, label: e.label, kind: e.kind, codes: e.codes || '' },
  }, [
    el('td', {}, [
      el('div', { class: 'rc-cancel-cells', 'aria-hidden': 'true' },
        [...Array(Math.min(e.days, 14))].map(() => el('span', { class: `rc-cancel-cell${e.kind === 'support' ? ' rc-cancel-cell-support' : ''}` }))),
    ]),
    el('td', {}, [
      el('div', { text: e.label || '—' }),
      e.location ? el('div', { class: 'rc-hint', text: e.location }) : null,
    ].filter(Boolean)),
    el('td', {}, [
      badge(KIND_LABEL[e.kind], e.kind === 'support' ? 'warn' : 'bad'),
    ]),
    /* What BART had been asked for and lost. On a cancelled day, everything the
       day asked for; on an activity that went ahead, the codes struck out —
       drawn struck through, as the grid draws them. */
    el('td', {}, e.resources?.size
      ? [el('span', {
        class: e.kind === 'support' ? 'rc-code-cancelled' : '',
        text: describeCodeCounts(e.resources),
        title: e.kind === 'support'
          ? 'Struck out of the day while the activity went ahead'
          : 'What those days had asked BART for — cancelled with them',
      })]
      : [el('span', { class: 'rc-hint', text: '—' })]),
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
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, e.dismissed ? [
        badge('Removed from the log', 'neutral'),
        rc.isAdmin() ? el('button', {
          class: 'cx-btn mini ghost',
          text: 'Put back',
          title: 'Count it as a cancellation again. The removal stays in its history.',
          onClick: () => restoreCancellation(e),
        }) : null,
      ].filter(Boolean) : [
        el('button', {
          class: 'cx-btn mini' + (e.note ? ' ghost' : ' primary'),
          text: e.note ? 'Correct' : 'Add reason',
          title: e.note ? 'A correction is a new entry that supersedes this one. Nothing is edited away.' : '',
          onClick: () => recordCancellation(e),
        }),
        rc.isAdmin() ? el('button', {
          class: 'cx-btn mini ghost danger rc-cancel-remove',
          text: 'Remove from log',
          title: 'It should never have been here — a names row, a cell painted red by mistake',
          onClick: () => removeCancellation(e),
        }) : null,
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
      ].filter(Boolean)),
    ]),
  ]));

  host.appendChild(table(['', 'Activity', 'What', 'BART resources', 'Cancelled', 'Length', 'Seen', 'Responsible', 'Reason', ''], rows));
}

/* ══════════════════════════════════════════════════════════════════════════
   The cancellations as a calendar
   ═══════════════════════════════════════════════════════════════════════ */

/** What one cancelled run says on the calendar and in its Excel cell. */
function runText(e) {
  const what = e.kind === 'support'
    ? `${describeCodeCounts(e.resources)} cancelled`
    : describeCodeCounts(e.resources);
  const why = e.note ? `${e.note.party}${e.note.reason ? `: ${e.note.reason}` : ''}` : 'No reason yet';
  return [what, why].filter(Boolean).join('\n');
}

/** The same as nodes: only the struck-out codes are drawn through, never the reason. */
function runNodes(e) {
  const [what, ...why] = runText(e).split('\n');
  return [
    e.kind === 'support'
      ? el('div', {}, [el('span', { class: 'la-code-cancelled', text: describeCodeCounts(e.resources) }), ' cancelled'])
      : el('div', { text: what }),
    ...why.map((line) => el('div', { class: 'la-cancel-why', text: line })),
  ].filter((n) => n.textContent);
}

/**
 * The log drawn like the look-ahead: one row per activity, the days of the
 * period across, each cancelled run one cell spanning its days — red for a day
 * cancelled outright, red writing for a BART resource struck out of work that
 * went ahead — carrying who was responsible and why. Exactly what is listed
 * (the period, the kind, "no reason yet"), and exportable to Excel as it is.
 */
async function cancellationCalendar(events, from, to) {
  const wrap = el('div', { class: 'la-cancel-calendar' });
  const legendRows = await rc.listLegend().catch(() => []);
  const red = String(legendRows.find((l) => isCancelMeaning(l.meaning || ''))?.argb || 'FF0000').toUpperCase();
  const last = to || events.reduce((m, e) => (e.end > m ? e.end : m), from);
  const days = [];
  for (let d = from; d <= last && days.length < 400; d = toISO(addDays(isoToMs(d), 1))) days.push(d);

  const byActivity = new Map();
  for (const e of events) {
    if (!byActivity.has(e.key)) byActivity.set(e.key, { label: e.label, location: e.location, events: [] });
    byActivity.get(e.key).events.push(e);
  }
  const rows = [...byActivity.values()].sort((a, b) => a.label.localeCompare(b.label) || a.location.localeCompare(b.location));

  const span = `${dayLabel(from)} to ${dayLabel(last)}`;
  wrap.appendChild(el('div', { style: 'display:flex;gap:8px;align-items:center;margin:8px 0 10px;flex-wrap:wrap' }, [
    el('button', {
      class: 'cx-btn mini primary la-cancel-xlsx',
      type: 'button',
      html: `${icon('download', { size: 12 })}<span>Export to Excel</span>`,
      title: 'This calendar as an .xlsx: one row per activity, each cancelled run one cell with who and why',
      onClick: () => {
        const bytes = cancellationWorkbook({
          days,
          red,
          title: 'Cancellation log',
          subtitle: `${span} · ${events.length} cancellation(s)`,
          rows: rows.map((r) => ({ ...r, events: r.events.map((e) => ({ start: e.start, end: e.end, kind: e.kind, text: runText(e) })) })),
        });
        saveFile(`cancellations ${from} to ${last}.xlsx`, bytes,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Cancellation calendar');
      },
    }),
    el('span', { class: 'rc-hint', style: 'margin:0', text: `${rows.length} activit${rows.length === 1 ? 'y' : 'ies'}, ${span}` }),
  ]));

  if (!rows.length) {
    wrap.appendChild(emptyState({ iconName: 'calendar', title: 'Nothing cancelled in this period', message: 'Widen the dates above, or show every kind.' }));
    return wrap;
  }

  const head = el('thead', {}, [
    el('tr', {}, [
      el('th', { class: 'la-cancel-meta', text: '' }),
      el('th', { class: 'la-cancel-meta', text: '' }),
      ...days.map((d, i) => el('th', {
        class: 'la-month',
        text: i === 0 || monthLabel(days[i - 1]) !== monthLabel(d) ? monthLabel(d) : '',
      })),
    ]),
    el('tr', {}, [
      el('th', { class: 'la-cancel-meta', text: 'Activity' }),
      el('th', { class: 'la-cancel-meta', text: 'Location' }),
      ...days.map((d) => el('th', {
        class: `la-num${isWeekend(d) ? ' la-weekend' : ''}`,
        html: `${Number(d.slice(8, 10))}<br>${weekdayLetter(d)}`,
        title: dayLabel(d),
      })),
    ]),
  ]);
  const body = el('tbody');
  for (const r of rows) {
    const tr = el('tr', { class: 'la-cancel-line' }, [
      el('td', { class: 'la-cancel-meta', text: r.label }),
      el('td', { class: 'la-cancel-meta rc-hint', text: r.location || '' }),
    ]);
    const at = new Map();
    for (const e of r.events) {
      const a = days.indexOf(e.start < from ? from : e.start);
      const b = days.indexOf(e.end > last ? last : e.end);
      if (a >= 0 && b >= a) at.set(a, { e, b });
    }
    for (let i = 0; i < days.length; i++) {
      const hit = at.get(i);
      if (!hit) {
        tr.appendChild(el('td', { class: `la-day${isWeekend(days[i]) ? ' la-weekend' : ''}` }));
        continue;
      }
      const { e, b } = hit;
      const activity = e.kind === 'activity';
      tr.appendChild(el('td', {
        class: `la-day la-cancel-run la-cancel-run-${e.kind}${activity ? ` la-painted${isDark(red) ? ' la-dark' : ''}` : ''}${e.note ? '' : ' la-cancel-open'}`,
        colSpan: String(b - i + 1),
        style: activity ? `background-color:#${red}` : '',
        title: `${e.label}${e.location ? ` at ${e.location}` : ''} — ${e.start === e.end ? dayLabel(e.start) : `${dayLabel(e.start)} – ${dayLabel(e.end)}`}\n${runText(e)}`
          + (rc.isAdmin() ? '\nClick to give or correct the reason.' : ''),
        dataset: { kind: e.kind, start: e.start },
        onClick: rc.isAdmin() ? () => recordCancellation(e) : null,
      }, runNodes(e)));
      i = b;
    }
    body.appendChild(tr);
  }
  wrap.appendChild(el('div', { class: 'rc-scroll', style: 'max-height:65vh' }, [
    el('table', { class: 'rc-table la-grid la-cancel-grid', dataset: { plain: '1' } }, [head, body]),
  ]));
  return wrap;
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
      // A compacted editor reading has no grid to re-read; its rows stand as written.
      if (!snapshot?.grid || snapshot.grid.compacted) continue;
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
/**
 * Take a cancellation out of the log — it should never have been in it.
 *
 * The log is derived from the look-ahead, so there is nothing to delete; what
 * is written is a note saying so, attributed and dated, and the event drops out
 * of the list, the calendar, the counts, the exports and the inbox. "Show the
 * removed" lists it again with "Put back".
 */
function removeCancellation(event) {
  const reason = el('textarea', { class: 'cx-input', rows: 3, placeholder: 'Why it is not a cancellation — e.g. a names row read as an activity' });
  formModal({
    title: 'Remove from the cancellation log?',
    body: el('div', { class: 'cx-form' }, [
      el('p', {
        class: 'rc-hint',
        text: `${event.kind === 'support' ? `${describeCodeCounts(event.resources)} struck out of ` : ''}`
          + `${event.label}${event.location ? ` at ${event.location}` : ''}, `
          + `${event.start === event.end ? dayLabel(event.start) : `${dayLabel(event.start)} – ${dayLabel(event.end)}`}. `
          + 'It leaves the log, the calendar, the counts and the exports. Nothing on the look-ahead changes, '
          + 'and it can be put back.',
      }),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Why (optional)' }), reason]),
    ]),
    confirmLabel: 'Remove from log',
    onConfirm: async () => {
      await rc.addCancellationNote({
        raw_label: event.label,
        raw_location: event.location,
        start_date: event.start,
        end_date: event.end,
        party: event.note?.party || 'Other',
        reason: reason.value.trim() || 'Removed from the log: not a cancellation',
        codes: event.kind === 'support' ? event.codes : null,
        dismissed: true,
        supersedes_id: event.note?.id || null,
      });
      notifyChanged('cancellations');
    },
  });
}

/** Count a removed cancellation again: a note superseding the removal. */
async function restoreCancellation(event) {
  const before = event.history.filter((n) => !n.dismissed).slice(-1)[0] || null;
  await rc.addCancellationNote({
    raw_label: event.label,
    raw_location: event.location,
    start_date: event.start,
    end_date: event.end,
    party: before?.party || event.note?.party || 'Other',
    reason: before?.reason || null,
    codes: event.kind === 'support' ? event.codes : null,
    dismissed: false,
    supersedes_id: event.note?.id || null,
  });
  notifyChanged('cancellations');
}

function recordCancellation(event) {
  const current = event.note;
  const party = selectInput({
    value: current?.party || CANCEL_PARTIES[0],
    options: CANCEL_PARTIES,
  });
  const reason = el('textarea', { class: 'cx-input', rows: 3, placeholder: 'Why it was cancelled' });
  reason.value = current?.reason || '';

  const support = event.kind === 'support';
  formModal({
    title: current ? 'Correct the cancellation' : support ? `Why was ${event.codes} cancelled?` : 'Why was this cancelled?',
    body: el('div', { class: 'cx-form' }, [
      el('p', {
        class: 'rc-hint',
        text: `${support ? `${describeCodeCounts(event.resources)} struck out of ` : ''}`
          + `${event.label}${event.location ? ` at ${event.location}` : ''}, `
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
        codes: support ? event.codes : null,
        supersedes_id: current?.id || null,
      });
      notifyChanged('cancellations');
    },
  });
}

function cancellationCsv(events) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['activity', 'location', 'kind', 'bart_resources', 'start', 'end', 'days', 'reads', 'first_seen', 'last_seen', 'responsible', 'reason', 'recorded_at'].join(',')];
  for (const e of events) {
    lines.push([
      e.label, e.location, e.kind === 'support' ? 'bart resource' : 'day', describeCodeCounts(e.resources),
      e.start, e.end, e.days, e.reads,
      e.firstSeen || '', e.lastSeen || '', e.note?.party || '', e.note?.reason || '', e.note?.created_at || '',
    ].map(q).join(','));
  }
  return lines.join('\n') + '\n';
}

