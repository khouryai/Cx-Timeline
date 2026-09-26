/**
 * Application entry point.
 *
 * Boot order matters and is deliberate:
 *   0. the backend, if this build has one, restores its session and — when
 *      nobody is signed in — puts the gate up before anything else renders,
 *   1. storage opens and hands back the document to load,
 *   2. the store adopts it (nothing renders against an empty document),
 *   3. the theme is applied before the first paint, so there is no flash,
 *   4. the shell and canvas mount,
 *   5. interaction, shortcuts and menus attach last, once their targets exist.
 *
 * Step 0 does nothing at all when `config.js` is blank, which is what keeps
 * the local-first, double-click-index.html build exactly as it was.
 *
 * Imports: everything — this is the only module allowed to.
 */

import { debounce } from './core/util.js';
import { on, emit, EV } from './core/events.js';
import { projectExtent, effectiveToday } from './core/model.js';
import * as store from './core/store.js';
import { init as initStorage, takeRecovery, getPref, setPref, saveNow, isHosted } from './core/storage.js';
import * as cloud from './core/cloud.js';
import * as filestore from './core/filestore.js';
import * as desktop from './core/desktop.js';
import { criticalPath, linkViolations } from './core/analysis.js';
import * as viewport from './timeline/viewport.js';
import * as renderer from './timeline/renderer.js';
import { attach as attachInteractions } from './timeline/interactions.js';
import { initTheme } from './ui/theme.js';
import { buildShell } from './ui/shell.js';
import { buildPanels, installResizer } from './ui/panels.js';
import { buildInspector } from './ui/inspector.js';
import { buildMinimap } from './ui/minimap.js';
import { buildLegend } from './ui/legend.js';
import { installMenus } from './ui/menus.js';
import { requireSignIn, installAccessMode } from './ui/auth.js';
import { installP6Drops } from './ui/p6.js';
import { installLookaheadDrops } from './ui/lookahead.js';
import { installShortcuts } from './ui/shortcuts.js';
import { installCommandMenu } from './ui/command_menu.js';
import { installCanvasHint } from './ui/canvas_hint.js';
import * as workspace from './ui/workspace.js';
import { loadCalendar } from './ui/calendar_loader.js';
import * as rcClient from './core/rc.js';
import { lockPlan, setAccount } from './core/access.js';
import * as exporters from './io/exporters.js';
import * as cmd from './ui/commands.js';
import { toast, showTooltip, hideTooltip, confirmDialog } from './ui/components.js';
import { renderNote, notePreview } from './ui/notes.js';
import { TYPES, statusOf, durationDays } from './core/model.js';
import { fmtDate, fmtDuration, setDateOrder, getDateOrder } from './core/dates.js';
import { el } from './core/util.js';

const APP_VERSION = '1.0.0';

async function boot() {
  const started = performance.now();

  // Desktop only, and started first because it has to finish first: the shell
  // reads the lock file before the window exists, so "your colleague has this
  // open" can be the first thing on screen instead of a correction to it. In a
  // browser this resolves to null immediately and nothing below it happens.
  const startupPen = filestore.startupPen();

  /* ── 0. Account ──────────────────────────────────────────────────────── */
  if (cloud.isConfigured()) {
    try {
      await cloud.init();
      if (!cloud.isSignedIn()) {
        // The splash covers the whole viewport and would sit on top of the
        // sign-in card, swallowing its clicks. Loading is over: say so.
        dismissSplash();
        await requireSignIn();
      }
    } catch (err) {
      console.error('[cx-timeline] sign-in failed:', err);
    }
  }

  /* ── 1. Storage & document ───────────────────────────────────────────── */
  let loaded;
  try {
    loaded = await initStorage();
  } catch (err) {
    console.error('[cx-timeline] storage failed to initialise:', err);
    loaded = null;
  }

  if (loaded) {
    store.replaceDoc(loaded.doc, 'load');
    // Offer to recover work the unload handler saved after an unclean exit.
    // A read-only project has nothing to recover — the user cannot have
    // changed it — so the prompt would be nonsense.
    const recovery = cloud.isReadOnly() ? null : takeRecovery(loaded.doc);
    if (recovery) {
      setTimeout(() => offerRecovery(recovery), 900);
    }
    if (loaded.fresh) {
      setTimeout(() => {
        toast({
          tone: 'info',
          title: 'Welcome to CX Timeline',
          message: 'This is a sample commissioning plan — edit it, or start fresh from Import / Export.',
          timeout: 7000,
        });
      }, 1200);
    }
  }

  /* ── 2. Theme and date format, before first paint ────────────────────── */
  initTheme();
  installDateFormat();

  /* ── 3. Chrome ───────────────────────────────────────────────────────── */
  buildShell();
  buildPanels();
  buildInspector();

  /* ── 4. Canvas ───────────────────────────────────────────────────────── */
  const frame = document.getElementById('canvas-frame');
  renderer.mount(frame);
  buildMinimap(frame);
  buildLegend(frame);
  installCanvasHint(frame);

  const inspector = document.getElementById('inspector');
  const inspectorResizer = el('div', { class: 'resizer left' });
  inspector.appendChild(inspectorResizer);
  installResizer(inspectorResizer, inspector, 240, 520);

  restoreView();

  /* ── 5. Interaction ──────────────────────────────────────────────────── */
  attachInteractions();
  installMenus();
  installShortcuts();
  installCommandMenu();
  installHoverPreview();
  installAccessMode();
  installP6Drops();
  installLookaheadDrops();
  installConflictHandling();
  installFolderHandling();
  installDesktopShell();
  installViewPersistence();
  installResizeHandling();
  installCriticalPathRecompute();
  installHiddenLinkGuard();
  installClipboardBridge();

  renderer.renderNow();

  /* ── Done ────────────────────────────────────────────────────────────── */
  dismissSplash();

  // Tell the desktop shell this version came up. A copy downloaded from the
  // deployment is on trial until this line runs: if it never does, the next
  // launch throws it away and runs the installed one instead, so a bad deploy
  // cannot leave anybody unable to open the application. Absent in a browser.
  window.CX_SHELL?.confirmHealthy?.();

  // The resource calendar is registered here and built on first use — after
  // the line above, deliberately. It needs a network and an account, and the
  // trial gate must not be waiting on either: a calendar that could not reach
  // its backend would otherwise look exactly like a broken update and get
  // rolled back.
  // Its code is a second bundle, fetched the first time it is opened — see
  // ui/calendar_loader.js — so nobody who only uses the timeline downloads it.
  workspace.registerCalendar(() => loadCalendar().then((calendar) => calendar.build()));

  // Resolve the calendar account, if there is a backend for one. This is the
  // only thing here that touches a network, and it deliberately sits after the
  // gate above so an unreachable backend can never look like a broken update.
  //
  // It is not awaited: the timeline is already usable, and whether somebody is
  // a read-only viewer only changes what chrome to draw. When it settles it
  // emits, the shell rebuilds, and a viewer lands on the calendar — which is
  // the one case that cannot wait for a switch, because a viewer has no switch.
  if (rcClient.isConfigured()) {
    rcClient.init().catch((err) => {
      console.warn('[cx-timeline] the resource calendar could not be reached:', err.message);
    });
    installPenIdentity();
  }
  // Whether this account may edit the plan at all. Outside the filestore branch
  // above: it is about the account, not about the folder, and it decides the
  // store's gate whichever backend the plan is on.
  installPlanAccess();

  console.info(`CX Timeline ${APP_VERSION} ready in ${Math.round(performance.now() - started)}ms`);

  // The pen, said out loud. After the splash, so the dialog is not underneath
  // it, and last, so booting is never held up by a question.
  const pen = await startupPen;
  if (pen) await cmd.announceStartupPen(pen);
}

/** Fade out the boot splash. Safe to call more than once. */
function dismissSplash() {
  const splash = document.getElementById('boot');
  if (!splash || splash.classList.contains('done')) return;
  splash.classList.add('done');
  setTimeout(() => splash.remove(), 420);
}

/* ── Save conflicts ────────────────────────────────────────────────────── */

/**
 * Two people editing one plan.
 *
 * The server refuses the second save rather than letting it overwrite, so the
 * only sensible thing left is to ask. Nothing is discarded silently: the local
 * copy is already cached, and reloading is a deliberate choice.
 */
function installConflictHandling() {
  let asking = false;
  /** The standing "your save was refused" notice, so there is only ever one. */
  let refusedNotice = null;

  on(EV.SAVE_ERROR, async (payload) => {
    if (!payload?.conflict || asking) return;

    /* In a folder this is not a one-off: autosave runs on a timer, so every few
       seconds it tries again, is refused again, and would raise the dialog
       again. One standing notice instead — the work is cached either way, and a
       colleague's newer version is not an emergency. */
    if (filestore.isConnected()) {
      if (refusedNotice) return;
      refusedNotice = toast({
        tone: 'warn',
        title: 'Your save was refused',
        message:
          'A colleague saved a newer version, so writing yours would have overwritten theirs. '
          + 'Nothing is lost — this copy is cached here, and can be exported from Import / export '
          + 'before you take theirs.',
        sticky: true,
        action: {
          label: 'Reload theirs',
          onClick: () => { cmd.reloadFromFolder({ confirm: false }); },
        },
      });
      return;
    }

    asking = true;
    const ok = await confirmDialog({
      title: 'Someone else saved this project',
      message:
        'Your changes were not saved, because they would have overwritten work saved by another person since you opened it. ' +
        'Reload to see their version — a copy of your version is kept in this browser and can be exported from Import / Export first.',
      confirmLabel: 'Reload their version',
      cancelLabel: 'Not yet',
    });
    asking = false;
    if (!ok) return;
    if (filestore.isConnected()) await cmd.reloadFromFolder({ confirm: false });
    else window.location.reload();
  });

  // A save that lands is the end of it: the plan on disk is ours again.
  on(EV.SAVE_DONE, () => {
    if (refusedNotice) refusedNotice.dismiss();
    refusedNotice = null;
  });
}

/**
 * Let the pen borrow the name the calendar already knows.
 *
 * The lock has always carried a *self-declared* name, typed into a field in
 * the Shared folder pane, and `getDisplayName()` falls back to "Someone" when
 * nobody has. So the most common reading of the read-only banner was "Someone
 * has this plan open" — the least useful answer available, on the one screen
 * where knowing who matters.
 *
 * In a calendar deployment that person is already signed in, with a real name
 * on their roster row. Borrowing it costs nothing and moves no data: the name
 * goes into a lock file in the same folder the plan is in, and the plan still
 * has no backend of any kind.
 *
 * Only when nothing has been set. A name somebody typed is a deliberate
 * choice — "Alex" rather than "Alexander Khoury" — and overwriting it every
 * time the session refreshes would be the application arguing with them.
 */
function installPenIdentity() {
  const adopt = () => {
    if (!filestore.isSupported()) return;
    const known = filestore.getDisplayName();
    if (known && known !== 'Someone') return;
    const name = rcClient.me()?.name;
    if (name) filestore.setDisplayName(name);
  };
  on(EV.RC_AUTH_CHANGED, adopt);
  adopt();
}

/**
 * A calendar member reads the plan and never writes it.
 *
 * The plan is the P6 narrative: it carries the contract schedule, the baselines
 * and the dependencies, and it is maintained by whoever runs the project. The
 * calendar's members are the field team — they record their own days and read
 * what they have been asked to do. They were read-only in practice, because the
 * plan lives in a folder and somebody else usually held the pen, and that is not
 * the same thing at all: the pen is a *turn*, so "Take over editing" was on
 * screen and a member who pressed it got the plan.
 *
 * So it is stated rather than left to the folder. The role comes from the
 * calendar, which `core/store.js` and `core/filestore.js` must never import, so
 * it is pushed down into `core/access.js` from here — the one module that may
 * see both. After that the store refuses every edit and the pen refuses to be
 * taken, and the interface stops offering either, in that order of importance.
 *
 * **Only when the calendar has an opinion.** No backend, local mode, and every
 * test suite leave the lock alone, and a signed-out session is not a member of
 * anything: the timeline is exactly as editable as it has always been until an
 * account that is a member of a configured calendar signs in.
 */
function installPlanAccess() {
  const apply = () => {
    /* Whose view this is. The calendar's account where there is one, the
       timeline's own where there is not, and '' for a local build with neither —
       which is one shared view per browser profile, exactly as it has always
       been. It is a key and never a name: it goes into a localStorage key. */
    setAccount(rcClient.currentUser()?.id || cloud.currentUser()?.id || '');
    store.restoreAccountView();

    const member = rcClient.isConfigured() && rcClient.isSignedIn()
      && Boolean(rcClient.me()) && !rcClient.isAdmin();
    lockPlan(member
      ? 'Your calendar account is not an administrator, so the plan opens read-only. '
        + 'Everything you filter, hide or compare here is yours alone and stays with your '
        + 'account.'
      : '');
    emit(EV.ACCESS_CHANGED, { readOnly: store.isDocReadOnly() });
    emit(EV.FILE_STATE, filestore.state());
  };
  on(EV.RC_AUTH_CHANGED, apply);
  on(EV.AUTH_CHANGED, apply);
  // A different plan is a different view. Restored on replacement rather than
  // carried over: the last filter applied to somebody else's bars is not a
  // filter anybody asked for.
  on(EV.DOC_REPLACED, () => store.restoreAccountView());
  apply();
}

/* ── The shared folder ─────────────────────────────────────────────────── */

/**
 * Keeping two people in step through a synced folder.
 *
 * Three things need saying out loud, and none of them are errors:
 *
 *   a colleague saved     the file on disk moved on. Offer to catch up, rather
 *                         than reloading under someone mid-sentence.
 *   the write was refused the guard in `filestore.savePlan()` stopped an
 *                         overwrite. The work is still here and still cached.
 *   the grant lapsed      the browser wants the folder re-authorised, which
 *                         needs a click and cannot be done silently.
 *
 * The lock is also released on the way out. That cannot be awaited at unload,
 * which is exactly why the lock has a staleness timeout as its real release.
 */
function installFolderHandling() {
  let asking = false;
  /** The standing "there is a newer version" notice, so there is only ever one. */
  let behindNotice = null;
  /** The standing "somebody wants the pen" notice, likewise. */
  let handoverNotice = null;
  /** Said once per spell of holding work that cannot be saved. */
  let strandedNotice = null;

  on(EV.FILE_EXTERNAL_CHANGE, async () => {
    if (asking) return;
    asking = true;
    // A reader who has changed nothing gains nothing from a dialog: just pull
    // their colleague's version in and say so.
    if (filestore.isViewer() && !store.isDirty()) {
      await cmd.reloadFromFolder({ confirm: false });
      asking = false;
      return;
    }
    asking = false;

    /* Told, not asked. A modal takes the keyboard away mid-sentence to report
       something that is not urgent and not an error — and this fires while
       somebody is working, which is the worst possible moment to be handed a
       dialog. `filestore` says this once per version; the notice stays until
       it is used or dismissed, and the status bar goes on showing it either
       way, so nothing is lost by ignoring it for ten minutes. */
    if (behindNotice) behindNotice.dismiss();
    behindNotice = toast({
      tone: 'info',
      title: 'A newer version is in the folder',
      message: store.isDirty()
        ? 'A colleague saved. Reloading replaces anything you have changed since your last save.'
        : 'A colleague saved. Reload when you are ready.',
      sticky: true,
      action: {
        label: 'Reload',
        onClick: () => { cmd.reloadFromFolder({ confirm: false }); },
      },
    });
  });

  // The notice is about one version. Once it has been taken — or the folder
  // settles back to agreeing with us — there is nothing left for it to say.
  on(EV.FILE_STATE, (st) => {
    if (!st || st.role !== 'editor') {
      // The pen is elsewhere; a prompt to hand it over is spent.
      if (handoverNotice) handoverNotice.dismiss();
      handoverNotice = null;
    }
    if (st && st.role === 'editor' && strandedNotice) {
      // It is ours again, so the work that could not be saved now can be.
      strandedNotice.dismiss();
      strandedNotice = null;
    }
    if (st && st.behind) return;
    if (behindNotice) behindNotice.dismiss();
    behindNotice = null;
  });

  /* Work that has nowhere to go.
     A save skipped because a colleague holds the pen keeps the document dirty
     and caches it — but nothing pointed at it, so the only copy of those edits
     sat in IndexedDB with no way to reach it. Said once per spell, with the
     way out attached. */
  on(EV.SAVE_DONE, (p) => {
    if (!p?.skipped || !p.unsaved || strandedNotice) return;
    strandedNotice = toast({
      tone: 'warn',
      title: 'These changes are not saved',
      message: 'A colleague has the pen, so this plan cannot be written. Nothing is lost — '
        + 'the work is here, and it saves itself when the pen comes back.',
      sticky: true,
      action: {
        label: 'Export a copy',
        onClick: () => { exporters.exportJson(); },
      },
    });
  });

  /* Somebody is asking for it.
     A toast rather than a dialog, deliberately: they are asking, not
     demanding, and a modal in front of somebody mid-sentence turns a courtesy
     into an interruption. Handing over flushes first, so what is on screen is
     in the file before the pen moves. */
  on(EV.FILE_PEN_REQUESTED, ({ by }) => {
    if (handoverNotice) handoverNotice.dismiss();
    handoverNotice = toast({
      tone: 'info',
      title: `${by} is asking for the pen`,
      message: 'They are read-only until you hand it over or close the plan. '
        + 'Handing over saves what you have first.',
      sticky: true,
      action: {
        label: 'Hand it over',
        onClick: async () => {
          await saveNow().catch(() => {});
          const handed = await filestore.yieldPen();
          toast(handed
            ? { tone: 'good', title: 'Handed over', message: `${by} can edit now. This plan is read-only here.` }
            : { tone: 'warn', title: 'Nothing to hand over', message: 'You are not holding the pen.' });
        },
      },
    });
  });

  // Idle too long to keep holding the pen. Flush what is here, hand it back,
  // and say so — a colleague can then pick it up without asking.
  on(EV.FILE_IDLE, async () => {
    await saveNow().catch(() => {});
    const handed = await filestore.yieldPen();
    if (!handed) return;
    toast({
      tone: 'info',
      title: 'Editing handed back',
      message:
        'This plan has been idle for an hour, so it is saved and back to read-only. ' +
        'Take over editing in Import / export when you want it again.',
      timeout: 12000,
    });
  });

  on(EV.SAVE_ERROR, (payload) => {
    if (!payload?.permission) return;
    toast({
      tone: 'warn',
      title: 'The folder needs re-authorising',
      message: 'Open Import / export and reconnect the folder to carry on saving.',
      sticky: true,
    });
  });

  window.addEventListener('beforeunload', () => {
    if (filestore.isConnected()) filestore.handleUnload();
  });
}

/* ── The desktop shell ─────────────────────────────────────────────────── */

/**
 * The two things the desktop build has that a browser tab does not.
 *
 *   the title bar   which plan is open and who has the pen, legible from the
 *                   taskbar without bringing the window forward. On a machine
 *                   where two people take turns in one file, that is the state
 *                   you want to be able to glance at.
 *   an update       `tools/shell/loader.js` fetches a newer application in the
 *                   background and keeps it for next launch. Swapping code under
 *                   a running window would leave the document in one version and
 *                   the interface in another, so it is announced, not applied.
 *
 * Both are inert in a browser: the event never fires and `setWindowTitle()`
 * resolves to nothing.
 */
function installDesktopShell() {
  window.addEventListener('cx-shell-update', (event) => {
    const version = event.detail?.version || '';
    toast({
      tone: 'info',
      title: version ? `Version ${version} is ready` : 'An update is ready',
      message: 'It is already downloaded. Close CX Timeline and open it again to start using it.',
      sticky: true,
    });
  });

  if (!filestore.state().desktop) return;

  const syncTitle = () => {
    const file = filestore.state();
    const doc = store.getDoc();
    const name = file.plan || doc?.name || 'Untitled';
    const pen = !file.connected ? '' : file.role === 'viewer' ? ` — read-only, ${file.holder || 'someone else'} has it` : '';
    desktop.setWindowTitle(`${name}${pen} — CX Timeline`);
  };

  on(EV.FILE_STATE, syncTitle);
  on(EV.DOC_CHANGED, debounce(syncTitle, 500));
  syncTitle();
}

/* ── Recovery ──────────────────────────────────────────────────────────── */

async function offerRecovery(recovery) {
  const ok = await confirmDialog({
    title: 'Unsaved work recovered',
    message: `A copy of "${recovery.name}" was saved when the application last closed, and it is newer than what was on disk. Restore it?`,
    confirmLabel: 'Restore it',
    cancelLabel: 'Discard',
  });
  if (ok) {
    store.replaceDoc(recovery, 'recovery');
    renderer.requestRender();
    toast({ tone: 'good', title: 'Recovered' });
  }
}

/* ── Date format ───────────────────────────────────────────────────────── */

/**
 * Push the project's date-display order into `core/dates.js`.
 *
 * That module is a leaf and cannot read the store, so the preference is
 * pushed to it — on load, and again whenever the document changes, since an
 * import or a settings change can bring a different one.
 */
function installDateFormat() {
  const apply = () => {
    const order = store.getSettings().dateOrder || 'mdy';
    if (order === getDateOrder()) return false;
    setDateOrder(order);
    return true;
  };

  apply();

  on(EV.DOC_CHANGED, (payload) => {
    if (payload?.transient) return;
    // A changed order invalidates every rendered date, including measured
    // ruler labels, so force a full repaint rather than a positional update.
    if (apply()) renderer.invalidateAll();
  });
  on(EV.DOC_REPLACED, () => {
    if (apply()) renderer.invalidateAll();
  });
}

/* ── Viewport persistence ──────────────────────────────────────────────── */

/**
 * Restore the last view. If there is nothing sensible saved — a first run, or
 * a project imported elsewhere — frame the plan around today rather than
 * dropping the user at an arbitrary point in 1970.
 */
function restoreView() {
  renderer.measure();
  const settings = store.getSettings();

  if (Number.isFinite(settings.originMs) && Number.isFinite(settings.zoomPxPerDay)) {
    viewport.restore({ originMs: settings.originMs, pxPerDay: settings.zoomPxPerDay });
    return;
  }

  const doc = store.getDoc();
  if (doc.objects.length) {
    const extent = projectExtent(doc);
    viewport.fitRange(extent.start, extent.end, 30);
  } else {
    const today = effectiveToday(doc);
    viewport.setPxPerDay(3.4);
    viewport.centerOn(today, 0.3);
  }
}

function installViewPersistence() {
  const persist = debounce(() => {
    store.setViewState({ originMs: viewport.getOrigin(), zoomPxPerDay: viewport.getPxPerDay() });
  }, 700);

  on(EV.VIEW_CHANGED, () => {
    renderer.requestRender();
    persist();
  });
}

/* ── Window resize ─────────────────────────────────────────────────────── */

function installResizeHandling() {
  const onResize = debounce(() => {
    renderer.measure();
    renderer.requestRender();
  }, 80);

  window.addEventListener('resize', onResize);

  // Panels and the sidebar change the canvas size without a window resize.
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(onResize);
    observer.observe(document.getElementById('canvas-frame'));
  }
}

/* ── Critical path ─────────────────────────────────────────────────────── */

/**
 * The critical path is derived state: recompute it whenever the plan changes,
 * but only while the highlight is switched on — the analysis is O(V+E) and
 * there is no sense paying for it on every keystroke when nothing shows it.
 */
function installCriticalPathRecompute() {
  const recompute = debounce(() => {
    const doc = store.getDoc();
    if (!doc.settings.criticalPath) {
      renderer.setCriticalIds(new Set());
      return;
    }
    renderer.setCriticalIds(criticalPath(doc).critical);
    renderer.requestRender();
  }, 120);

  on(EV.DOC_CHANGED, (payload) => {
    if (payload?.transient) return;
    recompute();
  });
  on(EV.DOC_REPLACED, recompute);
  recompute();
}

/**
 * A hidden dependency line is a choice, not a fact about the schedule, and it
 * must not survive the thing it was hiding turning into a problem. Whenever a
 * plan settles into a state where a hidden link is violated, this reveals it
 * — through `store.revealBrokenLinks()`, a real edit rather than a quiet one,
 * so undo brings the hidden line back exactly like any other change, and the
 * only way to hide it again afterwards is doing so on purpose.
 *
 * Runs on every settled document (`DOC_CHANGED` with no `transient` flag, plus
 * `DOC_REPLACED` for load/import/restore/reload-from-folder) rather than on a
 * render, because the correction has to be saved — a colleague opening the
 * same plan must see the same dependency, not have it hidden again by their
 * own idle reconcile. `revealBrokenLinks()` emits its own `DOC_CHANGED`; the
 * second pass here finds nothing left to reveal and stops.
 */
function installHiddenLinkGuard() {
  const reconcile = () => {
    const doc = store.getDoc();
    const violations = linkViolations(doc);
    const broken = doc.links.filter((l) => l.hidden && violations.byLink.get(l.id)?.violated).map((l) => l.id);
    if (broken.length) store.revealBrokenLinks(broken);
  };

  on(EV.DOC_CHANGED, (payload) => {
    if (payload?.transient) return;
    reconcile();
  });
  on(EV.DOC_REPLACED, reconcile);
  reconcile();
}

/* ── Hover preview ─────────────────────────────────────────────────────── */

/**
 * Hovering an object shows a summary card, including a preview of its notes.
 * This is the "notes on hover" half of the brief; clicking opens the editor.
 */
function installHoverPreview() {
  let lastId = null;

  on('canvas:hover', ({ id, clientX, clientY }) => {
    lastId = id;
    if (!id) {
      hideTooltip();
      return;
    }
    const obj = store.getObject(id);
    if (!obj) return;
    showTooltip(clientX, clientY, buildHoverCard(obj), { delay: 380 });
  });

  on('canvas:hovermove', ({ id, clientX, clientY }) => {
    // Re-anchor without restarting the delay, so the card follows the pointer.
    if (id !== lastId) return;
  });

  window.addEventListener('mousedown', hideTooltip);
  on(EV.VIEW_CHANGED, hideTooltip);
}

function buildHoverCard(obj) {
  const def = TYPES[obj.type] || TYPES.activity;
  const lane = store.getLane(obj.lane);
  const status = statusOf(obj.status);

  const meta = [
    def.label,
    lane?.name,
    def.duration ? `${fmtDate(obj.start, 'medium')} → ${fmtDate(obj.end, 'medium')} (${fmtDuration(durationDays(obj))})` : fmtDate(obj.start, 'long'),
  ].filter(Boolean);

  const details = [
    obj.owner ? `Owner: ${obj.owner}` : null,
    obj.area ? `Area: ${obj.area}` : null,
    obj.data?.version ? `Version ${obj.data.version}` : null,
    obj.data?.buildNumber ? `Build ${obj.data.buildNumber}` : null,
    obj.data?.testPackage ? `Package ${obj.data.testPackage}` : null,
    obj.data?.reference ? `Ref ${obj.data.reference}` : null,
    def.progress ? `${Math.round(obj.progress)}% complete` : null,
    (obj.attachments || []).length ? `${obj.attachments.length} attachment(s)` : null,
  ].filter(Boolean);

  return el('div', {}, [
    el('div', { class: 'tip-title', text: obj.title }),
    obj.subtitle
      ? el('div', { style: { fontSize: 'var(--fs-tiny)', color: 'var(--text-muted)', marginBottom: '2px' }, text: obj.subtitle })
      : null,
    el('div', { class: 'tip-meta', text: meta.join('  ·  ') }),
    el('div', { style: { marginTop: '5px', display: 'flex', gap: '5px', flexWrap: 'wrap' } }, [
      el('span', { class: `cx-badge ${status.tone === 'neutral' ? 'neutral' : status.tone}`, text: status.label }),
    ]),
    details.length
      ? el('div', { style: { marginTop: '5px', fontSize: 'var(--fs-tiny)', color: 'var(--text-muted)' }, text: details.join('  ·  ') })
      : null,
    obj.notes
      ? el('div', { class: 'tip-notes' }, [renderNote(obj.notes, { max: 170 })])
      : null,
  ]);
}

/* ── System clipboard bridge ───────────────────────────────────────────── */

/**
 * Paste of an *external* file (a dragged JSON, a copied image) is handled
 * here; in-app copy/paste of objects lives in commands.js and never touches
 * the system clipboard for structured data.
 */
function installClipboardBridge() {
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  });

  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    // Panels handle their own drops; anything reaching the document is a
    // project file the user wants to open.
    if (e.target.closest('.att-drop')) return;
    e.preventDefault();
    emit('ui:file-dropped', { file: e.dataTransfer.files[0] });
    toast({
      tone: 'info',
      title: 'Open Import / Export to load this file',
      message: e.dataTransfer.files[0].name,
    });
  });
}

/* ── Go ────────────────────────────────────────────────────────────────── */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// Surface unexpected failures rather than leaving a silently broken canvas.
window.addEventListener('error', (e) => {
  console.error('[cx-timeline]', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[cx-timeline] unhandled promise rejection:', e.reason);
});
