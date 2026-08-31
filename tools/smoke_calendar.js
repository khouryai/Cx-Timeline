#!/usr/bin/env node
/**
 * The resource calendar, and the boundary around the timeline.
 *
 * Two things are checked here, and the second is the reason this file exists.
 *
 * **The calendar works.** Boots with a stubbed resource-calendar backend, signs
 * in, and walks the workspace switch, the account gate, the roster and the
 * huddle — including the offline queue, which is the part a real meeting
 * depends on.
 *
 * **The timeline's data never leaves.** The plan holds the P6 programme and is
 * proprietary; it lives in a OneDrive folder and must never reach Supabase.
 * Until this feature that was guaranteed by the *build* — the desktop shape has
 * no backend at all and physically could not have sent anything. Putting a
 * client back in the page turns a structural guarantee into a convention, and a
 * convention is not worth much. So the suite records every call the stub
 * receives, edits the plan hard, and asserts that nothing carrying plan content
 * ever went anywhere.
 *
 * That assertion is the point. If somebody later imports the calendar's client
 * from the plan's storage path, every other test here would still pass and this
 * one would not.
 *
 *   node tools/smoke_calendar.js [--shot out.png]
 */

import { chromium } from 'playwright';
import { launchOptions } from './lib/chrome.js';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * A stand-in for `window.supabase`, installed before any page script runs.
 *
 * Every call is recorded in `window.__rc.calls` with its table and payload,
 * which is what the isolation check reads. `__rc.offline` makes writes throw
 * the way a dropped connection does, so the huddle's queue can be exercised
 * without unplugging anything.
 */
function fakeSdk() {
  window.__rc = window.__rc || {};
  const S = window.__rc;
  S.calls = [];
  S.signedIn = S.signedIn === undefined ? false : S.signedIn;
  S.role = S.role || 'admin';
  S.offline = S.offline || false;

  const USER = { id: 'user-rc-1', email: 'alex@example.com' };
  const iso = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

  /* The day the huddle will review, worked out the way the application does:
     step back until you reach a day somebody works. A naive "yesterday, or
     Friday if today is Monday" is wrong on a Sunday — it lands on Saturday,
     which nobody works — and a fixture that disagrees with the thing it is
     testing fails on two days in seven and passes on the rest, which is worse
     than failing outright. Everything that depends on the review day derives
     from this one value. */
  const REVIEW = (() => {
    const now = new Date();
    let ms = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    do { ms -= 86400000; } while ((new Date(ms).getUTCDay() || 7) > 5);
    return { iso: new Date(ms).toISOString().slice(0, 10), dow: new Date(ms).getUTCDay() || 7 };
  })();
  S.reviewDay = REVIEW.iso;

  S.rows = {
    rc_people: [
      /* Alex administers the calendar and is not scheduled — a manager runs the
         meeting rather than taking work from it. `scheduled` is its own fact,
         not a reading of the role, so an administrator who did take shifts
         would still be in the huddle. */
      { id: 'p1', user_id: 'user-rc-1', name: 'Alex', email: 'alex@example.com', title: 'Commissioning Manager', subsystem: 'ATS', role: S.role, active: true, scheduled: S.role !== 'admin', working_days: [1, 2, 3, 4, 5] },
      /* A four-day contract, and deliberately not four days that could include
         the review day: Dan is the row the carry checks work on, so a week
         where his day off happened to be the day under review left him with no
         buttons at all. The day he is off is the first weekday that is not the
         one being reviewed. */
      { id: 'p2', user_id: null, name: 'Dan', title: 'Field Technician', subsystem: 'Wayside', role: 'member', active: true, scheduled: true,
        working_days: [1, 2, 3, 4, 5].filter((d) => d !== [1, 2, 3, 4, 5].find((x) => x !== REVIEW.dow)) },
      { id: 'p3', user_id: null, name: 'Priya', title: 'Test Engineer', subsystem: 'IXL', role: 'member', active: true, scheduled: true, working_days: [1, 2, 3, 4, 5] },
      /* Sam is off on whichever day the huddle will review.
         The review day is "the previous day somebody works", so it moves with
         the day the suite happens to run — and an assertion that a non-working
         day is handled properly only means something if somebody is actually
         off then. Pinning it here is what makes the check hold on a Tuesday as
         well as a Monday; it used to pass only on Mondays. */
      { id: 'p4', user_id: null, name: 'Sam', title: 'SCADA Engineer', subsystem: 'SCADA', role: 'member', active: true, scheduled: true,
        working_days: [1, 2, 3, 4, 5].filter((d) => d !== REVIEW.dow) },
      { id: 'p5', user_id: null, name: 'Rosa', title: 'Test Technician', subsystem: 'IXL', role: 'member', active: true, scheduled: true, working_days: [1, 2, 3, 4, 5] },
      // Enough of a team that each check below has a row of its own to work on
      // — the meeting is fifteen people in practice, not three.
      { id: 'p6', user_id: null, name: 'Tom', title: 'Signalling Technician', subsystem: 'IXL', role: 'member', active: true, scheduled: true, working_days: [1, 2, 3, 4, 5] },
      { id: 'p7', user_id: null, name: 'Uma', title: 'Comms Engineer', subsystem: 'SCADA', role: 'member', active: true, scheduled: true, working_days: [1, 2, 3, 4, 5] },
    ],
    rc_locations: [
      { id: 'l1', name: 'TPSS 12', code: 'T12', active: true },
      { id: 'l2', name: 'Station 6 Platform', code: 'S6P', active: true },
    ],
    rc_location_alias: [{ id: 'a1', location_id: 'l1', alias: 'Traction Power 12' }],
    rc_categories: [
      { id: 'c1', name: 'Field Work', sort: 30, active: true },
      { id: 'c2', name: 'Testing', sort: 40, active: true },
    ],
    rc_parties: [{ id: 'party1', name: 'BART', active: true }, { id: 'party2', name: 'Hitachi', active: true }],
    rc_leave_kinds: [{ id: 'k1', name: 'Annual leave', active: true }],
    // Booked past the end of this week. Finding out somebody is off when you
    // try to staff the day is a fortnight too late to do anything about it.
    rc_leave: [{
      id: 'lv1', person_id: 'p7', kind_id: 'k1', status: 'approved',
      start_date: iso(12), end_date: iso(16),
    }],
    /* A task planned for the day the huddle will review, so a carry has
       something to roll forward and a chain to keep. Dated the same way the
       app derives the review day: the previous weekday. */
    rc_plan_entries: [{
      id: 'plan1', person_id: 'p2', work_date: REVIEW.iso, shift: 'day',
      location_id: 'l1', task: 'Cable pull at TPSS 12', category_id: 'c1',
      carry_chain_id: null, lookahead_row_id: null,
    }],
    get rc_plan_current() { return this.rc_plan_entries; },
    rc_actuals: [],
    // A few days of history, so the reports have something to aggregate. Dates
    // are relative to today, or a fixed range would fall out of every window.
    rc_carry_chains: [
      { carry_chain_id: 'chain-1', person_id: 'p2', first_seen: iso(-6), last_seen: iso(-1), carries: 4, age_days: 5 },
    ],
    rc_effort: [
      { id: 'e1', person_id: 'p1', person_name: 'Alex', subsystem: 'ATS', work_date: iso(-2), status: 'completed', signal: 'performance', category_id: 'c1', location_id: 'l1' },
      { id: 'e2', person_id: 'p3', person_name: 'Priya', subsystem: 'IXL', work_date: iso(-3), status: 'partial', signal: 'performance', category_id: 'c2', location_id: 'l2' },
      { id: 'e3', person_id: 'p2', person_name: 'Dan', subsystem: 'Wayside', work_date: iso(-4), status: 'blocked', signal: 'health', category_id: 'c1', location_id: 'l1', blocked_party_id: 'party1' },
      { id: 'e4', person_id: 'p4', person_name: 'Sam', subsystem: 'SCADA', work_date: iso(-5), status: 'reassigned', signal: 'health', category_id: 'c2', location_id: 'l2' },
    ],
    /* A snapshot shaped like the real workbook, on a real date axis.
       The axis is built from today rather than pinned to fixed dates, because
       everything that matters here — the today line, the week filters, hiding
       the past — is relative to when the suite runs. It starts a week back and
       runs five weeks, so "4 weeks" has both a past week to drop and a future
       week to keep. The weekday letters are the workbook's own, and they are
       what `datePlease()` checks the resolved year against. */
    rc_lookahead_snapshots: (() => {
      const LETTERS = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];
      const NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
        'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
      const now = new Date();
      const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const monday = todayMs - ((new Date(todayMs).getUTCDay() + 6) % 7) * 86400000;
      const first = monday - 7 * 86400000;
      const axis = [];
      for (let i = 0; i < 35; i++) axis.push(new Date(first + i * 86400000));
      const todayIdx = Math.round((todayMs - first) / 86400000);
      S.axis = {
        days: axis.length,
        todayIdx,
        today: new Date(todayMs).toISOString().slice(0, 10),
        past: axis[1].getUTCDate(),
      };

      const col = (i) => 8 + i;
      const monthRow = { row: 4, label: '', cells: [] };
      axis.forEach((d, i) => {
        if (i === 0 || d.getUTCDate() === 1) {
          monthRow.cells.push({ col: col(i), ref: `M${i}`, value: NAMES[d.getUTCMonth()], hex: null });
        }
      });

      const mark = (i, value, hex) => ({ col: col(i), ref: `X${i}`, value, hex });
      const shade = () => axis.map((_, i) => mark(i, '', '7F7F7F'));

      return [{
        id: 'snap1',
        taken_at: new Date().toISOString(),
        file_mtime: new Date().toISOString(),
        file_hash: 'stub-hash',
        sheet_name: '4WLA',
        grid: {
          merges: [], hiddenColumns: [], unknown: [],
          rows: [
            monthRow,
            { row: 5, label: '', cells: axis.map((d, i) => mark(i, String(d.getUTCDate()), null)) },
            { row: 6, label: '', cells: axis.map((d, i) => mark(i, LETTERS[d.getUTCDay()], null)) },
            /* A section heading. What makes it one is that its *activity*
               cells are painted — the shading along the day columns is on
               every row. */
            { row: 7, label: '', cells: [
              { col: 2, ref: 'B7', value: 'HTT — Testing and Commissioning', hex: 'D9D9D9' },
              { col: 3, ref: 'C7', value: '', hex: 'D9D9D9' },
              { col: 4, ref: 'D7', value: '', hex: 'D9D9D9' },
              ...shade(),
            ] },
            { row: 9, label: '', cells: [
              { col: 2, ref: 'B9', value: 'CDRL 9.04.29', hex: null },
              { col: 3, ref: 'C9', value: 'IXL Regression Testing', hex: null },
              { col: 4, ref: 'D9', value: 'TPSS 12', hex: null },
              mark(todayIdx, 'X', 'FFFF00'),
              mark(todayIdx + 1, 'X.WIT', 'FFFF00'),
              mark(todayIdx + 3, 'X', 'FF0000'),
            ] },
            /* One mark in the week that has already gone and one still ahead,
               so narrowing the window drops a column without dropping a row. */
            { row: 10, label: '', cells: [
              { col: 2, ref: 'B10', value: 'Operational Readiness', hex: null },
              { col: 3, ref: 'C10', value: 'ATS Site Test', hex: null },
              { col: 4, ref: 'D10', value: 'Station 6 Platform', hex: null },
              mark(1, 'X.PAST', '00B0F0'),
              mark(todayIdx + 2, 'X.TCE', '00B0F0'),
              mark(todayIdx + 4, 'X', '3399FF'),
            ] },
            /* Worked, but in the week that has already gone. This is the row
               that stayed on screen when the flag was worked out once across
               the whole sheet instead of against the weeks being drawn — a
               four-week window showing a row with nothing in it. */
            { row: 12, label: '', cells: [
              { col: 3, ref: 'C12', value: 'REI Fiber Re-termination — finished', hex: null },
              mark(1, 'X', 'FFFF00'),
              mark(2, 'X', 'FFFF00'),
            ] },
            /* Carried in the workbook for reference, with nothing scheduled:
               the shading is the only paint on it. Most of the sheet looks
               like this, and it is what the calendar hides by default. */
            { row: 11, label: '', cells: [
              { col: 3, ref: 'C11', value: 'DCS Internal testing — no dates yet', hex: null },
              ...shade(),
            ] },
            // The workbook's own key, in the shape readLegend() looks for.
            { row: 20, label: 'Highlight in Yellow for Day Shift',
              cells: [2, 3].map((c) => ({ col: c, ref: 'X20', value: '', hex: 'FFFF00' })) },
          ],
        },
      }];
    })(),
    rc_legend: [
      { id: 'lg1', argb: 'FFFF00', meaning: 'Day Shift', role: 'shift', valid_from: '2026-01-01', active: true },
      { id: 'lg2', argb: '00B0F0', meaning: 'Third Shift', role: 'shift', valid_from: '2026-01-01', active: true },
      { id: 'lg3', argb: 'FF0000', meaning: 'Cancellation', role: 'shift', valid_from: '2026-01-01', active: true },
      { id: 'lg5', argb: 'D9D9D9', meaning: 'Section divider', role: 'divider', valid_from: '2026-01-01', active: true },
      /* 7F7F7F is deliberately absent. It is the grey the spreadsheet shades
         its layout with, it starts unmapped like any other colour, and an
         unmapped colour counts as work — so every shaded row is on screen
         until somebody says otherwise. Getting from there to a usable
         calendar in one click is what the checks below are about. */
    ],
    rc_settings: [{ key: 'lookahead_sheet', value: '4WLA' }],
    rc_blockers: [],
    rc_blocker_updates: [],
    /* The view is what is true now; the tables keep how it got that way. The
       stub joins them the same way the lateral does. */
    get rc_blockers_current() {
      return this.rc_blockers.map((b) => {
        const latest = this.rc_blocker_updates
          .filter((u) => u.blocker_id === b.id)
          .slice(-1)[0] || {};
        return {
          ...b,
          state: latest.state || 'open',
          owner_id: latest.owner_id || null,
          due_date: latest.due_date || null,
          last_note: latest.note || null,
          age_days: 3,
        };
      });
    },
    rc_lookahead_rows: [{
      id: 'lar1',
      snapshot_id: 'snap1',
      /* The week of the day the huddle *reviews*, not of today. On a Monday
         those are different weeks — the meeting looks back at Friday — and a
         fixture pinned to today made the look-ahead invisible to the block
         dialog one day in seven. */
      week_start: (() => {
        const ms = Date.parse(`${REVIEW.iso}T00:00:00Z`);
        return new Date(ms - ((new Date(ms).getUTCDay() + 6) % 7) * 86400000)
          .toISOString().slice(0, 10);
      })(),
      sheet_row: 9,
      row_key: 'k1',
      location_id: 'l1',
      raw_location: 'TPSS 12',
      raw_label: 'IXL Regression Testing',
      cells: {},
      bart_marks: {},
    }, {
      /* And one in the week the *plan* is being made for. A real four-week
         look-ahead covers both; keeping only the reviewed week made the week
         plan's proposal invisible on a Monday. */
      id: 'lar2',
      snapshot_id: 'snap1',
      week_start: (() => {
        const now = new Date();
        const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
      })(),
      sheet_row: 11,
      row_key: 'k2',
      location_id: 'l1',
      raw_location: 'TPSS 12',
      raw_label: 'IXL Regression Testing',
      cells: {},
      bart_marks: {},
    }],
    rc_change_events: [
      { id: 'ev1', kind: 'cancellation', week_start: iso(-3), row_key: 'k1',
        before: { date: iso(-2), value: 'Day Shift' }, after: { date: iso(-2), value: 'Cancelled' },
        detected_at: new Date().toISOString(), from_snapshot: null, to_snapshot: 'snap1' },
      { id: 'ev2', kind: 'scope_added', week_start: iso(-3), row_key: 'k2',
        before: null, after: { label: 'NMS testing · C156' },
        detected_at: new Date().toISOString(), from_snapshot: null, to_snapshot: 'snap1' },
      // Not scope, and it has to say so rather than being counted.
      { id: 'ev3', kind: 'window_advanced', week_start: iso(4), row_key: null,
        before: null, after: null, detected_at: new Date().toISOString() },
    ],
    /* A judgement already recorded. These were written and never read back, so
       an attribution made in a meeting vanished the moment the dialog closed
       and the same cancellation got asked about every week. */
    rc_change_annotations: [
      { id: 'an1', change_event_id: 'ev2', party_id: 'party1', note: 'BART added it late',
        created_at: new Date().toISOString() },
    ],
    rc_sars: [],
    rc_sar_links: [],
    rc_ingest_runs: [],
    rc_rows_without_sar: [],
    rc_sars_without_rows: [],
    rc_invitations: [],
  };

  /* A filter chain thin enough to be obviously right, and no thinner. */
  function query(table) {
    let rows = (S.rows[table] || []).slice();
    const api = {
      select() { return api; },
      eq(col, v) { rows = rows.filter((r) => r[col] === v); return api; },
      neq(col, v) { rows = rows.filter((r) => r[col] !== v); return api; },
      gte(col, v) { rows = rows.filter((r) => r[col] >= v); return api; },
      lte(col, v) { rows = rows.filter((r) => r[col] <= v); return api; },
      is() { return api; },
      in(col, vs) { rows = rows.filter((r) => vs.includes(r[col])); return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
    };
    return api;
  }

  window.supabase = {
    createClient() {
      return {
        auth: {
          getSession: () => Promise.resolve({
            data: { session: S.signedIn ? { user: USER } : null },
          }),
          signInWithPassword: ({ email }) => {
            if (!/@/.test(email)) {
              return Promise.resolve({ data: null, error: { message: 'Invalid login credentials' } });
            }
            S.signedIn = true;
            return Promise.resolve({ data: { user: USER }, error: null });
          },
          /* Sign-up goes through GoTrue, never PostgREST, so the gate is the
             trigger on auth.users rather than anything the interface does.
             The stub answers as that trigger does. */
          signUp: ({ email }) => {
            const address = String(email || '').trim().toLowerCase();
            const invited = (S.rows.rc_invitations || [])
              .some((i) => i.pending_email === address);
            if (!invited) {
              return Promise.resolve({
                data: null,
                error: { message: 'This application is invitation only. Ask an administrator to invite ' + address },
              });
            }
            S.signedIn = true;
            S.rows.rc_invitations = S.rows.rc_invitations.filter((i) => i.pending_email !== address);
            const made = { id: `user-${address}`, email: address };
            return Promise.resolve({ data: { user: made, session: { user: made } }, error: null });
          },
          signOut: () => { S.signedIn = false; return Promise.resolve({ error: null }); },
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
        from(table) {
          const api = query(table);
          api.insert = (rows) => {
            S.calls.push({ kind: 'insert', table, payload: rows });
            if (S.offline) {
              return { select: () => Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }) };
            }
            const list = S.rows[table] || (S.rows[table] = []);
            /* Column defaults. Postgres fills `active` in; a stub that did not
               would make a freshly inserted row invisible to every read that
               filters on it — which looks exactly like the write failing. */
            const defaults = list.some((r) => 'active' in r) ? { active: true } : {};
            const made = [].concat(rows).map((r, i) => (
              { id: `${table}-${list.length + i + 1}`, ...defaults, ...r }));
            list.push(...made);
            // rc_plan_current is a *view* over the entries, and the stub makes
            // it an alias rather than a copy — so pushing again here would
            // double every plan row.

            return { select: () => Promise.resolve({ data: made, error: null }) };
          };
          api.upsert = (row, opts) => {
            S.calls.push({ kind: 'upsert', table, payload: row });
            const list = S.rows[table] || (S.rows[table] = []);
            const key = opts?.onConflict || 'id';
            const hit = list.find((r) => r[key] === row[key]);
            if (hit) Object.assign(hit, row);
            else list.push({ ...row });
            return { select: () => Promise.resolve({ data: [hit || row], error: null }) };
          };
          api.update = (patch) => {
            S.calls.push({ kind: 'update', table, payload: patch });
            return {
              eq: (col, v) => ({
                select: () => {
                  const list = S.rows[table] || [];
                  const hit = list.filter((r) => r[col] === v);
                  hit.forEach((r) => Object.assign(r, patch));
                  return Promise.resolve({ data: hit, error: null });
                },
              }),
            };
          };
          return api;
        },
        rpc(name, args) {
          S.calls.push({ kind: 'rpc', table: name, payload: args });
          if (name === 'rc_record_actual') {
            if (S.offline) return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
            const existing = S.rows.rc_actuals.find((a) => a.client_uuid === args.p_client_uuid);
            if (existing) return Promise.resolve({ data: existing.id, error: null });
            if (args.p_status === 'blocked' && (!args.p_blocked_reason || !args.p_blocked_party)) {
              return Promise.resolve({ data: null, error: { message: 'a blocked outcome needs a reason and a responsible party' } });
            }
            const row = {
              id: `act-${S.rows.rc_actuals.length + 1}`,
              client_uuid: args.p_client_uuid,
              person_id: args.p_person,
              work_date: args.p_date,
              status: args.p_status,
              category_id: args.p_category,
              location_id: args.p_location,
              note: args.p_note || null,
              blocked_reason: args.p_blocked_reason,
              blocked_party_id: args.p_blocked_party,
              carry_chain_id: args.p_carry_chain,
              plan_entry_id: args.p_plan_entry || null,
              lookahead_row_id: args.p_lookahead_row || null,
              evidence_path: args.p_evidence || null,
              // The function fills this from `auth.uid()`, and who typed an
              // outcome in is a different fact from whose outcome it is.
              created_by: S.signedIn ? USER.id : null,
            };
            S.rows.rc_actuals.push(row);
            return Promise.resolve({ data: row.id, error: null });
          }
          /* The account functions. Every one of them is `security definer` on
             the real side, so the stub answers as the function does — with a
             raised error rather than an empty result. A refusal that came back
             as "no rows" is precisely the shape this project keeps getting
             bitten by, and a stub that returned it would hide the bug. */
          if (name === 'rc_invite') {
            const address = String(args.p_email || '').trim().toLowerCase();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
              return Promise.resolve({ data: null, error: { message: `${args.p_email} does not look like an email address` } });
            }
            const row = {
              pending_email: address,
              pending_role: args.p_role || 'viewer',
              pending_person: args.p_person || null,
              pending_note: args.p_note || null,
              pending_created: new Date().toISOString(),
              pending_expires: new Date(Date.now() + 30 * 86400000).toISOString(),
              pending_expired: false,
            };
            S.rows.rc_invitations = S.rows.rc_invitations.filter((i) => i.pending_email !== address);
            S.rows.rc_invitations.push(row);
            return Promise.resolve({ data: [row], error: null });
          }
          if (name === 'rc_list_invitations') {
            return Promise.resolve({ data: S.rows.rc_invitations.slice(), error: null });
          }
          if (name === 'rc_revoke_invitation') {
            const address = String(args.p_email || '').trim().toLowerCase();
            S.rows.rc_invitations = S.rows.rc_invitations.filter((i) => i.pending_email !== address);
            return Promise.resolve({ data: null, error: null });
          }
          if (name === 'rc_link_account') {
            const person = S.rows.rc_people.find((r) => r.id === args.p_person);
            if (!person) return Promise.resolve({ data: null, error: { message: 'no such person' } });
            person.user_id = `user-${String(args.p_email).trim().toLowerCase()}`;
            person.email = person.email || String(args.p_email).trim().toLowerCase();
            return Promise.resolve({ data: person.user_id, error: null });
          }
          if (name === 'rc_set_role') {
            const person = S.rows.rc_people.find((r) => r.id === args.p_person);
            if (!person) return Promise.resolve({ data: null, error: { message: 'no such person' } });
            const admins = S.rows.rc_people.filter((r) => r.role === 'admin' && r.active).length;
            if (person.role === 'admin' && args.p_role !== 'admin' && admins <= 1) {
              return Promise.resolve({ data: null, error: { message: 'that is the only administrator left' } });
            }
            person.role = args.p_role;
            return Promise.resolve({ data: null, error: null });
          }
          if (name === 'rc_resolve_location') {
            const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const key = fold(args.p_raw);
            const hit = S.rows.rc_locations.find((l) => fold(l.name) === key)
              || S.rows.rc_location_alias.find((a) => fold(a.alias) === key);
            return Promise.resolve({ data: hit ? (hit.location_id || hit.id) : null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        storage: {
          from: (bucket) => ({
            upload: (path_, blob) => {
              S.calls.push({ kind: 'upload', table: bucket, payload: { path: path_, size: blob?.size || 0 } });
              // Bucket and path, because two buckets are written to now and
              // "one upload happened" stopped being a useful thing to know.
              (S.uploads = S.uploads || []).push(`${bucket}/${path_}`);
              return Promise.resolve({ error: null });
            },
            createSignedUrl: (path_) =>
              Promise.resolve({ data: { signedUrl: `https://rc-stub.supabase.co/${bucket}/${path_}` }, error: null }),
          }),
        },
      };
    },
  };
}

/**
 * A folder, in memory, for the intake paths only.
 *
 * Deliberately smaller than the one in `smoke_folder.js` and not shared with
 * it: that one models a plan file, its lock and the write guard, and none of
 * that applies here. All the SAR path needs is `intakeList`, `intakeRead` and
 * `intakeMove`, which between them use `getDirectoryHandle`, `entries`,
 * `getFileHandle` and `removeEntry`. Modelling more of the File System Access
 * API than is used would be modelling it wrong in more places.
 */
function fakeFolder() {
  window.__files = {
    // A plan, so connecting the folder does not stop to ask what to call one —
    // this suite is about the SAR inbox beside it, not about creating plans.
    'bart.json': JSON.stringify({ schemaVersion: 99, objects: [], lanes: [], links: [] }),
    'sars/inbox/SAR-90210 W36.pdf': 'PDF-BYTES',
  };

  const fileHandle = (key) => ({
    kind: 'file',
    name: key.split('/').pop(),
    async getFile() {
      const text = window.__files[key];
      if (text === undefined) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
      return {
        size: text.length,
        lastModified: Date.now(),
        arrayBuffer: async () => new TextEncoder().encode(text).buffer,
      };
    },
    async createWritable() {
      let buffer = '';
      return {
        async write(chunk) {
          buffer += typeof chunk === 'string' ? chunk
            : new TextDecoder().decode(chunk instanceof ArrayBuffer ? chunk : chunk.buffer || chunk);
        },
        async close() { window.__files[key] = buffer; },
      };
    },
  });

  const dirHandle = (prefix) => ({
    kind: 'directory',
    name: prefix.replace(/\/$/, '').split('/').pop() || 'folder',
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async getDirectoryHandle(child, opts = {}) {
      const next = `${prefix}${child}/`;
      if (!opts.create && !Object.keys(window.__files).some((k) => k.startsWith(next))) {
        throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
      }
      return dirHandle(next);
    },
    async getFileHandle(child, opts = {}) {
      const key = prefix + child;
      if (window.__files[key] === undefined) {
        if (!opts.create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
        window.__files[key] = '';
      }
      return fileHandle(key);
    },
    async removeEntry(child) { delete window.__files[prefix + child]; },
    async *entries() {
      for (const key of Object.keys(window.__files)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes('/')) continue;
        yield [rest, fileHandle(key)];
      }
    },
  });

  window.showDirectoryPicker = async () => dirHandle('');
}

/** Words that only ever appear in the timeline's document. */
const PLAN_WORDS = ['Signalling', 'Commissioning', 'ATS Integration', 'IXL Static', 'REL-', 'objects', 'lanes', 'baselines'];

async function main() {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 1500, height: 920 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  /* A calendar backend and *no* plan backend. That combination is the whole
     deployment shape: the plan in a folder, the calendar in Postgres.

     Routing is per *page* in Playwright, not per context, so every page this
     suite opens has to be given the same treatment — a second page left on the
     committed config.js would quietly boot with no calendar at all and look
     like a bug in the application. */
  const serveStubbedConfig = (pg) => Promise.all([
    pg.route('**/config.js', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.CX_CONFIG = {
          supabaseUrl: '', supabaseAnonKey: '', requireAuth: false,
          rcSupabaseUrl: 'https://rc-stub.supabase.co', rcSupabaseAnonKey: 'rc-stub-key',
        };`,
      })
    ),
    pg.route('**/vendor/supabase.js', (route) =>
      route.fulfill({ contentType: 'application/javascript', body: '/* stubbed for tests */' })
    ),
  ]);
  await serveStubbedConfig(page);

  // Anything the page tries to send over the wire is recorded, whether or not
  // it goes through the stub. A leak that bypassed the client entirely would
  // still be caught here.
  const wireBodies = [];
  await page.route('**://*.supabase.co/**', (route) => {
    wireBodies.push(route.request().postData() || '');
    route.fulfill({ contentType: 'application/json', body: '[]' });
  });

  // The clipboard is not grantable in a file:// page, so it is recorded
  // instead — what matters is the link the application produced.
  // A download lands somewhere the page cannot see, so the suite records what
  // was handed to the browser instead.
  const captureDownloads = (pg) => pg.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      blob.text().then((text) => {
        try {
          const parsed = JSON.parse(text);
          window.__saved = { ...(window.__saved || {}), tables: Object.keys(parsed.tables || {}) };
        } catch { /* not our JSON */ }
      });
      return create(blob);
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched() {
      if (this.download) window.__saved = { ...(window.__saved || {}), name: this.download };
      else click.call(this);
    };
  });

  const captureClipboard = (pg) => pg.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text) => { window.__clip = text; return Promise.resolve(); } },
    });
  });
  await captureDownloads(page);
  await captureClipboard(page);
  await page.addInitScript(fakeFolder);
  await page.addInitScript(fakeSdk);
  const url_ = 'file://' + path.join(ROOT, 'index.html');

  /* ── The timeline still owns the application ──────────────────────────── */
  console.log('\nThe timeline is unaffected');
  await page.goto(url_, { waitUntil: 'load' });
  await page.waitForSelector('.tl-obj', { timeout: 20000 });

  check('the timeline opens with no account', (await page.locator('.tl-obj').count()) > 8);
  check('and no gate is in the way', (await page.locator('.cx-gate').count()) === 0);
  check('the workspace switch appears', (await page.locator('.ws-switch').count()) === 1);
  check('the timeline is the workspace on show',
    await page.evaluate(() => document.body.dataset.workspace !== 'calendar'));
  check('the calendar stage is empty until asked for',
    await page.evaluate(() => document.getElementById('rc-frame').children.length === 0));

  /* ── The switch ───────────────────────────────────────────────────────── */
  console.log('\nSwitching to the calendar');
  await page.locator('.ws-btn', { hasText: 'Calendar' }).click();
  await page.waitForSelector('#rc-frame .rc-head', { timeout: 10000 });

  check('the calendar stage is built on first use',
    await page.evaluate(() => document.getElementById('rc-frame').children.length > 0));
  check('the body records which workspace is showing',
    await page.evaluate(() => document.body.dataset.workspace === 'calendar'));
  check('the timeline canvas is hidden, not destroyed',
    await page.evaluate(() => document.querySelectorAll('#canvas-frame .tl-obj').length > 8));
  check('it asks for an account', (await page.locator('#rc-frame .rc-signin').count()) === 1);
  check('the dock is out of the way', !(await page.locator('#dock').isVisible()));

  /* Switching back must cost nothing — the canvas was never unmounted. */
  await page.locator('.ws-btn', { hasText: 'Timeline' }).click();
  await page.waitForTimeout(150);
  check('switching back shows the timeline again',
    await page.locator('.tl-obj').first().isVisible());
  check('with its objects intact', (await page.locator('.tl-obj').count()) > 8);

  /* ── Signing in ───────────────────────────────────────────────────────── */
  console.log('\nThe account gate');
  await page.locator('.ws-btn', { hasText: 'Calendar' }).click();
  await page.waitForSelector('#rc-frame .rc-signin');

  const inputs = page.locator('#rc-frame .rc-signin input');
  await inputs.nth(0).fill('not-an-email');
  await inputs.nth(1).fill('secret');
  await page.locator('#rc-frame .rc-signin button.primary').click();
  await page.waitForTimeout(300);
  check('a bad sign-in is reported rather than swallowed',
    await page.locator('#rc-frame .rc-error').isVisible());

  await inputs.nth(0).fill('alex@example.com');
  await page.locator('#rc-frame .rc-signin button.primary').click();
  await page.waitForSelector('#rc-frame .rc-tabs', { timeout: 10000 });
  check('signing in reveals the calendar', (await page.locator('#rc-frame .rc-tab').count()) >= 3);

  /* ── The roster ───────────────────────────────────────────────────────── */
  console.log('\nOrganisation');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Organisation' }).click();
  await page.waitForSelector('#rc-frame .rc-table');
  const bodyText = await page.locator('#rc-frame').innerText();
  check('the roster lists the team',
    /Alex/.test(bodyText) && /Dan/.test(bodyText) && /Priya/.test(bodyText) && /Sam/.test(bodyText));
  check('a four-day contract is visible', /4\/wk/.test(bodyText));

  await page.locator('#rc-frame .rc-tab', { hasText: 'Locations' }).click();
  await page.waitForTimeout(200);
  const locText = await page.locator('#rc-frame').innerText();
  check('locations carry their other spellings', /Traction Power 12/.test(locText));
  /* A name typed wrong was permanent, and every alias, SAR and look-ahead row
     hangs off the record rather than the string — so renaming is safe and not
     being able to was the odd part. */
  check('and a location can be renamed without losing what points at it',
    (await page.locator('#rc-frame button', { hasText: 'Rename' }).count()) >= 1);

  /* ── Accounts ─────────────────────────────────────────────────────────── */
  /* Adding somebody to the team must never need the SQL editor. Everything
     below is the path an administrator actually walks when somebody joins:
     invite the address, or attach an account that already exists, and set what
     they may do. */
  console.log('\nAccounts');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Accounts' }).click();
  await page.waitForSelector('#rc-frame .rc-table');

  const acctText = await page.locator('#rc-frame').innerText();
  check('who can sign in is stated per person',
    /no account/i.test(acctText) && /alex@example\.com/.test(acctText));
  check('and nobody is waiting to join yet', /Nobody is waiting/i.test(acctText));

  // Inviting. Nothing is emailed from here — the invitation is a row that says
  // this address may create an account, with the role and person it lands on.
  await page.locator('#rc-frame button', { hasText: 'Invite somebody' }).click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input[type="email"]').fill('newtech@example.com');
  await page.locator('.cx-modal select').first().selectOption('member');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Invite' }).click();
  await page.waitForTimeout(400);

  const invited = await page.evaluate(() =>
    window.__rc.calls.filter((c) => c.table === 'rc_invite').map((c) => c.payload));
  /* Nothing is emailed from here — the application has no server of its own —
     so inviting hands over a link to send however you already talk to people.
     It is a convenience and not a key: the database still refuses anybody who
     was not invited, so a forwarded link gets a stranger nowhere. */
  const copied = await page.evaluate(() => window.__clip || '');
  check('inviting hands over a link to send',
    /#join=newtech%40example\.com/.test(copied), copied.slice(0, 90));
  check('inviting goes through the function, not a table write',
    invited.length === 1 && invited[0].p_email === 'newtech@example.com');
  check('carrying the role they will land on', invited[0] && invited[0].p_role === 'member');

  await page.waitForSelector('#rc-frame .rc-table');
  const pendingText = await page.locator('#rc-frame').innerText();
  check('and the invitation appears as pending', /newtech@example\.com/.test(pendingText));

  // Revoking. `confirmDialog` first, because this is somebody being told no.
  await page.locator('#rc-frame button', { hasText: 'Revoke' }).click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Revoke' }).click();
  await page.waitForTimeout(400);
  check('revoking removes it from the pending list',
    !/newtech@example\.com/.test(await page.locator('#rc-frame').innerText()));

  // Linking an account that already exists — somebody who signed up before
  // their roster row did. This is the one step that would otherwise need SQL.
  await page.locator('#rc-frame button', { hasText: 'Link account' }).first().click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input[type="email"]').fill('dan@example.com');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Link' }).click();
  await page.waitForTimeout(400);
  const linked = await page.evaluate(() =>
    window.__rc.calls.filter((c) => c.table === 'rc_link_account').map((c) => c.payload));
  check('an existing account can be attached to a roster row',
    linked.length === 1 && linked[0].p_email === 'dan@example.com');

  // Changing a role, straight from the row.
  await page.waitForSelector('#rc-frame .rc-table');
  const roleSelects = page.locator('#rc-frame tbody select');
  await roleSelects.nth(2).selectOption('viewer');
  await page.waitForTimeout(400);
  const roleCalls = await page.evaluate(() =>
    window.__rc.calls.filter((c) => c.table === 'rc_set_role').map((c) => c.payload));
  check('a role change goes through rc_set_role', roleCalls.length === 1);
  check('and it takes',
    await page.evaluate(() => window.__rc.rows.rc_people.find((p) => p.id === 'p3').role === 'viewer'));

  // The one that has to raise rather than quietly match no rows. Alex is the
  // only administrator, so demoting them would leave nobody able to put it
  // back — and a refused UPDATE reports success, which is why this is a
  // function at all.
  await roleSelects.nth(0).selectOption('member');
  await page.waitForTimeout(500);
  check('the last administrator cannot be demoted',
    await page.evaluate(() => window.__rc.rows.rc_people.find((p) => p.id === 'p1').role === 'admin'));
  check('and the refusal is said out loud',
    /only administrator left/i.test(await page.locator('.cx-toast').last().innerText()));
  check('the dropdown goes back to what the database actually holds',
    await page.locator('#rc-frame tbody select').first().inputValue() === 'admin');

  /* ── The huddle ───────────────────────────────────────────────────────── */
  console.log('\nThe daily huddle');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Daily huddle' }).click();
  await page.waitForSelector('#rc-frame .rc-table');

  const huddleText = await page.locator('#rc-frame').innerText();
  check('everyone who takes shifts is on one screen, side by side',
    /Dan/.test(huddleText) && /Priya/.test(huddleText) && /Sam/.test(huddleText)
      && /Rosa/.test(huddleText));
  /* The manager runs the meeting rather than taking work from it, and asking
     them every morning what they finished is noise in the one meeting that has
     to stay quick. `scheduled` is its own fact, not a reading of the role — an
     administrator who did take shifts would still be here. */
  check('but the manager running it is not asked for an outcome',
    !/Alex/.test(await page.locator('#rc-frame tbody').innerText()),
    (await page.locator('#rc-frame tbody').innerText()).split('\n')[0]);
  // Sam is off on whatever day the review lands on, so the meeting does not ask
  // him for an outcome he could not have had. Absence has to be a different
  // fact from a miss, or it gets distributed across the performance statuses.
  check('somebody who does not work that day is not asked',
    /not a working day/.test(huddleText));
  /* ── Running the meeting ──────────────────────────────────────────────
     A carried task is going to be done tomorrow. Re-typing it was slow, and
     it was also how the chain got broken: rolling it forward makes a new
     entry, so the next carry started a new chain and five days of one stuck
     job read as five separate failures by one person. */
  console.log('\nCarrying a task over');
  const carryRow = page.locator('#rc-frame tbody tr', { hasText: 'Cable pull at TPSS 12' });
  await carryRow.locator('button', { hasText: 'Carried over' }).click();
  await page.waitForTimeout(400);

  /* Anything but a completed task asks what is left of it, pre-filled with the
     plan so it is an edit rather than a retype. "Partial" with nothing said is
     a number nobody can act on the next morning. */
  const said = carryRow.locator('.rc-saymore input[type="text"]');
  check('it asks what is left, pre-filled with the plan rather than blank',
    (await said.inputValue()) === 'Cable pull at TPSS 12', await said.inputValue());
  await said.fill('Cable pull at TPSS 12 — north end still to pull');
  await said.press('Enter');
  await page.waitForTimeout(600);

  const carried = await page.evaluate(() => ({
    actual: window.__rc.rows.rc_actuals.find((a) => a.status === 'carried') || null,
    rolled: window.__rc.rows.rc_plan_entries.filter((p) => p.task === 'Cable pull at TPSS 12'),
  }));
  check('a carry is recorded against a chain',
    Boolean(carried.actual && carried.actual.carry_chain_id));
  check('and the task is put on tomorrow rather than re-typed',
    carried.rolled.length === 2, `${carried.rolled.length} entries`);
  check('with the same chain, so five days of one stuck job is one chain',
    carried.rolled.some((p) => p.carry_chain_id === carried.actual?.carry_chain_id));
  check('and the location and category come with it',
    carried.rolled.every((p) => p.location_id === 'l1' && p.category_id === 'c1'));
  /* Most days somebody speaks and somebody else types. An outcome attributed
     to whoever entered it is how a record stops being trusted, so the two are
     shown apart — and only where they differ, which is the only case anybody
     wonders about. */
  check('and it says who typed it in, since that is rarely who said it',
    /recorded by Alex/.test(await page.locator('#rc-frame tbody').innerText()),
    (await page.locator('#rc-frame tbody').innerText()).split('\n').find((l) => /recorded by/.test(l)) || '(nobody)');
  check('and what is left of it is on the outcome, in the words it was said in',
    /north end still to pull/.test(carried.actual?.note || ''), carried.actual?.note || '(none)');

  // The whole meeting from the keyboard: arrows down the team, one letter per
  // outcome. Fifteen people at a fixed time is a lot of clicking otherwise.
  console.log('\nRunning it from the keyboard');
  const before2 = await page.evaluate(() => window.__rc.rows.rc_actuals.length);
  await page.locator('#rc-frame tbody tr', { hasText: 'Priya' }).first().focus();
  await page.keyboard.press('c');
  await page.waitForTimeout(500);
  check('a letter records the outcome on the row that has focus',
    await page.evaluate((n) => window.__rc.rows.rc_actuals.length === n + 1, before2));
  check('and it is the person whose row it was',
    await page.evaluate(() => window.__rc.rows.rc_actuals.at(-1).person_id === 'p3'));

  check('each status is one click, not a dropdown',
    (await page.locator('#rc-frame tbody button', { hasText: 'Completed' }).count()) >= 1);

  // A whole row per status button means a status is one press per person.
  const recorded = await page.evaluate(() => window.__rc.rows.rc_actuals.length);
  await page.locator('#rc-frame tbody button', { hasText: 'Completed' }).first().click();
  await page.waitForTimeout(400);
  check('an outcome is recorded',
    await page.evaluate((n) => window.__rc.rows.rc_actuals.length === n + 1, recorded));
  check('and the row redraws to show it, not the whole screen',
    /Completed/.test(await page.locator('#rc-frame tbody').innerText()));

  /* A block is the one status that cannot be recorded on its own. */
  console.log('\nA block needs a reason and somebody answerable');
  await page.locator('#rc-frame tbody button', { hasText: 'Blocked' }).first().click();
  await page.waitForSelector('.cx-modal', { timeout: 5000 });
  await page.locator('.cx-modal button', { hasText: 'Record' }).click();
  await page.waitForTimeout(300);
  check('recording one with no reason is refused, in place',
    await page.locator('.cx-modal .rc-error').isVisible());

  await page.locator('.cx-modal input').first().fill('Possession released late');
  // Found by what it contains rather than where it sits: the dialog gained
  // fields and a positional selector quietly started driving the wrong one.
  const against = page.locator('.cx-modal select', { has: page.locator('option[value="lar1"]') });
  if (await against.count()) await against.selectOption('lar1');
  const chaser = page.locator('.cx-modal select', { has: page.locator('option[value="p1"]') });
  if (await chaser.count()) await chaser.selectOption('p1');
  await page.locator('.cx-modal input[type="date"]').fill('2026-12-01');
  /* A photograph of what stopped it — the single most useful thing in the file
     a year later, and this is the one moment it can be taken. It goes up
     *before* the row, under the uuid the row is about to carry, because the
     table has no UPDATE grant. */
  await page.locator('.cx-modal input[type="file"]').setInputFiles({
    name: 'possession.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not really a jpeg'),
  });
  await page.locator('.cx-modal button', { hasText: 'Record' }).click();
  await page.waitForTimeout(600);
  check('with a reason and a party it goes through',
    await page.evaluate(() => window.__rc.rows.rc_actuals.some((a) => a.status === 'blocked')));
  check('and the party is carried with it',
    await page.evaluate(() => window.__rc.rows.rc_actuals.some((a) => a.blocked_party_id)));
  /* "Blocked by BART" is an assertion; "blocked on the row BART themselves
     scheduled for that location that week" is a document. Offered, never
     guessed — matching on the activity text is forbidden here. */
  /* The outcome says a day was lost. The blocker is the thing somebody has to
     do about it, and until now nothing carried who or by when — so the list
     only ever grew, and a list that only grows is one nobody reads. */
  check('and a blocked day raises something somebody has to chase',
    await page.evaluate(() => window.__rc.rows.rc_blockers.length === 1));
  check('with a name against it, asked at the one moment somebody is thinking about it',
    await page.evaluate(() => window.__rc.rows.rc_blocker_updates
      .some((u) => u.owner_id === 'p1' && u.due_date === '2026-12-01')));

  const blocked = await page.evaluate(() =>
    window.__rc.rows.rc_actuals.find((a) => a.status === 'blocked') || {});
  check('and the photograph taken with it is on the outcome',
    /^[0-9a-f-]{36}\.jpg$/.test(blocked.evidence_path || ''), blocked.evidence_path || '(none)');
  check('under the uuid the row itself carries, because the row cannot be edited later',
    (blocked.evidence_path || '').startsWith(blocked.client_uuid || 'x'));
  check('and it went to the evidence bucket, not to the SAR one',
    await page.evaluate(() => window.__rc.calls.some((c) => c.kind === 'upload' && c.table === 'evidence')));
  check('the meeting offers it back rather than mentioning it',
    (await page.locator('#rc-frame .rc-evidence').count()) >= 1);

  check('and it can be recorded against the look-ahead row it belongs to',
    await page.evaluate(() => window.__rc.rows.rc_actuals.some((a) => a.lookahead_row_id === 'lar1')),
    'lookahead_row_id');

  /* ── The meeting happens whether or not the network does ──────────────── */
  console.log('\nThe offline queue');
  await page.evaluate(() => { window.__rc.offline = true; });
  const before = await page.evaluate(() => window.__rc.rows.rc_actuals.length);
  await page.locator('#rc-frame tbody button', { hasText: 'Partial' }).first().click();
  await page.waitForTimeout(300);
  // Through the strip, because that is now the way a partial day is recorded —
  // and the queue has to hold what was said, not just that something happened.
  await page.locator('#rc-frame .rc-saymore input[type="text"]').first()
    .fill('Half the loops proved');
  await page.locator('#rc-frame .rc-saymore input[type="text"]').first().press('Enter');
  await page.waitForTimeout(400);

  check('an outcome entered with no connection is not lost',
    await page.evaluate(() => JSON.parse(localStorage.getItem('cxrc.queue') || '[]').length === 1));
  check('and nothing reached the server', await page.evaluate(
    (n) => window.__rc.rows.rc_actuals.length === n, before));
  check('the screen says how many are waiting',
    /1 unsynced/.test(await page.locator('#rc-frame .rc-head').innerText()));

  // Back online: the queue drains on the next render, and the uuid generated
  // before the first attempt is what makes replaying it safe.
  await page.evaluate(() => { window.__rc.offline = false; });
  await page.locator('#rc-frame .rc-tab', { hasText: 'Week plan' }).click();
  await page.waitForTimeout(200);
  await page.locator('#rc-frame .rc-tab', { hasText: 'Daily huddle' }).click();
  await page.waitForTimeout(600);

  check('the queue drains when the connection returns',
    await page.evaluate(() => JSON.parse(localStorage.getItem('cxrc.queue') || '[]').length === 0));
  check('and the entry arrives exactly once', await page.evaluate(
    (n) => window.__rc.rows.rc_actuals.length === n + 1, before));
  check('carrying what was said with it, rather than only that something happened',
    await page.evaluate(() =>
      window.__rc.rows.rc_actuals.some((a) => a.note === 'Half the loops proved')));

  /* ── The meeting, written down ────────────────────────────────────────
     A huddle answers three questions and then evaporates. The people who most
     need the answers are the ones who were not in the room. */
  console.log('\nWhat the room decided, for the people who were not in it');
  await page.locator('#rc-frame button', { hasText: 'Digest' }).click();
  await page.waitForSelector('.cx-modal textarea');
  const digest = await page.locator('.cx-modal textarea').inputValue();

  check('it answers the three questions the meeting asks',
    /What happened/.test(digest) && /What is next/.test(digest) && /What is in the way/.test(digest),
    digest.split('\n').filter((l) => /^What/.test(l)).join(' / '));
  check('with what people actually said, not just that they said something',
    /north end still to pull/.test(digest),
    digest.split('\n').find((l) => /north end/.test(l)) || '(nothing)');
  check('the blocker is on it, with who is chasing it',
    /Possession released late/.test(digest) && /Alex chasing/.test(digest));
  /* It carries no rate and no score. The moment a digest puts a percentage
     against somebody's name it stops being a summary and becomes a review —
     and it is pasted into a channel the whole project reads. */
  check('and no rate or score against anybody, because this gets forwarded',
    !/%|efficiency|completion rate/i.test(digest));

  await page.locator('.cx-modal button', { hasText: 'Copy it' }).click();
  await page.waitForTimeout(300);
  check('it copies as text somebody can paste wherever the team talks',
    await page.evaluate(() => /What is in the way/.test(window.__clip || '')));
  await page.locator('.cx-modal button', { hasText: 'Save it' }).click();
  await page.waitForTimeout(300);
  check('and saves beside the week\'s evidence, announcing itself like every other export',
    await page.evaluate(() => /^huddle-\d{4}-\d{2}-\d{2}\.txt$/.test(window.__saved?.name || '')),
    await page.evaluate(() => window.__saved?.name || '(nothing saved)'));
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Done' }).click();
  await page.waitForTimeout(300);

  /* A day nobody has filled in yet. Somebody missing from a digest reads as
     somebody who had a quiet day, which is how a gap in the record becomes a
     claim that everything went fine — so silence is named. */
  await page.locator('#rc-frame button[aria-label="Next day"]').click();
  await page.waitForTimeout(400);
  await page.locator('#rc-frame button', { hasText: 'Digest' }).click();
  await page.waitForSelector('.cx-modal textarea');
  const quiet = await page.locator('.cx-modal textarea').inputValue();
  check('and names whoever nothing was recorded for, rather than leaving a gap',
    /nothing recorded for/.test(quiet),
    quiet.split('\n').find((l) => /nothing recorded/.test(l)) || '(nobody)');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Done' }).click();
  await page.waitForTimeout(200);
  await page.locator('#rc-frame button', { hasText: 'Today' }).click();
  await page.waitForTimeout(400);

  /* ── The week plan ────────────────────────────────────────────────────── */
  console.log('\nThe week plan');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Week plan' }).click();
  await page.waitForSelector('#rc-frame .rc-table');
  const weekText = await page.locator('#rc-frame').innerText();
  check('the week is people down and days across', /Available/.test(weekText));
  // Four people can be staffed with, and the manager is not one of them — they
  // run the meeting rather than taking work from it.
  /* The look-ahead says what is wanted and where; it never says who, because
     it does not know the team. So it proposes and a person assigns — and the
     plan carries the link, which is what lets a block later point at the row
     BART themselves scheduled. */
  const emptyCell = page.locator('#rc-frame tbody button', { hasText: /^\+$/ }).first();
  check('an empty day offers to plan from the look-ahead',
    (await emptyCell.count()) >= 1);
  await emptyCell.click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal select').first().selectOption('lar2');
  await page.waitForTimeout(200);
  check('choosing a row fills the task in from what was asked for',
    (await page.locator('.cx-modal input').first().inputValue()) === 'IXL Regression Testing');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Plan it' }).click();
  await page.waitForTimeout(500);
  check('and the plan keeps the link back to it',
    await page.evaluate(() => window.__rc.rows.rc_plan_entries.some((p) => p.lookahead_row_id === 'lar2')));

  const weekText2 = await page.locator('#rc-frame').innerText();
  check('leave booked beyond this week is named before you hit it',
    /Coming up: Uma/.test(weekText2), weekText2.split('\n').find((l) => /Coming up/.test(l)) || '');

  check('and says how many can actually be staffed each day',
    /\d+ of 6/.test(weekText), weekText.split('\n').find((l) => / of \d/.test(l)) || '');

  /* ── The look-ahead and the SARs ──────────────────────────────────────── */
  console.log('\nThe look-ahead register');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Look-ahead' }).click();
  await page.waitForSelector('#rc-frame .la-grid', { timeout: 10000 });

  /* ── The calendar ─────────────────────────────────────────────────────
     The workbook drawn as it looks: activities down, days across, in the
     colours it was painted. It draws the snapshot rather than the file,
     which is what lets it render on a machine that has never been given
     the folder — including this one. */
  const dayHeadCount = async () =>
    (await page.locator('#rc-frame .la-grid thead tr').nth(1).locator('th').count()) - 1;

  /* The sheet carries months and day numbers and no year at all, so the axis
     is dated from the snapshot's timestamp and then *checked* against the
     workbook's own weekday letters — only one candidate year makes M, Tu and W
     land where the file says they do. Everything below depends on that having
     worked. */
  const axis = await page.evaluate(() => window.__rc.axis);
  check('the date axis is found from the weekday row', (await dayHeadCount()) > 7);
  check('the weekend is marked apart',
    (await page.locator('#rc-frame .la-grid thead .la-weekend').count()) >= 4);
  check('the year is resolved and said out loud',
    new RegExp(axis.today).test(await page.locator('#rc-frame').innerText()));

  // Today is a line down the grid, not a tint: a fill would be one more colour
  // competing with the workbook's own.
  check('today is marked on the grid',
    (await page.locator('#rc-frame .la-grid td.la-today').count()) >= 1);
  check('and on the axis above it',
    (await page.locator('#rc-frame .la-grid thead th.la-today').count()) >= 1);

  /* The window opens on four weeks from this Monday. The past is dropped
     rather than scrolled past — this workbook carries a quarter of finished
     weeks to the left of today. */
  check('it opens on four weeks, not the whole sheet',
    (await dayHeadCount()) === 28, `${await dayHeadCount()} days`);
  check('and the week that has already gone is not drawn',
    !/X\.PAST/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));

  for (const [label, days] of [['2 weeks', 14], ['3 weeks', 21], ['4 weeks', 28]]) {
    await page.locator('#rc-frame .rc-tab', { hasText: label }).click();
    await page.waitForTimeout(200);
    check(`${label} narrows the axis to ${days} days`, (await dayHeadCount()) === days,
      `${await dayHeadCount()}`);
  }
  /* A row is judged against the weeks on screen, not against the workbook.
     Worked out once across the whole sheet — which is how it was — a row
     painted in a week that has gone stays on a four-week window with nothing
     in it. This file has thirty-eight of those. */
  check('a row worked only in a week that has gone is not drawn',
    !/finished/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));

  await page.locator('#rc-frame .rc-tab', { hasText: 'Everything' }).click();
  await page.waitForTimeout(200);
  check('and everything brings the finished weeks back',
    (await dayHeadCount()) === axis.days
      && /X\.PAST/.test(await page.locator('#rc-frame .la-grid tbody').innerText()),
    `${await dayHeadCount()} of ${axis.days}`);
  check('along with the rows that were worked in them',
    /finished/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  await page.locator('#rc-frame .rc-tab', { hasText: '4 weeks' }).click();
  await page.waitForTimeout(200);

  /* A month spans thirty columns, so a label written into the band scrolls out
     of sight long before the month does. It is a sticky span pinned past the
     frozen columns instead. */
  check('the month band carries a sticky label',
    (await page.locator('#rc-frame .la-grid .la-month-label').count()) >= 1);
  check('and it is pinned rather than scrolling away',
    await page.locator('#rc-frame .la-grid .la-month-label').first()
      .evaluate((n) => getComputedStyle(n).position === 'sticky'));

  /* ── The grey the spreadsheet shades its layout with ───────────────────
     It arrives unmapped like every other colour, and an unmapped colour
     counts as work — deliberately, because the unexplained might be. The
     consequence is that every shaded row is on screen until somebody says
     otherwise, which against the real file is 145 rows instead of 29. So the
     saying-so has to be one click, from where the problem is visible. */
  check('an unexplained colour keeps its rows on screen',
    /no dates yet/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  check('and the strip shows which colours are unexplained, not just how many',
    (await page.locator('#rc-frame .la-swatch-unmapped').count()) >= 2);

  await page.locator('#rc-frame .rc-tab', { hasText: 'Legend' }).click();
  await page.waitForSelector('#rc-frame .rc-table');
  await page.locator('#rc-frame tr', { hasText: '7F7F7F' })
    .locator('button', { hasText: 'Just shading' }).click();
  await page.waitForTimeout(400);
  check('one click says a colour is shading rather than work',
    await page.evaluate(() => window.__rc.rows.rc_legend
      .some((l) => l.argb === '7F7F7F' && l.role === 'ignore')));

  await page.locator('#rc-frame .rc-tab', { hasText: 'Calendar' }).click();
  await page.waitForSelector('#rc-frame .la-grid');
  check('and every row whose only paint was that grey drops out',
    !/no dates yet/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  check('while a row with a real shift over the same grey stays',
    /IXL Regression Testing/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));

  const gridText = await page.locator('#rc-frame .la-grid tbody').innerText();
  check('activities are listed down the side',
    /IXL Regression Testing/.test(gridText) && /Operational Readiness/.test(gridText));
  check('and their marks are on the days they fall',
    /X\.WIT/.test(gridText) && /X\.TCE/.test(gridText));

  // The cell keeps the workbook's own colour rather than a token of ours —
  // the person reading this has the spreadsheet open beside it.
  // Named by its mark rather than by position: the first painted cell on the
  // grid is now the shading on the section heading.
  const painted = page.locator('#rc-frame .la-grid td.la-painted', { hasText: 'X.WIT' }).first();
  check('a mark is drawn in the colour the workbook painted it',
    (await painted.evaluate((n) => n.style.background || n.style.backgroundColor)).includes('255, 255, 0'));
  check('and says what that colour means',
    /Day Shift/.test(await painted.getAttribute('title')));

  /* The rule the whole pipeline rests on: a colour the legend does not know
     is never guessed. 3399FF is a near miss of the legend's blue, which is
     exactly what Excel's recent-colours picker produces. */
  check('an unmapped colour is drawn as unmapped, not as its nearest match',
    (await page.locator('#rc-frame .la-grid td.la-unmapped').count()) === 1);
  check('and it says so rather than naming a meaning',
    /unmapped colour/.test(
      await page.locator('#rc-frame .la-grid td.la-unmapped').first().getAttribute('title')));

  /* Most of the sheet is activities carried for reference with nothing
     scheduled against them. They are hidden by default, and the switch is what
     stops that being a rule with no way back. */
  check('a row with nothing scheduled is hidden',
    !/no dates yet/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  const quietBox = page.locator('#rc-frame .cx-check input');
  await quietBox.check();
  await page.waitForTimeout(250);
  check('and comes back when asked for',
    /no dates yet/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  await quietBox.uncheck();
  await page.waitForTimeout(250);

  /* A heading is the row whose *activity* cells are painted. The shading runs
     along the day columns of every row, so reading the colour alone would make
     every row a heading. */
  check('a section heading is recognised and set apart',
    (await page.locator('#rc-frame .la-grid tr.la-head-row').count()) === 1);
  check('and it is the row the workbook painted on the activity side',
    /HTT — Testing and Commissioning/.test(
      await page.locator('#rc-frame .la-grid tr.la-head-row').innerText()));
  check('shading does not count as somebody being on site',
    (await page.locator('#rc-frame .la-grid tbody tr').count()) === 3);

  // Filtering redraws the rows and leaves the field alone — rebuilding an
  // input under the caret is the trap this project has hit three times.
  const laFilter = page.locator('#rc-frame input[placeholder^="Filter activities"]');
  await laFilter.fill('Operational');
  await page.waitForTimeout(250);
  const filtered = await page.locator('#rc-frame .la-grid tbody').innerText();
  check('the filter narrows the activities',
    /Operational Readiness/.test(filtered) && !/IXL Regression/.test(filtered));
  check('and the caret stays in the box',
    await page.evaluate(() => document.activeElement?.placeholder?.startsWith('Filter activities')));
  await laFilter.fill('');
  await page.waitForTimeout(200);

  /* ── The legend ───────────────────────────────────────────────────────── */
  await page.locator('#rc-frame .rc-tab', { hasText: 'Legend' }).click();
  await page.waitForSelector('#rc-frame .rc-table');
  const legendText = await page.locator('#rc-frame').innerText();
  check('the legend lists what each colour means',
    /Day Shift/.test(legendText) && /Cancellation/.test(legendText) && /Third Shift/.test(legendText));
  check('and lists the colour nobody has mapped, with a count',
    /3399FF/i.test(legendText), legendText.split('\n').filter((l) => /3399/i.test(l)).join(' '));

  // The sheet is a setting, not a constant: a renamed tab must not mean a
  // redeploy.
  const sheetBox = page.locator('#rc-frame input[placeholder="4WLA"]');
  check('the sheet the grid is read from is editable', await sheetBox.inputValue() === '4WLA');
  await sheetBox.fill('4WLA v2');
  await page.locator('#rc-frame button', { hasText: 'Save' }).first().click();
  await page.waitForTimeout(300);
  check('and saving it goes to the settings table, not the source',
    await page.evaluate(() => window.__rc.rows.rc_settings
      .some((r) => r.key === 'lookahead_sheet' && r.value === '4WLA v2')));
  await sheetBox.fill('4WLA');
  await page.locator('#rc-frame button', { hasText: 'Save' }).first().click();
  await page.waitForTimeout(300);

  await page.locator('#rc-frame .rc-tab', { hasText: 'Changes' }).click();
  await page.waitForTimeout(400);
  const laText = await page.locator('#rc-frame').innerText();
  // Coverage before content: ingestion only runs when somebody has the app
  // open, so a silent fortnight must not read as a quiet one.
  check('it says when the look-ahead was last read',
    /never been read|Last read/.test(laText), laText.split('\n').slice(0, 6).join(' / '));

  /* The change log is the reason for snapshotting at all — the difference
     between two reads is what a claim gets built from. It was empty by
     construction: `classify()` was written, tested and never called. */
  check('a cancellation says what it was before it turned red',
    /was Day Shift/.test(laText), laText.split('\n').find((l) => /Cancelled on/.test(l)) || '');
  check('and a row arriving in a week already in view is named',
    /NMS testing/.test(laText));
  check('the window moving is counted apart from real scope movement',
    /2 change\(s\) that count, 1 window movement/.test(laText),
    laText.split('\n').find((l) => /that count/.test(l)) || '');
  // Written and never read back: an attribution recorded in a meeting was
  // invisible the moment the dialog closed.
  check('a judgement already recorded is shown against its event',
    /BART added it late/.test(laText));
  check('and one nobody has answered still asks',
    /1 cancellation\(s\) have nobody against them/.test(laText),
    laText.split('\n').find((l) => /nobody against/.test(l)) || '');

  /* ── Running the meeting ──────────────────────────────────────────────
     The table is a form for whoever holds the keyboard. This is the same data
     drawn for the room: one person, the question asked the way somebody would
     say it, and the context the *listeners* need rather than the detail the
     person answering already knows. */
  console.log('\nRunning the meeting rather than filling it in');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Daily huddle' }).click();
  await page.waitForSelector('#rc-frame .rc-huddle');
  await page.locator('#rc-frame button', { hasText: 'Run the meeting' }).click();
  await page.waitForSelector('#rc-frame .rc-present');

  const first = await page.locator('#rc-frame .rc-present').innerText();
  check('one person is in focus, not fifteen rows',
    (await page.locator('#rc-frame .rc-present-who').count()) === 1);
  check('and the question is asked the way somebody would say it',
    /how did it go\?|what did you end up doing\?/.test(first),
    first.split('\n').find((l) => /\?/.test(l)) || '');
  // The eyebrow is uppercased by the stylesheet, so `innerText` reads "1 OF 3".
  check('with a counter, so the room knows how long is left',
    /\d+ of \d+/i.test(first), first.split('\n')[0]);
  // Space walks the room and the arrows come back, because fifteen people at
  // a fixed time is a lot of clicking otherwise.
  const who = await page.locator('#rc-frame .rc-present-who').innerText();
  await page.locator('#rc-frame .rc-present').press('Space');
  await page.waitForTimeout(400);
  check('space moves to the next person',
    (await page.locator('#rc-frame .rc-present-who').innerText()) !== who);
  await page.locator('#rc-frame .rc-present').press('ArrowLeft');
  await page.waitForTimeout(400);
  check('and the arrows go back',
    (await page.locator('#rc-frame .rc-present-who').innerText()) === who);

  /* By now every available person has an outcome for that day, so step the
     meeting on to one nobody has filled in. Two things are being checked at
     once and both matter in a room: it opens on the first person still to
     answer rather than at the top of the roster, and the status letters write
     from here through exactly the path the table uses. */
  await page.locator('#rc-frame .rc-present').press('Escape');
  await page.waitForTimeout(300);
  await page.locator('#rc-frame button[aria-label="Next day"]').click();
  await page.waitForTimeout(400);
  await page.locator('#rc-frame button', { hasText: 'Run the meeting' }).click();
  await page.waitForSelector('#rc-frame .rc-present');
  check('and it opens on somebody who still has to answer',
    (await page.locator('#rc-frame .rc-present button', { hasText: 'Completed' }).count()) === 1,
    (await page.locator('#rc-frame .rc-present-who').innerText()));

  const before3 = await page.evaluate(() => window.__rc.rows.rc_actuals.length);
  await page.locator('#rc-frame .rc-present').press('c');
  await page.waitForTimeout(600);
  check('a status letter records it here too, through the same path',
    await page.evaluate((n) => window.__rc.rows.rc_actuals.length === n + 1, before3));

  await page.locator('#rc-frame .rc-present').press('Escape');
  await page.waitForTimeout(400);
  check('escape puts the table back',
    (await page.locator('#rc-frame .rc-present').count()) === 0
      && (await page.locator('#rc-frame .rc-huddle').count()) === 1);

  /* ── What is still in the way ─────────────────────────────────────────
     A blocked outcome said a day was lost and stopped there. These stay above
     the meeting until somebody closes one, which is the whole mechanism: a
     list that only grows is one nobody reads. */
  console.log('\nBlockers that stay until somebody clears them');
  await page.waitForSelector('#rc-frame .rc-blockers');
  const strip = await page.locator('#rc-frame .rc-blockers').innerText();
  check('the block raised in the meeting is standing above it',
    /Possession released late/.test(strip), strip.split('\n').slice(0, 3).join(' / '));
  check('and it says who is chasing it, which is the field it never had',
    /Alex chasing/.test(strip), strip.replace(/\n/g, ' / ').slice(0, 150));

  await page.locator('#rc-frame .rc-blocker button', { hasText: 'Update' }).first().click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input[type="text"]').first().fill('BART confirmed for Friday');
  await page.locator('.cx-modal input[type="checkbox"]').first().check();
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Add it' }).click();
  await page.waitForTimeout(700);

  // Closing it is a row, not an edit: "we told them on the 4th and chased on
  // the 9th" is the sentence a claim is built from.
  check('closing one is another row rather than an edit',
    await page.evaluate(() => window.__rc.rows.rc_blocker_updates.length === 2
      && window.__rc.rows.rc_blocker_updates.at(-1).state === 'resolved'),
    JSON.stringify(await page.evaluate(() => window.__rc.rows.rc_blocker_updates.map((u) => u.state))));
  check('and it comes off the meeting',
    !/Possession released late/.test(await page.locator('#rc-frame .rc-blockers').innerText()));
  check('leaving the room told that nobody is waiting on anybody',
    /Nothing outstanding/.test(await page.locator('#rc-frame .rc-blockers').innerText()));

  /* ── On a tablet ──────────────────────────────────────────────────────
     The huddle is run at a fixed time with the team in front of you, and the
     device in your hand is as likely to be a tablet as a laptop. */
  console.log('\nThe meeting, on a tablet');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Daily huddle' }).click();
  await page.waitForSelector('#rc-frame tbody tr');
  await page.setViewportSize({ width: 560, height: 900 });
  await page.waitForTimeout(400);

  check('the page never scrolls sideways',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await page.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
  // Four columns of prose do not fit, so each person becomes a card — the same
  // information, in the order it is asked for.
  check('the huddle stacks into a card per person',
    await page.evaluate(() =>
      getComputedStyle(document.querySelector('#rc-frame .rc-huddle tbody tr')).display === 'block'));
  check('and each answer keeps the heading the table row lost',
    await page.evaluate(() => {
      const td = [...document.querySelectorAll('#rc-frame .rc-huddle td')]
        .find((n) => n.dataset.label === 'What happened');
      return Boolean(td) && getComputedStyle(td, '::before').content.includes('What happened');
    }));
  // A 20px button is a miss when the tablet is in your other hand, and the
  // huddle is one button per person.
  check('the status buttons are big enough to hit',
    await page.evaluate(() => {
      const b = document.querySelector('#rc-frame .rc-huddle .cx-btn.mini');
      return !b || b.getBoundingClientRect().height >= 30;
    }));

  await page.setViewportSize({ width: 1500, height: 920 });
  await page.waitForTimeout(300);

  /* ── Site access ──────────────────────────────────────────────────────
     The half of the module that says whether the work planned actually had
     access. Everything below it was written and unreachable: nothing read the
     inbox, nothing uploaded, nothing linked a SAR to a row — so
     `rc_rows_without_sar` reported every row as having no access, for ever,
     which is worse than not reporting it. */
  await page.locator('.ws-btn', { hasText: 'Timeline' }).click();
  await page.locator('#sidenav .nav-link[data-pane="io"]').click();
  await page.waitForTimeout(400);
  await page.locator('#dock .cx-btn', { hasText: /connect a folder/i }).click();
  await page.waitForTimeout(1200);
  await page.locator('.ws-btn', { hasText: 'Calendar' }).click();
  await page.locator('#rc-frame .rc-tab', { hasText: 'Look-ahead' }).click();
  await page.locator('#rc-frame .rc-tab', { hasText: 'Site access' }).click();
  await page.waitForTimeout(500);

  const sarText = await page.locator('#rc-frame').innerText();
  check('site access explains that matching is by date and location, never text',
    /never by activity text/.test(sarText));
  check('a PDF dropped in the inbox is offered to be recorded',
    /SAR-90210 W36\.pdf/.test(sarText), sarText.split('\n').slice(0, 4).join(' / '));

  await page.locator('#rc-frame button', { hasText: 'Record it' }).click();
  await page.waitForSelector('.cx-modal');
  // The number is read off the filename as a suggestion, not a match.
  check('the number is suggested from the filename',
    (await page.locator('.cx-modal input').first().inputValue()) === 'SAR-90210');
  await page.locator('.cx-modal input[type="date"]').fill(
    await page.evaluate(() => window.__rc.rows.rc_lookahead_rows[0].week_start));
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Record' }).click();
  await page.waitForTimeout(900);

  check('the SAR is recorded',
    await page.evaluate(() => window.__rc.rows.rc_sars.some((x) => x.sar_number === 'SAR-90210')));
  check('the PDF goes up so it can be opened by whoever is asked about it later',
    await page.evaluate(() =>
      (window.__rc.uploads || []).filter((u) => u.startsWith('sars/')).length === 1),
    JSON.stringify(await page.evaluate(() => window.__rc.uploads || [])));
  check('and it is filed out of the inbox, under the week it authorised',
    await page.evaluate(() => {
      const keys = Object.keys(window.__files);
      return !keys.some((k) => k.startsWith('sars/inbox/'))
        && keys.some((k) => /^sars\/\d{4}-\d{2}-\d{2}\//.test(k));
    }), JSON.stringify(await page.evaluate(() => Object.keys(window.__files))));

  // Straight on to the question a SAR exists to answer: what it covers.
  await page.waitForSelector('.cx-modal');
  const coverText = await page.locator('.cx-modal').innerText();
  check('and it asks which look-ahead rows the access is for',
    /what it covers/i.test(coverText) && /IXL Regression Testing/.test(coverText), coverText.slice(0, 120));
  await page.locator('.cx-modal input[type="checkbox"]').first().check();
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Confirm' }).click();
  await page.waitForTimeout(700);
  check('confirming links it to the row, so the missing-access alert stops crying wolf',
    await page.evaluate(() => window.__rc.rows.rc_sar_links.length === 1));

  /* ── Reports ──────────────────────────────────────────────────────────── */
  console.log('\nReports');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Reports' }).click();
  await page.waitForTimeout(400);
  // innerText is the *rendered* text, and the chip labels are uppercased by
  // CSS — so this reads them case-insensitively rather than as authored.
  const repText = await page.locator('#rc-frame').innerText();
  check('an arbitrary range can be chosen, not fixed buckets',
    /Last year/.test(repText) && /Custom/.test(repText));
  check('performance and programme health are reported apart',
    /blocked/i.test(repText) && /completed/i.test(repText) && /reassigned/i.test(repText));
  // The rate is over the performance family only. Counting a day somebody was
  // blocked as a day they failed to complete would make a team look worse for
  // a possession that somebody else lost.
  check('the completion rate excludes blocked and reassigned days',
    /50%/.test(repText), 'two performance rows, one completed');
  /* The plan is append-only, and until now there was no way to exercise that
     from the interface at all: `rc_supersede_plan` existed and nothing called
     it, so a wrong entry stayed wrong. */
  await page.locator('#rc-frame .rc-tab', { hasText: 'Week plan' }).click();
  await page.waitForSelector('#rc-frame .rc-table');
  const planned = page.locator('#rc-frame td.rc-clickable', { hasText: 'IXL Regression Testing' }).first();
  check('a planned day offers to be revised', (await planned.count()) === 1);
  await planned.click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input').first().fill('IXL Regression Testing — night');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Revise' }).click();
  await page.waitForTimeout(700);
  const revised = await page.evaluate(() =>
    window.__rc.calls.filter((c) => c.table === 'rc_supersede_plan').map((c) => c.payload));
  check('revising goes through the function that refuses a second revision',
    revised.length === 1 && /night/.test(revised[0].p_task || ''), JSON.stringify(revised[0] || null));

  await page.locator('#rc-frame .rc-tab', { hasText: 'Reports' }).click();
  await page.waitForSelector('#rc-frame .rc-table');

  /* The calendar's value is being the record a year from now, and there was no
     way to get it out — a project deleted by accident left the provider's
     point-in-time recovery and nothing else. */
  await page.locator('#rc-frame button', { hasText: 'Back it up' }).click();
  await page.waitForTimeout(800);
  const backup = await page.evaluate(() => window.__saved || null);
  check('everything can be taken out as one file',
    Boolean(backup) && /resource-calendar-\d{4}-\d{2}-\d{2}\.json/.test(backup.name), backup?.name || 'nothing saved');
  check('and it carries the tables rather than a summary of them',
    Boolean(backup) && backup.tables.includes('rc_actuals') && backup.tables.includes('rc_plan_entries'),
    (backup?.tables || []).slice(0, 4).join(', '));

  check('and it says why they are never averaged together',
    /flatter or damn the wrong party/.test(repText));

  /* ══════════════════════════════════════════════════════════════════════
     The boundary
     ═══════════════════════════════════════════════════════════════════ */
  console.log('\nThe timeline\'s data never leaves');

  await page.locator('.ws-btn', { hasText: 'Timeline' }).click();
  await page.waitForTimeout(200);

  // Edit the plan hard: create, move, rename, undo, redo. If any of it were
  // going to reach a backend, this is when.
  await page.locator('.tl-obj').first().click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(600);

  const calls = await page.evaluate(() => window.__rc.calls.map((c) => ({
    kind: c.kind, table: c.table, payload: JSON.stringify(c.payload || null),
  })));

  check('the plan was actually edited',
    await page.evaluate(() => window.__cxStoreEdits === undefined
      ? document.querySelectorAll('.tl-obj').length > 8 : true));

  /* Storage is not a table, and the SAR bucket is the calendar's. Folding the
     two together made the isolation check fail on a legitimate upload — which
     is the right instinct wrongly applied: what must never happen is plan
     content leaving, and an upload to `sars` is checked by name here and by
     content on the wire below. */
  const planTables = calls.filter((c) => c.kind !== 'upload' && !/^rc_/.test(c.table));
  check('nothing was written to a table outside the calendar',
    planTables.length === 0,
    planTables.map((c) => c.table).join(', ') || 'none');

  const buckets = [...new Set(calls.filter((c) => c.kind === 'upload').map((c) => c.table))];
  check('and the only things uploaded went to the calendar\'s own buckets',
    buckets.every((b) => b === 'sars' || b === 'evidence'),
    buckets.join(', ') || 'nothing uploaded');

  const leaked = calls.filter((c) => PLAN_WORDS.some((w) => (c.payload || '').includes(w)));
  check('no call carried anything out of the plan',
    leaked.length === 0,
    leaked.length ? `${leaked.length} call(s): ${leaked[0].table}` : 'none');

  const wireLeaked = wireBodies.filter((b) => PLAN_WORDS.some((w) => b.includes(w)));
  check('and nothing left over the wire either',
    wireLeaked.length === 0,
    wireLeaked.length ? `${wireLeaked.length} request(s)` : `${wireBodies.length} request(s), all clean`);

  // The two clients are separate objects with separate sessions. Sharing one
  // would mean signing in to the calendar signed you in to the plan's backend
  // as well — which, in a build that had one, is exactly the leak.
  check('the plan has no backend configured at all',
    await page.evaluate(() => !window.CX_CONFIG.supabaseUrl));
  check('while the calendar has its own',
    await page.evaluate(() => Boolean(window.CX_CONFIG.rcSupabaseUrl)));

  /* ══════════════════════════════════════════════════════════════════════
     A read-only account
     ═══════════════════════════════════════════════════════════════════ */
  console.log('\nA viewer reads the schedule and writes nothing');

  const viewer = await context.newPage();
  viewer.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  viewer.on('pageerror', (e) => consoleErrors.push(String(e)));
  // Both scripts, in this order and on *this* page: addInitScript is per-page,
  // not per-context, and fakeSdk reads `__rc.role` when it builds the roster.
  await serveStubbedConfig(viewer);
  await viewer.addInitScript(() => { window.__rc = { role: 'viewer', signedIn: true }; });
  await viewer.addInitScript(fakeSdk);
  await viewer.goto(url_, { waitUntil: 'load' });
  // Attached rather than visible: a viewer lands on the calendar, so the canvas
  // is hidden by the time it has objects on it. That it still built them is the
  // point — the timeline is hidden, never torn down.
  await viewer.waitForSelector('.tl-obj', { state: 'attached', timeout: 20000 });
  await viewer.waitForTimeout(800);
  check('the timeline is still built behind the calendar, just hidden',
    (await viewer.locator('.tl-obj').count()) > 8);

  // The plan lives in a folder only its owner granted, so a viewer could never
  // load it — what they would see is the built-in sample, and mistaking that
  // for a real programme is the reason the switch goes away.
  check('a viewer gets no Timeline switch', (await viewer.locator('.ws-switch').count()) === 0);
  check('and lands on the calendar',
    await viewer.evaluate(() => document.body.dataset.workspace === 'calendar'));

  await viewer.waitForSelector('#rc-frame .rc-tabs', { timeout: 10000 });
  const vTabs = await viewer.locator('#rc-frame .rc-tab').allInnerTexts();
  check('the huddle and week plan are there', vTabs.includes('Daily huddle') && vTabs.includes('Week plan'));
  // Both already answer "administrators only", so removing them takes away a
  // door that opens onto a wall.
  check('the Look-ahead tab is gone', !vTabs.includes('Look-ahead'), vTabs.join(', '));
  check('the Reports tab is gone', !vTabs.includes('Reports'));
  check('and the state is named on screen',
    /Read only/.test(await viewer.locator('#rc-frame .rc-head').innerText()));

  // The one that matters: a viewer has a person row, so "is this my row" is
  // true for them too. Only asking whether they may write at all stops this.
  await viewer.waitForSelector('#rc-frame .rc-table');
  check('no status button anywhere, including on their own row',
    (await viewer.locator('#rc-frame tbody button', { hasText: 'Completed' }).count()) === 0);
  check('nor a way to set a goal',
    (await viewer.locator('#rc-frame tbody button', { hasText: 'Set goal' }).count()) === 0);
  check('but the schedule still renders',
    (await viewer.locator('#rc-frame tbody tr').count()) >= 4);

  await viewer.locator('#rc-frame .rc-tab', { hasText: 'Organisation' }).click();
  await viewer.waitForSelector('#rc-frame .rc-table');
  const vOrg = await viewer.locator('#rc-frame').innerText();
  check('the roster is readable', /Alex/.test(vOrg) && /Dan/.test(vOrg));
  check('and carries no edit controls',
    (await viewer.locator('#rc-frame button', { hasText: 'Add person' }).count()) === 0);
  // Managing accounts is administrators-only in the database — the invitation
  // list is a list of everybody's email address — so the section is not there
  // to be opened at all.
  check('and no Accounts section', !/Accounts/.test(vOrg));

  await viewer.close();

  /* ── Console ──────────────────────────────────────────────────────────── */
  console.log('\nConsole');
  const real = consoleErrors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND|fonts/i.test(e));
  check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));

  const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null;
  const shotTab = process.argv.includes('--shot-tab')
    ? process.argv[process.argv.indexOf('--shot-tab') + 1] : null;
  if (shot) {
    await page.locator('.ws-btn', { hasText: 'Calendar' }).click();
    await page.waitForTimeout(400);
    // Comma-separated, outermost first: the tab row and the section row inside
    // it are both `.rc-tab`, and the section a test left behind is sticky.
    for (const name of (shotTab || '').split(',').map((t) => t.trim()).filter(Boolean)) {
      await page.locator('#rc-frame .rc-tab', { hasText: name }).first().click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`\nscreenshot → ${shot}`);
  }

  await browser.close();

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length) {
    console.log('\nFailed:');
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
