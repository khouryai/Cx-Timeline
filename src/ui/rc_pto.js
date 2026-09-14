/**
 * PTO — who is off, what is booked, and where the two disagree.
 *
 * Leave already had a home: a list in Organisation, admin-only, sorted by start
 * date. That is the *record* and it stays there. It is not a view anybody can
 * plan around, because the question a scheduler actually asks is "who is off in
 * the weeks I am staffing", and a list of date ranges does not answer it —
 * you find out somebody is away when you try to put them somewhere.
 *
 * So this is a calendar, and it draws two things in each cell, for the reason
 * the Resources tab draws two:
 *
 * **What somebody booked**, from `rc_leave` — a record, with a kind and a
 * status, that survives the workbook being edited.
 *
 * **What the 4WLA says**, from the "PTO" row at the bottom of the sheet — names
 * typed into day cells, derived at paint time and never written anywhere. On
 * this programme that row is usually the *only* place an absence is written
 * down: somebody types a name into the workbook and never opens Organisation.
 * Reading it is what stops the huddle asking a person on holiday how their day
 * went, and what stops the week plan drawing their week as days nobody filled
 * in.
 *
 * The interesting cell is the one where they differ. A day the sheet says is PTO
 * with nothing booked against it is not an error — it is the normal case, and
 * one click from becoming a record. A day booked that the sheet does not know
 * about is the other direction, and worth seeing before somebody is scheduled
 * into it.
 *
 * **Nothing here is derived from a role.** Managers take leave too, and a PTO
 * calendar that quietly dropped them would be wrong on exactly the weeks it
 * matters. `scheduled` is what the week plan and Resources filter on because
 * those are about work; this is about people.
 *
 * Imports: util, dates, rc, icons, components, rc_util.
 */

import { el, clear } from '../core/util.js';
import { toISO, addDays, todayMs } from '../core/dates.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import {
  textInput, selectInput, toast, badge, field, emptyState,
} from './components.js';
import {
  weekStart, todayISO, dayLabel, byId, availability, isoToMs,
  notifyChanged, formModal, nameRegister, absenceAssignments, lookaheadWithResources,
} from './rc_util.js';

/** Which four weeks are on screen. Null means the one containing today. */
let weekOf = null;

/**
 * Four weeks, not one.
 *
 * Leave is arranged weeks ahead and the whole point of drawing it is to see it
 * coming; a one-week window shows you the holiday that started yesterday. Four
 * is also what the look-ahead is maintained to, so the sheet's own PTO row has
 * something to say across the whole view rather than only the first column of it.
 */
const WEEKS = 4;

export async function render(root) {
  const startMs = weekOf ?? weekStart(todayMs());
  const days = [];
  for (let i = 0; i < WEEKS * 7; i++) days.push(toISO(addDays(startMs, i)));
  const from = days[0];
  const to = days[days.length - 1];
  const today = todayISO();

  /* Everybody active, managers included — see the header comment. The
     look-ahead is administrators-only in the database, so a member gets nothing
     back from it and simply sees the booked side, which is correct. */
  const [people, kinds, leave, sheet, aliases] = await Promise.all([
    rc.listPeople(),
    rc.listLeaveKinds().catch(() => []),
    rc.listLeave(from, to),
    lookaheadWithResources(from, to).catch(() => ({ rows: [], absences: [] })),
    rc.listPersonAliases().catch(() => []),
  ]);

  const kindsById = byId(kinds);
  const register = nameRegister(people, aliases);
  /* The same register and the same matching rules the Resource row gets: a name
     on the PTO row is the same kind of thing as a name on a Resource row, so
     there is one answer to "who is Victor" and not two that could differ. */
  const away = absenceAssignments(sheet.absences, register);
  const redraw = () => { clear(root); render(root); };
  const admin = rc.isAdmin();

  const host = el('div', { class: 'rc-pto' });
  root.appendChild(host);

  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('button', {
      class: 'cx-btn icon mini ghost',
      'aria-label': 'Previous week',
      html: icon('chevron-left', { size: 13 }),
      onClick: () => { weekOf = startMs - 7 * 86400000; redraw(); },
    }),
    el('h3', { text: `PTO — ${dayLabel(from, 'medium')} to ${dayLabel(to, 'medium')}` }),
    el('button', {
      class: 'cx-btn icon mini ghost',
      'aria-label': 'Next week',
      html: icon('chevron-right', { size: 13 }),
      onClick: () => { weekOf = startMs + 7 * 86400000; redraw(); },
    }),
    el('button', {
      class: 'cx-btn mini ghost',
      text: 'This week',
      onClick: () => { weekOf = null; redraw(); },
    }),
    admin ? el('button', {
      class: 'cx-btn mini primary',
      text: 'Book leave',
      onClick: () => bookLeave({ people, kinds, redraw }),
    }) : null,
  ].filter(Boolean)));

  if (!people.length) {
    host.appendChild(emptyState({ title: 'Nobody on the roster yet.' }));
    return;
  }

  /* ── The calendar ─────────────────────────────────────────────────────── */

  const headCells = [el('th', { class: 'rc-pto-name', text: 'Person' })];
  for (const iso of days) {
    const ms = isoToMs(iso);
    const weekend = [0, 6].includes(new Date(ms).getUTCDay());
    headCells.push(el('th', {
      class: ['rc-pto-day', weekend ? 'rc-pto-weekend' : '', iso === today ? 'rc-pto-today' : '']
        .filter(Boolean).join(' '),
      // The weekday letter and the date, which is as much as a 28-column header
      // has room for and all anybody reads off it.
      html: `${'MTWTFSS'[(new Date(ms).getUTCDay() + 6) % 7]}<br>${iso.slice(8)}`,
      title: dayLabel(iso, 'medium'),
    }));
  }

  const body = el('tbody');
  let bookedDays = 0;
  let sheetOnly = 0;

  for (const person of people) {
    const mine = away.byPerson.get(person.id) || new Map();
    const cells = days.map((iso) => {
      const state = availability(person, iso, leave, mine.get(iso) === 'pto' ? 'pto' : null);
      const sheetSays = mine.get(iso) || null;
      const booked = state.leave || null;
      const classes = ['rc-pto-cell'];
      if (iso === today) classes.push('rc-pto-today');
      if ([0, 6].includes(new Date(isoToMs(iso)).getUTCDay())) classes.push('rc-pto-weekend');

      if (booked) {
        bookedDays++;
        classes.push('rc-pto-booked');
        if (sheetSays === 'pto') classes.push('rc-pto-agreed');
        return el('td', {
          class: classes.join(' '),
          'data-label': dayLabel(iso),
          title: [kindsById.get(booked.kind_id)?.name || 'Leave',
            booked.status !== 'approved' ? booked.status : null,
            sheetSays === 'pto' ? 'and the 4WLA says so too' : 'not on the 4WLA',
            booked.note].filter(Boolean).join(' · '),
          text: '',
        });
      }

      if (sheetSays === 'pto') {
        sheetOnly++;
        classes.push('rc-pto-sheet');
        /* Nothing booked, and the workbook says they are off. Not an error —
           it is how almost every absence on this programme is recorded — so the
           cell offers to make it a record rather than complaining about it. */
        return el('td', {
          class: `${classes.join(' ')}${admin ? ' rc-clickable' : ''}`,
          'data-label': dayLabel(iso),
          title: `The 4WLA says ${person.name} is off on ${dayLabel(iso, 'medium')}, and nothing is `
            + 'booked. Everything reads it as leave either way; booking it makes a record that '
            + 'survives the sheet being edited.',
          onClick: admin
            ? () => bookLeave({ people, kinds, redraw, person, from: iso, to: iso })
            : null,
        });
      }

      if (sheetSays === 'other') {
        classes.push('rc-pto-other');
        return el('td', {
          class: classes.join(' '),
          'data-label': dayLabel(iso),
          title: `The 4WLA has ${person.name} on another group's project. That is work, not `
            + 'leave — they are in the huddle with it against their name.',
        });
      }

      if (state.state === 'non-working') classes.push('rc-pto-off');
      return el('td', { class: classes.join(' '), 'data-label': dayLabel(iso) });
    });

    body.appendChild(el('tr', {}, [
      el('td', { class: 'rc-pto-name', text: person.name }),
      ...cells,
    ]));
  }

  host.appendChild(el('div', { class: 'rc-scroll' }, [
    el('table', { class: 'rc-table rc-pto-grid' }, [el('thead', {}, [el('tr', {}, headCells)]), body]),
  ]));

  host.appendChild(el('div', { class: 'rc-pto-key' }, [
    key('rc-pto-booked', 'Booked'),
    key('rc-pto-booked rc-pto-agreed', 'Booked, and on the 4WLA'),
    key('rc-pto-sheet', 'On the 4WLA only'),
    key('rc-pto-other', "Another group's project"),
  ]));

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: `${bookedDays} booked day(s) in this window, and ${sheetOnly} the 4WLA says are PTO with `
      + 'nothing booked against them. The second number is not a fault: the workbook is where '
      + 'most absences on this programme are written down, and everything — the huddle, the week '
      + 'plan, Resources — already reads it as leave. Booking one makes a record that survives '
      + 'the sheet being edited, and an administrator can do it by clicking the day.',
  }));

  /* ── Names the PTO row uses that the roster cannot place ──────────────── */

  if (away.unmatched.length) {
    host.appendChild(el('div', { style: 'height:20px' }));
    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'Named as away, not on the roster' }),
    ]));
    host.appendChild(el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'As written' }), el('th', { text: 'Days' }), el('th', { text: 'On' }),
        ])]),
        el('tbody', {}, away.unmatched.map((u) => el('tr', {}, [
          el('td', { text: u.name }),
          el('td', { class: 'rc-num', text: String(u.days.size) }),
          el('td', { class: 'rc-hint', text: [...u.kinds].map((k) => (k === 'pto' ? 'PTO' : 'Other group / project')).join(', ') }),
        ]))),
      ]),
    ]));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'These spellings are on the sheet’s PTO and Other Group rows and the roster cannot '
        + 'place them, so those days are not showing against anybody. It is the same answer a name '
        + 'on a Resource row gets and the same place to give it: Resources maps a spelling to a '
        + 'person in one click, and it is settled for both rows at once.',
    }));
  }

  /* ── What is booked ───────────────────────────────────────────────────── */

  const booked = leave
    .filter((l) => l.status !== 'cancelled' && l.status !== 'declined')
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  host.appendChild(el('div', { style: 'height:20px' }));
  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'Booked in this window' }),
  ]));

  if (!booked.length) {
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Nothing booked in these four weeks. Where the 4WLA names somebody on its PTO row the '
        + 'calendar above still shows it, and everything else still reads it as leave.',
    }));
  } else {
    const peopleById = byId(people);
    host.appendChild(el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Person' }), el('th', { text: 'From' }), el('th', { text: 'To' }),
          el('th', { text: 'Kind' }), el('th', { text: 'State' }), el('th', { text: '' }),
        ])]),
        el('tbody', {}, booked.map((l) => el('tr', {}, [
          el('td', { text: peopleById.get(l.person_id)?.name || '—' }),
          el('td', { text: dayLabel(l.start_date, 'medium') }),
          el('td', { text: dayLabel(l.end_date, 'medium') }),
          el('td', { text: kindsById.get(l.kind_id)?.name || '—' }),
          el('td', {}, [badge(l.status === 'approved' ? 'Approved' : l.status,
            l.status === 'approved' ? 'good' : 'warn')]),
          el('td', { class: 'rc-hint', text: l.note || '' }),
        ]))),
      ]),
    ]));
  }

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Leave is why the huddle can tell "away" apart from "carried over", and why absence is '
      + 'not silently distributed across the performance statuses. The full record, including '
      + 'cancelled leave and every kind, is in Organisation → Leave; this is the four weeks '
      + 'anybody is actually staffing.',
  }));
}

/** One swatch and its meaning. The key is four cells, so it is drawn as cells. */
function key(klass, label) {
  return el('span', { class: 'rc-pto-key-item' }, [
    el('span', { class: `rc-pto-swatch ${klass}` }),
    el('span', { text: label }),
  ]);
}

/**
 * Book leave, optionally already knowing whose and when.
 *
 * The same write Organisation makes — one `rc_leave` row — because a second way
 * of recording leave is a second answer to "is Dana off on Tuesday". Prefilled
 * when it is opened from a day on the calendar, so turning what the workbook
 * says into a record is a confirmation rather than a retype.
 */
function bookLeave({ people, kinds, redraw, person = null, from = '', to = '' }) {
  const who = selectInput({
    value: person?.id || people[0]?.id,
    options: people.map((p) => ({ value: p.id, label: p.name })),
  });
  const start = el('input', { type: 'date', class: 'cx-input', value: from });
  const end = el('input', { type: 'date', class: 'cx-input', value: to });
  const kind = selectInput({
    value: kinds[0]?.id || '',
    placeholder: kinds.length ? undefined : '— no kinds set up —',
    options: kinds.map((k) => ({ value: k.id, label: k.name })),
  });
  const note = textInput({ placeholder: 'Optional', value: person && from ? 'From the 4WLA' : '' });

  formModal({
    title: person ? `Book leave for ${person.name}` : 'Book leave',
    body: el('div', { class: 'cx-form' }, [
      field('Person', who),
      field('From', start),
      field('To', end, 'Inclusive, as a calendar is.'),
      field('Kind', kind),
      field('Note', note),
      el('p', {
        class: 'rc-hint',
        text: 'Everything already reads the 4WLA’s PTO row as leave. Booking it makes a record '
          + 'that survives somebody editing the sheet, and gives the day a kind and a status.',
      }),
    ]),
    confirmLabel: 'Book',
    onConfirm: async () => {
      if (!start.value || !end.value) throw new Error('Both dates are needed.');
      if (end.value < start.value) throw new Error('The end is before the start.');
      await rc.addLeave({
        person_id: who.value,
        start_date: start.value,
        end_date: end.value,
        kind_id: kind.value || null,
        note: note.value.trim() || null,
      });
      notifyChanged('leave');
      toast({ tone: 'good', message: 'Leave booked.' });
      redraw();
    },
  });
}
