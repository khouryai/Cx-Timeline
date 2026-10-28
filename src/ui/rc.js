/**
 * The Resource Calendar interface.
 *
 * A peer of the timeline canvas rather than a dock pane: it is a different
 * interface over different data, reached by the workspace switch in the
 * sidebar. Nothing here runs until somebody switches to it — see
 * `ui/workspace.js` for why boot must not touch it.
 *
 * The calendar is kept in the shared folder beside the plan (`core/rc.js`), so
 * the door is the folder: open it, and bring the old calendar in or start one
 * (`ui/rc_gate.js`). Once it is open, the header says who holds the pen — the
 * one person writing it — and offers to take it over or hand it back.
 *
 * Imports: util, events, rc, icons, components, rc_gate, and the tab modules.
 */

import { el, clear } from '../core/util.js';
import { on, EV } from '../core/events.js';
import * as rc from '../core/rc.js';
import * as filestore from '../core/filestore.js';
import { icon } from './icons.js';
import { toast, emptyState, promptDialog } from './components.js';
import { penButton } from './rc_util.js';
import { notConfigured, noFolder, emptyFolder, readFailed } from './rc_gate.js';
import * as roster from './rc_roster.js';
import * as lookahead from './rc_lookahead.js';
import * as pto from './rc_pto.js';
import * as tawr from './rc_tawr.js';
import { enhanceTables } from './rc_table.js';
import { startScheduledExports } from './rc_master_export.js';

/**
 * The tabs: the look-ahead and everything hanging off it — the calendar and
 * its editor, cancellations, changes, the legend, P6 — then who is away, the
 * track access requests, and the lists everything is read against.
 */
const TABS = [
  { id: 'lookahead', label: 'Look-ahead' },
  { id: 'pto', label: 'PTO' },
  { id: 'tawr', label: 'TAWR' },
  { id: 'org', label: 'Lists' },
];

const RENDERERS = {
  lookahead: lookahead.render,
  pto: pto.render,
  tawr: tawr.render,
  org: roster.render,
};

let frame = null;
let bodyEl = null;
let headEl = null;
let active = 'lookahead';
let started = false;

/* ── Build ─────────────────────────────────────────────────────────────── */

/**
 * Build the stage. Called once, by the workspace switch, on first use.
 *
 * Deliberately synchronous: it paints something immediately and then loads.
 */
export function build() {
  if (started) return;
  frame = document.getElementById('rc-frame');
  if (!frame) return;
  started = true;

  clear(frame);
  frame.hidden = false;

  headEl = el('div', { class: 'rc-head' });
  bodyEl = el('div', { class: 'rc-body' });
  frame.append(headEl, bodyEl);

  // Every table a tab draws gets the same header, sorting and export — see
  // ui/rc_table.js. Watched rather than called, because tabs draw in stages.
  let pendingEnhance = false;
  new MutationObserver(() => {
    if (pendingEnhance) return;
    pendingEnhance = true;
    queueMicrotask(() => {
      pendingEnhance = false;
      enhanceTables(bodyEl);
    });
  }).observe(bodyEl, { childList: true, subtree: true });

  on(EV.RC_CHANGED, () => render());
  on(EV.RC_AUTH_CHANGED, () => render());
  on(EV.RC_SHOW_TAB, ({ tab }) => showTab(tab));
  // The pen moving changes what may be pressed; the view is drawn again for it.
  on(EV.RC_PEN, (st) => {
    if (st?.idle) {
      toast({
        tone: 'info',
        title: 'Calendar handed back',
        message: 'Nothing was written for an hour, so the pen went back for whoever is waiting. Press Take over editing when you want it again.',
        timeout: 12000,
      });
    }
    render();
  });

  render();
  init();
}

async function init() {
  try {
    await rc.enterCalendar();
  } catch (err) {
    console.warn('[cx-timeline] resource calendar init failed:', err.message);
  }
  render();
  // A master export on a schedule runs on this computer while the calendar is open.
  startScheduledExports();
}

/* ── Router ────────────────────────────────────────────────────────────── */

export function showTab(id) {
  if (!RENDERERS[id]) return;
  active = id;
  render();
}

function render() {
  if (!frame) return;
  renderHead();
  clear(bodyEl);

  const after = () => { init(); };
  if (!rc.isConfigured()) {
    bodyEl.appendChild(notConfigured());
    return;
  }
  const { state, problem } = rc.status();
  if (state === 'no-folder') {
    bodyEl.appendChild(noFolder({ onDone: after }));
    return;
  }
  if (state === 'empty') {
    bodyEl.appendChild(emptyFolder({ onDone: after }));
    return;
  }
  if (state === 'failed') {
    bodyEl.appendChild(readFailed(problem, { onDone: after }));
    return;
  }
  if (!rc.isSignedIn()) {
    bodyEl.appendChild(emptyState({ iconName: 'database', title: 'Opening the calendar…', message: 'Reading calendar/ in the shared folder.' }));
    return;
  }

  const view = el('div');
  bodyEl.append(penBanner(), view);
  if (!RENDERERS[active]) active = 'lookahead';
  Promise.resolve(RENDERERS[active](view)).catch((err) => {
    rc.reportError(`tab:${active}`, err);
    clear(view);
    view.appendChild(loadFailed(err));
  });
}

function renderHead() {
  if (!headEl) return;
  clear(headEl);

  headEl.append(el('span', { class: 'rc-eyebrow', text: 'Resource Calendar' }));
  if (!rc.isSignedIn()) return;

  const tabs = el('div', { class: 'rc-tabs' });
  for (const tab of TABS) {
    tabs.appendChild(el('button', {
      class: 'rc-tab',
      type: 'button',
      text: tab.label,
      dataset: { tab: tab.id },
      'aria-pressed': String(tab.id === active),
      onClick: () => showTab(tab.id),
    }));
  }
  headEl.appendChild(tabs);

  const pen = rc.penState();
  headEl.appendChild(el('span', {
    class: 'rc-queue',
    style: pen.editing
      ? 'background:var(--good-light);border-color:var(--good-border);color:var(--good)'
      : 'background:var(--info-light);border-color:var(--info-border);color:var(--info)',
    text: pen.editing ? 'Editing' : 'Read only',
    dataset: { pen: pen.editing ? 'editing' : 'read-only' },
    title: pen.editing
      ? 'You hold the calendar\'s pen: what you change is saved to the shared folder. Anybody else who opens it reads it.'
      : pen.holder ? `${pen.holder} is editing the calendar.` : 'Nobody is editing the calendar. Take over editing to change it.',
  }));
  // Read-only, the way to take it is the banner under the tabs, on every tab.
  if (pen.editing) headEl.appendChild(penButton());

  headEl.appendChild(el('button', {
    class: 'cx-btn mini ghost',
    type: 'button',
    text: rc.accountLabel() || 'Set your name',
    title: 'The name the calendar stamps what you write with, and shows a colleague while you are editing.',
    dataset: { action: 'your-name' },
    onClick: async () => {
      const name = await promptDialog({
        title: 'Your name',
        label: 'As the roster has it — the calendar matches it to the list of people',
        value: rc.displayName(),
        confirmLabel: 'Save',
      });
      if (!name || !name.trim()) return;
      filestore.setDisplayName(name.trim());
      await rc.refreshMe();
      toast({ message: `You are ${name.trim()} in the calendar.` });
    },
  }));
}

/**
 * "Dana is editing the calendar", with the way to take it — above every tab
 * while it is true. Taking over never refuses: the folder's guard means that
 * if they save after you take it, their save is the one refused, not yours.
 */
function penBanner() {
  const pen = rc.penState();
  if (pen.editing) return el('span', { hidden: true });
  const idle = pen.holderIdleMs != null ? ` They last saved ${Math.max(1, Math.round(pen.holderIdleMs / 60000))} min ago.` : '';
  const words = pen.holder
    ? [el('strong', { text: `${pen.holder} is editing the calendar.` }),
      el('span', { text: ` You can read everything; changes are theirs to make until they finish or you take over.${idle}` })]
    : [el('strong', { text: 'You handed the calendar back.' }),
      el('span', { text: ' Nobody is editing it. It stays read-only here until you take over editing.' })];
  return el('div', { class: 'rc-preview-banner', role: 'status', dataset: { pen: 'viewer' } }, [
    el('span', { html: icon('eye', { size: 16 }), 'aria-hidden': 'true' }),
    el('div', { class: 'rc-preview-text' }, words),
    penButton({ primary: true }),
  ]);
}

function loadFailed(err) {
  return emptyState({
    iconName: 'warning',
    title: 'Could not load',
    message: String(err?.message || err),
  });
}

/* The shared helpers the tabs use live in `ui/rc_util.js`, not here — this
   module imports the tabs, so anything they needed back from it would be a
   cycle, and the build rejects those. */
