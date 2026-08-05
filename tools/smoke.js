#!/usr/bin/env node
/**
 * Headless smoke test.
 *
 * Boots the real application in Chromium and exercises the paths that would
 * leave the app visibly broken if they regressed: the canvas renders, objects
 * appear, the inspector responds to selection, undo/redo work, every dock
 * pane opens without throwing, the theme switches, and each exporter produces
 * output. Any console error fails the run.
 *
 * Usage:  node tools/smoke.js [--shot out.png] [--keep]
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const PORT = 8231;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const requested = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = path.join(ROOT, requested === '/' ? 'index.html' : requested.replace(/^\/+/, ''));
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404).end('nf');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const server = await serve();
  // The pre-installed browser may not match this Playwright build's expected
  // revision, so point at it explicitly when it is present.
  const preinstalled = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
  const browser = await chromium.launch(preinstalled ? { executablePath: preinstalled } : {});
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  console.log('\nBoot');
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('.tl-root', { timeout: 15000 });
  await page.waitForTimeout(1400);

  check('splash cleared', (await page.locator('#boot').count()) === 0);
  check('sidebar rendered', (await page.locator('#sidenav .nav-link').count()) > 8);
  check('toolbar rendered', (await page.locator('#toolbar .cx-btn').count()) > 10);
  check('lane gutter rendered', (await page.locator('.tl-lane-label').count()) >= 5);

  const objectCount = await page.locator('.tl-obj').count();
  check('objects rendered', objectCount > 8, `${objectCount} nodes`);

  check('ruler ticks rendered', (await page.locator('.tl-tick').count()) > 5);
  check('today marker present', (await page.locator('.tl-today').count()) === 1);
  check('connectors drawn', (await page.locator('.tl-connectors path.tl-link').count()) > 0);
  check('minimap rendered', (await page.locator('.tl-minimap .tl-mini-obj').count()) > 5);
  check('legend rendered', (await page.locator('.tl-legend-item').count()) > 3);
  check('status bar populated', (await page.locator('#statusbar .sb-item').first().innerText()).length > 0);

  console.log('\nSelection & inspector');
  // Pick a plain activity bar by name: point markers and full-lane bands
  // legitimately overlap each other, so "the first object" is not a stable
  // click target.
  const target = page.locator('.tl-obj.shape-bar').filter({ hasText: 'Wayside Equipment Installation' }).first();
  await target.click();
  await page.waitForTimeout(250);
  check('object selected', (await page.locator('.tl-obj.selected').count()) === 1);
  check('inspector shows object', (await page.locator('#inspector .ih-name').innerText()).length > 0);
  check('inspector sections built', (await page.locator('#inspector .cx-section').count()) >= 6);

  console.log('\nEditing & history');
  const before = await page.evaluate(() => document.querySelectorAll('.tl-obj').length);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(350);
  const afterDuplicate = await page.evaluate(() => document.querySelectorAll('.tl-obj').length);
  check('duplicate adds an object', afterDuplicate > before, `${before} → ${afterDuplicate}`);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(350);
  const afterUndo = await page.evaluate(() => document.querySelectorAll('.tl-obj').length);
  check('undo removes it again', afterUndo === before, `${afterUndo}`);

  await page.keyboard.press('Control+y');
  await page.waitForTimeout(350);
  check('redo restores it', (await page.evaluate(() => document.querySelectorAll('.tl-obj').length)) === afterDuplicate);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);

  console.log('\nViewport');
  const zoomBefore = await page.evaluate(() => document.querySelectorAll('.tl-tick').length);
  await page.mouse.move(900, 500);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(320);
  check('wheel zoom changes the ruler', (await page.evaluate(() => document.querySelectorAll('.tl-tick').length)) !== zoomBefore);

  await page.keyboard.press('Control+0');
  await page.waitForTimeout(320);
  check('fit-all keeps objects on screen', (await page.locator('.tl-obj').count()) > 8);

  console.log('\nDock panes');
  const panes = ['lanes', 'palette', 'outline', 'releases', 'campaigns', 'risks', 'links', 'baselines', 'search', 'filters', 'legend', 'history', 'io', 'backups', 'settings'];
  for (const pane of panes) {
    const errorsBefore = consoleErrors.length;
    await page.locator(`#sidenav .nav-link[data-pane="${pane}"]`).click();
    await page.waitForTimeout(220);
    const content = await page.locator('#dock .pane-scroll').innerHTML();
    check(`pane "${pane}" renders`, content.length > 40 && consoleErrors.length === errorsBefore);
  }

  console.log('\nThemes');
  for (const theme of ['light', 'engineering', 'blueprint', 'presentation', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(120);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(`theme "${theme}" applies`, bg && bg !== 'rgba(0, 0, 0, 0)');
  }

  console.log('\nExporters');
  await page.locator('#sidenav .nav-link[data-pane="io"]').click();
  await page.waitForTimeout(300);

  // Downloads are suppressed by stubbing the anchor click, so the pane must
  // already be open before the stub goes in — otherwise it swallows the
  // navigation click too.
  const exportChecks = await page.evaluate(async () => {
    const out = {};
    const captured = [];
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      captured.push({ size: blob.size, type: blob.type });
      return originalCreate.call(URL, blob);
    };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};

    try {
      const buttons = Array.from(document.querySelectorAll('#dock .pane-scroll button'));
      const byLabel = (text) => buttons.find((b) => b.textContent.trim().toLowerCase().includes(text));

      for (const [key, label] of [['svg', 'svg (vector)'], ['png', 'png (raster)'], ['csv', 'csv (objects)'], ['json', 'json (full project)']]) {
        const before = captured.length;
        const button = byLabel(label);
        if (!button) {
          out[key] = 'button not found';
          continue;
        }
        button.click();
        await new Promise((r) => setTimeout(r, key === 'png' ? 1600 : 500));
        out[key] = captured.length > before ? captured[captured.length - 1].size : 0;
      }
    } finally {
      URL.createObjectURL = originalCreate;
      HTMLAnchorElement.prototype.click = originalClick;
    }
    return out;
  });

  check('SVG export produces bytes', Number(exportChecks.svg) > 2000, String(exportChecks.svg));
  check('PNG export produces bytes', Number(exportChecks.png) > 2000, String(exportChecks.png));
  check('CSV export produces bytes', Number(exportChecks.csv) > 200, String(exportChecks.csv));
  check('JSON export produces bytes', Number(exportChecks.json) > 1000, String(exportChecks.json));

  console.log('\nPDF');
  const pdfSize = await page.evaluate(async () => {
    const captured = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      captured.push(blob);
      return original.call(URL, blob);
    };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    try {
      const open = Array.from(document.querySelectorAll('#dock .pane-scroll button')).find((b) => b.textContent.includes('PDF (vector'));
      if (!open) return 'dialog button not found';
      open.click();
      await new Promise((r) => setTimeout(r, 400));
      const confirm = Array.from(document.querySelectorAll('.cx-modal-foot button')).find((b) => b.textContent.includes('Export PDF'));
      if (!confirm) return 'confirm button not found';
      confirm.click();
      await new Promise((r) => setTimeout(r, 1200));
      const pdf = captured.find((b) => b.type === 'application/pdf');
      if (!pdf) return 0;
      const header = new TextDecoder().decode(await pdf.slice(0, 8).arrayBuffer());
      return header.startsWith('%PDF-1.4') ? pdf.size : -1;
    } finally {
      URL.createObjectURL = original;
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });
  check('PDF export produces a valid file', Number(pdfSize) > 3000, `${pdfSize} bytes`);

  console.log('\nPersistence');
  await page.evaluate(() => document.querySelectorAll('.cx-modal-overlay').forEach((n) => n.remove()));
  await page.locator('.tl-obj.shape-bar').filter({ hasText: 'Wayside Equipment Installation' }).first().click();
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1200);

  const titleBefore = await page.evaluate(() => document.querySelector('#toolbar .tt-name').textContent);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.tl-root', { timeout: 15000 });
  await page.waitForTimeout(1400);
  check('project reloads from storage', (await page.evaluate(() => document.querySelector('#toolbar .tt-name').textContent)) === titleBefore);
  check('objects present after reload', (await page.locator('.tl-obj').count()) > 8);

  console.log('\nConsole');
  const meaningful = consoleErrors.filter((e) => !/favicon|fonts\.googleapis|net::ERR/i.test(e));
  check('no console errors', meaningful.length === 0, meaningful.slice(0, 4).join(' | '));

  const shotIndex = process.argv.indexOf('--shot');
  if (shotIndex > -1 && process.argv[shotIndex + 1]) {
    await page.screenshot({ path: process.argv[shotIndex + 1], fullPage: false });
    console.log(`\nScreenshot → ${process.argv[shotIndex + 1]}`);
  }

  await browser.close();
  server.close();

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  if (failures) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  ✗ ${r.name} ${r.detail}`);
  }
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
