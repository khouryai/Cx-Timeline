/**
 * The calendar's database, kept as JSON files in the shared folder.
 *
 * The calendar lived in Postgres, behind Supabase, and every screen asked it
 * questions through the Supabase client's builder — `from(table).select()`,
 * `.eq()`, `.order()`, `.range()`, `.insert()`, `rpc()`. This module answers
 * exactly those questions, in the page, over tables it reads from and writes to
 * the folder the plan already lives in. So the screens did not have to learn a
 * second way of asking, and the rules Postgres used to enforce — a look-ahead
 * edit is all or nothing and refused when it is stale, an approved TAWR is
 * final, a cancellation lives on only while the newest reading still says so —
 * are here, as JavaScript, in one place.
 *
 * What lives where
 * ----------------
 *   calendar/db.json                  which format this folder holds, and when it was made
 *   calendar/registers.json           the people, places, colours, codes, parties and settings
 *   calendar/editor.json              the look-ahead as written: rows and cells
 *   calendar/history/<yyyy-mm>.json   every edit, a file per month
 *   calendar/p6.json                  the P6 activities a row can name
 *   calendar/leave.json               leave booked
 *   calendar/notes.json               why a day was cancelled; what a change was
 *   calendar/changes/<yyyy-mm>.json   what moved between readings, and each publish
 *   calendar/readings/index.json      every reading, without its grid
 *   calendar/readings/rows-<yyyy-mm>.json  the rows each reading derived
 *   calendar/readings/grids/<id>.json one reading's grid
 *   calendar/tawr/requests.json       TAWRs; tawr/registers.json what they are filled from
 *
 * Why many files rather than one: OneDrive uploads a whole file whenever it
 * changes. The cells change on every edit, the registers rarely, and history
 * only ever grows — so they are kept apart, history by the month, and a reading
 * once written is never rewritten.
 *
 * Every file is rewritten whole from memory, through a guard: a file that has
 * changed on disk since this window read it — another computer's save that
 * OneDrive brought down — is never written over. The write is refused with a
 * message beginning "conflict:", the file is read again, and the change that
 * was refused is taken back out of memory, so what is on screen is what is on
 * disk. Writes are made one at a time, and each is all or nothing in memory.
 *
 * Nothing here knows the folder exists. `storage` is handed in — the folder in
 * the application (`core/rc_folder.js`), a map in the tests — so the rules are
 * checked in Node by `tools/test_rc_db.js`.
 *
 * Imports: folder_rules.
 */

import { hash64 } from './folder_rules.js';

export const FORMAT = 'cx-calendar';
export const FORMAT_VERSION = 1;

/* ══════════════════════════════════════════════════════════════════════════
   The tables
   ═══════════════════════════════════════════════════════════════════════ */

const REGISTERS = 'registers.json';

/** `YYYY-MM` of a date or an instant, the month a sharded row is filed under. */
function monthOf(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : 'undated';
}

/** Fold for a unique key Postgres compared on an expression. */
const upper = (v) => String(v ?? '').trim().toUpperCase();
const lowerTrim = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Every table the calendar keeps, with what Postgres used to say about it:
 * the key, the unique constraints, the defaults a column was given, and which
 * file it is kept in. A sharded table is split across files by a value of its
 * own (`shard.of`), so a month of history is one file.
 */
const TABLES = {
  rc_people: {
    file: REGISTERS,
    unique: [{ cols: ['user_id'] }],
    defaults: (ctx) => ({
      user_id: null, email: null, title: null, subsystem: null, role: 'member', active: true,
      scheduled: true, working_days: [1, 2, 3, 4, 5], entitlement_days: 0, leave_year_start: null,
      created_at: ctx.now,
    }),
  },
  rc_person_alias: { file: REGISTERS, unique: [{ cols: ['alias'] }] },
  rc_locations: {
    file: REGISTERS,
    unique: [{ cols: ['name'] }],
    defaults: () => ({ code: null, active: true, tawr_area: null }),
  },
  rc_location_alias: { file: REGISTERS, unique: [{ cols: ['alias'] }] },
  rc_parties: { file: REGISTERS, unique: [{ cols: ['name'] }], defaults: () => ({ active: true }) },
  rc_categories: { file: REGISTERS, unique: [{ cols: ['name'] }], defaults: () => ({ sort: 0, active: true }) },
  rc_leave_kinds: {
    file: REGISTERS,
    unique: [{ cols: ['name'] }],
    defaults: () => ({ color: null, counts_against_entitlement: true, active: true }),
  },
  rc_legend: {
    file: REGISTERS,
    unique: [{ cols: ['valid_from', 'argb'] }],
    defaults: (ctx) => ({ valid_from: ctx.today, active: true, role: 'shift' }),
  },
  rc_support_codes: {
    file: REGISTERS,
    unique: [{ cols: ['code'], fold: upper }],
    defaults: (ctx) => ({ name: '', party: 'BART', active: true, sort: 0, tawr_line: 'systems', created_at: ctx.now }),
  },
  rc_p6_flags: {
    file: REGISTERS,
    unique: [{ cols: ['label'], fold: lowerTrim }],
    defaults: (ctx) => ({ active: true, sort: 0, created_at: ctx.now }),
  },
  rc_settings: {
    file: REGISTERS,
    key: ['key'],
    defaults: (ctx) => ({ value: null, updated_at: ctx.now, updated_by: ctx.userId }),
  },

  rc_la_rows: { file: 'editor.json' },
  rc_la_cells: { file: 'editor.json', key: ['row_id', 'day'] },
  rc_la_edits: {
    shard: { dir: 'history', prefix: '', of: (r) => monthOf(r.at), column: 'at' },
    sequence: 'editor.json',
  },

  rc_p6_activities: { file: 'p6.json', key: ['activity_id'] },

  rc_leave: {
    file: 'leave.json',
    defaults: (ctx) => ({
      kind_id: null, status: 'approved', start_portion: 'full', end_portion: 'full', note: null,
      created_at: ctx.now, created_by: ctx.userId,
    }),
  },

  rc_cancellation_notes: {
    file: 'notes.json',
    defaults: (ctx) => ({
      raw_location: '', reason: null, codes: null, dismissed: false, la_row_id: null,
      author: ctx.userId, created_at: ctx.now, supersedes_id: null,
    }),
  },
  rc_change_annotations: {
    file: 'notes.json',
    defaults: (ctx) => ({
      party_id: null, linked_event_id: null, note: null, author: ctx.userId, created_at: ctx.now, supersedes_id: null,
    }),
  },

  rc_change_events: {
    shard: { dir: 'changes', prefix: '', of: (r) => monthOf(r.detected_at), column: 'detected_at' },
    defaults: (ctx) => ({ location_id: null, la_row_id: null, before: null, after: null, detected_at: ctx.now }),
  },
  rc_ingest_runs: {
    shard: { dir: 'changes', prefix: '', of: (r) => monthOf(r.ran_at), column: 'ran_at' },
    defaults: (ctx) => ({ ran_at: ctx.now, file_hash: null, file_mtime: null, note: null }),
  },

  rc_lookahead_snapshots: {
    file: 'readings/index.json',
    unique: [{ cols: ['file_hash'] }],
    defaults: (ctx) => ({ taken_at: ctx.now, file_mtime: null, legend_at: null }),
    /* The grid is most of a reading, and only the newest is drawn: it is kept
       in a file of its own and read when a question asks for it. A compacted
       grid is a few fields, and stays in the index. */
    detached: {
      column: 'grid',
      path: (r) => `readings/grids/${safeName(r.id)}.json`,
      inline: (grid) => Boolean(grid && grid.compacted),
      summary: (grid) => ({
        row_count: Number.isFinite(Number(grid?.row_count)) && grid?.row_count != null
          ? Number(grid.row_count) : (Array.isArray(grid?.rows) ? grid.rows.length : 0),
        unmapped_count: Array.isArray(grid?.unknown) ? grid.unknown.length : 0,
        compacted: Boolean(grid?.compacted),
      }),
    },
  },
  rc_lookahead_rows: {
    shard: { dir: 'readings', prefix: 'rows-', of: (r, db) => monthOf(db.takenAt(r.snapshot_id)) },
    needs: ['rc_lookahead_snapshots'],
    defaults: () => ({
      sheet_row: null, location_id: null, raw_location: null, raw_label: null, subsystem: null,
      cells: {}, bart_marks: {}, resources: {}, la_row_id: null,
    }),
  },

  rc_tawrs: {
    file: 'tawr/requests.json',
    defaults: (ctx) => ({
      location_id: null, location_name: '', status: 'draft', fields: {}, generated: {}, source: {},
      snapshot_id: null, first_day: null, supersedes: null, created_by: null, created_at: ctx.now,
      updated_by: null, updated_at: ctx.now, approved_by: null, approved_at: null,
    }),
  },
  rc_tawr_descriptions: {
    file: 'tawr/registers.json',
    defaults: (ctx) => ({ description: '', created_at: ctx.now, updated_at: ctx.now }),
  },
  rc_tawr_settings: {
    file: 'tawr/registers.json',
    key: ['key'],
    defaults: (ctx) => ({ value: null, updated_at: ctx.now, updated_by: ctx.userId }),
  },
  rc_tawr_profiles: {
    file: 'tawr/registers.json',
    key: ['person_id'],
    defaults: (ctx) => ({ requestor_name: '', cell_phone: '', signature: null, updated_at: ctx.now }),
  },
};

/** The tables the calendar keeps, by name — for the importer and the tests. */
export const TABLE_NAMES = Object.keys(TABLES);

/** True when `path` is a file of this table: its own file, or one of its shards. */
function owns(name, path) {
  const def = TABLES[name];
  if (def.file) return def.file === path;
  const stem = `${def.shard.dir}/${def.shard.prefix}`;
  return path.startsWith(stem) && /^(\d{4}-\d{2}|undated)\.json$/.test(path.slice(stem.length));
}

/** The tables a file holds — several share a file, and two share each month of changes. */
function tablesOwning(path) {
  return TABLE_NAMES.filter((name) => owns(name, path));
}

const keyOf = (name) => TABLES[name]?.key || ['id'];

/** A name safe to use as one path component on every platform. */
function safeName(id) {
  return String(id || '').replace(/[^A-Za-z0-9_-]/g, '_') || 'unnamed';
}

/* ══════════════════════════════════════════════════════════════════════════
   Small helpers
   ═══════════════════════════════════════════════════════════════════════ */

const clone = typeof structuredClone === 'function'
  ? (v) => (v === undefined ? undefined : structuredClone(v))
  : (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** A random id in the shape Postgres gave them. */
export function newUuid() {
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** An error the way PostgREST worded its own, so callers' message checks still hold. */
function fail(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

/** Postgres's comparison: numbers as numbers, everything else as text. */
function compare(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

const isNil = (v) => v === null || v === undefined;

/* ══════════════════════════════════════════════════════════════════════════
   The database
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Open the calendar's database over `storage`.
 *
 *   storage   `{ read(path) → { text, stamp } | null, write(path, text, expected) → stamp,
 *              stat(path) → stamp | null, list(dir) → [{ name }], remove(path) }` —
 *             every path relative to the calendar's own folder.
 *   who()     `{ userId, name }` of whoever is working — what `by` and
 *             `author` are stamped with.
 *   canWrite()  true, or the sentence saying why not (somebody else has the pen).
 *   now()     the clock, so the tests can pin it.
 *
 * @param {{ storage: any, who?: () => { userId: string|null, personId?: string|null, name?: string },
 *           canWrite?: () => true|string, now?: () => Date, record?: boolean }} options
 */
export function createDb({ storage, who = () => ({ userId: null, personId: null, name: '' }), canWrite = () => true, now = () => new Date(), record = false }) {
  /** Rows, by table — every row of every shard read so far, in insertion order. */
  const tables = Object.fromEntries(TABLE_NAMES.map((n) => [n, []]));
  /** What each file was when this window last read or wrote it: `{ stamp, hash }`, or `{ absent: true }`. */
  const files = new Map();
  /** Files read (or being read), by path. */
  const loading = new Map();
  /** Sharded tables whose every shard is loaded. */
  const complete = new Set();
  /** Files whose contents in memory differ from what is on disk. */
  let dirty = new Set();
  /** Detached values waiting to be written, by path (null removes the file). */
  let detachedOut = new Map();
  /** File-level extras: the sequences kept beside a table. */
  const meta = new Map();
  /** Rises on every change in memory, so a view computed once can be reused. */
  let version = 0;
  const views = new Map();
  const listeners = new Set();
  /** Every question asked, when asked to — what the tests count. */
  const calls = [];
  let queue = Promise.resolve();

  const ctx = () => {
    const at = now();
    return { now: at.toISOString(), today: at.toISOString().slice(0, 10), userId: who()?.userId ?? null };
  };

  /* ── Reading files ───────────────────────────────────────────────────── */

  function parseFile(path, text) {
    let body;
    try {
      body = JSON.parse(text);
    } catch (err) {
      throw fail(`${path} could not be read — it may be half-way through syncing (${err.message})`);
    }
    if (!body || typeof body !== 'object') throw fail(`${path} is not a calendar file`);
    if (body.format && body.format !== FORMAT) throw fail(`${path} is not a calendar file (${body.format})`);
    if (Number(body.formatVersion) > FORMAT_VERSION) {
      throw fail(`${path} was written by a newer version of CX Timeline (format ${body.formatVersion}). Update the application.`);
    }
    return body;
  }

  /** What a file's contents hash to, leaving out when and by whom it was saved. */
  function contentHash(body) {
    return hash64(JSON.stringify({ meta: body.meta || null, tables: body.tables || null, value: body.value ?? null }));
  }

  function loadFile(path) {
    if (loading.has(path)) return loading.get(path);
    const promise = (async () => {
      const read = await storage.read(path);
      if (!read) {
        files.set(path, { absent: true });
        return;
      }
      const body = parseFile(path, read.text);
      files.set(path, { stamp: read.stamp, hash: contentHash(body) });
      adopt(path, body);
    })();
    loading.set(path, promise);
    promise.catch(() => loading.delete(path));
    return promise;
  }

  /** Put a file's rows in memory, replacing whatever that file held before. */
  function adopt(path, body) {
    const held = body.tables || {};
    for (const name of tablesOwning(path)) {
      const incoming = Array.isArray(held[name]) ? held[name] : [];
      tables[name] = TABLES[name].file
        ? incoming.slice()
        : tables[name].filter((r) => filePathOf(name, r) !== path).concat(incoming);
    }
    if (body.meta) meta.set(path, { ...(meta.get(path) || {}), ...body.meta });
    else meta.delete(path);
    version++;
  }

  /** The file a row of a table lives in. */
  function filePathOf(name, row) {
    const def = TABLES[name];
    if (def.file) return def.file;
    return `${def.shard.dir}/${def.shard.prefix}${def.shard.of(row, api)}.json`;
  }

  /** Every shard of a table that is on disk, as paths. */
  async function shardPaths(name) {
    const { dir, prefix } = TABLES[name].shard;
    const pattern = new RegExp(`^${prefix.replace(/[-]/g, '\\-')}(\\d{4}-\\d{2}|undated)\\.json$`);
    const listed = await storage.list(dir).catch(() => []);
    return listed.map((f) => f.name).filter((n) => pattern.test(n)).map((n) => `${dir}/${n}`);
  }

  /**
   * Make sure a table's rows are in memory — every shard, or only those a
   * question can be answered from (`months`, `YYYY-MM` from and to).
   */
  async function ensure(name, months = null) {
    const def = TABLES[name];
    if (!def) return;
    for (const dep of def.needs || []) await ensure(dep);
    if (def.sequence) await loadFile(def.sequence);
    if (def.file) {
      await loadFile(def.file);
      return;
    }
    if (complete.has(name)) return;
    const paths = await shardPaths(name);
    const wanted = months
      ? paths.filter((p) => {
        const m = p.slice(p.lastIndexOf('/') + 1 + def.shard.prefix.length, -5);
        return m === 'undated' || ((!months.from || m >= months.from) && (!months.to || m <= months.to));
      })
      : paths;
    await Promise.all(wanted.map((p) => loadFile(p)));
    if (!months) complete.add(name);
  }

  /** The months a question about a sharded table is limited to, if its filters say. */
  function monthsFor(name, filters) {
    const def = TABLES[name];
    if (!def?.shard) return null;
    if (def.shard.column) {
      let from = null;
      let to = null;
      for (const f of filters) {
        if (f.col !== def.shard.column) continue;
        if (f.op === 'gte' || f.op === 'gt') from = monthOf(f.value);
        if (f.op === 'lte' || f.op === 'lt') to = monthOf(f.value);
        if (f.op === 'eq') from = to = monthOf(f.value);
      }
      return from || to ? { from, to } : null;
    }
    if (name === 'rc_lookahead_rows') {
      const by = filters.find((f) => f.col === 'snapshot_id' && f.op === 'eq');
      if (!by) return null;
      const m = monthOf(takenAt(by.value));
      return { from: m, to: m };
    }
    return null;
  }

  /** When a reading was taken — what its rows are filed under. */
  function takenAt(snapshotId) {
    return tables.rc_lookahead_snapshots.find((s) => s.id === snapshotId)?.taken_at || null;
  }

  /** A reading's grid, read from its own file the first time it is wanted. */
  async function hydrate(name, rows) {
    const det = TABLES[name]?.detached;
    if (!det) return;
    await Promise.all(rows.map(async (row) => {
      if (row[det.column] !== undefined) return;
      const path = det.path(row);
      const read = await storage.read(path).catch(() => null);
      if (!read) {
        row[det.column] = { rows: [], merges: [], hiddenColumns: [], unknown: [], missing: true };
        return;
      }
      const body = parseFile(path, read.text);
      row[det.column] = body.value ?? null;
    }));
  }

  /* ── Writing files ───────────────────────────────────────────────────── */

  function serialise(path) {
    const body = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      savedAt: now().toISOString(),
      savedBy: who()?.name || '',
    };
    const m = meta.get(path);
    if (m && Object.keys(m).length) body.meta = m;
    const out = {};
    for (const name of tablesOwning(path)) {
      const rows = TABLES[name].file ? tables[name] : tables[name].filter((r) => filePathOf(name, r) === path);
      out[name] = rows.map((r) => strip(name, r));
    }
    body.tables = out;
    // Laid out for reading when it is small — somebody may open it in Notepad
    // to see what the calendar holds — and packed when it is not.
    const packed = JSON.stringify(body);
    const text = packed.length < 200000 ? JSON.stringify(body, null, 1) : packed;
    return { text, hash: contentHash(body) };
  }

  /** A row as it is written to its file: without the detached column, with its summary. */
  function strip(name, row) {
    const det = TABLES[name]?.detached;
    if (!det) return row;
    const { [det.column]: value, ...rest } = row;
    if (value === undefined) return rest;
    if (det.inline(value)) return { ...rest, [det.column]: value, [`${det.column}_summary`]: det.summary(value) };
    return { ...rest, [`${det.column}_summary`]: det.summary(value) };
  }

  /**
   * Write one file, never over somebody else's.
   *
   * The file is compared before it is written: if it moved since this window
   * last saw it and its contents are not the ones this window wrote, the write
   * is refused and the file is read again, so memory follows the disk.
   */
  async function writeGuarded(path, text, hash) {
    const known = files.get(path);
    const current = await storage.stat(path).catch(() => null);
    const moved = current
      ? !known || known.absent || current.size !== known.stamp?.size || current.modified !== known.stamp?.modified
      : Boolean(known && !known.absent);
    if (moved && current) {
      const read = await storage.read(path).catch(() => null);
      const body = read ? parseFile(path, read.text) : null;
      const theirs = body ? contentHash(body) : null;
      if (theirs && theirs !== known?.hash) {
        throw fail(`conflict: ${path} was saved on another computer since this one read it. `
          + 'It has been read again — make the change again if it still needs making.',
        { conflict: true, theirs: { path, body, stamp: read.stamp, hash: theirs } });
      }
      // The same contents, re-stamped by the sync client: ours to write over.
      if (read) files.set(path, { stamp: read.stamp, hash: theirs });
    }
    let stamp;
    try {
      stamp = await storage.write(path, text, current);
    } catch (err) {
      if (err && err.kind === 'conflict') {
        throw fail(`conflict: ${path} changed on disk while it was being saved — reload the calendar.`, { conflict: true });
      }
      throw err;
    }
    files.set(path, { stamp, hash });
  }

  /**
   * Write every changed file. Answers the paths it wrote, so a write that
   * fails half way can say which files are now ahead of memory.
   */
  async function flush(written = new Set()) {
    const paths = [...dirty];
    // The data before its history: an edit whose log did not land is a gap in
    // the record, a log of an edit that did not land is a false one.
    paths.sort((a, b) => Number(a.startsWith('history/')) - Number(b.startsWith('history/')));
    // A reading's grid before the index that points at it.
    for (const [path, value] of [...detachedOut]) {
      if (value === null) await storage.remove(path).catch(() => false);
      else await storage.write(path, JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, value }), null);
      detachedOut.delete(path);
    }
    for (const path of paths) {
      const { text, hash } = serialise(path);
      await writeGuarded(path, text, hash);
      dirty.delete(path);
      written.add(path);
    }
    return written;
  }

  /**
   * Make a change, all or nothing: in memory, then on disk. Anything that
   * throws — a broken rule, a refused write — puts memory back as it was.
   * One at a time, so a write never interleaves with another.
   */
  function tx(fn) {
    const run = queue.then(async () => {
      const allowed = canWrite();
      if (allowed !== true) throw fail(String(allowed || 'The calendar is read-only here.'), { readOnly: true });
      const before = new Map();
      const beforeMeta = new Map([...meta].map(([k, v]) => [k, clone(v)]));
      const dirtyBefore = new Set(dirty);
      const written = new Set();
      const touch = (name) => {
        if (!before.has(name)) before.set(name, tables[name].map((r) => clone(r)));
      };
      const mark = (name, row) => dirty.add(filePathOf(name, row));
      try {
        const result = await fn({ touch, mark });
        await flush(written);
        version++;
        return result;
      } catch (err) {
        for (const [name, rows] of before) tables[name] = rows;
        meta.clear();
        for (const [k, v] of beforeMeta) meta.set(k, v);
        detachedOut = new Map();
        /* A file this change already wrote is now ahead of memory: it is
           written again, from memory as it was, with the next change — and
           until then it is unsaved, which the status bar says. */
        dirty = new Set([...dirtyBefore, ...written]);
        if (err?.theirs) {
          // Theirs is the file now: read it in, so what is drawn is what is there.
          const { path, body, stamp, hash } = err.theirs;
          files.set(path, { stamp, hash });
          adopt(path, body);
          dirty.delete(path);
          delete err.theirs;
        }
        version++;
        throw err;
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  /** Write what is unsaved, if anything is — after a write that failed half way. */
  function retry() {
    if (!dirty.size) return Promise.resolve(false);
    return tx(async () => true);
  }

  /* ── Rules Postgres used to keep ─────────────────────────────────────── */

  function uniqueViolation(name, row, except = null) {
    for (const u of TABLES[name].unique || []) {
      const fold = u.fold || ((v) => v);
      if (u.cols.some((c) => isNil(row[c]))) continue;
      const clash = tables[name].find((r) => r !== except && u.cols.every((c) => fold(r[c]) === fold(row[c])));
      if (clash) {
        return fail(`duplicate key value violates unique constraint "${name}_${u.cols.join('_')}_key"`, { code: '23505' });
      }
    }
    const key = keyOf(name);
    if (key.every((c) => !isNil(row[c]))) {
      const clash = tables[name].find((r) => r !== except && key.every((c) => r[c] === row[c]));
      if (clash) return fail(`duplicate key value violates unique constraint "${name}_pkey"`, { code: '23505' });
    }
    return null;
  }

  /** Defaults, an id, and whatever the table's trigger did on insert. */
  function prepareInsert(name, input, c) {
    const def = TABLES[name];
    const row = { ...(def.defaults ? def.defaults(c) : {}), ...clone(input) };
    for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
    const key = keyOf(name);
    if (key.length === 1 && key[0] === 'id' && isNil(row.id)) {
      row.id = def.sequence ? nextSequence(name) : newUuid();
    }
    if (name === 'rc_tawrs') {
      // rc_tawr_guard(): a request starts as a draft, raised by whoever made it.
      row.created_by = row.created_by ?? who()?.personId ?? null;
      row.status = 'draft';
      row.approved_by = null;
      row.approved_at = null;
    }
    if (name === 'rc_legend' && row.argb) row.argb = String(row.argb).toUpperCase();
    return row;
  }

  function nextSequence(name) {
    const path = TABLES[name].sequence;
    const m = meta.get(path) || {};
    const seq = { ...(m.sequences || {}) };
    seq[name] = (Number(seq[name]) || 0) + 1;
    meta.set(path, { ...m, sequences: seq });
    dirty.add(path);
    return seq[name];
  }

  function sequenceOf(name) {
    return Number(meta.get(TABLES[name].sequence)?.sequences?.[name]) || 0;
  }

  /** rc_tawr_guard() on update: approved is final, superseded is history. */
  function guardTawrUpdate(old, next, c) {
    if (old.status === 'superseded') throw fail('that request has been revised; change the revision instead');
    if (old.status === 'approved') {
      const same = (k) => JSON.stringify(next[k] ?? null) === JSON.stringify(old[k] ?? null);
      if (next.status !== 'superseded' || !same('fields') || !same('generated') || !same('week_start') || !same('group_key')) {
        throw fail('an approved request is final — revise it to change it');
      }
    }
    if (old.status === 'draft' && next.status === 'superseded') throw fail('a draft is discarded, not superseded');
    if (next.status === 'approved' && old.status === 'draft') {
      next.approved_by = who()?.personId ?? null;
      next.approved_at = c.now;
    }
    next.created_by = old.created_by;
    next.created_at = old.created_at;
    next.updated_by = who()?.personId ?? null;
    next.updated_at = c.now;
  }

  function ring() {
    for (const fn of [...listeners]) {
      try { fn(); } catch (err) { console.warn('[cx-timeline] a calendar listener failed:', err); }
    }
  }

  /* ── Writes ──────────────────────────────────────────────────────────── */

  /**
   * Read in what a write needs: the whole table, except for a table kept by
   * the month, where only the months the new rows go into are read — a new
   * reading does not need last year's.
   */
  async function ensureForWrite(name) {
    const def = TABLES[name];
    if (!def.shard) return ensure(name);
    for (const dep of def.needs || []) await ensure(dep);
    if (def.sequence) await loadFile(def.sequence);
    return undefined;
  }

  async function insertRows(name, rows) {
    if (!TABLES[name]) throw fail(`relation "${name}" does not exist`);
    await ensureForWrite(name);
    const made = await tx(async ({ touch, mark }) => {
      touch(name);
      const c = ctx();
      const out = [];
      for (const input of [].concat(rows)) {
        const row = prepareInsert(name, input, c);
        if (TABLES[name].shard) await loadFile(filePathOf(name, row));
        const clash = uniqueViolation(name, row);
        if (clash) throw clash;
        tables[name].push(row);
        mark(name, row);
        out.push(row);
        writeDetached(name, row);
      }
      return out.map((r) => clone(r));
    });
    // rc_lookahead_snapshots_ring: a reading taken rings the bell.
    if (name === 'rc_lookahead_snapshots') ring();
    return made;
  }

  function writeDetached(name, row) {
    const det = TABLES[name]?.detached;
    if (!det || row[det.column] === undefined) return;
    const value = row[det.column];
    detachedOut.set(det.path(row), det.inline(value) ? null : value);
  }

  async function upsertRows(name, rows, onConflict) {
    if (!TABLES[name]) throw fail(`relation "${name}" does not exist`);
    await ensure(name);
    const keys = String(onConflict || keyOf(name).join(',')).split(',').map((k) => k.trim());
    return tx(async ({ touch, mark }) => {
      touch(name);
      const c = ctx();
      const written = [];
      for (const input of [].concat(rows)) {
        const probe = prepareInsert(name, input, c);
        const hit = tables[name].find((r) => keys.every((k) => r[k] === probe[k]));
        if (hit) {
          Object.assign(hit, clone(input));
          if ('updated_at' in hit && !('updated_at' in input)) hit.updated_at = c.now;
          if ('updated_by' in hit && !('updated_by' in input)) hit.updated_by = c.userId;
          mark(name, hit);
          written.push(hit);
        } else {
          const clash = uniqueViolation(name, probe);
          if (clash) throw clash;
          tables[name].push(probe);
          mark(name, probe);
          written.push(probe);
        }
      }
      return written.map((r) => clone(r));
    });
  }

  async function updateRows(name, patch, filters) {
    if (!TABLES[name]) throw fail(`relation "${name}" does not exist`);
    await ensure(name, monthsFor(name, filters));
    return tx(async ({ touch, mark }) => {
      touch(name);
      const c = ctx();
      const hit = tables[name].filter((r) => filters.every((f) => test(f, r)));
      for (const row of hit) {
        const next = { ...row, ...clone(patch) };
        if (name === 'rc_tawrs') guardTawrUpdate(row, next, c);
        const clash = uniqueViolation(name, next, row);
        if (clash) throw clash;
        const before = filePathOf(name, row);
        Object.assign(row, next);
        dirty.add(before);
        mark(name, row);
        writeDetached(name, row);
      }
      return hit.map((r) => clone(r));
    });
  }

  async function deleteRows(name, filters) {
    if (!TABLES[name]) throw fail(`relation "${name}" does not exist`);
    await ensure(name, monthsFor(name, filters));
    return tx(async ({ touch, mark }) => {
      touch(name);
      let gone = tables[name].filter((r) => filters.every((f) => test(f, r)));
      // A DELETE the policy refused matched nothing: only a draft request may go.
      if (name === 'rc_tawrs') gone = gone.filter((r) => r.status === 'draft');
      tables[name] = tables[name].filter((r) => !gone.includes(r));
      for (const row of gone) mark(name, row);
      return gone.map((r) => clone(r));
    });
  }

  /* ── Filters ─────────────────────────────────────────────────────────── */

  function test(f, row) {
    const v = row[f.col];
    switch (f.op) {
      case 'eq': return !isNil(v) && compare(v, f.value) === 0 && (typeof f.value !== 'boolean' || v === f.value);
      case 'neq': return !isNil(v) && compare(v, f.value) !== 0;
      case 'gt': return !isNil(v) && compare(v, f.value) > 0;
      case 'gte': return !isNil(v) && compare(v, f.value) >= 0;
      case 'lt': return !isNil(v) && compare(v, f.value) < 0;
      case 'lte': return !isNil(v) && compare(v, f.value) <= 0;
      case 'in': return !isNil(v) && f.value.some((x) => compare(v, x) === 0);
      case 'is': return f.value === null ? isNil(v) : v === f.value;
      default: throw fail(`unsupported filter ${f.op}`);
    }
  }

  function sortRows(rows, orders) {
    if (!orders.length) return rows;
    return rows.sort((a, b) => {
      for (const { col, ascending, nullsFirst } of orders) {
        const x = a[col];
        const y = b[col];
        if (isNil(x) || isNil(y)) {
          if (isNil(x) && isNil(y)) continue;
          // Postgres: NULLS LAST ascending, NULLS FIRST descending.
          const first = nullsFirst ?? !ascending;
          return (isNil(x) ? -1 : 1) * (first ? 1 : -1);
        }
        const d = compare(x, y);
        if (d) return ascending ? d : -d;
      }
      return 0;
    });
  }

  function project(row, columns) {
    if (!columns || columns === '*') return row;
    const out = {};
    for (const col of String(columns).split(',').map((c) => c.trim()).filter(Boolean)) out[col] = row[col];
    return out;
  }

  /* ── Views ───────────────────────────────────────────────────────────── */

  /**
   * Views, as Postgres defined them — derived on every question and never
   * stored, remembered only until the next change.
   */
  const VIEWS = {
    rc_lookahead_snapshot_meta: {
      needs: ['rc_lookahead_snapshots'],
      rows: () => tables.rc_lookahead_snapshots.map((s) => {
        const summary = s.grid !== undefined ? TABLES.rc_lookahead_snapshots.detached.summary(s.grid) : (s.grid_summary || {});
        return {
          id: s.id, taken_at: s.taken_at, file_mtime: s.file_mtime ?? null, file_hash: s.file_hash,
          legend_at: s.legend_at ?? null, sheet_name: s.sheet_name,
          row_count: summary.row_count ?? 0, unmapped_count: summary.unmapped_count ?? 0, compacted: Boolean(summary.compacted),
        };
      }),
    },
    rc_lookahead_cover: {
      needs: ['rc_lookahead_rows'],
      rows: () => cover(),
    },
    rc_cancelled_days: {
      needs: ['rc_lookahead_rows', 'rc_legend'],
      rows: () => cancelledDays(false),
    },
    rc_cancelled_support_days: {
      needs: ['rc_lookahead_rows', 'rc_legend'],
      rows: () => cancelledDays(true),
    },
    rc_lookahead_days: {
      needs: ['rc_lookahead_rows'],
      rows: () => lookaheadDays(),
    },
    rc_lookahead_workbook_weeks: {
      needs: ['rc_lookahead_rows'],
      rows: () => workbookWeeks(),
    },
  };

  /** The reading each row came from, and when it was taken. */
  function readingsById() {
    return new Map(tables.rc_lookahead_snapshots.map((s) => [s.id, s]));
  }

  /** rc_lookahead_cover: the first and last day each reading's rows carry. */
  function cover() {
    const snaps = readingsById();
    const out = new Map();
    for (const r of tables.rc_lookahead_rows) {
      const s = snaps.get(r.snapshot_id);
      if (!s) continue;
      const days = Object.keys({ ...(r.cells || {}), ...(r.bart_marks || {}) });
      if (!days.length) continue;
      const held = out.get(r.snapshot_id) || { snapshot_id: r.snapshot_id, taken_at: s.taken_at, first_day: null, last_day: null };
      for (const d of days) {
        const day = String(d).slice(0, 10);
        if (!held.first_day || day < held.first_day) held.first_day = day;
        if (!held.last_day || day > held.last_day) held.last_day = day;
      }
      out.set(r.snapshot_id, held);
    }
    return [...out.values()];
  }

  /** "taken_at desc, snapshot_id desc": which of two readings is the newer. */
  const newer = (a, b) => (a.taken_at !== b.taken_at ? compare(a.taken_at, b.taken_at) > 0 : compare(a.snapshot_id, b.snapshot_id) > 0);

  /**
   * rc_cancelled_days and rc_cancelled_support_days — every day the look-ahead
   * *currently* shows cancelled (or a BART resource struck out), kept only when
   * the newest reading covering that date still shows it.
   */
  function cancelledDays(support) {
    const snaps = readingsById();
    const red = new Set(tables.rc_legend.filter((l) => /cancel/i.test(String(l.meaning || ''))).map((l) => `#${l.argb}`));
    const isRed = (value) => /cancel/i.test(String(value ?? '')) || red.has(String(value ?? ''));
    const hits = [];
    for (const r of tables.rc_lookahead_rows) {
      const s = snaps.get(r.snapshot_id);
      if (!s) continue;
      const source = support ? r.bart_marks : r.cells;
      for (const [key, value] of Object.entries(source || {})) {
        const day = String(key).slice(0, 10);
        if (support) {
          if (!/(^|\.)\s*~/.test(String(value ?? ''))) continue;
          if (isRed((r.cells || {})[key] ?? '')) continue;
        } else if (!isRed(value)) continue;
        hits.push({
          raw_label: r.raw_label ?? '', raw_location: r.raw_location ?? '', location_id: r.location_id ?? null,
          snapshot_id: r.snapshot_id, taken_at: s.taken_at, day,
          marks: support ? value : ((r.bart_marks || {})[key] ?? null), la_row_id: r.la_row_id ?? null,
        });
      }
    }
    if (!hits.length) return [];
    const spans = cover();
    const newestFor = new Map();
    for (const day of new Set(hits.map((h) => h.day))) {
      let best = null;
      for (const c of spans) {
        if (day < c.first_day || day > c.last_day) continue;
        if (!best || newer(c, best)) best = c;
      }
      if (best) newestFor.set(day, best.snapshot_id);
    }
    const groups = new Map();
    for (const h of hits) {
      const newest = newestFor.get(h.day);
      if (!newest) continue;
      const key = `${h.raw_label}\u0000${h.raw_location}\u0000${h.day}`;
      const g = groups.get(key) || {
        raw_label: h.raw_label, raw_location: h.raw_location, location_id: null, day: h.day,
        first_seen: null, last_seen: null, reads: 0, marks: null, la_row_id: null,
        _snaps: new Set(), _current: false,
      };
      if (!g.location_id && h.location_id) g.location_id = h.location_id;
      if (!g.first_seen || compare(h.taken_at, g.first_seen) < 0) g.first_seen = h.taken_at;
      if (!g.last_seen || compare(h.taken_at, g.last_seen) > 0) g.last_seen = h.taken_at;
      g._snaps.add(h.snapshot_id);
      if (h.snapshot_id === newest) {
        g._current = true;
        if (g.marks == null && h.marks != null) g.marks = h.marks;
        if (!g.la_row_id && h.la_row_id) g.la_row_id = h.la_row_id;
      }
      groups.set(key, g);
    }
    return [...groups.values()].filter((g) => g._current).map(({ _snaps, _current, ...g }) => ({ ...g, reads: _snaps.size }));
  }

  /** For each week, the newest reading that has it — `distinct on (week_start)`. */
  /** @param {(reading: any) => boolean} [only] */
  function newestPerWeek(only = () => true) {
    const snaps = readingsById();
    const best = new Map();
    for (const r of tables.rc_lookahead_rows) {
      const s = snaps.get(r.snapshot_id);
      if (!s || !only(s)) continue;
      const cand = { week_start: r.week_start, snapshot_id: r.snapshot_id, taken_at: s.taken_at };
      const held = best.get(r.week_start);
      if (!held || newer(cand, held)) best.set(r.week_start, cand);
    }
    return best;
  }

  /** rc_lookahead_days: one row per activity and day, each week from its newest reading. */
  function lookaheadDays() {
    const best = newestPerWeek();
    const out = [];
    for (const r of tables.rc_lookahead_rows) {
      const pick = best.get(r.week_start);
      if (!pick || pick.snapshot_id !== r.snapshot_id) continue;
      const keys = Object.keys({ ...(r.cells || {}), ...(r.bart_marks || {}), ...(r.resources || {}) });
      for (const k of keys) {
        out.push({
          row_id: r.id, snapshot_id: r.snapshot_id, taken_at: pick.taken_at, week_start: r.week_start,
          row_key: r.row_key, sheet_row: r.sheet_row ?? null, location_id: r.location_id ?? null,
          raw_location: r.raw_location ?? null, raw_label: r.raw_label ?? null, subsystem: r.subsystem ?? null,
          la_row_id: r.la_row_id ?? null, day: String(k).slice(0, 10),
          paint: r.cells?.[k] ?? null, marks: r.bart_marks?.[k] ?? null, names: r.resources?.[k] ?? null,
        });
      }
    }
    return out;
  }

  /** rc_lookahead_workbook_weeks: each week's newest *workbook* reading. */
  function workbookWeeks() {
    return [...newestPerWeek((s) => !String(s.file_hash || '').startsWith('editor:')).values()];
  }

  async function viewRows(name) {
    const view = VIEWS[name];
    for (const dep of view.needs) await ensure(dep);
    const held = views.get(name);
    if (held && held.version === version) return held.rows;
    const rows = view.rows();
    views.set(name, { version, rows });
    return rows;
  }

  /* ── Reads ───────────────────────────────────────────────────────────── */

  async function runSelect(q) {
    let source;
    if (VIEWS[q.table]) source = await viewRows(q.table);
    else if (TABLES[q.table]) {
      await ensure(q.table, monthsFor(q.table, q.filters));
      source = tables[q.table];
    } else {
      throw fail(`relation "${q.table}" does not exist`);
    }
    if (!Array.isArray(source)) throw fail(`${q.table} could not be read`);
    let rows = source.filter((r) => q.filters.every((f) => test(f, r)));
    const total = rows.length;
    rows = sortRows(rows.slice(), q.orders);
    if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
    if (q.limit != null) rows = rows.slice(0, q.limit);
    const det = TABLES[q.table]?.detached;
    const wantsDetached = det && (q.columns === '*' || String(q.columns).split(',').map((c) => c.trim()).includes(det.column));
    if (wantsDetached) await hydrate(q.table, rows);
    const out = rows.map((r) => {
      const copy = project(r, q.columns);
      const plain = det ? Object.fromEntries(Object.entries(copy).filter(([k]) => k !== `${det.column}_summary`)) : copy;
      if (det && !wantsDetached) delete plain[det.column];
      return clone(plain);
    });
    return { rows: out, total };
  }

  /* ── The builder ─────────────────────────────────────────────────────── */

  function settle(promise) {
    return promise.then(
      (data) => ({ data, error: null }),
      (err) => ({ data: null, error: { message: String(err?.message || err), code: err?.code || null } }),
    );
  }

  /** `from(table)`: the subset of PostgREST's builder the calendar uses. */
  function from(table) {
    const q = { table, columns: '*', filters: [], orders: [], limit: null, range: null, count: null };
    const filtering = (target) => {
      const add = (op) => (col, value) => { q.filters.push({ op, col, value }); return target; };
      target.eq = add('eq');
      target.neq = add('neq');
      target.gt = add('gt');
      target.gte = add('gte');
      target.lt = add('lt');
      target.lte = add('lte');
      target.in = add('in');
      target.is = add('is');
      return target;
    };
    const api = filtering({
      select(columns = '*', options) {
        if (columns) q.columns = columns;
        if (options?.count) q.count = options.count;
        return api;
      },
      /** @param {string} col @param {{ ascending?: boolean, nullsFirst?: boolean }} [options] */
      order(col, { ascending = true, nullsFirst } = {}) {
        q.orders.push({ col, ascending, nullsFirst });
        return api;
      },
      limit(n) { q.limit = n; return api; },
      range(a, b) { q.range = [a, b]; return api; },
      maybeSingle() {
        if (record) calls.push({ kind: 'select', table, filters: q.filters.slice(), columns: q.columns });
        return settle(runSelect(q).then((r) => r.rows[0] || null));
      },
      then(resolve, reject) {
        if (record) calls.push({ kind: 'select', table, filters: q.filters.slice(), columns: q.columns, limit: q.limit });
        return runSelect(q).then(
          ({ rows, total }) => ({ data: rows, error: null, count: q.count ? total : null }),
          (err) => ({ data: null, error: { message: String(err?.message || err), code: err?.code || null }, count: null }),
        ).then(resolve, reject);
      },
      insert(rows) {
        if (record) calls.push({ kind: 'insert', table, payload: clone(rows) });
        const run = insertRows(table, rows);
        run.catch(() => {});
        const done = { select: () => settle(run), then: (res, rej) => settle(run).then(() => ({ data: null, error: null })).then(res, rej) };
        return done;
      },
      upsert(rows, opts) {
        if (record) calls.push({ kind: 'upsert', table, payload: clone(rows) });
        const run = upsertRows(table, rows, opts?.onConflict);
        run.catch(() => {});
        return { select: () => settle(run), then: (res, rej) => settle(run).then(res, rej) };
      },
      update(patch) {
        if (record) calls.push({ kind: 'update', table, payload: clone(patch) });
        const target = filtering({ select: () => settle(updateRows(table, patch, q.filters)) });
        return target;
      },
      delete() {
        if (record) calls.push({ kind: 'delete', table });
        const target = filtering({ select: () => settle(deleteRows(table, q.filters)) });
        return target;
      },
    });
    return api;
  }

  /* ── Functions ───────────────────────────────────────────────────────── */

  const RPC = {
    /**
     * rc_la_apply(): a batch of look-ahead ops, all or nothing, each checked
     * against the version it expects. A stale op refuses the whole batch with
     * a message starting "conflict:", which is what the editor reloads on.
     */
    async rc_la_apply({ p_ops: ops = [] }) {
      await ensure('rc_la_rows');
      const c = ctx();
      // The month's history file the log goes into, read before it is written.
      await loadFile(`history/${monthOf(c.now)}.json`);
      const results = await tx(async ({ touch, mark }) => {
        touch('rc_la_rows');
        touch('rc_la_cells');
        touch('rc_la_edits');
        const batch = newUuid();
        const out = [];
        const log = (target, rowId, day, action, before, after) => {
          const row = {
            id: nextSequence('rc_la_edits'), at: c.now, by: c.userId, batch, target, row_id: rowId,
            day: day || null, action, before: before ? clone(before) : null, after: after ? clone(after) : null,
          };
          tables.rc_la_edits.push(row);
          mark('rc_la_edits', row);
        };
        const conflict = (what) => fail(`conflict: somebody else changed that ${what} a moment ago — reload the look-ahead`);
        for (const op of ops || []) {
          const expect = Number(op.expect) || 0;
          if (op.op === 'row') {
            const set = op.set || {};
            const hit = tables.rc_la_rows.find((r) => r.id === op.id);
            if (!hit) {
              if (expect !== 0) throw fail('conflict: that row was removed by somebody else — reload the look-ahead');
              const made = {
                id: op.id,
                kind: set.kind ?? 'activity',
                parent_id: set.parent_id || null,
                sort: Number(set.sort ?? 0),
                level: Number(set.level ?? 0),
                activity_id: set.activity_id ?? '',
                description: set.description ?? '',
                location: set.location ?? '',
                sswp: set.sswp ?? '',
                party: set.party ?? '',
                work_hours: set.work_hours ?? '',
                absence_kind: set.absence_kind || null,
                archived: Boolean(set.archived ?? false),
                version: 1,
                updated_at: c.now,
                updated_by: c.userId,
              };
              tables.rc_la_rows.push(made);
              mark('rc_la_rows', made);
              log('row', op.id, null, 'insert', null, made);
              out.push({ kind: 'row', id: op.id, version: 1 });
            } else {
              if ((hit.version || 0) !== expect) throw conflict('row');
              const was = clone(hit);
              for (const k of ['kind', 'activity_id', 'description', 'location', 'sswp', 'party', 'work_hours']) {
                if (k in set) hit[k] = set[k] ?? '';
              }
              if ('sort' in set) hit.sort = Number(set.sort);
              if ('level' in set) hit.level = Number(set.level);
              if ('archived' in set) hit.archived = Boolean(set.archived);
              if ('parent_id' in set) hit.parent_id = set.parent_id || null;
              if ('absence_kind' in set) hit.absence_kind = set.absence_kind || null;
              hit.version = (hit.version || 0) + 1;
              hit.updated_at = c.now;
              hit.updated_by = c.userId;
              mark('rc_la_rows', hit);
              log('row', op.id, null, 'update', was, hit);
              out.push({ kind: 'row', id: op.id, version: hit.version });
            }
          } else if (op.op === 'delete_row') {
            const hit = tables.rc_la_rows.find((r) => r.id === op.id);
            if (hit) {
              if ((hit.version || 0) !== expect) throw conflict('row');
              /* Its cells are logged one by one on the way out, so the record
                 says what was on the row as well as that the row went — and
                 the rows under it go with it, as the foreign key cascaded. */
              for (const cell of tables.rc_la_cells.filter((x) => x.row_id === op.id)) {
                log('cell', cell.row_id, cell.day, 'delete', cell, null);
              }
              log('row', op.id, null, 'delete', hit, null);
              const doomed = new Set([op.id]);
              for (let grew = true; grew;) {
                grew = false;
                for (const r of tables.rc_la_rows) {
                  if (r.parent_id && doomed.has(r.parent_id) && !doomed.has(r.id)) {
                    doomed.add(r.id);
                    grew = true;
                  }
                }
              }
              tables.rc_la_rows = tables.rc_la_rows.filter((r) => !doomed.has(r.id));
              tables.rc_la_cells = tables.rc_la_cells.filter((x) => !doomed.has(x.row_id));
              mark('rc_la_rows', hit);
            }
            out.push({ kind: 'row', id: op.id, version: 0, deleted: true });
          } else if (op.op === 'cell') {
            const day = String(op.day).slice(0, 10);
            const color = op.color ? String(op.color).toUpperCase() : null;
            const text = op.text ?? '';
            if (color && !/^[0-9A-F]{6}$/.test(color)) {
              throw fail('new row for relation "rc_la_cells" violates check constraint "rc_la_cells_color_check"');
            }
            const cells = tables.rc_la_cells;
            const at = cells.findIndex((x) => x.row_id === op.row_id && x.day === day);
            const current = at >= 0 ? cells[at].version || 0 : 0;
            if (current !== expect) throw conflict('day');
            if (!color && !text) {
              if (at >= 0) {
                log('cell', op.row_id, day, 'delete', cells[at], null);
                cells.splice(at, 1);
                mark('rc_la_cells', {});
              }
              out.push({ kind: 'cell', row_id: op.row_id, day, version: 0 });
              continue;
            }
            if (!tables.rc_la_rows.some((r) => r.id === op.row_id)) {
              throw fail('insert or update on table "rc_la_cells" violates foreign key constraint "rc_la_cells_row_id_fkey"');
            }
            if (at >= 0) {
              const was = clone(cells[at]);
              Object.assign(cells[at], { color, text, version: current + 1, updated_at: c.now, updated_by: c.userId });
              mark('rc_la_cells', cells[at]);
              log('cell', op.row_id, day, 'update', was, cells[at]);
              out.push({ kind: 'cell', row_id: op.row_id, day, version: current + 1 });
            } else {
              const made = { row_id: op.row_id, day, color, text, version: 1, updated_at: c.now, updated_by: c.userId };
              cells.push(made);
              mark('rc_la_cells', made);
              log('cell', op.row_id, day, 'insert', null, made);
              out.push({ kind: 'cell', row_id: op.row_id, day, version: 1 });
            }
          } else {
            throw fail(`unknown look-ahead op: ${op.op}`);
          }
        }
        return out;
      });
      // rc_la_edits_ring: an edit logged rings the bell.
      if (ops?.length) ring();
      return results;
    },

    /** The newest change anybody has made, as a number. */
    async rc_la_revision() {
      await loadFile(TABLES.rc_la_edits.sequence);
      return sequenceOf('rc_la_edits');
    },

    /** A batch of a P6 extract, upserted by ID; the last marks what it left out. */
    async rc_p6_import({ p_import: importId, p_rows: input = [], p_finish: finish = false }) {
      if (!importId) throw fail('an import needs an id, shared by its batches');
      await ensure('rc_p6_activities');
      return tx(async ({ touch, mark }) => {
        touch('rc_p6_activities');
        const c = ctx();
        const list = tables.rc_p6_activities;
        const seen = new Set();
        let written = 0;
        for (const r of input || []) {
          const id = String(r?.activity_id ?? '').trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const row = {
            activity_id: id, name: String(r.name ?? '').trim(), wbs: String(r.wbs ?? '').trim(), missing: false,
            import_id: importId, imported_at: c.now, imported_by: c.userId,
          };
          const hit = list.find((a) => a.activity_id === id);
          if (hit) Object.assign(hit, row);
          else list.push(row);
          written++;
        }
        let missing = 0;
        if (finish) {
          for (const a of list) {
            if (a.import_id !== importId && !a.missing) { a.missing = true; missing++; }
          }
        }
        if (written || missing) mark('rc_p6_activities', {});
        return { written, missing };
      });
    },

    /** Revise an approved request: it is superseded and a draft carrying its fields takes its place. */
    async rc_tawr_revise({ p_tawr: id }) {
      await ensure('rc_tawrs');
      return tx(async ({ touch, mark }) => {
        touch('rc_tawrs');
        const c = ctx();
        const old = tables.rc_tawrs.find((r) => r.id === id);
        if (!old) throw fail('no such request');
        if (old.status !== 'approved') throw fail('only an approved request is revised; a draft is edited');
        const next = { ...old, status: 'superseded' };
        guardTawrUpdate(old, next, c);
        Object.assign(old, next);
        const draft = prepareInsert('rc_tawrs', {
          week_start: old.week_start, group_key: old.group_key, location_id: old.location_id,
          location_name: old.location_name, shift: old.shift, fields: clone(old.fields), generated: clone(old.generated),
          source: clone(old.source), snapshot_id: old.snapshot_id, first_day: old.first_day, supersedes: old.id,
        }, c);
        tables.rc_tawrs.push(draft);
        mark('rc_tawrs', draft);
        return draft.id;
      });
    },

    /** A spelling of a place, folded, against names, then aliases, then codes. */
    async rc_resolve_location({ p_raw: raw }) {
      await ensure('rc_locations');
      const fold = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const key = fold(raw);
      if (!key) return null;
      return tables.rc_locations.find((l) => fold(l.name) === key)?.id
        ?? tables.rc_location_alias.find((a) => fold(a.alias) === key)?.location_id
        ?? tables.rc_locations.find((l) => fold(l.code) === key)?.id
        ?? null;
    },

    /**
     * Slim the grids of superseded editor readings past the keep period: every
     * reading of a day but its last, never the newest reading of all. Rows,
     * change events and links stay.
     */
    async rc_compact_snapshots() {
      await ensure('rc_lookahead_snapshots');
      await ensure('rc_settings');
      const setting = tables.rc_settings.find((s) => s.key === 'snapshot_keep_days')?.value;
      const keep = Math.max(14, /^[0-9]{1,5}$/.test(String(setting ?? '')) ? Number(setting) : 60);
      const c = ctx();
      const cutoff = new Date(Date.parse(c.now) - keep * 86400000).toISOString();
      const snaps = tables.rc_lookahead_snapshots;
      const order = (a, b) => compare(b.taken_at, a.taken_at) || compare(b.id, a.id);
      const newest = snaps.slice().sort(order)[0];
      const byDay = new Map();
      for (const s of snaps.filter((x) => String(x.file_hash || '').startsWith('editor:'))) {
        const day = String(new Date(Date.parse(s.taken_at)).toISOString()).slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(s);
      }
      const doomed = [];
      for (const list of byDay.values()) {
        list.sort(order);
        for (const s of list.slice(1)) {
          if (s === newest) continue;
          if (compare(s.taken_at, cutoff) >= 0) continue;
          const summary = s.grid !== undefined ? TABLES.rc_lookahead_snapshots.detached.summary(s.grid) : s.grid_summary || {};
          if (summary.compacted) continue;
          doomed.push(s);
        }
      }
      if (!doomed.length) return 0;
      await hydrate('rc_lookahead_snapshots', doomed);
      return tx(async ({ touch, mark }) => {
        touch('rc_lookahead_snapshots');
        for (const s of doomed) {
          s.grid = {
            compacted: true, compacted_at: c.now,
            row_count: Array.isArray(s.grid?.rows) ? s.grid.rows.length : 0,
            unknown: Array.isArray(s.grid?.unknown) ? s.grid.unknown : [],
            rows: [],
          };
          mark('rc_lookahead_snapshots', s);
          writeDetached('rc_lookahead_snapshots', s);
        }
        return doomed.length;
      });
    },

    /** Somebody on the roster: their aliases, leave and TAWR details go with them. */
    async rc_delete_person({ p_person: id }) {
      for (const t of ['rc_people', 'rc_person_alias', 'rc_leave', 'rc_tawr_profiles']) await ensure(t);
      return tx(async ({ touch, mark }) => {
        if (!tables.rc_people.some((p) => p.id === id)) throw fail('no such person', { code: 'P0002' });
        for (const t of ['rc_people', 'rc_person_alias', 'rc_leave', 'rc_tawr_profiles']) touch(t);
        tables.rc_people = tables.rc_people.filter((p) => p.id !== id);
        tables.rc_person_alias = tables.rc_person_alias.filter((a) => a.person_id !== id);
        tables.rc_leave = tables.rc_leave.filter((l) => l.person_id !== id);
        tables.rc_tawr_profiles = tables.rc_tawr_profiles.filter((p) => p.person_id !== id);
        mark('rc_people', {});
        mark('rc_leave', {});
        mark('rc_tawr_profiles', {});
        return null;
      });
    },

    /** A place nothing has been recorded at. Its spellings go with it. */
    async rc_delete_location({ p_location: id }) {
      for (const t of ['rc_locations', 'rc_location_alias', 'rc_lookahead_rows', 'rc_change_events', 'rc_tawrs']) await ensure(t);
      const held = tables.rc_lookahead_rows.filter((r) => r.location_id === id).length
        + tables.rc_change_events.filter((r) => r.location_id === id).length
        + tables.rc_tawrs.filter((r) => r.location_id === id && r.status !== 'draft').length;
      if (held > 0) {
        throw fail(`there are ${held} record(s) at this location — retire it instead, which keeps every one of them`, { code: '23503' });
      }
      return tx(async ({ touch, mark }) => {
        if (!tables.rc_locations.some((l) => l.id === id)) throw fail('nothing was deleted', { code: 'P0002' });
        touch('rc_locations');
        touch('rc_location_alias');
        tables.rc_locations = tables.rc_locations.filter((l) => l.id !== id);
        tables.rc_location_alias = tables.rc_location_alias.filter((a) => a.location_id !== id);
        mark('rc_locations', {});
        return null;
      });
    },

    async rc_delete_category({ p_category: id }) {
      await ensure('rc_categories');
      return tx(async ({ touch, mark }) => {
        if (!tables.rc_categories.some((x) => x.id === id)) throw fail('nothing was deleted', { code: 'P0002' });
        touch('rc_categories');
        tables.rc_categories = tables.rc_categories.filter((x) => x.id !== id);
        mark('rc_categories', {});
        return null;
      });
    },

    /** A colour mapped by mistake: nothing points at a legend row, so it just goes. */
    async rc_delete_legend({ p_entry: id }) {
      await ensure('rc_legend');
      return tx(async ({ touch, mark }) => {
        if (!tables.rc_legend.some((x) => x.id === id)) throw fail('nothing was deleted', { code: 'P0002' });
        touch('rc_legend');
        tables.rc_legend = tables.rc_legend.filter((x) => x.id !== id);
        mark('rc_legend', {});
        return null;
      });
    },
  };

  /** `rpc(name, args)`, answering `{ data, error }` as the client did. */
  function rpc(name, args = {}) {
    if (record) calls.push({ kind: 'rpc', table: name, payload: clone(args) });
    const fn = RPC[name];
    if (!fn) return Promise.resolve({ data: null, error: { message: `function ${name} does not exist` } });
    return settle(Promise.resolve().then(() => fn(args || {})));
  }

  /* ── Watching the folder ─────────────────────────────────────────────── */

  /**
   * Look for files another computer saved, and read them in.
   *
   * Only files this window has read — a file never read is read fresh when
   * it is first wanted. A file with a change of ours not yet on disk is left
   * alone: the guard will refuse our write and read it then. Answers whether
   * anything changed, and rings the bell when it did.
   */
  async function refresh() {
    let changed = false;
    await queue;
    for (const [path, known] of [...files]) {
      if (dirty.has(path)) continue;
      const stat = await storage.stat(path).catch(() => null);
      if (!stat && (!known || known.absent)) continue;
      if (stat && known?.stamp && stat.size === known.stamp.size && stat.modified === known.stamp.modified) continue;
      const read = stat ? await storage.read(path).catch(() => null) : null;
      if (!read) {
        if (known && !known.absent) {
          files.set(path, { absent: true });
          adopt(path, { tables: {} });
          changed = true;
        }
        continue;
      }
      let body;
      try {
        body = parseFile(path, read.text);
      } catch {
        continue; // half-synced: ask again next time
      }
      const hash = contentHash(body);
      files.set(path, { stamp: read.stamp, hash });
      if (hash === known?.hash) continue;
      adopt(path, body);
      changed = true;
    }
    // A month nobody here has read yet, started on another computer.
    for (const name of [...complete]) {
      const known = new Set(await shardPaths(name));
      for (const p of known) {
        if (!files.has(p)) { await loadFile(p); changed = true; }
      }
    }
    if (changed) {
      version++;
      ring();
    }
    return changed;
  }

  /* ── Opening, creating, replacing ────────────────────────────────────── */

  /** The manifest, or null when this folder holds no calendar yet. */
  async function manifest() {
    const read = await storage.read('db.json').catch(() => null);
    if (!read) return null;
    return parseFile('db.json', read.text);
  }

  /**
   * Write a whole calendar — a new one, or one imported — table by table.
   * Refused over a folder that already holds one unless `replace` is said.
   *
   * @param {Record<string, any[]>} data  rows by table name
   * @param {{ replace?: boolean, source?: string, sequences?: Record<string, number> }} [options]
   */
  async function create(data = {}, { replace = false, source = 'new', sequences = {} } = {}) {
    if (!replace && (await manifest())) throw fail('This folder already holds a calendar.');
    const allowed = canWrite();
    if (allowed !== true) throw fail(String(allowed || 'The calendar is read-only here.'), { readOnly: true });
    await queue;
    for (const name of TABLE_NAMES) tables[name] = [];
    const c = ctx();
    for (const [name, rows] of Object.entries(data || {})) {
      if (!TABLES[name]) continue;
      // Imported rows carry every column already; a new calendar's seeds are given the rest.
      tables[name] = (rows || []).map((r) => {
        const row = { ...(TABLES[name].defaults ? TABLES[name].defaults(c) : {}), ...clone(r) };
        if (keyOf(name).join() === 'id' && isNil(row.id)) row.id = newUuid();
        return row;
      });
    }
    const seqPath = TABLES.rc_la_edits.sequence;
    const maxEdit = tables.rc_la_edits.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    meta.set(seqPath, { sequences: { rc_la_edits: Math.max(maxEdit, Number(sequences.rc_la_edits) || 0) } });
    const paths = new Set(['editor.json', REGISTERS]);
    for (const name of TABLE_NAMES) {
      const def = TABLES[name];
      if (def.file) paths.add(def.file);
      for (const row of tables[name]) paths.add(filePathOf(name, row));
    }
    const grids = [];
    for (const s of tables.rc_lookahead_snapshots) {
      if (s.grid !== undefined) grids.push(s);
    }
    for (const s of grids) writeDetached('rc_lookahead_snapshots', s);
    /* Replacing: whatever the folder held that the new calendar does not —
       a month of history, a reading's grid — goes, or it would be read in
       beside it the first time somebody asked. */
    if (replace) {
      const dirs = new Set(['', 'history', 'changes', 'readings', 'readings/grids', 'tawr']);
      const keep = new Set([...paths, ...detachedOut.keys(), 'db.json']);
      for (const dir of dirs) {
        for (const f of await storage.list(dir).catch(() => [])) {
          const path = dir ? `${dir}/${f.name}` : f.name;
          if (/\.json$/.test(path) && !keep.has(path)) await storage.remove(path).catch(() => false);
        }
      }
    }
    dirty = paths;
    files.clear();
    loading.clear();
    for (const p of paths) loading.set(p, Promise.resolve());
    for (const name of TABLE_NAMES) if (TABLES[name].shard) complete.add(name);
    // Known now: written below, so a stat before this window's write is not a stranger's.
    for (const p of paths) {
      const stat = await storage.stat(p).catch(() => null);
      if (stat) {
        const read = await storage.read(p).catch(() => null);
        files.set(p, { stamp: stat, hash: read ? contentHash(parseFile(p, read.text)) : null });
      }
    }
    await flush();
    const at = now().toISOString();
    await storage.write('db.json', JSON.stringify({
      format: FORMAT, formatVersion: FORMAT_VERSION, created: at, createdBy: who()?.name || '', source,
    }, null, 1), null);
    version++;
    ring();
  }

  const api = {
    from,
    rpc,
    manifest,
    create,
    refresh,
    retry,
    /** Read every table in now — what the tests and the importer's checks want. */
    async loadAll() {
      for (const name of TABLE_NAMES) await ensure(name);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    takenAt,
    /** Every row in memory, by table — live, for the tests. */
    tables,
    calls,
    revision: () => sequenceOf('rc_la_edits'),
    /** Forget the views computed so far, so the next question derives them again. */
    invalidate() {
      version++;
    },
    /** True while a change of ours has not reached the disk. */
    unsaved: () => dirty.size > 0,
  };
  return api;
}
