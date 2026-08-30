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
function sheet(marks) {
  // A fixed Monday, so the week keys are known rather than relative to today.
  const first = Date.UTC(2026, 8, 7);      // Monday 7 September 2026
  const days = [...Array(14)].map((_, i) => new Date(first + i * 86400000));
  const cell = (i, value, hex) => ({ col: 8 + i, ref: `X${i}`, value, hex, role: hex ? 'shift' : null,
    meaning: hex === 'FFFF00' ? 'Day Shift' : hex === 'FF0000' ? 'Cancelled' : hex ? null : null });

  return {
    rows: [
      { row: 4, label: '', cells: [{ col: 8, ref: 'M', value: 'SEPTEMBER', hex: null }] },
      { row: 5, label: '', cells: days.map((d, i) => cell(i, String(d.getUTCDate()), null)) },
      { row: 6, label: '', cells: days.map((d, i) => cell(i, DAY[(d.getUTCDay() + 6) % 7], null)) },
      ...marks.map((m, n) => ({
        row: 10 + n,
        label: '',
        cells: [
          { col: 2, ref: `B${n}`, value: m.label, hex: null },
          { col: 3, ref: `C${n}`, value: m.location, hex: null },
          ...m.days.map(([i, hex]) => cell(i, 'X', hex)),
        ],
      })),
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

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
