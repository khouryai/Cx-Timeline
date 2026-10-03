/**
 * A phone opening the site is sent to the phone app, before anything loads.
 *
 * The site is the full calendar and the timeline, laid out for a screen. On a
 * phone it is the desktop page shrunk, and "Add to Home Screen" from it saves
 * a bookmark — it opens in a browser tab every time, because this page is not
 * an app and does not say it is one. The phone app (`m/`) is: it has the
 * manifest, the icons and the service worker, so the same "Add to Home Screen"
 * from there installs something that opens on its own, full screen.
 *
 * So a phone is sent there, with `location.replace()` so Back does not bounce
 * it straight here again. A phone, not a tablet: a touch screen whose shorter
 * side is under 600 CSS pixels. An iPad is somebody running the huddle or the
 * editor and stays on the full site.
 *
 * Only where the phone app is published — the calendar shape, where the plan
 * has no backend and the calendar has its own. Anywhere else `m/` does not
 * exist, and sending somebody there would be a 404.
 *
 * "Open the full site" in the phone app comes here with `?full=1`, and that
 * choice is kept on this phone until the phone app is opened again.
 *
 * Plain script, not a module and not in the bundle: it has to run before the
 * 1.4 MB bundle is fetched, and the policy allows no inline script.
 */
(function () {
  var config = window.CX_CONFIG || {};
  if (!config.rcSupabaseUrl || config.supabaseUrl) return;
  var KEY = 'cx-full-site';
  try {
    if (/[?&]full=1(&|$)/.test(location.search)) {
      localStorage.setItem(KEY, '1');
      return;
    }
    if (localStorage.getItem(KEY) === '1') return;
  } catch (e) {
    // No storage (a private window): the choice holds for this visit only.
    if (/[?&]full=1(&|$)/.test(location.search)) return;
  }
  var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var shorter = Math.min(window.screen.width || 0, window.screen.height || 0);
  if (touch && shorter > 0 && shorter < 600) location.replace('m/' + location.hash);
})();
