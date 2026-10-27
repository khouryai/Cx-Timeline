#!/usr/bin/env node
/**
 * Assemble the desktop shell into `dist-desktop/`, and the update kit that
 * feeds it into a directory of its own.
 *
 *   node tools/desktop.js                 # dist-desktop/ — what the installer contains
 *   node tools/desktop.js --kit dist-kit  # dist-kit/ — what the desktop-kit branch holds
 *
 * Run after `npm run build`, or use `npm run build:desktop`, which does both.
 *
 * Two directories, one payload
 * ----------------------------
 * `dist-desktop/` is the frontend Tauri bundles into the installer: the real
 * `index.html`, the stylesheets, both bundles in one script, and `loader.js` in
 * place of the bundle's own script tag. That copy is what a first launch — or
 * a launch with no network — runs.
 *
 * The kit is two files: `version.json`, which the loader checks on every
 * launch, and `payload.json`, which it only downloads when the version is
 * genuinely newer. `.github/workflows/kit.yml` writes them to the repository's
 * `desktop-kit` branch once Checks passes on the default branch, and the
 * loader reads that branch through raw.githubusercontent.com — so a push to the
 * default branch updates every installed copy, with nobody reinstalling.
 *
 * `builtAt` is what orders the two copies, and it is a plain ISO timestamp
 * rather than a hash of the contents. That is deliberate: the question the
 * loader asks is not "are these different" but "is the channel ahead of what I
 * have", and a kit is always built after the installer it is compared with.
 * Comparing hashes would answer a question nobody asked and would happily roll
 * a machine *backwards* onto an older kit.
 *
 * `SHELL` is what the Rust side provides. Raise it when the application starts
 * calling a command an older installer lacks: a kit carries it as
 * `requiresShell`, and an installer with less never runs that kit — it says a
 * new installer is needed instead.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SHELL_OUT = path.join(ROOT, 'dist-desktop');

/**
 * The Rust commands this source needs. 2: the calendar's text files
 * (`data_read`, `data_stat`, `data_write`) — the calendar in the folder.
 */
export const SHELL = 2;

/** What `loader.js` carries until a channel is substituted into it. */
const PLACEHOLDER = '__CHANNEL__';

/** Loaded in this order by `index.html`, so concatenated in this order too. */
const STYLES = ['tokens.css', 'base.css', 'components.css', 'layout.css', 'timeline.css', 'notes.css', 'calendar.css', 'rc.css'];

/** The only host the window may fetch from, as the CSP names it. */
const CHANNEL_HOST = 'https://raw.githubusercontent.com';

function packageJson() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** Where the installed application looks for updates. */
export function updateChannel() {
  return (packageJson().cxTimeline?.updateChannel || '').replace(/\/+$/, '');
}

function version() {
  return packageJson().version || '0.0.0';
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
 * Whether the window's own policy lets the loader reach the channel.
 *
 * The policy is in `src-tauri/tauri.conf.json`, which is committed and read by
 * cargo, so this checks the two agree — because the failure it prevents is
 * silent: everything builds, the window opens, and the update check is refused
 * by the webview with an error nobody sees.
 */
function cspAllows(channel) {
  let csp = '';
  try {
    csp = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'))?.app?.security?.csp || '';
  } catch {
    return { ok: false, connect: 'src-tauri/tauri.conf.json could not be read' };
  }
  const connect = ((/connect-src ([^;]*)/.exec(csp) || [])[1] || '').trim();
  const sources = connect.split(/\s+/);
  return { ok: sources.includes(new URL(channel).origin), connect };
}

/**
 * The application as one script: the main bundle, then the calendar's.
 *
 * The calendar's factories register into the main bundle's table as it runs,
 * so `ui/calendar_loader.js` finds the calendar already there and fetches
 * nothing — a desktop window has no site to fetch it from.
 */
function desktopBundle() {
  for (const name of ['app.bundle.js', 'calendar.bundle.js']) {
    if (!fs.existsSync(path.join(ROOT, name))) {
      console.error(`✗ ${name} is missing — run \`npm run build\` first.`);
      process.exit(1);
    }
  }
  return `${fs.readFileSync(path.join(ROOT, 'app.bundle.js'), 'utf8')}\n${fs.readFileSync(path.join(ROOT, 'calendar.bundle.js'), 'utf8')}`;
}

/**
 * One release, as the loader consumes it: the application's code and styles as
 * text, with enough about itself to be ordered against another copy.
 */
export function buildPayload(builtAt = new Date().toISOString()) {
  const css = STYLES.map((name) => {
    const file = path.join(ROOT, 'css', name);
    if (!fs.existsSync(file)) {
      console.error(`✗ css/${name} is missing — check the STYLES list in tools/desktop.js.`);
      process.exit(1);
    }
    return `/* css/${name} */\n${fs.readFileSync(file, 'utf8')}`;
  }).join('\n');
  return { version: version(), builtAt, revision: revision(), requiresShell: SHELL, css, bundle: desktopBundle() };
}

/** Write the kit the loader polls: `version.json` and `payload.json`. */
export function writeKit(dir, builtAt = new Date().toISOString()) {
  const payload = buildPayload(builtAt);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'version.json'),
    JSON.stringify({ version: payload.version, builtAt: payload.builtAt, revision: payload.revision, requiresShell: SHELL }, null, 2)
  );
  fs.writeFileSync(path.join(dir, 'payload.json'), JSON.stringify(payload));
  const kb = (fs.statSync(path.join(dir, 'payload.json')).size / 1024).toFixed(0);
  console.log(`✓ ${path.relative(ROOT, dir) || dir}/  — version.json + payload.json (${kb} kB), needs shell ${SHELL}`);
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
function shellHtml(channel) {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // The stylesheets stay as files — they are the installed copy's styles — but
  // are marked so `loader.js` can take them off the page when it has newer ones.
  const marked = html.replace(
    /<link rel="stylesheet" href="css\/([a-z]+\.css)" \/>/g,
    '<link rel="stylesheet" href="css/$1" data-shell="shipped" />'
  );
  if (marked === html) fail('could not mark the stylesheet links');
  html = marked;

  /* The calendar's sheet comes with its bundle in a browser; the shell's one
     script carries the calendar from the start, so the sheet is linked here,
     after calendar.css, which is the order a browser ends up with. */
  const calendarLink = '<link rel="stylesheet" href="css/calendar.css" data-shell="shipped" />';
  if (!html.includes(calendarLink)) fail('could not find the calendar stylesheet link');
  html = html.replace(calendarLink, `${calendarLink}\n    <link rel="stylesheet" href="css/rc.css" data-shell="shipped" />`);

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
  if (channel && !channel.startsWith(`${CHANNEL_HOST}/`)) {
    console.error(`✗ cxTimeline.updateChannel must be on ${CHANNEL_HOST}, the one host the window may fetch from; it is ${channel}.`);
    process.exit(1);
  }
  if (channel) {
    const csp = cspAllows(channel);
    if (!csp.ok) {
      console.error(`✗ the window's own policy would refuse ${new URL(channel).origin}.`);
      console.error(`  src-tauri/tauri.conf.json → app.security.csp → connect-src reads: ${csp.connect}`);
      process.exit(1);
    }
  }

  fs.rmSync(SHELL_OUT, { recursive: true, force: true });
  fs.mkdirSync(SHELL_OUT, { recursive: true });
  fs.writeFileSync(path.join(SHELL_OUT, 'index.html'), shellHtml(channel));
  fs.writeFileSync(path.join(SHELL_OUT, 'app.bundle.js'), desktopBundle());
  copyDir(path.join(ROOT, 'css'), path.join(SHELL_OUT, 'css'));

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
  // downloaded is newer, and whether it can run it. Read on every launch.
  fs.writeFileSync(
    path.join(SHELL_OUT, 'shipped.json'),
    JSON.stringify({ version: version(), builtAt, revision: revision(), shell: SHELL }, null, 2)
  );

  console.log(`✓ dist-desktop/  — shell ${SHELL} assembled; updates follow ${channel || '(no channel configured)'}`);
  if (!channel) {
    console.log('  note          — cxTimeline.updateChannel is blank in package.json, so this');
    console.log('                  build will only ever run the copy inside the installer.');
  }
  return SHELL_OUT;
}

function main() {
  const at = process.argv.indexOf('--kit');
  const builtAt = new Date().toISOString();
  if (at !== -1) {
    writeKit(path.resolve(ROOT, process.argv[at + 1] || 'dist-kit'), builtAt);
    return;
  }
  assembleShell(builtAt);
}

const invokedDirectly =
  process.argv[1] && url.pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) main();
