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
import { normalise, makeProject, makeObject, makeLane, makeLink, effectiveToday, TYPES, syncLists, defaultLists, LIST_DEFS, listUsage } from './model.js';
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
