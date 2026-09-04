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
    console.log('✓ schema.sql applies cleanly');
    // The resource calendar is a separate module with its own tables and its
    // own two roles. It is applied second because it assumes `auth.users`,
    // which the timeline's schema is what sets up in the stub.
    load('supabase/rc_schema.sql');
    console.log('✓ rc_schema.sql applies cleanly');

    /* The upgrade path, tested against the thing it is for.
       A project created earlier in this application's life is missing every
       column added since — `create table if not exists` does nothing to a
       table that exists — and that is what "could not update the legend" is:
       the interface sends `role` and the register has no such column. So the
       schema is put back to that shape and then upgraded, which is the only
       way to know the file does its job. */
    load('supabase/migrate.sql');   // and again: it must never undo itself

    /* Every order somebody might apply these in, and none may end broken.

       This exists because one did. `migrate.sql` dropped the five account
       functions and left `rc_schema.sql` to recreate them, so running the file
       called "migrate" on its own — the obvious thing to do with a file called
       that — left a live project with no `rc_list_invitations` and an Accounts
       tab that died on "could not find the function in the schema cache". The
       suite never saw it because the suite only ever ran them in the order
       that works. */
    const accountFns = ['rc_invite', 'rc_list_invitations', 'rc_revoke_invitation',
      'rc_link_account', 'rc_set_role', 'rc_record_actual', 'rc_supersede_plan',
      'rc_resolve_location'];
    const functionsPresent = () => psql(['-d', 'cxt', '-tAc',
      `select count(distinct proname) from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in (${accountFns.map((f) => `'${f}'`).join(',')})`,
    ]).trim();

    /* The exact thing that happened: a project that is *working* has
       migrate.sql run on it, and nothing else. Every function it had before
       must still be there afterwards. */
    const before = functionsPresent();
    load('supabase/migrate.sql');
    if (functionsPresent() !== before) {
      throw new Error(
        `migrate.sql took a working project from ${before} to ${functionsPresent()} of the `
        + `${accountFns.length} functions the application calls — it must never drop what it `
        + 'does not recreate');
    }
    console.log('✓ migrate.sql on a working project removes nothing the application calls');

    load('supabase/test/downgrade.sql');
    load('supabase/migrate.sql');
    load('supabase/rc_schema.sql');
    if (functionsPresent() !== String(accountFns.length)) {
      throw new Error('rc_schema.sql did not restore every function after a downgrade');
    }
    // …and the other way round: the schema file alone, with no migrate, has to
    // converge too. It is the one people re-run when something looks wrong.
    load('supabase/rc_schema.sql');
    if (functionsPresent() !== String(accountFns.length)) {
      throw new Error('rc_schema.sql is not safe to apply twice');
    }
    console.log('✓ rc_schema.sql converges on its own, and applying it twice is safe');

    /* Whatever the application calls, the schema must define. The names are
       read out of `core/rc.js` rather than typed here, so adding an `rpc()`
       without the SQL to back it fails this suite instead of a screen in
       front of somebody. */
    const client = fs.readFileSync(path.join(ROOT, 'src/core/rc.js'), 'utf8');
    const called = [...new Set([...client.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]))];
    const defined = psql(['-d', 'cxt', '-tAc',
      `select string_agg(distinct p.proname, ',') from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'rc\\_%'`,
    ]).trim().split(',');
    const orphans = called.filter((fn) => !defined.includes(fn));
    if (orphans.length) {
      throw new Error(`the application calls functions the schema does not define: ${orphans.join(', ')}`);
    }
    console.log(`✓ all ${called.length} functions core/rc.js calls exist in the schema`);

    /* The same for tables and views. A missing one reads as an empty screen
       rather than an error, which is worse. */
    const tables = [...new Set([...client.matchAll(/(?:from|select|insert|update|del)\('(rc_[a-z_]+)'/g)]
      .map((m) => m[1]))];
    const present = psql(['-d', 'cxt', '-tAc',
      "select string_agg(table_name, ',') from information_schema.tables where table_schema='public'",
    ]).trim().split(',');
    const missingTables = tables.filter((t) => !present.includes(t));
    if (missingTables.length) {
      throw new Error(`the application reads tables the schema does not define: ${missingTables.join(', ')}`);
    }
    console.log(`✓ all ${tables.length} tables and views core/rc.js reads exist in the schema`);

    const upgraded = psql(['-d', 'cxt', '-tAc', `
      select
        (select count(*) from information_schema.columns
          where table_schema='public' and table_name='rc_legend' and column_name='role')
      + (select count(*) from information_schema.columns
          where table_schema='public' and table_name='rc_people' and column_name='scheduled')
      + (case when to_regclass('public.rc_settings')    is null then 0 else 1 end)
      + (case when to_regclass('public.rc_invitations') is null then 0 else 1 end)
      + (select count(*) from pg_constraint
          where conname='rc_people_role_check' and pg_get_constraintdef(oid) like '%viewer%')
      + (select count(*) from information_schema.columns
          where table_schema='public' and table_name='rc_plan_entries' and column_name='carry_chain_id')
      + (select count(*) from information_schema.columns
          where table_schema='public' and table_name='rc_actuals' and column_name='lookahead_row_id')`]).trim();
    if (upgraded !== '7') {
      throw new Error(`migrate.sql left an old project incomplete (${upgraded}/7 pieces)`);
    }
    console.log('✓ migrate.sql upgrades a project built before any of this, and is safe twice\n');

    // Every check reports through RAISE NOTICE, which psql writes to stderr;
    // stdout is only the empty result row of each `select assert(...)`. Run it
    // once and read both streams — the suite seeds accounts, so a second run
    // against the same database would collide on the first insert.
    const suite = (file) => {
      const res = spawnSync(
        path.join(bin || '/usr/bin', 'psql'),
        ['-h', run, '-p', PORT, '-U', 'postgres', '-d', 'cxt', '-v', 'ON_ERROR_STOP=1',
         '-q', '-o', '/dev/null', '-f', path.join(ROOT, file)],
        { env, encoding: 'utf8' }
      );
      process.stdout.write(
        (res.stderr || '').replace(/^psql:[^ ]* /gm, '').replace(/^NOTICE:  ?/gm, '')
      );
      if (res.status !== 0) throw new Error(`a permission check failed in ${file}`);
    };

    // Each suite seeds its own accounts, so it can only be run once against a
    // given database — a second pass would collide on the first insert. The
    // resource calendar suite runs second and reuses the accounts the first
    // one created, which is also why it cannot be run on its own.
    suite('supabase/test/permissions.sql');
    suite('supabase/test/rc_permissions.sql');
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
