#!/usr/bin/env node
/**
 * The resource calendar, kept in the shared folder.
 *
 * The calendar's tables are JSON files under `calendar/` in the folder the
 * plan is in (`core/rc_db.js`), so every check here runs against a folder: a
 * fake one in the page (`tools/lib/rc_folder.js`), seeded with the files the
 * real database writes, and opened through the calendar's own front door. What
 * is checked:
 *
 *   the door        no folder, a folder with no calendar, bringing the old
 *                   calendar in from its backup, starting an empty one.
 *   the calendar    the look-ahead drawn from its newest reading, the legend,
 *                   the Changes list, the cancellation log, PTO and the lists.
 *   the folder      another computer's save read in as it lands; a file that
 *                   moved never written over; the pen — one person writes, the
 *                   other reads and can take it over.
 *   the wire        nothing at all leaves the machine.
 *
 * And the suites it calls, which drive the editor, TAWRs, P6 and the master
 * export on the same page.
 *
 *   node tools/smoke_calendar.js [--shot out.png] [--shot-tab Look-ahead,Legend]
 */

import { chromium } from 'playwright';
import { launchOptions } from './lib/chrome.js';
import { pinClock, pinNodeClock } from './lib/clock.js';
import { lookaheadEditor } from './smoke_la_editor.js';
import { tawrRequests } from './smoke_tawr.js';
import { lookaheadP6 } from './smoke_la_p6.js';
import { masterExport } from './smoke_master_export.js';
import { fixtureRows, seedFiles, installFolder, openCalendar, exposeDb, ME } from './lib/rc_folder.js';
import path from 'node:path';
import url from 'node:url';

pinNodeClock();

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
/* The page the browser opens: the repository's own, as the desktop runs it. */
const SITE = ROOT;

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

/** The look-ahead's date axis in the fixture's reading: a week back, five weeks long. */
const AXIS = (() => {
  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monday = todayMs - ((new Date(todayMs).getUTCDay() + 6) % 7) * 86400000;
  const first = monday - 7 * 86400000;
  return { days: 35, todayIdx: Math.round((todayMs - first) / 86400000), today: new Date(todayMs).toISOString().slice(0, 10) };
})();

/** A download lands somewhere the page cannot see, so what was handed to the browser is recorded. */
const captureDownloads = (pg) => pg.addInitScript(() => {
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.__lastBlob = blob;
    blob.text().then((text) => {
      try {
        const parsed = JSON.parse(text);
        window.__saved = { ...(window.__saved || {}), tables: Object.keys(parsed.tables || {}), json: parsed };
      } catch { /* not our JSON */ }
      if (/^%PDF-/.test(text)) {
        window.__saved = {
          ...(window.__saved || {}),
          pdf: { head: text.slice(0, 8), tail: text.slice(-8), size: blob.size,
            pages: (text.match(/\/Type \/Page[^s]/g) || []).length },
        };
      }
    });
    return create(blob);
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function patched() {
    if (this.download) window.__saved = { ...(window.__saved || {}), name: this.download };
    else click.call(this);
  };
});

async function main() {
  const browser = await chromium.launch(launchOptions());
  const consoleErrors = [];
  const watch = (pg) => {
    pg.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    pg.on('pageerror', (e) => consoleErrors.push(String(e)));
  };
  /* Anything the page tries to fetch that is not a file of this site is
     recorded. The calendar has no server: nothing it does should appear here. */
  const wire = [];
  const recordWire = (pg) => pg.route(/^(?!file:)/, (route) => {
    wire.push(route.request().url());
    route.abort();
  });
  const url_ = 'file://' + path.join(SITE, 'index.html');
  const fresh = async ({ files, name = ME, viewport = { width: 1500, height: 920 }, touch = false } = {}) => {
    const ctx = pinClock(await browser.newContext({ viewport, hasTouch: touch }));
    const pg = await ctx.newPage();
    watch(pg);
    await recordWire(pg);
    await captureDownloads(pg);
    await installFolder(pg, { files, name });
    await pg.goto(url_, { waitUntil: 'load' });
    await pg.waitForSelector('.tl-obj, .ws-switch', { timeout: 20000 });
    return { ctx, pg };
  };

  const { pg: page } = await fresh();

  /* ── The timeline still owns the application ──────────────────────────── */
  console.log('\nThe timeline is unaffected');
  check('the timeline opens with no account', (await page.locator('.tl-obj').count()) > 8);
  check('the workspace switch appears', (await page.locator('.ws-switch').count()) === 1);
  check('the timeline is the workspace on show',
    await page.evaluate(() => document.body.dataset.workspace !== 'calendar'));
  check('the calendar stage is empty until asked for',
    await page.evaluate(() => document.getElementById('rc-frame').children.length === 0));
  check('and its stylesheet is not on the page yet',
    await page.evaluate(() => ![...document.styleSheets].some((sh) => /\/css\/rc\./.test(sh.href || ''))));

  /* ── The door ─────────────────────────────────────────────────────────── */
  console.log('\nThe door is the folder');
  await page.locator('.ws-btn', { hasText: 'Calendar' }).click();
  await page.waitForSelector('#rc-frame .rc-head', { timeout: 10000 });
  check('the calendar stage is built on first use',
    await page.evaluate(() => document.getElementById('rc-frame').children.length > 0));
  check('the timeline canvas is hidden, not destroyed',
    await page.evaluate(() => document.querySelectorAll('#canvas-frame .tl-obj').length > 8));
  check('with no folder open it asks for the folder, not for an account',
    (await page.locator('#rc-frame button', { hasText: 'Open the folder' }).count()) === 1
      && (await page.locator('#rc-frame input[type="password"]').count()) === 0);
  check('its stylesheet came with it, and is applied — the head is a flex row',
    await page.evaluate(() => [...document.styleSheets].some((sh) => /\/css\/rc\./.test(sh.href || ''))
      && getComputedStyle(document.querySelector('#rc-frame .rc-head')).display === 'flex'));
  await page.locator('.ws-btn', { hasText: 'Timeline' }).click();
  await page.waitForTimeout(150);
  check('switching back shows the timeline again', await page.locator('.tl-obj').first().isVisible());

  await openCalendar(page);
  check('opening the folder opens the calendar in it', (await page.locator('#rc-frame .rc-tab').count()) >= 4);
  check('on the look-ahead',
    (await page.locator('#rc-frame .rc-tab[aria-pressed="true"]').first().innerText()).trim() === 'Look-ahead');
  check('the tabs are the look-ahead, PTO, TAWR and the lists — nothing of the huddle or the week plan',
    JSON.stringify(await page.locator('#rc-frame .rc-head .rc-tab').allInnerTexts()) === JSON.stringify(['Look-ahead', 'PTO', 'TAWR', 'Lists']),
    JSON.stringify(await page.locator('#rc-frame .rc-head .rc-tab').allInnerTexts()));
  check('and the plan opened with it, from the same folder',
    await page.evaluate(() => window.__CX_MODULES.req('core/filestore.js').state().plan === 'bart.json'));
  check('the person working is the name the application already knows, matched to the roster',
    await page.evaluate(() => window.__CX_MODULES.req('core/rc.js').me()?.id === 'p1'));
  check('they hold the calendar\'s pen, and the header says so',
    /Editing/.test(await page.locator('#rc-frame .rc-head').innerText())
      && await page.evaluate(() => Object.keys(window.__folder.files).some((k) => k.startsWith('calendar/pen/'))));

  console.log('\nThe look-ahead register');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Look-ahead' }).click();
  await page.waitForSelector('#rc-frame .la-grid', { timeout: 10000 });

  /* A reading published on the other computer redraws this one as it lands:
     OneDrive brings the files down, the database reads them in, the bell
     rings and the view asks for the newest reading at once. The copy is taken
     away again so every check below reads the register it always did. */
  {
    const snapshotReads = () => page.evaluate(() =>
      window.__rc.calls.filter((c) => c.kind === 'select' && c.table === 'rc_lookahead_snapshots').length);
    const before = await snapshotReads();
    const index = await page.evaluate(() => window.__folder.read('calendar/readings/index.json'));
    await page.evaluate(() => {
      const body = JSON.parse(window.__folder.read('calendar/readings/index.json'));
      const list = body.tables.rc_lookahead_snapshots;
      const newest = [...list].sort((a, b) => String(b.taken_at).localeCompare(String(a.taken_at)))[0];
      list.push({ ...newest, id: 'snapshot-rung', taken_at: new Date(Date.now() + 1000).toISOString(), file_hash: 'stub-hash-rung' });
      window.__folder.write('calendar/readings/grids/snapshot-rung.json', window.__folder.read(`calendar/readings/grids/${newest.id}.json`));
      window.__folder.write('calendar/readings/index.json', JSON.stringify(body));
      return window.__rc.refresh();
    });
    await page.waitForTimeout(900);
    check('a reading published on another computer redraws the calendar as it lands — the bell, not the poll',
      (await snapshotReads()) > before && (await page.locator('#rc-frame .la-grid').count()) === 1);
    await page.evaluate((text) => {
      window.__folder.write('calendar/readings/index.json', text);
      window.__folder.remove('calendar/readings/grids/snapshot-rung.json');
      return window.__rc.refresh();
    }, index);
    await page.locator('#rc-frame .rc-tab', { hasText: 'Look-ahead' }).click();
    await page.waitForSelector('#rc-frame .la-grid', { timeout: 10000 });
  }

  /* ── The calendar ─────────────────────────────────────────────────────
     The workbook drawn as it looks: activities down, days across, in the
     colours it was painted. It draws the snapshot rather than the file,
     which is what lets it render on a machine that has never been given
     the folder — including this one. */
  /* The day columns alone. That row also carries the sheet's own headings —
     Location, SSWP, Party to action — one cell each, so counting every `th` and
     taking one off (which is what this did, when "Activity" spanned them all)
     counts the frozen side as days. */
  const dayHeadCount = async () =>
    page.locator('#rc-frame .la-grid thead tr').nth(1).locator('th:not(.la-meta)').count();

  /* The sheet carries months and day numbers and no year at all, so the axis
     is dated from the snapshot's timestamp and then *checked* against the
     workbook's own weekday letters — only one candidate year makes M, Tu and W
     land where the file says they do. Everything below depends on that having
     worked. */
  const axis = AXIS;
  check('the date axis is found from the weekday row', (await dayHeadCount()) > 7);
  check('the weekend is marked apart',
    (await page.locator('#rc-frame .la-grid thead .la-weekend').count()) >= 4);
  // The explanatory text under the grid is gone; a today column is only drawn
  // when the year resolved, so that is the evidence now.
  check('the year is resolved, so today has a column',
    Boolean(axis.today) && (await page.locator('#rc-frame .la-grid thead .la-today').count()) >= 1);
  /* The grid's frame runs to the bottom of the pane — as long as the screen
     allows — with none of the old paragraphs of explanation under it. */
  await page.waitForTimeout(100);
  const fit = await page.evaluate(() => {
    const wrap = document.querySelector('#rc-frame .la-grid').parentElement;
    return { max: parseFloat(wrap.style.maxHeight), top: wrap.getBoundingClientRect().top,
      after: wrap.parentElement.parentElement.querySelectorAll(':scope > p.rc-hint').length };
  });
  check('the look-ahead grid reaches the bottom, with no text under it',
    fit.top + fit.max > page.viewportSize().height - 80 && fit.after === 0, JSON.stringify(fit));

  // Today is a line down the grid, not a tint: a fill would be one more colour
  // competing with the workbook's own.
  check('today is marked on the grid',
    (await page.locator('#rc-frame .la-grid td.la-today').count()) >= 1);
  check('and on the axis above it',
    (await page.locator('#rc-frame .la-grid thead th.la-today').count()) >= 1);

  /* The window opens on four weeks from this Monday. The past is dropped
     rather than scrolled past — this workbook carries a quarter of finished
     weeks to the left of today. */
  check('it opens on four weeks, not the whole sheet',
    (await dayHeadCount()) === 28, `${await dayHeadCount()} days`);
  check('and the week that has already gone is not drawn',
    !/X\.PAST/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));

  for (const [label, days] of [['2 weeks', 14], ['3 weeks', 21], ['4 weeks', 28]]) {
    await page.locator('#rc-frame .rc-tab', { hasText: label }).click();
    await page.waitForTimeout(200);
    check(`${label} narrows the axis to ${days} days`, (await dayHeadCount()) === days,
      `${await dayHeadCount()}`);
  }
  /* A row is judged against the weeks on screen, not against the workbook.
     Worked out once across the whole sheet — which is how it was — a row
     painted in a week that has gone stays on a four-week window with nothing
     in it. This file has thirty-eight of those. */
  check('a row worked only in a week that has gone is not drawn',
    !/finished/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));

  await page.locator('#rc-frame .rc-tab', { hasText: 'Everything' }).click();
  await page.waitForTimeout(200);
  check('and everything brings the finished weeks back',
    (await dayHeadCount()) === axis.days
      && /X\.PAST/.test(await page.locator('#rc-frame .la-grid tbody').innerText()),
    `${await dayHeadCount()} of ${axis.days}`);
  check('along with the rows that were worked in them',
    /finished/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  await page.locator('#rc-frame .rc-tab', { hasText: '4 weeks' }).click();
  await page.waitForTimeout(200);

  /* A month spans thirty columns, so a label written into the band scrolls out
     of sight long before the month does. It is a sticky span pinned past the
     frozen columns instead. */
  check('the month band carries a sticky label',
    (await page.locator('#rc-frame .la-grid .la-month-label').count()) >= 1);
  check('and it is pinned rather than scrolling away',
    await page.locator('#rc-frame .la-grid .la-month-label').first()
      .evaluate((n) => getComputedStyle(n).position === 'sticky'));

  /* ── The grey the spreadsheet shades its layout with ───────────────────
     It arrives unmapped like every other colour, and an unmapped colour
     counts as work — deliberately, because the unexplained might be. The
     consequence is that every shaded row is on screen until somebody says
     otherwise, which against the real file is 145 rows instead of 29. So the
     saying-so has to be one click, from where the problem is visible. */
  check('an unexplained colour keeps its rows on screen',
    /no dates yet/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  check('and the strip shows which colours are unexplained, not just how many',
    (await page.locator('#rc-frame .la-swatch-unmapped').count()) >= 2);

  await page.locator('#rc-frame .rc-tab', { hasText: 'Legend' }).click();
  await page.waitForSelector('#rc-frame .rc-table');
  await page.locator('#rc-frame tr', { hasText: '7F7F7F' })
    .locator('button', { hasText: 'Just shading' }).click();
  await page.waitForTimeout(400);
  check('one click says a colour is shading rather than work',
    await page.evaluate(() => window.__rc.rows.rc_legend
      .some((l) => l.argb === '7F7F7F' && l.role === 'ignore')));

  await page.locator('#rc-frame .rc-tab', { hasText: 'Calendar' }).click();
  await page.waitForSelector('#rc-frame .la-grid');
  check('and every row whose only paint was that grey drops out',
    !/no dates yet/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  check('while a row with a real shift over the same grey stays',
    /IXL Regression Testing/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));

  const gridText = await page.locator('#rc-frame .la-grid tbody').innerText();
  check('activities are listed down the side',
    /IXL Regression Testing/.test(gridText) && /Operational Readiness/.test(gridText));
  check('and their marks are on the days they fall',
    /X\.WIT/.test(gridText) && /X\.TCE/.test(gridText));

  // The cell keeps the workbook's own colour rather than a token of ours —
  // the person reading this has the spreadsheet open beside it.
  // Named by its mark rather than by position: the first painted cell on the
  // grid is now the shading on the section heading.
  const painted = page.locator('#rc-frame .la-grid td.la-painted', { hasText: 'X.WIT' }).first();
  check('a mark is drawn in the colour the workbook painted it',
    (await painted.evaluate((n) => n.style.background || n.style.backgroundColor)).includes('255, 255, 0'));
  check('and says what that colour means',
    /Day Shift/.test(await painted.getAttribute('title')));

  /* The rule the whole pipeline rests on: a colour the legend does not know
     is never guessed. 3399FF is a near miss of the legend's blue, which is
     exactly what Excel's recent-colours picker produces. */
  check('an unmapped colour is drawn as unmapped, not as its nearest match',
    (await page.locator('#rc-frame .la-grid td.la-unmapped').count()) === 1);
  check('and it says so rather than naming a meaning',
    /unmapped colour/.test(
      await page.locator('#rc-frame .la-grid td.la-unmapped').first().getAttribute('title')));
  /* Red on its own is a fact only somebody who can tell red from green can
     read, so a cancelled day is struck through as well. */
  const cancelledCell = page.locator('#rc-frame .la-grid td.la-cancel');
  check('a cancelled day is marked by more than its colour',
    (await cancelledCell.count()) >= 1
      && /Cancellation/.test(await cancelledCell.first().getAttribute('title'))
      && (await cancelledCell.first().evaluate((n) => getComputedStyle(n).backgroundImage)).includes('gradient'));

  /* Most of the sheet is activities carried for reference with nothing
     scheduled against them. They are hidden by default, and the switch is what
     stops that being a rule with no way back. */
  check('a row with nothing scheduled is hidden',
    !/no dates yet/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  const quietBox = page.locator('#rc-frame .cx-check', { hasText: 'nothing scheduled' }).locator('input');
  await quietBox.check();
  await page.waitForTimeout(250);
  check('and comes back when asked for',
    /no dates yet/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  await quietBox.uncheck();
  await page.waitForTimeout(250);

  /* A heading is the row whose *activity* cells are painted. The shading runs
     along the day columns of every row, so reading the colour alone would make
     every row a heading. */
  check('a section heading is recognised and set apart',
    (await page.locator('#rc-frame .la-grid tr.la-head-row').count()) === 1);
  check('and it is the row the workbook painted on the activity side',
    /HTT — Testing and Commissioning/.test(
      await page.locator('#rc-frame .la-grid tr.la-head-row').innerText()));
  /* Three activity rows and the Resource row under one of them. A heading is
     drawn because something under it is: it used to be exempt from the switch
     altogether, which is how one stray unmapped colour put a whole workbook
     back on screen with the box still unticked. */
  check('shading does not count as somebody being on site',
    (await page.locator('#rc-frame .la-grid tbody tr').count()) === 7,
    `${await page.locator('#rc-frame .la-grid tbody tr').count()} rows`);

  /* ── The Resource row ──────────────────────────────────────────────────
     The workbook names who is on an activity by adding a row underneath whose
     description reads "Resource", with the names typed into the day cells. It
     belongs to the activity above it: its location and work hours are blank
     because they carry down, and drawn on its own it would be a hundred and
     forty rows of the word "Resource". */
  const resourceRow = page.locator('#rc-frame .la-grid tr.la-resource-row:not(.la-absence-row)');
  check('the Resource row under an activity is drawn as part of it',
    (await resourceRow.count()) === 1);
  const resourceText = await resourceRow.innerText();
  check('and the names typed in its cells are on the calendar',
    /Dan/.test(resourceText) && /Okafor/.test(resourceText), resourceText.replace(/\s+/g, ' ').slice(0, 90));
  check('with the location it inherited from the activity above it',
    /T12/.test(resourceText), resourceText.replace(/\s+/g, ' ').slice(0, 90));

  // Filtering finds somebody by name, which is one of the two reasons anybody
  // types in that box — and it would find nothing if only the activity counted.
  const nameFilter = page.locator('#rc-frame input[placeholder^="Filter activities"]');
  await nameFilter.fill('Okafor');
  await page.waitForTimeout(250);
  check('the filter finds an activity by who is on it',
    /IXL Regression/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  await nameFilter.fill('');
  await page.waitForTimeout(200);

  /* ── The rows that say who is away ────────────────────────────────────
     "PTO" and "Other Group / Project" stand on their own at the bottom of the
     sheet, because what they say is about the person rather than about an
     activity. They are drawn — a blank against somebody's name in the week plan
     used to be the only trace of an absence the workbook stated plainly. */
  const absenceRows = page.locator('#rc-frame .la-grid tr.la-absence-row');
  check('the rows that say who is away are drawn', (await absenceRows.count()) === 3,
    `${await absenceRows.count()} rows`);
  const absenceText = await absenceRows.allInnerTexts();
  check('with the names typed on them',
    ['Rosa', 'Tom', 'Uma'].every((who) => absenceText.join(' ').includes(who)),
    absenceText.join(' | ').replace(/\s+/g, ' ').slice(0, 110));
  check('and they are never counted as scope',
    await page.evaluate(async () => {
      await window.__rc.loadAll();
      return !(window.__rc.rows.rc_lookahead_rows || []).some((r) => /^(PTO|Other Group)/i.test(r.raw_label || ''));
    }));

  const resourceBox = page.locator('#rc-frame .cx-check', { hasText: 'resource names' }).locator('input');
  await resourceBox.uncheck();
  await page.waitForTimeout(250);
  check('and the names can be switched off without losing the activities',
    (await page.locator('#rc-frame .la-grid tr.la-resource-row').count()) === 0
    && /IXL Regression Testing/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  /* One switch, every row of names. Switching them off to read the activities
     alone and being left with two rows of people would be it half working. */
  check('and the away rows go with them, because they are names too',
    (await page.locator('#rc-frame .la-grid tr.la-absence-row').count()) === 0);
  await resourceBox.check();
  await page.waitForTimeout(250);
  check('and both come back together',
    (await page.locator('#rc-frame .la-grid tr.la-absence-row').count()) === 3
    && (await resourceRow.count()) === 1);

  /* ── One sheet of paper ───────────────────────────────────────────────
     What people did instead was a screenshot, and a screenshot of this grid is
     a poor document: the frozen columns come out twice and the scroll clips
     whichever weeks nobody was looking at. */
  await page.locator('#rc-frame button', { hasText: 'Export PDF' }).click();
  await page.waitForSelector('.cx-modal');
  const dialog = await page.locator('.cx-modal').innerText();
  // The field labels are uppercased by the stylesheet, so `innerText` reads
  // "WEEKS" — matched case-insensitively rather than against the styling.
  check('the export asks what to put on the page rather than assuming',
    /weeks/i.test(dialog) && /paper/i.test(dialog) && /resource names/i.test(dialog),
    dialog.replace(/\n/g, ' | ').slice(0, 110));
  /* "It fits on one page" is true of anything if you shrink it far enough. The
     number somebody can act on is how small the print ends up, and it is on
     screen before anything is written. */
  check('and says what the print will actually come out at, before writing it',
    /print at about [\d.]+ pt/.test(dialog),
    dialog.split('\n').find((l) => /pt\./.test(l)) || '');

  const readingAt = () => page.locator('.cx-modal .rc-hint').first().innerText();
  const wide = await readingAt();
  await page.locator('.cx-modal select').first().selectOption({ label: 'Everything the sheet covers' });
  await page.waitForTimeout(200);
  check('widening the window makes the print smaller, and it says so',
    (await readingAt()) !== wide, (await readingAt()).slice(0, 90));
  await page.locator('.cx-modal select').first().selectOption({ index: 0 });
  await page.waitForTimeout(200);

  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Export PDF' }).click();
  await page.waitForTimeout(900);
  const saved = await page.evaluate(() => window.__saved || {});
  check('it writes a real PDF', saved.pdf?.head?.startsWith('%PDF-1.'), saved.pdf?.head || 'nothing');
  check('and a complete one', /%%EOF/.test(saved.pdf?.tail || ''), JSON.stringify(saved.pdf?.tail));
  /* The whole promise. A four-week look-ahead reassembled from four sheets on
     a meeting-room table is not a four-week look-ahead. */
  check('on exactly one page, whatever the window', saved.pdf?.pages === 1,
    `${saved.pdf?.pages} page(s), ${saved.pdf?.size} bytes`);
  check('announced like every other export, by name and size',
    /^lookahead-\d{4}-\d{2}-\d{2}\.pdf$/.test(saved.name || ''), saved.name || '');

  /* ── The key describes what is on screen ──────────────────────────────
     The register is the whole project's. Printed over a four-week window it
     is a key to somebody else's calendar: the reader checks a colour, finds
     three entries that are not here, and stops trusting the strip. */
  const stripText = await page.locator('#rc-frame .la-legend').first().innerText();
  check('the key lists only the colours the window carries',
    /Day Shift/.test(stripText) && !/Section divider/.test(stripText),
    stripText.replace(/\n/g, ' | ').slice(0, 110));
  check('and says how many of the register it left out',
    /not on screen/.test(stripText));

  /* Whether a colour is work or shading is the Legend's to say, and only the
     Legend's. The calendar used to list the colours keeping rows on screen with
     "Just shading" beside each — a second place to change the register, on the
     screen people read rather than the one they administer it from. */
  check('the calendar offers no way to recategorise a colour',
    (await page.locator('#rc-frame .la-why').count()) === 0
      && !/on screen because of/i.test(await page.locator('#rc-frame').innerText()));

  /* The three header rows stay put, one under the other. They were all pinned
     at the same line, so scrolling down stacked the weekday letters over the
     day numbers and the month, and nobody could tell which date a column was. */
  const tops = await page.evaluate(() => [...document.querySelectorAll('#rc-frame .la-grid thead tr')]
    .map((tr) => parseFloat(tr.cells[tr.cells.length - 1].style.top || '0')));
  check('the month, day and weekday rows are frozen one under another',
    tops.length === 3 && tops[0] === 0 && tops[1] > tops[0] && tops[2] > tops[1], JSON.stringify(tops));
  const stuck = await page.evaluate(() => {
    const scroller = document.querySelector('#rc-frame .la-grid').closest('.rc-scroll');
    scroller.scrollTop = scroller.scrollHeight;
    const box = scroller.getBoundingClientRect();
    const rows = [...document.querySelectorAll('#rc-frame .la-grid thead tr')].map((tr) => tr.getBoundingClientRect().top);
    scroller.scrollTop = 0;
    return { box: box.top, rows };
  });
  check('and still in view with the rows scrolled to the bottom',
    stuck.rows.every((t) => t >= stuck.box - 1 && t < stuck.box + 120)
      && stuck.rows[1] > stuck.rows[0] && stuck.rows[2] > stuck.rows[1], JSON.stringify(stuck));

  /* The activity columns stay put while the days scroll sideways — every one
     of them, at the place it started, in the header and the body alike — and
     nothing scrolls over them: not the days going sideways, and not the rows
     going up under the headings. A heading drawn at the same depth as the day
     numbers was covered by them the moment the grid moved. */
  const side = await page.evaluate(() => {
    const scroller = document.querySelector('#rc-frame .la-grid').closest('.rc-scroll');
    const frozen = () => [...document.querySelectorAll('#rc-frame .la-grid tr')]
      .flatMap((tr) => [...tr.querySelectorAll('.la-meta:not(.la-meta-all)')]);
    const lefts = () => frozen().map((td) => Math.round(td.getBoundingClientRect().left));
    // A frozen cell is covered when what is on top at its middle is not it.
    const covered = (cells) => cells.filter((td) => {
      const r = td.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !(hit && td.contains(hit));
    }).map((td) => td.textContent.trim() || td.className);
    const headings = () => [...document.querySelectorAll('#rc-frame .la-grid thead .la-meta-head')];
    const before = lefts();
    scroller.scrollLeft = scroller.scrollWidth;
    const after = lefts();
    const scrolled = scroller.scrollLeft;
    const sideways = covered([...headings(),
      ...document.querySelectorAll('#rc-frame .la-grid tbody tr:first-child .la-meta')]);
    scroller.scrollTop = 200;
    const down = covered(headings());
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    return {
      scrolled, count: before.length,
      moved: before.filter((x, i) => Math.abs(x - after[i]) > 1).length, sideways, down,
    };
  });
  check('the activity columns are frozen while the days scroll sideways',
    side.scrolled > 100 && side.count > 6 && side.moved === 0, JSON.stringify(side));
  check('and their headings stay on top, scrolled sideways or down',
    !side.sideways.length && !side.down.length, JSON.stringify(side));
  /* Measured once, the offsets went stale whenever the columns changed width
     afterwards — a font arriving, a zoom — and one frozen column slid over the
     next. The first column grows here as it would when a wider face lands. */
  const regrown = await page.evaluate(async () => {
    const table = document.querySelector('#rc-frame .la-grid');
    const scroller = table.closest('.rc-scroll');
    const ids = [...table.querySelectorAll('tbody tr:first-child .la-meta')];
    const was = ids.map((td) => td.style.left);
    ids[0].style.minWidth = `${ids[0].getBoundingClientRect().width + 60}px`;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    scroller.scrollLeft = scroller.scrollWidth;
    const overlaps = ids.slice(1).filter((td, i) =>
      td.getBoundingClientRect().left < ids[i].getBoundingClientRect().right - 1).length;
    const now = ids.map((td) => td.style.left);
    scroller.scrollLeft = 0;
    ids[0].style.minWidth = '';
    return { was, now, overlaps };
  });
  check('and today\'s headings are frozen with the rest of the header',
    await page.evaluate(() => {
      const cells = [...document.querySelectorAll('#rc-frame .la-grid thead th.la-today')];
      return cells.length >= 2 && cells.every((th) => getComputedStyle(th).position === 'sticky');
    }));
  check('and follow the columns when their widths change',
    regrown.overlaps === 0 && regrown.now.join() !== regrown.was.join(), JSON.stringify(regrown));

  // Filtering redraws the rows and leaves the field alone — rebuilding an
  // input under the caret is the trap this project has hit three times.
  const laFilter = page.locator('#rc-frame input[placeholder^="Filter activities"]');
  await laFilter.fill('Operational');
  await page.waitForTimeout(250);
  const filtered = await page.locator('#rc-frame .la-grid tbody').innerText();
  check('the filter narrows the activities',
    /Operational Readiness/.test(filtered) && !/IXL Regression/.test(filtered));
  check('and the caret stays in the box',
    await page.evaluate(() => document.activeElement?.placeholder?.startsWith('Filter activities')));
  await laFilter.fill('');
  await page.waitForTimeout(200);

  /* ── The legend ───────────────────────────────────────────────────────── */
  await page.locator('#rc-frame .rc-tab', { hasText: 'Legend' }).click();
  await page.waitForSelector('#rc-frame .rc-table');
  const legendText = await page.locator('#rc-frame').innerText();
  check('the legend lists what each colour means',
    /Day Shift/.test(legendText) && /Cancellation/.test(legendText) && /Third Shift/.test(legendText));
  check('and lists the colour nobody has mapped, with a count',
    /3399FF/i.test(legendText), legendText.split('\n').filter((l) => /3399/i.test(l)).join(' '));

  // The sheet is a setting, not a constant: a renamed tab must not mean a
  // redeploy.
  const sheetBox = page.locator('#rc-frame input[placeholder="4WLA"]');
  check('the sheet the grid is read from is editable', await sheetBox.inputValue() === '4WLA');
  await sheetBox.fill('4WLA v2');
  await page.locator('#rc-frame button', { hasText: 'Save' }).first().click();
  await page.waitForTimeout(300);
  check('and saving it goes to the settings table, not the source',
    await page.evaluate(() => window.__rc.rows.rc_settings
      .some((r) => r.key === 'lookahead_sheet' && r.value === '4WLA v2')));
  await sheetBox.fill('4WLA');
  await page.locator('#rc-frame button', { hasText: 'Save' }).first().click();
  await page.waitForTimeout(300);

  await page.locator('#rc-frame .rc-tab', { hasText: 'Changes' }).click();
  await page.waitForTimeout(400);
  const laText = await page.locator('#rc-frame').innerText();
  // Coverage before content: ingestion only runs when somebody has the app
  // open, so a silent fortnight must not read as a quiet one.
  check('it says when the look-ahead was last read',
    /never been read|Last read/.test(laText), laText.split('\n').slice(0, 6).join(' / '));

  /* The change log is the reason for snapshotting at all — the difference
     between two reads is what a claim gets built from. It was empty by
     construction: `classify()` was written, tested and never called. */
  check('a cancellation says what it was before it turned red',
    /was Day Shift/.test(laText), laText.split('\n').find((l) => /Cancelled on/.test(l)) || '');
  check('and a row arriving in a week already in view is named',
    /NMS testing/.test(laText));
  check('the window moving is counted apart from real scope movement',
    /2 change\(s\) that count, 1 that do not/.test(laText),
    laText.split('\n').find((l) => /that count/.test(l)) || '');
  // Written and never read back: an attribution recorded in a meeting was
  // invisible the moment the dialog closed.
  check('a judgement already recorded is shown against its event',
    /BART added it late/.test(laText));
  check('and one nobody has answered still asks',
    /1 cancellation\(s\) have nobody against them/.test(laText),
    laText.split('\n').find((l) => /nobody against/.test(l)) || '');

  /* ── The window the changes are read in ────────────────────────────────
     From a week back to the end of the calendar as it was last read. Everything
     outside that is either finished — a shift that moved in July cannot be
     planned around now — or beyond what the workbook has been filled in to. The
     register keeps the lot, and it says so, because a list that has been
     narrowed and does not say so reads as a list of everything. */
  check('the changes list says which weeks it covers',
    /from a week back to the end of the calendar/.test(laText),
    laText.split('\n').find((l) => /week back/.test(l)) || '');

  const windowBox = page.locator('#rc-frame .cx-check', { hasText: 'Everything recorded' }).locator('input');
  await windowBox.check();
  await page.waitForTimeout(400);
  check('and everything recorded is one click away',
    /nobody is planning round now/.test(await page.locator('#rc-frame').innerText())
    && /Everything recorded — \d+ change/.test(await page.locator('#rc-frame').innerText()),
    (await page.locator('#rc-frame').innerText()).split('\n').find((l) => /Everything recorded —/.test(l)) || '');
  await page.locator('#rc-frame .cx-check', { hasText: 'Everything recorded' }).locator('input').uncheck();
  await page.waitForTimeout(400);
  check('a change about a week months gone is not drawn by default',
    !/nobody is planning round now/.test(await page.locator('#rc-frame').innerText()));

  /* ── The cancellation log ────────────────────────────────────────────
     Every run of red cells any read has shown since the log's start, one event
     per side-by-side run, with whose it was and why. */
  console.log('\nThe cancellation log');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Cancellations' }).click();
  await page.waitForSelector('#rc-frame .rc-cancel-row', { timeout: 10000 });
  const cancelRows = () => page.locator('#rc-frame .rc-cancel-row');
  check('side-by-side red cells are one event, and a gap starts another',
    (await cancelRows().count()) === 2, `${await cancelRows().count()} event(s)`);
  check('a cancelled week reads as a week',
    /5 days/.test(await cancelRows().first().innerText()), await cancelRows().first().innerText());
  check('each red day is drawn as a cell',
    (await cancelRows().first().locator('.rc-cancel-cell').count()) === 5);
  check('nothing from before the log starts',
    !/IXL regression/.test(await page.locator('#rc-frame').innerText()));
  check('a day read before red was mapped still counts, once red means a cancellation',
    /1 day/.test(await cancelRows().nth(1).innerText()));

  await cancelRows().first().locator('button', { hasText: 'Add reason' }).click();
  await page.waitForTimeout(300);
  check('whose it was is BART, Hitachi or Other',
    JSON.stringify(await page.locator('.cx-modal select option').allTextContents()) === JSON.stringify(['BART', 'Hitachi', 'Other']));
  await page.locator('.cx-modal select').selectOption('BART');
  await page.locator('.cx-modal textarea').fill('Possession withdrawn');
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(500);
  const note1 = await page.evaluate(() => window.__rc.rows.rc_cancellation_notes.slice(-1)[0]);
  check('the reason and the party are recorded against the whole run',
    note1?.party === 'BART' && note1?.reason === 'Possession withdrawn'
      && note1?.raw_label === 'Cable pull' && note1?.end_date > note1?.start_date,
    JSON.stringify(note1));
  check('and shown in the log',
    /BART/.test(await cancelRows().first().innerText()) && /Possession withdrawn/.test(await cancelRows().first().innerText()));

  await cancelRows().first().locator('button', { hasText: 'Correct' }).click();
  await page.waitForTimeout(300);
  await page.locator('.cx-modal select').selectOption('Hitachi');
  await page.locator('.cx-modal textarea').fill('Our crew was reallocated');
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(500);
  const notes = await page.evaluate(() => window.__rc.rows.rc_cancellation_notes);
  check('a correction supersedes rather than edits',
    notes.length === 2 && notes[1].supersedes_id === notes[0].id && notes[0].party === 'BART');
  check('and the correction is what the log says',
    /Hitachi/.test(await cancelRows().first().innerText()) && !/BART/.test(await cancelRows().first().innerText()));

  await page.locator('#rc-frame .cx-check', { hasText: 'Only the ones with no reason yet' }).locator('input').check();
  await page.waitForTimeout(400);
  check('the ones still owed a reason can be listed alone', (await cancelRows().count()) === 1);
  await page.locator('#rc-frame .cx-check', { hasText: 'Only the ones with no reason yet' }).locator('input').uncheck();
  await page.waitForTimeout(400);

  // A span, not only a start: an end date before the second event drops it.
  const firstEnd = await cancelRows().first().getAttribute('data-start');
  await page.locator('#rc-frame input[aria-label="Log ends on"]').fill(firstEnd);
  await page.locator('#rc-frame input[aria-label="Log ends on"]').dispatchEvent('change');
  await page.waitForTimeout(500);
  check('the log can be narrowed to an end date as well as a start',
    (await cancelRows().count()) === 1 && /to /.test(await page.locator('#rc-frame').innerText()));
  check('and the export says how many it will carry',
    /Export 1 to CSV/.test(await page.locator('#rc-frame').innerText()));
  await page.locator('#rc-frame input[aria-label="Log ends on"]').fill('');
  await page.locator('#rc-frame input[aria-label="Log ends on"]').dispatchEvent('change');
  await page.waitForTimeout(500);

  await page.locator('#rc-frame button', { hasText: 'Re-read saved snapshots' }).click();
  await page.waitForTimeout(300);
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(900);
  check('the saved snapshots can be re-read under today\'s rules',
    /Saved snapshots re-read/.test(await page.locator('.cx-toast, .cx-toasts').allInnerTexts().then((t) => t.join(' '))));

  check('the responsible party is coloured — Hitachi blue, and one with no reason yet purple',
    await cancelRows().first().locator('.cx-badge.info', { hasText: 'Hitachi' }).count() === 1
      && await cancelRows().first().locator('.rc-cancel-cell.rc-cancel-by-hitachi').count() === 5
      && await cancelRows().nth(1).locator('.cx-badge.pending', { hasText: 'No reason yet' }).count() === 1);

  const cableStart = await cancelRows().first().getAttribute('data-start');
  const laState = () => page.evaluate((iso) => {
    const { req } = window.__CX_MODULES;
    const { mondayOf } = req('core/la_edit.js');
    const { la } = req('ui/rc_la_state.js');
    return {
      start: la.calendarStart || mondayOf(req('ui/rc_util.js').todayISO()),
      want: mondayOf(iso), weeks: la.calendarWeeks, filter: la.calendarFilter,
    };
  }, cableStart);
  const weeksBefore = (await laState()).weeks;
  await cancelRows().first().locator('button', { hasText: 'Show cells' }).click();
  // This fixture's readings have no "Cable pull" row, so the pinned calendar
  // says so rather than drawing an empty grid.
  await page.waitForSelector('#rc-frame .la-pinned', { timeout: 10000 });
  await page.waitForTimeout(300);
  const pinned = await laState();
  check('and a cancellation opens the calendar on its own row, in the week it was cancelled',
    /from the cancellation log: Cable pull/.test(await page.locator('#rc-frame .la-pinned').innerText())
      && pinned.start === pinned.want && pinned.weeks >= 1 && pinned.filter === '',
    JSON.stringify(pinned));
  check('and says so when that row is not on the look-ahead for those weeks',
    /That row is not on the look-ahead|holds nothing for the weeks this cancellation was logged in/
      .test(await page.locator('#rc-frame').innerText()));
  // Back to the plain calendar for the checks that follow.
  await page.locator('#rc-frame .la-pinned button', { hasText: 'Show every row' }).click();
  await page.waitForTimeout(400);
  check('and "Show every row" lets the pinned row go',
    (await page.locator('#rc-frame .la-pinned').count()) === 0);
  await page.evaluate((weeks) => {
    const { la } = window.__CX_MODULES.req('ui/rc_la_state.js');
    la.calendarStart = null;
    la.calendarWeeks = weeks;
  }, weeksBefore);

  /* ── PTO ──────────────────────────────────────────────────────────────
     Leave already had a list in Lists. This is the four weeks anybody is
     actually staffing, and it draws two things: what somebody booked, and what
     the 4WLA's PTO row says — which on this project is usually the only place
     an absence is written down at all. */
  console.log('\nPTO');
  await page.locator('#rc-frame .rc-tab', { hasText: 'PTO' }).click();
  await page.waitForSelector('#rc-frame .rc-pto', { timeout: 10000 });
  const ptoText = await page.locator('#rc-frame .rc-pto').innerText();
  check('the team is drawn against four weeks, not a list of date ranges',
    (await page.locator('#rc-frame .rc-pto-grid thead th.rc-pto-day').count()) === 28,
    `${await page.locator('#rc-frame .rc-pto-grid thead th.rc-pto-day').count()} columns`);
  check('everybody is on it, managers included — they take leave too',
    /Alex/.test(ptoText) && /Rosa/.test(ptoText));
  check('a day the 4WLA says is PTO is drawn even though nothing is booked',
    (await page.locator('#rc-frame .rc-pto-cell.rc-pto-sheet').count()) >= 1,
    `${await page.locator('#rc-frame .rc-pto-cell.rc-pto-sheet').count()} cell(s)`);
  check('and booked leave is drawn as the record it is',
    (await page.locator('#rc-frame .rc-pto-cell.rc-pto-booked').count()) >= 1);
  /* The cell *is* its colour. The table's row hover painted a fill over every
     cell in the row, so crossing somebody's leave with the pointer turned it
     white — the one grid where the hover has to leave the cells alone. */
  const bookedCell = page.locator('#rc-frame .rc-pto-cell.rc-pto-booked').first();
  const paintBefore = await bookedCell.evaluate((e) => getComputedStyle(e).backgroundColor);
  await bookedCell.hover();
  await page.waitForTimeout(80);
  const paintDuring = await bookedCell.evaluate((e) => getComputedStyle(e).backgroundColor);
  check('hovering a row does not paint over the leave on it',
    paintBefore === paintDuring, `${paintBefore} → ${paintDuring}`);
  await page.mouse.move(0, 0);
  /* Leave is one colour however it was written down. Which of the two wrote a
     day down is bookkeeping; the question this screen answers is who is away,
     and three swatches for one fact meant decoding the key to read the grid.
     The distinction is still available in the cell's title and in the counts. */
  check('booked leave and the sheet\u2019s own row are drawn as one colour',
    await page.evaluate(() => {
      const paint = (sel) => {
        const cell = document.querySelector(sel);
        return cell ? getComputedStyle(cell).backgroundImage + '|'
          + getComputedStyle(cell).backgroundColor : null;
      };
      const booked = paint('#rc-frame .rc-pto-cell.rc-pto-booked');
      const sheet = paint('#rc-frame .rc-pto-cell.rc-pto-sheet');
      return Boolean(booked) && booked === sheet;
    }));
  check('and a day off the project is drawn as something else again',
    await page.evaluate(() => {
      const paint = (sel) => {
        const cell = document.querySelector(sel);
        return cell ? getComputedStyle(cell).backgroundColor : null;
      };
      const off = paint('#rc-frame .rc-pto-cell.rc-pto-elsewhere');
      return !off || off !== paint('#rc-frame .rc-pto-cell.rc-pto-booked');
    }));
  const elsewhereFor = (name) => page.evaluate((who) => {
    const row = [...document.querySelectorAll('#rc-frame .rc-pto-grid tbody tr')]
      .find((tr) => tr.querySelector('.rc-pto-name')?.textContent === who);
    return row ? row.querySelectorAll('.rc-pto-elsewhere').length : -1;
  }, name);
  check('a day on another group\u2019s project is on the PTO calendar',
    (await elsewhereFor('Tom')) >= 1, String(await elsewhereFor('Tom')));
  check('and a day the 4WLA puts somebody in the office is not — that is this project\u2019s work',
    (await elsewhereFor('Uma')) === 0, String(await elsewhereFor('Uma')));
  check('the key says the two things it draws, and not three',
    /PTO/.test(ptoText) && /Other group \/ project/i.test(ptoText)
    && !/On the 4WLA only/.test(ptoText),
    ptoText.split('\n').filter((l) => /PTO —|Other group/i.test(l)).join(' | '));
  check('and the count of each is said out loud',
    /the 4WLA says are PTO with nothing booked/.test(ptoText),
    ptoText.split('\n').find((l) => /booked day/.test(l))?.slice(0, 100) || '');

  /* Booking one is a confirmation, not a retype: everything already reads the
     sheet as leave, and this gives the day a record that survives an edit. */
  await page.locator('#rc-frame .rc-pto-cell.rc-pto-sheet').first().click();
  await page.waitForSelector('.cx-modal');
  check('clicking one offers to make it a record, prefilled',
    (await page.locator('.cx-modal input[type="date"]').first().inputValue()).length === 10);
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Book' }).click();
  await page.waitForTimeout(600);
  check('and booking it writes one leave row, the same one Lists writes',
    await page.evaluate(() => (window.__rc.rows.rc_leave || [])
      .some((l) => /From the 4WLA/.test(l.note || ''))));
  check('nothing about the look-ahead was written to do it',
    await page.evaluate(() => !window.__rc.calls
      .some((c) => c.kind === 'insert' && c.table === 'rc_lookahead_rows')));

  /* ── The lists ────────────────────────────────────────────────────────── */
  console.log('\nThe lists');
  await page.locator('#rc-frame .rc-head .rc-tab', { hasText: 'Lists' }).click();
  await page.waitForSelector('#rc-frame .rc-table', { timeout: 10000 });
  const listsNav = await page.locator('#rc-frame .rc-body .rc-tabs').first().innerText();
  check('people, locations, parties, leave and settings — no accounts, inbox or problems',
    /People/.test(listsNav) && /Locations/.test(listsNav) && /Parties/.test(listsNav) && /Leave/.test(listsNav)
      && /Settings/.test(listsNav) && !/Accounts|Inbox|Problems/.test(listsNav), listsNav.replace(/\n/g, ' '));
  check('nobody has a role any more', !/Administrator|Viewer|Member/.test(await page.locator('#rc-frame .rc-table').innerText()));
  await page.locator('#rc-frame tr', { hasText: 'Dan' }).first().locator('button', { hasText: 'Add spelling' }).click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input').first().fill('R. Okafor');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Add' }).click();
  await page.waitForTimeout(500);
  check('a spelling the look-ahead uses is kept against a person',
    await page.evaluate(() => window.__rc.rows.rc_person_alias.some((a) => a.alias === 'R. Okafor' && a.person_id === 'p2')));
  check('and it is written to the registers file in the folder',
    await page.evaluate(() => /R\. Okafor/.test(window.__folder.read('calendar/registers.json') || '')));
  check('which says who saved it',
    await page.evaluate(() => JSON.parse(window.__folder.read('calendar/registers.json')).savedBy === 'Alex'));

  await page.locator('#rc-frame .rc-body .rc-tab', { hasText: 'Settings' }).click();
  await page.waitForSelector('#rc-frame .rc-settings');
  const settingsText = await page.locator('#rc-frame .rc-settings').innerText();
  check('the settings that are left are the look-ahead\'s and the readings\'',
    /Title on the export/.test(settingsText) && /Cancellation log starts on/.test(settingsText)
      && /Keep every editor reading for/.test(settingsText) && !/huddle|Database version|Sheet in the workbook/i.test(settingsText),
    settingsText.replace(/\n/g, ' | ').slice(0, 160));
  check('and it says where the calendar is', /BART CBTC\/calendar/.test(settingsText));
  await page.locator('#rc-frame button', { hasText: 'Back it up' }).click();
  await page.waitForTimeout(900);
  const backup = await page.evaluate(() => window.__saved || null);
  check('everything can be taken out as one file',
    Boolean(backup) && /resource-calendar-\d{4}-\d{2}-\d{2}\.json/.test(backup.name || ''), backup?.name || 'nothing saved');
  check('carrying every table, the look-ahead\'s readings included',
    Boolean(backup) && ['rc_la_rows', 'rc_lookahead_snapshots', 'rc_cancellation_notes', 'rc_tawrs'].every((t) => backup.tables.includes(t)),
    (backup?.tables || []).slice(0, 6).join(', '));
  check('in the shape the import reads', Boolean(backup?.json?.tables?.rc_people?.length));


  /* ── Another computer ─────────────────────────────────────────────────── */
  console.log('\nTwo computers, one folder');
  await page.locator('#rc-frame .rc-head .rc-tab', { hasText: 'Lists' }).click();
  await page.locator('#rc-frame .rc-body .rc-tab', { hasText: 'Parties' }).click();
  await page.waitForSelector('#rc-frame .rc-table');
  // Their save lands: the registers file, with a party added, a new stamp.
  await page.evaluate(() => {
    const body = JSON.parse(window.__folder.read('calendar/registers.json'));
    body.tables.rc_parties.push({ id: 'party-theirs', name: 'Subcontractor', active: true });
    window.__folder.write('calendar/registers.json', JSON.stringify(body));
  });
  const changed = await page.evaluate(() => window.__rc.refresh());
  check('a save from another computer is read in as OneDrive brings it down', changed === true);
  await page.locator('#rc-frame .rc-body .rc-tab', { hasText: 'Parties' }).click();
  await page.waitForTimeout(300);
  check('and drawn', /Subcontractor/.test(await page.locator('#rc-frame .rc-table').innerText()));

  // Their save lands again, and this time nobody here has read it yet.
  await page.evaluate(() => {
    const body = JSON.parse(window.__folder.read('calendar/registers.json'));
    body.tables.rc_parties.push({ id: 'party-later', name: 'Vendor B', active: true });
    window.__folder.write('calendar/registers.json', JSON.stringify(body));
  });
  page.once('dialog', () => {});
  await page.locator('#rc-frame button', { hasText: 'Add party' }).click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input').first().fill('Mine');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Add' }).click();
  await page.waitForTimeout(700);
  const reg = await page.evaluate(() => JSON.parse(window.__folder.read('calendar/registers.json')).tables.rc_parties.map((p) => p.name));
  check('a file that moved since it was read is never written over', reg.includes('Vendor B') && !reg.includes('Mine'), reg.join(', '));
  check('and their version is what is in memory now',
    await page.evaluate(() => window.__rc.rows.rc_parties.some((p) => p.name === 'Vendor B') && !window.__rc.rows.rc_parties.some((p) => p.name === 'Mine')));
  check('and the refusal is said, not swallowed',
    /saved on another computer/.test(await page.locator('.cx-toast').allInnerTexts().then((t) => t.join(' '))));

  /* ── The pen ──────────────────────────────────────────────────────────── */
  console.log('\nThe pen');
  // Another computer takes over: its claim, in the folder, outranks ours.
  await page.evaluate(() => {
    window.__folder.write('calendar/pen/d_other-s_other.json', JSON.stringify({
      id: 's_other', device: 'd_other', holder: 'Dana', since: Date.now(), beat: Date.now(), takeover: Date.now(),
    }));
    return window.__CX_MODULES.req('core/rc_folder.js').settle();
  });
  await page.waitForTimeout(400);
  check('somebody else taking over makes this window read-only, and says who',
    /Read only/.test(await page.locator('#rc-frame .rc-head').innerText())
      && /Dana is editing the calendar/.test(await page.locator('#rc-frame [data-pen="viewer"]').innerText()));
  const before = await page.evaluate(() => window.__folder.read('calendar/registers.json'));
  const refused = await page.evaluate(() => window.__CX_MODULES.req('core/rc.js').addParty('Not mine').then(() => 'written', (e) => e.message));
  check('and every write is refused while they hold it, naming them', /Dana is editing the calendar/.test(refused), refused);
  check('with nothing written to the folder', before === await page.evaluate(() => window.__folder.read('calendar/registers.json')));
  await page.locator('#rc-frame .rc-head .rc-tab', { hasText: 'Look-ahead' }).click();
  await page.waitForSelector('#rc-frame .la-edit-switch');
  await page.locator('#rc-frame .la-edit-switch').click();
  await page.waitForTimeout(300);
  check('the editor will not open without the pen',
    (await page.locator('#rc-frame .lae-grid').count()) === 0
      && /Dana is editing the calendar/.test(await page.locator('.cx-toast').allInnerTexts().then((t) => t.join(' '))));
  await page.locator('#rc-frame [data-pen="viewer"] button', { hasText: 'Take over' }).click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Take over' }).click();
  await page.waitForTimeout(500);
  check('taking over makes it ours again', /Editing/.test(await page.locator('#rc-frame .rc-head').innerText())
    && (await page.locator('#rc-frame [data-pen="viewer"]').count()) === 0);
  check('stated in our own claim, never by touching theirs',
    await page.evaluate(() => {
      const mine = Object.keys(window.__folder.files).filter((k) => k.startsWith('calendar/pen/') && !k.includes('d_other'));
      return mine.some((k) => JSON.parse(window.__folder.read(k)).takeover > 0)
        && JSON.parse(window.__folder.read('calendar/pen/d_other-s_other.json')).holder === 'Dana';
    }));
  await page.evaluate(() => window.__folder.remove('calendar/pen/d_other-s_other.json'));

  /* Hand back, with nobody else in the folder: it used to restate a claim that
     won at once, so the toast said read-only while the header said Editing. */
  await page.evaluate(() => window.__CX_MODULES.req('core/rc_folder.js').settle());
  await page.waitForSelector('#rc-frame .rc-section-actions');
  const actions = await page.evaluate(() => [...document.querySelectorAll('#rc-frame .rc-section-actions > button')]
    .map((b) => b.textContent.trim()));
  check('the look-ahead keeps its actions together: the pen, Edit and Master export side by side',
    JSON.stringify(actions.slice(-3)) === JSON.stringify(['Hand back', 'Edit', 'Master export']), actions.join(' | '));
  await page.locator('#rc-frame .rc-section-actions [data-action="hand-back"]').click();
  await page.waitForTimeout(500);
  const handedBack = async () => ({
    head: await page.locator('#rc-frame .rc-head').innerText(),
    banner: await page.locator('#rc-frame [data-pen="viewer"]').innerText().catch(() => ''),
    claim: await page.evaluate(() => Object.keys(window.__folder.files).some((k) => k.startsWith('calendar/pen/'))),
  });
  let back = await handedBack();
  check('handing back makes the header Read only, never still Editing',
    /Read only/.test(back.head) && !/Editing/.test(back.head), back.head.replace(/\n/g, ' | '));
  check('and says nobody is editing it, with Take over editing to get it back',
    /You handed the calendar back/.test(back.banner) && /Take over editing/.test(back.banner), back.banner.replace(/\n/g, ' '));
  check('and this window states no claim in the folder', !back.claim);
  // The next settle, and a heartbeat, with nobody else waiting: it must not come straight back.
  await page.evaluate(async () => {
    const f = window.__CX_MODULES.req('core/rc_folder.js');
    await f.settle();
    return f.penState();
  });
  await page.waitForTimeout(300);
  back = await handedBack();
  check('and it stays handed back when the pen is settled again with nobody waiting',
    /Read only/.test(back.head) && !/Editing/.test(back.head) && !back.claim);
  const refusedEdit = await page.evaluate(() => window.__CX_MODULES.req('core/rc.js').addParty('Not now').then(() => 'written', (e) => e.message));
  check('a write while handed back is refused, and says why', /handed the calendar back/.test(refusedEdit), refusedEdit);
  await page.locator('#rc-frame .rc-section-actions [data-action="take-over"]').click();
  await page.waitForTimeout(500);
  check('Take over editing beside Edit takes it straight back, with nobody to ask',
    (await page.locator('.cx-modal').count()) === 0 && /Editing/.test(await page.locator('#rc-frame .rc-head').innerText())
      && (await page.locator('#rc-frame [data-pen="viewer"]').count()) === 0);


  /* ── An empty folder ──────────────────────────────────────────────────── */
  console.log('\nAn empty folder: the old calendar brought in');
  {
    const backup = {
      exported_at: new Date().toISOString(),
      exported_by: 'Alex',
      tables: {
        ...fixtureRows(),
        rc_cancellation_notes: [{ id: 'n-old', raw_label: 'Cable pull', raw_location: 'TPSS 12', start_date: '2026-09-01',
          end_date: '2026-09-02', party: 'BART', reason: 'Imported reason', author: 'user-rc-1',
          created_at: '2026-09-02T10:00:00.123456+00:00', supersedes_id: null, codes: null, dismissed: false, la_row_id: null }],
        rc_actuals: [{ id: 'a1', person_id: 'p2', work_date: '2026-09-01', status: 'completed' }],
        rc_plan_entries: [{ id: 'pe1', person_id: 'p2', work_date: '2026-09-01' }],
      },
      files: { 'tawr/template.pdf': Buffer.from('%PDF-1.7 blank form').toString('base64') },
    };
    const { ctx: emptyCtx, pg: empty } = await fresh({ files: { 'bart.json': JSON.stringify({ schemaVersion: 99, objects: [], lanes: [], links: [] }) } });
    await empty.locator('.ws-btn', { hasText: 'Calendar' }).click();
    await empty.locator('#rc-frame button', { hasText: 'Open the folder' }).click();
    await empty.waitForSelector('#rc-frame [data-action="import"]', { timeout: 10000 });
    check('a folder with no calendar offers to bring the old one in, or start empty',
      (await empty.locator('#rc-frame [data-action="start-empty"]').count()) === 1);
    // A backup taken while a table timed out is refused whole, before anything is shown as importable.
    const cutShort = { ...backup, tables: { ...backup.tables, rc_lookahead_snapshots: { error: 'canceling statement due to statement timeout' } } };
    await empty.locator('#rc-frame input[data-field="backup"]').setInputFiles({
      name: 'resource-calendar-cut-short.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(cutShort)),
    });
    await empty.waitForSelector('#rc-frame .rc-error:not([hidden])', { timeout: 10000 }).catch(() => {});
    const refusal = await empty.locator('#rc-frame .rc-error').innerText().catch(() => '');
    check('a backup with a table that could not be read is refused, naming it, and nothing is offered to import',
      /incomplete/.test(refusal) && /rc_lookahead_snapshots/.test(refusal) && (await empty.locator('.cx-modal').count()) === 0
        && await empty.evaluate(() => !Object.keys(window.__folder.files).some((k) => k.startsWith('calendar/') && !k.startsWith('calendar/pen/'))),
      refusal.slice(0, 160));
    await empty.locator('#rc-frame input[data-field="backup"]').setInputFiles({
      name: 'resource-calendar-2026-09-22.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
    });
    await empty.waitForSelector('.cx-modal');
    const summary = await empty.locator('.cx-modal').innerText();
    check('it says what is in the backup before writing anything',
      /people — 10/.test(summary) && /lookahead snapshots — 5/.test(summary), summary.replace(/\n/g, ' | ').slice(0, 160));
    check('and what is not coming, because the calendar no longer has it',
      /the daily huddle's outcomes/.test(summary) && /the week plan/.test(summary));
    check('nothing is written until it is confirmed',
      await empty.evaluate(() => !Object.keys(window.__folder.files).some((k) => k.startsWith('calendar/') && !k.startsWith('calendar/pen/'))));
    await empty.locator('.cx-modal .cx-modal-foot button', { hasText: 'Import' }).click();
    await empty.waitForSelector('#rc-frame .rc-tabs', { timeout: 15000 });
    await exposeDb(empty);
    const files = await empty.evaluate(() => Object.keys(window.__folder.files).filter((k) => k.startsWith('calendar/')).sort());
    check('the calendar is in the folder, a file per kind of thing',
      ['calendar/db.json', 'calendar/registers.json', 'calendar/editor.json', 'calendar/notes.json', 'calendar/readings/index.json']
        .every((f) => files.includes(f)), files.join(' '));
    check('BART\'s blank form came with it', files.includes('calendar/tawr/template.pdf'));
    check('with every id kept',
      await empty.evaluate(() => window.__rc.rows.rc_people.some((p) => p.id === 'p8' && p.name === 'Victor Okonkwo')));
    check('and a reason given in the old calendar kept, in this calendar\'s spelling of the time',
      await empty.evaluate(() => {
        const n = JSON.parse(window.__folder.read('calendar/notes.json')).tables.rc_cancellation_notes[0];
        return n.reason === 'Imported reason' && n.created_at === '2026-09-02T10:00:00.123Z';
      }));
    check('and the huddle\'s outcomes left behind',
      await empty.evaluate(() => !Object.keys(window.__folder.files).some((k) => /actuals|plan_entries/.test(window.__folder.read(k) || ''))));
    check('the look-ahead it holds is drawn straight away',
      (await empty.locator('#rc-frame .la-grid').count()) === 1);
    await emptyCtx.close();
  }
  {
    const { ctx: newCtx, pg: blank } = await fresh({ files: { 'bart.json': JSON.stringify({ schemaVersion: 99, objects: [], lanes: [], links: [] }) } });
    await blank.locator('.ws-btn', { hasText: 'Calendar' }).click();
    await blank.locator('#rc-frame button', { hasText: 'Open the folder' }).click();
    await blank.waitForSelector('#rc-frame [data-action="start-empty"]', { timeout: 10000 });
    await blank.locator('#rc-frame [data-action="start-empty"]').click();
    await blank.waitForSelector('#rc-frame .rc-tabs', { timeout: 15000 });
    await exposeDb(blank);
    check('an empty calendar starts with the registers the old one was seeded with',
      await blank.evaluate(() => window.__rc.rows.rc_parties.length === 4 && window.__rc.rows.rc_support_codes.length === 3
        && window.__rc.rows.rc_settings.some((s) => s.key === 'lookahead_source' && s.value === 'editor')));
    check('and says it holds no look-ahead yet rather than drawing an empty grid',
      (await blank.locator('#rc-frame .la-grid').count()) === 0);
    await newCtx.close();
  }


  await lookaheadEditor(page, { check, shot: process.env.CX_EDITOR_SHOT || null });
  await tawrRequests(page, { check, shot: process.env.CX_TAWR_SHOT || null });
  await lookaheadP6(page, { check, shot: process.env.CX_P6_SHOT || null });
  await masterExport(page, { check });

  /* ── A tablet ─────────────────────────────────────────────────────────
     The calendar is used standing up, and a tablet in landscape is wider than
     every narrow rule — so touch, not width, decides the size of a target. */
  console.log('\nTablet');
  {
    const { ctx: tabletCtx, pg: tablet } = await fresh({ viewport: { width: 1180, height: 820 }, touch: true });
    await openCalendar(tablet);
    const smallTargets = () => tablet.evaluate(() => [...document.querySelectorAll('#rc-frame .rc-head button, #rc-frame .rc-tabs button')]
      .filter((n) => {
        const r = n.getBoundingClientRect();
        return r.width && r.height && r.height < 43.5;
      })
      .map((n) => `${n.tagName.toLowerCase()} "${(n.textContent || '').trim().slice(0, 20)}" ${Math.round(n.getBoundingClientRect().height)}px`));
    const small = await smallTargets();
    check('every tab and header control is a 44px target on a touch screen', small.length === 0, small.slice(0, 4).join(' | '));
    check('and the page never scrolls sideways',
      await tablet.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 0));
    await tabletCtx.close();
  }

  /* ── The wire ─────────────────────────────────────────────────────────── */
  console.log('\nNothing leaves the machine');
  check('nothing was fetched from anywhere but the site\'s own files', wire.length === 0, wire.slice(0, 3).join(' | '));

  /* ── Console ──────────────────────────────────────────────────────────── */
  console.log('\nConsole');
  const real = consoleErrors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND|fonts|net::ERR_FAILED/i.test(e));
  check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));

  const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null;
  const shotTab = process.argv.includes('--shot-tab') ? process.argv[process.argv.indexOf('--shot-tab') + 1] : null;
  if (shot) {
    await page.locator('.ws-btn', { hasText: 'Calendar' }).click();
    await page.waitForTimeout(400);
    for (const name of (shotTab || '').split(',').map((t) => t.trim()).filter(Boolean)) {
      await page.locator('#rc-frame .rc-tab', { hasText: name }).first().click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`\nscreenshot → ${shot}`);
  }

  await browser.close();

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length) {
    console.log('\nFailed:');
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
