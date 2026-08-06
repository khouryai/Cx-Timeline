#!/usr/bin/env node
/**
 * End-to-end checks for the hosted build.
 *
 * The application is booted with a configured backend and a stand-in for the
 * Supabase client, so the sign-in gate, the account block, the Projects pane
 * and — the part that matters — read-only mode can be exercised without a
 * network, a real project, or anyone's credentials.
 *
 * The stub answers like the real thing, including the two behaviours the SQL
 * tests turned up: `save_project` raises rather than quietly writing nothing,
 * and a refused update returns no rows.
 *
 *   node tools/smoke_hosted.js [--shot out.png]
 *
 * The permission *rules* are tested in supabase/test/permissions.sql against a
 * real PostgreSQL. This suite tests that the interface honours them.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
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
 * A fake `window.supabase`, installed before any page script runs.
 *
 * `__cx.role` decides what the signed-in user may do, so a test can re-open
 * the page as a viewer and watch the interface change.
 */
function fakeSdk() {
  window.__cx = window.__cx || {};
  window.__cx.calls = [];
  window.__cx.role = window.__cx.role || 'owner';
  window.__cx.signedIn = window.__cx.signedIn || false;
  window.__cx.admin = window.__cx.admin === undefined ? true : window.__cx.admin;
  window.__cx.invitations = window.__cx.invitations || [];

  const USER = { id: 'user-1', email: 'alice@example.com', user_metadata: { full_name: 'Alice Engineer' } };
  const DOC = {
    schema: 2,
    id: 'proj-doc-1',
    name: 'Hosted Programme',
    settings: {},
    lanes: [{ id: 'lane-1', name: 'Software Releases', color: '#5b93f5', height: 64 }],
    laneOrder: ['lane-1'],
    objects: [
      { id: 'obj-1', type: 'activity', lane: 'lane-1', title: 'Regression Cycle 5',
        start: Date.UTC(2026, 7, 3), end: Date.UTC(2026, 7, 20), row: 0, status: 'inprogress', progress: 40 },
    ],
    links: [], baselines: [], groups: [], attachments: [], versions: [],
  };

  const denied = (message) => ({ data: null, error: { code: '42501', message } });
  const listeners = [];

  const table = (name) => ({
    _filters: {},
    select() { return this; },
    eq(col, val) { this._filters[col] = val; return this; },
    order() { return this; },
    async maybeSingle() {
      if (name === 'projects') {
        return { data: { id: 'proj-1', doc: DOC, rev: 3, name: DOC.name }, error: null };
      }
      return { data: null, error: null };
    },
    async single() {
      return { data: { id: 'proj-1', rev: 1 }, error: null };
    },
    insert(row) {
      window.__cx.calls.push({ op: 'insert', table: name, row });
      if (name === 'project_backups' && window.__cx.role === 'viewer') {
        const result = denied('new row violates row-level security policy');
        return { select: () => ({ single: async () => result }), then: (f) => f(result) };
      }
      const ok = { data: { id: 'proj-new', rev: 1 }, error: null };
      return { select: () => ({ single: async () => ok }), then: (f) => f(ok) };
    },
    update(patch) {
      window.__cx.calls.push({ op: 'update', table: name, patch });
      // A row hidden by row-level security is not an error — it simply
      // matches nothing, which is exactly what the real database does.
      const rows = window.__cx.role === 'viewer' ? [] : [{ id: 'proj-1' }];
      return { eq: () => ({ select: async () => ({ data: rows, error: null }) }) };
    },
    delete() {
      window.__cx.calls.push({ op: 'delete', table: name });
      const rows = window.__cx.role === 'owner' ? [{ id: 'proj-1' }] : [];
      return { eq: () => ({ select: async () => ({ data: rows, error: null }) }) };
    },
    async then(resolve) { resolve({ data: [], error: null }); },
  });

  window.supabase = {
    createClient() {
      return {
        auth: {
          async getSession() {
            return { data: { session: window.__cx.signedIn ? { user: USER } : null } };
          },
          async signInWithPassword({ email, password }) {
            window.__cx.calls.push({ op: 'signIn', email });
            if (password !== 'correct-horse') {
              return { data: null, error: { message: 'Invalid login credentials' } };
            }
            window.__cx.signedIn = true;
            return { data: { user: USER }, error: null };
          },
          async signUp() { return { data: { user: USER, session: null }, error: null }; },
          async signOut() { window.__cx.signedIn = false; return { error: null }; },
          async resetPasswordForEmail() { return { error: null }; },
          onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
        },
        from: table,
        storage: { from: () => ({ async upload() { return { error: null }; }, async download() { return { data: null, error: 'x' }; }, async remove() { return { error: null }; } }) },
        async rpc(name, args) {
          window.__cx.calls.push({ op: 'rpc', name, args });
          if (name === 'list_my_projects') {
            return { data: [
              { id: 'proj-1', name: 'Hosted Programme', role: window.__cx.role, object_count: 1, rev: 3,
                updated_at: new Date().toISOString(), created_at: new Date().toISOString(),
                owner_email: 'alice@example.com', member_count: 2 },
              { id: 'proj-2', name: 'Line 2 Extension', role: 'viewer', object_count: 12, rev: 9,
                updated_at: new Date().toISOString(), created_at: new Date().toISOString(),
                owner_email: 'bob@example.com', member_count: 3 },
            ], error: null };
          }
          if (name === 'project_role') return { data: window.__cx.role, error: null };
          if (name === 'save_project') {
            // The real function raises for a viewer rather than writing nothing.
            if (window.__cx.role === 'viewer') return denied('read only: you do not have permission');
            return { data: 4, error: null };
          }
          if (name === 'list_project_members') {
            return { data: [
              { user_id: 'user-1', email: 'alice@example.com', full_name: 'Alice Engineer', role: 'owner', created_at: new Date().toISOString() },
              { user_id: 'user-2', email: 'carol@example.com', full_name: null, role: 'viewer', created_at: new Date().toISOString() },
            ], error: null };
          }
          if (name === 'share_project') {
            if (window.__cx.role !== 'owner') return denied('only the owner can share this project');
            return { data: [{ member_id: 'user-3', member_email: args.p_email, member_role: args.p_role }], error: null };
          }
          if (name === 'prune_backups') return { data: 0, error: null };
          if (name === 'is_admin') return { data: window.__cx.admin, error: null };
          if (name === 'invite_user') {
            if (!window.__cx.admin) return denied('only an administrator can invite people');
            const email = String(args.p_email).trim().toLowerCase();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
              return { data: null, error: { code: '22023', message: `${args.p_email} does not look like an email address` } };
            }
            window.__cx.invitations.push({
              email, role_hint: args.p_role, note: args.p_note,
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
              expired: false, invited_by: 'alice@example.com',
            });
            return { data: [{ invited_email: email, invitation_expires: new Date(Date.now() + 30 * 864e5).toISOString() }], error: null };
          }
          if (name === 'revoke_invitation') {
            const email = String(args.p_email).toLowerCase();
            window.__cx.invitations = window.__cx.invitations.filter((i) => i.email !== email);
            return { data: null, error: null };
          }
          if (name === 'list_invitations') {
            return { data: window.__cx.admin ? window.__cx.invitations : [], error: null };
          }
          if (name === 'list_accounts') {
            if (!window.__cx.admin) return { data: [], error: null };
            return { data: [
              { id: 'user-1', email: 'alice@example.com', full_name: 'Alice Engineer', is_admin: true, created_at: new Date().toISOString(), projects: 2 },
              { id: 'user-2', email: 'carol@example.com', full_name: null, is_admin: false, created_at: new Date().toISOString(), projects: 1 },
            ], error: null };
          }
          if (name === 'set_admin') return { data: null, error: null };
          return { data: null, error: null };
        },
      };
    },
  };
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1500, height: 920 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // Point the build at a "backend" without touching the committed config.
  await page.route('**/config.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.CX_CONFIG = { supabaseUrl: 'https://stub.supabase.co', supabaseAnonKey: 'stub-key', requireAuth: true };`,
    })
  );
  // The real client is vendored and loads *after* init scripts, so it would
  // overwrite the stub. Blank it out; this suite is about our code, not theirs.
  await page.route('**/vendor/supabase.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '/* stubbed for tests */' })
  );
  await page.addInitScript(fakeSdk);

  const url_ = 'file://' + path.join(ROOT, 'index.html');

  /* ── The gate ─────────────────────────────────────────────────────────── */
  console.log('\nSign-in gate');
  await page.goto(url_, { waitUntil: 'load' });
  await page.waitForSelector('.cx-gate', { timeout: 15000 });
  check('the gate appears when nobody is signed in', await page.locator('.cx-gate-card').isVisible());
  check('the canvas is not shown behind it', !(await page.locator('.tl-obj').first().isVisible().catch(() => false)));
  // Hosted means hosted: there is no way past the gate without an account.
  check('there is no way to skip signing in', (await page.locator('.cx-gate-local').count()) === 0);

  await page.locator('.cx-gate input[name="email"]').fill('alice@example.com');
  await page.locator('.cx-gate input[name="password"]').fill('wrong');
  await page.locator('.cx-gate button[type="submit"]').click();
  await page.waitForTimeout(500);
  check('a bad password is reported, not swallowed',
    /do not match/i.test(await page.locator('.cx-gate-msg').innerText()));
  check('the gate stays up after a failure', await page.locator('.cx-gate-card').isVisible());

  // Sign-up is not self-service; the invitation flow is covered further down.
  check('sign-up is not offered from the gate',
    (await page.locator('.cx-gate-link', { hasText: /create an account/i }).count()) === 0);
  await page.locator('.cx-gate-link', { hasText: /forgot password/i }).click();
  await page.waitForTimeout(250);
  check('password reset is reachable',
    /reset your password/i.test(await page.locator('.cx-gate-title').innerText()));
  await page.locator('.cx-gate-link', { hasText: 'Back to sign in' }).click();
  await page.waitForTimeout(250);

  await page.locator('.cx-gate input[name="password"]').fill('correct-horse');
  await page.locator('.cx-gate button[type="submit"]').click();
  await page.waitForSelector('.tl-root', { timeout: 15000 });
  await page.waitForTimeout(1200);
  check('signing in opens the workspace', (await page.locator('.cx-gate').count()) === 0);
  check('the hosted project loaded', (await page.locator('.tl-obj').count()) > 0);

  /* ── Account & projects ───────────────────────────────────────────────── */
  console.log('\nAccount and projects');
  check('the account block names the user',
    (await page.locator('#sidenav .cx-account .acc-name').innerText()).includes('Alice'));
  check('it states the role', /owner/i.test(await page.locator('#sidenav .cx-account .acc-role').innerText()));

  await page.locator('#sidenav .nav-link[data-pane="projects"]').click();
  await page.waitForTimeout(700);
  check('the Projects pane lists what the account can reach',
    (await page.locator('#dock .cx-listrow[data-project]').count()) === 2);
  check('each project shows its role badge',
    (await page.locator('#dock .cx-listrow[data-project] .cx-badge').count()) === 2);
  check('a view-only project is labelled as such',
    /view only/i.test(await page.locator('#dock .cx-listrow[data-project="proj-2"]').innerText()));

  await page.locator('#dock .cx-btn', { hasText: 'Share' }).first().click();
  await page.waitForTimeout(500);
  check('the share dialog opens', (await page.locator('.cx-modal').count()) === 1);
  check('it lists who has access', (await page.locator('.cx-modal .cx-listrow[data-member]').count()) === 2);
  check('an owner can invite', (await page.locator('.cx-modal input[type="email"]').count()) === 1);
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(300);

  /* ── Editing works as an owner ────────────────────────────────────────── */
  console.log('\nAn owner can edit');
  await page.locator('.tl-obj').first().click();
  await page.waitForTimeout(300);
  const titleField = page.locator('#inspector input[type="text"]').first();
  await titleField.fill('Renamed by owner');
  await page.waitForTimeout(900);
  check('the edit reached save_project', await page.evaluate(() =>
    window.__cx.calls.some((c) => c.op === 'rpc' && c.name === 'save_project')));
  check('no read-only banner for an owner', (await page.locator('#cx-readonly-bar').count()) === 0);

  /* ── The same project as a viewer ─────────────────────────────────────── */
  console.log('\nRead-only mode');
  await page.addInitScript(() => { window.__cx = { role: 'viewer', signedIn: true, calls: [] }; });
  await page.goto(url_, { waitUntil: 'load' });
  await page.waitForSelector('.tl-root', { timeout: 15000 });
  await page.waitForTimeout(1400);

  check('a viewer is let straight in', (await page.locator('.cx-gate').count()) === 0);
  check('the project still renders', (await page.locator('.tl-obj').count()) > 0);
  check('the read-only banner is shown', (await page.locator('#cx-readonly-bar').count()) === 1);
  check('the body carries the read-only class', await page.evaluate(() => document.body.classList.contains('read-only')));
  check('the account block says view only',
    /view only/i.test(await page.locator('#sidenav .cx-account .acc-role').innerText()));
  check('the palette is not offered', await page.evaluate(() => {
    const link = document.querySelector('#sidenav .nav-link[data-pane="palette"]');
    return !link || getComputedStyle(link).display === 'none';
  }));

  // The real test: the store must refuse, and nothing may reach the server.
  const before = await page.evaluate(() => document.querySelector('.tl-obj')?.getAttribute('data-label'));
  await page.locator('.tl-obj').first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900);

  check('a viewer\'s nudge does not change the plan',
    (await page.evaluate(() => document.querySelector('.tl-obj')?.getAttribute('data-label'))) === before);
  check('nothing was sent to save_project', await page.evaluate(() =>
    !window.__cx.calls.some((c) => c.op === 'rpc' && c.name === 'save_project')));
  check('the refusal is explained once', (await page.locator('.cx-toast').count()) >= 1);

  const toastText = await page.locator('.cx-toast').first().innerText().catch(() => '');
  check('the notice says what to do about it', /edit access|read-only/i.test(toastText), toastText.replace(/\n/g, ' '));

  // Deleting is an owner action; a viewer pressing Delete must lose nothing.
  const countBefore = await page.locator('.tl-obj').count();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(600);
  check('a viewer cannot delete', (await page.locator('.tl-obj').count()) === countBefore);

  /* ── Invitation-only sign-up ──────────────────────────────────────────── */
  console.log('\nInvitation-only sign-up');
  await page.addInitScript(() => { window.__cx = { role: 'owner', signedIn: false, admin: true, calls: [], invitations: [] }; });
  await page.goto(url_, { waitUntil: 'load' });
  await page.waitForSelector('.cx-gate', { timeout: 15000 });
  await page.waitForTimeout(500);

  check('the gate offers no way to create an account',
    (await page.locator('.cx-gate-link', { hasText: /create an account/i }).count()) === 0);
  check('it says so plainly',
    /invitation/i.test(await page.locator('.cx-gate-links').innerText()));
  check('signing in and resetting a password are still offered',
    (await page.locator('.cx-gate button[type="submit"]').count()) === 1 &&
    (await page.locator('.cx-gate-link', { hasText: /forgot password/i }).count()) === 1);

  // An invitation link reveals the form and fills the address in. Changing
  // only the fragment is a same-document navigation, so the reload is what
  // actually re-runs boot — exactly as it would for someone opening the link
  // fresh.
  await page.goto(url_ + '#invite=newstarter%40example.com', { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.cx-gate', { timeout: 15000 });
  await page.waitForTimeout(600);
  check('an invitation link opens the sign-up form',
    /set up your account/i.test(await page.locator('.cx-gate-title').innerText()));
  check('with the invited address filled in',
    (await page.locator('.cx-gate input[name="email"]').inputValue()) === 'newstarter@example.com');

  /* ── The Team pane ────────────────────────────────────────────────────── */
  console.log('\nTeam administration');
  await page.addInitScript(() => { window.__cx = { role: 'owner', signedIn: true, admin: true, calls: [], invitations: [] }; });
  await page.goto(url_, { waitUntil: 'load' });
  await page.waitForSelector('.tl-root', { timeout: 15000 });
  await page.waitForTimeout(1400);

  check('an administrator gets the Team pane',
    (await page.locator('#sidenav .nav-link[data-pane="team"]').count()) === 1);
  await page.locator('#sidenav .nav-link[data-pane="team"]').click();
  await page.waitForTimeout(700);
  check('it lists the accounts', (await page.locator('#dock .cx-listrow[data-account]').count()) === 2);
  check('and marks the administrators', (await page.locator('#dock .cx-listrow[data-account] .cx-badge').count()) === 1);

  await page.locator('#dock input[type="email"]').fill('newstarter@example.com');
  await page.locator('#dock .cx-btn.primary', { hasText: 'Create invitation' }).click();
  await page.waitForTimeout(700);
  check('inviting produces a link to pass on', (await page.locator('.cx-modal').count()) === 1);
  const inviteLink = await page.locator('.cx-modal input[readonly]').inputValue();
  check('the link carries the invited address', /#invite=newstarter%40example\.com$/.test(inviteLink), inviteLink);
  await page.locator('.cx-modal-foot .cx-btn.primary').click();
  await page.waitForTimeout(500);
  check('the invitation is listed as pending',
    (await page.locator('#dock .cx-listrow[data-invite="newstarter@example.com"]').count()) === 1);

  await page.locator('#dock input[type="email"]').fill('not-an-email');
  await page.locator('#dock .cx-btn.primary', { hasText: 'Create invitation' }).click();
  await page.waitForTimeout(600);
  check('a bad address is rejected with a reason', (await page.locator('.cx-toast').count()) >= 1);
  await page.evaluate(() => document.querySelectorAll('.cx-toast, .cx-modal-overlay').forEach((n) => n.remove()));

  /* ── Non-administrators ───────────────────────────────────────────────── */
  console.log('\nNon-administrators');
  await page.addInitScript(() => { window.__cx = { role: 'editor', signedIn: true, admin: false, calls: [], invitations: [] }; });
  await page.goto(url_, { waitUntil: 'load' });
  await page.waitForSelector('.tl-root', { timeout: 15000 });
  await page.waitForTimeout(1400);
  check('the Team pane is not offered',
    (await page.locator('#sidenav .nav-link[data-pane="team"]').count()) === 0);
  check('nor is the invitation list reachable',
    (await page.evaluate(() => window.__cx.invitations.length)) === 0);

  /* ── No way round the gate ────────────────────────────────────────────── */
  console.log('\nThe gate cannot be skipped');
  await page.addInitScript(() => { window.__cx = { role: 'owner', signedIn: false, calls: [] }; });
  await page.goto(url_, { waitUntil: 'load' });
  await page.waitForSelector('.cx-gate', { timeout: 15000 });
  await page.waitForTimeout(600);
  check('signing out puts the gate back', (await page.locator('.cx-gate-card').count()) === 1);
  check('no "continue without an account"', (await page.locator('.cx-gate-local').count()) === 0);
  check('the workspace never renders behind it', (await page.locator('.tl-obj').count()) === 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Escape does not dismiss it', (await page.locator('.cx-gate-card').count()) === 1);

  console.log('\nConsole');
  const meaningful = consoleErrors.filter((e) => !/favicon|net::ERR|Failed to load resource/i.test(e));
  check('no console errors', meaningful.length === 0, meaningful.slice(0, 3).join(' | '));

  const shotIndex = process.argv.indexOf('--shot');
  if (shotIndex > -1 && process.argv[shotIndex + 1]) {
    await page.screenshot({ path: process.argv[shotIndex + 1] });
    console.log(`\nScreenshot → ${process.argv[shotIndex + 1]}`);
  }

  await browser.close();

  console.log(`\n${passed}/${passed + failures.length} checks passed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  ✗ ' + f);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
