/**
 * The resource calendar's code, fetched the first time somebody opens it.
 *
 * `tools/build.js` puts everything only the calendar needs into
 * `calendar.bundle.js`, registering into the main bundle's module table, so the
 * timeline's own page does not carry a second application nobody on it is
 * using. Its stylesheet, `css/rc.css`, comes with it for the same reason —
 * it is most of the calendar's styling — and the calendar is not built until
 * both have arrived, so it never draws unstyled. `tools/dist.js` renames both
 * files after their contents and rewrites the names below in the published
 * main bundle, which is why each is one literal.
 *
 * Where the calendar is already registered — the desktop payload carries both
 * bundles as one script, because an installed shell's loader predates the
 * split and knows about one, and carries every stylesheet with them — nothing
 * is fetched at all.
 *
 * Imports: nothing.
 */

const CALENDAR_BUNDLE = 'calendar.bundle.js';
const CALENDAR_CSS = 'css/rc.css';
const ENTRY = 'ui/rc.js';

let loading = null;
/** rc.css: null until this loader asks for it, then 'failed' or 'loaded'. */
let sheet = null;

/** Resolves to the calendar's `ui/rc.js` module, loading it once. */
export function loadCalendar() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const registry = typeof window !== 'undefined' ? window.__CX_MODULES : null;
    if (!registry) {
      reject(new Error('the module table is missing — the page is not running the built bundle'));
      return;
    }
    /* Registered before anything was asked for is the desktop payload, which
       carries the stylesheets too. Registered after a fetch whose stylesheet
       failed is a retry, which must fetch the sheet again but never run the
       bundle twice. */
    const needScript = !registry.mods[ENTRY];
    const needSheet = needScript || sheet === 'failed';
    if (!needScript && !needSheet) {
      resolve(registry.req(ENTRY));
      return;
    }
    const script = !needScript ? Promise.resolve() : new Promise((done, fail) => {
      const tag = document.createElement('script');
      tag.src = CALENDAR_BUNDLE;
      tag.async = true;
      tag.onload = done;
      tag.onerror = () => fail(new Error('The calendar could not be downloaded. Check the connection and open it again.'));
      document.head.appendChild(tag);
    });
    const styles = new Promise((done, fail) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CALENDAR_CSS;
      link.onload = () => { sheet = 'loaded'; done(); };
      link.onerror = () => {
        // A retry must not leave a second copy of a sheet that never arrived.
        sheet = 'failed';
        link.remove();
        fail(new Error('The calendar could not be downloaded. Check the connection and open it again.'));
      };
      // Last in <head>, so it follows calendar.css exactly as it always did.
      document.head.appendChild(link);
    });
    Promise.all([script, styles]).then(() => {
      if (registry.mods[ENTRY]) resolve(registry.req(ENTRY));
      else reject(new Error(`${CALENDAR_BUNDLE} loaded but did not register the calendar`));
    }, reject);
  });
  // A failure is not remembered: the next attempt tries the network again.
  loading.catch(() => { loading = null; });
  return loading;
}
