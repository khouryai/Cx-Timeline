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
 * Imports: util, dates, rc, core/lookahead, icons, components, rc_util,
 *          rc_activity.
 */

import { el } from '../core/util.js';
import { toISO, addDays } from '../core/dates.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import { badge, emptyState } from './components.js';
import { openActivity } from './rc_activity.js';
import {
  byId, dayLabel, todayISO, isoToMs, weekStart, goToTab, STATUS_BY_ID, SHIFTS, nameRegister,
  assignmentIndex, availability, lookaheadWithResources, meMatcher, notifyChanged,
} from './rc_util.js';
import { changesForMe } from '../core/lookahead.js';

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

  root.appendChild(changesPanel());

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

/* ══════════════════════════════════════════════════════════════════════════
   What changed for you

   The look-ahead as it reads now against the reading this person last said
   "Got it" to, for the days that name them from today on — `changesForMe()`
   in `core/lookahead.js`. "Got it" is a row in `rc_la_seen`, append-only, and
   it is what the administrator's inbox reads to say who has changes they have
   not seen.

   The first time, there is nothing to compare with, so the reading on screen
   is recorded quietly as the starting point. A new reading that changes none
   of this person's days is recorded quietly too — there was nothing to see.
   Neither is recorded while an administrator is only previewing.
   ═══════════════════════════════════════════════════════════════════════ */

const HORIZON_DAYS = 27;

/** What changed for the person looking: `{ state, latest, seen, changes }`. */
export async function myChanges() {
  const who = rc.me();
  if (!who) return { state: 'none', changes: [] };
  const [latest] = await rc.listSnapshotMeta({ limit: 1 });
  if (!latest) return { state: 'none', changes: [] };
  let seen;
  try {
    seen = await rc.lastSeen(who.id);
  } catch {
    // An older database with nowhere to record it: say nothing rather than fail.
    return { state: 'unavailable', changes: [] };
  }
  if (!seen) return { state: 'first', latest, changes: [] };
  if (seen.snapshot_id === latest.id) return { state: 'current', latest, seen, changes: [] };
  const today = todayISO();
  const to = toISO(addDays(isoToMs(today), HORIZON_DAYS));
  const [before, after, isMe] = await Promise.all([
    seen.snapshot_id ? rc.snapshotRows(seen.snapshot_id) : Promise.resolve([]),
    rc.snapshotRows(latest.id),
    meMatcher(),
  ]);
  if (!before.length) return { state: 'first', latest, seen, changes: [] };
  const changes = changesForMe(before, after, isMe || (() => false), { from: today, to });
  return { state: changes.length ? 'changed' : 'quiet', latest, seen, changes };
}

let unseen = null; // { at, n } — for the count on the tab
/** How many changes are waiting on the person looking, remembered for a minute. */
export async function unseenCount() {
  if (unseen && Date.now() - unseen.at < 60000) return unseen.n;
  const { changes } = await myChanges();
  unseen = { at: Date.now(), n: changes.length };
  return unseen.n;
}

/** Put the count on the My day tab as it now stands — the header drew it from memory. */
function showCount(n) {
  unseen = { at: Date.now(), n };
  const tab = document.querySelector('#rc-frame .rc-head .rc-tab[data-tab="myday"]');
  if (!tab) return;
  tab.querySelector('.rc-tab-count')?.remove();
  if (!n) return;
  tab.appendChild(el('span', { class: 'rc-tab-count rc-tab-count-info', text: String(n), 'aria-label': `${n} change${n === 1 ? '' : 's'} to your days` }));
}

function record(latest, changes) {
  if (rc.previewing()) return Promise.resolve(null);
  return rc.markSeen({ snapshotId: latest.id, takenAt: latest.taken_at, changes }).catch(() => null);
}

const KIND = {
  added: { label: 'Added', tone: 'good' },
  reinstated: { label: 'Back on', tone: 'good' },
  moved: { label: 'Moved', tone: 'warn' },
  shift: { label: 'Shift changed', tone: 'warn' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
  removed: { label: 'Taken off', tone: 'bad' },
  given: { label: 'Given to somebody else', tone: 'bad' },
};

function sentence(c) {
  const on = (iso) => dayLabel(iso, 'day');
  const where = c.location && !c.label.includes(c.location) ? ` (${c.location})` : '';
  const what = `${c.label}${where}`;
  switch (c.kind) {
    case 'added': return `${on(c.date)} — ${what}${c.now ? `, ${c.now}` : ''}`;
    case 'reinstated': return `${on(c.date)} — ${what} is back on${c.now ? `, ${c.now}` : ''}`;
    case 'moved': return `${on(c.from)} → ${on(c.date)} — ${what}`;
    case 'shift': return `${on(c.date)} — ${what}: now ${c.now} (was ${c.was})`;
    case 'cancelled': return `${on(c.date)} — ${what}`;
    case 'removed': return `${on(c.date)} — ${what}: you are no longer on it`;
    case 'given': return `${on(c.date)} — ${what}: now ${c.names.join(', ')}`;
    default: return `${on(c.date)} — ${what}`;
  }
}

function changesPanel() {
  const box = el('section', { class: 'rc-myday-changes', hidden: true, 'aria-live': 'polite', 'aria-label': 'What changed for you' });
  const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  myChanges()
    .then(async ({ state, latest, seen, changes }) => {
      if (state === 'none' || state === 'unavailable') return;
      if (state === 'first' || state === 'quiet') {
        await record(latest, 0);
        showCount(0);
        box.append(el('p', {
          class: 'rc-hint rc-myday-uptodate',
          text: state === 'first'
            ? 'From now on, whenever the look-ahead changes one of your days, it shows here first.'
            : `Nothing on the look-ahead has changed for you since ${when(seen.snapshot_taken_at)}.`,
        }));
        box.hidden = false;
        return;
      }
      if (state === 'current') {
        box.append(el('p', { class: 'rc-hint rc-myday-uptodate', text: `You are up to date with the look-ahead as of ${when(latest.taken_at)}.` }));
        box.hidden = false;
        return;
      }
      showCount(changes.length);
      box.classList.add('rc-myday-changes-open');
      box.append(
        el('div', { class: 'rc-myday-changes-head' }, [
          el('h3', { text: `${changes.length} change${changes.length === 1 ? '' : 's'} to your days` }),
          el('span', { class: 'rc-hint', text: `since you last looked, ${when(seen.snapshot_taken_at)}` }),
        ]),
        el('ul', { class: 'rc-myday-change-list' }, changes.map((c) => el('li', { class: `rc-myday-change rc-myday-change-${c.kind}` }, [
          badge(c.kind === 'given' ? `Given to ${c.names[0]}${c.names.length > 1 ? ' +' : ''}` : KIND[c.kind]?.label || c.kind, KIND[c.kind]?.tone || 'neutral'),
          el('span', { text: sentence(c) }),
        ]))),
        el('div', { class: 'rc-myday-changes-foot' }, [
          el('button', {
            class: 'cx-btn mini primary',
            type: 'button',
            text: 'Got it',
            title: 'Say you have seen these. Your administrator can see who has not.',
            onClick: async (e) => {
              e.currentTarget.disabled = true;
              if (rc.previewing()) {
                box.replaceChildren(el('p', { class: 'rc-hint', text: 'Preview only — nothing is recorded while you are seeing the calendar as somebody else.' }));
                return;
              }
              try {
                await rc.markSeen({ snapshotId: latest.id, takenAt: latest.taken_at, changes: changes.length });
                showCount(0);
                notifyChanged('seen');
              } catch (err) {
                e.currentTarget.disabled = false;
                box.append(el('p', { class: 'rc-error', text: err?.message || String(err) }));
              }
            },
          }),
          el('span', { class: 'rc-hint', text: 'Your days below already show the look-ahead as it reads now.' }),
        ]),
      );
      box.hidden = false;
    })
    .catch(() => {});
  return box;
}
