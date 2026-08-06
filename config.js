/**
 * Deployment configuration.
 *
 * This file is loaded before the application bundle and is the *only* place
 * that knows where the backend lives. Leave it blank and CX Timeline runs
 * exactly as it always has: local-first, browser storage, no account, works by
 * double-clicking index.html. Fill it in and the application boots behind a
 * sign-in screen and keeps projects, backups and permissions in Postgres.
 *
 * Two ways to set it:
 *
 *   1. Paste the values below (fine for a local build or a private repo).
 *   2. Set SUPABASE_URL and SUPABASE_ANON_KEY as environment variables —
 *      `npm run build` rewrites this file from them. That is what Cloudflare
 *      Pages does, and it keeps the keys out of the repository.
 *
 * The anon key is *designed* to be public: it identifies the project, it does
 * not grant access. Every row is protected by row-level security tied to the
 * signed-in user, so a stolen anon key on its own can read nothing.
 */
window.CX_CONFIG = {
  /** e.g. 'https://abcdefghijklm.supabase.co'. Blank = local dev mode. */
  supabaseUrl: '',

  /** The project's anon / publishable key. */
  supabaseAnonKey: '',

  /**
   * Require an account. On by default: a hosted deployment has no business
   * offering an anonymous, unshareable copy of someone's programme plan.
   */
  requireAuth: true,
};
