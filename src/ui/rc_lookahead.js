/**
 * The four-week look-ahead, and the SARs against it.
 *
 * The look-ahead is the contractual source of truth; the resource calendar is
 * the execution record. This tab is where the two meet: it reads the workbook
 * out of the OneDrive folder, snapshots it, works out what changed since last
 * time, and lets somebody annotate the judgements the system cannot make.
 *
 * Ingestion is desktop-only in practice, and the reason is worth stating: a
 * browser cannot watch a file in a synced folder. It can be granted one, but it
 * cannot poll for changes in the background. So coverage has gaps whenever
 * nobody has the application open — and a gap that is not recorded looks
 * exactly like a week in which nothing changed. Every attempt therefore writes
 * an `rc_ingest_runs` row, and the change log renders the gaps rather than
 * showing a smooth history that is not true.
 *
 * Imports: util, events, dates, rc, filestore, io/lookahead, core/lookahead,
 *          icons, components, rc_util.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import * as filestore from '../core/filestore.js';
import { parseSheet, applyLegend, readLegend, isDark } from '../io/lookahead.js';
import { calendarPdf, calendarFit, PAGE_CHOICES } from '../io/rc_pdf.js';
import { saveFile } from '../io/exporters.js';
import {
  keyRows, classify, relinkCandidates, countable, describe, readGrid, rowsFrom, marksOf,
  reassignments, ABSENCE_LABELS,
} from '../core/lookahead.js';
import { icon } from './icons.js';
import {
  selectInput, textInput, toast, badge, emptyState, field, checkbox, confirmDialog,
} from './components.js';
import {
  notifyChanged, byId, dayLabel, todayISO, formModal, parsedView,
  isoToMs, nameRegister, foldName,
} from './rc_util.js';
import { toISO, addDays } from '../core/dates.js';

/** Where the workbook lives, relative to the folder the plan is in. */
const LOOKAHEAD_DIR = 'lookahead';
const SAR_INBOX = 'sars/inbox';
/** Where a recorded SAR is filed, under the week it authorised. */
const SAR_ARCHIVE = 'sars';

const SECTIONS = ['calendar', 'changes', 'snapshots', 'legend', 'sars'];
let section = 'calendar';

/** Free text filter on the calendar, kept across a redraw of the section. */
let calendarFilter = '';
/**
 * Whether rows nobody highlighted are drawn.
 *
 * Off by default: most of the sheet is activities carried for reference with
 * nothing scheduled against them, and the reason to open this is to see what
 * *is* happening. It is a switch rather than a rule because a row vanishing
 * with no way to get it back is its own kind of wrong.
 */
let showQuietRows = false;
/**
 * Whether the names on each activity's Resource row are drawn.
 *
 * On by default — knowing who is on a shift is most of why anybody opens this —
 * and off is for reading the shape of the project without a hundred and forty
 * extra lines under it. It hides the names, never the activities: the Resource
 * row is part of the activity above it, so switching it off changes what a row
 * says and never which rows there are.
 */
let showResources = true;
/**
 * How much of the calendar to show, in weeks from the start of this one.
 *
 * Four by default, because that is what a four-week look-ahead is for. Zero
 * means the whole sheet — this file carries a quarter of history to the left
 * of today, which is worth being able to reach and not worth opening on.
 */
let calendarWeeks = 4;
const WEEK_CHOICES = [
  { weeks: 2, label: '2 weeks' },
  { weeks: 3, label: '3 weeks' },
  { weeks: 4, label: '4 weeks' },
  { weeks: 0, label: 'Everything' },
];

export async function render(root) {
  /* The calendar is the team's; the register around it is not.
     The 4WLA is what the field team is being asked to do, and this whole tab
     used to be administrators-only — so the people named on it were the only
     people who could not look at it, and asked their manager for a screenshot.
     They get the calendar, and read-only: the Changes list, the snapshot
     history and the SARs are the evidence base for a delay claim, they are
     restricted in the *policies* rather than here, and a section that would
     come back empty is a door onto a wall. */
  const admin = rc.isAdmin();
  const sections = admin ? SECTIONS : ['calendar'];
  if (!sections.includes(section)) section = sections[0];

  const nav = el('div', { class: 'rc-tabs', style: 'margin:0 0 16px' });
  for (const id of sections) {
    nav.appendChild(el('button', {
      class: 'rc-tab',
      type: 'button',
      text: {
        calendar: 'Calendar', changes: 'Changes', snapshots: 'Snapshots',
        legend: 'Legend', sars: 'Site access',
      }[id],
      'aria-pressed': String(id === section),
      onClick: () => { section = id; clear(root); render(root); },
    }));
  }
  if (sections.length > 1) root.appendChild(nav);

  const host = el('div');
  root.appendChild(host);

  if (section === 'calendar') await renderCalendar(host);
  else if (section === 'changes') await renderChanges(host);
  else if (section === 'snapshots') await renderSnapshots(host);
  else if (section === 'legend') await renderLegend(host);
  else await renderSars(host);
}

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

/* ══════════════════════════════════════════════════════════════════════════
   The calendar
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The look-ahead as it looks: activities down, days across, cells in the
 * colours the workbook painted them.
 *
 * This draws the *snapshot*, not the file — the file is in a folder the
 * browser may not have, and the whole point of snapshotting was that the
 * record has to survive without it. The legend is re-applied here rather than
 * being read from the snapshot, so mapping a colour changes what is on screen
 * straight away instead of at the next ingest.
 */
async function renderCalendar(host) {
  const [snapshot, legendRows] = await Promise.all([
    rc.latestSnapshot(),
    rc.listLegend(),
  ]);

  /* Reading the workbook is an administrator's job — it needs the folder, and
     ingestion writes the register. Everybody else is looking at the snapshot,
     which is the whole reason it is a snapshot. */
  const admin = rc.isAdmin();
  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'The look-ahead' }),
    admin ? checkNowButton() : null,
  ].filter(Boolean)));

  if (!snapshot?.grid?.rows?.length) {
    host.appendChild(emptyState({
      iconName: 'calendar',
      title: 'Nothing read yet',
      message: admin
        ? 'Put the workbook in the lookahead folder beside your plan and press Check now. '
          + 'This draws the snapshot rather than the file, so once it has been read once it stays '
          + 'readable on any machine — including the ones that have never been given the folder.'
        : 'Nobody has read the workbook yet. It is drawn from the last read rather than from the '
          + 'file, so once an administrator has pressed Check now it is here for everybody.',
    }));
    return;
  }

  // `role` matters as much as the meaning here: it is what separates a shift
  // from the shading the workbook greys most of its calendar with.
  const legend = legendRows.map((r) => ({ argb: r.argb, meaning: r.meaning, role: r.role || 'shift' }));
  /* One parse, shared with every other screen that reads the sheet — see
     `parsedView()`. The snapshot's own timestamp is what pins the axis to a
     year (`datePlease()`); the weekday letters on the sheet then check it. */
  const view = parsedView(snapshot, legendRows);
  const grid = { unknown: view.unknown };

  if (!view.days.length) {
    host.appendChild(emptyState({
      iconName: 'warning',
      title: 'No date axis found on that sheet',
      message: 'The calendar is located by finding the row of weekday letters — M, Tu, W and '
        + 'the rest — and this sheet has none that are visible. Check the sheet name in Legend, '
        + 'and that the week columns are not hidden.',
    }));
    return;
  }

  /* The key sits above the grid and is redrawn with it, because it describes
     what is on screen. */
  const strip = el('div');

  /* A filter, because a hundred and forty rows is a spreadsheet and the reason
     to look at it here is usually one subsystem or one location. */
  const search = textInput({
    value: calendarFilter,
    placeholder: 'Filter activities — description, location, party…',
    mini: true,
  });
  const quiet = checkbox({
    label: 'Show rows with nothing scheduled',
    checked: showQuietRows,
    onChange: (on) => { showQuietRows = on; draw(); },
  });
  const resources = checkbox({
    label: 'Show resource names',
    checked: showResources,
    onChange: (on) => { showResources = on; draw(); },
  });

  const dated = view.days.some((d) => d.date);
  const today = todayISO();
  const range = el('div', { class: 'rc-tabs', style: 'margin:0' });
  const drawRange = () => {
    clear(range);
    for (const choice of WEEK_CHOICES) {
      range.appendChild(el('button', {
        class: 'rc-tab',
        type: 'button',
        text: choice.label,
        'aria-pressed': String(choice.weeks === calendarWeeks),
        onClick: () => { calendarWeeks = choice.weeks; drawRange(); draw(); },
      }));
    }
  };
  drawRange();

  const body = el('div');
  const draw = () => {
    clear(body);
    const shown = drawn(windowed(view, today), calendarFilter, showQuietRows);
    clear(strip);
    strip.appendChild(legendStrip(legend, grid.unknown, paintOn(shown)));
    strip.appendChild(whyStrip(shown, legendRows));
    body.appendChild(grid_(shown, today));
  };
  // Redraw the rows only, never the input: rebuilding the field under the
  // caret is the trap this project has already been bitten by three times.
  search.addEventListener('input', () => { calendarFilter = search.value; draw(); });

  host.appendChild(strip);
  host.appendChild(el('div', {
    style: 'display:flex;align-items:center;gap:16px;margin-bottom:10px;flex-wrap:wrap',
  }, [
    el('div', { style: 'flex:1;min-width:240px;max-width:340px' }, [search]),
    dated ? range : null,
    quiet,
    resources,
    /* The whole view, not the windowed one: the dialog picks its own weeks, and
       handing it what is on screen would quietly cap the export at whatever the
       range buttons were last set to. */
    exportButton({ view, legendRows, today, sheetName: snapshot.sheet_name }),
  ].filter(Boolean)));
  host.appendChild(body);
  draw();

  const inWindow = windowed(view, today);
  const scheduled = inWindow.activities.filter((a) => a.highlighted && a.named).length;
  const headings = view.activities.filter((a) => a.heading).length;
  const named = view.activities.filter((a) => a.resource).length;
  const away = view.activities.filter((a) => a.absence).length;
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: `${scheduled} of ${view.activities.length} activities have something scheduled in the `
      + `weeks on screen. The workbook holds `
      + `${view.days.length} days, from the snapshot taken `
      + `${snapshot.taken_at ? snapshot.taken_at.slice(0, 16).replace('T', ' ') : 'earlier'}`
      + `${headings ? `, under ${headings} section heading(s)` : ''}. `
      + 'The rest are either carried for reference with no shift against them, or were worked in '
      + 'weeks that have already gone; both are hidden unless you ask for them. Only the rows and '
      + 'columns that were visible in the workbook are here at all — a hidden row is not work '
      + 'anybody was being asked to look at.',
  }));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: dated
      ? `The sheet carries months and day numbers but no year, so the axis is dated from the `
        + `snapshot's own timestamp and then checked against the workbook's weekday letters — `
        + `only one candidate year makes M, Tu and W land where the file says they do. It reads `
        + `as ${view.days[0].date} to ${view.days[view.days.length - 1].date}. `
        + `Today is ${today}.`
      : 'No year could be resolved from this sheet — the weekday letters did not agree with any '
        + 'candidate, so no today line is drawn and the week filters stand down. A today line on '
        + 'the wrong column would be worse than none.',
  }));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'A row counts as scheduled when one of the days on screen carries paint the legend does '
      + 'not call shading — so narrowing to four weeks drops the rows whose work was in the '
      + 'weeks before it. A colour nobody has mapped counts too: until somebody says what it is, '
      + 'it might be work, and hiding it would bury exactly the rows that need looking at. '
      + 'Weekends are counted like any other day: possession work lands on them. A section '
      + 'heading is only drawn when something under it is: a title over nothing is not an answer, '
      + 'and headings used to be exempt from the switch entirely — which is how a whole workbook '
      + 'came back on screen the moment one stray colour went unmapped.',
  }));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: named
      ? `${named} activity(ies) carry a Resource row — the line the workbook writes underneath `
        + 'with the names typed against each day. It is drawn as part of the activity above it, '
        + 'taking that line\'s location and work hours, because that is what leaving them blank '
        + 'means. "Show resource names" hides the names and never the activities.'
      : 'No Resource rows on this sheet yet. Add a row under an activity whose description reads '
        + '"Resource", leave its location and work hours blank so they carry down from the '
        + 'activity, and type the names into the day cells.',
  }));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: away
      ? `${away} row(s) say who is away rather than what is happening — "PTO" and "Other Group / `
        + 'Project", with the names typed into the day cells. They stand on their own rather than '
        + 'under an activity, because what they say is about the person; they are never counted as '
        + 'scope, and they hide with "Show resource names" like every other row of names. Those '
        + 'days reach the week plan, Resources and PTO against the people they name.'
      : 'Nothing on this sheet says who is away. Add a row at the bottom whose description reads '
        + '"PTO", or "Other Group / Project", and type the names into the day cells — those days '
        + 'then show against those people in the week plan, Resources and PTO instead of reading '
        + 'as a day nobody planned.',
  }));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'The key above the grid lists only the colours actually on screen. A legend of thirty '
      + 'entries for a window carrying four of them is a key to somebody else\'s calendar; the '
      + 'full register is in Legend.',
  }));
}

/**
 * Narrow the axis to the weeks worth looking at.
 *
 * The past is dropped rather than scrolled past: this sheet carries a quarter
 * of finished weeks to the left of today, and a look-ahead that opens on
 * March is not a look-ahead. "Everything" is one click away for the times the
 * question really is what happened.
 *
 * If the dates could not be resolved — the weekday letters did not agree —
 * nothing is narrowed, because narrowing on a reading that might be a year out
 * would hide real work. Same if the window turns out to be empty: a calendar
 * showing nothing is not an answer.
 */
function windowed(view, today, weeks = calendarWeeks) {
  const narrowed = (() => {
    if (!weeks || !view.days.some((d) => d.date)) return view.days;
    const ms = new Date(`${today}T00:00:00Z`).getTime();
    const monday = ms - ((new Date(ms).getUTCDay() + 6) % 7) * 86400000;
    const from = new Date(monday).toISOString().slice(0, 10);
    const to = new Date(monday + (weeks * 7 - 1) * 86400000).toISOString().slice(0, 10);
    const days = view.days.filter((d) => !d.date || (d.date >= from && d.date <= to));
    // A window with nothing in it is not an answer; fall back to the sheet.
    return days.length ? days : view.days;
  })();

  /* Whether a row has anything scheduled is a question about *the weeks on
     screen*, not about the workbook.
     This is what was wrong: the flag was worked out once across the whole
     sheet, so a row painted in June survived into a four-week window showing
     nothing at all — and this file has thirty-eight of those. A row earns its
     place by carrying work in the days actually being drawn. */
  const shown = new Set(narrowed.map((d) => d.col));
  const activities = view.activities.map((a) => ({
    ...a,
    // `role === 'shift'`, the same question `readGrid()` asks — a divider or a
    // weekend band is paint, not work, and a row carrying only those has
    // nothing scheduled in the weeks on screen.
    highlighted: marksOf(a).some((m) => m.hex && m.role === 'shift' && shown.has(m.col)),
  }));

  return { ...view, days: narrowed, activities };
}

/**
 * Which rows are actually drawn: unscheduled ones out, then the filter.
 *
 * **A heading is not exempt from the switch.** It used to be — headings were
 * kept whatever, and only the ones left dangling at the very end were trimmed —
 * so a workbook whose activity columns carry any paint at all, or one stray
 * colour that turned up unmapped after a read, put its entire contents back on
 * screen with the box still unticked. What the switch says is what happens: a
 * row with nothing scheduled is hidden, and a title over nothing is a row with
 * nothing scheduled.
 *
 * The nesting is still respected, which is why this walks backwards. The
 * workbook nests its sections — "PHASE 2" sits above "W40 — Testing and
 * Commissioning", which sits above the work — so a heading is kept when the
 * section under it has work *or* when the row immediately below it is a heading
 * that was itself kept. That second clause is the parent case, and dropping it
 * would throw away the outer level of every section that has rows.
 */
function drawn(view, filter, showQuiet, withResources = showResources) {
  const terms = String(filter || '').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
  let rows = view.activities;

  if (!showQuiet) {
    /* A heading that carries work is work.
       `heading` is a fact about paint in the activity columns, and a workbook
       that bands *every* row's description would make every row one — at which
       point a rule that only ever kept a heading for the sake of the rows under
       it would empty the grid completely, which is worse than the problem it is
       here to fix. So a title is a heading with nothing scheduled on it, and
       anything with a shift on it is judged as work like any other row. */
    const isTitle = (a) => a.heading && !a.highlighted;
    const keep = new Array(rows.length).fill(false);
    let sectionHasWork = false;
    let belowIsKeptTitle = false;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].absence) {
        /* Not work, and not a title either. "Nothing scheduled" is a question
           about an activity, and these rows have no activity — asking it of them
           would hide the one row that says why somebody has no work this week,
           which is the opposite of what the switch is for. They answer to the
           resource-names switch instead, below, because that is what they are:
           names. */
        keep[i] = true;
        continue;
      }
      if (isTitle(rows[i])) {
        keep[i] = sectionHasWork || belowIsKeptTitle;
        // This title closes the section beneath it; anything above belongs to a
        // different one.
        sectionHasWork = false;
        belowIsKeptTitle = keep[i];
      } else {
        keep[i] = rows[i].highlighted && rows[i].named;
        if (keep[i]) sectionHasWork = true;
        // A row of work between two titles means the upper one is not the
        // lower one's parent.
        belowIsKeptTitle = false;
      }
    }
    rows = rows.filter((_, i) => keep[i]);
  }

  /* "Show resource names" covers every row of names, not only the ones tucked
     under an activity. Switching the names off to read the activities alone and
     being left with two rows of people would be the switch half working. */
  if (!withResources) rows = rows.filter((a) => !a.absence);

  if (terms.length) {
    rows = rows.filter((a) => {
      /* The names on the Resource row are part of the haystack: looking for
         where somebody is this week is one of the two reasons anybody types in
         this box, and it would find nothing if only the activity line counted. */
      const hay = [...a.meta, ...(a.resource?.marks || []).map((m) => m.value),
        ...(a.absence ? a.marks.map((m) => m.value) : [])]
        .join(' ').toLowerCase();
      return terms.some((t) => hay.includes(t));
    });
  }

  return { ...view, activities: rows };
}

/** Every colour actually painted on the days being drawn, as a set of hexes. */
function paintOn(view) {
  const shown = new Set(view.days.map((d) => d.col));
  const hexes = new Set();
  for (const activity of view.activities) {
    for (const mark of marksOf(activity)) {
      if (mark.hex && shown.has(mark.col)) hexes.add(String(mark.hex).toUpperCase());
    }
  }
  return hexes;
}

/** The grid itself. Split out so the filter can redraw it without the header. */
function grid_(view, today) {
  const rows = view.activities;

  /* The month band. Each label spans its own run of days, which is what the
     merged cell in the workbook meant. */
  const months = [];
  for (const day of view.days) {
    const last = months[months.length - 1];
    if (last && last.month === day.month) last.span++;
    else months.push({ month: day.month, span: 1 });
  }

  const dayClass = (d, extra = '') => [
    extra,
    d.weekend ? 'la-weekend' : '',
    d.date && d.date === today ? 'la-today' : '',
  ].filter(Boolean).join(' ');

  /* What the workbook calls each of the frozen columns.
     `readGrid()` already reads them — it has to, because one of them is the
     Location and the rows depend on knowing which — and they were being thrown
     away here: the header said "Activity" across all of them, so a grid whose
     left-hand side is Location, SSWP, Party to action and work hours arrived on
     screen as four anonymous columns of text. The printed calendar has read them
     since it was written, so this is the same answer in the same words —
     `io/rc_pdf.js` falls back to "Activity" over the first column and to nothing
     over a column the sheet never labelled, and a heading that differed between
     the screen and the print would be a heading nobody could trust. */
  const headings = view.meta.map((_, i) => {
    const said = String(view.headings?.[i] || '').trim();
    return said || (i === 0 ? 'Activity' : '');
  });

  const head = el('thead', {}, [
    el('tr', {}, [
      el('th', { class: 'la-meta la-meta-all la-last', colSpan: view.meta.length, text: '' }),
      /* The label is a sticky span inside the band rather than text in it.
         A month spans thirty columns, so once you scroll past its first day
         the label itself has scrolled away and the band above you is
         anonymous — which is exactly when you want to know what month it is. */
      ...months.map((m) => el('th', { class: 'la-month', colSpan: m.span }, [
        el('span', { class: 'la-month-label', text: m.month || '' }),
      ])),
    ]),
    el('tr', {}, [
      ...headings.map((text, i) => el('th', {
        class: `la-meta la-meta-head${i === headings.length - 1 ? ' la-last' : ''}`,
        text,
        title: text,
      })),
      ...view.days.map((d) => el('th', { class: dayClass(d, 'la-num'), text: d.day })),
    ]),
    el('tr', {}, [
      el('th', { class: 'la-meta la-meta-all la-last', colSpan: view.meta.length, text: '' }),
      ...view.days.map((d) => el('th', { class: dayClass(d), text: d.weekday })),
    ]),
  ]);

  const byCol = (marks) => {
    const map = new Map();
    for (const m of marks) map.set(m.col, m);
    return map;
  };

  /**
   * One line of the grid: the activity columns frozen on the left, then a cell
   * per day. Used for the activity and for its Resource row alike, because the
   * two are the same shape and drawing them twice is how they drift apart.
   */
  const line = (meta, marks, { klass = '', what = '', resource = false }) => el('tr', {
    class: klass,
  }, [
    ...meta.map((value, i) => el('td', {
      class: 'la-meta' + (i === meta.length - 1 ? ' la-last' : ''),
      text: value,
      title: value,
    })),
    ...view.days.map((d) => {
      const mark = marks.get(d.col);
      const classes = ['la-day'];
      if (resource) classes.push('la-resource');
      if (d.weekend) classes.push('la-weekend');
      if (d.date && d.date === today) classes.push('la-today');
      if (mark?.hex) {
        classes.push('la-painted');
        if (isDark(mark.hex)) classes.push('la-dark');
        if (!mark.meaning) classes.push('la-unmapped');
      }
      return el('td', {
        class: classes.join(' '),
        style: mark?.hex ? `background:#${mark.hex}` : '',
        text: mark?.value || '',
        title: [what, d.date || `${d.month} ${d.day} ${d.weekday}`.trim(),
          mark?.meaning || (mark?.hex ? `unmapped colour #${mark.hex}` : null), mark?.value]
          .filter(Boolean).join(' · '),
      });
    }),
  ]);

  const tbody = el('tbody');
  for (const a of rows) {
    const what = a.meta.filter(Boolean)[0] || '';
    tbody.appendChild(line(a.meta, byCol(a.marks), {
      klass: [a.heading ? 'la-head-row' : '', a.absence ? 'la-resource-row la-absence-row' : '']
        .filter(Boolean).join(' '),
      what: a.absence ? `${ABSENCE_LABELS[a.absence]} — who is away` : what,
      // Styled as names, because that is what the cells hold. The paint on an
      // absence row means nothing the legend knows about.
      resource: Boolean(a.absence),
    }));
    /* The Resource row, drawn under the activity it belongs to and never on its
       own — it has no location or hours of its own, only the ones it inherited,
       so away from that line it would be a row of names about nothing. */
    if (a.resource && showResources) {
      tbody.appendChild(line(a.resource.meta, byCol(a.resource.marks), {
        klass: 'la-resource-row',
        what: what ? `${what} — who is on it` : 'who is on it',
        resource: true,
      }));
    }
  }

  const table_ = el('table', { class: 'rc-table la-grid' }, [head, tbody]);
  const wrap = el('div', { class: 'rc-scroll', style: 'max-height:60vh' }, [table_]);

  /* The frozen columns have to be told where they start, and only the browser
     knows how wide the content made them. Measured once the table is in the
     document, on the next frame. */
  requestAnimationFrame(() => {
    const firstRow = table_.querySelector('tbody tr');
    if (!firstRow) return;
    let left = 0;
    const widths = [...firstRow.querySelectorAll('.la-meta')].map((td) => td.getBoundingClientRect().width);
    widths.forEach((width, i) => {
      /* Every cell in that column, heading included — the heading row now has
         one cell per column rather than one spanning the lot, so it has to be
         frozen at the same offsets or the names slide out from over their
         values. The two rows that still span everything are pinned at zero,
         which is where a cell covering all of them starts. */
      for (const cell of table_.querySelectorAll(`.la-meta:nth-child(${i + 1})`)) {
        if (!cell.classList.contains('la-meta-all')) cell.style.left = `${left}px`;
      }
      left += width;
    });
    for (const th of table_.querySelectorAll('thead .la-meta-all')) th.style.left = '0px';
    // The month label pins just past the frozen columns; only the browser
    // knows how wide the content made them.
    table_.style.setProperty('--la-meta-w', `${left}px`);
  });

  if (!rows.length) {
    return el('p', {
      class: 'rc-hint',
      text: 'Nothing scheduled in these weeks matches. Widen the window, clear the filter, or '
        + 'tick "Show rows with nothing scheduled" to see what the workbook is carrying for '
        + 'reference.',
    });
  }
  return wrap;
}

/**
 * The key, for the calendar actually on screen.
 *
 * `onScreen` is the set of colours the drawn rows and days carry, and only
 * those are listed. The register is the whole project's — five shifts, three
 * kinds of shading, whatever a previous year needed — and printing all of it
 * over a four-week window is a key to somebody else's calendar: the reader
 * checks a colour against it, finds three entries that are not here, and stops
 * trusting the strip. The full register is one click away in Legend, which says
 * so underneath.
 *
 * Pass no set at all and everything is listed, which is what a caller with
 * nothing drawn yet wants.
 */
/**
 * Which colours are keeping rows on the calendar, and one click to say they are not.
 *
 * "It is still showing rows with nothing on them" is a question about a
 * *colour*, and until now the calendar could not answer it. The switch hides a
 * row with nothing scheduled; whether a row has something scheduled is decided
 * entirely by whether any of its paint counts as `shift` — and the person
 * looking at a hundred rows they did not expect has no way to find out which
 * colour did that. They can see the legend, and they can see the grid, and
 * joining the two by eye across a hundred days is not a thing anybody should be
 * asked to do. So the calendar says it.
 *
 * The unmapped list above answers the same question for colours nobody has
 * explained. This is its other half: a colour somebody *has* explained, as work,
 * on rows where no work is happening. Both are one press from "Just shading",
 * and for a mapped colour that press changes the role on the row in force rather
 * than adding a second one — adding is what left a register with two answers for
 * one colour in the first place.
 */
function whyStrip(view, legendRows) {
  const shownCols = new Set(view.days.map((d) => d.col));
  const rowsFor = new Map();

  for (const activity of view.activities) {
    // A title is on screen for the sake of the rows under it, not for its paint.
    if (activity.heading && !activity.highlighted) continue;
    const hexes = new Set(marksOf(activity)
      .filter((m) => m.hex && m.role === 'shift' && shownCols.has(m.col))
      .map((m) => String(m.hex).toUpperCase()));
    for (const hex of hexes) rowsFor.set(hex, (rowsFor.get(hex) || 0) + 1);
  }
  if (!rowsFor.size) return el('div');

  /* The entry in force, by the same rule `applyLegend()` uses — newest
     `valid_from` wins — so the button edits the row the calendar is actually
     reading rather than whichever came back first. */
  const inForce = (hex) => (legendRows || [])
    .filter((l) => String(l.argb).toUpperCase() === hex)
    .sort((a, b) => String(b.valid_from || '').localeCompare(String(a.valid_from || '')))[0] || null;

  const strip = el('div', { class: 'la-legend la-why' });
  strip.appendChild(el('span', { class: 'rc-eyebrow', text: 'On screen because of' }));

  for (const [hex, count] of [...rowsFor.entries()].sort((a, b) => b[1] - a[1])) {
    const entry = inForce(hex);
    strip.appendChild(el('span', { class: 'la-why-item' }, [
      el('span', { class: 'la-swatch', style: `background:#${hex}` }),
      el('span', { text: `${entry?.meaning || `#${hex}, unmapped`} — ${count} row(s)` }),
      // What a colour means is the register's, and the register is an
      // administrator's. Everybody else reads why a row is here, and that is
      // the useful half of this strip anyway.
      rc.isAdmin() ? el('button', {
        class: 'cx-btn mini ghost',
        text: 'Just shading',
        title: entry
          ? `Rows whose only paint is ${entry.meaning} will drop out of the calendar. `
            + 'The colour keeps its name; what changes is whether it counts as somebody being '
            + 'on site.'
          : 'Structure in the spreadsheet, not somebody on site.',
        onClick: async () => {
          try {
            if (entry) await rc.updateLegend(entry.id, { role: 'ignore' });
            else await rc.addLegend([{ argb: hex, meaning: 'Shading', role: 'ignore' }]);
            notifyChanged('legend');
            toast({ tone: 'good', message: `#${hex} is shading — ${count} row(s) drop out.` });
          } catch (err) {
            toast({ tone: 'bad', message: err.message });
          }
        },
      }) : null,
    ].filter(Boolean)));
  }
  return strip;
}

function legendStrip(legend, unknown, onScreen = null) {
  const showing = (hex) => !onScreen || onScreen.has(String(hex).toUpperCase());
  const strip = el('div', { class: 'la-legend' });
  const listed = legend.filter((entry) => showing(entry.argb));
  for (const entry of listed) {
    strip.append(el('span', {}, [
      el('span', { class: 'la-swatch', style: `background:#${entry.argb}` }),
      el('span', { text: entry.meaning }),
    ]));
  }
  if (onScreen && legend.length > listed.length) {
    strip.append(el('span', {
      class: 'rc-hint',
      text: `${legend.length - listed.length} more colour(s) in the register are not on screen.`,
      title: 'The key lists what this window actually carries. Legend has the register in full.',
    }));
  }
  unknown = (unknown || []).filter((u) => showing(u.hex));
  // The way out of an unmapped colour is the Legend register, which only an
  // administrator can write. Offering the button to everybody else would be a
  // door onto a wall.
  if (unknown.length && rc.isAdmin()) {
    /* Show the swatches, not just a count. A colour nobody has explained keeps
       its rows on screen — an unmapped colour counts as work, deliberately —
       so "five unmapped" and "these five, and one of them is the grey your
       spreadsheet shades everything with" are very different messages. */
    strip.append(el('span', { class: 'la-unknown' }, [
      ...unknown.slice(0, 6).map((u) => el('span', {
        class: 'la-swatch la-swatch-unmapped',
        style: `background:#${u.hex}`,
        title: `#${u.hex} — ${u.count} cell(s), nobody has said what it means`,
      })),
      el('button', {
        class: 'cx-btn mini ghost',
        text: `${unknown.length} colour(s) unmapped — say what they mean`,
        title: 'Nothing is guessed. Until somebody says, they count as work and keep their rows '
          + 'on screen.',
        onClick: () => { section = 'legend'; notifyChanged('legend'); },
      }),
    ]));
  }
  return strip;
}

/* ══════════════════════════════════════════════════════════════════════════
   Exporting the calendar
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Put the look-ahead on one sheet of paper.
 *
 * What people were doing instead was a screenshot, and a screenshot of this
 * grid is a poor document: the frozen columns come out twice, the scroll clips
 * whichever weeks nobody happened to be looking at, and the shift colours are
 * whatever the monitor made of them. This is the same calendar as vector
 * geometry — selectable text, true colours, one page.
 *
 * **Every switch is asked rather than inherited.** The dialog opens on what is
 * on screen, because that is nearly always what somebody means, and then each
 * choice is its own argument to `calendarScene()`. An export that silently
 * depended on the last thing anybody clicked is the sort of document that turns
 * up in a claim bundle missing a fortnight.
 *
 * And it says what the print will come out at *before* writing anything.
 * "Fits on one page" is true of anything if you shrink it far enough; the
 * question somebody can act on is whether they will be able to read it, and the
 * answers — a bigger sheet, fewer weeks, the names off — are all in this
 * dialog.
 */
function exportDialog({ view, legendRows, today, sheetName }) {
  const weeks = selectInput({
    value: String(calendarWeeks || 0),
    options: [
      ...WEEK_CHOICES.map((c) => ({ value: String(c.weeks), label: c.label })),
      { value: '0', label: 'Everything the sheet covers' },
    ],
  });
  const page = selectInput({
    value: 'a3',
    options: PAGE_CHOICES.map((c) => ({ value: c.id, label: c.label })),
  });
  const orientation = selectInput({
    value: 'landscape',
    options: [{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }],
  });
  const title = textInput({ value: `${sheetName || '4WLA'} — look-ahead` });

  const withResources = checkbox({ label: 'Resource names, and who is away', checked: showResources });
  const withQuiet = checkbox({ label: 'Rows with nothing scheduled', checked: showQuietRows });
  const withLegend = checkbox({ label: 'The key for the colours on it', checked: true });
  const withFilter = checkbox({
    label: calendarFilter ? `Only rows matching "${calendarFilter}"` : 'Apply the filter on screen',
    checked: Boolean(calendarFilter),
  });

  const on = (box) => box.querySelector('input').checked;
  const readout = el('p', { class: 'rc-hint' });

  /* What is actually going to be drawn, from the same two functions the screen
     draws through — so the export cannot show a different set of rows from the
     grid it was started from. */
  const chosen = () => {
    const narrowed = windowed(view, today, Number(weeks.value) || 0);
    const rows = drawn(narrowed, on(withFilter) ? calendarFilter : '', on(withQuiet), on(withResources));
    return {
      view: rows,
      opts: {
        showResources: on(withResources),
        showAway: on(withResources),
        showLegend: on(withLegend),
        legend: on(withLegend)
          ? legendRows
            .map((r) => ({ argb: r.argb, meaning: r.meaning }))
            .filter((e) => paintOn(rows).has(String(e.argb).toUpperCase()))
          : [],
        today,
        pageSize: page.value,
        orientation: orientation.value,
        title: title.value.trim() || 'Look-ahead',
        subtitle: [
          `${sheetName || '4WLA'}`,
          Number(weeks.value) ? `${weeks.value} weeks from ${dayLabel(today, 'medium')}` : 'whole sheet',
        ].join('  ·  '),
      },
    };
  };

  const refresh = () => {
    const { view: shown, opts } = chosen();
    if (!shown.activities.length) {
      readout.className = 'rc-hint rc-warn';
      readout.textContent = 'Nothing to draw with those choices — widen the weeks, or bring the '
        + 'rows with nothing scheduled in.';
      return;
    }
    const fit = calendarFit(shown, opts);
    const tight = fit.pt < 4.6;
    readout.className = tight ? 'rc-hint rc-warn' : 'rc-hint';
    readout.textContent = `${fit.days} day column(s) and ${fit.rows} row(s) on ${fit.page}, at `
      + `${Math.round(fit.scale * 100)}% — the marks in the cells print at about `
      + `${fit.pt.toFixed(1)} pt.`
      + (tight ? ' That is small to read on paper: try a bigger sheet, or fewer weeks.' : '');
  };

  for (const control of [weeks, page, orientation]) control.addEventListener('change', refresh);
  for (const box of [withResources, withQuiet, withLegend, withFilter]) {
    box.querySelector('input').addEventListener('change', refresh);
  }
  refresh();

  formModal({
    title: 'Export the look-ahead',
    body: el('div', { class: 'cx-form' }, [
      field('Weeks', weeks),
      el('div', { style: 'display:flex;gap:8px' }, [
        el('div', { style: 'flex:1' }, [field('Paper', page)]),
        el('div', { style: 'flex:1' }, [field('Orientation', orientation)]),
      ]),
      field('Title', title),
      withResources,
      withQuiet,
      withLegend,
      calendarFilter ? withFilter : null,
      readout,
      el('p', {
        class: 'rc-hint',
        text: 'One page, always. A four-week look-ahead reassembled from four sheets on a '
          + 'meeting-room table is not a four-week look-ahead — so what gives is the scale, '
          + 'and nothing is ever cut off the side.',
      }),
    ].filter(Boolean)),
    confirmLabel: 'Export PDF',
    onConfirm: async () => {
      const { view: shown, opts } = chosen();
      if (!shown.activities.length) throw new Error('There is nothing to draw with those choices.');
      const blob = calendarPdf(shown, opts);
      saveFile(`lookahead-${today}.pdf`, blob, 'application/pdf', 'Look-ahead');
    },
  });
}

function exportButton(context) {
  return el('button', {
    class: 'cx-btn mini ghost',
    html: icon('download', { size: 12 }) + '<span>Export PDF</span>',
    title: 'Draw this calendar on one page — weeks, names and paper size are all choices.',
    onClick: () => exportDialog(context),
  });
}

function checkNowButton() {
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
      }
    },
  });
}

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
async function renderLegend(host) {
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

async function renderChanges(host) {
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

async function renderSnapshots(host) {
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

/* ══════════════════════════════════════════════════════════════════════════
   Site access
   ═══════════════════════════════════════════════════════════════════════ */

async function renderSars(host) {
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

/* ── Shared ────────────────────────────────────────────────────────────── */

function table(headers, rows) {
  return el('div', { class: 'rc-scroll' }, [
    el('table', { class: 'rc-table' }, [
      el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { text: h })))]),
      el('tbody', {}, rows),
    ]),
  ]);
}
