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

  /**
   * The Resource Calendar's backend — a *different* Supabase project from the
   * one above, and deliberately so.
   *
   * The two halves of this application hold different kinds of data. The plan
   * carries the P6 programme and is proprietary; in the deployment this was
   * built for it stays in a OneDrive folder and `supabaseUrl` above is left
   * blank forever. The resource calendar carries people, shifts and outcomes,
   * none of it proprietary, and goes to Postgres so the deputy and the team can
   * reach it from a browser.
   *
   * Filling these in does *not* give the timeline a backend. Nothing on the
   * plan's storage path reads them, nothing that reads the plan imports the
   * client they create, and `tools/smoke_calendar.js` proves it by editing the
   * plan and asserting that nothing carrying its content ever left. Leave them
   * blank and the Calendar workspace simply does not appear.
   */
  rcSupabaseUrl: '',
  rcSupabaseAnonKey: '',
};
