#!/usr/bin/env node
/**
 * The look-ahead editor's model and its Excel export — no browser, no network.
 *
 * The calendar is now where the 4WLA is written, and an .xlsx is something it
 * produces. Every rule that makes that safe is here: that an undo puts back
 * exactly what was there, that the grid the editor publishes reads back through
 * the same `readGrid()` every other screen uses, that support codes count the
 * way the sheet writes them, and that the exported workbook reads back cell for
 * cell — with its merges, colours and frozen header — through the same parser
 * that reads BART's own file.
 *
 *   node tools/test_la_edit.js
 */

import path from 'node:path';
import url from 'node:url';
import { buildLookaheadWorkbook } from './fixtures/xlsx_fixture.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ed = await import(path.join(ROOT, 'src/core/la_edit.js'));
const la = await import(path.join(ROOT, 'src/io/lookahead.js'));
const cls = await import(path.join(ROOT, 'src/core/lookahead.js'));

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  const line = `${name}${detail ? ` — ${detail}` : ''}`;
  if (ok) {
    passed++;
    console.log(`  ✓ ${line}`);
  } else {
    failures.push(line);
    console.log(`  ✗ ${line}`);
  }
}

const LEGEND = [
  { argb: 'FFFF00', meaning: 'Day Shift', role: 'shift' },
  { argb: 'FFC000', meaning: 'Swing Shift', role: 'shift' },
  { argb: '000000', meaning: 'Blanket Shift', role: 'shift' },
  { argb: 'FF0000', meaning: 'Cancellation', role: 'shift' },
  { argb: '7F7F7F', meaning: 'Weekend', role: 'ignore' },
  { argb: 'D9D9D9', meaning: 'Section band', role: 'divider' },
];
const CODES = [
  { code: 'X', name: 'EIC', party: 'BART' },
  { code: 'WIT', name: 'BART witness', party: 'BART' },
  { code: 'TCE', name: 'TCE', party: 'BART' },
];

/** A small look-ahead: a section, two activities (one with names), PTO. */
function sample() {
  const section = ed.blankRow('section', { id: 's1', sort: 1024, description: 'W40 — Testing and Commissioning' });
  const ixl = ed.blankRow('activity', {
    id: 'a1', sort: 2048, activity_id: 'CDRL 9.04.27', description: 'IXL Regression Testing',
    location: 'W40', sswp: '660', party: 'STS', work_hours: '0700-1500',
  });
  const names = ed.blankRow('resource', { id: 'r1', parent_id: 'a1', sort: 2049 });
  const cable = ed.blankRow('activity', { id: 'a2', sort: 3072, description: 'Cable pull', location: 'Y10', work_hours: '2200-0600' });
  const pto = ed.blankRow('absence', { id: 'p1', sort: 4096, description: 'PTO', absence_kind: 'pto' });
  const cells = [
    { row_id: 'a1', day: '2026-09-21', color: 'FFFF00', text: 'X.WIT' },
    { row_id: 'a1', day: '2026-09-22', color: 'FFFF00', text: 'X.X' },
    { row_id: 'a1', day: '2026-09-23', color: 'FF0000', text: 'X.WIT' },
    { row_id: 'r1', day: '2026-09-21', color: null, text: 'Victor, Rosa' },
    { row_id: 'a2', day: '2026-09-24', color: '000000', text: 'X.TCE.WIT' },
    { row_id: 'p1', day: '2026-09-25', color: null, text: 'Dana' },
  ];
  return ed.makeModel([section, ixl, names, cable, pto], cells);
}

/* ══════════════════════════════════════════════════════════════════════════
   Days and rows
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nDays and rows');
{
  const days = ed.windowDays('2026-09-23', 4);
  check('a window starts on the Monday of the week asked for', days[0] === '2026-09-21');
  check('four weeks is twenty-eight days, weekends included', days.length === 28 && days[27] === '2026-10-18');
  check('five weeks is the most the editor offers', ed.WINDOW_WEEKS.includes(5) && ed.windowDays('2026-09-23', 5).length === 35);
  check('weekday letters are the sheet\'s own', ['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su'].every((l, i) => ed.weekdayLetter(days[i]) === l));
  check('weekends are weekends', ed.isWeekend('2026-09-26') && ed.isWeekend('2026-09-27') && !ed.isWeekend('2026-09-28'));

  const m = sample();
  const order = ed.orderedRows(m.rows).map((r) => r.id);
  check('rows come out in sheet order, each activity followed by its names',
    order.join(',') === 's1,a1,r1,a2,p1', order.join(','));

  // A Resource row with a sort key far away still follows its activity.
  m.rows.find((r) => r.id === 'r1').sort = 99999;
  check('names follow their activity whatever their own sort key says',
    ed.orderedRows(m.rows).map((r) => r.id).join(',') === 's1,a1,r1,a2,p1');

  const ordered = ed.orderedRows(m.rows);
  check('a section\'s block runs to the next section', ed.sectionBlock(ordered, 0).join() === '0,4');
  check('an activity\'s block carries its Resource row', ed.rowBlock(ordered, 1).join() === '1,2');
  check('a sort key lands between its neighbours', ed.sortBetween(1024, 2048) === 1536 && ed.sortBetween(null, 1024) < 1024);

  m.rows.push(ed.blankRow('activity', { id: 'x', sort: 2048 + 1e-9 }));
  check('neighbours a hair apart ask to be respaced', ed.needsRespace(ed.orderedRows(m.rows)));
  const respaced = ed.respace(ed.orderedRows(m.rows));
  check('respacing touches only top-level rows', respaced.length > 0 && !respaced.some((o) => o.id === 'r1'));

  m.rows.find((r) => r.id === 'a2').archived = true;
  check('an archived row leaves the sheet', !ed.orderedRows(m.rows).some((r) => r.id === 'a2'));
  check('and comes back when asked for', ed.orderedRows(m.rows, { archived: true }).some((r) => r.id === 'a2'));
}

/* ══════════════════════════════════════════════════════════════════════════
   Support codes
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nSupport codes');
{
  check('"X.WIT" is an EIC and a witness', ed.supportTokens('X.WIT').join() === 'X,WIT');
  check('"X.X" is two EICs', ed.supportTokens('X.X').length === 2);
  check('spacing and case are how it was typed, not what it means',
    ed.supportTokens(' x . wit ').join() === 'X,WIT' && ed.normaliseSupport(' x . wit ') === 'X.WIT');
  const parsed = ed.parseSupport('X.ZZ.WIT', CODES);
  check('a code nobody registered is marked, not dropped', parsed.tokens.length === 3 && parsed.unknown.join() === 'ZZ');
  check('a retired code is unknown again',
    ed.parseSupport('TCE', CODES.map((c) => (c.code === 'TCE' ? { ...c, active: false } : c))).unknown.join() === 'TCE');

  const m = sample();
  const days = ed.windowDays('2026-09-21', 1);
  const totals = ed.supportTotals(m, days);
  check('a day counts every code on every activity',
    ed.describeCounts(totals.byDay.get('2026-09-22'), CODES) === '2 X', ed.describeCounts(totals.byDay.get('2026-09-22'), CODES));
  check('in the order the register lists them',
    ed.describeCounts(totals.byDay.get('2026-09-24'), CODES) === '1 X · 1 WIT · 1 TCE');
  check('names on a Resource or PTO row are never counted as codes',
    !totals.byDay.get('2026-09-25').size && !totals.byRow.has('r1'));
  check('an activity has its own total across the window',
    ed.describeCounts(totals.byRow.get('a1'), CODES) === '4 X · 2 WIT', ed.describeCounts(totals.byRow.get('a1'), CODES));
}

/* ══════════════════════════════════════════════════════════════════════════
   Names from the roster
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nNames from the roster');
{
  const people = [
    { name: 'Adam Kowalski' }, { name: 'Jimmy Chen' }, { name: 'Victor Okonkwo' }, { name: 'Victor Hale' },
    { name: 'Oleksii Bondar' }, { name: 'Retired Person', active: false },
  ];
  const choices = ed.nameChoices(people);
  check('a first name one person answers to is written as the first name',
    choices.find((c) => c.full === 'Adam Kowalski')?.insert === 'Adam');
  check('a first name two people share is written in full, so the register can place it',
    choices.filter((c) => /^Victor/.test(c.full)).every((c) => c.insert === c.full));
  check('somebody retired is not offered', !choices.some((c) => c.full === 'Retired Person'));
  check('the name being typed is what follows the last separator',
    ed.currentToken('Adam, Ji') === 'Ji' && ed.currentToken('Adam and Vi') === 'Vi' && ed.currentToken('Ol') === 'Ol');
  check('typing the start of a first name suggests it', ed.suggestNames('Adam, ji', choices)[0]?.insert === 'Jimmy');
  check('so does the start of a surname', ed.suggestNames('Bon', choices)[0]?.insert === 'Oleksii');
  check('both Victors are offered, in full', ed.suggestNames('vic', choices).map((c) => c.insert).join('|') === 'Victor Hale|Victor Okonkwo');
  check('nobody already in the cell is offered again', !ed.suggestNames('Adam, Jimmy, a', choices).some((c) => c.insert === 'Adam'));
  check('an empty piece suggests nothing', ed.suggestNames('Adam, ', choices).length === 0);
  check('choosing replaces only the piece being typed', ed.acceptName('Adam, ji', 'Jimmy') === 'Adam, Jimmy'
    && ed.acceptName('ol', 'Oleksii') === 'Oleksii');
}

/* ══════════════════════════════════════════════════════════════════════════
   Ops and undo
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nOps and undo');
{
  const m = sample();
  const snapshot = () => JSON.stringify({
    rows: ed.orderedRows(m.rows, { archived: true }).map(({ version, ...r }) => r),
    cells: ed.cellList(m).map(({ version, ...c }) => c).sort((a, b) => (a.row_id + a.day).localeCompare(b.row_id + b.day)),
  });
  const before = snapshot();

  const paint = [
    { op: 'cell', row_id: 'a2', day: '2026-09-25', color: 'FFFF00', text: 'X' },
    { op: 'cell', row_id: 'a1', day: '2026-09-21', color: 'FFC000', text: 'X.WIT' },
  ];
  const undoPaint = ed.applyOps(m, paint);
  check('painting a cell sets its colour and support', ed.getCell(m, 'a2', '2026-09-25')?.color === 'FFFF00');
  ed.applyOps(m, undoPaint);
  check('undo puts every cell back as it was', snapshot() === before);

  const clear = [{ op: 'cell', row_id: 'a1', day: '2026-09-21', color: null, text: '' }];
  const undoClear = ed.applyOps(m, clear);
  check('clearing a cell removes it', !ed.getCell(m, 'a1', '2026-09-21'));
  ed.applyOps(m, undoClear);
  check('and undo brings back colour and text together', ed.getCell(m, 'a1', '2026-09-21')?.text === 'X.WIT');

  const del = ed.deleteOps(m, ['a1']);
  check('deleting an activity takes its names and every cell with it',
    del.filter((o) => o.op === 'delete_row').map((o) => o.id).join() === 'r1,a1'
    && del.filter((o) => o.op === 'cell').length === 4);
  const undoDelete = ed.applyOps(m, del);
  check('it is gone', !m.rows.some((r) => r.id === 'a1' || r.id === 'r1'));
  ed.applyOps(m, undoDelete);
  check('and one undo brings back the activity, its names and all its cells', snapshot() === before);

  const insert = [{ op: 'row', id: 'n1', set: { kind: 'activity', sort: 2500, description: 'New work' } }];
  const undoInsert = ed.applyOps(m, insert);
  check('a new row is placed by its sort key', ed.orderedRows(m.rows).map((r) => r.id).indexOf('n1') === 3);
  ed.applyOps(m, undoInsert);
  check('and undoing it removes it', snapshot() === before);

  const rename = [{ op: 'row', id: 'a2', set: { description: 'Cable pull, north end', location: 'Y11' } }];
  const undoRename = ed.applyOps(m, rename);
  ed.applyOps(m, undoRename);
  check('an edited row goes back field for field', snapshot() === before);

  // Versions: what the server is told to expect.
  m.cells.get(ed.cellKey('a1', '2026-09-21')).version = 7;
  m.rows.find((r) => r.id === 'a2').version = 3;
  const stamped = ed.stamp(m, [
    { op: 'cell', row_id: 'a1', day: '2026-09-21', color: null, text: '' },
    { op: 'cell', row_id: 'a1', day: '2026-10-01', color: 'FFFF00', text: '' },
    { op: 'row', id: 'a2', set: { location: 'Y12' } },
    { op: 'row', id: 'brand-new', set: { kind: 'activity' } },
  ]);
  check('an edit expects the version it last saw',
    stamped[0].expect === 7 && stamped[2].expect === 3, stamped.map((s) => s.expect).join());
  check('a new cell or row expects nothing to be there', stamped[1].expect === 0 && stamped[3].expect === 0);
  ed.acknowledge(m, [{ kind: 'cell', row_id: 'a1', day: '2026-09-21', version: 8 }, { kind: 'row', id: 'a2', version: 4 }]);
  check('the server\'s answer becomes the next expectation',
    ed.getCell(m, 'a1', '2026-09-21').version === 8 && m.rows.find((r) => r.id === 'a2').version === 4);
}

console.log('\nGoing back to an earlier moment');
{
  // Simulate the log: apply batches to a model, recording what each op did.
  const m = sample();
  const log = [];
  let id = 0;
  const record = (batch, ops) => {
    for (const op of ops) {
      if (op.op === 'cell') {
        const was = ed.getCell(m, op.row_id, op.day);
        const gone = !op.color && !op.text;
        log.push({ id: ++id, batch, target: 'cell', row_id: op.row_id, day: op.day,
          action: was ? (gone ? 'delete' : 'update') : 'insert', before: was ? { ...was } : null });
      } else if (op.op === 'row') {
        const was = m.rows.find((r) => r.id === op.id);
        log.push({ id: ++id, batch, target: 'row', row_id: op.id, action: was ? 'update' : 'insert', before: was ? { ...was } : null });
      } else {
        const was = m.rows.find((r) => r.id === op.id);
        log.push({ id: ++id, batch, target: 'row', row_id: op.id, action: 'delete', before: { ...was } });
      }
      ed.applyOps(m, [op]);
    }
  };
  const snapshot = () => JSON.stringify({
    rows: ed.orderedRows(m.rows, { archived: true }).map(({ version, ...r }) => r),
    cells: ed.cellList(m).map(({ version, ...c }) => c).sort((a, b) => (a.row_id + a.day).localeCompare(b.row_id + b.day)),
  });
  const before = snapshot();

  record('b1', [{ op: 'cell', row_id: 'a1', day: '2026-09-21', color: 'FF0000', text: 'X.WIT' }]);
  record('b2', [{ op: 'row', id: 'n1', set: { kind: 'activity', sort: 2500, description: 'Added later' } },
    { op: 'cell', row_id: 'n1', day: '2026-09-22', color: 'FFFF00', text: 'X' }]);
  record('b3', ed.deleteOps(m, ['a2']));
  record('b4', [{ op: 'row', id: 'a1', set: { location: 'Y10' } },
    { op: 'cell', row_id: 'a1', day: '2026-09-21', color: 'FFFF00', text: 'X.X' }]);
  check('the log has done its damage', snapshot() !== before);

  const back = ed.restoreOps(m, log);
  ed.applyOps(m, back);
  check('restoring to before the first save puts everything back exactly', snapshot() === before);
  check('a row added since is removed, cells first', back.findIndex((o) => o.op === 'delete_row' && o.id === 'n1')
    > back.findIndex((o) => o.op === 'cell' && o.row_id === 'n1'));
  check('a row deleted since comes back with its cells, before they are refilled',
    back.findIndex((o) => o.op === 'row' && o.id === 'a2') < back.findIndex((o) => o.op === 'cell' && o.row_id === 'a2'));

  // Part-way: back to before batch 3 only.
  const m2 = sample();
  const log2 = [];
  let id2 = 0;
  const rec2 = (batch, ops) => {
    for (const op of ops) {
      const was = op.op === 'cell' ? ed.getCell(m2, op.row_id, op.day) : m2.rows.find((r) => r.id === op.id);
      log2.push({ id: ++id2, batch, target: op.op === 'cell' ? 'cell' : 'row', row_id: op.row_id || op.id, day: op.day,
        action: op.op === 'delete_row' ? 'delete' : was ? 'update' : 'insert', before: was ? { ...was } : null });
      ed.applyOps(m2, [op]);
    }
  };
  rec2('b1', [{ op: 'cell', row_id: 'a1', day: '2026-09-21', color: 'FF0000', text: 'X.WIT' }]);
  rec2('b2', [{ op: 'cell', row_id: 'a1', day: '2026-09-21', color: 'FFFF00', text: 'X' }]);
  const partial = ed.restoreOps(m2, log2.filter((e) => e.batch === 'b2'));
  ed.applyOps(m2, partial);
  check('restoring part-way keeps what came before', ed.getCell(m2, 'a1', '2026-09-21')?.color === 'FF0000');
  check('nothing already as it was is touched', ed.restoreOps(m2, log2.filter((e) => e.batch === 'b2')).length === 0);

  const points = ed.restorePoints(log);
  check('restore points are the saves, newest first, with how much each changed',
    points.map((p) => p.batch).join(',') === 'b4,b3,b2,b1' && points.find((p) => p.batch === 'b2').count === 2);
}

/* ══════════════════════════════════════════════════════════════════════════
   Fill and clipboard
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nFill and clipboard');
{
  const pattern = [[{ color: 'FFFF00', text: 'X.WIT' }, { color: null, text: '' }]];
  const filled = ed.tile(pattern, 2, 5);
  check('the fill handle repeats the pattern', filled[0].map((c) => c.text).join('|') === 'X.WIT||X.WIT||X.WIT');
  check('down as well as across', filled[1][2].color === 'FFFF00');

  const block = [[{ color: 'FFFF00', text: 'X.WIT' }, { color: null, text: 'Victor, Rosa' }], [{ color: 'FF0000', text: '' }, { color: null, text: 'a\tb' }]];
  const tsv = ed.toTSV(block);
  check('copied cells are tab-separated text any spreadsheet reads', tsv === 'X.WIT\tVictor, Rosa\r\n\ta b');
  check('and read back the same way', ed.fromTSV('X\tWIT\r\nA\tB\r\n').map((r) => r.map((c) => c.text).join('|')).join('/') === 'X|WIT/A|B');
  const html = ed.toHTML(block);
  check('the HTML copy carries the colours Excel pastes', /background:#FFFF00/.test(html) && /background:#FF0000/.test(html));
  check('and escapes what it must', !/<b>/.test(ed.toHTML([[{ color: null, text: '<b>' }]])));
}

/* ══════════════════════════════════════════════════════════════════════════
   The published grid
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nThe published grid');
{
  const m = sample();
  const days = ed.windowDays('2026-09-21', 5);
  const grid = ed.gridFromModel(m, days, { title: 'CBTC Four Week Look-Ahead' });
  const view = cls.readGrid(la.applyLegend(grid, LEGEND), { anchorISO: '2026-09-23' });

  check('the date axis is found the way the workbook\'s was', view.days.length === 35
    && view.days[0].date === '2026-09-21' && view.days[34].date === '2026-10-25',
  `${view.days[0]?.date} … ${view.days.at(-1)?.date}`);
  check('with the sheet\'s own column headings', view.headings.join('|')
    === 'Activity ID|Description of Work Activity|Location|SSWP#|Party to Action|Work Hours', view.headings.join('|'));
  const byLabel = (text) => view.activities.find((a) => a.meta.includes(text));
  check('a section is a heading', byLabel('W40 — Testing and Commissioning')?.heading === true);
  const ixl = byLabel('IXL Regression Testing');
  check('an activity keeps its six columns', ixl && ixl.meta.join('|') === 'CDRL 9.04.27|IXL Regression Testing|W40|660|STS|0700-1500');
  check('and its paint, as shifts', ixl?.highlighted && ixl.marks.filter((mk) => mk.role === 'shift').length === 3);
  check('its names come through as its Resource row',
    ixl?.resource?.names[0]?.names.join(',') === 'Victor,Rosa');
  check('a PTO row is an absence, not work', byLabel('PTO')?.absence === 'pto');
  check('a section band never lands on the days, where it would read as a shift',
    !grid.rows.some((r) => r.cells.some((c) => c.col >= ed.LAYOUT.firstDayCol && c.hex === ed.SECTION_BAND)));
  check('the month band is merged across each month',
    grid.merges.includes('H4:Q4') && grid.merges.some((mg) => /^R4:/.test(mg)), grid.merges.filter((x) => /4:/.test(x)).join(' '));
  check('the six headings are merged down through the header', grid.merges.includes('B2:B6') && grid.merges.includes('G2:G6'));

  const rows = await cls.rowsFrom(view, { snapshotId: 's', locate: async () => null });
  check('what the rest of the calendar derives from it still derives',
    rows.some((r) => /IXL Regression Testing/.test(r.raw_label)) && rows.some((r) => /Cable pull/.test(r.raw_label)), `${rows.length} row(s)`);
}

console.log('\nCancellations, as the log will know them');
{
  const m = sample();
  const days = ed.windowDays('2026-09-21', 5);
  const view = cls.readGrid(la.applyLegend(ed.gridFromModel(m, days), LEGEND), { anchorISO: '2026-09-23' });
  const published = await cls.rowsFrom(view, { snapshotId: 's', locate: async () => null });
  for (const id of ['a1', 'a2']) {
    const row = m.rows.find((r) => r.id === id);
    const key = ed.cancellationKey(row);
    const hit = published.find((p) => p.raw_label === key.raw_label && (p.raw_location || '') === key.raw_location);
    check(`a note recorded in the editor is keyed as the log keys "${row.description}"`, Boolean(hit),
      `${key.raw_label} @ ${key.raw_location}`);
  }
  const runs = ed.dayRuns([
    { row: { id: 'a' }, day: '2026-09-21' }, { row: { id: 'a' }, day: '2026-09-22' },
    { row: { id: 'a' }, day: '2026-09-24' }, { row: { id: 'b' }, day: '2026-09-22' },
  ]);
  check('consecutive red days on one row are one cancellation',
    runs.map((r) => `${r.row.id}:${r.start}..${r.end}`).join(' ') === 'a:2026-09-21..2026-09-22 a:2026-09-24..2026-09-24 b:2026-09-22..2026-09-22',
    runs.map((r) => `${r.row.id}:${r.start}..${r.end}`).join(' '));
}

/* ══════════════════════════════════════════════════════════════════════════
   Starting from the workbook
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nStarting from the workbook');
{
  // Round trip: a model, published, read back and imported, is the same model.
  const m = sample();
  const days = ed.windowDays('2026-09-21', 5);
  const view = cls.readGrid(la.applyLegend(ed.gridFromModel(m, days), LEGEND), { anchorISO: '2026-09-23' });
  const { model, report } = ed.modelFromView(view, { fromISO: '2026-09-21', legend: LEGEND });
  const kinds = ed.orderedRows(model.rows).map((r) => r.kind).join(',');
  check('sections, activities, names and PTO all come across', kinds === 'section,activity,resource,activity,absence', kinds);
  check('with their cells', report.cells === 6, JSON.stringify(report));
  const ixl = model.rows.find((r) => r.description === 'IXL Regression Testing');
  check('and their columns', ixl?.activity_id === 'CDRL 9.04.27' && ixl.work_hours === '0700-1500');

  // Only what is still ahead.
  const later = ed.modelFromView(view, { fromISO: '2026-09-24', legend: LEGEND });
  check('the past stays behind with the old file',
    !later.model.rows.some((r) => r.description === 'IXL Regression Testing') && later.report.past > 0);
  check('a section with nothing ahead under it goes too... unless its activities remain',
    later.model.rows.some((r) => r.kind === 'section'), ed.orderedRows(later.model.rows).map((r) => r.kind).join(','));
  check('PTO rows always come across — they are the frame of the sheet',
    later.model.rows.some((r) => r.kind === 'absence'));

  // BART's shape: shading on weekends and colours nobody named are not carried.
  const buffer = buildLookaheadWorkbook();
  const parsed = la.parseSheet(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '4WLA Sept');
  const legend = [
    { argb: 'FFFF00', meaning: 'Day Shift', role: 'shift' },
    { argb: 'FFC000', meaning: 'Swing Shift', role: 'shift' },
  ];
  const fixture = cls.readGrid(la.applyLegend(parsed, legend), { anchorISO: '2026-09-09' });
  const from = fixture.days.find((d) => d.date)?.date;
  const imported = ed.modelFromView(fixture, { fromISO: from, legend });
  check('a workbook with its headings in other columns maps by heading',
    imported.model.rows.some((r) => r.description === 'IXL Regression' && r.location === 'TPSS 12'),
    ed.orderedRows(imported.model.rows).map((r) => `${r.kind}:${r.description}/${r.location}`).join(' '));
  check('an activity whose only paint is shading is not carried',
    !imported.model.rows.some((r) => r.description === 'Only shading'));
  check('the colours shading used are counted as left behind', imported.report.droppedColours > 0);
  check('the names under an activity come with it', imported.model.rows.some((r) => r.kind === 'resource'));
}

/* ══════════════════════════════════════════════════════════════════════════
   The Excel export
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nThe Excel export');
{
  const xl = await import(path.join(ROOT, 'src/io/la_xlsx.js'));
  const xw = await import(path.join(ROOT, 'src/io/xlsx_write.js'));
  const m = sample();
  // Something outside the window, which must not be exported.
  m.rows.push(ed.blankRow('activity', { id: 'old', sort: 5000, description: 'Finished last month' }));
  m.cells.set(ed.cellKey('old', '2026-08-03'), { row_id: 'old', day: '2026-08-03', color: 'FFFF00', text: 'X', version: 0 });
  m.cells.set(ed.cellKey('r1', '2026-09-22'), { row_id: 'r1', day: '2026-09-22', color: null, text: 'Oleksandr, Oleksii, Viktor', version: 0 });
  const days = ed.windowDays('2026-09-21', 4);
  const bytes = xl.lookaheadWorkbook({
    model: m, days, legend: LEGEND, codes: CODES, title: 'CBTC Four Week Look-Ahead',
  });
  const files = la.readZip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  check('it is a workbook: every part a spreadsheet needs is there',
    ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml'].every((n) => files.has(n)));
  const sheet = new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml'));

  const back = la.parseSheet(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '4WLA');
  const view = cls.readGrid(la.applyLegend(back, LEGEND), { anchorISO: '2026-09-23' });
  check('it reads back through the parser that reads BART\'s own file', view.days.length === 28
    && view.days[0].date === '2026-09-21' && view.days[27].date === '2026-10-18');
  check('the six headings are merged down B2:B6 … G2:G6',
    ['B2:B6', 'C2:C6', 'D2:D6', 'E2:E6', 'F2:F6', 'G2:G6'].every((mg) => back.merges.includes(mg)));
  check('each month is merged across its days on row 4',
    back.merges.includes('H4:Q4') && back.merges.includes('R4:AI4'), back.merges.filter((mg) => /4:/.test(mg)).join(' '));
  check('the header is frozen, activity columns and all',
    /<pane xSplit="7" ySplit="6" topLeftCell="H7"[^>]*state="frozen"/.test(sheet));
  check('the two heading-block rows are hidden, as on BART\'s sheet',
    /<row r="2" ht="102" customHeight="1" hidden="1">/.test(sheet) && /<row r="3"[^>]*hidden="1"/.test(sheet));
  check('column A is there and hidden, so B to G are the letters everybody knows',
    /<col min="1" max="1"[^>]*hidden="1"/.test(sheet));

  const ixl = view.activities.find((a) => a.meta.includes('IXL Regression Testing'));
  check('an activity comes out with its six columns', ixl?.meta.join('|') === 'CDRL 9.04.27|IXL Regression Testing|W40|660|STS|0700-1500',
    ixl?.meta.join('|'));
  const monday = view.days.find((d) => d.date === '2026-09-21').col;
  const mark = ixl?.marks.find((mk) => mk.col === monday);
  check('a painted day keeps its colour and its codes', mark?.hex === 'FFFF00' && mark.value === 'X.WIT', JSON.stringify(mark));
  check('a blanket shift is black with white writing',
    /<font><b\/><sz val="10"\/><color rgb="FFFFFFFF"\/>/.test(new TextDecoder().decode(files.get('xl/styles.xml'))));
  check('the names under it are its Resource row', ixl?.resource?.names[0]?.names.join(',') === 'Victor,Rosa');
  check('a section is a heading on the grey band',
    view.activities.some((a) => a.heading && a.meta.includes('W40 — Testing and Commissioning')));
  const saturday = view.days.find((d) => d.date === '2026-09-26').col;
  check('weekends are shaded, as they are on the sheet',
    back.rows.some((r) => r.cells.some((c) => c.col === saturday && c.hex === '7F7F7F')));
  check('PTO is written as BART writes it: a grey band, then the names',
    view.activities.some((a) => a.heading && a.meta.includes('PTO'))
      && view.activities.some((a) => a.absence === 'pto' && a.marks.some((mk) => mk.value === 'Dana')));
  check('only the weeks asked for — nothing from last month',
    !view.activities.some((a) => a.meta.includes('Finished last month')));
  check('the key says what each colour means', la.readLegend(back).map((e) => e.meaning).includes('Day Shift')
    || /Day Shift/.test(sheet));
  check('and what each code asks for', /EIC \(BART\)/.test(sheet) && /BART witness \(BART\)/.test(sheet));
  check('a cell of names is given the height to show all of them',
    /<row r="\d+" ht="[\d.]+" customHeight="1">(?:(?!<\/row>).)*Victor, Rosa/.test(sheet));
  check('the file is named for its window', xl.lookaheadFileName(days) === '4WLA 2026-09-21 to 2026-10-18.xlsx');
  check('the same look-ahead makes the same file', bytes.length === xl.lookaheadWorkbook({
    model: m, days, legend: LEGEND, codes: CODES, title: 'CBTC Four Week Look-Ahead',
  }).length);

  check('the ZIP checksum is the standard one', xw.crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
  check('control characters cannot corrupt the file', xw.xmlEscape('a\u0001b<c>') === 'ab&lt;c&gt;');
}

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
