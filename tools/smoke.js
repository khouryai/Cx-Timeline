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

  // `append(null)` stringifies — a conditional row that is absent must leave
  // nothing behind, not the word "null".
  check('no stray null text in the inspector', !/\bnull\b/.test(await page.locator('#inspector').innerText()));

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
        '.tl-obj .ob-line, .tl-obj .ob-pct, .tl-tick span, .tl-lane-label .ll-name, .tl-today-flag,'
        + ' .tl-baseline .bl-reason, .tl-baseline-reason .br-line'
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

  console.log('\nHiding a dependency');
  {
    // A hidden dependency line is a choice, not a fact about the schedule, and
    // it must not survive the thing it was hiding turning into a problem. This
    // runs before the "Dependency violations" section below so it starts from
    // the sample plan's own finish-to-start pair while it is still healthy,
    // and leaves it exactly as healthy and unhidden afterwards.
    // A plain DOM read rather than a locator for presence/violated together —
    // `locator.getAttribute()` waits for the element to attach, which would
    // hang out a full timeout on the very failure this test exists to catch
    // (the line never reappearing).
    const linkState = (id) => page.evaluate((id) => {
      const g = document.querySelector(`.tl-connectors g[data-link-id="${id}"]`);
      return { visible: !!g, violated: g?.dataset.violated === 'true' };
    }, id);

    // Selecting a connector is a real mousedown on its hit-path, dispatched
    // directly rather than clicked at a computed point — an elbow-routed path's
    // bounding-box centre is not reliably on the line itself. Trying each
    // connector in turn and reading the inspector's own header back is what the
    // application already uses to decide which link a click landed on.
    const findLink = (fromLabel, toLabel) => page.evaluate(([from, to]) => {
      for (const g of document.querySelectorAll('.tl-connectors g[data-link-id]')) {
        g.querySelector('.tl-link-hit')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        const name = document.querySelector('#inspector .ih-name')?.textContent || '';
        if (name.includes(from) && name.includes(to)) return g.dataset.linkId;
      }
      return null;
    }, [fromLabel, toLabel]);

    const linkId = await findLink('Regression Cycle 5', 'Dynamic Testing Campaign 1');
    check('the dependency under test is found and selected', !!linkId, linkId || '(not found)');
    check('it starts visible on the canvas', (await linkState(linkId)).visible);

    await page.locator('#inspector button[title="Hide dependency"]').click();
    await page.waitForTimeout(150);
    check('hiding it removes the line from the canvas', !(await linkState(linkId)).visible);
    check('the inspector now offers to show it again',
      (await page.locator('#inspector button[title="Show dependency"]').count()) === 1);
    const hintText = await page.evaluate(() => document.querySelector('#inspector .cx-hint')?.textContent || '');
    check('and says it is hidden', /Hidden/.test(hintText), hintText);

    // Break the very dependency it is hiding.
    await page.locator('.tl-obj[data-label^="Regression Cycle 5"]').first().click();
    await page.waitForTimeout(200);
    for (let i = 0; i < 14; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(700);

    const broken = await linkState(linkId);
    check('a broken dependency reappears even while hidden', broken.visible);
    check('drawn as broken, not merely made visible', broken.violated);

    // Put the dates back. The reappearance has to outlive the violation that
    // caused it, or "hidden" never really went away — it just got painted over
    // for as long as the line stayed broken.
    for (let i = 0; i < 14; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForTimeout(700);
    const settled = await linkState(linkId);
    check('no longer flagged as broken', !settled.violated);
    check('but it stays visible — hiding it again is a choice, not automatic', settled.visible);

    const reselected = await findLink('Regression Cycle 5', 'Dynamic Testing Campaign 1');
    check('the inspector agrees the hide was used up',
      reselected === linkId && (await page.locator('#inspector button[title="Hide dependency"]').count()) === 1);
  }

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

  console.log('\nMore than one dependency between a pair');
  // Two bars can be related in more than one way at once — "these start
  // together" and "this cannot finish until that one has" are both ordinary
  // statements about the same pair — so the edge a drag lands on names the
  // relationship, and only the *same* relationship twice is refused.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(600);

  // Read the saved document rather than counting arrows: what matters is how
  // many dependencies join *this* pair, which the canvas does not say.
  const savedDoc = () => page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('cx-timeline');
    r.onsuccess = () => {
      const g = r.result.transaction('projects').objectStore('projects').getAll();
      g.onsuccess = () => res(g.result.sort((a, b) => b.savedAt - a.savedAt)[0]?.doc || null);
      g.onerror = () => res(null);
    };
    r.onerror = () => res(null);
  }));

  const linkBars = await page.evaluate(() => [...document.querySelectorAll('.tl-obj.shape-bar')].map((n) => {
    const r = n.getBoundingClientRect();
    return { id: n.dataset.objId, label: n.dataset.label, left: r.left, right: r.right, top: r.top, height: r.height };
  }).filter((b) => b.right - b.left > 40 && b.top > 120));

  const startDoc = await savedDoc();
  const joined = (doc, a, b) => (doc?.links || []).filter((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));

  // A forward pair with nothing between them yet: a link that runs left to
  // right cannot close a cycle, and a pair that is already joined would tell
  // us nothing about a *second* relationship.
  let pair = null;
  const ordered = linkBars.slice().sort((a, b) => a.left - b.left);
  for (let i = 0; i < ordered.length && !pair; i++) {
    for (let j = i + 1; j < ordered.length && !pair; j++) {
      if (ordered[j].left > ordered[i].right + 40 && !joined(startDoc, ordered[i].id, ordered[j].id).length) {
        pair = { from: ordered[i], to: ordered[j] };
      }
    }
  }
  check('two unlinked bars are available', !!pair, pair ? `${pair.from.label} → ${pair.to.label}` : 'none found');

  if (pair) {
    // The anchors sit just outside each edge of a bar; this drags between them
    // the way a user does rather than calling the store.
    // Rectangles are re-read for every drag: creating a link can reflow the
    // lane, and a stale coordinate would miss the anchor and quietly turn the
    // check into "nothing happened, twice".
    const boxOf = (id) => page.evaluate((objId) => {
      const r = document.querySelector(`.tl-obj[data-obj-id="${objId}"]`)?.getBoundingClientRect();
      return r ? { left: r.left, right: r.right, top: r.top, height: r.height } : null;
    }, id);

    const drag = async (fromSide, toSide) => {
      const a = await boxOf(pair.from.id);
      const b = await boxOf(pair.to.id);
      if (!a || !b) return false;
      await page.mouse.move(fromSide === 'end' ? a.right + 7 : a.left - 7, a.top + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(toSide === 'end' ? b.right - 6 : b.left + 6, b.top + b.height / 2, { steps: 14 });
      const reached = await page.locator('.tl-canvas.connecting').count();
      await page.mouse.up();
      await page.waitForTimeout(900);
      return reached > 0;
    };
    const between = async () => joined(await savedDoc(), pair.from.id, pair.to.id);

    await drag('end', 'start');
    const first = await between();
    check('dragging finish → start creates a dependency',
      first.length === 1 && first[0].type === 'FS', first.map((l) => l.type).join(' ') || 'none');

    // Straight back out of the *same* anchor. The connector just drawn lies
    // over it and the connector layer paints above the bars, so this is the
    // press that used to select the line instead of starting a drag.
    await drag('end', 'end');
    const second = await between();
    check('a second relationship out of the same anchor is allowed',
      second.length === 2 && second.some((l) => l.type === 'FF'), second.map((l) => l.type).join(' '));

    await drag('start', 'start');
    const third = await between();
    check('and a third, from the other edge', third.length === 3, third.map((l) => l.type).join(' '));
    check('the edges dragged between name each one',
      new Set(third.map((l) => l.type)).size === 3, third.map((l) => l.type).join(' '));
    const routes = await page.evaluate((ids) =>
      ids.map((id) => document.querySelector(`.tl-connectors g[data-link-id="${id}"] path.tl-link`)?.getAttribute('d') || ''),
    third.map((l) => l.id));
    check('none of them is drawn on top of another',
      routes.length === 3 && routes.every(Boolean) && new Set(routes).size === 3, routes.join(' | ').slice(0, 90));

    // The same relationship twice would draw one line exactly on top of
    // another, so that one is still refused — out loud, not in silence.
    const dragged = await drag('start', 'start');
    const again = await between();
    check('but the same relationship twice is refused',
      dragged && again.length === 3, `${dragged ? '' : 'drag never started; '}${again.map((l) => l.type).join(' ')}`);
    check('and says why', /already joined/i.test(await page.locator('#cx-toasts .cx-toast').last().innerText().catch(() => '')));

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(700);
    check('undo takes them back off one at a time', (await between()).length === 0, `${(await between()).length} left`);
  }

  console.log('\nWhat the selection is waiting on');
  // Selecting a bar has to answer "what comes before this" on the canvas, not
  // just in the inspector: the predecessors and the arrows arriving from them
  // are marked for as long as the selection stands, and flash once to say where
  // to look. Same known finish-to-start pair as above.
  const upstreamState = () => page.evaluate(() => ({
    marked: [...document.querySelectorAll('.tl-obj.upstream')].map((n) => n.dataset.label),
    flashing: document.querySelectorAll('.tl-obj.upstream-flash').length,
    // Each highlighted link contributes both its line and its arrowhead.
    links: document.querySelectorAll('.tl-connectors g[data-upstream]').length,
    linkFlash: document.querySelectorAll('.tl-link.upstream.flash').length,
    ring: (() => {
      const node = document.querySelector('.tl-obj.upstream');
      return node ? getComputedStyle(node).outlineStyle : '';
    })(),
  }));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('nothing is marked while nothing is selected', (await upstreamState()).marked.length === 0);

  const successor = page.locator('.tl-obj[data-label^="Dynamic Testing Campaign 1"]').first();
  const box = await successor.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);

  const marked = await upstreamState();
  check('selecting a task marks what feeds it',
    marked.marked.includes('Regression Cycle 5'), marked.marked.join(' | ') || 'nothing marked');
  check('the predecessor is ringed, not merely selected', marked.ring === 'dashed', marked.ring);
  check('the arrows arriving at it are highlighted too', marked.links >= 1, `${marked.links}`);
  check('both flash on the way in', marked.flashing >= 1 && marked.linkFlash >= 1,
    `${marked.flashing} object(s), ${marked.linkFlash} arrow element(s)`);

  // The flash is one-shot; the highlight is not.
  await page.waitForTimeout(1500);
  const settled = await upstreamState();
  check('the flash stops on its own', settled.flashing === 0 && settled.linkFlash === 0,
    `${settled.flashing} object(s), ${settled.linkFlash} arrow element(s)`);
  check('the highlight stays while the selection does',
    settled.marked.includes('Regression Cycle 5') && settled.links >= 1, settled.marked.join(' | '));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const cleared = await upstreamState();
  check('deselecting clears it', cleared.marked.length === 0 && cleared.links === 0, JSON.stringify(cleared));

  console.log('\nDurations on a five-day week');
  // A commissioning plan is read in working days: "two weeks" means ten days on
  // site, and nobody counts the Saturdays. The counting changes; the bar does
  // not move, and what is typed into the field has to read back unchanged.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('.tl-obj.shape-bar').first().click();
  await page.waitForTimeout(400);

  // Read the fields by their labels: the panel grows and shrinks sections as
  // the plan changes, so an index into its inputs means nothing.
  const schedule = () => page.evaluate(() => {
    const byLabel = (pattern) => {
      const wrap = [...document.querySelectorAll('#inspector .cx-field')]
        .find((f) => pattern.test(f.querySelector('.cx-label')?.textContent || ''));
      return { value: wrap?.querySelector('input')?.value || '', label: wrap?.querySelector('.cx-label')?.textContent || '' };
    };
    const duration = byLabel(/^duration/i);
    return {
      start: byLabel(/^start$/i).value,
      finish: byLabel(/^finish$/i).value,
      duration: duration.value,
      label: duration.label,
    };
  });

  // Monday the 2nd of November 2026, so the week it spans is unambiguous.
  const fieldByLabel = (pattern) =>
    page.locator('#inspector .cx-field', { has: page.locator('.cx-label') })
      .filter({ hasText: pattern }).locator('input').first();

  const setField = async (pattern, value) => {
    // Let any rebuild from the previous edit land before taking hold of the
    // next field, or the value is typed into a node about to be replaced.
    await page.waitForTimeout(400);
    const input = fieldByLabel(pattern);
    await input.fill(value);
    // The panel holds still while one of its fields has focus, so the stored
    // value only comes back once focus has genuinely left it.
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(800);
  };

  await setField(/^Start$/, '2026-11-02');
  await setField(/^Duration/, '5');

  const working = await schedule();
  check('the duration field says it counts working days', /working days/i.test(working.label), working.label);
  check('five working days from a Monday covers that week',
    working.start === '2026-11-02' && working.finish === '2026-11-07', JSON.stringify(working));
  check('and reads back as the five that was typed', working.duration === '5', working.duration);

  await setField(/^Duration/, '10');
  const twoWeeks = await schedule();
  check('ten working days is a fortnight, weekend included',
    twoWeeks.finish === '2026-11-14' && twoWeeks.duration === '10', JSON.stringify(twoWeeks));

  // The same bar, counted the other way: the dates do not move.
  await page.locator('#sidenav .nav-link[data-pane="settings"]').click();
  await page.waitForTimeout(400);
  await page.locator('#dock .cx-seg button', { hasText: /^Calendar days$/ }).click();
  await page.waitForTimeout(700);
  const calendar = await schedule();
  check('switching to calendar days counts the weekends in',
    calendar.duration === '12' && calendar.start === twoWeeks.start && calendar.finish === twoWeeks.finish,
    JSON.stringify(calendar));

  await page.locator('#dock .cx-seg button', { hasText: /^Working days$/ }).click();
  await page.waitForTimeout(700);
  check('and switching back gives the working count again', (await schedule()).duration === '10');

  console.log('\nEditable lists');
  // Every dropdown vocabulary is project data. The pane and the "Manage…" row
  // at the foot of each dropdown are the same editor, so exercising the pane
  // exercises both.
  const storedList = (listId) => page.evaluate((id) => new Promise((res) => {
    const r = indexedDB.open('cx-timeline');
    r.onsuccess = () => {
      const g = r.result.transaction('projects').objectStore('projects').getAll();
      g.onsuccess = () => {
        const rec = g.result.sort((a, b) => b.savedAt - a.savedAt)[0];
        res(rec?.doc?.lists?.[id] || null);
      };
    };
  }), listId);

  // Something selected, so the inspector is showing a status dropdown.
  await page.locator('.tl-obj[data-label^="Regression Cycle 5"]').first().click();
  await page.waitForTimeout(250);
  check('inspector status field is a managed list', (await page.locator('#inspector select[data-list="status"]').count()) === 1);

  await page.locator('#sidenav .nav-link[data-pane="lists"]').click();
  await page.waitForTimeout(350);
  check('lists pane shows the status vocabulary', (await page.locator('#dock .list-opt[data-option="planned"]').count()) === 1);
  check('lists pane offers every list', (await page.locator('#dock .cx-seg button').count()) >= 8);

  // ── Add ────────────────────────────────────────────────────────────────
  await page.locator('#dock .cx-btn.primary', { hasText: 'Add option' }).click();
  await page.waitForTimeout(300);
  await page.locator('.cx-modal input[type="text"]').first().fill('Awaiting Sign-off');
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(500);
  check('a new option joins the list', (await page.locator('#dock .list-opt[data-option="awaiting-sign-off"]').count()) === 1);

  const offered = () => page.evaluate(() => {
    const sel = document.querySelector('#inspector select[data-list="status"]');
    return sel ? Array.from(sel.options).map((o) => o.value) : [];
  });
  check('the dropdown offers it immediately', (await offered()).includes('awaiting-sign-off'));
  check('the option is saved with the project', ((await storedList('status')) || []).some((o) => o.id === 'awaiting-sign-off'));

  // ── Use it, then remove it and reassign ────────────────────────────────
  await page.selectOption('#inspector select[data-list="status"]', 'awaiting-sign-off');
  await page.waitForTimeout(600);
  const statusOfSelected = () => page.evaluate(() => {
    const sel = document.querySelector('#inspector select[data-list="status"]');
    return sel ? sel.value : null;
  });
  check('an object can take the new status', (await statusOfSelected()) === 'awaiting-sign-off');

  await page.locator('#dock .list-opt[data-option="awaiting-sign-off"] button[aria-label="Remove option"]').click();
  await page.waitForTimeout(350);
  check('removing an option in use asks where its objects go', (await page.locator('.cx-modal select').count()) === 1);
  await page.selectOption('.cx-modal select', 'blocked');
  await page.locator('.cx-modal-foot .cx-btn.danger').click();
  await page.waitForTimeout(600);
  check('the option is gone', (await page.locator('#dock .list-opt[data-option="awaiting-sign-off"]').count()) === 0);
  check('objects that used it were reassigned', (await statusOfSelected()) === 'blocked');

  // ── Undo ───────────────────────────────────────────────────────────────
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  check('undo brings the option back', (await page.locator('#dock .list-opt[data-option="awaiting-sign-off"]').count()) === 1);
  check('undo restores the objects too', (await statusOfSelected()) === 'awaiting-sign-off');

  // ── Rename and reorder ─────────────────────────────────────────────────
  const renamed = page.locator('#dock .list-opt[data-option="awaiting-sign-off"] input[type="text"]');
  await renamed.fill('Awaiting Approval');
  await renamed.blur();
  await page.waitForTimeout(600);
  check('renaming keeps the stored id', ((await storedList('status')) || []).some((o) => o.id === 'awaiting-sign-off' && o.label === 'Awaiting Approval'));
  check('the rename reaches the dropdown', await page.evaluate(() => {
    const sel = document.querySelector('#inspector select[data-list="status"]');
    return !!sel && Array.from(sel.options).some((o) => o.value === 'awaiting-sign-off' && o.textContent === 'Awaiting Approval');
  }));

  const indexOfOption = (id) => page.evaluate((wanted) =>
    Array.from(document.querySelectorAll('#dock .list-opt')).findIndex((n) => n.dataset.option === wanted), id);
  const wasAt = await indexOfOption('awaiting-sign-off');
  await page.locator('#dock .list-opt[data-option="awaiting-sign-off"] button[aria-label="Move up"]').click();
  await page.waitForTimeout(400);
  const nowAt = await indexOfOption('awaiting-sign-off');
  check('an option can be moved up the list', nowAt === wasAt - 1, `${wasAt} → ${nowAt}`);
  const dropdownOrder = await page.evaluate(() => {
    const sel = document.querySelector('#inspector select[data-list="status"]');
    return sel ? Array.from(sel.options).map((o) => o.value) : [];
  });
  const paneOrder = await page.evaluate(() => Array.from(document.querySelectorAll('#dock .list-opt')).map((n) => n.dataset.option));
  check(
    'the dropdown follows the list order',
    JSON.stringify(dropdownOrder.filter((v) => paneOrder.includes(v))) === JSON.stringify(paneOrder),
    `${dropdownOrder.join(',')} vs ${paneOrder.join(',')}`
  );

  // ── A list with no colour column still works ───────────────────────────
  await page.locator('#dock .cx-seg button', { hasText: 'Test type' }).click();
  await page.waitForTimeout(300);
  check('another list renders', (await page.locator('#dock .list-opt[data-option="dynamic"]').count()) === 1);
  await page.locator('#dock .list-opt[data-option="dynamic"] button[aria-label="Remove option"]').click();
  await page.waitForTimeout(400);
  const askedAgain = await page.locator('.cx-modal').count();
  if (askedAgain) {
    await page.selectOption('.cx-modal select', 'static');
    await page.locator('.cx-modal-foot .cx-btn.danger').click();
    await page.waitForTimeout(500);
  }
  check('removing from a second list works', (await page.locator('#dock .list-opt[data-option="dynamic"]').count()) === 0);

  // ── The dropdown edits itself ──────────────────────────────────────────
  // "Manage…" and "Add…" sit at the foot of every managed select. Picking one
  // must open the editor and must never leak the command out as a value.
  await page.locator('.tl-obj[data-label^="Regression Cycle 5"]').first().click();
  await page.waitForTimeout(250);
  const statusBefore = await page.evaluate(() => document.querySelector('#inspector select[data-list="status"]').value);
  await page.evaluate(() => {
    const sel = document.querySelector('#inspector select[data-list="status"]');
    sel.value = Array.from(sel.options).find((o) => o.textContent.includes('Manage')).value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  check('"Manage…" opens the editor from the dropdown', (await page.locator('.cx-modal-title', { hasText: 'Manage lists' }).count()) === 1);
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(400);
  check('the command never becomes the value', (await page.evaluate(() => document.querySelector('#inspector select[data-list="status"]').value)) === statusBefore);

  // Owner is free text with suggestions rather than a closed list.
  check('owner is a suggestion field', (await page.locator('#inspector input[list]').count()) >= 1);
  check('owner suggestions include names already in the plan', await page.evaluate(() => {
    const input = document.querySelector('#inspector input[list]');
    const dl = input && document.getElementById(input.getAttribute('list'));
    return !!dl && dl.options.length > 0;
  }));

  await page.locator('#sidenav .nav-link[data-pane="lists"]').click();
  await page.waitForTimeout(350);
  await page.locator('#dock .cx-seg button', { hasText: 'Test type' }).click();
  await page.waitForTimeout(300);

  // Put the vocabulary back so later sections see a normal project.
  await page.locator('#dock .cx-btn.mini', { hasText: 'Restore defaults' }).click();
  await page.waitForTimeout(300);
  await page.locator('.cx-modal-foot .cx-btn').last().click();
  await page.waitForTimeout(500);
  check('restore defaults re-adds the shipped options', (await page.locator('#dock .list-opt[data-option="dynamic"]').count()) === 1);

  console.log('\nFilter display mode');
  await page.locator('#sidenav .nav-link[data-pane="filters"]').click();
  await page.waitForTimeout(350);
  const filterText = page.locator('#dock input[type="text"]').first();
  await filterText.fill('regression');
  await page.waitForTimeout(700);

  const shown = () => page.evaluate(() => ({
    total: document.querySelectorAll('.tl-obj').length,
    dimmed: document.querySelectorAll('.tl-obj.filtered-out').length,
    height: document.querySelector('.tl-stage')?.getBoundingClientRect().height || 0,
  }));

  const dimmedState = await shown();
  check('dim keeps non-matching objects on the canvas', dimmedState.dimmed > 0, `${dimmedState.dimmed} dimmed`);

  await page.locator('#dock .cx-seg button', { hasText: 'Hide' }).click();
  await page.waitForTimeout(800);
  const hiddenState = await shown();
  check('hide removes them entirely', hiddenState.dimmed === 0, `${hiddenState.dimmed} dimmed`);
  check('and the matches are still drawn', hiddenState.total > 0 && hiddenState.total < dimmedState.total,
    `${dimmedState.total} → ${hiddenState.total}`);
  check('the plan closes up rather than leaving gaps', hiddenState.height < dimmedState.height,
    `${Math.round(dimmedState.height)}px → ${Math.round(hiddenState.height)}px`);

  // The choice is part of the document, so it survives a reload.
  const stored = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('cx-timeline');
    r.onsuccess = () => {
      const g = r.result.transaction('projects').objectStore('projects').getAll();
      g.onsuccess = () => res(g.result.sort((a, b) => b.savedAt - a.savedAt)[0]?.doc?.settings?.filterMode);
    };
  }));
  check('the choice is saved with the project', stored === 'hide', String(stored));

  await page.locator('#dock .cx-seg button', { hasText: 'Dim' }).click();
  await page.waitForTimeout(500);
  check('switching back restores them', (await shown()).dimmed > 0);

  // Several things at once, comma separated. Every other filter narrows; this
  // box holds a list of what you are looking for, so any of them is a keeper.
  const kept = () => page.evaluate(() =>
    [...document.querySelectorAll('.tl-obj')].filter((n) => !n.classList.contains('filtered-out'))
      .map((n) => n.dataset.label || ''));

  const one = await kept();
  await filterText.fill('regression, radio');
  await page.waitForTimeout(800);
  const two = await kept();
  check('a second term after a comma widens the filter', two.length > one.length,
    `${one.length} → ${two.length} kept`);
  check('and both terms are what came back',
    two.some((t) => /regression/i.test(t)) && two.some((t) => /radio/i.test(t)), two.join(' | ').slice(0, 90));

  // A term with a space in it stays one phrase rather than two words.
  await filterText.fill('radio coverage, regression');
  await page.waitForTimeout(800);
  check('a phrase between commas is searched whole', (await kept()).some((t) => /radio coverage/i.test(t)),
    (await kept()).join(' | ').slice(0, 90));

  await filterText.fill('nothing here at all, still nothing');
  await page.waitForTimeout(800);
  check('and terms that match nothing keep nothing', (await kept()).length === 0, `${(await kept()).length} kept`);

  await filterText.fill('');
  await page.waitForTimeout(600);

  console.log('\nBaseline comparison');
  // A baseline is only worth having if the difference is visible, so this
  // checks the drawing, not just that the data compared.
  await page.locator('#sidenav .nav-link[data-pane="baselines"]').click();
  await page.waitForTimeout(400);
  await page.locator('#dock .cx-btn', { hasText: /take baseline/i }).first().click();
  await page.waitForTimeout(500);
  if (await page.locator('.cx-modal').count()) {
    await page.locator('.cx-modal-foot .cx-btn.primary').click();
    await page.waitForTimeout(700);
  }
  check('a baseline can be taken', (await page.locator('#dock .cx-listrow').count()) >= 1);

  const baselineState = () => page.evaluate(() => ({
    ghosts: document.querySelectorAll('.tl-baseline').length,
    arrows: document.querySelectorAll('.tl-shift').length,
    gone: document.querySelectorAll('.tl-baseline-gone').length,
    banner: document.querySelector('.tl-baseline-bar')?.textContent || '',
    days: [...document.querySelectorAll('.tl-shift .sh-days')].map((n) => n.textContent),
  }));

  check('nothing is drawn while the plan matches its baseline', (await baselineState()).ghosts === 0);

  // Move one bar later and another earlier, then delete a third. Earlier
  // sections rename bars, so these are picked by position rather than by
  // title — a selector that silently matches nothing would have made the
  // checks below pass for the wrong reason.
  const bars = page.locator('.tl-obj.shape-bar');
  const barCount = await bars.count();
  check('there are bars to compare', barCount >= 3, `${barCount}`);

  const nudge = async (index, presses, key) => {
    await bars.nth(index).click();
    await page.waitForTimeout(250);
    for (let i = 0; i < presses; i++) await page.keyboard.press(key);
    await page.waitForTimeout(450);
  };
  await nudge(0, 6, 'Shift+ArrowRight');
  await nudge(1, 3, 'Shift+ArrowLeft');
  // A move long enough to leave the ghost sitting where its neighbours are,
  // which is the overlap the packer has to resolve by reflowing the lane.
  await nudge(3, 26, 'Shift+ArrowRight');
  await bars.nth(2).click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(800);

  const moved = await baselineState();
  check('the original dates are ghosted', moved.ghosts >= 2, `${moved.ghosts} ghost(s)`);
  check('an arrow measures each move', moved.arrows >= 2, `${moved.arrows} arrow(s)`);
  check('the arrows are labelled in days', moved.days.every((d) => /^[+−]\d+d$/.test(d)), moved.days.join(' '));
  check('a slip and an acceleration are told apart', await page.evaluate(() =>
    document.querySelector('.tl-shift.slip') !== null && document.querySelector('.tl-shift.ahead') !== null));
  check('objects removed since the baseline still appear', moved.gone >= 1, `${moved.gone}`);
  check('the banner names the baseline and counts the changes',
    /baseline/i.test(moved.banner) && /slipped/i.test(moved.banner), moved.banner.replace(/\n/g, ' '));

  // A ghost is a rectangle on the canvas like any other, so it is packed like
  // one: it may not land on a bar, and two of them may not land on each other.
  // Measured from the DOM at several zooms, because the split is a pixel
  // decision — a ghost that clears its bar at day scale covers it at year
  // scale, and the row has to grow and stack on its own.
  // The striped area answers the question the comparison raises: why. It is
  // typed into on the canvas, it is packed like every other piece of text, and
  // it reaches the PDF a review is held on.
  const REASON = 'Client power-up slipped; waiting on the substation';
  await page.locator('.tl-baseline.slip').first().click();
  await page.waitForTimeout(400);
  check('clicking the striped area opens a field on it',
    (await page.locator('.tl-reason-input').count()) === 1);
  check('and selects the activity behind it, so its details are in view', await page.evaluate(() =>
    !!document.querySelector('.tl-obj.selected') &&
    /Baseline comparison/i.test(document.querySelector('#inspector')?.textContent || '')));

  await page.locator('.tl-reason-input').fill(REASON);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);

  const reasonState = () => page.evaluate(() => ({
    inside: [...document.querySelectorAll('.tl-baseline .bl-reason')].map((n) => n.textContent),
    below: [...document.querySelectorAll('.tl-baseline-reason')].map((n) => n.getAttribute('aria-label') || ''),
    editors: document.querySelectorAll('.tl-reason-input').length,
  }));
  const written = await reasonState();
  check('the reason is written onto the comparison',
    written.editors === 0 && [...written.inside, ...written.below].some((t) => t.includes('substation')),
    JSON.stringify(written).slice(0, 120));
  check('and the inspector holds the same sentence', await page.evaluate((text) =>
    [...document.querySelectorAll('#inspector input')].some((i) => i.value === text), REASON));

  const collisions = () => page.evaluate(() => {
    const box = (n) => {
      const r = n.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    };
    // 1px of slack: adjacent edges are not an overlap.
    const hits = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
    // Bands and containers are lane-tall backdrops: everything sits on them by
    // design, so they are not part of the question.
    const bars = [...document.querySelectorAll('.tl-obj.shape-bar')].map(box);
    // The reason notes are part of the comparison and are packed with it, so
    // they are held to the same rule: never over a bar, never over each other.
    const marks = [...document.querySelectorAll('.tl-baseline, .tl-baseline-gone, .tl-baseline-reason')].map(box);

    let onBars = 0;
    let onEachOther = 0;
    for (const mark of marks) for (const bar of bars) if (hits(mark, bar)) onBars++;
    for (let i = 0; i < marks.length; i++) {
      for (let j = i + 1; j < marks.length; j++) if (hits(marks[i], marks[j])) onEachOther++;
    }
    return { onBars, onEachOther, marks: marks.length };
  });

  const zoomOut = page.locator('#toolbar [aria-label="Zoom out"], #toolbar [title="Zoom out"]').first();
  const zoomIn = page.locator('#toolbar [aria-label="Zoom in"], #toolbar [title="Zoom in"]').first();
  const zooms = [{ at: 'fit', ...(await collisions()) }];
  for (const step of ['out', 'out', 'in', 'in']) {
    await (step === 'out' ? zoomOut : zoomIn).click();
    await page.waitForTimeout(500);
    zooms.push({ at: step, ...(await collisions()) });
  }
  check('no baseline ghost is drawn on top of a bar',
    zooms.every((z) => z.marks > 0 && z.onBars === 0),
    zooms.map((z) => `${z.at} ${z.onBars}/${z.marks}`).join(', '));
  check('and no two of them are drawn on top of each other',
    zooms.every((z) => z.onEachOther === 0),
    zooms.map((z) => `${z.at} ${z.onEachOther}`).join(', '));
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(600);

  // The export is the same drawing, or a comparison taken to a meeting as a
  // PDF would quietly show only the current dates.
  const exported = await page.evaluate(async () => {
    document.querySelector('#sidenav .nav-link[data-pane="io"]').click();
    await new Promise((r) => setTimeout(r, 400));
    let href = null;
    const real = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { href = this.href; };
    const button = [...document.querySelectorAll('#dock .cx-btn')].find((b) => /svg/i.test(b.textContent));
    button.click();
    await new Promise((r) => setTimeout(r, 1500));
    HTMLAnchorElement.prototype.click = real;
    return href ? await (await fetch(href)).text() : '';
  });
  check('the export draws the ghosts too', (exported.match(/stroke-dasharray/g) || []).length >= 2);
  check('and carries the day counts', /[+−]\d+d/.test(exported),
    (exported.match(/>[+−]\d+d</g) || []).join(' '));
  // The whole point of writing the reason down is the file someone else reads.
  check('and the reason the plan moved', /substation/.test(exported));

  // Back on the canvas: the note is a way into the same field, the sentence
  // survives the round trip through the store, and it is an edit like any
  // other — one undo takes it back, one redo puts it there again.
  await page.locator('.tl-baseline-reason, .tl-baseline.annotated').first().click();
  await page.waitForTimeout(400);
  check('clicking the note reopens the field on what it says',
    (await page.locator('.tl-reason-input').inputValue().catch(() => '')) === REASON);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);
  check('undo takes the reason back off',
    (await page.locator('.tl-baseline-reason, .tl-baseline .bl-reason').count()) === 0);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(600);
  check('redo writes it back',
    (await page.locator('.tl-baseline-reason, .tl-baseline .bl-reason').count()) >= 1);

  // Turning comparison off must leave nothing behind.
  await page.locator('#sidenav .nav-link[data-pane="baselines"]').click();
  await page.waitForTimeout(400);
  await page.locator('#dock .cx-toggle, #dock .cx-switch').first().click().catch(() => {});
  await page.waitForTimeout(600);
  const off = await baselineState();
  check('switching comparison off clears the canvas',
    off.ghosts === 0 && off.arrows === 0 && off.gone === 0 && off.banner === '',
    JSON.stringify(off));

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);

  console.log('\nExport options');
  await page.locator('#sidenav .nav-link[data-pane="io"]').click();
  await page.waitForTimeout(400);
  check('the drawing options are reachable',
    (await page.locator('#dock .cx-btn', { hasText: /drawing options/i }).count()) === 1);
  check('the pane says what the next export will contain',
    /drawing the whole plan|on screen/i.test(
      await page.locator('#dock [data-section="export"] .cx-hint').last().innerText()
    ));

  const grabSvg = () => page.evaluate(async () => {
    document.querySelector('#sidenav .nav-link[data-pane="io"]').click();
    await new Promise((r) => setTimeout(r, 350));
    let href = null;
    const real = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { href = this.href; };
    [...document.querySelectorAll('#dock .cx-btn')].find((b) => /svg/i.test(b.textContent)).click();
    await new Promise((r) => setTimeout(r, 1500));
    HTMLAnchorElement.prototype.click = real;
    return href ? await (await fetch(href)).text() : '';
  });

  // Dates on objects are the point of the exercise: a bar on a month-scale
  // ruler cannot be read to the day.
  const withDates = await grabSvg();
  const datePattern = /\d{1,2}\/\d{1,2}\/\d{4}\s*→/;
  check('exported objects carry their dates', datePattern.test(withDates),
    (withDates.match(/\d{1,2}\/\d{1,2}\/\d{4} → \d{1,2}\/\d{1,2}\/\d{4}\s+\(\d+d\)/) || ['none'])[0]);
  check('and their duration', /\(\d+d\)/.test(withDates));

  await page.locator('#dock .cx-btn', { hasText: /drawing options/i }).click();
  await page.waitForTimeout(500);
  check('the options dialog opens', (await page.locator('.cx-modal').count()) === 1);
  const toggleCount = await page.locator('.cx-modal .cx-toggle, .cx-modal input[type="checkbox"]').count();
  check('it offers the content toggles', toggleCount >= 5, `${toggleCount}`);

  // Turn dates off and confirm the drawing actually changes.
  await page.locator('.cx-modal', { hasText: 'Drawing options' })
    .locator('label', { hasText: /dates on every object/i }).first().click();
  await page.waitForTimeout(400);
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(500);

  const withoutDates = await grabSvg();
  check('turning dates off removes them', !datePattern.test(withoutDates));
  check('and the rest of the plan is still drawn',
    withoutDates.length > 8000 && withoutDates.includes('<rect'));
  check('the choice is saved with the project', await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('cx-timeline');
    r.onsuccess = () => {
      const g = r.result.transaction('projects').objectStore('projects').getAll();
      g.onsuccess = () => res(g.result.sort((a, b) => b.savedAt - a.savedAt)[0]?.doc?.settings?.exportOptions?.showDates);
    };
  })) === false);

  // Put it back so later checks see the default.
  await page.locator('#dock .cx-btn', { hasText: /drawing options/i }).click();
  await page.waitForTimeout(450);
  await page.locator('.cx-modal', { hasText: 'Drawing options' })
    .locator('label', { hasText: /dates on every object/i }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(400);

  console.log('\nP6 schedule');
  // A P6 export with the things that actually break importers: junk rows
  // above the header, dd-MMM-yy dates carrying times, and a milestone whose
  // start and finish are the same day.
  const p6Baseline = [
    'Line 1 CBTC — Testing & Commissioning',
    'Filter: Discipline = Commissioning',
    '',
    'Activity ID,Activity Name,WBS,Start,Finish,% Complete',
    'CX-Z3-0100,SCADA Interface Verification,Zone 3/SCADA,03-Aug-26 08:00,21-Aug-26 17:00,45',
    'CX-Z3-0110,Dynamic Testing Campaign 1,Zone 3/Dynamic,24-Aug-26 08:00,02-Oct-26 17:00,0',
    'CX-Z3-0120,Zone 3 Ready for Service,Zone 3/Milestones,05-Oct-26 08:00,05-Oct-26 08:00,0',
    'CX-Z4-0100,IXL Static Testing,Zone 4/IXL,14-Sep-26 08:00,30-Oct-26 17:00,0',
    // In both imports and never placed, so there is always one activity left
    // to link once the checks below have used up the others.
    'CX-Z4-0110,IXL Dynamic Testing,Zone 4/IXL,02-Nov-26 08:00,04-Dec-26 17:00,0',
  ].join('\n');

  await page.locator('#sidenav .nav-link[data-pane="p6"]').click();
  await page.waitForTimeout(400);
  check('the P6 pane explains itself when empty',
    /no p6 schedule/i.test(await page.locator('#dock .ce-title').innerText()));

  const importP6 = async (kind, csv, fileName) => {
    await page.locator('#dock .cx-btn', { hasText: /import from p6/i }).click();
    await page.waitForTimeout(400);
    await page.locator('.cx-modal .cx-seg button', { hasText: kind === 'baseline' ? 'Baseline' : 'Progress' }).click();
    await page.waitForTimeout(200);
    await page.locator('.cx-modal input[type="file"]').setInputFiles({
      name: fileName, mimeType: 'text/csv', buffer: Buffer.from(csv),
    });
    await page.waitForTimeout(900);
  };

  await importP6('baseline', p6Baseline, 'p6-baseline.csv');
  const previewChips = await page.locator('.cx-modal .cx-chipstat').allTextContents();
  check('the import previews before writing anything', previewChips.some((c) => /Read5/.test(c)), previewChips.join(' '));
  const sample = await page.locator('.cx-modal .cx-listrow .lr-meta').allTextContents();
  check('a finish time does not push the date to the next day',
    sample[0]?.includes('Aug 21, 2026'), sample[0] || '');
  check('a milestone keeps one date',
    /Oct 5, 2026 → Oct 5, 2026/.test(sample[2] || ''), sample[2] || '');

  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(900);
  check('the register lists every activity', (await page.locator('#dock .p6-row[data-p6]').count()) === 5);
  check('and records when the baseline came in',
    /baseline/i.test(await page.locator('#dock .p6-stamps').innerText()) &&
    !/baseline\s*not imported/i.test(await page.locator('#dock .p6-stamps').innerText()));

  // Place two, one of which is the milestone.
  for (const id of ['CX-Z3-0100', 'CX-Z3-0120']) {
    await page.locator(`#dock .p6-row[data-p6="${id}"] button[aria-label^="Add"]`).click();
    await page.waitForTimeout(400);
    await page.locator('.cx-modal-foot .cx-btn.primary').click();
    await page.waitForTimeout(600);
  }
  check('an activity can be placed on the timeline', await page.evaluate(() =>
    [...document.querySelectorAll('.tl-obj')].some((n) => (n.getAttribute('data-label') || '').includes('SCADA Interface Verification'))));
  check('a P6 milestone becomes a milestone, not a bar', await page.evaluate(() =>
    [...document.querySelectorAll('.tl-obj')].some((n) =>
      (n.getAttribute('data-label') || '').includes('Zone 3 Ready') && n.className.includes('shape-diamond'))));
  check('the master says what is placed and what is not',
    /on timeline\s*2/i.test((await page.locator('#dock .cx-chipstats').first().innerText()).replace(/\n/g, ' ')));

  // Month two: a progress import that moves things, adds one and drops one.
  const p6Progress = [
    'Activity ID,Activity Name,WBS,Start,Finish,% Complete',
    'CX-Z3-0100,SCADA Interface Verification,Zone 3/SCADA,03-Aug-26 08:00,28-Aug-26 17:00,70',
    'CX-Z3-0110,Dynamic Testing Campaign 1,Zone 3/Dynamic,07-Sep-26 08:00,16-Oct-26 17:00,0',
    'CX-Z3-0120,Zone 3 Ready for Service,Zone 3/Milestones,19-Oct-26 08:00,19-Oct-26 08:00,0',
    'CX-Z4-0110,IXL Dynamic Testing,Zone 4/IXL,09-Nov-26 08:00,18-Dec-26 17:00,0',
    'CX-Z5-0100,New Scope — Zone 5 Static,Zone 5/IXL,02-Nov-26 08:00,11-Dec-26 17:00,0',
  ].join('\n');

  await importP6('progress', p6Progress, 'p6-progress.csv');
  check('a re-import warns when placed activities moved',
    /on your timeline/i.test(await page.locator('.cx-modal').innerText()));
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(1100);

  check('it then asks before moving any of your bars',
    /follow the new p6 dates/i.test(await page.locator('.cx-modal-title').innerText()));
  const adoptRows = await page.locator('.cx-modal .cx-listrow .lr-meta').allTextContents();
  check('the first progress import measures against the baseline',
    adoptRows.some((r) => /days later than the baseline/.test(r)), adoptRows.join(' | '));

  // Take one, leave the other — the point of the dialog.
  await page.locator('.cx-modal .cx-listrow input[type="checkbox"]').first().click();
  await page.waitForTimeout(200);
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(900);

  const registry = await page.evaluate(() =>
    [...document.querySelectorAll('#dock .p6-row[data-p6]')].map((n) => ({
      id: n.dataset.p6,
      badges: [...n.querySelectorAll('.cx-badge')].map((b) => b.textContent),
    })));
  const byId = Object.fromEntries(registry.map((r) => [r.id, r.badges.join(' ')]));

  check('P6 slip is computed per activity', /P6 \+7d/.test(byId['CX-Z3-0100'] || ''), byId['CX-Z3-0100']);
  check('an activity absent from the file is marked, not deleted',
    /Not in P6/.test(byId['CX-Z4-0100'] || ''), byId['CX-Z4-0100']);
  check('new scope in P6 appears in the register', Boolean(byId['CX-Z5-0100']));
  check('a bar that was not adopted records the divergence',
    /you −\d+d/.test(byId['CX-Z3-0120'] || ''), byId['CX-Z3-0120']);
  check('a bar that was adopted no longer diverges',
    !/you [+−]\d+d/.test(byId['CX-Z3-0100'] || ''), byId['CX-Z3-0100']);

  // The P6 activity ID has to be findable — that is the whole point — and the
  // box has to survive being typed into. A pane that rebuilds itself on every
  // keystroke throws focus out after one character; searching redraws only
  // the rows for exactly that reason.
  const search = page.locator('#dock input[aria-label="Search P6 activities"]');
  await search.click();
  await page.keyboard.type('CX-Z4-0100', { delay: 25 });
  await page.waitForTimeout(600);
  check('the P6 search box keeps focus while typing',
    await search.evaluate((n) => n === document.activeElement));
  check('the whole search term reached the box', (await search.inputValue()) === 'CX-Z4-0100', await search.inputValue());
  check('an activity can be found by its ID', (await page.locator('#dock .p6-row[data-p6]').count()) === 1);

  // Filtering must not lose it either.
  await page.locator('#dock .cx-seg button', { hasText: 'On timeline' }).click();
  await page.waitForTimeout(400);
  check('a filter narrows the register',
    (await page.locator('#dock .p6-row[data-p6]').count()) === 0, 'CX-Z4-0100 is not placed');
  await page.locator('#dock .cx-seg button', { hasText: 'All' }).click();
  await page.waitForTimeout(300);

  await search.fill('');
  await page.waitForTimeout(400);
  check('clearing the search restores the register', (await page.locator('#dock .p6-row[data-p6]').count()) === 6);

  // ── One bar, several activities ──────────────────────────────────────
  // A commissioning campaign is routinely a whole test package in P6, so a
  // link is a set and the dates it is measured against are the roll-up.
  // Select it through the register, not by title: the sample plan already
  // contains a bar called "SCADA Interface Verification", and picking the
  // wrong one would make every check below pass for the wrong reason.
  await page.locator('#dock .p6-row[data-p6="CX-Z3-0100"] button[aria-label^="Show"]').click();
  await page.waitForTimeout(600);
  check('the inspector shows what a bar tracks',
    (await page.locator('#inspector .p6-chip').count()) === 1,
    `${await page.locator('#inspector .p6-chip').count()} chip(s)`);

  // Add a second by searching — a dropdown of 1,500 would be unusable.
  await page.locator('#inspector .cx-btn', { hasText: /add a p6 activity/i }).click();
  await page.waitForTimeout(500);
  check('activities are chosen by searching', (await page.locator('.cx-picker-list').count()) === 1);
  const picker = page.locator('.cx-modal input[type="text"]').first();
  await picker.click();
  await page.keyboard.type('Dynamic', { delay: 25 });
  await page.waitForTimeout(500);
  check('the picker keeps focus while typing',
    await picker.evaluate((n) => n === document.activeElement));
  const options = await page.locator('.cx-picker-item').count();
  check('typing narrows the register', options >= 1 && options < 5, `${options} shown`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);

  check('a bar can track more than one activity',
    (await page.locator('#inspector .p6-chip').count()) === 2);
  const spanText = await page.locator('#inspector .cx-chipstats').first().innerText();
  check('and is measured against the whole span', /P6 span/i.test(spanText), spanText.replace(/\n/g, ' '));

  // The roll-up must cover both, not just the first.
  const rollUp = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('cx-timeline');
    r.onsuccess = () => {
      const g = r.result.transaction('projects').objectStore('projects').getAll();
      g.onsuccess = () => {
        const doc = g.result.sort((a, b) => b.savedAt - a.savedAt)[0]?.doc;
        const obj = (doc?.objects || []).find((o) => (o.data?.p6Ids || []).length === 2);
        if (!obj) return res(null);
        const acts = (obj.data.p6Ids || []).map((id) => doc.p6.activities[id]);
        const dates = acts.map((a) => a.progress || a.baseline);
        res({
          ids: obj.data.p6Ids,
          earliest: Math.min(...dates.map((d) => d.start)),
          latest: Math.max(...dates.map((d) => d.end)),
        });
      };
    };
  }));
  check('the link is stored as a set', rollUp && rollUp.ids.length === 2, JSON.stringify(rollUp?.ids));
  check('the roll-up spans earliest start to latest finish',
    rollUp && rollUp.latest > rollUp.earliest);

  // Removing one leaves the other alone. Name the activity rather than
  // taking whichever chip is first — the two are not interchangeable, and the
  // one put back below has to be the one taken away.
  await page.locator('#inspector .p6-chip[data-p6="CX-Z3-0110"] button[aria-label^="Unlink"]').click();
  await page.waitForTimeout(600);
  check('one activity can be removed without losing the rest',
    (await page.locator('#inspector .p6-chip').count()) === 1
      && (await page.locator('#inspector .p6-chip[data-p6="CX-Z3-0100"]').count()) === 1);

  // Put it back for the comparison checks below.
  await page.locator('#inspector .cx-btn', { hasText: /add a p6 activity/i }).click();
  await page.waitForTimeout(450);
  await page.locator('.cx-modal input[type="text"]').first().click();
  await page.keyboard.type('Dynamic', { delay: 20 });
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  check('an unlinked activity can be linked again',
    (await page.locator('#inspector .p6-chip').count()) === 2,
    `${await page.locator('#inspector .p6-chip').count()} chip(s)`);

  // Dropping onto a bar adds to it rather than displacing what is there.
  const dropped = await page.evaluate(() => {
    const row = document.querySelector('#dock .p6-row[data-p6="CX-Z4-0100"]');
    // The selected bar is the one the register just revealed.
    const bar = document.querySelector('.tl-obj.selected')
      || [...document.querySelectorAll('.tl-obj')].find((n) => (n.getAttribute('data-label') || '').includes('SCADA'));
    if (!row || !bar) return 'missing';

    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const box = bar.getBoundingClientRect();
    const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, dataTransfer: dt };
    const canvas = document.querySelector('.tl-canvas');
    canvas.dispatchEvent(new DragEvent('dragover', at));
    canvas.dispatchEvent(new DragEvent('drop', at));
    return 'done';
  });
  await page.waitForTimeout(800);
  check('an activity can be dragged onto a bar', dropped === 'done', dropped);
  check('dropping adds to what the bar tracks rather than replacing it',
    (await page.locator('#inspector .p6-chip').count()) === 3,
    `${await page.locator('#inspector .p6-chip').count()} chips`);

  await page.locator('#sidenav .nav-link[data-pane="p6"]').click();
  await page.waitForTimeout(400);

  // Both sides of the register become baselines on their own, and — the point
  // of them — they follow whatever is linked rather than freezing a copy.
  await page.locator('#sidenav .nav-link[data-pane="baselines"]').click();
  await page.waitForTimeout(450);
  const blPane = await page.locator('#dock').innerText();
  check('importing creates a baseline for each side', /P6 — baseline/i.test(blPane) && /P6 — current progress/i.test(blPane),
    blPane.replace(/\n/g, ' · ').slice(0, 120));
  check('and they are marked as tracking P6', /tracks p6/i.test(blPane));

  await page.locator('#sidenav .nav-link[data-pane="p6"]').click();
  await page.waitForTimeout(400);
  await page.locator('#dock .cx-btn', { hasText: /compare to baseline/i }).click();
  await page.waitForTimeout(900);

  const ghosts = () => page.evaluate(() => ({
    ghosts: document.querySelectorAll('.tl-baseline').length,
    arrows: document.querySelectorAll('.tl-shift').length,
    days: [...document.querySelectorAll('.tl-shift .sh-days')].map((n) => n.textContent),
  }));

  const blSide = await ghosts();
  check('comparing against P6 draws the difference', blSide.ghosts >= 1,
    `${blSide.ghosts} ghost(s), ${blSide.days.join(' ')}`);

  // Link another activity. The comparison must pick it up with no re-taking.
  await page.locator('#dock .p6-row[data-p6="CX-Z4-0110"] button[aria-label^="Add"]').click();
  await page.waitForTimeout(400);
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(900);

  // Move it so it differs from its P6 dates, or there is nothing to draw.
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(800);

  const withExtra = await ghosts();
  check('linking another activity updates the comparison on its own',
    withExtra.ghosts > blSide.ghosts, `${blSide.ghosts} → ${withExtra.ghosts} ghost(s)`);

  // Switching to the progress side compares against different dates.
  await page.locator('#dock .cx-btn', { hasText: /compare to progress/i }).click();
  await page.waitForTimeout(900);
  const progressSide = await ghosts();
  check('the progress side is a separate comparison', progressSide.ghosts >= 1,
    `${progressSide.ghosts} ghost(s), ${progressSide.days.join(' ')}`);
  check('and gives different day counts from the baseline side',
    JSON.stringify(progressSide.days) !== JSON.stringify(blSide.days),
    `${blSide.days.join(' ')} vs ${progressSide.days.join(' ')}`);

  // A derived baseline is never written into the document — it is computed.
  check('no rows are stored for a P6 baseline', await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('cx-timeline');
    r.onsuccess = () => {
      const g = r.result.transaction('projects').objectStore('projects').getAll();
      g.onsuccess = () => {
        const doc = g.result.sort((a, b) => b.savedAt - a.savedAt)[0]?.doc;
        const p6bl = (doc?.baselines || []).filter((b) => b.source === 'p6');
        res(p6bl.length === 2 && p6bl.every((b) => !b.snapshot || b.snapshot.length === 0));
      };
    };
  })));

  // Put the canvas back for the sections that follow.
  await page.locator('#sidenav .nav-link[data-pane="p6"]').click();
  await page.waitForTimeout(300);

  console.log('\nDock panes');
  const panes = ['lanes', 'palette', 'outline', 'releases', 'campaigns', 'risks', 'links', 'baselines', 'search', 'filters', 'legend', 'history', 'io', 'backups', 'lists', 'settings'];
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
        // A download leaves nothing on screen, so each one has to announce
        // itself. The newest toast is the last child of the host.
        out[`${key}Toast`] = document.querySelector('#cx-toasts .cx-toast:last-child')?.textContent || '';
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
  // A file that lands silently in a folder the page cannot see is the one
  // action in the application with no visible result. Every export says so.
  for (const [key, ext] of [['svg', '.svg'], ['png', '.png'], ['csv', '.csv'], ['json', '.json']]) {
    const text = exportChecks[`${key}Toast`] || '';
    check(`the ${key.toUpperCase()} export says it was written`,
      /exported/i.test(text) && text.includes(ext) && /saved to your downloads/i.test(text),
      text.replace(/\s+/g, ' ').slice(0, 90) || '(no notification)');
  }

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
  const pdfToast = await page.evaluate(() =>
    document.querySelector('#cx-toasts .cx-toast:last-child')?.textContent || '');
  check('and says so, naming the file', /PDF exported/i.test(pdfToast) && /\.pdf/.test(pdfToast),
    pdfToast.replace(/\s+/g, ' ').slice(0, 90) || '(no notification)');

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
