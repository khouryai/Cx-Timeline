/**
 * What the page provides that no module defines — for `npm run typecheck`
 * only; nothing here is loaded at runtime.
 */
interface Window {
  /** Set by a test before the calendar opens: count what its database is asked (core/rc.js). */
  __rcRecord?: boolean;
  /** The module table tools/build.js writes into every bundle. */
  __CX_MODULES?: { mods: Record<string, Function>; req: (id: string) => any };
  /** The desktop shell (tools/shell/loader.js), when running inside it. */
  CX_SHELL?: any;
  /** Tauri's bridge, inside the desktop build only (core/desktop.js). */
  __TAURI_INTERNALS__?: any;
  /** File System Access API — Chromium only, which is what file mode needs. */
  showDirectoryPicker?: (options?: any) => Promise<any>;
}

/** The application attaches what went wrong to the error it throws. */
interface Error {
  code?: string;
  kind?: string;
  expected?: any;
  current?: any;
  status?: number;
  /** core/rc_db.js: a write refused because somebody else holds the calendar's pen. */
  readOnly?: boolean;
  /** core/rc_db.js: a file another computer saved, refused rather than written over. */
  conflict?: boolean;
  theirs?: any;
}
