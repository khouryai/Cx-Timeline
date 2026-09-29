/**
 * The command menu — mod+K.
 *
 * Twenty dock panes, a toolbar, a context menu and a list of shortcuts nobody
 * remembers: the application can do a great deal, and most of it is found by
 * already knowing where it is. This is the one place to type what you want
 * — "baseline", "hidden", "dark", "milestone" — and go there. It adds no
 * behaviour of its own: every entry calls the same command a menu, a button
 * or a shortcut calls (`ui/commands.js`), so there is still one
 * implementation and this is one more way in.
 *
 * Imports: events, model, commands, components, panels, theme, workspace.
 */

import { emit } from '../core/events.js';
import { TYPES } from '../core/model.js';
import * as cmd from './commands.js';
import { openPicker, modalOpen } from './components.js';
import { showPane, TITLES } from './panels.js';
import { THEMES, applyTheme } from './theme.js';
import * as workspace from './workspace.js';

/** On the timeline — a pane or an action there switches back to it first. */
function onTimeline(fn) {
  return () => {
    if (!workspace.isTimeline()) workspace.show('timeline');
    fn();
  };
}

/** Every entry, built when the menu opens so it reflects the moment. */
export function commandEntries() {
  const entries = [];
  const add = (label, meta, run) => entries.push({ label, meta, run });

  for (const [pane, title] of Object.entries(TITLES)) {
    add(title, 'Open pane', onTimeline(() => showPane(pane)));
  }

  add('Fit the whole plan', 'View · mod+0', onTimeline(cmd.fitAll));
  add('Zoom to the selection', 'View · mod+shift+0', onTimeline(cmd.zoomToSelection));
  add('Go to today', 'View · T', onTimeline(cmd.goToToday));
  add('Show only a date range…', 'View · hides everything outside it', onTimeline(cmd.openDateWindow));
  add('Clear the date range', 'View', onTimeline(cmd.clearDateWindow));
  add('Hidden objects…', 'View · show them again', onTimeline(cmd.openHiddenList));
  add('Presentation mode', 'View · P', onTimeline(cmd.togglePresentation));

  add('Hide the selection', 'Edit · mod+shift+H', onTimeline(cmd.toggleHidden));
  add('Duplicate the selection', 'Edit · mod+D', onTimeline(cmd.duplicateSelection));
  add('Select all', 'Edit · mod+A', onTimeline(cmd.selectAll));
  add('Select broken dependencies', 'Edit', onTimeline(cmd.selectViolations));
  add('Fix every broken dependency', 'Edit', onTimeline(cmd.resolveAllViolations));
  add('Add a lane', 'Edit', onTimeline(() => cmd.addLane()));

  for (const [type, def] of Object.entries(TYPES)) {
    add(`Add ${def.label.toLowerCase()}`, `Add · ${def.group}`, onTimeline(() => cmd.createObject(type)));
  }

  add('Take a baseline', 'Plan', onTimeline(cmd.takeBaseline));
  add('Save a restore point', 'Plan · mod+S', onTimeline(cmd.saveSnapshot));
  add('Print or export to PDF', 'Plan · mod+P', onTimeline(() => emit('ui:print')));
  add('New project', 'Plan', onTimeline(cmd.newProject));

  for (const theme of THEMES) add(`${theme.label} theme`, `Theme · ${theme.description}`, () => applyTheme(theme.id));

  if (document.querySelector('.ws-switch')) {
    add('Switch to the timeline', 'Workspace', () => workspace.show('timeline'));
    add('Switch to the resource calendar', 'Workspace', () => workspace.show('calendar'));
  }
  add('Keyboard shortcuts', 'Help · ?', cmd.showShortcuts);
  return entries;
}

export function openCommandMenu() {
  if (modalOpen()) return null;
  const entries = commandEntries();
  return openPicker({
    title: 'Go to…',
    subtitle: 'A pane, an action, an object to add or a theme. Type to narrow.',
    placeholder: 'What do you want to do?',
    items: entries.map((e, i) => ({ label: e.label, meta: e.meta, value: String(i) })),
    empty: 'Nothing by that name.',
    onPick: (value) => {
      const entry = entries[Number(value)];
      // After the menu has closed, so a command that opens a dialog of its own
      // does not open it underneath the one that is going away.
      if (entry) setTimeout(entry.run, 0);
    },
  });
}

/** Wired by main.js — kept here so the shortcut and the button share it. */
export function installCommandMenu() {
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandMenu();
    }
  }, true);
}
