#!/usr/bin/env node
/**
 * Draw the phone app's home-screen icons.
 *
 * The mark is the favicon's — a red post and two plan bars on the slate the
 * sidebar is drawn in — at the sizes a phone asks for. Rendered from SVG by the
 * same Chromium the test suites use, so the PNGs are reproducible from this file
 * rather than being binaries nobody can regenerate. Committed, because a deploy
 * has no build step that could run a browser.
 *
 *   node tools/pwa_icons.js
 *
 * Four files, because the platforms disagree:
 *   icon-192 / icon-512   the manifest's ordinary icons — rounded, transparent corners
 *   maskable-512          Android's adaptive icon: full bleed, the mark inside the
 *                         central safe circle, because the launcher crops the rest
 *   apple-touch-icon      180px, full bleed: iOS rounds the corners itself and
 *                         paints transparency black
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { launchOptions } from './lib/chrome.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'm', 'icons');

/* The tokens' values, copied because an icon is an image and cannot read CSS:
   --slate-900, --hitachi-red, the dark theme's --info and --good. */
const SLATE = '#111827';
const RED = '#e60012';
const BLUE = '#5b93f5';
const GREEN = '#16a571';

/** The mark on a 32-unit grid, scaled into `inset` of the canvas. */
function mark(inset) {
  const s = (1 - inset * 2) / 32;
  const o = inset;
  const r = (x, y, w, h, rx, fill) =>
    `<rect x="${o + x * s}" y="${o + y * s}" width="${w * s}" height="${h * s}" rx="${rx * s}" fill="${fill}"/>`;
  return [
    r(6, 7, 4, 18, 2, RED),
    r(13, 10, 13, 4, 2, BLUE),
    r(13, 18, 8, 4, 2, GREEN),
  ].join('');
}

function svg({ size, rounded, inset }) {
  const bg = rounded
    ? `<rect width="1" height="1" rx="${7 / 32}" fill="${SLATE}"/>`
    : `<rect width="1" height="1" fill="${SLATE}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1 1">${bg}${mark(inset)}</svg>`;
}

const ICONS = [
  { file: 'icon-192.png', size: 192, rounded: true, inset: 0 },
  { file: 'icon-512.png', size: 512, rounded: true, inset: 0 },
  // The safe zone is the central circle of 80% diameter; the mark sits well inside it.
  { file: 'maskable-512.png', size: 512, rounded: false, inset: 0.17 },
  { file: 'apple-touch-icon.png', size: 180, rounded: false, inset: 0.08 },
];

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ deviceScaleFactor: 1 });
fs.mkdirSync(OUT, { recursive: true });
for (const icon of ICONS) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg(icon)}</body></html>`
  );
  await page.locator('svg').screenshot({ path: path.join(OUT, icon.file), omitBackground: true });
  console.log(`✓ m/icons/${icon.file} — ${icon.size}px`);
}
await browser.close();
