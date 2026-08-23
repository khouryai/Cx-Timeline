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
  P6_IMPORTED: 'p6:imported', // { kind, plan } — a Primavera export was applied

  /* Persistence */
  SAVE_START: 'save:start',
  SAVE_DONE: 'save:done',
  SAVE_ERROR: 'save:error',
  BACKUP_MADE: 'backup:made',

  /* The shared folder (file mode only) */
  FILE_STATE: 'file:state', // { connected, folder, plan, role, holder } — connection or pen changed
  FILE_EXTERNAL_CHANGE: 'file:external', // a colleague's save landed in the folder
  FILE_CONFLICT: 'file:conflict', // a write was refused because the file moved underneath us
  FILE_IDLE: 'file:idle', // the holder has been idle too long; flush a save and hand the pen back

  /* History */
  HISTORY_CHANGED: 'history:changed', // { canUndo, canRedo, depth }

  /* Account & sharing (hosted deployments only) */
  AUTH_CHANGED: 'auth:changed', // { user } — signed in, signed out, session restored
  ACCESS_CHANGED: 'access:changed', // { role, readOnly } — which project, and what you may do
  EDIT_REFUSED: 'access:refused', // a write was attempted without permission
  CLOUD_CONFLICT: 'cloud:conflict', // someone else saved the project first

  /* The resource calendar — a separate module, with a separate backend and a
     separate account. Deliberately not AUTH_CHANGED: signing in to the
     calendar must not disturb the timeline, which needs no account at all. */
  RC_AUTH_CHANGED: 'rc:auth', // { user, event }
  RC_CHANGED: 'rc:changed', // { what } — a row was written; panes reload
  RC_QUEUE_CHANGED: 'rc:queue', // { pending } — unsynced huddle entries

  /* Which whole interface is on screen: the timeline, or the calendar. */
  WORKSPACE_CHANGED: 'workspace:changed', // { workspace }

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
  // A pane asking the dock to rebuild it. Panes cannot import the dock —
  // that would be a cycle — and view-only state (a filter, a search) changes
  // nothing in the document, so no doc:changed fires to do it for them.
  PANE_REFRESH: 'panel:refresh',
  TOAST: 'ui:toast',
  STATUS: 'ui:status',
  PRESENT_MODE: 'ui:present',
};
