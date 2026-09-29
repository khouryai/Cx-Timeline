/**
 * The resource calendar's code, fetched the first time somebody opens it.
 *
 * `tools/build.js` puts everything only the calendar needs into
 * `calendar.bundle.js`, registering into the main bundle's module table, so the
 * timeline's own page does not carry a second application nobody on it is
 * using. `tools/dist.js` renames the file after its contents and rewrites the
 * name below in the published main bundle, which is why it is one literal.
 *
 * Where the calendar is already registered — the desktop payload carries both
 * bundles as one script, because an installed shell's loader predates the
 * split and knows about one — nothing is fetched at all.
 *
 * Imports: nothing.
 */

const CALENDAR_BUNDLE = 'calendar.bundle.js';
const ENTRY = 'ui/rc.js';

let loading = null;

/** Resolves to the calendar's `ui/rc.js` module, loading it once. */
export function loadCalendar() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const registry = typeof window !== 'undefined' ? window.__CX_MODULES : null;
    if (!registry) {
      reject(new Error('the module table is missing — the page is not running the built bundle'));
      return;
    }
    if (registry.mods[ENTRY]) {
      resolve(registry.req(ENTRY));
      return;
    }
    const script = document.createElement('script');
    script.src = CALENDAR_BUNDLE;
    script.async = true;
    script.onload = () => {
      if (registry.mods[ENTRY]) resolve(registry.req(ENTRY));
      else reject(new Error(`${CALENDAR_BUNDLE} loaded but did not register the calendar`));
    };
    script.onerror = () => reject(new Error('The calendar could not be downloaded. Check the connection and open it again.'));
    document.head.appendChild(script);
  });
  // A failure is not remembered: the next attempt tries the network again.
  loading.catch(() => { loading = null; });
  return loading;
}
