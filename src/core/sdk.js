/**
 * The vendored Supabase client, fetched the first time a client is made.
 *
 * It used to be a plain script tag ahead of the bundle, so every page paid for
 * 200 kB of a library before the timeline could start — including the plan,
 * which has no backend in any shape this is deployed in. Now `core/cloud.js`
 * and `core/rc.js` ask for it in their `init()`, which is already async and
 * already off the boot path, and a page that never makes a client never
 * downloads it.
 *
 * Where a page loads it itself — the phone app's `m/index.html` does, because
 * its first screen is the calendar — the global is already there and nothing
 * is fetched. The file stays where it was (`vendor/`, cached forever), so the
 * desktop shell and the published site resolve the same relative name.
 *
 * Imports: nothing.
 */

const SDK_SRC = 'vendor/supabase.js';

let loading = null;

const present = () => typeof window !== 'undefined'
  && window.supabase && typeof window.supabase.createClient === 'function';

/**
 * Resolves to the `supabase` global, or to null when it cannot be had — no
 * DOM, no file, no network. Never rejects: both callers degrade to "not
 * signed in", which is what a missing client has always meant.
 */
export function loadSupabase() {
  if (present()) return Promise.resolve(window.supabase);
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.onload = () => resolve(present() ? window.supabase : null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  }).then((sdk) => {
    // A failure is not remembered: the next sign-in tries the network again.
    if (!sdk) loading = null;
    return sdk;
  });
  return loading;
}
