/**
 * The document model: schema, type registry, factories, validation and
 * forward migration.
 *
 * A CX Timeline project is a single plain-JSON document. Everything the
 * application can do is a transformation of this structure, which is what
 * makes undo, autosave, baselines, export and import all fall out of one
 * mechanism instead of five.
 *
 * Imports: util, dates (leaves only).
 */

import { uid, deepClone, clamp } from './util.js';
import { toMs, toISO, todayMs, addDays, MS_DAY, startOfMonth, addMonths } from './dates.js';

/** Bump when the document shape changes; add a step to `MIGRATIONS`. */
export const SCHEMA_VERSION = 4;

/* ══════════════════════════════════════════════════════════════════════════
   Object type registry
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every timeline object declares its behaviour here rather than in scattered
 * `if (type === …)` branches. `shape` drives rendering, `duration` decides
 * whether the object is a bar or a point in time, `fields` drives the
 * type-specific section of the property inspector.
 */
export const TYPES = {
  activity: {
    label: 'Activity',
    group: 'Schedule',
    icon: 'activity',
    shape: 'bar',
    duration: true,
    accent: 'var(--type-activity)',
    defaultDays: 14,
    progress: true,
    fields: ['owner', 'subsystem', 'area', 'status', 'progress'],
  },
  milestone: {
    label: 'Milestone',
    group: 'Schedule',
    icon: 'flag',
    shape: 'diamond',
    duration: false,
    accent: 'var(--type-milestone)',
    defaultDays: 0,
    progress: false,
    fields: ['owner', 'subsystem', 'status'],
  },
  release: {
    label: 'Software Release',
    group: 'Delivery',
    icon: 'package',
    shape: 'release',
    duration: false,
    accent: 'var(--type-release)',
    defaultDays: 0,
    progress: false,
    fields: ['version', 'releaseNumber', 'buildNumber', 'owner', 'subsystem', 'status', 'approval'],
  },
  campaign: {
    label: 'Commissioning Campaign',
    group: 'Commissioning',
    icon: 'target',
    shape: 'bar',
    duration: true,
    accent: 'var(--type-campaign)',
    defaultDays: 21,
    progress: true,
    fields: ['area', 'subsystem', 'testPackage', 'owner', 'actualStart', 'actualEnd', 'progress', 'status'],
  },
  testwindow: {
    label: 'Test Window',
    group: 'Commissioning',
    icon: 'clipboard',
    shape: 'bar',
    duration: true,
    accent: 'var(--type-activity)',
    defaultDays: 10,
    progress: true,
    fields: ['testKind', 'subsystem', 'area', 'owner', 'progress', 'status'],
  },
  freeze: {
    label: 'Freeze Period',
    group: 'Commissioning',
    icon: 'lock',
    shape: 'band',
    duration: true,
    accent: 'var(--type-freeze)',
    defaultDays: 7,
    progress: false,
    fields: ['owner', 'status'],
  },
  outage: {
    label: 'Outage',
    group: 'Operations',
    icon: 'zap',
    shape: 'band',
    duration: true,
    accent: 'var(--type-outage)',
    defaultDays: 2,
    progress: false,
    fields: ['area', 'owner', 'status'],
  },
  maintenance: {
    label: 'Maintenance Window',
    group: 'Operations',
    icon: 'wrench',
    shape: 'band',
    duration: true,
    accent: 'var(--type-outage)',
    defaultDays: 1,
    progress: false,
    fields: ['area', 'owner', 'status'],
  },
  customer: {
    label: 'Customer Activity',
    group: 'Operations',
    icon: 'users',
    shape: 'bar',
    duration: true,
    accent: 'var(--type-campaign)',
    defaultDays: 5,
    progress: true,
    fields: ['owner', 'area', 'status', 'progress'],
  },
  risk: {
    label: 'Risk',
    group: 'Assurance',
    icon: 'alert',
    shape: 'marker',
    duration: false,
    accent: 'var(--type-risk)',
    defaultDays: 0,
    progress: false,
    fields: ['owner', 'subsystem', 'severity', 'likelihood', 'mitigation', 'status'],
  },
  issue: {
    label: 'Open Issue',
    group: 'Assurance',
    icon: 'bug',
    shape: 'marker',
    duration: false,
    accent: 'var(--type-issue)',
    defaultDays: 0,
    progress: false,
    fields: ['owner', 'subsystem', 'severity', 'reference', 'status'],
  },
  decision: {
    label: 'Decision',
    group: 'Assurance',
    icon: 'scale',
    shape: 'marker',
    duration: false,
    accent: 'var(--type-decision)',
    defaultDays: 0,
    progress: false,
    fields: ['owner', 'status', 'reference'],
  },
  document: {
    label: 'Document',
    group: 'Assurance',
    icon: 'file',
    shape: 'marker',
    duration: false,
    accent: 'var(--type-document)',
    defaultDays: 0,
    progress: false,
    fields: ['owner', 'reference', 'status'],
  },
  note: {
    label: 'Sticky Note',
    group: 'Annotation',
    icon: 'comment',
    shape: 'sticky',
    duration: true,
    accent: 'var(--type-note)',
    defaultDays: 10,
    progress: false,
    fields: [],
  },
  callout: {
    label: 'Callout',
    group: 'Annotation',
    icon: 'bulb',
    shape: 'callout',
    duration: true,
    accent: 'var(--type-note)',
    defaultDays: 8,
    progress: false,
    fields: [],
  },
  text: {
    label: 'Text Box',
    group: 'Annotation',
    icon: 'type',
    shape: 'text',
    duration: true,
    accent: 'var(--type-container)',
    defaultDays: 14,
    progress: false,
    fields: [],
  },
  shape: {
    label: 'Shape',
    group: 'Annotation',
    icon: 'square',
    shape: 'shape',
    duration: true,
    accent: 'var(--type-container)',
    defaultDays: 10,
    progress: false,
    fields: [],
  },
  image: {
    label: 'Image',
    group: 'Annotation',
    icon: 'image',
    shape: 'image',
    duration: true,
    accent: 'var(--type-container)',
    defaultDays: 10,
    progress: false,
    fields: [],
  },
  container: {
    label: 'Container',
    group: 'Annotation',
    icon: 'layers',
    shape: 'container',
    duration: true,
    accent: 'var(--type-container)',
    defaultDays: 60,
    progress: false,
    fields: ['owner'],
  },
};

export const TYPE_IDS = Object.keys(TYPES);

/** Types grouped for menus, preserving registry order. */
export function typeGroups() {
  const groups = new Map();
  for (const [id, def] of Object.entries(TYPES)) {
    if (!groups.has(def.group)) groups.set(def.group, []);
    groups.get(def.group).push({ id, ...def });
  }
  return Array.from(groups, ([name, items]) => ({ name, items }));
}

/* ══════════════════════════════════════════════════════════════════════════
   Status vocabulary
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Editable vocabularies.
 *
 * Status, subsystem, test type and the rest are *project data*, not constants:
 * every organisation runs a different set, so the lists below are only the
 * seed. They are copied into `doc.lists` when a project is created, and from
 * then on the user can add, rename, recolour, reorder and delete options —
 * changes that are undoable, autosaved and exported with the plan like
 * anything else.
 *
 * Read them through `listOptions()` / `statusOf()` and friends rather than
 * touching these tables directly, so a project's own edits are honoured.
 */

const DEFAULT_LISTS = {
  status: [
    { id: 'planned', label: 'Planned', color: 'var(--info)', tone: 'info' },
    { id: 'testing', label: 'Testing', color: 'var(--warn)', tone: 'warn' },
    { id: 'inprogress', label: 'In Progress', color: 'var(--warn)', tone: 'warn' },
    { id: 'released', label: 'Released', color: 'var(--good)', tone: 'good' },
    { id: 'complete', label: 'Complete', color: 'var(--good)', tone: 'good' },
    { id: 'delayed', label: 'Delayed', color: 'var(--bad)', tone: 'bad' },
    { id: 'blocked', label: 'Blocked', color: 'var(--bad)', tone: 'bad' },
    { id: 'cancelled', label: 'Cancelled', color: 'var(--neutral)', tone: 'neutral' },
    { id: 'onhold', label: 'On Hold', color: 'var(--neutral)', tone: 'neutral' },
    { id: 'open', label: 'Open', color: 'var(--pending)', tone: 'pending' },
    { id: 'closed', label: 'Closed', color: 'var(--good)', tone: 'good' },
  ],
  subsystem: [
    { id: 'ats', label: 'ATS', color: 'var(--sys-ats)' },
    { id: 'ixl', label: 'IXL', color: 'var(--sys-ixl)' },
    { id: 'scada', label: 'SCADA', color: 'var(--sys-scada)' },
    { id: 'comms', label: 'Communications', color: 'var(--sys-comms)' },
    { id: 'wayside', label: 'Wayside', color: 'var(--sys-wayside)' },
    { id: 'vehicle', label: 'Vehicle', color: 'var(--sys-vehicle)' },
    { id: 'civil', label: 'Civil', color: 'var(--sys-civil)' },
    { id: 'power', label: 'Power', color: 'var(--sys-power)' },
  ],
  testKind: [
    { id: 'static', label: 'Static Testing' },
    { id: 'dynamic', label: 'Dynamic Testing' },
    { id: 'integration', label: 'Integration Testing' },
    { id: 'regression', label: 'Regression Testing' },
    { id: 'sat', label: 'Site Acceptance Testing' },
    { id: 'fat', label: 'Factory Acceptance Testing' },
    { id: 'unit', label: 'Unit / Module Testing' },
  ],
  severity: [
    { id: 'low', label: 'Low', tone: 'good' },
    { id: 'medium', label: 'Medium', tone: 'warn' },
    { id: 'high', label: 'High', tone: 'bad' },
    { id: 'critical', label: 'Critical', tone: 'bad' },
  ],
  approval: [
    { id: 'none', label: 'Not submitted' },
    { id: 'pending', label: 'Pending' },
    { id: 'approved', label: 'Approved' },
    { id: 'rejected', label: 'Rejected' },
  ],
  owner: [],
  area: [],
  font: [
    { id: '', label: 'Interface (default)' },
    { id: "'Archivo', system-ui, sans-serif", label: 'Archivo' },
    { id: "'Roboto Mono', monospace", label: 'Roboto Mono' },
    { id: 'Georgia, serif', label: 'Georgia' },
    { id: "'Times New Roman', serif", label: 'Times New Roman' },
    { id: 'Arial, Helvetica, sans-serif', label: 'Arial' },
    { id: "'Courier New', monospace", label: 'Courier New' },
  ],
};

/**
 * What each editable list is, and where its values live on an object.
 *
 * `field` is a top-level property, `dataKeys` are inside `obj.data`, and
 * `styleKey` is inside `obj.style`. That is what lets the manager count
 * usages and reassign them when an option is deleted.
 */
export const LIST_DEFS = {
  status: {
    label: 'Status',
    field: 'status',
    color: true,
    tone: true,
    required: true,
    hint: 'Drives object colour, the legend and status filters.',
  },
  subsystem: {
    label: 'Subsystem',
    field: 'subsystem',
    color: true,
    hint: 'Rail signalling disciplines — ATS, IXL, SCADA and so on.',
  },
  testKind: {
    label: 'Test type',
    dataKeys: ['testKind'],
    hint: 'Offered on test windows.',
  },
  severity: {
    label: 'Severity & likelihood',
    dataKeys: ['severity', 'likelihood'],
    tone: true,
    hint: 'Shared by both risk fields; a high severity turns its pin red.',
  },
  approval: {
    label: 'Release approval',
    dataKeys: ['approval'],
    hint: 'Approval state on software releases.',
  },
  owner: {
    label: 'Owner',
    field: 'owner',
    freeform: true,
    hint: 'Suggestions offered when typing an owner. Any name is still allowed.',
  },
  area: {
    label: 'Area',
    field: 'area',
    freeform: true,
    hint: 'Suggestions offered when typing an area. Any value is still allowed.',
  },
  font: {
    label: 'Fonts',
    styleKey: 'font',
    hint: 'Font stacks offered in the Text section. Add a corporate font here.',
  },
};

export const LIST_IDS = Object.keys(LIST_DEFS);

/** Semantic tones an option may carry, for badges and chips. */
export const TONES = ['good', 'warn', 'bad', 'info', 'pending', 'neutral'];

/** A fresh copy of the seed lists. */
export function defaultLists() {
  return deepClone(DEFAULT_LISTS);
}

/* ── Active lists ──────────────────────────────────────────────────────────
   The document owns the lists, but they are read from dozens of places that
   have no document to hand (the renderer's colour lookup, the legend, badge
   helpers). Rather than thread the document through all of them, the store
   pushes the current lists here whenever the document changes — the same
   pattern `core/dates.js` uses for date order, and for the same reason: this
   module is low in the graph and must not import upwards.
   ----------------------------------------------------------------------- */

let activeLists = defaultLists();

/** Called by the store after every document change. */
export function syncLists(lists) {
  activeLists = lists && typeof lists === 'object' ? lists : defaultLists();
}

/** Options for a list, in display order. */
export function listOptions(listId) {
  const list = activeLists[listId];
  return Array.isArray(list) ? list : [];
}

/** Just the ids, for filters and menus. */
export function listIds(listId) {
  return listOptions(listId).map((o) => o.id);
}

/** One option, or null when the value is not in the list. */
export function listOption(listId, id) {
  if (id == null) return null;
  return listOptions(listId).find((o) => o.id === id) || null;
}

/**
 * A value's descriptor, with a readable fallback for anything the list does
 * not know about — an imported file may carry statuses this project has never
 * seen, and showing the raw value beats showing nothing.
 */
export function listLabel(listId, id, fallback = '') {
  if (!id) return fallback;
  return listOption(listId, id)?.label || String(id);
}

/** Status descriptor with a safe fallback for unknown values. */
export function statusOf(id) {
  const option = listOption('status', id);
  if (option) return { ...option, tone: option.tone || 'neutral', color: option.color || 'var(--neutral)' };
  return { id, label: id ? String(id) : 'Unset', tone: 'neutral', color: 'var(--neutral)' };
}

export function subsystemOf(id) {
  return listOption('subsystem', id);
}

export function severityOf(id) {
  return listOption('severity', id);
}

/** Where a list's values live on an object — used for counting and reassigning. */
export function listUsage(doc, listId, optionId) {
  const def = LIST_DEFS[listId];
  if (!def) return 0;
  let count = 0;
  for (const obj of doc.objects) {
    if (def.field && obj[def.field] === optionId) count++;
    else if (def.styleKey && (obj.style?.[def.styleKey] ?? '') === optionId) count++;
    else if (def.dataKeys && def.dataKeys.some((k) => (obj.data?.[k] ?? '') === optionId)) count++;
  }
  return count;
}

/** Every distinct value of a list actually present in the document. */
export function listValuesInUse(doc, listId) {
  const def = LIST_DEFS[listId];
  const seen = new Set();
  if (!def) return seen;
  for (const obj of doc.objects) {
    if (def.field && obj[def.field]) seen.add(obj[def.field]);
    if (def.styleKey && obj.style?.[def.styleKey]) seen.add(obj.style[def.styleKey]);
    if (def.dataKeys) for (const k of def.dataKeys) if (obj.data?.[k]) seen.add(obj.data[k]);
  }
  return seen;
}

/** Dependency link types (the four classic precedence relationships). */
export const LINK_TYPES = {
  FS: { label: 'Finish → Start', short: 'FS', from: 'end', to: 'start' },
  SS: { label: 'Start → Start', short: 'SS', from: 'start', to: 'start' },
  FF: { label: 'Finish → Finish', short: 'FF', from: 'end', to: 'end' },
  SF: { label: 'Start → Finish', short: 'SF', from: 'start', to: 'end' },
};

export const CONNECTOR_STYLES = ['orthogonal', 'curved', 'straight'];

/**
 * The relationship described by the two ends a dependency was drawn between.
 *
 * The four types are exactly the four pairs of edges, so a drag from one edge
 * to another names its own type — which is what lets a pair of objects carry
 * more than one dependency: "start together" and "finish together" are two
 * different statements about the same two bars, and a plan routinely makes
 * both. Falls back to FS, the relationship nine links in ten turn out to be.
 */
export function linkTypeBetween(fromSide, toSide) {
  for (const [key, spec] of Object.entries(LINK_TYPES)) {
    if (spec.from === fromSide && spec.to === toSide) return key;
  }
  return 'FS';
}

/* ══════════════════════════════════════════════════════════════════════════
   The P6 register

   A Primavera schedule is the contract programme; this plan is the
   commissioning narrative. They are different documents with different
   owners, so P6 data is held apart from the objects rather than merged into
   them: `doc.p6` is a register keyed by activity ID, and an object points at
   an entry with `data.p6Id`.

   Each activity carries two date sets, because that is how the reviews work:

     baseline   the target programme. Imported once, replaced only by another
                baseline import.
     progress   where it stands now. Re-imported monthly, and what an object
                is compared against.

   Everything else is derived — slip, variance, whether an activity is on the
   timeline, where it sits against today. Nothing derived is ever stored, so
   it cannot go stale, and an import only has to carry four columns.
   ═══════════════════════════════════════════════════════════════════════ */

/** The two kinds of import. A progress import never touches the baseline. */
export const P6_KINDS = ['baseline', 'progress'];

export function emptyRegister() {
  return {
    activities: {},   // activityId → entry
    baseline: null,   // { importedAt, fileName, label, count }
    progress: null,
    history: [],      // the last few imports, newest first
  };
}

/** One activity in the register. Dates are UTC-midnight ms, or null. */
export function makeP6Activity(props = {}) {
  return {
    id: String(props.id || '').trim(),
    name: String(props.name || '').trim(),
    wbs: props.wbs ? String(props.wbs) : '',
    baseline: props.baseline || null,       // { start, end }
    progress: props.progress || null,       // { start, end }
    previous: props.previous || null,       // the progress before the last import
    percent: Number.isFinite(props.percent) ? props.percent : null,
    status: props.status ? String(props.status) : '',
    order: Number.isFinite(props.order) ? props.order : 0,
    missing: !!props.missing,               // in an earlier import, not the latest
    firstSeen: props.firstSeen || Date.now(),
  };
}

/** The register, guaranteed to be the right shape. */
export function p6Register(doc) {
  const p6 = doc?.p6;
  if (!p6 || typeof p6 !== 'object') return emptyRegister();
  return {
    activities: p6.activities && typeof p6.activities === 'object' ? p6.activities : {},
    baseline: p6.baseline || null,
    progress: p6.progress || null,
    history: Array.isArray(p6.history) ? p6.history : [],
  };
}

export function p6Activity(doc, activityId) {
  if (!activityId) return null;
  return p6Register(doc).activities[String(activityId)] || null;
}

export function p6Count(doc) {
  return Object.keys(p6Register(doc).activities).length;
}

/**
 * The dates an activity is currently understood to hold: its progress if a
 * progress import has been taken, otherwise its baseline. A register with
 * only a baseline is still useful, and this is what makes that true.
 */
export function p6Dates(activity) {
  if (!activity) return null;
  return activity.progress || activity.baseline || null;
}

/** How far P6 has moved its own activity since the baseline, in days. */
export function p6Slip(activity) {
  if (!activity?.baseline || !activity?.progress) return null;
  const startShift = Math.round((activity.progress.start - activity.baseline.start) / MS_DAY);
  const finishShift = Math.round((activity.progress.end - activity.baseline.end) / MS_DAY);
  return { startShift, finishShift, slipped: finishShift > 0, changed: startShift !== 0 || finishShift !== 0 };
}

/**
 * The activities an object is tracked against.
 *
 * One bar on a commissioning plan is routinely a dozen P6 activities — a
 * campaign, a test package, a zone handover — so the link is a set. The
 * singular `p6Id` written by the first version is still read, so nothing
 * placed before this needs touching.
 */
export function p6LinkedIds(obj) {
  const data = obj?.data;
  if (!data) return [];
  if (Array.isArray(data.p6Ids)) return data.p6Ids.filter(Boolean);
  return data.p6Id ? [data.p6Id] : [];
}

/**
 * The dates an object's linked activities span.
 *
 * Earliest start to latest finish, because a bar standing for twelve
 * activities has to cover all of them — reporting only the first would show a
 * campaign finishing while most of its work was outstanding.
 *
 * @param {string} [side]  'baseline' | 'progress'; omitted takes whichever
 *                         each activity currently holds.
 */
export function p6RollUp(doc, obj, side = null) {
  const register = p6Register(doc);
  let start = null;
  let end = null;
  let count = 0;
  let missing = 0;

  for (const id of p6LinkedIds(obj)) {
    const activity = register.activities[id];
    if (!activity) {
      missing++;
      continue;
    }
    const dates = side ? activity[side] : p6Dates(activity);
    if (!dates) continue;
    start = start == null ? dates.start : Math.min(start, dates.start);
    end = end == null ? dates.end : Math.max(end, dates.end);
    count++;
  }

  if (!count) return null;
  return { start, end, count, missing };
}

/**
 * How far the plan differs from P6, in days.
 *
 * Measured against everything the object is linked to, rolled up — the
 * question is "is this bar where P6 says the work is", not "does it match one
 * particular activity".
 */
export function p6Variance(doc, obj) {
  const dates = p6RollUp(doc, obj);
  if (!obj || !dates) return null;
  const hasDuration = !!TYPES[obj.type]?.duration;
  const startShift = Math.round((obj.start - dates.start) / MS_DAY);
  const finishShift = hasDuration ? Math.round((obj.end - dates.end) / MS_DAY) : startShift;
  return {
    startShift,
    finishShift,
    behind: finishShift > 0,
    differs: startShift !== 0 || finishShift !== 0,
    count: dates.count,
  };
}

/**
 * Where an activity sits against today.
 *
 * This is deliberately *not* called status. Dates cannot tell you whether
 * work happened — an activity whose finish has passed may be complete or may
 * never have started — so this reports the schedule position and leaves
 * status to the object, where a person sets it.
 */
export function p6Position(activity, today = todayMs()) {
  const dates = p6Dates(activity);
  if (!dates) return 'unknown';
  if (dates.end < today) return 'past';
  if (dates.start > today) return 'future';
  return 'current';
}

/** A milestone in P6 has no duration: start and finish are the same day. */
export function p6IsMilestone(activity) {
  const dates = p6Dates(activity);
  return !!dates && dates.start === dates.end;
}

/** Objects on the timeline that point at a given activity. */
export function p6Placed(doc, activityId) {
  if (!activityId) return [];
  return doc.objects.filter((o) => p6LinkedIds(o).includes(activityId));
}

/**
 * The comparison rows for a baseline.
 *
 * A baseline taken by hand is a snapshot: a frozen copy of where things were,
 * and it must never change. A baseline that *tracks P6* is the opposite — it
 * has to answer for whatever is linked right now, so linking another activity
 * updates the comparison without anyone re-taking anything.
 *
 * So the P6 ones store no rows at all. They are a marker saying which side of
 * the register to read, and the rows are computed here on demand. That is the
 * same rule the rest of the application follows: derived state is not stored,
 * so it cannot go stale.
 */
export function baselineSnapshot(doc, baseline) {
  if (!baseline) return [];
  if (baseline.source !== 'p6') return baseline.snapshot || [];

  const side = baseline.p6Kind === 'progress' ? 'progress' : 'baseline';
  const rows = [];

  for (const obj of doc.objects) {
    if (!p6LinkedIds(obj).length) continue;
    const dates = p6RollUp(doc, obj, side);
    if (!dates) continue;

    rows.push({
      id: obj.id,
      title: obj.title,
      lane: obj.lane,
      start: dates.start,
      end: TYPES[obj.type]?.duration ? dates.end : dates.start,
      progress: 0,
      status: obj.status,
    });
  }
  return rows;
}

/** True when a baseline follows the P6 register rather than a frozen copy. */
export function isDerivedBaseline(baseline) {
  return baseline?.source === 'p6';
}

/**
 * Why an object no longer sits where the baseline had it.
 *
 * A comparison shows *that* something moved and by how many days; the one
 * thing the PMO asks next — why — is the only part of it that cannot be
 * derived, so it is stored, on the object, keyed by the baseline it answers
 * for. Keyed rather than a single field because a plan is routinely compared
 * against more than one baseline, and "waiting on the client's power-up" is
 * the reason against the March freeze, not against the P6 progress import.
 *
 * The P6 baselines keep stable ids (`bl_p6_baseline` / `bl_p6_progress`), so a
 * reason written against one survives the next import re-creating it.
 */
export function delayReason(obj, baselineId) {
  if (!obj || !baselineId) return '';
  const reasons = obj.data?.delayReasons;
  return reasons && typeof reasons === 'object' ? String(reasons[baselineId] || '') : '';
}

/** The marker for a P6-tracking baseline. Holds no rows on purpose. */
export function makeP6Baseline(kind) {
  const progress = kind === 'progress';
  return {
    id: `bl_p6_${kind}`,
    name: progress ? 'P6 — current progress' : 'P6 — baseline',
    created: Date.now(),
    source: 'p6',
    p6Kind: progress ? 'progress' : 'baseline',
    note: progress
      ? 'Follows the latest progress import, for every linked activity.'
      : 'Follows the imported P6 baseline, for every linked activity.',
    snapshot: [],
  };
}

/** Every activity id the plan currently references. */
export function p6PlacedIds(doc) {
  const ids = new Set();
  for (const obj of doc.objects) for (const id of p6LinkedIds(obj)) ids.add(id);
  return ids;
}

/* ══════════════════════════════════════════════════════════════════════════
   Factories
   ═══════════════════════════════════════════════════════════════════════ */

/** Default appearance applied to every new object. */
export function defaultStyle(type = 'activity') {
  return {
    fill: '',            // '' = inherit the type accent
    stroke: '',
    strokeWidth: 1,
    radius: 6,
    opacity: 1,
    shadow: false,
    gradient: false,
    pattern: 'none',     // none | stripes | hatch | dots | grid
    textColor: '',
    font: '',            // '' = inherit --f-ui
    fontSize: 12,
    bold: type === 'milestone' || type === 'release',
    italic: false,
    underline: false,
    align: 'left',
    rotation: 0,
  };
}

/** Create a timeline object with every field the renderer expects present. */
export function makeObject(props = {}) {
  const type = TYPES[props.type] ? props.type : 'activity';
  const def = TYPES[type];
  const start = Number.isFinite(props.start) ? props.start : todayMs();
  const end = def.duration
    ? Number.isFinite(props.end)
      ? Math.max(props.end, start + MS_DAY)
      : addDays(start, def.defaultDays || 1)
    : start;

  return {
    id: props.id || uid('obj'),
    type,
    lane: props.lane || null,
    start,
    end,
    row: props.row ?? 0,             // stacking row within the lane
    title: props.title ?? def.label,
    subtitle: props.subtitle ?? '',
    icon: props.icon ?? def.icon,
    status: props.status ?? (type === 'risk' || type === 'issue' ? 'open' : 'planned'),
    progress: clamp(props.progress ?? 0, 0, 100),
    owner: props.owner ?? '',
    subsystem: props.subsystem ?? '',
    area: props.area ?? '',
    tags: Array.isArray(props.tags) ? props.tags.slice() : [],
    notes: props.notes ?? '',
    attachments: Array.isArray(props.attachments) ? props.attachments.slice() : [],
    links: [],                       // reserved: computed link cache, never persisted
    locked: !!props.locked,
    hidden: !!props.hidden,
    z: Number.isFinite(props.z) ? props.z : 0,
    groupId: props.groupId ?? null,
    style: { ...defaultStyle(type), ...(props.style || {}) },
    data: { ...(props.data || {}) },
    created: props.created ?? Date.now(),
    modified: props.modified ?? Date.now(),
  };
}

export function makeLane(props = {}) {
  return {
    id: props.id || uid('lane'),
    name: props.name ?? 'New Lane',
    color: props.color ?? '#5b93f5',
    height: clamp(props.height ?? 64, 28, 480),
    hidden: !!props.hidden,
    locked: !!props.locked,
    collapsed: !!props.collapsed,
    group: props.group ?? '',
    description: props.description ?? '',
  };
}

export function makeLink(props = {}) {
  return {
    id: props.id || uid('link'),
    from: props.from,
    to: props.to,
    type: LINK_TYPES[props.type] ? props.type : 'FS',
    style: CONNECTOR_STYLES.includes(props.style) ? props.style : '',
    lag: Number.isFinite(props.lag) ? props.lag : 0, // in days
    label: props.label ?? '',
    color: props.color ?? '',
    critical: false, // recomputed, never authoritative on disk
    // A user choice, not derived — but not a durable one either: it is cleared
    // the moment this link is violated (see installHiddenLinkGuard in main.js),
    // so a dependency that breaks always reappears and has to be hidden again.
    hidden: !!props.hidden,
  };
}

export function makeBaseline(doc, name) {
  return {
    id: uid('bl'),
    name: name || `Baseline ${new Date().toISOString().slice(0, 10)}`,
    created: Date.now(),
    note: '',
    snapshot: doc.objects.map((o) => ({
      id: o.id,
      title: o.title,
      lane: o.lane,
      start: o.start,
      end: o.end,
      progress: o.progress,
      status: o.status,
    })),
  };
}

/** Default project settings. */
export function defaultSettings() {
  return {
    theme: 'dark',
    snap: 'day',                 // off | day | week | month | quarter | workday
    weekStart: 1,                // 1 = Monday
    gridlines: true,
    gridDensity: 'auto',         // auto | minor | major | off
    showWeekends: true,
    showToday: true,
    todayOverride: null,         // ISO date string to simulate a planning date
    connectorStyle: 'orthogonal',
    showConnectors: true,
    showMinimap: true,
    showLegend: true,
    showProgress: true,
    filterMode: 'dim',           // dim | hide — what happens to filtered-out objects
    // How a drawn export (SVG/PNG/JPEG/PDF/print) is composed. Kept with the
    // document so a plan exports the same way for whoever opens it.
    exportOptions: {
      showDates: true,
      showLinks: true,
      showLegend: true,
      showGrid: true,
      showToday: true,
      showProgress: true,
      // showBaseline / baselineId are deliberately absent: until someone
      // chooses, an export matches what is on screen. See exportSettings().
      respectFilters: true,
      range: 'all',              // all | visible
      density: 'fit',            // fit | compact | detailed
    },
    showBaseline: false,
    activeBaseline: null,
    criticalPath: false,
    laneLabels: true,
    dateOrder: 'mdy',            // mdy | dmy | ymd — display order only
    autoBackupMinutes: 60,
    backupEveryEdits: 100,
    backupKeep: 20,
    holidays: [],
    zoomPxPerDay: 3.2,
    originMs: null,              // left edge of the viewport (ms); null = auto
  };
}

/** A brand-new, empty-but-usable project. */
export function makeProject(name = 'Untitled Programme') {
  const start = startOfMonth(todayMs());
  return {
    schema: SCHEMA_VERSION,
    id: uid('proj'),
    name,
    description: '',
    client: '',
    programme: '',
    created: Date.now(),
    modified: Date.now(),
    settings: defaultSettings(),
    lists: defaultLists(),
    p6: emptyRegister(),
    laneOrder: [],
    lanes: [],
    objects: [],
    links: [],
    baselines: [],
    groups: [],
    attachments: [],
    versions: [],
    meta: {
      editCount: 0,
      viewStart: start,
      viewEnd: addMonths(start, 12),
    },
  };
}

/**
 * A realistic starter project. New users open the app to something that
 * demonstrates the vocabulary — lanes, releases, campaigns, risks, links —
 * rather than an empty grid they have to guess their way into.
 */
export function makeStarterProject() {
  const doc = makeProject('Line 1 — Signalling Commissioning');
  doc.client = 'Metro Authority';
  doc.programme = 'CBTC Deployment · Phase 2';
  doc.description = 'Software release, testing and commissioning plan for the Phase 2 signalling deployment.';

  const laneSpec = [
    ['Software Releases', '#5b93f5'],
    ['Regression Testing', '#a855f7'],
    ['ATS', '#3a76e8'],
    ['IXL', '#9333d9'],
    ['SCADA', '#0d9488'],
    ['Communications', '#0ea5e9'],
    ['Wayside', '#e0900b'],
    ['Vehicle', '#e51b22'],
    ['Commissioning', '#16a571'],
    ['Customer', '#64748b'],
    ['Risks & Issues', '#f97316'],
  ];
  doc.lanes = laneSpec.map(([name, color]) => makeLane({ name, color, height: name === 'Risks & Issues' ? 54 : 64 }));
  doc.laneOrder = doc.lanes.map((l) => l.id);
  const lane = (n) => doc.lanes[n].id;

  const base = startOfMonth(todayMs());
  const D = (offsetDays) => addDays(base, offsetDays);

  const objs = [
    makeObject({ type: 'release', lane: lane(0), start: D(10), title: 'R2.4.0', status: 'released', owner: 'A. Okafor', subsystem: 'ats', data: { version: '2.4.0', releaseNumber: 'REL-024', buildNumber: '2.4.0-b118', approval: 'approved' } }),
    makeObject({ type: 'release', lane: lane(0), start: D(52), title: 'R2.5.0', status: 'testing', owner: 'A. Okafor', subsystem: 'ats', data: { version: '2.5.0', releaseNumber: 'REL-025', buildNumber: '2.5.0-rc3', approval: 'pending' } }),
    makeObject({ type: 'release', lane: lane(0), start: D(96), title: 'R2.6.0', status: 'planned', owner: 'A. Okafor', subsystem: 'ixl', data: { version: '2.6.0', releaseNumber: 'REL-026', buildNumber: '—', approval: 'none' } }),
    makeObject({ type: 'testwindow', lane: lane(1), start: D(14), end: D(34), title: 'Regression Cycle 4', status: 'complete', progress: 100, owner: 'M. Haddad', data: { testKind: 'regression' } }),
    makeObject({ type: 'testwindow', lane: lane(1), start: D(56), end: D(78), title: 'Regression Cycle 5', status: 'testing', progress: 42, owner: 'M. Haddad', data: { testKind: 'regression' } }),
    makeObject({ type: 'activity', lane: lane(2), start: D(6), end: D(46), title: 'ATS Integration Testing', subsystem: 'ats', status: 'inprogress', progress: 68, owner: 'L. Fontaine' }),
    makeObject({ type: 'activity', lane: lane(3), start: D(20), end: D(70), title: 'IXL Static Testing', subsystem: 'ixl', status: 'inprogress', progress: 35, owner: 'D. Vasquez' }),
    makeObject({ type: 'activity', lane: lane(4), start: D(30), end: D(64), title: 'SCADA Interface Verification', subsystem: 'scada', status: 'planned', progress: 0, owner: 'R. Bianchi' }),
    makeObject({ type: 'activity', lane: lane(5), start: D(0), end: D(40), title: 'Radio Coverage Survey', subsystem: 'comms', status: 'inprogress', progress: 80, owner: 'S. Njoroge' }),
    makeObject({ type: 'activity', lane: lane(6), start: D(24), end: D(88), title: 'Wayside Equipment Installation', subsystem: 'wayside', status: 'inprogress', progress: 45, owner: 'P. Lindqvist' }),
    makeObject({ type: 'activity', lane: lane(7), start: D(44), end: D(92), title: 'Onboard Retrofit — Fleet A', subsystem: 'vehicle', status: 'planned', progress: 0, owner: 'K. Ibrahim' }),
    // Dates satisfy every dependency below: the campaign starts after its
    // latest predecessor (Wayside installation, D88) finishes. A shipped
    // sample plan should not open with broken constraints.
    makeObject({ type: 'campaign', lane: lane(8), start: D(90), end: D(130), title: 'Dynamic Testing Campaign 1', status: 'planned', progress: 0, owner: 'J. Moreau', subsystem: 'ats', area: 'Depot → Station 6', data: { testPackage: 'TP-DYN-01' } }),
    makeObject({ type: 'campaign', lane: lane(8), start: D(136), end: D(176), title: 'Site Acceptance Testing', status: 'planned', progress: 0, owner: 'J. Moreau', area: 'Full alignment', data: { testPackage: 'TP-SAT-01' } }),
    makeObject({ type: 'milestone', lane: lane(8), start: D(180), title: 'Provisional Acceptance', status: 'planned', owner: 'Programme' }),
    makeObject({ type: 'freeze', lane: lane(0), start: D(88), end: D(102), title: 'Code Freeze', status: 'planned' }),
    makeObject({ type: 'customer', lane: lane(9), start: D(140), end: D(152), title: 'Customer Witness Testing', status: 'planned', owner: 'Metro Authority' }),
    makeObject({ type: 'outage', lane: lane(9), start: D(72), end: D(75), title: 'Traction Power Outage', status: 'planned', area: 'Sector 3' }),
    makeObject({ type: 'risk', lane: lane(10), start: D(58), title: 'Vehicle availability for dynamic testing', status: 'open', owner: 'J. Moreau', data: { severity: 'high', likelihood: 'medium', mitigation: 'Secure two additional test slots with Operations.' } }),
    makeObject({ type: 'issue', lane: lane(10), start: D(36), title: 'IXL-1184 · Route locking timeout', status: 'open', owner: 'D. Vasquez', data: { severity: 'critical', reference: 'IXL-1184' } }),
  ];
  doc.objects = objs;

  doc.links = [
    makeLink({ from: objs[1].id, to: objs[4].id, type: 'FS' }),
    makeLink({ from: objs[4].id, to: objs[11].id, type: 'FS' }),
    makeLink({ from: objs[11].id, to: objs[12].id, type: 'FS' }),
    makeLink({ from: objs[12].id, to: objs[13].id, type: 'FS' }),
    makeLink({ from: objs[6].id, to: objs[11].id, type: 'FS' }),
    makeLink({ from: objs[9].id, to: objs[11].id, type: 'FS' }),
  ];

  doc.meta.viewStart = D(-14);
  doc.meta.viewEnd = D(200);
  return doc;
}

/* ══════════════════════════════════════════════════════════════════════════
   Normalisation & migration
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Migration steps, applied in order for any document older than
 * SCHEMA_VERSION. Each step takes a document and returns the next shape.
 * Never delete a step — old files must always be able to walk forward.
 */
const MIGRATIONS = [
  // v0 → v1: the initial released schema. Documents written by pre-release
  // builds carried dates as ISO strings and had no `row` on objects.
  (doc) => {
    (doc.objects || []).forEach((o) => {
      if (typeof o.start === 'string') o.start = toMs(o.start);
      if (typeof o.end === 'string') o.end = toMs(o.end);
      if (o.row == null) o.row = 0;
    });
    doc.schema = 1;
    return doc;
  },

  // v1 → v2: status, subsystem, test type, severity, approval and the font
  // menu became editable project data. `normalise()` seeds the lists and
  // adopts any value the document already uses, so nothing is lost.
  (doc) => {
    if (!doc.lists) doc.lists = defaultLists();
    doc.schema = 2;
    return doc;
  },

  // v2 → v3: the P6 register. Nothing to convert — an older plan simply has
  // no imported schedule yet.
  (doc) => {
    if (!doc.p6) doc.p6 = emptyRegister();
    doc.schema = 3;
    return doc;
  },

  // v3 → v4: an object may track several P6 activities, not one. A bar that
  // stands for a campaign is routinely a dozen of them.
  (doc) => {
    for (const obj of doc.objects || []) {
      if (!obj.data) continue;
      if (Array.isArray(obj.data.p6Ids)) continue;
      obj.data.p6Ids = obj.data.p6Id ? [obj.data.p6Id] : [];
      delete obj.data.p6Id;
    }
    doc.schema = 4;
    return doc;
  },
];

/**
 * Bring any document — freshly parsed, imported, or restored from a backup —
 * up to the current schema and guarantee every field the renderer touches
 * exists. This is the single gate every document passes through.
 */
export function normalise(input) {
  let doc = input && typeof input === 'object' ? deepClone(input) : makeProject();

  const from = Number.isFinite(doc.schema) ? doc.schema : 0;
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (step) doc = step(doc);
  }

  const base = makeProject(doc.name || 'Untitled Programme');
  doc.schema = SCHEMA_VERSION;
  doc.id = doc.id || base.id;
  doc.name = doc.name || base.name;
  doc.description = doc.description ?? '';
  doc.client = doc.client ?? '';
  doc.programme = doc.programme ?? '';
  doc.created = doc.created || Date.now();
  doc.modified = doc.modified || Date.now();
  doc.settings = { ...defaultSettings(), ...(doc.settings || {}) };
  doc.lists = normaliseLists(doc);
  doc.p6 = normaliseRegister(doc);
  doc.baselines = Array.isArray(doc.baselines) ? doc.baselines : [];
  doc.groups = Array.isArray(doc.groups) ? doc.groups : [];
  doc.attachments = Array.isArray(doc.attachments) ? doc.attachments : [];
  doc.versions = Array.isArray(doc.versions) ? doc.versions : [];
  doc.meta = { editCount: 0, ...(doc.meta || {}) };

  doc.lanes = (Array.isArray(doc.lanes) ? doc.lanes : []).map((l) => makeLane(l));
  const laneIds = new Set(doc.lanes.map((l) => l.id));

  // laneOrder is authoritative for display order; repair it against the lanes.
  const order = Array.isArray(doc.laneOrder) ? doc.laneOrder.filter((id) => laneIds.has(id)) : [];
  for (const l of doc.lanes) if (!order.includes(l.id)) order.push(l.id);
  doc.laneOrder = order;

  const fallbackLane = doc.lanes[0] ? doc.lanes[0].id : null;
  doc.objects = (Array.isArray(doc.objects) ? doc.objects : []).map((o) => {
    const obj = makeObject(o);
    if (!laneIds.has(obj.lane)) obj.lane = fallbackLane;
    return obj;
  });

  const objIds = new Set(doc.objects.map((o) => o.id));
  doc.links = (Array.isArray(doc.links) ? doc.links : [])
    .map((l) => makeLink(l))
    .filter((l) => objIds.has(l.from) && objIds.has(l.to) && l.from !== l.to);

  return doc;
}

/**
 * Repair the document's vocabularies.
 *
 * Missing lists are seeded from the defaults, malformed options are dropped,
 * and — importantly — any value the objects actually use but the list does
 * not contain is adopted into it. An imported plan carrying an unfamiliar
 * status therefore keeps working and becomes editable, rather than silently
 * reading as an unknown value forever.
 */
/**
 * Bring the P6 register to a known shape.
 *
 * Entries are keyed by activity ID, which is the only stable identifier P6
 * gives us — names get edited, dates move, but the ID survives. Anything
 * without one is dropped, because it could never be matched on re-import.
 */
function normaliseRegister(doc) {
  const raw = doc?.p6;
  const out = emptyRegister();
  if (!raw || typeof raw !== 'object') return out;

  out.baseline = raw.baseline || null;
  out.progress = raw.progress || null;
  out.history = Array.isArray(raw.history) ? raw.history.slice(0, 12) : [];

  const source = raw.activities && typeof raw.activities === 'object' ? raw.activities : {};
  for (const [key, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object') continue;
    const id = String(value.id || key || '').trim();
    if (!id) continue;
    out.activities[id] = makeP6Activity({ ...value, id });
  }
  return out;
}

function normaliseLists(doc) {
  const seeds = defaultLists();
  const out = {};

  for (const listId of LIST_IDS) {
    const incoming = Array.isArray(doc.lists?.[listId]) ? doc.lists[listId] : seeds[listId];
    const seen = new Set();
    const options = [];

    for (const raw of incoming || []) {
      if (!raw || typeof raw !== 'object') continue;
      const id = raw.id === '' ? '' : String(raw.id ?? '').trim();
      if (raw.id == null || seen.has(id)) continue;
      seen.add(id);
      options.push({
        id,
        label: String(raw.label ?? id) || '(unnamed)',
        ...(raw.color ? { color: raw.color } : {}),
        ...(raw.tone ? { tone: raw.tone } : {}),
      });
    }

    // Adopt in-use values that are not in the list.
    for (const value of listValuesInUse(doc, listId)) {
      if (!seen.has(value)) {
        seen.add(value);
        options.push({ id: value, label: String(value) });
      }
    }

    out[listId] = options;
  }

  return out;
}

/**
 * Structural validation used by the importer. Returns
 * `{ ok, errors: [], warnings: [] }` — errors block, warnings don't.
 */
export function validate(doc) {
  const errors = [];
  const warnings = [];

  if (!doc || typeof doc !== 'object') {
    return { ok: false, errors: ['File does not contain a JSON object.'], warnings };
  }
  if (!Array.isArray(doc.objects)) errors.push('Missing "objects" array.');
  if (!Array.isArray(doc.lanes)) errors.push('Missing "lanes" array.');
  if (Number.isFinite(doc.schema) && doc.schema > SCHEMA_VERSION) {
    errors.push(`File uses schema v${doc.schema}; this build understands up to v${SCHEMA_VERSION}. Update the application.`);
  }

  if (Array.isArray(doc.objects)) {
    const laneIds = new Set((doc.lanes || []).map((l) => l.id));
    let orphans = 0;
    let badDates = 0;
    for (const o of doc.objects) {
      if (o.lane && !laneIds.has(o.lane)) orphans++;
      if (!Number.isFinite(toMs(o.start))) badDates++;
    }
    if (orphans) warnings.push(`${orphans} object(s) reference a missing lane — they will move to the first lane.`);
    if (badDates) warnings.push(`${badDates} object(s) have an unreadable start date — they will default to today.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/* ══════════════════════════════════════════════════════════════════════════
   Derived helpers
   ═══════════════════════════════════════════════════════════════════════ */

/** The effective "today" — the system date unless the user has pinned one. */
export function effectiveToday(doc) {
  const override = doc?.settings?.todayOverride;
  if (override) {
    const ms = toMs(override);
    if (Number.isFinite(ms)) return ms;
  }
  return todayMs();
}

/** Duration in days (bars are half-open: start inclusive, end exclusive). */
export function durationDays(obj) {
  if (!TYPES[obj.type]?.duration) return 0;
  return Math.max(0, Math.round((obj.end - obj.start) / MS_DAY));
}

/** Remaining duration in days given percent complete. */
export function remainingDays(obj) {
  const total = durationDays(obj);
  return Math.max(0, Math.round(total * (1 - (obj.progress || 0) / 100)));
}

/** Resolve the accent colour for an object: explicit fill → status → type. */
export function objectColor(obj, lane) {
  if (obj.style?.fill) return obj.style.fill;
  const status = listOption('status', obj.status);
  if (obj.type === 'release' && status?.color) return status.color;
  if (lane?.color && (obj.type === 'activity' || obj.type === 'testwindow')) return lane.color;
  return TYPES[obj.type]?.accent || 'var(--type-activity)';
}

/** Object bounds in ms, always with end > start so hit-testing works. */
export function objectRange(obj) {
  const hasDuration = TYPES[obj.type]?.duration;
  return { start: obj.start, end: hasDuration ? Math.max(obj.end, obj.start + MS_DAY) : obj.start };
}

/** Extent of the whole project, padded, for fit-to-window and the minimap. */
export function projectExtent(doc) {
  if (!doc.objects.length) {
    const t = effectiveToday(doc);
    return { start: addDays(t, -30), end: addDays(t, 180) };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const o of doc.objects) {
    const r = objectRange(o);
    if (r.start < min) min = r.start;
    if (r.end > max) max = r.end;
  }
  const pad = Math.max(MS_DAY * 7, (max - min) * 0.04);
  return { start: min - pad, end: max + pad };
}

/** Every distinct owner in the document, sorted. */
export function ownersOf(doc) {
  return Array.from(new Set(doc.objects.map((o) => o.owner).filter(Boolean))).sort();
}

/** Every distinct area in the document, sorted. */
export function areasOf(doc) {
  return Array.from(new Set(doc.objects.map((o) => o.area).filter(Boolean))).sort();
}

/** Every distinct tag in the document, sorted. */
export function tagsOf(doc) {
  const set = new Set();
  for (const o of doc.objects) for (const t of o.tags || []) set.add(t);
  return Array.from(set).sort();
}

/** ISO date export helper used by CSV/PDF writers. */
export function isoOf(ms) {
  return toISO(ms);
}
