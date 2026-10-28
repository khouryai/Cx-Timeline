/**
 * The master export: everything useful the calendar holds, as one Excel
 * workbook — and the same workbook on a schedule, into the shared folder.
 *
 * One sheet per question somebody takes the record away to answer: what the
 * look-ahead said each day, who it names on which shift, what was cancelled
 * and why, what moved between readings and why, the leave, P6, the TAWRs, and
 * the registers that explain the rest. Each sheet is read the way the screen
 * that shows it reads — the same views, the same `assignmentIndex()`, the same
 * `cancellationLog()` — so the workbook and the calendar cannot tell two
 * stories. A sheet that cannot be read is written empty and named in About,
 * never left out silently.
 *
 * It is the record, `LookAhead_Latest.xlsx`. The 4WLA itself — its workbook,
 * PDF and picture, `4WLA_Latest.*` — is filed by Export to Excel's own
 * schedule (`ui/rc_la_schedule.js`), for a flow on the folder to send on.
 *
 * **The schedule runs here, in the page.** There is no server to run it and
 * nothing is emailed from this application (that is structural), so it runs
 * on the computer the calendar is open on — a browser tab or the desktop app —
 * and a slot missed while it was closed is run once when it next opens
 * (`core/export_schedule.js`). The file goes into `exports/` in the shared
 * folder through the folder's intake door (`filestore.intakeWrite()`); with
 * no folder connected it is downloaded.
 * Its settings are this computer's, because the folder and the clock are.
 */

import { el } from '../core/util.js';
import * as rc from '../core/rc.js';
import * as filestore from '../core/filestore.js';
import { tableWorkbook } from '../io/xlsx_write.js';
import { saveFile } from '../io/exporters.js';
import {
  isCancelMeaning, countCodes, describeCodeCounts, ABSENCE_LABELS, absencesFrom,
} from '../core/lookahead.js';
import { p6Index, p6Status } from '../core/la_p6.js';
import { FIELDS, addDaysISO, mondayOf } from '../core/la_edit.js';
import { describe as describeChange, rowsFrom } from '../core/la_register.js';
import { cleanSchedule, isDue, nextSlot } from '../core/export_schedule.js';
import { icon } from './icons.js';
import { openModal, toast, checkbox, selectInput, field } from './components.js';
import {
  todayISO, nameRegister, assignmentIndex, availability, shiftLabel, shiftFor,
  cancellationLog, parsedView, authorNames,
} from './rc_util.js';
import { KIND_LABELS } from './rc_la_changes.js';
import { writtenView } from './rc_ingest.js';

/** The folder, inside the shared one, the workbooks are filed in. */
export const EXPORT_DIR = 'exports';
/**
 * One name, replaced by every export: a workbook somebody links to — a
 * Power BI source, a SharePoint page, a pivot in another file — keeps working
 * and is always the newest. When it was made is on its About sheet.
 */
export const EXPORT_NAME = 'LookAhead_Latest.xlsx';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const STORE_KEY = 'cx.rc.masterExport';
/** How long a scheduled export that failed waits before it is tried again. */
const RETRY_MS = 30 * 60000;

/** What can go in, in the order the workbook has it. `reference` is four small sheets. */
export const SHEETS = [
  { id: 'lookahead', label: 'The look-ahead, day by day', hint: 'every activity and day — shift, support asked for and cancelled, who was named, and its P6 activity' },
  { id: 'shifts', label: 'Who is on what', hint: 'who the look-ahead names on which shift, on what and where, and who is away' },
  { id: 'cancellations', label: 'Cancellations', hint: 'every day and BART resource cancelled, with the party responsible and the reason' },
  { id: 'changes', label: 'Changes', hint: 'what moved between readings, and the reason given for it' },
  { id: 'leave', label: 'Leave', hint: 'leave booked' },
  { id: 'p6', label: 'P6 activities', hint: 'the list, and how many look-ahead rows name each activity' },
  { id: 'tawrs', label: 'TAWRs', hint: 'track access work requests' },
  { id: 'reference', label: 'The registers', hint: 'the team, the locations, the legend and the support codes' },
];

export const RANGES = [
  { id: 'all', label: 'Everything recorded', weeks: null },
  { id: '4', label: 'The last 4 weeks and everything ahead', weeks: 4 },
  { id: '13', label: 'The last 13 weeks and everything ahead', weeks: 13 },
  { id: '26', label: 'The last 26 weeks and everything ahead', weeks: 26 },
  { id: '52', label: 'The last 52 weeks and everything ahead', weeks: 52 },
  { id: 'custom', label: 'Between two dates', weeks: null },
];

/* ══════════════════════════════════════════════════════════════════════════
   This computer's settings
   ═══════════════════════════════════════════════════════════════════════ */

/** The defaults: every sheet, everything recorded, no schedule. */
function defaults() {
  return {
    sheets: SHEETS.map((s) => s.id),
    range: 'all',
    from: '',
    to: '',
    schedule: cleanSchedule({ every: 'off', at: '06:00', weekday: 1, hours: 24 }),
    since: null,
    lastRun: null,
    failedAt: null,
    last: null,
  };
}

export function loadSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    stored = {};
  }
  const base = defaults();
  return {
    ...base,
    ...stored,
    sheets: Array.isArray(stored.sheets) ? stored.sheets.filter((id) => SHEETS.some((s) => s.id === id)) : base.sheets,
    schedule: cleanSchedule(stored.schedule || base.schedule),
  };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    // No storage: the export still runs now, it just cannot be remembered.
  }
}

/** The dates a range asks for; null at either end is "as far as the record goes". */
export function rangeDates(settings, today = todayISO()) {
  const choice = RANGES.find((r) => r.id === settings.range) || RANGES[0];
  if (choice.id === 'custom') {
    return { from: settings.from || null, to: settings.to || null, label: `${settings.from || 'the start'} to ${settings.to || 'the end'}` };
  }
  if (!choice.weeks) return { from: null, to: null, label: 'Everything recorded' };
  return { from: addDaysISO(mondayOf(today), -7 * choice.weeks), to: null, label: choice.label };
}

/* ══════════════════════════════════════════════════════════════════════════
   Building the workbook
   ═══════════════════════════════════════════════════════════════════════ */

const weekday = (iso) => (iso
  ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })
  : '');

/** Every day from one ISO date to another, inclusive. */
function daysBetween(from, to) {
  const out = [];
  for (let d = from; d && to && d <= to && out.length < 4000; d = addDaysISO(d, 1)) out.push(d);
  return out;
}


/**
 * The context every sheet reads from — the registers, read once, and the two
 * heavy reads the look-ahead and shifts sheets share, each made once and only
 * if a sheet asks for it.
 */
async function context(range) {
  const [people, aliases, locations, categories, parties, legendRows, codes, entries, flags, laRows, settings, leaveKinds] = await Promise.all([
    rc.listPeople({ includeInactive: true }).catch(() => []),
    rc.listPersonAliases().catch(() => []),
    rc.listLocations({ includeInactive: true }).catch(() => []),
    rc.listCategories({ includeInactive: true }).catch(() => []),
    rc.readAll('rc_parties').catch(() => []),
    rc.listLegend({ includeInactive: true }).catch(() => []),
    rc.listSupportCodes({ includeRetired: true }).catch(() => []),
    rc.listP6Activities().catch(() => []),
    rc.listP6Flags({ includeRetired: true }).catch(() => []),
    rc.listLaRows().catch(() => []),
    rc.listSettings().catch(() => []),
    rc.readAll('rc_leave_kinds').catch(() => []),
  ]);
  const once = (fn) => {
    let p = null;
    return () => (p = p || fn());
  };
  const ctx = {
    ...range,
    people,
    locations,
    categories,
    parties,
    legendRows,
    codes,
    p6Entries: entries,
    p6: p6Index(entries, flags),
    laRows,
    settings,
    personById: new Map(people.map((p) => [p.id, p])),
    personByUser: new Map(people.filter((p) => p.user_id).map((p) => [p.user_id, p])),
    locationById: new Map(locations.map((l) => [l.id, l])),
    categoryById: new Map(categories.map((c) => [c.id, c])),
    partyById: new Map(parties.map((p) => [p.id, p])),
    leaveKindById: new Map(leaveKinds.map((k) => [k.id, k])),
    register: nameRegister(people, aliases),
    roleOf: new Map(legendRows.map((l) => [String(l.meaning || ''), l.role || 'shift'])),
    cancelHex: new Set(legendRows.filter((l) => isCancelMeaning(l.meaning)).map((l) => `#${String(l.argb).toUpperCase()}`)),
  };
  ctx.days = once(async () => {
    const read = await rc.lookaheadDays(range.from, range.to);
    if (ctx.source !== 'editor') return read;
    const written = await writtenOnlyDays(ctx, read, range);
    return written.length ? [...read, ...written].sort((a, b) => a.day.localeCompare(b.day)) : read;
  });
  ctx.who = authorNames(people);
  ctx.name = (personId) => (personId ? ctx.personById.get(personId)?.name || '' : '');
  ctx.place = (locationId, raw = '') => (locationId ? ctx.locationById.get(locationId)?.name || raw || '' : raw || '');
  ctx.source = settings.find((r) => r.key === 'lookahead_source')?.value || 'workbook';
  return ctx;
}

/**
 * The days written in the calendar that no reading holds, shaped as
 * `rc_lookahead_days` rows.
 *
 * A reading covers the week just gone and the five ahead, so a week written
 * further back than that — the history filled in after the fact — is in the
 * editor's tables and in no reading, and the export left it out. Those weeks,
 * and only those, are drawn through the publish path (`writtenView()` →
 * `rowsFrom()`), the derivation every reading's rows come from, so a week
 * from here and a week from a reading say the same thing in the same words. A
 * week any reading holds is still read from the newest of them. Nothing is
 * stored, and `taken_at` is null: no reading was taken of these.
 */
async function writtenOnlyDays(ctx, read, range) {
  const span = await rc.laCellSpan().catch(() => ({ first: null, last: null }));
  if (!span.first || !span.last) return [];
  const from = mondayOf(range.from && range.from > span.first ? range.from : span.first);
  const to = range.to && range.to < span.last ? range.to : span.last;
  const covered = new Set(read.map((d) => String(d.week_start).slice(0, 10)));
  const missing = [];
  for (let w = from; w <= to && missing.length < 520; w = addDaysISO(w, 7)) if (!covered.has(w)) missing.push(w);
  if (!missing.length) return [];
  const view = await writtenView(missing[0], addDaysISO(missing[missing.length - 1], 6), ctx.legendRows);
  const resolved = new Map();
  const rows = await rowsFrom(view, {
    locate: async (text) => {
      const key = String(text || '').trim();
      if (!key) return null;
      if (!resolved.has(key)) resolved.set(key, await rc.resolveLocation(key).catch(() => null));
      return resolved.get(key);
    },
  });
  const wanted = new Set(missing);
  const out = [];
  for (const r of rows) {
    if (!wanted.has(r.week_start)) continue;
    for (const day of new Set([...Object.keys(r.cells), ...Object.keys(r.bart_marks), ...Object.keys(r.resources)])) {
      if ((range.from && day < range.from) || (range.to && day > range.to)) continue;
      out.push({
        // One row of the look-ahead in one week, as a reading's row is — the shifts sheet groups by it.
        row_id: `written:${r.la_row_id || r.row_key}:${r.week_start}`,
        snapshot_id: null, taken_at: null, week_start: r.week_start, row_key: r.row_key, sheet_row: r.sheet_row,
        location_id: r.location_id, raw_location: r.raw_location, raw_label: r.raw_label, subsystem: null,
        la_row_id: r.la_row_id, day,
        paint: r.cells[day] ?? null, marks: r.bart_marks[day] ?? null, names: r.resources[day] ?? null,
      });
    }
  }
  return out;
}

/** The P6 activity a row names — its Activity ID, or any part of the label as read. */
function p6Of(ctx, activityId, label) {
  const candidates = [activityId, ...String(label || '').split(' · ')].map((v) => String(v || '').trim()).filter(Boolean);
  for (const c of candidates) {
    const status = p6Status(c, ctx.p6);
    if (status.kind === 'linked' || status.kind === 'flagged') return status;
  }
  return null;
}

/** The sections an editor row sits under, outermost first: "Phase 2 › Signals". */
function sectionsOf(byId, row) {
  const out = [];
  let at = row ? byId.get(row.parent_id) : null;
  for (let guard = 0; at && guard < 10; guard++) {
    if (at.kind === 'section') out.unshift(at.description);
    at = byId.get(at.parent_id);
  }
  return out.filter(Boolean).join(' › ');
}

/** Which colour a day was painted, in words — and whether it is a shift, a cancellation or neither. */
function paintOf(ctx, paint) {
  const said = String(paint || '');
  if (!said) return { words: '', cancelled: false, shift: '' };
  if (said.startsWith('#')) {
    const cancelled = ctx.cancelHex.has(said.toUpperCase());
    return { words: cancelled ? `Cancelled (${said})` : `Colour ${said}, not in the legend`, cancelled, shift: '' };
  }
  const cancelled = isCancelMeaning(said);
  const role = ctx.roleOf.get(said) || 'shift';
  return { words: said, cancelled, shift: !cancelled && role === 'shift' ? shiftLabel(shiftFor(said)) : '' };
}

const BUILDERS = {
  async lookahead(ctx) {
    const days = await ctx.days();
    const byId = new Map(ctx.laRows.map((r) => [r.id, r]));
    const fields = FIELDS.map((f) => ({ heading: f.heading, key: f.key }));
    return [{
      name: 'Look-ahead',
      columns: [
        { heading: 'Date', kind: 'date' }, { heading: 'Day' }, { heading: 'Week starting', kind: 'date' },
        { heading: 'Section' },
        ...fields.map((f) => ({ heading: f.heading, wrap: f.key === 'description', width: f.key === 'description' ? 48 : undefined })),
        { heading: 'Activity, as read', width: 48 },
        { heading: 'P6 activity ID' }, { heading: 'P6 activity name', width: 40 }, { heading: 'P6 WBS' },
        { heading: 'Not in P6 — reason' },
        { heading: 'Location (register)' }, { heading: 'Subsystem' },
        { heading: 'Painted as' }, { heading: 'Shift' }, { heading: 'Cancelled' },
        { heading: 'Support asked for' }, { heading: 'Support cancelled' },
        { heading: 'Names on the day', width: 32 },
        { heading: 'From the reading of', kind: 'datetime' },
        { heading: 'Source' },
      ],
      rows: days.map((d) => {
        const row = d.la_row_id ? byId.get(d.la_row_id) : null;
        const p6 = p6Of(ctx, row?.activity_id, d.raw_label);
        const paint = paintOf(ctx, d.paint);
        return [
          d.day, weekday(d.day), d.week_start, row ? sectionsOf(byId, row) : '',
          ...fields.map((f) => (row ? row[f.key] || '' : '')),
          d.raw_label || '',
          p6?.kind === 'linked' ? p6.entry.activity_id : '',
          p6?.kind === 'linked' ? p6.entry.name : '',
          p6?.kind === 'linked' ? p6.entry.wbs || '' : '',
          p6?.kind === 'flagged' ? p6.flag.label : '',
          ctx.place(d.location_id, ''), d.subsystem || '',
          paint.words, paint.shift, paint.words ? paint.cancelled : '',
          describeCodeCounts(countCodes([d.marks || ''])),
          describeCodeCounts(countCodes([d.marks || ''], { cancelled: true })),
          d.names || '',
          d.taken_at || '',
          d.taken_at ? 'A reading' : 'The calendar as written — no reading has this week',
        ];
      }),
      empty: 'No reading covers these dates.',
    }];
  },

  async shifts(ctx) {
    const [leave, latest, days] = await Promise.all([
      rc.readAll('rc_leave', { column: 'start_date' }),
      rc.latestSnapshot().catch(() => null),
      ctx.days(),
    ]);
    /* The look-ahead's rows, rebuilt from the days: what `assignmentIndex()`
       takes, a day stored as the bare red of a cancellation named as one. */
    const rows = new Map();
    for (const d of days) {
      const row = rows.get(d.row_id) || {
        id: d.row_id, raw_label: d.raw_label, raw_location: d.raw_location, location_id: d.location_id,
        week_start: d.week_start, cells: {}, resources: {}, bart_marks: {},
      };
      if (d.paint) row.cells[d.day] = ctx.cancelHex.has(String(d.paint).toUpperCase()) ? 'Cancellation' : d.paint;
      if (d.names) row.resources[d.day] = d.names;
      if (d.marks) row.bart_marks[d.day] = d.marks;
      rows.set(d.row_id, row);
    }
    // The PTO row is read off the latest reading only, as the PTO calendar reads it.
    const absences = latest?.grid ? absencesFrom(parsedView(latest, ctx.legendRows)) : [];
    const index = assignmentIndex({ planRows: [], laRows: [...rows.values()], register: ctx.register, absences, categories: ctx.categories });

    const dates = days.map((d) => d.day).filter(Boolean).sort();
    const from = ctx.from || dates[0];
    const to = ctx.to || [dates[dates.length - 1], todayISO()].filter(Boolean).sort().pop();
    const out = [];
    for (const iso of daysBetween(from, to)) {
      for (const person of ctx.people) {
        const entries = index.on(person.id, iso);
        for (const entry of entries) {
          out.push([
            iso, weekday(iso), person.name, person.subsystem || '',
            entry.absence ? '' : shiftLabel(entry.shift || 'day'),
            entry.task || (entry.absence ? ABSENCE_LABELS[entry.absence] : ''),
            ctx.place(entry.location_id, entry.raw_location),
            entry.absence ? 'The look-ahead\'s PTO / Office / Other row' : 'The look-ahead',
            Boolean(entry.cancelled),
          ]);
        }
        if (entries.length) continue;
        const free = availability(person, iso, leave);
        if (free.state === 'leave' && free.leave) {
          out.push([iso, weekday(iso), person.name, person.subsystem || '', '',
            `Leave — ${ctx.leaveKindById.get(free.leave.kind_id)?.name || 'leave'}`, '', 'Booked leave', false]);
        }
      }
    }
    return [{
      name: 'Who is on what',
      columns: [
        { heading: 'Date', kind: 'date' }, { heading: 'Day' }, { heading: 'Person' }, { heading: 'Subsystem' },
        { heading: 'Shift' }, { heading: 'Activity or task', width: 48 }, { heading: 'Location' },
        { heading: 'From' }, { heading: 'Cancelled' },
      ],
      rows: out,
      empty: 'Nobody is named on the look-ahead in these dates.',
    }];
  },

  async cancellations(ctx) {
    const events = (await cancellationLog(ctx.from || '2000-01-01')).filter((e) => !ctx.to || e.start <= ctx.to);
    return [{
      name: 'Cancellations',
      columns: [
        { heading: 'From', kind: 'date' }, { heading: 'To', kind: 'date' }, { heading: 'Days', kind: 'number' },
        { heading: 'What' }, { heading: 'Activity', width: 48 }, { heading: 'Location' },
        { heading: 'Resources cancelled' }, { heading: 'Responsible party' }, { heading: 'Reason', width: 48, wrap: true },
        { heading: 'Logged by' }, { heading: 'Logged at', kind: 'datetime' },
        { heading: 'Readings that showed it', kind: 'number' }, { heading: 'First seen', kind: 'datetime' }, { heading: 'Last seen', kind: 'datetime' },
        { heading: 'Removed from the log' },
      ],
      rows: events.map((e) => [
        e.start, e.end, e.days, e.kind === 'support' ? 'BART resource cancelled' : 'Activity cancelled',
        e.label || '', e.location || '', describeCodeCounts(e.resources), e.note?.party || '', e.note?.reason || '',
        ctx.who(e.note?.author), e.note?.created_at || '', e.reads || 0, e.firstSeen || '', e.lastSeen || '', Boolean(e.dismissed),
      ]),
      empty: 'Nothing was cancelled in these dates.',
    }];
  },

  async changes(ctx) {
    const [events, notes] = await Promise.all([
      rc.readAll('rc_change_events', { column: 'detected_at', from: ctx.from, to: ctx.to ? `${ctx.to}T23:59:59` : null }),
      rc.readAll('rc_change_annotations').catch(() => []),
    ]);
    // The newest annotation for each event is the answer; the ones under it are its history.
    const said = new Map();
    for (const a of [...notes].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))) said.set(a.change_event_id, a);
    return [{
      name: 'Changes',
      columns: [
        { heading: 'Detected', kind: 'datetime' }, { heading: 'Week starting', kind: 'date' }, { heading: 'Kind' },
        { heading: 'What changed', width: 60, wrap: true }, { heading: 'Location' },
        { heading: 'Reason given', width: 48, wrap: true }, { heading: 'Party' }, { heading: 'Noted as' }, { heading: 'Noted by' },
      ],
      rows: events.map((e) => {
        const a = said.get(e.id);
        return [
          e.detected_at, e.week_start || '', KIND_LABELS[e.kind] || e.kind,
          describeChange({ ...e, weekStart: e.week_start, rowKey: e.row_key }), ctx.place(e.location_id, ''),
          a?.note || '', a?.party_id ? ctx.partyById.get(a.party_id)?.name || '' : '', a?.kind || '', ctx.who(a?.author),
        ];
      }),
      empty: 'No change was recorded in these dates.',
    }];
  },

  async leave(ctx) {
    const rows = (await rc.readAll('rc_leave', { column: 'start_date' }))
      .filter((l) => (!ctx.from || l.end_date >= ctx.from) && (!ctx.to || l.start_date <= ctx.to));
    const span = (l) => Math.round((Date.parse(l.end_date) - Date.parse(l.start_date)) / 86400000) + 1;
    return [{
      name: 'Leave',
      columns: [
        { heading: 'Person' }, { heading: 'Kind' }, { heading: 'From', kind: 'date' }, { heading: 'To', kind: 'date' },
        { heading: 'Calendar days', kind: 'number' }, { heading: 'Status' }, { heading: 'First day' }, { heading: 'Last day' },
        { heading: 'Note', width: 40, wrap: true }, { heading: 'Booked', kind: 'datetime' },
      ],
      rows: rows.map((l) => [
        ctx.name(l.person_id), ctx.leaveKindById.get(l.kind_id)?.name || '', l.start_date, l.end_date, span(l),
        l.status || '', l.start_portion || '', l.end_portion || '', l.note || '', l.created_at,
      ]),
      empty: 'No leave in these dates.',
    }];
  },

  async p6(ctx) {
    const uses = new Map();
    for (const r of ctx.laRows) {
      if (r.kind !== 'activity' || r.archived) continue;
      const status = p6Status(r.activity_id, ctx.p6);
      if (status.kind === 'linked') uses.set(status.entry.activity_id, (uses.get(status.entry.activity_id) || 0) + 1);
    }
    return [{
      name: 'P6 activities',
      columns: [
        { heading: 'Activity ID' }, { heading: 'Activity name', width: 48 }, { heading: 'WBS', width: 32 },
        { heading: 'In the latest extract' }, { heading: 'Look-ahead rows naming it', kind: 'number' },
        { heading: 'Imported', kind: 'datetime' },
      ],
      rows: ctx.p6Entries.map((e) => [e.activity_id, e.name || '', e.wbs || '', !e.missing, uses.get(e.activity_id) || 0, e.imported_at || '']),
      empty: 'No P6 extract has been imported — Look-ahead → P6 activities.',
    }];
  },

  async tawrs(ctx) {
    const rows = (await rc.listTawrsFrom(ctx.from || '2000-01-01')).filter((t) => !ctx.to || t.week_start <= ctx.to);
    return [{
      name: 'TAWRs',
      columns: [
        { heading: 'Week starting', kind: 'date' }, { heading: 'First day', kind: 'date' }, { heading: 'Location' },
        { heading: 'Shift' }, { heading: 'Status' }, { heading: 'Created', kind: 'datetime' }, { heading: 'Created by' },
        { heading: 'Approved', kind: 'datetime' }, { heading: 'Approved by' },
      ],
      rows: rows.map((t) => [
        t.week_start, t.first_day || '', t.location_name || ctx.place(t.location_id, ''), shiftLabel(t.shift), t.status || '',
        t.created_at, ctx.who(t.created_by), t.approved_at || '', ctx.who(t.approved_by),
      ]),
      empty: 'No TAWR in these dates.',
    }];
  },

  async reference(ctx) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return [
      {
        name: 'Team',
        columns: [
          { heading: 'Name' }, { heading: 'Email' }, { heading: 'Title' }, { heading: 'Subsystem' },
          { heading: 'Takes shifts' }, { heading: 'Active' }, { heading: 'Working days' },
        ],
        rows: ctx.people.map((p) => [
          p.name, p.email || '', p.title || '', p.subsystem || '', p.scheduled !== false, p.active !== false,
          (Array.isArray(p.working_days) ? p.working_days : [1, 2, 3, 4, 5]).map((d) => days[d - 1]).filter(Boolean).join(' '),
        ]),
      },
      {
        name: 'Locations',
        columns: [{ heading: 'Name' }, { heading: 'Code' }, { heading: 'Active' }],
        rows: ctx.locations.map((l) => [l.name, l.code || '', l.active !== false]),
      },
      {
        name: 'Legend',
        columns: [{ heading: 'Colour' }, { heading: 'Meaning' }, { heading: 'Role' }, { heading: 'In force from', kind: 'date' }, { heading: 'Active' }],
        rows: ctx.legendRows.map((l) => [`#${l.argb}`, l.meaning || '', l.role || 'shift', l.valid_from || '', l.active !== false]),
      },
      {
        name: 'Support codes',
        columns: [{ heading: 'Code' }, { heading: 'Name' }, { heading: 'Party' }, { heading: 'Active' }],
        rows: ctx.codes.map((c) => [c.code, c.name || '', c.party || 'BART', c.active !== false]),
      },
    ];
  },
};

const NAMES = {
  lookahead: ['Look-ahead'], shifts: ['Who is on what'], cancellations: ['Cancellations'], changes: ['Changes'],
  leave: ['Leave'], p6: ['P6 activities'], tawrs: ['TAWRs'], reference: ['Team', 'Locations', 'Legend', 'Support codes'],
};

/**
 * The workbook, from what `settings` asks for. Returns `{ bytes, name,
 * sheets, failed }`: `sheets` is what went in and how many rows each has, and
 * `failed` what could not be read and why.
 */
export async function buildMasterExport(settings = loadSettings(), { now = new Date() } = {}) {
  const range = rangeDates(settings);
  const ctx = await context(range);
  const wanted = SHEETS.filter((s) => settings.sheets.includes(s.id));
  const sheets = [];
  const failed = [];
  /* One at a time, in order, and each on its own: a sheet that cannot be
     read is written empty and named, never allowed to lose the rest. */
  for (const want of wanted) {
    try {
      sheets.push(...await BUILDERS[want.id](ctx));
    } catch (err) {
      failed.push({ id: want.id, label: want.label, message: err.message });
      for (const name of NAMES[want.id]) sheets.push({ name, columns: [{ heading: name }], rows: [], empty: `Could not be read: ${err.message}` });
    }
  }

  const about = {
    name: 'About',
    columns: [{ heading: 'Item', width: 28 }, { heading: 'Value', width: 40 }, { heading: 'Detail', width: 90, wrap: true }],
    rows: [
      ['Exported', now.toLocaleString(), now.toISOString()],
      ['Exported by', rc.me()?.name || '', ''],
      ['Dates', range.label, range.from || range.to ? `${range.from || 'the start'} to ${range.to || 'the end'}` : ''],
      ['The look-ahead is written in', ctx.source === 'editor' ? 'The calendar (Edit)' : 'The workbook', ''],
      ['How a day of the look-ahead is read', 'The newest reading of its week', 'Each week comes from the newest reading taken of it — '
        + 'so a week the window has rolled past keeps the last reading that had it, and older readings '
        + 'of the same week are still on the record in the calendar. A week written in the calendar that no reading has — '
        + 'further back than the week just gone, filled in afterwards — comes from the calendar as written, and says so in its Source column.'],
      ['', '', ''],
      ['Sheet', 'Rows', 'What it holds'],
      ...sheets.map((s) => {
        const meta = SHEETS.find((x) => NAMES[x.id].includes(s.name));
        const fail = failed.find((f) => NAMES[f.id].includes(s.name));
        return [s.name, fail ? 'Could not be read' : String(s.rows.length), fail ? fail.message : meta?.hint || ''];
      }),
    ],
  };
  const bytes = await tableWorkbook({ sheets: [about, ...sheets], title: 'CX Timeline — master export' });

  return {
    bytes,
    name: EXPORT_NAME,
    sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length })),
    failed,
  };
}

/**
 * Put the workbook — and the 4WLA beside it — where it goes: `exports/` in
 * the shared folder when one is connected, the downloads folder otherwise.
 */
async function deliver(result) {
  if (filestore.hasFolder?.()) {
    /* Written under the same name, so the last export is replaced, not kept
       beside. Windows will not replace a workbook somebody has open in Excel,
       and the error it gives says nothing of the sort — so it is said here. */
    const replace = async (name, bytes) => {
      try {
        await filestore.intakeWrite(`${EXPORT_DIR}/${name}`, bytes);
      } catch (err) {
        throw new Error(`${EXPORT_DIR}/${name} could not be replaced — if it is open in Excel, close it and export again `
          + `(a scheduled export tries again by itself). ${err.message}`);
      }
    };
    await replace(result.name, result.bytes);
    return { where: 'folder', path: `${EXPORT_DIR}/${result.name}` };
  }
  saveFile(result.name, result.bytes, XLSX, 'Master export');
  return { where: 'download', path: result.name };
}

/** Build, deliver, and remember how it went. */
export async function runMasterExport(settings = loadSettings()) {
  const result = await buildMasterExport(settings);
  const went = await deliver(result);
  const rows = result.sheets.reduce((n, s) => n + s.rows, 0);
  saveSettings({ ...loadSettings(), last: { at: Date.now(), ...went, rows, failed: result.failed.length } });
  return { ...result, ...went, rows };
}

function saidWhere(out) {
  return out.where === 'folder' ? `Saved to the shared folder — ${out.path}` : `Downloaded — ${out.path}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   The schedule
   ═══════════════════════════════════════════════════════════════════════ */

let started = false;
let running = false;

/**
 * Look once a minute for an export that is due, on this computer. Started
 * when the calendar starts, and acting only while it is open — which is the
 * whole of what a page can promise. Holding the pen is not needed: the export
 * reads the calendar and writes only into `exports/`.
 */
export function startScheduledExports() {
  if (started) return;
  started = true;
  setTimeout(() => { scheduledTick(); }, 20000);
  setInterval(() => { scheduledTick(); }, 60000);
}

export async function scheduledTick(now = Date.now()) {
  if (running || !rc.isSignedIn()) return false;
  const s = loadSettings();
  if (!isDue(s.schedule, { lastRun: s.lastRun, since: s.since }, now)) return false;
  if (s.failedAt && now - s.failedAt < RETRY_MS) return false;
  /* Claimed before it runs, so a second tab looking a moment later finds it
     done rather than exporting the same thing twice. */
  saveSettings({ ...s, lastRun: now });
  running = true;
  try {
    const out = await runMasterExport(s);
    saveSettings({ ...loadSettings(), lastRun: now, failedAt: null });
    toast({ tone: out.failed.length ? 'warn' : 'info', title: 'Scheduled master export', message: saidWhere(out), timeout: 6000 });
    return true;
  } catch (err) {
    saveSettings({ ...loadSettings(), lastRun: s.lastRun, failedAt: now });
    rc.reportError('master-export:scheduled', err);
    toast({ tone: 'bad', title: 'The scheduled master export failed', message: `${err.message} — it is tried again in half an hour.`, timeout: 12000 });
    return false;
  } finally {
    running = false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   The dialog
   ═══════════════════════════════════════════════════════════════════════ */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function when(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function openMasterExport() {
  const s = loadSettings();
  const boxes = SHEETS.map((sheet) => {
    const box = checkbox({ label: `${sheet.label} — ${sheet.hint}`, checked: s.sheets.includes(sheet.id) });
    box.dataset.sheet = sheet.id;
    box.classList.add('rc-mx-sheet');
    return box;
  });
  const range = selectInput({ value: s.range, options: RANGES.map((r) => ({ value: r.id, label: r.label })) });
  const from = el('input', { type: 'date', class: 'cx-input', value: s.from || '' });
  const to = el('input', { type: 'date', class: 'cx-input', value: s.to || '' });
  const dates = el('div', { class: 'rc-mx-dates' }, [field('From', from), field('To', to)]);


  const every = selectInput({
    value: s.schedule.every,
    options: [
      { value: 'off', label: 'Only when I press Export now' },
      { value: 'day', label: 'Every day' },
      { value: 'week', label: 'Every week' },
      { value: 'hours', label: 'Every few hours' },
    ],
  });
  every.classList.add('rc-mx-every');
  const at = el('input', { type: 'time', class: 'cx-input rc-mx-at', value: s.schedule.at });
  const day = selectInput({ value: String(s.schedule.weekday), options: WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d })) });
  const hours = el('input', { type: 'number', class: 'cx-input rc-mx-hours', min: '1', max: '168', value: String(s.schedule.hours) });
  const atField = field('At', at);
  const dayField = field('On', day);
  const hoursField = field('Every how many hours', hours);
  const status = el('p', { class: 'rc-hint rc-mx-status' });

  const read = () => ({
    ...loadSettings(),
    sheets: boxes.filter((b) => b.querySelector('input').checked).map((b) => b.dataset.sheet),
    range: range.value,
    from: from.value,
    to: to.value,
    schedule: cleanSchedule({ every: every.value, at: at.value, weekday: Number(day.value), hours: Number(hours.value) }),
  });
  const show = () => {
    dates.hidden = range.value !== 'custom';
    atField.hidden = every.value !== 'day' && every.value !== 'week';
    dayField.hidden = every.value !== 'week';
    hoursField.hidden = every.value !== 'hours';
    const now = Date.now();
    const next = read();
    const last = s.last ? `Last export ${when(s.last.at)} — ${s.last.where === 'folder' ? `into the shared folder, ${s.last.path}` : 'downloaded'}. ` : 'Not exported from this computer yet. ';
    const coming = next.schedule.every === 'off' ? ''
      : `Next ${when(nextSlot(next.schedule, s.lastRun ?? s.since ?? now, now))}.`;
    status.textContent = last + coming;
  };
  for (const c of [range, every, at, day, hours]) c.addEventListener('change', show);
  show();

  const save = () => {
    const next = read();
    const was = loadSettings();
    const changed = JSON.stringify(was.schedule) !== JSON.stringify(next.schedule);
    // Switched on or changed now: the first export is at the next slot, not this minute.
    if (changed) { next.since = Date.now(); next.lastRun = null; next.failedAt = null; }
    saveSettings(next);
    return next;
  };

  const folder = filestore.hasFolder?.();
  openModal({
    title: 'Master export',
    subtitle: 'Everything useful the calendar holds, as one Excel workbook',
    body: el('div', { class: 'cx-form rc-mx-form' }, [
      el('div', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'What goes in — a sheet each' }), el('div', { class: 'rc-mx-sheets' }, boxes)]),
      field('Dates', range),
      dates,
      el('p', {
        class: 'rc-hint rc-mx-where',
        text: folder
          ? `Saved as ${EXPORT_DIR}/${EXPORT_NAME} in the shared folder, replacing the last one — on a synced folder it reaches everybody who has it.`
          : `Downloaded to this computer as ${EXPORT_NAME}. A browser never overwrites a download, so a second one arrives as `
            + `"LookAhead_Latest (1).xlsx" — open the shared folder in the timeline and it is saved into ${EXPORT_DIR}/ there, replacing the last.`,
      }),
      field('On a schedule', every),
      el('div', { class: 'rc-mx-when' }, [dayField, atField, hoursField]),
      el('p', {
        class: 'rc-hint',
        text: 'A schedule runs on this computer, while the calendar is open on it — in a browser tab or the desktop app. '
          + 'A time missed while it was closed is exported once, the next time it opens.',
      }),
      status,
    ]),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save', onClick: () => {
          const next = save();
          toast({ message: next.schedule.every === 'off' ? 'Saved. Nothing is exported on a schedule.' : 'Saved. The schedule runs while the calendar is open here.' });
        },
      },
      {
        label: 'Export now', kind: 'primary', autofocus: true, onClick: () => {
          const next = save();
          if (!next.sheets.length) {
            toast({ message: 'Tick at least one sheet to export.' });
            return false;
          }
          toast({ message: 'Building the master export…', timeout: 3000 });
          runMasterExport(next).then((out) => {
            toast({
              tone: out.failed.length ? 'warn' : 'good',
              title: `Master export — ${out.rows.toLocaleString()} rows on ${out.sheets.length} sheets`,
              message: saidWhere(out) + (out.failed.length ? ` · could not read: ${out.failed.map((f) => f.label).join(', ')}` : ''),
              timeout: 9000,
            });
          }).catch((err) => {
            rc.reportError('master-export', err);
            toast({ tone: 'bad', message: `The master export failed — ${err.message}`, timeout: 12000 });
          });
          return undefined;
        },
      },
    ],
  });
}

/** The button that opens it — the same everywhere it is offered. */
export function masterExportButton() {
  return el('button', {
    class: 'cx-btn mini primary rc-master-export',
    type: 'button',
    html: icon('download', { size: 12 }) + '<span>Master export</span>',
    title: 'Everything useful the calendar holds, as one Excel workbook — now, or on a schedule',
    onClick: () => openMasterExport(),
  });
}
