#!/usr/bin/env node
/**
 * What each deployment shape actually publishes.
 *
 * `tools/dist.js` decides something no test elsewhere covers: whether the
 * published site can talk to a backend, and to which one. That is a security
 * property rather than a packaging detail — the plan holds the P6 programme and
 * must not acquire a backend in any shape that ships it from a folder — and it
 * is enforced in three independent places (the config, the script tag, the
 * content-security policy). Any one of them silently flipping would either
 * break the calendar or, far worse, quietly give the plan somewhere to go.
 *
 * So this builds all three shapes for real and reads what came out.
 *
 *   node tools/test_dist.js
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

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

/** Build one shape; returns `{ ok, out }` rather than throwing on a refusal. */
function build(args, env = {}) {
  try {
    const out = execFileSync('node', [path.join(ROOT, 'tools/dist.js'), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_URL: '', SUPABASE_ANON_KEY: '', ...env },
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: (err.stdout || '') + (err.stderr || '') };
  }
}

const read = (f) => (fs.existsSync(path.join(DIST, f)) ? fs.readFileSync(path.join(DIST, f), 'utf8') : '');
const exists = (f) => fs.existsSync(path.join(DIST, f));

/** The line the browser enforces. */
const connectSrc = () => (/connect-src ([^;]*)/.exec(read('_headers').split('\n').filter((l) => l.includes('Content-Security-Policy'))[0] || '') || [])[1] || '';

/* ══════════════════════════════════════════════════════════════════════════
   Folder — no backend at all
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nA folder deployment has no backend of any kind');

// Stale variables in CI must not be able to turn this back into a hosted site.
build(['--no-backend'], { SUPABASE_URL: 'https://leaked.supabase.co', SUPABASE_ANON_KEY: 'leaked' });

check('the plan has no backend', /supabaseUrl:\s*''/.test(read('config.js')));
check('and a stale SUPABASE_URL in the environment was ignored',
  !read('config.js').includes('leaked'));
check('the calendar has none either', !/rcSupabaseUrl:\s*"https/.test(read('config.js')));
check('the vendored client is not shipped', !exists('vendor/supabase.js'));
check('nor is its script tag left behind to 404', !read('index.html').includes('vendor/supabase.js'));
check("connect-src is 'self' and nothing else", connectSrc().trim() === "'self'", connectSrc().trim());
check('the desktop update channel is still published', exists('desktop/version.json'));

/* ══════════════════════════════════════════════════════════════════════════
   Calendar — the plan still has none, the calendar has one
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nA calendar deployment refuses to publish without its project');

// A site nobody can sign in to is worse than a failed build, so it fails.
const refused = build(['--calendar'], { RC_SUPABASE_URL: '', RC_SUPABASE_ANON_KEY: '' });
check('a missing RC_SUPABASE_URL fails the build', !refused.ok);
check('and says which variable, and that it is not the plan\'s',
  /RC_SUPABASE_URL/.test(refused.out) && /never the plan/i.test(refused.out));

console.log('\nA calendar deployment ships one backend, for the calendar only');

const RC = 'https://rcproj.supabase.co';
build(['--calendar'], { RC_SUPABASE_URL: RC, RC_SUPABASE_ANON_KEY: 'rc-key', SUPABASE_URL: 'https://leaked.supabase.co' });

const config = read('config.js');
// The property this whole file exists for.
check('THE PLAN STILL HAS NO BACKEND', /supabaseUrl:\s*''/.test(config));
check('even with SUPABASE_URL set in the environment', !config.includes('leaked'));
check('the calendar has its own', config.includes(`rcSupabaseUrl: "${RC}"`));
check('and its own key', config.includes('rcSupabaseAnonKey: "rc-key"'));

check('the vendored client is shipped', exists('vendor/supabase.js'));
check('and its script tag kept, so nothing 404s', read('index.html').includes('vendor/supabase.js'));

// A wildcard would permit every project on the platform — including the plan's,
// if one ever existed. The host is named.
check('connect-src names the one host', connectSrc().includes(RC), connectSrc().trim());
check('and does not wildcard supabase.co', !connectSrc().includes('*.supabase.co'));
check('websockets to the same host are allowed', connectSrc().includes('wss://rcproj.supabase.co'));

check('the desktop update channel is still published', exists('desktop/version.json'),
  'publishing the site is how the installed exe updates');

/* ══════════════════════════════════════════════════════════════════════════
   Hosted — unchanged
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nA hosted deployment still refuses to publish without a backend');
const hosted = build(['--hosted'], { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' });
check('a hosted build with no backend fails', !hosted.ok);
check('and explains both ways out', /build:folder|no backend at all/.test(hosted.out));

/* Leave the tree in the shape the repository actually deploys. */
build(['--no-backend']);

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
