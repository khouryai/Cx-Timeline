/**
 * P6 activities on the look-ahead, driven in a browser — part of
 * `smoke_calendar.js`, which calls it once the editor has made the calendar
 * the look-ahead's source.
 *
 * The whole of what an administrator does with them: a P6 extract imported and
 * previewed before anything is written, a later one marking what it left out
 * rather than deleting it, the Activity ID column filled by typing any part of
 * an activity's name, several rows linked to one activity at once, a row with
 * no P6 activity flagged with a reason, and all of it reaching the read view,
 * the published reading and the Excel export — the places other tools join on.
 */

import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const la = await import(path.join(ROOT, 'src/io/lookahead.js'));

const EXTRACT = [
  'Line 1 — schedule extract',
  '',
  'Activity ID,Activity Name,WBS,Start,Finish',
  'CX-1040,IXL Regression Testing — Phase 2,L1.PH2.IXL,05-Oct-26,09-Oct-26',
  'CX-1041,IXL Regression Testing — Phase 3,L1.PH3.IXL,12-Oct-26,16-Oct-26',
  'CX-2210,ATS Site Acceptance Test,L1.PH2.ATS,05-Oct-26,07-Oct-26',
  'CX-3000,"DCS internal testing, cabinet 3",L1.PH2.DCS,08-Oct-26,09-Oct-26',
  'CX-3001,Traction power energisation,L1.PH2.TP,12-Oct-26,12-Oct-26',
  'CX-4100,Radio coverage survey,L1.PH2.RAD,14-Oct-26,15-Oct-26',
].join('\r\n');

export async function lookaheadP6(page, { check, shot = null }) {
  console.log('\nP6 activities on the look-ahead');
  const snap = async (name) => { if (shot) await page.screenshot({ path: shot.replace(/\.png$/, `-${name}.png`) }); };
  const stored = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__rc.rows.rc_p6_activities || [])));
  const laRows = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__rc.rows.rc_la_rows || [])));
  const idOf = async (desc) => (await laRows()).find((r) => r.description === desc && r.kind === 'activity')?.activity_id;
  const saved = async () => {
    await page.waitForFunction(() => /All changes saved/.test(document.querySelector('#rc-frame .lae-status')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(150);
  };
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowLoc = (desc) => page.locator('#rc-frame .lae-grid tbody tr', {
    has: page.locator('td.lae-meta-description', { hasText: new RegExp(`^${escape(desc)}$`) }),
  }).first();
  const idCell = (desc) => rowLoc(desc).locator('td.lae-meta-activity_id');
  const importFile = async (name, text) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#rc-frame .p6-import').first().click()]);
    await chooser.setFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
    await page.waitForSelector('.cx-modal .p6-preview', { timeout: 8000 });
  };
  const toEditor = async () => {
    await page.locator('#rc-frame .rc-tab', { hasText: /^Calendar$/ }).click();
    await page.waitForSelector('#rc-frame .la-edit-switch', { timeout: 10000 });
    if ((await page.locator('#rc-frame .la-edit-switch').getAttribute('aria-pressed')) !== 'true') {
      await page.locator('#rc-frame .la-edit-switch').click();
    }
    await page.waitForSelector('#rc-frame .lae-grid', { timeout: 10000 });
    await page.waitForTimeout(300);
  };

  /* ── The list, imported ───────────────────────────────────────────── */
  await page.keyboard.press('Escape');
  if (!(await page.locator('#rc-frame').isVisible())) {
    await page.locator('.ws-btn', { hasText: 'Calendar' }).click();
    await page.waitForSelector('#rc-frame .rc-tabs', { timeout: 10000 });
  }
  await page.locator('#rc-frame .rc-tab', { hasText: 'Look-ahead' }).click();
  await page.waitForTimeout(300);
  if ((await page.locator('#rc-frame .la-edit-switch[aria-pressed="true"]').count())) {
    await page.locator('#rc-frame .la-edit-switch').click();
    await page.waitForSelector('#rc-frame .la-grid', { timeout: 10000 });
  }
  await page.locator('#rc-frame .rc-tab', { hasText: 'P6 activities' }).click();
  await page.waitForSelector('#rc-frame .p6-import', { timeout: 10000 });
  check('the look-ahead has a P6 section, empty until an extract is imported',
    /Nothing imported yet/.test(await page.locator('#rc-frame').innerText()));
  check('with the reasons a row may give instead already on its list',
    (await page.locator('#rc-frame .p6-flags-admin tbody td:first-child').allInnerTexts()).join() === 'Troubleshooting,Regression,Support');

  const callsBefore = await page.evaluate(() => window.__rc.calls.filter((c) => c.table === 'rc_p6_import').length);
  await importFile('P6 extract.csv', EXTRACT);
  await snap('preview');
  const preview = await page.locator('.cx-modal').innerText();
  check('an extract is read and previewed before anything is written — how many, from where, the first few as read',
    /6 activities read from the file/.test(preview) && /CX-1040/.test(preview) && /IXL Regression Testing — Phase 2/.test(preview)
      && /L1\.PH2\.IXL/.test(preview), preview.replace(/\s+/g, ' ').slice(0, 220));
  check('and nothing is written until it is confirmed',
    (await stored()).length === 0
      && (await page.evaluate(() => window.__rc.calls.filter((c) => c.table === 'rc_p6_import').length)) === callsBefore);
  await page.locator('.cx-modal .cx-modal-foot button.primary').click();
  await page.waitForSelector('#rc-frame .p6-summary', { timeout: 8000 }).catch(() => {});
  const first = await stored();
  check('confirming imports every activity once, by its ID, with its name and WBS',
    first.length === 6 && first.find((a) => a.activity_id === 'CX-3000')?.name === 'DCS internal testing, cabinet 3'
      && first.find((a) => a.activity_id === 'CX-1040')?.wbs === 'L1.PH2.IXL' && first.every((a) => !a.missing),
    `${first.length} stored`);
  check('the section says how many, and when', /6 activities/.test(await page.locator('#rc-frame .p6-summary').innerText())
    && /last imported/.test(await page.locator('#rc-frame .p6-summary').innerText()));

  // A later extract: one renamed, one left out.
  const later = EXTRACT.replace('Radio coverage survey', 'Radio coverage survey and drive test').split('\r\n')
    .filter((line) => !line.startsWith('CX-3001')).join('\r\n');
  await importFile('P6 extract later.csv', later);
  const again = await page.locator('.cx-modal').innerText();
  check('importing again says what changes — renamed, and what this extract leaves out',
    /1 renamed or moved in the WBS/.test(again) && /4 unchanged/.test(again) && /CX-3001/.test(again)
      && /kept and marked, never deleted/.test(again), again.replace(/\s+/g, ' ').slice(0, 260));
  await page.locator('.cx-modal .cx-modal-foot button.primary').click();
  await page.waitForTimeout(600);
  const second = await stored();
  check('and an activity left out is marked missing, never deleted — a row may still name it',
    second.length === 6 && second.find((a) => a.activity_id === 'CX-3001')?.missing === true
      && second.find((a) => a.activity_id === 'CX-4100')?.name === 'Radio coverage survey and drive test');
  await snap('section');

  /* ── The editor's Activity ID column ──────────────────────────────── */
  await toEditor();
  const ixlBefore = await idOf('IXL Regression Testing');
  check('an Activity ID the P6 list does not have is marked, and says so on the hover',
    await idCell('IXL Regression Testing').evaluate((n) => n.classList.contains('lae-p6-unknown') && /not in the P6 list/.test(n.title)),
    `${ixlBefore} — ${await idCell('IXL Regression Testing').getAttribute('title')}`);
  const todo = page.locator('#rc-frame .lae-p6-todo');
  const todoBefore = Number((await todo.innerText()).match(/\d+/)?.[0] || 0);
  check('the toolbar counts the activities still to link', todoBefore >= 2, await todo.innerText());
  await todo.click();
  await page.waitForTimeout(150);
  check('and one press goes to the next of them, in its Activity ID',
    await page.evaluate(() => {
      const td = document.querySelector('#rc-frame td.lae-cur');
      return td?.dataset.c === '0' && td.closest('tr').classList.contains('lae-activity')
        && (td.classList.contains('lae-p6-unknown') || td.classList.contains('lae-p6-empty'));
    }));

  await idCell('IXL Regression Testing').click();
  await page.keyboard.type('regression ixl');
  await page.waitForTimeout(150);
  await snap('typing');
  const offered = await page.locator('#rc-frame .lae-p6-hint .lae-p6-opt-p6 .lae-p6-id').allInnerTexts();
  check('typing in an Activity ID searches P6 by the words of the name, in any order',
    offered.slice(0, 2).join() === 'CX-1040,CX-1041', offered.join(', '));
  check('with the whole list a press away', (await page.locator('#rc-frame .lae-p6-hint .lae-p6-opt-more').count()) === 1);
  await page.keyboard.press('Enter');
  await saved();
  check('Enter takes the match and saves the P6 ID', (await idOf('IXL Regression Testing')) === 'CX-1040');
  check('which then reads as linked, the activity\'s name on its hover',
    await idCell('IXL Regression Testing').evaluate((n) => n.classList.contains('lae-p6-linked') && /IXL Regression Testing — Phase 2/.test(n.title)),
    await idCell('IXL Regression Testing').getAttribute('title'));
  check('and a description somebody wrote is never replaced', (await laRows()).some((r) => r.description === 'IXL Regression Testing'));

  await idCell('ATS Site Test').click();
  await page.keyboard.type('cx-2210');
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  check('Escape puts the list away and keeps what was typed',
    (await page.locator('#rc-frame .lae-editor').count()) === 1 && (await page.locator('#rc-frame .lae-p6-hint').isHidden())
      && (await page.locator('#rc-frame .lae-editor').inputValue()) === 'cx-2210');
  await page.keyboard.press('Enter');
  await saved();
  check('an ID typed in another case is written as P6 spells it', (await idOf('ATS Site Test')) === 'CX-2210');

  // A new activity with nothing written yet takes its description from P6.
  await idCell('ATS Site Test').click();
  await page.locator('#rc-frame .lae-toolbar button', { hasText: 'Activity' }).click();
  await page.waitForSelector('#rc-frame .lae-editor');
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('CX-3000');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await saved();
  check('linking an activity with no description yet gives it the P6 name',
    (await laRows()).some((r) => r.kind === 'activity' && r.activity_id === 'CX-3000' && r.description === 'DCS internal testing, cabinet 3'));

  // Several rows to one activity, from the picker.
  await rowLoc('ATS Site Test').locator('td.lae-meta-location').click();
  await rowLoc('DCS internal testing, cabinet 3').locator('td.lae-meta-location').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Alt+k');
  await page.waitForSelector('.cx-modal .p6-picker', { timeout: 5000 });
  await page.waitForFunction(() => document.activeElement?.classList.contains('p6-search'), null, { timeout: 3000 }).catch(() => {});
  const already = await page.locator('.cx-modal .p6-item .p6-id').allInnerTexts();
  check('Alt+K opens the picker for every selected activity, starting from the activities the look-ahead already names',
    /Link 2 activities/.test(await page.locator('.cx-modal .cx-modal-title').innerText())
      && ['CX-1040', 'CX-2210', 'CX-3000'].every((id) => already.includes(id)), already.join(', '));
  check('each saying how many rows name it', /on 1 row/.test(await page.locator('.cx-modal .p6-picker-list').innerText()));
  await page.keyboard.type('phase 3');
  await page.waitForTimeout(150);
  await snap('picker');
  check('typing searches the whole list', (await page.locator('.cx-modal .p6-item .p6-id').allInnerTexts()).join() === 'CX-1041');
  await page.keyboard.press('Enter');
  await saved();
  check('and one choice links them all — several rows may name one activity',
    (await idOf('ATS Site Test')) === 'CX-1041' && (await idOf('DCS internal testing, cabinet 3')) === 'CX-1041');
  await page.locator('#rc-frame .lae-scroll').focus();
  await page.keyboard.press('Control+z');
  await saved();
  check('one undo takes the whole link back', (await idOf('ATS Site Test')) === 'CX-2210' && (await idOf('DCS internal testing, cabinet 3')) === 'CX-3000');

  // No P6 activity: a reason, from the same picker.
  await rowLoc('DCS internal testing, cabinet 3').locator('td.lae-meta-location').click();
  await page.keyboard.press('Alt+k');
  await page.waitForSelector('.cx-modal .p6-reasons', { timeout: 5000 });
  await page.locator('.cx-modal .p6-reason', { hasText: 'Troubleshooting' }).click();
  await saved();
  check('a row with no P6 activity says why, from the list of reasons', (await idOf('DCS internal testing, cabinet 3')) === 'Troubleshooting');
  check('drawn as a reason, not an ID',
    (await idCell('DCS internal testing, cabinet 3').locator('.lae-p6-pill').innerText()).trim() === 'Troubleshooting'
      && /Not in P6: Troubleshooting/.test(await idCell('DCS internal testing, cabinet 3').getAttribute('title')));
  check('and the count of what is still to link comes down', Number((await todo.innerText()).match(/\d+/)?.[0] || 0) < todoBefore
    || /All linked/.test(await todo.innerText()), await todo.innerText());
  // A day of work on it, so the published reading carries a row for it.
  await rowLoc('DCS internal testing, cabinet 3').locator('td[data-c="7"]').click();
  await page.keyboard.press('Alt+1');
  await saved();
  await snap('linked');

  /* ── Everywhere the look-ahead goes ───────────────────────────────── */
  await page.locator('#rc-frame .la-edit-switch').click();
  await page.waitForSelector('#rc-frame .la-grid', { timeout: 15000 });
  await page.waitForTimeout(400);
  const readIdTitle = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#rc-frame .la-grid tbody tr')].find((tr) => /IXL Regression Testing/.test(tr.textContent));
    return row?.querySelector('td.la-meta')?.title || '';
  });
  check('the read view names the P6 activity on the Activity ID\'s hover', /CX-1040 — IXL Regression Testing — Phase 2/.test(readIdTitle), readIdTitle);
  check('and a reason given instead reads as a reason',
    (await page.locator('#rc-frame .la-grid td.la-p6-flag', { hasText: 'Troubleshooting' }).count()) === 1);
  const filter = page.locator('#rc-frame input[placeholder^="Filter activities"]');
  await filter.click();
  await page.keyboard.type('phase 2');
  await page.waitForTimeout(300);
  check('the filter finds a row by its P6 activity\'s name, where the row words it differently',
    /IXL Regression Testing/.test(await page.locator('#rc-frame .la-grid').innerText().catch(() => ''))
      && !/ATS Site Test/.test(await page.locator('#rc-frame .la-grid').innerText().catch(() => '')));
  await filter.fill('');
  await filter.dispatchEvent('input');
  await page.waitForTimeout(200);

  const published = await page.evaluate(() => {
    const S = window.__rc.rows;
    const last = S.rc_lookahead_snapshots.reduce((a, b) => (String(a.taken_at) > String(b.taken_at) ? a : b));
    return S.rc_lookahead_rows.filter((r) => r.snapshot_id === last.id).map((r) => r.raw_label);
  });
  check('the published reading carries each row\'s P6 ID, for anything that joins on it',
    published.some((l) => /^CX-1040 · IXL Regression Testing/.test(l)) && published.some((l) => /^Troubleshooting · /.test(l)),
    published.slice(0, 4).join(' | '));

  await page.evaluate(() => { window.__saved = {}; });
  await page.locator('#rc-frame .la-export-xlsx').click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Download' }).click();
  await page.waitForTimeout(800);
  const file = await page.evaluate(async () => Array.from(new Uint8Array(await window.__lastBlob.arrayBuffer())));
  const sheet = la.parseSheet(new Uint8Array(file).buffer, '4WLA');
  const columnB = sheet.rows.flatMap((r) => r.cells.filter((c) => c.ref.startsWith('B') && !/^B[A-Z]/.test(c.ref)).map((c) => c.value));
  check('and the Excel export writes them in the Activity ID column — the P6 ID, or the reason',
    columnB.includes('CX-1040') && columnB.includes('Troubleshooting'), columnB.filter(Boolean).slice(0, 8).join(', '));

  /* ── The section, afterwards ──────────────────────────────────────── */
  await page.locator('#rc-frame .rc-tab', { hasText: 'P6 activities' }).click();
  await page.waitForSelector('#rc-frame .p6-coverage', { timeout: 10000 });
  const stats = await page.locator('#rc-frame .p6-stat').allInnerTexts();
  const p6Ids = new Set((await stored()).map((a) => a.activity_id.toLowerCase()));
  const linkedNow = (await laRows()).filter((r) => r.kind === 'activity' && !r.archived
    && p6Ids.has(String(r.activity_id || '').trim().toLowerCase())).length;
  check('the section counts how the look-ahead stands: linked, given a reason, still to link',
    linkedNow >= 2 && stats.some((t) => new RegExp(`^\\s*${linkedNow}\\s+Linked to P6`).test(t))
      && stats.some((t) => /^\s*1\s+Not in P6, with a reason/.test(t)),
    `${linkedNow} linked — ${stats.map((t) => t.replace(/\s+/g, ' ')).join(' | ')}`);
  const find = page.locator('#rc-frame .p6-find');
  await find.click();
  await page.keyboard.type('1040');
  await page.waitForTimeout(200);
  check('and finds an activity in the list by part of its ID, saying how many rows name it',
    /CX-1040/.test(await page.locator('#rc-frame .p6-find').locator('xpath=../following-sibling::div[1]').innerText())
      && !/CX-2210/.test(await page.locator('#rc-frame .p6-find').locator('xpath=../following-sibling::div[1]').innerText()));
  check('the box keeps the caret while the list narrows', await page.evaluate(() => document.activeElement?.classList.contains('p6-find')));

  const reasonRow = (label) => page.locator('#rc-frame .p6-flags-admin tbody tr', { has: page.locator('td:first-child', { hasText: new RegExp(`^${label}$`) }) });
  check('a reason rows already give cannot be reworded under them — only retired',
    (await reasonRow('Troubleshooting').locator('button', { hasText: 'Edit' }).count()) === 0
      && (await reasonRow('Regression').locator('button', { hasText: 'Edit' }).count()) === 1);
  await page.locator('#rc-frame .p6-flags-admin button', { hasText: 'Add a reason' }).click();
  await page.waitForSelector('.cx-modal input');
  await page.waitForFunction(() => document.activeElement?.matches('.cx-modal input'), null, { timeout: 3000 }).catch(() => {});
  await page.locator('.cx-modal input').fill('  support ');
  await page.locator('.cx-modal .cx-modal-foot button.primary').click();
  await page.waitForTimeout(300);
  check('a reason already on the list is refused, whatever its case', /already on the list/.test(await page.locator('.cx-modal .rc-error').innerText().catch(() => '')));
  await page.locator('.cx-modal input').fill('Waiting on access');
  await page.locator('.cx-modal .cx-modal-foot button.primary').click();
  await page.waitForTimeout(500);
  check('and a new one is added from the calendar',
    await page.evaluate(() => window.__rc.rows.rc_p6_flags.some((f) => f.label === 'Waiting on access' && f.active !== false)));
  await reasonRow('Waiting on access').locator('button', { hasText: 'Retire' }).click();
  await page.waitForTimeout(400);
  check('and retired, kept on the list but offered no more',
    await page.evaluate(() => window.__rc.rows.rc_p6_flags.some((f) => f.label === 'Waiting on access' && f.active === false))
      && (await reasonRow('Waiting on access').getAttribute('class') || '').includes('rc-inactive'));
  await snap('end');
  await page.locator('#rc-frame .rc-tab', { hasText: /^Calendar$/ }).click();
  await page.waitForSelector('#rc-frame .la-grid', { timeout: 10000 });
}
