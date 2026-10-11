/**
 * The register: the rows a reading of the look-ahead is stored as, and the
 * changes between two readings.
 *
 * The look-ahead is the contractual source of truth and the resource calendar
 * is the execution record; the difference between two snapshots is what a
 * delay claim is eventually built from. So the rules here are about being
 * *honest* rather than clever — the system logs what it can see and asks a
 * person about what it cannot.
 *
 * Two rules do most of the work, and both exist because the obvious version
 * produces numbers that flatter or damn the wrong party.
 *
 * **Only weeks in both snapshots are compared.** A four-week window rolls
 * forward, so a week appearing at the far edge is not scope being added and a
 * week dropping off the back is not scope being removed. Counting them as such
 * would book a batch of phantom additions every single week, and would count
 * finished work as deleted scope — inflating exactly the number you would most
 * want to defend.
 *
 * **A crew moving site is not inferred.** When work finishes early and a team
 * moves, one row disappears and another appears with the same resources. The
 * activity text is not reliable enough to match on — the spec says so and it is
 * right — so it is logged honestly as a removal and an addition, and a person
 * can relink the pair afterwards. Guessing would be the one failure mode
 * nobody could audit.
 *
 * Reading a sheet — its grid, its marks, who it names, what it offers the
 * timeline — is `core/lookahead.js`, which all three bundles carry. This is the
 * part only the calendar does, so it lives in calendar.bundle.js and the
 * timeline's and the phone's pages never download it.
 *
 * Imports: core/lookahead.
 */
import { resourceNames, locationColumnOf, isCancelMeaning } from './lookahead.js';

/** The Monday of an ISO date's week, in UTC. A calendar date must not shift. */
function mondayOf(iso) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  const back = (new Date(ms).getUTCDay() + 6) % 7;
  return new Date(ms - back * 86400000).toISOString().slice(0, 10);
}

/**
 * Stored days whose look-ahead row now names somebody else.
 *
 * The 4WLA's Resource row is the plan for the days it names, so a stored
 * `rc_plan_entries` row carrying a `lookahead_row_id` is somebody having
 * confirmed or overridden what that row said. When a later read of the sheet
 * puts a different name on the same row for the same day, the work has moved —
 * and until this existed the entry stayed against whoever it was first written
 * for. The visible cost is somebody turning up for a shift that is not theirs
 * any more while the person who now has it has a blank against their name.
 *
 * `resolve` is the name lookup, **injected** for the reason `rowsFrom()` takes
 * `locate`: the register lives two layers up, this module is a leaf, and the
 * whole pipeline has to be testable with no browser and no network. It answers
 * a person id for a written name, or null.
 *
 * Returns `[{ entry, from, to }]`, and returns nothing at all unless it is
 * certain:
 *
 * **The row has to say something about that day.** A day the sheet no longer
 * names anybody on is not a reassignment — it is the sheet going quiet, which
 * happens whenever an activity is rescheduled, and moving a task to nobody is
 * not a thing that can be written.
 *
 * **It has to name exactly one person the roster knows.** Two names on a day is
 * a crew, and a crew is not "this task moved to Victor" — it is several entries,
 * which is a decision somebody takes rather than one this can derive. An
 * unmatched spelling stops it too: those are reported and answered with an
 * alias, and guessing here would be the near-miss matching the register refuses.
 *
 * **It has to be somebody else.** A re-read that changed nothing must produce
 * nothing, or every ingest would supersede every linked entry with a revision
 * saying the same thing. `rc_reassign_plan()` refuses that case as well, so it
 * is checked on both sides on purpose.
 */
export function reassignments({ planRows, laRows, resolve }) {
  const byRow = new Map();
  for (const row of laRows || []) {
    if (row?.id) byRow.set(row.id, row);
  }

  const out = [];
  for (const entry of planRows || []) {
    if (!entry?.id || !entry.lookahead_row_id) continue;
    const row = byRow.get(entry.lookahead_row_id);
    if (!row) continue;
    const written = resourceNames(row.resources?.[entry.work_date] || '');
    if (!written.length) continue;

    const ids = new Set();
    let unknown = false;
    for (const name of written) {
      const id = resolve ? resolve(name) : null;
      if (id) ids.add(id);
      else unknown = true;
    }
    // One person, and every name on the day accounted for. Anything else is a
    // crew or a spelling nobody has mapped, and neither is a move.
    if (unknown || ids.size !== 1) continue;
    const [to] = [...ids];
    if (to === entry.person_id) continue;
    out.push({ entry, from: entry.person_id, to });
  }
  return out;
}

/* ── Row identity ──────────────────────────────────────────────────────── */

/**
 * A key for a row that survives the file being edited.
 *
 * The look-ahead has no activity IDs — no P6 numbers, nothing stable — and its
 * descriptions are not matchable. Location, week and subsystem are what remain,
 * plus an ordinal to separate two rows that share all three.
 *
 * The ordinal is the weak part, and knowingly so: inserting a row in the middle
 * of a group shifts everything below it and produces a false removed/added
 * pair. That is tolerable only because the manual relink exists to fix it, and
 * because the alternative — matching on text — would produce *wrong* answers
 * rather than noisy ones.
 */
export function rowKey({ weekStart, location, subsystem = '', ordinal = 0 }) {
  return [weekStart, String(location || '').trim(), String(subsystem || '').trim(), ordinal].join('|');
}

/** Assign ordinals within each (week, location, subsystem) group. */
export function keyRows(rows) {
  const seen = new Map();
  return rows.map((row) => {
    const group = [row.weekStart, row.location, row.subsystem || ''].join('|');
    const ordinal = seen.get(group) || 0;
    seen.set(group, ordinal + 1);
    return { ...row, rowKey: rowKey({ ...row, ordinal }) };
  });
}

/**
 * A read grid, as rows something else can point at.
 *
 * One row per activity per *week*, because that is the grain the look-ahead is
 * maintained at and the grain a plan is made at. Two rules, both of which hold
 * everywhere else in this module:
 *
 * **The location is read from the column the sheet keeps it in, and kept
 * whether or not it resolves.** `locationColumnOf()` finds that column by its
 * heading; `locate` — the alias register, injected so this stays testable
 * without a network — turns the spelling into an id where it knows it. Nothing
 * is matched on the description: the wording differs on the two sides and is
 * not reliable enough to carry evidence, which is what the alias list is for.
 *
 * The text surviving an unresolved spelling is the part that was missing. The
 * location used to be recorded *only* where the register already knew it, so a
 * column full of "W30" and "Y10" was discarded on every deployment that had not
 * registered them — and with nothing kept there was nothing for anybody to map,
 * which is the one state this module is built to make impossible. An unresolved
 * spelling is exactly like an unmapped colour or an unmatched name: shown, and
 * one click from being answered.
 *
 * **A row with nothing scheduled that week is not a row.** The sheet carries
 * activities for reference with no shift against them, and writing those would
 * make the register mostly noise — and, worse, make every one of them look
 * like scope the first time it *did* get a shift.
 *
 * @param {object} view
 * @param {{ snapshotId?: string | null, locate?: (raw: string) => Promise<string | null>, locationColumn?: number | null }} [options]
 */
export async function rowsFrom(view, {
  snapshotId = null, locate = async () => null, locationColumn = null,
} = {}) {
  if (!view?.days?.length) return [];

  // Told which column, or read off the sheet's own heading. `null` is "work it
  // out"; `-1` is "there is no heading", which is the register scan below.
  const locCol = Number.isInteger(locationColumn) ? locationColumn : locationColumnOf(view);

  const dayByCol = new Map(view.days.map((d) => [d.col, d]));
  const out = [];
  const ordinals = new Map();

  for (const activity of view.activities) {
    if (activity.heading) continue;
    /* Not work, so not a row. Emitting one would put "PTO" in the register as an
       activity at no location, and `classify()` would then book it as scope
       added the first week it appeared and scope removed the week it did not. */
    if (activity.absence) continue;

    // Group this activity's marks by the week they fall in.
    const weeks = new Map();
    const bucketFor = (date) => {
      const week = mondayOf(date);
      if (!weeks.has(week)) weeks.set(week, { cells: {}, marks: {}, resources: {} });
      return weeks.get(week);
    };
    for (const mark of activity.marks) {
      if (!mark.hex || mark.role === 'ignore') continue;
      const day = dayByCol.get(mark.col);
      if (!day?.date) continue;
      const bucket = bucketFor(day.date);
      bucket.cells[day.date] = mark.meaning || `#${mark.hex}`;
      if (mark.value) bucket.marks[day.date] = mark.value;
    }
    /* The Resource row's own paint, which the workbook sometimes uses for the
       shift instead of the activity line. It fills a day the activity line left
       unpainted and never overrides one — the activity line is what the day *is*.
       And it never says a day was cancelled: red on a Resource row is somebody
       marking the names, not the work, so a cancellation colour there — or a
       colour nobody has named, which might turn out to be one — is left out of
       `cells` entirely, and with it out of `rc_cancelled_days`. */
    for (const mark of activity.resource?.marks || []) {
      if (!mark.hex || mark.role === 'ignore' || !mark.meaning || isCancelMeaning(mark.meaning)) continue;
      const day = dayByCol.get(mark.col);
      if (!day?.date) continue;
      const bucket = bucketFor(day.date);
      if (!(day.date in bucket.cells)) bucket.cells[day.date] = mark.meaning;
    }
    if (!weeks.size) continue;

    /* Who the Resource row names, per day, in the words the workbook used.
       Only into weeks that already have a shift in them: a name typed against a
       day nobody is scheduled on is the same kind of stray as a colour on an
       empty row, and writing it would invent a week of scope. Nothing is
       matched to a person here — that happens against the roster, where an
       unmatched name can be shown to somebody rather than guessed at. */
    for (const mark of activity.resource?.marks || []) {
      if (!mark.value) continue;
      const day = dayByCol.get(mark.col);
      const week = day?.date ? mondayOf(day.date) : null;
      if (!week || !weeks.has(week)) continue;
      weeks.get(week).resources[day.date] = mark.value;
    }

    /* Where the work is, from the column the sheet keeps it in.
       **The text is kept whether or not it resolves.** It used to be recorded
       only when the alias register already knew it, so a location column full of
       "W30" and "Y10" was *discarded* on a deployment that had not registered
       them yet — and with nothing kept there was nothing for anybody to map,
       which is the one state this design is supposed to make impossible. An
       unresolved spelling is exactly like an unmapped colour or an unmatched
       name: shown, and one click from being answered. */
    let locationId = null;
    let rawLocation = null;
    if (locCol >= 0) {
      rawLocation = activity.meta[locCol] || null;
      locationId = rawLocation ? await locate(rawLocation) : null;
    } else {
      // Nobody has said which column it is, so the register decides: the first
      // cell it recognises is the location. Still never the *description* —
      // that is matched on nothing, here or anywhere else in this module.
      for (const value of activity.meta) {
        const hit = await locate(value);
        if (hit) { locationId = hit; rawLocation = value; break; }
      }
    }
    const label = activity.meta.filter(Boolean).join(' · ');

    for (const [week, bucket] of weeks) {
      const groupKey = [week, rawLocation || '', ''].join('|');
      const ordinal = ordinals.get(groupKey) || 0;
      ordinals.set(groupKey, ordinal + 1);
      out.push({
        snapshot_id: snapshotId,
        week_start: week,
        sheet_row: activity.row,
        row_key: rowKey({ weekStart: week, location: rawLocation || '', subsystem: '', ordinal }),
        /* The editor's id for the activity, when the reading was published from
           the editor; null for a workbook read. `row_key` is still written —
           links made before ids existed point at it — but two readings that
           both carry ids are compared on the id, so a row inserted mid-group
           no longer shifts the ones under it into a removal and an addition. */
        la_row_id: activity.id || null,
        location_id: locationId,
        raw_location: rawLocation,
        raw_label: label,
        cells: bucket.cells,
        bart_marks: bucket.marks,
        resources: bucket.resources,
      });
    }
  }

  return out;
}

/* ── The window ────────────────────────────────────────────────────────── */

/**
 * The weeks a snapshot actually covers, read from the snapshot itself.
 *
 * Deliberately not a constant. The spec calls it a four-week look-ahead and
 * says it is maintained four to six weeks out, so a hard-coded 4 would
 * misclassify the sixth week every time it appeared.
 */
export function windowOf(rows) {
  const weeks = [...new Set(rows.map((r) => r.weekStart))].sort();
  return { weeks, first: weeks[0] || null, last: weeks[weeks.length - 1] || null };
}

/* ── Comparing ─────────────────────────────────────────────────────────── */

/**
 * Classify the difference between two keyed snapshots.
 *
 * `before` and `after` are arrays of `{ rowKey, weekStart, location, subsystem,
 * label, cells, marks }`, where `cells` maps a date to a shift meaning and
 * `marks` holds BART's own resource requests.
 *
 * Returns a list of `{ kind, weekStart, rowKey, before, after }`.
 *
 * **A read that started recording the location is not a read where everything
 * moved.** The row key is built from the week and the location, so the first read
 * after the location began coming off the sheet's own column — rather than only
 * where the alias register already knew the spelling — keys every row
 * differently. Compared naively that is every row removed and every row added:
 * a batch of phantom scope on the one screen somebody reads a year later, booked
 * into the KPIs, over a change that is about the *keying* and not the work. It is
 * the same judgement the window rule makes, and drawn as narrowly as it can be —
 * one side recording no location at all, the other recording one, and not a
 * single key in common. A crew genuinely moving site is still a removal and an
 * addition, which is what `relinkCandidates()` is for.
 */
export function classify(before, after, { cancelledMeaning = 'cancelled' } = {}) {
  const beforeWindow = windowOf(before);
  const afterWindow = windowOf(after);

  /* **Two readings that both carry the editor's ids are compared on them.**
     A row is then the same row wherever it sits and whatever it says, so
     inserting one mid-group no longer turns every row under it into a removal
     and an addition, and an activity moved to another site is one event rather
     than two. Only when *every* row on both sides has an id: the first reading
     published after ids began is compared with one that had none, and mixing
     the two keyings would book every row as moved. That one comparison goes by
     position, as every comparison did before. */
  const byId = before.length > 0 && after.length > 0
    && before.every((r) => r.rowId) && after.every((r) => r.rowId);
  const keyOf = byId ? (r) => `${r.weekStart}|id:${r.rowId}` : (r) => r.rowKey;

  if (!byId && before.length && after.length) {
    const keys = new Set(after.map((r) => r.rowKey));
    const located = (rows) => rows.filter((r) => String(r.location || '').trim()).length;
    const sided = located(before) === 0 !== (located(after) === 0);
    if (sided && !before.some((r) => keys.has(r.rowKey))) return [];
  }

  // Only weeks present on both sides can be compared at all. Everything else
  // is the window moving, which is recorded and kept out of the KPIs.
  const shared = new Set(beforeWindow.weeks.filter((w) => afterWindow.weeks.includes(w)));

  const events = [];
  const beforeByKey = new Map(before.map((r) => [keyOf(r), r]));
  const afterByKey = new Map(after.map((r) => [keyOf(r), r]));
  const idOf = (r) => r.rowId || null;

  /* Weeks entering and leaving the window. Not scope, and named so. */
  for (const week of afterWindow.weeks) {
    if (!beforeWindow.weeks.includes(week)) {
      events.push({ kind: 'window_advanced', weekStart: week, rowKey: null, before: null, after: null });
    }
  }
  for (const week of beforeWindow.weeks) {
    if (!afterWindow.weeks.includes(week)) {
      events.push({ kind: 'window_retired', weekStart: week, rowKey: null, before: null, after: null });
    }
  }

  /* Rows added to, and removed from, a week that was already in view. */
  for (const row of after) {
    if (!shared.has(row.weekStart)) continue;
    if (!beforeByKey.has(keyOf(row))) {
      events.push({ kind: 'scope_added', weekStart: row.weekStart, rowKey: row.rowKey, rowId: idOf(row), before: null, after: row });
    }
  }
  for (const row of before) {
    if (!shared.has(row.weekStart)) continue;
    if (!afterByKey.has(keyOf(row))) {
      events.push({ kind: 'scope_removed', weekStart: row.weekStart, rowKey: row.rowKey, rowId: idOf(row), before: row, after: null });
    }
  }

  /* What an activity says about itself, once per activity rather than once per
     week it spans. Only visible when rows are matched on their ids: matched by
     position, a row whose location changed was a different row, and a changed
     description was never compared at all. */
  const described = new Set();

  /* Rows present on both sides: what changed inside them. */
  for (const row of after) {
    const prior = beforeByKey.get(keyOf(row));
    if (!prior || !shared.has(row.weekStart)) continue;
    const rowId = idOf(row);

    if (byId && !described.has(rowId)) {
      described.add(rowId);
      const where = (r) => String(r.location || '').trim();
      if (where(prior) !== where(row)) {
        events.push({ kind: 'location_shift', weekStart: row.weekStart, rowKey: row.rowKey, rowId, before: prior, after: row });
      } else if (String(prior.label || '') !== String(row.label || '')) {
        events.push({ kind: 'details_changed', weekStart: row.weekStart, rowKey: row.rowKey, rowId, before: prior, after: row });
      }
    }

    const dates = [...new Set([...Object.keys(prior.cells || {}), ...Object.keys(row.cells || {})])].sort();
    for (const date of dates) {
      const was = (prior.cells || {})[date] || null;
      const now = (row.cells || {})[date] || null;
      if (was === now) continue;

      // A shift turning red is a cancellation, and the colour alone cannot say
      // whose. Whoever reviews it is asked; nothing is assumed.
      const kind = now === cancelledMeaning && was && was !== cancelledMeaning
        ? 'cancellation'
        : 'shift_changed';

      events.push({
        kind,
        weekStart: row.weekStart,
        rowKey: row.rowKey,
        rowId,
        date,
        before: was,
        after: now,
        needsResponsibility: kind === 'cancellation',
      });
    }

    // BART's own resource marks — an EIC added to an otherwise unchanged
    // shift. The shift did not move, and the request still changed, so it is
    // logged rather than folded into the row above.
    const marksBefore = JSON.stringify(prior.marks || {});
    const marksAfter = JSON.stringify(row.marks || {});
    if (marksBefore !== marksAfter) {
      events.push({
        kind: 'resource_changed',
        field: 'marks',
        weekStart: row.weekStart,
        rowKey: row.rowKey,
        rowId,
        before: prior.marks || {},
        after: row.marks || {},
      });
    }

    /* And the Resource row underneath: who is on it.
       The same kind as a mark changing rather than a kind of its own, because
       it is the same fact — the request against this activity moved without the
       shift moving — and a new kind would need the `rc_change_events` check
       constraint widened in every project that already has one. `field` is what
       tells the two apart when somebody reads the row back. */
    const whoBefore = JSON.stringify(prior.resources || {});
    const whoAfter = JSON.stringify(row.resources || {});
    if (whoBefore !== whoAfter) {
      events.push({
        kind: 'resource_changed',
        field: 'resources',
        weekStart: row.weekStart,
        rowKey: row.rowKey,
        rowId,
        before: prior.resources || {},
        after: row.resources || {},
      });
    }
  }

  return events;
}

/**
 * Removals and additions in the same week that could be one crew moving site.
 *
 * Only ever a *suggestion*, surfaced for somebody to confirm. Work finishing
 * early at one location and starting at another is not a cancellation, but the
 * only evidence is that the same BART resources appear on both — and the
 * activity text, which cannot be trusted. So the pairing is a human judgement
 * by design, and the system's job is to make it easy rather than to guess.
 */
export function relinkCandidates(events) {
  const removed = events.filter((e) => e.kind === 'scope_removed');
  const added = events.filter((e) => e.kind === 'scope_added');
  const out = [];

  for (const gone of removed) {
    for (const arrived of added) {
      if (gone.weekStart !== arrived.weekStart) continue;
      const a = JSON.stringify(gone.before?.marks || {});
      const b = JSON.stringify(arrived.after?.marks || {});
      if (a !== '{}' && a === b) {
        out.push({ removed: gone, added: arrived, because: 'the same resources were requested' });
      }
    }
  }
  return out;
}

/**
 * Which events count toward the change KPIs.
 *
 * The window moving is real and recorded, and it is not a change of scope.
 * Keeping the two apart is what stops the scope-added figure being meaningless
 * within a month.
 */
export const KPI_KINDS = ['scope_added', 'scope_removed', 'cancellation', 'resource_changed', 'shift_changed'];

export function countable(events) {
  return events.filter((e) => KPI_KINDS.includes(e.kind));
}

/** A short, plain description of an event, for the change log. */
/**
 * One line saying what an event was.
 *
 * Reads the *stored* shape: `before` and `after` are jsonb, because the table
 * has no column for a date and a row-level change needs one. `sideOf()` in
 * `ui/rc_lookahead.js` is what writes them, and the two have to agree — a
 * mismatch here shows up as "undefined → undefined" on the one screen somebody
 * reads a year later.
 */
export function describe(event) {
  const day = event.date || event.after?.date || event.before?.date || 'a day';
  switch (event.kind) {
    case 'scope_added': return `Added: ${event.after?.label || event.rowKey}`;
    case 'scope_removed': return `Removed: ${event.before?.label || event.rowKey}`;
    case 'cancellation': return `Cancelled on ${day}: was ${event.before?.value ?? event.before}`;
    case 'shift_changed':
      return `${day}: ${event.before?.value || 'nothing'} → ${event.after?.value || 'nothing'}`;
    case 'resource_changed': {
      /* The *stored* shape decides which of the two this was: `sideOf()` writes
         `{ resources }` for the Resource row and `{ marks }` for a mark on the
         activity line. A row written before Resource rows existed carries only
         the latter, and it still prints the sentence it always did rather than
         "undefined → undefined" on the one screen somebody reads a year later. */
      const who = (side) => {
        const map = side?.resources;
        if (!map || typeof map !== 'object') return null;
        return [...new Set(Object.values(map).flatMap((v) => resourceNames(v)))].join(', ');
      };
      const was = who(event.before);
      const now = who(event.after);
      if (was === null && now === null) return 'BART resource request changed';
      return `Resource: ${was || 'nobody'} → ${now || 'nobody'}`;
    }
    case 'window_advanced': return `Week ${event.weekStart} came into the window`;
    case 'window_retired': return `Week ${event.weekStart} left the window`;
    case 'location_shift':
      // Matched on the editor's id, the row itself says where it went. Linked
      // by hand from a removal and an addition, it does not.
      if (event.before?.location !== undefined || event.after?.location !== undefined) {
        return `${event.after?.label || event.before?.label || 'Activity'}: moved from `
          + `${event.before?.location || 'no location'} to ${event.after?.location || 'no location'}`;
      }
      return 'Relinked as one crew moving site';
    case 'details_changed':
      return `Details: ${event.before?.label || 'nothing'} → ${event.after?.label || 'nothing'}`;
    default: return event.kind;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   What changed for me

   Somebody on the team opens the calendar and wants to know one thing before
   anything else: has my week moved since I last looked? This compares two
   readings of the look-ahead — the one they last said "got it" to, and the
   latest — for the days that name them, and says what happened in the words a
   person would use: a day added, a day taken away, a day moved, a day given
   to somebody else, a day cancelled, a shift changed.

   Both sides come from the stored rows (`rc_lookahead_rows`), which are never
   compacted, so an old reading can always be compared. A reading is a complete
   statement of the weeks it covers, so each side is one reading, whole.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The days a set of stored rows names somebody on, between `from` and `to`
 * (ISO, inclusive): a map of `date|label` → `{ date, label, location, meaning,
 * cancelled }`.
 */
export function myLookaheadDays(rows, isMe, { from = null, to = null } = {}) {
  const out = new Map();
  for (const row of rows || []) {
    for (const [date, text] of Object.entries(row.resources || {})) {
      const day = String(date).slice(0, 10);
      if ((from && day < from) || (to && day > to)) continue;
      if (!resourceNames(text).some((n) => isMe(n))) continue;
      const meaning = row.cells?.[day] || row.cells?.[date] || '';
      out.set(`${day}|${row.raw_label || ''}`, {
        date: day,
        label: row.raw_label || '',
        location: row.raw_location || '',
        meaning,
        cancelled: isCancelMeaning(meaning),
      });
    }
  }
  return out;
}

/** How far apart a removed and an added day of one activity may be and still be one day moved. */
const MOVED_WITHIN_DAYS = 14;

/**
 * What changed between two readings for the days that name this person:
 * `[{ kind, date, label, location, from?, was?, now?, names? }]`, by date.
 *
 *   added      named on a day they were not before
 *   removed    no longer named on a day they were, and nobody else took it
 *   given      no longer named, and the row names somebody else that day
 *   moved      removed from one day and added to another of the same activity
 *   cancelled  still named, and the day is now painted as a cancellation
 *   reinstated a day that was cancelled is back on
 *   shift      still named, and the day is painted as a different shift
 */
export function changesForMe(beforeRows, afterRows, isMe, { from = null, to = null } = {}) {
  const before = myLookaheadDays(beforeRows, isMe, { from, to });
  const after = myLookaheadDays(afterRows, isMe, { from, to });
  const afterRow = new Map();
  for (const row of afterRows || []) {
    for (const date of new Set([...Object.keys(row.resources || {}), ...Object.keys(row.cells || {})])) {
      afterRow.set(`${String(date).slice(0, 10)}|${row.raw_label || ''}`, row);
    }
  }

  const added = [...after.entries()].filter(([k]) => !before.has(k)).map(([, v]) => v);
  const removed = [...before.entries()].filter(([k]) => !after.has(k)).map(([, v]) => v);
  const out = [];

  /* A day taken off and another of the same activity put on, close together,
     is one day moved — nearest first, each day used once. */
  const usedAdded = new Set();
  const stillRemoved = [];
  for (const r of removed.sort((a, b) => a.date.localeCompare(b.date))) {
    /** @type {number | null} */
    let best = null;
    let bestGap = Infinity;
    added.forEach((a, i) => {
      if (usedAdded.has(i) || a.label !== r.label) return;
      const gap = Math.abs(Date.parse(`${a.date}T00:00:00Z`) - Date.parse(`${r.date}T00:00:00Z`)) / 86400000;
      if (gap <= MOVED_WITHIN_DAYS && gap < bestGap) { best = i; bestGap = gap; }
    });
    if (best == null) { stillRemoved.push(r); continue; }
    usedAdded.add(best);
    const a = added[best];
    out.push({ kind: 'moved', date: a.date, from: r.date, label: a.label, location: a.location, now: a.meaning, was: r.meaning });
  }

  added.forEach((a, i) => {
    if (!usedAdded.has(i)) out.push({ kind: 'added', date: a.date, label: a.label, location: a.location, now: a.meaning });
  });
  for (const r of stillRemoved) {
    const row = afterRow.get(`${r.date}|${r.label}`);
    const names = resourceNames(row?.resources?.[r.date] || '').filter((n) => !isMe(n));
    if (names.length) out.push({ kind: 'given', date: r.date, label: r.label, location: r.location, names });
    else out.push({ kind: 'removed', date: r.date, label: r.label, location: r.location, was: r.meaning });
  }
  for (const [k, now] of after) {
    const was = before.get(k);
    if (!was) continue;
    if (now.cancelled && !was.cancelled) {
      out.push({ kind: 'cancelled', date: now.date, label: now.label, location: now.location, was: was.meaning });
    } else if (was.cancelled && !now.cancelled) {
      out.push({ kind: 'reinstated', date: now.date, label: now.label, location: now.location, now: now.meaning });
    } else if (!now.cancelled && now.meaning !== was.meaning && now.meaning && was.meaning) {
      out.push({ kind: 'shift', date: now.date, label: now.label, location: now.location, was: was.meaning, now: now.meaning });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}
