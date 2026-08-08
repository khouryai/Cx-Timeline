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
 * Imports: util, events, dates, cloud, icons, components.
 */

import { el, clear } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import * as cloud from '../core/cloud.js';
import * as filestore from '../core/filestore.js';
import { icon } from './icons.js';
import { fmtDate } from '../core/dates.js';
import {
  openModal,
  field,
  textInput,
  selectInput,
  section,
  skeleton,
  toast,
  badge,
  confirmDialog,
  emptyState,
} from './components.js';

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

    // Sign-up is not offered. An invited person arrives on a link carrying
    // their address, which is the only thing that reveals the form — and even
    // then the database refuses any address without a pending invitation, so
    // finding this URL achieves nothing on its own.
    const invited = invitedEmail();
    let mode = invited ? 'signup' : 'signin'; // signin | signup | reset

    const overlay = el('div', { class: 'cx-gate', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sign in' });
    const card = el('div', { class: 'cx-gate-card' });
    overlay.appendChild(card);

    const emailInput = textInput({ type: 'email', value: invited || '', placeholder: 'you@company.com' });
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
        signup: [
          'Set up your account',
          invited ? `You have been invited as ${invited}. Choose a password.` : 'Accounts are created by invitation.',
        ],
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
        // No "create an account": there is no self-service sign-up.
        links.append(
          el('span', { class: 'cx-hint', text: 'Access is by invitation.' }),
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
    // An invited person already has their address filled in; put them in the
    // field they actually have to complete.
    setTimeout(() => (invited ? nameInput : emailInput).focus(), 80);
  });
}

/**
 * The address on an invitation link, if this is one.
 *
 * The link is a convenience, not a credential — it reveals the form and
 * prefills the address, nothing more. Whether an account may be created is
 * decided by the database, which refuses any address without a pending
 * invitation however the request arrives.
 */
function invitedEmail() {
  const match = /[#&?]invite=([^&]+)/.exec(window.location.hash || '');
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return '';
  }
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
    // Two things can make a session read-only, and they are never both live:
    // a viewer role on a hosted project, or a colleague holding the pen on a
    // plan in a shared folder. Either way the interface says the same thing —
    // only the reason differs.
    const viewingFolder = filestore.isViewer();
    const readOnly = cloud.isReadOnly() || viewingFolder;
    document.body.classList.toggle('read-only', readOnly);
    renderBanner(readOnly, viewingFolder ? filestore.state().holder : '');
  };

  on(EV.ACCESS_CHANGED, apply);
  on(EV.AUTH_CHANGED, apply);
  on(EV.FILE_STATE, apply);

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

function renderBanner(readOnly, holder = '') {
  const existing = document.getElementById('cx-readonly-bar');
  if (!readOnly) {
    existing?.remove();
    return;
  }
  // The message can change while the bar is up — a colleague closing the plan
  // hands the pen over — so rebuild rather than bail out on an existing bar.
  existing?.remove();

  const message = holder
    ? `Read-only — ${holder} has this plan open. It becomes editable when they close it.`
    : 'Read-only — you have view access to this project.';

  const bar = el('div', { id: 'cx-readonly-bar', class: 'cx-readonly-bar', role: 'status' }, [
    el('span', { class: 'ro-icon', html: icon('eye', { size: 13 }) }),
    el('span', { text: message }),
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
   Team administration
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Who may have an account, and who administers the deployment.
 *
 * Sign-up is closed, so this pane is the only door in. Inviting writes a row
 * the database checks when the account is created — which is why an
 * invitation cannot be forged by anyone who finds the link, and why revoking
 * one actually stops the sign-up rather than merely hiding a button.
 */
export function paneTeam(root) {
  if (!cloud.isConfigured() || !cloud.isSignedIn()) {
    root.appendChild(
      emptyState({ iconName: 'users', title: 'Not available', message: 'Sign in to manage who has access.' })
    );
    return;
  }
  if (!cloud.isAdmin()) {
    root.appendChild(
      emptyState({
        iconName: 'shield',
        title: 'Administrators only',
        message: 'Accounts are created by invitation. Ask an administrator to invite someone.',
      })
    );
    return;
  }

  root.appendChild(el('div', { class: 'cx-hint', style: { marginBottom: '12px' },
    text: 'Nobody can create an account unless their address is invited here — the database refuses the sign-up, not just the form.' }));

  /* ── Invite ────────────────────────────────────────────────────────────── */
  const emailInput = textInput({ type: 'email', value: '', placeholder: 'colleague@company.com' });
  const noteInput = textInput({ value: '', placeholder: 'Role or team (optional)' });

  const invite = async () => {
    const email = emailInput.value.trim();
    if (!email) return;
    try {
      const result = await cloud.inviteUser(email, 'editor', noteInput.value.trim());
      emailInput.value = '';
      noteInput.value = '';
      showInviteLink(result.email);
      refresh();
    } catch (err) {
      toast({ tone: 'bad', title: 'Could not invite', message: err.message });
    }
  };
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      invite();
    }
  });

  root.appendChild(
    section('Invite someone', [
      field('Email', emailInput),
      field('Note', noteInput, 'Only you see this — a reminder of who they are.'),
      el('button', {
        class: 'cx-btn mini primary',
        html: icon('plus', { size: 12 }) + '<span>Create invitation</span>',
        onClick: invite,
      }),
      el('div', { class: 'cx-hint', style: { marginTop: '8px' },
        text: 'No email is sent. You get a link to pass on however you like.' }),
    ])
  );

  const pending = el('div', { class: 'cx-list' });
  const accounts = el('div', { class: 'cx-list' });
  root.append(
    section('Pending invitations', [pending]),
    section('Accounts', [accounts])
  );

  async function refresh() {
    clear(pending);
    clear(accounts);
    pending.appendChild(skeleton(2));

    try {
      const [invites, people] = await Promise.all([cloud.listInvitations(), cloud.listAccounts()]);
      clear(pending);

      if (!invites.length) {
        pending.appendChild(el('div', { class: 'cx-hint', text: 'None outstanding.' }));
      } else {
        for (const invitation of invites) pending.appendChild(invitationRow(invitation));
      }
      for (const person of people) accounts.appendChild(accountRow(person));
    } catch (err) {
      clear(pending);
      pending.appendChild(el('div', { class: 'cx-gate-msg bad', text: err.message }));
    }
  }

  function invitationRow(invitation) {
    return el('div', { class: 'cx-listrow', dataset: { invite: invitation.email }, style: { cursor: 'default' } }, [
      el('span', { class: 'cx-dot', style: { background: invitation.expired ? 'var(--bad)' : 'var(--pending)' } }),
      el('div', { class: 'lr-main' }, [
        el('div', { class: 'lr-title', text: invitation.email }),
        el('div', { class: 'lr-meta', text: [
          invitation.note,
          invitation.expired ? 'expired' : `expires ${fmtDate(invitation.expires, 'medium')}`,
        ].filter(Boolean).join(' · ') }),
      ]),
      el('div', { class: 'lr-actions', style: { opacity: '1' } }, [
        el('button', {
          class: 'cx-btn icon mini ghost',
          title: 'Copy the invitation link',
          'aria-label': `Copy the invitation link for ${invitation.email}`,
          html: icon('copy', { size: 11 }),
          onClick: () => showInviteLink(invitation.email),
        }),
        el('button', {
          class: 'cx-btn icon mini ghost',
          title: 'Revoke',
          'aria-label': `Revoke the invitation for ${invitation.email}`,
          html: icon('trash', { size: 11 }),
          onClick: async () => {
            const ok = await confirmDialog({
              title: `Revoke ${invitation.email}?`,
              message: 'They will not be able to create an account with that address.',
              confirmLabel: 'Revoke',
              danger: true,
            });
            if (!ok) return;
            try {
              await cloud.revokeInvitation(invitation.email);
              refresh();
            } catch (err) {
              toast({ tone: 'bad', title: 'Could not revoke', message: err.message });
            }
          },
        }),
      ]),
    ]);
  }

  function accountRow(person) {
    return el('div', { class: 'cx-listrow', dataset: { account: person.id }, style: { cursor: 'default' } }, [
      el('div', { class: 'acc-avatar small', text: initials(person.name || person.email) }),
      el('div', { class: 'lr-main' }, [
        el('div', { class: 'lr-title', text: (person.name || person.email) + (person.isYou ? '  (you)' : '') }),
        el('div', { class: 'lr-meta', text: [
          person.email,
          `${person.projects} project${person.projects === 1 ? '' : 's'}`,
        ].join(' · ') }),
      ]),
      person.admin ? badge('Admin', 'good') : null,
      el('div', { class: 'lr-actions', style: { opacity: '1' } }, [
        el('button', {
          class: 'cx-btn mini ghost',
          text: person.admin ? 'Remove admin' : 'Make admin',
          onClick: async () => {
            try {
              await cloud.setAdmin(person.id, !person.admin);
              refresh();
            } catch (err) {
              toast({ tone: 'bad', title: 'Could not change', message: err.message });
            }
          },
        }),
      ]),
    ].filter(Boolean));
  }

  refresh();
}

/**
 * Show the link an invited person opens.
 *
 * A dialog rather than a silent clipboard write, because the link is the
 * whole deliverable of inviting someone — losing it silently would mean
 * revoking and re-inviting to get it back.
 */
function showInviteLink(email) {
  const link = cloud.inviteLink(email);
  const box = textInput({ value: link });
  box.readOnly = true;
  box.style.fontFamily = 'var(--f-mono)';
  box.style.fontSize = 'var(--fs-tiny)';

  openModal({
    title: 'Invitation created',
    subtitle: `${email} can now set up an account — and nobody else can.`,
    body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } }, [
      field('Send them this link', box, 'It expires in 30 days. Revoke it any time from the Team pane.'),
      el('button', {
        class: 'cx-btn mini',
        html: icon('copy', { size: 12 }) + '<span>Copy link</span>',
        onClick: async (e) => {
          try {
            await navigator.clipboard.writeText(link);
          } catch {
            // Clipboard access can be refused; selecting the text still works.
            box.select();
          }
          e.currentTarget.innerHTML = icon('check', { size: 12 }) + '<span>Copied</span>';
        },
      }),
    ]),
    actions: [{ label: 'Done', kind: 'primary' }],
  });

  setTimeout(() => box.select(), 60);
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
