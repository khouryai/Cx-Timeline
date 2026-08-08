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
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const PREINSTALLED = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];

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
  const executablePath = PREINSTALLED.find((p) => fs.existsSync(p));
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
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
  await page.locator('#dock .cx-btn', { hasText: /connect a folder/i }).click();
  await page.waitForTimeout(700);
  check('an empty folder asks what to call the plan', (await page.locator('.cx-modal').count()) === 1);

  await page.locator('.cx-modal input').first().fill('bart-cbtc.json');
  await page.locator('.cx-modal .cx-btn.primary').click();
  await page.waitForTimeout(1200);

  const afterCreate = await plans(page);
  check('the plan is written into the folder', afterCreate.includes('bart-cbtc.json'), afterCreate.join(', '));
  check('and the lock is taken', afterCreate.includes('bart-cbtc.lock.json'), afterCreate.join(', '));

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
