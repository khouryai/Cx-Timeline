/**
 * Organisation — the roster, locations, categories and leave.
 *
 * Reference data before transactional data: nothing else in the calendar means
 * anything until there are people to schedule and places to send them.
 *
 * Two decisions run through it. **Nothing anybody has used is ever deleted** —
 * a leaver's history has to stay for the reports while they drop out of every
 * picker, which is what Retire does and why it is the first answer offered.
 * Delete is the second, and it is for the row that was never meant: somebody
 * added twice, a location typed wrong. Postgres decides which is which —
 * `rc_delete_person()` and its siblings count what points at the row and refuse
 * with the number — because only the database can see everything that does.
 * And **every vocabulary is a table**, because the reports group by them and
 * "doc" typed one week against "documentation" the next are two categories to a
 * database and one to a person.
 *
 * Imports: util, events, dates, rc, icons, components, rc_util.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import {
  textInput, selectInput, toast, confirmDialog, promptDialog, field, badge, checkbox, emptyState,
} from './components.js';
import { notifyChanged, byId, dayLabel, todayISO, formModal } from './rc_util.js';

const SECTIONS = ['people', 'locations', 'categories', 'leave', 'accounts', 'problems'];
// Readable by an administrator alone, in the policies as well as here.
const ADMIN_SECTIONS = new Set(['accounts', 'problems']);
let section = 'people';

/**
 * The three roles, in one place, worded as the consequence rather than the
 * name. Somebody choosing between them is deciding what a colleague can do,
 * not picking a label, and "viewer" on its own does not say that a viewer
 * cannot even record their own day.
 */
const ROLES = [
  { value: 'viewer', label: 'Viewer — reads the schedule, writes nothing' },
  { value: 'member', label: 'Member — records their own daily outcomes' },
  { value: 'admin', label: 'Administrator — plans, and sees the KPIs' },
];

// Only the administrator badge is coloured. A member and a viewer are both
// ordinary states, and the word is the information — tinting one of them would
// read as a warning about somebody who is simply on the team.
const ROLE_TONE = { admin: 'info', member: 'neutral', viewer: 'neutral' };

/**
 * The Delete button that sits beside Retire.
 *
 * It asks first, and then it lets the database answer. Nothing here works out
 * whether a row is safe to remove: the interface cannot see every table that
 * might point at it, and a check written twice is a check that will one day
 * disagree with itself. The refusal Postgres raises already names the number of
 * records in the way and says to retire instead, so it is shown as it comes.
 */
function deleteButton({ label, message, run, after }) {
  return el('button', {
    class: 'cx-btn mini ghost danger',
    text: 'Delete',
    title: 'Removes it for good. Refused, with a count, if anything has been recorded against it '
      + '— retire it in that case, which keeps the history.',
    onClick: async () => {
      const ok = await confirmDialog({
        title: label,
        message,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try {
        await run();
        toast({ tone: 'good', message: 'Deleted.' });
        notifyChanged(after);
      } catch (err) {
        toast({ tone: 'bad', message: err?.message || String(err) });
      }
    },
  });
}

export async function render(root) {
  // Accounts is administrators-only in the database — `rc_list_invitations()`
  // returns nothing to anybody else — so a viewer is offered a tab that opens
  // onto a wall. It comes out of the row rather than explaining itself.
  const visible = rc.isAdmin() ? SECTIONS : SECTIONS.filter((id) => !ADMIN_SECTIONS.has(id));
  if (!visible.includes(section)) section = visible[0];

  const nav = el('div', { class: 'rc-tabs', style: 'margin:0 0 16px' });
  for (const id of visible) {
    nav.appendChild(el('button', {
      class: 'rc-tab',
      type: 'button',
      text: id[0].toUpperCase() + id.slice(1),
      'aria-pressed': String(id === section),
      onClick: () => {
        section = id;
        clear(root);
        render(root);
      },
    }));
  }
  root.appendChild(nav);

  const host = el('div');
  root.appendChild(host);

  if (section === 'people') await renderPeople(host);
  else if (section === 'locations') await renderLocations(host);
  else if (section === 'categories') await renderCategories(host);
  else if (section === 'accounts') await renderAccounts(host);
  else if (section === 'problems') await renderProblems(host);
  else await renderLeave(host);
}

/* ── People ────────────────────────────────────────────────────────────── */

async function renderPeople(host) {
  const people = await rc.listPeople({ includeInactive: true });
  const admin = rc.isAdmin();

  host.appendChild(sectionHead('Team', admin ? {
    label: 'Add person',
    onClick: () => editPerson(null),
  } : null));

  if (!people.length) {
    host.appendChild(el('p', { class: 'rc-hint', text: 'Nobody on the team yet.' }));
    return;
  }

  const rows = people.map((p) => el('tr', { class: p.active ? '' : 'rc-inactive' }, [
    el('td', {}, [
      el('div', { text: p.name }),
      p.email ? el('div', { class: 'rc-hint', text: p.email }) : null,
    ].filter(Boolean)),
    el('td', { text: p.title || '—' }),
    el('td', { text: p.subsystem || '—' }),
    el('td', {}, [roleBadge(p.role)]),
    el('td', {}, [p.scheduled === false ? badge('Not scheduled', 'neutral') : badge('Scheduled', 'good')]),
    // A four-day contract is a fact the scheduler needs, and showing it here is
    // what stops somebody being planned onto a Friday they never work.
    el('td', { class: 'rc-num', text: (p.working_days || []).length + '/wk' }),
    el('td', {}, admin ? [
      el('button', {
        class: 'cx-btn mini ghost', text: 'Edit', onClick: () => editPerson(p),
      }),
      el('button', {
        class: 'cx-btn mini ghost',
        text: p.active ? 'Retire' : 'Restore',
        title: p.active
          ? 'Removes them from every picker. Their history stays — the reports still need it.'
          : 'Puts them back in the pickers.',
        onClick: async () => {
          await rc.updatePerson(p.id, { active: !p.active });
          notifyChanged('people');
        },
      }),
      deleteButton({
        label: `Delete ${p.name}?`,
        message: 'Their aliases and any leave booked for them go too. If anything has been '
          + 'planned or recorded against them this is refused, and retiring them is the answer '
          + '— that keeps every outcome and takes them out of the pickers just the same.',
        run: () => rc.deletePerson(p.id),
        after: 'people',
      }),
    ] : []),
  ]));

  host.appendChild(table(['Name', 'Title', 'Subsystem', 'Role', 'In the huddle', 'Days', ''], rows));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Retiring somebody keeps every outcome they ever recorded, which is why it is the first '
      + 'answer for anybody who has been here. Delete is for a row that was never meant — the same '
      + 'person added twice — and the database refuses it, with a count, the moment anything has '
      + 'been planned or recorded against them. "In the huddle" is a separate question '
      + 'from what somebody may do: a manager administers the calendar without being assigned to '
      + 'a location, and an administrator who does take shifts stays in the meeting.',
  }));
}

function editPerson(person) {
  const name = textInput({ value: person?.name || '', placeholder: 'Full name' });
  const email = textInput({ value: person?.email || '', placeholder: 'you@example.com', type: 'email' });
  const title = textInput({ value: person?.title || '', placeholder: 'Test Engineer' });
  const subsystem = textInput({ value: person?.subsystem || '', placeholder: 'ATS / IXL / SCADA' });
  const role = selectInput({ value: person?.role || 'member', options: ROLES });
  /* Whether they are scheduled, kept apart from what they may do. A manager
     administers the calendar and is never assigned to a location; an
     administrator who does take shifts must not drop out of the meeting
     because of their permissions. */
  const scheduled = checkbox({
    label: 'Takes shifts — appears in the daily huddle and the week plan',
    checked: person ? person.scheduled !== false : true,
  });
  if (!person) {
    /* A suggestion for somebody new, not a rule: an administrator is usually
       the person running the meeting. It stays a switch, because the two facts
       are separate and somebody has to be able to say so. */
    role.addEventListener('change', () => {
      scheduled.querySelector('input').checked = role.value !== 'admin';
    });
  }

  // Which days they work at all. Scheduling somebody onto a day they do not
  // work is the same class of mistake as scheduling them while on leave, and
  // both are caught from this one field.
  const days = [1, 2, 3, 4, 5, 6, 7].map((n) => {
    const set = new Set(person?.working_days || [1, 2, 3, 4, 5]);
    const box = el('input', { type: 'checkbox', checked: set.has(n) });
    box.dataset.day = String(n);
    return el('label', { class: 'cx-check', style: 'margin-right:10px' }, [
      box, el('span', { text: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][n - 1] }),
    ]);
  });
  const daysWrap = el('div', {}, days);

  formModal({
    title: person ? 'Edit person' : 'Add person',
    body: el('div', { class: 'cx-form' }, [
      field('Name', name),
      field('Email', email, 'Only needed if they will sign in. Scheduling somebody never requires an account.'),
      field('Title', title),
      field('Subsystem', subsystem),
      field('Role', role, 'What they may do once they have an account. It changes nothing '
        + 'until one exists — scheduling somebody never requires a login.'),
      field('Scheduling', scheduled, 'Turn this off for somebody who runs the meeting rather '
        + 'than taking work from it. They keep every permission they had.'),
      field('Working days', daysWrap),
    ]),
    confirmLabel: person ? 'Save' : 'Add',
    onConfirm: async () => {
      const working = [...daysWrap.querySelectorAll('input:checked')].map((b) => Number(b.dataset.day));
      const patch = {
        name: name.value.trim(),
        email: email.value.trim() || null,
        title: title.value.trim() || null,
        subsystem: subsystem.value.trim() || null,
        scheduled: scheduled.querySelector('input').checked,
        working_days: working,
      };
      if (!patch.name) throw new Error('A name is needed.');
      if (person) {
        await rc.updatePerson(person.id, patch);
        // The role goes through `rc_set_role()` rather than in the patch, so
        // the last-administrator guard applies. A plain UPDATE that a policy
        // refuses matches nothing and reports success — the demotion that
        // leaves nobody able to administer anything is exactly the one that
        // must not be reported as having worked.
        if (role.value !== person.role) await changeRole(person, role.value);
      } else {
        await rc.addPerson({ ...patch, role: role.value });
      }
      notifyChanged('people');
      toast({ message: person ? `${patch.name} updated.` : `${patch.name} added.` });
    },
  });
}

/* ── Locations ─────────────────────────────────────────────────────────── */

async function renderLocations(host) {
  const [locations, aliases] = await Promise.all([
    rc.listLocations({ includeInactive: true }),
    rc.listLocationAliases(),
  ]);
  const admin = rc.isAdmin();
  const byLocation = new Map();
  for (const a of aliases) {
    if (!byLocation.has(a.location_id)) byLocation.set(a.location_id, []);
    byLocation.get(a.location_id).push(a.alias);
  }

  host.appendChild(sectionHead('Locations', admin ? {
    label: 'Add location',
    onClick: async () => {
      const name = await promptDialog({ title: 'Add location', label: 'Name', confirmLabel: 'Add' });
      if (!name) return;
      await rc.addLocation({ name: name.trim() });
      notifyChanged('locations');
    },
  } : null));

  const rows = locations.map((l) => el('tr', { class: l.active ? '' : 'rc-inactive' }, [
    el('td', { text: l.name }),
    el('td', { text: l.code || '—' }),
    el('td', {}, [
      el('div', { class: 'rc-hint', text: (byLocation.get(l.id) || []).join(', ') || 'no other spellings' }),
    ]),
    el('td', {}, admin ? [
      el('button', {
        class: 'cx-btn mini ghost',
        text: 'Rename',
        title: 'Every alias, SAR and look-ahead row stays pointed at it — only the name changes.',
        onClick: async () => {
          const name = await promptDialog({
            title: `Rename ${l.name}`,
            label: 'Name',
            value: l.name,
            confirmLabel: 'Rename',
          });
          if (!name || name.trim() === l.name) return;
          await rc.updateLocation(l.id, { name: name.trim() });
          notifyChanged('locations');
        },
      }),
      el('button', {
        class: 'cx-btn mini ghost',
        text: l.active ? 'Retire' : 'Restore',
        title: l.active
          ? 'Drops it from every picker. Everything already recorded against it stays.'
          : 'Puts it back in the pickers.',
        onClick: async () => {
          await rc.updateLocation(l.id, { active: !l.active });
          notifyChanged('locations');
        },
      }),
      deleteButton({
        label: `Delete ${l.name}?`,
        message: 'Its other spellings go with it. If any plan, outcome, look-ahead row or SAR '
          + 'names this place the delete is refused — retire it instead, which drops it from the '
          + 'pickers and keeps everything already recorded there.',
        run: () => rc.deleteLocation(l.id),
        after: 'locations',
      }),
      el('button', {
        class: 'cx-btn mini ghost',
        text: 'Add spelling',
        title: 'Another way this place is written in the look-ahead or on a SAR.',
        onClick: async () => {
          const alias = await promptDialog({
            title: `Another spelling for ${l.name}`,
            label: 'As it appears in the look-ahead or the SAR',
            confirmLabel: 'Add',
          });
          if (!alias) return;
          await rc.addLocationAlias(l.id, alias.trim());
          notifyChanged('locations');
        },
      }),
    ] : []),
  ]));

  host.appendChild(table(['Location', 'Code', 'Also written as', ''], rows));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Every match against the look-ahead and the SARs keys on location, never on '
      + 'activity text — the descriptions are not reliable enough to carry evidence. '
      + 'So a place written "TPSS 12" in one and "Traction Power 12" in the other needs '
      + 'both spellings here, or the match silently fails on exactly the rows that matter. '
      + 'Case and punctuation are folded automatically; wording is not.',
  }));
}

/* ── Categories and parties ────────────────────────────────────────────── */

async function renderCategories(host) {
  const [categories, parties] = await Promise.all([
    rc.listCategories({ includeInactive: true }),
    rc.listParties(),
  ]);
  const admin = rc.isAdmin();

  host.appendChild(sectionHead('Task categories', admin ? {
    label: 'Add category',
    onClick: async () => {
      const name = await promptDialog({ title: 'Add category', label: 'Name', confirmLabel: 'Add' });
      if (!name) return;
      await rc.addCategory({ name: name.trim(), sort: (categories.length + 1) * 10 });
      notifyChanged('categories');
    },
  } : null));

  host.appendChild(table(['Category', ''], categories.map((c) => el('tr', {
    class: c.active ? '' : 'rc-inactive',
  }, [
    el('td', { text: c.name }),
    el('td', {}, admin ? [
      el('button', {
        class: 'cx-btn mini ghost',
        text: c.active ? 'Retire' : 'Restore',
        onClick: async () => {
          await rc.updateCategory(c.id, { active: !c.active });
          notifyChanged('categories');
        },
      }),
      deleteButton({
        label: `Delete ${c.name}?`,
        message: 'Refused if anything has been grouped under it, because the reports would lose '
          + 'the grouping with it. Retiring takes it out of the pickers and leaves every rollup '
          + 'reading as it does today.',
        run: () => rc.deleteCategory(c.id),
        after: 'categories',
      }),
    ] : []),
  ]))));

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Categories are a table rather than free text because every rollup groups by '
      + 'them. "Doc" one week and "Documentation" the next would be two categories to '
      + 'the database and one to everybody reading the report.',
  }));

  host.appendChild(el('div', { style: 'height:24px' }));
  host.appendChild(sectionHead('Responsible parties', admin ? {
    label: 'Add party',
    onClick: async () => {
      const name = await promptDialog({ title: 'Add party', label: 'Name', confirmLabel: 'Add' });
      if (!name) return;
      await rc.addParty(name.trim());
      notifyChanged('parties');
    },
  } : null));

  host.appendChild(table(['Party'], parties.map((p) => el('tr', {}, [el('td', { text: p.name })]))));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Who a block or a cancellation is down to. A table for the same reason, and a '
      + 'sharper one: "blocked by BART" is a number somebody may eventually have to defend.',
  }));
}

/* ── Leave ─────────────────────────────────────────────────────────────── */

async function renderLeave(host) {
  const today = todayISO();
  const [people, kinds, leave] = await Promise.all([
    rc.listPeople(),
    rc.listLeaveKinds(),
    // A year either side: enough to see the balance and what is booked ahead.
    rc.listLeave(`${today.slice(0, 4)}-01-01`, `${Number(today.slice(0, 4)) + 1}-12-31`),
  ]);
  const admin = rc.isAdmin();
  const peopleById = byId(people);
  const kindsById = byId(kinds);

  host.appendChild(sectionHead('Leave', admin ? {
    label: 'Book leave',
    onClick: () => bookLeave(people, kinds),
  } : null));

  if (!leave.length) {
    host.appendChild(el('p', { class: 'rc-hint', text: 'Nothing booked.' }));
  } else {
    const sorted = [...leave].sort((a, b) => a.start_date.localeCompare(b.start_date));
    host.appendChild(table(
      ['Person', 'From', 'To', 'Kind', 'Status', ''],
      sorted.map((l) => el('tr', {}, [
        el('td', { text: peopleById.get(l.person_id)?.name || '—' }),
        el('td', { text: dayLabel(l.start_date) }),
        el('td', { text: dayLabel(l.end_date) }),
        el('td', { text: kindsById.get(l.kind_id)?.name || '—' }),
        el('td', {}, [badge(l.status, l.status === 'approved' ? 'good' : 'muted')]),
        el('td', {}, admin && l.status !== 'cancelled' ? [
          el('button', {
            class: 'cx-btn mini ghost',
            text: 'Cancel',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Cancel this leave?',
                message: 'It stays on the record as cancelled rather than disappearing.',
                confirmLabel: 'Cancel leave',
              });
              if (!ok) return;
              await rc.updateLeave(l.id, { status: 'cancelled' });
              notifyChanged('leave');
            },
          }),
        ] : []),
      ]))
    ));
  }

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Leave is why the huddle can tell "away" apart from "carried over". Without it, '
      + 'somebody being off gets quietly spread across the performance statuses and their '
      + 'numbers suffer for a week they were not even there.',
  }));
}

function bookLeave(people, kinds) {
  const person = selectInput({
    value: people[0]?.id,
    options: people.map((p) => ({ value: p.id, label: p.name })),
  });
  const from = el('input', { type: 'date', class: 'cx-input' });
  const to = el('input', { type: 'date', class: 'cx-input' });
  const kind = selectInput({
    value: kinds[0]?.id,
    options: kinds.map((k) => ({ value: k.id, label: k.name })),
  });
  const note = textInput({ placeholder: 'Optional' });

  formModal({
    title: 'Book leave',
    body: el('div', { class: 'cx-form' }, [
      field('Person', person),
      field('From', from),
      field('To', to, 'Inclusive, as a calendar is.'),
      field('Kind', kind),
      field('Note', note),
    ]),
    confirmLabel: 'Book',
    onConfirm: async () => {
      if (!from.value || !to.value) throw new Error('Both dates are needed.');
      if (to.value < from.value) throw new Error('The end is before the start.');
      await rc.addLeave({
        person_id: person.value,
        start_date: from.value,
        end_date: to.value,
        kind_id: kind.value,
        note: note.value.trim() || null,
      });
      notifyChanged('leave');
      toast({ message: 'Leave booked.' });
    },
  });
}

/* ── Accounts ──────────────────────────────────────────────────────────── */

/**
 * The link to send somebody.
 *
 * Nothing is emailed from here, and that is a limitation rather than a choice:
 * the application has no server of its own and a browser cannot send mail. So
 * it produces the link and you send it however you already talk to people —
 * which in practice beats an email that a corporate scanner opens before they
 * do, burning the token on the way past.
 *
 * The address rides along so somebody following it lands on the create-account
 * form with the right one of their addresses already in it. It is not a
 * credential: the database still refuses anybody who was not invited, so a
 * forwarded link gets a stranger precisely nowhere.
 */
function joinLink(email) {
  /* Where the person is being invited *to*, which is not always where this
     window is running.
     Inside the desktop shell `location.origin` is `tauri.localhost` — the
     application's own internal address — so an invitation generated from the
     installed app copied a link that means nothing in anybody else's browser,
     and the only way to find that out was to send it to somebody. The shell
     knows the deployment it follows for updates, and that deployment is the
     site being joined. In a browser there is no shell and the address bar is
     already the right answer. */
  const channel = String(window.CX_SHELL?.channel || '').replace(/\/+$/, '');
  const base = channel ? `${channel}/` : window.location.origin + window.location.pathname;
  return `${base}#join=${encodeURIComponent(String(email || '').trim())}`;
}

/**
 * True when the link we would produce is one nobody else can open.
 *
 * Only reachable in a desktop build with no update channel configured: there
 * is no deployment to point at and `tauri.localhost` is not one. Saying so
 * beats copying something broken to the clipboard.
 */
function linkIsLocal() {
  return !window.CX_SHELL?.channel && /^tauri\.localhost$/i.test(window.location.hostname);
}

async function copyJoinLink(email) {
  if (linkIsLocal()) {
    toast({
      tone: 'warn',
      title: 'This build has no site to link to',
      message: `${email} is invited and can sign up on the deployed site — but this desktop `
        + 'build has no update channel configured, so there is no address to send them.',
      timeout: 12000,
    });
    return;
  }
  const link = joinLink(email);
  try {
    await navigator.clipboard.writeText(link);
    toast({ tone: 'good', message: `Link for ${email} copied — send it however you like.` });
  } catch {
    // A denied clipboard is not a failure to produce the link. Show it so it
    // can be copied by hand rather than reporting nothing happened.
    await promptDialog({
      title: `Invitation link for ${email}`,
      label: 'Copy this and send it to them',
      value: link,
      confirmLabel: 'Done',
    });
  }
}

/**
 * Who may sign in, and what they may do once they have.
 *
 * The whole point of this section is that adding somebody to the team never
 * needs the SQL editor. An administrator invites an address, the person signs
 * up, and the trigger attaches the new account to the roster row the
 * invitation named with the role it carried — so by the time they first open
 * the calendar they are already on the team with the right permissions.
 *
 * Supabase Auth still holds the password, and that is deliberate rather than a
 * gap: `auth.uid()` is what every policy in the schema keys on, so the
 * permission model *is* the authentication. What is managed from here is the
 * part that is genuinely ours — who is allowed an account at all, which person
 * it belongs to, and what that person may do.
 */
async function renderAccounts(host) {
  const [people, invitations] = await Promise.all([
    rc.listPeople({ includeInactive: true }),
    rc.listInvitations(),
  ]);

  host.appendChild(sectionHead('Accounts', {
    label: 'Invite somebody',
    onClick: () => invitePerson(people),
  }));

  const withAccount = people.filter((p) => p.user_id);
  const without = people.filter((p) => !p.user_id && p.active);

  host.appendChild(table(
    ['Person', 'Signs in as', 'Role', ''],
    people.filter((p) => p.active || p.user_id).map((p) => el('tr', {
      class: p.active ? '' : 'rc-inactive',
    }, [
      el('td', { text: p.name }),
      el('td', {}, p.user_id
        ? [el('span', { text: p.email || 'account linked' })]
        : [el('span', { class: 'rc-hint', text: 'no account — scheduled only' })]),
      el('td', {}, [
        // The role is live rather than behind a dialog: this is the table
        // somebody opens *because* they want to change one.
        selectInput({
          value: p.role,
          options: ROLES,
          mini: true,
          onChange: async (value) => {
            try {
              await changeRole(p, value);
              notifyChanged('people');
              toast({ message: `${p.name} is now ${roleWord(value)}.` });
            } catch (err) {
              toast({ message: err.message, tone: 'bad' });
              notifyChanged('people');
            }
          },
        }),
      ]),
      el('td', {}, p.user_id ? [] : [
        el('button', {
          class: 'cx-btn mini ghost',
          text: 'Link account',
          title: 'Point an address at this row. It works before they have signed up: an open '
            + 'invitation is aimed here instead, and the account lands on this row when it exists.',
          onClick: () => linkAccount(p, people),
        }),
      ]),
    ]))
  ));

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: `${withAccount.length} of ${withAccount.length + without.length} people can sign in. `
      + 'The rest are scheduled without an account, which is the normal case for the '
      + 'field team — being on the roster must never require a login.',
  }));

  /* ── Pending ─────────────────────────────────────────────────────────── */

  host.appendChild(el('div', { style: 'height:24px' }));
  host.appendChild(sectionHead('Pending invitations', null));

  if (!invitations.length) {
    host.appendChild(el('p', { class: 'rc-hint', text: 'Nobody is waiting to join.' }));
  } else {
    const peopleById = byId(people);
    host.appendChild(table(
      ['Address', 'Role', 'For', 'Sent', 'Expires', ''],
      invitations.map((inv) => el('tr', {}, [
        el('td', { text: inv.pending_email }),
        el('td', {}, [roleBadge(inv.pending_role)]),
        el('td', {
          text: peopleById.get(inv.pending_person)?.name || 'a new team record',
        }),
        el('td', { text: dayLabel(inv.pending_created.slice(0, 10)) }),
        el('td', {}, [
          inv.pending_expired
            ? badge('Expired', 'bad')
            : el('span', { text: dayLabel(inv.pending_expires.slice(0, 10)) }),
        ]),
        el('td', {}, [
          el('button', {
            class: 'cx-btn mini',
            text: 'Copy link',
            title: 'The link that takes them to the create-account form with their address in it.',
            onClick: () => copyJoinLink(inv.pending_email),
          }),
          el('button', {
            class: 'cx-btn mini ghost',
            text: inv.pending_expired ? 'Send again' : 'Revoke',
            onClick: async () => {
              if (inv.pending_expired) {
                await rc.invite(inv.pending_email, inv.pending_role, inv.pending_person, inv.pending_note);
                toast({ message: `${inv.pending_email} invited again.` });
              } else {
                const ok = await confirmDialog({
                  title: `Revoke the invitation to ${inv.pending_email}?`,
                  message: 'They will not be able to create an account until they are invited again.',
                  confirmLabel: 'Revoke',
                  danger: true,
                });
                if (!ok) return;
                await rc.revokeInvitation(inv.pending_email);
                toast({ message: 'Invitation revoked.' });
              }
              notifyChanged('invitations');
            },
          }),
        ]),
      ]))
    ));
  }

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Sign-up is closed: an address that was never invited is refused by the database, not '
      + 'by hiding a form — so the link is a convenience, not a key, and forwarding it gets a '
      + 'stranger nowhere. Nothing is emailed from here; the application has no server of its '
      + 'own. Send the link however you already talk to people, which also sidesteps the '
      + 'corporate mail scanner that opens a confirmation link before the person does. '
      + 'Invitations lapse after thirty days, and inviting somebody again reopens the one that '
      + 'lapsed.',
  }));
}

function invitePerson(people) {
  const email = textInput({ placeholder: 'them@example.com', type: 'email' });
  const role = selectInput({ value: 'viewer', options: ROLES });
  const free = people.filter((p) => !p.user_id && p.active);
  const person = selectInput({
    value: '',
    options: [
      { value: '', label: 'Create a new team record for them' },
      ...free.map((p) => ({ value: p.id, label: p.name })),
    ],
  });
  const note = textInput({ placeholder: 'Optional — what they do' });

  formModal({
    title: 'Invite somebody',
    body: el('div', { class: 'cx-form' }, [
      field('Email', email, 'The address they will sign in with. Nothing is sent from here — '
        + 'send the invitation from Supabase, or just tell them to sign up.'),
      field('Role', role),
      field('Team record', person, 'Attach the account to somebody already on the roster, '
        + 'so their history and their login are the same person.'),
      field('Note', note),
    ]),
    confirmLabel: 'Invite',
    onConfirm: async () => {
      const address = email.value.trim();
      if (!address) throw new Error('An email address is needed.');
      await rc.invite(address, role.value, person.value || null, note.value.trim() || null);
      notifyChanged('invitations');
      await copyJoinLink(address);
    },
  });
}

/**
 * Point an address at a roster row.
 *
 * Three outcomes, and only one of them used to be handled. The account exists
 * and is linked; the address is *invited* and has not signed up yet, in which
 * case the invitation is aimed at this row and the trigger finishes the job when
 * they arrive; or there is neither, which is the only case where there is
 * genuinely nothing to do — so that is the only case that refuses, and it offers
 * the invitation rather than just saying no.
 *
 * The middle one is why this changed. "no account exists for them@example.com —
 * invite them first" was the commonest answer by a wide margin and it was wrong:
 * they *had* been invited, and there was nothing the administrator could do
 * about the rest. A refusal that names no action the reader can take reads as a
 * broken button.
 */
function linkAccount(person, people) {
  const email = textInput({ value: person.email || '', placeholder: 'them@example.com', type: 'email' });
  formModal({
    title: `Link an account to ${person.name}`,
    body: el('div', { class: 'cx-form' }, [
      field('Email', email, 'The address they sign in with. It does not have to exist yet — if it '
        + 'has been invited and they have not signed up, the invitation is pointed at '
        + `${person.name} instead and the account lands on this row the moment they do.`),
    ]),
    confirmLabel: 'Link',
    onConfirm: async () => {
      const address = email.value.trim();
      if (!address) throw new Error('An email address is needed.');
      let linked;
      try {
        linked = await rc.linkAccount(person.id, address);
      } catch (err) {
        /* Nothing to link and nothing on its way. The next step is an
           invitation, so offer it rather than making somebody find the button. */
        if (/no account and no open invitation/i.test(err.message)) {
          throw new Error(`${address} has no account and no open invitation. Close this and use `
            + '"Invite somebody" — pick this person as the team record, and their account will '
            + 'attach to it when they sign up.');
        }
        throw err;
      }
      notifyChanged('people');
      toast({
        tone: 'good',
        message: linked
          ? `${address} now signs in as ${person.name}.`
          : `${address} is invited but has not signed up yet — the invitation now points at `
            + `${person.name}, and the account will attach to this row when they do.`,
        timeout: linked ? undefined : 10000,
      });
    },
  });
}

/**
 * Change somebody's role, through the function rather than the table.
 *
 * `rc_set_role()` refuses the demotion that would leave nobody able to
 * administer anything — and refuses it by raising, because a plain UPDATE that
 * a policy excludes matches no rows and reports success. Changing your own
 * role then re-reads it, so the interface stops offering what the database has
 * already started refusing.
 */
async function changeRole(person, role) {
  await rc.setRole(person.id, role);
  if (person.id === rc.me()?.id) await rc.refreshMe();
}

function roleWord(role) {
  return role === 'admin' ? 'an administrator' : `a ${role}`;
}

function roleBadge(role) {
  const label = role ? role[0].toUpperCase() + role.slice(1) : '—';
  return badge(label === 'Admin' ? 'Administrator' : label, ROLE_TONE[role] || 'muted');
}

/* ── Problems ──────────────────────────────────────────────────────────── */

/**
 * What the calendar ran into, on whose screen, and when.
 *
 * Each of these used to be a toast on one person's screen and a console line
 * nobody saw, so the first anybody heard was "the huddle didn't save on
 * Tuesday". `rc.reportError()` writes a row from a handful of named places —
 * a tab that failed to load, an offline outcome the server refused, a read of
 * the look-ahead that went wrong — and this lists them. It holds no plan data
 * by construction: nothing on the timeline's side ever reports here.
 */
async function renderProblems(host) {
  const [rows, people] = await Promise.all([
    rc.listClientErrors(200),
    rc.listPeople({ includeInactive: true }),
  ]);
  const byAccount = new Map(people.filter((p) => p.user_id).map((p) => [p.user_id, p.name]));

  host.appendChild(sectionHead('Problems reported'));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Things the calendar could not do, as they happened on somebody\'s screen: a tab that did '
      + 'not load, an entry made offline that the database later refused, a look-ahead read that '
      + 'went wrong. Each is reported once per page load. Nothing from the timeline is ever sent here.',
  }));

  if (!rows.length) {
    host.appendChild(emptyState({
      iconName: 'check-circle',
      title: 'Nothing reported',
      message: 'When the calendar cannot do something on anybody\'s screen, it is listed here.',
    }));
    return;
  }

  const log = table(['When', 'Who', 'Where', 'What happened', 'Version'], rows.map((r) => el('tr', {}, [
    el('td', { class: 'rc-nowrap', text: new Date(r.created_at).toLocaleString(), dataset: { sort: r.created_at, csv: r.created_at } }),
    el('td', { text: byAccount.get(r.created_by) || (r.created_by ? 'An account not on the roster' : '—') }),
    el('td', { class: 'rc-mono', text: r.area }),
    el('td', { text: r.message }),
    el('td', { class: 'rc-mono', text: r.app_version || '—', title: r.user_agent || '' }),
  ])));
  log.querySelector('table').dataset.csv = 'calendar-problems';
  host.appendChild(log);

  const clearOlder = async (days, label) => {
    const before = new Date(Date.now() - days * 86400000).toISOString();
    const ok = await confirmDialog({
      title: label,
      message: days
        ? `Removes every problem reported more than ${days} days ago. They are not kept anywhere else.`
        : 'Removes every problem in the list. They are not kept anywhere else.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!ok) return;
    try {
      const n = await rc.clearClientErrors(before);
      toast({ tone: 'good', message: `Cleared ${n} problem${n === 1 ? '' : 's'}.` });
      notifyChanged('problems');
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
  };
  host.appendChild(el('div', { class: 'rc-actions', style: 'margin-top:12px;display:flex;gap:8px' }, [
    el('button', { class: 'cx-btn mini ghost', type: 'button', text: 'Clear older than 30 days',
      onClick: () => clearOlder(30, 'Clear older problems') }),
    el('button', { class: 'cx-btn mini ghost danger', type: 'button', text: 'Clear all',
      onClick: () => clearOlder(0, 'Clear every problem') }),
  ]));
}

/* ── Shared bits ───────────────────────────────────────────────────────── */

function sectionHead(title, action) {
  return el('div', { class: 'rc-section-head' }, [
    el('h3', { text: title }),
    action
      ? el('button', {
        class: 'cx-btn mini primary',
        html: icon('plus', { size: 12 }) + `<span>${action.label}</span>`,
        onClick: action.onClick,
      })
      : null,
  ].filter(Boolean));
}

function table(headers, rows) {
  return el('div', { class: 'rc-scroll' }, [
    el('table', { class: 'rc-table' }, [
      el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { text: h })))]),
      el('tbody', {}, rows),
    ]),
  ]);
}
