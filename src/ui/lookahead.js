/**
 * The look-ahead, as suggestions for the timeline.
 *
 * The four-week look-ahead workbook, read straight from the file — the same
 * parser the resource calendar uses, and no calendar sign-in, no backend and
 * no network: the plan still has none of those. Each run of painted cells on
 * an activity becomes one suggestion in `doc.lookahead`, and nothing reaches
 * the timeline until somebody says so:
 *
 *   Place    a new bar on the run's dates, linked to it
 *   Link     an existing bar now stands for it too
 *   Follow   linked bars move onto the dates the latest read gives
 *   Dismiss  no — and the next import remembers the answer
 *
 * **Only cells painted in a colour the legend categorises as Work are read.**
 * A workbook shades its layout grey as well as painting its shifts, and a
 * suggestion is a proposal to commit dates to the plan — so Shading, a Section
 * band and a colour nobody has categorised at all suggest nothing
 * (`workOnlyLegend()`). That is deliberately stricter than the calendar, which
 * *draws* an unexplained colour as possible work so somebody notices it.
 *
 * The legend is the calendar's own (Calendar → Legend) whenever the calendar is
 * signed in: one answer to "is orange work", read and never written from here.
 * Only the colours are fetched — nothing about the plan goes the other way.
 * Where there is no calendar legend (local mode, a folder deployment, a desktop
 * build without calendar keys, or a calendar that has never mapped a colour)
 * the workbook's own key starts as Work and the dialog lets somebody categorise
 * the rest, kept with the plan in `doc.lookahead.colors`.
 *
 * Imports: util, events, dates, model, store, renderer, core/lookahead,
 *          io/lookahead, core/rc (the legend only), commands, icons,
 *          components.
 */

import { el, clear, debounce, fold } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import { fmtDate, fmtTimestamp, MS_DAY } from '../core/dates.js';
import {
  TYPES,
  lookaheadRegister,
  laLinkedIds,
  laPlaced,
  laPlacedIds,
  laVariance,
  statusOf,
} from '../core/model.js';
import * as store from '../core/store.js';
import * as renderer from '../timeline/renderer.js';
import { readGrid, marksOf, suggestionsFrom, reconcileSuggestions } from '../core/lookahead.js';
import {
  readZip, readSheets, parseSheet, applyLegend, inForce, workOnlyLegend, fileLegend,
} from '../io/lookahead.js';
import * as rc from '../core/rc.js';
import * as cmd from './commands.js';
import { icon } from './icons.js';
import {
  openModal,
  openPicker,
  field,
  textInput,
  selectInput,
  segmented,
  checkbox,
  emptyState,
  badge,
  chipStat,
  toast,
  confirmDialog,
  skeleton,
} from './components.js';

/* ══════════════════════════════════════════════════════════════════════════
   The pane
   ═══════════════════════════════════════════════════════════════════════ */

/** Filter state, kept between renders so a rebuild does not lose your place. */
const view = { text: '', show: 'suggested' };

/**
 * The rows container on screen. Searching redraws the rows only, never the
 * search box — the trap `ui/p6.js` documents, and for the same reason.
 */
let listEl = null;
let bulkEl = null;

export function paneLookahead(root) {
  const doc = store.getDoc();
  const register = lookaheadRegister(doc);
  const entries = Object.values(register.activities);

  root.appendChild(importBar(register));

  if (!entries.length) {
    root.appendChild(
      emptyState({
        iconName: 'calendar',
        title: 'No look-ahead imported',
        message: 'Import the four-week look-ahead workbook. Each run of painted cells becomes a suggestion, and nothing goes on the timeline until you place it.',
      })
    );
    return;
  }

  root.appendChild(summary(doc, entries));
  root.appendChild(controls());

  bulkEl = el('div', { style: { marginBottom: '8px' } });
  listEl = el('div', { class: 'cx-list' });
  root.append(bulkEl, listEl);
  renderRows();
}

function refilter() {
  if (!listEl || !listEl.isConnected) {
    refresh();
    return;
  }
  renderRows();
}

/* ── Import ────────────────────────────────────────────────────────────── */

function importBar(register) {
  const stamp = register.imported;
  const span = stamp?.windowStart != null
    ? `${fmtDate(stamp.windowStart, 'numeric')} → ${fmtDate(stamp.windowEnd - MS_DAY, 'numeric')}`
    : null;

  return el('div', { style: { marginBottom: '12px' } }, [
    el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '9px' } }, [
      el('button', {
        class: 'cx-btn mini primary',
        html: icon('upload', { size: 12 }) + '<span>Import look-ahead</span>',
        onClick: () => openLookaheadImport(),
      }),
      Object.keys(register.activities).length
        ? el('button', {
            class: 'cx-btn mini ghost',
            html: icon('trash', { size: 12 }) + '<span>Clear suggestions</span>',
            title: 'Forget every suggestion no bar is linked to',
            onClick: () => clearUnlinked(),
          })
        : null,
    ].filter(Boolean)),
    el('div', { class: 'p6-stamps' }, [
      el('div', { class: 'p6-stamp' }, [
        el('span', { class: 'p6-stamp-label', text: 'Last read' }),
        stamp
          ? el('span', { class: 'p6-stamp-value', text: fmtTimestamp(stamp.importedAt), title: [stamp.fileName, stamp.sheet].filter(Boolean).join(' · ') })
          : el('span', { class: 'p6-stamp-value none', text: 'not imported' }),
      ]),
      span
        ? el('div', { class: 'p6-stamp' }, [
            el('span', { class: 'p6-stamp-label', text: 'Window' }),
            el('span', { class: 'p6-stamp-value', text: span }),
          ])
        : null,
    ].filter(Boolean)),
  ]);
}

/**
 * Read a workbook: every visible sheet that has a calendar on it.
 *
 * The calendar finds its sheet by a name kept in its database; a file picked
 * off a disk has no such setting, so the sheet is *found* — the one whose
 * weekday row `readGrid()` recognises. Where several qualify the dialog asks,
 * starting from whichever was used last time.
 */
async function readWorkbook(file) {
  const buffer = await file.arrayBuffer();
  const names = readSheets(readZip(buffer))
    .filter((s) => s.state === 'visible' && s.zipPath)
    .map((s) => s.name);

  const sheets = [];
  for (const name of names) {
    try {
      const grid = parseSheet(buffer, name);
      if (readGrid(grid).days.length) sheets.push({ name, grid });
    } catch {
      // A sheet that will not parse is not the calendar; the others may be.
    }
  }
  return sheets;
}

/**
 * Read one sheet as suggestions, against a legend.
 *
 * `legend` is `[{ argb, meaning, role }]` — the calendar's register or the
 * workbook's own key — and only what it categorises as Work (`role ===
 * 'shift'`) is read as a painted day; every other colour on the sheet is added
 * as Shading by `workOnlyLegend()`.
 */
function derive(grid, legend, anchorISO) {
  const full = workOnlyLegend(grid, legend);
  const byColour = inForce(full);
  const categorised = inForce(legend);
  const parsed = readGrid(applyLegend(grid, full), { anchorISO });
  const dated = parsed.days.length > 0 && parsed.days.every((d) => d.date);

  // Every fill on a row that could be work, with how many cells carry it.
  const colours = new Map();
  for (const activity of parsed.activities) {
    if (activity.heading || activity.absence || !activity.named) continue;
    for (const mark of marksOf(activity)) {
      if (!mark.hex) continue;
      const hex = String(mark.hex).toUpperCase();
      const entry = byColour.get(hex);
      const seen = colours.get(hex) || {
        hex,
        count: 0,
        meaning: entry?.meaning || '',
        role: entry?.role || 'ignore',
        known: categorised.has(hex),
      };
      seen.count++;
      colours.set(hex, seen);
    }
  }

  const days = parsed.days;
  return {
    view: parsed,
    dated,
    runs: dated ? suggestionsFrom(parsed) : [],
    colours: [...colours.values()].sort((a, b) => b.count - a.count),
    windowStart: dated ? Date.parse(`${days[0].date}T00:00:00Z`) : null,
    windowEnd: dated ? Date.parse(`${days[days.length - 1].date}T00:00:00Z`) + MS_DAY : null,
  };
}

const CATEGORY = {
  shift: ['Work', 'info'],
  ignore: ['Shading', 'neutral'],
  divider: ['Section band', 'neutral'],
};

/**
 * The import dialog.
 *
 * Nothing is written until the reading has been shown — what it found, what is
 * new, what moved, and which bars on the timeline that affects. Placing and
 * moving bars are separate steps after it.
 */
export function openLookaheadImport() {
  let file = null;
  let sheets = [];
  let sheetName = '';
  let derived = null;
  const register = lookaheadRegister(store.getDoc());
  const choices = { ...register.colors };

  /* The calendar's legend, when there is one to read. Fetched once, and only
     the colours: `listLegend()` is a read, and nothing of the plan is sent. An
     empty register or a refusal leaves `calendarLegend` null, which is the
     workbook-key path below. */
  let calendarLegend = null;
  const legendRead = rc.isConfigured() && rc.isSignedIn()
    ? rc.listLegend()
        .then((rows) => { calendarLegend = rows?.length ? rows : null; })
        .catch(() => { calendarLegend = null; })
    : Promise.resolve();

  const status = el('div', { class: 'cx-hint', style: { minHeight: '18px' } });
  const preview = el('div');
  const input = el('input', {
    type: 'file',
    accept: '.xlsx,.xlsm',
    style: { display: 'none' },
    onChange: async (e) => {
      file = e.target.files?.[0];
      if (file) await read();
    },
  });

  const anchorISO = () => new Date(file?.lastModified || Date.now()).toISOString().slice(0, 10);

  async function read() {
    clear(preview);
    preview.appendChild(skeleton(2));
    status.textContent = `Reading ${file.name}…`;
    try {
      await legendRead;
      sheets = await readWorkbook(file);
      if (!sheets.length) throw new Error('none of its visible sheets has a row of weekday letters (M, Tu, W…) to read a calendar from.');
      const last = register.imported?.sheet;
      sheetName = sheets.some((s) => s.name === last) ? last : sheets[0].name;
      rederive();
    } catch (err) {
      sheets = [];
      derived = null;
      clear(preview);
      status.textContent = '';
      preview.appendChild(el('div', { class: 'cx-gate-msg bad', text: `Could not read the file: ${err.message}` }));
    }
  }

  function rederive() {
    const sheet = sheets.find((s) => s.name === sheetName);
    const legend = calendarLegend || (sheet ? fileLegend(sheet.grid, choices) : []);
    derived = sheet ? derive(sheet.grid, legend, anchorISO()) : null;
    renderPreview();
  }

  function renderPreview() {
    clear(preview);
    status.textContent = '';
    if (!derived) return;

    if (sheets.length > 1) {
      preview.appendChild(field('Sheet', selectInput({
        value: sheetName,
        options: sheets.map((s) => s.name),
        onChange: (v) => { sheetName = v; rederive(); },
      }), 'Every visible sheet with a calendar on it.'));
    }

    if (!derived.dated) {
      preview.appendChild(el('div', { class: 'cx-gate-msg bad', text:
        'The calendar on this sheet could not be dated: its weekday letters do not agree with any year near when the file was saved. Nothing would be placed at a guessed date, so there is nothing to import.' }));
      return;
    }

    const doc = store.getDoc();
    const linked = laPlacedIds(doc);
    const plan = reconcileSuggestions(lookaheadRegister(doc).activities, derived.runs, {
      linked, windowStart: derived.windowStart,
    });
    const affected = plan.moved.filter((m) => linked.has(m.id)).length;

    preview.append(
      el('div', { class: 'cx-chipstats', style: { marginBottom: '10px' } }, [
        chipStat('Runs', derived.runs.length, 'info'),
        chipStat('New', plan.added.length, plan.added.length ? 'good' : 'muted'),
        chipStat('Moved', plan.moved.length, plan.moved.length ? 'warn' : 'muted'),
        chipStat('Unchanged', plan.unchanged.length, 'muted'),
        plan.missing.length ? chipStat('Gone', plan.missing.length, 'bad') : null,
      ].filter(Boolean)),
      el('div', { class: 'cx-hint', text:
        `${fmtDate(derived.windowStart, 'medium')} → ${fmtDate(derived.windowEnd - MS_DAY, 'medium')}. One suggestion per run of cells painted in a Work colour on a described row.` })
    );

    if (affected) {
      preview.appendChild(el('div', { class: 'cx-gate-msg', style: { borderColor: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, transparent)', marginTop: '9px' },
        text: `${affected} of the runs that moved have bars on your timeline. After importing you can choose which of them follow.` }));
    }
    if (plan.missing.length) {
      preview.appendChild(el('div', { class: 'cx-gate-msg bad', style: { marginTop: '9px' },
        text: `${plan.missing.length} run(s) your bars are linked to are no longer on the sheet — they will be marked, not removed.` }));
    }

    preview.appendChild(colourList());

    const sample = derived.runs.slice(0, 4);
    if (sample.length) {
      preview.appendChild(el('div', { style: { marginTop: '11px' } }, [
        el('div', { class: 'cx-section-label', text: 'First runs' }),
        el('div', { class: 'cx-list' }, sample.map((run) =>
          el('div', { class: 'cx-listrow', style: { cursor: 'default' } }, [
            el('div', { class: 'lr-main' }, [
              el('div', { class: 'lr-title', text: run.title }),
              el('div', { class: 'lr-meta', text: runMeta(run) }),
            ]),
          ])
        )),
      ]));
    }
  }

  /**
   * What each fill on the calendar is categorised as, and so whether it is read.
   * Read-only against the calendar's legend — that is changed in Calendar →
   * Legend, where it changes the calendar too. Against the workbook's key the
   * categories are answered here and kept with the plan.
   */
  function colourList() {
    if (!derived.colours.length) return el('div');
    const fromCalendar = !!calendarLegend;
    return el('div', { style: { marginTop: '11px' } }, [
      el('div', { class: 'cx-section-label', text: 'Colours on the calendar' }),
      el('div', { class: 'cx-hint la-legend-source', style: { marginBottom: '6px' }, text: fromCalendar
        ? 'Categorised by the calendar’s Legend. Only Work colours are imported; change a colour’s category in Calendar → Legend and import again.'
        : 'No calendar legend is available, so the workbook’s own key starts as Work and every other colour as Shading. Only Work colours are imported; your categories are kept with the plan.' }),
      el('div', { class: 'cx-list' }, derived.colours.map((c) => {
        const [word, tone] = c.known ? (CATEGORY[c.role] || CATEGORY.shift) : ['Not in the legend', 'neutral'];
        return el('div', { class: 'cx-listrow la-colour', dataset: { hex: c.hex, role: c.role }, style: { cursor: 'default' } }, [
          fromCalendar
            ? null
            : checkbox({
                label: 'Work',
                checked: c.role === 'shift',
                onChange: (v) => {
                  choices[c.hex] = v ? 'shift' : 'ignore';
                  rederive();
                },
              }),
          el('span', { class: 'la-swatch', style: `background:#${c.hex.slice(-6)}` }),
          el('div', { class: 'lr-main' }, [
            el('div', { class: 'lr-title', text: c.meaning || (c.known ? word : 'Not in the legend') }),
            el('div', { class: 'lr-meta', text: `${c.count} cell${c.count === 1 ? '' : 's'} · #${c.hex.slice(-6)}${c.role === 'shift' ? '' : ' · not imported'}` }),
          ]),
          badge(word, tone),
        ].filter(Boolean));
      })),
    ]);
  }

  const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } }, [
    el('button', {
      class: 'cx-btn mini',
      style: { justifyContent: 'flex-start' },
      html: icon('upload', { size: 12 }) + '<span>Choose the look-ahead workbook…</span>',
      onClick: () => input.click(),
    }),
    input,
    status,
    preview,
  ]);

  return openModal({
    title: 'Import the look-ahead',
    subtitle: 'Read from the .xlsx itself. Suggestions only — nothing is placed or moved until you say so.',
    size: 'wide',
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Import',
        kind: 'primary',
        onClick: () => {
          if (!derived?.dated) {
            toast({ tone: 'warn', title: 'Nothing to import', message: 'Choose a look-ahead workbook first.' });
            return false;
          }
          // Categories answered here are kept with the plan. Against the
          // calendar's legend nothing is: that register is the answer, and a
          // second copy in the plan would be a second answer to "is it work".
          const colors = {};
          if (!calendarLegend) for (const c of derived.colours) colors[c.hex] = c.role === 'shift' ? 'shift' : 'ignore';

          const report = store.importLookahead(derived.runs, {
            fileName: file?.name || '',
            sheet: sheetName,
            colors,
            windowStart: derived.windowStart,
            windowEnd: derived.windowEnd,
          });
          if (!report) return false;
          renderer.requestRender();
          refresh();
          emit(EV.LOOKAHEAD_IMPORTED, { report });
          toast({
            tone: 'good',
            title: 'Look-ahead imported',
            message: `${derived.runs.length} runs · ${report.added.length} new · ${report.moved.length} moved.`,
          });
          const linked = laPlacedIds(store.getDoc());
          const follow = report.moved.filter((m) => linked.has(m.id));
          if (follow.length) setTimeout(() => openFollowDialog(follow), 350);
          return undefined;
        },
      },
    ],
  });
}

/**
 * After an import: which linked bars should follow the dates the sheet moved.
 * Defaulted to none — the plan is yours, and the sheet only proposes.
 */
function openFollowDialog(moved) {
  const chosen = new Set();
  const rows = el('div', { class: 'cx-list' });

  for (const item of moved) {
    const entry = store.getLookaheadActivity(item.id);
    if (!entry) continue;
    rows.appendChild(
      el('div', { class: 'cx-listrow', style: { cursor: 'default' } }, [
        checkbox({ label: '', checked: false, onChange: (v) => (v ? chosen.add(item.id) : chosen.delete(item.id)) }),
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: entry.title }),
          el('div', { class: 'lr-meta', text: runMeta(entry) }),
        ]),
        badge(shiftLabel(item.finishShift), item.finishShift > 0 ? 'bad' : 'good'),
      ])
    );
  }

  openModal({
    title: 'Follow the look-ahead?',
    subtitle: `${moved.length} run(s) your bars stand for moved on the sheet. Your dates are unchanged unless you say so.`,
    size: 'wide',
    body: rows,
    actions: [
      { label: 'Keep my dates' },
      {
        label: 'Apply to selected',
        kind: 'primary',
        onClick: () => {
          if (!chosen.size) return;
          store.adoptLookaheadDates([...chosen]);
          renderer.requestRender();
          refresh();
          toast({ tone: 'good', title: 'Dates updated', message: `Bars linked to ${chosen.size} run(s) moved onto the look-ahead.` });
        },
      },
    ],
  });
}

/* ── Summary and controls ──────────────────────────────────────────────── */

function stateOf(doc, entry) {
  if (laPlaced(doc, entry.id).length) return 'placed';
  if (entry.dismissed) return 'dismissed';
  if (entry.past || entry.missing) return 'gone';
  return 'suggested';
}

function summary(doc, entries) {
  const counts = { suggested: 0, placed: 0, dismissed: 0, gone: 0 };
  let moved = 0;
  for (const entry of entries) {
    const state = stateOf(doc, entry);
    counts[state]++;
    if (state === 'placed' && entry.previous) moved++;
  }
  return el('div', { class: 'cx-chipstats', style: { marginBottom: '11px' } }, [
    chipStat('Suggested', counts.suggested, counts.suggested ? 'info' : 'muted'),
    chipStat('On timeline', counts.placed, counts.placed ? 'good' : 'muted'),
    moved ? chipStat('Moved', moved, 'warn') : null,
    counts.dismissed ? chipStat('Dismissed', counts.dismissed, 'muted') : null,
  ].filter(Boolean));
}

function controls() {
  const search = textInput({
    value: view.text,
    placeholder: 'Activity, location or name…',
    onInput: debounce((v) => {
      view.text = v;
      refilter();
    }, 160),
  });
  search.setAttribute('aria-label', 'Search the look-ahead');

  return el('div', { style: { marginBottom: '10px' } }, [
    field('Find', search),
    segmented({
      value: view.show,
      stretch: true,
      options: [
        { value: 'suggested', label: 'Suggested' },
        { value: 'placed', label: 'On timeline' },
        { value: 'dismissed', label: 'Dismissed' },
        { value: 'all', label: 'All' },
      ],
      onChange: (v) => {
        view.show = v;
        refilter();
      },
    }),
  ]);
}

/* ── Rows ──────────────────────────────────────────────────────────────── */

function shownEntries(doc) {
  const needle = fold(view.text);
  return Object.values(lookaheadRegister(doc).activities)
    .filter((entry) => {
      if (needle && !fold(`${entry.label} ${entry.resources.join(' ')}`).includes(needle)) return false;
      return view.show === 'all' || stateOf(doc, entry) === view.show;
    })
    .sort((a, b) => (a.start - b.start) || (a.order - b.order));
}

function renderRows() {
  const doc = store.getDoc();
  const shown = shownEntries(doc);
  clear(listEl);
  clear(bulkEl);

  const placeable = shown.filter((e) => stateOf(doc, e) === 'suggested');
  if (placeable.length > 1) {
    bulkEl.append(
      el('button', {
        class: 'cx-btn mini',
        html: icon('plus', { size: 12 }) + `<span>Place all ${placeable.length} shown…</span>`,
        onClick: () => place(placeable.map((e) => e.id)),
      }),
      el('button', {
        class: 'cx-btn mini ghost',
        style: { marginLeft: '6px' },
        html: icon('ban', { size: 12 }) + `<span>Dismiss all ${placeable.length}</span>`,
        onClick: () => {
          store.dismissLookahead(placeable.map((e) => e.id), true);
          refresh();
        },
      })
    );
  }

  if (!shown.length) {
    listEl.appendChild(emptyState({
      iconName: 'search',
      title: 'Nothing here',
      message: view.show === 'suggested' ? 'Every run on the sheet is placed, linked or dismissed.' : 'Try a different search or filter.',
    }));
    return;
  }

  const LIMIT = 300;
  for (const entry of shown.slice(0, LIMIT)) listEl.appendChild(entryRow(doc, entry));
  if (shown.length > LIMIT) {
    listEl.appendChild(el('div', { class: 'cx-hint', style: { padding: '8px 4px' },
      text: `Showing the first ${LIMIT} of ${shown.length}. Narrow the search to see the rest.` }));
  }
}

function runMeta(run) {
  return [
    run.location || null,
    `${fmtDate(run.start, 'numeric')} → ${fmtDate(run.end - MS_DAY, 'numeric')}`,
    `${run.days} day${run.days === 1 ? '' : 's'}`,
    run.resources?.length ? run.resources.join(', ') : null,
    // Only what the key *names*: an unlabelled fill's hex says nothing here.
    (run.meanings || []).filter((m) => !m.startsWith('#')).join(' / ') || null,
  ].filter(Boolean).join(' · ');
}

function entryRow(doc, entry) {
  const objects = laPlaced(doc, entry.id);
  const placed = objects.length > 0;
  const variance = placed ? laVariance(doc, objects[0]) : null;
  const moved = entry.previous ? Math.round((entry.end - entry.previous.end) / MS_DAY) : null;

  const row = el('div', {
    class: 'p6-row la-row' + (placed ? ' placed' : ''),
    dataset: { la: entry.id },
    draggable: 'true',
    title: 'Drag onto the timeline to place it, or onto an existing bar to link them',
    onClick: () => (placed ? cmd.revealObject(objects[0].id) : place([entry.id])),
  }, [
    el('span', {
      class: 'p6-mark',
      style: { background: placed ? 'var(--good)' : 'var(--text-subtle)' },
      title: placed ? 'On the timeline' : 'Not placed',
    }),
    el('div', { class: 'p6-name', text: entry.title, title: entry.label }),
    el('div', { class: 'p6-acts' }, [
      placed
        ? el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Show on the timeline',
            'aria-label': `Show ${entry.title} on the timeline`,
            html: icon('target', { size: 11 }),
            onClick: (e) => { e.stopPropagation(); cmd.revealObject(objects[0].id); },
          })
        : el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Add to the timeline',
            'aria-label': `Add ${entry.title} to the timeline`,
            html: icon('plus', { size: 11 }),
            onClick: (e) => { e.stopPropagation(); place([entry.id]); },
          }),
      el('button', {
        class: 'cx-btn icon mini ghost',
        title: placed ? 'Unlink' : 'Link to an existing object',
        'aria-label': placed ? `Unlink ${entry.title}` : `Link ${entry.title} to an object`,
        html: icon(placed ? 'unlink' : 'link', { size: 11 }),
        onClick: (e) => {
          e.stopPropagation();
          if (placed) unlink(objects, entry);
          else openLinkPicker(entry);
        },
      }),
      placed
        ? null
        : el('button', {
            class: 'cx-btn icon mini ghost',
            title: entry.dismissed ? 'Restore the suggestion' : 'Dismiss the suggestion',
            'aria-label': entry.dismissed ? `Restore ${entry.title}` : `Dismiss ${entry.title}`,
            html: icon(entry.dismissed ? 'undo' : 'ban', { size: 11 }),
            onClick: (e) => {
              e.stopPropagation();
              store.dismissLookahead([entry.id], !entry.dismissed);
              refresh();
            },
          }),
    ].filter(Boolean)),
    el('div', { class: 'p6-meta', text: runMeta(entry) }),
    el('div', { class: 'p6-badges' }, [
      entry.missing ? badge('Gone from the sheet', 'bad') : null,
      entry.past ? badge('Before this window', 'muted') : null,
      moved ? badge(`sheet ${shiftLabel(moved)}`, moved > 0 ? 'bad' : 'good') : null,
      variance?.differs ? badge(`you ${shiftLabel(variance.finishShift)}`, variance.behind ? 'warn' : 'info') : null,
      objects.length > 1 ? badge(`${objects.length} bars`, 'info') : null,
      entry.dismissed ? badge('Dismissed', 'muted') : null,
      placed && objects[0].status ? badge(statusOf(objects[0].status).label, statusOf(objects[0].status).tone) : null,
    ].filter(Boolean)),
  ]);

  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(LA_MIME, entry.id);
    e.dataTransfer.setData('text/plain', entry.title);
    e.dataTransfer.effectAllowed = 'copyLink';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));

  return row;
}

/* ── Actions ───────────────────────────────────────────────────────────── */

function place(ids) {
  const lanes = store.orderedLanes();
  if (!lanes.length) {
    toast({ tone: 'warn', title: 'No lanes', message: 'Add a lane before placing activities.' });
    return;
  }
  let laneId = lanes[0].id;
  openModal({
    title: ids.length === 1 ? 'Add to the timeline' : `Add ${ids.length} to the timeline`,
    subtitle: 'The look-ahead dates are the starting point, and yours to change from then on.',
    body: field('Lane', selectInput({
      value: laneId,
      options: lanes.map((l) => ({ value: l.id, label: l.name })),
      onChange: (v) => { laneId = v; },
    })),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Add',
        kind: 'primary',
        onClick: () => {
          const added = store.placeLookahead(ids, { lane: laneId });
          if (!added.length) return;
          renderer.requestRender();
          if (added.length === 1) cmd.revealObject(added[0]);
          refresh();
          toast({ tone: 'good', title: added.length === 1 ? 'Added' : `${added.length} added`, message: 'Placed on the look-ahead dates.' });
        },
      },
    ],
  });
}

async function unlink(objects, entry) {
  const ok = await confirmDialog({
    title: 'Unlink from the look-ahead?',
    message: `${objects.length} object(s) keep their dates and their place on the timeline. Only the link to “${entry.title}” goes, and it becomes a suggestion again.`,
    confirmLabel: 'Unlink',
  });
  if (!ok) return;
  for (const object of objects) store.unlinkLookahead(object.id, entry.id);
  renderer.requestRender();
  refresh();
}

function openLinkPicker(entry) {
  const doc = store.getDoc();
  const lanes = new Map(doc.lanes.map((l) => [l.id, l.name]));
  const candidates = doc.objects
    .filter((o) => TYPES[o.type] && !laLinkedIds(o).includes(entry.id))
    .sort((a, b) => Math.abs(a.start - entry.start) - Math.abs(b.start - entry.start));

  if (!candidates.length) {
    toast({ tone: 'warn', title: 'Nothing to link to', message: 'There is no object on the timeline to link.' });
    return;
  }

  openPicker({
    title: 'Link to an existing object',
    subtitle: `${entry.title} — the object keeps its own dates; linking records what it stands for.`,
    placeholder: 'Search by title or lane…',
    items: candidates.map((o) => ({
      value: o.id,
      label: o.title,
      meta: `${lanes.get(o.lane) || 'no lane'} · ${fmtDate(o.start, 'numeric')}`,
    })),
    empty: 'No object matches.',
    onPick: (objectId) => {
      if (!objectId) return;
      store.linkLookahead(objectId, entry.id);
      renderer.requestRender();
      refresh();
      toast({ tone: 'good', title: 'Linked', message: 'That object now stands for this run of the look-ahead.' });
    },
  });
}

async function clearUnlinked() {
  const ok = await confirmDialog({
    title: 'Clear the suggestions?',
    message: 'Every run no bar is linked to is forgotten, dismissed ones included. Linked runs stay, and the next import brings the rest back.',
    confirmLabel: 'Clear',
  });
  if (!ok) return;
  store.clearLookahead();
  refresh();
}

/* ── Dropping onto the canvas ──────────────────────────────────────────── */

/** The type carried on a dragged suggestion. */
export const LA_MIME = 'application/x-cx-lookahead';

/** Onto a bar links the two; onto an empty lane places a new bar there. */
export function installLookaheadDrops() {
  on('canvas:drop', ({ data, objectId, laneId }) => {
    const id = data?.[LA_MIME];
    if (!id) return;
    const entry = store.getLookaheadActivity(id);
    if (!entry) return;

    if (objectId) {
      if (laLinkedIds(store.getObject(objectId)).includes(id)) {
        toast({ tone: 'info', title: 'Already linked', message: 'That bar already stands for this run.' });
        return;
      }
      store.linkLookahead(objectId, id);
      renderer.requestRender();
      refresh();
      toast({ tone: 'good', title: 'Linked', message: `${store.getObject(objectId)?.title || 'That bar'} now stands for ${entry.title}.` });
      return;
    }

    const [added] = store.placeLookahead([id], { lane: laneId });
    if (!added) return;
    cmd.revealObject(added);
    refresh();
    toast({ tone: 'good', title: 'Added', message: 'Placed on the look-ahead dates, and yours from here.' });
  });
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function shiftLabel(days) {
  if (days == null) return '—';
  if (days === 0) return 'on plan';
  return `${days > 0 ? '+' : '−'}${Math.abs(days)}d`;
}

function refresh() {
  emit(EV.PANE_REFRESH, { pane: 'lookahead' });
}
