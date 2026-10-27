#!/usr/bin/env node
/**
 * The desktop build's two outputs, checked without a browser: the shell the
 * installer carries, and the kit the `desktop-kit` branch serves to every
 * installed copy.
 *
 *   node tools/test_kit.js
 *
 * What it decides that nothing else does: that the shell follows the channel
 * the workflow writes to, that the window's policy lets it fetch from there and
 * from nowhere else, that the kit is a whole application which says which
 * installer it needs, that every command the application calls is one the
 * Rust side registers — and that nothing in the repository talks to a server.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const { SHELL } = await import(path.join(ROOT, 'tools/desktop.js'));

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const pkg = JSON.parse(read('package.json'));
const channel = pkg.cxTimeline?.updateChannel || '';

console.log('\nThe channel');
check('installed copies follow the desktop-kit branch on raw.githubusercontent.com',
  /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/desktop-kit$/.test(channel), channel);
const workflow = exists('.github/workflows/kit.yml') ? read('.github/workflows/kit.yml') : '';
check('and the workflow that writes that branch exists', workflow.length > 0);
check('it publishes only after Checks passes, from the default branch',
  /workflow_run:/.test(workflow) && /workflows: \[?'?Checks'?\]?/.test(workflow)
    && /conclusion == 'success'/.test(workflow) && /claude\/timeline-planner-app-y1t1nm/.test(workflow));
check('with the kit tools/desktop.js writes, to the branch the channel names',
  /tools\/desktop\.js --kit/.test(workflow) && workflow.includes('desktop-kit'));

console.log('\nThe window');
const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
const csp = conf.app?.security?.csp || '';
const connect = ((/connect-src ([^;]*)/.exec(csp) || [])[1] || '').trim().split(/\s+/);
check('the window may fetch from itself, the shell and the channel — and nothing else',
  JSON.stringify(connect) === JSON.stringify(["'self'", 'ipc:', 'http://ipc.localhost', 'https://raw.githubusercontent.com']),
  connect.join(' '));
check('no script is allowed inline', /script-src 'self' blob:;/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp));

console.log('\nThe shell');
const out = execFileSync('node', [path.join(ROOT, 'tools/desktop.js')], { cwd: ROOT, encoding: 'utf8' });
check('it assembles', /dist-desktop\//.test(out), out.trim());
const shellFile = (rel) => fs.readFileSync(path.join(ROOT, 'dist-desktop', rel), 'utf8');
const html = shellFile('index.html');
check('the page runs the loader, not the bundle', /<script src="loader\.js"><\/script>/.test(html) && !/<script src="app\.bundle\.js">/.test(html));
check('and links the calendar\'s stylesheet after the main page\'s',
  html.indexOf('css/rc.css') > html.indexOf('css/calendar.css') && html.indexOf('css/calendar.css') > 0);
check('it carries no configuration, no client and no phone redirect',
  !fs.existsSync(path.join(ROOT, 'dist-desktop', 'config.js')) && !fs.existsSync(path.join(ROOT, 'dist-desktop', 'vendor'))
    && !/config\.js|phone\.js|supabase/i.test(html));
const loader = shellFile('loader.js');
check('the loader follows the channel', loader.includes(`var CHANNEL = '${channel}';`) && !loader.includes('__CHANNEL__'));
const shipped = JSON.parse(shellFile('shipped.json'));
check('and the installer says which shell it is', shipped.shell === SHELL && Boolean(shipped.builtAt), JSON.stringify(shipped));

console.log('\nThe kit');
const kitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-kit-'));
execFileSync('node', [path.join(ROOT, 'tools/desktop.js'), '--kit', kitDir], { cwd: ROOT, stdio: 'pipe' });
const version = JSON.parse(fs.readFileSync(path.join(kitDir, 'version.json'), 'utf8'));
const payload = JSON.parse(fs.readFileSync(path.join(kitDir, 'payload.json'), 'utf8'));
check('version.json is small and says what it is', fs.statSync(path.join(kitDir, 'version.json')).size < 1024
  && version.version === pkg.version && Boolean(version.builtAt));
check('and which installer it needs', version.requiresShell === SHELL && payload.requiresShell === SHELL);
check('the payload is the same release', payload.builtAt === version.builtAt && payload.version === version.version);
let parses = true;
try {
  new vm.Script(payload.bundle, { filename: 'payload.bundle.js' });
} catch (err) {
  parses = String(err.message);
}
check('its script parses', parses === true, String(parses));
check('and carries the calendar, so nothing is fetched when it opens',
  payload.bundle.includes('__mods["ui/rc.js"]') && payload.bundle.includes('__mods["core/rc_db.js"]'));
check('its styles carry every sheet, the calendar\'s last',
  ['tokens', 'base', 'components', 'layout', 'timeline', 'notes', 'calendar', 'rc'].every((n) => payload.css.includes(`/* css/${n}.css */`))
    && payload.css.lastIndexOf('/* css/rc.css */') > payload.css.lastIndexOf('/* css/calendar.css */'));
check('it is big enough that the loader takes it for a release', payload.bundle.length > 50000 && payload.css.length > 2000);
fs.rmSync(kitDir, { recursive: true, force: true });

console.log('\nThe Rust side');
const mainRs = read('src-tauri/src/main.rs');
const handler = (/generate_handler!\[([\s\S]*?)\]/.exec(mainRs) || [])[1] || '';
const registered = new Set(handler.split(',').map((s) => s.trim()).filter(Boolean));
const called = [...new Set([...read('src/core/desktop.js').matchAll(/call\('([a-z_]+)'/g)].map((m) => m[1]))];
const missing = called.filter((c) => !registered.has(c));
check('every command the application calls is registered', called.length > 10 && !missing.length, missing.join(', '));
check('the calendar\'s text files are among them', ['data_read', 'data_stat', 'data_write'].every((c) => registered.has(c)));

console.log('\nNo server');
check('the repository holds no database schema, client or site configuration',
  !exists('supabase') && !exists('vendor/supabase.js') && !exists('config.js') && !exists('wrangler.jsonc')
    && !exists('_headers') && !exists('sw.js') && !exists('m') && !exists('.github/workflows/deploy.yml'));
const sources = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel);
    else if (rel.endsWith('.js')) sources.push(rel);
  }
};
walk('src');
const talking = sources.filter((f) => /\bfetch\(|XMLHttpRequest|WebSocket\(|createClient\(/.test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
check('nothing in src/ makes a network request', !talking.length, talking.join(', '));
const bundles = ['app.bundle.js', 'calendar.bundle.js'];
check('two bundles, and no phone app\'s', bundles.every(exists) && !exists('mobile.bundle.js'));

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
