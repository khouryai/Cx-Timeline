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

import { emit, EV } from '../core/events.js';
import { getPref, setPref } from '../core/storage.js';
import { getDoc, setSetting } from '../core/store.js';
import { invalidateAll } from '../timeline/renderer.js';

export const THEMES = [
  { id: 'dark', label: 'Dark', icon: 'moon', description: 'The default — engineering dashboard on deep slate.' },
  { id: 'light', label: 'Light', icon: 'sun', description: 'The CX Portal palette, value for value.' },
  { id: 'engineering', label: 'Engineering', icon: 'cpu', description: 'High-contrast instrument panel, monospace UI.' },
  { id: 'blueprint', label: 'Blueprint', icon: 'grid', description: 'Drafting-table blue with cyan rules.' },
  { id: 'presentation', label: 'Presentation', icon: 'maximize', description: 'Bright and low-chrome for customer meetings.' },
];

let current = 'dark';

export function initTheme() {
  const saved = getPref('theme');
  const fromDoc = getDoc()?.settings?.theme;
  applyTheme(saved || fromDoc || 'dark', { persist: false });
}

export function getTheme() {
  return current;
}

/**
 * Switch theme. Object nodes carry resolved colours (for contrast maths), so
 * every one is invalidated and repainted rather than left with stale ink.
 */
export function applyTheme(id, { persist = true, syncDoc = true } = {}) {
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
export function cycleTheme() {
  const i = THEMES.findIndex((t) => t.id === current);
  applyTheme(THEMES[(i + 1) % THEMES.length].id);
}

/** True for themes whose surfaces are light — used by exporters. */
export function isLightTheme(id = current) {
  return id === 'light' || id === 'presentation';
}
