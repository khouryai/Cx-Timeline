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
  segmented, openModal,
} from './components.js';
import {
  notifyChanged, byId, dayLabel, todayISO, formModal, parsedView,
  isoToMs, nameRegister, foldName,
} from './rc_util.js';
import { toISO, addDays } from '../core/dates.js';

import { la, table, WEEK_CHOICES } from './rc_la_state.js';
import { checkNowButton } from './rc_ingest.js';
import { enhanceTable } from './rc_table.js';
import { editLines, editsBehind, editors } from '../core/la_edit.js';

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

/** Which of the two the Changes section shows: the summary, or every edit. */
let changesView = 'summary';

export async function renderChanges(host) {
  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'What the look-ahead did' }),
    el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end' }, [
      segmented({
        value: changesView,
        options: [
          { value: 'summary', label: 'Summary', title: 'What changed between one reading and the next, and who changed it' },
          { value: 'edits', label: 'Every edit', title: 'Every change made in the editor, one line each — who, when, from what to what' },
        ],
        onChange: (v) => { changesView = v; notifyChanged('changes'); },
      }),
      checkNowButton(),
    ]),
  ]));
  if (changesView === 'edits') {
    await renderEditLog(host);
    return;
  }

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
    el('span', { text: `${events.length - counted.length} that do not — the window moving, an activity `
      + 'moving site or its wording changing.' }),
  ]));

  /* Who made each change, from the edit log. Read only for changes found
     between two readings the editor published — they name the row — and a
     failure here costs the column, never the list. */
  const by = await whoMadeThem(events, legendRows).catch((err) => {
    console.warn('[cx-timeline] who made the changes:', err.message);
    return null;
  });

  const rows = events.map((e) => el('tr', {}, [
    el('td', { text: e.week_start || '—' }),
    el('td', {}, [badge(kindLabel(e.kind), kindTone(e.kind))]),
    el('td', { text: describe({ ...e, weekStart: e.week_start, rowKey: e.row_key }) }),
    byCell(e, by),
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

  host.appendChild(table(['Week', 'Kind', 'What', 'By', 'Seen', 'Down to'], rows));
  if (events.some((e) => !e.la_row_id && KPI_SHOWN.includes(e.kind))) {
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'A change with no name against it was found before readings carried the editor\'s row '
        + 'ids, so the edit log cannot be joined to it. Every change from now on names who made it.',
    }));
  }

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
  details_changed: 'Details', window_advanced: 'Window advanced', window_retired: 'Window retired',
};

/** The kinds a person makes — the window moving is the calendar's, not anybody's. */
const KPI_SHOWN = ['scope_added', 'scope_removed', 'cancellation', 'shift_changed',
  'resource_changed', 'location_shift', 'details_changed'];

/* ══════════════════════════════════════════════════════════════════════════
   Who made each change
   ═══════════════════════════════════════════════════════════════════════ */

/** How a timestamp reads in the log: "Fri 2 Oct, 14:05". */
const whenLabel = (iso) => new Date(iso).toLocaleString(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

/** The legend's meaning for a colour, newest row for it first. */
function meaningLookup(legendRows) {
  const byHex = new Map();
  for (const r of [...(legendRows || [])].sort((a, b) => String(a.valid_from || '').localeCompare(String(b.valid_from || '')))) {
    byHex.set(String(r.argb).toUpperCase(), r.meaning || '');
  }
  return (hex) => byHex.get(String(hex || '').toUpperCase()) || '';
}

/** A person's name for an account id, from the roster (including people who have left). */
function nameLookup(people) {
  const names = new Map((people || []).filter((p) => p.user_id).map((p) => [p.user_id, p.name]));
  return (id) => (id ? names.get(id) || 'An account no longer on the roster' : 'Unknown');
}

/**
 * For every change that names an editor row, the edits that made it.
 *
 * The edges are the two readings' own times: an edit after the earlier one
 * was taken and no later than the later one is between them. One read of the
 * log covers the lot — from the earliest edge to the latest.
 */
async function whoMadeThem(events, legendRows) {
  const named = events.filter((e) => e.la_row_id && e.from_snapshot && e.to_snapshot);
  if (!named.length) return null;
  const [metas, laRows, people] = await Promise.all([
    rc.snapshotMetaByIds(named.flatMap((e) => [e.from_snapshot, e.to_snapshot])),
    rc.listLaRows().catch(() => []),
    rc.listPeople({ includeInactive: true }).catch(() => []),
  ]);
  const takenAt = new Map(metas.map((m) => [m.id, m.taken_at]));
  const spans = named
    .map((e) => ({ e, from: takenAt.get(e.from_snapshot), to: takenAt.get(e.to_snapshot) }))
    .filter((x) => x.from && x.to);
  if (!spans.length) return null;
  const earliest = spans.map((x) => x.from).sort()[0];
  const latest = spans.map((x) => x.to).sort().pop();
  const edits = await rc.listLaEditsBetween(earliest, latest);

  const behind = new Map();
  for (const { e, from, to } of spans) {
    behind.set(e.id, editsBehind(e, edits, { rows: laRows, fromAt: from, toAt: to }));
  }
  return { behind, rows: laRows, nameOf: nameLookup(people), meaningOf: meaningLookup(legendRows) };
}

/** The "By" cell: who made the change, and the edits themselves one press away. */
function byCell(event, by) {
  const edits = by?.behind.get(event.id);
  if (!edits || !edits.length) {
    return el('td', {
      class: 'rc-hint',
      text: '—',
      title: !event.la_row_id
        ? 'Found before readings carried the editor\'s row ids — the edit log cannot be joined to it'
        : 'No edit between these two readings matched this change',
    });
  }
  const people = editors(edits).map(by.nameOf);
  return el('td', { dataset: { sort: people.join(', '), csv: people.join(', ') } }, [
    el('div', { text: people.join(', ') }),
    el('button', {
      class: 'cx-btn mini ghost',
      text: edits.length === 1 ? 'The edit' : `The ${edits.length} edits`,
      title: 'Exactly what was changed, by whom and when',
      onClick: () => showEdits(event, edits, by),
    }),
  ]);
}

function showEdits(event, edits, by) {
  const lines = editLines(edits, { rows: by.rows, meaningOf: by.meaningOf });
  openModal({
    title: 'What was changed',
    subtitle: describe({ ...event, weekStart: event.week_start, rowKey: event.row_key }),
    body: el('div', { class: 'lae-form' }, [editList(lines, by.nameOf)]),
    actions: [{ label: 'Close' }],
  });
}

/** Edit lines as a list, newest first — the shape the editor's own history uses. */
function editList(lines, nameOf) {
  const list = el('ol', { class: 'lae-history', 'aria-label': 'Edits, newest first' });
  for (const line of [...lines].reverse()) {
    list.appendChild(el('li', { class: 'lae-history-item' }, [
      el('span', { class: 'lae-history-when', text: whenLabel(line.at) }),
      el('span', { class: 'lae-history-who', text: nameOf(line.by) }),
      el('span', { class: 'lae-history-what', text: sentence(line) }),
    ]));
  }
  return list;
}

/** One edit as one sentence: "IXL Regression Testing, Mon 12 Oct: Shift Day Shift → Cancellation". */
function sentence(line) {
  const where = line.day ? `, ${dayLabel(line.day)}` : '';
  return `${line.title}${where}: ${line.detail}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   Every edit
   ═══════════════════════════════════════════════════════════════════════ */

/** The edit log's span and filters — kept while the calendar is open. */
const editLog = { from: null, to: null, person: '', text: '' };

/**
 * Every change made in the editor, one line each.
 *
 * The summary says what moved between two readings; this is what was done to
 * get there — a cell painted and painted back again inside one save is two
 * lines here and nothing there. Read straight from `rc_la_edits`, which keeps
 * both sides of every change, so nothing is reconstructed. An administrator's,
 * like the log itself.
 */
async function renderEditLog(host) {
  const today = todayISO();
  if (!editLog.from) editLog.from = toISO(addDays(isoToMs(today), -13));
  const from = editLog.from;
  const to = editLog.to && editLog.to >= from ? editLog.to : today;

  let edits;
  let laRows;
  let people;
  let legendRows;
  try {
    [edits, laRows, people, legendRows] = await Promise.all([
      rc.listLaEditsBetween(`${from}T00:00:00Z`, `${to}T23:59:59.999Z`),
      rc.listLaRows().catch(() => []),
      rc.listPeople({ includeInactive: true }).catch(() => []),
      rc.listLegend().catch(() => []),
    ]);
  } catch (err) {
    host.appendChild(el('p', { class: 'rc-error', text: `The edit log could not be read: ${err.message}` }));
    return;
  }

  const nameOf = nameLookup(people);
  const lines = editLines(edits, { rows: laRows, meaningOf: meaningLookup(legendRows) }).reverse();

  const dateBox = (value, label, onPick) => {
    const box = el('input', { type: 'date', class: 'cx-input mini', value, 'aria-label': label, style: 'width:150px' });
    box.addEventListener('change', () => onPick(box.value));
    return box;
  };
  const authors = [...new Set(lines.map((l) => l.by))];
  if (editLog.person && !authors.includes(editLog.person)) editLog.person = '';
  const person = selectInput({
    value: editLog.person,
    mini: true,
    options: [
      { value: '', label: 'Everybody' },
      ...authors.map((id) => ({ value: id || '', label: nameOf(id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
    onChange: (v) => { editLog.person = v; drawRows(); },
  });
  person.style.width = '200px';
  person.setAttribute('aria-label', 'Edits made by');
  const search = textInput({
    value: editLog.text,
    mini: true,
    placeholder: 'Activity, location, day…',
    'aria-label': 'Find edits mentioning',
    style: 'width:260px',
    onInput: (v) => { editLog.text = typeof v === 'string' ? v : search.value; drawRows(); },
  });

  host.appendChild(el('div', {
    style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px',
  }, [
    el('span', { class: 'rc-hint', style: 'margin:0', text: 'From' }),
    dateBox(from, 'Edits made from', (v) => { if (v) { editLog.from = v; notifyChanged('changes'); } }),
    el('span', { class: 'rc-hint', style: 'margin:0', text: 'To' }),
    dateBox(to, 'Edits made up to', (v) => { editLog.to = v; notifyChanged('changes'); }),
    person,
    search,
  ]));

  if (!lines.length) {
    host.appendChild(emptyState({
      iconName: 'edit',
      title: 'Nothing was edited',
      message: `No change was made in the look-ahead editor between ${dayLabel(from)} and ${dayLabel(to)}. `
        + 'Widen the dates to look further back.',
    }));
    return;
  }

  const summary = el('p', { class: 'rc-hint' });
  const holder = el('div');
  host.append(summary, holder);
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'One line for each thing changed, newest first. "Exactly" says what differs — who was added '
      + 'to a day or taken off it, the shift painted or cleared, a support code asked for, taken off or '
      + 'struck out — and From and To are the whole cell before and after. A row moved up or down, or '
      + 'indented, is left out: that is where it sits, not what it says.',
  }));

  /* Only the rows are redrawn as the filters change — the search box stays put,
     so typing in it never loses the caret. */
  function drawRows() {
    const words = String(editLog.text || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    const shown = lines.filter((l) => {
      if (editLog.person && (l.by || '') !== editLog.person) return false;
      if (!words.length) return true;
      const hay = [l.title, l.location, l.what, l.detail, l.from, l.to, l.day, l.day ? dayLabel(l.day) : '']
        .join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    const people = new Set(shown.map((l) => l.by)).size;
    summary.textContent = `${shown.length} edit(s) by ${people} ${people === 1 ? 'person' : 'people'}`
      + ` between ${dayLabel(from)} and ${dayLabel(to)}${shown.length < lines.length ? ` — ${lines.length} in all` : ''}.`;
    clear(holder);
    const t = table(['When', 'Who', 'Activity', 'Location', 'Day', 'Changed', 'Exactly', 'From', 'To'], shown.map((l) => el('tr', {}, [
      el('td', { text: whenLabel(l.at), dataset: { sort: l.at, csv: l.at } }),
      el('td', { text: nameOf(l.by) }),
      el('td', { text: l.title }),
      el('td', { text: l.location || '—' }),
      el('td', { text: l.day ? dayLabel(l.day) : '—', dataset: { sort: l.day || '', csv: l.day || '' } }),
      el('td', { text: l.what }),
      el('td', { class: 'rc-edit-detail', text: l.detail }),
      el('td', { class: 'rc-hint', text: l.from || '—' }),
      el('td', { class: 'rc-hint', text: l.to || '—' }),
    ])));
    const tableEl = t.querySelector('table');
    tableEl.dataset.csv = 'lookahead-edits';
    holder.appendChild(t);
    enhanceTable(tableEl);
  }
  drawRows();
}
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
      el('td', { class: 'rc-num', text: String(s.row_count ?? 0) }, [
        s.compacted
          ? el('span', {
            class: 'rc-hint', style: 'margin:0 0 0 6px',
            text: '· compacted',
            title: 'A superseded editor reading past the keep period. Its grid can be rebuilt from the edit log; its rows and every link to them are kept.',
          })
          : null,
      ]),
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

