/**
 * PDF backend — a minimal, dependency-free PDF 1.4 writer.
 *
 * Why hand-rolled rather than a library: the drawing this app produces is
 * rectangles, lines, polygons and text, which maps one-to-one onto PDF's own
 * primitives. Writing them directly gives a true vector PDF — selectable
 * text, infinite zoom, a few hundred kilobytes — with no megabyte dependency
 * vendored into a local-first app, and no CDN to be offline from.
 *
 * The writer supports the base-14 fonts (no embedding needed), landscape
 * pages, and horizontal tiling so a multi-year programme spills across pages
 * with the lane gutter repeated on each one.
 *
 * Imports: dates (for the footer stamp).
 */

import { fmtDate } from '../core/dates.js';

/* ── Page sizes in PostScript points (1/72") ───────────────────────────── */
export const PAGE_SIZES = {
  a4: { w: 841.89, h: 595.28, label: 'A4 landscape' },
  a3: { w: 1190.55, h: 841.89, label: 'A3 landscape' },
  a2: { w: 1683.78, h: 1190.55, label: 'A2 landscape' },
  letter: { w: 792, h: 612, label: 'US Letter landscape' },
  tabloid: { w: 1224, h: 792, label: 'US Tabloid landscape' },
};

/* ── Base-14 font metrics (widths per 1000 units, ASCII 32–126) ────────── */
const W_HELVETICA = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_HELVETICA_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

const FONTS = {
  F1: { name: 'Helvetica', widths: W_HELVETICA },
  F2: { name: 'Helvetica-Bold', widths: W_HELVETICA_BOLD },
  F3: { name: 'Courier', widths: null }, // fixed pitch, 600/1000
  F4: { name: 'Courier-Bold', widths: null },
};

/** Width of a string at a given size, in points. */
export function textWidth(text, size, fontKey = 'F1') {
  const font = FONTS[fontKey] || FONTS.F1;
  let units = 0;
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    if (!font.widths) {
      units += 600;
    } else if (code >= 32 && code <= 126) {
      units += font.widths[code - 32];
    } else {
      units += 556; // reasonable stand-in for anything outside the table
    }
  }
  return (units / 1000) * size;
}

/* ── Content-stream builder ────────────────────────────────────────────── */

class Content {
  constructor() {
    this.ops = [];
    this.fill = null;
    this.stroke = null;
    this.lineWidth = null;
    this.dash = null;
  }

  push(op) {
    this.ops.push(op);
    return this;
  }

  save() {
    return this.push('q');
  }

  restore() {
    // Graphics state is restored wholesale, so our cached values are stale.
    this.fill = this.stroke = this.lineWidth = this.dash = null;
    return this.push('Q');
  }

  setFill(color) {
    const rgb = toRgb(color);
    if (!rgb) return this;
    const key = rgb.join(',');
    if (this.fill === key) return this;
    this.fill = key;
    return this.push(`${fmt(rgb[0])} ${fmt(rgb[1])} ${fmt(rgb[2])} rg`);
  }

  setStroke(color) {
    const rgb = toRgb(color);
    if (!rgb) return this;
    const key = rgb.join(',');
    if (this.stroke === key) return this;
    this.stroke = key;
    return this.push(`${fmt(rgb[0])} ${fmt(rgb[1])} ${fmt(rgb[2])} RG`);
  }

  setLineWidth(w) {
    if (this.lineWidth === w) return this;
    this.lineWidth = w;
    return this.push(`${fmt(w)} w`);
  }

  setDash(pattern) {
    const key = pattern ? pattern.join(' ') : '';
    if (this.dash === key) return this;
    this.dash = key;
    return this.push(pattern ? `[${pattern.map(fmt).join(' ')}] 0 d` : '[] 0 d');
  }

  setAlpha(alpha, page) {
    // Constant alpha needs an ExtGState resource; the page collects them.
    if (alpha == null || alpha >= 1) return this;
    const name = page.gsFor(alpha);
    return this.push(`/${name} gs`);
  }

  rect(x, y, w, h) {
    return this.push(`${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re`);
  }

  /** Rounded rectangle via four Bézier corners. */
  roundRect(x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    if (radius <= 0.4) return this.rect(x, y, w, h);
    const k = radius * 0.5523;
    return this.push(`${fmt(x + radius)} ${fmt(y)} m`)
      .push(`${fmt(x + w - radius)} ${fmt(y)} l`)
      .push(`${fmt(x + w - radius + k)} ${fmt(y)} ${fmt(x + w)} ${fmt(y + radius - k)} ${fmt(x + w)} ${fmt(y + radius)} c`)
      .push(`${fmt(x + w)} ${fmt(y + h - radius)} l`)
      .push(`${fmt(x + w)} ${fmt(y + h - radius + k)} ${fmt(x + w - radius + k)} ${fmt(y + h)} ${fmt(x + w - radius)} ${fmt(y + h)} c`)
      .push(`${fmt(x + radius)} ${fmt(y + h)} l`)
      .push(`${fmt(x + radius - k)} ${fmt(y + h)} ${fmt(x)} ${fmt(y + h - radius + k)} ${fmt(x)} ${fmt(y + h - radius)} c`)
      .push(`${fmt(x)} ${fmt(y + radius)} l`)
      .push(`${fmt(x)} ${fmt(y + radius - k)} ${fmt(x + radius - k)} ${fmt(y)} ${fmt(x + radius)} ${fmt(y)} c`)
      .push('h');
  }

  circle(cx, cy, r) {
    const k = r * 0.5523;
    return this.push(`${fmt(cx + r)} ${fmt(cy)} m`)
      .push(`${fmt(cx + r)} ${fmt(cy + k)} ${fmt(cx + k)} ${fmt(cy + r)} ${fmt(cx)} ${fmt(cy + r)} c`)
      .push(`${fmt(cx - k)} ${fmt(cy + r)} ${fmt(cx - r)} ${fmt(cy + k)} ${fmt(cx - r)} ${fmt(cy)} c`)
      .push(`${fmt(cx - r)} ${fmt(cy - k)} ${fmt(cx - k)} ${fmt(cy - r)} ${fmt(cx)} ${fmt(cy - r)} c`)
      .push(`${fmt(cx + k)} ${fmt(cy - r)} ${fmt(cx + r)} ${fmt(cy - k)} ${fmt(cx + r)} ${fmt(cy)} c`)
      .push('h');
  }

  moveTo(x, y) {
    return this.push(`${fmt(x)} ${fmt(y)} m`);
  }

  lineTo(x, y) {
    return this.push(`${fmt(x)} ${fmt(y)} l`);
  }

  text(x, y, string, { size = 9, font = 'F1' } = {}) {
    return this.push('BT')
      .push(`/${font} ${fmt(size)} Tf`)
      .push(`${fmt(x)} ${fmt(y)} Td`)
      .push(`(${escapeText(string)}) Tj`)
      .push('ET');
  }

  clip(x, y, w, h) {
    return this.rect(x, y, w, h).push('W').push('n');
  }

  toString() {
    return this.ops.join('\n');
  }
}

function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  return (Math.round(n * 1000) / 1000).toString();
}

/** '#rrggbb' | 'rgba(...)' | 'rgb(...)' → [r,g,b] in 0..1, or null. */
function toRgb(color) {
  if (!color || color === 'none') return null;
  const value = String(color).trim();

  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length === 8) hex = hex.slice(0, 6);
    if (hex.length !== 6) return null;
    return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255];
  }

  const match = /rgba?\(([^)]+)\)/i.exec(value);
  if (match) {
    const parts = match[1].split(',').map((p) => parseFloat(p));
    if (parts.length >= 3) return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
  }
  return null;
}

/** Opacity carried by an rgba() colour, or 1. */
function alphaOf(color) {
  const match = /rgba\(([^)]+)\)/i.exec(String(color || ''));
  if (!match) return 1;
  const parts = match[1].split(',').map((p) => parseFloat(p));
  return parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1;
}

/** Escape a string for a PDF literal, folding to WinAnsi-safe characters. */
function escapeText(text) {
  return String(text == null ? '' : text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/→/g, '->')
    .replace(/·/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/* ── Page ──────────────────────────────────────────────────────────────── */

class Page {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.content = new Content();
    this.gsStates = new Map(); // alpha -> resource name
  }

  gsFor(alpha) {
    const key = Math.round(alpha * 100) / 100;
    if (!this.gsStates.has(key)) this.gsStates.set(key, `GS${this.gsStates.size}`);
    return this.gsStates.get(key);
  }

  /** Scene y (top-down) → PDF y (bottom-up). */
  flip(y) {
    return this.height - y;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Scene → PDF
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Render an export scene to PDF bytes.
 *
 * @param {object} scene   From `buildScene()`.
 * @param {object} opts
 * @param {string} [opts.pageSize]  Key of PAGE_SIZES.
 * @param {number} [opts.margin]
 * @param {string} [opts.title]
 * @param {string} [opts.subtitle]
 * @param {boolean} [opts.multiPage] Tile horizontally when the plan is wide.
 * @returns {Blob}
 */
export function sceneToPdf(scene, opts = {}) {
  const size = PAGE_SIZES[opts.pageSize] || PAGE_SIZES.a3;
  const margin = opts.margin ?? 26;
  const headerH = 34;
  const footerH = 18;

  const contentW = size.w - margin * 2;
  const contentH = size.h - margin * 2 - headerH - footerH;

  const gutter = scene.meta?.gutter ?? 168;
  const bodyTop = scene.meta?.contentTop != null ? scene.meta.contentTop - 44 : 62;
  const bodyHeight = Math.max(1, scene.height - bodyTop);

  // Fit the full lane stack vertically; allow modest upscaling on short plans.
  const scale = Math.min(contentH / bodyHeight, 1.6);
  const gutterW = gutter * scale;
  const laneW = Math.max(60, contentW - gutterW);
  const sceneSliceW = laneW / scale;

  const timelineSceneW = Math.max(1, scene.width - gutter);
  const pageCount = opts.multiPage === false ? 1 : Math.max(1, Math.ceil(timelineSceneW / sceneSliceW));

  const pages = [];

  for (let p = 0; p < pageCount; p++) {
    const page = new Page(size.w, size.h);
    const c = page.content;
    const offset = gutter + p * sceneSliceW;

    /* Page furniture */
    const palette = scene.meta?.palette || {};
    c.setFill(palette.bg || '#ffffff').rect(0, 0, size.w, size.h).push('f');

    c.setFill(palette.brand || '#e60012').rect(margin, page.flip(margin + 24), 3.5, 20).push('f');
    c.setFill(palette.text || '#111111').text(margin + 10, page.flip(margin + 12), opts.title || 'Timeline', { size: 12, font: 'F2' });
    if (opts.subtitle) {
      c.setFill(palette.textSubtle || '#888888').text(margin + 10, page.flip(margin + 24), opts.subtitle, { size: 7.5, font: 'F3' });
    }

    const stamp = `Page ${p + 1} of ${pageCount}`;
    c.setFill(palette.textSubtle || '#888888').text(
      size.w - margin - textWidth(stamp, 7.5, 'F3'),
      page.flip(margin + 12),
      stamp,
      { size: 7.5, font: 'F3' }
    );

    const footer = `CX Timeline  ·  exported ${fmtDate(Date.now(), 'medium')}`;
    c.setFill(palette.textSubtle || '#888888').text(margin, margin - 6 + 4, footer, { size: 6.5, font: 'F3' });

    const bodyY = margin + headerH; // scene-space top of the drawing area

    /* Lane gutter column — repeated on every page */
    c.save();
    c.clip(margin, page.flip(bodyY + contentH), gutterW, contentH);
    drawItems(c, page, scene.items, {
      scale,
      tx: margin,
      ty: bodyY,
      sceneOffsetX: 0,
      sceneOffsetY: bodyTop,
    });
    c.restore();

    /* Timeline column */
    c.save();
    c.clip(margin + gutterW, page.flip(bodyY + contentH), laneW, contentH);
    drawItems(c, page, scene.items, {
      scale,
      tx: margin + gutterW,
      ty: bodyY,
      sceneOffsetX: offset,
      sceneOffsetY: bodyTop,
      minSceneX: gutter,
    });
    c.restore();

    /* Column rule */
    c.setStroke(palette.border || '#cccccc').setLineWidth(0.6);
    c.moveTo(margin + gutterW, page.flip(bodyY)).lineTo(margin + gutterW, page.flip(bodyY + contentH)).push('S');

    pages.push(page);
  }

  return assemble(pages, opts);
}

/**
 * Emit scene items into a page's content stream under a transform.
 * `minSceneX` drops gutter-only furniture from the timeline column.
 */
function drawItems(c, page, items, { scale, tx, ty, sceneOffsetX, sceneOffsetY, minSceneX = null }) {
  const X = (x) => tx + (x - sceneOffsetX) * scale;
  const Y = (y) => page.flip(ty + (y - sceneOffsetY) * scale);
  const S = (v) => v * scale;

  for (const item of items) {
    // Skip anything above the body region (page furniture handles the header).
    const topY = item.y ?? item.y1 ?? item.cy ?? 0;
    if (topY < sceneOffsetY - 24) continue;

    if (minSceneX != null) {
      const itemX = item.x ?? item.x1 ?? item.cx ?? 0;
      if (itemX < minSceneX - 4 && item.type !== 'rect') continue;
    }

    const alpha = Math.min(item.opacity ?? 1, alphaOf(item.fill));
    const needsAlpha = alpha < 1;
    if (needsAlpha) c.save().setAlpha(alpha, page);

    switch (item.type) {
      case 'rect': {
        if (!(item.w > 0 && item.h > 0)) break;
        const x = X(item.x);
        const y = Y(item.y + item.h);
        const w = S(item.w);
        const h = S(item.h);
        if (item.radius) c.roundRect(x, y, w, h, S(item.radius));
        else c.rect(x, y, w, h);
        paint(c, item);
        break;
      }

      case 'line': {
        if (!item.stroke) break;
        c.setStroke(item.stroke).setLineWidth(Math.max(0.25, S(item.strokeWidth || 1))).setDash(item.dash ? item.dash.map(S) : null);
        c.moveTo(X(item.x1), Y(item.y1)).lineTo(X(item.x2), Y(item.y2)).push('S');
        break;
      }

      case 'circle': {
        c.circle(X(item.cx), Y(item.cy), S(item.r));
        paint(c, item);
        break;
      }

      case 'polygon': {
        if (!item.points?.length) break;
        c.moveTo(X(item.points[0][0]), Y(item.points[0][1]));
        for (let i = 1; i < item.points.length; i++) c.lineTo(X(item.points[i][0]), Y(item.points[i][1]));
        c.push('h');
        paint(c, item);
        break;
      }

      case 'path': {
        emitPath(c, item.d, X, Y);
        paint(c, item);
        break;
      }

      case 'text': {
        const size = S(item.size || 9);
        if (size < 3.4) break; // below this the label is unreadable noise
        const font = item.family === 'mono' ? (item.weight >= 700 ? 'F4' : 'F3') : item.weight >= 600 ? 'F2' : 'F1';
        let x = X(item.x);
        if (item.anchor === 'middle') x -= textWidth(item.text, size, font) / 2;
        else if (item.anchor === 'end') x -= textWidth(item.text, size, font);
        c.setFill(item.fill || '#000000').text(x, Y(item.y), item.text, { size, font });
        break;
      }

      default:
        break;
    }

    if (needsAlpha) c.restore();
  }
}

function paint(c, item) {
  const hasFill = item.fill && item.fill !== 'none';
  const hasStroke = item.stroke && item.stroke !== 'none' && item.strokeWidth !== 0;
  if (hasFill) c.setFill(item.fill);
  if (hasStroke) c.setStroke(item.stroke).setLineWidth(Math.max(0.25, item.strokeWidth || 1));
  if (hasFill && hasStroke) c.push('B');
  else if (hasFill) c.push('f');
  else if (hasStroke) c.push('S');
  else c.push('n');
}

/** Translate the subset of SVG path syntax the scene emits into PDF operators. */
function emitPath(c, d, X, Y) {
  const tokens = String(d).match(/[MLC]|-?\d*\.?\d+/gi) || [];
  let i = 0;
  let cmd = 'M';
  while (i < tokens.length) {
    const token = tokens[i];
    if (/[MLC]/i.test(token)) {
      cmd = token.toUpperCase();
      i++;
      continue;
    }
    if (cmd === 'M') {
      c.moveTo(X(+tokens[i]), Y(+tokens[i + 1]));
      i += 2;
      cmd = 'L'; // implicit lineto for subsequent pairs, as in SVG
    } else if (cmd === 'L') {
      c.lineTo(X(+tokens[i]), Y(+tokens[i + 1]));
      i += 2;
    } else if (cmd === 'C') {
      c.push(
        `${fmt(X(+tokens[i]))} ${fmt(Y(+tokens[i + 1]))} ${fmt(X(+tokens[i + 2]))} ${fmt(Y(+tokens[i + 3]))} ${fmt(X(+tokens[i + 4]))} ${fmt(Y(+tokens[i + 5]))} c`
      );
      i += 6;
    } else {
      i++;
    }
  }
}

/* ── File assembly ─────────────────────────────────────────────────────── */

function assemble(pages, opts) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Reserve 1 = catalog, 2 = pages tree.
  objects.push(null, null);

  const fontRefs = {};
  for (const [key, font] of Object.entries(FONTS)) {
    fontRefs[key] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${font.name} /Encoding /WinAnsiEncoding >>`);
  }

  const pageRefs = [];
  for (const page of pages) {
    const stream = page.content.toString();
    const contentRef = add(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`);

    const gsEntries = Array.from(page.gsStates, ([alpha, name]) => {
      const ref = add(`<< /Type /ExtGState /ca ${alpha} /CA ${alpha} >>`);
      return `/${name} ${ref} 0 R`;
    }).join(' ');

    const resources =
      `<< /Font << ${Object.entries(fontRefs).map(([k, ref]) => `/${k} ${ref} 0 R`).join(' ')} >>` +
      (gsEntries ? ` /ExtGState << ${gsEntries} >>` : '') +
      ' >>';

    pageRefs.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(page.width)} ${fmt(page.height)}] /Resources ${resources} /Contents ${contentRef} 0 R >>`));
  }

  const infoRef = add(
    `<< /Title (${escapeText(opts.title || 'CX Timeline')}) /Author (${escapeText(opts.author || 'CX Timeline')}) ` +
      `/Creator (CX Timeline) /Producer (CX Timeline PDF writer) /CreationDate (${pdfDate(new Date())}) >>`
  );

  objects[0] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;

  /* Serialise with a cross-reference table. */
  const chunks = [];
  let offset = 0;
  const offsets = [];

  const write = (text) => {
    chunks.push(text);
    offset += byteLength(text);
  };

  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  objects.forEach((body, i) => {
    offsets[i] = offset;
    write(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  write(xref);
  write(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  // Latin-1 keeps the byte offsets in the xref table honest.
  const bytes = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) bytes[cursor++] = chunk.charCodeAt(i) & 0xff;
  }

  return new Blob([bytes], { type: 'application/pdf' });
}

function byteLength(text) {
  // Content is written as Latin-1, so one char is one byte.
  return text.length;
}

function pdfDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}Z`;
}
