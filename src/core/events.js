/**
 * Application event bus.
 *
 * This is the mechanism that keeps the module graph acyclic: lower layers
 * (store, timeline engine) emit, higher layers (UI) subscribe. A module never
 * imports "upwards" to call a UI function — it publishes an event instead.
 *
 * Leaf module: imports nothing.
 */

const listeners = new Map(); // event name -> Set<handler>

/**
 * Subscribe to an event. Returns an unsubscribe function.
 * `'*'` receives every event as (name, payload).
 */
export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => off(event, handler);
}

/** Subscribe for exactly one delivery. */
export function once(event, handler) {
  const stop = on(event, (payload) => {
    stop();
    handler(payload);
  });
  return stop;
}

export function off(event, handler) {
  const set = listeners.get(event);
  if (set) {
    set.delete(handler);
    if (!set.size) listeners.delete(event);
  }
}

/**
 * Publish an event. Handlers are copied before iteration so a handler may
 * safely subscribe or unsubscribe during dispatch. A throwing handler is
 * logged and skipped — one bad listener never breaks the others.
 */
export function emit(event, payload) {
  const direct = listeners.get(event);
  if (direct) {
    for (const handler of Array.from(direct)) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[cx-timeline] listener for "${event}" threw:`, err);
      }
    }
  }
  const wildcard = listeners.get('*');
  if (wildcard) {
    for (const handler of Array.from(wildcard)) {
      try {
        handler(event, payload);
      } catch (err) {
        console.error('[cx-timeline] wildcard listener threw:', err);
      }
    }
  }
}

/** Remove every subscription — used by tests and teardown. */
export function clearAll() {
  listeners.clear();
}

/**
 * The canonical event names. Using these constants (rather than bare strings)
 * keeps typos out and gives one place to see the whole application protocol.
 */
export const EV = {
  /* Document lifecycle */
  DOC_LOADED: 'doc:loaded',
  DOC_CHANGED: 'doc:changed', // { reason, ids? } — any mutation to the project
  DOC_META_CHANGED: 'doc:meta', // name/description/settings only
  DOC_REPLACED: 'doc:replaced', // wholesale swap (import, restore, new)
  LISTS_CHANGED: 'lists:changed', // { listId } — a dropdown vocabulary was edited

  /* Persistence */
  SAVE_START: 'save:start',
  SAVE_DONE: 'save:done',
  SAVE_ERROR: 'save:error',
  BACKUP_MADE: 'backup:made',

  /* History */
  HISTORY_CHANGED: 'history:changed', // { canUndo, canRedo, depth }

  /* Selection & interaction */
  SELECTION_CHANGED: 'selection:changed', // { ids }
  OBJECT_ACTIVATED: 'object:activated', // { id } — double-click / Enter
  TOOL_CHANGED: 'tool:changed', // { tool }

  /* Viewport */
  VIEW_CHANGED: 'view:changed', // { scale, originMs, pxPerDay }
  SCALE_CHANGED: 'view:scale',

  /* Rendering */
  RENDER_REQUESTED: 'render:request',
  RENDER_DONE: 'render:done',

  /* UI */
  THEME_CHANGED: 'theme:changed',
  FILTER_CHANGED: 'filter:changed',
  PANEL_CHANGED: 'panel:changed',
  TOAST: 'ui:toast',
  STATUS: 'ui:status',
  PRESENT_MODE: 'ui:present',
};
