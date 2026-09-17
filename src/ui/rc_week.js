/**
 * The week plan — who is where, what they are on, and how it went.
 *
 * One tab, and it used to be two. "Week plan" drew the team's week from the
 * plan's side; "Resources" drew the same rows the other way round, per person,
 * with what the 4WLA asked for beside them. They were people down and days
 * across in both cases, over the same `rc_plan_entries`, through the same
 * `assignmentIndex()` — the same table drawn twice with a different subtitle,
 * and each one missing something the other had. Whichever you opened, the answer
 * you wanted was on the other.
 *
 * So there is one. It carries every part that was load-bearing in either:
 *
 * **What each person is on, per day**, every task and not the first of them,
 * because a shift is routinely two jobs.
 *
 * **What the 4WLA asked for**, where a stored entry disagrees with it. That is
 * a decision somebody took against the workbook and it is the one case worth
 * drawing twice; where they agree — the normal case, since the sheet *is* the
 * plan — there is nothing to reconcile and one line is drawn.
 *
 * **How yesterday went.** The huddle records an outcome against a day, and the
 * meeting is an administrator's screen. Without it here a member had no way to
 * see what was said about their own work: the status, the note, the photograph,
 * whether it was carried over. It is read-only in this view — recording is the
 * meeting's job and there must be one recording path — but it is *shown*, and
 * that is most of why a member needs to open this at all.
 *
 * **Who can actually be staffed each day**, on the bottom row. The number that
 * stops work being promised for a day that cannot be covered.
 *
 * **The names and places the registers cannot resolve.** A view that is
 * incomplete and says so is usable; one that is quietly wrong is not.
 *
 * **A member's own row is theirs.** They create, revise and withdraw tasks on
 * it and on no other, which is `rc_can_act_for()` in Postgres — this only
 * stops offering what the database would refuse. Withdrawing is a tombstone
 * rather than a delete, because `rc_plan_entries` has no DELETE grant and a
 * plan that changed the evening before a shift is delay evidence.
 *
 * Everything written here is an `rc_plan_entries` row — the same rows the huddle
 * reads and the reports group by. There is one place a day is planned and
 * several places it is read.
 *
 * Imports: util, dates, rc, icons, components, rc_util.
 */

import { el, clear } from '../core/util.js';
import { toISO, addDays, todayMs } from '../core/dates.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import {
  textInput, selectInput, toast, badge, checkbox, field, emptyState, promptDialog,
  confirmDialog,
} from './components.js';
import {
  SHIFTS, STATUS_BY_ID, weekStart, allWeekDays, todayISO, dayLabel, byId, availability,
  notifyChanged, formModal, nameRegister, foldName,
  ambiguousFirstNames, lookaheadWithResources, assignmentIndex,
  locationRegister, unmatchedLocations,
} from './rc_util.js';

/** Which week is on screen. Null means the one containing today. */
let weekOf = null;

/**
 * Whether the days nobody works are drawn.
 *
 * Off by default: a seven-column grid where two columns are dots for most of the
 * team is two columns of nothing. It is a switch rather than a rule because
 * commissioning runs weekend possessions, and the weekend is where some of the
 * most expensive work happens.
 */
let showQuietDays = false;

export async function render(root) {
  const startMs = weekOf ?? weekStart(todayMs());
  const days = allWeekDays(startMs);
  const from = days[0];
  const to = days[days.length - 1];
  const today = todayISO();

  /* The look-ahead is administrators-only in the database, so a member gets
     nothing back and the view simply has no BART column — which is correct, and
     is why `lookaheadWithResources()` catches rather than a permission test up
     here. It is also the one place the three views ask, so they cannot disagree
     about where somebody is. */
  const [people, locations, categories, leave, planRows, actuals, aliases, locAliases, sheet, everybody] =
    await Promise.all([
      /* The people who take shifts, which is what this view is a reading of.
         A manager administers the calendar and is never assigned to a location,
         so a row of seven dots against their name is a row of noise in the middle
         of the one screen that answers "who is where". It is `scheduled` that
         decides and never the role — an administrator who *does* take shifts
         stays here, which is the whole reason the column exists — and it is the
         same filter the week plan and the huddle already make. */
      rc.listPeople({ scheduledOnly: true }),
      rc.listLocations(),
      rc.listCategories(),
      /* Three weeks past the end of this one, not one. You find out somebody is
         off when you try to staff the day, which is a fortnight too late to do
         anything about it — so the window for leave is wider than the window
         for the grid, and what falls outside it is named underneath. */
      rc.listLeave(from, toISO(addDays(startMs, 27))),
      rc.listPlan(from, to),
      /* How it went, from the huddle. Read-only here: recording is the
         meeting's job and there is one recording path. Shown because the
         meeting is an administrator's screen, so without this a member had
         nowhere to see what was said about their own week. */
      rc.listActuals(from, to).catch(() => []),
      rc.listPersonAliases().catch(() => []),
      rc.listLocationAliases().catch(() => []),
      lookaheadWithResources(from, to),
      /* Everybody, for the register only. A name in the workbook belongs to
         whoever it belongs to, and matching it against the scheduled roster alone
         would report a real person — a manager the sheet happens to name — as a
         spelling nobody could place. */
      rc.listPeople().catch(() => []),
    ]);
  const laRows = sheet.rows;

  const locs = byId(locations);
  const cats = byId(categories);
  const register = nameRegister(everybody.length ? everybody : people, aliases);
  /* The 4WLA's Resource row *is* the plan for the days it names — derived, never
     written — and a stored entry is somebody overriding it or planning a day the
     sheet says nothing about. The same reading the week plan and the huddle
     make, from the same function. */
  const index = assignmentIndex({ planRows, laRows, absences: sheet.absences, categories, register });
  const { byPerson, unmatched, near } = index;
  /* "Nobody is called that" and "two people are, and I will not choose" are
     different problems with different fixes, and a list that ran them together
     would send somebody looking for a person who is already on the roster
     twice. */
  const shared = ambiguousFirstNames(people);
  /* Where the sheet says the work is. The same answer as a name it cannot place:
     the spelling is kept and shown, never discarded and never guessed at. */
  const strangeLocations = unmatchedLocations(laRows, locationRegister(locations, locAliases));

  /* How each day went, indexed two ways.
     An outcome points at one plan entry where there was one to point at, and at
     nothing but a person and a date where the day was derived from the sheet —
     so both keys are needed or the derived days, which are most of them, would
     show no outcome at all. The entry wins: two people can be planned on one
     day and the note belongs to the task it was recorded against. */
  const outcomeByEntry = new Map();
  const outcomeByDay = new Map();
  for (const row of actuals) {
    if (row.plan_entry_id) outcomeByEntry.set(row.plan_entry_id, row);
    const key = `${row.person_id}|${row.work_date}`;
    if (!outcomeByDay.has(key)) outcomeByDay.set(key, []);
    outcomeByDay.get(key).push(row);
  }
  /* The outcome for one drawn task. A stored entry is matched on its id; a
     derived day takes whichever outcome was recorded against the person and the
     date, because there is no row for it to point at. */
  const outcomeFor = (entry, personId, iso) => {
    if (entry?.id && outcomeByEntry.has(entry.id)) return outcomeByEntry.get(entry.id);
    if (entry?.id) return null;
    const day = outcomeByDay.get(`${personId}|${iso}`) || [];
    return day.find((a_) => !a_.plan_entry_id) || day[0] || null;
  };

  const thisWeek = leave.filter((l) => l.start_date <= to && l.end_date >= from);
  const soon = leave.filter((l) => l.start_date > to
    && l.status !== 'cancelled' && l.status !== 'declined');

  /* Only the days somebody works, unless asked otherwise. `showQuietDays` is
     about the columns; a person who works none of them still has a row, because
     a row that vanishes is a person nobody remembers to plan. */
  const shown = showQuietDays
    ? days
    : days.filter((iso) => people.some((p) => availability(p, iso, thisWeek).state !== 'non-working'));
  const columns = shown.length ? shown : days;

  const redraw = () => { clear(root); render(root); };

  root.appendChild(el('div', { class: 'rc-section-head' }, [
    el('button', {
      class: 'cx-btn icon mini ghost',
      'aria-label': 'Previous week',
      html: icon('chevron-left', { size: 13 }),
      onClick: () => { weekOf = startMs - 7 * 86400000; redraw(); },
    }),
    el('h3', { text: `Week of ${dayLabel(from, 'medium')}` }),
    weekOf === null ? null : el('button', {
      class: 'cx-btn mini ghost',
      text: 'This week',
      onClick: () => { weekOf = null; redraw(); },
    }),
    el('button', {
      class: 'cx-btn icon mini ghost',
      'aria-label': 'Next week',
      html: icon('chevron-right', { size: 13 }),
      onClick: () => { weekOf = startMs + 7 * 86400000; redraw(); },
    }),
    rc.canWrite()
      ? el('button', {
        class: 'cx-btn mini primary',
        html: icon('plus', { size: 12 }) + '<span>Assign work</span>',
        title: 'Anything, including a day that is not in the 4WLA at all — office, another '
          + 'project, training.',
        onClick: () => assign({
          people, locations, categories, laRows, locs, days, redraw, person: null, iso: null,
        }),
      })
      : null,
  ].filter(Boolean)));

  if (!people.length) {
    root.appendChild(emptyState({
      iconName: 'users',
      title: 'Nobody on the team yet',
      message: 'Add people in Organisation first. Being on the roster never requires an account.',
    }));
    return;
  }

  root.appendChild(el('div', {
    style: 'display:flex;align-items:center;gap:16px;margin:0 0 10px;flex-wrap:wrap',
  }, [
    checkbox({
      label: 'Show days nobody works',
      checked: showQuietDays,
      onChange: (on) => { showQuietDays = on; redraw(); },
    }),
  ]));

  /* ── The grid ─────────────────────────────────────────────────────────── */

  const body = el('tbody');
  for (const person of people) {
    const wanted = byPerson.get(person.id) || new Map();
    const cells = columns.map((iso) => {
      const state = availability(person, iso, thisWeek, index.absent(person.id, iso));
      const asked = wanted.get(iso) || [];
      const classes = ['rc-res-cell'];
      if (iso === today) classes.push('rc-res-today');

      if (state.state === 'leave') {
        return el('td', { class: classes.join(' '), 'data-label': dayLabel(iso) }, [
          // Booked, or only on the 4WLA's PTO row: one day off either way, and
          // which of the two wrote it down is the PTO tab's question.
          badge('Leave', 'muted'),
        ]);
      }
      const planned = index.on(person.id, iso);
      if (state.state === 'non-working' && !planned.length && !asked.length) {
        return el('td', {
          class: `${classes.join(' ')} rc-inactive`,
          'data-label': dayLabel(iso),
        }, [el('span', { text: '·' })]);
      }

      /* Whose day this is decides whether it can be changed. A member plans,
         revises and withdraws their own and nobody else's; an administrator does
         anybody's. That is `rc_can_act_for()` in Postgres — this only stops
         offering what the database would refuse. */
      const mayPlan = rc.canWrite() && (rc.isAdmin() || person.id === rc.me()?.id);

      const parts = [];
      // Every task on the day, not the first of them. A shift is routinely two
      // jobs, and drawing one was how the other went missing.
      for (const entry of planned) {
        const outcome = outcomeFor(entry, person.id, iso);
        const status = outcome ? STATUS_BY_ID.get(outcome.status) : null;
        parts.push(el('div', {
          class: ['rc-res-job', entry.absence ? 'rc-res-away' : '',
            outcome ? `rc-res-done rc-res-${outcome.status}` : ''].filter(Boolean).join(' '),
        }, [
          el('div', { class: 'rc-res-task', text: entry.task || '—' }),
          el('div', { class: 'rc-hint', text: [
            locs.get(entry.location_id)?.name || entry.raw_location,
            cats.get(entry.category_id)?.name,
            entry.shift !== 'day' ? entry.shift : null,
          ].filter(Boolean).join(' · ') }),
          el('div', { class: 'rc-res-flags' }, [
            /* The workbook is the assumption, so only a day somebody typed in
               carries a flag. A derived day has `id: null` by design, which is
               what tells the two apart. */
            !entry.from_lookahead && entry.id ? badge('Manual', 'warn') : null,
            /* Moved, because a later read of the sheet named somebody else on
               the row this was written against. Drawn on the person who has it
               now and naming the one who had it, which is the only version of
               this that answers "why am I on this". */
            entry.reassigned_from
              ? badge(`Reassigned from ${nameOf(everybody, people, entry.reassigned_from)}`, 'info')
              : null,
            entry.supersedes_id && !entry.reassigned_from ? badge('Revised', 'warn') : null,
            entry.carry_chain_id ? badge('Carried over', 'warn') : null,
          ].filter(Boolean)),
          /* How it went, from the huddle — the whole reason a member opens this.
             Read-only: the meeting is where an outcome is recorded and there is
             one recording path, so this states it and offers nothing. */
          outcome
            ? el('div', { class: 'rc-res-outcome' }, [
              /* An eyebrow, because this is a different *kind* of thing from
                 the flags above it: those say what the plan is, this says what
                 happened. Without it the status badge read as a fourth flag. */
              el('span', { class: 'rc-eyebrow', text: 'Recorded' }),
              badge(status?.label || outcome.status, status?.tone || 'muted'),
              outcome.blocked_reason
                ? el('div', { class: 'rc-hint', text: outcome.blocked_reason })
                : null,
              outcome.note ? el('div', { class: 'rc-hint', text: outcome.note }) : null,
              outcome.evidence_path
                ? el('button', {
                  class: 'cx-btn mini ghost rc-evidence',
                  html: `${icon('paperclip', { size: 11 })}<span>Photo</span>`,
                  title: 'Open the photograph taken with this outcome',
                  onClick: async () => {
                    try {
                      window.open(await rc.evidenceUrl(outcome.evidence_path), '_blank', 'noopener');
                    } catch (err) {
                      toast({ tone: 'bad', message: `That photograph could not be opened — ${err.message}` });
                    }
                  },
                })
                : null,
              outcome.supersedes_id ? el('div', { class: 'rc-hint', text: 'corrected' }) : null,
            ].filter(Boolean))
            : null,
          /* Changing it. A derived day has no row to revise, so revising it *is*
             writing the first one — which is what overriding the sheet means, and
             is labelled as that. Withdrawing is only ever offered for a stored
             row: there is nothing to withdraw from a day the sheet is asserting,
             and the honest answer there is to override it. */
          mayPlan
            ? el('div', { class: 'rc-res-acts' }, [
              /* Icons rather than words. Seven columns of "Edit" and "Delete"
                 is more chrome than content in a cell that already carries a
                 task, a place, its flags and how it went — and the actions are
                 the least interesting thing in it. Labelled for a screen reader
                 and titled for a pointer, which is what an icon-only button
                 owes anybody. */
              el('button', {
                class: 'cx-btn icon mini ghost',
                'aria-label': entry.from_lookahead
                  ? `Override the sheet for ${person.name} on ${dayLabel(iso)}`
                  : `Revise ${entry.task || 'this task'}`,
                html: icon(entry.from_lookahead ? 'refresh' : 'edit', { size: 11 }),
                title: entry.from_lookahead
                  ? 'Override the sheet. The 4WLA plans this day, so changing it writes the first '
                    + 'plan entry against it.'
                  : 'Revise this — the outgoing version stays on the record.',
                onClick: () => (entry.from_lookahead
                  ? overrideSheet({
                    person, iso, laRows, locations, categories, locs, redraw,
                    row: laRows.find((r) => r.id === entry.lookahead_row_id) || null,
                  })
                  : revisePlan(entry, person, { locations, categories, locs, redraw })),
              }),
              entry.id
                ? el('button', {
                  class: 'cx-btn icon mini ghost danger',
                  'aria-label': `Remove ${entry.task || 'this task'} from ${dayLabel(iso)}`,
                  html: icon('trash', { size: 11 }),
                  title: 'Takes the day off the schedule. The record keeps it — a plan that '
                    + 'changed the evening before a shift is itself evidence — so this writes a '
                    + 'withdrawal rather than removing anything.',
                  onClick: () => withdraw(entry, person, redraw),
                })
                : null,
            ].filter(Boolean))
            : null,
        ].filter(Boolean)));
      }
      const entry = planned[0] || null;

      /* The one case worth drawing twice: a stored entry that overrides what the
         sheet asks for. That is a decision somebody took against the workbook,
         and seeing the two side by side is the whole reason this view exists.
         Where they agree — which is now the normal case, because the sheet *is*
         the plan — there is nothing to reconcile and only one line is drawn. */
      if (entry && !entry.from_lookahead) {
        const linked = new Set(planned.map((e) => e.lookahead_row_id).filter(Boolean));
        for (const row of asked) {
          if (linked.has(row.id)) continue;
          parts.push(el('div', {
            class: 'rc-res-asked',
            title: 'The 4WLA names this person here and the plan for the day says otherwise.',
          }, [
            el('span', { class: 'rc-eyebrow', text: '4WLA' }),
            el('div', { text: (row.raw_label || `row ${row.sheet_row}`).slice(0, 44) }),
            el('div', {
              class: 'rc-hint',
              /* The place the register knows, and the sheet's own spelling only
                 where it does not know one. It read the other way round, which
                 put "T12" on screen for a location the application can name — the
                 code is what the workbook types, not what anybody calls it. */
              text: locs.get(row.location_id)?.name || row.raw_location || '',
            }),
          ]));
        }
      }

      /* A day off somebody has asked for and nobody has answered.
         Not leave — the day is still staffable and an administrator still has a
         decision to make — but drawn, because a request nobody can see while
         they are staffing the week is a request that gets scheduled straight
         over. PTO is where it is answered. */
      if (state.asked) {
        parts.push(el('div', { class: 'rc-res-asked-off' }, [
          badge('Leave requested', 'warn'),
        ]));
      }

      if (!mayPlan) {
        return el('td', { class: classes.join(' '), 'data-label': dayLabel(iso) },
          parts.length ? parts : [el('span', { class: 'rc-hint', text: '—' })]);
      }
      /* The button is there whether or not the day already has something on it:
         a shift is often more than one job, and a day that could only ever hold
         one task is how somebody ends up with one of the three things they were
         asked for. */
      parts.push(el('button', {
        class: 'cx-btn mini ghost rc-res-add',
        text: parts.length ? '+ task' : '+',
        'aria-label': `Assign ${person.name} on ${dayLabel(iso)}`,
        title: parts.length ? 'Add another task to this day' : 'Plan this day',
        onClick: () => assign({
          people, locations, categories, laRows, locs, days, redraw, person, iso,
        }),
      }));
      return el('td', { class: classes.join(' '), 'data-label': dayLabel(iso) }, parts);
    });

    body.appendChild(el('tr', {}, [
      el('td', {}, [
        el('div', { text: person.name }),
        el('div', { class: 'rc-hint', text: [person.title, person.subsystem].filter(Boolean).join(' · ') }),
        person.scheduled === false ? badge('Not scheduled', 'neutral') : null,
      ].filter(Boolean)),
      ...cells,
    ]));
  }

  /* How many people can actually be staffed each day.
     The number that stops work being promised for a day it cannot be covered,
     and the one part of the old week-plan tab that had no counterpart here. */
  const coverage = columns.map((iso) => people.filter((p) =>
    availability(p, iso, thisWeek, index.absent(p.id, iso)).state === 'available').length);

  body.appendChild(el('tr', { class: 'rc-res-coverage' }, [
    el('td', {}, [el('strong', { text: 'Can be staffed' })]),
    ...coverage.map((n, i) => el('td', {
      class: ['rc-num', columns[i] === today ? 'rc-res-today' : ''].filter(Boolean).join(' '),
      'data-label': dayLabel(columns[i]),
    }, [el('span', { text: `${n} of ${people.length}` })])),
  ]));

  root.appendChild(el('div', { class: 'rc-scroll' }, [
    el('table', { class: 'rc-table rc-resources' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Resource' }),
          ...columns.map((iso) => el('th', {
            /* Today, marked on the column rather than on one cell. A week grid
               is read by running a finger down a day, and the day somebody is
               nearly always looking for is this one — it used to be a two-pixel
               rule on the left edge of the cells, which is invisible against a
               table that has borders anyway. */
            class: iso === today ? 'rc-res-today rc-res-today-head' : '',
            html: iso === today
              ? `${dayLabel(iso)}<span class="rc-today-tag">Today</span>`
              : undefined,
            text: iso === today ? undefined : dayLabel(iso),
          })),
        ]),
      ]),
      body,
    ]),
  ]));

  /* Leave that has not started yet. Three weeks past the end of the grid,
     because finding out when you try to staff the day is a fortnight too late
     to do anything about it. */
  if (soon.length) {
    const peopleById = byId(people);
    root.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Coming up: ' + soon
        .sort((a_, b_) => a_.start_date.localeCompare(b_.start_date))
        .slice(0, 6)
        .map((l) => `${peopleById.get(l.person_id)?.name || 'somebody'} from ${dayLabel(l.start_date)}`
          + `${l.status === 'requested' ? ' (requested)' : ''}`)
        .join(', ')
        + '. Requests are in PTO, where an administrator answers them.',
    }));
  }

  /* ── Where everybody is ───────────────────────────────────────────────── */

  const atLocation = new Map();
  for (const entry of planRows) {
    const name = locs.get(entry.location_id)?.name || 'no location recorded';
    if (!atLocation.has(name)) atLocation.set(name, new Set());
    atLocation.get(name).add(entry.person_id);
  }
  if (atLocation.size) {
    const peopleById = byId(people);
    root.appendChild(el('div', { style: 'height:20px' }));
    root.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'Where the week puts people' }),
    ]));
    root.appendChild(el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Location' }), el('th', { text: 'Who' }), el('th', { text: 'People' }),
        ])]),
        el('tbody', {}, [...atLocation.entries()]
          .sort((a, b) => b[1].size - a[1].size)
          .map(([name, ids]) => el('tr', {}, [
            el('td', { text: name }),
            el('td', { text: [...ids].map((id) => peopleById.get(id)?.name || '—').sort().join(', ') }),
            el('td', { class: 'rc-num', text: String(ids.size) }),
          ]))),
      ]),
    ]));
  }

  /* ── Names the roster does not know ───────────────────────────────────── */

  if (unmatched.length) {
    root.appendChild(el('div', { style: 'height:20px' }));
    root.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'Named in the 4WLA, not on the roster' }),
    ]));
    root.appendChild(el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'As written' }), el('th', { text: 'Days' }),
          el('th', { text: 'On' }), el('th', { text: '' }),
        ])]),
        el('tbody', {}, unmatched.map((u) => el('tr', {}, [
          el('td', {}, [
            el('div', { text: u.name }),
            shared.has(foldName(u.name))
              ? el('div', {
                class: 'rc-hint',
                text: 'more than one person is called that — say which',
              })
              : null,
          ].filter(Boolean)),
          el('td', { class: 'rc-num', text: String(u.days.size) }),
          el('td', { class: 'rc-hint', text: u.rows.map((r) => r.raw_label || '').filter(Boolean).join(', ').slice(0, 60) }),
          el('td', {}, rc.isAdmin() ? [
            el('button', {
              class: 'cx-btn mini',
              text: 'That is somebody',
              title: 'Record this spelling against a person. Nothing is guessed from a surname — '
                + 'a shift against the wrong engineer is worse than one against nobody.',
              onClick: () => mapName(u, people, redraw),
            }),
            el('button', {
              class: 'cx-btn mini ghost',
              text: 'Add to the team',
              title: 'Somebody on site who is not on the roster yet.',
              onClick: () => addFromName(u, redraw),
            }),
          ] : []),
        ]))),
      ]),
    ]));
    root.appendChild(el('p', {
      class: 'rc-hint',
      text: 'These are the names the 4WLA has that the roster cannot place, so the rows above are '
        + 'missing them. A bare first name does match, where exactly one person on the roster '
        + 'answers to it — that is what the Resource row is filled in with. Nothing is matched on '
        + 'a surname or a set of initials, and a first name two people share matches neither: '
        + 'picking one would put a shift against the wrong engineer, silently, because both '
        + 'answers look equally right on screen. Either way the answer is an alias, once.',
    }));
  }

  /* ── Names placed by correcting a spelling ────────────────────────────── */

  if (near.length) {
    const peopleById = byId(people);
    root.appendChild(el('div', { style: 'height:20px' }));
    root.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'Matched by correcting a spelling' }),
    ]));
    root.appendChild(el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'As written' }), el('th', { text: 'Read as' }),
          el('th', { text: 'Days' }), el('th', { text: '' }),
        ])]),
        el('tbody', {}, near.map((u) => el('tr', {}, [
          el('td', { text: u.name }),
          el('td', {}, [
            el('span', { text: peopleById.get(u.person_id)?.name || '—' }),
            badge('near miss', 'warn'),
          ]),
          el('td', { class: 'rc-num', text: String(u.days.size) }),
          el('td', {}, rc.isAdmin() ? [
            el('button', {
              class: 'cx-btn mini ghost',
              text: 'Record the spelling',
              title: 'Keeps this spelling against that person for good, so nothing has to be '
                + 'corrected on the next read.',
              onClick: () => mapName(u, people, redraw),
            }),
          ] : []),
        ]))),
      ]),
    ]));
    root.appendChild(el('p', {
      class: 'rc-hint',
      text: 'These spellings are not on the roster and are one or two characters away from exactly '
        + 'one name that is, so they are read as that person rather than dropped — a transposed pair '
        + 'of letters used to cost somebody a whole week of shifts. It is listed because it is a '
        + 'correction rather than a match: a short name is still matched exactly, and a spelling '
        + 'equally close to two people is matched to neither. Recording it as an alias turns the '
        + 'judgement into a fact.',
    }));
  }

  /* ── Places the register does not know ────────────────────────────────── */

  if (strangeLocations.length) {
    root.appendChild(el('div', { style: 'height:20px' }));
    root.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'Where the 4WLA says, and the register cannot place' }),
    ]));
    root.appendChild(el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'As written' }), el('th', { text: 'Rows' }),
          el('th', { text: 'On' }), el('th', { text: '' }),
        ])]),
        el('tbody', {}, strangeLocations.map((u) => el('tr', {}, [
          el('td', { text: u.name }),
          el('td', { class: 'rc-num', text: String(u.rows.length) }),
          el('td', {
            class: 'rc-hint',
            text: u.rows.map((r) => r.raw_label || '').filter(Boolean).join(', ').slice(0, 60),
          }),
          el('td', {}, rc.isAdmin() ? [
            el('button', {
              class: 'cx-btn mini',
              text: 'That is a place we have',
              title: 'Record this spelling against a location on the register.',
              onClick: () => mapLocation(u, locations, redraw),
            }),
            el('button', {
              class: 'cx-btn mini ghost',
              text: 'Add as a location',
              title: 'A place the register has never carried.',
              onClick: () => addFromLocation(u, redraw),
            }),
          ] : []),
        ]))),
      ]),
    ]));
    root.appendChild(el('p', {
      class: 'rc-hint',
      text: 'The location comes off the 4WLA\u2019s own Location column, and it is kept whether or '
        + 'not the register knows the spelling \u2014 which is what puts these here to be answered '
        + 'rather than dropping them. A code matches, where a location on the register carries it: '
        + 'that column is filled in with "W30", not the full name. Until one of these is mapped the '
        + 'days it covers still show the place as written, and the reports simply cannot group them.',
    }));
  }

  /* ── What this view is ────────────────────────────────────────────────── */

  root.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Everything here is a plan entry — the same rows the daily huddle reads and the reports '
      + 'group by — so anybody assigned here is in tomorrow\'s meeting with their scope against '
      + 'their name. This was two tabs, "Week plan" and "Resources", drawing the same table twice '
      + 'with a different subtitle; whichever you opened, the part you wanted was on the other.',
  }));
  root.appendChild(el('p', {
    class: 'rc-hint',
    text: rc.isAdmin()
      ? 'A member sees all of this and can create, change and remove tasks on their own row and '
        + 'nowhere else — the rule `rc_plan_entries` makes in Postgres, not something this screen '
        + 'decides. Removing one writes a withdrawal rather than deleting anything, so the record '
        + 'still holds the day as planned.'
      : 'Your own row is yours: add a task, change one, or take one off. Everybody else\'s is '
        + 'read-only, and the database says so rather than this screen. What the huddle recorded '
        + 'against a day is shown here because that meeting is where it is entered — this is where '
        + 'you can read it back.',
  }));
  root.appendChild(el('p', {
    class: 'rc-hint',
    text: laRows.length
      ? `The 4WLA names people on ${laRows.filter((r) => Object.keys(r.resources || {}).length).length} `
        + 'row(s) in these weeks, and where it names somebody that is their plan for the day — '
        + 'derived from the sheet rather than written down, so it follows the workbook instead of '
        + 'going stale beside it. That is the assumption everywhere and it carries no badge. What '
        + 'is flagged "Manual" is a plan entry: somebody overriding the sheet, or planning a day it '
        + 'says nothing about. Where an override disagrees with the sheet both are drawn, because '
        + 'that is the case worth seeing.'
      : 'No look-ahead rows read for this week yet, so nothing here can say what BART asked for. '
        + 'Read it in Look-ahead → Check now.',
  }));
  root.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Work that is not commissioning work belongs here too — a day in the office, a day on '
      + 'another project, training. Without somewhere for those to go the huddle has a blank '
      + 'against a name and no way to tell "nothing planned" from "nothing said".',
  }));
}

/**
 * A roster name from an id, whoever they are.
 *
 * Looked up in *everybody* before the scheduled roster, because the person a
 * task was reassigned away from may be a manager or somebody who has since been
 * stood down — and "Reassigned from —" is worse than not saying it at all.
 */
function nameOf(everybody, people, id) {
  if (!id) return 'somebody';
  const found = (everybody || []).find((p) => p.id === id)
    || (people || []).find((p) => p.id === id);
  return found?.name || 'somebody';
}

/* ══════════════════════════════════════════════════════════════════════════
   Changing a day that is already planned
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Revise a stored entry.
 *
 * Never an update. The outgoing row stays and the new one points at it, so "the
 * plan changed the evening before the shift" is a thing the record can still say
 * a year later — which is the whole reason the table is append-only.
 * `rc_supersede_plan()` refuses to revise an entry that has already been
 * revised, so two people editing the same day get a refusal rather than one of
 * them silently winning.
 *
 * The history is shown because it is the point: a revision nobody can see is an
 * edit with extra steps.
 */
async function revisePlan(entry, person, { locations, categories, locs, redraw }) {
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
      field('Task', task),
      field('Location', location),
      field('Category', category),
      field('Shift', shift),
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
      redraw();
    },
  });
}

/**
 * Take a day off the schedule.
 *
 * "Delete my task", and it is a *write*: `rc_plan_entries` has no DELETE grant,
 * because a plan that changed the evening before the shift is what a delay claim
 * is built from and a row that can be removed is a record that can be edited. So
 * `rc_withdraw_plan()` writes a tombstone superseding the original and
 * `rc_plan_current` drops the pair — the day leaves the schedule and the table
 * still says it was planned and then withdrawn, by whom and when.
 *
 * Asked first, because it is the one action here with no visible result other
 * than something disappearing, and said plainly afterwards.
 */
async function withdraw(entry, person, redraw) {
  const ok = await confirmDialog({
    title: `Remove this from ${person.name}’s ${dayLabel(entry.work_date, 'medium')}?`,
    message: 'It comes off the schedule. Nothing is deleted: the record keeps the day as planned '
      + 'and then withdrawn, because a plan that changed the evening before a shift is itself '
      + 'evidence. An outcome already recorded against it stays on the record too.',
    confirmLabel: 'Remove it',
    danger: true,
  });
  if (!ok) return;
  try {
    await rc.withdrawPlan(entry.id);
    notifyChanged('plan');
    toast({ tone: 'good', message: 'Off the schedule, and still on the record.' });
    redraw();
  } catch (err) {
    toast({ tone: 'bad', message: err?.message || String(err) });
  }
}

/**
 * Write the first stored row for a day the 4WLA planned.
 *
 * A derived day has no row to revise, so revising it *is* writing the first one
 * — and what that means is a decision taken against the workbook, which is why
 * the button says "Override the sheet" rather than "Plan it". The sheet's own
 * row is prefilled and the link is kept, which is what later lets a block be
 * recorded against the row BART themselves scheduled.
 */
function overrideSheet({ person, iso, laRows, locations, categories, locs, redraw, row = null }) {
  const wanted = laRows.filter((r) => !r.cells || !Object.keys(r.cells).length || r.cells[iso]);
  const rows = wanted.length ? wanted : laRows;

  const pick = selectInput({
    value: row && rows.some((r) => r.id === row.id) ? row.id : '',
    placeholder: '— nothing from the look-ahead —',
    options: rows.map((r) => ({
      value: r.id,
      label: [locs.get(r.location_id)?.name || r.raw_location, r.raw_label]
        .filter(Boolean).join(' · ').slice(0, 70) || `row ${r.sheet_row}`,
    })),
  });
  // Prefilled from the chosen row where there is one, because `change` only
  // fires when a person picks — a row selected for them would otherwise sit
  // above three empty fields it already knows the answers to.
  const task = textInput({ placeholder: 'What they will do', value: row?.raw_label || '' });
  const location = selectInput({
    value: row?.location_id || '',
    placeholder: '— location —',
    options: locations.map((l) => ({ value: l.id, label: l.name })),
  });
  const category = selectInput({
    value: '',
    placeholder: '— category —',
    options: categories.map((c) => ({ value: c.id, label: c.name })),
  });
  const shiftFrom = (meaning) => {
    const said = String(meaning || '').toLowerCase();
    if (/night/.test(said)) return 'night';
    if (/possession|blanket/.test(said)) return 'possession';
    return 'day';
  };
  const shift = selectInput({
    value: shiftFrom(row?.cells?.[iso]),
    options: SHIFTS.map((sh) => ({ value: sh.id, label: sh.label })),
  });

  // Choosing a row fills the rest in. It is a starting point, not a lock —
  // what the look-ahead calls an activity and what you would tell somebody to
  // do are rarely the same sentence.
  pick.addEventListener('change', () => {
    const chosen = rows.find((r) => r.id === pick.value);
    if (!chosen) return;
    if (!task.value.trim()) task.value = chosen.raw_label || '';
    if (chosen.location_id) location.value = chosen.location_id;
    shift.value = shiftFrom(chosen.cells?.[iso]);
  });

  formModal({
    title: `${person.name} — ${dayLabel(iso, 'medium')}`,
    body: el('div', { class: 'cx-form' }, [
      field('From the look-ahead', pick,
        'What BART asked for on this day. Choosing one fills the rest in and keeps the link, '
        + 'which is what later lets a block be recorded against the row BART themselves '
        + 'scheduled.'),
      field('Task', task),
      field('Location', location),
      field('Category', category),
      field('Shift', shift),
    ]),
    confirmLabel: 'Override the sheet',
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
      redraw();
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Assigning
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Plan somebody onto a span of days.
 *
 * A span rather than a day, because that is how the off-project days arrive:
 * nobody is in the office for one Tuesday, they are in the office Monday to
 * Wednesday. Every day still becomes its own `rc_plan_entries` row — the grain
 * the huddle reads and the reports group by — so this is a convenience over the
 * same write, never a second shape of assignment.
 *
 * **A day can carry more than one task**, which is the normal shape of a shift:
 * a test to witness in the morning and a cable pull after it. It used to skip a
 * day that already had an entry, on the grounds that two current rows would
 * show the person twice — but the answer to that was for the views to read a
 * day as a list, not for the plan to hold one task and lose the rest. Leave and
 * non-working days are still skipped, because those are days somebody is not
 * there at all.
 *
 * **A member assigns themselves and nobody else.** `rc_plan_entries` says the
 * same in Postgres — `rc_can_act_for(person_id)`, the rule an outcome already
 * follows — so this is the interface agreeing with the database rather than
 * enforcing anything: the select simply holds the one name they could write.
 */
function assign({ people, locations, categories, laRows, locs, days, redraw, person, iso, row = null }) {
  const mine = rc.me()?.id || null;
  const canPlan = rc.isAdmin() ? people : people.filter((p) => p.id === mine);
  const who = selectInput({
    value: person?.id || canPlan[0]?.id,
    options: canPlan.map((p) => ({ value: p.id, label: p.name })),
    disabled: canPlan.length <= 1,
  });
  const from = el('input', { type: 'date', class: 'cx-input' });
  const to = el('input', { type: 'date', class: 'cx-input' });
  from.value = iso || days[0];
  to.value = iso || days[0];

  /* What the look-ahead asks for, offered rather than assumed — it says what and
     where and never who, because it has no idea who is on the team. */
  const named = laRows.filter((r) => !iso || !Object.keys(r.cells || {}).length || r.cells[iso]);
  const pick = selectInput({
    value: row?.id || '',
    placeholder: '— not from the look-ahead —',
    options: named.map((r) => ({
      value: r.id,
      label: [locs.get(r.location_id)?.name || r.raw_location, r.raw_label]
        .filter(Boolean).join(' · ').slice(0, 70) || `row ${r.sheet_row}`,
    })),
  });
  const task = textInput({ value: row?.raw_label || '', placeholder: 'What they will do' });
  const location = selectInput({
    value: row?.location_id || '',
    placeholder: '— nowhere on site —',
    options: locations.map((l) => ({ value: l.id, label: l.name })),
  });
  const category = selectInput({
    value: '',
    placeholder: '— category —',
    options: categories.map((c) => ({ value: c.id, label: c.name })),
  });
  const shift = selectInput({ value: 'day', options: SHIFTS.map((sh) => ({ value: sh.id, label: sh.label })) });

  pick.addEventListener('change', () => {
    const chosen = named.find((r) => r.id === pick.value);
    if (!chosen) return;
    if (!task.value.trim()) task.value = chosen.raw_label || '';
    if (chosen.location_id) location.value = chosen.location_id;
  });

  formModal({
    title: person ? `Assign ${person.name}` : 'Assign work',
    body: el('div', { class: 'cx-form' }, [
      field('Resource', who),
      field('From', from),
      field('To', to, 'Inclusive. Days they do not work and days they are on leave are skipped, '
        + 'and it says how many. A day that already has a task gets this one as well — a shift '
        + 'is often more than one job.'),
      field('From the look-ahead', pick, 'Optional. Choosing a row fills the rest in and keeps the '
        + 'link, which is what later lets a block be recorded against the row BART themselves '
        + 'scheduled. Leave it alone for work the 4WLA has never heard of.'),
      field('What', task),
      field('Where', location, 'Optional — a day in the office or on another project is not at a '
        + 'commissioning location, and pretending otherwise would put it in the site reports.'),
      field('Category', category),
      field('Shift', shift),
    ]),
    confirmLabel: 'Assign',
    onConfirm: async () => {
      if (!task.value.trim()) throw new Error('Say what they will be doing.');
      if (!from.value || !to.value) throw new Error('Both dates are needed.');
      if (to.value < from.value) throw new Error('The end is before the start.');

      const personRow = canPlan.find((p) => p.id === who.value);
      if (!personRow) {
        throw new Error(rc.isAdmin()
          ? 'Pick a person.'
          : 'You can plan your own days. An administrator plans everybody else’s.');
      }

      /* Leave and the plan are re-read here rather than passed in: this dialog
         can stay open while somebody else writes, and the skip has to be about
         what is true now. */
      const [leave, existing] = await Promise.all([
        rc.listLeave(from.value, to.value),
        rc.listPlan(from.value, to.value),
      ]);

      const rows = [];
      let alsoOn = 0;
      const skipped = { leave: 0, nonWorking: 0 };
      for (let ms = Date.parse(`${from.value}T00:00:00Z`);
        ms <= Date.parse(`${to.value}T00:00:00Z`); ms = addDays(ms, 1)) {
        const day = toISO(ms);
        const state = availability(personRow, day, leave);
        if (state.state === 'leave') { skipped.leave++; continue; }
        if (state.state === 'non-working') { skipped.nonWorking++; continue; }
        /* A day already planned is *added to*, not skipped. What it used to do
           was drop the task on the floor with a count in a toast, which is how
           somebody ends up with one of the three things they were asked for. */
        if (existing.some((e) => e.person_id === personRow.id && e.work_date === day)) {
          alsoOn++;
        }
        rows.push({
          person_id: personRow.id,
          work_date: day,
          shift: shift.value,
          location_id: location.value || null,
          task: task.value.trim(),
          category_id: category.value || null,
          lookahead_row_id: pick.value || null,
        });
      }

      if (!rows.length) {
        throw new Error('Every day in that span is non-working or on leave — there is no day '
          + 'there to plan.');
      }

      await rc.addPlanEntries(rows);
      notifyChanged('plan');
      const notes = [
        alsoOn ? `${alsoOn} alongside what was already there` : null,
        skipped.leave ? `${skipped.leave} on leave` : null,
        skipped.nonWorking ? `${skipped.nonWorking} not a working day` : null,
      ].filter(Boolean);
      toast({
        tone: 'good',
        message: `${personRow.name} assigned for ${rows.length} day(s)`
          + `${notes.length ? ` — ${notes.join(', ')}` : ''}.`,
        timeout: 8000,
      });
      redraw();
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Names
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Record which person a spelling in the workbook is.
 *
 * The same shape as another spelling for a location, and for the same reason:
 * the match has to be exact, so the only way a new spelling starts matching is
 * that somebody says it does. Once.
 */
function mapName(unmatchedName, people, redraw) {
  const who = selectInput({
    value: people[0]?.id,
    options: people.map((p) => ({ value: p.id, label: p.name })),
  });
  formModal({
    title: `"${unmatchedName.name}" is…`,
    body: el('div', { class: 'cx-form' }, [
      field('Person', who),
      el('p', {
        class: 'rc-hint',
        text: 'This records the spelling against them, so every week from now on matches without '
          + 'anybody being asked again. It is not a guess and never becomes one: nothing here '
          + 'matches on a surname, initials or a near miss.',
      }),
    ]),
    confirmLabel: 'That is them',
    onConfirm: async () => {
      await rc.addPersonAlias(who.value, unmatchedName.name);
      notifyChanged('people');
      toast({ tone: 'good', message: `"${unmatchedName.name}" now matches.` });
      redraw();
    },
  });
}

/**
 * Somebody on site who is not on the roster at all.
 *
 * The spelling in the workbook becomes an alias immediately, so the row they
 * were named on stops being unmatched. Their name is the spelling until somebody
 * tidies it in Organisation — a person on the roster under an odd spelling is
 * still on the roster, and an empty roster row would be worse.
 */
async function addFromName(unmatchedName, redraw) {
  const name = await promptDialog({
    title: 'Add them to the team',
    label: 'Name, as you would write it',
    value: unmatchedName.name,
    confirmLabel: 'Add',
  });
  if (!name || !name.trim()) return;
  try {
    const person = await rc.addPerson({ name: name.trim(), role: 'member', scheduled: true });
    if (foldName(name) !== foldName(unmatchedName.name)) {
      await rc.addPersonAlias(person.id, unmatchedName.name);
    }
    notifyChanged('people');
    toast({ tone: 'good', message: `${name.trim()} is on the team, and "${unmatchedName.name}" matches them.` });
    redraw();
  } catch (err) {
    toast({ tone: 'bad', message: err.message });
  }
}

/**
 * Record which place a spelling in the workbook is.
 *
 * The counterpart of `mapName()`, and the same rule: exact or nothing, so the
 * only way a new spelling starts matching is that somebody says it does. Once,
 * and every week afterwards is answered.
 */
function mapLocation(unmatched, locations, redraw) {
  const where = selectInput({
    value: locations[0]?.id,
    options: locations.map((l) => ({
      value: l.id, label: l.code ? `${l.name} (${l.code})` : l.name,
    })),
  });
  formModal({
    title: `"${unmatched.name}" is…`,
    body: el('div', { class: 'cx-form' }, [
      field('Location', where),
      el('p', {
        class: 'rc-hint',
        text: 'This records the spelling against that location, so every week from now on resolves '
          + 'without anybody being asked again \u2014 in the reports and the activity log as well as '
          + 'here. Nothing is matched on a near miss.',
      }),
    ]),
    confirmLabel: 'That is the place',
    onConfirm: async () => {
      await rc.addLocationAlias(where.value, unmatched.name);
      notifyChanged('locations');
      toast({ tone: 'good', message: `"${unmatched.name}" now resolves.` });
      redraw();
    },
  });
}

/**
 * A place the register has never carried.
 *
 * The spelling becomes the code rather than an alias: it is what the workbook
 * writes and what somebody will type next week, and a code is the field
 * `rc_resolve_location()` reads it out of. The name is the spelling until
 * somebody gives it a fuller one in Organisation — a location under a short
 * name is still a location, and rows filed nowhere are worse.
 */
async function addFromLocation(unmatched, redraw) {
  const name = await promptDialog({
    title: 'Add it to the register',
    label: 'Location name, as you would write it',
    value: unmatched.name,
    confirmLabel: 'Add',
  });
  if (!name || !name.trim()) return;
  try {
    const created = await rc.addLocation({ name: name.trim(), code: unmatched.name, active: true });
    if (foldName(name) !== foldName(unmatched.name) && created?.id) {
      await rc.addLocationAlias(created.id, unmatched.name).catch(() => {});
    }
    notifyChanged('locations');
    toast({ tone: 'good', message: `${name.trim()} is on the register, and "${unmatched.name}" resolves to it.` });
    redraw();
  } catch (err) {
    toast({ tone: 'bad', message: err.message });
  }
}
