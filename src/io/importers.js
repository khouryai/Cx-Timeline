/**
 * Import.
 *
 * Four routes in: the application's own JSON, generic CSV/TSV, Microsoft
 * Project's CSV export, and `.xlsx` workbooks. Everything converges on one
 * intermediate shape — a list of row objects with normalised column names —
 * so the mapping logic is written once.
 *
 * Nothing is applied to the live document until the caller confirms; every
 * function returns a *result* describing what would be imported, along with
 * any warnings, so the UI can preview it first.
 *
 * Imports: util, dates, model, store, inflate.
 */

import { readFileAsText, readFileAsArrayBuffer, fold } from '../core/util.js';
import { toMs, toISO, MS_DAY, addDays, todayMs } from '../core/dates.js';
import {
  makeProject,
  makeObject,
  makeLane,
  makeLink,
  normalise,
  validate,
  TYPES,
  STATUSES,
  STATUS_IDS,
  SUBSYSTEMS,
  TEST_KINDS,
} from '../core/model.js';
import { getDoc } from '../core/store.js';
import { readZip, zipText } from './inflate.js';

/* ══════════════════════════════════════════════════════════════════════════
   Entry point
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Inspect a file and import it with the right reader.
 * @returns {Promise<{kind:string, doc?:object, objects?:Array, lanes?:Array,
 *                    links?:Array, warnings:string[], errors:string[], summary:string}>}
 */
export async function importFile(file) {
  const name = (file.name || '').toLowerCase();

  try {
    if (name.endsWith('.json')) return await importJsonFile(file);
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return await importXlsxFile(file);
    if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) return await importCsvFile(file);

    // Unknown extension: sniff the content rather than refusing outright.
    const text = await readFileAsText(file);
    if (text.trim().startsWith('{')) return parseJson(text);
    return parseTabular(splitDelimited(text), file.name);
  } catch (err) {
    return { kind: 'error', warnings: [], errors: [err.message], summary: 'Import failed' };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   JSON — a full project
   ═══════════════════════════════════════════════════════════════════════ */

async function importJsonFile(file) {
  return parseJson(await readFileAsText(file));
}

export function parseJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { kind: 'error', warnings: [], errors: [`The file is not valid JSON: ${err.message}`], summary: 'Import failed' };
  }

  const check = validate(parsed);
  if (!check.ok) {
    return { kind: 'error', warnings: check.warnings, errors: check.errors, summary: 'Import failed' };
  }

  const doc = normalise(parsed);
  return {
    kind: 'project',
    doc,
    warnings: check.warnings,
    errors: [],
    summary: `${doc.objects.length} objects across ${doc.lanes.length} lanes, ${doc.links.length} dependencies`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   CSV / TSV
   ═══════════════════════════════════════════════════════════════════════ */

async function importCsvFile(file) {
  const text = await readFileAsText(file);
  return parseTabular(splitDelimited(text), file.name);
}

/**
 * Split delimited text into a matrix, honouring RFC 4180 quoting and
 * auto-detecting the separator (comma, semicolon or tab — European Excel
 * exports use semicolons).
 */
export function splitDelimited(text) {
  const clean = text.replace(/^﻿/, '');
  const sample = clean.slice(0, 4000);
  const counts = {
    ',': (sample.match(/,/g) || []).length,
    ';': (sample.match(/;/g) || []).length,
    '\t': (sample.match(/\t/g) || []).length,
  };
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];

    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/* ── Column mapping ────────────────────────────────────────────────────── */

/**
 * Header aliases. The first match wins, so more specific names come first.
 * Covers our own CSV export, Microsoft Project's CSV, and the column names
 * people actually type into a spreadsheet.
 */
const COLUMN_ALIASES = {
  title: ['title', 'name', 'task name', 'task', 'activity', 'activity name', 'description', 'summary', 'subject'],
  type: ['type', 'object type', 'category', 'kind'],
  lane: ['lane', 'swimlane', 'group', 'workstream', 'discipline', 'resource names', 'resource', 'team', 'phase'],
  start: ['start', 'start date', 'planned start', 'begin', 'from', 'baseline start', 'early start'],
  end: ['finish', 'finish date', 'end', 'end date', 'planned finish', 'to', 'due', 'due date', 'baseline finish', 'early finish'],
  duration: ['duration', 'duration days', 'duration_days', 'days'],
  status: ['status', 'state', 'progress status'],
  progress: ['percent complete', 'percent_complete', '% complete', 'complete', 'progress', 'pct complete'],
  owner: ['owner', 'assigned to', 'assignee', 'responsible', 'engineer', 'lead'],
  subsystem: ['subsystem', 'system', 'sub-system', 'discipline code'],
  area: ['area', 'zone', 'section', 'location', 'site'],
  tags: ['tags', 'labels', 'keywords'],
  notes: ['notes', 'note', 'comments', 'remarks', 'detail'],
  version: ['version', 'sw version', 'software version'],
  releaseNumber: ['release number', 'release_number', 'release no', 'release'],
  buildNumber: ['build number', 'build_number', 'build'],
  testPackage: ['test package', 'test_package', 'package', 'tp'],
  testKind: ['test type', 'test_type', 'test kind'],
  severity: ['severity', 'priority', 'risk level'],
  reference: ['reference', 'ref', 'ticket', 'issue id', 'defect'],
  predecessors: ['predecessors', 'predecessor', 'depends on', 'dependency', 'dependencies'],
  id: ['id', 'unique id', 'uid', 'task id', 'wbs'],
  milestone: ['milestone'],
  outline: ['outline level', 'outline_level', 'level'],
};

/** Map a header row onto our field names. */
function mapHeaders(header) {
  const normalised = header.map((h) => fold(String(h).trim()));
  const mapping = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const index = normalised.indexOf(alias);
      if (index >= 0) {
        mapping[field] = index;
        break;
      }
    }
  }
  return mapping;
}

/**
 * Turn a matrix into importable objects and lanes.
 * @param {string[][]} rows
 * @param {string} sourceName
 */
export function parseTabular(rows, sourceName = 'import') {
  const warnings = [];
  const errors = [];

  if (rows.length < 2) {
    return { kind: 'error', warnings, errors: ['The file has no data rows.'], summary: 'Import failed' };
  }

  const header = rows[0];
  const mapping = mapHeaders(header);

  if (mapping.title == null) {
    return {
      kind: 'error',
      warnings,
      errors: [`No recognisable title column. Expected one of: ${COLUMN_ALIASES.title.join(', ')}. Found: ${header.join(', ')}`],
      summary: 'Import failed',
    };
  }
  if (mapping.start == null) {
    warnings.push('No start-date column found — imported items will start today and be spaced sequentially.');
  }

  const laneNames = new Map(); // lane label -> lane record
  const objects = [];
  const sourceIds = new Map(); // source id -> new object id
  const pendingLinks = [];
  let cursor = todayMs();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (field) => (mapping[field] != null ? String(row[mapping[field]] ?? '').trim() : '');

    const title = get('title');
    if (!title) continue;

    /* Lane */
    const laneLabel = get('lane') || 'Imported';
    if (!laneNames.has(laneLabel)) {
      laneNames.set(laneLabel, makeLane({ name: laneLabel, color: laneColour(laneNames.size) }));
    }
    const lane = laneNames.get(laneLabel);

    /* Dates */
    let start = parseDate(get('start'));
    if (!Number.isFinite(start)) {
      start = cursor;
      cursor = addDays(cursor, 1);
    }

    let end = parseDate(get('end'));
    const durationText = get('duration');
    if (!Number.isFinite(end) && durationText) {
      const days = parseDuration(durationText);
      if (Number.isFinite(days)) end = addDays(start, Math.max(1, Math.round(days)));
    }

    /* Type */
    const isMilestone =
      truthy(get('milestone')) ||
      (Number.isFinite(end) && end === start && !durationText) ||
      /milestone|gate|acceptance/i.test(title);
    const type = resolveType(get('type'), { isMilestone, title });

    if (!Number.isFinite(end)) end = TYPES[type]?.duration ? addDays(start, TYPES[type].defaultDays || 5) : start;
    if (TYPES[type]?.duration && end <= start) end = addDays(start, 1);

    /* Everything else */
    const obj = makeObject({
      type,
      lane: lane.id,
      title,
      start,
      end,
      status: resolveStatus(get('status'), get('progress')),
      progress: parseProgress(get('progress')),
      owner: get('owner'),
      subsystem: resolveSubsystem(get('subsystem')),
      area: get('area'),
      tags: get('tags').split(/[;,|]/).map((t) => t.trim()).filter(Boolean),
      notes: get('notes') ? `<p>${escapeText(get('notes'))}</p>` : '',
      data: pruneEmpty({
        version: get('version'),
        releaseNumber: get('releaseNumber'),
        buildNumber: get('buildNumber'),
        testPackage: get('testPackage'),
        testKind: resolveTestKind(get('testKind')),
        severity: resolveSeverity(get('severity')),
        reference: get('reference'),
      }),
    });

    objects.push(obj);

    const sourceId = get('id');
    if (sourceId) sourceIds.set(sourceId, obj.id);

    const predecessors = get('predecessors');
    if (predecessors) pendingLinks.push({ to: obj.id, spec: predecessors });
  }

  if (!objects.length) {
    return { kind: 'error', warnings, errors: ['No rows contained a usable title.'], summary: 'Import failed' };
  }

  /* Resolve predecessor references — Microsoft Project writes "12FS+3 days". */
  const links = [];
  let unresolved = 0;
  for (const pending of pendingLinks) {
    for (const part of pending.spec.split(/[;,]/)) {
      const match = /^\s*([\w.-]+)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+)?/i.exec(part.trim());
      if (!match) continue;
      const fromId = sourceIds.get(match[1]);
      if (!fromId) {
        unresolved++;
        continue;
      }
      links.push(
        makeLink({
          from: fromId,
          to: pending.to,
          type: (match[2] || 'FS').toUpperCase(),
          lag: match[3] ? parseInt(match[3].replace(/\s+/g, ''), 10) : 0,
        })
      );
    }
  }
  if (unresolved) warnings.push(`${unresolved} predecessor reference(s) pointed at rows that were not imported.`);

  const lanes = Array.from(laneNames.values());
  return {
    kind: 'rows',
    objects,
    lanes,
    links,
    warnings,
    errors,
    summary: `${objects.length} objects, ${lanes.length} lanes, ${links.length} dependencies from ${sourceName}`,
  };
}

/* ── Value coercion ────────────────────────────────────────────────────── */

/** Parse a date cell across the formats spreadsheets actually produce. */
export function parseDate(value) {
  const text = String(value || '').trim();
  if (!text) return NaN;

  // Excel serial number (days since 1899-12-30).
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = parseFloat(text);
    if (serial > 20000 && serial < 80000) return Date.UTC(1899, 11, 30) + Math.round(serial) * MS_DAY;
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);

  // dd/mm/yyyy and mm/dd/yyyy are ambiguous. Day-first wins unless the first
  // number cannot be a day — the format most of the world writes.
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(text);
  if (slash) {
    let [, a, b, y] = slash;
    let day = +a;
    let month = +b;
    if (day > 12 && month <= 12) {
      /* day-first, unambiguous */
    } else if (month > 12 && day <= 12) {
      [day, month] = [month, day];
    }
    let year = +y;
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return Date.UTC(year, month - 1, day);
  }

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return NaN;
}

/** "12 days", "3 wks", "5d", "8h" → days. */
function parseDuration(value) {
  const text = String(value).trim().toLowerCase();
  const match = /^([\d.]+)\s*([a-z]*)/.exec(text);
  if (!match) return NaN;
  const n = parseFloat(match[1]);
  if (!Number.isFinite(n)) return NaN;
  const unit = match[2];
  if (unit.startsWith('w')) return n * 7;
  if (unit.startsWith('mo')) return n * 30.44;
  if (unit.startsWith('h')) return n / 8;
  if (unit.startsWith('m') && unit !== 'mo') return n * 30.44;
  return n;
}

function parseProgress(value) {
  const text = String(value || '').replace('%', '').trim();
  const n = parseFloat(text);
  if (!Number.isFinite(n)) return 0;
  // Spreadsheets store percentages as 0–1 as often as 0–100.
  return n <= 1 && text.includes('.') ? Math.round(n * 100) : Math.round(n);
}

function resolveType(value, { isMilestone, title }) {
  const text = fold(value);
  if (text) {
    for (const [id, def] of Object.entries(TYPES)) {
      if (fold(def.label) === text || id === text) return id;
    }
    if (/release|build|drop/.test(text)) return 'release';
    if (/campaign|commission/.test(text)) return 'campaign';
    if (/risk/.test(text)) return 'risk';
    if (/issue|defect|bug/.test(text)) return 'issue';
    if (/milestone|gate/.test(text)) return 'milestone';
    if (/test/.test(text)) return 'testwindow';
    if (/freeze/.test(text)) return 'freeze';
    if (/outage/.test(text)) return 'outage';
  }
  if (isMilestone) return 'milestone';
  if (/\brelease\b|\bv\d+\.\d+/i.test(title)) return 'release';
  if (/\btest(ing)?\b/i.test(title)) return 'testwindow';
  if (/\bcampaign\b/i.test(title)) return 'campaign';
  return 'activity';
}

function resolveStatus(value, progressText) {
  const text = fold(value);
  if (text) {
    for (const id of STATUS_IDS) {
      if (fold(STATUSES[id].label) === text || id === text) return id;
    }
    if (/complete|done|finish|closed/.test(text)) return 'complete';
    if (/progress|active|started|ongoing|wip/.test(text)) return 'inprogress';
    if (/late|delay|slip|overdue/.test(text)) return 'delayed';
    if (/block|stopped/.test(text)) return 'blocked';
    if (/cancel/.test(text)) return 'cancelled';
    if (/hold|pause/.test(text)) return 'onhold';
    if (/test/.test(text)) return 'testing';
    if (/release/.test(text)) return 'released';
  }
  const progress = parseProgress(progressText);
  if (progress >= 100) return 'complete';
  if (progress > 0) return 'inprogress';
  return 'planned';
}

function resolveSubsystem(value) {
  const text = fold(value);
  if (!text) return '';
  const found = SUBSYSTEMS.find((s) => s.id === text || fold(s.label) === text);
  if (found) return found.id;
  if (/interlock/.test(text)) return 'ixl';
  if (/comm|radio|network/.test(text)) return 'comms';
  if (/train|vehicle|rolling/.test(text)) return 'vehicle';
  if (/scada|supervis/.test(text)) return 'scada';
  if (/wayside|track/.test(text)) return 'wayside';
  return '';
}

function resolveTestKind(value) {
  const text = fold(value);
  if (!text) return '';
  const found = TEST_KINDS.find((t) => t.id === text || fold(t.label) === text);
  return found ? found.id : '';
}

function resolveSeverity(value) {
  const text = fold(value);
  if (!text) return '';
  if (/crit|1|highest|blocker/.test(text)) return 'critical';
  if (/high|2|major/.test(text)) return 'high';
  if (/med|3|moderate|normal/.test(text)) return 'medium';
  if (/low|4|minor/.test(text)) return 'low';
  return '';
}

function truthy(value) {
  return /^(yes|y|true|1|x)$/i.test(String(value || '').trim());
}

function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v) out[k] = v;
  return out;
}

function escapeText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const LANE_COLOURS = ['#5b93f5', '#a855f7', '#16a571', '#e0900b', '#f2555b', '#0ea5e9', '#0d9488', '#f97316', '#818cf8', '#94a3b8'];
function laneColour(index) {
  return LANE_COLOURS[index % LANE_COLOURS.length];
}

/* ══════════════════════════════════════════════════════════════════════════
   XLSX
   ═══════════════════════════════════════════════════════════════════════ */

async function importXlsxFile(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const rows = await readXlsx(buffer);
  if (!rows.length) {
    return { kind: 'error', warnings: [], errors: ['No readable sheet was found in the workbook.'], summary: 'Import failed' };
  }
  const result = parseTabular(rows, file.name);
  result.warnings.unshift('Imported from the first worksheet. Formatting, formulas and charts are not read.');
  return result;
}

/**
 * Read the first worksheet of an xlsx workbook into a matrix.
 * Handles shared strings, inline strings, numbers and dates.
 */
export async function readXlsx(arrayBuffer) {
  const files = await readZip(arrayBuffer);

  /* Shared string table */
  const sharedStrings = [];
  const sharedXml = zipText(files, 'xl/sharedStrings.xml');
  if (sharedXml) {
    for (const si of sharedXml.match(/<si>[\s\S]*?<\/si>/g) || []) {
      // A cell's text can be split across several runs; concatenate them all.
      const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
      sharedStrings.push(parts.map((p) => decodeXml(p.replace(/<[^>]+>/g, ''))).join(''));
    }
  }

  /* Which sheet is first? Fall back to sheet1.xml if the map is missing. */
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbookXml = zipText(files, 'xl/workbook.xml');
  const relsXml = zipText(files, 'xl/_rels/workbook.xml.rels');
  if (workbookXml && relsXml) {
    const firstSheet = /<sheet[^>]*r:id="([^"]+)"/.exec(workbookXml);
    if (firstSheet) {
      const rel = new RegExp(`<Relationship[^>]*Id="${firstSheet[1]}"[^>]*Target="([^"]+)"`).exec(relsXml);
      if (rel) {
        const target = rel[1].replace(/^\/?xl\//, '').replace(/^\//, '');
        if (files.has(`xl/${target}`)) sheetPath = `xl/${target}`;
      }
    }
  }

  const sheetXml = zipText(files, sheetPath);
  if (!sheetXml) return [];

  /* Date-formatted cells need the style table to be recognised as dates. */
  const dateStyles = readDateStyles(zipText(files, 'xl/styles.xml'));

  const rows = [];
  for (const rowXml of sheetXml.match(/<row[\s\S]*?(?:\/>|<\/row>)/g) || []) {
    const cells = [];
    for (const cellXml of rowXml.match(/<c[\s\S]*?(?:\/>|<\/c>)/g) || []) {
      const ref = /r="([A-Z]+)\d+"/.exec(cellXml);
      const column = ref ? columnIndex(ref[1]) : cells.length;
      const type = /t="([^"]+)"/.exec(cellXml)?.[1];
      const styleIndex = /s="(\d+)"/.exec(cellXml)?.[1];

      let value = '';
      if (type === 'inlineStr') {
        value = (cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((p) => decodeXml(p.replace(/<[^>]+>/g, ''))).join('');
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1];
        if (raw != null) {
          if (type === 's') value = sharedStrings[parseInt(raw, 10)] ?? '';
          else if (type === 'str' || type === 'e') value = decodeXml(raw);
          else if (styleIndex != null && dateStyles.has(parseInt(styleIndex, 10))) {
            value = toISO(Date.UTC(1899, 11, 30) + Math.round(parseFloat(raw)) * MS_DAY);
          } else {
            value = decodeXml(raw);
          }
        }
      }

      while (cells.length < column) cells.push('');
      cells[column] = value;
    }
    if (cells.length) rows.push(cells);
  }

  return rows;
}

/** Style indices whose number format is a date/time format. */
function readDateStyles(stylesXml) {
  const dateStyles = new Set();
  if (!stylesXml) return dateStyles;

  // Built-in numeric formats 14–22 and 45–47 are dates/times.
  const builtInDates = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  const customDates = new Set();
  for (const fmt of stylesXml.match(/<numFmt[^>]*\/>/g) || []) {
    const id = /numFmtId="(\d+)"/.exec(fmt)?.[1];
    const code = /formatCode="([^"]*)"/.exec(fmt)?.[1] || '';
    if (id && /[dmyh]/i.test(code) && !/[#0]/.test(code.replace(/\[[^\]]*\]/g, ''))) customDates.add(parseInt(id, 10));
  }

  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] || '';
  const xfs = cellXfs.match(/<xf[\s\S]*?(?:\/>|<\/xf>)/g) || [];
  xfs.forEach((xf, index) => {
    const id = parseInt(/numFmtId="(\d+)"/.exec(xf)?.[1] ?? '0', 10);
    if (builtInDates.has(id) || customDates.has(id)) dateStyles.add(index);
  });

  return dateStyles;
}

/** 'A' → 0, 'B' → 1, 'AA' → 26 … */
function columnIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function decodeXml(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(+code))
    .replace(/&amp;/g, '&');
}

/* ══════════════════════════════════════════════════════════════════════════
   Applying an import
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Turn a row-based import result into a document.
 * `mode` is 'replace' (a new project from the rows) or 'merge' (append the
 * rows to the open project, creating any lanes it needs).
 */
export function buildDocFromRows(result, { mode = 'replace', name = 'Imported plan' } = {}) {
  if (mode === 'merge') {
    const doc = JSON.parse(JSON.stringify(getDoc()));
    const laneByName = new Map(doc.lanes.map((l) => [fold(l.name), l]));
    const laneMap = new Map();

    for (const lane of result.lanes) {
      const existing = laneByName.get(fold(lane.name));
      if (existing) {
        laneMap.set(lane.id, existing.id);
      } else {
        doc.lanes.push(lane);
        doc.laneOrder.push(lane.id);
        laneMap.set(lane.id, lane.id);
      }
    }

    for (const obj of result.objects) {
      obj.lane = laneMap.get(obj.lane) || doc.laneOrder[0];
      doc.objects.push(obj);
    }
    doc.links.push(...result.links);
    return normalise(doc);
  }

  const doc = makeProject(name);
  doc.lanes = result.lanes;
  doc.laneOrder = result.lanes.map((l) => l.id);
  doc.objects = result.objects;
  doc.links = result.links;
  return normalise(doc);
}
