#!/usr/bin/env node
/**
 * Assemble the deployable site into `dist/`.
 *
 * Cloudflare Pages serves whatever directory it is pointed at, so building in
 * place would publish `src/`, `tools/` and the test suites alongside the
 * application. None of that is secret, but a deploy should contain the thing
 * being deployed and nothing else.
 *
 * Run after `npm run build` — or use `npm run build:dist`, which does both.
 *
 * Two shapes come out of here, and the flag is deliberate rather than inferred:
 *
 *   (default)      a hosted deployment. Refuses to publish without a backend,
 *                  because a hosted build with no account is a site that cannot
 *                  sign anyone in and quietly keeps everything in one browser.
 *   --no-backend   a folder deployment. No Supabase at all: the config is
 *                  written blank whatever the environment says, the vendored
 *                  client is left out, and the plan lives in a folder the user
 *                  picks. Nothing of the user's reaches any vendor.
 *   calendar       the folder deployment, plus the resource calendar. The plan
 *                  still has no backend and still lives in a folder; the
 *                  calendar has one, so the team can read it in a browser.
 *                  That is not a middle ground between the other two — it is
 *                  the two halves of this application having different
 *                  answers, which is the whole design.
 *
 * A folder deployment also carries `desktop/version.json` and
 * `desktop/payload.json` — the update channel the installed desktop application
 * checks on launch. That is why deploying the site is all it takes to update the
 * application on both people's laptops; see `tools/desktop.js`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { writeChannel } from './desktop.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');

/** Everything the browser actually loads, and nothing else. */
const FILES = ['index.html', 'app.bundle.js', 'config.js', '_headers'];
const DIRS = ['css', 'vendor'];

/**
 * Which shape to build.
 *
 * `package.json` → `cxTimeline.deployment` decides, so the answer lives in the
 * repository and travels with a merge. That matters more than it sounds: the
 * alternative is a build command and a set of environment variables in a CI
 * dashboard, where getting one of them wrong produces a site that looks fine
 * and quietly saves to the wrong place. `--no-backend` forces the folder shape
 * for a one-off local build.
 */
function deploymentShape() {
  if (process.argv.includes('--no-backend')) return 'folder';
  if (process.argv.includes('--calendar')) return 'calendar';
  if (process.argv.includes('--hosted')) return 'hosted';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const named = pkg.cxTimeline?.deployment;
    if (named === 'folder' || named === 'calendar') return named;
    return 'hosted';
  } catch {
    return 'hosted';
  }
}

const SHAPE = deploymentShape();

/**
 * True when the *plan* has no backend — which is both no-backend shapes.
 *
 * Everything the plan does is identical in `folder` and `calendar`: blank
 * `supabaseUrl`, a document in a folder the user picks, and the desktop update
 * channel written alongside. The two differ only in whether a second, separate
 * client is shipped for the resource calendar.
 */
const NO_BACKEND = SHAPE === 'folder' || SHAPE === 'calendar';
const WITH_CALENDAR = SHAPE === 'calendar';

/**
 * The calendar's Supabase project, from the build environment.
 *
 * Deliberately *not* `SUPABASE_URL` — that one belongs to the plan and must
 * stay unset in these shapes. Two names that cannot be mistaken for each other
 * is the same discipline `config.js` applies, for the same reason: a plan that
 * quietly acquired a backend is the one failure nobody would notice.
 */
function calendarEnv() {
  return {
    url: process.env.RC_SUPABASE_URL || '',
    key: process.env.RC_SUPABASE_ANON_KEY || '',
  };
}

/** `config.js` for a folder deployment, written regardless of the environment. */
const BLANK_CONFIG = `/**
 * Deployment configuration — written by tools/dist.js --no-backend.
 *
 * There is no backend. The plan lives in a folder the user picks (Import /
 * export → Shared folder), so nothing is sent anywhere and no account exists.
 */
window.CX_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  requireAuth: false,
};
`;

/**
 * `config.js` for a calendar deployment.
 *
 * `supabaseUrl` is still written blank, and that is the point rather than an
 * oversight: the plan holds the P6 programme and never gets a backend in this
 * shape either. Only the second pair of keys is filled, and nothing on the
 * plan's storage path reads them.
 */
const calendarConfig = ({ url, key }) => `/**
 * Deployment configuration — written by tools/dist.js (calendar shape).
 *
 * The plan has no backend: it lives in a folder the user picks, and
 * \`supabaseUrl\` below stays blank so it cannot acquire one by accident.
 *
 * The resource calendar has its own, separate project. Nothing that reads the
 * plan imports the client these keys create, and tools/smoke_calendar.js
 * asserts that nothing carrying plan content ever leaves.
 */
window.CX_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  requireAuth: false,

  rcSupabaseUrl: ${JSON.stringify(url)},
  rcSupabaseAnonKey: ${JSON.stringify(key)},
};
`;

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/**
 * Give the bundle and the stylesheets names that change when they do.
 *
 * The bundle is 1.3 MB — 328 kB over the wire once Cloudflare compresses it —
 * and `_headers` marks it `no-cache`, because its name never changes and a
 * cached copy would leave people running the previous deploy. So every visit
 * pays for the whole application again, and so does every stylesheet.
 *
 * Naming a file after its own contents settles both halves at once: the name
 * changes exactly when the bytes do, so it can be cached forever and a new
 * deploy is picked up immediately because it is a different URL. A repeat
 * visit then costs `index.html` and `config.js` and nothing else.
 *
 * Done here rather than in the repository on purpose. `index.html` still says
 * `app.bundle.js`, which is what makes double-clicking it work with no server
 * — the whole reason the bundle exists — and what the desktop shell falls back
 * to from its own folder. Only the published copy is renamed.
 */
function fingerprint(dir) {
  const hash = (file) =>
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);

  const html = path.join(dir, 'index.html');
  let markup = fs.readFileSync(html, 'utf8');
  const renamed = [];

  const rename = (rel, make) => {
    const from = path.join(dir, rel);
    if (!fs.existsSync(from)) return null;
    const to = make(hash(from));
    fs.renameSync(from, path.join(dir, to));
    renamed.push(to);
    return to;
  };

  const bundle = rename('app.bundle.js', (h) => `app.${h}.js`);
  if (!bundle) {
    console.error('✗ no app.bundle.js to publish — run `npm run build` first.');
    process.exit(1);
  }
  markup = markup.replace('src="app.bundle.js"', `src="${bundle}"`);

  const cssDir = path.join(dir, 'css');
  if (fs.existsSync(cssDir)) {
    for (const name of fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'))) {
      const to = rename(`css/${name}`, (h) => `css/${name.replace(/\.css$/, '')}.${h}.css`);
      markup = markup.replace(`href="css/${name}"`, `href="${to}"`);
    }
  }

  if (/(src|href)="(app\.bundle\.js|css\/[a-z]+\.css)"/.test(markup)) {
    console.error('✗ index.html still points at an unhashed asset — check the markup.');
    process.exit(1);
  }
  fs.writeFileSync(html, markup);

  /* The rule that made the bundle uncacheable no longer applies to it, and a
     rule naming a file that is not there any more is worse than no rule: it
     reads as caching that is configured and is not. */
  const headers = path.join(dir, '_headers');
  if (fs.existsSync(headers)) {
    const before = fs.readFileSync(headers, 'utf8');
    const after = before.replace(
      /# The bundle is rebuilt on every deploy[\s\S]*?\/app\.bundle\.js\n  Cache-Control: no-cache\n/,
      '# The bundle and the stylesheets are named after their own contents, so a\n'
      + '# new deploy is a new URL and an old one can be kept forever.\n'
      + '/app.*.js\n  Cache-Control: public, max-age=31536000, immutable\n\n'
      + '/css/*\n  Cache-Control: public, max-age=31536000, immutable\n'
    );
    if (after === before) {
      console.error('✗ could not update the cache policy in _headers — check the file.');
      process.exit(1);
    }
    fs.writeFileSync(headers, after);
  }

  return renamed;
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  let bytes = 0;
  for (const file of FILES) {
    const src = path.join(ROOT, file);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(OUT, file));
    bytes += fs.statSync(src).size;
  }
  for (const dir of DIRS) {
    // The calendar shape needs the vendored client; the folder shape has
    // nothing to talk to and leaves it out.
    if (NO_BACKEND && !WITH_CALENDAR && dir === 'vendor') continue;
    const src = path.join(ROOT, dir);
    if (!fs.existsSync(src)) continue;
    copyDir(src, path.join(OUT, dir));
  }

  if (NO_BACKEND) {
    const rc = calendarEnv();

    // A calendar deployment that cannot reach its calendar is a site nobody
    // can sign in to, so it fails the build rather than publishing one — the
    // same discipline the hosted shape applies to its own backend.
    if (WITH_CALENDAR && !/^https:\/\//.test(rc.url)) {
      console.error(
        '✗ this is a calendar deployment and RC_SUPABASE_URL is not set.\n' +
          '  Set RC_SUPABASE_URL and RC_SUPABASE_ANON_KEY as build environment\n' +
          '  variables (Cloudflare → Settings → Variables). They are the resource\n' +
          "  calendar's project, never the plan's — the plan has no backend in\n" +
          '  this shape and must not acquire one.'
      );
      process.exit(1);
    }

    // Overwrite whatever `build.js` wrote from the environment. Leaving stale
    // Supabase variables set in CI must not be able to turn a folder
    // deployment back into a hosted one by accident.
    fs.writeFileSync(
      path.join(OUT, 'config.js'),
      WITH_CALENDAR ? calendarConfig(rc) : BLANK_CONFIG
    );

    // The vendored client is loaded by a plain script tag. Dropping the file
    // without dropping the tag would log a 404 on every page load — and in the
    // calendar shape the file is shipped, so the tag has to stay.
    const html = path.join(OUT, 'index.html');
    if (!WITH_CALENDAR) {
      const source = fs.readFileSync(html, 'utf8');
      const stripped = source.replace(
        /\n\s*<!--\s*\n\s*The Supabase client[\s\S]*?-->\s*\n\s*<script src="vendor\/supabase\.js"><\/script>/,
        '\n    <!-- No backend in this build: the Supabase client is not shipped. -->'
      );
      if (stripped === source) {
        console.error('✗ could not remove the Supabase script tag from index.html — check the markup.');
        process.exit(1);
      }
      fs.writeFileSync(html, stripped);
    }

    // The policy is narrowed either way. With no backend there is nowhere
    // legitimate to connect to at all; with a calendar there is exactly one
    // host, named rather than wildcarded — `*.supabase.co` would permit every
    // project on the platform, including the plan's if one ever existed.
    const headers = path.join(OUT, '_headers');
    if (fs.existsSync(headers)) {
      const before = fs.readFileSync(headers, 'utf8');
      const origin = WITH_CALENDAR ? new URL(rc.url).origin : '';
      const allow = WITH_CALENDAR
        ? `connect-src 'self' ${origin} ${origin.replace(/^https:/, 'wss:')}`
        : "connect-src 'self'";
      const after = before.replace(
        /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co/,
        allow
      );
      if (after === before) {
        console.error('✗ could not narrow connect-src in _headers — check the policy.');
        process.exit(1);
      }
      fs.writeFileSync(headers, after);
      console.log(`✓ _headers      — ${allow}`);
    }

    if (WITH_CALENDAR) {
      console.log('✓ config.js     — the plan has no backend; the calendar has its own');
      console.log('✓ index.html    — Supabase client shipped for the calendar only');
    } else {
      console.log('✓ config.js     — no backend; the plan lives in a folder the user picks');
      console.log('✓ index.html    — Supabase client not shipped');
    }
    if (process.env.SUPABASE_URL) {
      console.log('  note          — SUPABASE_URL is set in this environment and was ignored;');
      console.log(`                  package.json says this is a ${SHAPE} deployment, and the`);
      console.log('                  plan has no backend in either.');
    }
  } else {
    // Fail the build rather than publishing a site that cannot sign anyone in.
    const config = fs.readFileSync(path.join(OUT, 'config.js'), 'utf8');
    if (!/supabaseUrl:\s*['"]https?:\/\//.test(config) && !/"supabaseUrl":\s*"https?:\/\//.test(config)) {
      console.error(
        '✗ dist/config.js has no backend.\n' +
          '  Set SUPABASE_URL and SUPABASE_ANON_KEY as build environment variables\n' +
          '  (Cloudflare Pages → Settings → Environment variables) and build again,\n' +
          '  or run `npm run build:folder` for a deployment with no backend at all.'
      );
      process.exit(1);
    }
  }

  // The desktop application follows this deployment, so publishing the site is
  // also how an installed copy gets the update. Folder shape only: the desktop
  // build has no backend by construction, and feeding it a bundle cut for a
  // hosted deployment would leave it in local mode with no way to say why.
  if (NO_BACKEND) writeChannel(OUT);

  /* Last, so everything above still sees the names it was written against —
     and `writeChannel` reads the repository rather than this folder, so the
     desktop payload carries the bundle whatever the published copy is called. */
  const hashed = fingerprint(OUT);
  console.log(`✓ cache         — ${hashed.length} asset(s) named after their contents, cached forever`);

  const total = walkSize(OUT);
  console.log(`✓ dist/          — ${(total / 1024).toFixed(0)} kB ready to deploy`);
}

function walkSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? walkSize(p) : fs.statSync(p).size;
  }
  return total;
}

main();
