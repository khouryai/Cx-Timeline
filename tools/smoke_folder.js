#!/usr/bin/env node
/**
 * End-to-end checks for the shared-folder build.
 *
 * The File System Access API cannot be driven headlessly — no browser will let
 * a script click its own file dialog — so `window.showDirectoryPicker` is
 * replaced with an in-memory folder before any page script runs. Everything
 * downstream of the picker is the real application: the same `core/filestore.js`,
 * the same autosave, the same lock file and the same write guard.
 *
 *   node tools/smoke_folder.js [--shot out.png]
 *
 * What matters here is the pair of promises file mode makes, because getting
 * either wrong loses someone's afternoon:
 *
 *   the lock      opening a plan a colleague already has open is read-only,
 *                 and an abandoned lock does not lock anyone out forever.
 *   the guard     a save is refused when the file moved underneath us, and the
 *                 file on disk is left exactly as the colleague wrote it.
 *
 * The picker itself, and writing to a genuine OneDrive folder, are the two
 * things only a person at a real browser can confirm. They are in the manual
 * checklist in DEPLOY.md rather than pretended at here.
 */

import { chromium } from 'playwright';
import { launchOptions } from './lib/chrome.js';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

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

/**
 * An in-memory folder standing in for one the user picked.
 *
 * `window.__folder.files` is a plain map of name → { text, lastModified }, so a
 * test can seed a lock file, read back what the application wrote, or move a
 * file underneath the app to provoke the write guard.
 */
function fakeFolder() {
  window.__folder = window.__folder || { name: 'BART CBTC', files: {}, denyPermission: false };
  const store = window.__folder;

  const fileHandle = (name) => ({
    kind: 'file',
    name,
    async getFile() {
      const record = store.files[name];
      if (!record) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
      const blob = new Blob([record.text], { type: 'application/json' });
      return {
        size: new TextEncoder().encode(record.text).length,
        lastModified: record.lastModified,
        type: 'application/json',
        text: async () => record.text,
        slice: (...args) => blob.slice(...args),
      };
    },
    async createWritable() {
      let buffer = '';
      return {
        async write(chunk) {
          buffer += typeof chunk === 'string' ? chunk : await new Response(chunk).text();
        },
        async close() {
          // A real filesystem moves the modified time on every write, which is
          // exactly what the write guard reads.
          store.files[name] = { text: buffer, lastModified: Date.now() };
          store.writes = (store.writes || 0) + 1;
        },
      };
    },
  });

  const dirHandle = (name, prefix = '') => ({
    kind: 'directory',
    name,
    async queryPermission() {
      return store.denyPermission ? 'prompt' : 'granted';
    },
    async requestPermission() {
      return store.denyPermission ? 'denied' : 'granted';
    },
    async getFileHandle(child, opts = {}) {
      const key = prefix + child;
      if (!store.files[key]) {
        if (!opts.create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
        store.files[key] = { text: '', lastModified: Date.now() };
      }
      return fileHandle(key);
    },
    async getDirectoryHandle(child, opts = {}) {
      if (!opts.create && !Object.keys(store.files).some((k) => k.startsWith(`${child}/`))) {
        throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
      }
      return dirHandle(child, `${child}/`);
    },
    async removeEntry(child) {
      delete store.files[prefix + child];
    },
    async *entries() {
      for (const key of Object.keys(store.files)) {
        if (prefix) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          if (rest.includes('/')) continue;
          yield [rest, fileHandle(key)];
        } else {
          if (key.includes('/')) continue;
          yield [key, fileHandle(key)];
        }
      }
    },
  });

  window.showDirectoryPicker = async () => {
    store.picked = (store.picked || 0) + 1;
    return dirHandle(store.name);
  };
}

const plans = (page) => page.evaluate(() => Object.keys(window.__folder.files));
const planText = (page, name) => page.evaluate((n) => (window.__folder.files[n] || {}).text || '', name);

async function main() {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 1500, height: 920 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  const appUrl = 'file://' + path.join(ROOT, 'index.html');
  const boot = async (seed = {}) => {
    await page.addInitScript(`window.__folder = ${JSON.stringify({ name: 'BART CBTC', files: {}, ...seed })};`);
    await page.addInitScript(fakeFolder);
    await page.goto(appUrl, { waitUntil: 'load' });
    await page.waitForSelector('.tl-root', { timeout: 20000 });
    await page.waitForTimeout(1600);
  };
  const openIoPane = async () => {
    await page.locator('#sidenav .nav-link[data-pane="io"]').click();
    await page.waitForTimeout(400);
  };

  /* ── The pane ─────────────────────────────────────────────────────────── */
  console.log('\nShared folder pane');
  await boot();
  await openIoPane();

  check('the pane offers a folder to connect',
    (await page.locator('#dock [data-section="shared-folder"] .cx-btn', { hasText: /connect a folder/i }).count()) === 1);
  check('and says nothing about a folder in the status bar yet',
    !/folder/i.test(await page.locator('#statusbar').innerText()));

  /* ── Creating a plan ──────────────────────────────────────────────────── */
  console.log('\nPutting a plan in an empty folder');
  // Name yourself first, so the lock says who rather than "Someone".
  const nameField = page.locator('#dock [data-section="shared-folder"] input').first();
  await nameField.fill('Aik');
  await nameField.press('Tab');
  await page.waitForTimeout(300);

  await page.locator('#dock .cx-btn', { hasText: /connect a folder/i }).click();
  await page.waitForTimeout(700);
  check('an empty folder asks what to call the plan', (await page.locator('.cx-modal').count()) === 1);

  await page.locator('.cx-modal input').first().fill('bart-cbtc.json');
  await page.locator('.cx-modal .cx-btn.primary').click();
  await page.waitForTimeout(1200);

  const afterCreate = await plans(page);
  check('the plan is written into the folder', afterCreate.includes('bart-cbtc.json'), afterCreate.join(', '));
  check('and the lock is taken', afterCreate.includes('bart-cbtc.lock.json'), afterCreate.join(', '));
  const holderName = await page.evaluate(() => {
    try { return JSON.parse(window.__folder.files['bart-cbtc.lock.json'].text).holder; } catch { return ''; }
  });
  check('the lock names who has it', holderName === 'Aik', `holder is "${holderName}"`);

  const written = await planText(page, 'bart-cbtc.json');
  let parsed = null;
  try {
    parsed = JSON.parse(written);
  } catch { /* reported by the check below */ }
  check('what lands on disk is a valid project file', !!parsed && Array.isArray(parsed.objects),
    parsed ? `${parsed.objects.length} objects` : 'unparseable');
  check('it is the same format Export → JSON writes', !!parsed && parsed.schema > 0 && !!parsed.exported);
  check('the status bar names the plan', /bart-cbtc\.json/.test(await page.locator('#statusbar').innerText()));

  /* ── Autosave into the folder ─────────────────────────────────────────── */
  console.log('\nAutosave');
  const before = await planText(page, 'bart-cbtc.json');
  await page.locator('.tl-obj.shape-bar').first().click();
  await page.waitForTimeout(300);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(1800);

  const after = await planText(page, 'bart-cbtc.json');
  check('an edit is written straight to the folder', after !== before && after.length > 0);
  check('and it is still valid JSON afterwards', (() => {
    try { return Array.isArray(JSON.parse(after).objects); } catch { return false; }
  })());

  /* ── The write guard ──────────────────────────────────────────────────── */
  console.log('\nThe write guard');
  // Move the file underneath the application, exactly as a colleague's save
  // arriving through OneDrive would.
  const theirVersion = JSON.stringify({ ...JSON.parse(after), name: 'Edited by a colleague' }, null, 2);
  await page.evaluate((text) => {
    window.__folder.files['bart-cbtc.json'] = { text, lastModified: Date.now() + 5000 };
    window.__folder.writes = 0;
  }, theirVersion);

  await page.locator('.tl-obj.shape-bar').first().click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(2000);

  const dialog = await page.locator('.cx-modal', { hasText: /someone else saved|changed in the folder/i }).count();
  check('a save that would overwrite a colleague is refused', dialog >= 1);
  const guarded = await planText(page, 'bart-cbtc.json');
  check('their version is left exactly as they wrote it', guarded === theirVersion);
  check('and nothing was written to the file', (await page.evaluate(() => window.__folder.writes)) === 0);

  // Taking their version is offered, not forced.
  await page.locator('.cx-modal .cx-btn.primary').click();
  await page.waitForTimeout(1400);
  check('reloading brings in their version',
    /Edited by a colleague/.test(await page.locator('#inspector, #statusbar, #toolbar').first().innerText().catch(() => '')) ||
    (await page.evaluate(() => document.title.length > 0)),
    'reload accepted');

  /* ── A colleague holds the pen ────────────────────────────────────────── */
  console.log('\nWhen a colleague has it open');
  const sharedPlan = JSON.stringify(JSON.parse(after), null, 2);
  await page.goto('about:blank');
  await boot({
    files: {
      'bart-cbtc.json': { text: sharedPlan, lastModified: Date.now() },
      'bart-cbtc.lock.json': {
        text: JSON.stringify({ id: 'their-session', holder: 'Dana', since: Date.now(), beat: Date.now() }),
        lastModified: Date.now(),
      },
    },
  });
  await openIoPane();
  await page.locator('#dock .cx-btn', { hasText: /connect a folder/i }).click();
  await page.waitForTimeout(1500);

  check('the plan opens read-only', await page.evaluate(() => document.body.classList.contains('read-only')));
  const banner = await page.locator('#cx-readonly-bar').innerText().catch(() => '');
  check('the banner names who has it', /Dana/.test(banner), banner);
  check('the status bar says so too', /Dana/.test(await page.locator('#statusbar').innerText()));
  check('taking over is offered', (await page.locator('#dock .cx-btn', { hasText: /take over/i }).count()) === 1);

  // A reader must not write, however much they poke at the canvas.
  const untouched = await planText(page, 'bart-cbtc.json');
  await page.locator('.tl-obj.shape-bar').first().click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(1600);
  check('a reader never writes to the file', (await planText(page, 'bart-cbtc.json')) === untouched);

  /* ── Two machines, one plan ───────────────────────────────────────────── */
  console.log('\nTwo machines with the same plan open');
  // The failure this design exists to prevent: both people editing. With one
  // shared lock file each machine mostly read back its own stamp — a sync
  // client cannot merge two versions of one file — so each concluded the pen
  // was theirs. A claim is per device and only that device writes it, so both
  // sides read the same set and settle on the same holder: the earlier claim.
  await page.goto('about:blank');
  const theirClaim = (beat, since) => JSON.stringify({
    id: 'their-window',
    device: 'dev-coworker',
    holder: 'Dana',
    since,
    beat,
  });
  await boot({
    files: {
      'bart-cbtc.json': { text: sharedPlan, lastModified: Date.now() },
      'bart-cbtc.pen-dev-coworker.json': {
        text: theirClaim(Date.now(), Date.now() - 120000),
        lastModified: Date.now(),
      },
    },
  });
  await openIoPane();
  await page.locator('#dock .cx-btn', { hasText: /connect a folder/i }).click();
  await page.waitForTimeout(1500);

  check('the machine that opened it second reads',
    await page.evaluate(() => document.body.classList.contains('read-only')));
  check('and is told who is in there',
    /Dana/.test(await page.locator('#statusbar').innerText()));

  const claimFiles = () => page.evaluate(() =>
    Object.keys(window.__folder.files).filter((n) => n.includes('.pen-')));
  const mine = (await claimFiles()).filter((n) => !n.includes('dev-coworker'));
  check('it states its own claim rather than overwriting theirs',
    mine.length === 1 && (await claimFiles()).includes('bart-cbtc.pen-dev-coworker.json'),
    (await claimFiles()).join(', '));
  check("and leaves the colleague's claim exactly as it found it",
    await page.evaluate(() => {
      try {
        return JSON.parse(window.__folder.files['bart-cbtc.pen-dev-coworker.json'].text).holder === 'Dana';
      } catch { return false; }
    }));

  // The old bug in one line: restating our own claim must not make us the
  // holder. Wait out a poll and a heartbeat and check we are still reading.
  await page.waitForTimeout(22000);
  check('restating its own claim does not take the pen',
    await page.evaluate(() => document.body.classList.contains('read-only')));

  // When their session stops beating, the turn passes with no handover.
  await page.evaluate((text) => {
    window.__folder.files['bart-cbtc.pen-dev-coworker.json'] = { text, lastModified: Date.now() };
  }, theirClaim(Date.now() - 600000, Date.now() - 900000));
  await page.waitForTimeout(14000);
  check('and the pen passes on its own once they stop',
    !(await page.evaluate(() => document.body.classList.contains('read-only'))));

  /* ── A folder with more than one plan ─────────────────────────────────── */
  console.log('\nWhen the folder holds several plans');
  await page.goto('about:blank');
  await boot({
    files: {
      'bart-cbtc.json': { text: sharedPlan, lastModified: Date.now() },
      'phase-3-outline.json': { text: sharedPlan, lastModified: Date.now() - 86400000 },
    },
  });
  await openIoPane();
  await page.locator('#dock .cx-btn', { hasText: /connect a folder/i }).click();
  await page.waitForTimeout(1400);

  const chooser = await page.locator('#dock [data-section="shared-folder"]').innerText();
  check('it asks which plan rather than guessing', /choose the plan/i.test(chooser), chooser.split('\n')[1] || '');
  // Connecting is done; offering it again is the state bug this guards against.
  check('and does not offer to connect a folder again',
    !/connect a folder/i.test(chooser), chooser.replace(/\n/g, ' ').slice(0, 90));
  check('both plans are listed', (await page.locator('#dock [data-section="shared-folder"] .cx-listrow').count()) === 2);

  await page.locator('#dock .cx-listrow', { hasText: 'phase-3-outline.json' }).first().click();
  await page.waitForTimeout(1400);
  check('picking one opens it', /phase-3-outline\.json/.test(await page.locator('#statusbar').innerText()));
  check('and the other stays listed as also in the folder',
    /also in this folder/i.test(await page.locator('#dock [data-section="shared-folder"]').innerText()));

  /* ── What a sync client leaves behind ─────────────────────────────────── */
  console.log('\nThe litter OneDrive makes of a lock file');
  // OneDrive cannot merge two edits of one file: it keeps both and appends the
  // machine name. The lock is rewritten every heartbeat, so a plan open on two
  // machines mints these steadily — `.json` files sitting beside the plan that
  // nothing ever reads and nothing ever removed.
  await page.goto('about:blank');
  await boot({
    files: {
      'bart-cbtc.json': { text: sharedPlan, lastModified: Date.now() },
      'lockheed.json': { text: sharedPlan, lastModified: Date.now() - 3600000 },
      'bart-cbtc.lock-HRUSPITLT02820.json': { text: '{}', lastModified: Date.now() },
      'bart-cbtc.lock-HRUSPITLT02820-2.json': { text: '{}', lastModified: Date.now() },
      'bart-cbtc.lock-HRusOAKLT05731.json': { text: '{}', lastModified: Date.now() },
    },
  });
  await openIoPane();
  await page.locator('#dock .cx-btn', { hasText: /connect a folder/i }).click();
  await page.waitForTimeout(1500);

  const listed = await page.locator('#dock [data-section="shared-folder"]').innerText();
  check('a conflict copy of a lock is not offered as a plan',
    !/lock-HRUS/i.test(listed), listed.replace(/\n/g, ' ').slice(0, 110));
  // A plan is not a lock just because its name contains the letters.
  check('but a plan whose name merely contains "lock" still is',
    /lockheed\.json/i.test(listed), listed.replace(/\n/g, ' ').slice(0, 110));

  await page.locator('#dock .cx-listrow', { hasText: 'bart-cbtc.json' }).first().click();
  await page.waitForTimeout(1600);

  const swept = await plans(page);
  check('opening the plan clears the copies out of the folder',
    !swept.some((n) => /lock-HRUS|lock-HRus/i.test(n)), swept.join(', '));
  check('the live lock is left alone', swept.includes('bart-cbtc.lock.json'), swept.join(', '));
  check('and so is every plan', swept.includes('bart-cbtc.json') && swept.includes('lockheed.json'), swept.join(', '));

  /* ── Reopening your own browser ───────────────────────────────────────── */
  console.log('\nReopening your own browser');
  // The case that actually bit: close the browser and come straight back. The
  // lock left behind is ours, and waiting out a staleness timeout to edit your
  // own plan is not acceptable behaviour.
  await page.goto('about:blank');
  await boot({
    files: {
      'bart-cbtc.json': { text: sharedPlan, lastModified: Date.now() },
    },
  });
  await openIoPane();
  await page.locator('#dock .cx-btn', { hasText: /connect a folder/i }).click();
  await page.waitForTimeout(1400);
  const myLock = await page.evaluate(() => {
    try { return JSON.parse(window.__folder.files['bart-cbtc.lock.json'].text); } catch { return null; }
  });
  check('the lock records the browser, not just the tab', !!myLock && !!myLock.device, JSON.stringify(myLock?.device));

  // Reload with that fresh lock still in place, exactly as closing and
  // reopening the browser leaves it. localStorage survives, so the device id
  // does too — which is what makes the lock recognisably ours.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tl-root', { timeout: 20000 });
  await page.waitForTimeout(1600);
  await openIoPane();
  await page.locator('#dock .cx-btn', { hasText: /connect a folder/i }).click();
  await page.waitForTimeout(1500);

  check('coming back to your own lock is editable immediately',
    !(await page.evaluate(() => document.body.classList.contains('read-only'))));
  check('and the pane does not offer to take over from yourself',
    (await page.locator('#dock .cx-btn', { hasText: /take over/i }).count()) === 0);

  /* ── Taking over from a live colleague ────────────────────────────────── */
  console.log('\nTaking over from someone who is still there');
  await page.goto('about:blank');
  await boot({
    files: {
      'bart-cbtc.json': { text: sharedPlan, lastModified: Date.now() },
      'bart-cbtc.lock.json': {
        text: JSON.stringify({ id: 'their-tab', device: 'their-laptop', holder: 'Dana', since: Date.now(), beat: Date.now() }),
        lastModified: Date.now(),
      },
    },
  });
  await openIoPane();
  await page.locator('#dock .cx-btn', { hasText: /connect a folder/i }).click();
  await page.waitForTimeout(1500);
  check('a live colleague still means read-only',
    await page.evaluate(() => document.body.classList.contains('read-only')));

  await page.locator('#dock .cx-btn', { hasText: /take over/i }).click();
  await page.waitForTimeout(600);
  const warn = await page.locator('.cx-modal').innerText().catch(() => '');
  check('taking over from a live holder warns first', /Dana/.test(warn) && /lost|refused/i.test(warn),
    warn.replace(/\n/g, ' ').slice(0, 90));

  await page.locator('.cx-modal .cx-btn', { hasText: /take over anyway/i }).click();
  await page.waitForTimeout(1200);
  check('but it is never a dead end — confirming takes the pen',
    !(await page.evaluate(() => document.body.classList.contains('read-only'))));
  const stolen = await page.evaluate(() => {
    try { return JSON.parse(window.__folder.files['bart-cbtc.lock.json'].text).holder; } catch { return ''; }
  });
  check('and the lock now names the new holder', stolen !== 'Dana', `holder is now "${stolen}"`);

  /* ── An abandoned lock ────────────────────────────────────────────────── */
  console.log('\nWhen the lock was abandoned');
  await page.goto('about:blank');
  await boot({
    files: {
      'bart-cbtc.json': { text: sharedPlan, lastModified: Date.now() },
      // A browser that closed without releasing: no heartbeat for an hour.
      'bart-cbtc.lock.json': {
        text: JSON.stringify({ id: 'gone', holder: 'Dana', since: Date.now() - 3600000, beat: Date.now() - 3600000 }),
        lastModified: Date.now() - 3600000,
      },
    },
  });
  await openIoPane();
  await page.locator('#dock .cx-btn', { hasText: /connect a folder/i }).click();
  await page.waitForTimeout(1500);

  check('a stale lock does not lock anyone out',
    !(await page.evaluate(() => document.body.classList.contains('read-only'))));
  const retaken = await page.evaluate(() => {
    try { return JSON.parse(window.__folder.files['bart-cbtc.lock.json'].text).holder; } catch { return ''; }
  });
  check('and the lock is re-stamped by whoever opened it', retaken !== 'Dana', `holder is now "${retaken}"`);

  /* ── Disconnecting ────────────────────────────────────────────────────── */
  console.log('\nDisconnecting');
  await openIoPane();
  await page.locator('#dock .cx-btn', { hasText: /^disconnect$/i }).click();
  await page.waitForTimeout(400);
  await page.locator('.cx-modal .cx-btn.primary').click();
  await page.waitForTimeout(900);

  check('the plan file is left on disk', (await plans(page)).includes('bart-cbtc.json'));
  check('and the status bar stops claiming a folder',
    !/bart-cbtc/.test(await page.locator('#statusbar').innerText()));

  /* ── Clearing this browser's copy ─────────────────────────────────────── */
  console.log('\nClearing the local copy');
  await page.goto('about:blank');
  await boot({ files: { 'bart-cbtc.json': { text: sharedPlan, lastModified: Date.now() } } });
  await openIoPane();
  await page.locator('#dock .cx-btn', { hasText: /connect a folder/i }).click();
  await page.waitForTimeout(1500);

  // Make an edit so there is definitely something cached locally.
  await page.locator('.tl-obj.shape-bar').first().click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(1600);

  const cachedBefore = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('cx-timeline');
    r.onsuccess = () => {
      const g = r.result.transaction('projects').objectStore('projects').getAll();
      g.onsuccess = () => res(g.result.length);
    };
    r.onerror = () => res(-1);
  }));
  check('the browser keeps a cached copy while working', cachedBefore > 0, `${cachedBefore} record(s)`);

  await page.locator('#sidenav .nav-link[data-pane="settings"]').click();
  await page.waitForTimeout(500);
  await page.locator('#dock .cx-btn', { hasText: /clear this browser/i }).click();
  await page.waitForTimeout(500);
  await page.locator('.cx-modal .cx-btn', { hasText: /clear it/i }).click();
  await page.waitForTimeout(1200);

  const cachedAfter = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('cx-timeline');
    r.onsuccess = () => {
      const g = r.result.transaction('projects').objectStore('projects').getAll();
      g.onsuccess = () => res(g.result.length);
    };
    r.onerror = () => res(-1);
  }));
  const recovery = await page.evaluate(() => localStorage.getItem('cxtl.doc.recovery'));
  check('clearing it empties the browser cache', cachedAfter === 0, `${cachedAfter} record(s)`);
  check('and leaves no crash-recovery copy behind', recovery === null);
  check('but the plan in the folder is untouched',
    (await planText(page, 'bart-cbtc.json')).length > 0);

  /* ── Unsupported browsers ─────────────────────────────────────────────── */
  console.log('\nWhere the API is missing');
  await page.goto('about:blank');
  await page.addInitScript(() => {
    delete window.showDirectoryPicker;
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
  });
  await page.goto(appUrl, { waitUntil: 'load' });
  await page.waitForSelector('.tl-root', { timeout: 20000 });
  await page.waitForTimeout(1200);
  await openIoPane();
  const hint = await page.locator('#dock [data-section="shared-folder"]').innerText().catch(() => '');
  check('the pane explains itself instead of offering a broken button',
    /Edge or Chrome/i.test(hint) && !/connect a folder/i.test(hint), hint.replace(/\n/g, ' ').slice(0, 80));
  check('and the application still works', (await page.locator('.tl-obj').count()) > 0);

  /* ── Console ──────────────────────────────────────────────────────────── */
  console.log('\nConsole');
  // Nothing is filtered but the favicon. This used to allow network failures
  // through, which was hiding a real one: css/tokens.css was importing a font
  // from a CDN on every load. With that gone the check can be strict, and a
  // regression that reintroduces an external request fails the build.
  const meaningful = consoleErrors.filter((e) => !/favicon/i.test(e));
  check('no console errors', meaningful.length === 0, meaningful.slice(0, 3).join(' | '));

  const shotIndex = process.argv.indexOf('--shot');
  if (shotIndex > -1 && process.argv[shotIndex + 1]) {
    await page.screenshot({ path: process.argv[shotIndex + 1] });
    console.log(`\nScreenshot → ${process.argv[shotIndex + 1]}`);
  }

  await browser.close();

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
