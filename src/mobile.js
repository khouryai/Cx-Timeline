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

import { applyTheme, followSystem } from './mobile/theme.js';
import { installPwa } from './mobile/pwa.js';
import { start } from './mobile/shell.js';

applyTheme();
followSystem();

const go = () => {
  installPwa();
  start();
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
else go();
