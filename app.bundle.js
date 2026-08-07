/*!
 * CX Timeline — Interactive Timeline & Commissioning Planner
 *
 * GENERATED FILE — do not edit by hand.
 * Built from the ES modules in src/ by tools/build.js (`npm run build`).
 * Modules: 39   Built: 2026-08-07T02:06:24.307Z
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

    /* Persistence */
    SAVE_START: 'save:start',
    SAVE_DONE: 'save:done',
    SAVE_ERROR: 'save:error',
    BACKUP_MADE: 'backup:made',

    /* History */
    HISTORY_CHANGED: 'history:changed', // { canUndo, canRedo, depth }

    /* Account & sharing (hosted deployments only) */
    AUTH_CHANGED: 'auth:changed', // { user } — signed in, signed out, session restored
    ACCESS_CHANGED: 'access:changed', // { role, readOnly } — which project, and what you may do
    EDIT_REFUSED: 'access:refused', // a write was attempted without permission
    CLOUD_CONFLICT: 'cloud:conflict', // someone else saved the project first

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
    if (n === 0) return '0d';
    if (n < 14) return `${sign}${n}d`;
    if (n < 70) {
      const w = Math.floor(n / 7);
      const d = n % 7;
      return `${sign}${w}w${d ? ` ${d}d` : ''}`;
    }
    if (n < 730) return `${sign}${Math.round(n / 30.44)}mo`;
    return `${sign}${(n / 365.25).toFixed(1)}y`;
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
  Object.defineProperty(__x, "addWorkingDays", { get: () => addWorkingDays, enumerable: true });
  Object.defineProperty(__x, "isoWeek", { get: () => isoWeek, enumerable: true });
  Object.defineProperty(__x, "quarterOf", { get: () => quarterOf, enumerable: true });
  Object.defineProperty(__x, "DATE_ORDERS", { get: () => DATE_ORDERS, enumerable: true });
  Object.defineProperty(__x, "setDateOrder", { get: () => setDateOrder, enumerable: true });
  Object.defineProperty(__x, "getDateOrder", { get: () => getDateOrder, enumerable: true });
  Object.defineProperty(__x, "fmtDate", { get: () => fmtDate, enumerable: true });
  Object.defineProperty(__x, "fmtDuration", { get: () => fmtDuration, enumerable: true });
  Object.defineProperty(__x, "fmtRelative", { get: () => fmtRelative, enumerable: true });
  Object.defineProperty(__x, "fmtTimestamp", { get: () => fmtTimestamp, enumerable: true });
  Object.defineProperty(__x, "SCALES", { get: () => SCALES, enumerable: true });
  Object.defineProperty(__x, "coarserScale", { get: () => coarserScale, enumerable: true });
  Object.defineProperty(__x, "ticks", { get: () => ticks, enumerable: true });
  Object.defineProperty(__x, "snap", { get: () => snap, enumerable: true });
  Object.defineProperty(__x, "overlaps", { get: () => overlaps, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// core/model.js
// ════════════════════════════════════════════════════════════════════════
__mods["core/model.js"] = function (__x, __req) {
  /**
   * The document model: schema, type registry, factories, validation and
   * forward migration.
   *
   * A CX Timeline project is a single plain-JSON document. Everything the
   * application can do is a transformation of this structure, which is what
   * makes undo, autosave, baselines, export and import all fall out of one
   * mechanism instead of five.
   *
   * Imports: util, dates (leaves only).
   */

  const { uid, deepClone, clamp } = __req("core/util.js");
  const { toMs, toISO, todayMs, addDays, MS_DAY, startOfMonth, addMonths } = __req("core/dates.js");

  /** Bump when the document shape changes; add a step to `MIGRATIONS`. */
  const SCHEMA_VERSION = 2;

  /* ══════════════════════════════════════════════════════════════════════════
     Object type registry
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Every timeline object declares its behaviour here rather than in scattered
   * `if (type === …)` branches. `shape` drives rendering, `duration` decides
   * whether the object is a bar or a point in time, `fields` drives the
   * type-specific section of the property inspector.
   */
  const TYPES = {
    activity: {
      label: 'Activity',
      group: 'Schedule',
      icon: 'activity',
      shape: 'bar',
      duration: true,
      accent: 'var(--type-activity)',
      defaultDays: 14,
      progress: true,
      fields: ['owner', 'subsystem', 'area', 'status', 'progress'],
    },
    milestone: {
      label: 'Milestone',
      group: 'Schedule',
      icon: 'flag',
      shape: 'diamond',
      duration: false,
      accent: 'var(--type-milestone)',
      defaultDays: 0,
      progress: false,
      fields: ['owner', 'subsystem', 'status'],
    },
    release: {
      label: 'Software Release',
      group: 'Delivery',
      icon: 'package',
      shape: 'release',
      duration: false,
      accent: 'var(--type-release)',
      defaultDays: 0,
      progress: false,
      fields: ['version', 'releaseNumber', 'buildNumber', 'owner', 'subsystem', 'status', 'approval'],
    },
    campaign: {
      label: 'Commissioning Campaign',
      group: 'Commissioning',
      icon: 'target',
      shape: 'bar',
      duration: true,
      accent: 'var(--type-campaign)',
      defaultDays: 21,
      progress: true,
      fields: ['area', 'subsystem', 'testPackage', 'owner', 'actualStart', 'actualEnd', 'progress', 'status'],
    },
    testwindow: {
      label: 'Test Window',
      group: 'Commissioning',
      icon: 'clipboard',
      shape: 'bar',
      duration: true,
      accent: 'var(--type-activity)',
      defaultDays: 10,
      progress: true,
      fields: ['testKind', 'subsystem', 'area', 'owner', 'progress', 'status'],
    },
    freeze: {
      label: 'Freeze Period',
      group: 'Commissioning',
      icon: 'lock',
      shape: 'band',
      duration: true,
      accent: 'var(--type-freeze)',
      defaultDays: 7,
      progress: false,
      fields: ['owner', 'status'],
    },
    outage: {
      label: 'Outage',
      group: 'Operations',
      icon: 'zap',
      shape: 'band',
      duration: true,
      accent: 'var(--type-outage)',
      defaultDays: 2,
      progress: false,
      fields: ['area', 'owner', 'status'],
    },
    maintenance: {
      label: 'Maintenance Window',
      group: 'Operations',
      icon: 'wrench',
      shape: 'band',
      duration: true,
      accent: 'var(--type-outage)',
      defaultDays: 1,
      progress: false,
      fields: ['area', 'owner', 'status'],
    },
    customer: {
      label: 'Customer Activity',
      group: 'Operations',
      icon: 'users',
      shape: 'bar',
      duration: true,
      accent: 'var(--type-campaign)',
      defaultDays: 5,
      progress: true,
      fields: ['owner', 'area', 'status', 'progress'],
    },
    risk: {
      label: 'Risk',
      group: 'Assurance',
      icon: 'alert',
      shape: 'marker',
      duration: false,
      accent: 'var(--type-risk)',
      defaultDays: 0,
      progress: false,
      fields: ['owner', 'subsystem', 'severity', 'likelihood', 'mitigation', 'status'],
    },
    issue: {
      label: 'Open Issue',
      group: 'Assurance',
      icon: 'bug',
      shape: 'marker',
      duration: false,
      accent: 'var(--type-issue)',
      defaultDays: 0,
      progress: false,
      fields: ['owner', 'subsystem', 'severity', 'reference', 'status'],
    },
    decision: {
      label: 'Decision',
      group: 'Assurance',
      icon: 'scale',
      shape: 'marker',
      duration: false,
      accent: 'var(--type-decision)',
      defaultDays: 0,
      progress: false,
      fields: ['owner', 'status', 'reference'],
    },
    document: {
      label: 'Document',
      group: 'Assurance',
      icon: 'file',
      shape: 'marker',
      duration: false,
      accent: 'var(--type-document)',
      defaultDays: 0,
      progress: false,
      fields: ['owner', 'reference', 'status'],
    },
    note: {
      label: 'Sticky Note',
      group: 'Annotation',
      icon: 'comment',
      shape: 'sticky',
      duration: true,
      accent: 'var(--type-note)',
      defaultDays: 10,
      progress: false,
      fields: [],
    },
    callout: {
      label: 'Callout',
      group: 'Annotation',
      icon: 'bulb',
      shape: 'callout',
      duration: true,
      accent: 'var(--type-note)',
      defaultDays: 8,
      progress: false,
      fields: [],
    },
    text: {
      label: 'Text Box',
      group: 'Annotation',
      icon: 'type',
      shape: 'text',
      duration: true,
      accent: 'var(--type-container)',
      defaultDays: 14,
      progress: false,
      fields: [],
    },
    shape: {
      label: 'Shape',
      group: 'Annotation',
      icon: 'square',
      shape: 'shape',
      duration: true,
      accent: 'var(--type-container)',
      defaultDays: 10,
      progress: false,
      fields: [],
    },
    image: {
      label: 'Image',
      group: 'Annotation',
      icon: 'image',
      shape: 'image',
      duration: true,
      accent: 'var(--type-container)',
      defaultDays: 10,
      progress: false,
      fields: [],
    },
    container: {
      label: 'Container',
      group: 'Annotation',
      icon: 'layers',
      shape: 'container',
      duration: true,
      accent: 'var(--type-container)',
      defaultDays: 60,
      progress: false,
      fields: ['owner'],
    },
  };

  const TYPE_IDS = Object.keys(TYPES);

  /** Types grouped for menus, preserving registry order. */
  function typeGroups() {
    const groups = new Map();
    for (const [id, def] of Object.entries(TYPES)) {
      if (!groups.has(def.group)) groups.set(def.group, []);
      groups.get(def.group).push({ id, ...def });
    }
    return Array.from(groups, ([name, items]) => ({ name, items }));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Status vocabulary
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Editable vocabularies.
   *
   * Status, subsystem, test type and the rest are *project data*, not constants:
   * every organisation runs a different set, so the lists below are only the
   * seed. They are copied into `doc.lists` when a project is created, and from
   * then on the user can add, rename, recolour, reorder and delete options —
   * changes that are undoable, autosaved and exported with the plan like
   * anything else.
   *
   * Read them through `listOptions()` / `statusOf()` and friends rather than
   * touching these tables directly, so a project's own edits are honoured.
   */

  const DEFAULT_LISTS = {
    status: [
      { id: 'planned', label: 'Planned', color: 'var(--info)', tone: 'info' },
      { id: 'testing', label: 'Testing', color: 'var(--warn)', tone: 'warn' },
      { id: 'inprogress', label: 'In Progress', color: 'var(--warn)', tone: 'warn' },
      { id: 'released', label: 'Released', color: 'var(--good)', tone: 'good' },
      { id: 'complete', label: 'Complete', color: 'var(--good)', tone: 'good' },
      { id: 'delayed', label: 'Delayed', color: 'var(--bad)', tone: 'bad' },
      { id: 'blocked', label: 'Blocked', color: 'var(--bad)', tone: 'bad' },
      { id: 'cancelled', label: 'Cancelled', color: 'var(--neutral)', tone: 'neutral' },
      { id: 'onhold', label: 'On Hold', color: 'var(--neutral)', tone: 'neutral' },
      { id: 'open', label: 'Open', color: 'var(--pending)', tone: 'pending' },
      { id: 'closed', label: 'Closed', color: 'var(--good)', tone: 'good' },
    ],
    subsystem: [
      { id: 'ats', label: 'ATS', color: 'var(--sys-ats)' },
      { id: 'ixl', label: 'IXL', color: 'var(--sys-ixl)' },
      { id: 'scada', label: 'SCADA', color: 'var(--sys-scada)' },
      { id: 'comms', label: 'Communications', color: 'var(--sys-comms)' },
      { id: 'wayside', label: 'Wayside', color: 'var(--sys-wayside)' },
      { id: 'vehicle', label: 'Vehicle', color: 'var(--sys-vehicle)' },
      { id: 'civil', label: 'Civil', color: 'var(--sys-civil)' },
      { id: 'power', label: 'Power', color: 'var(--sys-power)' },
    ],
    testKind: [
      { id: 'static', label: 'Static Testing' },
      { id: 'dynamic', label: 'Dynamic Testing' },
      { id: 'integration', label: 'Integration Testing' },
      { id: 'regression', label: 'Regression Testing' },
      { id: 'sat', label: 'Site Acceptance Testing' },
      { id: 'fat', label: 'Factory Acceptance Testing' },
      { id: 'unit', label: 'Unit / Module Testing' },
    ],
    severity: [
      { id: 'low', label: 'Low', tone: 'good' },
      { id: 'medium', label: 'Medium', tone: 'warn' },
      { id: 'high', label: 'High', tone: 'bad' },
      { id: 'critical', label: 'Critical', tone: 'bad' },
    ],
    approval: [
      { id: 'none', label: 'Not submitted' },
      { id: 'pending', label: 'Pending' },
      { id: 'approved', label: 'Approved' },
      { id: 'rejected', label: 'Rejected' },
    ],
    owner: [],
    area: [],
    font: [
      { id: '', label: 'Interface (default)' },
      { id: "'Archivo', system-ui, sans-serif", label: 'Archivo' },
      { id: "'Roboto Mono', monospace", label: 'Roboto Mono' },
      { id: 'Georgia, serif', label: 'Georgia' },
      { id: "'Times New Roman', serif", label: 'Times New Roman' },
      { id: 'Arial, Helvetica, sans-serif', label: 'Arial' },
      { id: "'Courier New', monospace", label: 'Courier New' },
    ],
  };

  /**
   * What each editable list is, and where its values live on an object.
   *
   * `field` is a top-level property, `dataKeys` are inside `obj.data`, and
   * `styleKey` is inside `obj.style`. That is what lets the manager count
   * usages and reassign them when an option is deleted.
   */
  const LIST_DEFS = {
    status: {
      label: 'Status',
      field: 'status',
      color: true,
      tone: true,
      required: true,
      hint: 'Drives object colour, the legend and status filters.',
    },
    subsystem: {
      label: 'Subsystem',
      field: 'subsystem',
      color: true,
      hint: 'Rail signalling disciplines — ATS, IXL, SCADA and so on.',
    },
    testKind: {
      label: 'Test type',
      dataKeys: ['testKind'],
      hint: 'Offered on test windows.',
    },
    severity: {
      label: 'Severity & likelihood',
      dataKeys: ['severity', 'likelihood'],
      tone: true,
      hint: 'Shared by both risk fields; a high severity turns its pin red.',
    },
    approval: {
      label: 'Release approval',
      dataKeys: ['approval'],
      hint: 'Approval state on software releases.',
    },
    owner: {
      label: 'Owner',
      field: 'owner',
      freeform: true,
      hint: 'Suggestions offered when typing an owner. Any name is still allowed.',
    },
    area: {
      label: 'Area',
      field: 'area',
      freeform: true,
      hint: 'Suggestions offered when typing an area. Any value is still allowed.',
    },
    font: {
      label: 'Fonts',
      styleKey: 'font',
      hint: 'Font stacks offered in the Text section. Add a corporate font here.',
    },
  };

  const LIST_IDS = Object.keys(LIST_DEFS);

  /** Semantic tones an option may carry, for badges and chips. */
  const TONES = ['good', 'warn', 'bad', 'info', 'pending', 'neutral'];

  /** A fresh copy of the seed lists. */
  function defaultLists() {
    return deepClone(DEFAULT_LISTS);
  }

  /* ── Active lists ──────────────────────────────────────────────────────────
     The document owns the lists, but they are read from dozens of places that
     have no document to hand (the renderer's colour lookup, the legend, badge
     helpers). Rather than thread the document through all of them, the store
     pushes the current lists here whenever the document changes — the same
     pattern `core/dates.js` uses for date order, and for the same reason: this
     module is low in the graph and must not import upwards.
     ----------------------------------------------------------------------- */

  let activeLists = defaultLists();

  /** Called by the store after every document change. */
  function syncLists(lists) {
    activeLists = lists && typeof lists === 'object' ? lists : defaultLists();
  }

  /** Options for a list, in display order. */
  function listOptions(listId) {
    const list = activeLists[listId];
    return Array.isArray(list) ? list : [];
  }

  /** Just the ids, for filters and menus. */
  function listIds(listId) {
    return listOptions(listId).map((o) => o.id);
  }

  /** One option, or null when the value is not in the list. */
  function listOption(listId, id) {
    if (id == null) return null;
    return listOptions(listId).find((o) => o.id === id) || null;
  }

  /**
   * A value's descriptor, with a readable fallback for anything the list does
   * not know about — an imported file may carry statuses this project has never
   * seen, and showing the raw value beats showing nothing.
   */
  function listLabel(listId, id, fallback = '') {
    if (!id) return fallback;
    return listOption(listId, id)?.label || String(id);
  }

  /** Status descriptor with a safe fallback for unknown values. */
  function statusOf(id) {
    const option = listOption('status', id);
    if (option) return { ...option, tone: option.tone || 'neutral', color: option.color || 'var(--neutral)' };
    return { id, label: id ? String(id) : 'Unset', tone: 'neutral', color: 'var(--neutral)' };
  }

  function subsystemOf(id) {
    return listOption('subsystem', id);
  }

  function severityOf(id) {
    return listOption('severity', id);
  }

  /** Where a list's values live on an object — used for counting and reassigning. */
  function listUsage(doc, listId, optionId) {
    const def = LIST_DEFS[listId];
    if (!def) return 0;
    let count = 0;
    for (const obj of doc.objects) {
      if (def.field && obj[def.field] === optionId) count++;
      else if (def.styleKey && (obj.style?.[def.styleKey] ?? '') === optionId) count++;
      else if (def.dataKeys && def.dataKeys.some((k) => (obj.data?.[k] ?? '') === optionId)) count++;
    }
    return count;
  }

  /** Every distinct value of a list actually present in the document. */
  function listValuesInUse(doc, listId) {
    const def = LIST_DEFS[listId];
    const seen = new Set();
    if (!def) return seen;
    for (const obj of doc.objects) {
      if (def.field && obj[def.field]) seen.add(obj[def.field]);
      if (def.styleKey && obj.style?.[def.styleKey]) seen.add(obj.style[def.styleKey]);
      if (def.dataKeys) for (const k of def.dataKeys) if (obj.data?.[k]) seen.add(obj.data[k]);
    }
    return seen;
  }

  /** Dependency link types (the four classic precedence relationships). */
  const LINK_TYPES = {
    FS: { label: 'Finish → Start', short: 'FS', from: 'end', to: 'start' },
    SS: { label: 'Start → Start', short: 'SS', from: 'start', to: 'start' },
    FF: { label: 'Finish → Finish', short: 'FF', from: 'end', to: 'end' },
    SF: { label: 'Start → Finish', short: 'SF', from: 'start', to: 'end' },
  };

  const CONNECTOR_STYLES = ['orthogonal', 'curved', 'straight'];

  /* ══════════════════════════════════════════════════════════════════════════
     Factories
     ═══════════════════════════════════════════════════════════════════════ */

  /** Default appearance applied to every new object. */
  function defaultStyle(type = 'activity') {
    return {
      fill: '',            // '' = inherit the type accent
      stroke: '',
      strokeWidth: 1,
      radius: 6,
      opacity: 1,
      shadow: false,
      gradient: false,
      pattern: 'none',     // none | stripes | hatch | dots | grid
      textColor: '',
      font: '',            // '' = inherit --f-ui
      fontSize: 12,
      bold: type === 'milestone' || type === 'release',
      italic: false,
      underline: false,
      align: 'left',
      rotation: 0,
    };
  }

  /** Create a timeline object with every field the renderer expects present. */
  function makeObject(props = {}) {
    const type = TYPES[props.type] ? props.type : 'activity';
    const def = TYPES[type];
    const start = Number.isFinite(props.start) ? props.start : todayMs();
    const end = def.duration
      ? Number.isFinite(props.end)
        ? Math.max(props.end, start + MS_DAY)
        : addDays(start, def.defaultDays || 1)
      : start;

    return {
      id: props.id || uid('obj'),
      type,
      lane: props.lane || null,
      start,
      end,
      row: props.row ?? 0,             // stacking row within the lane
      title: props.title ?? def.label,
      subtitle: props.subtitle ?? '',
      icon: props.icon ?? def.icon,
      status: props.status ?? (type === 'risk' || type === 'issue' ? 'open' : 'planned'),
      progress: clamp(props.progress ?? 0, 0, 100),
      owner: props.owner ?? '',
      subsystem: props.subsystem ?? '',
      area: props.area ?? '',
      tags: Array.isArray(props.tags) ? props.tags.slice() : [],
      notes: props.notes ?? '',
      attachments: Array.isArray(props.attachments) ? props.attachments.slice() : [],
      links: [],                       // reserved: computed link cache, never persisted
      locked: !!props.locked,
      hidden: !!props.hidden,
      z: Number.isFinite(props.z) ? props.z : 0,
      groupId: props.groupId ?? null,
      style: { ...defaultStyle(type), ...(props.style || {}) },
      data: { ...(props.data || {}) },
      created: props.created ?? Date.now(),
      modified: props.modified ?? Date.now(),
    };
  }

  function makeLane(props = {}) {
    return {
      id: props.id || uid('lane'),
      name: props.name ?? 'New Lane',
      color: props.color ?? '#5b93f5',
      height: clamp(props.height ?? 64, 28, 480),
      hidden: !!props.hidden,
      locked: !!props.locked,
      collapsed: !!props.collapsed,
      group: props.group ?? '',
      description: props.description ?? '',
    };
  }

  function makeLink(props = {}) {
    return {
      id: props.id || uid('link'),
      from: props.from,
      to: props.to,
      type: LINK_TYPES[props.type] ? props.type : 'FS',
      style: CONNECTOR_STYLES.includes(props.style) ? props.style : '',
      lag: Number.isFinite(props.lag) ? props.lag : 0, // in days
      label: props.label ?? '',
      color: props.color ?? '',
      critical: false, // recomputed, never authoritative on disk
    };
  }

  function makeBaseline(doc, name) {
    return {
      id: uid('bl'),
      name: name || `Baseline ${new Date().toISOString().slice(0, 10)}`,
      created: Date.now(),
      note: '',
      snapshot: doc.objects.map((o) => ({
        id: o.id,
        title: o.title,
        lane: o.lane,
        start: o.start,
        end: o.end,
        progress: o.progress,
        status: o.status,
      })),
    };
  }

  /** Default project settings. */
  function defaultSettings() {
    return {
      theme: 'dark',
      snap: 'day',                 // off | day | week | month | quarter | workday
      weekStart: 1,                // 1 = Monday
      gridlines: true,
      gridDensity: 'auto',         // auto | minor | major | off
      showWeekends: true,
      showToday: true,
      todayOverride: null,         // ISO date string to simulate a planning date
      connectorStyle: 'orthogonal',
      showConnectors: true,
      showMinimap: true,
      showLegend: true,
      showProgress: true,
      filterMode: 'dim',           // dim | hide — what happens to filtered-out objects
      showBaseline: false,
      activeBaseline: null,
      criticalPath: false,
      laneLabels: true,
      dateOrder: 'mdy',            // mdy | dmy | ymd — display order only
      autoBackupMinutes: 60,
      backupEveryEdits: 100,
      backupKeep: 20,
      holidays: [],
      zoomPxPerDay: 3.2,
      originMs: null,              // left edge of the viewport (ms); null = auto
    };
  }

  /** A brand-new, empty-but-usable project. */
  function makeProject(name = 'Untitled Programme') {
    const start = startOfMonth(todayMs());
    return {
      schema: SCHEMA_VERSION,
      id: uid('proj'),
      name,
      description: '',
      client: '',
      programme: '',
      created: Date.now(),
      modified: Date.now(),
      settings: defaultSettings(),
      lists: defaultLists(),
      laneOrder: [],
      lanes: [],
      objects: [],
      links: [],
      baselines: [],
      groups: [],
      attachments: [],
      versions: [],
      meta: {
        editCount: 0,
        viewStart: start,
        viewEnd: addMonths(start, 12),
      },
    };
  }

  /**
   * A realistic starter project. New users open the app to something that
   * demonstrates the vocabulary — lanes, releases, campaigns, risks, links —
   * rather than an empty grid they have to guess their way into.
   */
  function makeStarterProject() {
    const doc = makeProject('Line 1 — Signalling Commissioning');
    doc.client = 'Metro Authority';
    doc.programme = 'CBTC Deployment · Phase 2';
    doc.description = 'Software release, testing and commissioning plan for the Phase 2 signalling deployment.';

    const laneSpec = [
      ['Software Releases', '#5b93f5'],
      ['Regression Testing', '#a855f7'],
      ['ATS', '#3a76e8'],
      ['IXL', '#9333d9'],
      ['SCADA', '#0d9488'],
      ['Communications', '#0ea5e9'],
      ['Wayside', '#e0900b'],
      ['Vehicle', '#e51b22'],
      ['Commissioning', '#16a571'],
      ['Customer', '#64748b'],
      ['Risks & Issues', '#f97316'],
    ];
    doc.lanes = laneSpec.map(([name, color]) => makeLane({ name, color, height: name === 'Risks & Issues' ? 54 : 64 }));
    doc.laneOrder = doc.lanes.map((l) => l.id);
    const lane = (n) => doc.lanes[n].id;

    const base = startOfMonth(todayMs());
    const D = (offsetDays) => addDays(base, offsetDays);

    const objs = [
      makeObject({ type: 'release', lane: lane(0), start: D(10), title: 'R2.4.0', status: 'released', owner: 'A. Okafor', subsystem: 'ats', data: { version: '2.4.0', releaseNumber: 'REL-024', buildNumber: '2.4.0-b118', approval: 'approved' } }),
      makeObject({ type: 'release', lane: lane(0), start: D(52), title: 'R2.5.0', status: 'testing', owner: 'A. Okafor', subsystem: 'ats', data: { version: '2.5.0', releaseNumber: 'REL-025', buildNumber: '2.5.0-rc3', approval: 'pending' } }),
      makeObject({ type: 'release', lane: lane(0), start: D(96), title: 'R2.6.0', status: 'planned', owner: 'A. Okafor', subsystem: 'ixl', data: { version: '2.6.0', releaseNumber: 'REL-026', buildNumber: '—', approval: 'none' } }),
      makeObject({ type: 'testwindow', lane: lane(1), start: D(14), end: D(34), title: 'Regression Cycle 4', status: 'complete', progress: 100, owner: 'M. Haddad', data: { testKind: 'regression' } }),
      makeObject({ type: 'testwindow', lane: lane(1), start: D(56), end: D(78), title: 'Regression Cycle 5', status: 'testing', progress: 42, owner: 'M. Haddad', data: { testKind: 'regression' } }),
      makeObject({ type: 'activity', lane: lane(2), start: D(6), end: D(46), title: 'ATS Integration Testing', subsystem: 'ats', status: 'inprogress', progress: 68, owner: 'L. Fontaine' }),
      makeObject({ type: 'activity', lane: lane(3), start: D(20), end: D(70), title: 'IXL Static Testing', subsystem: 'ixl', status: 'inprogress', progress: 35, owner: 'D. Vasquez' }),
      makeObject({ type: 'activity', lane: lane(4), start: D(30), end: D(64), title: 'SCADA Interface Verification', subsystem: 'scada', status: 'planned', progress: 0, owner: 'R. Bianchi' }),
      makeObject({ type: 'activity', lane: lane(5), start: D(0), end: D(40), title: 'Radio Coverage Survey', subsystem: 'comms', status: 'inprogress', progress: 80, owner: 'S. Njoroge' }),
      makeObject({ type: 'activity', lane: lane(6), start: D(24), end: D(88), title: 'Wayside Equipment Installation', subsystem: 'wayside', status: 'inprogress', progress: 45, owner: 'P. Lindqvist' }),
      makeObject({ type: 'activity', lane: lane(7), start: D(44), end: D(92), title: 'Onboard Retrofit — Fleet A', subsystem: 'vehicle', status: 'planned', progress: 0, owner: 'K. Ibrahim' }),
      // Dates satisfy every dependency below: the campaign starts after its
      // latest predecessor (Wayside installation, D88) finishes. A shipped
      // sample plan should not open with broken constraints.
      makeObject({ type: 'campaign', lane: lane(8), start: D(90), end: D(130), title: 'Dynamic Testing Campaign 1', status: 'planned', progress: 0, owner: 'J. Moreau', subsystem: 'ats', area: 'Depot → Station 6', data: { testPackage: 'TP-DYN-01' } }),
      makeObject({ type: 'campaign', lane: lane(8), start: D(136), end: D(176), title: 'Site Acceptance Testing', status: 'planned', progress: 0, owner: 'J. Moreau', area: 'Full alignment', data: { testPackage: 'TP-SAT-01' } }),
      makeObject({ type: 'milestone', lane: lane(8), start: D(180), title: 'Provisional Acceptance', status: 'planned', owner: 'Programme' }),
      makeObject({ type: 'freeze', lane: lane(0), start: D(88), end: D(102), title: 'Code Freeze', status: 'planned' }),
      makeObject({ type: 'customer', lane: lane(9), start: D(140), end: D(152), title: 'Customer Witness Testing', status: 'planned', owner: 'Metro Authority' }),
      makeObject({ type: 'outage', lane: lane(9), start: D(72), end: D(75), title: 'Traction Power Outage', status: 'planned', area: 'Sector 3' }),
      makeObject({ type: 'risk', lane: lane(10), start: D(58), title: 'Vehicle availability for dynamic testing', status: 'open', owner: 'J. Moreau', data: { severity: 'high', likelihood: 'medium', mitigation: 'Secure two additional test slots with Operations.' } }),
      makeObject({ type: 'issue', lane: lane(10), start: D(36), title: 'IXL-1184 · Route locking timeout', status: 'open', owner: 'D. Vasquez', data: { severity: 'critical', reference: 'IXL-1184' } }),
    ];
    doc.objects = objs;

    doc.links = [
      makeLink({ from: objs[1].id, to: objs[4].id, type: 'FS' }),
      makeLink({ from: objs[4].id, to: objs[11].id, type: 'FS' }),
      makeLink({ from: objs[11].id, to: objs[12].id, type: 'FS' }),
      makeLink({ from: objs[12].id, to: objs[13].id, type: 'FS' }),
      makeLink({ from: objs[6].id, to: objs[11].id, type: 'FS' }),
      makeLink({ from: objs[9].id, to: objs[11].id, type: 'FS' }),
    ];

    doc.meta.viewStart = D(-14);
    doc.meta.viewEnd = D(200);
    return doc;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Normalisation & migration
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Migration steps, applied in order for any document older than
   * SCHEMA_VERSION. Each step takes a document and returns the next shape.
   * Never delete a step — old files must always be able to walk forward.
   */
  const MIGRATIONS = [
    // v0 → v1: the initial released schema. Documents written by pre-release
    // builds carried dates as ISO strings and had no `row` on objects.
    (doc) => {
      (doc.objects || []).forEach((o) => {
        if (typeof o.start === 'string') o.start = toMs(o.start);
        if (typeof o.end === 'string') o.end = toMs(o.end);
        if (o.row == null) o.row = 0;
      });
      doc.schema = 1;
      return doc;
    },

    // v1 → v2: status, subsystem, test type, severity, approval and the font
    // menu became editable project data. `normalise()` seeds the lists and
    // adopts any value the document already uses, so nothing is lost.
    (doc) => {
      if (!doc.lists) doc.lists = defaultLists();
      doc.schema = 2;
      return doc;
    },
  ];

  /**
   * Bring any document — freshly parsed, imported, or restored from a backup —
   * up to the current schema and guarantee every field the renderer touches
   * exists. This is the single gate every document passes through.
   */
  function normalise(input) {
    let doc = input && typeof input === 'object' ? deepClone(input) : makeProject();

    const from = Number.isFinite(doc.schema) ? doc.schema : 0;
    for (let v = from; v < SCHEMA_VERSION; v++) {
      const step = MIGRATIONS[v];
      if (step) doc = step(doc);
    }

    const base = makeProject(doc.name || 'Untitled Programme');
    doc.schema = SCHEMA_VERSION;
    doc.id = doc.id || base.id;
    doc.name = doc.name || base.name;
    doc.description = doc.description ?? '';
    doc.client = doc.client ?? '';
    doc.programme = doc.programme ?? '';
    doc.created = doc.created || Date.now();
    doc.modified = doc.modified || Date.now();
    doc.settings = { ...defaultSettings(), ...(doc.settings || {}) };
    doc.lists = normaliseLists(doc);
    doc.baselines = Array.isArray(doc.baselines) ? doc.baselines : [];
    doc.groups = Array.isArray(doc.groups) ? doc.groups : [];
    doc.attachments = Array.isArray(doc.attachments) ? doc.attachments : [];
    doc.versions = Array.isArray(doc.versions) ? doc.versions : [];
    doc.meta = { editCount: 0, ...(doc.meta || {}) };

    doc.lanes = (Array.isArray(doc.lanes) ? doc.lanes : []).map((l) => makeLane(l));
    const laneIds = new Set(doc.lanes.map((l) => l.id));

    // laneOrder is authoritative for display order; repair it against the lanes.
    const order = Array.isArray(doc.laneOrder) ? doc.laneOrder.filter((id) => laneIds.has(id)) : [];
    for (const l of doc.lanes) if (!order.includes(l.id)) order.push(l.id);
    doc.laneOrder = order;

    const fallbackLane = doc.lanes[0] ? doc.lanes[0].id : null;
    doc.objects = (Array.isArray(doc.objects) ? doc.objects : []).map((o) => {
      const obj = makeObject(o);
      if (!laneIds.has(obj.lane)) obj.lane = fallbackLane;
      return obj;
    });

    const objIds = new Set(doc.objects.map((o) => o.id));
    doc.links = (Array.isArray(doc.links) ? doc.links : [])
      .map((l) => makeLink(l))
      .filter((l) => objIds.has(l.from) && objIds.has(l.to) && l.from !== l.to);

    return doc;
  }

  /**
   * Repair the document's vocabularies.
   *
   * Missing lists are seeded from the defaults, malformed options are dropped,
   * and — importantly — any value the objects actually use but the list does
   * not contain is adopted into it. An imported plan carrying an unfamiliar
   * status therefore keeps working and becomes editable, rather than silently
   * reading as an unknown value forever.
   */
  function normaliseLists(doc) {
    const seeds = defaultLists();
    const out = {};

    for (const listId of LIST_IDS) {
      const incoming = Array.isArray(doc.lists?.[listId]) ? doc.lists[listId] : seeds[listId];
      const seen = new Set();
      const options = [];

      for (const raw of incoming || []) {
        if (!raw || typeof raw !== 'object') continue;
        const id = raw.id === '' ? '' : String(raw.id ?? '').trim();
        if (raw.id == null || seen.has(id)) continue;
        seen.add(id);
        options.push({
          id,
          label: String(raw.label ?? id) || '(unnamed)',
          ...(raw.color ? { color: raw.color } : {}),
          ...(raw.tone ? { tone: raw.tone } : {}),
        });
      }

      // Adopt in-use values that are not in the list.
      for (const value of listValuesInUse(doc, listId)) {
        if (!seen.has(value)) {
          seen.add(value);
          options.push({ id: value, label: String(value) });
        }
      }

      out[listId] = options;
    }

    return out;
  }

  /**
   * Structural validation used by the importer. Returns
   * `{ ok, errors: [], warnings: [] }` — errors block, warnings don't.
   */
  function validate(doc) {
    const errors = [];
    const warnings = [];

    if (!doc || typeof doc !== 'object') {
      return { ok: false, errors: ['File does not contain a JSON object.'], warnings };
    }
    if (!Array.isArray(doc.objects)) errors.push('Missing "objects" array.');
    if (!Array.isArray(doc.lanes)) errors.push('Missing "lanes" array.');
    if (Number.isFinite(doc.schema) && doc.schema > SCHEMA_VERSION) {
      errors.push(`File uses schema v${doc.schema}; this build understands up to v${SCHEMA_VERSION}. Update the application.`);
    }

    if (Array.isArray(doc.objects)) {
      const laneIds = new Set((doc.lanes || []).map((l) => l.id));
      let orphans = 0;
      let badDates = 0;
      for (const o of doc.objects) {
        if (o.lane && !laneIds.has(o.lane)) orphans++;
        if (!Number.isFinite(toMs(o.start))) badDates++;
      }
      if (orphans) warnings.push(`${orphans} object(s) reference a missing lane — they will move to the first lane.`);
      if (badDates) warnings.push(`${badDates} object(s) have an unreadable start date — they will default to today.`);
    }

    return { ok: errors.length === 0, errors, warnings };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Derived helpers
     ═══════════════════════════════════════════════════════════════════════ */

  /** The effective "today" — the system date unless the user has pinned one. */
  function effectiveToday(doc) {
    const override = doc?.settings?.todayOverride;
    if (override) {
      const ms = toMs(override);
      if (Number.isFinite(ms)) return ms;
    }
    return todayMs();
  }

  /** Duration in days (bars are half-open: start inclusive, end exclusive). */
  function durationDays(obj) {
    if (!TYPES[obj.type]?.duration) return 0;
    return Math.max(0, Math.round((obj.end - obj.start) / MS_DAY));
  }

  /** Remaining duration in days given percent complete. */
  function remainingDays(obj) {
    const total = durationDays(obj);
    return Math.max(0, Math.round(total * (1 - (obj.progress || 0) / 100)));
  }

  /** Resolve the accent colour for an object: explicit fill → status → type. */
  function objectColor(obj, lane) {
    if (obj.style?.fill) return obj.style.fill;
    const status = listOption('status', obj.status);
    if (obj.type === 'release' && status?.color) return status.color;
    if (lane?.color && (obj.type === 'activity' || obj.type === 'testwindow')) return lane.color;
    return TYPES[obj.type]?.accent || 'var(--type-activity)';
  }

  /** Object bounds in ms, always with end > start so hit-testing works. */
  function objectRange(obj) {
    const hasDuration = TYPES[obj.type]?.duration;
    return { start: obj.start, end: hasDuration ? Math.max(obj.end, obj.start + MS_DAY) : obj.start };
  }

  /** Extent of the whole project, padded, for fit-to-window and the minimap. */
  function projectExtent(doc) {
    if (!doc.objects.length) {
      const t = effectiveToday(doc);
      return { start: addDays(t, -30), end: addDays(t, 180) };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const o of doc.objects) {
      const r = objectRange(o);
      if (r.start < min) min = r.start;
      if (r.end > max) max = r.end;
    }
    const pad = Math.max(MS_DAY * 7, (max - min) * 0.04);
    return { start: min - pad, end: max + pad };
  }

  /** Every distinct owner in the document, sorted. */
  function ownersOf(doc) {
    return Array.from(new Set(doc.objects.map((o) => o.owner).filter(Boolean))).sort();
  }

  /** Every distinct area in the document, sorted. */
  function areasOf(doc) {
    return Array.from(new Set(doc.objects.map((o) => o.area).filter(Boolean))).sort();
  }

  /** Every distinct tag in the document, sorted. */
  function tagsOf(doc) {
    const set = new Set();
    for (const o of doc.objects) for (const t of o.tags || []) set.add(t);
    return Array.from(set).sort();
  }

  /** ISO date export helper used by CSV/PDF writers. */
  function isoOf(ms) {
    return toISO(ms);
  }

  Object.defineProperty(__x, "SCHEMA_VERSION", { get: () => SCHEMA_VERSION, enumerable: true });
  Object.defineProperty(__x, "TYPES", { get: () => TYPES, enumerable: true });
  Object.defineProperty(__x, "TYPE_IDS", { get: () => TYPE_IDS, enumerable: true });
  Object.defineProperty(__x, "typeGroups", { get: () => typeGroups, enumerable: true });
  Object.defineProperty(__x, "LIST_DEFS", { get: () => LIST_DEFS, enumerable: true });
  Object.defineProperty(__x, "LIST_IDS", { get: () => LIST_IDS, enumerable: true });
  Object.defineProperty(__x, "TONES", { get: () => TONES, enumerable: true });
  Object.defineProperty(__x, "defaultLists", { get: () => defaultLists, enumerable: true });
  Object.defineProperty(__x, "syncLists", { get: () => syncLists, enumerable: true });
  Object.defineProperty(__x, "listOptions", { get: () => listOptions, enumerable: true });
  Object.defineProperty(__x, "listIds", { get: () => listIds, enumerable: true });
  Object.defineProperty(__x, "listOption", { get: () => listOption, enumerable: true });
  Object.defineProperty(__x, "listLabel", { get: () => listLabel, enumerable: true });
  Object.defineProperty(__x, "statusOf", { get: () => statusOf, enumerable: true });
  Object.defineProperty(__x, "subsystemOf", { get: () => subsystemOf, enumerable: true });
  Object.defineProperty(__x, "severityOf", { get: () => severityOf, enumerable: true });
  Object.defineProperty(__x, "listUsage", { get: () => listUsage, enumerable: true });
  Object.defineProperty(__x, "listValuesInUse", { get: () => listValuesInUse, enumerable: true });
  Object.defineProperty(__x, "LINK_TYPES", { get: () => LINK_TYPES, enumerable: true });
  Object.defineProperty(__x, "CONNECTOR_STYLES", { get: () => CONNECTOR_STYLES, enumerable: true });
  Object.defineProperty(__x, "defaultStyle", { get: () => defaultStyle, enumerable: true });
  Object.defineProperty(__x, "makeObject", { get: () => makeObject, enumerable: true });
  Object.defineProperty(__x, "makeLane", { get: () => makeLane, enumerable: true });
  Object.defineProperty(__x, "makeLink", { get: () => makeLink, enumerable: true });
  Object.defineProperty(__x, "makeBaseline", { get: () => makeBaseline, enumerable: true });
  Object.defineProperty(__x, "defaultSettings", { get: () => defaultSettings, enumerable: true });
  Object.defineProperty(__x, "makeProject", { get: () => makeProject, enumerable: true });
  Object.defineProperty(__x, "makeStarterProject", { get: () => makeStarterProject, enumerable: true });
  Object.defineProperty(__x, "normalise", { get: () => normalise, enumerable: true });
  Object.defineProperty(__x, "validate", { get: () => validate, enumerable: true });
  Object.defineProperty(__x, "effectiveToday", { get: () => effectiveToday, enumerable: true });
  Object.defineProperty(__x, "durationDays", { get: () => durationDays, enumerable: true });
  Object.defineProperty(__x, "remainingDays", { get: () => remainingDays, enumerable: true });
  Object.defineProperty(__x, "objectColor", { get: () => objectColor, enumerable: true });
  Object.defineProperty(__x, "objectRange", { get: () => objectRange, enumerable: true });
  Object.defineProperty(__x, "projectExtent", { get: () => projectExtent, enumerable: true });
  Object.defineProperty(__x, "ownersOf", { get: () => ownersOf, enumerable: true });
  Object.defineProperty(__x, "areasOf", { get: () => areasOf, enumerable: true });
  Object.defineProperty(__x, "tagsOf", { get: () => tagsOf, enumerable: true });
  Object.defineProperty(__x, "isoOf", { get: () => isoOf, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// core/cloud.js
// ════════════════════════════════════════════════════════════════════════
__mods["core/cloud.js"] = function (__x, __req) {
  /**
   * The hosted backend.
   *
   * This module is the *only* one that knows Supabase exists. Everything above
   * it — storage, the panels, the sharing dialog — talks to the functions here
   * and would keep working against a different backend if one ever replaced it.
   *
   * It is inert unless `config.js` names a project. With no configuration
   * `isConfigured()` returns false, nothing here is ever called, and CX Timeline
   * behaves exactly as it always has: local-first, no account, works by
   * double-clicking index.html.
   *
   * On permissions
   * --------------
   * The role returned by `getRole()` drives the read-only UI, but it is not the
   * control. Every rule is enforced by row-level security in Postgres, so a
   * viewer who bypasses the interface entirely is still refused by the database.
   * The role here exists to explain *why* something is disabled, not to decide
   * it.
   *
   * On saving
   * ---------
   * Writes go through the `save_project` function rather than a plain UPDATE,
   * for two reasons. A row hidden by row-level security is not an error — the
   * statement simply matches nothing and reports success — so a plain UPDATE
   * would let a viewer believe their work was saved. And the function carries an
   * optimistic revision check, so two people editing one plan get told about the
   * collision instead of quietly overwriting each other.
   *
   * Imports: util, events.
   */

  const { emit, EV } = __req("core/events.js");

  /* ── Configuration ─────────────────────────────────────────────────────── */

  function config() {
    return (typeof window !== 'undefined' && window.CX_CONFIG) || {};
  }

  /** True when this build points at a backend. */
  function isConfigured() {
    const { supabaseUrl, supabaseAnonKey } = config();
    return Boolean(supabaseUrl && supabaseAnonKey);
  }

  /** True when an account is required even if the backend cannot be reached. */
  function authRequired() {
    return Boolean(config().requireAuth);
  }

  /* ── Private state ─────────────────────────────────────────────────────── */

  let client = null;
  let user = null;
  let projectId = null;
  let projectRev = 0;
  let role = null; // 'owner' | 'editor' | 'viewer' | null
  let ready = false;

  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  /**
   * Create the client and restore any existing session.
   * Resolves to the signed-in user, or null. Never throws: a backend that is
   * down must degrade to "not signed in", not to a blank page.
   */
  async function init() {
    if (ready) return user;
    if (!isConfigured()) return null;

    const sdk = typeof window !== 'undefined' ? window.supabase : null;
    if (!sdk || typeof sdk.createClient !== 'function') {
      console.warn('[cx-timeline] the Supabase client did not load; running local-only');
      return null;
    }

    const { supabaseUrl, supabaseAnonKey } = config();
    client = sdk.createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    try {
      const { data } = await client.auth.getSession();
      user = data?.session?.user || null;
      if (user) await refreshAdmin();
    } catch (err) {
      console.warn('[cx-timeline] could not restore the session:', err.message);
      user = null;
    }

    // A refresh token that expires while the tab is open, or a sign-out in
    // another tab, must not leave a stale identity behind.
    client.auth.onAuthStateChange((event, session) => {
      const next = session?.user || null;
      const changed = (next?.id || null) !== (user?.id || null);
      user = next;
      if (!next) forgetProject();
      if (changed) emit(EV.AUTH_CHANGED, { user, event });
    });

    ready = true;
    return user;
  }

  /** The client, for the rare caller that needs it. Null when not configured. */
  function raw() {
    return client;
  }

  /* ── Accounts ──────────────────────────────────────────────────────────── */

  function currentUser() {
    return user;
  }

  function isSignedIn() {
    return Boolean(user);
  }

  /** A short label for the account menu. */
  function accountLabel() {
    if (!user) return '';
    return user.user_metadata?.full_name || user.email || 'Signed in';
  }

  async function signIn(email, password) {
    requireClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: String(email || '').trim(),
      password,
    });
    if (error) throw friendlier(error);
    user = data.user;
    await refreshAdmin();
    emit(EV.AUTH_CHANGED, { user, event: 'SIGNED_IN' });
    return user;
  }

  /**
   * Create an account.
   *
   * Whether the user is signed in straight away depends on the project's email
   * confirmation setting, so the caller is told which happened rather than
   * having to guess from whether a session appeared.
   */
  async function signUp(email, password, fullName = '') {
    requireClient();
    const { data, error } = await client.auth.signUp({
      email: String(email || '').trim(),
      password,
      options: { data: fullName ? { full_name: fullName } : {} },
    });
    if (error) throw friendlier(error);

    if (data.session) {
      user = data.user;
      await refreshAdmin();
      emit(EV.AUTH_CHANGED, { user, event: 'SIGNED_IN' });
      return { user, confirmationRequired: false };
    }
    return { user: data.user, confirmationRequired: true };
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
    user = null;
    admin = false;
    forgetProject();
    emit(EV.AUTH_CHANGED, { user: null, event: 'SIGNED_OUT' });
  }

  async function sendPasswordReset(email) {
    requireClient();
    const { error } = await client.auth.resetPasswordForEmail(String(email || '').trim(), {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) throw friendlier(error);
  }

  async function updatePassword(password) {
    requireClient();
    const { error } = await client.auth.updateUser({ password });
    if (error) throw friendlier(error);
  }

  /* ── The open project, and what you may do to it ───────────────────────── */

  function getProjectId() {
    return projectId;
  }

  function getRev() {
    return projectRev;
  }

  /** 'owner' | 'editor' | 'viewer' | null (nothing open, or local-only). */
  function getRole() {
    return role;
  }

  function canWrite() {
    return role === 'owner' || role === 'editor';
  }

  function isOwner() {
    return role === 'owner';
  }

  /**
   * True when the open project must not be modified.
   *
   * Deliberately false when no project is open or the app is running
   * local-only — read-only is a property of *this* project, not a default.
   */
  function isReadOnly() {
    return Boolean(projectId) && !canWrite();
  }

  function setAccess(id, nextRole, rev) {
    const changed = id !== projectId || nextRole !== role;
    projectId = id;
    role = nextRole;
    projectRev = rev ?? 0;
    if (changed) emit(EV.ACCESS_CHANGED, { projectId, role, readOnly: isReadOnly() });
  }

  function forgetProject() {
    if (projectId || role) setAccess(null, null, 0);
  }

  /* ── Projects ──────────────────────────────────────────────────────────── */

  /** Every project the signed-in user can reach, newest first, with their role. */
  async function listProjects() {
    const rows = await rpc('list_my_projects');
    return (rows || []).map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      objects: r.object_count,
      rev: Number(r.rev),
      savedAt: new Date(r.updated_at).getTime(),
      createdAt: new Date(r.created_at).getTime(),
      ownerEmail: r.owner_email,
      members: r.member_count,
    }));
  }

  /** Create a project from a document and open it. Returns its id. */
  async function createProject(doc) {
    requireUser();
    const { data, error } = await client
      .from('projects')
      .insert({
        owner_id: user.id,
        name: doc?.name || 'Untitled Programme',
        doc,
        object_count: (doc?.objects || []).length,
      })
      .select('id, rev')
      .single();
    if (error) throw friendlier(error);

    setAccess(data.id, 'owner', Number(data.rev));
    return data.id;
  }

  /** Open a project. Returns the document, or null when it is not reachable. */
  async function openProject(id) {
    const { data, error } = await client
      .from('projects')
      .select('id, doc, rev, name')
      .eq('id', id)
      .maybeSingle();
    if (error) throw friendlier(error);
    if (!data) {
      forgetProject();
      return null;
    }

    const theirRole = await rpc('project_role', { p_project: id });
    setAccess(data.id, theirRole || 'viewer', Number(data.rev));
    return data.doc;
  }

  /**
   * Save the open project.
   *
   * Returns `{ ok, rev }` on success. A collision resolves to
   * `{ ok: false, conflict: true }` rather than throwing, because the caller —
   * autosave — has to keep running either way.
   */
  async function saveProject(doc, { force = false } = {}) {
    if (!projectId) return { ok: false, reason: 'no-project' };
    if (!canWrite()) return { ok: false, reason: 'read-only' };

    const { data, error } = await client.rpc('save_project', {
      p_project: projectId,
      p_doc: doc,
      p_rev: force ? 0 : projectRev,
    });

    if (error) {
      if (isConflict(error)) {
        emit(EV.CLOUD_CONFLICT, { projectId });
        return { ok: false, conflict: true, reason: 'conflict' };
      }
      if (isDenied(error)) {
        setAccess(projectId, 'viewer', projectRev);
        return { ok: false, reason: 'read-only' };
      }
      throw friendlier(error);
    }

    projectRev = Number(data);
    return { ok: true, rev: projectRev };
  }

  async function renameProject(id, name) {
    const { data, error } = await client
      .from('projects')
      .update({ name })
      .eq('id', id)
      .select('id');
    if (error) throw friendlier(error);
    // A row excluded by row-level security is not an error — it just matches
    // nothing — so an empty result is how a refused rename presents itself.
    if (!data || !data.length) throw new Error('You do not have permission to rename this project.');
  }

  async function deleteProject(id) {
    const { data, error } = await client.from('projects').delete().eq('id', id).select('id');
    if (error) throw friendlier(error);
    if (!data || !data.length) throw new Error('Only the owner can delete a project.');
    if (id === projectId) forgetProject();
  }

  /* ── Accounts and invitations (administrators) ─────────────────────────── */

  let admin = false;

  /** True when the signed-in user administers this deployment. */
  function isAdmin() {
    return admin;
  }

  /**
   * Ask the server whether this account is an administrator.
   * Cached, because it gates UI that renders on every document change; it is
   * refreshed on sign-in and after any change to administrators.
   */
  async function refreshAdmin() {
    if (!client || !user) {
      admin = false;
      return false;
    }
    try {
      admin = Boolean(await rpc('is_admin'));
    } catch {
      admin = false;
    }
    return admin;
  }

  /**
   * Invite an email address to create an account.
   *
   * Sign-up is closed: the database refuses any account whose address has no
   * pending invitation, so this is the only way in. No email is sent — the
   * caller gets a link to pass on however they like, which avoids depending on
   * a mail server that a free project does not reliably have.
   */
  async function inviteUser(email, role = 'editor', note = '') {
    const rows = await rpc('invite_user', { p_email: email, p_role: role, p_note: note || null });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      email: row?.invited_email || String(email).trim().toLowerCase(),
      expires: row?.invitation_expires ? new Date(row.invitation_expires).getTime() : null,
    };
  }

  async function revokeInvitation(email) {
    await rpc('revoke_invitation', { p_email: email });
  }

  async function listInvitations() {
    const rows = await rpc('list_invitations');
    return (rows || []).map((r) => ({
      email: r.email,
      role: r.role_hint,
      note: r.note,
      created: new Date(r.created_at).getTime(),
      expires: new Date(r.expires_at).getTime(),
      expired: r.expired,
      invitedBy: r.invited_by,
    }));
  }

  async function listAccounts() {
    const rows = await rpc('list_accounts');
    return (rows || []).map((r) => ({
      id: r.id,
      email: r.email,
      name: r.full_name,
      admin: r.is_admin,
      created: new Date(r.created_at).getTime(),
      projects: r.projects,
      isYou: r.id === user?.id,
    }));
  }

  async function setAdmin(userId, value) {
    await rpc('set_admin', { p_user: userId, p_admin: value });
    if (userId === user?.id) await refreshAdmin();
  }

  /** The link an invited person opens to set up their account. */
  function inviteLink(email) {
    const base = window.location.origin + window.location.pathname;
    return `${base}#invite=${encodeURIComponent(email)}`;
  }

  /* ── Sharing ───────────────────────────────────────────────────────────── */

  async function listMembers(id = projectId) {
    if (!id) return [];
    const rows = await rpc('list_project_members', { p_project: id });
    return (rows || []).map((r) => ({
      userId: r.user_id,
      email: r.email,
      name: r.full_name,
      role: r.role,
      since: new Date(r.created_at).getTime(),
      isYou: r.user_id === user?.id,
    }));
  }

  /** Grant someone access by email address. Owners only. */
  async function shareProject(id, email, memberRole) {
    const rows = await rpc('share_project', {
      p_project: id,
      p_email: email,
      p_role: memberRole,
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { userId: row?.member_id, email: row?.member_email, role: row?.member_role };
  }

  async function unshareProject(id, userId) {
    await rpc('unshare_project', { p_project: id, p_user: userId });
    if (userId === user?.id && id === projectId) forgetProject();
  }

  /** Change an existing member's role. Owners only. */
  async function setMemberRole(id, email, memberRole) {
    return shareProject(id, email, memberRole);
  }

  /* ── Backups ───────────────────────────────────────────────────────────── */

  async function listBackups(id = projectId) {
    if (!id) return [];
    const { data, error } = await client
      .from('project_backups')
      .select('id, reason, name, object_count, size_bytes, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false });
    if (error) throw friendlier(error);
    return (data || []).map((b) => ({
      key: b.id,
      time: new Date(b.created_at).getTime(),
      reason: b.reason,
      name: b.name,
      objects: b.object_count,
      size: b.size_bytes,
    }));
  }

  async function createBackup(doc, reason = 'manual') {
    if (!projectId || !canWrite()) return false;
    let size = 0;
    try {
      size = JSON.stringify(doc).length;
    } catch {
      /* an unserialisable document would have failed to save already */
    }
    const { error } = await client.from('project_backups').insert({
      project_id: projectId,
      doc,
      reason,
      name: doc?.name || null,
      object_count: (doc?.objects || []).length,
      size_bytes: size,
    });
    if (error) {
      if (isDenied(error)) return false;
      throw friendlier(error);
    }
    return true;
  }

  async function loadBackup(key) {
    const { data, error } = await client
      .from('project_backups')
      .select('doc')
      .eq('id', key)
      .maybeSingle();
    if (error) throw friendlier(error);
    return data?.doc || null;
  }

  async function deleteBackup(key) {
    const { data, error } = await client.from('project_backups').delete().eq('id', key).select('id');
    if (error) throw friendlier(error);
    if (!data || !data.length) throw new Error('Only the owner can delete a backup.');
  }

  async function pruneBackups(keep = 20) {
    if (!projectId || !canWrite()) return 0;
    try {
      return Number(await rpc('prune_backups', { p_project: projectId, p_keep: keep })) || 0;
    } catch {
      return 0;
    }
  }

  /* ── Attachments ───────────────────────────────────────────────────────── */

  const BUCKET = 'attachments';

  /**
   * Attachment bytes live in object storage, keyed `<project>/<id>`, exactly as
   * they live outside the document locally — so a plan carrying 40 MB of test
   * logs still saves in milliseconds. The first path segment is what the storage
   * policies read to decide access.
   */
  function blobPath(id) {
    return `${projectId}/${id}`;
  }

  async function putBlob(id, file) {
    if (!projectId) throw new Error('No project is open.');
    if (!canWrite()) throw new Error('This project is read-only.');
    const { error } = await client.storage.from(BUCKET).upload(blobPath(id), file, {
      upsert: true,
      contentType: file.type || 'application/octet-stream',
    });
    if (error) throw friendlier(error);
    return { id, name: file.name, type: file.type, size: file.size };
  }

  async function getBlob(id) {
    if (!projectId) return null;
    const { data, error } = await client.storage.from(BUCKET).download(blobPath(id));
    if (error) return null;
    return data;
  }

  async function deleteBlob(id) {
    if (!projectId || !canWrite()) return;
    await client.storage.from(BUCKET).remove([blobPath(id)]);
  }

  /* ── Plumbing ──────────────────────────────────────────────────────────── */

  function requireClient() {
    if (!client) throw new Error('This build is not connected to a backend.');
  }

  function requireUser() {
    requireClient();
    if (!user) throw new Error('You need to be signed in.');
  }

  async function rpc(name, args = {}) {
    requireClient();
    const { data, error } = await client.rpc(name, args);
    if (error) throw friendlier(error);
    return data;
  }

  /** Postgres raises 40001 for a revision collision; see save_project. */
  function isConflict(error) {
    return error?.code === '40001' || /conflict:/i.test(error?.message || '');
  }

  /** 42501 is insufficient_privilege — the read-only refusal. */
  function isDenied(error) {
    return (
      error?.code === '42501' ||
      error?.code === 'PGRST301' ||
      /read only|permission|policy/i.test(error?.message || '')
    );
  }

  /**
   * Turn a backend error into something worth showing a person.
   *
   * Supabase messages are written for developers; these are the handful a user
   * can actually act on, and the rest are passed through rather than swallowed.
   */
  function friendlier(error) {
    const message = error?.message || String(error);
    const map = [
      [/invalid login credentials/i, 'That email and password do not match an account.'],
      [/email not confirmed/i, 'Check your inbox and confirm your email address first.'],
      [/user already registered/i, 'There is already an account with that email — sign in instead.'],
      [/password should be at least (\d+)/i, 'Pick a longer password — at least $1 characters.'],
      [/rate limit|too many requests/i, 'Too many attempts. Wait a minute and try again.'],
      [/failed to fetch|networkerror/i, 'Cannot reach the server. Check your connection.'],
      [/only the owner/i, 'Only the project owner can do that.'],
      [/no account for/i, message.replace(/^.*?no account for/i, 'No account for')],
      [/must keep at least one owner/i, 'A project has to keep at least one owner.'],
      [/read only/i, 'This project is read-only for you.'],
      [/invitation only/i, message],
      [/only an administrator/i, 'Only an administrator can do that.'],
      [/already has an account/i, message],
      [/at least one administrator/i, 'There has to be at least one administrator.'],
    ];
    for (const [pattern, replacement] of map) {
      if (pattern.test(message)) {
        const out = new Error(message.replace(pattern, replacement));
        out.code = error?.code;
        return out;
      }
    }
    const out = new Error(message);
    out.code = error?.code;
    return out;
  }

  Object.defineProperty(__x, "isConfigured", { get: () => isConfigured, enumerable: true });
  Object.defineProperty(__x, "authRequired", { get: () => authRequired, enumerable: true });
  Object.defineProperty(__x, "init", { get: () => init, enumerable: true });
  Object.defineProperty(__x, "raw", { get: () => raw, enumerable: true });
  Object.defineProperty(__x, "currentUser", { get: () => currentUser, enumerable: true });
  Object.defineProperty(__x, "isSignedIn", { get: () => isSignedIn, enumerable: true });
  Object.defineProperty(__x, "accountLabel", { get: () => accountLabel, enumerable: true });
  Object.defineProperty(__x, "signIn", { get: () => signIn, enumerable: true });
  Object.defineProperty(__x, "signUp", { get: () => signUp, enumerable: true });
  Object.defineProperty(__x, "signOut", { get: () => signOut, enumerable: true });
  Object.defineProperty(__x, "sendPasswordReset", { get: () => sendPasswordReset, enumerable: true });
  Object.defineProperty(__x, "updatePassword", { get: () => updatePassword, enumerable: true });
  Object.defineProperty(__x, "getProjectId", { get: () => getProjectId, enumerable: true });
  Object.defineProperty(__x, "getRev", { get: () => getRev, enumerable: true });
  Object.defineProperty(__x, "getRole", { get: () => getRole, enumerable: true });
  Object.defineProperty(__x, "canWrite", { get: () => canWrite, enumerable: true });
  Object.defineProperty(__x, "isOwner", { get: () => isOwner, enumerable: true });
  Object.defineProperty(__x, "isReadOnly", { get: () => isReadOnly, enumerable: true });
  Object.defineProperty(__x, "listProjects", { get: () => listProjects, enumerable: true });
  Object.defineProperty(__x, "createProject", { get: () => createProject, enumerable: true });
  Object.defineProperty(__x, "openProject", { get: () => openProject, enumerable: true });
  Object.defineProperty(__x, "saveProject", { get: () => saveProject, enumerable: true });
  Object.defineProperty(__x, "renameProject", { get: () => renameProject, enumerable: true });
  Object.defineProperty(__x, "deleteProject", { get: () => deleteProject, enumerable: true });
  Object.defineProperty(__x, "isAdmin", { get: () => isAdmin, enumerable: true });
  Object.defineProperty(__x, "refreshAdmin", { get: () => refreshAdmin, enumerable: true });
  Object.defineProperty(__x, "inviteUser", { get: () => inviteUser, enumerable: true });
  Object.defineProperty(__x, "revokeInvitation", { get: () => revokeInvitation, enumerable: true });
  Object.defineProperty(__x, "listInvitations", { get: () => listInvitations, enumerable: true });
  Object.defineProperty(__x, "listAccounts", { get: () => listAccounts, enumerable: true });
  Object.defineProperty(__x, "setAdmin", { get: () => setAdmin, enumerable: true });
  Object.defineProperty(__x, "inviteLink", { get: () => inviteLink, enumerable: true });
  Object.defineProperty(__x, "listMembers", { get: () => listMembers, enumerable: true });
  Object.defineProperty(__x, "shareProject", { get: () => shareProject, enumerable: true });
  Object.defineProperty(__x, "unshareProject", { get: () => unshareProject, enumerable: true });
  Object.defineProperty(__x, "setMemberRole", { get: () => setMemberRole, enumerable: true });
  Object.defineProperty(__x, "listBackups", { get: () => listBackups, enumerable: true });
  Object.defineProperty(__x, "createBackup", { get: () => createBackup, enumerable: true });
  Object.defineProperty(__x, "loadBackup", { get: () => loadBackup, enumerable: true });
  Object.defineProperty(__x, "deleteBackup", { get: () => deleteBackup, enumerable: true });
  Object.defineProperty(__x, "pruneBackups", { get: () => pruneBackups, enumerable: true });
  Object.defineProperty(__x, "putBlob", { get: () => putBlob, enumerable: true });
  Object.defineProperty(__x, "getBlob", { get: () => getBlob, enumerable: true });
  Object.defineProperty(__x, "deleteBlob", { get: () => deleteBlob, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// core/history.js
// ════════════════════════════════════════════════════════════════════════
__mods["core/history.js"] = function (__x, __req) {
  /**
   * Undo / redo — a structural diff engine over the project document.
   *
   * Naive undo stacks keep a full copy of the document per edit, which stops
   * scaling the moment notes and attachments arrive. Instead, every edit is
   * reduced to a *patch*: the entities that were added, removed or changed, and
   * the top-level fields that moved. A patch is typically a few hundred bytes,
   * so a deep history costs almost nothing, and its inverse is just the patch
   * read backwards.
   *
   * Imports: util (leaf).
   */

  const { deepClone, deepEqual, uid } = __req("core/util.js");

  /** Collections diffed by entity id. */
  const COLLECTIONS = ['lanes', 'objects', 'links', 'baselines', 'groups', 'attachments'];

  /** Top-level fields diffed by value. */
  const FIELDS = ['name', 'description', 'client', 'programme', 'settings', 'lists', 'laneOrder', 'meta'];

  /* ── Diff ──────────────────────────────────────────────────────────────── */

  function indexById(list) {
    const map = new Map();
    for (const item of list || []) map.set(item.id, item);
    return map;
  }

  /**
   * Compute the patch that turns `before` into `after`.
   * Returns null when nothing actually changed — callers use that to avoid
   * pushing no-op entries onto the stack.
   */
  function diff(before, after, label = 'Edit') {
    const patch = { id: uid('h'), label, time: Date.now(), collections: {}, fields: {}, order: {} };
    let touched = false;

    for (const key of COLLECTIONS) {
      const a = indexById(before[key]);
      const b = indexById(after[key]);
      const added = [];
      const removed = [];
      const changed = [];

      for (const [id, item] of b) {
        const prev = a.get(id);
        if (!prev) added.push(deepClone(item));
        else if (!deepEqual(prev, item)) changed.push({ before: deepClone(prev), after: deepClone(item) });
      }
      for (const [id, item] of a) {
        if (!b.has(id)) removed.push(deepClone(item));
      }

      // Order within a collection is meaningful for z-stacking and lane display,
      // so record it whenever the sequence of ids moved.
      const orderA = (before[key] || []).map((x) => x.id);
      const orderB = (after[key] || []).map((x) => x.id);
      const orderMoved = !deepEqual(orderA, orderB) && !added.length && !removed.length;

      if (added.length || removed.length || changed.length || orderMoved) {
        patch.collections[key] = { added, removed, changed };
        if (orderMoved) patch.order[key] = { before: orderA, after: orderB };
        touched = true;
      }
    }

    for (const key of FIELDS) {
      if (!deepEqual(before[key], after[key])) {
        patch.fields[key] = { before: deepClone(before[key]), after: deepClone(after[key]) };
        touched = true;
      }
    }

    return touched ? patch : null;
  }

  /** Reverse a patch so it can be applied as an undo. */
  function invert(patch) {
    const out = { ...patch, collections: {}, fields: {}, order: {} };
    for (const [key, delta] of Object.entries(patch.collections)) {
      out.collections[key] = {
        added: delta.removed,
        removed: delta.added,
        changed: delta.changed.map((c) => ({ before: c.after, after: c.before })),
      };
    }
    for (const [key, f] of Object.entries(patch.fields)) {
      out.fields[key] = { before: f.after, after: f.before };
    }
    for (const [key, o] of Object.entries(patch.order || {})) {
      out.order[key] = { before: o.after, after: o.before };
    }
    return out;
  }

  /**
   * Apply a patch to a document **in place** and return it.
   * Removal happens before insertion so a "replace" patch behaves predictably.
   */
  function apply(doc, patch) {
    for (const [key, delta] of Object.entries(patch.collections || {})) {
      const list = Array.isArray(doc[key]) ? doc[key] : (doc[key] = []);

      if (delta.removed.length) {
        const gone = new Set(delta.removed.map((x) => x.id));
        for (let i = list.length - 1; i >= 0; i--) if (gone.has(list[i].id)) list.splice(i, 1);
      }
      if (delta.changed.length) {
        const byId = new Map(delta.changed.map((c) => [c.after.id, c.after]));
        for (let i = 0; i < list.length; i++) {
          const next = byId.get(list[i].id);
          if (next) list[i] = deepClone(next);
        }
      }
      if (delta.added.length) {
        for (const item of delta.added) {
          if (!list.some((x) => x.id === item.id)) list.push(deepClone(item));
        }
      }
    }

    for (const [key, o] of Object.entries(patch.order || {})) {
      const list = doc[key];
      if (!Array.isArray(list)) continue;
      const rank = new Map(o.after.map((id, i) => [id, i]));
      list.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e9) - (rank.has(b.id) ? rank.get(b.id) : 1e9));
    }

    for (const [key, f] of Object.entries(patch.fields || {})) {
      doc[key] = deepClone(f.after);
    }

    return doc;
  }

  /** Human summary of a patch, used by the version-history panel. */
  function describe(patch) {
    const parts = [];
    for (const [key, delta] of Object.entries(patch.collections || {})) {
      const noun = key.replace(/s$/, '');
      if (delta.added.length) parts.push(`+${delta.added.length} ${noun}`);
      if (delta.removed.length) parts.push(`−${delta.removed.length} ${noun}`);
      if (delta.changed.length) parts.push(`~${delta.changed.length} ${noun}`);
    }
    for (const key of Object.keys(patch.fields || {})) parts.push(key);
    return parts.join(', ') || 'no change';
  }

  /* ── The stack ─────────────────────────────────────────────────────────── */

  /**
   * A bounded undo/redo stack of patches.
   *
   * `coalesceMs` merges consecutive edits carrying the same `mergeKey` inside a
   * short window, so typing a title or nudging a bar with the arrow keys
   * produces one undo step rather than forty.
   */
  class History {
    constructor({ limit = 200, coalesceMs = 600 } = {}) {
      this.limit = limit;
      this.coalesceMs = coalesceMs;
      this.undoStack = [];
      this.redoStack = [];
      this._lastKey = null;
      this._lastTime = 0;
    }

    get canUndo() {
      return this.undoStack.length > 0;
    }

    get canRedo() {
      return this.redoStack.length > 0;
    }

    get depth() {
      return this.undoStack.length;
    }

    /**
     * Record a patch. When `mergeKey` matches the previous entry and the entries
     * are close in time, the two are folded into one so undo feels natural.
     */
    push(patch, mergeKey = null) {
      if (!patch) return;
      const now = Date.now();
      const canMerge =
        mergeKey &&
        mergeKey === this._lastKey &&
        now - this._lastTime < this.coalesceMs &&
        this.undoStack.length > 0;

      if (canMerge) {
        this.undoStack[this.undoStack.length - 1] = mergePatches(this.undoStack[this.undoStack.length - 1], patch);
      } else {
        this.undoStack.push(patch);
        if (this.undoStack.length > this.limit) this.undoStack.shift();
      }

      this._lastKey = mergeKey;
      this._lastTime = now;
      this.redoStack.length = 0;
    }

    /** Pop the newest patch and return its inverse (ready to apply). */
    undo() {
      const patch = this.undoStack.pop();
      if (!patch) return null;
      this.redoStack.push(patch);
      this._lastKey = null;
      return invert(patch);
    }

    /** Pop the newest undone patch and return it (ready to re-apply). */
    redo() {
      const patch = this.redoStack.pop();
      if (!patch) return null;
      this.undoStack.push(patch);
      this._lastKey = null;
      return patch;
    }

    clear() {
      this.undoStack.length = 0;
      this.redoStack.length = 0;
      this._lastKey = null;
    }

    /** Recent entries, newest first — the version-history panel renders these. */
    recent(n = 40) {
      return this.undoStack
        .slice(-n)
        .reverse()
        .map((p) => ({ id: p.id, label: p.label, time: p.time, summary: describe(p) }));
    }

    /** Index of a patch in the undo stack, or -1. */
    indexOf(id) {
      return this.undoStack.findIndex((p) => p.id === id);
    }
  }

  /**
   * Fold `next` into `prev` so the pair reads as a single logical edit.
   * The "before" side always comes from the earlier patch and the "after" side
   * from the later one, which is exactly what a merged edit means.
   */
  function mergePatches(prev, next) {
    const out = { ...prev, time: next.time, label: next.label, collections: {}, fields: { ...prev.fields }, order: { ...prev.order } };

    const keys = new Set([...Object.keys(prev.collections), ...Object.keys(next.collections)]);
    for (const key of keys) {
      const a = prev.collections[key] || { added: [], removed: [], changed: [] };
      const b = next.collections[key] || { added: [], removed: [], changed: [] };

      const changed = new Map();
      for (const c of a.changed) changed.set(c.before.id, { before: c.before, after: c.after });
      for (const c of b.changed) {
        const existing = changed.get(c.before.id);
        if (existing) existing.after = c.after;
        else changed.set(c.before.id, { before: c.before, after: c.after });
      }

      const addedIds = new Set(a.added.map((x) => x.id));
      const added = a.added.slice();
      for (const item of b.added) if (!addedIds.has(item.id)) added.push(item);
      // An entity added then edited within the window: keep the newest form.
      for (let i = 0; i < added.length; i++) {
        const c = changed.get(added[i].id);
        if (c) {
          added[i] = c.after;
          changed.delete(added[i].id);
        }
      }

      const removedIds = new Set(a.removed.map((x) => x.id));
      const removed = a.removed.slice();
      for (const item of b.removed) if (!removedIds.has(item.id)) removed.push(item);

      out.collections[key] = { added, removed, changed: Array.from(changed.values()) };
    }

    for (const [key, f] of Object.entries(next.fields || {})) {
      out.fields[key] = out.fields[key] ? { before: out.fields[key].before, after: f.after } : f;
    }
    for (const [key, o] of Object.entries(next.order || {})) {
      out.order[key] = out.order[key] ? { before: out.order[key].before, after: o.after } : o;
    }

    return out;
  }

  Object.defineProperty(__x, "diff", { get: () => diff, enumerable: true });
  Object.defineProperty(__x, "invert", { get: () => invert, enumerable: true });
  Object.defineProperty(__x, "apply", { get: () => apply, enumerable: true });
  Object.defineProperty(__x, "describe", { get: () => describe, enumerable: true });
  Object.defineProperty(__x, "History", { get: () => History, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// core/store.js
// ════════════════════════════════════════════════════════════════════════
__mods["core/store.js"] = function (__x, __req) {
  /**
   * The application store — the one place the current document lives.
   *
   * Everything that changes the project goes through `edit()`, which:
   *   1. hands the caller a mutable draft,
   *   2. diffs the result against the previous document,
   *   3. records the patch on the undo stack,
   *   4. publishes `doc:changed` so the UI, autosave and renderer react.
   *
   * Transient interaction (dragging a bar, live-resizing) uses `preview()`,
   * which updates the document without touching history; the interaction
   * commits once with a single `edit()` when the pointer is released.
   *
   * On a hosted deployment a project can be open read-only. Because every write
   * funnels through the three entry points below, one guard covers the whole
   * application — there is no path to a mutation that does not pass through
   * here. The guard is a courtesy to the user, not the security boundary: that
   * is row-level security in Postgres, which refuses the same writes even if
   * this check were removed.
   *
   * Imports: util, events, cloud, model, history.
   */

  const { deepClone, clamp } = __req("core/util.js");
  const { emit, EV } = __req("core/events.js");
  const { isReadOnly } = __req("core/cloud.js");
  const { normalise, makeProject, makeObject, makeLane, makeLink, effectiveToday, TYPES, syncLists, defaultLists, LIST_DEFS, listUsage } = __req("core/model.js");
  const { History, diff, apply } = __req("core/history.js");

  /* ── Private state ─────────────────────────────────────────────────────── */

  /**
   * The current document.
   *
   * INVARIANT: `doc` is never mutated in place. Every write path builds a new
   * object graph and reassigns this binding. Two things depend on that:
   *
   *   1. `edit()` can use the outgoing `doc` directly as the "before" side of
   *      its diff, instead of paying for a second deep clone.
   *   2. Derived analysis (critical path, dependency violations) is memoised in
   *      a WeakMap keyed on this object, so document identity *is* the cache
   *      key — no revision counter to keep in step, and stale entries are
   *      collected automatically.
   *
   * Break the invariant and both go quietly wrong.
   */
  let doc = normalise(makeProject());
  let history = new History();
  let objectIndex = new Map();
  let laneIndex = new Map();
  let dirty = false;
  let previewBase = null; // document snapshot taken when a preview session opens

  /** Transient UI state — never persisted with the document. */
  const ui = {
    selection: new Set(),
    hoverId: null,
    tool: 'select', // select | pan | connect | note | <object type>
    filters: {
      text: '',
      types: [],
      statuses: [],
      lanes: [],
      owners: [],
      subsystems: [],
      areas: [],
      tags: [],
      from: null,
      to: null,
    },
    clipboard: null,
  };

  /* ── Write guard ───────────────────────────────────────────────────────── */

  /**
   * True when this write must not happen, having said so.
   *
   * `preview` is announced quietly: a viewer dragging a bar would otherwise
   * raise a notification on every mouse-move.
   */
  function refuseWrite(label) {
    if (!isReadOnly()) return false;
    if (label !== 'preview') emit(EV.EDIT_REFUSED, { label });
    return true;
  }

  /** True when the open project is read-only for the signed-in user. */
  function isDocReadOnly() {
    return isReadOnly();
  }

  /* ── Indexing ──────────────────────────────────────────────────────────── */

  function reindex() {
    objectIndex = new Map(doc.objects.map((o) => [o.id, o]));
    laneIndex = new Map(doc.lanes.map((l) => [l.id, l]));
    // The document owns its vocabularies; push them down to the model so the
    // renderer, legend and badge helpers resolve against this project's lists.
    syncLists(doc.lists);
  }
  reindex();

  /* ── Reading ───────────────────────────────────────────────────────────── */

  /** The live document. Treat as read-only — mutate through `edit()`. */
  function getDoc() {
    return doc;
  }

  function getSettings() {
    return doc.settings;
  }

  function getObject(id) {
    return objectIndex.get(id) || null;
  }

  function getLane(id) {
    return laneIndex.get(id) || null;
  }

  /** Lanes in display order, optionally excluding hidden ones. */
  function orderedLanes(includeHidden = true) {
    const out = [];
    for (const id of doc.laneOrder) {
      const lane = laneIndex.get(id);
      if (lane && (includeHidden || !lane.hidden)) out.push(lane);
    }
    return out;
  }

  /** Objects belonging to a lane, sorted by z then start. */
  function objectsInLane(laneId) {
    return doc.objects
      .filter((o) => o.lane === laneId)
      .sort((a, b) => a.z - b.z || a.start - b.start);
  }

  function today() {
    return effectiveToday(doc);
  }

  function isDirty() {
    return dirty;
  }

  function markClean() {
    dirty = false;
  }

  /* ── Writing ───────────────────────────────────────────────────────────── */

  /**
   * Apply a mutation and record it in history.
   *
   * @param {string}   label     Human description, shown in version history.
   * @param {Function} mutator   Receives a mutable draft of the document.
   * @param {object}   [opts]
   * @param {string}   [opts.mergeKey]  Consecutive edits sharing a key coalesce.
   * @param {string}   [opts.reason]    Passed through on the change event.
   * @returns {boolean} true when the document actually changed.
   */
  function edit(label, mutator, opts = {}) {
    if (refuseWrite(label)) return false;

    // No clone needed for the "before" side: `doc` is immutable by invariant,
    // and `draft` is a separate graph. This halves the cloning cost of an edit.
    const before = previewBase || doc;
    const draft = deepClone(doc);

    const result = mutator(draft);
    if (result === false) {
      previewBase = null;
      return false;
    }

    draft.modified = Date.now();
    draft.meta = draft.meta || {};
    draft.meta.editCount = (draft.meta.editCount || 0) + 1;

    const patch = diff(before, draft, label);
    previewBase = null;
    if (!patch) {
      // Still adopt the draft: it may hold non-diffed churn like `modified`.
      doc = draft;
      reindex();
      return false;
    }

    doc = draft;
    reindex();
    history.push(patch, opts.mergeKey || null);
    dirty = true;

    emit(EV.DOC_CHANGED, { reason: opts.reason || label, patch });
    emit(EV.HISTORY_CHANGED, historyState());
    return true;
  }

  /**
   * Update the document without recording history — for live drag feedback.
   * The first call in a gesture snapshots the pre-gesture document so the
   * eventual `edit()` produces one patch covering the whole gesture.
   *
   * Prefer `previewObjects()` for anything driven by pointer movement: this
   * variant deep-clones the whole document, which a drag would pay for on every
   * frame.
   */
  function preview(mutator) {
    if (refuseWrite('preview')) return false;
    if (!previewBase) previewBase = doc;
    const draft = deepClone(doc);
    if (mutator(draft) === false) return false;
    doc = draft;
    reindex();
    emit(EV.DOC_CHANGED, { reason: 'preview', transient: true });
    return true;
  }

  /**
   * Copy-on-write preview of specific objects — the fast path for dragging.
   *
   * A drag touches a handful of objects but used to deep-clone the entire
   * document on every mouse-move, so the cost of moving one bar grew with the
   * size of the whole plan. This clones only the objects named in `ids` and
   * shares every other object by reference, which keeps a gesture's per-frame
   * cost proportional to the selection instead of the project.
   *
   * The result is still a brand-new document object, so the immutability
   * invariant — and the memoisation that rides on it — holds.
   *
   * @param {string[]} ids       Objects the mutator is allowed to change.
   * @param {Function} mutate    Called once per object with a private copy.
   */
  function previewObjects(ids, mutate) {
    if (refuseWrite('preview')) return false;
    if (!previewBase) previewBase = doc;

    const targets = new Set(ids);
    if (!targets.size) return false;

    const next = doc.objects.map((o) => {
      if (!targets.has(o.id)) return o;
      // Clone only what a drag can touch; `style`/`data` stay shared until the
      // inspector actually edits them.
      const copy = { ...o };
      if (mutate(copy) === false) return o;
      return copy;
    });

    doc = { ...doc, objects: next };

    // Patch the index rather than rebuilding it over every object.
    for (const o of next) if (targets.has(o.id)) objectIndex.set(o.id, o);

    emit(EV.DOC_CHANGED, { reason: 'preview', transient: true });
    return true;
  }

  /** Abandon an in-flight preview gesture and restore the pre-gesture state. */
  function cancelPreview() {
    if (!previewBase) return;
    doc = previewBase;
    previewBase = null;
    reindex();
    emit(EV.DOC_CHANGED, { reason: 'preview-cancel', transient: true });
  }

  /** True while a gesture is staging changes outside history. */
  function hasPreview() {
    return previewBase !== null;
  }

  /**
   * Change settings or view state that should persist but never appear in the
   * undo stack (zoom level, panel widths, the active dock tab).
   */
  function editQuiet(mutator, reason = 'quiet') {
    // Pan, zoom and the input preferences are how a *reader* uses the plan, so
    // they are deliberately not gated — they never reach the server.
    const draft = deepClone(doc);
    if (mutator(draft) === false) return false;
    doc = draft;
    reindex();
    dirty = true;
    emit(EV.DOC_CHANGED, { reason, quiet: true });
    return true;
  }

  /** Replace the whole document (new / open / import / restore). */
  function replaceDoc(next, reason = 'replace') {
    doc = normalise(next);
    reindex();
    history.clear();
    ui.selection.clear();
    previewBase = null;
    dirty = reason !== 'load';
    emit(EV.DOC_REPLACED, { reason });
    emit(EV.DOC_CHANGED, { reason });
    emit(EV.SELECTION_CHANGED, { ids: [] });
    emit(EV.HISTORY_CHANGED, historyState());
    return doc;
  }

  /* ── History ───────────────────────────────────────────────────────────── */

  function historyState() {
    return { canUndo: history.canUndo, canRedo: history.canRedo, depth: history.depth };
  }

  function recentHistory(n) {
    return history.recent(n);
  }

  function undo() {
    const patch = history.undo();
    if (!patch) return false;
    doc = apply(deepClone(doc), patch);
    reindex();
    pruneSelection();
    dirty = true;
    emit(EV.DOC_CHANGED, { reason: 'undo' });
    emit(EV.HISTORY_CHANGED, historyState());
    return true;
  }

  function redo() {
    const patch = history.redo();
    if (!patch) return false;
    doc = apply(deepClone(doc), patch);
    reindex();
    pruneSelection();
    dirty = true;
    emit(EV.DOC_CHANGED, { reason: 'redo' });
    emit(EV.HISTORY_CHANGED, historyState());
    return true;
  }

  /** Undo repeatedly until the given history entry has been rolled back. */
  function revertTo(patchId) {
    const idx = history.indexOf(patchId);
    if (idx < 0) return false;
    const steps = history.depth - idx;
    for (let i = 0; i < steps; i++) if (!undo()) break;
    return true;
  }

  /* ── Selection ─────────────────────────────────────────────────────────── */

  function getSelection() {
    return Array.from(ui.selection);
  }

  function selectedObjects() {
    return getSelection().map((id) => objectIndex.get(id)).filter(Boolean);
  }

  function isSelected(id) {
    return ui.selection.has(id);
  }

  function setSelection(ids) {
    const next = new Set((ids || []).filter((id) => objectIndex.has(id)));
    if (next.size === ui.selection.size && Array.from(next).every((id) => ui.selection.has(id))) return;
    ui.selection = next;
    emit(EV.SELECTION_CHANGED, { ids: getSelection() });
  }

  function addToSelection(ids) {
    setSelection([...getSelection(), ...[].concat(ids)]);
  }

  function toggleSelection(id) {
    const next = new Set(ui.selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelection(Array.from(next));
  }

  function clearSelection() {
    setSelection([]);
  }

  function selectAll() {
    setSelection(doc.objects.filter((o) => !o.hidden && !isLaneHidden(o.lane)).map((o) => o.id));
  }

  function isLaneHidden(laneId) {
    const lane = laneIndex.get(laneId);
    return !!lane?.hidden;
  }

  /** Drop selection entries whose object no longer exists (after undo/delete). */
  function pruneSelection() {
    const before = ui.selection.size;
    for (const id of Array.from(ui.selection)) if (!objectIndex.has(id)) ui.selection.delete(id);
    if (ui.selection.size !== before) emit(EV.SELECTION_CHANGED, { ids: getSelection() });
  }

  /* ── Transient UI state ────────────────────────────────────────────────── */

  function getTool() {
    return ui.tool;
  }

  function setTool(tool) {
    if (ui.tool === tool) return;
    ui.tool = tool;
    emit(EV.TOOL_CHANGED, { tool });
  }

  function getHover() {
    return ui.hoverId;
  }

  function setHover(id) {
    ui.hoverId = id;
  }

  function getFilters() {
    return ui.filters;
  }

  function setFilters(patch) {
    Object.assign(ui.filters, patch);
    emit(EV.FILTER_CHANGED, { filters: ui.filters });
  }

  function resetFilters() {
    setFilters({
      text: '',
      types: [],
      statuses: [],
      lanes: [],
      owners: [],
      subsystems: [],
      areas: [],
      tags: [],
      from: null,
      to: null,
    });
  }

  function hasActiveFilters() {
    const f = ui.filters;
    return !!(
      f.text ||
      f.types.length ||
      f.statuses.length ||
      f.lanes.length ||
      f.owners.length ||
      f.subsystems.length ||
      f.areas.length ||
      f.tags.length ||
      f.from ||
      f.to
    );
  }

  function getClipboard() {
    return ui.clipboard;
  }

  function setClipboard(payload) {
    ui.clipboard = payload;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Document operations
     The vocabulary the UI actually calls. Each is one undoable edit.
     ═══════════════════════════════════════════════════════════════════════ */

  function addObject(props, label = 'Add object') {
    const obj = makeObject(props);
    if (!obj.lane) obj.lane = doc.laneOrder[0] || null;
    obj.z = nextZ();
    edit(label, (d) => {
      d.objects.push(obj);
    });
    return obj.id;
  }

  function addObjects(list, label = 'Add objects') {
    const made = list.map((p) => {
      const o = makeObject(p);
      if (!o.lane) o.lane = doc.laneOrder[0] || null;
      return o;
    });
    let z = nextZ();
    made.forEach((o) => {
      o.z = z++;
    });
    edit(label, (d) => {
      d.objects.push(...made);
    });
    return made.map((o) => o.id);
  }

  function updateObject(id, patch, label = 'Edit object', opts = {}) {
    return edit(
      label,
      (d) => {
        const o = d.objects.find((x) => x.id === id);
        if (!o) return false;
        applyObjectPatch(o, patch);
        o.modified = Date.now();
      },
      opts
    );
  }

  function updateObjects(ids, patch, label = 'Edit objects', opts = {}) {
    return edit(
      label,
      (d) => {
        const set = new Set(ids);
        let hit = false;
        for (const o of d.objects) {
          if (!set.has(o.id)) continue;
          applyObjectPatch(o, typeof patch === 'function' ? patch(o) : patch);
          o.modified = Date.now();
          hit = true;
        }
        if (!hit) return false;
      },
      opts
    );
  }

  /** Shallow-merge a patch, but merge `style` and `data` one level deeper. */
  function applyObjectPatch(obj, patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (k === 'style' || k === 'data') Object.assign(obj[k], v);
      else obj[k] = v;
    }
    if (TYPES[obj.type]?.duration && obj.end <= obj.start) obj.end = obj.start + 86400000;
    obj.progress = clamp(obj.progress ?? 0, 0, 100);
  }

  function removeObjects(ids, label = 'Delete') {
    const set = new Set([].concat(ids));
    if (!set.size) return false;
    const ok = edit(label, (d) => {
      d.objects = d.objects.filter((o) => !set.has(o.id));
      d.links = d.links.filter((l) => !set.has(l.from) && !set.has(l.to));
    });
    pruneSelection();
    return ok;
  }

  /** Highest z + 1, so new objects land on top. */
  function nextZ() {
    return doc.objects.reduce((m, o) => Math.max(m, o.z || 0), 0) + 1;
  }

  function bringToFront(ids) {
    let z = nextZ();
    updateObjects(ids, () => ({ z: z++ }), 'Bring to front');
  }

  function sendToBack(ids) {
    const min = doc.objects.reduce((m, o) => Math.min(m, o.z || 0), 0);
    let z = min - [].concat(ids).length;
    updateObjects(ids, () => ({ z: z++ }), 'Send to back');
  }

  function raise(ids) {
    updateObjects(ids, (o) => ({ z: (o.z || 0) + 1 }), 'Raise');
  }

  function lower(ids) {
    updateObjects(ids, (o) => ({ z: (o.z || 0) - 1 }), 'Lower');
  }

  /* ── Lanes ─────────────────────────────────────────────────────────────── */

  function addLane(props, index = -1) {
    const lane = makeLane(props);
    edit('Add lane', (d) => {
      d.lanes.push(lane);
      if (index >= 0 && index < d.laneOrder.length) d.laneOrder.splice(index, 0, lane.id);
      else d.laneOrder.push(lane.id);
    });
    return lane.id;
  }

  function updateLane(id, patch, label = 'Edit lane', opts = {}) {
    return edit(
      label,
      (d) => {
        const lane = d.lanes.find((l) => l.id === id);
        if (!lane) return false;
        Object.assign(lane, patch);
        lane.height = clamp(lane.height, 28, 480);
      },
      opts
    );
  }

  /** Remove a lane. Its objects move to `moveTo`, or are deleted if null. */
  function removeLane(id, moveTo = null) {
    return edit('Delete lane', (d) => {
      d.lanes = d.lanes.filter((l) => l.id !== id);
      d.laneOrder = d.laneOrder.filter((x) => x !== id);
      if (moveTo) {
        for (const o of d.objects) if (o.lane === id) o.lane = moveTo;
      } else {
        const gone = new Set(d.objects.filter((o) => o.lane === id).map((o) => o.id));
        d.objects = d.objects.filter((o) => o.lane !== id);
        d.links = d.links.filter((l) => !gone.has(l.from) && !gone.has(l.to));
      }
    });
  }

  function moveLane(id, toIndex) {
    return edit('Reorder lanes', (d) => {
      const from = d.laneOrder.indexOf(id);
      if (from < 0) return false;
      const target = clamp(toIndex, 0, d.laneOrder.length - 1);
      if (from === target) return false;
      d.laneOrder.splice(from, 1);
      d.laneOrder.splice(target, 0, id);
    });
  }

  /* ── Links ─────────────────────────────────────────────────────────────── */

  function addLink(props) {
    const link = makeLink(props);
    if (!link.from || !link.to || link.from === link.to) return null;
    const exists = doc.links.some((l) => l.from === link.from && l.to === link.to);
    if (exists) return null;
    if (createsCycle(link.from, link.to)) return null;
    edit('Add dependency', (d) => {
      d.links.push(link);
    });
    return link.id;
  }

  function updateLink(id, patch, label = 'Edit dependency') {
    return edit(label, (d) => {
      const l = d.links.find((x) => x.id === id);
      if (!l) return false;
      Object.assign(l, patch);
    });
  }

  function removeLinks(ids) {
    const set = new Set([].concat(ids));
    return edit('Delete dependency', (d) => {
      d.links = d.links.filter((l) => !set.has(l.id));
    });
  }

  /** Links touching any of the given object ids. */
  function linksFor(ids) {
    const set = new Set([].concat(ids));
    return doc.links.filter((l) => set.has(l.from) || set.has(l.to));
  }

  /**
   * Would adding from → to close a loop? Dependency graphs must stay acyclic,
   * otherwise critical-path analysis and slip propagation never terminate.
   */
  function createsCycle(from, to) {
    const adjacency = new Map();
    for (const l of doc.links) {
      if (!adjacency.has(l.from)) adjacency.set(l.from, []);
      adjacency.get(l.from).push(l.to);
    }
    const seen = new Set();
    const stack = [to];
    while (stack.length) {
      const node = stack.pop();
      if (node === from) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const next of adjacency.get(node) || []) stack.push(next);
    }
    return false;
  }

  /* ── Settings ──────────────────────────────────────────────────────────── */

  /**
   * Settings that describe how input behaves rather than how the plan reads.
   * These are preferences, so they persist but stay out of the undo stack —
   * pressing Ctrl+Z should never silently change your snapping back.
   */
  const INPUT_PREFERENCES = new Set(['snap', 'wheelMode', 'weekStart', 'dateOrder']);

  /** Settings changes are undoable — they alter how the plan reads. */
  function setSetting(key, value, label = 'Change setting') {
    if (doc.settings[key] === value) return false;
    if (INPUT_PREFERENCES.has(key)) {
      return editQuiet((d) => {
        d.settings[key] = value;
      }, 'preference');
    }
    return edit(label, (d) => {
      d.settings[key] = value;
    });
  }

  /** View state (zoom, pan) persists but stays out of history. */
  function setViewState(patch) {
    return editQuiet((d) => {
      Object.assign(d.settings, patch);
    }, 'view');
  }

  function setMeta(patch, label = 'Edit project details') {
    return edit(label, (d) => {
      Object.assign(d, patch);
    });
  }

  /* ── Baselines ─────────────────────────────────────────────────────────── */

  function addBaseline(baseline) {
    edit('Take baseline', (d) => {
      d.baselines.push(baseline);
      d.settings.activeBaseline = baseline.id;
      d.settings.showBaseline = true;
    });
    return baseline.id;
  }

  function removeBaseline(id) {
    return edit('Delete baseline', (d) => {
      d.baselines = d.baselines.filter((b) => b.id !== id);
      if (d.settings.activeBaseline === id) {
        d.settings.activeBaseline = d.baselines.length ? d.baselines[d.baselines.length - 1].id : null;
        if (!d.settings.activeBaseline) d.settings.showBaseline = false;
      }
    });
  }

  function activeBaseline() {
    const id = doc.settings.activeBaseline;
    return id ? doc.baselines.find((b) => b.id === id) || null : null;
  }

  /* ── Attachments registry ──────────────────────────────────────────────── */

  function addAttachmentRecord(record) {
    edit('Attach file', (d) => {
      d.attachments.push(record);
    });
    return record.id;
  }

  function removeAttachmentRecord(id) {
    return edit('Remove attachment', (d) => {
      d.attachments = d.attachments.filter((a) => a.id !== id);
      for (const o of d.objects) {
        if (o.attachments?.includes(id)) o.attachments = o.attachments.filter((x) => x !== id);
      }
    });
  }

  function getAttachment(id) {
    return doc.attachments.find((a) => a.id === id) || null;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Editable lists (status, subsystem, test type, severity, approval, fonts)
     ═══════════════════════════════════════════════════════════════════════ */

  function getList(listId) {
    return doc.lists?.[listId] || [];
  }

  /** How many objects currently use an option. */
  function listOptionUsage(listId, optionId) {
    return listUsage(doc, listId, optionId);
  }

  /**
   * Add an option. Returns its id, or null when the id is already taken —
   * duplicate ids would make the value ambiguous.
   */
  function addListOption(listId, { id, label, color, tone }) {
    const optionId = String(id ?? label ?? '').trim();
    if (!optionId && listId !== 'font') return null;
    if (getList(listId).some((o) => o.id === optionId)) return null;

    const option = { id: optionId, label: String(label || optionId).trim() || optionId };
    if (color) option.color = color;
    if (tone) option.tone = tone;

    edit(`Add ${LIST_DEFS[listId]?.label || listId} option`, (d) => {
      if (!d.lists[listId]) d.lists[listId] = [];
      d.lists[listId].push(option);
    });
    return optionId;
  }

  function updateListOption(listId, optionId, patch, opts = {}) {
    return edit(
      `Edit ${LIST_DEFS[listId]?.label || listId} option`,
      (d) => {
        const option = (d.lists[listId] || []).find((o) => o.id === optionId);
        if (!option) return false;
        // The id is the stored value on every object, so it is not editable —
        // only the presentation is.
        if (patch.label != null) option.label = String(patch.label);
        if (patch.color !== undefined) {
          if (patch.color) option.color = patch.color;
          else delete option.color;
        }
        if (patch.tone !== undefined) {
          if (patch.tone) option.tone = patch.tone;
          else delete option.tone;
        }
      },
      opts
    );
  }

  /**
   * Delete an option, rewriting the objects that use it.
   *
   * `reassignTo` moves them onto another option; omitting it clears the field.
   * Both happen in the same edit as the removal, so one undo puts everything
   * back and the document is never left referencing a deleted option.
   */
  function removeListOption(listId, optionId, { reassignTo = '' } = {}) {
    const def = LIST_DEFS[listId];
    if (!def) return false;

    return edit(`Remove ${def.label} option`, (d) => {
      d.lists[listId] = (d.lists[listId] || []).filter((o) => o.id !== optionId);

      for (const obj of d.objects) {
        if (def.field && obj[def.field] === optionId) obj[def.field] = reassignTo;
        if (def.styleKey && obj.style?.[def.styleKey] === optionId) obj.style[def.styleKey] = reassignTo;
        if (def.dataKeys) {
          for (const key of def.dataKeys) {
            if (obj.data?.[key] === optionId) obj.data[key] = reassignTo;
          }
        }
      }
    });
  }

  /** Move an option up or down the list. */
  function moveListOption(listId, optionId, delta) {
    return edit(`Reorder ${LIST_DEFS[listId]?.label || listId}`, (d) => {
      const list = d.lists[listId] || [];
      const from = list.findIndex((o) => o.id === optionId);
      const to = clamp(from + delta, 0, list.length - 1);
      if (from < 0 || from === to) return false;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
    });
  }

  /** Restore one list to the shipped defaults, keeping any option still in use. */
  function resetList(listId) {
    return edit(`Reset ${LIST_DEFS[listId]?.label || listId}`, (d) => {
      const seeds = defaultLists()[listId] || [];
      const keep = [];
      for (const option of d.lists[listId] || []) {
        const stillUsed = listUsage(d, listId, option.id) > 0;
        if (stillUsed && !seeds.some((s) => s.id === option.id)) keep.push(option);
      }
      d.lists[listId] = [...seeds, ...keep];
    });
  }

  /* ── Groups ────────────────────────────────────────────────────────────── */

  function groupObjects(ids, name = 'Group') {
    const members = [].concat(ids).filter((id) => objectIndex.has(id));
    if (members.length < 2) return null;
    const group = { id: `grp_${Date.now().toString(36)}`, name, created: Date.now() };
    edit('Group', (d) => {
      d.groups.push(group);
      for (const o of d.objects) if (members.includes(o.id)) o.groupId = group.id;
    });
    return group.id;
  }

  function ungroupObjects(ids) {
    const groupIds = new Set(
      [].concat(ids).map((id) => objectIndex.get(id)?.groupId).filter(Boolean)
    );
    if (!groupIds.size) return false;
    return edit('Ungroup', (d) => {
      for (const o of d.objects) if (groupIds.has(o.groupId)) o.groupId = null;
      d.groups = d.groups.filter((g) => !groupIds.has(g.id));
    });
  }

  /** Expand a selection to include every sibling of any grouped member. */
  function expandGroupSelection(ids) {
    const out = new Set([].concat(ids));
    const groups = new Set(
      [].concat(ids).map((id) => objectIndex.get(id)?.groupId).filter(Boolean)
    );
    if (groups.size) {
      for (const o of doc.objects) if (o.groupId && groups.has(o.groupId)) out.add(o.id);
    }
    return Array.from(out);
  }

  /* ── Testing seam ──────────────────────────────────────────────────────── */

  /** Reset the store to a known state. Used by the headless test harness. */
  function __resetForTests(nextDoc) {
    doc = normalise(nextDoc || makeProject());
    history = new History();
    ui.selection.clear();
    previewBase = null;
    dirty = false;
    reindex();
  }

  Object.defineProperty(__x, "isDocReadOnly", { get: () => isDocReadOnly, enumerable: true });
  Object.defineProperty(__x, "getDoc", { get: () => getDoc, enumerable: true });
  Object.defineProperty(__x, "getSettings", { get: () => getSettings, enumerable: true });
  Object.defineProperty(__x, "getObject", { get: () => getObject, enumerable: true });
  Object.defineProperty(__x, "getLane", { get: () => getLane, enumerable: true });
  Object.defineProperty(__x, "orderedLanes", { get: () => orderedLanes, enumerable: true });
  Object.defineProperty(__x, "objectsInLane", { get: () => objectsInLane, enumerable: true });
  Object.defineProperty(__x, "today", { get: () => today, enumerable: true });
  Object.defineProperty(__x, "isDirty", { get: () => isDirty, enumerable: true });
  Object.defineProperty(__x, "markClean", { get: () => markClean, enumerable: true });
  Object.defineProperty(__x, "edit", { get: () => edit, enumerable: true });
  Object.defineProperty(__x, "preview", { get: () => preview, enumerable: true });
  Object.defineProperty(__x, "previewObjects", { get: () => previewObjects, enumerable: true });
  Object.defineProperty(__x, "cancelPreview", { get: () => cancelPreview, enumerable: true });
  Object.defineProperty(__x, "hasPreview", { get: () => hasPreview, enumerable: true });
  Object.defineProperty(__x, "editQuiet", { get: () => editQuiet, enumerable: true });
  Object.defineProperty(__x, "replaceDoc", { get: () => replaceDoc, enumerable: true });
  Object.defineProperty(__x, "historyState", { get: () => historyState, enumerable: true });
  Object.defineProperty(__x, "recentHistory", { get: () => recentHistory, enumerable: true });
  Object.defineProperty(__x, "undo", { get: () => undo, enumerable: true });
  Object.defineProperty(__x, "redo", { get: () => redo, enumerable: true });
  Object.defineProperty(__x, "revertTo", { get: () => revertTo, enumerable: true });
  Object.defineProperty(__x, "getSelection", { get: () => getSelection, enumerable: true });
  Object.defineProperty(__x, "selectedObjects", { get: () => selectedObjects, enumerable: true });
  Object.defineProperty(__x, "isSelected", { get: () => isSelected, enumerable: true });
  Object.defineProperty(__x, "setSelection", { get: () => setSelection, enumerable: true });
  Object.defineProperty(__x, "addToSelection", { get: () => addToSelection, enumerable: true });
  Object.defineProperty(__x, "toggleSelection", { get: () => toggleSelection, enumerable: true });
  Object.defineProperty(__x, "clearSelection", { get: () => clearSelection, enumerable: true });
  Object.defineProperty(__x, "selectAll", { get: () => selectAll, enumerable: true });
  Object.defineProperty(__x, "getTool", { get: () => getTool, enumerable: true });
  Object.defineProperty(__x, "setTool", { get: () => setTool, enumerable: true });
  Object.defineProperty(__x, "getHover", { get: () => getHover, enumerable: true });
  Object.defineProperty(__x, "setHover", { get: () => setHover, enumerable: true });
  Object.defineProperty(__x, "getFilters", { get: () => getFilters, enumerable: true });
  Object.defineProperty(__x, "setFilters", { get: () => setFilters, enumerable: true });
  Object.defineProperty(__x, "resetFilters", { get: () => resetFilters, enumerable: true });
  Object.defineProperty(__x, "hasActiveFilters", { get: () => hasActiveFilters, enumerable: true });
  Object.defineProperty(__x, "getClipboard", { get: () => getClipboard, enumerable: true });
  Object.defineProperty(__x, "setClipboard", { get: () => setClipboard, enumerable: true });
  Object.defineProperty(__x, "addObject", { get: () => addObject, enumerable: true });
  Object.defineProperty(__x, "addObjects", { get: () => addObjects, enumerable: true });
  Object.defineProperty(__x, "updateObject", { get: () => updateObject, enumerable: true });
  Object.defineProperty(__x, "updateObjects", { get: () => updateObjects, enumerable: true });
  Object.defineProperty(__x, "removeObjects", { get: () => removeObjects, enumerable: true });
  Object.defineProperty(__x, "bringToFront", { get: () => bringToFront, enumerable: true });
  Object.defineProperty(__x, "sendToBack", { get: () => sendToBack, enumerable: true });
  Object.defineProperty(__x, "raise", { get: () => raise, enumerable: true });
  Object.defineProperty(__x, "lower", { get: () => lower, enumerable: true });
  Object.defineProperty(__x, "addLane", { get: () => addLane, enumerable: true });
  Object.defineProperty(__x, "updateLane", { get: () => updateLane, enumerable: true });
  Object.defineProperty(__x, "removeLane", { get: () => removeLane, enumerable: true });
  Object.defineProperty(__x, "moveLane", { get: () => moveLane, enumerable: true });
  Object.defineProperty(__x, "addLink", { get: () => addLink, enumerable: true });
  Object.defineProperty(__x, "updateLink", { get: () => updateLink, enumerable: true });
  Object.defineProperty(__x, "removeLinks", { get: () => removeLinks, enumerable: true });
  Object.defineProperty(__x, "linksFor", { get: () => linksFor, enumerable: true });
  Object.defineProperty(__x, "createsCycle", { get: () => createsCycle, enumerable: true });
  Object.defineProperty(__x, "setSetting", { get: () => setSetting, enumerable: true });
  Object.defineProperty(__x, "setViewState", { get: () => setViewState, enumerable: true });
  Object.defineProperty(__x, "setMeta", { get: () => setMeta, enumerable: true });
  Object.defineProperty(__x, "addBaseline", { get: () => addBaseline, enumerable: true });
  Object.defineProperty(__x, "removeBaseline", { get: () => removeBaseline, enumerable: true });
  Object.defineProperty(__x, "activeBaseline", { get: () => activeBaseline, enumerable: true });
  Object.defineProperty(__x, "addAttachmentRecord", { get: () => addAttachmentRecord, enumerable: true });
  Object.defineProperty(__x, "removeAttachmentRecord", { get: () => removeAttachmentRecord, enumerable: true });
  Object.defineProperty(__x, "getAttachment", { get: () => getAttachment, enumerable: true });
  Object.defineProperty(__x, "getList", { get: () => getList, enumerable: true });
  Object.defineProperty(__x, "listOptionUsage", { get: () => listOptionUsage, enumerable: true });
  Object.defineProperty(__x, "addListOption", { get: () => addListOption, enumerable: true });
  Object.defineProperty(__x, "updateListOption", { get: () => updateListOption, enumerable: true });
  Object.defineProperty(__x, "removeListOption", { get: () => removeListOption, enumerable: true });
  Object.defineProperty(__x, "moveListOption", { get: () => moveListOption, enumerable: true });
  Object.defineProperty(__x, "resetList", { get: () => resetList, enumerable: true });
  Object.defineProperty(__x, "groupObjects", { get: () => groupObjects, enumerable: true });
  Object.defineProperty(__x, "ungroupObjects", { get: () => ungroupObjects, enumerable: true });
  Object.defineProperty(__x, "expandGroupSelection", { get: () => expandGroupSelection, enumerable: true });
  Object.defineProperty(__x, "__resetForTests", { get: () => __resetForTests, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// core/storage.js
// ════════════════════════════════════════════════════════════════════════
__mods["core/storage.js"] = function (__x, __req) {
  /**
   * Persistence.
   *
   * There is no Save button. Every committed edit is written back within a few
   * hundred milliseconds, and the document survives a browser restart, a crash,
   * or the tab being closed mid-drag.
   *
   * Where it is written depends on how the application is deployed, and every
   * caller is deliberately unaware of which:
   *
   *   local mode   IndexedDB — the original behaviour, no account, no server.
   *   hosted mode  Postgres via `core/cloud.js`, with IndexedDB demoted to an
   *                offline cache so a dropped connection loses nothing.
   *
   * Storage stack (local, and the cache in hosted mode)
   * --------------------------------------------------
   * IndexedDB is the primary store — it takes megabytes without complaint,
   * holds binary attachments natively, and writes off the main thread.
   * localStorage is kept as a mirror for the small stuff (preferences) and as a
   * complete fallback when IndexedDB is unavailable, which happens in private
   * browsing on some engines and when a page is opened from `file://` under a
   * hardened profile. The fallback is transparent to every caller.
   *
   * Imports: util, events, cloud, model, store.
   */

  const { debounce, bytes } = __req("core/util.js");
  const { emit, on, EV } = __req("core/events.js");
  const cloud = __req("core/cloud.js");
  const { normalise, makeStarterProject } = __req("core/model.js");
  const { getDoc, markClean, isDirty } = __req("core/store.js");

  const DB_NAME = 'cx-timeline';
  const DB_VERSION = 1;
  const STORE_PROJECTS = 'projects';
  const STORE_BACKUPS = 'backups';
  const STORE_BLOBS = 'blobs';
  const STORE_PREFS = 'prefs';

  const LS_PREFIX = 'cxtl.';
  const LS_DOC = LS_PREFIX + 'doc';
  const LS_BACKUPS = LS_PREFIX + 'backups';

  let db = null;
  let usingFallback = false;
  let editsSinceBackup = 0;
  let backupTimer = null;
  let lastSaveError = null;

  /**
   * True once a signed-in session has a project open on the server. Everything
   * that has two implementations branches on this one flag, so there is a single
   * answer to "where does this go" rather than a scattering of checks.
   */
  let hosted = false;

  /* ── IndexedDB plumbing ────────────────────────────────────────────────── */

  function openDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_PROJECTS)) {
          database.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(STORE_BACKUPS)) {
          const s = database.createObjectStore(STORE_BACKUPS, { keyPath: 'key', autoIncrement: true });
          s.createIndex('time', 'time');
          s.createIndex('projectId', 'projectId');
        }
        if (!database.objectStoreNames.contains(STORE_BLOBS)) {
          database.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(STORE_PREFS)) {
          database.createObjectStore(STORE_PREFS, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
    });
  }

  function tx(storeName, mode = 'readonly') {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /* ── localStorage fallback ─────────────────────────────────────────────── */

  function lsAvailable() {
    try {
      const probe = LS_PREFIX + 'probe';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  function lsGetJSON(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function lsSetJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  /**
   * Open the store and return the document to load.
   *
   * Hosted: the project last open on this device, or the most recent one the
   * account can reach, or a fresh starter project created on the server.
   * Local: the most recently saved project, or a seeded starter on first run.
   */
  async function init() {
    try {
      db = await openDb();
      usingFallback = false;
    } catch (err) {
      usingFallback = true;
      console.warn('[cx-timeline] IndexedDB unavailable, falling back to localStorage:', err.message);
      if (!lsAvailable()) {
        console.error('[cx-timeline] No persistent storage available — changes will not survive a reload.');
      }
    }

    wireAutosave();

    if (cloud.isSignedIn()) {
      const opened = await openFromCloud();
      if (opened) return opened;
      // Signing in and then failing to reach the data is worth saying out loud
      // rather than silently dropping the user into an unrelated local project.
      console.warn('[cx-timeline] signed in but could not open a project; falling back to local storage');
    }

    const saved = await loadLatest();
    if (saved) return { doc: normalise(saved), fresh: false };
    return { doc: normalise(makeStarterProject()), fresh: true };
  }

  /**
   * Choose and open a project on the server.
   * Returns the same shape as `init()`, or null when nothing could be opened.
   */
  async function openFromCloud() {
    try {
      const projects = await cloud.listProjects();

      // Prefer whatever this device had open, so a reload lands where you were.
      const remembered = getPref('lastProject');
      const wanted = projects.find((p) => p.id === remembered) || projects[0];

      if (!wanted) {
        const doc = normalise(makeStarterProject());
        await cloud.createProject(doc);
        hosted = true;
        setPref('lastProject', cloud.getProjectId());
        return { doc, fresh: true };
      }

      const doc = await cloud.openProject(wanted.id);
      if (!doc) return null;
      hosted = true;
      setPref('lastProject', wanted.id);
      return { doc: normalise(doc), fresh: false };
    } catch (err) {
      console.warn('[cx-timeline] could not load from the server:', err.message);
      return null;
    }
  }

  /** Open a different project. Used by the Projects pane. */
  async function switchProject(id) {
    const doc = await cloud.openProject(id);
    if (!doc) throw new Error('That project is no longer available.');
    hosted = true;
    setPref('lastProject', id);
    editsSinceBackup = 0;
    return normalise(doc);
  }

  /** Create a project on the server from a document, and open it. */
  async function createCloudProject(doc) {
    const id = await cloud.createProject(normalise(doc));
    hosted = true;
    setPref('lastProject', id);
    editsSinceBackup = 0;
    return id;
  }

  /** True when the document is being kept on the server. */
  function isHosted() {
    return hosted;
  }

  /** True when running on the localStorage fallback path. */
  function isFallback() {
    return usingFallback;
  }

  async function loadLatest() {
    if (usingFallback) return lsGetJSON(LS_DOC);
    try {
      const all = await wrap(tx(STORE_PROJECTS).getAll());
      if (!all || !all.length) return null;
      all.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      return all[0].doc;
    } catch (err) {
      console.warn('[cx-timeline] load failed:', err);
      return null;
    }
  }

  /** Every project on disk, newest first — the "Open project" dialog uses this. */
  async function listProjects() {
    if (usingFallback) {
      const d = lsGetJSON(LS_DOC);
      return d ? [{ id: d.id, name: d.name, savedAt: d.modified, objects: (d.objects || []).length }] : [];
    }
    try {
      const all = await wrap(tx(STORE_PROJECTS).getAll());
      return all
        .map((r) => ({ id: r.id, name: r.doc?.name || 'Untitled', savedAt: r.savedAt, objects: (r.doc?.objects || []).length }))
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      return [];
    }
  }

  async function loadProject(id) {
    if (usingFallback) {
      const d = lsGetJSON(LS_DOC);
      return d && d.id === id ? d : null;
    }
    const record = await wrap(tx(STORE_PROJECTS).get(id));
    return record ? record.doc : null;
  }

  async function deleteProject(id) {
    if (usingFallback) {
      localStorage.removeItem(LS_DOC);
      return;
    }
    await wrap(tx(STORE_PROJECTS, 'readwrite').delete(id));
  }

  /* ── Saving ────────────────────────────────────────────────────────────── */

  /**
   * Write the current document. Resolves once the write is durable.
   * Callers never need this directly — autosave handles it — but export and
   * "close window" paths flush explicitly.
   */
  async function saveNow() {
    const doc = getDoc();
    emit(EV.SAVE_START);
    try {
      const record = { id: doc.id, savedAt: Date.now(), doc };

      if (hosted) {
        const result = await cloud.saveProject(doc);

        if (!result.ok) {
          // A read-only refusal is not a failure to report as one: the user is
          // simply browsing, and the write guard has already told them.
          if (result.reason === 'read-only') {
            markClean();
            emit(EV.SAVE_DONE, { at: Date.now(), skipped: true });
            return true;
          }
          if (result.conflict) {
            // Never overwrite: keep the work in the local cache so it can be
            // recovered, and let the UI decide what to offer.
            await cacheLocally(record);
            emit(EV.SAVE_ERROR, { error: new Error('conflict'), conflict: true });
            return false;
          }
          throw new Error(result.reason || 'save failed');
        }

        // A local copy of every successful save is what makes a dropped
        // connection survivable, and what the crash-recovery path reads.
        await cacheLocally(record);
      } else if (usingFallback) {
        lsSetJSON(LS_DOC, doc);
      } else {
        await wrap(tx(STORE_PROJECTS, 'readwrite').put(record));
      }

      markClean();
      lastSaveError = null;
      emit(EV.SAVE_DONE, { at: record.savedAt });

      editsSinceBackup++;
      const every = doc.settings.backupEveryEdits || 0;
      if (every > 0 && editsSinceBackup >= every) {
        editsSinceBackup = 0;
        makeBackup('edit-count').catch(() => {});
      }
      return true;
    } catch (err) {
      lastSaveError = err;
      console.error('[cx-timeline] save failed:', err);
      emit(EV.SAVE_ERROR, { error: err });
      // A quota failure is the common case; surface it rather than silently
      // dropping the user's work.
      if (err && /quota/i.test(err.name || err.message || '')) {
        emit(EV.TOAST, {
          tone: 'bad',
          title: 'Storage full',
          message: 'Delete old backups or attachments to free space. Recent changes are not saved.',
          sticky: true,
        });
      }
      return false;
    }
  }

  /** Mirror a save into IndexedDB. Best-effort: the server is the record. */
  async function cacheLocally(record) {
    if (usingFallback) {
      try {
        lsSetJSON(LS_DOC, record.doc);
      } catch {
        /* the cache is a convenience, not the record */
      }
      return;
    }
    try {
      await wrap(tx(STORE_PROJECTS, 'readwrite').put(record));
    } catch {
      /* a full local cache must never block a successful server save */
    }
  }

  const scheduleSave = debounce(() => {
    saveNow();
  }, 500);

  function getLastSaveError() {
    return lastSaveError;
  }

  function wireAutosave() {
    on(EV.DOC_CHANGED, (payload) => {
      if (payload?.transient) return; // mid-drag previews never hit disk
      scheduleSave();
    });

    // A close or reload must not lose the last few hundred milliseconds of work.
    window.addEventListener('beforeunload', () => {
      if (isDirty()) {
        scheduleSave.cancel();
        // Synchronous best-effort mirror; IndexedDB cannot complete here.
        try {
          lsSetJSON(LS_DOC + '.recovery', getDoc());
        } catch {
          /* out of space — nothing more we can do at unload time */
        }
      }
    });

    // Flush when the tab is hidden — on mobile and on OS sleep this is often
    // the last callback a page receives.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && isDirty()) {
        scheduleSave.flush();
      }
    });

    startBackupTimer();
  }

  /**
   * Recover a document written by the unload handler after an unclean exit,
   * if it is newer than what made it into IndexedDB.
   */
  function takeRecovery(currentDoc) {
    const recovery = lsGetJSON(LS_DOC + '.recovery');
    localStorage.removeItem(LS_DOC + '.recovery');
    if (!recovery || !recovery.id) return null;
    if (currentDoc && recovery.id === currentDoc.id && (recovery.modified || 0) <= (currentDoc.modified || 0)) return null;
    return recovery;
  }

  /* ── Backups ───────────────────────────────────────────────────────────── */

  function startBackupTimer() {
    clearInterval(backupTimer);
    const minutes = getDoc().settings.autoBackupMinutes || 60;
    if (minutes <= 0) return;
    backupTimer = setInterval(() => {
      makeBackup('scheduled').catch(() => {});
    }, minutes * 60_000);
  }

  /** Restart the timer after the interval setting changes. */
  function refreshBackupSchedule() {
    startBackupTimer();
  }

  /** Snapshot the current document into the backup store. */
  async function makeBackup(reason = 'manual') {
    const doc = getDoc();
    const entry = {
      time: Date.now(),
      reason,
      projectId: doc.id,
      name: doc.name,
      objects: doc.objects.length,
      doc,
    };
    try {
      if (hosted) {
        const written = await cloud.createBackup(doc, reason);
        if (!written) return false; // read-only, or the server said no
        await cloud.pruneBackups(doc.settings.backupKeep || 20);
      } else if (usingFallback) {
        const list = lsGetJSON(LS_BACKUPS, []);
        list.push({ ...entry, key: entry.time });
        // localStorage is tight; keep far fewer snapshots on the fallback path.
        while (list.length > 5) list.shift();
        lsSetJSON(LS_BACKUPS, list);
      } else {
        await wrap(tx(STORE_BACKUPS, 'readwrite').add(entry));
        await pruneBackups(doc.settings.backupKeep || 20);
      }
      emit(EV.BACKUP_MADE, { reason, time: entry.time });
      return true;
    } catch (err) {
      console.warn('[cx-timeline] backup failed:', err);
      return false;
    }
  }

  async function listBackups() {
    if (hosted) {
      try {
        return await cloud.listBackups();
      } catch (err) {
        console.warn('[cx-timeline] could not list backups:', err.message);
        return [];
      }
    }
    if (usingFallback) {
      return lsGetJSON(LS_BACKUPS, [])
        .map((b) => ({ key: b.key, time: b.time, reason: b.reason, name: b.name, objects: b.objects, size: 0 }))
        .sort((a, b) => b.time - a.time);
    }
    try {
      const all = await wrap(tx(STORE_BACKUPS).getAll());
      return all
        .map((b) => ({
          key: b.key,
          time: b.time,
          reason: b.reason,
          name: b.name,
          objects: b.objects,
          size: estimateSize(b.doc),
        }))
        .sort((a, b) => b.time - a.time);
    } catch {
      return [];
    }
  }

  async function loadBackup(key) {
    if (hosted) return cloud.loadBackup(key);
    if (usingFallback) {
      const found = lsGetJSON(LS_BACKUPS, []).find((b) => b.key === key);
      return found ? found.doc : null;
    }
    const record = await wrap(tx(STORE_BACKUPS).get(key));
    return record ? record.doc : null;
  }

  async function deleteBackup(key) {
    if (hosted) {
      await cloud.deleteBackup(key);
      return;
    }
    if (usingFallback) {
      lsSetJSON(LS_BACKUPS, lsGetJSON(LS_BACKUPS, []).filter((b) => b.key !== key));
      return;
    }
    await wrap(tx(STORE_BACKUPS, 'readwrite').delete(key));
  }

  /** Trim the backup history to the newest `keep` entries. */
  async function pruneBackups(keep = 20) {
    if (hosted) {
      await cloud.pruneBackups(keep);
      return;
    }
    if (usingFallback || keep <= 0) return;
    const all = await wrap(tx(STORE_BACKUPS).getAll());
    if (all.length <= keep) return;
    all.sort((a, b) => a.time - b.time);
    const store = tx(STORE_BACKUPS, 'readwrite');
    for (const record of all.slice(0, all.length - keep)) store.delete(record.key);
  }

  function estimateSize(doc) {
    try {
      return JSON.stringify(doc).length;
    } catch {
      return 0;
    }
  }

  /* ── Attachment blobs ──────────────────────────────────────────────────── */

  /**
   * Store a file's bytes. Attachments live outside the document so a project
   * with 200 MB of logs still autosaves in milliseconds.
   */
  async function putBlob(id, file) {
    if (hosted) return cloud.putBlob(id, file);
    const record = { id, name: file.name, type: file.type, size: file.size, added: Date.now(), blob: file };
    if (usingFallback) {
      throw new Error('Attachments require IndexedDB, which is not available in this browser session.');
    }
    await wrap(tx(STORE_BLOBS, 'readwrite').put(record));
    return { id, name: file.name, type: file.type, size: file.size };
  }

  async function getBlob(id) {
    if (hosted) {
      const blob = await cloud.getBlob(id);
      return blob ? { id, blob, name: id, type: blob.type, size: blob.size } : null;
    }
    if (usingFallback) return null;
    const record = await wrap(tx(STORE_BLOBS).get(id));
    return record || null;
  }

  async function deleteBlob(id) {
    if (hosted) {
      await cloud.deleteBlob(id);
      return;
    }
    if (usingFallback) return;
    await wrap(tx(STORE_BLOBS, 'readwrite').delete(id));
  }

  /** Total bytes held in the blob store — shown in Settings. */
  async function blobUsage() {
    if (usingFallback) return { count: 0, bytes: 0, label: '0 B' };
    try {
      const all = await wrap(tx(STORE_BLOBS).getAll());
      const total = all.reduce((sum, r) => sum + (r.size || 0), 0);
      return { count: all.length, bytes: total, label: bytes(total) };
    } catch {
      return { count: 0, bytes: 0, label: '0 B' };
    }
  }

  /**
   * Delete blobs no longer referenced by the document. Called after bulk
   * deletions so removed attachments do not linger and consume quota.
   */
  async function collectGarbage() {
    if (usingFallback) return 0;
    const doc = getDoc();
    const live = new Set(doc.attachments.map((a) => a.id));
    const all = await wrap(tx(STORE_BLOBS).getAll());
    const store = tx(STORE_BLOBS, 'readwrite');
    let removed = 0;
    for (const record of all) {
      if (!live.has(record.id)) {
        store.delete(record.id);
        removed++;
      }
    }
    return removed;
  }

  /* ── Preferences (device-scoped, not part of the document) ─────────────── */

  function getPref(key, fallback = null) {
    const value = lsGetJSON(LS_PREFIX + key);
    return value === null || value === undefined ? fallback : value;
  }

  function setPref(key, value) {
    try {
      lsSetJSON(LS_PREFIX + key, value);
    } catch {
      /* preferences are best-effort */
    }
  }

  /* ── Diagnostics ───────────────────────────────────────────────────────── */

  /** Storage report for the Settings panel. */
  async function usage() {
    const doc = getDoc();
    const docBytes = estimateSize(doc);
    const blobs = await blobUsage();
    let quota = null;
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        quota = { used: est.usage, total: est.quota };
      }
    } catch {
      /* not supported — the report simply omits the quota line */
    }
    return {
      backend: hosted
        ? 'Supabase (this device keeps an offline copy)'
        : usingFallback
          ? 'localStorage (fallback)'
          : 'IndexedDB',
      document: { bytes: docBytes, label: bytes(docBytes) },
      attachments: blobs,
      quota,
    };
  }

  Object.defineProperty(__x, "init", { get: () => init, enumerable: true });
  Object.defineProperty(__x, "switchProject", { get: () => switchProject, enumerable: true });
  Object.defineProperty(__x, "createCloudProject", { get: () => createCloudProject, enumerable: true });
  Object.defineProperty(__x, "isHosted", { get: () => isHosted, enumerable: true });
  Object.defineProperty(__x, "isFallback", { get: () => isFallback, enumerable: true });
  Object.defineProperty(__x, "listProjects", { get: () => listProjects, enumerable: true });
  Object.defineProperty(__x, "loadProject", { get: () => loadProject, enumerable: true });
  Object.defineProperty(__x, "deleteProject", { get: () => deleteProject, enumerable: true });
  Object.defineProperty(__x, "saveNow", { get: () => saveNow, enumerable: true });
  Object.defineProperty(__x, "getLastSaveError", { get: () => getLastSaveError, enumerable: true });
  Object.defineProperty(__x, "takeRecovery", { get: () => takeRecovery, enumerable: true });
  Object.defineProperty(__x, "refreshBackupSchedule", { get: () => refreshBackupSchedule, enumerable: true });
  Object.defineProperty(__x, "makeBackup", { get: () => makeBackup, enumerable: true });
  Object.defineProperty(__x, "listBackups", { get: () => listBackups, enumerable: true });
  Object.defineProperty(__x, "loadBackup", { get: () => loadBackup, enumerable: true });
  Object.defineProperty(__x, "deleteBackup", { get: () => deleteBackup, enumerable: true });
  Object.defineProperty(__x, "pruneBackups", { get: () => pruneBackups, enumerable: true });
  Object.defineProperty(__x, "putBlob", { get: () => putBlob, enumerable: true });
  Object.defineProperty(__x, "getBlob", { get: () => getBlob, enumerable: true });
  Object.defineProperty(__x, "deleteBlob", { get: () => deleteBlob, enumerable: true });
  Object.defineProperty(__x, "blobUsage", { get: () => blobUsage, enumerable: true });
  Object.defineProperty(__x, "collectGarbage", { get: () => collectGarbage, enumerable: true });
  Object.defineProperty(__x, "getPref", { get: () => getPref, enumerable: true });
  Object.defineProperty(__x, "setPref", { get: () => setPref, enumerable: true });
  Object.defineProperty(__x, "usage", { get: () => usage, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// core/analysis.js
// ════════════════════════════════════════════════════════════════════════
__mods["core/analysis.js"] = function (__x, __req) {
  /**
   * Schedule analysis: critical path, float, baseline variance and slip.
   *
   * The dependency graph is a DAG (the store refuses links that would close a
   * loop), so the classic forward/backward pass applies directly. Durations come
   * from the objects themselves rather than from a separate calendar, which
   * keeps the analysis honest: what you see on the bar is what is analysed.
   *
   * Imports: dates, model.
   */

  const { MS_DAY, daysBetween, workingDaysBetween } = __req("core/dates.js");
  const { TYPES, LINK_TYPES, effectiveToday } = __req("core/model.js");

  /* ══════════════════════════════════════════════════════════════════════════
     Memoisation

     The store never mutates a document in place — every write produces a new
     object graph — so document identity is a perfect cache key. A WeakMap keyed
     on the document gives free invalidation (a new document misses) and free
     eviction (old documents are collected), with no revision counter to keep in
     step. This matters because violations are re-read on every rendered frame
     of a drag, by the renderer, the inspector, the panels and the status bar.
     ═══════════════════════════════════════════════════════════════════════ */

  const criticalCache = new WeakMap();
  const violationCache = new WeakMap();

  /* ══════════════════════════════════════════════════════════════════════════
     Dependency constraints
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Evaluate one dependency.
   *
   * Each relationship pins one date of the successor against one date of the
   * predecessor, offset by the link's lag (negative lag is a lead, and relaxes
   * the constraint):
   *
   *   FS  successor starts  ≥ predecessor finishes + lag
   *   SS  successor starts  ≥ predecessor starts   + lag
   *   FF  successor finishes ≥ predecessor finishes + lag
   *   SF  successor finishes ≥ predecessor starts   + lag
   *
   * `slackDays` is how much room is left: zero is exactly tight, negative means
   * the plan is now impossible by that many days.
   */
  function evaluateLink(link, predecessor, successor) {
    if (!predecessor || !successor) return null;

    const lag = (link.lag || 0) * MS_DAY;
    const predStart = predecessor.start;
    const predEnd = TYPES[predecessor.type]?.duration ? predecessor.end : predecessor.start;
    const succStart = successor.start;
    const succEnd = TYPES[successor.type]?.duration ? successor.end : successor.start;

    let required;
    let actual;
    let edge;

    switch ((LINK_TYPES[link.type] || LINK_TYPES.FS).short) {
      case 'SS':
        required = predStart + lag;
        actual = succStart;
        edge = 'start';
        break;
      case 'FF':
        required = predEnd + lag;
        actual = succEnd;
        edge = 'end';
        break;
      case 'SF':
        required = predStart + lag;
        actual = succEnd;
        edge = 'end';
        break;
      case 'FS':
      default:
        required = predEnd + lag;
        actual = succStart;
        edge = 'start';
        break;
    }

    const slackDays = Math.round((actual - required) / MS_DAY);
    return {
      id: link.id,
      type: link.type,
      lag: link.lag || 0,
      required,
      actual,
      edge,
      slackDays,
      violated: slackDays < 0,
      /** Days the successor would have to move to satisfy the link. */
      shortfallDays: slackDays < 0 ? -slackDays : 0,
    };
  }

  /**
   * Every dependency whose precedence constraint is currently broken.
   *
   * Memoised per document, so the renderer can ask on every frame of a drag
   * without recomputing.
   *
   * @returns {{byLink: Map, objects: Map, links: Set, count: number, worst: number}}
   */
  function linkViolations(doc) {
    const cached = violationCache.get(doc);
    if (cached) return cached;

    const byId = new Map(doc.objects.map((o) => [o.id, o]));
    const byLink = new Map();
    const objects = new Map(); // object id -> the violations it is party to
    const links = new Set();
    let worst = 0;

    for (const link of doc.links) {
      const predecessor = byId.get(link.from);
      const successor = byId.get(link.to);
      const result = evaluateLink(link, predecessor, successor);
      if (!result) continue;

      byLink.set(link.id, result);
      if (!result.violated) continue;

      links.add(link.id);
      worst = Math.max(worst, result.shortfallDays);

      for (const [id, role] of [[link.from, 'predecessor'], [link.to, 'successor']]) {
        if (!objects.has(id)) objects.set(id, []);
        objects.get(id).push({ ...result, role, otherId: role === 'predecessor' ? link.to : link.from });
      }
    }

    const result = { byLink, objects, links, count: links.size, worst };
    violationCache.set(doc, result);
    return result;
  }

  /**
   * The dates that would satisfy a link, for a one-click fix.
   * Moving the successor preserves its duration.
   */
  function resolutionFor(link, predecessor, successor) {
    const evaluated = evaluateLink(link, predecessor, successor);
    if (!evaluated || !evaluated.violated) return null;

    const shift = evaluated.required - evaluated.actual;
    const hasDuration = !!TYPES[successor.type]?.duration;
    return {
      id: successor.id,
      start: successor.start + shift,
      end: hasDuration ? successor.end + shift : successor.start + shift,
      shiftDays: Math.round(shift / MS_DAY),
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Critical path
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Forward/backward pass over the dependency network.
   *
   * Returns per-object early/late dates and total float, plus the set of ids on
   * the critical path (zero float). Objects with no dependencies at all are
   * excluded from the critical set — an isolated bar is not "critical", it is
   * simply unconnected, and marking it so would drown the real chain.
   */
  function criticalPath(doc) {
    const cached = criticalCache.get(doc);
    if (cached) return cached;

    const objects = doc.objects.filter((o) => !o.hidden);
    const byId = new Map(objects.map((o) => [o.id, o]));
    const links = doc.links.filter((l) => byId.has(l.from) && byId.has(l.to));

    const successors = new Map();
    const predecessors = new Map();
    const degree = new Map();
    for (const o of objects) {
      successors.set(o.id, []);
      predecessors.set(o.id, []);
      degree.set(o.id, 0);
    }
    for (const link of links) {
      successors.get(link.from).push(link);
      predecessors.get(link.to).push(link);
      degree.set(link.to, degree.get(link.to) + 1);
    }

    // Topological order (Kahn). The graph is acyclic by construction, but guard
    // anyway: a hand-edited JSON file could arrive with a cycle in it.
    const order = [];
    const queue = objects.filter((o) => degree.get(o.id) === 0).map((o) => o.id);
    const working = new Map(degree);
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      for (const link of successors.get(id)) {
        const next = working.get(link.to) - 1;
        working.set(link.to, next);
        if (next === 0) queue.push(link.to);
      }
    }
    if (order.length !== objects.length) {
      // Cycle present — fall back to document order so analysis still returns.
      for (const o of objects) if (!order.includes(o.id)) order.push(o.id);
    }

    const early = new Map(); // id -> {start, finish}
    for (const id of order) {
      const obj = byId.get(id);
      const duration = durationMs(obj);
      let start = obj.start;
      for (const link of predecessors.get(id)) {
        const pred = early.get(link.from);
        if (!pred) continue;
        const lag = (link.lag || 0) * MS_DAY;
        const spec = LINK_TYPES[link.type] || LINK_TYPES.FS;
        let constraint;
        switch (spec.short) {
          case 'SS': constraint = pred.start + lag; break;
          case 'FF': constraint = pred.finish + lag - duration; break;
          case 'SF': constraint = pred.start + lag - duration; break;
          case 'FS':
          default: constraint = pred.finish + lag; break;
        }
        if (constraint > start) start = constraint;
      }
      early.set(id, { start, finish: start + duration });
    }

    const projectFinish = Math.max(...Array.from(early.values(), (e) => e.finish), -Infinity);

    const late = new Map();
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      const obj = byId.get(id);
      const duration = durationMs(obj);
      let finish = projectFinish;
      const succs = successors.get(id);
      if (succs.length) {
        finish = Infinity;
        for (const link of succs) {
          const next = late.get(link.to);
          if (!next) continue;
          const lag = (link.lag || 0) * MS_DAY;
          const spec = LINK_TYPES[link.type] || LINK_TYPES.FS;
          let constraint;
          switch (spec.short) {
            case 'SS': constraint = next.start - lag + duration; break;
            case 'FF': constraint = next.finish - lag; break;
            case 'SF': constraint = next.finish - lag + duration; break;
            case 'FS':
            default: constraint = next.start - lag; break;
          }
          if (constraint < finish) finish = constraint;
        }
        if (!Number.isFinite(finish)) finish = projectFinish;
      }
      late.set(id, { start: finish - duration, finish });
    }

    const floats = new Map();
    const critical = new Set();
    for (const id of order) {
      const e = early.get(id);
      const l = late.get(id);
      if (!e || !l) continue;
      const floatDays = Math.round((l.start - e.start) / MS_DAY);
      floats.set(id, floatDays);
      const connected = successors.get(id).length > 0 || predecessors.get(id).length > 0;
      if (connected && floatDays <= 0) critical.add(id);
    }

    const result = { critical, floats, early, late, projectFinish, order };
    criticalCache.set(doc, result);
    return result;
  }

  function durationMs(obj) {
    return TYPES[obj.type]?.duration ? Math.max(MS_DAY, obj.end - obj.start) : 0;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Baseline comparison
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Compare the live plan against a baseline snapshot.
   *
   * Returns one row per object that moved, plus rows for objects that were
   * added or removed since the baseline was taken — scope change is as much a
   * part of the story as slippage.
   */
  function compareBaseline(doc, baseline) {
    if (!baseline) return { rows: [], summary: emptySummary() };

    const snapshot = new Map(baseline.snapshot.map((s) => [s.id, s]));
    const live = new Map(doc.objects.map((o) => [o.id, o]));
    const rows = [];

    for (const [id, snap] of snapshot) {
      const obj = live.get(id);
      if (!obj) {
        rows.push({
          id,
          title: snap.title,
          change: 'removed',
          startShift: 0,
          endShift: 0,
          durationChange: 0,
          baseline: snap,
          current: null,
        });
        continue;
      }
      const hasDuration = !!TYPES[obj.type]?.duration;
      const startShift = daysBetween(snap.start, obj.start);
      const endShift = hasDuration ? daysBetween(snap.end ?? snap.start, obj.end) : startShift;
      const baseDuration = hasDuration ? daysBetween(snap.start, snap.end ?? snap.start) : 0;
      const nowDuration = hasDuration ? daysBetween(obj.start, obj.end) : 0;

      if (startShift === 0 && endShift === 0 && baseDuration === nowDuration) continue;

      rows.push({
        id,
        title: obj.title,
        type: obj.type,
        lane: obj.lane,
        change: endShift > 0 ? 'slip' : endShift < 0 ? 'ahead' : 'reshaped',
        startShift,
        endShift,
        durationChange: nowDuration - baseDuration,
        baseline: snap,
        current: obj,
      });
    }

    for (const [id, obj] of live) {
      if (snapshot.has(id)) continue;
      rows.push({
        id,
        title: obj.title,
        type: obj.type,
        lane: obj.lane,
        change: 'added',
        startShift: 0,
        endShift: 0,
        durationChange: TYPES[obj.type]?.duration ? daysBetween(obj.start, obj.end) : 0,
        baseline: null,
        current: obj,
      });
    }

    rows.sort((a, b) => Math.abs(b.endShift) - Math.abs(a.endShift) || a.title.localeCompare(b.title));

    const summary = {
      slipped: rows.filter((r) => r.change === 'slip').length,
      ahead: rows.filter((r) => r.change === 'ahead').length,
      reshaped: rows.filter((r) => r.change === 'reshaped').length,
      added: rows.filter((r) => r.change === 'added').length,
      removed: rows.filter((r) => r.change === 'removed').length,
      worstSlip: rows.reduce((max, r) => Math.max(max, r.endShift), 0),
      bestGain: rows.reduce((min, r) => Math.min(min, r.endShift), 0),
      totalRows: rows.length,
    };

    return { rows, summary };
  }

  function emptySummary() {
    return { slipped: 0, ahead: 0, reshaped: 0, added: 0, removed: 0, worstSlip: 0, bestGain: 0, totalRows: 0 };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Health & progress
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Per-object schedule health against the effective "today".
   * `expected` is straight-line expected progress; the variance against actual
   * percent complete is what flags trouble before a date is formally missed.
   */
  function objectHealth(obj, today) {
    const def = TYPES[obj.type];
    if (!def?.duration) {
      if (obj.status === 'complete' || obj.status === 'released' || obj.status === 'closed') return { state: 'done', label: 'Complete' };
      if (obj.start < today) return { state: 'late', label: 'Date passed', days: daysBetween(obj.start, today) };
      return { state: 'future', label: 'Upcoming' };
    }

    const total = Math.max(1, obj.end - obj.start);
    const elapsed = Math.min(total, Math.max(0, today - obj.start));
    const expected = Math.round((elapsed / total) * 100);
    const actual = obj.progress || 0;

    if (actual >= 100) return { state: 'done', label: 'Complete', expected, actual, variance: 100 - expected };
    if (today > obj.end) return { state: 'overdue', label: 'Overdue', expected: 100, actual, variance: actual - 100, days: daysBetween(obj.end, today) };
    if (today < obj.start) return { state: 'future', label: 'Not started', expected: 0, actual, variance: actual };

    const variance = actual - expected;
    if (variance < -15) return { state: 'behind', label: 'Behind plan', expected, actual, variance };
    if (variance > 10) return { state: 'ahead', label: 'Ahead of plan', expected, actual, variance };
    return { state: 'ontrack', label: 'On track', expected, actual, variance };
  }

  /** Programme-level roll-up for the status bar and the review panes. */
  function programmeHealth(doc) {
    const today = effectiveToday(doc);
    const counts = { done: 0, ontrack: 0, ahead: 0, behind: 0, overdue: 0, future: 0, late: 0 };
    let weighted = 0;
    let weight = 0;

    for (const obj of doc.objects) {
      if (obj.hidden) continue;
      const health = objectHealth(obj, today);
      counts[health.state] = (counts[health.state] || 0) + 1;
      if (TYPES[obj.type]?.progress) {
        const days = Math.max(1, (obj.end - obj.start) / MS_DAY);
        weighted += (obj.progress || 0) * days;
        weight += days;
      }
    }

    return {
      counts,
      percentComplete: weight ? Math.round(weighted / weight) : 0,
      atRisk: counts.behind + counts.overdue + counts.late,
      today,
    };
  }

  /**
   * Slip analysis relative to a baseline, grouped by lane — the view a
   * commissioning manager actually wants in a progress meeting.
   */
  function slipByLane(doc, baseline) {
    const { rows } = compareBaseline(doc, baseline);
    const byLane = new Map();
    for (const row of rows) {
      if (!row.current) continue;
      const laneId = row.current.lane;
      if (!byLane.has(laneId)) byLane.set(laneId, { laneId, slip: 0, count: 0, worst: 0, rows: [] });
      const entry = byLane.get(laneId);
      entry.count++;
      entry.slip += row.endShift;
      entry.worst = Math.max(entry.worst, row.endShift);
      entry.rows.push(row);
    }
    return Array.from(byLane.values()).sort((a, b) => b.worst - a.worst);
  }

  /**
   * Working days remaining on an object, honouring the project's holiday list.
   */
  function workingDaysRemaining(obj, today, holidays = []) {
    if (!TYPES[obj.type]?.duration) return 0;
    const from = Math.max(today, obj.start);
    if (from >= obj.end) return 0;
    return workingDaysBetween(from, obj.end, holidays);
  }

  Object.defineProperty(__x, "evaluateLink", { get: () => evaluateLink, enumerable: true });
  Object.defineProperty(__x, "linkViolations", { get: () => linkViolations, enumerable: true });
  Object.defineProperty(__x, "resolutionFor", { get: () => resolutionFor, enumerable: true });
  Object.defineProperty(__x, "criticalPath", { get: () => criticalPath, enumerable: true });
  Object.defineProperty(__x, "compareBaseline", { get: () => compareBaseline, enumerable: true });
  Object.defineProperty(__x, "objectHealth", { get: () => objectHealth, enumerable: true });
  Object.defineProperty(__x, "programmeHealth", { get: () => programmeHealth, enumerable: true });
  Object.defineProperty(__x, "slipByLane", { get: () => slipByLane, enumerable: true });
  Object.defineProperty(__x, "workingDaysRemaining", { get: () => workingDaysRemaining, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// timeline/viewport.js
// ════════════════════════════════════════════════════════════════════════
__mods["timeline/viewport.js"] = function (__x, __req) {
  /**
   * The viewport — the mapping between time and screen space.
   *
   * The timeline is conceptually infinite: there is no scroll container sized to
   * the project, and no maximum date. Instead the viewport holds two numbers —
   * the instant at the left edge (`originMs`) and the horizontal density
   * (`pxPerDay`) — and every pixel position is derived from them. Panning
   * changes the origin, zooming changes the density around an anchor point, and
   * only the currently visible slice is ever rendered.
   *
   * Imports: util, events, dates.
   */

  const { clamp } = __req("core/util.js");
  const { emit, EV } = __req("core/events.js");
  const { MS_DAY, SCALES, startOfDay } = __req("core/dates.js");

  /** Zoom bounds: ~28 years across a 1600px window, down to ~6 days. */
  const MIN_PX_PER_DAY = 0.16;
  const MAX_PX_PER_DAY = 260;

  /** Named zoom stops the toolbar's scale buttons jump to. */
  const ZOOM_PRESETS = {
    day: 44,
    week: 12,
    month: 3.4,
    quarter: 1.15,
    year: 0.34,
  };

  let originMs = 0;
  let pxPerDay = 3.4;
  let width = 1000;
  let height = 600;
  let listenersSuspended = false;

  /* ── Accessors ─────────────────────────────────────────────────────────── */

  function getOrigin() {
    return originMs;
  }

  function getPxPerDay() {
    return pxPerDay;
  }

  function getWidth() {
    return width;
  }

  function getHeight() {
    return height;
  }

  /** Milliseconds visible across the whole viewport. */
  function spanMs() {
    return (width / pxPerDay) * MS_DAY;
  }

  /** The instant at the right edge. */
  function endMs() {
    return originMs + spanMs();
  }

  /** Current view as a plain object — handy for persistence and the minimap. */
  function state() {
    return { originMs, pxPerDay, width, height, endMs: endMs(), scale: currentScale().id };
  }

  /* ── Conversion ────────────────────────────────────────────────────────── */

  /** Time → x pixels, relative to the left edge of the canvas. */
  function msToPx(ms) {
    return ((ms - originMs) / MS_DAY) * pxPerDay;
  }

  /** x pixels → time. */
  function pxToMs(px) {
    return originMs + (px / pxPerDay) * MS_DAY;
  }

  /** Width in pixels of a duration in milliseconds. */
  function durationToPx(ms) {
    return (ms / MS_DAY) * pxPerDay;
  }

  /** Duration in milliseconds for a pixel width. */
  function pxToDuration(px) {
    return (px / pxPerDay) * MS_DAY;
  }

  /* ── Mutation ──────────────────────────────────────────────────────────── */

  function publish(reason) {
    if (listenersSuspended) return;
    emit(EV.VIEW_CHANGED, { ...state(), reason });
  }

  /** Batch several viewport changes into one notification. */
  function batch(fn) {
    listenersSuspended = true;
    try {
      fn();
    } finally {
      listenersSuspended = false;
      publish('batch');
    }
  }

  function setSize(w, h) {
    const changed = w !== width || h !== height;
    width = Math.max(1, w);
    height = Math.max(1, h);
    if (changed) publish('resize');
  }

  function setOrigin(ms, reason = 'pan') {
    if (ms === originMs) return;
    originMs = ms;
    publish(reason);
  }

  function panBy(dxPx) {
    if (!dxPx) return;
    originMs -= pxToDuration(dxPx);
    publish('pan');
  }

  /** Scroll so `ms` sits at a given fraction across the viewport. */
  function centerOn(ms, fraction = 0.5) {
    originMs = ms - spanMs() * fraction;
    publish('center');
  }

  /**
   * Zoom by a multiplicative factor, holding the instant currently under
   * `anchorPx` fixed. This is what makes wheel-zoom feel anchored to the cursor
   * rather than to the edge of the screen.
   */
  function zoomBy(factor, anchorPx = width / 2) {
    const anchorMs = pxToMs(anchorPx);
    const next = clamp(pxPerDay * factor, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
    if (next === pxPerDay) return;
    pxPerDay = next;
    originMs = anchorMs - (anchorPx / pxPerDay) * MS_DAY;
    publish('zoom');
  }

  /** Set absolute density, keeping `anchorPx` fixed. */
  function setPxPerDay(value, anchorPx = width / 2) {
    const anchorMs = pxToMs(anchorPx);
    pxPerDay = clamp(value, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
    originMs = anchorMs - (anchorPx / pxPerDay) * MS_DAY;
    publish('zoom');
  }

  /** Jump to a named zoom preset, keeping the viewport centre stable. */
  function setScalePreset(scaleId) {
    const target = ZOOM_PRESETS[scaleId];
    if (!target) return;
    setPxPerDay(target, width / 2);
    emit(EV.SCALE_CHANGED, { scale: scaleId });
  }

  /**
   * Fit a time range into the viewport with a little breathing room.
   * `padPx` reserves space on both sides (for the lane gutter, for instance).
   */
  function fitRange(startMs, stopMs, padPx = 40) {
    const usable = Math.max(120, width - padPx * 2);
    const days = Math.max(1, (stopMs - startMs) / MS_DAY);
    pxPerDay = clamp(usable / days, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
    originMs = startMs - pxToDuration(padPx);
    publish('fit');
  }

  /** Restore a persisted view. */
  function restore({ originMs: o, pxPerDay: p }) {
    if (Number.isFinite(p)) pxPerDay = clamp(p, MIN_PX_PER_DAY, MAX_PX_PER_DAY);
    if (Number.isFinite(o)) originMs = o;
    publish('restore');
  }

  /* ── Scale selection ───────────────────────────────────────────────────── */

  /**
   * The finest scale whose ticks stay legible at the current density.
   * SCALES is ordered fine → coarse, so the first match wins.
   */
  function currentScale() {
    for (const scale of SCALES) {
      if (pxPerDay >= scale.minPxPerDay) return scale;
    }
    return SCALES[SCALES.length - 1];
  }

  /** The scale one step coarser — the ruler's upper band. */
  function headerScale() {
    const current = currentScale();
    const i = SCALES.findIndex((s) => s.id === current.id);
    return SCALES[Math.min(SCALES.length - 1, i + 1)];
  }

  /**
   * The visible time window, padded by `overscanPx` on each side so objects
   * partially off-screen still render and scrolling stays seamless.
   */
  function visibleRange(overscanPx = 240) {
    const pad = pxToDuration(overscanPx);
    return { from: originMs - pad, to: endMs() + pad };
  }

  /** True when `ms` currently falls inside the viewport. */
  function isVisible(ms, overscanPx = 0) {
    const { from, to } = visibleRange(overscanPx);
    return ms >= from && ms <= to;
  }

  /** True when a time range intersects the viewport. */
  function rangeVisible(startMs, stopMs, overscanPx = 240) {
    const { from, to } = visibleRange(overscanPx);
    return stopMs >= from && startMs <= to;
  }

  /**
   * A readable description of the current zoom, e.g. "3.4 px/day · Month".
   * Shown in the status bar so the user always knows where they are.
   */
  function describeZoom() {
    const scale = currentScale();
    const days = spanMs() / MS_DAY;
    let span;
    if (days < 60) span = `${Math.round(days)} days`;
    else if (days < 730) span = `${(days / 30.44).toFixed(1)} months`;
    else span = `${(days / 365.25).toFixed(1)} years`;
    return { scale: scale.label, span, pxPerDay: pxPerDay.toFixed(2) };
  }

  /** Snap the origin to a whole day so gridlines land on exact pixels. */
  function alignOriginToDay() {
    originMs = startOfDay(originMs);
    publish('align');
  }

  Object.defineProperty(__x, "MIN_PX_PER_DAY", { get: () => MIN_PX_PER_DAY, enumerable: true });
  Object.defineProperty(__x, "MAX_PX_PER_DAY", { get: () => MAX_PX_PER_DAY, enumerable: true });
  Object.defineProperty(__x, "ZOOM_PRESETS", { get: () => ZOOM_PRESETS, enumerable: true });
  Object.defineProperty(__x, "getOrigin", { get: () => getOrigin, enumerable: true });
  Object.defineProperty(__x, "getPxPerDay", { get: () => getPxPerDay, enumerable: true });
  Object.defineProperty(__x, "getWidth", { get: () => getWidth, enumerable: true });
  Object.defineProperty(__x, "getHeight", { get: () => getHeight, enumerable: true });
  Object.defineProperty(__x, "spanMs", { get: () => spanMs, enumerable: true });
  Object.defineProperty(__x, "endMs", { get: () => endMs, enumerable: true });
  Object.defineProperty(__x, "state", { get: () => state, enumerable: true });
  Object.defineProperty(__x, "msToPx", { get: () => msToPx, enumerable: true });
  Object.defineProperty(__x, "pxToMs", { get: () => pxToMs, enumerable: true });
  Object.defineProperty(__x, "durationToPx", { get: () => durationToPx, enumerable: true });
  Object.defineProperty(__x, "pxToDuration", { get: () => pxToDuration, enumerable: true });
  Object.defineProperty(__x, "batch", { get: () => batch, enumerable: true });
  Object.defineProperty(__x, "setSize", { get: () => setSize, enumerable: true });
  Object.defineProperty(__x, "setOrigin", { get: () => setOrigin, enumerable: true });
  Object.defineProperty(__x, "panBy", { get: () => panBy, enumerable: true });
  Object.defineProperty(__x, "centerOn", { get: () => centerOn, enumerable: true });
  Object.defineProperty(__x, "zoomBy", { get: () => zoomBy, enumerable: true });
  Object.defineProperty(__x, "setPxPerDay", { get: () => setPxPerDay, enumerable: true });
  Object.defineProperty(__x, "setScalePreset", { get: () => setScalePreset, enumerable: true });
  Object.defineProperty(__x, "fitRange", { get: () => fitRange, enumerable: true });
  Object.defineProperty(__x, "restore", { get: () => restore, enumerable: true });
  Object.defineProperty(__x, "currentScale", { get: () => currentScale, enumerable: true });
  Object.defineProperty(__x, "headerScale", { get: () => headerScale, enumerable: true });
  Object.defineProperty(__x, "visibleRange", { get: () => visibleRange, enumerable: true });
  Object.defineProperty(__x, "isVisible", { get: () => isVisible, enumerable: true });
  Object.defineProperty(__x, "rangeVisible", { get: () => rangeVisible, enumerable: true });
  Object.defineProperty(__x, "describeZoom", { get: () => describeZoom, enumerable: true });
  Object.defineProperty(__x, "alignOriginToDay", { get: () => alignOriginToDay, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// core/query.js
// ════════════════════════════════════════════════════════════════════════
__mods["core/query.js"] = function (__x, __req) {
  /**
   * Query layer — filtering and full-text search over the document.
   *
   * Lives in core rather than the UI so the renderer, the exporters and the
   * search panel all apply exactly the same rules: what you filter is what you
   * export.
   *
   * Imports: util, dates, model.
   */

  const { fold, stripHtml, truncate } = __req("core/util.js");
  const { toMs, MS_DAY } = __req("core/dates.js");
  const { TYPES, listIds, statusOf, subsystemOf } = __req("core/model.js");

  /**
   * Build a predicate from the active filter set.
   * An empty filter list means "no constraint on this dimension", so a fresh
   * filter panel matches everything.
   */
  function filterPredicate(doc, filters) {
    const f = filters || {};
    const text = fold(f.text || '');
    const types = new Set(f.types || []);
    const statuses = new Set(f.statuses || []);
    const lanes = new Set(f.lanes || []);
    const owners = new Set(f.owners || []);
    const subsystems = new Set(f.subsystems || []);
    const areas = new Set(f.areas || []);
    const tags = new Set(f.tags || []);
    const from = f.from ? toMs(f.from) : null;
    const to = f.to ? toMs(f.to) : null;

    return (obj) => {
      if (types.size && !types.has(obj.type)) return false;
      if (statuses.size && !statuses.has(obj.status)) return false;
      if (lanes.size && !lanes.has(obj.lane)) return false;
      if (owners.size && !owners.has(obj.owner)) return false;
      if (subsystems.size && !subsystems.has(obj.subsystem)) return false;
      if (areas.size && !areas.has(obj.area)) return false;
      if (tags.size && !(obj.tags || []).some((t) => tags.has(t))) return false;

      if (from != null || to != null) {
        const start = obj.start;
        const end = TYPES[obj.type]?.duration ? obj.end : obj.start + MS_DAY;
        if (from != null && end < from) return false;
        if (to != null && start > to) return false;
      }

      if (text) {
        if (!fold(searchableText(obj)).includes(text)) return false;
      }
      return true;
    };
  }

  /** Everything about an object that global search should look inside. */
  function searchableText(obj) {
    const data = obj.data || {};
    return [
      obj.title,
      obj.subtitle,
      obj.owner,
      obj.area,
      obj.subsystem,
      obj.status,
      (obj.tags || []).join(' '),
      stripHtml(obj.notes),
      data.version,
      data.releaseNumber,
      data.buildNumber,
      data.testPackage,
      data.reference,
      data.mitigation,
      data.testKind,
    ]
      .filter(Boolean)
      .join(' ');
  }

  /**
   * Global search across the whole document.
   * Returns ranked results: title matches first, then metadata, then notes.
   */
  function search(doc, query, { limit = 60 } = {}) {
    const q = fold(String(query || '').trim());
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    const laneNames = new Map(doc.lanes.map((l) => [l.id, l.name]));
    const results = [];

    for (const obj of doc.objects) {
      const title = fold(obj.title);
      const meta = fold([obj.owner, obj.area, subsystemOf(obj.subsystem)?.label || obj.subsystem, statusOf(obj.status).label, (obj.tags || []).join(' '), obj.data?.version, obj.data?.releaseNumber, obj.data?.buildNumber, obj.data?.reference, obj.data?.testPackage].filter(Boolean).join(' '));
      const notes = fold(stripHtml(obj.notes));

      let score = 0;
      let matchedIn = '';
      for (const term of terms) {
        if (title.includes(term)) {
          score += title.startsWith(term) ? 12 : 8;
          matchedIn = matchedIn || 'title';
        } else if (meta.includes(term)) {
          score += 4;
          matchedIn = matchedIn || 'details';
        } else if (notes.includes(term)) {
          score += 2;
          matchedIn = matchedIn || 'notes';
        } else {
          score = -1;
          break;
        }
      }
      if (score <= 0) continue;

      results.push({
        kind: 'object',
        id: obj.id,
        title: obj.title,
        type: obj.type,
        typeLabel: TYPES[obj.type]?.label || obj.type,
        lane: laneNames.get(obj.lane) || '',
        status: obj.status,
        start: obj.start,
        end: obj.end,
        matchedIn,
        excerpt: matchedIn === 'notes' ? excerpt(stripHtml(obj.notes), terms[0]) : subtitleFor(obj),
        score,
      });
    }

    for (const lane of doc.lanes) {
      if (terms.every((t) => fold(lane.name).includes(t))) {
        results.push({
          kind: 'lane',
          id: lane.id,
          title: lane.name,
          typeLabel: 'Lane',
          matchedIn: 'title',
          excerpt: `${doc.objects.filter((o) => o.lane === lane.id).length} objects`,
          score: 6,
        });
      }
    }

    results.sort((a, b) => b.score - a.score || a.start - b.start);
    return results.slice(0, limit);
  }

  function subtitleFor(obj) {
    const bits = [];
    if (obj.owner) bits.push(obj.owner);
    const sub = subsystemOf(obj.subsystem);
    if (sub) bits.push(sub.label);
    if (obj.area) bits.push(obj.area);
    if (obj.data?.version) bits.push(`v${obj.data.version}`);
    return bits.join(' · ');
  }

  /** A short window of text around the first hit, for search result previews. */
  function excerpt(text, term, width = 90) {
    const i = fold(text).indexOf(fold(term));
    if (i < 0) return truncate(text, width);
    const start = Math.max(0, i - width / 3);
    return (start > 0 ? '…' : '') + truncate(text.slice(start), width);
  }

  /**
   * Roll-up counts used by the legend, the filter panel and the status bar.
   */
  function summarise(doc, predicate = null) {
    const byType = new Map();
    const byStatus = new Map();
    const byLane = new Map();
    const byOwner = new Map();
    const bySubsystem = new Map();
    let visible = 0;

    for (const obj of doc.objects) {
      if (predicate && !predicate(obj)) continue;
      visible++;
      bump(byType, obj.type);
      bump(byStatus, obj.status);
      bump(byLane, obj.lane);
      if (obj.owner) bump(byOwner, obj.owner);
      if (obj.subsystem) bump(bySubsystem, obj.subsystem);
    }

    return { total: doc.objects.length, visible, byType, byStatus, byLane, byOwner, bySubsystem };
  }

  function bump(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
  }

  /** Distinct values for a field, with counts, sorted by frequency. */
  function facet(doc, field) {
    const counts = new Map();
    for (const obj of doc.objects) {
      const value = field === 'tag' ? null : obj[field];
      if (field === 'tag') {
        for (const t of obj.tags || []) bump(counts, t);
      } else if (value) {
        bump(counts, value);
      }
    }
    return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
  }

  /** Status ids actually present in the document, in canonical order. */
  function usedStatuses(doc) {
    const present = new Set(doc.objects.map((o) => o.status));
    return listIds('status').filter((id) => present.has(id));
  }

  /** Type ids actually present in the document, in registry order. */
  function usedTypes(doc) {
    const present = new Set(doc.objects.map((o) => o.type));
    return Object.keys(TYPES).filter((id) => present.has(id));
  }

  Object.defineProperty(__x, "filterPredicate", { get: () => filterPredicate, enumerable: true });
  Object.defineProperty(__x, "searchableText", { get: () => searchableText, enumerable: true });
  Object.defineProperty(__x, "search", { get: () => search, enumerable: true });
  Object.defineProperty(__x, "summarise", { get: () => summarise, enumerable: true });
  Object.defineProperty(__x, "facet", { get: () => facet, enumerable: true });
  Object.defineProperty(__x, "usedStatuses", { get: () => usedStatuses, enumerable: true });
  Object.defineProperty(__x, "usedTypes", { get: () => usedTypes, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// timeline/text.js
// ════════════════════════════════════════════════════════════════════════
__mods["timeline/text.js"] = function (__x, __req) {
  /**
   * Text measurement and wrapping.
   *
   * Nothing on the timeline is allowed to be clipped, ellipsised or hidden, at
   * any zoom. Honouring that means the layout has to *know* how wide a label is
   * before it decides where to put it and how tall to make the row — guesswork
   * based on character counts is what produces the "…" this module exists to
   * remove.
   *
   * Measurement goes through a detached canvas 2D context, which reports the
   * same advance widths the DOM will use for the same font. Results are cached,
   * because a zoom gesture re-measures every visible label on every frame.
   *
   * Leaf module: imports nothing.
   */

  let ctx = null;
  let uiFamily = null;
  let monoFamily = null;

  const widthCache = new Map();
  const wrapCache = new Map();
  const MAX_CACHE = 12000;

  function context() {
    if (!ctx) {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      ctx = canvas.getContext('2d');
    }
    return ctx;
  }

  function readVar(name, fallback) {
    try {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return value || fallback;
    } catch {
      return fallback;
    }
  }

  /** The interface font stack, read once from the token sheet. */
  function uiFontFamily() {
    if (!uiFamily) uiFamily = readVar('--f-ui', "system-ui, sans-serif");
    return uiFamily;
  }

  function monoFontFamily() {
    if (!monoFamily) monoFamily = readVar('--f-mono', 'monospace');
    return monoFamily;
  }

  /**
   * Build a canvas `font` string.
   * `family` may be a CSS stack; the canvas resolves it the same way the DOM does.
   */
  function fontString({ size = 12, weight = 500, family = null, italic = false, mono = false } = {}) {
    const stack = family || (mono ? monoFontFamily() : uiFontFamily());
    return `${italic ? 'italic ' : ''}${weight} ${size}px ${stack}`;
  }

  /**
   * Discard cached metrics. Called when the theme changes, since a theme may
   * swap the interface font (Engineering uses the monospace stack), and when a
   * web font finishes loading and every width shifts.
   */
  function resetTextCache() {
    uiFamily = null;
    monoFamily = null;
    widthCache.clear();
    wrapCache.clear();
  }

  // A late-arriving web font silently invalidates every cached width, so drop
  // the cache once loading settles.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(() => resetTextCache()).catch(() => {});
  }

  /** Advance width of `text` in pixels. */
  function textWidth(text, font) {
    const key = `${font} ${text}`;
    const hit = widthCache.get(key);
    if (hit !== undefined) return hit;

    const c = context();
    c.font = font;
    const width = c.measureText(text).width;

    if (widthCache.size > MAX_CACHE) widthCache.clear();
    widthCache.set(key, width);
    return width;
  }

  /**
   * Greedy word wrap.
   *
   * Breaks on whitespace, and hard-breaks any single word too long for the
   * measure — a 40-character part number must still appear in full rather than
   * overflow its box.
   *
   * @returns {{lines: string[], width: number, height: number, lineHeight: number}}
   */
  function wrapText(text, maxWidth, font, { lineHeight = null, maxLines = 0 } = {}) {
    const source = String(text || '').trim();
    const limit = Math.max(12, maxWidth);
    const key = `${font} ${Math.round(limit)} ${maxLines} ${source}`;

    const hit = wrapCache.get(key);
    if (hit) return hit;

    const size = fontSizeOf(font);
    const lh = lineHeight || Math.round(size * 1.28);

    let lines;
    if (!source) {
      lines = [];
    } else if (textWidth(source, font) <= limit) {
      lines = [source];
    } else {
      lines = [];
      let current = '';

      for (const word of source.split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (textWidth(candidate, font) <= limit) {
          current = candidate;
          continue;
        }
        if (current) {
          lines.push(current);
          current = '';
        }
        // The word alone may still be too wide — split it across lines rather
        // than letting it spill out of the box.
        if (textWidth(word, font) > limit) {
          let piece = '';
          for (const ch of word) {
            if (piece && textWidth(piece + ch, font) > limit) {
              lines.push(piece);
              piece = ch;
            } else {
              piece += ch;
            }
          }
          current = piece;
        } else {
          current = word;
        }
      }
      if (current) lines.push(current);
    }

    // `maxLines` is a hint used to decide placement, never to drop text: when
    // the caller enforces it, it re-wraps at a wider measure instead.
    const result = {
      lines,
      width: lines.reduce((max, line) => Math.max(max, textWidth(line, font)), 0),
      height: Math.max(lh, lines.length * lh),
      lineHeight: lh,
      overflowed: maxLines > 0 && lines.length > maxLines,
    };

    if (wrapCache.size > MAX_CACHE) wrapCache.clear();
    wrapCache.set(key, result);
    return result;
  }

  function fontSizeOf(font) {
    const match = /(\d+(?:\.\d+)?)px/.exec(font);
    return match ? parseFloat(match[1]) : 12;
  }

  /**
   * The narrowest measure, up to `maxWidth`, that fits `text` in `maxLines`.
   *
   * Used to size labels that sit beside an object: a two-word title should get
   * a box just wide enough for it, not a fixed 240px block that pushes its
   * neighbours away for no reason.
   */
  function fitWidth(text, font, { maxWidth = 260, maxLines = 3, minWidth = 60 } = {}) {
    const full = textWidth(String(text || ''), font);
    if (full <= maxWidth) return { width: Math.max(minWidth, Math.ceil(full)), lines: 1 };

    // Aim for the number of lines that keeps the block roughly rectangular.
    const target = Math.min(maxLines, Math.max(1, Math.ceil(full / maxWidth)));
    const ideal = Math.min(maxWidth, Math.max(minWidth, Math.ceil(full / target) + 12));
    const wrapped = wrapText(text, ideal, font);
    return { width: Math.max(minWidth, Math.ceil(wrapped.width)), lines: wrapped.lines.length };
  }

  /** Total height a wrapped block occupies. */
  function blockHeight(lineCount, lineHeight) {
    return Math.max(1, lineCount) * lineHeight;
  }

  Object.defineProperty(__x, "uiFontFamily", { get: () => uiFontFamily, enumerable: true });
  Object.defineProperty(__x, "monoFontFamily", { get: () => monoFontFamily, enumerable: true });
  Object.defineProperty(__x, "fontString", { get: () => fontString, enumerable: true });
  Object.defineProperty(__x, "resetTextCache", { get: () => resetTextCache, enumerable: true });
  Object.defineProperty(__x, "textWidth", { get: () => textWidth, enumerable: true });
  Object.defineProperty(__x, "wrapText", { get: () => wrapText, enumerable: true });
  Object.defineProperty(__x, "fitWidth", { get: () => fitWidth, enumerable: true });
  Object.defineProperty(__x, "blockHeight", { get: () => blockHeight, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// timeline/layout.js
// ════════════════════════════════════════════════════════════════════════
__mods["timeline/layout.js"] = function (__x, __req) {
  /**
   * Layout — the geometry pass.
   *
   * Turns the document plus the current viewport into a flat list of rectangles
   * the renderer can draw without thinking. Keeping this pure (no DOM, no side
   * effects) means the same geometry feeds the screen renderer, the SVG
   * exporter, the PDF writer and the minimap — so what you export is exactly
   * what you saw.
   *
   * Labels are never clipped, ellipsised or hidden at any zoom. That constraint
   * drives the whole design here: every label is measured before it is placed,
   * a label that will not fit inside its bar is moved beside it, packing
   * reserves the space the label occupies as well as the bar, and rows and
   * lanes grow to whatever height the wrapped text needs.
   *
   * Imports: util, dates, model, store, viewport, text.
   */

  const { clamp } = __req("core/util.js");
  const { MS_DAY } = __req("core/dates.js");
  const { TYPES, objectRange } = __req("core/model.js");
  const { getDoc, orderedLanes, getLane } = __req("core/store.js");
  const { msToPx, durationToPx, pxToDuration, visibleRange, rangeVisible } = __req("timeline/viewport.js");
  const { fontString, textWidth, wrapText, fitWidth } = __req("timeline/text.js");

  /* ── Metrics ───────────────────────────────────────────────────────────── */

  /** Vertical padding inside a lane band. */
  const LANE_PAD = 7;
  /** Smallest a packed row may be. */
  const ROW_HEIGHT = 24;
  /** Gap between stacked rows. */
  const ROW_GAP = 4;
  /** Minimum drawn width of a bar so a one-day task stays clickable. */
  const MIN_BAR_PX = 6;
  /** Point objects (milestones, markers) occupy a fixed square glyph. */
  const POINT_SIZE = 26;
  /** Horizontal padding inside a bar's label. */
  const LABEL_PAD_X = 8;
  /** Vertical padding around a wrapped label inside a bar. */
  const LABEL_PAD_Y = 4;
  /** Gap between a bar and a label placed beside it. */
  const OUTSIDE_GAP = 7;
  /** Widest a label placed beside a bar may be before it wraps. */
  const OUTSIDE_MAX_W = 250;
  /** A bar narrower than this never holds its label internally. */
  const MIN_INSIDE_W = 54;
  /** Above this many wrapped lines, a label moves outside rather than stack up. */
  const MAX_INSIDE_LINES = 3;
  /** Space an icon takes inside a bar label. */
  const ICON_W = 18;
  /** Space the percentage readout takes inside a bar label. */
  const PCT_W = 30;

  /* ── Fonts ─────────────────────────────────────────────────────────────── */

  function titleFont(obj) {
    const style = obj.style || {};
    return fontString({
      size: style.fontSize || 12,
      weight: style.bold ? 700 : 500,
      italic: !!style.italic,
      family: style.font || null,
    });
  }

  function subtitleFont(obj) {
    const style = obj.style || {};
    return fontString({
      size: Math.max(9, Math.round((style.fontSize || 12) * 0.84)),
      weight: 400,
      italic: !!style.italic,
      family: style.font || null,
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Label measurement
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Decide where an object's label goes and how much room it needs.
   *
   * `placement` is one of:
   *   'inside'  — wrapped within the bar
   *   'outside' — wrapped in a block to the right of a bar too narrow to hold it
   *   'below' / 'above' — centred under (or over) a point glyph
   *   'fill'    — free-form annotation; the whole object grows to fit the text
   */
  function measureLabel(obj, barWidthPx) {
    const def = TYPES[obj.type] || TYPES.activity;
    const shape = def.shape;
    const title = String(obj.title || '');
    const subtitle = String(obj.subtitle || '').trim();
    const tFont = titleFont(obj);
    const sFont = subtitleFont(obj);

    /* Point objects: the label always sits outside the glyph, centred. */
    if (!def.duration) {
      const fitted = fitWidth(title, tFont, { maxWidth: 200, maxLines: 3, minWidth: 40 });
      const titleWrap = wrapText(title, fitted.width, tFont);
      const subWrap = subtitle ? wrapText(subtitle, Math.max(fitted.width, 90), sFont) : null;
      const width = Math.max(titleWrap.width, subWrap ? subWrap.width : 0);
      const height = titleWrap.height + (subWrap ? subWrap.height : 0);

      return {
        placement: shape === 'release' ? 'above' : 'below',
        lines: titleWrap.lines,
        subLines: subWrap ? subWrap.lines : [],
        lineHeight: titleWrap.lineHeight,
        subLineHeight: subWrap ? subWrap.lineHeight : 0,
        width: Math.ceil(width),
        height: Math.ceil(height),
        // Centred text spreads equally either side of the glyph.
        extraLeft: Math.ceil(width / 2) + 4,
        extraRight: Math.ceil(width / 2) + 4,
        extraBelow: shape === 'release' ? 0 : Math.ceil(height) + 4,
        extraAbove: shape === 'release' ? Math.ceil(height) + 4 : 0,
      };
    }

    /* Free-form annotations: the box grows around the text. */
    if (shape === 'sticky' || shape === 'text' || shape === 'callout' || shape === 'image') {
      const inner = Math.max(40, barWidthPx - LABEL_PAD_X * 2);
      const titleWrap = wrapText(title, inner, tFont);
      const subWrap = subtitle ? wrapText(subtitle, inner, sFont) : null;
      return {
        placement: 'fill',
        lines: titleWrap.lines,
        subLines: subWrap ? subWrap.lines : [],
        lineHeight: titleWrap.lineHeight,
        subLineHeight: subWrap ? subWrap.lineHeight : 0,
        width: Math.ceil(Math.max(titleWrap.width, subWrap ? subWrap.width : 0)),
        height: Math.ceil(titleWrap.height + (subWrap ? subWrap.height : 0)),
        extraLeft: 0,
        extraRight: 0,
        extraBelow: 0,
        extraAbove: 0,
      };
    }

    /* Bars and bands: inside when the text fits, beside the bar when it does not. */
    const reserved = LABEL_PAD_X * 2 + (obj.icon ? ICON_W : 0) + (def.progress && obj.progress > 0 ? PCT_W : 0);
    const inner = barWidthPx - reserved;

    if (inner >= MIN_INSIDE_W) {
      const titleWrap = wrapText(title, inner, tFont);
      const subWrap = subtitle ? wrapText(subtitle, inner, sFont) : null;
      const totalLines = titleWrap.lines.length + (subWrap ? subWrap.lines.length : 0);

      if (totalLines <= MAX_INSIDE_LINES) {
        return {
          placement: 'inside',
          lines: titleWrap.lines,
          subLines: subWrap ? subWrap.lines : [],
          lineHeight: titleWrap.lineHeight,
          subLineHeight: subWrap ? subWrap.lineHeight : 0,
          width: Math.ceil(Math.max(titleWrap.width, subWrap ? subWrap.width : 0)),
          height: Math.ceil(titleWrap.height + (subWrap ? subWrap.height : 0)),
          extraLeft: 0,
          extraRight: 0,
          extraBelow: 0,
          extraAbove: 0,
        };
      }
    }

    const fitted = fitWidth(title, tFont, { maxWidth: OUTSIDE_MAX_W, maxLines: 3, minWidth: 70 });
    const titleWrap = wrapText(title, fitted.width, tFont);
    const subWrap = subtitle ? wrapText(subtitle, Math.max(fitted.width, 90), sFont) : null;
    const width = Math.ceil(Math.max(titleWrap.width, subWrap ? subWrap.width : 0));
    const height = Math.ceil(titleWrap.height + (subWrap ? subWrap.height : 0));

    return {
      placement: 'outside',
      lines: titleWrap.lines,
      subLines: subWrap ? subWrap.lines : [],
      lineHeight: titleWrap.lineHeight,
      subLineHeight: subWrap ? subWrap.lineHeight : 0,
      width,
      height,
      extraLeft: 0,
      extraRight: width + OUTSIDE_GAP + 4,
      extraBelow: 0,
      extraAbove: 0,
    };
  }

  /** Height one object needs on its packed row, label included. */
  function rowHeightFor(obj, label) {
    const def = TYPES[obj.type] || TYPES.activity;

    if (!def.duration) {
      return Math.max(ROW_HEIGHT, POINT_SIZE + label.extraBelow + label.extraAbove);
    }
    if (label.placement === 'fill') {
      return Math.max(46, label.height + LABEL_PAD_Y * 2 + 8);
    }
    if (label.placement === 'outside') {
      // The bar itself stays slim; the row must still clear the label beside it.
      return Math.max(ROW_HEIGHT, label.height + LABEL_PAD_Y * 2);
    }
    return Math.max(ROW_HEIGHT, label.height + LABEL_PAD_Y * 2);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Packing
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Assign a stacking row to every object in a lane so neither bars nor their
   * labels overlap.
   *
   * The occupied span of an object is the bar plus whatever its label needs on
   * either side, converted from pixels to time at the current zoom. That is
   * what guarantees a label placed beside a narrow bar can never be overprinted
   * by the next object along.
   *
   * Objects keep an explicit `row` when the user has set one; otherwise a
   * first-fit packer places them on the lowest free row, in start order, which
   * keeps the result stable as the plan is edited.
   */
  function packRows(entries, { minGapPx = 6 } = {}) {
    const sorted = entries.slice().sort((a, b) => a.obj.start - b.obj.start || a.obj.z - b.obj.z);
    const rowEnds = []; // last occupied end (px) per row
    const assigned = new Map();

    for (const entry of sorted) {
      const { obj, label, barWidth } = entry;
      const startPx = msToPx(obj.start);
      const hasDuration = !!TYPES[obj.type]?.duration;

      const from = (hasDuration ? startPx : startPx - POINT_SIZE / 2) - label.extraLeft;
      const to = (hasDuration ? startPx + barWidth : startPx + POINT_SIZE / 2) + label.extraRight;

      if (Number.isFinite(obj.row) && obj.row > 0) {
        const row = Math.min(obj.row, 24);
        assigned.set(obj.id, row);
        rowEnds[row] = Math.max(rowEnds[row] ?? -Infinity, to + minGapPx);
        continue;
      }

      let row = 0;
      while (row < rowEnds.length && (rowEnds[row] ?? -Infinity) > from) row++;
      rowEnds[row] = to + minGapPx;
      assigned.set(obj.id, row);
    }

    // Explicit rows can leave gaps; normalise the count to the highest used.
    let rows = 0;
    for (const row of assigned.values()) rows = Math.max(rows, row + 1);
    return { assigned, rows: Math.max(1, rows) };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Full layout
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The render model for the current frame.
   *
   * `filterFn` receives an object and returns true when it passes the active
   * filters. What happens to the failures is the user's choice:
   *
   *   dim (default)  they are laid out and marked `dimmed`, so the shape of the
   *                  plan stays readable and nothing moves as filters change.
   *   hide           they are dropped before packing, so rows reflow and lanes
   *                  shrink to what is left — the plan closes up around them.
   *
   * Dropping them before packing rather than skipping them at paint time is what
   * makes the second mode worth having: skipping later would leave the gaps the
   * hidden objects were occupying.
   */
  function computeLayout({ filterFn = null, hideFiltered = false, includeOffscreen = false, gutterWidth = 190 } = {}) {
    const doc = getDoc();
    const lanes = orderedLanes(false);
    const rects = [];
    const byId = new Map();

    const laneEntries = [];
    let y = 0;

    for (const lane of lanes) {
      const laneObjects = doc.objects.filter(
        (o) => o.lane === lane.id && !o.hidden && !(hideFiltered && filterFn && !filterFn(o))
      );

      // Measure every object in the lane, not just the visible ones: row heights
      // must not change as the plan is scrolled sideways.
      const measured = laneObjects.map((obj) => {
        const hasDuration = !!TYPES[obj.type]?.duration;
        const barWidth = hasDuration
          ? Math.max(MIN_BAR_PX, durationToPx(Math.max(obj.end - obj.start, MS_DAY * 0.25)))
          : POINT_SIZE;
        const label = measureLabel(obj, barWidth);
        return { obj, label, barWidth, height: rowHeightFor(obj, label) };
      });

      const collapsed = lane.collapsed;
      const { assigned, rows } = collapsed ? { assigned: new Map(measured.map((m) => [m.obj.id, 0])), rows: 1 } : packRows(measured);

      // Each row is as tall as the tallest thing standing on it.
      const rowHeights = new Array(rows).fill(ROW_HEIGHT);
      if (!collapsed) {
        for (const entry of measured) {
          const row = assigned.get(entry.obj.id) || 0;
          rowHeights[row] = Math.max(rowHeights[row], entry.height);
        }
      }

      const rowTops = [];
      let cursor = 0;
      for (let r = 0; r < rows; r++) {
        rowTops.push(cursor);
        cursor += rowHeights[r] + ROW_GAP;
      }
      const contentHeight = Math.max(ROW_HEIGHT, cursor - ROW_GAP);

      // The lane's stored height is a minimum: it grows to fit its content and
      // its own name in the gutter, and never shrinks below what the user set.
      const gutterHeight = laneLabelHeight(lane, gutterWidth);
      const height = collapsed
        ? 26
        : Math.max(lane.height, contentHeight + LANE_PAD * 2, gutterHeight);

      const entry = {
        lane,
        id: lane.id,
        y,
        height,
        contentY: y + LANE_PAD,
        contentH: Math.max(10, height - LANE_PAD * 2),
        rowTops,
        rowHeights,
        rows,
      };
      laneEntries.push(entry);
      y += height;

      for (const item of measured) {
        const visible =
          includeOffscreen ||
          rangeVisible(
            item.obj.start - pxToDuration(item.label.extraLeft),
            (TYPES[item.obj.type]?.duration ? item.obj.end : item.obj.start) + pxToDuration(item.label.extraRight),
            400
          );
        if (!visible) continue;

        const row = assigned.get(item.obj.id) || 0;
        const rect = objectRect(item.obj, entry, row, item, collapsed);
        rect.dimmed = filterFn ? !filterFn(item.obj) : false;
        rects.push(rect);
        byId.set(item.obj.id, rect);
      }
    }

    const geometry = {
      lanes: laneEntries,
      totalHeight: y,
      byId: new Map(laneEntries.map((e) => [e.id, e])),
    };

    // Draw order: containers and bands behind everything else so they read as
    // backdrops rather than covering the work they contain.
    rects.sort((a, b) => backdropRank(a) - backdropRank(b) || a.obj.z - b.obj.z);

    return { geometry, rects, byId, range: visibleRange() };
  }

  function backdropRank(rect) {
    const shape = TYPES[rect.obj.type]?.shape;
    if (shape === 'container') return 0;
    if (shape === 'band') return 1;
    return 2;
  }

  /** Height the lane's own name needs in the gutter, wrapped to its width. */
  function laneLabelHeight(lane, gutterWidth) {
    const font = fontString({ size: 12, weight: 600 });
    // Matches the gutter label's CSS box: 24px left inset, 30px right inset.
    const available = Math.max(60, gutterWidth - 54);
    const wrapped = wrapText(lane.name || '', available, font);
    return wrapped.height + 22; // meta line plus padding
  }

  /**
   * Screen rectangle for one object.
   * Coordinates are canvas-relative: x from the viewport origin, y from the top
   * of the lane stack (the scroll container handles vertical offset).
   */
  function objectRect(obj, laneEntry, row, measured, collapsed = false) {
    const def = TYPES[obj.type] || TYPES.activity;
    const shape = def.shape;
    const hasDuration = def.duration;
    const label = measured.label;

    const x = msToPx(obj.start);
    const rowTop = laneEntry.contentY + (laneEntry.rowTops[row] ?? 0);
    const rowH = laneEntry.rowHeights[row] ?? ROW_HEIGHT;

    let width;
    let left;
    let height;
    let top;

    if (hasDuration) {
      width = measured.barWidth;
      left = x;
    } else {
      width = POINT_SIZE;
      left = x - POINT_SIZE / 2;
    }

    if (shape === 'band' || shape === 'container') {
      top = laneEntry.y + 1;
      height = laneEntry.height - 2;
    } else if (collapsed) {
      top = laneEntry.y + 4;
      height = Math.max(8, laneEntry.height - 8);
    } else if (!hasDuration) {
      // Glyph sits above its label (or below it, for a release flag).
      top = rowTop + label.extraAbove;
      height = POINT_SIZE;
    } else if (label.placement === 'fill') {
      top = rowTop;
      height = rowH;
    } else {
      height = label.placement === 'outside' ? Math.min(rowH, Math.max(ROW_HEIGHT, label.lineHeight + LABEL_PAD_Y * 2)) : rowH;
      top = rowTop + (rowH - height) / 2;
    }

    return {
      id: obj.id,
      obj,
      lane: laneEntry.lane,
      laneEntry,
      shape,
      row,
      label,
      x: left,
      y: top,
      w: width,
      h: height,
      right: left + width,
      bottom: top + height,
      centerX: hasDuration ? left + width / 2 : x,
      centerY: top + height / 2,
      hasDuration,
      /** Full extent including the label — used for hit-testing and marquees. */
      labelLeft: left - label.extraLeft,
      labelRight: left + width + label.extraRight,
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Queries
     ═══════════════════════════════════════════════════════════════════════ */

  /** Which lane sits at a given canvas y coordinate. */
  function laneAtY(geometry, y) {
    for (const entry of geometry.lanes) {
      if (y >= entry.y && y < entry.y + entry.height) return entry;
    }
    return geometry.lanes[geometry.lanes.length - 1] || null;
  }

  /** Which packed row within a lane a canvas y coordinate falls on. */
  function rowAtY(laneEntry, y) {
    if (!laneEntry || !laneEntry.rowTops.length) return 0;
    const offset = y - laneEntry.contentY;
    for (let r = laneEntry.rowTops.length - 1; r >= 0; r--) {
      if (offset >= laneEntry.rowTops[r]) return r;
    }
    return 0;
  }

  /**
   * Hit-test: the topmost object rectangle containing a canvas point.
   * Iterates back to front so the object drawn last wins, matching what the
   * user sees. Only the bar or glyph is a target — a label beside a bar is
   * informative, not a handle.
   */
  function hitTest(layout, x, y, tolerance = 0) {
    for (let i = layout.rects.length - 1; i >= 0; i--) {
      const r = layout.rects[i];
      if (r.dimmed) continue;
      if (x >= r.x - tolerance && x <= r.right + tolerance && y >= r.y - tolerance && y <= r.bottom + tolerance) {
        return r;
      }
    }
    return null;
  }

  /** Every rectangle intersecting a marquee box. */
  function hitTestBox(layout, x1, y1, x2, y2) {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    return layout.rects.filter(
      (r) => !r.dimmed && !r.obj.locked && r.right >= left && r.x <= right && r.bottom >= top && r.y <= bottom
    );
  }

  /**
   * Anchor points for a dependency endpoint.
   * `side` is 'start' or 'end' per the link type.
   */
  function anchorPoint(rect, side) {
    if (!rect) return null;
    if (!rect.hasDuration) {
      return { x: side === 'start' ? rect.centerX - 9 : rect.centerX + 9, y: rect.centerY };
    }
    return { x: side === 'start' ? rect.x : rect.right, y: rect.centerY };
  }

  /** Total canvas height including a comfortable scroll margin at the bottom. */
  function stageHeight(geometry) {
    return geometry.totalHeight + 80;
  }

  /** Lane entry for an object id, or null. */
  function laneEntryFor(geometry, laneId) {
    return geometry.byId.get(laneId) || null;
  }

  /** Convenience: the lane record an object belongs to. */
  function laneOf(obj) {
    return getLane(obj.lane);
  }

  /** Vertical geometry only — used where object placement is irrelevant. */
  function laneLayout() {
    const lanes = orderedLanes(false);
    const out = [];
    const byId = new Map();
    let y = 0;
    for (const lane of lanes) {
      const height = lane.collapsed ? 26 : lane.height;
      const entry = { lane, id: lane.id, y, height, contentY: y + LANE_PAD, contentH: Math.max(10, height - LANE_PAD * 2) };
      out.push(entry);
      byId.set(lane.id, entry);
      y += height;
    }
    return { lanes: out, totalHeight: y, byId };
  }

  Object.defineProperty(__x, "ROW_HEIGHT", { get: () => ROW_HEIGHT, enumerable: true });
  Object.defineProperty(__x, "measureLabel", { get: () => measureLabel, enumerable: true });
  Object.defineProperty(__x, "packRows", { get: () => packRows, enumerable: true });
  Object.defineProperty(__x, "computeLayout", { get: () => computeLayout, enumerable: true });
  Object.defineProperty(__x, "objectRect", { get: () => objectRect, enumerable: true });
  Object.defineProperty(__x, "laneAtY", { get: () => laneAtY, enumerable: true });
  Object.defineProperty(__x, "rowAtY", { get: () => rowAtY, enumerable: true });
  Object.defineProperty(__x, "hitTest", { get: () => hitTest, enumerable: true });
  Object.defineProperty(__x, "hitTestBox", { get: () => hitTestBox, enumerable: true });
  Object.defineProperty(__x, "anchorPoint", { get: () => anchorPoint, enumerable: true });
  Object.defineProperty(__x, "stageHeight", { get: () => stageHeight, enumerable: true });
  Object.defineProperty(__x, "laneEntryFor", { get: () => laneEntryFor, enumerable: true });
  Object.defineProperty(__x, "laneOf", { get: () => laneOf, enumerable: true });
  Object.defineProperty(__x, "laneLayout", { get: () => laneLayout, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// timeline/connectors.js
// ════════════════════════════════════════════════════════════════════════
__mods["timeline/connectors.js"] = function (__x, __req) {
  /**
   * Dependency connectors.
   *
   * Routes the four precedence relationships (FS, SS, FF, SF) between object
   * rectangles in three styles — orthogonal, curved and straight. Routing is
   * recomputed from the layout every frame, which is what makes connectors
   * follow their activities automatically when anything moves.
   *
   * Imports: model, layout.
   */

  const { LINK_TYPES } = __req("core/model.js");
  const { anchorPoint } = __req("timeline/layout.js");

  /** How far a connector stubs out of an activity before turning. */
  const STUB = 13;
  /** Vertical clearance used when a link has to route backwards. */
  const DETOUR = 12;
  /** Arrowhead size. */
  const ARROW = 6;

  /**
   * Compute the SVG path for one link.
   * @returns {{d:string, from:{x,y}, to:{x,y}, mid:{x,y}, arrow:string}|null}
   */
  function routeLink(link, fromRect, toRect, style = 'orthogonal') {
    if (!fromRect || !toRect) return null;

    const spec = LINK_TYPES[link.type] || LINK_TYPES.FS;
    const a = anchorPoint(fromRect, spec.from);
    const b = anchorPoint(toRect, spec.to);
    if (!a || !b) return null;

    // Which way does the connector leave the source and enter the target?
    const outDir = spec.from === 'end' ? 1 : -1;
    const inDir = spec.to === 'start' ? -1 : 1;

    const effective = link.style || style;
    let d;
    let mid;

    if (effective === 'straight') {
      d = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else if (effective === 'curved') {
      const dx = Math.max(28, Math.abs(b.x - a.x) * 0.45);
      const c1 = { x: a.x + outDir * dx, y: a.y };
      const c2 = { x: b.x + inDir * dx, y: b.y };
      d = `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
      mid = bezierMid(a, c1, c2, b);
    } else {
      const path = orthogonal(a, b, outDir, inDir, fromRect, toRect);
      d = path.d;
      mid = path.mid;
    }

    return { d, from: a, to: b, mid, arrow: arrowHead(b, inDir) };
  }

  /**
   * Orthogonal (elbow) routing.
   *
   * The easy case is a forward link with room between the two activities: stub
   * out, run vertically at the midpoint, stub in. When the target starts before
   * the source finishes — which happens constantly in a real plan — the route
   * has to double back, so it drops below the taller of the two rows and
   * returns underneath rather than cutting through both bars.
   */
  function orthogonal(a, b, outDir, inDir, fromRect, toRect) {
    const startX = a.x + outDir * STUB;
    const endX = b.x + inDir * STUB;
    const points = [];

    const forward = outDir === 1 ? endX > startX : endX < startX;

    if (forward) {
      const midX = (startX + endX) / 2;
      points.push([a.x, a.y], [startX, a.y]);
      if (Math.abs(a.y - b.y) > 1) {
        points.push([midX, a.y], [midX, b.y]);
      }
      points.push([endX, b.y], [b.x, b.y]);
    } else {
      // Route around: leave the source, drop past both rows, come back in.
      const belowA = fromRect.bottom + DETOUR;
      const belowB = toRect.bottom + DETOUR;
      const y = Math.max(belowA, belowB);
      points.push([a.x, a.y], [startX, a.y], [startX, y], [endX, y], [endX, b.y], [b.x, b.y]);
    }

    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${round(p[0])} ${round(p[1])}`).join(' ');
    const mid = midpointOfPolyline(points);
    return { d, mid };
  }

  function round(n) {
    return Math.round(n * 10) / 10;
  }

  function midpointOfPolyline(points) {
    let total = 0;
    const lengths = [];
    for (let i = 1; i < points.length; i++) {
      const len = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      lengths.push(len);
      total += len;
    }
    let target = total / 2;
    for (let i = 0; i < lengths.length; i++) {
      if (target <= lengths[i]) {
        const t = lengths[i] ? target / lengths[i] : 0;
        return {
          x: points[i][0] + (points[i + 1][0] - points[i][0]) * t,
          y: points[i][1] + (points[i + 1][1] - points[i][1]) * t,
        };
      }
      target -= lengths[i];
    }
    return { x: points[0][0], y: points[0][1] };
  }

  /** Point at t = 0.5 on a cubic Bézier — where the link's label sits. */
  function bezierMid(p0, p1, p2, p3) {
    const t = 0.5;
    const mt = 1 - t;
    const at = (k) => mt ** 3 * p0[k] + 3 * mt ** 2 * t * p1[k] + 3 * mt * t ** 2 * p2[k] + t ** 3 * p3[k];
    return { x: at('x'), y: at('y') };
  }

  /** Filled triangle at the target end, pointing the way the link enters. */
  function arrowHead(point, inDir) {
    const tipX = point.x;
    // inDir is -1 when the link arrives from the left, +1 from the right, so
    // the base of the triangle always sits behind the tip.
    const baseX = point.x + inDir * ARROW;
    return `M ${round(tipX)} ${round(point.y)} L ${round(baseX)} ${round(point.y - ARROW * 0.62)} L ${round(baseX)} ${round(point.y + ARROW * 0.62)} Z`;
  }

  /**
   * Route every link that has both endpoints laid out.
   * Returns render descriptors ready for the SVG layer and the exporters.
   */
  function routeAll(links, layoutById, style = 'orthogonal', { criticalIds = null, violations = null } = {}) {
    const out = [];
    for (const link of links) {
      const fromRect = layoutById.get(link.from);
      const toRect = layoutById.get(link.to);
      if (!fromRect || !toRect) continue;
      const route = routeLink(link, fromRect, toRect, style);
      if (!route) continue;

      const breach = violations ? violations.byLink.get(link.id) : null;
      const violated = !!breach?.violated;

      out.push({
        link,
        ...route,
        dimmed: fromRect.dimmed || toRect.dimmed,
        critical: criticalIds ? criticalIds.has(link.from) && criticalIds.has(link.to) : false,
        violated,
        breach,
        // A broken link states the damage instead of its relationship type: the
        // number of days it is out by is the actionable fact.
        label: violated
          ? `${breach.shortfallDays}d late`
          : link.label || (link.lag ? `${LINK_TYPES[link.type]?.short || link.type}${link.lag > 0 ? '+' : ''}${link.lag}d` : ''),
      });
    }
    return out;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Render routed connectors into an existing <svg> element. */
  function renderConnectors(svg, routed, { selectedLinkIds = new Set(), onSelect = null } = {}) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    for (const item of routed) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.dataset.linkId = item.link.id;

      // A wide invisible stroke underneath makes thin connectors clickable.
      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', item.d);
      hit.setAttribute('class', 'tl-link-hit');
      group.appendChild(hit);

      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', item.d);
      let cls = 'tl-link';
      // A violated link outranks the critical-path highlight: an impossible
      // constraint is more urgent than a tight one.
      if (item.violated) cls += ' violated';
      else if (item.critical) cls += ' critical';
      if (item.dimmed) cls += ' dim';
      if (selectedLinkIds.has(item.link.id)) cls += ' selected';
      path.setAttribute('class', cls);
      if (item.link.color && !item.violated) path.setAttribute('stroke', item.link.color);
      group.appendChild(path);

      if (item.violated) {
        group.dataset.violated = 'true';
        const detail = document.createElementNS(SVG_NS, 'title');
        detail.textContent = `Dependency broken by ${item.breach.shortfallDays} day${item.breach.shortfallDays === 1 ? '' : 's'}`;
        group.appendChild(detail);
      }

      const arrow = document.createElementNS(SVG_NS, 'path');
      arrow.setAttribute('d', item.arrow);
      arrow.setAttribute('class', cls);
      arrow.style.fill = item.violated
        ? 'var(--bad)'
        : item.critical
        ? 'var(--bad)'
        : item.link.color || 'var(--connector)';
      arrow.style.stroke = 'none';
      group.appendChild(arrow);

      if (item.label) {
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', item.mid.x);
        text.setAttribute('y', item.mid.y - 4);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'tl-link-label' + (item.violated ? ' violated' : ''));
        text.textContent = item.label;
        group.appendChild(text);
      }

      if (onSelect) {
        hit.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          onSelect(item.link, e);
        });
      }

      svg.appendChild(group);
    }
  }

  /** Preview path drawn while the user drags a new dependency. */
  function previewPath(fromRect, side, x, y, style = 'orthogonal') {
    const a = anchorPoint(fromRect, side);
    if (!a) return '';
    if (style === 'straight') return `M ${a.x} ${a.y} L ${x} ${y}`;
    const dir = side === 'end' ? 1 : -1;
    const dx = Math.max(24, Math.abs(x - a.x) * 0.45);
    return `M ${a.x} ${a.y} C ${a.x + dir * dx} ${a.y}, ${x - dir * dx} ${y}, ${x} ${y}`;
  }

  Object.defineProperty(__x, "routeLink", { get: () => routeLink, enumerable: true });
  Object.defineProperty(__x, "routeAll", { get: () => routeAll, enumerable: true });
  Object.defineProperty(__x, "renderConnectors", { get: () => renderConnectors, enumerable: true });
  Object.defineProperty(__x, "previewPath", { get: () => previewPath, enumerable: true });
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
// timeline/renderer.js
// ════════════════════════════════════════════════════════════════════════
__mods["timeline/renderer.js"] = function (__x, __req) {
  /**
   * The renderer — document + viewport → DOM.
   *
   * Objects are real DOM nodes rather than canvas draws. That costs a little
   * raw throughput but buys everything the brief asks for: gradients, pattern
   * fills, shadows, rounded corners, live text, CSS transitions and hit-testing
   * the browser does for us. Virtualisation keeps the node count proportional to
   * what is on screen, not to the size of the plan, so a five-year programme
   * scrolls as smoothly as a five-week one.
   *
   * Element reuse is keyed by object id: a drag updates `style.left` on an
   * existing node instead of rebuilding it, which is what keeps interaction at
   * frame rate.
   *
   * Imports: util, dates, model, store, query, viewport, layout, connectors, icons.
   */

  const { el, clear, rafBatch, withAlpha, readableInk, clamp } = __req("core/util.js");
  const { emit, EV } = __req("core/events.js");
  const { MS_DAY, ticks, fmtDate, toISO, isoWeek, startOfDay, daysBetween } = __req("core/dates.js");
  const { TYPES, statusOf, objectColor, effectiveToday, durationDays, subsystemOf } = __req("core/model.js");
  const { getDoc, getSelection, isSelected, getFilters, hasActiveFilters, activeBaseline } = __req("core/store.js");
  const { filterPredicate } = __req("core/query.js");
  const { linkViolations, criticalPath } = __req("core/analysis.js");
  const viewport = __req("timeline/viewport.js");
  const { computeLayout, stageHeight, ROW_HEIGHT } = __req("timeline/layout.js");
  const { fontString, textWidth, wrapText, resetTextCache } = __req("timeline/text.js");
  const { routeAll, renderConnectors } = __req("timeline/connectors.js");
  const { icon } = __req("ui/icons.js");

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** DOM handles, populated by mount(). */
  const dom = {
    root: null,
    corner: null,
    ruler: null,
    bandUpper: null,
    bandLower: null,
    gutter: null,
    gutterInner: null,
    canvas: null,
    scroll: null,
    stage: null,
    grid: null,
    laneRows: null,
    objects: null,
    connectors: null,
    overlay: null,
    today: null,
    todayFlag: null,
  };

  /** id → element, for keyed reuse across frames. */
  const objectNodes = new Map();

  let lastLayout = null;
  let scrollTop = 0;
  let mounted = false;

  /* ══════════════════════════════════════════════════════════════════════════
     Mount
     ═══════════════════════════════════════════════════════════════════════ */

  /** Build the canvas scaffold inside `host` once. */
  function mount(host) {
    clear(host);

    dom.root = el('div', { class: 'tl-root' });

    dom.corner = el('div', { class: 'tl-corner' }, [
      el('div', { class: 'tc-label', text: 'Lanes' }),
      el('div', { class: 'tc-actions' }),
    ]);

    dom.bandUpper = el('div', { class: 'tl-band upper' });
    dom.bandLower = el('div', { class: 'tl-band lower' });
    dom.ruler = el('div', { class: 'tl-ruler' }, [dom.bandUpper, dom.bandLower]);
    dom.todayFlag = el('div', { class: 'tl-today-flag' });
    dom.ruler.appendChild(dom.todayFlag);

    dom.gutterInner = el('div', { class: 'tl-gutter-inner' });
    dom.gutter = el('div', { class: 'tl-gutter' }, [dom.gutterInner]);

    dom.grid = el('div', { class: 'tl-grid' });
    dom.laneRows = el('div', { class: 'tl-lane-rows' });
    dom.objects = el('div', { class: 'tl-objects' });
    dom.connectors = document.createElementNS(SVG_NS, 'svg');
    dom.connectors.setAttribute('class', 'tl-connectors');
    dom.overlay = el('div', { class: 'tl-overlay' });
    dom.today = el('div', { class: 'tl-today' });

    dom.stage = el('div', { class: 'tl-stage' }, [dom.grid, dom.laneRows, dom.connectors, dom.objects, dom.today, dom.overlay]);
    dom.scroll = el('div', { class: 'tl-scroll' }, [dom.stage]);
    // tabindex makes the canvas programmatically focusable: clicking it takes
    // keyboard focus back from the toolbar and panels so shortcuts keep working.
    dom.canvas = el('div', { class: 'tl-canvas', tabindex: '-1' }, [dom.scroll]);

    dom.root.append(dom.corner, dom.ruler, dom.gutter, dom.canvas);
    host.appendChild(dom.root);

    // The gutter mirrors the canvas's vertical scroll so lane labels stay
    // aligned with their rows.
    dom.scroll.addEventListener('scroll', () => {
      scrollTop = dom.scroll.scrollTop;
      dom.gutterInner.style.transform = `translateY(${-scrollTop}px)`;
    });

    mounted = true;
    measure();
    return dom;
  }

  /** Current DOM handles — interactions and overlays reach in through this. */
  function elements() {
    return dom;
  }

  function getScrollTop() {
    return scrollTop;
  }

  function getLayout() {
    return lastLayout;
  }

  /** Tell the viewport how much room it has. */
  function measure() {
    if (!mounted) return;
    const rect = dom.canvas.getBoundingClientRect();
    viewport.setSize(rect.width, rect.height);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════════════════ */

  /** Coalesced render — safe to call as often as you like. */
  const requestRender = rafBatch(() => renderNow());

  function renderNow() {
    if (!mounted) return;
    const doc = getDoc();
    const settings = doc.settings;

    const predicate = hasActiveFilters() ? filterPredicate(doc, getFilters()) : null;
    const layout = computeLayout({ filterFn: predicate, hideFiltered: settings.filterMode === 'hide' });
    lastLayout = layout;

    dom.stage.style.height = `${stageHeight(layout.geometry)}px`;

    renderRuler(doc, settings);
    renderGutter(layout);
    renderGrid(doc, settings, layout);
    renderLaneRows(layout);
    renderObjects(layout, settings);
    renderBaseline(layout, settings);
    renderLinks(doc, layout, settings);
    renderToday(doc, settings, layout);

    emit(EV.RENDER_DONE, { objects: layout.rects.length });
  }

  /* ── Ruler ─────────────────────────────────────────────────────────────── */

  function renderRuler(doc, settings) {
    const scale = viewport.currentScale();
    const header = viewport.headerScale();
    const { from, to } = viewport.visibleRange(120);
    const todayIso = toISO(effectiveToday(doc));

    clear(dom.bandUpper);
    clear(dom.bandLower);

    // Upper band — the coarser unit (month over week, quarter over month, …).
    if (header.id !== scale.id) {
      const upper = ticks(header.id, from, to, { weekStart: settings.weekStart });
      const upperFont = fontString({ size: 11, weight: 700, mono: true });
      const upperStride = strideFor(upper, (t) => labelFor(header.id, t), upperFont, 16);

      upper.forEach((tick, i) => {
        const x = viewport.msToPx(tick.start);
        const width = viewport.msToPx(tick.end) - x;
        if (width < 2) return;

        const node = el('div', { class: 'tl-tick major', style: { left: `${x}px`, width: `${width}px` } });
        if (i % upperStride === 0) {
          placeTickLabel(node, x, width, labelFor(header.id, tick), upperFont, { stride: upperStride });
        }
        dom.bandUpper.appendChild(node);
      });
    }

    // Lower band — the working unit.
    const list = ticks(scale.id, from, to, { weekStart: settings.weekStart });
    const lowerFont = fontString({ size: 10, weight: 500, mono: true });
    const stride = strideFor(list, (t) => t.label, lowerFont, 12);

    list.forEach((tick, i) => {
      const x = viewport.msToPx(tick.start);
      const width = viewport.msToPx(tick.end) - x;
      if (width < 1.5) return;

      let cls = 'tl-tick';
      if (tick.major) cls += ' major';
      if (tick.weekend && settings.showWeekends) cls += ' weekend';
      if (scale.id === 'day' && toISO(tick.start) === todayIso) cls += ' today';

      const node = el('div', { class: cls, style: { left: `${x}px`, width: `${width}px` } });

      // Only label every `stride`-th tick. Every label that *is* drawn is drawn
      // in full — labels are never clipped or ellipsised, just spaced out far
      // enough that they cannot collide.
      if (i % stride === 0) {
        placeTickLabel(node, x, width, tick.label, lowerFont, { stride, sub: tick.sub || '' });
      }
      dom.bandLower.appendChild(node);
    });
  }

  /**
   * Place a ruler tick's label, nudging it into view when the tick starts off
   * the left edge — but only when the visible sliver is genuinely wide enough
   * to hold it.
   *
   * Without that second condition the nudge pushes the label of a mostly
   * off-screen tick rightwards until it prints on top of the next tick's label,
   * which is exactly the overlap this guards against. When it will not fit, the
   * label is dropped: the next tick along still names the period, so nothing is
   * lost, and no text is ever drawn over other text.
   *
   * @returns {boolean} whether the label was drawn.
   */
  function placeTickLabel(node, x, width, text, font, { stride = 1, sub = '', gap = 12 } = {}) {
    const inset = 7;
    const subGap = 5; // matches .tk-sub's margin-left

    // Room this label has before the *next labelled* tick begins. Unlabelled
    // ticks in between are just rules, so the text may run over them.
    const reach = width * stride;
    const available = (x < 0 ? x + reach : reach) - inset - gap;

    if (textWidth(text, font) > available) return false;

    if (x < 0) node.style.paddingLeft = `${-x + inset}px`;
    node.appendChild(el('span', { text }));

    // The secondary label (a date under a week, a year under a month) is
    // optional: it only appears when it too fits inside the same reach.
    if (sub && textWidth(text, font) + subGap + textWidth(sub, font) <= available) {
      node.appendChild(el('span', { class: 'tk-sub', text: sub }));
    }
    return true;
  }

  /**
   * How many ticks to skip between labels so that no two labels can touch.
   *
   * Derived from the measured width of the widest label in view rather than a
   * guessed character count, which is what lets the ruler drop the *number* of
   * labels without ever shortening one.
   */
  function strideFor(list, labelOf, font, gap) {
    if (!list.length) return 1;
    const px = viewport.msToPx(list[0].end) - viewport.msToPx(list[0].start);
    if (px <= 0) return 1;

    let widest = 0;
    // Sampling a slice is enough: labels within one scale are near-uniform.
    const step = Math.max(1, Math.floor(list.length / 24));
    for (let i = 0; i < list.length; i += step) {
      widest = Math.max(widest, textWidth(labelOf(list[i]), font));
    }
    return Math.max(1, Math.ceil((widest + gap) / px));
  }

  function labelFor(scaleId, tick) {
    if (scaleId === 'month') return `${tick.label} ${tick.sub}`;
    if (scaleId === 'quarter') return `${tick.label} ${tick.sub}`;
    if (scaleId === 'week') return `${tick.label} · ${tick.sub}`;
    return tick.label;
  }

  /* ── Lane gutter ───────────────────────────────────────────────────────── */

  function renderGutter(layout) {
    clear(dom.gutterInner);
    const doc = getDoc();

    for (const entry of layout.geometry.lanes) {
      const lane = entry.lane;
      const count = doc.objects.filter((o) => o.lane === lane.id).length;

      const node = el('div', {
        class: 'tl-lane-label' + (lane.locked ? ' locked' : '') + (lane.collapsed ? ' collapsed' : ''),
        style: { height: `${entry.height}px`, color: lane.color },
        dataset: { laneId: lane.id },
      }, [
        el('div', { class: 'll-bar' }),
        el('div', { class: 'll-grip', html: icon('move', { size: 12 }), dataset: { laneDrag: lane.id }, title: 'Drag to reorder' }),
        el('div', { class: 'll-main' }, [
          el('div', { class: 'll-name', style: { color: 'var(--text)' }, text: lane.name }),
          el('div', { class: 'll-meta', text: `${count} item${count === 1 ? '' : 's'}${lane.locked ? ' · locked' : ''}` }),
        ]),
        el('div', { class: 'll-actions' }, [
          el('button', {
            class: 'cx-btn icon mini ghost',
            title: lane.collapsed ? 'Expand lane' : 'Collapse lane',
            'aria-label': lane.collapsed ? 'Expand lane' : 'Collapse lane',
            html: icon(lane.collapsed ? 'chevron-right' : 'chevron-down', { size: 12 }),
            dataset: { laneAction: 'collapse', laneId: lane.id },
          }),
          el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Lane options',
            'aria-label': 'Lane options',
            html: icon('more', { size: 12 }),
            dataset: { laneAction: 'menu', laneId: lane.id },
          }),
        ]),
        el('div', { class: 'tl-lane-resize', dataset: { laneResize: lane.id } }),
      ]);

      dom.gutterInner.appendChild(node);
    }

    dom.gutterInner.style.transform = `translateY(${-scrollTop}px)`;
  }

  /* ── Grid ──────────────────────────────────────────────────────────────── */

  function renderGrid(doc, settings, layout) {
    clear(dom.grid);
    if (!settings.gridlines && !settings.showWeekends) return;

    const scale = viewport.currentScale();
    const { from, to } = viewport.visibleRange(60);
    const list = ticks(scale.id, from, to, { weekStart: settings.weekStart });
    const spacing = list.length > 1 ? viewport.msToPx(list[1].start) - viewport.msToPx(list[0].start) : 40;

    // Below ~4px between lines the grid reads as noise; drop to the major unit.
    const showMinor = settings.gridlines && spacing >= 4 && settings.gridDensity !== 'major';
    const showMajor = settings.gridlines && settings.gridDensity !== 'off';

    const fragment = document.createDocumentFragment();

    for (const tick of list) {
      const x = Math.round(viewport.msToPx(tick.start));
      if (settings.showWeekends && tick.weekend && scale.id === 'day') {
        const width = viewport.msToPx(tick.end) - viewport.msToPx(tick.start);
        fragment.appendChild(el('div', { class: 'tl-gridband', style: { left: `${x}px`, width: `${width}px` } }));
      }
      if (tick.major ? showMajor : showMinor) {
        fragment.appendChild(el('div', { class: 'tl-gridline' + (tick.major ? ' major' : ''), style: { left: `${x}px` } }));
      }
    }

    dom.grid.appendChild(fragment);
  }

  /* ── Lane bands ────────────────────────────────────────────────────────── */

  function renderLaneRows(layout) {
    clear(dom.laneRows);
    const fragment = document.createDocumentFragment();
    layout.geometry.lanes.forEach((entry, i) => {
      fragment.appendChild(
        el('div', {
          class: 'tl-lane-row' + (i % 2 ? ' alt' : '') + (entry.lane.locked ? ' locked' : ''),
          style: { top: `${entry.y}px`, height: `${entry.height}px` },
          dataset: { laneRow: entry.lane.id },
        })
      );
    });
    dom.laneRows.appendChild(fragment);
  }

  /* ── Objects ───────────────────────────────────────────────────────────── */

  function renderObjects(layout, settings) {
    const seen = new Set();
    const selection = new Set(getSelection());
    const violations = linkViolations(getDoc());

    for (const rect of layout.rects) {
      seen.add(rect.id);
      let node = objectNodes.get(rect.id);
      if (!node) {
        node = el('div', { class: 'tl-obj', dataset: { objId: rect.id }, tabindex: '0' });
        objectNodes.set(rect.id, node);
        dom.objects.appendChild(node);
      }
      paintObject(node, rect, settings, selection.has(rect.id), violations.objects.get(rect.id) || null);
    }

    // Retire nodes for objects that scrolled out of view or were deleted.
    for (const [id, node] of objectNodes) {
      if (!seen.has(id)) {
        node.remove();
        objectNodes.delete(id);
      }
    }
  }

  /**
   * Paint one object. Rebuilds the node's inner markup only when the visual
   * signature changes; position and size are always applied directly, which is
   * the path a drag takes.
   */
  function paintObject(node, rect, settings, selected, breaches) {
    const obj = rect.obj;
    const def = TYPES[obj.type] || TYPES.activity;
    const style = obj.style || {};
    const color = objectColor(obj, rect.lane);

    // The full, unwrapped label is the object's accessible name and the handle
    // tests and tooling use to find it.
    const fullLabel = [obj.title, obj.subtitle].filter(Boolean).join(' — ');
    node.setAttribute('aria-label', `${def.label}: ${fullLabel}`);
    node.dataset.label = fullLabel;

    node.style.left = `${rect.x}px`;
    node.style.top = `${rect.y}px`;
    node.style.width = `${rect.w}px`;
    node.style.height = `${rect.h}px`;
    // Backdrop shapes live in their own stacking band so a container or a
    // freeze period can never cover the activities drawn inside it, whatever
    // order they were created in.
    const zBase = def.shape === 'container' ? 0 : def.shape === 'band' ? 40 : 100;
    node.style.zIndex = String(zBase + (obj.z || 0));

    const signature = [
      obj.type,
      obj.title,
      obj.status,
      obj.progress,
      obj.icon,
      obj.locked,
      obj.groupId,
      color,
      rect.w < 52,
      rect.dimmed,
      selected,
      settings.showProgress,
      JSON.stringify(style),
      obj.subtitle,
      Math.round(rect.h),
      rect.label.placement,
      rect.label.lines.join('\u0001'),
      rect.label.subLines.join('\u0001'),
      breaches ? breaches.map((b) => `${b.role}:${b.shortfallDays}`).join(',') : '',
      obj.notes ? 1 : 0,
      (obj.attachments || []).length,
    ].join('|');

    if (node.dataset.sig !== signature) {
      node.dataset.sig = signature;
      buildObjectMarkup(node, rect, def, color, settings, breaches);
    }

    node.className = objectClass(rect, def, selected, breaches);
    if (breaches) node.dataset.violated = String(breaches.length);
    else delete node.dataset.violated;
    node.style.setProperty('--obj-radius', `${style.radius ?? 6}px`);
    node.style.opacity = String(style.opacity ?? 1);
    if (style.rotation) node.style.transform = `rotate(${style.rotation}deg)`;
    else node.style.transform = '';
  }

  function objectClass(rect, def, selected, breaches) {
    let cls = `tl-obj shape-${def.shape}`;
    if (selected) cls += ' selected';
    if (rect.obj.locked) cls += ' locked';
    if (rect.dimmed) cls += ' filtered-out';
    if (rect.obj.groupId) cls += ' grouped';
    if (breaches) cls += ' violated';
    return cls;
  }

  function buildObjectMarkup(node, rect, def, color, settings, breaches) {
    clear(node);
    const obj = rect.obj;
    const style = obj.style || {};
    const shape = def.shape;
    const ink = style.textColor || readableInk(resolveColor(color));

    switch (shape) {
      case 'diamond':
        buildDiamond(node, rect, color, ink);
        break;
      case 'release':
        buildRelease(node, rect, color);
        break;
      case 'marker':
        buildMarker(node, rect, color);
        break;
      case 'sticky':
        buildSticky(node, rect, color);
        break;
      case 'callout':
        buildCallout(node, rect, color, ink);
        break;
      case 'text':
        buildText(node, rect);
        break;
      case 'image':
        buildImage(node, rect);
        break;
      case 'band':
      case 'container':
        buildBand(node, rect, color, shape);
        break;
      case 'shape':
      case 'bar':
      default:
        buildBar(node, rect, color, ink, settings);
        break;
    }

    if (breaches) node.appendChild(violationFlag(breaches));

    // Interaction affordances — only for things the user can actually grab.
    if (!obj.locked && rect.hasDuration && shape !== 'band') {
      node.appendChild(el('div', { class: 'tl-handle left', dataset: { handle: 'start' } }));
      node.appendChild(el('div', { class: 'tl-handle right', dataset: { handle: 'end' } }));
    }
    if (!obj.locked && shape !== 'text' && shape !== 'sticky') {
      node.appendChild(el('div', { class: 'tl-anchor start', dataset: { anchor: 'start' }, title: 'Drag to link' }));
      node.appendChild(el('div', { class: 'tl-anchor end', dataset: { anchor: 'end' }, title: 'Drag to link' }));
    }
  }

  /**
   * Render a measured label block: one <span> per wrapped line.
   *
   * The layout pass has already decided the wrap points and reserved the space,
   * so nothing here needs to shorten, clip or ellipsise anything — it just
   * prints the lines it was given.
   */
  function labelBlock(label, { className = 'ob-textwrap' } = {}) {
    // The line spans are visual fragments of one sentence, so they are hidden
    // from assistive technology; the object node carries the whole string as
    // its accessible name instead.
    const wrap = el('span', { class: className, 'aria-hidden': 'true' });
    for (const line of label.lines) {
      wrap.appendChild(el('span', { class: 'ob-line', text: line }));
    }
    for (const line of label.subLines) {
      wrap.appendChild(el('span', { class: 'ob-line ob-sub', text: line }));
    }
    return wrap;
  }

  /** Full label placed beside a bar too narrow to hold it. */
  function outsideLabel(rect) {
    const node = labelBlock(rect.label, { className: 'ob-outside' });
    node.style.width = `${rect.label.width}px`;
    return node;
  }

  /** Centred label above or below a point glyph. */
  function pointLabel(rect) {
    const label = rect.label;
    const node = labelBlock(label, { className: 'ob-point-label' + (label.placement === 'above' ? ' above' : '') });
    node.style.width = `${label.width}px`;
    return node;
  }

  /* ── Shape builders ────────────────────────────────────────────────────── */

  function buildBar(node, rect, color, ink, settings) {
    const obj = rect.obj;
    const style = obj.style || {};

    const body = el('div', { class: 'ob-body' });
    const fill = el('div', { class: 'ob-fill' });
    applyFill(fill, color, style);
    body.appendChild(fill);

    if (settings.showProgress && TYPES[obj.type]?.progress && obj.progress > 0) {
      body.appendChild(el('div', { class: 'ob-progress', style: { width: `${clamp(obj.progress, 0, 100)}%` } }));
    }

    node.style.background = 'transparent';
    node.style.border = `${style.strokeWidth ?? 1}px solid ${style.stroke || withAlpha(resolveColor(color), 0.55)}`;
    node.style.borderRadius = `${style.radius ?? 6}px`;
    if (style.shadow) node.style.boxShadow = 'var(--shadow-md)';
    node.appendChild(body);

    const label = el('div', { class: 'ob-label' });
    applyTextStyle(label, style, ink);

    if (rect.label.placement === 'outside') {
      // The bar is too narrow to hold its text, so the full label — wrapped,
      // never shortened — sits immediately to its right. The packer reserved
      // that space, so it cannot be overprinted by the next object.
      node.appendChild(outsideLabel(rect));
      if (settings.showProgress && TYPES[obj.type]?.progress && obj.progress > 0 && rect.w > 34) {
        label.appendChild(el('span', { class: 'ob-pct', text: `${Math.round(obj.progress)}%` }));
        node.appendChild(label);
      }
    } else {
      if (obj.icon && rect.w > 34) {
        label.appendChild(el('span', { class: 'ob-icon', html: icon(obj.icon, { size: Math.min(14, rect.h - 6) }) }));
      }
      label.appendChild(labelBlock(rect.label));
      if (settings.showProgress && TYPES[obj.type]?.progress && obj.progress > 0) {
        label.appendChild(el('span', { class: 'ob-pct', text: `${Math.round(obj.progress)}%` }));
      }
      node.appendChild(label);
    }

    appendMarks(node, obj, rect);
  }

  function buildBand(node, rect, color, shape) {
    const obj = rect.obj;
    const style = obj.style || {};
    const resolved = resolveColor(color);

    const body = el('div', { class: 'ob-body' });
    const fill = el('div', { class: 'ob-fill' });
    applyFill(fill, color, style);
    body.appendChild(fill);

    node.style.background = 'transparent';
    node.style.borderRadius = `${style.radius ?? 6}px`;
    node.style.border = `${style.strokeWidth ?? 1}px ${shape === 'band' ? 'dashed' : 'solid'} ${style.stroke || withAlpha(resolved, 0.6)}`;
    node.appendChild(body);

    const label = el('div', { class: 'ob-label' });
    applyTextStyle(label, style, style.textColor || resolved);
    if (obj.icon) label.appendChild(el('span', { class: 'ob-icon', html: icon(obj.icon, { size: 13 }) }));
    if (rect.label.placement === 'outside') node.appendChild(outsideLabel(rect));
    else label.appendChild(labelBlock(rect.label));
    node.appendChild(label);
  }

  function buildDiamond(node, rect, color, ink) {
    const obj = rect.obj;
    const resolved = resolveColor(color);
    node.style.background = 'transparent';
    node.style.border = 'none';

    node.appendChild(
      el('div', { class: 'ob-glyph' }, [
        el('div', {
          class: 'ob-diamond',
          style: {
            background: resolved,
            border: `1.5px solid ${obj.style?.stroke || withAlpha(resolved, 0.9)}`,
            boxShadow: obj.style?.shadow ? 'var(--shadow-md)' : 'none',
          },
        }),
      ])
    );
    node.appendChild(pointLabel(rect));
    appendMarks(node, obj, rect);
  }

  function buildRelease(node, rect, color) {
    const obj = rect.obj;
    const status = statusOf(obj.status);
    const resolved = resolveColor(obj.style?.fill || status.color);
    node.style.background = 'transparent';
    node.style.border = 'none';
    node.style.width = `${Math.max(rect.w, 30)}px`;

    node.appendChild(el('div', { class: 'ob-flag', style: { background: resolved } }));
    node.appendChild(
      el('div', {
        class: 'ob-chip',
        style: {
          background: withAlpha(resolved, 0.18),
          borderColor: withAlpha(resolved, 0.6),
          color: resolved,
        },
      }, [
        el('span', { style: { display: 'flex' }, html: icon(obj.icon || 'package', { size: 11 }) }),
        el('span', { text: obj.data?.version ? `v${obj.data.version}` : obj.title }),
      ])
    );
    node.appendChild(pointLabel(rect));
    appendMarks(node, obj, rect);
  }

  function buildMarker(node, rect, color) {
    const obj = rect.obj;
    const severity = obj.data?.severity;
    const resolved = resolveColor(
      obj.style?.fill || (severity === 'critical' || severity === 'high' ? 'var(--bad)' : color)
    );
    node.style.background = 'transparent';
    node.style.border = 'none';

    node.appendChild(
      el('div', { class: 'ob-glyph' }, [
        el('div', { class: 'ob-pin', style: { background: resolved, color: readableInk(resolved) } }, [
          el('span', { html: icon(obj.icon || 'alert', { size: 11 }) }),
        ]),
      ])
    );
    node.appendChild(pointLabel(rect));
    appendMarks(node, obj, rect);
  }

  function buildSticky(node, rect, color) {
    const obj = rect.obj;
    const style = obj.style || {};
    const resolved = resolveColor(style.fill || color);
    node.style.background = 'transparent';
    node.style.border = 'none';
    node.style.borderRadius = `${style.radius ?? 4}px`;

    const body = el('div', { class: 'ob-body', style: { background: resolved, borderRadius: `${style.radius ?? 4}px` } });
    node.appendChild(body);

    const note = el('div', { class: 'ob-note' });
    applyTextStyle(note, style, style.textColor || readableInk(resolved));
    note.appendChild(labelBlock(rect.label));
    node.appendChild(note);
  }

  function buildCallout(node, rect, color, ink) {
    const obj = rect.obj;
    const style = obj.style || {};
    const resolved = resolveColor(style.fill || color);
    node.style.background = withAlpha(resolved, 0.16);
    node.style.border = `1px solid ${withAlpha(resolved, 0.65)}`;
    node.style.borderRadius = `${style.radius ?? 8}px`;

    const label = el('div', { class: 'ob-label' });
    applyTextStyle(label, style, style.textColor || 'var(--text)');
    if (obj.icon) label.appendChild(el('span', { class: 'ob-icon', html: icon(obj.icon, { size: 13 }) }));
    label.appendChild(labelBlock(rect.label));
    node.appendChild(label);
    node.appendChild(
      el('div', {
        class: 'ob-tail',
        style: { background: withAlpha(resolved, 0.16), borderColor: withAlpha(resolved, 0.65) },
      })
    );
  }

  function buildText(node, rect) {
    const obj = rect.obj;
    const style = obj.style || {};
    const label = el('div', { class: 'ob-label' });
    applyTextStyle(label, style, style.textColor || 'var(--text)');
    label.appendChild(labelBlock(rect.label));
    node.appendChild(label);
  }

  function buildImage(node, rect) {
    const obj = rect.obj;
    const style = obj.style || {};
    node.style.borderRadius = `${style.radius ?? 6}px`;
    node.style.border = `${style.strokeWidth ?? 1}px solid ${style.stroke || 'var(--border-strong)'}`;
    node.style.overflow = 'hidden';

    if (obj.data?.src) {
      const img = el('img', { class: 'ob-img', src: obj.data.src, alt: obj.title || 'Image' });
      node.appendChild(img);
    } else {
      node.appendChild(el('div', { class: 'ob-img-missing', html: icon('image', { size: 18 }) }));
    }
  }

  /**
   * The flag shown on both ends of a broken dependency.
   *
   * Sits outside the bar's top-left corner so it is visible even on a bar only
   * a few pixels wide, and states the worst shortfall in days rather than just
   * asserting that something is wrong.
   */
  function violationFlag(breaches) {
    const worst = breaches.reduce((max, b) => Math.max(max, b.shortfallDays), 0);
    const asSuccessor = breaches.some((b) => b.role === 'successor');
    const detail = asSuccessor
      ? `Starts ${worst} day${worst === 1 ? '' : 's'} before its predecessor allows`
      : `Finishes ${worst} day${worst === 1 ? '' : 's'} after its successor starts`;

    // Deliberately not `.ob-flag` — that class is the release shape's coloured
    // pole, and reusing it here restyled every release marker.
    return el('div', {
      class: 'ob-breach',
      title: `Dependency broken — ${detail}`,
      'aria-label': `Dependency broken. ${detail}`,
    }, [
      el('span', { html: icon('warning', { size: 9 }), style: { display: 'flex' } }),
      el('span', { text: `${worst}d` }),
    ]);
  }

  /** Small indicators: notes, attachments, lock, group membership. */
  function appendMarks(node, obj, rect) {
    const marks = [];
    if (obj.notes) marks.push('comment');
    if ((obj.attachments || []).length) marks.push('paperclip');
    if (obj.locked) marks.push('lock');
    if (!marks.length || rect.w < 44) return;

    const strip = el('div', {
      style: {
        position: 'absolute',
        right: '4px',
        top: '2px',
        display: 'flex',
        gap: '3px',
        opacity: '0.75',
        pointerEvents: 'none',
        zIndex: '4',
      },
    });
    for (const name of marks) strip.appendChild(el('span', { html: icon(name, { size: 9 }), style: { display: 'flex' } }));
    node.appendChild(strip);
  }

  /* ── Style application ─────────────────────────────────────────────────── */

  /** Resolve a CSS custom property to a concrete colour for luminance maths. */
  function resolveColor(color) {
    if (!color) return '#5b93f5';
    if (!String(color).startsWith('var(')) return color;
    const name = String(color).slice(4, -1).trim();
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || '#5b93f5';
  }

  /** Background: flat, gradient or pattern fill. */
  function applyFill(node, color, style) {
    const resolved = resolveColor(style.fill || color);

    if (style.gradient) {
      node.style.background = `linear-gradient(180deg, ${withAlpha(resolved, 0.95)} 0%, ${withAlpha(resolved, 0.55)} 100%)`;
    } else {
      node.style.background = resolved;
    }

    if (style.pattern && style.pattern !== 'none') {
      const ink = withAlpha(readableInk(resolved) === '#ffffff' ? '#ffffff' : '#000000', 0.22);
      const patterns = {
        stripes: `repeating-linear-gradient(45deg, transparent, transparent 5px, ${ink} 5px, ${ink} 10px)`,
        hatch: `repeating-linear-gradient(-45deg, transparent, transparent 4px, ${ink} 4px, ${ink} 6px)`,
        dots: `radial-gradient(${ink} 1.4px, transparent 1.5px)`,
        grid: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px)`,
      };
      const overlay = patterns[style.pattern];
      if (overlay) {
        node.style.backgroundImage = `${overlay}, ${node.style.background}`;
        if (style.pattern === 'dots') node.style.backgroundSize = '8px 8px, auto';
        if (style.pattern === 'grid') node.style.backgroundSize = '10px 10px, 10px 10px, auto';
      }
    }
  }

  function applyTextStyle(node, style, ink) {
    node.style.color = ink;
    node.style.fontSize = `${style.fontSize || 12}px`;
    if (style.font) node.style.fontFamily = style.font;
    node.style.fontWeight = style.bold ? '700' : '500';
    node.style.fontStyle = style.italic ? 'italic' : 'normal';
    node.style.textDecoration = style.underline ? 'underline' : 'none';
    node.style.justifyContent = style.align === 'center' ? 'center' : style.align === 'right' ? 'flex-end' : 'flex-start';
    node.style.textAlign = style.align || 'left';
  }

  /* ── Baseline comparison ───────────────────────────────────────────────── */

  /**
   * Where the plan *was*, drawn against where it is now.
   *
   * A baseline is only useful if the difference is obvious at a glance, so this
   * draws three things rather than one marker:
   *
   *   the ghost      the object at its baseline dates, behind the live bar at
   *                  the same height — so the two read as one object that moved,
   *                  not as two unrelated shapes,
   *   the shift      an arrow from the baseline finish to the current finish,
   *                  labelled with the number of days, coloured by direction.
   *                  This is the part that makes a slip legible across a lane,
   *   what is gone   objects that were in the baseline and are no longer in the
   *                  plan, drawn as hollow outlines where they used to sit.
   *                  Nothing else in the application shows those at all.
   *
   * Everything here is derived from the document and the snapshot on every
   * frame; no comparison state is stored, so it cannot go stale.
   */
  function renderBaseline(layout, settings) {
    dom.overlay.querySelectorAll('.tl-baseline, .tl-shift, .tl-baseline-gone').forEach((n) => n.remove());
    const banner = dom.root?.querySelector('.tl-baseline-bar');

    const baseline = settings.showBaseline ? activeBaseline() : null;
    if (!baseline) {
      banner?.remove();
      return;
    }

    const snapshot = new Map(baseline.snapshot.map((s) => [s.id, s]));
    const fragment = document.createDocumentFragment();
    const seen = new Set();
    const counts = { slip: 0, ahead: 0, reshaped: 0, gone: 0 };

    for (const rect of layout.rects) {
      const snap = snapshot.get(rect.id);
      if (!snap) continue;
      seen.add(rect.id);

      const startShift = daysBetween(snap.start, rect.obj.start);
      const endShift = rect.hasDuration
        ? daysBetween(snap.end ?? snap.start, rect.obj.end)
        : startShift;
      if (!startShift && !endShift) continue;

      const tone = endShift > 0 ? 'slip' : endShift < 0 ? 'ahead' : 'reshaped';
      counts[tone]++;
      const ghostLeft = rect.hasDuration ? viewport.msToPx(snap.start) : viewport.msToPx(snap.start) - rect.w / 2;
      const ghostWidth = rect.hasDuration
        ? Math.max(4, viewport.msToPx(snap.end ?? snap.start) - viewport.msToPx(snap.start))
        : rect.w;

      fragment.appendChild(
        el('div', {
          class: `tl-baseline ${tone}`,
          style: {
            left: `${ghostLeft}px`,
            top: `${rect.y}px`,
            width: `${ghostWidth}px`,
            height: `${rect.h}px`,
          },
          title: baselineTitle(rect.obj, snap, startShift, endShift, rect.hasDuration),
        })
      );

      // The arrow runs between the two finish edges, which is the movement the
      // reader cares about. A reshape (same finish, different start) gets the
      // start edges instead, or there would be nothing to draw.
      const shift = tone === 'reshaped' ? startShift : endShift;
      const fromX = tone === 'reshaped' ? ghostLeft : ghostLeft + ghostWidth;
      const toX = tone === 'reshaped' ? rect.x : rect.right;
      if (shift) {
        fragment.appendChild(shiftArrow(fromX, toX, rect.y + rect.h / 2, shift, tone));
      }
    }

    // Objects the baseline had and the plan no longer does. They have no rect,
    // so their position comes from the snapshot and from whichever lane they
    // used to be in — falling back to the top of the canvas when that lane has
    // gone too.
    for (const [id, snap] of snapshot) {
      if (seen.has(id) || layout.byId.has(id)) continue;
      const entry = layout.geometry.lanes.find((l) => l.id === snap.lane) || layout.geometry.lanes[0];
      if (!entry) continue;

      const left = viewport.msToPx(snap.start);
      const width = Math.max(10, viewport.msToPx(snap.end ?? snap.start) - left);

      fragment.appendChild(
        el('div', {
          class: 'tl-baseline-gone',
          style: {
            left: `${left}px`,
            top: `${entry.contentY}px`,
            width: `${width}px`,
            height: `${Math.min(22, entry.contentH)}px`,
          },
          title: `Removed since the baseline: ${snap.title}`,
        }, [el('span', { class: 'bg-label', text: snap.title })])
      );
      counts.gone++;
    }

    dom.overlay.appendChild(fragment);
    renderBaselineBar(baseline, counts);
  }

  /**
   * A strip naming the baseline and counting the differences.
   *
   * Comparison mode changes what every bar on the canvas means, so it says so
   * rather than leaving the reader to infer it from the hatching.
   */
  function renderBaselineBar(baseline, counts) {
    if (!dom.root) return;
    let bar = dom.root.querySelector('.tl-baseline-bar');
    if (!bar) {
      bar = el('div', { class: 'tl-baseline-bar', role: 'status' });
      dom.root.appendChild(bar);
    }
    clear(bar);

    const total = counts.slip + counts.ahead + counts.reshaped + counts.gone;
    bar.append(
      el('span', { class: 'bb-eyebrow', text: 'Baseline' }),
      el('span', { class: 'bb-name', text: baseline.name, title: baseline.name }),
      el('span', { class: 'bb-sep' }),
      ...(total
        ? [
            counts.slip ? el('span', { class: 'bb-stat slip', text: `${counts.slip} slipped` }) : null,
            counts.ahead ? el('span', { class: 'bb-stat ahead', text: `${counts.ahead} ahead` }) : null,
            counts.reshaped ? el('span', { class: 'bb-stat reshaped', text: `${counts.reshaped} reshaped` }) : null,
            counts.gone ? el('span', { class: 'bb-stat gone', text: `${counts.gone} removed` }) : null,
          ].filter(Boolean)
        : [el('span', { class: 'bb-stat none', text: 'unchanged' })])
    );
  }

  /** A measured arrow between the baseline edge and the current one. */
  function shiftArrow(fromX, toX, y, days, tone) {
    const left = Math.min(fromX, toX);
    const width = Math.abs(toX - fromX);
    const label = `${days > 0 ? '+' : '−'}${Math.abs(days)}d`;

    return el('div', {
      class: `tl-shift ${tone} ${toX >= fromX ? 'right' : 'left'}`,
      style: { left: `${left}px`, top: `${y}px`, width: `${Math.max(width, 1)}px` },
    }, [
      el('span', { class: 'sh-line' }),
      el('span', { class: 'sh-head' }),
      // The label is placed outside the line's own box so a short shift still
      // shows its day count rather than clipping it to nothing.
      el('span', { class: 'sh-days', text: label }),
    ]);
  }

  function baselineTitle(obj, snap, startShift, endShift, hasDuration) {
    const was = hasDuration
      ? `${fmtDate(snap.start, 'medium')} → ${fmtDate(snap.end ?? snap.start, 'medium')}`
      : fmtDate(snap.start, 'medium');
    const moved = [
      startShift ? `starts ${Math.abs(startShift)}d ${startShift > 0 ? 'later' : 'earlier'}` : null,
      hasDuration && endShift ? `finishes ${Math.abs(endShift)}d ${endShift > 0 ? 'later' : 'earlier'}` : null,
    ].filter(Boolean).join(', ');
    return `Baseline: ${was}${moved ? ` — now ${moved}` : ''}`;
  }

  /* ── Connectors ────────────────────────────────────────────────────────── */

  let criticalIds = new Set();

  /** Interactions and analysis set the highlighted critical set. */
  function setCriticalIds(ids) {
    criticalIds = ids instanceof Set ? ids : new Set(ids || []);
  }

  function renderLinks(doc, layout, settings) {
    if (!settings.showConnectors) {
      while (dom.connectors.firstChild) dom.connectors.removeChild(dom.connectors.firstChild);
      return;
    }
    // Memoised on document identity, so asking every frame of a drag is free
    // once the document has settled.
    const routed = routeAll(doc.links, layout.byId, settings.connectorStyle, {
      criticalIds: settings.criticalPath ? criticalIds : null,
      violations: linkViolations(doc),
    });
    renderConnectors(dom.connectors, routed, {
      selectedLinkIds: selectedLinks,
      onSelect: (link, e) => emit('link:select', { link, event: e }),
    });
  }

  let selectedLinks = new Set();

  function setSelectedLinks(ids) {
    selectedLinks = new Set(ids || []);
    requestRender();
  }

  function getSelectedLinks() {
    return Array.from(selectedLinks);
  }

  /* ── Today marker ──────────────────────────────────────────────────────── */

  function renderToday(doc, settings, layout) {
    if (!settings.showToday) {
      dom.today.style.display = 'none';
      dom.todayFlag.style.display = 'none';
      return;
    }

    const simulated = !!settings.todayOverride;
    const ms = effectiveToday(doc);
    const x = viewport.msToPx(ms);

    dom.today.style.display = '';
    dom.today.style.left = `${x}px`;
    dom.today.className = 'tl-today' + (simulated ? ' simulated' : '');

    const onScreen = x > -60 && x < viewport.getWidth() + 60;
    dom.todayFlag.style.display = onScreen ? '' : 'none';
    dom.todayFlag.className = 'tl-today-flag' + (simulated ? ' simulated' : '');
    dom.todayFlag.style.left = `${x}px`;
    dom.todayFlag.textContent = simulated ? `SIMULATED ${fmtDate(ms, 'compact')}` : 'TODAY';
  }

  /* ── Overlay helpers (marquee, guides, link preview) ───────────────────── */

  function showMarquee(x1, y1, x2, y2) {
    let node = dom.overlay.querySelector('.tl-marquee');
    if (!node) {
      node = el('div', { class: 'tl-marquee' });
      dom.overlay.appendChild(node);
    }
    node.style.left = `${Math.min(x1, x2)}px`;
    node.style.top = `${Math.min(y1, y2)}px`;
    node.style.width = `${Math.abs(x2 - x1)}px`;
    node.style.height = `${Math.abs(y2 - y1)}px`;
  }

  function hideMarquee() {
    dom.overlay.querySelector('.tl-marquee')?.remove();
  }

  /** Vertical guide with a date label, shown while dragging. */
  function showGuide(x, label) {
    let line = dom.overlay.querySelector('.tl-guide');
    let tag = dom.overlay.querySelector('.tl-guide-label');
    if (!line) {
      line = el('div', { class: 'tl-guide' });
      dom.overlay.appendChild(line);
    }
    if (!tag) {
      tag = el('div', { class: 'tl-guide-label' });
      dom.overlay.appendChild(tag);
    }
    line.style.left = `${x}px`;
    tag.style.left = `${x}px`;
    tag.style.top = `${scrollTop + 6}px`;
    tag.textContent = label;
  }

  function hideGuide() {
    dom.overlay.querySelector('.tl-guide')?.remove();
    dom.overlay.querySelector('.tl-guide-label')?.remove();
  }

  /** Dashed path shown while dragging a new dependency. */
  function showLinkPreview(d) {
    let path = dom.connectors.querySelector('.tl-link-preview');
    if (!path) {
      path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'tl-link-preview');
      dom.connectors.appendChild(path);
    }
    path.setAttribute('d', d);
  }

  function hideLinkPreview() {
    dom.connectors.querySelector('.tl-link-preview')?.remove();
  }

  /** Scroll the canvas so an object is comfortably in view. */
  function revealObject(id, { center = true } = {}) {
    const doc = getDoc();
    const obj = doc.objects.find((o) => o.id === id);
    if (!obj) return;

    if (!viewport.rangeVisible(obj.start, obj.end || obj.start, -80)) {
      viewport.centerOn(obj.start + (TYPES[obj.type]?.duration ? (obj.end - obj.start) / 2 : 0), center ? 0.5 : 0.3);
    }

    renderNow();
    const rect = lastLayout?.byId.get(id);
    if (rect) {
      const target = rect.y - dom.scroll.clientHeight / 2 + rect.h / 2;
      dom.scroll.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }

    const node = objectNodes.get(id);
    if (node) {
      node.classList.add('search-hit');
      setTimeout(() => node.classList.remove('search-hit'), 3200);
    }
  }

  /** The DOM node currently representing an object, if it is on screen. */
  function nodeFor(id) {
    return objectNodes.get(id) || null;
  }

  /**
   * Force a rebuild of every object node — used after a theme change.
   * A theme may swap the interface font (Engineering uses the monospace stack),
   * so cached text measurements are discarded at the same time.
   */
  function invalidateAll() {
    resetTextCache();
    for (const node of objectNodes.values()) node.dataset.sig = '';
    requestRender();
  }

  Object.defineProperty(__x, "mount", { get: () => mount, enumerable: true });
  Object.defineProperty(__x, "elements", { get: () => elements, enumerable: true });
  Object.defineProperty(__x, "getScrollTop", { get: () => getScrollTop, enumerable: true });
  Object.defineProperty(__x, "getLayout", { get: () => getLayout, enumerable: true });
  Object.defineProperty(__x, "measure", { get: () => measure, enumerable: true });
  Object.defineProperty(__x, "requestRender", { get: () => requestRender, enumerable: true });
  Object.defineProperty(__x, "renderNow", { get: () => renderNow, enumerable: true });
  Object.defineProperty(__x, "setCriticalIds", { get: () => setCriticalIds, enumerable: true });
  Object.defineProperty(__x, "setSelectedLinks", { get: () => setSelectedLinks, enumerable: true });
  Object.defineProperty(__x, "getSelectedLinks", { get: () => getSelectedLinks, enumerable: true });
  Object.defineProperty(__x, "showMarquee", { get: () => showMarquee, enumerable: true });
  Object.defineProperty(__x, "hideMarquee", { get: () => hideMarquee, enumerable: true });
  Object.defineProperty(__x, "showGuide", { get: () => showGuide, enumerable: true });
  Object.defineProperty(__x, "hideGuide", { get: () => hideGuide, enumerable: true });
  Object.defineProperty(__x, "showLinkPreview", { get: () => showLinkPreview, enumerable: true });
  Object.defineProperty(__x, "hideLinkPreview", { get: () => hideLinkPreview, enumerable: true });
  Object.defineProperty(__x, "revealObject", { get: () => revealObject, enumerable: true });
  Object.defineProperty(__x, "nodeFor", { get: () => nodeFor, enumerable: true });
  Object.defineProperty(__x, "invalidateAll", { get: () => invalidateAll, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// timeline/interactions.js
// ════════════════════════════════════════════════════════════════════════
__mods["timeline/interactions.js"] = function (__x, __req) {
  /**
   * Pointer and gesture handling for the canvas.
   *
   * All direct manipulation lives here: panning, wheel zoom, selection,
   * marquee, moving and resizing objects, drawing dependencies, and dragging
   * lanes. Gestures use `store.preview()` for live feedback and commit exactly
   * once on release, so a drag across fifty pixels produces one undo step.
   *
   * The module never imports UI code — it publishes events (`object:activated`,
   * `canvas:contextmenu`, …) that the UI layer subscribes to.
   *
   * Imports: util, events, dates, model, store, viewport, layout, renderer, connectors.
   */

  const { clamp, closestData, hasMod, isTyping } = __req("core/util.js");
  const { emit, EV } = __req("core/events.js");
  const { MS_DAY, snap: snapMs, fmtDate, toISO, addMonths, addWeeks, addWorkingDays } = __req("core/dates.js");
  const { TYPES } = __req("core/model.js");
  const store = __req("core/store.js");
  const viewport = __req("timeline/viewport.js");
  const { hitTest, hitTestBox, laneAtY } = __req("timeline/layout.js");
  const renderer = __req("timeline/renderer.js");
  const { previewPath } = __req("timeline/connectors.js");

  /** Pixels the pointer must travel before a click becomes a drag. */
  const DRAG_THRESHOLD = 3;
  /** Wheel zoom sensitivity. */
  const ZOOM_STEP = 1.0016;

  let dom = null;
  let gesture = null; // the in-flight gesture, or null
  let spaceHeld = false;
  let hoveredId = null;

  /* ══════════════════════════════════════════════════════════════════════════
     Attach
     ═══════════════════════════════════════════════════════════════════════ */

  function attach() {
    dom = renderer.elements();

    dom.canvas.addEventListener('mousedown', onCanvasMouseDown);
    dom.canvas.addEventListener('mousemove', onCanvasMouseMove);
    dom.canvas.addEventListener('mouseleave', onCanvasMouseLeave);
    dom.canvas.addEventListener('dblclick', onCanvasDoubleClick);
    dom.canvas.addEventListener('contextmenu', onCanvasContextMenu);
    dom.canvas.addEventListener('wheel', onWheel, { passive: false });

    dom.ruler.addEventListener('mousedown', onRulerMouseDown);
    dom.ruler.addEventListener('wheel', onWheel, { passive: false });
    dom.ruler.addEventListener('dblclick', onRulerDoubleClick);

    dom.gutter.addEventListener('mousedown', onGutterMouseDown);
    dom.gutter.addEventListener('click', onGutterClick);
    dom.gutter.addEventListener('contextmenu', onGutterContextMenu);
    dom.gutter.addEventListener('wheel', onGutterWheel, { passive: false });

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('keydown', onSpaceDown);
    window.addEventListener('keyup', onSpaceUp);
    window.addEventListener('blur', () => {
      spaceHeld = false;
      dom.canvas.classList.remove('pan-ready');
    });
  }

  /* ── Coordinate helpers ────────────────────────────────────────────────── */

  /** Screen event → canvas coordinates (x from viewport origin, y in stage). */
  function toCanvas(e) {
    const rect = dom.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top + renderer.getScrollTop(),
      clientX: e.clientX,
      clientY: e.clientY,
    };
  }

  function snapDate(ms) {
    const settings = store.getSettings();
    return snapMs(ms, settings.snap, { weekStart: settings.weekStart, holidays: settings.holidays });
  }

  /** Human name of the active snap unit, shown on the drag guide. */
  function snapLabel() {
    const mode = store.getSettings().snap;
    return { day: 'day', workday: 'working day', week: 'week', month: 'month', quarter: 'quarter' }[mode] || '';
  }

  /**
   * Advance an instant by one snap unit.
   *
   * Keyboard nudging steps by whatever the snap dropdown says, so the two
   * controls agree: with week snapping, an arrow key moves a week. Stepping by a
   * single day under month snapping would round straight back to where it
   * started and look like the key had done nothing.
   */
  function stepBySnap(ms, direction, large = false) {
    const settings = store.getSettings();
    const n = direction * (large ? snapLargeMultiplier(settings.snap) : 1);
    switch (settings.snap) {
      case 'week':
        return addWeeks(ms, n);
      case 'month':
        return addMonths(ms, n);
      case 'quarter':
        return addMonths(ms, n * 3);
      case 'workday':
        return addWorkingDays(ms, n, settings.holidays);
      default:
        return ms + n * MS_DAY;
    }
  }

  function snapLargeMultiplier(mode) {
    return mode === 'week' ? 4 : mode === 'month' || mode === 'quarter' ? 3 : 7;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Wheel — zoom and scroll
     ═══════════════════════════════════════════════════════════════════════ */

  function onWheel(e) {
    const settings = store.getSettings();
    const wheelZooms = settings.wheelMode !== 'scroll';
    const zoom = hasMod(e) || (wheelZooms && !e.shiftKey);

    if (zoom) {
      e.preventDefault();
      const rect = dom.canvas.getBoundingClientRect();
      const anchor = clamp(e.clientX - rect.left, 0, rect.width);
      // Normalise the delta: line-mode wheels report ~3, pixel-mode ~100.
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      viewport.zoomBy(ZOOM_STEP ** -delta, anchor);
      renderer.requestRender();
      return;
    }

    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      // Horizontal pan — shift+wheel, or a trackpad's horizontal axis.
      e.preventDefault();
      viewport.panBy(-(e.deltaX || e.deltaY));
      renderer.requestRender();
      return;
    }

    // Vertical: let the scroll container handle it natively.
  }

  function onGutterWheel(e) {
    // The gutter has no scrollbar of its own; forward to the canvas.
    e.preventDefault();
    dom.scroll.scrollTop += e.deltaY;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Canvas pointer
     ═══════════════════════════════════════════════════════════════════════ */

  function onCanvasMouseDown(e) {
    if (e.button === 2) return; // right-click handled by contextmenu
    const point = toCanvas(e);
    const tool = store.getTool();

    // Object and handle presses call preventDefault to stop text selection,
    // which also suppresses the focus change a click would normally make. Left
    // alone, focus would stay in whatever toolbar dropdown or panel field was
    // last touched, and every keyboard shortcut would quietly stop working.
    if (!dom.canvas.contains(document.activeElement)) {
      dom.canvas.focus({ preventScroll: true });
    }

    // Middle button, space-drag or the pan tool always pans.
    if (e.button === 1 || spaceHeld || tool === 'pan') {
      e.preventDefault();
      startPan(point);
      return;
    }

    const anchorEl = closestData(e.target, 'anchor', dom.canvas);
    if (anchorEl) {
      const objEl = closestData(anchorEl, 'objId', dom.canvas);
      if (objEl) {
        e.preventDefault();
        startLink(objEl.dataset.objId, anchorEl.dataset.anchor, point);
        return;
      }
    }

    const handleEl = closestData(e.target, 'handle', dom.canvas);
    if (handleEl) {
      const objEl = closestData(handleEl, 'objId', dom.canvas);
      if (objEl) {
        e.preventDefault();
        startResize(objEl.dataset.objId, handleEl.dataset.handle, point);
        return;
      }
    }

    const objEl = closestData(e.target, 'objId', dom.canvas);
    if (objEl) {
      e.preventDefault();
      onObjectMouseDown(objEl.dataset.objId, point, e);
      return;
    }

    // Empty canvas: place a new object with a creation tool, else marquee.
    if (tool !== 'select' && TYPES[tool]) {
      e.preventDefault();
      placeObject(tool, point);
      return;
    }

    startMarquee(point, e);
  }

  function onObjectMouseDown(id, point, e) {
    const obj = store.getObject(id);
    if (!obj) return;

    const lane = store.getLane(obj.lane);
    const locked = obj.locked || lane?.locked;

    if (e.shiftKey || hasMod(e)) {
      store.toggleSelection(id);
      renderer.requestRender();
      return;
    }

    if (!store.isSelected(id)) {
      store.setSelection(store.expandGroupSelection([id]));
      renderer.requestRender();
    }

    if (locked) return;
    startMove(point);
  }

  function onCanvasMouseMove(e) {
    if (gesture) return;
    const point = toCanvas(e);
    const layout = renderer.getLayout();
    if (!layout) return;

    const hit = hitTest(layout, point.x, point.y);
    const id = hit ? hit.id : null;
    if (id !== hoveredId) {
      hoveredId = id;
      store.setHover(id);
      emit('canvas:hover', { id, rect: hit, clientX: e.clientX, clientY: e.clientY });
    } else if (id) {
      emit('canvas:hovermove', { id, clientX: e.clientX, clientY: e.clientY });
    }

    emit('canvas:cursor', { ms: viewport.pxToMs(point.x), x: point.x, y: point.y });
  }

  function onCanvasMouseLeave() {
    if (hoveredId) {
      hoveredId = null;
      store.setHover(null);
      emit('canvas:hover', { id: null });
    }
  }

  function onCanvasDoubleClick(e) {
    const objEl = closestData(e.target, 'objId', dom.canvas);
    if (objEl) {
      emit(EV.OBJECT_ACTIVATED, { id: objEl.dataset.objId });
      return;
    }
    const point = toCanvas(e);
    const layout = renderer.getLayout();
    const laneEntry = layout ? laneAtY(layout.geometry, point.y) : null;
    emit('canvas:createat', {
      ms: snapDate(viewport.pxToMs(point.x)),
      laneId: laneEntry?.id || null,
      x: point.x,
      y: point.y,
    });
  }

  function onCanvasContextMenu(e) {
    e.preventDefault();
    const point = toCanvas(e);
    const objEl = closestData(e.target, 'objId', dom.canvas);
    const layout = renderer.getLayout();
    const laneEntry = layout ? laneAtY(layout.geometry, point.y) : null;

    if (objEl) {
      const id = objEl.dataset.objId;
      if (!store.isSelected(id)) {
        store.setSelection(store.expandGroupSelection([id]));
        renderer.requestRender();
      }
      emit('canvas:contextmenu', { target: 'object', id, clientX: e.clientX, clientY: e.clientY });
    } else {
      emit('canvas:contextmenu', {
        target: 'canvas',
        ms: snapDate(viewport.pxToMs(point.x)),
        laneId: laneEntry?.id || null,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Gestures
     ═══════════════════════════════════════════════════════════════════════ */

  function startPan(point) {
    gesture = { kind: 'pan', startX: point.clientX, startY: point.clientY, startScroll: renderer.getScrollTop() };
    dom.canvas.classList.add('panning');
  }

  function startMarquee(point, e) {
    if (!e.shiftKey && !hasMod(e)) store.clearSelection();
    gesture = { kind: 'marquee', x0: point.x, y0: point.y, x1: point.x, y1: point.y, additive: e.shiftKey || hasMod(e), moved: false };
  }

  function startMove(point) {
    const ids = store.getSelection().filter((id) => {
      const obj = store.getObject(id);
      return obj && !obj.locked && !store.getLane(obj.lane)?.locked;
    });
    if (!ids.length) return;

    const originals = new Map(
      ids.map((id) => {
        const o = store.getObject(id);
        return [id, { start: o.start, end: o.end, lane: o.lane, row: o.row }];
      })
    );
    gesture = { kind: 'move', ids, originals, startX: point.x, startY: point.y, moved: false, lastDelta: 0 };
  }

  function startResize(id, edge, point) {
    const obj = store.getObject(id);
    if (!obj || obj.locked) return;
    gesture = {
      kind: 'resize',
      id,
      edge,
      original: { start: obj.start, end: obj.end },
      startX: point.x,
      moved: false,
    };
  }

  function startLink(id, side, point) {
    gesture = { kind: 'link', from: id, side, x: point.x, y: point.y, moved: false };
    dom.canvas.classList.add('connecting');
  }

  function placeObject(type, point) {
    const layout = renderer.getLayout();
    const laneEntry = layout ? laneAtY(layout.geometry, point.y) : null;
    const ms = snapDate(viewport.pxToMs(point.x));
    const def = TYPES[type];
    const id = store.addObject(
      {
        type,
        lane: laneEntry?.id || null,
        start: ms,
        end: def.duration ? ms + (def.defaultDays || 1) * MS_DAY : ms,
      },
      `Add ${def.label.toLowerCase()}`
    );
    store.setSelection([id]);
    store.setTool('select');
    renderer.requestRender();
    emit('object:created', { id, type });
  }

  /* ── Window-level drag continuation ────────────────────────────────────── */

  function onWindowMouseMove(e) {
    if (!gesture) return;

    const rect = dom.canvas.getBoundingClientRect();
    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top + renderer.getScrollTop(),
      clientX: e.clientX,
      clientY: e.clientY,
    };

    switch (gesture.kind) {
      case 'pan':
        viewport.panBy(e.clientX - gesture.startX);
        gesture.startX = e.clientX;
        dom.scroll.scrollTop = gesture.startScroll - (e.clientY - gesture.startY);
        renderer.requestRender();
        break;

      case 'marquee': {
        gesture.x1 = point.x;
        gesture.y1 = point.y;
        if (!gesture.moved && Math.hypot(gesture.x1 - gesture.x0, gesture.y1 - gesture.y0) > DRAG_THRESHOLD) gesture.moved = true;
        if (gesture.moved) {
          renderer.showMarquee(gesture.x0, gesture.y0, gesture.x1, gesture.y1);
          autoPanEdge(point.x);
        }
        break;
      }

      case 'move':
        moveDrag(point, e);
        break;

      case 'resize':
        resizeDrag(point, e);
        break;

      case 'link': {
        gesture.x = point.x;
        gesture.y = point.y;
        gesture.moved = true;
        const layout = renderer.getLayout();
        const fromRect = layout?.byId.get(gesture.from);
        if (fromRect) {
          renderer.showLinkPreview(previewPath(fromRect, gesture.side, point.x, point.y, store.getSettings().connectorStyle));
        }
        const hit = layout ? hitTest(layout, point.x, point.y) : null;
        gesture.target = hit && hit.id !== gesture.from ? hit.id : null;
        break;
      }

      case 'lane-drag':
        laneDragMove(e);
        break;

      case 'lane-resize':
        laneResizeMove(e);
        break;

      case 'ruler-pan':
        viewport.panBy(e.clientX - gesture.startX);
        gesture.startX = e.clientX;
        renderer.requestRender();
        break;

      default:
        break;
    }
  }

  function moveDrag(point, e) {
    const dx = point.x - gesture.startX;
    const dy = point.y - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    gesture.moved = true;

    const deltaMs = viewport.pxToDuration(dx);
    const layout = renderer.getLayout();
    const targetLane = layout ? laneAtY(layout.geometry, point.y) : null;
    // Alt suppresses lane changes, so a purely horizontal nudge stays in place.
    const laneChange = !e.altKey && targetLane ? targetLane.id : null;

    const targetLaneRecord = laneChange ? store.getLane(laneChange) : null;
    const canChangeLane = targetLaneRecord && !targetLaneRecord.locked && gesture.ids.length === 1;

    store.previewObjects(gesture.ids, (obj) => {
      const original = gesture.originals.get(obj.id);
      if (!original) return false;

      const snapped = snapDate(original.start + deltaMs);
      const shift = snapped - original.start;
      obj.start = original.start + shift;
      if (TYPES[obj.type]?.duration) obj.end = original.end + shift;

      if (canChangeLane) {
        obj.lane = laneChange;
        obj.row = 0; // let the packer re-place it in the new lane
      }
    });

    const first = store.getObject(gesture.ids[0]);
    if (first) {
      const unit = snapLabel();
      renderer.showGuide(viewport.msToPx(first.start), fmtDate(first.start, 'day') + (unit ? ` · snap ${unit}` : ''));
    }
    autoPanEdge(point.x);
    renderer.requestRender();
  }

  function resizeDrag(point, e) {
    const dx = point.x - gesture.startX;
    if (!gesture.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    gesture.moved = true;

    const deltaMs = viewport.pxToDuration(dx);
    const { start, end } = gesture.original;

    store.previewObjects([gesture.id], (obj) => {
      if (gesture.edge === 'start') {
        const next = snapDate(start + deltaMs);
        // Clamping to the minimum duration can knock the edge off the grid, so
        // snap once more after the clamp rather than leaving a stray date.
        obj.start = next <= obj.end - MS_DAY ? next : snapDate(obj.end - MS_DAY);
      } else {
        const next = snapDate(end + deltaMs);
        obj.end = next >= obj.start + MS_DAY ? next : snapDate(obj.start + MS_DAY);
      }
    });

    const obj = store.getObject(gesture.id);
    if (obj) {
      const edgeMs = gesture.edge === 'start' ? obj.start : obj.end;
      const days = Math.round((obj.end - obj.start) / MS_DAY);
      const unit = snapLabel();
      renderer.showGuide(viewport.msToPx(edgeMs), `${fmtDate(edgeMs, 'day')} · ${days}d${unit ? ` · snap ${unit}` : ''}`);
    }
    autoPanEdge(point.x);
    renderer.requestRender();
  }

  /** Scroll the timeline when a drag reaches the edge of the viewport. */
  function autoPanEdge(x) {
    const margin = 48;
    const width = viewport.getWidth();
    if (x < margin) viewport.panBy(Math.min(18, (margin - x) / 2));
    else if (x > width - margin) viewport.panBy(-Math.min(18, (x - (width - margin)) / 2));
  }

  function onWindowMouseUp(e) {
    if (!gesture) return;
    const finished = gesture;
    gesture = null;

    dom.canvas.classList.remove('panning', 'connecting');
    renderer.hideGuide();
    renderer.hideMarquee();
    renderer.hideLinkPreview();

    switch (finished.kind) {
      case 'marquee': {
        if (finished.moved) {
          const layout = renderer.getLayout();
          if (layout) {
            const hits = hitTestBox(layout, finished.x0, finished.y0, finished.x1, finished.y1).map((r) => r.id);
            store.setSelection(finished.additive ? [...store.getSelection(), ...hits] : hits);
          }
        }
        break;
      }

      case 'move': {
        if (!finished.moved) break;
        // Commit the whole gesture as one edit; preview() already staged it.
        const ids = finished.ids;
        const snapshot = new Map(ids.map((id) => {
          const o = store.getObject(id);
          return [id, { start: o.start, end: o.end, lane: o.lane, row: o.row }];
        }));
        store.cancelPreview();
        store.edit(ids.length > 1 ? `Move ${ids.length} objects` : 'Move object', (draft) => {
          for (const id of ids) {
            const obj = draft.objects.find((o) => o.id === id);
            const next = snapshot.get(id);
            if (obj && next) Object.assign(obj, next);
          }
        });
        break;
      }

      case 'resize': {
        if (!finished.moved) break;
        const obj = store.getObject(finished.id);
        const next = { start: obj.start, end: obj.end };
        store.cancelPreview();
        store.updateObject(finished.id, next, 'Resize object');
        break;
      }

      case 'link': {
        if (finished.target) {
          const created = store.addLink({ from: finished.from, to: finished.target, type: 'FS' });
          if (!created) {
            emit(EV.TOAST, {
              tone: 'warn',
              title: 'Dependency not created',
              message: 'That link already exists, or it would create a circular dependency.',
            });
          }
        } else if (finished.moved) {
          emit('link:dropped', { from: finished.from, x: finished.x, y: finished.y, clientX: e.clientX, clientY: e.clientY });
        }
        break;
      }

      case 'lane-drag':
        laneDragEnd(finished);
        break;

      case 'lane-resize':
        laneResizeEnd(finished);
        break;

      default:
        break;
    }

    renderer.requestRender();
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Ruler
     ═══════════════════════════════════════════════════════════════════════ */

  function onRulerMouseDown(e) {
    if (e.button === 2) return;
    e.preventDefault();
    gesture = { kind: 'ruler-pan', startX: e.clientX };
  }

  function onRulerDoubleClick(e) {
    const rect = dom.ruler.getBoundingClientRect();
    const ms = viewport.pxToMs(e.clientX - rect.left);
    emit('ruler:activated', { ms });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Lane gutter
     ═══════════════════════════════════════════════════════════════════════ */

  function onGutterMouseDown(e) {
    const resizeEl = closestData(e.target, 'laneResize', dom.gutter);
    if (resizeEl) {
      e.preventDefault();
      const lane = store.getLane(resizeEl.dataset.laneResize);
      gesture = { kind: 'lane-resize', id: lane.id, startY: e.clientY, startHeight: lane.height };
      return;
    }

    const dragEl = closestData(e.target, 'laneDrag', dom.gutter);
    if (dragEl) {
      e.preventDefault();
      const id = dragEl.dataset.laneDrag;
      gesture = { kind: 'lane-drag', id, startY: e.clientY, targetIndex: store.getDoc().laneOrder.indexOf(id) };
      dom.gutter.querySelector(`[data-lane-id="${id}"]`)?.classList.add('dragging');
    }
  }

  function laneDragMove(e) {
    const labels = Array.from(dom.gutter.querySelectorAll('.tl-lane-label'));
    let index = 0;
    for (const label of labels) {
      const rect = label.getBoundingClientRect();
      label.classList.remove('drop-target');
      if (e.clientY > rect.top + rect.height / 2) index++;
    }
    gesture.targetIndex = clamp(index, 0, labels.length - 1);
    labels[gesture.targetIndex]?.classList.add('drop-target');
  }

  /** Commit the reorder to wherever the label was dropped. */
  function laneDragEnd(finished) {
    dom.gutter.querySelectorAll('.dragging, .drop-target').forEach((n) => n.classList.remove('dragging', 'drop-target'));
    if (finished.targetIndex == null) return;
    store.moveLane(finished.id, finished.targetIndex);
  }

  function laneResizeMove(e) {
    const next = clamp(gesture.startHeight + (e.clientY - gesture.startY), 28, 480);
    store.preview((draft) => {
      const lane = draft.lanes.find((l) => l.id === gesture.id);
      if (!lane) return false;
      lane.height = next;
    });
    renderer.requestRender();
  }

  /** Roll back the live preview, then re-apply the height as one undoable edit. */
  function laneResizeEnd(finished) {
    const lane = store.getLane(finished.id);
    const height = lane ? lane.height : null;
    // Always unwind the preview: leaving one open would make the next edit diff
    // against a stale snapshot.
    store.cancelPreview();
    if (!lane || height === finished.startHeight) return;
    store.updateLane(finished.id, { height }, 'Resize lane');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Keyboard modifiers
     ═══════════════════════════════════════════════════════════════════════ */

  function onSpaceDown(e) {
    if (e.code === 'Space' && !isTyping(e.target) && !spaceHeld) {
      spaceHeld = true;
      dom.canvas.classList.add('pan-ready');
      e.preventDefault();
    }
  }

  function onSpaceUp(e) {
    if (e.code === 'Space') {
      spaceHeld = false;
      dom.canvas.classList.remove('pan-ready');
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Gutter clicks (collapse / menu)
     ═══════════════════════════════════════════════════════════════════════ */

  function onGutterClick(e) {
    const actionEl = closestData(e.target, 'laneAction', dom.gutter);
    if (!actionEl) return;
    const id = actionEl.dataset.laneId;
    const action = actionEl.dataset.laneAction;

    if (action === 'collapse') {
      const lane = store.getLane(id);
      store.updateLane(id, { collapsed: !lane.collapsed }, lane.collapsed ? 'Expand lane' : 'Collapse lane');
      renderer.requestRender();
    } else if (action === 'menu') {
      const rect = actionEl.getBoundingClientRect();
      emit('lane:menu', { id, clientX: rect.left, clientY: rect.bottom + 4 });
    }
  }

  function onGutterContextMenu(e) {
    const labelEl = closestData(e.target, 'laneId', dom.gutter);
    if (!labelEl) return;
    e.preventDefault();
    emit('lane:menu', { id: labelEl.dataset.laneId, clientX: e.clientX, clientY: e.clientY });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Programmatic helpers used by shortcuts and the inspector
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Move the selection by one snap unit (or several, with `large`).
   * The result is snapped to the grid, so the first press also aligns an object
   * that was sitting off it.
   */
  function nudgeSelection(direction, large = false) {
    const ids = store.getSelection().filter((id) => !store.getObject(id)?.locked);
    if (!ids.length) return;

    store.updateObjects(
      ids,
      (obj) => {
        const stepped = stepBySnap(obj.start, direction, large);
        let next = snapDate(stepped);
        // Snapping must never cancel the movement out entirely.
        if (next === obj.start) next = stepped;
        const shift = next - obj.start;
        return TYPES[obj.type]?.duration ? { start: next, end: obj.end + shift } : { start: next };
      },
      direction > 0 ? 'Move later' : 'Move earlier',
      { mergeKey: 'nudge' }
    );
    renderer.requestRender();
  }

  /** Grow or shrink the selection's duration by one snap unit. */
  function stretchSelection(direction) {
    const ids = store.getSelection().filter((id) => {
      const obj = store.getObject(id);
      return obj && !obj.locked && TYPES[obj.type]?.duration;
    });
    if (!ids.length) return;

    store.updateObjects(
      ids,
      (obj) => {
        const stepped = stepBySnap(obj.end, direction, false);
        let next = snapDate(stepped);
        if (next === obj.end) next = stepped;
        return { end: Math.max(obj.start + MS_DAY, next) };
      },
      'Change duration',
      { mergeKey: 'stretch' }
    );
    renderer.requestRender();
  }

  /** True while a gesture is in flight — the renderer avoids heavy work then. */
  function isDragging() {
    return gesture !== null;
  }

  function currentGesture() {
    return gesture;
  }

  Object.defineProperty(__x, "attach", { get: () => attach, enumerable: true });
  Object.defineProperty(__x, "stepBySnap", { get: () => stepBySnap, enumerable: true });
  Object.defineProperty(__x, "nudgeSelection", { get: () => nudgeSelection, enumerable: true });
  Object.defineProperty(__x, "stretchSelection", { get: () => stretchSelection, enumerable: true });
  Object.defineProperty(__x, "isDragging", { get: () => isDragging, enumerable: true });
  Object.defineProperty(__x, "currentGesture", { get: () => currentGesture, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/theme.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/theme.js"] = function (__x, __req) {
  /**
   * Theme management.
   *
   * The theme is a device preference, not project data: the same plan opened on
   * a projector should be able to use the Presentation palette without changing
   * the document. It is mirrored into the document's settings so exports can
   * reproduce the look, but the local preference always wins on load.
   *
   * Imports: events, storage, store, renderer.
   */

  const { emit, EV } = __req("core/events.js");
  const { getPref, setPref } = __req("core/storage.js");
  const { getDoc, setSetting } = __req("core/store.js");
  const { invalidateAll } = __req("timeline/renderer.js");

  const THEMES = [
    { id: 'dark', label: 'Dark', icon: 'moon', description: 'The default — engineering dashboard on deep slate.' },
    { id: 'light', label: 'Light', icon: 'sun', description: 'The CX Portal palette, value for value.' },
    { id: 'engineering', label: 'Engineering', icon: 'cpu', description: 'High-contrast instrument panel, monospace UI.' },
    { id: 'blueprint', label: 'Blueprint', icon: 'grid', description: 'Drafting-table blue with cyan rules.' },
    { id: 'presentation', label: 'Presentation', icon: 'maximize', description: 'Bright and low-chrome for customer meetings.' },
  ];

  let current = 'dark';

  function initTheme() {
    const saved = getPref('theme');
    const fromDoc = getDoc()?.settings?.theme;
    applyTheme(saved || fromDoc || 'dark', { persist: false });
  }

  function getTheme() {
    return current;
  }

  /**
   * Switch theme. Object nodes carry resolved colours (for contrast maths), so
   * every one is invalidated and repainted rather than left with stale ink.
   */
  function applyTheme(id, { persist = true, syncDoc = true } = {}) {
    const theme = THEMES.find((t) => t.id === id) ? id : 'dark';
    current = theme;
    document.documentElement.setAttribute('data-theme', theme);

    if (persist) setPref('theme', theme);
    if (syncDoc && getDoc()?.settings?.theme !== theme) setSetting('theme', theme, 'Change theme');

    // Give the browser a frame to recompute custom properties before we read
    // them back for contrast decisions.
    requestAnimationFrame(() => invalidateAll());
    emit(EV.THEME_CHANGED, { theme });
  }

  /** Step to the next theme in the list — bound to a toolbar button. */
  function cycleTheme() {
    const i = THEMES.findIndex((t) => t.id === current);
    applyTheme(THEMES[(i + 1) % THEMES.length].id);
  }

  /** True for themes whose surfaces are light — used by exporters. */
  function isLightTheme(id = current) {
    return id === 'light' || id === 'presentation';
  }

  Object.defineProperty(__x, "THEMES", { get: () => THEMES, enumerable: true });
  Object.defineProperty(__x, "initTheme", { get: () => initTheme, enumerable: true });
  Object.defineProperty(__x, "getTheme", { get: () => getTheme, enumerable: true });
  Object.defineProperty(__x, "applyTheme", { get: () => applyTheme, enumerable: true });
  Object.defineProperty(__x, "cycleTheme", { get: () => cycleTheme, enumerable: true });
  Object.defineProperty(__x, "isLightTheme", { get: () => isLightTheme, enumerable: true });
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

  const { el, clear, escapeHtml, uid, IS_MAC, clamp } = __req("core/util.js");
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
      toastHost = el('div', { id: 'cx-toasts' });
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
    const node = el('div', { class: `cx-toast ${tone}`, role: 'status' }, [
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

  function selectInput({ value, options, onChange, mini = false, placeholder }) {
    const select = el('select', { class: 'cx-select' + (mini ? ' mini' : '') });
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
// ui/commands.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/commands.js"] = function (__x, __req) {
  /**
   * Commands — the single implementation of every user-invokable action.
   *
   * The context menu, the keyboard shortcuts, the toolbar and the inspector all
   * call the same functions here, so a behaviour never drifts between the three
   * ways of reaching it and there is exactly one place to fix a bug.
   *
   * Imports: util, events, dates, model, store, storage, viewport, renderer,
   *          interactions, icons, components.
   */

  const { el, download, clamp } = __req("core/util.js");
  const { emit, EV } = __req("core/events.js");
  const { MS_DAY, toISO, fmtDate, addDays } = __req("core/dates.js");
  const { TYPES, makeBaseline, makeObject, projectExtent, effectiveToday, makeProject } = __req("core/model.js");
  const store = __req("core/store.js");
  const { saveNow, makeBackup } = __req("core/storage.js");
  const { linkViolations, resolutionFor } = __req("core/analysis.js");
  const viewport = __req("timeline/viewport.js");
  const renderer = __req("timeline/renderer.js");
  const { icon } = __req("ui/icons.js");
  const { toast, confirmDialog, promptDialog, openModal } = __req("ui/components.js");

  /* ── Clipboard ─────────────────────────────────────────────────────────── */

  /**
   * Copy the selection to the in-app clipboard.
   * Dependencies wholly inside the selection travel with it; dangling ones do
   * not, because pasting half a relationship is never what anyone wants.
   */
  function copySelection() {
    const objects = store.selectedObjects();
    if (!objects.length) return false;

    const ids = new Set(objects.map((o) => o.id));
    const links = store.getDoc().links.filter((l) => ids.has(l.from) && ids.has(l.to));
    const anchor = Math.min(...objects.map((o) => o.start));

    store.setClipboard({
      anchor,
      objects: objects.map((o) => JSON.parse(JSON.stringify(o))),
      links: links.map((l) => JSON.parse(JSON.stringify(l))),
    });

    // Mirror to the system clipboard so a selection can be pasted into another
    // window of the app, or into an email as readable text.
    writeSystemClipboard(objects);
    toast({ tone: 'info', title: `${objects.length} object${objects.length === 1 ? '' : 's'} copied`, timeout: 1800 });
    return true;
  }

  function cutSelection() {
    if (!copySelection()) return false;
    const ids = store.getSelection();
    store.removeObjects(ids, 'Cut');
    renderer.requestRender();
    return true;
  }

  /**
   * Paste the clipboard. Without an explicit target the paste lands at the
   * viewport centre, which is where the user is looking.
   */
  function paste({ atMs = null, laneId = null } = {}) {
    const clip = store.getClipboard();
    if (!clip || !clip.objects.length) {
      toast({ tone: 'warn', title: 'Nothing to paste' });
      return false;
    }

    const target = atMs != null ? atMs : viewport.pxToMs(viewport.getWidth() / 2);
    const shift = target - clip.anchor;
    const idMap = new Map();

    const objects = clip.objects.map((source) => {
      const copy = makeObject({
        ...source,
        id: undefined,
        start: source.start + shift,
        end: source.end + shift,
        lane: laneId || source.lane,
      });
      idMap.set(source.id, copy.id);
      return copy;
    });

    const newIds = store.addObjects(objects, `Paste ${objects.length} object${objects.length === 1 ? '' : 's'}`);

    for (const link of clip.links) {
      const from = idMap.get(link.from);
      const to = idMap.get(link.to);
      if (from && to) store.addLink({ from, to, type: link.type, lag: link.lag, style: link.style, label: link.label });
    }

    store.setSelection(newIds);
    renderer.requestRender();
    return true;
  }

  /** Duplicate in place, offset by the object's own duration so it stays clear. */
  function duplicateSelection() {
    const objects = store.selectedObjects();
    if (!objects.length) return false;

    const ids = new Set(objects.map((o) => o.id));
    const idMap = new Map();
    const copies = objects.map((source) => {
      const duration = TYPES[source.type]?.duration ? source.end - source.start : MS_DAY * 3;
      const copy = makeObject({
        ...source,
        id: undefined,
        title: source.title,
        start: source.start + duration,
        end: source.end + duration,
      });
      idMap.set(source.id, copy.id);
      return copy;
    });

    const newIds = store.addObjects(copies, `Duplicate ${copies.length} object${copies.length === 1 ? '' : 's'}`);
    for (const link of store.getDoc().links) {
      if (ids.has(link.from) && ids.has(link.to)) {
        store.addLink({ from: idMap.get(link.from), to: idMap.get(link.to), type: link.type, lag: link.lag });
      }
    }

    store.setSelection(newIds);
    renderer.requestRender();
    return true;
  }

  async function deleteSelection({ confirm = true } = {}) {
    const ids = store.getSelection();
    if (!ids.length) return false;

    const locked = ids.filter((id) => store.getObject(id)?.locked);
    if (locked.length === ids.length) {
      toast({ tone: 'warn', title: 'Locked', message: 'Unlock these objects before deleting them.' });
      return false;
    }

    const deletable = ids.filter((id) => !store.getObject(id)?.locked);
    if (confirm && deletable.length > 4) {
      const ok = await confirmDialog({
        title: `Delete ${deletable.length} objects`,
        message: 'Their dependencies are removed too. This can be undone.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return false;
    }

    store.removeObjects(deletable, deletable.length > 1 ? `Delete ${deletable.length} objects` : 'Delete object');
    renderer.requestRender();
    return true;
  }

  /** Best-effort mirror of a copy into the OS clipboard, as readable text. */
  function writeSystemClipboard(objects) {
    if (!navigator.clipboard?.writeText) return;
    const lines = objects.map((o) => {
      const range = TYPES[o.type]?.duration ? `${toISO(o.start)} → ${toISO(o.end)}` : toISO(o.start);
      return [o.title, TYPES[o.type]?.label || o.type, range, o.owner, o.status].filter(Boolean).join('\t');
    });
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {
      /* clipboard permission denied — the in-app clipboard still works */
    });
  }

  /* ── Selection ─────────────────────────────────────────────────────────── */

  function selectAll() {
    store.selectAll();
    renderer.requestRender();
  }

  function selectNone() {
    store.clearSelection();
    renderer.setSelectedLinks([]);
    renderer.requestRender();
  }

  /** Extend the selection to everything in the same lane. */
  function selectLane() {
    const objects = store.selectedObjects();
    if (!objects.length) return;
    const lanes = new Set(objects.map((o) => o.lane));
    store.setSelection(store.getDoc().objects.filter((o) => lanes.has(o.lane)).map((o) => o.id));
    renderer.requestRender();
  }

  /** Select everything the current selection depends on, transitively. */
  function selectDependencyChain() {
    const seeds = store.getSelection();
    if (!seeds.length) return;
    const doc = store.getDoc();
    const out = new Set(seeds);
    const stack = [...seeds];
    while (stack.length) {
      const id = stack.pop();
      for (const link of doc.links) {
        if (link.from === id && !out.has(link.to)) {
          out.add(link.to);
          stack.push(link.to);
        }
        if (link.to === id && !out.has(link.from)) {
          out.add(link.from);
          stack.push(link.from);
        }
      }
    }
    store.setSelection(Array.from(out));
    renderer.requestRender();
  }

  /* ── Object state ──────────────────────────────────────────────────────── */

  function toggleLock() {
    const objects = store.selectedObjects();
    if (!objects.length) return;
    const lock = !objects.every((o) => o.locked);
    store.updateObjects(objects.map((o) => o.id), { locked: lock }, lock ? 'Lock' : 'Unlock');
    renderer.requestRender();
  }

  function toggleHidden() {
    const objects = store.selectedObjects();
    if (!objects.length) return;
    const hide = !objects.every((o) => o.hidden);
    store.updateObjects(objects.map((o) => o.id), { hidden: hide }, hide ? 'Hide' : 'Show');
    renderer.requestRender();
  }

  function groupSelection() {
    const ids = store.getSelection();
    if (ids.length < 2) {
      toast({ tone: 'warn', title: 'Select two or more objects to group' });
      return;
    }
    store.groupObjects(ids);
    renderer.requestRender();
  }

  function ungroupSelection() {
    store.ungroupObjects(store.getSelection());
    renderer.requestRender();
  }

  function setStatus(status) {
    const ids = store.getSelection();
    if (!ids.length) return;
    store.updateObjects(ids, { status }, 'Change status');
    renderer.requestRender();
  }

  function setProgress(percent) {
    const ids = store.getSelection();
    if (!ids.length) return;
    store.updateObjects(ids, { progress: clamp(percent, 0, 100) }, 'Change progress');
    renderer.requestRender();
  }

  /* ── Creation ──────────────────────────────────────────────────────────── */

  /** Create an object of `type` at a date and lane, then select it. */
  function createObject(type, { ms = null, laneId = null, select = true } = {}) {
    const def = TYPES[type];
    if (!def) return null;
    const start = ms != null ? ms : viewport.pxToMs(viewport.getWidth() / 2);
    const id = store.addObject(
      {
        type,
        lane: laneId || store.getDoc().laneOrder[0] || null,
        start,
        end: def.duration ? start + (def.defaultDays || 1) * MS_DAY : start,
      },
      `Add ${def.label.toLowerCase()}`
    );
    if (select) store.setSelection([id]);
    renderer.requestRender();
    emit('object:created', { id, type });
    return id;
  }

  async function addLane(afterIndex = -1) {
    const name = await promptDialog({ title: 'New lane', label: 'Lane name', value: '', placeholder: 'e.g. Wayside' });
    if (!name) return null;
    const id = store.addLane({ name: name.trim() }, afterIndex);
    renderer.requestRender();
    return id;
  }

  /* ── Dependency violations ─────────────────────────────────────────────── */

  /**
   * Move a link's successor to the earliest date the dependency allows,
   * preserving its duration. The link's own red state clears by itself once the
   * dates satisfy it — nothing stores a "violated" flag.
   */
  function resolveViolation(linkId) {
    const doc = store.getDoc();
    const link = doc.links.find((l) => l.id === linkId);
    if (!link) return false;

    const fix = resolutionFor(link, store.getObject(link.from), store.getObject(link.to));
    if (!fix) return false;

    const successor = store.getObject(fix.id);
    if (successor?.locked) {
      toast({ tone: 'warn', title: 'Locked', message: 'Unlock the successor before rescheduling it.' });
      return false;
    }

    store.updateObject(fix.id, { start: fix.start, end: fix.end }, 'Resolve dependency');
    store.setSelection([fix.id]);
    renderer.revealObject(fix.id);
    toast({
      tone: 'good',
      title: 'Dependency resolved',
      message: `"${successor?.title}" moved ${fix.shiftDays} day${Math.abs(fix.shiftDays) === 1 ? '' : 's'} later.`,
    });
    return true;
  }

  /**
   * Resolve every broken dependency, repeatedly, so fixing one that cascades
   * into another settles the whole chain rather than leaving the next one red.
   */
  function resolveAllViolations() {
    const before = linkViolations(store.getDoc()).count;
    if (!before) {
      toast({ tone: 'info', title: 'No broken dependencies' });
      return 0;
    }

    // Each pass can expose newly broken downstream links; the graph is acyclic,
    // so a bounded sweep always terminates.
    let fixed = 0;
    for (let pass = 0; pass < 24; pass++) {
      const violations = linkViolations(store.getDoc());
      if (!violations.count) break;

      let movedThisPass = 0;
      for (const linkId of violations.links) {
        const doc = store.getDoc();
        const link = doc.links.find((l) => l.id === linkId);
        if (!link) continue;
        const fix = resolutionFor(link, store.getObject(link.from), store.getObject(link.to));
        if (!fix || store.getObject(fix.id)?.locked) continue;
        store.updateObject(fix.id, { start: fix.start, end: fix.end }, 'Resolve dependencies');
        movedThisPass++;
        fixed++;
      }
      if (!movedThisPass) break;
    }

    renderer.requestRender();
    const remaining = linkViolations(store.getDoc()).count;
    toast({
      tone: remaining ? 'warn' : 'good',
      title: `${fixed} reschedule${fixed === 1 ? '' : 's'} applied`,
      message: remaining
        ? `${remaining} still broken — their successors are locked.`
        : 'All dependencies satisfied.',
    });
    return fixed;
  }

  /** Select and frame every object involved in a broken dependency. */
  function selectViolations() {
    const violations = linkViolations(store.getDoc());
    if (!violations.count) {
      toast({ tone: 'info', title: 'No broken dependencies' });
      return;
    }
    store.setSelection(Array.from(violations.objects.keys()));
    zoomToSelection();
  }

  /* ── Baselines ─────────────────────────────────────────────────────────── */

  async function takeBaseline() {
    const doc = store.getDoc();
    const name = await promptDialog({
      title: 'Take baseline',
      label: 'Baseline name',
      value: `Baseline ${fmtDate(effectiveToday(doc), 'medium')}`,
    });
    if (!name) return null;
    const baseline = makeBaseline(doc, name.trim());
    store.addBaseline(baseline);
    renderer.requestRender();
    toast({ tone: 'good', title: 'Baseline captured', message: `${baseline.snapshot.length} objects recorded.` });
    return baseline.id;
  }

  /* ── View ──────────────────────────────────────────────────────────────── */

  function zoomIn() {
    viewport.zoomBy(1.42);
    renderer.requestRender();
  }

  function zoomOut() {
    viewport.zoomBy(0.7);
    renderer.requestRender();
  }

  function fitAll() {
    const extent = projectExtent(store.getDoc());
    viewport.fitRange(extent.start, extent.end, 30);
    renderer.requestRender();
  }

  /** Frame the current selection. */
  function zoomToSelection() {
    const objects = store.selectedObjects();
    if (!objects.length) return fitAll();
    const start = Math.min(...objects.map((o) => o.start));
    const end = Math.max(...objects.map((o) => (TYPES[o.type]?.duration ? o.end : o.start + MS_DAY)));
    viewport.fitRange(start, end, 80);
    renderer.requestRender();
    return true;
  }

  function goToToday() {
    viewport.centerOn(effectiveToday(store.getDoc()), 0.42);
    renderer.requestRender();
  }

  function togglePresentation() {
    emit(EV.PRESENT_MODE, { on: !document.body.classList.contains('presenting') });
  }

  /* ── Project lifecycle ─────────────────────────────────────────────────── */

  async function newProject() {
    const ok = await confirmDialog({
      title: 'Start a new project',
      message: 'The current project stays saved and can be reopened from Backups. Continue?',
      confirmLabel: 'New project',
    });
    if (!ok) return;
    await makeBackup('before-new');
    store.replaceDoc(makeProject('Untitled Programme'), 'new');
    fitAll();
    toast({ tone: 'good', title: 'New project created' });
  }

  async function saveSnapshot() {
    await saveNow();
    await makeBackup('manual');
    toast({ tone: 'good', title: 'Snapshot saved', message: 'A restore point was added to Backups.' });
  }

  /* ── Navigation ────────────────────────────────────────────────────────── */

  /** Jump to and flash an object — used by search results and outline rows. */
  function revealObject(id) {
    store.setSelection([id]);
    renderer.revealObject(id);
  }

  /* ── Keyboard help ─────────────────────────────────────────────────────── */

  const SHORTCUTS = [
    { group: 'Editing', items: [
      ['mod+z', 'Undo'],
      ['mod+y  /  mod+shift+z', 'Redo'],
      ['mod+c', 'Copy selection'],
      ['mod+x', 'Cut selection'],
      ['mod+v', 'Paste'],
      ['mod+d', 'Duplicate'],
      ['Delete  /  Backspace', 'Delete selection'],
      ['mod+g', 'Group'],
      ['mod+shift+g', 'Ungroup'],
      ['mod+l', 'Lock / unlock'],
    ]},
    { group: 'Selection', items: [
      ['mod+a', 'Select all'],
      ['Esc', 'Clear selection'],
      ['Shift+click', 'Add to selection'],
      ['Drag on canvas', 'Marquee select'],
      ['mod+shift+a', 'Select whole lane'],
      ['mod+shift+d', 'Select dependency chain'],
    ]},
    { group: 'Moving', items: [
      ['← / →', 'Nudge one day'],
      ['Shift + ← / →', 'Nudge one week'],
      ['mod + ← / →', 'Change duration by a day'],
      ['Alt while dragging', 'Keep in the same lane'],
    ]},
    { group: 'View', items: [
      ['Mouse wheel', 'Zoom in / out'],
      ['mod + wheel', 'Zoom (always)'],
      ['Shift + wheel', 'Pan horizontally'],
      ['Space + drag', 'Pan'],
      ['mod+0', 'Fit whole plan'],
      ['mod+shift+0', 'Zoom to selection'],
      ['T', 'Go to today'],
      ['V / H', 'Select tool / Pan tool'],
      ['F11  /  P', 'Presentation mode'],
    ]},
    { group: 'Application', items: [
      ['mod+f', 'Global search'],
      ['mod+s', 'Save a restore point'],
      ['mod+p', 'Print / export to PDF'],
      ['?', 'This help'],
    ]},
  ];

  function showShortcuts() {
    const body = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(248px, 1fr))', gap: '18px' } });

    for (const group of SHORTCUTS) {
      body.appendChild(
        el('div', {}, [
          el('div', { class: 'eyebrow', style: { marginBottom: '7px' }, text: group.group }),
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            group.items.map(([keys, label]) =>
              el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: 'var(--fs-tiny)' } }, [
                el('span', { style: { color: 'var(--text-muted)' }, text: label }),
                el('span', { class: 'mono', style: { color: 'var(--text-subtle)', whiteSpace: 'nowrap' }, text: keys.replace(/mod/g, navigator.platform.includes('Mac') ? '⌘' : 'Ctrl') }),
              ])
            )
          ),
        ])
      );
    }

    openModal({
      title: 'Keyboard shortcuts',
      subtitle: 'Everything the timeline responds to.',
      size: 'wide',
      body,
      actions: [{ label: 'Close', kind: 'primary' }],
    });
  }

  Object.defineProperty(__x, "copySelection", { get: () => copySelection, enumerable: true });
  Object.defineProperty(__x, "cutSelection", { get: () => cutSelection, enumerable: true });
  Object.defineProperty(__x, "paste", { get: () => paste, enumerable: true });
  Object.defineProperty(__x, "duplicateSelection", { get: () => duplicateSelection, enumerable: true });
  Object.defineProperty(__x, "deleteSelection", { get: () => deleteSelection, enumerable: true });
  Object.defineProperty(__x, "selectAll", { get: () => selectAll, enumerable: true });
  Object.defineProperty(__x, "selectNone", { get: () => selectNone, enumerable: true });
  Object.defineProperty(__x, "selectLane", { get: () => selectLane, enumerable: true });
  Object.defineProperty(__x, "selectDependencyChain", { get: () => selectDependencyChain, enumerable: true });
  Object.defineProperty(__x, "toggleLock", { get: () => toggleLock, enumerable: true });
  Object.defineProperty(__x, "toggleHidden", { get: () => toggleHidden, enumerable: true });
  Object.defineProperty(__x, "groupSelection", { get: () => groupSelection, enumerable: true });
  Object.defineProperty(__x, "ungroupSelection", { get: () => ungroupSelection, enumerable: true });
  Object.defineProperty(__x, "setStatus", { get: () => setStatus, enumerable: true });
  Object.defineProperty(__x, "setProgress", { get: () => setProgress, enumerable: true });
  Object.defineProperty(__x, "createObject", { get: () => createObject, enumerable: true });
  Object.defineProperty(__x, "addLane", { get: () => addLane, enumerable: true });
  Object.defineProperty(__x, "resolveViolation", { get: () => resolveViolation, enumerable: true });
  Object.defineProperty(__x, "resolveAllViolations", { get: () => resolveAllViolations, enumerable: true });
  Object.defineProperty(__x, "selectViolations", { get: () => selectViolations, enumerable: true });
  Object.defineProperty(__x, "takeBaseline", { get: () => takeBaseline, enumerable: true });
  Object.defineProperty(__x, "zoomIn", { get: () => zoomIn, enumerable: true });
  Object.defineProperty(__x, "zoomOut", { get: () => zoomOut, enumerable: true });
  Object.defineProperty(__x, "fitAll", { get: () => fitAll, enumerable: true });
  Object.defineProperty(__x, "zoomToSelection", { get: () => zoomToSelection, enumerable: true });
  Object.defineProperty(__x, "goToToday", { get: () => goToToday, enumerable: true });
  Object.defineProperty(__x, "togglePresentation", { get: () => togglePresentation, enumerable: true });
  Object.defineProperty(__x, "newProject", { get: () => newProject, enumerable: true });
  Object.defineProperty(__x, "saveSnapshot", { get: () => saveSnapshot, enumerable: true });
  Object.defineProperty(__x, "revealObject", { get: () => revealObject, enumerable: true });
  Object.defineProperty(__x, "SHORTCUTS", { get: () => SHORTCUTS, enumerable: true });
  Object.defineProperty(__x, "showShortcuts", { get: () => showShortcuts, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/lists.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/lists.js"] = function (__x, __req) {
  /**
   * Editable dropdown vocabularies.
   *
   * Two things live here: `managedSelect()`, a dropdown that can edit its own
   * options, and the manager dialog behind it. Every list the user can change —
   * status, subsystem, test type, severity, approval, fonts, and the owner and
   * area suggestion lists — is reached through these, so adding a status from
   * the inspector and adding one from the Lists pane run the same code.
   *
   * Imports: util, events, model, query, store, renderer, icons, components.
   */

  const { el, clear } = __req("core/util.js");
  const { emit, EV } = __req("core/events.js");
  const { LIST_DEFS, LIST_IDS, TONES, listOptions, listOption } = __req("core/model.js");
  const store = __req("core/store.js");
  const renderer = __req("timeline/renderer.js");
  const { icon } = __req("ui/icons.js");
  const { facet } = __req("core/query.js");
  const { openModal, domId, field, textInput, selectInput, colorControl, confirmDialog, toast, emptyState } = __req("ui/components.js");











  /**
   * Sentinel values for the two action rows at the foot of every managed
   * dropdown. A leading NUL cannot occur in a real option id, so a
   * user-defined option can never collide with them.
   */
  const ADD = '\u0000add';
  const MANAGE = '\u0000manage';

  /* ══════════════════════════════════════════════════════════════════════════
     The dropdown
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * A `<select>` bound to an editable list, with "Add option…" and "Manage
   * list…" at the bottom.
   *
   * A value that is not in the list (imported data, or an option someone else
   * deleted) is still shown and still selected, marked so it is obvious why it
   * looks different — silently dropping it would silently change the object.
   *
   * @param {object}   opts
   * @param {string}   opts.listId
   * @param {string}   opts.value
   * @param {Function} opts.onChange
   * @param {string}   [opts.placeholder]  Shown as the empty choice.
   * @param {boolean}  [opts.mini]
   * @param {boolean}  [opts.allowEmpty]   Offer a blank choice (default: true
   *                                       unless the list def says required).
   */
  function managedSelect({ listId, value, onChange, placeholder, mini = false, allowEmpty = null }) {
    const def = LIST_DEFS[listId] || { label: listId };
    const select = el('select', { class: 'cx-select' + (mini ? ' mini' : ''), dataset: { list: listId } });

    const rebuild = (current) => {
      clear(select);
      const empty = allowEmpty == null ? !def.required : allowEmpty;
      if (empty) select.appendChild(el('option', { value: '', text: placeholder || '—' }));

      const options = listOptions(listId);
      for (const option of options) {
        if (option.id === '' && empty) continue; // already covered by the blank row
        select.appendChild(el('option', { value: option.id, text: option.label }));
      }

      // Keep an unknown value visible rather than snapping the field to blank.
      if (current && !options.some((o) => o.id === current)) {
        select.appendChild(el('option', { value: current, text: `${current} — not in list` }));
      }

      select.appendChild(el('option', { value: '\u0000sep', text: '──────────', disabled: true }));
      select.appendChild(el('option', { value: ADD, text: `＋  Add ${def.label.toLowerCase()}…` }));
      select.appendChild(el('option', { value: MANAGE, text: `⚙  Manage ${def.label.toLowerCase()}…` }));

      select.value = current ?? '';
    };

    let last = value ?? '';
    rebuild(last);

    select.addEventListener('change', () => {
      const picked = select.value;

      if (picked === ADD || picked === MANAGE) {
        // Never let a command leak out as a value.
        select.value = last;
        const done = (chosenId) => {
          rebuild(chosenId ?? last);
          if (chosenId != null && chosenId !== last) {
            last = chosenId;
            select.value = chosenId;
            onChange(chosenId);
          }
        };
        if (picked === ADD) promptNewOption(listId, done);
        else openListManager(listId, () => done(null));
        return;
      }

      if (picked === '\u0000sep') {
        select.value = last;
        return;
      }

      last = picked;
      onChange(picked);
    });

    return select;
  }

  /**
   * A text input backed by a suggestion list (owner, area).
   *
   * These stay free text — a plan should never block you from typing a name
   * that is not yet on a list — but the list is offered through a `datalist`,
   * and the manager is one click away.
   */
  function suggestInput({ listId, value, onInput, onChange, placeholder, mini = false }) {
    // The inspector and the object dialog can both be showing an Owner field at
    // once, so the datalist needs an id of its own — a duplicate would silently
    // hand one of them the wrong suggestions.
    const listElementId = domId(`sg-${listId}`);
    const input = textInput({ value, placeholder, mini, onInput, onChange });
    input.setAttribute('list', listElementId);

    const datalist = el('datalist', { id: listElementId });
    for (const suggestion of suggestions(listId)) {
      datalist.appendChild(el('option', { value: suggestion }));
    }

    const manage = el('button', {
      class: 'cx-btn icon mini ghost',
      title: `Manage ${LIST_DEFS[listId]?.label.toLowerCase() || listId} suggestions`,
      'aria-label': `Manage ${LIST_DEFS[listId]?.label || listId} suggestions`,
      html: icon('list', { size: 12 }),
      onClick: () => openListManager(listId),
    });

    return el('div', { class: 'cx-inline' }, [
      el('div', { style: { flex: '1', minWidth: '0' } }, [input, datalist]),
      manage,
    ]);
  }

  /**
   * Suggestions for a free-text field: the curated list plus whatever the plan
   * already uses. Typing a new owner should make that owner offerable on the
   * next object without anyone having to curate a list first.
   */
  function suggestions(listId) {
    const out = [];
    const seen = new Set();
    for (const option of listOptions(listId)) {
      if (option.id && !seen.has(option.id)) { seen.add(option.id); out.push(option.id); }
    }
    const def = LIST_DEFS[listId];
    if (def?.field) {
      for (const entry of facet(store.getDoc(), def.field)) {
        if (entry.value && !seen.has(entry.value)) { seen.add(entry.value); out.push(entry.value); }
      }
    }
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Add an option
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Ask for a new option and add it.
   * `onDone(id|null)` reports the id that was created, so the dropdown that
   * launched this can select it straight away.
   */
  function promptNewOption(listId, onDone = () => {}) {
    const def = LIST_DEFS[listId] || { label: listId };
    const labelInput = textInput({ value: '', placeholder: `New ${def.label.toLowerCase()}` });

    let color = '#5b93f5';
    let tone = 'neutral';

    const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } }, [
      field('Name', labelInput),
      def.color ? field('Colour', colorControl({ value: color, onChange: (v) => { color = v; } })) : null,
      def.tone
        ? field('Tone', selectInput({
            value: tone,
            options: TONES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })),
            onChange: (v) => { tone = v; },
          }), 'Controls the badge colour where this value is shown as a chip.')
        : null,
      el('div', { class: 'cx-hint', text: def.hint || '' }),
    ].filter(Boolean));

    let settled = false;
    const modal = openModal({
      title: `Add ${def.label.toLowerCase()}`,
      body,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Add',
          kind: 'primary',
          onClick: () => {
            settled = true;
            onDone(commit());
          },
        },
      ],
      onClose: () => {
        if (!settled) onDone(null);
      },
    });

    function commit() {
      const label = labelInput.value.trim();
      if (!label) return null;
      // The id is what every object stores, so derive a stable one from the
      // name rather than letting it drift with later renames.
      const id = listId === 'font' ? label : slugify(label, listId);
      const created = store.addListOption(listId, {
        id,
        label,
        color: def.color ? color : undefined,
        tone: def.tone ? tone : undefined,
      });
      if (!created) {
        toast({ tone: 'warn', title: 'Already on the list', message: `"${label}" is already a ${def.label.toLowerCase()} option.` });
        return null;
      }
      renderer.requestRender();
      return created;
    }

    labelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        settled = true;
        const id = commit();
        modal.close();
        onDone(id);
      }
    });

    setTimeout(() => labelInput.focus(), 40);
  }

  /** A url-safe id, unique within the list. */
  function slugify(label, listId) {
    const base =
      String(label)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'option';

    const taken = new Set(listOptions(listId).map((o) => o.id));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The editor
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Which list the editor last showed.
   *
   * Every mutation writes to the store, and the dock rebuilds its pane on
   * `doc:changed` — so without this, deleting an option would drop the reader
   * back on the first tab mid-task.
   */
  let lastList = LIST_IDS[0];

  /**
   * The list editor, as a detached node.
   *
   * The modal and the Lists dock pane are the same widget — building it once
   * means "add a status" behaves identically wherever it is reached, and there
   * is only one place to change when a list grows a new property.
   *
   * @param {object}   [opts]
   * @param {string}   [opts.listId]  Start on this list (default: the first).
   * @param {boolean}  [opts.tabs]    Offer the list picker (default: true).
   * @returns {{node: HTMLElement, refresh: Function, active: Function}}
   */
  function listEditor({ listId = null, tabs: showTabs = true } = {}) {
    let active = listId && LIST_DEFS[listId] ? listId : lastList;

    const tabs = el('div', { class: 'cx-seg', style: { flexWrap: 'wrap', marginBottom: '13px' } });
    const body = el('div');
    const node = el('div', {}, showTabs ? [tabs, body] : [body]);

    if (showTabs) {
      for (const id of LIST_IDS) {
        tabs.appendChild(
          el('button', { dataset: { list: id }, text: LIST_DEFS[id].label, onClick: () => selectTab(id) })
        );
      }
    }

    function selectTab(id) {
      active = id;
      lastList = id;
      for (const button of tabs.children) button.classList.toggle('active', button.dataset.list === id);
      renderList();
    }

    function renderList() {
      clear(body);
      const def = LIST_DEFS[active];
      const options = listOptions(active);

      body.appendChild(el('div', { class: 'cx-hint', style: { marginBottom: '10px' }, text: def.hint || '' }));

      if (!options.length) {
        body.appendChild(
          emptyState({
            iconName: 'list',
            title: 'No options yet',
            message: `Add the ${def.label.toLowerCase()} values this programme uses.`,
          })
        );
      } else {
        const rows = el('div', { class: 'cx-list' });
        options.forEach((option, index) => rows.appendChild(optionRow(active, def, option, index, options.length)));
        body.appendChild(rows);
      }

      body.appendChild(
        el('div', { style: { display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' } }, [
          el('button', {
            class: 'cx-btn mini primary',
            html: icon('plus', { size: 12 }) + '<span>Add option</span>',
            onClick: () => promptNewOption(active, () => renderList()),
          }),
          el('button', {
            class: 'cx-btn mini',
            html: icon('refresh', { size: 12 }) + '<span>Restore defaults</span>',
            title: 'Re-add the shipped options, keeping any custom one still in use',
            onClick: async () => {
              const ok = await confirmDialog({
                title: `Restore ${def.label.toLowerCase()} defaults`,
                message: 'The shipped options come back. Custom options still used by an object are kept; unused ones are removed.',
                confirmLabel: 'Restore',
              });
              if (ok) {
                store.resetList(active);
                changed();
                renderList();
              }
            },
          }),
        ])
      );
    }

    function optionRow(listId_, def, option, index, total) {
      const usage = store.listOptionUsage(listId_, option.id);

      const label = textInput({
        value: option.label,
        mini: true,
        onChange: (v) => {
          store.updateListOption(listId_, option.id, { label: v.trim() || option.id });
          changed();
        },
      });
      label.setAttribute('aria-label', `Name for ${option.label}`);

      return el('div', { class: 'list-opt', dataset: { option: option.id } }, [
        def.color
          ? el('input', {
              class: 'cx-color lo-swatch',
              type: 'color',
              value: toHex(option.color),
              title: 'Option colour',
              'aria-label': `Colour for ${option.label}`,
              // `change`, not `input`: the dock pane rebuilds on doc:changed and
              // a colour input is not covered by the typing guard, so a live
              // stream of edits would pull the picker out from under the drag.
              onChange: (e) => {
                store.updateListOption(listId_, option.id, { color: e.target.value });
                changed();
              },
            })
          : el('span', { class: 'cx-dot lo-swatch', style: { background: 'var(--text-subtle)' } }),

        el('div', { class: 'lo-name' }, [label]),

        el('div', { class: 'lo-actions' }, [
          iconButton('chevron-up', 'Move up', index === 0, () => {
            store.moveListOption(listId_, option.id, -1);
            changed();
            renderList();
          }),
          iconButton('chevron-down', 'Move down', index === total - 1, () => {
            store.moveListOption(listId_, option.id, 1);
            changed();
            renderList();
          }),
          iconButton('trash', 'Remove option', false, () => confirmRemoval(listId_, def, option, usage)),
        ]),

        el('div', { class: 'lo-foot' }, [
          el('div', { class: 'lo-meta', text: `${option.id || '(blank)'} · ${usage ? `used by ${usage}` : 'unused'}` }),
          def.tone
            ? el('div', { class: 'lo-tone' }, [
                selectInput({
                  value: option.tone || 'neutral',
                  mini: true,
                  options: TONES.map((t) => ({ value: t, label: t })),
                  onChange: (v) => {
                    store.updateListOption(listId_, option.id, { tone: v });
                    changed();
                  },
                }),
              ])
            : null,
        ].filter(Boolean)),
      ].filter(Boolean));
    }

    function confirmRemoval(listId_, def, option, usage) {
      if (!usage) {
        store.removeListOption(listId_, option.id);
        changed();
        renderList();
        return;
      }

      // Something still points at it, so ask what those objects should become
      // rather than leaving them referencing an option that no longer exists.
      const replacements = listOptions(listId_).filter((o) => o.id !== option.id);
      let reassignTo = '';

      let settled = false;
      openModal({
        title: `Remove "${option.label}"`,
        body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } }, [
          el('div', { style: { fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }, text: `${usage} object${usage === 1 ? '' : 's'} currently use this ${def.label.toLowerCase()}.` }),
          field('Move them to', selectInput({
            value: '',
            placeholder: '— leave blank —',
            options: replacements.map((o) => ({ value: o.id, label: o.label })),
            onChange: (v) => { reassignTo = v; },
          }), 'Leaving it blank clears the field on those objects.'),
        ]),
        actions: [
          { label: 'Cancel' },
          {
            label: 'Remove',
            kind: 'danger',
            onClick: () => {
              settled = true;
              const target = reassignTo ? listOption(listId_, reassignTo)?.label : '';
              store.removeListOption(listId_, option.id, { reassignTo });
              changed();
              renderList();
              toast({
                tone: 'good',
                title: `"${option.label}" removed`,
                message: target
                  ? `${usage} object${usage === 1 ? '' : 's'} moved to "${target}".`
                  : `${usage} object${usage === 1 ? '' : 's'} had the field cleared.`,
              });
            },
          },
        ],
        onClose: () => {
          if (!settled) renderList();
        },
      });
    }

    /** One announcement for every mutation: repaint, then tell the UI. */
    function changed() {
      renderer.requestRender();
      emit(EV.LISTS_CHANGED, { listId: active });
    }

    selectTab(active);
    return { node, refresh: renderList, active: () => active };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The manager dialog
     ═══════════════════════════════════════════════════════════════════════ */

  /** Open the manager for one list, or the whole set when `listId` is omitted. */
  function openListManager(listId = null, onClose = () => {}) {
    const editor = listEditor({ listId });

    return openModal({
      title: 'Manage lists',
      subtitle: 'Options are saved with the project, and every change is undoable.',
      size: 'wide',
      body: editor.node,
      actions: [{ label: 'Done', kind: 'primary' }],
      onClose: () => {
        emit(EV.LISTS_CHANGED, { listId: editor.active() });
        onClose();
      },
    });
  }

  function iconButton(name, title, disabled, onClick) {
    return el('button', {
      class: 'cx-btn icon mini ghost',
      title,
      'aria-label': title,
      disabled,
      html: icon(name, { size: 11 }),
      onClick,
    });
  }

  /** Colour inputs need a concrete hex; theme tokens resolve to one. */
  function toHex(color) {
    if (!color) return '#5b93f5';
    const value = String(color).trim();
    if (value.startsWith('#')) return value.length === 4
      ? '#' + value.slice(1).split('').map((c) => c + c).join('')
      : value.slice(0, 7);

    if (value.startsWith('var(')) {
      try {
        const resolved = getComputedStyle(document.documentElement).getPropertyValue(value.slice(4, -1).trim()).trim();
        if (resolved.startsWith('#')) return resolved.length === 4
          ? '#' + resolved.slice(1).split('').map((c) => c + c).join('')
          : resolved.slice(0, 7);
      } catch {
        /* fall through to the default */
      }
    }
    return '#5b93f5';
  }

  Object.defineProperty(__x, "managedSelect", { get: () => managedSelect, enumerable: true });
  Object.defineProperty(__x, "suggestInput", { get: () => suggestInput, enumerable: true });
  Object.defineProperty(__x, "promptNewOption", { get: () => promptNewOption, enumerable: true });
  Object.defineProperty(__x, "listEditor", { get: () => listEditor, enumerable: true });
  Object.defineProperty(__x, "openListManager", { get: () => openListManager, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/auth.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/auth.js"] = function (__x, __req) {
  /**
   * Sign-in, the account menu, and sharing.
   *
   * Only reachable on a hosted deployment — with `config.js` blank none of this
   * is ever shown and the application boots straight into the canvas, exactly as
   * it does today.
   *
   * The gate is a full-screen overlay rather than a separate page, so a single
   * static file still serves the whole application and there is no route to get
   * wrong. It renders before the workspace is built, so nothing behind it can
   * flash into view.
   *
   * Imports: util, events, dates, cloud, icons, components.
   */

  const { el, clear } = __req("core/util.js");
  const { on, emit, EV } = __req("core/events.js");
  const cloud = __req("core/cloud.js");
  const { icon } = __req("ui/icons.js");
  const { fmtDate } = __req("core/dates.js");
  const { openModal, field, textInput, selectInput, section, skeleton, toast, badge, confirmDialog, emptyState } = __req("ui/components.js");












  /* ══════════════════════════════════════════════════════════════════════════
     The gate
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Show the sign-in screen and resolve once there is a session.
   *
   * Resolves to the user, or to null when the visitor chooses to work locally —
   * which stays available unless the deployment sets `requireAuth`.
   */
  function requireSignIn() {
    return new Promise((resolve) => {
      const allowLocal = !cloud.authRequired();

      // Sign-up is not offered. An invited person arrives on a link carrying
      // their address, which is the only thing that reveals the form — and even
      // then the database refuses any address without a pending invitation, so
      // finding this URL achieves nothing on its own.
      const invited = invitedEmail();
      let mode = invited ? 'signup' : 'signin'; // signin | signup | reset

      const overlay = el('div', { class: 'cx-gate', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sign in' });
      const card = el('div', { class: 'cx-gate-card' });
      overlay.appendChild(card);

      const emailInput = textInput({ type: 'email', value: invited || '', placeholder: 'you@company.com' });
      emailInput.setAttribute('autocomplete', 'username');
      emailInput.setAttribute('name', 'email');

      const passwordInput = textInput({ type: 'password', value: '', placeholder: '••••••••' });
      passwordInput.setAttribute('autocomplete', 'current-password');
      passwordInput.setAttribute('name', 'password');

      const nameInput = textInput({ value: '', placeholder: 'Your name' });
      nameInput.setAttribute('autocomplete', 'name');

      const message = el('div', { class: 'cx-gate-msg', role: 'alert' });
      const submit = el('button', { class: 'cx-btn primary', type: 'submit', text: 'Sign in' });

      const say = (text, tone = 'bad') => {
        message.className = `cx-gate-msg ${tone}`;
        message.textContent = text || '';
      };

      let busy = false;
      const setBusy = (state) => {
        busy = state;
        submit.disabled = state;
        submit.classList.toggle('loading', state);
      };

      const form = el('form', { class: 'cx-gate-form', onSubmit: (e) => { e.preventDefault(); go(); } });

      async function go() {
        if (busy) return;
        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email) return say('Enter your email address.');
        if (mode !== 'reset' && !password) return say('Enter your password.');

        setBusy(true);
        say('');
        try {
          if (mode === 'signin') {
            const user = await cloud.signIn(email, password);
            finish(user);
          } else if (mode === 'signup') {
            const { user, confirmationRequired } = await cloud.signUp(email, password, nameInput.value.trim());
            if (confirmationRequired) {
              say(`Account created. Check ${email} for a confirmation link, then sign in.`, 'good');
              setMode('signin');
            } else {
              finish(user);
            }
          } else {
            await cloud.sendPasswordReset(email);
            say(`If there is an account for ${email}, a reset link is on its way.`, 'good');
            setMode('signin');
          }
        } catch (err) {
          say(err.message);
        } finally {
          setBusy(false);
        }
      }

      function finish(user) {
        overlay.classList.add('done');
        setTimeout(() => overlay.remove(), 260);
        resolve(user);
      }

      function setMode(next) {
        mode = next;
        render();
        setTimeout(() => (mode === 'signup' ? nameInput : emailInput).focus(), 30);
      }

      function render() {
        clear(card);

        const titles = {
          signin: ['Sign in', 'Your projects, wherever you open them.'],
          signup: [
            'Set up your account',
            invited ? `You have been invited as ${invited}. Choose a password.` : 'Accounts are created by invitation.',
          ],
          reset: ['Reset your password', 'We will email you a link.'],
        };
        const [title, subtitle] = titles[mode];

        card.append(
          el('div', { class: 'cx-gate-brand' }, [
            el('div', { class: 'brand-mark' }),
            el('div', {}, [
              el('div', { class: 'cx-gate-name', text: 'CX Timeline' }),
              el('div', { class: 'cx-gate-sub', text: 'Commissioning Planner' }),
            ]),
          ]),
          el('h1', { class: 'cx-gate-title', text: title }),
          el('div', { class: 'cx-gate-lede', text: subtitle })
        );

        clear(form);
        form.append(
          ...[
            mode === 'signup' ? field('Name', nameInput) : null,
            field('Email', emailInput),
            mode !== 'reset' ? field('Password', passwordInput) : null,
            message,
            submit,
          ].filter(Boolean)
        );
        submit.textContent = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset link' }[mode];
        passwordInput.setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');
        card.appendChild(form);

        const links = el('div', { class: 'cx-gate-links' });
        if (mode === 'signin') {
          // No "create an account": there is no self-service sign-up.
          links.append(
            el('span', { class: 'cx-hint', text: 'Access is by invitation.' }),
            gateLink('Forgot password?', () => setMode('reset'))
          );
        } else {
          links.appendChild(gateLink('Back to sign in', () => setMode('signin')));
        }
        card.appendChild(links);

        if (allowLocal) {
          card.appendChild(
            el('div', { class: 'cx-gate-local' }, [
              el('button', {
                class: 'cx-btn ghost mini',
                text: 'Continue without an account',
                onClick: () => {
                  overlay.classList.add('done');
                  setTimeout(() => overlay.remove(), 260);
                  resolve(null);
                },
              }),
              el('div', { class: 'cx-hint', text: 'Work is saved in this browser only, and is not shared.' }),
            ])
          );
        }
      }

      render();
      document.body.appendChild(overlay);
      // An invited person already has their address filled in; put them in the
      // field they actually have to complete.
      setTimeout(() => (invited ? nameInput : emailInput).focus(), 80);
    });
  }

  /**
   * The address on an invitation link, if this is one.
   *
   * The link is a convenience, not a credential — it reveals the form and
   * prefills the address, nothing more. Whether an account may be created is
   * decided by the database, which refuses any address without a pending
   * invitation however the request arrives.
   */
  function invitedEmail() {
    const match = /[#&?]invite=([^&]+)/.exec(window.location.hash || '');
    if (!match) return '';
    try {
      return decodeURIComponent(match[1]).trim().toLowerCase();
    } catch {
      return '';
    }
  }

  function gateLink(text, onClick) {
    return el('button', { class: 'cx-gate-link', type: 'button', text, onClick });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Read-only presentation
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Reflect the current role in the interface.
   *
   * A viewer is not shown a broken application: the editing affordances go away,
   * a banner explains why, and a refused write says so once rather than on every
   * keystroke. The database is what actually stops the write — this is here so
   * the user understands the state they are in.
   */
  function installAccessMode() {
    const apply = () => {
      const readOnly = cloud.isReadOnly();
      document.body.classList.toggle('read-only', readOnly);
      renderBanner(readOnly);
    };

    on(EV.ACCESS_CHANGED, apply);
    on(EV.AUTH_CHANGED, apply);

    // One notice per burst — a viewer holding an arrow key would otherwise
    // stack up a notification per repeat.
    let lastRefusal = 0;
    on(EV.EDIT_REFUSED, () => {
      const now = Date.now();
      if (now - lastRefusal < 4000) return;
      lastRefusal = now;
      toast({
        tone: 'warn',
        title: 'Read-only',
        message: 'You have view access to this project. Ask the owner for edit access to make changes.',
      });
    });

    apply();
  }

  function renderBanner(readOnly) {
    const existing = document.getElementById('cx-readonly-bar');
    if (!readOnly) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const bar = el('div', { id: 'cx-readonly-bar', class: 'cx-readonly-bar', role: 'status' }, [
      el('span', { class: 'ro-icon', html: icon('eye', { size: 13 }) }),
      el('span', { text: 'Read-only — you have view access to this project.' }),
    ]);
    document.getElementById('main')?.prepend(bar);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The account menu
     ═══════════════════════════════════════════════════════════════════════ */

  /** The signed-in-as block that sits at the foot of the sidebar. */
  function accountBlock() {
    const root = el('div', { class: 'cx-account' });

    const render = () => {
      clear(root);
      if (!cloud.isSignedIn()) {
        root.appendChild(
          el('button', {
            class: 'cx-btn mini',
            html: icon('user', { size: 12 }) + '<span>Sign in</span>',
            onClick: async () => {
              await requireSignIn();
              window.location.reload();
            },
          })
        );
        return;
      }

      const label = cloud.accountLabel();
      root.append(
        el('div', { class: 'acc-avatar', text: initials(label) }),
        el('div', { class: 'acc-main' }, [
          el('div', { class: 'acc-name', text: label, title: cloud.currentUser()?.email || '' }),
          el('div', { class: 'acc-role', text: roleLabel(cloud.getRole()) }),
        ]),
        el('button', {
          class: 'cx-btn icon mini ghost',
          title: 'Sign out',
          'aria-label': 'Sign out',
          html: icon('logout', { size: 13 }),
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Sign out?',
              message: 'Anything saved stays on the server. Unsaved changes in this tab are written first.',
              confirmLabel: 'Sign out',
            });
            if (!ok) return;
            await cloud.signOut();
            window.location.reload();
          },
        })
      );
    };

    on(EV.AUTH_CHANGED, render);
    on(EV.ACCESS_CHANGED, render);
    render();
    return root;
  }

  function initials(label) {
    const parts = String(label).replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
  }

  function roleLabel(role) {
    return { owner: 'Owner', editor: 'Editor', viewer: 'View only' }[role] || 'No project open';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Team administration
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Who may have an account, and who administers the deployment.
   *
   * Sign-up is closed, so this pane is the only door in. Inviting writes a row
   * the database checks when the account is created — which is why an
   * invitation cannot be forged by anyone who finds the link, and why revoking
   * one actually stops the sign-up rather than merely hiding a button.
   */
  function paneTeam(root) {
    if (!cloud.isConfigured() || !cloud.isSignedIn()) {
      root.appendChild(
        emptyState({ iconName: 'users', title: 'Not available', message: 'Sign in to manage who has access.' })
      );
      return;
    }
    if (!cloud.isAdmin()) {
      root.appendChild(
        emptyState({
          iconName: 'shield',
          title: 'Administrators only',
          message: 'Accounts are created by invitation. Ask an administrator to invite someone.',
        })
      );
      return;
    }

    root.appendChild(el('div', { class: 'cx-hint', style: { marginBottom: '12px' },
      text: 'Nobody can create an account unless their address is invited here — the database refuses the sign-up, not just the form.' }));

    /* ── Invite ────────────────────────────────────────────────────────────── */
    const emailInput = textInput({ type: 'email', value: '', placeholder: 'colleague@company.com' });
    const noteInput = textInput({ value: '', placeholder: 'Role or team (optional)' });

    const invite = async () => {
      const email = emailInput.value.trim();
      if (!email) return;
      try {
        const result = await cloud.inviteUser(email, 'editor', noteInput.value.trim());
        emailInput.value = '';
        noteInput.value = '';
        showInviteLink(result.email);
        refresh();
      } catch (err) {
        toast({ tone: 'bad', title: 'Could not invite', message: err.message });
      }
    };
    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        invite();
      }
    });

    root.appendChild(
      section('Invite someone', [
        field('Email', emailInput),
        field('Note', noteInput, 'Only you see this — a reminder of who they are.'),
        el('button', {
          class: 'cx-btn mini primary',
          html: icon('plus', { size: 12 }) + '<span>Create invitation</span>',
          onClick: invite,
        }),
        el('div', { class: 'cx-hint', style: { marginTop: '8px' },
          text: 'No email is sent. You get a link to pass on however you like.' }),
      ])
    );

    const pending = el('div', { class: 'cx-list' });
    const accounts = el('div', { class: 'cx-list' });
    root.append(
      section('Pending invitations', [pending]),
      section('Accounts', [accounts])
    );

    async function refresh() {
      clear(pending);
      clear(accounts);
      pending.appendChild(skeleton(2));

      try {
        const [invites, people] = await Promise.all([cloud.listInvitations(), cloud.listAccounts()]);
        clear(pending);

        if (!invites.length) {
          pending.appendChild(el('div', { class: 'cx-hint', text: 'None outstanding.' }));
        } else {
          for (const invitation of invites) pending.appendChild(invitationRow(invitation));
        }
        for (const person of people) accounts.appendChild(accountRow(person));
      } catch (err) {
        clear(pending);
        pending.appendChild(el('div', { class: 'cx-gate-msg bad', text: err.message }));
      }
    }

    function invitationRow(invitation) {
      return el('div', { class: 'cx-listrow', dataset: { invite: invitation.email }, style: { cursor: 'default' } }, [
        el('span', { class: 'cx-dot', style: { background: invitation.expired ? 'var(--bad)' : 'var(--pending)' } }),
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: invitation.email }),
          el('div', { class: 'lr-meta', text: [
            invitation.note,
            invitation.expired ? 'expired' : `expires ${fmtDate(invitation.expires, 'medium')}`,
          ].filter(Boolean).join(' · ') }),
        ]),
        el('div', { class: 'lr-actions', style: { opacity: '1' } }, [
          el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Copy the invitation link',
            'aria-label': `Copy the invitation link for ${invitation.email}`,
            html: icon('copy', { size: 11 }),
            onClick: () => showInviteLink(invitation.email),
          }),
          el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Revoke',
            'aria-label': `Revoke the invitation for ${invitation.email}`,
            html: icon('trash', { size: 11 }),
            onClick: async () => {
              const ok = await confirmDialog({
                title: `Revoke ${invitation.email}?`,
                message: 'They will not be able to create an account with that address.',
                confirmLabel: 'Revoke',
                danger: true,
              });
              if (!ok) return;
              try {
                await cloud.revokeInvitation(invitation.email);
                refresh();
              } catch (err) {
                toast({ tone: 'bad', title: 'Could not revoke', message: err.message });
              }
            },
          }),
        ]),
      ]);
    }

    function accountRow(person) {
      return el('div', { class: 'cx-listrow', dataset: { account: person.id }, style: { cursor: 'default' } }, [
        el('div', { class: 'acc-avatar small', text: initials(person.name || person.email) }),
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: (person.name || person.email) + (person.isYou ? '  (you)' : '') }),
          el('div', { class: 'lr-meta', text: [
            person.email,
            `${person.projects} project${person.projects === 1 ? '' : 's'}`,
          ].join(' · ') }),
        ]),
        person.admin ? badge('Admin', 'good') : null,
        el('div', { class: 'lr-actions', style: { opacity: '1' } }, [
          el('button', {
            class: 'cx-btn mini ghost',
            text: person.admin ? 'Remove admin' : 'Make admin',
            onClick: async () => {
              try {
                await cloud.setAdmin(person.id, !person.admin);
                refresh();
              } catch (err) {
                toast({ tone: 'bad', title: 'Could not change', message: err.message });
              }
            },
          }),
        ]),
      ].filter(Boolean));
    }

    refresh();
  }

  /**
   * Show the link an invited person opens.
   *
   * A dialog rather than a silent clipboard write, because the link is the
   * whole deliverable of inviting someone — losing it silently would mean
   * revoking and re-inviting to get it back.
   */
  function showInviteLink(email) {
    const link = cloud.inviteLink(email);
    const box = textInput({ value: link });
    box.readOnly = true;
    box.style.fontFamily = 'var(--f-mono)';
    box.style.fontSize = 'var(--fs-tiny)';

    openModal({
      title: 'Invitation created',
      subtitle: `${email} can now set up an account — and nobody else can.`,
      body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } }, [
        field('Send them this link', box, 'It expires in 30 days. Revoke it any time from the Team pane.'),
        el('button', {
          class: 'cx-btn mini',
          html: icon('copy', { size: 12 }) + '<span>Copy link</span>',
          onClick: async (e) => {
            try {
              await navigator.clipboard.writeText(link);
            } catch {
              // Clipboard access can be refused; selecting the text still works.
              box.select();
            }
            e.currentTarget.innerHTML = icon('check', { size: 12 }) + '<span>Copied</span>';
          },
        }),
      ]),
      actions: [{ label: 'Done', kind: 'primary' }],
    });

    setTimeout(() => box.select(), 60);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Sharing
     ═══════════════════════════════════════════════════════════════════════ */

  const ROLE_OPTIONS = [
    { value: 'viewer', label: 'Viewer — can open and export, cannot change anything' },
    { value: 'editor', label: 'Editor — can change the plan' },
    { value: 'owner', label: 'Owner — full control, including sharing' },
  ];

  /**
   * Who can see this project, and what they may do.
   * Owners can change it; everyone else sees the list read-only, which is
   * useful on its own — knowing who else is in a plan matters.
   */
  function openShareDialog(projectId = cloud.getProjectId(), projectName = '') {
    if (!projectId) {
      toast({ tone: 'warn', title: 'No project open', message: 'Open a project before sharing it.' });
      return;
    }

    const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
    const list = el('div', { class: 'cx-list' });
    const owner = cloud.isOwner();

    const emailInput = textInput({ type: 'email', value: '', placeholder: 'colleague@company.com' });
    let inviteRole = 'viewer';

    async function refresh() {
      clear(list);
      let members = [];
      try {
        members = await cloud.listMembers(projectId);
      } catch (err) {
        list.appendChild(el('div', { class: 'cx-gate-msg bad', text: err.message }));
        return;
      }
      if (!members.length) {
        list.appendChild(emptyState({ iconName: 'user', title: 'Nobody else yet' }));
        return;
      }
      for (const member of members) list.appendChild(memberRow(member));
    }

    function memberRow(member) {
      const isLastOwner = member.role === 'owner';
      return el('div', { class: 'cx-listrow', dataset: { member: member.userId }, style: { cursor: 'default' } }, [
        el('div', { class: 'acc-avatar small', text: initials(member.name || member.email || '?') }),
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: (member.name || member.email) + (member.isYou ? '  (you)' : '') }),
          el('div', { class: 'lr-meta', text: member.email || '' }),
        ]),
        owner && !member.isYou
          ? selectInput({
              value: member.role,
              mini: true,
              options: ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.value })),
              onChange: async (v) => {
                try {
                  await cloud.setMemberRole(projectId, member.email, v);
                  toast({ tone: 'good', title: 'Access updated', message: `${member.email} is now ${v === 'viewer' ? 'a viewer' : `an ${v}`}.` });
                  refresh();
                } catch (err) {
                  toast({ tone: 'bad', title: 'Could not change access', message: err.message });
                  refresh();
                }
              },
            })
          : badge(roleLabel(member.role), member.role === 'viewer' ? 'muted' : 'info'),
        owner && !(member.isYou && isLastOwner)
          ? el('button', {
              class: 'cx-btn icon mini ghost',
              title: 'Remove access',
              'aria-label': `Remove ${member.email}`,
              html: icon('x', { size: 11 }),
              onClick: async () => {
                const ok = await confirmDialog({
                  title: `Remove ${member.email}?`,
                  message: 'They lose access to this project immediately.',
                  confirmLabel: 'Remove',
                  danger: true,
                });
                if (!ok) return;
                try {
                  await cloud.unshareProject(projectId, member.userId);
                  refresh();
                } catch (err) {
                  toast({ tone: 'bad', title: 'Could not remove', message: err.message });
                }
              },
            })
          : null,
      ].filter(Boolean));
    }

    async function invite() {
      const email = emailInput.value.trim();
      if (!email) return;
      try {
        await cloud.shareProject(projectId, email, inviteRole);
        emailInput.value = '';
        toast({
          tone: 'good',
          title: 'Shared',
          message: `${email} now has ${inviteRole === 'viewer' ? 'view-only' : inviteRole} access.`,
        });
        refresh();
      } catch (err) {
        toast({ tone: 'bad', title: 'Could not share', message: err.message });
      }
    }

    if (owner) {
      const roleSelect = selectInput({
        value: inviteRole,
        options: ROLE_OPTIONS,
        onChange: (v) => { inviteRole = v; },
      });
      emailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          invite();
        }
      });

      body.append(
        el('div', {}, [
          field('Invite by email', emailInput, 'They need a CX Timeline account already — sharing does not send an invitation email.'),
          field('Access level', roleSelect),
          el('button', {
            class: 'cx-btn primary mini',
            html: icon('plus', { size: 12 }) + '<span>Grant access</span>',
            onClick: invite,
          }),
        ])
      );
    } else {
      body.appendChild(
        el('div', { class: 'cx-hint', text: 'Only the project owner can change who has access.' })
      );
    }

    body.append(el('div', { class: 'cx-section-label', text: 'People with access' }), list);
    refresh();

    return openModal({
      title: projectName ? `Share "${projectName}"` : 'Share project',
      subtitle: 'Access is enforced by the database, not the interface.',
      body,
      actions: [{ label: 'Done', kind: 'primary' }],
    });
  }

  Object.defineProperty(__x, "requireSignIn", { get: () => requireSignIn, enumerable: true });
  Object.defineProperty(__x, "installAccessMode", { get: () => installAccessMode, enumerable: true });
  Object.defineProperty(__x, "accountBlock", { get: () => accountBlock, enumerable: true });
  Object.defineProperty(__x, "paneTeam", { get: () => paneTeam, enumerable: true });
  Object.defineProperty(__x, "openShareDialog", { get: () => openShareDialog, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/notes.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/notes.js"] = function (__x, __req) {
  /**
   * Rich notes editor.
   *
   * A contenteditable surface with a compact toolbar covering the formats the
   * brief asks for: headings, bold/italic/underline, bullet and numbered lists,
   * checklists, tables, links and inline images. Content is stored as sanitised
   * HTML on the object, which keeps it portable through JSON export and
   * renderable in the hover preview and PDF output.
   *
   * Everything written back to the document passes through `sanitiseHtml` —
   * notes can arrive from an imported file, and a plan should never be able to
   * execute script because someone pasted it into a note.
   *
   * Imports: util, icons, components.
   */

  const { el, clear, debounce, stripHtml, readFileAsDataURL, pickFiles, bytes } = __req("core/util.js");
  const { icon } = __req("ui/icons.js");
  const { openModal, toast, popover, closePopover, promptDialog } = __req("ui/components.js");

  /* ══════════════════════════════════════════════════════════════════════════
     Sanitiser
     ═══════════════════════════════════════════════════════════════════════ */

  const ALLOWED_TAGS = new Set([
    'P', 'BR', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'CODE', 'PRE',
    'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR',
    'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'IMG', 'INPUT', 'LABEL',
  ]);

  const ALLOWED_ATTRS = {
    A: ['href', 'title', 'target', 'rel'],
    IMG: ['src', 'alt', 'width', 'height'],
    INPUT: ['type', 'checked', 'disabled'],
    TD: ['colspan', 'rowspan'],
    TH: ['colspan', 'rowspan'],
    SPAN: ['class'],
    LI: ['class'],
    DIV: ['class'],
    P: ['class'],
  };

  /**
   * Strip everything that is not on the allow-list. Runs over a detached
   * document so nothing in the markup can load, execute or observe anything.
   */
  function sanitiseHtml(html) {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(`<body>${html || ''}</body>`, 'text/html');
    const body = parsed.body;

    const walk = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) continue;
        if (child.nodeType !== Node.ELEMENT_NODE) {
          child.remove();
          continue;
        }
        if (!ALLOWED_TAGS.has(child.tagName)) {
          // Keep the text, drop the wrapper — losing formatting beats losing
          // the user's words.
          const text = parsed.createTextNode(child.textContent || '');
          child.replaceWith(text);
          continue;
        }
        const allowed = ALLOWED_ATTRS[child.tagName] || [];
        for (const attr of Array.from(child.attributes)) {
          const name = attr.name.toLowerCase();
          if (!allowed.includes(name)) {
            child.removeAttribute(attr.name);
            continue;
          }
          if (name === 'href' || name === 'src') {
            const value = attr.value.trim().toLowerCase();
            const safe =
              value.startsWith('http://') ||
              value.startsWith('https://') ||
              value.startsWith('mailto:') ||
              value.startsWith('data:image/') ||
              value.startsWith('file:///') ||
              value.startsWith('#');
            if (!safe) child.removeAttribute(attr.name);
          }
        }
        if (child.tagName === 'A') {
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        }
        if (child.tagName === 'INPUT' && child.getAttribute('type') !== 'checkbox') {
          child.remove();
          continue;
        }
        walk(child);
      }
    };

    walk(body);
    return body.innerHTML;
  }

  /** Plain-text preview of a note, for tooltips and search results. */
  function notePreview(html, max = 220) {
    const text = stripHtml(html);
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Editor
     ═══════════════════════════════════════════════════════════════════════ */

  const TOOLBAR = [
    [
      { cmd: 'formatBlock', arg: 'h3', icon: 'type', title: 'Heading' },
      { cmd: 'bold', icon: 'type', title: 'Bold', label: 'B' },
      { cmd: 'italic', icon: 'type', title: 'Italic', label: 'I' },
      { cmd: 'underline', icon: 'type', title: 'Underline', label: 'U' },
      { cmd: 'strikeThrough', title: 'Strikethrough', label: 'S' },
    ],
    [
      { cmd: 'insertUnorderedList', icon: 'list', title: 'Bullet list' },
      { cmd: 'insertOrderedList', icon: 'checklist', title: 'Numbered list' },
      { custom: 'checklist', icon: 'check-circle', title: 'Checklist item' },
      { cmd: 'formatBlock', arg: 'blockquote', icon: 'comment', title: 'Quote' },
    ],
    [
      { custom: 'table', icon: 'table', title: 'Insert table' },
      { custom: 'link', icon: 'link', title: 'Insert link' },
      { custom: 'image', icon: 'image', title: 'Insert image' },
      { custom: 'rule', icon: 'minus', title: 'Horizontal rule' },
    ],
    [{ cmd: 'removeFormat', icon: 'eraser', title: 'Clear formatting', label: '✕' }],
  ];

  /**
   * Build an editor surface.
   * @returns {{root:HTMLElement, getHtml:Function, setHtml:Function, focus:Function}}
   */
  function noteEditor({ value = '', onChange = null, minHeight = 220 } = {}) {
    const surface = el('div', {
      class: 'note-surface',
      contenteditable: 'true',
      role: 'textbox',
      'aria-multiline': 'true',
      style: { minHeight: `${minHeight}px` },
    });
    surface.innerHTML = sanitiseHtml(value);

    const emitChange = debounce(() => {
      if (onChange) onChange(getHtml());
    }, 260);

    const exec = (cmd, arg) => {
      surface.focus();
      document.execCommand(cmd, false, arg);
      emitChange();
    };

    const toolbar = el('div', { class: 'note-toolbar' });
    TOOLBAR.forEach((group, i) => {
      if (i > 0) toolbar.appendChild(el('div', { class: 'note-tb-sep' }));
      for (const item of group) {
        const button = el('button', {
          class: 'cx-btn icon mini ghost',
          type: 'button',
          title: item.title,
          'aria-label': item.title,
          html: item.label ? `<span style="font-weight:700">${item.label}</span>` : icon(item.icon, { size: 13 }),
          onMousedown: (e) => e.preventDefault(), // keep the selection alive
          onClick: () => {
            if (item.custom) runCustom(item.custom, surface, exec, emitChange);
            else exec(item.cmd, item.arg);
          },
        });
        toolbar.appendChild(button);
      }
    });

    surface.addEventListener('input', emitChange);

    // Paste as plain text unless the clipboard carries HTML we can sanitise.
    surface.addEventListener('paste', (e) => {
      const html = e.clipboardData?.getData('text/html');
      if (html) {
        e.preventDefault();
        document.execCommand('insertHTML', false, sanitiseHtml(html));
        emitChange();
      }
    });

    // Checkbox toggles inside the note.
    surface.addEventListener('click', (e) => {
      if (e.target.matches('input[type=checkbox]')) {
        // execCommand does not track this, so mirror the state into the markup.
        if (e.target.checked) e.target.setAttribute('checked', '');
        else e.target.removeAttribute('checked');
        emitChange();
      }
    });

    function getHtml() {
      return sanitiseHtml(surface.innerHTML);
    }

    function setHtml(html) {
      surface.innerHTML = sanitiseHtml(html);
    }

    const root = el('div', { class: 'note-editor' }, [toolbar, surface]);
    return { root, getHtml, setHtml, focus: () => surface.focus(), surface };
  }

  async function runCustom(kind, surface, exec, emitChange) {
    surface.focus();
    switch (kind) {
      case 'checklist':
        document.execCommand('insertHTML', false, '<div class="note-check"><input type="checkbox"> <span>To do</span></div>');
        emitChange();
        break;

      case 'rule':
        document.execCommand('insertHorizontalRule');
        emitChange();
        break;

      case 'link': {
        const selection = window.getSelection();
        const text = selection ? String(selection) : '';
        const url = await promptDialog({ title: 'Insert link', label: 'URL', value: 'https://', placeholder: 'https://…' });
        if (!url) return;
        surface.focus();
        if (text) document.execCommand('createLink', false, url);
        else document.execCommand('insertHTML', false, `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
        emitChange();
        break;
      }

      case 'table': {
        const size = await promptDialog({ title: 'Insert table', label: 'Columns × rows', value: '3x3', placeholder: '3x3' });
        if (!size) return;
        const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size.trim());
        const cols = Math.min(10, Math.max(1, match ? +match[1] : 3));
        const rows = Math.min(20, Math.max(1, match ? +match[2] : 3));
        let html = '<table><thead><tr>';
        for (let c = 0; c < cols; c++) html += `<th>Column ${c + 1}</th>`;
        html += '</tr></thead><tbody>';
        for (let r = 0; r < rows; r++) {
          html += '<tr>';
          for (let c = 0; c < cols; c++) html += '<td>&nbsp;</td>';
          html += '</tr>';
        }
        html += '</tbody></table><p><br></p>';
        surface.focus();
        document.execCommand('insertHTML', false, html);
        emitChange();
        break;
      }

      case 'image': {
        const files = await pickFiles({ accept: 'image/*' });
        if (!files.length) return;
        const file = files[0];
        // Notes travel inside the document, so a huge inline image would bloat
        // every autosave. Point large files at the attachment store instead.
        if (file.size > 1_500_000) {
          toast({
            tone: 'warn',
            title: 'Image too large to inline',
            message: `${bytes(file.size)} — add it as an attachment instead so the project stays fast.`,
          });
          return;
        }
        const dataUrl = await readFileAsDataURL(file);
        surface.focus();
        document.execCommand('insertHTML', false, `<img src="${dataUrl}" alt="${file.name}" style="max-width:100%">`);
        emitChange();
        break;
      }

      default:
        break;
    }
  }

  /**
   * Open the full-screen note editor for an object.
   * `onSave(html)` is called when the user confirms.
   */
  function openNoteEditor({ title, value, onSave }) {
    const editor = noteEditor({ value, minHeight: 320 });
    let current = value;
    editor.root.addEventListener('input', () => {
      current = editor.getHtml();
    });

    openModal({
      title: `Notes — ${title}`,
      subtitle: 'Rich text, checklists, tables, links and inline images.',
      size: 'wide',
      body: editor.root,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save notes',
          kind: 'primary',
          onClick: () => onSave(editor.getHtml()),
        },
      ],
    });

    setTimeout(() => editor.focus(), 60);
  }

  /** Read-only render of a note, used in hover previews and print output. */
  function renderNote(html, { max = 0 } = {}) {
    const node = el('div', { class: 'note-render' });
    node.innerHTML = sanitiseHtml(html);
    if (max) node.style.maxHeight = `${max}px`;
    // Checkboxes are display-only outside the editor.
    node.querySelectorAll('input[type=checkbox]').forEach((box) => {
      box.setAttribute('disabled', '');
    });
    return node;
  }

  Object.defineProperty(__x, "sanitiseHtml", { get: () => sanitiseHtml, enumerable: true });
  Object.defineProperty(__x, "notePreview", { get: () => notePreview, enumerable: true });
  Object.defineProperty(__x, "noteEditor", { get: () => noteEditor, enumerable: true });
  Object.defineProperty(__x, "openNoteEditor", { get: () => openNoteEditor, enumerable: true });
  Object.defineProperty(__x, "renderNote", { get: () => renderNote, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/attachments.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/attachments.js"] = function (__x, __req) {
  /**
   * Attachments.
   *
   * File bytes live in IndexedDB, keyed by attachment id; the document holds
   * only a lightweight record (name, type, size, when it was added). That split
   * is what lets a project carry a 40 MB test log without every autosave having
   * to rewrite it.
   *
   * The storage layer is deliberately behind one small interface here, so a
   * future "link to a file on disk" or "sync to SharePoint" backend can be added
   * without touching the UI.
   *
   * Imports: util, events, dates, storage, store, icons, components.
   */

  const { el, clear, uid, bytes, download, pickFiles } = __req("core/util.js");
  const { emit, EV } = __req("core/events.js");
  const { fmtTimestamp } = __req("core/dates.js");
  const { putBlob, getBlob, deleteBlob, isFallback } = __req("core/storage.js");
  const { getDoc, getObject, updateObject, addAttachmentRecord, removeAttachmentRecord, getAttachment } = __req("core/store.js");
  const { icon } = __req("ui/icons.js");
  const { toast, confirmDialog } = __req("ui/components.js");

  /** Icon for a file, chosen from its extension. */
  function iconForFile(name = '', type = '') {
    const ext = String(name).split('.').pop().toLowerCase();
    if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'document';
    if (['xls', 'xlsx', 'xlsm', 'csv', 'tsv'].includes(ext)) return 'table';
    if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'file';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'package';
    if (['log', 'txt', 'md'].includes(ext)) return 'list';
    if (['json', 'xml', 'yml', 'yaml'].includes(ext)) return 'cpu';
    return 'paperclip';
  }

  /**
   * Attach files to an object. Returns the ids that were stored.
   * Failures are reported per file so one bad file does not lose the rest.
   */
  async function attachFiles(objectId, files) {
    if (isFallback()) {
      toast({
        tone: 'warn',
        title: 'Attachments unavailable',
        message: 'This browser session has no IndexedDB, so file bytes cannot be stored locally.',
      });
      return [];
    }

    const obj = getObject(objectId);
    if (!obj) return [];

    const stored = [];
    for (const file of files) {
      const id = uid('att');
      try {
        await putBlob(id, file);
        addAttachmentRecord({
          id,
          name: file.name,
          type: file.type || '',
          size: file.size,
          added: Date.now(),
          storage: 'idb',
        });
        stored.push(id);
      } catch (err) {
        console.error('[cx-timeline] attachment failed:', err);
        toast({ tone: 'bad', title: `Could not attach ${file.name}`, message: err.message });
      }
    }

    if (stored.length) {
      const current = getObject(objectId);
      updateObject(objectId, { attachments: [...(current.attachments || []), ...stored] }, 'Attach files');
      toast({ tone: 'good', title: `${stored.length} file${stored.length === 1 ? '' : 's'} attached` });
    }
    return stored;
  }

  /** Open the picker and attach whatever the user chooses. */
  async function promptAttach(objectId) {
    const files = await pickFiles({ multiple: true });
    if (files.length) await attachFiles(objectId, files);
  }

  /** Save an attachment back out to the user's disk. */
  async function downloadAttachment(id) {
    const record = getAttachment(id);
    const stored = await getBlob(id);
    if (!stored || !stored.blob) {
      toast({ tone: 'bad', title: 'File missing', message: 'The stored bytes for this attachment could not be found.' });
      return;
    }
    download(record?.name || stored.name || 'attachment', stored.blob, stored.type);
  }

  /** Open an attachment in a new tab where the browser can display it. */
  async function openAttachment(id) {
    const stored = await getBlob(id);
    if (!stored || !stored.blob) {
      toast({ tone: 'bad', title: 'File missing' });
      return;
    }
    const url = URL.createObjectURL(stored.blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** Detach from one object, and delete the bytes if nothing else refers to it. */
  async function detachFile(objectId, attachmentId) {
    const obj = getObject(objectId);
    if (!obj) return;

    updateObject(objectId, { attachments: (obj.attachments || []).filter((a) => a !== attachmentId) }, 'Remove attachment');

    const stillUsed = getDoc().objects.some((o) => (o.attachments || []).includes(attachmentId));
    if (!stillUsed) {
      removeAttachmentRecord(attachmentId);
      try {
        await deleteBlob(attachmentId);
      } catch {
        /* the record is gone either way; orphaned bytes are collected later */
      }
    }
  }

  /**
   * The attachment list widget used by the inspector and the object editor.
   * Supports click-to-pick and drag-and-drop.
   */
  function attachmentList(objectId, { onChange = null } = {}) {
    const root = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
    const list = el('div', { class: 'att-list' });

    const drop = el('div', {
      class: 'att-drop',
      html: icon('paperclip', { size: 14 }) + ' <span>Drop files here, or click to browse</span>',
      onClick: async () => {
        await promptAttach(objectId);
        refresh();
        onChange?.();
      },
    });

    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) {
        await attachFiles(objectId, files);
        refresh();
        onChange?.();
      }
    });

    function refresh() {
      clear(list);
      const obj = getObject(objectId);
      const ids = obj?.attachments || [];
      if (!ids.length) {
        list.appendChild(el('div', { class: 'cx-hint', text: 'No files attached.' }));
        return;
      }
      for (const id of ids) {
        const record = getAttachment(id);
        if (!record) continue;
        list.appendChild(
          el('div', { class: 'att-row' }, [
            el('span', { class: 'att-icon', html: icon(iconForFile(record.name, record.type), { size: 14 }) }),
            el('div', { class: 'att-main' }, [
              el('div', { class: 'att-name', text: record.name, title: record.name }),
              el('div', { class: 'att-meta', text: `${bytes(record.size)} · ${fmtTimestamp(record.added)}` }),
            ]),
            el('button', {
              class: 'cx-btn icon mini ghost',
              title: 'Open',
              'aria-label': `Open ${record.name}`,
              html: icon('external', { size: 12 }),
              onClick: () => openAttachment(id),
            }),
            el('button', {
              class: 'cx-btn icon mini ghost',
              title: 'Download',
              'aria-label': `Download ${record.name}`,
              html: icon('download', { size: 12 }),
              onClick: () => downloadAttachment(id),
            }),
            el('button', {
              class: 'cx-btn icon mini ghost',
              title: 'Remove',
              'aria-label': `Remove ${record.name}`,
              html: icon('trash', { size: 12 }),
              onClick: async () => {
                const ok = await confirmDialog({
                  title: 'Remove attachment',
                  message: `Remove "${record.name}" from this object? The stored file is deleted if nothing else references it.`,
                  confirmLabel: 'Remove',
                  danger: true,
                });
                if (!ok) return;
                await detachFile(objectId, id);
                refresh();
                onChange?.();
              },
            }),
          ])
        );
      }
    }

    refresh();
    root.append(list, drop);
    return { root, refresh };
  }

  Object.defineProperty(__x, "iconForFile", { get: () => iconForFile, enumerable: true });
  Object.defineProperty(__x, "attachFiles", { get: () => attachFiles, enumerable: true });
  Object.defineProperty(__x, "promptAttach", { get: () => promptAttach, enumerable: true });
  Object.defineProperty(__x, "downloadAttachment", { get: () => downloadAttachment, enumerable: true });
  Object.defineProperty(__x, "openAttachment", { get: () => openAttachment, enumerable: true });
  Object.defineProperty(__x, "detachFile", { get: () => detachFile, enumerable: true });
  Object.defineProperty(__x, "attachmentList", { get: () => attachmentList, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/dialogs.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/dialogs.js"] = function (__x, __req) {
  /**
   * Focused editor dialogs.
   *
   * The inspector is always-on and shallow; this is the deep, deliberate edit —
   * opened by double-click or Enter — with the object's schedule, details,
   * notes and attachments on one surface.
   *
   * Imports: util, dates, model, store, renderer, icons, components, lists,
   *          notes, attachments.
   */

  const { el, clear } = __req("core/util.js");
  const { toISO, toMs, fmtDate, fmtDuration, MS_DAY } = __req("core/dates.js");
  const { TYPES, durationDays } = __req("core/model.js");



  const store = __req("core/store.js");
  const renderer = __req("timeline/renderer.js");
  const { icon } = __req("ui/icons.js");
  const { openModal, field, textInput, numberInput, selectInput, rangeInput, toast, badge } = __req("ui/components.js");
  const { managedSelect, suggestInput } = __req("ui/lists.js");
  const { noteEditor } = __req("ui/notes.js");
  const { attachmentList } = __req("ui/attachments.js");

  /**
   * Open the full editor for an object.
   * Edits apply live (so the timeline updates as you type) and the dialog's
   * Cancel restores the pre-edit state via a single undo.
   */
  function openObjectDialog(id) {
    const obj = store.getObject(id);
    if (!obj) return;
    const def = TYPES[obj.type] || TYPES.activity;

    const historyDepthBefore = store.historyState().depth;

    const tabs = el('div', { class: 'cx-seg stretch', style: { marginBottom: '14px' } });
    const panes = el('div');
    const paneMap = new Map();

    const addTab = (key, label, iconName, build) => {
      const button = el('button', {
        dataset: { tab: key },
        onClick: () => selectTab(key),
        html: icon(iconName, { size: 12 }) + `<span>${label}</span>`,
      });
      tabs.appendChild(button);
      const pane = el('div', { style: { display: 'none', flexDirection: 'column', gap: '13px' } });
      build(pane);
      panes.appendChild(pane);
      paneMap.set(key, { button, pane });
    };

    function selectTab(key) {
      for (const [k, entry] of paneMap) {
        entry.button.classList.toggle('active', k === key);
        entry.pane.style.display = k === key ? 'flex' : 'none';
      }
    }

    addTab('details', 'Details', 'sliders', (pane) => buildDetails(pane, obj, def));
    addTab('notes', 'Notes', 'comment', (pane) => buildNotes(pane, obj));
    addTab('files', 'Attachments', 'paperclip', (pane) => pane.appendChild(attachmentList(obj.id).root));
    addTab('links', 'Dependencies', 'link', (pane) => buildLinks(pane, obj));

    selectTab('details');

    openModal({
      title: obj.title || def.label,
      subtitle: `${def.label} · ${store.getLane(obj.lane)?.name || 'No lane'}`,
      size: 'wide',
      body: el('div', {}, [tabs, panes]),
      actions: [
        {
          label: 'Revert changes',
          onClick: () => {
            // Roll back exactly the edits this dialog made.
            const steps = store.historyState().depth - historyDepthBefore;
            for (let i = 0; i < steps; i++) store.undo();
            renderer.requestRender();
          },
        },
        'spacer',
        { label: 'Done', kind: 'primary', autofocus: true },
      ],
    });
  }

  /* ── Details tab ───────────────────────────────────────────────────────── */

  function buildDetails(pane, obj, def) {
    const set = (patch, label, opts) => {
      store.updateObject(obj.id, patch, label || 'Edit object', opts);
      renderer.requestRender();
    };

    pane.append(
      field('Title', textInput({
        value: obj.title,
        onInput: (v) => set({ title: v }, 'Rename object', { mergeKey: `dlg-title:${obj.id}` }),
      })),
      field('Subtitle', textInput({
        value: obj.subtitle,
        placeholder: 'Optional second line',
        onInput: (v) => set({ subtitle: v }, 'Edit subtitle', { mergeKey: `dlg-sub:${obj.id}` }),
      })),
      el('div', { class: 'cx-row three' }, [
        field('Lane', selectInput({
          value: obj.lane || '',
          options: store.orderedLanes().map((l) => ({ value: l.id, label: l.name })),
          onChange: (v) => set({ lane: v, row: 0 }, 'Move to lane'),
        })),
        field('Status', managedSelect({
          listId: 'status',
          value: obj.status,
          onChange: (v) => set({ status: v }, 'Change status'),
        })),
        field('Owner', suggestInput({
          listId: 'owner',
          value: obj.owner,
          placeholder: 'Responsible engineer',
          onInput: (v) => set({ owner: v }, 'Change owner', { mergeKey: `dlg-owner:${obj.id}` }),
        })),
      ])
    );

    if (def.duration) {
      const durationOut = el('span', { class: 'mono', style: { fontSize: 'var(--fs-tiny)', color: 'var(--text-muted)' }, text: fmtDuration(durationDays(obj)) });
      pane.appendChild(
        el('div', { class: 'cx-row three' }, [
          field('Start', textInput({
            type: 'date',
            value: toISO(obj.start),
            onChange: (v) => {
              const ms = toMs(v);
              if (!Number.isFinite(ms)) return;
              const shift = ms - obj.start;
              set({ start: ms, end: obj.end + shift }, 'Change start date');
            },
          })),
          field('Finish', textInput({
            type: 'date',
            value: toISO(obj.end),
            onChange: (v) => {
              const ms = toMs(v);
              if (Number.isFinite(ms)) set({ end: Math.max(ms, obj.start + MS_DAY) }, 'Change finish date');
            },
          })),
          field('Duration', el('div', { class: 'cx-inline' }, [
            numberInput({
              value: durationDays(obj),
              min: 1,
              onChange: (v) => {
                set({ end: obj.start + Math.max(1, v) * MS_DAY }, 'Change duration');
                durationOut.textContent = fmtDuration(Math.max(1, v));
              },
            }),
            durationOut,
          ])),
        ])
      );
    } else {
      pane.appendChild(
        field('Date', textInput({
          type: 'date',
          value: toISO(obj.start),
          onChange: (v) => {
            const ms = toMs(v);
            if (Number.isFinite(ms)) set({ start: ms, end: ms }, 'Change date');
          },
        }))
      );
    }

    if (def.progress) {
      const readout = el('span', { class: 'mono', style: { minWidth: '40px', textAlign: 'right' }, text: `${Math.round(obj.progress)}%` });
      pane.appendChild(
        field('Percent complete', el('div', { class: 'cx-inline' }, [
          rangeInput({
            value: obj.progress,
            min: 0,
            max: 100,
            step: 5,
            onInput: (v) => {
              readout.textContent = `${v}%`;
            },
            onChange: (v) => set({ progress: v }, 'Change progress'),
          }),
          readout,
        ]))
      );
    }

    /* Type-specific block */
    const data = obj.data || {};
    const setData = (key, value, label) => set({ data: { [key]: value } }, label || 'Edit details');
    const has = (name) => def.fields.includes(name);
    const extra = [];

    if (has('version')) {
      extra.push(
        el('div', { class: 'cx-row three' }, [
          field('Version', textInput({ value: data.version || '', placeholder: '2.5.0', onInput: (v) => setData('version', v, 'Change version') })),
          field('Release number', textInput({ value: data.releaseNumber || '', placeholder: 'REL-025', onInput: (v) => setData('releaseNumber', v, 'Change release number') })),
          field('Build number', textInput({ value: data.buildNumber || '', placeholder: '2.5.0-rc3', onInput: (v) => setData('buildNumber', v, 'Change build number') })),
        ]),
        field('Approval', managedSelect({
          listId: 'approval',
          value: data.approval || 'none',
          onChange: (v) => setData('approval', v, 'Change approval'),
        }))
      );
    }

    if (has('testPackage') || has('testKind') || has('area') || has('subsystem')) {
      extra.push(
        el('div', { class: 'cx-row three' }, [
          has('subsystem')
            ? field('Subsystem', managedSelect({
                listId: 'subsystem',
                value: obj.subsystem,
                onChange: (v) => set({ subsystem: v }, 'Change subsystem'),
              }))
            : null,
          has('area')
            ? field('Area', suggestInput({ listId: 'area', value: obj.area, placeholder: 'Section / zone', onInput: (v) => set({ area: v }, 'Change area', { mergeKey: `dlg-area:${obj.id}` }) }))
            : null,
          has('testPackage')
            ? field('Test package', textInput({ value: data.testPackage || '', placeholder: 'TP-DYN-01', onInput: (v) => setData('testPackage', v, 'Change test package') }))
            : null,
          has('testKind')
            ? field('Test type', managedSelect({
                listId: 'testKind',
                value: data.testKind || '',
                onChange: (v) => setData('testKind', v, 'Change test type'),
              }))
            : null,
        ].filter(Boolean))
      );
    }

    if (has('actualStart')) {
      extra.push(
        el('div', { class: 'cx-row' }, [
          field('Actual start', textInput({ type: 'date', value: data.actualStart || '', onChange: (v) => setData('actualStart', v, 'Set actual start') })),
          field('Actual finish', textInput({ type: 'date', value: data.actualEnd || '', onChange: (v) => setData('actualEnd', v, 'Set actual finish') })),
        ])
      );
    }

    if (has('severity')) {
      extra.push(
        el('div', { class: 'cx-row' }, [
          field('Severity', managedSelect({
            listId: 'severity',
            value: data.severity || 'medium',
            onChange: (v) => setData('severity', v, 'Change severity'),
          })),
          has('likelihood')
            ? field('Likelihood', managedSelect({
                listId: 'severity',
                value: data.likelihood || 'medium',
                onChange: (v) => setData('likelihood', v, 'Change likelihood'),
              }))
            : field('Reference', textInput({ value: data.reference || '', onInput: (v) => setData('reference', v, 'Change reference') })),
        ])
      );
    }

    if (has('mitigation')) {
      const area = el('textarea', { class: 'cx-textarea', rows: 3, placeholder: 'How the risk is being managed' });
      area.value = data.mitigation || '';
      area.addEventListener('change', () => setData('mitigation', area.value, 'Edit mitigation'));
      extra.push(field('Mitigation', area));
    }

    if (extra.length) {
      pane.appendChild(el('div', { class: 'eyebrow', style: { marginTop: '4px' }, text: def.label + ' fields' }));
      pane.append(...extra);
    }

    pane.appendChild(
      field('Tags', textInput({
        value: (obj.tags || []).join(', '),
        placeholder: 'comma, separated',
        onChange: (v) => set({ tags: v.split(',').map((t) => t.trim()).filter(Boolean) }, 'Edit tags'),
      }))
    );
  }

  /* ── Notes tab ─────────────────────────────────────────────────────────── */

  function buildNotes(pane, obj) {
    const editor = noteEditor({
      value: obj.notes,
      minHeight: 300,
      onChange: (html) => {
        store.updateObject(obj.id, { notes: html }, 'Edit notes', { mergeKey: `notes:${obj.id}` });
        renderer.requestRender();
      },
    });
    pane.appendChild(editor.root);
  }

  /* ── Dependencies tab ──────────────────────────────────────────────────── */

  function buildLinks(pane, obj) {
    const list = el('div', { class: 'cx-list' });

    function refresh() {
      clear(list);
      const links = store.linksFor([obj.id]);
      if (!links.length) {
        list.appendChild(el('div', { class: 'cx-hint', text: 'No dependencies yet.' }));
        return;
      }
      for (const link of links) {
        const outgoing = link.from === obj.id;
        const other = store.getObject(outgoing ? link.to : link.from);
        if (!other) continue;
        list.appendChild(
          el('div', { class: 'cx-listrow' }, [
            el('span', { style: { display: 'flex', color: 'var(--text-subtle)' }, html: icon(outgoing ? 'arrow' : 'arrow-left', { size: 12 }) }),
            el('div', { class: 'lr-main' }, [
              el('div', { class: 'lr-title', text: other.title }),
              el('div', { class: 'lr-meta', text: `${link.type}${link.lag ? ` ${link.lag > 0 ? '+' : ''}${link.lag}d` : ''} · ${fmtDate(other.start, 'medium')}` }),
            ]),
            el('button', {
              class: 'cx-btn icon mini ghost',
              title: 'Remove',
              'aria-label': 'Remove dependency',
              html: icon('unlink', { size: 12 }),
              onClick: () => {
                store.removeLinks([link.id]);
                renderer.requestRender();
                refresh();
              },
            }),
          ])
        );
      }
    }

    const candidates = store.getDoc().objects.filter((o) => o.id !== obj.id);
    const picker = selectInput({
      value: '',
      placeholder: 'Add a successor…',
      options: candidates.map((o) => ({ value: o.id, label: `${o.title} (${fmtDate(o.start, 'compact')})` })),
      onChange: (v) => {
        if (!v) return;
        const created = store.addLink({ from: obj.id, to: v, type: 'FS' });
        if (!created) toast({ tone: 'warn', title: 'Not linked', message: 'That link exists already or would create a loop.' });
        renderer.requestRender();
        refresh();
        picker.value = '';
      },
    });

    refresh();
    pane.append(list, field('Add dependency', picker, 'Creates a finish-to-start link. Change the type in the inspector.'));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Lane editor
     ═══════════════════════════════════════════════════════════════════════ */

  function openLaneDialog(id) {
    const lane = store.getLane(id);
    if (!lane) return;
    const set = (patch, label) => {
      store.updateLane(id, patch, label || 'Edit lane');
      renderer.requestRender();
    };

    openModal({
      title: `Lane — ${lane.name}`,
      body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } }, [
        field('Name', textInput({ value: lane.name, onInput: (v) => set({ name: v }, 'Rename lane') })),
        field('Description', textInput({ value: lane.description, placeholder: 'Optional', onInput: (v) => set({ description: v }, 'Edit lane description') })),
        el('div', { class: 'cx-row' }, [
          field('Colour', el('input', {
            class: 'cx-color',
            type: 'color',
            value: lane.color,
            onInput: (e) => set({ color: e.target.value }, 'Change lane colour'),
          })),
          field('Height (px)', numberInput({ value: lane.height, min: 28, max: 480, step: 4, onChange: (v) => set({ height: v }, 'Resize lane') })),
        ]),
        field('Group', textInput({ value: lane.group, placeholder: 'Optional grouping label', onInput: (v) => set({ group: v }, 'Change lane group') })),
      ]),
      actions: [{ label: 'Done', kind: 'primary' }],
    });
  }

  Object.defineProperty(__x, "openObjectDialog", { get: () => openObjectDialog, enumerable: true });
  Object.defineProperty(__x, "openLaneDialog", { get: () => openLaneDialog, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// io/scene.js
// ════════════════════════════════════════════════════════════════════════
__mods["io/scene.js"] = function (__x, __req) {
  /**
   * Export scene builder.
   *
   * Produces a backend-independent list of drawing primitives (rectangles,
   * lines, text, polygons, paths) describing the whole plan at a chosen
   * density. Both the SVG writer and the PDF writer consume this, which is why
   * an exported PDF and an exported SVG are pixel-for-pixel the same drawing
   * rather than two independent re-implementations of the timeline.
   *
   * Colours are resolved to concrete hex here — no CSS custom properties leave
   * this module, because neither an SVG file opened standalone nor a PDF has
   * any way to resolve them.
   *
   * Imports: util, dates, model, analysis.
   */

  const { clamp, withAlpha, readableInk } = __req("core/util.js");
  const { MS_DAY, ticks, fmtDate, toISO, startOfDay, addDays } = __req("core/dates.js");
  const { TYPES, statusOf, objectColor, effectiveToday, projectExtent, LINK_TYPES, durationDays } = __req("core/model.js");
  const { criticalPath } = __req("core/analysis.js");
  const { fontString, textWidth, wrapText, fitWidth } = __req("timeline/text.js");

  /** Layout constants for exported drawings, in points/pixels. */
  const M = {
    gutter: 168,
    rulerUpper: 22,
    rulerLower: 22,
    headerH: 62,
    lanePadY: 6,
    rowH: 20,
    rowGap: 4,
    barMinW: 3,
    pointR: 7,
    footerH: 26,
    labelPadX: 5,
    outsideGap: 5,
    outsideMaxW: 210,
    minInsideW: 44,
  };

  /* Fonts used by exported drawings, measured the same way the canvas is. */
  const EXPORT_FONTS = {
    title: fontString({ size: 8.5, weight: 600 }),
    titleBold: fontString({ size: 8.5, weight: 700 }),
    sub: fontString({ size: 7, weight: 400 }),
    lane: fontString({ size: 9.5, weight: 600 }),
  };
  const EXPORT_LINE_H = 10;
  const EXPORT_SUB_LINE_H = 8.5;

  /**
   * Where an exported object's label goes, and the room it needs.
   *
   * Mirrors the on-screen rule exactly — inside when the text fits, beside the
   * bar when it does not, centred under a point glyph — so a printed plan reads
   * the same as the screen and, like the screen, never truncates a label.
   */
  function exportLabel(obj, barWidth) {
    const def = TYPES[obj.type] || TYPES.activity;
    const title = String(obj.title || '');
    const subtitle = String(obj.subtitle || '').trim();
    const font = obj.style?.bold ? EXPORT_FONTS.titleBold : EXPORT_FONTS.title;

    const build = (width, placement) => {
      const t = wrapText(title, width, font, { lineHeight: EXPORT_LINE_H });
      const sub = subtitle ? wrapText(subtitle, width, EXPORT_FONTS.sub, { lineHeight: EXPORT_SUB_LINE_H }) : null;
      return {
        placement,
        lines: t.lines,
        subLines: sub ? sub.lines : [],
        width: Math.ceil(Math.max(t.width, sub ? sub.width : 0)),
        height: t.lines.length * EXPORT_LINE_H + (sub ? sub.lines.length * EXPORT_SUB_LINE_H : 0),
      };
    };

    if (!def.duration) {
      const fitted = fitWidth(title, font, { maxWidth: 150, maxLines: 3, minWidth: 34 });
      const label = build(fitted.width, def.shape === 'release' ? 'above' : 'below');
      label.extraLeft = label.width / 2 + 3;
      label.extraRight = label.width / 2 + 3;
      label.extraVert = label.height + 4;
      return label;
    }

    const inner = barWidth - M.labelPadX * 2;
    if (inner >= M.minInsideW) {
      const label = build(inner, 'inside');
      if (label.lines.length + label.subLines.length <= 3) {
        label.extraLeft = 0;
        label.extraRight = 0;
        label.extraVert = 0;
        return label;
      }
    }

    const fitted = fitWidth(title, font, { maxWidth: M.outsideMaxW, maxLines: 3, minWidth: 60 });
    const label = build(fitted.width, 'outside');
    label.extraLeft = 0;
    label.extraRight = label.width + M.outsideGap + 3;
    label.extraVert = 0;
    return label;
  }

  /**
   * Resolve the palette for an export. Themes live in CSS, so we read the
   * computed values off the document once and hand concrete colours downstream.
   */
  function resolvePalette(overrides = {}) {
    const read = (name, fallback) => {
      try {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallback;
      } catch {
        return fallback;
      }
    };

    const palette = {
      bg: read('--canvas-bg', '#ffffff'),
      surface: read('--surface', '#ffffff'),
      surface2: read('--surface-2', '#f7f8fa'),
      chrome: read('--chrome-bg', '#ffffff'),
      text: read('--text', '#111827'),
      textMuted: read('--text-muted', '#6b7280'),
      textSubtle: read('--text-subtle', '#9ca3af'),
      border: read('--border-strong', '#d8d8d8'),
      grid: read('--grid-line', '#eceef2'),
      gridMajor: read('--grid-line-major', '#d6dae1'),
      weekend: read('--grid-weekend', '#f4f5f7'),
      today: read('--today-line', '#e60012'),
      connector: read('--connector', '#8b93a3'),
      bad: read('--bad', '#c01017'),
      good: read('--good', '#0d7a4f'),
      warn: read('--warn', '#a8550a'),
      info: read('--info', '#1d4eaf'),
      brand: read('--hitachi-red', '#e60012'),
    };

    return { ...palette, ...overrides };
  }

  /** Resolve a colour that may be a `var(--x)` reference. */
  function solid(color, palette, fallback = '#5b93f5') {
    if (!color) return fallback;
    const value = String(color);
    if (!value.startsWith('var(')) return value;
    const name = value.slice(4, -1).trim();
    try {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return resolved || fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Build the scene.
   *
   * @param {object} doc
   * @param {object} opts
   * @param {number} [opts.pxPerDay]   Density; defaults to fitting `maxWidth`.
   * @param {number} [opts.maxWidth]   Target drawing width in points.
   * @param {[number,number]} [opts.range] Explicit [startMs, endMs].
   * @param {boolean} [opts.showGrid]
   * @param {boolean} [opts.showLinks]
   * @param {boolean} [opts.showToday]
   * @param {boolean} [opts.showLegend]
   * @param {Function} [opts.filter]   Object predicate.
   * @param {object} [opts.palette]
   * @returns {{width:number, height:number, items:Array, meta:object}}
   */
  function buildScene(doc, opts = {}) {
    const palette = opts.palette || resolvePalette();
    const filter = opts.filter || null;

    const extent = opts.range ? { start: opts.range[0], end: opts.range[1] } : projectExtent(doc);
    const days = Math.max(1, (extent.end - extent.start) / MS_DAY);
    const maxWidth = opts.maxWidth || 2400;
    const pxPerDay = opts.pxPerDay || clamp((maxWidth - M.gutter - 24) / days, 0.2, 60);

    const items = [];
    const msToX = (ms) => M.gutter + ((ms - extent.start) / MS_DAY) * pxPerDay;

    /* ── Lane geometry ─────────────────────────────────────────────────── */
    const lanes = doc.laneOrder
      .map((id) => doc.lanes.find((l) => l.id === id))
      .filter((l) => l && !l.hidden);

    const laneGeom = [];
    let y = M.headerH + M.rulerUpper + M.rulerLower;
    const contentTop = y;

    for (const lane of lanes) {
      const objects = doc.objects
        .filter((o) => o.lane === lane.id && !o.hidden && (!filter || filter(o)))
        .sort((a, b) => a.start - b.start);

      const measured = objects.map((obj) => {
        const hasDuration = !!TYPES[obj.type]?.duration;
        const barWidth = hasDuration
          ? Math.max(M.barMinW, ((obj.end - obj.start) / MS_DAY) * pxPerDay)
          : M.pointR * 2;
        const label = exportLabel(obj, barWidth);
        const height = hasDuration
          ? Math.max(M.rowH, label.height + 5)
          : Math.max(M.rowH, M.pointR * 2 + label.extraVert);
        return { obj, label, barWidth, height };
      });

      const packed = packRowsForExport(measured, msToX);
      const rowHeights = new Array(packed.rows).fill(M.rowH);
      for (const item of measured) {
        const row = packed.assigned.get(item.obj.id) || 0;
        rowHeights[row] = Math.max(rowHeights[row], item.height);
      }
      const rowTops = [];
      let cursor = 0;
      for (let r = 0; r < packed.rows; r++) {
        rowTops.push(cursor);
        cursor += rowHeights[r] + M.rowGap;
      }

      const laneNameWrap = wrapText(lane.name || '', M.gutter - 24, EXPORT_FONTS.lane, { lineHeight: 11 });
      const height = Math.max(
        34,
        Math.max(M.rowH, cursor - M.rowGap) + M.lanePadY * 2,
        laneNameWrap.lines.length * 11 + 20
      );
      laneGeom.push({ lane, y, height, objects, measured, rows: packed.assigned, rowTops, laneNameWrap });
      y += height;
    }

    const contentHeight = y - contentTop;
    const width = M.gutter + days * pxPerDay + 24;
    const legendHeight = opts.showLegend === false ? 0 : legendRows(doc, filter).length * 15 + 30;
    const height = y + M.footerH + legendHeight;

    /* ── Background ────────────────────────────────────────────────────── */
    items.push({ type: 'rect', x: 0, y: 0, w: width, h: height, fill: palette.bg });

    /* ── Header ────────────────────────────────────────────────────────── */
    items.push({ type: 'rect', x: 0, y: 0, w: width, h: M.headerH, fill: palette.chrome });
    items.push({ type: 'rect', x: 20, y: 15, w: 4, h: 30, fill: palette.brand, radius: 2 });
    items.push({ type: 'text', x: 32, y: 28, text: doc.name || 'Untitled Programme', size: 15, weight: 700, fill: palette.text });
    items.push({
      type: 'text',
      x: 32,
      y: 44,
      text: [doc.client, doc.programme].filter(Boolean).join('  ·  ') || 'CX Timeline',
      size: 8.5,
      fill: palette.textSubtle,
      family: 'mono',
    });
    items.push({
      type: 'text',
      x: width - 20,
      y: 28,
      text: `${fmtDate(extent.start, 'medium')}  →  ${fmtDate(extent.end, 'medium')}`,
      size: 9,
      fill: palette.textMuted,
      anchor: 'end',
      family: 'mono',
    });
    items.push({
      type: 'text',
      x: width - 20,
      y: 44,
      text: `${doc.objects.length} objects · ${lanes.length} lanes · exported ${fmtDate(Date.now(), 'medium')}`,
      size: 8,
      fill: palette.textSubtle,
      anchor: 'end',
      family: 'mono',
    });
    items.push({ type: 'line', x1: 0, y1: M.headerH, x2: width, y2: M.headerH, stroke: palette.border, strokeWidth: 1 });

    /* ── Ruler ─────────────────────────────────────────────────────────── */
    const scaleId = pickScale(pxPerDay);
    const upperId = coarser(scaleId);
    const rulerTop = M.headerH;

    items.push({ type: 'rect', x: 0, y: rulerTop, w: width, h: M.rulerUpper + M.rulerLower, fill: palette.chrome });

    for (const tick of ticks(upperId, extent.start, extent.end, { weekStart: doc.settings.weekStart })) {
      const x = msToX(tick.start);
      if (x < M.gutter - 2) continue;
      items.push({ type: 'line', x1: x, y1: rulerTop, x2: x, y2: rulerTop + M.rulerUpper, stroke: palette.border, strokeWidth: 0.8 });
      items.push({
        type: 'text',
        x: x + 4,
        y: rulerTop + 15,
        text: upperId === 'month' || upperId === 'quarter' ? `${tick.label} ${tick.sub}` : tick.label,
        size: 8.5,
        weight: 700,
        fill: palette.textMuted,
        family: 'mono',
      });
    }

    const lowerTicks = ticks(scaleId, extent.start, extent.end, { weekStart: doc.settings.weekStart });
    const tickWidth = lowerTicks.length > 1 ? msToX(lowerTicks[1].start) - msToX(lowerTicks[0].start) : 40;
    // Label every Nth tick, sized from the measured widest label, so exported
    // ruler labels are spaced out rather than shortened.
    const tickFont = fontString({ size: 7.5, weight: 500, mono: true });
    const widestTick = lowerTicks.reduce((max, t) => Math.max(max, textWidth(t.label, tickFont)), 0);
    const labelStride = Math.max(1, Math.ceil((widestTick + 10) / Math.max(tickWidth, 1)));

    lowerTicks.forEach((tick, i) => {
      const x = msToX(tick.start);
      if (x < M.gutter - 2) return;
      const lineTop = rulerTop + M.rulerUpper;

      if (tick.weekend && scaleId === 'day' && doc.settings.showWeekends) {
        items.push({ type: 'rect', x, y: lineTop, w: Math.max(1, tickWidth), h: M.rulerLower + contentHeight, fill: palette.weekend });
      }
      items.push({ type: 'line', x1: x, y1: lineTop, x2: x, y2: lineTop + M.rulerLower, stroke: palette.grid, strokeWidth: 0.6 });
      if (i % labelStride === 0) {
        items.push({ type: 'text', x: x + 3, y: lineTop + 15, text: tick.label, size: 7.5, fill: palette.textSubtle, family: 'mono' });
      }
      if (opts.showGrid !== false) {
        items.push({
          type: 'line',
          x1: x,
          y1: contentTop,
          x2: x,
          y2: contentTop + contentHeight,
          stroke: tick.major ? palette.gridMajor : palette.grid,
          strokeWidth: tick.major ? 0.7 : 0.4,
        });
      }
    });

    items.push({ type: 'line', x1: 0, y1: contentTop, x2: width, y2: contentTop, stroke: palette.border, strokeWidth: 1 });

    /* ── Lanes ─────────────────────────────────────────────────────────── */
    items.push({ type: 'rect', x: 0, y: contentTop, w: M.gutter, h: contentHeight, fill: palette.chrome });

    const rectsById = new Map();

    laneGeom.forEach((entry, index) => {
      const laneColor = solid(entry.lane.color, palette);

      if (index % 2) {
        items.push({ type: 'rect', x: M.gutter, y: entry.y, w: width - M.gutter, h: entry.height, fill: withAlpha(palette.textSubtle, 0.035) });
      }
      items.push({ type: 'line', x1: 0, y1: entry.y + entry.height, x2: width, y2: entry.y + entry.height, stroke: palette.grid, strokeWidth: 0.6 });
      items.push({ type: 'rect', x: 0, y: entry.y, w: 3, h: entry.height, fill: laneColor });
      entry.laneNameWrap.lines.forEach((line, i) => {
        items.push({ type: 'text', x: 12, y: entry.y + 15 + i * 11, text: line, size: 9.5, weight: 600, fill: palette.text });
      });
      items.push({
        type: 'text',
        x: 12,
        y: entry.y + 16 + entry.laneNameWrap.lines.length * 11,
        text: `${entry.objects.length} item${entry.objects.length === 1 ? '' : 's'}`,
        size: 7,
        fill: palette.textSubtle,
        family: 'mono',
      });

      for (const item of entry.measured) {
        const row = entry.rows.get(item.obj.id) || 0;
        const top = entry.y + M.lanePadY + (entry.rowTops[row] ?? 0);
        const rect = drawObject(items, item, entry.lane, { top, msToX, palette, settings: doc.settings });
        if (rect) rectsById.set(item.obj.id, rect);
      }
    });

    /* ── Baseline comparison ───────────────────────────────────────────── */
    // Drawn after the objects so the ghosts and their arrows sit on top, and
    // only when the document is actually in comparison mode — an export is
    // supposed to be the drawing on the screen, not a different one.
    if (opts.showBaseline !== false && doc.settings.showBaseline) {
      drawBaseline(items, doc, { rectsById, laneGeom, msToX, palette });
    }

    items.push({ type: 'line', x1: M.gutter, y1: contentTop, x2: M.gutter, y2: contentTop + contentHeight, stroke: palette.border, strokeWidth: 1 });

    /* ── Dependencies ──────────────────────────────────────────────────── */
    if (opts.showLinks !== false && doc.settings.showConnectors) {
      const critical = doc.settings.criticalPath ? criticalPath(doc).critical : null;
      for (const link of doc.links) {
        const from = rectsById.get(link.from);
        const to = rectsById.get(link.to);
        if (!from || !to) continue;
        const spec = LINK_TYPES[link.type] || LINK_TYPES.FS;
        const a = { x: spec.from === 'end' ? from.right : from.x, y: from.cy };
        const b = { x: spec.to === 'start' ? to.x : to.right, y: to.cy };
        const isCritical = critical && critical.has(link.from) && critical.has(link.to);
        const stroke = isCritical ? palette.bad : solid(link.color, palette, palette.connector);

        const mid = (a.x + b.x) / 2;
        const d =
          b.x > a.x + 12
            ? `M ${a.x} ${a.y} L ${a.x + 8} ${a.y} L ${mid} ${a.y} L ${mid} ${b.y} L ${b.x - 8} ${b.y} L ${b.x} ${b.y}`
            : `M ${a.x} ${a.y} L ${a.x + 8} ${a.y} L ${a.x + 8} ${from.bottom + 6} L ${b.x - 10} ${from.bottom + 6} L ${b.x - 10} ${b.y} L ${b.x} ${b.y}`;

        items.push({ type: 'path', d, stroke, strokeWidth: isCritical ? 1.4 : 0.9, fill: 'none' });
        items.push({
          type: 'polygon',
          points: [[b.x, b.y], [b.x - 5, b.y - 3], [b.x - 5, b.y + 3]],
          fill: stroke,
        });
      }
    }

    /* ── Today ─────────────────────────────────────────────────────────── */
    if (opts.showToday !== false && doc.settings.showToday) {
      const todayMs = effectiveToday(doc);
      const x = msToX(todayMs);
      if (x >= M.gutter && x <= width) {
        items.push({ type: 'line', x1: x, y1: contentTop - M.rulerLower, x2: x, y2: contentTop + contentHeight, stroke: palette.today, strokeWidth: 1.6 });
        items.push({ type: 'rect', x: x - 24, y: contentTop - 15, w: 48, h: 13, fill: palette.today, radius: 2 });
        items.push({ type: 'text', x, y: contentTop - 5.5, text: 'TODAY', size: 7, weight: 700, fill: '#ffffff', anchor: 'middle', family: 'mono' });
      }
    }

    /* ── Legend ────────────────────────────────────────────────────────── */
    if (opts.showLegend !== false) {
      const rows = legendRows(doc, filter);
      let ly = y + 18;
      items.push({ type: 'line', x1: 0, y1: y + 4, x2: width, y2: y + 4, stroke: palette.border, strokeWidth: 0.8 });
      items.push({ type: 'text', x: 20, y: ly, text: 'LEGEND', size: 8, weight: 700, fill: palette.textSubtle, family: 'mono' });
      ly += 14;
      for (const row of rows) {
        items.push({ type: 'rect', x: 20, y: ly - 7, w: 9, h: 9, fill: solid(row.color, palette), radius: 2 });
        items.push({ type: 'text', x: 34, y: ly, text: `${row.label}  (${row.count})`, size: 8, fill: palette.textMuted });
        ly += 15;
      }
    }

    /* ── Footer ────────────────────────────────────────────────────────── */
    items.push({
      type: 'text',
      x: 20,
      y: height - 10,
      text: `CX Timeline · ${doc.name} · ${toISO(Date.now())}`,
      size: 7,
      fill: palette.textSubtle,
      family: 'mono',
    });

    return {
      width: Math.ceil(width),
      height: Math.ceil(height),
      items,
      meta: { extent, pxPerDay, gutter: M.gutter, contentTop, contentHeight, palette, scaleId },
    };
  }

  /* ── Object drawing ────────────────────────────────────────────────────── */

  /**
   * Draw one object plus its label.
   *
   * The label was measured and placed by `exportLabel`; this only prints the
   * lines it was given, so nothing is shortened on the way to paper.
   */
  function drawObject(items, measured, lane, { top, msToX, palette, settings }) {
    const { obj, label, barWidth } = measured;
    const def = TYPES[obj.type] || TYPES.activity;
    const color = solid(objectColor(obj, lane), palette);
    const style = obj.style || {};
    const opacity = style.opacity ?? 1;

    /** Print a wrapped block from a given baseline. */
    const printBlock = (x, baseline, ink, anchor) => {
      let y = baseline;
      for (const line of label.lines) {
        items.push({
          type: 'text',
          x,
          y,
          text: line,
          size: 8.5,
          weight: style.bold ? 700 : 600,
          fill: ink,
          anchor,
          opacity,
        });
        y += EXPORT_LINE_H;
      }
      for (const line of label.subLines) {
        items.push({ type: 'text', x, y, text: line, size: 7, fill: ink, anchor, opacity: opacity * 0.8 });
        y += EXPORT_SUB_LINE_H;
      }
    };

    if (def.duration) {
      const x = msToX(obj.start);
      const isBand = def.shape === 'band' || def.shape === 'container';
      const h = label.placement === 'inside' ? Math.max(M.rowH, label.height + 5) : M.rowH;
      const w = Math.max(M.barMinW, barWidth);
      const radius = Math.min(style.radius ?? 4, h / 2);

      items.push({
        type: 'rect',
        x,
        y: top,
        w,
        h,
        fill: isBand ? withAlpha(color, 0.18) : color,
        stroke: isBand ? color : withAlpha(color, 0.7),
        strokeWidth: style.strokeWidth ?? 0.8,
        radius,
        opacity,
        dash: isBand ? [4, 3] : null,
      });

      if (settings.showProgress && def.progress && obj.progress > 0) {
        const pw = (w * clamp(obj.progress, 0, 100)) / 100;
        items.push({ type: 'rect', x, y: top, w: pw, h, fill: withAlpha('#ffffff', 0.3), radius, opacity });
      }

      if (label.placement === 'inside') {
        const ink = style.textColor || (isBand ? color : readableInk(color));
        const blockH = label.lines.length * EXPORT_LINE_H + label.subLines.length * EXPORT_SUB_LINE_H;
        printBlock(x + M.labelPadX, top + (h - blockH) / 2 + 7, ink, 'start');
      } else {
        // Too narrow to hold the text: the full label sits beside the bar, in
        // space the packer already reserved for it.
        const blockH = label.lines.length * EXPORT_LINE_H + label.subLines.length * EXPORT_SUB_LINE_H;
        printBlock(x + w + M.outsideGap, top + (h - blockH) / 2 + 7, palette.text, 'start');
      }

      return { x, right: x + w, cy: top + h / 2, bottom: top + h, top };
    }

    /* Point objects: milestone diamond, release flag, risk/issue pin. */
    const cx = msToX(obj.start);
    const glyphTop = label.placement === 'above' ? top + label.extraVert : top;
    const cy = glyphTop + M.pointR;
    const r = M.pointR;

    if (def.shape === 'release') {
      const statusColor = solid(style.fill || statusOf(obj.status).color, palette);
      items.push({ type: 'rect', x: cx - 1, y: glyphTop, w: 2, h: r * 2, fill: statusColor });
      const chip = obj.data?.version ? `v${obj.data.version}` : '';
      if (chip) {
        const chipW = textWidth(chip, EXPORT_FONTS.title) + 10;
        items.push({ type: 'rect', x: cx - chipW / 2, y: cy - 7, w: chipW, h: 14, fill: withAlpha(statusColor, 0.2), stroke: statusColor, strokeWidth: 0.8, radius: 3 });
        items.push({ type: 'text', x: cx, y: cy + 3.2, text: chip, size: 7.5, weight: 700, fill: statusColor, anchor: 'middle', family: 'mono' });
      }
      printBlock(cx, top + 8, palette.text, 'middle');
    } else if (def.shape === 'diamond') {
      items.push({
        type: 'polygon',
        points: [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]],
        fill: color,
        stroke: withAlpha(color, 0.9),
        strokeWidth: 0.8,
      });
      printBlock(cx, cy + r + 8, palette.text, 'middle');
    } else {
      const severity = obj.data?.severity;
      const pinColor = severity === 'critical' || severity === 'high' ? palette.bad : color;
      items.push({ type: 'circle', cx, cy, r: r - 1, fill: pinColor, stroke: withAlpha(pinColor, 0.9), strokeWidth: 0.8 });
      printBlock(cx, cy + r + 8, palette.text, 'middle');
    }

    return { x: cx - r, right: cx + r, cy, bottom: glyphTop + r * 2, top: glyphTop };
  }

  /* ── Helpers ───────────────────────────────────────────────────────────── */

  /**
   * First-fit row packing over the *label* extent, not just the bar, so an
   * exported label can never be overprinted by the next object along.
   */
  function packRowsForExport(measured, msToX) {
    const rowEnds = [];
    const assigned = new Map();

    for (const item of measured) {
      const hasDuration = !!TYPES[item.obj.type]?.duration;
      const startX = msToX(item.obj.start);
      const from = (hasDuration ? startX : startX - M.pointR) - item.label.extraLeft;
      const to = (hasDuration ? startX + item.barWidth : startX + M.pointR) + item.label.extraRight;

      let row = 0;
      while (row < rowEnds.length && (rowEnds[row] ?? -Infinity) > from) row++;
      rowEnds[row] = to + 5;
      assigned.set(item.obj.id, row);
    }

    return { assigned, rows: Math.max(1, rowEnds.length) };
  }

  function pickScale(pxPerDay) {
    if (pxPerDay >= 22) return 'day';
    if (pxPerDay >= 4.5) return 'week';
    if (pxPerDay >= 1.3) return 'month';
    if (pxPerDay >= 0.5) return 'quarter';
    return 'year';
  }

  function coarser(id) {
    const order = ['day', 'week', 'month', 'quarter', 'year'];
    const i = order.indexOf(id);
    return order[Math.min(order.length - 1, i + 1)];
  }

  /**
   * Where the plan was, in the export.
   *
   * The canvas draws this too; without it here, a comparison taken into a
   * meeting as a PDF would show the current dates and no sign that anything had
   * moved — which is the one thing the reader is there to see.
   */
  function drawBaseline(items, doc, { rectsById, laneGeom, msToX, palette }) {
    const baseline = (doc.baselines || []).find((b) => b.id === doc.settings.activeBaseline);
    if (!baseline) return;

    const seen = new Set();

    for (const snap of baseline.snapshot) {
      const rect = rectsById.get(snap.id);
      if (!rect) continue;
      seen.add(snap.id);

      const obj = doc.objects.find((o) => o.id === snap.id);
      if (!obj) continue;

      const hasDuration = !!TYPES[obj.type]?.duration;
      const startShift = Math.round((obj.start - snap.start) / MS_DAY);
      const endShift = hasDuration ? Math.round((obj.end - (snap.end ?? snap.start)) / MS_DAY) : startShift;
      if (!startShift && !endShift) continue;

      const ink = endShift > 0 ? palette.bad : endShift < 0 ? palette.good : palette.warn;
      const gx = msToX(snap.start);
      const gw = hasDuration ? Math.max(3, msToX(snap.end ?? snap.start) - gx) : 8;

      items.push({
        type: 'rect',
        x: hasDuration ? gx : gx - 4,
        y: rect.top,
        w: gw,
        h: Math.max(6, rect.bottom - rect.top),
        radius: 3,
        fill: withAlpha(ink, 0.12),
        stroke: ink,
        strokeWidth: 0.8,
        dash: [3, 2],
      });

      // The arrow between the two finish edges, with its day count.
      const reshaped = endShift === 0;
      const fromX = reshaped ? gx : gx + gw;
      const toX = reshaped ? rect.x : rect.right;
      const shift = reshaped ? startShift : endShift;
      const y = rect.cy;
      if (Math.abs(toX - fromX) > 1) {
        const dir = toX >= fromX ? 1 : -1;
        items.push({ type: 'line', x1: fromX, y1: y, x2: toX, y2: y, stroke: ink, strokeWidth: 1.1 });
        items.push({
          type: 'polygon',
          points: [[toX, y], [toX - 4 * dir, y - 2.6], [toX - 4 * dir, y + 2.6]],
          fill: ink,
        });
        items.push({
          type: 'text',
          x: (fromX + toX) / 2,
          y: y - 4,
          text: `${shift > 0 ? '+' : '\u2212'}${Math.abs(shift)}d`,
          size: 6.5,
          weight: 700,
          family: 'mono',
          fill: ink,
          anchor: 'middle',
        });
      }
    }

    // Objects the baseline had and the plan no longer does.
    for (const snap of baseline.snapshot) {
      if (seen.has(snap.id) || doc.objects.some((o) => o.id === snap.id)) continue;
      const entry = laneGeom.find((g) => g.lane.id === snap.lane) || laneGeom[0];
      if (!entry) continue;

      const x = msToX(snap.start);
      const w = Math.max(8, msToX(snap.end ?? snap.start) - x);
      items.push({
        type: 'rect',
        x,
        y: entry.y + M.lanePadY,
        w,
        h: 14,
        radius: 3,
        fill: withAlpha(palette.bad, 0.08),
        stroke: palette.bad,
        strokeWidth: 0.8,
        dash: [3, 2],
      });
      items.push({
        type: 'text',
        x: x + 4,
        y: entry.y + M.lanePadY + 10,
        text: snap.title,
        size: 6.5,
        family: 'mono',
        fill: palette.bad,
      });
    }
  }

  function legendRows(doc, filter) {
    const counts = new Map();
    for (const obj of doc.objects) {
      if (obj.hidden || (filter && !filter(obj))) continue;
      counts.set(obj.type, (counts.get(obj.type) || 0) + 1);
    }
    return Array.from(counts, ([type, count]) => ({
      label: TYPES[type]?.label || type,
      color: TYPES[type]?.accent || 'var(--type-activity)',
      count,
    })).sort((a, b) => b.count - a.count);
  }

  const SCENE_METRICS = M;

  Object.defineProperty(__x, "resolvePalette", { get: () => resolvePalette, enumerable: true });
  Object.defineProperty(__x, "buildScene", { get: () => buildScene, enumerable: true });
  Object.defineProperty(__x, "SCENE_METRICS", { get: () => SCENE_METRICS, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// io/svg.js
// ════════════════════════════════════════════════════════════════════════
__mods["io/svg.js"] = function (__x, __req) {
  /**
   * SVG backend for the export scene.
   *
   * Emits a standalone, self-contained SVG document: no external fonts, no CSS
   * variables, nothing that depends on the application being present. The file
   * opens correctly in a browser, Illustrator, Inkscape or Visio, and is also
   * the source the PNG/JPEG rasteriser draws from.
   *
   * Imports: scene (for metrics only).
   */

  const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
  }

  function num(n) {
    return Math.round(n * 100) / 100;
  }

  const FONT_STACKS = {
    ui: "Archivo, 'Segoe UI', system-ui, -apple-system, sans-serif",
    mono: "'Roboto Mono', 'SF Mono', Consolas, monospace",
  };

  /**
   * Render a scene to SVG markup.
   * @param {{width:number, height:number, items:Array}} scene
   * @param {{title?:string, description?:string}} [opts]
   */
  function sceneToSvg(scene, opts = {}) {
    const parts = [];

    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
        `width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" ` +
        `font-family="${esc(FONT_STACKS.ui)}">`
    );
    if (opts.title) parts.push(`<title>${esc(opts.title)}</title>`);
    if (opts.description) parts.push(`<desc>${esc(opts.description)}</desc>`);

    for (const item of scene.items) {
      parts.push(renderItem(item));
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  function renderItem(item) {
    const opacity = item.opacity != null && item.opacity !== 1 ? ` opacity="${num(item.opacity)}"` : '';

    switch (item.type) {
      case 'rect': {
        const radius = item.radius ? ` rx="${num(item.radius)}" ry="${num(item.radius)}"` : '';
        const stroke = item.stroke ? ` stroke="${esc(item.stroke)}" stroke-width="${num(item.strokeWidth || 1)}"` : '';
        const dash = item.dash ? ` stroke-dasharray="${item.dash.join(' ')}"` : '';
        return `<rect x="${num(item.x)}" y="${num(item.y)}" width="${num(Math.max(0, item.w))}" height="${num(Math.max(0, item.h))}"${radius} fill="${esc(item.fill || 'none')}"${stroke}${dash}${opacity}/>`;
      }

      case 'line': {
        const dash = item.dash ? ` stroke-dasharray="${item.dash.join(' ')}"` : '';
        return `<line x1="${num(item.x1)}" y1="${num(item.y1)}" x2="${num(item.x2)}" y2="${num(item.y2)}" stroke="${esc(item.stroke || '#000')}" stroke-width="${num(item.strokeWidth || 1)}"${dash}${opacity}/>`;
      }

      case 'text': {
        const anchor = item.anchor && item.anchor !== 'start' ? ` text-anchor="${item.anchor}"` : '';
        const weight = item.weight ? ` font-weight="${item.weight}"` : '';
        const family = item.family === 'mono' ? ` font-family="${esc(FONT_STACKS.mono)}"` : '';
        const spacing = item.family === 'mono' ? ' letter-spacing="0.4"' : '';
        return `<text x="${num(item.x)}" y="${num(item.y)}" font-size="${num(item.size || 10)}" fill="${esc(item.fill || '#000')}"${weight}${anchor}${family}${spacing}${opacity}>${esc(item.text)}</text>`;
      }

      case 'circle': {
        const stroke = item.stroke ? ` stroke="${esc(item.stroke)}" stroke-width="${num(item.strokeWidth || 1)}"` : '';
        return `<circle cx="${num(item.cx)}" cy="${num(item.cy)}" r="${num(item.r)}" fill="${esc(item.fill || 'none')}"${stroke}${opacity}/>`;
      }

      case 'polygon': {
        const points = item.points.map((p) => `${num(p[0])},${num(p[1])}`).join(' ');
        const stroke = item.stroke ? ` stroke="${esc(item.stroke)}" stroke-width="${num(item.strokeWidth || 1)}"` : '';
        return `<polygon points="${points}" fill="${esc(item.fill || 'none')}"${stroke}${opacity}/>`;
      }

      case 'path': {
        const stroke = item.stroke ? ` stroke="${esc(item.stroke)}" stroke-width="${num(item.strokeWidth || 1)}"` : '';
        const dash = item.dash ? ` stroke-dasharray="${item.dash.join(' ')}"` : '';
        return `<path d="${esc(item.d)}" fill="${esc(item.fill || 'none')}"${stroke}${dash} stroke-linejoin="round" stroke-linecap="round"${opacity}/>`;
      }

      case 'image':
        return `<image x="${num(item.x)}" y="${num(item.y)}" width="${num(item.w)}" height="${num(item.h)}" xlink:href="${esc(item.href)}"${opacity}/>`;

      default:
        return '';
    }
  }

  /**
   * Rasterise SVG markup to a canvas, then to a Blob.
   *
   * The SVG is loaded through a blob: URL rather than a data: URL — Safari
   * refuses large data: URLs in <img>, and blob: has no length limit.
   *
   * @param {string} svg
   * @param {{scale?:number, type?:string, quality?:number, background?:string}} opts
   * @returns {Promise<Blob>}
   */
  function svgToRaster(svg, { scale = 2, type = 'image/png', quality = 0.94, background = null, width, height } = {}) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round((width || img.naturalWidth || 800) * scale);
          canvas.height = Math.round((height || img.naturalHeight || 600) * scale);
          const ctx = canvas.getContext('2d');

          // JPEG has no alpha channel; without a fill it renders transparent
          // pixels as black, which looks like a broken export.
          if (background || type === 'image/jpeg') {
            ctx.fillStyle = background || '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);

          canvas.toBlob(
            (out) => (out ? resolve(out) : reject(new Error('Canvas produced no image data'))),
            type,
            quality
          );
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('The exported SVG could not be rasterised.'));
      };

      img.src = url;
    });
  }

  Object.defineProperty(__x, "sceneToSvg", { get: () => sceneToSvg, enumerable: true });
  Object.defineProperty(__x, "svgToRaster", { get: () => svgToRaster, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// io/pdf.js
// ════════════════════════════════════════════════════════════════════════
__mods["io/pdf.js"] = function (__x, __req) {
  /**
   * PDF backend — a minimal, dependency-free PDF 1.4 writer.
   *
   * Why hand-rolled rather than a library: the drawing this app produces is
   * rectangles, lines, polygons and text, which maps one-to-one onto PDF's own
   * primitives. Writing them directly gives a true vector PDF — selectable
   * text, infinite zoom, a few hundred kilobytes — with no megabyte dependency
   * vendored into a local-first app, and no CDN to be offline from.
   *
   * The writer supports the base-14 fonts (no embedding needed), landscape
   * pages, and horizontal tiling so a multi-year programme spills across pages
   * with the lane gutter repeated on each one.
   *
   * Imports: dates (for the footer stamp).
   */

  const { fmtDate } = __req("core/dates.js");

  /* ── Page sizes in PostScript points (1/72") ───────────────────────────── */
  const PAGE_SIZES = {
    a4: { w: 841.89, h: 595.28, label: 'A4 landscape' },
    a3: { w: 1190.55, h: 841.89, label: 'A3 landscape' },
    a2: { w: 1683.78, h: 1190.55, label: 'A2 landscape' },
    letter: { w: 792, h: 612, label: 'US Letter landscape' },
    tabloid: { w: 1224, h: 792, label: 'US Tabloid landscape' },
  };

  /* ── Base-14 font metrics (widths per 1000 units, ASCII 32–126) ────────── */
  const W_HELVETICA = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const W_HELVETICA_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

  const FONTS = {
    F1: { name: 'Helvetica', widths: W_HELVETICA },
    F2: { name: 'Helvetica-Bold', widths: W_HELVETICA_BOLD },
    F3: { name: 'Courier', widths: null }, // fixed pitch, 600/1000
    F4: { name: 'Courier-Bold', widths: null },
  };

  /** Width of a string at a given size, in points. */
  function textWidth(text, size, fontKey = 'F1') {
    const font = FONTS[fontKey] || FONTS.F1;
    let units = 0;
    for (const ch of String(text)) {
      const code = ch.charCodeAt(0);
      if (!font.widths) {
        units += 600;
      } else if (code >= 32 && code <= 126) {
        units += font.widths[code - 32];
      } else {
        units += 556; // reasonable stand-in for anything outside the table
      }
    }
    return (units / 1000) * size;
  }

  /* ── Content-stream builder ────────────────────────────────────────────── */

  class Content {
    constructor() {
      this.ops = [];
      this.fill = null;
      this.stroke = null;
      this.lineWidth = null;
      this.dash = null;
    }

    push(op) {
      this.ops.push(op);
      return this;
    }

    save() {
      return this.push('q');
    }

    restore() {
      // Graphics state is restored wholesale, so our cached values are stale.
      this.fill = this.stroke = this.lineWidth = this.dash = null;
      return this.push('Q');
    }

    setFill(color) {
      const rgb = toRgb(color);
      if (!rgb) return this;
      const key = rgb.join(',');
      if (this.fill === key) return this;
      this.fill = key;
      return this.push(`${fmt(rgb[0])} ${fmt(rgb[1])} ${fmt(rgb[2])} rg`);
    }

    setStroke(color) {
      const rgb = toRgb(color);
      if (!rgb) return this;
      const key = rgb.join(',');
      if (this.stroke === key) return this;
      this.stroke = key;
      return this.push(`${fmt(rgb[0])} ${fmt(rgb[1])} ${fmt(rgb[2])} RG`);
    }

    setLineWidth(w) {
      if (this.lineWidth === w) return this;
      this.lineWidth = w;
      return this.push(`${fmt(w)} w`);
    }

    setDash(pattern) {
      const key = pattern ? pattern.join(' ') : '';
      if (this.dash === key) return this;
      this.dash = key;
      return this.push(pattern ? `[${pattern.map(fmt).join(' ')}] 0 d` : '[] 0 d');
    }

    setAlpha(alpha, page) {
      // Constant alpha needs an ExtGState resource; the page collects them.
      if (alpha == null || alpha >= 1) return this;
      const name = page.gsFor(alpha);
      return this.push(`/${name} gs`);
    }

    rect(x, y, w, h) {
      return this.push(`${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re`);
    }

    /** Rounded rectangle via four Bézier corners. */
    roundRect(x, y, w, h, r) {
      const radius = Math.max(0, Math.min(r, w / 2, h / 2));
      if (radius <= 0.4) return this.rect(x, y, w, h);
      const k = radius * 0.5523;
      return this.push(`${fmt(x + radius)} ${fmt(y)} m`)
        .push(`${fmt(x + w - radius)} ${fmt(y)} l`)
        .push(`${fmt(x + w - radius + k)} ${fmt(y)} ${fmt(x + w)} ${fmt(y + radius - k)} ${fmt(x + w)} ${fmt(y + radius)} c`)
        .push(`${fmt(x + w)} ${fmt(y + h - radius)} l`)
        .push(`${fmt(x + w)} ${fmt(y + h - radius + k)} ${fmt(x + w - radius + k)} ${fmt(y + h)} ${fmt(x + w - radius)} ${fmt(y + h)} c`)
        .push(`${fmt(x + radius)} ${fmt(y + h)} l`)
        .push(`${fmt(x + radius - k)} ${fmt(y + h)} ${fmt(x)} ${fmt(y + h - radius + k)} ${fmt(x)} ${fmt(y + h - radius)} c`)
        .push(`${fmt(x)} ${fmt(y + radius)} l`)
        .push(`${fmt(x)} ${fmt(y + radius - k)} ${fmt(x + radius - k)} ${fmt(y)} ${fmt(x + radius)} ${fmt(y)} c`)
        .push('h');
    }

    circle(cx, cy, r) {
      const k = r * 0.5523;
      return this.push(`${fmt(cx + r)} ${fmt(cy)} m`)
        .push(`${fmt(cx + r)} ${fmt(cy + k)} ${fmt(cx + k)} ${fmt(cy + r)} ${fmt(cx)} ${fmt(cy + r)} c`)
        .push(`${fmt(cx - k)} ${fmt(cy + r)} ${fmt(cx - r)} ${fmt(cy + k)} ${fmt(cx - r)} ${fmt(cy)} c`)
        .push(`${fmt(cx - r)} ${fmt(cy - k)} ${fmt(cx - k)} ${fmt(cy - r)} ${fmt(cx)} ${fmt(cy - r)} c`)
        .push(`${fmt(cx + k)} ${fmt(cy - r)} ${fmt(cx + r)} ${fmt(cy - k)} ${fmt(cx + r)} ${fmt(cy)} c`)
        .push('h');
    }

    moveTo(x, y) {
      return this.push(`${fmt(x)} ${fmt(y)} m`);
    }

    lineTo(x, y) {
      return this.push(`${fmt(x)} ${fmt(y)} l`);
    }

    text(x, y, string, { size = 9, font = 'F1' } = {}) {
      return this.push('BT')
        .push(`/${font} ${fmt(size)} Tf`)
        .push(`${fmt(x)} ${fmt(y)} Td`)
        .push(`(${escapeText(string)}) Tj`)
        .push('ET');
    }

    clip(x, y, w, h) {
      return this.rect(x, y, w, h).push('W').push('n');
    }

    toString() {
      return this.ops.join('\n');
    }
  }

  function fmt(n) {
    if (!Number.isFinite(n)) return '0';
    return (Math.round(n * 1000) / 1000).toString();
  }

  /** '#rrggbb' | 'rgba(...)' | 'rgb(...)' → [r,g,b] in 0..1, or null. */
  function toRgb(color) {
    if (!color || color === 'none') return null;
    const value = String(color).trim();

    if (value.startsWith('#')) {
      let hex = value.slice(1);
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      if (hex.length === 8) hex = hex.slice(0, 6);
      if (hex.length !== 6) return null;
      return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255];
    }

    const match = /rgba?\(([^)]+)\)/i.exec(value);
    if (match) {
      const parts = match[1].split(',').map((p) => parseFloat(p));
      if (parts.length >= 3) return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
    }
    return null;
  }

  /** Opacity carried by an rgba() colour, or 1. */
  function alphaOf(color) {
    const match = /rgba\(([^)]+)\)/i.exec(String(color || ''));
    if (!match) return 1;
    const parts = match[1].split(',').map((p) => parseFloat(p));
    return parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1;
  }

  /** Escape a string for a PDF literal, folding to WinAnsi-safe characters. */
  function escapeText(text) {
    return String(text == null ? '' : text)
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/→/g, '->')
      .replace(/·/g, '-')
      .replace(/…/g, '...')
      .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  /* ── Page ──────────────────────────────────────────────────────────────── */

  class Page {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.content = new Content();
      this.gsStates = new Map(); // alpha -> resource name
    }

    gsFor(alpha) {
      const key = Math.round(alpha * 100) / 100;
      if (!this.gsStates.has(key)) this.gsStates.set(key, `GS${this.gsStates.size}`);
      return this.gsStates.get(key);
    }

    /** Scene y (top-down) → PDF y (bottom-up). */
    flip(y) {
      return this.height - y;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Scene → PDF
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Render an export scene to PDF bytes.
   *
   * @param {object} scene   From `buildScene()`.
   * @param {object} opts
   * @param {string} [opts.pageSize]  Key of PAGE_SIZES.
   * @param {number} [opts.margin]
   * @param {string} [opts.title]
   * @param {string} [opts.subtitle]
   * @param {boolean} [opts.multiPage] Tile horizontally when the plan is wide.
   * @returns {Blob}
   */
  function sceneToPdf(scene, opts = {}) {
    const size = PAGE_SIZES[opts.pageSize] || PAGE_SIZES.a3;
    const margin = opts.margin ?? 26;
    const headerH = 34;
    const footerH = 18;

    const contentW = size.w - margin * 2;
    const contentH = size.h - margin * 2 - headerH - footerH;

    const gutter = scene.meta?.gutter ?? 168;
    const bodyTop = scene.meta?.contentTop != null ? scene.meta.contentTop - 44 : 62;
    const bodyHeight = Math.max(1, scene.height - bodyTop);

    // Fit the full lane stack vertically; allow modest upscaling on short plans.
    const scale = Math.min(contentH / bodyHeight, 1.6);
    const gutterW = gutter * scale;
    const laneW = Math.max(60, contentW - gutterW);
    const sceneSliceW = laneW / scale;

    const timelineSceneW = Math.max(1, scene.width - gutter);
    const pageCount = opts.multiPage === false ? 1 : Math.max(1, Math.ceil(timelineSceneW / sceneSliceW));

    const pages = [];

    for (let p = 0; p < pageCount; p++) {
      const page = new Page(size.w, size.h);
      const c = page.content;
      const offset = gutter + p * sceneSliceW;

      /* Page furniture */
      const palette = scene.meta?.palette || {};
      c.setFill(palette.bg || '#ffffff').rect(0, 0, size.w, size.h).push('f');

      c.setFill(palette.brand || '#e60012').rect(margin, page.flip(margin + 24), 3.5, 20).push('f');
      c.setFill(palette.text || '#111111').text(margin + 10, page.flip(margin + 12), opts.title || 'Timeline', { size: 12, font: 'F2' });
      if (opts.subtitle) {
        c.setFill(palette.textSubtle || '#888888').text(margin + 10, page.flip(margin + 24), opts.subtitle, { size: 7.5, font: 'F3' });
      }

      const stamp = `Page ${p + 1} of ${pageCount}`;
      c.setFill(palette.textSubtle || '#888888').text(
        size.w - margin - textWidth(stamp, 7.5, 'F3'),
        page.flip(margin + 12),
        stamp,
        { size: 7.5, font: 'F3' }
      );

      const footer = `CX Timeline  ·  exported ${fmtDate(Date.now(), 'medium')}`;
      c.setFill(palette.textSubtle || '#888888').text(margin, margin - 6 + 4, footer, { size: 6.5, font: 'F3' });

      const bodyY = margin + headerH; // scene-space top of the drawing area

      /* Lane gutter column — repeated on every page */
      c.save();
      c.clip(margin, page.flip(bodyY + contentH), gutterW, contentH);
      drawItems(c, page, scene.items, {
        scale,
        tx: margin,
        ty: bodyY,
        sceneOffsetX: 0,
        sceneOffsetY: bodyTop,
      });
      c.restore();

      /* Timeline column */
      c.save();
      c.clip(margin + gutterW, page.flip(bodyY + contentH), laneW, contentH);
      drawItems(c, page, scene.items, {
        scale,
        tx: margin + gutterW,
        ty: bodyY,
        sceneOffsetX: offset,
        sceneOffsetY: bodyTop,
        minSceneX: gutter,
      });
      c.restore();

      /* Column rule */
      c.setStroke(palette.border || '#cccccc').setLineWidth(0.6);
      c.moveTo(margin + gutterW, page.flip(bodyY)).lineTo(margin + gutterW, page.flip(bodyY + contentH)).push('S');

      pages.push(page);
    }

    return assemble(pages, opts);
  }

  /**
   * Emit scene items into a page's content stream under a transform.
   * `minSceneX` drops gutter-only furniture from the timeline column.
   */
  function drawItems(c, page, items, { scale, tx, ty, sceneOffsetX, sceneOffsetY, minSceneX = null }) {
    const X = (x) => tx + (x - sceneOffsetX) * scale;
    const Y = (y) => page.flip(ty + (y - sceneOffsetY) * scale);
    const S = (v) => v * scale;

    for (const item of items) {
      // Skip anything above the body region (page furniture handles the header).
      const topY = item.y ?? item.y1 ?? item.cy ?? 0;
      if (topY < sceneOffsetY - 24) continue;

      if (minSceneX != null) {
        const itemX = item.x ?? item.x1 ?? item.cx ?? 0;
        if (itemX < minSceneX - 4 && item.type !== 'rect') continue;
      }

      const alpha = Math.min(item.opacity ?? 1, alphaOf(item.fill));
      const needsAlpha = alpha < 1;
      if (needsAlpha) c.save().setAlpha(alpha, page);

      switch (item.type) {
        case 'rect': {
          if (!(item.w > 0 && item.h > 0)) break;
          const x = X(item.x);
          const y = Y(item.y + item.h);
          const w = S(item.w);
          const h = S(item.h);
          if (item.radius) c.roundRect(x, y, w, h, S(item.radius));
          else c.rect(x, y, w, h);
          paint(c, item);
          break;
        }

        case 'line': {
          if (!item.stroke) break;
          c.setStroke(item.stroke).setLineWidth(Math.max(0.25, S(item.strokeWidth || 1))).setDash(item.dash ? item.dash.map(S) : null);
          c.moveTo(X(item.x1), Y(item.y1)).lineTo(X(item.x2), Y(item.y2)).push('S');
          break;
        }

        case 'circle': {
          c.circle(X(item.cx), Y(item.cy), S(item.r));
          paint(c, item);
          break;
        }

        case 'polygon': {
          if (!item.points?.length) break;
          c.moveTo(X(item.points[0][0]), Y(item.points[0][1]));
          for (let i = 1; i < item.points.length; i++) c.lineTo(X(item.points[i][0]), Y(item.points[i][1]));
          c.push('h');
          paint(c, item);
          break;
        }

        case 'path': {
          emitPath(c, item.d, X, Y);
          paint(c, item);
          break;
        }

        case 'text': {
          const size = S(item.size || 9);
          if (size < 3.4) break; // below this the label is unreadable noise
          const font = item.family === 'mono' ? (item.weight >= 700 ? 'F4' : 'F3') : item.weight >= 600 ? 'F2' : 'F1';
          let x = X(item.x);
          if (item.anchor === 'middle') x -= textWidth(item.text, size, font) / 2;
          else if (item.anchor === 'end') x -= textWidth(item.text, size, font);
          c.setFill(item.fill || '#000000').text(x, Y(item.y), item.text, { size, font });
          break;
        }

        default:
          break;
      }

      if (needsAlpha) c.restore();
    }
  }

  function paint(c, item) {
    const hasFill = item.fill && item.fill !== 'none';
    const hasStroke = item.stroke && item.stroke !== 'none' && item.strokeWidth !== 0;
    if (hasFill) c.setFill(item.fill);
    if (hasStroke) c.setStroke(item.stroke).setLineWidth(Math.max(0.25, item.strokeWidth || 1));
    if (hasFill && hasStroke) c.push('B');
    else if (hasFill) c.push('f');
    else if (hasStroke) c.push('S');
    else c.push('n');
  }

  /** Translate the subset of SVG path syntax the scene emits into PDF operators. */
  function emitPath(c, d, X, Y) {
    const tokens = String(d).match(/[MLC]|-?\d*\.?\d+/gi) || [];
    let i = 0;
    let cmd = 'M';
    while (i < tokens.length) {
      const token = tokens[i];
      if (/[MLC]/i.test(token)) {
        cmd = token.toUpperCase();
        i++;
        continue;
      }
      if (cmd === 'M') {
        c.moveTo(X(+tokens[i]), Y(+tokens[i + 1]));
        i += 2;
        cmd = 'L'; // implicit lineto for subsequent pairs, as in SVG
      } else if (cmd === 'L') {
        c.lineTo(X(+tokens[i]), Y(+tokens[i + 1]));
        i += 2;
      } else if (cmd === 'C') {
        c.push(
          `${fmt(X(+tokens[i]))} ${fmt(Y(+tokens[i + 1]))} ${fmt(X(+tokens[i + 2]))} ${fmt(Y(+tokens[i + 3]))} ${fmt(X(+tokens[i + 4]))} ${fmt(Y(+tokens[i + 5]))} c`
        );
        i += 6;
      } else {
        i++;
      }
    }
  }

  /* ── File assembly ─────────────────────────────────────────────────────── */

  function assemble(pages, opts) {
    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length; // 1-based object number
    };

    // Reserve 1 = catalog, 2 = pages tree.
    objects.push(null, null);

    const fontRefs = {};
    for (const [key, font] of Object.entries(FONTS)) {
      fontRefs[key] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${font.name} /Encoding /WinAnsiEncoding >>`);
    }

    const pageRefs = [];
    for (const page of pages) {
      const stream = page.content.toString();
      const contentRef = add(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`);

      const gsEntries = Array.from(page.gsStates, ([alpha, name]) => {
        const ref = add(`<< /Type /ExtGState /ca ${alpha} /CA ${alpha} >>`);
        return `/${name} ${ref} 0 R`;
      }).join(' ');

      const resources =
        `<< /Font << ${Object.entries(fontRefs).map(([k, ref]) => `/${k} ${ref} 0 R`).join(' ')} >>` +
        (gsEntries ? ` /ExtGState << ${gsEntries} >>` : '') +
        ' >>';

      pageRefs.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(page.width)} ${fmt(page.height)}] /Resources ${resources} /Contents ${contentRef} 0 R >>`));
    }

    const infoRef = add(
      `<< /Title (${escapeText(opts.title || 'CX Timeline')}) /Author (${escapeText(opts.author || 'CX Timeline')}) ` +
        `/Creator (CX Timeline) /Producer (CX Timeline PDF writer) /CreationDate (${pdfDate(new Date())}) >>`
    );

    objects[0] = `<< /Type /Catalog /Pages 2 0 R >>`;
    objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;

    /* Serialise with a cross-reference table. */
    const chunks = [];
    let offset = 0;
    const offsets = [];

    const write = (text) => {
      chunks.push(text);
      offset += byteLength(text);
    };

    write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    objects.forEach((body, i) => {
      offsets[i] = offset;
      write(`${i + 1} 0 obj\n${body}\nendobj\n`);
    });

    const xrefOffset = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
    write(xref);
    write(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoRef} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    // Latin-1 keeps the byte offsets in the xref table honest.
    const bytes = new Uint8Array(offset);
    let cursor = 0;
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.length; i++) bytes[cursor++] = chunk.charCodeAt(i) & 0xff;
    }

    return new Blob([bytes], { type: 'application/pdf' });
  }

  function byteLength(text) {
    // Content is written as Latin-1, so one char is one byte.
    return text.length;
  }

  function pdfDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}Z`;
  }

  Object.defineProperty(__x, "PAGE_SIZES", { get: () => PAGE_SIZES, enumerable: true });
  Object.defineProperty(__x, "textWidth", { get: () => textWidth, enumerable: true });
  Object.defineProperty(__x, "sceneToPdf", { get: () => sceneToPdf, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// io/exporters.js
// ════════════════════════════════════════════════════════════════════════
__mods["io/exporters.js"] = function (__x, __req) {
  /**
   * Export orchestration.
   *
   * Every format is produced from the same source of truth — the live document
   * plus the active filters — so a CSV, an SVG and a PDF exported one after the
   * other always describe the same plan.
   *
   * Imports: util, dates, model, store, query, scene, svg, pdf, components.
   */

  const { download, slug, stripHtml } = __req("core/util.js");
  const { toISO, fmtDate } = __req("core/dates.js");
  const { TYPES, statusOf, subsystemOf, durationDays, projectExtent, effectiveToday, LINK_TYPES } = __req("core/model.js");
  const { getDoc, getFilters, hasActiveFilters, activeBaseline } = __req("core/store.js");
  const { filterPredicate } = __req("core/query.js");
  const { compareBaseline, criticalPath } = __req("core/analysis.js");
  const { buildScene, resolvePalette } = __req("io/scene.js");
  const { sceneToSvg, svgToRaster } = __req("io/svg.js");
  const { sceneToPdf, PAGE_SIZES } = __req("io/pdf.js");
  const { toast } = __req("ui/components.js");

  /** Filename stem shared by every export of the same project. */
  function stem(doc, suffix = '') {
    return `${slug(doc.name) || 'cx-timeline'}${suffix}-${toISO(Date.now())}`;
  }

  /** The predicate to apply — respects the filter panel unless told otherwise. */
  function predicateFor({ respectFilters = true } = {}) {
    if (!respectFilters || !hasActiveFilters()) return null;
    return filterPredicate(getDoc(), getFilters());
  }

  /* ══════════════════════════════════════════════════════════════════════════
     JSON — the project file
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Export the whole document. This is the canonical save format: importing it
   * restores the project exactly, including lanes, links, baselines and notes.
   * Attachment *bytes* stay in local storage; the records are exported so a
   * re-import knows what was attached.
   */
  function exportJson({ pretty = true } = {}) {
    const doc = getDoc();
    const payload = {
      ...doc,
      exported: {
        at: new Date().toISOString(),
        application: 'CX Timeline',
        note: 'Attachment file contents are stored in the browser and are not included in this file.',
      },
    };
    download(`${stem(doc)}.json`, JSON.stringify(payload, null, pretty ? 2 : 0), 'application/json');
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CSV
     ═══════════════════════════════════════════════════════════════════════ */

  const CSV_COLUMNS = [
    ['id', (o) => o.id],
    ['type', (o) => TYPES[o.type]?.label || o.type],
    ['title', (o) => o.title],
    ['subtitle', (o) => o.subtitle],
    ['lane', (o, ctx) => ctx.laneNames.get(o.lane) || ''],
    ['start', (o) => toISO(o.start)],
    ['finish', (o) => (TYPES[o.type]?.duration ? toISO(o.end) : toISO(o.start))],
    ['duration_days', (o) => (TYPES[o.type]?.duration ? durationDays(o) : 0)],
    ['status', (o) => statusOf(o.status).label],
    ['percent_complete', (o) => o.progress ?? 0],
    ['owner', (o) => o.owner],
    ['subsystem', (o) => subsystemOf(o.subsystem)?.label || o.subsystem],
    ['area', (o) => o.area],
    ['tags', (o) => (o.tags || []).join('; ')],
    ['version', (o) => o.data?.version || ''],
    ['release_number', (o) => o.data?.releaseNumber || ''],
    ['build_number', (o) => o.data?.buildNumber || ''],
    ['test_package', (o) => o.data?.testPackage || ''],
    ['test_type', (o) => o.data?.testKind || ''],
    ['severity', (o) => o.data?.severity || ''],
    ['reference', (o) => o.data?.reference || ''],
    ['actual_start', (o) => o.data?.actualStart || ''],
    ['actual_finish', (o) => o.data?.actualEnd || ''],
    ['predecessors', (o, ctx) => (ctx.preds.get(o.id) || []).join('; ')],
    ['critical', (o, ctx) => (ctx.critical.has(o.id) ? 'yes' : 'no')],
    ['total_float_days', (o, ctx) => (ctx.floats.has(o.id) ? ctx.floats.get(o.id) : '')],
    ['notes', (o) => stripHtml(o.notes)],
  ];

  function exportCsv(opts = {}) {
    const doc = getDoc();
    const predicate = predicateFor(opts);
    const objects = doc.objects.filter((o) => !predicate || predicate(o));

    const analysis = criticalPath(doc);
    const laneNames = new Map(doc.lanes.map((l) => [l.id, l.name]));
    const titles = new Map(doc.objects.map((o) => [o.id, o.title]));
    const preds = new Map();
    for (const link of doc.links) {
      if (!preds.has(link.to)) preds.set(link.to, []);
      const spec = LINK_TYPES[link.type] || LINK_TYPES.FS;
      preds.get(link.to).push(`${titles.get(link.from) || link.from} (${spec.short}${link.lag ? (link.lag > 0 ? '+' : '') + link.lag + 'd' : ''})`);
    }

    const ctx = { laneNames, preds, critical: analysis.critical, floats: analysis.floats };
    const rows = [CSV_COLUMNS.map((c) => c[0])];
    for (const obj of objects) rows.push(CSV_COLUMNS.map(([, fn]) => fn(obj, ctx)));

    download(`${stem(doc)}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
    return true;
  }

  /** Export the dependency list as its own CSV. */
  function exportLinksCsv() {
    const doc = getDoc();
    const titles = new Map(doc.objects.map((o) => [o.id, o.title]));
    const rows = [['from_id', 'from_title', 'to_id', 'to_title', 'type', 'lag_days', 'label']];
    for (const link of doc.links) {
      rows.push([link.from, titles.get(link.from) || '', link.to, titles.get(link.to) || '', link.type, link.lag || 0, link.label || '']);
    }
    download(`${stem(doc, '-dependencies')}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
    return true;
  }

  /** Export the baseline variance report. */
  function exportBaselineCsv() {
    const doc = getDoc();
    const baseline = activeBaseline();
    if (!baseline) {
      toast({ tone: 'warn', title: 'No baseline selected', message: 'Take a baseline first, then export the comparison.' });
      return false;
    }
    const { rows: variance } = compareBaseline(doc, baseline);
    const laneNames = new Map(doc.lanes.map((l) => [l.id, l.name]));
    const rows = [['title', 'lane', 'change', 'baseline_start', 'baseline_finish', 'current_start', 'current_finish', 'start_shift_days', 'finish_shift_days', 'duration_change_days']];
    for (const row of variance) {
      rows.push([
        row.title,
        laneNames.get(row.current?.lane) || '',
        row.change,
        row.baseline ? toISO(row.baseline.start) : '',
        row.baseline?.end ? toISO(row.baseline.end) : '',
        row.current ? toISO(row.current.start) : '',
        row.current && TYPES[row.current.type]?.duration ? toISO(row.current.end) : '',
        row.startShift,
        row.endShift,
        row.durationChange,
      ]);
    }
    download(`${stem(doc, '-baseline')}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
    return true;
  }

  /** RFC 4180 quoting, with a BOM so Excel opens UTF-8 correctly. */
  function toCsv(rows) {
    const body = rows
      .map((row) =>
        row
          .map((cell) => {
            const value = cell == null ? '' : String(cell);
            return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
          })
          .join(',')
      )
      .join('\r\n');
    return '﻿' + body;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Vector & raster images
     ═══════════════════════════════════════════════════════════════════════ */

  /** Build the export scene once, for whichever backend needs it. */
  function makeScene(opts = {}) {
    const doc = getDoc();
    return buildScene(doc, {
      filter: predicateFor(opts),
      maxWidth: opts.maxWidth || 2600,
      pxPerDay: opts.pxPerDay,
      range: opts.range,
      showGrid: opts.showGrid !== false,
      showLinks: opts.showLinks !== false,
      showToday: opts.showToday !== false,
      showLegend: opts.showLegend !== false,
      palette: opts.palette,
    });
  }

  function exportSvg(opts = {}) {
    const doc = getDoc();
    const scene = makeScene(opts);
    const svg = sceneToSvg(scene, {
      title: doc.name,
      description: [doc.client, doc.programme, doc.description].filter(Boolean).join(' — '),
    });
    download(`${stem(doc)}.svg`, svg, 'image/svg+xml;charset=utf-8');
    return true;
  }

  async function exportRaster({ type = 'image/png', scale = 2, ...opts } = {}) {
    const doc = getDoc();
    const scene = makeScene(opts);
    const svg = sceneToSvg(scene, { title: doc.name });

    try {
      const blob = await svgToRaster(svg, {
        scale,
        type,
        width: scene.width,
        height: scene.height,
        background: type === 'image/jpeg' ? scene.meta.palette.bg : null,
      });
      const ext = type === 'image/jpeg' ? 'jpg' : 'png';
      download(`${stem(doc)}.${ext}`, blob, type);
      return true;
    } catch (err) {
      toast({ tone: 'bad', title: 'Image export failed', message: err.message });
      return false;
    }
  }

  const exportPng = (opts) => exportRaster({ ...opts, type: 'image/png' });
  const exportJpeg = (opts) => exportRaster({ ...opts, type: 'image/jpeg', scale: opts?.scale ?? 2 });

  /* ══════════════════════════════════════════════════════════════════════════
     PDF
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * High-quality vector PDF, landscape, tiled across pages when the programme
   * is wider than one sheet.
   */
  function exportPdf(opts = {}) {
    const doc = getDoc();
    const scene = makeScene({ ...opts, maxWidth: opts.maxWidth || pdfSceneWidth(opts) });

    try {
      const blob = sceneToPdf(scene, {
        pageSize: opts.pageSize || 'a3',
        multiPage: opts.multiPage !== false,
        title: doc.name,
        subtitle: [doc.client, doc.programme].filter(Boolean).join('  ·  '),
        author: doc.client || 'CX Timeline',
      });
      download(`${stem(doc)}.pdf`, blob, 'application/pdf');
      return true;
    } catch (err) {
      console.error('[cx-timeline] PDF export failed:', err);
      toast({ tone: 'bad', title: 'PDF export failed', message: err.message });
      return false;
    }
  }

  /**
   * Choose a scene width for PDF so bars stay readable: roughly one page's
   * worth of drawing per month of plan at the default density.
   */
  function pdfSceneWidth(opts) {
    const doc = getDoc();
    const extent = opts.range ? { start: opts.range[0], end: opts.range[1] } : projectExtent(doc);
    const days = Math.max(1, (extent.end - extent.start) / 86_400_000);
    const density = opts.density || 'normal';
    const pxPerDay = density === 'fine' ? 6 : density === 'coarse' ? 1.4 : 3;
    return 168 + days * pxPerDay + 24;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Print
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Open the browser print dialog against a purpose-built print document.
   *
   * Rather than trying to coerce the interactive canvas through a print
   * stylesheet, we render the export scene as SVG into a hidden iframe. What
   * the printer receives is exactly what the SVG/PDF exports contain, which is
   * why "Print → Save as PDF" and "Export PDF" agree with each other.
   */
  function printPlan(opts = {}) {
    const doc = getDoc();
    const scene = makeScene({ ...opts, palette: opts.palette || resolvePalette(printPalette(opts)) });
    const svg = sceneToSvg(scene, { title: doc.name });

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeAttr(doc.name)}</title>
  <style>
    @page { size: ${opts.pageSize === 'a4' ? 'A4' : 'A3'} landscape; margin: 10mm; }
    html, body { margin: 0; padding: 0; background: #fff; }
    svg { width: 100%; height: auto; display: block; }
  </style></head><body>${svg}</body></html>`;

    frame.onload = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (err) {
        toast({ tone: 'bad', title: 'Could not open the print dialog', message: err.message });
      }
      // Leave the frame in place long enough for the dialog to read it.
      setTimeout(() => frame.remove(), 60_000);
    };

    frame.srcdoc = html;
    return true;
  }

  /** Printing on white paper: force light surfaces regardless of the theme. */
  function printPalette(opts) {
    if (opts.keepTheme) return {};
    return {
      bg: '#ffffff',
      surface: '#ffffff',
      chrome: '#ffffff',
      text: '#101318',
      textMuted: '#4b5563',
      textSubtle: '#6b7280',
      border: '#c8cdd6',
      grid: '#e8eaee',
      gridMajor: '#c9ced7',
      weekend: '#f4f5f7',
    };
  }

  function escapeAttr(text) {
    return String(text || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  }

  /** Page-size options offered by the export dialog. */
  const PDF_PAGE_SIZES = Object.entries(PAGE_SIZES).map(([id, s]) => ({ value: id, label: s.label }));

  Object.defineProperty(__x, "exportJson", { get: () => exportJson, enumerable: true });
  Object.defineProperty(__x, "exportCsv", { get: () => exportCsv, enumerable: true });
  Object.defineProperty(__x, "exportLinksCsv", { get: () => exportLinksCsv, enumerable: true });
  Object.defineProperty(__x, "exportBaselineCsv", { get: () => exportBaselineCsv, enumerable: true });
  Object.defineProperty(__x, "exportSvg", { get: () => exportSvg, enumerable: true });
  Object.defineProperty(__x, "exportRaster", { get: () => exportRaster, enumerable: true });
  Object.defineProperty(__x, "exportPng", { get: () => exportPng, enumerable: true });
  Object.defineProperty(__x, "exportJpeg", { get: () => exportJpeg, enumerable: true });
  Object.defineProperty(__x, "exportPdf", { get: () => exportPdf, enumerable: true });
  Object.defineProperty(__x, "printPlan", { get: () => printPlan, enumerable: true });
  Object.defineProperty(__x, "PDF_PAGE_SIZES", { get: () => PDF_PAGE_SIZES, enumerable: true });
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
// io/importers.js
// ════════════════════════════════════════════════════════════════════════
__mods["io/importers.js"] = function (__x, __req) {
  /**
   * Import.
   *
   * Four routes in: the application's own JSON, generic CSV/TSV, Microsoft
   * Project's CSV export, and `.xlsx` workbooks. Everything converges on one
   * intermediate shape — a list of row objects with normalised column names —
   * so the mapping logic is written once.
   *
   * Nothing is applied to the live document until the caller confirms; every
   * function returns a *result* describing what would be imported, along with
   * any warnings, so the UI can preview it first.
   *
   * Imports: util, dates, model, store, inflate.
   */

  const { readFileAsText, readFileAsArrayBuffer, fold } = __req("core/util.js");
  const { toMs, toISO, MS_DAY, addDays, todayMs, getDateOrder } = __req("core/dates.js");
  const { makeProject, makeObject, makeLane, makeLink, normalise, validate, TYPES, listOptions } = __req("core/model.js");









  const { getDoc } = __req("core/store.js");
  const { readZip, zipText } = __req("io/inflate.js");

  /* ══════════════════════════════════════════════════════════════════════════
     Entry point
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Inspect a file and import it with the right reader.
   * @returns {Promise<{kind:string, doc?:object, objects?:Array, lanes?:Array,
   *                    links?:Array, warnings:string[], errors:string[], summary:string}>}
   */
  async function importFile(file) {
    const name = (file.name || '').toLowerCase();

    try {
      if (name.endsWith('.json')) return await importJsonFile(file);
      if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return await importXlsxFile(file);
      if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) return await importCsvFile(file);

      // Unknown extension: sniff the content rather than refusing outright.
      const text = await readFileAsText(file);
      if (text.trim().startsWith('{')) return parseJson(text);
      return parseTabular(splitDelimited(text), file.name);
    } catch (err) {
      return { kind: 'error', warnings: [], errors: [err.message], summary: 'Import failed' };
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     JSON — a full project
     ═══════════════════════════════════════════════════════════════════════ */

  async function importJsonFile(file) {
    return parseJson(await readFileAsText(file));
  }

  function parseJson(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { kind: 'error', warnings: [], errors: [`The file is not valid JSON: ${err.message}`], summary: 'Import failed' };
    }

    const check = validate(parsed);
    if (!check.ok) {
      return { kind: 'error', warnings: check.warnings, errors: check.errors, summary: 'Import failed' };
    }

    const doc = normalise(parsed);
    return {
      kind: 'project',
      doc,
      warnings: check.warnings,
      errors: [],
      summary: `${doc.objects.length} objects across ${doc.lanes.length} lanes, ${doc.links.length} dependencies`,
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CSV / TSV
     ═══════════════════════════════════════════════════════════════════════ */

  async function importCsvFile(file) {
    const text = await readFileAsText(file);
    return parseTabular(splitDelimited(text), file.name);
  }

  /**
   * Split delimited text into a matrix, honouring RFC 4180 quoting and
   * auto-detecting the separator (comma, semicolon or tab — European Excel
   * exports use semicolons).
   */
  function splitDelimited(text) {
    const clean = text.replace(/^﻿/, '');
    const sample = clean.slice(0, 4000);
    const counts = {
      ',': (sample.match(/,/g) || []).length,
      ';': (sample.match(/;/g) || []).length,
      '\t': (sample.match(/\t/g) || []).length,
    };
    const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];

      if (quoted) {
        if (ch === '"') {
          if (clean[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            quoted = false;
          }
        } else {
          cell += ch;
        }
        continue;
      }

      if (ch === '"') {
        quoted = true;
      } else if (ch === delimiter) {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else if (ch !== '\r') {
        cell += ch;
      }
    }

    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }

    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  /* ── Column mapping ────────────────────────────────────────────────────── */

  /**
   * Header aliases. The first match wins, so more specific names come first.
   * Covers our own CSV export, Microsoft Project's CSV, and the column names
   * people actually type into a spreadsheet.
   */
  const COLUMN_ALIASES = {
    title: ['title', 'name', 'task name', 'task', 'activity', 'activity name', 'description', 'summary', 'subject'],
    type: ['type', 'object type', 'category', 'kind'],
    lane: ['lane', 'swimlane', 'group', 'workstream', 'discipline', 'resource names', 'resource', 'team', 'phase'],
    start: ['start', 'start date', 'planned start', 'begin', 'from', 'baseline start', 'early start'],
    end: ['finish', 'finish date', 'end', 'end date', 'planned finish', 'to', 'due', 'due date', 'baseline finish', 'early finish'],
    duration: ['duration', 'duration days', 'duration_days', 'days'],
    status: ['status', 'state', 'progress status'],
    progress: ['percent complete', 'percent_complete', '% complete', 'complete', 'progress', 'pct complete'],
    owner: ['owner', 'assigned to', 'assignee', 'responsible', 'engineer', 'lead'],
    subsystem: ['subsystem', 'system', 'sub-system', 'discipline code'],
    area: ['area', 'zone', 'section', 'location', 'site'],
    tags: ['tags', 'labels', 'keywords'],
    notes: ['notes', 'note', 'comments', 'remarks', 'detail'],
    version: ['version', 'sw version', 'software version'],
    releaseNumber: ['release number', 'release_number', 'release no', 'release'],
    buildNumber: ['build number', 'build_number', 'build'],
    testPackage: ['test package', 'test_package', 'package', 'tp'],
    testKind: ['test type', 'test_type', 'test kind'],
    severity: ['severity', 'priority', 'risk level'],
    reference: ['reference', 'ref', 'ticket', 'issue id', 'defect'],
    predecessors: ['predecessors', 'predecessor', 'depends on', 'dependency', 'dependencies'],
    id: ['id', 'unique id', 'uid', 'task id', 'wbs'],
    milestone: ['milestone'],
    outline: ['outline level', 'outline_level', 'level'],
  };

  /** Map a header row onto our field names. */
  function mapHeaders(header) {
    const normalised = header.map((h) => fold(String(h).trim()));
    const mapping = {};
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      for (const alias of aliases) {
        const index = normalised.indexOf(alias);
        if (index >= 0) {
          mapping[field] = index;
          break;
        }
      }
    }
    return mapping;
  }

  /**
   * Turn a matrix into importable objects and lanes.
   * @param {string[][]} rows
   * @param {string} sourceName
   */
  function parseTabular(rows, sourceName = 'import') {
    const warnings = [];
    const errors = [];

    if (rows.length < 2) {
      return { kind: 'error', warnings, errors: ['The file has no data rows.'], summary: 'Import failed' };
    }

    const header = rows[0];
    const mapping = mapHeaders(header);

    if (mapping.title == null) {
      return {
        kind: 'error',
        warnings,
        errors: [`No recognisable title column. Expected one of: ${COLUMN_ALIASES.title.join(', ')}. Found: ${header.join(', ')}`],
        summary: 'Import failed',
      };
    }
    if (mapping.start == null) {
      warnings.push('No start-date column found — imported items will start today and be spaced sequentially.');
    }

    const laneNames = new Map(); // lane label -> lane record
    const objects = [];
    const sourceIds = new Map(); // source id -> new object id
    const pendingLinks = [];
    let cursor = todayMs();

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const get = (field) => (mapping[field] != null ? String(row[mapping[field]] ?? '').trim() : '');

      const title = get('title');
      if (!title) continue;

      /* Lane */
      const laneLabel = get('lane') || 'Imported';
      if (!laneNames.has(laneLabel)) {
        laneNames.set(laneLabel, makeLane({ name: laneLabel, color: laneColour(laneNames.size) }));
      }
      const lane = laneNames.get(laneLabel);

      /* Dates */
      let start = parseDate(get('start'));
      if (!Number.isFinite(start)) {
        start = cursor;
        cursor = addDays(cursor, 1);
      }

      let end = parseDate(get('end'));
      const durationText = get('duration');
      if (!Number.isFinite(end) && durationText) {
        const days = parseDuration(durationText);
        if (Number.isFinite(days)) end = addDays(start, Math.max(1, Math.round(days)));
      }

      /* Type */
      const isMilestone =
        truthy(get('milestone')) ||
        (Number.isFinite(end) && end === start && !durationText) ||
        /milestone|gate|acceptance/i.test(title);
      const type = resolveType(get('type'), { isMilestone, title });

      if (!Number.isFinite(end)) end = TYPES[type]?.duration ? addDays(start, TYPES[type].defaultDays || 5) : start;
      if (TYPES[type]?.duration && end <= start) end = addDays(start, 1);

      /* Everything else */
      const obj = makeObject({
        type,
        lane: lane.id,
        title,
        start,
        end,
        status: resolveStatus(get('status'), get('progress')),
        progress: parseProgress(get('progress')),
        owner: get('owner'),
        subsystem: resolveSubsystem(get('subsystem')),
        area: get('area'),
        tags: get('tags').split(/[;,|]/).map((t) => t.trim()).filter(Boolean),
        notes: get('notes') ? `<p>${escapeText(get('notes'))}</p>` : '',
        data: pruneEmpty({
          version: get('version'),
          releaseNumber: get('releaseNumber'),
          buildNumber: get('buildNumber'),
          testPackage: get('testPackage'),
          testKind: resolveTestKind(get('testKind')),
          severity: resolveSeverity(get('severity')),
          reference: get('reference'),
        }),
      });

      objects.push(obj);

      const sourceId = get('id');
      if (sourceId) sourceIds.set(sourceId, obj.id);

      const predecessors = get('predecessors');
      if (predecessors) pendingLinks.push({ to: obj.id, spec: predecessors });
    }

    if (!objects.length) {
      return { kind: 'error', warnings, errors: ['No rows contained a usable title.'], summary: 'Import failed' };
    }

    /* Resolve predecessor references — Microsoft Project writes "12FS+3 days". */
    const links = [];
    let unresolved = 0;
    for (const pending of pendingLinks) {
      for (const part of pending.spec.split(/[;,]/)) {
        const match = /^\s*([\w.-]+)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+)?/i.exec(part.trim());
        if (!match) continue;
        const fromId = sourceIds.get(match[1]);
        if (!fromId) {
          unresolved++;
          continue;
        }
        links.push(
          makeLink({
            from: fromId,
            to: pending.to,
            type: (match[2] || 'FS').toUpperCase(),
            lag: match[3] ? parseInt(match[3].replace(/\s+/g, ''), 10) : 0,
          })
        );
      }
    }
    if (unresolved) warnings.push(`${unresolved} predecessor reference(s) pointed at rows that were not imported.`);

    const lanes = Array.from(laneNames.values());
    return {
      kind: 'rows',
      objects,
      lanes,
      links,
      warnings,
      errors,
      summary: `${objects.length} objects, ${lanes.length} lanes, ${links.length} dependencies from ${sourceName}`,
    };
  }

  /* ── Value coercion ────────────────────────────────────────────────────── */

  /** Parse a date cell across the formats spreadsheets actually produce. */
  function parseDate(value) {
    const text = String(value || '').trim();
    if (!text) return NaN;

    // Excel serial number (days since 1899-12-30).
    if (/^\d{5}(\.\d+)?$/.test(text)) {
      const serial = parseFloat(text);
      if (serial > 20000 && serial < 80000) return Date.UTC(1899, 11, 30) + Math.round(serial) * MS_DAY;
    }

    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
    if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);

    // 3/5/2026 is genuinely ambiguous. Where one field is over 12 the order is
    // decided for us; otherwise fall back to the project's display order, so a
    // plan shown as M/D/Y also imports spreadsheets written as M/D/Y.
    const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(text);
    if (slash) {
      const [, first, second, y] = slash;
      const a = +first;
      const b = +second;

      let day;
      let month;
      if (a > 12 && b <= 12) {
        day = a;
        month = b;
      } else if (b > 12 && a <= 12) {
        month = a;
        day = b;
      } else if (getDateOrder() === 'dmy') {
        day = a;
        month = b;
      } else {
        month = a;
        day = b;
      }

      let year = +y;
      if (year < 100) year += year < 70 ? 2000 : 1900;
      return Date.UTC(year, month - 1, day);
    }

    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) {
      const d = new Date(parsed);
      return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    }
    return NaN;
  }

  /** "12 days", "3 wks", "5d", "8h" → days. */
  function parseDuration(value) {
    const text = String(value).trim().toLowerCase();
    const match = /^([\d.]+)\s*([a-z]*)/.exec(text);
    if (!match) return NaN;
    const n = parseFloat(match[1]);
    if (!Number.isFinite(n)) return NaN;
    const unit = match[2];
    if (unit.startsWith('w')) return n * 7;
    if (unit.startsWith('mo')) return n * 30.44;
    if (unit.startsWith('h')) return n / 8;
    if (unit.startsWith('m') && unit !== 'mo') return n * 30.44;
    return n;
  }

  function parseProgress(value) {
    const text = String(value || '').replace('%', '').trim();
    const n = parseFloat(text);
    if (!Number.isFinite(n)) return 0;
    // Spreadsheets store percentages as 0–1 as often as 0–100.
    return n <= 1 && text.includes('.') ? Math.round(n * 100) : Math.round(n);
  }

  function resolveType(value, { isMilestone, title }) {
    const text = fold(value);
    if (text) {
      for (const [id, def] of Object.entries(TYPES)) {
        if (fold(def.label) === text || id === text) return id;
      }
      if (/release|build|drop/.test(text)) return 'release';
      if (/campaign|commission/.test(text)) return 'campaign';
      if (/risk/.test(text)) return 'risk';
      if (/issue|defect|bug/.test(text)) return 'issue';
      if (/milestone|gate/.test(text)) return 'milestone';
      if (/test/.test(text)) return 'testwindow';
      if (/freeze/.test(text)) return 'freeze';
      if (/outage/.test(text)) return 'outage';
    }
    if (isMilestone) return 'milestone';
    if (/\brelease\b|\bv\d+\.\d+/i.test(title)) return 'release';
    if (/\btest(ing)?\b/i.test(title)) return 'testwindow';
    if (/\bcampaign\b/i.test(title)) return 'campaign';
    return 'activity';
  }

  function resolveStatus(value, progressText) {
    const text = fold(value);
    if (text) {
      for (const option of listOptions('status')) {
        if (fold(option.label) === text || option.id === text) return option.id;
      }
      if (/complete|done|finish|closed/.test(text)) return 'complete';
      if (/progress|active|started|ongoing|wip/.test(text)) return 'inprogress';
      if (/late|delay|slip|overdue/.test(text)) return 'delayed';
      if (/block|stopped/.test(text)) return 'blocked';
      if (/cancel/.test(text)) return 'cancelled';
      if (/hold|pause/.test(text)) return 'onhold';
      if (/test/.test(text)) return 'testing';
      if (/release/.test(text)) return 'released';
    }
    const progress = parseProgress(progressText);
    if (progress >= 100) return 'complete';
    if (progress > 0) return 'inprogress';
    return 'planned';
  }

  function resolveSubsystem(value) {
    const text = fold(value);
    if (!text) return '';
    const found = listOptions('subsystem').find((s) => s.id === text || fold(s.label) === text);
    if (found) return found.id;
    if (/interlock/.test(text)) return 'ixl';
    if (/comm|radio|network/.test(text)) return 'comms';
    if (/train|vehicle|rolling/.test(text)) return 'vehicle';
    if (/scada|supervis/.test(text)) return 'scada';
    if (/wayside|track/.test(text)) return 'wayside';
    return '';
  }

  function resolveTestKind(value) {
    const text = fold(value);
    if (!text) return '';
    const found = listOptions('testKind').find((t) => t.id === text || fold(t.label) === text);
    return found ? found.id : '';
  }

  function resolveSeverity(value) {
    const text = fold(value);
    if (!text) return '';
    if (/crit|1|highest|blocker/.test(text)) return 'critical';
    if (/high|2|major/.test(text)) return 'high';
    if (/med|3|moderate|normal/.test(text)) return 'medium';
    if (/low|4|minor/.test(text)) return 'low';
    return '';
  }

  function truthy(value) {
    return /^(yes|y|true|1|x)$/i.test(String(value || '').trim());
  }

  function pruneEmpty(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) if (v) out[k] = v;
    return out;
  }

  function escapeText(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const LANE_COLOURS = ['#5b93f5', '#a855f7', '#16a571', '#e0900b', '#f2555b', '#0ea5e9', '#0d9488', '#f97316', '#818cf8', '#94a3b8'];
  function laneColour(index) {
    return LANE_COLOURS[index % LANE_COLOURS.length];
  }

  /* ══════════════════════════════════════════════════════════════════════════
     XLSX
     ═══════════════════════════════════════════════════════════════════════ */

  async function importXlsxFile(file) {
    const buffer = await readFileAsArrayBuffer(file);
    const rows = await readXlsx(buffer);
    if (!rows.length) {
      return { kind: 'error', warnings: [], errors: ['No readable sheet was found in the workbook.'], summary: 'Import failed' };
    }
    const result = parseTabular(rows, file.name);
    result.warnings.unshift('Imported from the first worksheet. Formatting, formulas and charts are not read.');
    return result;
  }

  /**
   * Read the first worksheet of an xlsx workbook into a matrix.
   * Handles shared strings, inline strings, numbers and dates.
   */
  async function readXlsx(arrayBuffer) {
    const files = await readZip(arrayBuffer);

    /* Shared string table */
    const sharedStrings = [];
    const sharedXml = zipText(files, 'xl/sharedStrings.xml');
    if (sharedXml) {
      for (const si of sharedXml.match(/<si>[\s\S]*?<\/si>/g) || []) {
        // A cell's text can be split across several runs; concatenate them all.
        const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        sharedStrings.push(parts.map((p) => decodeXml(p.replace(/<[^>]+>/g, ''))).join(''));
      }
    }

    /* Which sheet is first? Fall back to sheet1.xml if the map is missing. */
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const workbookXml = zipText(files, 'xl/workbook.xml');
    const relsXml = zipText(files, 'xl/_rels/workbook.xml.rels');
    if (workbookXml && relsXml) {
      const firstSheet = /<sheet[^>]*r:id="([^"]+)"/.exec(workbookXml);
      if (firstSheet) {
        const rel = new RegExp(`<Relationship[^>]*Id="${firstSheet[1]}"[^>]*Target="([^"]+)"`).exec(relsXml);
        if (rel) {
          const target = rel[1].replace(/^\/?xl\//, '').replace(/^\//, '');
          if (files.has(`xl/${target}`)) sheetPath = `xl/${target}`;
        }
      }
    }

    const sheetXml = zipText(files, sheetPath);
    if (!sheetXml) return [];

    /* Date-formatted cells need the style table to be recognised as dates. */
    const dateStyles = readDateStyles(zipText(files, 'xl/styles.xml'));

    const rows = [];
    for (const rowXml of sheetXml.match(/<row[\s\S]*?(?:\/>|<\/row>)/g) || []) {
      const cells = [];
      for (const cellXml of rowXml.match(/<c[\s\S]*?(?:\/>|<\/c>)/g) || []) {
        const ref = /r="([A-Z]+)\d+"/.exec(cellXml);
        const column = ref ? columnIndex(ref[1]) : cells.length;
        const type = /t="([^"]+)"/.exec(cellXml)?.[1];
        const styleIndex = /s="(\d+)"/.exec(cellXml)?.[1];

        let value = '';
        if (type === 'inlineStr') {
          value = (cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((p) => decodeXml(p.replace(/<[^>]+>/g, ''))).join('');
        } else {
          const raw = /<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1];
          if (raw != null) {
            if (type === 's') value = sharedStrings[parseInt(raw, 10)] ?? '';
            else if (type === 'str' || type === 'e') value = decodeXml(raw);
            else if (styleIndex != null && dateStyles.has(parseInt(styleIndex, 10))) {
              value = toISO(Date.UTC(1899, 11, 30) + Math.round(parseFloat(raw)) * MS_DAY);
            } else {
              value = decodeXml(raw);
            }
          }
        }

        while (cells.length < column) cells.push('');
        cells[column] = value;
      }
      if (cells.length) rows.push(cells);
    }

    return rows;
  }

  /** Style indices whose number format is a date/time format. */
  function readDateStyles(stylesXml) {
    const dateStyles = new Set();
    if (!stylesXml) return dateStyles;

    // Built-in numeric formats 14–22 and 45–47 are dates/times.
    const builtInDates = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
    const customDates = new Set();
    for (const fmt of stylesXml.match(/<numFmt[^>]*\/>/g) || []) {
      const id = /numFmtId="(\d+)"/.exec(fmt)?.[1];
      const code = /formatCode="([^"]*)"/.exec(fmt)?.[1] || '';
      if (id && /[dmyh]/i.test(code) && !/[#0]/.test(code.replace(/\[[^\]]*\]/g, ''))) customDates.add(parseInt(id, 10));
    }

    const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] || '';
    const xfs = cellXfs.match(/<xf[\s\S]*?(?:\/>|<\/xf>)/g) || [];
    xfs.forEach((xf, index) => {
      const id = parseInt(/numFmtId="(\d+)"/.exec(xf)?.[1] ?? '0', 10);
      if (builtInDates.has(id) || customDates.has(id)) dateStyles.add(index);
    });

    return dateStyles;
  }

  /** 'A' → 0, 'B' → 1, 'AA' → 26 … */
  function columnIndex(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function decodeXml(text) {
    return String(text)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(+code))
      .replace(/&amp;/g, '&');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Applying an import
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Turn a row-based import result into a document.
   * `mode` is 'replace' (a new project from the rows) or 'merge' (append the
   * rows to the open project, creating any lanes it needs).
   */
  function buildDocFromRows(result, { mode = 'replace', name = 'Imported plan' } = {}) {
    if (mode === 'merge') {
      const doc = JSON.parse(JSON.stringify(getDoc()));
      const laneByName = new Map(doc.lanes.map((l) => [fold(l.name), l]));
      const laneMap = new Map();

      for (const lane of result.lanes) {
        const existing = laneByName.get(fold(lane.name));
        if (existing) {
          laneMap.set(lane.id, existing.id);
        } else {
          doc.lanes.push(lane);
          doc.laneOrder.push(lane.id);
          laneMap.set(lane.id, lane.id);
        }
      }

      for (const obj of result.objects) {
        obj.lane = laneMap.get(obj.lane) || doc.laneOrder[0];
        doc.objects.push(obj);
      }
      doc.links.push(...result.links);
      return normalise(doc);
    }

    const doc = makeProject(name);
    doc.lanes = result.lanes;
    doc.laneOrder = result.lanes.map((l) => l.id);
    doc.objects = result.objects;
    doc.links = result.links;
    return normalise(doc);
  }

  Object.defineProperty(__x, "importFile", { get: () => importFile, enumerable: true });
  Object.defineProperty(__x, "parseJson", { get: () => parseJson, enumerable: true });
  Object.defineProperty(__x, "splitDelimited", { get: () => splitDelimited, enumerable: true });
  Object.defineProperty(__x, "parseTabular", { get: () => parseTabular, enumerable: true });
  Object.defineProperty(__x, "parseDate", { get: () => parseDate, enumerable: true });
  Object.defineProperty(__x, "readXlsx", { get: () => readXlsx, enumerable: true });
  Object.defineProperty(__x, "buildDocFromRows", { get: () => buildDocFromRows, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/panels.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/panels.js"] = function (__x, __req) {
  /**
   * Dock panes.
   *
   * The left dock hosts sixteen panes reached from the sidebar. Each is a small
   * pure-render function over the store; the router below tracks which is
   * showing and re-renders it when the document changes, so no pane has to
   * manage its own subscriptions.
   *
   * Imports: util, events, dates, model, store, storage, query, analysis,
   *          viewport, renderer, io, icons, components, lists, notes, dialogs,
   *          theme.
   */

  const { el, clear, debounce, bytes, download } = __req("core/util.js");
  const { on, emit, EV } = __req("core/events.js");
  const { fmtDate, fmtTimestamp, fmtDuration, toISO, toMs, MS_DAY, DATE_ORDERS } = __req("core/dates.js");
  const { TYPES, listOptions, typeGroups, statusOf, subsystemOf, durationDays, effectiveToday, makeBaseline, makeProject } = __req("core/model.js");










  const store = __req("core/store.js");
  const { listBackups, loadBackup, deleteBackup, makeBackup, usage, refreshBackupSchedule, isFallback, collectGarbage, switchProject, createCloudProject, isHosted } = __req("core/storage.js");
  const cloud = __req("core/cloud.js");
  const { search, summarise, facet, filterPredicate } = __req("core/query.js");
  const { criticalPath, compareBaseline, programmeHealth, objectHealth, slipByLane, linkViolations, evaluateLink } = __req("core/analysis.js");
  const viewport = __req("timeline/viewport.js");
  const renderer = __req("timeline/renderer.js");
  const { icon } = __req("ui/icons.js");
  const { field, textInput, numberInput, selectInput, checkbox, toggle, segmented, section, emptyState, badge, chipStat, confirmDialog, promptDialog, skeleton, toast, openModal, progressBar, contextMenu } = __req("ui/components.js");



















  const cmd = __req("ui/commands.js");
  const { listEditor } = __req("ui/lists.js");
  const { openShareDialog, paneTeam } = __req("ui/auth.js");
  const { openObjectDialog, openLaneDialog } = __req("ui/dialogs.js");
  const { THEMES, applyTheme, getTheme } = __req("ui/theme.js");
  const exporters = __req("io/exporters.js");
  const { importFile, buildDocFromRows } = __req("io/importers.js");
  const { pickFiles } = __req("core/util.js");

  const PANES = [
    'projects', 'team', 'lanes', 'palette', 'outline', 'releases', 'campaigns', 'risks', 'links',
    'baselines', 'search', 'filters', 'legend', 'history', 'io', 'backups', 'lists',
    'settings',
  ];

  let dockEl = null;
  let bodyEl = null;
  let headEl = null;
  let active = 'lanes';
  /** Set when a rebuild was suppressed because the user was mid-edit. */
  let pendingRender = false;

  /**
   * True when focus is in a text-entry control inside the dock.
   *
   * Panes write straight to the store as you type, and the store publishes
   * `doc:changed`, which would rebuild the pane and destroy the input under the
   * caret. While the user is typing the pane holds still and the rebuild is
   * deferred until focus leaves. Discrete controls (selects, checkboxes) are
   * excluded so choosing one refreshes the pane immediately.
   */
  function isTypingInDock() {
    const active_ = document.activeElement;
    if (!dockEl || !active_ || !dockEl.contains(active_)) return false;
    const tag = active_.tagName.toLowerCase();
    if (tag === 'textarea' || active_.isContentEditable) return true;
    return tag === 'input' && !['checkbox', 'radio', 'color', 'range', 'file'].includes(active_.type);
  }

  function buildPanels() {
    dockEl = document.getElementById('dock');
    clear(dockEl);

    headEl = el('div', { class: 'pane-head' });
    bodyEl = el('div', { class: 'dock-body' });
    dockEl.append(headEl, bodyEl);

    const resizer = el('div', { class: 'resizer right' });
    dockEl.appendChild(resizer);
    installResizer(resizer, dockEl, 190, 480);

    dockEl.addEventListener('focusout', () => {
      setTimeout(() => {
        if (pendingRender && !isTypingInDock()) renderPane();
      }, 0);
    });

    const rerender = debounce(() => {
      if (isTypingInDock()) {
        pendingRender = true;
        return;
      }
      renderPane();
    }, 70);
    on(EV.DOC_CHANGED, (p) => {
      if (p?.transient) return;
      rerender();
    });
    on(EV.DOC_REPLACED, rerender);
    on(EV.SELECTION_CHANGED, () => {
      if (['outline', 'releases', 'campaigns', 'risks', 'links'].includes(active)) rerender();
    });
    on(EV.FILTER_CHANGED, () => {
      if (active === 'filters' || active === 'search') rerender();
    });
    on('ui:focus-search', () => {
      const input = bodyEl.querySelector('[data-search-input]');
      if (input) {
        input.focus();
        input.select();
      }
    });
    on('ui:export-menu', ({ anchor }) => exportMenu(anchor));
    on('ui:print', () => exporters.printPlan());

    showPane(active);
  }

  function currentPane() {
    return active;
  }

  function showPane(name) {
    if (!PANES.includes(name)) return;
    active = name;
    // Un-collapse the dock when a pane is chosen from the sidebar.
    dockEl.classList.remove('collapsed');
    renderPane();
    emit(EV.PANEL_CHANGED, { pane: name });
  }

  function toggleDock() {
    dockEl.classList.toggle('collapsed');
    setTimeout(() => {
      renderer.measure();
      renderer.requestRender();
    }, 40);
  }

  /* ── Router ────────────────────────────────────────────────────────────── */

  const RENDERERS = {
    projects: paneProjects,
    team: paneTeam,
    lanes: paneLanes,
    palette: panePalette,
    outline: paneOutline,
    releases: paneReleases,
    campaigns: paneCampaigns,
    risks: paneRisks,
    links: paneLinks,
    baselines: paneBaselines,
    search: paneSearch,
    filters: paneFilters,
    legend: paneLegendSettings,
    history: paneHistory,
    io: paneIo,
    backups: paneBackups,
    lists: paneLists,
    settings: paneSettings,
  };

  const TITLES = {
    projects: 'Projects', team: 'Team & access',
    lanes: 'Lanes', palette: 'Add objects', outline: 'Outline', releases: 'Software releases',
    campaigns: 'Commissioning campaigns', risks: 'Risks & issues', links: 'Dependencies',
    baselines: 'Baselines', search: 'Global search', filters: 'Filters', legend: 'Legend',
    history: 'Version history', io: 'Import / export', backups: 'Backups',
    lists: 'Dropdown lists', settings: 'Settings',
  };

  function renderPane() {
    if (!bodyEl) return;
    pendingRender = false;
    // Keep the reader's place across rebuilds.
    const scroll = bodyEl.querySelector('.pane-scroll')?.scrollTop || 0;

    clear(headEl);
    clear(bodyEl);

    headEl.append(
      el('span', { class: 'ph-title', text: TITLES[active] || active }),
      el('button', {
        class: 'cx-btn icon mini ghost',
        title: 'Hide panel',
        'aria-label': 'Hide panel',
        html: icon('chevron-left', { size: 12 }),
        onClick: toggleDock,
      })
    );

    const pane = el('div', { class: 'pane-scroll' });
    bodyEl.appendChild(pane);
    (RENDERERS[active] || paneLanes)(pane);
    pane.scrollTop = scroll;

    // Dock lists stay single-line for density, so make sure a row that is too
    // narrow for its text still surfaces the whole thing on hover.
    for (const node of pane.querySelectorAll('.lr-title, .lr-meta')) {
      if (!node.title) node.title = node.textContent;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Lanes
     ═══════════════════════════════════════════════════════════════════════ */

  function paneLanes(root) {
    const doc = store.getDoc();
    const list = el('div', { class: 'cx-list' });

    doc.laneOrder.forEach((laneId, index) => {
      const lane = store.getLane(laneId);
      if (!lane) return;
      const count = doc.objects.filter((o) => o.lane === laneId).length;

      list.appendChild(
        el('div', { class: 'cx-listrow' }, [
          el('span', { class: 'cx-dot', style: { background: lane.color } }),
          el('div', { class: 'lr-main', onClick: () => openLaneDialog(laneId) }, [
            el('div', { class: 'lr-title', text: lane.name }),
            el('div', { class: 'lr-meta', text: `${count} item${count === 1 ? '' : 's'}${lane.locked ? ' · locked' : ''}${lane.hidden ? ' · hidden' : ''}` }),
          ]),
          el('div', { class: 'lr-actions' }, [
            iconBtn(lane.hidden ? 'eye-off' : 'eye', lane.hidden ? 'Show lane' : 'Hide lane', () => {
              store.updateLane(laneId, { hidden: !lane.hidden }, 'Toggle lane visibility');
              renderer.requestRender();
            }),
            iconBtn(lane.locked ? 'lock' : 'unlock', lane.locked ? 'Unlock lane' : 'Lock lane', () => {
              store.updateLane(laneId, { locked: !lane.locked }, 'Toggle lane lock');
              renderer.requestRender();
            }),
            iconBtn('chevron-up', 'Move up', () => {
              store.moveLane(laneId, index - 1);
              renderer.requestRender();
            }),
            iconBtn('chevron-down', 'Move down', () => {
              store.moveLane(laneId, index + 1);
              renderer.requestRender();
            }),
            iconBtn('more', 'Lane options', (e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              emit('lane:menu', { id: laneId, clientX: rect.left, clientY: rect.bottom + 4 });
            }),
          ]),
        ])
      );
    });

    if (!doc.lanes.length) {
      root.appendChild(emptyState({ iconName: 'layers', title: 'No lanes yet', message: 'Lanes are the horizontal rows of your plan — one per subsystem, team or workstream.' }));
    } else {
      root.appendChild(list);
    }

    root.appendChild(
      el('div', { style: { marginTop: '10px', display: 'flex', gap: '6px' } }, [
        el('button', { class: 'cx-btn mini', html: icon('plus', { size: 12 }) + '<span>Add lane</span>', onClick: () => cmd.addLane() }),
        el('button', { class: 'cx-btn mini', html: icon('package', { size: 12 }) + '<span>Standard set</span>', title: 'Add the standard rail signalling lanes', onClick: addStandardLanes }),
      ])
    );
  }

  function addStandardLanes() {
    const existing = new Set(store.getDoc().lanes.map((l) => l.name.toLowerCase()));
    const standard = [
      ['Software Releases', '#5b93f5'], ['Regression Testing', '#a855f7'], ['ATS', '#3a76e8'],
      ['IXL', '#9333d9'], ['SCADA', '#0d9488'], ['Communications', '#0ea5e9'],
      ['Wayside', '#e0900b'], ['Vehicle', '#e51b22'], ['Commissioning', '#16a571'],
      ['Customer', '#64748b'], ['Risks & Issues', '#f97316'],
    ].filter(([name]) => !existing.has(name.toLowerCase()));

    if (!standard.length) {
      toast({ tone: 'info', title: 'All standard lanes already exist' });
      return;
    }
    for (const [name, color] of standard) store.addLane({ name, color });
    renderer.requestRender();
    toast({ tone: 'good', title: `${standard.length} lanes added` });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Object palette
     ═══════════════════════════════════════════════════════════════════════ */

  function panePalette(root) {
    root.appendChild(el('div', { class: 'cx-hint', style: { marginBottom: '10px' }, text: 'Pick a tool, then click on the timeline to place it. Double-clicking empty canvas always creates an activity.' }));

    for (const group of typeGroups()) {
      const grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' } });
      for (const type of group.items) {
        grid.appendChild(
          el('button', {
            class: 'cx-btn mini' + (store.getTool() === type.id ? ' active' : ''),
            style: { justifyContent: 'flex-start' },
            title: `${type.label} — click the timeline to place`,
            html: icon(type.icon, { size: 13 }) + `<span style="overflow:hidden;text-overflow:ellipsis">${type.label}</span>`,
            onClick: () => {
              store.setTool(type.id);
              renderPane();
              toast({ tone: 'info', title: `${type.label} tool`, message: 'Click the timeline to place it.', timeout: 2400 });
            },
          })
        );
      }
      root.appendChild(section(group.name, [grid]));
    }

    root.appendChild(
      el('div', { style: { marginTop: '10px' } }, [
        el('button', {
          class: 'cx-btn mini',
          html: icon('cursor', { size: 12 }) + '<span>Back to select tool</span>',
          onClick: () => {
            store.setTool('select');
            renderPane();
          },
        }),
      ])
    );
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Outline / registers
     ═══════════════════════════════════════════════════════════════════════ */

  function paneOutline(root) {
    const doc = store.getDoc();
    renderObjectRegister(root, doc.objects, {
      emptyTitle: 'No objects yet',
      emptyMessage: 'Add activities, milestones and releases from the Add menu or by double-clicking the timeline.',
      groupByLane: true,
    });
  }

  function paneReleases(root) {
    const doc = store.getDoc();
    const releases = doc.objects.filter((o) => o.type === 'release').sort((a, b) => a.start - b.start);

    const counts = {};
    for (const r of releases) counts[r.status] = (counts[r.status] || 0) + 1;

    root.appendChild(
      el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' } },
        Object.entries(counts).map(([status, n]) => chipStat(statusOf(status).label, n, toneOf(status))))
    );

    renderObjectRegister(root, releases, {
      emptyTitle: 'No software releases',
      emptyMessage: 'Add a release object to track versions, builds, deployment dates and approvals.',
      subtitle: (o) => [o.data?.version ? `v${o.data.version}` : null, o.data?.buildNumber, o.owner].filter(Boolean).join(' · '),
      action: { label: 'Add release', onClick: () => cmd.createObject('release') },
    });
  }

  function paneCampaigns(root) {
    const doc = store.getDoc();
    const campaigns = doc.objects.filter((o) => o.type === 'campaign' || o.type === 'testwindow').sort((a, b) => a.start - b.start);
    const today = effectiveToday(doc);

    renderObjectRegister(root, campaigns, {
      emptyTitle: 'No campaigns',
      emptyMessage: 'Commissioning campaigns carry an area, subsystem, test package, planned and actual dates.',
      subtitle: (o) => [o.area, o.data?.testPackage, subsystemOf(o.subsystem)?.label, `${Math.round(o.progress)}%`].filter(Boolean).join(' · '),
      showProgress: true,
      action: { label: 'Add campaign', onClick: () => cmd.createObject('campaign') },
    });
  }

  function paneRisks(root) {
    const doc = store.getDoc();
    const items = doc.objects.filter((o) => o.type === 'risk' || o.type === 'issue').sort((a, b) => severityRank(b) - severityRank(a) || a.start - b.start);

    renderObjectRegister(root, items, {
      emptyTitle: 'No risks or issues',
      emptyMessage: 'Log risks and open issues against the dates they threaten.',
      subtitle: (o) => [o.data?.severity ? o.data.severity.toUpperCase() : null, o.data?.reference, o.owner].filter(Boolean).join(' · '),
      action: { label: 'Add risk', onClick: () => cmd.createObject('risk') },
    });
  }

  function severityRank(obj) {
    return { critical: 4, high: 3, medium: 2, low: 1 }[obj.data?.severity] || 0;
  }

  /**
   * Shared register renderer for the outline and the domain panes.
   */
  function renderObjectRegister(root, objects, opts = {}) {
    if (!objects.length) {
      root.appendChild(emptyState({
        iconName: 'inbox',
        title: opts.emptyTitle || 'Nothing here yet',
        message: opts.emptyMessage,
        action: opts.action,
      }));
      return;
    }

    const doc = store.getDoc();
    const today = effectiveToday(doc);
    const selection = new Set(store.getSelection());

    const groups = opts.groupByLane
      ? doc.laneOrder
          .map((laneId) => ({ lane: store.getLane(laneId), items: objects.filter((o) => o.lane === laneId) }))
          .filter((g) => g.lane && g.items.length)
      : [{ lane: null, items: objects }];

    for (const group of groups) {
      const list = el('div', { class: 'cx-list' });

      for (const obj of group.items) {
        const health = objectHealth(obj, today);
        const row = el('div', {
          class: 'cx-listrow' + (selection.has(obj.id) ? ' active' : ''),
          onClick: (e) => {
            if (e.target.closest('.lr-actions')) return;
            cmd.revealObject(obj.id);
          },
          onDblclick: () => openObjectDialog(obj.id),
          onContextmenu: (e) => {
            e.preventDefault();
            store.setSelection([obj.id]);
            emit('canvas:contextmenu', { target: 'object', id: obj.id, clientX: e.clientX, clientY: e.clientY });
          },
        }, [
          el('span', { class: 'cx-dot', style: { background: TYPES[obj.type]?.accent || 'var(--neutral)' }, title: TYPES[obj.type]?.label }),
          el('div', { class: 'lr-main' }, [
            el('div', { class: 'lr-title', text: obj.title }),
            el('div', { class: 'lr-meta', text: (opts.subtitle ? opts.subtitle(obj) + ' · ' : '') + fmtDate(obj.start, 'compact') + (TYPES[obj.type]?.duration ? ` → ${fmtDate(obj.end, 'compact')}` : '') }),
            opts.showProgress && TYPES[obj.type]?.progress ? progressBar(obj.progress, statusOf(obj.status).color) : null,
          ]),
          healthDot(health),
          el('div', { class: 'lr-actions' }, [
            iconBtn('edit', 'Open editor', () => openObjectDialog(obj.id)),
          ]),
        ]);
        list.appendChild(row);
      }

      if (group.lane) {
        root.appendChild(section(`${group.lane.name}  (${group.items.length})`, [list], { collapsed: false }));
      } else {
        root.appendChild(list);
      }
    }
  }

  function healthDot(health) {
    const tone =
      health.state === 'overdue' || health.state === 'behind' || health.state === 'late' ? 'var(--bad)'
      : health.state === 'done' || health.state === 'ahead' ? 'var(--good)'
      : health.state === 'ontrack' ? 'var(--info)'
      : 'var(--text-subtle)';
    return el('span', { class: 'cx-dot round', style: { background: tone }, title: health.label });
  }

  function toneOf(status) {
    return statusOf(status).tone === 'neutral' ? 'muted' : statusOf(status).tone;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Dependencies
     ═══════════════════════════════════════════════════════════════════════ */

  function paneLinks(root) {
    const doc = store.getDoc();
    const analysis = criticalPath(doc);
    const violations = linkViolations(doc);

    root.appendChild(
      el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' } }, [
        chipStat('Links', doc.links.length, 'info'),
        chipStat('Broken', violations.count, violations.count ? 'bad' : 'good'),
        chipStat('Critical', analysis.critical.size, analysis.critical.size ? 'warn' : 'muted'),
      ])
    );

    if (violations.count) {
      root.appendChild(
        el('div', { class: 'insp-alert', style: { marginBottom: '11px' } }, [
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
            el('span', { html: icon('warning', { size: 13 }), style: { display: 'flex' } }),
            el('span', { style: { fontWeight: 700 }, text: `${violations.count} broken ${violations.count === 1 ? 'dependency' : 'dependencies'}` }),
          ]),
          el('div', { style: { fontSize: 'var(--fs-tiny)', marginTop: '4px', color: 'var(--text-muted)' }, text: `Worst is ${violations.worst} day${violations.worst === 1 ? '' : 's'} out.` }),
          el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, [
            el('button', { class: 'cx-btn mini', text: 'Show on timeline', onClick: () => cmd.selectViolations() }),
            el('button', { class: 'cx-btn mini primary', text: 'Reschedule all', onClick: () => { cmd.resolveAllViolations(); renderPane(); } }),
          ]),
        ])
      );
    }

    root.appendChild(
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px', marginBottom: '12px' } }, [
        field('Connector style', segmented({
          value: doc.settings.connectorStyle,
          stretch: true,
          options: [
            { value: 'orthogonal', label: 'Elbow' },
            { value: 'curved', label: 'Curved' },
            { value: 'straight', label: 'Straight' },
          ],
          onChange: (v) => {
            store.setSetting('connectorStyle', v, 'Change connector style');
            renderer.requestRender();
          },
        })),
        toggle({
          label: 'Highlight critical path',
          checked: doc.settings.criticalPath,
          onChange: (v) => {
            store.setSetting('criticalPath', v, 'Toggle critical path');
            renderer.setCriticalIds(criticalPath(store.getDoc()).critical);
            renderer.requestRender();
          },
        }),
      ])
    );

    if (!doc.links.length) {
      root.appendChild(emptyState({
        iconName: 'link',
        title: 'No dependencies',
        message: 'Hover an object and drag from its round anchor onto another object to create a link.',
      }));
      return;
    }

    const titles = new Map(doc.objects.map((o) => [o.id, o.title]));
    const list = el('div', { class: 'cx-list' });

    // Broken links first: they are the ones needing a decision.
    const ordered = doc.links
      .slice()
      .sort((a, b) => (violations.links.has(b.id) ? 1 : 0) - (violations.links.has(a.id) ? 1 : 0));

    for (const link of ordered) {
      const critical = analysis.critical.has(link.from) && analysis.critical.has(link.to);
      const evaluated = violations.byLink.get(link.id);
      const broken = !!evaluated?.violated;

      list.appendChild(
        el('div', { class: 'cx-listrow' + (broken ? ' danger' : ''), onClick: () => cmd.revealObject(link.to) }, [
          el('span', {
            style: { display: 'flex', color: broken ? 'var(--bad)' : critical ? 'var(--warn)' : 'var(--text-subtle)' },
            html: icon(broken ? 'warning' : critical ? 'route' : 'link', { size: 12 }),
          }),
          el('div', { class: 'lr-main' }, [
            el('div', { class: 'lr-title', text: `${titles.get(link.from) || '?'} → ${titles.get(link.to) || '?'}` }),
            el('div', {
              class: 'lr-meta',
              text: `${link.type}${link.lag ? ` ${link.lag > 0 ? '+' : ''}${link.lag}d` : ''}${
                broken ? ` · broken by ${evaluated.shortfallDays}d` : evaluated ? ` · ${evaluated.slackDays}d slack` : ''
              }${critical ? ' · critical' : ''}`,
            }),
          ]),
          el('div', { class: 'lr-actions' }, [
            broken
              ? iconBtn('refresh', 'Move the successor to the earliest allowed date', () => {
                  cmd.resolveViolation(link.id);
                  renderPane();
                })
              : null,
            iconBtn('unlink', 'Delete dependency', () => {
              store.removeLinks([link.id]);
              renderer.requestRender();
            }),
          ].filter(Boolean)),
        ])
      );
    }
    root.appendChild(list);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Baselines
     ═══════════════════════════════════════════════════════════════════════ */

  function paneBaselines(root) {
    const doc = store.getDoc();
    const active_ = store.activeBaseline();

    root.appendChild(
      el('div', { style: { display: 'flex', gap: '6px', marginBottom: '11px' } }, [
        el('button', { class: 'cx-btn mini primary', html: icon('bookmark', { size: 12 }) + '<span>Take baseline</span>', onClick: () => cmd.takeBaseline() }),
        el('button', {
          class: 'cx-btn mini',
          html: icon('download', { size: 12 }) + '<span>Export variance</span>',
          disabled: !active_,
          onClick: () => exporters.exportBaselineCsv(),
        }),
      ])
    );

    if (!doc.baselines.length) {
      root.appendChild(emptyState({
        iconName: 'bookmark',
        title: 'No baselines yet',
        message: 'A baseline freezes the current dates so later slippage can be measured against it.',
      }));
      return;
    }

    const list = el('div', { class: 'cx-list' });
    for (const baseline of doc.baselines.slice().reverse()) {
      list.appendChild(
        el('div', {
          class: 'cx-listrow' + (baseline.id === doc.settings.activeBaseline ? ' active' : ''),
          onClick: () => {
            store.setSetting('activeBaseline', baseline.id, 'Select baseline');
            store.setSetting('showBaseline', true, 'Show baseline');
            renderer.requestRender();
            renderPane();
          },
        }, [
          el('span', { style: { display: 'flex', color: 'var(--text-subtle)' }, html: icon('bookmark', { size: 12 }) }),
          el('div', { class: 'lr-main' }, [
            el('div', { class: 'lr-title', text: baseline.name }),
            el('div', { class: 'lr-meta', text: `${fmtTimestamp(baseline.created)} · ${baseline.snapshot.length} objects` }),
          ]),
          el('div', { class: 'lr-actions' }, [
            iconBtn('trash', 'Delete baseline', async () => {
              const ok = await confirmDialog({ title: 'Delete baseline', message: `Delete "${baseline.name}"?`, confirmLabel: 'Delete', danger: true });
              if (ok) {
                store.removeBaseline(baseline.id);
                renderer.requestRender();
                renderPane();
              }
            }),
          ]),
        ])
      );
    }
    root.appendChild(list);

    root.appendChild(
      el('div', { style: { marginTop: '11px' } }, [
        toggle({
          label: 'Show baseline on the timeline',
          checked: doc.settings.showBaseline,
          onChange: (v) => {
            store.setSetting('showBaseline', v, 'Toggle baseline');
            renderer.requestRender();
          },
        }),
      ])
    );

    if (!active_) return;

    /* Variance report */
    const { rows, summary } = compareBaseline(doc, active_);
    root.appendChild(
      el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', margin: '13px 0 8px' } }, [
        chipStat('Slipped', summary.slipped, summary.slipped ? 'bad' : 'muted'),
        chipStat('Ahead', summary.ahead, summary.ahead ? 'good' : 'muted'),
        chipStat('Added', summary.added, 'info'),
        chipStat('Removed', summary.removed, 'muted'),
        summary.worstSlip ? chipStat('Worst', `${summary.worstSlip}d`, 'bad') : null,
      ].filter(Boolean))
    );

    if (!rows.length) {
      root.appendChild(el('div', { class: 'cx-hint', text: 'The plan matches this baseline exactly.' }));
      return;
    }

    const varianceList = el('div', { class: 'cx-list' });
    for (const row of rows.slice(0, 80)) {
      const tone = row.change === 'slip' ? 'var(--bad)' : row.change === 'ahead' ? 'var(--good)' : 'var(--text-subtle)';
      varianceList.appendChild(
        el('div', { class: 'cx-listrow', onClick: () => row.current && cmd.revealObject(row.id) }, [
          el('span', { class: 'cx-dot', style: { background: tone } }),
          el('div', { class: 'lr-main' }, [
            el('div', { class: 'lr-title', text: row.title }),
            el('div', { class: 'lr-meta', text: varianceText(row) }),
          ]),
        ])
      );
    }
    root.appendChild(section(`Variance (${rows.length})`, [varianceList]));
  }

  function varianceText(row) {
    if (row.change === 'added') return 'Added since baseline';
    if (row.change === 'removed') return 'Removed since baseline';
    const parts = [];
    if (row.startShift) parts.push(`start ${row.startShift > 0 ? '+' : ''}${row.startShift}d`);
    if (row.endShift) parts.push(`finish ${row.endShift > 0 ? '+' : ''}${row.endShift}d`);
    if (row.durationChange) parts.push(`duration ${row.durationChange > 0 ? '+' : ''}${row.durationChange}d`);
    return parts.join(' · ') || 'Reshaped';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Search
     ═══════════════════════════════════════════════════════════════════════ */

  function paneSearch(root) {
    const input = textInput({
      value: '',
      placeholder: 'Search titles, notes, owners, versions…',
      type: 'search',
    });
    input.dataset.searchInput = '1';

    const results = el('div', { style: { marginTop: '10px' } });

    const run = debounce(() => {
      clear(results);
      const query = input.value.trim();
      if (!query) {
        results.appendChild(el('div', { class: 'cx-hint', text: 'Searches every object title, note, owner, subsystem, area, tag, version, build and reference in the project.' }));
        return;
      }

      const hits = search(store.getDoc(), query);
      if (!hits.length) {
        results.appendChild(emptyState({ iconName: 'search', title: 'No matches', message: `Nothing in this project matches “${query}”.` }));
        return;
      }

      results.appendChild(el('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: `${hits.length} result${hits.length === 1 ? '' : 's'}` }));
      const list = el('div', { class: 'cx-list' });
      for (const hit of hits) {
        list.appendChild(
          el('div', {
            class: 'cx-listrow',
            onClick: () => {
              if (hit.kind === 'lane') showPane('lanes');
              else cmd.revealObject(hit.id);
            },
            onDblclick: () => hit.kind === 'object' && openObjectDialog(hit.id),
          }, [
            el('span', { class: 'cx-dot', style: { background: TYPES[hit.type]?.accent || 'var(--neutral)' } }),
            el('div', { class: 'lr-main' }, [
              el('div', { class: 'lr-title', text: hit.title }),
              el('div', { class: 'lr-meta', text: `${hit.typeLabel}${hit.lane ? ' · ' + hit.lane : ''} · matched in ${hit.matchedIn}` }),
              hit.excerpt ? el('div', { style: { fontSize: 'var(--fs-tiny)', color: 'var(--text-subtle)', marginTop: '2px' }, text: hit.excerpt }) : null,
            ]),
          ])
        );
      }
      results.appendChild(list);
    }, 160);

    input.addEventListener('input', run);
    root.append(input, results);
    run();
    setTimeout(() => input.focus(), 40);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Filters
     ═══════════════════════════════════════════════════════════════════════ */

  function paneFilters(root) {
    const doc = store.getDoc();
    const filters = store.getFilters();

    root.appendChild(
      el('div', { style: { display: 'flex', gap: '6px', marginBottom: '11px' } }, [
        el('button', {
          class: 'cx-btn mini',
          html: icon('refresh', { size: 12 }) + '<span>Clear all</span>',
          disabled: !store.hasActiveFilters(),
          onClick: () => {
            store.resetFilters();
            renderer.requestRender();
            renderPane();
          },
        }),
        el('button', {
          class: 'cx-btn mini',
          html: icon('cursor', { size: 12 }) + '<span>Select matches</span>',
          disabled: !store.hasActiveFilters(),
          onClick: selectFiltered,
        }),
      ])
    );

    // What a filter does to everything else. Dimming keeps the shape of the plan
    // legible and nothing moves; hiding closes the rows up around what is left,
    // which reads better when you are down to a handful of objects.
    root.appendChild(
      field(
        'Non-matching objects',
        segmented({
          value: doc.settings.filterMode || 'dim',
          stretch: true,
          options: [
            { value: 'dim', label: 'Dim' },
            { value: 'hide', label: 'Hide' },
          ],
          onChange: (v) => {
            store.setSetting('filterMode', v, 'Change filter display');
            renderer.invalidateAll();
            renderer.requestRender();
          },
        }),
        'Hiding reflows the lanes around what is left. Exports always hide.'
      )
    );

    root.appendChild(field('Text contains', textInput({
      value: filters.text,
      placeholder: 'Free text',
      onInput: debounce((v) => {
        store.setFilters({ text: v });
        renderer.requestRender();
      }, 200),
    })));

    root.appendChild(
      el('div', { class: 'cx-row', style: { marginTop: '10px' } }, [
        field('From', textInput({
          type: 'date',
          value: filters.from || '',
          onChange: (v) => {
            store.setFilters({ from: v || null });
            renderer.requestRender();
          },
        })),
        field('To', textInput({
          type: 'date',
          value: filters.to || '',
          onChange: (v) => {
            store.setFilters({ to: v || null });
            renderer.requestRender();
          },
        })),
      ])
    );

    root.appendChild(checkGroup('Type', 'types', Object.entries(TYPES).map(([id, t]) => ({ value: id, label: t.label })), filters.types));
    root.appendChild(checkGroup('Status', 'statuses', listOptions('status').map((o) => ({ value: o.id, label: o.label })), filters.statuses));
    root.appendChild(checkGroup('Lane', 'lanes', store.orderedLanes().map((l) => ({ value: l.id, label: l.name })), filters.lanes));
    root.appendChild(checkGroup('Subsystem', 'subsystems', listOptions('subsystem').map((s) => ({ value: s.id, label: s.label })), filters.subsystems));

    const owners = facet(doc, 'owner');
    if (owners.length) {
      root.appendChild(checkGroup('Owner', 'owners', owners.map((o) => ({ value: o.value, label: `${o.value} (${o.count})` })), filters.owners));
    }
    const areas = facet(doc, 'area');
    if (areas.length) {
      root.appendChild(checkGroup('Area', 'areas', areas.map((a) => ({ value: a.value, label: `${a.value} (${a.count})` })), filters.areas));
    }
    const tags = facet(doc, 'tag');
    if (tags.length) {
      root.appendChild(checkGroup('Tag', 'tags', tags.map((t) => ({ value: t.value, label: `${t.value} (${t.count})` })), filters.tags));
    }
  }

  function checkGroup(title, dimension, options, selected) {
    const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } });
    for (const option of options) {
      wrap.appendChild(
        checkbox({
          label: option.label,
          checked: selected.includes(option.value),
          onChange: (on_) => {
            const current = store.getFilters()[dimension] || [];
            const next = on_ ? [...current, option.value] : current.filter((v) => v !== option.value);
            store.setFilters({ [dimension]: next });
            renderer.requestRender();
          },
        })
      );
    }
    return section(`${title}${selected.length ? ` (${selected.length})` : ''}`, [wrap], { collapsed: !selected.length });
  }

  /** Select every object that passes the active filters. */
  function selectFiltered() {
    const doc = store.getDoc();
    const predicate = filterPredicate(doc, store.getFilters());
    store.setSelection(doc.objects.filter(predicate).map((o) => o.id));
    renderer.requestRender();
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Legend settings
     ═══════════════════════════════════════════════════════════════════════ */

  function paneLegendSettings(root) {
    const doc = store.getDoc();
    const stats = summarise(doc);

    root.appendChild(
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px', marginBottom: '12px' } }, [
        toggle({
          label: 'Show legend on the canvas',
          checked: doc.settings.showLegend,
          onChange: (v) => {
            store.setSetting('showLegend', v, 'Toggle legend');
            renderer.requestRender();
          },
        }),
        toggle({
          label: 'Show minimap',
          checked: doc.settings.showMinimap,
          onChange: (v) => {
            store.setSetting('showMinimap', v, 'Toggle minimap');
            renderer.requestRender();
          },
        }),
      ])
    );

    const health = programmeHealth(doc);
    root.appendChild(
      el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' } }, [
        chipStat('Complete', `${health.percentComplete}%`, health.percentComplete > 60 ? 'good' : 'info'),
        chipStat('At risk', health.atRisk, health.atRisk ? 'bad' : 'good'),
        chipStat('Objects', stats.total, 'muted'),
      ])
    );

    const typeList = el('div', { class: 'cx-list' });
    for (const [type, count] of Array.from(stats.byType).sort((a, b) => b[1] - a[1])) {
      typeList.appendChild(
        el('div', { class: 'cx-listrow' }, [
          el('span', { class: 'cx-dot', style: { background: TYPES[type]?.accent || 'var(--neutral)' } }),
          el('div', { class: 'lr-main' }, [el('div', { class: 'lr-title', text: TYPES[type]?.label || type })]),
          el('span', { class: 'mono', style: { fontSize: 'var(--fs-tiny)', color: 'var(--text-subtle)' }, text: String(count) }),
        ])
      );
    }
    root.appendChild(section('Object types in this plan', [typeList]));

    const statusList = el('div', { class: 'cx-list' });
    for (const [status, count] of Array.from(stats.byStatus).sort((a, b) => b[1] - a[1])) {
      statusList.appendChild(
        el('div', { class: 'cx-listrow' }, [
          el('span', { class: 'cx-dot', style: { background: statusOf(status).color } }),
          el('div', { class: 'lr-main' }, [el('div', { class: 'lr-title', text: statusOf(status).label })]),
          el('span', { class: 'mono', style: { fontSize: 'var(--fs-tiny)', color: 'var(--text-subtle)' }, text: String(count) }),
        ])
      );
    }
    root.appendChild(section('Statuses in this plan', [statusList]));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Version history
     ═══════════════════════════════════════════════════════════════════════ */

  function paneHistory(root) {
    const entries = store.recentHistory(60);
    const state = store.historyState();

    root.appendChild(
      el('div', { style: { display: 'flex', gap: '6px', marginBottom: '11px' } }, [
        el('button', { class: 'cx-btn mini', html: icon('undo', { size: 12 }) + '<span>Undo</span>', disabled: !state.canUndo, onClick: () => { store.undo(); renderer.requestRender(); } }),
        el('button', { class: 'cx-btn mini', html: icon('redo', { size: 12 }) + '<span>Redo</span>', disabled: !state.canRedo, onClick: () => { store.redo(); renderer.requestRender(); } }),
      ])
    );

    if (!entries.length) {
      root.appendChild(emptyState({ iconName: 'history', title: 'No changes yet', message: 'Every edit is recorded here. Click an entry to roll the project back to just before it.' }));
      return;
    }

    const list = el('div', { class: 'cx-list' });
    for (const entry of entries) {
      list.appendChild(
        el('div', {
          class: 'cx-listrow',
          title: 'Roll back to just before this change',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Roll back',
              message: `Undo everything up to and including “${entry.label}”? You can redo afterwards.`,
              confirmLabel: 'Roll back',
            });
            if (ok) {
              store.revertTo(entry.id);
              renderer.requestRender();
              renderPane();
            }
          },
        }, [
          el('span', { style: { display: 'flex', color: 'var(--text-subtle)' }, html: icon('history', { size: 11 }) }),
          el('div', { class: 'lr-main' }, [
            el('div', { class: 'lr-title', text: entry.label }),
            el('div', { class: 'lr-meta', text: `${fmtTimestamp(entry.time)} · ${entry.summary}` }),
          ]),
        ])
      );
    }
    root.appendChild(list);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Import / export
     ═══════════════════════════════════════════════════════════════════════ */

  function paneIo(root) {
    root.appendChild(
      section('Export', [
        el('div', { class: 'cx-hint', text: 'Exports honour the active filters, so a filtered view exports as a filtered plan.' }),
        exportButton('PDF (vector, multi-page)', 'print', () => openPdfDialog()),
        exportButton('Print / Save as PDF', 'print', () => exporters.printPlan()),
        exportButton('SVG (vector)', 'image', () => exporters.exportSvg()),
        exportButton('PNG (raster)', 'image', () => exporters.exportPng({ scale: 2 })),
        exportButton('JPEG (raster)', 'image', () => exporters.exportJpeg({ scale: 2 })),
        exportButton('CSV (objects)', 'table', () => exporters.exportCsv()),
        exportButton('CSV (dependencies)', 'table', () => exporters.exportLinksCsv()),
        exportButton('JSON (full project)', 'save', () => exporters.exportJson()),
      ])
    );

    root.appendChild(
      section('Import', [
        el('div', { class: 'cx-hint', text: 'JSON restores a whole project. CSV, TSV and Excel files are mapped by column name — Microsoft Project CSV exports are recognised automatically.' }),
        el('button', {
          class: 'cx-btn mini',
          style: { justifyContent: 'flex-start', width: '100%' },
          html: icon('upload', { size: 12 }) + '<span>Choose a file…</span>',
          onClick: chooseImport,
        }),
        el('div', {
          class: 'att-drop',
          style: { marginTop: '8px' },
          html: icon('download', { size: 14 }) + ' <span>…or drop a file here</span>',
          onDragover: (e) => {
            e.preventDefault();
            e.currentTarget.classList.add('over');
          },
          onDragleave: (e) => e.currentTarget.classList.remove('over'),
          onDrop: async (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('over');
            const files = Array.from(e.dataTransfer?.files || []);
            if (files.length) await runImport(files[0]);
          },
        }),
      ])
    );

    root.appendChild(
      section('Project', [
        el('button', { class: 'cx-btn mini', style: { justifyContent: 'flex-start', width: '100%' }, html: icon('plus', { size: 12 }) + '<span>New project…</span>', onClick: () => cmd.newProject() }),
        el('button', { class: 'cx-btn mini', style: { justifyContent: 'flex-start', width: '100%' }, html: icon('save', { size: 12 }) + '<span>Save a restore point</span>', onClick: () => cmd.saveSnapshot() }),
      ])
    );
  }

  function exportButton(label, iconName, onClick) {
    return el('button', {
      class: 'cx-btn mini',
      style: { justifyContent: 'flex-start', width: '100%' },
      html: icon(iconName, { size: 12 }) + `<span>${label}</span>`,
      onClick,
    });
  }

  function exportMenu(anchor) {
    const rect = anchor.getBoundingClientRect();
    contextMenu(rect.left, rect.bottom + 4, [
      { heading: 'Export' },
      { label: 'PDF…', icon: 'print', onClick: () => openPdfDialog() },
      { label: 'Print / Save as PDF', icon: 'print', key: 'mod+p', onClick: () => exporters.printPlan() },
      'sep',
      { label: 'SVG', icon: 'image', onClick: () => exporters.exportSvg() },
      { label: 'PNG', icon: 'image', onClick: () => exporters.exportPng({ scale: 2 }) },
      { label: 'JPEG', icon: 'image', onClick: () => exporters.exportJpeg({ scale: 2 }) },
      'sep',
      { label: 'CSV — objects', icon: 'table', onClick: () => exporters.exportCsv() },
      { label: 'CSV — dependencies', icon: 'table', onClick: () => exporters.exportLinksCsv() },
      { label: 'CSV — baseline variance', icon: 'compare', onClick: () => exporters.exportBaselineCsv() },
      'sep',
      { label: 'JSON — full project', icon: 'save', onClick: () => exporters.exportJson() },
      'sep',
      { label: 'Import a file…', icon: 'upload', onClick: chooseImport },
    ]);
  }

  function openPdfDialog() {
    let pageSize = 'a3';
    let density = 'normal';
    let multiPage = true;

    openModal({
      title: 'Export PDF',
      subtitle: 'Vector output — text stays selectable and the drawing stays sharp at any zoom.',
      body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } }, [
        field('Page size', selectInput({
          value: pageSize,
          options: exporters.PDF_PAGE_SIZES,
          onChange: (v) => {
            pageSize = v;
          },
        })),
        field('Detail', segmented({
          value: density,
          stretch: true,
          options: [
            { value: 'coarse', label: 'Overview' },
            { value: 'normal', label: 'Standard' },
            { value: 'fine', label: 'Detailed' },
          ],
          onChange: (v) => {
            density = v;
          },
        }), 'Detailed produces more pages but wider bars and more readable labels.'),
        toggle({ label: 'Split wide plans across multiple pages', checked: true, onChange: (v) => { multiPage = v; } }),
      ]),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Export PDF',
          kind: 'primary',
          onClick: () => {
            exporters.exportPdf({ pageSize, density, multiPage });
            toast({ tone: 'good', title: 'PDF exported' });
          },
        },
      ],
    });
  }

  async function chooseImport() {
    const files = await pickFiles({ accept: '.json,.csv,.tsv,.txt,.xlsx,.xlsm' });
    if (files.length) await runImport(files[0]);
  }

  async function runImport(file) {
    toast({ tone: 'info', title: 'Reading file…', message: file.name, timeout: 1500 });
    const result = await importFile(file);

    if (result.kind === 'error') {
      openModal({
        title: 'Import failed',
        body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
          el('div', { class: 'cx-hint', text: `${file.name} could not be imported.` }),
          ...result.errors.map((e) => el('div', { style: { color: 'var(--bad)', fontSize: 'var(--fs-small)' }, text: e })),
        ]),
        actions: [{ label: 'Close', kind: 'primary' }],
      });
      return;
    }

    const warnings = result.warnings.length
      ? el('div', { style: { marginTop: '10px' } }, [
          el('div', { class: 'eyebrow', style: { marginBottom: '4px' }, text: 'Notes' }),
          ...result.warnings.map((w) => el('div', { style: { color: 'var(--warn)', fontSize: 'var(--fs-tiny)', marginBottom: '3px' }, text: w })),
        ])
      : null;

    if (result.kind === 'project') {
      openModal({
        title: 'Import project',
        subtitle: file.name,
        body: el('div', {}, [
          el('div', { style: { fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }, text: `“${result.doc.name}” — ${result.summary}.` }),
          el('div', { class: 'cx-hint', style: { marginTop: '8px' }, text: 'Your current project is backed up first and can be restored from Backups.' }),
          warnings,
        ]),
        actions: [
          { label: 'Cancel' },
          {
            label: 'Replace current project',
            kind: 'primary',
            onClick: async () => {
              await makeBackup('before-import');
              store.replaceDoc(result.doc, 'import');
              cmd.fitAll();
              toast({ tone: 'good', title: 'Project imported', message: result.summary });
            },
          },
        ],
      });
      return;
    }

    /* Row-based import: offer merge or replace. */
    const preview = el('div', { class: 'cx-list', style: { maxHeight: '220px', overflowY: 'auto', marginTop: '10px' } });
    for (const obj of result.objects.slice(0, 12)) {
      preview.appendChild(
        el('div', { class: 'cx-listrow' }, [
          el('span', { class: 'cx-dot', style: { background: TYPES[obj.type]?.accent } }),
          el('div', { class: 'lr-main' }, [
            el('div', { class: 'lr-title', text: obj.title }),
            el('div', { class: 'lr-meta', text: `${TYPES[obj.type]?.label} · ${fmtDate(obj.start, 'medium')}${TYPES[obj.type]?.duration ? ` → ${fmtDate(obj.end, 'medium')}` : ''}` }),
          ]),
        ])
      );
    }
    if (result.objects.length > 12) {
      preview.appendChild(el('div', { class: 'cx-hint', style: { padding: '6px 8px' }, text: `…and ${result.objects.length - 12} more.` }));
    }

    openModal({
      title: 'Import data',
      subtitle: file.name,
      size: 'wide',
      body: el('div', {}, [
        el('div', { style: { fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }, text: result.summary }),
        warnings,
        preview,
      ]),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Add to current project',
          onClick: async () => {
            await makeBackup('before-import');
            store.replaceDoc(buildDocFromRows(result, { mode: 'merge' }), 'import');
            cmd.fitAll();
            toast({ tone: 'good', title: 'Rows imported', message: result.summary });
          },
        },
        {
          label: 'Replace project',
          kind: 'primary',
          onClick: async () => {
            await makeBackup('before-import');
            store.replaceDoc(buildDocFromRows(result, { mode: 'replace', name: file.name.replace(/\.[^.]+$/, '') }), 'import');
            cmd.fitAll();
            toast({ tone: 'good', title: 'Project imported', message: result.summary });
          },
        },
      ],
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Backups
     ═══════════════════════════════════════════════════════════════════════ */

  function paneBackups(root) {
    root.appendChild(
      el('div', { style: { display: 'flex', gap: '6px', marginBottom: '11px' } }, [
        el('button', {
          class: 'cx-btn mini primary',
          html: icon('save', { size: 12 }) + '<span>Back up now</span>',
          onClick: async () => {
            await makeBackup('manual');
            renderPane();
            toast({ tone: 'good', title: 'Backup created' });
          },
        }),
      ])
    );

    const list = el('div', { class: 'cx-list' });
    root.appendChild(list);
    list.appendChild(el('div', { class: 'cx-hint', text: 'Loading backups…' }));

    listBackups().then((backups) => {
      clear(list);
      if (!backups.length) {
        list.appendChild(emptyState({
          iconName: 'save',
          title: 'No backups yet',
          message: 'Backups are taken automatically every hour and every 100 edits, and before any import.',
        }));
        return;
      }

      for (const backup of backups) {
        list.appendChild(
          el('div', { class: 'cx-listrow' }, [
            el('span', { style: { display: 'flex', color: 'var(--text-subtle)' }, html: icon('save', { size: 11 }) }),
            el('div', { class: 'lr-main' }, [
              el('div', { class: 'lr-title', text: backup.name || 'Project' }),
              el('div', { class: 'lr-meta', text: `${fmtTimestamp(backup.time)} · ${backup.objects} objects · ${backup.reason}${backup.size ? ' · ' + bytes(backup.size) : ''}` }),
            ]),
            el('div', { class: 'lr-actions' }, [
              iconBtn('refresh', 'Restore this backup', () => restoreBackup(backup)),
              iconBtn('download', 'Download as JSON', async () => {
                const doc = await loadBackup(backup.key);
                if (doc) download(`${doc.name || 'project'}-${toISO(backup.time)}.json`, JSON.stringify(doc, null, 2), 'application/json');
              }),
              iconBtn('trash', 'Delete backup', async () => {
                await deleteBackup(backup.key);
                renderPane();
              }),
            ]),
          ])
        );
      }
    });
  }

  async function restoreBackup(backup) {
    const ok = await confirmDialog({
      title: 'Restore backup',
      message: `Replace the current project with the backup from ${fmtTimestamp(backup.time)}? The current state is backed up first.`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;

    await makeBackup('before-restore');
    const doc = await loadBackup(backup.key);
    if (!doc) {
      toast({ tone: 'bad', title: 'Backup could not be read' });
      return;
    }
    store.replaceDoc(doc, 'restore');
    cmd.fitAll();
    toast({ tone: 'good', title: 'Backup restored' });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Projects (hosted deployments only)
     ═══════════════════════════════════════════════════════════════════════ */

  const ROLE_TONE = { owner: 'good', editor: 'info', viewer: 'muted' };
  const ROLE_WORD = { owner: 'Owner', editor: 'Editor', viewer: 'View only' };

  /**
   * Every plan this account can reach, with the role that governs it.
   *
   * The role badge is the whole point of the pane: knowing *before* you open
   * something whether you will be able to change it is the difference between a
   * read-only project and a broken one.
   */
  function paneProjects(root) {
    if (!cloud.isConfigured()) {
      root.appendChild(
        emptyState({
          iconName: 'folder',
          title: 'Local project',
          message: 'This build keeps everything in this browser. Projects and sharing appear when it is connected to a backend.',
        })
      );
      return;
    }

    if (!cloud.isSignedIn()) {
      root.appendChild(
        emptyState({
          iconName: 'user',
          title: 'Not signed in',
          message: 'Sign in to keep projects on the server and share them.',
          action: { label: 'Sign in', onClick: () => window.location.reload() },
        })
      );
      return;
    }

    const actions = el('div', { style: { display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' } }, [
      el('button', {
        class: 'cx-btn mini primary',
        html: icon('plus', { size: 12 }) + '<span>New project</span>',
        onClick: () => newCloudProject(),
      }),
      el('button', {
        class: 'cx-btn mini',
        html: icon('share', { size: 12 }) + '<span>Share</span>',
        title: 'Who can see the open project',
        disabled: !cloud.getProjectId(),
        onClick: () => openShareDialog(cloud.getProjectId(), store.getDoc().name),
      }),
    ]);
    root.appendChild(actions);

    const list = el('div', { class: 'cx-list' });
    root.appendChild(list);
    list.appendChild(skeleton(3));

    cloud
      .listProjects()
      .then((projects) => {
        clear(list);
        if (!projects.length) {
          list.appendChild(emptyState({ iconName: 'folder', title: 'No projects yet', message: 'Create one to get started.' }));
          return;
        }
        for (const project of projects) list.appendChild(projectRow(project));
      })
      .catch((err) => {
        clear(list);
        list.appendChild(
          emptyState({ iconName: 'warning', title: 'Could not load your projects', message: err.message })
        );
      });
  }

  function projectRow(project) {
    const open = project.id === cloud.getProjectId();

    return el('div', {
      class: 'cx-listrow' + (open ? ' active' : ''),
      dataset: { project: project.id },
      onClick: () => (open ? null : openCloudProject(project)),
    }, [
      el('span', { class: 'cx-dot', style: { background: open ? 'var(--accent)' : 'var(--text-subtle)' } }),
      el('div', { class: 'lr-main' }, [
        el('div', { class: 'lr-title', text: project.name }),
        el('div', {
          class: 'lr-meta',
          text: [
            `${project.objects} object${project.objects === 1 ? '' : 's'}`,
            fmtTimestamp(project.savedAt),
            project.role === 'owner' ? null : `owner ${project.ownerEmail || '—'}`,
            project.members > 1 ? `${project.members} people` : null,
          ].filter(Boolean).join(' · '),
        }),
      ]),
      badge(ROLE_WORD[project.role] || project.role, ROLE_TONE[project.role] || 'muted'),
      el('div', { class: 'lr-actions' }, [
        el('button', {
          class: 'cx-btn icon mini ghost',
          title: 'Share',
          'aria-label': `Share ${project.name}`,
          html: icon('share', { size: 11 }),
          onClick: (e) => {
            e.stopPropagation();
            openShareDialog(project.id, project.name);
          },
        }),
        project.role === 'owner'
          ? el('button', {
              class: 'cx-btn icon mini ghost',
              title: 'Rename',
              'aria-label': `Rename ${project.name}`,
              html: icon('edit', { size: 11 }),
              onClick: async (e) => {
                e.stopPropagation();
                const name = await promptDialog({ title: 'Rename project', label: 'Name', value: project.name });
                if (!name || name === project.name) return;
                try {
                  await cloud.renameProject(project.id, name);
                  if (project.id === cloud.getProjectId()) store.setMeta({ name }, 'Rename project');
                  renderPane();
                } catch (err) {
                  toast({ tone: 'bad', title: 'Could not rename', message: err.message });
                }
              },
            })
          : null,
        project.role === 'owner'
          ? el('button', {
              class: 'cx-btn icon mini ghost',
              title: 'Delete',
              'aria-label': `Delete ${project.name}`,
              html: icon('trash', { size: 11 }),
              onClick: (e) => {
                e.stopPropagation();
                removeCloudProject(project);
              },
            })
          : null,
      ].filter(Boolean)),
    ]);
  }

  async function openCloudProject(project) {
    try {
      const doc = await switchProject(project.id);
      store.replaceDoc(doc, 'load');
      renderer.requestRender();
      renderPane();
      toast({
        tone: 'good',
        title: `Opened "${project.name}"`,
        message: project.role === 'viewer' ? 'You have view-only access to this project.' : undefined,
      });
    } catch (err) {
      toast({ tone: 'bad', title: 'Could not open', message: err.message });
    }
  }

  async function newCloudProject() {
    const name = await promptDialog({ title: 'New project', label: 'Name', value: 'Untitled Programme' });
    if (!name) return;
    try {
      const doc = makeProject(name);
      await createCloudProject(doc);
      store.replaceDoc(doc, 'load');
      renderer.requestRender();
      renderPane();
      toast({ tone: 'good', title: 'Project created', message: `"${name}" is yours — share it from here.` });
    } catch (err) {
      toast({ tone: 'bad', title: 'Could not create the project', message: err.message });
    }
  }

  async function removeCloudProject(project) {
    const ok = await confirmDialog({
      title: `Delete "${project.name}"?`,
      message: 'The project, its backups and everyone\'s access to it are removed. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await cloud.deleteProject(project.id);
      toast({ tone: 'good', title: 'Deleted' });
      if (project.id === cloud.getProjectId()) window.location.reload();
      else renderPane();
    } catch (err) {
      toast({ tone: 'bad', title: 'Could not delete', message: err.message });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Dropdown lists
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Every editable vocabulary in one place. The same editor is behind the
   * "Manage…" row at the foot of each dropdown, so there is one behaviour to
   * learn and one implementation to maintain.
   */
  function paneLists(root) {
    root.appendChild(
      el('div', { class: 'cx-hint', style: { marginBottom: '12px' } }, [
        el('span', { text: 'Statuses, subsystems and the rest are project data — add, rename, recolour, reorder or remove them. Changes are undoable and travel with the file.' }),
      ])
    );
    root.appendChild(listEditor().node);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Settings
     ═══════════════════════════════════════════════════════════════════════ */

  function paneSettings(root) {
    const doc = store.getDoc();
    const settings = doc.settings;
    const set = (key, value, label) => {
      store.setSetting(key, value, label || 'Change setting');
      renderer.requestRender();
    };

    root.appendChild(
      section('Appearance', [
        field('Theme', selectInput({
          value: getTheme(),
          options: THEMES.map((t) => ({ value: t.id, label: t.label })),
          onChange: (v) => applyTheme(v),
        })),
        toggle({ label: 'Gridlines', checked: settings.gridlines, onChange: (v) => set('gridlines', v, 'Toggle gridlines') }),
        field('Grid density', segmented({
          value: settings.gridDensity,
          stretch: true,
          options: [
            { value: 'auto', label: 'Auto' },
            { value: 'major', label: 'Major' },
            { value: 'off', label: 'Off' },
          ],
          onChange: (v) => set('gridDensity', v, 'Change grid density'),
        })),
        toggle({ label: 'Shade weekends', checked: settings.showWeekends, onChange: (v) => set('showWeekends', v, 'Toggle weekends') }),
        toggle({ label: 'Show progress fill', checked: settings.showProgress, onChange: (v) => set('showProgress', v, 'Toggle progress') }),
        toggle({ label: 'Show dependency arrows', checked: settings.showConnectors, onChange: (v) => set('showConnectors', v, 'Toggle connectors') }),
      ])
    );

    root.appendChild(
      section('Timeline behaviour', [
        field('Snap dragged dates to', selectInput({
          value: settings.snap,
          options: [
            { value: 'off', label: 'No snapping' },
            { value: 'day', label: 'Day' },
            { value: 'workday', label: 'Working day' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
            { value: 'quarter', label: 'Quarter' },
          ],
          onChange: (v) => set('snap', v, 'Change snapping'),
        })),
        field('Date format', selectInput({
          value: settings.dateOrder || 'mdy',
          options: DATE_ORDERS.map((o) => ({ value: o.id, label: o.label })),
          onChange: (v) => set('dateOrder', v, 'Change date format'),
        }), 'Display only — files always store dates as YYYY-MM-DD.'),
        field('Week starts on', segmented({
          value: String(settings.weekStart),
          stretch: true,
          options: [
            { value: '1', label: 'Monday' },
            { value: '0', label: 'Sunday' },
          ],
          onChange: (v) => set('weekStart', Number(v), 'Change week start'),
        })),
        field('Mouse wheel', segmented({
          value: settings.wheelMode || 'zoom',
          stretch: true,
          options: [
            { value: 'zoom', label: 'Zooms' },
            { value: 'scroll', label: 'Scrolls' },
          ],
          onChange: (v) => set('wheelMode', v, 'Change wheel behaviour'),
        }), 'Ctrl/⌘ + wheel always zooms, whichever is chosen.'),
        field('Simulate "today" as', textInput({
          type: 'date',
          value: settings.todayOverride || '',
          onChange: (v) => set('todayOverride', v || null, 'Change planning date'),
        }), 'Leave empty to follow the system clock.'),
      ])
    );

    root.appendChild(
      section('Autosave & backups', [
        el('div', { class: 'cx-hint', text: 'Every edit is saved automatically. There is no Save button, and nothing is sent anywhere.' }),
        field('Automatic backup interval (minutes)', numberInput({
          value: settings.autoBackupMinutes,
          min: 0,
          max: 720,
          step: 15,
          onChange: (v) => {
            set('autoBackupMinutes', v, 'Change backup interval');
            refreshBackupSchedule();
          },
        }), '0 disables scheduled backups.'),
        field('Backup after this many edits', numberInput({
          value: settings.backupEveryEdits,
          min: 0,
          max: 1000,
          step: 25,
          onChange: (v) => set('backupEveryEdits', v, 'Change backup frequency'),
        })),
        field('Backups to keep', numberInput({
          value: settings.backupKeep,
          min: 1,
          max: 200,
          onChange: (v) => set('backupKeep', v, 'Change backup retention'),
        })),
      ])
    );

    const storageBox = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    storageBox.appendChild(el('div', { class: 'cx-hint', text: 'Reading storage…' }));
    root.appendChild(section('Storage', [
      storageBox,
      el('button', {
        class: 'cx-btn mini',
        html: icon('trash', { size: 12 }) + '<span>Remove orphaned attachment data</span>',
        onClick: async () => {
          const removed = await collectGarbage();
          toast({ tone: 'good', title: `${removed} orphaned file${removed === 1 ? '' : 's'} removed` });
          renderPane();
        },
      }),
    ]));

    usage().then((report) => {
      clear(storageBox);
      storageBox.append(
        statRow('Backend', report.backend),
        statRow('Project size', report.document.label),
        statRow('Attachments', `${report.attachments.count} file${report.attachments.count === 1 ? '' : 's'} · ${report.attachments.label}`),
        report.quota ? statRow('Browser quota', `${bytes(report.quota.used)} of ${bytes(report.quota.total)} used`) : null
      );
      if (isFallback()) {
        storageBox.appendChild(el('div', { style: { color: 'var(--warn)', fontSize: 'var(--fs-tiny)', marginTop: '4px' }, text: 'IndexedDB is unavailable in this browser session, so attachments are disabled and only a small number of backups can be kept.' }));
      }
    });

    root.appendChild(
      section('About', [
        el('div', { class: 'cx-hint', text: 'CX Timeline — a local-first interactive timeline and commissioning planner. All data stays on this computer.' }),
        el('button', { class: 'cx-btn mini', html: icon('keyboard', { size: 12 }) + '<span>Keyboard shortcuts</span>', onClick: () => cmd.showShortcuts() }),
      ])
    );
  }

  function statRow(label, value) {
    return el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: 'var(--fs-tiny)' } }, [
      el('span', { style: { color: 'var(--text-subtle)' }, text: label }),
      el('span', { class: 'mono', style: { color: 'var(--text-muted)' }, text: value }),
    ]);
  }

  /* ── Shared helpers ────────────────────────────────────────────────────── */

  function iconBtn(name, title, onClick) {
    return el('button', {
      class: 'cx-btn icon mini ghost',
      title,
      'aria-label': title,
      html: icon(name, { size: 11 }),
      onClick: (e) => {
        e.stopPropagation();
        onClick(e);
      },
    });
  }

  /** Drag-to-resize for the dock and inspector. */
  function installResizer(handle, target, min, max) {
    let startX = 0;
    let startWidth = 0;
    let dragging = false;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startWidth = target.getBoundingClientRect().width;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const delta = handle.classList.contains('left') ? startX - e.clientX : e.clientX - startX;
      target.style.width = `${Math.max(min, Math.min(max, startWidth + delta))}px`;
      renderer.measure();
      renderer.requestRender();
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
    });
  }

  Object.defineProperty(__x, "PANES", { get: () => PANES, enumerable: true });
  Object.defineProperty(__x, "buildPanels", { get: () => buildPanels, enumerable: true });
  Object.defineProperty(__x, "currentPane", { get: () => currentPane, enumerable: true });
  Object.defineProperty(__x, "showPane", { get: () => showPane, enumerable: true });
  Object.defineProperty(__x, "toggleDock", { get: () => toggleDock, enumerable: true });
  Object.defineProperty(__x, "installResizer", { get: () => installResizer, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/shell.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/shell.js"] = function (__x, __req) {
  /**
   * The application shell: side navigation, toolbar and status bar.
   *
   * The shell owns no document state — it reads the store, renders controls and
   * dispatches actions. Everything it shows updates from events, so a change
   * made in the inspector, by a shortcut or by an import all light up the same
   * indicators.
   *
   * Imports: util, events, dates, model, store, storage, query, viewport,
   *          renderer, icons, components, theme, panels.
   */

  const { el, clear, debounce } = __req("core/util.js");
  const { on, emit, EV } = __req("core/events.js");
  const { fmtDate, fmtTimestamp, toISO } = __req("core/dates.js");
  const { TYPES, typeGroups, effectiveToday, projectExtent } = __req("core/model.js");
  const store = __req("core/store.js");
  const { isFallback, isHosted } = __req("core/storage.js");
  const cloud = __req("core/cloud.js");
  const { linkViolations } = __req("core/analysis.js");
  const viewport = __req("timeline/viewport.js");
  const renderer = __req("timeline/renderer.js");
  const { icon } = __req("ui/icons.js");
  const { contextMenu, popover, closePopover, promptDialog, toast, segmented, keyHint, attachTooltip } = __req("ui/components.js");
  const { THEMES, applyTheme, getTheme } = __req("ui/theme.js");
  const { showPane, currentPane, PANES } = __req("ui/panels.js");
  const { accountBlock, openShareDialog } = __req("ui/auth.js");

  /** Sidebar structure — sections of dock panes. */
  const NAV = [
    {
      section: 'Workspace',
      items: [
        { pane: 'projects', label: 'Projects', icon: 'folder', hosted: true },
        { pane: 'lanes', label: 'Lanes', icon: 'layers' },
        { pane: 'palette', label: 'Add Objects', icon: 'plus' },
        { pane: 'outline', label: 'Outline', icon: 'list' },
      ],
    },
    {
      section: 'Plan',
      items: [
        { pane: 'releases', label: 'Releases', icon: 'package' },
        { pane: 'campaigns', label: 'Campaigns', icon: 'target' },
        { pane: 'risks', label: 'Risks & Issues', icon: 'warning' },
        { pane: 'links', label: 'Dependencies', icon: 'link' },
        { pane: 'baselines', label: 'Baselines', icon: 'bookmark' },
      ],
    },
    {
      section: 'Review',
      items: [
        { pane: 'search', label: 'Search', icon: 'search' },
        { pane: 'filters', label: 'Filters', icon: 'filter' },
        { pane: 'legend', label: 'Legend', icon: 'palette' },
        { pane: 'history', label: 'Version History', icon: 'history' },
      ],
    },
    {
      section: 'Data',
      items: [
        { pane: 'io', label: 'Import / Export', icon: 'download' },
        { pane: 'backups', label: 'Backups', icon: 'save' },
        { pane: 'lists', label: 'Dropdown Lists', icon: 'list' },
        { pane: 'team', label: 'Team & Access', icon: 'users', hosted: true, admin: true },
        { pane: 'settings', label: 'Settings', icon: 'gear' },
      ],
    },
  ];

  const dom = {};

  /* ══════════════════════════════════════════════════════════════════════════
     Build
     ═══════════════════════════════════════════════════════════════════════ */

  function buildShell() {
    dom.sidenav = document.getElementById('sidenav');
    dom.toolbar = document.getElementById('toolbar');
    dom.statusbar = document.getElementById('statusbar');

    buildSidenav();
    buildToolbar();
    buildStatusbar();
    wireEvents();
  }

  /* ── Side navigation ───────────────────────────────────────────────────── */

  function buildSidenav() {
    clear(dom.sidenav);
    const doc = store.getDoc();

    dom.sidenav.appendChild(
      el('div', { class: 'sidenav-brand' }, [
        el('div', { class: 'brand-mark' }),
        el('div', { class: 'sidenav-brand-text' }, [
          el('div', { class: 'sidenav-brand-name', text: 'CX Timeline' }),
          el('div', { class: 'sidenav-brand-sub', text: 'Commissioning Planner' }),
        ]),
      ])
    );

    dom.navLinks = el('div', { class: 'sidenav-links' });
    for (const group of NAV) {
      dom.navLinks.appendChild(el('div', { class: 'sidenav-section-label', text: group.section }));
      for (const item of group.items) {
        // Some panes only mean anything with a backend behind them, and one is
        // for administrators. Both are re-evaluated on auth:changed, which
        // rebuilds the sidebar.
        if (item.hosted && !cloud.isConfigured()) continue;
        if (item.admin && !cloud.isAdmin()) continue;
        const link = el('a', {
          class: 'nav-link',
          href: '#',
          dataset: { pane: item.pane },
          onClick: (e) => {
            e.preventDefault();
            showPane(item.pane);
          },
        }, [
          el('span', { class: 'nav-icon', html: icon(item.icon, { size: 16 }) }),
          el('span', { class: 'nav-label', text: item.label }),
          el('span', { class: 'nav-count', dataset: { countFor: item.pane } }),
        ]);
        dom.navLinks.appendChild(link);
      }
    }
    dom.sidenav.appendChild(dom.navLinks);

    dom.sidenav.appendChild(
      el('div', { class: 'sidenav-footer' }, [
        cloud.isConfigured() ? accountBlock() : null,
        el('div', { class: 'sidenav-project-tag', dataset: { projectTag: '1' }, text: doc.programme || doc.client || fallbackTag() }),
        el('button', {
          class: 'cx-btn mini',
          html: icon('maximize', { size: 12 }) + '<span>Present</span>',
          onClick: () => emit(EV.PRESENT_MODE, { on: !document.body.classList.contains('presenting') }),
        }),
      ].filter(Boolean))
    );

    updateNav();
  }

  /** What to call a project that has not been given a client or programme. */
  function fallbackTag() {
    if (!cloud.isConfigured()) return 'Local project';
    return { owner: 'You own this', editor: 'Shared with you', viewer: 'View only' }[cloud.getRole()] || 'Untitled';
  }

  function updateNav() {
    const doc = store.getDoc();
    const counts = {
      lanes: doc.lanes.length,
      outline: doc.objects.length,
      releases: doc.objects.filter((o) => o.type === 'release').length,
      campaigns: doc.objects.filter((o) => o.type === 'campaign').length,
      risks: doc.objects.filter((o) => o.type === 'risk' || o.type === 'issue').length,
      links: doc.links.length,
      baselines: doc.baselines.length,
    };

    for (const link of dom.navLinks.querySelectorAll('.nav-link')) {
      link.classList.toggle('active', link.dataset.pane === currentPane());
    }
    for (const node of dom.navLinks.querySelectorAll('[data-count-for]')) {
      const value = counts[node.dataset.countFor];
      node.textContent = value ? String(value) : '';
    }

    const tag = dom.sidenav.querySelector('[data-project-tag]');
    if (tag) tag.textContent = doc.programme || doc.client || fallbackTag();
  }

  /* ── Toolbar ───────────────────────────────────────────────────────────── */

  function buildToolbar() {
    clear(dom.toolbar);

    /* Project title */
    dom.title = el('div', { class: 'tb-title', title: 'Click to rename the project' }, [
      el('div', { class: 'tt-name' }),
      el('div', { class: 'tt-meta' }),
    ]);
    dom.title.addEventListener('click', renameProject);
    dom.toolbar.append(dom.title, el('div', { class: 'tb-sep' }));

    /* Undo / redo */
    dom.undoBtn = toolButton('undo', 'Undo', () => store.undo(), 'mod+z');
    dom.redoBtn = toolButton('redo', 'Redo', () => store.redo(), 'mod+shift+z');
    dom.toolbar.append(el('div', { class: 'tb-group editing' }, [dom.undoBtn, dom.redoBtn]), el('div', { class: 'tb-sep' }));

    /* Tools */
    dom.selectBtn = toolButton('cursor', 'Select', () => store.setTool('select'), 'v');
    dom.panBtn = toolButton('hand', 'Pan (or hold Space)', () => store.setTool('pan'), 'h');
    dom.addBtn = el('button', {
      class: 'cx-btn',
      html: icon('plus', { size: 14 }) + '<span>Add</span>' + icon('chevron-down', { size: 11 }),
      onClick: (e) => openAddMenu(e.currentTarget),
    });
    // The Add tool is an editing affordance; select and pan are how a reader
    // moves around, so they stay.
    dom.toolbar.append(
      el('div', { class: 'tb-group' }, [dom.selectBtn, dom.panBtn]),
      el('div', { class: 'tb-group editing' }, [dom.addBtn]),
      el('div', { class: 'tb-sep' })
    );

    /* Scale */
    dom.scaleSeg = segmented({
      value: viewport.currentScale().id,
      options: [
        { value: 'day', label: 'D', title: 'Day scale' },
        { value: 'week', label: 'W', title: 'Week scale' },
        { value: 'month', label: 'M', title: 'Month scale' },
        { value: 'quarter', label: 'Q', title: 'Quarter scale' },
        { value: 'year', label: 'Y', title: 'Year scale' },
      ],
      onChange: (id) => {
        viewport.setScalePreset(id);
        renderer.requestRender();
      },
    });
    dom.toolbar.append(el('div', { class: 'tb-group' }, [dom.scaleSeg]));

    /* Zoom & navigation */
    dom.toolbar.append(
      el('div', { class: 'tb-group' }, [
        toolButton('zoom-out', 'Zoom out', () => {
          viewport.zoomBy(0.7);
          renderer.requestRender();
        }),
        toolButton('zoom-in', 'Zoom in', () => {
          viewport.zoomBy(1.42);
          renderer.requestRender();
        }),
        toolButton('expand', 'Fit whole plan', fitAll, 'mod+0'),
        toolButton('calendar', 'Go to today', goToToday, 't'),
      ]),
      el('div', { class: 'tb-sep' })
    );

    /* Snap */
    dom.snapSelect = el('select', {
      class: 'cx-select mini',
      title: 'Snap dragged dates to…',
      style: { width: '108px' },
      onChange: (e) => store.setSetting('snap', e.target.value, 'Change snapping'),
    });
    for (const [value, label] of [
      ['off', 'No snap'],
      ['day', 'Snap: day'],
      ['workday', 'Snap: workday'],
      ['week', 'Snap: week'],
      ['month', 'Snap: month'],
      ['quarter', 'Snap: quarter'],
    ]) {
      dom.snapSelect.appendChild(el('option', { value, text: label }));
    }
    dom.toolbar.append(el('div', { class: 'tb-group' }, [dom.snapSelect]), el('div', { class: 'tb-sep' }));

    /* View toggles */
    dom.toggles = el('div', { class: 'tb-group' });
    for (const [key, iconName, title] of [
      ['gridlines', 'grid', 'Gridlines'],
      ['showConnectors', 'link', 'Dependency arrows'],
      ['showProgress', 'activity', 'Progress fill'],
      ['criticalPath', 'route', 'Critical path'],
      ['showBaseline', 'compare', 'Baseline comparison'],
      ['showMinimap', 'map', 'Minimap'],
      ['showLegend', 'palette', 'Legend'],
    ]) {
      const button = el('button', {
        class: 'cx-btn icon',
        title,
        'aria-label': title,
        dataset: { toggle: key },
        html: icon(iconName, { size: 14 }),
        onClick: () => {
          store.setSetting(key, !store.getSettings()[key], `Toggle ${title.toLowerCase()}`);
          renderer.requestRender();
        },
      });
      dom.toggles.appendChild(button);
    }
    dom.toolbar.append(dom.toggles, el('div', { class: 'tb-spacer' }));

    /* Right cluster */
    dom.toolbar.append(
      el('div', { class: 'tb-group' }, [
        el('button', {
          class: 'cx-btn icon',
          title: 'Theme',
          'aria-label': 'Choose theme',
          html: icon('palette', { size: 14 }),
          onClick: (e) => openThemeMenu(e.currentTarget),
        }),
        el('button', {
          class: 'cx-btn',
          title: 'Export the plan',
          html: icon('download', { size: 14 }) + '<span>Export</span>',
          onClick: (e) => emit('ui:export-menu', { anchor: e.currentTarget }),
        }),
        el('button', {
          class: 'cx-btn icon',
          title: 'Keyboard shortcuts',
          'aria-label': 'Keyboard shortcuts',
          html: icon('keyboard', { size: 14 }),
          onClick: () => emit('ui:shortcuts'),
        }),
        el('button', {
          class: 'cx-btn icon',
          title: 'Presentation mode',
          'aria-label': 'Presentation mode',
          html: icon('maximize', { size: 14 }),
          onClick: () => emit(EV.PRESENT_MODE, { on: !document.body.classList.contains('presenting') }),
        }),
      ].filter(Boolean))
    );

    refreshToolbar();
  }

  function toolButton(iconName, title, onClick, key) {
    const button = el('button', {
      class: 'cx-btn icon',
      title: key ? `${title} · ${keyHint(key)}` : title,
      'aria-label': title,
      html: icon(iconName, { size: 14 }),
      onClick,
    });
    return button;
  }

  function refreshToolbar() {
    const doc = store.getDoc();
    const settings = doc.settings;
    const history = store.historyState();

    dom.title.querySelector('.tt-name').textContent = doc.name;
    dom.title.querySelector('.tt-meta').textContent =
      [doc.client, doc.programme].filter(Boolean).join(' · ') || fallbackTag();

    dom.undoBtn.disabled = !history.canUndo;
    dom.redoBtn.disabled = !history.canRedo;

    const tool = store.getTool();
    dom.selectBtn.classList.toggle('active', tool === 'select');
    dom.panBtn.classList.toggle('active', tool === 'pan');

    dom.snapSelect.value = settings.snap;

    for (const button of dom.toggles.querySelectorAll('[data-toggle]')) {
      button.classList.toggle('active', !!settings[button.dataset.toggle]);
    }

    const scale = viewport.currentScale().id;
    for (const button of dom.scaleSeg.querySelectorAll('button')) {
      const label = button.textContent.trim().toLowerCase();
      const map = { d: 'day', w: 'week', m: 'month', q: 'quarter', y: 'year' };
      button.classList.toggle('active', map[label] === scale);
    }
  }

  /* ── Add-object menu ───────────────────────────────────────────────────── */

  function openAddMenu(anchor) {
    const rect = anchor.getBoundingClientRect();
    const items = [];
    for (const group of typeGroups()) {
      items.push({ heading: group.name });
      for (const type of group.items) {
        items.push({
          label: type.label,
          icon: type.icon,
          onClick: () => {
            store.setTool(type.id);
            toast({ tone: 'info', title: `${type.label} tool`, message: 'Click on the timeline to place it.', timeout: 2600 });
          },
        });
      }
    }
    contextMenu(rect.left, rect.bottom + 4, items);
  }

  function openThemeMenu(anchor) {
    const rect = anchor.getBoundingClientRect();
    contextMenu(
      rect.left,
      rect.bottom + 4,
      [
        { heading: 'Theme' },
        ...THEMES.map((theme) => ({
          label: theme.label + (theme.id === getTheme() ? '  ✓' : ''),
          icon: theme.icon,
          onClick: () => applyTheme(theme.id),
        })),
      ]
    );
  }

  /* ── Actions ───────────────────────────────────────────────────────────── */

  async function renameProject() {
    const doc = store.getDoc();
    const name = await promptDialog({ title: 'Rename project', label: 'Project name', value: doc.name });
    if (name && name.trim()) store.setMeta({ name: name.trim() }, 'Rename project');
  }

  function fitAll() {
    const extent = projectExtent(store.getDoc());
    viewport.fitRange(extent.start, extent.end, 30);
    renderer.requestRender();
  }

  function goToToday() {
    viewport.centerOn(effectiveToday(store.getDoc()), 0.42);
    renderer.requestRender();
  }

  /* ── Status bar ────────────────────────────────────────────────────────── */

  function buildStatusbar() {
    clear(dom.statusbar);

    dom.saveDot = el('span', { class: 'sb-dot' });
    dom.saveText = el('span', { text: 'Saved' });
    dom.statusbar.appendChild(el('span', { class: 'sb-item', title: 'Autosave status' }, [dom.saveDot, dom.saveText]));

    dom.countText = el('span', { class: 'sb-item' });
    dom.statusbar.appendChild(dom.countText);

    dom.selText = el('span', { class: 'sb-item' });
    dom.statusbar.appendChild(dom.selText);

    dom.violationText = el('span', {
      class: 'sb-item clickable sb-warn',
      title: 'Show broken dependencies',
      onClick: () => showPane('links'),
    });
    dom.statusbar.appendChild(dom.violationText);

    dom.statusbar.appendChild(el('span', { class: 'sb-spacer' }));

    dom.cursorText = el('span', { class: 'sb-item', title: 'Date under the cursor' });
    dom.statusbar.appendChild(dom.cursorText);

    dom.zoomText = el('span', {
      class: 'sb-item clickable',
      title: 'Fit the whole plan',
      onClick: fitAll,
    });
    dom.statusbar.appendChild(dom.zoomText);

    dom.storageText = el('span', {
      class: 'sb-item clickable',
      title: 'Open storage settings',
      onClick: () => showPane('settings'),
    });
    dom.statusbar.appendChild(dom.storageText);

    refreshStatus();
  }

  function refreshStatus() {
    const doc = store.getDoc();
    const selection = store.getSelection();
    const zoom = viewport.describeZoom();

    dom.countText.textContent = `${doc.objects.length} objects · ${doc.lanes.length} lanes · ${doc.links.length} links`;
    dom.selText.textContent = selection.length ? `${selection.length} selected` : '';

    const violations = linkViolations(doc);
    dom.violationText.textContent = violations.count
      ? `⚠ ${violations.count} broken ${violations.count === 1 ? 'dependency' : 'dependencies'}`
      : '';
    dom.violationText.style.display = violations.count ? '' : 'none';
    dom.zoomText.textContent = `${zoom.scale} · ${zoom.span}`;
    dom.storageText.textContent = isHosted() ? 'Supabase' : isFallback() ? 'localStorage' : 'IndexedDB';
  }

  const refreshCursor = debounce((ms) => {
    if (dom.cursorText) dom.cursorText.textContent = Number.isFinite(ms) ? fmtDate(ms, 'dayFull') : '';
  }, 30);

  function setSaveState(state, at) {
    if (!dom.saveDot) return;
    dom.saveDot.className = 'sb-dot' + (state === 'saving' ? ' saving' : state === 'error' ? ' error' : '');
    dom.saveText.textContent =
      state === 'saving' ? 'Saving…' : state === 'error' ? 'Save failed' : at ? `Saved ${fmtTimestamp(at)}` : 'Saved';
  }

  /* ── Wiring ────────────────────────────────────────────────────────────── */

  function wireEvents() {
    const refresh = debounce(() => {
      refreshToolbar();
      refreshStatus();
      updateNav();
    }, 40);

    on(EV.DOC_CHANGED, (payload) => {
      if (payload?.transient) return;
      refresh();
    });
    on(EV.DOC_REPLACED, refresh);
    on(EV.HISTORY_CHANGED, refresh);

    // Which panes exist depends on the account — the Team pane is for
    // administrators — so the sidebar is rebuilt, not just refreshed, when the
    // signed-in user changes.
    on(EV.AUTH_CHANGED, () => {
      buildSidenav();
      refreshStatus();
    });
    on(EV.ACCESS_CHANGED, refresh);
    on(EV.SELECTION_CHANGED, () => refreshStatus());
    on(EV.TOOL_CHANGED, () => refreshToolbar());
    on(EV.VIEW_CHANGED, debounce(() => {
      refreshToolbar();
      refreshStatus();
    }, 60));
    on(EV.PANEL_CHANGED, () => updateNav());

    on(EV.SAVE_START, () => setSaveState('saving'));
    on(EV.SAVE_DONE, (p) => setSaveState('saved', p?.at));
    on(EV.SAVE_ERROR, () => setSaveState('error'));

    on('canvas:cursor', (p) => refreshCursor(p.ms));

    on(EV.PRESENT_MODE, ({ on: enabled }) => {
      document.body.classList.toggle('presenting', enabled);
      setTimeout(() => {
        renderer.measure();
        renderer.requestRender();
      }, 60);
    });
  }

  /** Public refresh hook for modules that change shell-visible state. */
  function refreshShell() {
    refreshToolbar();
    refreshStatus();
    updateNav();
  }

  Object.defineProperty(__x, "buildShell", { get: () => buildShell, enumerable: true });
  Object.defineProperty(__x, "fitAll", { get: () => fitAll, enumerable: true });
  Object.defineProperty(__x, "goToToday", { get: () => goToToday, enumerable: true });
  Object.defineProperty(__x, "refreshShell", { get: () => refreshShell, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/inspector.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/inspector.js"] = function (__x, __req) {
  /**
   * The property inspector.
   *
   * Renders the full editable surface of whatever is selected: one object, many
   * objects (common properties only), a dependency, or — with nothing selected —
   * the project itself. Edits are written straight to the store, so every change
   * is undoable and autosaved without the panel having to manage a draft.
   *
   * Imports: util, events, dates, model, store, analysis, viewport, renderer,
   *          icons, components, lists, notes, attachments.
   */

  const { el, clear, debounce, clamp } = __req("core/util.js");
  const { on, emit, EV } = __req("core/events.js");
  const { toISO, toMs, fmtDate, fmtDuration, daysBetween, MS_DAY } = __req("core/dates.js");
  const { TYPES, listOptions, LINK_TYPES, CONNECTOR_STYLES, durationDays, remainingDays, statusOf, effectiveToday } = __req("core/model.js");









  const store = __req("core/store.js");
  const { objectHealth, linkViolations, evaluateLink } = __req("core/analysis.js");
  const renderer = __req("timeline/renderer.js");
  const { icon } = __req("ui/icons.js");
  const { field, textInput, numberInput, selectInput, checkbox, toggle, rangeInput, segmented, section, colorControl, iconPicker, popover, closePopover, emptyState, badge, chipStat, confirmDialog, contextMenu } = __req("ui/components.js");



















  const { managedSelect, suggestInput } = __req("ui/lists.js");
  const { openNoteEditor, renderNote, notePreview } = __req("ui/notes.js");
  const { resolveViolation } = __req("ui/commands.js");
  const { attachmentList } = __req("ui/attachments.js");

  let host = null;
  let headEl = null;
  let bodyEl = null;
  /** Section collapse state survives re-renders so the panel does not jump. */
  const collapsed = new Set(['appearance', 'text', 'arrange']);
  /** Set when a rebuild was suppressed because the user was mid-edit. */
  let pendingRender = false;

  /**
   * True when focus is in a text-entry control inside this panel.
   *
   * Every keystroke writes to the store, which publishes `doc:changed`, which
   * would otherwise rebuild the panel and destroy the very input being typed
   * into — dropping focus and the caret after each character. While the user is
   * typing, the panel holds still; the deferred rebuild runs once focus leaves.
   *
   * Selects, checkboxes, ranges and colour wells are deliberately excluded:
   * those are discrete choices that may change which fields apply, so the panel
   * should refresh immediately.
   */
  function isTypingInPanel() {
    const active = document.activeElement;
    if (!host || !active || !host.contains(active)) return false;
    const tag = active.tagName.toLowerCase();
    if (tag === 'textarea' || active.isContentEditable) return true;
    return tag === 'input' && !['checkbox', 'radio', 'color', 'range', 'file'].includes(active.type);
  }

  function buildInspector() {
    host = document.getElementById('inspector');
    clear(host);

    headEl = el('div', { class: 'insp-head' });
    bodyEl = el('div', { class: 'insp-body' });
    host.append(headEl, bodyEl);

    // Once focus leaves the panel, run any rebuild that was held back.
    host.addEventListener('focusout', () => {
      setTimeout(() => {
        if (pendingRender && !isTypingInPanel()) render();
      }, 0);
    });

    on(EV.SELECTION_CHANGED, render);
    on(EV.DOC_CHANGED, (p) => {
      if (p?.transient) return;
      scheduleRender();
    });
    on(EV.DOC_REPLACED, render);
    on('link:select', ({ link }) => {
      renderer.setSelectedLinks([link.id]);
      store.clearSelection();
      render();
    });

    render();
  }

  const scheduleRender = debounce(() => {
    if (isTypingInPanel()) {
      pendingRender = true;
      return;
    }
    render();
  }, 60);

  /* ══════════════════════════════════════════════════════════════════════════
     Router
     ═══════════════════════════════════════════════════════════════════════ */

  function render() {
    if (!host) return;
    pendingRender = false;

    const selection = store.selectedObjects();
    const links = renderer.getSelectedLinks();
    // Rebuilding replaces the scrolled content, so put the reader back where
    // they were rather than snapping to the top of the panel.
    const scroll = bodyEl.scrollTop;

    clear(headEl);
    clear(bodyEl);

    if (selection.length === 1) renderSingle(selection[0]);
    else if (selection.length > 1) renderMulti(selection);
    else if (links.length === 1) renderLink(links[0]);
    else renderProject();

    bodyEl.scrollTop = scroll;
  }

  function headerFor(kind, name, actions = []) {
    headEl.appendChild(
      el('div', { class: 'ih-title' }, [
        el('div', { class: 'ih-kind', text: kind }),
        el('div', { class: 'ih-name', text: name, title: name }),
      ])
    );
    for (const action of actions) headEl.appendChild(action);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Single object
     ═══════════════════════════════════════════════════════════════════════ */

  function renderSingle(obj) {
    const def = TYPES[obj.type] || TYPES.activity;
    const lane = store.getLane(obj.lane);

    headerFor(def.label, obj.title, [
      el('button', {
        class: 'cx-btn icon mini ghost',
        title: obj.locked ? 'Unlock' : 'Lock',
        'aria-label': obj.locked ? 'Unlock object' : 'Lock object',
        html: icon(obj.locked ? 'lock' : 'unlock', { size: 13 }),
        onClick: () => set(obj.id, { locked: !obj.locked }, obj.locked ? 'Unlock' : 'Lock'),
      }),
      el('button', {
        class: 'cx-btn icon mini ghost',
        title: 'More actions',
        'aria-label': 'More actions',
        html: icon('more', { size: 13 }),
        onClick: (e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          emit('canvas:contextmenu', { target: 'object', id: obj.id, clientX: rect.left, clientY: rect.bottom + 4 });
        },
      }),
    ]);

    const breaches = linkViolations(store.getDoc()).objects.get(obj.id) || null;

    // `append` stringifies null into a literal "null" text node, and several of
    // these are conditional — filter before handing them over.
    bodyEl.append(...[
      breaches ? violationBanner(obj, breaches) : null,
      healthStrip(obj),
      sectionOf('identity', 'Identity', identityFields(obj, def, lane)),
      sectionOf('schedule', 'Schedule', scheduleFields(obj, def)),
      def.fields.length ? sectionOf('details', 'Details', detailFields(obj, def)) : null,
      sectionOf('notes', 'Notes', notesFields(obj)),
      sectionOf('attachments', 'Attachments', [attachmentList(obj.id).root]),
      sectionOf('links', 'Dependencies', linkFields(obj)),
      sectionOf('appearance', 'Appearance', appearanceFields(obj)),
      sectionOf('text', 'Text', textFields(obj)),
      sectionOf('arrange', 'Arrange', arrangeFields(obj)),
    ].filter(Boolean));
  }

  function sectionOf(id, title, children) {
    if (!children) return null;
    const node = section(title, children, { collapsed: collapsed.has(id), id });
    node.querySelector('.cx-section-head').addEventListener('click', () => {
      if (node.classList.contains('collapsed')) collapsed.add(id);
      else collapsed.delete(id);
    });
    return node;
  }

  function set(id, patch, label, opts) {
    store.updateObject(id, patch, label || 'Edit object', opts);
    renderer.requestRender();
  }

  /* ── Health strip ──────────────────────────────────────────────────────── */

  function healthStrip(obj) {
    const today = effectiveToday(store.getDoc());
    const health = objectHealth(obj, today);
    const tone =
      health.state === 'done' ? 'good'
      : health.state === 'overdue' || health.state === 'behind' || health.state === 'late' ? 'bad'
      : health.state === 'ahead' ? 'good'
      : health.state === 'ontrack' ? 'info'
      : 'muted';

    const chips = [chipStat('Status', statusOf(obj.status).label, tone)];
    if (TYPES[obj.type]?.duration) {
      chips.push(chipStat('Dur', fmtDuration(durationDays(obj)), 'muted'));
      if (TYPES[obj.type]?.progress) {
        chips.push(chipStat('Done', `${Math.round(obj.progress)}%`, tone));
        chips.push(chipStat('Left', fmtDuration(remainingDays(obj)), 'muted'));
      }
    }

    return el('div', { style: { padding: '11px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: '6px' } }, [
      ...chips,
      el('div', { class: 'cx-hint', style: { width: '100%', marginTop: '2px' }, text: healthMessage(health) }),
    ]);
  }

  function healthMessage(health) {
    switch (health.state) {
      case 'overdue': return `Overdue by ${fmtDuration(health.days || 0)} — finish date has passed.`;
      case 'behind': return `${Math.abs(health.variance)}% behind the straight-line plan (${health.expected}% expected).`;
      case 'ahead': return `${health.variance}% ahead of the straight-line plan.`;
      case 'ontrack': return `Tracking to plan (${health.expected}% expected, ${health.actual}% reported).`;
      case 'done': return 'Complete.';
      case 'late': return `Planned date passed ${fmtDuration(health.days || 0)} ago.`;
      default: return 'Not started yet.';
    }
  }

  /**
   * Banner shown when this object is party to a broken dependency.
   * It disappears on its own the moment the dates satisfy the link again —
   * nothing here is stored, it is read from the document every render.
   */
  function violationBanner(obj, breaches) {
    const rows = breaches.map((breach) => {
      const other = store.getObject(breach.otherId);
      const asSuccessor = breach.role === 'successor';
      const message = asSuccessor
        ? `Starts ${breach.shortfallDays}d before "${other?.title || '?'}" allows`
        : `Finishes ${breach.shortfallDays}d after "${other?.title || '?'}" starts`;

      return el('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', marginTop: '5px' } }, [
        el('div', { style: { flex: '1', minWidth: '0', fontSize: 'var(--fs-tiny)', color: 'var(--text)' }, text: message }),
        el('button', {
          class: 'cx-btn mini',
          title: 'Move the successor to the earliest date the dependency allows',
          text: 'Fix',
          onClick: () => {
            resolveViolation(breach.id);
            render();
          },
        }),
      ]);
    });

    return el('div', {
      class: 'insp-alert',
      role: 'alert',
    }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
        el('span', { html: icon('warning', { size: 13 }), style: { display: 'flex' } }),
        el('span', { style: { fontWeight: 700 }, text: `Dependency broken (${breaches.length})` }),
      ]),
      ...rows,
    ]);
  }

  /* ── Identity ──────────────────────────────────────────────────────────── */

  function identityFields(obj, def, lane) {
    const iconButton = el('button', {
      class: 'cx-btn mini',
      html: (obj.icon ? icon(obj.icon, { size: 14 }) : icon('plus', { size: 13 })) + `<span>${obj.icon || 'Choose'}</span>`,
      onClick: (e) => {
        popover(e.currentTarget, iconPicker({
          value: obj.icon,
          onPick: (name) => {
            set(obj.id, { icon: name }, 'Change icon');
            closePopover();
          },
        }), { width: 280 });
      },
    });

    return [
      field('Title', textInput({
        value: obj.title,
        onInput: (v) => set(obj.id, { title: v }, 'Rename object', { mergeKey: `title:${obj.id}` }),
      })),
      field('Subtitle', textInput({
        value: obj.subtitle,
        placeholder: 'Optional second line',
        onInput: (v) => set(obj.id, { subtitle: v }, 'Edit subtitle', { mergeKey: `sub:${obj.id}` }),
      })),
      el('div', { class: 'cx-row' }, [
        field('Type', selectInput({
          value: obj.type,
          options: Object.entries(TYPES).map(([id, t]) => ({ value: id, label: t.label })),
          onChange: (v) => set(obj.id, { type: v }, 'Change type'),
        })),
        field('Lane', selectInput({
          value: obj.lane || '',
          options: store.orderedLanes().map((l) => ({ value: l.id, label: l.name })),
          onChange: (v) => set(obj.id, { lane: v, row: 0 }, 'Move to lane'),
        })),
      ]),
      field('Icon', iconButton),
      field('Tags', textInput({
        value: (obj.tags || []).join(', '),
        placeholder: 'comma, separated',
        onChange: (v) => set(obj.id, { tags: v.split(',').map((t) => t.trim()).filter(Boolean) }, 'Edit tags'),
      })),
    ];
  }

  /* ── Schedule ──────────────────────────────────────────────────────────── */

  function scheduleFields(obj, def) {
    const fields = [];

    if (def.duration) {
      fields.push(
        el('div', { class: 'cx-row' }, [
          field('Start', textInput({
            type: 'date',
            value: toISO(obj.start),
            onChange: (v) => {
              const ms = toMs(v);
              if (!Number.isFinite(ms)) return;
              const shift = ms - obj.start;
              set(obj.id, { start: ms, end: obj.end + shift }, 'Change start date');
            },
          })),
          field('Finish', textInput({
            type: 'date',
            value: toISO(obj.end),
            onChange: (v) => {
              const ms = toMs(v);
              if (Number.isFinite(ms)) set(obj.id, { end: Math.max(ms, obj.start + MS_DAY) }, 'Change finish date');
            },
          })),
        ]),
        el('div', { class: 'cx-row' }, [
          field('Duration (days)', numberInput({
            value: durationDays(obj),
            min: 1,
            onChange: (v) => set(obj.id, { end: obj.start + Math.max(1, v) * MS_DAY }, 'Change duration'),
          })),
          field('Remaining', el('div', {
            class: 'cx-input mini',
            style: { display: 'flex', alignItems: 'center', color: 'var(--text-muted)', cursor: 'default' },
            text: fmtDuration(remainingDays(obj)),
          })),
        ])
      );
    } else {
      fields.push(
        field('Date', textInput({
          type: 'date',
          value: toISO(obj.start),
          onChange: (v) => {
            const ms = toMs(v);
            if (Number.isFinite(ms)) set(obj.id, { start: ms, end: ms }, 'Change date');
          },
        }))
      );
    }

    fields.push(
      field('Status', managedSelect({
        listId: 'status',
        value: obj.status,
        onChange: (v) => set(obj.id, { status: v }, 'Change status'),
      }))
    );

    if (def.progress) {
      const readout = el('span', { class: 'mono', style: { minWidth: '38px', textAlign: 'right', fontSize: 'var(--fs-tiny)' }, text: `${Math.round(obj.progress)}%` });
      fields.push(
        field('Percent complete', el('div', { class: 'cx-inline' }, [
          rangeInput({
            value: obj.progress,
            min: 0,
            max: 100,
            step: 5,
            onInput: (v) => {
              readout.textContent = `${v}%`;
            },
            onChange: (v) => set(obj.id, { progress: v }, 'Change progress', { mergeKey: `prog:${obj.id}` }),
          }),
          readout,
        ]))
      );
    }

    return fields;
  }

  /* ── Type-specific details ─────────────────────────────────────────────── */

  function detailFields(obj, def) {
    const out = [];
    const data = obj.data || {};
    const setData = (key, value, label) => set(obj.id, { data: { [key]: value } }, label || 'Edit details');

    const has = (name) => def.fields.includes(name);

    if (has('owner')) {
      out.push(field('Owner', suggestInput({
        listId: 'owner',
        value: obj.owner,
        placeholder: 'Responsible engineer',
        onInput: (v) => set(obj.id, { owner: v }, 'Change owner', { mergeKey: `owner:${obj.id}` }),
      })));
    }

    if (has('subsystem') || has('area')) {
      out.push(
        el('div', { class: 'cx-row' }, [
          has('subsystem')
            ? field('Subsystem', managedSelect({
                listId: 'subsystem',
                value: obj.subsystem,
                onChange: (v) => set(obj.id, { subsystem: v }, 'Change subsystem'),
              }))
            : null,
          has('area')
            ? field('Area', suggestInput({
                listId: 'area',
                value: obj.area,
                placeholder: 'Section / zone',
                onInput: (v) => set(obj.id, { area: v }, 'Change area', { mergeKey: `area:${obj.id}` }),
              }))
            : null,
        ].filter(Boolean))
      );
    }

    if (has('version') || has('releaseNumber')) {
      out.push(
        el('div', { class: 'cx-row' }, [
          field('Version', textInput({ value: data.version || '', placeholder: '2.5.0', onInput: (v) => setData('version', v, 'Change version') })),
          field('Release no.', textInput({ value: data.releaseNumber || '', placeholder: 'REL-025', onInput: (v) => setData('releaseNumber', v, 'Change release number') })),
        ])
      );
    }
    if (has('buildNumber')) {
      out.push(field('Build', textInput({ value: data.buildNumber || '', placeholder: '2.5.0-rc3', onInput: (v) => setData('buildNumber', v, 'Change build number') })));
    }
    if (has('approval')) {
      out.push(field('Approval', managedSelect({
        listId: 'approval',
        value: data.approval || 'none',
        onChange: (v) => setData('approval', v, 'Change approval'),
      })));
    }

    if (has('testPackage')) {
      out.push(field('Test package', textInput({ value: data.testPackage || '', placeholder: 'TP-DYN-01', onInput: (v) => setData('testPackage', v, 'Change test package') })));
    }
    if (has('testKind')) {
      out.push(field('Test type', managedSelect({
        listId: 'testKind',
        value: data.testKind || '',
        onChange: (v) => setData('testKind', v, 'Change test type'),
      })));
    }

    if (has('actualStart') || has('actualEnd')) {
      out.push(
        el('div', { class: 'cx-row' }, [
          field('Actual start', textInput({
            type: 'date',
            value: data.actualStart ? toISO(toMs(data.actualStart)) : '',
            onChange: (v) => setData('actualStart', v, 'Set actual start'),
          })),
          field('Actual finish', textInput({
            type: 'date',
            value: data.actualEnd ? toISO(toMs(data.actualEnd)) : '',
            onChange: (v) => setData('actualEnd', v, 'Set actual finish'),
          })),
        ])
      );
    }

    if (has('severity')) {
      out.push(
        el('div', { class: 'cx-row' }, [
          field('Severity', managedSelect({
            listId: 'severity',
            value: data.severity || 'medium',
            onChange: (v) => setData('severity', v, 'Change severity'),
          })),
          has('likelihood')
            ? field('Likelihood', managedSelect({
                listId: 'severity',
                value: data.likelihood || 'medium',
                onChange: (v) => setData('likelihood', v, 'Change likelihood'),
              }))
            : null,
        ].filter(Boolean))
      );
    }
    if (has('mitigation')) {
      out.push(field('Mitigation', el('textarea', {
        class: 'cx-textarea',
        rows: 3,
        placeholder: 'How the risk is being managed',
        onChange: (e) => setData('mitigation', e.target.value, 'Edit mitigation'),
        text: data.mitigation || '',
      })));
    }
    if (has('reference')) {
      out.push(field('Reference', textInput({ value: data.reference || '', placeholder: 'IXL-1184', onInput: (v) => setData('reference', v, 'Change reference') })));
    }

    return out;
  }

  /* ── Notes ─────────────────────────────────────────────────────────────── */

  function notesFields(obj) {
    const preview = obj.notes
      ? renderNote(obj.notes, { max: 160 })
      : el('div', { class: 'cx-hint', text: 'No notes yet.' });

    return [
      preview,
      el('div', { class: 'cx-inline' }, [
        el('button', {
          class: 'cx-btn mini',
          html: icon('edit', { size: 12 }) + `<span>${obj.notes ? 'Edit notes' : 'Add notes'}</span>`,
          onClick: () =>
            openNoteEditor({
              title: obj.title,
              value: obj.notes,
              onSave: (html) => {
                set(obj.id, { notes: html }, 'Edit notes');
                render();
              },
            }),
        }),
        obj.notes
          ? el('button', {
              class: 'cx-btn mini danger',
              html: icon('trash', { size: 12 }),
              title: 'Clear notes',
              'aria-label': 'Clear notes',
              onClick: async () => {
                const ok = await confirmDialog({ title: 'Clear notes', message: 'Remove the notes on this object?', confirmLabel: 'Clear', danger: true });
                if (ok) {
                  set(obj.id, { notes: '' }, 'Clear notes');
                  render();
                }
              },
            })
          : null,
      ]),
    ];
  }

  /* ── Dependencies ──────────────────────────────────────────────────────── */

  function linkFields(obj) {
    const links = store.linksFor([obj.id]);
    const out = [];

    if (!links.length) {
      out.push(el('div', { class: 'cx-hint', text: 'No dependencies. Drag from an object’s round anchor to another object to create one.' }));
      return out;
    }

    for (const link of links) {
      const outgoing = link.from === obj.id;
      const other = store.getObject(outgoing ? link.to : link.from);
      if (!other) continue;

      const evaluated = evaluateLink(link, store.getObject(link.from), store.getObject(link.to));
      const slack = evaluated
        ? evaluated.violated
          ? `broken by ${evaluated.shortfallDays}d`
          : `${evaluated.slackDays}d slack`
        : '';

      out.push(
        el('div', { class: 'cx-listrow' + (evaluated?.violated ? ' danger' : '') }, [
          el('span', {
            style: { display: 'flex', color: evaluated?.violated ? 'var(--bad)' : 'var(--text-subtle)' },
            html: icon(evaluated?.violated ? 'warning' : outgoing ? 'arrow' : 'arrow-left', { size: 12 }),
          }),
          el('div', { class: 'lr-main' }, [
            el('div', { class: 'lr-title', text: other.title }),
            el('div', { class: 'lr-meta', text: `${LINK_TYPES[link.type]?.short || link.type}${link.lag ? ` ${link.lag > 0 ? '+' : ''}${link.lag}d` : ''} · ${outgoing ? 'successor' : 'predecessor'} · ${slack}` }),
          ]),
          el('div', { class: 'lr-actions' }, [
            el('button', {
              class: 'cx-btn icon mini ghost',
              title: 'Select dependency',
              'aria-label': 'Select dependency',
              html: icon('sliders', { size: 11 }),
              onClick: () => {
                renderer.setSelectedLinks([link.id]);
                store.clearSelection();
                render();
              },
            }),
            el('button', {
              class: 'cx-btn icon mini ghost',
              title: 'Delete dependency',
              'aria-label': 'Delete dependency',
              html: icon('unlink', { size: 11 }),
              onClick: () => {
                store.removeLinks([link.id]);
                renderer.requestRender();
                render();
              },
            }),
          ]),
        ])
      );
    }
    return out;
  }

  /* ── Appearance ────────────────────────────────────────────────────────── */

  function appearanceFields(obj) {
    const style = obj.style || {};
    const setStyle = (patch, label) => set(obj.id, { style: patch }, label || 'Change appearance');

    return [
      el('div', { class: 'cx-row' }, [
        field('Fill', colorControl({ value: style.fill || '#5b93f5', allowInherit: true, onChange: (v) => setStyle({ fill: v }, 'Change fill') })),
        field('Border', colorControl({ value: style.stroke || '#000000', allowInherit: true, onChange: (v) => setStyle({ stroke: v }, 'Change border') })),
      ]),
      el('div', { class: 'cx-row' }, [
        field('Border width', numberInput({ value: style.strokeWidth ?? 1, min: 0, max: 8, onChange: (v) => setStyle({ strokeWidth: v }, 'Change border width') })),
        field('Corner radius', numberInput({ value: style.radius ?? 6, min: 0, max: 30, onChange: (v) => setStyle({ radius: v }, 'Change corner radius') })),
      ]),
      field('Opacity', rangeInput({
        value: (style.opacity ?? 1) * 100,
        min: 15,
        max: 100,
        onChange: (v) => setStyle({ opacity: v / 100 }, 'Change opacity'),
      })),
      field('Pattern', segmented({
        value: style.pattern || 'none',
        stretch: true,
        options: [
          { value: 'none', label: 'None' },
          { value: 'stripes', label: 'Stripes' },
          { value: 'hatch', label: 'Hatch' },
          { value: 'dots', label: 'Dots' },
          { value: 'grid', label: 'Grid' },
        ],
        onChange: (v) => setStyle({ pattern: v }, 'Change pattern'),
      })),
      el('div', { class: 'cx-inline wrap' }, [
        checkbox({ label: 'Gradient', checked: !!style.gradient, onChange: (v) => setStyle({ gradient: v }, 'Toggle gradient') }),
        checkbox({ label: 'Shadow', checked: !!style.shadow, onChange: (v) => setStyle({ shadow: v }, 'Toggle shadow') }),
      ]),
      field('Rotation', rangeInput({
        value: style.rotation || 0,
        min: -45,
        max: 45,
        onChange: (v) => setStyle({ rotation: v }, 'Rotate'),
      }), 'Applies to notes, callouts, text boxes and shapes.'),
    ];
  }

  /* ── Text ──────────────────────────────────────────────────────────────── */

  function textFields(obj) {
    const style = obj.style || {};
    const setStyle = (patch, label) => set(obj.id, { style: patch }, label || 'Change text style');

    return [
      field('Font', managedSelect({
        listId: 'font',
        value: style.font || '',
        placeholder: 'Interface (default)',
        onChange: (v) => setStyle({ font: v }, 'Change font'),
      })),
      el('div', { class: 'cx-row' }, [
        field('Size', numberInput({ value: style.fontSize || 12, min: 7, max: 44, onChange: (v) => setStyle({ fontSize: v }, 'Change font size') })),
        field('Colour', colorControl({ value: style.textColor || '#ffffff', allowInherit: true, onChange: (v) => setStyle({ textColor: v }, 'Change text colour') })),
      ]),
      field('Style', el('div', { class: 'cx-inline' }, [
        styleToggle('B', 'Bold', style.bold, (v) => setStyle({ bold: v }, 'Toggle bold'), { fontWeight: '800' }),
        styleToggle('I', 'Italic', style.italic, (v) => setStyle({ italic: v }, 'Toggle italic'), { fontStyle: 'italic' }),
        styleToggle('U', 'Underline', style.underline, (v) => setStyle({ underline: v }, 'Toggle underline'), { textDecoration: 'underline' }),
      ])),
      field('Alignment', segmented({
        value: style.align || 'left',
        stretch: true,
        options: [
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Centre' },
          { value: 'right', label: 'Right' },
        ],
        onChange: (v) => setStyle({ align: v }, 'Change alignment'),
      })),
    ];
  }

  function styleToggle(label, title, active, onChange, extraStyle) {
    return el('button', {
      class: 'cx-btn icon mini' + (active ? ' active' : ''),
      title,
      'aria-label': title,
      'aria-pressed': String(!!active),
      style: extraStyle,
      text: label,
      onClick: () => onChange(!active),
    });
  }

  /* ── Arrange ───────────────────────────────────────────────────────────── */

  function arrangeFields(obj) {
    const ids = [obj.id];
    return [
      el('div', { class: 'cx-inline wrap' }, [
        el('button', { class: 'cx-btn mini', html: icon('chevron-up', { size: 12 }) + '<span>Front</span>', onClick: () => { store.bringToFront(ids); renderer.requestRender(); } }),
        el('button', { class: 'cx-btn mini', html: icon('chevron-down', { size: 12 }) + '<span>Back</span>', onClick: () => { store.sendToBack(ids); renderer.requestRender(); } }),
        el('button', { class: 'cx-btn mini', text: 'Raise', onClick: () => { store.raise(ids); renderer.requestRender(); } }),
        el('button', { class: 'cx-btn mini', text: 'Lower', onClick: () => { store.lower(ids); renderer.requestRender(); } }),
      ]),
      el('div', { class: 'cx-inline wrap' }, [
        toggle({ label: 'Locked', checked: obj.locked, onChange: (v) => set(obj.id, { locked: v }, v ? 'Lock' : 'Unlock') }),
        toggle({ label: 'Hidden', checked: obj.hidden, onChange: (v) => set(obj.id, { hidden: v }, v ? 'Hide' : 'Show') }),
      ]),
      field('Stacking row', numberInput({
        value: obj.row || 0,
        min: 0,
        max: 12,
        onChange: (v) => set(obj.id, { row: clamp(v, 0, 12) }, 'Change row'),
      }), 'Row 0 lets the packer place this object automatically.'),
      obj.groupId
        ? el('button', {
            class: 'cx-btn mini',
            html: icon('unlink', { size: 12 }) + '<span>Ungroup</span>',
            onClick: () => { store.ungroupObjects([obj.id]); renderer.requestRender(); },
          })
        : null,
    ];
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Multiple selection
     ═══════════════════════════════════════════════════════════════════════ */

  function renderMulti(objects) {
    const ids = objects.map((o) => o.id);
    headerFor('Selection', `${objects.length} objects`);

    const first = objects[0];
    const allSameType = objects.every((o) => o.type === first.type);

    bodyEl.append(
      el('div', { style: { padding: '11px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: '6px' } }, [
        chipStat('Objects', objects.length, 'info'),
        chipStat('Lanes', new Set(objects.map((o) => o.lane)).size, 'muted'),
        chipStat('Types', new Set(objects.map((o) => o.type)).size, 'muted'),
      ]),
      section('Bulk edit', [
        field('Lane', selectInput({
          value: '',
          placeholder: 'Move all to…',
          options: store.orderedLanes().map((l) => ({ value: l.id, label: l.name })),
          onChange: (v) => {
            if (v) {
              store.updateObjects(ids, { lane: v, row: 0 }, 'Move to lane');
              renderer.requestRender();
            }
          },
        })),
        field('Status', managedSelect({
          listId: 'status',
          value: '',
          allowEmpty: true,
          placeholder: 'Set status…',
          onChange: (v) => {
            if (v) {
              store.updateObjects(ids, { status: v }, 'Set status');
              renderer.requestRender();
            }
          },
        })),
        field('Owner', textInput({
          value: '',
          placeholder: 'Set owner for all…',
          onChange: (v) => {
            store.updateObjects(ids, { owner: v }, 'Set owner');
            renderer.requestRender();
          },
        })),
        field('Subsystem', managedSelect({
          listId: 'subsystem',
          value: '',
          allowEmpty: true,
          placeholder: 'Set subsystem…',
          onChange: (v) => {
            if (v) {
              store.updateObjects(ids, { subsystem: v }, 'Set subsystem');
              renderer.requestRender();
            }
          },
        })),
        field('Progress', rangeInput({
          value: Math.round(objects.reduce((sum, o) => sum + o.progress, 0) / objects.length),
          min: 0,
          max: 100,
          step: 5,
          onChange: (v) => {
            store.updateObjects(ids, { progress: v }, 'Set progress');
            renderer.requestRender();
          },
        })),
        field('Fill colour', colorControl({
          value: '#5b93f5',
          onChange: (v) => {
            store.updateObjects(ids, { style: { fill: v } }, 'Set fill');
            renderer.requestRender();
          },
        })),
      ]),
      section('Arrange', [
        el('div', { class: 'cx-inline wrap' }, [
          el('button', { class: 'cx-btn mini', text: 'Align starts', onClick: () => alignStarts(objects) }),
          el('button', { class: 'cx-btn mini', text: 'Align finishes', onClick: () => alignFinishes(objects) }),
          el('button', { class: 'cx-btn mini', text: 'Chain (FS)', onClick: () => chainSelection(objects) }),
          el('button', { class: 'cx-btn mini', text: 'Distribute', onClick: () => distribute(objects) }),
        ]),
        el('div', { class: 'cx-inline wrap' }, [
          el('button', { class: 'cx-btn mini', html: icon('layers', { size: 12 }) + '<span>Group</span>', onClick: () => { store.groupObjects(ids); renderer.requestRender(); } }),
          el('button', { class: 'cx-btn mini', html: icon('unlink', { size: 12 }) + '<span>Ungroup</span>', onClick: () => { store.ungroupObjects(ids); renderer.requestRender(); } }),
          el('button', { class: 'cx-btn mini', text: 'Bring to front', onClick: () => { store.bringToFront(ids); renderer.requestRender(); } }),
          el('button', { class: 'cx-btn mini', text: 'Send to back', onClick: () => { store.sendToBack(ids); renderer.requestRender(); } }),
        ]),
        el('button', {
          class: 'cx-btn mini danger',
          html: icon('trash', { size: 12 }) + `<span>Delete ${objects.length} objects</span>`,
          onClick: async () => {
            const ok = await confirmDialog({
              title: `Delete ${objects.length} objects`,
              message: 'This also removes any dependencies attached to them. You can undo this.',
              confirmLabel: 'Delete',
              danger: true,
            });
            if (ok) {
              store.removeObjects(ids);
              renderer.requestRender();
            }
          },
        }),
      ])
    );
  }

  function alignStarts(objects) {
    const target = Math.min(...objects.map((o) => o.start));
    store.updateObjects(objects.map((o) => o.id), (obj) => {
      const shift = target - obj.start;
      return TYPES[obj.type]?.duration ? { start: target, end: obj.end + shift } : { start: target };
    }, 'Align starts');
    renderer.requestRender();
  }

  function alignFinishes(objects) {
    const target = Math.max(...objects.map((o) => (TYPES[o.type]?.duration ? o.end : o.start)));
    store.updateObjects(objects.map((o) => o.id), (obj) => {
      if (!TYPES[obj.type]?.duration) return { start: target };
      const shift = target - obj.end;
      return { start: obj.start + shift, end: target };
    }, 'Align finishes');
    renderer.requestRender();
  }

  /** Lay the selection end-to-end in date order and link them finish-to-start. */
  function chainSelection(objects) {
    const ordered = objects.slice().sort((a, b) => a.start - b.start);
    let cursor = ordered[0].start;
    for (const obj of ordered) {
      const duration = TYPES[obj.type]?.duration ? obj.end - obj.start : 0;
      store.updateObject(obj.id, { start: cursor, end: cursor + duration }, 'Chain objects');
      cursor += duration || MS_DAY;
    }
    for (let i = 1; i < ordered.length; i++) {
      store.addLink({ from: ordered[i - 1].id, to: ordered[i].id, type: 'FS' });
    }
    renderer.requestRender();
  }

  /** Even out the gaps between the selection's start dates. */
  function distribute(objects) {
    const ordered = objects.slice().sort((a, b) => a.start - b.start);
    if (ordered.length < 3) return;
    const first = ordered[0].start;
    const last = ordered[ordered.length - 1].start;
    const step = (last - first) / (ordered.length - 1);
    ordered.forEach((obj, i) => {
      const target = first + step * i;
      const shift = target - obj.start;
      store.updateObject(obj.id, TYPES[obj.type]?.duration ? { start: target, end: obj.end + shift } : { start: target }, 'Distribute');
    });
    renderer.requestRender();
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Dependency
     ═══════════════════════════════════════════════════════════════════════ */

  function renderLink(linkId) {
    const link = store.getDoc().links.find((l) => l.id === linkId);
    if (!link) {
      renderProject();
      return;
    }
    const from = store.getObject(link.from);
    const to = store.getObject(link.to);

    headerFor('Dependency', `${from?.title || '?'} → ${to?.title || '?'}`, [
      el('button', {
        class: 'cx-btn icon mini ghost',
        title: 'Delete dependency',
        'aria-label': 'Delete dependency',
        html: icon('trash', { size: 13 }),
        onClick: () => {
          store.removeLinks([link.id]);
          renderer.setSelectedLinks([]);
          renderer.requestRender();
          render();
        },
      }),
    ]);

    bodyEl.appendChild(
      section('Relationship', [
        field('Type', selectInput({
          value: link.type,
          options: Object.entries(LINK_TYPES).map(([id, t]) => ({ value: id, label: t.label })),
          onChange: (v) => {
            store.updateLink(link.id, { type: v });
            renderer.requestRender();
          },
        })),
        field('Lag (days)', numberInput({
          value: link.lag || 0,
          onChange: (v) => {
            store.updateLink(link.id, { lag: v });
            renderer.requestRender();
          },
        }), 'Negative values create a lead (overlap).'),
        field('Connector style', selectInput({
          value: link.style || '',
          placeholder: 'Project default',
          options: CONNECTOR_STYLES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })),
          onChange: (v) => {
            store.updateLink(link.id, { style: v });
            renderer.requestRender();
          },
        })),
        field('Label', textInput({
          value: link.label || '',
          placeholder: 'Optional label',
          onInput: (v) => {
            store.updateLink(link.id, { label: v });
            renderer.requestRender();
          },
        })),
        field('Colour', colorControl({
          value: link.color || '#8b93a3',
          allowInherit: true,
          onChange: (v) => {
            store.updateLink(link.id, { color: v });
            renderer.requestRender();
          },
        })),
      ])
    );
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Project (nothing selected)
     ═══════════════════════════════════════════════════════════════════════ */

  function renderProject() {
    const doc = store.getDoc();
    headerFor('Project', doc.name);

    bodyEl.append(
      section('Project details', [
        field('Name', textInput({ value: doc.name, onInput: (v) => store.setMeta({ name: v }, 'Rename project', { mergeKey: 'projname' }) })),
        field('Client', textInput({ value: doc.client, placeholder: 'Metro Authority', onInput: (v) => store.setMeta({ client: v }, 'Change client') })),
        field('Programme', textInput({ value: doc.programme, placeholder: 'CBTC Deployment · Phase 2', onInput: (v) => store.setMeta({ programme: v }, 'Change programme') })),
        field('Description', el('textarea', {
          class: 'cx-textarea',
          rows: 3,
          text: doc.description,
          onChange: (e) => store.setMeta({ description: e.target.value }, 'Change description'),
        })),
      ]),
      section('Planning date', [
        field('Simulate "today" as', textInput({
          type: 'date',
          value: doc.settings.todayOverride || '',
          onChange: (v) => {
            store.setSetting('todayOverride', v || null, 'Change planning date');
            renderer.requestRender();
          },
        }), 'Leave empty to follow the system clock. Useful for what-if reviews.'),
        doc.settings.todayOverride
          ? el('button', {
              class: 'cx-btn mini',
              html: icon('refresh', { size: 12 }) + '<span>Back to real today</span>',
              onClick: () => {
                store.setSetting('todayOverride', null, 'Use system date');
                renderer.requestRender();
                render();
              },
            })
          : null,
      ]),
      emptyState({
        iconName: 'cursor',
        title: 'Nothing selected',
        message: 'Click an object to edit it, drag on empty canvas to marquee-select, or use Add to place something new.',
      })
    );
  }

  Object.defineProperty(__x, "buildInspector", { get: () => buildInspector, enumerable: true });
  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/minimap.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/minimap.js"] = function (__x, __req) {
  /**
   * Minimap — a navigator overview of the whole programme.
   *
   * Draws every object as a coloured tick across the project's full extent,
   * with a draggable window showing what the main canvas is looking at. On a
   * five-year plan this is the difference between navigating and hunting.
   *
   * Imports: util, events, model, store, viewport, renderer, icons.
   */

  const { el, clear, rafBatch, clamp } = __req("core/util.js");
  const { on, EV } = __req("core/events.js");
  const { projectExtent, objectColor, effectiveToday, TYPES } = __req("core/model.js");
  const { getDoc, orderedLanes, getSettings } = __req("core/store.js");
  const viewport = __req("timeline/viewport.js");
  const renderer = __req("timeline/renderer.js");
  const { icon } = __req("ui/icons.js");

  let root = null;
  let body = null;
  let viewBox = null;
  let extent = { start: 0, end: 1 };
  let dragging = null;

  function buildMinimap(hostEl) {
    root = el('div', { class: 'tl-minimap' });
    body = el('div', { class: 'tl-minimap-body' });

    const head = el('div', { class: 'tl-minimap-head' }, [
      el('span', { text: 'Navigator' }),
      el('span', { dataset: { mmRange: '1' } }),
    ]);

    viewBox = el('div', { class: 'tl-mini-view' });
    root.append(head, body);
    body.appendChild(viewBox);
    hostEl.appendChild(root);

    body.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', () => {
      dragging = null;
    });

    on(EV.DOC_CHANGED, (p) => {
      if (p?.transient) return;
      scheduleDraw();
    });
    on(EV.DOC_REPLACED, scheduleDraw);
    on(EV.VIEW_CHANGED, scheduleView);
    on(EV.THEME_CHANGED, scheduleDraw);

    scheduleDraw();
    return root;
  }

  const scheduleDraw = rafBatch(() => draw());
  const scheduleView = rafBatch(() => updateViewBox());

  /** Re-render the object ticks. */
  function draw() {
    if (!root) return;
    const settings = getSettings();
    root.classList.toggle('hidden', !settings.showMinimap);
    if (!settings.showMinimap) return;

    const doc = getDoc();
    extent = projectExtent(doc);
    // Always include the current viewport so the window stays representable.
    extent.start = Math.min(extent.start, viewport.getOrigin());
    extent.end = Math.max(extent.end, viewport.endMs());

    clear(body);
    body.appendChild(viewBox);

    const span = Math.max(1, extent.end - extent.start);
    const width = body.clientWidth || 300;
    const height = body.clientHeight || 56;

    const lanes = orderedLanes(false);
    const laneIndex = new Map(lanes.map((l, i) => [l.id, i]));
    const rowH = lanes.length ? Math.max(2, Math.min(5, (height - 6) / lanes.length)) : 4;

    const fragment = document.createDocumentFragment();
    for (const obj of doc.objects) {
      if (obj.hidden) continue;
      const row = laneIndex.get(obj.lane);
      if (row === undefined) continue;

      const x = ((obj.start - extent.start) / span) * width;
      const hasDuration = TYPES[obj.type]?.duration;
      const w = hasDuration ? Math.max(1.5, ((obj.end - obj.start) / span) * width) : 2.5;

      fragment.appendChild(
        el('div', {
          class: 'tl-mini-obj',
          style: {
            left: `${x}px`,
            width: `${w}px`,
            top: `${3 + row * rowH}px`,
            height: `${Math.max(2, rowH - 1)}px`,
            background: objectColor(obj, { color: lanes[row]?.color }),
          },
        })
      );
    }

    const todayX = ((effectiveToday(doc) - extent.start) / span) * width;
    if (todayX >= 0 && todayX <= width) {
      fragment.appendChild(el('div', { class: 'tl-mini-today', style: { left: `${todayX}px` } }));
    }

    body.appendChild(fragment);

    const label = root.querySelector('[data-mm-range]');
    if (label) {
      const years = (span / 31_557_600_000).toFixed(1);
      label.textContent = `${years}y`;
    }

    updateViewBox();
  }

  function updateViewBox() {
    if (!root || !viewBox || root.classList.contains('hidden')) return;
    const span = Math.max(1, extent.end - extent.start);
    const width = body.clientWidth || 300;
    const left = ((viewport.getOrigin() - extent.start) / span) * width;
    const boxWidth = (viewport.spanMs() / span) * width;

    viewBox.style.left = `${clamp(left, -4, width)}px`;
    viewBox.style.width = `${clamp(boxWidth, 6, width + 8)}px`;
  }

  /* ── Interaction ───────────────────────────────────────────────────────── */

  function onMouseDown(e) {
    const rect = body.getBoundingClientRect();
    const span = Math.max(1, extent.end - extent.start);
    const onBox = e.target === viewBox;

    if (onBox) {
      dragging = { offset: e.clientX - viewBox.getBoundingClientRect().left };
    } else {
      // Click anywhere to centre the viewport there.
      const fraction = (e.clientX - rect.left) / rect.width;
      viewport.centerOn(extent.start + span * fraction, 0.5);
      renderer.requestRender();
      dragging = { offset: viewBox.getBoundingClientRect().width / 2 };
    }
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!dragging) return;
    const rect = body.getBoundingClientRect();
    const span = Math.max(1, extent.end - extent.start);
    const x = e.clientX - rect.left - dragging.offset;
    viewport.setOrigin(extent.start + (x / rect.width) * span, 'minimap');
    renderer.requestRender();
  }

  /** Force a redraw — called after a resize. */
  function refreshMinimap() {
    scheduleDraw();
  }

  Object.defineProperty(__x, "buildMinimap", { get: () => buildMinimap, enumerable: true });
  Object.defineProperty(__x, "refreshMinimap", { get: () => refreshMinimap, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/legend.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/legend.js"] = function (__x, __req) {
  /**
   * Dynamic legend.
   *
   * Generated from what is actually in the document — object types, statuses
   * and subsystems that appear at least once — so it never claims a key that
   * isn't on the chart, and never omits one that is. Clicking an entry filters
   * the timeline to it, which makes the legend a navigation control rather than
   * decoration.
   *
   * Imports: util, events, model, store, query, renderer, icons.
   */

  const { el, clear, rafBatch } = __req("core/util.js");
  const { on, EV } = __req("core/events.js");
  const { TYPES, listIds, listOptions, statusOf } = __req("core/model.js");
  const { getDoc, getSettings, getFilters, setFilters } = __req("core/store.js");
  const { summarise } = __req("core/query.js");
  const renderer = __req("timeline/renderer.js");
  const { icon } = __req("ui/icons.js");

  let root = null;

  function buildLegend(hostEl) {
    root = el('div', { class: 'tl-legend' });
    hostEl.appendChild(root);

    on(EV.DOC_CHANGED, (p) => {
      if (p?.transient) return;
      scheduleDraw();
    });
    on(EV.DOC_REPLACED, scheduleDraw);
    on(EV.FILTER_CHANGED, scheduleDraw);
    on(EV.THEME_CHANGED, scheduleDraw);

    scheduleDraw();
    return root;
  }

  const scheduleDraw = rafBatch(() => draw());

  function draw() {
    if (!root) return;
    const settings = getSettings();
    root.classList.toggle('hidden', !settings.showLegend);
    if (!settings.showLegend) return;

    const doc = getDoc();
    const stats = summarise(doc);
    const filters = getFilters();
    clear(root);

    root.appendChild(
      el('div', { class: 'tl-legend-title' }, [
        el('span', { text: 'Legend' }),
        el('button', {
          class: 'cx-btn icon mini ghost',
          title: 'Hide legend',
          'aria-label': 'Hide legend',
          html: icon('x', { size: 11 }),
          onClick: () => {
            root.classList.add('hidden');
            settings.showLegend = false;
          },
        }),
      ])
    );

    // Object types present in the plan.
    const typeIds = Array.from(stats.byType.keys()).filter((id) => TYPES[id]);
    if (typeIds.length) {
      root.appendChild(
        group('Object types', typeIds.map((id) => ({
          label: TYPES[id].label,
          color: TYPES[id].accent,
          count: stats.byType.get(id),
          active: !filters.types.length || filters.types.includes(id),
          onClick: () => toggleFilter('types', id),
          icon: TYPES[id].icon,
        })))
      );
    }

    // Statuses present, in canonical order.
    const statusIds = listIds('status').filter((id) => stats.byStatus.has(id));
    if (statusIds.length) {
      root.appendChild(
        group('Status', statusIds.map((id) => ({
          label: statusOf(id).label,
          color: statusOf(id).color,
          count: stats.byStatus.get(id),
          active: !filters.statuses.length || filters.statuses.includes(id),
          onClick: () => toggleFilter('statuses', id),
        })))
      );
    }

    // Subsystems present.
    const subsystemIds = listOptions('subsystem').filter((s) => stats.bySubsystem.has(s.id));
    if (subsystemIds.length) {
      root.appendChild(
        group('Subsystems', subsystemIds.map((s) => ({
          label: s.label,
          color: s.color,
          count: stats.bySubsystem.get(s.id),
          active: !filters.subsystems.length || filters.subsystems.includes(s.id),
          onClick: () => toggleFilter('subsystems', s.id),
        })))
      );
    }

    // Fixed chart keys that are not derived from counts.
    root.appendChild(
      group('Chart', [
        { label: 'Today', color: 'var(--today-line)', plain: true },
        settings.showBaseline ? { label: 'Baseline', color: 'var(--text-subtle)', plain: true } : null,
        settings.criticalPath ? { label: 'Critical path', color: 'var(--bad)', plain: true } : null,
        settings.showConnectors ? { label: 'Dependency', color: 'var(--connector)', plain: true } : null,
      ].filter(Boolean))
    );
  }

  function group(title, items) {
    return el('div', { class: 'tl-legend-group' }, [
      el('div', { class: 'eyebrow', style: { marginBottom: '5px' }, text: title }),
      el('div', { class: 'tl-legend-items' }, items.map(itemRow)),
    ]);
  }

  function itemRow(item) {
    const node = el('div', {
      class: 'tl-legend-item' + (item.active === false ? ' off' : ''),
      title: item.plain ? item.label : `Click to filter by ${item.label}`,
      onClick: item.onClick || null,
      style: item.plain ? { cursor: 'default' } : {},
    }, [
      el('span', { class: 'cx-dot', style: { background: item.color } }),
      el('span', { text: item.label }),
      item.count != null ? el('span', { class: 'li-count', text: String(item.count) }) : null,
    ]);
    return node;
  }

  /** Toggle one value in a multi-select filter dimension. */
  function toggleFilter(dimension, value) {
    const current = getFilters()[dimension] || [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    setFilters({ [dimension]: next });
    renderer.requestRender();
  }

  Object.defineProperty(__x, "buildLegend", { get: () => buildLegend, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/menus.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/menus.js"] = function (__x, __req) {
  /**
   * Context menus.
   *
   * Subscribes to the interaction events the canvas publishes and turns them
   * into menus. Every item routes through `commands.js`, so right-click and the
   * keyboard always do exactly the same thing.
   *
   * Imports: events, dates, model, store, viewport, renderer, icons, components,
   *          commands, notes, panels.
   */

  const { on, emit, EV } = __req("core/events.js");
  const { fmtDate, MS_DAY } = __req("core/dates.js");
  const { TYPES, listOptions, typeGroups, statusOf } = __req("core/model.js");
  const store = __req("core/store.js");
  const renderer = __req("timeline/renderer.js");
  const { icon } = __req("ui/icons.js");
  const { contextMenu, confirmDialog, promptDialog, toast, colorControl, popover, closePopover } = __req("ui/components.js");
  const cmd = __req("ui/commands.js");
  const { openListManager } = __req("ui/lists.js");
  const { openNoteEditor } = __req("ui/notes.js");
  const { showPane } = __req("ui/panels.js");
  const { linkViolations } = __req("core/analysis.js");
  const { openObjectDialog } = __req("ui/dialogs.js");

  function installMenus() {
    on('canvas:contextmenu', onCanvasMenu);
    on('lane:menu', onLaneMenu);
    on('link:dropped', onLinkDropped);
    on(EV.OBJECT_ACTIVATED, ({ id }) => openObjectDialog(id));
    on('canvas:createat', onCreateAt);
    on('ui:shortcuts', () => cmd.showShortcuts());
  }

  /* ── Object / canvas menu ──────────────────────────────────────────────── */

  function onCanvasMenu(payload) {
    if (payload.target === 'object') objectMenu(payload);
    else canvasMenu(payload);
  }

  function objectMenu({ id, clientX, clientY }) {
    const obj = store.getObject(id);
    if (!obj) return;
    const selection = store.getSelection();
    const many = selection.length > 1;
    const def = TYPES[obj.type] || TYPES.activity;

    contextMenu(clientX, clientY, [
      { heading: many ? `${selection.length} objects` : def.label },
      { label: 'Open editor…', icon: 'edit', key: 'enter', onClick: () => openObjectDialog(id) },
      { label: obj.notes ? 'Edit notes…' : 'Add notes…', icon: 'comment', onClick: () => openNotes(obj) },
      'sep',
      { label: 'Copy', icon: 'copy', key: 'mod+c', onClick: () => cmd.copySelection() },
      { label: 'Cut', icon: 'scissors', key: 'mod+x', onClick: () => cmd.cutSelection() },
      { label: 'Duplicate', icon: 'copy', key: 'mod+d', onClick: () => cmd.duplicateSelection() },
      'sep',
      { heading: 'Status' },
      ...statusItems(obj),
      'sep',
      { label: 'Set progress…', icon: 'activity', disabled: !def.progress, onClick: () => promptProgress() },
      { label: 'Change colour…', icon: 'palette', onClick: (e) => promptColor(clientX, clientY) },
      'sep',
      { label: 'Bring to front', icon: 'chevron-up', onClick: () => { store.bringToFront(selection); renderer.requestRender(); } },
      { label: 'Send to back', icon: 'chevron-down', onClick: () => { store.sendToBack(selection); renderer.requestRender(); } },
      { label: many ? 'Group' : 'Group with…', icon: 'layers', key: 'mod+g', disabled: !many, onClick: () => cmd.groupSelection() },
      { label: 'Ungroup', icon: 'unlink', key: 'mod+shift+g', disabled: !obj.groupId, onClick: () => cmd.ungroupSelection() },
      'sep',
      ...violationItems(obj),
      { label: obj.locked ? 'Unlock' : 'Lock', icon: obj.locked ? 'unlock' : 'lock', key: 'mod+l', onClick: () => cmd.toggleLock() },
      { label: 'Select dependency chain', icon: 'route', key: 'mod+shift+d', onClick: () => cmd.selectDependencyChain() },
      { label: 'Zoom to selection', icon: 'expand', key: 'mod+shift+0', onClick: () => cmd.zoomToSelection() },
      'sep',
      { label: many ? `Delete ${selection.length} objects` : 'Delete', icon: 'trash', key: 'del', danger: true, onClick: () => cmd.deleteSelection() },
    ]);
  }

  /** Repair actions, offered only when this object is in a broken dependency. */
  function violationItems(obj) {
    const breaches = linkViolations(store.getDoc()).objects.get(obj.id);
    if (!breaches?.length) return [];

    const worst = breaches.reduce((max, b) => Math.max(max, b.shortfallDays), 0);
    return [
      { heading: `Dependency broken by ${worst}d` },
      ...breaches.map((breach) => {
        const other = store.getObject(breach.otherId);
        return {
          label: `Reschedule to clear "${other?.title || 'link'}"`,
          icon: 'refresh',
          onClick: () => cmd.resolveViolation(breach.id),
        };
      }),
      'sep',
    ];
  }

  function statusItems(obj) {
    // The whole list, in the user's own order: which statuses suit which type
    // is a judgement only the project can make now that the list is editable.
    const items = listOptions('status').map((option) => ({
      label: option.label + (obj.status === option.id ? '  ✓' : ''),
      onClick: () => cmd.setStatus(option.id),
    }));
    items.push('sep', { label: 'Edit statuses…', onClick: () => openListManager('status') });
    return items;
  }

  async function promptProgress() {
    const value = await promptDialog({ title: 'Set progress', label: 'Percent complete (0–100)', value: '50' });
    const n = Number(value);
    if (Number.isFinite(n)) cmd.setProgress(n);
  }

  function promptColor(x, y) {
    const anchor = document.createElement('div');
    anchor.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:1px;height:1px`;
    document.body.appendChild(anchor);
    popover(anchor, colorControl({
      value: '#5b93f5',
      onChange: (colour) => {
        store.updateObjects(store.getSelection(), { style: { fill: colour } }, 'Change colour');
        renderer.requestRender();
      },
    }), { width: 120 });
    setTimeout(() => anchor.remove(), 100);
  }

  function openNotes(obj) {
    openNoteEditor({
      title: obj.title,
      value: obj.notes,
      onSave: (html) => {
        store.updateObject(obj.id, { notes: html }, 'Edit notes');
        renderer.requestRender();
      },
    });
  }

  function canvasMenu({ ms, laneId, clientX, clientY }) {
    const lane = store.getLane(laneId);
    const items = [
      { heading: `${fmtDate(ms, 'dayFull')}${lane ? ' · ' + lane.name : ''}` },
    ];

    for (const group of typeGroups()) {
      items.push({ heading: group.name });
      for (const type of group.items) {
        items.push({
          label: `Add ${type.label}`,
          icon: type.icon,
          onClick: () => cmd.createObject(type.id, { ms, laneId }),
        });
      }
    }

    items.push(
      'sep',
      { label: 'Paste here', icon: 'copy', key: 'mod+v', disabled: !store.getClipboard(), onClick: () => cmd.paste({ atMs: ms, laneId }) },
      'sep',
      { label: 'Add lane…', icon: 'layers', onClick: () => cmd.addLane() },
      { label: 'Set planning date here', icon: 'calendar', onClick: () => setPlanningDate(ms) },
      { label: 'Fit whole plan', icon: 'expand', key: 'mod+0', onClick: () => cmd.fitAll() },
      { label: 'Go to today', icon: 'calendar', key: 't', onClick: () => cmd.goToToday() }
    );

    contextMenu(clientX, clientY, items);
  }

  function setPlanningDate(ms) {
    const iso = new Date(ms).toISOString().slice(0, 10);
    store.setSetting('todayOverride', iso, 'Set planning date');
    renderer.requestRender();
    toast({
      tone: 'info',
      title: 'Planning date simulated',
      message: fmtDate(ms, 'long'),
      action: {
        label: 'Reset',
        onClick: () => {
          store.setSetting('todayOverride', null, 'Use system date');
          renderer.requestRender();
        },
      },
    });
  }

  /* ── Double-click on empty canvas ──────────────────────────────────────── */

  function onCreateAt({ ms, laneId }) {
    // Double-clicking empty canvas creates the most common thing — an activity —
    // rather than opening a chooser. The context menu covers the rest.
    cmd.createObject('activity', { ms, laneId });
  }

  /* ── Lane menu ─────────────────────────────────────────────────────────── */

  function onLaneMenu({ id, clientX, clientY }) {
    const lane = store.getLane(id);
    if (!lane) return;
    const order = store.getDoc().laneOrder;
    const index = order.indexOf(id);
    const count = store.getDoc().objects.filter((o) => o.lane === id).length;

    contextMenu(clientX, clientY, [
      { heading: lane.name },
      { label: 'Rename…', icon: 'edit', onClick: () => renameLane(lane) },
      { label: 'Change colour…', icon: 'palette', onClick: () => laneColour(lane, clientX, clientY) },
      'sep',
      { label: lane.collapsed ? 'Expand' : 'Collapse', icon: lane.collapsed ? 'chevron-down' : 'chevron-right', onClick: () => toggleLane(lane, 'collapsed') },
      { label: lane.hidden ? 'Show' : 'Hide', icon: lane.hidden ? 'eye' : 'eye-off', onClick: () => toggleLane(lane, 'hidden') },
      { label: lane.locked ? 'Unlock' : 'Lock', icon: lane.locked ? 'unlock' : 'lock', onClick: () => toggleLane(lane, 'locked') },
      'sep',
      { label: 'Move up', icon: 'chevron-up', disabled: index <= 0, onClick: () => { store.moveLane(id, index - 1); renderer.requestRender(); } },
      { label: 'Move down', icon: 'chevron-down', disabled: index >= order.length - 1, onClick: () => { store.moveLane(id, index + 1); renderer.requestRender(); } },
      'sep',
      { label: 'Add lane below', icon: 'plus', onClick: () => cmd.addLane(index + 1) },
      { label: `Select ${count} object${count === 1 ? '' : 's'}`, icon: 'cursor', disabled: !count, onClick: () => selectLaneObjects(id) },
      'sep',
      { label: 'Delete lane…', icon: 'trash', danger: true, onClick: () => deleteLane(lane, count) },
    ]);
  }

  async function renameLane(lane) {
    const name = await promptDialog({ title: 'Rename lane', label: 'Lane name', value: lane.name });
    if (name && name.trim()) {
      store.updateLane(lane.id, { name: name.trim() }, 'Rename lane');
      renderer.requestRender();
    }
  }

  function laneColour(lane, x, y) {
    const anchor = document.createElement('div');
    anchor.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:1px;height:1px`;
    document.body.appendChild(anchor);
    popover(anchor, colorControl({
      value: lane.color,
      onChange: (colour) => {
        store.updateLane(lane.id, { color: colour }, 'Change lane colour');
        renderer.requestRender();
      },
    }), { width: 120 });
    setTimeout(() => anchor.remove(), 100);
  }

  function toggleLane(lane, key) {
    store.updateLane(lane.id, { [key]: !lane[key] }, `Toggle lane ${key}`);
    renderer.requestRender();
  }

  function selectLaneObjects(laneId) {
    store.setSelection(store.getDoc().objects.filter((o) => o.lane === laneId).map((o) => o.id));
    renderer.requestRender();
  }

  async function deleteLane(lane, count) {
    const others = store.orderedLanes().filter((l) => l.id !== lane.id);
    if (!others.length) {
      toast({ tone: 'warn', title: 'Cannot delete the last lane' });
      return;
    }

    if (!count) {
      store.removeLane(lane.id);
      renderer.requestRender();
      return;
    }

    const move = await confirmDialog({
      title: `Delete "${lane.name}"`,
      message: `This lane holds ${count} object${count === 1 ? '' : 's'}. Move them to "${others[0].name}", or delete them with the lane?`,
      confirmLabel: 'Move objects',
      cancelLabel: 'Delete objects too',
    });

    store.removeLane(lane.id, move ? others[0].id : null);
    renderer.requestRender();
  }

  /* ── Dropping a dependency on empty space ──────────────────────────────── */

  function onLinkDropped({ from, ms, clientX, clientY, x }) {
    const source = store.getObject(from);
    if (!source) return;
    const targetMs = ms ?? null;

    contextMenu(clientX, clientY, [
      { heading: `From “${source.title}”` },
      {
        label: 'Create a linked activity here',
        icon: 'activity',
        onClick: () => {
          const id = cmd.createObject('activity', { ms: targetMs });
          if (id) store.addLink({ from, to: id, type: 'FS' });
          renderer.requestRender();
        },
      },
      {
        label: 'Create a linked milestone here',
        icon: 'flag',
        onClick: () => {
          const id = cmd.createObject('milestone', { ms: targetMs });
          if (id) store.addLink({ from, to: id, type: 'FS' });
          renderer.requestRender();
        },
      },
      'sep',
      { label: 'Cancel', icon: 'x', onClick: () => {} },
    ]);
  }

  Object.defineProperty(__x, "installMenus", { get: () => installMenus, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// ui/shortcuts.js
// ════════════════════════════════════════════════════════════════════════
__mods["ui/shortcuts.js"] = function (__x, __req) {
  /**
   * Keyboard shortcuts.
   *
   * One capture-phase listener maps key combinations onto commands. Shortcuts
   * stand down entirely while focus is in a text field or a modal is open, so
   * typing "d" into a title never duplicates an object.
   *
   * Imports: util, events, store, renderer, interactions, commands, components, panels.
   */

  const { hasMod, isTyping, IS_MAC } = __req("core/util.js");
  const { emit, EV } = __req("core/events.js");
  const store = __req("core/store.js");
  const renderer = __req("timeline/renderer.js");
  const { nudgeSelection, stretchSelection } = __req("timeline/interactions.js");
  const cmd = __req("ui/commands.js");
  const { modalOpen, closeMenu, closePopover } = __req("ui/components.js");
  const { showPane } = __req("ui/panels.js");

  function installShortcuts() {
    window.addEventListener('keydown', onKeyDown, true);
  }

  function onKeyDown(e) {
    // Escape always works — it is how you get out of things.
    if (e.key === 'Escape') {
      closeMenu();
      closePopover();
      if (!modalOpen()) {
        cmd.selectNone();
        if (store.getTool() !== 'select') store.setTool('select');
        if (document.body.classList.contains('presenting')) emit(EV.PRESENT_MODE, { on: false });
      }
      return;
    }

    if (modalOpen() || isTyping(e.target)) return;

    const mod = hasMod(e);
    const key = e.key.toLowerCase();

    /* ── Modifier combinations ─────────────────────────────────────────── */
    if (mod) {
      switch (key) {
        case 'z':
          e.preventDefault();
          if (e.shiftKey) store.redo();
          else store.undo();
          renderer.requestRender();
          return;
        case 'y':
          e.preventDefault();
          store.redo();
          renderer.requestRender();
          return;
        case 'c':
          e.preventDefault();
          cmd.copySelection();
          return;
        case 'x':
          e.preventDefault();
          cmd.cutSelection();
          return;
        case 'v':
          e.preventDefault();
          cmd.paste();
          return;
        case 'd':
          e.preventDefault();
          cmd.duplicateSelection();
          return;
        case 'a':
          e.preventDefault();
          if (e.shiftKey) cmd.selectLane();
          else cmd.selectAll();
          return;
        case 'g':
          e.preventDefault();
          if (e.shiftKey) cmd.ungroupSelection();
          else cmd.groupSelection();
          return;
        case 'l':
          e.preventDefault();
          cmd.toggleLock();
          return;
        case 'f':
          e.preventDefault();
          showPane('search');
          emit('ui:focus-search');
          return;
        case 's':
          e.preventDefault();
          cmd.saveSnapshot();
          return;
        case 'p':
          e.preventDefault();
          emit('ui:print');
          return;
        case '0':
          e.preventDefault();
          if (e.shiftKey) cmd.zoomToSelection();
          else cmd.fitAll();
          return;
        case '=':
        case '+':
          e.preventDefault();
          cmd.zoomIn();
          return;
        case '-':
          e.preventDefault();
          cmd.zoomOut();
          return;
        case 'arrowleft':
          e.preventDefault();
          stretchSelection(-1);
          return;
        case 'arrowright':
          e.preventDefault();
          stretchSelection(1);
          return;
        default:
          break;
      }
      // A modifier combination we do not own: leave it to the browser.
      if (key !== 'shift' && key !== 'control' && key !== 'meta' && key !== 'alt') return;
    }

    /* ── Bare keys ─────────────────────────────────────────────────────── */
    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        cmd.deleteSelection();
        return;

      case 'ArrowLeft':
        e.preventDefault();
        nudgeSelection(-1, e.shiftKey);
        return;
      case 'ArrowRight':
        e.preventDefault();
        nudgeSelection(1, e.shiftKey);
        return;

      case 'F11':
        e.preventDefault();
        cmd.togglePresentation();
        return;

      case '?':
        e.preventDefault();
        cmd.showShortcuts();
        return;

      default:
        break;
    }

    if (e.shiftKey || e.altKey) return;

    switch (key) {
      case 'v':
        store.setTool('select');
        return;
      case 'h':
        store.setTool('pan');
        return;
      case 't':
        cmd.goToToday();
        return;
      case 'p':
        cmd.togglePresentation();
        return;
      case 'b':
        cmd.takeBaseline();
        return;
      case 'l':
        showPane('lanes');
        return;
      case 'n':
        cmd.createObject('note');
        return;
      case 'm':
        cmd.createObject('milestone');
        return;
      case 'a':
        cmd.createObject('activity');
        return;
      case 'r':
        cmd.createObject('release');
        return;
      default:
        break;
    }
  }

  /** Human-readable modifier name for help text. */
  const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';

  Object.defineProperty(__x, "installShortcuts", { get: () => installShortcuts, enumerable: true });
  Object.defineProperty(__x, "MOD_LABEL", { get: () => MOD_LABEL, enumerable: true });
};

// ════════════════════════════════════════════════════════════════════════
// main.js
// ════════════════════════════════════════════════════════════════════════
__mods["main.js"] = function (__x, __req) {
  /**
   * Application entry point.
   *
   * Boot order matters and is deliberate:
   *   0. the backend, if this build has one, restores its session and — when
   *      nobody is signed in — puts the gate up before anything else renders,
   *   1. storage opens and hands back the document to load,
   *   2. the store adopts it (nothing renders against an empty document),
   *   3. the theme is applied before the first paint, so there is no flash,
   *   4. the shell and canvas mount,
   *   5. interaction, shortcuts and menus attach last, once their targets exist.
   *
   * Step 0 does nothing at all when `config.js` is blank, which is what keeps
   * the local-first, double-click-index.html build exactly as it was.
   *
   * Imports: everything — this is the only module allowed to.
   */

  const { debounce } = __req("core/util.js");
  const { on, emit, EV } = __req("core/events.js");
  const { projectExtent, effectiveToday } = __req("core/model.js");
  const store = __req("core/store.js");
  const { init: initStorage, takeRecovery, getPref, setPref, saveNow, isHosted } = __req("core/storage.js");
  const cloud = __req("core/cloud.js");
  const { criticalPath } = __req("core/analysis.js");
  const viewport = __req("timeline/viewport.js");
  const renderer = __req("timeline/renderer.js");
  const { attach: attachInteractions } = __req("timeline/interactions.js");
  const { initTheme } = __req("ui/theme.js");
  const { buildShell } = __req("ui/shell.js");
  const { buildPanels, installResizer } = __req("ui/panels.js");
  const { buildInspector } = __req("ui/inspector.js");
  const { buildMinimap } = __req("ui/minimap.js");
  const { buildLegend } = __req("ui/legend.js");
  const { installMenus } = __req("ui/menus.js");
  const { requireSignIn, installAccessMode } = __req("ui/auth.js");
  const { installShortcuts } = __req("ui/shortcuts.js");
  const { toast, showTooltip, hideTooltip, confirmDialog } = __req("ui/components.js");
  const { renderNote, notePreview } = __req("ui/notes.js");
  const { TYPES, statusOf, durationDays } = __req("core/model.js");
  const { fmtDate, fmtDuration, setDateOrder, getDateOrder } = __req("core/dates.js");
  const { el } = __req("core/util.js");

  const APP_VERSION = '1.0.0';

  async function boot() {
    const started = performance.now();

    /* ── 0. Account ──────────────────────────────────────────────────────── */
    if (cloud.isConfigured()) {
      try {
        await cloud.init();
        if (!cloud.isSignedIn()) {
          // The splash covers the whole viewport and would sit on top of the
          // sign-in card, swallowing its clicks. Loading is over: say so.
          dismissSplash();
          await requireSignIn();
        }
      } catch (err) {
        console.error('[cx-timeline] sign-in failed:', err);
      }
    }

    /* ── 1. Storage & document ───────────────────────────────────────────── */
    let loaded;
    try {
      loaded = await initStorage();
    } catch (err) {
      console.error('[cx-timeline] storage failed to initialise:', err);
      loaded = null;
    }

    if (loaded) {
      store.replaceDoc(loaded.doc, 'load');
      // Offer to recover work the unload handler saved after an unclean exit.
      // A read-only project has nothing to recover — the user cannot have
      // changed it — so the prompt would be nonsense.
      const recovery = cloud.isReadOnly() ? null : takeRecovery(loaded.doc);
      if (recovery) {
        setTimeout(() => offerRecovery(recovery), 900);
      }
      if (loaded.fresh) {
        setTimeout(() => {
          toast({
            tone: 'info',
            title: 'Welcome to CX Timeline',
            message: 'This is a sample commissioning plan — edit it, or start fresh from Import / Export.',
            timeout: 7000,
          });
        }, 1200);
      }
    }

    /* ── 2. Theme and date format, before first paint ────────────────────── */
    initTheme();
    installDateFormat();

    /* ── 3. Chrome ───────────────────────────────────────────────────────── */
    buildShell();
    buildPanels();
    buildInspector();

    /* ── 4. Canvas ───────────────────────────────────────────────────────── */
    const frame = document.getElementById('canvas-frame');
    renderer.mount(frame);
    buildMinimap(frame);
    buildLegend(frame);

    const inspector = document.getElementById('inspector');
    const inspectorResizer = el('div', { class: 'resizer left' });
    inspector.appendChild(inspectorResizer);
    installResizer(inspectorResizer, inspector, 240, 520);

    restoreView();

    /* ── 5. Interaction ──────────────────────────────────────────────────── */
    attachInteractions();
    installMenus();
    installShortcuts();
    installHoverPreview();
    installAccessMode();
    installConflictHandling();
    installViewPersistence();
    installResizeHandling();
    installCriticalPathRecompute();
    installClipboardBridge();

    renderer.renderNow();

    /* ── Done ────────────────────────────────────────────────────────────── */
    dismissSplash();

    console.info(`CX Timeline ${APP_VERSION} ready in ${Math.round(performance.now() - started)}ms`);
  }

  /** Fade out the boot splash. Safe to call more than once. */
  function dismissSplash() {
    const splash = document.getElementById('boot');
    if (!splash || splash.classList.contains('done')) return;
    splash.classList.add('done');
    setTimeout(() => splash.remove(), 420);
  }

  /* ── Save conflicts ────────────────────────────────────────────────────── */

  /**
   * Two people editing one plan.
   *
   * The server refuses the second save rather than letting it overwrite, so the
   * only sensible thing left is to ask. Nothing is discarded silently: the local
   * copy is already cached, and reloading is a deliberate choice.
   */
  function installConflictHandling() {
    let asking = false;

    on(EV.SAVE_ERROR, async (payload) => {
      if (!payload?.conflict || asking) return;
      asking = true;
      const ok = await confirmDialog({
        title: 'Someone else saved this project',
        message:
          'Your changes were not saved, because they would have overwritten work saved by another person since you opened it. ' +
          'Reload to see their version — a copy of your version is kept in this browser and can be exported from Import / Export first.',
        confirmLabel: 'Reload their version',
        cancelLabel: 'Not yet',
      });
      asking = false;
      if (ok) window.location.reload();
    });
  }

  /* ── Recovery ──────────────────────────────────────────────────────────── */

  async function offerRecovery(recovery) {
    const ok = await confirmDialog({
      title: 'Unsaved work recovered',
      message: `A copy of "${recovery.name}" was saved when the application last closed, and it is newer than what was on disk. Restore it?`,
      confirmLabel: 'Restore it',
      cancelLabel: 'Discard',
    });
    if (ok) {
      store.replaceDoc(recovery, 'recovery');
      renderer.requestRender();
      toast({ tone: 'good', title: 'Recovered' });
    }
  }

  /* ── Date format ───────────────────────────────────────────────────────── */

  /**
   * Push the project's date-display order into `core/dates.js`.
   *
   * That module is a leaf and cannot read the store, so the preference is
   * pushed to it — on load, and again whenever the document changes, since an
   * import or a settings change can bring a different one.
   */
  function installDateFormat() {
    const apply = () => {
      const order = store.getSettings().dateOrder || 'mdy';
      if (order === getDateOrder()) return false;
      setDateOrder(order);
      return true;
    };

    apply();

    on(EV.DOC_CHANGED, (payload) => {
      if (payload?.transient) return;
      // A changed order invalidates every rendered date, including measured
      // ruler labels, so force a full repaint rather than a positional update.
      if (apply()) renderer.invalidateAll();
    });
    on(EV.DOC_REPLACED, () => {
      if (apply()) renderer.invalidateAll();
    });
  }

  /* ── Viewport persistence ──────────────────────────────────────────────── */

  /**
   * Restore the last view. If there is nothing sensible saved — a first run, or
   * a project imported elsewhere — frame the plan around today rather than
   * dropping the user at an arbitrary point in 1970.
   */
  function restoreView() {
    renderer.measure();
    const settings = store.getSettings();

    if (Number.isFinite(settings.originMs) && Number.isFinite(settings.zoomPxPerDay)) {
      viewport.restore({ originMs: settings.originMs, pxPerDay: settings.zoomPxPerDay });
      return;
    }

    const doc = store.getDoc();
    if (doc.objects.length) {
      const extent = projectExtent(doc);
      viewport.fitRange(extent.start, extent.end, 30);
    } else {
      const today = effectiveToday(doc);
      viewport.setPxPerDay(3.4);
      viewport.centerOn(today, 0.3);
    }
  }

  function installViewPersistence() {
    const persist = debounce(() => {
      store.setViewState({ originMs: viewport.getOrigin(), zoomPxPerDay: viewport.getPxPerDay() });
    }, 700);

    on(EV.VIEW_CHANGED, () => {
      renderer.requestRender();
      persist();
    });
  }

  /* ── Window resize ─────────────────────────────────────────────────────── */

  function installResizeHandling() {
    const onResize = debounce(() => {
      renderer.measure();
      renderer.requestRender();
    }, 80);

    window.addEventListener('resize', onResize);

    // Panels and the sidebar change the canvas size without a window resize.
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(onResize);
      observer.observe(document.getElementById('canvas-frame'));
    }
  }

  /* ── Critical path ─────────────────────────────────────────────────────── */

  /**
   * The critical path is derived state: recompute it whenever the plan changes,
   * but only while the highlight is switched on — the analysis is O(V+E) and
   * there is no sense paying for it on every keystroke when nothing shows it.
   */
  function installCriticalPathRecompute() {
    const recompute = debounce(() => {
      const doc = store.getDoc();
      if (!doc.settings.criticalPath) {
        renderer.setCriticalIds(new Set());
        return;
      }
      renderer.setCriticalIds(criticalPath(doc).critical);
      renderer.requestRender();
    }, 120);

    on(EV.DOC_CHANGED, (payload) => {
      if (payload?.transient) return;
      recompute();
    });
    on(EV.DOC_REPLACED, recompute);
    recompute();
  }

  /* ── Hover preview ─────────────────────────────────────────────────────── */

  /**
   * Hovering an object shows a summary card, including a preview of its notes.
   * This is the "notes on hover" half of the brief; clicking opens the editor.
   */
  function installHoverPreview() {
    let lastId = null;

    on('canvas:hover', ({ id, clientX, clientY }) => {
      lastId = id;
      if (!id) {
        hideTooltip();
        return;
      }
      const obj = store.getObject(id);
      if (!obj) return;
      showTooltip(clientX, clientY, buildHoverCard(obj), { delay: 380 });
    });

    on('canvas:hovermove', ({ id, clientX, clientY }) => {
      // Re-anchor without restarting the delay, so the card follows the pointer.
      if (id !== lastId) return;
    });

    window.addEventListener('mousedown', hideTooltip);
    on(EV.VIEW_CHANGED, hideTooltip);
  }

  function buildHoverCard(obj) {
    const def = TYPES[obj.type] || TYPES.activity;
    const lane = store.getLane(obj.lane);
    const status = statusOf(obj.status);

    const meta = [
      def.label,
      lane?.name,
      def.duration ? `${fmtDate(obj.start, 'medium')} → ${fmtDate(obj.end, 'medium')} (${fmtDuration(durationDays(obj))})` : fmtDate(obj.start, 'long'),
    ].filter(Boolean);

    const details = [
      obj.owner ? `Owner: ${obj.owner}` : null,
      obj.area ? `Area: ${obj.area}` : null,
      obj.data?.version ? `Version ${obj.data.version}` : null,
      obj.data?.buildNumber ? `Build ${obj.data.buildNumber}` : null,
      obj.data?.testPackage ? `Package ${obj.data.testPackage}` : null,
      obj.data?.reference ? `Ref ${obj.data.reference}` : null,
      def.progress ? `${Math.round(obj.progress)}% complete` : null,
      (obj.attachments || []).length ? `${obj.attachments.length} attachment(s)` : null,
    ].filter(Boolean);

    return el('div', {}, [
      el('div', { class: 'tip-title', text: obj.title }),
      obj.subtitle
        ? el('div', { style: { fontSize: 'var(--fs-tiny)', color: 'var(--text-muted)', marginBottom: '2px' }, text: obj.subtitle })
        : null,
      el('div', { class: 'tip-meta', text: meta.join('  ·  ') }),
      el('div', { style: { marginTop: '5px', display: 'flex', gap: '5px', flexWrap: 'wrap' } }, [
        el('span', { class: `cx-badge ${status.tone === 'neutral' ? 'neutral' : status.tone}`, text: status.label }),
      ]),
      details.length
        ? el('div', { style: { marginTop: '5px', fontSize: 'var(--fs-tiny)', color: 'var(--text-muted)' }, text: details.join('  ·  ') })
        : null,
      obj.notes
        ? el('div', { class: 'tip-notes' }, [renderNote(obj.notes, { max: 170 })])
        : null,
    ]);
  }

  /* ── System clipboard bridge ───────────────────────────────────────────── */

  /**
   * Paste of an *external* file (a dragged JSON, a copied image) is handled
   * here; in-app copy/paste of objects lives in commands.js and never touches
   * the system clipboard for structured data.
   */
  function installClipboardBridge() {
    document.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    });

    document.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      // Panels handle their own drops; anything reaching the document is a
      // project file the user wants to open.
      if (e.target.closest('.att-drop')) return;
      e.preventDefault();
      emit('ui:file-dropped', { file: e.dataTransfer.files[0] });
      toast({
        tone: 'info',
        title: 'Open Import / Export to load this file',
        message: e.dataTransfer.files[0].name,
      });
    });
  }

  /* ── Go ────────────────────────────────────────────────────────────────── */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Surface unexpected failures rather than leaving a silently broken canvas.
  window.addEventListener('error', (e) => {
    console.error('[cx-timeline]', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[cx-timeline] unhandled promise rejection:', e.reason);
  });


};

  __req("main.js");
})();
