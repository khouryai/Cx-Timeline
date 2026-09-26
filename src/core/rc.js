/**
 * The Resource Calendar backend.
 *
 * A second, entirely separate Supabase client from `core/cloud.js`, and the
 * separation is the feature rather than duplication.
 *
 * The timeline's plan is proprietary: it holds the P6 project and it never
 * leaves its OneDrive folder. The resource calendar holds none of that, so it
 * lives in Postgres where the deputy and the team can reach it from a browser.
 * Until now that boundary was guaranteed by the *build* — `tools/desktop.js`
 * writes a blank config and `tools/dist.js --no-backend` strips the Supabase
 * client outright, so the desktop application had no backend at all and could
 * not have reached one. Putting a client back in the page reverses that, and a
 * promise that used to be structural would become a convention.
 *
 * So it is made structural again, three ways:
 *
 *   1. A different configuration key. `CX_CONFIG.supabaseUrl` stays blank
 *      forever and is the *plan's* backend; this module reads
 *      `CX_CONFIG.rcSupabaseUrl` and nothing else. Neither can be mistaken for
 *      the other.
 *   2. A different module. Nothing on the plan's storage path imports this
 *      file, and this file imports nothing that reads the plan — no store, no
 *      storage, no filestore. The build fails on import cycles, and the layer
 *      check in `tools/build.js` fails on a plan module reaching in here.
 *   3. A test that proves it. `tools/smoke_isolation.js` boots with this
 *      backend stubbed, edits the plan, and asserts that nothing carrying plan
 *      content ever left.
 *
 * There is no document here and no autosave. The plan is one JSON object saved
 * whole; this is rows, written one at a time, because the reports have to
 * answer arbitrary date ranges and two people have to edit at once.
 *
 * Imports: util, events.
 */

import { emit, EV } from './events.js';

/* ── Configuration ─────────────────────────────────────────────────────── */

function config() {
  return (typeof window !== 'undefined' && window.CX_CONFIG) || {};
}

/**
 * True when this build points at a resource-calendar backend.
 *
 * Deliberately *not* `cloud.isConfigured()`. A build can have this and not
 * that — which is exactly the shape the deployment wants: the plan in a
 * folder, the calendar in Postgres.
 */
export function isConfigured() {
  const { rcSupabaseUrl, rcSupabaseAnonKey } = config();
  return Boolean(rcSupabaseUrl && rcSupabaseAnonKey);
}

/* ── Private state ─────────────────────────────────────────────────────── */

let client = null;
let user = null;
let person = null;   // the caller's rc_people row, or null
let ready = false;

/* ── Lifecycle ─────────────────────────────────────────────────────────── */

/**
 * Create the client and restore any session.
 *
 * Never throws, and never blocks. The timeline has to open with no network at
 * all, so a backend that is unreachable degrades to "not signed in" and the
 * Resource Calendar simply says so when you switch to it.
 */
export async function init() {
  if (ready) return user;
  if (!isConfigured()) return null;

  const sdk = typeof window !== 'undefined' ? window.supabase : null;
  if (!sdk || typeof sdk.createClient !== 'function') {
    console.warn('[cx-timeline] the Supabase client did not load; the resource calendar is unavailable');
    return null;
  }

  const { rcSupabaseUrl, rcSupabaseAnonKey } = config();
  client = sdk.createClient(rcSupabaseUrl, rcSupabaseAnonKey, {
    // A storage key of its own. The plan's client, in a build that has one,
    // would otherwise share a session slot with this and the two would evict
    // each other on every reload.
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'cx-rc-auth',
    },
  });

  try {
    const { data } = await client.auth.getSession();
    user = data?.session?.user || null;
    if (user) await refreshPerson();
  } catch (err) {
    console.warn('[cx-timeline] could not restore the resource-calendar session:', err.message);
    user = null;
  }

  client.auth.onAuthStateChange((event, session) => {
    const next = session?.user || null;
    const changed = (next?.id || null) !== (user?.id || null);
    user = next;
    if (!next) person = null;
    if (changed) emit(EV.RC_AUTH_CHANGED, { user, event });
  });

  ready = true;

  // Restoring a session is a change of identity as much as signing in is, and
  // the shell has already drawn itself by now — what it shows depends on the
  // role, which only exists after this point. Without the event a returning
  // viewer would keep whichever chrome the anonymous boot decided on.
  if (user) emit(EV.RC_AUTH_CHANGED, { user, event: 'RESTORED' });
  return user;
}

export function raw() {
  return client;
}

export function currentUser() {
  return user;
}

export function isSignedIn() {
  return Boolean(user);
}

/**
 * The caller's own person row.
 *
 * Null is a real answer and not an error: an account with no `rc_people` row
 * is somebody who can sign in but is not on the team, and the database will
 * refuse their writes accordingly.
 */
export function me() {
  return person;
}

/**
 * True when the caller may see the KPI history and write the plan.
 *
 * This drives what the interface shows. It is *not* the control — every rule
 * is a row-level security policy, so a member who bypasses the interface
 * still gets nothing back from `rc_effort`. This exists to explain why
 * something is missing, not to decide it.
 */
export function isAdmin() {
  return person?.role === 'admin';
}

/** 'admin' | 'member' | 'viewer', or null for somebody not on the team. */
export function role() {
  return person?.role || null;
}

/**
 * True when this account may write anything at all.
 *
 * A viewer has a person row and `me()` finds it, so an id comparison alone
 * would let them record their own outcomes — which is the whole difference
 * between read-only and not. `rc_can_act_for()` makes the same distinction in
 * the database, and that is the control; this decides what to draw.
 */
export function canWrite() {
  return person?.role === 'admin' || person?.role === 'member';
}

export function isViewer() {
  return person?.role === 'viewer';
}

export function accountLabel() {
  if (person?.name) return person.name;
  if (!user) return '';
  return user.user_metadata?.full_name || user.email || 'Signed in';
}

async function refreshPerson() {
  // Runs on every sign-in and account change: same rule as sign-out.
  forgetReads();
  person = null;
  if (!client || !user) return null;
  const { data, error } = await client
    .from('rc_people')
    .select('id, name, email, title, subsystem, role, active')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();
  if (error) {
    console.warn('[cx-timeline] could not read your team record:', error.message);
    return null;
  }
  person = data || null;
  return person;
}

/* ── Account ───────────────────────────────────────────────────────────── */

export async function signIn(email, password) {
  requireClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: String(email || '').trim(),
    password,
  });
  if (error) throw friendlier(error);
  user = data.user;
  await refreshPerson();
  emit(EV.RC_AUTH_CHANGED, { user, event: 'SIGNED_IN' });
  return user;
}

/**
 * Create an account.
 *
 * The gate is `rc_enforce_invitation()` on `auth.users`, not this function:
 * sign-up goes through GoTrue rather than PostgREST, so anybody holding the
 * public key can POST to /auth/v1/signup and the interface has no say in it.
 * An address nobody invited is refused by the database, and what comes back
 * here is that refusal.
 *
 * Whether they are signed in afterwards depends on the project's "Confirm
 * email" setting, so the caller is told which happened rather than guessing.
 */
export async function signUp(email, password) {
  requireClient();
  const { data, error } = await client.auth.signUp({
    email: String(email || '').trim(),
    password,
  });
  if (error) throw friendlier(error);
  user = data.user || null;
  if (data.session) {
    await refreshPerson();
    emit(EV.RC_AUTH_CHANGED, { user, event: 'SIGNED_IN' });
  }
  return { user, live: Boolean(data.session) };
}

export async function signOut() {
  if (!client) return;
  // Whoever signs in next must not read this account's rows out of memory.
  // The database would refuse them; the cache must not answer first.
  forgetReads();
  await client.auth.signOut();
  user = null;
  person = null;
  emit(EV.RC_AUTH_CHANGED, { user: null, event: 'SIGNED_OUT' });
}

function requireClient() {
  if (!client) throw new Error('The resource calendar is not configured for this build.');
}

/** Supabase's wording is for developers; these messages are for people. */
function friendlier(error) {
  const message = String(error?.message || 'Something went wrong.');
  if (/invitation only/i.test(message)) {
    return new Error('That address has not been invited. Ask an administrator to invite you, '
      + 'then use the link they send.');
  }
  if (/already registered|user already exists/i.test(message)) {
    return new Error('That address already has an account — sign in instead.');
  }
  if (/password/i.test(message) && /least|short|weak/i.test(message)) {
    return new Error('That password is too short — six characters at least.');
  }
  if (/invalid login credentials/i.test(message)) return new Error('That email and password do not match an account.');
  if (/email not confirmed/i.test(message)) return new Error('Confirm your email address first — check your inbox.');
  if (/failed to fetch|networkerror/i.test(message)) {
    return new Error('Could not reach the server. The timeline still works offline; the resource calendar needs a connection.');
  }
  return new Error(message);
}

/* ── Reading ───────────────────────────────────────────────────────────── */

/**
 * Every read goes through here so a failure has one shape.
 *
 * A refused SELECT is not an error in PostgREST — the policy excludes the rows
 * and an empty list comes back — so callers must never read "no rows" as "no
 * permission". Where the difference matters, ask `isAdmin()`.
 */
/* ── The read cache ──────────────────────────────────────────────────────
   Every tab re-asks for the roster, the locations, the legend, the aliases and
   the categories, and every section inside the look-ahead re-asks for the
   snapshot. None of it changes between one click and the next, and the round
   trips were most of the wait between tabs. So a read is remembered for a short
   while, keyed on the table and everything the query asked for.

   Two things keep it honest. **Any write through this module empties it**, so
   what somebody just saved is what the next screen reads — the alternative,
   an outcome recorded and the meeting still showing the old one, is exactly the
   failure a huddle cannot afford. And the memory is short (`READ_TTL`), because
   two people edit this calendar at once and a colleague's write comes through
   nothing here; thirty seconds is a tab switch, not a shift. It is never longer
   than one page: a reload starts empty. */
const READ_TTL = 30000;
const reads = new Map();

function remember(key, fetch) {
  const held = reads.get(key);
  if (held && held.until > Date.now()) return held.promise;
  const promise = fetch().then(
    (rows) => rows,
    (err) => { reads.delete(key); throw err; }
  );
  reads.set(key, { promise, until: Date.now() + READ_TTL });
  return promise;
}

/** Forget every remembered read. Called by every write, and by whoever knows better. */
export function forgetReads() {
  reads.clear();
}

/**
 * The filters a query built, as text, so two identical questions share an
 * answer and two different ones never do. The builder is wrapped rather than
 * inspected: the client's own object does not describe itself, and the stub the
 * tests run against has nothing to inspect at all.
 */
function describe(build) {
  const parts = [];
  const proxy = new Proxy({}, {
    get: (_, method) => (...args) => { parts.push(`${String(method)}(${JSON.stringify(args)})`); return proxy; },
  });
  if (build) build(proxy);
  return parts.join('');
}

async function select(table, build, { columns = '*' } = {}) {
  requireClient();
  const key = `${table}|${columns}|${describe(build)}`;
  return remember(key, async () => {
    let query = client.from(table).select(columns);
    if (build) query = build(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    return data || [];
  });
}

/**
 * The team.
 *
 * `scheduledOnly` is what the huddle and the week plan ask for: the people who
 * actually take shifts. It is a separate question from what somebody may do —
 * a manager administers the calendar and is never assigned to a location, and
 * an administrator who *does* take shifts must not disappear from the meeting
 * because of their permissions.
 */
export function listPeople({ includeInactive = false, scheduledOnly = false } = {}) {
  return select('rc_people', (q) => {
    let out = includeInactive ? q : q.eq('active', true);
    if (scheduledOnly) out = out.eq('scheduled', true);
    return out.order('name');
  });
}

export function listLocations({ includeInactive = false } = {}) {
  return select('rc_locations', (q) => (includeInactive ? q : q.eq('active', true)).order('name'));
}

export function listLocationAliases() {
  return select('rc_location_alias', (q) => q.order('alias'));
}

/**
 * The other spellings of a person, for matching the look-ahead's Resource row.
 *
 * A name typed into a spreadsheet cell is "R. Okafor" one week and "Okafor" the
 * next. The register is what turns those into a person; a name it does not know
 * is shown as unmatched rather than guessed at, which is the same answer the
 * location aliases give and for the same reason.
 */
export function listPersonAliases() {
  return select('rc_person_alias', (q) => q.order('alias'));
}

export function listCategories({ includeInactive = false } = {}) {
  return select('rc_categories', (q) => (includeInactive ? q : q.eq('active', true)).order('sort'));
}

export function listParties() {
  return select('rc_parties', (q) => q.eq('active', true).order('name'));
}

/**
 * The legend the look-ahead's colours are read against.
 *
 * Versioned by `valid_from`, because a legend that changes must not silently
 * reinterpret every snapshot taken before it did. Newest first, so a caller
 * taking the first entry for a colour gets the one in force.
 */
export function listLegend({ includeInactive = false } = {}) {
  return select('rc_legend', (q) =>
    (includeInactive ? q : q.eq('active', true)).order('valid_from', { ascending: false }));
}

/**
 * Everything, as one object.
 *
 * The calendar's whole value is being the record a year from now, and until
 * this existed there was no way to get it out — a bad migration or a project
 * deleted by accident left the provider's point-in-time recovery and nothing
 * else. Read straight through the policies rather than around them, so what
 * comes back is what the person asking is allowed to see: an administrator
 * gets the evidence tables, a member gets the schedule.
 *
 * Tables only. The SAR PDFs are in Storage and are not folded in — they are
 * the one thing here that is already a file, and a hundred megabytes of base64
 * in a JSON document is not a backup anybody would successfully restore.
 */
export async function exportEverything() {
  requireClient();
  const tables = [
    'rc_people', 'rc_locations', 'rc_location_alias', 'rc_person_alias',
    'rc_categories', 'rc_parties',
    'rc_leave_kinds', 'rc_legend', 'rc_settings', 'rc_leave', 'rc_plan_entries',
    'rc_actuals', 'rc_ingest_runs', 'rc_lookahead_snapshots', 'rc_lookahead_rows',
    'rc_change_events', 'rc_change_annotations', 'rc_sars', 'rc_sar_links',
  ];

  const out = {
    exported_at: new Date().toISOString(),
    exported_by: person?.name || user?.email || null,
    note: 'Every rc_* table this account may read. SAR PDFs live in Storage and are not '
      + 'included; their storage_path is.',
    tables: {},
  };
  for (const table of tables) {
    // One at a time, and a table that refuses is recorded as refused rather
    // than silently absent — "empty" and "not allowed" must not look alike in
    // something somebody may restore from.
    try {
      out.tables[table] = await select(table);
    } catch (err) {
      out.tables[table] = { error: err.message };
    }
  }
  return out;
}

export function listSettings() {
  return select('rc_settings');
}

export function listLeaveKinds() {
  return select('rc_leave_kinds', (q) => q.eq('active', true).order('name'));
}

/** Leave overlapping a window. Both ends are inclusive, as a calendar is. */
/**
 * Leave awaiting an answer, whoever it belongs to.
 *
 * Its own read rather than a filter over `listLeave()`, because the question is
 * about the whole register and not about a window: a request for October made
 * today is a thing an administrator has to answer today, and a window that only
 * covers the weeks on screen would hide it until it was too late to matter.
 */
export function pendingLeave() {
  return select('rc_leave', (q) => q.eq('status', 'requested').order('start_date'));
}

export function listLeave(fromISO, toISO) {
  return select('rc_leave', (q) =>
    q.lte('start_date', toISO).gte('end_date', fromISO).neq('status', 'cancelled'));
}

/**
 * The current plan across a date range.
 *
 * Reads the view, never the table: the table keeps every revision, and asking
 * it directly would return the superseded rows alongside the live ones.
 */
export function listPlan(fromISO, toISO) {
  return select('rc_plan_current', (q) =>
    q.gte('work_date', fromISO).lte('work_date', toISO).order('work_date'));
}

/** Every revision of one day, oldest first — the audit trail for a claim. */
export function planHistory(personId, dateISO) {
  return select('rc_plan_entries', (q) =>
    q.eq('person_id', personId).eq('work_date', dateISO).order('created_at'));
}

/**
 * Outcomes, as they stand.
 *
 * The view, never the table: a corrected outcome is a new row pointing at the
 * old one, and the table keeps both. Reading it directly would put two answers
 * against one person for one day and let whichever came last win.
 */
export function listActuals(fromISO, toISO) {
  return select('rc_actuals_current', (q) =>
    q.gte('work_date', fromISO).lte('work_date', toISO).order('work_date'));
}

/** Carried tasks, oldest first — a chain on its fifth day is the headline. */
/**
 * Blockers, as they stand.
 *
 * The view, never the tables: the tables keep every step of the chase and the
 * view is what is true now. Readable by everybody signed in, because a blocker
 * nobody can see is one nobody chases.
 */
export function listBlockers({ openOnly = true } = {}) {
  return select('rc_blockers_current', (q) =>
    (openOnly ? q.eq('state', 'open') : q).order('raised_on'));
}

/** Every step of one blocker's history, oldest first. */
export function blockerHistory(blockerId) {
  return select('rc_blocker_updates', (q) =>
    q.eq('blocker_id', blockerId).order('created_at'));
}

export const raiseBlocker = (row) => insert('rc_blockers', [row]).then((r) => r[0]);
/* Append, never edit. Taking it on, moving the date, chasing it and closing it
   are each a row — the history is the evidence a claim is built from. */
export const updateBlocker = (row) => insert('rc_blocker_updates', [row]).then((r) => r[0]);

export function listCarryChains() {
  return select('rc_carry_chains', (q) => q.order('age_days', { ascending: false }));
}

/** The KPI base. Empty for a member, by policy rather than by omission. */
export function listEffort(fromISO, toISO) {
  return select('rc_effort', (q) =>
    q.gte('work_date', fromISO).lte('work_date', toISO).order('work_date'));
}

export function listIngestRuns({ limit = 100 } = {}) {
  return select('rc_ingest_runs', (q) => q.order('ran_at', { ascending: false }).limit(limit));
}

/**
 * The snapshots, newest first, **without their grids**.
 *
 * A grid is the whole parsed workbook and it is the one large column in the
 * schema. Every screen that reads the sheet used to ask for twenty of them and
 * use one; the history list asked for forty to print two numbers off each.
 * That was most of the wait between tabs. This reads the metadata view, which
 * carries those two numbers computed in the database, and the one grid
 * anybody actually draws comes from `latestSnapshot()`.
 */
export function listSnapshotMeta({ limit = 50 } = {}) {
  return select('rc_lookahead_snapshot_meta', (q) => q.order('taken_at', { ascending: false }).limit(limit));
}

/** The newest snapshot with its grid, or null. The only full-grid read there is. */
export function latestSnapshot() {
  return select('rc_lookahead_snapshots', (q) => q.order('taken_at', { ascending: false }).limit(1))
    .then((rows) => rows[0] || null);
}

/**
 * Snapshots with their grids. Kept for anything that genuinely needs several
 * — nothing in the interface does any more, and a caller reaching for this
 * with a limit above one should read `listSnapshotMeta()` instead.
 */
export function listSnapshots({ limit = 1 } = {}) {
  return select('rc_lookahead_snapshots', (q) => q.order('taken_at', { ascending: false }).limit(limit));
}

export function listSnapshotRows(snapshotId) {
  return select('rc_lookahead_rows', (q) => q.eq('snapshot_id', snapshotId).order('sheet_row'));
}

export function listChangeEvents(fromISO, toISO) {
  return select('rc_change_events', (q) =>
    q.gte('detected_at', fromISO).lte('detected_at', toISO).order('detected_at', { ascending: false }));
}

export function listAnnotations(eventIds) {
  return select('rc_change_annotations', (q) => q.in('change_event_id', eventIds).order('created_at'));
}

/**
 * Every day any read showed painted as a cancellation, from `fromISO` on.
 * One row per activity, location and day — `cancellationEvents()` in
 * `core/lookahead.js` joins side-by-side days into one event.
 */
export function listCancelledDays(fromISO) {
  return select('rc_cancelled_days', (q) => q.gte('day', fromISO).order('day'));
}

/** What somebody said about a cancellation, every version. Newest last. */
export function listCancellationNotes() {
  return select('rc_cancellation_notes', (q) => q.order('created_at'));
}

export function listSars() {
  return select('rc_sars', (q) => q.is('superseded_by', null).order('week_start', { ascending: false }));
}

export function listSarLinks() {
  return select('rc_sar_links', (q) => q.order('confirmed_at'));
}

/** Work planned into a week with no SAR — access that was never confirmed. */
export function listRowsWithoutSar() {
  return select('rc_rows_without_sar', (q) => q.order('week_start'));
}

/** The mirror: access booked for work that has since gone. */
export function listSarsWithoutRows() {
  return select('rc_sars_without_rows', (q) => q.order('week_start'));
}

/* ── Writing ───────────────────────────────────────────────────────────── */

/**
 * Insert rows and return them.
 *
 * A refused INSERT does raise — the WITH CHECK clause fails — so unlike an
 * UPDATE this one can be trusted to report its own failure. The append-only
 * tables have no UPDATE or DELETE privilege at all, so there is deliberately
 * no `update()` here for them to be reached through.
 */
async function insert(table, rows) {
  requireClient();
  forgetReads();
  const { data, error } = await client.from(table).insert(rows).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || [];
}

async function rpc(name, args) {
  requireClient();
  // Every function here that is not a pure read writes something, and the
  // reads are cheap; forgetting on all of them is simpler than a list that
  // has to be kept right.
  forgetReads();
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

/**
 * Update reference data.
 *
 * Only ever used on the vocabularies, never on a plan entry or an outcome. A
 * refused UPDATE matches nothing and reports success, so this checks the
 * returned row count and raises instead — the same reason every plan save goes
 * through `save_project()` on the other side of the application.
 */
async function update(table, id, patch) {
  requireClient();
  forgetReads();
  const { data, error } = await client.from(table).update(patch).eq('id', id).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  if (!data || !data.length) {
    throw new Error(`${table}: that change was refused — you may not have permission.`);
  }
  return data[0];
}

export const addPerson = (row) => insert('rc_people', [row]).then((r) => r[0]);
export const updatePerson = (id, patch) => update('rc_people', id, patch);
export const addLocation = (row) => insert('rc_locations', [row]).then((r) => r[0]);
export const updateLocation = (id, patch) => update('rc_locations', id, patch);
export const addLocationAlias = (locationId, alias) =>
  insert('rc_location_alias', [{ location_id: locationId, alias }]).then((r) => r[0]);
export const addPersonAlias = (personId, alias) =>
  insert('rc_person_alias', [{ person_id: personId, alias }]).then((r) => r[0]);
export const addCategory = (row) => insert('rc_categories', [row]).then((r) => r[0]);
export const updateCategory = (id, patch) => update('rc_categories', id, patch);
export const addParty = (name) => insert('rc_parties', [{ name }]).then((r) => r[0]);
/**
 * Map colours, or re-map them.
 *
 * An upsert on `(valid_from, argb)` rather than a plain insert, because that is
 * the table's unique key and mapping the same colour twice in one day is the
 * commonest thing anybody does here — press "Just shading" on a grey, look at
 * the calendar, decide it was actually a shift. As an insert the second attempt
 * violated the constraint and came back as a duplicate-key error, which reads as
 * a broken button rather than as "you already said something about that today".
 *
 * A colour mapped again on a *later* day still gets a row of its own: the
 * register is versioned on purpose, and `applyLegend()` reads the newest.
 */
export async function addLegend(rows) {
  requireClient();
  forgetReads();
  const { data, error } = await client
    .from('rc_legend')
    .upsert(rows, { onConflict: 'valid_from,argb' })
    .select();
  if (error) throw new Error(`rc_legend: ${error.message}`);
  return data || [];
}
export const updateLegend = (id, patch) => update('rc_legend', id, patch);

/**
 * Delete a reference row outright, where nothing has been recorded against it.
 *
 * Retiring is still the right answer for anything that has been used, and the
 * refusal says so by name. These exist for the row that was never meant: a
 * person added twice, a location typed wrong, a colour mapped by mistake —
 * which retiring only ever turns into a permanent entry in a list of things
 * that used to be true.
 *
 * Functions rather than `.delete()`, for the reason every other write here is a
 * function: a DELETE the policies refuse matches no rows and comes back as
 * success, so the interface would report a deletion that never happened. These
 * raise — over permission, over the last administrator, and over anything
 * pointing at the row — and `rpc()` turns that into a message somebody can act
 * on.
 */
export const deletePerson = (id) => rpc('rc_delete_person', { p_person: id });
export const deleteLocation = (id) => rpc('rc_delete_location', { p_location: id });
export const deleteCategory = (id) => rpc('rc_delete_category', { p_category: id });
export const deleteLegend = (id) => rpc('rc_delete_legend', { p_entry: id });

/**
 * Write a setting.
 *
 * An upsert rather than an update, because the first time anybody names the
 * sheet there is no row to update — and an UPDATE matching nothing would
 * report success and change nothing, which is the failure this whole schema is
 * arranged to avoid.
 */
export async function setSetting(key, value) {
  requireClient();
  forgetReads();
  const { data, error } = await client
    .from('rc_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select();
  if (error) throw new Error(`rc_settings: ${error.message}`);
  if (!data || !data.length) {
    throw new Error('rc_settings: that change was refused — only an administrator may set this.');
  }
  return data[0];
}

/**
 * Book leave, or ask for it.
 *
 * The status is the permission, and the policies are written on exactly that:
 * an administrator may insert any status and the default is `approved`, while a
 * member may insert `requested` for themselves and nothing else. So the caller
 * says which it is — `requestLeave()` below is the member's door, and it exists
 * so no screen has to remember to pass the right string.
 */
export const addLeave = (row) => insert('rc_leave', [row]).then((r) => r[0]);

/**
 * Ask for leave. The same single `rc_leave` row, as a question.
 *
 * A second table for requests would be a second answer to "is Dana off on
 * Tuesday", which is the thing this module is most careful about — so a request
 * is the row it will become, with `status` saying it has not been answered yet.
 * Approving it is an update an administrator makes; there is nothing to copy
 * across and nothing that can go missing in between.
 */
export const requestLeave = (row) =>
  insert('rc_leave', [{ ...row, status: 'requested' }]).then((r) => r[0]);
export const updateLeave = (id, patch) => update('rc_leave', id, patch);

export const addPlanEntries = (rows) => insert('rc_plan_entries', rows);

/** Every look-ahead row for a week, so the plan can be proposed from it. */
export function lookaheadForWeek(weekStartISO) {
  return select('rc_lookahead_rows', (q) => q.eq('week_start', weekStartISO).order('sheet_row'));
}

/**
 * Look-ahead rows across a span of weeks.
 *
 * The Resources view answers "where is everybody, for the weeks that matter",
 * which is several weeks at once — asking week by week would be one round trip
 * per column. Rows from every snapshot come back, so the caller keeps the newest
 * per `row_key`: an older snapshot's copy of a week is history, not a second
 * assignment.
 */
export function lookaheadBetween(fromISO, toISO) {
  return select('rc_lookahead_rows', (q) =>
    q.gte('week_start', fromISO).lte('week_start', toISO).order('sheet_row'));
}

/**
 * Revise a day. Returns the id of the new entry.
 *
 * Not an update: the outgoing row stays, and the new one points at it. A plan
 * that changed the evening before a shift is itself delay evidence, and there
 * is no way to spend it twice — revising an already-revised entry raises.
 */
export const supersedePlan = (entryId, { locationId = null, task = null, categoryId = null, shift = 'day' } = {}) =>
  rpc('rc_supersede_plan', {
    p_entry: entryId,
    p_location: locationId,
    p_task: task,
    p_category: categoryId,
    p_shift: shift,
  });

/**
 * Withdraw a day. Returns the id of the tombstone.
 *
 * "Delete my task" with the record kept, which is the only shape a delete takes
 * here: there is no DELETE grant on `rc_plan_entries`, so this writes a row
 * superseding the original and marked withdrawn, and `rc_plan_current` drops the
 * pair. The schedule stops showing the day; the table still says it was planned
 * and then withdrawn, by whom and when.
 *
 * Whoever may plan a day may withdraw it — a member their own, an administrator
 * anybody's — which is the same question the insert policy asks.
 */
export const withdrawPlan = (entryId) => rpc('rc_withdraw_plan', { p_entry: entryId });

/**
 * Move a day to the person the look-ahead now names. Returns the new entry's id.
 *
 * An administrator's: it writes a day against somebody else, which is the whole
 * point. Refuses a move onto the person who already has it, so a re-read that
 * changed nothing writes nothing — otherwise every ingest would supersede every
 * linked entry with a revision saying the same thing.
 */
export const reassignPlan = (entryId, personId) =>
  rpc('rc_reassign_plan', { p_entry: entryId, p_person: personId });

/**
 * Record one huddle outcome. Idempotent on `clientUuid`.
 *
 * That uuid is generated before the row is sent, which is what lets the huddle
 * screen queue entries locally and replay them when the connection returns.
 * The meeting is at a fixed time whether or not the network is up.
 */
export const recordActual = ({
  clientUuid, personId, date, status,
  categoryId = null, locationId = null, note = null,
  blockedReason = null, blockedPartyId = null,
  carryChainId = null, planEntryId = null, shift = 'day',
  lookaheadRowId = null, evidencePath = null, supersedesId = null,
}) =>
  rpc('rc_record_actual', {
    p_client_uuid: clientUuid,
    p_person: personId,
    p_date: date,
    p_status: status,
    p_category: categoryId,
    p_location: locationId,
    p_note: note,
    p_blocked_reason: blockedReason,
    p_blocked_party: blockedPartyId,
    p_carry_chain: carryChainId,
    p_plan_entry: planEntryId,
    p_shift: shift,
    p_lookahead_row: lookaheadRowId,
    p_evidence: evidencePath,
    // The outcome this one corrects. The function refuses a row that has
    // already been corrected, so two edits of one outcome cannot both land.
    p_supersedes: supersedesId,
  });

export const resolveLocation = (raw) => rpc('rc_resolve_location', { p_raw: raw });

export const addIngestRun = (row) => insert('rc_ingest_runs', [row]).then((r) => r[0]);
export const addSnapshot = (row) => insert('rc_lookahead_snapshots', [row]).then((r) => r[0]);
export const addSnapshotRows = (rows) => insert('rc_lookahead_rows', rows);
export const addChangeEvents = (rows) => insert('rc_change_events', rows);
export const addSar = (row) => insert('rc_sars', [row]).then((r) => r[0]);
/* Only ever to attach the storage path once the PDF is up. A SAR's terms are
   never edited — an amended one is a new revision that supersedes it, which is
   what `superseded_by` is for. */
export const updateSar = (id, patch) => update('rc_sars', id, patch);
export const addSarLinks = (rows) => insert('rc_sar_links', rows);

/**
 * Annotate a change event: who caused a cancellation, which removal and
 * addition were really one crew moving site.
 *
 * Insert only. Correcting one means adding another that supersedes it, because
 * this is the record a delay claim gets challenged on and a judgement that
 * could be quietly rewritten a year later would be worth nothing.
 */
export const addAnnotation = (row) => insert('rc_change_annotations', [row]).then((r) => r[0]);

/**
 * Record whose cancellation it was, and why. Append-only: a correction is a
 * new row carrying `supersedes_id`, never an edit.
 */
export const addCancellationNote = (row) => insert('rc_cancellation_notes', [row]).then((r) => r[0]);

/* ── Accounts ──────────────────────────────────────────────────────────── */

/**
 * Who may have an account, and what they may do with it.
 *
 * Supabase Auth still holds the password — `auth.uid()` is what every policy
 * in `rc_schema.sql` keys on, so the permission model *is* the authentication
 * and replacing it would mean rewriting all of it. What is managed from here
 * is the part that is genuinely ours: who is allowed to create an account at
 * all, which roster row it lands on, and what role it carries.
 *
 * Every one of these is a `security definer` function rather than a table
 * write, for the reason this whole schema is built on: a refused UPDATE
 * matches nothing and reports success, so an administrator demoting the last
 * administrator by accident would be told it worked.
 */
export const invite = (email, role = 'viewer', personId = null, note = null) =>
  rpc('rc_invite', {
    p_email: email,
    p_role: role,
    p_person: personId || null,
    p_note: note || null,
  }).then((rows) => (Array.isArray(rows) ? rows[0] : rows));

export const revokeInvitation = (email) => rpc('rc_revoke_invitation', { p_email: email });

export const listInvitations = () => rpc('rc_list_invitations').then((rows) => rows || []);

export const linkAccount = (personId, email) =>
  rpc('rc_link_account', { p_person: personId, p_email: email });

export const setRole = (personId, role) =>
  rpc('rc_set_role', { p_person: personId, p_role: role });

/**
 * Re-read your own team record.
 *
 * Changing a role changes what the interface may draw, and an administrator
 * who demotes themselves must see that immediately rather than at the next
 * sign-in — otherwise the page keeps offering actions the database has already
 * started refusing.
 */
export async function refreshMe() {
  await refreshPerson();
  emit(EV.RC_AUTH_CHANGED, { user, event: 'ROLE_CHANGED' });
  return person;
}

/* ── Storage ───────────────────────────────────────────────────────────── */

/**
 * Upload a SAR PDF so it opens in the deputy's browser.
 *
 * Only SARs. The look-ahead workbook is deliberately *not* uploaded: a .xlsx
 * carries every other tab, hidden row, comment and forgotten pasted sheet
 * along with the part that was wanted, and the only thing anyone needs from it
 * is the parsed grid, which goes up as JSON. The bytes stay in the OneDrive
 * archive.
 */
export async function uploadSar(path, blob) {
  requireClient();
  const { error } = await client.storage.from('sars').upload(path, blob, {
    upsert: false,
    contentType: blob?.type || 'application/pdf',
  });
  if (error) throw new Error(`upload: ${error.message}`);
  return path;
}

/**
 * Upload the photograph taken with an outcome.
 *
 * Before the row, never after: `rc_actuals` has no UPDATE grant, so a path
 * attached afterwards would need a second row superseding the first. The name
 * is the client uuid the outcome is about to be written with, which is
 * generated on the client precisely so it exists before the insert does.
 *
 * A failure here is not a failure of the meeting. The caller records the
 * outcome either way and says the picture did not go up — losing what somebody
 * said because a photograph did not upload would be the wrong way round.
 */
export async function uploadEvidence(path, blob) {
  requireClient();
  const { error } = await client.storage.from('evidence').upload(path, blob, {
    upsert: false,
    contentType: blob?.type || 'image/jpeg',
  });
  if (error) throw new Error(`upload: ${error.message}`);
  return path;
}

export async function evidenceUrl(path, seconds = 3600) {
  requireClient();
  const { data, error } = await client.storage.from('evidence').createSignedUrl(path, seconds);
  if (error) throw new Error(`link: ${error.message}`);
  return data.signedUrl;
}

export async function sarUrl(path, seconds = 3600) {
  requireClient();
  const { data, error } = await client.storage.from('sars').createSignedUrl(path, seconds);
  if (error) throw new Error(`link: ${error.message}`);
  return data.signedUrl;
}
