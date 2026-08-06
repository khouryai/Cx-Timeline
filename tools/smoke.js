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
  check(
    'sample plan opens with every dependency satisfied',
    (await page.locator('.tl-connectors g[data-violated]').count()) === 0 &&
      (await page.locator('.tl-obj.violated').count()) === 0
  );

  console.log('\nSelection & inspector');
  // Pick a plain activity bar by name: point markers and full-lane bands
  // legitimately overlap each other, so "the first object" is not a stable
  // click target.
  const target = page.locator('.tl-obj.shape-bar[data-label="Wayside Equipment Installation"]').first();
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

  console.log('\nTyping in panels');
  // Regression: every keystroke writes to the store, which used to rebuild the
  // panel and throw focus out of the input after a single character.
  // Re-select the bar: the undo above pruned the selection, so the inspector
  // would otherwise be showing the project rather than an object.
  await page.locator('.tl-obj.shape-bar[data-label="Wayside Equipment Installation"]').first().click();
  await page.waitForTimeout(250);

  const titleBox = page.locator('#inspector .cx-section input[type="text"]').first();
  await titleBox.click();
  await titleBox.fill('');
  await page.keyboard.type('Wayside Retrofit Alpha', { delay: 18 });
  await page.waitForTimeout(400);
  check('inspector keeps focus while typing', await titleBox.evaluate((n) => n === document.activeElement));
  check('whole string reached the field', (await titleBox.inputValue()) === 'Wayside Retrofit Alpha', await titleBox.inputValue());
  check('edit reached the timeline', (await page.locator('.tl-obj[data-label^="Wayside Retrofit Alpha"]').count()) === 1);

  // The subtitle field is the second text box, and drives the two-line label.
  const subtitleInput = page.locator('#inspector input[placeholder="Optional second line"]').first();
  await subtitleInput.click();
  await subtitleInput.fill('');
  await page.keyboard.type('Fleet A · depot works', { delay: 18 });
  await page.waitForTimeout(400);
  check('subtitle field keeps focus too', await subtitleInput.evaluate((n) => n === document.activeElement));
  check('subtitle text intact', (await subtitleInput.inputValue()) === 'Fleet A · depot works', await subtitleInput.inputValue());

  // Blur, then confirm the deferred rebuild ran and the canvas shows it.
  await page.locator('#canvas-frame').click({ position: { x: 40, y: 300 } });
  await page.waitForTimeout(400);
  check('subtitle rendered on the timeline cell', (await page.locator('.tl-obj .ob-sub').count()) > 0);
  check(
    'subtitle text visible in the cell',
    (await page.locator('.tl-obj .ob-sub').first().innerText()).includes('Fleet A')
  );

  // Dock panes hold the same guarantee (filter text box).
  await page.locator('#sidenav .nav-link[data-pane="filters"]').click();
  await page.waitForTimeout(250);
  const filterInput = page.locator('#dock input[type="text"]').first();
  await filterInput.click();
  await page.keyboard.type('regression', { delay: 18 });
  await page.waitForTimeout(400);
  check('filter box keeps focus while typing', await filterInput.evaluate((n) => n === document.activeElement));
  check('filter text intact', (await filterInput.inputValue()) === 'regression', await filterInput.inputValue());
  await filterInput.fill('');
  await page.waitForTimeout(300);

  console.log('\nSnapping');
  const readObject = (title) => page.evaluate((t) => new Promise((res) => {
    const r = indexedDB.open('cx-timeline');
    r.onsuccess = () => {
      const g = r.result.transaction('projects').objectStore('projects').getAll();
      g.onsuccess = () => {
        const rec = g.result.sort((a, b) => b.savedAt - a.savedAt)[0];
        const o = rec.doc.objects.find((x) => x.title.includes(t));
        res(o ? { start: o.start, end: o.end, snap: rec.doc.settings.snap } : null);
      };
    };
  }), title);

  await page.locator('.tl-obj[data-label^="Wayside Retrofit Alpha"]').first().click();
  await page.waitForTimeout(250);

  // Week snapping: an arrow key must step a whole week and land on a Monday.
  // Re-click the bar after using the dropdown — shortcuts deliberately stand
  // down while a form control holds focus.
  await page.selectOption('#toolbar select', 'week');
  await page.waitForTimeout(250);
  await page.locator('.tl-obj[data-label^="Wayside Retrofit Alpha"]').first().click();
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900);
  let snapped = await readObject('Wayside Retrofit Alpha');
  check('snap setting persisted', snapped && snapped.snap === 'week', snapped?.snap);
  check(
    'week snap lands the nudge on a Monday',
    snapped && new Date(snapped.start).getUTCDay() === 1,
    snapped ? new Date(snapped.start).toISOString().slice(0, 10) : 'no object'
  );

  // Month snapping: the nudge must land on the first of a month.
  await page.selectOption('#toolbar select', 'month');
  await page.waitForTimeout(250);
  await page.locator('.tl-obj[data-label^="Wayside Retrofit Alpha"]').first().click();
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900);
  snapped = await readObject('Wayside Retrofit Alpha');
  check(
    'month snap lands the nudge on the 1st',
    snapped && new Date(snapped.start).getUTCDate() === 1,
    snapped ? new Date(snapped.start).toISOString().slice(0, 10) : 'no object'
  );

  // Changing the snap unit must not be undoable — Ctrl+Z should move the bar
  // back, not silently reset the dropdown.
  const beforeUndo = (await readObject('Wayside Retrofit Alpha')).start;
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  const undoneObject = await readObject('Wayside Retrofit Alpha');
  check('snap unit survives undo', (await page.inputValue('#toolbar select')) === 'month');
  check('undo moved the bar, not the setting', undoneObject.start !== beforeUndo);

  await page.selectOption('#toolbar select', 'day');
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

  console.log('\nRuler labels');
  // Regression: a tick starting off the left edge had its label nudged back
  // into view until it printed on top of the next tick's label.
  const overlapAudit = async (label) => {
    const overlaps = await page.evaluate(() => {
      const found = [];
      for (const band of document.querySelectorAll('.tl-band')) {
        const boxes = [...band.querySelectorAll('.tl-tick span')]
          .filter((n) => n.textContent.trim())
          .map((n) => ({ text: n.textContent.trim(), r: n.getBoundingClientRect() }))
          .filter((b) => b.r.width > 0)
          .sort((a, b) => a.r.left - b.r.left);

        for (let i = 1; i < boxes.length; i++) {
          // 0.5px of tolerance for sub-pixel layout rounding.
          if (boxes[i].r.left < boxes[i - 1].r.right - 0.5) {
            found.push(`"${boxes[i - 1].text}" / "${boxes[i].text}"`);
          }
        }
      }
      return found;
    });
    check(`ruler labels never overlap (${label})`, overlaps.length === 0, overlaps.slice(0, 3).join(' · '));
  };

  for (const [key, name] of [['D', 'day'], ['W', 'week'], ['M', 'month'], ['Q', 'quarter'], ['Y', 'year']]) {
    await page.locator('#toolbar .cx-seg button', { hasText: new RegExp(`^${key}$`) }).first().click();
    await page.waitForTimeout(350);
    await overlapAudit(name);
    // Pan by fractions of a tick so a partly off-screen leading tick is the
    // case under test, not an accident of alignment.
    for (const dx of [37, 61, 89]) {
      await page.mouse.move(900, 400);
      await page.keyboard.down('Shift');
      await page.mouse.wheel(dx, 0);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(220);
      await overlapAudit(`${name}, panned ${dx}`);
    }
  }

  console.log('\nDate format');
  const dateSamples = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('.tl-tick .tk-sub')].map((n) => n.textContent.trim());
    return { subs: texts.filter(Boolean).slice(0, 4) };
  });
  check(
    'ruler sub-labels use M/D/Y',
    dateSamples.subs.every((t) => /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(t)),
    dateSamples.subs.join(', ') || '(none at this scale)'
  );

  const formatted = await page.evaluate(() => {
    const status = document.querySelector('#statusbar .sb-item:last-child')?.textContent || '';
    const saved = [...document.querySelectorAll('#statusbar .sb-item')].map((n) => n.textContent).join(' | ');
    return { status, saved };
  });
  check('autosave stamp reads month-first', /[A-Z][a-z]{2} \d{1,2}, \d{4}/.test(formatted.saved), formatted.saved.slice(0, 60));

  console.log('\nNo truncated text');
  // The hard guarantee: at every scale, no label is clipped, ellipsised or
  // hidden. Measured by comparing each label's laid-out width against its
  // content width, which is what the browser does before it truncates.
  const truncationAudit = async (label) => {
    const bad = await page.evaluate(() => {
      const offenders = [];
      const nodes = document.querySelectorAll(
        '.tl-obj .ob-line, .tl-obj .ob-pct, .tl-tick span, .tl-lane-label .ll-name, .tl-today-flag'
      );
      for (const n of nodes) {
        const style = getComputedStyle(n);
        if (style.textOverflow === 'ellipsis') {
          offenders.push(`ellipsis: ${n.textContent.slice(0, 30)}`);
          continue;
        }
        if (style.webkitLineClamp && style.webkitLineClamp !== 'none') {
          offenders.push(`clamped: ${n.textContent.slice(0, 30)}`);
          continue;
        }
        // 1px of tolerance for sub-pixel rounding in the layout engine.
        if (n.scrollWidth > n.clientWidth + 1 && style.overflow === 'hidden') {
          offenders.push(`clipped: ${n.textContent.slice(0, 30)}`);
        }
        if (n.scrollHeight > n.clientHeight + 1 && style.overflowY === 'hidden') {
          offenders.push(`cut vertically: ${n.textContent.slice(0, 30)}`);
        }
      }
      return offenders;
    });
    check(`no truncated text at ${label} scale`, bad.length === 0, bad.slice(0, 3).join(' | '));
  };

  for (const [scaleKey, scaleName] of [['D', 'day'], ['W', 'week'], ['M', 'month'], ['Q', 'quarter'], ['Y', 'year']]) {
    await page.locator('#toolbar .cx-seg button', { hasText: new RegExp(`^${scaleKey}$`) }).first().click();
    await page.waitForTimeout(400);
    await truncationAudit(scaleName);
  }

  // Long text must survive too: a title nobody would fit in a bar.
  // Target a named wide bar: "the first one" can be a 6px sliver sitting under
  // a connector, which is selectable in its own right and swallows the click.
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(400);
  await page.locator('.tl-obj.shape-bar[data-label^="ATS Integration Testing"]').first().click();
  await page.waitForTimeout(250);
  const longTitle = 'Interlocking route locking regression verification for the northern approach';
  const longBox = page.locator('#inspector .cx-section input[type="text"]').first();
  await longBox.click();
  await longBox.fill('');
  await page.keyboard.type(longTitle, { delay: 4 });
  await page.locator('#canvas-frame').click({ position: { x: 400, y: 40 } });
  await page.waitForTimeout(500);

  const rendered = await page.evaluate((expected) => {
    // data-label carries "title — subtitle", so match on the title prefix.
    const node = document.querySelector(`.tl-obj[data-label^="${expected.replace(/"/g, '\\"')}"]`);
    if (!node) return { found: false, text: '(object not rendered)' };
    // Every word of the title must appear among the wrapped lines — that is
    // what "nothing is hidden" means in practice.
    const lines = Array.from(node.querySelectorAll('.ob-line')).map((n) => n.textContent);
    const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
    const missing = expected.split(/\s+/).filter((word) => !joined.includes(word));
    return { found: missing.length === 0, text: missing.length ? `missing: ${missing.join(', ')}` : joined, lines: lines.length };
  }, longTitle);
  check(
    `a very long title renders in full across ${rendered.lines || '?'} wrapped lines`,
    rendered.found,
    rendered.text.slice(0, 70)
  );
  await truncationAudit('long-title');

  console.log('\nDependency violations');
  // The starter plan links "Regression Cycle 5" → "Dynamic Testing Campaign 1"
  // (finish-to-start). Drag the predecessor far enough right and the
  // constraint becomes impossible; the arrow and both ends must flag.
  await page.locator('#toolbar .cx-seg button', { hasText: /^M$/ }).first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(400);

  const violationState = () => page.evaluate(() => ({
    links: document.querySelectorAll('.tl-connectors g[data-violated]').length,
    objects: document.querySelectorAll('.tl-obj.violated').length,
    flags: document.querySelectorAll('.tl-obj .ob-breach').length,
    status: document.querySelector('#statusbar .sb-warn')?.textContent || '',
  }));

  // Earlier sections move objects around, so compare against the state as it
  // stands rather than assuming a pristine plan.
  const baseline = await violationState();

  // Push the predecessor of a finish-to-start link well past its successor.
  const predecessor = page.locator('.tl-obj[data-label^="Regression Cycle 5"]').first();
  await predecessor.click();
  await page.waitForTimeout(250);
  for (let i = 0; i < 14; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(700);

  const broken = await violationState();
  check('dependency arrow turns red', broken.links > baseline.links, `${baseline.links} → ${broken.links} violated link(s)`);
  check('both ends of the link are flagged', broken.objects > baseline.objects, `${baseline.objects} → ${broken.objects} flagged`);
  check('objects carry a day-count flag', broken.flags >= 2, `${broken.flags} flag badge(s)`);
  check('status bar reports the breach', /broken dependenc/i.test(broken.status), broken.status);

  const detail = await page.evaluate(() => {
    const flag = document.querySelector('.tl-obj .ob-breach');
    return { text: flag?.textContent || '', title: flag?.getAttribute('title') || '' };
  });
  check('flag states how many days it is out by', /\d+d/.test(detail.text), `${detail.text} · ${detail.title}`);

  // Reverting the move must clear the flags with no residual state.
  for (let i = 0; i < 14; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForTimeout(800);
  const reverted = await violationState();
  check(
    'flags clear when the dates are put back',
    reverted.links === baseline.links && reverted.objects === baseline.objects,
    `expected ${baseline.links}/${baseline.objects}, got ${reverted.links}/${reverted.objects}`
  );

  // Adjusting the *dependency* rather than the dates must also clear it.
  for (let i = 0; i < 14; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(700);
  check('broken again after re-moving', (await violationState()).links > baseline.links);

  await page.locator('#sidenav .nav-link[data-pane="links"]').click();
  await page.waitForTimeout(350);
  check('dependencies pane counts the breach', (await page.locator('#dock .cx-listrow.danger').count()) >= 1);

  await page.locator('#dock .insp-alert button.primary').click();
  await page.waitForTimeout(900);
  const resolved = await violationState();
  check('"Reschedule all" clears every violation', resolved.links === 0 && resolved.objects === 0, JSON.stringify(resolved));
  check('status bar indicator disappears', resolved.status === '', resolved.status);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);

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
  // Earlier checks renamed several bars, so just take the first one there is.
  await page.locator('.tl-obj.shape-bar').first().click();
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
