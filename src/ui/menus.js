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

import { on, emit, EV } from '../core/events.js';
import { fmtDate, MS_DAY } from '../core/dates.js';
import { TYPES, listOptions, typeGroups, statusOf } from '../core/model.js';
import * as store from '../core/store.js';
import * as renderer from '../timeline/renderer.js';
import { icon } from './icons.js';
import { contextMenu, confirmDialog, promptDialog, toast, colorControl, popover, closePopover } from './components.js';
import * as cmd from './commands.js';
import { openListManager } from './lists.js';
import { openNoteEditor } from './notes.js';
import { showPane } from './panels.js';
import { linkViolations } from '../core/analysis.js';
import { openObjectDialog } from './dialogs.js';

export function installMenus() {
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
