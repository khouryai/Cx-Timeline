/**
 * Resources — who is where, and what they are on.
 *
 * The week plan answers "what is the team doing this week" from the plan's own
 * side. This answers the question the other way round: for each person, where
 * are they, and does that agree with what the look-ahead asked for. They are two
 * readings of the same rows and neither is a copy of the other, because the
 * question a resource asks about their own week is not the question a scheduler
 * asks about the team's.
 *
 * Three things make it worth its own tab rather than another column somewhere.
 *
 * **The 4WLA names people, and until now nothing read that.** The workbook
 * carries a row under each activity whose description reads "Resource", with the
 * names typed into the day cells; `core/lookahead.js` reads it and stores it on
 * the row. Here those names are matched against the roster — exactly, through
 * the alias register, never by guessing at a surname — and where a spelling is
 * not known it is *shown* rather than dropped. A view that is incomplete and
 * says so is usable; one that is quietly wrong is not.
 *
 * **A person's week is not all commissioning work.** A day in the office, a day
 * on another project, a day of training: without somewhere for those to go the
 * huddle has a blank against somebody's name and no way to tell "nothing
 * planned" from "nothing said". So work can be assigned here that the look-ahead
 * has never heard of, over a span of days rather than one at a time, because
 * that is how those days actually arrive.
 *
 * **Everything written here is a plan entry.** Not a second table of
 * assignments — the same `rc_plan_entries` the week plan writes and the huddle
 * reads, so a resource turning up in this view turns up in tomorrow's meeting
 * with no further wiring. That is the whole of "tied to the huddle": there is
 * one place a day is planned, and three places it is read.
 *
 * Imports: util, dates, rc, icons, components, rc_util.
 */

import { el, clear } from '../core/util.js';
import { toISO, addDays, todayMs } from '../core/dates.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import {
  textInput, selectInput, toast, badge, checkbox, field, emptyState, promptDialog,
} from './components.js';
import {
  SHIFTS, weekStart, allWeekDays, todayISO, dayLabel, byId, availability,
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
  const [people, locations, categories, leave, planRows, aliases, locAliases, sheet, everybody] =
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
      rc.listLeave(from, to),
      rc.listPlan(from, to),
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
  const index = assignmentIndex({ planRows, laRows, absences: sheet.absences, register });
  const { byPerson, unmatched } = index;
  /* "Nobody is called that" and "two people are, and I will not choose" are
     different problems with different fixes, and a list that ran them together
     would send somebody looking for a person who is already on the roster
     twice. */
  const shared = ambiguousFirstNames(people);
  /* Where the sheet says the work is. The same answer as a name it cannot place:
     the spelling is kept and shown, never discarded and never guessed at. */
  const strangeLocations = unmatchedLocations(laRows, locationRegister(locations, locAliases));

  /* Only the days somebody works, unless asked otherwise. `showQuietDays` is
     about the columns; a person who works none of them still has a row, because
     a row that vanishes is a person nobody remembers to plan. */
  const shown = showQuietDays
    ? days
    : days.filter((iso) => people.some((p) => availability(p, iso, leave).state !== 'non-working'));
  const columns = shown.length ? shown : days;

  const redraw = () => { clear(root); render(root); };

  root.appendChild(el('div', { class: 'rc-section-head' }, [
    el('button', {
      class: 'cx-btn icon mini ghost',
      'aria-label': 'Previous week',
      html: icon('chevron-left', { size: 13 }),
      onClick: () => { weekOf = startMs - 7 * 86400000; redraw(); },
    }),
    el('h3', { text: `Resources — week of ${dayLabel(from, 'medium')}` }),
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
      const state = availability(person, iso, leave, index.absent(person.id, iso));
      const asked = wanted.get(iso) || [];
      const classes = ['rc-res-cell'];
      if (iso === today) classes.push('rc-res-today');

      if (state.state === 'leave') {
        return el('td', { class: classes.join(' '), 'data-label': dayLabel(iso) }, [
          badge('Leave', 'muted'),
          // Whether anybody booked it or the 4WLA's PTO row is the only place it
          // is written down. Both are the same day off; only one has a record.
          state.sheet ? badge('From 4WLA', 'info') : null,
        ].filter(Boolean));
      }
      const planned = index.on(person.id, iso);
      if (state.state === 'non-working' && !planned.length && !asked.length) {
        return el('td', {
          class: `${classes.join(' ')} rc-inactive`,
          'data-label': dayLabel(iso),
        }, [el('span', { text: '·' })]);
      }

      const parts = [];
      // Every task on the day, not the first of them. A shift is routinely two
      // jobs, and drawing one was how the other went missing.
      for (const entry of planned) {
        parts.push(el('div', { class: `rc-res-job${entry.absence ? ' rc-res-away' : ''}` }, [
          el('div', { text: entry.task || '—' }),
          el('div', { class: 'rc-hint', text: [
            locs.get(entry.location_id)?.name || entry.raw_location,
            cats.get(entry.category_id)?.name,
            entry.shift !== 'day' ? entry.shift : null,
          ].filter(Boolean).join(' · ') }),
          entry.from_lookahead ? badge('From 4WLA', 'info') : null,
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

      /* Whose day this is decides whether it can be added to. A member plans
         their own and an administrator plans anyone's, which is the rule
         `rc_plan_entries` makes in Postgres — this only stops offering what
         the database would refuse. */
      const mayPlan = rc.canWrite() && (rc.isAdmin() || person.id === rc.me()?.id);
      if (!mayPlan) {
        return el('td', { class: classes.join(' '), 'data-label': dayLabel(iso) },
          parts.length ? parts : [el('span', { class: 'rc-hint', text: '—' })]);
      }
      /* The button is there whether or not the day already has something on it:
         a shift is often more than one job, and a day that could only ever hold
         one task is how somebody ends up with one of the three things they were
         asked for. */
      parts.push(el('button', {
        class: 'cx-btn mini ghost',
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

  root.appendChild(el('div', { class: 'rc-scroll' }, [
    el('table', { class: 'rc-table rc-resources' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Resource' }),
          ...columns.map((iso) => el('th', {
            class: iso === today ? 'rc-res-today' : '',
            text: dayLabel(iso),
          })),
        ]),
      ]),
      body,
    ]),
  ]));

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
    text: 'Everything here is a plan entry — the same rows the week plan writes and the daily '
      + 'huddle reads — so anybody assigned here is in tomorrow\'s meeting with their scope '
      + 'against their name, ready to speak to it. There is one place a day is planned and three '
      + 'places it is read.',
  }));
  root.appendChild(el('p', {
    class: 'rc-hint',
    text: laRows.length
      ? `The 4WLA names people on ${laRows.filter((r) => Object.keys(r.resources || {}).length).length} `
        + 'row(s) in these weeks, and where it names somebody that is their plan for the day — '
        + 'marked "From 4WLA", derived from the sheet rather than written down, so it follows the '
        + 'workbook instead of going stale beside it. A plan entry is somebody overriding that, or '
        + 'planning a day the sheet says nothing about; where an override disagrees with the '
        + 'sheet, both are drawn, because that is the case worth seeing.'
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

/* ══════════════════════════════════════════════════════════════════════════
   Assigning
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Plan somebody onto a span of days.
 *
 * A span rather than a day, because that is how the off-programme days arrive:
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
