/**
 * PTO — who is off, what is booked, and where the two disagree.
 *
 * Leave already had a home: a list in Organisation, admin-only, sorted by start
 * date. That is the *record* and it stays there. It is not a view anybody can
 * plan around, because the question a scheduler actually asks is "who is off in
 * the weeks I am staffing", and a list of date ranges does not answer it —
 * you find out somebody is away when you try to put them somewhere.
 *
 * So this is a calendar. It reads two things into each cell, for the reason the
 * Resources tab draws two — though both come out the same colour, because on
 * this screen they are the same fact:
 *
 * **What somebody booked**, from `rc_leave` — a record, with a kind and a
 * status, that survives the workbook being edited.
 *
 * **What the 4WLA says**, from the "PTO" row at the bottom of the sheet — names
 * typed into day cells, derived at paint time and never written anywhere. On
 * this project that row is usually the *only* place an absence is written
 * down: somebody types a name into the workbook and never opens Organisation.
 * Reading it is what stops the huddle asking a person on holiday how their day
 * went, and what stops the week plan drawing their week as days nobody filled
 * in.
 *
 * **They are drawn as one colour, and that is deliberate.** Which of the two
 * wrote a day down is bookkeeping; the question this screen answers is who is
 * away, and a reader scanning four weeks of the team should not have to learn
 * three swatches to answer it. The distinction is still there to be had — in the
 * cell's title, in the counts under the grid, and in the fact that a day only
 * the sheet knows about can be clicked to book it — but it is not what the
 * colour is for.
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
import { ABSENCE_LABELS } from '../core/lookahead.js';
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
    /* Asking is a member's; answering is an administrator's.
       It was administrators-only, which made the commonest thing anybody wants
       from this module a thing they had to get somebody else to type — so it
       went into the 4WLA instead, or nowhere at all, and "the sheet says they
       are off and nothing is booked" became the normal case. A member's press
       writes the same single `rc_leave` row with `status: 'requested'`; a second
       table for requests would be a second answer to "is Dana off on Tuesday". */
    rc.canWrite() ? el('button', {
      class: 'cx-btn mini primary',
      text: admin ? 'Book leave' : 'Request leave',
      onClick: () => bookLeave({ people, kinds, redraw, admin }),
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
      /* A day carries a *list* of what the sheet said — PTO alone, or the
         work rows it names somebody on. Leave is what `availability()` acts
         on; the rest are drawn as what they are. */
      const kinds = mine.get(iso) || [];
      const state = availability(person, iso, leave, kinds.includes('pto') ? 'pto' : null);
      const sheetSays = kinds.includes('pto') ? 'pto' : (kinds[0] || null);
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
          /* The colour says "off"; the title says where that came from. That is
             the whole of what splitting the swatch used to buy, and it costs
             nothing to read it here instead. */
          title: [kindsById.get(booked.kind_id)?.name || 'Leave',
            'booked',
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
           it is how almost every absence on this project is recorded — so the
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

      /* Off the project but not off. Drawn so a day the sheet accounted for
         does not read as a blank here, and in a colour of its own rather than a
         shade of the leave one, so the two can never be mistaken: these are days
         somebody worked. */
      if (sheetSays === 'office' || sheetSays === 'other') {
        classes.push('rc-pto-elsewhere');
        return el('td', {
          class: classes.join(' '),
          'data-label': dayLabel(iso),
          title: `The 4WLA has ${person.name} ${kinds.map((k) => ABSENCE_LABELS[k].toLowerCase())
            .join(' and ')} that day. That is work, not leave — they are in the huddle with it `
            + 'against their name.',
        });
      }

      /* Asked for and not answered. Hatched rather than filled, because it is
         not leave yet — the day is still staffable and the administrator still
         has a decision to make. Drawn at all because a request nobody can see
         on the calendar is a request that gets scheduled straight over. */
      if (state.asked) {
        classes.push('rc-pto-asked');
        return el('td', {
          class: classes.join(' '),
          'data-label': dayLabel(iso),
          title: `${person.name} has asked for this day off and nobody has answered yet. `
            + 'It is not leave until somebody does, so the day can still be staffed.',
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

  /* Two swatches, because there are two facts.
     Leave is one colour however it was written down: booked in the application
     and typed into the 4WLA's PTO row are the same day off, and drawing them
     apart made a reader learn three swatches to answer one question. Where it
     came from is still said — in the cell's title, in the counts below, and in
     whether the day can be clicked to book it. */
  host.appendChild(el('div', { class: 'rc-pto-key' }, [
    key('rc-pto-booked', 'PTO — booked or on the 4WLA'),
    key('rc-pto-asked', 'Asked for, not answered'),
    key('rc-pto-elsewhere', 'Off the project, not off work'),
  ]));

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: `${bookedDays} booked day(s) in this window, and ${sheetOnly} the 4WLA says are PTO with `
      + 'nothing booked against them. The second number is not a fault: the workbook is where '
      + 'most absences on this project are written down, and everything — the huddle, the week '
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
          el('td', { class: 'rc-hint', text: [...u.kinds].map((k) => ABSENCE_LABELS[k] || k).join(', ') }),
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

  /* ── Waiting on an answer ─────────────────────────────────────────────── */

  /* The point of a member being able to ask is that somebody answers.
     So the requests are a section of their own, above the record and not
     buried in it, and it is the *whole* register rather than the four weeks on
     screen: a request for October made today is a thing to answer today, and a
     window that only covered the weeks in view would hide it until it was too
     late to matter. An administrator answers here; the person who asked can
     withdraw while nobody has. */
  const pending = await rc.pendingLeave().catch(() => []);
  if (pending.length) {
    const peopleById = byId(people);
    host.appendChild(el('div', { style: 'height:20px' }));
    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: `Waiting on an answer (${pending.length})` }),
    ]));
    host.appendChild(el('div', { class: 'rc-scroll rc-pto-asks' }, [
      el('table', { class: 'rc-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Person' }), el('th', { text: 'From' }), el('th', { text: 'To' }),
          el('th', { text: 'Kind' }), el('th', { text: 'Asked' }), el('th', { text: '' }),
        ])]),
        el('tbody', {}, pending.map((l) => el('tr', {}, [
          el('td', {}, [
            el('div', { text: peopleById.get(l.person_id)?.name || '—' }),
            l.note ? el('div', { class: 'rc-hint', text: l.note }) : null,
          ].filter(Boolean)),
          el('td', { text: dayLabel(l.start_date, 'medium') }),
          el('td', { text: dayLabel(l.end_date, 'medium') }),
          el('td', { text: kindsById.get(l.kind_id)?.name || '—' }),
          el('td', { class: 'rc-hint', text: (l.created_at || '').slice(0, 10) }),
          el('td', {}, answerButtons(l, redraw, admin)),
        ]))),
      ]),
    ]));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: admin
        ? 'Approving one makes it leave everywhere at once — the calendar above, the week plan, '
          + 'the huddle — because it is the same row the whole time and the status is the only '
          + 'thing that changes. Nothing is copied into the 4WLA by this: put it on the sheet '
          + 'when the time comes, and the PTO row will then agree with the record.'
        : 'Yours are here until somebody answers them. Withdrawing one is the only change you '
          + 'can make to it, which is what stops a request approving itself.',
    }));
  }

  /* ── What is booked ───────────────────────────────────────────────────── */

  const booked = leave
    .filter((l) => l.status !== 'cancelled' && l.status !== 'declined')
    .sort((a_, b_) => a_.start_date.localeCompare(b_.start_date));

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
          el('td', {}, [badge(l.status === 'approved' ? 'Approved'
            : l.status === 'requested' ? 'Requested' : l.status,
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

/**
 * What can be done about a request, by whoever is looking at it.
 *
 * An administrator answers it: approve or decline, one update either way. The
 * person who asked can withdraw it while nobody has answered, and that is the
 * only change they can make — the update policy pins a member to writing
 * `cancelled`, which is what stops a request approving itself. Anybody else gets
 * nothing, because there is nothing for them to do.
 *
 * Declining rather than deleting: "we said no on the 4th" is a thing the record
 * should be able to say, and a row that disappears cannot say it.
 */
function answerButtons(row, redraw, admin) {
  const answer = async (status, said) => {
    try {
      await rc.updateLeave(row.id, { status });
      notifyChanged('leave');
      toast({ tone: 'good', message: said });
      redraw();
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
  };

  if (admin) {
    return [
      el('button', {
        class: 'cx-btn mini primary',
        text: 'Approve',
        title: 'It becomes leave everywhere at once — the same row, with the status changed.',
        onClick: () => answer('approved', 'Approved.'),
      }),
      el('button', {
        class: 'cx-btn mini ghost',
        text: 'Decline',
        title: 'Stays on the record as declined rather than disappearing.',
        onClick: () => answer('declined', 'Declined, and on the record as declined.'),
      }),
    ];
  }
  if (row.person_id === rc.me()?.id) {
    return [
      el('button', {
        class: 'cx-btn mini ghost',
        text: 'Withdraw',
        title: 'Takes the question back. Possible only while nobody has answered it.',
        onClick: () => answer('cancelled', 'Withdrawn.'),
      }),
    ];
  }
  return [];
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
function bookLeave({ people, kinds, redraw, admin = rc.isAdmin(), person = null, from = '', to = '' }) {
  /* A member asks for their own days and nobody else's, which is what the
     insert policy checks — so the select holds the one name they could write
     rather than offering a list the database would refuse. */
  const mine = rc.me()?.id || null;
  const canAsk = admin ? people : people.filter((p) => p.id === mine);
  const who = selectInput({
    value: person?.id || canAsk[0]?.id,
    options: canAsk.map((p) => ({ value: p.id, label: p.name })),
    disabled: canAsk.length <= 1,
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
    title: admin
      ? (person ? `Book leave for ${person.name}` : 'Book leave')
      : 'Request leave',
    body: el('div', { class: 'cx-form' }, [
      field('Person', who),
      field('From', start),
      field('To', end, 'Inclusive, as a calendar is.'),
      field('Kind', kind),
      field('Note', note),
      el('p', {
        class: 'rc-hint',
        text: admin
          ? 'Everything already reads the 4WLA’s PTO row as leave. Booking it makes a record '
            + 'that survives somebody editing the sheet, and gives the day a kind and a status.'
          : 'This goes up as a request and shows as one until an administrator answers it. It is '
            + 'the same row either way — there is no separate list of requests, because that '
            + 'would be a second answer to whether you are off. You can withdraw it while it is '
            + 'still unanswered.',
      }),
    ]),
    confirmLabel: admin ? 'Book' : 'Request it',
    onConfirm: async () => {
      if (!start.value || !end.value) throw new Error('Both dates are needed.');
      if (end.value < start.value) throw new Error('The end is before the start.');
      const row = {
        person_id: who.value,
        start_date: start.value,
        end_date: end.value,
        kind_id: kind.value || null,
        note: note.value.trim() || null,
      };
      if (admin) await rc.addLeave(row);
      else await rc.requestLeave(row);
      notifyChanged('leave');
      toast({
        tone: 'good',
        message: admin
          ? 'Leave booked.'
          : 'Asked for. It shows as a request until an administrator answers it.',
      });
      redraw();
    },
  });
}
