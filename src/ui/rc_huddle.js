/**
 * The daily huddle, and the week plan behind it.
 *
 * One screen, everyone side by side, all subsystems in one meeting: yesterday's
 * plan, yesterday's outcome, tomorrow's plan. It is used live, at a fixed time,
 * in front of the whole team — which sets every constraint here.
 *
 * **It must not rebuild while somebody is typing into it.** Panes elsewhere in
 * this application write to the store on every keystroke and rebuild on the
 * resulting change event, which replaces the input under the caret; CLAUDE.md
 * records that shipping three times. This screen is nothing *but* dense live
 * text entry, so it takes the opposite approach: nothing is written until a
 * field is left or Enter is pressed, and a save redraws one row rather than the
 * screen.
 *
 * **It must work with no network.** The meeting happens at 3pm whether or not
 * the wifi does. Every outcome is stamped with a uuid generated here, queued in
 * localStorage, and replayed when the connection returns — `rc_record_actual`
 * is idempotent on that uuid, so replaying one twice is harmless.
 *
 * Imports: util, events, dates, rc, icons, components, rc_util.
 */

import { el, clear } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { toISO, addDays, todayMs } from '../core/dates.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import { selectInput, textInput, toast, badge } from './components.js';
import {
  STATUSES, STATUS_BY_ID, SHIFTS, weekStart, weekDays, todayISO, isoToMs,
  dayLabel, byId, availability, notifyChanged, formModal,
} from './rc_util.js';

/* ══════════════════════════════════════════════════════════════════════════
   The offline queue
   ═══════════════════════════════════════════════════════════════════════ */

const QUEUE_KEY = 'cxrc.queue';

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeQueue(rows) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
  } catch {
    /* A full or disabled localStorage must not lose the meeting; the entry
       still went to the server if the server was reachable. */
  }
  emit(EV.RC_QUEUE_CHANGED, { pending: rows.length });
}

export function pendingCount() {
  return readQueue().length;
}

/**
 * Send one outcome, queueing it if that fails.
 *
 * The uuid is generated before the attempt rather than by the database, which
 * is the whole trick: a queued entry and the row it eventually becomes are the
 * same row, so a flush can run twice and the second pass changes nothing.
 */
async function record(entry) {
  try {
    await rc.recordActual(entry);
    return { sent: true };
  } catch (err) {
    const queue = readQueue();
    queue.push(entry);
    writeQueue(queue);
    return { sent: false, error: err };
  }
}

/**
 * Push whatever is queued. Safe to call at any time, including twice at once.
 *
 * Entries that still fail stay queued in order. One that the server actively
 * rejects — a category that has since been retired, say — would otherwise
 * block everything behind it forever, so a refusal that is not a network
 * problem is dropped with a toast rather than retried until the end of time.
 */
export async function flushQueue() {
  const queue = readQueue();
  if (!queue.length || !rc.isSignedIn()) return 0;

  const remaining = [];
  let sent = 0;
  for (const entry of queue) {
    try {
      await rc.recordActual(entry);
      sent++;
    } catch (err) {
      if (/fetch|network/i.test(String(err.message))) remaining.push(entry);
      else {
        console.warn('[cx-timeline] a queued outcome was refused and dropped:', err.message);
        toast({ tone: 'warn', message: `An entry from ${entry.date} was refused: ${err.message}` });
      }
    }
  }
  writeQueue(remaining);
  if (sent) notifyChanged('actuals');
  return sent;
}

/* ══════════════════════════════════════════════════════════════════════════
   The huddle
   ═══════════════════════════════════════════════════════════════════════ */

/** Which day is being reviewed. Defaults to today; the arrows move it. */
let onDate = null;

function currentDate() {
  return onDate || todayISO();
}

/**
 * Does anybody on the team work this day at all?
 *
 * Not a fixed Monday-to-Friday: commissioning runs weekend possessions, and a
 * team with somebody on a Saturday rota has a Saturday worth reviewing. The
 * roster is the authority, so this asks it.
 */
function anybodyWorks(iso, people) {
  const weekday = new Date(isoToMs(iso)).getUTCDay() || 7;
  return people.some((p) => (p.working_days || [1, 2, 3, 4, 5]).includes(weekday));
}

/**
 * The day whose outcomes are being captured.
 *
 * The previous *working* day, not literally yesterday. On a Monday the meeting
 * reviews Friday — asking a team what they achieved on Sunday would produce a
 * screen of blanks and, worse, would tempt somebody into recording "carried
 * over" for a day nobody was there.
 */
function reviewDate(iso, people) {
  let ms = addDays(isoToMs(iso), -1);
  for (let i = 0; i < 7 && !anybodyWorks(toISO(ms), people); i++) ms = addDays(ms, -1);
  return toISO(ms);
}

/** The next working day. On a Friday the meeting plans Monday. */
function planDate(iso, people) {
  let ms = addDays(isoToMs(iso), 1);
  for (let i = 0; i < 7 && !anybodyWorks(toISO(ms), people); i++) ms = addDays(ms, 1);
  return toISO(ms);
}

export async function render(root) {
  await flushQueue();

  const date = currentDate();

  // The roster decides which days count, so it is read before the window that
  // depends on it. One extra round trip, and it is what keeps a Monday meeting
  // pointed at Friday.
  const people = await rc.listPeople();
  const review = reviewDate(date, people);
  const plan = planDate(date, people);

  const [categories, locations, parties, leave, planRows, actuals] = await Promise.all([
    rc.listCategories(),
    rc.listLocations(),
    rc.listParties(),
    rc.listLeave(review, plan),
    rc.listPlan(review, plan),
    rc.listActuals(review, review),
  ]);

  const cats = byId(categories);
  const locs = byId(locations);
  const actualByPerson = new Map();
  for (const a of actuals) actualByPerson.set(a.person_id, a);

  const planFor = (personId, iso) =>
    planRows.find((p) => p.person_id === personId && p.work_date === iso) || null;

  root.appendChild(dateBar(date, review, plan, root));

  if (!people.length) {
    root.appendChild(el('p', { class: 'rc-hint', text: 'Add people in Organisation first.' }));
    return;
  }

  const body = el('tbody');
  for (const person of people) {
    body.appendChild(personRow({
      person, review, plan, planFor, actualByPerson, cats, locs,
      categories, locations, parties, leave, root,
    }));
  }

  root.appendChild(el('div', { class: 'rc-scroll' }, [
    el('table', { class: 'rc-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Person' }),
          el('th', { text: `Was planned — ${dayLabel(review)}` }),
          el('th', { text: 'What happened' }),
          el('th', { text: `Tomorrow — ${dayLabel(plan)}` }),
        ]),
      ]),
      body,
    ]),
  ]));

  root.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Nothing is written until you leave a field or press Enter, and saving redraws '
      + 'one row rather than the screen — otherwise the meeting would keep losing the box '
      + 'you were typing into. Entries made with no connection queue and go up on their own.',
  }));
}

function dateBar(date, review, plan, root) {
  const move = (days) => {
    onDate = toISO(addDays(isoToMs(date), days));
    clear(root);
    render(root);
  };

  return el('div', { class: 'rc-section-head' }, [
    el('button', {
      class: 'cx-btn icon mini ghost',
      'aria-label': 'Previous day',
      html: icon('chevron-left', { size: 13 }),
      onClick: () => move(-1),
    }),
    el('h3', { text: `Huddle — ${dayLabel(date, 'medium')}` }),
    el('button', {
      class: 'cx-btn icon mini ghost',
      'aria-label': 'Next day',
      html: icon('chevron-right', { size: 13 }),
      onClick: () => move(1),
    }),
    date === todayISO() ? null : el('button', {
      class: 'cx-btn mini ghost',
      text: 'Today',
      onClick: () => {
        onDate = null;
        clear(root);
        render(root);
      },
    }),
  ].filter(Boolean));
}

/**
 * One person's row.
 *
 * Rebuilt in place on save — `replaceWith` on this node only — so the rest of
 * the table, including any field somebody else is mid-way through, is left
 * exactly alone.
 */
function personRow(ctx) {
  const { person, review, plan, planFor, actualByPerson, cats, locs, leave, root } = ctx;

  const row = el('tr');
  const redraw = () => {
    const next = personRow(ctx);
    row.replaceWith(next);
  };

  const away = availability(person, review, leave);
  const wasPlanned = planFor(person.id, review);
  const actual = actualByPerson.get(person.id) || null;
  const tomorrow = planFor(person.id, plan);
  const admin = rc.isAdmin();
  const mine = person.id === rc.me()?.id;

  /* Name, and why they are not being asked for a goal. */
  row.appendChild(el('td', {}, [
    el('div', { text: person.name }),
    el('div', { class: 'rc-hint', text: person.subsystem || person.title || '' }),
  ]));

  /* What they were supposed to be doing. */
  row.appendChild(el('td', {}, [
    wasPlanned
      ? el('div', {}, [
        el('div', { text: wasPlanned.task || '—' }),
        el('div', { class: 'rc-hint', text: locs.get(wasPlanned.location_id)?.name || '' }),
      ])
      : el('span', { class: 'rc-hint', text: 'nothing planned' }),
  ]));

  /* What happened. Absence is answered from the leave record rather than
     asked for — somebody on leave did not carry anything over, and letting
     that fall into a performance status is exactly what the five-way split
     exists to prevent. */
  if (away.state === 'leave') {
    row.appendChild(el('td', {}, [badge('On leave', 'muted')]));
  } else if (away.state === 'non-working') {
    row.appendChild(el('td', {}, [el('span', { class: 'rc-hint', text: 'not a working day' })]));
  } else if (actual) {
    const status = STATUS_BY_ID.get(actual.status);
    row.appendChild(el('td', {}, [
      badge(status?.label || actual.status, status?.tone || 'muted'),
      actual.blocked_reason
        ? el('div', { class: 'rc-hint', text: actual.blocked_reason })
        : null,
      actual.note ? el('div', { class: 'rc-hint', text: actual.note }) : null,
    ].filter(Boolean)));
  } else if (admin || mine) {
    row.appendChild(el('td', {}, [statusButtons(ctx, person, review, wasPlanned, redraw)]));
  } else {
    row.appendChild(el('td', {}, [el('span', { class: 'rc-hint', text: '—' })]));
  }

  /* Tomorrow. */
  row.appendChild(el('td', {}, [
    tomorrow
      ? el('div', {}, [
        el('div', { text: tomorrow.task || '—' }),
        el('div', { class: 'rc-hint', text: locs.get(tomorrow.location_id)?.name || '' }),
      ])
      : admin
        ? el('button', {
          class: 'cx-btn mini ghost',
          text: 'Set goal',
          onClick: () => setGoal(ctx, person, plan, root),
        })
        : el('span', { class: 'rc-hint', text: '—' }),
  ]));

  return row;
}

/**
 * One button per status, so a whole team can be gone through at speed.
 *
 * A dropdown would be two clicks and a read; this is one click. Blocked opens a
 * dialog because it is the one status that cannot be recorded without more —
 * a reason and somebody answerable — and the database refuses it otherwise.
 */
function statusButtons(ctx, person, date, plannedEntry, redraw) {
  const wrap = el('div', { style: 'display:flex;gap:3px;flex-wrap:wrap' });

  for (const status of STATUSES) {
    if (status.id === 'absent') continue;
    wrap.appendChild(el('button', {
      class: 'cx-btn mini ghost',
      text: status.label,
      title: status.family === 'health'
        ? 'Programme health — never counted against the individual'
        : 'Counts toward individual efficiency',
      onClick: async () => {
        if (status.id === 'blocked') {
          blockedDialog(ctx, person, date, plannedEntry, redraw);
          return;
        }
        const entry = {
          clientUuid: newUuid(),
          personId: person.id,
          date,
          status: status.id,
          categoryId: plannedEntry?.category_id || null,
          locationId: plannedEntry?.location_id || null,
          planEntryId: plannedEntry?.id || null,
          carryChainId: status.id === 'carried' ? carryChainFor(plannedEntry) : null,
        };
        const { sent, error } = await record(entry);
        if (!sent) toast({ tone: 'warn', message: `Saved locally — ${error.message}` });
        notifyChanged('actuals');
        redraw();
      },
    }));
  }
  return wrap;
}

/**
 * The chain a carried task belongs to.
 *
 * Keyed on the plan entry it came from, so five days of the same stuck job are
 * one chain rather than five separate failures charged to one person. What
 * makes the report useful is the chain's *age*, not the count.
 */
function carryChainFor(plannedEntry) {
  if (!plannedEntry) return null;
  return plannedEntry.id;
}

function blockedDialog(ctx, person, date, plannedEntry, redraw) {
  const reason = textInput({ placeholder: 'What stopped it' });
  const party = selectInput({
    value: ctx.parties[0]?.id,
    options: ctx.parties.map((p) => ({ value: p.id, label: p.name })),
  });

  formModal({
    title: `${person.name} — blocked`,
    body: el('div', { class: 'cx-form' }, [
      el('p', {
        class: 'rc-hint',
        text: 'A block is programme health, not a mark against anyone — which is exactly '
          + 'why it needs a reason and somebody answerable. The database refuses it without both.',
      }),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Reason' }), reason]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Down to' }), party]),
    ]),
    confirmLabel: 'Record',
    onConfirm: async () => {
      if (!reason.value.trim()) throw new Error('A reason is needed.');
      const entry = {
        clientUuid: newUuid(),
        personId: person.id,
        date,
        status: 'blocked',
        categoryId: plannedEntry?.category_id || null,
        locationId: plannedEntry?.location_id || null,
        planEntryId: plannedEntry?.id || null,
        blockedReason: reason.value.trim(),
        blockedPartyId: party.value,
      };
      const { sent, error } = await record(entry);
      if (!sent) toast({ tone: 'warn', message: `Saved locally — ${error.message}` });
      notifyChanged('actuals');
      redraw();
    },
  });
}

function setGoal(ctx, person, date, root) {
  const task = textInput({ placeholder: 'What they will do' });
  const location = selectInput({
    value: '',
    placeholder: '— location —',
    options: ctx.locations.map((l) => ({ value: l.id, label: l.name })),
  });
  const category = selectInput({
    value: '',
    placeholder: '— category —',
    options: ctx.categories.map((c) => ({ value: c.id, label: c.name })),
  });
  const shift = selectInput({ value: 'day', options: SHIFTS.map((s) => ({ value: s.id, label: s.label })) });

  formModal({
    title: `${person.name} — ${dayLabel(date, 'medium')}`,
    body: el('div', { class: 'cx-form' }, [
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Task' }), task]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Location' }), location]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Category' }), category]),
      el('div', { class: 'cx-field' }, [
        el('label', { class: 'cx-label', text: 'Shift' }), shift,
        el('div', { class: 'cx-hint', text: 'A night shift belongs to the day it starts on.' }),
      ]),
    ]),
    confirmLabel: 'Set',
    onConfirm: async () => {
      if (!task.value.trim()) throw new Error('A task is needed.');
      await rc.addPlanEntries([{
        person_id: person.id,
        work_date: date,
        shift: shift.value,
        location_id: location.value || null,
        task: task.value.trim(),
        category_id: category.value || null,
      }]);
      notifyChanged('plan');
      clear(root);
      render(root);
    },
  });
}

/** A v4-shaped uuid. The database column is a uuid and will not take anything else. */
function newUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) =>
    c === 'x' ? hex() : ((Math.floor(Math.random() * 4) + 8).toString(16)));
}

/* ══════════════════════════════════════════════════════════════════════════
   The week plan
   ═══════════════════════════════════════════════════════════════════════ */

let weekOf = null;

/**
 * People down, days across.
 *
 * Leave is drawn *behind* the assignments rather than in a calendar of its own,
 * the way the timeline already draws a freeze period behind the work it
 * affects: a clash is then something you can see rather than something you have
 * to be told about.
 */
export async function renderWeek(root) {
  const startMs = weekOf ?? weekStart(todayMs());
  const days = weekDays(startMs);
  const from = days[0];
  const to = days[days.length - 1];

  const [people, locations, leave, planRows] = await Promise.all([
    rc.listPeople(),
    rc.listLocations(),
    rc.listLeave(from, to),
    rc.listPlan(from, to),
  ]);
  const locs = byId(locations);

  root.appendChild(el('div', { class: 'rc-section-head' }, [
    el('button', {
      class: 'cx-btn icon mini ghost',
      'aria-label': 'Previous week',
      html: icon('chevron-left', { size: 13 }),
      onClick: () => { weekOf = startMs - 7 * 86400000; clear(root); renderWeek(root); },
    }),
    el('h3', { text: `Week of ${dayLabel(from, 'medium')}` }),
    el('button', {
      class: 'cx-btn icon mini ghost',
      'aria-label': 'Next week',
      html: icon('chevron-right', { size: 13 }),
      onClick: () => { weekOf = startMs + 7 * 86400000; clear(root); renderWeek(root); },
    }),
  ]));

  /* How many people are actually available each day. This is the number that
     stops work being promised that cannot be staffed. */
  const coverage = days.map((iso) =>
    people.filter((p) => availability(p, iso, leave).state === 'available').length);

  const body = el('tbody');
  for (const person of people) {
    const cells = days.map((iso) => {
      const state = availability(person, iso, leave);
      const entry = planRows.find((p) => p.person_id === person.id && p.work_date === iso);
      if (state.state === 'leave') return el('td', {}, [badge('Leave', 'muted')]);
      if (state.state === 'non-working') return el('td', { class: 'rc-inactive' }, [el('span', { text: '·' })]);
      if (!entry) return el('td', {}, [el('span', { class: 'rc-hint', text: '—' })]);
      return el('td', {}, [
        el('div', { text: entry.task || '—' }),
        el('div', { class: 'rc-hint', text: locs.get(entry.location_id)?.name || '' }),
      ]);
    });
    body.appendChild(el('tr', {}, [el('td', { text: person.name }), ...cells]));
  }

  body.appendChild(el('tr', {}, [
    el('td', {}, [el('strong', { text: 'Available' })]),
    ...coverage.map((n, i) => el('td', { class: 'rc-num' }, [
      el('span', { text: `${n} of ${people.length}` }),
    ])),
  ]));

  root.appendChild(el('div', { class: 'rc-scroll' }, [
    el('table', { class: 'rc-table' }, [
      el('thead', {}, [
        el('tr', {}, [el('th', { text: 'Person' }), ...days.map((iso) => el('th', { text: dayLabel(iso) }))]),
      ]),
      body,
    ]),
  ]));

  root.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Leave sits in the grid rather than in a calendar of its own, so a clash is '
      + 'visible rather than merely flagged. The bottom row is what stops work being '
      + 'promised for a day it cannot be staffed.',
  }));
}
