/**
 * The Resource Calendar backend.
 *
 * A second, entirely separate Supabase client from `core/cloud.js`, and the
 * separation is the feature rather than duplication.
 *
 * The timeline's plan is proprietary: it holds the P6 programme and it never
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
async function select(table, build) {
  requireClient();
  let query = client.from(table).select('*');
  if (build) query = build(query);
  const { data, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || [];
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
    'rc_people', 'rc_locations', 'rc_location_alias', 'rc_categories', 'rc_parties',
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

export function listActuals(fromISO, toISO) {
  return select('rc_actuals', (q) =>
    q.gte('work_date', fromISO).lte('work_date', toISO).order('work_date'));
}

/** Carried tasks, oldest first — a chain on its fifth day is the headline. */
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

export function listSnapshots({ limit = 50 } = {}) {
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
  const { data, error } = await client.from(table).insert(rows).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || [];
}

async function rpc(name, args) {
  requireClient();
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
export const addCategory = (row) => insert('rc_categories', [row]).then((r) => r[0]);
export const updateCategory = (id, patch) => update('rc_categories', id, patch);
export const addParty = (name) => insert('rc_parties', [{ name }]).then((r) => r[0]);
export const addLegend = (rows) => insert('rc_legend', rows);
export const updateLegend = (id, patch) => update('rc_legend', id, patch);

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

export const addLeave = (row) => insert('rc_leave', [row]).then((r) => r[0]);
export const updateLeave = (id, patch) => update('rc_leave', id, patch);

export const addPlanEntries = (rows) => insert('rc_plan_entries', rows);

/** Every look-ahead row for a week, so the plan can be proposed from it. */
export function lookaheadForWeek(weekStartISO) {
  return select('rc_lookahead_rows', (q) => q.eq('week_start', weekStartISO).order('sheet_row'));
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
  lookaheadRowId = null,
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

export async function sarUrl(path, seconds = 3600) {
  requireClient();
  const { data, error } = await client.storage.from('sars').createSignedUrl(path, seconds);
  if (error) throw new Error(`link: ${error.message}`);
  return data.signedUrl;
}
