/**
 * The phone app's chrome: a header, a view, and a tab bar under the thumb.
 *
 * Four tabs, because that is what the phone is for. **My week** is the reason
 * anybody opens it — what am I on, where, and did the meeting record how it
 * went — and where somebody changes their own plan. **Look-ahead** is the sheet
 * read one day at a time. **PTO** asks for time off and shows the answer.
 * **More** is the account and the install. The huddle, answering leave, reports,
 * the organisation and the timeline stay on a computer: they are an
 * administrator's screens or a wall-sized plan, and the build refuses to link
 * them into this bundle at all (`tools/build.js`).
 *
 * The account states — no backend, signed out, not on the team — are the
 * desktop calendar's own (`ui/rc_gate.js`), so there is one door and not two.
 *
 * Every read goes through `core/rc.js`, the same client, the same thirty-second
 * memory and the same forgetting on every write; the phone keeps no copy of the
 * calendar of its own. A write anywhere emits `RC_CHANGED` and whatever is on
 * screen re-reads, keeping its scroll position, because a list that jumps to the
 * top after every edit is a list nobody can edit twice.
 *
 * Imports: util, events, rc, icons, components, rc_gate, and the three views.
 */

import { el, clear } from '../core/util.js';
import { on, EV } from '../core/events.js';
import * as rc from '../core/rc.js';
import { icon } from '../ui/icons.js';
import { emptyState } from '../ui/components.js';
import { notConfigured, signInForm, notOnTheTeam } from '../ui/rc_gate.js';
import * as week from './week.js';
import * as lookahead from './lookahead.js';
import * as timeoff from './timeoff.js';
import * as more from './more.js';

const TABS = [
  { id: 'week', label: 'My week', icon: 'calendar-check', render: week.render },
  { id: 'lookahead', label: 'Look-ahead', icon: 'calendar', render: lookahead.render },
  { id: 'pto', label: 'PTO', icon: 'sun', render: timeoff.render },
  { id: 'more', label: 'More', icon: 'user', render: more.render },
];

let head = null;
let main = null;
let nav = null;
let active = tabFromHash() || 'week';
let ready = false;
let generation = 0;

/** Build the chrome and start. Called once, by `mobile.js`. */
export function start() {
  head = document.getElementById('m-head');
  main = document.getElementById('m-main');
  nav = document.getElementById('m-tabs');
  if (!head || !main || !nav) return;
  document.body.classList.add('m-app');

  on(EV.RC_CHANGED, () => render({ keepScroll: true }));
  on(EV.RC_AUTH_CHANGED, () => render());
  window.addEventListener('online', () => { renderHead(); render({ keepScroll: true }); });
  window.addEventListener('offline', renderHead);
  window.addEventListener('hashchange', () => {
    const tab = tabFromHash();
    if (tab && tab !== active) show(tab);
  });

  render();
  rc.init()
    .catch((err) => console.warn('[cx-calendar] the calendar could not be reached:', err.message))
    .finally(() => {
      ready = true;
      render();
    });
}

/** Switch tab. Written into the address so a reload comes back to it. */
export function show(id) {
  if (!TABS.some((t) => t.id === id)) return;
  active = id;
  // Replace rather than push: the phone's back button should leave the app,
  // not walk back through every tab somebody tapped.
  if (onTheTeam()) history.replaceState(null, '', `#${id}`);
  render();
  main.scrollTop = 0;
}

function tabFromHash() {
  const id = (window.location.hash || '').replace(/^#\/?/, '');
  return TABS.some((t) => t.id === id) ? id : null;
}

function onTheTeam() {
  return rc.isConfigured() && ready && rc.isSignedIn() && Boolean(rc.me());
}

/* ── Drawing ───────────────────────────────────────────────────────────── */

function render({ keepScroll = false } = {}) {
  if (!main) return;
  renderHead();
  renderNav();
  const scroll = keepScroll ? main.scrollTop : 0;
  clear(main);

  if (!rc.isConfigured()) {
    main.appendChild(notConfigured({
      message: 'This site was published without a resource calendar, so there is nothing for the '
        + 'phone app to show. The calendar is configured in config.js as rcSupabaseUrl and '
        + 'rcSupabaseAnonKey.',
    }));
    return;
  }
  if (!ready) {
    main.appendChild(loading());
    return;
  }
  if (!rc.isSignedIn()) {
    main.appendChild(signInForm({
      onDone: () => render(),
      blurb: 'Your week and the look-ahead, on your phone. It is the same account as the '
        + 'calendar on a computer.',
    }));
    return;
  }
  if (!rc.me()) {
    main.appendChild(notOnTheTeam());
    return;
  }

  const view = el('div', { class: 'm-view', 'data-view': active });
  main.appendChild(view);
  const mine = ++generation;
  const tab = TABS.find((t) => t.id === active);
  Promise.resolve(tab.render(view, { show }))
    .then(() => {
      if (mine === generation && keepScroll) main.scrollTop = scroll;
    })
    .catch((err) => {
      // A newer render has replaced this one; its failure is nobody's concern.
      if (mine !== generation) return;
      clear(view);
      view.appendChild(loadFailed(err));
    });
}

function renderHead() {
  if (!head) return;
  clear(head);
  const tab = TABS.find((t) => t.id === active);
  /* Filtered, because `append(null)` inserts the word "null" — `el()` drops an
     absent child and a raw `append()` does not. */
  head.append(...[
    el('div', { class: 'm-brand', 'aria-hidden': 'true' }),
    el('div', { class: 'm-head-text' }, [
      el('div', { class: 'rc-eyebrow', text: 'CX Calendar' }),
      el('h1', { class: 'm-head-title', text: onTheTeam() ? tab.label : 'Resource calendar' }),
    ]),
    /* Said in the chrome rather than discovered by a failed read: on site the
       signal comes and goes, and a list that silently stopped updating reads as
       a list with nothing new in it. */
    navigator.onLine === false
      ? el('span', { class: 'm-offline', role: 'status', text: 'Offline' })
      : null,
    onTheTeam()
      ? el('button', {
        class: 'cx-btn icon ghost m-head-btn',
        'aria-label': 'Reload from the calendar',
        title: 'Reload from the calendar',
        html: icon('refresh', { size: 18 }),
        onClick: () => {
          rc.forgetReads();
          render({ keepScroll: true });
        },
      })
      : null,
  ].filter(Boolean));
}

function renderNav() {
  if (!nav) return;
  clear(nav);
  nav.hidden = !onTheTeam();
  if (nav.hidden) return;
  for (const tab of TABS) {
    nav.appendChild(el('button', {
      class: 'm-tab',
      type: 'button',
      'aria-current': tab.id === active ? 'page' : null,
      onClick: () => show(tab.id),
    }, [
      el('span', { class: 'm-tab-icon', html: icon(tab.icon, { size: 22 }) }),
      el('span', { class: 'm-tab-label', text: tab.label }),
    ]));
  }
}

function loading() {
  return el('div', { class: 'm-loading', role: 'status', 'aria-live': 'polite' }, [
    el('div', { class: 'm-spinner', 'aria-hidden': 'true' }),
    el('span', { text: 'Opening the calendar…' }),
  ]);
}

/**
 * A read that failed, said in words somebody on site can act on.
 *
 * Offline is the common case and it is not an error: the app is on the phone,
 * the calendar is not, and the honest answer is to say so and offer to try
 * again rather than show whatever was on screen last as though it were current.
 */
function loadFailed(err) {
  const offline = navigator.onLine === false || /fetch|network/i.test(String(err?.message || err));
  return emptyState({
    iconName: offline ? 'wifi' : 'warning',
    title: offline ? 'No connection to the calendar' : 'Could not load',
    message: offline
      ? 'The app is on your phone; the calendar is not. It will load again as soon as there is '
        + 'signal — nothing here is shown from an old copy.'
      : String(err?.message || err),
    action: {
      label: 'Try again',
      onClick: () => {
        rc.forgetReads();
        render();
      },
    },
  });
}
