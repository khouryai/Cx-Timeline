#!/usr/bin/env node
/**
 * Assemble the desktop shell into `dist-desktop/`, and the update channel that
 * feeds it into `dist/`.
 *
 *   node tools/desktop.js          # dist-desktop/ — what the installer contains
 *   node tools/desktop.js --channel dist
 *                                  # dist/desktop/ — what the deployment serves
 *
 * Run after `npm run build`, or use `npm run build:desktop`, which does both.
 *
 * Two directories, one payload
 * ----------------------------
 * `dist-desktop/` is the frontend Tauri bundles into the installer: the real
 * `index.html`, the stylesheets, the bundle, and `loader.js` in place of the
 * bundle's own script tag. That copy is what a first launch — or a launch with
 * no network — runs.
 *
 * `dist/desktop/` is two files on the deployment: `version.json`, which the
 * loader checks on every launch, and `payload.json`, which it only downloads
 * when the version is genuinely newer. Publishing the web build therefore
 * updates the desktop application as well, with nobody reinstalling anything.
 *
 * `builtAt` is what orders the two copies, and it is a plain ISO timestamp
 * rather than a hash of the contents. That is deliberate: the question the
 * loader asks is not "are these different" but "is the deployment ahead of what
 * I have", and a rebuilt deployment is always ahead of the installer it was cut
 * from. Comparing hashes would answer a question nobody asked and would happily
 * roll a machine *backwards* onto an older deploy.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SHELL_OUT = path.join(ROOT, 'dist-desktop');

/** What `loader.js` carries until a channel is substituted into it. */
const PLACEHOLDER = '__CHANNEL__';

/** Loaded in this order by `index.html`, so concatenated in this order too. */
const STYLES = ['tokens.css', 'base.css', 'components.css', 'layout.css', 'timeline.css', 'notes.css', 'calendar.css'];

/** `config.js` for the desktop build. The *plan* has no backend and never had. */
const BLANK_CONFIG = `/**
 * Deployment configuration — written by tools/desktop.js.
 *
 * The desktop build has no backend. The plan lives in a folder on this machine
 * — usually one OneDrive or SharePoint keeps in sync — and nothing is sent
 * anywhere. See src-tauri/src/plan.rs for every file it touches.
 */
window.CX_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  requireAuth: false,
};
`;

/**
 * The calendar's Supabase project, from the build environment.
 *
 * The same two names `tools/dist.js` reads, and deliberately *not*
 * `SUPABASE_URL` — that one belongs to the plan and must stay unset here. Two
 * names that cannot be mistaken for each other is the whole discipline: a plan
 * that quietly acquired a backend is the one failure nobody would notice.
 */
function calendarEnv() {
  return {
    url: process.env.RC_SUPABASE_URL || '',
    key: process.env.RC_SUPABASE_ANON_KEY || '',
  };
}

/**
 * `config.js` for a desktop build that carries the resource calendar.
 *
 * `supabaseUrl` is still written blank, and that is the point rather than an
 * oversight: the plan holds the P6 programme, it lives in a folder on this
 * machine, and it gets no backend in this shape either. Only the second pair
 * of keys is filled, and nothing on the plan's storage path reads them.
 *
 * This file is in the **installer**, not in the update payload — the payload
 * carries the bundle and the stylesheets and nothing else. That is deliberate:
 * a deployment that could rewrite `config.js` on an installed machine could
 * give the plan a backend from a thousand miles away, which is exactly the
 * thing every other rule here exists to prevent.
 */
const calendarConfig = ({ url, key }) => `/**
 * Deployment configuration — written by tools/desktop.js (calendar shape).
 *
 * The plan has no backend: it lives in a folder on this machine, and
 * \`supabaseUrl\` below stays blank so it cannot acquire one by accident.
 *
 * The resource calendar has its own, separate project. Nothing that reads the
 * plan imports the client these keys create.
 */
window.CX_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  requireAuth: false,

  rcSupabaseUrl: ${JSON.stringify(url)},
  rcSupabaseAnonKey: ${JSON.stringify(key)},
};
`;

/**
 * Whether the window's own policy would let the calendar be reached.
 *
 * The web build narrows `connect-src` at publish time, from a file it writes.
 * The desktop build cannot: its policy is in `src-tauri/tauri.conf.json`, which
 * is committed, read by cargo, and cannot see a build variable. So it ships a
 * policy wide enough to work and this checks the two agree — because the
 * failure it prevents is silent. Everything would look built, the window would
 * open, the calendar would sign in against a host the webview then refuses to
 * call, and the only symptom is a network error nobody can place.
 */
function cspAllows(origin) {
  const conf = path.join(ROOT, 'src-tauri', 'tauri.conf.json');
  let csp = '';
  try {
    csp = JSON.parse(fs.readFileSync(conf, 'utf8'))?.app?.security?.csp || '';
  } catch {
    return { ok: false, why: 'src-tauri/tauri.conf.json could not be read' };
  }
  const connect = (/connect-src ([^;]*)/.exec(csp) || [])[1] || '';
  const sources = connect.trim().split(/\s+/);
  const host = origin.replace(/^https:\/\//, '');

  // Compared as whole sources rather than as substrings, and a wildcard has to
  // match a *subdomain* — `*.supabase.co` permits `x.supabase.co` and not
  // `evilsupabase.co`, which is what the browser would do with it and
  // therefore the only reading worth checking against.
  const named = sources.includes(origin);
  const wild = sources.some((src) => {
    const suffix = (/^https:\/\/\*\.(.+)$/.exec(src) || [])[1];
    return suffix ? host.endsWith(`.${suffix}`) : false;
  });
  return { ok: named || wild, why: connect, named };
}

/** Which deployment the installed application follows for updates. */
export function updateChannel() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return (pkg.cxTimeline?.updateChannel || '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** The commit this was cut from, when there is one. Display only. */
function revision() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

/**
 * One release, as the loader consumes it: the application's code and styles as
 * text, with enough about itself to be ordered against another copy.
 */
export function buildPayload(builtAt = new Date().toISOString()) {
  const bundle = path.join(ROOT, 'app.bundle.js');
  if (!fs.existsSync(bundle)) {
    console.error('✗ app.bundle.js is missing — run `npm run build` first.');
    process.exit(1);
  }
  const css = STYLES.map((name) => {
    const file = path.join(ROOT, 'css', name);
    if (!fs.existsSync(file)) {
      console.error(`✗ css/${name} is missing — check the STYLES list in tools/desktop.js.`);
      process.exit(1);
    }
    return `/* css/${name} */\n${fs.readFileSync(file, 'utf8')}`;
  }).join('\n');

  return {
    version: version(),
    builtAt,
    revision: revision(),
    css,
    bundle: fs.readFileSync(bundle, 'utf8'),
  };
}

/**
 * Write the update channel the loader polls.
 *
 * Called by `tools/dist.js` so that publishing the site publishes the update in
 * the same step — a deployment where the two disagree is a deployment where the
 * desktop application either misses an update or downloads one that is not
 * there.
 */
export function writeChannel(distDir, builtAt = new Date().toISOString()) {
  const payload = buildPayload(builtAt);
  const out = path.join(distDir, 'desktop');
  fs.mkdirSync(out, { recursive: true });

  fs.writeFileSync(
    path.join(out, 'version.json'),
    JSON.stringify({ version: payload.version, builtAt: payload.builtAt, revision: payload.revision }, null, 2)
  );
  fs.writeFileSync(path.join(out, 'payload.json'), JSON.stringify(payload));

  const kb = (fs.statSync(path.join(out, 'payload.json')).size / 1024).toFixed(0);
  console.log(`✓ dist/desktop/  — version.json + payload.json (${kb} kB) for the installed application`);
  return payload;
}

/**
 * Turn the application's `index.html` into the shell's.
 *
 * Derived rather than kept as a second copy: two hand-maintained index files
 * drift, and the one that drifts is always the one nobody opens in a browser.
 * Every substitution is checked, and a miss fails the build rather than
 * producing a window that silently runs the wrong thing.
 */
function shellHtml(channel, withCalendar) {
  const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  let html = source;

  // The stylesheets stay as files — they are the installed copy's styles — but
  // are marked so `loader.js` can take them off the page when it has newer ones.
  const marked = html.replace(
    /<link rel="stylesheet" href="css\/([a-z]+\.css)" \/>/g,
    '<link rel="stylesheet" href="css/$1" data-shell="shipped" />'
  );
  if (marked === html) fail('could not mark the stylesheet links');
  html = marked;

  /* The vendored client goes with the calendar, and only with it.
     The plan never needs one in this build — it has no backend in any desktop
     shape — so without the calendar the script is not shipped and its tag must
     go with it, or the window opens on a 404 for a file that is not there. */
  if (!withCalendar) {
    const noVendor = html.replace(
      /\n\s*<!--\s*\n\s*The Supabase client[\s\S]*?-->\s*\n\s*<script src="vendor\/supabase\.js"><\/script>/,
      '\n    <!-- No backend in this desktop build: the Supabase client is not shipped. -->'
    );
    if (noVendor === html) fail('could not remove the Supabase script tag');
    html = noVendor;
  } else if (!html.includes('<script src="vendor/supabase.js"></script>')) {
    // Belt and braces: the calendar cannot start without the global this tag
    // defines, and a moved tag would produce a build that looks complete.
    fail('the Supabase script tag is not where the calendar shape expects it');
  }

  // The one substitution the whole design rests on: the loader decides which
  // copy of the application runs, so the bundle must not be loaded directly.
  const loaded = html.replace(
    /\n\s*<!--\s*\n\s*The application is authored as ES modules[\s\S]*?-->\s*\n\s*<script src="app\.bundle\.js"><\/script>/,
    `
    <!--
      The desktop shell. This page is local; the application it runs is the
      newest copy this machine has — the one inside the installer, or a newer
      one already downloaded from ${channel || 'the update channel'}. See
      tools/shell/loader.js for why it is done this way round.
    -->
    <script src="loader.js"></script>`
  );
  if (loaded === html) fail('could not replace the bundle script tag with the loader');
  html = loaded;

  return html.replace('<title>CX Timeline — Commissioning Planner</title>', '<title>CX Timeline</title>');
}

function fail(what) {
  console.error(`✗ ${what} in index.html — the markup moved; update tools/desktop.js to match.`);
  process.exit(1);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/** Assemble `dist-desktop/` — the frontend Tauri puts inside the installer. */
export function assembleShell(builtAt = new Date().toISOString()) {
  const channel = updateChannel();
  fs.rmSync(SHELL_OUT, { recursive: true, force: true });
  fs.mkdirSync(SHELL_OUT, { recursive: true });

  /* The calendar comes with the build only when its keys are in the
     environment — the same two `tools/dist.js` reads. Missing keys are not an
     error the way they are for a calendar *site*: a desktop build without them
     is exactly what has shipped until now and does the thing the installer is
     for, which is the plan in a folder. So it is said out loud instead. */
  const rc = calendarEnv();
  const withCalendar = Boolean(rc.url && rc.key);

  fs.writeFileSync(path.join(SHELL_OUT, 'index.html'), shellHtml(channel, withCalendar));
  fs.writeFileSync(
    path.join(SHELL_OUT, 'config.js'),
    withCalendar ? calendarConfig(rc) : BLANK_CONFIG
  );
  fs.copyFileSync(path.join(ROOT, 'app.bundle.js'), path.join(SHELL_OUT, 'app.bundle.js'));
  copyDir(path.join(ROOT, 'css'), path.join(SHELL_OUT, 'css'));
  if (withCalendar) copyDir(path.join(ROOT, 'vendor'), path.join(SHELL_OUT, 'vendor'));

  // The placeholder must appear exactly once, and must be gone afterwards. A
  // second occurrence — in a comment, say — takes the substitution and leaves
  // the real one in place, which produces an application that looks fine and
  // silently never updates. That happened; hence the count.
  const loader = fs.readFileSync(path.join(ROOT, 'tools', 'shell', 'loader.js'), 'utf8');
  const placeholders = loader.split(PLACEHOLDER).length - 1;
  if (placeholders !== 1) {
    console.error(`✗ tools/shell/loader.js has ${placeholders} copies of the channel placeholder; it must have exactly one.`);
    process.exit(1);
  }
  const wired = loader.replace(PLACEHOLDER, channel);
  if (wired.includes(PLACEHOLDER)) {
    console.error('✗ the channel placeholder survived substitution in loader.js.');
    process.exit(1);
  }
  fs.writeFileSync(path.join(SHELL_OUT, 'loader.js'), wired);

  // What the installed copy is, so the loader can tell whether anything it has
  // downloaded is newer. Small on purpose: it is read on every launch.
  fs.writeFileSync(
    path.join(SHELL_OUT, 'shipped.json'),
    JSON.stringify({ version: version(), builtAt, revision: revision() }, null, 2)
  );

  console.log(`✓ dist-desktop/  — shell assembled; updates follow ${channel || '(no channel configured)'}`);
  if (!channel) {
    console.log('  note          — cxTimeline.updateChannel is blank in package.json, so this');
    console.log('                  build will only ever run the copy inside the installer.');
  }

  if (withCalendar) {
    const origin = new URL(rc.url).origin;
    const csp = cspAllows(origin);
    if (!csp.ok) {
      console.error(`✗ the window's own policy would refuse ${origin}.`);
      console.error('  src-tauri/tauri.conf.json → app.security.csp → connect-src currently reads:');
      console.error(`    ${csp.why}`);
      console.error(`  Add ${origin} and ${origin.replace(/^https:/, 'wss:')} to it, then build again.`);
      console.error('  Refusing rather than shipping an installer whose calendar cannot connect —');
      console.error('  the window would open, sign in, and fail with a network error nobody can place.');
      process.exit(1);
    }
    console.log('✓ config.js      — the plan has no backend; the calendar has its own');
    console.log('✓ vendor/        — Supabase client shipped for the calendar only');
    if (!csp.named) {
      console.log(`  note          — the window policy allows ${origin} by wildcard. Naming the`);
      console.log('                  host in src-tauri/tauri.conf.json is tighter, and free.');
    }
    console.log('  reminder      — config.js and vendor/ ride in the INSTALLER, not in the');
    console.log('                  update payload, so an installed copy needs reinstalling once.');
  } else {
    console.log('✓ config.js      — no backend of any kind (RC_SUPABASE_URL is not set)');
    console.log('  note          — this build has no resource calendar. Set RC_SUPABASE_URL and');
    console.log('                  RC_SUPABASE_ANON_KEY to include it; the plan stays in a folder.');
  }
  return SHELL_OUT;
}

function main() {
  const at = process.argv.indexOf('--channel');
  const builtAt = new Date().toISOString();
  if (at !== -1) {
    const dir = process.argv[at + 1] || 'dist';
    writeChannel(path.resolve(ROOT, dir), builtAt);
    return;
  }
  assembleShell(builtAt);
}

const invokedDirectly =
  process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) main();
