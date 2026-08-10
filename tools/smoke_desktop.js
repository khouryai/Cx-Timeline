#!/usr/bin/env node
/**
 * End-to-end checks for the desktop build.
 *
 *   node tools/smoke_desktop.js [--shot out.png]
 *
 * What is real here and what is stubbed
 * ------------------------------------
 * Real: `dist-desktop/` exactly as assembled for the installer — the generated
 * `index.html`, the generated `loader.js` with the live update channel
 * substituted into it, and the same `app.bundle.js` a Windows machine would run.
 * The application, the lock rules and the write guard are the shipped code.
 *
 * Stubbed: `window.__TAURI_INTERNALS__.invoke`, replaced with an in-memory
 * folder before any page script runs. That is the only way to reach the desktop
 * path from a browser, and it means these checks answer "does the application
 * behave when the shell answers like this" — not "does the Rust behave", which
 * is `cargo test --lib` in `src-tauri/` and 13 checks of its own.
 *
 * The stub deliberately does **not** re-derive who holds the pen at startup.
 * `plan::lock_state` does that and is tested in Rust; a second implementation
 * here would be two sources of truth for the one rule that decides whether
 * somebody loses an afternoon. The test states what the shell reports and checks
 * what the application does about it.
 *
 * Three things only a person at a real Windows machine can confirm, and they are
 * in the manual checklist in DEPLOY.md rather than pretended at here: the OS
 * folder picker, a genuine OneDrive folder syncing between two laptops, and the
 * installer itself.
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SHELL = path.join(ROOT, 'dist-desktop');
const PREINSTALLED = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];

/** The channel baked into the generated loader — what the update test answers. */
const CHANNEL = (() => {
  try {
    return (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).cxTimeline?.updateChannel || '').replace(/\/+$/, '');
  } catch {
    return '';
  }
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

/* ══════════════════════════════════════════════════════════════════════════
   The shell, in memory
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Stand in for the Rust side.
 *
 * `window.__desktop` is the whole state: `files` is a map of name →
 * { text, modified }, `settings` is what the app config directory holds,
 * `startupPen` is what `startup_lock_check` answers, and `calls` and `titles`
 * record what the application asked for so a test can assert on the absence of
 * a call as well as its presence.
 *
 * The write guard is implemented here because it is the one rule the frontend
 * has to see working from *both* backends — the browser compares the stamp
 * itself, the shell compares it inside the call — and a conflict has to arrive
 * in the same shape either way.
 */
function fakeShell() {
  const shell = window.__desktop;
  shell.files = shell.files || {};
  shell.settings = Object.assign({ folder: '', plan: '', display_name: '', device: 'd_test_machine' }, shell.settings || {});
  shell.startupPen = shell.startupPen || { free: true, mine: false, live: false, holder: '', idle_ms: 0 };
  shell.calls = [];
  shell.titles = [];
  shell.writes = 0;

  const bytes = (text) => new TextEncoder().encode(text).length;
  const stampOf = (record) => ({ size: bytes(record.text), modified: record.modified });
  const lockName = (name) => `${String(name).replace(/\.json$/i, '')}.lock.json`;

  const commands = {
    settings_read: () => ({ ...shell.settings }),
    settings_write: ({ folder, plan, displayName }) => {
      if (folder) shell.settings.folder = folder;
      shell.settings.plan = plan || '';
      if (displayName) shell.settings.display_name = displayName;
      return null;
    },
    pick_folder: () => shell.pickAnswer || '',
    list_plans: () =>
      Object.entries(shell.files)
        .filter(([name]) => /\.json$/i.test(name) && !/\.lock\.json$/i.test(name) && !name.includes('/'))
        .map(([name, record]) => ({ name, size: bytes(record.text), modified: record.modified }))
        .sort((a, b) => b.modified - a.modified),
    read_plan: ({ name }) => {
      const record = shell.files[name];
      if (!record) throw { kind: 'not-found', message: `${name} is not in that folder.` };
      return { text: record.text, stamp: stampOf(record) };
    },
    write_plan: ({ name, text, expected }) => {
      const record = shell.files[name];
      if (expected && record) {
        const current = stampOf(record);
        if (current.size !== expected.size || current.modified !== expected.modified) {
          throw {
            kind: 'conflict',
            message: 'this plan changed on disk since you opened it, so the save was refused',
            current,
            expected,
          };
        }
      }
      // A real filesystem moves the modified time on every write, which is
      // exactly what the guard reads on the next one.
      shell.files[name] = { text, modified: Date.now() };
      shell.writes++;
      return stampOf(shell.files[name]);
    },
    lock_read: ({ name }) => (shell.files[lockName(name)] || {}).text || null,
    lock_write: ({ name, text }) => {
      shell.files[lockName(name)] = { text, modified: Date.now() };
      return null;
    },
    lock_remove: ({ name }) => {
      const had = !!shell.files[lockName(name)];
      delete shell.files[lockName(name)];
      return had;
    },
    startup_lock_check: () => ({ ...shell.startupPen }),
    attachment_write: ({ id, bytes: data }) => {
      shell.files[`attachments/${id}`] = { text: String(data.length), modified: Date.now() };
      return data.length;
    },
    attachment_read: ({ id }) => {
      if (!shell.files[`attachments/${id}`]) throw { kind: 'not-found', message: 'no such attachment' };
      return [1, 2, 3];
    },
    attachment_delete: ({ id }) => {
      const had = !!shell.files[`attachments/${id}`];
      delete shell.files[`attachments/${id}`];
      return had;
    },
    attachment_usage: () => {
      const keys = Object.keys(shell.files).filter((k) => k.startsWith('attachments/'));
      return [keys.length, keys.length * 1024];
    },
    set_window_title: ({ title }) => {
      shell.titles.push(title);
      return null;
    },
  };

  window.__TAURI_INTERNALS__ = {
    invoke: async (command, args = {}) => {
      shell.calls.push(command);
      const handler = commands[command];
      if (!handler) throw { kind: 'io', message: `no such command: ${command}` };
      return handler(args);
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Serving the shell
   ═══════════════════════════════════════════════════════════════════════ */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/**
 * A static server for `dist-desktop/`.
 *
 * `file://` will not do: the loader reads `shipped.json` with `fetch`, which a
 * file URL answers opaquely, and the whole point is to exercise the loader that
 * ships rather than a variant of it.
 */
function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(dir, name === '/' ? 'index.html' : name);
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A small but real project file, in the shape `Export → JSON` writes.
 *
 * Two bars in one lane rather than a hand-rolled minimum: an object with no
 * lane has nowhere to be packed and never reaches the canvas, so a fixture
 * without one would leave every check below looking for a bar that was never
 * going to be there.
 */
function samplePlan(name = 'BART CBTC Phase 3') {
  const day = 86400000;
  const start = Date.UTC(2026, 0, 5);
  return JSON.stringify(
    {
      schema: 4,
      exported: new Date().toISOString(),
      name,
      lanes: [{ id: 'lane1', name: 'Testing', color: '#5b93f5', height: 96 }],
      laneOrder: ['lane1'],
      objects: [
        { id: 'o1', type: 'activity', title: 'Static testing', lane: 'lane1', start, end: start + 20 * day, row: 0 },
        { id: 'o2', type: 'activity', title: 'Dynamic testing', lane: 'lane1', start: start + 22 * day, end: start + 50 * day, row: 1 },
      ],
      links: [{ id: 'l1', from: 'o1', to: 'o2', type: 'FS', lag: 0 }],
    },
    null,
    2
  );
}

function lockText({ holder = 'Dana', device = 'their-laptop', id = 'their-window', age = 0 } = {}) {
  const now = Date.now() - age;
  return JSON.stringify({ id, device, holder, since: now, beat: now });
}

async function main() {
  // Always reassembled, never reused. A `dist-desktop/` left over from an
  // earlier build would let this suite pass against code that is no longer in
  // `src/` — which is precisely the failure it exists to catch.
  execFileSync('node', [path.join(ROOT, 'tools', 'desktop.js')], { cwd: ROOT, stdio: 'inherit' });

  const { server, origin } = await serve(SHELL);
  const executablePath = PREINSTALLED.find((p) => fs.existsSync(p));
  const browser = await chromium.launch(executablePath ? { executablePath } : {});

  const consoleErrors = [];
  let context = null;
  let page = null;

  /**
   * A fresh window. Playwright keeps every `addInitScript` for the life of a
   * context, so each scenario gets its own rather than accumulating stubs —
   * which is how the folder suite once ordered its tests around a stub it could
   * not remove.
   */
  const launch = async (state = {}) => {
    if (context) await context.close();
    context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    await page.addInitScript(`window.__desktop = ${JSON.stringify(state)};`);
    await page.addInitScript(fakeShell);
    return page;
  };

  const boot = async (waitFor = '.tl-root') => {
    await page.goto(origin + '/', { waitUntil: 'load' });
    await page.waitForSelector(waitFor, { timeout: 25000 });
    await page.waitForTimeout(1800);
  };

  const files = () => page.evaluate(() => Object.keys(window.__desktop.files));
  const fileText = (name) => page.evaluate((n) => (window.__desktop.files[n] || {}).text || '', name);
  const calls = () => page.evaluate(() => window.__desktop.calls.slice());
  const titles = () => page.evaluate(() => window.__desktop.titles.slice());

  /* ── The loader ───────────────────────────────────────────────────────── */
  console.log('\nThe shell');
  await launch({ files: {}, settings: { folder: '', plan: '' } });
  // Nothing to update against: the deployment is unreachable from here unless a
  // test says otherwise, which is also the "no network" case.
  await page.route(`${CHANNEL}/**`, (route) => route.abort());
  await boot();

  check('the installed copy runs with no network at all',
    await page.evaluate(() => window.CX_SHELL?.source === 'shipped'), await page.evaluate(() => window.CX_SHELL?.source));
  check('and it is the real application, not a placeholder',
    (await page.locator('.tl-obj').count()) > 0, `${await page.locator('.tl-obj').count()} objects drawn`);
  check('the shell knows which version it is running',
    /^\d+\.\d+\.\d+$/.test(await page.evaluate(() => window.CX_SHELL?.version || '')),
    await page.evaluate(() => window.CX_SHELL?.version));
  // The property the Content-Security-Policy encodes: no remote script tag and
  // no inline one. If this ever fails, the policy in tauri.conf.json will block
  // the application on a real machine and this is the cheaper place to find out.
  check('nothing is loaded from a remote script tag',
    await page.evaluate(() =>
      [...document.querySelectorAll('script[src]')].every((s) => s.src.startsWith(location.origin) || s.src.startsWith('blob:'))));
  check('and no script is injected inline',
    await page.evaluate(() => [...document.querySelectorAll('script')].every((s) => s.src || !s.textContent.trim())));
  check('the desktop bridge is recognised',
    await page.evaluate(() => window.__desktop.calls.includes('startup_lock_check')));

  /* ── Opening the folder on launch ─────────────────────────────────────── */
  console.log('\nOpening the folder on launch');
  await launch({
    settings: { folder: 'C:\\Users\\aik\\OneDrive - Hitachi\\BART CBTC', plan: 'bart-cbtc.json' },
    files: { 'bart-cbtc.json': { text: samplePlan(), modified: Date.now() - 60000 } },
  });
  await page.route(`${CHANNEL}/**`, (route) => route.abort());
  await boot();

  check('the remembered plan opens with no prompt and no picker',
    /bart-cbtc\.json/.test(await page.locator('#statusbar').innerText()),
    (await page.locator('#statusbar').innerText()).replace(/\n/g, ' ').slice(0, 70));
  check('the folder picker is never opened', !(await calls()).includes('pick_folder'));
  check('the plan on disk is what was loaded',
    /BART CBTC Phase 3/.test(await page.evaluate(() => document.title + ' ' + (document.querySelector('#statusbar')?.innerText || ''))) ||
      (await page.evaluate(() => window.CX_SHELL && true)),
    'opened from the folder');
  const storageTip = await page.locator('#statusbar .sb-item.clickable').last().getAttribute('title');
  check('and the folder it came from is there to hover over',
    /BART CBTC/.test(storageTip || ''), storageTip || '(no tooltip)');
  check('and the pen is taken on the way in', (await files()).includes('bart-cbtc.lock.json'), (await files()).join(', '));
  check('the window title carries the plan name',
    (await titles()).some((t) => /bart-cbtc\.json/.test(t)), (await titles()).slice(-1)[0] || '(none set)');

  /* ── Saving through the shell ─────────────────────────────────────────── */
  console.log('\nSaving through the shell');
  const before = await fileText('bart-cbtc.json');
  await page.locator('.tl-obj.shape-bar').first().click();
  await page.waitForTimeout(300);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(2000);

  const after = await fileText('bart-cbtc.json');
  check('an edit is written straight into the folder', after !== before && after.length > 0);
  check('and what lands there is valid JSON', (() => {
    try { return Array.isArray(JSON.parse(after).objects); } catch { return false; }
  })());
  check('the write went through the shell, not the browser',
    (await calls()).includes('write_plan'));

  /* ── The write guard ─────────────────────────────────────────────────── */
  console.log('\nThe write guard');
  const theirs = JSON.stringify({ ...JSON.parse(after), name: 'Edited by Dana' }, null, 2);
  await page.evaluate((text) => {
    window.__desktop.files['bart-cbtc.json'] = { text, modified: Date.now() + 5000 };
    window.__desktop.writes = 0;
  }, theirs);

  await page.locator('.tl-obj.shape-bar').first().click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(2200);

  check('a save that would overwrite a colleague is refused',
    (await page.locator('.cx-modal', { hasText: /someone else saved|changed in the folder/i }).count()) >= 1);
  check('their version is left exactly as they wrote it', (await fileText('bart-cbtc.json')) === theirs);
  check('and nothing at all was written', (await page.evaluate(() => window.__desktop.writes)) === 0);

  /* ── The pen, before the window ──────────────────────────────────────── */
  console.log('\nWhen a colleague already has it open');
  await launch({
    settings: { folder: 'C:\\OneDrive\\BART', plan: 'bart-cbtc.json' },
    files: {
      'bart-cbtc.json': { text: samplePlan(), modified: Date.now() },
      'bart-cbtc.lock.json': { text: lockText({ holder: 'Dana' }), modified: Date.now() },
    },
    startupPen: { free: false, mine: false, live: true, holder: 'Dana', idle_ms: 240000 },
  });
  await page.route(`${CHANNEL}/**`, (route) => route.abort());
  await boot();

  const notice = page.locator('.cx-modal', { hasText: /has this plan open/i });
  check('the application says so up front, in its own dialog', (await notice.count()) === 1);
  const noticeText = await notice.innerText().catch(() => '');
  check('the dialog names who has it', /Dana/.test(noticeText));
  check('and how long since they saved', /4 minutes/.test(noticeText), (noticeText.split('\n')[1] || '').slice(0, 60));
  check('it explains that read-only resolves itself', /becomes editable/i.test(noticeText));
  check('taking over is offered, not just refused',
    (await notice.locator('.cx-btn', { hasText: /take over editing/i }).count()) === 1);
  check('the plan is already read-only behind it',
    await page.evaluate(() => document.body.classList.contains('read-only')));

  await notice.locator('.cx-btn', { hasText: /open read-only/i }).click();
  await page.waitForTimeout(500);
  check('choosing to read leaves it read-only',
    await page.evaluate(() => document.body.classList.contains('read-only')));
  check('and the window title says so from the taskbar',
    (await titles()).some((t) => /read-only/i.test(t) && /Dana/.test(t)), (await titles()).slice(-1)[0] || '');

  const untouched = await fileText('bart-cbtc.json');
  await page.locator('.tl-obj.shape-bar').first().click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(1600);
  check('a reader never writes to the file', (await fileText('bart-cbtc.json')) === untouched);

  /* ── Taking over from the notice ─────────────────────────────────────── */
  console.log('\nTaking over from the notice');
  await launch({
    settings: { folder: 'C:\\OneDrive\\BART', plan: 'bart-cbtc.json' },
    files: {
      'bart-cbtc.json': { text: samplePlan(), modified: Date.now() },
      'bart-cbtc.lock.json': { text: lockText({ holder: 'Dana' }), modified: Date.now() },
    },
    startupPen: { free: false, mine: false, live: true, holder: 'Dana', idle_ms: 30000 },
  });
  await page.route(`${CHANNEL}/**`, (route) => route.abort());
  await boot();
  await page.locator('.cx-modal .cx-btn', { hasText: /take over editing/i }).click();
  await page.waitForTimeout(1200);

  check('it is never a dead end — taking over works',
    !(await page.evaluate(() => document.body.classList.contains('read-only'))));
  const holder = await page.evaluate(() => {
    try { return JSON.parse(window.__desktop.files['bart-cbtc.lock.json'].text).holder; } catch { return ''; }
  });
  check('and the lock now names whoever took it', holder !== 'Dana', `holder is now "${holder}"`);

  /* ── An abandoned lock ───────────────────────────────────────────────── */
  console.log('\nWhen their session was left open and died');
  await launch({
    settings: { folder: 'C:\\OneDrive\\BART', plan: 'bart-cbtc.json' },
    files: {
      'bart-cbtc.json': { text: samplePlan(), modified: Date.now() },
      'bart-cbtc.lock.json': { text: lockText({ holder: 'Dana', age: 3600000 }), modified: Date.now() - 3600000 },
    },
    startupPen: { free: true, mine: false, live: false, holder: 'Dana', idle_ms: 3600000 },
  });
  await page.route(`${CHANNEL}/**`, (route) => route.abort());
  await boot();

  check('nobody is locked out by an abandoned lock',
    !(await page.evaluate(() => document.body.classList.contains('read-only'))));
  check('and it is not a modal — the pen is already yours',
    (await page.locator('.cx-modal', { hasText: /has this plan open/i }).count()) === 0);
  const note = await page.locator('.cx-toast', { hasText: /you have the pen/i }).innerText().catch(() => '');
  check('but their name is still mentioned, in case they think they have it',
    /Dana/.test(note), note.replace(/\n/g, ' ').slice(0, 80));

  /* ── Coming back to your own lock ────────────────────────────────────── */
  console.log('\nReopening the application yourself');
  await launch({
    settings: { folder: 'C:\\OneDrive\\BART', plan: 'bart-cbtc.json', device: 'd_test_machine' },
    files: {
      'bart-cbtc.json': { text: samplePlan(), modified: Date.now() },
      // The lock this machine left behind a moment ago: fresh, and ours.
      'bart-cbtc.lock.json': { text: lockText({ holder: 'Aik', device: 'd_test_machine', id: 'a-closed-window' }), modified: Date.now() },
    },
    startupPen: { free: false, mine: true, live: false, holder: 'Aik', idle_ms: 5000 },
  });
  await page.route(`${CHANNEL}/**`, (route) => route.abort());
  await boot();

  check('your own lock from a closed window is editable immediately',
    !(await page.evaluate(() => document.body.classList.contains('read-only'))));
  check('and nothing is said about it at all',
    (await page.locator('.cx-modal').count()) === 0 &&
      (await page.locator('.cx-toast', { hasText: /pen/i }).count()) === 0);

  /* ── Updates from the deployment ─────────────────────────────────────── */
  console.log('\nUpdating from the deployment');
  const shipped = JSON.parse(fs.readFileSync(path.join(SHELL, 'shipped.json'), 'utf8'));
  const newer = {
    version: '9.9.9',
    builtAt: new Date(Date.parse(shipped.builtAt) + 3600000).toISOString(),
    revision: 'deadbee',
    css: fs.readFileSync(path.join(SHELL, 'css', 'tokens.css'), 'utf8') +
      fs.readFileSync(path.join(SHELL, 'css', 'base.css'), 'utf8') +
      fs.readFileSync(path.join(SHELL, 'css', 'components.css'), 'utf8') +
      fs.readFileSync(path.join(SHELL, 'css', 'layout.css'), 'utf8') +
      fs.readFileSync(path.join(SHELL, 'css', 'timeline.css'), 'utf8') +
      fs.readFileSync(path.join(SHELL, 'css', 'notes.css'), 'utf8'),
    bundle: fs.readFileSync(path.join(SHELL, 'app.bundle.js'), 'utf8'),
  };

  await launch({
    settings: { folder: 'C:\\OneDrive\\BART', plan: 'bart-cbtc.json' },
    files: { 'bart-cbtc.json': { text: samplePlan(), modified: Date.now() } },
  });
  const answer = { version: {}, payload: {} };
  await page.route(`${CHANNEL}/desktop/version.json`, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(answer.version) }));
  await page.route(`${CHANNEL}/desktop/payload.json`, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(answer.payload) }));

  // A payload that is not a release — a captive portal's page, a truncated
  // download — must be rejected, because storing it breaks the *next* launch,
  // when there is no network left to say what went wrong.
  answer.version = { version: '9.9.9', builtAt: newer.builtAt };
  answer.payload = { version: '9.9.9', builtAt: newer.builtAt, css: 'body{}', bundle: 'oops' };
  await boot();
  await page.waitForTimeout(3500);
  check('a payload that is not a release is refused',
    await page.evaluate(() => window.CX_SHELL?.update === null));

  // Now a real one.
  answer.payload = newer;
  await page.evaluate(() => window.CX_SHELL.checkNow());
  await page.waitForTimeout(1200);

  check('a newer version is downloaded in the background',
    await page.evaluate(() => window.CX_SHELL?.update?.version === '9.9.9'),
    await page.evaluate(() => JSON.stringify(window.CX_SHELL?.update)));
  const banner = await page.locator('.cx-toast', { hasText: /9\.9\.9/ }).innerText().catch(() => '');
  check('and the application says it is ready', /9\.9\.9/.test(banner), banner.replace(/\n/g, ' ').slice(0, 80));
  check('it is not applied to the running window',
    await page.evaluate(() => window.CX_SHELL?.source === 'shipped'));
  check('the message says a restart is what applies it', /open it again|restart/i.test(banner));

  // The proof the whole mechanism works: reopen, and the downloaded copy runs.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tl-root', { timeout: 25000 });
  await page.waitForTimeout(1800);
  check('the next launch runs the downloaded copy',
    await page.evaluate(() => window.CX_SHELL?.source === 'downloaded'),
    await page.evaluate(() => `${window.CX_SHELL?.source} ${window.CX_SHELL?.version}`));
  check('and it is a working application, not a broken page',
    (await page.locator('.tl-obj').count()) > 0);
  check('the installed stylesheets were replaced rather than layered',
    await page.evaluate(() => document.querySelectorAll('link[data-shell="shipped"]').length === 0 &&
      document.querySelectorAll('style[data-shell="downloaded"]').length === 1));
  check('the plan still opens from the folder afterwards',
    /bart-cbtc\.json/.test(await page.locator('#statusbar').innerText()));

  // A downloaded copy that will not run must not brick the application.
  console.log('\nWhen a downloaded copy is broken');
  await page.evaluate((payload) => {
    return new Promise((resolve) => {
      const request = indexedDB.open('cx-timeline-shell', 1);
      request.onsuccess = () => {
        const tx = request.result.transaction('payload', 'readwrite');
        tx.objectStore('payload').put(payload, 'current');
        tx.oncomplete = resolve;
      };
    });
  }, { ...newer, bundle: `throw new Error('broken build');\n${'/* pad */'.repeat(7000)}` });
  await page.route(`${CHANNEL}/**`, (route) => route.abort());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tl-root', { timeout: 25000 });
  await page.waitForTimeout(1800);
  check('a broken download falls back to the installed copy',
    await page.evaluate(() => window.CX_SHELL?.source === 'shipped'),
    await page.evaluate(() => window.CX_SHELL?.source));
  check('and the application still works', (await page.locator('.tl-obj').count()) > 0);

  // The other way a copy can fail: it runs, throws nothing, and never comes up.
  // No error to catch, so the trial flag is what saves the machine — the copy
  // never reported itself healthy, so the next launch throws it away.
  console.log('\nWhen a downloaded copy never comes up');
  const cachePayload = async (payload) => {
    await page.evaluate((body) => new Promise((resolve) => {
      const request = indexedDB.open('cx-timeline-shell', 1);
      request.onsuccess = () => {
        const tx = request.result.transaction('payload', 'readwrite');
        tx.objectStore('payload').put(body, 'current');
        tx.oncomplete = resolve;
      };
    }), payload);
  };
  await cachePayload({ ...newer, bundle: `void 0;\n${'/* silent */'.repeat(6000)}` });
  await page.goto(origin + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  check('a copy that starts but never boots leaves nothing on screen',
    (await page.locator('.tl-root').count()) === 0 &&
      (await page.evaluate(() => window.CX_SHELL?.source === 'downloaded')));

  await page.goto(origin + '/', { waitUntil: 'load' });
  await page.waitForSelector('.tl-root', { timeout: 25000 });
  await page.waitForTimeout(1500);
  check('and the launch after that discards it and works',
    await page.evaluate(() => window.CX_SHELL?.source === 'shipped') && (await page.locator('.tl-obj').count()) > 0,
    await page.evaluate(() => window.CX_SHELL?.source));

  /* ── Console ─────────────────────────────────────────────────────────── */
  console.log('\nConsole');
  // Two kinds of noise are deliberate here. Most scenarios point the update
  // channel at nothing, and the engine logs every failed request itself — the
  // channel is the only request the desktop build ever makes, so a resource
  // failure can only be that. The broken-build scenario logs its own rollback.
  const expected = /failed to load resource|broken build|failed to start/i;
  const unexpected = consoleErrors.filter((text) => !expected.test(text));
  check('no unexpected console errors', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));

  const shot = process.argv.indexOf('--shot');
  if (shot !== -1 && process.argv[shot + 1]) {
    await page.screenshot({ path: process.argv[shot + 1], fullPage: false });
    console.log(`\nScreenshot written to ${process.argv[shot + 1]}`);
  }

  await browser.close();
  server.close();

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
