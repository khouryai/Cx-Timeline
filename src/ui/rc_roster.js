/**
 * Lists — the roster, locations, parties, leave and the calendar's settings.
 *
 * Reference data before transactional data: nothing else in the calendar means
 * anything until there are people to schedule and places to send them.
 *
 * Two decisions run through it. **Nothing anybody has used is ever deleted** —
 * a leaver's history has to stay while they drop out of every picker, which is
 * what Retire does and why it is the first answer offered. Delete is the
 * second, and it is for the row that was never meant: somebody added twice, a
 * location typed wrong. The database decides which is which —
 * `rc_delete_location()` counts what points at the row and refuses with the
 * number. And **every vocabulary is a table**, because "T12" one week and
 * "TPSS 12" the next are two places to a computer and one to a person.
 *
 * Imports: util, rc, icons, components, rc_util, rc_settings.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import {
  textInput, selectInput, toast, confirmDialog, promptDialog, field, badge, checkbox,
} from './components.js';
import { notifyChanged, byId, dayLabel, todayISO, formModal, orgNav } from './rc_util.js';
import { renderSettings } from './rc_settings.js';

const SECTIONS = ['people', 'locations', 'parties', 'leave', 'settings'];
let section = null;

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
    onClick: safely(async () => {
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
    }),
  });
}

export async function render(root) {
  const visible = SECTIONS;
  if (orgNav.section) {
    section = orgNav.section;
    orgNav.section = null;
  }
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

  if (section === 'settings') await renderSettings(host);
  else if (section === 'people') await renderPeople(host);
  else if (section === 'locations') await renderLocations(host);
  else if (section === 'parties') await renderParties(host);
  else await renderLeave(host);
}

/* ── People ────────────────────────────────────────────────────────────── */

async function renderPeople(host) {
  const [people, aliases] = await Promise.all([
    rc.listPeople({ includeInactive: true }),
    rc.listPersonAliases().catch(() => []),
  ]);
  const admin = rc.isAdmin();
  const spellings = new Map();
  for (const a of aliases) {
    if (!spellings.has(a.person_id)) spellings.set(a.person_id, []);
    spellings.get(a.person_id).push(a.alias);
  }

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
    el('td', {}, [el('div', { class: 'rc-hint', text: (spellings.get(p.id) || []).join(', ') || 'no other spellings' })]),
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
        text: 'Add spelling',
        title: 'Another way their name is written on the look-ahead — "R. Okafor" for Rosa Okafor.',
        onClick: safely(async () => {
          const alias = await promptDialog({
            title: `Another spelling for ${p.name}`,
            label: 'As it appears on the look-ahead',
            confirmLabel: 'Add',
          });
          if (!alias || !alias.trim()) return;
          try {
            await rc.addPersonAlias(p.id, alias.trim());
            notifyChanged('people');
          } catch (err) {
            toast({ tone: 'bad', message: err?.message || String(err) });
          }
        }),
      }),
      el('button', {
        class: 'cx-btn mini ghost',
        text: p.active ? 'Retire' : 'Restore',
        title: p.active
          ? 'Removes them from every picker. Their history stays — the reports still need it.'
          : 'Puts them back in the pickers.',
        onClick: safely(async () => {
          await rc.updatePerson(p.id, { active: !p.active });
          notifyChanged('people');
        }),
      }),
      deleteButton({
        label: `Delete ${p.name}?`,
        message: 'Their aliases, any leave booked for them and their TAWR details go too. '
          + 'Retiring them instead keeps all of it and takes them out of the pickers just the same.',
        run: () => rc.deletePerson(p.id),
        after: 'people',
      }),
    ] : []),
  ]));

  host.appendChild(table(['Name', 'Title', 'Subsystem', 'Also written as', 'Takes shifts', 'Days', ''], rows));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Retiring somebody takes them out of every picker and keeps everything that names them, '
      + 'which is why it is the first answer for anybody who has been here. Delete is for a row that '
      + 'was never meant — the same person added twice — and takes their aliases, leave and TAWR '
      + 'details with them. Who you are in the calendar is the name set in the application, matched '
      + 'to this list.',
  }));
}

function editPerson(person) {
  const name = textInput({ value: person?.name || '', placeholder: 'Full name' });
  const email = textInput({ value: person?.email || '', placeholder: 'you@example.com', type: 'email' });
  const title = textInput({ value: person?.title || '', placeholder: 'Test Engineer' });
  const subsystem = textInput({ value: person?.subsystem || '', placeholder: 'ATS / IXL / SCADA' });
  /* Whether they are scheduled, kept apart from what they may do. A manager
     administers the calendar and is never assigned to a location; an
     administrator who does take shifts must not drop out of the meeting
     because of their permissions. */
  const scheduled = checkbox({
    label: 'Takes shifts — appears in the PTO calendar and the staffing checks',
    checked: person ? person.scheduled !== false : true,
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
      field('Email', email, 'For reference only — nobody signs in to the calendar.'),
      field('Title', title),
      field('Subsystem', subsystem),
      field('Scheduling', scheduled, 'Turn this off for somebody who manages rather than '
        + 'taking shifts.'),
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
      } else {
        await rc.addPerson(patch);
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
    onClick: safely(async () => {
      const name = await promptDialog({ title: 'Add location', label: 'Name', confirmLabel: 'Add' });
      if (!name) return;
      await rc.addLocation({ name: name.trim() });
      notifyChanged('locations');
    }),
  } : null));

  const rows = locations.map((l) => el('tr', { class: l.active ? '' : 'rc-inactive' }, [
    el('td', { text: l.name }),
    el('td', { text: l.code || '—' }),
    el('td', {}, [
      el('div', { class: 'rc-hint', text: (byLocation.get(l.id) || []).join(', ') || 'no other spellings' }),
    ]),
    el('td', {}, [
      el('div', { class: 'rc-hint', text: l.tawr_area || 'its name' }),
    ]),
    el('td', {}, admin ? [
      el('button', {
        class: 'cx-btn mini ghost',
        text: 'Rename',
        title: 'Every alias, TAWR and look-ahead row stays pointed at it — only the name changes.',
        onClick: safely(async () => {
          const name = await promptDialog({
            title: `Rename ${l.name}`,
            label: 'Name',
            value: l.name,
            confirmLabel: 'Rename',
          });
          if (!name || name.trim() === l.name) return;
          await rc.updateLocation(l.id, { name: name.trim() });
          notifyChanged('locations');
        }),
      }),
      el('button', {
        class: 'cx-btn mini ghost',
        text: l.active ? 'Retire' : 'Restore',
        title: l.active
          ? 'Drops it from every picker. Everything already recorded against it stays.'
          : 'Puts it back in the pickers.',
        onClick: safely(async () => {
          await rc.updateLocation(l.id, { active: !l.active });
          notifyChanged('locations');
        }),
      }),
      deleteButton({
        label: `Delete ${l.name}?`,
        message: 'Its other spellings go with it. If a look-ahead reading, a change or an approved '
          + 'TAWR names this place the delete is refused — retire it instead, which drops it from the '
          + 'pickers and keeps everything already recorded there.',
        run: () => rc.deleteLocation(l.id),
        after: 'locations',
      }),
      el('button', {
        class: 'cx-btn mini ghost',
        text: 'TAWR area',
        title: 'What a track access work request\'s Area column says for this place. Blank uses its name.',
        dataset: { action: 'tawr-area' },
        onClick: safely(async () => {
          const area = await promptDialog({
            title: `Area for ${l.name} on a TAWR`,
            label: 'Tracks, mileposts, gates or stations, as the form should say it',
            value: l.tawr_area || '',
            confirmLabel: 'Save',
          });
          if (area == null || area.trim() === (l.tawr_area || '')) return;
          try {
            await rc.updateLocation(l.id, { tawr_area: area.trim() || null });
            notifyChanged('locations');
          } catch (err) {
            toast({ tone: 'bad', message: err?.message || String(err) });
          }
        }),
      }),
      el('button', {
        class: 'cx-btn mini ghost',
        text: 'Add spelling',
        title: 'Another way this place is written in the look-ahead.',
        onClick: safely(async () => {
          const alias = await promptDialog({
            title: `Another spelling for ${l.name}`,
            label: 'As it appears in the look-ahead',
            confirmLabel: 'Add',
          });
          if (!alias) return;
          await rc.addLocationAlias(l.id, alias.trim());
          notifyChanged('locations');
        }),
      }),
    ] : []),
  ]));

  host.appendChild(table(['Location', 'Code', 'Also written as', 'TAWR area', ''], rows));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Every match against the look-ahead keys on location, never on activity text — the '
      + 'descriptions are not reliable enough to carry evidence. So a place written "TPSS 12" one '
      + 'week and "Traction Power 12" the next needs both spellings here. Case and punctuation are '
      + 'folded automatically; wording is not.',
  }));
}

/* ── Parties ───────────────────────────────────────────────────────────── */

async function renderParties(host) {
  const parties = await rc.listParties();
  const admin = rc.isAdmin();

  host.appendChild(sectionHead('Responsible parties', admin ? {
    label: 'Add party',
    onClick: safely(async () => {
      const name = await promptDialog({ title: 'Add party', label: 'Name', confirmLabel: 'Add' });
      if (!name) return;
      await rc.addParty(name.trim());
      notifyChanged('parties');
    }),
  } : null));

  host.appendChild(table(['Party'], parties.map((p) => el('tr', {}, [el('td', { text: p.name })]))));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Who a change on the look-ahead is down to. A table rather than free text, because '
      + '"down to BART" is a number somebody may eventually have to defend.',
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
            onClick: safely(async () => {
              const ok = await confirmDialog({
                title: 'Cancel this leave?',
                message: 'It stays on the record as cancelled rather than disappearing.',
                confirmLabel: 'Cancel leave',
              });
              if (!ok) return;
              await rc.updateLeave(l.id, { status: 'cancelled' });
              notifyChanged('leave');
            }),
          }),
        ] : []),
      ]))
    ));
  }

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Leave booked here is the same leave the PTO calendar books, and the editor\'s staffing '
      + 'check reads it: somebody named on a day they are off is flagged before the week arrives.',
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

/**
 * A button's work, with its failure said. Every write here can be refused —
 * somebody else holding the pen, a file another computer saved — and a refusal
 * nobody is told about reads as a button that does nothing.
 */
function safely(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err), timeout: 8000 });
    }
  };
}

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
