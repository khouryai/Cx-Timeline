/**
 * Schedule analysis: critical path, float, baseline variance and slip.
 *
 * The dependency graph is a DAG (the store refuses links that would close a
 * loop), so the classic forward/backward pass applies directly. Durations come
 * from the objects themselves rather than from a separate calendar, which
 * keeps the analysis honest: what you see on the bar is what is analysed.
 *
 * Imports: dates, model.
 */

import { MS_DAY, daysBetween, workingDaysBetween } from './dates.js';
import { TYPES, LINK_TYPES, effectiveToday, baselineSnapshot } from './model.js';

/* ══════════════════════════════════════════════════════════════════════════
   Memoisation

   The store never mutates a document in place — every write produces a new
   object graph — so document identity is a perfect cache key. A WeakMap keyed
   on the document gives free invalidation (a new document misses) and free
   eviction (old documents are collected), with no revision counter to keep in
   step. This matters because violations are re-read on every rendered frame
   of a drag, by the renderer, the inspector, the panels and the status bar.
   ═══════════════════════════════════════════════════════════════════════ */

const criticalCache = new WeakMap();
const violationCache = new WeakMap();

/* ══════════════════════════════════════════════════════════════════════════
   Dependency constraints
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Evaluate one dependency.
 *
 * Each relationship pins one date of the successor against one date of the
 * predecessor, offset by the link's lag (negative lag is a lead, and relaxes
 * the constraint):
 *
 *   FS  successor starts  ≥ predecessor finishes + lag
 *   SS  successor starts  ≥ predecessor starts   + lag
 *   FF  successor finishes ≥ predecessor finishes + lag
 *   SF  successor finishes ≥ predecessor starts   + lag
 *
 * `slackDays` is how much room is left: zero is exactly tight, negative means
 * the plan is now impossible by that many days.
 */
export function evaluateLink(link, predecessor, successor) {
  if (!predecessor || !successor) return null;

  const lag = (link.lag || 0) * MS_DAY;
  const predStart = predecessor.start;
  const predEnd = TYPES[predecessor.type]?.duration ? predecessor.end : predecessor.start;
  const succStart = successor.start;
  const succEnd = TYPES[successor.type]?.duration ? successor.end : successor.start;

  let required;
  let actual;
  let edge;

  switch ((LINK_TYPES[link.type] || LINK_TYPES.FS).short) {
    case 'SS':
      required = predStart + lag;
      actual = succStart;
      edge = 'start';
      break;
    case 'FF':
      required = predEnd + lag;
      actual = succEnd;
      edge = 'end';
      break;
    case 'SF':
      required = predStart + lag;
      actual = succEnd;
      edge = 'end';
      break;
    case 'FS':
    default:
      required = predEnd + lag;
      actual = succStart;
      edge = 'start';
      break;
  }

  const slackDays = Math.round((actual - required) / MS_DAY);
  return {
    id: link.id,
    type: link.type,
    lag: link.lag || 0,
    required,
    actual,
    edge,
    slackDays,
    violated: slackDays < 0,
    /** Days the successor would have to move to satisfy the link. */
    shortfallDays: slackDays < 0 ? -slackDays : 0,
  };
}

/**
 * Every dependency whose precedence constraint is currently broken.
 *
 * Memoised per document, so the renderer can ask on every frame of a drag
 * without recomputing.
 *
 * @returns {{byLink: Map, objects: Map, links: Set, count: number, worst: number}}
 */
export function linkViolations(doc) {
  const cached = violationCache.get(doc);
  if (cached) return cached;

  const byId = new Map(doc.objects.map((o) => [o.id, o]));
  const byLink = new Map();
  const objects = new Map(); // object id -> the violations it is party to
  const links = new Set();
  let worst = 0;

  for (const link of doc.links) {
    const predecessor = byId.get(link.from);
    const successor = byId.get(link.to);
    const result = evaluateLink(link, predecessor, successor);
    if (!result) continue;

    byLink.set(link.id, result);
    if (!result.violated) continue;

    links.add(link.id);
    worst = Math.max(worst, result.shortfallDays);

    for (const [id, role] of [[link.from, 'predecessor'], [link.to, 'successor']]) {
      if (!objects.has(id)) objects.set(id, []);
      objects.get(id).push({ ...result, role, otherId: role === 'predecessor' ? link.to : link.from });
    }
  }

  const result = { byLink, objects, links, count: links.size, worst };
  violationCache.set(doc, result);
  return result;
}

/**
 * The dates that would satisfy a link, for a one-click fix.
 * Moving the successor preserves its duration.
 */
export function resolutionFor(link, predecessor, successor) {
  const evaluated = evaluateLink(link, predecessor, successor);
  if (!evaluated || !evaluated.violated) return null;

  const shift = evaluated.required - evaluated.actual;
  const hasDuration = !!TYPES[successor.type]?.duration;
  return {
    id: successor.id,
    start: successor.start + shift,
    end: hasDuration ? successor.end + shift : successor.start + shift,
    shiftDays: Math.round(shift / MS_DAY),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Critical path
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Forward/backward pass over the dependency network.
 *
 * Returns per-object early/late dates and total float, plus the set of ids on
 * the critical path (zero float). Objects with no dependencies at all are
 * excluded from the critical set — an isolated bar is not "critical", it is
 * simply unconnected, and marking it so would drown the real chain.
 */
export function criticalPath(doc) {
  const cached = criticalCache.get(doc);
  if (cached) return cached;

  const objects = doc.objects.filter((o) => !o.hidden);
  const byId = new Map(objects.map((o) => [o.id, o]));
  const links = doc.links.filter((l) => byId.has(l.from) && byId.has(l.to));

  const successors = new Map();
  const predecessors = new Map();
  const degree = new Map();
  for (const o of objects) {
    successors.set(o.id, []);
    predecessors.set(o.id, []);
    degree.set(o.id, 0);
  }
  for (const link of links) {
    successors.get(link.from).push(link);
    predecessors.get(link.to).push(link);
    degree.set(link.to, degree.get(link.to) + 1);
  }

  // Topological order (Kahn). The graph is acyclic by construction, but guard
  // anyway: a hand-edited JSON file could arrive with a cycle in it.
  const order = [];
  const queue = objects.filter((o) => degree.get(o.id) === 0).map((o) => o.id);
  const working = new Map(degree);
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const link of successors.get(id)) {
      const next = working.get(link.to) - 1;
      working.set(link.to, next);
      if (next === 0) queue.push(link.to);
    }
  }
  if (order.length !== objects.length) {
    // Cycle present — fall back to document order so analysis still returns.
    for (const o of objects) if (!order.includes(o.id)) order.push(o.id);
  }

  const early = new Map(); // id -> {start, finish}
  for (const id of order) {
    const obj = byId.get(id);
    const duration = durationMs(obj);
    let start = obj.start;
    for (const link of predecessors.get(id)) {
      const pred = early.get(link.from);
      if (!pred) continue;
      const lag = (link.lag || 0) * MS_DAY;
      const spec = LINK_TYPES[link.type] || LINK_TYPES.FS;
      let constraint;
      switch (spec.short) {
        case 'SS': constraint = pred.start + lag; break;
        case 'FF': constraint = pred.finish + lag - duration; break;
        case 'SF': constraint = pred.start + lag - duration; break;
        case 'FS':
        default: constraint = pred.finish + lag; break;
      }
      if (constraint > start) start = constraint;
    }
    early.set(id, { start, finish: start + duration });
  }

  const projectFinish = Math.max(...Array.from(early.values(), (e) => e.finish), -Infinity);

  const late = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const obj = byId.get(id);
    const duration = durationMs(obj);
    let finish = projectFinish;
    const succs = successors.get(id);
    if (succs.length) {
      finish = Infinity;
      for (const link of succs) {
        const next = late.get(link.to);
        if (!next) continue;
        const lag = (link.lag || 0) * MS_DAY;
        const spec = LINK_TYPES[link.type] || LINK_TYPES.FS;
        let constraint;
        switch (spec.short) {
          case 'SS': constraint = next.start - lag + duration; break;
          case 'FF': constraint = next.finish - lag; break;
          case 'SF': constraint = next.finish - lag + duration; break;
          case 'FS':
          default: constraint = next.start - lag; break;
        }
        if (constraint < finish) finish = constraint;
      }
      if (!Number.isFinite(finish)) finish = projectFinish;
    }
    late.set(id, { start: finish - duration, finish });
  }

  const floats = new Map();
  const critical = new Set();
  for (const id of order) {
    const e = early.get(id);
    const l = late.get(id);
    if (!e || !l) continue;
    const floatDays = Math.round((l.start - e.start) / MS_DAY);
    floats.set(id, floatDays);
    const connected = successors.get(id).length > 0 || predecessors.get(id).length > 0;
    if (connected && floatDays <= 0) critical.add(id);
  }

  const result = { critical, floats, early, late, projectFinish, order };
  criticalCache.set(doc, result);
  return result;
}

function durationMs(obj) {
  return TYPES[obj.type]?.duration ? Math.max(MS_DAY, obj.end - obj.start) : 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   Baseline comparison
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Compare the live plan against a baseline snapshot.
 *
 * Returns one row per object that moved, plus rows for objects that were
 * added or removed since the baseline was taken — scope change is as much a
 * part of the story as slippage.
 */
export function compareBaseline(doc, baseline) {
  if (!baseline) return { rows: [], summary: emptySummary() };

  const snapshot = new Map(baselineSnapshot(doc, baseline).map((s) => [s.id, s]));
  const live = new Map(doc.objects.map((o) => [o.id, o]));
  const rows = [];

  for (const [id, snap] of snapshot) {
    const obj = live.get(id);
    if (!obj) {
      rows.push({
        id,
        title: snap.title,
        change: 'removed',
        startShift: 0,
        endShift: 0,
        durationChange: 0,
        baseline: snap,
        current: null,
      });
      continue;
    }
    const hasDuration = !!TYPES[obj.type]?.duration;
    const startShift = daysBetween(snap.start, obj.start);
    const endShift = hasDuration ? daysBetween(snap.end ?? snap.start, obj.end) : startShift;
    const baseDuration = hasDuration ? daysBetween(snap.start, snap.end ?? snap.start) : 0;
    const nowDuration = hasDuration ? daysBetween(obj.start, obj.end) : 0;

    if (startShift === 0 && endShift === 0 && baseDuration === nowDuration) continue;

    rows.push({
      id,
      title: obj.title,
      type: obj.type,
      lane: obj.lane,
      change: endShift > 0 ? 'slip' : endShift < 0 ? 'ahead' : 'reshaped',
      startShift,
      endShift,
      durationChange: nowDuration - baseDuration,
      baseline: snap,
      current: obj,
    });
  }

  for (const [id, obj] of live) {
    if (snapshot.has(id)) continue;
    rows.push({
      id,
      title: obj.title,
      type: obj.type,
      lane: obj.lane,
      change: 'added',
      startShift: 0,
      endShift: 0,
      durationChange: TYPES[obj.type]?.duration ? daysBetween(obj.start, obj.end) : 0,
      baseline: null,
      current: obj,
    });
  }

  rows.sort((a, b) => Math.abs(b.endShift) - Math.abs(a.endShift) || a.title.localeCompare(b.title));

  const summary = {
    slipped: rows.filter((r) => r.change === 'slip').length,
    ahead: rows.filter((r) => r.change === 'ahead').length,
    reshaped: rows.filter((r) => r.change === 'reshaped').length,
    added: rows.filter((r) => r.change === 'added').length,
    removed: rows.filter((r) => r.change === 'removed').length,
    worstSlip: rows.reduce((max, r) => Math.max(max, r.endShift), 0),
    bestGain: rows.reduce((min, r) => Math.min(min, r.endShift), 0),
    totalRows: rows.length,
  };

  return { rows, summary };
}

function emptySummary() {
  return { slipped: 0, ahead: 0, reshaped: 0, added: 0, removed: 0, worstSlip: 0, bestGain: 0, totalRows: 0 };
}

/* ══════════════════════════════════════════════════════════════════════════
   Health & progress
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Per-object schedule health against the effective "today".
 * `expected` is straight-line expected progress; the variance against actual
 * percent complete is what flags trouble before a date is formally missed.
 */
export function objectHealth(obj, today) {
  const def = TYPES[obj.type];
  if (!def?.duration) {
    if (obj.status === 'complete' || obj.status === 'released' || obj.status === 'closed') return { state: 'done', label: 'Complete' };
    if (obj.start < today) return { state: 'late', label: 'Date passed', days: daysBetween(obj.start, today) };
    return { state: 'future', label: 'Upcoming' };
  }

  const total = Math.max(1, obj.end - obj.start);
  const elapsed = Math.min(total, Math.max(0, today - obj.start));
  const expected = Math.round((elapsed / total) * 100);
  const actual = obj.progress || 0;

  if (actual >= 100) return { state: 'done', label: 'Complete', expected, actual, variance: 100 - expected };
  if (today > obj.end) return { state: 'overdue', label: 'Overdue', expected: 100, actual, variance: actual - 100, days: daysBetween(obj.end, today) };
  if (today < obj.start) return { state: 'future', label: 'Not started', expected: 0, actual, variance: actual };

  const variance = actual - expected;
  if (variance < -15) return { state: 'behind', label: 'Behind plan', expected, actual, variance };
  if (variance > 10) return { state: 'ahead', label: 'Ahead of plan', expected, actual, variance };
  return { state: 'ontrack', label: 'On track', expected, actual, variance };
}

/** Programme-level roll-up for the status bar and the review panes. */
export function programmeHealth(doc) {
  const today = effectiveToday(doc);
  const counts = { done: 0, ontrack: 0, ahead: 0, behind: 0, overdue: 0, future: 0, late: 0 };
  let weighted = 0;
  let weight = 0;

  for (const obj of doc.objects) {
    if (obj.hidden) continue;
    const health = objectHealth(obj, today);
    counts[health.state] = (counts[health.state] || 0) + 1;
    if (TYPES[obj.type]?.progress) {
      const days = Math.max(1, (obj.end - obj.start) / MS_DAY);
      weighted += (obj.progress || 0) * days;
      weight += days;
    }
  }

  return {
    counts,
    percentComplete: weight ? Math.round(weighted / weight) : 0,
    atRisk: counts.behind + counts.overdue + counts.late,
    today,
  };
}

/**
 * Slip analysis relative to a baseline, grouped by lane — the view a
 * commissioning manager actually wants in a progress meeting.
 */
export function slipByLane(doc, baseline) {
  const { rows } = compareBaseline(doc, baseline);
  const byLane = new Map();
  for (const row of rows) {
    if (!row.current) continue;
    const laneId = row.current.lane;
    if (!byLane.has(laneId)) byLane.set(laneId, { laneId, slip: 0, count: 0, worst: 0, rows: [] });
    const entry = byLane.get(laneId);
    entry.count++;
    entry.slip += row.endShift;
    entry.worst = Math.max(entry.worst, row.endShift);
    entry.rows.push(row);
  }
  return Array.from(byLane.values()).sort((a, b) => b.worst - a.worst);
}

/**
 * Working days remaining on an object, honouring the project's holiday list.
 */
export function workingDaysRemaining(obj, today, holidays = []) {
  if (!TYPES[obj.type]?.duration) return 0;
  const from = Math.max(today, obj.start);
  if (from >= obj.end) return 0;
  return workingDaysBetween(from, obj.end, holidays);
}
