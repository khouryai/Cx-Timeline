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

export const THEME_CHOICES = [
  { value: 'system', label: 'Phone' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function themePreference() {
  try {
    const held = localStorage.getItem(KEY);
    return THEME_CHOICES.some((c) => c.value === held) ? held : 'system';
  } catch {
    return 'system';
  }
}

export function setThemePreference(value) {
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
export function applyTheme(pref = themePreference()) {
  const dark = pref === 'dark' || (pref === 'system' && systemDark());
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const bar = getComputedStyle(document.documentElement).getPropertyValue('--chrome-bg').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bar) meta.setAttribute('content', bar);
}

/** Follow the phone when it switches, for as long as the choice is "Phone". */
export function followSystem() {
  if (typeof matchMedia !== 'function') return;
  const query = matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (themePreference() === 'system') applyTheme('system');
  };
  if (query.addEventListener) query.addEventListener('change', onChange);
  else if (query.addListener) query.addListener(onChange);
}
