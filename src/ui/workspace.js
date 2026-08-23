/**
 * Which whole interface is on screen.
 *
 * Until now the application had exactly one stage — the timeline canvas — and
 * the only thing resembling a mode was presentation mode, which hides the
 * chrome around that same canvas. The resource calendar is a genuinely
 * different interface over genuinely different data, so it needs a peer of the
 * canvas rather than another dock pane.
 *
 * Two rules keep the switch cheap and safe:
 *
 * **The timeline is hidden, never unmounted.** `renderer.mount()` clears its
 * host, so tearing the canvas down and rebuilding it would throw away the
 * viewport, the selection and the render caches, and switching back would cost
 * a full relayout. Hiding it with a class costs nothing and comes back exactly
 * as it was left.
 *
 * **The calendar is built on first use, not at boot.** `main.js` calls
 * `CX_SHELL.confirmHealthy()` at the end of boot, and that call is what tells
 * the desktop shell a downloaded update actually works — anything that throws
 * before it makes the next launch roll back. A module that needs a network and
 * an account has no business in front of that gate, so nothing here runs until
 * somebody asks for it.
 *
 * Imports: events (leaf).
 */

import { emit, EV } from '../core/events.js';

export const WORKSPACES = ['timeline', 'calendar'];

let active = 'timeline';
let builder = null;
let built = false;

/**
 * Register how to build the calendar stage, without building it.
 *
 * `main.js` hands the builder over during boot; it runs the first time
 * somebody switches. Keeping the registration and the construction apart is
 * what lets boot stay synchronous and network-free.
 */
export function registerCalendar(fn) {
  builder = fn;
}

export function current() {
  return active;
}

export function isTimeline() {
  return active === 'timeline';
}

/**
 * Show a workspace. Safe to call with the one already showing.
 *
 * The body carries `data-workspace` so CSS can hide whichever stage is not in
 * use, and so a stylesheet can drop the timeline-only toolbar groups without
 * every control having to know about modes.
 */
export function show(name) {
  if (!WORKSPACES.includes(name) || name === active) return active;

  if (name === 'calendar' && !built) {
    built = true;
    try {
      builder?.();
    } catch (err) {
      // A calendar that cannot start must not take the timeline with it. The
      // stage stays empty, the error is reported, and the switch back works.
      built = false;
      console.error('[cx-timeline] the resource calendar failed to start:', err);
    }
  }

  active = name;
  if (typeof document !== 'undefined') {
    document.body.dataset.workspace = active;
  }
  emit(EV.WORKSPACE_CHANGED, { workspace: active });
  return active;
}

/** For tests and teardown. */
export function reset() {
  active = 'timeline';
  built = false;
  builder = null;
  if (typeof document !== 'undefined') document.body.dataset.workspace = 'timeline';
}
