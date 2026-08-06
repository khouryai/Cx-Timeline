#!/usr/bin/env node
/**
 * CX Timeline — zero-dependency ES module bundler.
 *
 * Why this exists
 * ---------------
 * The application is authored as clean ES6 modules under `src/`, but it must
 * also launch by double-clicking `index.html` with no web server. Browsers
 * refuse to load `<script type="module">` over the `file://` protocol (module
 * resolution is subject to CORS, and `file://` origins are opaque), so a real
 * module graph cannot run directly from disk.
 *
 * This linker resolves the module graph ahead of time, topologically sorts it,
 * and emits one self-executing bundle (`app.bundle.js`) that runs anywhere —
 * `file://` included. The generated bundle is committed so the app works with
 * zero setup; rebuild with `npm run build` after editing anything in `src/`.
 *
 * Supported syntax (deliberately a strict subset, so the transform stays
 * simple and auditable — the whole codebase adheres to it):
 *
 *   import { a, b as c } from './x.js';
 *   import * as NS       from './x.js';
 *   export function f() {}
 *   export class C {}
 *   export const X = 1;
 *
 * Not supported (and rejected with a clear error):
 *   - `export default`
 *   - re-exports (`export ... from`)
 *   - `export let` / `export var` (would need live bindings)
 *   - circular imports (the layering is enforced, not worked around)
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const ENTRY = path.join(SRC, 'main.js');
const OUT = path.join(ROOT, 'app.bundle.js');
const CONFIG_OUT = path.join(ROOT, 'config.js');

const IMPORT_NAMED = /^\s*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/;
const IMPORT_NS = /^\s*import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]\s*;?\s*$/;
const IMPORT_BARE = /^\s*import\s*['"]([^'"]+)['"]\s*;?\s*$/;
const EXPORT_DECL = /^(\s*)export\s+(async\s+function\s*\*?|function\s*\*?|class|const)\s+([A-Za-z_$][\w$]*)/;

/** @typedef {{id:string, file:string, code:string, deps:string[], exports:string[]}} Module */

/** Turn an absolute source path into a stable, readable module id. */
function toId(file) {
  return path.relative(SRC, file).split(path.sep).join('/');
}

/**
 * Fold a multi-line `import { a, b, c } from '…'` onto a single line.
 *
 * The transform below is line-based — deliberately, because that keeps it
 * simple enough to read and verify. Long import lists are the one place the
 * codebase legitimately wraps, so they are normalised here first. Blank lines
 * are emitted in place of the folded ones so reported line numbers stay true.
 */
function collapseMultilineImports(source) {
  const lines = source.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // An import that opens a brace but does not close it on the same line.
    if (/^\s*import\s*\{[^}]*$/.test(line)) {
      const parts = [line.trim()];
      let j = i + 1;
      while (j < lines.length && !/from\s*['"][^'"]+['"]/.test(lines[j])) {
        parts.push(lines[j].trim());
        j++;
      }
      if (j < lines.length) {
        parts.push(lines[j].trim());
        out.push(parts.join(' ').replace(/\s+/g, ' '));
        for (let k = i; k < j; k++) out.push('');
        i = j;
        continue;
      }
    }
    out.push(line);
  }

  return out.join('\n');
}

/**
 * Parse one source file: strip import/export syntax, record dependencies and
 * exported names. Returns the rewritten body plus metadata.
 */
function parseModule(file) {
  const id = toId(file);
  const raw = collapseMultilineImports(fs.readFileSync(file, 'utf8'));
  const lines = raw.split(/\r?\n/);
  const deps = [];
  const exports = [];
  const out = [];

  const resolve = (spec) => {
    if (!spec.startsWith('.')) {
      throw new Error(`${id}: only relative imports are supported (got "${spec}")`);
    }
    const abs = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(abs)) throw new Error(`${id}: cannot resolve "${spec}"`);
    return toId(abs);
  };

  lines.forEach((line, i) => {
    const where = `${id}:${i + 1}`;

    if (/^\s*export\s+default\b/.test(line)) {
      throw new Error(`${where}: "export default" is not supported — use a named export.`);
    }
    if (/^\s*export\s+(let|var)\b/.test(line)) {
      throw new Error(`${where}: "export let/var" is not supported — exported bindings must be immutable.`);
    }
    if (/^\s*export\s*\{/.test(line) || /^\s*export\s+\*/.test(line)) {
      throw new Error(`${where}: re-exports are not supported — import and re-declare instead.`);
    }

    let m;
    if ((m = line.match(IMPORT_NAMED))) {
      const dep = resolve(m[2]);
      deps.push(dep);
      const bindings = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const parts = s.split(/\s+as\s+/);
          return parts.length === 2 ? `${parts[0].trim()}: ${parts[1].trim()}` : parts[0].trim();
        })
        .join(', ');
      out.push(`const { ${bindings} } = __req(${JSON.stringify(dep)});`);
      return;
    }
    if ((m = line.match(IMPORT_NS))) {
      const dep = resolve(m[2]);
      deps.push(dep);
      out.push(`const ${m[1]} = __req(${JSON.stringify(dep)});`);
      return;
    }
    if ((m = line.match(IMPORT_BARE))) {
      const dep = resolve(m[1]);
      deps.push(dep);
      out.push(`__req(${JSON.stringify(dep)});`);
      return;
    }
    if ((m = line.match(EXPORT_DECL))) {
      exports.push(m[3]);
      out.push(line.replace(/^(\s*)export\s+/, '$1'));
      return;
    }
    if (/^\s*export\b/.test(line)) {
      throw new Error(`${where}: unrecognised export form — ${line.trim()}`);
    }
    out.push(line);
  });

  return { id, file, code: out.join('\n'), deps: [...new Set(deps)], exports };
}

/** Walk the graph from the entry point, collecting every reachable module. */
function collect(entry) {
  const modules = new Map();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    const id = toId(file);
    if (modules.has(id)) continue;
    const mod = parseModule(file);
    modules.set(id, mod);
    for (const dep of mod.deps) stack.push(path.join(SRC, dep));
  }
  return modules;
}

/**
 * Topological sort with cycle detection. Cycles are a hard error: the module
 * layering (util → core → ui → timeline → app) is a design constraint, and a
 * cycle means a dependency is pointing the wrong way.
 */
function sort(modules) {
  const order = [];
  const state = new Map(); // id -> 'visiting' | 'done'
  const path_ = [];

  function visit(id) {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting') {
      const cycle = [...path_.slice(path_.indexOf(id)), id].join(' → ');
      throw new Error(`Circular import detected: ${cycle}\nBreak the cycle (usually via the event bus or store) rather than allowing it.`);
    }
    state.set(id, 'visiting');
    path_.push(id);
    for (const dep of modules.get(id).deps) visit(dep);
    path_.pop();
    state.set(id, 'done');
    order.push(id);
  }

  for (const id of modules.keys()) visit(id);
  return order;
}

function emit(modules, order, entryId) {
  const banner = [
    '/*!',
    ' * CX Timeline — Interactive Timeline & Commissioning Planner',
    ' *',
    ' * GENERATED FILE — do not edit by hand.',
    ' * Built from the ES modules in src/ by tools/build.js (`npm run build`).',
    ` * Modules: ${order.length}   Built: ${new Date().toISOString()}`,
    ' */',
  ].join('\n');

  const body = order
    .map((id) => {
      const mod = modules.get(id);
      const registrations = mod.exports
        .map((name) => `  Object.defineProperty(__x, ${JSON.stringify(name)}, { get: () => ${name}, enumerable: true });`)
        .join('\n');
      return [
        `// ${'═'.repeat(72)}`,
        `// ${id}`,
        `// ${'═'.repeat(72)}`,
        `__mods[${JSON.stringify(id)}] = function (__x, __req) {`,
        indent(mod.code),
        registrations,
        '};',
      ].join('\n');
    })
    .join('\n\n');

  return `${banner}
(function () {
  'use strict';

  var __mods = Object.create(null);
  var __cache = Object.create(null);

  function __req(id) {
    if (__cache[id]) return __cache[id];
    var exports = Object.create(null);
    __cache[id] = exports;
    var factory = __mods[id];
    if (!factory) throw new Error('CX Timeline: missing module "' + id + '"');
    factory(exports, __req);
    return exports;
  }

${body}

  __req(${JSON.stringify(entryId)});
})();
`;
}

function indent(code) {
  return code
    .split('\n')
    .map((l) => (l.trim() ? '  ' + l : l))
    .join('\n');
}

/**
 * Rewrite `config.js` from the environment.
 *
 * Cloudflare Pages (and any other CI) sets SUPABASE_URL / SUPABASE_ANON_KEY as
 * build variables, which keeps them out of the repository. When they are not
 * set the committed file is left exactly as it is, so a local `npm run build`
 * never clobbers hand-entered values — and a checkout with no backend at all
 * still builds and runs local-only.
 */
function writeConfig() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || '';
  if (!url && !key) return false;

  // Hosted deployments require an account. Opting out is possible but has to
  // be deliberate — the default must never be the weaker one.
  const requireAuth = !/^(0|false|no)$/i.test(process.env.CX_REQUIRE_AUTH || 'true');
  const source = fs.readFileSync(CONFIG_OUT, 'utf8');
  // Keep the file's documentation; replace only the literal it exports.
  const header = source.slice(0, source.indexOf('window.CX_CONFIG'));
  const body = `window.CX_CONFIG = ${JSON.stringify(
    { supabaseUrl: url, supabaseAnonKey: key, requireAuth },
    null,
    2
  )};\n`;
  fs.writeFileSync(CONFIG_OUT, header + body, 'utf8');
  console.log(`✓ config.js     — backend ${url ? new URL(url).host : '(none)'}`);
  return true;
}

function build() {
  const started = Date.now();
  writeConfig();
  const modules = collect(ENTRY);
  const order = sort(modules);
  const bundle = emit(modules, order, toId(ENTRY));
  fs.writeFileSync(OUT, bundle, 'utf8');
  const kb = (Buffer.byteLength(bundle) / 1024).toFixed(1);
  console.log(`✓ app.bundle.js — ${order.length} modules, ${kb} kB, ${Date.now() - started}ms`);
  return order;
}

function watch() {
  build();
  console.log('watching src/ …');
  let timer = null;
  fs.watch(SRC, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        build();
      } catch (err) {
        console.error('✗ ' + err.message);
      }
    }, 60);
  });
}

try {
  if (process.argv.includes('--watch')) watch();
  else build();
} catch (err) {
  console.error('✗ build failed: ' + err.message);
  process.exit(1);
}
