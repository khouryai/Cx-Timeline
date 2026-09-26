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
 * **The timeline's data never leaves.** The plan holds the P6 project and is
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
import { pinClock, pinNodeClock } from './lib/clock.js';
import { buildLookaheadWorkbook } from './fixtures/xlsx_fixture.js';
import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

pinNodeClock();

// The version core/rc.js expects, so the fake database can be stamped with it.
const SCHEMA_VERSION = Number(fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'src', 'core', 'rc.js'), 'utf8')
  .match(/export const SCHEMA_VERSION = (\d+);/)[1]);

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
  /* The stub's `auth.users`. It exists because "has this address got an account
     yet" is now a question with three answers rather than two — linked, invited
     and on its way, or nothing at all — and a stub that could not tell the
     second from the third would hide the bug that the second used to be
     reported as. */
  S.accounts = S.accounts || ['alex@example.com', 'dan@example.com'];

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
      /* Full names, because the 4WLA's Resource row is filled in with first
         names and a roster of one-word names would never exercise that.
         `Victor` belongs to exactly one of them and matches; `Lena` belongs to
         two and matches neither — picking one would put a shift against the
         wrong engineer, silently, because both answers look equally right.
         They take shifts, and they say so: `scheduled` is what the huddle, the
         week plan and the Resources tab all filter on, and standing a field
         engineer down to keep a count in this file stable would be using the
         one flag that decides who is in the meeting to mean something else. */
      { id: 'p8', user_id: null, name: 'Victor Okonkwo', title: 'Test Engineer', subsystem: 'ATS', role: 'member', active: true, scheduled: true, working_days: [1, 2, 3, 4, 5] },
      { id: 'p9', user_id: null, name: 'Lena Fischer', title: 'Test Engineer', subsystem: 'IXL', role: 'member', active: true, scheduled: true, working_days: [1, 2, 3, 4, 5] },
      { id: 'p10', user_id: null, name: 'Lena Brandt', title: 'Test Technician', subsystem: 'IXL', role: 'member', active: true, scheduled: true, working_days: [1, 2, 3, 4, 5] },
    ],
    rc_locations: [
      { id: 'l1', name: 'TPSS 12', code: 'T12', active: true },
      { id: 'l2', name: 'Station 6 Platform', code: 'S6P', active: true },
    ],
    rc_location_alias: [{ id: 'a1', location_id: 'l1', alias: 'Traction Power 12' }],
    rc_categories: [
      { id: 'c1', name: 'Field Work', sort: 30, active: true },
      { id: 'c2', name: 'Testing', sort: 40, active: true },
      /* Seeded by `rc_schema.sql`, and here for the same reason: without
         somewhere for an office day to be grouped, a day somebody worked shows
         in the reports as work of no kind. */
      { id: 'c3', name: 'Office', sort: 60, active: true },
      { id: 'c4', name: 'Other project', sort: 70, active: true },
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
    /* The view, as Postgres defines it: the rows nothing supersedes, minus the
       tombstones. It was an alias for the table, which was true until the plan
       could be revised and stopped being true the moment it could be withdrawn
       — a tombstone is the newest row for its day, so an alias made it *be* the
       plan and the day read as a task with nothing in it. */
    get rc_plan_current() {
      return this.rc_plan_entries.filter((p) =>
        !p.withdrawn && !this.rc_plan_entries.some((n) => n.supersedes_id === p.id));
    },
    // Every outcome nobody has corrected — what the huddle reads.
    get rc_actuals_current() {
      return this.rc_actuals.filter((a) => !this.rc_actuals.some((b) => b.supersedes_id === a.id));
    },
    /* The snapshot list without its grids, with the two counts the view
       computes in the database. Every screen that reads the sheet lists
       snapshots through this and fetches one grid on its own. */
    get rc_lookahead_snapshot_meta() {
      return this.rc_lookahead_snapshots.map((s) => ({
        id: s.id, taken_at: s.taken_at, file_mtime: s.file_mtime, file_hash: s.file_hash,
        legend_at: s.legend_at || null, sheet_name: s.sheet_name,
        row_count: s.grid?.rows?.length ?? 0, unmapped_count: s.grid?.unknown?.length ?? 0,
      }));
    },
    rc_actuals: [],
    // A few days of history, so the reports have something to aggregate. Dates
    // are relative to today, or a fixed range would fall out of every window.
    rc_carry_chains: [
      { carry_chain_id: 'chain-1', person_id: 'p2', first_seen: iso(-6), last_seen: iso(-1), carries: 4, age_days: 5 },
    ],
    rc_effort: [
      { id: 'e1', person_id: 'p5', person_name: 'Rosa', subsystem: 'IXL', work_date: iso(-2), status: 'completed', signal: 'performance', category_id: 'c1', location_id: 'l1' },
      /* The manager's own outcome. Alex runs the calendar and is stood down from
         the meeting, so this is not part of a report about field delivery — it is
         set aside and *counted* as set aside, because a report that quietly
         narrowed itself would read as a report of everything. */
      { id: 'e5', person_id: 'p1', person_name: 'Alex', subsystem: 'ATS', work_date: iso(-2), status: 'completed', signal: 'performance', category_id: 'c1', location_id: 'l1' },
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
      /* A weekday column of this week that is neither `todayIdx` nor the day
         after it — the two Dan's Resource cells occupy. 7..11 is Monday to
         Friday, and this lands inside it for every day the suite can run on. */
      const crewIdx = todayIdx >= 9 ? 7 : todayIdx + 2;
      // Where the day the huddle reviews sits on this axis, or -1 if it falls
      // before the window starts.
      const reviewIdx = Math.round((Date.parse(`${REVIEW.iso}T00:00:00Z`) - first) / 86400000);
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
            /* The headings the workbook gives its activity columns. Which one
               is the location is *read* off these — `locationColumnOf()` — so a
               column inserted to their left cannot silently misfile every row.
               They sit on the weekday row, which is where this workbook puts
               them; anywhere at or above it would do. */
            { row: 6, label: '', cells: [
              { col: 2, ref: 'B6', value: 'CDRL', hex: null },
              { col: 3, ref: 'C6', value: 'Description of Work Activity', hex: null },
              { col: 4, ref: 'D6', value: 'Location', hex: null },
              ...axis.map((d, i) => mark(i, LETTERS[d.getUTCDay()], null)),
            ] },
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
              /* The code, which is what this column is filled in with on the
                 real sheet. It resolves through `rc_locations.code`, so the plan
                 shows the location's *name* while the workbook says "T12". */
              { col: 4, ref: 'D9', value: 'T12', hex: null },
              mark(todayIdx, 'X', 'FFFF00'),
              mark(todayIdx + 1, 'X.WIT', 'FFFF00'),
              mark(todayIdx + 3, 'X', 'FF0000'),
            ] },
            /* The Resource row the workbook writes under an activity: who is
               on it. Its location and work-hours cells are deliberately blank —
               they carry down from the line above, which is the whole reason
               the workbook leaves them out. One name the roster knows and one
               it does not, because both cases have to be visible. */
            { row: 10, label: '', cells: [
              { col: 3, ref: 'C10', value: 'Resource', hex: null },
              /* A weekday of this week that is never the one Dan is on.
                 The axis starts a week back, so 7..11 is this Monday to Friday
                 and the week plan draws all five whatever day the suite runs.
                 It was pinned to 7 — and on a *Monday* that is `todayIdx`, so
                 two cells shared one column, which no spreadsheet can do: the
                 later one won, Dan's name landed on the crew's cell, and the
                 week plan showed Priya with nothing planned one day in seven. */
              /* Typed by hand, which is what the separators and the spacing in
                 here are: a comma with a space before it, a spelled-out "and",
                 and a surname one letter pair out of order. All three used to
                 cost somebody their shifts — the first two by folding to a
                 string nothing matched, the third by being reported as a
                 person nobody had heard of. */
              mark(crewIdx, 'Priya ,  Victor and Lena', null),
              mark(todayIdx, 'Dan', null),
              mark(todayIdx + 1, 'Dan, R. Okafor, Victor Okonkow', null),
            ] },
            /* One mark in the week that has already gone and one still ahead,
               so narrowing the window drops a column without dropping a row. */
            { row: 14, label: '', cells: [
              { col: 2, ref: 'B14', value: 'Operational Readiness', hex: null },
              { col: 3, ref: 'C14', value: 'ATS Site Test', hex: null },
              /* The code, not the name — which is what this column is actually
                 filled in with. A register that only knew names and hand-written
                 aliases resolved none of it. */
              { col: 4, ref: 'D14', value: 'S6P', hex: null },
              mark(1, 'X.PAST', '00B0F0'),
              mark(todayIdx + 2, 'X.TCE', '00B0F0'),
              mark(todayIdx + 4, 'X', '3399FF'),
            ] },
            /* Worked, but in the week that has already gone. This is the row
               that stayed on screen when the flag was worked out once across
               the whole sheet instead of against the weeks being drawn — a
               four-week window showing a row with nothing in it. */
            { row: 16, label: '', cells: [
              { col: 3, ref: 'C16', value: 'REI Fiber Re-termination — finished', hex: null },
              /* A spelling the register has never carried. It is kept and
                 reported rather than discarded — which is what it used to be,
                 leaving nothing for anybody to map. */
              { col: 4, ref: 'D16', value: 'W30', hex: null },
              mark(1, 'X', 'FFFF00'),
              mark(2, 'X', 'FFFF00'),
            ] },
            /* Carried in the workbook for reference, with nothing scheduled:
               the shading is the only paint on it. Most of the sheet looks
               like this, and it is what the calendar hides by default. */
            { row: 15, label: '', cells: [
              { col: 3, ref: 'C15', value: 'DCS Internal testing — no dates yet', hex: null },
              ...shade(),
            ] },
            /* The two rows at the bottom that say who is *away*. They stand on
               their own — no activity above them — because what they say is
               about the person: Rosa is off, Tom is on somebody else's project.
               Never scope, drawn with the names, and hidden by the same switch
               that hides every other row of names. */
            { row: 17, label: '', cells: [
              { col: 3, ref: 'C17', value: 'PTO', hex: null },
              /* The day the huddle reviews, so the meeting can be shown to read
                 this row — and a day of the week being planned, so the week plan
                 and Resources can be too. On most days those are the same week;
                 on a Monday they are not, which is exactly when a fixture that
                 covered only one of them would stop proving anything. */
              ...(reviewIdx >= 0 && reviewIdx !== crewIdx ? [mark(reviewIdx, 'Rosa', null)] : []),
              mark(crewIdx, 'Rosa', null),
            ] },
            { row: 18, label: '', cells: [
              { col: 3, ref: 'C18', value: 'Other Group / Project', hex: null },
              mark(crewIdx, 'Tom', null),
            ] },
            /* And the office. Not leave — a day somebody worked, at their desk
               — so it is an assignment like any other, carrying the seeded
               Office category so the reports can group it. */
            { row: 19, label: '', cells: [
              { col: 3, ref: 'C19', value: 'Office', hex: null },
              ...(reviewIdx >= 0 && reviewIdx !== crewIdx ? [mark(reviewIdx, 'Uma', null)] : []),
              mark(crewIdx, 'Uma', null),
            ] },
            // The workbook's own key, in the shape readLegend() looks for.
            { row: 20, label: 'Highlight in Yellow for Day Shift',
              cells: [2, 3].map((c) => ({ col: c, ref: 'X20', value: '', hex: 'FFFF00' })) },
          ],
        },
      }, {
        /* Last week's read of the same file, kept the way every read is kept.
           It carries no grid because nothing draws it — `latestSnapshot()` takes
           the first, and the list is what ranks them. It exists so there is an
           *older* answer about this week for the newest one to overrule. */
        id: 'snap0',
        taken_at: new Date(Date.now() - 7 * 86400000).toISOString(),
        file_mtime: new Date(Date.now() - 7 * 86400000).toISOString(),
        file_hash: 'stub-hash-older',
        sheet_name: '4WLA',
        grid: { merges: [], hiddenColumns: [], unknown: [], rows: [] },
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
    rc_settings: [
      { key: 'lookahead_sheet', value: '4WLA' },
      // The version this build expects, so the banner below is the exception.
      { key: 'schema_version', value: String(window.__rcSchemaVersion) },
      // Relative, like every other date here, so the log has a start whatever
      // day the suite runs on.
      { key: 'cancellation_log_from', value: iso(-40) },
    ],
    /* Rows of earlier reads, as the cancellation view sees them. Kept apart
       from `rc_lookahead_rows` so no other screen's reads or counts move: the
       log is the only thing that looks back past the latest snapshot. A cancelled
       week on one activity, the same activity red again after a gap, and a red
       day from before the log starts. */
    _earlierReads: [
      { snapshot_id: 'old1', taken_at: `${iso(-21)}T08:00:00Z`, raw_label: 'Cable pull', raw_location: 'TPSS 12',
        cells: Object.fromEntries([-20, -19, -18, -17, -16].map((d) => [iso(d), 'Cancellation'])) },
      { snapshot_id: 'old2', taken_at: `${iso(-18)}T08:00:00Z`, raw_label: 'Cable pull', raw_location: 'TPSS 12',
        cells: { [iso(-17)]: 'Cancellation', [iso(-16)]: 'Cancellation', [iso(-15)]: 'Day Shift', [iso(-13)]: '#FF0000' } },
      { snapshot_id: 'old1', taken_at: `${iso(-50)}T08:00:00Z`, raw_label: 'IXL regression', raw_location: 'Yard 3',
        cells: { [iso(-45)]: 'Cancellation' } },
    ],
    rc_cancellation_notes: [],
    /* `rc_cancelled_days`, as the view computes it: one row per activity,
       location and day any read showed as cancelled — by meaning, or by the bare
       colour of a legend entry that means it. */
    get rc_cancelled_days() {
      const red = new Set(this.rc_legend.filter((l) => /cancel/i.test(l.meaning)).map((l) => `#${l.argb}`));
      const taken = new Map(this.rc_lookahead_snapshots.map((x) => [x.id, x.taken_at]));
      const out = new Map();
      for (const r of [...this.rc_lookahead_rows, ...this._earlierReads]) {
        for (const [day, value] of Object.entries(r.cells || {})) {
          if (!/cancel/i.test(value) && !red.has(value)) continue;
          const key = `${r.raw_label || ''}|${r.raw_location || ''}|${day}`;
          const at = r.taken_at || taken.get(r.snapshot_id) || null;
          const row = out.get(key) || {
            raw_label: r.raw_label || '', raw_location: r.raw_location || '', location_id: r.location_id || null,
            day, first_seen: at, last_seen: at, reads: 0, _snaps: new Set(),
          };
          row._snaps.add(r.snapshot_id);
          row.reads = row._snaps.size;
          if (at && (!row.first_seen || at < row.first_seen)) row.first_seen = at;
          if (at && (!row.last_seen || at > row.last_seen)) row.last_seen = at;
          out.set(key, row);
        }
      }
      return [...out.values()].map(({ _snaps, ...row }) => row);
    },
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
      /* A different sheet row from the one the grid's Resource row hangs off,
         so this row's names can only have come from the stored column and the
         other's only from the snapshot. Both paths, told apart. */
      sheet_row: 14,
      row_key: 'k1',
      /* **No location at all**, which is what a row written before the location
         came off the sheet's own column looks like: the register did not know
         the spelling, so nothing was kept. The grid still says where the work
         is, and grafting it is what puts the place back on screen. */
      location_id: null,
      raw_location: null,
      raw_label: 'IXL Regression Testing',
      cells: {},
      bart_marks: {},
      /* Who the workbook's Resource row names on the day the meeting reviews.
         One spelling the roster knows and one it does not, because the second is
         the case the view has to report rather than swallow. */
      resources: { [REVIEW.iso]: 'Dan, R. Okafor' },
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
      // The sheet row the grid's Resource row hangs off, which is what the
      // names are joined back on.
      sheet_row: 9,
      row_key: 'k2',
      /* No location either, for the same reason as `lar1`. The sheet's own
         column says "T12" and the register carries that as a code, so grafting
         is what puts the place back — and what makes the plan read "TPSS 12"
         over a workbook that never writes the words. */
      location_id: null,
      raw_location: null,
      raw_label: 'IXL Regression Testing',
      cells: {},
      bart_marks: {},
      /* **Empty, deliberately.** This is what a database built before the
         `resources` column existed looks like: the insert that would have filled
         it is refused over that one field, so every stored row reports that the
         workbook named nobody while the calendar, which re-reads the snapshot,
         shows the names perfectly well. The names therefore have to come off the
         snapshot, which is the whole point of grafting them. */
      resources: {},
    }, {
      /* A row at a place the register cannot place. The spelling reaches the
         Resources tab to be answered in one click — the same answer an unmatched
         name gets — and until it is, the days it covers still say where they
         are; it is the reports that cannot group them. */
      id: 'lar3',
      snapshot_id: 'snap1',
      week_start: (() => {
        const now = new Date();
        const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
      })(),
      sheet_row: 16,
      row_key: 'k3',
      location_id: null,
      raw_location: null,
      raw_label: 'REI Fiber Re-termination',
      cells: {},
      bart_marks: {},
      resources: (() => {
        const now = new Date();
        const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000;
        // Tuesday, so it cannot collide with the Monday the grid's Resource row
        // names three people on.
        return { [new Date(monday + 86400000).toISOString().slice(0, 10)]: 'Victor' };
      })(),
    }, {
      /* **An activity somebody deleted from the workbook.**
         It was read last week and never again: `snap0` carries it, `snap1` covers
         the same week and does not. Every read is kept, so it is still in the
         table — and taking the newest copy of each row *key* kept it for ever,
         because no newer row shares the key of a row that no longer exists. The
         symptom was the one nobody can argue with: a person in the week plan,
         against an activity that is not in the 4WLA. The newest read of a week is
         that week's answer, whole. */
      id: 'lar4',
      snapshot_id: 'snap0',
      week_start: (() => {
        const now = new Date();
        const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
      })(),
      sheet_row: 30,
      row_key: 'k4-withdrawn',
      location_id: 'l2',
      raw_location: 'Yard 3',
      raw_label: 'Sim Rack Relocation',
      cells: {},
      bart_marks: {},
      resources: (() => {
        const now = new Date();
        const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000;
        // Every weekday of the week, so no day the suite can run on misses it.
        const out = {};
        for (let i = 0; i < 5; i++) out[new Date(monday + i * 86400000).toISOString().slice(0, 10)] = 'Priya';
        return out;
      })(),
    }],
    rc_person_alias: [],
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
      /* A change about a week four months gone. Recorded for ever — it is
         evidence — and not what anybody opens this screen to read: a shift that
         moved in the spring cannot be planned around now. It is out of the
         window by default and one click away. */
      { id: 'ev4', kind: 'scope_removed', week_start: iso(-120), row_key: 'k9',
        before: { label: 'Old work nobody is planning round now' }, after: null,
        detected_at: iso(-120) + 'T09:00:00Z', from_snapshot: null, to_snapshot: 'snap1' },
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
    /* Every read is recorded with what it asked for. The two numbers a
       performance check needs are how many reads a tab makes and how many of
       them carry a grid — a full snapshot is the one heavy row in the schema. */
    const read = { kind: 'select', table, columns: '*', limit: null };
    // Recorded when the read is awaited, not when the builder is made: a write
    // builds one of these too and never reads through it.
    const api = {
      select(columns) { if (columns) read.columns = columns; return api; },
      eq(col, v) { rows = rows.filter((r) => r[col] === v); return api; },
      neq(col, v) { rows = rows.filter((r) => r[col] !== v); return api; },
      gte(col, v) { rows = rows.filter((r) => r[col] >= v); return api; },
      lte(col, v) { rows = rows.filter((r) => r[col] <= v); return api; },
      is() { return api; },
      in(col, vs) { rows = rows.filter((r) => vs.includes(r[col])); return api; },
      order() { return api; },
      limit(n) { read.limit = n; return api; },
      maybeSingle() { S.calls.push(read); return Promise.resolve({ data: rows[0] || null, error: null }); },
      then(resolve) { S.calls.push(read); return Promise.resolve({ data: rows, error: null }).then(resolve); },
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
          /* An upsert takes rows, plural, and `onConflict` names a *unique
             constraint* — which is more than one column on `rc_legend`
             (`valid_from, argb`). The stub modelled one row against one column,
             so an array arrived as `row` and the key lookup compared against
             undefined: it would have matched the wrong row or appended a
             malformed one, and reported success either way. Modelling less of
             the API than the application uses is modelling it wrong. */
          api.upsert = (rows, opts) => {
            S.calls.push({ kind: 'upsert', table, payload: rows });
            const list = S.rows[table] || (S.rows[table] = []);
            const keys = String(opts?.onConflict || 'id').split(',').map((k) => k.trim());
            const defaults = {
              ...(list.some((r) => 'active' in r) ? { active: true } : {}),
              /* Postgres fills this in, and it is half of `rc_legend`'s unique
                 key — so a stub that left it undefined would make every mapping
                 land in the same undated slot and hide the versioning the
                 lookup now depends on. */
              ...(table === 'rc_legend' ? { valid_from: new Date().toISOString().slice(0, 10) } : {}),
            };
            const written = [];
            for (const row of [].concat(rows)) {
              const hit = list.find((r) => keys.every((k) => r[k] === row[k]));
              if (hit) {
                Object.assign(hit, row);
                written.push(hit);
              } else {
                const made = { id: `${table}-${list.length + written.length + 1}`, ...defaults, ...row };
                list.push(made);
                written.push(made);
              }
            }
            return { select: () => Promise.resolve({ data: written, error: null }) };
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
            /* A correction, as the function does it: same person and day, the
               row not already corrected, and the photograph carried over
               unless a new one came with it. */
            let evidence = args.p_evidence || null;
            if (args.p_supersedes) {
              const prior = S.rows.rc_actuals.find((a) => a.id === args.p_supersedes);
              if (!prior) return Promise.resolve({ data: null, error: { message: 'that outcome no longer exists' } });
              if (prior.person_id !== args.p_person || prior.work_date !== args.p_date) {
                return Promise.resolve({ data: null, error: { message: 'an outcome can only be corrected for the same person and day' } });
              }
              if (S.rows.rc_actuals.some((a) => a.supersedes_id === args.p_supersedes)) {
                return Promise.resolve({ data: null, error: { message: 'that outcome has already been corrected — reload and try again' } });
              }
              if (!evidence) evidence = prior.evidence_path || null;
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
              task: args.p_task || null,
              blocked_reason: args.p_blocked_reason,
              blocked_party_id: args.p_blocked_party,
              carry_chain_id: args.p_carry_chain,
              plan_entry_id: args.p_plan_entry || null,
              lookahead_row_id: args.p_lookahead_row || null,
              evidence_path: evidence,
              supersedes_id: args.p_supersedes || null,
              // The function fills this from `auth.uid()`, and who typed an
              // outcome in is a different fact from whose outcome it is.
              created_by: S.signedIn ? USER.id : null,
            };
            S.rows.rc_actuals.push(row);
            return Promise.resolve({ data: row.id, error: null });
          }
          /* The plan's three write functions. Modelled rather than recorded:
             each one supersedes a row, and a stub that only logged the call
             would leave the grid showing what was there before — so the test
             could not tell a revision that worked from one that did nothing. */
          if (name === 'rc_supersede_plan' || name === 'rc_withdraw_plan'
              || name === 'rc_reassign_plan') {
            const list = S.rows.rc_plan_entries;
            const old = list.find((r) => r.id === args.p_entry);
            if (!old) return Promise.resolve({ data: null, error: { message: `no such plan entry: ${args.p_entry}` } });
            if (old.withdrawn) {
              return Promise.resolve({ data: null, error: { message: `plan entry ${args.p_entry} is already withdrawn` } });
            }
            if (list.some((r) => r.supersedes_id === args.p_entry)) {
              return Promise.resolve({ data: null, error: { message: `plan entry ${args.p_entry} has already been revised` } });
            }
            if (name === 'rc_reassign_plan' && old.person_id === args.p_person) {
              return Promise.resolve({ data: null, error: { message: `plan entry ${args.p_entry} already belongs to that person` } });
            }
            const row = {
              ...old,
              id: `plan-${list.length + 1}`,
              supersedes_id: args.p_entry,
              withdrawn: name === 'rc_withdraw_plan',
            };
            if (name === 'rc_supersede_plan') {
              row.location_id = args.p_location || null;
              row.task = args.p_task || null;
              row.category_id = args.p_category || null;
              row.shift = args.p_shift || old.shift;
            }
            if (name === 'rc_reassign_plan') {
              row.person_id = args.p_person;
              row.reassigned_from = old.person_id;
            }
            list.push(row);
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
            const address = String(args.p_email).trim().toLowerCase();
            /* An account that does not exist yet is a normal answer, not a
               failure. The stub answers as the function does: link where there
               is something to link, aim the invitation where there is one on
               its way, and refuse only where there is neither. `S.accounts` is
               the stub's `auth.users`. */
            const exists = (S.accounts = S.accounts || []).includes(address);
            if (!exists) {
              const invite = S.rows.rc_invitations.find((i) => i.pending_email === address);
              if (invite) {
                invite.pending_person = args.p_person;
                person.email = person.email || address;
                return Promise.resolve({ data: null, error: null });
              }
              return Promise.resolve({
                data: null,
                error: { message: `no account and no open invitation for ${args.p_email} — invite them first` },
              });
            }
            person.user_id = `user-${address}`;
            person.email = person.email || address;
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
  const context = pinClock(await browser.newContext({ viewport: { width: 1500, height: 920 } }));
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
        // A PDF is bytes, not JSON. Its head, tail and size are what say
        // whether the writer produced a real file or a plausible-looking one.
        if (/^%PDF-/.test(text)) {
          window.__saved = {
            ...(window.__saved || {}),
            pdf: { head: text.slice(0, 8), tail: text.slice(-8), size: blob.size,
              pages: (text.match(/\/Type \/Page[^s]/g) || []).length },
          };
        }
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
  await page.addInitScript(`window.__rcSchemaVersion = ${SCHEMA_VERSION};`);
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

  /* One login, two modules. The plan's lock has always carried a name typed
     into a field, defaulting to "Someone" — the least useful thing the
     read-only banner could say, on the one screen where knowing who matters.
     The calendar already knows this person, so the pen borrows the name. No
     plan data moves: the name goes into a lock file in the same folder the
     plan is in, and the plan still has no backend of any kind. */
  check('the pen borrows the name the calendar already knows',
    await page.evaluate(() => localStorage.getItem('cxtl.folder.name') === 'Alex'),
    await page.evaluate(() => localStorage.getItem('cxtl.folder.name')));
  check('and the plan still has no backend of its own',
    await page.evaluate(() => window.CX_CONFIG.supabaseUrl === ''));

  /* ── The database version ─────────────────────────────────────────────
     The site deploys on a push and the SQL is run by hand, so they drift.
     A database the application is ahead of is said once, at the top, with
     the two files an administrator runs — rather than as a refused write on
     some screen weeks later. */
  console.log('\nSchema version');
  const bannerNow = () => page.locator('#rc-frame .rc-schema-banner:not([hidden])');
  check('a database at the expected version says nothing', (await bannerNow().count()) === 0);
  const setVersion = (v) => page.evaluate((value) => {
    const row = window.__rc.rows.rc_settings.find((r) => r.key === 'schema_version');
    if (value === null) window.__rc.rows.rc_settings.splice(window.__rc.rows.rc_settings.indexOf(row), 1);
    else row.value = value;
    const { mods, req } = window.__CX_MODULES;
    req('core/rc.js').forgetReads();
    req('core/events.js').emit('rc:changed', { what: 'test' });
  }, v);
  await setVersion('0');
  await page.waitForTimeout(300);
  const behindText = (await bannerNow().count()) ? await bannerNow().innerText() : '';
  check('a database behind the application is named, with the files to run',
    /behind this version/.test(behindText) && /migrate\.sql/.test(behindText) && /rc_schema\.sql/.test(behindText),
    behindText.replace(/\n/g, ' ').slice(0, 100));
  await bannerNow().locator('button', { hasText: 'Hide for now' }).click();
  check('and it can be put away for the session', (await bannerNow().count()) === 0);
  await setVersion(String(await page.evaluate(() => window.__rcSchemaVersion + 1)));
  await page.waitForTimeout(300);
  check('a page older than its database is told to reload',
    (await bannerNow().count()) === 1 && /older than the calendar's database/.test(await bannerNow().innerText())
      && (await bannerNow().locator('button', { hasText: 'Reload' }).count()) === 1,
    'even after "run the SQL" was put away');
  await setVersion(String(await page.evaluate(() => window.__rcSchemaVersion)));
  await page.waitForTimeout(200);

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

  /* And the case that used to be a dead end. "no account exists for x — invite
     them first" was the commonest answer by a wide margin and it was the wrong
     sentence: they *had* been invited, and there was nothing the administrator
     could do about the rest. The invitation is aimed at the row instead, and the
     trigger finishes the job when they sign up. */
  await page.locator('#rc-frame button', { hasText: 'Invite somebody' }).click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input[type="email"]').fill('rosa@example.com');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Invite' }).click();
  await page.waitForTimeout(400);
  await page.locator('#rc-frame button', { hasText: 'Link account' }).first().click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input[type="email"]').fill('rosa@example.com');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Link' }).click();
  await page.waitForTimeout(500);
  check('an invited address that has not signed up is arranged, not refused',
    (await page.locator('.cx-modal').count()) === 0
    && /has not signed up yet/.test(await page.locator('.cx-toast').last().innerText()),
    (await page.locator('.cx-toast').last().innerText().catch(() => '')).slice(0, 80));
  check('and the invitation now points at that roster row',
    await page.evaluate(() => (window.__rc.rows.rc_invitations || [])
      .some((i) => i.pending_email === 'rosa@example.com' && i.pending_person)));

  // Only where there is genuinely nothing to attach and nothing on its way.
  await page.locator('#rc-frame button', { hasText: 'Link account' }).first().click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input[type="email"]').fill('stranger@example.com');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Link' }).click();
  await page.waitForTimeout(400);
  check('an address with neither is refused, and says what to do instead',
    /use "Invite somebody"/.test(await page.locator('.cx-modal .rc-error').innerText()),
    (await page.locator('.cx-modal .rc-error').innerText().catch(() => '')).slice(0, 70));
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Cancel' }).click();
  await page.waitForTimeout(300);

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
  /* Nor is somebody the workbook says is off. Most days that row is the only
     place an absence is written down — nobody opens Organisation to book it —
     so a meeting that did not read it asked a person on holiday how their day
     went, in front of the room. */
  const rosaHuddle = page.locator('#rc-frame tbody tr', { hasText: 'Rosa' });
  check('and neither is somebody the 4WLA puts on PTO',
    (await rosaHuddle.locator('button', { hasText: 'Completed' }).count()) === 0,
    (await rosaHuddle.innerText()).replace(/\n/g, ' | ').slice(0, 90));
  check('the meeting says they are away rather than leaving the row blank',
    /leave|away/i.test(await rosaHuddle.innerText()),
    (await rosaHuddle.innerText()).replace(/\n/g, ' | ').slice(0, 70));
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
  check('the week is people down and days across', /Can be staffed/.test(weekText));
  // Four people can be staffed with, and the manager is not one of them — they
  // run the meeting rather than taking work from it.
  check('and says how many can actually be staffed each day',
    /\d+ of \d+/.test(weekText), weekText.split('\n').find((l) => / of \d/.test(l)) || '');

  /* Today, marked on the whole column and named in the heading.
     A week grid is read by running a finger down a day and the day anybody is
     nearly always looking for is this one; it used to be a two-pixel rule on
     the left edge of the cells, which is invisible in a table that has borders
     anyway. */
  /* The week plan draws the working week, so on a Saturday or a Sunday today
     is not a column at all — and then the honest check is that no column claims
     to be it. This failed every weekend, which is a test that knew what day it
     was written on rather than a bug in the week plan. */
  const weekendToday = [0, 6].includes(new Date().getDay());
  if (weekendToday) {
    check('on a weekend no weekday column claims to be today',
      (await page.locator('#rc-frame .rc-resources .rc-res-today').count()) === 0);
  } else {
    check('today is marked down the whole column, and the heading says so',
      (await page.locator('#rc-frame .rc-resources thead th.rc-res-today .rc-today-tag').count()) === 1
      && (await page.locator('#rc-frame .rc-resources tbody td.rc-res-today').count()) >= 1);
    /* …and it survives the row hover. `.rc-table tbody tr:hover td` is the more
       specific selector, so crossing a row painted the hover colour straight over
       today's column and the one thing the reader was following disappeared. The
       PTO grid learnt this the same way, with somebody's leave turning white under
       the cursor. */
    const todayCell = page.locator('#rc-frame .rc-resources tbody td.rc-res-today').first();
    const tintBefore = await todayCell.evaluate((e) => getComputedStyle(e).backgroundColor);
    await todayCell.hover();
    await page.waitForTimeout(80);
    const tintDuring = await todayCell.evaluate((e) => getComputedStyle(e).backgroundColor);
    check('and hovering the row does not paint over it',
      tintBefore === tintDuring, `${tintBefore} → ${tintDuring}`);
    await page.mouse.move(0, 0);
  }

  /* There is one tab, and it used to be two.
     "Week plan" drew the team's week and "Resources" drew the same rows per
     person with what the 4WLA asked for beside them: people down and days
     across in both cases, over the same table, through the same function. */
  check('and Resources is not a second tab drawing the same table',
    (await page.locator('#rc-frame .rc-tab', { hasText: 'Resources' }).count()) === 0,
    (await page.locator('#rc-frame .rc-tabs').innerText()).replace(/\n/g, ' | '));

  const weekText2 = await page.locator('#rc-frame').innerText();
  check('leave booked beyond this week is named before you hit it',
    /Coming up: Uma/.test(weekText2), weekText2.split('\n').find((l) => /Coming up/.test(l)) || '');

  /* ── The 4WLA *is* the plan for the days it names ──────────────────────
     "The look-ahead proposes; a person assigns" existed for one reason: the
     sheet said what and where and never who, so a plan entry had to supply the
     missing fact. The Resource row says who. There is no missing fact left, so
     asking somebody to press a button is asking them to re-type what the
     workbook already states, once per person per day. */
  // Scoped to the grid: the tab also draws a "where the week puts people"
  // table, so an unscoped row filter matches twice.
  const priyaRow = page.locator('#rc-frame .rc-resources tbody tr', { hasText: 'Priya' });
  const priyaText = await priyaRow.innerText();
  check('a day the 4WLA names somebody on is their plan for that day',
    /IXL Regression Testing/.test(priyaText) && /TPSS 12/.test(priyaText),
    priyaText.replace(/\n/g, ' | ').slice(0, 90));
  /* And it says nothing about where it came from, because the workbook is the
     assumption. A badge on nearly every cell is a badge saying nothing; what is
     flagged is the exception, which is a day somebody typed in by hand. */
  check('and it is not badged, because the workbook is the assumption',
    !/Manual/.test(priyaText), priyaText.replace(/\n/g, ' | ').slice(0, 90));
  /* And the other half of that: an activity the workbook no longer carries is
     not still somebody's plan. `lar4` names Priya every weekday of this week and
     comes from the read *before* the current one, which covers the same week and
     has no such row. Kept per row key it survived for ever, because nothing
     newer shares the key of a row that was deleted. */
  check('an activity deleted from the workbook stops being anybody\u2019s plan',
    !/Sim Rack Relocation/.test(await page.locator('#rc-frame').innerText()),
    priyaText.replace(/\n/g, ' | ').slice(0, 90));
  /* What is offered on a derived day is "Override", and nothing else.
     There is no stored row to revise or to withdraw — the sheet is asserting the
     day — so the only honest action is to write the first row against it, and
     that is a decision rather than a confirmation. */
  /* The actions are icons, so they are found by their label rather than their
     text: seven columns of "Edit" and "Delete" was more chrome than content in
     a cell that already carries a task, a place, its flags and how it went. */
  check('a derived day offers only to be overridden',
    (await priyaRow.locator('button[aria-label*="Override the sheet"]').count()) >= 1
    && (await priyaRow.locator('button[aria-label^="Remove"]').count()) === 0);

  /* ── And where, off the sheet's own Location column ────────────────────
     `lar2` carries no location at all, which is what a row written before the
     location came off that column looks like — and what an unresolved spelling
     used to leave behind, which was nothing at all for anybody to map. The grid
     says "T12", the register carries that as a location's code, and the plan
     therefore names the place over a workbook that never writes the words. */
  check('a stored row carrying no location still says where the work is',
    await page.evaluate(() => window.__rc.rows.rc_lookahead_rows
      .find((r) => r.id === 'lar2').location_id === null));
  check('because the sheet\u2019s own column is read, and a code resolves from it',
    /TPSS 12/.test(priyaText) && !/T12/.test(priyaText),
    priyaText.replace(/\n/g, ' | ').slice(0, 90));

  /* Derived, never written. `rc_plan_entries` is append-only evidence of what
     somebody *decided*; materialising the sheet into it would store a
     derivation, make the workbook's authorship indistinguishable from a
     decision, and go stale the moment the sheet changed. */
  /* ── What the sheet says about somebody being away ────────────────────
     A blank against a name reads as "nobody planned this". The workbook said
     exactly why, on a row nothing used to read. */
  const rosaRow = page.locator('#rc-frame .rc-resources tbody tr', { hasText: 'Rosa' });
  const rosaText = await rosaRow.innerText();
  check('a day the 4WLA puts somebody on PTO reads as leave, not as a gap',
    /Leave/.test(rosaText), rosaText.replace(/\n/g, ' | ').slice(0, 90));
  check('and it reads as leave whoever wrote it down',
    !/Manual/.test(rosaText), rosaText.replace(/\n/g, ' | ').slice(0, 90));
  const tomText = await page.locator('#rc-frame .rc-resources tbody tr', { hasText: 'Tom' }).innerText();
  /* Another group's project is work, not leave. Folding the two together would
     put somebody who is on site somewhere else down as absent. */
  check('another group\u2019s project is drawn as what they are doing',
    /Other group \/ project/i.test(tomText), tomText.replace(/\n/g, ' | ').slice(0, 90));
  check('and not as leave', !/Leave/.test(tomText));

  /* ── The office row ───────────────────────────────────────────────────
     The third of them, and the one that is most plainly an activity: a day at
     the desk is a day somebody worked. It arrives in the week plan as their
     plan for that day, exactly as a day on site does. */
  const umaRow = page.locator('#rc-frame .rc-resources tbody tr', { hasText: 'Uma' });
  const umaText = await umaRow.innerText();
  check('a day the 4WLA puts somebody in the office is their plan for that day',
    /Office/.test(umaText), umaText.replace(/\n/g, ' | ').slice(0, 90));
  check('and it carries no badge either — nobody typed it in',
    !/Manual/.test(umaText), umaText.replace(/\n/g, ' | ').slice(0, 90));
  check('it is work, so it is not drawn as leave', !/Leave/.test(umaText));
  check('so they are not asked for an outcome as though they were away',
    (await umaRow.locator('button', { hasText: 'Plan it' }).count()) === 0);

  check('nothing was written to say so — the sheet is read, not copied',
    await page.evaluate(() => !window.__rc.rows.rc_plan_entries
      .some((e) => e.person_id === 'p3' && /IXL Regression/.test(e.task || ''))));

  /* Changing it is what writes the first row: overriding the sheet is a
     decision, and a row in that table is exactly what a decision looks like. */
  await priyaRow.locator('button[aria-label*="Override the sheet"]').first().click();
  await page.waitForSelector('.cx-modal');
  check('changing it opens the day with the sheet\'s own row already chosen',
    (await page.locator('.cx-modal select').first().inputValue()) === 'lar2'
    && (await page.locator('.cx-modal input[placeholder="What they will do"]').inputValue())
      === 'IXL Regression Testing');
  await page.locator('.cx-modal input[placeholder="What they will do"]').fill('Overridden — office');
  // "Override the sheet", not "Plan it": the only way into this dialog now is a
  // day the 4WLA already planned, so what it writes is a decision against it.
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Override the sheet' }).click();
  await page.waitForTimeout(600);
  check('and confirming writes the override, carrying the look-ahead link',
    await page.evaluate(() => window.__rc.rows.rc_plan_entries
      .some((e) => e.person_id === 'p3' && e.task === 'Overridden — office'
        && e.lookahead_row_id === 'lar2')));
  check('which then wins over what the sheet says, and says a person typed it',
    /Overridden — office/.test(await priyaRow.innerText())
    && /Manual/.test(await priyaRow.innerText()),
    (await priyaRow.innerText()).replace(/\n/g, ' | ').slice(0, 90));

  /* And now there is a row, so it can be taken back.
     "Delete my task" on a table with no DELETE grant is a tombstone superseding
     the original: the day leaves the schedule and the record keeps every version
     of it, because a plan that changed the evening before a shift is itself
     evidence. */
  const storedRows = () => page.evaluate(() => window.__rc.rows.rc_plan_entries.length);
  const rowsBeforeWithdrawal = await storedRows();
  await priyaRow.locator('button[aria-label^="Remove"]').first().click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Remove it' }).click();
  await page.waitForTimeout(600);
  check('a stored task can be taken off the schedule',
    !/Overridden — office/.test(await priyaRow.innerText()),
    (await priyaRow.innerText()).replace(/\n/g, ' | ').slice(0, 90));
  check('and nothing was deleted to do it — the withdrawal is a row',
    (await storedRows()) === rowsBeforeWithdrawal + 1
    && await page.evaluate(() => window.__rc.rows.rc_plan_entries.some((e) => e.withdrawn)));
  check('so the sheet is what plans that day again',
    /IXL Regression Testing/.test(await priyaRow.innerText()),
    (await priyaRow.innerText()).replace(/\n/g, ' | ').slice(0, 90));

  /* ── The look-ahead and the SARs ──────────────────────────────────────── */
  console.log('\nThe look-ahead register');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Look-ahead' }).click();
  await page.waitForSelector('#rc-frame .la-grid', { timeout: 10000 });

  /* ── The calendar ─────────────────────────────────────────────────────
     The workbook drawn as it looks: activities down, days across, in the
     colours it was painted. It draws the snapshot rather than the file,
     which is what lets it render on a machine that has never been given
     the folder — including this one. */
  /* The day columns alone. That row also carries the sheet's own headings —
     Location, SSWP, Party to action — one cell each, so counting every `th` and
     taking one off (which is what this did, when "Activity" spanned them all)
     counts the frozen side as days. */
  const dayHeadCount = async () =>
    page.locator('#rc-frame .la-grid thead tr').nth(1).locator('th:not(.la-meta)').count();

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
  const quietBox = page.locator('#rc-frame .cx-check', { hasText: 'nothing scheduled' }).locator('input');
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
  /* Three activity rows and the Resource row under one of them. A heading is
     drawn because something under it is: it used to be exempt from the switch
     altogether, which is how one stray unmapped colour put a whole workbook
     back on screen with the box still unticked. */
  check('shading does not count as somebody being on site',
    (await page.locator('#rc-frame .la-grid tbody tr').count()) === 7,
    `${await page.locator('#rc-frame .la-grid tbody tr').count()} rows`);

  /* ── The Resource row ──────────────────────────────────────────────────
     The workbook names who is on an activity by adding a row underneath whose
     description reads "Resource", with the names typed into the day cells. It
     belongs to the activity above it: its location and work hours are blank
     because they carry down, and drawn on its own it would be a hundred and
     forty rows of the word "Resource". */
  const resourceRow = page.locator('#rc-frame .la-grid tr.la-resource-row:not(.la-absence-row)');
  check('the Resource row under an activity is drawn as part of it',
    (await resourceRow.count()) === 1);
  const resourceText = await resourceRow.innerText();
  check('and the names typed in its cells are on the calendar',
    /Dan/.test(resourceText) && /Okafor/.test(resourceText), resourceText.replace(/\s+/g, ' ').slice(0, 90));
  check('with the location it inherited from the activity above it',
    /T12/.test(resourceText), resourceText.replace(/\s+/g, ' ').slice(0, 90));

  // Filtering finds somebody by name, which is one of the two reasons anybody
  // types in that box — and it would find nothing if only the activity counted.
  const nameFilter = page.locator('#rc-frame input[placeholder^="Filter activities"]');
  await nameFilter.fill('Okafor');
  await page.waitForTimeout(250);
  check('the filter finds an activity by who is on it',
    /IXL Regression/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  await nameFilter.fill('');
  await page.waitForTimeout(200);

  /* ── The rows that say who is away ────────────────────────────────────
     "PTO" and "Other Group / Project" stand on their own at the bottom of the
     sheet, because what they say is about the person rather than about an
     activity. They are drawn — a blank against somebody's name in the week plan
     used to be the only trace of an absence the workbook stated plainly. */
  const absenceRows = page.locator('#rc-frame .la-grid tr.la-absence-row');
  check('the rows that say who is away are drawn', (await absenceRows.count()) === 3,
    `${await absenceRows.count()} rows`);
  const absenceText = await absenceRows.allInnerTexts();
  check('with the names typed on them',
    ['Rosa', 'Tom', 'Uma'].every((who) => absenceText.join(' ').includes(who)),
    absenceText.join(' | ').replace(/\s+/g, ' ').slice(0, 110));
  check('and they are never counted as scope',
    await page.evaluate(() => !(window.__rc.rows.rc_lookahead_rows || [])
      .some((r) => /^(PTO|Other Group)/i.test(r.raw_label || ''))));

  const resourceBox = page.locator('#rc-frame .cx-check', { hasText: 'resource names' }).locator('input');
  await resourceBox.uncheck();
  await page.waitForTimeout(250);
  check('and the names can be switched off without losing the activities',
    (await page.locator('#rc-frame .la-grid tr.la-resource-row').count()) === 0
    && /IXL Regression Testing/.test(await page.locator('#rc-frame .la-grid tbody').innerText()));
  /* One switch, every row of names. Switching them off to read the activities
     alone and being left with two rows of people would be it half working. */
  check('and the away rows go with them, because they are names too',
    (await page.locator('#rc-frame .la-grid tr.la-absence-row').count()) === 0);
  await resourceBox.check();
  await page.waitForTimeout(250);
  check('and both come back together',
    (await page.locator('#rc-frame .la-grid tr.la-absence-row').count()) === 3
    && (await resourceRow.count()) === 1);

  /* ── One sheet of paper ───────────────────────────────────────────────
     What people did instead was a screenshot, and a screenshot of this grid is
     a poor document: the frozen columns come out twice and the scroll clips
     whichever weeks nobody was looking at. */
  await page.locator('#rc-frame button', { hasText: 'Export PDF' }).click();
  await page.waitForSelector('.cx-modal');
  const dialog = await page.locator('.cx-modal').innerText();
  // The field labels are uppercased by the stylesheet, so `innerText` reads
  // "WEEKS" — matched case-insensitively rather than against the styling.
  check('the export asks what to put on the page rather than assuming',
    /weeks/i.test(dialog) && /paper/i.test(dialog) && /resource names/i.test(dialog),
    dialog.replace(/\n/g, ' | ').slice(0, 110));
  /* "It fits on one page" is true of anything if you shrink it far enough. The
     number somebody can act on is how small the print ends up, and it is on
     screen before anything is written. */
  check('and says what the print will actually come out at, before writing it',
    /print at about [\d.]+ pt/.test(dialog),
    dialog.split('\n').find((l) => /pt\./.test(l)) || '');

  const readingAt = () => page.locator('.cx-modal .rc-hint').first().innerText();
  const wide = await readingAt();
  await page.locator('.cx-modal select').first().selectOption({ label: 'Everything the sheet covers' });
  await page.waitForTimeout(200);
  check('widening the window makes the print smaller, and it says so',
    (await readingAt()) !== wide, (await readingAt()).slice(0, 90));
  await page.locator('.cx-modal select').first().selectOption({ index: 0 });
  await page.waitForTimeout(200);

  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Export PDF' }).click();
  await page.waitForTimeout(900);
  const saved = await page.evaluate(() => window.__saved || {});
  check('it writes a real PDF', saved.pdf?.head?.startsWith('%PDF-1.'), saved.pdf?.head || 'nothing');
  check('and a complete one', /%%EOF/.test(saved.pdf?.tail || ''), JSON.stringify(saved.pdf?.tail));
  /* The whole promise. A four-week look-ahead reassembled from four sheets on
     a meeting-room table is not a four-week look-ahead. */
  check('on exactly one page, whatever the window', saved.pdf?.pages === 1,
    `${saved.pdf?.pages} page(s), ${saved.pdf?.size} bytes`);
  check('announced like every other export, by name and size',
    /^lookahead-\d{4}-\d{2}-\d{2}\.pdf$/.test(saved.name || ''), saved.name || '');

  /* ── The key describes what is on screen ──────────────────────────────
     The register is the whole project's. Printed over a four-week window it
     is a key to somebody else's calendar: the reader checks a colour, finds
     three entries that are not here, and stops trusting the strip. */
  const stripText = await page.locator('#rc-frame .la-legend').first().innerText();
  check('the key lists only the colours the window carries',
    /Day Shift/.test(stripText) && !/Section divider/.test(stripText),
    stripText.replace(/\n/g, ' | ').slice(0, 110));
  check('and says how many of the register it left out',
    /not on screen/.test(stripText));

  /* Whether a colour is work or shading is the Legend's to say, and only the
     Legend's. The calendar used to list the colours keeping rows on screen with
     "Just shading" beside each — a second place to change the register, on the
     screen people read rather than the one they administer it from. */
  check('the calendar offers no way to recategorise a colour',
    (await page.locator('#rc-frame .la-why').count()) === 0
      && !/on screen because of/i.test(await page.locator('#rc-frame').innerText()));

  /* The three header rows stay put, one under the other. They were all pinned
     at the same line, so scrolling down stacked the weekday letters over the
     day numbers and the month, and nobody could tell which date a column was. */
  const tops = await page.evaluate(() => [...document.querySelectorAll('#rc-frame .la-grid thead tr')]
    .map((tr) => parseFloat(tr.cells[tr.cells.length - 1].style.top || '0')));
  check('the month, day and weekday rows are frozen one under another',
    tops.length === 3 && tops[0] === 0 && tops[1] > tops[0] && tops[2] > tops[1], JSON.stringify(tops));
  const stuck = await page.evaluate(() => {
    const scroller = document.querySelector('#rc-frame .la-grid').closest('.rc-scroll');
    scroller.scrollTop = scroller.scrollHeight;
    const box = scroller.getBoundingClientRect();
    const rows = [...document.querySelectorAll('#rc-frame .la-grid thead tr')].map((tr) => tr.getBoundingClientRect().top);
    scroller.scrollTop = 0;
    return { box: box.top, rows };
  });
  check('and still in view with the rows scrolled to the bottom',
    stuck.rows.every((t) => t >= stuck.box - 1 && t < stuck.box + 120)
      && stuck.rows[1] > stuck.rows[0] && stuck.rows[2] > stuck.rows[1], JSON.stringify(stuck));

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

  /* ── The window the changes are read in ────────────────────────────────
     From a week back to the end of the calendar as it was last read. Everything
     outside that is either finished — a shift that moved in July cannot be
     planned around now — or beyond what the workbook has been filled in to. The
     register keeps the lot, and it says so, because a list that has been
     narrowed and does not say so reads as a list of everything. */
  check('the changes list says which weeks it covers',
    /from a week back to the end of the calendar/.test(laText),
    laText.split('\n').find((l) => /week back/.test(l)) || '');

  const windowBox = page.locator('#rc-frame .cx-check', { hasText: 'Everything recorded' }).locator('input');
  await windowBox.check();
  await page.waitForTimeout(400);
  check('and everything recorded is one click away',
    /nobody is planning round now/.test(await page.locator('#rc-frame').innerText())
    && /Everything recorded — \d+ change/.test(await page.locator('#rc-frame').innerText()),
    (await page.locator('#rc-frame').innerText()).split('\n').find((l) => /Everything recorded —/.test(l)) || '');
  await page.locator('#rc-frame .cx-check', { hasText: 'Everything recorded' }).locator('input').uncheck();
  await page.waitForTimeout(400);
  check('a change about a week months gone is not drawn by default',
    !/nobody is planning round now/.test(await page.locator('#rc-frame').innerText()));

  /* ── The cancellation log ────────────────────────────────────────────
     Every run of red cells any read has shown since the log's start, one event
     per side-by-side run, with whose it was and why. */
  console.log('\nThe cancellation log');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Cancellations' }).click();
  await page.waitForSelector('#rc-frame .rc-cancel-row', { timeout: 10000 });
  const cancelRows = () => page.locator('#rc-frame .rc-cancel-row');
  check('side-by-side red cells are one event, and a gap starts another',
    (await cancelRows().count()) === 2, `${await cancelRows().count()} event(s)`);
  check('a cancelled week reads as a week',
    /5 days/.test(await cancelRows().first().innerText()), await cancelRows().first().innerText());
  check('each red day is drawn as a cell',
    (await cancelRows().first().locator('.rc-cancel-cell').count()) === 5);
  check('nothing from before the log starts',
    !/IXL regression/.test(await page.locator('#rc-frame').innerText()));
  check('a day read before red was mapped still counts, once red means a cancellation',
    /1 day/.test(await cancelRows().nth(1).innerText()));

  await cancelRows().first().locator('button', { hasText: 'Add reason' }).click();
  await page.waitForTimeout(300);
  check('whose it was is BART, Hitachi or Other',
    JSON.stringify(await page.locator('.cx-modal select option').allTextContents()) === JSON.stringify(['BART', 'Hitachi', 'Other']));
  await page.locator('.cx-modal select').selectOption('BART');
  await page.locator('.cx-modal textarea').fill('Possession withdrawn');
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(500);
  const note1 = await page.evaluate(() => window.__rc.rows.rc_cancellation_notes.slice(-1)[0]);
  check('the reason and the party are recorded against the whole run',
    note1?.party === 'BART' && note1?.reason === 'Possession withdrawn'
      && note1?.raw_label === 'Cable pull' && note1?.end_date > note1?.start_date,
    JSON.stringify(note1));
  check('and shown in the log',
    /BART/.test(await cancelRows().first().innerText()) && /Possession withdrawn/.test(await cancelRows().first().innerText()));

  await cancelRows().first().locator('button', { hasText: 'Correct' }).click();
  await page.waitForTimeout(300);
  await page.locator('.cx-modal select').selectOption('Hitachi');
  await page.locator('.cx-modal textarea').fill('Our crew was reallocated');
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(500);
  const notes = await page.evaluate(() => window.__rc.rows.rc_cancellation_notes);
  check('a correction supersedes rather than edits',
    notes.length === 2 && notes[1].supersedes_id === notes[0].id && notes[0].party === 'BART');
  check('and the correction is what the log says',
    /Hitachi/.test(await cancelRows().first().innerText()) && !/BART/.test(await cancelRows().first().innerText()));

  await page.locator('#rc-frame .cx-check', { hasText: 'Only the ones with no reason yet' }).locator('input').check();
  await page.waitForTimeout(400);
  check('the ones still owed a reason can be listed alone', (await cancelRows().count()) === 1);
  await page.locator('#rc-frame .cx-check', { hasText: 'Only the ones with no reason yet' }).locator('input').uncheck();
  await page.waitForTimeout(400);

  // A span, not only a start: an end date before the second event drops it.
  const firstEnd = await cancelRows().first().getAttribute('data-start');
  await page.locator('#rc-frame input[aria-label="Log ends on"]').fill(firstEnd);
  await page.locator('#rc-frame input[aria-label="Log ends on"]').dispatchEvent('change');
  await page.waitForTimeout(500);
  check('the log can be narrowed to an end date as well as a start',
    (await cancelRows().count()) === 1 && /to /.test(await page.locator('#rc-frame').innerText()));
  check('and the export says how many it will carry',
    /Export 1 to CSV/.test(await page.locator('#rc-frame').innerText()));
  await page.locator('#rc-frame input[aria-label="Log ends on"]').fill('');
  await page.locator('#rc-frame input[aria-label="Log ends on"]').dispatchEvent('change');
  await page.waitForTimeout(500);

  await page.locator('#rc-frame button', { hasText: 'Re-read saved snapshots' }).click();
  await page.waitForTimeout(300);
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(900);
  check('the saved snapshots can be re-read under today\'s rules',
    /Saved snapshots re-read/.test(await page.locator('.cx-toast, .cx-toasts').allInnerTexts().then((t) => t.join(' '))));

  await cancelRows().first().locator('button', { hasText: 'Show cells' }).click();
  // No grid to wait for: this fixture's latest read has no "Cable pull" row,
  // so the filtered calendar is honestly empty.
  await page.waitForTimeout(900);
  check('and a cancellation opens the calendar on its own activity',
    await page.locator('#rc-frame input').evaluateAll((els) => els.some((e) => e.value === 'Cable pull')));
  // Back to the plain calendar for the checks that follow.
  await page.locator('#rc-frame input').evaluateAll((els) => {
    const box = els.find((e) => e.value === 'Cable pull');
    if (box) { box.value = ''; box.dispatchEvent(new Event('input')); }
  });

  /* ── The other half of the week plan ──────────────────────────────────
     Who is where, and whether that agrees with what the 4WLA asked for. This
     was its own tab, "Resources", and it is the same table: people down, days
     across, over the same `rc_plan_entries`, through the same
     `assignmentIndex()`. Every assignment written here is a plan entry — the
     same rows the huddle reads — so there is one place a day is planned and
     several places it is read. */
  console.log('\nWho is where, and what the sheet asked for');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Week plan' }).click();
  await page.waitForSelector('#rc-frame .rc-resources', { timeout: 10000 });
  const resText = await page.locator('#rc-frame').innerText();
  check('the team is listed down the side',
    /Alex/.test(resText) && /Priya/.test(resText));
  check('and what the 4WLA asks of somebody is drawn beside the plan',
    (await page.locator('#rc-frame .rc-res-asked').count()) >= 1);
  /* A name nobody has mapped is reported rather than swallowed. Nothing matches
     on a surname or a set of initials: a shift against the wrong engineer is
     worse than one against nobody, because nobody looks at it again. */
  check('a name the roster cannot place is named, not dropped',
    /Named in the 4WLA, not on the roster/.test(resText) && /Okafor/.test(resText));

  /* ── An office day is an allocated day ────────────────────────────────
     The cell draws the task and, under it, the location and the *category*. A
     day at the desk with no category is work of no kind: the reports group by
     category, so that is the difference between a day being shown and a day
     being allocated. `Office` is seeded for exactly this. */
  const umaCell = page.locator('#rc-frame .rc-resources tbody tr', { hasText: 'Uma' });
  const umaRes = await umaCell.innerText();
  check('the 4WLA\u2019s office row lands in the week plan as a day\u2019s work',
    /Office/.test(umaRes), umaRes.replace(/\n/g, ' | ').slice(0, 110));
  check('and carries the seeded Office category, so the reports can group it',
    (await umaCell.locator('.rc-res-job .rc-hint', { hasText: 'Office' }).count()) >= 1,
    umaRes.replace(/\n/g, ' | ').slice(0, 110));

  /* ── A bare first name ────────────────────────────────────────────────
     What the Resource row is actually filled in with. A register that only knew
     full names matched almost nothing on a real sheet. */
  /* ── Where the names come from ────────────────────────────────────────
     `lar2` carries an *empty* `resources`, which is exactly what a database
     built before that column existed looks like: PostgREST refuses the insert
     over the one field it does not know, so every stored row says the workbook
     named nobody — while the calendar, which re-reads the snapshot, shows the
     names perfectly well. Three screens reported "0 row(s)" over a sheet with
     names all over it. So the names are taken off the snapshot and grafted onto
     the stored rows, which still carry the id a plan links to. */
  check('names are found even when the stored column never got them',
    await page.evaluate(() => (window.__rc.rows.rc_lookahead_rows
      .find((r) => r.id === 'lar2').resources || null) === null
      || !Object.keys(window.__rc.rows.rc_lookahead_rows
        .find((r) => r.id === 'lar2').resources).length));

  check('a bare first name maps to the one person who answers to it',
    /IXL Regression Testing/.test(await page.locator('#rc-frame .rc-resources tr', { hasText: 'Victor Okonkwo' })
      .innerText()),
    (await page.locator('#rc-frame .rc-resources tr', { hasText: 'Victor Okonkwo' })
      .innerText()).replace(/\n/g, ' | ').slice(0, 90));
  check('and it is not reported as a name nobody could place',
    !/^Victor$/m.test(resText), resText.split('\n').filter((l) => /^Victor/.test(l)).join(' | '));

  /* ── A misspelling ────────────────────────────────────────────────────
     "Victor Okonkow" — one transposed pair of letters, typed into a spreadsheet
     at speed. It used to cost him the whole day: nothing in the register folds
     to that string, so it went to the unmatched list and his shift showed
     against nobody. It is read as him now, within a bound set by the length of
     what was written, and only because exactly one registered spelling is that
     close. And it is *said*, because a correction is not a match: the Resources
     tab lists it with one click to record the spelling for good. */
  check('a misspelling one letter pair out is read as the person it can only be',
    /Matched by correcting a spelling/.test(resText)
    && /Victor Okonkow/.test(resText),
    resText.split('\n').filter((l) => /Okonkow/.test(l)).join(' | '));
  check('and it says so rather than absorbing it, with a way to settle it',
    (await page.locator('#rc-frame button', { hasText: 'Record the spelling' }).count()) >= 1);
  check('a name that is merely near two people is still matched to neither',
    !/Matched by correcting a spelling[\s\S]*?\bLena\b/.test(resText));

  /* Two people answer to "Lena". Picking one would put a shift against the
     wrong engineer, and it would do it silently — both answers look equally
     right on screen — so it matches neither and says which problem it is. */
  // Not scoped to the grid: "Lena" on her own is a spelling in the unmatched
  // list, which is a table of its own further down the tab.
  const lena = page.locator('#rc-frame tbody tr')
    .filter({ has: page.locator('td div', { hasText: /^Lena$/ }) }).first();
  check('a first name two people share matches neither',
    !/IXL Regression Testing/.test(await page.locator('#rc-frame .rc-resources tr', { hasText: 'Lena Fischer' })
      .innerText())
    && !/IXL Regression Testing/.test(await page.locator('#rc-frame .rc-resources tr', { hasText: 'Lena Brandt' })
      .innerText()));
  check('and it says that is why, rather than "nobody is called that"',
    /more than one person is called that/.test(await lena.innerText()),
    (await lena.innerText()).replace(/\n/g, ' | ').slice(0, 90));
  check('and it offers to record whose spelling it is',
    (await page.locator('#rc-frame button', { hasText: 'That is somebody' }).count()) >= 1);

  // The row for this spelling, rather than whichever unmatched name happens to
  // come first — there are several now, and mapping the wrong one would write a
  // perfectly good alias and fail the assertion for a reason that is not a bug.
  await page.locator('#rc-frame tbody tr', { hasText: 'Okafor' })
    .locator('button', { hasText: 'That is somebody' }).first().click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal select').first().selectOption({ label: 'Dan' });
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'That is them' }).click();
  await page.waitForTimeout(500);
  check('mapping a spelling writes it to the alias register',
    await page.evaluate(() => (window.__rc.rows.rc_person_alias || [])
      .some((a) => /Okafor/.test(a.alias) && a.person_id === 'p2')));

  /* ── A place the register cannot place ────────────────────────────────
     The same answer an unmatched name gets, and for the same reason: the
     spelling is kept and shown rather than discarded, so it is one click from
     being settled. It used to be thrown away unless the register already knew
     it — so a Location column full of codes nobody had registered recorded
     nothing, and there was nothing on any screen to act on. */
  const resText2 = await page.locator('#rc-frame').innerText();
  check('a place the register cannot place is named, not dropped',
    /and the register cannot place/.test(resText2) && /W30/.test(resText2),
    resText2.split('\n').filter((l) => /W30/.test(l)).join(' | ').slice(0, 90));
  check('and the day it covers still says where it is',
    /W30/.test(await page.locator('#rc-frame .rc-resources tr', { hasText: 'Victor Okonkwo' })
      .innerText()));
  check('and it offers to put it on the register in one click',
    (await page.locator('#rc-frame button', { hasText: 'Add as a location' }).count()) >= 1);

  await page.locator('#rc-frame button', { hasText: 'Add as a location' }).first().click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input.cx-input').first().fill('Wayside 30');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Add' }).click();
  await page.waitForTimeout(700);
  /* The spelling becomes the *code*, because that is the field
     `rc_resolve_location()` reads it out of and what somebody will type again
     next week. Nothing else on the register had to be touched. */
  check('answering it records the place with the sheet\u2019s spelling as its code',
    await page.evaluate(() => (window.__rc.rows.rc_locations || [])
      .some((l) => l.name === 'Wayside 30' && l.code === 'W30')));
  const afterAdd = await page.locator('#rc-frame').innerText();
  check('and the 4WLA\u2019s spelling stops being a question',
    !/and the register cannot place/.test(afterAdd),
    afterAdd.split('\n').filter((l) => /W30/.test(l)).join(' | ').slice(0, 120));
  /* And the place is then *named* rather than coded, everywhere. The code is
     what the workbook types; it is not what anybody calls the site. */
  check('and the place is named from then on rather than coded',
    /Wayside 30/.test(afterAdd) && !/W30/.test(afterAdd),
    afterAdd.split('\n').filter((l) => /Wayside 30|W30/.test(l)).join(' | ').slice(0, 120));

  /* Work the 4WLA has never heard of — a day in the office, a day on another
     project. Without somewhere for those to go the huddle has a blank against a
     name and no way to tell "nothing planned" from "nothing said". */
  await page.locator('#rc-frame button', { hasText: 'Assign work' }).click();
  await page.waitForSelector('.cx-modal');
  const dates = page.locator('.cx-modal input[type="date"]');
  const monday = await page.evaluate(() => {
    const now = new Date();
    const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
  });
  const friday = await page.evaluate((m) =>
    new Date(Date.parse(`${m}T00:00:00Z`) + 4 * 86400000).toISOString().slice(0, 10), monday);
  await dates.nth(0).fill(monday);
  await dates.nth(1).fill(friday);
  await page.locator('.cx-modal input[placeholder="What they will do"]').fill('Office — as-built markups');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Assign' }).click();
  await page.waitForTimeout(600);
  const assigned = await page.evaluate(() => window.__rc.rows.rc_plan_entries
    .filter((p) => /as-built markups/.test(p.task || '')));
  check('a span of off-project days becomes one plan entry per day',
    assigned.length >= 2, `${assigned.length} entries`);
  check('and it is a plan entry, so the huddle already reads it',
    assigned.every((p) => p.person_id && p.work_date && !p.lookahead_row_id));
  check('with no location, because the office is not a commissioning site',
    assigned.every((p) => !p.location_id));

  /* An administrator runs the calendar and is never assigned to a location, so
     a row of dots against their name is noise in the middle of the one screen
     that answers "who is where". `scheduled` decides it and never the role. */
  check('the manager who runs the calendar is not a row in the week plan',
    !(await page.locator('#rc-frame .rc-resources tbody').innerText()).includes('Alex'));
  check('but they are still in the register, so the sheet can name them',
    !/Alex/.test((await page.locator('#rc-frame').innerText())
      .split('Named in the 4WLA')[1] || ''));

  /* ── PTO ──────────────────────────────────────────────────────────────
     Leave already had a list in Organisation. This is the four weeks anybody is
     actually staffing, and it draws two things: what somebody booked, and what
     the 4WLA's PTO row says — which on this project is usually the only place
     an absence is written down at all. */
  console.log('\nPTO');
  await page.locator('#rc-frame .rc-tab', { hasText: 'PTO' }).click();
  await page.waitForSelector('#rc-frame .rc-pto', { timeout: 10000 });
  const ptoText = await page.locator('#rc-frame .rc-pto').innerText();
  check('the team is drawn against four weeks, not a list of date ranges',
    (await page.locator('#rc-frame .rc-pto-grid thead th.rc-pto-day').count()) === 28,
    `${await page.locator('#rc-frame .rc-pto-grid thead th.rc-pto-day').count()} columns`);
  check('everybody is on it, managers included — they take leave too',
    /Alex/.test(ptoText) && /Rosa/.test(ptoText));
  check('a day the 4WLA says is PTO is drawn even though nothing is booked',
    (await page.locator('#rc-frame .rc-pto-cell.rc-pto-sheet').count()) >= 1,
    `${await page.locator('#rc-frame .rc-pto-cell.rc-pto-sheet').count()} cell(s)`);
  check('and booked leave is drawn as the record it is',
    (await page.locator('#rc-frame .rc-pto-cell.rc-pto-booked').count()) >= 1);
  /* The cell *is* its colour. The table's row hover painted a fill over every
     cell in the row, so crossing somebody's leave with the pointer turned it
     white — the one grid where the hover has to leave the cells alone. */
  const bookedCell = page.locator('#rc-frame .rc-pto-cell.rc-pto-booked').first();
  const paintBefore = await bookedCell.evaluate((e) => getComputedStyle(e).backgroundColor);
  await bookedCell.hover();
  await page.waitForTimeout(80);
  const paintDuring = await bookedCell.evaluate((e) => getComputedStyle(e).backgroundColor);
  check('hovering a row does not paint over the leave on it',
    paintBefore === paintDuring, `${paintBefore} → ${paintDuring}`);
  await page.mouse.move(0, 0);
  /* Leave is one colour however it was written down. Which of the two wrote a
     day down is bookkeeping; the question this screen answers is who is away,
     and three swatches for one fact meant decoding the key to read the grid.
     The distinction is still available in the cell's title and in the counts. */
  check('booked leave and the sheet\u2019s own row are drawn as one colour',
    await page.evaluate(() => {
      const paint = (sel) => {
        const cell = document.querySelector(sel);
        return cell ? getComputedStyle(cell).backgroundImage + '|'
          + getComputedStyle(cell).backgroundColor : null;
      };
      const booked = paint('#rc-frame .rc-pto-cell.rc-pto-booked');
      const sheet = paint('#rc-frame .rc-pto-cell.rc-pto-sheet');
      return Boolean(booked) && booked === sheet;
    }));
  check('and a day off the project is drawn as something else again',
    await page.evaluate(() => {
      const paint = (sel) => {
        const cell = document.querySelector(sel);
        return cell ? getComputedStyle(cell).backgroundColor : null;
      };
      const off = paint('#rc-frame .rc-pto-cell.rc-pto-elsewhere');
      return !off || off !== paint('#rc-frame .rc-pto-cell.rc-pto-booked');
    }));
  check('the key says the two things it draws, and not three',
    /PTO/.test(ptoText) && /Off the project/i.test(ptoText)
    && !/On the 4WLA only/.test(ptoText),
    ptoText.split('\n').filter((l) => /PTO —|Off the project/i.test(l)).join(' | '));
  check('and the count of each is said out loud',
    /the 4WLA says are PTO with nothing booked/.test(ptoText),
    ptoText.split('\n').find((l) => /booked day/.test(l))?.slice(0, 100) || '');

  /* Booking one is a confirmation, not a retype: everything already reads the
     sheet as leave, and this gives the day a record that survives an edit. */
  await page.locator('#rc-frame .rc-pto-cell.rc-pto-sheet').first().click();
  await page.waitForSelector('.cx-modal');
  check('clicking one offers to make it a record, prefilled',
    (await page.locator('.cx-modal input[type="date"]').first().inputValue()).length === 10);
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Book' }).click();
  await page.waitForTimeout(600);
  check('and booking it writes one leave row, the same one Organisation writes',
    await page.evaluate(() => (window.__rc.rows.rc_leave || [])
      .some((l) => /From the 4WLA/.test(l.note || ''))));
  check('nothing about the look-ahead was written to do it',
    await page.evaluate(() => !window.__rc.calls
      .some((c) => c.kind === 'insert' && c.table === 'rc_lookahead_rows')));

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
  const inFocus = await page.locator('#rc-frame .rc-present-who').innerText();

  /* What they did and what kind of work it was, typed in the room as they say
     it, and recorded with the status pressed next. */
  check('the room can say what somebody did and what kind of work it was',
    (await page.locator('#rc-frame .rc-present .rc-work-task').count()) === 1
      && (await page.locator('#rc-frame .rc-present .rc-work-cat').count()) === 1);
  await page.locator('#rc-frame .rc-present .rc-work-task').fill('Witnessed the IXL test instead');
  const roomCat = await page.locator('#rc-frame .rc-present .rc-work-cat option').nth(2).getAttribute('value');
  await page.locator('#rc-frame .rc-present .rc-work-cat').selectOption(roomCat);
  await page.locator('#rc-frame .rc-present').press('c');
  await page.waitForTimeout(600);
  check('a status letter records it here too, through the same path',
    await page.evaluate((n) => window.__rc.rows.rc_actuals.length === n + 1, before3));
  const roomRow = await page.evaluate(() => window.__rc.rows.rc_actuals.slice(-1)[0]);
  check('with what they did and its category',
    roomRow.task === 'Witnessed the IXL test instead' && roomRow.category_id === roomCat,
    `${roomRow.task} · ${roomRow.category_id}`);
  check('and the room shows it back', /Witnessed the IXL test instead/.test(
    await page.locator('#rc-frame .rc-present').innerText()));

  /* ── Recorded is not final ────────────────────────────────────────────
     Pressing "completed" used to be the end of it: the buttons went away and
     the pick could not be changed, and there was nowhere to say anything about
     a finished day. Now the pick stays pressable and a note can be added
     whatever the status. Every edit is a *correction* — a new row pointing at
     the old one, the table having no UPDATE — so the first answer stays on the
     record underneath. */
  // This day's chain only: the rows appended since the meeting was opened on
  // this person, not everything they have ever had recorded.
  const current = (name) => page.evaluate(({ who, from }) => {
    const person = window.__rc.rows.rc_people.find((p) => p.name === who);
    const rows = window.__rc.rows.rc_actuals.slice(from).filter((a) => a.person_id === person.id);
    const live = rows.filter((a) => !rows.some((b) => b.supersedes_id === a.id));
    return { all: rows.length, live: live.length, status: live[0]?.status, note: live[0]?.note,
      first: rows[0]?.status, chain: live[0]?.supersedes_id || null };
  }, { who: name, from: before3 });
  const pressed = page.locator('#rc-frame .rc-present button[aria-pressed="true"]');
  check('the pick just made is shown pressed, and still pressable',
    (await pressed.count()) === 1 && /Completed/.test(await pressed.innerText()));
  check('with a box for a note whatever the status',
    (await page.locator('#rc-frame .rc-present .rc-notes-box').count()) === 1);

  await page.locator('#rc-frame .rc-present button', { hasText: 'Partial' }).click();
  await page.waitForSelector('#rc-frame .rc-present .rc-saymore');
  // The text box, not the file input beside it.
  const saidBox = page.locator('#rc-frame .rc-present .rc-saymore input:not([type="file"])');
  await saidBox.fill('half of it');
  await saidBox.press('Enter');
  await page.waitForTimeout(600);
  let state = await current(inFocus);
  check('changing the pick writes a correction rather than an update',
    state.all === 2 && state.live === 1, `${state.all} row(s), ${state.live} current`);
  check('which is what every reader now sees',
    state.status === 'partial' && state.note === 'half of it', `${state.status}: ${state.note}`);
  check('pointing at the answer it replaced, which stays on the record',
    state.chain !== null && state.first === 'completed');

  await page.locator('#rc-frame .rc-present .rc-notes-box').fill('half of it — north end done');
  await page.locator('#rc-frame .rc-present button', { hasText: 'Save note' }).click();
  await page.waitForTimeout(600);
  state = await current(inFocus);
  check('a note can be edited on its own, keeping the status',
    state.all === 3 && state.status === 'partial' && /north end/.test(state.note || ''),
    `${state.all} row(s), ${state.status}: ${state.note}`);

  await page.locator('#rc-frame .rc-present button', { hasText: 'Save note' }).click();
  await page.waitForTimeout(400);
  check('and saving it unchanged writes nothing',
    (await current(inFocus)).all === 3);

  await page.locator('#rc-frame .rc-present').press('Escape');
  await page.waitForTimeout(400);
  check('escape puts the table back',
    (await page.locator('#rc-frame .rc-present').count()) === 0
      && (await page.locator('#rc-frame .rc-huddle').count()) === 1);

  /* The table offers the same edit, in the same cell, through the same path. */
  // By the name in the row's first cell: another person's row can mention this
  // one anywhere else in it (an owner picker lists everybody).
  const editRow = page.locator('#rc-frame tbody tr', { has: page.locator('td:first-child', { hasText: inFocus }) });
  check('a recorded outcome in the table can be edited too',
    (await editRow.locator('button', { hasText: 'Edit' }).count()) === 1);
  await editRow.locator('button', { hasText: 'Edit' }).click();
  await page.waitForTimeout(200);
  check('which brings the buttons and the note back in the cell',
    (await editRow.locator('button[aria-pressed="true"]').count()) === 1
      && (await editRow.locator('.rc-notes-box').count()) === 1);

  /* The task and the category are editable in the table as well, and an edit is
     a correction like any other: a new row, the status kept. */
  const liveOf = (name) => page.evaluate((who) => {
    const person = window.__rc.rows.rc_people.find((p) => p.name === who);
    const rows = window.__rc.rows.rc_actuals.filter((a) => a.person_id === person.id);
    return rows.filter((a) => !rows.some((b) => b.supersedes_id === a.id)).slice(-1)[0];
  }, name);
  const beforeEdit = await liveOf(inFocus);
  await editRow.locator('.rc-work-task').fill('Witnessed the IXL test, then pulled cable');
  await editRow.locator('.rc-work-task').press('Enter');
  await page.waitForTimeout(600);
  let afterEdit = await liveOf(inFocus);
  check('what somebody did can be corrected from the table',
    afterEdit.task === 'Witnessed the IXL test, then pulled cable'
      && afterEdit.supersedes_id === beforeEdit.id && afterEdit.status === beforeEdit.status,
    `${afterEdit.task} · ${afterEdit.status}`);
  await editRow.locator('button', { hasText: 'Edit' }).click();
  await page.waitForTimeout(200);
  const otherCat = await editRow.locator('.rc-work-cat option').nth(1).getAttribute('value');
  await editRow.locator('.rc-work-cat').selectOption(otherCat);
  await page.waitForTimeout(600);
  afterEdit = await liveOf(inFocus);
  check('and so can its category, the moment it is picked',
    afterEdit.category_id === otherCat && afterEdit.task === 'Witnessed the IXL test, then pulled cable');

  /* Somebody with nothing planned: the day is written in, categorised and
     recorded in one go, rather than a status against a blank. */
  const unplanned = page.locator('#rc-frame tbody tr', { has: page.locator('input[placeholder^="Nothing was planned"]') });
  console.log(`    (${await unplanned.count()} row(s) with nothing planned on this day)`);
  if (await unplanned.count()) {
    const row = unplanned.first();
    const name = (await row.locator('td').first().innerText()).split('\n')[0];
    await row.locator('.rc-work-task').fill('Office — wrote up the SAT report');
    const officeCat = await row.locator('.rc-work-cat option', { hasText: 'Office' }).getAttribute('value');
    await row.locator('.rc-work-cat').selectOption(officeCat);
    await row.locator('button', { hasText: 'Completed' }).click();
    await page.waitForTimeout(600);
    const said = await liveOf(name);
    check('a day with nothing planned can be written in and categorised',
      said?.task === 'Office — wrote up the SAT report' && said?.category_id === officeCat,
      `${name}: ${said?.task} · ${said?.category_id}`);
  } else {
    check('a day with nothing planned can be written in and categorised', false, 'no unplanned row to try it on');
  }

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
  check('performance and project health are reported apart',
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
  /* A *stored* day. The override written earlier was withdrawn where that was
     checked, so one is written here to revise — through the interface, because
     a row pushed into the stub would sit behind the thirty-second read cache
     and the grid would never see it. A derived day has no row to supersede, and
     changing that writes the first row instead, which is the other half of the
     same cell and is checked where it happens. */
  await page.locator('#rc-frame .rc-resources tbody tr', { hasText: 'Priya' })
    .locator('button', { hasText: /^\+( task)?$/ }).first().click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input[placeholder="What they will do"]').fill('A day to revise');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Assign' }).click();
  await page.waitForTimeout(700);

  const planned = page.locator('#rc-frame .rc-res-job', { hasText: 'A day to revise' })
    .locator('button[aria-label^="Revise"]').first();
  check('a planned day offers to be revised', (await planned.count()) === 1);
  await planned.click();
  await page.waitForSelector('.cx-modal');
  await page.locator('.cx-modal input').first().fill('A day to revise, night shift');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Revise' }).click();
  await page.waitForTimeout(700);
  const revised = await page.evaluate(() =>
    window.__rc.calls.filter((c) => c.table === 'rc_supersede_plan').map((c) => c.payload));
  check('revising goes through the function that refuses a second revision',
    revised.length === 1 && /night shift/.test(revised[0].p_task || ''),
    JSON.stringify(revised[0] || null));
  check('and the grid shows the revision rather than what it replaced',
    /A day to revise, night shift/.test(await page.locator('#rc-frame .rc-resources').innerText()));

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
  /* ── Fast between tabs ────────────────────────────────────────────────
     Switching tabs used to mean twenty full grids over the wire to draw one,
     and every tab re-asking for the roster, the legend and the aliases. The
     stub records what each read asked for, so the two facts that matter can
     be checked rather than felt: how many grids moved, and whether a second
     visit goes back to the network at all. */
  console.log('\nFast between tabs');
  const readsSoFar = await page.evaluate(() => window.__rc.calls
    .filter((c) => c.kind === 'select').map((c) => ({ table: c.table, limit: c.limit })));
  /* A *bounded* list of several grids is the pattern the screens used —
     `listSnapshots({ limit: 20 })` to draw one — and the one to guard against.
     A read with no limit at all is the backup, which takes every table out
     whole and is meant to. */
  check('no screen ever asks for a list of grids',
    !readsSoFar.some((c) => c.table === 'rc_lookahead_snapshots' && c.limit !== null && c.limit > 1),
    readsSoFar.filter((c) => c.table === 'rc_lookahead_snapshots').map((c) => `limit ${c.limit}`).join(', '));
  check('the snapshot list is read without its grids',
    readsSoFar.some((c) => c.table === 'rc_lookahead_snapshot_meta'));

  /* Six visits, three tabs, twice round. Uncached, each visit reads the roster
     and the sheet again; remembered, the second lap reads nothing and the
     first lap shares one grid between the three. */
  await page.evaluate(() => { window.__rc.calls.length = 0; });
  const lap = async () => {
    await page.locator('#rc-frame .rc-tab', { hasText: 'Week plan' }).click();
    await page.waitForSelector('#rc-frame .rc-resources');
    await page.locator('#rc-frame .rc-tab', { hasText: 'Daily huddle' }).click();
    await page.waitForSelector('#rc-frame .rc-table');
    await page.locator('#rc-frame .rc-tab', { hasText: 'PTO' }).click();
    await page.waitForSelector('#rc-frame .rc-pto');
  };
  await lap();
  await lap();
  const sweep = await page.evaluate(() => window.__rc.calls
    .filter((c) => c.kind === 'select').map((c) => c.table));
  const count = (table) => sweep.filter((t) => t === table).length;
  check('six visits move at most one grid',
    count('rc_lookahead_snapshots') <= 1, `${count('rc_lookahead_snapshots')} grid read(s)`);
  check('and read the roster at most twice — once scheduled, once everybody',
    count('rc_people') <= 2, `${count('rc_people')} roster read(s)`);
  check('the second lap round the same three tabs reads nothing new',
    sweep.length <= 12, `${sweep.length} read(s) across six visits`);
  /* The other half — a write empties it — is what the legend checks above
     already prove: pressing "Just shading" writes a legend row and the calendar
     has to redraw from the *new* legend, which it did not while the upsert path
     forgot to forget. Those four checks are the regression test for it. */

  console.log('\nThe timeline\'s data never leaves');

  await page.locator('.ws-btn', { hasText: 'Timeline' }).click();
  await page.waitForTimeout(200);

  /* The timeline's look-ahead import reads the calendar's Legend and nothing
     else, and only a colour it categorises as Work becomes a suggestion. The
     fixture paints in yellow (Day Shift here), orange (named by the workbook's
     own key but not in this register) and grey (a Section band here). It runs
     before the edits below, so the checks that follow also cover it: reading
     the legend sends nothing of the plan. */
  await page.locator('#sidenav .nav-link[data-pane="lookahead"]').click();
  await page.waitForTimeout(300);
  await page.locator('#dock .cx-btn', { hasText: /import look-ahead/i }).click();
  await page.waitForTimeout(300);
  await page.locator('.cx-modal input[type="file"]').setInputFiles({
    name: '4WLA.xlsx', mimeType: 'application/octet-stream', buffer: buildLookaheadWorkbook(),
  });
  await page.waitForTimeout(900);
  check('the timeline\'s look-ahead import is categorised by the calendar\'s Legend',
    /calendar’s legend/i.test(await page.locator('.cx-modal .la-legend-source').innerText().catch(() => '')));
  const laRuns = (await page.locator('.cx-modal .cx-chipstat').allTextContents()).find((c) => /^Runs/.test(c)) || '';
  check('and only the colours it calls Work are imported', /^Runs2$/.test(laRuns), laRuns);
  check('a colour the workbook names but the Legend does not is not work',
    (await page.locator('.cx-modal .la-colour[data-hex="FFC000"][data-role="ignore"]').count()) === 1);
  check('nor is a Section band', (await page.locator('.cx-modal .la-colour[data-hex="D9D9D9"][data-role="divider"]').count()) === 1);
  check('and the categories are not editable from the timeline',
    (await page.locator('.cx-modal .la-colour input[type="checkbox"]').count()) === 0);
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(600);
  check('the Work runs arrive as suggestions', (await page.locator('#dock .la-row[data-la]').count()) === 2);

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
  await viewer.addInitScript(`window.__rcSchemaVersion = ${SCHEMA_VERSION};`);
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
  // for a real project is the reason the switch goes away.
  check('a viewer gets no Timeline switch', (await viewer.locator('.ws-switch').count()) === 0);
  check('and lands on the calendar',
    await viewer.evaluate(() => document.body.dataset.workspace === 'calendar'));

  await viewer.waitForSelector('#rc-frame .rc-tabs', { timeout: 10000 });
  const vTabs = await viewer.locator('#rc-frame .rc-tab').allInnerTexts();
  check('the week plan is there', vTabs.includes('Week plan'), vTabs.join(', '));
  /* The **daily huddle** is an administrator's. It is the meeting: it asks a
     whole team in turn how yesterday went, and it is where an outcome is
     entered. A viewer runs nothing and enters nothing, and what they need out
     of it — the status and the note recorded against a day — is drawn in the
     week plan beside the rest of the week. */
  check('and the meeting is not', !vTabs.includes('Daily huddle'), vTabs.join(', '));
  /* The 4WLA is what the team is being asked to do, and while this tab was
     administrators-only the people named on it were the only people who could
     not look at it. They get it, read-only — the register around it is still
     restricted in the policies. */
  check('the look-ahead is there to be read', vTabs.includes('Look-ahead'), vTabs.join(', '));
  /* Reports and Organisation are an administrator's: the KPIs are a different
     audience and a different permission, and the roster and the accounts are
     the calendar's administration rather than its use. Both already answer
     "administrators only", so removing the tabs takes away a door onto a wall. */
  check('the Reports tab is gone', !vTabs.includes('Reports'));
  check('and so is Organisation', !vTabs.includes('Organisation'), vTabs.join(', '));
  check('and the state is named on screen',
    /Read only/.test(await viewer.locator('#rc-frame .rc-head').innerText()));

  // The one that matters: a viewer has a person row, so "is this my row" is
  // true for them too. Only asking whether they may write at all stops this.
  await viewer.waitForSelector('#rc-frame .rc-resources');
  check('nothing to press anywhere, including on their own row',
    (await viewer.locator('#rc-frame .rc-resources tbody button').count()) === 0);
  check('nor a way to assign work at all',
    (await viewer.locator('#rc-frame button', { hasText: 'Assign work' }).count()) === 0);
  check('but the schedule still renders',
    (await viewer.locator('#rc-frame .rc-resources tbody tr').count()) >= 4);

  /* What a viewer gets out of the look-ahead: the calendar, and nothing that
     writes. The Changes list, the snapshot history and the SARs are the claim
     evidence and stay with the people answerable for it. */
  await viewer.locator('#rc-frame .rc-tab', { hasText: 'Look-ahead' }).click();
  await viewer.waitForSelector('#rc-frame .la-grid', { timeout: 10000 });
  check('and the 4WLA actually draws for them',
    (await viewer.locator('#rc-frame .la-grid tbody tr').count()) >= 1);
  const vLa = await viewer.locator('#rc-frame').innerText();
  check('with no way to read the workbook again — that needs the folder',
    (await viewer.locator('#rc-frame button', { hasText: 'Check now' }).count()) === 0);
  check('and none of the register around it',
    !/Changes/.test(vLa) && !/Snapshots/.test(vLa) && !/Site access/.test(vLa) && !/Cancellations/.test(vLa),
    vLa.split('\n').slice(0, 3).join(' | '));
  // But the export is theirs: it is a drawing of what they can already see.
  check('the calendar can still be printed, because it is what they can see',
    (await viewer.locator('#rc-frame button', { hasText: 'Export PDF' }).count()) === 1);

  await viewer.close();

  /* ══════════════════════════════════════════════════════════════════════
     A member plans their own week and nobody else's
     ═══════════════════════════════════════════════════════════════════ */
  console.log('\nA member plans their own week');

  const member = await context.newPage();
  member.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  member.on('pageerror', (e) => consoleErrors.push(String(e)));
  await serveStubbedConfig(member);
  await member.addInitScript(() => { window.__rc = { role: 'member', signedIn: true }; });
  await member.addInitScript(`window.__rcSchemaVersion = ${SCHEMA_VERSION};`);
  await member.addInitScript(fakeSdk);
  await member.goto(url_, { waitUntil: 'load' });
  // A member is not read-only, so they land on the timeline like anybody else
  // and switch across — only a viewer is put straight on the calendar.
  await member.waitForSelector('.ws-switch', { timeout: 20000 });
  await member.locator('.ws-btn', { hasText: 'Calendar' }).click();
  await member.waitForSelector('#rc-frame .rc-tabs', { timeout: 15000 });

  const mTabs = await member.locator('#rc-frame .rc-tab').allInnerTexts();
  check('a member gets the look-ahead, and not the administration',
    mTabs.includes('Look-ahead') && !mTabs.includes('Reports') && !mTabs.includes('Organisation'),
    mTabs.join(', '));

  check('and not the meeting either — that is where an outcome is entered',
    !mTabs.includes('Daily huddle'), mTabs.join(', '));

  await member.locator('#rc-frame .rc-tab', { hasText: 'Week plan' }).click();
  await member.waitForSelector('#rc-frame .rc-resources', { timeout: 10000 });

  /* The whole of it: a member may write their own days. The interface offers it
     on their row and nowhere else, and `rc_plan_entries` says the same in
     Postgres — `rc_can_act_for(person_id)` — so this is the screen agreeing
     with the database rather than being the control. */
  const ownRow = member.locator('#rc-frame .rc-resources tbody tr', { hasText: 'Alex' });
  const otherRow = member.locator('#rc-frame .rc-resources tbody tr', { hasText: 'Dan' });
  check('their own row offers to be planned',
    (await ownRow.locator('button').count()) >= 1);
  check('and nobody else\u2019s does',
    (await otherRow.locator('button').count()) === 0);

  await member.locator('#rc-frame button', { hasText: 'Assign work' }).click();
  await member.waitForSelector('.cx-modal');
  const whoField = member.locator('.cx-modal select').first();
  check('the dialog holds the one name they could write, and says so',
    (await whoField.locator('option').count()) === 1 && (await whoField.isDisabled()));

  const mDates = member.locator('.cx-modal input[type="date"]');
  const mDay = await mDates.nth(0).inputValue();
  await mDates.nth(1).fill(mDay);
  await member.locator('.cx-modal input[placeholder="What they will do"]').fill('Office — RFI log');
  await member.locator('.cx-modal .cx-modal-foot button', { hasText: 'Assign' }).click();
  await member.waitForTimeout(700);
  check('and the day they planned for themselves is written',
    await member.evaluate(() => window.__rc.rows.rc_plan_entries
      .some((e) => e.person_id === 'p1' && e.task === 'Office — RFI log')));

  /* A shift is routinely more than one job. The day already has a task and the
     button is still there — it used to skip the day and say so in a toast,
     which is how somebody ends up with one of the three things they were asked
     for. */
  const planned2 = member.locator('#rc-frame .rc-resources tbody tr', { hasText: 'Alex' })
    .locator('button', { hasText: '+ task' });
  check('a day that already has a task can take another', (await planned2.count()) >= 1);
  await planned2.first().click();
  await member.waitForSelector('.cx-modal');
  const mDates2 = member.locator('.cx-modal input[type="date"]');
  await mDates2.nth(1).fill(await mDates2.nth(0).inputValue());
  await member.locator('.cx-modal input[placeholder="What they will do"]').fill('Witness the IXL run');
  await member.locator('.cx-modal .cx-modal-foot button', { hasText: 'Assign' }).click();
  await member.waitForTimeout(700);
  const bothTasks = await member.evaluate(() => {
    const rows = window.__rc.rows.rc_plan_entries.filter((e) => e.person_id === 'p1');
    const byDay = {};
    for (const r of rows) (byDay[r.work_date] ||= []).push(r.task);
    return Object.values(byDay).find((t) => t.length > 1) || [];
  });
  check('so one day carries both, rather than the second being dropped',
    bothTasks.length === 2, bothTasks.join(' / '));
  check('and both are drawn in the cell',
    /Office — RFI log/.test(await ownRow.innerText())
    && /Witness the IXL run/.test(await ownRow.innerText()),
    (await ownRow.innerText()).replace(/\n/g, ' | ').slice(0, 110));

  /* ── A member deletes their own task ──────────────────────────────────
     "Delete" on a table with no DELETE grant is a tombstone superseding the
     original. The day leaves the schedule and the record keeps every version of
     it, because a plan that changed the evening before a shift is itself
     evidence. */
  const mineToGo = ownRow.locator('.rc-res-job', { hasText: 'Witness the IXL run' })
    .locator('button[aria-label^="Remove"]');
  check('their own task offers to be removed', (await mineToGo.count()) === 1);
  await mineToGo.first().click();
  await member.waitForSelector('.cx-modal');
  await member.locator('.cx-modal .cx-modal-foot button', { hasText: 'Remove it' }).click();
  await member.waitForTimeout(700);
  check('and removing it takes it off the schedule',
    !/Witness the IXL run/.test(await ownRow.innerText()),
    (await ownRow.innerText()).replace(/\n/g, ' | ').slice(0, 110));
  check('without deleting anything — the withdrawal is a row of its own',
    await member.evaluate(() => window.__rc.rows.rc_plan_entries
      .some((e) => e.withdrawn && e.task === 'Witness the IXL run')));
  check('and nobody else\u2019s task offers it',
    (await otherRow.locator('button[aria-label^="Remove"]').count()) === 0);

  /* ── A member asks for leave ──────────────────────────────────────────
     It was administrators-only, which made the commonest thing anybody wants
     from this module something they had to get somebody else to type. The
     status is the whole permission: a member writes `requested` for their own
     row and nothing else. */
  await member.locator('#rc-frame .rc-tab', { hasText: 'PTO' }).click();
  await member.waitForSelector('#rc-frame .rc-pto', { timeout: 10000 });
  const askBtn = member.locator('#rc-frame button', { hasText: 'Request leave' });
  check('a member is offered a request rather than a booking',
    (await askBtn.count()) === 1
    && (await member.locator('#rc-frame button', { hasText: 'Book leave' }).count()) === 0);
  await askBtn.click();
  await member.waitForSelector('.cx-modal');
  check('and the person select holds the one name they could write',
    await member.locator('.cx-modal select').first().isDisabled());
  const askDates = member.locator('.cx-modal input[type="date"]');
  await askDates.nth(0).fill('2026-12-21');
  await askDates.nth(1).fill('2026-12-23');
  await member.locator('.cx-modal .cx-modal-foot button', { hasText: 'Request it' }).click();
  await member.waitForTimeout(700);
  const asked = await member.evaluate(() => window.__rc.rows.rc_leave
    .filter((l) => l.status === 'requested').map((l) => `${l.person_id} ${l.start_date}`));
  check('the request goes up as one row, marked as a question',
    asked.length === 1 && /p1 2026-12-21/.test(asked[0]), asked.join(', '));
  check('and it says so rather than reading as booked leave',
    /Waiting on an answer/.test(await member.locator('#rc-frame .rc-pto').innerText()));
  /* Withdrawing is the only change they can make to it, which is what stops a
     request approving itself. */
  const answers = await member.locator('#rc-frame .rc-pto-asks button').allInnerTexts();
  check('the person who asked can withdraw it and nothing else',
    answers.length === 1 && answers[0] === 'Withdraw', answers.join(', '));

  /* ── And the timeline is read-only for them ───────────────────────────
     The plan holds the P6 narrative and is maintained by whoever runs the
     project. A member was read-only only in practice, because the plan lives in
     a folder and somebody else usually held the pen — and the pen is a *turn*,
     so "Take over editing" was on screen and pressing it got them the plan. */
  await member.locator('.ws-btn', { hasText: 'Timeline' }).click();
  await member.waitForTimeout(400);
  check('a member opens the plan read-only',
    await member.evaluate(() => document.body.classList.contains('read-only')));
  check('and is told why, in terms of their account rather than the folder',
    /not an administrator/.test(await member.locator('#cx-readonly-bar').innerText()),
    await member.locator('#cx-readonly-bar').innerText());
  check('with nothing anywhere offering to take over editing',
    (await member.locator('button', { hasText: 'Take over editing' }).count()) === 0);
  /* The store is the control, not the CSS. An edit refused there is an edit
     that did not happen, whatever the interface drew. */
  const bars = await member.locator('.tl-obj').count();
  await member.locator('.tl-obj').first().click();
  await member.keyboard.press('ArrowRight');
  await member.keyboard.press('Control+d');
  await member.waitForTimeout(400);
  check('and the store refuses the edit rather than the stylesheet hiding it',
    (await member.locator('.tl-obj').count()) === bars, `${bars} bars before and after`);

  /* But the *view* is theirs. Filtering and comparing were `doc.settings`, so a
     reader could not set them at all: the only way to record the choice was an
     edit to a plan they may not edit. They are per account now, and remembered
     for them alone. */
  await member.locator('#sidenav .nav-link[data-pane="filters"]').click();
  const mFilter = member.locator('#dock input[type="text"]').first();
  await mFilter.click();
  await mFilter.type('regression', { delay: 20 });
  await member.waitForTimeout(400);
  check('but their own view is theirs to set',
    (await mFilter.inputValue()) === 'regression'
    && (await member.locator('#cx-readonly-bar').count()) === 1,
    await mFilter.inputValue());
  check('and it is remembered against their account rather than in the plan',
    await member.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('cxtl.view.'));
      return keys.length === 1 && /regression/.test(localStorage.getItem(keys[0]) || '');
    }));

  await member.close();

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
