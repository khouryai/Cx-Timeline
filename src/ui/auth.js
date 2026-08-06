/**
 * Sign-in, the account menu, and sharing.
 *
 * Only reachable on a hosted deployment — with `config.js` blank none of this
 * is ever shown and the application boots straight into the canvas, exactly as
 * it does today.
 *
 * The gate is a full-screen overlay rather than a separate page, so a single
 * static file still serves the whole application and there is no route to get
 * wrong. It renders before the workspace is built, so nothing behind it can
 * flash into view.
 *
 * Imports: util, events, cloud, icons, components.
 */

import { el, clear } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import * as cloud from '../core/cloud.js';
import { icon } from './icons.js';
import { openModal, field, textInput, selectInput, toast, badge, confirmDialog, emptyState } from './components.js';

/* ══════════════════════════════════════════════════════════════════════════
   The gate
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Show the sign-in screen and resolve once there is a session.
 *
 * Resolves to the user, or to null when the visitor chooses to work locally —
 * which stays available unless the deployment sets `requireAuth`.
 */
export function requireSignIn() {
  return new Promise((resolve) => {
    const allowLocal = !cloud.authRequired();
    let mode = 'signin'; // signin | signup | reset

    const overlay = el('div', { class: 'cx-gate', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sign in' });
    const card = el('div', { class: 'cx-gate-card' });
    overlay.appendChild(card);

    const emailInput = textInput({ type: 'email', value: '', placeholder: 'you@company.com' });
    emailInput.setAttribute('autocomplete', 'username');
    emailInput.setAttribute('name', 'email');

    const passwordInput = textInput({ type: 'password', value: '', placeholder: '••••••••' });
    passwordInput.setAttribute('autocomplete', 'current-password');
    passwordInput.setAttribute('name', 'password');

    const nameInput = textInput({ value: '', placeholder: 'Your name' });
    nameInput.setAttribute('autocomplete', 'name');

    const message = el('div', { class: 'cx-gate-msg', role: 'alert' });
    const submit = el('button', { class: 'cx-btn primary', type: 'submit', text: 'Sign in' });

    const say = (text, tone = 'bad') => {
      message.className = `cx-gate-msg ${tone}`;
      message.textContent = text || '';
    };

    let busy = false;
    const setBusy = (state) => {
      busy = state;
      submit.disabled = state;
      submit.classList.toggle('loading', state);
    };

    const form = el('form', { class: 'cx-gate-form', onSubmit: (e) => { e.preventDefault(); go(); } });

    async function go() {
      if (busy) return;
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (!email) return say('Enter your email address.');
      if (mode !== 'reset' && !password) return say('Enter your password.');

      setBusy(true);
      say('');
      try {
        if (mode === 'signin') {
          const user = await cloud.signIn(email, password);
          finish(user);
        } else if (mode === 'signup') {
          const { user, confirmationRequired } = await cloud.signUp(email, password, nameInput.value.trim());
          if (confirmationRequired) {
            say(`Account created. Check ${email} for a confirmation link, then sign in.`, 'good');
            setMode('signin');
          } else {
            finish(user);
          }
        } else {
          await cloud.sendPasswordReset(email);
          say(`If there is an account for ${email}, a reset link is on its way.`, 'good');
          setMode('signin');
        }
      } catch (err) {
        say(err.message);
      } finally {
        setBusy(false);
      }
    }

    function finish(user) {
      overlay.classList.add('done');
      setTimeout(() => overlay.remove(), 260);
      resolve(user);
    }

    function setMode(next) {
      mode = next;
      render();
      setTimeout(() => (mode === 'signup' ? nameInput : emailInput).focus(), 30);
    }

    function render() {
      clear(card);

      const titles = {
        signin: ['Sign in', 'Your projects, wherever you open them.'],
        signup: ['Create an account', 'You will be the owner of everything you create.'],
        reset: ['Reset your password', 'We will email you a link.'],
      };
      const [title, subtitle] = titles[mode];

      card.append(
        el('div', { class: 'cx-gate-brand' }, [
          el('div', { class: 'brand-mark' }),
          el('div', {}, [
            el('div', { class: 'cx-gate-name', text: 'CX Timeline' }),
            el('div', { class: 'cx-gate-sub', text: 'Commissioning Planner' }),
          ]),
        ]),
        el('h1', { class: 'cx-gate-title', text: title }),
        el('div', { class: 'cx-gate-lede', text: subtitle })
      );

      clear(form);
      form.append(
        ...[
          mode === 'signup' ? field('Name', nameInput) : null,
          field('Email', emailInput),
          mode !== 'reset' ? field('Password', passwordInput) : null,
          message,
          submit,
        ].filter(Boolean)
      );
      submit.textContent = { signin: 'Sign in', signup: 'Create account', reset: 'Send reset link' }[mode];
      passwordInput.setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');
      card.appendChild(form);

      const links = el('div', { class: 'cx-gate-links' });
      if (mode === 'signin') {
        links.append(
          gateLink('Create an account', () => setMode('signup')),
          gateLink('Forgot password?', () => setMode('reset'))
        );
      } else {
        links.appendChild(gateLink('Back to sign in', () => setMode('signin')));
      }
      card.appendChild(links);

      if (allowLocal) {
        card.appendChild(
          el('div', { class: 'cx-gate-local' }, [
            el('button', {
              class: 'cx-btn ghost mini',
              text: 'Continue without an account',
              onClick: () => {
                overlay.classList.add('done');
                setTimeout(() => overlay.remove(), 260);
                resolve(null);
              },
            }),
            el('div', { class: 'cx-hint', text: 'Work is saved in this browser only, and is not shared.' }),
          ])
        );
      }
    }

    render();
    document.body.appendChild(overlay);
    setTimeout(() => emailInput.focus(), 80);
  });
}

function gateLink(text, onClick) {
  return el('button', { class: 'cx-gate-link', type: 'button', text, onClick });
}

/* ══════════════════════════════════════════════════════════════════════════
   Read-only presentation
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Reflect the current role in the interface.
 *
 * A viewer is not shown a broken application: the editing affordances go away,
 * a banner explains why, and a refused write says so once rather than on every
 * keystroke. The database is what actually stops the write — this is here so
 * the user understands the state they are in.
 */
export function installAccessMode() {
  const apply = () => {
    const readOnly = cloud.isReadOnly();
    document.body.classList.toggle('read-only', readOnly);
    renderBanner(readOnly);
  };

  on(EV.ACCESS_CHANGED, apply);
  on(EV.AUTH_CHANGED, apply);

  // One notice per burst — a viewer holding an arrow key would otherwise
  // stack up a notification per repeat.
  let lastRefusal = 0;
  on(EV.EDIT_REFUSED, () => {
    const now = Date.now();
    if (now - lastRefusal < 4000) return;
    lastRefusal = now;
    toast({
      tone: 'warn',
      title: 'Read-only',
      message: 'You have view access to this project. Ask the owner for edit access to make changes.',
    });
  });

  apply();
}

function renderBanner(readOnly) {
  const existing = document.getElementById('cx-readonly-bar');
  if (!readOnly) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const bar = el('div', { id: 'cx-readonly-bar', class: 'cx-readonly-bar', role: 'status' }, [
    el('span', { class: 'ro-icon', html: icon('eye', { size: 13 }) }),
    el('span', { text: 'Read-only — you have view access to this project.' }),
  ]);
  document.getElementById('main')?.prepend(bar);
}

/* ══════════════════════════════════════════════════════════════════════════
   The account menu
   ═══════════════════════════════════════════════════════════════════════ */

/** The signed-in-as block that sits at the foot of the sidebar. */
export function accountBlock() {
  const root = el('div', { class: 'cx-account' });

  const render = () => {
    clear(root);
    if (!cloud.isSignedIn()) {
      root.appendChild(
        el('button', {
          class: 'cx-btn mini',
          html: icon('user', { size: 12 }) + '<span>Sign in</span>',
          onClick: async () => {
            await requireSignIn();
            window.location.reload();
          },
        })
      );
      return;
    }

    const label = cloud.accountLabel();
    root.append(
      el('div', { class: 'acc-avatar', text: initials(label) }),
      el('div', { class: 'acc-main' }, [
        el('div', { class: 'acc-name', text: label, title: cloud.currentUser()?.email || '' }),
        el('div', { class: 'acc-role', text: roleLabel(cloud.getRole()) }),
      ]),
      el('button', {
        class: 'cx-btn icon mini ghost',
        title: 'Sign out',
        'aria-label': 'Sign out',
        html: icon('logout', { size: 13 }),
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Sign out?',
            message: 'Anything saved stays on the server. Unsaved changes in this tab are written first.',
            confirmLabel: 'Sign out',
          });
          if (!ok) return;
          await cloud.signOut();
          window.location.reload();
        },
      })
    );
  };

  on(EV.AUTH_CHANGED, render);
  on(EV.ACCESS_CHANGED, render);
  render();
  return root;
}

function initials(label) {
  const parts = String(label).replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

function roleLabel(role) {
  return { owner: 'Owner', editor: 'Editor', viewer: 'View only' }[role] || 'No project open';
}

/* ══════════════════════════════════════════════════════════════════════════
   Sharing
   ═══════════════════════════════════════════════════════════════════════ */

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Viewer — can open and export, cannot change anything' },
  { value: 'editor', label: 'Editor — can change the plan' },
  { value: 'owner', label: 'Owner — full control, including sharing' },
];

/**
 * Who can see this project, and what they may do.
 * Owners can change it; everyone else sees the list read-only, which is
 * useful on its own — knowing who else is in a plan matters.
 */
export function openShareDialog(projectId = cloud.getProjectId(), projectName = '') {
  if (!projectId) {
    toast({ tone: 'warn', title: 'No project open', message: 'Open a project before sharing it.' });
    return;
  }

  const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  const list = el('div', { class: 'cx-list' });
  const owner = cloud.isOwner();

  const emailInput = textInput({ type: 'email', value: '', placeholder: 'colleague@company.com' });
  let inviteRole = 'viewer';

  async function refresh() {
    clear(list);
    let members = [];
    try {
      members = await cloud.listMembers(projectId);
    } catch (err) {
      list.appendChild(el('div', { class: 'cx-gate-msg bad', text: err.message }));
      return;
    }
    if (!members.length) {
      list.appendChild(emptyState({ iconName: 'user', title: 'Nobody else yet' }));
      return;
    }
    for (const member of members) list.appendChild(memberRow(member));
  }

  function memberRow(member) {
    const isLastOwner = member.role === 'owner';
    return el('div', { class: 'cx-listrow', dataset: { member: member.userId }, style: { cursor: 'default' } }, [
      el('div', { class: 'acc-avatar small', text: initials(member.name || member.email || '?') }),
      el('div', { class: 'lr-main' }, [
        el('div', { class: 'lr-title', text: (member.name || member.email) + (member.isYou ? '  (you)' : '') }),
        el('div', { class: 'lr-meta', text: member.email || '' }),
      ]),
      owner && !member.isYou
        ? selectInput({
            value: member.role,
            mini: true,
            options: ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.value })),
            onChange: async (v) => {
              try {
                await cloud.setMemberRole(projectId, member.email, v);
                toast({ tone: 'good', title: 'Access updated', message: `${member.email} is now ${v === 'viewer' ? 'a viewer' : `an ${v}`}.` });
                refresh();
              } catch (err) {
                toast({ tone: 'bad', title: 'Could not change access', message: err.message });
                refresh();
              }
            },
          })
        : badge(roleLabel(member.role), member.role === 'viewer' ? 'muted' : 'info'),
      owner && !(member.isYou && isLastOwner)
        ? el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Remove access',
            'aria-label': `Remove ${member.email}`,
            html: icon('x', { size: 11 }),
            onClick: async () => {
              const ok = await confirmDialog({
                title: `Remove ${member.email}?`,
                message: 'They lose access to this project immediately.',
                confirmLabel: 'Remove',
                danger: true,
              });
              if (!ok) return;
              try {
                await cloud.unshareProject(projectId, member.userId);
                refresh();
              } catch (err) {
                toast({ tone: 'bad', title: 'Could not remove', message: err.message });
              }
            },
          })
        : null,
    ].filter(Boolean));
  }

  async function invite() {
    const email = emailInput.value.trim();
    if (!email) return;
    try {
      await cloud.shareProject(projectId, email, inviteRole);
      emailInput.value = '';
      toast({
        tone: 'good',
        title: 'Shared',
        message: `${email} now has ${inviteRole === 'viewer' ? 'view-only' : inviteRole} access.`,
      });
      refresh();
    } catch (err) {
      toast({ tone: 'bad', title: 'Could not share', message: err.message });
    }
  }

  if (owner) {
    const roleSelect = selectInput({
      value: inviteRole,
      options: ROLE_OPTIONS,
      onChange: (v) => { inviteRole = v; },
    });
    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        invite();
      }
    });

    body.append(
      el('div', {}, [
        field('Invite by email', emailInput, 'They need a CX Timeline account already — sharing does not send an invitation email.'),
        field('Access level', roleSelect),
        el('button', {
          class: 'cx-btn primary mini',
          html: icon('plus', { size: 12 }) + '<span>Grant access</span>',
          onClick: invite,
        }),
      ])
    );
  } else {
    body.appendChild(
      el('div', { class: 'cx-hint', text: 'Only the project owner can change who has access.' })
    );
  }

  body.append(el('div', { class: 'cx-section-label', text: 'People with access' }), list);
  refresh();

  return openModal({
    title: projectName ? `Share "${projectName}"` : 'Share project',
    subtitle: 'Access is enforced by the database, not the interface.',
    body,
    actions: [{ label: 'Done', kind: 'primary' }],
  });
}
