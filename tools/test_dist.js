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

/* ══════════════════════════════════════════════════════════════════════════
   Nothing is downloaded twice
   ═══════════════════════════════════════════════════════════════════════ */
console.log('\nAssets are named after their contents, so a repeat visit is free');

// Built above by the calendar shape, which is the one the team actually loads.
const markup = read('index.html');
const hashedBundle = (/src="(app\.[0-9a-f]{10}\.js)"/.exec(markup) || [])[1];

check('the bundle is published under a name derived from its bytes',
  Boolean(hashedBundle), hashedBundle || markup.match(/src="app[^"]*"/)?.[0]);
check('and the unhashed name is not there to be served uncached',
  !exists('app.bundle.js'));
check('every stylesheet too',
  (markup.match(/href="css\/[a-z]+\.[0-9a-f]{10}\.css"/g) || []).length >= 6);
check('and index.html points at what was actually written',
  (markup.match(/(?:src|href)="((?:app|css\/)[^"]+)"/g) || [])
    .map((m) => m.replace(/^[a-z]+="|"$/g, ''))
    .every((rel) => exists(rel)));

const policy = read('_headers');
check('they are cached forever, because the name changes when the bytes do',
  /\/app\.\*\.js\n\s*Cache-Control: public, max-age=31536000, immutable/.test(policy));
check('and the rule that made the bundle uncacheable is gone',
  !/\/app\.bundle\.js/.test(policy));

/* The name has to be a function of the contents and nothing else: stable when
   they are, different when they are not. A timestamp would defeat the whole
   point by changing on every deploy. */
const first = hashedBundle;
build(['--calendar'], { RC_SUPABASE_URL: RC, RC_SUPABASE_ANON_KEY: 'rc-anon-key' });
check('rebuilding the same source publishes the same name',
  (/src="(app\.[0-9a-f]{10}\.js)"/.exec(read('index.html')) || [])[1] === first);

const bundlePath = path.join(ROOT, 'app.bundle.js');
const original = fs.readFileSync(bundlePath);
try {
  fs.writeFileSync(bundlePath, Buffer.concat([original, Buffer.from('\n// changed\n')]));
  build(['--calendar'], { RC_SUPABASE_URL: RC, RC_SUPABASE_ANON_KEY: 'rc-anon-key' });
  check('and a changed bundle publishes a different one',
    (/src="(app\.[0-9a-f]{10}\.js)"/.exec(read('index.html')) || [])[1] !== first);
} finally {
  fs.writeFileSync(bundlePath, original);
}

// Renaming the published copy must not touch what the installed application
// follows: the payload is built from the repository, not from `dist/`.
build(['--no-backend']);
const payload = JSON.parse(read('desktop/payload.json') || '{}');
check('the desktop payload still carries the bundle, whatever the site calls it',
  typeof payload.bundle === 'string' && payload.bundle.length > 100000,
  `${Math.round((payload.bundle || '').length / 1024)} kB`);

/* ══════════════════════════════════════════════════════════════════════════
   The desktop shape — the installer, which is a fourth deployment
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\nThe installer carries the calendar only when it is given one');

/** Assemble `dist-desktop/`; returns `{ ok, out }` rather than throwing. */
function desktop(env = {}) {
  try {
    return {
      ok: true,
      out: execFileSync('node', [path.join(ROOT, 'tools/desktop.js')], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, RC_SUPABASE_URL: '', RC_SUPABASE_ANON_KEY: '', ...env },
      }),
    };
  } catch (err) {
    return { ok: false, out: (err.stdout || '') + (err.stderr || '') };
  }
}
const shellFile = (f) => {
  const at = path.join(ROOT, 'dist-desktop', f);
  return fs.existsSync(at) ? fs.readFileSync(at, 'utf8') : '';
};

desktop();
check('with no keys it is what it always was: no backend of any kind',
  /supabaseUrl:\s*''/.test(shellFile('config.js')) && !/rcSupabaseUrl/.test(shellFile('config.js')));
check('and the Supabase client is not shipped',
  !fs.existsSync(path.join(ROOT, 'dist-desktop', 'vendor', 'supabase.js')));
check('nor is its script tag left behind pointing at nothing',
  !shellFile('index.html').includes('vendor/supabase.js'));

desktop({ RC_SUPABASE_URL: 'https://rc-test.supabase.co', RC_SUPABASE_ANON_KEY: 'anon-test' });
check('with the calendar\'s keys the plan STILL has no backend',
  /supabaseUrl:\s*''/.test(shellFile('config.js')));
check('and only the calendar gets one',
  shellFile('config.js').includes('https://rc-test.supabase.co'));
check('the client is shipped for it, from the installer rather than a CDN',
  fs.existsSync(path.join(ROOT, 'dist-desktop', 'vendor', 'supabase.js'))
    && shellFile('index.html').includes('vendor/supabase.js'));

// The plan's own variables must not be able to reach this build by being left
// set in a shell — the same trap the folder shape is guarded against.
desktop({
  RC_SUPABASE_URL: 'https://rc-test.supabase.co',
  RC_SUPABASE_ANON_KEY: 'anon-test',
  SUPABASE_URL: 'https://leaked.supabase.co',
  SUPABASE_ANON_KEY: 'leaked',
});
check('a stale SUPABASE_URL in the environment cannot give the plan one',
  !shellFile('config.js').includes('leaked'));

// The update payload carries code, never configuration. A deployment that
// could rewrite config.js on an installed machine could give the plan a
// backend from a thousand miles away.
// Checked on the payload's *keys*: the bundle itself naturally mentions
// `rcSupabaseUrl` — it is the code that reads it — so searching the text would
// pass or fail for the wrong reason.
const desktopPayload = JSON.parse(read('desktop/payload.json') || '{}');
check('and the update channel carries code and styles, never configuration',
  Object.keys(desktopPayload).sort().join(',') === 'builtAt,bundle,css,revision,version',
  Object.keys(desktopPayload).sort().join(','));

// A window whose policy forbids the host it is about to call is an installer
// that looks built and cannot sign in. Refused rather than shipped.
const wrongHost = desktop({ RC_SUPABASE_URL: 'https://rc-test.example.org', RC_SUPABASE_ANON_KEY: 'anon-test' });
check('an installer whose window would refuse the calendar is not built', !wrongHost.ok);
check('and it says which line to change',
  /tauri\.conf\.json/.test(wrongHost.out) && /connect-src/.test(wrongHost.out));

/* Leave it in the shape the repository deploys. */
desktop();

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
