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
 *
 * A folder deployment also carries `desktop/version.json` and
 * `desktop/payload.json` — the update channel the installed desktop application
 * checks on launch. That is why deploying the site is all it takes to update the
 * application on both people's laptops; see `tools/desktop.js`.
 */

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
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.cxTimeline?.deployment === 'folder' ? 'folder' : 'hosted';
  } catch {
    return 'hosted';
  }
}

const NO_BACKEND = deploymentShape() === 'folder';

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

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
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
    if (NO_BACKEND && dir === 'vendor') continue; // nothing in there is used
    const src = path.join(ROOT, dir);
    if (!fs.existsSync(src)) continue;
    copyDir(src, path.join(OUT, dir));
  }

  if (NO_BACKEND) {
    // Overwrite whatever `build.js` wrote from the environment. Leaving stale
    // Supabase variables set in CI must not be able to turn a folder
    // deployment back into a hosted one by accident.
    fs.writeFileSync(path.join(OUT, 'config.js'), BLANK_CONFIG);

    // The vendored client is loaded by a plain script tag, so dropping the file
    // without dropping the tag would log a 404 on every page load.
    const html = path.join(OUT, 'index.html');
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
    // With no backend there is nowhere legitimate to connect to, and the
    // application makes no network calls of its own. Narrow the policy to say
    // so, so the browser enforces it rather than us asserting it.
    const headers = path.join(OUT, '_headers');
    if (fs.existsSync(headers)) {
      const before = fs.readFileSync(headers, 'utf8');
      const after = before.replace(
        /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co/,
        "connect-src 'self'"
      );
      if (after === before) {
        console.error('✗ could not narrow connect-src in _headers — check the policy.');
        process.exit(1);
      }
      fs.writeFileSync(headers, after);
      console.log("✓ _headers      — connect-src narrowed to 'self'");
    }

    console.log('✓ config.js     — no backend; the plan lives in a folder the user picks');
    console.log('✓ index.html    — Supabase client not shipped');
    if (process.env.SUPABASE_URL) {
      console.log('  note          — SUPABASE_URL is set in this environment and was ignored;');
      console.log('                  package.json says this is a folder deployment.');
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
