/**
 * Export orchestration.
 *
 * Every format is produced from the same source of truth — the live document
 * plus the active filters — so a CSV, an SVG and a PDF exported one after the
 * other always describe the same plan.
 *
 * Imports: util, dates, model, store, query, scene, svg, pdf, components.
 */

import { download, slug, stripHtml } from '../core/util.js';
import { toISO, fmtDate } from '../core/dates.js';
import { TYPES, STATUSES, statusOf, subsystemOf, durationDays, projectExtent, effectiveToday, LINK_TYPES } from '../core/model.js';
import { getDoc, getFilters, hasActiveFilters, activeBaseline } from '../core/store.js';
import { filterPredicate } from '../core/query.js';
import { compareBaseline, criticalPath } from '../core/analysis.js';
import { buildScene, resolvePalette } from './scene.js';
import { sceneToSvg, svgToRaster } from './svg.js';
import { sceneToPdf, PAGE_SIZES } from './pdf.js';
import { toast } from '../ui/components.js';

/** Filename stem shared by every export of the same project. */
function stem(doc, suffix = '') {
  return `${slug(doc.name) || 'cx-timeline'}${suffix}-${toISO(Date.now())}`;
}

/** The predicate to apply — respects the filter panel unless told otherwise. */
function predicateFor({ respectFilters = true } = {}) {
  if (!respectFilters || !hasActiveFilters()) return null;
  return filterPredicate(getDoc(), getFilters());
}

/* ══════════════════════════════════════════════════════════════════════════
   JSON — the project file
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Export the whole document. This is the canonical save format: importing it
 * restores the project exactly, including lanes, links, baselines and notes.
 * Attachment *bytes* stay in local storage; the records are exported so a
 * re-import knows what was attached.
 */
export function exportJson({ pretty = true } = {}) {
  const doc = getDoc();
  const payload = {
    ...doc,
    exported: {
      at: new Date().toISOString(),
      application: 'CX Timeline',
      note: 'Attachment file contents are stored in the browser and are not included in this file.',
    },
  };
  download(`${stem(doc)}.json`, JSON.stringify(payload, null, pretty ? 2 : 0), 'application/json');
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
   CSV
   ═══════════════════════════════════════════════════════════════════════ */

const CSV_COLUMNS = [
  ['id', (o) => o.id],
  ['type', (o) => TYPES[o.type]?.label || o.type],
  ['title', (o) => o.title],
  ['subtitle', (o) => o.subtitle],
  ['lane', (o, ctx) => ctx.laneNames.get(o.lane) || ''],
  ['start', (o) => toISO(o.start)],
  ['finish', (o) => (TYPES[o.type]?.duration ? toISO(o.end) : toISO(o.start))],
  ['duration_days', (o) => (TYPES[o.type]?.duration ? durationDays(o) : 0)],
  ['status', (o) => statusOf(o.status).label],
  ['percent_complete', (o) => o.progress ?? 0],
  ['owner', (o) => o.owner],
  ['subsystem', (o) => subsystemOf(o.subsystem)?.label || o.subsystem],
  ['area', (o) => o.area],
  ['tags', (o) => (o.tags || []).join('; ')],
  ['version', (o) => o.data?.version || ''],
  ['release_number', (o) => o.data?.releaseNumber || ''],
  ['build_number', (o) => o.data?.buildNumber || ''],
  ['test_package', (o) => o.data?.testPackage || ''],
  ['test_type', (o) => o.data?.testKind || ''],
  ['severity', (o) => o.data?.severity || ''],
  ['reference', (o) => o.data?.reference || ''],
  ['actual_start', (o) => o.data?.actualStart || ''],
  ['actual_finish', (o) => o.data?.actualEnd || ''],
  ['predecessors', (o, ctx) => (ctx.preds.get(o.id) || []).join('; ')],
  ['critical', (o, ctx) => (ctx.critical.has(o.id) ? 'yes' : 'no')],
  ['total_float_days', (o, ctx) => (ctx.floats.has(o.id) ? ctx.floats.get(o.id) : '')],
  ['notes', (o) => stripHtml(o.notes)],
];

export function exportCsv(opts = {}) {
  const doc = getDoc();
  const predicate = predicateFor(opts);
  const objects = doc.objects.filter((o) => !predicate || predicate(o));

  const analysis = criticalPath(doc);
  const laneNames = new Map(doc.lanes.map((l) => [l.id, l.name]));
  const titles = new Map(doc.objects.map((o) => [o.id, o.title]));
  const preds = new Map();
  for (const link of doc.links) {
    if (!preds.has(link.to)) preds.set(link.to, []);
    const spec = LINK_TYPES[link.type] || LINK_TYPES.FS;
    preds.get(link.to).push(`${titles.get(link.from) || link.from} (${spec.short}${link.lag ? (link.lag > 0 ? '+' : '') + link.lag + 'd' : ''})`);
  }

  const ctx = { laneNames, preds, critical: analysis.critical, floats: analysis.floats };
  const rows = [CSV_COLUMNS.map((c) => c[0])];
  for (const obj of objects) rows.push(CSV_COLUMNS.map(([, fn]) => fn(obj, ctx)));

  download(`${stem(doc)}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  return true;
}

/** Export the dependency list as its own CSV. */
export function exportLinksCsv() {
  const doc = getDoc();
  const titles = new Map(doc.objects.map((o) => [o.id, o.title]));
  const rows = [['from_id', 'from_title', 'to_id', 'to_title', 'type', 'lag_days', 'label']];
  for (const link of doc.links) {
    rows.push([link.from, titles.get(link.from) || '', link.to, titles.get(link.to) || '', link.type, link.lag || 0, link.label || '']);
  }
  download(`${stem(doc, '-dependencies')}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  return true;
}

/** Export the baseline variance report. */
export function exportBaselineCsv() {
  const doc = getDoc();
  const baseline = activeBaseline();
  if (!baseline) {
    toast({ tone: 'warn', title: 'No baseline selected', message: 'Take a baseline first, then export the comparison.' });
    return false;
  }
  const { rows: variance } = compareBaseline(doc, baseline);
  const laneNames = new Map(doc.lanes.map((l) => [l.id, l.name]));
  const rows = [['title', 'lane', 'change', 'baseline_start', 'baseline_finish', 'current_start', 'current_finish', 'start_shift_days', 'finish_shift_days', 'duration_change_days']];
  for (const row of variance) {
    rows.push([
      row.title,
      laneNames.get(row.current?.lane) || '',
      row.change,
      row.baseline ? toISO(row.baseline.start) : '',
      row.baseline?.end ? toISO(row.baseline.end) : '',
      row.current ? toISO(row.current.start) : '',
      row.current && TYPES[row.current.type]?.duration ? toISO(row.current.end) : '',
      row.startShift,
      row.endShift,
      row.durationChange,
    ]);
  }
  download(`${stem(doc, '-baseline')}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  return true;
}

/** RFC 4180 quoting, with a BOM so Excel opens UTF-8 correctly. */
function toCsv(rows) {
  const body = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell == null ? '' : String(cell);
          return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(',')
    )
    .join('\r\n');
  return '﻿' + body;
}

/* ══════════════════════════════════════════════════════════════════════════
   Vector & raster images
   ═══════════════════════════════════════════════════════════════════════ */

/** Build the export scene once, for whichever backend needs it. */
function makeScene(opts = {}) {
  const doc = getDoc();
  return buildScene(doc, {
    filter: predicateFor(opts),
    maxWidth: opts.maxWidth || 2600,
    pxPerDay: opts.pxPerDay,
    range: opts.range,
    showGrid: opts.showGrid !== false,
    showLinks: opts.showLinks !== false,
    showToday: opts.showToday !== false,
    showLegend: opts.showLegend !== false,
    palette: opts.palette,
  });
}

export function exportSvg(opts = {}) {
  const doc = getDoc();
  const scene = makeScene(opts);
  const svg = sceneToSvg(scene, {
    title: doc.name,
    description: [doc.client, doc.programme, doc.description].filter(Boolean).join(' — '),
  });
  download(`${stem(doc)}.svg`, svg, 'image/svg+xml;charset=utf-8');
  return true;
}

export async function exportRaster({ type = 'image/png', scale = 2, ...opts } = {}) {
  const doc = getDoc();
  const scene = makeScene(opts);
  const svg = sceneToSvg(scene, { title: doc.name });

  try {
    const blob = await svgToRaster(svg, {
      scale,
      type,
      width: scene.width,
      height: scene.height,
      background: type === 'image/jpeg' ? scene.meta.palette.bg : null,
    });
    const ext = type === 'image/jpeg' ? 'jpg' : 'png';
    download(`${stem(doc)}.${ext}`, blob, type);
    return true;
  } catch (err) {
    toast({ tone: 'bad', title: 'Image export failed', message: err.message });
    return false;
  }
}

export const exportPng = (opts) => exportRaster({ ...opts, type: 'image/png' });
export const exportJpeg = (opts) => exportRaster({ ...opts, type: 'image/jpeg', scale: opts?.scale ?? 2 });

/* ══════════════════════════════════════════════════════════════════════════
   PDF
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * High-quality vector PDF, landscape, tiled across pages when the programme
 * is wider than one sheet.
 */
export function exportPdf(opts = {}) {
  const doc = getDoc();
  const scene = makeScene({ ...opts, maxWidth: opts.maxWidth || pdfSceneWidth(opts) });

  try {
    const blob = sceneToPdf(scene, {
      pageSize: opts.pageSize || 'a3',
      multiPage: opts.multiPage !== false,
      title: doc.name,
      subtitle: [doc.client, doc.programme].filter(Boolean).join('  ·  '),
      author: doc.client || 'CX Timeline',
    });
    download(`${stem(doc)}.pdf`, blob, 'application/pdf');
    return true;
  } catch (err) {
    console.error('[cx-timeline] PDF export failed:', err);
    toast({ tone: 'bad', title: 'PDF export failed', message: err.message });
    return false;
  }
}

/**
 * Choose a scene width for PDF so bars stay readable: roughly one page's
 * worth of drawing per month of plan at the default density.
 */
function pdfSceneWidth(opts) {
  const doc = getDoc();
  const extent = opts.range ? { start: opts.range[0], end: opts.range[1] } : projectExtent(doc);
  const days = Math.max(1, (extent.end - extent.start) / 86_400_000);
  const density = opts.density || 'normal';
  const pxPerDay = density === 'fine' ? 6 : density === 'coarse' ? 1.4 : 3;
  return 168 + days * pxPerDay + 24;
}

/* ══════════════════════════════════════════════════════════════════════════
   Print
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Open the browser print dialog against a purpose-built print document.
 *
 * Rather than trying to coerce the interactive canvas through a print
 * stylesheet, we render the export scene as SVG into a hidden iframe. What
 * the printer receives is exactly what the SVG/PDF exports contain, which is
 * why "Print → Save as PDF" and "Export PDF" agree with each other.
 */
export function printPlan(opts = {}) {
  const doc = getDoc();
  const scene = makeScene({ ...opts, palette: opts.palette || resolvePalette(printPalette(opts)) });
  const svg = sceneToSvg(scene, { title: doc.name });

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeAttr(doc.name)}</title>
<style>
  @page { size: ${opts.pageSize === 'a4' ? 'A4' : 'A3'} landscape; margin: 10mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  svg { width: 100%; height: auto; display: block; }
</style></head><body>${svg}</body></html>`;

  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch (err) {
      toast({ tone: 'bad', title: 'Could not open the print dialog', message: err.message });
    }
    // Leave the frame in place long enough for the dialog to read it.
    setTimeout(() => frame.remove(), 60_000);
  };

  frame.srcdoc = html;
  return true;
}

/** Printing on white paper: force light surfaces regardless of the theme. */
function printPalette(opts) {
  if (opts.keepTheme) return {};
  return {
    bg: '#ffffff',
    surface: '#ffffff',
    chrome: '#ffffff',
    text: '#101318',
    textMuted: '#4b5563',
    textSubtle: '#6b7280',
    border: '#c8cdd6',
    grid: '#e8eaee',
    gridMajor: '#c9ced7',
    weekend: '#f4f5f7',
  };
}

function escapeAttr(text) {
  return String(text || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

/** Page-size options offered by the export dialog. */
export const PDF_PAGE_SIZES = Object.entries(PAGE_SIZES).map(([id, s]) => ({ value: id, label: s.label }));
