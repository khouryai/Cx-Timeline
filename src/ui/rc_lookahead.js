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
import { parseSheet, applyLegend, readLegend } from '../io/lookahead.js';
import {
  keyRows, classify, relinkCandidates, countable, describe, readGrid, rowsFrom,
} from '../core/lookahead.js';
import { icon } from './icons.js';
import { selectInput, textInput, toast, badge, emptyState, field, checkbox } from './components.js';
import {
  notifyChanged, byId, dayLabel, todayISO, formModal,
} from './rc_util.js';

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
  if (!rc.isAdmin()) {
    root.appendChild(emptyState({
      iconName: 'lock',
      title: 'Administrators only',
      message: 'The look-ahead register is the evidence base for delay claims, and it is '
        + 'restricted in the database rather than by hiding this tab.',
    }));
    return;
  }

  const nav = el('div', { class: 'rc-tabs', style: 'margin:0 0 16px' });
  for (const id of SECTIONS) {
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
  root.appendChild(nav);

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

    const snapshots = await rc.listSnapshots({ limit: 1 });
    const previous = snapshots[0] || null;
    if (snapshots[0] && snapshots[0].file_hash === hash) {
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
    try {
      const rows = await lookaheadRows(snapshot.id, grid);
      if (rows.length) written = await rc.addSnapshotRows(rows);
    } catch (err) {
      // The snapshot is the record; the rows are a convenience over it and can
      // be rebuilt from it. Losing them must not lose the read.
      console.warn('[cx-timeline] look-ahead rows not written:', err.message);
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

    run.outcome = 'snapshot';
    run.note = [
      grid.unknown.length ? `${grid.unknown.length} colour(s) not in the legend` : null,
      events.length ? `${countable(events).length} change(s) that count` : null,
    ].filter(Boolean).join('; ') || null;
    await rc.addIngestRun(run);

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
  // BART's own resource marks, as a map of date to what they asked for.
  if (event.kind === 'resource_changed') return { marks: value };

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
  const [snapshots, legendRows] = await Promise.all([
    rc.listSnapshots({ limit: 1 }),
    rc.listLegend(),
  ]);
  const snapshot = snapshots[0];

  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'The look-ahead' }),
    checkNowButton(),
  ]));

  if (!snapshot?.grid?.rows?.length) {
    host.appendChild(emptyState({
      iconName: 'calendar',
      title: 'Nothing read yet',
      message: 'Put the workbook in the lookahead folder beside your plan and press Check now. '
        + 'This draws the snapshot rather than the file, so once it has been read once it stays '
        + 'readable on any machine — including the ones that have never been given the folder.',
    }));
    return;
  }

  // `role` matters as much as the meaning here: it is what separates a shift
  // from the shading the workbook greys most of its calendar with.
  const legend = legendRows.map((r) => ({ argb: r.argb, meaning: r.meaning, role: r.role || 'shift' }));
  const grid = applyLegend(snapshot.grid, legend);
  // The snapshot's own timestamp is what pins the axis to a year — see
  // `datePlease()`. The weekday letters on the sheet then check the answer.
  const view = readGrid(grid, { anchorISO: snapshot.taken_at });

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

  host.appendChild(legendStrip(legend, grid.unknown));

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
    body.appendChild(grid_(windowed(view, today), calendarFilter, showQuietRows, today));
  };
  // Redraw the rows only, never the input: rebuilding the field under the
  // caret is the trap this project has already been bitten by three times.
  search.addEventListener('input', () => { calendarFilter = search.value; draw(); });

  host.appendChild(el('div', {
    style: 'display:flex;align-items:center;gap:16px;margin-bottom:10px;flex-wrap:wrap',
  }, [
    el('div', { style: 'flex:1;min-width:240px;max-width:340px' }, [search]),
    dated ? range : null,
    quiet,
  ].filter(Boolean)));
  host.appendChild(body);
  draw();

  const inWindow = windowed(view, today);
  const scheduled = inWindow.activities.filter((a) => a.highlighted).length;
  const headings = view.activities.filter((a) => a.heading).length;
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
      + 'Weekends are counted like any other day: possession work lands on them.',
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
function windowed(view, today) {
  const narrowed = (() => {
    if (!calendarWeeks || !view.days.some((d) => d.date)) return view.days;
    const ms = new Date(`${today}T00:00:00Z`).getTime();
    const monday = ms - ((new Date(ms).getUTCDay() + 6) % 7) * 86400000;
    const from = new Date(monday).toISOString().slice(0, 10);
    const to = new Date(monday + (calendarWeeks * 7 - 1) * 86400000).toISOString().slice(0, 10);
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
    highlighted: a.marks.some((m) => m.hex && m.role === 'shift' && shown.has(m.col)),
  }));

  return { ...view, days: narrowed, activities };
}

/** The grid itself. Split out so the filter can redraw it without the header. */
function grid_(view, filter, showQuiet, today) {
  const terms = String(filter || '').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
  let rows = view.activities;

  /* Quiet rows go, and then any headings left dangling at the end with nothing
     under them at all.
     Deliberately only the trailing ones: the workbook nests its sections —
     "PHASE 2" sits above "W40 — Testing and Commissioning", which sits above
     the work — so dropping a heading merely because another heading follows it
     would throw away the outer level of a section that does have rows. */
  if (!showQuiet) {
    const kept = rows.filter((a) => a.highlighted || a.heading);
    let last = kept.length;
    while (last > 0 && kept[last - 1].heading) last--;
    rows = kept.slice(0, last);
  }
  if (terms.length) {
    rows = rows.filter((a) => {
      const hay = a.meta.join(' ').toLowerCase();
      return terms.some((t) => hay.includes(t));
    });
  }

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

  const head = el('thead', {}, [
    el('tr', {}, [
      el('th', { class: 'la-meta la-last', colSpan: view.meta.length, text: '' }),
      /* The label is a sticky span inside the band rather than text in it.
         A month spans thirty columns, so once you scroll past its first day
         the label itself has scrolled away and the band above you is
         anonymous — which is exactly when you want to know what month it is. */
      ...months.map((m) => el('th', { class: 'la-month', colSpan: m.span }, [
        el('span', { class: 'la-month-label', text: m.month || '' }),
      ])),
    ]),
    el('tr', {}, [
      el('th', { class: 'la-meta la-last', colSpan: view.meta.length, text: 'Activity' }),
      ...view.days.map((d) => el('th', { class: dayClass(d, 'la-num'), text: d.day })),
    ]),
    el('tr', {}, [
      el('th', { class: 'la-meta la-last', colSpan: view.meta.length, text: '' }),
      ...view.days.map((d) => el('th', { class: dayClass(d), text: d.weekday })),
    ]),
  ]);

  const byCol = (marks) => {
    const map = new Map();
    for (const m of marks) map.set(m.col, m);
    return map;
  };

  const tbody = el('tbody', {}, rows.map((a) => {
    const marks = byCol(a.marks);
    return el('tr', { class: a.heading ? 'la-head-row' : '' }, [
      ...a.meta.map((value, i) => el('td', {
        class: 'la-meta' + (i === a.meta.length - 1 ? ' la-last' : ''),
        text: value,
        title: value,
      })),
      ...view.days.map((d) => {
        const mark = marks.get(d.col);
        const classes = ['la-day'];
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
          title: [a.meta.filter(Boolean)[0], d.date || `${d.month} ${d.day} ${d.weekday}`.trim(),
            mark?.meaning || (mark?.hex ? `unmapped colour #${mark.hex}` : null), mark?.value]
            .filter(Boolean).join(' · '),
        });
      }),
    ]);
  }));

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
      for (const cell of table_.querySelectorAll(`.la-meta:nth-child(${i + 1})`)) {
        if (cell.tagName === 'TD') cell.style.left = `${left}px`;
      }
      left += width;
    });
    for (const th of table_.querySelectorAll('thead .la-meta')) th.style.left = '0px';
    // The month label pins just past the frozen columns; only the browser
    // knows how wide the content made them.
    table_.style.setProperty('--la-meta-w', `${left}px`);
  });

  if (!rows.length) {
    return el('p', { class: 'rc-hint', text: 'Nothing matches that filter.' });
  }
  return wrap;
}

/** Perceived lightness, so text on a painted cell stays readable. */
function isDark(hex) {
  const n = parseInt(String(hex).slice(-6), 16);
  if (Number.isNaN(n)) return false;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
}

function legendStrip(legend, unknown) {
  const strip = el('div', { class: 'la-legend' });
  for (const entry of legend) {
    strip.append(el('span', {}, [
      el('span', { class: 'la-swatch', style: `background:#${entry.argb}` }),
      el('span', { text: entry.meaning }),
    ]));
  }
  if (unknown?.length) {
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
  const [legend, snapshots, settings] = await Promise.all([
    rc.listLegend({ includeInactive: true }),
    rc.listSnapshots({ limit: 1 }),
    rc.listSettings().catch(() => []),
  ]);
  const snapshot = snapshots[0];
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
        ]),
      ]))
    ));
  }

  /* ── What is not mapped ──────────────────────────────────────────────── */
  const grid = snapshot?.grid
    ? applyLegend(snapshot.grid, legend.filter((l) => l.active)
      .map((l) => ({ argb: l.argb, meaning: l.meaning, role: l.role || 'shift' })))
    : null;
  const unknown = grid?.unknown || [];

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

async function renderChanges(host) {
  const today = todayISO();
  const from = `${Number(today.slice(0, 4)) - 1}-01-01`;
  const [events, runs, parties] = await Promise.all([
    rc.listChangeEvents(from, `${today}T23:59:59Z`),
    rc.listIngestRuns({ limit: 60 }),
    rc.listParties(),
  ]);

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

  if (!events.length) {
    host.appendChild(el('p', { class: 'rc-hint', text: 'No changes recorded yet.' }));
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
  const snapshots = await rc.listSnapshots({ limit: 40 });

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
      el('td', { class: 'rc-num', text: String(s.grid?.rows?.length ?? 0) }),
      el('td', { class: 'rc-num', text: String(s.grid?.unknown?.length ?? 0) }),
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
