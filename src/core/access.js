/**
 * The view that is the reader's alone: what somebody filtered, hid and
 * compared against, remembered for them and never written into the plan.
 *
 * Who may *edit* the plan is not decided here. It is the shared folder's pen
 * (`core/filestore.js`) and, beneath that, the folder's own sharing — a
 * read-only OneDrive share cannot write whatever this application believes.
 * The plan lock that once lived here, set from a calendar account's role, went
 * with the accounts.
 *
 * Imports: nothing (leaf).
 */

/**
 * Why this is here rather than in `core/storage.js` is structural:
 * `storage.js` imports `core/store.js`, so the store cannot import it back —
 * the build rejects the cycle outright. A leaf both of them can read is the
 * only place the answer can live.
 *
 * **Why it is the reader's rather than in the document.** The filter, the
 * filter mode and which baseline is being compared against were
 * `doc.settings`, which meant they travelled in the plan: one person narrowing
 * to their own subsystem narrowed it for everybody who opened the file next,
 * and turning a baseline on was an edit to a shared document. Worse, on the
 * read-only side it did not work at all — selecting a baseline was refused,
 * because the only way to record the choice was to write to a plan the reader
 * may not write to.
 *
 * So the *reading* is nobody's but the reader's. It is in localStorage, keyed
 * on the plan, which means it is per browser profile — the same limitation
 * every other browser-stored preference here has, and the honest one: the plan
 * is the one place it must not go.
 *
 * Every read and write is wrapped, because a private window, cleared site data
 * or a blocked third-party context makes localStorage throw rather than return
 * nothing. A view that cannot be remembered is a view that starts empty, which
 * is exactly how it behaved before any of this.
 */
const VIEW_PREFIX = 'cxtl.view.';

/* `anon` is where every view has always been kept: the key once carried a
   signed-in account, and no build has had one since. Kept, so nobody's
   remembered filters move. */
function viewKey(scope) {
  return `${VIEW_PREFIX}anon.${String(scope || 'plan')}`;
}

/** What this reader last looked at in this plan, or null. */
export function readView(scope) {
  try {
    const raw = localStorage.getItem(viewKey(scope));
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** Remember it. Best-effort by design — see above. */
export function writeView(scope, value) {
  try {
    localStorage.setItem(viewKey(scope), JSON.stringify(value));
  } catch {
    /* a view that cannot be remembered simply starts empty */
  }
}
