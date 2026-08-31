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
import { selectInput, textInput, toast, badge, checkbox } from './components.js';
/* The digest is a download like every other export in the application, so it
   announces itself the same way — a file that lands somewhere the page cannot
   see is the one action with no visible result. */
import { saveFile } from '../io/exporters.js';
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
/**
 * Whether the meeting is being *run* rather than filled in.
 *
 * The table is a form for the person holding the keyboard; presenter mode is
 * the same data drawn for the room — one person at a time, large enough to
 * read across a table, with the question asked the way somebody would say it.
 * Both write to exactly the same place.
 */
let presenting = false;

/*
 * Who is in front of the room. `null` means "nobody chosen yet", which is not
 * the same as the first person: a meeting resumed after somebody stepped out
 * should open on the first person who has *not* answered, and starting at zero
 * makes the facilitator page past everybody already done to find them.
 */
let atPerson = null;

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
  const people = await rc.listPeople({ scheduledOnly: true });
  const review = reviewDate(date, people);
  const plan = planDate(date, people);

  const [categories, locations, parties, leave, planRows, actuals, chains, everybody, blockers, laRows] =
    await Promise.all([
      rc.listCategories(),
      rc.listLocations(),
      rc.listParties(),
      rc.listLeave(review, plan),
      rc.listPlan(review, plan),
      rc.listActuals(review, review),
      // "This is the fourth day running" is the sentence that changes the
      // conversation, and it was only ever in a report the field team cannot
      // open. It is derived from outcomes everybody can already read.
      rc.listCarryChains().catch(() => []),
      /* Everybody, not just the people taking shifts. Whoever chases a
         released possession is usually the manager — who is stood down from
         the huddle precisely because they do not take work from it — so
         filtering this list the way the roster is filtered would leave the
         most likely owner unselectable. */
      rc.listPeople().catch(() => []),
      // Every blocker still open, whoever raised it and whenever. This is the
      // standing item the meeting keeps returning to until somebody clears it.
      rc.listBlockers().catch(() => []),
      // Only an administrator can read these; a member simply gets none and
      // the block dialog offers nothing to link, which is correct.
      rc.lookaheadForWeek(toISO(weekStart(isoToMs(review)))).catch(() => []),
    ]);

  const chainByeId = new Map();
  for (const c of chains) chainByeId.set(c.carry_chain_id, c);

  const cats = byId(categories);
  const locs = byId(locations);
  const actualByPerson = new Map();
  for (const a of actuals) actualByPerson.set(a.person_id, a);

  const planFor = (personId, iso) =>
    planRows.find((p) => p.person_id === personId && p.work_date === iso) || null;

  /* One context, handed to the table, the meeting and the digest alike. They
     are three readings of one day and the moment they are given different
     data they start disagreeing on screen, in front of the room. */
  const ctx = {
    people, review, plan, planFor, actualByPerson, cats, locs,
    categories, locations, parties, leave, root, chainByeId, laRows, blockers, everybody,
  };

  root.appendChild(dateBar(date, review, plan, root, ctx));

  if (!people.length) {
    root.appendChild(el('p', { class: 'rc-hint', text: 'Add people in Organisation first.' }));
    return;
  }

  const body = el('tbody');
  for (const person of people) {
    body.appendChild(personRow({ ...ctx, person }));
  }

  root.appendChild(openBlockers(blockers, { people: everybody, locs, parties, root }));

  /* Running the meeting rather than filling it in. Same data, same writes —
     one person at a time, big enough to read from across the table, with the
     question asked the way somebody would ask it out loud. */
  if (presenting) {
    root.appendChild(presenter(ctx));
    return;
  }

  root.appendChild(el('div', { class: 'rc-scroll' }, [
    el('table', { class: 'rc-table rc-huddle' }, [
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
  root.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Click a row and the meeting runs from the keyboard: ↑ ↓ down the team, then '
      + STATUSES.filter((st) => st.id !== 'absent').map((st) => `${st.key} ${st.label.toLowerCase()}`).join(', ')
      + '. Away is answered from the leave record rather than asked for.',
  }));
}

/**
 * What is still in the way, standing above the meeting.
 *
 * A blocked outcome says a day was lost; it never said who was chasing it, by
 * when, or whether it was still true this morning. So the list only ever grew,
 * and a list that only grows is one nobody reads. These stay on screen until
 * somebody closes them, which is the entire mechanism.
 *
 * Ordered by age, worst first: a blocker on its ninth day is a different
 * conversation from one raised yesterday, and the meeting should open on it.
 */
function openBlockers(blockers, ctx) {
  const wrap = el('div', { class: 'rc-blockers' });
  if (!blockers.length) {
    wrap.appendChild(el('p', { class: 'rc-hint', text: 'Nothing outstanding. Nobody is waiting on anybody.' }));
    return wrap;
  }

  const people = byId(ctx.people);
  const sorted = [...blockers].sort((a, b) => (b.age_days || 0) - (a.age_days || 0));

  wrap.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: `${sorted.length} still in the way` }),
  ]));

  for (const b of sorted) {
    const overdue = b.due_date && b.due_date < todayISO();
    wrap.appendChild(el('div', { class: 'rc-blocker' + (overdue ? ' overdue' : '') }, [
      el('div', { class: 'rc-blocker-main' }, [
        el('div', { class: 'rc-blocker-what', text: b.summary }),
        el('div', { class: 'rc-hint', text: [
          people.get(b.person_id)?.name,
          ctx.locs.get(b.location_id)?.name,
          byId(ctx.parties).get(b.party_id)?.name ? `down to ${byId(ctx.parties).get(b.party_id).name}` : null,
          b.last_note,
        ].filter(Boolean).join(' · ') }),
      ]),
      el('div', { class: 'rc-blocker-state' }, [
        // The two facts that turn a grievance into an obstacle.
        b.owner_id
          ? badge(`${people.get(b.owner_id)?.name || 'somebody'} chasing`, 'info')
          : badge('nobody chasing', 'bad'),
        b.due_date
          ? badge(overdue ? `overdue since ${dayLabel(b.due_date)}` : `by ${dayLabel(b.due_date)}`,
            overdue ? 'bad' : 'muted')
          : null,
        badge(`day ${Number(b.age_days || 0) + 1}`, Number(b.age_days || 0) >= 4 ? 'bad' : 'warn'),
      ].filter(Boolean)),
      rc.isAdmin() || rc.canWrite()
        ? el('button', {
          class: 'cx-btn mini',
          text: 'Update',
          onClick: () => updateBlocker(b, ctx),
        })
        : null,
    ].filter(Boolean)));
  }

  wrap.appendChild(el('p', {
    class: 'rc-hint',
    text: 'These stay here until somebody closes them. Nothing is edited — taking one on, '
      + 'moving the date and closing it are each a row, because "we told them on the 4th and '
      + 'chased on the 9th" is the sentence a claim is built from.',
  }));
  return wrap;
}

/** Take one on, move it, chase it, or close it. Always by appending. */
function updateBlocker(blocker, ctx) {
  const owner = selectInput({
    value: blocker.owner_id || '',
    placeholder: '— nobody yet —',
    options: ctx.people.map((p) => ({ value: p.id, label: p.name })),
  });
  const due = el('input', { type: 'date', class: 'cx-input', value: blocker.due_date || '' });
  const note = textInput({ placeholder: 'What has happened since' });
  const done = checkbox({ label: 'Cleared — take it off the list', checked: false });

  formModal({
    title: blocker.summary,
    body: el('div', { class: 'cx-form' }, [
      el('div', { class: 'cx-field' }, [
        el('label', { class: 'cx-label', text: 'Who is chasing it' }), owner,
        el('div', { class: 'cx-hint', text: 'The field a blocked day has never carried, and the '
          + 'one that decides whether anything happens about it.' }),
      ]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Expected by' }), due]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Update' }), note]),
      el('div', { class: 'cx-field' }, [done]),
    ]),
    confirmLabel: 'Add it',
    onConfirm: async () => {
      await rc.updateBlocker({
        blocker_id: blocker.id,
        state: done.querySelector('input').checked ? 'resolved' : 'open',
        owner_id: owner.value || null,
        due_date: due.value || null,
        note: note.value.trim() || null,
      });
      notifyChanged('blockers');
      clear(ctx.root);
      render(ctx.root);
    },
  });
}

/**
 * The meeting, run rather than filled in.
 *
 * One person, in focus, large enough to read from the other side of a table.
 * The room is the second audience and it needs different things from the
 * person answering: not the detail of the task but where it sits — which
 * look-ahead row it feeds, how many days it has been running, whether access
 * is confirmed. All of that is already recorded and none of it was ever in the
 * meeting.
 *
 * The question is asked the way somebody would say it out loud, because the
 * plan text is right there and using it as the question rather than as a
 * column is what makes this an interview instead of a form.
 *
 * Every write goes through exactly the same path as the table. This is a view,
 * not a second way of recording things.
 */
/**
 * The question, in the words somebody would actually use.
 *
 * The plan text is usually written with the place in it — "Cable pull at TPSS
 * 12" — so appending the location unconditionally reads back as "at TPSS 12 at
 * TPSS 12". Say it only when the sentence does not already.
 */
function askFor(planned, locs) {
  if (!planned) return 'Nothing was planned for you — what did you end up doing?';
  const task = planned.task || 'this';
  const where = locs.get(planned.location_id)?.name || '';
  const said = where && task.toLowerCase().includes(where.toLowerCase());
  return `Yesterday you were on ${task}${where && !said ? ` at ${where}` : ''} — how did it go?`;
}

function presenter(ctx) {
  const { people, review, plan, planFor, actualByPerson, locs, cats, leave, root } = ctx;
  const wrap = el('div', { class: 'rc-present', tabindex: '0' });

  const asked = people.filter((p) => availability(p, review, leave).state === 'available');
  const queue = asked.length ? asked : people;
  if (atPerson === null) {
    const waiting = queue.findIndex((p) => !actualByPerson.get(p.id));
    atPerson = waiting < 0 ? 0 : waiting;
  }
  atPerson = Math.max(0, Math.min(atPerson, queue.length - 1));
  const person = queue[atPerson];

  const move = (by) => {
    atPerson = Math.max(0, Math.min(atPerson + by, queue.length - 1));
    clear(root);
    render(root);
  };
  const leaveMode = () => {
    presenting = false;
    clear(root);
    render(root);
  };

  /* Space and the arrows walk the room; Escape puts the table back. The keys
     are the ones a hand already on the table would reach for, and the status
     letters stay exactly what they are in the table. */
  wrap.addEventListener('keydown', (event) => {
    if (/^(input|textarea|select)$/i.test(event.target?.tagName || '')) return;
    if (event.key === ' ' || event.key === 'ArrowRight' || event.key === 'Enter') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      leaveMode();
    } else {
      const status = STATUSES.find((st) => st.key === event.key.toLowerCase() && st.id !== 'absent');
      const button = status && [...wrap.querySelectorAll('button')].find((b) => b.textContent === status.label);
      if (button) {
        event.preventDefault();
        button.click();
      }
    }
  });
  setTimeout(() => wrap.focus(), 0);

  if (!person) {
    wrap.appendChild(el('p', { class: 'rc-hint', text: 'Nobody is working that day.' }));
    return wrap;
  }

  const wasPlanned = planFor(person.id, review);
  const actual = actualByPerson.get(person.id) || null;
  const tomorrow = planFor(person.id, plan);
  const chain = wasPlanned ? ctx.chainByeId?.get(carryChainFor(wasPlanned)) : null;
  const laRow = wasPlanned?.lookahead_row_id
    ? (ctx.laRows || []).find((r) => r.id === wasPlanned.lookahead_row_id)
    : null;
  const theirs = (ctx.blockers || []).filter((b) => b.person_id === person.id);

  wrap.appendChild(el('div', { class: 'rc-present-top' }, [
    el('span', { class: 'rc-eyebrow', text: `${atPerson + 1} of ${queue.length}` }),
    el('button', { class: 'cx-btn mini ghost', text: 'Back to the table', onClick: leaveMode }),
  ]));

  wrap.appendChild(el('h2', { class: 'rc-present-who', text: person.name }));
  wrap.appendChild(el('div', { class: 'rc-hint', text: [person.title, person.subsystem].filter(Boolean).join(' · ') }));

  /* The question, in the words somebody would use. */
  wrap.appendChild(el('p', { class: 'rc-present-ask', text: askFor(wasPlanned, locs) }));

  /* What the room needs, which is not what the person needs. */
  const context = el('div', { class: 'rc-present-context' });
  if (laRow) {
    context.appendChild(badge(`BART: ${(laRow.raw_label || '').slice(0, 40)}`, 'info'));
  }
  if (chain && chain.carries >= 1) {
    context.appendChild(badge(`${ordinal(chain.carries + 1)} day on it`,
      chain.carries >= 4 ? 'bad' : 'warn'));
  }
  if (wasPlanned && !laRow) {
    context.appendChild(badge('not against a look-ahead row', 'muted'));
  }
  for (const b of theirs) {
    context.appendChild(badge(`blocked: ${b.summary.slice(0, 36)}`, 'bad'));
  }
  if (cats.get(wasPlanned?.category_id)?.name) {
    context.appendChild(badge(cats.get(wasPlanned.category_id).name, 'muted'));
  }
  if (context.children.length) wrap.appendChild(context);

  /* The answer. */
  const answer = el('div', { class: 'rc-present-answer' });
  const away = availability(person, review, leave);
  if (away.state === 'leave') {
    answer.appendChild(badge('On leave', 'muted'));
  } else if (actual) {
    const status = STATUS_BY_ID.get(actual.status);
    answer.appendChild(badge(status?.label || actual.status, status?.tone || 'muted'));
    for (const node of outcomeDetail(actual, ctx, person)) answer.appendChild(node);
  } else {
    answer.appendChild(statusButtons(ctx, person, review, wasPlanned, () => {
      clear(root);
      render(root);
    }));
  }
  wrap.appendChild(answer);

  wrap.appendChild(el('div', { class: 'rc-present-next' }, [
    el('span', { class: 'rc-eyebrow', text: `Tomorrow — ${dayLabel(plan)}` }),
    tomorrow
      ? el('div', { text: tomorrow.task || '—' })
      : el('div', { class: 'rc-hint', text: 'nothing set yet' }),
  ]));

  wrap.appendChild(el('div', { class: 'rc-present-move' }, [
    el('button', { class: 'cx-btn ghost', text: '← Back', onClick: () => move(-1), disabled: atPerson === 0 }),
    el('button', {
      class: 'cx-btn primary',
      text: atPerson === queue.length - 1 ? 'Done' : 'Next →',
      onClick: () => (atPerson === queue.length - 1 ? leaveMode() : move(1)),
    }),
  ]));

  wrap.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Space or → for the next person, ← to go back, Escape for the table. The status '
      + 'letters work here too.',
  }));

  return wrap;
}

/**
 * The meeting, written down.
 *
 * A huddle answers three questions and then evaporates: what happened, what is
 * next, and what is still in the way. The answers are all in the database
 * afterwards, which is not the same as anybody having read them — the people
 * who most need them are the ones who were not in the room.
 *
 * So the same three questions, as text somebody can paste into whatever their
 * project actually talks in. Plain text on purpose: a PDF nobody opens is
 * worse than four lines in a message, and this has to survive being forwarded.
 *
 * It carries no KPI and no rate. Those are a different audience and a
 * different permission, and the moment a digest carries a percentage against
 * somebody's name it stops being a summary and starts being a review.
 */
function digestText(ctx) {
  const { people, review, plan, planFor, actualByPerson, locs, leave, blockers, chainByeId } = ctx;
  const lines = [];
  const bullet = { completed: '✓', partial: '~', carried: '→', blocked: '!', reassigned: '↔' };

  lines.push(`Huddle — ${dayLabel(plan, 'medium')}`);
  lines.push('');
  lines.push(`What happened — ${dayLabel(review, 'medium')}`);

  const silent = [];
  for (const person of people) {
    const away = availability(person, review, leave);
    if (away.state === 'leave') {
      lines.push(`  · ${person.name} — on leave`);
      continue;
    }
    if (away.state === 'non-working') continue;

    const actual = actualByPerson.get(person.id);
    if (!actual) {
      silent.push(person.name);
      continue;
    }
    const status = STATUS_BY_ID.get(actual.status);
    const said = [actual.blocked_reason, actual.note].filter(Boolean).join(' — ');
    const where = locs.get(actual.location_id)?.name;
    lines.push(`  ${bullet[actual.status] || '·'} ${person.name} — ${status?.label || actual.status}`
      + `${where ? ` at ${where}` : ''}${said ? `: ${said}` : ''}`);
  }
  // Named rather than silently missing. "Nobody said" is a fact about the
  // meeting, and leaving it out is how a gap becomes a claim that everything
  // went fine.
  if (silent.length) lines.push(`  · nothing recorded for ${silent.join(', ')}`);

  lines.push('');
  lines.push(`What is next — ${dayLabel(plan, 'medium')}`);
  const unset = [];
  for (const person of people) {
    if (availability(person, plan, leave).state !== 'available') continue;
    const next = planFor(person.id, plan);
    if (!next) {
      unset.push(person.name);
      continue;
    }
    const chain = next.carry_chain_id ? chainByeId?.get(next.carry_chain_id) : null;
    const where = locs.get(next.location_id)?.name;
    lines.push(`  ${person.name} — ${next.task || '—'}${where ? ` at ${where}` : ''}`
      + `${chain && chain.carries >= 1 ? ` (${ordinal(chain.carries + 1)} day on it)` : ''}`);
  }
  if (unset.length) lines.push(`  · nothing set yet for ${unset.join(', ')}`);

  const open = (blockers || []).filter((b) => b.state !== 'resolved');
  lines.push('');
  lines.push(open.length ? `What is in the way — ${open.length}` : 'What is in the way — nothing');
  for (const b of open) {
    const who = (ctx.everybody || people).find((p) => p.id === b.owner_id)?.name;
    lines.push(`  ${b.summary} — ${(people.find((p) => p.id === b.person_id) || {}).name || 'the team'}`
      + `${who ? ` · ${who} chasing` : ' · nobody chasing it'}`
      + `${b.due_date ? ` · expected by ${dayLabel(b.due_date)}` : ''}`
      + ` · day ${Math.max(1, Number(b.age_days) || 1)}`);
  }

  return lines.join('\n');
}

/**
 * Show it before it is sent.
 *
 * Copy *and* save, because the two go to different places — a message to the
 * team, and a file beside the week's evidence — and neither is a good default
 * for the other. The text is editable in the box: somebody about to send this
 * to a client knows something the database does not.
 */
function openDigest(ctx) {
  const text = digestText(ctx);
  const box = el('textarea', { class: 'cx-textarea', rows: 18, spellcheck: 'false' });
  box.value = text;

  const copy = el('button', {
    class: 'cx-btn mini',
    text: 'Copy it',
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(box.value);
        toast({ tone: 'good', message: 'Copied — paste it wherever the team talks.' });
      } catch {
        // A denied clipboard is not a failure to produce the digest. It is
        // already on screen and selectable, so say that rather than nothing.
        box.select();
        toast({ tone: 'warn', message: 'The clipboard was refused — it is selected, copy it by hand.' });
      }
    },
  });
  const save = el('button', {
    class: 'cx-btn mini ghost',
    text: 'Save it',
    onClick: () => saveFile(`huddle-${ctx.plan}.txt`, box.value, 'text/plain'),
  });

  formModal({
    title: 'The meeting, written down',
    body: el('div', { class: 'cx-form' }, [
      el('p', {
        class: 'rc-hint',
        text: 'What happened, what is next, and what is still in the way — for the people who '
          + 'were not in the room. No rates and no scores: those are a different audience.',
      }),
      box,
      el('div', { style: 'display:flex;gap:6px' }, [copy, save]),
    ]),
    confirmLabel: 'Done',
    onConfirm: () => {},
  });
}

function dateBar(date, review, plan, root, ctx) {
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
    el('button', {
      class: 'cx-btn mini',
      text: 'Run the meeting',
      title: 'One person at a time, large enough for the room. Space or → for the next.',
      onClick: () => {
        presenting = true;
        atPerson = null;
        clear(root);
        render(root);
      },
    }),
    el('button', {
      class: 'cx-btn mini ghost',
      text: 'Digest',
      title: 'What happened, what is next and what is in the way — as text to paste.',
      onClick: () => openDigest(ctx),
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
  const { person, review, plan, planFor, actualByPerson, cats, locs, leave, root, chainByeId } = ctx;

  // Focusable, so the whole meeting can be run from the keyboard: down the
  // roster with the arrows, one letter per outcome. Fifteen people at a fixed
  // time is a lot of clicking otherwise.
  const row = el('tr', { tabindex: '-1', class: 'rc-huddle-row' });

  /* One letter per outcome, on the row that has focus. The keys are the ones
     already published beside each button (`c`, `p`, `x`, `b`, `r`), so the
     shortcut is the label rather than a second thing to learn. Arrows walk the
     roster. A field that is being typed into keeps its keystrokes. */
  row.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const inField = /^(input|textarea|select)$/i.test(event.target?.tagName || '');
    if (inField) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const next = event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      if (next) {
        event.preventDefault();
        next.focus();
      }
      return;
    }

    const status = STATUSES.find((st) => st.key === event.key.toLowerCase() && st.id !== 'absent');
    if (!status) return;
    const button = [...row.querySelectorAll('button')].find((b) => b.textContent === status.label);
    if (!button) return;
    event.preventDefault();
    button.click();
  });
  const redraw = () => {
    const next = personRow(ctx);
    row.replaceWith(next);
  };

  const away = availability(person, review, leave);
  const wasPlanned = planFor(person.id, review);
  const actual = actualByPerson.get(person.id) || null;
  const tomorrow = planFor(person.id, plan);
  const admin = rc.isAdmin();
  // A viewer has a person row, so "is this my row" is true for them too. Asking
  // whether they may write at all is the difference between read-only and not,
  // and it is the same question `rc_can_act_for()` answers in the database.
  const mine = person.id === rc.me()?.id && rc.canWrite();

  /* Name, and why they are not being asked for a goal.
     `data-label` is what the header row becomes on a narrow screen, where the
     table is stacked into a card per person — see the 620px rule. */
  row.appendChild(el('td', {}, [
    el('div', { text: person.name }),
    el('div', { class: 'rc-hint', text: person.subsystem || person.title || '' }),
  ]));

  /* What they were supposed to be doing — the promise the outcome answers.
     The chain age rides with it: a task on its fourth day is a different
     conversation from one on its first, and that was only visible in a report
     the field team cannot open. */
  const chain = wasPlanned ? chainByeId?.get(carryChainFor(wasPlanned)) : null;
  row.appendChild(el('td', { 'data-label': 'Was planned' }, [
    wasPlanned
      ? el('div', {}, [
        el('div', { text: wasPlanned.task || '—' }),
        el('div', { class: 'rc-hint' }, [
          el('span', { text: [locs.get(wasPlanned.location_id)?.name,
            cats.get(wasPlanned.category_id)?.name,
            wasPlanned.shift !== 'day' ? wasPlanned.shift : null].filter(Boolean).join(' · ') }),
        ]),
        chain && chain.carries >= 2
          ? badge(`${ordinal(chain.carries + 1)} day`, chain.carries >= 4 ? 'bad' : 'warn')
          : null,
      ].filter(Boolean))
      : el('span', { class: 'rc-hint', text: 'nothing planned' }),
  ]));

  /* What happened. Absence is answered from the leave record rather than
     asked for — somebody on leave did not carry anything over, and letting
     that fall into a performance status is exactly what the five-way split
     exists to prevent. */
  const outcome = { 'data-label': 'What happened' };
  if (away.state === 'leave') {
    row.appendChild(el('td', outcome, [badge('On leave', 'muted')]));
  } else if (away.state === 'non-working') {
    row.appendChild(el('td', outcome, [el('span', { class: 'rc-hint', text: 'not a working day' })]));
  } else if (actual) {
    const status = STATUS_BY_ID.get(actual.status);
    row.appendChild(el('td', outcome, [
      badge(status?.label || actual.status, status?.tone || 'muted'),
      ...outcomeDetail(actual, ctx, person),
    ]));
  } else if (admin || mine) {
    row.appendChild(el('td', outcome, [statusButtons(ctx, person, review, wasPlanned, redraw)]));
  } else {
    row.appendChild(el('td', outcome, [el('span', { class: 'rc-hint', text: '—' })]));
  }

  /* Tomorrow. */
  row.appendChild(el('td', { 'data-label': 'Tomorrow' }, [
    tomorrow
      ? el('div', {}, [
        el('div', { text: tomorrow.task || '—' }),
        el('div', { class: 'rc-hint', text: locs.get(tomorrow.location_id)?.name || '' }),
        tomorrow.carry_chain_id ? badge('Carried over', 'warn') : null,
      ].filter(Boolean))
      : admin
        ? el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' }, [
          el('button', {
            class: 'cx-btn mini ghost',
            text: 'Set goal',
            onClick: () => setGoal(ctx, person, plan, root),
          }),
          /* Most days most people are on the same task at the same place. One
             button beats four fields, and it is the difference between a
             fifteen-minute meeting and a forty-minute one. */
          wasPlanned ? el('button', {
            class: 'cx-btn mini ghost',
            text: 'Same again',
            title: `Repeat "${wasPlanned.task || 'yesterday\u2019s task'}" tomorrow.`,
            onClick: async () => {
              await rollForward(wasPlanned, person, plan, null);
              notifyChanged('plan');
              clear(root);
              render(root);
            },
          }) : null,
        ].filter(Boolean))
        : el('span', { class: 'rc-hint', text: '—' }),
  ]));

  return row;
}

/**
 * Everything an outcome says, once it has been recorded.
 *
 * One function because the table and the meeting must never read differently —
 * the room is looking at one of them while somebody types into the other.
 *
 * Two of these are new and both answer questions that used to be asked out
 * loud. **Who recorded it** matters because most days somebody speaks and
 * somebody else types, and an outcome attributed to the person who entered it
 * is how a record stops being trusted; it is shown only when the two differ,
 * which is the only case anybody wonders about. And **the photograph** is the
 * whole reason evidence was worth attaching in the first place — a link that
 * is signed when it is clicked rather than when the page is drawn, so a huddle
 * left open all morning does not accumulate expiring URLs.
 */
function outcomeDetail(actual, ctx, person) {
  const out = [];
  if (actual.blocked_reason) out.push(el('div', { class: 'rc-hint', text: actual.blocked_reason }));
  if (actual.note) out.push(el('div', { class: 'rc-hint', text: actual.note }));

  if (actual.evidence_path) {
    out.push(el('button', {
      class: 'cx-btn mini ghost rc-evidence',
      html: `${icon('paperclip', { size: 11 })}<span>Photo</span>`,
      title: 'Open the photograph taken with this outcome',
      onClick: async (event) => {
        event.stopPropagation();
        try {
          window.open(await rc.evidenceUrl(actual.evidence_path), '_blank', 'noopener');
        } catch (err) {
          toast({ tone: 'bad', message: `That photograph could not be opened — ${err.message}` });
        }
      },
    }));
  }

  const by = (ctx.everybody || ctx.people || []).find((p) => p.user_id && p.user_id === actual.created_by);
  if (by && by.id !== person?.id) {
    out.push(el('div', { class: 'rc-hint', text: `recorded by ${by.name}` }));
  }
  return out;
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
      title: (status.family === 'health'
        ? 'Programme health — never counted against the individual'
        : 'Counts toward individual efficiency')
        + `  ·  press ${status.key} with this row selected`,
      onClick: () => {
        if (status.id === 'blocked') {
          blockedDialog(ctx, person, date, plannedEntry, redraw);
          return;
        }
        /* A finished task has nothing left to say about it, so it stays one
           click. Anything else does — "partial" with no note is a number
           nobody can act on in the morning — so the buttons give way to a
           line asking for it, pre-filled with the plan so it is an edit
           rather than a retype. */
        if (status.id === 'completed') {
          commitOutcome({ ctx, person, date, plannedEntry, status, redraw });
          return;
        }
        clear(wrap);
        wrap.appendChild(sayMore({ ctx, person, date, plannedEntry, status, redraw, host: wrap }));
      },
    }));
  }
  return wrap;
}

/**
 * The line between pressing a status and it being recorded.
 *
 * Two things go on it: what is left of the task, pre-filled with the plan
 * text, and a photograph. Neither is required and neither can lose the
 * outcome — pressing the status *was* the record, so every way out of here
 * writes it, including Escape and walking away to the next person. What
 * changes is only whether anything was said with it.
 *
 * That is the opposite of a dialog, deliberately. A dialog somebody dismisses
 * loses the answer, and the one thing this meeting cannot afford is an outcome
 * that looks recorded and is not.
 */
function sayMore({ ctx, person, date, plannedEntry, status, redraw, host }) {
  const strip = el('div', { class: 'rc-saymore' });
  let done = false;

  const note = textInput({
    value: status.id === 'carried' || status.id === 'partial' ? (plannedEntry?.task || '') : '',
    placeholder: status.id === 'reassigned' ? 'What they did instead' : 'What is left',
  });
  const photo = el('input', {
    type: 'file',
    accept: 'image/*',
    // Opens the camera on a phone rather than the file browser, which is the
    // device this meeting is actually run from.
    capture: 'environment',
    class: 'rc-saymore-photo',
    'aria-label': 'Attach a photograph',
  });

  const commit = () => {
    if (done) return;
    done = true;
    commitOutcome({
      ctx, person, date, plannedEntry, status, redraw,
      note: note.value.trim() || null,
      file: photo.files?.[0] || null,
    });
  };

  strip.appendChild(el('span', { class: 'rc-eyebrow', text: status.label }));
  strip.appendChild(note);
  strip.appendChild(el('label', { class: 'cx-btn mini ghost rc-saymore-clip', title: 'Attach a photograph' }, [
    el('span', { html: icon('paperclip', { size: 12 }) }),
    photo,
  ]));
  strip.appendChild(el('button', { class: 'cx-btn mini primary', text: 'Record', onClick: commit }));

  strip.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') note.value = '';
      commit();
    }
  });
  // Moving on records it. Somebody who presses "partial" and goes straight to
  // the next person has answered the question; the note was the optional part.
  strip.addEventListener('focusout', (event) => {
    if (!strip.contains(event.relatedTarget)) commit();
  });

  setTimeout(() => {
    note.focus();
    note.setSelectionRange(note.value.length, note.value.length);
  }, 0);
  if (host) host.classList.add('rc-saymore-host');
  return strip;
}

/**
 * Write one outcome, and the photograph that goes with it.
 *
 * The picture goes up *first*, under the uuid the row is about to carry:
 * `rc_actuals` has no UPDATE grant, so a path attached afterwards would need a
 * second row superseding the first. An upload that fails is said out loud and
 * the outcome is still recorded — losing what somebody said because a
 * photograph did not upload would be the wrong way round.
 */
async function commitOutcome({ ctx, person, date, plannedEntry, status, redraw, note = null, file = null }) {
  const clientUuid = newUuid();
  const chainId = status.id === 'carried' ? carryChainFor(plannedEntry) : null;

  let evidencePath = null;
  if (file) {
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase();
    try {
      evidencePath = await rc.uploadEvidence(`${clientUuid}.${ext}`, file);
    } catch (err) {
      toast({ tone: 'warn', message: `The outcome is recorded; the photograph is not — ${err.message}` });
    }
  }

  const { sent, error } = await record({
    clientUuid,
    personId: person.id,
    date,
    status: status.id,
    note,
    categoryId: plannedEntry?.category_id || null,
    locationId: plannedEntry?.location_id || null,
    planEntryId: plannedEntry?.id || null,
    carryChainId: chainId,
    evidencePath,
  });
  if (!sent) toast({ tone: 'warn', message: `Saved locally — ${error.message}` });

  /* A carried task is going to be done tomorrow, and re-typing it is both slow
     and how the chain used to get broken. Rolling it forward here is the only
     place that knows both the outcome and the entry it came from. */
  if (chainId && plannedEntry && !ctx.planFor(person.id, ctx.plan)) {
    try {
      await rollForward(plannedEntry, person, ctx.plan, chainId);
      notifyChanged('plan');
      clear(ctx.root);
      render(ctx.root);
      return;
    } catch (err) {
      toast({ tone: 'warn', message: `Recorded, but tomorrow was not set — ${err.message}` });
    }
  }
  notifyChanged('actuals');
  redraw();
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
  // The chain the entry already belongs to, or a new one starting here. Taking
  // the id blindly is what made a five-day stuck job read as five separate
  // failures: rolling it forward makes a new entry, and the next carry would
  // have started over.
  return plannedEntry.carry_chain_id || plannedEntry.id;
}

/**
 * Put a task on tomorrow.
 *
 * `chainId` carries a carry chain across the roll — that is the whole reason
 * this is one function rather than two: repeating a task and carrying one over
 * write the same row, and only the chain tells them apart afterwards.
 */
async function rollForward(from, person, date, chainId) {
  await rc.addPlanEntries([{
    person_id: person.id,
    work_date: date,
    shift: from?.shift || 'day',
    location_id: from?.location_id || null,
    task: from?.task || null,
    category_id: from?.category_id || null,
    lookahead_row_id: from?.lookahead_row_id || null,
    carry_chain_id: chainId,
  }]);
}

/** 1st, 2nd, 3rd, 4th — for "the fourth day running". */
function ordinal(n) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

function blockedDialog(ctx, person, date, plannedEntry, redraw) {
  const reason = textInput({ placeholder: 'What stopped it' });
  const owner = selectInput({
    value: rc.me()?.id || '',
    placeholder: '— nobody yet —',
    options: (ctx.everybody || ctx.people || []).map((p) => ({ value: p.id, label: p.name })),
  });
  const due = el('input', { type: 'date', class: 'cx-input' });
  const party = selectInput({
    value: ctx.parties[0]?.id,
    options: ctx.parties.map((p) => ({ value: p.id, label: p.name })),
  });

  /* Which look-ahead row this was blocked against.
     Optional, and offered rather than chosen: "blocked by BART" is an
     assertion, and "blocked on the row BART themselves scheduled for that
     location that week" is a document. The list is narrowed to the location
     already on the plan where there is one — matching on date and location,
     never on the activity text, which is the rule everywhere in this module. */
  const candidates = (ctx.laRows || []).filter((r) => (
    !plannedEntry?.location_id || !r.location_id || r.location_id === plannedEntry.location_id
  ));
  const laRow = candidates.length
    ? selectInput({
      value: plannedEntry?.lookahead_row_id || '',
      placeholder: '— not against a look-ahead row —',
      options: candidates.map((r) => ({
        value: r.id,
        label: [r.raw_location, r.raw_label].filter(Boolean).join(' · ').slice(0, 70) || `row ${r.sheet_row}`,
      })),
    })
    : null;

  /* A photograph of what stopped it. The single most useful thing in the file
     a year later, and the moment it can be taken is now — the same upload path
     an outcome uses, so there is one bucket and one rule. */
  const photo = el('input', {
    type: 'file', accept: 'image/*', capture: 'environment', class: 'cx-input',
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
      /* The two fields that decide whether anything happens about it. Asked
         here because this is the only moment somebody is definitely thinking
         about it — a blocker raised without an owner is a grievance, and the
         list of those only ever grows. */
      el('div', { class: 'cx-field' }, [
        el('label', { class: 'cx-label', text: 'Who will chase it' }), owner,
        el('div', { class: 'cx-hint', text: 'It stays on the huddle until somebody closes it.' }),
      ]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Expected by' }), due]),
      el('div', { class: 'cx-field' }, [
        el('label', { class: 'cx-label', text: 'Photograph' }), photo,
        el('div', { class: 'cx-hint', text: 'Optional. It is what the reason will rest on later.' }),
      ]),
      laRow
        ? el('div', { class: 'cx-field' }, [
          el('label', { class: 'cx-label', text: 'Against which look-ahead row' }),
          laRow,
          el('div', {
            class: 'cx-hint',
            text: 'Optional, and never guessed. Naming it is what turns a note in a meeting '
              + 'into evidence somebody can stand behind a year later.',
          }),
        ])
        : null,
    ].filter(Boolean)),
    confirmLabel: 'Record',
    onConfirm: async () => {
      if (!reason.value.trim()) throw new Error('A reason is needed.');
      const clientUuid = newUuid();

      // Before the row, under the uuid it is about to carry: the table has no
      // UPDATE grant, so a path attached afterwards would need a second row.
      let evidencePath = null;
      const file = photo.files?.[0] || null;
      if (file) {
        const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase();
        try {
          evidencePath = await rc.uploadEvidence(`${clientUuid}.${ext}`, file);
        } catch (err) {
          toast({ tone: 'warn', message: `The block is recorded; the photograph is not — ${err.message}` });
        }
      }

      const entry = {
        clientUuid,
        personId: person.id,
        date,
        status: 'blocked',
        categoryId: plannedEntry?.category_id || null,
        locationId: plannedEntry?.location_id || null,
        planEntryId: plannedEntry?.id || null,
        blockedReason: reason.value.trim(),
        blockedPartyId: party.value,
        lookaheadRowId: laRow?.value || null,
        evidencePath,
      };
      const { sent, error } = await record(entry);
      if (!sent) toast({ tone: 'warn', message: `Saved locally — ${error.message}` });

      /* The outcome says a day was lost; the blocker is the thing somebody has
         to do about it. Raised separately and after, so a failure here leaves
         the outcome standing rather than losing both — the meeting has moved
         on by the time anything is retried. */
      if (sent) {
        try {
          const raised = await rc.raiseBlocker({
            person_id: person.id,
            location_id: plannedEntry?.location_id || null,
            lookahead_row_id: laRow?.value || null,
            summary: reason.value.trim(),
            party_id: party.value || null,
            raised_on: date,
          });
          if (owner.value || due.value) {
            await rc.updateBlocker({
              blocker_id: raised.id,
              state: 'open',
              owner_id: owner.value || null,
              due_date: due.value || null,
            });
          }
        } catch (err) {
          toast({
            tone: 'warn',
            message: `Recorded, but it is not on the blocker list — ${err.message}`,
            timeout: 10000,
          });
        }
      }

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

  const [people, locations, leave, planRows, laRows, categories] = await Promise.all([
    rc.listPeople({ scheduledOnly: true }),
    rc.listLocations(),
    // Three weeks out, not one: you find out somebody is off when you try to
    // staff the day, which is a fortnight too late to do anything about it.
    rc.listLeave(from, toISO(addDays(startMs, 20))),
    rc.listPlan(from, to),
    // What BART has asked for this week. Administrators only, so a member sees
    // the plan without the demand behind it, which is correct.
    rc.lookaheadForWeek(from).catch(() => []),
    rc.listCategories(),
  ]);
  const locs = byId(locations);
  const thisWeek = leave.filter((l) => l.start_date <= to && l.end_date >= from);
  const soon = leave.filter((l) => l.start_date > to);

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
    people.filter((p) => availability(p, iso, thisWeek).state === 'available').length);

  const body = el('tbody');
  for (const person of people) {
    const cells = days.map((iso) => {
      const state = availability(person, iso, thisWeek);
      const entry = planRows.find((p) => p.person_id === person.id && p.work_date === iso);
      if (state.state === 'leave') return el('td', {}, [badge('Leave', 'muted')]);
      if (state.state === 'non-working') return el('td', { class: 'rc-inactive' }, [el('span', { text: '·' })]);
      if (!entry) {
        return el('td', {}, [rc.isAdmin() && laRows.length
          ? el('button', {
            class: 'cx-btn mini ghost',
            text: '+',
            'aria-label': `Plan ${person.name} for ${dayLabel(iso)}`,
            title: 'Plan this day from what the look-ahead asks for.',
            onClick: () => planFromLookahead({
              person, iso, laRows, locations, categories, locs, root,
            }),
          })
          : el('span', { class: 'rc-hint', text: '—' })]);
      }
      return el('td', {
        class: rc.isAdmin() ? 'rc-clickable' : '',
        title: rc.isAdmin() ? 'Revise this — the outgoing version stays on the record.' : '',
        onClick: rc.isAdmin()
          ? () => revisePlan(entry, person, { locations, categories, locs, root })
          : null,
      }, [
        el('div', { text: entry.task || '—' }),
        el('div', { class: 'rc-hint', text: locs.get(entry.location_id)?.name || '' }),
        entry.lookahead_row_id ? badge('From look-ahead', 'info') : null,
        entry.supersedes_id ? badge('Revised', 'warn') : null,
      ].filter(Boolean));
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

  if (soon.length) {
    const byPerson = byId(people);
    root.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Coming up: ' + soon
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
        .slice(0, 6)
        .map((l) => `${byPerson.get(l.person_id)?.name || 'somebody'} from ${dayLabel(l.start_date)}`)
        .join(', ')
        + '. Two weeks past the end of this one, because finding out when you try to staff '
        + 'the day is a fortnight too late to do anything about it.',
    }));
  }

  root.appendChild(el('p', {
    class: 'rc-hint',
    text: laRows.length
      ? `The look-ahead asks for ${laRows.length} row(s) this week. The + on an empty day plans `
        + 'against one of them, and the plan then carries the link — which is what lets a block '
        + 'later be recorded against the row BART themselves scheduled.'
      : 'Nothing read from the look-ahead for this week yet. Read it in Look-ahead → Check now '
        + 'and the empty days here will offer what it asks for.',
  }));

  root.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Leave sits in the grid rather than in a calendar of its own, so a clash is '
      + 'visible rather than merely flagged. The bottom row is what stops work being '
      + 'promised for a day it cannot be staffed.',
  }));
}

/**
 * Change a day that is already planned.
 *
 * Never an update. The outgoing row stays and the new one points at it, so
 * "the plan changed the evening before the shift" is a thing the record can
 * still say a year later — which is the whole reason the table is append-only.
 * `rc_supersede_plan()` refuses to revise an entry that has already been
 * revised, so two people editing the same day get a refusal rather than one of
 * them silently winning.
 *
 * The history is shown because it is the point: a revision nobody can see is
 * an edit with extra steps.
 */
async function revisePlan(entry, person, { locations, categories, locs, root }) {
  const history = await rc.planHistory(person.id, entry.work_date).catch(() => []);

  const task = textInput({ value: entry.task || '', placeholder: 'What they will do' });
  const location = selectInput({
    value: entry.location_id || '',
    placeholder: '— location —',
    options: locations.map((l) => ({ value: l.id, label: l.name })),
  });
  const category = selectInput({
    value: entry.category_id || '',
    placeholder: '— category —',
    options: categories.map((c) => ({ value: c.id, label: c.name })),
  });
  const shift = selectInput({
    value: entry.shift || 'day',
    options: SHIFTS.map((sh) => ({ value: sh.id, label: sh.label })),
  });

  formModal({
    title: `${person.name} — ${dayLabel(entry.work_date, 'medium')}`,
    body: el('div', { class: 'cx-form' }, [
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Task' }), task]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Location' }), location]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Category' }), category]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Shift' }), shift]),
      history.length > 1
        ? el('div', { class: 'cx-field' }, [
          el('label', { class: 'cx-label', text: `Already revised ${history.length - 1} time(s)` }),
          el('div', { class: 'rc-hint' }, history.map((h) => el('div', {
            text: `${(h.created_at || '').slice(0, 16).replace('T', ' ')} — ${h.task || '—'}`
              + `${locs.get(h.location_id)?.name ? ` · ${locs.get(h.location_id).name}` : ''}`,
          }))),
        ])
        : null,
      el('p', {
        class: 'rc-hint',
        text: 'The version you are replacing stays on the record. A plan that changed the '
          + 'evening before a shift is itself delay evidence, so nothing here overwrites '
          + 'anything — and an entry somebody else has already revised is refused rather than '
          + 'quietly losing one of the two changes.',
      }),
    ].filter(Boolean)),
    confirmLabel: 'Revise',
    onConfirm: async () => {
      if (!task.value.trim()) throw new Error('A task is needed.');
      await rc.supersedePlan(entry.id, {
        locationId: location.value || null,
        task: task.value.trim(),
        categoryId: category.value || null,
        shift: shift.value,
      });
      notifyChanged('plan');
      clear(root);
      renderWeek(root);
    },
  });
}

/**
 * Plan a day from what the look-ahead asks for.
 *
 * The look-ahead says what is wanted and where; it never says who, because it
 * does not know the team. So it proposes and a person assigns — which is also
 * the only honest shape, given a plan entry has to name somebody and inventing
 * that would be the guess this module refuses everywhere else.
 *
 * The chosen row rides along on the entry, so a block recorded against it later
 * points at the row BART themselves scheduled rather than at a description
 * somebody typed.
 */
function planFromLookahead({ person, iso, laRows, locations, categories, locs, root }) {
  const wanted = laRows.filter((r) => !r.cells || !Object.keys(r.cells).length || r.cells[iso]);
  const rows = wanted.length ? wanted : laRows;

  const pick = selectInput({
    value: '',
    placeholder: '— nothing from the look-ahead —',
    options: rows.map((r) => ({
      value: r.id,
      label: [r.raw_location || locs.get(r.location_id)?.name, r.raw_label]
        .filter(Boolean).join(' · ').slice(0, 70) || `row ${r.sheet_row}`,
    })),
  });
  const task = textInput({ placeholder: 'What they will do' });
  const location = selectInput({
    value: '',
    placeholder: '— location —',
    options: locations.map((l) => ({ value: l.id, label: l.name })),
  });
  const category = selectInput({
    value: '',
    placeholder: '— category —',
    options: categories.map((c) => ({ value: c.id, label: c.name })),
  });
  const shift = selectInput({ value: 'day', options: SHIFTS.map((sh) => ({ value: sh.id, label: sh.label })) });

  // Choosing a row fills the rest in. It is a starting point, not a lock —
  // what the look-ahead calls an activity and what you would tell somebody to
  // do are rarely the same sentence.
  pick.addEventListener('change', () => {
    const row = rows.find((r) => r.id === pick.value);
    if (!row) return;
    if (!task.value.trim()) task.value = row.raw_label || '';
    if (row.location_id) location.value = row.location_id;
    const meaning = String(row.cells?.[iso] || '').toLowerCase();
    if (/night/.test(meaning)) shift.value = 'night';
    else if (/possession|blanket/.test(meaning)) shift.value = 'possession';
  });

  formModal({
    title: `${person.name} — ${dayLabel(iso, 'medium')}`,
    body: el('div', { class: 'cx-form' }, [
      el('div', { class: 'cx-field' }, [
        el('label', { class: 'cx-label', text: 'From the look-ahead' }), pick,
        el('div', {
          class: 'cx-hint',
          text: 'What BART asked for on this day. Choosing one fills the rest in and keeps the '
            + 'link; the plan still says who, because the look-ahead has no idea who is on your team.',
        }),
      ]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Task' }), task]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Location' }), location]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Category' }), category]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Shift' }), shift]),
    ]),
    confirmLabel: 'Plan it',
    onConfirm: async () => {
      if (!task.value.trim()) throw new Error('A task is needed.');
      await rc.addPlanEntries([{
        person_id: person.id,
        work_date: iso,
        shift: shift.value,
        location_id: location.value || null,
        task: task.value.trim(),
        category_id: category.value || null,
        lookahead_row_id: pick.value || null,
      }]);
      notifyChanged('plan');
      clear(root);
      renderWeek(root);
    },
  });
}
