/**
 * What the page provides that no module defines — for `npm run typecheck`
 * only; nothing here is loaded at runtime.
 */
interface Window {
  /** config.js — where the backends are, if any. */
  CX_CONFIG?: {
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    requireAuth?: boolean;
    rcSupabaseUrl?: string;
    rcSupabaseAnonKey?: string;
    /** Stamped by a build, for the problem reports. */
    version?: string;
  };
  /** vendor/supabase.js, once core/sdk.js has fetched it. */
  supabase?: any;
  /** The module table tools/build.js writes into every bundle. */
  __CX_MODULES?: { mods: Record<string, Function>; req: (id: string) => any };
  /** The desktop shell (tools/shell/loader.js), when running inside it. */
  CX_SHELL?: any;
  /** Tauri's bridge, inside the desktop build only (core/desktop.js). */
  __TAURI_INTERNALS__?: any;
  /** File System Access API — Chromium only, which is what file mode needs. */
  showDirectoryPicker?: (options?: any) => Promise<any>;
}

interface Navigator {
  /** iOS Safari's "added to the home screen". */
  standalone?: boolean;
}

/** The application attaches what went wrong to the error it throws. */
interface Error {
  code?: string;
  kind?: string;
  expected?: any;
  current?: any;
  preview?: boolean;
  status?: number;
}
