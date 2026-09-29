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
 * and emits one self-executing bundle per entry point that runs anywhere —
 * `file://` included: `app.bundle.js` for the application, with the calendar
 * split off into `calendar.bundle.js` that it loads on first use, and
 * `mobile.bundle.js` for the phone app under `m/` (see `ENTRIES`). The
 * generated bundles are committed so the app works with zero setup; rebuild
 * with `npm run build` after editing anything in `src/`.
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
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
/*
 * The resource calendar, as a bundle the main one loads the first time somebody
 * opens it (`ui/calendar_loader.js`). Everything reachable from `ui/rc.js` that
 * the main bundle does not already carry goes in it, registering itself into
 * the main bundle's module table — so the two share one copy of every core
 * module and a person who only ever uses the timeline never downloads it.
 */
const CALENDAR_ENTRY = path.join(SRC, 'ui', 'rc.js');
const CALENDAR_OUT = path.join(ROOT, 'calendar.bundle.js');
const CONFIG_OUT = path.join(ROOT, 'config.js');

/**
 * The two applications this repository ships, and what each may contain.
 *
 * `app.bundle.js` is everything — the timeline, and the calendar through
 * `calendar.bundle.js`, which it loads on first use — and may import anything. `mobile.bundle.js` is the phone app under `m/`: the resource
 * calendar and nothing else. It is a second entry rather than a mode of the
 * first because what it must *not* contain is the point, and a bundle can only
 * be kept free of the timeline by never linking it in.
 *
 * `forbid` makes that structural. A module whose id matches is refused with the
 * chain of imports that reached it, so a helper that one day starts importing
 * the store fails the build instead of quietly putting the plan's storage path
 * — and the P6 project it reads — into a page that talks to Supabase. That is
 * the same guarantee `core/rc.js` states for the desktop build, made by the
 * linker rather than by a convention.
 */
const ENTRIES = [
  {
    entry: path.join(SRC, 'main.js'),
    out: path.join(ROOT, 'app.bundle.js'),
    title: 'CX Timeline — Interactive Timeline & Commissioning Planner',
    forbid: null,
    // Publishes its module table, and the calendar bundle is built against it.
    calendar: true,
  },
  {
    entry: path.join(SRC, 'mobile.js'),
    out: path.join(ROOT, 'mobile.bundle.js'),
    title: 'CX Calendar — the resource calendar, for a phone',
    forbid: new RegExp('^(?:'
      + [
        'main\\.js',
        // The timeline, whole.
        'timeline/',
        // The plan: its document, its history, its three storage backends.
        'core/(?:store|storage|filestore|cloud|desktop|model|history|analysis|query|access)\\.js',
        // Everything that reads or writes a plan file.
        'io/(?:exporters|importers|scene|svg|pdf|p6)\\.js',
        // The desktop interface's chrome and its calendar router, which
        // imports every tab and through them the folder.
        'ui/(?:shell|panels|inspector|commands|menus|shortcuts|theme|workspace|auth|p6|lookahead|rc)\\.js',
        'ui/rc_(?:lookahead|huddle|roster|reports|pto|week)\\.js',
      ].join('|')
      + ')'),
  },
];

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
      /* An empty binding is a typo, not an empty list.
         `import { a,, b }` is a syntax error in real JavaScript, and this
         linker used to `.filter(Boolean)` it away — so a source file that no
         browser and no `import()` could load bundled perfectly happily and
         shipped. A regex parser that is more forgiving than the language is a
         parser that hides exactly the mistakes it should catch. */
      const bindings = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s, i, all) => {
          if (s) return true;
          // A trailing comma before the brace is legal and idiomatic.
          if (i === all.length - 1) return false;
          throw new Error(`${where}: empty name in the import list — "{${m[1].trim()}}"`);
        })
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

/**
 * Walk the graph from the entry point, collecting every reachable module.
 *
 * With `forbid`, a module whose id matches is refused and the error names the
 * route to it — "mobile.js → mobile/week.js → ui/rc_week.js" says which import
 * to take out, where "ui/rc_week.js is not allowed" would leave somebody
 * searching for it.
 */
function collect(entry, forbid = null) {
  const modules = new Map();
  const via = new Map([[toId(entry), null]]);
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    const id = toId(file);
    if (modules.has(id)) continue;
    if (forbid && forbid.test(id)) {
      const chain = [];
      for (let at = id; at; at = via.get(at)) chain.unshift(at);
      throw new Error(`${chain[0]} may not contain ${id}\n  reached through: ${chain.join(' → ')}\n`
        + '  The phone app is the resource calendar alone; the timeline and the plan stay out of it.');
    }
    const mod = parseModule(file);
    modules.set(id, mod);
    for (const dep of mod.deps) {
      if (!via.has(dep)) via.set(dep, id);
      stack.push(path.join(SRC, dep));
    }
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

function emit(modules, order, entryId, title, { registry = false } = {}) {
  const banner = [
    '/*!',
    ` * ${title}`,
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

${registry ? `  /* The module table, for the calendar bundle to register into. It is loaded
     on first use and shares this bundle's copy of every module both need. */
  if (typeof window !== 'undefined') window.__CX_MODULES = { mods: __mods, req: __req };
` : ''}
  __req(${JSON.stringify(entryId)});
})();
`;
}

/** The calendar bundle: factories only, added to the main bundle's table. */
function emitCalendar(modules, ids) {
  const body = ids
    .map((id) => {
      const mod = modules.get(id);
      const registrations = mod.exports
        .map((name) => `  Object.defineProperty(__x, ${JSON.stringify(name)}, { get: () => ${name}, enumerable: true });`)
        .join('\n');
      return [`// ${id}`, `__mods[${JSON.stringify(id)}] = function (__x, __req) {`, indent(mod.code), registrations, '};']
        .join('\n');
    })
    .join('\n\n');
  return `/*!
 * CX Timeline — the resource calendar, loaded on first use.
 * GENERATED FILE — built by tools/build.js alongside app.bundle.js.
 * Modules: ${ids.length}   Built: ${new Date().toISOString()}
 */
(function () {
  'use strict';
  var registry = typeof window !== 'undefined' && window.__CX_MODULES;
  if (!registry) throw new Error('CX Timeline: calendar.bundle.js has to load after app.bundle.js');
  var __mods = registry.mods;

${body}
})();
`;
}

/**
 * Parse what was written, before anybody loads it.
 *
 * The linker is a line-based rewrite, and a mistake it carries through — an
 * object key renamed like a variable, say — produced a bundle the build
 * reported as fine and no browser could run: the page stayed blank with one
 * error in the console. `vm.Script` compiles without running, which is exactly
 * the check that was missing.
 */
function assertParses(code, file) {
  try {
    new vm.Script(code, { filename: file });
  } catch (err) {
    throw new Error(`${path.basename(file)} does not parse — ${err.message}. The module that produced it is named in the comment above the failing line.`);
  }
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
  writeConfig();
  const built = [];
  const orders = [];
  for (const { entry, out, title, forbid, calendar } of ENTRIES) {
    const started = Date.now();
    const modules = collect(entry, forbid);
    const order = sort(modules);
    const bundle = emit(modules, order, toId(entry), title, { registry: Boolean(calendar) });
    assertParses(bundle, out);
    built.push({ out, bundle, line: `${order.length} modules`, started });
    orders.push(order);
    if (!calendar) continue;

    /* Everything the calendar needs that the main bundle does not carry. The
       calendar's own entry must not be reachable from main — that would put it
       in both — which is what `ui/calendar_loader.js` is for. */
    if (modules.has(toId(CALENDAR_ENTRY))) {
      throw new Error('ui/rc.js is imported statically from the main bundle — load it through ui/calendar_loader.js');
    }
    const calendarModules = collect(CALENDAR_ENTRY);
    const calendarIds = sort(calendarModules).filter((id) => !modules.has(id));
    const code = emitCalendar(calendarModules, calendarIds);
    assertParses(code, CALENDAR_OUT);
    built.push({ out: CALENDAR_OUT, bundle: code, line: `${calendarIds.length} modules`, note: 'loaded on first use' });
    orders.push(calendarIds);
  }
  // Written only once every bundle parses, so a failed build leaves the last good set.
  for (const { out, bundle, line, started, note } of built) {
    fs.writeFileSync(out, bundle, 'utf8');
    const kb = (Buffer.byteLength(bundle) / 1024).toFixed(1);
    const name = path.basename(out);
    const tail = note || `${Date.now() - started}ms`;
    console.log(`✓ ${name}${' '.repeat(Math.max(1, 19 - name.length))}— ${line}, ${kb} kB, ${tail}`);
  }
  return orders;
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
