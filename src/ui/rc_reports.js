/**
 * Reports.
 *
 * Every record carries its own date, person, category and location, so a report
 * is a filter and an aggregation and nothing more. Arbitrary date ranges rather
 * than fixed monthly buckets — "back one year from today" has to be as easy as
 * "this month", which is what the relational store bought.
 *
 * Two things are deliberate and neither is a detail.
 *
 * **Nothing here is stored.** No efficiency column, no cached rollup. Every
 * number is computed on the way out, so refining a definition never means a
 * migration and no figure can go stale against the rows it came from.
 *
 * **Performance and programme health are never averaged together.** Completed,
 * partial and carried are what somebody did; blocked and reassigned are what
 * was done to them. A possession released late is not underperformance, and
 * folding it in would make the number worse than useless — people would simply
 * stop saying they were blocked.
 *
 * Imports: util, rc, icons, components, rc_util.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import { toast, badge, chipStat, emptyState, selectInput } from './components.js';
import { byId, dayLabel, todayISO, isoToMs, STATUS_BY_ID } from './rc_util.js';
import { saveFile } from '../io/exporters.js';

/** Ranges people actually ask for, plus the one that matters most: any. */
const RANGES = [
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last quarter', days: 90 },
  { id: '365', label: 'Last year', days: 365 },
  { id: 'custom', label: 'Custom…', days: 0 },
];

let range = '30';
let customFrom = '';
let customTo = '';
let groupBy = 'person';

function window_() {
  const to = customTo || todayISO();
  if (range === 'custom' && customFrom) return { from: customFrom, to };
  const days = RANGES.find((r) => r.id === range)?.days || 30;
  const fromMs = isoToMs(todayISO()) - days * 86400000;
  return { from: new Date(fromMs).toISOString().slice(0, 10), to };
}

export async function render(root) {
  if (!rc.isAdmin()) {
    // Not a hidden menu item: the view itself returns nothing to a member,
    // enforced by the policy. This only explains why.
    root.appendChild(emptyState({
      iconName: 'lock',
      title: 'Administrators only',
      message: 'Reports are restricted in the database. A member reading the view directly '
        + 'gets nothing back, so this is an explanation rather than the control.',
    }));
    return;
  }

  const { from, to } = window_();
  const [effort, people, categories, locations, chains, events] = await Promise.all([
    rc.listEffort(from, to),
    rc.listPeople({ includeInactive: true }),
    rc.listCategories({ includeInactive: true }),
    rc.listLocations({ includeInactive: true }),
    rc.listCarryChains(),
    rc.listChangeEvents(`${from}T00:00:00Z`, `${to}T23:59:59Z`),
  ]);

  root.appendChild(controls(root, from, to));

  if (!effort.length) {
    root.appendChild(el('p', { class: 'rc-hint', text: 'Nothing recorded in that range.' }));
  } else {
    root.appendChild(summary(effort));
    root.appendChild(breakdown(effort, people, categories, locations));
  }

  root.appendChild(carryOver(chains, people));
  root.appendChild(lookaheadNumbers(events));

  root.appendChild(el('p', {
    class: 'rc-hint',
    text: 'The two families are reported apart on purpose. Completed, partial and carried are '
      + 'what somebody did; blocked and reassigned are what was done to them. Averaging them '
      + 'together would flatter or damn the wrong party — and would teach people not to say '
      + 'when they were blocked.',
  }));
}

function controls(root, from, to) {
  const picker = selectInput({
    value: range,
    options: RANGES.map((r) => ({ value: r.id, label: r.label })),
    onChange: (v) => { range = v; clear(root); render(root); },
  });

  const grouping = selectInput({
    value: groupBy,
    options: [
      { value: 'person', label: 'By person' },
      { value: 'category', label: 'By category' },
      { value: 'location', label: 'By location' },
      { value: 'subsystem', label: 'By subsystem' },
    ],
    onChange: (v) => { groupBy = v; clear(root); render(root); },
  });

  const head = el('div', { class: 'rc-section-head' }, [
    el('h3', { text: `${dayLabel(from)} – ${dayLabel(to)}` }),
    picker,
    grouping,
    el('button', {
      class: 'cx-btn mini ghost',
      html: icon('download', { size: 12 }) + '<span>CSV</span>',
      onClick: () => exportCsv(from, to),
    }),
  ]);

  if (range === 'custom') {
    const fromEl = el('input', { type: 'date', class: 'cx-input mini', value: customFrom || from });
    const toEl = el('input', { type: 'date', class: 'cx-input mini', value: customTo || to });
    const apply = () => {
      customFrom = fromEl.value;
      customTo = toEl.value;
      clear(root);
      render(root);
    };
    fromEl.addEventListener('change', apply);
    toEl.addEventListener('change', apply);
    head.append(fromEl, toEl);
  }
  return head;
}

/* ── The numbers ───────────────────────────────────────────────────────── */

function summary(effort) {
  const performance = effort.filter((e) => e.signal === 'performance');
  const health = effort.filter((e) => e.signal === 'health');
  const done = performance.filter((e) => e.status === 'completed').length;

  // A rate over the performance family only. Including blocked days would make
  // a team look worse for a possession somebody else lost.
  const rate = performance.length ? Math.round((done / performance.length) * 100) : 0;

  return el('div', { class: 'rc-section', style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
    chipStat('Completed', `${rate}%`, rate >= 70 ? 'good' : rate >= 40 ? 'warn' : 'bad'),
    chipStat('Days recorded', performance.length, 'muted'),
    chipStat('Blocked', health.filter((e) => e.status === 'blocked').length, 'bad'),
    chipStat('Reassigned', health.filter((e) => e.status === 'reassigned').length, 'info'),
  ]);
}

function breakdown(effort, people, categories, locations) {
  const peopleById = byId(people);
  const catsById = byId(categories);
  const locsById = byId(locations);

  const keyOf = (row) => {
    if (groupBy === 'person') return peopleById.get(row.person_id)?.name || row.person_name || '—';
    if (groupBy === 'category') return catsById.get(row.category_id)?.name || 'Uncategorised';
    if (groupBy === 'location') return locsById.get(row.location_id)?.name || 'No location';
    return row.subsystem || '—';
  };

  const groups = new Map();
  for (const row of effort) {
    const key = keyOf(row);
    const g = groups.get(key) || { key, completed: 0, partial: 0, carried: 0, blocked: 0, reassigned: 0, total: 0 };
    if (g[row.status] !== undefined) g[row.status]++;
    if (row.signal === 'performance') g.total++;
    groups.set(key, g);
  }

  const rows = [...groups.values()]
    .sort((a, b) => b.total - a.total)
    .map((g) => el('tr', {}, [
      el('td', { text: g.key }),
      el('td', { class: 'rc-num', text: String(g.completed) }),
      el('td', { class: 'rc-num', text: String(g.partial) }),
      el('td', { class: 'rc-num', text: String(g.carried) }),
      el('td', { class: 'rc-num', text: g.total ? `${Math.round((g.completed / g.total) * 100)}%` : '—' }),
      el('td', { class: 'rc-num', text: String(g.blocked) }),
      el('td', { class: 'rc-num', text: String(g.reassigned) }),
    ]));

  return el('div', { class: 'rc-section' }, [
    el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: groupBy[0].toUpperCase() + groupBy.slice(1) }),
            el('th', { text: 'Done' }), el('th', { text: 'Partial' }), el('th', { text: 'Carried' }),
            el('th', { text: 'Rate' }),
            el('th', { text: 'Blocked' }), el('th', { text: 'Reassigned' }),
          ]),
        ]),
        el('tbody', {}, rows),
      ]),
    ]),
  ]);
}

/**
 * Carried tasks, oldest first.
 *
 * The count is not the story — the *age* is. A chain counts once however many
 * days it ran, so one stuck job cannot produce five marks against one person,
 * and a task on its fifth day is the most informative line in the report.
 */
function carryOver(chains, people) {
  const peopleById = byId(people);
  const section = el('div', { class: 'rc-section' }, [
    el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Still carrying' })]),
  ]);

  if (!chains.length) {
    section.appendChild(el('p', { class: 'rc-hint', text: 'Nothing carried over.' }));
    return section;
  }

  section.appendChild(el('div', { class: 'rc-scroll' }, [
    el('table', { class: 'rc-table' }, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Person' }), el('th', { text: 'First seen' }),
        el('th', { text: 'Days old' }), el('th', { text: 'Times carried' }),
      ])]),
      el('tbody', {}, chains.map((c) => el('tr', {}, [
        el('td', { text: peopleById.get(c.person_id)?.name || '—' }),
        el('td', { text: c.first_seen ? dayLabel(c.first_seen) : '—' }),
        el('td', {}, [badge(String(c.age_days), c.age_days >= 5 ? 'bad' : c.age_days >= 3 ? 'warn' : 'muted')]),
        el('td', { class: 'rc-num', text: String(c.carries) }),
      ]))),
    ]),
  ]));
  section.appendChild(el('p', {
    class: 'rc-hint',
    text: 'One chain per stuck task, however many days it ran — five days of the same job is one '
      + 'problem, not five failures. Ranked by age, which is the number worth acting on.',
  }));
  return section;
}

/**
 * The look-ahead's own numbers, kept apart from the team's.
 *
 * One measures BART's behaviour and one measures this team's. Reporting them
 * in one figure would attribute somebody else's cancellations to the people
 * who turned up for them.
 */
function lookaheadNumbers(events) {
  const count = (kind) => events.filter((e) => e.kind === kind).length;
  return el('div', { class: 'rc-section' }, [
    el('div', { class: 'rc-section-head' }, [el('h3', { text: 'The look-ahead, same range' })]),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      chipStat('Scope added', count('scope_added'), 'info'),
      chipStat('Scope removed', count('scope_removed'), 'warn'),
      chipStat('Cancelled', count('cancellation'), 'bad'),
      chipStat('Resources changed', count('resource_changed'), 'muted'),
    ]),
    el('p', {
      class: 'rc-hint',
      text: 'Weeks entering and leaving the four-week window are excluded — they are the window '
        + 'rolling forward, not scope moving, and counting them would add a batch of phantom '
        + 'changes every single week.',
    }),
  ]);
}

/* ── Export ────────────────────────────────────────────────────────────── */

/**
 * The range, as CSV.
 *
 * Through `saveFile()` like every other export in the application, so the
 * download announces itself — a file that lands somewhere the page cannot see
 * is the one action with no visible result.
 */
async function exportCsv(from, to) {
  try {
    const [effort, people, categories, locations] = await Promise.all([
      rc.listEffort(from, to),
      rc.listPeople({ includeInactive: true }),
      rc.listCategories({ includeInactive: true }),
      rc.listLocations({ includeInactive: true }),
    ]);
    const peopleById = byId(people);
    const catsById = byId(categories);
    const locsById = byId(locations);

    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Date', 'Person', 'Subsystem', 'Status', 'Signal', 'Category', 'Location'];
    const lines = [header.join(',')];
    for (const row of effort) {
      lines.push([
        row.work_date,
        peopleById.get(row.person_id)?.name || row.person_name || '',
        row.subsystem || '',
        STATUS_BY_ID.get(row.status)?.label || row.status,
        row.signal,
        catsById.get(row.category_id)?.name || '',
        locsById.get(row.location_id)?.name || '',
      ].map(esc).join(','));
    }

    saveFile(
      `resource-calendar-${from}-to-${to}.csv`,
      lines.join('\n'),
      'text/csv;charset=utf-8',
      `${effort.length} record(s)`
    );
  } catch (err) {
    toast({ tone: 'error', message: err.message });
  }
}
