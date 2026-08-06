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
export const SCHEMA_VERSION = 1;

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
 * Statuses are shared across object types so the legend, filters and colour
 * coding all speak one language. `tone` maps onto the semantic colour tokens.
 */
export const STATUSES = {
  planned: { label: 'Planned', tone: 'info', color: 'var(--info)' },
  testing: { label: 'Testing', tone: 'warn', color: 'var(--warn)' },
  inprogress: { label: 'In Progress', tone: 'warn', color: 'var(--warn)' },
  released: { label: 'Released', tone: 'good', color: 'var(--good)' },
  complete: { label: 'Complete', tone: 'good', color: 'var(--good)' },
  delayed: { label: 'Delayed', tone: 'bad', color: 'var(--bad)' },
  blocked: { label: 'Blocked', tone: 'bad', color: 'var(--bad)' },
  cancelled: { label: 'Cancelled', tone: 'neutral', color: 'var(--neutral)' },
  onhold: { label: 'On Hold', tone: 'neutral', color: 'var(--neutral)' },
  open: { label: 'Open', tone: 'pending', color: 'var(--pending)' },
  closed: { label: 'Closed', tone: 'good', color: 'var(--good)' },
};

export const STATUS_IDS = Object.keys(STATUSES);

/** The five release statuses the brief calls out, in presentation order. */
export const RELEASE_STATUSES = ['planned', 'testing', 'released', 'delayed', 'cancelled'];

export const SEVERITIES = {
  low: { label: 'Low', tone: 'good' },
  medium: { label: 'Medium', tone: 'warn' },
  high: { label: 'High', tone: 'bad' },
  critical: { label: 'Critical', tone: 'bad' },
};

export const APPROVALS = {
  none: { label: 'Not submitted' },
  pending: { label: 'Pending' },
  approved: { label: 'Approved' },
  rejected: { label: 'Rejected' },
};

/** Rail signalling subsystems — the tag vocabulary for commissioning work. */
export const SUBSYSTEMS = [
  { id: 'ats', label: 'ATS', color: 'var(--sys-ats)' },
  { id: 'ixl', label: 'IXL', color: 'var(--sys-ixl)' },
  { id: 'scada', label: 'SCADA', color: 'var(--sys-scada)' },
  { id: 'comms', label: 'Communications', color: 'var(--sys-comms)' },
  { id: 'wayside', label: 'Wayside', color: 'var(--sys-wayside)' },
  { id: 'vehicle', label: 'Vehicle', color: 'var(--sys-vehicle)' },
  { id: 'civil', label: 'Civil', color: 'var(--sys-civil)' },
  { id: 'power', label: 'Power', color: 'var(--sys-power)' },
];

export const TEST_KINDS = [
  { id: 'static', label: 'Static Testing' },
  { id: 'dynamic', label: 'Dynamic Testing' },
  { id: 'integration', label: 'Integration Testing' },
  { id: 'regression', label: 'Regression Testing' },
  { id: 'sat', label: 'Site Acceptance Testing' },
  { id: 'fat', label: 'Factory Acceptance Testing' },
  { id: 'unit', label: 'Unit / Module Testing' },
];

/** Dependency link types (the four classic precedence relationships). */
export const LINK_TYPES = {
  FS: { label: 'Finish → Start', short: 'FS', from: 'end', to: 'start' },
  SS: { label: 'Start → Start', short: 'SS', from: 'start', to: 'start' },
  FF: { label: 'Finish → Finish', short: 'FF', from: 'end', to: 'end' },
  SF: { label: 'Start → Finish', short: 'SF', from: 'start', to: 'end' },
};

export const CONNECTOR_STYLES = ['orthogonal', 'curved', 'straight'];

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
  if (obj.type === 'release' && STATUSES[obj.status]) return STATUSES[obj.status].color;
  if (lane?.color && (obj.type === 'activity' || obj.type === 'testwindow')) return lane.color;
  return TYPES[obj.type]?.accent || 'var(--type-activity)';
}

/** Status descriptor with a safe fallback for unknown values. */
export function statusOf(id) {
  return STATUSES[id] || { label: id || 'Unset', tone: 'neutral', color: 'var(--neutral)' };
}

export function subsystemOf(id) {
  return SUBSYSTEMS.find((s) => s.id === id) || null;
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
