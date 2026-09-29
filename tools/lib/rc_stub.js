/**
 * The resource calendar's backend, in the page — shared by the suites that
 * drive the calendar: `smoke_calendar.js` (the desktop calendar) and
 * `smoke_mobile.js` (the phone app).
 *
 * It lived in `smoke_calendar.js` alone until there were two interfaces over one
 * backend. Two copies would drift — one modelling a policy the other forgot —
 * and the whole value of a stub is that it answers the way the database does,
 * so there is one, and both interfaces are tested against the same answers.
 *
 * `fakeSdk` is handed to `page.addInitScript()`, which sends its *source* to the
 * page; it must stay self-contained, with nothing captured from this module.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

/**
 * The calendar's schema version, as the application expects it — what the
 * stub's database reports unless a suite says otherwise. Set it in the page
 * before `fakeSdk`: `page.addInitScript(\`window.__rcSchemaVersion = ${SCHEMA_VERSION};\`)`.
 */
export const SCHEMA_VERSION = Number(fs.readFileSync(
  path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', 'src', 'core', 'rc.js'), 'utf8',
).match(/export const SCHEMA_VERSION = (\d+);/)[1]);

/**
 * A stand-in for `window.supabase`, installed before any page script runs.
 *
 * Every call is recorded in `window.__rc.calls` with its table and payload,
 * which is what the isolation check reads. `__rc.offline` makes writes throw
 * the way a dropped connection does, so the huddle's queue can be exercised
 * without unplugging anything.
 */
export function fakeSdk() {
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
    rc_support_codes: [
      { id: 'sc1', code: 'X', name: 'EIC', party: 'BART', active: true, sort: 10 },
      { id: 'sc2', code: 'WIT', name: 'BART witness', party: 'BART', active: true, sort: 20 },
      { id: 'sc3', code: 'TCE', name: 'TCE', party: 'BART', active: true, sort: 30 },
    ],
    rc_la_rows: [],
    rc_la_cells: [],
    rc_la_edits: [],
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
    rc_la_seen: [],
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
      // Paging, as PostgREST does it: the editor reads every page of the cells.
      range(from, to) { rows = rows.slice(from, to + 1); return api; },
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
            const defaults = {
              ...(list.some((r) => 'active' in r) ? { active: true } : {}),
              ...(table === 'rc_client_errors' ? { created_at: new Date().toISOString() } : {}),
              ...(table === 'rc_la_seen' ? { seen_at: new Date().toISOString() } : {}),
            };
            const made = [].concat(rows).map((r, i) => (
              { id: `${table}-${list.length + i + 1}`, ...defaults, ...r }));
            // The stub ignores order(): a "Got it" is read newest first, so it goes in first.
            if (table === 'rc_la_seen') list.unshift(...made);
            else list.push(...made);
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
          /* The look-ahead editor's one write: a batch of ops, all or nothing,
             each checked against the version it expects — the function's rules,
             modelled closely enough that a conflict here is a conflict there. */
          if (name === 'rc_la_apply') {
            if (S.role !== 'admin') {
              return Promise.resolve({ data: null, error: { message: 'only an administrator may edit the look-ahead' } });
            }
            if (S.offline) return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } });
            const before = { rows: JSON.stringify(S.rows.rc_la_rows || []), cells: JSON.stringify(S.rows.rc_la_cells || []) };
            const rows = S.rows.rc_la_rows || (S.rows.rc_la_rows = []);
            let cells = S.rows.rc_la_cells || (S.rows.rc_la_cells = []);
            const results = [];
            const logLength = (S.rows.rc_la_edits || (S.rows.rc_la_edits = [])).length;
            const fail = (message) => {
              S.rows.rc_la_rows = JSON.parse(before.rows);
              S.rows.rc_la_cells = JSON.parse(before.cells);
              S.rows.rc_la_edits.length = logLength;
              return Promise.resolve({ data: null, error: { message } });
            };
            // The edit log, as the function writes it: one row per change.
            const batch = `batch-${Date.now()}-${Math.random()}`;
            const log = (target, row_id, day, action, was, now) => {
              S.editSeq = (S.editSeq || 0) + 1;
              S.rows.rc_la_edits.push({
                id: S.editSeq, at: new Date().toISOString(), by: 'user-rc-1', batch, target, row_id,
                day: day || null, action, before: was ? JSON.parse(JSON.stringify(was)) : null,
                after: now ? JSON.parse(JSON.stringify(now)) : null,
              });
            };
            for (const op of args.p_ops || []) {
              const expect = op.expect || 0;
              if (op.op === 'row') {
                const hit = rows.find((r) => r.id === op.id);
                if (!hit) {
                  if (expect) return fail('conflict: that row was removed by somebody else');
                  const made = {
                    id: op.id, kind: 'activity', parent_id: null, sort: 0, level: 0, activity_id: '', description: '',
                    location: '', sswp: '', party: '', work_hours: '', absence_kind: null, archived: false,
                    ...op.set, version: 1,
                  };
                  rows.push(made);
                  log('row', op.id, null, 'insert', null, made);
                  results.push({ kind: 'row', id: op.id, version: 1 });
                } else {
                  if ((hit.version || 0) !== expect) return fail('conflict: somebody else changed that row a moment ago');
                  const was = { ...hit };
                  Object.assign(hit, op.set);
                  hit.version = (hit.version || 0) + 1;
                  log('row', op.id, null, 'update', was, hit);
                  results.push({ kind: 'row', id: op.id, version: hit.version });
                }
              } else if (op.op === 'delete_row') {
                const at = rows.findIndex((r) => r.id === op.id);
                if (at >= 0) {
                  if ((rows[at].version || 0) !== expect) return fail('conflict: somebody else changed that row a moment ago');
                  for (const c of cells.filter((x) => x.row_id === op.id)) log('cell', op.id, c.day, 'delete', c, null);
                  log('row', op.id, null, 'delete', rows[at], null);
                  rows.splice(at, 1);
                  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].parent_id === op.id) rows.splice(i, 1);
                  cells = cells.filter((c) => c.row_id !== op.id && rows.some((r) => r.id === c.row_id));
                  S.rows.rc_la_cells = cells;
                }
                results.push({ kind: 'row', id: op.id, version: 0, deleted: true });
              } else if (op.op === 'cell') {
                const at = cells.findIndex((c) => c.row_id === op.row_id && c.day === op.day);
                const current = at >= 0 ? cells[at].version || 0 : 0;
                if (current !== expect) return fail('conflict: somebody else changed that day a moment ago');
                const color = op.color ? String(op.color).toUpperCase() : null;
                const text = op.text || '';
                if (!color && !text) {
                  if (at >= 0) { log('cell', op.row_id, op.day, 'delete', cells[at], null); cells.splice(at, 1); }
                  results.push({ kind: 'cell', row_id: op.row_id, day: op.day, version: 0 });
                } else if (at >= 0) {
                  const was = { ...cells[at] };
                  Object.assign(cells[at], { color, text, version: current + 1 });
                  log('cell', op.row_id, op.day, 'update', was, cells[at]);
                  results.push({ kind: 'cell', row_id: op.row_id, day: op.day, version: current + 1 });
                } else {
                  const made = { row_id: op.row_id, day: op.day, color, text, version: 1 };
                  cells.push(made);
                  log('cell', op.row_id, op.day, 'insert', null, made);
                  results.push({ kind: 'cell', row_id: op.row_id, day: op.day, version: 1 });
                }
              }
              S.laRevision = (S.laRevision || 0) + 1;
            }
            return Promise.resolve({ data: results, error: null });
          }
          if (name === 'rc_la_revision') return Promise.resolve({ data: S.laRevision || 0, error: null });
          if (name === 'rc_clear_client_errors') {
            const list = S.rows.rc_client_errors || [];
            const keep = list.filter((r) => (r.created_at || '') >= args.p_before);
            S.rows.rc_client_errors = keep;
            return Promise.resolve({ data: list.length - keep.length, error: null });
          }
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
          if (name === 'rc_compact_snapshots') {
            S.compactCalls = (S.compactCalls || 0) + 1;
            return Promise.resolve({ data: 0, error: null });
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
