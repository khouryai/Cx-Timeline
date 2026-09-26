#!/usr/bin/env node
/**
 * Every suite, in parallel where that is safe — what `npm test` runs.
 *
 * The suites used to run one after another behind `&&`, which took long
 * enough that people ran one and hoped for the rest. They are independent
 * processes with independent browsers, so most can run side by side. What
 * cannot is written down here rather than discovered: suites that write the
 * same directory share a *lane* and run in order within it.
 *
 * Each suite's output is held and printed whole when it finishes, so two
 * suites never interleave line by line; a failure prints last, again, with
 * its tail, so it is on screen when the run ends.
 *
 *   node tools/run_tests.js                 every suite
 *   node tools/run_tests.js smoke test_sql  just these
 *   CX_TEST_JOBS=1 node tools/run_tests.js  one at a time
 */

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

/* A lane runs in order. Put two suites in one lane when they share state on
   disk or a fixed port. */
const LANES = [
  ['test_dist', 'smoke_desktop'], // both assemble dist-desktop/
  ['test_lookahead', 'test_folder_rules'],
  ['smoke'],
  ['smoke_folder'],
  ['smoke_hosted'],
  ['smoke_calendar'],
  ['test_sql'],
];

const wanted = process.argv.slice(2);
const lanes = LANES
  .map((lane) => lane.filter((name) => !wanted.length || wanted.includes(name)))
  .filter((lane) => lane.length);
const unknown = wanted.filter((name) => !LANES.flat().includes(name));
if (unknown.length) {
  console.error(`No such suite: ${unknown.join(', ')}. Suites: ${LANES.flat().join(', ')}`);
  process.exit(2);
}

// Browsers are the expensive part; more jobs than cores only slows them all.
const JOBS = Math.max(1, Number(process.env.CX_TEST_JOBS) || Math.min(4, os.cpus().length));

function run(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(ROOT, 'tools', `${name}.js`)], {
      cwd: ROOT,
      env: process.env,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code, signal) => {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const summary = out.match(/\d+\/\d+ checks passed[^\n]*/g)?.pop() || (code === 0 ? 'passed' : 'failed');
      process.stdout.write(`\n━━ ${name} ━━ ${code === 0 ? '✓' : '✗'} ${summary} (${secs}s)\n`);
      if (process.env.CX_TEST_VERBOSE || code !== 0) process.stdout.write(out);
      resolve({ name, ok: code === 0, code: code ?? signal, out, secs });
    });
  });
}

async function runLane(lane) {
  const results = [];
  for (const name of lane) results.push(await run(name));
  return results;
}

const queue = [...lanes];
const results = [];
const started = Date.now();
console.log(`Running ${lanes.flat().length} suite(s), ${JOBS} at a time`);
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  while (queue.length) results.push(...(await runLane(queue.shift())));
}));

const failed = results.filter((r) => !r.ok);
console.log(`\n${'═'.repeat(60)}`);
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(18)} ${r.secs.padStart(6)}s`);
console.log(`${results.length - failed.length}/${results.length} suites passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
for (const r of failed) {
  console.log(`\n✗ ${r.name} (exit ${r.code}) — last lines:`);
  console.log(r.out.trimEnd().split('\n').slice(-25).join('\n'));
}
process.exit(failed.length ? 1 : 0);
