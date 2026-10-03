/*!
 * CX Calendar — the resource calendar, for a phone
 *
 * GENERATED FILE — do not edit by hand.
 * Built from the ES modules in src/ by tools/build.js (`npm run build`).
 * Modules: 19   Built: 2026-10-03T05:01:32.048Z
 */
(function () {
  'use strict';

  var __mods = Object.create(null);
  var __cache = Object.create(null);

  function __req(id) {
    if (__cache[id]) return __cache[id];
    var exports = Object.create(null);
    __cache[id] = exports;
    var factory = __mods[id];
    if (!factory) throw new Error('CX Timeline: missing module "' + id + '"');
    factory(exports, __req);
    return exports;
  }

// ════════════════════════════════════════════════════════════════════════
// mobile/theme.js
// ════════════════════════════════════════════════════════════════════════
__mods["mobile/theme.js"] = function (__x, __req) {
  /**
   * Light or dark, on a phone.
   *
   * The desktop's theme lives in the plan's settings (`ui/theme.js` imports the
   * store and the renderer), which is exactly what this app may not carry — so the
   * phone keeps its own answer, in the one place a per-device preference belongs.
   * It follows the phone by default, because that is what somebody who never opens
   * a settings screen expects, and can be pinned either way. Two of the five
   * desktop themes, because the other three are tuned for a wall-sized timeline.
   *
   * The status bar colour is read off the token rather than written here, so a
   * theme that moves `--chrome-bg` moves the bar with it and no hex lives in code.
   *
   * Imports: nothing (leaf).
   */

  const KEY = 'cx-m-theme';

  const THEME_CHOICES = [
    { value: 'system', label: 'Phone' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  function themePreference() {
    try {
      const held = localStorage.getItem(KEY);
      return THEME_CHOICES.some((c) => c.value === held) ? held : 'system';
    } catch {
      return 'system';
    }
  }

  function setThemePreference(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // Private browsing refuses storage; the choice holds for this visit anyway.
    }
    applyTheme(value);
  }

  function systemDark() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /** Set `data-theme` and the status bar to match. Safe to call repeatedly. */
  function applyTheme(pref = themePreference()) {
    const dark = pref === 'dark' || (pref === 'system' && systemDark());
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const bar = getComputedStyle(document.documentElement).getPropertyValue('--chrome-bg').trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && bar) meta.setAttribute('content', bar);
  }

  /** Follow the phone when it switches, for as long as the choice is "Phone". */
  function followSystem() {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (themePreference() === 'system') applyTheme('system');
    };
    if (query.addEventListener) query.addEventListener('change', onChange);
    else if (query.addListener) query.addListener(onChange);
  }

  Object.defineProperty(__x, "THEME_CHOICES", { get: () => THEME_CHOICES, enumerable: true });
  Object.defineProperty(__x, "themePreference", { get: () => themePreference, enumerable: true });
  Object.defineProperty(__x, "setThemePreference", { get: () => setThemePreference, enumerable: true });
  Object.defineProperty(__x, "applyTheme", { get: () => applyTheme, enumerable: true });
  Object.defineProperty(__x, "followSystem", { get: () => followSystem, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// mobile/pwa.js
// ════════════════════════════════════════════════════════════════════════
__mods["mobile/pwa.js"] = function (__x, __req) {
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
  let installedHere = false;
  const listeners = new Set();

  /** Register the worker and listen for the browser offering to install. */
  function installPwa() {
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
      installedHere = true;
      changed();
    });

    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch((err) => {
      // Not fatal: the app runs without it, it only cannot open offline.
      console.warn('[cx-calendar] the service worker did not register:', err.message);
    });
  }

  /** Tell `fn` whenever installing becomes possible or stops being. */
  function onInstallChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function changed() {
    for (const fn of listeners) {
      try { fn(); } catch (err) { console.error(err); }
    }
  }

  /** True when the app was opened from the home screen rather than a tab. */
  function isStandalone() {
    return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches)
      || navigator.standalone === true;
  }

  /**
   * True once it is on the home screen: opened from there, or installed from this
   * tab a moment ago (which is still a browser tab, so `display-mode` says no).
   */
  function isInstalled() {
    return isStandalone() || installedHere;
  }

  /** True when the browser has offered to install and nobody has answered yet. */
  function canPrompt() {
    return Boolean(deferredPrompt);
  }

  /** Show the browser's own install dialog. Resolves to what the person chose. */
  async function promptInstall() {
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
  function isIos() {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  Object.defineProperty(__x, "installPwa", { get: () => installPwa, enumerable: true });
  Object.defineProperty(__x, "onInstallChange", { get: () => onInstallChange, enumerable: true });
  Object.defineProperty(__x, "isStandalone", { get: () => isStandalone, enumerable: true });
  Object.defineProperty(__x, "isInstalled", { get: () => isInstalled, enumerable: true });
  Object.defineProperty(__x, "canPrompt", { get: () => canPrompt, enumerable: true });
  Object.defineProperty(__x, "promptInstall", { get: () => promptInstall, enumerable: true });
  Object.defineProperty(__x, "isIos", { get: () => isIos, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// core/util.js
// ════════════════════════════════════════════════════════════════════════
__mods["core/util.js"] = function (__x, __req) {
  /**
   * Small, dependency-free helpers used across the whole application.
   * This is a leaf module: it must never import anything.
   */

  /* ── Identity ──────────────────────────────────────────────────────────── */

  let _idCounter = 0;

  /** Short, collision-resistant id. Prefixed so ids are readable in exports. */
  function uid(prefix = 'o') {
    _idCounter = (_idCounter + 1) % 0xffff;
    const t = Date.now().toString(36);
    const r = Math.floor(Math.random() * 0x1000000).toString(36);
    const c = _idCounter.toString(36);
    return `${prefix}_${t}${r}${c}`;
  }

  /* ── Math ──────────────────────────────────────────────────────────────── */

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** Round to `step`, e.g. round(37, 5) === 35. */
  function roundTo(v, step) {
    return step ? Math.round(v / step) * step : v;
  }

  /* ── Objects ───────────────────────────────────────────────────────────── */

  /** Structured deep clone with a JSON fallback for older engines. */
  function deepClone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(value);
      } catch {
        /* falls through — value contains something non-cloneable */
      }
    }
    return JSON.parse(JSON.stringify(value));
  }

  /** Deep equality for plain data (the shape our documents are made of). */
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (typeof a !== 'object') return false;
    const aArr = Array.isArray(a);
    if (aArr !== Array.isArray(b)) return false;
    if (aArr) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  /**
   * Recursive merge of `patch` into a clone of `base`. Arrays are replaced
   * wholesale (never merged element-wise) — that is what document edits mean.
   */
  function merge(base, patch) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const [k, v] of Object.entries(patch || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = merge(out[k], v);
      } else {
        out[k] = v && typeof v === 'object' ? deepClone(v) : v;
      }
    }
    return out;
  }

  /** Pick a subset of keys. */
  function pick(obj, keys) {
    const out = {};
    for (const k of keys) if (k in obj) out[k] = obj[k];
    return out;
  }

  /* ── Functions ─────────────────────────────────────────────────────────── */

  function debounce(fn, ms = 200) {
    let t = null;
    const wrapped = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
    wrapped.cancel = () => clearTimeout(t);
    wrapped.flush = (...args) => {
      clearTimeout(t);
      fn(...args);
    };
    return wrapped;
  }

  function throttle(fn, ms = 60) {
    let last = 0;
    let pending = null;
    return (...args) => {
      const now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn(...args);
      } else {
        clearTimeout(pending);
        pending = setTimeout(() => {
          last = Date.now();
          fn(...args);
        }, ms - (now - last));
      }
    };
  }

  /** requestAnimationFrame coalescer — many calls, one frame. */
  function rafBatch(fn) {
    let queued = false;
    let lastArgs = null;
    return (...args) => {
      lastArgs = args;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fn(...lastArgs);
      });
    };
  }

  /* ── Strings ───────────────────────────────────────────────────────────── */

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Strip tags and collapse whitespace — for search indexing and previews. */
  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return (div.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function truncate(s, n = 60) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function slug(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /** Case-insensitive, accent-insensitive fold for search. */
  function fold(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function bytes(n) {
    if (!n) return '0 B';
    const units = ['B', 'kB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  /* ── Colour ────────────────────────────────────────────────────────────── */

  /** '#rrggbb' | '#rgb' → {r,g,b}; returns null for anything else. */
  function hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    let h = hex.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function rgbToHex(r, g, b) {
    const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  /** Mix two hex colours; t=0 → a, t=1 → b. */
  function mixHex(a, b, t) {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    if (!ca || !cb) return a;
    return rgbToHex(lerp(ca.r, cb.r, t), lerp(ca.g, cb.g, t), lerp(ca.b, cb.b, t));
  }

  function withAlpha(hex, alpha) {
    const c = hexToRgb(hex);
    if (!c) return hex;
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${clamp(alpha, 0, 1)})`;
  }

  /** Relative luminance (WCAG) — used to choose readable label ink. */
  function luminance(hex) {
    const c = hexToRgb(hex);
    if (!c) return 0.5;
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  /** Pick black or white ink so text stays legible on `hex`. */
  function readableInk(hex, dark = '#0b0f1a', light = '#ffffff') {
    return luminance(hex) > 0.48 ? dark : light;
  }

  /* ── DOM ───────────────────────────────────────────────────────────────── */

  /**
   * Terse element factory.
   *   el('div', { class: 'x', dataset: { id: 1 } }, [child, 'text'])
   */
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $$(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  /** Remove every child without touching the parent node itself. */
  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /** Walk up from `node` to find the closest ancestor carrying `attr`. */
  function closestData(node, attr, stop) {
    let n = node;
    while (n && n !== stop && n !== document.body) {
      if (n.dataset && n.dataset[attr] !== undefined) return n;
      n = n.parentElement;
    }
    return null;
  }

  /* ── Files ─────────────────────────────────────────────────────────────── */

  /** Trigger a browser download for a Blob or string. */
  function download(filename, data, mime = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** Open a file picker and resolve with the chosen File list. */
  function pickFiles({ accept = '', multiple = false } = {}) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.remove();
        resolve(files);
      });
      // A cancelled picker fires no event in most browsers; the element is
      // cleaned up on the next pick or on unload, which is harmless.
      input.click();
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsText(file);
    });
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(file);
    });
  }

  /* ── Misc ──────────────────────────────────────────────────────────────── */

  /** Detect the platform modifier so shortcut hints read correctly. */
  const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

  /** True when the event carries the platform's "command" modifier. */
  function hasMod(e) {
    return IS_MAC ? e.metaKey : e.ctrlKey;
  }

  /** True when focus is inside a text-entry control (so shortcuts stand down). */
  function isTyping(target) {
    const n = target || document.activeElement;
    if (!n) return false;
    const tag = (n.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || n.isContentEditable === true;
  }

  /** Sort comparator factory for a numeric or string field. */
  function by(key, dir = 1) {
    return (a, b) => {
      const va = typeof key === 'function' ? key(a) : a[key];
      const vb = typeof key === 'function' ? key(b) : b[key];
      if (va === vb) return 0;
      return (va > vb ? 1 : -1) * dir;
    };
  }

  Object.defineProperty(__x, "uid", { get: () => uid, enumerable: true });
  Object.defineProperty(__x, "clamp", { get: () => clamp, enumerable: true });
  Object.defineProperty(__x, "lerp", { get: () => lerp, enumerable: true });
  Object.defineProperty(__x, "roundTo", { get: () => roundTo, enumerable: true });
  Object.defineProperty(__x, "deepClone", { get: () => deepClone, enumerable: true });
  Object.defineProperty(__x, "deepEqual", { get: () => deepEqual, enumerable: true });
  Object.defineProperty(__x, "merge", { get: () => merge, enumerable: true });
  Object.defineProperty(__x, "pick", { get: () => pick, enumerable: true });
  Object.defineProperty(__x, "debounce", { get: () => debounce, enumerable: true });
  Object.defineProperty(__x, "throttle", { get: () => throttle, enumerable: true });
  Object.defineProperty(__x, "rafBatch", { get: () => rafBatch, enumerable: true });
  Object.defineProperty(__x, "escapeHtml", { get: () => escapeHtml, enumerable: true });
  Object.defineProperty(__x, "stripHtml", { get: () => stripHtml, enumerable: true });
  Object.defineProperty(__x, "truncate", { get: () => truncate, enumerable: true });
  Object.defineProperty(__x, "slug", { get: () => slug, enumerable: true });
  Object.defineProperty(__x, "fold", { get: () => fold, enumerable: true });
  Object.defineProperty(__x, "bytes", { get: () => bytes, enumerable: true });
  Object.defineProperty(__x, "hexToRgb", { get: () => hexToRgb, enumerable: true });
  Object.defineProperty(__x, "rgbToHex", { get: () => rgbToHex, enumerable: true });
  Object.defineProperty(__x, "mixHex", { get: () => mixHex, enumerable: true });
  Object.defineProperty(__x, "withAlpha", { get: () => withAlpha, enumerable: true });
  Object.defineProperty(__x, "luminance", { get: () => luminance, enumerable: true });
  Object.defineProperty(__x, "readableInk", { get: () => readableInk, enumerable: true });
  Object.defineProperty(__x, "el", { get: () => el, enumerable: true });
  Object.defineProperty(__x, "$", { get: () => $, enumerable: true });
  Object.defineProperty(__x, "$$", { get: () => $$, enumerable: true });
  Object.defineProperty(__x, "clear", { get: () => clear, enumerable: true });
  Object.defineProperty(__x, "closestData", { get: () => closestData, enumerable: true });
  Object.defineProperty(__x, "download", { get: () => download, enumerable: true });
  Object.defineProperty(__x, "pickFiles", { get: () => pickFiles, enumerable: true });
  Object.defineProperty(__x, "readFileAsText", { get: () => readFileAsText, enumerable: true });
  Object.defineProperty(__x, "readFileAsDataURL", { get: () => readFileAsDataURL, enumerable: true });
  Object.defineProperty(__x, "readFileAsArrayBuffer", { get: () => readFileAsArrayBuffer, enumerable: true });
  Object.defineProperty(__x, "IS_MAC", { get: () => IS_MAC, enumerable: true });
  Object.defineProperty(__x, "hasMod", { get: () => hasMod, enumerable: true });
  Object.defineProperty(__x, "isTyping", { get: () => isTyping, enumerable: true });
  Object.defineProperty(__x, "by", { get: () => by, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// core/events.js
// ════════════════════════════════════════════════════════════════════════
__mods["core/events.js"] = function (__x, __req) {
  /**
   * Application event bus.
   *
   * This is the mechanism that keeps the module graph acyclic: lower layers
   * (store, timeline engine) emit, higher layers (UI) subscribe. A module never
   * imports "upwards" to call a UI function — it publishes an event instead.
   *
   * Leaf module: imports nothing.
   */

  const listeners = new Map(); // event name -> Set<handler>

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   * `'*'` receives every event as (name, payload).
   */
  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => off(event, handler);
  }

  /** Subscribe for exactly one delivery. */
  function once(event, handler) {
    const stop = on(event, (payload) => {
      stop();
      handler(payload);
    });
    return stop;
  }

  function off(event, handler) {
    const set = listeners.get(event);
    if (set) {
      set.delete(handler);
      if (!set.size) listeners.delete(event);
    }
  }

  /**
   * Publish an event. Handlers are copied before iteration so a handler may
   * safely subscribe or unsubscribe during dispatch. A throwing handler is
   * logged and skipped — one bad listener never breaks the others.
   */
  function emit(event, payload) {
    const direct = listeners.get(event);
    if (direct) {
      for (const handler of Array.from(direct)) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[cx-timeline] listener for "${event}" threw:`, err);
        }
      }
    }
    const wildcard = listeners.get('*');
    if (wildcard) {
      for (const handler of Array.from(wildcard)) {
        try {
          handler(event, payload);
        } catch (err) {
          console.error('[cx-timeline] wildcard listener threw:', err);
        }
      }
    }
  }

  /** Remove every subscription — used by tests and teardown. */
  function clearAll() {
    listeners.clear();
  }

  /**
   * The canonical event names. Using these constants (rather than bare strings)
   * keeps typos out and gives one place to see the whole application protocol.
   */
  const EV = {
    /* Document lifecycle */
    DOC_LOADED: 'doc:loaded',
    DOC_CHANGED: 'doc:changed', // { reason, ids? } — any mutation to the project
    DOC_META_CHANGED: 'doc:meta', // name/description/settings only
    DOC_REPLACED: 'doc:replaced', // wholesale swap (import, restore, new)
    LISTS_CHANGED: 'lists:changed', // { listId } — a dropdown vocabulary was edited
    P6_IMPORTED: 'p6:imported', // { kind, plan } — a Primavera export was applied
    LOOKAHEAD_IMPORTED: 'lookahead:imported', // { report } — a look-ahead workbook was read into the register

    /* Persistence */
    SAVE_START: 'save:start',
    SAVE_DONE: 'save:done',
    SAVE_ERROR: 'save:error',
    BACKUP_MADE: 'backup:made',

    /* The shared folder (file mode only) */
    FILE_STATE: 'file:state', // { connected, folder, plan, role, holder } — connection or pen changed
    FILE_EXTERNAL_CHANGE: 'file:external', // a colleague's save landed in the folder
    FILE_CONFLICT: 'file:conflict', // a write was refused because the file moved underneath us
    FILE_IDLE: 'file:idle', // the holder has been idle too long; flush a save and hand the pen back
    FILE_PEN_REQUESTED: 'file:pen-requested', // { by } — a colleague is asking for the pen

    /* History */
    HISTORY_CHANGED: 'history:changed', // { canUndo, canRedo, depth }

    /* Account & sharing (hosted deployments only) */
    AUTH_CHANGED: 'auth:changed', // { user } — signed in, signed out, session restored
    ACCESS_CHANGED: 'access:changed', // { role, readOnly } — which project, and what you may do
    EDIT_REFUSED: 'access:refused', // a write was attempted without permission
    CLOUD_CONFLICT: 'cloud:conflict', // someone else saved the project first

    /* The resource calendar — a separate module, with a separate backend and a
       separate account. Deliberately not AUTH_CHANGED: signing in to the
       calendar must not disturb the timeline, which needs no account at all. */
    RC_AUTH_CHANGED: 'rc:auth', // { user, event }
    RC_CHANGED: 'rc:changed', // { what } — a row was written; panes reload
    RC_QUEUE_CHANGED: 'rc:queue', // { pending } — unsynced huddle entries
    RC_SHOW_TAB: 'rc:tab', // { tab } — a tab asking for another; ui/rc.js owns the router

    /* Which whole interface is on screen: the timeline, or the calendar. */
    CALENDAR_FAILED: 'calendar:failed', // { message } — the calendar's code could not be loaded or started
    WORKSPACE_CHANGED: 'workspace:changed', // { workspace }

    /* Selection & interaction */
    SELECTION_CHANGED: 'selection:changed', // { ids }
    OBJECT_ACTIVATED: 'object:activated', // { id } — double-click / Enter
    TOOL_CHANGED: 'tool:changed', // { tool }

    /* Viewport */
    VIEW_CHANGED: 'view:changed', // { scale, originMs, pxPerDay }
    SCALE_CHANGED: 'view:scale',

    /* Rendering */
    RENDER_REQUESTED: 'render:request',
    RENDER_DONE: 'render:done',

    /* UI */
    THEME_CHANGED: 'theme:changed',
    FILTER_CHANGED: 'filter:changed',
    PANEL_CHANGED: 'panel:changed',
    // A pane asking the dock to rebuild it. Panes cannot import the dock —
    // that would be a cycle — and view-only state (a filter, a search) changes
    // nothing in the document, so no doc:changed fires to do it for them.
    PANE_REFRESH: 'panel:refresh',
    PANE_OPEN: 'panel:open', // { pane } — a pane asking for another one; the dock owns showPane()
    TOAST: 'ui:toast',
    STATUS: 'ui:status',
    PRESENT_MODE: 'ui:present',
  };

  Object.defineProperty(__x, "on", { get: () => on, enumerable: true });
  Object.defineProperty(__x, "once", { get: () => once, enumerable: true });
  Object.defineProperty(__x, "off", { get: () => off, enumerable: true });
  Object.defineProperty(__x, "emit", { get: () => emit, enumerable: true });
  Object.defineProperty(__x, "clearAll", { get: () => clearAll, enumerable: true });
  Object.defineProperty(__x, "EV", { get: () => EV, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// core/rc.js
// ════════════════════════════════════════════════════════════════════════
__mods["core/rc.js"] = function (__x, __req) {
  /**
   * The Resource Calendar backend.
   *
   * A second, entirely separate Supabase client from `core/cloud.js`, and the
   * separation is the feature rather than duplication.
   *
   * The timeline's plan is proprietary: it holds the P6 project and it never
   * leaves its OneDrive folder. The resource calendar holds none of that, so it
   * lives in Postgres where the deputy and the team can reach it from a browser.
   * Until now that boundary was guaranteed by the *build* — `tools/desktop.js`
   * writes a blank config and `tools/dist.js --no-backend` strips the Supabase
   * client outright, so the desktop application had no backend at all and could
   * not have reached one. Putting a client back in the page reverses that, and a
   * promise that used to be structural would become a convention.
   *
   * So it is made structural again, three ways:
   *
   *   1. A different configuration key. `CX_CONFIG.supabaseUrl` stays blank
   *      forever and is the *plan's* backend; this module reads
   *      `CX_CONFIG.rcSupabaseUrl` and nothing else. Neither can be mistaken for
   *      the other.
   *   2. A different module. Nothing on the plan's storage path imports this
   *      file, and this file imports nothing that reads the plan — no store, no
   *      storage, no filestore. The build fails on import cycles, and the layer
   *      check in `tools/build.js` fails on a plan module reaching in here.
   *   3. A test that proves it. `tools/smoke_isolation.js` boots with this
   *      backend stubbed, edits the plan, and asserts that nothing carrying plan
   *      content ever left.
   *
   * There is no document here and no autosave. The plan is one JSON object saved
   * whole; this is rows, written one at a time, because the reports have to
   * answer arbitrary date ranges and two people have to edit at once.
   *
   * Imports: util, events.
   */

  const { emit, EV } = __req("core/events.js");

  /* ── Configuration ─────────────────────────────────────────────────────── */

  function config() {
    return (typeof window !== 'undefined' && window.CX_CONFIG) || {};
  }

  /**
   * True when this build points at a resource-calendar backend.
   *
   * Deliberately *not* `cloud.isConfigured()`. A build can have this and not
   * that — which is exactly the shape the deployment wants: the plan in a
   * folder, the calendar in Postgres.
   */
  function isConfigured() {
    const { rcSupabaseUrl, rcSupabaseAnonKey } = config();
    return Boolean(rcSupabaseUrl && rcSupabaseAnonKey);
  }

  /* ── Private state ─────────────────────────────────────────────────────── */

  let client = null;
  let user = null;
  let person = null;   // the caller's rc_people row, or null
  let ready = false;

  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  /**
   * Create the client and restore any session.
   *
   * Never throws, and never blocks. The timeline has to open with no network at
   * all, so a backend that is unreachable degrades to "not signed in" and the
   * Resource Calendar simply says so when you switch to it.
   */
  async function init() {
    if (ready) return user;
    if (!isConfigured()) return null;

    const sdk = typeof window !== 'undefined' ? window.supabase : null;
    if (!sdk || typeof sdk.createClient !== 'function') {
      console.warn('[cx-timeline] the Supabase client did not load; the resource calendar is unavailable');
      return null;
    }

    const { rcSupabaseUrl, rcSupabaseAnonKey } = config();
    client = sdk.createClient(rcSupabaseUrl, rcSupabaseAnonKey, {
      // A storage key of its own. The plan's client, in a build that has one,
      // would otherwise share a session slot with this and the two would evict
      // each other on every reload.
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'cx-rc-auth',
      },
    });

    try {
      const { data } = await client.auth.getSession();
      user = data?.session?.user || null;
      if (user) await refreshPerson();
    } catch (err) {
      console.warn('[cx-timeline] could not restore the resource-calendar session:', err.message);
      user = null;
    }

    client.auth.onAuthStateChange((event, session) => {
      const next = session?.user || null;
      const changed = (next?.id || null) !== (user?.id || null);
      user = next;
      if (!next) { person = null; preview = null; }
      if (changed) emit(EV.RC_AUTH_CHANGED, { user, event });
    });

    ready = true;

    // Restoring a session is a change of identity as much as signing in is, and
    // the shell has already drawn itself by now — what it shows depends on the
    // role, which only exists after this point. Without the event a returning
    // viewer would keep whichever chrome the anonymous boot decided on.
    if (user) emit(EV.RC_AUTH_CHANGED, { user, event: 'RESTORED' });
    return user;
  }

  function raw() {
    return client;
  }

  function currentUser() {
    return user;
  }

  function isSignedIn() {
    return Boolean(user);
  }

  /**
   * The caller's own person row.
   *
   * Null is a real answer and not an error: an account with no `rc_people` row
   * is somebody who can sign in but is not on the team, and the database will
   * refuse their writes accordingly.
   */
  function me() {
    return preview || person;
  }

  /* ── Seeing it as somebody else ─────────────────────────────────────────
     An administrator can look at the calendar the way a member or a viewer
     sees it, before telling the team to use it. Everything that decides what
     to draw — `me()`, `role()`, `isAdmin()`, `canWrite()` — answers as that
     person; every write is refused here, before it leaves the page, with an
     error saying why (`err.preview`). The database is not asked to pretend:
     it still answers as the administrator, so a preview shows the screens a
     member gets, not a guarantee of the rows their account could read. */

  let preview = null; // the rc_people row being looked through, or null

  /** Look at the calendar as this person (a member or a viewer), or stop with null. */
  function previewAs(who) {
    if (who && person?.role !== 'admin') throw new Error('Only an administrator can see the calendar as somebody else.');
    if (who && who.role === 'admin') throw new Error('Choose a member or a viewer — an administrator sees what you see.');
    preview = who ? { id: who.id, name: who.name, email: who.email || null, title: who.title || null, subsystem: who.subsystem || null, role: who.role || 'member', active: true } : null;
    forgetReads();
    emit(EV.RC_AUTH_CHANGED, { user, event: who ? 'PREVIEW' : 'PREVIEW_ENDED' });
  }

  /** The person being looked through, or null. */
  function previewing() {
    return preview;
  }

  /** Whether the account actually signed in is an administrator, whoever it is previewing. */
  function isRealAdmin() {
    return person?.role === 'admin';
  }

  /** Refuse a write while previewing — before it reaches the network or a queue. */
  function guardPreview() {
    if (!preview) return;
    const err = new Error(`Preview only — nothing is saved while you are seeing the calendar as ${preview.name}.`);
    err.preview = true;
    throw err;
  }

  /**
   * True when the caller may see the KPI history and write the plan.
   *
   * This drives what the interface shows. It is *not* the control — every rule
   * is a row-level security policy, so a member who bypasses the interface
   * still gets nothing back from `rc_effort`. This exists to explain why
   * something is missing, not to decide it.
   */
  function isAdmin() {
    return me()?.role === 'admin';
  }

  /** 'admin' | 'member' | 'viewer', or null for somebody not on the team. */
  function role() {
    return me()?.role || null;
  }

  /**
   * True when this account may write anything at all.
   *
   * A viewer has a person row and `me()` finds it, so an id comparison alone
   * would let them record their own outcomes — which is the whole difference
   * between read-only and not. `rc_can_act_for()` makes the same distinction in
   * the database, and that is the control; this decides what to draw.
   */
  function canWrite() {
    return me()?.role === 'admin' || me()?.role === 'member';
  }

  function isViewer() {
    return me()?.role === 'viewer';
  }

  function accountLabel() {
    if (person?.name) return person.name;
    if (!user) return '';
    return user.user_metadata?.full_name || user.email || 'Signed in';
  }

  async function refreshPerson() {
    // Runs on every sign-in and account change: same rule as sign-out.
    forgetReads();
    person = null;
    preview = null;
    if (!client || !user) return null;
    const { data, error } = await client
      .from('rc_people')
      .select('id, name, email, title, subsystem, role, active')
      .eq('user_id', user.id)
      .eq('active', true)
      .maybeSingle();
    if (error) {
      console.warn('[cx-timeline] could not read your team record:', error.message);
      return null;
    }
    person = data || null;
    return person;
  }

  /* ── Account ───────────────────────────────────────────────────────────── */

  async function signIn(email, password) {
    requireClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: String(email || '').trim(),
      password,
    });
    if (error) throw friendlier(error);
    user = data.user;
    await refreshPerson();
    emit(EV.RC_AUTH_CHANGED, { user, event: 'SIGNED_IN' });
    return user;
  }

  /**
   * Create an account.
   *
   * The gate is `rc_enforce_invitation()` on `auth.users`, not this function:
   * sign-up goes through GoTrue rather than PostgREST, so anybody holding the
   * public key can POST to /auth/v1/signup and the interface has no say in it.
   * An address nobody invited is refused by the database, and what comes back
   * here is that refusal.
   *
   * Whether they are signed in afterwards depends on the project's "Confirm
   * email" setting, so the caller is told which happened rather than guessing.
   */
  async function signUp(email, password) {
    requireClient();
    const { data, error } = await client.auth.signUp({
      email: String(email || '').trim(),
      password,
    });
    if (error) throw friendlier(error);
    user = data.user || null;
    if (data.session) {
      await refreshPerson();
      emit(EV.RC_AUTH_CHANGED, { user, event: 'SIGNED_IN' });
    }
    return { user, live: Boolean(data.session) };
  }

  async function signOut() {
    if (!client) return;
    // Whoever signs in next must not read this account's rows out of memory.
    // The database would refuse them; the cache must not answer first.
    forgetReads();
    await client.auth.signOut();
    user = null;
    person = null;
    preview = null;
    emit(EV.RC_AUTH_CHANGED, { user: null, event: 'SIGNED_OUT' });
  }

  function requireClient() {
    if (!client) throw new Error('The resource calendar is not configured for this build.');
  }

  /** Supabase's wording is for developers; these messages are for people. */
  function friendlier(error) {
    const message = String(error?.message || 'Something went wrong.');
    if (/invitation only/i.test(message)) {
      return new Error('That address has not been invited. Ask an administrator to invite you, '
        + 'then use the link they send.');
    }
    if (/already registered|user already exists/i.test(message)) {
      return new Error('That address already has an account — sign in instead.');
    }
    if (/password/i.test(message) && /least|short|weak/i.test(message)) {
      return new Error('That password is too short — six characters at least.');
    }
    if (/invalid login credentials/i.test(message)) return new Error('That email and password do not match an account.');
    if (/email not confirmed/i.test(message)) return new Error('Confirm your email address first — check your inbox.');
    if (/failed to fetch|networkerror/i.test(message)) {
      return new Error('Could not reach the server. The timeline still works offline; the resource calendar needs a connection.');
    }
    return new Error(message);
  }

  /* ── Reading ───────────────────────────────────────────────────────────── */

  /**
   * Every read goes through here so a failure has one shape.
   *
   * A refused SELECT is not an error in PostgREST — the policy excludes the rows
   * and an empty list comes back — so callers must never read "no rows" as "no
   * permission". Where the difference matters, ask `isAdmin()`.
   */
  /* ── The read cache ──────────────────────────────────────────────────────
     Every tab re-asks for the roster, the locations, the legend, the aliases and
     the categories, and every section inside the look-ahead re-asks for the
     snapshot. None of it changes between one click and the next, and the round
     trips were most of the wait between tabs. So a read is remembered for a short
     while, keyed on the table and everything the query asked for.

     Two things keep it honest. **Any write through this module empties it**, so
     what somebody just saved is what the next screen reads — the alternative,
     an outcome recorded and the meeting still showing the old one, is exactly the
     failure a huddle cannot afford. And the memory is short (`READ_TTL`), because
     two people edit this calendar at once and a colleague's write comes through
     nothing here; thirty seconds is a tab switch, not a shift. It is never longer
     than one page: a reload starts empty. */
  const READ_TTL = 30000;
  const reads = new Map();

  function remember(key, fetch) {
    const held = reads.get(key);
    if (held && held.until > Date.now()) return held.promise;
    const promise = fetch().then(
      (rows) => rows,
      (err) => { reads.delete(key); throw err; }
    );
    reads.set(key, { promise, until: Date.now() + READ_TTL });
    return promise;
  }

  /** Forget every remembered read. Called by every write, and by whoever knows better. */
  function forgetReads() {
    reads.clear();
  }

  /**
   * The filters a query built, as text, so two identical questions share an
   * answer and two different ones never do. The builder is wrapped rather than
   * inspected: the client's own object does not describe itself, and the stub the
   * tests run against has nothing to inspect at all.
   */
  function describe(build) {
    const parts = [];
    const proxy = new Proxy({}, {
      get: (_, method) => (...args) => { parts.push(`${String(method)}(${JSON.stringify(args)})`); return proxy; },
    });
    if (build) build(proxy);
    return parts.join('');
  }

  async function select(table, build, { columns = '*' } = {}) {
    requireClient();
    const key = `${table}|${columns}|${describe(build)}`;
    return remember(key, async () => {
      let query = client.from(table).select(columns);
      if (build) query = build(query);
      const { data, error } = await query;
      if (error) throw new Error(`${table}: ${error.message}`);
      return data || [];
    });
  }

  /**
   * The team.
   *
   * `scheduledOnly` is what the huddle and the week plan ask for: the people who
   * actually take shifts. It is a separate question from what somebody may do —
   * a manager administers the calendar and is never assigned to a location, and
   * an administrator who *does* take shifts must not disappear from the meeting
   * because of their permissions.
   */
  function listPeople({ includeInactive = false, scheduledOnly = false } = {}) {
    return select('rc_people', (q) => {
      let out = includeInactive ? q : q.eq('active', true);
      if (scheduledOnly) out = out.eq('scheduled', true);
      return out.order('name');
    });
  }

  function listLocations({ includeInactive = false } = {}) {
    return select('rc_locations', (q) => (includeInactive ? q : q.eq('active', true)).order('name'));
  }

  function listLocationAliases() {
    return select('rc_location_alias', (q) => q.order('alias'));
  }

  /**
   * The other spellings of a person, for matching the look-ahead's Resource row.
   *
   * A name typed into a spreadsheet cell is "R. Okafor" one week and "Okafor" the
   * next. The register is what turns those into a person; a name it does not know
   * is shown as unmatched rather than guessed at, which is the same answer the
   * location aliases give and for the same reason.
   */
  function listPersonAliases() {
    return select('rc_person_alias', (q) => q.order('alias'));
  }

  function listCategories({ includeInactive = false } = {}) {
    return select('rc_categories', (q) => (includeInactive ? q : q.eq('active', true)).order('sort'));
  }

  function listParties() {
    return select('rc_parties', (q) => q.eq('active', true).order('name'));
  }

  /**
   * The legend the look-ahead's colours are read against.
   *
   * Versioned by `valid_from`, because a legend that changes must not silently
   * reinterpret every snapshot taken before it did. Newest first, so a caller
   * taking the first entry for a colour gets the one in force.
   */
  function listLegend({ includeInactive = false } = {}) {
    return select('rc_legend', (q) =>
      (includeInactive ? q : q.eq('active', true)).order('valid_from', { ascending: false }));
  }

  /**
   * Everything, as one object.
   *
   * The calendar's whole value is being the record a year from now, and until
   * this existed there was no way to get it out — a bad migration or a project
   * deleted by accident left the provider's point-in-time recovery and nothing
   * else. Read straight through the policies rather than around them, so what
   * comes back is what the person asking is allowed to see: an administrator
   * gets the evidence tables, a member gets the schedule.
   *
   * Tables only. The SAR PDFs are in Storage and are not folded in — they are
   * the one thing here that is already a file, and a hundred megabytes of base64
   * in a JSON document is not a backup anybody would successfully restore.
   */
  async function exportEverything() {
    requireClient();
    const tables = [
      'rc_people', 'rc_locations', 'rc_location_alias', 'rc_person_alias',
      'rc_categories', 'rc_parties',
      'rc_leave_kinds', 'rc_legend', 'rc_settings', 'rc_leave', 'rc_plan_entries', 'rc_client_errors',
      'rc_la_rows', 'rc_la_cells', 'rc_la_edits', 'rc_support_codes', 'rc_la_seen',
      'rc_actuals', 'rc_ingest_runs', 'rc_lookahead_snapshots', 'rc_lookahead_rows',
      'rc_change_events', 'rc_change_annotations', 'rc_sars', 'rc_sar_links',
      'rc_tawrs', 'rc_tawr_descriptions', 'rc_tawr_settings', 'rc_tawr_profiles',
    ];

    const out = {
      exported_at: new Date().toISOString(),
      exported_by: person?.name || user?.email || null,
      note: 'Every rc_* table this account may read. SAR PDFs live in Storage and are not '
        + 'included; their storage_path is.',
      tables: {},
    };
    for (const table of tables) {
      // One at a time, and a table that refuses is recorded as refused rather
      // than silently absent — "empty" and "not allowed" must not look alike in
      // something somebody may restore from.
      try {
        out.tables[table] = await select(table);
      } catch (err) {
        out.tables[table] = { error: err.message };
      }
    }
    return out;
  }

  /* ── The look-ahead, edited here ───────────────────────────────────────── */

  /**
   * Every page of a read the server would otherwise cut off at its row limit.
   *
   * PostgREST answers a thousand rows at most, and a five-week look-ahead can
   * hold more cells than that: a read that stopped at the limit would draw a
   * sheet with its bottom rows blank and no sign anything was missing.
   */
  async function selectAll(table, build, pageSize = 1000) {
    requireClient();
    const key = `${table}|all|${describe(build)}`;
    return remember(key, async () => {
      const out = [];
      for (let from = 0; ; from += pageSize) {
        let query = client.from(table).select('*');
        if (build) query = build(query);
        const { data, error } = await query.range(from, from + pageSize - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }
      return out;
    });
  }

  function listLaRows() {
    return selectAll('rc_la_rows', (q) => q.order('sort').order('id'));
  }

  /** The cells between two dates, both inclusive. */
  function listLaCells(fromISO, toISO) {
    return selectAll('rc_la_cells', (q) => q.gte('day', fromISO).lte('day', toISO).order('day').order('row_id'));
  }

  /**
   * Apply a batch of look-ahead ops (see `core/la_edit.js`), all or nothing.
   * Answers with the version each op made; a stale op refuses the whole batch
   * with a message starting "conflict:".
   */
  const applyLookaheadOps = (ops) => rpc('rc_la_apply', { p_ops: ops });

  /**
   * The newest change anybody has made, as a number — asked every few seconds by
   * an open editor. A read, so it does not empty the read cache the way every
   * other call to a function does.
   */
  async function lookaheadRevision() {
    requireClient();
    const { data, error } = await client.rpc('rc_la_revision', {});
    if (error) throw new Error(`rc_la_revision: ${error.message}`);
    return Number(data) || 0;
  }

  /**
   * The edit log, newest first: the last `limit` changes, or every change from
   * `sinceId` on. An administrator's read — the log is the evidence base.
   */
  function listLaEdits({ sinceId = null, limit = 2000 } = {}) {
    if (sinceId != null) return selectAll('rc_la_edits', (q) => q.gte('id', sinceId).order('id', { ascending: false }));
    return select('rc_la_edits', (q) => q.order('id', { ascending: false }).limit(limit));
  }

  /** Everything the log says about one row and its days, newest first. */
  function listLaEditsForRow(rowId) {
    return select('rc_la_edits', (q) => q.eq('row_id', rowId).order('id', { ascending: false }).limit(1000));
  }

  /**
   * Slim the grids of superseded editor readings past the keep period, and say
   * how many — see `rc_compact_snapshots()` for what is kept and why.
   */
  const compactSnapshots = () => rpc('rc_compact_snapshots', {});

  /* ── Who has seen the changes to their days ─────────────────────────────── */

  /** The newest "Got it" a person has given, or null — see `rc_la_seen`. */
  function lastSeen(personId) {
    return select('rc_la_seen', (q) => q.eq('person_id', personId).order('seen_at', { ascending: false }).limit(1))
      .then((rows) => rows[0] || null);
  }

  /** Every "Got it", newest first — an administrator reads everybody's, anybody else their own. */
  function listSeen() {
    return select('rc_la_seen', (q) => q.order('seen_at', { ascending: false }).limit(2000));
  }

  /** Record that the person looking has seen the look-ahead as of this reading. */
  function markSeen({ snapshotId, takenAt, changes = 0 }) {
    const who = me();
    if (!who) return Promise.reject(new Error('Only somebody on the team can say they have seen their days.'));
    return insert('rc_la_seen', [{
      person_id: who.id, snapshot_id: snapshotId, snapshot_taken_at: takenAt, changes,
    }]).then((rows) => rows[0] || null);
  }

  /** One reading's stored rows — what "what changed for me" compares. */
  function snapshotRows(snapshotId) {
    return selectAll('rc_lookahead_rows', (q) => q.eq('snapshot_id', snapshotId).order('id'));
  }

  function listSupportCodes({ includeRetired = false } = {}) {
    return select('rc_support_codes', (q) => (includeRetired ? q.order('sort').order('code') : q.eq('active', true).order('sort').order('code')));
  }
  const addSupportCode = (row) => insert('rc_support_codes', [row]).then((r) => r[0]);
  const updateSupportCode = (id, patch) => update('rc_support_codes', id, patch);

  /* ── Problems the calendar ran into ──────────────────────────────────── */

  const REPORT_LIMIT = 20;
  const reported = new Set();

  /**
   * Write one row to `rc_client_errors`, and never throw.
   *
   * Called from named places in the calendar's own code — a tab that failed to
   * load, an offline outcome the server refused, a look-ahead read that went
   * wrong — and never from a global handler: an error thrown anywhere in the page
   * can carry plan text, and plan data must never reach this project. The same
   * message is reported once per page, and at most twenty per page, so a screen
   * failing on every re-render cannot fill the table. Reporting a failure must
   * never be a second failure, so everything here is swallowed.
   */
  function reportError(area, err) {
    try {
      if (!client || !user || preview) return;
      const message = String(err?.message || err || 'unknown').slice(0, 500) || 'unknown';
      const key = `${area}\u0000${message}`;
      if (reported.has(key) || reported.size >= REPORT_LIMIT) return;
      reported.add(key);
      const shell = typeof window !== 'undefined' ? window.CX_SHELL : null;
      const row = {
        area: String(area).slice(0, 60),
        message,
        created_by: user.id,
        app_version: String(shell?.version || (typeof window !== 'undefined' && window.CX_CONFIG?.version) || '').slice(0, 40) || null,
        user_agent: typeof navigator !== 'undefined' ? String(navigator.userAgent).slice(0, 300) : null,
      };
      Promise.resolve(client.from('rc_client_errors').insert([row]))
        .then(() => forgetReads(), () => {})
        .catch(() => {});
    } catch {
      /* reporting a failure must never be a second one */
    }
  }

  /** The newest problems reported, for an administrator. */
  function listClientErrors(limit = 100) {
    return select('rc_client_errors', (q) => q.order('created_at', { ascending: false }).limit(limit));
  }

  /** Clear what was reported before a moment; answers how many rows went. */
  const clearClientErrors = (before) => rpc('rc_clear_client_errors', { p_before: before });

  function listSettings() {
    return select('rc_settings');
  }

  /**
   * The database version this build of the calendar expects.
   *
   * `rc_schema.sql` stamps its own number into `rc_settings.schema_version` as
   * its very last statement, so a run that stopped half way does not claim to
   * have finished. Raise both together — `tools/test_sql.js` fails when they
   * differ. A column the database has never heard of used to surface as
   * "could not update the legend", on one screen, weeks after the deploy that
   * needed it; this turns it into one sentence at sign-in naming the two files.
   */
  const SCHEMA_VERSION = 9;

  /**
   * Whether the database is the one this build was written against.
   *
   * `behind` is the common case — the site deployed and nobody ran the SQL —
   * and a project from before the stamp existed reads as version 0. `ahead`
   * means the page is older than the database, which is a stale tab or a
   * desktop copy that has not fetched its update yet. A read that fails answers
   * `unknown` rather than guessing: the calendar has its own ways of saying the
   * database is unreachable, and a second one here would only compete.
   */
  async function schemaStatus() {
    let rows;
    try {
      rows = await listSettings();
    } catch {
      return { state: 'unknown', expected: SCHEMA_VERSION, found: null };
    }
    const row = (rows || []).find((r) => r.key === 'schema_version');
    const found = row ? Number.parseInt(row.value, 10) || 0 : 0;
    const state = found === SCHEMA_VERSION ? 'current' : found < SCHEMA_VERSION ? 'behind' : 'ahead';
    return { state, expected: SCHEMA_VERSION, found };
  }

  function listLeaveKinds() {
    return select('rc_leave_kinds', (q) => q.eq('active', true).order('name'));
  }

  /** Leave overlapping a window. Both ends are inclusive, as a calendar is. */
  /**
   * Leave awaiting an answer, whoever it belongs to.
   *
   * Its own read rather than a filter over `listLeave()`, because the question is
   * about the whole register and not about a window: a request for October made
   * today is a thing an administrator has to answer today, and a window that only
   * covers the weeks on screen would hide it until it was too late to matter.
   */
  function pendingLeave() {
    return select('rc_leave', (q) => q.eq('status', 'requested').order('start_date'));
  }

  /**
   * One person's leave from a date on, whatever its answer — the phone's "your
   * time off". Declined rows stay in, because "they said no" is the answer
   * somebody opened this to find; withdrawn ones do not, because the person who
   * withdrew it already knows.
   */
  function leaveFor(personId, fromISO) {
    return select('rc_leave', (q) =>
      q.eq('person_id', personId).gte('end_date', fromISO).neq('status', 'cancelled').order('start_date'));
  }

  function listLeave(fromISO, toISO) {
    return select('rc_leave', (q) =>
      q.lte('start_date', toISO).gte('end_date', fromISO).neq('status', 'cancelled'));
  }

  /**
   * The current plan across a date range.
   *
   * Reads the view, never the table: the table keeps every revision, and asking
   * it directly would return the superseded rows alongside the live ones.
   */
  function listPlan(fromISO, toISO) {
    return select('rc_plan_current', (q) =>
      q.gte('work_date', fromISO).lte('work_date', toISO).order('work_date'));
  }

  /** Every revision of one day, oldest first — the audit trail for a claim. */
  function planHistory(personId, dateISO) {
    return select('rc_plan_entries', (q) =>
      q.eq('person_id', personId).eq('work_date', dateISO).order('created_at'));
  }

  /**
   * Outcomes, as they stand.
   *
   * The view, never the table: a corrected outcome is a new row pointing at the
   * old one, and the table keeps both. Reading it directly would put two answers
   * against one person for one day and let whichever came last win.
   */
  function listActuals(fromISO, toISO) {
    return select('rc_actuals_current', (q) =>
      q.gte('work_date', fromISO).lte('work_date', toISO).order('work_date'));
  }

  /**
   * Look-ahead rows by id — for tracing an outcome to the row it was recorded
   * against. Asked in slices so a long list of ids never makes an overlong URL.
   */
  async function lookaheadRowsByIds(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const out = [];
    for (let i = 0; i < unique.length; i += 200) {
      const slice = unique.slice(i, i + 200);
      out.push(...(await select('rc_lookahead_rows', (q) => q.in('id', slice), { columns: 'id,raw_label,raw_location,snapshot_id,sheet_row' })));
    }
    return out;
  }

  /** Carried tasks, oldest first — a chain on its fifth day is the headline. */
  /**
   * Blockers, as they stand.
   *
   * The view, never the tables: the tables keep every step of the chase and the
   * view is what is true now. Readable by everybody signed in, because a blocker
   * nobody can see is one nobody chases.
   */
  function listBlockers({ openOnly = true } = {}) {
    return select('rc_blockers_current', (q) =>
      (openOnly ? q.eq('state', 'open') : q).order('raised_on'));
  }

  /** Every step of one blocker's history, oldest first. */
  function blockerHistory(blockerId) {
    return select('rc_blocker_updates', (q) =>
      q.eq('blocker_id', blockerId).order('created_at'));
  }

  const raiseBlocker = (row) => insert('rc_blockers', [row]).then((r) => r[0]);
  /* Append, never edit. Taking it on, moving the date, chasing it and closing it
     are each a row — the history is the evidence a claim is built from. */
  const updateBlocker = (row) => insert('rc_blocker_updates', [row]).then((r) => r[0]);

  function listCarryChains() {
    return select('rc_carry_chains', (q) => q.order('age_days', { ascending: false }));
  }

  /** The KPI base. Empty for a member, by policy rather than by omission. */
  function listEffort(fromISO, toISO) {
    return select('rc_effort', (q) =>
      q.gte('work_date', fromISO).lte('work_date', toISO).order('work_date'));
  }

  function listIngestRuns({ limit = 100 } = {}) {
    return select('rc_ingest_runs', (q) => q.order('ran_at', { ascending: false }).limit(limit));
  }

  /**
   * The snapshots, newest first, **without their grids**.
   *
   * A grid is the whole parsed workbook and it is the one large column in the
   * schema. Every screen that reads the sheet used to ask for twenty of them and
   * use one; the history list asked for forty to print two numbers off each.
   * That was most of the wait between tabs. This reads the metadata view, which
   * carries those two numbers computed in the database, and the one grid
   * anybody actually draws comes from `latestSnapshot()`.
   */
  function listSnapshotMeta({ limit = 50 } = {}) {
    return select('rc_lookahead_snapshot_meta', (q) => q.order('taken_at', { ascending: false }).limit(limit));
  }

  /** The newest snapshot with its grid, or null. The only full-grid read there is. */
  function latestSnapshot() {
    return select('rc_lookahead_snapshots', (q) => q.order('taken_at', { ascending: false }).limit(1))
      .then((rows) => rows[0] || null);
  }

  /**
   * The newest reading's id, asked afresh every time — an open calendar asks it
   * every few seconds, to notice that the editor published, and a remembered
   * answer would hide exactly that. A read, so it leaves the cache alone.
   */
  async function newestSnapshotId() {
    requireClient();
    const { data, error } = await client.from('rc_lookahead_snapshot_meta')
      .select('id').order('taken_at', { ascending: false }).limit(1);
    if (error) throw new Error(`rc_lookahead_snapshot_meta: ${error.message}`);
    return data?.[0]?.id ?? null;
  }

  /**
   * Snapshots with their grids. Kept for anything that genuinely needs several
   * — nothing in the interface does any more, and a caller reaching for this
   * with a limit above one should read `listSnapshotMeta()` instead.
   */
  function listSnapshots({ limit = 1 } = {}) {
    return select('rc_lookahead_snapshots', (q) => q.order('taken_at', { ascending: false }).limit(limit));
  }

  /** One snapshot with its grid, by id — for re-deriving what a past read said. */
  function snapshotById(id) {
    return select('rc_lookahead_snapshots', (q) => q.eq('id', id).limit(1)).then((rows) => rows[0] || null);
  }

  function listSnapshotRows(snapshotId) {
    return select('rc_lookahead_rows', (q) => q.eq('snapshot_id', snapshotId).order('sheet_row'));
  }

  function listChangeEvents(fromISO, toISO) {
    return select('rc_change_events', (q) =>
      q.gte('detected_at', fromISO).lte('detected_at', toISO).order('detected_at', { ascending: false }));
  }

  function listAnnotations(eventIds) {
    return select('rc_change_annotations', (q) => q.in('change_event_id', eventIds).order('created_at'));
  }

  /**
   * Every day any read showed painted as a cancellation, from `fromISO` on.
   * One row per activity, location and day — `cancellationEvents()` in
   * `core/lookahead.js` joins side-by-side days into one event.
   */
  function listCancelledDays(fromISO) {
    return select('rc_cancelled_days', (q) => q.gte('day', fromISO).order('day'));
  }

  /**
   * Every day a read showed a BART resource struck out ("X.~WIT") on an activity
   * that was not itself cancelled — `supportCancellationEvents()` joins them.
   */
  function listCancelledSupportDays(fromISO) {
    return select('rc_cancelled_support_days', (q) => q.gte('day', fromISO).order('day'));
  }

  /** What somebody said about a cancellation, every version. Newest last. */
  function listCancellationNotes() {
    return select('rc_cancellation_notes', (q) => q.order('created_at'));
  }

  function listSars() {
    return select('rc_sars', (q) => q.is('superseded_by', null).order('week_start', { ascending: false }));
  }

  function listSarLinks() {
    return select('rc_sar_links', (q) => q.order('confirmed_at'));
  }

  /** Work planned into a week with no SAR — access that was never confirmed. */
  function listRowsWithoutSar() {
    return select('rc_rows_without_sar', (q) => q.order('week_start'));
  }

  /** The mirror: access booked for work that has since gone. */
  function listSarsWithoutRows() {
    return select('rc_sars_without_rows', (q) => q.order('week_start'));
  }

  /* ── Writing ───────────────────────────────────────────────────────────── */

  /**
   * Insert rows and return them.
   *
   * A refused INSERT does raise — the WITH CHECK clause fails — so unlike an
   * UPDATE this one can be trusted to report its own failure. The append-only
   * tables have no UPDATE or DELETE privilege at all, so there is deliberately
   * no `update()` here for them to be reached through.
   */
  async function insert(table, rows) {
    requireClient();
    guardPreview();
    forgetReads();
    const { data, error } = await client.from(table).insert(rows).select();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data || [];
  }

  /* Functions that only read, and so are allowed while previewing. */
  const READ_ONLY_RPC = new Set(['rc_list_invitations', 'rc_resolve_location']);

  async function rpc(name, args) {
    requireClient();
    /* Every function here that is not a pure read writes something, so it
       forgets what was read. A pure read must not: the administrator's inbox
       lists invitations every time it refreshes, and forgetting there emptied
       the read memory on every tab switch — the calendar re-read the roster, the
       plan and the sheet each time, which is the wait the memory exists to
       remove. */
    if (!READ_ONLY_RPC.has(name)) {
      guardPreview();
      forgetReads();
    }
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  }

  /**
   * Update reference data.
   *
   * Only ever used on the vocabularies, never on a plan entry or an outcome. A
   * refused UPDATE matches nothing and reports success, so this checks the
   * returned row count and raises instead — the same reason every plan save goes
   * through `save_project()` on the other side of the application.
   */
  async function update(table, id, patch) {
    requireClient();
    guardPreview();
    forgetReads();
    const { data, error } = await client.from(table).update(patch).eq('id', id).select();
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || !data.length) {
      throw new Error(`${table}: that change was refused — you may not have permission.`);
    }
    return data[0];
  }

  const addPerson = (row) => insert('rc_people', [row]).then((r) => r[0]);
  const updatePerson = (id, patch) => update('rc_people', id, patch);
  const addLocation = (row) => insert('rc_locations', [row]).then((r) => r[0]);
  const updateLocation = (id, patch) => update('rc_locations', id, patch);
  const addLocationAlias = (locationId, alias) =>
    insert('rc_location_alias', [{ location_id: locationId, alias }]).then((r) => r[0]);
  const addPersonAlias = (personId, alias) =>
    insert('rc_person_alias', [{ person_id: personId, alias }]).then((r) => r[0]);
  const addCategory = (row) => insert('rc_categories', [row]).then((r) => r[0]);
  const updateCategory = (id, patch) => update('rc_categories', id, patch);
  const addParty = (name) => insert('rc_parties', [{ name }]).then((r) => r[0]);
  /**
   * Map colours, or re-map them.
   *
   * An upsert on `(valid_from, argb)` rather than a plain insert, because that is
   * the table's unique key and mapping the same colour twice in one day is the
   * commonest thing anybody does here — press "Just shading" on a grey, look at
   * the calendar, decide it was actually a shift. As an insert the second attempt
   * violated the constraint and came back as a duplicate-key error, which reads as
   * a broken button rather than as "you already said something about that today".
   *
   * A colour mapped again on a *later* day still gets a row of its own: the
   * register is versioned on purpose, and `applyLegend()` reads the newest.
   */
  async function addLegend(rows) {
    requireClient();
    guardPreview();
    forgetReads();
    const { data, error } = await client
      .from('rc_legend')
      .upsert(rows, { onConflict: 'valid_from,argb' })
      .select();
    if (error) throw new Error(`rc_legend: ${error.message}`);
    return data || [];
  }
  const updateLegend = (id, patch) => update('rc_legend', id, patch);

  /**
   * Delete a reference row outright, where nothing has been recorded against it.
   *
   * Retiring is still the right answer for anything that has been used, and the
   * refusal says so by name. These exist for the row that was never meant: a
   * person added twice, a location typed wrong, a colour mapped by mistake —
   * which retiring only ever turns into a permanent entry in a list of things
   * that used to be true.
   *
   * Functions rather than `.delete()`, for the reason every other write here is a
   * function: a DELETE the policies refuse matches no rows and comes back as
   * success, so the interface would report a deletion that never happened. These
   * raise — over permission, over the last administrator, and over anything
   * pointing at the row — and `rpc()` turns that into a message somebody can act
   * on.
   */
  const deletePerson = (id) => rpc('rc_delete_person', { p_person: id });
  const deleteLocation = (id) => rpc('rc_delete_location', { p_location: id });
  const deleteCategory = (id) => rpc('rc_delete_category', { p_category: id });
  const deleteLegend = (id) => rpc('rc_delete_legend', { p_entry: id });

  /**
   * Write a setting.
   *
   * An upsert rather than an update, because the first time anybody names the
   * sheet there is no row to update — and an UPDATE matching nothing would
   * report success and change nothing, which is the failure this whole schema is
   * arranged to avoid.
   */
  async function setSetting(key, value) {
    requireClient();
    guardPreview();
    forgetReads();
    const { data, error } = await client
      .from('rc_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select();
    if (error) throw new Error(`rc_settings: ${error.message}`);
    if (!data || !data.length) {
      throw new Error('rc_settings: that change was refused — only an administrator may set this.');
    }
    return data[0];
  }

  /**
   * Book leave, or ask for it.
   *
   * The status is the permission, and the policies are written on exactly that:
   * an administrator may insert any status and the default is `approved`, while a
   * member may insert `requested` for themselves and nothing else. So the caller
   * says which it is — `requestLeave()` below is the member's door, and it exists
   * so no screen has to remember to pass the right string.
   */
  const addLeave = (row) => insert('rc_leave', [row]).then((r) => r[0]);

  /**
   * Ask for leave. The same single `rc_leave` row, as a question.
   *
   * A second table for requests would be a second answer to "is Dana off on
   * Tuesday", which is the thing this module is most careful about — so a request
   * is the row it will become, with `status` saying it has not been answered yet.
   * Approving it is an update an administrator makes; there is nothing to copy
   * across and nothing that can go missing in between.
   */
  const requestLeave = (row) =>
    insert('rc_leave', [{ ...row, status: 'requested' }]).then((r) => r[0]);
  const updateLeave = (id, patch) => update('rc_leave', id, patch);

  const addPlanEntries = (rows) => insert('rc_plan_entries', rows);

  /** Every look-ahead row for a week, so the plan can be proposed from it. */
  function lookaheadForWeek(weekStartISO) {
    return select('rc_lookahead_rows', (q) => q.eq('week_start', weekStartISO).order('sheet_row'));
  }

  /**
   * Look-ahead rows across a span of weeks.
   *
   * The Resources view answers "where is everybody, for the weeks that matter",
   * which is several weeks at once — asking week by week would be one round trip
   * per column. Rows from every snapshot come back, so the caller keeps the newest
   * per `row_key`: an older snapshot's copy of a week is history, not a second
   * assignment.
   */
  function lookaheadBetween(fromISO, toISO) {
    return select('rc_lookahead_rows', (q) =>
      q.gte('week_start', fromISO).lte('week_start', toISO).order('sheet_row'));
  }

  /**
   * Revise a day. Returns the id of the new entry.
   *
   * Not an update: the outgoing row stays, and the new one points at it. A plan
   * that changed the evening before a shift is itself delay evidence, and there
   * is no way to spend it twice — revising an already-revised entry raises.
   */
  const supersedePlan = (entryId, { locationId = null, task = null, categoryId = null, shift = 'day' } = {}) =>
    rpc('rc_supersede_plan', {
      p_entry: entryId,
      p_location: locationId,
      p_task: task,
      p_category: categoryId,
      p_shift: shift,
    });

  /**
   * Withdraw a day. Returns the id of the tombstone.
   *
   * "Delete my task" with the record kept, which is the only shape a delete takes
   * here: there is no DELETE grant on `rc_plan_entries`, so this writes a row
   * superseding the original and marked withdrawn, and `rc_plan_current` drops the
   * pair. The schedule stops showing the day; the table still says it was planned
   * and then withdrawn, by whom and when.
   *
   * Whoever may plan a day may withdraw it — a member their own, an administrator
   * anybody's — which is the same question the insert policy asks.
   */
  const withdrawPlan = (entryId) => rpc('rc_withdraw_plan', { p_entry: entryId });

  /**
   * Move a day to the person the look-ahead now names. Returns the new entry's id.
   *
   * An administrator's: it writes a day against somebody else, which is the whole
   * point. Refuses a move onto the person who already has it, so a re-read that
   * changed nothing writes nothing — otherwise every ingest would supersede every
   * linked entry with a revision saying the same thing.
   */
  const reassignPlan = (entryId, personId) =>
    rpc('rc_reassign_plan', { p_entry: entryId, p_person: personId });

  /**
   * Record one huddle outcome. Idempotent on `clientUuid`.
   *
   * That uuid is generated before the row is sent, which is what lets the huddle
   * screen queue entries locally and replay them when the connection returns.
   * The meeting is at a fixed time whether or not the network is up.
   */
  const recordActual = ({
    clientUuid, personId, date, status,
    categoryId = null, locationId = null, note = null,
    blockedReason = null, blockedPartyId = null,
    carryChainId = null, planEntryId = null, shift = 'day',
    lookaheadRowId = null, evidencePath = null, supersedesId = null, task = null,
  }) =>
    rpc('rc_record_actual', {
      p_client_uuid: clientUuid,
      p_person: personId,
      p_date: date,
      p_status: status,
      p_category: categoryId,
      p_location: locationId,
      p_note: note,
      p_blocked_reason: blockedReason,
      p_blocked_party: blockedPartyId,
      p_carry_chain: carryChainId,
      p_plan_entry: planEntryId,
      p_shift: shift,
      p_lookahead_row: lookaheadRowId,
      p_evidence: evidencePath,
      // The outcome this one corrects. The function refuses a row that has
      // already been corrected, so two edits of one outcome cannot both land.
      p_supersedes: supersedesId,
      // What they actually did, in words — the one statement of the work on a day
      // with nothing planned.
      p_task: task,
    });

  const resolveLocation = (raw) => rpc('rc_resolve_location', { p_raw: raw });

  const addIngestRun = (row) => insert('rc_ingest_runs', [row]).then((r) => r[0]);
  const addSnapshot = (row) => insert('rc_lookahead_snapshots', [row]).then((r) => r[0]);
  const addSnapshotRows = (rows) => insert('rc_lookahead_rows', rows);
  const addChangeEvents = (rows) => insert('rc_change_events', rows);
  const addSar = (row) => insert('rc_sars', [row]).then((r) => r[0]);
  /* Only ever to attach the storage path once the PDF is up. A SAR's terms are
     never edited — an amended one is a new revision that supersedes it, which is
     what `superseded_by` is for. */
  const updateSar = (id, patch) => update('rc_sars', id, patch);
  const addSarLinks = (rows) => insert('rc_sar_links', rows);

  /**
   * Annotate a change event: who caused a cancellation, which removal and
   * addition were really one crew moving site.
   *
   * Insert only. Correcting one means adding another that supersedes it, because
   * this is the record a delay claim gets challenged on and a judgement that
   * could be quietly rewritten a year later would be worth nothing.
   */
  const addAnnotation = (row) => insert('rc_change_annotations', [row]).then((r) => r[0]);

  /**
   * Record whose cancellation it was, and why. Append-only: a correction is a
   * new row carrying `supersedes_id`, never an edit.
   */
  /**
   * Replace what a stored row says each day was painted as. Only ever the
   * re-derivation of a past read under today's rules — `cells` is derived from
   * the snapshot, which is the durable record, so refining a rule means writing
   * the derivation again rather than migrating anything.
   */
  const updateLookaheadRowCells = (id, cells) => update('rc_lookahead_rows', id, { cells });

  const addCancellationNote = (row) => insert('rc_cancellation_notes', [row]).then((r) => r[0]);

  /* ── Accounts ──────────────────────────────────────────────────────────── */

  /**
   * Who may have an account, and what they may do with it.
   *
   * Supabase Auth still holds the password — `auth.uid()` is what every policy
   * in `rc_schema.sql` keys on, so the permission model *is* the authentication
   * and replacing it would mean rewriting all of it. What is managed from here
   * is the part that is genuinely ours: who is allowed to create an account at
   * all, which roster row it lands on, and what role it carries.
   *
   * Every one of these is a `security definer` function rather than a table
   * write, for the reason this whole schema is built on: a refused UPDATE
   * matches nothing and reports success, so an administrator demoting the last
   * administrator by accident would be told it worked.
   */
  const invite = (email, role = 'viewer', personId = null, note = null) =>
    rpc('rc_invite', {
      p_email: email,
      p_role: role,
      p_person: personId || null,
      p_note: note || null,
    }).then((rows) => (Array.isArray(rows) ? rows[0] : rows));

  const revokeInvitation = (email) => rpc('rc_revoke_invitation', { p_email: email });

  const listInvitations = () => rpc('rc_list_invitations').then((rows) => rows || []);

  const linkAccount = (personId, email) =>
    rpc('rc_link_account', { p_person: personId, p_email: email });

  const setRole = (personId, role) =>
    rpc('rc_set_role', { p_person: personId, p_role: role });

  /**
   * Re-read your own team record.
   *
   * Changing a role changes what the interface may draw, and an administrator
   * who demotes themselves must see that immediately rather than at the next
   * sign-in — otherwise the page keeps offering actions the database has already
   * started refusing.
   */
  async function refreshMe() {
    await refreshPerson();
    emit(EV.RC_AUTH_CHANGED, { user, event: 'ROLE_CHANGED' });
    return person;
  }

  /* ── Storage ───────────────────────────────────────────────────────────── */

  /**
   * Upload a SAR PDF so it opens in the deputy's browser.
   *
   * Only SARs. The look-ahead workbook is deliberately *not* uploaded: a .xlsx
   * carries every other tab, hidden row, comment and forgotten pasted sheet
   * along with the part that was wanted, and the only thing anyone needs from it
   * is the parsed grid, which goes up as JSON. The bytes stay in the OneDrive
   * archive.
   */
  async function uploadSar(path, blob) {
    requireClient();
    guardPreview();
    const { error } = await client.storage.from('sars').upload(path, blob, {
      upsert: false,
      contentType: blob?.type || 'application/pdf',
    });
    if (error) throw new Error(`upload: ${error.message}`);
    return path;
  }

  /**
   * Upload the photograph taken with an outcome.
   *
   * Before the row, never after: `rc_actuals` has no UPDATE grant, so a path
   * attached afterwards would need a second row superseding the first. The name
   * is the client uuid the outcome is about to be written with, which is
   * generated on the client precisely so it exists before the insert does.
   *
   * A failure here is not a failure of the meeting. The caller records the
   * outcome either way and says the picture did not go up — losing what somebody
   * said because a photograph did not upload would be the wrong way round.
   */
  async function uploadEvidence(path, blob) {
    requireClient();
    guardPreview();
    const { error } = await client.storage.from('evidence').upload(path, blob, {
      upsert: false,
      contentType: blob?.type || 'image/jpeg',
    });
    if (error) throw new Error(`upload: ${error.message}`);
    return path;
  }

  async function evidenceUrl(path, seconds = 3600) {
    requireClient();
    const { data, error } = await client.storage.from('evidence').createSignedUrl(path, seconds);
    if (error) throw new Error(`link: ${error.message}`);
    return data.signedUrl;
  }

  async function sarUrl(path, seconds = 3600) {
    requireClient();
    const { data, error } = await client.storage.from('sars').createSignedUrl(path, seconds);
    if (error) throw new Error(`link: ${error.message}`);
    return data.signedUrl;
  }

  /* ── Track access work requests ────────────────────────────────────────────
     All of it an administrator's: the requests, the contacts, the wording, the
     signatures and BART's blank form. The policies are the control — a member
     reads nothing here and writes nothing — and these are the doors. */

  /** The live requests (drafts and approved) for one week, by its Monday. */
  function listTawrs(weekStartISO) {
    return select('rc_tawrs', (q) => q.eq('week_start', weekStartISO).neq('status', 'superseded').order('created_at'));
  }

  /** Every live request from a Monday on — what the week list counts. */
  function listTawrsFrom(fromISO) {
    return select('rc_tawrs', (q) => q.gte('week_start', fromISO).neq('status', 'superseded').order('week_start'));
  }

  const addTawr = (row) => insert('rc_tawrs', [row]).then((r) => r[0]);
  const updateTawr = (id, patch) => update('rc_tawrs', id, patch);

  /** Throw a draft away. An approved request cannot be: the policy matches nothing, and this says so. */
  async function discardTawr(id) {
    requireClient();
    guardPreview();
    forgetReads();
    const { data, error } = await client.from('rc_tawrs').delete().eq('id', id).select();
    if (error) throw new Error(`rc_tawrs: ${error.message}`);
    if (!data || !data.length) throw new Error('That request was not discarded — only a draft can be.');
    return data[0];
  }

  /** Supersede an approved request with a draft carrying its fields; answers the draft's id. */
  const reviseTawr = (id) => rpc('rc_tawr_revise', { p_tawr: id });

  function listTawrSettings() {
    return select('rc_tawr_settings');
  }

  /** Write one TAWR setting — an upsert, for the reason `setSetting()` is one. */
  async function setTawrSetting(key, value) {
    requireClient();
    guardPreview();
    forgetReads();
    const { data, error } = await client
      .from('rc_tawr_settings')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select();
    if (error) throw new Error(`rc_tawr_settings: ${error.message}`);
    if (!data || !data.length) throw new Error('rc_tawr_settings: that change was refused — only an administrator may set this.');
    return data[0];
  }

  /** Every administrator's requestor details and signature. */
  function listTawrProfiles() {
    return select('rc_tawr_profiles');
  }

  /** Save the caller's own requestor details and signature. */
  async function saveTawrProfile(patch) {
    requireClient();
    guardPreview();
    forgetReads();
    const who = me();
    if (!who) throw new Error('Only somebody on the team has a TAWR profile.');
    const { data, error } = await client
      .from('rc_tawr_profiles')
      .upsert({ ...patch, person_id: who.id, updated_at: new Date().toISOString() }, { onConflict: 'person_id' })
      .select();
    if (error) throw new Error(`rc_tawr_profiles: ${error.message}`);
    if (!data || !data.length) throw new Error('rc_tawr_profiles: that change was refused — only an administrator has one.');
    return data[0];
  }

  function listTawrDescriptions() {
    return select('rc_tawr_descriptions', (q) => q.order('activity'));
  }
  const addTawrDescription = (row) => insert('rc_tawr_descriptions', [row]).then((r) => r[0]);
  const updateTawrDescription = (id, patch) => update('rc_tawr_descriptions', id, { ...patch, updated_at: new Date().toISOString() });

  async function deleteTawrDescription(id) {
    requireClient();
    guardPreview();
    forgetReads();
    const { data, error } = await client.from('rc_tawr_descriptions').delete().eq('id', id).select();
    if (error) throw new Error(`rc_tawr_descriptions: ${error.message}`);
    if (!data || !data.length) throw new Error('That wording was not removed — you may not have permission.');
    return data[0];
  }

  const TAWR_TEMPLATE = 'template/tawr.pdf';

  /** Put BART's blank form in the private bucket, replacing the one there. */
  async function uploadTawrTemplate(blob) {
    requireClient();
    guardPreview();
    const { error } = await client.storage.from('tawr').upload(TAWR_TEMPLATE, blob, {
      upsert: true,
      contentType: 'application/pdf',
    });
    if (error) throw new Error(`upload: ${error.message}`);
    return TAWR_TEMPLATE;
  }

  /** BART's blank form, as bytes; null when none has been uploaded. */
  async function downloadTawrTemplate() {
    requireClient();
    const { data, error } = await client.storage.from('tawr').download(TAWR_TEMPLATE);
    if (error) {
      if (/not found|does not exist|404/i.test(String(error.message || error.statusCode || ''))) return null;
      throw new Error(`download: ${error.message}`);
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  Object.defineProperty(__x, "isConfigured", { get: () => isConfigured, enumerable: true });
  Object.defineProperty(__x, "init", { get: () => init, enumerable: true });
  Object.defineProperty(__x, "raw", { get: () => raw, enumerable: true });
  Object.defineProperty(__x, "currentUser", { get: () => currentUser, enumerable: true });
  Object.defineProperty(__x, "isSignedIn", { get: () => isSignedIn, enumerable: true });
  Object.defineProperty(__x, "me", { get: () => me, enumerable: true });
  Object.defineProperty(__x, "previewAs", { get: () => previewAs, enumerable: true });
  Object.defineProperty(__x, "previewing", { get: () => previewing, enumerable: true });
  Object.defineProperty(__x, "isRealAdmin", { get: () => isRealAdmin, enumerable: true });
  Object.defineProperty(__x, "isAdmin", { get: () => isAdmin, enumerable: true });
  Object.defineProperty(__x, "role", { get: () => role, enumerable: true });
  Object.defineProperty(__x, "canWrite", { get: () => canWrite, enumerable: true });
  Object.defineProperty(__x, "isViewer", { get: () => isViewer, enumerable: true });
  Object.defineProperty(__x, "accountLabel", { get: () => accountLabel, enumerable: true });
  Object.defineProperty(__x, "signIn", { get: () => signIn, enumerable: true });
  Object.defineProperty(__x, "signUp", { get: () => signUp, enumerable: true });
  Object.defineProperty(__x, "signOut", { get: () => signOut, enumerable: true });
  Object.defineProperty(__x, "forgetReads", { get: () => forgetReads, enumerable: true });
  Object.defineProperty(__x, "listPeople", { get: () => listPeople, enumerable: true });
  Object.defineProperty(__x, "listLocations", { get: () => listLocations, enumerable: true });
  Object.defineProperty(__x, "listLocationAliases", { get: () => listLocationAliases, enumerable: true });
  Object.defineProperty(__x, "listPersonAliases", { get: () => listPersonAliases, enumerable: true });
  Object.defineProperty(__x, "listCategories", { get: () => listCategories, enumerable: true });
  Object.defineProperty(__x, "listParties", { get: () => listParties, enumerable: true });
  Object.defineProperty(__x, "listLegend", { get: () => listLegend, enumerable: true });
  Object.defineProperty(__x, "exportEverything", { get: () => exportEverything, enumerable: true });
  Object.defineProperty(__x, "listLaRows", { get: () => listLaRows, enumerable: true });
  Object.defineProperty(__x, "listLaCells", { get: () => listLaCells, enumerable: true });
  Object.defineProperty(__x, "applyLookaheadOps", { get: () => applyLookaheadOps, enumerable: true });
  Object.defineProperty(__x, "lookaheadRevision", { get: () => lookaheadRevision, enumerable: true });
  Object.defineProperty(__x, "listLaEdits", { get: () => listLaEdits, enumerable: true });
  Object.defineProperty(__x, "listLaEditsForRow", { get: () => listLaEditsForRow, enumerable: true });
  Object.defineProperty(__x, "compactSnapshots", { get: () => compactSnapshots, enumerable: true });
  Object.defineProperty(__x, "lastSeen", { get: () => lastSeen, enumerable: true });
  Object.defineProperty(__x, "listSeen", { get: () => listSeen, enumerable: true });
  Object.defineProperty(__x, "markSeen", { get: () => markSeen, enumerable: true });
  Object.defineProperty(__x, "snapshotRows", { get: () => snapshotRows, enumerable: true });
  Object.defineProperty(__x, "listSupportCodes", { get: () => listSupportCodes, enumerable: true });
  Object.defineProperty(__x, "addSupportCode", { get: () => addSupportCode, enumerable: true });
  Object.defineProperty(__x, "updateSupportCode", { get: () => updateSupportCode, enumerable: true });
  Object.defineProperty(__x, "reportError", { get: () => reportError, enumerable: true });
  Object.defineProperty(__x, "listClientErrors", { get: () => listClientErrors, enumerable: true });
  Object.defineProperty(__x, "clearClientErrors", { get: () => clearClientErrors, enumerable: true });
  Object.defineProperty(__x, "listSettings", { get: () => listSettings, enumerable: true });
  Object.defineProperty(__x, "SCHEMA_VERSION", { get: () => SCHEMA_VERSION, enumerable: true });
  Object.defineProperty(__x, "schemaStatus", { get: () => schemaStatus, enumerable: true });
  Object.defineProperty(__x, "listLeaveKinds", { get: () => listLeaveKinds, enumerable: true });
  Object.defineProperty(__x, "pendingLeave", { get: () => pendingLeave, enumerable: true });
  Object.defineProperty(__x, "leaveFor", { get: () => leaveFor, enumerable: true });
  Object.defineProperty(__x, "listLeave", { get: () => listLeave, enumerable: true });
  Object.defineProperty(__x, "listPlan", { get: () => listPlan, enumerable: true });
  Object.defineProperty(__x, "planHistory", { get: () => planHistory, enumerable: true });
  Object.defineProperty(__x, "listActuals", { get: () => listActuals, enumerable: true });
  Object.defineProperty(__x, "lookaheadRowsByIds", { get: () => lookaheadRowsByIds, enumerable: true });
  Object.defineProperty(__x, "listBlockers", { get: () => listBlockers, enumerable: true });
  Object.defineProperty(__x, "blockerHistory", { get: () => blockerHistory, enumerable: true });
  Object.defineProperty(__x, "raiseBlocker", { get: () => raiseBlocker, enumerable: true });
  Object.defineProperty(__x, "updateBlocker", { get: () => updateBlocker, enumerable: true });
  Object.defineProperty(__x, "listCarryChains", { get: () => listCarryChains, enumerable: true });
  Object.defineProperty(__x, "listEffort", { get: () => listEffort, enumerable: true });
  Object.defineProperty(__x, "listIngestRuns", { get: () => listIngestRuns, enumerable: true });
  Object.defineProperty(__x, "listSnapshotMeta", { get: () => listSnapshotMeta, enumerable: true });
  Object.defineProperty(__x, "latestSnapshot", { get: () => latestSnapshot, enumerable: true });
  Object.defineProperty(__x, "newestSnapshotId", { get: () => newestSnapshotId, enumerable: true });
  Object.defineProperty(__x, "listSnapshots", { get: () => listSnapshots, enumerable: true });
  Object.defineProperty(__x, "snapshotById", { get: () => snapshotById, enumerable: true });
  Object.defineProperty(__x, "listSnapshotRows", { get: () => listSnapshotRows, enumerable: true });
  Object.defineProperty(__x, "listChangeEvents", { get: () => listChangeEvents, enumerable: true });
  Object.defineProperty(__x, "listAnnotations", { get: () => listAnnotations, enumerable: true });
  Object.defineProperty(__x, "listCancelledDays", { get: () => listCancelledDays, enumerable: true });
  Object.defineProperty(__x, "listCancelledSupportDays", { get: () => listCancelledSupportDays, enumerable: true });
  Object.defineProperty(__x, "listCancellationNotes", { get: () => listCancellationNotes, enumerable: true });
  Object.defineProperty(__x, "listSars", { get: () => listSars, enumerable: true });
  Object.defineProperty(__x, "listSarLinks", { get: () => listSarLinks, enumerable: true });
  Object.defineProperty(__x, "listRowsWithoutSar", { get: () => listRowsWithoutSar, enumerable: true });
  Object.defineProperty(__x, "listSarsWithoutRows", { get: () => listSarsWithoutRows, enumerable: true });
  Object.defineProperty(__x, "addPerson", { get: () => addPerson, enumerable: true });
  Object.defineProperty(__x, "updatePerson", { get: () => updatePerson, enumerable: true });
  Object.defineProperty(__x, "addLocation", { get: () => addLocation, enumerable: true });
  Object.defineProperty(__x, "updateLocation", { get: () => updateLocation, enumerable: true });
  Object.defineProperty(__x, "addLocationAlias", { get: () => addLocationAlias, enumerable: true });
  Object.defineProperty(__x, "addPersonAlias", { get: () => addPersonAlias, enumerable: true });
  Object.defineProperty(__x, "addCategory", { get: () => addCategory, enumerable: true });
  Object.defineProperty(__x, "updateCategory", { get: () => updateCategory, enumerable: true });
  Object.defineProperty(__x, "addParty", { get: () => addParty, enumerable: true });
  Object.defineProperty(__x, "addLegend", { get: () => addLegend, enumerable: true });
  Object.defineProperty(__x, "updateLegend", { get: () => updateLegend, enumerable: true });
  Object.defineProperty(__x, "deletePerson", { get: () => deletePerson, enumerable: true });
  Object.defineProperty(__x, "deleteLocation", { get: () => deleteLocation, enumerable: true });
  Object.defineProperty(__x, "deleteCategory", { get: () => deleteCategory, enumerable: true });
  Object.defineProperty(__x, "deleteLegend", { get: () => deleteLegend, enumerable: true });
  Object.defineProperty(__x, "setSetting", { get: () => setSetting, enumerable: true });
  Object.defineProperty(__x, "addLeave", { get: () => addLeave, enumerable: true });
  Object.defineProperty(__x, "requestLeave", { get: () => requestLeave, enumerable: true });
  Object.defineProperty(__x, "updateLeave", { get: () => updateLeave, enumerable: true });
  Object.defineProperty(__x, "addPlanEntries", { get: () => addPlanEntries, enumerable: true });
  Object.defineProperty(__x, "lookaheadForWeek", { get: () => lookaheadForWeek, enumerable: true });
  Object.defineProperty(__x, "lookaheadBetween", { get: () => lookaheadBetween, enumerable: true });
  Object.defineProperty(__x, "supersedePlan", { get: () => supersedePlan, enumerable: true });
  Object.defineProperty(__x, "withdrawPlan", { get: () => withdrawPlan, enumerable: true });
  Object.defineProperty(__x, "reassignPlan", { get: () => reassignPlan, enumerable: true });
  Object.defineProperty(__x, "recordActual", { get: () => recordActual, enumerable: true });
  Object.defineProperty(__x, "resolveLocation", { get: () => resolveLocation, enumerable: true });
  Object.defineProperty(__x, "addIngestRun", { get: () => addIngestRun, enumerable: true });
  Object.defineProperty(__x, "addSnapshot", { get: () => addSnapshot, enumerable: true });
  Object.defineProperty(__x, "addSnapshotRows", { get: () => addSnapshotRows, enumerable: true });
  Object.defineProperty(__x, "addChangeEvents", { get: () => addChangeEvents, enumerable: true });
  Object.defineProperty(__x, "addSar", { get: () => addSar, enumerable: true });
  Object.defineProperty(__x, "updateSar", { get: () => updateSar, enumerable: true });
  Object.defineProperty(__x, "addSarLinks", { get: () => addSarLinks, enumerable: true });
  Object.defineProperty(__x, "addAnnotation", { get: () => addAnnotation, enumerable: true });
  Object.defineProperty(__x, "updateLookaheadRowCells", { get: () => updateLookaheadRowCells, enumerable: true });
  Object.defineProperty(__x, "addCancellationNote", { get: () => addCancellationNote, enumerable: true });
  Object.defineProperty(__x, "invite", { get: () => invite, enumerable: true });
  Object.defineProperty(__x, "revokeInvitation", { get: () => revokeInvitation, enumerable: true });
  Object.defineProperty(__x, "listInvitations", { get: () => listInvitations, enumerable: true });
  Object.defineProperty(__x, "linkAccount", { get: () => linkAccount, enumerable: true });
  Object.defineProperty(__x, "setRole", { get: () => setRole, enumerable: true });
  Object.defineProperty(__x, "refreshMe", { get: () => refreshMe, enumerable: true });
  Object.defineProperty(__x, "uploadSar", { get: () => uploadSar, enumerable: true });
  Object.defineProperty(__x, "uploadEvidence", { get: () => uploadEvidence, enumerable: true });
  Object.defineProperty(__x, "evidenceUrl", { get: () => evidenceUrl, enumerable: true });
  Object.defineProperty(__x, "sarUrl", { get: () => sarUrl, enumerable: true });
  Object.defineProperty(__x, "listTawrs", { get: () => listTawrs, enumerable: true });
  Object.defineProperty(__x, "listTawrsFrom", { get: () => listTawrsFrom, enumerable: true });
  Object.defineProperty(__x, "addTawr", { get: () => addTawr, enumerable: true });
  Object.defineProperty(__x, "updateTawr", { get: () => updateTawr, enumerable: true });
  Object.defineProperty(__x, "discardTawr", { get: () => discardTawr, enumerable: true });
  Object.defineProperty(__x, "reviseTawr", { get: () => reviseTawr, enumerable: true });
  Object.defineProperty(__x, "listTawrSettings", { get: () => listTawrSettings, enumerable: true });
  Object.defineProperty(__x, "setTawrSetting", { get: () => setTawrSetting, enumerable: true });
  Object.defineProperty(__x, "listTawrProfiles", { get: () => listTawrProfiles, enumerable: true });
  Object.defineProperty(__x, "saveTawrProfile", { get: () => saveTawrProfile, enumerable: true });
  Object.defineProperty(__x, "listTawrDescriptions", { get: () => listTawrDescriptions, enumerable: true });
  Object.defineProperty(__x, "addTawrDescription", { get: () => addTawrDescription, enumerable: true });
  Object.defineProperty(__x, "updateTawrDescription", { get: () => updateTawrDescription, enumerable: true });
  Object.defineProperty(__x, "deleteTawrDescription", { get: () => deleteTawrDescription, enumerable: true });
  Object.defineProperty(__x, "uploadTawrTemplate", { get: () => uploadTawrTemplate, enumerable: true });
  Object.defineProperty(__x, "downloadTawrTemplate", { get: () => downloadTawrTemplate, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/icons.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/icons.js"] = function (__x, __req) {
  /**
   * Icon system — inline SVG, themed via `currentColor`.
   *
   * Same approach as cx-portal: a flat map of 24×24 stroke paths rendered into
   * an <svg> on demand, so icons inherit text colour and font size and need no
   * sprite sheet, font file or network request. Every glyph carries search
   * keywords for the icon picker.
   *
   * Imports: nothing (leaf).
   */

  /**
   * name → [pathMarkup, 'search keywords', 'category']
   * Paths use fill="none" stroke="currentColor" unless they set fill inline.
   */
  const ICONS = {
    /* ── Rail & operations ─────────────────────────────────────────────── */
    train: ['<rect x="4" y="3" width="16" height="13" rx="2"/><path d="M4 11h16"/><path d="M9 3v8"/><path d="M15 3v8"/><circle cx="8.5" cy="13.5" r="1"/><circle cx="15.5" cy="13.5" r="1"/><path d="m6 16-2 5"/><path d="m18 16 2 5"/><path d="M8 21h8"/>', 'train rail vehicle metro rolling stock consist', 'Rail'],
    rail: ['<path d="M4 3v18"/><path d="M20 3v18"/><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>', 'rail track sleeper permanent way alignment', 'Rail'],
    signal: ['<rect x="8" y="2" width="8" height="14" rx="4"/><circle cx="12" cy="6" r="1.4"/><circle cx="12" cy="12" r="1.4"/><path d="M12 16v6"/><path d="M9 22h6"/>', 'signal aspect lamp head wayside', 'Rail'],
    switchpoint: ['<path d="M3 18h6l6-12h6"/><path d="M3 12h8"/><path d="m18 3 3 3-3 3"/>', 'switch point turnout junction diverge', 'Rail'],
    platform: ['<path d="M2 16h20"/><path d="M4 16v-4h6v4"/><path d="M14 16v-6h6v6"/><path d="M2 20h20"/>', 'platform station stop halt', 'Rail'],
    tunnel: ['<path d="M4 21V12a8 8 0 0 1 16 0v9"/><path d="M9 21v-9a3 3 0 0 1 6 0v9"/>', 'tunnel bore portal underground', 'Rail'],
    depot: ['<path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-7h6v7"/>', 'depot shed stabling yard building', 'Rail'],
    power: ['<path d="M12 2v8"/><path d="M6 10h12"/><path d="M8 10v4a4 4 0 0 0 8 0v-4"/><path d="M12 18v4"/>', 'power traction catenary substation electrical', 'Rail'],

    /* ── Status & assurance ────────────────────────────────────────────── */
    warning: ['<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 'warning alert caution risk hazard triangle', 'Status'],
    alert: ['<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 'alert warning risk caution', 'Status'],
    check: ['<path d="M20 6 9 17l-5-5"/>', 'check tick done complete pass ok', 'Status'],
    'check-circle': ['<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', 'check circle passed complete approved', 'Status'],
    x: ['<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 'close x cancel remove fail', 'Status'],
    'x-circle': ['<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>', 'fail rejected cancelled error', 'Status'],
    flag: ['<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>', 'flag milestone marker gate', 'Status'],
    bug: ['<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M6 13H2"/><path d="M22 13h-4"/><path d="m6 8-2-1"/><path d="m20 7-2 1"/><path d="m6 18-2 1"/><path d="m20 19-2-1"/>', 'bug defect issue fault ncr', 'Status'],
    shield: ['<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', 'shield safety assurance protection', 'Status'],
    ban: ['<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>', 'blocked banned stop prohibited', 'Status'],
    pause: ['<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>', 'pause hold suspended freeze', 'Status'],
    play: ['<polygon points="6 3 20 12 6 21 6 3"/>', 'play start run go', 'Status'],
    scale: ['<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>', 'decision scale balance judgement approval', 'Status'],

    /* ── Time ──────────────────────────────────────────────────────────── */
    calendar: ['<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>', 'calendar date schedule plan', 'Time'],
    'calendar-check': ['<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>', 'calendar complete scheduled confirmed', 'Time'],
    clock: ['<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', 'clock time duration hours', 'Time'],
    timer: ['<path d="M10 2h4"/><path d="M12 14v-4"/><circle cx="12" cy="14" r="8"/>', 'timer countdown remaining deadline', 'Time'],
    history: ['<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>', 'history version revision previous restore', 'Time'],
    hourglass: ['<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22"/><path d="M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>', 'hourglass elapsed slip float duration', 'Time'],

    /* ── Systems & infrastructure ──────────────────────────────────────── */
    database: ['<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>', 'database data store sql records', 'Systems'],
    server: ['<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>', 'server rack host machine scada', 'Systems'],
    laptop: ['<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9"/><path d="M2 16h20l-1.4 3a2 2 0 0 1-1.8 1H5.2a2 2 0 0 1-1.8-1z"/>', 'laptop computer workstation terminal', 'Systems'],
    monitor: ['<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>', 'monitor display screen hmi console', 'Systems'],
    cloud: ['<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.98A6 6 0 0 0 6.2 9.5 4.5 4.5 0 0 0 6.5 19z"/>', 'cloud remote hosted saas', 'Systems'],
    network: ['<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4"/><path d="M5 16v-2h14v2"/>', 'network topology lan comms backbone', 'Systems'],
    wifi: ['<path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M8.5 16.4a6 6 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M12 20h.01"/>', 'wifi radio wireless coverage comms', 'Systems'],
    cpu: ['<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>', 'cpu processor board hardware ixl', 'Systems'],
    cable: ['<path d="M4 9a5 5 0 0 1 5-5v0a5 5 0 0 1 5 5v6a5 5 0 0 0 5 5v0a5 5 0 0 0 5-5"/><path d="M2 9h4"/><path d="M18 15h4"/>', 'cable wiring loom harness connection', 'Systems'],
    antenna: ['<path d="M12 12v10"/><path d="m8 8 4 4 4-4"/><path d="M5 5a9 9 0 0 1 14 0"/><path d="M2 2a13 13 0 0 1 20 0"/>', 'antenna radio transmitter balise', 'Systems'],

    /* ── Objects & content ─────────────────────────────────────────────── */
    document: ['<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>', 'document file paper spec report', 'Content'],
    file: ['<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>', 'file document attachment', 'Content'],
    folder: ['<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>', 'folder directory group set', 'Content'],
    clipboard: ['<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>', 'clipboard test procedure checklist package', 'Content'],
    package: ['<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>', 'package release build software version drop', 'Content'],
    camera: ['<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>', 'camera photo evidence capture', 'Content'],
    image: ['<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>', 'image picture photo drawing', 'Content'],
    comment: ['<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 'comment note sticky remark message', 'Content'],
    bulb: ['<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>', 'idea callout insight lightbulb highlight', 'Content'],
    paperclip: ['<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>', 'attachment clip file link', 'Content'],
    type: ['<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>', 'text type label caption font', 'Content'],
    table: ['<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/>', 'table grid matrix rows', 'Content'],
    list: ['<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>', 'list bullet items register', 'Content'],
    checklist: ['<path d="M11 6h10"/><path d="M11 12h10"/><path d="M11 18h10"/><path d="m3 6 1.5 1.5L7 5"/><path d="m3 12 1.5 1.5L7 11"/><path d="m3 18 1.5 1.5L7 17"/>', 'checklist tasks todo punch', 'Content'],

    /* ── People & organisation ─────────────────────────────────────────── */
    user: ['<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', 'user person owner engineer assignee', 'People'],
    users: ['<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', 'users team crew customer stakeholders', 'People'],
    share: ['<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4"/><path d="M15.4 6.5l-6.8 4"/>', 'share access permission collaborate invite', 'People'],
    logout: ['<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>', 'logout sign out leave exit account', 'People'],
    building: ['<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M16 14h.01"/>', 'building client office organisation site', 'People'],
    globe: ['<circle cx="12" cy="12" r="10"/><path d="M12 2a15 15 0 0 1 0 20"/><path d="M12 2a15 15 0 0 0 0 20"/><path d="M2 12h20"/>', 'globe world region international site', 'People'],
    handshake: ['<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a2 2 0 0 1 0-2.8l.4-.4a3 3 0 0 0-4.2 0l-1 1a2 2 0 0 1-2.8 0L7 7"/><path d="m21 3-6 6"/><path d="M3 21l6-6"/>', 'handshake agreement acceptance contract', 'People'],

    /* ── Tools & UI ────────────────────────────────────────────────────── */
    gear: ['<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>', 'gear settings configuration preferences cog', 'Tools'],
    settings: ['<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>', 'settings gear options config', 'Tools'],
    wrench: ['<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>', 'wrench maintenance tool repair works', 'Tools'],
    zap: ['<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', 'lightning zap power outage energy fast', 'Tools'],
    bell: ['<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', 'bell notification alarm reminder', 'Tools'],
    lock: ['<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 'lock locked freeze protected secure', 'Tools'],
    unlock: ['<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>', 'unlock unlocked editable open', 'Tools'],
    eye: ['<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', 'eye visible show view', 'Tools'],
    'eye-off': ['<path d="M9.9 4.24A9 9 0 0 1 12 4c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.53"/><path d="M6.6 6.6A17 17 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 4.4-1.1"/><path d="m2 2 20 20"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 'hidden invisible hide off', 'Tools'],
    search: ['<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>', 'search find filter lookup magnify', 'Tools'],
    filter: ['<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>', 'filter narrow refine subset', 'Tools'],
    layers: ['<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>', 'layers stack order z-index group', 'Tools'],
    copy: ['<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', 'copy duplicate clone clipboard', 'Tools'],
    trash: ['<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>', 'delete trash remove bin', 'Tools'],
    edit: ['<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>', 'edit pencil rename modify', 'Tools'],
    plus: ['<path d="M5 12h14"/><path d="M12 5v14"/>', 'add new plus create', 'Tools'],
    minus: ['<path d="M5 12h14"/>', 'minus remove subtract collapse', 'Tools'],
    undo: ['<path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/>', 'undo revert back step', 'Tools'],
    redo: ['<path d="M21 7v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/>', 'redo forward repeat', 'Tools'],
    save: ['<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>', 'save store write disk', 'Tools'],
    download: ['<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><path d="M12 15V3"/>', 'download export save out', 'Tools'],
    upload: ['<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><path d="M12 3v12"/>', 'upload import load in', 'Tools'],
    print: ['<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>', 'print pdf paper output', 'Tools'],
    link: ['<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>', 'link dependency connect relationship', 'Tools'],
    unlink: ['<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 3.5 8.5"/><path d="m2 2 20 20"/>', 'unlink disconnect break dependency', 'Tools'],
    target: ['<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>', 'target campaign goal objective aim', 'Tools'],
    activity: ['<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', 'activity task work bar progress', 'Tools'],
    chart: ['<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>', 'chart graph analysis metrics', 'Tools'],
    grid: ['<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', 'grid gridlines layout tiles', 'Tools'],
    map: ['<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15"/><path d="M15 6v15"/>', 'map minimap navigator overview', 'Tools'],
    maximize: ['<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>', 'maximize fullscreen expand present', 'Tools'],
    minimize: ['<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>', 'minimize shrink exit fullscreen', 'Tools'],
    'zoom-in': ['<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6"/><path d="M8 11h6"/>', 'zoom in magnify closer', 'Tools'],
    'zoom-out': ['<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M8 11h6"/>', 'zoom out wider further', 'Tools'],
    move: ['<path d="M5 9 2 12l3 3"/><path d="m9 5 3-3 3 3"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="M12 2v20"/>', 'move pan drag reposition', 'Tools'],
    hand: ['<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>', 'hand pan grab drag', 'Tools'],
    cursor: ['<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51z"/>', 'select pointer cursor arrow', 'Tools'],
    square: ['<rect x="3" y="3" width="18" height="18" rx="2"/>', 'square rectangle shape box', 'Shapes'],
    circle: ['<circle cx="12" cy="12" r="9"/>', 'circle ellipse round shape', 'Shapes'],
    triangle: ['<path d="M12 3 22 20H2z"/>', 'triangle shape warning', 'Shapes'],
    diamond: ['<path d="m12 2 10 10-10 10L2 12z"/>', 'diamond milestone rhombus gate', 'Shapes'],
    star: ['<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>', 'star favourite key important', 'Shapes'],
    hexagon: ['<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>', 'hexagon shape node', 'Shapes'],
    arrow: ['<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', 'arrow direction next forward', 'Shapes'],
    'arrow-left': ['<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>', 'arrow back previous left', 'Shapes'],
    'chevron-down': ['<path d="m6 9 6 6 6-6"/>', 'chevron down expand caret', 'Shapes'],
    'chevron-right': ['<path d="m9 18 6-6-6-6"/>', 'chevron right collapse caret', 'Shapes'],
    'chevron-left': ['<path d="m15 18-6-6 6-6"/>', 'chevron left back caret', 'Shapes'],
    'chevron-up': ['<path d="m18 15-6-6-6 6"/>', 'chevron up collapse caret', 'Shapes'],
    more: ['<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', 'more menu options ellipsis', 'Tools'],
    menu: ['<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>', 'menu hamburger navigation', 'Tools'],
    sun: ['<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>', 'sun light theme bright day', 'Tools'],
    moon: ['<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>', 'moon dark theme night', 'Tools'],
    palette: ['<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 1 2-4h2a4 4 0 0 0 4-4 10 10 0 0 0-10-8z"/>', 'palette theme colour style appearance', 'Tools'],
    sliders: ['<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>', 'sliders controls adjust properties inspector', 'Tools'],
    refresh: ['<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>', 'refresh reload sync reset', 'Tools'],
    info: ['<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>', 'info help about details', 'Tools'],
    help: ['<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>', 'help question support shortcuts', 'Tools'],
    keyboard: ['<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M18 10h.01"/><path d="M8 14h8"/>', 'keyboard shortcuts keys hotkeys', 'Tools'],
    pin: ['<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>', 'pin location marker place area', 'Tools'],
    tag: ['<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.41l8.7 8.71a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".8" fill="currentColor"/>', 'tag label category subsystem', 'Tools'],
    bookmark: ['<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>', 'bookmark baseline saved snapshot', 'Tools'],
    compare: ['<path d="M12 3v18"/><path d="M8 7 4 11l4 4"/><path d="m16 7 4 4-4 4"/><path d="M4 11h6"/><path d="M14 11h6"/>', 'compare baseline variance difference slip', 'Tools'],
    route: ['<circle cx="6" cy="19" r="3"/><path d="M9 19h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h6"/><circle cx="18" cy="5" r="3"/>', 'route path critical dependency chain', 'Tools'],
    expand: ['<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>', 'expand fit zoom extent', 'Tools'],
    external: ['<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', 'external open new link out', 'Tools'],
  };

  /** Every icon name, in registry order. */
  const ICON_NAMES = Object.keys(ICONS);

  /**
   * Render an icon as SVG markup.
   * @param {string} name
   * @param {{size?:number|string, cls?:string, stroke?:number}} [opts]
   */
  function icon(name, opts = {}) {
    const entry = ICONS[name];
    if (!entry) return '';
    const size = opts.size || '1em';
    const dim = typeof size === 'number' ? `${size}` : size;
    const cls = 'icon-svg' + (opts.cls ? ' ' + opts.cls : '');
    const stroke = opts.stroke || 2;
    return (
      `<svg class="${cls}" width="${dim}" height="${dim}" viewBox="0 0 24 24" fill="none" ` +
      `stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" ` +
      `aria-hidden="true" focusable="false">${entry[0]}</svg>`
    );
  }

  /** Render an icon straight to a detached SVG element. */
  function iconEl(name, opts = {}) {
    const wrapper = document.createElement('span');
    wrapper.innerHTML = icon(name, opts);
    return wrapper.firstElementChild;
  }

  function hasIcon(name) {
    return Object.prototype.hasOwnProperty.call(ICONS, name);
  }

  /** Raw path markup — used by the SVG and PDF exporters. */
  function iconPath(name) {
    return ICONS[name] ? ICONS[name][0] : '';
  }

  /**
   * Search the library. An empty query returns everything, so the picker can
   * use one code path for browse and search.
   */
  function searchIcons(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return ICON_NAMES.slice();
    const terms = q.split(/\s+/);
    return ICON_NAMES.filter((name) => {
      const haystack = `${name} ${ICONS[name][1]} ${ICONS[name][2]}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }

  /** Icons grouped by category, for the browse view of the picker. */
  function iconCategories() {
    const groups = new Map();
    for (const name of ICON_NAMES) {
      const category = ICONS[name][2] || 'Other';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(name);
    }
    return Array.from(groups, ([name, icons]) => ({ name, icons }));
  }

  Object.defineProperty(__x, "ICON_NAMES", { get: () => ICON_NAMES, enumerable: true });
  Object.defineProperty(__x, "icon", { get: () => icon, enumerable: true });
  Object.defineProperty(__x, "iconEl", { get: () => iconEl, enumerable: true });
  Object.defineProperty(__x, "hasIcon", { get: () => hasIcon, enumerable: true });
  Object.defineProperty(__x, "iconPath", { get: () => iconPath, enumerable: true });
  Object.defineProperty(__x, "searchIcons", { get: () => searchIcons, enumerable: true });
  Object.defineProperty(__x, "iconCategories", { get: () => iconCategories, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/components.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/components.js"] = function (__x, __req) {
  /**
   * Reusable UI primitives: modals, toasts, context menus, tooltips, popovers
   * and the small form builders the inspector and dialogs are assembled from.
   *
   * Every widget here is imperative and self-contained — call it, get a handle
   * back, close it when done. Nothing in this module knows about the document
   * model, which keeps it reusable across the whole app.
   *
   * Imports: util, events, icons.
   */

  const { el, clear, escapeHtml, uid, IS_MAC, clamp, fold } = __req("core/util.js");
  const { on, EV } = __req("core/events.js");
  const { icon, searchIcons, hasIcon } = __req("ui/icons.js");

  /* ══════════════════════════════════════════════════════════════════════════
     Modal
     ═══════════════════════════════════════════════════════════════════════ */

  const modalStack = [];

  /**
   * Open a modal dialog.
   *
   * @param {object} opts
   * @param {string} opts.title
   * @param {string} [opts.subtitle]
   * @param {HTMLElement|string} opts.body   Element or HTML string.
   * @param {Array}  [opts.actions]          [{label, kind, onClick, autofocus}]
   * @param {string} [opts.size]             '' | 'wide' | 'xl'
   * @param {Function} [opts.onClose]
   * @returns {{close:Function, root:HTMLElement, body:HTMLElement}}
   */
  function openModal(opts) {
    const overlay = el('div', { class: 'cx-modal-overlay', role: 'presentation' });
    const dialog = el('div', {
      class: 'cx-modal' + (opts.size ? ' ' + opts.size : ''),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': opts.title || 'Dialog',
    });

    const head = el('div', { class: 'cx-modal-head' }, [
      el('div', {}, [
        el('div', { class: 'cx-modal-title', text: opts.title || '' }),
        opts.subtitle ? el('div', { class: 'cx-modal-sub', text: opts.subtitle }) : null,
      ]),
      el('button', {
        class: 'cx-btn icon mini ghost',
        'aria-label': 'Close dialog',
        html: icon('x', { size: 15 }),
        onClick: () => handle.close(),
      }),
    ]);

    const body = el('div', { class: 'cx-modal-body' });
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);

    dialog.append(head, body);

    if (opts.actions && opts.actions.length) {
      const foot = el('div', { class: 'cx-modal-foot' });
      for (const action of opts.actions) {
        if (action === 'spacer') {
          foot.appendChild(el('div', { class: 'spacer' }));
          continue;
        }
        const button = el('button', {
          class: 'cx-btn' + (action.kind ? ' ' + action.kind : ''),
          text: action.label,
          onClick: () => {
            const result = action.onClick ? action.onClick(handle) : undefined;
            if (result !== false && action.keepOpen !== true) handle.close();
          },
        });
        if (action.autofocus) setTimeout(() => button.focus(), 30);
        foot.appendChild(button);
      }
      dialog.appendChild(foot);
    }

    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay && opts.dismissible !== false) handle.close();
    });

    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== handle) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (opts.dismissible !== false) handle.close();
      }
      if (e.key === 'Tab') trapFocus(e, dialog);
    };

    const handle = {
      root: overlay,
      dialog,
      body,
      close(result) {
        if (!overlay.isConnected) return;
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        const i = modalStack.indexOf(handle);
        if (i >= 0) modalStack.splice(i, 1);
        if (opts.onClose) opts.onClose(result);
        const previous = modalStack[modalStack.length - 1];
        if (previous) focusFirst(previous.dialog);
      },
    };

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    modalStack.push(handle);
    setTimeout(() => focusFirst(dialog), 20);
    return handle;
  }

  function focusFirst(root) {
    const target = root.querySelector('[autofocus], input:not([type=hidden]), select, textarea, button.primary, button');
    if (target) target.focus();
  }

  function trapFocus(e, root) {
    const focusable = Array.from(
      root.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
    ).filter((n) => n.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** True when any modal is currently open — shortcuts check this. */
  function modalOpen() {
    return modalStack.length > 0;
  }

  /* ── Confirm / prompt ──────────────────────────────────────────────────── */

  function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
      let settled = false;
      openModal({
        title,
        body: el('div', { style: { fontSize: 'var(--fs-small)', color: 'var(--text-muted)', lineHeight: '1.55' }, text: message }),
        actions: [
          { label: cancelLabel, onClick: () => { settled = true; resolve(false); } },
          { label: confirmLabel, kind: danger ? 'danger' : 'primary', autofocus: true, onClick: () => { settled = true; resolve(true); } },
        ],
        onClose: () => {
          if (!settled) resolve(false);
        },
      });
    });
  }

  function promptDialog({ title, label, value = '', placeholder = '', multiline = false, confirmLabel = 'Save' }) {
    return new Promise((resolve) => {
      const input = multiline
        ? el('textarea', { class: 'cx-textarea', placeholder, rows: 5 })
        : el('input', { class: 'cx-input', type: 'text', placeholder, value });
      if (multiline) input.value = value;

      let settled = false;
      const modal = openModal({
        title,
        body: el('div', { class: 'cx-field' }, [label ? el('label', { class: 'cx-label', text: label }) : null, input]),
        actions: [
          { label: 'Cancel', onClick: () => { settled = true; resolve(null); } },
          { label: confirmLabel, kind: 'primary', onClick: () => { settled = true; resolve(input.value); } },
        ],
        onClose: () => {
          if (!settled) resolve(null);
        },
      });

      setTimeout(() => {
        input.focus();
        input.select?.();
      }, 30);
      if (!multiline) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            settled = true;
            resolve(input.value);
            modal.close();
          }
        });
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Toasts
     ═══════════════════════════════════════════════════════════════════════ */

  let toastHost = null;

  function ensureToastHost() {
    if (!toastHost) {
      /* The host is the live region, not each toast: a region added to the page
         at the same moment as its words is announced by some screen readers and
         not others. One that already exists is announced by all of them. */
      toastHost = el('div', { id: 'cx-toasts', role: 'region', 'aria-label': 'Notifications', 'aria-live': 'polite' });
      document.body.appendChild(toastHost);
    }
    return toastHost;
  }

  const TOAST_ICONS = { good: 'check-circle', warn: 'warning', bad: 'x-circle', info: 'info' };

  /**
   * Show a transient notification.
   * @param {{tone?:string, title?:string, message?:string, timeout?:number, sticky?:boolean, action?:{label,onClick}}} opts
   */
  function toast(opts) {
    const tone = opts.tone || 'info';
    const host = ensureToastHost();
    // A failure interrupts; everything else waits its turn.
    const node = el('div', { class: `cx-toast ${tone}`, role: tone === 'bad' ? 'alert' : 'status' }, [
      el('span', { class: 't-icon', html: icon(TOAST_ICONS[tone] || 'info', { size: 16 }) }),
      el('div', { class: 't-body' }, [
        opts.title ? el('div', { class: 't-title', text: opts.title }) : null,
        opts.message ? el('div', { class: 't-msg', text: opts.message }) : null,
      ]),
      opts.action
        ? el('button', {
            class: 'cx-btn mini',
            text: opts.action.label,
            onClick: () => {
              opts.action.onClick();
              dismiss();
            },
          })
        : null,
      el('button', { class: 'cx-btn icon mini ghost', 'aria-label': 'Dismiss', html: icon('x', { size: 13 }), onClick: () => dismiss() }),
    ]);

    function dismiss() {
      node.classList.add('out');
      setTimeout(() => node.remove(), 240);
    }

    host.appendChild(node);
    if (!opts.sticky) setTimeout(dismiss, opts.timeout || 3600);
    return { dismiss };
  }

  // Anything in the app can raise a toast by emitting an event, which keeps
  // low-level modules (storage, exporters) free of UI imports.
  on(EV.TOAST, (payload) => toast(payload || {}));

  /* ══════════════════════════════════════════════════════════════════════════
     Context menu
     ═══════════════════════════════════════════════════════════════════════ */

  let openMenu = null;

  /**
   * Show a context menu at a screen position.
   * Items: {label, icon, key, onClick, disabled, danger} | 'sep' | {heading}
   */
  function contextMenu(x, y, items) {
    closeMenu();
    const menu = el('div', { class: 'cx-menu', role: 'menu' });

    for (const item of items) {
      if (!item) continue;
      if (item === 'sep') {
        menu.appendChild(el('div', { class: 'cx-menu-sep' }));
        continue;
      }
      if (item.heading) {
        menu.appendChild(el('div', { class: 'cx-menu-head', text: item.heading }));
        continue;
      }
      const button = el('button', {
        class: 'cx-menu-item' + (item.danger ? ' danger' : ''),
        role: 'menuitem',
        disabled: !!item.disabled,
        onClick: () => {
          closeMenu();
          item.onClick?.();
        },
      }, [
        item.icon ? el('span', { html: icon(item.icon, { size: 14 }), style: { display: 'flex', opacity: '0.8' } }) : el('span', { style: { width: '14px' } }),
        el('span', { class: 'mi-label', text: item.label }),
        item.key ? el('span', { class: 'mi-key', text: keyHint(item.key) }) : null,
      ]);
      menu.appendChild(button);
    }

    document.body.appendChild(menu);

    // Keep the menu inside the viewport, flipping rather than clipping.
    const rect = menu.getBoundingClientRect();
    const left = x + rect.width > window.innerWidth - 8 ? Math.max(8, x - rect.width) : x;
    const top = y + rect.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - rect.height - 8) : y;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    openMenu = menu;
    setTimeout(() => {
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('keydown', onMenuKey, true);
      window.addEventListener('blur', closeMenu);
    }, 0);
    return { close: closeMenu };
  }

  function onOutside(e) {
    if (openMenu && !openMenu.contains(e.target)) closeMenu();
  }

  function onMenuKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (!openMenu) return;
    const items = Array.from(openMenu.querySelectorAll('.cx-menu-item:not(:disabled)'));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(current + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(current - 1 + items.length) % items.length].focus();
    }
  }

  function closeMenu() {
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
    }
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onMenuKey, true);
    window.removeEventListener('blur', closeMenu);
  }

  /** 'mod+z' → '⌘Z' on macOS, 'Ctrl+Z' elsewhere. */
  function keyHint(spec) {
    return String(spec)
      .split('+')
      .map((part) => {
        const p = part.trim().toLowerCase();
        if (p === 'mod') return IS_MAC ? '⌘' : 'Ctrl';
        if (p === 'shift') return IS_MAC ? '⇧' : 'Shift';
        if (p === 'alt') return IS_MAC ? '⌥' : 'Alt';
        if (p === 'del' || p === 'delete') return IS_MAC ? '⌫' : 'Del';
        if (p === 'enter') return IS_MAC ? '↵' : 'Enter';
        if (p === 'esc') return 'Esc';
        return part.length === 1 ? part.toUpperCase() : part;
      })
      .join(IS_MAC ? '' : '+');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Tooltip
     ═══════════════════════════════════════════════════════════════════════ */

  let tooltipNode = null;
  let tooltipTimer = null;

  /**
   * Show a tooltip near a point. `content` may be a string or an element.
   * Tooltips never take pointer events, so they cannot interfere with a drag.
   */
  function showTooltip(x, y, content, { delay = 0, html = false } = {}) {
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => {
      hideTooltip();
      tooltipNode = el('div', { class: 'cx-tooltip' });
      if (typeof content === 'string') {
        if (html) tooltipNode.innerHTML = content;
        else tooltipNode.textContent = content;
      } else if (content) {
        tooltipNode.appendChild(content);
      }
      document.body.appendChild(tooltipNode);

      const rect = tooltipNode.getBoundingClientRect();
      let left = x + 14;
      let top = y + 16;
      if (left + rect.width > window.innerWidth - 10) left = Math.max(10, x - rect.width - 14);
      if (top + rect.height > window.innerHeight - 10) top = Math.max(10, y - rect.height - 14);
      tooltipNode.style.left = `${left}px`;
      tooltipNode.style.top = `${top}px`;
    }, delay);
  }

  function hideTooltip() {
    clearTimeout(tooltipTimer);
    if (tooltipNode) {
      tooltipNode.remove();
      tooltipNode = null;
    }
  }

  /** Attach a simple hover tooltip to an element. */
  function attachTooltip(node, text, delay = 420) {
    node.addEventListener('mouseenter', (e) => showTooltip(e.clientX, e.clientY, text, { delay }));
    node.addEventListener('mouseleave', hideTooltip);
    node.addEventListener('mousedown', hideTooltip);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Popover — anchored panel (colour pickers, icon picker, quick filters)
     ═══════════════════════════════════════════════════════════════════════ */

  let openPopover = null;

  function popover(anchor, content, { width = 260, align = 'start' } = {}) {
    closePopover();
    const panel = el('div', {
      class: 'cx-menu',
      style: { width: `${width}px`, padding: '10px' },
      onMousedown: (e) => e.stopPropagation(),
    });
    if (typeof content === 'string') panel.innerHTML = content;
    else panel.appendChild(content);
    document.body.appendChild(panel);

    const rect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    let left = align === 'end' ? rect.right - panelRect.width : rect.left;
    left = clamp(left, 8, window.innerWidth - panelRect.width - 8);
    let top = rect.bottom + 6;
    if (top + panelRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - panelRect.height - 6);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;

    openPopover = panel;
    setTimeout(() => {
      document.addEventListener('mousedown', onPopoverOutside, true);
      document.addEventListener('keydown', onPopoverKey, true);
    }, 0);
    return { close: closePopover, root: panel };
  }

  function onPopoverOutside(e) {
    if (openPopover && !openPopover.contains(e.target)) closePopover();
  }

  function onPopoverKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePopover();
    }
  }

  function closePopover() {
    if (openPopover) {
      openPopover.remove();
      openPopover = null;
    }
    document.removeEventListener('mousedown', onPopoverOutside, true);
    document.removeEventListener('keydown', onPopoverKey, true);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Form builders
     ═══════════════════════════════════════════════════════════════════════ */

  /** Labelled control wrapper. */
  function field(label, control, hint) {
    return el('div', { class: 'cx-field' }, [
      label ? el('label', { class: 'cx-label', text: label }) : null,
      control,
      hint ? el('div', { class: 'cx-hint', text: hint }) : null,
    ]);
  }

  function textInput({ value = '', placeholder = '', type = 'text', onInput, onChange, mini = false, ...rest }) {
    const input = el('input', {
      class: 'cx-input' + (mini ? ' mini' : ''),
      type,
      placeholder,
      ...rest,
    });
    input.value = value ?? '';
    if (onInput) input.addEventListener('input', () => onInput(input.value, input));
    if (onChange) input.addEventListener('change', () => onChange(input.value, input));
    return input;
  }

  function numberInput({ value = 0, min, max, step = 1, onChange, mini = false }) {
    const input = el('input', { class: 'cx-input' + (mini ? ' mini' : ''), type: 'number', min, max, step });
    input.value = value;
    if (onChange) input.addEventListener('change', () => onChange(Number(input.value), input));
    return input;
  }

  function selectInput({ value, options, onChange, mini = false, placeholder, disabled = false }) {
    const select = el('select', { class: 'cx-select' + (mini ? ' mini' : '') });
    // A field with one possible answer is shown, not hidden: "Resource: you" says
    // whose day is being planned, where an absent field would leave it a guess.
    if (disabled) select.disabled = true;
    if (placeholder) select.appendChild(el('option', { value: '', text: placeholder }));
    for (const opt of options) {
      const { value: v, label } = typeof opt === 'string' ? { value: opt, label: opt } : opt;
      select.appendChild(el('option', { value: v, text: label }));
    }
    select.value = value ?? '';
    if (onChange) select.addEventListener('change', () => onChange(select.value, select));
    return select;
  }

  function colorInput({ value = '#5b93f5', onChange }) {
    const input = el('input', { class: 'cx-color', type: 'color', value: value || '#5b93f5' });
    if (onChange) input.addEventListener('input', () => onChange(input.value));
    return input;
  }

  function checkbox({ label, checked = false, onChange }) {
    const input = el('input', { type: 'checkbox' });
    input.checked = !!checked;
    if (onChange) input.addEventListener('change', () => onChange(input.checked));
    return el('label', { class: 'cx-check' }, [input, el('span', { text: label })]);
  }

  function toggle({ label, checked = false, onChange }) {
    const input = el('input', { type: 'checkbox' });
    input.checked = !!checked;
    if (onChange) input.addEventListener('change', () => onChange(input.checked));
    return el('label', { class: 'cx-switch' }, [input, el('span', { text: label })]);
  }

  function rangeInput({ value = 0, min = 0, max = 100, step = 1, onInput, onChange }) {
    const input = el('input', { class: 'cx-range', type: 'range', min, max, step });
    input.value = value;
    if (onInput) input.addEventListener('input', () => onInput(Number(input.value)));
    if (onChange) input.addEventListener('change', () => onChange(Number(input.value)));
    return input;
  }

  /** Segmented button row. `options` = [{value, label, icon, title}] */
  function segmented({ value, options, onChange, stretch = false }) {
    const wrap = el('div', { class: 'cx-seg' + (stretch ? ' stretch' : ''), role: 'group' });
    for (const opt of options) {
      const button = el('button', {
        class: opt.value === value ? 'active' : '',
        title: opt.title || opt.label,
        'aria-pressed': String(opt.value === value),
        onClick: () => {
          for (const child of wrap.children) child.classList.remove('active');
          button.classList.add('active');
          onChange(opt.value);
        },
      }, [opt.icon ? el('span', { html: icon(opt.icon, { size: 13 }), style: { display: 'flex' } }) : null, opt.label ? el('span', { text: opt.label }) : null]);
      wrap.appendChild(button);
    }
    return wrap;
  }

  /** Collapsible section for the inspector and dock panes. */
  function section(title, children, { collapsed = false, actions = null, id = null } = {}) {
    const body = el('div', { class: 'cx-section-body' }, [].concat(children).filter(Boolean));
    const wrap = el('div', { class: 'cx-section' + (collapsed ? ' collapsed' : ''), dataset: id ? { section: id } : {} });
    const head = el('button', {
      class: 'cx-section-head',
      type: 'button',
      'aria-expanded': String(!collapsed),
      onClick: (e) => {
        if (e.target.closest('[data-section-action]')) return;
        wrap.classList.toggle('collapsed');
        head.setAttribute('aria-expanded', String(!wrap.classList.contains('collapsed')));
      },
    }, [
      el('span', { class: 'sec-caret', html: icon('chevron-down', { size: 12 }), style: { display: 'flex' } }),
      el('span', { class: 'sec-title', text: title }),
      actions,
    ]);
    wrap.append(head, body);
    return wrap;
  }

  /** Empty-state block. */
  function emptyState({ iconName = 'inbox', title, message, action }) {
    return el('div', { class: 'cx-empty' }, [
      hasIcon(iconName) ? el('div', { class: 'ce-icon', html: icon(iconName, { size: 26 }) }) : null,
      title ? el('div', { class: 'ce-title', text: title }) : null,
      message ? el('div', { class: 'ce-msg', text: message }) : null,
      action ? el('button', { class: 'cx-btn mini', text: action.label, onClick: action.onClick }) : null,
    ]);
  }

  /**
   * Choose one thing from many, by typing.
   *
   * A `<select>` stops being usable somewhere around fifty options, and the P6
   * register has fifteen hundred. This is a search box over a list: type to
   * narrow, arrow keys to move, Enter to take it.
   *
   * @param {object}   opts
   * @param {string}   opts.title
   * @param {string}   [opts.subtitle]
   * @param {Array}    opts.items      [{ value, label, meta?, badge? }]
   * @param {string}   [opts.placeholder]
   * @param {string}   [opts.empty]    Shown when nothing matches.
   * @param {Function} opts.onPick     Called with the chosen value.
   * @param {string}   [opts.clearLabel] Offers a "none" choice when given.
   */
  function openPicker(opts) {
    const items = opts.items || [];
    let filtered = items;
    let cursor = 0;

    const list = el('div', { class: 'cx-picker-list', role: 'listbox' });
    const search = textInput({
      value: '',
      placeholder: opts.placeholder || 'Type to search…',
      onInput: (v) => {
        const needle = fold(v);
        filtered = needle
          ? items.filter((i) => fold(`${i.label} ${i.meta || ''}`).includes(needle))
          : items;
        cursor = 0;
        draw();
      },
    });
    search.setAttribute('aria-label', opts.title || 'Search');

    let handle = null;

    const take = (item) => {
      if (!item) return;
      handle?.close();
      opts.onPick(item.value);
    };

    function draw() {
      clear(list);
      if (!filtered.length) {
        list.appendChild(el('div', { class: 'cx-hint', style: { padding: '14px 10px' }, text: opts.empty || 'Nothing matches.' }));
        return;
      }
      // A long list is slower to build than to read; typing narrows it.
      filtered.slice(0, 200).forEach((item, index) => {
        list.appendChild(
          el('div', {
            class: 'cx-picker-item' + (index === cursor ? ' on' : ''),
            role: 'option',
            'aria-selected': index === cursor ? 'true' : 'false',
            dataset: { value: item.value },
            onClick: () => take(item),
          }, [
            el('div', { class: 'pi-label', text: item.label }),
            item.meta ? el('div', { class: 'pi-meta', text: item.meta }) : null,
          ].filter(Boolean))
        );
      });
      if (filtered.length > 200) {
        list.appendChild(el('div', { class: 'cx-hint', style: { padding: '8px 10px' }, text: `${filtered.length - 200} more — keep typing.` }));
      }
      list.querySelector('.cx-picker-item.on')?.scrollIntoView({ block: 'nearest' });
    }

    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const limit = Math.min(filtered.length, 200);
        if (!limit) return;
        cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + limit) % limit;
        draw();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        take(filtered[cursor]);
      }
    });

    draw();

    const actions = [{ label: 'Cancel' }];
    if (opts.clearLabel) {
      actions.push({
        label: opts.clearLabel,
        onClick: () => opts.onPick(null),
      });
    }

    handle = openModal({
      title: opts.title,
      subtitle: opts.subtitle,
      body: el('div', {}, [search, list]),
      actions,
    });

    setTimeout(() => search.focus(), 40);
    return handle;
  }

  /** Status/tone badge. */
  function badge(label, tone = 'neutral', { dot = true } = {}) {
    return el('span', { class: `cx-badge ${tone}` + (dot ? '' : ' nodot'), text: label });
  }

  /** KPI chip — the shared stat vocabulary. */
  function chipStat(label, value, tone = 'muted') {
    return el('span', { class: `cx-chipstat ${tone}` }, [
      el('span', { class: 'cs-label', text: label }),
      el('span', { class: 'cs-value', text: String(value) }),
    ]);
  }

  /* ── Icon picker ───────────────────────────────────────────────────────── */

  /**
   * Searchable icon grid. Calls `onPick(name)` and returns the panel element,
   * ready to drop into a popover or modal.
   */
  function iconPicker({ value, onPick }) {
    const search = el('input', { class: 'cx-input mini', type: 'search', placeholder: 'Search icons…' });
    const grid = el('div', { class: 'cx-iconpick' });

    function render(query) {
      clear(grid);
      const names = searchIcons(query);
      if (!names.length) {
        grid.appendChild(el('div', { class: 'cx-hint', style: { gridColumn: '1 / -1', textAlign: 'center', padding: '12px' }, text: 'No icons match that search.' }));
        return;
      }
      for (const name of names.slice(0, 240)) {
        grid.appendChild(
          el('button', {
            class: name === value ? 'active' : '',
            title: name,
            'aria-label': name,
            html: icon(name, { size: 16 }),
            onClick: () => onPick(name),
          })
        );
      }
    }

    search.addEventListener('input', () => render(search.value));
    render('');

    return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
      search,
      grid,
      el('button', { class: 'cx-btn mini', text: 'No icon', onClick: () => onPick('') }),
    ]);
  }

  /* ── Colour swatches ───────────────────────────────────────────────────── */

  /** The shared palette offered wherever a colour is chosen. */
  const PALETTE = [
    '#e60012', '#f97316', '#e0900b', '#eab308', '#16a571', '#0d9488', '#0ea5e9', '#3a76e8', '#6366f1', '#9333d9',
    '#f2555b', '#fb923c', '#fbbf24', '#facc15', '#4ade80', '#2dd4bf', '#38bdf8', '#60a5fa', '#818cf8', '#c084fc',
    '#7f1d1d', '#7c2d12', '#78350f', '#713f12', '#14532d', '#134e4a', '#0c4a6e', '#1e3a8a', '#312e81', '#4c1d95',
    '#ffffff', '#e5e7eb', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#111827', '#0b0f1a', '#000000',
  ];

  function swatchGrid({ value, onPick, colors = PALETTE }) {
    const grid = el('div', { class: 'cx-swatches' });
    for (const color of colors) {
      grid.appendChild(
        el('button', {
          class: 'cx-swatch' + (color.toLowerCase() === String(value).toLowerCase() ? ' active' : ''),
          style: { background: color },
          title: color,
          'aria-label': color,
          onClick: () => onPick(color),
        })
      );
    }
    return grid;
  }

  /** Colour control: swatch input plus the shared palette in a popover. */
  function colorControl({ value, onChange, allowInherit = false }) {
    const swatch = el('input', { class: 'cx-color', type: 'color', value: value || '#5b93f5' });
    swatch.addEventListener('input', () => onChange(swatch.value));

    const more = el('button', {
      class: 'cx-btn mini icon',
      'aria-label': 'Colour palette',
      html: icon('palette', { size: 13 }),
    });
    more.addEventListener('click', () => {
      popover(more, el('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, [
        el('div', { class: 'cx-label', text: 'Palette' }),
        swatchGrid({ value, onPick: (c) => { swatch.value = c; onChange(c); closePopover(); } }),
        allowInherit
          ? el('button', { class: 'cx-btn mini', text: 'Use default', onClick: () => { onChange(''); closePopover(); } })
          : null,
      ]), { width: 268 });
    });

    return el('div', { class: 'cx-inline' }, [swatch, more]);
  }

  /* ── Misc ──────────────────────────────────────────────────────────────── */

  /** Skeleton placeholder rows. */
  function skeleton(rows = 3) {
    return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', padding: '10px' } },
      Array.from({ length: rows }, (_, i) => el('div', { class: 'cx-skel', style: { width: `${100 - i * 12}%` } })));
  }

  /** Progress bar with an optional accent colour. */
  function progressBar(percent, color) {
    return el('div', { class: 'cx-progress' }, [
      el('span', { style: { width: `${clamp(percent, 0, 100)}%`, background: color || 'var(--good)' } }),
    ]);
  }

  /** Render a tag chip. */
  function tagChip(label, color) {
    return el('span', { class: 'cx-tag', style: color ? { color, background: 'transparent', boxShadow: `inset 0 0 0 1px ${color}55` } : {} }, [
      el('span', { text: label }),
    ]);
  }

  /** Unique DOM id helper for label/control pairs. */
  function domId(prefix = 'f') {
    return uid(prefix).replace(/[^\w-]/g, '');
  }

  Object.defineProperty(__x, "openModal", { get: () => openModal, enumerable: true });
  Object.defineProperty(__x, "modalOpen", { get: () => modalOpen, enumerable: true });
  Object.defineProperty(__x, "confirmDialog", { get: () => confirmDialog, enumerable: true });
  Object.defineProperty(__x, "promptDialog", { get: () => promptDialog, enumerable: true });
  Object.defineProperty(__x, "toast", { get: () => toast, enumerable: true });
  Object.defineProperty(__x, "contextMenu", { get: () => contextMenu, enumerable: true });
  Object.defineProperty(__x, "closeMenu", { get: () => closeMenu, enumerable: true });
  Object.defineProperty(__x, "keyHint", { get: () => keyHint, enumerable: true });
  Object.defineProperty(__x, "showTooltip", { get: () => showTooltip, enumerable: true });
  Object.defineProperty(__x, "hideTooltip", { get: () => hideTooltip, enumerable: true });
  Object.defineProperty(__x, "attachTooltip", { get: () => attachTooltip, enumerable: true });
  Object.defineProperty(__x, "popover", { get: () => popover, enumerable: true });
  Object.defineProperty(__x, "closePopover", { get: () => closePopover, enumerable: true });
  Object.defineProperty(__x, "field", { get: () => field, enumerable: true });
  Object.defineProperty(__x, "textInput", { get: () => textInput, enumerable: true });
  Object.defineProperty(__x, "numberInput", { get: () => numberInput, enumerable: true });
  Object.defineProperty(__x, "selectInput", { get: () => selectInput, enumerable: true });
  Object.defineProperty(__x, "colorInput", { get: () => colorInput, enumerable: true });
  Object.defineProperty(__x, "checkbox", { get: () => checkbox, enumerable: true });
  Object.defineProperty(__x, "toggle", { get: () => toggle, enumerable: true });
  Object.defineProperty(__x, "rangeInput", { get: () => rangeInput, enumerable: true });
  Object.defineProperty(__x, "segmented", { get: () => segmented, enumerable: true });
  Object.defineProperty(__x, "section", { get: () => section, enumerable: true });
  Object.defineProperty(__x, "emptyState", { get: () => emptyState, enumerable: true });
  Object.defineProperty(__x, "openPicker", { get: () => openPicker, enumerable: true });
  Object.defineProperty(__x, "badge", { get: () => badge, enumerable: true });
  Object.defineProperty(__x, "chipStat", { get: () => chipStat, enumerable: true });
  Object.defineProperty(__x, "iconPicker", { get: () => iconPicker, enumerable: true });
  Object.defineProperty(__x, "PALETTE", { get: () => PALETTE, enumerable: true });
  Object.defineProperty(__x, "swatchGrid", { get: () => swatchGrid, enumerable: true });
  Object.defineProperty(__x, "colorControl", { get: () => colorControl, enumerable: true });
  Object.defineProperty(__x, "skeleton", { get: () => skeleton, enumerable: true });
  Object.defineProperty(__x, "progressBar", { get: () => progressBar, enumerable: true });
  Object.defineProperty(__x, "tagChip", { get: () => tagChip, enumerable: true });
  Object.defineProperty(__x, "domId", { get: () => domId, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/rc_gate.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/rc_gate.js"] = function (__x, __req) {
  /**
   * The resource calendar's front door: the states that are not the calendar.
   *
   * No backend in this build, the sign-in and sign-up form, and an account that is
   * not on the team. They lived in `ui/rc.js`, and they moved out when the phone
   * app arrived — that module imports every tab, and through them the folder and
   * the exporters, none of which a phone may carry. Two copies of a sign-in form
   * would be two answers to "how does somebody join", so there is one, and each
   * interface hands it the sentence that is true of where it is drawn.
   *
   * Nothing here is the control. Who may create an account is
   * `rc_enforce_invitation()` on `auth.users`, and who may see what is the
   * policies; this explains the state to the person looking at it.
   *
   * Imports: util, rc, icons, components.
   */

  const { el } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { textInput } = __req("ui/components.js");

  /**
   * No backend in this build.
   *
   * Not an error. A build can legitimately have the timeline and not the calendar
   * — that is what every build had until the calendar existed — so it says what is
   * missing and where it is configured rather than pretending something broke.
   */
  function notConfigured({
    message = 'The timeline works as it always has. The resource calendar needs a '
      + 'Supabase project, named in config.js as rcSupabaseUrl and '
      + 'rcSupabaseAnonKey — separate from the timeline, which stays in your folder.',
  } = {}) {
    return el('div', { class: 'rc-state' }, [
      el('div', { class: 'rc-state-icon', html: icon('database', { size: 32 }) }),
      el('h2', { text: 'No resource calendar in this build' }),
      el('p', { text: message }),
    ]);
  }

  /**
   * Signed in to nothing yet.
   *
   * The form writes to the calendar's own client, which keeps its own session
   * under its own storage key. `onDone` runs once a session exists; `blurb` is
   * the line under the title when signing in, because what is true about the
   * rest of the application depends on which application this is.
   */
  function signInForm({
    onDone = () => {},
    blurb = 'The timeline needs no account and is already open behind this. Only the calendar does.',
  } = {}) {
    /* An invitation link carries the address it was sent to, so somebody
       following one does not have to remember which of their addresses was
       invited — and lands on the right half of the form. */
    const invited = joiningAs();
    let joining = Boolean(invited);

    const email = textInput({ placeholder: 'you@example.com', type: 'email', value: invited || '' });
    const password = textInput({ placeholder: 'Password', type: 'password' });
    email.autocomplete = 'username';
    const error = el('div', { class: 'rc-error', hidden: true });
    const note = el('div', { class: 'rc-hint', hidden: true });
    const button = el('button', { class: 'cx-btn primary' });
    const swap = el('button', { class: 'cx-btn ghost mini' });
    const title = el('h2');
    const lead = el('p');

    const paint = () => {
      title.textContent = joining ? 'Create your account' : 'Sign in to the resource calendar';
      lead.textContent = joining
        ? 'Only an address an administrator has invited can create an account — the database '
          + 'refuses the rest, so there is nothing to guess at here.'
        : blurb;
      button.textContent = joining ? 'Create account' : 'Sign in';
      password.placeholder = joining ? 'Choose a password' : 'Password';
      password.autocomplete = joining ? 'new-password' : 'current-password';
      swap.textContent = joining ? 'I already have an account' : 'I was invited — create my account';
    };

    const submit = async () => {
      error.hidden = true;
      note.hidden = true;
      button.disabled = true;
      button.textContent = joining ? 'Creating…' : 'Signing in…';
      try {
        if (joining) {
          const { live } = await rc.signUp(email.value, password.value);
          if (!live) {
            // The project has email confirmation on, so the account exists but
            // the session does not. Saying so beats a form that looks stuck.
            note.textContent = 'Account created. Confirm your address from the email just sent, '
              + 'then sign in.';
            note.hidden = false;
            joining = false;
            paint();
            button.disabled = false;
            return;
          }
        } else {
          await rc.signIn(email.value, password.value);
        }
        onDone();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        button.disabled = false;
        paint();
      }
    };

    button.addEventListener('click', submit);
    swap.addEventListener('click', () => { joining = !joining; error.hidden = true; paint(); });
    for (const field of [email, password]) {
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
    }
    paint();

    return el('div', { class: 'rc-state' }, [
      el('div', { class: 'rc-state-icon', html: icon('users', { size: 32 }) }),
      title,
      lead,
      el('div', { class: 'rc-signin' }, [email, password, error, note, button, swap]),
    ]);
  }

  /** The address an invitation link was sent to, from `#join=…`. */
  function joiningAs() {
    const match = /[#&?]join=([^&]+)/.exec(window.location.hash + window.location.search);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1]).trim();
    } catch {
      return '';
    }
  }

  /** An account that is not on the team. A real answer, not a failure. */
  function notOnTheTeam() {
    return el('div', { class: 'rc-state' }, [
      el('div', { class: 'rc-state-icon', html: icon('user', { size: 32 }) }),
      el('h2', { text: 'You are signed in, but not on this team' }),
      el('p', {
        text: 'An administrator adds people in Organisation. Until your account is '
          + 'linked to a team record, the database will not show you anything.',
      }),
      el('button', { class: 'cx-btn ghost', text: 'Sign out', onClick: () => rc.signOut() }),
    ]);
  }

  Object.defineProperty(__x, "notConfigured", { get: () => notConfigured, enumerable: true });
  Object.defineProperty(__x, "signInForm", { get: () => signInForm, enumerable: true });
  Object.defineProperty(__x, "joiningAs", { get: () => joiningAs, enumerable: true });
  Object.defineProperty(__x, "notOnTheTeam", { get: () => notOnTheTeam, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// core/dates.js
// ════════════════════════════════════════════════════════════════════════
__mods["core/dates.js"] = function (__x, __req) {
  /**
   * Date & time-axis mathematics.
   *
   * Everything in this application works in **UTC** internally. Project dates
   * are calendar dates, not instants — a release planned for "12 March" must not
   * shift by a day because the user flew to another timezone or the clocks went
   * forward. So: the model stores `YYYY-MM-DD` strings, the engine works in
   * milliseconds at UTC midnight, and nothing ever calls a local-time getter.
   *
   * Leaf module: imports nothing.
   */

  const MS_MINUTE = 60_000;
  const MS_HOUR = 3_600_000;
  const MS_DAY = 86_400_000;
  const MS_WEEK = MS_DAY * 7;

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAYS_MIN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  /* ── Conversion ────────────────────────────────────────────────────────── */

  /**
   * Parse a value into UTC-midnight milliseconds.
   * Accepts `YYYY-MM-DD`, full ISO strings, Date objects and raw numbers.
   * Returns NaN for anything unparseable so callers can guard.
   */
  function toMs(value) {
    if (value == null || value === '') return NaN;
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    const s = String(value).trim();
    const simple = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (simple) return Date.UTC(+simple[1], +simple[2] - 1, +simple[3]);
    const parsed = Date.parse(s);
    return Number.isNaN(parsed) ? NaN : parsed;
  }

  /** Milliseconds → `YYYY-MM-DD` (UTC). */
  function toISO(ms) {
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  /** Milliseconds → `YYYY-MM-DDTHH:MM` (UTC) for datetime inputs. */
  function toISOMinutes(ms) {
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms);
    return `${toISO(ms)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** Today at UTC midnight, from the system clock. */
  function todayMs() {
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /* ── Truncation ────────────────────────────────────────────────────────── */

  function startOfDay(ms) {
    return Math.floor(ms / MS_DAY) * MS_DAY;
  }

  function endOfDay(ms) {
    return startOfDay(ms) + MS_DAY - 1;
  }

  /** Start of week. `weekStart` is 0 (Sunday) or 1 (Monday, the default). */
  function startOfWeek(ms, weekStart = 1) {
    const d = startOfDay(ms);
    const dow = new Date(d).getUTCDay();
    const delta = (dow - weekStart + 7) % 7;
    return d - delta * MS_DAY;
  }

  function startOfMonth(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }

  function endOfMonth(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - MS_DAY;
  }

  function startOfQuarter(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
  }

  function startOfYear(ms) {
    return Date.UTC(new Date(ms).getUTCFullYear(), 0, 1);
  }

  /* ── Arithmetic ────────────────────────────────────────────────────────── */

  function addDays(ms, n) {
    return ms + n * MS_DAY;
  }

  function addWeeks(ms, n) {
    return ms + n * MS_WEEK;
  }

  function addMonths(ms, n) {
    const d = new Date(ms);
    const targetMonth = d.getUTCMonth() + n;
    const year = d.getUTCFullYear() + Math.floor(targetMonth / 12);
    const month = ((targetMonth % 12) + 12) % 12;
    // Clamp the day so 31 Jan + 1 month lands on 28/29 Feb rather than 3 March.
    const day = Math.min(d.getUTCDate(), daysInMonth(year, month));
    return Date.UTC(year, month, day);
  }

  function addYears(ms, n) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), Math.min(d.getUTCDate(), daysInMonth(d.getUTCFullYear() + n, d.getUTCMonth())));
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }

  /** Whole days between two instants (b − a). */
  function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / MS_DAY);
  }

  function isWeekend(ms) {
    const dow = new Date(ms).getUTCDay();
    return dow === 0 || dow === 6;
  }

  /**
   * Working days between two dates, exclusive of the end date, skipping
   * weekends and any date listed in `holidays` (array of `YYYY-MM-DD`).
   */
  function workingDaysBetween(a, b, holidays = []) {
    const set = new Set(holidays);
    let count = 0;
    let cur = startOfDay(Math.min(a, b));
    const end = startOfDay(Math.max(a, b));
    while (cur < end) {
      if (!isWeekend(cur) && !set.has(toISO(cur))) count++;
      cur += MS_DAY;
    }
    return a <= b ? count : -count;
  }

  /**
   * The finish instant of a span `n` working days long starting at `ms`.
   *
   * The exact inverse of `workingDaysBetween`, which is the whole reason it is
   * not `addWorkingDays`: that one advances *past* n working days, so a Monday
   * plus five lands on the following Monday and a Saturday plus one lands on
   * Monday — measuring back gives five and nought. This counts the day it is
   * standing on and then steps, so a five-day task starting Monday finishes at
   * Saturday-morning — the exclusive edge every other duration here uses, and the
   * bar covers exactly Monday to Friday.
   */
  function addWorkingSpan(ms, n, holidays = []) {
    const set = new Set(holidays);
    const days = Math.max(0, Math.round(n));
    let cur = startOfDay(ms);
    let counted = 0;
    // A span has to end somewhere even if every day is a holiday; a whole year of
    // stepping is far past any real plan and stops a bad list looping forever.
    let guard = 0;
    while (counted < days && guard++ < 4000) {
      if (!isWeekend(cur) && !set.has(toISO(cur))) counted++;
      cur += MS_DAY;
    }
    return cur;
  }

  /** Advance `ms` by `n` working days. */
  function addWorkingDays(ms, n, holidays = []) {
    const set = new Set(holidays);
    const step = n >= 0 ? MS_DAY : -MS_DAY;
    let remaining = Math.abs(n);
    let cur = startOfDay(ms);
    while (remaining > 0) {
      cur += step;
      if (!isWeekend(cur) && !set.has(toISO(cur))) remaining--;
    }
    return cur;
  }

  /** ISO-8601 week number (weeks start Monday; week 1 contains 4 January). */
  function isoWeek(ms) {
    const d = startOfDay(ms);
    const dow = (new Date(d).getUTCDay() + 6) % 7; // Mon = 0
    const thursday = d + (3 - dow) * MS_DAY;
    const year = new Date(thursday).getUTCFullYear();
    const jan4 = Date.UTC(year, 0, 4);
    const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7;
    const week1Monday = jan4 - jan4Dow * MS_DAY;
    return { week: Math.round((thursday - week1Monday) / MS_WEEK) + 1, year };
  }

  function quarterOf(ms) {
    return Math.floor(new Date(ms).getUTCMonth() / 3) + 1;
  }

  /* ── Formatting ────────────────────────────────────────────────────────── */

  /**
   * Display order for dates.
   *
   * `toISO()` is unaffected — `YYYY-MM-DD` is the on-disk format and must never
   * follow a display preference. This only governs what the user reads.
   *
   * Kept as module state with a setter rather than read from the store, because
   * this module is a leaf and must not import upwards. The application applies
   * the project's setting on load and whenever it changes.
   */
  let dateOrder = 'mdy';

  const DATE_ORDERS = [
    { id: 'mdy', label: 'M/D/Y — 3/12/2026' },
    { id: 'dmy', label: 'D/M/Y — 12/3/2026' },
    { id: 'ymd', label: 'Y-M-D — 2026-03-12' },
  ];

  function setDateOrder(order) {
    dateOrder = DATE_ORDERS.some((o) => o.id === order) ? order : 'mdy';
  }

  function getDateOrder() {
    return dateOrder;
  }

  /**
   * Format a date for display.
   * Presets: 'iso' | 'short' (12 Mar 26) | 'medium' (12 Mar 2026) |
   *          'long' (12 March 2026) | 'day' (Thu 12 Mar) | 'monthYear' |
   *          'quarter' (Q1 2026) | 'week' (W07 2026) | 'compact' (12/03/26)
   */
  function fmtDate(ms, preset = 'medium') {
    if (!Number.isFinite(ms)) return '—';
    const d = new Date(ms);
    const day = d.getUTCDate();
    const mon = d.getUTCMonth();
    const year = d.getUTCFullYear();
    const weekday = DAYS_SHORT[d.getUTCDay()];
    const us = dateOrder === 'mdy';
    const iso = dateOrder === 'ymd';

    /** "Mar 12, 2026" / "12 Mar 2026" / "2026 Mar 12" */
    const worded = (month, y) =>
      iso ? `${y} ${month} ${day}` : us ? `${month} ${day}, ${y}` : `${day} ${month} ${y}`;

    switch (preset) {
      case 'iso':
        return toISO(ms);

      case 'numeric':
        if (iso) return toISO(ms);
        return us ? `${mon + 1}/${day}/${year}` : `${day}/${mon + 1}/${year}`;

      case 'compact':
        if (iso) return `${String(year).slice(2)}-${pad(mon + 1)}-${pad(day)}`;
        return us
          ? `${mon + 1}/${day}/${String(year).slice(2)}`
          : `${day}/${mon + 1}/${String(year).slice(2)}`;

      case 'short':
        return worded(MONTHS_SHORT[mon], String(year).slice(2));

      case 'long':
        return worded(MONTHS[mon], year);

      case 'day':
        return iso
          ? `${weekday} ${MONTHS_SHORT[mon]} ${day}`
          : us
          ? `${weekday}, ${MONTHS_SHORT[mon]} ${day}`
          : `${weekday} ${day} ${MONTHS_SHORT[mon]}`;

      case 'dayFull':
        return iso
          ? `${weekday} ${year} ${MONTHS_SHORT[mon]} ${day}`
          : us
          ? `${weekday}, ${MONTHS_SHORT[mon]} ${day}, ${year}`
          : `${weekday} ${day} ${MONTHS_SHORT[mon]} ${year}`;

      case 'monthYear':
        return `${MONTHS_SHORT[mon]} ${year}`;

      case 'quarter':
        return `Q${quarterOf(ms)} ${year}`;

      case 'week': {
        const w = isoWeek(ms);
        return `W${String(w.week).padStart(2, '0')} ${w.year}`;
      }

      case 'medium':
      default:
        return worded(MONTHS_SHORT[mon], year);
    }
  }

  /** Human duration from a day count: "3d", "2w 1d", "4mo". */
  function fmtDuration(days) {
    const n = Math.abs(Math.round(days));
    const sign = days < 0 ? '−' : '';
    // A week is five days when durations are counted in working days, so ten of
    // them read as "2w" rather than "1w 3d". Pushed in by the store, like the
    // date order: this module is a leaf and cannot read a setting for itself.
    const week = workWeek;
    const month = week * 4.348;
    const year = week * 52.18;

    if (n === 0) return '0d';
    if (n < week * 2) return `${sign}${n}d`;
    if (n < week * 10) {
      const w = Math.floor(n / week);
      const d = n % week;
      return `${sign}${w}w${d ? ` ${d}d` : ''}`;
    }
    if (n < year * 2) return `${sign}${Math.round(n / month)}mo`;
    return `${sign}${(n / year).toFixed(1)}y`;
  }

  /** Days in a working week, for the phrasing above. 7 counts the calendar. */
  let workWeek = 7;

  function setWorkWeek(days) {
    workWeek = days === 5 ? 5 : 7;
  }

  function getWorkWeek() {
    return workWeek;
  }

  /** Relative phrasing against a reference date: "in 4 days", "2 weeks ago". */
  function fmtRelative(ms, ref = todayMs()) {
    const d = daysBetween(ref, ms);
    if (d === 0) return 'today';
    if (d === 1) return 'tomorrow';
    if (d === -1) return 'yesterday';
    const abs = fmtDuration(Math.abs(d));
    return d > 0 ? `in ${abs}` : `${abs} ago`;
  }

  /** Timestamp for version history and backups — local time, by design. */
  function fmtTimestamp(ms) {
    const d = new Date(ms);
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const month = MONTHS_SHORT[d.getMonth()];
    if (dateOrder === 'ymd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
    if (dateOrder === 'mdy') return `${month} ${d.getDate()}, ${d.getFullYear()} ${time}`;
    return `${d.getDate()} ${month} ${d.getFullYear()} ${time}`;
  }

  /* ── Time-axis tick generation ─────────────────────────────────────────── */

  /**
   * The scale ladder. `minPxPerDay` is the zoom level at which a scale becomes
   * the sensible primary unit; the viewport picks the finest scale that fits.
   */
  const SCALES = [
    { id: 'day', label: 'Day', minPxPerDay: 26, step: MS_DAY },
    { id: 'week', label: 'Week', minPxPerDay: 5.2, step: MS_WEEK },
    { id: 'month', label: 'Month', minPxPerDay: 1.5, step: MS_DAY * 30.44 },
    { id: 'quarter', label: 'Quarter', minPxPerDay: 0.55, step: MS_DAY * 91.3 },
    { id: 'year', label: 'Year', minPxPerDay: 0, step: MS_DAY * 365.25 },
  ];

  /** The scale one rung coarser than `id` — used for the ruler's upper band. */
  function coarserScale(id) {
    const i = SCALES.findIndex((s) => s.id === id);
    return SCALES[Math.min(SCALES.length - 1, i + 1)];
  }

  /**
   * Generate ruler ticks for a scale across [fromMs, toMs].
   * Each tick is `{ start, end, label, sub, major, weekend }`.
   * Generation is bounded (`limit`) so a pathological zoom can never lock the
   * main thread building a million DOM nodes.
   */
  function ticks(scale, fromMs, toMs, opts = {}) {
    const { weekStart = 1, limit = 4000 } = opts;
    const out = [];
    let cur;
    let guard = 0;

    switch (scale) {
      case 'day':
        cur = startOfDay(fromMs);
        while (cur <= toMs && guard++ < limit) {
          const d = new Date(cur);
          const dow = d.getUTCDay();
          out.push({
            start: cur,
            end: cur + MS_DAY,
            label: String(d.getUTCDate()),
            sub: DAYS_MIN[dow],
            major: dow === weekStart,
            weekend: dow === 0 || dow === 6,
          });
          cur += MS_DAY;
        }
        break;

      case 'week':
        cur = startOfWeek(fromMs, weekStart);
        while (cur <= toMs && guard++ < limit) {
          const w = isoWeek(cur);
          out.push({
            start: cur,
            end: cur + MS_WEEK,
            label: `W${String(w.week).padStart(2, '0')}`,
            sub: fmtDate(cur, 'compact'),
            major: w.week === 1 || new Date(cur).getUTCDate() <= 7,
            weekend: false,
          });
          cur += MS_WEEK;
        }
        break;

      case 'month':
        cur = startOfMonth(fromMs);
        while (cur <= toMs && guard++ < limit) {
          const d = new Date(cur);
          const next = addMonths(cur, 1);
          out.push({
            start: cur,
            end: next,
            label: MONTHS_SHORT[d.getUTCMonth()],
            sub: String(d.getUTCFullYear()),
            major: d.getUTCMonth() % 3 === 0,
            weekend: false,
          });
          cur = next;
        }
        break;

      case 'quarter':
        cur = startOfQuarter(fromMs);
        while (cur <= toMs && guard++ < limit) {
          const d = new Date(cur);
          const next = addMonths(cur, 3);
          out.push({
            start: cur,
            end: next,
            label: `Q${quarterOf(cur)}`,
            sub: String(d.getUTCFullYear()),
            major: d.getUTCMonth() === 0,
            weekend: false,
          });
          cur = next;
        }
        break;

      case 'year':
      default:
        cur = startOfYear(fromMs);
        while (cur <= toMs && guard++ < limit) {
          const next = addYears(cur, 1);
          out.push({
            start: cur,
            end: next,
            label: String(new Date(cur).getUTCFullYear()),
            sub: '',
            major: true,
            weekend: false,
          });
          cur = next;
        }
        break;
    }

    return out;
  }

  /**
   * Snap a timestamp to a grid.
   * `mode`: 'off' | 'day' | 'week' | 'month' | 'quarter' | 'workday'
   */
  function snap(ms, mode, opts = {}) {
    const { weekStart = 1, holidays = [] } = opts;
    switch (mode) {
      case 'day':
        return Math.round(ms / MS_DAY) * MS_DAY;
      case 'week': {
        const s = startOfWeek(ms, weekStart);
        return ms - s > MS_WEEK / 2 ? s + MS_WEEK : s;
      }
      case 'month': {
        const s = startOfMonth(ms);
        const e = addMonths(s, 1);
        return ms - s > (e - s) / 2 ? e : s;
      }
      case 'quarter': {
        const s = startOfQuarter(ms);
        const e = addMonths(s, 3);
        return ms - s > (e - s) / 2 ? e : s;
      }
      case 'workday': {
        let d = Math.round(ms / MS_DAY) * MS_DAY;
        const set = new Set(holidays);
        let guard = 0;
        while ((isWeekend(d) || set.has(toISO(d))) && guard++ < 14) d += MS_DAY;
        return d;
      }
      case 'off':
      default:
        return ms;
    }
  }

  /** Inclusive-exclusive overlap test for two date ranges. */
  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  Object.defineProperty(__x, "MS_MINUTE", { get: () => MS_MINUTE, enumerable: true });
  Object.defineProperty(__x, "MS_HOUR", { get: () => MS_HOUR, enumerable: true });
  Object.defineProperty(__x, "MS_DAY", { get: () => MS_DAY, enumerable: true });
  Object.defineProperty(__x, "MS_WEEK", { get: () => MS_WEEK, enumerable: true });
  Object.defineProperty(__x, "MONTHS", { get: () => MONTHS, enumerable: true });
  Object.defineProperty(__x, "MONTHS_SHORT", { get: () => MONTHS_SHORT, enumerable: true });
  Object.defineProperty(__x, "DAYS", { get: () => DAYS, enumerable: true });
  Object.defineProperty(__x, "DAYS_SHORT", { get: () => DAYS_SHORT, enumerable: true });
  Object.defineProperty(__x, "DAYS_MIN", { get: () => DAYS_MIN, enumerable: true });
  Object.defineProperty(__x, "toMs", { get: () => toMs, enumerable: true });
  Object.defineProperty(__x, "toISO", { get: () => toISO, enumerable: true });
  Object.defineProperty(__x, "toISOMinutes", { get: () => toISOMinutes, enumerable: true });
  Object.defineProperty(__x, "todayMs", { get: () => todayMs, enumerable: true });
  Object.defineProperty(__x, "startOfDay", { get: () => startOfDay, enumerable: true });
  Object.defineProperty(__x, "endOfDay", { get: () => endOfDay, enumerable: true });
  Object.defineProperty(__x, "startOfWeek", { get: () => startOfWeek, enumerable: true });
  Object.defineProperty(__x, "startOfMonth", { get: () => startOfMonth, enumerable: true });
  Object.defineProperty(__x, "endOfMonth", { get: () => endOfMonth, enumerable: true });
  Object.defineProperty(__x, "startOfQuarter", { get: () => startOfQuarter, enumerable: true });
  Object.defineProperty(__x, "startOfYear", { get: () => startOfYear, enumerable: true });
  Object.defineProperty(__x, "addDays", { get: () => addDays, enumerable: true });
  Object.defineProperty(__x, "addWeeks", { get: () => addWeeks, enumerable: true });
  Object.defineProperty(__x, "addMonths", { get: () => addMonths, enumerable: true });
  Object.defineProperty(__x, "addYears", { get: () => addYears, enumerable: true });
  Object.defineProperty(__x, "daysInMonth", { get: () => daysInMonth, enumerable: true });
  Object.defineProperty(__x, "daysBetween", { get: () => daysBetween, enumerable: true });
  Object.defineProperty(__x, "isWeekend", { get: () => isWeekend, enumerable: true });
  Object.defineProperty(__x, "workingDaysBetween", { get: () => workingDaysBetween, enumerable: true });
  Object.defineProperty(__x, "addWorkingSpan", { get: () => addWorkingSpan, enumerable: true });
  Object.defineProperty(__x, "addWorkingDays", { get: () => addWorkingDays, enumerable: true });
  Object.defineProperty(__x, "isoWeek", { get: () => isoWeek, enumerable: true });
  Object.defineProperty(__x, "quarterOf", { get: () => quarterOf, enumerable: true });
  Object.defineProperty(__x, "DATE_ORDERS", { get: () => DATE_ORDERS, enumerable: true });
  Object.defineProperty(__x, "setDateOrder", { get: () => setDateOrder, enumerable: true });
  Object.defineProperty(__x, "getDateOrder", { get: () => getDateOrder, enumerable: true });
  Object.defineProperty(__x, "fmtDate", { get: () => fmtDate, enumerable: true });
  Object.defineProperty(__x, "fmtDuration", { get: () => fmtDuration, enumerable: true });
  Object.defineProperty(__x, "setWorkWeek", { get: () => setWorkWeek, enumerable: true });
  Object.defineProperty(__x, "getWorkWeek", { get: () => getWorkWeek, enumerable: true });
  Object.defineProperty(__x, "fmtRelative", { get: () => fmtRelative, enumerable: true });
  Object.defineProperty(__x, "fmtTimestamp", { get: () => fmtTimestamp, enumerable: true });
  Object.defineProperty(__x, "SCALES", { get: () => SCALES, enumerable: true });
  Object.defineProperty(__x, "coarserScale", { get: () => coarserScale, enumerable: true });
  Object.defineProperty(__x, "ticks", { get: () => ticks, enumerable: true });
  Object.defineProperty(__x, "snap", { get: () => snap, enumerable: true });
  Object.defineProperty(__x, "overlaps", { get: () => overlaps, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// core/lookahead.js
// ════════════════════════════════════════════════════════════════════════
__mods["core/lookahead.js"] = function (__x, __req) {
  /**
   * Comparing two look-ahead snapshots.
   *
   * The look-ahead is the contractual source of truth and the resource calendar
   * is the execution record; the difference between two snapshots is what a
   * delay claim is eventually built from. So the rules here are about being
   * *honest* rather than clever — the system logs what it can see and asks a
   * person about what it cannot.
   *
   * Two rules do most of the work, and both exist because the obvious version
   * produces numbers that flatter or damn the wrong party.
   *
   * **Only weeks in both snapshots are compared.** A four-week window rolls
   * forward, so a week appearing at the far edge is not scope being added and a
   * week dropping off the back is not scope being removed. Counting them as such
   * would book a batch of phantom additions every single week, and would count
   * finished work as deleted scope — inflating exactly the number you would most
   * want to defend.
   *
   * **A crew moving site is not inferred.** When work finishes early and a team
   * moves, one row disappears and another appears with the same resources. The
   * activity text is not reliable enough to match on — the spec says so and it is
   * right — so it is logged honestly as a removal and an addition, and a person
   * can relink the pair afterwards. Guessing would be the one failure mode
   * nobody could audit.
   *
   * **A Resource row belongs to the activity above it.** The workbook names who
   * is on an activity by adding a row underneath whose description reads
   * "Resource", with the names typed into the day cells; where and when are left
   * blank because they are the line above's. So it is read as part of that
   * activity rather than as one of its own — otherwise half the sheet is rows
   * called "Resource" with no location — and a name is never matched to a person
   * here. That happens against the roster, where an unmatched spelling can be
   * shown to somebody instead of guessed at.
   *
   * Imports: nothing (leaf).
   */

  /* ── The Resource row ──────────────────────────────────────────────────── */

  /**
   * Is this what the workbook writes under an activity to name who is on it?
   *
   * The 4WLA carries a row directly beneath each activity whose description cell
   * reads "Resource", and the day cells on it hold the names typed against that
   * activity. It is recognised by that one word and nothing else — folded for
   * case and punctuation, but not loosened any further. "Resource Names" is not
   * it: a rule that matched anything containing the word would swallow an
   * activity called "Resource mobilisation", and a row misread as a label is a
   * row of work that vanishes off the calendar.
   */
  function isResourceLabel(text) {
    return /^resources?$/.test(String(text ?? '').toLowerCase().replace(/[^a-z]/g, ''));
  }

  /**
   * Which kind of absence a row's description names, or null.
   *
   * The workbook carries rows at the bottom that are not site work: "PTO",
   * "Office" and "Other Group / Project", with names typed into the day cells the
   * same way the Resource row carries them. They say where somebody is when they
   * are not on the project — off, at their desk, or on another group's work —
   * which is a fact about the person rather than about an activity, and it is the
   * fact the week plan and the huddle are otherwise missing entirely: a blank
   * against a name reads as "nobody planned this", when the sheet said exactly
   * why. Only PTO means they were not working; the rest are days like any other,
   * and they carry a category so the reports can group them.
   *
   * Strict for the reason `isResourceLabel()` is strict, and with the same two
   * failures in mind. A row misread as a label is a row of work that vanishes off
   * the calendar; a label misread as work is a row of names at no location that
   * every report then counts as scope. So the spellings are enumerated rather than
   * matched loosely — "Other" alone is not one of them, because it names nothing.
   */
  function absenceKind(text) {
    const folded = String(text ?? '').toLowerCase().replace(/[^a-z]/g, '');
    if (/^(pto|paidtimeoff|timeoff|vacation|annualleave|holiday)$/.test(folded)) return 'pto';
    if (/^(office|officeday|inoffice|officebased)$/.test(folded)) return 'office';
    if (/^other(group|project)/.test(folded)) return 'other';
    return null;
  }

  /**
   * The three facts about each kind, in one table.
   *
   * They were spread across three modules — the label here, whether it counts as
   * leave inside `availability()`, and nothing at all about which category the
   * day belongs to — and the first time a kind was added that was three places to
   * remember. What each one *is*:
   *
   * **`leave`** decides whether the person was there at all. PTO is the only one:
   * somebody in the office or on another group's project is working, they can be
   * asked how the day went, and folding them into leave would put a person who
   * was at their desk down as absent.
   *
   * **`category`** is the seeded `rc_categories` row the day belongs to, matched
   * by name because that is what the schema seeds it as. A renamed category
   * simply stops matching and the day arrives uncategorised — ungrouped in the
   * reports rather than grouped wrongly, which is the right way for a
   * name match to fail.
   */
  const ABSENCE_KINDS = {
    pto:    { label: 'PTO',                   leave: true,  category: null },
    office: { label: 'Office',                leave: false, category: 'Office' },
    other:  { label: 'Other group / project', leave: false, category: 'Other project' },
  };

  /** What each kind is called on screen. One place, so three views cannot differ. */
  const ABSENCE_LABELS = Object.fromEntries(
    Object.entries(ABSENCE_KINDS).map(([kind, it]) => [kind, it.label])
  );

  /**
   * The people named in one cell.
   *
   * Typed by hand, so the separator is whatever was to hand: a comma, a slash, a
   * newline, an ampersand, a plus, the word "and", or simply two spaces where somebody
   * pressed the bar twice. Nothing is matched to a person here — that is the
   * roster's job, through the alias register — this only splits what was written.
   *
   * **Spacing is noise, not a name.** A cell reading `Victor ,Rosa` and one
   * reading `Victor, Rosa` are the same two people, so each piece is trimmed and
   * its own internal runs of whitespace are collapsed before it is handed on: a
   * name carrying a stray double space would otherwise fold to a different string
   * from the same name typed once, and match nobody for a reason no reader could
   * see. A newline inside a cell is a separator rather than a space, because that
   * is how a second name gets into one cell in Excel.
   */
  function resourceNames(text) {
    return String(text ?? '')
      /* "and" is tried before the two-space rule on purpose: an alternation is
         read left to right, so `\s{2,}` would otherwise eat the spaces around a
         spelled-out "and" and leave the word behind as a person. */
      .split(/\s+and\s+|[,;/\n&+]|\s{2,}/i)
      .map((s) => s.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
  }

  /**
   * Stored days whose look-ahead row now names somebody else.
   *
   * The 4WLA's Resource row is the plan for the days it names, so a stored
   * `rc_plan_entries` row carrying a `lookahead_row_id` is somebody having
   * confirmed or overridden what that row said. When a later read of the sheet
   * puts a different name on the same row for the same day, the work has moved —
   * and until this existed the entry stayed against whoever it was first written
   * for. The visible cost is somebody turning up for a shift that is not theirs
   * any more while the person who now has it has a blank against their name.
   *
   * `resolve` is the name lookup, **injected** for the reason `rowsFrom()` takes
   * `locate`: the register lives two layers up, this module is a leaf, and the
   * whole pipeline has to be testable with no browser and no network. It answers
   * a person id for a written name, or null.
   *
   * Returns `[{ entry, from, to }]`, and returns nothing at all unless it is
   * certain:
   *
   * **The row has to say something about that day.** A day the sheet no longer
   * names anybody on is not a reassignment — it is the sheet going quiet, which
   * happens whenever an activity is rescheduled, and moving a task to nobody is
   * not a thing that can be written.
   *
   * **It has to name exactly one person the roster knows.** Two names on a day is
   * a crew, and a crew is not "this task moved to Victor" — it is several entries,
   * which is a decision somebody takes rather than one this can derive. An
   * unmatched spelling stops it too: those are reported and answered with an
   * alias, and guessing here would be the near-miss matching the register refuses.
   *
   * **It has to be somebody else.** A re-read that changed nothing must produce
   * nothing, or every ingest would supersede every linked entry with a revision
   * saying the same thing. `rc_reassign_plan()` refuses that case as well, so it
   * is checked on both sides on purpose.
   */
  function reassignments({ planRows, laRows, resolve }) {
    const byRow = new Map();
    for (const row of laRows || []) {
      if (row?.id) byRow.set(row.id, row);
    }

    const out = [];
    for (const entry of planRows || []) {
      if (!entry?.id || !entry.lookahead_row_id) continue;
      const row = byRow.get(entry.lookahead_row_id);
      if (!row) continue;
      const written = resourceNames(row.resources?.[entry.work_date] || '');
      if (!written.length) continue;

      const ids = new Set();
      let unknown = false;
      for (const name of written) {
        const id = resolve ? resolve(name) : null;
        if (id) ids.add(id);
        else unknown = true;
      }
      // One person, and every name on the day accounted for. Anything else is a
      // crew or a spelling nobody has mapped, and neither is a move.
      if (unknown || ids.size !== 1) continue;
      const [to] = [...ids];
      if (to === entry.person_id) continue;
      out.push({ entry, from: entry.person_id, to });
    }
    return out;
  }

  /**
   * Every mark on an activity, the ones on its Resource row included.
   *
   * Whether a row has work on it is a question about the pair, not about the
   * activity line alone: the workbook sometimes paints the shift on the Resource
   * row instead. Both places that ask — `readGrid()` and the calendar's window —
   * have to ask it the same way, which is why it is a function and not two loops.
   */
  function marksOf(activity) {
    return activity?.resource ? [...activity.marks, ...activity.resource.marks] : (activity?.marks || []);
  }

  /* ── Row identity ──────────────────────────────────────────────────────── */

  /**
   * A key for a row that survives the file being edited.
   *
   * The look-ahead has no activity IDs — no P6 numbers, nothing stable — and its
   * descriptions are not matchable. Location, week and subsystem are what remain,
   * plus an ordinal to separate two rows that share all three.
   *
   * The ordinal is the weak part, and knowingly so: inserting a row in the middle
   * of a group shifts everything below it and produces a false removed/added
   * pair. That is tolerable only because the manual relink exists to fix it, and
   * because the alternative — matching on text — would produce *wrong* answers
   * rather than noisy ones.
   */
  function rowKey({ weekStart, location, subsystem = '', ordinal = 0 }) {
    return [weekStart, String(location || '').trim(), String(subsystem || '').trim(), ordinal].join('|');
  }

  /** Assign ordinals within each (week, location, subsystem) group. */
  function keyRows(rows) {
    const seen = new Map();
    return rows.map((row) => {
      const group = [row.weekStart, row.location, row.subsystem || ''].join('|');
      const ordinal = seen.get(group) || 0;
      seen.set(group, ordinal + 1);
      return { ...row, rowKey: rowKey({ ...row, ordinal }) };
    });
  }

  /* ── Reading the grid as a calendar ────────────────────────────────────── */

  const WEEKDAYS = ['M', 'TU', 'W', 'TH', 'F', 'SA', 'SU'];

  const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
    'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  /**
   * The one month a label names, or -1.
   *
   * A week straddling a boundary is labelled "August/September" in this
   * workbook, and a label naming two months anchors nothing — it is skipped
   * rather than resolved to the first of them.
   */
  function oneMonth(label) {
    const text = String(label || '').toUpperCase();
    const hits = new Set();
    MONTH_NAMES.forEach((name, i) => {
      if (text.includes(name) || new RegExp(`\\b${name.slice(0, 3)}\\b`).test(text)) hits.add(i);
    });
    return hits.size === 1 ? [...hits][0] : -1;
  }

  /**
   * Give every day column a real date, or none of them one.
   *
   * The sheet carries months and day numbers and no year at all, so a year has
   * to come from somewhere else. Two things supply it, and the second is what
   * makes this safe to rely on rather than a guess:
   *
   * **The snapshot's own timestamp** says roughly when the window was current.
   * The look-ahead is maintained four to six weeks out, so the window brackets
   * the day it was read; that narrows the year to one of three candidates.
   *
   * **The weekday letters check the answer.** The sheet writes M, Tu, W beside
   * every day, and only one of the candidate years makes those letters come out
   * right — the same date is a different weekday in adjacent years. So the year
   * is not inferred and hoped for, it is *verified* against something the file
   * already says, and where the letters do not agree no dates are claimed at
   * all and everything that depends on them stands down.
   *
   * Mutates `days`, adding `date` (an ISO string) where it can.
   */
  function datePlease(days, anchorISO) {
    if (!days.length) return false;

    /* Day numbers first: they are always present, and a drop from 30 to 1 is a
       month boundary whether or not anybody labelled it. That matters because
       the visible window often starts mid-month, with the label for that month
       sitting in a column the workbook has hidden. */
    const nums = [];
    for (let i = 0; i < days.length; i++) {
      const n = parseInt(String(days[i].day).replace(/\D/g, ''), 10);
      nums.push(Number.isFinite(n) && n >= 1 && n <= 31 ? n : (nums[i - 1] || 0) + 1);
    }

    let anchorAt = -1;
    let anchorMonth = -1;
    for (let i = 0; i < days.length; i++) {
      const m = oneMonth(days[i].label);
      if (m >= 0) { anchorAt = i; anchorMonth = m; break; }
    }
    if (anchorAt < 0) return false;

    const months = new Array(days.length).fill(-1);
    months[anchorAt] = anchorMonth;
    for (let i = anchorAt + 1; i < days.length; i++) {
      months[i] = nums[i] < nums[i - 1] ? (months[i - 1] + 1) % 12 : months[i - 1];
    }
    for (let i = anchorAt - 1; i >= 0; i--) {
      months[i] = nums[i] > nums[i + 1] ? (months[i + 1] + 11) % 12 : months[i + 1];
    }

    // Relative years: the axis only ever runs forwards, so a month going
    // backwards is the turn of a year.
    const rel = [0];
    for (let i = 1; i < days.length; i++) rel.push(rel[i - 1] + (months[i] < months[i - 1] ? 1 : 0));

    const anchorMs = Date.parse(`${String(anchorISO || '').slice(0, 10)}T00:00:00Z`);
    const base = Number.isFinite(anchorMs)
      ? new Date(anchorMs).getUTCFullYear()
      : new Date().getUTCFullYear();

    const LETTERS = ['SU', 'M', 'TU', 'W', 'TH', 'F', 'SA'];
    let bestYear = null;
    let bestScore = -1;
    for (const year of [base - 1, base, base + 1]) {
      let agree = 0;
      for (let i = 0; i < days.length; i++) {
        const ms = Date.UTC(year + rel[i], months[i], nums[i]);
        if (LETTERS[new Date(ms).getUTCDay()] === String(days[i].weekday).trim().toUpperCase()) agree++;
      }
      // Closeness to the snapshot breaks a tie; the letters decide otherwise.
      const mid = Date.UTC(year + rel[rel.length >> 1], months[days.length >> 1], nums[days.length >> 1]);
      const near = Number.isFinite(anchorMs) ? 1 - Math.min(1, Math.abs(mid - anchorMs) / 3.2e10) : 0;
      const score = agree + near;
      if (score > bestScore) { bestScore = score; bestYear = year; }
    }

    // Below this the letters are not agreeing and the reading is wrong. Saying
    // nothing is the only honest answer: a today line on the wrong column is
    // worse than no today line.
    const agreement = Math.floor(bestScore) / days.length;
    if (agreement < 0.9) return false;

    for (let i = 0; i < days.length; i++) {
      days[i].date = new Date(Date.UTC(bestYear + rel[i], months[i], nums[i]))
        .toISOString().slice(0, 10);
      days[i].month = `${MONTH_NAMES[months[i]].slice(0, 3)} ${bestYear + rel[i]}`;
    }
    return true;
  }

  /**
   * Turn a parsed sheet into something that can be drawn: days across the top,
   * activities down the side.
   *
   * Everything here is *found* rather than configured, and that is the point.
   * The look-ahead is a spreadsheet somebody maintains by hand: rows get
   * inserted, the window scrolls, columns are hidden and unhidden as the weeks
   * move. A layout pinned to "dates start at column H" would be wrong the first
   * time anybody inserted a column, and wrong silently — the grid would still
   * draw, against the wrong days.
   *
   * So the date axis is located by looking for the row of weekday letters, which
   * is the one row on the sheet whose content cannot be mistaken for anything
   * else. The day numbers sit directly above it and the month labels above
   * those; the columns it occupies are the calendar, and everything to the left
   * of them is what the activity *is*.
   *
   * No year is invented. The sheet does not carry one, and a date is not
   * something to infer from a month name — the axis is drawn as the workbook
   * writes it.
   */
  function readGrid(grid, { anchorISO = null } = {}) {
    const rows = (grid?.rows || []).slice().sort((a, b) => a.row - b.row);
    const empty = { days: [], meta: [], headings: [], activities: [], header: null };
    if (!rows.length) return empty;

    // The weekday row: the one where most values are M/Tu/W/Th/F/Sa/Su.
    let header = null;
    let best = 0;
    for (const row of rows) {
      const hits = row.cells.filter((c) => WEEKDAYS.includes(String(c.value ?? '').trim().toUpperCase()));
      if (hits.length > best && hits.length >= 7) {
        best = hits.length;
        header = row;
      }
    }
    if (!header) return empty;

    const dayCols = header.cells
      .filter((c) => WEEKDAYS.includes(String(c.value ?? '').trim().toUpperCase()))
      .map((c) => c.col)
      .sort((a, b) => a - b);
    const dayCol = new Set(dayCols);
    const firstDay = dayCols[0];

    const at = (row, col) => row?.cells.find((c) => c.col === col);
    const above = (n) => rows.filter((r) => r.row < header.row).slice(-n)[0] || null;
    const numbers = above(1);
    const months = above(2);

    /* The month label is a merged cell, so only the leftmost column of each
       block carries it. Carrying the last one forward is what merged means. */
    let month = '';
    const days = dayCols.map((col) => {
      const label = String(at(months, col)?.value ?? '').trim();
      if (label) month = label;
      return {
        col,
        month,
        // What the sheet actually wrote here, as opposed to what was carried
        // across the merge. Only a real label can anchor the calendar.
        label,
        day: String(at(numbers, col)?.value ?? '').trim(),
        weekday: String(at(header, col)?.value ?? '').trim(),
        weekend: ['SA', 'SU'].includes(String(at(header, col)?.value ?? '').trim().toUpperCase()),
      };
    });

    datePlease(days, anchorISO);

    /* The activity columns are whatever is used to the left of the calendar.
       Their headings are not reliably on any one row — this file labels some and
       not others — so they are numbered by position and named where a heading
       happens to exist above the first activity. */
    const body = rows.filter((r) => r.row > header.row);

    /* The row the sheet writes its column headings on.
       "Activity ID, Description of Work Activity, Location, SSWP, Party to Action,
       Work hours" sit together on one row above the calendar, and that row is found
       the way the weekday row is: it is the one, at or above the weekday row, with
       the most text left of the first day. Reading each column's nearest text
       upwards instead — which is what this did — takes whatever is closest, so a
       note typed in a gap row, or a label on the weekday row itself, stood in for
       the real heading of its column and the row of headings never showed. A
       single stray cell cannot win against a row of six. */
    const labelled = (row) => row.cells.filter((c) => c.col < firstDay && String(c.value ?? '').trim());
    let headingRow = null;
    for (const row of rows) {
      if (row.row > header.row) break;
      const count = labelled(row).length;
      if (count >= 2 && count >= (headingRow ? labelled(headingRow).length : 0)) headingRow = row;
    }

    /* The activity columns: every column left of the calendar that the body uses
       or the heading row names. A named column whose cells are all empty is still
       one of the sheet's columns — leaving it out would shift every heading after
       it onto the wrong values in the reader's head. */
    const metaCols = [...new Set([
      ...body.flatMap((r) => labelled(r).map((c) => c.col)),
      ...(headingRow ? labelled(headingRow).map((c) => c.col) : []),
    ])].sort((a, b) => a - b);

    /* What the sheet calls each of those columns: its cell on the heading row,
       and only where that row says nothing, the nearest text above the weekday
       row — the reading a sheet with its headings scattered over rows still needs.
       It is worth reading rather than guessing because one of these columns is the
       location, and knowing *which* is the difference between recording where the
       work is and recording nothing. An unlabelled column is ''. */
    const headings = metaCols.map((col) => {
      const own = String(at(headingRow, col)?.value ?? '').trim();
      if (own) return own;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].row > header.row) continue;
        const text = String(at(rows[i], col)?.value ?? '').trim();
        if (text) return text;
      }
      return '';
    });

    const activities = [];
    for (const row of body) {
      const meta = metaCols.map((col) => String(at(row, col)?.value ?? '').trim());
      const marks = row.cells
        .filter((c) => dayCol.has(c.col) && (String(c.value ?? '').trim() || c.hex))
        .map((c) => ({
          col: c.col,
          value: String(c.value ?? '').trim(),
          hex: c.hex || null,
          meaning: c.meaning || null,
          role: c.role || (c.hex ? 'shift' : null),
        }));

      // A row with neither a description nor a mark is spacing, not work.
      if (!meta.some(Boolean) && !marks.some((m) => m.value)) continue;

      /* A heading is a row whose *activity* cells are painted.
         That is a structural fact rather than a reading of the colour, and it is
         what makes it reliable: the shading that runs along the day columns of
         every row paints only the calendar, never the description beside it. So
         a section title is recognised without anybody having to tell the legend
         which of several near-identical greys means "divider".
         Only the columns *left* of the calendar count. `!dayCol.has(col)` also
         took in anything painted to the right of the last day — a totals column,
         a trailing border — and one of those turns every row in the workbook
         into a heading, which is how a whole file arrived on screen at once. */
      const heading = row.cells.some((c) => c.col < firstDay && c.hex);

      /* "PTO", "Office", "Other Group / Project": rows of names that are not
         site work.
         Unlike the Resource row they stand on their own — they sit at the bottom
         of the sheet and belong to nobody above them, because what they say is
         about the *person*, not about an activity. So they are emitted as rows in
         their own right, marked with the kind, and everything downstream reads
         `absence` to know this is not scope: `rowsFrom()` skips them so they can
         never be counted as work added or removed, and the calendar draws them
         with the names rather than with the activities. */
      const absence = absenceKind(meta.find((value) => absenceKind(value)) || '');
      if (!heading && absence) {
        activities.push({
          row: row.row, meta, marks, heading: false, highlighted: false,
          named: true, resource: null, absence,
        });
        continue;
      }

      /* The Resource row the workbook writes under an activity.
         It belongs to the activity above it rather than being one of its own: it
         carries no work of its own, it inherits where and when from the line it
         sits under, and drawn as a separate activity it would be a hundred and
         forty rows of the word "Resource". Its day cells are the names.

         **Directly above means the row directly above, on the sheet.** This used
         to take whichever activity happened to have been pushed last, however far
         up the sheet it was — so anything the parser stepped over on the way down
         silently re-parented the names. A hidden row is the case that bit: the
         workbook hides an activity, `parseSheet()` drops it before this ever sees
         it, and the Resource row underneath attached itself to the activity above
         the hidden one. Nothing on the calendar showed it, because the names were
         drawn against the row they were typed on — but the derived plan booked
         somebody onto an activity that is not in the 4WLA at all, which is exactly
         how it was found. `above.row === row.row - 1` is the whole test: a gap in
         the numbering means *something* was between them — hidden, skipped as
         spacing, or a band — and there is no honest way to say whose names these
         are.

         An orphan is dropped rather than drawn. It is a label row whatever it is
         attached to: pushed as an activity it would be the word "Resource" at no
         location, counted as scope by every report, which is worse than the wrong
         parent it replaces. */
      if (!heading && meta.some(isResourceLabel)) {
        const above = activities[activities.length - 1];
        if (above && above.row === row.row - 1 && !above.heading && !above.absence) {
          above.resource = {
            row: row.row,
            /* Where and when come from the activity above — that is what the
               workbook means by leaving them blank on this row. Anything typed
               here wins, so a resource working different hours can say so. */
            meta: meta.map((value, i) => value || above.meta[i] || ''),
            marks,
            names: marks.filter((m) => m.value).map((m) => ({ col: m.col, names: resourceNames(m.value) })),
          };
          above.highlighted = marksOf(above).some((m) => m.hex && m.role === 'shift');
        }
        continue;
      }

      /* "Highlighted" means at least one day carries paint that is *work*.
         Tested as `role === 'shift'` rather than `role !== 'ignore'`, which is
         not the same question and got the answer wrong: a `divider` is the grey
         the workbook paints its section bands in, and a row whose only colour is
         a divider or a weekend band has nothing scheduled on it — but it read as
         highlighted and survived into the grid.
         An unmapped colour still counts, because `applyLegend()` gives it
         `shift`: until somebody says what a colour is, the honest assumption is
         that it might be work, and hiding it would bury the rows that most need
         attention. */
      const highlighted = marks.some((m) => m.hex && m.role === 'shift');

      /* Whether anybody wrote down what this row *is*.
         A row of paint with no description is not an activity — it is a band, a
         spacer, or a fill somebody dragged too far — and putting it on the
         calendar asks the reader to work out which. It is hidden with the
         unscheduled rows rather than dropped, so the switch still brings it back. */
      const named = meta.some(Boolean);

      activities.push({ row: row.row, meta, marks, heading, highlighted, named, resource: null, absence: null });
    }

    return { days, meta: metaCols, headings, activities, header: header.row };
  }

  /**
   * Who the sheet says is away, and on which day.
   *
   * One entry per day cell written on a "PTO" or "Other Group / Project" row:
   * `{ kind, row, date, written }`, where `written` is the spelling that was
   * typed. Nothing is matched to a person here — that is the register's job, the
   * same as for the Resource row — and nothing is invented for a day the sheet
   * left blank.
   *
   * Derived at paint time rather than stored, for the reason the whole 4WLA
   * reading is: `rc_leave` is the record of leave somebody *booked*, and writing
   * the workbook into it would make the sheet's authorship indistinguishable from
   * a decision, go stale the moment somebody edited a cell, and need cancelling to
   * correct something nobody ever booked.
   */
  function absencesFrom(view) {
    const dayByCol = new Map((view?.days || []).map((d) => [d.col, d]));
    const out = [];
    for (const activity of view?.activities || []) {
      if (!activity.absence) continue;
      for (const mark of activity.marks) {
        const written = String(mark.value || '').trim();
        if (!written) continue;
        const day = dayByCol.get(mark.col);
        if (!day?.date) continue;
        out.push({ kind: activity.absence, row: activity.row, date: day.date, written });
      }
    }
    return out;
  }

  /**
   * Which of the activity columns is the location, off the sheet's own heading.
   *
   * Found, like the date axis, rather than configured — for the same reason and
   * with the same failure in mind: a column pinned by letter or by position is
   * wrong the first time somebody inserts one, and wrong *silently*, because the
   * rows still write and every one of them records the wrong place.
   *
   * The heading is what the workbook calls the column, so that is what is read.
   * `-1` means it says nothing recognisable, and the caller falls back to asking
   * the alias register which cell it knows — which is what this module did
   * everywhere before, and still the only answer available on a sheet with no
   * headings at all.
   */
  function locationColumnOf(view) {
    const headings = view?.headings || [];
    for (let i = 0; i < headings.length; i++) {
      if (/\blocations?\b/i.test(headings[i])) return i;
    }
    // "Site" is the other word this project's sheets use for it. Deliberately a
    // short list: a near miss here misfiles every row on the sheet at once.
    for (let i = 0; i < headings.length; i++) {
      if (/\bsite\b/i.test(headings[i])) return i;
    }
    return -1;
  }

  /**
   * A read grid, as rows something else can point at.
   *
   * One row per activity per *week*, because that is the grain the look-ahead is
   * maintained at and the grain a plan is made at. Two rules, both of which hold
   * everywhere else in this module:
   *
   * **The location is read from the column the sheet keeps it in, and kept
   * whether or not it resolves.** `locationColumnOf()` finds that column by its
   * heading; `locate` — the alias register, injected so this stays testable
   * without a network — turns the spelling into an id where it knows it. Nothing
   * is matched on the description: the wording differs on the two sides and is
   * not reliable enough to carry evidence, which is what the alias list is for.
   *
   * The text surviving an unresolved spelling is the part that was missing. The
   * location used to be recorded *only* where the register already knew it, so a
   * column full of "W30" and "Y10" was discarded on every deployment that had not
   * registered them — and with nothing kept there was nothing for anybody to map,
   * which is the one state this module is built to make impossible. An unresolved
   * spelling is exactly like an unmapped colour or an unmatched name: shown, and
   * one click from being answered.
   *
   * **A row with nothing scheduled that week is not a row.** The sheet carries
   * activities for reference with no shift against them, and writing those would
   * make the register mostly noise — and, worse, make every one of them look
   * like scope the first time it *did* get a shift.
   */
  async function rowsFrom(view, {
    snapshotId = null, locate = async () => null, locationColumn = null,
  } = {}) {
    if (!view?.days?.length) return [];

    // Told which column, or read off the sheet's own heading. `null` is "work it
    // out"; `-1` is "there is no heading", which is the register scan below.
    const locCol = Number.isInteger(locationColumn) ? locationColumn : locationColumnOf(view);

    const dayByCol = new Map(view.days.map((d) => [d.col, d]));
    const out = [];
    const ordinals = new Map();

    for (const activity of view.activities) {
      if (activity.heading) continue;
      /* Not work, so not a row. Emitting one would put "PTO" in the register as an
         activity at no location, and `classify()` would then book it as scope
         added the first week it appeared and scope removed the week it did not. */
      if (activity.absence) continue;

      // Group this activity's marks by the week they fall in.
      const weeks = new Map();
      const bucketFor = (date) => {
        const week = mondayOf(date);
        if (!weeks.has(week)) weeks.set(week, { cells: {}, marks: {}, resources: {} });
        return weeks.get(week);
      };
      for (const mark of activity.marks) {
        if (!mark.hex || mark.role === 'ignore') continue;
        const day = dayByCol.get(mark.col);
        if (!day?.date) continue;
        const bucket = bucketFor(day.date);
        bucket.cells[day.date] = mark.meaning || `#${mark.hex}`;
        if (mark.value) bucket.marks[day.date] = mark.value;
      }
      /* The Resource row's own paint, which the workbook sometimes uses for the
         shift instead of the activity line. It fills a day the activity line left
         unpainted and never overrides one — the activity line is what the day *is*.
         And it never says a day was cancelled: red on a Resource row is somebody
         marking the names, not the work, so a cancellation colour there — or a
         colour nobody has named, which might turn out to be one — is left out of
         `cells` entirely, and with it out of `rc_cancelled_days`. */
      for (const mark of activity.resource?.marks || []) {
        if (!mark.hex || mark.role === 'ignore' || !mark.meaning || isCancelMeaning(mark.meaning)) continue;
        const day = dayByCol.get(mark.col);
        if (!day?.date) continue;
        const bucket = bucketFor(day.date);
        if (!(day.date in bucket.cells)) bucket.cells[day.date] = mark.meaning;
      }
      if (!weeks.size) continue;

      /* Who the Resource row names, per day, in the words the workbook used.
         Only into weeks that already have a shift in them: a name typed against a
         day nobody is scheduled on is the same kind of stray as a colour on an
         empty row, and writing it would invent a week of scope. Nothing is
         matched to a person here — that happens against the roster, where an
         unmatched name can be shown to somebody rather than guessed at. */
      for (const mark of activity.resource?.marks || []) {
        if (!mark.value) continue;
        const day = dayByCol.get(mark.col);
        const week = day?.date ? mondayOf(day.date) : null;
        if (!week || !weeks.has(week)) continue;
        weeks.get(week).resources[day.date] = mark.value;
      }

      /* Where the work is, from the column the sheet keeps it in.
         **The text is kept whether or not it resolves.** It used to be recorded
         only when the alias register already knew it, so a location column full of
         "W30" and "Y10" was *discarded* on a deployment that had not registered
         them yet — and with nothing kept there was nothing for anybody to map,
         which is the one state this design is supposed to make impossible. An
         unresolved spelling is exactly like an unmapped colour or an unmatched
         name: shown, and one click from being answered. */
      let locationId = null;
      let rawLocation = null;
      if (locCol >= 0) {
        rawLocation = activity.meta[locCol] || null;
        locationId = rawLocation ? await locate(rawLocation) : null;
      } else {
        // Nobody has said which column it is, so the register decides: the first
        // cell it recognises is the location. Still never the *description* —
        // that is matched on nothing, here or anywhere else in this module.
        for (const value of activity.meta) {
          const hit = await locate(value);
          if (hit) { locationId = hit; rawLocation = value; break; }
        }
      }
      const label = activity.meta.filter(Boolean).join(' · ');

      for (const [week, bucket] of weeks) {
        const groupKey = [week, rawLocation || '', ''].join('|');
        const ordinal = ordinals.get(groupKey) || 0;
        ordinals.set(groupKey, ordinal + 1);
        out.push({
          snapshot_id: snapshotId,
          week_start: week,
          sheet_row: activity.row,
          row_key: rowKey({ weekStart: week, location: rawLocation || '', subsystem: '', ordinal }),
          location_id: locationId,
          raw_location: rawLocation,
          raw_label: label,
          cells: bucket.cells,
          bart_marks: bucket.marks,
          resources: bucket.resources,
        });
      }
    }

    return out;
  }

  /**
   * The codes typed on an activity's day, each with whether it is struck out.
   *
   * "X.WIT" is one EIC and one BART witness, pieces between dots, spacing and
   * case ignored. A piece with a leading tilde — "X.~WIT" — is a resource that
   * was asked for and then cancelled while the activity itself went ahead: the
   * editor writes it, the calendar draws it struck through in red, and
   * `rc_cancelled_support_days` puts it in the cancellation log. Written into the
   * text rather than a column of its own so that it travels wherever the cell
   * already does — undo, copy, the published grid, every stored read.
   */
  function cellTokens(text) {
    const out = [];
    for (const piece of String(text ?? '').split('.')) {
      const t = piece.trim();
      const cancelled = t.startsWith('~');
      const code = (cancelled ? t.slice(1) : t).trim().toUpperCase();
      if (code) out.push({ code, cancelled });
    }
    return out;
  }

  /** "3 X · 1 WIT" — codes counted across days, in the order first met. */
  function countCodes(values, { cancelled = false } = {}) {
    const counts = new Map();
    for (const v of values || []) {
      for (const t of cellTokens(v)) {
        if (t.cancelled !== cancelled) continue;
        counts.set(t.code, (counts.get(t.code) || 0) + 1);
      }
    }
    return counts;
  }

  /**
   * Whether a legend meaning says a day was cancelled — the one rule, the same
   * word `ingest()` looks for in the legend and `rc_cancelled_days` looks for in
   * the stored cells.
   */
  function isCancelMeaning(meaning) {
    return /cancel/i.test(String(meaning || ''));
  }

  /** The Monday of an ISO date's week, in UTC. A calendar date must not shift. */
  function mondayOf(iso) {
    const ms = Date.parse(`${iso}T00:00:00Z`);
    const back = (new Date(ms).getUTCDay() + 6) % 7;
    return new Date(ms - back * 86400000).toISOString().slice(0, 10);
  }

  /* ── The window ────────────────────────────────────────────────────────── */

  /**
   * The weeks a snapshot actually covers, read from the snapshot itself.
   *
   * Deliberately not a constant. The spec calls it a four-week look-ahead and
   * says it is maintained four to six weeks out, so a hard-coded 4 would
   * misclassify the sixth week every time it appeared.
   */
  function windowOf(rows) {
    const weeks = [...new Set(rows.map((r) => r.weekStart))].sort();
    return { weeks, first: weeks[0] || null, last: weeks[weeks.length - 1] || null };
  }

  /* ── Comparing ─────────────────────────────────────────────────────────── */

  /**
   * Classify the difference between two keyed snapshots.
   *
   * `before` and `after` are arrays of `{ rowKey, weekStart, location, subsystem,
   * label, cells, marks }`, where `cells` maps a date to a shift meaning and
   * `marks` holds BART's own resource requests.
   *
   * Returns a list of `{ kind, weekStart, rowKey, before, after }`.
   *
   * **A read that started recording the location is not a read where everything
   * moved.** The row key is built from the week and the location, so the first read
   * after the location began coming off the sheet's own column — rather than only
   * where the alias register already knew the spelling — keys every row
   * differently. Compared naively that is every row removed and every row added:
   * a batch of phantom scope on the one screen somebody reads a year later, booked
   * into the KPIs, over a change that is about the *keying* and not the work. It is
   * the same judgement the window rule makes, and drawn as narrowly as it can be —
   * one side recording no location at all, the other recording one, and not a
   * single key in common. A crew genuinely moving site is still a removal and an
   * addition, which is what `relinkCandidates()` is for.
   */
  function classify(before, after, { cancelledMeaning = 'cancelled' } = {}) {
    const beforeWindow = windowOf(before);
    const afterWindow = windowOf(after);

    if (before.length && after.length) {
      const keys = new Set(after.map((r) => r.rowKey));
      const located = (rows) => rows.filter((r) => String(r.location || '').trim()).length;
      const sided = located(before) === 0 !== (located(after) === 0);
      if (sided && !before.some((r) => keys.has(r.rowKey))) return [];
    }

    // Only weeks present on both sides can be compared at all. Everything else
    // is the window moving, which is recorded and kept out of the KPIs.
    const shared = new Set(beforeWindow.weeks.filter((w) => afterWindow.weeks.includes(w)));

    const events = [];
    const beforeByKey = new Map(before.map((r) => [r.rowKey, r]));
    const afterByKey = new Map(after.map((r) => [r.rowKey, r]));

    /* Weeks entering and leaving the window. Not scope, and named so. */
    for (const week of afterWindow.weeks) {
      if (!beforeWindow.weeks.includes(week)) {
        events.push({ kind: 'window_advanced', weekStart: week, rowKey: null, before: null, after: null });
      }
    }
    for (const week of beforeWindow.weeks) {
      if (!afterWindow.weeks.includes(week)) {
        events.push({ kind: 'window_retired', weekStart: week, rowKey: null, before: null, after: null });
      }
    }

    /* Rows added to, and removed from, a week that was already in view. */
    for (const row of after) {
      if (!shared.has(row.weekStart)) continue;
      if (!beforeByKey.has(row.rowKey)) {
        events.push({ kind: 'scope_added', weekStart: row.weekStart, rowKey: row.rowKey, before: null, after: row });
      }
    }
    for (const row of before) {
      if (!shared.has(row.weekStart)) continue;
      if (!afterByKey.has(row.rowKey)) {
        events.push({ kind: 'scope_removed', weekStart: row.weekStart, rowKey: row.rowKey, before: row, after: null });
      }
    }

    /* Rows present on both sides: what changed inside them. */
    for (const row of after) {
      const prior = beforeByKey.get(row.rowKey);
      if (!prior || !shared.has(row.weekStart)) continue;

      const dates = [...new Set([...Object.keys(prior.cells || {}), ...Object.keys(row.cells || {})])].sort();
      for (const date of dates) {
        const was = (prior.cells || {})[date] || null;
        const now = (row.cells || {})[date] || null;
        if (was === now) continue;

        // A shift turning red is a cancellation, and the colour alone cannot say
        // whose. Whoever reviews it is asked; nothing is assumed.
        const kind = now === cancelledMeaning && was && was !== cancelledMeaning
          ? 'cancellation'
          : 'shift_changed';

        events.push({
          kind,
          weekStart: row.weekStart,
          rowKey: row.rowKey,
          date,
          before: was,
          after: now,
          needsResponsibility: kind === 'cancellation',
        });
      }

      // BART's own resource marks — an EIC added to an otherwise unchanged
      // shift. The shift did not move, and the request still changed, so it is
      // logged rather than folded into the row above.
      const marksBefore = JSON.stringify(prior.marks || {});
      const marksAfter = JSON.stringify(row.marks || {});
      if (marksBefore !== marksAfter) {
        events.push({
          kind: 'resource_changed',
          field: 'marks',
          weekStart: row.weekStart,
          rowKey: row.rowKey,
          before: prior.marks || {},
          after: row.marks || {},
        });
      }

      /* And the Resource row underneath: who is on it.
         The same kind as a mark changing rather than a kind of its own, because
         it is the same fact — the request against this activity moved without the
         shift moving — and a new kind would need the `rc_change_events` check
         constraint widened in every project that already has one. `field` is what
         tells the two apart when somebody reads the row back. */
      const whoBefore = JSON.stringify(prior.resources || {});
      const whoAfter = JSON.stringify(row.resources || {});
      if (whoBefore !== whoAfter) {
        events.push({
          kind: 'resource_changed',
          field: 'resources',
          weekStart: row.weekStart,
          rowKey: row.rowKey,
          before: prior.resources || {},
          after: row.resources || {},
        });
      }
    }

    return events;
  }

  /**
   * Removals and additions in the same week that could be one crew moving site.
   *
   * Only ever a *suggestion*, surfaced for somebody to confirm. Work finishing
   * early at one location and starting at another is not a cancellation, but the
   * only evidence is that the same BART resources appear on both — and the
   * activity text, which cannot be trusted. So the pairing is a human judgement
   * by design, and the system's job is to make it easy rather than to guess.
   */
  function relinkCandidates(events) {
    const removed = events.filter((e) => e.kind === 'scope_removed');
    const added = events.filter((e) => e.kind === 'scope_added');
    const out = [];

    for (const gone of removed) {
      for (const arrived of added) {
        if (gone.weekStart !== arrived.weekStart) continue;
        const a = JSON.stringify(gone.before?.marks || {});
        const b = JSON.stringify(arrived.after?.marks || {});
        if (a !== '{}' && a === b) {
          out.push({ removed: gone, added: arrived, because: 'the same resources were requested' });
        }
      }
    }
    return out;
  }

  /**
   * Which events count toward the change KPIs.
   *
   * The window moving is real and recorded, and it is not a change of scope.
   * Keeping the two apart is what stops the scope-added figure being meaningless
   * within a month.
   */
  const KPI_KINDS = ['scope_added', 'scope_removed', 'cancellation', 'resource_changed', 'shift_changed'];

  function countable(events) {
    return events.filter((e) => KPI_KINDS.includes(e.kind));
  }

  /** A short, plain description of an event, for the change log. */
  /**
   * One line saying what an event was.
   *
   * Reads the *stored* shape: `before` and `after` are jsonb, because the table
   * has no column for a date and a row-level change needs one. `sideOf()` in
   * `ui/rc_lookahead.js` is what writes them, and the two have to agree — a
   * mismatch here shows up as "undefined → undefined" on the one screen somebody
   * reads a year later.
   */
  function describe(event) {
    const day = event.date || event.after?.date || event.before?.date || 'a day';
    switch (event.kind) {
      case 'scope_added': return `Added: ${event.after?.label || event.rowKey}`;
      case 'scope_removed': return `Removed: ${event.before?.label || event.rowKey}`;
      case 'cancellation': return `Cancelled on ${day}: was ${event.before?.value ?? event.before}`;
      case 'shift_changed':
        return `${day}: ${event.before?.value || 'nothing'} → ${event.after?.value || 'nothing'}`;
      case 'resource_changed': {
        /* The *stored* shape decides which of the two this was: `sideOf()` writes
           `{ resources }` for the Resource row and `{ marks }` for a mark on the
           activity line. A row written before Resource rows existed carries only
           the latter, and it still prints the sentence it always did rather than
           "undefined → undefined" on the one screen somebody reads a year later. */
        const who = (side) => {
          const map = side?.resources;
          if (!map || typeof map !== 'object') return null;
          return [...new Set(Object.values(map).flatMap((v) => resourceNames(v)))].join(', ');
        };
        const was = who(event.before);
        const now = who(event.after);
        if (was === null && now === null) return 'BART resource request changed';
        return `Resource: ${was || 'nobody'} → ${now || 'nobody'}`;
      }
      case 'window_advanced': return `Week ${event.weekStart} came into the window`;
      case 'window_retired': return `Week ${event.weekStart} left the window`;
      case 'location_shift': return 'Relinked as one crew moving site';
      default: return event.kind;
    }
  }

  /* ── Suggestions for the timeline ──────────────────────────────────────── */

  /**
   * The look-ahead as bars somebody might want on the plan.
   *
   * One suggestion per **run of painted cells**: consecutive day columns on one
   * activity whose paint counts as work (`role === 'shift'`, the same test that
   * decides whether a row is highlighted at all). Two runs on one row are two
   * suggestions, because a gap in the paint is the workbook saying the work
   * stops there — joining them would put a bar across the days nobody is on it.
   * Adjacent means adjacent *on the sheet*: a weekend the workbook hides is not a
   * gap, because nobody reading the sheet sees one there.
   *
   * Headings, absence rows and rows nobody described are not work and never
   * suggest anything — the same three exclusions the calendar makes.
   *
   * Dates come back as UTC-midnight milliseconds, half-open like a bar on the
   * timeline: `end` is the day *after* the last painted cell, so a single
   * painted day is a one-day bar rather than a zero-width one. A sheet whose
   * axis could not be dated (`datePlease()` refused it) suggests nothing, since
   * a bar at a guessed date is worse than no bar.
   */
  function suggestionsFrom(view) {
    const days = (view?.days || []).filter((d) => d.date);
    if (!days.length || days.length !== (view?.days || []).length) return [];

    const locCol = locationColumnOf(view);
    const titleCol = titleColumnOf(view, locCol);
    const out = [];

    for (const activity of view.activities || []) {
      if (activity.heading || activity.absence || !activity.named) continue;

      const workAt = new Map();
      for (const mark of marksOf(activity)) {
        if (!mark.hex || mark.role !== 'shift') continue;
        if (!workAt.has(mark.col)) workAt.set(mark.col, []);
        workAt.get(mark.col).push(mark);
      }
      if (!workAt.size) continue;

      const namesAt = new Map();
      for (const entry of activity.resource?.names || []) namesAt.set(entry.col, entry.names);

      const meta = activity.meta || [];
      const location = locCol >= 0 ? (meta[locCol] || '') : '';
      const title = (titleCol >= 0 ? meta[titleCol] : '') || longest(meta.filter((_, i) => i !== locCol)) || location;
      const label = meta.filter(Boolean).join(' · ');

      let run = null;
      const close = () => {
        if (!run) return;
        out.push({
          key: suggestionKey(label),
          title,
          location,
          label,
          row: activity.row,
          start: isoMs(run.first),
          end: isoMs(run.last) + 86400000,
          days: run.count,
          meanings: [...run.meanings],
          resources: [...run.resources],
        });
        run = null;
      };

      for (const day of days) {
        const marks = workAt.get(day.col);
        if (!marks) {
          close();
          continue;
        }
        if (!run) run = { first: day.date, last: day.date, count: 0, meanings: new Set(), resources: new Set() };
        run.last = day.date;
        run.count++;
        for (const mark of marks) run.meanings.add(mark.meaning || `#${mark.hex}`);
        for (const name of namesAt.get(day.col) || []) run.resources.add(name);
      }
      close();
    }

    return out;
  }

  /**
   * What the look-ahead has on one day: the sheet read down a single column.
   *
   * The phone's reading of the calendar. A hundred days across by a hundred and
   * forty rows down is the workbook's shape and a laptop's, and on a phone it is a
   * spreadsheet viewed through a letterbox — so the phone asks the question
   * somebody standing on site actually has, "what is on today, and who is on it",
   * and this is the answer. It is the same view every other screen draws: the
   * same `readGrid()` output, the same rule for work (`role === 'shift'` on the
   * activity line or its Resource row, via `marksOf()`), the same three
   * exclusions — headings as titles, rows of names about people, rows nobody
   * described.
   *
   * An activity is on the day when the day carries work paint **or** when its
   * Resource row names somebody on it. The second clause is not a loosening: a
   * name on a day is what makes it that person's plan (`assignmentIndex()`), and
   * an agenda that left out a day the week plan shows as somebody's task would be
   * the two screens disagreeing about the same cell.
   *
   * Each item carries the section heading it sits under, the legend's word for
   * the paint (`meaning`, null when the day is only named), what the activity cell
   * itself says ("X.WIT"), the names, and every other labelled column as a
   * `details` pair — the phone draws those rather than guess which matter. The
   * rows that say who is away come back apart, in `away`, grouped by kind.
   *
   * Null when the day is not on the sheet's dated axis: a sheet whose year could
   * not be resolved has no "Tuesday the 8th" to answer for, and inventing one
   * would be the guess `datePlease()` refused.
   */
  function agendaFor(view, iso) {
    const day = (view?.days || []).find((d) => d.date === iso);
    if (!day) return null;

    const locCol = locationColumnOf(view);
    const titleCol = titleColumnOf(view, locCol);
    const headings = view.headings || [];
    const items = [];
    const awayByKind = new Map();
    let section = '';

    for (const activity of view.activities || []) {
      const meta = activity.meta || [];

      if (activity.absence) {
        const mark = activity.marks.find((m) => m.col === day.col && String(m.value || '').trim());
        if (!mark) continue;
        const held = awayByKind.get(activity.absence) || [];
        for (const name of resourceNames(mark.value)) if (!held.includes(name)) held.push(name);
        awayByKind.set(activity.absence, held);
        continue;
      }

      /* A heading opens a section whatever else it is. One carrying a shift is
         also work — the calendar judges it that way, for the reason `drawn()`
         gives — so it falls through to be read as an activity too. */
      if (activity.heading) section = meta.filter(Boolean)[0] || section;
      if (!activity.named) continue;

      const work = marksOf(activity).filter((m) => m.col === day.col && m.hex && m.role === 'shift');
      // The activity line's own paint first: the Resource row's only fills in.
      const paint = work.find((m) => activity.marks.includes(m)) || work[0] || null;
      const names = (activity.resource?.names || []).find((n) => n.col === day.col)?.names || [];
      if (!paint && !names.length) continue;
      if (activity.heading && !paint) continue;

      const location = locCol >= 0 ? (meta[locCol] || '') : '';
      const title = (titleCol >= 0 ? meta[titleCol] : '')
        || longest(meta.filter((_, i) => i !== locCol)) || location;
      const cell = activity.marks.find((m) => m.col === day.col)?.value || '';

      items.push({
        row: activity.row,
        section: activity.heading ? '' : section,
        title,
        location,
        meaning: paint?.meaning || null,
        hex: paint?.hex || null,
        cancelled: isCancelMeaning(paint?.meaning),
        value: cell,
        names,
        details: meta
          .map((value, i) => ({ heading: String(headings[i] || '').trim(), value, i }))
          .filter((d) => d.value && d.i !== locCol && d.value !== title)
          .map(({ heading, value }) => ({ heading, value })),
      });
    }

    const away = [...awayByKind.entries()].map(([kind, names]) => ({
      kind, label: ABSENCE_LABELS[kind] || kind, names,
    }));
    return { date: iso, weekday: day.weekday, weekend: day.weekend, items, away };
  }

  /**
   * The column that says what the work *is*, off the sheet's own heading.
   * Found like the location column is, and for the same reason; -1 when nothing
   * is labelled, and the caller falls back to the longest description it has.
   *
   * **A description beats an activity, and an identifier is never either.** BART's
   * sheet opens "Activity ID, Description of Work Activity, …", and the first
   * heading with "activit" in it is the ID — so a single pass over one pattern
   * titled every suggestion, and every row on the phone's agenda, with a CDRL
   * number. The fixture the suggestions were tested on had no ID column, which is
   * why it read correctly there and nowhere else.
   */
  function titleColumnOf(view, locCol) {
    const headings = view?.headings || [];
    /* In order of preference, and a heading shaped like an identifier is never
       taken whichever word it carries — "Activity ID", "Task No.", "Scope Ref". */
    const identifier = /\b(id|no|nos|number|ref|code)\b|#/i;
    const wants = [/\bdescr/i, /\b(task|scope)/i, /\bactivit/i];
    for (const re of wants) {
      for (let i = 0; i < headings.length; i++) {
        if (i !== locCol && re.test(headings[i]) && !identifier.test(headings[i])) return i;
      }
    }
    return -1;
  }

  function longest(values) {
    return values.reduce((best, v) => (String(v || '').length > best.length ? String(v) : best), '');
  }

  function isoMs(iso) {
    return Date.parse(`${iso}T00:00:00Z`);
  }

  /**
   * What identifies a suggestion from one read of the sheet to the next.
   *
   * The workbook has no IDs, so this is the activity's own words, folded for case
   * and spacing — the only thing a row carries from one week to the next. It is
   * a weak key and knowingly so, for the reason `rowKey()` is: rewording a row
   * makes it a new suggestion and the old one gone, which is noisy but visible,
   * where matching on anything looser would quietly move somebody's bar onto a
   * different piece of work.
   */
  function suggestionKey(label) {
    return String(label || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** How far apart two runs of one activity may start and still be one run moved. */
  const SAME_RUN_DAYS = 14;

  /**
   * Bring a register of suggestions up to date with a new read of the sheet.
   *
   * `existing` is `{ id → entry }`, `incoming` what `suggestionsFrom()` returned.
   * A run is matched to an entry with the same key — overlapping dates first, then
   * the nearest start within a fortnight — so an entry keeps its id, and therefore
   * its links and its dismissal, while the sheet moves its dates. What cannot be
   * matched is new, and what is left over is one of two very different things:
   *
   * - **It ended before the file's window starts.** The window rolled past it;
   *   nothing was removed. Kept (as `past`) only if a bar is linked to it —
   *   otherwise it is a suggestion for work already over, and a register that
   *   kept every one of them would grow by a sheet's worth every week.
   * - **It is inside the window and the sheet no longer carries it.** Kept and
   *   flagged `missing` when a bar points at it, never removed; an unlinked one
   *   simply goes, because nothing depends on it.
   *
   * Pure, with the id generator and the linked set injected, so the whole thing
   * is tested with no browser. Returns `{ activities, added, moved, unchanged,
   * missing, retired }`, where the lists hold ids and `moved` carries the shift.
   */
  function reconcileSuggestions(existing, incoming, {
    linked = new Set(), makeId = counterId(), windowStart = null,
  } = {}) {
    const before = Object.values(existing || {});
    const byKey = new Map();
    for (const entry of before) {
      if (!byKey.has(entry.key)) byKey.set(entry.key, []);
      byKey.get(entry.key).push(entry);
    }

    const pairs = [];
    incoming.forEach((run, index) => {
      for (const entry of byKey.get(run.key) || []) {
        const overlap = run.start < entry.end && entry.start < run.end;
        const apart = Math.abs(run.start - entry.start) / 86400000;
        if (!overlap && apart > SAME_RUN_DAYS) continue;
        pairs.push({ index, entry, overlap, apart, finish: Math.abs(run.end - entry.end) });
      }
    });
    pairs.sort((a, b) => (b.overlap - a.overlap) || (a.apart - b.apart) || (a.finish - b.finish) || (a.index - b.index));

    const takenRun = new Set();
    const takenEntry = new Set();
    const activities = {};
    const report = { added: [], moved: [], unchanged: [], missing: [], retired: 0 };

    for (const pair of pairs) {
      if (takenRun.has(pair.index) || takenEntry.has(pair.entry.id)) continue;
      takenRun.add(pair.index);
      takenEntry.add(pair.entry.id);
      const run = incoming[pair.index];
      const entry = pair.entry;
      const changed = run.start !== entry.start || run.end !== entry.end;
      activities[entry.id] = {
        ...entry,
        ...run,
        id: entry.id,
        order: pair.index,
        previous: changed ? { start: entry.start, end: entry.end } : null,
        missing: false,
        past: false,
      };
      if (changed) {
        report.moved.push({
          id: entry.id,
          startShift: Math.round((run.start - entry.start) / 86400000),
          finishShift: Math.round((run.end - entry.end) / 86400000),
        });
      } else {
        report.unchanged.push(entry.id);
      }
    }

    incoming.forEach((run, index) => {
      if (takenRun.has(index)) return;
      const id = makeId();
      activities[id] = { ...run, id, order: index, previous: null, missing: false, past: false, dismissed: false };
      report.added.push(id);
    });

    for (const entry of before) {
      if (takenEntry.has(entry.id)) continue;
      if (!linked.has(entry.id)) {
        report.retired++;
        continue;
      }
      const rolledOff = windowStart != null && entry.end <= windowStart;
      activities[entry.id] = { ...entry, previous: null, missing: !rolledOff, past: rolledOff };
      if (!rolledOff) report.missing.push(entry.id);
    }

    return { activities, ...report };
  }

  function counterId() {
    let n = 0;
    return () => `la_${++n}`;
  }

  /* ── The cancellation log ──────────────────────────────────────────────── */

  /**
   * Red days, as cancellation events.
   *
   * `days` is what `rc_cancelled_days` returns: one row per activity, location
   * and day that any read showed as cancelled. Cells side by side on one activity
   * are one event — a cancelled week is one thing that happened, not five — so
   * consecutive days on the same activity and location are joined, and a gap of a
   * single uncancelled day starts a new event. Days before `from` are left out.
   *
   * Returns events oldest first: `{ key, label, location, locationId, start, end,
   * days, firstSeen, lastSeen, reads }`, with `start` and `end` as ISO dates, both
   * inclusive, because that is how a person reads "cancelled 7–11 September".
   */
  /**
   * Whether a stored label is a names row rather than an activity — "Resource",
   * or a row whose columns include it. Readings taken before orphaned names rows
   * were dropped stored some as activities; they are never cancellations.
   */
  function isNamesLabel(label) {
    return String(label || '').split(' · ').some(isResourceLabel);
  }

  function cancellationEvents(days, { from = null } = {}) {
    const groups = new Map();
    for (const d of days || []) {
      const day = String(d.day || '').slice(0, 10);
      if (!day || (from && day < from) || isNamesLabel(d.raw_label)) continue;
      const key = `${suggestionKey(d.raw_label)}|${suggestionKey(d.raw_location)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...d, day });
    }

    const out = [];
    for (const [key, list] of groups) {
      list.sort((a, b) => a.day.localeCompare(b.day));
      let event = null;
      for (const d of list) {
        if (event && isoMs(d.day) - isoMs(event.end) === 86400000) {
          event.end = d.day;
          event.days++;
          event.firstSeen = earlier(event.firstSeen, d.first_seen);
          event.lastSeen = later(event.lastSeen, d.last_seen);
          event.reads = Math.max(event.reads, d.reads || 0);
          event.locationId = event.locationId || d.location_id || null;
          event.marks.push(d.marks || '');
          continue;
        }
        if (event) out.push(event);
        event = {
          key,
          kind: 'activity',
          codes: '',
          label: d.raw_label || '',
          location: d.raw_location || '',
          locationId: d.location_id || null,
          start: d.day,
          end: d.day,
          days: 1,
          firstSeen: d.first_seen || null,
          lastSeen: d.last_seen || null,
          reads: d.reads || 0,
          marks: [d.marks || ''],
        };
      }
      if (event) out.push(event);
    }
    /* What BART had been asked for on those days went with them: "X.WIT" on a
       red day is an EIC and a witness cancelled as well as the work. */
    for (const e of out) e.resources = countCodes(e.marks);
    return out.sort((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label));
  }

  /**
   * BART resources struck out of an activity that still went ahead, as events.
   *
   * `days` is what `rc_cancelled_support_days` returns. Consecutive days on one
   * activity and location that struck out the same codes are one event — the
   * witness taken off Monday to Wednesday is one thing that happened — and a day
   * that struck out something else starts another. Shaped like
   * `cancellationEvents()`, with `kind: 'support'`, `codes` ("WIT", "TCE.WIT")
   * and `resources`, the struck codes counted across the days.
   */
  function supportCancellationEvents(days, { from = null } = {}) {
    const groups = new Map();
    for (const d of days || []) {
      const day = String(d.day || '').slice(0, 10);
      if (!day || (from && day < from) || isNamesLabel(d.raw_label)) continue;
      const codes = [...new Set(cellTokens(d.marks).filter((t) => t.cancelled).map((t) => t.code))].sort().join('.');
      if (!codes) continue;
      const key = `${suggestionKey(d.raw_label)}|${suggestionKey(d.raw_location)}`;
      const group = `${key}|${codes}`;
      if (!groups.has(group)) groups.set(group, { key, codes, list: [] });
      groups.get(group).list.push({ ...d, day });
    }

    const out = [];
    for (const { key, codes, list } of groups.values()) {
      list.sort((a, b) => a.day.localeCompare(b.day));
      let event = null;
      for (const d of list) {
        if (event && isoMs(d.day) - isoMs(event.end) === 86400000) {
          event.end = d.day;
          event.days++;
          event.firstSeen = earlier(event.firstSeen, d.first_seen);
          event.lastSeen = later(event.lastSeen, d.last_seen);
          event.reads = Math.max(event.reads, d.reads || 0);
          event.locationId = event.locationId || d.location_id || null;
          event.marks.push(d.marks || '');
          continue;
        }
        if (event) out.push(event);
        event = {
          key,
          kind: 'support',
          codes,
          label: d.raw_label || '',
          location: d.raw_location || '',
          locationId: d.location_id || null,
          start: d.day,
          end: d.day,
          days: 1,
          firstSeen: d.first_seen || null,
          lastSeen: d.last_seen || null,
          reads: d.reads || 0,
          marks: [d.marks || ''],
        };
      }
      if (event) out.push(event);
    }
    for (const e of out) e.resources = countCodes(e.marks, { cancelled: true });
    return out.sort((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label));
  }

  /**
   * Only the codes BART provides, from a count of codes.
   *
   * The support-code register says who provides each code (`party`). The
   * cancellation log is about what BART was asked for and lost, so a code the
   * register gives to Hitachi — or anybody else — is left out. A code the
   * register has never heard of is kept: dropping it would be guessing who it
   * belongs to.
   */
  function bartCodes(counts, codes) {
    const party = new Map((codes || []).map((c) => [String(c.code).toUpperCase(), String(c.party || 'BART')]));
    const out = new Map();
    for (const [code, n] of counts || new Map()) {
      const who = party.get(code);
      if (who == null || /^bart$/i.test(who)) out.set(code, n);
    }
    return out;
  }

  /** "3 X · 1 WIT" from a count of codes. */
  function describeCodeCounts(counts) {
    return [...(counts || new Map()).entries()].map(([code, n]) => `${n} ${code}`).join(' · ');
  }

  function earlier(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return String(a) < String(b) ? a : b;
  }

  function later(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return String(a) > String(b) ? a : b;
  }

  /**
   * Put each event beside what somebody said about it.
   *
   * A note is kept against the activity and the dates it was made about, not an
   * event id — the event has none, and the sheet keeps moving: a week cancelled on
   * Monday grows to a fortnight by Wednesday, and Monday's reason has to follow
   * it. So a note belongs to the event on the same activity and location whose
   * days it overlaps. Only notes nobody has superseded count; the newest of those
   * is the answer, and every note that touched the event is kept as its history.
   *
   * Returns the events, each with `note` (or null) and `history`.
   */
  function attachCancellationNotes(events, notes) {
    const superseded = new Set((notes || []).map((n) => n.supersedes_id).filter(Boolean));
    const byKey = new Map();
    for (const n of notes || []) {
      const key = `${suggestionKey(n.raw_label)}|${suggestionKey(n.raw_location)}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(n);
    }
    /* A note about struck-out resources ("WIT") belongs to a resource event that
       struck out one of those codes, never to the day's own cancellation, and a
       note about the day never to a resource event — the same activity and the
       same dates can carry both, and they are different judgements. */
    const codesOf = (v) => new Set(String(v || '').split('.').map((c) => c.trim().toUpperCase()).filter(Boolean));
    const sameKind = (n, event) => {
      const mine = codesOf(event.codes);
      const theirs = codesOf(n.codes);
      if (!mine.size || !theirs.size) return !mine.size && !theirs.size;
      return [...theirs].some((c) => mine.has(c));
    };
    return events.map((event) => {
      const touching = (byKey.get(event.key) || [])
        .filter((n) => sameKind(n, event))
        .filter((n) => String(n.start_date) <= event.end && String(n.end_date) >= event.start)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const current = touching.filter((n) => !superseded.has(n.id));
      const note = current[current.length - 1] || null;
      // Taken out of the log by somebody who said it was never a cancellation.
      return { ...event, note, history: touching, dismissed: !!note?.dismissed };
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Progress from the calendar

     The daily huddle records what each person actually did, and the timeline
     has had `actualStart` / `actualEnd` fields nobody filled in. This joins the
     two: an outcome is traced to the look-ahead row it was recorded against, the
     row to the suggestion a bar is linked to, and the bar is offered the first
     and last day anybody worked on it.

     Offered, never written. The same rule as the rest of the register: a read of
     the calendar proposes, and somebody says yes. A bar may stand for several
     activities, and each is read on its own: the start is the first day any of
     them was worked, and a finish is only offered when *every* one has nothing
     left on the look-ahead and its own last word was "completed" — a gap in the
     outcomes is not the end of the work, and one activity finishing is not the
     bar finishing.
     ═══════════════════════════════════════════════════════════════════════ */

  /** Statuses that say somebody worked on the task that day. */
  const WORKED_STATUSES = ['completed', 'partial', 'carried'];

  /**
   * What the outcomes say about each linked bar.
   *
   * `objects` are the plan's objects (only those with `data.laIds` count);
   * `activities` is the register's id → entry map; `actuals` are rows of
   * `rc_actuals_current`; `rows` are the `rc_lookahead_rows` those outcomes (or
   * their plan entries in `plan`) point at. An outcome with a row is matched
   * through the row's label; one without falls back to its task text, which a
   * day read off the sheet carries verbatim. Both go through `suggestionKey()`,
   * so a match is exact or nothing.
   *
   * A bar's linked runs are grouped by that key — several runs of one row are one
   * activity — and each activity is summarised on its own in `activities`:
   * `{ key, title, days, first, last, lastStatus, ahead, recorded, done }`.
   *
   * Returns one proposal per bar with at least one worked day:
   * `{ objectId, first, last, days, people, lastStatus, start, end, byRow,
   *    byTask, activities, holding }` with `start` / `end` as UTC-midnight ms (end
   * half-open, like the bar). `end` is null unless every activity is `done`;
   * `holding` names the ones that are not.
   */
  function outcomeProgress({ objects = [], activities = {}, actuals = [], rows = [], plan = [], todayMs = Date.now() } = {}) {
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const planById = new Map(plan.map((p) => [p.id, p]));

    // Each bar's activities, by key, and the bars each key belongs to.
    const barKeys = new Map(); // bar id → Map(key → { title, ahead })
    const barsByKey = new Map();
    for (const obj of objects) {
      const ids = Array.isArray(obj?.data?.laIds) ? obj.data.laIds : [];
      for (const id of ids) {
        const entry = activities[id];
        if (!entry?.key) continue;
        if (!barKeys.has(obj.id)) barKeys.set(obj.id, new Map());
        const keys = barKeys.get(obj.id);
        const known = keys.get(entry.key) || { title: entry.title || entry.label || '', ahead: false };
        if (!entry.dismissed && Number.isFinite(entry.end) && entry.end > todayMs) known.ahead = true;
        keys.set(entry.key, known);
        if (!barsByKey.has(entry.key)) barsByKey.set(entry.key, new Set());
        barsByKey.get(entry.key).add(obj.id);
      }
    }
    if (!barsByKey.size) return [];

    // What was recorded against each key: the day's word, who, and how it matched.
    const byKey = new Map();
    for (const a of actuals) {
      if (!WORKED_STATUSES.includes(a.status) || !a.work_date) continue;
      const rowId = a.lookahead_row_id || planById.get(a.plan_entry_id)?.lookahead_row_id || null;
      const row = rowId ? rowById.get(rowId) : null;
      const key = suggestionKey(row ? row.raw_label : a.task);
      if (!key || !barsByKey.has(key)) continue;
      if (!byKey.has(key)) byKey.set(key, { dates: new Map(), people: new Set(), byRow: 0, byTask: 0 });
      const acc = byKey.get(key);
      const prev = acc.dates.get(a.work_date);
      // Several people on one day: "completed" from anybody is the day's word.
      if (!prev || a.status === 'completed') acc.dates.set(a.work_date, a.status);
      if (a.person_id) acc.people.add(a.person_id);
      if (row) acc.byRow++;
      else acc.byTask++;
    }

    const out = [];
    for (const obj of objects) {
      const keys = barKeys.get(obj.id);
      if (!keys || ![...keys.keys()].some((k) => byKey.has(k))) continue;
      const people = new Set();
      let byRow = 0;
      let byTask = 0;
      const summary = [];
      for (const [key, { title, ahead }] of keys) {
        const acc = byKey.get(key);
        const dates = acc ? [...acc.dates.keys()].sort() : [];
        const last = dates[dates.length - 1] || null;
        const lastStatus = last ? acc.dates.get(last) : null;
        if (acc) {
          acc.people.forEach((p) => people.add(p));
          byRow += acc.byRow;
          byTask += acc.byTask;
        }
        summary.push({
          key,
          title,
          days: dates.length,
          first: dates[0] || null,
          last,
          lastStatus,
          ahead,
          recorded: dates.length > 0,
          done: !ahead && lastStatus === 'completed',
        });
      }
      const worked = summary.filter((a) => a.recorded);
      const first = worked.map((a) => a.first).sort()[0];
      const last = worked.map((a) => a.last).sort().pop();
      const allDates = new Set();
      for (const a of worked) for (const d of byKey.get(a.key).dates.keys()) allDates.add(d);
      const done = summary.every((a) => a.done);
      out.push({
        objectId: obj.id,
        first,
        last,
        days: allDates.size,
        people: people.size,
        lastStatus: worked.find((a) => a.last === last)?.lastStatus || null,
        start: isoMs(first),
        end: done ? isoMs(last) + 86400000 : null,
        byRow,
        byTask,
        activities: summary,
        holding: summary.filter((a) => !a.done).map((a) => a.title),
      });
    }
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Only my rows

     The look-ahead is a hundred-odd activities for the whole team, and somebody
     on it wants the handful they are on. A names row belongs to the activity
     line above it — that line is the work, and the names row says who lands on
     each day of it — so the activity is what is kept, and it is drawn with its
     names row under it as always. Section headings above a kept activity are
     kept too, for the same reason they are in the editor's search: a row of work
     with no section over it has lost where it sits in the plan.
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The activities (and away rows) whose names name this person, in the days
   * given, with the headings above them.
   *
   * `isMe(written)` answers whether a written name is this person — injected,
   * because the register lives with the calendar. `cols`, when given, limits the
   * question to the columns on screen: being named in a week nobody is looking
   * at does not make a row yours this week. Rows with nothing scheduled are not
   * dropped here: a row that names you is yours whether or not it is painted.
   */
  function rowsNaming(activities, isMe, cols = null) {
    const rows = activities || [];
    const inView = (col) => !cols || cols.has(col);
    const names = (a) => (a.absence
      ? (a.marks || []).filter((m) => m.value && inView(m.col)).flatMap((m) => resourceNames(m.value))
      : (a.resource?.names || []).filter((n) => inView(n.col)).flatMap((n) => n.names));
    const keep = new Array(rows.length).fill(false);
    let sectionHasMine = false;
    let belowIsKeptTitle = false;
    for (let i = rows.length - 1; i >= 0; i--) {
      const a = rows[i];
      if (a.heading && !a.absence) {
        keep[i] = sectionHasMine || belowIsKeptTitle;
        sectionHasMine = false;
        belowIsKeptTitle = keep[i];
        continue;
      }
      keep[i] = names(a).some((n) => isMe(n));
      if (keep[i] && !a.absence) sectionHasMine = true;
      belowIsKeptTitle = false;
    }
    return rows.filter((_, i) => keep[i]);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     One activity, whole

     What somebody sees when they tap a task: every column of the activity's
     line under the sheet's own headings, and every day it has anything on —
     the shift the paint means, whether it was cancelled, what is written in the
     cell, and who the names row puts on it.
     ═══════════════════════════════════════════════════════════════════════ */

  /** The activity's name, found the way a suggestion's title is. */
  function activityTitle(view, activity) {
    const meta = activity?.meta || [];
    const locCol = locationColumnOf(view);
    const titleCol = titleColumnOf(view, locCol);
    return (titleCol >= 0 ? meta[titleCol] : '') || longest(meta.filter((_, i) => i !== locCol)) || meta.find(Boolean) || '';
  }

  /**
   * Every day the activity carries something on, from `fromISO` on (all of them
   * when the axis is undated): `[{ date, col, meaning, hex, shift, cancelled,
   * text, names, mine }]`. `shift` is true when the paint is work; `mine` when
   * `isMe` answers yes for a name on that day.
   */
  function activityDays(view, activity, { fromISO = null, isMe = () => false } = {}) {
    const marks = new Map((activity?.marks || []).map((m) => [m.col, m]));
    const names = new Map((activity?.resource?.names || []).map((n) => [n.col, n.names]));
    const out = [];
    for (const d of view?.days || []) {
      if (fromISO && d.date && d.date < fromISO) continue;
      const mark = marks.get(d.col);
      const who = names.get(d.col) || [];
      const shift = Boolean(mark?.hex && mark.role === 'shift');
      if (!shift && !mark?.value && !who.length && !(mark?.hex && isCancelMeaning(mark.meaning))) continue;
      out.push({
        date: d.date || null,
        col: d.col,
        label: d.date || `${d.month || ''} ${d.day || ''}`.trim(),
        meaning: mark?.meaning || '',
        hex: mark?.hex || null,
        shift,
        cancelled: Boolean(mark?.hex && isCancelMeaning(mark.meaning)),
        text: mark?.value || '',
        names: who,
        mine: who.some((n) => isMe(n)),
      });
    }
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     What changed for me

     Somebody on the team opens the calendar and wants to know one thing before
     anything else: has my week moved since I last looked? This compares two
     readings of the look-ahead — the one they last said "got it" to, and the
     latest — for the days that name them, and says what happened in the words a
     person would use: a day added, a day taken away, a day moved, a day given
     to somebody else, a day cancelled, a shift changed.

     Both sides come from the stored rows (`rc_lookahead_rows`), which are never
     compacted, so an old reading can always be compared. A reading is a complete
     statement of the weeks it covers, so each side is one reading, whole.
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The days a set of stored rows names somebody on, between `from` and `to`
   * (ISO, inclusive): a map of `date|label` → `{ date, label, location, meaning,
   * cancelled }`.
   */
  function myLookaheadDays(rows, isMe, { from = null, to = null } = {}) {
    const out = new Map();
    for (const row of rows || []) {
      for (const [date, text] of Object.entries(row.resources || {})) {
        const day = String(date).slice(0, 10);
        if ((from && day < from) || (to && day > to)) continue;
        if (!resourceNames(text).some((n) => isMe(n))) continue;
        const meaning = row.cells?.[day] || row.cells?.[date] || '';
        out.set(`${day}|${row.raw_label || ''}`, {
          date: day,
          label: row.raw_label || '',
          location: row.raw_location || '',
          meaning,
          cancelled: isCancelMeaning(meaning),
        });
      }
    }
    return out;
  }

  /** How far apart a removed and an added day of one activity may be and still be one day moved. */
  const MOVED_WITHIN_DAYS = 14;

  /**
   * What changed between two readings for the days that name this person:
   * `[{ kind, date, label, location, from?, was?, now?, names? }]`, by date.
   *
   *   added      named on a day they were not before
   *   removed    no longer named on a day they were, and nobody else took it
   *   given      no longer named, and the row names somebody else that day
   *   moved      removed from one day and added to another of the same activity
   *   cancelled  still named, and the day is now painted as a cancellation
   *   reinstated a day that was cancelled is back on
   *   shift      still named, and the day is painted as a different shift
   */
  function changesForMe(beforeRows, afterRows, isMe, { from = null, to = null } = {}) {
    const before = myLookaheadDays(beforeRows, isMe, { from, to });
    const after = myLookaheadDays(afterRows, isMe, { from, to });
    const afterRow = new Map();
    for (const row of afterRows || []) {
      for (const date of new Set([...Object.keys(row.resources || {}), ...Object.keys(row.cells || {})])) {
        afterRow.set(`${String(date).slice(0, 10)}|${row.raw_label || ''}`, row);
      }
    }

    const added = [...after.entries()].filter(([k]) => !before.has(k)).map(([, v]) => v);
    const removed = [...before.entries()].filter(([k]) => !after.has(k)).map(([, v]) => v);
    const out = [];

    /* A day taken off and another of the same activity put on, close together,
       is one day moved — nearest first, each day used once. */
    const usedAdded = new Set();
    const stillRemoved = [];
    for (const r of removed.sort((a, b) => a.date.localeCompare(b.date))) {
      let best = null;
      let bestGap = Infinity;
      added.forEach((a, i) => {
        if (usedAdded.has(i) || a.label !== r.label) return;
        const gap = Math.abs(Date.parse(`${a.date}T00:00:00Z`) - Date.parse(`${r.date}T00:00:00Z`)) / 86400000;
        if (gap <= MOVED_WITHIN_DAYS && gap < bestGap) { best = i; bestGap = gap; }
      });
      if (best == null) { stillRemoved.push(r); continue; }
      usedAdded.add(best);
      const a = added[best];
      out.push({ kind: 'moved', date: a.date, from: r.date, label: a.label, location: a.location, now: a.meaning, was: r.meaning });
    }

    added.forEach((a, i) => {
      if (!usedAdded.has(i)) out.push({ kind: 'added', date: a.date, label: a.label, location: a.location, now: a.meaning });
    });
    for (const r of stillRemoved) {
      const row = afterRow.get(`${r.date}|${r.label}`);
      const names = resourceNames(row?.resources?.[r.date] || '').filter((n) => !isMe(n));
      if (names.length) out.push({ kind: 'given', date: r.date, label: r.label, location: r.location, names });
      else out.push({ kind: 'removed', date: r.date, label: r.label, location: r.location, was: r.meaning });
    }
    for (const [k, now] of after) {
      const was = before.get(k);
      if (!was) continue;
      if (now.cancelled && !was.cancelled) {
        out.push({ kind: 'cancelled', date: now.date, label: now.label, location: now.location, was: was.meaning });
      } else if (was.cancelled && !now.cancelled) {
        out.push({ kind: 'reinstated', date: now.date, label: now.label, location: now.location, now: now.meaning });
      } else if (!now.cancelled && now.meaning !== was.meaning && now.meaning && was.meaning) {
        out.push({ kind: 'shift', date: now.date, label: now.label, location: now.location, was: was.meaning, now: now.meaning });
      }
    }

    return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  }

  Object.defineProperty(__x, "isResourceLabel", { get: () => isResourceLabel, enumerable: true });
  Object.defineProperty(__x, "absenceKind", { get: () => absenceKind, enumerable: true });
  Object.defineProperty(__x, "ABSENCE_KINDS", { get: () => ABSENCE_KINDS, enumerable: true });
  Object.defineProperty(__x, "ABSENCE_LABELS", { get: () => ABSENCE_LABELS, enumerable: true });
  Object.defineProperty(__x, "resourceNames", { get: () => resourceNames, enumerable: true });
  Object.defineProperty(__x, "reassignments", { get: () => reassignments, enumerable: true });
  Object.defineProperty(__x, "marksOf", { get: () => marksOf, enumerable: true });
  Object.defineProperty(__x, "rowKey", { get: () => rowKey, enumerable: true });
  Object.defineProperty(__x, "keyRows", { get: () => keyRows, enumerable: true });
  Object.defineProperty(__x, "readGrid", { get: () => readGrid, enumerable: true });
  Object.defineProperty(__x, "absencesFrom", { get: () => absencesFrom, enumerable: true });
  Object.defineProperty(__x, "locationColumnOf", { get: () => locationColumnOf, enumerable: true });
  Object.defineProperty(__x, "rowsFrom", { get: () => rowsFrom, enumerable: true });
  Object.defineProperty(__x, "cellTokens", { get: () => cellTokens, enumerable: true });
  Object.defineProperty(__x, "countCodes", { get: () => countCodes, enumerable: true });
  Object.defineProperty(__x, "isCancelMeaning", { get: () => isCancelMeaning, enumerable: true });
  Object.defineProperty(__x, "windowOf", { get: () => windowOf, enumerable: true });
  Object.defineProperty(__x, "classify", { get: () => classify, enumerable: true });
  Object.defineProperty(__x, "relinkCandidates", { get: () => relinkCandidates, enumerable: true });
  Object.defineProperty(__x, "KPI_KINDS", { get: () => KPI_KINDS, enumerable: true });
  Object.defineProperty(__x, "countable", { get: () => countable, enumerable: true });
  Object.defineProperty(__x, "describe", { get: () => describe, enumerable: true });
  Object.defineProperty(__x, "suggestionsFrom", { get: () => suggestionsFrom, enumerable: true });
  Object.defineProperty(__x, "agendaFor", { get: () => agendaFor, enumerable: true });
  Object.defineProperty(__x, "suggestionKey", { get: () => suggestionKey, enumerable: true });
  Object.defineProperty(__x, "reconcileSuggestions", { get: () => reconcileSuggestions, enumerable: true });
  Object.defineProperty(__x, "cancellationEvents", { get: () => cancellationEvents, enumerable: true });
  Object.defineProperty(__x, "supportCancellationEvents", { get: () => supportCancellationEvents, enumerable: true });
  Object.defineProperty(__x, "bartCodes", { get: () => bartCodes, enumerable: true });
  Object.defineProperty(__x, "describeCodeCounts", { get: () => describeCodeCounts, enumerable: true });
  Object.defineProperty(__x, "attachCancellationNotes", { get: () => attachCancellationNotes, enumerable: true });
  Object.defineProperty(__x, "WORKED_STATUSES", { get: () => WORKED_STATUSES, enumerable: true });
  Object.defineProperty(__x, "outcomeProgress", { get: () => outcomeProgress, enumerable: true });
  Object.defineProperty(__x, "rowsNaming", { get: () => rowsNaming, enumerable: true });
  Object.defineProperty(__x, "activityTitle", { get: () => activityTitle, enumerable: true });
  Object.defineProperty(__x, "activityDays", { get: () => activityDays, enumerable: true });
  Object.defineProperty(__x, "myLookaheadDays", { get: () => myLookaheadDays, enumerable: true });
  Object.defineProperty(__x, "changesForMe", { get: () => changesForMe, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// io/inflate.js
// ════════════════════════════════════════════════════════════════════════
__mods["io/inflate.js"] = function (__x, __req) {
  /**
   * Minimal DEFLATE decompressor and ZIP reader.
   *
   * Exists so `.xlsx` files can be imported without a dependency: an xlsx is a
   * ZIP of XML parts, and the parts are almost always DEFLATE-compressed. The
   * browser's own DecompressionStream handles this when available (Chrome,
   * Edge, Firefox, Safari 16.4+); the hand-written inflater below is the
   * fallback so the feature works on any engine, offline, from `file://`.
   *
   * Implements RFC 1951 for stored, fixed-Huffman and dynamic-Huffman blocks —
   * which is everything a spreadsheet writer emits.
   *
   * Imports: nothing (leaf).
   */

  /* ── Huffman decoding ──────────────────────────────────────────────────── */

  /** Build a canonical Huffman decode table from a list of code lengths. */
  function buildTree(lengths) {
    const maxBits = Math.max(...lengths, 0);
    const blCount = new Array(maxBits + 1).fill(0);
    for (const len of lengths) if (len) blCount[len]++;

    const nextCode = new Array(maxBits + 1).fill(0);
    let code = 0;
    for (let bits = 1; bits <= maxBits; bits++) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }

    // Map "length:code" to a symbol. A flat object lookup is fast enough here
    // and keeps the implementation short and auditable.
    const table = new Map();
    for (let symbol = 0; symbol < lengths.length; symbol++) {
      const len = lengths[symbol];
      if (!len) continue;
      table.set(len * 65536 + nextCode[len], symbol);
      nextCode[len]++;
    }
    return { table, maxBits };
  }

  class BitReader {
    constructor(bytes) {
      this.bytes = bytes;
      this.pos = 0;
      this.bitBuffer = 0;
      this.bitCount = 0;
    }

    bits(n) {
      while (this.bitCount < n) {
        if (this.pos >= this.bytes.length) throw new Error('Unexpected end of compressed data');
        this.bitBuffer |= this.bytes[this.pos++] << this.bitCount;
        this.bitCount += 8;
      }
      const value = this.bitBuffer & ((1 << n) - 1);
      this.bitBuffer >>>= n;
      this.bitCount -= n;
      return value;
    }

    /** Huffman codes are stored most-significant-bit first. */
    decode(tree) {
      let code = 0;
      for (let len = 1; len <= tree.maxBits; len++) {
        code = (code << 1) | this.bits(1);
        const symbol = tree.table.get(len * 65536 + code);
        if (symbol !== undefined) return symbol;
      }
      throw new Error('Invalid Huffman code');
    }

    alignToByte() {
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
  }

  const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  let fixedLiteral = null;
  let fixedDistance = null;

  function fixedTrees() {
    if (!fixedLiteral) {
      const lengths = new Array(288);
      for (let i = 0; i < 144; i++) lengths[i] = 8;
      for (let i = 144; i < 256; i++) lengths[i] = 9;
      for (let i = 256; i < 280; i++) lengths[i] = 7;
      for (let i = 280; i < 288; i++) lengths[i] = 8;
      fixedLiteral = buildTree(lengths);
      fixedDistance = buildTree(new Array(30).fill(5));
    }
    return [fixedLiteral, fixedDistance];
  }

  /**
   * Inflate a raw DEFLATE stream (no zlib header).
   * @param {Uint8Array} data
   * @returns {Uint8Array}
   */
  function inflateRaw(data) {
    const reader = new BitReader(data);
    const out = [];
    let output = new Uint8Array(Math.max(1024, data.length * 4));
    let length = 0;

    const push = (byte) => {
      if (length >= output.length) {
        const bigger = new Uint8Array(output.length * 2);
        bigger.set(output);
        output = bigger;
      }
      output[length++] = byte;
    };

    let final = false;
    while (!final) {
      final = reader.bits(1) === 1;
      const type = reader.bits(2);

      if (type === 0) {
        reader.alignToByte();
        const len = data[reader.pos] | (data[reader.pos + 1] << 8);
        reader.pos += 4; // skip LEN and NLEN
        for (let i = 0; i < len; i++) push(data[reader.pos++]);
        continue;
      }

      let literalTree;
      let distanceTree;

      if (type === 1) {
        [literalTree, distanceTree] = fixedTrees();
      } else if (type === 2) {
        const hlit = reader.bits(5) + 257;
        const hdist = reader.bits(5) + 1;
        const hclen = reader.bits(4) + 4;

        const codeLengths = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) codeLengths[CODE_LENGTH_ORDER[i]] = reader.bits(3);
        const codeTree = buildTree(codeLengths);

        const lengths = [];
        while (lengths.length < hlit + hdist) {
          const symbol = reader.decode(codeTree);
          if (symbol < 16) {
            lengths.push(symbol);
          } else if (symbol === 16) {
            const previous = lengths[lengths.length - 1];
            const repeat = reader.bits(2) + 3;
            for (let i = 0; i < repeat; i++) lengths.push(previous);
          } else if (symbol === 17) {
            const repeat = reader.bits(3) + 3;
            for (let i = 0; i < repeat; i++) lengths.push(0);
          } else {
            const repeat = reader.bits(7) + 11;
            for (let i = 0; i < repeat; i++) lengths.push(0);
          }
        }

        literalTree = buildTree(lengths.slice(0, hlit));
        distanceTree = buildTree(lengths.slice(hlit));
      } else {
        throw new Error('Invalid DEFLATE block type');
      }

      for (;;) {
        const symbol = reader.decode(literalTree);
        if (symbol === 256) break;
        if (symbol < 256) {
          push(symbol);
          continue;
        }
        const lengthIndex = symbol - 257;
        const copyLength = LENGTH_BASE[lengthIndex] + reader.bits(LENGTH_EXTRA[lengthIndex]);
        const distSymbol = reader.decode(distanceTree);
        const distance = DIST_BASE[distSymbol] + reader.bits(DIST_EXTRA[distSymbol]);
        const from = length - distance;
        if (from < 0) throw new Error('Invalid back-reference in compressed data');
        for (let i = 0; i < copyLength; i++) push(output[from + i]);
      }
    }

    return output.subarray(0, length);
  }

  /**
   * Decompress using the platform where it exists, falling back to the
   * implementation above. Always returns a promise for one call shape.
   */
  async function inflate(data) {
    if (typeof DecompressionStream === 'function') {
      try {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const buffer = await new Response(stream).arrayBuffer();
        return new Uint8Array(buffer);
      } catch {
        /* fall through to the JavaScript inflater */
      }
    }
    return inflateRaw(data);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ZIP reading
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Read a ZIP archive from an ArrayBuffer.
   * Returns a Map of path → Uint8Array. Only the stored (0) and deflate (8)
   * methods are supported, which covers every spreadsheet writer in practice.
   */
  async function readZip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);

    // Locate the End Of Central Directory record by scanning backwards.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66_000; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Not a valid ZIP archive (no end-of-directory record).');

    const entryCount = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);

    const files = new Map();
    const decoder = new TextDecoder('utf-8');

    for (let i = 0; i < entryCount; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;

      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

      // Re-read the local header: its extra field length can differ.
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const raw = bytes.subarray(dataStart, dataStart + compressedSize);

      if (!name.endsWith('/')) {
        if (method === 0) files.set(name, raw);
        else if (method === 8) files.set(name, await inflate(raw));
        // Any other method (bzip2, LZMA) is left out rather than corrupting data.
      }

      offset += 46 + nameLength + extraLength + commentLength;
    }

    return files;
  }

  /** Decode a ZIP entry as UTF-8 text. */
  function zipText(files, path) {
    const entry = files.get(path);
    return entry ? new TextDecoder('utf-8').decode(entry) : null;
  }

  Object.defineProperty(__x, "inflateRaw", { get: () => inflateRaw, enumerable: true });
  Object.defineProperty(__x, "inflate", { get: () => inflate, enumerable: true });
  Object.defineProperty(__x, "readZip", { get: () => readZip, enumerable: true });
  Object.defineProperty(__x, "zipText", { get: () => zipText, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// io/lookahead.js
// ════════════════════════════════════════════════════════════════════════
__mods["io/lookahead.js"] = function (__x, __req) {
  /**
   * Reading the four-week look-ahead.
   *
   * The look-ahead is an Excel workbook the deputy edits in place, and it encodes
   * shift access in **cell fill colour** against a fixed legend. So this is not
   * an importer in the usual sense: the values matter far less than the colours,
   * and almost everything that can go wrong is invisible in a spreadsheet you
   * open by hand.
   *
   * Four rules, each of which exists because of a specific way it breaks:
   *
   * **One sheet, chosen by name.** The workbook is large and the four-week grid
   * is one tab among several. `readXlsx()` in `io/importers.js` takes whichever
   * sheet is first, which would silently read a cover page. A missing sheet is an
   * error here, never a fall back to sheet one.
   *
   * **Visible rows and columns only.** Rows are hidden by hand and by autofilter,
   * both as `hidden="1"`. A hidden *column* matters more than a hidden row: with
   * one column per day, dropping one removes a day from the week and nothing
   * about the result looks wrong.
   *
   * **The real row number travels with the row.** Blank and absent rows mean the
   * nth row in the file is not row n, so an array index is not an identity. Row
   * identity is what change classification rests on.
   *
   * **A colour that is not in the legend is never guessed.** It goes to an
   * unknown bucket for somebody to map. The legend is stable in practice, and
   * relying on that would still be wrong, because the failure is silent and lands
   * in evidence.
   *
   * Imports: inflate, dates (leaves).
   */

  const { inflateRaw } = __req("io/inflate.js");

  /* ══════════════════════════════════════════════════════════════════════════
     ZIP
     ═══════════════════════════════════════════════════════════════════════ */

  /** Read the container into `name -> Uint8Array`, via the central directory. */
  function readZip(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('That file is not a .xlsx (no ZIP directory found).');

    const count = view.getUint16(eocd + 10, true);
    let at = view.getUint32(eocd + 16, true);

    const out = new Map();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(at, true) !== 0x02014b50) break;
      const method = view.getUint16(at + 10, true);
      const compressed = view.getUint32(at + 20, true);
      const nameLen = view.getUint16(at + 28, true);
      const extraLen = view.getUint16(at + 30, true);
      const commentLen = view.getUint16(at + 32, true);
      const localAt = view.getUint32(at + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));

      // The local header repeats the name and carries its own extra field, whose
      // length routinely differs from the one in the directory.
      const localNameLen = view.getUint16(localAt + 26, true);
      const localExtraLen = view.getUint16(localAt + 28, true);
      const start = localAt + 30 + localNameLen + localExtraLen;
      const raw = bytes.subarray(start, start + compressed);
      out.set(name, method === 0 ? raw : inflateRaw(raw));

      at += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  function partText(files, name) {
    const part = files.get(name);
    return part ? new TextDecoder().decode(part) : '';
  }

  function decodeXml(s) {
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
      .replace(/&amp;/g, '&');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Colour
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The legacy 56-entry palette an `indexed="n"` fill refers to.
   *
   * Excel still writes these for anything inherited from an older workbook, so a
   * parser that only understands `rgb=` sees nothing at all on exactly those
   * cells — and a blank cell reads as "no shift booked", which is a different
   * fact entirely.
   */
  const INDEXED = [
    '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
    '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
    '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
    '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
    '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
    '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
    '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
    '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
  ];

  /** `theme="n"` indexes the scheme with the dark/light pairs swapped. */
  const THEME_ORDER = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

  function readTheme(xml) {
    const scheme = /<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(xml)?.[1] || '';
    const colors = {};
    for (const m of scheme.matchAll(/<a:(\w+)>([\s\S]*?)<\/a:\1>/g)) {
      const [, key, body] = m;
      const srgb = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(body)?.[1];
      const sys = /<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(body)?.[1];
      if (srgb || sys) colors[key] = (srgb || sys).toUpperCase();
    }
    return THEME_ORDER.map((key) => colors[key] || null);
  }

  /**
   * Apply an OOXML tint, in HLS as the specification requires.
   *
   * Doing it in RGB gives a near miss, and a near miss against a legend keyed on
   * exact colours is a lookup that fails. Accent 1 at -0.25 has to come out
   * #2F5597 — what Excel calls "Blue, Accent 1, Darker 25%".
   */
  function applyTint(hex, tint) {
    if (!tint) return hex;
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let lum = (max + min) / 2;
    let hue = 0;
    let sat = 0;
    if (max !== min) {
      const d = max - min;
      sat = lum > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) hue = ((b - r) / d + 2) / 6;
      else hue = ((r - g) / d + 4) / 6;
    }

    lum = tint < 0 ? lum * (1 + tint) : lum * (1 - tint) + tint;
    lum = Math.min(1, Math.max(0, lum));

    const toRgb = (p, q, t) => {
      let u = t;
      if (u < 0) u += 1;
      if (u > 1) u -= 1;
      if (u < 1 / 6) return p + (q - p) * 6 * u;
      if (u < 1 / 2) return q;
      if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
      return p;
    };

    let out;
    if (sat === 0) out = [lum, lum, lum];
    else {
      const q = lum < 0.5 ? lum * (1 + sat) : lum + sat - lum * sat;
      const p = 2 * lum - q;
      out = [toRgb(p, q, hue + 1 / 3), toRgb(p, q, hue), toRgb(p, q, hue - 1 / 3)];
    }
    return out.map((v) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase()).join('');
  }

  /**
   * `styleIndex -> { hex, source }` for every cell format in the workbook.
   *
   * The chain is `cellXfs[s].fillId -> fills[id].patternFill.fgColor`, and the
   * colour at the end arrives in one of three notations. Resolving all three to
   * one hex is what lets the legend be keyed on the colour rather than on how it
   * happened to be written.
   */
  function readFills(stylesXml, theme) {
    const fillsBlock = /<fills[^>]*>([\s\S]*?)<\/fills>/.exec(stylesXml)?.[1] || '';
    const fills = (fillsBlock.match(/<fill>[\s\S]*?<\/fill>/g) || []).map((fill) => {
      const pattern = /patternType="(\w+)"/.exec(fill)?.[1] || 'none';
      if (pattern === 'none') return { hex: null, source: 'none' };

      const fg = /<fgColor([^>]*)\/>/.exec(fill)?.[1] || '';
      const tint = parseFloat(/tint="(-?[\d.]+)"/.exec(fg)?.[1] || '0') || 0;

      const rgb = /rgb="([0-9A-Fa-f]{6,8})"/.exec(fg)?.[1];
      if (rgb) {
        const base = (rgb.length === 8 ? rgb.slice(2) : rgb).toUpperCase();
        return { hex: applyTint(base, tint), source: 'rgb' };
      }

      const themed = /theme="(\d+)"/.exec(fg)?.[1];
      if (themed != null) {
        const base = theme[parseInt(themed, 10)] || null;
        return { hex: base ? applyTint(base, tint) : null, source: `theme:${themed}` };
      }

      const indexed = /indexed="(\d+)"/.exec(fg)?.[1];
      if (indexed != null) {
        const base = INDEXED[parseInt(indexed, 10)] || null;
        return { hex: base ? applyTint(base, tint) : null, source: `indexed:${indexed}` };
      }

      return { hex: null, source: 'unresolved' };
    });

    /* White is not a highlight.
       An explicit white fill and no fill at all are the same thing to anybody
       looking at the sheet — a highlight nobody can see is not one — and Excel
       writes white fills into all sorts of default styling. Reading them as
       colours put hundreds of cells into the unmapped bucket and asked somebody
       to explain the absence of a highlight. */
    const plain = fills.map((f) => (f.hex === 'FFFFFF' ? { hex: null, source: 'none' } : f));

    const xfsBlock = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] || '';
    const xfs = xfsBlock.match(/<xf[\s\S]*?(?:\/>|<\/xf>)/g) || [];
    return xfs.map((xf) => {
      const fillId = parseInt(/fillId="(\d+)"/.exec(xf)?.[1] ?? '0', 10);
      return plain[fillId] || { hex: null, source: 'none' };
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The sheet
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Rows and cells, matched as either a self-closing tag or an open/close pair.
   *
   * The obvious `/<row[\s\S]*?(?:\/>|<\/row>)/` is wrong here, and wrong in a way
   * that only shows up on a sheet like this one. A cell carrying a fill but no
   * value is written `<c r="D2" s="1"/>`, and a lazy match stops at that first
   * `/>` — truncating the row and dropping every cell after it. A workbook full
   * of *values* never hits it, because those cells close with `</c>`. A workbook
   * full of *colours* hits it on nearly every row.
   */
  const ROW_RE = /<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g;
  const CELL_RE = /<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g;

  /** 'A' -> 1, 'AA' -> 27. One-based, matching how a spreadsheet talks. */
  function colNumber(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }


  /** Every sheet in the workbook, with its hidden state and its part path. */
  function readSheets(files) {
    const workbook = partText(files, 'xl/workbook.xml');
    const rels = partText(files, 'xl/_rels/workbook.xml.rels');
    const sheets = [];

    for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const attrs = m[1];
      const rid = /r:id="([^"]+)"/.exec(attrs)?.[1] || '';
      let zipPath = '';
      if (rid) {
        const rel = new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels);
        if (rel) {
          const target = rel[1].replace(/^\/?xl\//, '').replace(/^\//, '');
          if (files.has(`xl/${target}`)) zipPath = `xl/${target}`;
        }
      }
      sheets.push({
        name: decodeXml(/name="([^"]*)"/.exec(attrs)?.[1] || ''),
        state: /state="(\w+)"/.exec(attrs)?.[1] || 'visible',
        zipPath,
      });
    }
    return sheets;
  }

  /**
   * Parse one named sheet into a grid of visible cells.
   *
   * Returns `{ sheet, rows, hiddenRows, hiddenColumns, merges, conditional }`.
   * Each row is `{ row, cells: [{ col, ref, value, hex, source }] }` where `row`
   * is the **spreadsheet** row number.
   */
  function parseSheet(buffer, sheetName) {
    const files = readZip(buffer);
    const sheets = readSheets(files);

    const chosen = sheets.find((s) => s.name === sheetName);
    if (!chosen) {
      // Never fall back to the first sheet. Reading a cover page and reporting a
      // week of no work would be worse than reporting nothing at all.
      throw new Error(
        `The workbook has no sheet called "${sheetName}". It has: ${sheets.map((s) => s.name).join(', ')}.`
      );
    }
    if (!chosen.zipPath) throw new Error(`"${sheetName}" has no readable worksheet part.`);
    if (chosen.state !== 'visible') {
      // A hidden sheet under the configured name almost always means the name is
      // stale and the live grid has moved to another tab.
      throw new Error(`"${sheetName}" is hidden in the workbook — check which tab the look-ahead is on now.`);
    }

    const sharedStrings = [];
    for (const si of partText(files, 'xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g) || []) {
      const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
      sharedStrings.push(parts.map((p) => decodeXml(p.replace(/<[^>]+>/g, ''))).join(''));
    }

    const theme = readTheme(partText(files, 'xl/theme/theme1.xml'));
    const styleFills = readFills(partText(files, 'xl/styles.xml'), theme);
    const xml = new TextDecoder().decode(files.get(chosen.zipPath));

    /* Hidden columns. One column per day, so a hidden one silently removes a day
       from the week — and unlike a missing row, nothing about the result looks
       wrong. */
    const hiddenColumns = new Set();
    const colsBlock = /<cols[^>]*>([\s\S]*?)<\/cols>/.exec(xml)?.[1] || '';
    for (const m of colsBlock.matchAll(/<col\b([^>]*)\/?>/g)) {
      if (!/hidden="1"/.test(m[1])) continue;
      const min = parseInt(/min="(\d+)"/.exec(m[1])?.[1] ?? '0', 10);
      const max = parseInt(/max="(\d+)"/.exec(m[1])?.[1] ?? '0', 10);
      for (let c = min; c <= max; c++) hiddenColumns.add(c);
    }

    const merges = [];
    const mergeBlock = /<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/.exec(xml)?.[1] || '';
    for (const m of mergeBlock.matchAll(/<mergeCell[^>]*ref="([^"]+)"/g)) merges.push(m[1]);

    /* Conditional formatting is reported, not evaluated. A colour that comes
       from a rule is not in the cell's style at all, so if the grid is painted
       that way this parser would see an empty sheet — and saying so is the only
       honest thing to do about it. */
    const conditional = [];
    for (const m of xml.matchAll(/<conditionalFormatting[^>]*sqref="([^"]+)"/g)) conditional.push(m[1]);

    const rows = [];
    let hiddenRows = 0;

    for (const rowXml of xml.match(ROW_RE) || []) {
      const head = /<row\b([^>]*)>/.exec(rowXml)?.[1] || rowXml;
      if (/hidden="1"/.test(head)) {
        hiddenRows++;
        continue;
      }
      const rowNumber = parseInt(/\br="(\d+)"/.exec(head)?.[1] ?? '0', 10);

      const cells = [];
      /* Text from *hidden* columns is kept for one narrow purpose and no other:
         the legend key is written in a hidden column beside a row of coloured
         swatches, so dropping it the way every other hidden cell is dropped
         would throw away the one thing that says what the colours mean. It never
         becomes a cell of the grid — only this label. */
      let label = '';

      for (const cellXml of rowXml.match(CELL_RE) || []) {
        const ref = /\br="([A-Z]+)(\d+)"/.exec(cellXml);
        if (!ref) continue;
        const col = colNumber(ref[1]);

        const type = /\bt="([^"]+)"/.exec(cellXml)?.[1];
        let value = '';
        if (type === 'inlineStr') {
          value = (cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
            .map((p) => decodeXml(p.replace(/<[^>]+>/g, ''))).join('');
        } else {
          const raw = /<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1];
          if (raw != null) value = type === 's' ? (sharedStrings[parseInt(raw, 10)] ?? '') : decodeXml(raw);
        }

        if (hiddenColumns.has(col)) {
          if (!label && String(value).trim()) label = String(value).trim();
          continue;
        }

        const styleIndex = parseInt(/\bs="(\d+)"/.exec(cellXml)?.[1] ?? '-1', 10);
        const fill = styleIndex >= 0 ? styleFills[styleIndex] : null;

        cells.push({
          col,
          ref: `${ref[1]}${ref[2]}`,
          value,
          hex: fill?.hex || null,
          source: fill?.source || 'none',
        });
      }

      // A row with no visible cells at all is not a row of the grid.
      if (cells.length) rows.push({ row: rowNumber, cells, label });
    }

    return {
      sheet: chosen.name,
      sheets: sheets.map((s) => ({ name: s.name, state: s.state })),
      rows,
      hiddenRows,
      hiddenColumns: [...hiddenColumns],
      merges,
      conditional,
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The legend
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The legend the workbook writes down about itself.
   *
   * BART's look-ahead carries its own key: a short block of rows near the bottom
   * where the whole row is painted one colour and a label beside it reads
   * "Highlight in Orange for Swing Shift". That is the authors' own statement of
   * what the colours mean, so reading it is not guessing — it is the one place
   * in this pipeline where a meaning can be taken from the file rather than
   * typed by somebody.
   *
   * It stays deliberately strict. A row qualifies only when every visible cell
   * on it carries the *same* fill and none of them holds a value: a swatch, in
   * other words, and not a row of work that happens to be highlighted. Anything
   * that does not match that shape is simply not returned, and the colours it
   * used go on to the `unknown` bucket to be mapped by hand — which is the same
   * answer this module gives everywhere else it cannot be certain.
   */
  function readLegend(grid) {
    const out = [];
    const seen = new Set();

    for (const row of grid.rows || []) {
      const cells = row.cells || [];
      if (cells.length < 2) continue;
      if (cells.some((c) => String(c.value ?? '').trim())) continue;
      if (cells.some((c) => !c.hex)) continue;
      if (new Set(cells.map((c) => c.hex)).size !== 1) continue;

      const label = String(row.label || '').trim();
      if (!label) continue;

      // "Highlight in Orange for Swing Shift" → "Swing Shift". The colour word
      // in the sentence is thrown away on purpose: the swatch is the colour, and
      // where the two disagree the swatch is the one that was painted.
      const phrased = /^\s*highlight\s+in\s+\S+\s+for\s+(.+?)\s*$/i.exec(label);
      const meaning = (phrased ? phrased[1] : label).trim();
      if (!meaning) continue;

      const argb = cells[0].hex;
      if (seen.has(argb)) continue;
      seen.add(argb);
      out.push({ argb, meaning, row: row.row });
    }

    return out;
  }

  /**
   * Turn a parsed grid into shifts, against the legend.
   *
   * `legend` is `[{ argb, meaning }]`. A colour that is not in it is collected in
   * `unknown` rather than defaulted to anything — the legend is stable in
   * practice and relying on that would still be wrong, because one stray shade
   * from Excel's recent-colours picker would misclassify a shift with nothing on
   * screen to show it happened, and the result lands in evidence.
   */
  /**
   * Whether a cell's fill is dark enough that text on it has to go white.
   *
   * Perceived lightness, not average: the eye weighs green far more than blue,
   * and an average makes BART's mid-blue shifts read as light when the label on
   * them is invisible.
   *
   * Here rather than in the renderer because *two* things draw these cells — the
   * grid on screen and the PDF export — and the moment they answer this
   * differently the printed calendar has white text on a pale cell somewhere,
   * which nobody notices until it is in front of a client.
   */
  function isDark(hex) {
    const n = parseInt(String(hex).slice(-6), 16);
    if (Number.isNaN(n)) return false;
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
  }

  /**
   * One entry per colour: the one in force.
   *
   * `rc_legend` is *versioned* — `unique (valid_from, argb)` — so a colour that
   * has been re-mapped has a row per date, and only the newest of them is what it
   * means now. Choosing that has to happen here rather than being left to how the
   * caller sorted its array, and it did not: this was
   *
   *     new Map(legend.map((l) => [l.argb, …]))
   *
   * which silently took whichever row came *last*. `listLegend()` hands them over
   * newest first — its own comment says "a caller taking the first entry for a
   * colour gets the one in force" — so last meant **oldest**, and every correction
   * anybody ever made was discarded in favour of the first thing that colour was
   * ever called.
   *
   * The symptom was the worst kind: pressing "Just shading" on the grey a workbook
   * shades its layout with inserted a row saying `ignore`, the lookup kept reading
   * the older `shift` row, and all those rows stayed on the calendar. And because
   * the older row carries a meaning the colour was no longer *unmapped*, so the
   * button that would have fixed it disappeared. Pressing it again only added
   * another row it would also ignore.
   *
   * A missing `valid_from` sorts oldest, so the shorter `{ argb, meaning, role }`
   * shape the ingest path passes still resolves. A future-dated row wins on the
   * calendar the moment it exists, which is consistent with the legend being
   * re-applied at paint time rather than frozen into a snapshot.
   */
  function inForce(legend) {
    const best = new Map();
    for (const entry of legend || []) {
      const key = String(entry.argb).toUpperCase();
      const held = best.get(key);
      if (held && String(held.valid_from || '') >= String(entry.valid_from || '')) continue;
      best.set(key, {
        valid_from: entry.valid_from || '',
        meaning: entry.meaning,
        role: entry.role || 'shift',
      });
    }
    return best;
  }

  function applyLegend(grid, legend) {
    const byColour = inForce(legend);
    const unknown = new Map();

    const rows = grid.rows.map((row) => ({
      row: row.row,
      label: row.label || '',
      cells: row.cells.map((cell) => {
        if (!cell.hex) return { ...cell, meaning: null, role: null };
        const entry = byColour.get(cell.hex);
        const meaning = entry?.meaning || null;
        if (!meaning) {
          const seen = unknown.get(cell.hex) || { hex: cell.hex, count: 0, samples: [] };
          seen.count++;
          if (seen.samples.length < 4) seen.samples.push(cell.ref);
          unknown.set(cell.hex, seen);
        }
        // An unmapped colour is left as a shift on purpose: it may well be one,
        // and treating the unexplained as ignorable would hide the rows that
        // most need somebody to look at them.
        return { ...cell, meaning, role: entry?.role || 'shift' };
      }),
    }));

    return { ...grid, rows, unknown: [...unknown.values()].sort((a, b) => b.count - a.count) };
  }

  /**
   * A legend under which only colours categorised as **Work** count.
   *
   * `applyLegend()` treats a colour it has never heard of as a shift, and for the
   * calendar that is right: an unexplained colour might be work, and hiding it
   * would bury the rows that most need looking at. Putting bars on a plan is a
   * different act — a suggestion is a proposal to commit dates, and a proposal
   * from a colour nobody has categorised is a guess. So every fill on the grid
   * that `legend` does not mention is added here as `ignore`, and what reaches
   * `role === 'shift'` is exactly what somebody categorised as Work. A Section
   * band (`divider`) and Shading (`ignore`) are not work either way.
   */
  function workOnlyLegend(grid, legend) {
    const known = inForce(legend);
    const out = [...(legend || [])];
    const added = new Set();
    for (const row of grid?.rows || []) {
      for (const cell of row.cells || []) {
        if (!cell.hex) continue;
        const hex = String(cell.hex).toUpperCase();
        if (known.has(hex) || added.has(hex)) continue;
        added.add(hex);
        out.push({ argb: hex, meaning: '', role: 'ignore' });
      }
    }
    return out;
  }

  /**
   * The legend a workbook carries with it, for where there is no calendar legend.
   *
   * The workbook's own key ("Highlight in Orange for Swing Shift") names the
   * colours it uses for work, so those start as Work; `choices` — what somebody
   * categorised on this plan, `hex → 'shift' | 'ignore'` — overrides it and adds
   * the colours the key never mentioned.
   */
  function fileLegend(grid, choices = {}) {
    const out = readLegend(grid).map((k) => {
      const hex = String(k.argb).toUpperCase();
      return { argb: hex, meaning: k.meaning, role: choices[hex] || 'shift' };
    });
    for (const [hex, role] of Object.entries(choices || {})) {
      if (!out.some((e) => e.argb === hex)) out.push({ argb: hex, meaning: '', role });
    }
    return out;
  }

  Object.defineProperty(__x, "readZip", { get: () => readZip, enumerable: true });
  Object.defineProperty(__x, "readTheme", { get: () => readTheme, enumerable: true });
  Object.defineProperty(__x, "applyTint", { get: () => applyTint, enumerable: true });
  Object.defineProperty(__x, "readFills", { get: () => readFills, enumerable: true });
  Object.defineProperty(__x, "colNumber", { get: () => colNumber, enumerable: true });
  Object.defineProperty(__x, "readSheets", { get: () => readSheets, enumerable: true });
  Object.defineProperty(__x, "parseSheet", { get: () => parseSheet, enumerable: true });
  Object.defineProperty(__x, "readLegend", { get: () => readLegend, enumerable: true });
  Object.defineProperty(__x, "isDark", { get: () => isDark, enumerable: true });
  Object.defineProperty(__x, "inForce", { get: () => inForce, enumerable: true });
  Object.defineProperty(__x, "applyLegend", { get: () => applyLegend, enumerable: true });
  Object.defineProperty(__x, "workOnlyLegend", { get: () => workOnlyLegend, enumerable: true });
  Object.defineProperty(__x, "fileLegend", { get: () => fileLegend, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/rc_util.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/rc_util.js"] = function (__x, __req) {
  /**
   * Small shared helpers for the resource calendar's tabs.
   *
   * These live in a leaf of their own rather than in `ui/rc.js` because `rc.js`
   * imports the tabs and the tabs need the helpers — putting them together would
   * be a cycle, and the build rejects those outright rather than letting one
   * quietly half-initialise.
   *
   * Imports: util, events, dates, components.
   */

  const { el } = __req("core/util.js");
  const { emit, EV } = __req("core/events.js");
  const { toISO, todayMs, fmtDate, addDays, MS_DAY } = __req("core/dates.js");
  const { resourceNames, readGrid, locationColumnOf, absencesFrom, ABSENCE_LABELS, ABSENCE_KINDS, cellTokens, cancellationEvents, supportCancellationEvents, attachCancellationNotes, bartCodes } = __req("core/lookahead.js");



  const { applyLegend } = __req("io/lookahead.js");
  const rc = __req("core/rc.js");
  const { openModal } = __req("ui/components.js");

  /**
   * A modal whose confirm button does something that can fail.
   *
   * `openModal` closes on click unless the handler returns false, which is right
   * for a menu and wrong for a form that writes to a database over a network.
   * Here the dialog stays open, the button says what is happening, and a refusal
   * is shown in place rather than as a toast over a form that has already gone —
   * every write in this module can be refused by a policy, so that case is the
   * normal one rather than the exception.
   */
  function formModal({ title, body, confirmLabel = 'Save', onConfirm }) {
    const error = el('div', { class: 'rc-error', hidden: true });
    const wrap = el('div', {}, [body, error]);
    let busy = false;

    const modal = openModal({
      title,
      body: wrap,
      actions: [
        { label: 'Cancel' },
        {
          label: confirmLabel,
          kind: 'primary',
          keepOpen: true,
          autofocus: true,
          onClick: async (handle) => {
            if (busy) return;
            busy = true;
            error.hidden = true;
            try {
              await onConfirm();
              handle.close();
            } catch (err) {
              error.textContent = err?.message || String(err);
              error.hidden = false;
            } finally {
              busy = false;
            }
          },
        },
      ],
    });
    return modal;
  }

  /**
   * The Monday of the week containing `ms`.
   *
   * Mondays because that is what the look-ahead is keyed on, and matching the
   * source's idea of a week is what lets a plan row and a look-ahead row be
   * compared at all. `getUTCDay()` and not `getDay()`: a calendar date must not
   * move because of a timezone.
   */
  function weekStart(ms) {
    const day = new Date(ms).getUTCDay();
    return ms - ((day + 6) % 7) * MS_DAY;
  }

  /** The five working days of a week, as ISO strings. */
  function weekDays(startMs) {
    return [0, 1, 2, 3, 4].map((n) => toISO(addDays(startMs, n)));
  }

  /** The seven days, for a view that has to show a weekend possession. */
  function allWeekDays(startMs) {
    return [0, 1, 2, 3, 4, 5, 6].map((n) => toISO(addDays(startMs, n)));
  }

  function todayISO() {
    return toISO(todayMs());
  }

  /** An ISO date back to the millisecond scale the rest of the app uses. */
  function isoToMs(iso) {
    return new Date(`${iso}T00:00:00Z`).getTime();
  }

  function dayLabel(iso, preset = 'short') {
    return fmtDate(isoToMs(iso), preset);
  }

  /** Index rows by id, so a join costs one pass rather than a query per row. */
  function byId(rows) {
    const map = new Map();
    for (const row of rows || []) map.set(row.id, row);
    return map;
  }

  /** Group rows under a key, for a grid that is people down and days across. */
  function groupBy(rows, key) {
    const map = new Map();
    for (const row of rows || []) {
      const k = typeof key === 'function' ? key(row) : row[key];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(row);
    }
    return map;
  }

  /** A row was written. Whatever is on screen reloads. */
  /**
   * A day's codes as nodes, with every struck-out code ("~WIT") in a span of its
   * own so it can be drawn struck through in red — the calendar's grid and the
   * editor's both draw a cell this way. Text with no tilde is returned as it is:
   * names, notes, anything that is not codes.
   */
  function codeNodes(value, klass = 'rc-code-cancelled') {
    const text = String(value ?? '');
    if (!text.includes('~') || !/^[\s~A-Za-z0-9.]+$/.test(text)) return [text];
    const parts = [];
    cellTokens(text).forEach((t, i) => {
      if (i) parts.push('.');
      parts.push(t.cancelled
        ? el('span', { class: klass, text: t.code, title: `${t.code} — cancelled` })
        : t.code);
    });
    return parts;
  }

  /**
   * The cancellation log from `from` on: days cancelled outright and BART
   * resources struck out of activities that went ahead, as one list oldest
   * first, each with its note. The log and the administrator's inbox both read
   * it here, so they cannot count differently. A database from before resource
   * cancellations were derived simply has none of them.
   */
  async function cancellationLog(from) {
    const [days, support, notes, codes] = await Promise.all([
      rc.listCancelledDays(from),
      rc.listCancelledSupportDays(from).catch(() => []),
      rc.listCancellationNotes().catch(() => []),
      rc.listSupportCodes({ includeRetired: true }).catch(() => []),
    ]);
    /* BART's resources only: a cancelled day lists what BART had been asked for
       with it, and a struck-out code is in the log only when it was BART's. A
       Hitachi resource taken off an activity is not a BART cancellation. */
    const events = [...cancellationEvents(days, { from }), ...supportCancellationEvents(support, { from })]
      .map((e) => ({ ...e, resources: bartCodes(e.resources, codes) }))
      .filter((e) => e.kind !== 'support' || e.resources.size)
      .sort((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label) || a.kind.localeCompare(b.kind));
    return attachCancellationNotes(events, notes);
  }

  function notifyChanged(what) {
    emit(EV.RC_CHANGED, { what });
  }

  /**
   * Go to another calendar tab. A tab cannot import the router — `ui/rc.js`
   * imports every tab — so it asks, the way a dock pane asks for another pane.
   * This is what lets an empty screen point at the place its data comes from.
   */
  /**
   * Which Organisation section to open next — set by whoever sends somebody
   * there (the inbox), read once by the tab. A tab cannot import another tab.
   */
  const orgNav = { section: null };

  function goToTab(tab) {
    emit(EV.RC_SHOW_TAB, { tab });
  }

  /**
   * The five statuses, split into the two families that must never be averaged.
   *
   * Performance is what an individual did. Health is what was done to them — a
   * possession released late is not underperformance, and counting it as such
   * would make the number worse than useless, because people would stop saying
   * they were blocked.
   */
  const STATUSES = [
    { id: 'completed', label: 'Completed', key: 'c', family: 'performance', tone: 'good' },
    { id: 'partial', label: 'Partial', key: 'p', family: 'performance', tone: 'warn' },
    { id: 'carried', label: 'Carried over', key: 'x', family: 'performance', tone: 'warn' },
    { id: 'blocked', label: 'Blocked', key: 'b', family: 'health', tone: 'bad' },
    { id: 'reassigned', label: 'Reassigned', key: 'r', family: 'health', tone: 'info' },
    { id: 'absent', label: 'Away', key: 'a', family: 'absence', tone: 'muted' },
  ];

  const STATUS_BY_ID = new Map(STATUSES.map((s) => [s.id, s]));

  /**
   * The three shifts, in the words the team uses.
   *
   * The third is a **blanket** — the possession the track is handed over for. It
   * is stored as `possession`, because that is the value `rc_plan_entries` and
   * `rc_actuals` check for and a rename would be a migration of every row ever
   * written for nothing a reader can see; it is *called* Blanket everywhere it
   * is drawn. `shiftFor()` already reads "blanket" on the workbook as this one.
   */
  const SHIFTS = [
    { id: 'day', label: 'Day' },
    { id: 'night', label: 'Night' },
    { id: 'possession', label: 'Blanket' },
  ];

  /** What a stored shift is called on screen. One place, so three views cannot differ. */
  function shiftLabel(id) {
    return SHIFTS.find((s) => s.id === id)?.label || id || '';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Names written in a spreadsheet, and the people they are
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Fold a name so spelling noise cannot decide whether it matches.
   *
   * Case and punctuation only. Nothing about the *words* is loosened: "R. Okafor"
   * and "r okafor" are the same name written twice, while "Okafor" is a different
   * string and matches only because somebody said so in the alias register.
   */
  function foldName(text) {
    return String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * A lookup from a written name to a person id.
   *
   * Three sources and no fourth: somebody's own full name, an alias somebody
   * recorded, and a **first name that belongs to exactly one person** — which is
   * what the 4WLA's Resource row is actually filled in with. There is still no
   * surname match: "Okafor" is a different string from "Rita Okafor" and matches
   * only because somebody said so in the alias register.
   *
   * The register itself is exact. A misspelling is answered separately, by
   * `nearestName()`, and only after this has failed — bounded by the length of
   * what was written, refused where two registered spellings are equally close,
   * and reported to the Resources tab when it does answer. That division is the
   * point: everything that reads this Map gets an exact answer, and the one place
   * that corrects a spelling says out loud that it did.
   *
   * They are added weakest first so the stronger answer wins. A full name beats an
   * alias pointing elsewhere — a name that *is* somebody's is theirs — and both
   * beat a first name, which is the loosest of the three.
   */
  function nameRegister(people, aliases = []) {
    const map = new Map();

    /* Weakest first, so the stronger answer overwrites it. A first name is the
       loosest of the three and an alias somebody typed is worth more than it;
       somebody's own full name is worth more than either. */
    for (const [key, id] of uniqueFirstNames(people)) map.set(key, id);
    for (const a of aliases || []) {
      const key = foldName(a.alias);
      if (key) map.set(key, a.person_id);
    }
    for (const p of people || []) {
      const key = foldName(p.name);
      if (key) map.set(key, p.id);
    }
    return map;
  }

  /**
   * How far apart two folded names are, giving up once they are further than
   * `limit`.
   *
   * Ordinary Levenshtein over two rows, with the whole row abandoned the moment
   * every cell in it is past the limit — which is what keeps this cheap against a
   * roster: almost every pair is obviously different and is dropped on the first
   * row. A transposition ("Okonwko") costs two here rather than one, which is
   * deliberate: a cheaper transposition would let a two-letter difference through
   * at a distance the caller thinks is one.
   */
  function nameDistance(a, b, limit = 2) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        if (row[j] < best) best = row[j];
      }
      if (best > limit) return limit + 1;
      prev = row;
    }
    return prev[b.length];
  }

  /**
   * How much misspelling a name of this length is allowed to carry.
   *
   * One character in a short name and two in a long one. Scaled because a fixed
   * allowance is wrong at both ends: two edits turn "Ana" into "Eve", while one
   * edit is barely a typo in "Kowalczyk". Below five folded characters nothing is
   * allowed at all — at that length half the roster is within one edit of the
   * other half.
   */
  function slackFor(key) {
    if (key.length < 5) return 0;
    return key.length >= 8 ? 2 : 1;
  }

  /**
   * The one person a misspelling can only have meant.
   *
   * The register matches exactly, and that stays the rule wherever an exact answer
   * exists — this is only ever asked after one has failed. What it adds is the
   * case the exact rule handled badly: a name typed into a spreadsheet at speed,
   * where "Okonkwo" arrives as "Okonwko" and a whole week of somebody's shifts
   * lands in the unmatched list for a transposed pair of letters.
   *
   * Two guards keep it from becoming the guessing the rest of this module
   * refuses. The distance is bounded by the length of what was written, so a
   * short name is still matched exactly. And a near miss that is near **two**
   * registered spellings at the same distance matches neither, for the reason two
   * people called Victor match neither: picking one would put a shift against the
   * wrong engineer, and it would look exactly as right on screen as the correct
   * answer.
   *
   * The answer is still *reported*. `resourceAssignments()` returns every name it
   * placed this way, and the Resources tab lists them, because a spelling matched
   * approximately is a spelling worth an alias — after which it is settled for
   * good and nothing is being inferred at all.
   */
  function nearestName(key, register) {
    const limit = slackFor(key);
    if (!limit) return null;
    let best = null;
    let bestAt = limit + 1;
    let tied = false;
    for (const [candidate, id] of register) {
      const d = nameDistance(key, candidate, limit);
      if (d > limit) continue;
      if (d < bestAt) { bestAt = d; best = { key: candidate, id }; tied = false; }
      else if (d === bestAt && best && best.id !== id) tied = true;
    }
    return tied ? null : best;
  }

  /**
   * "Is this written name me?" — the same register the week plan reads names
   * with (full name, alias, a first name only one person has, and the one
   * unambiguous near miss), so what it picks out is what the week plan puts
   * the person on. Resolves to null for an account with no person on the team.
   */
  async function meMatcher() {
    const me = rc.me();
    if (!me) return null;
    const [people, aliases] = await Promise.all([
      rc.listPeople({ includeInactive: true }).catch(() => []),
      rc.listPersonAliases().catch(() => []),
    ]);
    return personMatcher(nameRegister(people.length ? people : [me], aliases), me.id);
  }

  /** "Is this written name this person?" against a register — see `meMatcher()`. */
  function personMatcher(register, personId) {
    const memo = new Map();
    return (written) => {
      const key = foldName(written);
      if (!key) return false;
      if (!memo.has(key)) memo.set(key, (register.get(key) || nearestName(key, register)?.id || null) === personId);
      return memo.get(key);
    };
  }

  /**
   * A lookup from a spelling of a place to a location id.
   *
   * The same three-source, exact-fold rule the names get, and the same fold —
   * `rc_resolve_location()` in Postgres folds case and punctuation and nothing
   * else, and this has to agree with it or a location would resolve on the server
   * and not on screen. Weakest first: a code, then an alias somebody recorded,
   * then the location's own name.
   *
   * The code is in here because it is what the 4WLA is actually filled in with.
   * That sheet's Location column says "W30", not "Wayside 30", and a register
   * that only knew names and hand-written aliases matched none of it — which is
   * the same failure a roster of full names had against a Resource row of first
   * names. It is not a guess: `rc_locations.code` is a field somebody typed for
   * this location and no other.
   */
  function locationRegister(locations, aliases = []) {
    const map = new Map();
    for (const l of locations || []) {
      const key = foldName(l.code);
      if (key) map.set(key, l.id);
    }
    for (const a of aliases || []) {
      const key = foldName(a.alias);
      if (key) map.set(key, a.location_id);
    }
    for (const l of locations || []) {
      const key = foldName(l.name);
      if (key) map.set(key, l.id);
    }
    return map;
  }

  /**
   * The spellings of a place the look-ahead uses that the register cannot place.
   *
   * The other half of pulling the location off the sheet. Keeping an unresolved
   * spelling is only worth doing if somebody is shown it, and this is what the
   * Resources tab lists — one click from "add it as a location" or "that is one we
   * already have", exactly as an unmatched name and an unmapped colour are. A
   * location nobody has mapped is work whose place is written down and not
   * grouped, which is the one thing that makes a report quietly wrong rather than
   * visibly incomplete.
   */
  function unmatchedLocations(laRows, register) {
    const seen = new Map();
    for (const row of laRows || []) {
      if (row.location_id) continue;
      const written = String(row.raw_location || '').trim();
      const key = foldName(written);
      if (!key || register?.get(key)) continue;
      const held = seen.get(key) || { name: written, rows: [], weeks: new Set() };
      if (!held.rows.some((r) => r.id === row.id)) held.rows.push(row);
      if (row.week_start) held.weeks.add(row.week_start);
      seen.set(key, held);
    }
    return [...seen.values()].sort((a, b) => b.rows.length - a.rows.length);
  }

  /**
   * First name to person, for the names that belong to exactly one of them.
   *
   * The 4WLA's Resource row is filled in by hand at speed and it says "Victor",
   * not "Victor Okonkwo" — so a register that only knew full names matched almost
   * nothing on a real sheet. A first name is a deliberate convention here rather
   * than a guess at a spelling, which is what makes this different from matching
   * on a surname or a near miss.
   *
   * **Only where it is unambiguous.** Two people called Victor and the name maps
   * to neither: picking one would put a shift against the wrong engineer, which is
   * the one outcome this module is built to avoid, and it would do it silently
   * because both answers look equally plausible on screen. The pair goes to the
   * unmatched list instead, where `ambiguousFirstNames()` lets the interface say
   * *why* it could not place the name — the answer is an alias, once, and then it
   * is settled for good.
   *
   * A roster name that is already one word registers as a full name anyway, so
   * this only ever adds keys; it never changes what a complete name means.
   */
  function uniqueFirstNames(people) {
    const seen = new Map();
    for (const person of people || []) {
      const first = foldName(String(person.name || '').trim().split(/\s+/)[0]);
      if (!first) continue;
      if (seen.has(first)) seen.get(first).push(person.id);
      else seen.set(first, [person.id]);
    }
    return [...seen.entries()]
      .filter(([, ids]) => ids.length === 1)
      .map(([key, ids]) => [key, ids[0]]);
  }

  /**
   * The first names more than one person answers to.
   *
   * Reported rather than resolved. "Nobody on the roster is called that" and "two
   * people are, and I will not choose between them" are different problems with
   * different fixes, and a list that ran them together would send somebody looking
   * for a missing person who is already there twice.
   */
  function ambiguousFirstNames(people) {
    const seen = new Map();
    for (const person of people || []) {
      const first = foldName(String(person.name || '').trim().split(/\s+/)[0]);
      if (!first) continue;
      seen.set(first, (seen.get(first) || 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key));
  }

  /**
   * The newest read of each week, whole — one row per (week, row key).
   *
   * `rc_lookahead_rows` keeps every read, so asking for a span of weeks returns
   * the same activity once per snapshot, and drawn straight out that is the same
   * person at the same place four times over. `rank` maps a snapshot id to its
   * position in `listSnapshots()` output, which is newest first, so the lowest
   * rank wins. A row whose snapshot is not in the map is treated as oldest rather
   * than dropped: it is still a read that happened.
   *
   * **The unit is the week, not the row.** Taking the newest copy of each row key
   * independently keeps a row that only an *older* snapshot carries — so an
   * activity somebody deleted from the workbook went on being somebody's plan for
   * ever, and the symptom was the one that is impossible to argue with: a person
   * booked in the week plan onto an activity that is not in the 4WLA. A snapshot
   * is a complete statement of the weeks it covers, so the newest one to mention a
   * week is that week's answer and a row missing from it was removed. Older reads
   * of the same week are still on the record; they are simply not the plan.
   * A week the newest file no longer reaches keeps the newest read that did cover
   * it, which is what makes a rolled-forward window show last month at all.
   */
  function newestPerKey(rows, rank) {
    const at = (row) => (rank.has(row.snapshot_id) ? rank.get(row.snapshot_id) : Number.MAX_SAFE_INTEGER);

    // The newest read that says anything about each week.
    const newestFor = new Map();
    for (const row of rows || []) {
      const held = newestFor.get(row.week_start);
      if (held === undefined || at(row) < held) newestFor.set(row.week_start, at(row));
    }

    const best = new Map();
    for (const row of rows || []) {
      if (at(row) !== newestFor.get(row.week_start)) continue;
      const key = `${row.week_start}|${row.row_key}`;
      if (!best.has(key)) best.set(key, row);
    }
    return [...best.values()];
  }

  /**
   * The newest snapshot, read as a calendar — once.
   *
   * `applyLegend()` and `readGrid()` are pure over the grid and the legend, and
   * they are not cheap: a hundred and forty rows by a hundred days, resolved
   * against the legend and then walked for the date axis, the headings, the
   * Resource rows and the absence rows. Five screens were doing that on every
   * visit, over the same snapshot and the same legend, and each one paid for it
   * in the gap between the click and the table.
   *
   * So the parse is remembered against what it was made from — the snapshot's id
   * and the legend as it stands — and handed back whole to the next caller. The
   * legend is part of the key on purpose: mapping a colour has to change what is
   * on screen at once, which is the rule the whole legend design rests on, and a
   * memo that ignored it would show the old reading until the next reload. One
   * entry, because there is one newest snapshot; a new read replaces it.
   */
  let parsed = null;

  function parsedView(snapshot, legendRows) {
    const legend = (legendRows || []).map((r) => ({
      argb: r.argb, meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from,
    }));
    const key = `${snapshot.id}|${snapshot.taken_at}|${JSON.stringify(legend)}`;
    if (parsed?.key === key) return parsed.view;
    const grid = applyLegend(snapshot.grid, legend);
    // The colours the legend could not place ride along: they are a fact about
    // this grid under this legend, which is exactly what the key says.
    const view = { ...readGrid(grid, { anchorISO: snapshot.taken_at }), unknown: grid.unknown || [] };
    parsed = { key, view };
    return view;
  }

  /**
   * The look-ahead for a span of weeks: `{ rows, absences }`.
   *
   * Two answers rather than one, because the sheet says two things. `rows` is the
   * work — one per activity per week, with who is on it and where. `absences` is
   * the "PTO" and "Other Group / Project" rows, which are about people rather than
   * about work and are therefore never rows of scope.
   *
   * The one place the three views ask, so they cannot disagree about where
   * somebody is — the week plan, the Resources tab and the huddle all come
   * through here.
   *
   * **The names are taken from the snapshot, not from the stored column.** They
   * are stored too, in `rc_lookahead_rows.resources`, and that is what a join
   * wants — but a database built before that column existed refuses the insert
   * over it, and the only symptom was three screens quietly reporting that the
   * workbook named nobody while the calendar, which re-reads the snapshot, showed
   * the names perfectly well. So the snapshot is the authority here for the same
   * reason it is for the legend: it is re-read at paint time, so it is right the
   * moment somebody edits the sheet rather than at the next successful write.
   *
   * **And where the sheet says the work is**, for the same reason and out of the
   * same grid — see `graftLocations()`. Between them they are why a derived day
   * arrives in the week plan, the Resources tab and the huddle with both a person
   * and a place against it, and why recording an outcome on one files it at that
   * place rather than nowhere.
   *
   * Grafted onto the stored rows rather than replacing them, because those carry
   * the id a plan entry links to and the location the alias register resolved.
   * The join is `sheet_row` within a week, which is a position in one file — so it
   * is only offered the rows that came out of *this* snapshot. Across two reads a
   * row inserted mid-sheet shifts every row below it, and the graft would then
   * hand an activity another activity's names and another activity's place. It
   * fills a gap rather than overruling one, which is what the stored column is for
   * once a project has it.
   */
  async function lookaheadWithResources(fromISO, toISO) {
    /* The snapshot *list* is read without its grids — that is what `newestPerKey`
       ranks on, and it only needs the ids in order. The one grid anybody draws is
       fetched on its own. Reading twenty grids to use one was most of the wait
       between tabs. */
    const [stored, snapshots, snapshot, legendRows, locations, locAliases] = await Promise.all([
      rc.lookaheadBetween(fromISO, toISO).catch(() => []),
      rc.listSnapshotMeta({ limit: 20 }).catch(() => []),
      rc.latestSnapshot().catch(() => null),
      rc.listLegend().catch(() => []),
      rc.listLocations({ includeInactive: true }).catch(() => []),
      rc.listLocationAliases().catch(() => []),
    ]);

    const laRows = newestPerKey(stored, new Map(snapshots.map((s, i) => [s.id, i])));
    if (!snapshot?.grid) return { rows: laRows, absences: [] };

    const view = parsedView(snapshot, legendRows);
    const rows = graftLocations(
      graftResources(laRows, view, snapshot.id),
      view,
      locationRegister(locations, locAliases),
      snapshot.id
    );
    /* Narrowed to the window that was asked for, because the snapshot carries the
       whole four-to-six weeks and a caller asking about one week must not be told
       who is off in another. */
    const absences = absencesFrom(view).filter((a) => a.date >= fromISO && a.date <= toISO);
    return { rows, absences };
  }

  /**
   * Fill in each row's location from the grid's own Location column.
   *
   * Here for the reason the names are: a row written by a deployment that read
   * the location differently — or could not resolve it and therefore kept nothing
   * — carries no place at all, and the snapshot on screen says exactly where the
   * work is. The sheet is re-read at paint time, so this is right the moment
   * somebody corrects the workbook rather than at the next successful ingest.
   *
   * **It fills gaps and overrules nothing.** A stored `location_id` is a spelling
   * the register resolved when the row was written and is left alone; the raw text
   * is only supplied where there is none. The resolve is the same folded lookup
   * the server does, so a place resolves identically whether it arrived through
   * the ingest or through here.
   */
  function graftLocations(laRows, view, register, snapshotId) {
    const column = locationColumnOf(view);
    if (column < 0) return laRows;

    const bySheetRow = new Map();
    for (const activity of view?.activities || []) {
      const text = String(activity.meta?.[column] || '').trim();
      if (text) bySheetRow.set(activity.row, text);
    }
    if (!bySheetRow.size) return laRows;

    return (laRows || []).map((row) => {
      if (!fromSnapshot(row, snapshotId)) return row;
      const written = bySheetRow.get(row.sheet_row);
      if (!written) return row;
      const raw = row.raw_location || written;
      const id = row.location_id || register?.get(foldName(raw)) || null;
      if (raw === row.raw_location && id === (row.location_id || null)) return row;
      return { ...row, raw_location: raw, location_id: id };
    });
  }

  /**
   * Is this stored row one of the rows the grid in hand was read from?
   *
   * Both grafts join on `sheet_row`, which is a position in *one* file: rows 42 of
   * two different reads are two different activities the moment anybody inserts a
   * line. A week the newest snapshot no longer covers is served by an older read,
   * so its rows sit beside the newest ones in the same array — and joining the
   * newest grid onto them by position is how somebody ends up with another
   * activity's names and another activity's location. With no snapshot named the
   * guard stands down, because a caller that has not said which file the grid came
   * from is asking for the old behaviour.
   */
  function fromSnapshot(row, snapshotId) {
    return !snapshotId || !row.snapshot_id || row.snapshot_id === snapshotId;
  }

  /** Fill in each row's `resources` from the grid, where the sheet still says so. */
  function graftResources(laRows, view, snapshotId) {
    const dayByCol = new Map((view?.days || []).map((d) => [d.col, d]));

    const bySheetRow = new Map();
    for (const activity of view?.activities || []) {
      if (!activity.resource) continue;
      const perDay = {};
      for (const mark of activity.resource.marks) {
        if (!mark.value) continue;
        const day = dayByCol.get(mark.col);
        if (day?.date) perDay[day.date] = mark.value;
      }
      if (Object.keys(perDay).length) bySheetRow.set(activity.row, perDay);
    }
    if (!bySheetRow.size) return laRows;

    const mondayOf = (iso) => toISO(weekStart(isoToMs(iso)));
    return (laRows || []).map((row) => {
      if (!fromSnapshot(row, snapshotId)) return row;
      const perDay = bySheetRow.get(row.sheet_row);
      if (!perDay) return row;
      // A row belongs to one week; a name on a day in another week belongs to that
      // week's copy of the row, not to this one.
      const mine = {};
      for (const [date, names] of Object.entries(perDay)) {
        if (mondayOf(date) === row.week_start) mine[date] = names;
      }
      return Object.keys(mine).length
        ? { ...row, resources: { ...(row.resources || {}), ...mine } }
        : row;
    });
  }

  /**
   * Who the look-ahead's Resource rows put where, per day.
   *
   * Returns `byPerson` — a person id to a map of date to the rows naming them —
   * `unmatched`, the spellings the register cannot place at all, and `near`, the
   * ones it placed by correcting a misspelling. The second and third halves are
   * the point as much as the first: a name nobody has mapped is a person missing
   * from the picture, and a name matched approximately is one placed on a judgement
   * somebody should get the chance to confirm. Reporting both is the difference
   * between a view that is incomplete and one that is quietly wrong.
   */
  function resourceAssignments(laRows, register) {
    const byPerson = new Map();
    const unmatched = new Map();
    const near = new Map();
    const resolve = nameResolver(register);

    for (const row of laRows || []) {
      for (const [date, text] of Object.entries(row.resources || {})) {
        for (const written of resourceNames(text)) {
          const key = foldName(written);
          if (!key) continue;
          const { id: personId, corrected } = resolve(key);
          if (!personId) {
            const seen = unmatched.get(key) || { name: written, days: new Set(), rows: [] };
            seen.days.add(date);
            if (!seen.rows.some((r) => r.id === row.id)) seen.rows.push(row);
            unmatched.set(key, seen);
            continue;
          }
          if (corrected) {
            const seen = near.get(key)
              || { name: written, person_id: personId, days: new Set(), rows: [] };
            seen.days.add(date);
            if (!seen.rows.some((r) => r.id === row.id)) seen.rows.push(row);
            near.set(key, seen);
          }
          if (!byPerson.has(personId)) byPerson.set(personId, new Map());
          const days = byPerson.get(personId);
          if (!days.has(date)) days.set(date, []);
          if (!days.get(date).some((r) => r.id === row.id)) days.get(date).push(row);
        }
      }
    }

    return { byPerson, unmatched: [...unmatched.values()], near: [...near.values()] };
  }

  /**
   * The register's answer for one folded spelling: exact where it has one, the
   * nearest unambiguous misspelling where it does not.
   *
   * A closure rather than a bare function because the near-miss scan walks the
   * whole register, and a hundred days of a real sheet ask about the same handful
   * of spellings over and over — memoising is what keeps that one pass rather than
   * thousands. `corrected` says which of the two answers it is, so a caller can
   * report a name it only matched approximately instead of quietly absorbing it.
   */
  function nameResolver(register) {
    const memo = new Map();
    return (key) => {
      if (memo.has(key)) return memo.get(key);
      const exact = register.get(key);
      const answer = exact
        ? { id: exact, corrected: null }
        : (() => {
          const guess = nearestName(key, register);
          return guess ? { id: guess.id, corrected: guess.key } : { id: null, corrected: null };
        })();
      memo.set(key, answer);
      return answer;
    };
  }

  /**
   * Who the sheet says is away, matched to the roster.
   *
   * The same shape and the same rules as `resourceAssignments()` — exact fold,
   * full name over alias over a first name exactly one person answers to, and an
   * unmatched spelling reported rather than guessed at. A name typed on the PTO
   * row is the same kind of thing as a name typed on a Resource row, so there is
   * one register and not a second one that could disagree about who "Victor" is.
   *
   * **Being off outranks everything else.** Somebody written on the PTO row and
   * on a work row for the same day is the sheet contradicting itself about one
   * person, and the stronger claim is the one saying they were not there at all:
   * on another project or at their desk they are working and can be asked how it
   * went, and on leave they cannot.
   *
   * Two *work* rows on one day are not a contradiction, though — a morning at the
   * desk and an afternoon on somebody else's project is an ordinary day — so the
   * answer is a list, the same shape the plan itself now has. It is a list per
   * day rather than a single kind for exactly that reason: collapsing them would
   * drop one of the two things the sheet plainly said.
   */
  function absenceAssignments(absences, register) {
    const byPerson = new Map();
    const unmatched = new Map();
    const near = new Map();
    const resolve = nameResolver(register);

    for (const entry of absences || []) {
      for (const written of resourceNames(entry.written)) {
        const key = foldName(written);
        if (!key) continue;
        const { id: personId, corrected } = resolve(key);
        if (corrected && personId) {
          const seen = near.get(key)
            || { name: written, person_id: personId, days: new Set(), rows: [] };
          seen.days.add(entry.date);
          near.set(key, seen);
        }
        if (!personId) {
          const seen = unmatched.get(key) || { name: written, days: new Set(), kinds: new Set() };
          seen.days.add(entry.date);
          seen.kinds.add(entry.kind);
          unmatched.set(key, seen);
          continue;
        }
        if (!byPerson.has(personId)) byPerson.set(personId, new Map());
        const days = byPerson.get(personId);
        const kinds = days.get(entry.date) || [];
        if (kinds.includes(entry.kind)) continue;
        if (entry.kind === 'pto') days.set(entry.date, ['pto']);
        else if (!kinds.includes('pto')) days.set(entry.date, [...kinds, entry.kind]);
      }
    }

    return { byPerson, unmatched: [...unmatched.values()], near: [...near.values()] };
  }

  /**
   * What the workbook's wording says the shift is.
   *
   * The meaning is the legend's word for the colour, so "Night Shift" and
   * "Blanket" are the sheet's own vocabulary rather than ours. Anything it does
   * not recognise is a day shift, which is what an unlabelled cell has always
   * meant on this project.
   */
  function shiftFor(meaning) {
    const said = String(meaning || '').toLowerCase();
    if (/night/.test(said)) return 'night';
    if (/possession|blanket/.test(said)) return 'possession';
    return 'day';
  }

  /**
   * What somebody is doing on a day: the plan where there is one, the 4WLA where
   * there is not.
   *
   * **The look-ahead used to propose and a person assigned.** That rule existed
   * for one reason — the sheet said what and where and *never who*, so a plan
   * entry had to supply the missing fact, and inventing it would have been the
   * guess this module refuses everywhere. The Resource row says who. There is no
   * missing fact left, so asking somebody to press a button is asking them to
   * re-type what the workbook already states, once per person per day.
   *
   * So the 4WLA assignment **is** the plan for that day. It is *derived*, not
   * written: `rc_plan_entries` is append-only evidence of what somebody decided,
   * and materialising the sheet into it would store a derivation — the one thing
   * this codebase is most consistent about not doing — while making the
   * workbook's authorship indistinguishable from a decision anybody took. It
   * would also go stale the moment the sheet changed, and need superseding to
   * correct, which is a revision of something nobody ever revised.
   *
   * A stored entry always wins. That is the whole meaning of one existing: it is
   * somebody overriding the sheet, or planning a day the sheet says nothing about
   * — an office day, another project, a task carried over. The sheet is the
   * default; a row is a decision.
   */
  function assignmentIndex({ planRows, laRows, register, absences = [], categories = [] }) {
    const { byPerson, unmatched, near } = resourceAssignments(laRows, register);
    const away = absenceAssignments(absences, register);

    /* Which seeded category an off-project day belongs to.
       A day in the office is a day somebody worked, and a report that could not
       say *what* they worked on is the blank the `Office` and `Other project`
       categories were seeded to fill. Matched on the name the schema seeds,
       folded; a renamed category stops matching and the day arrives
       uncategorised, which is ungrouped rather than grouped wrongly. */
    const categoryFor = (kind) => {
      const want = ABSENCE_KINDS[kind]?.category;
      if (!want) return null;
      return (categories || []).find((c) => foldName(c.name) === foldName(want))?.id || null;
    };

    /* A day is a **list**. A shift is routinely more than one job — a test to
       witness in the morning and a cable pull after it — and a day that could
       only hold one task is how somebody ends up with one of the three things
       they were asked for. Every view reads it as a list; the one place a single
       entry is still wanted is an outcome, which points at one row, and `at()`
       answers that with the first. */
    const stored = new Map();
    for (const row of planRows || []) {
      const key = `${row.person_id}|${row.work_date}`;
      if (!stored.has(key)) stored.set(key, []);
      stored.get(key).push(row);
    }

    /* Who is away, before who is on what.
       A day on the PTO row and a day on an activity's Resource row are the same
       sheet contradicting itself, and the answer has to be one of them: a person
       recorded as being at a location on a day they were off is exactly the kind
       of thing that gets found a year later in a claim. The row about the *person*
       wins, because it is the more specific statement — and a stored entry still
       beats both, since that is somebody deciding against the sheet. */
    const derived = new Map();
    for (const [personId, days] of away.byPerson) {
      for (const [iso, kinds] of days) {
        const key = `${personId}|${iso}`;
        if (stored.has(key)) continue;
        // One entry per kind: a day at the desk and a day on another group's
        // project are two things the sheet said, not one to choose between.
        derived.set(key, kinds.map((kind) => ({
          id: null,
          from_lookahead: true,
          absence: kind,
          person_id: personId,
          work_date: iso,
          task: ABSENCE_LABELS[kind],
          location_id: null,
          raw_location: null,
          category_id: categoryFor(kind),
          shift: 'day',
          lookahead_row_id: null,
          carry_chain_id: null,
        })));
      }
    }

    for (const [personId, days] of byPerson) {
      for (const [iso, rows] of days) {
        const key = `${personId}|${iso}`;
        if (stored.has(key) || derived.has(key)) continue;
        /* **Every** row the sheet names them on, not the first with a count
           beside it. The workbook putting somebody on two activities in one day
           is the same fact as a scheduler planning two tasks, and reading only
           the first lost the rest with nothing on screen to say so. */
        derived.set(key, rows.map((row) => ({
          // Null, and load-bearing: every caller that writes an outcome or rolls a
          // task forward reads this to decide whether there is a row to point at.
          id: null,
          from_lookahead: true,
          absence: null,
          person_id: personId,
          work_date: iso,
          task: row.raw_label || null,
          location_id: row.location_id || null,
          raw_location: row.raw_location || null,
          category_id: null,
          shift: shiftFor(row.cells?.[iso]),
          lookahead_row_id: row.id || null,
          carry_chain_id: null,
        })));
      }
    }

    const on = (personId, iso) =>
      stored.get(`${personId}|${iso}`) || derived.get(`${personId}|${iso}`) || [];

    return {
      /* Everything planned for that day, in order. The shape every view reads. */
      on,
      /* The first of them, for the one caller that needs a single row: an outcome
         points at one plan entry, and rolling a task forward carries one chain.
         Null when the day is empty, which is what those callers test. */
      at: (personId, iso) => on(personId, iso)[0] || null,
      /* What the *sheet* says about somebody being away, whatever anybody has
         stored over the top of it. `availability()` takes this, so a person the
         workbook puts on PTO is not asked in the huddle how their day went. */
      absent: (personId, iso) => {
        const kinds = away.byPerson.get(personId)?.get(iso) || [];
        // Leave first: it is the only one `availability()` acts on, and a day
        // carrying it carries nothing else.
        return kinds.includes('pto') ? 'pto' : (kinds[0] || null);
      },
      byPerson,
      unmatched,
      /* Spellings placed by correcting a misspelling rather than by matching one.
         Carried out so the Resources tab can list them: the answer stands, and an
         alias is what turns it from a judgement into a fact. */
      near: [...near, ...away.near],
      awayUnmatched: away.unmatched,
      derived: derived.size,
    };
  }

  /**
   * How each drawn task went, from the huddle's outcomes.
   *
   * Returns `(entry, personId, iso) => outcome | null`. Indexed two ways because
   * an outcome points at one plan entry where there was one to point at, and at
   * nothing but a person and a date where the day was derived from the sheet — so
   * both keys are needed or the derived days, which are most of them, would show
   * no outcome at all. A stored entry is matched on its id and on nothing else:
   * two tasks on one day each carry their own note. A derived day takes whichever
   * outcome was recorded against the person and the date, preferring one that
   * points at no entry, because there is no row for it to point at.
   *
   * One function because the week plan and the phone's week both draw "how it
   * went" against a task, and two readings of one outcome is two answers.
   */
  function outcomeLookup(actuals) {
    const byEntry = new Map();
    const byDay = new Map();
    for (const row of actuals || []) {
      if (row.plan_entry_id) byEntry.set(row.plan_entry_id, row);
      const key = `${row.person_id}|${row.work_date}`;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(row);
    }
    return (entry, personId, iso) => {
      if (entry?.id && byEntry.has(entry.id)) return byEntry.get(entry.id);
      if (entry?.id) return null;
      const day = byDay.get(`${personId}|${iso}`) || [];
      return day.find((a) => !a.plan_entry_id) || day[0] || null;
    };
  }

  /**
   * Whether somebody is available on a date.
   *
   * Leave is the reason this exists. Absence is a different fact from "carried
   * over" or "reassigned", and without somewhere for it to go it gets silently
   * distributed across the performance statuses — which is precisely what the
   * five-status split is designed to prevent.
   *
   * Returns `{ state, leave?, sheet?, asked? }`. `asked` is a leave row nobody
   * has answered yet and it never changes the state: a member asking for a day
   * off must not take themselves out of the schedule, or the administrator would
   * be answering a question that had already answered itself.
   */
  function availability(person, iso, leaveRows, absent = null) {
    const ms = isoToMs(iso);
    const weekday = new Date(ms).getUTCDay() || 7; // ISO: Monday 1 … Sunday 7
    const working = Array.isArray(person?.working_days) ? person.working_days : [1, 2, 3, 4, 5];

    const mine = (leaveRows || []).filter(
      (l) => l.person_id === person.id && l.start_date <= iso && l.end_date >= iso
        && l.status !== 'cancelled' && l.status !== 'declined'
    );
    /* **A request is not leave yet**, and that distinction is the whole point of
       a member being able to ask. An unanswered request used to count here — the
       filter only dropped `cancelled` and `declined` — which would have taken
       somebody out of the schedule the moment they asked and left the
       administrator answering a question that had already answered itself. So it
       is carried alongside instead: the state stays `available`, and `asked` lets
       a screen say the question is open. */
    const leave = mine.find((l) => l.status !== 'requested');
    const asked = mine.find((l) => l.status === 'requested') || null;
    if (leave) return { state: 'leave', leave, asked };
    /* The 4WLA's PTO row, where nobody booked the leave. Most days it is the only
       place the absence is written down at all — somebody types a name into the
       workbook and never opens Organisation — and without reading it the huddle
       asks a person on holiday how their day went, and the week plan shows them as
       a day nobody bothered to fill in. The office and another group's project are
       *not* leave: those are days somebody worked, they can be asked how it went,
       and where they were is the assignment. `ABSENCE_KINDS[kind].leave` is the
       one place that distinction lives. */
    if (absent && ABSENCE_KINDS[absent]?.leave) return { state: 'leave', sheet: absent, asked };
    if (!working.includes(weekday)) return { state: 'non-working', asked };
    return { state: 'available', asked };
  }

  Object.defineProperty(__x, "formModal", { get: () => formModal, enumerable: true });
  Object.defineProperty(__x, "weekStart", { get: () => weekStart, enumerable: true });
  Object.defineProperty(__x, "weekDays", { get: () => weekDays, enumerable: true });
  Object.defineProperty(__x, "allWeekDays", { get: () => allWeekDays, enumerable: true });
  Object.defineProperty(__x, "todayISO", { get: () => todayISO, enumerable: true });
  Object.defineProperty(__x, "isoToMs", { get: () => isoToMs, enumerable: true });
  Object.defineProperty(__x, "dayLabel", { get: () => dayLabel, enumerable: true });
  Object.defineProperty(__x, "byId", { get: () => byId, enumerable: true });
  Object.defineProperty(__x, "groupBy", { get: () => groupBy, enumerable: true });
  Object.defineProperty(__x, "codeNodes", { get: () => codeNodes, enumerable: true });
  Object.defineProperty(__x, "cancellationLog", { get: () => cancellationLog, enumerable: true });
  Object.defineProperty(__x, "notifyChanged", { get: () => notifyChanged, enumerable: true });
  Object.defineProperty(__x, "orgNav", { get: () => orgNav, enumerable: true });
  Object.defineProperty(__x, "goToTab", { get: () => goToTab, enumerable: true });
  Object.defineProperty(__x, "STATUSES", { get: () => STATUSES, enumerable: true });
  Object.defineProperty(__x, "STATUS_BY_ID", { get: () => STATUS_BY_ID, enumerable: true });
  Object.defineProperty(__x, "SHIFTS", { get: () => SHIFTS, enumerable: true });
  Object.defineProperty(__x, "shiftLabel", { get: () => shiftLabel, enumerable: true });
  Object.defineProperty(__x, "foldName", { get: () => foldName, enumerable: true });
  Object.defineProperty(__x, "nameRegister", { get: () => nameRegister, enumerable: true });
  Object.defineProperty(__x, "nameDistance", { get: () => nameDistance, enumerable: true });
  Object.defineProperty(__x, "nearestName", { get: () => nearestName, enumerable: true });
  Object.defineProperty(__x, "meMatcher", { get: () => meMatcher, enumerable: true });
  Object.defineProperty(__x, "personMatcher", { get: () => personMatcher, enumerable: true });
  Object.defineProperty(__x, "locationRegister", { get: () => locationRegister, enumerable: true });
  Object.defineProperty(__x, "unmatchedLocations", { get: () => unmatchedLocations, enumerable: true });
  Object.defineProperty(__x, "uniqueFirstNames", { get: () => uniqueFirstNames, enumerable: true });
  Object.defineProperty(__x, "ambiguousFirstNames", { get: () => ambiguousFirstNames, enumerable: true });
  Object.defineProperty(__x, "newestPerKey", { get: () => newestPerKey, enumerable: true });
  Object.defineProperty(__x, "parsedView", { get: () => parsedView, enumerable: true });
  Object.defineProperty(__x, "lookaheadWithResources", { get: () => lookaheadWithResources, enumerable: true });
  Object.defineProperty(__x, "graftLocations", { get: () => graftLocations, enumerable: true });
  Object.defineProperty(__x, "graftResources", { get: () => graftResources, enumerable: true });
  Object.defineProperty(__x, "resourceAssignments", { get: () => resourceAssignments, enumerable: true });
  Object.defineProperty(__x, "nameResolver", { get: () => nameResolver, enumerable: true });
  Object.defineProperty(__x, "absenceAssignments", { get: () => absenceAssignments, enumerable: true });
  Object.defineProperty(__x, "shiftFor", { get: () => shiftFor, enumerable: true });
  Object.defineProperty(__x, "assignmentIndex", { get: () => assignmentIndex, enumerable: true });
  Object.defineProperty(__x, "outcomeLookup", { get: () => outcomeLookup, enumerable: true });
  Object.defineProperty(__x, "availability", { get: () => availability, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// mobile/week.js
// ════════════════════════════════════════════════════════════════════════
__mods["mobile/week.js"] = function (__x, __req) {
  /**
   * My week — what I am on, day by day, and the way to change it.
   *
   * The week plan's own reading, turned on its side for a phone: one person down
   * the screen instead of the team across it. Nothing here decides anything the
   * week plan does not. The day's tasks are `assignmentIndex().on()` — a stored
   * entry where somebody wrote one, the 4WLA where nobody did — availability is
   * `availability()`, how a task went is `outcomeLookup()`, and every write is an
   * `rc_plan_entries` row through `core/rc.js`. So a task added on a phone is in
   * tomorrow's huddle against its owner's name exactly as one added at a desk.
   *
   * **What can be changed is what the database would allow.** A member plans,
   * revises and withdraws their own days; an administrator anybody's; a viewer
   * nobody's. That is `rc_can_act_for()` in Postgres, and this only stops
   * offering what would be refused. Anybody may *look* at a colleague's week —
   * the week plan shows every member the whole team — which is what the picker is
   * for: "where is Dan on Thursday" is a phone question.
   *
   * Three writes, the same three as the week plan:
   *
   *   - **Add** writes a new entry for a day, and optionally for other days of the
   *     same week — a Monday-to-Wednesday office stint is one form, not three.
   *   - **Change** revises a stored entry (`rc_supersede_plan`: the old version
   *     stays on the record) or, on a day the 4WLA plans, writes the first stored
   *     entry — which is overriding the sheet, and the form says so.
   *   - **Remove** withdraws a stored entry (`rc_withdraw_plan`, a tombstone, never
   *     a delete). A day the sheet asserts has nothing to withdraw; changing it is
   *     the honest answer there.
   *
   * Imports: util, dates, rc, icons, components, rc_util.
   */

  const { el, clear } = __req("core/util.js");
  const { todayMs, MS_DAY, DAYS } = __req("core/dates.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, selectInput, segmented, toast, badge, field, confirmDialog } = __req("ui/components.js");


  const { SHIFTS, shiftLabel, STATUS_BY_ID, weekStart, allWeekDays, todayISO, dayLabel, isoToMs, byId, availability, notifyChanged, formModal, nameRegister, lookaheadWithResources, assignmentIndex, outcomeLookup } = __req("ui/rc_util.js");




  /** The Monday on screen, or null for this week. */
  let weekOf = null;
  /** Whose week, or null for the signed-in person's own. */
  let whose = null;
  /** Which week and person today has already been scrolled to, so a re-read does not jump. */
  let scrolledFor = null;

  async function render(root) {
    const me = rc.me();
    const startMs = weekOf ?? weekStart(todayMs());
    const days = allWeekDays(startMs);
    const from = days[0];
    const to = days[days.length - 1];
    const today = todayISO();

    const [everybody, scheduled, locations, categories, leave, planRows, actuals, aliases, sheet] =
      await Promise.all([
        /* Everybody for the register — a name in the workbook belongs to whoever
           it belongs to — and the scheduled roster for the picker, which is who
           the week plan draws. */
        rc.listPeople(),
        rc.listPeople({ scheduledOnly: true }),
        rc.listLocations(),
        rc.listCategories(),
        rc.listLeave(from, to),
        rc.listPlan(from, to),
        rc.listActuals(from, to).catch(() => []),
        rc.listPersonAliases().catch(() => []),
        lookaheadWithResources(from, to),
      ]);

    /* `me()` carries the account's role, not the roster row's working days —
       which is what `availability()` reads. The roster has the whole row. */
    const self = everybody.find((p) => p.id === me.id) || me;
    const choices = [self, ...scheduled.filter((p) => p.id !== self.id)];
    if (whose && !choices.some((p) => p.id === whose)) whose = null;
    const person = choices.find((p) => p.id === (whose || self.id)) || self;
    const own = person.id === self.id;
    const mayPlan = rc.canWrite() && (rc.isAdmin() || own);

    const locs = byId(locations);
    const cats = byId(categories);
    const index = assignmentIndex({
      planRows,
      laRows: sheet.rows,
      absences: sheet.absences,
      categories,
      register: nameRegister(everybody.length ? everybody : scheduled, aliases),
    });
    const outcomeFor = outcomeLookup(actuals);
    const redraw = () => { clear(root); return render(root); };

    const ctx = {
      person, days, from, to, today, leave, locations, categories, locs, laRows: sheet.rows, index,
    };

    /* ── The week and whose it is ─────────────────────────────────────────── */

    const current = weekOf === null;
    root.appendChild(el('div', { class: 'm-weekbar' }, [
      el('button', {
        class: 'cx-btn icon ghost m-step',
        'aria-label': 'Previous week',
        html: icon('chevron-left', { size: 20 }),
        onClick: () => { weekOf = startMs - 7 * MS_DAY; redraw(); },
      }),
      el('div', { class: 'm-weekbar-mid' }, [
        el('div', { class: 'm-weekbar-title', text: `${dayLabel(from, 'day')} – ${dayLabel(to, 'day')}` }),
        current
          ? el('div', { class: 'm-weekbar-sub', text: 'This week' })
          : el('button', {
            class: 'm-weekbar-sub m-link',
            type: 'button',
            text: 'Back to this week',
            onClick: () => { weekOf = null; redraw(); },
          }),
      ]),
      el('button', {
        class: 'cx-btn icon ghost m-step',
        'aria-label': 'Next week',
        html: icon('chevron-right', { size: 20 }),
        onClick: () => { weekOf = startMs + 7 * MS_DAY; redraw(); },
      }),
    ]));

    if (choices.length > 1) {
      const picker = selectInput({
        value: person.id,
        options: choices.map((p) => ({ value: p.id, label: p.id === self.id ? `${p.name} (me)` : p.name })),
        onChange: (value) => { whose = value === self.id ? null : value; redraw(); },
      });
      picker.setAttribute('aria-label', 'Whose week');
      root.appendChild(el('div', { class: 'm-whose' }, [
        el('span', { class: 'm-whose-label', html: icon('user', { size: 14 }) }),
        picker,
      ]));
    }

    if (!mayPlan) {
      root.appendChild(el('p', {
        class: 'm-note',
        text: !rc.canWrite()
          ? 'Your account can read the calendar but not change it.'
          : `This is ${person.name}’s week, so it is read-only here. You can change your own.`,
      }));
    }

    /* ── The days ─────────────────────────────────────────────────────────── */

    const list = el('div', { class: 'm-days' });
    let tasks = 0;
    let off = 0;
    for (const iso of days) {
      const state = availability(person, iso, leave, index.absent(person.id, iso));
      if (state.state === 'leave') off++;
      else tasks += index.on(person.id, iso).length;
      list.appendChild(dayCard(iso, state, { ...ctx, mayPlan, outcomeFor, cats, everybody, own }));
    }

    root.appendChild(el('p', {
      class: 'm-summary',
      text: [
        `${tasks} task${tasks === 1 ? '' : 's'} planned`,
        off ? `${off} day${off === 1 ? '' : 's'} off` : null,
      ].filter(Boolean).join(' · '),
    }));
    root.appendChild(list);

    /* Today, in view — once per week and person, so a re-read after an edit does
       not yank the screen back up to it. */
    const key = `${person.id}|${from}`;
    if (current && scrolledFor !== key) {
      scrolledFor = key;
      const card = list.querySelector('.m-today');
      if (card) requestAnimationFrame(() => card.scrollIntoView({ block: 'start' }));
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     A day
     ═══════════════════════════════════════════════════════════════════════ */

  function dayCard(iso, state, ctx) {
    const { person, today, index, mayPlan } = ctx;
    const planned = index.on(person.id, iso);
    const quiet = state.state === 'non-working' && !planned.length;
    const ms = isoToMs(iso);

    const card = el('section', {
      class: [
        'm-day',
        iso === today ? 'm-today' : '',
        quiet ? 'm-quiet' : '',
        state.state === 'leave' ? 'm-off' : '',
      ].filter(Boolean).join(' '),
      'data-date': iso,
      'aria-label': dayLabel(iso, 'dayFull'),
    });

    card.appendChild(el('header', { class: 'm-day-head' }, [
      el('span', { class: 'm-day-name', text: DAYS[new Date(ms).getUTCDay()] }),
      el('span', { class: 'm-day-date', text: dayLabel(iso, 'medium').replace(/,? \d{4}$/, '') }),
      iso === today ? el('span', { class: 'm-today-tag', text: 'Today' }) : null,
      el('span', { class: 'm-day-flags' }, [
        state.state === 'leave' ? badge(state.sheet ? 'PTO' : 'On leave', 'pending') : null,
        /* Asked for and not yet answered: the day is still a working day, and
           saying so here stops somebody planning straight over their own request. */
        state.asked ? badge('Leave requested', 'warn') : null,
        quiet ? el('span', { class: 'm-hint', text: 'Not a working day' }) : null,
      ]),
    ]));

    if (state.state === 'leave' || quiet) return card;

    const body = el('div', { class: 'm-day-body' });
    if (!planned.length) body.appendChild(el('p', { class: 'm-empty-day', text: 'Nothing planned' }));
    for (const entry of planned) body.appendChild(taskCard(entry, iso, ctx));

    /* A stored entry that is not what the sheet asks for. The one case worth
       drawing twice — somebody decided against the workbook — and the same rule
       the week plan draws it by. */
    const first = planned[0];
    if (first && !first.from_lookahead) {
      const linked = new Set(planned.map((e) => e.lookahead_row_id).filter(Boolean));
      const asked = (index.byPerson.get(person.id)?.get(iso) || []).filter((row) => !linked.has(row.id));
      for (const row of asked) {
        body.appendChild(el('div', { class: 'm-asked' }, [
          el('span', { class: 'rc-eyebrow', text: '4WLA also has you on' }),
          el('div', {
            text: [row.raw_label || `row ${row.sheet_row}`,
              ctx.locs.get(row.location_id)?.name || row.raw_location].filter(Boolean).join(' · '),
          }),
        ]));
      }
    }

    if (mayPlan && state.state === 'available') {
      body.appendChild(el('button', {
        class: 'cx-btn m-add',
        type: 'button',
        html: `${icon('plus', { size: 16 })}<span>${planned.length ? 'Add another task' : 'Add a task'}</span>`,
        'aria-label': `Add a task on ${dayLabel(iso, 'day')}`,
        onClick: () => addTask(iso, ctx),
      }));
    }
    card.appendChild(body);
    return card;
  }

  function taskCard(entry, iso, ctx) {
    const { person, locs, cats, mayPlan, outcomeFor, everybody } = ctx;
    const outcome = outcomeFor(entry, person.id, iso);
    const status = outcome ? STATUS_BY_ID.get(outcome.status) : null;
    const where = locs.get(entry.location_id)?.name || entry.raw_location;
    const shift = entry.shift && entry.shift !== 'day' ? shiftLabel(entry.shift) : null;

    const flags = [
      /* The workbook is the assumption, so only a day somebody typed carries a
         flag — the rule the week plan and the huddle follow. */
      !entry.from_lookahead && entry.id ? badge('Manual', 'warn') : null,
      entry.reassigned_from
        ? badge(`Reassigned from ${everybody.find((p) => p.id === entry.reassigned_from)?.name || 'somebody'}`, 'info')
        : null,
      entry.supersedes_id && !entry.reassigned_from ? badge('Revised', 'warn') : null,
      entry.carry_chain_id ? badge('Carried over', 'warn') : null,
    ].filter(Boolean);

    return el('article', {
      class: ['m-task', entry.absence ? 'm-task-away' : '', outcome ? `m-done m-done-${outcome.status}` : '']
        .filter(Boolean).join(' '),
    }, [
      el('div', { class: 'm-task-title', text: entry.task || '—' }),
      where || shift || entry.category_id
        ? el('div', { class: 'm-task-meta' }, [
          where ? el('span', { class: 'm-where', html: `${icon('pin', { size: 13 })}` }, [where]) : null,
          shift ? el('span', { text: shift }) : null,
          cats.get(entry.category_id)?.name ? el('span', { text: cats.get(entry.category_id).name }) : null,
        ])
        : null,
      flags.length ? el('div', { class: 'm-flags' }, flags) : null,
      /* How it went, from the huddle. Read-only: the meeting is where an outcome
         is recorded and there is one recording path. */
      outcome
        ? el('div', { class: 'm-outcome' }, [
          el('div', { class: 'm-outcome-head' }, [
            el('span', { class: 'rc-eyebrow', text: 'Recorded' }),
            badge(status?.label || outcome.status, status?.tone || 'neutral'),
          ]),
          outcome.task && outcome.task !== entry.task
            ? el('div', { class: 'm-hint', text: `Did: ${outcome.task}` }) : null,
          outcome.blocked_reason ? el('div', { class: 'm-hint', text: outcome.blocked_reason }) : null,
          outcome.note ? el('div', { class: 'm-hint', text: outcome.note }) : null,
          outcome.evidence_path
            ? el('button', {
              class: 'cx-btn mini ghost',
              type: 'button',
              html: `${icon('camera', { size: 13 })}<span>Photo</span>`,
              onClick: async () => {
                try {
                  window.open(await rc.evidenceUrl(outcome.evidence_path), '_blank', 'noopener');
                } catch (err) {
                  toast({ tone: 'bad', message: `That photograph could not be opened — ${err.message}` });
                }
              },
            })
            : null,
        ])
        : null,
      mayPlan
        ? el('div', { class: 'm-task-acts' }, [
          el('button', {
            class: 'cx-btn',
            type: 'button',
            html: `${icon('edit', { size: 14 })}<span>Change</span>`,
            'aria-label': `Change ${entry.task || 'this task'} on ${dayLabel(iso, 'day')}`,
            onClick: () => (entry.id ? revise(entry, iso, ctx) : override(entry, iso, ctx)),
          }),
          entry.id
            ? el('button', {
              class: 'cx-btn ghost danger',
              type: 'button',
              html: `${icon('trash', { size: 14 })}<span>Remove</span>`,
              'aria-label': `Remove ${entry.task || 'this task'} from ${dayLabel(iso, 'day')}`,
              onClick: () => withdraw(entry, iso, ctx),
            })
            : null,
        ])
        : null,
    ]);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Changing the plan
     ═══════════════════════════════════════════════════════════════════════ */

  /** The look-ahead rows a task on `iso` could be linked to. */
  function sheetRowsOn(iso, laRows) {
    return (laRows || []).filter((r) =>
      !Object.keys(r.cells || {}).length || r.cells?.[iso] || r.resources?.[iso]);
  }

  function rowLabel(row, locs) {
    return [row.raw_label, locs.get(row.location_id)?.name || row.raw_location]
      .filter(Boolean).join(' · ') || `row ${row.sheet_row}`;
  }

  /**
   * One form for the three writes.
   *
   * A bottom sheet on a phone (the stylesheet makes every modal one), with the
   * fields in the order somebody answers them: what, where, which shift, what kind
   * of work. `sheetRows` offers the look-ahead's rows for the day — picking one
   * fills the rest in and keeps the link, which is what later lets a block be
   * recorded against the row BART scheduled. `alsoOn` offers the week's other
   * working days, so one form covers a stint.
   */
  function taskForm({
    title, confirmLabel, values = {}, note = null, sheetRows = [], alsoOn = [], ctx, onSave,
  }) {
    const { locations, categories, locs } = ctx;

    const pick = sheetRows.length
      ? selectInput({
        value: values.lookahead_row_id && sheetRows.some((r) => r.id === values.lookahead_row_id)
          ? values.lookahead_row_id : '',
        placeholder: '— not from the look-ahead —',
        options: sheetRows.map((r) => ({ value: r.id, label: rowLabel(r, locs) })),
      })
      : null;
    const task = textInput({ value: values.task || '', placeholder: 'What you will do' });
    task.setAttribute('enterkeyhint', 'done');
    const location = selectInput({
      value: values.location_id || '',
      placeholder: '— not on site —',
      options: locations.map((l) => ({ value: l.id, label: l.name })),
    });
    let shift = values.shift || 'day';
    const shifts = segmented({
      value: shift,
      stretch: true,
      options: SHIFTS.map((s) => ({ value: s.id, label: s.label })),
      onChange: (value) => { shift = value; },
    });
    const category = selectInput({
      value: values.category_id || '',
      placeholder: '— none —',
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    });

    if (pick) {
      pick.addEventListener('change', () => {
        const row = sheetRows.find((r) => r.id === pick.value);
        if (!row) return;
        if (!task.value.trim()) task.value = row.raw_label || '';
        if (row.location_id) location.value = row.location_id;
      });
    }

    const chosen = new Set();
    const days = alsoOn.length
      ? el('div', { class: 'm-daychips', role: 'group', 'aria-label': 'Also on' }, alsoOn.map((iso) => {
        const chip = el('button', {
          class: 'm-chip',
          type: 'button',
          'aria-pressed': 'false',
          text: dayLabel(iso, 'day').replace(/,.*$/, ''),
          title: dayLabel(iso, 'dayFull'),
          onClick: () => {
            if (chosen.has(iso)) chosen.delete(iso);
            else chosen.add(iso);
            chip.setAttribute('aria-pressed', String(chosen.has(iso)));
          },
        });
        return chip;
      }))
      : null;

    formModal({
      title,
      body: el('div', { class: 'cx-form m-form' }, [
        note ? el('p', { class: 'm-note', text: note }) : null,
        pick ? field('From the look-ahead', pick) : null,
        field('Task', task),
        field('Where', location),
        field('Shift', shifts),
        field('Kind of work', category),
        days ? field('Also on', days, 'The same task on these days too — one entry per day.') : null,
      ].filter(Boolean)),
      confirmLabel,
      onConfirm: async () => {
        if (!task.value.trim()) throw new Error('Say what the task is.');
        await onSave({
          task: task.value.trim(),
          location_id: location.value || null,
          category_id: category.value || null,
          shift,
          lookahead_row_id: pick ? (pick.value || null) : (values.lookahead_row_id || null),
          days: [...chosen].sort(),
        });
      },
    });
  }

  /** A new entry on a day, and on any other days of the week ticked alongside it. */
  function addTask(iso, ctx) {
    const { person, days, leave, index, laRows } = ctx;
    const alsoOn = days.filter((d) => d !== iso
      && availability(person, d, leave, index.absent(person.id, d)).state === 'available');

    taskForm({
      title: `Add to ${dayLabel(iso, 'day')}`,
      confirmLabel: 'Add',
      sheetRows: sheetRowsOn(iso, laRows),
      alsoOn,
      ctx,
      onSave: async (v) => {
        const dates = [iso, ...v.days];
        await rc.addPlanEntries(dates.map((work_date) => ({
          person_id: person.id,
          work_date,
          shift: v.shift,
          location_id: v.location_id,
          task: v.task,
          category_id: v.category_id,
          lookahead_row_id: v.lookahead_row_id,
        })));
        notifyChanged('plan');
        toast({
          tone: 'good',
          message: dates.length === 1
            ? `Added to ${dayLabel(iso, 'day')}.`
            : `Added to ${dates.length} days.`,
        });
      },
    });
  }

  /**
   * Revise a stored entry. The version it replaces stays on the record, and an
   * entry somebody else revised first is refused rather than silently lost.
   */
  async function revise(entry, iso, ctx) {
    const history = await rc.planHistory(entry.person_id, iso).catch(() => []);
    const before = history.filter((h) => h.id !== entry.id && !h.withdrawn).length;
    taskForm({
      title: `Change ${dayLabel(iso, 'day')}`,
      confirmLabel: 'Save',
      values: entry,
      note: before
        ? `Changed ${before} time${before === 1 ? '' : 's'} before. Every version stays on the record.`
        : 'The version you replace stays on the record.',
      ctx,
      onSave: async (v) => {
        await rc.supersedePlan(entry.id, {
          locationId: v.location_id,
          task: v.task,
          categoryId: v.category_id,
          shift: v.shift,
        });
        notifyChanged('plan');
        toast({ tone: 'good', message: 'Saved.' });
      },
    });
  }

  /**
   * Change a day the 4WLA plans. There is no row to revise, so this writes the
   * first one — overriding the sheet for that day, which is exactly what it says.
   */
  function override(entry, iso, ctx) {
    const { person, laRows } = ctx;
    taskForm({
      title: `Change ${dayLabel(iso, 'day')}`,
      confirmLabel: 'Save my entry',
      values: entry,
      note: 'The look-ahead plans this day. Saving writes your own entry for it, which takes the '
        + 'sheet’s place for this day in the huddle and the week plan. The workbook itself is not '
        + 'changed.',
      sheetRows: entry.lookahead_row_id ? sheetRowsOn(iso, laRows) : [],
      ctx,
      onSave: async (v) => {
        await rc.addPlanEntries([{
          person_id: person.id,
          work_date: iso,
          shift: v.shift,
          location_id: v.location_id,
          task: v.task,
          category_id: v.category_id,
          lookahead_row_id: v.lookahead_row_id,
        }]);
        notifyChanged('plan');
        toast({ tone: 'good', message: 'Saved as your own entry for the day.' });
      },
    });
  }

  /** Take a stored task off the schedule. A tombstone, never a delete. */
  async function withdraw(entry, iso) {
    const ok = await confirmDialog({
      title: `Remove this from ${dayLabel(iso, 'day')}?`,
      message: 'It comes off the schedule. Nothing is deleted: the record keeps it as planned and '
        + 'then removed.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await rc.withdrawPlan(entry.id);
      notifyChanged('plan');
      toast({ tone: 'good', message: 'Removed. The record still has it.' });
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
  }

  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// mobile/lookahead.js
// ════════════════════════════════════════════════════════════════════════
__mods["mobile/lookahead.js"] = function (__x, __req) {
  /**
   * The look-ahead, one day at a time.
   *
   * On a laptop the 4WLA is drawn the way the workbook is — a hundred days across,
   * a hundred and forty rows down — because somebody has the spreadsheet open
   * beside it and the two must be recognisably the same thing. On a phone that is
   * a spreadsheet through a letterbox. So this asks the question somebody on site
   * actually has, "what is on, and who is on it", and answers it for one day:
   * `agendaFor()` in `core/lookahead.js`, over the same parse every other screen
   * reads (`parsedView()`), against the same legend.
   *
   * The strip across the top is the four weeks from this Monday — the window the
   * look-ahead is maintained for — with the day's count of work under each date.
   * "Only mine" narrows to the activities whose Resource row names the person
   * signed in, matched through the same register the week plan uses, so a first
   * name and a recorded alias count and a guess does not.
   *
   * Read-only for everybody, as the calendar is. Nothing here writes.
   *
   * Imports: util, dates, rc, core/lookahead, icons, components, rc_util.
   */

  const { el, clear } = __req("core/util.js");
  const { toISO, addDays, DAYS_SHORT } = __req("core/dates.js");
  const rc = __req("core/rc.js");
  const { agendaFor } = __req("core/lookahead.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, badge, emptyState } = __req("ui/components.js");
  const { parsedView, todayISO, weekStart, isoToMs, dayLabel, byId, foldName, nameRegister, nameResolver, locationRegister } = __req("ui/rc_util.js");




  let selected = null;
  let mineOnly = false;
  let filterText = '';

  async function render(root) {
    const me = rc.me();
    const [snapshot, legendRows, everybody, aliases, locations, locAliases] = await Promise.all([
      rc.latestSnapshot(),
      rc.listLegend(),
      rc.listPeople().catch(() => []),
      rc.listPersonAliases().catch(() => []),
      rc.listLocations({ includeInactive: true }).catch(() => []),
      rc.listLocationAliases().catch(() => []),
    ]);

    if (!snapshot?.grid?.rows?.length) {
      root.appendChild(emptyState({
        iconName: 'calendar',
        title: 'Nothing read yet',
        message: 'Nobody has read the look-ahead workbook into the calendar yet. Once an administrator '
          + 'has, it is here for everybody.',
      }));
      return;
    }

    const view = parsedView(snapshot, legendRows);
    const dated = view.days.filter((d) => d.date);
    if (!dated.length) {
      root.appendChild(emptyState({
        iconName: 'warning',
        title: 'No dates on this sheet',
        message: 'The workbook’s days could not be pinned to a year, so there is no "today" to '
          + 'show. The full calendar on a computer still draws it as the sheet writes it.',
      }));
      return;
    }

    /* The four weeks from this Monday, which is what a four-week look-ahead is
       for. A sheet wholly outside that — last month's, or one read far ahead —
       is shown whole rather than as nothing. */
    const today = todayISO();
    const monday = toISO(weekStart(isoToMs(today)));
    const last = toISO(addDays(isoToMs(monday), 27));
    const inWindow = dated.filter((d) => d.date >= monday && d.date <= last);
    const dates = (inWindow.length ? inWindow : dated).map((d) => d.date);
    if (!selected || !dates.includes(selected)) selected = dates.includes(today) ? today : dates[0];

    const resolve = nameResolver(nameRegister(everybody, aliases));
    const isMine = (name) => Boolean(me) && resolve(foldName(name)).id === me.id;
    const places = locationRegister(locations, locAliases);
    const locById = byId(locations);
    /* A place by the name the register gives it; the sheet's code where the
       register does not know it. The code is what the workbook types, not what
       anybody calls the site. */
    const placeName = (written) => {
      const found = locById.get(places.get(foldName(written)));
      return found ? found.name : written;
    };

    const agendas = new Map(dates.map((iso) => [iso, agendaFor(view, iso)]));
    const terms = () => filterText.toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
    const shows = (item) => {
      if (mineOnly && !item.names.some(isMine)) return false;
      const wanted = terms();
      if (!wanted.length) return true;
      const hay = [item.title, item.location, placeName(item.location), item.section, item.meaning,
        item.value, ...item.names, ...item.details.map((d) => d.value)].join(' ').toLowerCase();
      return wanted.some((t) => hay.includes(t));
    };

    /* ── Controls: drawn once, never rebuilt under the caret ──────────────── */

    root.appendChild(el('p', {
      class: 'm-note m-sheet-age',
      text: `From the workbook as read ${readAt(snapshot.taken_at)}.`,
    }));

    const strip = el('div', { class: 'm-strip', role: 'tablist', 'aria-label': 'Day' });
    const search = textInput({ value: filterText, placeholder: 'Filter this day', type: 'search' });
    search.setAttribute('aria-label', 'Filter the look-ahead');
    search.addEventListener('input', () => { filterText = search.value; draw(); });
    const mine = el('button', {
      class: 'm-chip m-mine-toggle',
      type: 'button',
      'aria-pressed': String(mineOnly),
      html: `${icon('user', { size: 14 })}<span>Only mine</span>`,
      onClick: () => {
        mineOnly = !mineOnly;
        mine.setAttribute('aria-pressed', String(mineOnly));
        draw();
      },
    });
    const agenda = el('div', { class: 'm-agenda' });

    root.append(
      strip,
      el('div', { class: 'm-la-controls' }, [search, me ? mine : null]),
      agenda,
    );

    /* A sideways swipe moves a day, which is how a phone expects to page. Only a
       clearly horizontal one: a vertical scroll that drifts must stay a scroll. */
    let touch = null;
    agenda.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      touch = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    agenda.addEventListener('touchend', (e) => {
      if (!touch) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      touch = null;
      if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return;
      const at = dates.indexOf(selected) + (dx < 0 ? 1 : -1);
      if (at >= 0 && at < dates.length) choose(dates[at]);
    }, { passive: true });

    function choose(iso) {
      selected = iso;
      draw();
      strip.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }

    function draw() {
      drawStrip();
      drawAgenda();
    }

    function drawStrip() {
      clear(strip);
      for (const iso of dates) {
        const ms = isoToMs(iso);
        const count = (agendas.get(iso)?.items || []).filter(shows).length;
        const d = new Date(ms);
        strip.appendChild(el('button', {
          class: ['m-strip-day', d.getUTCDay() === 1 ? 'm-strip-monday' : '', iso === today ? 'm-strip-today' : '',
            d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 'm-strip-weekend' : ''].filter(Boolean).join(' '),
          type: 'button',
          role: 'tab',
          'aria-selected': String(iso === selected),
          'aria-label': `${dayLabel(iso, 'dayFull')}, ${count} activit${count === 1 ? 'y' : 'ies'}`,
          onClick: () => choose(iso),
        }, [
          el('span', { class: 'm-strip-dow', text: DAYS_SHORT[d.getUTCDay()] }),
          el('span', { class: 'm-strip-num', text: String(d.getUTCDate()) }),
          el('span', { class: 'm-strip-count', text: count ? String(count) : '' }),
        ]));
      }
    }

    function drawAgenda() {
      clear(agenda);
      const day = agendas.get(selected);
      agenda.appendChild(el('h2', {
        class: 'm-agenda-title',
        text: dayLabel(selected, 'dayFull') + (selected === today ? ' · Today' : ''),
      }));

      const items = (day?.items || []).filter(shows);
      if (!items.length) {
        agenda.appendChild(el('p', {
          class: 'm-empty-day',
          text: mineOnly
            ? 'The look-ahead does not name you on anything this day.'
            : terms().length ? 'Nothing this day matches the filter.' : 'Nothing scheduled this day.',
        }));
      }

      let section = null;
      for (const item of items) {
        if (item.section && item.section !== section) {
          section = item.section;
          agenda.appendChild(el('div', { class: 'rc-eyebrow m-section', text: section }));
        }
        agenda.appendChild(itemCard(item));
      }

      const away = (day?.away || []).filter((a) => !mineOnly || a.names.some(isMine));
      if (away.length) {
        agenda.appendChild(el('div', { class: 'rc-eyebrow m-section', text: 'Not on site' }));
        agenda.appendChild(el('div', { class: 'm-away' }, away.map((a) => el('div', { class: 'm-away-row' }, [
          el('span', { class: `m-away-kind m-away-${a.kind}`, text: a.label }),
          el('span', { class: 'm-names' }, a.names.map(nameChip)),
        ]))));
      }
    }

    function nameChip(name) {
      return el('span', { class: 'm-name' + (isMine(name) ? ' m-name-me' : ''), text: name });
    }

    function itemCard(item) {
      const where = item.location ? placeName(item.location) : '';
      return el('article', {
        class: ['m-la-item', item.cancelled ? 'm-cancelled' : '', item.names.some(isMine) ? 'm-mine' : '']
          .filter(Boolean).join(' '),
      }, [
        /* The workbook's own colour, which is data rather than a theme value —
           the same thing the grid on a computer paints its cells with. */
        el('span', {
          class: 'm-swatch' + (item.hex ? '' : ' m-swatch-none'),
          style: item.hex ? `background:#${item.hex}` : null,
          'aria-hidden': 'true',
        }),
        el('div', { class: 'm-la-body' }, [
          el('div', { class: 'm-la-title', text: item.title || '—' }),
          el('div', { class: 'm-task-meta' }, [
            where ? el('span', { class: 'm-where', html: icon('pin', { size: 13 }) }, [where]) : null,
            item.cancelled
              ? badge(item.meaning || 'Cancelled', 'bad')
              : item.meaning ? el('span', { text: item.meaning })
                : item.hex ? el('span', { class: 'm-hint', text: 'Colour not in the legend' }) : null,
            item.value && !/^x$/i.test(item.value) ? el('span', { class: 'm-mono', text: item.value }) : null,
          ]),
          item.names.length ? el('div', { class: 'm-names' }, item.names.map(nameChip)) : null,
          item.details.length
            ? el('details', { class: 'm-details' }, [
              el('summary', { text: 'Details' }),
              el('dl', {}, item.details.flatMap((d) => [
                el('dt', { text: d.heading || '—' }),
                el('dd', { text: d.value }),
              ])),
            ])
            : null,
        ]),
      ]);
    }

    draw();
    requestAnimationFrame(() => {
      strip.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
  }

  /**
   * How stale the sheet is, as an age rather than a clock time. An age needs no
   * timezone, and "read 3 days ago" is the fact somebody on site can act on.
   */
  function readAt(takenAt) {
    const ms = Date.parse(takenAt || '');
    if (!Number.isFinite(ms)) return 'earlier';
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 2) return 'just now';
    if (minutes < 60) return `${minutes} minutes ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// mobile/timeoff.js
// ════════════════════════════════════════════════════════════════════════
__mods["mobile/timeoff.js"] = function (__x, __req) {
  /**
   * PTO — asking for time off from a phone, and seeing the answer.
   *
   * The same single `rc_leave` row the desktop's PTO tab writes, never a second
   * list: a request is the row it will become, with `status = 'requested'` saying
   * nobody has answered it yet (`rc.requestLeave()`). The policies are what make
   * that safe — a member may insert `requested` for themselves and nobody else, and
   * the only change they may make afterwards is to withdraw it while it is still
   * unanswered — so this draws what the database allows and nothing more. An
   * administrator's own entry is booked straight away, as the desktop books it.
   *
   * A request is not leave yet. `availability()` carries it as `asked`, so My week
   * shows "Leave requested" on those days without taking them out of the plan;
   * approving it on a computer turns the same row into leave everywhere at once.
   *
   * Imports: util, dates, rc, icons, components, rc_util.
   */

  const { el } = __req("core/util.js");
  const { MS_DAY } = __req("core/dates.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, selectInput, toast, badge, field, confirmDialog } = __req("ui/components.js");
  const { todayISO, dayLabel, isoToMs, byId, notifyChanged, formModal } = __req("ui/rc_util.js");

  /** What each answer is called, in the words of somebody waiting for one. */
  const ANSWERS = {
    requested: { label: 'Waiting for approval', tone: 'warn' },
    approved: { label: 'Approved', tone: 'good' },
    declined: { label: 'Declined', tone: 'bad' },
  };

  async function render(root) {
    const me = rc.me();
    const today = todayISO();
    const [rows, kinds, people] = await Promise.all([
      rc.leaveFor(me.id, today),
      rc.listLeaveKinds().catch(() => []),
      rc.listPeople().catch(() => []),
    ]);
    const admin = rc.isAdmin();
    // The roster row, for the working days; `me()` carries the account, not them.
    const self = people.find((p) => p.id === me.id) || me;
    const kindById = byId(kinds);

    if (rc.canWrite()) {
      root.appendChild(el('button', {
        class: 'cx-btn primary m-wide',
        type: 'button',
        html: `${icon('plus', { size: 16 })}<span>Request PTO</span>`,
        onClick: () => requestForm({ self, kinds, admin, existing: rows }),
      }));
      root.appendChild(el('p', {
        class: 'm-note m-under',
        text: admin
          ? 'As an administrator, what you enter here is booked straight away.'
          : 'It goes to an administrator as a request. You can withdraw it until it is answered.',
      }));
    } else {
      root.appendChild(el('p', { class: 'm-note', text: 'Your account can read the calendar but not change it.' }));
    }

    root.appendChild(el('h2', { class: 'm-card-title m-list-title', text: 'Your PTO' }));
    if (!rows.length) {
      root.appendChild(el('p', { class: 'm-empty-day', text: 'Nothing booked or requested from today on.' }));
      return;
    }
    root.appendChild(el('div', { class: 'm-leave-list' },
      rows.map((row) => leaveCard(row, { kindById, self }))));
  }

  function leaveCard(row, { kindById, self }) {
    const answer = ANSWERS[row.status] || { label: row.status, tone: 'neutral' };
    const days = workingDays(self, row.start_date, row.end_date);
    return el('article', { class: `m-leave m-leave-${row.status}` }, [
      el('div', { class: 'm-leave-head' }, [
        el('div', { class: 'm-task-title', text: span(row.start_date, row.end_date) }),
        badge(answer.label, answer.tone),
      ]),
      el('div', { class: 'm-task-meta' }, [
        el('span', { text: kindById.get(row.kind_id)?.name || 'Time off' }),
        el('span', { text: `${days} working day${days === 1 ? '' : 's'}` }),
      ]),
      row.note ? el('div', { class: 'm-hint', text: row.note }) : null,
      row.status === 'requested' && rc.canWrite()
        ? el('div', { class: 'm-task-acts' }, [
          el('button', {
            class: 'cx-btn ghost danger',
            type: 'button',
            html: `${icon('x', { size: 14 })}<span>Withdraw</span>`,
            'aria-label': `Withdraw the request for ${span(row.start_date, row.end_date)}`,
            onClick: () => withdraw(row),
          }),
        ])
        : null,
    ]);
  }

  /** "Mon, Oct 12 – Fri, Oct 16, 2026", or the one day. */
  function span(from, to) {
    return from === to ? dayLabel(from, 'dayFull') : `${dayLabel(from, 'day')} – ${dayLabel(to, 'dayFull')}`;
  }

  /** The days in a span somebody would otherwise have worked — what they are asking for. */
  function workingDays(person, from, to) {
    const working = Array.isArray(person?.working_days) ? person.working_days : [1, 2, 3, 4, 5];
    let n = 0;
    for (let ms = isoToMs(from); ms <= isoToMs(to); ms += MS_DAY) {
      if (working.includes(new Date(ms).getUTCDay() || 7)) n++;
    }
    return n;
  }

  function requestForm({ self, kinds, admin, existing }) {
    const today = todayISO();
    const start = el('input', { type: 'date', class: 'cx-input' });
    const end = el('input', { type: 'date', class: 'cx-input' });
    start.value = today;
    end.value = today;
    // Moving the start past the end drags the end with it: the commonest request
    // is one day, and the second commonest is a run starting where it was set.
    start.addEventListener('change', () => {
      if (!end.value || end.value < start.value) end.value = start.value;
    });
    const kind = selectInput({
      value: kinds[0]?.id || '',
      options: kinds.map((k) => ({ value: k.id, label: k.name })),
    });
    const note = textInput({ placeholder: 'Optional' });

    formModal({
      title: admin ? 'Book PTO' : 'Request PTO',
      body: el('div', { class: 'cx-form m-form' }, [
        field('From', start),
        field('To', end, 'The last day you are off.'),
        kinds.length ? field('Kind', kind) : null,
        field('Note', note),
      ].filter(Boolean)),
      confirmLabel: admin ? 'Book it' : 'Send request',
      onConfirm: async () => {
        if (!start.value || !end.value) throw new Error('Both dates are needed.');
        if (end.value < start.value) throw new Error('The last day is before the first.');
        if (!workingDays(self, start.value, end.value)) {
          throw new Error('None of those days is one you work, so there is nothing to take off.');
        }
        /* A second request over days already asked for or booked is the same
           question twice, and whoever answers it would have to notice. */
        const clash = existing.find((r) => r.status !== 'declined'
          && r.start_date <= end.value && r.end_date >= start.value);
        if (clash) {
          throw new Error(`You already have PTO over those days: ${span(clash.start_date, clash.end_date)}.`);
        }
        const row = {
          person_id: self.id,
          start_date: start.value,
          end_date: end.value,
          kind_id: kind.value || null,
          note: note.value.trim() || null,
        };
        if (admin) await rc.addLeave({ ...row, status: 'approved' });
        else await rc.requestLeave(row);
        notifyChanged('leave');
        toast({
          tone: 'good',
          message: admin ? 'Booked.' : 'Sent. It shows as waiting until an administrator answers it.',
        });
      },
    });
  }

  async function withdraw(row) {
    const ok = await confirmDialog({
      title: 'Withdraw this request?',
      message: `${span(row.start_date, row.end_date)}. Nobody has answered it yet, so it simply comes off `
        + 'the list — you can ask again later.',
      confirmLabel: 'Withdraw',
      danger: true,
    });
    if (!ok) return;
    try {
      await rc.updateLeave(row.id, { status: 'cancelled' });
      notifyChanged('leave');
      toast({ tone: 'good', message: 'Withdrawn.' });
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
  }

  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// mobile/more.js
// ════════════════════════════════════════════════════════════════════════
__mods["mobile/more.js"] = function (__x, __req) {
  /**
   * More — the account, how it looks, and putting it on the home screen.
   *
   * Installing is the one thing here that differs by phone, and it is said per
   * phone rather than in general: Android's browsers offer an install dialog the
   * page can open, an iPhone installs only from Safari's Share menu, and a phone
   * that already has it installed needs to be told nothing at all.
   *
   * Imports: util, rc, icons, components, theme, pwa.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { segmented, toast } = __req("ui/components.js");
  const { THEME_CHOICES, themePreference, setThemePreference } = __req("mobile/theme.js");
  const { isInstalled, canPrompt, promptInstall, isIos, onInstallChange } = __req("mobile/pwa.js");

  const ROLES = {
    admin: 'Administrator — you can plan anybody’s days.',
    member: 'Member — you can plan your own days.',
    viewer: 'Viewer — you can read the calendar but not change it.',
  };

  let stopListening = null;

  function render(root) {
    const me = rc.me();
    const account = rc.currentUser();

    root.appendChild(card('Account', [
      el('div', { class: 'm-account' }, [
        el('div', { class: 'm-avatar', text: initials(me?.name || account?.email || '?') }),
        el('div', {}, [
          el('div', { class: 'm-account-name', text: me?.name || rc.accountLabel() }),
          account?.email ? el('div', { class: 'm-hint', text: account.email }) : null,
        ]),
      ]),
      el('p', { class: 'm-note', text: ROLES[rc.role()] || '' }),
      el('button', {
        class: 'cx-btn m-wide',
        type: 'button',
        html: `${icon('logout', { size: 16 })}<span>Sign out</span>`,
        onClick: async () => {
          await rc.signOut();
          toast({ message: 'Signed out.' });
        },
      }),
    ]));

    root.appendChild(card('Appearance', [
      segmented({
        value: themePreference(),
        stretch: true,
        options: THEME_CHOICES.map((c) => ({ value: c.value, label: c.label })),
        onChange: (value) => setThemePreference(value),
      }),
      el('p', { class: 'm-note', text: '"Phone" follows the light or dark setting of the phone itself.' }),
    ]));

    /* Only while there is something to do about it. Once the app is on the home
       screen the card has nothing left to say, and a card saying so is a card
       somebody reads every time for no reason. */
    const install = el('div');
    const installCard = card('On this phone', [install]);
    const drawInstall = () => {
      clear(install);
      installCard.hidden = isInstalled();
      if (!installCard.hidden) install.append(...installHelp());
    };
    drawInstall();
    stopListening?.();
    stopListening = onInstallChange(() => {
      if (install.isConnected) drawInstall();
    });
    root.appendChild(installCard);

    root.appendChild(card('Everything else', [
      el('p', {
        class: 'm-note',
        text: 'The daily huddle, PTO, reports, the full look-ahead grid and the timeline are on the '
          + 'full site, on a computer. This app is your week and the look-ahead, and nothing of the '
          + 'timeline’s plan is ever loaded on a phone.',
      }),
      el('a', {
        class: 'cx-btn ghost m-wide',
        href: '../',
        html: `${icon('external', { size: 16 })}<span>Open the full site</span>`,
      }),
    ]));
  }

  function card(title, children) {
    return el('section', { class: 'm-card' }, [
      el('h2', { class: 'm-card-title', text: title }),
      ...children,
    ]);
  }

  function initials(name) {
    const words = String(name).replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
    return (words[0]?.[0] || '?').toUpperCase() + (words[1]?.[0] || '').toUpperCase();
  }

  function installHelp() {
    if (canPrompt()) {
      return [
        el('p', { class: 'm-note', text: 'Put it on your home screen so it opens like an app, full screen.' }),
        el('button', {
          class: 'cx-btn primary m-wide',
          type: 'button',
          html: `${icon('download', { size: 16 })}<span>Install the app</span>`,
          onClick: async () => {
            const outcome = await promptInstall();
            if (outcome === 'accepted') toast({ tone: 'good', message: 'Installed.' });
          },
        }),
      ];
    }
    if (isIos()) {
      return [el('ol', { class: 'm-steps' }, [
        el('li', { text: 'Open this page in Safari.' }),
        el('li', { text: 'Tap the Share button.' }),
        el('li', { text: 'Choose "Add to Home Screen".' }),
      ])];
    }
    return [el('p', {
      class: 'm-note',
      text: 'Use your browser’s menu and choose "Install app" or "Add to Home screen" to open it '
        + 'like an app.',
    })];
  }

  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// mobile/shell.js
// ════════════════════════════════════════════════════════════════════════
__mods["mobile/shell.js"] = function (__x, __req) {
  /**
   * The phone app's chrome: a header, a view, and a tab bar under the thumb.
   *
   * Four tabs, because that is what the phone is for. **My week** is the reason
   * anybody opens it — what am I on, where, and did the meeting record how it
   * went — and where somebody changes their own plan. **Look-ahead** is the sheet
   * read one day at a time. **PTO** asks for time off and shows the answer.
   * **More** is the account and the install. The huddle, answering leave, reports,
   * the organisation and the timeline stay on a computer: they are an
   * administrator's screens or a wall-sized plan, and the build refuses to link
   * them into this bundle at all (`tools/build.js`).
   *
   * The account states — no backend, signed out, not on the team — are the
   * desktop calendar's own (`ui/rc_gate.js`), so there is one door and not two.
   *
   * Every read goes through `core/rc.js`, the same client, the same thirty-second
   * memory and the same forgetting on every write; the phone keeps no copy of the
   * calendar of its own. A write anywhere emits `RC_CHANGED` and whatever is on
   * screen re-reads, keeping its scroll position, because a list that jumps to the
   * top after every edit is a list nobody can edit twice.
   *
   * Imports: util, events, rc, icons, components, rc_gate, and the three views.
   */

  const { el, clear } = __req("core/util.js");
  const { on, EV } = __req("core/events.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { emptyState } = __req("ui/components.js");
  const { notConfigured, signInForm, notOnTheTeam } = __req("ui/rc_gate.js");
  const week = __req("mobile/week.js");
  const lookahead = __req("mobile/lookahead.js");
  const timeoff = __req("mobile/timeoff.js");
  const more = __req("mobile/more.js");

  const TABS = [
    { id: 'week', label: 'My week', icon: 'calendar-check', render: week.render },
    { id: 'lookahead', label: 'Look-ahead', icon: 'calendar', render: lookahead.render },
    { id: 'pto', label: 'PTO', icon: 'sun', render: timeoff.render },
    { id: 'more', label: 'More', icon: 'user', render: more.render },
  ];

  let head = null;
  let main = null;
  let nav = null;
  let active = tabFromHash() || 'week';
  let ready = false;
  let generation = 0;

  /** Build the chrome and start. Called once, by `mobile.js`. */
  function start() {
    head = document.getElementById('m-head');
    main = document.getElementById('m-main');
    nav = document.getElementById('m-tabs');
    if (!head || !main || !nav) return;
    document.body.classList.add('m-app');

    on(EV.RC_CHANGED, () => render({ keepScroll: true }));
    on(EV.RC_AUTH_CHANGED, () => render());
    window.addEventListener('online', () => { renderHead(); render({ keepScroll: true }); });
    window.addEventListener('offline', renderHead);
    window.addEventListener('hashchange', () => {
      const tab = tabFromHash();
      if (tab && tab !== active) show(tab);
    });

    render();
    rc.init()
      .catch((err) => console.warn('[cx-calendar] the calendar could not be reached:', err.message))
      .finally(() => {
        ready = true;
        render();
      });
  }

  /** Switch tab. Written into the address so a reload comes back to it. */
  function show(id) {
    if (!TABS.some((t) => t.id === id)) return;
    active = id;
    // Replace rather than push: the phone's back button should leave the app,
    // not walk back through every tab somebody tapped.
    if (onTheTeam()) history.replaceState(null, '', `#${id}`);
    render();
    main.scrollTop = 0;
  }

  function tabFromHash() {
    const id = (window.location.hash || '').replace(/^#\/?/, '');
    return TABS.some((t) => t.id === id) ? id : null;
  }

  function onTheTeam() {
    return rc.isConfigured() && ready && rc.isSignedIn() && Boolean(rc.me());
  }

  /* ── Drawing ───────────────────────────────────────────────────────────── */

  function render({ keepScroll = false } = {}) {
    if (!main) return;
    renderHead();
    renderNav();
    const scroll = keepScroll ? main.scrollTop : 0;
    clear(main);

    if (!rc.isConfigured()) {
      main.appendChild(notConfigured({
        message: 'This site was published without a resource calendar, so there is nothing for the '
          + 'phone app to show. The calendar is configured in config.js as rcSupabaseUrl and '
          + 'rcSupabaseAnonKey.',
      }));
      return;
    }
    if (!ready) {
      main.appendChild(loading());
      return;
    }
    if (!rc.isSignedIn()) {
      main.appendChild(signInForm({
        onDone: () => render(),
        blurb: 'Your week and the look-ahead, on your phone. It is the same account as the '
          + 'calendar on a computer.',
      }));
      return;
    }
    if (!rc.me()) {
      main.appendChild(notOnTheTeam());
      return;
    }

    const view = el('div', { class: 'm-view', 'data-view': active });
    main.appendChild(view);
    const mine = ++generation;
    const tab = TABS.find((t) => t.id === active);
    Promise.resolve(tab.render(view, { show }))
      .then(() => {
        if (mine === generation && keepScroll) main.scrollTop = scroll;
      })
      .catch((err) => {
        // A newer render has replaced this one; its failure is nobody's concern.
        if (mine !== generation) return;
        clear(view);
        view.appendChild(loadFailed(err));
      });
  }

  function renderHead() {
    if (!head) return;
    clear(head);
    const tab = TABS.find((t) => t.id === active);
    /* Filtered, because `append(null)` inserts the word "null" — `el()` drops an
       absent child and a raw `append()` does not. */
    head.append(...[
      el('div', { class: 'm-brand', 'aria-hidden': 'true' }),
      el('div', { class: 'm-head-text' }, [
        el('div', { class: 'rc-eyebrow', text: 'CX Calendar' }),
        el('h1', { class: 'm-head-title', text: onTheTeam() ? tab.label : 'Resource calendar' }),
      ]),
      /* Said in the chrome rather than discovered by a failed read: on site the
         signal comes and goes, and a list that silently stopped updating reads as
         a list with nothing new in it. */
      navigator.onLine === false
        ? el('span', { class: 'm-offline', role: 'status', text: 'Offline' })
        : null,
      onTheTeam()
        ? el('button', {
          class: 'cx-btn icon ghost m-head-btn',
          'aria-label': 'Reload from the calendar',
          title: 'Reload from the calendar',
          html: icon('refresh', { size: 18 }),
          onClick: () => {
            rc.forgetReads();
            render({ keepScroll: true });
          },
        })
        : null,
    ].filter(Boolean));
  }

  function renderNav() {
    if (!nav) return;
    clear(nav);
    nav.hidden = !onTheTeam();
    if (nav.hidden) return;
    for (const tab of TABS) {
      nav.appendChild(el('button', {
        class: 'm-tab',
        type: 'button',
        'aria-current': tab.id === active ? 'page' : null,
        onClick: () => show(tab.id),
      }, [
        el('span', { class: 'm-tab-icon', html: icon(tab.icon, { size: 22 }) }),
        el('span', { class: 'm-tab-label', text: tab.label }),
      ]));
    }
  }

  function loading() {
    return el('div', { class: 'm-loading', role: 'status', 'aria-live': 'polite' }, [
      el('div', { class: 'm-spinner', 'aria-hidden': 'true' }),
      el('span', { text: 'Opening the calendar…' }),
    ]);
  }

  /**
   * A read that failed, said in words somebody on site can act on.
   *
   * Offline is the common case and it is not an error: the app is on the phone,
   * the calendar is not, and the honest answer is to say so and offer to try
   * again rather than show whatever was on screen last as though it were current.
   */
  function loadFailed(err) {
    const offline = navigator.onLine === false || /fetch|network/i.test(String(err?.message || err));
    return emptyState({
      iconName: offline ? 'wifi' : 'warning',
      title: offline ? 'No connection to the calendar' : 'Could not load',
      message: offline
        ? 'The app is on your phone; the calendar is not. It will load again as soon as there is '
          + 'signal — nothing here is shown from an old copy.'
        : String(err?.message || err),
      action: {
        label: 'Try again',
        onClick: () => {
          rc.forgetReads();
          render();
        },
      },
    });
  }

  Object.defineProperty(__x, "start", { get: () => start, enumerable: true });
  Object.defineProperty(__x, "show", { get: () => show, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// mobile.js
// ════════════════════════════════════════════════════════════════════════
__mods["mobile.js"] = function (__x, __req) {
  /**
   * The phone app's entry point — `m/index.html` loads the bundle built from here.
   *
   * The resource calendar for somebody in the field: their week, the look-ahead,
   * and the way to change their own plan. It is a second entry rather than a mode
   * of `main.js` so that what it leaves out is left out of the file itself: the
   * timeline, the plan's storage and everything that reads a plan are refused by
   * the linker (`tools/build.js`), not merely hidden. A phone that talks to
   * Supabase never has the P6 project's code path on it at all.
   *
   * The bundle is loaded from `<head>`, so the theme is set before anything is
   * painted — the content-security policy allows no inline script, which is the
   * usual place for that — and the shell waits for the body it draws into.
   *
   * Imports: mobile/theme, mobile/pwa, mobile/shell.
   */

  const { applyTheme, followSystem } = __req("mobile/theme.js");
  const { installPwa } = __req("mobile/pwa.js");
  const { start } = __req("mobile/shell.js");

  applyTheme();
  followSystem();

  const go = () => {
    installPwa();
    start();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
  else go();


};


  __req("mobile.js");
})();
