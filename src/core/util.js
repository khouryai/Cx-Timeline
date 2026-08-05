/**
 * Small, dependency-free helpers used across the whole application.
 * This is a leaf module: it must never import anything.
 */

/* ── Identity ──────────────────────────────────────────────────────────── */

let _idCounter = 0;

/** Short, collision-resistant id. Prefixed so ids are readable in exports. */
export function uid(prefix = 'o') {
  _idCounter = (_idCounter + 1) % 0xffff;
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 0x1000000).toString(36);
  const c = _idCounter.toString(36);
  return `${prefix}_${t}${r}${c}`;
}

/* ── Math ──────────────────────────────────────────────────────────────── */

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Round to `step`, e.g. round(37, 5) === 35. */
export function roundTo(v, step) {
  return step ? Math.round(v / step) * step : v;
}

/* ── Objects ───────────────────────────────────────────────────────────── */

/** Structured deep clone with a JSON fallback for older engines. */
export function deepClone(value) {
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
export function deepEqual(a, b) {
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
export function merge(base, patch) {
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
export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

/* ── Functions ─────────────────────────────────────────────────────────── */

export function debounce(fn, ms = 200) {
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

export function throttle(fn, ms = 60) {
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
export function rafBatch(fn) {
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

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip tags and collapse whitespace — for search indexing and previews. */
export function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

export function truncate(s, n = 60) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Case-insensitive, accent-insensitive fold for search. */
export function fold(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function bytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ── Colour ────────────────────────────────────────────────────────────── */

/** '#rrggbb' | '#rgb' → {r,g,b}; returns null for anything else. */
export function hexToRgb(hex) {
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

export function rgbToHex(r, g, b) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Mix two hex colours; t=0 → a, t=1 → b. */
export function mixHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return a;
  return rgbToHex(lerp(ca.r, cb.r, t), lerp(ca.g, cb.g, t), lerp(ca.b, cb.b, t));
}

export function withAlpha(hex, alpha) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${clamp(alpha, 0, 1)})`;
}

/** Relative luminance (WCAG) — used to choose readable label ink. */
export function luminance(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0.5;
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** Pick black or white ink so text stays legible on `hex`. */
export function readableInk(hex, dark = '#0b0f1a', light = '#ffffff') {
  return luminance(hex) > 0.48 ? dark : light;
}

/* ── DOM ───────────────────────────────────────────────────────────────── */

/**
 * Terse element factory.
 *   el('div', { class: 'x', dataset: { id: 1 } }, [child, 'text'])
 */
export function el(tag, attrs = {}, children = []) {
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

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

/** Remove every child without touching the parent node itself. */
export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Walk up from `node` to find the closest ancestor carrying `attr`. */
export function closestData(node, attr, stop) {
  let n = node;
  while (n && n !== stop && n !== document.body) {
    if (n.dataset && n.dataset[attr] !== undefined) return n;
    n = n.parentElement;
  }
  return null;
}

/* ── Files ─────────────────────────────────────────────────────────────── */

/** Trigger a browser download for a Blob or string. */
export function download(filename, data, mime = 'application/octet-stream') {
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
export function pickFiles({ accept = '', multiple = false } = {}) {
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

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(file);
  });
}

/* ── Misc ──────────────────────────────────────────────────────────────── */

/** Detect the platform modifier so shortcut hints read correctly. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** True when the event carries the platform's "command" modifier. */
export function hasMod(e) {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

/** True when focus is inside a text-entry control (so shortcuts stand down). */
export function isTyping(target) {
  const n = target || document.activeElement;
  if (!n) return false;
  const tag = (n.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || n.isContentEditable === true;
}

/** Sort comparator factory for a numeric or string field. */
export function by(key, dir = 1) {
  return (a, b) => {
    const va = typeof key === 'function' ? key(a) : a[key];
    const vb = typeof key === 'function' ? key(b) : b[key];
    if (va === vb) return 0;
    return (va > vb ? 1 : -1) * dir;
  };
}
