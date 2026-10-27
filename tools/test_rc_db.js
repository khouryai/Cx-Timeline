#!/usr/bin/env node
/**
 * The calendar's database — `core/rc_db.js` — in Node, over a folder in memory.
 *
 * Postgres used to keep these rules: an edit to the look-ahead is all or
 * nothing and refused when stale, an approved TAWR is final, a cancellation is
 * in the log only while the newest reading covering the day still shows it.
 * They are JavaScript now, and this is where they are held to it — together
 * with what the folder adds: every table in the right file, nothing written
 * over another computer's save, and a change seen when OneDrive brings it down.
 *
 *   node tools/test_rc_db.js
 */

import { createDb, TABLE_NAMES, FORMAT } from '../src/core/rc_db.js';

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  const line = `${name}${detail ? ` — ${detail}` : ''}`;
  if (ok) {
    passed++;
    console.log(`  ✓ ${line}`);
  } else {
    failures.push(line);
    console.log(`  ✗ ${line}`);
  }
}

/**
 * A folder in memory, shaped like `core/rc_folder.js`: paths relative to the
 * calendar's folder, a stamp per file that moves on every write, and a write
 * that refuses when the file is not the one the caller expected.
 */
function memoryFolder() {
  const files = new Map();
  let tick = 1000;
  const store = {
    files,
    writes: 0,
    failNext: null,
    async read(path) {
      const f = files.get(path);
      return f ? { text: f.text, stamp: { size: f.text.length, modified: f.modified } } : null;
    },
    async stat(path) {
      const f = files.get(path);
      return f ? { size: f.text.length, modified: f.modified } : null;
    },
    async write(path, text, expected) {
      if (store.failNext && store.failNext(path)) {
        store.failNext = null;
        throw new Error(`the disk refused ${path}`);
      }
      const f = files.get(path);
      if (expected && f && (f.text.length !== expected.size || f.modified !== expected.modified)) {
        throw Object.assign(new Error('moved'), { kind: 'conflict' });
      }
      tick += 1;
      files.set(path, { text, modified: tick });
      store.writes++;
      return { size: text.length, modified: tick };
    },
    async list(dir) {
      const prefix = dir ? `${dir}/` : '';
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map((k) => ({ name: k.slice(prefix.length) }));
    },
    async remove(path) {
      return files.delete(path);
    },
    /** Another computer's save: the same file, new contents, a new stamp. */
    theirs(path, mutate) {
      const f = files.get(path);
      const body = JSON.parse(f.text);
      mutate(body);
      tick += 1;
      files.set(path, { text: JSON.stringify(body), modified: tick });
    },
    /** OneDrive re-stamping a file it has just synced: same bytes, new time. */
    touch(path) {
      tick += 1;
      files.get(path).modified = tick;
    },
  };
  return store;
}

const NOW = new Date('2026-09-23T14:00:00Z');
let clock = NOW;
const open = (folder, extra = {}) => createDb({
  storage: folder,
  who: () => ({ userId: 'user-1', personId: 'p1', name: 'Alex' }),
  now: () => clock,
  ...extra,
});
const iso = (offset) => new Date(NOW.getTime() + offset * 86400000).toISOString().slice(0, 10);
const json = (folder, path) => JSON.parse(folder.files.get(path).text);

/* ── Creating, and reading back ──────────────────────────────────────── */

console.log('\nA calendar in a folder');
{
  const folder = memoryFolder();
  const db = open(folder);
  check('an empty folder holds no calendar', (await db.manifest()) === null);
  await db.create({
    rc_people: [{ id: 'p1', name: 'Alex', role: 'admin', user_id: 'user-1' }, { id: 'p2', name: 'Dan' }],
    rc_legend: [{ id: 'lg1', argb: 'FF0000', meaning: 'Cancellation', valid_from: '2026-01-01' }],
    rc_settings: [{ key: 'lookahead_sheet', value: '4WLA' }],
  });
  check('creating it writes the manifest last, with the format', json(folder, 'db.json').format === FORMAT);
  check('the registers are one file', Boolean(folder.files.get('registers.json')));
  const reg = json(folder, 'registers.json');
  check('which holds the people, the legend and the settings',
    reg.tables.rc_people.length === 2 && reg.tables.rc_legend.length === 1 && reg.tables.rc_settings.length === 1);
  check('and says who saved it, outside what is compared', reg.savedBy === 'Alex' && Boolean(reg.savedAt));
  check('the editor and the leave have files of their own',
    Boolean(folder.files.get('editor.json')) && Boolean(folder.files.get('leave.json')));
  check('a second create over the same folder is refused',
    await db.create({}).then(() => false, (e) => /already holds a calendar/.test(e.message)));

  const again = open(folder);
  const { data: people } = await again.from('rc_people').select('*').order('name');
  check('a second window reads the same rows', people.map((p) => p.name).join() === 'Alex,Dan');
  check('with the defaults a column was given', people[1].active === true && people[1].role === 'member'
    && JSON.stringify(people[1].working_days) === '[1,2,3,4,5]' && people[1].scheduled === true);
}

/* ── Asking questions ─────────────────────────────────────────────────── */

console.log('\nThe builder, as PostgREST answered it');
{
  const folder = memoryFolder();
  const db = open(folder);
  await db.create({
    rc_leave: [
      { id: 'a', person_id: 'p1', start_date: '2026-09-01', end_date: '2026-09-03', status: 'approved' },
      { id: 'b', person_id: 'p2', start_date: '2026-09-20', end_date: '2026-09-30', status: 'cancelled' },
      { id: 'c', person_id: 'p2', start_date: '2026-09-25', end_date: '2026-09-26', status: 'approved' },
      { id: 'd', person_id: 'p3', start_date: '2026-10-10', end_date: '2026-10-12', status: 'requested', note: null },
    ],
  });
  const ids = (r) => (r.data || []).map((x) => x.id).join('');
  check('lte and gte bound a window, both ends inclusive',
    ids(await db.from('rc_leave').select('*').lte('start_date', '2026-09-30').gte('end_date', '2026-09-03').order('id')) === 'abc');
  check('neq leaves the cancelled out',
    ids(await db.from('rc_leave').select('*').neq('status', 'cancelled').order('id')) === 'acd');
  check('eq and in filter', ids(await db.from('rc_leave').select('*').eq('person_id', 'p2').order('id')) === 'bc'
    && ids(await db.from('rc_leave').select('*').in('id', ['d', 'a']).order('id')) === 'ad');
  check('is(null) finds the empty column',
    ids(await db.from('rc_leave').select('*').is('note', null).order('id')) === 'abcd');
  check('order descending, then by a second column',
    ids(await db.from('rc_leave').select('*').order('person_id', { ascending: false }).order('id')) === 'dbca');
  check('limit and range page through',
    ids(await db.from('rc_leave').select('*').order('id').limit(2)) === 'ab'
    && ids(await db.from('rc_leave').select('*').order('id').range(1, 2)) === 'bc');
  const counted = await db.from('rc_leave').select('*', { count: 'exact' }).order('id').range(0, 0);
  check('count: exact answers how many match before the range cuts them', counted.count === 4 && counted.data.length === 1);
  const projected = await db.from('rc_leave').select('id,status').eq('id', 'a');
  check('a column list returns only those columns', JSON.stringify(projected.data[0]) === '{"id":"a","status":"approved"}');
  const single = await db.from('rc_leave').select('*').eq('id', 'zzz').maybeSingle();
  check('maybeSingle answers null for nothing', single.data === null && single.error === null);
  const one = (await db.from('rc_leave').select('*').eq('id', 'a')).data[0];
  one.status = 'changed by the caller';
  check('a row handed back is a copy, so a screen cannot change the table by accident',
    (await db.from('rc_leave').select('*').eq('id', 'a')).data[0].status === 'approved');
  const missing = await db.from('rc_nothing').select('*');
  check('a table that does not exist is an error, not an empty list', Boolean(missing.error) && missing.data === null);
}

/* ── Writing ──────────────────────────────────────────────────────────── */

console.log('\nWrites');
{
  const folder = memoryFolder();
  const db = open(folder);
  await db.create({ rc_locations: [{ id: 'l1', name: 'TPSS 12', code: 'T12' }] });
  const made = await db.from('rc_locations').insert([{ name: 'Station 6' }]).select();
  check('an insert answers the row with an id and its defaults',
    !made.error && /^[0-9a-f-]{36}$/.test(made.data[0].id) && made.data[0].active === true);
  const twice = await db.from('rc_locations').insert([{ name: 'TPSS 12' }]).select();
  check('a unique name is refused the way Postgres refused it',
    /duplicate key value violates unique constraint/.test(twice.error?.message || ''));
  check('and nothing of the refused insert is kept',
    (await db.from('rc_locations').select('*')).data.length === 2);
  const upd = await db.from('rc_locations').update({ code: 'S6' }).eq('id', made.data[0].id).select();
  check('an update answers the rows it changed', upd.data.length === 1 && upd.data[0].code === 'S6');
  const none = await db.from('rc_locations').update({ code: 'X' }).eq('id', 'nobody').select();
  check('and an empty list when it matched nothing — what the caller raises on', none.data.length === 0);
  check('the write reached the file', json(folder, 'registers.json').tables.rc_locations.some((l) => l.code === 'S6'));

  await db.from('rc_legend').upsert([{ argb: 'FFFF00', meaning: 'Day Shift' }], { onConflict: 'valid_from,argb' }).select();
  await db.from('rc_legend').upsert([{ argb: 'FFFF00', meaning: 'Day shift (corrected)' }], { onConflict: 'valid_from,argb' }).select();
  const legend = (await db.from('rc_legend').select('*')).data;
  check('mapping a colour twice in a day upserts on (valid_from, argb)', legend.length === 1 && /corrected/.test(legend[0].meaning)
    && legend[0].valid_from === '2026-09-23');

  await db.from('rc_settings').upsert({ key: 'lookahead_title', value: 'BART 4WLA' }, { onConflict: 'key' }).select();
  await db.from('rc_settings').upsert({ key: 'lookahead_title', value: 'BART 4WLA v2' }, { onConflict: 'key' }).select();
  const settings = (await db.from('rc_settings').select('*')).data;
  check('a setting is upserted on its key and stamped with who', settings.length === 1 && settings[0].value === 'BART 4WLA v2'
    && settings[0].updated_by === 'user-1');

  const del = await db.from('rc_locations').delete().eq('id', 'l1').select();
  check('a delete answers what went', del.data.length === 1 && (await db.from('rc_locations').select('*')).data.length === 1);
}

/* ── TAWRs: approved is final ─────────────────────────────────────────── */

console.log('\nTAWRs');
{
  const folder = memoryFolder();
  const db = open(folder);
  await db.create({});
  const draft = (await db.from('rc_tawrs').insert([{ week_start: '2026-09-21', group_key: 'T12|day', shift: 'day', status: 'approved' }]).select()).data[0];
  check('a request starts as a draft, raised by whoever made it, whatever it was sent as',
    draft.status === 'draft' && draft.created_by === 'p1' && draft.approved_by === null);
  const ok = await db.from('rc_tawrs').update({ status: 'approved' }).eq('id', draft.id).select();
  check('approving stamps who and when', ok.data[0].approved_by === 'p1' && ok.data[0].approved_at === NOW.toISOString());
  const refused = await db.from('rc_tawrs').update({ fields: { a: 1 } }).eq('id', draft.id).select();
  check('an approved request cannot be edited', /approved request is final/.test(refused.error?.message || ''));
  const gone = await db.from('rc_tawrs').delete().eq('id', draft.id).select();
  check('nor discarded — only a draft can be', gone.data.length === 0);
  const revised = await db.rpc('rc_tawr_revise', { p_tawr: draft.id });
  const all = (await db.from('rc_tawrs').select('*').order('created_at')).data;
  const next = all.find((r) => r.id === revised.data);
  check('revising supersedes it with a draft carrying its fields',
    all.find((r) => r.id === draft.id).status === 'superseded' && next.status === 'draft' && next.supersedes === draft.id);
  const again = await db.rpc('rc_tawr_revise', { p_tawr: next.id });
  check('and only an approved request is revised', /only an approved request/.test(again.error?.message || ''));
}

/* ── The look-ahead editor's one write ────────────────────────────────── */

console.log('\nrc_la_apply');
{
  const folder = memoryFolder();
  const db = open(folder);
  await db.create({});
  const first = await db.rpc('rc_la_apply', {
    p_ops: [
      { op: 'row', id: 'r1', set: { kind: 'activity', description: 'IXL testing', sort: 10 }, expect: 0 },
      { op: 'cell', row_id: 'r1', day: '2026-09-24', color: 'ffff00', text: 'X', expect: 0 },
    ],
  });
  check('a batch answers the version each op made', !first.error && first.data[0].version === 1 && first.data[1].version === 1);
  const cells = (await db.from('rc_la_cells').select('*')).data;
  check('a colour is stored upper case', cells[0].color === 'FFFF00' && cells[0].updated_by === 'user-1');
  const edits = json(folder, 'history/2026-09.json').tables.rc_la_edits;
  check('every change is logged, in the month\'s history file', edits.length === 2
    && edits.every((e) => e.by === 'user-1' && e.batch === edits[0].batch) && edits[1].after.text === 'X');
  check('the log is numbered, and the number is the revision',
    edits.map((e) => e.id).join() === '1,2' && (await db.rpc('rc_la_revision')).data === 2);

  const before = folder.files.get('editor.json').text;
  const stale = await db.rpc('rc_la_apply', {
    p_ops: [
      { op: 'cell', row_id: 'r1', day: '2026-09-25', color: 'FF0000', text: '', expect: 0 },
      { op: 'cell', row_id: 'r1', day: '2026-09-24', color: 'FF0000', text: '', expect: 0 },
    ],
  });
  check('a stale op refuses the whole batch with "conflict:"', /^conflict:/.test(stale.error?.message || ''));
  check('and nothing of it is kept — in memory', (await db.from('rc_la_cells').select('*')).data.length === 1);
  check('or on disk', folder.files.get('editor.json').text === before && (await db.rpc('rc_la_revision')).data === 2);

  await db.rpc('rc_la_apply', { p_ops: [{ op: 'row', id: 'r2', set: { kind: 'resource', parent_id: 'r1' }, expect: 0 }] });
  await db.rpc('rc_la_apply', { p_ops: [{ op: 'cell', row_id: 'r2', day: '2026-09-24', text: 'Dan', expect: 0 }] });
  const removed = await db.rpc('rc_la_apply', { p_ops: [{ op: 'delete_row', id: 'r1', expect: 1 }] });
  check('deleting a row takes its cells and the rows under it', !removed.error
    && (await db.from('rc_la_rows').select('*')).data.length === 0 && (await db.from('rc_la_cells').select('*')).data.length === 0);
  const log = (await db.from('rc_la_edits').select('*').order('id')).data;
  check('and logs the cells going before the row', log.slice(-2).map((e) => `${e.target}:${e.action}`).join() === 'cell:delete,row:delete');

  const orphan = await db.rpc('rc_la_apply', { p_ops: [{ op: 'cell', row_id: 'nope', day: '2026-09-24', text: 'x', expect: 0 }] });
  check('a cell on no row is refused', /foreign key/.test(orphan.error?.message || ''));

  clock = new Date('2026-10-02T09:00:00Z');
  await db.rpc('rc_la_apply', { p_ops: [{ op: 'row', id: 'r3', set: { description: 'October' }, expect: 0 }] });
  clock = NOW;
  check('a new month starts a new history file, and the numbering carries on',
    json(folder, 'history/2026-10.json').tables.rc_la_edits[0].id === log.length + 1);

  const fresh = open(folder);
  const between = await fresh.from('rc_la_edits').select('*').gte('at', '2026-10-01').lte('at', '2026-10-31').order('id');
  check('a window that reads one month reads that month', between.data.length === 1 && between.data[0].row_id === 'r3');
  check('and the revision survives a reload', (await fresh.rpc('rc_la_revision')).data === log.length + 1);
}

/* ── The guard: never over another computer's save ───────────────────── */

console.log('\nThe folder guard');
{
  const folder = memoryFolder();
  const db = open(folder);
  await db.create({ rc_parties: [{ id: 'x', name: 'BART' }] });
  await db.from('rc_parties').select('*');

  folder.touch('registers.json');
  const restamped = await db.from('rc_parties').insert([{ name: 'Hitachi' }]).select();
  check('OneDrive re-stamping a file with the same bytes does not refuse the save', !restamped.error);

  folder.theirs('registers.json', (body) => body.tables.rc_parties.push({ id: 'y', name: 'Vendor', active: true }));
  const refused = await db.from('rc_parties').insert([{ name: 'Other team' }]).select();
  check('a file another computer saved is never written over', /^conflict:/.test(refused.error?.message || ''));
  const names = (await db.from('rc_parties').select('*').order('name')).data.map((p) => p.name).join();
  check('their version is read in, and the refused change is not kept', names === 'BART,Hitachi,Vendor', names);
  check('the file is theirs, untouched', json(folder, 'registers.json').tables.rc_parties.length === 3);
  const after = await db.from('rc_parties').insert([{ name: 'Other team' }]).select();
  check('and the change goes in once made again', !after.error && json(folder, 'registers.json').tables.rc_parties.length === 4);

  const reader = open(folder);
  let rang = 0;
  reader.onChange(() => { rang++; });
  await reader.from('rc_parties').select('*');
  folder.theirs('registers.json', (body) => body.tables.rc_parties.push({ id: 'z', name: 'Subcontractor', active: true }));
  const changed = await reader.refresh();
  check('a window watching the folder reads another computer\'s save', changed
    && (await reader.from('rc_parties').select('*')).data.length === 5);
  check('and rings the bell for it', rang === 1);
  check('a refresh with nothing new changes nothing', (await reader.refresh()) === false && rang === 1);

  folder.failNext = (path) => path === 'registers.json';
  const failed = await db.from('rc_parties').insert([{ name: 'Lost' }]).select();
  check('a write the disk refuses fails, and is taken back out of memory', Boolean(failed.error)
    && !(await db.from('rc_parties').select('*')).data.some((p) => p.name === 'Lost'));

  const locked = open(folder, { canWrite: () => 'Dana is editing the calendar.' });
  const ro = await locked.from('rc_parties').insert([{ name: 'Nope' }]).select();
  check('without the pen every write is refused, saying who has it', ro.error?.message === 'Dana is editing the calendar.');
}

/* ── Readings: grids apart, rows by the month ─────────────────────────── */

console.log('\nReadings');
{
  const folder = memoryFolder();
  const db = open(folder);
  await db.create({ rc_legend: [{ id: 'lg', argb: 'FF0000', meaning: 'Cancellation', valid_from: '2026-01-01' }] });
  const grid = { rows: [{ row: 1, cells: [] }, { row: 2, cells: [] }], unknown: ['ABCDEF'], merges: [] };
  const snap = (await db.from('rc_lookahead_snapshots').insert({ file_hash: 'editor:aaa', sheet_name: '4WLA', grid }).select()).data[0];
  check('a reading answers with its grid', snap.grid.rows.length === 2);
  check('the grid is kept in a file of its own', Boolean(folder.files.get(`readings/grids/${snap.id}.json`)));
  const index = json(folder, 'readings/index.json').tables.rc_lookahead_snapshots[0];
  check('and the index carries the reading without it', index.grid === undefined && index.grid_summary.row_count === 2);
  const dup = await db.from('rc_lookahead_snapshots').insert({ file_hash: 'editor:aaa', sheet_name: '4WLA', grid }).select();
  check('a fingerprint already taken is refused, as unique (file_hash) refused it', /duplicate key/.test(dup.error?.message || ''));

  await db.from('rc_lookahead_rows').insert([
    { snapshot_id: snap.id, week_start: '2026-09-21', row_key: 'k1', raw_label: 'IXL', cells: { '2026-09-24': 'Cancellation' } },
  ]).select();
  check('its rows are filed under the month it was taken', json(folder, 'readings/rows-2026-09.json').tables.rc_lookahead_rows.length === 1);

  const fresh = open(folder);
  const meta = (await fresh.from('rc_lookahead_snapshot_meta').select('*')).data[0];
  check('the metadata view counts rows and unmapped colours without opening the grid',
    meta.row_count === 2 && meta.unmapped_count === 1 && meta.compacted === false);
  const latest = (await fresh.from('rc_lookahead_snapshots').select('*').order('taken_at', { ascending: false }).limit(1)).data[0];
  check('asking for the reading reads its grid then', latest.grid.rows.length === 2);
  const rows = await fresh.from('rc_lookahead_rows').select('*').eq('snapshot_id', snap.id);
  check('and a reading\'s rows are read from its month', rows.data.length === 1);
}

/* ── The cancellation log: what the look-ahead says now ───────────────── */

console.log('\nrc_cancelled_days and rc_cancelled_support_days');
{
  const folder = memoryFolder();
  const db = open(folder);
  const at = (d) => `${iso(d)}T08:00:00.000Z`;
  await db.create({
    rc_legend: [{ id: 'lg', argb: 'FF0000', meaning: 'Cancellation', valid_from: '2026-01-01' }],
    rc_lookahead_snapshots: [
      { id: 'old1', taken_at: at(-21), file_hash: 'a', sheet_name: '4WLA', grid: { rows: [] } },
      { id: 'old2', taken_at: at(-18), file_hash: 'b', sheet_name: '4WLA', grid: { rows: [] } },
      { id: 'new', taken_at: at(-1), file_hash: 'editor:c', sheet_name: '4WLA', grid: { rows: [] } },
    ],
    rc_lookahead_rows: [
      { id: 'r1', snapshot_id: 'old1', week_start: iso(-21), row_key: 'k', raw_label: 'Cable pull', raw_location: 'TPSS 12',
        cells: Object.fromEntries([-20, -19, -18, -17, -16].map((d) => [iso(d), 'Cancellation'])), bart_marks: { [iso(-20)]: 'X.WIT' } },
      { id: 'r2', snapshot_id: 'old2', week_start: iso(-21), row_key: 'k', raw_label: 'Cable pull', raw_location: 'TPSS 12',
        cells: { [iso(-17)]: 'Cancellation', [iso(-16)]: 'Cancellation', [iso(-15)]: 'Day Shift', [iso(-13)]: '#FF0000' } },
      { id: 'r3', snapshot_id: 'new', week_start: iso(-7), row_key: 'k2', raw_label: 'IXL', raw_location: 'S6', la_row_id: 'la1',
        cells: { [iso(-2)]: 'Day Shift', [iso(0)]: 'Day Shift' }, bart_marks: { [iso(-2)]: 'X.~WIT', [iso(0)]: 'X.WIT' } },
    ],
  });
  const red = (await db.from('rc_cancelled_days').select('*').order('day')).data;
  const days = red.map((r) => r.day);
  check('days the newest covering reading still shows red are in the log',
    days.includes(iso(-17)) && days.includes(iso(-16)) && days.includes(iso(-13)));
  check('a day a later reading covers and no longer shows red is not',
    !days.includes(iso(-15)), days.join(' '));
  check('a day only an older reading had, before the later one\'s span, keeps it',
    days.includes(iso(-20)) && days.includes(iso(-19)) && days.includes(iso(-18)));
  check('the bare colour of a cancellation counts as one', days.includes(iso(-13)));
  const row = red.find((r) => r.day === iso(-17));
  check('a day carries how many reads showed it, and when first and last',
    row.reads === 2 && row.first_seen === at(-21) && row.last_seen === at(-18));
  check('and the marks of the newest read, cancelled with it', red.find((r) => r.day === iso(-20)).marks === 'X.WIT');
  const struck = (await db.from('rc_cancelled_support_days').select('*')).data;
  check('a BART code struck out on a day still going ahead is a support cancellation',
    struck.length === 1 && struck[0].day === iso(-2) && struck[0].marks === 'X.~WIT' && struck[0].la_row_id === 'la1');
  const from = (await db.from('rc_cancelled_days').select('*').gte('day', iso(-16)).order('day')).data;
  check('the log is asked from a date on', from.map((r) => r.day).join() === [iso(-16), iso(-13)].join());

  const daysView = (await db.from('rc_lookahead_days').select('*').order('day').order('row_id')).data;
  check('the look-ahead day by day reads each week from its newest reading',
    daysView.filter((d) => d.week_start === iso(-21)).every((d) => d.snapshot_id === 'old2')
    && daysView.some((d) => d.snapshot_id === 'new' && d.marks === 'X.~WIT'));
  const books = (await db.from('rc_lookahead_workbook_weeks').select('*')).data;
  check('the workbook\'s weeks are its readings, never an editor\'s', books.length === 1 && books[0].snapshot_id === 'old2');
}

/* ── Functions ────────────────────────────────────────────────────────── */

console.log('\nThe other functions');
{
  const folder = memoryFolder();
  const db = open(folder);
  await db.create({
    rc_locations: [{ id: 'l1', name: 'TPSS 12', code: 'T12' }, { id: 'l2', name: 'Yard 3' }],
    rc_location_alias: [{ id: 'a1', location_id: 'l1', alias: 'Traction Power 12' }],
    rc_lookahead_snapshots: [{ id: 's', taken_at: '2026-09-01T00:00:00.000Z', file_hash: 'f', sheet_name: '4WLA', grid: { rows: [] } }],
    rc_lookahead_rows: [{ id: 'r', snapshot_id: 's', week_start: '2026-08-31', row_key: 'k', location_id: 'l2', cells: {} }],
  });
  const resolve = async (raw) => (await db.rpc('rc_resolve_location', { p_raw: raw })).data;
  check('a place resolves by name, alias or code, folded',
    (await resolve('tpss-12')) === 'l1' && (await resolve('TRACTION POWER 12')) === 'l1' && (await resolve('t12')) === 'l1');
  check('and a spelling nobody knows resolves to nothing', (await resolve('W30')) === null && (await resolve('')) === null);
  const held = await db.rpc('rc_delete_location', { p_location: 'l2' });
  check('a location a reading names cannot be deleted, and says retire instead', /retire it instead/.test(held.error?.message || ''));
  const freed = await db.rpc('rc_delete_location', { p_location: 'l1' });
  check('one nothing names can, and its spellings go with it', !freed.error
    && (await db.from('rc_location_alias').select('*')).data.length === 0);

  const imp1 = await db.rpc('rc_p6_import', { p_import: 'i1', p_rows: [{ activity_id: ' A1 ', name: 'One' }, { activity_id: 'A2', name: 'Two' }], p_finish: true });
  const imp2 = await db.rpc('rc_p6_import', { p_import: 'i2', p_rows: [{ activity_id: 'A1', name: 'One, renamed' }], p_finish: true });
  const acts = (await db.from('rc_p6_activities').select('*').order('activity_id')).data;
  check('a P6 extract is upserted by its ID, trimmed', imp1.data.written === 2 && acts[0].activity_id === 'A1' && acts[0].name === 'One, renamed');
  check('and what the next extract leaves out is marked missing, never deleted',
    imp2.data.missing === 1 && acts.length === 2 && acts[1].missing === true);
}

/* ── Compaction ───────────────────────────────────────────────────────── */

console.log('\nrc_compact_snapshots');
{
  const folder = memoryFolder();
  const db = open(folder);
  const big = { rows: [{ row: 1 }, { row: 2 }, { row: 3 }], unknown: [] };
  await db.create({
    rc_lookahead_snapshots: [
      { id: 'a', taken_at: '2026-06-01T09:00:00.000Z', file_hash: 'editor:1', sheet_name: '4WLA', grid: big },
      { id: 'b', taken_at: '2026-06-01T15:00:00.000Z', file_hash: 'editor:2', sheet_name: '4WLA', grid: big },
      { id: 'c', taken_at: '2026-06-02T09:00:00.000Z', file_hash: 'book', sheet_name: '4WLA', grid: big },
      { id: 'd', taken_at: '2026-09-22T09:00:00.000Z', file_hash: 'editor:3', sheet_name: '4WLA', grid: big },
      { id: 'e', taken_at: '2026-09-22T10:00:00.000Z', file_hash: 'editor:4', sheet_name: '4WLA', grid: big },
    ],
  });
  const n = (await db.rpc('rc_compact_snapshots')).data;
  check('only an editor reading superseded the same day, past the keep period, is slimmed', n === 1);
  const meta = (await db.from('rc_lookahead_snapshot_meta').select('*').order('id')).data;
  check('it keeps its row count and says it was compacted', meta[0].compacted === true && meta[0].row_count === 3
    && meta.slice(1).every((m) => !m.compacted));
  check('and its grid file is gone, the compacted grid kept in the index',
    !folder.files.has('readings/grids/a.json') && folder.files.has('readings/grids/b.json')
    && json(folder, 'readings/index.json').tables.rc_lookahead_snapshots.find((s) => s.id === 'a').grid.compacted === true);
  check('a second run changes nothing', (await db.rpc('rc_compact_snapshots')).data === 0);
}

/* ── Replacing a calendar, as the importer does ───────────────────────── */

console.log('\nReplacing');
{
  const folder = memoryFolder();
  const db = open(folder);
  await db.create({ rc_la_edits: [{ id: 5, at: '2026-01-02T00:00:00.000Z', batch: 'b', target: 'row', row_id: 'x', action: 'insert' }] });
  check('an import keeps the edit log\'s numbers', (await db.rpc('rc_la_revision')).data === 5);
  await db.create({ rc_people: [{ id: 'p', name: 'Only' }] }, { replace: true });
  check('replacing removes the files the new calendar does not have', !folder.files.has('history/2026-01.json'));
  const fresh = open(folder);
  check('and a fresh window reads only the new one', (await fresh.from('rc_la_edits').select('*')).data.length === 0
    && (await fresh.from('rc_people').select('*')).data.length === 1);
  check('every table the calendar keeps has a home', TABLE_NAMES.length >= 25);
}

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
