/**
 * Who this session is allowed to be, as far as the *plan* is concerned.
 *
 * One boolean and a reason, in a leaf, because two modules that must never see
 * each other both have to read it.
 *
 * The plan's edit gate lives in `core/store.js` — "a read-only session refuses
 * edits at the store, not only in the CSS" — and the pen lives in
 * `core/filestore.js`. The fact that decides it, on a calendar deployment, is
 * the account's role in the *resource calendar*, which `core/rc.js` knows. But
 * `core/rc.js` is the calendar's own Supabase client and the plan's storage path
 * must never import it: that separation is what keeps proprietary plan data from
 * ever reaching a backend, and it is enforced rather than intended.
 *
 * So nothing here imports anything and nothing here decides anything. A module
 * that *may* see both — `main.js` — reads the role and states it, and the two
 * modules that must not see the calendar read the statement instead. That is the
 * same shape as `setDateOrder()` and `syncDurationBasis()`: a preference pushed
 * down into a leaf, because a leaf cannot reach up for it.
 *
 * **Absent is editable.** A build with no calendar, local mode, and every test
 * suite never call `lockPlan()` at all, so the lock is off and the timeline
 * behaves exactly as it always has. Read-only is a thing somebody is told, never
 * a default.
 *
 * Imports: nothing (leaf).
 */

/** Why the plan is read-only for this session, or '' when it is not. */
let locked = '';

/**
 * State that the signed-in account may not edit the plan at all.
 *
 * Pass a sentence naming the reason — it is shown to the person, and "you are
 * a member of the calendar, so the plan is read-only" is a different situation
 * from "a colleague has the pen" and must not be reported as though it were.
 * Pass nothing to lift it.
 */
export function lockPlan(reason = '') {
  locked = String(reason || '');
}

/** True when this account may not edit the plan, whoever holds the pen. */
export function planLocked() {
  return locked !== '';
}

/**
 * Why, in the words the interface should use.
 *
 * Empty when nothing is locked. A caller showing this never has to decide how
 * to word it, which is what stops three screens wording it three ways.
 */
export function lockReason() {
  return locked;
}

/* ══════════════════════════════════════════════════════════════════════════
   The view that belongs to one account
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Which account is reading, as an opaque key, or '' for nobody.
 *
 * Set by `main.js` from whichever account the deployment actually has — the
 * calendar's on a calendar build, the timeline's own on a hosted one. It is a
 * key and never a name: it goes into a localStorage key, so two people sharing
 * a browser profile get their own answers and nobody's name is written to disk
 * by this.
 */
let account = '';

export function setAccount(key) {
  account = String(key || '');
}

export function accountKey() {
  return account;
}

/**
 * What somebody filtered, hid and compared against, remembered for them alone.
 *
 * This is here rather than in `core/storage.js` for a structural reason:
 * `storage.js` imports `core/store.js`, so the store cannot import it back —
 * the build rejects the cycle outright. A leaf both of them can read is the
 * only place the answer can live.
 *
 * **Why it is per account rather than in the document.** The filter, the filter
 * mode and which baseline is being compared against were `doc.settings`, which
 * meant they travelled in the plan: one person narrowing to their own subsystem
 * narrowed it for everybody who opened the file next, and turning a baseline on
 * was an edit to a shared document. Worse, on the read-only side it did not
 * work at all — a member selecting a baseline was refused, because the only way
 * to record the choice was to write to a plan they may not write to.
 *
 * So the *reading* is nobody's but the reader's. It is in localStorage, keyed on
 * the account and the plan, which means it is per browser profile as well — the
 * same limitation every other browser-stored preference here has, and the honest
 * one: there is no server to keep it on, and the plan is the one place it must
 * not go.
 *
 * Every read and write is wrapped, because a private window, cleared site data
 * or a blocked third-party context makes localStorage throw rather than return
 * nothing. A view that cannot be remembered is a view that starts empty, which
 * is exactly how it behaved before any of this.
 */
const VIEW_PREFIX = 'cxtl.view.';

function viewKey(scope) {
  return `${VIEW_PREFIX}${account || 'anon'}.${String(scope || 'plan')}`;
}

/** What this account last looked at in this plan, or null. */
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
