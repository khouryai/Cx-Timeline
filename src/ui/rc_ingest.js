/**
 * Reading the look-ahead workbook into the calendar: snapshot, rows, changes.
 *
 * Split out of `ui/rc_lookahead.js` so every section that needs "Check now" can
 * have it without importing the tab that draws them.
 *
 * Imports: util, rc, filestore, io/lookahead, core/lookahead, icons,
 *          components, rc_util.
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

/** Where the workbook lives, relative to the folder the plan is in. */
const LOOKAHEAD_DIR = 'lookahead';

/* ══════════════════════════════════════════════════════════════════════════
   Ingest
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Read the workbook, snapshot it if it has moved, and classify the difference.
 *
 * Deduped by content hash rather than by modified time, because OneDrive
 * re-stamps a file when it syncs whether or not anybody edited it — so
 * timestamps alone would manufacture a snapshot, and therefore a change event,
 * out of a sync.
 */
export async function ingest({ sheetName, legend, silent = false } = {}) {
  /* Neither of these is a constant any more. The tab gets renamed by whoever
     maintains the workbook, and the legend is BART's to change — a redeploy is
     the wrong answer to either. Both are read from the database, and the
     arguments survive only so a test can pin them. */
  if (sheetName === undefined) {
    const settings = await rc.listSettings().catch(() => []);
    sheetName = settings.find((r) => r.key === 'lookahead_sheet')?.value || '4WLA';
  }
  if (legend === undefined) {
    legend = (await rc.listLegend().catch(() => []))
      .map((r) => ({ argb: r.argb, meaning: r.meaning, role: r.role || 'shift' }));
  }

  const run = { ran_at: new Date().toISOString(), outcome: 'error', note: null, file_hash: null, file_mtime: null };

  let file = null;
  try {
    /* No folder at all is a different problem from an empty one, and until
       they were told apart both said "no workbook in lookahead/" — which sent
       somebody looking in the folder for a file that was already there, on a
       machine that had never been given the folder. */
    if (!filestore.hasFolder()) {
      run.outcome = 'missing';
      run.note = 'No folder is connected on this device.';
      await rc.addIngestRun(run).catch(() => {});
      throw new Error(
        'No folder is connected on this device, so there is nowhere to read the look-ahead '
        + 'from. Open the plan folder first. A browser has to be given the folder by hand '
        + 'and cannot watch it in the background, which is why ingestion belongs in the '
        + 'desktop application.'
      );
    }

    const files = await filestore.intakeList(LOOKAHEAD_DIR);
    const workbooks = files.filter((f) => /\.xlsx$/i.test(f.name));

    // Two versions of the look-ahead means somebody's edits are about to be
    // lost. Ingesting one of them silently would be the worst possible answer.
    const conflicted = workbooks.filter((f) => f.conflict);
    if (conflicted.length) {
      run.outcome = 'conflict';
      run.note = `OneDrive kept a second copy: ${conflicted[0].name}`;
      await rc.addIngestRun(run).catch(() => {});
      throw new Error(
        `${conflicted[0].name} is a OneDrive conflict copy — two people edited the look-ahead `
        + 'and one set of changes is about to be lost. Sort that out in the folder first.'
      );
    }

    const legacy = files.filter((f) => /\.xls$|\.xlsb$/i.test(f.name));
    if (!workbooks.length && legacy.length) {
      throw new Error(`${legacy[0].name} is not a .xlsx — open it in Excel and Save As → Excel Workbook.`);
    }
    file = workbooks[0];
    if (!file) {
      /* By far the most common way to get here is dropping the workbook beside
         the plan rather than into the subfolder, so look there before saying
         there is nothing: naming the file somebody can see is the difference
         between an answer and a denial. */
      const stray = (await filestore.intakeList('').catch(() => []))
        .filter((f) => /\.xlsx$/i.test(f.name));

      run.outcome = 'missing';
      run.note = stray.length
        ? `Nothing in ${LOOKAHEAD_DIR}/, but ${stray.length} workbook(s) beside the plan`
        : `Nothing in ${LOOKAHEAD_DIR}/`;
      await rc.addIngestRun(run).catch(() => {});

      throw new Error(
        stray.length
          ? `No workbook in ${LOOKAHEAD_DIR}/, but ${stray.map((f) => f.name).join(', ')} `
            + `${stray.length === 1 ? 'is' : 'are'} sitting beside the plan. Move it into a `
            + `subfolder called "${LOOKAHEAD_DIR}" — the look-ahead is only ever read from there, `
            + 'so that nothing else in your folder can be snapshotted by accident.'
          : `No workbook in ${LOOKAHEAD_DIR}/ — create that subfolder beside the plan and put `
            + 'the .xlsx in it. Absence is recorded, not treated as "no change".'
      );
    }

    const rel = `${LOOKAHEAD_DIR}/${file.name}`;
    const hash = await filestore.intakeHash(rel);
    run.file_hash = hash;
    run.file_mtime = new Date(file.modified).toISOString();

    const previous = await rc.latestSnapshot();
    if (previous && previous.file_hash === hash) {
      run.outcome = 'unchanged';
      await rc.addIngestRun(run);
      if (!silent) toast({ message: 'The look-ahead has not changed since the last snapshot.' });
      return { changed: false, events: [] };
    }

    const buffer = await filestore.intakeRead(rel);
    const parsed = parseSheet(buffer, sheetName);

    /* The workbook writes down what its own colours mean. Adopting that the
       first time is not the same as guessing one: it is the authors' sentence,
       read off the page. It is only ever adopted into an *empty* register —
       once somebody has mapped a colour by hand the file does not get to
       overrule them, and a disagreement is surfaced instead. */
    const declared = readLegend(parsed);
    if (declared.length && !legend.length) {
      await rc.addLegend(declared.map((d) => ({ argb: d.argb, meaning: d.meaning })));
      legend = declared;
      if (!silent) {
        toast({
          tone: 'good',
          message: `Read ${declared.length} colours from the workbook's own key: `
            + `${declared.map((d) => d.meaning).join(', ')}.`,
          timeout: 9000,
        });
      }
    }

    const grid = applyLegend(parsed, legend);

    if (grid.conditional.length && !grid.rows.some((r) => r.cells.some((c) => c.hex))) {
      throw new Error(
        'That sheet has conditional formatting and no readable cell fills, so the shift '
        + 'colours are coming from rules rather than from the cells. They cannot be read '
        + 'from the style table — the ingestion design needs revisiting before this can work.'
      );
    }

    const snapshot = await rc.addSnapshot({
      file_hash: hash,
      file_mtime: run.file_mtime,
      sheet_name: grid.sheet,
      grid: {
        rows: grid.rows,
        merges: grid.merges,
        hiddenColumns: grid.hiddenColumns,
        unknown: grid.unknown,
        // What the file said about itself, kept beside what it was read
        // against — so a legend that changed under a snapshot is visible
        // rather than something somebody has to remember.
        declared,
        legend,
      },
    });

    /* Write the rows, not just the grid.
       The snapshot holds the whole sheet as it was read, which is what the
       calendar draws; the rows are the same thing keyed by week and location,
       which is what the plan and the change log can *join* to. Until now only
       the grid was written, so `rc_lookahead_rows` was a well-designed table
       with nothing in it and nothing downstream could reference a row. */
    let written = [];
    let rowTrouble = null;
    try {
      const rows = await lookaheadRows(snapshot.id, grid);
      if (rows.length) written = await rc.addSnapshotRows(rows);
    } catch (err) {
      /* A column this project has and that project has not.
         `create table if not exists` does nothing to a table that already
         exists, so a database built before the Resource row went in has no
         `resources` column — and PostgREST refuses the whole insert over it.
         The rest of the row is still worth having, so it goes without that one
         field and the gap is *said*, rather than costing the read. */
      const missingColumn = /resources/.test(err.message)
        && /(column|schema cache)/i.test(err.message);
      if (missingColumn) {
        try {
          const rows = (await lookaheadRows(snapshot.id, grid))
            .map(({ resources, ...rest }) => rest);
          if (rows.length) written = await rc.addSnapshotRows(rows);
          rowTrouble = 'This database has no rc_lookahead_rows.resources column, so who the '
            + 'Resource row names was not stored. Run supabase/migrate.sql and then '
            + 'supabase/rc_schema.sql. The calendar still shows the names — it re-reads the '
            + 'snapshot — but the Resources tab and the week plan read the stored column.';
        } catch (second) {
          rowTrouble = second.message;
        }
      } else {
        rowTrouble = err.message;
      }
      /* The snapshot is the record; the rows are a convenience over it and can
         be rebuilt from it. Losing them must not lose the read — but it must
         not be silent either, which it was: a `console.warn` is a message to
         nobody, and the feature it takes out simply reads as empty. */
      console.warn('[cx-timeline] look-ahead rows:', err.message);
    }

    /* And then say what changed.
       This is the point of snapshotting at all — the difference between two
       reads is what a delay claim is eventually built from — and until now
       nothing produced it: `classify()` was written, tested and never called,
       so `rc_change_events` stayed empty and the Changes tab had nothing to
       draw. */
    let events = [];
    try {
      events = await recordChanges(previous, snapshot, written, legend);
    } catch (err) {
      // Same reasoning as the rows: both are derived from snapshots that are
      // safely stored, so a failure here costs a re-derivation and not a read.
      console.warn('[cx-timeline] change events not written:', err.message);
      rc.reportError('lookahead:changes', err);
    }

    /* And move the days the sheet has handed to somebody else.
       A stored entry pointing at a look-ahead row is somebody confirming or
       overriding what that row said; when this read names a different person on
       it, the task has moved. Done here rather than at paint time because it is
       a *write*, and because this is the one moment somebody deliberately asked
       the sheet what it says now. */
    let moved = [];
    try {
      moved = await applyReassignments(written);
    } catch (err) {
      // Same reasoning as the rows and the events: the snapshot is stored, so a
      // failure here costs a re-derivation on the next read rather than a read.
      console.warn('[cx-timeline] reassignments not applied:', err.message);
      rc.reportError('lookahead:reassign', err);
    }

    run.outcome = 'snapshot';
    run.note = [
      grid.unknown.length ? `${grid.unknown.length} colour(s) not in the legend` : null,
      events.length ? `${countable(events).length} change(s) that count` : null,
      moved.length ? `${moved.length} task(s) moved to somebody else` : null,
      rowTrouble ? `rows: ${rowTrouble}` : null,
    ].filter(Boolean).join('; ') || null;
    await rc.addIngestRun(run);

    if (!silent && moved.length) {
      toast({
        tone: 'warn',
        message: `${moved.length} planned task(s) moved to the person this read names on the row `
          + '— flagged "Reassigned" in the week plan, with who had it before.',
        timeout: 12000,
      });
    }

    /* Said out loud, and at length. Something downstream of this read is now
       empty, and "empty" and "it could not be written" must not look alike — a
       read that half worked and reported success is how somebody concludes a
       feature does not work. */
    if (!silent && rowTrouble) {
      toast({ tone: 'bad', message: `Read, but: ${rowTrouble}`, timeout: 20000 });
    }

    if (!silent && grid.unknown.length) {
      toast({
        tone: 'warn',
        message: `${grid.unknown.length} colour(s) are not in the legend and were left unmapped — `
          + 'nothing was guessed.',
      });
    }

    if (!silent && events.length) {
      const counted = countable(events).length;
      toast({
        tone: counted ? 'warn' : 'info',
        message: counted
          ? `${counted} change(s) since the last read — see Changes.`
          : 'Read. The only difference was the window rolling forward.',
        timeout: 8000,
      });
    }

    notifyChanged('lookahead');
    return { changed: true, snapshot, grid, events };
  } catch (err) {
    if (run.outcome === 'error') {
      run.note = err.message;
      await rc.addIngestRun(run).catch(() => {});
    }
    throw err;
  }
}

/**
 * The snapshot, as rows something else can point at.
 *
 * The derivation lives in `core/lookahead.js`, which knows nothing about
 * Supabase and can therefore be tested without a browser; this is the part
 * that needs the network — resolving a spelling through the alias register.
 */
async function lookaheadRows(snapshotId, grid) {
  const resolved = new Map();
  return rowsFrom(readGrid(grid), {
    snapshotId,
    // Cached, because a hundred and forty rows share a handful of spellings
    // and each miss is a round trip.
    locate: async (text) => {
      const key = String(text || '').trim();
      if (!key) return null;
      if (!resolved.has(key)) resolved.set(key, await rc.resolveLocation(key).catch(() => null));
      return resolved.get(key);
    },
  });
}

/**
 * What changed between two reads, written down.
 *
 * The rows of both snapshots are put in the shape `classify()` expects and the
 * difference is stored. Three things about it are load-bearing and all three
 * are in `core/lookahead.js` rather than here — this function's only job is to
 * feed it honestly:
 *
 *   * only weeks in *both* snapshots are compared, so the window rolling
 *     forward is recorded as itself rather than as a batch of scope additions
 *     every Monday and a pile of deletions every Friday;
 *   * a crew moving site is logged as a removal and an addition, never
 *     inferred, because the activity text is not reliable enough to match on;
 *   * a shift turning the cancellation colour is flagged as needing somebody
 *     to say whose cancellation it was. Nothing is assumed.
 *
 * Returns the events, so the caller can say how many of them count.
 */
/**
 * Move every planned day the sheet has just handed to somebody else.
 *
 * `reassignments()` decides *which*, and refuses to decide unless it is certain
 * — the row has to name exactly one person the roster knows on that day, and
 * somebody other than whoever has it. This does the writing:
 * `rc_reassign_plan()` supersedes the entry with one against the new person and
 * records where it came from, so the outgoing row stays and the week plan can
 * badge the new one "Reassigned from Dana".
 *
 * Each move is attempted on its own and a refusal is logged rather than thrown.
 * The function refuses an entry somebody has already revised, and one refusal
 * must not stop the other nine: they are independent facts about independent
 * days, and the next read will offer the failed one again.
 *
 * Returns what actually moved, which is what the toast and the ingest note say.
 */
async function applyReassignments(rows) {
  if (!rows || !rows.length) return [];

  const weeks = [...new Set(rows.map((r) => r.week_start).filter(Boolean))].sort();
  if (!weeks.length) return [];
  const from = weeks[0];
  const to = toISO(addDays(isoToMs(weeks[weeks.length - 1]), 6));

  const [planRows, people, aliases] = await Promise.all([
    rc.listPlan(from, to),
    rc.listPeople(),
    rc.listPersonAliases().catch(() => []),
  ]);

  const register = nameRegister(people, aliases);
  const moves = reassignments({
    planRows,
    laRows: rows,
    // The register, as the lookup the derivation takes. Exact, like everywhere
    // else: a near miss is reported on the week plan and answered with an
    // alias, never used to move somebody's shift.
    resolve: (name) => register.get(foldName(name)) || null,
  });
  if (!moves.length) return [];

  const done = [];
  for (const move of moves) {
    try {
      await rc.reassignPlan(move.entry.id, move.to);
      done.push(move);
    } catch (err) {
      /* Already revised, already withdrawn, or already theirs. None of them is
         a fault and none of them should stop the rest — the next read offers
         this one again. */
      console.warn('[cx-timeline] a task could not be moved:', err.message);
    }
  }
  if (done.length) notifyChanged('plan');
  return done;
}

async function recordChanges(previous, snapshot, rows, legend) {
  if (!previous || !rows.length) return [];

  const priorRows = await rc.listSnapshotRows(previous.id).catch(() => []);
  if (!priorRows.length) return [];

  // `classify()` keys on the row key and reads `cells` and `marks`; the
  // database columns are named for what they are on disk.
  const shape = (r) => ({
    rowKey: r.row_key,
    weekStart: r.week_start,
    location: r.raw_location || '',
    subsystem: r.subsystem || '',
    label: r.raw_label || '',
    cells: r.cells || {},
    marks: r.bart_marks || {},
    resources: r.resources || {},
    locationId: r.location_id || null,
  });

  /* Which meaning counts as a cancellation is the legend's to say, not this
     module's. A deployment that words it differently — "Cancelled", "Cancel" —
     should not silently stop producing cancellation events, so the register is
     asked and only an exact match counts. */
  const cancelled = legend.find((l) => /cancel/i.test(l.meaning))?.meaning || 'cancelled';

  const events = classify(priorRows.map(shape), rows.map(shape), { cancelledMeaning: cancelled });
  if (!events.length) return [];

  const byKey = new Map(rows.map((r) => [r.row_key, r]));
  await rc.addChangeEvents(events.map((e) => ({
    from_snapshot: previous.id,
    to_snapshot: snapshot.id,
    kind: e.kind,
    week_start: e.weekStart || null,
    row_key: e.rowKey || null,
    location_id: byKey.get(e.rowKey)?.location_id || null,
    before: sideOf(e, 'before'),
    after: sideOf(e, 'after'),
  })));

  return events;
}

/**
 * One side of a change, in the shape the table stores and `describe()` reads.
 *
 * The two have to agree, and there is no column for a date — the table keys on
 * the week — so a change to one day carries its own. What a reviewer needs a
 * year later is what it said before and what it says now, so both sides are
 * kept whole rather than summarised into a sentence that cannot be re-read.
 */
function sideOf(event, which) {
  const value = event[which];
  if (value === null || value === undefined) return null;

  // A whole row arrived or left: what it was is the useful part.
  if (event.kind === 'scope_added' || event.kind === 'scope_removed') {
    return { label: value.label || null, location: value.location || null, week: value.weekStart || null };
  }
  /* A resource request, as a map of date to what was asked for. Two shapes,
     because there are two places it can be written: a mark on the activity line
     itself, and the names on the Resource row underneath. `describe()` reads
     which by the key, so the two must not be collapsed into one. */
  if (event.kind === 'resource_changed') {
    return event.field === 'resources' ? { resources: value } : { marks: value };
  }

  return { date: event.date || null, value };
}

export function checkNowButton() {
  return el('button', {
    class: 'cx-btn mini primary',
    html: icon('refresh', { size: 12 }) + '<span>Check now</span>',
    onClick: async () => {
      try {
        await ingest();
      } catch (err) {
        // 'bad' — not 'error', which is not a tone and fell back to the
        // neutral info styling, so a refusal looked like a notification.
        // These messages say what to go and do, so they get longer than the
        // default three and a half seconds to be read.
        toast({ tone: 'bad', message: err.message, timeout: 12000 });
        rc.reportError('lookahead:read', err);
      }
    },
  });
}

