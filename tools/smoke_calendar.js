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
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

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

  S.rows = {
    rc_people: [
      { id: 'p1', user_id: 'user-rc-1', name: 'Alex', email: 'alex@example.com', title: 'Commissioning Manager', subsystem: 'ATS', role: S.role, active: true, working_days: [1, 2, 3, 4, 5] },
      { id: 'p2', user_id: null, name: 'Dan', title: 'Field Technician', subsystem: 'Wayside', role: 'member', active: true, working_days: [1, 2, 3, 4] },
      { id: 'p3', user_id: null, name: 'Priya', title: 'Test Engineer', subsystem: 'IXL', role: 'member', active: true, working_days: [1, 2, 3, 4, 5] },
      { id: 'p4', user_id: null, name: 'Sam', title: 'SCADA Engineer', subsystem: 'SCADA', role: 'member', active: true, working_days: [1, 2, 3, 4, 5] },
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
    rc_leave: [],
    rc_plan_entries: [],
    rc_plan_current: [],
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
    /* A snapshot shaped like the real workbook: a month band, day numbers, a
       row of weekday letters that is how the date axis gets found at all, and
       activities whose marks are painted. One colour is deliberately absent
       from the legend — a near miss of the legend blue, which is exactly what
       Excel's recent-colours picker produces — because "nothing is guessed"
       is the rule this whole pipeline is built on and it needs a case. */
    rc_lookahead_snapshots: [{
      id: 'snap1',
      taken_at: new Date().toISOString(),
      file_mtime: new Date().toISOString(),
      file_hash: 'stub-hash',
      sheet_name: '4WLA',
      grid: {
        merges: [], hiddenColumns: [], unknown: [],
        rows: [
          { row: 4, label: '', cells: [{ col: 8, ref: 'H4', value: 'JULY', hex: null }] },
          { row: 5, label: '', cells: [1, 2, 3, 4, 5, 6, 7].map((d, i) => (
            { col: 8 + i, ref: `X5`, value: String(d), hex: null })) },
          { row: 6, label: '', cells: ['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su'].map((d, i) => (
            { col: 8 + i, ref: `X6`, value: d, hex: null })) },
          { row: 7, label: '', cells: [
            { col: 2, ref: 'B7', value: 'CDRL 9.04.29', hex: null },
            { col: 3, ref: 'C7', value: 'IXL Regression Testing', hex: null },
            { col: 4, ref: 'D7', value: 'TPSS 12', hex: null },
            { col: 8, ref: 'H7', value: 'X', hex: 'FFFF00' },
            { col: 9, ref: 'I7', value: 'X.WIT', hex: 'FFFF00' },
            { col: 11, ref: 'K7', value: 'X', hex: 'FF0000' },
          ] },
          { row: 8, label: '', cells: [
            { col: 2, ref: 'B8', value: 'Operational Readiness', hex: null },
            { col: 3, ref: 'C8', value: 'ATS Site Test', hex: null },
            { col: 4, ref: 'D8', value: 'Station 6 Platform', hex: null },
            { col: 10, ref: 'J8', value: 'X.TCE', hex: '00B0F0' },
            { col: 12, ref: 'L8', value: 'X', hex: '3399FF' },
          ] },
          // The workbook's own key, in the shape readLegend() looks for.
          { row: 20, label: 'Highlight in Yellow for Day Shift',
            cells: [2, 3].map((c) => ({ col: c, ref: `X20`, value: '', hex: 'FFFF00' })) },
        ],
      },
    }],
    rc_legend: [
      { id: 'lg1', argb: 'FFFF00', meaning: 'Day Shift', valid_from: '2026-01-01', active: true },
      { id: 'lg2', argb: '00B0F0', meaning: 'Third Shift', valid_from: '2026-01-01', active: true },
      { id: 'lg3', argb: 'FF0000', meaning: 'Cancellation', valid_from: '2026-01-01', active: true },
    ],
    rc_settings: [{ key: 'lookahead_sheet', value: '4WLA' }],
    rc_lookahead_rows: [],
    rc_change_events: [],
    rc_change_annotations: [],
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
            const made = [].concat(rows).map((r, i) => ({ id: `${table}-${list.length + i + 1}`, ...r }));
            list.push(...made);
            if (table === 'rc_plan_entries') S.rows.rc_plan_current.push(...made);
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
              blocked_reason: args.p_blocked_reason,
              blocked_party_id: args.p_blocked_party,
              carry_chain_id: args.p_carry_chain,
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
        storage: { from: () => ({ upload: () => Promise.resolve({ error: null }) }) },
      };
    },
  };
}

/** Words that only ever appear in the timeline's document. */
const PLAN_WORDS = ['Signalling', 'Commissioning', 'ATS Integration', 'IXL Static', 'REL-', 'objects', 'lanes', 'baselines'];

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME });
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
  await page.locator('#rc-frame .rc-signin button').click();
  await page.waitForTimeout(300);
  check('a bad sign-in is reported rather than swallowed',
    await page.locator('#rc-frame .rc-error').isVisible());

  await inputs.nth(0).fill('alex@example.com');
  await page.locator('#rc-frame .rc-signin button').click();
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
  check('everyone is on one screen, side by side',
    /Alex/.test(huddleText) && /Dan/.test(huddleText) && /Priya/.test(huddleText) && /Sam/.test(huddleText));
  // Dan is on a four-day contract, so a Friday review does not ask him for an
  // outcome he could not have. Absence has to be a different fact from a miss.
  check('somebody who does not work that day is not asked',
    /not a working day/.test(huddleText));
  check('each status is one click, not a dropdown',
    (await page.locator('#rc-frame tbody button', { hasText: 'Completed' }).count()) >= 1);

  // A whole row per status button means a status is one press per person.
  await page.locator('#rc-frame tbody button', { hasText: 'Completed' }).first().click();
  await page.waitForTimeout(400);
  check('an outcome is recorded',
    await page.evaluate(() => window.__rc.rows.rc_actuals.length === 1));
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
  await page.locator('.cx-modal button', { hasText: 'Record' }).click();
  await page.waitForTimeout(400);
  check('with a reason and a party it goes through',
    await page.evaluate(() => window.__rc.rows.rc_actuals.some((a) => a.status === 'blocked')));
  check('and the party is carried with it',
    await page.evaluate(() => window.__rc.rows.rc_actuals.some((a) => a.blocked_party_id)));

  /* ── The meeting happens whether or not the network does ──────────────── */
  console.log('\nThe offline queue');
  await page.evaluate(() => { window.__rc.offline = true; });
  const before = await page.evaluate(() => window.__rc.rows.rc_actuals.length);
  await page.locator('#rc-frame tbody button', { hasText: 'Partial' }).first().click();
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

  /* ── The week plan ────────────────────────────────────────────────────── */
  console.log('\nThe week plan');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Week plan' }).click();
  await page.waitForSelector('#rc-frame .rc-table');
  const weekText = await page.locator('#rc-frame').innerText();
  check('the week is people down and days across', /Available/.test(weekText));
  check('and says how many can actually be staffed each day',
    /\d+ of 4/.test(weekText));

  /* ── The look-ahead and the SARs ──────────────────────────────────────── */
  console.log('\nThe look-ahead register');
  await page.locator('#rc-frame .rc-tab', { hasText: 'Look-ahead' }).click();
  await page.waitForSelector('#rc-frame .la-grid', { timeout: 10000 });

  /* ── The calendar ─────────────────────────────────────────────────────
     The workbook drawn as it looks: activities down, days across, in the
     colours it was painted. It draws the snapshot rather than the file,
     which is what lets it render on a machine that has never been given
     the folder — including this one. */
  const dayHeads = await page.locator('#rc-frame .la-grid thead tr').nth(1).locator('th').count();
  check('the date axis is found from the weekday row', dayHeads === 8, `${dayHeads} heads`);
  check('the month band is drawn',
    /JULY/.test(await page.locator('#rc-frame .la-grid thead').innerText()));
  check('the weekend is marked apart',
    (await page.locator('#rc-frame .la-grid thead .la-weekend').count()) >= 2);

  const gridText = await page.locator('#rc-frame .la-grid tbody').innerText();
  check('activities are listed down the side',
    /IXL Regression Testing/.test(gridText) && /Operational Readiness/.test(gridText));
  check('and their marks are on the days they fall',
    /X\.WIT/.test(gridText) && /X\.TCE/.test(gridText));

  // The cell keeps the workbook's own colour rather than a token of ours —
  // the person reading this has the spreadsheet open beside it.
  const painted = page.locator('#rc-frame .la-grid td.la-painted').first();
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

  await page.locator('#rc-frame .rc-tab', { hasText: 'Site access' }).click();
  await page.waitForTimeout(300);
  const sarText = await page.locator('#rc-frame').innerText();
  check('site access explains that matching is by date and location, never text',
    /never by activity text/.test(sarText));

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

  const planTables = calls.filter((c) => !/^rc_/.test(c.table));
  check('nothing was written to a table outside the calendar',
    planTables.length === 0,
    planTables.map((c) => c.table).join(', ') || 'none');

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
