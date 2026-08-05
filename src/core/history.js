/**
 * Undo / redo — a structural diff engine over the project document.
 *
 * Naive undo stacks keep a full copy of the document per edit, which stops
 * scaling the moment notes and attachments arrive. Instead, every edit is
 * reduced to a *patch*: the entities that were added, removed or changed, and
 * the top-level fields that moved. A patch is typically a few hundred bytes,
 * so a deep history costs almost nothing, and its inverse is just the patch
 * read backwards.
 *
 * Imports: util (leaf).
 */

import { deepClone, deepEqual, uid } from './util.js';

/** Collections diffed by entity id. */
const COLLECTIONS = ['lanes', 'objects', 'links', 'baselines', 'groups', 'attachments'];

/** Top-level fields diffed by value. */
const FIELDS = ['name', 'description', 'client', 'programme', 'settings', 'laneOrder', 'meta'];

/* ── Diff ──────────────────────────────────────────────────────────────── */

function indexById(list) {
  const map = new Map();
  for (const item of list || []) map.set(item.id, item);
  return map;
}

/**
 * Compute the patch that turns `before` into `after`.
 * Returns null when nothing actually changed — callers use that to avoid
 * pushing no-op entries onto the stack.
 */
export function diff(before, after, label = 'Edit') {
  const patch = { id: uid('h'), label, time: Date.now(), collections: {}, fields: {}, order: {} };
  let touched = false;

  for (const key of COLLECTIONS) {
    const a = indexById(before[key]);
    const b = indexById(after[key]);
    const added = [];
    const removed = [];
    const changed = [];

    for (const [id, item] of b) {
      const prev = a.get(id);
      if (!prev) added.push(deepClone(item));
      else if (!deepEqual(prev, item)) changed.push({ before: deepClone(prev), after: deepClone(item) });
    }
    for (const [id, item] of a) {
      if (!b.has(id)) removed.push(deepClone(item));
    }

    // Order within a collection is meaningful for z-stacking and lane display,
    // so record it whenever the sequence of ids moved.
    const orderA = (before[key] || []).map((x) => x.id);
    const orderB = (after[key] || []).map((x) => x.id);
    const orderMoved = !deepEqual(orderA, orderB) && !added.length && !removed.length;

    if (added.length || removed.length || changed.length || orderMoved) {
      patch.collections[key] = { added, removed, changed };
      if (orderMoved) patch.order[key] = { before: orderA, after: orderB };
      touched = true;
    }
  }

  for (const key of FIELDS) {
    if (!deepEqual(before[key], after[key])) {
      patch.fields[key] = { before: deepClone(before[key]), after: deepClone(after[key]) };
      touched = true;
    }
  }

  return touched ? patch : null;
}

/** Reverse a patch so it can be applied as an undo. */
export function invert(patch) {
  const out = { ...patch, collections: {}, fields: {}, order: {} };
  for (const [key, delta] of Object.entries(patch.collections)) {
    out.collections[key] = {
      added: delta.removed,
      removed: delta.added,
      changed: delta.changed.map((c) => ({ before: c.after, after: c.before })),
    };
  }
  for (const [key, f] of Object.entries(patch.fields)) {
    out.fields[key] = { before: f.after, after: f.before };
  }
  for (const [key, o] of Object.entries(patch.order || {})) {
    out.order[key] = { before: o.after, after: o.before };
  }
  return out;
}

/**
 * Apply a patch to a document **in place** and return it.
 * Removal happens before insertion so a "replace" patch behaves predictably.
 */
export function apply(doc, patch) {
  for (const [key, delta] of Object.entries(patch.collections || {})) {
    const list = Array.isArray(doc[key]) ? doc[key] : (doc[key] = []);

    if (delta.removed.length) {
      const gone = new Set(delta.removed.map((x) => x.id));
      for (let i = list.length - 1; i >= 0; i--) if (gone.has(list[i].id)) list.splice(i, 1);
    }
    if (delta.changed.length) {
      const byId = new Map(delta.changed.map((c) => [c.after.id, c.after]));
      for (let i = 0; i < list.length; i++) {
        const next = byId.get(list[i].id);
        if (next) list[i] = deepClone(next);
      }
    }
    if (delta.added.length) {
      for (const item of delta.added) {
        if (!list.some((x) => x.id === item.id)) list.push(deepClone(item));
      }
    }
  }

  for (const [key, o] of Object.entries(patch.order || {})) {
    const list = doc[key];
    if (!Array.isArray(list)) continue;
    const rank = new Map(o.after.map((id, i) => [id, i]));
    list.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e9) - (rank.has(b.id) ? rank.get(b.id) : 1e9));
  }

  for (const [key, f] of Object.entries(patch.fields || {})) {
    doc[key] = deepClone(f.after);
  }

  return doc;
}

/** Human summary of a patch, used by the version-history panel. */
export function describe(patch) {
  const parts = [];
  for (const [key, delta] of Object.entries(patch.collections || {})) {
    const noun = key.replace(/s$/, '');
    if (delta.added.length) parts.push(`+${delta.added.length} ${noun}`);
    if (delta.removed.length) parts.push(`−${delta.removed.length} ${noun}`);
    if (delta.changed.length) parts.push(`~${delta.changed.length} ${noun}`);
  }
  for (const key of Object.keys(patch.fields || {})) parts.push(key);
  return parts.join(', ') || 'no change';
}

/* ── The stack ─────────────────────────────────────────────────────────── */

/**
 * A bounded undo/redo stack of patches.
 *
 * `coalesceMs` merges consecutive edits carrying the same `mergeKey` inside a
 * short window, so typing a title or nudging a bar with the arrow keys
 * produces one undo step rather than forty.
 */
export class History {
  constructor({ limit = 200, coalesceMs = 600 } = {}) {
    this.limit = limit;
    this.coalesceMs = coalesceMs;
    this.undoStack = [];
    this.redoStack = [];
    this._lastKey = null;
    this._lastTime = 0;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  get depth() {
    return this.undoStack.length;
  }

  /**
   * Record a patch. When `mergeKey` matches the previous entry and the entries
   * are close in time, the two are folded into one so undo feels natural.
   */
  push(patch, mergeKey = null) {
    if (!patch) return;
    const now = Date.now();
    const canMerge =
      mergeKey &&
      mergeKey === this._lastKey &&
      now - this._lastTime < this.coalesceMs &&
      this.undoStack.length > 0;

    if (canMerge) {
      this.undoStack[this.undoStack.length - 1] = mergePatches(this.undoStack[this.undoStack.length - 1], patch);
    } else {
      this.undoStack.push(patch);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }

    this._lastKey = mergeKey;
    this._lastTime = now;
    this.redoStack.length = 0;
  }

  /** Pop the newest patch and return its inverse (ready to apply). */
  undo() {
    const patch = this.undoStack.pop();
    if (!patch) return null;
    this.redoStack.push(patch);
    this._lastKey = null;
    return invert(patch);
  }

  /** Pop the newest undone patch and return it (ready to re-apply). */
  redo() {
    const patch = this.redoStack.pop();
    if (!patch) return null;
    this.undoStack.push(patch);
    this._lastKey = null;
    return patch;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this._lastKey = null;
  }

  /** Recent entries, newest first — the version-history panel renders these. */
  recent(n = 40) {
    return this.undoStack
      .slice(-n)
      .reverse()
      .map((p) => ({ id: p.id, label: p.label, time: p.time, summary: describe(p) }));
  }

  /** Index of a patch in the undo stack, or -1. */
  indexOf(id) {
    return this.undoStack.findIndex((p) => p.id === id);
  }
}

/**
 * Fold `next` into `prev` so the pair reads as a single logical edit.
 * The "before" side always comes from the earlier patch and the "after" side
 * from the later one, which is exactly what a merged edit means.
 */
function mergePatches(prev, next) {
  const out = { ...prev, time: next.time, label: next.label, collections: {}, fields: { ...prev.fields }, order: { ...prev.order } };

  const keys = new Set([...Object.keys(prev.collections), ...Object.keys(next.collections)]);
  for (const key of keys) {
    const a = prev.collections[key] || { added: [], removed: [], changed: [] };
    const b = next.collections[key] || { added: [], removed: [], changed: [] };

    const changed = new Map();
    for (const c of a.changed) changed.set(c.before.id, { before: c.before, after: c.after });
    for (const c of b.changed) {
      const existing = changed.get(c.before.id);
      if (existing) existing.after = c.after;
      else changed.set(c.before.id, { before: c.before, after: c.after });
    }

    const addedIds = new Set(a.added.map((x) => x.id));
    const added = a.added.slice();
    for (const item of b.added) if (!addedIds.has(item.id)) added.push(item);
    // An entity added then edited within the window: keep the newest form.
    for (let i = 0; i < added.length; i++) {
      const c = changed.get(added[i].id);
      if (c) {
        added[i] = c.after;
        changed.delete(added[i].id);
      }
    }

    const removedIds = new Set(a.removed.map((x) => x.id));
    const removed = a.removed.slice();
    for (const item of b.removed) if (!removedIds.has(item.id)) removed.push(item);

    out.collections[key] = { added, removed, changed: Array.from(changed.values()) };
  }

  for (const [key, f] of Object.entries(next.fields || {})) {
    out.fields[key] = out.fields[key] ? { before: out.fields[key].before, after: f.after } : f;
  }
  for (const [key, o] of Object.entries(next.order || {})) {
    out.order[key] = out.order[key] ? { before: out.order[key].before, after: o.after } : o;
  }

  return out;
}
