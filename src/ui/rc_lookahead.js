/**
 * The four-week look-ahead, and everything read against it.
 *
 * The look-ahead is written here, in the editor, and every reading of it is
 * kept: the calendar draws the newest, the cancellation log and the Changes
 * list compare them, and the legend and the P6 list are what they are read
 * against. All of it is in the shared folder (`core/rc.js`).
 *
 * Imports: util, events, dates, rc, filestore, io/lookahead, core/lookahead,
 *          core/la_edit, core/la_p6, icons, components, rc_util.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import { isDark } from '../io/lookahead.js';
import { calendarPdf, calendarFit, calendarSvg, PAGE_CHOICES } from '../io/rc_pdf.js';
import { svgToRaster } from '../io/svg.js';
import { saveFile } from '../io/exporters.js';
import {
  marksOf, ABSENCE_LABELS, isCancelMeaning, rowsNaming, resourceNames, cancellationNoteFor,
  cancellationReasonText, mergeViews,
} from '../core/lookahead.js';
import { mondayOf, addDaysISO } from '../core/la_edit.js';
import { p6Index, p6Status } from '../core/la_p6.js';
import { icon } from './icons.js';
import { selectInput, textInput, toast, emptyState, field, checkbox } from './components.js';
import {
  notifyChanged, dayLabel, todayISO, formModal, parsedView, viewOfSnapshot, foldName, meMatcher, codeNodes,
  watchForNewReading, penButton,
} from './rc_util.js';

import { la, WEEK_CHOICES } from './rc_la_state.js';
import { checkNowButton, lookaheadSource, EDITOR_SOURCE, writtenView } from './rc_ingest.js';
import { renderEditor, flushEditor, openExcelExport } from './rc_la_editor.js';
import { renderLegend } from './rc_la_legend.js';
import { renderChanges, renderSnapshots } from './rc_la_changes.js';
import { renderCancellations } from './rc_la_cancellations.js';
import { renderP6, p6Words } from './rc_la_p6.js';
import { openActivity } from './rc_activity.js';
import { masterExportButton } from './rc_master_export.js';
import { provide4wla, LATEST } from './rc_la_schedule.js';

const SECTIONS = ['calendar', 'cancellations', 'changes', 'snapshots', 'legend', 'p6'];

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
  la.source = await lookaheadSource();
  /* The editor is the calendar with Edit switched on, not a section beside it.
     Two grids of the same four weeks meant an edit had to be carried from one
     to the other, and the calendar could be looked at before it arrived. The
     editor is an administrator's — the look-ahead is written by the two people
     who own it — so for anybody else the switch is not there and never on. */
  if (la.section === 'editor') { la.section = 'calendar'; la.editing = true; }
  if (!admin) la.editing = false;
  const sections = admin ? SECTIONS : ['calendar'];
  if (!sections.includes(la.section)) la.section = sections[0];

  const nav = el('div', { class: 'rc-tabs', style: 'margin:0 0 16px' });
  for (const id of sections) {
    nav.appendChild(el('button', {
      class: 'rc-tab',
      type: 'button',
      text: {
        calendar: 'Calendar', cancellations: 'Cancellations', changes: 'Changes',
        snapshots: 'Snapshots', legend: 'Legend', p6: 'P6 activities',
      }[id],
      'aria-pressed': String(id === la.section),
      onClick: async () => {
        // Leaving the editor publishes what it holds first, so the section
        // being opened reads the look-ahead as it now stands.
        if (la.section === 'calendar' && la.editing && id !== 'calendar') await flushEditor();
        la.section = id;
        la.sectionChosen = true;
        clear(root);
        render(root);
      },
    }));
  }
  if (sections.length > 1) root.appendChild(nav);

  const host = el('div');
  root.appendChild(host);

  if (la.section === 'calendar') await (la.editing ? renderEditing(host) : renderCalendar(host));
  else if (la.section === 'cancellations') await renderCancellations(host);
  else if (la.section === 'changes') await renderChanges(host);
  else if (la.section === 'snapshots') await renderSnapshots(host);
  else if (la.section === 'legend') await renderLegend(host);
  else await renderP6(host);
}

/**
 * The switch between reading the calendar and writing it.
 *
 * Switching off saves and publishes first and waits for both, so the calendar
 * it opens onto is the one just written — never the reading from a moment
 * before, which is how a row taken off in the editor stayed on the calendar.
 */
function editSwitch() {
  const on = la.editing;
  return el('button', {
    class: `cx-btn mini${on ? ' primary' : ''} la-edit-switch`,
    type: 'button',
    'aria-pressed': String(on),
    title: on ? 'Save, publish, and go back to reading the calendar' : 'Edit the look-ahead in place',
    html: icon(on ? 'check' : 'edit', { size: 12 }) + `<span>${on ? 'Done editing' : 'Edit'}</span>`,
    onClick: async (e) => {
      const btn = e.currentTarget;
      /* Writing the look-ahead needs the pen. Somebody else holding it is
         said here, where it is wanted; Take over editing sits beside this. */
      if (!on && !rc.canWrite()) {
        const { holder } = rc.penState();
        toast({
          tone: 'warn',
          message: holder
            ? `${holder} is editing the calendar. Press Take over editing beside Edit to edit it here.`
            : 'The calendar is read-only here because you handed it back. Press Take over editing beside Edit first.',
          timeout: 8000,
        });
        return;
      }
      btn.disabled = true;
      try {
        if (on) await flushEditor();
      } catch (err) {
        /* Stay in the editor: switching to the calendar now would draw an
           older reading than the one on screen, as if the edits were lost. */
        rc.reportError('lookahead:publish', err);
        toast({ tone: 'bad', message: `Not published yet — ${err.message}`, timeout: 10000 });
        btn.disabled = false;
        return;
      }
      la.editing = !on;
      notifyChanged('lookahead');
    },
  });
}

/** The calendar with Edit on: the same heading, then the editor in full. */
async function renderEditing(host) {
  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'The look-ahead' }),
    el('div', { class: 'rc-section-actions' }, [penButton(), editSwitch()]),
  ]));
  const body = el('div');
  host.appendChild(body);
  await renderEditor(body);
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
  const [snapshot, legendRows, isMe, notes] = await Promise.all([
    rc.latestSnapshot(),
    rc.listLegend(),
    meMatcher(),
    // The reasons logged for cancellations, shown on hover. A database that
    // cannot give them still draws the grid.
    rc.listCancellationNotes().catch(() => []),
  ]);
  // The choice belongs to whoever made it: a different person looking — an
  // administrator previewing a member — starts from their own default.
  const who = rc.me()?.id || null;
  if (la.onlyMine === null || la.onlyMineFor !== who) {
    la.onlyMine = Boolean(isMe) && !rc.isAdmin();
    la.onlyMineFor = who;
  }

  /* Reading the workbook is an administrator's job — it needs the folder, and
     ingestion writes the register. Everybody else is looking at the snapshot,
     which is the whole reason it is a snapshot. */
  const admin = rc.isAdmin();
  const written = la.source === EDITOR_SOURCE;
  /* One group at the right: who has the pen, Edit, and the master export
     beside it — each button used to push itself to the right on its own, which
     spread them across the whole row. */
  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'The look-ahead' }),
    el('div', { class: 'rc-section-actions' }, [
      // Once it is written here there is nothing to check; Edit is the way in.
      admin && !written ? checkNowButton() : null,
      penButton(),
      admin ? editSwitch() : null,
      // Everything the calendar holds, as one workbook — the look-ahead is where it is looked for first.
      admin ? masterExportButton() : null,
    ].filter(Boolean)),
  ]));
  watchForNewReading(host, snapshot?.id ?? null);

  if (!snapshot?.grid?.rows?.length) {
    host.appendChild(emptyState({
      iconName: 'calendar',
      title: 'Nothing read yet',
      message: written ? 'Nothing has been written yet. Press Edit to write the look-ahead; it is drawn '
        + 'here as soon as it is saved.' : admin
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

  if (!view.days.length) {
    host.appendChild(emptyState({
      iconName: 'warning',
      title: 'No date axis found on that sheet',
      message: 'The calendar is located by finding the row of weekday letters — M, Tu, W and '
        + 'the rest — and this sheet has none that are visible. Check the sheet name in Legend, '
        + 'and that the week columns are not hidden.',
      action: admin ? { label: 'Open Legend', onClick: () => { la.section = 'legend'; notifyChanged('legend'); } } : null,
    }));
    return;
  }

  /* The key sits above the grid and is redrawn with it, because it describes
     what is on screen. */
  const strip = el('div');

  /* A filter, because a hundred and forty rows is a spreadsheet and the reason
     to look at it here is usually one subsystem or one location. */
  const search = textInput({
    value: la.calendarFilter,
    placeholder: 'Filter activities — description, location, party…',
    mini: true,
  });
  const quiet = checkbox({
    label: 'Show rows with nothing scheduled',
    checked: la.showQuietRows,
    onChange: (on) => { la.showQuietRows = on; draw(); },
  });
  const resources = checkbox({
    label: 'Show resource names',
    checked: la.showResources,
    onChange: (on) => { la.showResources = on; draw(); },
  });
  /* Only the activities whose names row puts me on a day on screen — drawn
     with the activity line above the names, since that line is the work the
     names land on, and under the sections they sit in. */
  const mine = isMe
    ? checkbox({
      label: 'Only my rows',
      checked: la.onlyMine,
      onChange: (on) => { la.onlyMine = on; draw(); },
    })
    : null;
  if (mine) mine.classList.add('la-only-mine');

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
        'aria-pressed': String(choice.weeks === la.calendarWeeks),
        onClick: () => { la.calendarWeeks = choice.weeks; drawRange(); draw(); },
      }));
    }
  };
  drawRange();

  /* Which weeks can be shown: the reading's, and — once the look-ahead is
     written here — every week anything was ever written in, and every week the
     workbook's readings hold from before then. A reading covers only the week
     just gone and the five ahead, so "Everything" used to stop a week back;
     the weeks before it are drawn from what the editor holds, and the weeks
     before the editor from the workbook readings that had them. */
  const reading = readingSpan(view);
  const history = await historyOf(written);
  const reach = reachOf(reading, history);
  const viewFor = viewChooser({ view, reading, reach, written, legendRows, today, history });
  const p6Of = p6Chooser();

  /* Back and forward a week at a time, as Edit does, and back to this week. */
  const pager = el('div', { class: 'la-pager' });
  const turn = (delta) => {
    const next = addDaysISO(la.calendarStart || mondayOf(today), delta);
    la.calendarStart = next === mondayOf(today) ? null : next;
    draw();
  };
  const drawPager = (days) => {
    clear(pager);
    const all = !la.calendarWeeks;
    const start = la.calendarStart || mondayOf(today);
    const dates = days.filter((d) => d.date).map((d) => d.date);
    pager.append(
      pagerButton('chevron-left', 'Previous week', all || !reach.first || start <= mondayOf(reach.first), () => turn(-7)),
      el('button', {
        class: 'cx-btn mini ghost', type: 'button', text: 'This week',
        title: 'Start the window on this week\'s Monday', disabled: all || !la.calendarStart,
        onClick: () => { la.calendarStart = null; draw(); },
      }),
      pagerButton('chevron-right', 'Next week', all || !reach.last || addDaysISO(start, 7) > reach.last, () => turn(7)),
      el('span', {
        class: 'la-pager-range',
        text: dates.length ? `${dayLabel(dates[0], 'medium')} – ${dayLabel(dates[dates.length - 1], 'medium')}` : '',
      }),
    );
  };

  const body = el('div');
  let drawing = 0;
  const draw = async () => {
    const turnNo = ++drawing;
    /** @type {{ view: any, from: string | null, to: string | null, kind: string, snapshotId?: string | null, takenAt?: string | null }[]} */
    let parts = [{ view, from: null, to: null, kind: 'latest' }];
    try {
      parts = await viewFor.parts(la.calendarWeeks, la.calendarStart);
    } catch (err) {
      rc.reportError('lookahead:past-weeks', err);
      toast({ tone: 'bad', message: `The weeks before the reading could not be read — ${err.message}`, timeout: 10000 });
    }
    /* One calendar, however many sources the window is drawn from — the
       weeks before the editor from the workbook reading that had them, the
       rest from the editor or the reading — laid side by side on one set of
       rows (`mergeViews()`). It used to be a grid per source, one under the
       other, and "Everything" was a stack of calendars. */
    const merged = oneView(parts, today, la.calendarWeeks, la.calendarStart);
    const p6 = await p6Of(parts.length === 1 ? parts[0].view : merged);
    if (turnNo !== drawing) return;
    clear(body);
    const onlyMine = Boolean(isMe && la.onlyMine);
    /* One row pinned from the cancellation log is drawn whether or not it
       has anything scheduled — red is a cancellation, not a shift. */
    const pin = la.calendarRow;
    const shown = pinnedTo(drawn(merged, la.calendarFilter, la.showQuietRows || Boolean(pin), la.showResources,
      onlyMine ? isMe : null, p6?.names), pin);
    drawPager(shown.days);
    if (pin) {
      body.appendChild(el('div', { class: 'la-pinned', role: 'status' }, [
        el('span', { text: `Showing one row, from the cancellation log: ${pin.label}` }),
        el('button', {
          class: 'cx-btn mini ghost', type: 'button', text: 'Show every row',
          onClick: () => { la.calendarRow = null; draw(); },
        }),
      ]));
    }
    clear(strip);
    strip.appendChild(legendStrip(legend, [...new Set(parts.flatMap((part) => part.view.unknown || []))], paintOn(shown)));
    if (onlyMine && !shown.activities.length) {
      body.appendChild(emptyState({
        iconName: 'calendar',
        title: 'You are not on anything in these weeks',
        message: 'No names row on the look-ahead puts you on a day in the weeks on screen. Widen the window, or see the whole sheet.',
        action: { label: 'Show every row', onClick: () => { la.onlyMine = false; mine.querySelector('input').checked = false; draw(); } },
      }));
      return;
    }
    if (pin && shown.days.length && !shown.activities.length) {
      body.appendChild(emptyState({
        iconName: 'calendar',
        title: 'That row is not on the look-ahead for these weeks',
        message: 'Nothing the calendar holds for the weeks on screen has the row this cancellation was '
          + 'logged against — it may have been taken off the sheet since. Page a week either way, or '
          + 'show every row.',
        action: { label: 'Show every row', onClick: () => { la.calendarRow = null; draw(); } },
      }));
      return;
    }
    if (!shown.days.length) {
      body.appendChild(emptyState({
        iconName: 'calendar',
        title: 'Nothing on the look-ahead in these weeks',
        message: pin
          ? 'The look-ahead holds nothing for the weeks this cancellation was logged in — no reading '
            + 'or edit kept them.'
          : 'The look-ahead says nothing for the weeks on screen.',
        action: { label: 'Back to this week', onClick: () => { la.calendarStart = null; la.calendarRow = null; draw(); } },
      }));
      return;
    }
    /* Said whenever the weeks on screen were not drawn from the newest
       reading: a reading is evidence of what the look-ahead said that day;
       the editor is what it says now; an older reading is what it said then.
       A line per source, above the one grid, where the grid marks the day
       each hands over to the next. */
    /* Neighbouring stretches of the look-ahead as written are one source, and one line. */
    const sources = parts.reduce((out, part) => {
      const last = out[out.length - 1];
      if (last && last.kind === 'written' && part.kind === 'written') out[out.length - 1] = { ...last, to: part.to };
      else out.push(part);
      return out;
    }, []);
    for (const part of sources) {
      const note = partNote(part, parts.length);
      if (note) body.appendChild(el('p', { class: `rc-hint ${part.kind === 'reading' ? 'la-reading-note' : 'la-written-note'}`, text: note }));
    }
    const only = parts.length === 1 ? parts[0] : null;
    body.appendChild(grid_(shown, today, isMe,
      only ? (only.kind === 'written' ? null : only.view === view ? snapshot.id : only.snapshotId ?? null) : null, notes, p6));
  };
  // Redraw the rows only, never the input: rebuilding the field under the
  // caret is the trap this project has already been bitten by three times.
  // Typing a filter is a different question from the one row "Show cells" pinned.
  search.addEventListener('input', () => { la.calendarFilter = search.value; la.calendarRow = null; draw(); });

  host.appendChild(strip);
  host.appendChild(el('div', {
    style: 'display:flex;align-items:center;gap:16px;margin-bottom:10px;flex-wrap:wrap',
  }, [
    el('div', { style: 'flex:1;min-width:240px;max-width:340px' }, [search]),
    dated ? pager : null,
    dated ? range : null,
    mine,
    quiet,
    resources,
    /* What chooses the view, not the view on screen: the dialog picks its own
       weeks, and handing it what is drawn would quietly cap the export at
       whatever the range buttons were last set to. */
    exportButton({ viewFor, p6Of, legendRows, today, sheetName: snapshot.sheet_name, isMe }),
    /* The editor's own export, offered here too: the same workbook in the 4WLA
       layout, built from what the editor holds rather than from this reading.
       Only once the look-ahead is written here — before that, the workbook in
       the folder is the file, and the editor's tables would be an old copy. */
    written ? el('button', {
      class: 'cx-btn mini primary la-export-xlsx',
      type: 'button',
      html: icon('download', { size: 12 }) + '<span>Export to Excel</span>',
      title: 'The look-ahead as an .xlsx in the 4WLA layout — the same export as in Edit.',
      onClick: () => openExcelExport(),
    }) : null,
  ].filter(Boolean)));
  host.appendChild(body);
  await draw();
}

function pagerButton(name, label, disabled, onClick) {
  return el('button', {
    class: 'cx-btn mini ghost icon', type: 'button', 'aria-label': label, title: label,
    html: icon(name, { size: 14 }), disabled, onClick,
  });
}

/** The first and last dated day a reading covers, or nulls where its dates could not be read. */
function readingSpan(view) {
  const dates = view.days.filter((d) => d.date).map((d) => d.date);
  return { first: dates[0] || null, last: dates[dates.length - 1] || null };
}

/**
 * What the calendar can page back through besides the newest reading: the days
 * written here (`laCellSpan()`), and each week the workbook's readings hold
 * with the newest reading that has it (`rc.workbookWeeks()`). Nothing for a
 * look-ahead still read from the workbook, whose reading is the whole sheet;
 * and an older database, without the list of workbook weeks, simply pages no
 * further back than the editor.
 */
async function historyOf(written) {
  if (!written) return { span: { first: null, last: null }, weeks: [] };
  const [span, weeks] = await Promise.all([
    rc.laCellSpan().catch(() => ({ first: null, last: null })),
    rc.workbookWeeks().catch(() => []),
  ]);
  return {
    span,
    weeks: weeks.map((w) => ({ ...w, week_start: String(w.week_start).slice(0, 10) }))
      .sort((a, b) => a.week_start.localeCompare(b.week_start)),
  };
}

/**
 * How far the calendar can page: the reading's own days, and — once the
 * look-ahead is written here — from the first week a workbook reading or the
 * editor holds to the last day written.
 */
function reachOf(reading, history) {
  let { first, last } = reading;
  const earliest = [history.weeks[0]?.week_start, history.span.first].filter(Boolean).sort()[0];
  if (earliest && (!first || earliest < first)) first = earliest;
  if (history.span.last && (!last || history.span.last > last)) last = history.span.last;
  return { first, last };
}

/**
 * Where each stretch of a window is drawn from.
 *
 * The newest reading, wherever it covers every day of the window — the four
 * weeks from today, nearly always. Otherwise the window is cut where the
 * editor starts (the Monday of the first day written here): from there on it
 * is the look-ahead as written (`writtenView()`), as one stretch so one grid
 * never mixes the two; before it, each week comes from the newest workbook
 * reading that has it (`rc.workbookWeeks()`), the rule the week plan and the
 * master export read the history by, and weeks that share a reading are one
 * stretch. Those weeks were never in the editor: it was started from the
 * workbook from the week it was adopted, and calendar paging used to stop
 * there, with Edit showing the weeks before it empty.
 *
 * `parts(weeks, start)` answers `[{ view, from, to, kind, snapshotId, takenAt }]`
 * in date order, `kind` one of 'latest', 'written' or 'reading'. Called as a
 * function it answers the one view an export draws — every source of the
 * window as one calendar (`oneView()`), as the screen draws it. Each view is
 * read once per drawing of the tab; a newer reading redraws the tab afresh.
 */
function viewChooser({ view, reading, reach, written, legendRows, today, history = { span: {}, weeks: [] } }) {
  const made = new Map();
  const once = (key, fn) => {
    if (!made.has(key)) made.set(key, fn().catch((err) => { made.delete(key); throw err; }));
    return made.get(key);
  };
  const writtenFor = (from, to) => once(`w|${from}|${to}`, () => writtenView(from, to, legendRows));
  const readingFor = (id) => once(`r|${id}`, async () => {
    const snap = await rc.snapshotById(id);
    if (!snap?.grid?.rows?.length) throw new Error('that reading has no grid to draw');
    return viewOfSnapshot(snap, legendRows);
  });
  const editorStart = history.span?.first ? mondayOf(history.span.first) : null;
  const byWeek = new Map((history.weeks || []).map((w) => [w.week_start, w]));

  const bounds = (weeks, start) => {
    if (!weeks) {
      if (!reach.first) return null;
      const firstMonday = mondayOf(reach.first);
      const lastSunday = addDaysISO(mondayOf(reach.last), 6);
      return {
        from: reading.first && reading.first < firstMonday ? reading.first : firstMonday,
        to: reading.last && reading.last > lastSunday ? reading.last : lastSunday,
      };
    }
    const from = start || mondayOf(today);
    return { from, to: addDaysISO(from, weeks * 7 - 1) };
  };

  const parts = async (weeks, start) => {
    if (!written || !reading.first) return [{ view, from: null, to: null, kind: 'latest' }];
    const span = bounds(weeks, start);
    if (!span) return [{ view, from: null, to: null, kind: 'latest' }];
    const { from, to } = span;
    if (from >= reading.first && to <= reading.last) return [{ view, from: null, to: null, kind: 'latest' }];
    const out = [];
    const cut = editorStart && from < editorStart && byWeek.size ? editorStart : null;
    if (cut) {
      const before = to < cut ? to : addDaysISO(cut, -1);
      const runs = [];
      for (let w = mondayOf(from); w <= before; w = addDaysISO(w, 7)) {
        const hit = byWeek.get(w);
        const lo = w < from ? from : w;
        const hi = addDaysISO(w, 6) > before ? before : addDaysISO(w, 6);
        const last = runs[runs.length - 1];
        if (last && last.snapshotId === (hit?.snapshot_id || null)) last.to = hi;
        else runs.push({ snapshotId: hit?.snapshot_id || null, takenAt: hit?.taken_at || null, from: lo, to: hi });
      }
      for (const run of runs) {
        out.push(run.snapshotId
          ? { ...run, kind: 'reading', view: await readingFor(run.snapshotId) }
          // A week no reading of the workbook has: the editor's answer, which is that nothing was written.
          : { ...run, kind: 'written', view: await writtenFor(run.from, run.to) });
      }
    }
    const after = cut ? cut : from;
    if (after <= to) out.push({ kind: 'written', from: after, to, view: await writtenFor(after, to) });
    return out;
  };

  const choose = async (weeks, start) => {
    const all = await parts(weeks, start);
    if (all.length === 1 && all[0].kind === 'latest') return view;
    // The one calendar the screen draws for that window, never one of its sources.
    return oneView(all, today, weeks, start);
  };
  choose.parts = parts;
  return choose;
}

/**
 * A window's stretches as the one calendar they are drawn as: each narrowed to
 * its own days, then laid side by side on one set of rows (`mergeViews()`).
 * A window the newest reading covers alone is that reading, narrowed.
 */
function oneView(parts, today, weeks, start) {
  return mergeViews(parts.map((part) => ({
    view: windowed(part.view, today, weeks, start, part),
    snapshotId: part.kind === 'reading' ? part.snapshotId ?? null : null,
  })));
}

/** What a stretch of the calendar says about where it came from, or nothing for the newest reading on its own. */
function partNote(part, count) {
  const span = part.from && part.to ? `${dayLabel(part.from, 'medium')} – ${dayLabel(part.to, 'medium')}: ` : '';
  if (part.kind === 'reading') {
    const when = part.takenAt ? new Date(part.takenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'an earlier date';
    return `${span}from the workbook as it was read on ${when} — these weeks come from before the look-ahead was written here.`;
  }
  if (part.kind === 'written') {
    return `${count > 1 ? span : ''}These weeks are drawn from the look-ahead as it is written now, not from a reading taken at the time.`;
  }
  return '';
}

/** Which of a view's activity columns is the Activity ID: by its heading, as the sheet writes it. */
function activityIdColumn(view) {
  return (view.headings || []).findIndex((h) => /activity\s*id/i.test(String(h || '')));
}

/**
 * The P6 names for the activities a view names, and the reasons a row may give
 * instead — read once per view, and only the IDs on it, never the whole list.
 * Null where the sheet has no Activity ID column. A database without the P6
 * tables simply has no names to give.
 */
function p6Chooser() {
  const seen = new WeakMap();
  return (view) => {
    if (!seen.has(view)) {
      seen.set(view, (async () => {
        const col = activityIdColumn(view);
        if (col < 0) return null;
        const ids = [...new Set(view.activities.filter((a) => !a.heading && !a.absence)
          .map((a) => String(a.meta[col] || '').trim()).filter(Boolean))];
        const [entries, flags] = await Promise.all([
          ids.length ? rc.p6ActivitiesByIds(ids).catch(() => []) : [],
          rc.listP6Flags({ includeRetired: true }).catch(() => []),
        ]);
        return { col, index: p6Index(entries, flags), names: new Map(entries.map((e) => [e.activity_id, e.name])) };
      })());
    }
    return seen.get(view);
  };
}

/**
 * Narrow the axis to the weeks worth looking at.
 *
 * The past is dropped rather than scrolled past: this sheet carries a quarter
 * of finished weeks to the left of today, and a look-ahead that opens on
 * March is not a look-ahead. The window pages back and forward a week at a
 * time from this one (`start`, a Monday), and "Everything" is one click away
 * for the times the question really is what happened.
 *
 * If the dates could not be resolved — the weekday letters did not agree —
 * nothing is narrowed, because narrowing on a reading that might be a year out
 * would hide real work. Same if this week's window turns out to be empty: a
 * calendar showing nothing is not an answer. A window somebody paged to is
 * shown as it is, empty or not — falling back to the whole sheet there would
 * look like the buttons doing something else.
 */
function windowed(view, today, weeks = la.calendarWeeks, start = la.calendarStart, part = null) {
  const narrowed = (() => {
    // A stretch of a window drawn from one source: exactly its own days.
    if (part?.from && part?.to) return view.days.filter((d) => d.date && d.date >= part.from && d.date <= part.to);
    if (!weeks || !view.days.some((d) => d.date)) return view.days;
    const from = start || mondayOf(today);
    const to = addDaysISO(from, weeks * 7 - 1);
    const days = view.days.filter((d) => !d.date || (d.date >= from && d.date <= to));
    return days.length || start ? days : view.days;
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
function drawn(view, filter, showQuiet, withResources = la.showResources, isMe = null, p6Names = null) {
  const terms = String(filter || '').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
  let rows = view.activities;

  /* Only my rows: every activity whose names row names me on a day on
     screen, with the sections above it — see `rowsNaming()`. It replaces the
     "nothing scheduled" rule rather than adding to it: a row that names you
     is yours whether or not anybody painted it yet. */
  if (isMe) {
    rows = rowsNaming(rows, isMe, new Set(view.days.map((d) => d.col)));
  } else if (!showQuiet) {
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
         this box, and it would find nothing if only the activity line counted.
         So is the P6 name of the activity a row names, which the row itself
         may word differently. */
      const hay = [...a.meta, ...(a.resource?.marks || []).map((m) => m.value),
        ...(a.absence ? a.marks.map((m) => m.value) : []),
        ...(p6Names ? a.meta.map((v) => p6Names.get(String(v || '').trim()) || '') : [])]
        .join(' ').toLowerCase();
      return terms.some((t) => hay.includes(t));
    });
  }

  return { ...view, activities: rows };
}

/**
 * Only the row "Show cells" pinned (`la.calendarRow`): by the editor's id where
 * this part of the window carries ids, else by the words the log stored for it
 * — the row's cells joined with " · ", exactly as `rowsFrom()` wrote them.
 */
function pinnedTo(view, row) {
  if (!row) return view;
  const byId = row.id && view.activities.some((a) => a.id === row.id);
  const words = (a) => a.meta.filter(Boolean).join(' · ');
  return {
    ...view,
    activities: view.activities.filter((a) => !a.absence && (byId ? a.id === row.id : words(a) === row.label)),
  };
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

/**
 * Stretch the grid's frame down to the bottom of whatever scrolls it, so the
 * table is as long as the screen allows. Measured, because only the browser
 * knows how much sits above it; re-measured when that container resizes.
 */
function fitToBottom(wrap) {
  const scroller = () => {
    for (let node = wrap.parentElement; node; node = node.parentElement) {
      const { overflowY } = getComputedStyle(node);
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.clientHeight) return node;
    }
    return document.scrollingElement || document.documentElement;
  };
  let observer = null;
  const fit = () => {
    if (!wrap.isConnected) { observer?.disconnect(); return; }
    const box = scroller();
    const boxTop = box === document.scrollingElement ? 0 : box.getBoundingClientRect().top;
    const boxHeight = box === document.scrollingElement ? window.innerHeight : box.clientHeight;
    const top = wrap.getBoundingClientRect().top - boxTop + box.scrollTop;
    const pad = parseFloat(getComputedStyle(box).paddingBottom) || 0;
    wrap.style.maxHeight = `${Math.max(240, Math.floor(boxHeight - top - pad - 4))}px`;
  };
  requestAnimationFrame(() => {
    fit();
    if (typeof ResizeObserver === 'function' && wrap.isConnected) {
      observer = new ResizeObserver(fit);
      observer.observe(scroller());
    }
  });
}

/**
 * The grid itself. Split out so the filter can redraw it without the header.
 * `p6` (from `p6Chooser()`) names the P6 activity an Activity ID points at,
 * on its hover, and marks a reason given instead.
 */
function grid_(view, today, isMe = null, snapshotId = null, notes = [], p6 = null) {
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
    // The first day drawn from another source than the day before it (`mergeViews()`).
    d.sourceStart ? 'la-source-start' : '',
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
  const line = (meta, marks, { klass = '', what = '', resource = false, open = null, rowId = null }) => {
    const label = meta.filter(Boolean).join(' · ');
    // Why it was cancelled, as logged — for the day, or for one struck-out code.
    const reason = (date, codes = '') => (date && !resource
      ? cancellationReasonText(cancellationNoteFor(notes, { label, meta, day: date, codes, rowId }))
      : '');
    return el('tr', {
    class: klass,
  }, [
    ...meta.map((value, i) => {
      /* The Activity ID says which P6 activity it is, or why there is none.
         An ID the list does not have is left saying only itself: this view
         reads the IDs on screen, not the whole list, so it cannot tell a typo
         from an import nobody has run. */
      const status = p6 && open && i === p6.col ? p6Status(value, p6.index) : null;
      const said = status && (status.kind === 'linked' || status.kind === 'flagged') ? p6Words(value, status) : value;
      return el('td', {
        class: 'la-meta' + (i === meta.length - 1 ? ' la-last' : '') + (open ? ' la-openable' : '')
          + (status?.kind === 'flagged' ? ' la-p6-flag' : ''),
        text: value,
        title: open ? `${said}${said ? ' — ' : ''}open the whole activity` : value,
        // The first column is the one keyboard stop for the row.
        tabindex: open && i === 0 ? '0' : null,
        role: open && i === 0 ? 'button' : null,
        onClick: open || null,
        onKeydown: open && i === 0 ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : null,
      });
    }),
    ...view.days.map((d) => {
      const mark = marks.get(d.col);
      const classes = ['la-day'];
      if (resource) classes.push('la-resource');
      if (d.weekend) classes.push('la-weekend');
      if (d.date && d.date === today) classes.push('la-today');
      if (d.sourceStart) classes.push('la-source-start');
      // Your own name, wherever it is written — the day you are on.
      const yours = resource && isMe && mark?.value && resourceNames(mark.value).some(isMe);
      if (yours) classes.push('la-mine');
      if (mark?.hex) {
        classes.push('la-painted');
        if (isDark(mark.hex)) classes.push('la-dark');
        if (!mark.meaning) classes.push('la-unmapped');
        // Struck through as well as red: a cancellation must not be a fact
        // only somebody who can tell red from green can read. Never on a
        // Resource row — red there marks names, not the work.
        else if (!resource && isCancelMeaning(mark.meaning)) classes.push('la-cancel');
      }
      return el('td', {
        class: classes.join(' '),
        style: mark?.hex ? `background-color:#${mark.hex}` : '',
        title: [what, d.date || `${d.month} ${d.day} ${d.weekday}`.trim(),
          mark?.meaning || (mark?.hex ? `unmapped colour #${mark.hex}` : null), mark?.value,
          classes.includes('la-cancel') ? reason(d.date) || null : null,
          yours ? 'you are on this day' : null]
          .filter(Boolean).join(' · '),
      }, resource ? [mark?.value || '']
        : codeNodes(mark?.value || '', 'la-code-cancelled', (code) => reason(d.date, code)));
    }),
  ]);
  };

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
      rowId: a.id || null,
      open: a.heading || a.absence ? null
        : () => openActivity({
          row: { raw_label: a.meta.filter(Boolean).join(' · '), snapshot_id: a.snapshotId !== undefined ? a.snapshotId : snapshotId, sheet_row: a.row },
        }),
    }));
    /* The Resource row, drawn under the activity it belongs to and never on its
       own — it has no location or hours of its own, only the ones it inherited,
       so away from that line it would be a row of names about nothing. */
    if (a.resource && la.showResources) {
      tbody.appendChild(line(a.resource.meta, byCol(a.resource.marks), {
        klass: 'la-resource-row',
        what: what ? `${what} — who is on it` : 'who is on it',
        resource: true,
      }));
    }
  }

  const table_ = el('table', { class: 'rc-table la-grid' }, [head, tbody]);
  const wrap = el('div', { class: 'rc-scroll', style: 'max-height:60vh' }, [table_]);
  fitToBottom(wrap);

  /* The frozen columns have to be told where they start, and only the browser
     knows how wide the content made them. Measured once the table is in the
     document, on the next frame — and again whenever it changes size: a font
     arriving, a zoom or a heading wrapping moves the columns, and a stale
     offset lets one frozen column slide over the next, or a header row under
     another. */
  const freeze = () => {
    freezeHead(head);
    freezeSide(table_);
  };
  requestAnimationFrame(freeze);
  if (typeof ResizeObserver === 'function') new ResizeObserver(freeze).observe(table_);

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
 * Pin the activity columns at the widths the content made them. Every cell in
 * a column, heading included — the heading row has one cell per column rather
 * than one spanning the lot, so it has to be frozen at the same offsets or the
 * names slide out from over their values. The two rows that still span
 * everything are pinned at zero, which is where a cell covering all of them
 * starts. A table not laid out yet (hidden, or not in the document) measures
 * nothing and is left until it is.
 */
function freezeSide(table) {
  const firstRow = table.querySelector('tbody tr');
  if (!firstRow) return;
  const widths = [...firstRow.querySelectorAll('.la-meta')].map((td) => td.getBoundingClientRect().width);
  if (!widths.some((w) => w > 0)) return;
  let left = 0;
  widths.forEach((width, i) => {
    for (const cell of table.querySelectorAll(`.la-meta:nth-child(${i + 1})`)) {
      if (!cell.classList.contains('la-meta-all')) cell.style.left = `${left}px`;
    }
    left += width;
  });
  for (const th of table.querySelectorAll('thead .la-meta-all')) th.style.left = '0px';
  // The month label pins just past the frozen columns.
  table.style.setProperty('--la-meta-w', `${left}px`);
}

/**
 * Pin the three header rows — month, day number, weekday — one under the other.
 *
 * Every header cell was `position: sticky; top: 0`, so all three rows pinned to
 * the same line and scrolling down stacked them on top of each other: the
 * weekday letters covered the day numbers and the month, and the one thing a
 * reader scrolling a hundred rows needs — which date this column is — was gone.
 * Each row is now pinned at the height of the rows above it, measured, because
 * only the browser knows how tall the content made them.
 */
function freezeHead(head) {
  let top = 0;
  for (const tr of head.rows) {
    for (const cell of tr.cells) cell.style.top = `${top}px`;
    top += tr.getBoundingClientRect().height;
  }
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
        onClick: () => { la.section = 'legend'; notifyChanged('legend'); },
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
function exportDialog({ viewFor, p6Of, legendRows, today, sheetName, isMe = null }) {
  const weeks = selectInput({
    value: String(la.calendarWeeks || 0),
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
  const onlyMine = Boolean(isMe && la.onlyMine);
  const title = textInput({ value: onlyMine ? `${rc.me()?.name || 'My'} — look-ahead` : `${sheetName || '4WLA'} — look-ahead` });
  const withMine = isMe
    ? checkbox({ label: 'Only my rows', checked: onlyMine })
    : null;

  const withResources = checkbox({ label: 'Resource names, and who is away', checked: la.showResources });
  const withQuiet = checkbox({ label: 'Rows with nothing scheduled', checked: la.showQuietRows });
  const withLegend = checkbox({ label: 'The key for the colours on it', checked: true });
  const withFilter = checkbox({
    label: la.calendarFilter ? `Only rows matching "${la.calendarFilter}"` : 'Apply the filter on screen',
    checked: Boolean(la.calendarFilter),
  });

  const on = (box) => box.querySelector('input').checked;
  const readout = el('p', { class: 'rc-hint' });

  /* What is actually going to be drawn, from the same functions the screen
     draws through — the same view for the same weeks, from the Monday on
     screen — so the export cannot show a different set of rows from the grid
     it was started from. */
  const chosen = async () => {
    const count = Number(weeks.value) || 0;
    const source = await viewFor(count, la.calendarStart);
    const p6 = await p6Of(source);
    const narrowed = windowed(source, today, count);
    const rows = drawn(narrowed, on(withFilter) ? la.calendarFilter : '', on(withQuiet), on(withResources),
      withMine && on(withMine) ? isMe : null, p6?.names);
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
          count ? `${count} weeks from ${dayLabel(la.calendarStart || mondayOf(today), 'medium')}` : 'whole sheet',
        ].join('  ·  '),
      },
    };
  };

  let asked = 0;
  const refresh = async () => {
    const mine = ++asked;
    let picked;
    try {
      picked = await chosen();
    } catch (err) {
      readout.className = 'rc-hint rc-warn';
      readout.textContent = `Those weeks could not be read — ${err.message}`;
      return;
    }
    if (mine !== asked) return;
    const { view: shown, opts } = picked;
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
  for (const box of [withResources, withQuiet, withLegend, withFilter, withMine].filter(Boolean)) {
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
      withMine,
      withResources,
      withQuiet,
      withLegend,
      la.calendarFilter ? withFilter : null,
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
      const { view: shown, opts } = await chosen();
      if (!shown.activities.length) throw new Error('There is nothing to draw with those choices.');
      const blob = calendarPdf(shown, opts);
      const whose = withMine && on(withMine) ? `-${foldName(rc.me()?.name || 'mine') || 'mine'}` : '';
      saveFile(`lookahead${whose}-${today}.pdf`, blob, 'application/pdf', 'Look-ahead');
    },
  });
}

/**
 * The 4WLA as a PDF and a PNG, with nobody at the screen — what Export to
 * Excel's schedule files as `exports/4WLA_Latest.pdf` and `.png`
 * (`ui/rc_la_schedule.js`), on the schedule or when Export now is pressed.
 *
 * It is the Export PDF dialog with its defaults, never the screen's state:
 * four weeks from this week's Monday, every row with work in them (none
 * filtered, none "only mine"), the names and who is away, the key. Drawn
 * through the same functions — the same view for the same weeks — so a
 * scheduled file and one exported by hand never disagree, and the PDF (one A3
 * landscape page) and the PNG (the same drawing at its own size) are made from
 * the same rows. Answers `{ pdf, png }`, each `{ name, bytes }` or null — null
 * when it was not asked for or there is nothing to draw.
 */
export async function lookaheadSheetsNow({ pdf = true, png = true, weeks = 4, today = todayISO() } = {}) {
  const none = { pdf: null, png: null };
  if (!pdf && !png) return none;
  const [snapshot, legendRows, sourceSetting] = await Promise.all([rc.latestSnapshot(), rc.listLegend(), lookaheadSource()]);
  if (!snapshot?.grid?.rows?.length) return none;
  const view = parsedView(snapshot, legendRows);
  if (!view.days.length) return none;
  const written = sourceSetting === EDITOR_SOURCE;
  const reading = readingSpan(view);
  const history = await historyOf(written);
  const viewFor = viewChooser({ view, reading, reach: reachOf(reading, history), written, legendRows, today, history });
  const start = mondayOf(today);
  const source = await viewFor(weeks, start);
  const p6 = await p6Chooser()(source);
  const rows = drawn(windowed(source, today, weeks, start), '', false, true, null, p6?.names);
  if (!rows.activities.length) return none;
  const sheet = snapshot.sheet_name || '4WLA';
  const opts = {
    showResources: true,
    showAway: true,
    showLegend: true,
    legend: legendRows.map((r) => ({ argb: r.argb, meaning: r.meaning }))
      .filter((e) => paintOn(rows).has(String(e.argb).toUpperCase())),
    today,
    pageSize: 'a3',
    orientation: 'landscape',
    title: `${sheet} — look-ahead`,
    subtitle: `${sheet}  ·  ${weeks} weeks from ${dayLabel(start, 'medium')}`,
  };
  const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const out = { ...none };
  if (pdf) out.pdf = { name: `${LATEST}.pdf`, bytes: await bytesOf(calendarPdf(rows, opts)) };
  if (png) {
    /* Twice its size in points, so it stays sharp opened on a phone or
       pasted into an email — and no more than a screen's worth past that. */
    const picture = calendarSvg(rows, opts);
    const scale = Math.max(1.5, Math.min(3, 3200 / picture.width));
    const blob = await svgToRaster(picture.svg, { scale, type: 'image/png', width: picture.width, height: picture.height });
    out.png = { name: `${LATEST}.png`, bytes: await bytesOf(blob) };
  }
  return out;
}

// The schedule in Export to Excel files them; that module is imported here, so it is handed over.
provide4wla({ sheets: lookaheadSheetsNow });

function exportButton(context) {
  return el('button', {
    class: 'cx-btn mini primary la-export-pdf',
    type: 'button',
    html: icon('download', { size: 12 }) + '<span>Export PDF</span>',
    title: 'Draw this calendar on one page — weeks, names and paper size are all choices.',
    onClick: () => exportDialog(context),
  });
}

