/**
 * Application entry point.
 *
 * Boot order matters and is deliberate:
 *   1. storage opens and hands back the document to load,
 *   2. the store adopts it (nothing renders against an empty document),
 *   3. the theme is applied before the first paint, so there is no flash,
 *   4. the shell and canvas mount,
 *   5. interaction, shortcuts and menus attach last, once their targets exist.
 *
 * Imports: everything — this is the only module allowed to.
 */

import { debounce } from './core/util.js';
import { on, emit, EV } from './core/events.js';
import { projectExtent, effectiveToday } from './core/model.js';
import * as store from './core/store.js';
import { init as initStorage, takeRecovery, getPref, setPref, saveNow } from './core/storage.js';
import { criticalPath } from './core/analysis.js';
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
import { installShortcuts } from './ui/shortcuts.js';
import { toast, showTooltip, hideTooltip, confirmDialog } from './ui/components.js';
import { renderNote, notePreview } from './ui/notes.js';
import { TYPES, statusOf, durationDays } from './core/model.js';
import { fmtDate, fmtDuration, setDateOrder, getDateOrder } from './core/dates.js';
import { el } from './core/util.js';

const APP_VERSION = '1.0.0';

async function boot() {
  const started = performance.now();

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
    const recovery = takeRecovery(loaded.doc);
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

  const inspector = document.getElementById('inspector');
  const inspectorResizer = el('div', { class: 'resizer left' });
  inspector.appendChild(inspectorResizer);
  installResizer(inspectorResizer, inspector, 240, 520);

  restoreView();

  /* ── 5. Interaction ──────────────────────────────────────────────────── */
  attachInteractions();
  installMenus();
  installShortcuts();
  installHoverPreview();
  installViewPersistence();
  installResizeHandling();
  installCriticalPathRecompute();
  installClipboardBridge();

  renderer.renderNow();

  /* ── Done ────────────────────────────────────────────────────────────── */
  const splash = document.getElementById('boot');
  if (splash) {
    splash.classList.add('done');
    setTimeout(() => splash.remove(), 420);
  }

  console.info(`CX Timeline ${APP_VERSION} ready in ${Math.round(performance.now() - started)}ms`);
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
