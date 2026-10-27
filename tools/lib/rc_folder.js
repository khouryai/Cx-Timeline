/**
 * The calendar's shared folder, for the suites that drive it in a browser —
 * `smoke_calendar.js` and the suites it calls.
 *
 * The calendar keeps its tables as files under `calendar/` in the folder the
 * plan is in (`core/rc_db.js`). So a suite needs three things, and this is
 * where they are, once:
 *
 *   fixtureRows()   the calendar a suite starts from — a team, places, a
 *                   legend, readings of the look-ahead shaped like the real
 *                   workbook, change events — as rows, by table.
 *   seedFiles()     those rows as the files `core/rc_db.js` itself writes,
 *                   made by running it in Node over a folder in memory, so a
 *                   page opens exactly what the application would have left.
 *   fakeFolder      a folder the page can be given, standing in for the File
 *                   System Access API: nested folders, text and bytes, and a
 *                   modified time that moves on every write — which is what the
 *                   guard reads. Handed to `page.addInitScript()`, so it must
 *                   stay self-contained.
 *
 * And `openCalendar()`, which connects the folder through the calendar's own
 * front door and leaves `window.__rc` pointing at the live database:
 * `__rc.rows` its tables, `__rc.calls` what it was asked.
 */

import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const { createDb } = await import(path.join(ROOT, 'src/core/rc_db.js'));

/** The name the suites go by — on the roster, so `me()` is a person. */
export const ME = 'Alex';

/* ══════════════════════════════════════════════════════════════════════════
   The fixture
   ═══════════════════════════════════════════════════════════════════════ */

const MS_DAY = 86400000;
const iso = (offset) => new Date(Date.now() + offset * MS_DAY).toISOString().slice(0, 10);
const utcToday = () => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};
const mondayOf = (ms) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * MS_DAY;
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * The previous day somebody works — the day the old huddle reviewed. Kept
 * because the readings below were laid out around it, and moving them would
 * move what every check about the look-ahead finds.
 */
function reviewDay() {
  let ms = utcToday();
  do { ms -= MS_DAY; } while ((new Date(ms).getUTCDay() || 7) > 5);
  return { iso: isoOf(ms), dow: new Date(ms).getUTCDay() || 7 };
}

/**
 * The calendar a suite starts from, by table.
 *
 * The same team, places, legend and readings the Supabase stub held, so the
 * checks written against it find what they always found. Called in Node, under
 * the suite's pinned clock (`tools/lib/clock.js`), so its dates agree with the
 * page's.
 */
export function fixtureRows() {
  const REVIEW = reviewDay();
  const todayMs = utcToday();
  const monday = mondayOf(todayMs);
  const first = monday - 7 * MS_DAY;
  const axis = [];
  for (let i = 0; i < 35; i++) axis.push(new Date(first + i * MS_DAY));
  const todayIdx = Math.round((todayMs - first) / MS_DAY);
  const LETTERS = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];
  const NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
    'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const col = (i) => 8 + i;
  const mark = (i, value, hex) => ({ col: col(i), ref: `X${i}`, value, hex });
  const shade = () => axis.map((_, i) => mark(i, '', '7F7F7F'));
  const crewIdx = todayIdx >= 9 ? 7 : todayIdx + 2;
  const reviewIdx = Math.round((Date.parse(`${REVIEW.iso}T00:00:00Z`) - first) / MS_DAY);
  const monthRow = { row: 4, label: '', cells: [] };
  axis.forEach((d, i) => {
    if (i === 0 || d.getUTCDate() === 1) monthRow.cells.push({ col: col(i), ref: `M${i}`, value: NAMES[d.getUTCMonth()], hex: null });
  });
  const thisWeek = isoOf(monday);
  const reviewWeek = isoOf(mondayOf(Date.parse(`${REVIEW.iso}T00:00:00Z`)));
  const at = (d) => `${iso(d)}T08:00:00.000Z`;

  const grid = {
    merges: [], hiddenColumns: [], unknown: [],
    rows: [
      monthRow,
      { row: 5, label: '', cells: axis.map((d, i) => mark(i, String(d.getUTCDate()), null)) },
      { row: 6, label: '', cells: [
        { col: 2, ref: 'B6', value: 'CDRL', hex: null },
        { col: 3, ref: 'C6', value: 'Description of Work Activity', hex: null },
        { col: 4, ref: 'D6', value: 'Location', hex: null },
        ...axis.map((d, i) => mark(i, LETTERS[d.getUTCDay()], null)),
      ] },
      { row: 7, label: '', cells: [
        { col: 2, ref: 'B7', value: 'HTT — Testing and Commissioning', hex: 'D9D9D9' },
        { col: 3, ref: 'C7', value: '', hex: 'D9D9D9' },
        { col: 4, ref: 'D7', value: '', hex: 'D9D9D9' },
        ...shade(),
      ] },
      { row: 9, label: '', cells: [
        { col: 2, ref: 'B9', value: 'CDRL 9.04.29', hex: null },
        { col: 3, ref: 'C9', value: 'IXL Regression Testing', hex: null },
        { col: 4, ref: 'D9', value: 'T12', hex: null },
        mark(todayIdx, 'X', 'FFFF00'),
        mark(todayIdx + 1, 'X.WIT', 'FFFF00'),
        mark(todayIdx + 3, 'X', 'FF0000'),
      ] },
      { row: 10, label: '', cells: [
        { col: 3, ref: 'C10', value: 'Resource', hex: null },
        mark(crewIdx, 'Priya ,  Victor and Lena', null),
        mark(todayIdx, 'Dan', null),
        mark(todayIdx + 1, 'Dan, R. Okafor, Victor Okonkow', null),
      ] },
      { row: 14, label: '', cells: [
        { col: 2, ref: 'B14', value: 'Operational Readiness', hex: null },
        { col: 3, ref: 'C14', value: 'ATS Site Test', hex: null },
        { col: 4, ref: 'D14', value: 'S6P', hex: null },
        mark(1, 'X.PAST', '00B0F0'),
        mark(todayIdx + 2, 'X.TCE', '00B0F0'),
        mark(todayIdx + 4, 'X', '3399FF'),
      ] },
      { row: 16, label: '', cells: [
        { col: 3, ref: 'C16', value: 'REI Fiber Re-termination — finished', hex: null },
        { col: 4, ref: 'D16', value: 'W30', hex: null },
        mark(1, 'X', 'FFFF00'),
        mark(2, 'X', 'FFFF00'),
      ] },
      { row: 15, label: '', cells: [
        { col: 3, ref: 'C15', value: 'DCS Internal testing — no dates yet', hex: null },
        ...shade(),
      ] },
      { row: 17, label: '', cells: [
        { col: 3, ref: 'C17', value: 'PTO', hex: null },
        ...(reviewIdx >= 0 && reviewIdx !== crewIdx ? [mark(reviewIdx, 'Rosa', null)] : []),
        mark(crewIdx, 'Rosa', null),
      ] },
      { row: 18, label: '', cells: [
        { col: 3, ref: 'C18', value: 'Other Group / Project', hex: null },
        mark(crewIdx, 'Tom', null),
      ] },
      { row: 19, label: '', cells: [
        { col: 3, ref: 'C19', value: 'Office', hex: null },
        ...(reviewIdx >= 0 && reviewIdx !== crewIdx ? [mark(reviewIdx, 'Uma', null)] : []),
        mark(crewIdx, 'Uma', null),
      ] },
      { row: 20, label: 'Highlight in Yellow for Day Shift',
        cells: [2, 3].map((c) => ({ col: c, ref: 'X20', value: '', hex: 'FFFF00' })) },
    ],
  };

  const workdays = [1, 2, 3, 4, 5];
  const person = (id, name, title, subsystem, extra = {}) => ({
    id, user_id: null, name, email: null, title, subsystem, role: 'admin', active: true, scheduled: true,
    working_days: workdays, entitlement_days: 0, leave_year_start: null, created_at: at(-60), ...extra,
  });
  const rowAt = (id, snapshot, week, sheetRow, key, label, extra = {}) => ({
    id, snapshot_id: snapshot, week_start: week, sheet_row: sheetRow, row_key: key, location_id: null,
    raw_location: null, raw_label: label, subsystem: null, cells: {}, bart_marks: {}, resources: {}, la_row_id: null, ...extra,
  });

  return {
    rc_people: [
      person('p1', 'Alex', 'Commissioning Manager', 'ATS', { user_id: 'user-rc-1', email: 'alex@example.com', scheduled: false }),
      person('p2', 'Dan', 'Field Technician', 'Wayside', { working_days: workdays.filter((d) => d !== workdays.find((x) => x !== REVIEW.dow)) }),
      person('p3', 'Priya', 'Test Engineer', 'IXL'),
      person('p4', 'Sam', 'SCADA Engineer', 'SCADA', { working_days: workdays.filter((d) => d !== REVIEW.dow) }),
      person('p5', 'Rosa', 'Test Technician', 'IXL'),
      person('p6', 'Tom', 'Signalling Technician', 'IXL'),
      person('p7', 'Uma', 'Comms Engineer', 'SCADA'),
      person('p8', 'Victor Okonkwo', 'Test Engineer', 'ATS'),
      person('p9', 'Lena Fischer', 'Test Engineer', 'IXL'),
      person('p10', 'Lena Brandt', 'Test Technician', 'IXL'),
    ],
    rc_locations: [
      { id: 'l1', name: 'TPSS 12', code: 'T12', active: true, tawr_area: null },
      { id: 'l2', name: 'Station 6 Platform', code: 'S6P', active: true, tawr_area: null },
    ],
    rc_location_alias: [{ id: 'a1', location_id: 'l1', alias: 'Traction Power 12' }],
    rc_person_alias: [],
    rc_categories: [],
    rc_parties: [{ id: 'party1', name: 'BART', active: true }, { id: 'party2', name: 'Hitachi', active: true }],
    rc_leave_kinds: [{ id: 'k1', name: 'Annual leave', color: '#3a76e8', counts_against_entitlement: true, active: true }],
    rc_leave: [{
      id: 'lv1', person_id: 'p7', kind_id: 'k1', status: 'approved', start_date: iso(12), end_date: iso(16),
      start_portion: 'full', end_portion: 'full', note: null, created_at: at(-10), created_by: null,
    }],
    rc_legend: [
      { id: 'lg1', argb: 'FFFF00', meaning: 'Day Shift', role: 'shift', valid_from: '2026-01-01', active: true },
      { id: 'lg2', argb: '00B0F0', meaning: 'Third Shift', role: 'shift', valid_from: '2026-01-01', active: true },
      { id: 'lg3', argb: 'FF0000', meaning: 'Cancellation', role: 'shift', valid_from: '2026-01-01', active: true },
      { id: 'lg5', argb: 'D9D9D9', meaning: 'Section divider', role: 'divider', valid_from: '2026-01-01', active: true },
    ],
    rc_support_codes: [
      { id: 'sc1', code: 'X', name: 'EIC', party: 'BART', active: true, sort: 10, tawr_line: 'systems', created_at: at(-60) },
      { id: 'sc2', code: 'WIT', name: 'BART witness', party: 'BART', active: true, sort: 20, tawr_line: 'none', created_at: at(-60) },
      { id: 'sc3', code: 'TCE', name: 'TCE', party: 'BART', active: true, sort: 30, tawr_line: 'systems', created_at: at(-60) },
    ],
    rc_p6_flags: [
      { id: 'pf1', label: 'Troubleshooting', active: true, sort: 10, created_at: at(-60) },
      { id: 'pf2', label: 'Regression', active: true, sort: 20, created_at: at(-60) },
      { id: 'pf3', label: 'Support', active: true, sort: 30, created_at: at(-60) },
    ],
    rc_settings: [
      { key: 'lookahead_sheet', value: '4WLA', updated_at: at(-60), updated_by: null },
      { key: 'cancellation_log_from', value: iso(-40), updated_at: at(-60), updated_by: null },
    ],
    rc_lookahead_snapshots: [
      { id: 'snap1', taken_at: new Date().toISOString(), file_mtime: new Date().toISOString(), file_hash: 'stub-hash', legend_at: null, sheet_name: '4WLA', grid },
      { id: 'snap0', taken_at: new Date(Date.now() - 7 * MS_DAY).toISOString(), file_mtime: null, file_hash: 'stub-hash-older', legend_at: null, sheet_name: '4WLA',
        grid: { merges: [], hiddenColumns: [], unknown: [], rows: [] } },
      // Earlier reads, kept the way every read is kept, that only the cancellation log looks back at.
      { id: 'old1', taken_at: at(-21), file_mtime: null, file_hash: 'editor:stub-old1', legend_at: null, sheet_name: '4WLA', grid: { merges: [], hiddenColumns: [], unknown: [], rows: [] } },
      { id: 'old2', taken_at: at(-18), file_mtime: null, file_hash: 'editor:stub-old2', legend_at: null, sheet_name: '4WLA', grid: { merges: [], hiddenColumns: [], unknown: [], rows: [] } },
      { id: 'old3', taken_at: at(-50), file_mtime: null, file_hash: 'editor:stub-old3', legend_at: null, sheet_name: '4WLA', grid: { merges: [], hiddenColumns: [], unknown: [], rows: [] } },
    ],
    rc_lookahead_rows: [
      rowAt('lar1', 'snap1', reviewWeek, 14, 'k1', 'IXL Regression Testing', { resources: { [REVIEW.iso]: 'Dan, R. Okafor' } }),
      rowAt('lar2', 'snap1', thisWeek, 9, 'k2', 'IXL Regression Testing'),
      rowAt('lar3', 'snap1', thisWeek, 16, 'k3', 'REI Fiber Re-termination', { resources: { [isoOf(monday + MS_DAY)]: 'Victor' } }),
      rowAt('lar4', 'snap0', thisWeek, 30, 'k4-withdrawn', 'Sim Rack Relocation', {
        location_id: 'l2', raw_location: 'Yard 3',
        resources: Object.fromEntries([0, 1, 2, 3, 4].map((i) => [isoOf(monday + i * MS_DAY), 'Priya'])),
      }),
      rowAt('old1-a', 'old1', isoOf(mondayOf(Date.parse(iso(-21)))), 30, 'cp', 'Cable pull', {
        raw_location: 'TPSS 12', cells: Object.fromEntries([-20, -19, -18, -17, -16].map((d) => [iso(d), 'Cancellation'])),
      }),
      rowAt('old2-a', 'old2', isoOf(mondayOf(Date.parse(iso(-18)))), 30, 'cp', 'Cable pull', {
        raw_location: 'TPSS 12', cells: { [iso(-17)]: 'Cancellation', [iso(-16)]: 'Cancellation', [iso(-15)]: 'Day Shift', [iso(-13)]: '#FF0000' },
      }),
      rowAt('old3-a', 'old3', isoOf(mondayOf(Date.parse(iso(-50)))), 31, 'ix', 'IXL regression', {
        raw_location: 'Yard 3', cells: { [iso(-45)]: 'Cancellation' },
      }),
    ],
    rc_change_events: [
      { id: 'ev1', kind: 'cancellation', week_start: iso(-3), row_key: 'k1', location_id: null, la_row_id: null,
        before: { date: iso(-2), value: 'Day Shift' }, after: { date: iso(-2), value: 'Cancelled' },
        detected_at: new Date().toISOString(), from_snapshot: null, to_snapshot: 'snap1' },
      { id: 'ev2', kind: 'scope_added', week_start: iso(-3), row_key: 'k2', location_id: null, la_row_id: null,
        before: null, after: { label: 'NMS testing · C156' },
        detected_at: new Date().toISOString(), from_snapshot: null, to_snapshot: 'snap1' },
      { id: 'ev3', kind: 'window_advanced', week_start: iso(4), row_key: null, location_id: null, la_row_id: null,
        before: null, after: null, detected_at: new Date().toISOString(), from_snapshot: null, to_snapshot: null },
      { id: 'ev4', kind: 'scope_removed', week_start: iso(-120), row_key: 'k9', location_id: null, la_row_id: null,
        before: { label: 'Old work nobody is planning round now' }, after: null,
        detected_at: `${iso(-120)}T09:00:00.000Z`, from_snapshot: null, to_snapshot: 'snap1' },
    ],
    rc_change_annotations: [
      { id: 'an1', change_event_id: 'ev2', kind: 'responsibility', party_id: 'party1', linked_event_id: null,
        note: 'BART added it late', author: 'user-rc-1', created_at: new Date().toISOString(), supersedes_id: null },
    ],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   The files
   ═══════════════════════════════════════════════════════════════════════ */

/** A folder in memory, the shape `core/rc_db.js` writes through. */
function memoryStorage() {
  const files = new Map();
  let tick = 1;
  return {
    files,
    async read(p) { const f = files.get(p); return f ? { text: f, stamp: { size: f.length, modified: 1 } } : null; },
    async stat(p) { const f = files.get(p); return f ? { size: f.length, modified: 1 } : null; },
    async write(p, text) { files.set(p, text); tick++; return { size: text.length, modified: 1 }; },
    async list(dir) {
      const prefix = dir ? `${dir}/` : '';
      return [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map((k) => ({ name: k.slice(prefix.length) }));
    },
    async remove(p) { return files.delete(p); },
  };
}

/**
 * The calendar's files for `rows`, exactly as the application writes them,
 * keyed by their path in the shared folder — and a plan beside them, so
 * connecting the folder opens straight into it.
 *
 * @param {Record<string, any[]>} [rows]
 * @param {{ plan?: string|null }} [options]
 */
export async function seedFiles(rows = fixtureRows(), { plan = 'bart.json' } = {}) {
  const storage = memoryStorage();
  const db = createDb({ storage, who: () => ({ userId: 'user-rc-1', personId: 'p1', name: ME }) });
  await db.create(rows, { source: 'test' });
  const out = {};
  for (const [p, text] of storage.files) out[`calendar/${p}`] = text;
  if (plan) out[plan] = JSON.stringify({ schemaVersion: 99, objects: [], lanes: [], links: [] });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   The folder, in the page
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A folder the page can open, standing in for `showDirectoryPicker()`.
 *
 * `window.__folder.files` is path → `{ data, modified }`, where `data` is a
 * string for text and a Uint8Array for bytes. Seeded once from
 * `window.__seedFiles`. `__folder.write(path, text)` is another computer's
 * save landing through OneDrive; `__folder.latency` makes every write that
 * many milliseconds slow; `__folder.failWrites` makes them throw.
 */
export function fakeFolder() {
  if (window.__folder) return;
  const files = {};
  let clock = 1700000000000;
  const tick = () => { clock += 1000; return clock; };
  for (const [p, data] of Object.entries(window.__seedFiles || {})) files[p] = { data, modified: tick() };
  const encode = (d) => (typeof d === 'string' ? new TextEncoder().encode(d) : d);
  const decode = (d) => (typeof d === 'string' ? d : new TextDecoder().decode(d));
  const sizeOf = (d) => (typeof d === 'string' ? new TextEncoder().encode(d).length : d.length);
  const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
  const F = {
    name: 'BART CBTC',
    files,
    writes: 0,
    latency: 0,
    failWrites: false,
    read: (p) => (files[p] ? decode(files[p].data) : null),
    write: (p, text) => { files[p] = { data: text, modified: tick() }; },
    remove: (p) => { delete files[p]; },
    list: (prefix = '') => Object.keys(files).filter((k) => k.startsWith(prefix)).sort(),
  };
  window.__folder = F;

  const fileHandle = (key) => ({
    kind: 'file',
    name: key.split('/').pop(),
    async getFile() {
      const f = files[key];
      if (!f) throw notFound();
      const bytes = encode(f.data);
      return {
        name: key.split('/').pop(),
        size: sizeOf(f.data),
        lastModified: f.modified,
        type: '',
        text: async () => decode(f.data),
        arrayBuffer: async () => bytes.slice().buffer,
        slice: (...args) => new Blob([bytes]).slice(...args),
      };
    },
    async createWritable() {
      const parts = [];
      return {
        async write(chunk) {
          if (typeof chunk === 'string') parts.push(chunk);
          else if (chunk instanceof Blob) parts.push(new Uint8Array(await chunk.arrayBuffer()));
          else if (chunk instanceof ArrayBuffer) parts.push(new Uint8Array(chunk));
          else if (ArrayBuffer.isView(chunk)) parts.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
          else parts.push(String(chunk));
        },
        async close() {
          if (F.latency) await new Promise((r) => setTimeout(r, F.latency));
          if (F.failWrites) throw Object.assign(new Error('the folder refused the write'), { name: 'NotReadableError' });
          const text = parts.every((p) => typeof p === 'string');
          let data;
          if (text) data = parts.join('');
          else {
            const all = parts.map(encode);
            data = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
            let at = 0;
            for (const p of all) { data.set(p, at); at += p.length; }
          }
          files[key] = { data, modified: tick() };
          F.writes++;
        },
      };
    },
  });

  const dirHandle = (prefix) => ({
    kind: 'directory',
    name: prefix ? prefix.replace(/\/$/, '').split('/').pop() : F.name,
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async getDirectoryHandle(child, opts = {}) {
      const next = `${prefix}${child}/`;
      if (!opts.create && !Object.keys(files).some((k) => k.startsWith(next))) throw notFound();
      return dirHandle(next);
    },
    async getFileHandle(child, opts = {}) {
      const key = prefix + child;
      if (!files[key]) {
        if (!opts.create) throw notFound();
        files[key] = { data: '', modified: tick() };
      }
      return fileHandle(key);
    },
    async removeEntry(child) {
      if (!files[prefix + child]) throw notFound();
      delete files[prefix + child];
    },
    async *entries() {
      const seen = new Set();
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash < 0) yield [rest, fileHandle(key)];
        else if (!seen.has(rest.slice(0, slash))) {
          seen.add(rest.slice(0, slash));
          yield [rest.slice(0, slash), dirHandle(`${prefix}${rest.slice(0, slash)}/`)];
        }
      }
    },
  });

  window.showDirectoryPicker = async () => dirHandle('');
}

/**
 * Give a page the folder, seeded: call before `page.goto()`. `name` is who the
 * application believes is working — the plan's pen name, matched to the
 * calendar's roster.
 *
 * @param {import('playwright').Page} page
 * @param {{ files?: Record<string, string>, name?: string, record?: boolean }} [options]
 */
export async function installFolder(page, { files, name = ME, record = true } = {}) {
  const seeded = files || await seedFiles();
  await page.addInitScript(({ seeded, name, record }) => {
    window.__seedFiles = seeded;
    if (record) window.__rcRecord = true;
    try { if (name && !localStorage.getItem('cxtl.folder.name')) localStorage.setItem('cxtl.folder.name', name); } catch { /* none */ }
  }, { seeded, name, record });
  await page.addInitScript(fakeFolder);
}

/** Point `window.__rc` at the live database: its tables, its calls, the pen. */
export async function exposeDb(page) {
  await page.evaluate(() => {
    const rc = window.__CX_MODULES.req('core/rc.js');
    const db = () => rc.debugDb();
    window.__rc = {
      get rows() { return db()?.tables; },
      get calls() { return db()?.calls || []; },
      db,
      /** What another computer's save looks like once OneDrive brings it down. */
      refresh: () => db()?.refresh(),
      loadAll: () => db()?.loadAll(),
      revision: () => db()?.revision(),
    };
  });
}

/**
 * Open the calendar the way a person does: the workspace switch, then the
 * calendar's own door to the shared folder, then wait for its tabs.
 *
 * @param {import('playwright').Page} page
 */
export async function openCalendar(page) {
  await page.locator('.ws-btn', { hasText: 'Calendar' }).click();
  await page.waitForSelector('#rc-frame .rc-head', { timeout: 10000 });
  const door = page.locator('#rc-frame button', { hasText: 'Open the folder' });
  if (await door.count()) await door.click();
  await page.waitForSelector('#rc-frame .rc-tabs', { timeout: 15000 });
  await exposeDb(page);
}
