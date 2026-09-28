/**
 * CX Calendar's service worker — the application on the phone, never the data.
 *
 * What it keeps is the app itself: the page, the bundle, the stylesheets, the
 * config and the icons, so the app opens with no signal and opens at once with
 * a poor one. What it never keeps is anything the calendar says. Requests to the
 * calendar's Supabase project are another origin and are not intercepted at all;
 * `core/rc.js` remembers a read for thirty seconds and forgets it on every write,
 * and a longer-lived copy here would be a second answer to "what is on the
 * server". Offline, the app opens and says it cannot reach the calendar.
 *
 * Only the files in `PRECACHE`, and navigations inside this folder, are handled.
 * Everything else on the site — the timeline, the desktop update channel — goes
 * to the network exactly as if this worker did not exist, which is the point of
 * scoping it to `m/`.
 *
 * Two strategies. A file named after its contents (`app.3f9c….js`, written by
 * `tools/dist.js`) can never change, so the cached copy is the answer. Anything
 * else — the page, `config.js`, the unhashed files of a development checkout —
 * is asked of the network first, so a new deploy is picked up on the next open,
 * and the cache answers only when the network does not.
 *
 * `VERSION` and `PRECACHE` are rewritten by `tools/dist.js` for every deploy:
 * the hashed names, and a version derived from them, so a deploy that changes
 * nothing leaves the cache alone and one that changes anything replaces it.
 */

const VERSION = 'dev';
const PRECACHE = [
  './',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  '../config.js',
  '../vendor/supabase.js',
  '../mobile.bundle.js',
  '../css/tokens.css',
  '../css/base.css',
  '../css/components.css',
  '../css/calendar.css',
  '../css/mobile.css',
];

const CACHE = `cx-calendar-${VERSION}`;
const SCOPE = new URL('./', self.location).href;
const OWN = new Set(PRECACHE.map((p) => new URL(p, self.location).href));
const HASHED = /\.[0-9a-f]{10}\.(?:js|css)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' }))))
      // Nothing is lost by taking over at once: the page is asked of the network
      // first anyway, so a newer worker only changes what answers offline.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('cx-calendar-') && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  url.hash = '';
  const navigating = request.mode === 'navigate' && url.href.startsWith(SCOPE);
  if (!navigating && !OWN.has(url.href)) return;

  if (!navigating && HASHED.test(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetchAndKeep(request)));
    return;
  }
  // Every navigation is the one page, so it is kept under one key.
  event.respondWith(fetchAndKeep(request, navigating ? SCOPE : null).catch(() =>
    caches.match(navigating ? SCOPE : request).then((hit) => hit || Response.error())));
});

/**
 * Ask the network, and keep a good answer for when there is no network.
 *
 * A navigation is kept as *the page* only when it is one: somebody opening the
 * manifest or the worker itself in a tab is a navigation inside this folder
 * too, and keeping that under the page's key would open the app offline as a
 * screen of JSON.
 */
async function fetchAndKeep(request, key = null) {
  const response = await fetch(request);
  const isPage = !key || /text\/html/.test(response.headers.get('content-type') || '');
  if (response.ok && response.type === 'basic' && isPage) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(key || request, copy));
  }
  return response;
}
