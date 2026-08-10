/**
 * The desktop shell's loader.
 *
 * Copied into `dist-desktop/loader.js` by `tools/desktop.js`, which substitutes
 * the placeholder on the CHANNEL line below for the deployment this build
 * follows. That token appears exactly once in this file on purpose — the
 * assembler checks, because a build where it went unsubstituted is a build that
 * silently never updates.
 *
 * Why this file exists
 * --------------------
 * The installer must not have to be re-run for every change to the application.
 * So the window loads *this* page — local, on the app's own origin — and this
 * decides which copy of the application to run:
 *
 *   the copy inside the installer      always present, works on a plane, and is
 *                                      what a first launch uses.
 *   a newer copy from the deployment   fetched in the background, kept in
 *                                      IndexedDB, and used from the next launch.
 *
 * Two rules keep that honest:
 *
 *   **Launch never waits on the network.** The newest copy already on this
 *   machine starts immediately; the update check happens after the application
 *   is up. A slow or blocked connection costs nothing, and there is no spinner
 *   anybody has to sit through.
 *
 *   **An update lands between launches, never mid-session.** Swapping code
 *   under a running application would leave the document in one version and the
 *   interface in another. The new copy is stored, the user is told it is ready,
 *   and it is used the next time the window opens.
 *
 * On trust: this executes code fetched from the deployment, which is the same
 * trust boundary as a browser visiting that deployment — a compromise of the
 * host is a compromise either way. The narrowing that is available is applied:
 * one pinned HTTPS host, allowed by the Content-Security-Policy in
 * `tauri.conf.json` and nothing else, and a payload that is rejected unless it
 * is shaped like a release. It reads no folder and holds no plan; every file
 * the user's data passes through is the Rust side.
 */

(function () {
  'use strict';

  /** The deployment this build follows. Substituted at assembly time. */
  var CHANNEL = '__CHANNEL__';

  var DB_NAME = 'cx-timeline-shell';
  var DB_STORE = 'payload';
  var DB_KEY = 'current';

  /**
   * A downloaded copy is on trial until it has booted once.
   *
   * This holds the `builtAt` of a copy that was started but never reported
   * itself up. Finding it still here on the next launch means that copy could
   * not boot, so it is thrown away and the installed one runs instead. Without
   * this, one bad deploy would leave both laptops unable to open the
   * application at all — and no way to fix it from the deployment, because the
   * broken copy is what would have to fetch the fix.
   */
  var TRIAL_KEY = 'cx-shell-trial';
  /** Set for the duration of one self-repairing reload, so it can only happen once. */
  var RECOVERY_KEY = 'cx-shell-recovering';

  /** A payload has to look like a release before it is trusted or stored. */
  var MIN_BUNDLE = 50000;
  var MIN_CSS = 2000;

  /**
   * What the shell is doing, readable from the application and from the tests.
   * `source` is 'shipped' when running the copy inside the installer and
   * 'downloaded' when running one that came from the deployment.
   */
  var shell = {
    channel: CHANNEL,
    source: 'shipped',
    version: '',
    builtAt: '',
    update: null,
    checkNow: null,
    /** Replaced when a downloaded copy is on trial; a no-op otherwise. */
    confirmHealthy: function () {},
  };
  window.CX_SHELL = shell;

  function readFlag(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  }

  /** Scoped to this window rather than the machine: one reload, not a loop. */
  function recovering(set) {
    try {
      if (set) sessionStorage.setItem(RECOVERY_KEY, '1');
      return !!sessionStorage.getItem(RECOVERY_KEY);
    } catch {
      return false;
    }
  }

  function writeFlag(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch { /* private mode; the trial simply does not carry over */ }
  }

  /* ── The store for a downloaded copy ─────────────────────────────────── */

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function dbGet() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error); };
      });
    }).catch(function () { return null; });
  }

  function dbPut(payload) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(payload, DB_KEY);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () { return false; });
  }

  /* ── Starting the application ────────────────────────────────────────── */

  /**
   * Run the copy inside the installer: the stylesheets and the bundle that are
   * already in this folder, loaded as ordinary files.
   */
  function startShipped() {
    shell.source = 'shipped';
    writeFlag(TRIAL_KEY, '');
    return addScript('app.bundle.js');
  }

  /**
   * Run a copy that came from the deployment.
   *
   * The shipped stylesheets are removed rather than left underneath, so what is
   * on the page is one version's CSS and not two overlaid. The bundle is handed
   * to a blob URL instead of an inline `<script>`, which is why the policy can
   * stay at `script-src 'self' blob:` and never needs `'unsafe-inline'`.
   */
  function startDownloaded(payload) {
    shell.source = 'downloaded';
    writeFlag(TRIAL_KEY, payload.builtAt);
    watchForFailure();

    var shipped = document.querySelectorAll('link[data-shell="shipped"]');
    for (var i = 0; i < shipped.length; i++) shipped[i].remove();

    var style = document.createElement('style');
    style.setAttribute('data-shell', 'downloaded');
    style.textContent = payload.css;
    document.head.appendChild(style);

    var url = URL.createObjectURL(new Blob([payload.bundle], { type: 'text/javascript' }));
    return addScript(url);
  }

  /**
   * Roll back a downloaded copy that cannot start.
   *
   * An uncaught error *during boot* means this copy will not come up, so the
   * payload is thrown away and the window reloads onto the installed one — one
   * launch, self-repaired, no reinstall. The listener is removed the moment the
   * application reports itself healthy, so an ordinary error hours into a
   * session can never trigger this.
   *
   * `onerror` is the whole reason: a blob script that throws still fires `load`,
   * so there is nothing for the script tag's own error handler to catch.
   */
  function watchForFailure() {
    var onError = function (event) {
      window.removeEventListener('error', onError);
      if (recovering(false)) return; // already tried once this launch; do not loop
      recovering(true);
      console.error('[cx-shell] the downloaded version failed to start; falling back to the installed one:',
        event && event.message ? event.message : event);
      dbPut(null).then(function () {
        writeFlag(TRIAL_KEY, '');
        location.reload();
      });
    };
    window.addEventListener('error', onError);

    shell.confirmHealthy = function () {
      window.removeEventListener('error', onError);
      writeFlag(TRIAL_KEY, '');
    };
  }

  function addScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = function () { resolve(true); };
      script.onerror = function () { reject(new Error('could not run ' + src)); };
      document.body.appendChild(script);
    });
  }

  /* ── The update check ────────────────────────────────────────────────── */

  function looksLikeRelease(payload) {
    return !!payload &&
      typeof payload.version === 'string' && payload.version.length > 0 &&
      typeof payload.builtAt === 'string' && payload.builtAt.length > 0 &&
      typeof payload.bundle === 'string' && payload.bundle.length > MIN_BUNDLE &&
      typeof payload.css === 'string' && payload.css.length > MIN_CSS;
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(url + ' answered ' + res.status);
      return res.json();
    });
  }

  /**
   * Look for a newer copy and keep it for next launch.
   *
   * `version.json` is a few hundred bytes, so the usual answer — already
   * current — costs almost nothing. Only a genuinely newer build pulls the
   * payload down.
   */
  function checkForUpdate() {
    if (!CHANNEL) return Promise.resolve(null);
    return fetchJson(CHANNEL + '/desktop/version.json')
      .then(function (remote) {
        if (!remote || !remote.builtAt || remote.builtAt <= shell.builtAt) return null;
        return fetchJson(CHANNEL + '/desktop/payload.json');
      })
      .then(function (payload) {
        if (!payload) return null;
        // A truncated or unrelated answer — a captive portal's login page, say —
        // must never be stored: it would break the *next* launch, when there is
        // no network to tell us it was wrong.
        if (!looksLikeRelease(payload) || payload.builtAt <= shell.builtAt) return null;
        return dbPut(payload).then(function () {
          shell.update = { version: payload.version, builtAt: payload.builtAt };
          window.dispatchEvent(new CustomEvent('cx-shell-update', { detail: shell.update }));
          return shell.update;
        });
      })
      .catch(function (err) {
        // Offline, blocked by a proxy, or the deployment is down. The
        // application is already running; there is nothing to report.
        console.info('[cx-shell] no update available:', err.message);
        return null;
      });
  }

  shell.checkNow = checkForUpdate;

  /* ── Boot ────────────────────────────────────────────────────────────── */

  Promise.all([fetchJson('shipped.json').catch(function () { return null; }), dbGet()])
    .then(function (results) {
      var shipped = results[0] || { version: '0.0.0', builtAt: '' };
      var cached = results[1];

      // A copy that was started last launch and never reported itself up cannot
      // boot. Throw it away rather than trying it again forever.
      if (cached && readFlag(TRIAL_KEY) === cached.builtAt) {
        console.warn('[cx-shell] discarding version ' + cached.version + ': it did not start last time.');
        cached = null;
        writeFlag(TRIAL_KEY, '');
        dbPut(null);
      }

      var useCached = cached && looksLikeRelease(cached) && cached.builtAt > shipped.builtAt;
      var active = useCached ? cached : shipped;

      shell.version = active.version;
      shell.builtAt = active.builtAt || '';

      return (useCached ? startDownloaded(cached) : startShipped()).catch(function (err) {
        // A downloaded copy that will not run is worse than an old one. Fall
        // back to the installer's copy and forget the bad payload, so the next
        // launch is not broken too.
        if (!useCached) throw err;
        console.error('[cx-shell] the downloaded version failed to start; using the installed one:', err.message);
        return dbPut(null).then(function () {
          shell.version = shipped.version;
          shell.builtAt = shipped.builtAt || '';
          return startShipped();
        });
      });
    })
    .then(function () {
      // After the application is up, never before it.
      setTimeout(checkForUpdate, 2500);
    })
    .catch(function (err) {
      console.error('[cx-shell] could not start:', err);
      var boot = document.getElementById('boot');
      if (boot) {
        boot.innerHTML =
          '<div style="padding:32px;font-family:system-ui,sans-serif;color:#e9edf5">' +
          '<h1 style="font-size:18px">CX Timeline could not start</h1>' +
          '<p style="opacity:.75;font-size:13px">' + String(err && err.message ? err.message : err) + '</p>' +
          '</div>';
      }
    });
})();
