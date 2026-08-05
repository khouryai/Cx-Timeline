/**
 * Query layer — filtering and full-text search over the document.
 *
 * Lives in core rather than the UI so the renderer, the exporters and the
 * search panel all apply exactly the same rules: what you filter is what you
 * export.
 *
 * Imports: util, dates, model.
 */

import { fold, stripHtml, truncate } from './util.js';
import { toMs, MS_DAY } from './dates.js';
import { TYPES, STATUSES, statusOf, subsystemOf } from './model.js';

/**
 * Build a predicate from the active filter set.
 * An empty filter list means "no constraint on this dimension", so a fresh
 * filter panel matches everything.
 */
export function filterPredicate(doc, filters) {
  const f = filters || {};
  const text = fold(f.text || '');
  const types = new Set(f.types || []);
  const statuses = new Set(f.statuses || []);
  const lanes = new Set(f.lanes || []);
  const owners = new Set(f.owners || []);
  const subsystems = new Set(f.subsystems || []);
  const areas = new Set(f.areas || []);
  const tags = new Set(f.tags || []);
  const from = f.from ? toMs(f.from) : null;
  const to = f.to ? toMs(f.to) : null;

  return (obj) => {
    if (types.size && !types.has(obj.type)) return false;
    if (statuses.size && !statuses.has(obj.status)) return false;
    if (lanes.size && !lanes.has(obj.lane)) return false;
    if (owners.size && !owners.has(obj.owner)) return false;
    if (subsystems.size && !subsystems.has(obj.subsystem)) return false;
    if (areas.size && !areas.has(obj.area)) return false;
    if (tags.size && !(obj.tags || []).some((t) => tags.has(t))) return false;

    if (from != null || to != null) {
      const start = obj.start;
      const end = TYPES[obj.type]?.duration ? obj.end : obj.start + MS_DAY;
      if (from != null && end < from) return false;
      if (to != null && start > to) return false;
    }

    if (text) {
      if (!fold(searchableText(obj)).includes(text)) return false;
    }
    return true;
  };
}

/** Everything about an object that global search should look inside. */
export function searchableText(obj) {
  const data = obj.data || {};
  return [
    obj.title,
    obj.subtitle,
    obj.owner,
    obj.area,
    obj.subsystem,
    obj.status,
    (obj.tags || []).join(' '),
    stripHtml(obj.notes),
    data.version,
    data.releaseNumber,
    data.buildNumber,
    data.testPackage,
    data.reference,
    data.mitigation,
    data.testKind,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Global search across the whole document.
 * Returns ranked results: title matches first, then metadata, then notes.
 */
export function search(doc, query, { limit = 60 } = {}) {
  const q = fold(String(query || '').trim());
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const laneNames = new Map(doc.lanes.map((l) => [l.id, l.name]));
  const results = [];

  for (const obj of doc.objects) {
    const title = fold(obj.title);
    const meta = fold([obj.owner, obj.area, subsystemOf(obj.subsystem)?.label || obj.subsystem, statusOf(obj.status).label, (obj.tags || []).join(' '), obj.data?.version, obj.data?.releaseNumber, obj.data?.buildNumber, obj.data?.reference, obj.data?.testPackage].filter(Boolean).join(' '));
    const notes = fold(stripHtml(obj.notes));

    let score = 0;
    let matchedIn = '';
    for (const term of terms) {
      if (title.includes(term)) {
        score += title.startsWith(term) ? 12 : 8;
        matchedIn = matchedIn || 'title';
      } else if (meta.includes(term)) {
        score += 4;
        matchedIn = matchedIn || 'details';
      } else if (notes.includes(term)) {
        score += 2;
        matchedIn = matchedIn || 'notes';
      } else {
        score = -1;
        break;
      }
    }
    if (score <= 0) continue;

    results.push({
      kind: 'object',
      id: obj.id,
      title: obj.title,
      type: obj.type,
      typeLabel: TYPES[obj.type]?.label || obj.type,
      lane: laneNames.get(obj.lane) || '',
      status: obj.status,
      start: obj.start,
      end: obj.end,
      matchedIn,
      excerpt: matchedIn === 'notes' ? excerpt(stripHtml(obj.notes), terms[0]) : subtitleFor(obj),
      score,
    });
  }

  for (const lane of doc.lanes) {
    if (terms.every((t) => fold(lane.name).includes(t))) {
      results.push({
        kind: 'lane',
        id: lane.id,
        title: lane.name,
        typeLabel: 'Lane',
        matchedIn: 'title',
        excerpt: `${doc.objects.filter((o) => o.lane === lane.id).length} objects`,
        score: 6,
      });
    }
  }

  results.sort((a, b) => b.score - a.score || a.start - b.start);
  return results.slice(0, limit);
}

function subtitleFor(obj) {
  const bits = [];
  if (obj.owner) bits.push(obj.owner);
  const sub = subsystemOf(obj.subsystem);
  if (sub) bits.push(sub.label);
  if (obj.area) bits.push(obj.area);
  if (obj.data?.version) bits.push(`v${obj.data.version}`);
  return bits.join(' · ');
}

/** A short window of text around the first hit, for search result previews. */
function excerpt(text, term, width = 90) {
  const i = fold(text).indexOf(fold(term));
  if (i < 0) return truncate(text, width);
  const start = Math.max(0, i - width / 3);
  return (start > 0 ? '…' : '') + truncate(text.slice(start), width);
}

/**
 * Roll-up counts used by the legend, the filter panel and the status bar.
 */
export function summarise(doc, predicate = null) {
  const byType = new Map();
  const byStatus = new Map();
  const byLane = new Map();
  const byOwner = new Map();
  const bySubsystem = new Map();
  let visible = 0;

  for (const obj of doc.objects) {
    if (predicate && !predicate(obj)) continue;
    visible++;
    bump(byType, obj.type);
    bump(byStatus, obj.status);
    bump(byLane, obj.lane);
    if (obj.owner) bump(byOwner, obj.owner);
    if (obj.subsystem) bump(bySubsystem, obj.subsystem);
  }

  return { total: doc.objects.length, visible, byType, byStatus, byLane, byOwner, bySubsystem };
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

/** Distinct values for a field, with counts, sorted by frequency. */
export function facet(doc, field) {
  const counts = new Map();
  for (const obj of doc.objects) {
    const value = field === 'tag' ? null : obj[field];
    if (field === 'tag') {
      for (const t of obj.tags || []) bump(counts, t);
    } else if (value) {
      bump(counts, value);
    }
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

/** Status ids actually present in the document, in canonical order. */
export function usedStatuses(doc) {
  const present = new Set(doc.objects.map((o) => o.status));
  return Object.keys(STATUSES).filter((id) => present.has(id));
}

/** Type ids actually present in the document, in registry order. */
export function usedTypes(doc) {
  const present = new Set(doc.objects.map((o) => o.type));
  return Object.keys(TYPES).filter((id) => present.has(id));
}
