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
import { keyRows, classify, relinkCandidates, countable, describe, readGrid } from '../core/lookahead.js';
import { icon } from './icons.js';
import { selectInput, textInput, toast, badge, emptyState, field, checkbox } from './components.js';
import { notifyChanged, byId, dayLabel, todayISO, formModal } from './rc_util.js';

/** Where the workbook lives, relative to the folder the plan is in. */
const LOOKAHEAD_DIR = 'lookahead';
const SAR_INBOX = 'sars/inbox';

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

    run.outcome = 'snapshot';
    run.note = grid.unknown.length ? `${grid.unknown.length} colour(s) not in the legend` : null;
    await rc.addIngestRun(run);

    if (!silent && grid.unknown.length) {
      toast({
        tone: 'warn',
        message: `${grid.unknown.length} colour(s) are not in the legend and were left unmapped — `
          + 'nothing was guessed.',
      });
    }

    notifyChanged('lookahead');
    return { changed: true, snapshot, grid };
  } catch (err) {
    if (run.outcome === 'error') {
      run.note = err.message;
      await rc.addIngestRun(run).catch(() => {});
    }
    throw err;
  }
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

  const scheduled = view.activities.filter((a) => a.highlighted).length;
  const headings = view.activities.filter((a) => a.heading).length;
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: `${scheduled} of ${view.activities.length} activities have something scheduled, across `
      + `${view.days.length} days in the workbook, from the snapshot taken `
      + `${snapshot.taken_at ? snapshot.taken_at.slice(0, 16).replace('T', ' ') : 'earlier'}`
      + `${headings ? `, under ${headings} section heading(s)` : ''}. `
      + 'The rest are carried in the workbook for reference with no shift against them, and are '
      + 'hidden unless you ask for them. Only the rows and columns that were visible in the '
      + 'workbook are here at all — a hidden row is not work anybody was being asked to look at.',
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
    text: 'A row counts as scheduled when a day carries paint the legend does not call shading. '
      + 'A colour nobody has mapped counts too: until somebody says what it is, it might be '
      + 'work, and hiding it would bury exactly the rows that need looking at.',
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
  if (!calendarWeeks || !view.days.some((d) => d.date)) return view;

  const ms = new Date(`${today}T00:00:00Z`).getTime();
  const monday = ms - ((new Date(ms).getUTCDay() + 6) % 7) * 86400000;
  const from = new Date(monday).toISOString().slice(0, 10);
  const to = new Date(monday + (calendarWeeks * 7 - 1) * 86400000).toISOString().slice(0, 10);

  const days = view.days.filter((d) => !d.date || (d.date >= from && d.date <= to));
  if (!days.length) return view;
  return { ...view, days };
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
    strip.append(el('button', {
      class: 'cx-btn mini ghost',
      text: `${unknown.length} colour(s) unmapped`,
      title: 'Nothing was guessed. They are drawn with a hatch until somebody says what they mean.',
      onClick: () => { section = 'legend'; notifyChanged('legend'); },
    }));
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
      text: 'Nothing here was guessed, and that is deliberate. Two of these are usually near '
        + 'misses — a blue a shade off the legend blue, picked from Excel’s recent colours — '
        + 'and guessing would classify a shift wrongly with nothing on screen to show it '
        + 'happened. On the calendar they are drawn with a hatch until somebody says.',
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
    el('td', {}, e.kind === 'cancellation' ? [
      el('button', {
        class: 'cx-btn mini ghost',
        text: 'Whose?',
        title: 'Red says a shift was cancelled. It cannot say by whom.',
        onClick: () => attribute(e, parties),
      }),
    ] : []),
  ]));

  host.appendChild(table(['Week', 'Kind', 'What', 'Seen', ''], rows));

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
  const [sars, locations, without, unlinked] = await Promise.all([
    rc.listSars(),
    rc.listLocations(),
    rc.listRowsWithoutSar(),
    rc.listSarsWithoutRows(),
  ]);
  const locs = byId(locations);

  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'Site access requests' }),
    el('button', {
      class: 'cx-btn mini primary',
      html: icon('plus', { size: 12 }) + '<span>Record a SAR</span>',
      onClick: () => recordSar(locations),
    }),
  ]));

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
    host.appendChild(table(
      ['SAR', 'Rev', 'Location', 'Week', 'Hours'],
      sars.map((s) => el('tr', {}, [
        el('td', { text: s.sar_number }),
        el('td', { class: 'rc-num', text: String(s.revision) }),
        el('td', { text: locs.get(s.location_id)?.name || s.raw_location || '—' }),
        el('td', { text: s.week_start || '—' }),
        el('td', { class: 'rc-num', text: s.authorized_hours ?? '—' }),
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

function recordSar(locations) {
  const number = textInput({ placeholder: 'SAR-12345' });
  const location = selectInput({
    value: locations[0]?.id,
    options: locations.map((l) => ({ value: l.id, label: l.name })),
  });
  const week = el('input', { type: 'date', class: 'cx-input' });
  const hours = el('input', { type: 'number', class: 'cx-input', step: '0.5', min: '0' });

  formModal({
    title: 'Record a SAR',
    body: el('div', { class: 'cx-form' }, [
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Number' }), number]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Location' }), location]),
      el('div', { class: 'cx-field' }, [
        el('label', { class: 'cx-label', text: 'Week beginning' }), week,
        el('div', { class: 'cx-hint', text: 'The Monday, matching how the look-ahead is keyed.' }),
      ]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Authorised hours' }), hours]),
    ]),
    confirmLabel: 'Record',
    onConfirm: async () => {
      if (!number.value.trim()) throw new Error('A SAR number is needed.');
      await rc.addSar({
        sar_number: number.value.trim(),
        location_id: location.value || null,
        week_start: week.value || null,
        authorized_hours: hours.value ? Number(hours.value) : null,
      });
      notifyChanged('sars');
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
