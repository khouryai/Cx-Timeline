/**
 * The Resource Calendar interface.
 *
 * A peer of the timeline canvas rather than a dock pane: it is a different
 * interface over different data, reached by the workspace switch in the
 * sidebar. Nothing here runs until somebody switches to it — see
 * `ui/workspace.js` for why boot must not touch it.
 *
 * The account gate lives here rather than in `main.js`, and that is the point.
 * The timeline needs no account and must open with no network at all; only
 * this module does. So signing in is something that happens when you arrive at
 * the calendar, not something that happens before the application starts.
 *
 * Imports: util, events, rc, components, rc_gate, and the tab modules.
 */

import { el, clear } from '../core/util.js';
import { on, EV } from '../core/events.js';
import * as rc from '../core/rc.js';
import { toast, emptyState } from './components.js';
import { notConfigured, signInForm, notOnTheTeam } from './rc_gate.js';
import * as roster from './rc_roster.js';
import * as huddle from './rc_huddle.js';
import * as lookahead from './rc_lookahead.js';
import * as week from './rc_week.js';
import * as pto from './rc_pto.js';
import * as reports from './rc_reports.js';

/**
 * The tabs, in the order the work actually happens: run today's meeting, plan
 * the week, see who is off, see what the look-ahead did to it, then the numbers.
 *
 * **"Resources" is gone, folded into "Week plan".** They were people down and
 * days across in both cases, over the same `rc_plan_entries`, through the same
 * `assignmentIndex()` — the same table drawn twice with a different subtitle,
 * and each one missing something the other had.
 */
const TABS = [
  { id: 'huddle', label: 'Daily huddle' },
  { id: 'week', label: 'Week plan' },
  { id: 'pto', label: 'PTO' },
  { id: 'lookahead', label: 'Look-ahead' },
  { id: 'reports', label: 'Reports' },
  { id: 'org', label: 'Organisation' },
];

const RENDERERS = {
  huddle: huddle.render,
  week: week.render,
  pto: pto.render,
  lookahead: lookahead.render,
  reports: reports.render,
  org: roster.render,
};

let frame = null;
let bodyEl = null;
let headEl = null;
let active = 'huddle';
let started = false;

/* ── Build ─────────────────────────────────────────────────────────────── */

/**
 * Build the stage. Called once, by the workspace switch, on first use.
 *
 * Deliberately synchronous: it paints something immediately and then loads.
 * A blank rectangle while a network call decides what to draw is worse than a
 * message that says what is happening.
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

  // A row written anywhere reloads whatever is on screen. There is no document
  // and no diff here, so the cheapest correct thing is to re-read — the
  // volumes are a fortnight of one small team, not a project's worth of bars.
  on(EV.RC_CHANGED, () => render());
  on(EV.RC_AUTH_CHANGED, () => render());
  on(EV.RC_QUEUE_CHANGED, () => renderHead());

  render();
  init();
}

async function init() {
  try {
    await rc.init();
  } catch (err) {
    console.warn('[cx-timeline] resource calendar init failed:', err.message);
  }
  render();
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

  if (!rc.isConfigured()) {
    bodyEl.appendChild(notConfigured());
    return;
  }
  if (!rc.isSignedIn()) {
    bodyEl.appendChild(signInForm({ onDone: () => render() }));
    return;
  }
  if (!rc.me()) {
    bodyEl.appendChild(notOnTheTeam());
    return;
  }

  const view = el('div');
  bodyEl.appendChild(view);
  Promise.resolve(RENDERERS[active](view)).catch((err) => {
    clear(view);
    view.appendChild(loadFailed(err));
  });
}

function renderHead() {
  if (!headEl) return;
  clear(headEl);

  headEl.append(
    el('span', { class: 'rc-eyebrow', text: 'Resource Calendar' })
  );

  if (rc.isSignedIn() && rc.me()) {
    const tabs = el('div', { class: 'rc-tabs' });
    // Look-ahead and Reports are administrators-only in the database and
    // already say so. Showing them to a viewer offers a door that opens onto a
    // wall, so they come out of the row entirely.
    /* Reports and Organisation are an administrator's: the KPIs are a different
       audience and a different permission, and the roster, the locations and
       the accounts are the calendar's administration rather than its use. Both
       are restricted in the database as well — this only stops offering a door
       that opens onto a wall.
       The **look-ahead stays**, for everybody. It is what the field team is
       being asked to do, and while it was hidden the people named on it were
       the only people who could not look at it; they asked their manager to
       screenshot it instead. What they get is the calendar, read-only — the
       change register, the snapshots and the SARs are still the claim evidence
       and still administrators-only, in the policies. */
    /* The **daily huddle** joins them. It is the meeting: it asks a whole team
       in turn how yesterday went, and it is where an outcome is entered. A
       member has nothing to run and nothing to enter there but their own day,
       and what they need out of it — the status and the note recorded against
       their work — is now in the week plan, beside the rest of their week. */
    const ADMIN_ONLY = new Set(['huddle', 'reports', 'org']);
    const visible = rc.isAdmin() ? TABS : TABS.filter((t) => !ADMIN_ONLY.has(t.id));
    if (!visible.some((t) => t.id === active)) active = visible[0].id;
    for (const tab of visible) {
      tabs.appendChild(el('button', {
        class: 'rc-tab',
        type: 'button',
        text: tab.label,
        'aria-pressed': String(tab.id === active),
        onClick: () => showTab(tab.id),
      }));
    }
    headEl.appendChild(tabs);

    /* Leave waiting on an answer. The whole point of a member being able to ask
       is that somebody answers, and a request nobody is told about is a request
       that sits there — so it is on the chrome rather than only inside the tab,
       and it says how many and where to go. */
    if (rc.isAdmin()) headEl.appendChild(pendingLeaveChip());

    const pending = huddle.pendingCount();
    headEl.appendChild(el('span', {
      class: 'rc-queue',
      hidden: pending === 0,
      text: `${pending} unsynced`,
      title: 'Entered while offline. They will go up on their own when the connection returns.',
    }));

    if (rc.isViewer()) {
      headEl.appendChild(el('span', {
        class: 'rc-queue',
        style: 'background:var(--info-light);border-color:var(--info-border);color:var(--info)',
        text: 'Read only',
        title: 'You can see the schedule and what happened. Changing it is restricted in the database, not just here.',
      }));
    }

    headEl.appendChild(el('button', {
      class: 'cx-btn mini ghost',
      text: rc.accountLabel(),
      title: 'Sign out of the resource calendar',
      onClick: async () => {
        await rc.signOut();
        toast({ message: 'Signed out of the resource calendar.' });
      },
    }));
  }
}

/**
 * "Two people are waiting on you", on the chrome.
 *
 * A member can ask for leave now, and asking is only worth anything if somebody
 * answers — a request that nobody is told about is a request that sits in a tab
 * an administrator had no reason to open. So it is counted on the header, next
 * to the offline queue, and pressing it goes where the answer is given.
 *
 * Built empty and filled when the count arrives. The header is drawn
 * synchronously on every render and this is a network read: waiting for it would
 * hold up the tabs, and a chip that appears a moment later is exactly as useful.
 * A read that fails leaves it hidden, which is the same as none waiting — it is
 * a prompt, not a control, and the PTO tab is the record either way.
 */
function pendingLeaveChip() {
  const chip = el('button', {
    class: 'rc-queue rc-queue-ask',
    hidden: true,
    type: 'button',
    title: 'Leave your team has asked for and nobody has answered. Answer it in PTO.',
    onClick: () => showTab('pto'),
  });
  rc.pendingLeave()
    .then((rows) => {
      const n = (rows || []).length;
      if (!n) return;
      chip.textContent = `${n} leave request${n === 1 ? '' : 's'}`;
      chip.hidden = false;
    })
    .catch(() => {});
  return chip;
}

/* ── The states that are not the calendar ──────────────────────────────── */

/* No backend, the sign-in form and an account that is not on the team live in
   `ui/rc_gate.js`, because the phone app draws the same three and cannot
   import this module — it imports every tab, and through them the folder. */

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
