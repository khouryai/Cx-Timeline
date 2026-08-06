/**
 * The hosted backend.
 *
 * This module is the *only* one that knows Supabase exists. Everything above
 * it — storage, the panels, the sharing dialog — talks to the functions here
 * and would keep working against a different backend if one ever replaced it.
 *
 * It is inert unless `config.js` names a project. With no configuration
 * `isConfigured()` returns false, nothing here is ever called, and CX Timeline
 * behaves exactly as it always has: local-first, no account, works by
 * double-clicking index.html.
 *
 * On permissions
 * --------------
 * The role returned by `getRole()` drives the read-only UI, but it is not the
 * control. Every rule is enforced by row-level security in Postgres, so a
 * viewer who bypasses the interface entirely is still refused by the database.
 * The role here exists to explain *why* something is disabled, not to decide
 * it.
 *
 * On saving
 * ---------
 * Writes go through the `save_project` function rather than a plain UPDATE,
 * for two reasons. A row hidden by row-level security is not an error — the
 * statement simply matches nothing and reports success — so a plain UPDATE
 * would let a viewer believe their work was saved. And the function carries an
 * optimistic revision check, so two people editing one plan get told about the
 * collision instead of quietly overwriting each other.
 *
 * Imports: util, events.
 */

import { emit, EV } from './events.js';

/* ── Configuration ─────────────────────────────────────────────────────── */

function config() {
  return (typeof window !== 'undefined' && window.CX_CONFIG) || {};
}

/** True when this build points at a backend. */
export function isConfigured() {
  const { supabaseUrl, supabaseAnonKey } = config();
  return Boolean(supabaseUrl && supabaseAnonKey);
}

/** True when an account is required even if the backend cannot be reached. */
export function authRequired() {
  return Boolean(config().requireAuth);
}

/* ── Private state ─────────────────────────────────────────────────────── */

let client = null;
let user = null;
let projectId = null;
let projectRev = 0;
let role = null; // 'owner' | 'editor' | 'viewer' | null
let ready = false;

/* ── Lifecycle ─────────────────────────────────────────────────────────── */

/**
 * Create the client and restore any existing session.
 * Resolves to the signed-in user, or null. Never throws: a backend that is
 * down must degrade to "not signed in", not to a blank page.
 */
export async function init() {
  if (ready) return user;
  if (!isConfigured()) return null;

  const sdk = typeof window !== 'undefined' ? window.supabase : null;
  if (!sdk || typeof sdk.createClient !== 'function') {
    console.warn('[cx-timeline] the Supabase client did not load; running local-only');
    return null;
  }

  const { supabaseUrl, supabaseAnonKey } = config();
  client = sdk.createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  try {
    const { data } = await client.auth.getSession();
    user = data?.session?.user || null;
  } catch (err) {
    console.warn('[cx-timeline] could not restore the session:', err.message);
    user = null;
  }

  // A refresh token that expires while the tab is open, or a sign-out in
  // another tab, must not leave a stale identity behind.
  client.auth.onAuthStateChange((event, session) => {
    const next = session?.user || null;
    const changed = (next?.id || null) !== (user?.id || null);
    user = next;
    if (!next) forgetProject();
    if (changed) emit(EV.AUTH_CHANGED, { user, event });
  });

  ready = true;
  return user;
}

/** The client, for the rare caller that needs it. Null when not configured. */
export function raw() {
  return client;
}

/* ── Accounts ──────────────────────────────────────────────────────────── */

export function currentUser() {
  return user;
}

export function isSignedIn() {
  return Boolean(user);
}

/** A short label for the account menu. */
export function accountLabel() {
  if (!user) return '';
  return user.user_metadata?.full_name || user.email || 'Signed in';
}

export async function signIn(email, password) {
  requireClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: String(email || '').trim(),
    password,
  });
  if (error) throw friendlier(error);
  user = data.user;
  emit(EV.AUTH_CHANGED, { user, event: 'SIGNED_IN' });
  return user;
}

/**
 * Create an account.
 *
 * Whether the user is signed in straight away depends on the project's email
 * confirmation setting, so the caller is told which happened rather than
 * having to guess from whether a session appeared.
 */
export async function signUp(email, password, fullName = '') {
  requireClient();
  const { data, error } = await client.auth.signUp({
    email: String(email || '').trim(),
    password,
    options: { data: fullName ? { full_name: fullName } : {} },
  });
  if (error) throw friendlier(error);

  if (data.session) {
    user = data.user;
    emit(EV.AUTH_CHANGED, { user, event: 'SIGNED_IN' });
    return { user, confirmationRequired: false };
  }
  return { user: data.user, confirmationRequired: true };
}

export async function signOut() {
  if (!client) return;
  await client.auth.signOut();
  user = null;
  forgetProject();
  emit(EV.AUTH_CHANGED, { user: null, event: 'SIGNED_OUT' });
}

export async function sendPasswordReset(email) {
  requireClient();
  const { error } = await client.auth.resetPasswordForEmail(String(email || '').trim(), {
    redirectTo: window.location.origin + window.location.pathname,
  });
  if (error) throw friendlier(error);
}

export async function updatePassword(password) {
  requireClient();
  const { error } = await client.auth.updateUser({ password });
  if (error) throw friendlier(error);
}

/* ── The open project, and what you may do to it ───────────────────────── */

export function getProjectId() {
  return projectId;
}

export function getRev() {
  return projectRev;
}

/** 'owner' | 'editor' | 'viewer' | null (nothing open, or local-only). */
export function getRole() {
  return role;
}

export function canWrite() {
  return role === 'owner' || role === 'editor';
}

export function isOwner() {
  return role === 'owner';
}

/**
 * True when the open project must not be modified.
 *
 * Deliberately false when no project is open or the app is running
 * local-only — read-only is a property of *this* project, not a default.
 */
export function isReadOnly() {
  return Boolean(projectId) && !canWrite();
}

function setAccess(id, nextRole, rev) {
  const changed = id !== projectId || nextRole !== role;
  projectId = id;
  role = nextRole;
  projectRev = rev ?? 0;
  if (changed) emit(EV.ACCESS_CHANGED, { projectId, role, readOnly: isReadOnly() });
}

function forgetProject() {
  if (projectId || role) setAccess(null, null, 0);
}

/* ── Projects ──────────────────────────────────────────────────────────── */

/** Every project the signed-in user can reach, newest first, with their role. */
export async function listProjects() {
  const rows = await rpc('list_my_projects');
  return (rows || []).map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    objects: r.object_count,
    rev: Number(r.rev),
    savedAt: new Date(r.updated_at).getTime(),
    createdAt: new Date(r.created_at).getTime(),
    ownerEmail: r.owner_email,
    members: r.member_count,
  }));
}

/** Create a project from a document and open it. Returns its id. */
export async function createProject(doc) {
  requireUser();
  const { data, error } = await client
    .from('projects')
    .insert({
      owner_id: user.id,
      name: doc?.name || 'Untitled Programme',
      doc,
      object_count: (doc?.objects || []).length,
    })
    .select('id, rev')
    .single();
  if (error) throw friendlier(error);

  setAccess(data.id, 'owner', Number(data.rev));
  return data.id;
}

/** Open a project. Returns the document, or null when it is not reachable. */
export async function openProject(id) {
  const { data, error } = await client
    .from('projects')
    .select('id, doc, rev, name')
    .eq('id', id)
    .maybeSingle();
  if (error) throw friendlier(error);
  if (!data) {
    forgetProject();
    return null;
  }

  const theirRole = await rpc('project_role', { p_project: id });
  setAccess(data.id, theirRole || 'viewer', Number(data.rev));
  return data.doc;
}

/**
 * Save the open project.
 *
 * Returns `{ ok, rev }` on success. A collision resolves to
 * `{ ok: false, conflict: true }` rather than throwing, because the caller —
 * autosave — has to keep running either way.
 */
export async function saveProject(doc, { force = false } = {}) {
  if (!projectId) return { ok: false, reason: 'no-project' };
  if (!canWrite()) return { ok: false, reason: 'read-only' };

  const { data, error } = await client.rpc('save_project', {
    p_project: projectId,
    p_doc: doc,
    p_rev: force ? 0 : projectRev,
  });

  if (error) {
    if (isConflict(error)) {
      emit(EV.CLOUD_CONFLICT, { projectId });
      return { ok: false, conflict: true, reason: 'conflict' };
    }
    if (isDenied(error)) {
      setAccess(projectId, 'viewer', projectRev);
      return { ok: false, reason: 'read-only' };
    }
    throw friendlier(error);
  }

  projectRev = Number(data);
  return { ok: true, rev: projectRev };
}

export async function renameProject(id, name) {
  const { data, error } = await client
    .from('projects')
    .update({ name })
    .eq('id', id)
    .select('id');
  if (error) throw friendlier(error);
  // A row excluded by row-level security is not an error — it just matches
  // nothing — so an empty result is how a refused rename presents itself.
  if (!data || !data.length) throw new Error('You do not have permission to rename this project.');
}

export async function deleteProject(id) {
  const { data, error } = await client.from('projects').delete().eq('id', id).select('id');
  if (error) throw friendlier(error);
  if (!data || !data.length) throw new Error('Only the owner can delete a project.');
  if (id === projectId) forgetProject();
}

/* ── Sharing ───────────────────────────────────────────────────────────── */

export async function listMembers(id = projectId) {
  if (!id) return [];
  const rows = await rpc('list_project_members', { p_project: id });
  return (rows || []).map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.full_name,
    role: r.role,
    since: new Date(r.created_at).getTime(),
    isYou: r.user_id === user?.id,
  }));
}

/** Grant someone access by email address. Owners only. */
export async function shareProject(id, email, memberRole) {
  const rows = await rpc('share_project', {
    p_project: id,
    p_email: email,
    p_role: memberRole,
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return { userId: row?.member_id, email: row?.member_email, role: row?.member_role };
}

export async function unshareProject(id, userId) {
  await rpc('unshare_project', { p_project: id, p_user: userId });
  if (userId === user?.id && id === projectId) forgetProject();
}

/** Change an existing member's role. Owners only. */
export async function setMemberRole(id, email, memberRole) {
  return shareProject(id, email, memberRole);
}

/* ── Backups ───────────────────────────────────────────────────────────── */

export async function listBackups(id = projectId) {
  if (!id) return [];
  const { data, error } = await client
    .from('project_backups')
    .select('id, reason, name, object_count, size_bytes, created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false });
  if (error) throw friendlier(error);
  return (data || []).map((b) => ({
    key: b.id,
    time: new Date(b.created_at).getTime(),
    reason: b.reason,
    name: b.name,
    objects: b.object_count,
    size: b.size_bytes,
  }));
}

export async function createBackup(doc, reason = 'manual') {
  if (!projectId || !canWrite()) return false;
  let size = 0;
  try {
    size = JSON.stringify(doc).length;
  } catch {
    /* an unserialisable document would have failed to save already */
  }
  const { error } = await client.from('project_backups').insert({
    project_id: projectId,
    doc,
    reason,
    name: doc?.name || null,
    object_count: (doc?.objects || []).length,
    size_bytes: size,
  });
  if (error) {
    if (isDenied(error)) return false;
    throw friendlier(error);
  }
  return true;
}

export async function loadBackup(key) {
  const { data, error } = await client
    .from('project_backups')
    .select('doc')
    .eq('id', key)
    .maybeSingle();
  if (error) throw friendlier(error);
  return data?.doc || null;
}

export async function deleteBackup(key) {
  const { data, error } = await client.from('project_backups').delete().eq('id', key).select('id');
  if (error) throw friendlier(error);
  if (!data || !data.length) throw new Error('Only the owner can delete a backup.');
}

export async function pruneBackups(keep = 20) {
  if (!projectId || !canWrite()) return 0;
  try {
    return Number(await rpc('prune_backups', { p_project: projectId, p_keep: keep })) || 0;
  } catch {
    return 0;
  }
}

/* ── Attachments ───────────────────────────────────────────────────────── */

const BUCKET = 'attachments';

/**
 * Attachment bytes live in object storage, keyed `<project>/<id>`, exactly as
 * they live outside the document locally — so a plan carrying 40 MB of test
 * logs still saves in milliseconds. The first path segment is what the storage
 * policies read to decide access.
 */
function blobPath(id) {
  return `${projectId}/${id}`;
}

export async function putBlob(id, file) {
  if (!projectId) throw new Error('No project is open.');
  if (!canWrite()) throw new Error('This project is read-only.');
  const { error } = await client.storage.from(BUCKET).upload(blobPath(id), file, {
    upsert: true,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) throw friendlier(error);
  return { id, name: file.name, type: file.type, size: file.size };
}

export async function getBlob(id) {
  if (!projectId) return null;
  const { data, error } = await client.storage.from(BUCKET).download(blobPath(id));
  if (error) return null;
  return data;
}

export async function deleteBlob(id) {
  if (!projectId || !canWrite()) return;
  await client.storage.from(BUCKET).remove([blobPath(id)]);
}

/* ── Plumbing ──────────────────────────────────────────────────────────── */

function requireClient() {
  if (!client) throw new Error('This build is not connected to a backend.');
}

function requireUser() {
  requireClient();
  if (!user) throw new Error('You need to be signed in.');
}

async function rpc(name, args = {}) {
  requireClient();
  const { data, error } = await client.rpc(name, args);
  if (error) throw friendlier(error);
  return data;
}

/** Postgres raises 40001 for a revision collision; see save_project. */
function isConflict(error) {
  return error?.code === '40001' || /conflict:/i.test(error?.message || '');
}

/** 42501 is insufficient_privilege — the read-only refusal. */
function isDenied(error) {
  return (
    error?.code === '42501' ||
    error?.code === 'PGRST301' ||
    /read only|permission|policy/i.test(error?.message || '')
  );
}

/**
 * Turn a backend error into something worth showing a person.
 *
 * Supabase messages are written for developers; these are the handful a user
 * can actually act on, and the rest are passed through rather than swallowed.
 */
function friendlier(error) {
  const message = error?.message || String(error);
  const map = [
    [/invalid login credentials/i, 'That email and password do not match an account.'],
    [/email not confirmed/i, 'Check your inbox and confirm your email address first.'],
    [/user already registered/i, 'There is already an account with that email — sign in instead.'],
    [/password should be at least (\d+)/i, 'Pick a longer password — at least $1 characters.'],
    [/rate limit|too many requests/i, 'Too many attempts. Wait a minute and try again.'],
    [/failed to fetch|networkerror/i, 'Cannot reach the server. Check your connection.'],
    [/only the owner/i, 'Only the project owner can do that.'],
    [/no account for/i, message.replace(/^.*?no account for/i, 'No account for')],
    [/must keep at least one owner/i, 'A project has to keep at least one owner.'],
    [/read only/i, 'This project is read-only for you.'],
  ];
  for (const [pattern, replacement] of map) {
    if (pattern.test(message)) {
      const out = new Error(message.replace(pattern, replacement));
      out.code = error?.code;
      return out;
    }
  }
  const out = new Error(message);
  out.code = error?.code;
  return out;
}
