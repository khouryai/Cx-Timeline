/**
 * Organisation — the roster, locations, categories and leave.
 *
 * Reference data before transactional data: nothing else in the calendar means
 * anything until there are people to schedule and places to send them.
 *
 * Two decisions run through it. **Nobody is ever deleted** — a leaver's history
 * has to stay for the reports while they drop out of every picker, so `active`
 * is the only thing that changes. And **every vocabulary is a table**, because
 * the reports group by them and "doc" typed one week against "documentation"
 * the next are two categories to a database and one to a person.
 *
 * Imports: util, events, dates, rc, icons, components, rc_util.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import {
  textInput, selectInput, toast, confirmDialog, promptDialog, field, badge,
} from './components.js';
import { notifyChanged, byId, dayLabel, todayISO, formModal } from './rc_util.js';

const SECTIONS = ['people', 'locations', 'categories', 'leave'];
let section = 'people';

export async function render(root) {
  const nav = el('div', { class: 'rc-tabs', style: 'margin:0 0 16px' });
  for (const id of SECTIONS) {
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
    el('td', {}, [
      p.role === 'admin' ? badge('Admin', 'info') : badge('Member', 'muted'),
    ]),
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
    ] : []),
  ]));

  host.appendChild(table(['Name', 'Title', 'Subsystem', 'Role', 'Days', ''], rows));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Retiring somebody keeps every outcome they ever recorded. Nobody is deleted, '
      + 'because the reports would lose their history with them.',
  }));
}

function editPerson(person) {
  const name = textInput({ value: person?.name || '', placeholder: 'Full name' });
  const email = textInput({ value: person?.email || '', placeholder: 'you@example.com', type: 'email' });
  const title = textInput({ value: person?.title || '', placeholder: 'Test Engineer' });
  const subsystem = textInput({ value: person?.subsystem || '', placeholder: 'ATS / IXL / SCADA' });
  const role = selectInput({
    value: person?.role || 'member',
    options: [
      { value: 'member', label: 'Member — records their own outcomes' },
      { value: 'admin', label: 'Administrator — plans, and sees the KPIs' },
    ],
  });

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
      field('Role', role),
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
        role: role.value,
        working_days: working,
      };
      if (!patch.name) throw new Error('A name is needed.');
      if (person) await rc.updatePerson(person.id, patch);
      else await rc.addPerson(patch);
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
