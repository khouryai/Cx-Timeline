/**
 * What the dock's panes share, kept out of `ui/panels.js` so the panes can live
 * in modules of their own.
 *
 * A pane cannot import the dock — the dock imports the panes — so it asks for
 * its own redraw, or for another pane, through the event bus: the same rule
 * CLAUDE.md sets for any pane that changes only its own view state, and one
 * that respects the "never rebuild under a caret" guard for free.
 *
 * Imports: util, events, icons.
 */

import { el } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { icon } from './icons.js';

/** Redraw whichever pane is on screen. */
export function refreshPane() {
  emit(EV.PANE_REFRESH, {});
}

/** Open another pane. */
export function goToPane(name) {
  emit(EV.PANE_OPEN, { pane: name });
}

export function statRow(label, value) {
  return el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: 'var(--fs-tiny)' } }, [
    el('span', { style: { color: 'var(--text-subtle)' }, text: label }),
    el('span', { class: 'mono', style: { color: 'var(--text-muted)' }, text: value }),
  ]);
}

/* ── Shared helpers ────────────────────────────────────────────────────── */

export function iconBtn(name, title, onClick) {
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
