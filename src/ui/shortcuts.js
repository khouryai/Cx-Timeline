/**
 * Keyboard shortcuts.
 *
 * One capture-phase listener maps key combinations onto commands. Shortcuts
 * stand down entirely while focus is in a text field or a modal is open, so
 * typing "d" into a title never duplicates an object.
 *
 * Imports: util, events, store, renderer, interactions, commands, components, panels.
 */

import { hasMod, isTyping, IS_MAC } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import * as store from '../core/store.js';
import * as renderer from '../timeline/renderer.js';
import { nudgeSelection, stretchSelection } from '../timeline/interactions.js';
import * as cmd from './commands.js';
import { modalOpen, closeMenu, closePopover } from './components.js';
import { showPane } from './panels.js';

export function installShortcuts() {
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
      nudgeSelection(e.shiftKey ? -7 : -1);
      return;
    case 'ArrowRight':
      e.preventDefault();
      nudgeSelection(e.shiftKey ? 7 : 1);
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
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';
