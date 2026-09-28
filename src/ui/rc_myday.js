/**
 * My day — the calendar for one person: today, the next working day, and the
 * rest of the week at a glance.
 *
 * Everything else in the calendar is about the team: a grid of people down and
 * days across, a meeting that goes round the room. Somebody opening it on a
 * phone at six in the morning wants one answer — where am I today, on what,
 * with whom, and what about tomorrow — and had to find their own row to get it.
 *
 * It is a reading, not a second plan. The day comes from `assignmentIndex()`,
 * the same function the week plan and the huddle read, so the 4WLA's names rows
 * are the plan for the days they name and a stored entry is somebody overriding
 * it. **Outcomes are shown, not recorded:** the huddle is the one path an
 * outcome is entered through, and a second one here would be two that could
 * disagree on screen. What was recorded against your last day is shown, as the
 * week plan shows it.
 *
 * Imports: util, dates, rc, icons, components, rc_util, rc_activity.
 */

import { el } from '../core/util.js';
import { toISO, addDays } from '../core/dates.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import { badge, emptyState } from './components.js';
import { openActivity } from './rc_activity.js';
import {
  byId, dayLabel, todayISO, isoToMs, weekStart, goToTab, STATUS_BY_ID, SHIFTS, nameRegister,
  assignmentIndex, availability, lookaheadWithResources,
} from './rc_util.js';

const ABSENCE_WORDS = { pto: 'Off — on the PTO row', office: 'In the office', other: 'On another project' };

/** The next day this person works, after `iso`. */
function nextWorkingDay(person, iso) {
  const working = Array.isArray(person?.working_days) ? person.working_days : [1, 2, 3, 4, 5];
  let ms = addDays(isoToMs(iso), 1);
  for (let i = 0; i < 14; i++) {
    const weekday = new Date(ms).getUTCDay() || 7;
    if (working.includes(weekday)) return toISO(ms);
    ms = addDays(ms, 1);
  }
  return toISO(addDays(isoToMs(iso), 1));
}

export async function render(root) {
  const who = rc.me();
  const today = todayISO();
  const monday = toISO(weekStart(isoToMs(today)));

  const [everybody, aliases] = await Promise.all([
    rc.listPeople({ includeInactive: true }).catch(() => []),
    rc.listPersonAliases().catch(() => []),
  ]);
  const person = everybody.find((p) => p.id === who?.id) || who;
  const next = nextWorkingDay(person, today);
  // The week and whatever the next working day reaches into.
  const until = [toISO(addDays(isoToMs(monday), 6)), next].sort().pop();

  const [planRows, sheet, leave, actuals, locations, categories, blockers] = await Promise.all([
    rc.listPlan(monday, until).catch(() => []),
    lookaheadWithResources(monday, toISO(addDays(weekStart(isoToMs(until)), 6))).catch(() => ({ rows: [], absences: [] })),
    rc.listLeave(monday, until).catch(() => []),
    rc.listActuals(toISO(addDays(isoToMs(today), -14)), today).catch(() => []),
    rc.listLocations({ includeInactive: true }).catch(() => []),
    rc.listCategories().catch(() => []),
    rc.listBlockers().catch(() => []),
  ]);

  const index = assignmentIndex({
    planRows,
    laRows: sheet.rows,
    absences: sheet.absences,
    categories,
    register: nameRegister(everybody, aliases),
  });
  const locs = byId(locations);
  const names = byId(everybody);

  const laRowById = new Map((sheet.rows || []).map((r) => [r.id, r]));
  const ctx = { person, index, leave, locs, names, planRows, laRowById };

  /* ── Greeting ─────────────────────────────────────────────────────── */
  const first = String(person?.name || '').trim().split(/\s+/)[0] || 'there';
  root.appendChild(el('div', { class: 'rc-myday-head' }, [
    el('div', {}, [
      el('div', { class: 'rc-eyebrow', text: dayLabel(today, 'dayFull') }),
      el('h2', { class: 'rc-myday-hello', text: `${greeting()}, ${first}` }),
    ]),
    el('button', {
      class: 'cx-btn mini ghost', type: 'button',
      html: `${icon('calendar', { size: 12 })}<span>My week plan</span>`,
      onClick: () => goToTab('week'),
    }),
  ]));

  const cards = el('div', { class: 'rc-myday-cards' }, [
    dayCard(ctx, today, 'Today'),
    dayCard(ctx, next, next === toISO(addDays(isoToMs(today), 1)) ? 'Tomorrow' : `Next working day`),
  ]);
  root.appendChild(cards);

  /* ── The week at a glance ─────────────────────────────────────────── */
  root.appendChild(weekStrip(ctx, monday, today));

  /* ── What was said about your last day ────────────────────────────── */
  const mine = actuals
    .filter((a) => a.person_id === person?.id)
    .sort((a, b) => String(b.work_date).localeCompare(String(a.work_date)));
  const last = mine[0];
  const owned = blockers.filter((b) => b.owner_id === person?.id);
  root.appendChild(el('div', { class: 'rc-myday-foot' }, [
    el('section', { class: 'rc-myday-note', 'aria-label': 'Your last recorded day' }, [
      el('h3', { text: 'Your last recorded day' }),
      last
        ? el('div', { class: 'rc-myday-outcome' }, [
          badge(STATUS_BY_ID.get(last.status)?.label || last.status, STATUS_BY_ID.get(last.status)?.tone || 'neutral'),
          el('span', { text: dayLabel(String(last.work_date).slice(0, 10)) }),
          last.task ? el('span', { class: 'rc-hint', text: last.task }) : null,
          last.note ? el('div', { class: 'rc-myday-said', text: `“${last.note}”` }) : null,
        ].filter(Boolean))
        : el('p', { class: 'rc-hint', text: 'Nothing recorded in the last fortnight.' }),
      el('p', { class: 'rc-hint', text: 'Outcomes are recorded in the daily huddle.' }),
    ]),
    owned.length
      ? el('section', { class: 'rc-myday-note', 'aria-label': 'Blockers you are chasing' }, [
        el('h3', { text: 'You are chasing' }),
        ...owned.map((b) => el('div', { class: 'rc-myday-blocker' }, [
          badge('Blocked', 'bad'),
          el('span', { text: b.summary || 'A blocked day' }),
          b.due_date ? el('span', { class: 'rc-hint', text: `due ${dayLabel(String(b.due_date).slice(0, 10))}` }) : null,
        ].filter(Boolean))),
      ])
      : null,
  ].filter(Boolean)));
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * One day, for one person: every task on it, where, on which shift and with
 * whom — or that they are off, and why.
 */
function dayCard({ person, index, leave, locs, names, planRows, laRowById }, iso, title) {
  const card = el('section', { class: 'rc-myday-card', 'aria-label': `${title}, ${dayLabel(iso)}`, dataset: { day: iso } });
  card.appendChild(el('div', { class: 'rc-myday-card-head' }, [
    el('h3', { text: title }),
    el('span', { class: 'rc-hint', text: dayLabel(iso, 'day') }),
  ]));

  const absent = index.absent(person.id, iso);
  const state = availability(person, iso, leave, absent);
  if (state.state === 'leave') {
    card.appendChild(el('div', { class: 'rc-myday-off' }, [
      el('span', { html: icon('sun', { size: 18 }), 'aria-hidden': 'true' }),
      el('span', { text: state.leave ? 'On leave' : 'Off — on the PTO row' }),
    ]));
    return card;
  }
  if (state.state === 'non-working') {
    card.appendChild(el('p', { class: 'rc-hint', text: 'Not one of your working days.' }));
    return card;
  }

  const tasks = index.on(person.id, iso);
  if (!tasks.length) {
    card.appendChild(emptyState({
      iconName: 'calendar',
      title: 'Nothing planned yet',
      message: 'The look-ahead does not name you on this day and nobody has planned it. Ask in the huddle, or plan it in your week plan.',
    }));
  }
  for (const t of tasks) {
    if (t.absence) {
      card.appendChild(el('div', { class: 'rc-myday-task' }, [
        el('div', { class: 'rc-myday-task-title', text: ABSENCE_WORDS[t.absence] || t.task || 'Away from the project' }),
      ]));
      continue;
    }
    const where = locs.get(t.location_id)?.name || t.raw_location || '';
    const shift = SHIFTS.find((s) => s.id === t.shift)?.label || '';
    const others = withWhom({ index, names, planRows }, person.id, iso, t);
    const content = [
      el('div', { class: 'rc-myday-task-title', text: t.task || 'A task with no description' }),
      el('div', { class: 'rc-myday-facts' }, [
        where ? fact('pin', where) : null,
        shift ? fact('clock', `${shift} shift`) : null,
        others.length ? fact('users', `With ${others.join(', ')}`) : fact('user', 'On your own'),
        t.from_lookahead ? null : fact('edit', 'Planned by hand'),
      ].filter(Boolean)),
    ];
    /* A task on the look-ahead opens the whole activity: every column, every
       day from this week on, and who is on each. One planned by hand has no
       activity behind it, so it is not a button. */
    if (t.lookahead_row_id) {
      content.push(el('span', { class: 'rc-myday-more', text: 'Details', 'aria-hidden': 'true' }));
      card.appendChild(el('button', {
        class: 'rc-myday-task rc-myday-task-open',
        type: 'button',
        'aria-label': `${t.task || 'Task'} — open the whole activity`,
        onClick: async () => {
          const row = laRowById.get(t.lookahead_row_id)
            || (await rc.lookaheadRowsByIds([t.lookahead_row_id]).catch(() => []))[0]
            || null;
          openActivity({ row, task: t.task });
        },
      }, content));
    } else {
      card.appendChild(el('div', { class: 'rc-myday-task' }, content));
    }
  }
  if (state.asked) {
    card.appendChild(el('p', { class: 'rc-hint', text: 'You have asked for leave on this day; nobody has answered yet.' }));
  }
  return card;
}

function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
}

function fact(iconName, text) {
  return el('span', { class: 'rc-myday-fact' }, [
    el('span', { html: icon(iconName, { size: 12 }), 'aria-hidden': 'true' }),
    el('span', { text }),
  ]);
}

/**
 * Who else is on the same piece of work that day: everybody the look-ahead's
 * names row puts on the same row, and anybody planned against the same row by
 * hand. Matched on the row, never on the wording of a task.
 */
function withWhom({ index, names, planRows }, meId, iso, task) {
  const rowId = task.lookahead_row_id;
  if (!rowId) return [];
  const ids = new Set();
  for (const [personId, days] of index.byPerson) {
    if (personId === meId) continue;
    if ((days.get(iso) || []).some((r) => r.id === rowId)) ids.add(personId);
  }
  for (const p of planRows) {
    if (p.person_id !== meId && p.work_date === iso && p.lookahead_row_id === rowId) ids.add(p.person_id);
  }
  return [...ids].map((id) => names.get(id)?.name).filter(Boolean).sort();
}

/** Monday to Sunday: where you are each day, in a word. */
function weekStrip({ person, index, leave, locs }, monday, today) {
  const strip = el('ol', { class: 'rc-myday-week', 'aria-label': 'Your week' });
  for (let i = 0; i < 7; i++) {
    const iso = toISO(addDays(isoToMs(monday), i));
    const state = availability(person, iso, leave, index.absent(person.id, iso));
    const tasks = state.state === 'available' ? index.on(person.id, iso) : [];
    let text = '';
    if (state.state === 'leave') text = 'Off';
    else if (state.state === 'non-working') text = '—';
    else if (!tasks.length) text = 'Nothing yet';
    else {
      text = [...new Set(tasks.map((t) => (t.absence ? (ABSENCE_WORDS[t.absence] || 'Away').split(' ')[0]
        : locs.get(t.location_id)?.code || locs.get(t.location_id)?.name || t.raw_location || 'Task')))].join(', ');
    }
    strip.appendChild(el('li', {
      class: `rc-myday-day${iso === today ? ' rc-myday-today' : ''}${state.state !== 'available' ? ' rc-myday-quiet' : ''}`,
      'aria-current': iso === today ? 'date' : null,
      title: tasks.map((t) => t.task).filter(Boolean).join('\n'),
    }, [
      el('span', { class: 'rc-myday-wd', text: weekdayOf(iso) }),
      el('span', { class: 'rc-myday-where', text }),
    ]));
  }
  return el('section', { class: 'rc-myday-weekwrap' }, [el('h3', { text: 'This week' }), strip]);
}
