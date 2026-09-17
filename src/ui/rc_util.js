/**
 * Small shared helpers for the resource calendar's tabs.
 *
 * These live in a leaf of their own rather than in `ui/rc.js` because `rc.js`
 * imports the tabs and the tabs need the helpers — putting them together would
 * be a cycle, and the build rejects those outright rather than letting one
 * quietly half-initialise.
 *
 * Imports: util, events, dates, components.
 */

import { el } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { toISO, todayMs, fmtDate, addDays, MS_DAY } from '../core/dates.js';
import {
  resourceNames, readGrid, locationColumnOf, absencesFrom, ABSENCE_LABELS, ABSENCE_KINDS,
} from '../core/lookahead.js';
import { applyLegend } from '../io/lookahead.js';
import * as rc from '../core/rc.js';
import { openModal } from './components.js';

/**
 * A modal whose confirm button does something that can fail.
 *
 * `openModal` closes on click unless the handler returns false, which is right
 * for a menu and wrong for a form that writes to a database over a network.
 * Here the dialog stays open, the button says what is happening, and a refusal
 * is shown in place rather than as a toast over a form that has already gone —
 * every write in this module can be refused by a policy, so that case is the
 * normal one rather than the exception.
 */
export function formModal({ title, body, confirmLabel = 'Save', onConfirm }) {
  const error = el('div', { class: 'rc-error', hidden: true });
  const wrap = el('div', {}, [body, error]);
  let busy = false;

  const modal = openModal({
    title,
    body: wrap,
    actions: [
      { label: 'Cancel' },
      {
        label: confirmLabel,
        kind: 'primary',
        keepOpen: true,
        autofocus: true,
        onClick: async (handle) => {
          if (busy) return;
          busy = true;
          error.hidden = true;
          try {
            await onConfirm();
            handle.close();
          } catch (err) {
            error.textContent = err?.message || String(err);
            error.hidden = false;
          } finally {
            busy = false;
          }
        },
      },
    ],
  });
  return modal;
}

/**
 * The Monday of the week containing `ms`.
 *
 * Mondays because that is what the look-ahead is keyed on, and matching the
 * source's idea of a week is what lets a plan row and a look-ahead row be
 * compared at all. `getUTCDay()` and not `getDay()`: a calendar date must not
 * move because of a timezone.
 */
export function weekStart(ms) {
  const day = new Date(ms).getUTCDay();
  return ms - ((day + 6) % 7) * MS_DAY;
}

/** The five working days of a week, as ISO strings. */
export function weekDays(startMs) {
  return [0, 1, 2, 3, 4].map((n) => toISO(addDays(startMs, n)));
}

/** The seven days, for a view that has to show a weekend possession. */
export function allWeekDays(startMs) {
  return [0, 1, 2, 3, 4, 5, 6].map((n) => toISO(addDays(startMs, n)));
}

export function todayISO() {
  return toISO(todayMs());
}

/** An ISO date back to the millisecond scale the rest of the app uses. */
export function isoToMs(iso) {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

export function dayLabel(iso, preset = 'short') {
  return fmtDate(isoToMs(iso), preset);
}

/** Index rows by id, so a join costs one pass rather than a query per row. */
export function byId(rows) {
  const map = new Map();
  for (const row of rows || []) map.set(row.id, row);
  return map;
}

/** Group rows under a key, for a grid that is people down and days across. */
export function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows || []) {
    const k = typeof key === 'function' ? key(row) : row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

/** A row was written. Whatever is on screen reloads. */
export function notifyChanged(what) {
  emit(EV.RC_CHANGED, { what });
}

/**
 * The five statuses, split into the two families that must never be averaged.
 *
 * Performance is what an individual did. Health is what was done to them — a
 * possession released late is not underperformance, and counting it as such
 * would make the number worse than useless, because people would stop saying
 * they were blocked.
 */
export const STATUSES = [
  { id: 'completed', label: 'Completed', key: 'c', family: 'performance', tone: 'good' },
  { id: 'partial', label: 'Partial', key: 'p', family: 'performance', tone: 'warn' },
  { id: 'carried', label: 'Carried over', key: 'x', family: 'performance', tone: 'warn' },
  { id: 'blocked', label: 'Blocked', key: 'b', family: 'health', tone: 'bad' },
  { id: 'reassigned', label: 'Reassigned', key: 'r', family: 'health', tone: 'info' },
  { id: 'absent', label: 'Away', key: 'a', family: 'absence', tone: 'muted' },
];

export const STATUS_BY_ID = new Map(STATUSES.map((s) => [s.id, s]));

export const SHIFTS = [
  { id: 'day', label: 'Day' },
  { id: 'night', label: 'Night' },
  { id: 'possession', label: 'Possession' },
];

/* ══════════════════════════════════════════════════════════════════════════
   Names written in a spreadsheet, and the people they are
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Fold a name so spelling noise cannot decide whether it matches.
 *
 * Case and punctuation only. Nothing about the *words* is loosened: "R. Okafor"
 * and "r okafor" are the same name written twice, while "Okafor" is a different
 * string and matches only because somebody said so in the alias register.
 */
export function foldName(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A lookup from a written name to a person id.
 *
 * Three sources and no fourth: somebody's own full name, an alias somebody
 * recorded, and a **first name that belongs to exactly one person** — which is
 * what the 4WLA's Resource row is actually filled in with. There is still no
 * surname match and no near miss: a shift attributed to the wrong engineer is
 * worse than one attributed to nobody, because nobody looks at it again. An
 * unrecognised spelling is shown as unmatched instead, which is a question
 * somebody answers once.
 *
 * They are added weakest first so the stronger answer wins. A full name beats an
 * alias pointing elsewhere — a name that *is* somebody's is theirs — and both
 * beat a first name, which is the loosest of the three.
 */
export function nameRegister(people, aliases = []) {
  const map = new Map();

  /* Weakest first, so the stronger answer overwrites it. A first name is the
     loosest of the three and an alias somebody typed is worth more than it;
     somebody's own full name is worth more than either. */
  for (const [key, id] of uniqueFirstNames(people)) map.set(key, id);
  for (const a of aliases || []) {
    const key = foldName(a.alias);
    if (key) map.set(key, a.person_id);
  }
  for (const p of people || []) {
    const key = foldName(p.name);
    if (key) map.set(key, p.id);
  }
  return map;
}

/**
 * A lookup from a spelling of a place to a location id.
 *
 * The same three-source, exact-fold rule the names get, and the same fold —
 * `rc_resolve_location()` in Postgres folds case and punctuation and nothing
 * else, and this has to agree with it or a location would resolve on the server
 * and not on screen. Weakest first: a code, then an alias somebody recorded,
 * then the location's own name.
 *
 * The code is in here because it is what the 4WLA is actually filled in with.
 * That sheet's Location column says "W30", not "Wayside 30", and a register
 * that only knew names and hand-written aliases matched none of it — which is
 * the same failure a roster of full names had against a Resource row of first
 * names. It is not a guess: `rc_locations.code` is a field somebody typed for
 * this location and no other.
 */
export function locationRegister(locations, aliases = []) {
  const map = new Map();
  for (const l of locations || []) {
    const key = foldName(l.code);
    if (key) map.set(key, l.id);
  }
  for (const a of aliases || []) {
    const key = foldName(a.alias);
    if (key) map.set(key, a.location_id);
  }
  for (const l of locations || []) {
    const key = foldName(l.name);
    if (key) map.set(key, l.id);
  }
  return map;
}

/**
 * The spellings of a place the look-ahead uses that the register cannot place.
 *
 * The other half of pulling the location off the sheet. Keeping an unresolved
 * spelling is only worth doing if somebody is shown it, and this is what the
 * Resources tab lists — one click from "add it as a location" or "that is one we
 * already have", exactly as an unmatched name and an unmapped colour are. A
 * location nobody has mapped is work whose place is written down and not
 * grouped, which is the one thing that makes a report quietly wrong rather than
 * visibly incomplete.
 */
export function unmatchedLocations(laRows, register) {
  const seen = new Map();
  for (const row of laRows || []) {
    if (row.location_id) continue;
    const written = String(row.raw_location || '').trim();
    const key = foldName(written);
    if (!key || register?.get(key)) continue;
    const held = seen.get(key) || { name: written, rows: [], weeks: new Set() };
    if (!held.rows.some((r) => r.id === row.id)) held.rows.push(row);
    if (row.week_start) held.weeks.add(row.week_start);
    seen.set(key, held);
  }
  return [...seen.values()].sort((a, b) => b.rows.length - a.rows.length);
}

/**
 * First name to person, for the names that belong to exactly one of them.
 *
 * The 4WLA's Resource row is filled in by hand at speed and it says "Victor",
 * not "Victor Okonkwo" — so a register that only knew full names matched almost
 * nothing on a real sheet. A first name is a deliberate convention here rather
 * than a guess at a spelling, which is what makes this different from matching
 * on a surname or a near miss.
 *
 * **Only where it is unambiguous.** Two people called Victor and the name maps
 * to neither: picking one would put a shift against the wrong engineer, which is
 * the one outcome this module is built to avoid, and it would do it silently
 * because both answers look equally plausible on screen. The pair goes to the
 * unmatched list instead, where `ambiguousFirstNames()` lets the interface say
 * *why* it could not place the name — the answer is an alias, once, and then it
 * is settled for good.
 *
 * A roster name that is already one word registers as a full name anyway, so
 * this only ever adds keys; it never changes what a complete name means.
 */
export function uniqueFirstNames(people) {
  const seen = new Map();
  for (const person of people || []) {
    const first = foldName(String(person.name || '').trim().split(/\s+/)[0]);
    if (!first) continue;
    if (seen.has(first)) seen.get(first).push(person.id);
    else seen.set(first, [person.id]);
  }
  return [...seen.entries()]
    .filter(([, ids]) => ids.length === 1)
    .map(([key, ids]) => [key, ids[0]]);
}

/**
 * The first names more than one person answers to.
 *
 * Reported rather than resolved. "Nobody on the roster is called that" and "two
 * people are, and I will not choose between them" are different problems with
 * different fixes, and a list that ran them together would send somebody looking
 * for a missing person who is already there twice.
 */
export function ambiguousFirstNames(people) {
  const seen = new Map();
  for (const person of people || []) {
    const first = foldName(String(person.name || '').trim().split(/\s+/)[0]);
    if (!first) continue;
    seen.set(first, (seen.get(first) || 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key));
}

/**
 * The newest read of each week, whole — one row per (week, row key).
 *
 * `rc_lookahead_rows` keeps every read, so asking for a span of weeks returns
 * the same activity once per snapshot, and drawn straight out that is the same
 * person at the same place four times over. `rank` maps a snapshot id to its
 * position in `listSnapshots()` output, which is newest first, so the lowest
 * rank wins. A row whose snapshot is not in the map is treated as oldest rather
 * than dropped: it is still a read that happened.
 *
 * **The unit is the week, not the row.** Taking the newest copy of each row key
 * independently keeps a row that only an *older* snapshot carries — so an
 * activity somebody deleted from the workbook went on being somebody's plan for
 * ever, and the symptom was the one that is impossible to argue with: a person
 * booked in the week plan onto an activity that is not in the 4WLA. A snapshot
 * is a complete statement of the weeks it covers, so the newest one to mention a
 * week is that week's answer and a row missing from it was removed. Older reads
 * of the same week are still on the record; they are simply not the plan.
 * A week the newest file no longer reaches keeps the newest read that did cover
 * it, which is what makes a rolled-forward window show last month at all.
 */
export function newestPerKey(rows, rank) {
  const at = (row) => (rank.has(row.snapshot_id) ? rank.get(row.snapshot_id) : Number.MAX_SAFE_INTEGER);

  // The newest read that says anything about each week.
  const newestFor = new Map();
  for (const row of rows || []) {
    const held = newestFor.get(row.week_start);
    if (held === undefined || at(row) < held) newestFor.set(row.week_start, at(row));
  }

  const best = new Map();
  for (const row of rows || []) {
    if (at(row) !== newestFor.get(row.week_start)) continue;
    const key = `${row.week_start}|${row.row_key}`;
    if (!best.has(key)) best.set(key, row);
  }
  return [...best.values()];
}

/**
 * The newest snapshot, read as a calendar — once.
 *
 * `applyLegend()` and `readGrid()` are pure over the grid and the legend, and
 * they are not cheap: a hundred and forty rows by a hundred days, resolved
 * against the legend and then walked for the date axis, the headings, the
 * Resource rows and the absence rows. Five screens were doing that on every
 * visit, over the same snapshot and the same legend, and each one paid for it
 * in the gap between the click and the table.
 *
 * So the parse is remembered against what it was made from — the snapshot's id
 * and the legend as it stands — and handed back whole to the next caller. The
 * legend is part of the key on purpose: mapping a colour has to change what is
 * on screen at once, which is the rule the whole legend design rests on, and a
 * memo that ignored it would show the old reading until the next reload. One
 * entry, because there is one newest snapshot; a new read replaces it.
 */
let parsed = null;

export function parsedView(snapshot, legendRows) {
  const legend = (legendRows || []).map((r) => ({
    argb: r.argb, meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from,
  }));
  const key = `${snapshot.id}|${snapshot.taken_at}|${JSON.stringify(legend)}`;
  if (parsed?.key === key) return parsed.view;
  const grid = applyLegend(snapshot.grid, legend);
  // The colours the legend could not place ride along: they are a fact about
  // this grid under this legend, which is exactly what the key says.
  const view = { ...readGrid(grid, { anchorISO: snapshot.taken_at }), unknown: grid.unknown || [] };
  parsed = { key, view };
  return view;
}

/**
 * The look-ahead for a span of weeks: `{ rows, absences }`.
 *
 * Two answers rather than one, because the sheet says two things. `rows` is the
 * work — one per activity per week, with who is on it and where. `absences` is
 * the "PTO" and "Other Group / Project" rows, which are about people rather than
 * about work and are therefore never rows of scope.
 *
 * The one place the three views ask, so they cannot disagree about where
 * somebody is — the week plan, the Resources tab and the huddle all come
 * through here.
 *
 * **The names are taken from the snapshot, not from the stored column.** They
 * are stored too, in `rc_lookahead_rows.resources`, and that is what a join
 * wants — but a database built before that column existed refuses the insert
 * over it, and the only symptom was three screens quietly reporting that the
 * workbook named nobody while the calendar, which re-reads the snapshot, showed
 * the names perfectly well. So the snapshot is the authority here for the same
 * reason it is for the legend: it is re-read at paint time, so it is right the
 * moment somebody edits the sheet rather than at the next successful write.
 *
 * **And where the sheet says the work is**, for the same reason and out of the
 * same grid — see `graftLocations()`. Between them they are why a derived day
 * arrives in the week plan, the Resources tab and the huddle with both a person
 * and a place against it, and why recording an outcome on one files it at that
 * place rather than nowhere.
 *
 * Grafted onto the stored rows rather than replacing them, because those carry
 * the id a plan entry links to and the location the alias register resolved.
 * The join is `sheet_row` within a week, which is a position in one file — so it
 * is only offered the rows that came out of *this* snapshot. Across two reads a
 * row inserted mid-sheet shifts every row below it, and the graft would then
 * hand an activity another activity's names and another activity's place. It
 * fills a gap rather than overruling one, which is what the stored column is for
 * once a project has it.
 */
export async function lookaheadWithResources(fromISO, toISO) {
  /* The snapshot *list* is read without its grids — that is what `newestPerKey`
     ranks on, and it only needs the ids in order. The one grid anybody draws is
     fetched on its own. Reading twenty grids to use one was most of the wait
     between tabs. */
  const [stored, snapshots, snapshot, legendRows, locations, locAliases] = await Promise.all([
    rc.lookaheadBetween(fromISO, toISO).catch(() => []),
    rc.listSnapshotMeta({ limit: 20 }).catch(() => []),
    rc.latestSnapshot().catch(() => null),
    rc.listLegend().catch(() => []),
    rc.listLocations({ includeInactive: true }).catch(() => []),
    rc.listLocationAliases().catch(() => []),
  ]);

  const laRows = newestPerKey(stored, new Map(snapshots.map((s, i) => [s.id, i])));
  if (!snapshot?.grid) return { rows: laRows, absences: [] };

  const view = parsedView(snapshot, legendRows);
  const rows = graftLocations(
    graftResources(laRows, view, snapshot.id),
    view,
    locationRegister(locations, locAliases),
    snapshot.id
  );
  /* Narrowed to the window that was asked for, because the snapshot carries the
     whole four-to-six weeks and a caller asking about one week must not be told
     who is off in another. */
  const absences = absencesFrom(view).filter((a) => a.date >= fromISO && a.date <= toISO);
  return { rows, absences };
}

/**
 * Fill in each row's location from the grid's own Location column.
 *
 * Here for the reason the names are: a row written by a deployment that read
 * the location differently — or could not resolve it and therefore kept nothing
 * — carries no place at all, and the snapshot on screen says exactly where the
 * work is. The sheet is re-read at paint time, so this is right the moment
 * somebody corrects the workbook rather than at the next successful ingest.
 *
 * **It fills gaps and overrules nothing.** A stored `location_id` is a spelling
 * the register resolved when the row was written and is left alone; the raw text
 * is only supplied where there is none. The resolve is the same folded lookup
 * the server does, so a place resolves identically whether it arrived through
 * the ingest or through here.
 */
export function graftLocations(laRows, view, register, snapshotId) {
  const column = locationColumnOf(view);
  if (column < 0) return laRows;

  const bySheetRow = new Map();
  for (const activity of view?.activities || []) {
    const text = String(activity.meta?.[column] || '').trim();
    if (text) bySheetRow.set(activity.row, text);
  }
  if (!bySheetRow.size) return laRows;

  return (laRows || []).map((row) => {
    if (!fromSnapshot(row, snapshotId)) return row;
    const written = bySheetRow.get(row.sheet_row);
    if (!written) return row;
    const raw = row.raw_location || written;
    const id = row.location_id || register?.get(foldName(raw)) || null;
    if (raw === row.raw_location && id === (row.location_id || null)) return row;
    return { ...row, raw_location: raw, location_id: id };
  });
}

/**
 * Is this stored row one of the rows the grid in hand was read from?
 *
 * Both grafts join on `sheet_row`, which is a position in *one* file: rows 42 of
 * two different reads are two different activities the moment anybody inserts a
 * line. A week the newest snapshot no longer covers is served by an older read,
 * so its rows sit beside the newest ones in the same array — and joining the
 * newest grid onto them by position is how somebody ends up with another
 * activity's names and another activity's location. With no snapshot named the
 * guard stands down, because a caller that has not said which file the grid came
 * from is asking for the old behaviour.
 */
function fromSnapshot(row, snapshotId) {
  return !snapshotId || !row.snapshot_id || row.snapshot_id === snapshotId;
}

/** Fill in each row's `resources` from the grid, where the sheet still says so. */
export function graftResources(laRows, view, snapshotId) {
  const dayByCol = new Map((view?.days || []).map((d) => [d.col, d]));

  const bySheetRow = new Map();
  for (const activity of view?.activities || []) {
    if (!activity.resource) continue;
    const perDay = {};
    for (const mark of activity.resource.marks) {
      if (!mark.value) continue;
      const day = dayByCol.get(mark.col);
      if (day?.date) perDay[day.date] = mark.value;
    }
    if (Object.keys(perDay).length) bySheetRow.set(activity.row, perDay);
  }
  if (!bySheetRow.size) return laRows;

  const mondayOf = (iso) => toISO(weekStart(isoToMs(iso)));
  return (laRows || []).map((row) => {
    if (!fromSnapshot(row, snapshotId)) return row;
    const perDay = bySheetRow.get(row.sheet_row);
    if (!perDay) return row;
    // A row belongs to one week; a name on a day in another week belongs to that
    // week's copy of the row, not to this one.
    const mine = {};
    for (const [date, names] of Object.entries(perDay)) {
      if (mondayOf(date) === row.week_start) mine[date] = names;
    }
    return Object.keys(mine).length
      ? { ...row, resources: { ...(row.resources || {}), ...mine } }
      : row;
  });
}

/**
 * Who the look-ahead's Resource rows put where, per day.
 *
 * Returns `byPerson` — a person id to a map of date to the rows naming them —
 * and `unmatched`, the spellings the register does not know. The second half is
 * the point as much as the first: a name nobody has mapped is a person missing
 * from the picture, and reporting it is the difference between a view that is
 * incomplete and one that is quietly wrong.
 */
export function resourceAssignments(laRows, register) {
  const byPerson = new Map();
  const unmatched = new Map();

  for (const row of laRows || []) {
    for (const [date, text] of Object.entries(row.resources || {})) {
      for (const written of resourceNames(text)) {
        const key = foldName(written);
        if (!key) continue;
        const personId = register.get(key);
        if (!personId) {
          const seen = unmatched.get(key) || { name: written, days: new Set(), rows: [] };
          seen.days.add(date);
          if (!seen.rows.some((r) => r.id === row.id)) seen.rows.push(row);
          unmatched.set(key, seen);
          continue;
        }
        if (!byPerson.has(personId)) byPerson.set(personId, new Map());
        const days = byPerson.get(personId);
        if (!days.has(date)) days.set(date, []);
        if (!days.get(date).some((r) => r.id === row.id)) days.get(date).push(row);
      }
    }
  }

  return { byPerson, unmatched: [...unmatched.values()] };
}

/**
 * Who the sheet says is away, matched to the roster.
 *
 * The same shape and the same rules as `resourceAssignments()` — exact fold,
 * full name over alias over a first name exactly one person answers to, and an
 * unmatched spelling reported rather than guessed at. A name typed on the PTO
 * row is the same kind of thing as a name typed on a Resource row, so there is
 * one register and not a second one that could disagree about who "Victor" is.
 *
 * **Being off outranks everything else.** Somebody written on the PTO row and
 * on a work row for the same day is the sheet contradicting itself about one
 * person, and the stronger claim is the one saying they were not there at all:
 * on another project or at their desk they are working and can be asked how it
 * went, and on leave they cannot.
 *
 * Two *work* rows on one day are not a contradiction, though — a morning at the
 * desk and an afternoon on somebody else's project is an ordinary day — so the
 * answer is a list, the same shape the plan itself now has. It is a list per
 * day rather than a single kind for exactly that reason: collapsing them would
 * drop one of the two things the sheet plainly said.
 */
export function absenceAssignments(absences, register) {
  const byPerson = new Map();
  const unmatched = new Map();

  for (const entry of absences || []) {
    for (const written of resourceNames(entry.written)) {
      const key = foldName(written);
      if (!key) continue;
      const personId = register.get(key);
      if (!personId) {
        const seen = unmatched.get(key) || { name: written, days: new Set(), kinds: new Set() };
        seen.days.add(entry.date);
        seen.kinds.add(entry.kind);
        unmatched.set(key, seen);
        continue;
      }
      if (!byPerson.has(personId)) byPerson.set(personId, new Map());
      const days = byPerson.get(personId);
      const kinds = days.get(entry.date) || [];
      if (kinds.includes(entry.kind)) continue;
      if (entry.kind === 'pto') days.set(entry.date, ['pto']);
      else if (!kinds.includes('pto')) days.set(entry.date, [...kinds, entry.kind]);
    }
  }

  return { byPerson, unmatched: [...unmatched.values()] };
}

/**
 * What the workbook's wording says the shift is.
 *
 * The meaning is the legend's word for the colour, so "Night Shift" and
 * "Blanket" are the sheet's own vocabulary rather than ours. Anything it does
 * not recognise is a day shift, which is what an unlabelled cell has always
 * meant on this programme.
 */
export function shiftFor(meaning) {
  const said = String(meaning || '').toLowerCase();
  if (/night/.test(said)) return 'night';
  if (/possession|blanket/.test(said)) return 'possession';
  return 'day';
}

/**
 * What somebody is doing on a day: the plan where there is one, the 4WLA where
 * there is not.
 *
 * **The look-ahead used to propose and a person assigned.** That rule existed
 * for one reason — the sheet said what and where and *never who*, so a plan
 * entry had to supply the missing fact, and inventing it would have been the
 * guess this module refuses everywhere. The Resource row says who. There is no
 * missing fact left, so asking somebody to press a button is asking them to
 * re-type what the workbook already states, once per person per day.
 *
 * So the 4WLA assignment **is** the plan for that day. It is *derived*, not
 * written: `rc_plan_entries` is append-only evidence of what somebody decided,
 * and materialising the sheet into it would store a derivation — the one thing
 * this codebase is most consistent about not doing — while making the
 * workbook's authorship indistinguishable from a decision anybody took. It
 * would also go stale the moment the sheet changed, and need superseding to
 * correct, which is a revision of something nobody ever revised.
 *
 * A stored entry always wins. That is the whole meaning of one existing: it is
 * somebody overriding the sheet, or planning a day the sheet says nothing about
 * — an office day, another project, a task carried over. The sheet is the
 * default; a row is a decision.
 */
export function assignmentIndex({ planRows, laRows, register, absences = [], categories = [] }) {
  const { byPerson, unmatched } = resourceAssignments(laRows, register);
  const away = absenceAssignments(absences, register);

  /* Which seeded category an off-programme day belongs to.
     A day in the office is a day somebody worked, and a report that could not
     say *what* they worked on is the blank the `Office` and `Other project`
     categories were seeded to fill. Matched on the name the schema seeds,
     folded; a renamed category stops matching and the day arrives
     uncategorised, which is ungrouped rather than grouped wrongly. */
  const categoryFor = (kind) => {
    const want = ABSENCE_KINDS[kind]?.category;
    if (!want) return null;
    return (categories || []).find((c) => foldName(c.name) === foldName(want))?.id || null;
  };

  /* A day is a **list**. A shift is routinely more than one job — a test to
     witness in the morning and a cable pull after it — and a day that could
     only hold one task is how somebody ends up with one of the three things
     they were asked for. Every view reads it as a list; the one place a single
     entry is still wanted is an outcome, which points at one row, and `at()`
     answers that with the first. */
  const stored = new Map();
  for (const row of planRows || []) {
    const key = `${row.person_id}|${row.work_date}`;
    if (!stored.has(key)) stored.set(key, []);
    stored.get(key).push(row);
  }

  /* Who is away, before who is on what.
     A day on the PTO row and a day on an activity's Resource row are the same
     sheet contradicting itself, and the answer has to be one of them: a person
     recorded as being at a location on a day they were off is exactly the kind
     of thing that gets found a year later in a claim. The row about the *person*
     wins, because it is the more specific statement — and a stored entry still
     beats both, since that is somebody deciding against the sheet. */
  const derived = new Map();
  for (const [personId, days] of away.byPerson) {
    for (const [iso, kinds] of days) {
      const key = `${personId}|${iso}`;
      if (stored.has(key)) continue;
      // One entry per kind: a day at the desk and a day on another group's
      // project are two things the sheet said, not one to choose between.
      derived.set(key, kinds.map((kind) => ({
        id: null,
        from_lookahead: true,
        absence: kind,
        person_id: personId,
        work_date: iso,
        task: ABSENCE_LABELS[kind],
        location_id: null,
        raw_location: null,
        category_id: categoryFor(kind),
        shift: 'day',
        lookahead_row_id: null,
        carry_chain_id: null,
      })));
    }
  }

  for (const [personId, days] of byPerson) {
    for (const [iso, rows] of days) {
      const key = `${personId}|${iso}`;
      if (stored.has(key) || derived.has(key)) continue;
      /* **Every** row the sheet names them on, not the first with a count
         beside it. The workbook putting somebody on two activities in one day
         is the same fact as a scheduler planning two tasks, and reading only
         the first lost the rest with nothing on screen to say so. */
      derived.set(key, rows.map((row) => ({
        // Null, and load-bearing: every caller that writes an outcome or rolls a
        // task forward reads this to decide whether there is a row to point at.
        id: null,
        from_lookahead: true,
        absence: null,
        person_id: personId,
        work_date: iso,
        task: row.raw_label || null,
        location_id: row.location_id || null,
        raw_location: row.raw_location || null,
        category_id: null,
        shift: shiftFor(row.cells?.[iso]),
        lookahead_row_id: row.id || null,
        carry_chain_id: null,
      })));
    }
  }

  const on = (personId, iso) =>
    stored.get(`${personId}|${iso}`) || derived.get(`${personId}|${iso}`) || [];

  return {
    /* Everything planned for that day, in order. The shape every view reads. */
    on,
    /* The first of them, for the one caller that needs a single row: an outcome
       points at one plan entry, and rolling a task forward carries one chain.
       Null when the day is empty, which is what those callers test. */
    at: (personId, iso) => on(personId, iso)[0] || null,
    /* What the *sheet* says about somebody being away, whatever anybody has
       stored over the top of it. `availability()` takes this, so a person the
       workbook puts on PTO is not asked in the huddle how their day went. */
    absent: (personId, iso) => {
      const kinds = away.byPerson.get(personId)?.get(iso) || [];
      // Leave first: it is the only one `availability()` acts on, and a day
      // carrying it carries nothing else.
      return kinds.includes('pto') ? 'pto' : (kinds[0] || null);
    },
    byPerson,
    unmatched,
    awayUnmatched: away.unmatched,
    derived: derived.size,
  };
}

/**
 * Whether somebody is available on a date.
 *
 * Leave is the reason this exists. Absence is a different fact from "carried
 * over" or "reassigned", and without somewhere for it to go it gets silently
 * distributed across the performance statuses — which is precisely what the
 * five-status split is designed to prevent.
 */
export function availability(person, iso, leaveRows, absent = null) {
  const ms = isoToMs(iso);
  const weekday = new Date(ms).getUTCDay() || 7; // ISO: Monday 1 … Sunday 7
  const working = Array.isArray(person?.working_days) ? person.working_days : [1, 2, 3, 4, 5];

  const leave = (leaveRows || []).find(
    (l) => l.person_id === person.id && l.start_date <= iso && l.end_date >= iso
      && l.status !== 'cancelled' && l.status !== 'declined'
  );
  if (leave) return { state: 'leave', leave };
  /* The 4WLA's PTO row, where nobody booked the leave. Most days it is the only
     place the absence is written down at all — somebody types a name into the
     workbook and never opens Organisation — and without reading it the huddle
     asks a person on holiday how their day went, and the week plan shows them as
     a day nobody bothered to fill in. The office and another group's project are
     *not* leave: those are days somebody worked, they can be asked how it went,
     and where they were is the assignment. `ABSENCE_KINDS[kind].leave` is the
     one place that distinction lives. */
  if (absent && ABSENCE_KINDS[absent]?.leave) return { state: 'leave', sheet: absent };
  if (!working.includes(weekday)) return { state: 'non-working' };
  return { state: 'available' };
}
