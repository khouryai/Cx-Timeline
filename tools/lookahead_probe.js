#!/usr/bin/env node
/**
 * Look-ahead probe — the phase 0 spike, as a tool rather than a throwaway.
 *
 * The four-week look-ahead encodes shift access in **cell fill colour**, so
 * before any of the ingestion design can be committed to, four things have to
 * be known about the real file, and none of them can be guessed:
 *
 *   1. Are the colours static fills, or conditional formatting? A colour that
 *      comes from a CF rule is not in the cell's style at all, and reading it
 *      means evaluating the rules instead — a different order of problem.
 *   2. Are they literal RGB, theme+tint, or legacy indexed? All three resolve
 *      to a number differently, and only the first is trivial.
 *   3. Is a shift one cell per day, or one merged cell across several?
 *   4. Which sheet, and how much of it survives "visible rows only"?
 *
 * This prints the answers. It reads the file the same way the application
 * will — ZIP, DEFLATE, sheet XML, `xl/styles.xml` — but through node:zlib
 * rather than `src/io/inflate.js`, because it runs in Node and has no browser
 * to answer to.
 *
 * Nothing here is imported by the application. It is a measuring instrument,
 * and it is allowed to be chatty.
 *
 * Usage:
 *   node tools/lookahead_probe.js <file.xlsx> [--sheet "Name"] [--json out.json]
 *   node tools/lookahead_probe.js <file.xlsx> --sheets      # just list the tabs
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ══════════════════════════════════════════════════════════════════════════
   ZIP
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Read a ZIP container into `name -> Buffer`.
 *
 * Walks the central directory rather than scanning for local headers, because
 * only the central directory is authoritative about what the archive contains.
 */
function readZip(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('Not a ZIP archive (no end-of-central-directory record).');

  let count = buf.readUInt16LE(eocd + 10);
  let dirOffset = buf.readUInt32LE(eocd + 16);

  // Zip64 — only reached by archives past the 4 GB / 65535-entry limits. An
  // .xlsx that large is a different problem, so say so rather than misread it.
  if (count === 0xffff || dirOffset === 0xffffffff) {
    const z64 = locateZip64(buf, eocd);
    if (z64 < 0) throw new Error('Archive needs Zip64 and the locator is missing.');
    count = Number(buf.readBigUInt64LE(z64 + 32));
    dirOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }

  const files = new Map();
  let at = dirOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break;
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);

    files.set(name, { method, compressed, localAt });
    at += 46 + nameLen + extraLen + commentLen;
  }

  const out = new Map();
  for (const [name, entry] of files) {
    // The local header repeats the name and carries its own extra field, whose
    // length routinely differs from the central one — so it must be re-read.
    const localNameLen = buf.readUInt16LE(entry.localAt + 26);
    const localExtraLen = buf.readUInt16LE(entry.localAt + 28);
    const start = entry.localAt + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(start, start + entry.compressed);
    out.set(name, entry.method === 0 ? raw : zlib.inflateRawSync(raw));
  }
  return out;
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function locateZip64(buf, eocd) {
  for (let i = eocd - 20; i >= 0 && i > eocd - 100; i--) {
    if (buf.readUInt32LE(i) === 0x07064b50) return Number(buf.readBigUInt64LE(i + 8));
  }
  return -1;
}

const text = (files, name) => (files.has(name) ? files.get(name).toString('utf8') : '');

/* ══════════════════════════════════════════════════════════════════════════
   Colour resolution
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The legacy 56-entry palette an `indexed="n"` fill refers to. Excel still
 * writes these for anything that came from an older file, so a parser that
 * only understands `rgb=` will silently see nothing on exactly those cells.
 */
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

/** `theme="n"` indexes the clrScheme, but with dk/lt swapped in pairs. */
const THEME_ORDER = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

function readTheme(xml) {
  const scheme = /<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml)?.[1] || '';
  const colors = {};
  for (const m of scheme.matchAll(/<a:(\w+)>([\s\S]*?)<\/a:\1>/g)) {
    const [, key, body] = m;
    const srgb = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(body)?.[1];
    const sys = /<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(body)?.[1];
    if (srgb || sys) colors[key] = (srgb || sys).toUpperCase();
  }
  return THEME_ORDER.map((key) => colors[key] || null);
}

/**
 * Apply an OOXML tint to a colour, in HLS space as the specification requires.
 * Doing it naively in RGB gives visibly different values, which for a parser
 * keyed on exact colours means a miss.
 */
function applyTint(hex, tint) {
  if (!tint) return hex;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let lum = (max + min) / 2;
  let hue = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = lum > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / d + 2) / 6;
    else hue = ((r - g) / d + 4) / 6;
  }

  lum = tint < 0 ? lum * (1 + tint) : lum * (1 - tint) + (1 - (1 - tint));
  lum = Math.min(1, Math.max(0, lum));

  const hueToRgb = (p, q, t) => {
    let u = t;
    if (u < 0) u += 1;
    if (u > 1) u -= 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };

  let out;
  if (sat === 0) {
    out = [lum, lum, lum];
  } else {
    const q = lum < 0.5 ? lum * (1 + sat) : lum + sat - lum * sat;
    const p = 2 * lum - q;
    out = [hueToRgb(p, q, hue + 1 / 3), hueToRgb(p, q, hue), hueToRgb(p, q, hue - 1 / 3)];
  }
  return out.map((v) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
}

/**
 * Build `styleIndex -> { hex, source }` for every cell format in the workbook.
 *
 * The chain is `cellXfs[s].fillId -> fills[id].patternFill.fgColor`, and the
 * colour at the end of it arrives in one of three notations. Which one it is,
 * is the whole question this tool exists to answer.
 */
function readFills(stylesXml, theme) {
  const fillsBlock = /<fills[^>]*>([\s\S]*?)<\/fills>/.exec(stylesXml)?.[1] || '';
  const fills = (fillsBlock.match(/<fill>[\s\S]*?<\/fill>/g) || []).map((fill) => {
    const pattern = /patternType="(\w+)"/.exec(fill)?.[1] || 'none';
    if (pattern === 'none') return { hex: null, source: 'none', pattern };

    const fg = /<fgColor([^>]*)\/>/.exec(fill)?.[1] || '';
    const tint = parseFloat(/tint="(-?[\d.]+)"/.exec(fg)?.[1] || '0') || 0;

    const rgb = /rgb="([0-9A-Fa-f]{6,8})"/.exec(fg)?.[1];
    if (rgb) {
      const base = rgb.length === 8 ? rgb.slice(2) : rgb;
      return { hex: applyTint(base.toUpperCase(), tint), source: 'rgb', pattern, tint };
    }

    const themed = /theme="(\d+)"/.exec(fg)?.[1];
    if (themed != null) {
      const base = theme[parseInt(themed, 10)] || null;
      return {
        hex: base ? applyTint(base, tint) : null,
        source: `theme:${themed}${tint ? ` tint ${tint.toFixed(2)}` : ''}`,
        pattern,
        tint,
      };
    }

    const indexed = /indexed="(\d+)"/.exec(fg)?.[1];
    if (indexed != null) {
      const base = INDEXED[parseInt(indexed, 10)] || null;
      return { hex: base ? applyTint(base, tint) : null, source: `indexed:${indexed}`, pattern, tint };
    }

    return { hex: null, source: 'unresolved', pattern };
  });

  const xfsBlock = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] || '';
  const xfs = xfsBlock.match(/<xf[\s\S]*?(?:\/>|<\/xf>)/g) || [];
  return xfs.map((xf) => {
    const fillId = parseInt(/fillId="(\d+)"/.exec(xf)?.[1] ?? '0', 10);
    return fills[fillId] || { hex: null, source: 'none', pattern: 'none' };
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Workbook structure
   ═══════════════════════════════════════════════════════════════════════ */

function readSheets(files) {
  const workbook = text(files, 'xl/workbook.xml');
  const rels = text(files, 'xl/_rels/workbook.xml.rels');
  const sheets = [];

  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const name = decodeXml(/name="([^"]*)"/.exec(attrs)?.[1] || '');
    const rid = /r:id="([^"]+)"/.exec(attrs)?.[1] || '';
    const state = /state="(\w+)"/.exec(attrs)?.[1] || 'visible';

    let target = '';
    if (rid) {
      const rel = new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels);
      if (rel) target = rel[1].replace(/^\/?xl\//, '').replace(/^\//, '');
    }
    const zipPath = target && files.has(`xl/${target}`) ? `xl/${target}` : '';
    sheets.push({ name, state, zipPath });
  }
  return sheets;
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, '&');
}

/** 'A' -> 1, 'AA' -> 27. One-based, to match how a spreadsheet talks. */
function colNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function colLetters(n) {
  let out = '';
  let v = n;
  while (v > 0) {
    const rem = (v - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    v = Math.floor((v - 1) / 26);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   The sheet
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Rows and cells, matched as *either* a self-closing tag or an open/close pair.
 *
 * The obvious `/<row[\s\S]*?(?:\/>|<\/row>)/` is wrong, and wrong in a way that
 * only shows up on a sheet like this one. A cell that carries a fill but no
 * value is written `<c r="D2" s="1"/>`, and the lazy match stops at that first
 * `/>` — truncating the row and dropping every cell after it. Files full of
 * *values* never hit it, because those cells close with `</c>`; a file full of
 * *colours* hits it on nearly every row.
 *
 * `src/io/importers.js` has the same pattern today. It has been harmless there
 * because spreadsheets imported as data have values in their cells — but it
 * would silently eat the look-ahead.
 */
const ROW_RE = /<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g;
const CELL_RE = /<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g;

function probeSheet(sheetXml, styleFills, sharedStrings) {
  /* Hidden columns. One column per day means a hidden one silently removes a
     day from a week — worse than a hidden row, because nothing looks wrong. */
  const hiddenCols = [];
  const colsBlock = /<cols[^>]*>([\s\S]*?)<\/cols>/.exec(sheetXml)?.[1] || '';
  for (const m of colsBlock.matchAll(/<col\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    if (!/hidden="1"/.test(attrs)) continue;
    hiddenCols.push({
      min: parseInt(/min="(\d+)"/.exec(attrs)?.[1] ?? '0', 10),
      max: parseInt(/max="(\d+)"/.exec(attrs)?.[1] ?? '0', 10),
    });
  }
  const hiddenColSet = new Set();
  for (const range of hiddenCols) {
    for (let c = range.min; c <= range.max; c++) hiddenColSet.add(c);
  }

  /* Merged ranges. */
  const merges = [];
  const mergeBlock = /<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/.exec(sheetXml)?.[1] || '';
  for (const m of mergeBlock.matchAll(/<mergeCell[^>]*ref="([^"]+)"/g)) merges.push(m[1]);

  /* Conditional formatting — the finding that would change the design. */
  const cfRanges = [];
  let cfRules = 0;
  for (const m of sheetXml.matchAll(/<conditionalFormatting[^>]*sqref="([^"]+)"[^>]*>([\s\S]*?)<\/conditionalFormatting>/g)) {
    cfRanges.push(m[1]);
    cfRules += (m[2].match(/<cfRule\b/g) || []).length;
  }

  /* Rows and cells. */
  const rows = [];
  const colourCensus = new Map();
  let visibleRows = 0;
  let hiddenRows = 0;
  let maxCol = 0;

  // Match a self-closing row, OR an open tag through its close tag — never
  // `[\s\S]*?(?:\/>|<\/row>)`, which stops at the first `/>` it meets and that
  // is routinely *inside* the row, on the first fill-only cell. See ROW_RE note.
  for (const rowXml of sheetXml.match(ROW_RE) || []) {
    const head = /<row\b([^>]*)>/.exec(rowXml)?.[1] || rowXml;
    const number = parseInt(/\br="(\d+)"/.exec(head)?.[1] ?? '0', 10);
    const hidden = /hidden="1"/.test(head);
    if (hidden) hiddenRows++;
    else visibleRows++;

    const cells = [];
    for (const cellXml of rowXml.match(CELL_RE) || []) {
      const ref = /\br="([A-Z]+)(\d+)"/.exec(cellXml);
      if (!ref) continue;
      const col = colNumber(ref[1]);
      maxCol = Math.max(maxCol, col);

      const styleIndex = parseInt(/\bs="(\d+)"/.exec(cellXml)?.[1] ?? '-1', 10);
      const fill = styleIndex >= 0 ? styleFills[styleIndex] : null;
      const type = /\bt="([^"]+)"/.exec(cellXml)?.[1];

      let value = '';
      const raw = /<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1];
      if (type === 'inlineStr') {
        value = (cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((p) => decodeXml(p.replace(/<[^>]+>/g, ''))).join('');
      } else if (raw != null) {
        value = type === 's' ? (sharedStrings[parseInt(raw, 10)] ?? '') : decodeXml(raw);
      }

      cells.push({ col, ref: ref[0].slice(3, -1) || `${ref[1]}${ref[2]}`, value, fill });

      /* Census over what the parser will actually see, keyed on the *resolved*
         colour rather than on how it was written. Two notations reaching the
         same colour are one legend entry, not two — a legend keyed on notation
         would split them and mis-map one of the halves. */
      if (!hidden && !hiddenColSet.has(col) && fill && fill.hex) {
        const seen = colourCensus.get(fill.hex) || { hex: fill.hex, count: 0, notations: new Set(), samples: [] };
        seen.count++;
        seen.notations.add(fill.source);
        if (seen.samples.length < 4) seen.samples.push(`${ref[1]}${ref[2]}`);
        colourCensus.set(fill.hex, seen);
      }
    }
    rows.push({ number, hidden, cells });
  }

  return { rows, visibleRows, hiddenRows, hiddenCols, hiddenColSet, merges, cfRanges, cfRules, colourCensus, maxCol };
}

/* ══════════════════════════════════════════════════════════════════════════
   Report
   ═══════════════════════════════════════════════════════════════════════ */

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: node tools/lookahead_probe.js <file.xlsx> [--sheet "Name"] [--json out.json] [--sheets]');
    process.exit(2);
  }
  const wantSheet = args.includes('--sheet') ? args[args.indexOf('--sheet') + 1] : null;
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const listOnly = args.includes('--sheets');

  if (!/\.xlsx$/i.test(file)) {
    console.error(`\n  ${path.basename(file)} is not a .xlsx.`);
    console.error('  The reader handles .xlsx only — .xls and .xlsb are different formats');
    console.error('  entirely. Open it in Excel and "Save As" → Excel Workbook (.xlsx).\n');
    process.exit(2);
  }

  const buf = fs.readFileSync(file);
  const files = readZip(buf);
  const sheets = readSheets(files);

  console.log(`\n  ${path.basename(file)} — ${(buf.length / 1048576).toFixed(1)} MB, ${sheets.length} sheet(s)\n`);
  sheets.forEach((s, i) => {
    const marks = [i === 0 ? 'first' : null, s.state !== 'visible' ? s.state.toUpperCase() : null].filter(Boolean);
    console.log(`    ${String(i + 1).padStart(2)}. ${s.name}${marks.length ? `   [${marks.join(', ')}]` : ''}`);
  });
  if (listOnly) {
    console.log('');
    return;
  }

  const chosen = wantSheet ? sheets.find((s) => s.name === wantSheet) : sheets[0];
  if (!chosen) {
    console.error(`\n  No sheet named "${wantSheet}". Pick one of the names above.\n`);
    process.exit(1);
  }
  if (!chosen.zipPath) {
    console.error(`\n  "${chosen.name}" has no readable worksheet part.\n`);
    process.exit(1);
  }

  const sharedStrings = [];
  const sharedXml = text(files, 'xl/sharedStrings.xml');
  for (const si of sharedXml.match(/<si>[\s\S]*?<\/si>/g) || []) {
    const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    sharedStrings.push(parts.map((p) => decodeXml(p.replace(/<[^>]+>/g, ''))).join(''));
  }

  const theme = readTheme(text(files, 'xl/theme/theme1.xml'));
  const styleFills = readFills(text(files, 'xl/styles.xml'), theme);
  const sheetXml = files.get(chosen.zipPath).toString('utf8');
  const probe = probeSheet(sheetXml, styleFills, sharedStrings);

  const total = probe.visibleRows + probe.hiddenRows;
  const pct = total ? Math.round((probe.visibleRows / total) * 100) : 0;

  console.log(`\n  ── "${chosen.name}" ${chosen.state !== 'visible' ? `(${chosen.state}!) ` : ''}${'─'.repeat(Math.max(0, 46 - chosen.name.length))}\n`);
  console.log(`    Rows            ${total} total · ${probe.visibleRows} visible (${pct}%) · ${probe.hiddenRows} hidden`);
  console.log(`    Columns         ${probe.maxCol} used · ${probe.hiddenColSet.size} hidden`);
  if (probe.hiddenCols.length) {
    const ranges = probe.hiddenCols.map((r) => (r.min === r.max ? colLetters(r.min) : `${colLetters(r.min)}–${colLetters(r.max)}`));
    console.log(`                    ${ranges.join(', ')}`);
  }
  console.log(`    Merged ranges   ${probe.merges.length}${probe.merges.length ? `   e.g. ${probe.merges.slice(0, 5).join(', ')}` : ''}`);

  /* Question 1 — the one that can change the design. */
  console.log('');
  if (probe.cfRules) {
    console.log(`    ⚠  CONDITIONAL FORMATTING — ${probe.cfRules} rule(s) over ${probe.cfRanges.length} range(s)`);
    console.log(`       ${probe.cfRanges.slice(0, 6).join(', ')}${probe.cfRanges.length > 6 ? ' …' : ''}`);
    console.log('');
    console.log('       If the shift colours come from these rules rather than from the');
    console.log('       cells\' own fills, they are NOT readable from the style table and');
    console.log('       the ingestion design in §7 has to change. Compare the ranges above');
    console.log('       against the colour census below: if the census is empty or nearly');
    console.log('       so where you expect colour, the rules are what is painting it.');
  } else {
    console.log('    ✓  No conditional formatting on this sheet.');
    console.log('       Colours are static cell fills, which is the readable case.');
  }

  /* Questions 2 and 3 — the colour census, over visible cells only. */
  const census = [...probe.colourCensus.values()].sort((a, b) => b.count - a.count);
  console.log(`\n    Distinct fill colours on visible cells: ${census.length}\n`);
  if (!census.length) {
    console.log('       None. Either this is the wrong sheet, or the colour is coming');
    console.log('       from conditional formatting rather than from the cells.');
  } else {
    console.log('       count  colour    written as            sample cells');
    console.log('       ─────  ────────  ────────────────────  ────────────────────');
    for (const c of census.slice(0, 30)) {
      const how = [...c.notations].join(' + ');
      console.log(
        `       ${String(c.count).padStart(5)}  #${c.hex}   ${how.padEnd(20)}  ${c.samples.join(' ')}`
      );
      if (c.notations.size > 1) {
        console.log('              ↑ one colour, written two ways — one legend entry, not two');
      }
    }
    if (census.length > 30) console.log(`       … and ${census.length - 30} more`);

    const notations = new Set([...census.flatMap((c) => [...c.notations])].map((s) => s.split(/[: ]/)[0]));
    console.log('');
    console.log(`    Notations in use: ${[...notations].join(', ')}`);
    if (notations.has('theme') || notations.has('indexed')) {
      console.log('       Not all literal RGB — theme and/or indexed colours are present,');
      console.log('       so the parser needs theme1.xml resolution and the legacy palette.');
      console.log('       Both are implemented here and can be lifted straight across.');
    } else {
      console.log('       All literal RGB — the simplest case. Theme and palette');
      console.log('       resolution are not needed for this file as it stands today.');
    }
  }

  /* A cheap look at what a legend might be keyed on. */
  console.log('');
  console.log('    Next: map each colour above to its legend meaning (day shift, night');
  console.log('    shift, cancelled, blanket …). Anything left unmapped must surface for');
  console.log('    manual mapping rather than defaulting — a silent miss lands in evidence.');
  console.log('');

  if (jsonOut) {
    const payload = {
      file: path.basename(file),
      sheets: sheets.map((s) => ({ name: s.name, state: s.state })),
      sheet: chosen.name,
      rows: { total, visible: probe.visibleRows, hidden: probe.hiddenRows },
      columns: { used: probe.maxCol, hidden: [...probe.hiddenColSet] },
      merges: probe.merges,
      conditionalFormatting: { rules: probe.cfRules, ranges: probe.cfRanges },
      colours: census.map((c) => ({ ...c, notations: [...c.notations] })),
    };
    fs.writeFileSync(jsonOut, JSON.stringify(payload, null, 2));
    console.log(`    Written to ${jsonOut}\n`);
  }
}

main();
