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
 * Imports: util, events, rc, icons, components, and the tab modules.
 */

import { el, clear } from '../core/util.js';
import { on, EV } from '../core/events.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import { textInput, toast, emptyState } from './components.js';
import * as roster from './rc_roster.js';
import * as huddle from './rc_huddle.js';
import * as lookahead from './rc_lookahead.js';
import * as reports from './rc_reports.js';

/**
 * The tabs, in the order the work actually happens: run today's meeting, plan
 * the week, see what the look-ahead did to it, then the numbers.
 */
const TABS = [
  { id: 'huddle', label: 'Daily huddle' },
  { id: 'week', label: 'Week plan' },
  { id: 'lookahead', label: 'Look-ahead' },
  { id: 'reports', label: 'Reports' },
  { id: 'org', label: 'Organisation' },
];

const RENDERERS = {
  huddle: huddle.render,
  week: huddle.renderWeek,
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
  // volumes are a fortnight of one small team, not a programme's worth of bars.
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
    bodyEl.appendChild(signInForm());
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
    const visible = rc.isAdmin() ? TABS : TABS.filter((t) => t.id !== 'lookahead' && t.id !== 'reports');
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

/* ── The states that are not the calendar ──────────────────────────────── */

/**
 * No backend in this build.
 *
 * Not an error. A build can legitimately have the timeline and not this — that
 * is what every build has had until now — so it says what is missing and where
 * it is configured rather than pretending something broke.
 */
function notConfigured() {
  return el('div', { class: 'rc-state' }, [
    el('div', { class: 'rc-state-icon', html: icon('database', { size: 32 }) }),
    el('h2', { text: 'No resource calendar in this build' }),
    el('p', {
      text: 'The timeline works as it always has. The resource calendar needs a '
        + 'Supabase project, named in config.js as rcSupabaseUrl and '
        + 'rcSupabaseAnonKey — separate from the timeline, which stays in your folder.',
    }),
  ]);
}

/**
 * Signed in to nothing yet.
 *
 * The form writes to the calendar's own client, which keeps its own session
 * under its own storage key. Signing in here does not sign you in to anything
 * the timeline uses, because the timeline uses nothing.
 */
function signInForm() {
  const email = textInput({ placeholder: 'you@example.com', type: 'email' });
  const password = textInput({ placeholder: 'Password', type: 'password' });
  const error = el('div', { class: 'rc-error', hidden: true });
  const button = el('button', { class: 'cx-btn primary', text: 'Sign in' });

  const submit = async () => {
    error.hidden = true;
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      await rc.signIn(email.value, password.value);
      render();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  };

  button.addEventListener('click', submit);
  for (const field of [email, password]) {
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }

  return el('div', { class: 'rc-state' }, [
    el('div', { class: 'rc-state-icon', html: icon('users', { size: 32 }) }),
    el('h2', { text: 'Sign in to the resource calendar' }),
    el('p', { text: 'The timeline needs no account and is already open behind this. Only the calendar does.' }),
    el('div', { class: 'rc-signin' }, [email, password, error, button]),
  ]);
}

/** An account that is not on the team. A real answer, not a failure. */
function notOnTheTeam() {
  return el('div', { class: 'rc-state' }, [
    el('div', { class: 'rc-state-icon', html: icon('user', { size: 32 }) }),
    el('h2', { text: 'You are signed in, but not on this team' }),
    el('p', {
      text: 'An administrator adds people in Organisation. Until your account is '
        + 'linked to a team record, the database will not show you anything.',
    }),
    el('button', { class: 'cx-btn ghost', text: 'Sign out', onClick: () => rc.signOut() }),
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
