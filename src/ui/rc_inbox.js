/**
 * The administrator's inbox — everything waiting on an administrator, in one
 * list.
 *
 * None of it is new information. Leave requests are in PTO, names the roster
 * cannot place are in the week plan, unmapped colours in Legend, cancellations
 * without a reason in the log, unowned blockers in the huddle, unanswered
 * invitations in Accounts. Five screens, each of which somebody had to think to
 * open. This reads the same sources and lists what is outstanding, each item a
 * press from the screen that answers it — and a leave request is answered
 * right here, because that is one button either way.
 *
 * Every source is read on its own and a failed read is reported as a line of
 * its own, never as an empty inbox: "nothing is waiting" and "I could not
 * look" are different answers, and only one of them lets somebody stop
 * worrying.
 *
 * Reads only, apart from answering leave. What an administrator may do is
 * still decided in Postgres; this is where they are told there is something
 * to do.
 *
 * Imports: util, rc, core/lookahead, core/la_edit, icons, components, rc_util,
 *          rc_la_state.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import { cancellationEvents, attachCancellationNotes, changesForMe } from '../core/lookahead.js';
import * as ed from '../core/la_edit.js';
import { icon } from './icons.js';
import { toast, badge, emptyState } from './components.js';
import {
  notifyChanged, goToTab, dayLabel, todayISO, orgNav, nameRegister, resourceAssignments,
  absenceAssignments, lookaheadWithResources, locationRegister, unmatchedLocations, personMatcher,
} from './rc_util.js';
import { la } from './rc_la_state.js';

/* ── Where each item is answered ───────────────────────────────────────── */

function openOrg(section) {
  orgNav.section = section;
  goToTab('org');
}

function openLookahead(section) {
  la.section = section;
  la.sectionChosen = true;
  goToTab('lookahead');
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ── Reading ───────────────────────────────────────────────────────────── */

/**
 * What is waiting, as `[{ id, area, tone, title, detail, actions }]` — each
 * action `{ label, run, primary? }`. Grouped where one answer settles many
 * (every unplaceable name is one visit to the week plan), itemised where each
 * is its own decision (every leave request).
 */
export async function inboxItems() {
  const today = todayISO();
  const monday = ed.mondayOf(today);
  const horizon = ed.addDaysISO(monday, 5 * 7 - 1);
  const items = [];
  const failed = [];
  const attempt = async (area, fn) => {
    try {
      await fn();
    } catch (err) {
      failed.push({ area, message: err?.message || String(err) });
    }
  };

  const [people, kinds] = await Promise.all([
    rc.listPeople({ includeInactive: true }).catch(() => []),
    rc.listLeaveKinds().catch(() => []),
  ]);
  const personName = (id) => people.find((p) => p.id === id)?.name || 'Somebody';
  const kindName = (id) => kinds.find((k) => k.id === id)?.name || 'leave';

  await Promise.all([
    /* Leave asked for. Each one is a decision, so each one is an item. */
    attempt('Leave requests', async () => {
      for (const l of await rc.pendingLeave()) {
        const span = l.start_date === l.end_date
          ? dayLabel(l.start_date)
          : `${dayLabel(l.start_date)} – ${dayLabel(l.end_date)}`;
        items.push({
          id: `leave:${l.id}`,
          area: 'Leave',
          tone: 'warn',
          title: `${personName(l.person_id)} asked for ${kindName(l.kind_id)}`,
          detail: [span, l.note].filter(Boolean).join(' · '),
          actions: [
            { label: 'Approve', primary: true, run: () => answerLeave(l, 'approved') },
            { label: 'Decline', run: () => answerLeave(l, 'declined') },
          ],
        });
      }
    }),

    /* Names and places on the look-ahead the registers cannot place. */
    attempt('Names and locations', async () => {
      const [aliases, locations, locAliases, sheet] = await Promise.all([
        rc.listPersonAliases().catch(() => []),
        rc.listLocations({ includeInactive: true }).catch(() => []),
        rc.listLocationAliases().catch(() => []),
        lookaheadWithResources(monday, horizon),
      ]);
      const register = nameRegister(people, aliases);
      const names = [
        ...resourceAssignments(sheet.rows, register).unmatched,
        ...absenceAssignments(sheet.absences, register).unmatched,
      ];
      const unique = [...new Map(names.map((n) => [n.name.toLowerCase(), n])).values()];
      if (unique.length) {
        items.push({
          id: 'names',
          area: 'Look-ahead',
          tone: 'warn',
          title: `${plural(unique.length, 'name')} on the look-ahead ${unique.length === 1 ? 'matches' : 'match'} nobody on the roster`,
          detail: unique.slice(0, 8).map((n) => `"${n.name}"`).join(', ') + (unique.length > 8 ? ` and ${unique.length - 8} more` : '')
            + ' — say who each one is once, and it is settled.',
          actions: [{ label: 'Answer in Week plan', primary: true, run: () => goToTab('week') }],
        });
      }
      const places = unmatchedLocations(sheet.rows, locationRegister(locations, locAliases));
      if (places.length) {
        items.push({
          id: 'locations',
          area: 'Look-ahead',
          tone: 'info',
          title: `${plural(places.length, 'location')} on the look-ahead ${places.length === 1 ? 'is' : 'are'} not on the register`,
          detail: places.slice(0, 8).map((p) => `"${p.name}"`).join(', ') + ' — add each as a location, or as another spelling of one.',
          actions: [{ label: 'Open Locations', primary: true, run: () => openOrg('locations') }],
        });
      }
    }),

    /* Colours on the sheet the legend does not explain. */
    attempt('Legend', async () => {
      const [meta] = await rc.listSnapshotMeta({ limit: 1 });
      const n = Number(meta?.unmapped_count || 0);
      if (n) {
        items.push({
          id: 'colours',
          area: 'Look-ahead',
          tone: 'warn',
          title: `${plural(n, 'colour')} on the look-ahead ${n === 1 ? 'means' : 'mean'} nothing yet`,
          detail: 'Until the legend says what it is, a painted day in that colour is drawn as possible work and counted as nothing.',
          actions: [{ label: 'Open Legend', primary: true, run: () => openLookahead('legend') }],
        });
      }
    }),

    /* Support codes typed that nobody registered — the editor's own sheet. */
    attempt('Support codes', async () => {
      const settings = await rc.listSettings().catch(() => []);
      if (settings.find((r) => r.key === 'lookahead_source')?.value !== 'editor') return;
      const [rows, cells, codes] = await Promise.all([
        rc.listLaRows(),
        rc.listLaCells(monday, horizon),
        rc.listSupportCodes({ includeRetired: true }),
      ]);
      const activities = new Set(rows.filter((r) => r.kind === 'activity' && !r.archived).map((r) => r.id));
      const unknown = new Set();
      for (const c of cells) {
        if (!activities.has(c.row_id) || !c.text) continue;
        if (!/^[A-Za-z0-9]{1,8}(\.[A-Za-z0-9]{1,8})*$/.test(String(c.text).trim())) continue;
        for (const u of ed.parseSupport(c.text, codes).unknown) unknown.add(u);
      }
      if (unknown.size) {
        items.push({
          id: 'codes',
          area: 'Look-ahead',
          tone: 'info',
          title: `${plural(unknown.size, 'support code')} on the look-ahead ${unknown.size === 1 ? 'is' : 'are'} not registered`,
          detail: `${[...unknown].join(', ')} — kept exactly as typed, and marked in the editor until somebody says what ${unknown.size === 1 ? 'it asks' : 'they ask'} for.`,
          actions: [{ label: 'Open Legend', primary: true, run: () => openLookahead('legend') }],
        });
      }
    }),

    /* Cancellations nobody has said anything about. */
    attempt('Cancellations', async () => {
      const settings = await rc.listSettings().catch(() => []);
      const from = settings.find((x) => x.key === 'cancellation_log_from')?.value || `${today.slice(0, 4)}-09-01`;
      const [days, notes] = await Promise.all([rc.listCancelledDays(from), rc.listCancellationNotes().catch(() => [])]);
      const open = attachCancellationNotes(cancellationEvents(days, { from }), notes).filter((e) => !e.note);
      if (open.length) {
        items.push({
          id: 'cancellations',
          area: 'Look-ahead',
          tone: 'bad',
          title: `${plural(open.length, 'cancellation')} with no reason yet`,
          detail: open.slice(0, 4).map((e) => `${e.label || 'An activity'} (${dayLabel(e.start)})`).join('; ')
            + (open.length > 4 ? `; and ${open.length - 4} more` : '')
            + ' — the log is the claim, and a cancellation with no party is one nobody can argue.',
          actions: [{ label: 'Open the log', primary: true, run: () => openLookahead('cancellations') }],
        });
      }
    }),

    /* Blocked days nobody has taken on. */
    attempt('Blockers', async () => {
      const blockers = (await rc.listBlockers()).filter((b) => !b.owner_id);
      for (const b of blockers.slice(0, 10)) {
        items.push({
          id: `blocker:${b.id}`,
          area: 'Huddle',
          tone: 'bad',
          title: `Blocked, and nobody owns it: ${b.summary || 'no summary'}`,
          detail: `Raised by ${personName(b.person_id)} ${b.age_days != null ? `${plural(Number(b.age_days), 'day')} ago` : ''}`.trim(),
          actions: [{ label: 'Open the huddle', primary: true, run: () => goToTab('huddle') }],
        });
      }
    }),

    /* Invitations sent and not yet taken up. */
    attempt('Invitations', async () => {
      const pending = await rc.listInvitations();
      const expired = pending.filter((i) => i.pending_expired);
      const waiting = pending.filter((i) => !i.pending_expired);
      if (expired.length) {
        items.push({
          id: 'invites:expired',
          area: 'Accounts',
          tone: 'warn',
          title: `${plural(expired.length, 'invitation')} expired before ${expired.length === 1 ? 'it was' : 'they were'} used`,
          detail: expired.map((i) => i.pending_email).join(', '),
          actions: [{ label: 'Open Accounts', primary: true, run: () => openOrg('accounts') }],
        });
      }
      if (waiting.length) {
        items.push({
          id: 'invites:waiting',
          area: 'Accounts',
          tone: 'info',
          title: `${plural(waiting.length, 'invitation')} not accepted yet`,
          detail: waiting.map((i) => i.pending_email).join(', '),
          actions: [{ label: 'Open Accounts', run: () => openOrg('accounts') }],
        });
      }
    }),

    /* Changes to somebody's days they have not seen yet. My day shows each
       person what changed for them since their last "Got it"; this is the
       other side of it — who has not looked. Only people with an account can
       look, and an administrator is the one making the changes. */
    attempt('Changes to people\'s days', async () => {
      const [latest] = await rc.listSnapshotMeta({ limit: 1 });
      if (!latest) return;
      const [seenRows, aliases] = await Promise.all([rc.listSeen(), rc.listPersonAliases().catch(() => [])]);
      const team = people.filter((p) => p.active && p.user_id && p.role !== 'admin');
      if (!team.length) return;
      const newest = new Map();
      for (const row of seenRows) {
        const held = newest.get(row.person_id);
        if (!held || String(row.seen_at) > String(held.seen_at)) newest.set(row.person_id, row);
      }
      const register = nameRegister(people, aliases);
      const rowsOf = new Map();
      const rowsFor = async (id) => {
        if (!rowsOf.has(id)) rowsOf.set(id, await rc.snapshotRows(id));
        return rowsOf.get(id);
      };
      const after = await rowsFor(latest.id);
      const to = ed.addDaysISO(today, 27);
      const behind = [];
      const never = [];
      for (const p of team) {
        const seen = newest.get(p.id);
        if (!seen) { never.push(p.name); continue; }
        if (!seen.snapshot_id || seen.snapshot_id === latest.id) continue;
        const before = await rowsFor(seen.snapshot_id);
        if (!before.length) continue;
        const n = changesForMe(before, after, personMatcher(register, p.id), { from: today, to }).length;
        if (n) behind.push({ name: p.name, n });
      }
      if (behind.length) {
        items.push({
          id: 'unseen',
          area: 'Team',
          tone: 'warn',
          title: `${plural(behind.length, 'person has', 'people have')} changes to their days they have not seen`,
          detail: behind.map((b) => `${b.name} (${b.n})`).join(', ')
            + ' — they see them at the top of My day, with Got it.',
          actions: [],
        });
      }
      if (never.length) {
        items.push({
          id: 'unseen:never',
          area: 'Team',
          tone: 'info',
          title: `${plural(never.length, 'person has', 'people have')} not opened My day yet`,
          detail: never.join(', '),
          actions: [],
        });
      }
    }),

    /* Something broke on somebody's screen in the last week. */
    attempt('Problems', async () => {
      const since = Date.now() - 7 * 86400000;
      const recent = (await rc.listClientErrors(50)).filter((e) => Date.parse(e.created_at) >= since);
      if (recent.length) {
        items.push({
          id: 'problems',
          area: 'Problems',
          tone: 'info',
          title: `${plural(recent.length, 'problem')} reported this week`,
          detail: [...new Set(recent.map((e) => e.area))].slice(0, 5).join(', '),
          actions: [{ label: 'Open Problems', run: () => openOrg('problems') }],
        });
      }
    }),

    /* The database older than the application. */
    attempt('Database', async () => {
      const { state, expected, found } = await rc.schemaStatus();
      if (state === 'behind') {
        items.push({
          id: 'schema',
          area: 'Database',
          tone: 'bad',
          title: 'The calendar\'s database needs updating',
          detail: `Database ${found || 'unversioned'}, application ${expected}. In the Supabase SQL editor, run supabase/migrate.sql and then supabase/rc_schema.sql.`,
          actions: [],
        });
      }
    }),
  ]);

  const order = { bad: 0, warn: 1, info: 2 };
  items.sort((a, b) => order[a.tone] - order[b.tone]);
  return { items, failed };
}

async function answerLeave(row, status) {
  try {
    await rc.updateLeave(row.id, { status });
    toast({ tone: 'good', message: status === 'approved' ? 'Approved.' : 'Declined, and on the record as declined.' });
    notifyChanged('leave');
  } catch (err) {
    toast({ tone: 'bad', message: err?.message || String(err) });
  }
}

/**
 * How many things are waiting — for the badge on the Organisation tab.
 *
 * The header is redrawn on every write, and the inbox reads a dozen sources;
 * so the count is remembered for a minute. Opening the inbox itself always
 * reads afresh, and refreshes this.
 */
let counted = null; // { at, n }
export async function inboxCount() {
  if (counted && Date.now() - counted.at < 60000) return counted.n;
  const { items } = await inboxItems();
  counted = { at: Date.now(), n: items.length };
  return counted.n;
}

/* ── Drawing ───────────────────────────────────────────────────────────── */

export async function renderInbox(host) {
  host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Waiting on you' })]));
  const body = el('div', { class: 'rc-inbox', 'aria-busy': 'true' }, [
    el('p', { class: 'rc-hint', text: 'Looking through leave, the look-ahead, blockers and accounts…' }),
  ]);
  host.appendChild(body);

  const { items, failed } = await inboxItems();
  counted = { at: Date.now(), n: items.length };
  clear(body);
  body.removeAttribute('aria-busy');

  if (!items.length && !failed.length) {
    body.appendChild(emptyState({
      iconName: 'check',
      title: 'Nothing is waiting on you',
      message: 'No leave to answer, nothing on the look-ahead the registers cannot place, no cancellation without a reason and no blocker without an owner.',
    }));
    return;
  }

  const list = el('ul', { class: 'rc-inbox-list', 'aria-label': 'Waiting on you' });
  for (const item of items) {
    list.appendChild(el('li', { class: `rc-inbox-item rc-inbox-${item.tone}`, dataset: { id: item.id } }, [
      el('span', { class: 'rc-inbox-area' }, [badge(item.area, item.tone)]),
      el('div', { class: 'rc-inbox-text' }, [
        el('div', { class: 'rc-inbox-title', text: item.title }),
        item.detail ? el('div', { class: 'rc-inbox-detail', text: item.detail }) : null,
      ].filter(Boolean)),
      el('div', { class: 'rc-inbox-actions' }, item.actions.map((a) => el('button', {
        class: `cx-btn mini${a.primary ? ' primary' : ' ghost'}`,
        type: 'button',
        text: a.label,
        onClick: () => a.run(),
      }))),
    ]));
  }
  body.appendChild(list);

  for (const f of failed) {
    body.appendChild(el('p', { class: 'rc-hint rc-inbox-failed' }, [
      el('span', { html: icon('alert', { size: 12 }), 'aria-hidden': 'true' }),
      el('span', { text: ` Could not check ${f.area.toLowerCase()}: ${f.message}` }),
    ]));
  }
}
