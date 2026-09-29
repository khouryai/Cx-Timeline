#!/usr/bin/env node
/**
 * The shared folder's pure rules — names, digests, whose turn the pen is.
 *
 * `smoke_folder.js` covers these through a browser and a fake folder; this
 * covers them directly, in Node, in a fraction of a second, including the edge
 * cases no browser run would ever reach. `src-tauri/src/plan.rs` makes the same
 * readings in Rust, and the cases below are the ones its tests hold it to — a
 * disagreement between the two is the desktop and the browser each believing a
 * different person holds the pen.
 *
 *   node tools/test_folder_rules.js
 */

import {
  STALE_MS, basename, lockNameFor, isLockFile, claimNameFor, isClaimFor, isLockLitter,
  fingerprint, hash64, parseClaim, penHolder, isStale, isConflictCopy,
} from '../src/core/folder_rules.js';

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  const line = `${name}${detail ? ` — ${detail}` : ''}`;
  if (ok) {
    passed++;
    console.log(`  ✓ ${line}`);
  } else {
    failures.push(line);
    console.log(`  ✗ ${line}`);
  }
}

console.log('\nNames');
check('basename takes the last segment of either separator', basename('C:\\Plans\\a\\plan.json') === 'plan.json' && basename('/x/y/plan.json') === 'plan.json');
check('lockNameFor strips .json once', lockNameFor('Plan.json') === 'Plan.lock.json' && lockNameFor('Plan') === 'Plan.lock.json');
for (const name of ['plan.lock.json', 'plan.lock-HRUSPITLT02820.json', 'plan.lock-2.json', 'plan.lock (1).json', 'plan.pen-abc.json', 'PLAN.LOCK.JSON']) {
  check(`${name} is a lock file`, isLockFile(name));
}
for (const name of ['lockheed.json', 'plan.json', 'plan.lock.xlsx', 'penalty.json', 'plan.lockdown.json']) {
  check(`${name} is not a lock file`, !isLockFile(name));
}
check('a claim name drops characters that are not safe in a file name',
  claimNameFor('Plan.json', 'dev/ice:1') === 'Plan.pen-device1.json');
check('isClaimFor matches this plan\'s claims whatever the case', isClaimFor('Plan.json', 'plan.PEN-x.json'));
check('isClaimFor refuses another plan\'s claims', !isClaimFor('Plan.json', 'Other.pen-x.json'));
check('a copy of the old lock is litter', isLockLitter('plan.lock-HRUSPITLT02820.json') && isLockLitter('plan.lock (2).json'));
check('the lock itself is not litter — somebody may hold it', !isLockLitter('plan.lock.json'));
check('a claim file is not litter — it is somebody\'s turn', !isLockLitter('plan.pen-abc.json'));

console.log('\nConflict copies');
for (const name of ['Four-Week Look-Ahead-HRUSPITLT02820.xlsx', 'plan-2.json', 'report-12.pdf']) {
  check(`${name} is a conflict copy`, isConflictCopy(name));
}
for (const name of ['Four-Week Look-Ahead.xlsx', 'plan.json', 'cable-pull.xlsx', 'plan-2026.json', 'site-hruspitlt02820.xlsx']) {
  check(`${name} is not a conflict copy`, !isConflictCopy(name));
}

console.log('\nDigests');
const doc = { name: 'Plan', objects: [{ id: 'a' }], exported: { at: '2026-09-01T10:00:00Z' } };
const same = { ...doc, exported: { at: '2026-09-26T16:30:00Z' } };
check('the save time does not change the digest', fingerprint(JSON.stringify(doc)) === fingerprint(JSON.stringify(same)));
check('a change to the plan does', fingerprint(JSON.stringify(doc)) !== fingerprint(JSON.stringify({ ...doc, name: 'Plan 2' })));
check('a half-written file answers null, not a version', fingerprint('{"name":"Pla') === null);
check('empty and non-object answer null', fingerprint('') === null && fingerprint('42') === null && fingerprint(null) === null);
check('hash64 is sixteen hex digits', /^[0-9a-f]{16}$/.test(hash64('x')));
check('hash64 is stable', hash64('commissioning') === hash64('commissioning'));
check('hash64 tells a transposition apart', hash64('ab') !== hash64('ba'));

console.log('\nClaims');
check('parseClaim reads an object', parseClaim('{"id":"s1"}')?.id === 's1');
check('parseClaim refuses truncated text, null and empty',
  parseClaim('{"id"') === null && parseClaim('') === null && parseClaim('null') === null);

const now = 1_800_000_000_000;
const claim = (over) => ({ id: over.device, beat: now - 1000, since: now - 60000, ...over });
check('a claim that has not beaten for STALE_MS is stale', isStale({ beat: now - STALE_MS - 1 }, now));
check('one within STALE_MS is live', !isStale({ beat: now - STALE_MS + 1 }, now));
check('a claim with no beat is stale', isStale({}, now) && isStale(null, now));

check('nobody holds the pen when every claim is stale',
  penHolder([claim({ device: 'a', beat: now - STALE_MS - 5 })], now) === null);
check('the earliest live claim holds it',
  penHolder([claim({ device: 'b', since: now - 10 }), claim({ device: 'a', since: now - 500 })], now).device === 'a');
check('opening later can never take the pen',
  penHolder([claim({ device: 'late', since: now }), claim({ device: 'first', since: now - 1 })], now).device === 'first');
check('a takeover outranks an earlier claim',
  penHolder([claim({ device: 'a', since: now - 500 }), claim({ device: 'b', since: now, takeover: now - 5 })], now).device === 'b');
check('the latest takeover wins',
  penHolder([claim({ device: 'a', takeover: now - 50 }), claim({ device: 'b', takeover: now - 5 })], now).device === 'b');
check('an exact tie is broken by device id, the same way on every machine', (() => {
  const x = claim({ device: 'zeta', since: now - 5 });
  const y = claim({ device: 'alpha', since: now - 5 });
  return penHolder([x, y], now).device === 'alpha' && penHolder([y, x], now).device === 'alpha';
})());
check('a stale earlier claim does not hold it over a live later one',
  penHolder([claim({ device: 'gone', since: now - 9e6, beat: now - STALE_MS - 1 }), claim({ device: 'here' })], now).device === 'here');

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
