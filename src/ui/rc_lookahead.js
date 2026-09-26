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
import { renderLegend } from './rc_la_legend.js';
import { renderChanges, renderSnapshots } from './rc_la_changes.js';
import { renderCancellations } from './rc_la_cancellations.js';
import { renderSars } from './rc_la_sars.js';

const SECTIONS = ['calendar', 'cancellations', 'changes', 'snapshots', 'legend', 'sars'];

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
  if (!sections.includes(la.section)) la.section = sections[0];

  const nav = el('div', { class: 'rc-tabs', style: 'margin:0 0 16px' });
  for (const id of sections) {
    nav.appendChild(el('button', {
      class: 'rc-tab',
      type: 'button',
      text: {
        calendar: 'Calendar', cancellations: 'Cancellations', changes: 'Changes', snapshots: 'Snapshots',
        legend: 'Legend', sars: 'Site access',
      }[id],
      'aria-pressed': String(id === la.section),
      onClick: () => { la.section = id; clear(root); render(root); },
    }));
  }
  if (sections.length > 1) root.appendChild(nav);

  const host = el('div');
  root.appendChild(host);

  if (la.section === 'calendar') await renderCalendar(host);
  else if (la.section === 'cancellations') await renderCancellations(host);
  else if (la.section === 'changes') await renderChanges(host);
  else if (la.section === 'snapshots') await renderSnapshots(host);
  else if (la.section === 'legend') await renderLegend(host);
  else await renderSars(host);
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

  const body = el('div');
  const draw = () => {
    clear(body);
    const shown = drawn(windowed(view, today), la.calendarFilter, la.showQuietRows);
    clear(strip);
    strip.appendChild(legendStrip(legend, grid.unknown, paintOn(shown)));
    body.appendChild(grid_(shown, today));
  };
  // Redraw the rows only, never the input: rebuilding the field under the
  // caret is the trap this project has already been bitten by three times.
  search.addEventListener('input', () => { la.calendarFilter = search.value; draw(); });

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
function windowed(view, today, weeks = la.calendarWeeks) {
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
function drawn(view, filter, showQuiet, withResources = la.showResources) {
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

  /* The frozen columns have to be told where they start, and only the browser
     knows how wide the content made them. Measured once the table is in the
     document, on the next frame. */
  requestAnimationFrame(() => {
    freezeHead(head);
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

  /* A header row can change height after the first frame — a font arriving, a
     heading wrapping — and a stale offset lets one row slide under another. */
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => freezeHead(head)).observe(head);

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
function exportDialog({ view, legendRows, today, sheetName }) {
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
  const title = textInput({ value: `${sheetName || '4WLA'} — look-ahead` });

  const withResources = checkbox({ label: 'Resource names, and who is away', checked: la.showResources });
  const withQuiet = checkbox({ label: 'Rows with nothing scheduled', checked: la.showQuietRows });
  const withLegend = checkbox({ label: 'The key for the colours on it', checked: true });
  const withFilter = checkbox({
    label: la.calendarFilter ? `Only rows matching "${la.calendarFilter}"` : 'Apply the filter on screen',
    checked: Boolean(la.calendarFilter),
  });

  const on = (box) => box.querySelector('input').checked;
  const readout = el('p', { class: 'rc-hint' });

  /* What is actually going to be drawn, from the same two functions the screen
     draws through — so the export cannot show a different set of rows from the
     grid it was started from. */
  const chosen = () => {
    const narrowed = windowed(view, today, Number(weeks.value) || 0);
    const rows = drawn(narrowed, on(withFilter) ? la.calendarFilter : '', on(withQuiet), on(withResources));
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

