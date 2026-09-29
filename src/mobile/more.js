/**
 * More — the account, how it looks, and putting it on the home screen.
 *
 * Installing is the one thing here that differs by phone, and it is said per
 * phone rather than in general: Android's browsers offer an install dialog the
 * page can open, an iPhone installs only from Safari's Share menu, and a phone
 * that already has it installed needs to be told nothing at all.
 *
 * Imports: util, rc, icons, components, theme, pwa.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import { icon } from '../ui/icons.js';
import { segmented, toast } from '../ui/components.js';
import { THEME_CHOICES, themePreference, setThemePreference } from './theme.js';
import { isInstalled, canPrompt, promptInstall, isIos, onInstallChange } from './pwa.js';

const ROLES = {
  admin: 'Administrator — you can plan anybody’s days.',
  member: 'Member — you can plan your own days.',
  viewer: 'Viewer — you can read the calendar but not change it.',
};

let stopListening = null;

export function render(root) {
  const me = rc.me();
  const account = rc.currentUser();

  root.appendChild(card('Account', [
    el('div', { class: 'm-account' }, [
      el('div', { class: 'm-avatar', text: initials(me?.name || account?.email || '?') }),
      el('div', {}, [
        el('div', { class: 'm-account-name', text: me?.name || rc.accountLabel() }),
        account?.email ? el('div', { class: 'm-hint', text: account.email }) : null,
      ]),
    ]),
    el('p', { class: 'm-note', text: ROLES[rc.role()] || '' }),
    el('button', {
      class: 'cx-btn m-wide',
      type: 'button',
      html: `${icon('logout', { size: 16 })}<span>Sign out</span>`,
      onClick: async () => {
        await rc.signOut();
        toast({ message: 'Signed out.' });
      },
    }),
  ]));

  root.appendChild(card('Appearance', [
    segmented({
      value: themePreference(),
      stretch: true,
      options: THEME_CHOICES.map((c) => ({ value: c.value, label: c.label })),
      onChange: (value) => setThemePreference(value),
    }),
    el('p', { class: 'm-note', text: '"Phone" follows the light or dark setting of the phone itself.' }),
  ]));

  /* Only while there is something to do about it. Once the app is on the home
     screen the card has nothing left to say, and a card saying so is a card
     somebody reads every time for no reason. */
  const install = el('div');
  const installCard = card('On this phone', [install]);
  const drawInstall = () => {
    clear(install);
    installCard.hidden = isInstalled();
    if (!installCard.hidden) install.append(...installHelp());
  };
  drawInstall();
  stopListening?.();
  stopListening = onInstallChange(() => {
    if (install.isConnected) drawInstall();
  });
  root.appendChild(installCard);

  root.appendChild(card('Everything else', [
    el('p', {
      class: 'm-note',
      text: 'The daily huddle, PTO, reports, the full look-ahead grid and the timeline are on the '
        + 'full site, on a computer. This app is your week and the look-ahead, and nothing of the '
        + 'timeline’s plan is ever loaded on a phone.',
    }),
    el('a', {
      class: 'cx-btn ghost m-wide',
      href: '../',
      html: `${icon('external', { size: 16 })}<span>Open the full site</span>`,
    }),
  ]));
}

function card(title, children) {
  return el('section', { class: 'm-card' }, [
    el('h2', { class: 'm-card-title', text: title }),
    ...children,
  ]);
}

function initials(name) {
  const words = String(name).replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  return (words[0]?.[0] || '?').toUpperCase() + (words[1]?.[0] || '').toUpperCase();
}

function installHelp() {
  if (canPrompt()) {
    return [
      el('p', { class: 'm-note', text: 'Put it on your home screen so it opens like an app, full screen.' }),
      el('button', {
        class: 'cx-btn primary m-wide',
        type: 'button',
        html: `${icon('download', { size: 16 })}<span>Install the app</span>`,
        onClick: async () => {
          const outcome = await promptInstall();
          if (outcome === 'accepted') toast({ tone: 'good', message: 'Installed.' });
        },
      }),
    ];
  }
  if (isIos()) {
    return [el('ol', { class: 'm-steps' }, [
      el('li', { text: 'Open this page in Safari.' }),
      el('li', { text: 'Tap the Share button.' }),
      el('li', { text: 'Choose "Add to Home Screen".' }),
    ])];
  }
  return [el('p', {
    class: 'm-note',
    text: 'Use your browser’s menu and choose "Install app" or "Add to Home screen" to open it '
      + 'like an app.',
  })];
}
