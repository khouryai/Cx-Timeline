/**
 * Installing the phone app, and what the service worker is for.
 *
 * The worker (`m/sw.js`) keeps the *application* on the phone so it opens with
 * no signal and opens fast with a poor one. It never keeps the calendar's data:
 * `core/rc.js` remembers a read for thirty seconds and forgets it on every write
 * and every sign-in, and a second, longer-lived copy in a cache would be a
 * second answer to "what is on the server" — the one this codebase refuses
 * everywhere. Offline, the app opens and says it cannot reach the calendar.
 *
 * It is registered from the page rather than trusted to be there. A browser
 * without service workers, a `file://` page and a private window all still run
 * the app; they just cannot install it.
 *
 * Imports: nothing (leaf).
 */

let deferredPrompt = null;
const listeners = new Set();

/** Register the worker and listen for the browser offering to install. */
export function installPwa() {
  if (typeof window === 'undefined') return;

  /* Chrome and Edge on Android offer installation through an event the page
     has to hold on to; without `preventDefault()` the browser shows its own
     banner once and never again. Held so the More tab can offer it when asked. */
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    changed();
  });

  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js', { scope: './' }).catch((err) => {
    // Not fatal: the app runs without it, it only cannot open offline.
    console.warn('[cx-calendar] the service worker did not register:', err.message);
  });
}

/** Tell `fn` whenever installing becomes possible or stops being. */
export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  for (const fn of listeners) {
    try { fn(); } catch (err) { console.error(err); }
  }
}

/** True when the app was opened from the home screen rather than a tab. */
export function isStandalone() {
  return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches)
    || navigator.standalone === true;
}

/** True when the browser has offered to install and nobody has answered yet. */
export function canPrompt() {
  return Boolean(deferredPrompt);
}

/** Show the browser's own install dialog. Resolves to what the person chose. */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const prompt = deferredPrompt;
  deferredPrompt = null;
  prompt.prompt();
  const choice = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
  changed();
  return choice?.outcome || 'dismissed';
}

/**
 * iPhone and iPad have no install event: Safari installs from its Share menu
 * and nowhere else, so the only honest help is to say where that is. An iPad
 * reports itself as a Mac, which is what the touch test is for.
 */
export function isIos() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
