/**
 * CX Timeline's service worker — the timeline, kept for when there is no
 * network. Never the plan, and never the calendar.
 *
 * In file mode the plan is a file in a folder on this machine, so the one thing
 * standing between somebody and their plan on a train or a site with no signal
 * was the page itself. This keeps the page, the main bundle, the stylesheets it
 * links, `config.js` and `phone.js`, so the timeline opens offline and the
 * folder it reads is whatever the machine already has.
 *
 * What it does not keep, on purpose:
 *   - the plan, ever — it is the folder's (or, hosted, the server's), and a
 *     second copy here would be a second answer to "which is current";
 *   - the calendar's bundle, its stylesheet and the Supabase client — the
 *     calendar needs its server anyway, offline it says so, and keeping them
 *     would download for everybody what only the calendar's users fetch;
 *   - anything under `m/`, which has its own worker (`m/sw.js`), and `desktop/`,
 *     the update channel, which must always be the network's answer;
 *   - any other origin.
 *
 * Two strategies, as in `m/sw.js`. A file named after its contents (written by
 * `tools/dist.js`) can never change, so the cached copy is the answer. The page
 * and anything unhashed — a development checkout — is asked of the network
 * first, so a deploy is picked up on the next open, and the cache answers only
 * when the network does not.
 *
 * `VERSION` and `PRECACHE` are rewritten by `tools/dist.js` for every deploy.
 */

const VERSION = 'dev';
const PRECACHE = [
  './',
  './config.js',
  './phone.js',
  './app.bundle.js',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/layout.css',
  './css/timeline.css',
  './css/notes.css',
  './css/calendar.css',
];

const CACHE = `cx-site-${VERSION}`;
const SCOPE = new URL('./', self.location).href;
const OWN = new Set(PRECACHE.map((p) => new URL(p, self.location).href));
const HASHED = /\.[0-9a-f]{10}\.(?:js|css)$/;
/** Paths another worker, or nobody, answers for. */
const ELSEWHERE = ['m/', 'desktop/'].map((p) => new URL(p, self.location).href);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' }))))
      // The page is asked of the network first anyway, so taking over at once
      // only changes what answers offline.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Its own old caches only: `cx-calendar-*` is the phone app's.
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('cx-site-') && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  url.hash = '';
  url.search = '';
  if (ELSEWHERE.some((p) => url.href.startsWith(p))) return;
  // The application owns its routing (wrangler hands every unknown path the
  // page), so every navigation inside the site is the one page.
  const navigating = request.mode === 'navigate' && url.href.startsWith(SCOPE);
  if (!navigating && !OWN.has(url.href)) return;

  if (!navigating && HASHED.test(url.pathname)) {
    event.respondWith(caches.match(url.href).then((hit) => hit || fetchAndKeep(request, url.href)));
    return;
  }
  const key = navigating ? SCOPE : url.href;
  event.respondWith(fetchAndKeep(request, key, navigating).catch(() =>
    caches.match(key).then((hit) => hit || Response.error())));
});

/**
 * Ask the network, and keep a good answer for when there is no network. A
 * navigation is kept as the page only when it is one — a JSON file opened in a
 * tab is a navigation too, and keeping it under the page's key would open the
 * timeline offline as a screen of text.
 */
async function fetchAndKeep(request, key, navigating = false) {
  const response = await fetch(request);
  const isPage = !navigating || /text\/html/.test(response.headers.get('content-type') || '');
  if (response.ok && response.type === 'basic' && isPage) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(key, copy));
  }
  return response;
}
