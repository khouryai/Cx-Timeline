/**
 * One activity, whole — what opens when somebody taps a task.
 *
 * My day says "IXL Regression Testing, W40, day shift, with Rosa". That is the
 * day; this is the work: every column of the activity's line under the sheet's
 * own headings (Activity ID, Location, SSWP#, Party to Action, Work Hours),
 * and every day from this week on that it carries anything — which shift the
 * paint means, whether it was cancelled, what is written in the cell, and who
 * the names row puts on it, with your own days marked.
 *
 * Read off the latest reading of the look-ahead, the same one the calendar
 * draws. A task is found on it by its row where it can be (the reading and
 * the sheet row it was recorded against) and by the row's exact words where
 * it cannot; one that is no longer on the sheet says so rather than showing
 * something else.
 *
 * Why a day was cancelled is claim evidence and is only readable by an
 * administrator (`rc_cancellation_notes`), so the team sees that it was, and
 * an administrator sees who and why too.
 *
 * Imports: util, rc, core/lookahead, icons, components, rc_util, rc_la_state.
 */

import { el } from '../core/util.js';
import * as rc from '../core/rc.js';
import { activityTitle, activityDays } from '../core/lookahead.js';
import { openModal, badge, emptyState } from './components.js';
import { parsedView, dayLabel, todayISO, weekStart, isoToMs, goToTab, meMatcher } from './rc_util.js';
import { toISO } from '../core/dates.js';
import { la } from './rc_la_state.js';

/** The label a stored look-ahead row carries for an activity: its columns, joined. */
const labelOf = (activity) => (activity?.meta || []).filter(Boolean).join(' · ');

/**
 * Open an activity.
 *
 * `row` is an `rc_lookahead_rows` row (or anything with `raw_label`, and
 * `snapshot_id` / `sheet_row` where known). `task` is the fallback wording.
 */
export async function openActivity({ row = null, task = '' } = {}) {
  const [snapshot, legendRows, isMe, notes] = await Promise.all([
    rc.latestSnapshot().catch(() => null),
    rc.listLegend().catch(() => []),
    meMatcher().catch(() => null),
    rc.isAdmin() ? rc.listCancellationNotes().catch(() => []) : Promise.resolve([]),
  ]);
  const label = row?.raw_label || task || '';

  if (!snapshot?.grid?.rows?.length) {
    return openModal({
      title: label || 'Activity',
      body: emptyState({ iconName: 'calendar', title: 'No look-ahead to read', message: 'The look-ahead has not been published yet.' }),
      actions: [{ label: 'Close' }],
    });
  }

  const view = parsedView(snapshot, legendRows);
  /* By its row in this reading where the task was recorded against it — and
     only when that row still says the same thing, so a row number that no
     longer lines up can never open somebody else's activity — then by the
     row's exact words. */
  const byRow = row?.snapshot_id === snapshot.id && row?.sheet_row != null
    ? view.activities.find((a) => a.row === row.sheet_row && !a.heading && !a.absence)
    : null;
  const activity = (byRow && (!label || labelOf(byRow) === label) ? byRow : null)
    || view.activities.find((a) => !a.heading && !a.absence && labelOf(a) === label);

  if (!activity) {
    return openModal({
      title: label || 'Activity',
      body: emptyState({
        iconName: 'calendar',
        title: 'No longer on the look-ahead',
        message: 'This activity is not on the latest reading of the look-ahead. It may have been reworded, finished or removed — the Look-ahead tab has the sheet as it stands.',
      }),
      actions: [{ label: 'Close' }],
    });
  }

  const title = activityTitle(view, activity);
  const from = toISO(weekStart(isoToMs(todayISO())));
  const days = activityDays(view, activity, { fromISO: from, isMe: isMe || (() => false) });
  const today = todayISO();

  /* The columns, under the sheet's own headings. */
  const facts = el('dl', { class: 'rc-activity-facts' });
  activity.meta.forEach((value, i) => {
    if (!value) return;
    const heading = String(view.headings?.[i] || '').trim() || `Column ${i + 1}`;
    facts.append(el('dt', { text: heading }), el('dd', { text: value }));
  });

  /* Why, for the days an administrator has explained. */
  const current = notes.filter((n) => !notes.some((m) => m.supersedes_id === n.id));
  const why = (iso) => current.filter((n) => n.raw_label === labelOf(activity) && iso
    && String(n.start_date).slice(0, 10) <= iso && String(n.end_date).slice(0, 10) >= iso)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;

  const list = el('ol', { class: 'rc-activity-days', 'aria-label': 'Days on this activity' });
  for (const d of days) {
    const note = d.cancelled ? why(d.date) : null;
    list.appendChild(el('li', {
      class: `rc-activity-day${d.mine ? ' rc-activity-mine' : ''}${d.cancelled ? ' rc-activity-cancelled' : ''}${d.date === today ? ' rc-activity-today' : ''}`,
      'aria-current': d.date === today ? 'date' : null,
    }, [
      el('span', { class: 'rc-activity-when', text: d.date ? dayLabel(d.date, 'day') : d.label }),
      el('span', { class: 'rc-activity-shift' }, [
        d.hex ? el('span', { class: 'rc-activity-swatch', style: `background-color:#${d.hex}`, 'aria-hidden': 'true' }) : null,
        el('span', { text: d.cancelled ? 'Cancelled' : (d.meaning || (d.hex ? 'Unexplained colour' : 'Not painted')) }),
      ].filter(Boolean)),
      el('span', { class: 'rc-activity-who' }, [
        d.names.length
          ? el('span', { text: d.names.join(', ') })
          : el('span', { class: 'rc-hint', text: 'Nobody named' }),
        d.mine ? badge('You', 'info') : null,
      ].filter(Boolean)),
      d.text ? el('span', { class: 'rc-activity-text', title: 'Written in the cell', text: d.text }) : null,
      note
        ? el('span', { class: 'rc-activity-why', text: `${note.party}${note.reason ? ` — ${note.reason}` : ''}` })
        : null,
    ].filter(Boolean)));
  }

  const mineCount = days.filter((d) => d.mine).length;
  const body = el('div', { class: 'rc-activity' }, [
    facts,
    el('div', { class: 'rc-activity-sub' }, [
      el('h4', { text: 'From this week on' }),
      el('span', {
        class: 'rc-hint',
        text: days.length
          ? `${days.length} day${days.length === 1 ? '' : 's'}${mineCount ? ` · you are on ${mineCount}` : ''}`
          : '',
      }),
    ]),
    days.length
      ? list
      : el('p', { class: 'rc-hint', text: 'Nothing on this activity from this week on.' }),
  ]);

  return openModal({
    title: title || label || 'Activity',
    subtitle: `As the look-ahead reads now — ${dayLabel(String(snapshot.taken_at).slice(0, 10), 'day')}`,
    size: 'wide',
    body,
    actions: [
      {
        label: 'Show on the look-ahead',
        onClick: () => {
          la.calendarFilter = title;
          la.onlyMine = false;
          la.section = 'calendar';
          la.sectionChosen = true;
          goToTab('lookahead');
        },
      },
      { label: 'Close', kind: 'primary' },
    ],
  });
}
