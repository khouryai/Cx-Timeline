/**
 * The look-ahead editor, driven in a browser — part of `smoke_calendar.js`,
 * which calls it with a signed-in administrator's page and the stubbed backend.
 *
 * Kept in a file of its own because it is a spreadsheet's worth of behaviour:
 * starting from the workbook, typing, painting, support codes, the fill handle,
 * copy and paste to and from Excel, rows and sections, undo, the other editor's
 * changes and conflicts with them, publishing to the rest of the calendar, and
 * the Excel export read back cell for cell.
 */

import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ed = await import(path.join(ROOT, 'src/core/la_edit.js'));
const la = await import(path.join(ROOT, 'src/io/lookahead.js'));
const cls = await import(path.join(ROOT, 'src/core/lookahead.js'));
const xl = await import(path.join(ROOT, 'src/io/la_xlsx.js'));

const META = ed.FIELDS.length;

export async function lookaheadEditor(page, { check, shot = null }) {
  // Tidying already run elsewhere in the suite, so this one counts only the editor's own.
  const tidyAtStart = await page.evaluate(() => window.__rc.compactCalls || 0);
  console.log('\nLook-ahead editor');
  const snap = async (name) => { if (shot) await page.screenshot({ path: shot.replace(/\.png$/, `-${name}.png`) }); };
  const monday = ed.mondayOf(new Date().toISOString().slice(0, 10));
  const day = (n) => ed.addDaysISO(monday, n);
  const col = (iso) => META + Math.round((Date.parse(iso) - Date.parse(monday)) / 864e5);

  const rowLoc = (desc) => page.locator('#rc-frame .lae-grid tbody tr', {
    has: page.locator('td.lae-meta-description', { hasText: new RegExp(`^${desc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
  }).first();
  const cell = (desc, iso) => rowLoc(desc).locator(`td[data-c="${col(iso)}"]`);
  const server = () => page.evaluate(() => ({
    rows: JSON.parse(JSON.stringify(window.__rc.rows.rc_la_rows || [])),
    cells: JSON.parse(JSON.stringify(window.__rc.rows.rc_la_cells || [])),
  }));
  const serverCell = async (desc, iso) => {
    const s = await server();
    const row = s.rows.find((r) => r.description === desc);
    return s.cells.find((c) => c.row_id === row?.id && c.day === iso) || null;
  };
  const saved = async () => {
    await page.waitForFunction(() => /All changes saved/.test(document.querySelector('#rc-frame .lae-status')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(150);
  };
  const grid = () => page.locator('#rc-frame .lae-scroll');

  /* ── Getting there ────────────────────────────────────────────────── */
  await page.keyboard.press('Escape');
  if (!(await page.locator('#rc-frame').isVisible())) {
    await page.locator('.ws-btn', { hasText: 'Calendar' }).click();
    await page.waitForSelector('#rc-frame .rc-tabs', { timeout: 10000 });
  }
  await page.locator('#rc-frame .rc-tab', { hasText: 'Look-ahead' }).click();
  await page.waitForTimeout(400);
  await page.locator('#rc-frame .rc-tab', { hasText: 'Editor' }).click();
  await page.waitForSelector('#rc-frame .lae-start', { timeout: 10000 });
  await snap('start');
  const startText = await page.locator('#rc-frame .lae-start').innerText();
  check('the editor starts by offering to carry the workbook across', /Start from the last reading of the workbook/.test(startText));
  check('or a workbook, or nothing', /Start from a workbook/.test(startText) && /Start with an empty look-ahead/.test(startText));

  // A workbook picked from disk is read and previewed before anything is written.
  const sampleModel = ed.makeModel([
    ed.blankRow('section', { id: 's', sort: 1024, description: 'From a file' }),
    ed.blankRow('activity', { id: 'a', sort: 2048, description: 'Picked from disk', location: 'W40' }),
  ], [{ row_id: 'a', day: monday, color: 'FFFF00', text: 'X.WIT' }]);
  const picked = xl.lookaheadWorkbook({ model: sampleModel, days: ed.windowDays(monday, 4), legend: [], codes: [] });
  await page.locator('#rc-frame .lae-start input[type="file"]').setInputFiles({
    name: 'lookahead.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(picked),
  });
  await page.waitForSelector('.cx-modal', { timeout: 8000 });
  const preview = await page.locator('.cx-modal').innerText();
  check('a workbook from disk is read and previewed before anything is written',
    /1 activity in 1 section/.test(preview) && /1 filled day /.test(preview), preview.replace(/\n/g, ' ').slice(0, 160));
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Cancel' }).click();
  check('and nothing is written until it is confirmed', (await server()).rows.length === 0);

  await page.locator('#rc-frame .lae-start-option', { hasText: 'last reading' }).locator('button').click();
  await page.waitForSelector('#rc-frame .lae-grid', { timeout: 15000 });
  await page.waitForTimeout(600);
  await snap('grid');

  const adopted = await server();
  check('starting writes the look-ahead into the calendar',
    adopted.rows.some((r) => r.kind === 'section') && adopted.rows.some((r) => r.description === 'IXL Regression Testing')
      && adopted.cells.length > 0, `${adopted.rows.length} rows, ${adopted.cells.length} cells`);
  check('with the names under their activity',
    adopted.rows.some((r) => r.kind === 'resource' && r.parent_id === adopted.rows.find((x) => x.description === 'IXL Regression Testing')?.id));
  check('and the calendar is now the source',
    await page.evaluate(() => window.__rc.rows.rc_settings.some((r) => r.key === 'lookahead_source' && r.value === 'editor')));
  check('what was there is published, so every other screen reads it',
    await page.evaluate(() => window.__rc.rows.rc_lookahead_snapshots.some((s) => /^editor:/.test(s.file_hash || ''))));
  check('the grid is drawn as the sheet is: months, day numbers, weekday letters',
    (await page.locator('#rc-frame .lae-grid thead th.lae-month').count()) >= 1
      && (await page.locator('#rc-frame .lae-grid thead th.lae-wd').count()) === 28);
  check('four weeks by default', /4 weeks/i.test(await page.locator('#rc-frame .lae-toolbar .cx-seg button.active').innerText()));
  check('the palette is the legend\'s shift colours', (await page.locator('#rc-frame .lae-swatch:not(.lae-swatch-none)').count()) >= 2);
  check('and the support codes are one press each',
    (await page.locator('#rc-frame .lae-codes .lae-code').allInnerTexts()).join(',') === 'X,WIT,TCE');

  /* ── Typing ───────────────────────────────────────────────────────── */
  await cell('IXL Regression Testing', day(0)).click();
  await page.keyboard.type('x . wit');
  await page.keyboard.press('Enter');
  await saved();
  check('typing into a day writes it, as the sheet writes it', (await cell('IXL Regression Testing', day(0)).innerText()).trim() === 'X.WIT');
  check('and it is saved', (await serverCell('IXL Regression Testing', day(0)))?.text === 'X.WIT');
  check('Enter moves down, as a spreadsheet does',
    (await page.locator('#rc-frame td.lae-cur').getAttribute('data-c')) === String(col(day(0))));

  await cell('IXL Regression Testing', day(1)).dblclick();
  await page.waitForSelector('#rc-frame .lae-editor');
  check('double-click edits in place, with the support codes to hand',
    (await page.locator('#rc-frame .lae-edit-hint .lae-code').count()) === 3);
  await page.locator('#rc-frame .lae-editor').fill('X');
  await page.locator('#rc-frame .lae-edit-hint .lae-code', { hasText: 'WIT' }).click();
  await page.keyboard.press('Enter');
  await saved();
  check('a code button adds to what is being typed', (await serverCell('IXL Regression Testing', day(1)))?.text === 'X.WIT');

  await cell('IXL Regression Testing', day(2)).click();
  await page.keyboard.type('ZZ');
  await page.keyboard.press('Enter');
  await saved();
  check('a code nobody registered is kept as typed, and marked',
    await cell('IXL Regression Testing', day(2)).evaluate((n) => n.classList.contains('lae-unknown-code')));

  // The activity's own columns.
  await rowLoc('ATS Site Test').locator('td.lae-meta-location').dblclick();
  await page.locator('#rc-frame .lae-editor').fill('W40');
  await page.keyboard.press('Tab');
  await saved();
  check('an activity\'s columns edit in place',
    (await server()).rows.find((r) => r.description === 'ATS Site Test')?.location === 'W40');

  /* ── Names from the roster ────────────────────────────────────────── */
  const namesCell = rowLoc('Resource').locator(`td[data-c="${col(day(1))}"]`);
  await namesCell.click();
  await page.keyboard.type('pri');
  await page.waitForTimeout(150);
  const offered = await page.locator('#rc-frame .lae-names .lae-name').allInnerTexts();
  check('typing into a names row offers the roster', offered.includes('Priya'), offered.join(', '));
  await page.keyboard.press('Enter');
  check('Enter takes the name offered, and keeps the cell open for the next',
    (await page.locator('#rc-frame .lae-editor').inputValue()) === 'Priya'
      && (await page.locator('#rc-frame .lae-editor').count()) === 1);
  await page.keyboard.type(', ro');
  await page.waitForTimeout(100);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await saved();
  const namesSaved = await page.evaluate(({ iso }) => {
    const rows = window.__rc.rows.rc_la_rows;
    const res = rows.find((r) => r.kind === 'resource');
    return window.__rc.rows.rc_la_cells.find((c) => c.row_id === res.id && c.day === iso)?.text;
  }, { iso: day(1) });
  check('and a second name goes after a comma, as the sheet writes them', namesSaved === 'Priya, Rosa', namesSaved);

  /* ── Staffing: your team only ─────────────────────────────────────── */
  await page.evaluate(({ iso }) => {
    window.__rc.rows.rc_leave.push({
      id: 'lv-priya', person_id: 'p3', kind_id: 'k1', status: 'approved', start_date: iso, end_date: iso,
    });
  }, { iso: day(1) });
  await page.locator('#rc-frame .lae-toolbar button[aria-label="More"]').click();
  await page.locator('.cx-menu .cx-menu-item', { hasText: 'Reload from the server' }).click();
  await page.waitForSelector('#rc-frame td.lae-clash', { timeout: 5000 }).catch(() => {});
  const clashCell = rowLoc('Resource').locator(`td[data-c="${col(day(1))}"]`);
  check('a name on a day they have leave booked is marked, and says why',
    await clashCell.evaluate((n) => n.classList.contains('lae-clash') && /Priya has Annual leave booked/.test(n.title)),
    await clashCell.evaluate((n) => `${n.className} | ${n.title}`));
  const clashBtn = page.locator('#rc-frame .lae-clash-btn');
  const clashLabel = await clashBtn.textContent().catch(() => '');
  const clashTitles = await page.locator('#rc-frame td.lae-clash').evaluateAll((ns) => ns.map((n) => n.title).join('\n'));
  // The fixture's PTO row has Rosa off that day too — the sheet's own PTO row counts.
  check('named on the sheet\'s own PTO row the same day is a clash too', /Rosa is on the PTO row that day/.test(clashTitles), clashTitles);
  check('the toolbar counts the clashes', /^2 staffing clashes$/i.test(clashLabel.trim()), clashLabel);
  await clashBtn.click();
  await page.waitForSelector('.cx-modal .lae-clashes');
  const clashText = await page.locator('.cx-modal').innerText();
  check('the list says who, what and when, and counts no support', /On leave/.test(clashText) && /Priya/.test(clashText)
    && /Support requested is not counted/.test(clashText), clashText.replace(/\s+/g, ' ').slice(0, 200));
  await page.locator('.cx-modal .lae-clash-item button', { hasText: 'Show' }).first().click();
  check('and one press takes you to the cell', await page.evaluate(() => !document.querySelector('.cx-modal'))
    && await clashCell.evaluate((n) => n.classList.contains('lae-cur')));
  await page.evaluate(() => { window.__rc.rows.rc_leave = window.__rc.rows.rc_leave.filter((l) => l.id !== 'lv-priya'); });

  /* ── Who changed this day ─────────────────────────────────────────── */
  await cell('IXL Regression Testing', day(1)).click({ button: 'right' });
  await page.locator('.cx-menu .cx-menu-item', { hasText: 'History of this day' }).click();
  await page.waitForSelector('.cx-modal .lae-history-item', { timeout: 5000 }).catch(() => {});
  const hist = await page.locator('.cx-modal .lae-history-item').allInnerTexts();
  check('a day\'s history says who changed it, from what to what',
    hist.length >= 1 && /Alex/.test(hist[0]) && /empty\s*X\.WIT/.test(hist[hist.length - 1]), hist.join(' | ').replace(/\s+/g, ' ').slice(0, 240));
  await page.locator('.cx-modal button', { hasText: 'Close' }).click();
  await rowLoc('ATS Site Test').locator('td.lae-handle').click({ button: 'right' });
  await page.locator('.cx-menu .cx-menu-item', { hasText: 'History of this row' }).click();
  await page.waitForSelector('.cx-modal .lae-history-item', { timeout: 5000 }).catch(() => {});
  const rowHist = await page.locator('.cx-modal .lae-history-item').allInnerTexts();
  check('and a row\'s history names the field that changed', rowHist.some((t) => /Location: .*W40/.test(t)), rowHist.join(' | ').slice(0, 240));
  await page.locator('.cx-modal button', { hasText: 'Close' }).click();

  /* ── Painting and support ─────────────────────────────────────────── */
  const yellow = page.locator('#rc-frame .lae-swatch[aria-label="Paint Day Shift"]');
  await cell('IXL Regression Testing', day(0)).click();
  await cell('IXL Regression Testing', day(2)).click({ modifiers: ['Shift'] });
  await yellow.click();
  await saved();
  const painted = await server();
  const ixlId = painted.rows.find((r) => r.description === 'IXL Regression Testing').id;
  check('a range of days is painted with one press',
    [0, 1, 2].every((n) => painted.cells.find((c) => c.row_id === ixlId && c.day === day(n))?.color === 'FFFF00'));
  check('painting keeps what was written', painted.cells.find((c) => c.row_id === ixlId && c.day === day(0))?.text === 'X.WIT');

  await page.locator('#rc-frame .lae-codes .lae-code', { hasText: 'WIT' }).click();
  await saved();
  check('a support code is added to every selected day',
    (await serverCell('IXL Regression Testing', day(0)))?.text === 'X.WIT.WIT'
      && (await serverCell('IXL Regression Testing', day(2)))?.text === 'ZZ.WIT');
  await page.locator('#rc-frame .lae-codes .lae-code', { hasText: 'WIT' }).click({ modifiers: ['Shift'] });
  await saved();
  check('and Shift takes one away again', (await serverCell('IXL Regression Testing', day(0)))?.text === 'X.WIT');

  const total = await page.locator(`#rc-frame .lae-totals td:nth-child(${2 + 1 + (col(day(0)) - META) + 1})`).innerText();
  check('the day\'s support is totalled under the grid', /1 X/.test(total) && /1 WIT/.test(total), total.replace(/\n/g, ' · '));

  const beforeAlt = (await serverCell('IXL Regression Testing', day(3)))?.text || '';
  await cell('IXL Regression Testing', day(3)).click();
  await page.keyboard.press('Alt+3');
  await saved();
  check('Alt and a number paints with that legend colour',
    ((await serverCell('IXL Regression Testing', day(3)))?.color || '') !== '', JSON.stringify(await serverCell('IXL Regression Testing', day(3))));

  /* Painting a day in the cancellation colour asks who and why, there and then. */
  const cancelled = (await serverCell('IXL Regression Testing', day(3)))?.color === 'FF0000';
  check('the third colour here is the cancellation colour', cancelled);
  await page.waitForSelector('.cx-modal', { timeout: 3000 }).catch(() => {});
  const why = page.locator('.cx-modal', { hasText: 'Why was this cancelled?' });
  check('painting a day red asks why, at the moment it happens', (await why.count()) === 1);
  await why.locator('select').selectOption('Hitachi');
  await why.locator('textarea').fill('Crew reallocated to Y10');
  const notesBefore = await page.evaluate(() => (window.__rc.rows.rc_cancellation_notes || []).length);
  await why.locator('.cx-modal-foot button', { hasText: 'Record' }).click();
  await page.waitForTimeout(400);
  const note = await page.evaluate(() => (window.__rc.rows.rc_cancellation_notes || []).slice(-1)[0]);
  check('and records it in the cancellation log, keyed as the log keys the event',
    (await page.evaluate(() => (window.__rc.rows.rc_cancellation_notes || []).length)) === notesBefore + 1
      && note?.party === 'Hitachi' && note?.reason === 'Crew reallocated to Y10'
      && /IXL Regression Testing/.test(note?.raw_label) && note?.start_date === day(3) && note?.end_date === day(3),
    JSON.stringify(note));
  await grid().focus();
  await page.keyboard.press('Alt+0');
  await saved();
  check('and Alt+0 takes the colour off, keeping the codes',
    !(await serverCell('IXL Regression Testing', day(3)))?.color
      && ((await serverCell('IXL Regression Testing', day(3)))?.text || '') === beforeAlt,
    JSON.stringify(await serverCell('IXL Regression Testing', day(3))));

  const names = rowLoc('Resource').locator(`td[data-c="${col(day(0))}"]`);
  await names.click();
  await yellow.click();
  await page.waitForTimeout(200);
  check('a row of names is not painted — only an activity\'s days take a colour',
    !(await names.evaluate((n) => n.classList.contains('lae-painted'))));

  /* ── The fill handle ──────────────────────────────────────────────── */
  await cell('IXL Regression Testing', day(0)).click();
  await cell('IXL Regression Testing', day(1)).click({ modifiers: ['Shift'] });
  const handle = page.locator('#rc-frame .lae-fill-handle');
  const hb = await handle.boundingBox();
  const target = await cell('IXL Regression Testing', day(6)).boundingBox();
  await page.mouse.move(hb.x + 3, hb.y + 3);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
  await saved();
  const filled = await server();
  const f = (n) => filled.cells.find((c) => c.row_id === ixlId && c.day === day(n));
  check('dragging the corner repeats the selection along the row',
    [2, 3, 4, 5, 6].every((n) => f(n)?.text === 'X.WIT' && f(n)?.color === 'FFFF00'),
    [2, 4, 6].map((n) => `${f(n)?.text}/${f(n)?.color}`).join(' '));
  await snap('filled');

  /* ── Undo and redo ────────────────────────────────────────────────── */
  await grid().focus();
  await page.keyboard.press('Control+z');
  await saved();
  check('one undo takes back the whole fill', !(await serverCell('IXL Regression Testing', day(6)))
    && (await serverCell('IXL Regression Testing', day(1)))?.text === 'X.WIT');
  await page.keyboard.press('Control+y');
  await saved();
  check('and redo puts it back', (await serverCell('IXL Regression Testing', day(6)))?.text === 'X.WIT',
    `${JSON.stringify(await serverCell('IXL Regression Testing', day(6)))} ${await page.locator('#rc-frame .lae-status').innerText()} ${await page.evaluate(() => document.activeElement?.className)}`);

  /* ── Copy and paste, to and from Excel ────────────────────────────── */
  await cell('IXL Regression Testing', day(0)).click();
  await cell('IXL Regression Testing', day(1)).click({ modifiers: ['Shift'] });
  const copied = await page.evaluate(() => {
    const dt = new DataTransfer();
    document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return { text: dt.getData('text/plain'), html: dt.getData('text/html') };
  });
  check('copying puts plain text on the clipboard for anything', copied.text === 'X.WIT\tX.WIT', JSON.stringify(copied.text));
  check('and a coloured table for Excel', /background:#FFFF00/.test(copied.html));

  await cell('ATS Site Test', day(7)).click();
  await page.evaluate((payload) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', payload.text);
    dt.setData('text/html', payload.html);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, copied);
  await saved();
  check('pasting brings the colours and the codes',
    (await serverCell('ATS Site Test', day(7)))?.color === 'FFFF00' && (await serverCell('ATS Site Test', day(8)))?.text === 'X.WIT');

  // What Excel itself puts on the clipboard: a stylesheet of classes.
  await cell('ATS Site Test', day(14)).click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'X\tX.TCE\tX');
    dt.setData('text/html', '<html><head><style>.xl65{background:yellow;mso-pattern:black none;}.xl66{background:#123456;}'
      + '</style></head><body><table><tr><td class=xl65>X</td><td style="background:#FF0000">X.TCE</td>'
      + '<td class=xl66>X</td></tr></table></body></html>');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await saved();
  check('a paste from Excel keeps its legend colours, whichever way Excel wrote them',
    (await serverCell('ATS Site Test', day(14)))?.color === 'FFFF00' && (await serverCell('ATS Site Test', day(15)))?.color === 'FF0000');
  check('and a colour the legend does not know is left off rather than guessed',
    !(await serverCell('ATS Site Test', day(16)))?.color && (await serverCell('ATS Site Test', day(16)))?.text === 'X');

  // One value into a range fills it.
  await cell('ATS Site Test', day(21)).click();
  await cell('ATS Site Test', day(23)).click({ modifiers: ['Shift'] });
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'WIT');
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await saved();
  const spread = [];
  for (const n of [21, 22, 23]) spread.push((await serverCell('ATS Site Test', day(n)))?.text);
  check('one value pasted into a range fills it', spread.every((t) => t === 'WIT'), spread.join(','));

  /* ── Delete ───────────────────────────────────────────────────────── */
  await cell('ATS Site Test', day(21)).click();
  await cell('ATS Site Test', day(23)).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Delete');
  await saved();
  check('Delete clears the selected days', !(await serverCell('ATS Site Test', day(22))));

  /* ── Rows and sections ────────────────────────────────────────────── */
  await cell('ATS Site Test', day(0)).click();
  await page.locator('#rc-frame .lae-toolbar button', { hasText: 'Activity' }).click();
  await page.waitForSelector('#rc-frame .lae-editor');
  await page.keyboard.type('Cable pull');
  await page.keyboard.press('Enter');
  await saved();
  let rows = (await server()).rows;
  const cable = rows.find((r) => r.description === 'Cable pull');
  const ats = rows.find((r) => r.description === 'ATS Site Test');
  check('a new activity goes below the selected one, ready to be named',
    cable && cable.kind === 'activity' && cable.sort > ats.sort);
  check('with a names row under it', rows.some((r) => r.kind === 'resource' && r.parent_id === cable?.id));

  await rowLoc('Cable pull').locator('td.lae-handle').click({ button: 'right' });
  await page.locator('.cx-menu .cx-menu-item', { hasText: 'Insert section above' }).click();
  await page.waitForSelector('#rc-frame .lae-editor');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Y10 — Testing and Commissioning');
  await page.keyboard.press('Enter');
  await saved();
  rows = (await server()).rows;
  const y10 = rows.find((r) => r.description === 'Y10 — Testing and Commissioning');
  check('a section goes where it was asked for', y10?.kind === 'section'
    && y10.sort < rows.find((r) => r.description === 'Cable pull').sort
    && y10.sort > rows.find((r) => r.description === 'ATS Site Test').sort);
  await snap('rows');

  // Drag a row by its grip: Cable pull above IXL Regression Testing.
  const grip = rowLoc('Cable pull').locator('td.lae-handle');
  const gb = await grip.boundingBox();
  const tb = await rowLoc('IXL Regression Testing').locator('td.lae-handle').boundingBox();
  await page.mouse.move(gb.x + 10, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + 10, tb.y + 4, { steps: 10 });
  check('dragging a row shows where it will land', (await page.locator('#rc-frame .lae-drop-line').count()) === 1);
  await page.mouse.up();
  await saved();
  rows = (await server()).rows;
  check('and it lands there, its names with it',
    rows.find((r) => r.description === 'Cable pull').sort < rows.find((r) => r.description === 'IXL Regression Testing').sort
      && rows.find((r) => r.kind === 'resource' && r.parent_id === rows.find((x) => x.description === 'Cable pull').id));
  const order = await page.locator('#rc-frame .lae-grid tbody td.lae-meta-description').allInnerTexts();
  check('the names follow on screen too',
    order.indexOf('Cable pull') + 1 === order.indexOf('Resource') && order.indexOf('Cable pull') < order.indexOf('IXL Regression Testing'),
    order.join(' | '));

  await rowLoc('Cable pull').locator('td.lae-meta-description').click();
  await page.keyboard.press('Alt+ArrowDown');
  await saved();
  rows = (await server()).rows;
  check('Alt+↓ moves the selected row down past the next',
    rows.find((r) => r.description === 'Cable pull').sort > rows.find((r) => r.description === 'IXL Regression Testing').sort);

  // Fold a section.
  const sectionCount = await page.locator('#rc-frame .lae-grid tbody tr').count();
  await rowLoc('Y10 — Testing and Commissioning').locator('.lae-fold').click();
  check('a section folds away its rows', (await page.locator('#rc-frame .lae-grid tbody tr').count()) < sectionCount);
  await rowLoc('Y10 — Testing and Commissioning').locator('.lae-fold').click();

  // Archive and delete, both undoable.
  await rowLoc('Cable pull').locator('td.lae-handle').click({ button: 'right' });
  await page.locator('.cx-menu .cx-menu-item', { hasText: 'Archive' }).click();
  await saved();
  check('archiving takes a row off the sheet', (await rowLoc('Cable pull').count()) === 0
    && (await server()).rows.find((r) => r.description === 'Cable pull')?.archived === true);
  await grid().focus();
  await page.keyboard.press('Control+z');
  await saved();
  check('and undo brings it back', (await rowLoc('Cable pull').count()) === 1);

  await rowLoc('Cable pull').locator('td.lae-handle').click({ button: 'right' });
  await page.locator('.cx-menu .cx-menu-item', { hasText: 'Delete row' }).click();
  await saved();
  check('deleting removes the row and its names', !(await server()).rows.some((r) => r.description === 'Cable pull'));
  await page.locator('.cx-toast button', { hasText: 'Undo' }).last().click();
  await saved();
  rows = (await server()).rows;
  check('and the toast\'s Undo brings back both',
    rows.some((r) => r.description === 'Cable pull')
      && rows.some((r) => r.kind === 'resource' && r.parent_id === rows.find((x) => x.description === 'Cable pull')?.id));

  /* ── An activity's own panel ──────────────────────────────────────── */
  await rowLoc('IXL Regression Testing').locator('td.lae-handle').click({ button: 'right' });
  await page.locator('.cx-menu .cx-menu-item', { hasText: 'Details and support' }).click();
  await page.waitForSelector('.cx-modal');
  const details = await page.locator('.cx-modal').innerText();
  check('an activity\'s details total the support it asks for, by name',
    /× EIC/.test(details) && /× BART witness/.test(details), details.split('\n').slice(0, 12).join(' | '));
  check('day by day, with the shift and the names', /Day Shift/.test(details) && /Dan/.test(details));
  await page.locator('.cx-modal input').nth(4).fill('STS');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Save' }).click();
  await saved();
  check('and its columns can be edited there too',
    (await server()).rows.find((r) => r.description === 'IXL Regression Testing')?.party === 'STS');

  /* ── Take me back ─────────────────────────────────────────────────── */
  await cell('ATS Site Test', day(20)).click();
  await page.keyboard.type('X.TCE');
  await page.keyboard.press('Enter');
  await saved();
  await cell('ATS Site Test', day(20)).click();
  await page.keyboard.type('WIT');
  await page.keyboard.press('Enter');
  await saved();
  check('two saves to go back through', (await serverCell('ATS Site Test', day(20)))?.text === 'WIT');
  await page.locator('#rc-frame .lae-toolbar button[aria-label="More"]').click();
  await page.locator('.cx-menu .cx-menu-item', { hasText: 'Take me back' }).click();
  await page.waitForSelector('.cx-modal .lae-restore-point');
  const points = page.locator('.cx-modal .lae-restore-point');
  check('the saves are listed newest first, with who made them',
    (await points.count()) >= 2 && /Alex/.test(await points.first().innerText()), await points.first().innerText());
  await points.nth(1).click();
  const restoreText = await page.locator('.cx-modal').innerText();
  check('choosing one says how much going back reverses', /reverses 2 changes in 2 saves/.test(restoreText),
    restoreText.split('\n').slice(-3).join(' | '));
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Go back' }).click();
  await saved();
  check('going back puts the look-ahead as it was before that save', !(await serverCell('ATS Site Test', day(20))));
  await grid().focus();
  await page.keyboard.press('Control+z');
  await saved();
  check('and going back can itself be undone', (await serverCell('ATS Site Test', day(20)))?.text === 'WIT');
  check('the log keeps every step, the reversal included',
    (await page.evaluate(() => window.__rc.rows.rc_la_edits.length)) > 10);

  /* ── Five weeks, and another window ───────────────────────────────── */
  await page.locator('#rc-frame .lae-toolbar .cx-seg button', { hasText: '5 weeks' }).click();
  await page.waitForTimeout(300);
  check('five weeks shows one more week', (await page.locator('#rc-frame .lae-grid thead th.lae-wd').count()) === 35);
  await page.locator('#rc-frame .lae-toolbar button[aria-label="Next week"]').click();
  await page.waitForTimeout(400);
  check('and the window moves a week at a time',
    (await page.locator('#rc-frame .lae-grid thead th.lae-num').first().innerText()).trim() === String(Number(day(7).slice(8, 10))));
  await page.locator('#rc-frame .lae-toolbar button', { hasText: 'This week' }).click();
  await page.waitForTimeout(300);
  await page.locator('#rc-frame .lae-toolbar .cx-seg button', { hasText: '4 weeks' }).click();
  await page.waitForTimeout(300);

  /* ── The other editor ─────────────────────────────────────────────── */
  // Somebody else changes a day this page has not seen — and then this page
  // changes the same day, from its stale copy.
  await page.evaluate(({ id, iso }) => {
    const c = window.__rc.rows.rc_la_cells.find((x) => x.row_id === id && x.day === iso);
    c.text = 'X.TCE';
    c.version += 1;
    window.__rc.laRevision += 1;
  }, { id: ixlId, iso: day(4) });
  await cell('IXL Regression Testing', day(4)).click();
  await page.keyboard.type('X.X');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  check('writing over a day somebody else just changed is refused, and says so',
    (await page.locator('.cx-toast', { hasText: 'Somebody else changed the same thing' }).count()) >= 1);
  check('and the sheet shows their version, not a silent mix',
    (await cell('IXL Regression Testing', day(4)).innerText()).trim() === 'X.TCE'
      && (await serverCell('IXL Regression Testing', day(4)))?.text === 'X.TCE');

  // A change made elsewhere while this page is idle arrives on its own.
  await page.evaluate(({ id, iso }) => {
    window.__rc.rows.rc_la_cells.push({ row_id: id, day: iso, color: 'FF0000', text: 'X', version: 1 });
    window.__rc.laRevision += 1;
  }, { id: ixlId, iso: day(15) });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(800);
  check('the other editor\'s changes appear without a reload',
    (await cell('IXL Regression Testing', day(15)).innerText()).trim() === 'X');

  /* ── Support codes, managed here ──────────────────────────────────── */
  await page.locator('#rc-frame .rc-tab', { hasText: 'Legend' }).click();
  await page.waitForSelector('#rc-frame .lae-codes-admin', { timeout: 8000 });
  await page.locator('#rc-frame .lae-codes-admin button', { hasText: 'Add a code' }).click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input').nth(0).fill('zz');
  await page.locator('.cx-modal input').nth(1).fill('Zone controller');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Add' }).click();
  await page.waitForTimeout(500);
  check('a support code is added from the calendar',
    await page.evaluate(() => window.__rc.rows.rc_support_codes.some((c) => c.code === 'ZZ' && c.name === 'Zone controller')));
  await page.locator('#rc-frame .rc-tab', { hasText: 'Editor' }).click();
  await page.waitForSelector('#rc-frame .lae-grid');
  check('and the editor knows it at once — the marked day is no longer unknown',
    !(await cell('IXL Regression Testing', day(2)).evaluate((n) => n.classList.contains('lae-unknown-code')))
      && (await page.locator('#rc-frame .lae-codes .lae-code').allInnerTexts()).includes('ZZ'));

  /* ── Publishing: the rest of the calendar reads what was written ──── */
  await page.locator('#rc-frame .rc-tab', { hasText: 'Calendar' }).click();
  await page.waitForSelector('#rc-frame .la-grid', { timeout: 10000 });
  await page.waitForTimeout(300);
  const calendarText = await page.locator('#rc-frame .la-grid').innerText();
  check('the calendar shows what the editor wrote — the days pasted in from Excel included',
    /X\.TCE/.test(calendarText) && /ATS Site Test/.test(calendarText), calendarText.slice(0, 200).replace(/\n/g, ' '));
  check('and it no longer offers to read the workbook',
    (await page.locator('#rc-frame button', { hasText: 'Check now' }).count()) === 0
      && (await page.locator('#rc-frame button', { hasText: 'Edit the look-ahead' }).count()) === 1);
  await page.locator('#rc-frame button', { hasText: 'Edit the look-ahead' }).click();
  await page.waitForSelector('#rc-frame .lae-grid', { timeout: 8000 });

  /* ── Export to Excel ──────────────────────────────────────────────── */
  await page.locator('#rc-frame .lae-toolbar button', { hasText: 'Export to Excel' }).click();
  await page.waitForSelector('.cx-modal');
  const exportText = await page.locator('.cx-modal').innerText();
  check('the export says what it will hold', /activit/.test(exportText) && /4WLA layout/.test(exportText));
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Download' }).click();
  await page.waitForTimeout(800);
  const file = await page.evaluate(async () => ({
    name: window.__saved?.name || '',
    bytes: Array.from(new Uint8Array(await window.__lastBlob.arrayBuffer())),
  }));
  check('the download is named for its window', /^4WLA \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\.xlsx$/.test(file.name), file.name);
  const bytes = new Uint8Array(file.bytes);
  const back = la.parseSheet(bytes.buffer, '4WLA');
  const view = cls.readGrid(la.applyLegend(back, [{ argb: 'FFFF00', meaning: 'Day Shift', role: 'shift' }]), { anchorISO: monday });
  const ixl = view.activities.find((a) => a.meta.includes('IXL Regression Testing'));
  check('and it reads back as the 4WLA: the days, the headings merged, the activity with its codes',
    view.days.length === 28 && back.merges.includes('B2:B6')
      && ixl?.marks.some((m) => m.value === 'X.WIT' && m.hex === 'FFFF00'),
    `${view.days.length} days, ${back.merges.length} merges`);
  check('with what was pasted here, and nothing for rows with no work in those weeks',
    view.activities.some((a) => a.meta.includes('ATS Site Test') && a.marks.some((m) => m.value === 'X.TCE'))
      && !view.activities.some((a) => a.meta.includes('Cable pull')));
  await snap('end');

  check('after publishing, the editor tidies old readings — once a day from this browser',
    await page.evaluate((n) => (window.__rc.compactCalls || 0) === n + 1
      && (() => { try { return !!localStorage.getItem('cx.rc.compactedOn'); } catch { return true; } })(), tidyAtStart),
    await page.evaluate(() => String(window.__rc.compactCalls)));

  /* ── The timeline reads the look-ahead from the calendar ─────────────── */
  await page.keyboard.press('Escape');
  await page.locator('.ws-btn', { hasText: 'Timeline' }).click();
  await page.waitForTimeout(300);
  await page.locator('#sidenav .nav-link[data-pane="lookahead"]').click();
  await page.waitForTimeout(400);
  const fromCalendar = page.locator('#dock button', { hasText: 'Update from the calendar' });
  check('the timeline offers the calendar\'s look-ahead in one step, no workbook needed', (await fromCalendar.count()) === 1);
  const sentBefore = await page.evaluate(() => window.__rc.calls.filter((c) => c.kind !== 'select' && c.table !== 'rc_la_revision').length);
  await fromCalendar.click();
  await page.waitForTimeout(600);
  const plan = await page.evaluate(() => {
    const doc = window.__cx_store?.getDoc?.() || null;
    return {
      toast: [...document.querySelectorAll('.cx-toast')].map((t) => t.textContent).join(' | '),
      pane: document.querySelector('#dock')?.innerText || '',
      doc: doc ? { source: doc.lookahead?.imported?.source, n: Object.keys(doc.lookahead?.activities || {}).length } : null,
    };
  });
  check('and makes suggestions from what the editor wrote', /Updated from the calendar/.test(plan.toast)
    && /the resource calendar/.test(plan.pane) && /ATS Site Test/.test(plan.pane), plan.toast.slice(0, 160));
  check('reading it sends nothing — the plan still never reaches the calendar',
    (await page.evaluate(() => window.__rc.calls.filter((c) => c.kind !== 'select' && c.table !== 'rc_la_revision').length)) === sentBefore);

  // Progress: place the suggestion, record a day's work against its row, and
  // the bar is offered that day as its actual start.
  await page.locator('#dock button[aria-label^="Add "][aria-label*="ATS Site Test"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('.cx-modal button', { hasText: /^Add$/ }).click();
  await page.waitForTimeout(400);
  await page.locator('#sidenav .nav-link[data-pane="lookahead"]').click();
  await page.waitForTimeout(400);
  const progressBtn = page.locator('#dock button', { hasText: 'Progress from the calendar' });
  const openProgress = async () => {
    await progressBtn.click();
    await page.locator('.cx-modal .la-progress').waitFor({ timeout: 5000 }).catch(() => {});
  };
  check('a placed bar can take its progress from the calendar', (await progressBtn.count()) === 1);
  const today = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  // Against every read's copy of the row: the stub ignores order(), so which
  // snapshot counts as the latest is not something this test should depend on.
  await page.evaluate((iso) => {
    const S = window.__rc.rows;
    S.rc_lookahead_rows.filter((r) => /ATS Site Test/.test(r.raw_label || '')).forEach((row, i) => {
      S.rc_actuals.push({
        id: `act-progress-${i}`, client_uuid: `act-progress-${i}`, person_id: S.rc_people[0].id, work_date: iso,
        status: 'completed', task: row.raw_label, lookahead_row_id: row.id, shift: 'day',
        created_at: new Date().toISOString(),
      });
    });
  }, today);
  const sentBeforeProgress = await page.evaluate(() => window.__rc.calls.filter((c) => c.kind !== 'select' && c.table !== 'rc_la_revision').length);
  await openProgress();
  const offer = await page.evaluate(() => document.querySelector('.cx-modal')?.innerText || [...document.querySelectorAll('.cx-toast')].map((t) => t.textContent).join(' | '));
  check('the huddle\'s outcome is offered as the actual start, ticked because none was set',
    /Progress from the calendar/.test(offer) && /Actual start/.test(offer)
      && (await page.locator('.cx-modal .la-progress input[type="checkbox"]:checked').count()) >= 1, offer.replace(/\s+/g, ' ').slice(0, 200));
  await page.locator('.cx-modal button', { hasText: 'Apply selected' }).click();
  await page.waitForTimeout(400);
  check('applying it records the date on the bar',
    /Actual dates recorded/.test(await page.evaluate(() => [...document.querySelectorAll('.cx-toast')].map((t) => t.textContent).join(' | '))));
  await progressBtn.click();
  await page.waitForFunction(() => [...document.querySelectorAll('.cx-toast')].some((t) => /already agree|Could not/.test(t.textContent)),
    null, { timeout: 5000 }).catch(() => {});
  check('and asking again finds nothing new to offer',
    /already agree/.test(await page.evaluate(() => [...document.querySelectorAll('.cx-toast')].map((t) => t.textContent).join(' | ')))
      && !(await page.locator('.cx-modal .la-progress').count()));
  check('reading progress sends nothing to the calendar',
    (await page.evaluate(() => window.__rc.calls.filter((c) => c.kind !== 'select' && c.table !== 'rc_la_revision').length)) === sentBeforeProgress);

  // A second activity under the same bar: linked, worked the day before, never
  // completed — so the start moves earlier and the finish waits on it.
  // One whose words the calendar's rows carry, so an outcome can be recorded
  // against it.
  const labels = await page.evaluate(() => window.__rc.rows.rc_lookahead_rows.map((r) => r.raw_label || ''));
  const linkable = await page.locator('#dock button[aria-label^="Link "][aria-label$=" to an object"]').evaluateAll((bs) =>
    bs.map((b) => b.getAttribute('aria-label').replace(/^Link /, '').replace(/ to an object$/, '')));
  const second = linkable.find((t) => !/ATS Site Test/.test(t) && labels.some((l) => l.includes(t)));
  check('there is a second suggestion to link', !!second, linkable.join(' | ').slice(0, 160));
  await page.locator(`#dock button[aria-label="Link ${second} to an object"]`).first().click();
  // The picker focuses its search box on a timer; typing before then goes nowhere.
  await page.waitForFunction(() => document.activeElement?.matches('.cx-modal input[type="text"]'), null, { timeout: 3000 }).catch(() => {});
  await page.keyboard.type('ATS Site Test');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('the second activity is linked to the same bar',
    (await page.locator(`#dock button[aria-label="Unlink ${second}"]`).count()) >= 1
      || /Linked/.test(await page.evaluate(() => [...document.querySelectorAll('.cx-toast')].map((t) => t.textContent).join(' '))));
  const yesterday = await page.evaluate(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  await page.evaluate(({ iso, title }) => {
    const S = window.__rc.rows;
    S.rc_lookahead_rows.filter((r) => (r.raw_label || '').includes(title)).forEach((row, i) => {
      S.rc_actuals.push({
        id: `act-second-${i}`, client_uuid: `act-second-${i}`, person_id: S.rc_people[1].id, work_date: iso,
        status: 'partial', task: row.raw_label, lookahead_row_id: row.id, shift: 'day',
        created_at: new Date().toISOString(),
      });
    });
  }, { iso: yesterday, title: second });
  await page.evaluate(() => { try { localStorage.removeItem('cx.lookahead.progressDetail'); } catch {} });
  await openProgress();
  const two = await page.evaluate(() => {
    const m = document.querySelector('.cx-modal');
    const list = m?.querySelector('.la-progress-acts');
    return {
      text: m?.innerText || '',
      items: list ? list.children.length : 0,
      hidden: list ? list.hidden : null,
      toggle: m?.querySelector('.la-progress-toggle')?.textContent || '',
      toasts: [...document.querySelectorAll('.cx-toast')].map((t) => t.textContent).slice(-4),
    };
  });
  check('a bar standing for two activities says so, with the breakdown hidden to start',
    /2 activities/.test(two.text) && two.items === 2 && two.hidden === true && /Show 2 activities/.test(two.toggle),
    JSON.stringify({ ...two, text: two.text.replace(/\s+/g, ' ').slice(0, 220) }));
  check('the finish waits on the activity that has not completed, and says which',
    (two.text.split('Finish waits on ')[1] || '').split('\n')[0].includes(second)
      && !/Actual finish/.test(two.text), two.text.replace(/\s+/g, ' ').slice(0, 260));
  check('the earlier day on the other activity moves the start, unticked because it replaces one',
    /Actual start [^\n]*\(was/.test(two.text)
      && !(await page.locator('.cx-modal .la-progress input[type="checkbox"]:checked').count()));
  await page.locator('.cx-modal .la-progress-toggle').click();
  const shown = await page.evaluate(() => {
    const list = document.querySelector('.cx-modal .la-progress-acts');
    return { hidden: list.hidden, text: list.innerText, expanded: document.querySelector('.cx-modal .la-progress-toggle').getAttribute('aria-expanded') };
  });
  check('one bar\'s activities can be shown on their own',
    shown.hidden === false && shown.expanded === 'true' && /Still planned|Not completed/.test(shown.text) && /ATS Site Test/.test(shown.text),
    shown.text.replace(/\s+/g, ' ').slice(0, 200));
  await page.locator('.cx-modal .la-progress-toggle').click();
  check('and hidden again', await page.evaluate(() => document.querySelector('.cx-modal .la-progress-acts').hidden));
  await page.locator('.cx-modal .la-progress-head label').click();
  check('"Show each activity" opens every bar\'s breakdown',
    await page.evaluate(() => [...document.querySelectorAll('.cx-modal .la-progress-acts')].every((l) => !l.hidden)));
  await page.locator('.cx-modal button', { hasText: 'Not now' }).click();
  await page.waitForTimeout(300);
  await openProgress();
  check('and the choice is remembered the next time the dialog opens',
    await page.evaluate(() => {
      const lists = [...document.querySelectorAll('.cx-modal .la-progress-acts')];
      return lists.length > 0 && lists.every((l) => !l.hidden)
        && document.querySelector('.cx-modal .la-progress-head input').checked;
    }));
  await page.locator('.cx-modal .la-progress-head label').click();
  await page.locator('.cx-modal button', { hasText: 'Not now' }).click();
  await page.waitForTimeout(300);
  await page.locator('.ws-btn', { hasText: 'Calendar' }).click();
  await page.waitForTimeout(300);
}
