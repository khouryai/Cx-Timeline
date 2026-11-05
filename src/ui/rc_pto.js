/**
 * PTO — who is off, what is booked, and where the two disagree.
 *
 * Leave already had a home: a list in Lists → Leave, sorted by start date.
 * That is the *record* and it stays there. It is not a view anybody can
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
 * down: somebody types a name into the 4WLA and never opens Lists. Reading it
 * is what stops the editor's staffing check putting a person on holiday on a
 * shift.
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
 * matters. `scheduled` is what the staffing checks filter on because those
 * are about work; this is about people.
 *
 * **Leave is booked, never asked for.** Everybody with the application is an
 * editor, so there is nothing to approve: whoever holds the calendar's pen
 * books it, and anybody else reads it.
 *
 * **It looks as far ahead as leave is booked.** Two, four, eight or thirteen
 * weeks from any Monday; a stretch of leave is one bar with its kind written in
 * it; and the list under it holds every record — these weeks, everything from
 * today on, or everything ever booked — not only the window's. Past what the
 * newest reading covers, the PTO row is read from what the editor holds, the
 * way the look-ahead's own read view pages past its reading.
 *
 * Imports: util, dates, rc, icons, components, core/lookahead, core/la_edit,
 *          rc_util, rc_ingest.
 */

import { el, clear } from '../core/util.js';
import { toISO, addDays, todayMs } from '../core/dates.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import {
  textInput, selectInput, toast, field, emptyState, badge, checkbox,
} from './components.js';
import { ABSENCE_LABELS, absencesFrom } from '../core/lookahead.js';
import { addDaysISO, mondayOf, monthLabel } from '../core/la_edit.js';
import {
  weekStart, todayISO, dayLabel, byId, availability, isoToMs, parsedView,
  notifyChanged, formModal, nameRegister, absenceAssignments, goToTab,
} from './rc_util.js';
import { lookaheadSource, EDITOR_SOURCE, writtenView } from './rc_ingest.js';

/**
 * How many weeks the calendar shows. Four is what the look-ahead is kept to,
 * and is where it opens; eight and thirteen are the next month or two and the
 * quarter, because leave is booked further ahead than anybody staffs — and a
 * four-week window only shows a holiday once it is nearly here.
 */
export const PTO_SPANS = [
  { weeks: 2, label: '2 weeks' },
  { weeks: 4, label: '4 weeks' },
  { weeks: 8, label: '8 weeks' },
  { weeks: 13, label: '13 weeks' },
];
/** Wider than this, the day columns narrow so two months fit a screen… */
const DENSE_DAYS = 28;
/** …and wider than this, narrower again, with the date on Mondays only, so a quarter does too. */
const TIGHT_DAYS = 56;

/* What is on screen. Kept while the calendar is open, like the look-ahead's
   own window, and never stored: it is this reader's view, not the record. */
/** Which weeks are on screen: the Monday they start on, in ms. Null means the week containing today. */
let weekOf = null;
let spanWeeks = 4;
/** Only the people with something in the window — a quarter of a team of thirty is a lot of empty rows. */
let onlyAway = false;
/** Which leave the list holds: these weeks, everything from today on, or everything ever booked. */
let listScope = 'upcoming';
let listWho = '';
let listCancelled = false;

const LIST_SCOPES = [
  { id: 'window', label: 'In these weeks' },
  { id: 'upcoming', label: 'From today on' },
  { id: 'all', label: 'Everything' },
];

/**
 * What the 4WLA's PTO and Other Group rows say between two dates.
 *
 * The newest reading covers the week just gone and the four or five ahead, so a
 * longer window reaches past it. Once the look-ahead is written in the
 * calendar, the editor holds every week it was ever written for, and those days
 * are read from it through the publish path (`writtenView()`) — as the
 * look-ahead's own read view pages past its reading, and never by reading the
 * editor's tables some other way. Before then the workbook's reading is all the
 * sheet says, and `covered` is what it covers, so the screen can say that a day
 * past it shows booked leave alone rather than reading as nobody away.
 *
 * @returns {Promise<{ absences: any[], covered: { from: string, to: string } | null, written: boolean }>}
 */
async function sheetAbsences(from, to) {
  const [snapshot, legendRows, source] = await Promise.all([
    rc.latestSnapshot().catch(() => null),
    rc.listLegend().catch(() => []),
    lookaheadSource().catch(() => 'workbook'),
  ]);
  const absences = [];
  let first = null;
  let last = null;
  if (snapshot?.grid) {
    const view = parsedView(snapshot, legendRows);
    const dates = view.days.filter((d) => d.date).map((d) => d.date);
    first = dates[0] || null;
    last = dates[dates.length - 1] || null;
    absences.push(...absencesFrom(view).filter((a) => a.date >= from && a.date <= to));
  }
  if (source !== EDITOR_SOURCE) return { absences, covered: first ? { from: first, to: last } : null, written: false };
  const gaps = !first ? [[from, to]] : [
    [from, to < first ? to : addDaysISO(first, -1)],
    [from > last ? from : addDaysISO(last, 1), to],
  ];
  for (const [a, b] of gaps) {
    if (a > b) continue;
    const view = await writtenView(a, b, legendRows);
    absences.push(...absencesFrom(view).filter((x) => x.date >= a && x.date <= b));
  }
  return { absences, covered: { from, to }, written: true };
}

/** How many of a run of days are the person's working days — what a day of leave costs them. */
function workingDays(person, from, to) {
  const working = Array.isArray(person?.working_days) ? person.working_days : [1, 2, 3, 4, 5];
  let n = 0;
  for (let d = from; d <= to; d = addDaysISO(d, 1)) {
    if (working.includes(new Date(isoToMs(d)).getUTCDay() || 7)) n++;
  }
  return n;
}

export async function render(root) {
  const startMs = weekOf ?? weekStart(todayMs());
  const days = [];
  for (let i = 0; i < spanWeeks * 7; i++) days.push(toISO(addDays(startMs, i)));
  const from = days[0];
  const to = days[days.length - 1];
  const today = todayISO();
  const dense = days.length > DENSE_DAYS;
  const tight = days.length > TIGHT_DAYS;

  /* Everybody active, managers included — see the header comment. Leave is
     read whole: the calendar draws the window, and the list below it can hold
     every record. */
  const [people, kinds, allKinds, allLeave, sheet, aliases] = await Promise.all([
    rc.listPeople(),
    rc.listLeaveKinds().catch(() => []),
    rc.readAll('rc_leave_kinds').catch(() => []),
    rc.readAll('rc_leave', { column: 'start_date' }).catch(() => rc.listLeave(from, to)),
    sheetAbsences(from, to).catch(() => ({ absences: [], covered: null, written: false })),
    rc.listPersonAliases().catch(() => []),
  ]);
  const leave = allLeave.filter((l) => l.start_date <= to && l.end_date >= from && l.status !== 'cancelled');

  const kindsById = byId([...allKinds, ...kinds]);
  const register = nameRegister(people, aliases);
  /* The same register and the same matching rules the Resource row gets: a name
     on the PTO row is the same kind of thing as a name on a Resource row, so
     there is one answer to "who is Victor" and not two that could differ. */
  /* PTO and work somewhere else — never the Office row. A day in the office
     is a day on this project's work, scheduled like any other; drawn here it
     read as somebody lent to another group, and filled the calendar with
     people who were exactly where the look-ahead put them. */
  const away = absenceAssignments((sheet.absences || []).filter((a) => a.kind !== 'office'), register);
  const redraw = () => { clear(root); render(root); };
  const admin = rc.canWrite();

  const host = el('div', { class: 'rc-pto' });
  root.appendChild(host);

  /* ── Which weeks ──────────────────────────────────────────────────────── */

  const jump = el('input', {
    type: 'date', class: 'cx-input mini rc-pto-jump', value: from,
    'aria-label': 'Show the weeks from', title: 'Show the weeks from the Monday of this date',
  });
  jump.addEventListener('change', () => {
    if (!jump.value) return;
    const monday = isoToMs(mondayOf(jump.value));
    weekOf = monday === weekStart(todayMs()) ? null : monday;
    redraw();
  });
  const step = (weeks) => {
    const next = startMs + weeks * 7 * 86400000;
    weekOf = next === weekStart(todayMs()) ? null : next;
    redraw();
  };
  host.appendChild(el('div', { class: 'rc-section-head rc-pto-head' }, [
    el('h3', { text: 'PTO' }),
    el('div', { class: 'la-pager' }, [
      el('button', {
        class: 'cx-btn icon mini ghost', type: 'button', 'aria-label': 'A week earlier', title: 'A week earlier',
        html: icon('chevron-left', { size: 13 }), onClick: () => step(-1),
      }),
      el('button', {
        class: 'cx-btn mini ghost', type: 'button', text: 'This week', disabled: weekOf == null,
        title: 'Start on this week\'s Monday', onClick: () => { weekOf = null; redraw(); },
      }),
      el('button', {
        class: 'cx-btn icon mini ghost', type: 'button', 'aria-label': 'A week later', title: 'A week later',
        html: icon('chevron-right', { size: 13 }), onClick: () => step(1),
      }),
      el('span', { class: 'la-pager-range rc-pto-range', text: `${dayLabel(from, 'medium')} – ${dayLabel(to, 'medium')}` }),
    ]),
    el('div', { class: 'rc-section-actions' }, [
      admin ? el('button', {
        class: 'cx-btn mini primary',
        type: 'button',
        text: 'Book leave',
        onClick: () => bookLeave({ people, kinds, redraw }),
      }) : null,
    ].filter(Boolean)),
  ]));

  /* How many weeks, from when, and whose rows — the reader's choices, said as
     what they are, so a quarter at a glance is two clicks from the default. */
  host.appendChild(el('div', { class: 'rc-pto-options' }, [
    el('div', { class: 'rc-tabs rc-pto-spans', role: 'group', 'aria-label': 'How many weeks' },
      PTO_SPANS.map((s) => el('button', {
        class: 'rc-tab',
        type: 'button',
        text: s.label,
        title: s.weeks === 13 ? 'Thirteen weeks — a quarter' : `${s.weeks} weeks from the Monday shown`,
        'aria-pressed': String(s.weeks === spanWeeks),
        onClick: () => { spanWeeks = s.weeks; redraw(); },
      }))),
    el('label', { class: 'rc-pto-jump-field' }, [el('span', { class: 'rc-hint', text: 'From' }), jump]),
    checkbox({
      label: 'Only people with time off in these weeks',
      checked: onlyAway,
      onChange: (on) => { onlyAway = on; redraw(); },
    }),
  ]));

  if (!people.length) {
    host.appendChild(emptyState({
      iconName: 'users',
      title: 'Nobody on the roster yet',
      message: 'Leave is booked against people on the roster. Being on it never requires an account.',
      action: { label: 'Add people in Lists', onClick: () => goToTab('org') },
    }));
    return;
  }

  /* ── The calendar ─────────────────────────────────────────────────────── */

  const weekend = (iso) => [0, 6].includes(new Date(isoToMs(iso)).getUTCDay());
  const monday = (iso) => new Date(isoToMs(iso)).getUTCDay() === 1;
  const dayClass = (iso, base) => [base, weekend(iso) ? 'rc-pto-weekend' : '', iso === today ? 'rc-pto-today' : '',
    monday(iso) ? 'rc-pto-monday' : ''].filter(Boolean).join(' ');

  /* The month over its days, as the look-ahead heads its columns — thirteen
     weeks of bare dates is a row of numbers nobody can place. */
  const monthCells = [el('th', { class: 'rc-pto-name rc-pto-corner', rowSpan: '2', text: 'Person' })];
  for (let i = 0; i < days.length;) {
    let j = i;
    while (j + 1 < days.length && monthLabel(days[j + 1]) === monthLabel(days[i])) j++;
    const n = j - i + 1;
    monthCells.push(el('th', {
      class: `rc-pto-month${monday(days[i]) || i === 0 ? '' : ' rc-pto-month-mid'}`,
      colSpan: String(n),
      text: n >= 3 ? `${monthLabel(days[i])} ${days[i].slice(0, 4)}` : '',
      title: `${monthLabel(days[i])} ${days[i].slice(0, 4)}`,
    }));
    i = j + 1;
  }
  const headCells = days.map((iso) => el('th', {
    class: dayClass(iso, 'rc-pto-day'),
    // The weekday letter and the date, which is as much as a day column has
    // room for and all anybody reads off it. A quarter's columns are too
    // narrow for every date, so the weeks are dated by their Mondays (and
    // today by itself); every day still says its date when pointed at.
    html: `${'MTWTFSS'[(new Date(isoToMs(iso)).getUTCDay() + 6) % 7]}<br>`
      + (!tight || monday(iso) || iso === today ? iso.slice(8) : '&nbsp;'),
    title: dayLabel(iso, 'medium') + (iso === today ? ' — today' : ''),
  }));

  const body = el('tbody');
  let bookedDays = 0;
  let sheetOnly = 0;
  let shownPeople = 0;

  for (const person of people) {
    const mine = away.byPerson.get(person.id) || new Map();
    /* Each day, what it is — and a key that is the same for the days of one
       stretch, so a fortnight's leave is one bar with its kind written in it
       rather than fourteen squares nobody can count. */
    const said = days.map((iso) => {
      /* A day carries a *list* of what the sheet said — PTO alone, or the
         work rows it names somebody on. Leave is what `availability()` acts
         on; the rest are drawn as what they are. */
      const sheetKinds = mine.get(iso) || [];
      const state = availability(person, iso, leave, sheetKinds.includes('pto') ? 'pto' : null);
      const sheetSays = sheetKinds.includes('pto') ? 'pto' : (sheetKinds[0] || null);
      if (state.leave) return { iso, type: 'booked', key: `b:${state.leave.id}`, booked: state.leave, agreed: sheetSays === 'pto' };
      if (sheetSays === 'pto') return { iso, type: 'sheet', key: 'sheet' };
      if (sheetSays === 'other') return { iso, type: 'elsewhere', key: `e:${sheetKinds.join(',')}`, kinds: sheetKinds };
      return { iso, type: state.state === 'non-working' ? 'off' : 'free', key: null };
    });
    const offDays = said.filter((d) => d.type === 'booked' || d.type === 'sheet').length;
    const elsewhereDays = said.filter((d) => d.type === 'elsewhere').length;
    if (onlyAway && !offDays && !elsewhereDays) continue;
    shownPeople++;

    const cells = [];
    for (let i = 0; i < said.length;) {
      const d = said[i];
      if (!d.key) {
        cells.push(el('td', {
          class: dayClass(d.iso, `rc-pto-cell${d.type === 'off' ? ' rc-pto-off' : ''}`),
          'data-label': dayLabel(d.iso),
        }));
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < said.length && said[j + 1].key === d.key) j++;
      const run = said.slice(i, j + 1);
      const first = run[0].iso;
      const last = run[run.length - 1].iso;
      const when = first === last ? dayLabel(first, 'medium') : `${dayLabel(first, 'medium')} – ${dayLabel(last, 'medium')}`;
      const classes = ['rc-pto-cell', 'rc-pto-run', monday(first) ? 'rc-pto-monday' : ''];
      let label = '';
      let title = '';
      let onClick = null;

      if (d.type === 'booked') {
        bookedDays += run.length;
        classes.push('rc-pto-booked');
        const agreed = run.filter((r) => r.agreed).length;
        if (agreed === run.length) classes.push('rc-pto-agreed');
        label = kindsById.get(d.booked.kind_id)?.name || 'Leave';
        /* The colour says "off"; the title says where that came from. That is
           the whole of what splitting the swatch used to buy, and it costs
           nothing to read it here instead. */
        title = [`${person.name}: ${label}`, 'booked', when,
          d.booked.status !== 'approved' ? d.booked.status : null,
          agreed === run.length ? 'and the 4WLA says so too' : agreed ? `the 4WLA says so on ${agreed} of the days` : 'not on the 4WLA',
          d.booked.note].filter(Boolean).join(' · ');
      } else if (d.type === 'sheet') {
        sheetOnly += run.length;
        classes.push('rc-pto-sheet');
        label = 'PTO';
        /* Nothing booked, and the workbook says they are off. Not an error —
           it is how almost every absence on this project is recorded — so the
           stretch offers to make it a record rather than complaining about it. */
        title = `The 4WLA says ${person.name} is off ${first === last ? 'on' : 'from'} ${when}, and nothing is `
          + 'booked. Everything reads it as leave either way; booking it makes a record that '
          + 'survives the sheet being edited.';
        if (admin) {
          classes.push('rc-clickable');
          onClick = () => bookLeave({ people, kinds, redraw, person, from: first, to: last });
        }
      } else {
        /* Off the project but not off. Drawn so a day the sheet accounted for
           does not read as a blank here, and in a colour of its own rather
           than a shade of the leave one, so the two can never be mistaken:
           these are days somebody worked. */
        classes.push('rc-pto-elsewhere');
        label = 'Other group';
        title = `The 4WLA has ${person.name} ${d.kinds.map((k) => ABSENCE_LABELS[k].toLowerCase()).join(' and ')} `
          + `${first === last ? 'on' : 'from'} ${when}. That is work, not leave.`;
      }
      /* Written in only where it fits whole — never cut short; the title
         carries it either way. */
      const room = run.length * (tight ? 12 : dense ? 18 : 28) - 8;
      const fits = label.length * (dense ? 5.6 : 6.2) <= room;
      cells.push(el('td', {
        class: classes.join(' '),
        colSpan: String(run.length),
        'data-label': when,
        dataset: { from: first, to: last },
        title,
        onClick,
      }, fits ? [el('span', { class: 'rc-pto-run-label', text: label })] : []));
      i = j + 1;
    }

    body.appendChild(el('tr', {}, [
      el('td', { class: 'rc-pto-name' }, [
        el('span', { class: 'rc-pto-person', text: person.name }),
        offDays ? el('span', {
          class: 'rc-pto-count',
          text: `${offDays}d`,
          title: `${offDays} day${offDays === 1 ? '' : 's'} off in these weeks`,
        }) : null,
      ].filter(Boolean)),
      ...cells,
    ]));
  }

  if (!shownPeople) {
    body.appendChild(el('tr', {}, [el('td', {
      class: 'rc-pto-none rc-hint', colSpan: String(days.length + 1),
      text: 'Nobody has time off or other-group work in these weeks. Untick "Only people with time off" to see the whole team.',
    })]));
  }

  host.appendChild(el('div', { class: 'rc-scroll' }, [
    el('table', { class: `rc-table rc-pto-grid${dense ? ' rc-pto-dense' : ''}${tight ? ' rc-pto-tight' : ''}` }, [
      el('thead', {}, [el('tr', {}, monthCells), el('tr', {}, headCells)]),
      body,
    ]),
  ]));

  /* Two swatches, because there are two facts.
     Leave is one colour however it was written down: booked in the application
     and typed into the 4WLA's PTO row are the same day off, and drawing them
     apart made a reader learn three swatches to answer one question. Where it
     came from is still said — in the stretch's title, in the counts below, and
     in whether it can be clicked to book it. */
  host.appendChild(el('div', { class: 'rc-pto-key' }, [
    key('rc-pto-booked', 'PTO — booked or on the 4WLA, its kind written in'),
    key('rc-pto-elsewhere', 'Other group / project — off this project, not off work'),
    key('rc-pto-today', 'Today'),
  ]));

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: `${bookedDays} booked day(s) in these ${spanWeeks} weeks, and ${sheetOnly} the 4WLA says are PTO with `
      + 'nothing booked against them. The second number is not a fault: the 4WLA is where '
      + 'most absences on this project are written down, and everything already reads it as leave. '
      + 'Booking one makes a record that survives the sheet being edited — click the stretch to do it.',
  }));
  /* Past what the sheet covers, the calendar is booked leave alone — said, so
     an empty month reads as the sheet not reaching it, not as nobody away. */
  if (!sheet.written && sheet.covered && (from < sheet.covered.from || to > sheet.covered.to)) {
    host.appendChild(el('p', {
      class: 'rc-hint rc-pto-coverage',
      text: `The 4WLA's newest reading covers ${dayLabel(sheet.covered.from, 'medium')} to `
        + `${dayLabel(sheet.covered.to, 'medium')}; outside those days this shows booked leave only. `
        + 'Once the look-ahead is written in the calendar, its PTO row is read for every week it was written for.',
    }));
  }

  /* ── Names the PTO row uses that the roster cannot place ──────────────── */

  if (away.unmatched.length) {
    host.appendChild(el('div', { style: 'height:20px' }));
    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'Named as away, not on the roster' }),
    ]));
    host.appendChild(el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'As written' }), el('th', { text: 'Days' }), el('th', { text: 'On' }), el('th', { text: 'Who it is' }),
        ])]),
        el('tbody', {}, away.unmatched.map((u) => el('tr', {}, [
          el('td', { text: u.name }),
          el('td', { class: 'rc-num', text: String(u.days.size) }),
          el('td', { class: 'rc-hint', text: [...u.kinds].map((k) => ABSENCE_LABELS[k] || k).join(', ') }),
          el('td', {}, admin ? [spellingPicker(u.name, people, redraw)] : []),
        ]))),
      ]),
    ]));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'These spellings are on the sheet’s PTO and Other Group rows and the roster cannot '
        + 'place them, so those days are not showing against anybody. Say who each is and the spelling '
        + 'is kept as theirs — the same register every name on the look-ahead is read through, so it is '
        + 'settled everywhere at once. Lists → People keeps every spelling.',
    }));
  }

  /* ── The leave booked ─────────────────────────────────────────────────── */

  host.appendChild(el('div', { style: 'height:20px' }));
  host.appendChild(leaveList({
    allLeave, people, kindsById, from, to, today, admin, redraw,
    show: (l) => {
      weekOf = isoToMs(mondayOf(l.start_date)) === weekStart(todayMs()) ? null : isoToMs(mondayOf(l.start_date));
      redraw();
      root.scrollIntoView?.({ block: 'start' });
    },
  }));
}

/**
 * Every leave record, not only the window's: these weeks, everything from
 * today on, or everything ever booked — for one person or everybody, and with
 * the cancelled ones when asked, which makes it the whole record Lists → Leave
 * keeps. Each row says where it stands (booked, under way, taken, cancelled),
 * how many of the person's working days it takes, and can put the calendar on
 * its weeks.
 */
function leaveList({ allLeave, people, kindsById, from, to, today, admin, redraw, show }) {
  const wrap = el('div', { class: 'rc-pto-list' });
  const peopleById = byId(people);
  const counted = (l) => listCancelled || !['cancelled', 'declined', 'requested'].includes(l.status);
  const inScope = (l) => (listScope === 'window' ? l.start_date <= to && l.end_date >= from
    : listScope === 'upcoming' ? l.end_date >= today : true);
  const rows = allLeave
    .filter(counted)
    .filter(inScope)
    .filter((l) => !listWho || l.person_id === listWho)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || String(peopleById.get(a.person_id)?.name || '').localeCompare(String(peopleById.get(b.person_id)?.name || '')));

  const who = selectInput({
    value: listWho,
    options: [{ value: '', label: 'Everybody' }, ...people.map((p) => ({ value: p.id, label: p.name }))],
    onChange: (v) => { listWho = v; redraw(); },
  });
  who.classList.add('rc-pto-list-who');
  who.setAttribute('aria-label', 'Whose leave');
  wrap.appendChild(el('div', { class: 'rc-section-head rc-pto-list-head' }, [
    el('h3', { text: 'Leave booked' }),
    el('div', { class: 'rc-tabs rc-pto-scopes', role: 'group', 'aria-label': 'Which leave' },
      LIST_SCOPES.map((s) => el('button', {
        class: 'rc-tab', type: 'button', text: s.label, 'aria-pressed': String(s.id === listScope),
        onClick: () => { listScope = s.id; redraw(); },
      }))),
    who,
    checkbox({ label: 'Show cancelled', checked: listCancelled, onChange: (on) => { listCancelled = on; redraw(); } }),
  ]));

  const where = listScope === 'window' ? `in ${dayLabel(from, 'medium')} – ${dayLabel(to, 'medium')}`
    : listScope === 'upcoming' ? 'from today on' : 'ever';
  if (!rows.length) {
    wrap.appendChild(el('p', {
      class: 'rc-hint rc-pto-list-empty',
      text: `No leave booked ${where}${listWho ? ` for ${peopleById.get(listWho)?.name || 'them'}` : ''}. `
        + 'Where the 4WLA names somebody on its PTO row the calendar above still shows it, and everything else still reads it as leave.',
    }));
    return wrap;
  }

  const standing = (l) => {
    if (l.status === 'cancelled') return ['Cancelled', 'neutral'];
    if (l.status === 'declined') return ['Declined', 'neutral'];
    if (l.status === 'requested') return ['Not booked', 'pending'];
    if (l.end_date < today) return ['Taken', 'neutral'];
    if (l.start_date <= today) return ['Under way', 'good'];
    return ['Booked', 'info'];
  };
  let total = 0;
  const body = rows.map((l) => {
    const person = peopleById.get(l.person_id);
    const [said, tone] = standing(l);
    const length = workingDays(person, l.start_date, l.end_date);
    if (!['cancelled', 'declined', 'requested'].includes(l.status)) total += length;
    return el('tr', {
      class: `rc-pto-leave-row${l.status === 'cancelled' || l.end_date < today ? ' rc-pto-leave-past' : ''}`,
      dataset: { leave: l.id, start: l.start_date },
    }, [
      el('td', { text: person?.name || '—' }),
      el('td', { text: dayLabel(l.start_date, 'medium') }),
      el('td', { text: dayLabel(l.end_date, 'medium') }),
      el('td', { class: 'rc-num', text: String(length), title: 'Working days, on the person\'s own working week' }),
      el('td', { text: kindsById.get(l.kind_id)?.name || '—' }),
      el('td', {}, [badge(said, tone)]),
      el('td', { class: 'rc-hint', text: l.note || '' }),
      el('td', {}, [el('div', { class: 'cx-btn-row' }, [
        el('button', {
          class: 'cx-btn mini ghost', type: 'button', text: 'Show',
          title: 'Put the calendar on the weeks this leave starts in',
          onClick: () => show(l),
        }),
        admin && !['cancelled', 'declined'].includes(l.status) && l.end_date >= today ? el('button', {
          class: 'cx-btn mini ghost',
          type: 'button',
          text: 'Cancel',
          title: 'It stays on the record as cancelled rather than disappearing.',
          onClick: async () => {
            try {
              await rc.updateLeave(l.id, { status: 'cancelled' });
              notifyChanged('leave');
              toast({ message: 'Cancelled, and kept on the record as cancelled.' });
              redraw();
            } catch (err) {
              toast({ tone: 'bad', message: err?.message || String(err) });
            }
          },
        }) : null,
      ].filter(Boolean))]),
    ]);
  });
  wrap.appendChild(el('div', { class: 'rc-scroll' }, [
    el('table', { class: 'rc-table rc-pto-leave' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Person' }), el('th', { text: 'From' }), el('th', { text: 'To' }), el('th', { text: 'Days' }),
        el('th', { text: 'Kind' }), el('th', { text: 'Where it stands' }), el('th', { text: 'Note' }), el('th', { text: '' }),
      ])]),
      el('tbody', {}, body),
    ]),
  ]));
  wrap.appendChild(el('p', {
    class: 'rc-hint',
    text: `${rows.length} record${rows.length === 1 ? '' : 's'} ${where}, ${total} working day${total === 1 ? '' : 's'} of leave. `
      + (listCancelled
        ? 'With the cancelled ones this is the whole record — the same rows Lists → Leave keeps.'
        : 'Cancelled leave stays on the record; tick "Show cancelled" to list it.'),
  }));
  return wrap;
}

/**
 * "This is Victor": map a spelling the sheet uses to somebody on the roster.
 * Kept as an alias of theirs, so it is matched exactly from then on — never a
 * guess, and settled for every row that writes it.
 */
function spellingPicker(spelling, people, redraw) {
  const pick = selectInput({
    value: '',
    placeholder: 'Who is this?',
    options: people.map((p) => ({ value: p.id, label: p.name })),
    onChange: async (id) => {
      if (!id) return;
      try {
        await rc.addPersonAlias(id, spelling.trim());
        notifyChanged('people');
        toast({ tone: 'good', message: `"${spelling}" is ${people.find((p) => p.id === id)?.name || 'them'} from now on.` });
        redraw();
      } catch (err) {
        toast({ tone: 'bad', message: err?.message || String(err) });
      }
    },
  });
  pick.setAttribute('aria-label', `Who "${spelling}" is`);
  return pick;
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
          + 'that survives somebody editing the sheet, and gives the day a kind.',
      }),
    ]),
    confirmLabel: 'Book',
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
      await rc.addLeave(row);
      notifyChanged('leave');
      toast({ tone: 'good', message: 'Leave booked.' });
      redraw();
    },
  });
}
