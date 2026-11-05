/**
 * The 4WLA and the delay log, as one .zip — and the cancellation log's own
 * list, exported to Excel and as a PDF drawn the way the tab draws it.
 *
 * Runs inside `smoke_calendar.js` after the master export, so the look-ahead
 * is written in the calendar and the cancellation log holds reasons. Every
 * date is worked out from "today" and from the log itself, never written in:
 * CI runs this suite on a Wednesday and again on a Monday.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readZip, readSheets, parseSheet } from '../src/io/lookahead.js';

/** `CX_DELAY_SHOT=<dir>` keeps a picture of the tab and the files exported from it, to compare by eye. */
const SHOTS = process.env.CX_DELAY_SHOT || null;
const keep = (name, bytes) => { if (SHOTS) fs.writeFileSync(path.join(SHOTS, name), bytes); };

/** The last thing handed to the browser to download: its name and its bytes. */
async function lastDownload(page) {
  const got = await page.evaluate(async () => ({
    name: window.__saved?.name || '',
    bytes: window.__lastBlob ? Array.from(new Uint8Array(await window.__lastBlob.arrayBuffer())) : [],
  }));
  return { name: got.name, bytes: new Uint8Array(got.bytes) };
}

const bufferOf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const words = (xml) => xml.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export async function delayExport(page, { check }) {
  console.log('\nThe 4WLA and the delay log, as one .zip');
  await page.locator('#rc-frame .rc-tab', { hasText: /^Calendar$/ }).first().click();
  await page.waitForSelector('#rc-frame .la-export-delay', { timeout: 10000 });
  check('the look-ahead offers the 4WLA with the delay log, beside Export to Excel',
    (await page.locator('#rc-frame .la-export-delay').count()) === 1 && (await page.locator('#rc-frame .la-export-xlsx').count()) === 1);

  const today = await page.evaluate(() => window.__CX_MODULES.req('ui/rc_util.js').todayISO());
  const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const byDefault = await page.evaluate((t) => window.__CX_MODULES.req('ui/rc_la_delay.js').delaySpan(t), today);
  check('by default, the delay log is the last ten days, up to and including today',
    byDefault.to === today && byDefault.from === addDays(today, -9) && byDefault.days === 10, `${byDefault.from} to ${byDefault.to}`);

  /* The days exported here end on the newest cancellation with a reason,
     whatever day "today" is: the fixtures' cancellations sit around the week
     on screen, and on a Monday the ten days before it hold none — a check
     that reads the window off the calendar is a check of nothing then. */
  const end = await page.evaluate(async () => {
    const log = await window.__CX_MODULES.req('ui/rc_util.js').cancellationLog('2000-01-01');
    return log.filter((e) => !e.dismissed && e.note?.reason).map((e) => e.start).sort().pop() || null;
  });
  const from = end ? addDays(end, -9) : today;
  const expected = await page.evaluate(async ([f, t]) => {
    const events = await window.__CX_MODULES.req('ui/rc_la_delay.js').delayEvents(f, t);
    return events.map((e) => ({ label: e.label, start: e.start, reason: e.note?.reason || '', party: e.note?.party || '' }));
  }, [from, end || today]);
  check('there are cancellations to carry, some with a reason',
    Boolean(end) && expected.length > 0 && expected.some((e) => e.reason), `${from} to ${end}: ${JSON.stringify(expected).slice(0, 300)}`);

  await page.locator('#rc-frame .la-export-delay').click();
  const dialog = page.locator('.cx-modal', { hasText: '4WLA and delay log' });
  await dialog.waitFor({ timeout: 8000 });
  check('it asks for the 4WLA\'s weeks as Export to Excel does, and the delay log\'s days — ten, to today',
    (await dialog.locator('.lae-export-resources').count()) === 1
      && (await dialog.locator('.la-delay-days').inputValue()) === '10' && (await dialog.locator('.la-delay-end').inputValue()) === today);
  const setEnd = async (iso) => {
    await dialog.locator('.la-delay-end').fill(iso);
    await dialog.locator('.la-delay-end').dispatchEvent('change');
  };
  await setEnd(end || today);
  await page.waitForFunction((n) => new RegExp(`${n} cancellation`).test(document.querySelector('.la-delay-summary')?.textContent || ''),
    expected.length, { timeout: 5000 }).catch(() => {});
  const summary = await dialog.locator('.la-delay-summary').innerText();
  check('it says how many cancellations the days hold', new RegExp(`${expected.length} cancellation`).test(summary), summary);
  const listed = await dialog.locator('.la-delay-files li').allInnerTexts();
  check('and names the three files the .zip will hold',
    listed.length === 3 && /^4WLA \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\.xlsx/.test(listed[0])
      && listed[1].startsWith(`Delay log ${from} to ${end}.pdf`) && listed[2].startsWith(`Delay log ${from} to ${end}.xlsx`), listed.join(' | '));

  await page.evaluate(() => { window.__saved = {}; window.__lastBlob = null; });
  await dialog.locator('.cx-modal-foot button', { hasText: 'Download' }).click();
  await page.waitForFunction(() => /\.zip$/.test(window.__saved?.name || ''), null, { timeout: 15000 }).catch(() => {});
  const zip = await lastDownload(page);
  keep('delay.zip', zip.bytes);
  check('Download hands over one .zip, named for the day it was made', zip.name === `4WLA and delay log ${today}.zip`, zip.name);
  const inside = zip.bytes.length ? readZip(bufferOf(zip.bytes)) : new Map();
  const names = [...inside.keys()];
  check('holding the 4WLA workbook, and the delay log as a PDF and as a workbook',
    names.length === 3 && /^4WLA .*\.xlsx$/.test(names[0])
      && names[1] === `Delay log ${from} to ${end}.pdf` && names[2] === `Delay log ${from} to ${end}.xlsx`, names.join(' | '));

  const fourWeeks = inside.get(names[0]);
  if (fourWeeks) {
    const sheet = readSheets(readZip(bufferOf(fourWeeks)))[0]?.name || '4WLA';
    const grid = parseSheet(bufferOf(fourWeeks), sheet);
    const values = grid.rows.flatMap((r) => r.cells.map((c) => c.value));
    check('the 4WLA is Export to Excel\'s: its merged headings, and the activities with work in those weeks',
      grid.merges.includes('B2:B6') && values.includes('IXL Regression Testing'), `${grid.merges.length} merges`);
  } else check('the 4WLA is Export to Excel\'s: its merged headings, and the activities with work in those weeks', false, 'missing');

  const book = inside.get(names[2]);
  if (book) {
    const files = readZip(bufferOf(book));
    const sheets = readSheets(files).map((s) => s.name);
    const list = words(new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml')));
    const rows = parseSheet(bufferOf(book), 'Delay log').rows
      .filter((r) => r.row > 5 && r.cells.some((c) => c.value) && !/^Nothing was cancelled/.test(r.cells[0]?.value || ''));
    check('the delay log workbook is the list, then the calendar', sheets.join() === 'Delay log,Calendar', sheets.join(', '));
    check('a row for every cancellation in those days, with its reason',
      rows.length === expected.length && expected.every((e) => list.includes(e.label.slice(0, 30)))
        && expected.filter((e) => e.reason).every((e) => list.includes(e.reason)),
      `${rows.length} rows for ${expected.length}`);
    const calendar = parseSheet(bufferOf(book), 'Calendar');
    check('and the calendar sheet runs over the same ten days',
      calendar.rows.find((r) => r.row === 5)?.cells.filter((c) => /^\d+$/.test(c.value)).length === 10);
  } else check('the delay log workbook is the list, then the calendar', false, 'missing');

  const pdf = inside.get(names[1]);
  const pdfText = pdf ? new TextDecoder('latin1').decode(pdf) : '';
  check('the delay log PDF shows it as a list and then as a calendar',
    pdfText.startsWith('%PDF-') && /\(Delay log\) Tj/.test(pdfText) && /As a list\) Tj/.test(pdfText) && /As a calendar\) Tj/.test(pdfText)
      && (pdfText.match(/\/Type \/Page[^s]/g) || []).length >= 2,
    `${(pdfText.match(/\/Type \/Page[^s]/g) || []).length} pages`);
  check('with each cancellation in it', expected.every((e) => pdfText.includes(`(${e.label.slice(0, 12)}`)));
  const said = page.locator('.cx-toast', { hasText: '4WLA and delay log exported' }).first();
  check('and the download says so', await said.waitFor({ timeout: 5000 }).then(() => true).catch(() => false));

  // Fewer days: the summary and the names follow, before anything is built.
  const three = `Delay log ${addDays(end || today, -2)} to ${end || today}`;
  await page.locator('#rc-frame .la-export-delay').click();
  await dialog.waitFor({ timeout: 8000 });
  await setEnd(end || today);
  await dialog.locator('.la-delay-days').fill('3');
  await dialog.locator('.la-delay-days').dispatchEvent('change');
  await page.waitForFunction((n) => (document.querySelector('.la-delay-files')?.textContent || '').includes(`${n}.pdf`), three, { timeout: 5000 }).catch(() => {});
  check('three days instead of ten: the files are named for them',
    (await dialog.locator('.la-delay-files').innerText()).includes(`${three}.pdf`), three);
  const filed = `exports/4WLA and delay log ${today}.zip`;
  await dialog.locator('.cx-modal-foot button', { hasText: 'Save to the shared folder' }).click();
  await page.waitForFunction((k) => Boolean(window.__folder.files[k]), filed, { timeout: 15000 }).catch(() => {});
  const saved = await page.evaluate((k) => {
    const f = window.__folder.files[k];
    return f ? Array.from(f.data) : null;
  }, filed);
  check('"Save to the shared folder" files the .zip into exports/',
    Boolean(saved) && [...readZip(bufferOf(new Uint8Array(saved))).keys()].includes(`${three}.xlsx`),
    (await page.evaluate(() => Object.keys(window.__folder.files).filter((k) => k.startsWith('exports/')))).join(' | '));
  await page.keyboard.press('Escape');

  /* ── The cancellation log's own list ─────────────────────────────────── */
  console.log('\nThe cancellation log, exported as it is drawn');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Cancellations' }).click();
  await page.waitForSelector('#rc-frame .rc-cancel-row', { timeout: 10000 });
  await page.locator('#rc-frame .la-cancel-kinds .rc-tab', { hasText: 'Everything' }).click();
  await page.locator('#rc-frame .la-cancel-views .rc-tab', { hasText: 'As a list' }).click();
  await page.waitForSelector('#rc-frame .la-cancel-list-xlsx', { timeout: 8000 });
  const onScreen = await page.locator('#rc-frame .rc-cancel-row').evaluateAll((rows) => rows.map((r) => r.dataset.label));
  if (SHOTS) await page.locator('#rc-frame').screenshot({ path: path.join(SHOTS, 'cancellations-tab.png') });
  const button = await page.locator('#rc-frame .la-cancel-list-xlsx').innerText();
  check('the list exports to Excel, saying how many — no CSV any more',
    button.includes(`Export ${onScreen.length} to Excel`) && !/CSV/.test(await page.locator('#rc-frame').innerText()), button);

  await page.evaluate(() => { window.__saved = {}; window.__lastBlob = null; });
  await page.locator('#rc-frame .la-cancel-list-xlsx').click();
  await page.waitForFunction(() => /\.xlsx$/.test(window.__saved?.name || ''), null, { timeout: 8000 }).catch(() => {});
  const xlsx = await lastDownload(page);
  keep('cancellations.xlsx', xlsx.bytes);
  check('named for the log\'s span', /^Cancellation log \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\.xlsx$/.test(xlsx.name), xlsx.name);
  if (xlsx.bytes.length) {
    const sheet = parseSheet(bufferOf(xlsx.bytes), 'Cancellations');
    const cells = new Map(sheet.rows.flatMap((r) => r.cells).map((c) => [c.ref, c]));
    const body = sheet.rows.filter((r) => r.row > 5 && r.cells.some((c) => c.value));
    check('one clean table: a title, the span, the counts, headings shaded, a row for each one on screen',
      cells.get('A1')?.value === 'Cancellation log' && /^Since |^From /.test(cells.get('A2')?.value || '')
        && /^Events \d+/.test(cells.get('A3')?.value || '') && cells.get('A5')?.value === 'Activity' && cells.get('A5')?.hex === 'F2F2F2'
        && body.length === onScreen.length,
      `${body.length} rows for ${onScreen.length} on screen`);
    check('every row in the order on screen',
      body.every((r, i) => r.cells.find((c) => c.col === 1)?.value === onScreen[i]));
    check('the reason logged, and whose it was in its colour',
      body.some((r) => r.cells.some((c) => c.value === 'Hitachi' && c.hex === '0070C0'))
        && sheet.rows.some((r) => r.cells.some((c) => c.value === 'Our crew was reallocated')));
  }

  await page.evaluate(() => { window.__saved = {}; window.__lastBlob = null; });
  await page.locator('#rc-frame .la-cancel-list-pdf').click();
  await page.waitForFunction(() => /\.pdf$/.test(window.__saved?.name || '') && window.__saved?.pdf, null, { timeout: 8000 }).catch(() => {});
  const listPdf = await lastDownload(page);
  keep('cancellations.pdf', listPdf.bytes);
  const listText = new TextDecoder('latin1').decode(listPdf.bytes);
  check('and as a PDF drawn the way the tab draws it: the counts, the columns, every row',
    /^Cancellation log .*\.pdf$/.test(listPdf.name) && listText.startsWith('%PDF-')
      && ['(EVENTS) Tj', '(RESPONSIBLE) Tj', '(SEEN) Tj', '(Our crew was reallocated) Tj'].every((t) => listText.includes(t))
      && onScreen.every((label) => listText.includes(`(${String(label).slice(0, 10)}`)),
    listPdf.name);

  // Narrowed on screen, narrowed in the file — and the file says so.
  await page.locator('#rc-frame .la-cancel-kinds .rc-tab', { hasText: 'BART support only' }).click();
  await page.waitForSelector('#rc-frame .la-cancel-list-pdf', { timeout: 8000 });
  const supportRows = await page.locator('#rc-frame .rc-cancel-row').count();
  await page.evaluate(() => { window.__saved = {}; window.__lastBlob = null; });
  await page.locator('#rc-frame .la-cancel-list-pdf').click();
  await page.waitForFunction(() => window.__saved?.pdf, null, { timeout: 8000 }).catch(() => {});
  const narrowed = new TextDecoder('latin1').decode((await lastDownload(page)).bytes);
  check('a narrowed list says it is narrowed, on the page',
    /BART support only/.test(narrowed) && narrowed.includes(`${supportRows} cancellation`), `${supportRows} on screen`);
  await page.locator('#rc-frame .la-cancel-kinds .rc-tab', { hasText: 'Everything' }).click();
  await page.locator('#rc-frame .rc-tab', { hasText: /^Calendar$/ }).first().click();
}
