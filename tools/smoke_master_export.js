/**
 * The master export, in the calendar: the button, the dialog, a workbook
 * filed into the shared folder's exports/ with every sheet in it, read back
 * here and checked against what the calendar holds by now — and the schedule,
 * which exports once when a slot has passed and not again until the next.
 *
 * Runs inside `smoke_calendar.js`, after the look-ahead editor and the P6
 * checks, so the workbook has a written look-ahead, a cancellation logged with
 * its reason and rows linked to P6 to carry.
 */

import { readZip, parseSheet } from '../src/io/lookahead.js';
import { readGrid } from '../src/core/lookahead.js';

/** The workbook the page builds, as Node sees it: sheet names and each sheet's XML. */
async function workbookIn(page) {
  const b64 = await page.evaluate(async () => {
    const mx = window.__CX_MODULES.req('ui/rc_master_export.js');
    const out = await mx.buildMasterExport({ ...mx.loadSettings(), sheets: mx.SHEETS.map((s) => s.id), range: 'all' });
    const b64 = (bytes) => {
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    };
    return {
      bytes: b64(out.bytes), sheets: out.sheets, failed: out.failed,
      companion: out.companion ? out.companion.name : null,
      companionBytes: out.companion ? b64(out.companion.bytes) : null,
    };
  });
  const files = readZip(Uint8Array.from(Buffer.from(b64.bytes, 'base64')).buffer);
  const text = (name) => new TextDecoder().decode(files.get(name) || new Uint8Array());
  const names = [...text('xl/workbook.xml').matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const sheet = (name) => text(`xl/worksheets/sheet${names.indexOf(name) + 1}.xml`);
  /* The 4WLA beside it, read back the way a workbook is read, for the days it covers. */
  let companionDays = [];
  if (b64.companionBytes) {
    const buf = Uint8Array.from(Buffer.from(b64.companionBytes, 'base64')).buffer;
    companionDays = readGrid(parseSheet(buf, '4WLA'), { anchorISO: '2026-09-23' }).days.map((d) => d.date).filter(Boolean);
  }
  return { ...b64, names, sheet, companionDays, deflated: [...files.keys()].length > 0 };
}

export async function masterExport(page, { check }) {
  console.log('\nThe master export');
  await page.locator('#rc-frame .rc-tab', { hasText: /^Calendar$/ }).first().click();
  await page.waitForSelector('#rc-frame .rc-master-export', { timeout: 10000 });
  check('the look-ahead offers the master export to an administrator', (await page.locator('#rc-frame .rc-master-export').count()) === 1);

  await page.locator('#rc-frame .rc-master-export').click();
  const dialog = page.locator('.cx-modal', { hasText: 'Master export' });
  await dialog.waitFor({ timeout: 5000 });
  check('it asks what goes in — a sheet each, every one ticked to begin with',
    (await dialog.locator('.rc-mx-sheet input:checked').count()) === 8);
  check('and when — now, or on a schedule', (await dialog.locator('.rc-mx-every').count()) === 1);
  check('it offers the 4WLA as a PDF too, ticked to begin with', (await dialog.locator('.rc-mx-pdf input:checked').count()) === 1);

  const before = await page.evaluate(() => Object.keys(window.__folder.files).filter((k) => k.startsWith('exports/')).length);
  await dialog.locator('button', { hasText: 'Export now' }).click();
  await page.waitForFunction((n) => Object.keys(window.__folder.files).filter((k) => k.startsWith('exports/')).length > n, before, { timeout: 20000 }).catch(() => {});
  const filed = await page.evaluate(() => Object.keys(window.__folder.files).filter((k) => k.startsWith('exports/')));
  check('"Export now" files the workbook into exports/ in the shared folder',
    filed.includes('exports/LookAhead_Latest.xlsx'), filed.join(' | '));
  check('with the 4WLA beside it, in its own layout', filed.some((k) => /4WLA/.test(k) && !/master/.test(k)), filed.join(' | '));
  const pdf = await page.evaluate(() => {
    const f = window.__folder.files['exports/4WLA_Latest.pdf'];
    if (!f) return null;
    const text = new TextDecoder('latin1').decode(f.data);
    return {
      head: text.slice(0, 5),
      pages: (text.match(/\/Type\s*\/Page[^s]/g) || []).length,
      // A3 landscape: 1190.55 x 841.89 points.
      weeks: /4 weeks from/.test(text),
      a3: /\/MediaBox\s*\[\s*0\s+0\s+1190\.\d+\s+841\.\d+\s*\]/.test(text),
      modified: f.modified,
    };
  });
  check('and files it as exports/4WLA_Latest.pdf — a real PDF, one A3 landscape page',
    pdf?.head === '%PDF-' && pdf.pages === 1 && pdf.a3 && pdf.weeks, JSON.stringify(pdf));
  const said = page.locator('.cx-toast', { hasText: 'Saved to the shared folder' }).first();
  await said.waitFor({ timeout: 8000 }).catch(() => {});
  check('and says where it went, and how much it holds',
    /rows on \d+ sheets[\s\S]*Saved to the shared folder — exports\/LookAhead_Latest\.xlsx/.test(await said.innerText().catch(() => '')),
    await said.innerText().catch(() => ''));

  /* A day written in the editor two months ago: the record the export is
     taken away for, which the 4WLA beside it used to leave out — it was this
     week and the next three only. */
  const longAgo = await page.evaluate(() => {
    const S = window.__rc.rows;
    const row = S.rc_la_rows.find((r) => r.kind === 'activity' && !r.archived);
    const shift = S.rc_legend.find((l) => (l.role || 'shift') === 'shift' && !/cancel/i.test(l.meaning || ''));
    const d = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    S.rc_la_cells.push({ row_id: row.id, day: d, color: String(shift.argb).toUpperCase(), text: 'X', version: 1 });
    // Written behind the client's back, so what it remembers reading is forgotten.
    window.__CX_MODULES.req('core/rc.js').forgetReads();
    return { day: d, label: row.description };
  });
  const book = await workbookIn(page);
  const thisMonday = await page.evaluate(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  });
  check('the 4WLA beside it has one name, replaced each time, not one named for its dates',
    book.companion === '4WLA_Latest.xlsx', book.companion);
  check('and it reaches back to the first week anything was written, not only this week and the next three',
    book.companionDays.length > 28 && book.companionDays[0] <= longAgo.day && book.companionDays.includes(longAgo.day),
    `${book.companionDays[0]} to ${book.companionDays[book.companionDays.length - 1]} (written ${longAgo.day})`);
  const laDates = [...book.sheet('Look-ahead').matchAll(/<c r="A\d+" s="\d+"><v>(\d{5})<\/v>/g)]
    .map((m) => new Date((Number(m[1]) - 25569) * 864e5).toISOString().slice(0, 10)).sort();
  check('the look-ahead sheet carries the weeks already gone, back to the day written two months ago',
    laDates.length > 0 && laDates[0] <= longAgo.day && laDates.some((d) => d < thisMonday), `${laDates[0]} to ${laDates[laDates.length - 1]}`);
  check('and says that a week no reading has comes from the calendar as written',
    /The calendar as written — no reading has this week/.test(book.sheet('Look-ahead')) && /A reading</.test(book.sheet('Look-ahead')));
  const want = ['About', 'Look-ahead', 'Who is on what', 'Cancellations', 'Changes', 'Leave',
    'P6 activities', 'TAWRs', 'Team', 'Locations', 'Legend', 'Support codes'];
  check('the workbook has a sheet for each, About first', JSON.stringify(book.names) === JSON.stringify(want), book.names.join(', '));
  check('and nothing could not be read', !book.failed.length, JSON.stringify(book.failed));
  const la = book.sheet('Look-ahead');
  check('the look-ahead sheet carries each day with its P6 activity', /CX-1040/.test(la) && /IXL Regression Testing/.test(la)
    && book.sheets.find((s) => s.name === 'Look-ahead')?.rows > 10, `${book.sheets.find((s) => s.name === 'Look-ahead')?.rows} rows`);
  check('its dates are dates Excel can sort, not text', /<c r="A2" s="\d+"><v>\d{5}<\/v><\/c>/.test(la));
  const shifts = book.sheet('Who is on what');
  check('the shifts sheet names who covered which shift', /Dan/.test(shifts) && /Day</.test(shifts),
    `${book.sheets.find((s) => s.name === 'Who is on what')?.rows} rows`);
  const words = (xml) => xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  check('the cancellations sheet carries the reason logged and who was responsible',
    /Our crew was reallocated/.test(book.sheet('Cancellations')) && /Hitachi/.test(book.sheet('Cancellations'))
      && /BART resource cancelled/.test(book.sheet('Cancellations')),
    words(book.sheet('Cancellations')).slice(0, 700));
  check('the P6 sheet counts the rows naming each activity', /CX-1040/.test(book.sheet('P6 activities')));
  check('About says how a day is read and what each sheet holds',
    /newest reading/.test(book.sheet('About')) && /Who is on what/.test(book.sheet('About')));

  /* The schedule. Saved now, its first export waits for the next slot rather
     than firing this minute; a slot passed exports once, and not again. */
  await page.locator('#rc-frame .rc-master-export').click();
  await dialog.waitFor({ timeout: 5000 });
  await dialog.locator('.rc-mx-every').selectOption('day');
  await dialog.locator('.rc-mx-at').fill('06:00');
  await dialog.locator('.rc-mx-at').dispatchEvent('change');
  check('a daily schedule says when the next one is', /Next /.test(await dialog.locator('.rc-mx-status').innerText()),
    await dialog.locator('.rc-mx-status').innerText());
  await dialog.locator('button', { hasText: /^Save$/ }).click();
  const tick = (offsetMs) => page.evaluate((ms) => window.__CX_MODULES.req('ui/rc_master_export.js').scheduledTick(Date.now() + ms), offsetMs);
  const count = () => page.evaluate(() => Object.keys(window.__folder.files).filter((k) => k === 'exports/LookAhead_Latest.xlsx').length);
  const n0 = await count();
  check('a schedule just saved does not export straight away', (await tick(0)) === false && (await count()) === n0);
  const filedBefore = await page.evaluate(() => window.__folder.files['exports/LookAhead_Latest.xlsx']?.modified);
  const lastAt = () => page.evaluate(() => JSON.parse(localStorage.getItem('cx.rc.masterExport') || '{}').last?.at || 0);
  const at0 = await lastAt();
  const ran = await tick(86400000);
  check('once its time has passed, it exports by itself', ran === true && (await count()) >= Math.max(1, n0) && (await lastAt()) > at0,
    `${n0} → ${await count()} file(s)`);
  check('and only once for that slot', (await tick(86400000 + 60000)) === false);
  check('into the same file, replaced rather than added beside — always LookAhead_Latest.xlsx',
    (await count()) === 1 && !(await page.evaluate(() => Object.keys(window.__folder.files).some((k) => /^exports\/.*master export/i.test(k)))));
  check('and what is in it is the new export, not the old one kept',
    Boolean(filedBefore) && (await page.evaluate(() => window.__folder.files['exports/LookAhead_Latest.xlsx']?.modified)) > filedBefore);
  check('the PDF is replaced by the scheduled run too, under the same name',
    (await page.evaluate(() => window.__folder.files['exports/4WLA_Latest.pdf']?.modified || 0)) > (pdf?.modified || Infinity)
      && (await page.evaluate(() => Object.keys(window.__folder.files).filter((k) => /^exports\/.*\.pdf$/.test(k)).length)) === 1);
  check('the time it ran is remembered on this computer',
    await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('cx.rc.masterExport') || '{}').lastRun)));
  // Back off, so nothing else in the suite meets a schedule.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('cx.rc.masterExport') || '{}');
    localStorage.setItem('cx.rc.masterExport', JSON.stringify({ ...s, schedule: { ...s.schedule, every: 'off' } }));
  });
}
