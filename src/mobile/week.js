/**
 * My week — what I am on, day by day, and the way to change it.
 *
 * The week plan's own reading, turned on its side for a phone: one person down
 * the screen instead of the team across it. Nothing here decides anything the
 * week plan does not. The day's tasks are `assignmentIndex().on()` — a stored
 * entry where somebody wrote one, the 4WLA where nobody did — availability is
 * `availability()`, how a task went is `outcomeLookup()`, and every write is an
 * `rc_plan_entries` row through `core/rc.js`. So a task added on a phone is in
 * tomorrow's huddle against its owner's name exactly as one added at a desk.
 *
 * **What can be changed is what the database would allow.** A member plans,
 * revises and withdraws their own days; an administrator anybody's; a viewer
 * nobody's. That is `rc_can_act_for()` in Postgres, and this only stops
 * offering what would be refused. Anybody may *look* at a colleague's week —
 * the week plan shows every member the whole team — which is what the picker is
 * for: "where is Dan on Thursday" is a phone question.
 *
 * Three writes, the same three as the week plan:
 *
 *   - **Add** writes a new entry for a day, and optionally for other days of the
 *     same week — a Monday-to-Wednesday office stint is one form, not three.
 *   - **Change** revises a stored entry (`rc_supersede_plan`: the old version
 *     stays on the record) or, on a day the 4WLA plans, writes the first stored
 *     entry — which is overriding the sheet, and the form says so.
 *   - **Remove** withdraws a stored entry (`rc_withdraw_plan`, a tombstone, never
 *     a delete). A day the sheet asserts has nothing to withdraw; changing it is
 *     the honest answer there.
 *
 * Imports: util, dates, rc, icons, components, rc_util.
 */

import { el, clear } from '../core/util.js';
import { todayMs, MS_DAY, DAYS } from '../core/dates.js';
import * as rc from '../core/rc.js';
import { icon } from '../ui/icons.js';
import {
  textInput, selectInput, segmented, toast, badge, field, confirmDialog,
} from '../ui/components.js';
import {
  SHIFTS, STATUS_BY_ID, weekStart, allWeekDays, todayISO, dayLabel, isoToMs, byId, availability,
  notifyChanged, formModal, nameRegister, lookaheadWithResources, assignmentIndex, outcomeLookup,
} from '../ui/rc_util.js';

/** The Monday on screen, or null for this week. */
let weekOf = null;
/** Whose week, or null for the signed-in person's own. */
let whose = null;
/** Which week and person today has already been scrolled to, so a re-read does not jump. */
let scrolledFor = null;

export async function render(root) {
  const me = rc.me();
  const startMs = weekOf ?? weekStart(todayMs());
  const days = allWeekDays(startMs);
  const from = days[0];
  const to = days[days.length - 1];
  const today = todayISO();

  const [everybody, scheduled, locations, categories, leave, planRows, actuals, aliases, sheet] =
    await Promise.all([
      /* Everybody for the register — a name in the workbook belongs to whoever
         it belongs to — and the scheduled roster for the picker, which is who
         the week plan draws. */
      rc.listPeople(),
      rc.listPeople({ scheduledOnly: true }),
      rc.listLocations(),
      rc.listCategories(),
      rc.listLeave(from, to),
      rc.listPlan(from, to),
      rc.listActuals(from, to).catch(() => []),
      rc.listPersonAliases().catch(() => []),
      lookaheadWithResources(from, to),
    ]);

  /* `me()` carries the account's role, not the roster row's working days —
     which is what `availability()` reads. The roster has the whole row. */
  const self = everybody.find((p) => p.id === me.id) || me;
  const choices = [self, ...scheduled.filter((p) => p.id !== self.id)];
  if (whose && !choices.some((p) => p.id === whose)) whose = null;
  const person = choices.find((p) => p.id === (whose || self.id)) || self;
  const own = person.id === self.id;
  const mayPlan = rc.canWrite() && (rc.isAdmin() || own);

  const locs = byId(locations);
  const cats = byId(categories);
  const index = assignmentIndex({
    planRows,
    laRows: sheet.rows,
    absences: sheet.absences,
    categories,
    register: nameRegister(everybody.length ? everybody : scheduled, aliases),
  });
  const outcomeFor = outcomeLookup(actuals);
  const redraw = () => { clear(root); return render(root); };

  const ctx = {
    person, days, from, to, today, leave, locations, categories, locs, laRows: sheet.rows, index,
  };

  /* ── The week and whose it is ─────────────────────────────────────────── */

  const current = weekOf === null;
  root.appendChild(el('div', { class: 'm-weekbar' }, [
    el('button', {
      class: 'cx-btn icon ghost m-step',
      'aria-label': 'Previous week',
      html: icon('chevron-left', { size: 20 }),
      onClick: () => { weekOf = startMs - 7 * MS_DAY; redraw(); },
    }),
    el('div', { class: 'm-weekbar-mid' }, [
      el('div', { class: 'm-weekbar-title', text: `${dayLabel(from, 'day')} – ${dayLabel(to, 'day')}` }),
      current
        ? el('div', { class: 'm-weekbar-sub', text: 'This week' })
        : el('button', {
          class: 'm-weekbar-sub m-link',
          type: 'button',
          text: 'Back to this week',
          onClick: () => { weekOf = null; redraw(); },
        }),
    ]),
    el('button', {
      class: 'cx-btn icon ghost m-step',
      'aria-label': 'Next week',
      html: icon('chevron-right', { size: 20 }),
      onClick: () => { weekOf = startMs + 7 * MS_DAY; redraw(); },
    }),
  ]));

  if (choices.length > 1) {
    const picker = selectInput({
      value: person.id,
      options: choices.map((p) => ({ value: p.id, label: p.id === self.id ? `${p.name} (me)` : p.name })),
      onChange: (value) => { whose = value === self.id ? null : value; redraw(); },
    });
    picker.setAttribute('aria-label', 'Whose week');
    root.appendChild(el('div', { class: 'm-whose' }, [
      el('span', { class: 'm-whose-label', html: icon('user', { size: 14 }) }),
      picker,
    ]));
  }

  if (!mayPlan) {
    root.appendChild(el('p', {
      class: 'm-note',
      text: !rc.canWrite()
        ? 'Your account can read the calendar but not change it.'
        : `This is ${person.name}’s week, so it is read-only here. You can change your own.`,
    }));
  }

  /* ── The days ─────────────────────────────────────────────────────────── */

  const list = el('div', { class: 'm-days' });
  let tasks = 0;
  let off = 0;
  for (const iso of days) {
    const state = availability(person, iso, leave, index.absent(person.id, iso));
    if (state.state === 'leave') off++;
    else tasks += index.on(person.id, iso).length;
    list.appendChild(dayCard(iso, state, { ...ctx, mayPlan, outcomeFor, cats, everybody, own }));
  }

  root.appendChild(el('p', {
    class: 'm-summary',
    text: [
      `${tasks} task${tasks === 1 ? '' : 's'} planned`,
      off ? `${off} day${off === 1 ? '' : 's'} off` : null,
    ].filter(Boolean).join(' · '),
  }));
  root.appendChild(list);

  root.appendChild(el('p', {
    class: 'm-note m-foot',
    text: 'Where the 4WLA names you, that is your plan for the day and nothing needs typing. '
      + 'Anything you add or change here is saved as your own entry, which the daily huddle and '
      + 'the week plan read exactly as they read the sheet — and nothing is ever deleted: a '
      + 'changed or removed task stays on the record.',
  }));

  /* Today, in view — once per week and person, so a re-read after an edit does
     not yank the screen back up to it. */
  const key = `${person.id}|${from}`;
  if (current && scrolledFor !== key) {
    scrolledFor = key;
    const card = list.querySelector('.m-today');
    if (card) requestAnimationFrame(() => card.scrollIntoView({ block: 'start' }));
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   A day
   ═══════════════════════════════════════════════════════════════════════ */

function dayCard(iso, state, ctx) {
  const { person, today, index, mayPlan } = ctx;
  const planned = index.on(person.id, iso);
  const quiet = state.state === 'non-working' && !planned.length;
  const ms = isoToMs(iso);

  const card = el('section', {
    class: [
      'm-day',
      iso === today ? 'm-today' : '',
      quiet ? 'm-quiet' : '',
      state.state === 'leave' ? 'm-off' : '',
    ].filter(Boolean).join(' '),
    'data-date': iso,
    'aria-label': dayLabel(iso, 'dayFull'),
  });

  card.appendChild(el('header', { class: 'm-day-head' }, [
    el('span', { class: 'm-day-name', text: DAYS[new Date(ms).getUTCDay()] }),
    el('span', { class: 'm-day-date', text: dayLabel(iso, 'medium').replace(/,? \d{4}$/, '') }),
    iso === today ? el('span', { class: 'm-today-tag', text: 'Today' }) : null,
    el('span', { class: 'm-day-flags' }, [
      state.state === 'leave' ? badge(state.sheet ? 'PTO' : 'On leave', 'pending') : null,
      /* Asked for and not yet answered: the day is still a working day, and
         saying so here stops somebody planning straight over their own request. */
      state.asked ? badge('Leave requested', 'warn') : null,
      quiet ? el('span', { class: 'm-hint', text: 'Not a working day' }) : null,
    ]),
  ]));

  if (state.state === 'leave' || quiet) return card;

  const body = el('div', { class: 'm-day-body' });
  if (!planned.length) body.appendChild(el('p', { class: 'm-empty-day', text: 'Nothing planned' }));
  for (const entry of planned) body.appendChild(taskCard(entry, iso, ctx));

  /* A stored entry that is not what the sheet asks for. The one case worth
     drawing twice — somebody decided against the workbook — and the same rule
     the week plan draws it by. */
  const first = planned[0];
  if (first && !first.from_lookahead) {
    const linked = new Set(planned.map((e) => e.lookahead_row_id).filter(Boolean));
    const asked = (index.byPerson.get(person.id)?.get(iso) || []).filter((row) => !linked.has(row.id));
    for (const row of asked) {
      body.appendChild(el('div', { class: 'm-asked' }, [
        el('span', { class: 'rc-eyebrow', text: '4WLA also has you on' }),
        el('div', {
          text: [row.raw_label || `row ${row.sheet_row}`,
            ctx.locs.get(row.location_id)?.name || row.raw_location].filter(Boolean).join(' · '),
        }),
      ]));
    }
  }

  if (mayPlan && state.state === 'available') {
    body.appendChild(el('button', {
      class: 'cx-btn m-add',
      type: 'button',
      html: `${icon('plus', { size: 16 })}<span>${planned.length ? 'Add another task' : 'Add a task'}</span>`,
      'aria-label': `Add a task on ${dayLabel(iso, 'day')}`,
      onClick: () => addTask(iso, ctx),
    }));
  }
  card.appendChild(body);
  return card;
}

function taskCard(entry, iso, ctx) {
  const { person, locs, cats, mayPlan, outcomeFor, everybody } = ctx;
  const outcome = outcomeFor(entry, person.id, iso);
  const status = outcome ? STATUS_BY_ID.get(outcome.status) : null;
  const where = locs.get(entry.location_id)?.name || entry.raw_location;
  const shift = entry.shift && entry.shift !== 'day' ? SHIFTS.find((s) => s.id === entry.shift)?.label : null;

  const flags = [
    /* The workbook is the assumption, so only a day somebody typed carries a
       flag — the rule the week plan and the huddle follow. */
    !entry.from_lookahead && entry.id ? badge('Manual', 'warn') : null,
    entry.reassigned_from
      ? badge(`Reassigned from ${everybody.find((p) => p.id === entry.reassigned_from)?.name || 'somebody'}`, 'info')
      : null,
    entry.supersedes_id && !entry.reassigned_from ? badge('Revised', 'warn') : null,
    entry.carry_chain_id ? badge('Carried over', 'warn') : null,
  ].filter(Boolean);

  return el('article', {
    class: ['m-task', entry.absence ? 'm-task-away' : '', outcome ? `m-done m-done-${outcome.status}` : '']
      .filter(Boolean).join(' '),
  }, [
    el('div', { class: 'm-task-title', text: entry.task || '—' }),
    where || shift || entry.category_id
      ? el('div', { class: 'm-task-meta' }, [
        where ? el('span', { class: 'm-where', html: `${icon('pin', { size: 13 })}` }, [where]) : null,
        shift ? el('span', { text: shift }) : null,
        cats.get(entry.category_id)?.name ? el('span', { text: cats.get(entry.category_id).name }) : null,
      ])
      : null,
    flags.length ? el('div', { class: 'm-flags' }, flags) : null,
    /* How it went, from the huddle. Read-only: the meeting is where an outcome
       is recorded and there is one recording path. */
    outcome
      ? el('div', { class: 'm-outcome' }, [
        el('div', { class: 'm-outcome-head' }, [
          el('span', { class: 'rc-eyebrow', text: 'Recorded' }),
          badge(status?.label || outcome.status, status?.tone || 'neutral'),
        ]),
        outcome.task && outcome.task !== entry.task
          ? el('div', { class: 'm-hint', text: `Did: ${outcome.task}` }) : null,
        outcome.blocked_reason ? el('div', { class: 'm-hint', text: outcome.blocked_reason }) : null,
        outcome.note ? el('div', { class: 'm-hint', text: outcome.note }) : null,
        outcome.evidence_path
          ? el('button', {
            class: 'cx-btn mini ghost',
            type: 'button',
            html: `${icon('camera', { size: 13 })}<span>Photo</span>`,
            onClick: async () => {
              try {
                window.open(await rc.evidenceUrl(outcome.evidence_path), '_blank', 'noopener');
              } catch (err) {
                toast({ tone: 'bad', message: `That photograph could not be opened — ${err.message}` });
              }
            },
          })
          : null,
      ])
      : null,
    mayPlan
      ? el('div', { class: 'm-task-acts' }, [
        el('button', {
          class: 'cx-btn',
          type: 'button',
          html: `${icon('edit', { size: 14 })}<span>Change</span>`,
          'aria-label': `Change ${entry.task || 'this task'} on ${dayLabel(iso, 'day')}`,
          onClick: () => (entry.id ? revise(entry, iso, ctx) : override(entry, iso, ctx)),
        }),
        entry.id
          ? el('button', {
            class: 'cx-btn ghost danger',
            type: 'button',
            html: `${icon('trash', { size: 14 })}<span>Remove</span>`,
            'aria-label': `Remove ${entry.task || 'this task'} from ${dayLabel(iso, 'day')}`,
            onClick: () => withdraw(entry, iso, ctx),
          })
          : null,
      ])
      : null,
  ]);
}

/* ══════════════════════════════════════════════════════════════════════════
   Changing the plan
   ═══════════════════════════════════════════════════════════════════════ */

/** The look-ahead rows a task on `iso` could be linked to. */
function sheetRowsOn(iso, laRows) {
  return (laRows || []).filter((r) =>
    !Object.keys(r.cells || {}).length || r.cells?.[iso] || r.resources?.[iso]);
}

function rowLabel(row, locs) {
  return [row.raw_label, locs.get(row.location_id)?.name || row.raw_location]
    .filter(Boolean).join(' · ') || `row ${row.sheet_row}`;
}

/**
 * One form for the three writes.
 *
 * A bottom sheet on a phone (the stylesheet makes every modal one), with the
 * fields in the order somebody answers them: what, where, which shift, what kind
 * of work. `sheetRows` offers the look-ahead's rows for the day — picking one
 * fills the rest in and keeps the link, which is what later lets a block be
 * recorded against the row BART scheduled. `alsoOn` offers the week's other
 * working days, so one form covers a stint.
 */
function taskForm({
  title, confirmLabel, values = {}, note = null, sheetRows = [], alsoOn = [], ctx, onSave,
}) {
  const { locations, categories, locs } = ctx;

  const pick = sheetRows.length
    ? selectInput({
      value: values.lookahead_row_id && sheetRows.some((r) => r.id === values.lookahead_row_id)
        ? values.lookahead_row_id : '',
      placeholder: '— not from the look-ahead —',
      options: sheetRows.map((r) => ({ value: r.id, label: rowLabel(r, locs) })),
    })
    : null;
  const task = textInput({ value: values.task || '', placeholder: 'What you will do' });
  task.setAttribute('enterkeyhint', 'done');
  const location = selectInput({
    value: values.location_id || '',
    placeholder: '— not on site —',
    options: locations.map((l) => ({ value: l.id, label: l.name })),
  });
  let shift = values.shift || 'day';
  const shifts = segmented({
    value: shift,
    stretch: true,
    options: SHIFTS.map((s) => ({ value: s.id, label: s.label })),
    onChange: (value) => { shift = value; },
  });
  const category = selectInput({
    value: values.category_id || '',
    placeholder: '— none —',
    options: categories.map((c) => ({ value: c.id, label: c.name })),
  });

  if (pick) {
    pick.addEventListener('change', () => {
      const row = sheetRows.find((r) => r.id === pick.value);
      if (!row) return;
      if (!task.value.trim()) task.value = row.raw_label || '';
      if (row.location_id) location.value = row.location_id;
    });
  }

  const chosen = new Set();
  const days = alsoOn.length
    ? el('div', { class: 'm-daychips', role: 'group', 'aria-label': 'Also on' }, alsoOn.map((iso) => {
      const chip = el('button', {
        class: 'm-chip',
        type: 'button',
        'aria-pressed': 'false',
        text: dayLabel(iso, 'day').replace(/,.*$/, ''),
        title: dayLabel(iso, 'dayFull'),
        onClick: () => {
          if (chosen.has(iso)) chosen.delete(iso);
          else chosen.add(iso);
          chip.setAttribute('aria-pressed', String(chosen.has(iso)));
        },
      });
      return chip;
    }))
    : null;

  formModal({
    title,
    body: el('div', { class: 'cx-form m-form' }, [
      note ? el('p', { class: 'm-note', text: note }) : null,
      pick ? field('From the look-ahead', pick) : null,
      field('Task', task),
      field('Where', location),
      field('Shift', shifts),
      field('Kind of work', category),
      days ? field('Also on', days, 'The same task on these days too — one entry per day.') : null,
    ].filter(Boolean)),
    confirmLabel,
    onConfirm: async () => {
      if (!task.value.trim()) throw new Error('Say what the task is.');
      await onSave({
        task: task.value.trim(),
        location_id: location.value || null,
        category_id: category.value || null,
        shift,
        lookahead_row_id: pick ? (pick.value || null) : (values.lookahead_row_id || null),
        days: [...chosen].sort(),
      });
    },
  });
}

/** A new entry on a day, and on any other days of the week ticked alongside it. */
function addTask(iso, ctx) {
  const { person, days, leave, index, laRows } = ctx;
  const alsoOn = days.filter((d) => d !== iso
    && availability(person, d, leave, index.absent(person.id, d)).state === 'available');

  taskForm({
    title: `Add to ${dayLabel(iso, 'day')}`,
    confirmLabel: 'Add',
    sheetRows: sheetRowsOn(iso, laRows),
    alsoOn,
    ctx,
    onSave: async (v) => {
      const dates = [iso, ...v.days];
      await rc.addPlanEntries(dates.map((work_date) => ({
        person_id: person.id,
        work_date,
        shift: v.shift,
        location_id: v.location_id,
        task: v.task,
        category_id: v.category_id,
        lookahead_row_id: v.lookahead_row_id,
      })));
      notifyChanged('plan');
      toast({
        tone: 'good',
        message: dates.length === 1
          ? `Added to ${dayLabel(iso, 'day')}.`
          : `Added to ${dates.length} days.`,
      });
    },
  });
}

/**
 * Revise a stored entry. The version it replaces stays on the record, and an
 * entry somebody else revised first is refused rather than silently lost.
 */
async function revise(entry, iso, ctx) {
  const history = await rc.planHistory(entry.person_id, iso).catch(() => []);
  const before = history.filter((h) => h.id !== entry.id && !h.withdrawn).length;
  taskForm({
    title: `Change ${dayLabel(iso, 'day')}`,
    confirmLabel: 'Save',
    values: entry,
    note: before
      ? `Changed ${before} time${before === 1 ? '' : 's'} before. Every version stays on the record.`
      : 'The version you replace stays on the record.',
    ctx,
    onSave: async (v) => {
      await rc.supersedePlan(entry.id, {
        locationId: v.location_id,
        task: v.task,
        categoryId: v.category_id,
        shift: v.shift,
      });
      notifyChanged('plan');
      toast({ tone: 'good', message: 'Saved.' });
    },
  });
}

/**
 * Change a day the 4WLA plans. There is no row to revise, so this writes the
 * first one — overriding the sheet for that day, which is exactly what it says.
 */
function override(entry, iso, ctx) {
  const { person, laRows } = ctx;
  taskForm({
    title: `Change ${dayLabel(iso, 'day')}`,
    confirmLabel: 'Save my entry',
    values: entry,
    note: 'The look-ahead plans this day. Saving writes your own entry for it, which takes the '
      + 'sheet’s place for this day in the huddle and the week plan. The workbook itself is not '
      + 'changed.',
    sheetRows: entry.lookahead_row_id ? sheetRowsOn(iso, laRows) : [],
    ctx,
    onSave: async (v) => {
      await rc.addPlanEntries([{
        person_id: person.id,
        work_date: iso,
        shift: v.shift,
        location_id: v.location_id,
        task: v.task,
        category_id: v.category_id,
        lookahead_row_id: v.lookahead_row_id,
      }]);
      notifyChanged('plan');
      toast({ tone: 'good', message: 'Saved as your own entry for the day.' });
    },
  });
}

/** Take a stored task off the schedule. A tombstone, never a delete. */
async function withdraw(entry, iso) {
  const ok = await confirmDialog({
    title: `Remove this from ${dayLabel(iso, 'day')}?`,
    message: 'It comes off the schedule. Nothing is deleted: the record keeps it as planned and '
      + 'then removed.',
    confirmLabel: 'Remove',
    danger: true,
  });
  if (!ok) return;
  try {
    await rc.withdrawPlan(entry.id);
    notifyChanged('plan');
    toast({ tone: 'good', message: 'Removed. The record still has it.' });
  } catch (err) {
    toast({ tone: 'bad', message: err?.message || String(err) });
  }
}
