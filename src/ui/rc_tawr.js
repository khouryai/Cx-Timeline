/**
 * TAWR — track access work requests, raised from the look-ahead.
 *
 * Pick a week; every place the look-ahead works that week becomes a request,
 * one per location and shift, read off the reading every other screen draws
 * (`core/tawr.js` decides what goes in each). An administrator reviews each
 * draft, changes what needs changing, and approves it; an approved request is
 * downloaded as BART's own form, filled and signed (`io/tawr_pdf.js`), and is
 * final — changing it afterwards is a revision.
 *
 * **The look-ahead stays the source.** Creating the requests again after the
 * sheet changes brings every draft up to date without losing what anybody
 * typed: a field nobody touched takes the new value, an edit is kept, and an
 * edit the sheet has since moved underneath is named. An approved request is
 * never touched; it is marked as no longer matching the sheet.
 *
 * Administrators only, in the policies and therefore here: the tab is not
 * offered to anybody else (`ui/rc.js`), and this module says so if reached.
 *
 * Two sections: **Requests** (the week) and **Setup** (BART's blank form, your
 * name and signature, the contacts on every request, the shift hours, and the
 * expanded wording for activities).
 *
 * Imports: util, rc, tawr, tawr_pdf, xlsx_write, exporters, icons, components,
 * rc_util.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import * as T from '../core/tawr.js';
import { readForm, missingFields, fillForm } from '../io/tawr_pdf.js';
import { zipStore } from '../io/xlsx_write.js';
import { saveFile } from '../io/exporters.js';
import { icon } from './icons.js';
import { textInput, selectInput, toast, badge, emptyState, confirmDialog, openModal } from './components.js';
import {
  parsedView, locationRegister, foldName, todayISO, notifyChanged, goToTab, orgNav, formModal,
} from './rc_util.js';

/* Dates as a request talks about them: "Mon 12 Oct", and the year where it matters. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const utc = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
function dayLabel(iso) {
  const d = utc(iso);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
function dateLabel(iso) {
  const d = utc(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const state = { section: 'requests', week: null };

/* ── BART's blank form, once per session ───────────────────────────────── */

let template = null; // { user, bytes }

async function getTemplate() {
  const user = rc.currentUser()?.id || null;
  if (template && template.user === user) return template.bytes;
  const bytes = await rc.downloadTawrTemplate();
  template = bytes ? { user, bytes } : null;
  return bytes;
}

/* ── Everything a request is made from ─────────────────────────────────── */

const settingValue = (rows, key) => rows.find((r) => r.key === key)?.value ?? '';

async function loadContext() {
  const [snapshot, legend, locations, aliases, codes, descriptions, settingsRows, profiles] = await Promise.all([
    rc.latestSnapshot().catch(() => null),
    rc.listLegend().catch(() => []),
    rc.listLocations({ includeInactive: true }).catch(() => []),
    rc.listLocationAliases().catch(() => []),
    rc.listSupportCodes({ includeRetired: true }).catch(() => []),
    rc.listTawrDescriptions().catch(() => []),
    rc.listTawrSettings().catch(() => []),
    rc.listTawrProfiles().catch(() => []),
  ]);
  const view = snapshot?.grid ? parsedView(snapshot, legend) : null;
  const byId = new Map(locations.map((l) => [l.id, l]));
  const register = locationRegister(locations, aliases);
  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  const shiftHours = {};
  for (const s of ['day', 'swing', 'night', 'possession']) {
    shiftHours[s] = settings[`hours_${s}`] || T.DEFAULT_SHIFT_HOURS[s];
  }
  return {
    snapshot,
    view,
    settings,
    settingsRows,
    shiftHours,
    codes,
    descriptions,
    profiles: new Map(profiles.map((p) => [p.person_id, p])),
    resolveLocation: (raw) => byId.get(register.get(foldName(raw))) || null,
  };
}

function extract(ctx, week) {
  if (!ctx.view) return [];
  return T.extractWeek(ctx.view, week, {
    resolveLocation: ctx.resolveLocation,
    codes: ctx.codes,
    descriptions: ctx.descriptions,
    shiftHours: ctx.shiftHours,
  }).groups;
}

/** The form values for a group, as the administrator who raised it would have them. */
function freshValues(ctx, group, raisedBy) {
  return T.formValues(group, { settings: ctx.settings, profile: ctx.profiles.get(raisedBy) || {} });
}

function sourceOf(group) {
  return {
    activities: group.activities.map((a) => ({ title: a.title, activityId: a.activityId, days: a.days })),
    days: group.days,
    support: group.support,
    sswp: group.sswp,
    flags: group.flags,
    unexpanded: group.unexpanded,
    area: group.area,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   The tab
   ═══════════════════════════════════════════════════════════════════════ */

export async function render(root) {
  if (!rc.isAdmin()) {
    root.appendChild(emptyState({
      iconName: 'lock',
      title: 'Administrators only',
      message: 'Track access work requests are raised and approved by an administrator.',
    }));
    return;
  }
  const nav = el('div', { class: 'rc-tabs', style: 'margin:0 0 16px' });
  for (const [id, label] of [['requests', 'Requests'], ['setup', 'Setup']]) {
    nav.appendChild(el('button', {
      class: 'rc-tab',
      type: 'button',
      text: label,
      dataset: { tawrSection: id },
      'aria-pressed': String(state.section === id),
      onClick: () => { state.section = id; clear(root); render(root); },
    }));
  }
  root.appendChild(nav);
  const host = el('div', { class: 'rc-tawr' });
  root.appendChild(host);
  if (state.section === 'setup') await renderSetup(host);
  else await renderRequests(host);
}

/* ══════════════════════════════════════════════════════════════════════════
   Requests
   ═══════════════════════════════════════════════════════════════════════ */

async function renderRequests(host) {
  const today = todayISO();
  const [ctx, recent] = await Promise.all([
    loadContext(),
    rc.listTawrsFrom(T.addDaysISO(T.mondayOf(today), -28)).catch(() => []),
  ]);

  host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Track access work requests' })]));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: `One request per location and shift for the week, read off the look-ahead. Each is due ${T.TAWR_LEAD_DAYS} days before its first day of work.`,
  }));

  const me = rc.me();
  const mine = ctx.profiles.get(me?.id);
  const templateInfo = parseJson(ctx.settings.template_info);
  if (!templateInfo) {
    host.appendChild(notice('warning', 'BART\'s blank form has not been uploaded yet.',
      'Requests can be created and approved, but not downloaded until it is. Upload it in Setup.', 'Open Setup'));
  } else if (!mine?.signature?.strokes?.length || !mine?.requestor_name) {
    host.appendChild(notice('info', 'Your name, cell phone or signature is not saved yet.',
      'Requests you raise go out with them as the requestor. Save them in Setup.', 'Open Setup'));
  }

  if (!ctx.view) {
    host.appendChild(emptyState({
      iconName: 'calendar',
      title: 'No look-ahead to read',
      message: 'Requests are read off the look-ahead. Publish it from the editor, or read the workbook, first.',
      action: { label: 'Go to the look-ahead', onClick: () => goToTab('lookahead') },
    }));
    return;
  }

  const weeks = [...new Set([...T.weeksIn(ctx.view), ...recent.map((r) => r.week_start)])].sort();
  if (!weeks.includes(state.week)) {
    state.week = weeks.find((w) => T.tawrDeadline(w) >= today) || weeks[weeks.length - 1];
  }
  const week = state.week;
  const counts = new Map();
  for (const r of recent) counts.set(r.week_start, (counts.get(r.week_start) || 0) + 1);

  const picker = el('div', { class: 'rc-tabs rc-tawr-weeks', role: 'group', 'aria-label': 'Week' });
  for (const w of weeks) {
    const n = counts.get(w) || 0;
    picker.appendChild(el('button', {
      class: 'rc-tab',
      type: 'button',
      dataset: { week: w },
      'aria-pressed': String(w === week),
      title: `${dayLabel(w)} to ${dayLabel(T.addDaysISO(w, 6))}`,
      onClick: () => { state.week = w; notifyChanged('tawr-week'); },
    }, [
      `Week of ${dateLabel(w).replace(/ \d{4}$/, '')}`,
      n ? el('span', { class: 'rc-tab-count rc-tab-count-info', text: String(n), 'aria-label': `${n} saved` }) : null,
    ]));
  }
  host.appendChild(picker);

  const groups = extract(ctx, week);
  const saved = await rc.listTawrs(week);
  const items = groups.map((g) => ({ group: g, record: saved.find((r) => r.group_key === g.key) || null }));
  for (const r of saved) if (!groups.some((g) => g.key === r.group_key)) items.push({ group: null, record: r });

  const due = T.deadlineState(week, today);
  const approved = items.filter((i) => i.record?.status === 'approved');
  const toolbar = el('div', { class: 'rc-tawr-toolbar' }, [
    el('div', { class: 'rc-tawr-week-line' }, [
      el('strong', { text: `${dayLabel(week)} – ${dayLabel(T.addDaysISO(week, 6))} ${utc(week).getUTCFullYear()}` }),
      el('span', { class: 'rc-hint', style: 'margin:0', text: ` · first-day requests due ${dayLabel(due.deadline)}` }),
    ]),
    el('div', { class: 'rc-tawr-actions' }, [
      groups.length ? el('button', {
        class: 'cx-btn mini primary',
        type: 'button',
        dataset: { action: 'tawr-create' },
        html: `${icon('refresh', { size: 12 })}<span>${saved.length ? 'Update drafts from the look-ahead' : 'Create TAWRs for this week'}</span>`,
        title: 'One draft per location and shift. Drafts already made keep every change typed into them; approved requests are left alone.',
        onClick: (e) => createDrafts(e.currentTarget, ctx, items),
      }) : null,
      approved.length ? el('button', {
        class: 'cx-btn mini',
        type: 'button',
        dataset: { action: 'tawr-download-all' },
        html: `${icon('download', { size: 12 })}<span>Download approved (${approved.length})</span>`,
        onClick: () => downloadAll(ctx, week, approved.map((i) => i.record)),
      }) : null,
    ]),
  ]);
  host.appendChild(toolbar);

  if (!items.length) {
    host.appendChild(emptyState({
      iconName: 'calendar',
      title: 'Nothing painted this week',
      message: 'The look-ahead has no shifts painted between this Monday and Sunday, so there is nothing to request.',
    }));
    return;
  }

  const list = el('div', { class: 'rc-tawr-list' });
  for (const item of items) list.appendChild(card(ctx, item, today));
  host.appendChild(list);
}

function notice(tone, title, detail, action) {
  return el('div', { class: `rc-tawr-notice rc-tawr-notice-${tone}`, role: 'status' }, [
    el('span', { html: icon(tone === 'warning' ? 'warning' : 'info', { size: 16 }), 'aria-hidden': 'true' }),
    el('div', {}, [el('strong', { text: title }), el('span', { text: ` ${detail}` })]),
    action ? el('button', {
      class: 'cx-btn mini ghost', type: 'button', text: action,
      onClick: () => { state.section = 'setup'; notifyChanged('tawr-section'); },
    }) : null,
  ]);
}

const STATUS = {
  none: ['Not created', 'neutral'],
  draft: ['Draft', 'warn'],
  approved: ['Approved', 'good'],
};

function card(ctx, { group, record }, today) {
  const status = record?.status || 'none';
  const name = group?.locationName || record?.location_name || '(no location)';
  const shift = group?.shift || record?.shift;
  const firstDay = group?.firstDay || record?.first_day || record?.week_start;
  const due = T.deadlineState(firstDay, today);
  const fresh = group ? freshValues(ctx, group, record?.created_by || rc.me()?.id) : null;
  const flags = group ? group.flags : [{ kind: 'gone', blocking: true, message: 'No longer on the look-ahead for this week. Discard the draft, or check the sheet.' }];
  const blocking = flags.filter((f) => f.blocking);
  const edited = record ? T.editedKeys(record.fields, record.generated) : [];
  const conflicts = record?.source?.conflicts || [];
  const changed = record?.status === 'approved' && fresh ? T.changedSince(record.generated, fresh) : [];

  const days = group?.days || record?.source?.days || [];
  const activities = group?.activities || record?.source?.activities || [];
  const support = group?.support || record?.source?.support || [];
  const sswp = group?.sswp || record?.source?.sswp || [];

  const node = el('article', {
    class: `rc-tawr-card rc-tawr-${status}`,
    dataset: { tawrKey: group?.key || record?.group_key || '', tawrStatus: status },
    'aria-label': `${name}, ${T.tawrShiftLabel(shift)} shift — ${STATUS[status][0]}`,
  });
  node.appendChild(el('header', { class: 'rc-tawr-card-head' }, [
    el('h4', { text: name }),
    badge(T.tawrShiftLabel(shift), 'info', { dot: false }),
    badge(STATUS[status][0], STATUS[status][1]),
    status === 'approved' ? null : badge(due.label, due.tone === 'ok' ? 'neutral' : due.tone),
  ]));

  node.appendChild(el('dl', { class: 'rc-tawr-facts' }, [
    el('dt', { text: 'Days' }),
    el('dd', { text: days.map((d) => `${dayLabel(d.date)} ${d.start || '?'}–${d.end || '?'}${d.fromShift ? ' (shift hours)' : ''}`).join(' · ') || '—' }),
    el('dt', { text: 'Work' }),
    el('dd', { text: activities.map((a) => a.title).join(' · ') || '—' }),
    el('dt', { text: 'BART support' }),
    el('dd', {
      text: [
        support.filter((s) => s.line === 'systems').map((s) => (s.count > 1 ? `${s.count} x ${s.label}` : s.label)).join(', '),
        support.filter((s) => s.line === 'occ').map((s) => `OCC: ${s.label}`).join(', '),
      ].filter(Boolean).join(' · ') || 'None',
    }),
    sswp.length ? el('dt', { text: 'SSWP' }) : null,
    sswp.length ? el('dd', { text: sswp.join(', ') }) : null,
  ]));

  const notes = el('ul', { class: 'rc-tawr-flags' });
  for (const f of flags) {
    notes.appendChild(el('li', { class: f.blocking ? 'rc-tawr-flag-block' : 'rc-tawr-flag-note' }, [
      el('span', { html: icon(f.blocking ? 'warning' : 'info', { size: 12 }), 'aria-hidden': 'true' }),
      el('span', { text: f.message }),
    ]));
  }
  if (changed.length) {
    notes.appendChild(el('li', { class: 'rc-tawr-flag-block' }, [
      el('span', { html: icon('warning', { size: 12 }), 'aria-hidden': 'true' }),
      el('span', { text: `The look-ahead has changed since this was approved (${changed.map(label).join(', ')}). Revise it if the request should follow.` }),
    ]));
  }
  if (record?.status === 'draft' && conflicts.length) {
    notes.appendChild(el('li', { class: 'rc-tawr-flag-note' }, [
      el('span', { html: icon('info', { size: 12 }), 'aria-hidden': 'true' }),
      el('span', { text: `Kept your change where the look-ahead now says something else: ${conflicts.map(label).join(', ')}.` }),
    ]));
  }
  if (group?.unexpanded?.length) {
    notes.appendChild(el('li', { class: 'rc-tawr-flag-note' }, [
      el('span', { html: icon('info', { size: 12 }), 'aria-hidden': 'true' }),
      el('span', { text: `No expanded wording for: ${group.unexpanded.join(', ')}. Add it in Setup.` }),
    ]));
  }
  if (notes.childNodes.length) node.appendChild(notes);

  const meta = [];
  if (record) {
    const who = ctx.profiles.get(record.created_by)?.requestor_name;
    meta.push(`Raised ${who ? `by ${who} ` : ''}${dateLabel(record.created_at)}`);
    if (edited.length) meta.push(`${edited.length} field${edited.length === 1 ? '' : 's'} changed by hand`);
    if (record.status === 'approved' && record.approved_at) {
      const by = ctx.profiles.get(record.approved_by)?.requestor_name;
      meta.push(`approved${by ? ` by ${by}` : ''} ${dateLabel(record.approved_at)}`);
    }
  } else meta.push('Not created yet — "Create TAWRs" makes the draft.');
  node.appendChild(el('p', { class: 'rc-hint rc-tawr-meta', text: meta.join(' · ') }));

  const actions = el('div', { class: 'rc-tawr-card-actions' });
  if (record?.status === 'draft') {
    actions.append(
      button('Review', 'edit', () => openReview(ctx, record, group), 'tawr-review'),
      button('Approve', 'check', () => approve(record, blocking), 'tawr-approve', {
        primary: true,
        disabled: blocking.length > 0,
        title: blocking.length ? `Cannot be approved yet: ${blocking.map((f) => f.message).join(' ')}` : 'Approve as final. It can be revised later, not edited.',
      }),
      button('Preview PDF', 'document', () => downloadOne(ctx, record, { draft: true }), 'tawr-preview'),
      button('Discard', 'trash', () => discard(record), 'tawr-discard', { danger: true }),
    );
  } else if (record?.status === 'approved') {
    actions.append(
      button('Download PDF', 'download', () => downloadOne(ctx, record), 'tawr-download', { primary: true }),
      button('View', 'eye', () => openReview(ctx, record, group, { readOnly: true }), 'tawr-view'),
      button('Revise', 'edit', () => revise(record), 'tawr-revise'),
    );
  }
  if (actions.childNodes.length) node.appendChild(actions);
  return node;
}

function button(text, iconName, onClick, action, { primary = false, danger = false, disabled = false, title = '' } = {}) {
  return el('button', {
    class: `cx-btn mini${primary ? ' primary' : ' ghost'}${danger ? ' danger' : ''}`,
    type: 'button',
    disabled,
    title: title || null,
    dataset: { action },
    html: `${icon(iconName, { size: 12 })}<span>${text}</span>`,
    onClick,
  });
}

const label = (name) => T.FIELD_LABEL.get(name) || name;

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/* ── Creating, approving, revising ─────────────────────────────────────── */

async function createDrafts(btn, ctx, items) {
  btn.disabled = true;
  let made = 0;
  let updated = 0;
  let kept = 0;
  try {
    for (const { group, record } of items) {
      if (!group) continue;
      const source = sourceOf(group);
      const common = {
        location_id: group.locationId,
        location_name: group.locationName,
        snapshot_id: ctx.snapshot?.id || null,
        first_day: group.firstDay,
      };
      if (!record) {
        const values = freshValues(ctx, group, rc.me()?.id);
        await rc.addTawr({
          week_start: group.weekStart, group_key: group.key, shift: group.shift,
          fields: values, generated: values, source: { ...source, conflicts: [] }, ...common,
        });
        made++;
      } else if (record.status === 'draft') {
        const values = freshValues(ctx, group, record.created_by);
        const merged = T.mergeRegenerated(record, values);
        await rc.updateTawr(record.id, {
          fields: merged.fields, generated: merged.generated, source: { ...source, conflicts: merged.conflicts }, ...common,
        });
        updated++;
      } else kept++;
    }
    const said = [
      made ? `${made} created` : '',
      updated ? `${updated} brought up to date` : '',
      kept ? `${kept} approved left as they are` : '',
    ].filter(Boolean).join(', ');
    toast({ tone: 'good', message: `TAWRs: ${said || 'nothing to do'}.` });
  } catch (err) {
    rc.reportError('tawr:create', err);
    toast({ tone: 'bad', message: err?.message || String(err) });
  } finally {
    btn.disabled = false;
    notifyChanged('tawr');
  }
}

async function approve(record, blocking) {
  if (blocking.length) return;
  const ok = await confirmDialog({
    title: `Approve the ${record.location_name} request?`,
    message: 'Approved is final: it is downloaded as it stands and cannot be edited. If it has to change, revise it — the approved version is kept.',
    confirmLabel: 'Approve',
  });
  if (!ok) return;
  try {
    await rc.updateTawr(record.id, { status: 'approved' });
    toast({ tone: 'good', message: `${record.location_name} approved.` });
  } catch (err) {
    toast({ tone: 'bad', message: err?.message || String(err) });
  }
  notifyChanged('tawr');
}

async function revise(record) {
  const ok = await confirmDialog({
    title: `Revise the ${record.location_name} request?`,
    message: 'A new draft takes its place, carrying everything it said. The approved version is kept on record as superseded.',
    confirmLabel: 'Revise',
  });
  if (!ok) return;
  try {
    await rc.reviseTawr(record.id);
    toast({ tone: 'good', message: 'A draft revision is ready to review.' });
  } catch (err) {
    toast({ tone: 'bad', message: err?.message || String(err) });
  }
  notifyChanged('tawr');
}

async function discard(record) {
  const ok = await confirmDialog({
    title: `Discard the ${record.location_name} draft?`,
    message: 'Changes typed into it go with it. "Create TAWRs" makes a fresh one from the look-ahead.',
    confirmLabel: 'Discard',
    danger: true,
  });
  if (!ok) return;
  try {
    await rc.discardTawr(record.id);
    toast({ message: 'Draft discarded.' });
  } catch (err) {
    toast({ tone: 'bad', message: err?.message || String(err) });
  }
  notifyChanged('tawr');
}

/* ── The PDF ───────────────────────────────────────────────────────────── */

function filled(ctx, bytes, record) {
  const profile = ctx.profiles.get(record.created_by);
  const signature = profile?.signature?.strokes?.length
    ? { field: 'requestor_signature', ...profile.signature }
    : null;
  return { ...fillForm(bytes, record.fields || {}, { signature }), signed: Boolean(signature), profile };
}

async function templateOrSay() {
  let bytes = null;
  try {
    bytes = await getTemplate();
  } catch (err) {
    toast({ tone: 'bad', message: `Could not fetch BART's form: ${err?.message || err}` });
    return null;
  }
  if (!bytes) {
    toast({ tone: 'warn', message: 'Upload BART\'s blank form in TAWR → Setup first.' });
    return null;
  }
  return bytes;
}

async function downloadOne(ctx, record, { draft = false } = {}) {
  const bytes = await templateOrSay();
  if (!bytes) return;
  try {
    const out = filled(ctx, bytes, record);
    const name = T.tawrFileName({ weekStart: record.week_start, locationName: record.location_name, shift: record.shift });
    saveFile(draft ? `DRAFT ${name}` : name, out.bytes, 'application/pdf', draft ? 'TAWR preview' : 'TAWR');
    warnAbout(out);
  } catch (err) {
    rc.reportError('tawr:pdf', err);
    toast({ tone: 'bad', message: err?.message || String(err) });
  }
}

async function downloadAll(ctx, week, records) {
  const bytes = await templateOrSay();
  if (!bytes) return;
  try {
    const files = records.map((record) => {
      const out = filled(ctx, bytes, record);
      warnAbout(out, record.location_name);
      return { name: T.tawrFileName({ weekStart: record.week_start, locationName: record.location_name, shift: record.shift }), data: out.bytes };
    });
    saveFile(`TAWRs ${week}.zip`, zipStore(files), 'application/zip', `${files.length} TAWR${files.length === 1 ? '' : 's'}`);
  } catch (err) {
    rc.reportError('tawr:pdf', err);
    toast({ tone: 'bad', message: err?.message || String(err) });
  }
}

function warnAbout(out, where = '') {
  const overflow = Object.entries(out.report.fields).filter(([, r]) => !r.fits).map(([k]) => label(k));
  if (overflow.length) {
    toast({ tone: 'warn', message: `${where ? `${where}: ` : ''}too long to fit even at the smallest size — ${overflow.join(', ')}. Shorten it in Review.` });
  }
  if (!out.signed) {
    toast({ tone: 'warn', message: `${where ? `${where}: ` : ''}no signature — ${out.profile?.requestor_name || 'the administrator who raised it'} has not saved one in Setup.` });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Review: every field on the form, as it will be printed
   ═══════════════════════════════════════════════════════════════════════ */

const DAY_OPTIONS = ['', 'MON', 'TUES', 'WED', 'THURS', 'FRI', 'SAT', 'SUN'];
const CATEGORY_OPTIONS = ['', 'A', 'B', 'C', 'F', 'P', 'BL', 'Y'];

const MAINT_LINES = [
  ['maint_route_prohibit', 'Route Prohibit'],
  ['maint_speed_restriction', 'Speed Restriction'],
  ['maint_systems_tech_support', 'Technical Support (Systems)'],
  ['maint_safe_clearance', 'Safe Clearance'],
  ['maint_rail_bond_cbond', 'Rail Bond / C-Bond'],
  ['maint_power_tech_support', 'Technical Support (Power & Mechanical)'],
  ['maint_vehicle_equipment', 'Vehicle Equipment'],
  ['maint_vehicle_tech_support', 'Technical Support (Vehicle)'],
  ['maint_safety_dept', 'Safety Dept.'],
  ['maint_operating_bulletin', 'Operating Bulletin #'],
  ['maint_physical_barrier', 'Physical Barrier Req. (attach)'],
  ['maint_safety_monitor', 'Safety Monitor'],
];
const TRANS_LINES = [
  ['trans_yard_line_support', 'Yard / Line Support'],
  ['trans_train_required', 'Train Required'],
  ['trans_train_operators', 'Train Operator(s)'],
  ['trans_single_tracking', 'Single Tracking'],
  ['trans_occ_support', 'OCC Support'],
];

function openReview(ctx, record, group, { readOnly = false } = {}) {
  const editor = formEditor(record, { readOnly });
  const fitBox = el('div', { class: 'rc-tawr-fit', 'aria-live': 'polite' });
  const body = el('div', { class: 'rc-tawr-review' }, [
    group?.flags?.some((f) => f.blocking)
      ? el('div', { class: 'rc-error' }, group.flags.filter((f) => f.blocking).map((f) => el('div', { text: f.message })))
      : null,
    fitBox,
    editor.node,
  ]);

  // Whether what is typed fits, against BART's real form — drawn the way the
  // download will draw it, so the answer is the download's answer.
  let timer = null;
  const checkFit = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      let bytes = null;
      try { bytes = await getTemplate(); } catch { /* said on download */ }
      if (!bytes) { fitBox.textContent = ''; return; }
      try {
        const { report } = fillForm(bytes, editor.read());
        const over = Object.entries(report.fields).filter(([, r]) => !r.fits).map(([k]) => label(k));
        const shrunk = report.fields.work_description;
        fitBox.className = `rc-tawr-fit${over.length ? ' rc-warn' : ''}`;
        fitBox.textContent = over.length
          ? `Too long to fit the form even at the smallest size: ${over.join(', ')}.`
          : shrunk ? `Fits the form. The work description prints at ${Math.round(shrunk.size * 4) / 4} pt.` : 'Fits the form.';
      } catch (err) {
        fitBox.textContent = '';
      }
    }, 250);
  };
  editor.node.addEventListener('input', checkFit);
  editor.node.addEventListener('change', checkFit);
  checkFit();

  const save = async (handle, { andApprove = false } = {}) => {
    try {
      await rc.updateTawr(record.id, { fields: editor.read() });
      if (andApprove) {
        const blocking = (group?.flags || [{ blocking: true }]).filter((f) => f.blocking);
        if (blocking.length) throw new Error('Saved, but it cannot be approved until what is flagged is fixed.');
        await rc.updateTawr(record.id, { status: 'approved' });
      }
      toast({ tone: 'good', message: andApprove ? `${record.location_name} approved.` : 'Draft saved.' });
      handle.close();
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
    notifyChanged('tawr');
  };

  openModal({
    title: `${record.location_name} — ${T.tawrShiftLabel(record.shift)} shift`,
    subtitle: readOnly
      ? 'Approved. Revise it to change anything.'
      : 'Every field as it will be printed. Fields changed by hand are marked; the rest follow the look-ahead.',
    size: 'xl',
    body,
    actions: readOnly
      ? [{ label: 'Close' }, { label: 'Download PDF', kind: 'primary', onClick: () => { downloadOne(ctx, record); } }]
      : [
        { label: 'Cancel' },
        { label: 'Save draft', keepOpen: true, onClick: (h) => { save(h); } },
        { label: 'Save and approve', kind: 'primary', keepOpen: true, onClick: (h) => { save(h, { andApprove: true }); } },
      ],
  });
}

/**
 * The form as controls. `read()` answers the fields object to store: strings
 * for text and dropdowns, true for a ticked box, and nothing at all for what
 * is blank, so a field nobody filled stays blank on the PDF.
 */
function formEditor(record, { readOnly = false } = {}) {
  const fields = record.fields || {};
  const generated = record.generated || {};
  const getters = new Map();

  const mark = (wrap, names) => {
    const changed = names.some((n) => !sameValue(fields[n], generated[n]));
    if (changed) {
      wrap.classList.add('rc-tawr-edited');
      wrap.title = `Changed by hand. The look-ahead says: ${names.map((n) => display(generated[n])).join(' / ') || 'nothing'}`;
    }
    return wrap;
  };

  const text = (name, { multiline = false, placeholder = '', width = null } = {}) => {
    const input = multiline
      ? el('textarea', { class: 'cx-input rc-tawr-textarea', rows: '4', placeholder })
      : textInput({ value: fields[name] ?? '', placeholder });
    if (multiline) input.value = fields[name] ?? '';
    input.dataset.field = name;
    input.setAttribute('aria-label', label(name));
    if (width) input.style.width = width;
    if (readOnly) input.readOnly = true;
    getters.set(name, () => input.value.trim());
    return mark(el('span', { class: 'rc-tawr-ctl' }, [input]), [name]);
  };
  const check = (name, caption = '') => {
    const input = el('input', { type: 'checkbox', 'aria-label': label(name) });
    input.checked = fields[name] === true;
    input.dataset.field = name;
    if (readOnly) input.disabled = true;
    getters.set(name, () => input.checked);
    return mark(el('label', { class: 'rc-tawr-ctl rc-tawr-check' }, [input, caption ? el('span', { text: caption }) : null]), [name]);
  };
  const choice = (name, options) => {
    const select = selectInput({ value: fields[name] ?? '', options: options.map((o) => ({ value: o, label: o || '—' })) });
    select.dataset.field = name;
    select.setAttribute('aria-label', label(name));
    if (readOnly) select.disabled = true;
    getters.set(name, () => select.value);
    return mark(el('span', { class: 'rc-tawr-ctl' }, [select]), [name]);
  };
  // A Yes/No question is two boxes on the form; here it is one answer.
  const yesNo = (base, caption) => {
    const yes = `${base}_yes`;
    const no = `${base}_no`;
    const value = fields[yes] ? 'Yes' : fields[no] ? 'No' : '';
    const select = selectInput({ value, options: [{ value: '', label: '—' }, 'Yes', 'No'] });
    select.setAttribute('aria-label', caption);
    select.dataset.field = base;
    if (readOnly) select.disabled = true;
    getters.set(yes, () => select.value === 'Yes');
    getters.set(no, () => select.value === 'No');
    return el('div', { class: 'rc-tawr-q' }, [el('span', { text: caption }), mark(el('span', { class: 'rc-tawr-ctl' }, [select]), [yes, no])]);
  };
  const power = (n) => {
    const names = ['on', 'off', 'na'].map((p) => `row${n}_power_${p}`);
    const value = fields[names[0]] ? 'ON' : fields[names[1]] ? 'OFF' : fields[names[2]] ? 'N/A' : '';
    const select = selectInput({ value, options: [{ value: '', label: '—' }, 'ON', 'OFF', 'N/A'] });
    select.setAttribute('aria-label', `Row ${n} power status`);
    select.dataset.field = `row${n}_power`;
    if (readOnly) select.disabled = true;
    getters.set(names[0], () => select.value === 'ON');
    getters.set(names[1], () => select.value === 'OFF');
    getters.set(names[2], () => select.value === 'N/A');
    return mark(el('span', { class: 'rc-tawr-ctl' }, [select]), names);
  };

  const section = (title, children) => el('fieldset', { class: 'rc-tawr-section' }, [el('legend', { text: title }), ...children]);
  const pair = (caption, control) => el('label', { class: 'rc-tawr-pair' }, [el('span', { text: caption }), control]);

  const rows = [];
  for (let n = 1; n <= T.FORM_ROWS; n++) {
    rows.push(el('tr', {}, [
      el('td', {}, [text(`row${n}_date`, { placeholder: 'MM/DD/YY', width: '84px' })]),
      el('td', {}, [choice(`row${n}_day`, DAY_OPTIONS)]),
      el('td', {}, [text(`row${n}_time_start`, { placeholder: '0700', width: '60px' })]),
      el('td', {}, [text(`row${n}_time_end`, { placeholder: '1500', width: '60px' })]),
      el('td', {}, [text(`row${n}_area`)]),
      el('td', {}, [power(n)]),
      el('td', {}, [text(`row${n}_safe_clear_rail_sections`, { width: '110px' })]),
    ]));
  }

  const supportLine = ([base, caption]) => el('div', { class: 'rc-tawr-line' }, [
    check(`${base}_req`, caption),
    T.FIELD_KIND.has(`${base}_details`) ? text(`${base}_details`) : el('span'),
  ]);

  const node = el('div', { class: 'rc-tawr-form' }, [
    section('Work and clearances', [
      el('div', { class: 'rc-tawr-qs' }, [
        yesNo('work_in_track_zone', 'Work/Activity in Track Zone'),
        yesNo('clearance_verification', 'Clearance Verification'),
        yesNo('track_inspection_first_train', 'Track Inspection (with 1st Train)'),
      ]),
      el('div', { class: 'rc-tawr-checks' }, [
        check('police_advisory_threat_of_theft', 'Police Advisory (Threat of Theft)'),
        check('advisory_no_work_clearance', 'Advisory (No Work Clearance)'),
        check('no_passage_hirail_vehicles', 'No Passage of Hi-Rail Vehicles'),
        check('coordinate_hirail_passage', 'Coordinate Hi-Rail Passage'),
      ]),
      el('div', { class: 'rc-tawr-grid2' }, [
        pair('Category of Work', choice('category_of_work', CATEGORY_OPTIONS)),
        pair('Schedule Number', text('schedule_number')),
      ]),
      pair('Work Description', text('work_description', { multiline: true })),
    ]),
    section('Contacts', [
      el('div', { class: 'rc-tawr-grid2' }, [
        pair('Requestor', text('requestor_name')),
        pair('Cell phone', text('requestor_cell_phone')),
        pair('Person in charge', text('person_in_charge_name')),
        pair('Cell phone', text('person_in_charge_cell_phone')),
        pair('Project representative', text('project_rep_name')),
        pair('Cell phone', text('project_rep_cell_phone')),
      ]),
    ]),
    section('Dates, times and area', [
      el('div', { class: 'rc-scroll' }, [
        el('table', { class: 'rc-table rc-tawr-rows' }, [
          el('thead', {}, [el('tr', {}, ['Date', 'Day', 'Start', 'End', 'Area (tracks, mileposts, gates, stations)', 'Power', 'Safe clear'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, rows),
        ]),
      ]),
    ]),
    section('Maintenance support', MAINT_LINES.map(supportLine)),
    section('Transportation support', [
      ...TRANS_LINES.map(supportLine),
      el('div', { class: 'rc-tawr-line' }, [check('trans_passenger_bulletin_req', 'Passenger Bulletin'), pair('Public notice', text('trans_public_notice', { width: '80px' }))]),
      el('div', { class: 'rc-tawr-line' }, [check('trans_sswp_iop_required_req', 'SSWP/IOP Required (attach)'), el('span')]),
      el('div', { class: 'rc-tawr-line' }, [check('trans_adverse_impact_blanket_req', 'Adverse Impact to Blanket'), text('trans_adverse_impact_blanket_details', { placeholder: 'SSWP numbers print on this line' })]),
    ]),
    el('p', { class: 'rc-hint', text: 'The approval clearance signatures are left blank for BART. Your signature is drawn on the requestor line at download.' }),
  ]);

  return {
    node,
    read() {
      const out = {};
      for (const [name, get] of getters) {
        const v = get();
        if (v === true || (typeof v === 'string' && v)) out[name] = v;
      }
      return out;
    },
  };
}

function sameValue(a, b) {
  const blank = (v) => v == null || v === '' || v === false;
  return (blank(a) && blank(b)) || a === b;
}

function display(v) {
  if (v === true) return 'ticked';
  if (v == null || v === '' || v === false) return 'blank';
  return String(v);
}

/* ══════════════════════════════════════════════════════════════════════════
   Setup
   ═══════════════════════════════════════════════════════════════════════ */

async function renderSetup(host) {
  const ctx = await loadContext();
  const me = rc.me();
  const mine = ctx.profiles.get(me?.id) || {};

  host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Setup' })]));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'What every request is filled from besides the look-ahead. All of it is visible to administrators only — the database refuses anybody else.',
  }));

  const list = el('div', { class: 'rc-settings' });
  host.appendChild(list);

  /* ── BART's form ────────────────────────────────────────────────────── */
  list.appendChild(group('BART\'s form'));
  const info = parseJson(ctx.settings.template_info);
  const fileInput = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, dataset: { action: 'tawr-template-file' } });
  fileInput.addEventListener('change', () => uploadTemplate(fileInput.files?.[0]));
  list.appendChild(row({
    label: 'The blank fillable form',
    hint: info
      ? `${info.name || 'tawr.pdf'} · ${info.fields} fields · uploaded ${dateLabel(info.uploaded_at)}${info.uploaded_by ? ` by ${info.uploaded_by}` : ''}. Kept in private storage, never published with the site.`
      : 'Not uploaded yet. Kept in private storage that only an administrator can open, and never published with the site.',
    control: el('div', { class: 'rc-settings-inline' }, [
      info ? badge('Uploaded', 'good') : badge('Missing', 'warn'),
      el('button', {
        class: 'cx-btn mini', type: 'button', dataset: { action: 'tawr-template' },
        html: `${icon('upload', { size: 12 })}<span>${info ? 'Replace…' : 'Upload…'}</span>`,
        onClick: () => fileInput.click(),
      }),
      fileInput,
    ]),
  }));

  /* ── You ────────────────────────────────────────────────────────────── */
  list.appendChild(group('You, as the requestor'));
  list.appendChild(profileRow('Your name on the form', 'requestor_name', mine.requestor_name ?? me?.name ?? '', 'Printed as the Requestor on every request you raise.'));
  list.appendChild(profileRow('Your cell phone', 'cell_phone', mine.cell_phone ?? '', 'Printed beside it.'));
  list.appendChild(row({
    label: 'Your signature',
    hint: 'Drawn once, here, and signed onto the requestor line of every request you raise when it is downloaded. Drawn as lines, so it prints sharp.',
    control: signaturePad(mine.signature),
  }));

  /* ── Every request ──────────────────────────────────────────────────── */
  list.appendChild(group('The same on every request'));
  list.appendChild(settingRow('Person in charge', 'person_in_charge_name', ctx.settings));
  list.appendChild(settingRow('Person in charge — cell phone', 'person_in_charge_cell_phone', ctx.settings));
  list.appendChild(settingRow('Project representative', 'project_rep_name', ctx.settings));
  list.appendChild(settingRow('Project representative — cell phone', 'project_rep_cell_phone', ctx.settings));
  list.appendChild(settingRow('Category of Work, unless changed', 'category_default', ctx.settings, {
    options: CATEGORY_OPTIONS.filter(Boolean), fallback: 'F',
  }));

  list.appendChild(group('Shift hours, where the look-ahead gives none'));
  for (const [id, caption] of [['day', 'Day shift'], ['swing', 'Swing shift'], ['night', 'Night shift'], ['possession', 'Blanket']]) {
    list.appendChild(settingRow(caption, `hours_${id}`, ctx.settings, {
      fallback: T.DEFAULT_SHIFT_HOURS[id],
      placeholder: T.DEFAULT_SHIFT_HOURS[id],
      check: (v) => (!v || T.parseHours(v) ? null : 'Write the hours as 0700-1500.'),
      hint: 'By the shift, not the colour — re-mapping a colour in Legend does not move these.',
    }));
  }

  list.appendChild(group('Where each place is'));
  list.appendChild(row({
    label: 'Area wording',
    hint: 'What the form\'s Area column says for each location ("Train Control Room, A-Line MP 12.3") is set on the location itself. Blank uses its name.',
    control: el('button', {
      class: 'cx-btn mini ghost', type: 'button', text: 'Open Locations',
      onClick: () => { orgNav.section = 'locations'; goToTab('org'); },
    }),
  }));
  list.appendChild(row({
    label: 'Which line each support code goes on',
    hint: 'Set on the support code: Technical Support (Systems), OCC Support, or not on the form. A witness is not on the form; ROC is OCC.',
    control: el('button', {
      class: 'cx-btn mini ghost', type: 'button', text: 'Open support codes',
      onClick: () => goToTab('lookahead'),
    }),
  }));

  /* ── Expanded wording ───────────────────────────────────────────────── */
  host.appendChild(descriptionsSection(ctx));
}

function group(title) {
  return el('div', { class: 'rc-settings-group', text: title });
}

function row({ label: caption, hint, control }) {
  return el('div', { class: 'rc-settings-row' }, [
    el('div', { class: 'rc-settings-label' }, [
      el('div', { class: 'rc-settings-name', text: caption }),
      hint ? el('div', { class: 'rc-hint', text: hint }) : null,
    ]),
    el('div', { class: 'rc-settings-control' }, [control]),
  ]);
}

function inlineSave({ input, current, commit }) {
  const button = el('button', { class: 'cx-btn mini', type: 'button', text: 'Save', disabled: true });
  const sync = () => { button.disabled = input.value.trim() === String(current ?? '').trim(); };
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
  const go = async () => {
    if (button.disabled) return;
    if (await commit(input.value.trim())) { current = input.value.trim(); sync(); }
  };
  button.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return el('div', { class: 'rc-settings-inline' }, [input, button]);
}

function settingRow(caption, key, settings, { options = null, fallback = '', placeholder = '', check = null, hint = '' } = {}) {
  const current = settings[key] ?? fallback;
  const input = options
    ? selectInput({ value: current, options })
    : textInput({ value: current, placeholder });
  input.setAttribute('aria-label', caption);
  input.dataset.tawrSetting = key;
  return row({
    label: caption,
    hint,
    control: inlineSave({
      input,
      current,
      commit: async (v) => {
        const problem = check?.(v);
        if (problem) { toast({ tone: 'warn', message: problem }); return false; }
        try {
          await rc.setTawrSetting(key, v);
          toast({ tone: 'good', message: `${caption} saved.` });
          return true;
        } catch (err) {
          toast({ tone: 'bad', message: err?.message || String(err) });
          return false;
        }
      },
    }),
  });
}

function profileRow(caption, key, current, hint) {
  const input = textInput({ value: current });
  input.setAttribute('aria-label', caption);
  input.dataset.tawrProfile = key;
  return row({
    label: caption,
    hint,
    control: inlineSave({
      input,
      current: null, // never saved until somebody saves it, even when prefilled
      commit: async (v) => {
        try {
          await rc.saveTawrProfile({ [key]: v });
          toast({ tone: 'good', message: `${caption} saved.` });
          return true;
        } catch (err) {
          toast({ tone: 'bad', message: err?.message || String(err) });
          return false;
        }
      },
    }),
  });
}

async function uploadTemplate(file) {
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const form = readForm(bytes);
    const missing = missingFields(form, T.TAWR_FIELDS.map((f) => f[0]));
    if (!form.fields.length) throw new Error('That PDF has no fillable fields. Upload the fillable version of the form.');
    if (missing.length) {
      throw new Error(`That form is missing ${missing.length} field${missing.length === 1 ? '' : 's'} the requests fill: `
        + `${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}. Was it revised? Nothing was uploaded.`);
    }
    await rc.uploadTawrTemplate(new Blob([bytes], { type: 'application/pdf' }));
    await rc.setTawrSetting('template_info', JSON.stringify({
      name: file.name, size: bytes.length, fields: form.fields.length,
      uploaded_at: new Date().toISOString(), uploaded_by: rc.me()?.name || null,
    }));
    template = { user: rc.currentUser()?.id || null, bytes };
    toast({ tone: 'good', message: `BART's form uploaded — all ${T.TAWR_FIELDS.length} fields found.` });
    notifyChanged('tawr-template');
  } catch (err) {
    toast({ tone: 'bad', message: err?.message || String(err) });
  }
}

/* ── The signature pad ─────────────────────────────────────────────────── */

const PAD_W = 360;
const PAD_H = 120;

function signaturePad(saved) {
  const canvas = el('canvas', {
    class: 'rc-tawr-pad', width: String(PAD_W), height: String(PAD_H),
    'aria-label': 'Signature pad — draw your signature with the mouse, a pen or a finger',
    role: 'img', dataset: { action: 'tawr-signature-pad' },
  });
  let strokes = (saved?.strokes || []).map((s) => s.map((p) => [...p]));
  let live = null;
  const ctx2d = canvas.getContext('2d');
  const scaleOf = () => {
    const sw = saved?.width || PAD_W;
    const sh = saved?.height || PAD_H;
    return Math.min(PAD_W / sw, PAD_H / sh);
  };
  // A signature saved at another size is redrawn to fit, then kept at this one.
  if (saved?.width && saved.width !== PAD_W) {
    const s = scaleOf();
    strokes = strokes.map((st) => st.map(([x, y]) => [x * s, y * s]));
  }

  const draw = () => {
    ctx2d.clearRect(0, 0, PAD_W, PAD_H);
    const css = getComputedStyle(canvas);
    ctx2d.strokeStyle = css.color || 'black';
    ctx2d.lineWidth = 2;
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';
    for (const st of strokes) {
      if (!st.length) continue;
      ctx2d.beginPath();
      ctx2d.moveTo(st[0][0], st[0][1]);
      for (const [x, y] of st.slice(1)) ctx2d.lineTo(x, y);
      if (st.length === 1) ctx2d.lineTo(st[0][0] + 0.1, st[0][1]);
      ctx2d.stroke();
    }
  };
  const at = (e) => {
    const r = canvas.getBoundingClientRect();
    return [
      Math.round(((e.clientX - r.left) / r.width) * PAD_W * 10) / 10,
      Math.round(((e.clientY - r.top) / r.height) * PAD_H * 10) / 10,
    ];
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    live = [at(e)];
    strokes.push(live);
    draw();
    sync();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!live) return;
    const p = at(e);
    const last = live[live.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return;
    live.push(p);
    draw();
  });
  const end = () => { live = null; sync(); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const saveBtn = el('button', { class: 'cx-btn mini primary', type: 'button', text: 'Save signature', dataset: { action: 'tawr-signature-save' } });
  const clearBtn = el('button', { class: 'cx-btn mini ghost', type: 'button', text: 'Clear', dataset: { action: 'tawr-signature-clear' } });
  let dirty = false;
  const sync = () => {
    dirty = true;
    saveBtn.disabled = !strokes.length;
  };
  saveBtn.disabled = true;
  clearBtn.addEventListener('click', () => { strokes = []; draw(); dirty = true; saveBtn.disabled = false; });
  saveBtn.addEventListener('click', async () => {
    if (!dirty) return;
    try {
      const signature = strokes.length ? { width: PAD_W, height: PAD_H, strokes: strokes.filter((s) => s.length) } : null;
      await rc.saveTawrProfile({ signature });
      dirty = false;
      saveBtn.disabled = true;
      toast({ tone: 'good', message: signature ? 'Signature saved.' : 'Signature removed.' });
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
  });
  requestAnimationFrame(draw);
  return el('div', { class: 'rc-tawr-signature' }, [
    canvas,
    el('div', { class: 'rc-settings-inline' }, [clearBtn, saveBtn]),
  ]);
}

/* ── Expanded wording ──────────────────────────────────────────────────── */

function descriptionsSection(ctx) {
  const wrap = el('div', { class: 'rc-tawr-descriptions' });
  wrap.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'Expanded wording for activities' }),
    el('button', {
      class: 'cx-btn mini primary', type: 'button', dataset: { action: 'tawr-description-add' },
      html: `${icon('plus', { size: 12 })}<span>Add wording</span>`,
      onClick: () => editDescription(null, ctx.descriptions),
    }),
  ]));
  wrap.appendChild(el('p', {
    class: 'rc-hint',
    text: 'What the Work Description says about an activity, after its name. Matched on the activity\'s name as the look-ahead writes it (case and punctuation ignored, nothing else).',
  }));

  if (ctx.descriptions.length) {
    wrap.appendChild(el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table' }, [
        el('thead', {}, [el('tr', {}, ['Activity', 'Wording', ''].map((h) => el('th', { text: h })))]),
        el('tbody', {}, ctx.descriptions.map((d) => el('tr', {}, [
          el('td', { text: d.activity }),
          el('td', { text: d.description || '—' }),
          el('td', { style: 'text-align:right;white-space:nowrap' }, [
            el('button', { class: 'cx-btn mini ghost', type: 'button', text: 'Edit', onClick: () => editDescription(d, ctx.descriptions) }),
            el('button', {
              class: 'cx-btn mini ghost danger', type: 'button', text: 'Remove',
              onClick: async () => {
                if (!(await confirmDialog({ title: `Remove the wording for ${d.activity}?`, message: 'Requests already approved keep what they say.', confirmLabel: 'Remove', danger: true }))) return;
                try { await rc.deleteTawrDescription(d.id); notifyChanged('tawr-descriptions'); } catch (err) { toast({ tone: 'bad', message: err.message }); }
              },
            }),
          ]),
        ]))),
      ]),
    ]));
  } else {
    wrap.appendChild(el('p', { class: 'rc-hint', text: 'None yet.' }));
  }

  // The activities the look-ahead is working that nothing describes yet.
  const known = new Set(ctx.descriptions.map((d) => foldName(d.activity)));
  const titles = new Map();
  if (ctx.view) {
    const cols = T.columnsOf(ctx.view);
    for (const a of ctx.view.activities) {
      if (a.heading || a.absence || !a.named || !a.highlighted) continue;
      const title = String(a.meta?.[cols.description] || '').trim();
      const key = foldName(title);
      if (title && !known.has(key) && !titles.has(key)) titles.set(key, title);
    }
  }
  if (titles.size) {
    wrap.appendChild(el('p', { class: 'rc-hint', text: 'On the look-ahead with no wording yet:' }));
    const sorted = [...titles.values()].sort((a, b) => a.localeCompare(b));
    wrap.appendChild(el('div', { class: 'rc-tawr-chips' }, sorted.map((t) => el('button', {
      class: 'cx-btn mini ghost', type: 'button', dataset: { action: 'tawr-describe' },
      onClick: () => editDescription({ activity: t, description: '' }, ctx.descriptions, { isNew: true }),
    }, [el('span', { html: icon('plus', { size: 11 }), 'aria-hidden': 'true' }), t]))));
  }
  return wrap;
}

function editDescription(existing, all, { isNew = false } = {}) {
  const creating = !existing?.id || isNew;
  const activity = textInput({ value: existing?.activity || '', placeholder: 'IXL SIM Testing' });
  const wording = el('textarea', { class: 'cx-input rc-tawr-textarea', rows: '4', placeholder: 'IXL team will perform functional testing using CBTC equipment only within the train control room.' });
  wording.value = existing?.description || '';
  formModal({
    title: creating ? 'Add wording for an activity' : `Wording for ${existing.activity}`,
    confirmLabel: creating ? 'Add' : 'Save',
    body: el('div', { class: 'lae-form' }, [
      el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Activity, as the look-ahead names it' }), activity]),
      el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'What the Work Description adds' }), wording]),
    ]),
    onConfirm: async () => {
      const name = activity.value.trim();
      if (!name) throw new Error('Name the activity.');
      const clash = all.find((d) => foldName(d.activity) === foldName(name) && d.id !== existing?.id);
      if (clash) throw new Error(`"${clash.activity}" already has wording — edit that one.`);
      if (creating) await rc.addTawrDescription({ activity: name, description: wording.value.trim() });
      else await rc.updateTawrDescription(existing.id, { activity: name, description: wording.value.trim() });
      notifyChanged('tawr-descriptions');
    },
  });
}
