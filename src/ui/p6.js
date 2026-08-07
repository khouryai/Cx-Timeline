/**
 * The P6 master list.
 *
 * Every imported activity, whether or not it is on the timeline. This is the
 * answer to "they asked me about A1234" — search it, see its baseline dates,
 * its current dates, how far P6 has moved it, and whether it is on your plan.
 *
 * Two things are deliberately kept apart here:
 *
 *   P6 slip      how far the scheduler has moved the activity since the
 *                baseline. Their number, about their programme.
 *   Your variance how far your plan differs from where P6 has it now. Your
 *                number, and the one you have to be able to explain.
 *
 * And "position" is not "status". Dates say where an activity sits against
 * today; they cannot say whether the work happened. Status stays on the
 * object, where a person sets it.
 *
 * Imports: util, events, dates, model, store, renderer, io/p6, commands,
 *          icons, components.
 */

import { el, clear, debounce, fold } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import { fmtDate, fmtTimestamp, MS_DAY } from '../core/dates.js';
import {
  TYPES,
  p6Register,
  p6Dates,
  p6Slip,
  p6Variance,
  p6Position,
  p6IsMilestone,
  p6Placed,
  p6PlacedIds,
  p6LinkedIds,
  statusOf,
} from '../core/model.js';
import * as store from '../core/store.js';
import * as renderer from '../timeline/renderer.js';
import { readP6File, reconcile } from '../io/p6.js';
import * as cmd from './commands.js';
import { icon } from './icons.js';
import {
  openModal,
  openPicker,
  field,
  textInput,
  selectInput,
  segmented,
  checkbox,
  section,
  emptyState,
  badge,
  chipStat,
  toast,
  confirmDialog,
  skeleton,
} from './components.js';

/* ══════════════════════════════════════════════════════════════════════════
   The pane
   ═══════════════════════════════════════════════════════════════════════ */

/** Filter state, kept between renders so a rebuild does not lose your place. */
const view = { text: '', show: 'all', sort: 'order' };

/**
 * The rows container of the pane currently on screen.
 *
 * Searching must not rebuild the pane: the search box has focus, and
 * replacing it under the caret drops focus after every character — the trap
 * that `isTypingInDock()` exists to prevent, which a pane asking for its own
 * rebuild walks straight past. Only the rows are redrawn.
 */
let listEl = null;

const POSITION_TONE = { past: 'muted', current: 'warn', future: 'info', unknown: 'muted' };
const POSITION_WORD = { past: 'Past', current: 'Current', future: 'Future', unknown: '—' };

export function paneP6(root) {
  const doc = store.getDoc();
  const register = p6Register(doc);
  const activities = Object.values(register.activities);

  root.appendChild(importBar(register, activities.length));

  if (!activities.length) {
    root.appendChild(
      emptyState({
        iconName: 'table',
        title: 'No P6 schedule imported',
        message: 'Import an Excel or CSV export with Activity ID, Activity Name, Start and Finish. Anything else it carries is used too.',
      })
    );
    return;
  }

  root.appendChild(summary(doc, activities));
  root.appendChild(controls(activities));

  listEl = el('div', { class: 'cx-list' });
  root.appendChild(listEl);
  renderRows(listEl, doc, activities);
}

/** Redraw the rows in place, leaving the search box and its caret alone. */
function refilter() {
  if (!listEl || !listEl.isConnected) {
    refresh();
    return;
  }
  const doc = store.getDoc();
  renderRows(listEl, doc, Object.values(p6Register(doc).activities));
}

/* ── Import ────────────────────────────────────────────────────────────── */

function importBar(register, count) {
  const stamp = (entry, label) =>
    el('div', { class: 'p6-stamp' }, [
      el('span', { class: 'p6-stamp-label', text: label }),
      entry
        ? el('span', { class: 'p6-stamp-value', text: fmtTimestamp(entry.importedAt), title: entry.fileName || '' })
        : el('span', { class: 'p6-stamp-value none', text: 'not imported' }),
    ]);

  return el('div', { style: { marginBottom: '12px' } }, [
    el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '9px' } }, [
      el('button', {
        class: 'cx-btn mini primary',
        html: icon('upload', { size: 12 }) + '<span>Import from P6</span>',
        onClick: () => openImport(),
      }),
      register.baseline
        ? el('button', {
            class: 'cx-btn mini',
            html: icon('bookmark', { size: 12 }) + '<span>Compare to baseline</span>',
            title: 'Show the difference between your dates and the imported P6 baseline',
            onClick: () => compare('baseline'),
          })
        : null,
      register.progress
        ? el('button', {
            class: 'cx-btn mini',
            html: icon('bookmark', { size: 12 }) + '<span>Compare to progress</span>',
            title: 'Show the difference between your dates and the latest P6 progress',
            onClick: () => compare('progress'),
          })
        : null,
    ].filter(Boolean)),
    el('div', { class: 'p6-stamps' }, [stamp(register.baseline, 'Baseline'), stamp(register.progress, 'Progress')]),
  ]);
}

/**
 * The import dialog.
 *
 * Nothing is written until the reconciliation has been shown. An import that
 * silently moved forty dates would look exactly like one that moved four
 * hundred, and only one of those is worth interrupting a review for.
 */
export function openImport(preset = 'progress') {
  let kind = preset;
  let parsed = null;
  let file = null;

  const status = el('div', { class: 'cx-hint', style: { minHeight: '18px' } });
  const preview = el('div');
  const input = el('input', {
    type: 'file',
    accept: '.xlsx,.xlsm,.csv,.tsv,.txt',
    style: { display: 'none' },
    onChange: async (e) => {
      file = e.target.files?.[0];
      if (file) await read(file);
    },
  });

  async function read(chosen) {
    clear(preview);
    preview.appendChild(skeleton(2));
    status.textContent = `Reading ${chosen.name}…`;
    try {
      parsed = await readP6File(chosen);
      renderPreview();
    } catch (err) {
      parsed = null;
      clear(preview);
      status.textContent = '';
      preview.appendChild(el('div', { class: 'cx-gate-msg bad', text: `Could not read the file: ${err.message}` }));
    }
  }

  function renderPreview() {
    clear(preview);
    status.textContent = '';
    if (!parsed) return;

    for (const warning of parsed.warnings) {
      preview.appendChild(el('div', { class: 'cx-gate-msg bad', style: { marginBottom: '8px' }, text: warning }));
    }

    if (!parsed.activities.length) return;

    const doc = store.getDoc();
    const plan = reconcile(p6Register(doc), parsed.activities, kind, p6PlacedIds(doc));

    const found = Object.entries(parsed.mapping)
      .filter(([, index]) => index >= 0)
      .map(([f]) => ({ id: 'Activity ID', name: 'Name', start: 'Start', end: 'Finish', wbs: 'WBS', percent: '% Complete', status: 'Status', float: 'Float' }[f]))
      .filter(Boolean);

    preview.append(
      el('div', { class: 'cx-chipstats', style: { marginBottom: '10px' } }, [
        chipStat('Read', plan.total, 'info'),
        chipStat('New', plan.added.length, plan.added.length ? 'good' : 'muted'),
        chipStat('Moved', plan.moved.length - plan.added.length < 0 ? 0 : plan.moved.length, plan.moved.length ? 'warn' : 'muted'),
        chipStat('Unchanged', plan.unchanged.length, 'muted'),
        plan.absent.length ? chipStat('Not in file', plan.absent.length, 'bad') : null,
      ].filter(Boolean)),
      el('div', { class: 'cx-hint', text: `Columns recognised: ${found.join(', ')}.` })
    );

    if (plan.placedAffected) {
      preview.appendChild(
        el('div', { class: 'cx-gate-msg', style: { borderColor: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, transparent)', marginTop: '9px' },
          text: `${plan.placedAffected} of the activities that moved are on your timeline. After importing you can choose which of your bars follow the new dates.` })
      );
    }

    const absentPlaced = plan.absent.filter((a) => a.placed);
    if (absentPlaced.length) {
      preview.appendChild(
        el('div', { class: 'cx-gate-msg bad', style: { marginTop: '9px' },
          text: `${absentPlaced.length} activity(s) on your timeline are not in this file — they will be marked, not removed.` })
      );
    }

    // A sample, so a wrong column mapping is obvious before anything is written.
    const sample = parsed.activities.slice(0, 4);
    preview.appendChild(
      el('div', { style: { marginTop: '11px' } }, [
        el('div', { class: 'cx-section-label', text: 'First rows' }),
        el('div', { class: 'cx-list' }, sample.map((a) =>
          el('div', { class: 'cx-listrow', style: { cursor: 'default' } }, [
            el('div', { class: 'lr-main' }, [
              el('div', { class: 'lr-title', text: a.name }),
              el('div', { class: 'lr-meta', text: `${a.id} · ${fmtDate(a.dates.start, 'medium')} → ${fmtDate(a.dates.end, 'medium')}` }),
            ]),
          ])
        )),
      ])
    );

  }

  const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } }, [
    field('This import is', segmented({
      value: kind,
      stretch: true,
      options: [
        { value: 'baseline', label: 'Baseline' },
        { value: 'progress', label: 'Progress' },
      ],
      onChange: (v) => {
        kind = v;
        if (parsed) renderPreview();
      },
    }), 'A baseline is the target programme and is replaced only by another baseline. Progress is where the schedule stands now, and is re-imported each month.'),

    el('button', {
      class: 'cx-btn mini',
      style: { justifyContent: 'flex-start' },
      html: icon('upload', { size: 12 }) + '<span>Choose a file…</span>',
      onClick: () => input.click(),
    }),
    input,
    status,
    preview,
  ]);

  return openModal({
    title: 'Import from P6',
    subtitle: 'Activity ID, Activity Name, Start and Finish are required. WBS, % complete and status are used if present.',
    size: 'wide',
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Import',
        kind: 'primary',
        onClick: () => {
          if (!parsed?.activities.length) {
            toast({ tone: 'warn', title: 'Nothing to import', message: 'Choose a P6 export first.' });
            return false;
          }
          const doc = store.getDoc();
          const plan = reconcile(p6Register(doc), parsed.activities, kind, p6PlacedIds(doc));
          store.importP6(kind, parsed.activities, { fileName: file?.name || '' });
          renderer.requestRender();
          emit(EV.P6_IMPORTED, { kind, plan });
          toast({
            tone: 'good',
            title: `P6 ${kind} imported`,
            message: `${plan.total} activities · ${plan.added.length} new · ${plan.moved.length} moved.`,
          });
          if (plan.placedAffected) setTimeout(() => openAdoptDialog(plan), 350);
          return undefined;
        },
      },
    ],
  });
}

/**
 * After a progress import: which of your bars should follow the new dates.
 *
 * Defaulted to none. The plan is yours, and an import that moved your work
 * without asking would make the tool untrustworthy for the one job it has.
 */
function openAdoptDialog(plan) {
  const affected = plan.moved.filter((m) => m.placed);
  if (!affected.length) return;

  const chosen = new Set();
  const rows = el('div', { class: 'cx-list' });

  for (const item of affected) {
    rows.appendChild(
      el('div', { class: 'cx-listrow', style: { cursor: 'default' } }, [
        checkbox({
          label: '',
          checked: false,
          onChange: (v) => (v ? chosen.add(item.id) : chosen.delete(item.id)),
        }),
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: item.name }),
          el('div', { class: 'lr-meta', text: `${item.id} · ${shiftWord(item.finishShift)} than ${item.against}` }),
        ]),
        badge(shiftLabel(item.finishShift), item.finishShift > 0 ? 'bad' : 'good'),
      ])
    );
  }

  openModal({
    title: 'Follow the new P6 dates?',
    subtitle: `${affected.length} activities on your timeline moved in this import. Your dates are unchanged unless you say so.`,
    size: 'wide',
    body: el('div', {}, [
      el('div', { style: { display: 'flex', gap: '6px', marginBottom: '10px' } }, [
        el('button', {
          class: 'cx-btn mini',
          text: 'Select all',
          onClick: (e) => {
            for (const box of e.currentTarget.closest('.cx-modal').querySelectorAll('input[type="checkbox"]')) {
              if (!box.checked) box.click();
            }
          },
        }),
      ]),
      rows,
    ]),
    actions: [
      { label: 'Keep my dates' },
      {
        label: 'Apply to selected',
        kind: 'primary',
        onClick: () => {
          if (!chosen.size) return;
          store.adoptP6Dates([...chosen]);
          renderer.requestRender();
          toast({ tone: 'good', title: 'Dates updated', message: `${chosen.size} bar(s) moved onto their P6 dates.` });
        },
      },
    ],
  });
}

/* ── Summary ───────────────────────────────────────────────────────────── */

function summary(doc, activities) {
  const placed = p6PlacedIds(doc);
  let slipped = 0;
  let missing = 0;
  for (const activity of activities) {
    const slip = p6Slip(activity);
    if (slip?.slipped) slipped++;
    if (activity.missing) missing++;
  }

  return el('div', { class: 'cx-chipstats', style: { marginBottom: '11px' } }, [
    chipStat('Activities', activities.length, 'info'),
    chipStat('On timeline', placed.size, placed.size ? 'good' : 'muted'),
    chipStat('Slipped', slipped, slipped ? 'bad' : 'muted'),
    missing ? chipStat('Not in P6', missing, 'warn') : null,
  ].filter(Boolean));
}

/* ── Controls ──────────────────────────────────────────────────────────── */

function controls(activities) {
  const search = textInput({
    value: view.text,
    placeholder: 'Activity ID or name…',
    onInput: debounce((v) => {
      view.text = v;
      refilter();
    }, 160),
  });
  search.setAttribute('aria-label', 'Search P6 activities');

  return el('div', { style: { marginBottom: '10px' } }, [
    field('Find', search),
    segmented({
      value: view.show,
      stretch: true,
      options: [
        { value: 'all', label: 'All' },
        { value: 'placed', label: 'On timeline' },
        { value: 'unplaced', label: 'Not placed' },
        { value: 'changed', label: 'Moved' },
      ],
      onChange: (v) => {
        view.show = v;
        refilter();
      },
    }),
  ]);
}

/* ── Rows ──────────────────────────────────────────────────────────────── */

function matches(doc, activity) {
  if (view.text) {
    const needle = fold(view.text);
    if (!fold(`${activity.id} ${activity.name} ${activity.wbs}`).includes(needle)) return false;
  }
  const placed = p6Placed(doc, activity.id).length > 0;
  if (view.show === 'placed' && !placed) return false;
  if (view.show === 'unplaced' && placed) return false;
  if (view.show === 'changed') {
    const slip = p6Slip(activity);
    if (!slip?.changed) return false;
  }
  return true;
}

function renderRows(list, doc, activities) {
  clear(list);
  const shown = activities.filter((a) => matches(doc, a)).sort((a, b) => a.order - b.order);

  if (!shown.length) {
    list.appendChild(emptyState({ iconName: 'search', title: 'Nothing matches', message: 'Try a different search or filter.' }));
    return;
  }

  // A 1,500-row list would be slower to build than to read; the rest are one
  // click away and the filter is right there.
  const LIMIT = 300;
  for (const activity of shown.slice(0, LIMIT)) list.appendChild(activityRow(doc, activity));

  if (shown.length > LIMIT) {
    list.appendChild(
      el('div', { class: 'cx-hint', style: { padding: '8px 4px' },
        text: `Showing the first ${LIMIT} of ${shown.length}. Narrow the search to see the rest.` })
    );
  }
}

function activityRow(doc, activity) {
  const objects = p6Placed(doc, activity.id);
  const placed = objects.length > 0;
  const dates = p6Dates(activity);
  const slip = p6Slip(activity);
  const position = p6Position(activity);
  const variance = placed ? p6Variance(doc, objects[0]) : null;

  const meta = [
    activity.id,
    dates ? `${fmtDate(dates.start, 'numeric')} → ${fmtDate(dates.end, 'numeric')}` : 'no dates',
    p6IsMilestone(activity) ? 'milestone' : null,
    activity.wbs || null,
  ].filter(Boolean).join(' · ');

  const row = el('div', {
    class: 'p6-row' + (placed ? ' placed' : ''),
    dataset: { p6: activity.id },
    draggable: 'true',
    title: 'Drag onto the timeline to place it, or onto an existing bar to link them',
    onClick: () => (placed ? reveal(objects[0].id) : place(activity.id)),
  }, [
    el('span', {
      class: 'p6-mark',
      style: { background: placed ? 'var(--good)' : 'var(--text-subtle)' },
      title: placed ? 'On the timeline' : 'Not placed',
    }),

    el('div', { class: 'p6-name', text: activity.name, title: activity.name }),

    el('div', { class: 'p6-acts' }, [
      placed
        ? el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Show on the timeline',
            'aria-label': `Show ${activity.id} on the timeline`,
            html: icon('target', { size: 11 }),
            onClick: (e) => { e.stopPropagation(); reveal(objects[0].id); },
          })
        : el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Add to the timeline',
            'aria-label': `Add ${activity.id} to the timeline`,
            html: icon('plus', { size: 11 }),
            onClick: (e) => { e.stopPropagation(); place(activity.id); },
          }),
      el('button', {
        class: 'cx-btn icon mini ghost',
        title: placed ? 'Unlink' : 'Link to an existing object',
        'aria-label': placed ? `Unlink ${activity.id}` : `Link ${activity.id} to an object`,
        html: icon(placed ? 'x' : 'link', { size: 11 }),
        onClick: (e) => {
          e.stopPropagation();
          if (placed) unlink(objects, activity);
          else openLinkPicker(activity);
        },
      }),
    ]),

    el('div', { class: 'p6-meta', text: meta }),

    el('div', { class: 'p6-badges' }, [
      activity.missing ? badge('Not in P6', 'bad') : null,
      slip?.changed ? badge(`P6 ${shiftLabel(slip.finishShift)}`, slip.finishShift > 0 ? 'bad' : 'good') : null,
      variance?.differs ? badge(`you ${shiftLabel(variance.finishShift)}`, variance.behind ? 'warn' : 'info') : null,
    objects.length > 1 ? badge(`${objects.length} bars`, 'info') : null,
      !placed ? badge(POSITION_WORD[position], POSITION_TONE[position]) : null,
      placed && objects[0].status ? badge(statusOf(objects[0].status).label, statusOf(objects[0].status).tone) : null,
    ].filter(Boolean)),
  ]);

  // Dragging is the obvious gesture for "put this there", and it is the only
  // way to link without first knowing which of a hundred bars you want.
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(P6_MIME, activity.id);
    e.dataTransfer.setData('text/plain', `${activity.id} — ${activity.name}`);
    e.dataTransfer.effectAllowed = 'copyLink';
    row.classList.add('dragging');
    document.body.classList.add('p6-dragging');
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    document.body.classList.remove('p6-dragging');
  });

  return row;
}

/* ── Actions ───────────────────────────────────────────────────────────── */

function place(activityId) {
  const lanes = store.orderedLanes();
  if (!lanes.length) {
    toast({ tone: 'warn', title: 'No lanes', message: 'Add a lane before placing activities.' });
    return;
  }

  let laneId = lanes[0].id;
  openModal({
    title: 'Add to the timeline',
    subtitle: `${activityId} — its P6 dates become the starting point, and are yours to change from then on.`,
    body: field('Lane', selectInput({
      value: laneId,
      options: lanes.map((l) => ({ value: l.id, label: l.name })),
      onChange: (v) => { laneId = v; },
    })),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Add',
        kind: 'primary',
        onClick: () => {
          const id = store.placeP6Activity(activityId, { lane: laneId });
          if (!id) {
            toast({ tone: 'bad', title: 'Could not add it', message: 'That activity has no usable dates.' });
            return;
          }
          cmd.revealObject(id);
          refresh();
        },
      },
    ],
  });
}

function reveal(objectId) {
  cmd.revealObject(objectId);
}

async function unlink(objects, activity) {
  const ok = await confirmDialog({
    title: `Unlink ${activity.id}?`,
    message: `${objects.length} object(s) keep their dates and their place on the timeline, and any other P6 activity they track. Only this link goes.`,
    confirmLabel: 'Unlink',
  });
  if (!ok) return;
  for (const object of objects) store.unlinkP6(object.id, activity.id);
  renderer.requestRender();
  refresh();
}

/** Attach an activity to something already on the timeline. */
function openLinkPicker(activity) {
  const doc = store.getDoc();
  const lanes = new Map(doc.lanes.map((l) => [l.id, l.name]));
  // A bar tracks a set of activities, so being linked already does not
  // disqualify it — only already tracking *this* activity does.
  const candidates = doc.objects
    .filter((o) => TYPES[o.type] && !p6LinkedIds(o).includes(activity.id))
    .sort((a, b) => a.start - b.start);

  if (!candidates.length) {
    toast({ tone: 'warn', title: 'Nothing to link to', message: `Every object already tracks ${activity.id}.` });
    return;
  }

  openPicker({
    title: `Link ${activity.id}`,
    subtitle: `${activity.name} — the object keeps its own dates; linking records where they came from.`,
    placeholder: 'Search by title or lane…',
    items: candidates.map((o) => {
      const tracked = p6LinkedIds(o).length;
      return {
        value: o.id,
        label: o.title,
        meta: `${lanes.get(o.lane) || 'no lane'} · ${fmtDate(o.start, 'numeric')}`
          + (tracked ? ` · tracks ${tracked}` : ''),
      };
    }),
    empty: 'No object matches.',
    onPick: (objectId) => {
      if (!objectId) return;
      store.linkP6(objectId, activity.id);
      renderer.requestRender();
      refresh();
      toast({ tone: 'good', title: 'Linked', message: `${activity.id} is now tracked against that object.` });
    },
  });
}

/**
 * Turn on comparison against one side of the register.
 *
 * The two P6 baselines appear on their own when a file is imported and follow
 * whatever is linked, so this only has to point the canvas at one of them.
 */
function compare(kind) {
  const id = store.showP6Comparison(kind);
  if (!id) {
    toast({ tone: 'warn', title: 'Not imported', message: `No P6 ${kind} has been imported yet.` });
    return;
  }
  const rows = store.snapshotOf(store.getDoc().baselines.find((b) => b.id === id));
  renderer.requestRender();
  toast({
    tone: rows.length ? 'good' : 'warn',
    title: rows.length ? `Comparing against the P6 ${kind}` : 'Nothing linked yet',
    message: rows.length
      ? `${rows.length} linked activit${rows.length === 1 ? 'y' : 'ies'}. Link more and the comparison follows.`
      : 'Place or link some P6 activities and the comparison fills in on its own.',
  });
}

/* ── Dropping onto the canvas ──────────────────────────────────────────── */

/** The type carried on a dragged activity. Also read by the canvas. */
export const P6_MIME = 'application/x-cx-p6';

/**
 * Wire up what a dropped activity means.
 *
 * The canvas reports *where* something landed — on a bar, or in a lane — and
 * knows nothing about Primavera. What that means is decided here.
 */
export function installP6Drops() {
  on('canvas:drop', ({ data, objectId, laneId }) => {
    const activityId = data?.[P6_MIME];
    if (!activityId) return;

    const activity = store.getP6Activity(activityId);
    if (!activity) {
      toast({ tone: 'bad', title: 'Unknown activity', message: `${activityId} is not in the register.` });
      return;
    }

    // Onto a bar: link the two. Onto empty lane: place a new object there.
    if (objectId) {
      const target = store.getObject(objectId);
      const already = p6LinkedIds(target);
      if (already.includes(activityId)) {
        toast({ tone: 'info', title: 'Already linked', message: `That bar is already tracking ${activityId}.` });
        return;
      }
      // Additive: a bar standing for a test package collects activities as
      // you drop them, rather than each one displacing the last.
      store.linkP6(objectId, activityId);
      renderer.requestRender();
      refresh();
      const total = already.length + 1;
      toast({
        tone: 'good',
        title: 'Linked',
        message: total > 1
          ? `${target.title} now tracks ${total} P6 activities.`
          : `${target.title} now tracks ${activityId}.`,
      });
      return;
    }

    const id = store.placeP6Activity(activityId, { lane: laneId });
    if (!id) {
      toast({ tone: 'bad', title: 'Could not place it', message: 'That activity has no usable dates.' });
      return;
    }
    cmd.revealObject(id);
    refresh();
    toast({ tone: 'good', title: `${activityId} added`, message: 'Its P6 dates are the starting point, and are yours from here.' });
  });
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function shiftLabel(days) {
  if (days == null) return '—';
  if (days === 0) return 'on plan';
  return `${days > 0 ? '+' : '−'}${Math.abs(days)}d`;
}

function shiftWord(days) {
  if (days == null) return 'newly dated';
  if (!days) return 'unchanged';
  return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ${days > 0 ? 'later' : 'earlier'}`;
}

/** Ask the dock to rebuild this pane. */
function refresh() {
  emit(EV.PANE_REFRESH, { pane: 'p6' });
}
