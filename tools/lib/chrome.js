/**
 * Where Chromium is, if it is anywhere in particular.
 *
 * This environment ships a browser at a fixed path and asks that nothing
 * download another, so the suites point at it when it is there. Anywhere else
 * — a CI runner, a laptop — Playwright resolves its own, and passing no
 * `executablePath` is how you ask it to.
 *
 * Written once because the answer has to be the same in all five suites: two
 * of them hardcoded the pinned path, which meant they ran here and nowhere
 * else, and "the tests only run on one machine" is most of the reason a test
 * suite stops being run at all.
 */

import fs from 'node:fs';

const PINNED = [
  process.env.CX_CHROME,
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean);

/**
 * Launch options for `chromium.launch()`.
 *
 * `{}` when there is no pinned browser, which is Playwright's own resolution
 * and the right answer everywhere it applies.
 */
export function launchOptions(extra = {}) {
  const executablePath = PINNED.find((p) => fs.existsSync(p));
  return executablePath ? { executablePath, ...extra } : extra;
}
