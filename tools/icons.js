#!/usr/bin/env node
/**
 * Draw the application icon into `src-tauri/icons/`.
 *
 *   node tools/icons.js
 *
 * The mark is the same one `index.html` carries as its favicon — the dark
 * rounded square, the Hitachi red upright, the blue and green bars — so the
 * taskbar, the browser tab and the installer all show one logo. It is drawn
 * here in code rather than committed as a set of binaries for two reasons: the
 * colours stay legible next to `css/tokens.css`, and changing the mark is an
 * edit rather than a round trip through a design tool nobody has installed.
 *
 * PNG and ICO are both written with nothing but Node's `zlib`, which is why this
 * runs on a bare container. Windows has read PNG-compressed ICO entries since
 * Vista, so the .ico is simply the PNGs in a container.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src-tauri', 'icons');

/** The mark, on a 32×32 grid — the same geometry as the favicon in index.html. */
const GRID = 32;
const SHAPES = [
  { x: 0, y: 0, w: 32, h: 32, r: 7, color: '#111827' },
  { x: 6, y: 7, w: 4, h: 18, r: 2, color: '#e60012' },
  { x: 13, y: 10, w: 13, h: 4, r: 2, color: '#5b93f5' },
  { x: 13, y: 18, w: 8, h: 4, r: 2, color: '#16a571' },
];

/** What Tauri and the installers ask for. */
const PNG_SIZES = [32, 128, 256, 512];
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

const SAMPLES = 4; // per axis, so 16 samples a pixel — enough at these sizes

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** True when a point is inside a rounded rectangle. */
function inside(px, py, s) {
  if (px < s.x || py < s.y || px > s.x + s.w || py > s.y + s.h) return false;
  const r = Math.min(s.r, s.w / 2, s.h / 2);
  const cx = Math.min(Math.max(px, s.x + r), s.x + s.w - r);
  const cy = Math.min(Math.max(py, s.y + r), s.y + s.h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** RGBA pixels for one size, supersampled and composited in order. */
function draw(size) {
  const scale = GRID / size;
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (const shape of SHAPES) {
        let hits = 0;
        for (let sy = 0; sy < SAMPLES; sy++) {
          for (let sx = 0; sx < SAMPLES; sx++) {
            const px = (x + (sx + 0.5) / SAMPLES) * scale;
            const py = (y + (sy + 0.5) / SAMPLES) * scale;
            if (inside(px, py, shape)) hits++;
          }
        }
        if (!hits) continue;
        const cover = hits / (SAMPLES * SAMPLES);
        const [sr, sg, sb] = rgb(shape.color);
        // Source-over, with colours kept straight rather than premultiplied.
        const outA = cover + a * (1 - cover);
        if (outA > 0) {
          r = (sr * cover + r * a * (1 - cover)) / outA;
          g = (sg * cover + g * a * (1 - cover)) / outA;
          b = (sb * cover + b * a * (1 - cover)) / outA;
        }
        a = outA;
      }

      const at = (y * size + x) * 4;
      pixels[at] = Math.round(r);
      pixels[at + 1] = Math.round(g);
      pixels[at + 2] = Math.round(b);
      pixels[at + 3] = Math.round(a * 255);
    }
  }
  return pixels;
}

/* ── PNG ────────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // no filter beyond the per-row byte
  header[12] = 0; // no interlace

  // One filter byte per row, filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── ICO ────────────────────────────────────────────────────────────────── */

function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;

  entries.forEach((entry, index) => {
    const at = index * 16;
    directory[at] = entry.size >= 256 ? 0 : entry.size; // 0 means 256
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 2] = 0; // palette
    directory[at + 3] = 0; // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.data)]);
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  for (const size of PNG_SIZES) {
    const data = png(size, draw(size));
    const name = size === 512 ? 'icon.png' : `${size}x${size}.png`;
    fs.writeFileSync(path.join(OUT, name), data);
    console.log(`✓ icons/${name} — ${(data.length / 1024).toFixed(1)} kB`);
  }

  const entries = ICO_SIZES.map((size) => ({ size, data: png(size, draw(size)) }));
  const bundle = ico(entries);
  fs.writeFileSync(path.join(OUT, 'icon.ico'), bundle);
  console.log(`✓ icons/icon.ico — ${ICO_SIZES.join(', ')} px, ${(bundle.length / 1024).toFixed(1)} kB`);
}

main();
