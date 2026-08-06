#!/usr/bin/env node
/**
 * Run the permission-model tests against a throwaway PostgreSQL instance.
 *
 * The read-only role is a security control, so it gets tested like one: the
 * suite becomes each user in turn and checks that the database refuses what it
 * should. That cannot be proved by reading the policies — a policy that looks
 * right and a policy that works are different things, and the two bugs this
 * suite has already caught were both invisible on the page.
 *
 * Needs a local `postgres` (any version ≥ 14) on PATH or in /usr/lib/postgresql.
 * It never touches your Supabase project.
 *
 *   node tools/test_sql.js
 */

import { execFileSync, execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const PORT = process.env.CX_PGPORT || '5455';

/** PostgreSQL refuses to run as root, so an unprivileged user is needed. */
function pgUser() {
  if (process.getuid && process.getuid() !== 0) return null;
  for (const candidate of ['postgres', 'pgtest']) {
    try {
      execSync(`id -u ${candidate}`, { stdio: 'ignore' });
      return candidate;
    } catch {
      /* try the next one */
    }
  }
  try {
    execSync('adduser --disabled-password --gecos "" pgtest', { stdio: 'ignore' });
    return 'pgtest';
  } catch {
    throw new Error('running as root and could not create an unprivileged user for postgres');
  }
}

function binDir() {
  try {
    execSync('command -v initdb', { stdio: 'ignore' });
    return '';
  } catch {
    /* fall through to the packaged location */
  }
  const base = '/usr/lib/postgresql';
  if (fs.existsSync(base)) {
    const versions = fs.readdirSync(base).sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      const dir = path.join(base, v, 'bin');
      if (fs.existsSync(path.join(dir, 'initdb'))) return dir;
    }
  }
  throw new Error('no PostgreSQL server found — install postgresql to run the SQL tests');
}

function main() {
  const bin = binDir();
  const asUser = pgUser();
  const env = { ...process.env, PATH: bin ? `${bin}:${process.env.PATH}` : process.env.PATH };

  const home = asUser ? execSync(`getent passwd ${asUser} | cut -d: -f6`).toString().trim() : os.homedir();
  const dir = path.join(home, '.cx-timeline-sqltest');
  const data = path.join(dir, 'data');
  const run = path.join(dir, 'run');

  const sh = (cmd, opts = {}) =>
    execSync(asUser ? `su ${asUser} -s /bin/bash -c ${JSON.stringify(`PATH="${env.PATH}" ${cmd}`)}` : cmd, {
      stdio: 'pipe',
      env,
      ...opts,
    });

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(run, { recursive: true });
  if (asUser) execSync(`chown -R ${asUser} ${JSON.stringify(dir)}`);

  let started = false;
  try {
    sh(`initdb -D ${data} -U postgres --auth=trust`);
    sh(`pg_ctl -D ${data} -o '-k ${run} -p ${PORT} -c listen_addresses=' -l ${dir}/pg.log start -w`);
    started = true;

    const psql = (args) =>
      execFileSync(path.join(bin || '/usr/bin', 'psql'), ['-h', run, '-p', PORT, '-U', 'postgres', ...args], {
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

    psql(['-tAc', 'create database cxt']);
    const load = (file) =>
      psql(['-d', 'cxt', '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(ROOT, file)]);

    load('supabase/test/harness.sql');
    load('supabase/schema.sql');
    console.log('✓ schema.sql applies cleanly\n');

    // Every check reports through RAISE NOTICE, which psql writes to stderr;
    // stdout is only the empty result row of each `select assert(...)`. Run it
    // once and read both streams — the suite seeds accounts, so a second run
    // against the same database would collide on the first insert.
    const res = spawnSync(
      path.join(bin || '/usr/bin', 'psql'),
      ['-h', run, '-p', PORT, '-U', 'postgres', '-d', 'cxt', '-v', 'ON_ERROR_STOP=1',
       '-q', '-o', '/dev/null', '-f', path.join(ROOT, 'supabase/test/permissions.sql')],
      { env, encoding: 'utf8' }
    );
    process.stdout.write(
      (res.stderr || '').replace(/^psql:[^ ]* /gm, '').replace(/^NOTICE:  ?/gm, '')
    );
    if (res.status !== 0) throw new Error('a permission check failed');
    console.log('✓ every permission check passed');
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').toString();
    process.stdout.write(detail);
    console.error('\n✗ SQL tests failed');
    process.exitCode = 1;
  } finally {
    if (started) {
      try {
        sh(`pg_ctl -D ${data} -m immediate stop`);
      } catch {
        /* the instance is disposable either way */
      }
    }
  }
}

main();
