/**
 * PTO — asking for time off from a phone, and seeing the answer.
 *
 * The same single `rc_leave` row the desktop's PTO tab writes, never a second
 * list: a request is the row it will become, with `status = 'requested'` saying
 * nobody has answered it yet (`rc.requestLeave()`). The policies are what make
 * that safe — a member may insert `requested` for themselves and nobody else, and
 * the only change they may make afterwards is to withdraw it while it is still
 * unanswered — so this draws what the database allows and nothing more. An
 * administrator's own entry is booked straight away, as the desktop books it.
 *
 * A request is not leave yet. `availability()` carries it as `asked`, so My week
 * shows "Leave requested" on those days without taking them out of the plan;
 * approving it on a computer turns the same row into leave everywhere at once.
 *
 * Imports: util, dates, rc, icons, components, rc_util.
 */

import { el } from '../core/util.js';
import { MS_DAY } from '../core/dates.js';
import * as rc from '../core/rc.js';
import { icon } from '../ui/icons.js';
import { textInput, selectInput, toast, badge, field, confirmDialog } from '../ui/components.js';
import { todayISO, dayLabel, isoToMs, byId, notifyChanged, formModal } from '../ui/rc_util.js';

/** What each answer is called, in the words of somebody waiting for one. */
const ANSWERS = {
  requested: { label: 'Waiting for approval', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  declined: { label: 'Declined', tone: 'bad' },
};

export async function render(root) {
  const me = rc.me();
  const today = todayISO();
  const [rows, kinds, people] = await Promise.all([
    rc.leaveFor(me.id, today),
    rc.listLeaveKinds().catch(() => []),
    rc.listPeople().catch(() => []),
  ]);
  const admin = rc.isAdmin();
  // The roster row, for the working days; `me()` carries the account, not them.
  const self = people.find((p) => p.id === me.id) || me;
  const kindById = byId(kinds);

  if (rc.canWrite()) {
    root.appendChild(el('button', {
      class: 'cx-btn primary m-wide',
      type: 'button',
      html: `${icon('plus', { size: 16 })}<span>Request PTO</span>`,
      onClick: () => requestForm({ self, kinds, admin, existing: rows }),
    }));
    root.appendChild(el('p', {
      class: 'm-note m-under',
      text: admin
        ? 'As an administrator, what you enter here is booked straight away.'
        : 'It goes to an administrator as a request. You can withdraw it until it is answered.',
    }));
  } else {
    root.appendChild(el('p', { class: 'm-note', text: 'Your account can read the calendar but not change it.' }));
  }

  root.appendChild(el('h2', { class: 'm-card-title m-list-title', text: 'Your PTO' }));
  if (!rows.length) {
    root.appendChild(el('p', { class: 'm-empty-day', text: 'Nothing booked or requested from today on.' }));
    return;
  }
  root.appendChild(el('div', { class: 'm-leave-list' },
    rows.map((row) => leaveCard(row, { kindById, self }))));
}

function leaveCard(row, { kindById, self }) {
  const answer = ANSWERS[row.status] || { label: row.status, tone: 'neutral' };
  const days = workingDays(self, row.start_date, row.end_date);
  return el('article', { class: `m-leave m-leave-${row.status}` }, [
    el('div', { class: 'm-leave-head' }, [
      el('div', { class: 'm-task-title', text: span(row.start_date, row.end_date) }),
      badge(answer.label, answer.tone),
    ]),
    el('div', { class: 'm-task-meta' }, [
      el('span', { text: kindById.get(row.kind_id)?.name || 'Time off' }),
      el('span', { text: `${days} working day${days === 1 ? '' : 's'}` }),
    ]),
    row.note ? el('div', { class: 'm-hint', text: row.note }) : null,
    row.status === 'requested' && rc.canWrite()
      ? el('div', { class: 'm-task-acts' }, [
        el('button', {
          class: 'cx-btn ghost danger',
          type: 'button',
          html: `${icon('x', { size: 14 })}<span>Withdraw</span>`,
          'aria-label': `Withdraw the request for ${span(row.start_date, row.end_date)}`,
          onClick: () => withdraw(row),
        }),
      ])
      : null,
  ]);
}

/** "Mon, Oct 12 – Fri, Oct 16, 2026", or the one day. */
function span(from, to) {
  return from === to ? dayLabel(from, 'dayFull') : `${dayLabel(from, 'day')} – ${dayLabel(to, 'dayFull')}`;
}

/** The days in a span somebody would otherwise have worked — what they are asking for. */
function workingDays(person, from, to) {
  const working = Array.isArray(person?.working_days) ? person.working_days : [1, 2, 3, 4, 5];
  let n = 0;
  for (let ms = isoToMs(from); ms <= isoToMs(to); ms += MS_DAY) {
    if (working.includes(new Date(ms).getUTCDay() || 7)) n++;
  }
  return n;
}

function requestForm({ self, kinds, admin, existing }) {
  const today = todayISO();
  const start = el('input', { type: 'date', class: 'cx-input' });
  const end = el('input', { type: 'date', class: 'cx-input' });
  start.value = today;
  end.value = today;
  // Moving the start past the end drags the end with it: the commonest request
  // is one day, and the second commonest is a run starting where it was set.
  start.addEventListener('change', () => {
    if (!end.value || end.value < start.value) end.value = start.value;
  });
  const kind = selectInput({
    value: kinds[0]?.id || '',
    options: kinds.map((k) => ({ value: k.id, label: k.name })),
  });
  const note = textInput({ placeholder: 'Optional' });

  formModal({
    title: admin ? 'Book PTO' : 'Request PTO',
    body: el('div', { class: 'cx-form m-form' }, [
      field('From', start),
      field('To', end, 'The last day you are off.'),
      kinds.length ? field('Kind', kind) : null,
      field('Note', note),
    ].filter(Boolean)),
    confirmLabel: admin ? 'Book it' : 'Send request',
    onConfirm: async () => {
      if (!start.value || !end.value) throw new Error('Both dates are needed.');
      if (end.value < start.value) throw new Error('The last day is before the first.');
      if (!workingDays(self, start.value, end.value)) {
        throw new Error('None of those days is one you work, so there is nothing to take off.');
      }
      /* A second request over days already asked for or booked is the same
         question twice, and whoever answers it would have to notice. */
      const clash = existing.find((r) => r.status !== 'declined'
        && r.start_date <= end.value && r.end_date >= start.value);
      if (clash) {
        throw new Error(`You already have PTO over those days: ${span(clash.start_date, clash.end_date)}.`);
      }
      const row = {
        person_id: self.id,
        start_date: start.value,
        end_date: end.value,
        kind_id: kind.value || null,
        note: note.value.trim() || null,
      };
      if (admin) await rc.addLeave({ ...row, status: 'approved' });
      else await rc.requestLeave(row);
      notifyChanged('leave');
      toast({
        tone: 'good',
        message: admin ? 'Booked.' : 'Sent. It shows as waiting until an administrator answers it.',
      });
    },
  });
}

async function withdraw(row) {
  const ok = await confirmDialog({
    title: 'Withdraw this request?',
    message: `${span(row.start_date, row.end_date)}. Nobody has answered it yet, so it simply comes off `
      + 'the list — you can ask again later.',
    confirmLabel: 'Withdraw',
    danger: true,
  });
  if (!ok) return;
  try {
    await rc.updateLeave(row.id, { status: 'cancelled' });
    notifyChanged('leave');
    toast({ tone: 'good', message: 'Withdrawn.' });
  } catch (err) {
    toast({ tone: 'bad', message: err?.message || String(err) });
  }
}
