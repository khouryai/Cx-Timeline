#!/usr/bin/env node
/**
 * The Excel export, opened by a real spreadsheet program.
 *
 * `test_la_edit.js` reads every export back through the application's own
 * parser — which proves the file says what was meant, but a parser written
 * alongside the writer can share its mistakes. This hands the file to
 * LibreOffice Calc instead, a different implementation of the format, and asks
 * it to do what the track allocation manager's Excel does: open it, and save
 * it again as a workbook of its own. The re-saved copy is then read back, so a
 * cell, a colour or a merge that Calc could not make sense of — and so dropped
 * on the way through — fails here rather than in somebody's inbox.
 *
 * Microsoft Excel itself does not run on the machines CI uses; this is the
 * nearest independent reader that does. It also renders a PDF, which proves
 * the page setup opens and prints.
 *
 * Skipped, and says so, where LibreOffice Calc is not installed. CI installs it.
 *
 *   node tools/test_xlsx_compat.js
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { pinNodeClock } from './lib/clock.js';

pinNodeClock();

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ed = await import(path.join(ROOT, 'src/core/la_edit.js'));
const la = await import(path.join(ROOT, 'src/io/lookahead.js'));
const cls = await import(path.join(ROOT, 'src/core/lookahead.js'));
const xl = await import(path.join(ROOT, 'src/io/la_xlsx.js'));

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

function soffice() {
  for (const bin of [process.env.CX_SOFFICE, 'soffice', 'libreoffice'].filter(Boolean)) {
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return bin;
  }
  return null;
}

const bin = soffice();
/* LibreOffice without Calc starts, and then says "source file could not be
   loaded" about every spreadsheet — which would read as the export being
   broken. On Linux, Calc is `libsclo.so`; elsewhere it comes with it. The name
   exactly: the core package alone carries `libscriptframe.so` and `libscnlo.so`,
   and a prefix match took either for Calc. */
const calcInstalled = Boolean(bin) && (process.platform !== 'linux'
  || spawnSync('sh', ['-c', 'ls /usr/lib/libreoffice/program/ 2>/dev/null | grep -qx "libsclo\\.so"']).status === 0);
if (!bin || !calcInstalled) {
  console.log('LibreOffice Calc is not installed here — skipped. (CI installs it: apt-get install libreoffice-calc)');
  console.log('\n0/0 checks passed (skipped)');
  process.exit(0);
}

const LEGEND = [
  { argb: 'FFFF00', meaning: 'Day Shift', role: 'shift' },
  { argb: '000000', meaning: 'Blanket Shift', role: 'shift' },
  { argb: 'FF0000', meaning: 'Cancellation', role: 'shift' },
];
const monday = ed.mondayOf(new Date().toISOString().slice(0, 10));
const day = (n) => ed.addDaysISO(monday, n);
const model = ed.makeModel([
  ed.blankRow('section', { id: 's1', sort: 1, description: 'W40 — Testing and Commissioning' }),
  ed.blankRow('activity', {
    id: 'a1', sort: 2, activity_id: 'CDRL 9.04.27', description: 'IXL Regression Testing',
    location: 'Tail Tracks\nEOL (W45) to W45 Gates', sswp: '660', party: 'STS', work_hours: '0700-1500',
  }),
  ed.blankRow('resource', { id: 'r1', parent_id: 'a1', sort: 3 }),
  ed.blankRow('activity', { id: 'a2', sort: 4, description: 'IXL Night Mode & "SAT" <testing>', location: 'Y10', work_hours: 'BLANKET' }),
  ed.blankRow('absence', { id: 'p1', sort: 5, description: 'PTO', absence_kind: 'pto' }),
], [
  { row_id: 'a1', day: day(0), color: 'FFFF00', text: 'X.WIT' },
  { row_id: 'a1', day: day(1), color: 'FFFF00', text: 'X.X' },
  { row_id: 'a1', day: day(2), color: 'FF0000', text: 'X.WIT' },
  { row_id: 'r1', day: day(0), color: null, text: 'Oleksandr, Oleksii, Viktor' },
  { row_id: 'a2', day: day(5), color: '000000', text: 'X.TCE.WIT' },
  { row_id: 'p1', day: day(3), color: null, text: 'Dana' },
]);
const days = ed.windowDays(monday, 4);
const bytes = xl.lookaheadWorkbook({
  model, days, legend: LEGEND, codes: [{ code: 'X', name: 'EIC', party: 'BART' }], title: 'Four Week Look-Ahead',
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-xlsx-'));
const home = path.join(dir, 'home');
fs.mkdirSync(home);
const src = path.join(dir, 'export.xlsx');
fs.writeFileSync(src, bytes);
const out = path.join(dir, 'resaved');
fs.mkdirSync(out);

function convert(to, target) {
  execFileSync(bin, ['--headless', '--norestore', '--convert-to', to, '--outdir', target, src], {
    env: { ...process.env, HOME: home },
    stdio: 'pipe',
    timeout: 180000,
  });
}

console.log('\nOpened and re-saved by LibreOffice Calc');
try {
  convert('xlsx:Calc MS Excel 2007 XML', out);
  convert('pdf', dir);
} catch (err) {
  check('LibreOffice opens the export', false, String(err.stderr || err.message).slice(0, 200));
}
const resavedPath = path.join(out, 'export.xlsx');
check('LibreOffice opens the export and saves it again', fs.existsSync(resavedPath));
check('and can print it', fs.existsSync(path.join(dir, 'export.pdf')) && fs.statSync(path.join(dir, 'export.pdf')).size > 1000);

if (fs.existsSync(resavedPath)) {
  const again = fs.readFileSync(resavedPath);
  const buf = again.buffer.slice(again.byteOffset, again.byteOffset + again.byteLength);
  const sheets = la.readSheets(la.readZip(buf)).map((s) => s.name);
  check('the sheet keeps its name', sheets.includes('4WLA'), sheets.join(', '));
  const grid = la.parseSheet(buf, '4WLA');
  const view = cls.readGrid(la.applyLegend(grid, LEGEND), { anchorISO: monday });
  check('the calendar comes through dated, all four weeks of it',
    view.days.length === 28 && view.days[0].date === monday, `${view.days.length} days from ${view.days[0]?.date}`);
  const ixl = view.activities.find((a) => a.meta.includes('IXL Regression Testing'));
  check('an activity keeps its six columns, line breaks included',
    ixl?.meta[0] === 'CDRL 9.04.27' && /Tail Tracks\s+EOL/.test(ixl?.meta[2] || ''), JSON.stringify(ixl?.meta));
  const col = (iso) => view.days.find((d) => d.date === iso)?.col;
  const at = (a, iso) => a?.marks.find((m) => m.col === col(iso));
  check('painted days keep their colours and codes',
    at(ixl, day(0))?.hex === 'FFFF00' && at(ixl, day(0))?.value === 'X.WIT'
      && at(ixl, day(2))?.hex === 'FF0000' && at(ixl, day(1))?.value === 'X.X',
    JSON.stringify([at(ixl, day(0)), at(ixl, day(2))]));
  check('the names row stays attached to its activity',
    ixl?.resource?.names[0]?.names.join(',') === 'Oleksandr,Oleksii,Viktor');
  const night = view.activities.find((a) => a.meta.some((m) => /Night Mode/.test(m)));
  check('text that needs escaping survives', night?.meta.includes('IXL Night Mode & "SAT" <testing>'), JSON.stringify(night?.meta));
  check('a blanket shift is still black', at(night, day(5))?.hex === '000000');
  check('the section is still a heading', view.activities.some((a) => a.heading && a.meta.includes('W40 — Testing and Commissioning')));
  check('PTO is still PTO', view.activities.some((a) => a.absence === 'pto' && a.marks.some((m) => m.value === 'Dana')));
  check('the headings are still merged down', ['B2:B6', 'C2:C6', 'G2:G6'].every((m) => grid.merges.includes(m)), grid.merges.slice(0, 8).join(' '));
  check('and each month across its days', grid.merges.some((m) => /^H4:/.test(m)));
  const sheetXml = new TextDecoder().decode(la.readZip(buf).get('xl/worksheets/sheet1.xml'));
  check('the header stays frozen', /state="frozen"/.test(sheetXml));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
