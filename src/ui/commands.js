/**
 * Commands — the single implementation of every user-invokable action.
 *
 * The context menu, the keyboard shortcuts, the toolbar and the inspector all
 * call the same functions here, so a behaviour never drifts between the three
 * ways of reaching it and there is exactly one place to fix a bug.
 *
 * Imports: util, events, dates, model, store, storage, filestore, viewport,
 *          renderer, interactions, icons, components.
 */

import { el, download, clamp } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { MS_DAY, toISO, fmtDate, addDays } from '../core/dates.js';
import { TYPES, makeBaseline, makeObject, projectExtent, effectiveToday, makeProject } from '../core/model.js';
import * as store from '../core/store.js';
import { saveNow, makeBackup, openFolderPlan, createFolderPlan, leaveFolder } from '../core/storage.js';
import * as filestore from '../core/filestore.js';
import { linkViolations, resolutionFor } from '../core/analysis.js';
import * as viewport from '../timeline/viewport.js';
import * as renderer from '../timeline/renderer.js';
import { icon } from './icons.js';
import { toast, confirmDialog, promptDialog, openModal } from './components.js';

/* ── Clipboard ─────────────────────────────────────────────────────────── */

/**
 * Copy the selection to the in-app clipboard.
 * Dependencies wholly inside the selection travel with it; dangling ones do
 * not, because pasting half a relationship is never what anyone wants.
 */
export function copySelection() {
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

export function cutSelection() {
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
export function paste({ atMs = null, laneId = null } = {}) {
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
export function duplicateSelection() {
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

export async function deleteSelection({ confirm = true } = {}) {
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

export function selectAll() {
  store.selectAll();
  renderer.requestRender();
}

export function selectNone() {
  store.clearSelection();
  renderer.setSelectedLinks([]);
  renderer.requestRender();
}

/** Extend the selection to everything in the same lane. */
export function selectLane() {
  const objects = store.selectedObjects();
  if (!objects.length) return;
  const lanes = new Set(objects.map((o) => o.lane));
  store.setSelection(store.getDoc().objects.filter((o) => lanes.has(o.lane)).map((o) => o.id));
  renderer.requestRender();
}

/** Select everything the current selection depends on, transitively. */
export function selectDependencyChain() {
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

export function toggleLock() {
  const objects = store.selectedObjects();
  if (!objects.length) return;
  const lock = !objects.every((o) => o.locked);
  store.updateObjects(objects.map((o) => o.id), { locked: lock }, lock ? 'Lock' : 'Unlock');
  renderer.requestRender();
}

export function toggleHidden() {
  const objects = store.selectedObjects();
  if (!objects.length) return;
  const hide = !objects.every((o) => o.hidden);
  store.updateObjects(objects.map((o) => o.id), { hidden: hide }, hide ? 'Hide' : 'Show');
  renderer.requestRender();
}

export function groupSelection() {
  const ids = store.getSelection();
  if (ids.length < 2) {
    toast({ tone: 'warn', title: 'Select two or more objects to group' });
    return;
  }
  store.groupObjects(ids);
  renderer.requestRender();
}

export function ungroupSelection() {
  store.ungroupObjects(store.getSelection());
  renderer.requestRender();
}

export function setStatus(status) {
  const ids = store.getSelection();
  if (!ids.length) return;
  store.updateObjects(ids, { status }, 'Change status');
  renderer.requestRender();
}

export function setProgress(percent) {
  const ids = store.getSelection();
  if (!ids.length) return;
  store.updateObjects(ids, { progress: clamp(percent, 0, 100) }, 'Change progress');
  renderer.requestRender();
}

/* ── Creation ──────────────────────────────────────────────────────────── */

/** Create an object of `type` at a date and lane, then select it. */
export function createObject(type, { ms = null, laneId = null, select = true } = {}) {
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

export async function addLane(afterIndex = -1) {
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
export function resolveViolation(linkId) {
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
 * Hide or show one dependency line.
 *
 * A currently-broken link cannot be hidden — setting the flag would only be
 * cleared straight back by `installHiddenLinkGuard()` in `main.js`, so the
 * button that would do it is not offered at all (see the inspector's link
 * panel). Hiding is otherwise a plain toggle: the guard is what takes it away
 * again, the moment the dependency it was hiding becomes a problem.
 */
export function toggleLinkHidden(id) {
  const doc = store.getDoc();
  const link = doc.links.find((l) => l.id === id);
  if (!link) return false;
  if (!link.hidden && linkViolations(doc).byLink.get(id)?.violated) return false;

  store.updateLink(id, { hidden: !link.hidden }, link.hidden ? 'Show dependency' : 'Hide dependency');
  renderer.requestRender();
  return true;
}

/**
 * Resolve every broken dependency, repeatedly, so fixing one that cascades
 * into another settles the whole chain rather than leaving the next one red.
 */
export function resolveAllViolations() {
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
export function selectViolations() {
  const violations = linkViolations(store.getDoc());
  if (!violations.count) {
    toast({ tone: 'info', title: 'No broken dependencies' });
    return;
  }
  store.setSelection(Array.from(violations.objects.keys()));
  zoomToSelection();
}

/* ── Baselines ─────────────────────────────────────────────────────────── */

export async function takeBaseline() {
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

export function zoomIn() {
  viewport.zoomBy(1.42);
  renderer.requestRender();
}

export function zoomOut() {
  viewport.zoomBy(0.7);
  renderer.requestRender();
}

export function fitAll() {
  const extent = projectExtent(store.getDoc());
  viewport.fitRange(extent.start, extent.end, 30);
  renderer.requestRender();
}

/** Frame the current selection. */
export function zoomToSelection() {
  const objects = store.selectedObjects();
  if (!objects.length) return fitAll();
  const start = Math.min(...objects.map((o) => o.start));
  const end = Math.max(...objects.map((o) => (TYPES[o.type]?.duration ? o.end : o.start + MS_DAY)));
  viewport.fitRange(start, end, 80);
  renderer.requestRender();
  return true;
}

export function goToToday() {
  viewport.centerOn(effectiveToday(store.getDoc()), 0.42);
  renderer.requestRender();
}

export function togglePresentation() {
  emit(EV.PRESENT_MODE, { on: !document.body.classList.contains('presenting') });
}

/* ── Project lifecycle ─────────────────────────────────────────────────── */

export async function newProject() {
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

export async function saveSnapshot() {
  await saveNow();
  await makeBackup('manual');
  toast({ tone: 'good', title: 'Snapshot saved', message: 'A restore point was added to Backups.' });
}

/* ── The shared folder ─────────────────────────────────────────────────── */

/**
 * Connect a folder — a shared drive, or one synced by OneDrive or SharePoint —
 * and open a plan in it.
 *
 * The picker must be opened from a click, so this is only ever reachable from a
 * button. When the folder already holds exactly one plan it opens straight into
 * it; otherwise the user chooses, because guessing between a colleague's plans
 * is how you end up editing the wrong programme.
 */
export async function connectFolder() {
  if (!filestore.isSupported()) {
    toast({
      tone: 'warn',
      title: 'Not supported in this browser',
      message: 'Opening a folder needs Edge or Chrome. Everything else works here as normal.',
    });
    return false;
  }

  let picked;
  try {
    picked = await filestore.chooseFolder();
  } catch (err) {
    // Cancelling the picker is not an error worth reporting.
    if (err && err.name === 'AbortError') return false;
    toast({ tone: 'bad', title: 'Could not open that folder', message: err.message });
    return false;
  }
  if (!picked) return false;

  if (!picked.plans.length) return createFolderPlanFromCurrent();
  if (picked.plans.length === 1) return openFolderPlanByName(picked.plans[0].name);

  emit(EV.PANE_REFRESH, { pane: 'io' });
  toast({
    tone: 'info',
    title: `${picked.folder} connected`,
    message: `${picked.plans.length} plans in this folder — choose one to open.`,
  });
  return true;
}

/** Re-grant access to the folder this device used last. */
export async function reconnectFolder() {
  const connected = await filestore.reconnectWithPrompt();
  if (!connected) {
    toast({ tone: 'warn', title: 'Could not reconnect', message: 'Choose the folder again to carry on.' });
    return false;
  }
  const wanted = connected.lastPlan || (connected.plans.length === 1 ? connected.plans[0].name : '');
  if (wanted) return openFolderPlanByName(wanted);
  emit(EV.PANE_REFRESH, { pane: 'io' });
  return true;
}

/** Open one of the plans in the connected folder. */
export async function openFolderPlanByName(name) {
  try {
    const { doc, role, holder } = await openFolderPlan(name);
    store.replaceDoc(doc, 'load');
    emit(EV.FILE_STATE, filestore.state());
    fitAll();
    toast({
      tone: role === 'viewer' ? 'warn' : 'good',
      title: role === 'viewer' ? `${name} — read-only` : `${name} opened`,
      message:
        role === 'viewer'
          ? `${holder} has this plan open. You can read it, and it becomes editable when they close it.`
          : 'Saved straight to the folder from now on.',
    });
    return true;
  } catch (err) {
    toast({ tone: 'bad', title: 'Could not open that plan', message: err.message });
    return false;
  }
}

/** Write the plan currently open into the connected folder for the first time. */
export async function createFolderPlanFromCurrent() {
  const doc = store.getDoc();
  const suggested = `${(doc.name || 'programme').replace(/[^a-z0-9 \-_]+/gi, '').trim() || 'programme'}.json`;
  const name = await promptDialog({
    title: 'Put this plan in the folder',
    label: 'File name',
    value: suggested,
    placeholder: 'programme.json',
  });
  if (!name) return false;

  try {
    const written = await createFolderPlan(name, doc);
    emit(EV.FILE_STATE, filestore.state());
    toast({
      tone: 'good',
      title: `${written} created`,
      message: 'Every change from now on is written straight into the folder.',
    });
    return true;
  } catch (err) {
    toast({ tone: 'bad', title: 'Could not write that file', message: err.message });
    return false;
  }
}

/** Stop using the folder. The plan stays on disk exactly as it is. */
export async function disconnectFolder() {
  const ok = await confirmDialog({
    title: 'Disconnect the folder?',
    message:
      'The plan file stays where it is — this only stops CX Timeline writing to it. ' +
      'Changes after this are kept in this browser instead.',
    confirmLabel: 'Disconnect',
  });
  if (!ok) return false;
  await leaveFolder();
  emit(EV.FILE_STATE, filestore.state());
  toast({ tone: 'info', title: 'Folder disconnected' });
  return true;
}

/**
 * Pull in a colleague's save.
 *
 * Offered when the file has moved on disk. Anything unsaved here would be lost,
 * so it says so rather than discarding quietly.
 */
export async function reloadFromFolder({ confirm = true } = {}) {
  if (confirm && store.isDirty()) {
    const ok = await confirmDialog({
      title: 'Reload from the folder?',
      message: 'You have changes that have not been written. Reloading replaces them with the file on disk.',
      confirmLabel: 'Reload',
      danger: true,
    });
    if (!ok) return false;
  }
  try {
    const doc = await filestore.refreshFromDisk();
    if (!doc) return false;
    store.replaceDoc(doc, 'load');
    renderer.requestRender();
    toast({ tone: 'good', title: 'Reloaded', message: 'You are looking at the latest saved version.' });
    return true;
  } catch (err) {
    toast({ tone: 'bad', title: 'Could not reload', message: err.message });
    return false;
  }
}

/**
 * Take the pen.
 *
 * Always possible, because the alternative — refusing — leaves someone who
 * knows the other session is dead with nowhere to go. When the lock is still
 * being stamped it asks first, since that is a live colleague rather than an
 * abandoned tab. Either way nobody's work is lost: whoever saves second is told
 * to reload rather than overwriting.
 */
export async function takeOverEditing() {
  const status = await filestore.lockStatus();

  if (status.live) {
    const ok = await confirmDialog({
      title: `${status.holder} is editing this plan`,
      message:
        `${status.holder} saved within the last minute, so they are probably still working. ` +
        'Taking over means their next save is refused and they will be asked to reload — ' +
        'anything they have not saved could be lost. Continue?',
      confirmLabel: 'Take over anyway',
      cancelLabel: 'Leave it',
      danger: true,
    });
    if (!ok) return false;
  }

  await filestore.takeOver();
  toast({ tone: 'good', title: 'You have the pen', message: 'This plan is editable again.' });
  return true;
}

/**
 * Say who has the plan, before anybody starts typing.
 *
 * The web build cannot do this: a browser tab has to draw an interface, open a
 * folder and read a lock file in that order, so the news that a colleague has
 * the pen always arrives after the canvas. The desktop shell reads the lock
 * before the window exists (`startup_lock_check` in `src-tauri/src/main.rs`),
 * which means this is the first thing on screen and not a correction to it.
 *
 * Three states, three different things worth saying:
 *
 *   a live colleague    a modal, because carrying on regardless means finding
 *                       out at the first save. It offers the way out — taking
 *                       over — rather than only stating the problem.
 *   an abandoned lock   a note. The pen is already ours; `checkLock()` reclaims
 *                       a stale lock without being asked. Silence here reads as
 *                       "so it did not matter that their name was on it", and it
 *                       did — they may have unsaved work in a dead session.
 *   free, or ours       nothing at all.
 */
export async function announceStartupPen(pen) {
  if (!pen || pen.mine) return null;

  if (!pen.live) {
    if (pen.free && pen.holder) {
      toast({
        tone: 'info',
        title: 'You have the pen',
        message: `${pen.holder} left this plan open but stopped saving ${sinceWords(pen.idle_ms)} ago, so it is yours to edit.`,
        timeout: 9000,
      });
    }
    return 'editing';
  }

  const holder = pen.holder || 'Someone else';
  return new Promise((resolve) => {
    let settled = false;
    openModal({
      title: `${holder} has this plan open`,
      subtitle: `Last saved ${sinceWords(pen.idle_ms)} ago`,
      body: el('div', { style: { fontSize: 'var(--fs-small)', color: 'var(--text-muted)', lineHeight: '1.6' } }, [
        el('p', {
          style: { margin: '0 0 10px' },
          text:
            `${holder} is editing it now, so it opens read-only. Their saves arrive here as they make them, ` +
            'and it becomes editable on its own once they close it — nothing to do but carry on reading.',
        }),
        el('p', {
          style: { margin: 0 },
          text:
            'Taking over now means their next save is refused and they are asked to reload, ' +
            'so anything they have not saved could be lost. Worth a message first.',
        }),
      ]),
      actions: [
        'spacer',
        {
          label: 'Take over editing',
          kind: 'danger',
          onClick: async () => {
            settled = true;
            await filestore.takeOver();
            emit(EV.FILE_STATE, filestore.state());
            resolve('editing');
          },
        },
        {
          label: 'Open read-only',
          kind: 'primary',
          autofocus: true,
          onClick: () => {
            settled = true;
            resolve('viewer');
          },
        },
      ],
      onClose: () => {
        if (!settled) resolve('viewer');
      },
    });
  });
}

/** "4 minutes", "2 hours" — enough to judge whether somebody is still there. */
function sinceWords(ms) {
  const seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/* ── Navigation ────────────────────────────────────────────────────────── */

/** Jump to and flash an object — used by search results and outline rows. */
export function revealObject(id) {
  store.setSelection([id]);
  renderer.revealObject(id);
}

/* ── Keyboard help ─────────────────────────────────────────────────────── */

export const SHORTCUTS = [
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

export function showShortcuts() {
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
