#!/usr/bin/env node
/**
 * The phone app (`m/`), in a phone-sized Chromium.
 *
 * Three things are checked, and the first is the one the app exists to keep.
 *
 * **The timeline is not on the phone.** The app is the resource calendar alone;
 * `tools/build.js` refuses to link the timeline or the plan's storage into its
 * bundle, and this reads the bundle and every request the page makes to prove
 * nothing of the plan was ever loaded.
 *
 * **A member can see and change their own week, and nobody else's.** The same
 * reading as the week plan — the 4WLA where nobody wrote an entry, a stored
 * entry where somebody did — and the same three writes: add, change (revise, or
 * override the sheet), remove (a tombstone). A colleague's week is read-only; an
 * administrator may plan anybody's; a viewer nobody's.
 *
 * **It is an installable app.** A manifest with real icons, a service worker
 * scoped to `m/` that keeps the app — never the data — and a page that opens
 * again with the network gone. Served over HTTP rather than `file://`, because
 * service workers exist only on a real origin.
 *
 *   node tools/smoke_mobile.js [--shot out.png]
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { launchOptions } from './lib/chrome.js';
import { fakeSdk } from './lib/rc_stub.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SHOT = (() => {
  const i = process.argv.indexOf('--shot');
  return i >= 0 ? process.argv[i + 1] : null;
})();

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

/* ── A real origin ─────────────────────────────────────────────────────────
   The repository, served as the static host would serve it, with the two
   files a deployment writes replaced: a config naming a calendar backend (and
   no plan backend — the deployment's own shape), and an empty client, because
   `fakeSdk` puts one in the page. Served rather than routed, so the service
   worker — which Playwright's routing does not reach — sees the same bytes. */

const CONFIG = `window.CX_CONFIG = {
  supabaseUrl: '', supabaseAnonKey: '', requireAuth: false,
  rcSupabaseUrl: 'https://rc-stub.supabase.co', rcSupabaseAnonKey: 'rc-stub-key',
};`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

const requested = [];
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  requested.push(pathname);
  if (pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' }).end(CONFIG);
    return;
  }
  /* Chrome asks for /favicon.ico whenever it shows a document with no icon of
     its own — the raw manifest, below, opened as a page. The app's pages all
     name their icons; this only keeps that one browser habit out of the
     console-error check. */
  if (pathname === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  if (pathname === '/vendor/supabase.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' })
      .end('/* the client is stubbed in the page */');
    return;
  }
  const relative = pathname.replace(/^\/+/, '').replace(/(^|\/)$/, '$1index.html');
  const file = path.join(ROOT, relative);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  }).end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const APP = `${ORIGIN}/m/`;

/* Alex — the account the stub signs in — named on today's Resource row beside
   Dan, so "my week" and "only mine" have something of Alex's to find. Runs
   after `fakeSdk`, which is what builds the rows. */
function nameAlexToday() {
  const S = window.__rc;
  const snap = S.rows.rc_lookahead_snapshots[0];
  const row = snap.grid.rows.find((r) => r.row === 10);
  const cell = row.cells.find((c) => c.col === 8 + S.axis.todayIdx);
  cell.value = `${cell.value}, Alex`;
}

const browser = await chromium.launch(launchOptions());
const consoleErrors = [];

async function phone({ role = 'member', signedIn = true, colorScheme = 'light' } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${role}: ${m.text()} ${m.location()?.url || ''}`.trim());
  });
  page.on('pageerror', (e) => consoleErrors.push(`${role}: ${e}`));
  await page.addInitScript(({ role: r, signedIn: s }) => { window.__rc = { role: r, signedIn: s }; },
    { role, signedIn });
  await page.addInitScript(fakeSdk);
  await page.addInitScript(nameAlexToday);
  return { context, page };
}

const rcState = (page, fn) => page.evaluate(fn);
/* `append(null)` writes the word "null" where `el()` would have dropped the
   child, and it shipped in this app's own header once. */
const noStrayText = async (page) =>
  !/\b(null|undefined|NaN)\b|\[object /.test(await page.locator('#m-app').innerText());
const noSideways = (page) => page.evaluate(() => {
  const main = document.getElementById('m-main');
  return document.documentElement.scrollWidth <= window.innerWidth + 1
    && main.scrollWidth <= main.clientWidth + 1;
});

try {
  /* ══════════════════════════════════════════════════════════════════════
     The timeline stays off the phone
     ═══════════════════════════════════════════════════════════════════ */

  console.log('\nThe timeline is not on the phone');

  const bundle = fs.readFileSync(path.join(ROOT, 'mobile.bundle.js'), 'utf8');
  const modules = [...bundle.matchAll(/^\/\/ ([a-z_/]+\.js)$/gm)].map((m) => m[1]);
  check('the phone bundle is its own, and small', modules.length > 5 && modules.length < 30,
    `${modules.length} modules, ${Math.round(bundle.length / 1024)} kB`);
  const forbidden = modules.filter((m) =>
    /^(timeline\/|core\/(store|storage|filestore|cloud|desktop|model|history|access)\.js|io\/(exporters|scene|pdf|p6|importers)\.js|ui\/(shell|panels|inspector|commands|rc)\.js|main\.js)/.test(m));
  check('and carries no timeline, no plan storage and no plan exporter', forbidden.length === 0,
    forbidden.join(', '));
  check('it carries the calendar client and the shared calendar reading',
    modules.includes('core/rc.js') && modules.includes('ui/rc_util.js') && modules.includes('ui/rc_gate.js'));

  /* ══════════════════════════════════════════════════════════════════════
     A member's week
     ═══════════════════════════════════════════════════════════════════ */

  console.log('\nA member opens their week');

  const { context: mContext, page } = await phone({ role: 'member' });
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForSelector('.m-day', { timeout: 20000 });

  check('it is its own page', (await page.title()) === 'CX Calendar');
  check('it opens on My week', (await page.locator('.m-head-title').innerText()) === 'My week');
  check('the timeline is nowhere on it',
    await page.evaluate(() => !document.querySelector('.tl-obj, #canvas-frame, #sidenav')));
  const tabs = await page.locator('#m-tabs .m-tab').allInnerTexts();
  check('four tabs, under the thumb', tabs.join('|').replace(/\n/g, '') === 'My week|Look-ahead|PTO|More',
    tabs.join(' | ').replace(/\n/g, ''));
  check('the week is drawn as its seven days', (await page.locator('.m-day').count()) === 7);
  check('with no paragraph of explanation under it',
    !/nothing needs typing|stays on the record/i.test(await page.locator('.m-view').innerText()));

  const todayISO = await page.evaluate(() => window.__rc.axis.today);
  const todayCard = page.locator(`.m-day[data-date="${todayISO}"]`);
  check('today is marked, in words', (await todayCard.getAttribute('class')).includes('m-today')
    && /today/i.test(await todayCard.locator('.m-today-tag').innerText()));
  const todayText = await todayCard.innerText();
  check('the 4WLA names them today, so that is their plan with nothing typed',
    /IXL Regression Testing/.test(todayText), todayText.replace(/\n/g, ' | ').slice(0, 120));
  check('at the place the register knows, not the code the sheet types',
    /TPSS 12/.test(todayText) && !/\bT12\b/.test(todayText));
  const derived = todayCard.locator('.m-task', { hasText: 'IXL Regression Testing' });
  check('a day from the sheet carries no "Manual" flag', !/Manual/.test(await derived.innerText()));
  check('it can be changed, and not removed — the sheet asserts it',
    (await derived.getByRole('button', { name: /^Change/ }).count()) === 1
    && (await derived.getByRole('button', { name: /^Remove/ }).count()) === 0);
  check('nothing on the page scrolls sideways', await noSideways(page));
  check('no "null" or "undefined" anywhere on it', await noStrayText(page));

  const tabHeights = await page.locator('#m-tabs .m-tab').evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().height));
  check('the tab bar is thumb-sized', tabHeights.every((h) => h >= 44), tabHeights.join(', '));

  /* ── Adding ─────────────────────────────────────────────────────────── */

  console.log('\nAdding to the week');

  const addable = page.locator('.m-day:has(.m-add)').first();
  const addDay = await addable.getAttribute('data-date');
  await addable.locator('.m-add').click();
  await page.waitForSelector('.cx-modal');
  // Measured once it has finished sliding in.
  await page.waitForTimeout(400);
  check('the form is a sheet from the bottom of the screen',
    await page.evaluate(() => {
      const box = document.querySelector('.cx-modal').getBoundingClientRect();
      return Math.abs(box.bottom - window.innerHeight) < 2;
    }));
  if (SHOT) await page.screenshot({ path: SHOT.replace(/(\.png)?$/, '-add.png') });
  const fontSizes = await page.locator('.cx-modal .cx-input, .cx-modal .cx-select').evaluateAll((els) =>
    els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  check('its fields are 16px, so the phone does not zoom on focus', fontSizes.every((s) => s >= 16),
    fontSizes.join(', '));
  const shiftNames = await page.locator('.cx-modal .cx-seg button').allTextContents();
  check('the shifts are Day, Night and Blanket', shiftNames.join('|') === 'Day|Night|Blanket',
    shiftNames.join(' | '));
  await page.locator('.cx-modal .cx-seg button', { hasText: 'Blanket' }).click();
  const chips = page.locator('.cx-modal .m-daychips .m-chip');
  const chipCount = await chips.count();
  check('the week’s other working days are offered alongside', chipCount >= 1, `${chipCount}`);
  await page.locator('.cx-modal input[placeholder="What you will do"]').fill('Office — RFI log');
  if (chipCount) await chips.last().click();
  await page.locator('.cx-modal-foot').getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.cx-modal'));
  await page.waitForTimeout(300);

  const written = await rcState(page, () => window.__rc.rows.rc_plan_entries
    .filter((e) => e.person_id === 'p1' && e.task === 'Office — RFI log')
    .map((e) => e.work_date));
  const shiftsWritten = await rcState(page, () => [...new Set(window.__rc.rows.rc_plan_entries
    .filter((e) => e.person_id === 'p1' && e.task === 'Office — RFI log').map((e) => e.shift))]);
  check('a blanket is stored as the value the database checks for', shiftsWritten.join() === 'possession',
    shiftsWritten.join());
  check('the day is written as their own plan entry', written.includes(addDay), written.join(', '));
  check('and the other day ticked with it, one entry per day',
    written.length === (chipCount ? 2 : 1), `${written.length} row(s)`);
  const added = page.locator(`.m-day[data-date="${addDay}"] .m-task`, { hasText: 'Office — RFI log' });
  check('it is drawn at once, flagged as typed rather than from the sheet',
    (await added.count()) === 1 && /Manual/.test(await added.innerText()));
  check('and its shift reads as Blanket', /Blanket/.test(await added.innerText()));

  /* ── Changing ───────────────────────────────────────────────────────── */

  console.log('\nChanging and removing');

  await added.getByRole('button', { name: /^Change/ }).click();
  await page.waitForSelector('.cx-modal');
  const task = page.locator('.cx-modal input[placeholder="What you will do"]');
  check('the change form opens with what is there', (await task.inputValue()) === 'Office — RFI log');
  check('and says the old version stays on the record',
    /stays on the record/i.test(await page.locator('.cx-modal').innerText()));
  await task.fill('Office — RFI log and SAT prep');
  await page.locator('.cx-modal-foot').getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.cx-modal'));
  await page.waitForTimeout(300);
  check('a change is a revision, never an update',
    await rcState(page, () => window.__rc.calls.some((c) => c.kind === 'rpc' && c.table === 'rc_supersede_plan')));
  const revised = page.locator(`.m-day[data-date="${addDay}"] .m-task`, { hasText: 'SAT prep' });
  check('the revised task is drawn, and says it was revised',
    (await revised.count()) === 1 && /Revised/.test(await revised.innerText()));

  await revised.getByRole('button', { name: /^Remove/ }).click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal-foot').getByRole('button', { name: 'Remove', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.cx-modal'));
  await page.waitForTimeout(300);
  check('removing writes a withdrawal',
    await rcState(page, () => window.__rc.calls.some((c) => c.kind === 'rpc' && c.table === 'rc_withdraw_plan')));
  check('and the task leaves the day',
    (await page.locator(`.m-day[data-date="${addDay}"] .m-task`, { hasText: 'SAT prep' }).count()) === 0);
  check('while the record keeps every version',
    (await rcState(page, () => window.__rc.rows.rc_plan_entries
      .filter((e) => e.person_id === 'p1' && /RFI log/.test(e.task || '')).length)) >= 3);

  /* ── Overriding the sheet ───────────────────────────────────────────── */

  await page.locator(`.m-day[data-date="${todayISO}"] .m-task`, { hasText: 'IXL Regression Testing' })
    .getByRole('button', { name: /^Change/ }).click();
  await page.waitForSelector('.cx-modal');
  check('changing a day the sheet plans says that is what it is',
    /look-ahead plans this day/i.test(await page.locator('.cx-modal').innerText()));
  await page.locator('.cx-modal input[placeholder="What you will do"]').fill('IXL regression — witness only');
  await page.locator('.cx-modal-foot').getByRole('button', { name: 'Save my entry' }).click();
  await page.waitForFunction(() => !document.querySelector('.cx-modal'));
  await page.waitForTimeout(300);
  const override = await rcState(page, () => window.__rc.rows.rc_plan_entries
    .find((e) => e.person_id === 'p1' && e.task === 'IXL regression — witness only'));
  check('it writes the first stored entry for the day, still linked to the sheet’s row',
    override?.work_date === todayISO && override?.lookahead_row_id === 'lar2',
    JSON.stringify(override && { date: override.work_date, row: override.lookahead_row_id }));
  check('and that entry now stands for the day',
    /witness only/.test(await page.locator(`.m-day[data-date="${todayISO}"]`).innerText()));

  /* ── Somebody else's week ───────────────────────────────────────────── */

  console.log('\nA colleague’s week is for reading');

  await page.locator('.m-whose select').selectOption('p2');
  await page.waitForSelector('.m-note');
  const dan = await page.locator('.m-view').innerText();
  check('a member can look at a colleague’s week', /IXL Regression Testing/.test(dan));
  check('and is told it is read-only here', /read-only here/i.test(dan));
  check('with nothing offered that the database would refuse',
    (await page.locator('.m-view .m-add, .m-view .m-task-acts button').count()) === 0);
  await page.locator('.m-whose select').selectOption('p1');
  await page.waitForSelector('.m-add');

  await page.getByRole('button', { name: 'Next week' }).click();
  await page.waitForSelector('text=Back to this week');
  check('the next week is a tap away, with the way back', (await page.locator('.m-day').count()) === 7);
  await page.locator('text=Back to this week').click();
  await page.waitForSelector('.m-weekbar-sub:text("This week")');
  check('and back again', true);

  if (SHOT) await page.screenshot({ path: SHOT.replace(/(\.png)?$/, '-week.png') });

  /* ══════════════════════════════════════════════════════════════════════
     The look-ahead, a day at a time
     ═══════════════════════════════════════════════════════════════════ */

  console.log('\nThe look-ahead, one day at a time');

  await page.locator('#m-tabs .m-tab', { hasText: 'Look-ahead' }).click();
  await page.waitForSelector('.m-strip-day');
  check('the address remembers the tab', page.url().endsWith('#lookahead'));
  const strip = await page.locator('.m-strip-day').count();
  check('the strip is the four weeks from this Monday', strip === 28, `${strip} days`);
  check('today is the day on show',
    (await page.locator('.m-strip-day[aria-selected="true"]').getAttribute('aria-label')).length > 0
    && (await page.locator('.m-strip-day.m-strip-today').getAttribute('aria-selected')) === 'true');
  const ixl = page.locator('.m-la-item', { hasText: 'IXL Regression Testing' });
  check('what is on today is listed, with who is on it',
    (await ixl.count()) === 1 && /Dan/.test(await ixl.innerText()));
  check('the signed-in person is picked out among the names',
    (await ixl.locator('.m-name.m-name-me').innerText()) === 'Alex');
  check('the legend’s word for the paint is shown', /Day Shift/.test(await ixl.innerText()));
  check('under the section heading it sits in',
    /HTT/.test(await page.locator('.m-agenda .m-section').first().innerText()));
  check('the place reads as the register’s name', /TPSS 12/.test(await ixl.innerText()));
  check('no sideways scroll on the look-ahead either', await noSideways(page));
  check('nor any stray "null"', await noStrayText(page));

  const crewDay = await page.evaluate(() => {
    const S = window.__rc;
    const idx = S.axis.todayIdx >= 9 ? 7 : S.axis.todayIdx + 2;
    const first = Date.parse(`${S.axis.today}T00:00:00Z`) - S.axis.todayIdx * 86400000;
    return new Date(first + idx * 86400000).toISOString().slice(0, 10);
  });
  const crewInStrip = await page.locator('.m-strip-day').evaluateAll((els, iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return els.findIndex((e) => e.querySelector('.m-strip-num').textContent === String(d.getUTCDate()));
  }, crewDay);
  if (crewInStrip >= 0) {
    await page.locator('.m-strip-day').nth(crewInStrip).click();
    await page.waitForTimeout(150);
    const away = await page.locator('.m-away').innerText().catch(() => '');
    check('who is not on site is said apart from the work',
      /PTO[\s\S]*Rosa/.test(away) && /Office[\s\S]*Uma/.test(away) && /Other[\s\S]*Tom/.test(away),
      away.replace(/\n/g, ' | '));
    await page.locator('.m-mine-toggle').click();
    await page.waitForTimeout(150);
    check('"Only mine" on a day the sheet does not name them says so',
      /does not name you/i.test(await page.locator('.m-agenda').innerText()));
    await page.locator('.m-mine-toggle').click();
  }

  await page.locator('.m-strip-day.m-strip-today').click();
  await page.locator('.m-mine-toggle').click();
  await page.waitForTimeout(150);
  check('"Only mine" keeps what names them',
    (await page.locator('.m-la-item', { hasText: 'IXL Regression Testing' }).count()) === 1);
  await page.locator('.m-mine-toggle').click();

  await page.locator('.m-la-controls input').fill('nothing is called this');
  await page.waitForTimeout(150);
  check('the filter narrows the day', (await page.locator('.m-la-item').count()) === 0);
  check('and typing into it keeps the field',
    await page.evaluate(() => document.activeElement?.matches('.m-la-controls input')));
  await page.locator('.m-la-controls input').fill('');

  if (SHOT) await page.screenshot({ path: SHOT.replace(/(\.png)?$/, '-lookahead.png') });

  /* ══════════════════════════════════════════════════════════════════════
     Installing
     ═══════════════════════════════════════════════════════════════════ */

  console.log('\nAn app you can install');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await page.evaluate(async (href) => (await fetch(href)).json(), manifestHref);
  check('the manifest names it and opens it standalone',
    manifest.name === 'CX Calendar' && manifest.display === 'standalone' && manifest.scope === './');
  const icons = await page.evaluate(async (list) => Promise.all(list.map(async (icon) => {
    const bytes = new Uint8Array(await (await fetch(new URL(icon.src, location.href))).arrayBuffer());
    const dv = new DataView(bytes.buffer);
    const png = bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    return { sizes: icon.sizes, purpose: icon.purpose, png, w: png ? dv.getUint32(16) : 0, h: png ? dv.getUint32(20) : 0 };
  })), manifest.icons);
  check('its icons are real PNGs at the sizes it claims',
    icons.every((i) => i.png && `${i.w}x${i.h}` === i.sizes), icons.map((i) => `${i.w}x${i.h}`).join(', '));
  check('including a maskable one for Android', icons.some((i) => i.purpose === 'maskable'));
  check('and a home-screen icon for an iPhone', await page.evaluate(async () => {
    const href = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href');
    return Boolean(href) && (await fetch(href)).ok;
  }));

  const scope = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.scope));
  check('a service worker runs, scoped to the phone app alone', scope === `${ORIGIN}/m/`, scope);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.m-strip-day');
  check('and controls the page once it has been opened',
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls = [];
    for (const k of keys) urls.push(...(await (await caches.open(k)).keys()).map((r) => r.url));
    return urls;
  });
  check('what it keeps is the app', cached.some((u) => u.endsWith('/mobile.bundle.js'))
    && cached.some((u) => u.endsWith('/css/mobile.css')));
  check('and never the calendar’s data', !cached.some((u) => /supabase\.co|rest\/v1/.test(u)));
  check('nor anything of the timeline', !cached.some((u) => /app\.bundle\.js|\/index\.html$|timeline\.css/.test(u)
    && !u.includes('/m/')));

  /* A navigation inside the worker's folder that is not the page — somebody
     opening the manifest in a tab. It must not be kept as the page, or the app
     opens offline as a screen of JSON. Read straight out of the cache, because
     that is where the mistake would sit, silently, until the next time there
     was no signal. */
  await page.goto(`${APP}manifest.webmanifest`, { waitUntil: 'load' });
  const keptAsPage = await page.evaluate(async () =>
    (await caches.match(new URL('./', location.href).href))?.headers.get('content-type') || '');
  check('opening another file in the app’s folder does not replace the page it keeps',
    /text\/html/.test(keptAsPage), keptAsPage);
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForSelector('.m-view', { timeout: 10000 });

  await mContext.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  /* The tab bar, not the header: `#m-head` is in the page's own markup, so it
     is there even when none of the app's code ran — which is exactly what an
     app that failed to come out of the cache would look like. The tabs are
     drawn by the bundle, so this proves the whole app opened from the phone. */
  const opened = await page.waitForSelector('#m-tabs .m-tab', { timeout: 10000 }).then(() => true, () => false);
  check('with the network gone it still opens — the app itself, not just its page',
    opened && (await page.title()) === 'CX Calendar');

  /* The chip reads `navigator.onLine`, which is what a phone with no signal
     reports. Playwright's offline switch sets it on some Chromium builds and
     not on others — CI's newer one did not, and the check failed on a page
     that had opened perfectly well — so where the browser under test does not
     say it, the suite says it the way the phone would, and checks what this
     app does about it, which is the part that is ours. */
  const saidOffline = await page.evaluate(() => navigator.onLine === false);
  if (!saidOffline) {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
    });
  }
  const chip = await page.waitForSelector('.m-offline', { timeout: 10000 }).then(() => true, () => false);
  check('and says it is offline, in the chrome', chip && (await page.locator('.m-offline').count()) === 1,
    saidOffline ? 'the browser reported it' : 'the browser did not report it, so the suite did');
  await mContext.setOffline(false);
  // Hand the answer back to the browser, or every check after this one runs offline.
  if (!saidOffline) {
    await page.evaluate(() => {
      delete navigator.onLine;
      window.dispatchEvent(new Event('online'));
    });
  }

  /* ── Time off ───────────────────────────────────────────────────────── */

  console.log('\nAsking for PTO');

  await page.locator('#m-tabs .m-tab', { hasText: 'PTO' }).click();
  await page.waitForSelector('.m-view[data-view="pto"] .m-list-title');
  check('the PTO tab opens with nothing asked for yet',
    /Nothing booked or requested/i.test(await page.locator('.m-view').innerText()));

  /* A week after the first day from today that Alex works — so always a
     weekday, always next week, and never today: the form opens on today, and
     asking for a later day is what shows the last day following the first. */
  const ptoDay = await page.evaluate(() => {
    let ms = Date.parse(`${window.__rc.axis.today}T00:00:00Z`);
    while ((new Date(ms).getUTCDay() || 7) > 5) ms += 86400000;
    return new Date(ms + 7 * 86400000).toISOString().slice(0, 10);
  });

  await page.getByRole('button', { name: 'Request PTO' }).click();
  await page.waitForSelector('.cx-modal');
  const ptoDates = page.locator('.cx-modal input[type="date"]');
  check('the request opens on today, as one day',
    (await ptoDates.nth(0).inputValue()) === todayISO && (await ptoDates.nth(1).inputValue()) === todayISO);
  await ptoDates.nth(0).fill(ptoDay);
  await ptoDates.nth(0).dispatchEvent('change');
  check('and moving the first day drags the last one with it', (await ptoDates.nth(1).inputValue()) === ptoDay);
  check('its date fields are 16px too', (await ptoDates.evaluateAll((els) =>
    els.map((e) => parseFloat(getComputedStyle(e).fontSize)))).every((px) => px >= 16));
  if (SHOT) await page.screenshot({ path: SHOT.replace(/(\.png)?$/, '-pto-form.png') });
  await page.locator('.cx-modal input[placeholder="Optional"]').fill('Family wedding');
  await page.locator('.cx-modal-foot').getByRole('button', { name: 'Send request' }).click();
  await page.waitForFunction(() => !document.querySelector('.cx-modal'));
  await page.waitForTimeout(300);

  const asked = await rcState(page, () => window.__rc.rows.rc_leave.filter((l) => l.person_id === 'p1'));
  check('it is one leave row, theirs, sent as a request — the row the desktop PTO tab answers',
    asked.length === 1 && asked[0].status === 'requested' && asked[0].start_date === ptoDay
      && asked[0].end_date === ptoDay && asked[0].kind_id === 'k1' && asked[0].note === 'Family wedding',
    JSON.stringify(asked.map(({ status, start_date, kind_id }) => ({ status, start_date, kind_id }))));
  const leaveCard = page.locator('.m-leave');
  const leaveText = await leaveCard.innerText().catch(() => '');
  check('it is listed as waiting for approval, with what was asked',
    (await leaveCard.count()) === 1 && /Waiting for approval/.test(leaveText)
      && /1 working day/.test(leaveText) && /Annual leave/.test(leaveText) && /Family wedding/.test(leaveText),
    leaveText.replace(/\n/g, ' | '));
  if (SHOT) await page.screenshot({ path: SHOT.replace(/(\.png)?$/, '-pto.png') });

  await page.getByRole('button', { name: 'Request PTO' }).click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input[type="date"]').nth(0).fill(ptoDay);
  await page.locator('.cx-modal input[type="date"]').nth(1).fill(ptoDay);
  await page.locator('.cx-modal-foot').getByRole('button', { name: 'Send request' }).click();
  await page.waitForSelector('.cx-modal .rc-error:not([hidden])');
  check('the same days cannot be asked for twice',
    /already have PTO/i.test(await page.locator('.cx-modal .rc-error').innerText()));
  await page.locator('.cx-modal-foot').getByRole('button', { name: 'Cancel' }).click();
  await page.waitForFunction(() => !document.querySelector('.cx-modal'));

  await page.locator('#m-tabs .m-tab', { hasText: 'My week' }).click();
  await page.waitForSelector('.m-day');
  if (!(await page.locator(`.m-day[data-date="${ptoDay}"]`).count())) {
    await page.getByRole('button', { name: 'Next week' }).click();
    await page.waitForSelector(`.m-day[data-date="${ptoDay}"]`);
  }
  const requestedDay = await page.locator(`.m-day[data-date="${ptoDay}"]`).innerText();
  check('My week shows the day as requested — and still planned, because nobody has said yes',
    /Leave requested/.test(requestedDay) && !/On leave/.test(requestedDay));
  if (await page.locator('text=Back to this week').count()) await page.locator('text=Back to this week').click();

  await page.locator('#m-tabs .m-tab', { hasText: 'PTO' }).click();
  await page.waitForSelector('.m-leave');
  await page.locator('.m-leave').getByRole('button', { name: /^Withdraw/ }).click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal-foot').getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.cx-modal'));
  await page.waitForTimeout(300);
  check('withdrawing it changes its answer and deletes nothing',
    await rcState(page, () => {
      const mine = window.__rc.rows.rc_leave.filter((l) => l.person_id === 'p1');
      return mine.length === 1 && mine[0].status === 'cancelled';
    }));
  check('and it leaves the list', (await page.locator('.m-leave').count()) === 0);

  /* ── The account ────────────────────────────────────────────────────── */

  console.log('\nMore — the account');

  await page.reload({ waitUntil: 'load' });
  await page.locator('#m-tabs .m-tab', { hasText: 'More' }).click();
  await page.waitForSelector('.m-card');
  const moreText = await page.locator('.m-view').innerText();
  check('it says who is signed in and what they may do',
    /Alex/.test(moreText) && /plan your own days/i.test(moreText));
  check('and points at the full site for everything else', /full site/i.test(moreText));
  check('in a browser tab it says how to install', /On this phone/i.test(moreText));
  if (SHOT) await page.screenshot({ path: SHOT.replace(/(\.png)?$/, '-more.png') });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForSelector('.rc-signin');
  check('signing out lands on the calendar’s own sign-in form',
    /your phone/i.test(await page.locator('.rc-state').innerText()));
  check('with no tab bar until somebody is signed in', await page.locator('#m-tabs').isHidden());
  await page.locator('.rc-signin input[type="email"]').fill('alex@example.com');
  await page.locator('.rc-signin input[type="password"]').fill('secret');
  await page.locator('.rc-signin').getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('.m-view');
  check('and signing back in opens the app', (await page.locator('#m-tabs').isVisible()));

  const plan = requested.filter((p) => /^\/(index\.html)?$|app\.bundle\.js|timeline\.css|layout\.css/.test(p));
  check('not one request for the timeline, from the first page to the last', plan.length === 0,
    plan.join(', '));
  await mContext.close();

  /* ══════════════════════════════════════════════════════════════════════
     A viewer, and an administrator
     ═══════════════════════════════════════════════════════════════════ */

  console.log('\nA viewer reads; an administrator plans anybody');

  const viewer = await phone({ role: 'viewer', colorScheme: 'dark' });
  await viewer.page.goto(APP, { waitUntil: 'load' });
  await viewer.page.waitForSelector('.m-day', { timeout: 20000 });
  const dark = await viewer.page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bar: document.querySelector('meta[name="theme-color"]').content,
    chrome: getComputedStyle(document.documentElement).getPropertyValue('--chrome-bg').trim(),
  }));
  check('a phone set to dark opens dark, with the status bar to match',
    dark.theme === 'dark' && dark.bar === dark.chrome, JSON.stringify(dark));
  if (SHOT) await viewer.page.screenshot({ path: SHOT.replace(/(\.png)?$/, '-dark.png') });
  check('a viewer sees their week', (await viewer.page.locator('.m-day').count()) === 7);
  check('and is offered nothing to change',
    (await viewer.page.locator('.m-add, .m-task-acts button').count()) === 0);
  check('and told why', /read the calendar but not change it/i.test(await viewer.page.locator('.m-view').innerText()));
  await viewer.page.locator('#m-tabs .m-tab', { hasText: 'PTO' }).click();
  await viewer.page.waitForSelector('.m-view[data-view="pto"] .m-list-title');
  check('nor offered a PTO request the database would refuse',
    (await viewer.page.getByRole('button', { name: 'Request PTO' }).count()) === 0);
  await viewer.context.close();

  const admin = await phone({ role: 'admin' });
  await admin.page.goto(APP, { waitUntil: 'load' });
  await admin.page.waitForSelector('.m-whose select', { timeout: 20000 });
  const options = await admin.page.locator('.m-whose option').allInnerTexts();
  check('an administrator who takes no shifts still has their own week first',
    options[0] === 'Alex (me)' && options.length > 5, `${options.length} people`);
  await admin.page.locator('.m-whose select').selectOption('p2');
  await admin.page.waitForSelector('.m-task');
  check('and may plan anybody’s', (await admin.page.locator('.m-view .m-task-acts button').count()) >= 1
    && (await admin.page.locator('.m-view .m-note', { hasText: 'read-only' }).count()) === 0);

  await admin.page.locator('#m-tabs .m-tab', { hasText: 'PTO' }).click();
  await admin.page.getByRole('button', { name: 'Request PTO' }).click();
  await admin.page.waitForSelector('.cx-modal');
  check('an administrator\u2019s own PTO is booked rather than asked for',
    /Book PTO/.test(await admin.page.locator('.cx-modal-title').innerText()));
  const adminDay = await admin.page.evaluate(() => {
    let ms = Date.parse(`${window.__rc.axis.today}T00:00:00Z`);
    while ((new Date(ms).getUTCDay() || 7) > 5) ms += 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  });
  await admin.page.locator('.cx-modal input[type="date"]').nth(0).fill(adminDay);
  await admin.page.locator('.cx-modal input[type="date"]').nth(1).fill(adminDay);
  await admin.page.locator('.cx-modal-foot').getByRole('button', { name: 'Book it' }).click();
  await admin.page.waitForFunction(() => !document.querySelector('.cx-modal'));
  await admin.page.waitForSelector('.m-leave');
  check('and lands approved', await admin.page.evaluate(() => window.__rc.rows.rc_leave
    .some((l) => l.person_id === 'p1' && l.status === 'approved'))
    && /Approved/.test(await admin.page.locator('.m-leave').innerText()));
  await admin.context.close();

  /* Installed: opened from the home screen. The phone says so through
     `display-mode`, which is stood in for here — no browser under test can be
     put on a home screen. */
  const installed = await phone({ role: 'member' });
  await installed.page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query) => (/display-mode:\s*standalone/.test(query)
      ? { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
      : real(query));
  });
  await installed.page.goto(`${APP}#more`, { waitUntil: 'load' });
  await installed.page.waitForSelector('.m-card');
  const installedText = await installed.page.locator('.m-view').innerText();
  check('once installed, More says nothing about installing',
    !/On this phone|Installed/i.test(installedText), installedText.replace(/\n/g, ' | ').slice(0, 120));
  await installed.context.close();

  /* ══════════════════════════════════════════════════════════════════════
     Nobody signed in
     ═══════════════════════════════════════════════════════════════════ */

  console.log('\nArriving signed out');

  const fresh = await phone({ signedIn: false });
  await fresh.page.goto(`${APP}#join=dana@example.com`, { waitUntil: 'load' });
  await fresh.page.waitForSelector('.rc-signin', { timeout: 20000 });
  check('an invitation link opens on "create your account", with the address filled in',
    /create your account/i.test(await fresh.page.locator('.rc-state h2').innerText())
    && (await fresh.page.locator('.rc-signin input[type="email"]').inputValue()) === 'dana@example.com');
  check('it is the calendar’s one sign-in form, not a second copy',
    (await fresh.page.locator('.rc-signin').count()) === 1);
  if (SHOT) await fresh.page.screenshot({ path: SHOT.replace(/(\.png)?$/, '-signin.png') });
  await fresh.context.close();

  console.log('\nNo console errors');
  check('none, on any page', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (err) {
  failures.push(`the suite stopped: ${err.message.split('\n')[0]}`);
  console.log(`  ✗ the suite stopped: ${err.stack}`);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
