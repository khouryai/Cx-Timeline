/**
 * The application store — the one place the current document lives.
 *
 * Everything that changes the project goes through `edit()`, which:
 *   1. hands the caller a mutable draft,
 *   2. diffs the result against the previous document,
 *   3. records the patch on the undo stack,
 *   4. publishes `doc:changed` so the UI, autosave and renderer react.
 *
 * Transient interaction (dragging a bar, live-resizing) uses `preview()`,
 * which updates the document without touching history; the interaction
 * commits once with a single `edit()` when the pointer is released.
 *
 * On a hosted deployment a project can be open read-only. Because every write
 * funnels through the three entry points below, one guard covers the whole
 * application — there is no path to a mutation that does not pass through
 * here. The guard is a courtesy to the user, not the security boundary: that
 * is row-level security in Postgres, which refuses the same writes even if
 * this check were removed.
 *
 * Imports: util, events, cloud, model, history.
 */

import { deepClone, clamp } from './util.js';
import { emit, EV } from './events.js';
import { isReadOnly } from './cloud.js';
import {
  normalise, makeProject, makeObject, makeLane, makeLink, effectiveToday, TYPES,
  syncLists, defaultLists, LIST_DEFS, listUsage,
  emptyRegister, makeP6Activity, p6Register, p6Activity, p6Dates, p6PlacedIds,
  p6LinkedIds, p6RollUp, makeP6Baseline, baselineSnapshot, isDerivedBaseline,
} from './model.js';
import { History, diff, apply } from './history.js';

/* ── Private state ─────────────────────────────────────────────────────── */

/**
 * The current document.
 *
 * INVARIANT: `doc` is never mutated in place. Every write path builds a new
 * object graph and reassigns this binding. Two things depend on that:
 *
 *   1. `edit()` can use the outgoing `doc` directly as the "before" side of
 *      its diff, instead of paying for a second deep clone.
 *   2. Derived analysis (critical path, dependency violations) is memoised in
 *      a WeakMap keyed on this object, so document identity *is* the cache
 *      key — no revision counter to keep in step, and stale entries are
 *      collected automatically.
 *
 * Break the invariant and both go quietly wrong.
 */
let doc = normalise(makeProject());
let history = new History();
let objectIndex = new Map();
let laneIndex = new Map();
let dirty = false;
let previewBase = null; // document snapshot taken when a preview session opens

/** Transient UI state — never persisted with the document. */
const ui = {
  selection: new Set(),
  hoverId: null,
  tool: 'select', // select | pan | connect | note | <object type>
  filters: {
    text: '',
    types: [],
    statuses: [],
    lanes: [],
    owners: [],
    subsystems: [],
    areas: [],
    tags: [],
    from: null,
    to: null,
  },
  clipboard: null,
};

/* ── Write guard ───────────────────────────────────────────────────────── */

/**
 * True when this write must not happen, having said so.
 *
 * `preview` is announced quietly: a viewer dragging a bar would otherwise
 * raise a notification on every mouse-move.
 */
function refuseWrite(label) {
  if (!isReadOnly()) return false;
  if (label !== 'preview') emit(EV.EDIT_REFUSED, { label });
  return true;
}

/** True when the open project is read-only for the signed-in user. */
export function isDocReadOnly() {
  return isReadOnly();
}

/* ── Indexing ──────────────────────────────────────────────────────────── */

function reindex() {
  objectIndex = new Map(doc.objects.map((o) => [o.id, o]));
  laneIndex = new Map(doc.lanes.map((l) => [l.id, l]));
  // The document owns its vocabularies; push them down to the model so the
  // renderer, legend and badge helpers resolve against this project's lists.
  syncLists(doc.lists);
}
reindex();

/* ── Reading ───────────────────────────────────────────────────────────── */

/** The live document. Treat as read-only — mutate through `edit()`. */
export function getDoc() {
  return doc;
}

export function getSettings() {
  return doc.settings;
}

export function getObject(id) {
  return objectIndex.get(id) || null;
}

export function getLane(id) {
  return laneIndex.get(id) || null;
}

/** Lanes in display order, optionally excluding hidden ones. */
export function orderedLanes(includeHidden = true) {
  const out = [];
  for (const id of doc.laneOrder) {
    const lane = laneIndex.get(id);
    if (lane && (includeHidden || !lane.hidden)) out.push(lane);
  }
  return out;
}

/** Objects belonging to a lane, sorted by z then start. */
export function objectsInLane(laneId) {
  return doc.objects
    .filter((o) => o.lane === laneId)
    .sort((a, b) => a.z - b.z || a.start - b.start);
}

export function today() {
  return effectiveToday(doc);
}

export function isDirty() {
  return dirty;
}

export function markClean() {
  dirty = false;
}

/* ── Writing ───────────────────────────────────────────────────────────── */

/**
 * Apply a mutation and record it in history.
 *
 * @param {string}   label     Human description, shown in version history.
 * @param {Function} mutator   Receives a mutable draft of the document.
 * @param {object}   [opts]
 * @param {string}   [opts.mergeKey]  Consecutive edits sharing a key coalesce.
 * @param {string}   [opts.reason]    Passed through on the change event.
 * @returns {boolean} true when the document actually changed.
 */
export function edit(label, mutator, opts = {}) {
  if (refuseWrite(label)) return false;

  // No clone needed for the "before" side: `doc` is immutable by invariant,
  // and `draft` is a separate graph. This halves the cloning cost of an edit.
  const before = previewBase || doc;
  const draft = deepClone(doc);

  const result = mutator(draft);
  if (result === false) {
    previewBase = null;
    return false;
  }

  draft.modified = Date.now();
  draft.meta = draft.meta || {};
  draft.meta.editCount = (draft.meta.editCount || 0) + 1;

  const patch = diff(before, draft, label);
  previewBase = null;
  if (!patch) {
    // Still adopt the draft: it may hold non-diffed churn like `modified`.
    doc = draft;
    reindex();
    return false;
  }

  doc = draft;
  reindex();
  history.push(patch, opts.mergeKey || null);
  dirty = true;

  emit(EV.DOC_CHANGED, { reason: opts.reason || label, patch });
  emit(EV.HISTORY_CHANGED, historyState());
  return true;
}

/**
 * Update the document without recording history — for live drag feedback.
 * The first call in a gesture snapshots the pre-gesture document so the
 * eventual `edit()` produces one patch covering the whole gesture.
 *
 * Prefer `previewObjects()` for anything driven by pointer movement: this
 * variant deep-clones the whole document, which a drag would pay for on every
 * frame.
 */
export function preview(mutator) {
  if (refuseWrite('preview')) return false;
  if (!previewBase) previewBase = doc;
  const draft = deepClone(doc);
  if (mutator(draft) === false) return false;
  doc = draft;
  reindex();
  emit(EV.DOC_CHANGED, { reason: 'preview', transient: true });
  return true;
}

/**
 * Copy-on-write preview of specific objects — the fast path for dragging.
 *
 * A drag touches a handful of objects but used to deep-clone the entire
 * document on every mouse-move, so the cost of moving one bar grew with the
 * size of the whole plan. This clones only the objects named in `ids` and
 * shares every other object by reference, which keeps a gesture's per-frame
 * cost proportional to the selection instead of the project.
 *
 * The result is still a brand-new document object, so the immutability
 * invariant — and the memoisation that rides on it — holds.
 *
 * @param {string[]} ids       Objects the mutator is allowed to change.
 * @param {Function} mutate    Called once per object with a private copy.
 */
export function previewObjects(ids, mutate) {
  if (refuseWrite('preview')) return false;
  if (!previewBase) previewBase = doc;

  const targets = new Set(ids);
  if (!targets.size) return false;

  const next = doc.objects.map((o) => {
    if (!targets.has(o.id)) return o;
    // Clone only what a drag can touch; `style`/`data` stay shared until the
    // inspector actually edits them.
    const copy = { ...o };
    if (mutate(copy) === false) return o;
    return copy;
  });

  doc = { ...doc, objects: next };

  // Patch the index rather than rebuilding it over every object.
  for (const o of next) if (targets.has(o.id)) objectIndex.set(o.id, o);

  emit(EV.DOC_CHANGED, { reason: 'preview', transient: true });
  return true;
}

/** Abandon an in-flight preview gesture and restore the pre-gesture state. */
export function cancelPreview() {
  if (!previewBase) return;
  doc = previewBase;
  previewBase = null;
  reindex();
  emit(EV.DOC_CHANGED, { reason: 'preview-cancel', transient: true });
}

/** True while a gesture is staging changes outside history. */
export function hasPreview() {
  return previewBase !== null;
}

/**
 * Change settings or view state that should persist but never appear in the
 * undo stack (zoom level, panel widths, the active dock tab).
 */
export function editQuiet(mutator, reason = 'quiet') {
  // Pan, zoom and the input preferences are how a *reader* uses the plan, so
  // they are deliberately not gated — they never reach the server.
  const draft = deepClone(doc);
  if (mutator(draft) === false) return false;
  doc = draft;
  reindex();
  dirty = true;
  emit(EV.DOC_CHANGED, { reason, quiet: true });
  return true;
}

/** Replace the whole document (new / open / import / restore). */
export function replaceDoc(next, reason = 'replace') {
  doc = normalise(next);
  reindex();
  history.clear();
  ui.selection.clear();
  previewBase = null;
  dirty = reason !== 'load';
  emit(EV.DOC_REPLACED, { reason });
  emit(EV.DOC_CHANGED, { reason });
  emit(EV.SELECTION_CHANGED, { ids: [] });
  emit(EV.HISTORY_CHANGED, historyState());
  return doc;
}

/* ── History ───────────────────────────────────────────────────────────── */

export function historyState() {
  return { canUndo: history.canUndo, canRedo: history.canRedo, depth: history.depth };
}

export function recentHistory(n) {
  return history.recent(n);
}

export function undo() {
  const patch = history.undo();
  if (!patch) return false;
  doc = apply(deepClone(doc), patch);
  reindex();
  pruneSelection();
  dirty = true;
  emit(EV.DOC_CHANGED, { reason: 'undo' });
  emit(EV.HISTORY_CHANGED, historyState());
  return true;
}

export function redo() {
  const patch = history.redo();
  if (!patch) return false;
  doc = apply(deepClone(doc), patch);
  reindex();
  pruneSelection();
  dirty = true;
  emit(EV.DOC_CHANGED, { reason: 'redo' });
  emit(EV.HISTORY_CHANGED, historyState());
  return true;
}

/** Undo repeatedly until the given history entry has been rolled back. */
export function revertTo(patchId) {
  const idx = history.indexOf(patchId);
  if (idx < 0) return false;
  const steps = history.depth - idx;
  for (let i = 0; i < steps; i++) if (!undo()) break;
  return true;
}

/* ── Selection ─────────────────────────────────────────────────────────── */

export function getSelection() {
  return Array.from(ui.selection);
}

export function selectedObjects() {
  return getSelection().map((id) => objectIndex.get(id)).filter(Boolean);
}

export function isSelected(id) {
  return ui.selection.has(id);
}

export function setSelection(ids) {
  const next = new Set((ids || []).filter((id) => objectIndex.has(id)));
  if (next.size === ui.selection.size && Array.from(next).every((id) => ui.selection.has(id))) return;
  ui.selection = next;
  emit(EV.SELECTION_CHANGED, { ids: getSelection() });
}

export function addToSelection(ids) {
  setSelection([...getSelection(), ...[].concat(ids)]);
}

export function toggleSelection(id) {
  const next = new Set(ui.selection);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setSelection(Array.from(next));
}

export function clearSelection() {
  setSelection([]);
}

export function selectAll() {
  setSelection(doc.objects.filter((o) => !o.hidden && !isLaneHidden(o.lane)).map((o) => o.id));
}

function isLaneHidden(laneId) {
  const lane = laneIndex.get(laneId);
  return !!lane?.hidden;
}

/** Drop selection entries whose object no longer exists (after undo/delete). */
function pruneSelection() {
  const before = ui.selection.size;
  for (const id of Array.from(ui.selection)) if (!objectIndex.has(id)) ui.selection.delete(id);
  if (ui.selection.size !== before) emit(EV.SELECTION_CHANGED, { ids: getSelection() });
}

/* ── Transient UI state ────────────────────────────────────────────────── */

export function getTool() {
  return ui.tool;
}

export function setTool(tool) {
  if (ui.tool === tool) return;
  ui.tool = tool;
  emit(EV.TOOL_CHANGED, { tool });
}

export function getHover() {
  return ui.hoverId;
}

export function setHover(id) {
  ui.hoverId = id;
}

export function getFilters() {
  return ui.filters;
}

export function setFilters(patch) {
  Object.assign(ui.filters, patch);
  emit(EV.FILTER_CHANGED, { filters: ui.filters });
}

export function resetFilters() {
  setFilters({
    text: '',
    types: [],
    statuses: [],
    lanes: [],
    owners: [],
    subsystems: [],
    areas: [],
    tags: [],
    from: null,
    to: null,
  });
}

export function hasActiveFilters() {
  const f = ui.filters;
  return !!(
    f.text ||
    f.types.length ||
    f.statuses.length ||
    f.lanes.length ||
    f.owners.length ||
    f.subsystems.length ||
    f.areas.length ||
    f.tags.length ||
    f.from ||
    f.to
  );
}

export function getClipboard() {
  return ui.clipboard;
}

export function setClipboard(payload) {
  ui.clipboard = payload;
}

/* ══════════════════════════════════════════════════════════════════════════
   Document operations
   The vocabulary the UI actually calls. Each is one undoable edit.
   ═══════════════════════════════════════════════════════════════════════ */

export function addObject(props, label = 'Add object') {
  const obj = makeObject(props);
  if (!obj.lane) obj.lane = doc.laneOrder[0] || null;
  obj.z = nextZ();
  edit(label, (d) => {
    d.objects.push(obj);
  });
  return obj.id;
}

export function addObjects(list, label = 'Add objects') {
  const made = list.map((p) => {
    const o = makeObject(p);
    if (!o.lane) o.lane = doc.laneOrder[0] || null;
    return o;
  });
  let z = nextZ();
  made.forEach((o) => {
    o.z = z++;
  });
  edit(label, (d) => {
    d.objects.push(...made);
  });
  return made.map((o) => o.id);
}

export function updateObject(id, patch, label = 'Edit object', opts = {}) {
  return edit(
    label,
    (d) => {
      const o = d.objects.find((x) => x.id === id);
      if (!o) return false;
      applyObjectPatch(o, patch);
      o.modified = Date.now();
    },
    opts
  );
}

export function updateObjects(ids, patch, label = 'Edit objects', opts = {}) {
  return edit(
    label,
    (d) => {
      const set = new Set(ids);
      let hit = false;
      for (const o of d.objects) {
        if (!set.has(o.id)) continue;
        applyObjectPatch(o, typeof patch === 'function' ? patch(o) : patch);
        o.modified = Date.now();
        hit = true;
      }
      if (!hit) return false;
    },
    opts
  );
}

/** Shallow-merge a patch, but merge `style` and `data` one level deeper. */
function applyObjectPatch(obj, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'style' || k === 'data') Object.assign(obj[k], v);
    else obj[k] = v;
  }
  if (TYPES[obj.type]?.duration && obj.end <= obj.start) obj.end = obj.start + 86400000;
  obj.progress = clamp(obj.progress ?? 0, 0, 100);
}

export function removeObjects(ids, label = 'Delete') {
  const set = new Set([].concat(ids));
  if (!set.size) return false;
  const ok = edit(label, (d) => {
    d.objects = d.objects.filter((o) => !set.has(o.id));
    d.links = d.links.filter((l) => !set.has(l.from) && !set.has(l.to));
  });
  pruneSelection();
  return ok;
}

/** Highest z + 1, so new objects land on top. */
function nextZ() {
  return doc.objects.reduce((m, o) => Math.max(m, o.z || 0), 0) + 1;
}

export function bringToFront(ids) {
  let z = nextZ();
  updateObjects(ids, () => ({ z: z++ }), 'Bring to front');
}

export function sendToBack(ids) {
  const min = doc.objects.reduce((m, o) => Math.min(m, o.z || 0), 0);
  let z = min - [].concat(ids).length;
  updateObjects(ids, () => ({ z: z++ }), 'Send to back');
}

export function raise(ids) {
  updateObjects(ids, (o) => ({ z: (o.z || 0) + 1 }), 'Raise');
}

export function lower(ids) {
  updateObjects(ids, (o) => ({ z: (o.z || 0) - 1 }), 'Lower');
}

/* ── Lanes ─────────────────────────────────────────────────────────────── */

export function addLane(props, index = -1) {
  const lane = makeLane(props);
  edit('Add lane', (d) => {
    d.lanes.push(lane);
    if (index >= 0 && index < d.laneOrder.length) d.laneOrder.splice(index, 0, lane.id);
    else d.laneOrder.push(lane.id);
  });
  return lane.id;
}

export function updateLane(id, patch, label = 'Edit lane', opts = {}) {
  return edit(
    label,
    (d) => {
      const lane = d.lanes.find((l) => l.id === id);
      if (!lane) return false;
      Object.assign(lane, patch);
      lane.height = clamp(lane.height, 28, 480);
    },
    opts
  );
}

/** Remove a lane. Its objects move to `moveTo`, or are deleted if null. */
export function removeLane(id, moveTo = null) {
  return edit('Delete lane', (d) => {
    d.lanes = d.lanes.filter((l) => l.id !== id);
    d.laneOrder = d.laneOrder.filter((x) => x !== id);
    if (moveTo) {
      for (const o of d.objects) if (o.lane === id) o.lane = moveTo;
    } else {
      const gone = new Set(d.objects.filter((o) => o.lane === id).map((o) => o.id));
      d.objects = d.objects.filter((o) => o.lane !== id);
      d.links = d.links.filter((l) => !gone.has(l.from) && !gone.has(l.to));
    }
  });
}

export function moveLane(id, toIndex) {
  return edit('Reorder lanes', (d) => {
    const from = d.laneOrder.indexOf(id);
    if (from < 0) return false;
    const target = clamp(toIndex, 0, d.laneOrder.length - 1);
    if (from === target) return false;
    d.laneOrder.splice(from, 1);
    d.laneOrder.splice(target, 0, id);
  });
}

/* ── Links ─────────────────────────────────────────────────────────────── */

export function addLink(props) {
  const link = makeLink(props);
  if (!link.from || !link.to || link.from === link.to) return null;
  const exists = doc.links.some((l) => l.from === link.from && l.to === link.to);
  if (exists) return null;
  if (createsCycle(link.from, link.to)) return null;
  edit('Add dependency', (d) => {
    d.links.push(link);
  });
  return link.id;
}

export function updateLink(id, patch, label = 'Edit dependency') {
  return edit(label, (d) => {
    const l = d.links.find((x) => x.id === id);
    if (!l) return false;
    Object.assign(l, patch);
  });
}

export function removeLinks(ids) {
  const set = new Set([].concat(ids));
  return edit('Delete dependency', (d) => {
    d.links = d.links.filter((l) => !set.has(l.id));
  });
}

/** Links touching any of the given object ids. */
export function linksFor(ids) {
  const set = new Set([].concat(ids));
  return doc.links.filter((l) => set.has(l.from) || set.has(l.to));
}

/**
 * Would adding from → to close a loop? Dependency graphs must stay acyclic,
 * otherwise critical-path analysis and slip propagation never terminate.
 */
export function createsCycle(from, to) {
  const adjacency = new Map();
  for (const l of doc.links) {
    if (!adjacency.has(l.from)) adjacency.set(l.from, []);
    adjacency.get(l.from).push(l.to);
  }
  const seen = new Set();
  const stack = [to];
  while (stack.length) {
    const node = stack.pop();
    if (node === from) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adjacency.get(node) || []) stack.push(next);
  }
  return false;
}

/* ── Settings ──────────────────────────────────────────────────────────── */

/**
 * Settings that describe how input behaves rather than how the plan reads.
 * These are preferences, so they persist but stay out of the undo stack —
 * pressing Ctrl+Z should never silently change your snapping back.
 */
const INPUT_PREFERENCES = new Set(['snap', 'wheelMode', 'weekStart', 'dateOrder']);

/** Settings changes are undoable — they alter how the plan reads. */
export function setSetting(key, value, label = 'Change setting') {
  if (doc.settings[key] === value) return false;
  if (INPUT_PREFERENCES.has(key)) {
    return editQuiet((d) => {
      d.settings[key] = value;
    }, 'preference');
  }
  return edit(label, (d) => {
    d.settings[key] = value;
  });
}

/** View state (zoom, pan) persists but stays out of history. */
export function setViewState(patch) {
  return editQuiet((d) => {
    Object.assign(d.settings, patch);
  }, 'view');
}

export function setMeta(patch, label = 'Edit project details') {
  return edit(label, (d) => {
    Object.assign(d, patch);
  });
}

/* ── Baselines ─────────────────────────────────────────────────────────── */

export function addBaseline(baseline) {
  edit('Take baseline', (d) => {
    d.baselines.push(baseline);
    d.settings.activeBaseline = baseline.id;
    d.settings.showBaseline = true;
  });
  return baseline.id;
}

export function removeBaseline(id) {
  return edit('Delete baseline', (d) => {
    d.baselines = d.baselines.filter((b) => b.id !== id);
    if (d.settings.activeBaseline === id) {
      d.settings.activeBaseline = d.baselines.length ? d.baselines[d.baselines.length - 1].id : null;
      if (!d.settings.activeBaseline) d.settings.showBaseline = false;
    }
  });
}

export function activeBaseline() {
  const id = doc.settings.activeBaseline;
  return id ? doc.baselines.find((b) => b.id === id) || null : null;
}

/* ── Attachments registry ──────────────────────────────────────────────── */

export function addAttachmentRecord(record) {
  edit('Attach file', (d) => {
    d.attachments.push(record);
  });
  return record.id;
}

export function removeAttachmentRecord(id) {
  return edit('Remove attachment', (d) => {
    d.attachments = d.attachments.filter((a) => a.id !== id);
    for (const o of d.objects) {
      if (o.attachments?.includes(id)) o.attachments = o.attachments.filter((x) => x !== id);
    }
  });
}

export function getAttachment(id) {
  return doc.attachments.find((a) => a.id === id) || null;
}

/* ══════════════════════════════════════════════════════════════════════════
   Editable lists (status, subsystem, test type, severity, approval, fonts)
   ═══════════════════════════════════════════════════════════════════════ */

export function getList(listId) {
  return doc.lists?.[listId] || [];
}

/** How many objects currently use an option. */
export function listOptionUsage(listId, optionId) {
  return listUsage(doc, listId, optionId);
}

/**
 * Add an option. Returns its id, or null when the id is already taken —
 * duplicate ids would make the value ambiguous.
 */
export function addListOption(listId, { id, label, color, tone }) {
  const optionId = String(id ?? label ?? '').trim();
  if (!optionId && listId !== 'font') return null;
  if (getList(listId).some((o) => o.id === optionId)) return null;

  const option = { id: optionId, label: String(label || optionId).trim() || optionId };
  if (color) option.color = color;
  if (tone) option.tone = tone;

  edit(`Add ${LIST_DEFS[listId]?.label || listId} option`, (d) => {
    if (!d.lists[listId]) d.lists[listId] = [];
    d.lists[listId].push(option);
  });
  return optionId;
}

export function updateListOption(listId, optionId, patch, opts = {}) {
  return edit(
    `Edit ${LIST_DEFS[listId]?.label || listId} option`,
    (d) => {
      const option = (d.lists[listId] || []).find((o) => o.id === optionId);
      if (!option) return false;
      // The id is the stored value on every object, so it is not editable —
      // only the presentation is.
      if (patch.label != null) option.label = String(patch.label);
      if (patch.color !== undefined) {
        if (patch.color) option.color = patch.color;
        else delete option.color;
      }
      if (patch.tone !== undefined) {
        if (patch.tone) option.tone = patch.tone;
        else delete option.tone;
      }
    },
    opts
  );
}

/**
 * Delete an option, rewriting the objects that use it.
 *
 * `reassignTo` moves them onto another option; omitting it clears the field.
 * Both happen in the same edit as the removal, so one undo puts everything
 * back and the document is never left referencing a deleted option.
 */
export function removeListOption(listId, optionId, { reassignTo = '' } = {}) {
  const def = LIST_DEFS[listId];
  if (!def) return false;

  return edit(`Remove ${def.label} option`, (d) => {
    d.lists[listId] = (d.lists[listId] || []).filter((o) => o.id !== optionId);

    for (const obj of d.objects) {
      if (def.field && obj[def.field] === optionId) obj[def.field] = reassignTo;
      if (def.styleKey && obj.style?.[def.styleKey] === optionId) obj.style[def.styleKey] = reassignTo;
      if (def.dataKeys) {
        for (const key of def.dataKeys) {
          if (obj.data?.[key] === optionId) obj.data[key] = reassignTo;
        }
      }
    }
  });
}

/** Move an option up or down the list. */
export function moveListOption(listId, optionId, delta) {
  return edit(`Reorder ${LIST_DEFS[listId]?.label || listId}`, (d) => {
    const list = d.lists[listId] || [];
    const from = list.findIndex((o) => o.id === optionId);
    const to = clamp(from + delta, 0, list.length - 1);
    if (from < 0 || from === to) return false;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
  });
}

/** Restore one list to the shipped defaults, keeping any option still in use. */
export function resetList(listId) {
  return edit(`Reset ${LIST_DEFS[listId]?.label || listId}`, (d) => {
    const seeds = defaultLists()[listId] || [];
    const keep = [];
    for (const option of d.lists[listId] || []) {
      const stillUsed = listUsage(d, listId, option.id) > 0;
      if (stillUsed && !seeds.some((s) => s.id === option.id)) keep.push(option);
    }
    d.lists[listId] = [...seeds, ...keep];
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   The P6 register
   ═══════════════════════════════════════════════════════════════════════ */

export function getP6() {
  return p6Register(doc);
}

export function getP6Activity(id) {
  return p6Activity(doc, id);
}

export function placedP6Ids() {
  return p6PlacedIds(doc);
}

/**
 * Apply an import.
 *
 * A baseline import writes the baseline dates and leaves progress alone; a
 * progress import writes progress and keeps the previous progress so the next
 * screen can say what moved. Neither ever touches an object's own dates —
 * that is a separate, explicit step the user takes from the review.
 *
 * @param {string} kind      'baseline' | 'progress'
 * @param {Array}  incoming  activities from `parseP6Rows`, each with `.dates`
 * @param {object} meta      { fileName, label }
 */
export function importP6(kind, incoming, meta = {}) {
  const isBaseline = kind === 'baseline';
  const stamp = { importedAt: Date.now(), fileName: meta.fileName || '', label: meta.label || '', count: incoming.length };

  return edit(`Import P6 ${isBaseline ? 'baseline' : 'progress'}`, (d) => {
    const register = d.p6 && typeof d.p6 === 'object' ? d.p6 : emptyRegister();
    register.activities = register.activities || {};

    const incomingIds = new Set();

    for (const activity of incoming) {
      incomingIds.add(activity.id);
      const current = register.activities[activity.id];

      if (!current) {
        register.activities[activity.id] = makeP6Activity({
          ...activity,
          [isBaseline ? 'baseline' : 'progress']: activity.dates,
        });
        continue;
      }

      // The name and WBS come from whichever import ran last: the scheduler
      // renames things, and the newest file is the better authority.
      current.name = activity.name || current.name;
      if (activity.wbs) current.wbs = activity.wbs;
      if (activity.percent != null) current.percent = activity.percent;
      if (activity.status) current.status = activity.status;
      current.order = activity.order;
      current.missing = false;

      if (isBaseline) {
        current.baseline = activity.dates;
      } else {
        current.previous = current.progress || null;
        current.progress = activity.dates;
      }
    }

    // Anything the file did not mention is marked, never removed — an object
    // may be linked to it, and a bar whose activity silently vanished is
    // worse than one labelled "no longer in P6".
    for (const activity of Object.values(register.activities)) {
      if (!incomingIds.has(activity.id)) activity.missing = true;
    }

    register[isBaseline ? 'baseline' : 'progress'] = stamp;
    register.history = [{ kind, ...stamp }, ...(register.history || [])].slice(0, 12);
    d.p6 = register;
    ensureP6Baselines(d);
  });
}

/** Forget every imported activity. Objects keep their links, harmlessly. */
export function clearP6() {
  return edit('Clear the P6 register', (d) => {
    d.p6 = emptyRegister();
  });
}

/**
 * Put an activity on the timeline.
 *
 * The new object's dates start from P6 and are then yours: the link records
 * where they came from, it does not tie them together.
 */
export function placeP6Activity(activityId, { lane = null, type = null } = {}) {
  const activity = p6Activity(doc, activityId);
  if (!activity) return null;
  const dates = p6Dates(activity);
  if (!dates) return null;

  const laneId = lane || doc.laneOrder[0] || doc.lanes[0]?.id || null;
  const isMilestone = dates.start === dates.end;

  const object = makeObject({
    type: type || (isMilestone ? 'milestone' : 'activity'),
    lane: laneId,
    title: activity.name || activityId,
    subtitle: activityId,
    start: dates.start,
    end: dates.end,
    data: { p6Ids: [activityId] },
  });

  edit(`Add ${activityId} from P6`, (d) => {
    d.objects.push(object);
  });
  return object.id;
}

/**
 * Add an activity to what an object tracks.
 *
 * Additive, because one bar routinely stands for a whole test package. Use
 * `unlinkP6` to take one away and `setP6Links` to replace the set outright.
 */
export function linkP6(objectId, activityId) {
  if (!activityId) return false;
  return edit(`Link to ${activityId}`, (d) => {
    const object = d.objects.find((o) => o.id === objectId);
    if (!object) return false;
    object.data = object.data || {};
    const ids = p6LinkedIds(object);
    if (ids.includes(activityId)) return false;
    object.data.p6Ids = [...ids, activityId];
    delete object.data.p6Id;
  });
}

/** Stop tracking one activity, or all of them when no id is given. */
export function unlinkP6(objectId, activityId = null) {
  return edit(activityId ? `Unlink ${activityId}` : 'Unlink from P6', (d) => {
    const object = d.objects.find((o) => o.id === objectId);
    if (!object?.data) return false;
    const ids = p6LinkedIds(object);
    const next = activityId ? ids.filter((id) => id !== activityId) : [];
    if (next.length === ids.length && activityId) return false;
    object.data.p6Ids = next;
    delete object.data.p6Id;
  });
}

/** Replace everything an object tracks. */
export function setP6Links(objectId, activityIds) {
  return edit('Change P6 links', (d) => {
    const object = d.objects.find((o) => o.id === objectId);
    if (!object) return false;
    object.data = object.data || {};
    object.data.p6Ids = [...new Set([].concat(activityIds || []).filter(Boolean))];
    delete object.data.p6Id;
  });
}

/**
 * Move linked objects onto their P6 dates.
 *
 * This is the "accept" half of an import: the file proposes, and this applies
 * only what was chosen. Everything not named keeps the dates it had.
 */
export function adoptP6Dates(activityIds) {
  const wanted = new Set([].concat(activityIds));
  if (!wanted.size) return false;

  return edit('Adopt P6 dates', (d) => {
    let touched = 0;
    for (const object of d.objects) {
      const ids = p6LinkedIds(object);
      // An object tracking several activities follows when any one of them
      // was chosen: its dates are the roll-up, so the whole set matters.
      if (!ids.some((id) => wanted.has(id))) continue;
      const dates = p6RollUp(d, object);
      if (!dates) continue;
      object.start = dates.start;
      object.end = TYPES[object.type]?.duration ? dates.end : dates.start;
      object.modified = Date.now();
      touched++;
    }
    if (!touched) return false;
  });
}

/**
 * Make sure the P6 comparisons exist as baselines.
 *
 * They hold no rows: a P6 baseline has to answer for whatever is linked *now*,
 * so linking another activity must change the comparison without anyone
 * re-taking a snapshot. `baselineSnapshot()` computes the rows on demand, and
 * these entries are only the marker saying which side of the register to read.
 *
 * Called after every import, so the pair appear on their own and stay in step.
 */
function ensureP6Baselines(d) {
  const register = d.p6 || emptyRegister();
  d.baselines = d.baselines || [];

  for (const kind of ['baseline', 'progress']) {
    const imported = !!register[kind];
    const index = d.baselines.findIndex((b) => b.source === 'p6' && b.p6Kind === kind);

    if (!imported) continue;
    if (index < 0) d.baselines.push(makeP6Baseline(kind));
  }
}

/**
 * Show one of the P6 comparisons on the timeline.
 * Returns the baseline id, or null when that side has not been imported.
 */
export function showP6Comparison(kind = 'progress') {
  const target = doc.baselines.find((b) => b.source === 'p6' && b.p6Kind === kind);
  if (!target) return null;

  edit(`Compare against the P6 ${kind}`, (d) => {
    d.settings.activeBaseline = target.id;
    d.settings.showBaseline = true;
  });
  return target.id;
}

/** The rows a baseline compares against, computed for the P6 ones. */
export function snapshotOf(baseline) {
  return baselineSnapshot(doc, baseline);
}

/* ── Groups ────────────────────────────────────────────────────────────── */

export function groupObjects(ids, name = 'Group') {
  const members = [].concat(ids).filter((id) => objectIndex.has(id));
  if (members.length < 2) return null;
  const group = { id: `grp_${Date.now().toString(36)}`, name, created: Date.now() };
  edit('Group', (d) => {
    d.groups.push(group);
    for (const o of d.objects) if (members.includes(o.id)) o.groupId = group.id;
  });
  return group.id;
}

export function ungroupObjects(ids) {
  const groupIds = new Set(
    [].concat(ids).map((id) => objectIndex.get(id)?.groupId).filter(Boolean)
  );
  if (!groupIds.size) return false;
  return edit('Ungroup', (d) => {
    for (const o of d.objects) if (groupIds.has(o.groupId)) o.groupId = null;
    d.groups = d.groups.filter((g) => !groupIds.has(g.id));
  });
}

/** Expand a selection to include every sibling of any grouped member. */
export function expandGroupSelection(ids) {
  const out = new Set([].concat(ids));
  const groups = new Set(
    [].concat(ids).map((id) => objectIndex.get(id)?.groupId).filter(Boolean)
  );
  if (groups.size) {
    for (const o of doc.objects) if (o.groupId && groups.has(o.groupId)) out.add(o.id);
  }
  return Array.from(out);
}

/* ── Testing seam ──────────────────────────────────────────────────────── */

/** Reset the store to a known state. Used by the headless test harness. */
export function __resetForTests(nextDoc) {
  doc = normalise(nextDoc || makeProject());
  history = new History();
  ui.selection.clear();
  previewBase = null;
  dirty = false;
  reindex();
}
