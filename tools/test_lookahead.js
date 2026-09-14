#!/usr/bin/env node
/**
 * The look-ahead parser and the change classifier.
 *
 * No browser and no database: these are pure functions over a workbook and two
 * lists, and they are where the delay-claim numbers come from. Every case here
 * is one that is invisible when you open the spreadsheet by hand — a theme
 * colour looks exactly like a literal one, a hidden column looks like no column
 * at all, and a window rolling forward looks exactly like scope being added.
 *
 *   node tools/test_lookahead.js
 */

import path from 'node:path';
import url from 'node:url';
import { buildWorkbook, EXPECTED } from './fixtures/xlsx_fixture.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function throws(name, fn, pattern) {
  try {
    fn();
    check(name, false, 'it did not throw');
  } catch (err) {
    check(name, pattern.test(err.message), err.message.slice(0, 80));
  }
}

/**
 * The modules are ES modules with relative imports, which Node runs directly.
 * They are loaded rather than bundled so a failure points at the source line.
 */
const la = await import(path.join(ROOT, 'src/io/lookahead.js'));
const cls = await import(path.join(ROOT, 'src/core/lookahead.js'));

/* ══════════════════════════════════════════════════════════════════════════
   The parser
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nReading one named sheet');

const book = buildWorkbook();
const buffer = book.buffer.slice(book.byteOffset, book.byteOffset + book.byteLength);

const grid = la.parseSheet(buffer, EXPECTED.dataSheet);
check('the named sheet is read, not the first one', grid.sheet === EXPECTED.dataSheet);
check('and the workbook reports all its tabs', grid.sheets.length === EXPECTED.sheets.length);

throws('a sheet that is not there is an error, never a fall back to sheet one',
  () => la.parseSheet(buffer, 'Nonexistent'), /no sheet called/i);

// A hidden sheet under the configured name almost always means the name is
// stale and the live grid has moved — reading it anyway would be worse.
throws('a hidden sheet under the configured name is refused',
  () => la.parseSheet(buffer, EXPECTED.hiddenSheet), /hidden/i);

console.log('\nVisible rows and columns only');

check('hidden rows are dropped', grid.hiddenRows === EXPECTED.rows.hidden,
  `${grid.hiddenRows} hidden`);
check('and the visible ones survive', grid.rows.length === 4,
  `${grid.rows.length} rows with cells`);

// The trap that only shows up here: blank and absent rows mean the nth row in
// the file is not row n, so an array index is not an identity.
const rowNumbers = grid.rows.map((r) => r.row);
check('every row carries its real spreadsheet number',
  JSON.stringify(rowNumbers) === JSON.stringify([1, 2, 6, 8]),
  rowNumbers.join(', '));
check('so the row after a gap is not renumbered', rowNumbers.includes(6) && !rowNumbers.includes(4));

check('the hidden column is reported',
  JSON.stringify(grid.hiddenColumns) === JSON.stringify(EXPECTED.hiddenColumns));
// This is the one that matters more than a hidden row: with a column per day,
// dropping one removes a day from the week and nothing looks wrong.
const anyHiddenCell = grid.rows.some((r) => r.cells.some((c) => c.col === 4));
check('and no cell from it reaches the grid', !anyHiddenCell);

check('merged ranges are reported',
  JSON.stringify(grid.merges) === JSON.stringify(EXPECTED.merges));

/* The regex trap: a fill-only cell is self-closing, and a lazy row match stops
   at the first `/>` — dropping every cell after it. A workbook of values never
   hits it; a workbook of colours hits it on nearly every row. */
console.log('\nCells that carry a colour and no value');
const row2 = grid.rows.find((r) => r.row === 2);
check('a row of fill-only cells is not truncated', row2.cells.length === 5,
  `${row2.cells.length} cells on row 2`);
check('and the ones with fills kept them',
  row2.cells.filter((c) => c.hex).length === 3);

/* ══════════════════════════════════════════════════════════════════════════
   Colour
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nResolving colour, whichever way it was written');

const cellsByRef = new Map();
for (const row of grid.rows) for (const cell of row.cells) cellsByRef.set(cell.ref, cell);

check('a literal RGB fill resolves', cellsByRef.get('B2').hex === 'FFFF00',
  cellsByRef.get('B2').hex);

// Excel's "Blue, Accent 1, Darker 25%". Doing the tint in RGB rather than HLS
// gives a near miss, and a near miss against a legend is a lookup that fails.
check('a theme colour with a tint resolves through HLS',
  cellsByRef.get('B6').hex === '2F5597', cellsByRef.get('B6').hex);
check('and says it came from the theme', /^theme:/.test(cellsByRef.get('B6').source));

check('a legacy indexed colour resolves', cellsByRef.get('C6').hex === 'FFFF00',
  cellsByRef.get('C6').hex);

// The reason the legend is keyed on the resolved colour and not the notation:
// these two cells are the same yellow reached two different ways, and they are
// one legend entry, not two.
check('a literal and an indexed yellow land on the same colour',
  cellsByRef.get('B2').hex === cellsByRef.get('C6').hex);
check('though they record how they were written',
  cellsByRef.get('B2').source === 'rgb' && /^indexed:/.test(cellsByRef.get('C6').source));

console.log('\nConditional formatting is reported, not evaluated');
const plain = la.parseSheet(buffer, EXPECTED.dataSheet);
check('a sheet without it says so', plain.conditional.length === 0);

const cfBook = buildWorkbook({ conditionalFormatting: true });
const cfBuffer = cfBook.buffer.slice(cfBook.byteOffset, cfBook.byteOffset + cfBook.byteLength);
const cfGrid = la.parseSheet(cfBuffer, EXPECTED.dataSheet);
// A colour from a rule is not in the cell's style at all. If the grid were
// painted that way this parser would see nothing, so the honest thing is to
// report the ranges and let somebody look.
check('and a sheet with it reports the ranges', cfGrid.conditional.length === 1,
  cfGrid.conditional.join(', '));

/* ══════════════════════════════════════════════════════════════════════════
   The legend
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nA colour that is not in the legend is never guessed');

const legend = [
  { argb: 'FFFF00', meaning: 'day' },
  { argb: 'FF0000', meaning: 'cancelled' },
];
const read = la.applyLegend(grid, legend);

check('a known colour is given its meaning',
  read.rows.flatMap((r) => r.cells).some((c) => c.meaning === 'day'));
check('and a cancellation is recognised',
  read.rows.flatMap((r) => r.cells).some((c) => c.meaning === 'cancelled'));

// One stray shade from the recent-colours picker would otherwise misclassify a
// shift with nothing on screen to show it happened — and the result lands in
// evidence.
check('an unmapped colour is collected rather than defaulted', read.unknown.length === 2,
  read.unknown.map((u) => u.hex).join(', '));
check('with somewhere to look for it', read.unknown.every((u) => u.samples.length > 0));
check('and none of them silently became a shift',
  read.rows.flatMap((r) => r.cells)
    .filter((c) => c.hex && !['FFFF00', 'FF0000'].includes(c.hex))
    .every((c) => c.meaning === null));

console.log('\nA re-mapped colour means what it means now');

/* `rc_legend` is versioned — `unique (valid_from, argb)` — so a colour that has
   been re-mapped has a row per date and only the newest is what it means. That
   choice has to live here rather than in whatever order the caller sorted its
   array, and it did not: the lookup was a `Map` built straight from the array,
   which keeps whichever row came *last*. `listLegend()` hands them over newest
   first, so last meant oldest and every correction anybody made was thrown away.

   The symptom was the worst kind. Pressing "Just shading" on the grey a workbook
   shades its layout with wrote an `ignore` row, the lookup kept reading the older
   `shift` row, and all those rows stayed on the calendar — and because the older
   row carries a meaning the colour was no longer unmapped, so the button that
   would have fixed it was gone. */
const greyGrid = { rows: [{ row: 9, cells: [{ col: 8, ref: 'H9', value: '', hex: '7F7F7F' }] }] };
const versioned = [
  { argb: '7F7F7F', meaning: 'Shading', role: 'ignore', valid_from: '2026-09-10' },
  { argb: '7F7F7F', meaning: 'Day Shift', role: 'shift', valid_from: '2026-05-01' },
];
const greyCell = (rows) => la.applyLegend(greyGrid, rows).rows[0].cells[0];

check('a colour mapped twice reads as its newest mapping',
  greyCell(versioned).role === 'ignore', `${greyCell(versioned).role} / ${greyCell(versioned).meaning}`);
// The caller's sort order must not be able to change the answer — three call
// sites pass this array and they do not all sort it the same way.
check('and the answer does not depend on how the caller sorted them',
  greyCell([...versioned].reverse()).role === 'ignore');
check('a single entry with no valid_from still resolves',
  greyCell([{ argb: '7F7F7F', meaning: 'Day Shift', role: 'shift' }]).meaning === 'Day Shift');
check('and a colour nobody mapped is still collected rather than guessed at',
  greyCell([]).meaning === null && la.applyLegend(greyGrid, []).unknown.length === 1);

/* ══════════════════════════════════════════════════════════════════════════
   Classification
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nRow identity without an activity ID');

const keyed = cls.keyRows([
  { weekStart: '2026-08-31', location: 'TPSS 12', subsystem: 'ATS', label: 'ATS integration' },
  { weekStart: '2026-08-31', location: 'TPSS 12', subsystem: 'IXL', label: 'IXL static' },
  { weekStart: '2026-08-31', location: 'TPSS 12', subsystem: 'ATS', label: 'ATS second shift' },
]);
check('rows in one place and week are told apart', new Set(keyed.map((r) => r.rowKey)).size === 3);
check('two rows of the same subsystem get different ordinals',
  keyed[0].rowKey !== keyed[2].rowKey);

console.log('\nThe window moving is not a change of scope');

const week = (w, rows) => rows.map((r) => ({ ...r, weekStart: w }));
const before = cls.keyRows([
  ...week('2026-08-24', [{ location: 'TPSS 12', subsystem: 'ATS', cells: { '2026-08-25': 'day' } }]),
  ...week('2026-08-31', [{ location: 'TPSS 12', subsystem: 'ATS', cells: { '2026-09-01': 'day' } }]),
  ...week('2026-09-07', [{ location: 'Station 6', subsystem: 'IXL', cells: { '2026-09-08': 'night' } }]),
]);
const after = cls.keyRows([
  // 08-24 has dropped off the back; 09-14 has arrived at the front.
  ...week('2026-08-31', [{ location: 'TPSS 12', subsystem: 'ATS', cells: { '2026-09-01': 'day' } }]),
  ...week('2026-09-07', [{ location: 'Station 6', subsystem: 'IXL', cells: { '2026-09-08': 'night' } }]),
  ...week('2026-09-14', [{ location: 'Yard 3', subsystem: 'SCADA', cells: { '2026-09-15': 'day' } }]),
]);

const events = cls.classify(before, after);
const kinds = events.map((e) => e.kind);

// Without this, every week would book a batch of phantom scope additions, and
// completed work falling off the back would count as deleted scope.
check('a week arriving at the far edge is the window advancing',
  kinds.filter((k) => k === 'window_advanced').length === 1);
check('a week leaving the back is the window retiring',
  kinds.filter((k) => k === 'window_retired').length === 1);
check('neither is counted as scope',
  !kinds.includes('scope_added') && !kinds.includes('scope_removed'), kinds.join(', '));
check('and neither reaches the KPIs', cls.countable(events).length === 0);

console.log('\nReal scope movement inside the window');

const after2 = cls.keyRows([
  ...week('2026-08-31', [
    { location: 'TPSS 12', subsystem: 'ATS', cells: { '2026-09-01': 'day' } },
    { location: 'TPSS 12', subsystem: 'SCADA', cells: { '2026-09-02': 'day' } },
  ]),
  // The IXL row in 09-07 is gone.
]);
const before2 = cls.keyRows([
  ...week('2026-08-31', [{ location: 'TPSS 12', subsystem: 'ATS', cells: { '2026-09-01': 'day' } }]),
]);

const events2 = cls.classify(before2, after2);
check('a row added to a week already in view is scope added',
  events2.filter((e) => e.kind === 'scope_added').length === 1);
check('and it does count', cls.countable(events2).length === 1);

console.log('\nA shift turning red is a cancellation');

const beforeC = cls.keyRows([
  ...week('2026-08-31', [{ location: 'TPSS 12', subsystem: 'ATS', cells: { '2026-09-01': 'day', '2026-09-02': 'day' } }]),
]);
const afterC = cls.keyRows([
  ...week('2026-08-31', [{ location: 'TPSS 12', subsystem: 'ATS', cells: { '2026-09-01': 'cancelled', '2026-09-02': 'night' } }]),
]);
const eventsC = cls.classify(beforeC, afterC);

check('a day going red is a cancellation',
  eventsC.some((e) => e.kind === 'cancellation' && e.date === '2026-09-01'));
// Red says a shift was cancelled; it cannot say by whom, so somebody is asked
// rather than the system deciding.
check('and it asks who was responsible rather than assuming',
  eventsC.find((e) => e.kind === 'cancellation').needsResponsibility === true);
check('a day merely changing shift is not a cancellation',
  eventsC.some((e) => e.kind === 'shift_changed' && e.date === '2026-09-02'));

console.log('\nBART resource marks change on their own');

const beforeM = cls.keyRows([
  ...week('2026-08-31', [{ location: 'TPSS 12', subsystem: 'ATS', cells: { '2026-09-01': 'day' }, marks: {} }]),
]);
const afterM = cls.keyRows([
  ...week('2026-08-31', [{ location: 'TPSS 12', subsystem: 'ATS', cells: { '2026-09-01': 'day' }, marks: { '2026-09-01': 'EIC' } }]),
]);
const eventsM = cls.classify(beforeM, afterM);
// The shift did not move and the request still changed, so it is its own event
// rather than being folded into the row.
check('an EIC added to an unchanged shift is logged',
  eventsM.some((e) => e.kind === 'resource_changed'));
check('and the shift itself is not reported as changed',
  !eventsM.some((e) => e.kind === 'shift_changed'));

console.log('\nA crew moving site is suggested, never inferred');

const beforeL = cls.keyRows([
  ...week('2026-08-31', [{ location: 'TPSS 12', subsystem: 'ATS', cells: { '2026-09-01': 'day' }, marks: { eic: 'X' } }]),
]);
const afterL = cls.keyRows([
  ...week('2026-08-31', [{ location: 'Station 6', subsystem: 'ATS', cells: { '2026-09-01': 'day' }, marks: { eic: 'X' } }]),
]);
const eventsL = cls.classify(beforeL, afterL);

// Honest by default: the system cannot tell an early finish from a
// cancellation, so it logs both halves and keeps the KPI count truthful.
check('it is logged as a removal and an addition',
  eventsL.some((e) => e.kind === 'scope_removed') && eventsL.some((e) => e.kind === 'scope_added'));

const candidates = cls.relinkCandidates(eventsL);
check('but the pair is offered for relinking', candidates.length === 1);
check('with a reason a person can check', /same resources/.test(candidates[0].because));

/* ══════════════════════════════════════════════════════════════════════════
   The general .xlsx reader
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nThe importer reads the same workbook without losing cells');

// `readXlsx()` predates the look-ahead and is used by the CSV/Excel import.
// It shared the truncating row regex, which never showed up there because the
// spreadsheets people import are full of values — cells that close with
// `</c>`. A sheet of formatted-but-empty cells is what exposes it.
const { readXlsx } = await import(path.join(ROOT, 'src/io/importers.js'));
const imported = await readXlsx(buffer);

check('it returns rows', imported.length > 0, `${imported.length} rows`);
// Row 2 of the fixture is A2 plus four fill-only cells. With the lazy regex
// the row stopped at the first `/>` and only A2 and B2 survived.
const wide = imported.find((row) => row[0] === 'TPSS 12');
check('a row of style-only cells is not truncated', wide && wide.length >= 6,
  wide ? `${wide.length} columns` : 'row not found');
check('and the cell after the empty ones is still there',
  wide && wide[5] === 'EIC', wide ? String(wide[5]) : '—');

/* ══════════════════════════════════════════════════════════════════════════
   From a sheet to a set of change events
   ═══════════════════════════════════════════════════════════════════════ */
console.log('\nA read becomes rows, and two reads become a difference');

/* The whole pipeline, on a grid built by hand so the answers are known:
   readGrid → rowsFrom → classify. This is the path that was never joined up —
   `classify()` was written, tested against hand-made rows, and never given
   any: nothing produced them, so the change log was empty by construction. */
const DAY = ['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su'];
function sheet(marks, { headings = true } = {}) {
  // A fixed Monday, so the week keys are known rather than relative to today.
  const first = Date.UTC(2026, 8, 7);      // Monday 7 September 2026
  const days = [...Array(14)].map((_, i) => new Date(first + i * 86400000));
  /* The role is what `applyLegend()` would have attached, so the fixture can
     express the three kinds of paint a real workbook carries: a shift, the
     grey a section band is drawn in, and the grey the weekend columns are
     shaded with. Only the first is work. */
  const roleOf = (hex) => (hex === 'D9D9D9' ? 'divider' : hex === 'BFBFBF' ? 'ignore' : hex ? 'shift' : null);
  const cell = (i, value, hex) => ({ col: 8 + i, ref: `X${i}`, value, hex, role: roleOf(hex),
    meaning: hex === 'FFFF00' ? 'Day Shift' : hex === 'FF0000' ? 'Cancelled' : hex ? null : null });

  /* Two spreadsheet rows per entry, so the Resource row has somewhere to be.
     `resource` is the names typed against each day; the location and hours cells
     are deliberately left blank, because that is exactly what the workbook does
     and inheriting them is the behaviour under test. */
  const body = [];
  marks.forEach((m, n) => {
    /* A row of names that is not work — "PTO", "Other Group / Project". It
       stands on its own, with no activity above it to inherit from, which is
       where the real sheet puts them and the whole reason they are not read the
       way a Resource row is. */
    if (m.absence) {
      body.push({
        row: 10 + n * 2,
        label: '',
        cells: [
          { col: 3, ref: `A${n}`, value: m.absence, hex: null },
          ...m.days.map(([i, who]) => cell(i, who, null)),
        ],
      });
      return;
    }
    body.push({
      row: 10 + n * 2,
      label: '',
      cells: [
        { col: 2, ref: `B${n}`, value: m.label, hex: null },
        { col: 3, ref: `C${n}`, value: m.location, hex: null },
        ...m.days.map(([i, hex]) => cell(i, 'X', hex)),
      ],
    });
    if (m.resource) {
      body.push({
        row: 11 + n * 2,
        label: '',
        cells: [
          { col: 2, ref: `BR${n}`, value: 'Resource', hex: null },
          ...m.resource.map(([i, who]) => cell(i, who, null)),
        ],
      });
    }
  });

  /* What the workbook calls its activity columns, on the weekday row the way
     this one writes them. Which column is the location is *read* from these —
     see `locationColumnOf()` — so a fixture without them exercises the other
     path, the register scan, which is all a sheet with no headings allows. */
  const headingCells = headings
    ? [
      { col: 2, ref: 'H2', value: 'Description of Work Activity', hex: null },
      { col: 3, ref: 'H3', value: 'Location', hex: null },
    ]
    : [];

  return {
    rows: [
      { row: 4, label: '', cells: [{ col: 8, ref: 'M', value: 'SEPTEMBER', hex: null }] },
      { row: 5, label: '', cells: days.map((d, i) => cell(i, String(d.getUTCDate()), null)) },
      { row: 6, label: '', cells: [
        ...headingCells,
        ...days.map((d, i) => cell(i, DAY[(d.getUTCDay() + 6) % 7], null)),
      ] },
      ...body,
    ],
  };
}

const locate = async (text) => (text === 'TPSS 12' ? 'loc-1' : null);

const genA = cls.readGrid(sheet([
  { label: 'IXL Regression', location: 'TPSS 12', days: [[0, 'FFFF00'], [1, 'FFFF00']] },
  { label: 'Cable pull', location: 'Yard 3', days: [[8, 'FFFF00']] },
  { label: 'Nothing scheduled', location: 'TPSS 12', days: [] },
]), { anchorISO: '2026-09-09' });
const rowsA = await cls.rowsFrom(genA, { snapshotId: 'snap-a', locate });

/* Paint is not work. A row carrying only the grey a section band is drawn in,
   or only the shading on the weekend columns, has nothing scheduled on it —
   and it used to survive into the grid because the test was "not ignored"
   rather than "is a shift", and a divider is neither. */
const painted = cls.readGrid(sheet([
  { label: 'Real work', location: 'TPSS 12', days: [[0, 'FFFF00']] },
  { label: 'Section band only', location: 'TPSS 12', days: [[0, 'D9D9D9'], [1, 'D9D9D9']] },
  { label: 'Weekend shading only', location: 'TPSS 12', days: [[5, 'BFBFBF'], [6, 'BFBFBF']] },
  { label: 'Shading and a shift', location: 'TPSS 12', days: [[5, 'BFBFBF'], [2, 'FFFF00']] },
]), { anchorISO: '2026-09-09' });
const lit = (name) => painted.activities.find((a) => a.meta[0] === name)?.highlighted;

check('a row with real work is kept', lit('Real work') === true);
check('a row painted only with a section-band grey is not', lit('Section band only') === false);
check('nor is one carrying only weekend shading', lit('Weekend shading only') === false);
check('but shading with a shift on top of it stays', lit('Shading and a shift') === true);

check('a row is emitted per activity per week', rowsA.length === 2, `${rowsA.length} rows`);
check('an activity with nothing scheduled is not a row',
  !rowsA.some((r) => /Nothing scheduled/.test(r.raw_label)));
check('the week is the Monday of the days it carries',
  rowsA.every((r) => ['2026-09-07', '2026-09-14'].includes(r.week_start)),
  rowsA.map((r) => r.week_start).join(', '));
check('a spelling the register knows resolves to a location',
  rowsA.find((r) => /IXL/.test(r.raw_label))?.location_id === 'loc-1');
check('and one it does not is kept for somebody to map, never guessed',
  rowsA.find((r) => /Cable pull/.test(r.raw_label))?.location_id === null);

/* ── Where the work is, off the sheet's own column ────────────────────────
   The location used to be recorded only where the register already knew the
   spelling, so a column of codes nobody had registered was discarded — and with
   nothing kept there was nothing for anybody to map. */
console.log('\nThe location comes off the column the sheet keeps it in');

check('the Location column is found by its heading, not by position',
  cls.locationColumnOf(genA) === 1, `column index ${cls.locationColumnOf(genA)}`);
check('a sheet with no headings says so rather than guessing',
  cls.locationColumnOf(cls.readGrid(sheet([
    { label: 'IXL Regression', location: 'TPSS 12', days: [[0, 'FFFF00']] },
  ], { headings: false }), { anchorISO: '2026-09-09' })) === -1);

check('an unresolved spelling is still written down',
  rowsA.find((r) => /Cable pull/.test(r.raw_label))?.raw_location === 'Yard 3');
check('and it is what the row is keyed on, so two places are two rows',
  rowsA.find((r) => /Cable pull/.test(r.raw_label))?.row_key.includes('Yard 3'));

// The description is never the location, whatever the register happens to say
// about it — the wording differs on the two sides and is not evidence.
const nosy = await cls.rowsFrom(genA, {
  snapshotId: 'snap-n',
  locate: async (text) => (text === 'IXL Regression' ? 'loc-wrong' : null),
});
check('the description is not offered as a location when the column is known',
  nosy.find((r) => /IXL/.test(r.raw_label))?.location_id === null);

// No heading, so the register decides — the behaviour every sheet had before,
// and the only one available where nobody labelled the columns.
const unlabelled = await cls.rowsFrom(cls.readGrid(sheet([
  { label: 'IXL Regression', location: 'TPSS 12', days: [[0, 'FFFF00']] },
  { label: 'Cable pull', location: 'Yard 3', days: [[1, 'FFFF00']] },
], { headings: false }), { anchorISO: '2026-09-09' }), { snapshotId: 'snap-u', locate });
check('with no heading the register still finds the one spelling it knows',
  unlabelled.find((r) => /IXL/.test(r.raw_label))?.location_id === 'loc-1');
check('and a column it cannot place stays unclaimed rather than being invented',
  unlabelled.find((r) => /Cable pull/.test(r.raw_label))?.raw_location === null);

/* A read that started recording the location is not a read where everything
   moved. The row key carries the location, so that first read keys every row
   differently — and compared naively it is a batch of phantom scope. */
const keyedBoth = rowsA.map((r) => ({
  rowKey: r.row_key, weekStart: r.week_start, location: r.raw_location || '',
  subsystem: '', label: r.raw_label, cells: r.cells, marks: r.bart_marks, resources: r.resources,
}));
const keyedNone = keyedBoth.map((r) => ({
  ...r, location: '', rowKey: r.rowKey.replace(/\|[^|]*\|/, '||'),
}));
check('the first read to record a location is not a hundred rows moving',
  cls.classify(keyedNone, keyedBoth).length === 0,
  `${cls.classify(keyedNone, keyedBoth).length} events`);
check('and the reverse is the same non-event',
  cls.classify(keyedBoth, keyedNone).length === 0);

// Second read: the Tuesday shift is cancelled, and a row is added the same week.
const genB = cls.readGrid(sheet([
  { label: 'IXL Regression', location: 'TPSS 12', days: [[0, 'FFFF00'], [1, 'FF0000']] },
  { label: 'Cable pull', location: 'Yard 3', days: [[8, 'FFFF00']] },
  { label: 'New work', location: 'TPSS 12', days: [[2, 'FFFF00']] },
]), { anchorISO: '2026-09-09' });
const rowsB = await cls.rowsFrom(genB, { snapshotId: 'snap-b', locate });

const shape = (r) => ({
  rowKey: r.row_key, weekStart: r.week_start, location: r.raw_location || '',
  subsystem: '', label: r.raw_label, cells: r.cells, marks: r.bart_marks,
});
const moved = cls.classify(rowsA.map(shape), rowsB.map(shape), { cancelledMeaning: 'Cancelled' });
const movedKinds = moved.map((e) => e.kind);

check('a shift turning the cancellation colour is a cancellation',
  movedKinds.filter((k) => k === 'cancellation').length === 1, movedKinds.join(', '));
check('and it asks who is answerable rather than assuming',
  moved.find((e) => e.kind === 'cancellation')?.needsResponsibility === true);
check('a row appearing in a week already in view is scope added',
  movedKinds.filter((k) => k === 'scope_added').length === 1);
check('nothing is reported for the week that did not change',
  !moved.some((e) => e.weekStart === '2026-09-14'));
check('and the window did not move, so nothing says it did',
  !movedKinds.includes('window_advanced') && !movedKinds.includes('window_retired'));

// What `describe()` prints is what somebody reads a year later, and it reads
// the *stored* shape — so a mismatch between the two shows up as "undefined".
const stored = (e) => ({
  ...e,
  before: e.before === null || e.before === undefined ? null
    : (e.kind === 'scope_added' || e.kind === 'scope_removed' ? { label: e.before.label } : { date: e.date, value: e.before }),
  after: e.after === null || e.after === undefined ? null
    : (e.kind === 'scope_added' || e.kind === 'scope_removed' ? { label: e.after.label } : { date: e.date, value: e.after }),
});
const lines = moved.map((e) => cls.describe(stored(e)));
check('every event describes itself without an undefined in it',
  lines.every((l) => !/undefined/.test(l)), lines.join(' | '));
check('and the cancellation says what it was before',
  lines.some((l) => /Cancelled on 2026-09-08: was Day Shift/.test(l)), lines.join(' | '));

/* ══════════════════════════════════════════════════════════════════════════
   The Resource row
   ═══════════════════════════════════════════════════════════════════════ */
console.log('\nThe row underneath that says who is on it');

const withWho = cls.readGrid(sheet([
  {
    label: 'IXL Regression',
    location: 'TPSS 12',
    days: [[0, 'FFFF00'], [1, 'FFFF00']],
    resource: [[0, 'Dan'], [1, 'Dan, R. Okafor']],
  },
  { label: 'Cable pull', location: 'Yard 3', days: [[8, 'FFFF00']] },
]), { anchorISO: '2026-09-09' });

check('a Resource row is not an activity of its own',
  withWho.activities.length === 2, `${withWho.activities.length} activities`);
const ixl = withWho.activities.find((a) => a.meta[0] === 'IXL Regression');
check('it is attached to the activity above it', Boolean(ixl.resource));
/* The workbook leaves the location blank on that row because it is the line
   above's. Reading it as blank would put a row of names at nowhere. */
check('and takes the location the activity above it carries',
  ixl.resource.meta[1] === 'TPSS 12', ixl.resource.meta.join(' | '));
check('while the word "Resource" stays where it was typed',
  ixl.resource.meta[0] === 'Resource');
check('an activity with no Resource row simply has none',
  withWho.activities.find((a) => a.meta[0] === 'Cable pull').resource === null);

// Strict on purpose: a rule that matched anything containing the word would
// swallow an activity called "Resource mobilisation".
check('"Resource" and "Resources" are the row; nothing else is',
  cls.isResourceLabel('Resource') && cls.isResourceLabel(' resources ')
  && !cls.isResourceLabel('Resource mobilisation') && !cls.isResourceLabel('Resource Names'));
check('a cell of names splits on whatever separator was to hand',
  JSON.stringify(cls.resourceNames('Dan, R. Okafor / Priya'))
    === JSON.stringify(['Dan', 'R. Okafor', 'Priya']));

const whoRows = await cls.rowsFrom(withWho, { snapshotId: 'snap-w', locate });
const whoRow = whoRows.find((r) => /IXL/.test(r.raw_label));
check('the names travel with the row, per day',
  whoRow.resources['2026-09-07'] === 'Dan' && whoRow.resources['2026-09-08'] === 'Dan, R. Okafor',
  JSON.stringify(whoRow.resources));
/* Nothing is matched to a person here. That happens against the roster, where
   an unmatched spelling can be shown to somebody rather than guessed at. */
check('and nothing about them was resolved to a person',
  Object.values(whoRow.resources).every((v) => typeof v === 'string'));

const swapped = cls.readGrid(sheet([
  {
    label: 'IXL Regression',
    location: 'TPSS 12',
    days: [[0, 'FFFF00'], [1, 'FFFF00']],
    resource: [[0, 'Dan'], [1, 'Priya']],
  },
  { label: 'Cable pull', location: 'Yard 3', days: [[8, 'FFFF00']] },
]), { anchorISO: '2026-09-09' });
const swappedRows = await cls.rowsFrom(swapped, { snapshotId: 'snap-x', locate });
const withRes = (r) => ({
  rowKey: r.row_key, weekStart: r.week_start, location: r.raw_location || '', subsystem: '',
  label: r.raw_label, cells: r.cells, marks: r.bart_marks, resources: r.resources,
});
const whoMoved = cls.classify(whoRows.map(withRes), swappedRows.map(withRes));

check('somebody being swapped off a shift is a change',
  whoMoved.filter((e) => e.kind === 'resource_changed').length === 1,
  whoMoved.map((e) => e.kind).join(', '));
// The shift itself did not move, and reporting it as having moved would put a
// phantom change into the numbers a claim rests on.
check('and the shift itself is not reported as having moved',
  !whoMoved.some((e) => e.kind === 'shift_changed'));
const whoEvent = whoMoved.find((e) => e.kind === 'resource_changed');
check('it says which side of the row it was', whoEvent.field === 'resources');
check('and describes itself by naming people rather than dates',
  /Resource: .*Okafor.* → .*Priya/.test(cls.describe({
    ...whoEvent, before: { resources: whoEvent.before }, after: { resources: whoEvent.after },
  })),
  cls.describe({ ...whoEvent, before: { resources: whoEvent.before }, after: { resources: whoEvent.after } }));

/* ══════════════════════════════════════════════════════════════════════════
   A heading is only a heading if the activity columns are painted
   ═══════════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════════════
   Rows of names that are not work
   ═══════════════════════════════════════════════════════════════════════ */
console.log('\nThe rows that say who is away');

const withAway = cls.readGrid(sheet([
  { label: 'IXL Regression', location: 'TPSS 12', days: [[0, 'FFFF00'], [1, 'FFFF00']] },
  { absence: 'PTO', days: [[1, 'Priya'], [2, 'Priya, Dan']] },
  { absence: 'Other Group / Project', days: [[3, 'Rosa']] },
]), { anchorISO: '2026-09-09' });

check('a "PTO" row is read as an absence rather than as an activity',
  withAway.activities.filter((a) => a.absence === 'pto').length === 1);
check('and so is "Other Group / Project"',
  withAway.activities.filter((a) => a.absence === 'other').length === 1);
check('they stand on their own rather than attaching to the line above',
  withAway.activities.find((a) => /IXL/.test(a.meta[0]))?.resource === null);
check('an ordinary activity is not one of them',
  withAway.activities.find((a) => /IXL/.test(a.meta[0]))?.absence === null);

/* Strict, for the reason `isResourceLabel()` is strict. A row misread as a label
   vanishes off the calendar; a label misread as work is a row of names at no
   location that every report counts as scope. */
check('"Other" on its own names nothing and is not a label', cls.absenceKind('Other') === null);
check('nor is an activity that merely mentions time off',
  cls.absenceKind('PTO cover arrangements') === null);
check('but the spellings people actually type do match',
  ['PTO', 'pto', 'Paid Time Off', 'Vacation', 'Holiday'].every((t) => cls.absenceKind(t) === 'pto'));
check('and so do the ways the other row gets written',
  ['Other Group / Project', 'Other Project', 'Other Groups & Projects']
    .every((t) => cls.absenceKind(t) === 'other'));

const away = cls.absencesFrom(withAway);
check('every day somebody is named on becomes an entry', away.length === 3,
  `${away.length} entries`);
check('carrying the kind, the date and what was typed',
  away.some((a) => a.kind === 'pto' && a.date === '2026-09-09' && a.written === 'Priya, Dan'),
  JSON.stringify(away[1] || null));
check('and a day the sheet left blank invents nothing',
  away.every((a) => a.written));

/* Not scope, and this is the check that matters most: emitted as rows they
   would be "PTO" at no location, booked as scope added the first week they
   appeared and scope removed the week they did not. */
const awayRows = await cls.rowsFrom(withAway, { snapshotId: 'snap-away', locate });
check('an absence row is never a row of scope',
  awayRows.every((r) => !/PTO|Other Group/i.test(r.raw_label || '')),
  awayRows.map((r) => r.raw_label).join(' | '));
check('while the work on the same sheet still is',
  awayRows.some((r) => /IXL/.test(r.raw_label)));

console.log('\nWhat counts as a section heading');

const rightOfTheCalendar = cls.readGrid({
  rows: [
    { row: 5, label: '', cells: [{ col: 8, ref: 'M', value: 'SEPTEMBER', hex: null }] },
    { row: 6, label: '', cells: [...Array(14)].map((_, i) => ({ col: 8 + i, ref: `N${i}`, value: String(7 + i), hex: null })) },
    { row: 7, label: '', cells: [...Array(14)].map((_, i) => ({ col: 8 + i, ref: `D${i}`, value: DAY[i % 7], hex: null })) },
    { row: 8, label: '', cells: [
      { col: 2, ref: 'B8', value: 'Ordinary work', hex: null },
      { col: 8, ref: 'X8', value: 'X', hex: 'FFFF00', role: 'shift' },
      // A totals column past the end of the calendar, with a fill on it. One of
      // these used to turn every row in the workbook into a section heading —
      // and a heading was drawn whatever the switch said.
      { col: 40, ref: 'AN8', value: '', hex: 'D9D9D9' },
    ] },
  ],
}, { anchorISO: '2026-09-09' });
check('paint to the right of the calendar is not a heading',
  rightOfTheCalendar.activities[0].heading === false);
check('and the row still counts as work',
  rightOfTheCalendar.activities[0].highlighted === true);
/* A row of paint with no description is not an activity — it is a band, a
   spacer, or a fill somebody dragged too far — and putting it on the calendar
   asks the reader to work out which. */
check('a row nobody described is not a named activity',
  cls.readGrid(sheet([{ label: '', location: '', days: [[0, 'FFFF00']] }]),
    { anchorISO: '2026-09-09' }).activities.every((a) => a.named === false));

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
