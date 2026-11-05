/**
 * The cancellation log — the delay log — on paper, and shaped for Excel.
 *
 * Three things leave the calendar from it. The list, exactly as the
 * Cancellations tab draws it: the same columns, the same squares per day, the
 * same badges, the counts above it (Export PDF and Export to Excel on that
 * tab). The calendar "As a calendar" draws: one row per activity, each
 * cancelled run one cell across its days. And both together for the days just
 * gone — the delay log in the zip beside the 4WLA (`ui/rc_la_delay.js`).
 *
 * One module, so the list on screen, on paper and in Excel read the events the
 * same way — `runText()`, `calendarRows()` and `logLines()` are what the
 * screen itself uses — and the colour is whose it was in every one of them:
 * BART red, Hitachi blue, another party amber, purple while nobody has said.
 *
 * No DOM and no network: it takes events (`cancellationLog()`) and returns
 * scenes and bytes, which is what lets `tools/test_lookahead.js` lay the pages
 * out in Node and check nothing is drawn off the sheet.
 *
 * Imports: io/pdf, io/lookahead, core/lookahead, core/la_edit, core/dates.
 */

import { fitPagesToPdf, contentBox, textWidth } from './pdf.js';
import { isDark } from './lookahead.js';
import { describeCodeCounts } from '../core/lookahead.js';
import { monthLabel, weekdayLetter, isWeekend, addDaysISO } from '../core/la_edit.js';
import { fmtDate, localDayMs, toISO } from '../core/dates.js';

/** Whose a cancellation can be: the contract's three answers, as the schema checks them. */
export const CANCEL_PARTIES = ['BART', 'Hitachi', 'Other'];
/**
 * The calendar's colours, as `--la-cancel-*` draws them on screen and the
 * Excel writes them: a fill per answer for a day cancelled outright (BART's is
 * the legend's own red, passed in), and writing a white sheet can carry for a
 * resource struck out of work that went ahead.
 */
export const CANCEL_FILL = { Hitachi: '0070C0', Other: 'FFC000', open: 'E4D7F5' };
export const CANCEL_INK = { BART: 'FF0000', Hitachi: '0070C0', Other: 'C55A11', open: '7030A0' };
export const KIND_LABEL = { activity: 'Activity cancelled', support: 'BART support cancelled' };
/** The badge tone each answer takes in the list, as `badge()` draws it. */
export const PARTY_TONE = { BART: 'bad', Hitachi: 'info', Other: 'warn' };
export const OPEN_TONE = 'pending';

/** Whose it was — 'BART', 'Hitachi', 'Other' — or null while nobody has said. */
export function partyOf(e) {
  if (!e?.note) return null;
  return CANCEL_PARTIES.includes(e.note.party) ? e.note.party : 'Other';
}

function isoMs(iso) {
  return Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
}

/** "23 Sep 26", in the order the application writes dates — the same words as the screen. */
export function dayText(iso, preset = 'short') {
  return fmtDate(isoMs(iso), preset);
}

/** One day, or the first and last of a run. */
export function spanText(start, end) {
  return start === end ? dayText(start) : `${dayText(start)} – ${dayText(end)}`;
}

/**
 * How many reads showed it, and the day it was first seen — that day on this
 * computer's calendar, not Greenwich's: an instant's ISO date is tomorrow in
 * California from five in the afternoon.
 */
export function seenText(e) {
  const reads = e.reads || 0;
  const first = e.firstSeen ? ` · first ${dayText(toISO(localDayMs(e.firstSeen)))}` : '';
  return `${reads} read${reads === 1 ? '' : 's'}${first}`;
}

/** Every day from one date to another, both ends included — never more than 400. */
export function spanDays(from, to) {
  const days = [];
  for (let d = from; d <= to && days.length < 400; d = addDaysISO(d, 1)) days.push(d);
  return days;
}

/** What one cancelled run says on the calendar and in its Excel cell: what went, then whose and why. */
export function runText(e) {
  const what = e.kind === 'support'
    ? `${describeCodeCounts(e.resources)} cancelled`
    : describeCodeCounts(e.resources);
  const why = e.note ? `${e.note.party}${e.note.reason ? `: ${e.note.reason}` : ''}` : 'No reason yet';
  return [what, why].filter(Boolean).join('\n');
}

/**
 * The calendar's rows: one per activity (its editor row where it has one, else
 * its words), each with the runs cancelled on it, in the order of the label.
 */
export function calendarRows(events) {
  const byActivity = new Map();
  for (const e of events) {
    const activity = e.laRowId || e.key;
    if (!byActivity.has(activity)) byActivity.set(activity, { label: e.label || '', location: e.location || '', events: [] });
    byActivity.get(activity).events.push(e);
  }
  return [...byActivity.values()]
    .sort((a, b) => a.label.localeCompare(b.label) || a.location.localeCompare(b.location));
}

/** The calendar's rows as the Excel writer takes them: each run's dates, kind, party and words. */
export function calendarCells(events) {
  return calendarRows(events).map((r) => ({
    ...r,
    events: r.events.map((e) => ({ start: e.start, end: e.end, kind: e.kind, party: partyOf(e), text: runText(e) })),
  }));
}

/**
 * Each event as a plain line — what the list says about it, in words and
 * dates, for the PDF and the Excel alike. `who` names an author from the id a
 * note was stamped with (`authorNames()`).
 *
 * @param {any[]} events
 * @param {{ who?: (id: any) => string }} [o]
 */
export function logLines(events, { who = () => '' } = {}) {
  return events.map((e) => ({
    label: e.label || '',
    location: e.location || '',
    kind: e.kind,
    what: KIND_LABEL[e.kind] || e.kind,
    resources: describeCodeCounts(e.resources),
    start: e.start,
    end: e.end,
    days: e.days,
    reads: e.reads || 0,
    seen: seenText(e),
    firstSeen: e.firstSeen || '',
    party: partyOf(e),
    responsible: e.note ? e.note.party : 'No reason yet',
    reason: e.note?.reason || '',
    corrections: Math.max(0, (e.history?.length || 0) - 1),
    loggedBy: who(e.note?.author) || '',
    loggedAt: e.note?.created_at || '',
    removed: Boolean(e.dismissed),
  }));
}

/** The counts the tab shows above the list, over the events it counts them over. */
export function logStats(events) {
  const tally = { BART: 0, Hitachi: 0, Other: 0 };
  let open = 0;
  let days = 0;
  for (const e of events) {
    days += e.days;
    if (e.note) tally[e.note.party] = (tally[e.note.party] || 0) + 1;
    else open++;
  }
  const support = events.filter((e) => e.kind === 'support').length;
  return { events: events.length, activities: events.length - support, support, days, ...tally, open };
}

/** The same counts as chips: label, value and the tone the tab gives each. */
export function statChips(s) {
  return [
    ['Events', s.events, 'info'],
    ['Cancelled activities', s.activities, 'muted'],
    ['BART support', s.support, s.support ? 'warn' : 'muted'],
    ['Days', s.days, 'muted'],
    ...CANCEL_PARTIES.map((p) => [p, s[p], s[p] ? PARTY_TONE[p] : 'muted']),
    ['No reason yet', s.open, s.open ? OPEN_TONE : 'muted'],
  ];
}

/** The counts in one line of words, for a sheet's heading. */
export function statsText(s) {
  return statChips(s).map(([label, value]) => `${label} ${value}`).join('  ·  ');
}

/* ══════════════════════════════════════════════════════════════════════════
   Drawing
   ═══════════════════════════════════════════════════════════════════════ */

/** The light theme's status colours, for paper: ink, wash and border, as `badge()` and `chipStat()` draw them. */
const TONE = {
  bad: { ink: '#c01017', bg: '#fdeaeb', border: '#efc1c3' },
  info: { ink: '#1d4eaf', bg: '#e8efff', border: '#c4d1ea' },
  warn: { ink: '#a8550a', bg: '#fbf0e1', border: '#e5ccb6' },
  pending: { ink: '#6b21a8', bg: '#f1eaf9', border: '#d9c5e8' },
  neutral: { ink: '#6b7280', bg: '#f3f4f6', border: '#d6d8db' },
  muted: { ink: '#6e7179', bg: '#f3f4f6', border: '#d6d8db' },
};
const INK = {
  text: '#131316',
  muted: '#6e7179',
  rule: '#e3e4e7',
  ruleStrong: '#b9bcc2',
  weekend: '#f5f5f5',
  band: '#eeeeee',
  today: '#e60012',
  todayWash: '#e8efff',
  onDark: '#ffffff',
};
const PALETTE = { bg: '#ffffff', text: INK.text, textSubtle: INK.muted, brand: INK.today };

/** Greedy word wrap, each paragraph on its own; a word wider than the column breaks on characters. */
function wrap(text, width, size, font = 'F1') {
  const out = [];
  for (const para of String(text ?? '').split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, font) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
      while (textWidth(line, size, font) > width && line.length > 1) {
        let cut = line.length;
        while (cut > 1 && textWidth(line.slice(0, cut), size, font) > width) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/* ── The list ──────────────────────────────────────────────────────────── */

const LF = 7.4;          // body type
const LS = 6.5;          // the muted second line
const LL = 9.4;          // line height
const PAD_X = 4.5;
const PAD_Y = 5;
const HEAD_F = 5.8;
const HEAD_H = 17;
const BADGE_F = 6.3;
const BADGE_H = 11;
const SQ_W = 4.6;
const SQ_H = 7.4;
const SQ_GAP = 1.4;
const CHIP_H = 17;

const LIST_HEADS = ['', 'Activity', 'What', 'BART resources', 'Cancelled', 'Length', 'Seen', 'Responsible', 'Reason'];

function badgeWidth(text) {
  return 6 + 3.2 + 3.6 + textWidth(text, BADGE_F, 'F2') + 6;
}

/** A badge as the application draws one: a wash, a hairline, a dot, the words in the tone's ink. */
function badge(items, x, y, text, toneName) {
  const tone = TONE[toneName] || TONE.neutral;
  const w = badgeWidth(text);
  items.push({ type: 'rect', x, y, w, h: BADGE_H, radius: 2.6, fill: tone.bg, stroke: tone.border, strokeWidth: 0.5 });
  items.push({ type: 'circle', cx: x + 6 + 1.6, cy: y + BADGE_H / 2, r: 1.6, fill: tone.ink });
  items.push({ type: 'text', x: x + 6 + 3.2 + 3.6, y: y + BADGE_H / 2 + BADGE_F * 0.36, text, size: BADGE_F, fill: tone.ink, weight: 700 });
  return w;
}

/** The counts as the tab's chips: a wash per tone, the label in mono capitals, the number bold. */
function chips(items, list, width) {
  let x = 0;
  let y = 0;
  for (const [label, value, toneName] of list) {
    const tone = TONE[toneName] || TONE.muted;
    const caps = label.toUpperCase();
    const w = 7 + textWidth(caps, 5.4, 'F4') + 6 + textWidth(String(value), 9, 'F2') + 7;
    if (x + w > width && x > 0) { x = 0; y += CHIP_H + 5; }
    items.push({ type: 'rect', x, y, w, h: CHIP_H, radius: 3.5, fill: toneName === 'muted' ? TONE.neutral.bg : tone.bg, stroke: toneName === 'muted' ? TONE.neutral.border : tone.border, strokeWidth: 0.5 });
    items.push({ type: 'text', x: x + 7, y: y + CHIP_H / 2 + 2, text: caps, size: 5.4, family: 'mono', weight: 700, fill: tone.ink });
    items.push({ type: 'text', x: x + 7 + textWidth(caps, 5.4, 'F4') + 6, y: y + CHIP_H / 2 + 3.2, text: String(value), size: 9, weight: 700, fill: tone.ink });
    x += w + 6;
  }
  return y + CHIP_H;
}

/** How wide each column of the list is, from what is in it; Activity and Reason share what is left. */
function listWidths(lines, width) {
  const longest = (fn, font = 'F1', size = LF) => Math.max(0, ...lines.map((l) => textWidth(fn(l), size, font)));
  const fit = (w, head, lo, hi) => Math.min(hi, Math.max(lo, w, textWidth(head.toUpperCase(), HEAD_F, 'F4'))) + PAD_X * 2;
  const squares = Math.max(1, ...lines.map((l) => Math.min(l.days || 1, 14)));
  const fixed = {
    cells: squares * (SQ_W + SQ_GAP) - SQ_GAP + PAD_X * 2,
    what: Math.max(0, ...lines.map((l) => Math.max(badgeWidth(l.what), l.removed ? badgeWidth('Removed from the log') : 0))) + PAD_X * 2,
    resources: fit(longest((l) => l.resources || '—', 'F2'), 'BART resources', 30, 110),
    cancelled: fit(longest((l) => spanText(l.start, l.end)), 'Cancelled', 40, 105),
    length: fit(longest((l) => `${l.days} day${l.days === 1 ? '' : 's'}`), 'Length', 22, 40),
    seen: fit(longest((l) => l.seen, 'F1', LS), 'Seen', 40, 92),
    responsible: Math.max(0, ...lines.map((l) => badgeWidth(l.responsible))) + PAD_X * 2,
  };
  const used = Object.values(fixed).reduce((a, b) => a + b, 0);
  const rest = Math.max(220, width - used);
  return [fixed.cells, rest * 0.55, fixed.what, fixed.resources, fixed.cancelled, fixed.length, fixed.seen, fixed.responsible, rest * 0.45];
}

/** One line of the list laid out: what goes in each column, and how tall the row is. */
function layLine(l, widths) {
  const inner = (i) => widths[i] - PAD_X * 2;
  const cells = {
    activity: wrap(l.label || '—', inner(1), LF),
    location: l.location ? wrap(l.location, inner(1), LS) : [],
    resources: l.resources ? wrap(l.resources, inner(3), LF, 'F2') : ['—'],
    cancelled: wrap(spanText(l.start, l.end), inner(4), LF),
    length: wrap(`${l.days} day${l.days === 1 ? '' : 's'}`, inner(5), LF),
    seen: wrap(l.seen, inner(6), LS),
    reason: l.reason ? wrap(l.reason, inner(8), LF) : [],
    corrected: l.corrections ? wrap(`Corrected ${l.corrections} time(s)`, inner(8), LS) : [],
  };
  const textH = Math.max(
    (cells.activity.length * LL) + (cells.location.length * (LS + 2.6)),
    cells.resources.length * LL,
    cells.cancelled.length * LL,
    cells.length.length * LL,
    cells.seen.length * (LS + 2.6),
    (cells.reason.length * LL) + (cells.corrected.length * (LS + 2.6)),
    l.removed ? BADGE_H * 2 + 3 : BADGE_H,
    SQ_H,
  );
  return { l, cells, h: Math.max(20, textH + PAD_Y * 2) };
}

/** The header row of the list, as the tab's table heads its columns: mono capitals, muted. */
function listHead(items, widths, y, width) {
  let x = 0;
  LIST_HEADS.forEach((head, i) => {
    if (head) items.push({ type: 'text', x: x + PAD_X, y: y + HEAD_H - 6, text: head.toUpperCase(), size: HEAD_F, family: 'mono', weight: 700, fill: INK.muted });
    x += widths[i];
  });
  items.push({ type: 'line', x1: 0, y1: y + HEAD_H, x2: width, y2: y + HEAD_H, stroke: INK.ruleStrong, strokeWidth: 0.7 });
  return y + HEAD_H;
}

/** One row of the list, drawn from `y`. */
function drawLine(items, row, widths, y, width) {
  const { l, cells } = row;
  const at = [];
  widths.reduce((x, w) => { at.push(x); return x + w; }, 0);
  const top = y + PAD_Y;
  const body = (x, n, text, extra = {}) => items.push({
    type: 'text', x, y: top + (n + 1) * LL - 2.4, text, size: LF, fill: INK.text, ...extra,
  });
  const before = items.length;

  // One square per cancelled day, coloured by whose it was; an outline for a resource struck out.
  const ink = (TONE[l.party ? PARTY_TONE[l.party] : OPEN_TONE] || TONE.pending).ink;
  for (let i = 0; i < Math.min(l.days || 1, 14); i++) {
    items.push({
      type: 'rect', x: at[0] + PAD_X + i * (SQ_W + SQ_GAP), y: top + 1, w: SQ_W, h: SQ_H, radius: 0.9,
      ...(l.kind === 'support' ? { fill: 'none', stroke: ink, strokeWidth: 0.9 } : { fill: ink }),
    });
  }

  cells.activity.forEach((t, n) => body(at[1] + PAD_X, n, t));
  const locTop = top + cells.activity.length * LL;
  cells.location.forEach((t, n) => items.push({
    type: 'text', x: at[1] + PAD_X, y: locTop + (n + 1) * (LS + 2.6) - 1.6, text: t, size: LS, fill: INK.muted,
  }));

  badge(items, at[2] + PAD_X, top, l.what, l.kind === 'support' ? 'warn' : 'bad');
  if (l.removed) badge(items, at[2] + PAD_X, top + BADGE_H + 3, 'Removed from the log', 'neutral');

  /* What BART lost. Struck through in red on an activity that went ahead, as
     the grid draws a struck-out code; plain on a day cancelled outright. */
  cells.resources.forEach((t, n) => {
    const struck = l.kind === 'support' && l.resources;
    body(at[3] + PAD_X, n, t, struck ? { fill: TONE.bad.ink, weight: 700 } : l.resources ? {} : { fill: INK.muted });
    if (struck) {
      const yLine = top + (n + 1) * LL - 2.4 - LF * 0.3;
      items.push({ type: 'line', x1: at[3] + PAD_X, y1: yLine, x2: at[3] + PAD_X + textWidth(t, LF, 'F2'), y2: yLine, stroke: TONE.bad.ink, strokeWidth: 0.9 });
    }
  });
  cells.cancelled.forEach((t, n) => body(at[4] + PAD_X, n, t));
  cells.length.forEach((t, n) => body(at[5] + PAD_X, n, t));
  cells.seen.forEach((t, n) => items.push({
    type: 'text', x: at[6] + PAD_X, y: top + (n + 1) * (LS + 2.6) - 1.6, text: t, size: LS, fill: INK.muted,
  }));
  badge(items, at[7] + PAD_X, top, l.responsible, l.party ? PARTY_TONE[l.party] || 'neutral' : OPEN_TONE);
  cells.reason.forEach((t, n) => body(at[8] + PAD_X, n, t));
  const corrTop = top + cells.reason.length * LL;
  cells.corrected.forEach((t, n) => items.push({
    type: 'text', x: at[8] + PAD_X, y: corrTop + (n + 1) * (LS + 2.6) - 1.6, text: t, size: LS, fill: INK.muted,
  }));

  // Removed from the log reads as set aside, as the tab dims it.
  if (l.removed) for (let i = before; i < items.length; i++) items[i].opacity = 0.55;
  items.push({ type: 'line', x1: 0, y1: y + row.h, x2: width, y2: y + row.h, stroke: INK.rule, strokeWidth: 0.4 });
  return y + row.h;
}

/**
 * The list as page scenes, each the full width of the page at full size — the
 * counts and a note on the first, the column heads repeated on every one, and
 * as many rows as fit. A row is never split across two pages.
 *
 * @param {object[]} lines        `logLines()`
 * @param {object} [o]
 * @param {object} [o.stats]      `logStats()` over what the tab counts — no chips without it
 * @param {string} [o.note]       what the list is, or how it was narrowed — said, never implied
 * @param {string} [o.empty]      the words when there is nothing to list
 * @param {object} [o.page]       `{ pageSize, orientation }` with the title, for the room there is
 */
export function listScenes(lines, { stats = null, note = '', empty = 'Nothing cancelled in these dates.', page = {} } = {}) {
  const room = contentBox({ ...page, title: page.title ?? 'x' });
  const widths = listWidths(lines, room.w);
  /* Wider than the page only when the page is too small for the columns; then
     every page shrinks alike, and holds that many more rows. */
  const width = Math.max(room.w, widths.reduce((a, b) => a + b, 0));
  const tall = room.h / Math.min(1, room.w / width);
  const rows = lines.map((l) => layLine(l, widths));
  const scenes = [];
  let items = [];
  let y = 0;
  const finish = () => scenes.push({ width, height: Math.max(y, 1), items, meta: { palette: PALETTE } });

  y = stats ? chips(items, statChips(stats), width) + 8 : 0;
  if (note) {
    for (const t of wrap(note, width, 6.8)) {
      items.push({ type: 'text', x: 0, y: y + 7, text: t, size: 6.8, fill: INK.muted });
      y += 9;
    }
    y += 4;
  }
  if (!rows.length) {
    y = listHead(items, widths, y, width);
    items.push({ type: 'text', x: PAD_X, y: y + 16, text: empty, size: LF, fill: INK.muted });
    y += 24;
    finish();
    return scenes;
  }
  y = listHead(items, widths, y, width);
  let onPage = 0;
  for (const row of rows) {
    if (onPage && y + row.h > tall) {
      finish();
      items = [];
      y = listHead(items, widths, 0, width);
      onPage = 0;
    }
    y = drawLine(items, row, widths, y, width);
    onPage++;
  }
  finish();
  return scenes;
}

/* ── The calendar ──────────────────────────────────────────────────────── */

const CF = 6.6;
const CL = 8.2;
const MONTH_H = 12;
const NUM_H = 11;
const WD_H = 11;
const KEY_H = 30;
const MIN_ROW = 18;

/** Fill, ink and outline of a cancelled run, as the calendar on screen and in Excel colour it. */
function runPaint(kind, party, red) {
  const who = party || 'open';
  if (kind === 'support') {
    const ink = `#${CANCEL_INK[who] || CANCEL_INK.Other}`;
    return { fill: null, ink, outline: ink, dashed: who === 'open', textInk: ink };
  }
  const hex = who === 'BART' ? String(red || 'FF0000') : CANCEL_FILL[who] || CANCEL_FILL.Other;
  return {
    fill: `#${hex}`,
    ink: isDark(hex) ? INK.onDark : INK.text,
    outline: who === 'open' ? `#${CANCEL_INK.open}` : null,
    dashed: who === 'open',
    textInk: isDark(hex) ? INK.onDark : INK.text,
  };
}

/**
 * A run's cell: its fill, and its edge — solid, or dashed while nobody has
 * said whose it was, so an unanswered run never reads as anybody's. The PDF
 * writer dashes lines, not rectangles, so a dashed edge is four lines.
 */
function box(items, x, y, w, h, paint, edge) {
  const solid = paint.outline && !paint.dashed;
  items.push({
    type: 'rect', x, y, w, h, radius: paint.dashed ? 0 : 1.5,
    fill: paint.fill || 'none', stroke: solid ? paint.outline : 'none', strokeWidth: solid ? edge : 0,
  });
  if (!paint.dashed || !paint.outline) return;
  const dash = [2.2, 1.6];
  const line = (x1, y1, x2, y2) => items.push({ type: 'line', x1, y1, x2, y2, stroke: paint.outline, strokeWidth: edge, dash });
  line(x, y, x + w, y);
  line(x + w, y, x + w, y + h);
  line(x + w, y + h, x, y + h);
  line(x, y + h, x, y);
}

/**
 * The calendar as page scenes: the days across (month, number, weekday), one
 * row per activity with its location, each cancelled run one cell spanning its
 * days with what went and whose it was and why — the key under every page.
 * Scaled to the page's width once, and as many rows to a page as then fit, so
 * a long log runs onto more pages rather than shrinking out of reach.
 *
 * @param {object[]} rows   `calendarCells()`
 * @param {object} o
 * @param {string[]} o.days     ISO dates, both ends inclusive
 * @param {string} [o.red]      the legend's cancellation colour, `RRGGBB`
 * @param {string} [o.today]    an ISO date to mark
 * @param {object} [o.page]     `{ pageSize, orientation }`
 */
export function calendarScenes(rows, { days, red = 'FF0000', today = null, page = {} }) {
  const area = contentBox({ ...page, title: page.title ?? 'x' });
  const actW = Math.min(230, Math.max(150, ...rows.map((r) => textWidth(r.label, CF) / 2.2 + 12)));
  const locW = Math.min(90, Math.max(50, ...rows.map((r) => textWidth(r.location, CF) + 10)));
  const metaW = actW + locW;
  const dayW = Math.max(30, (area.w - metaW) / Math.max(1, days.length));
  const width = metaW + dayW * days.length;
  const scale = Math.min(1, area.w / width);
  const room = area.h / scale;
  const headH = MONTH_H + NUM_H + WD_H;
  const index = new Map(days.map((d, i) => [d, i]));

  const laid = rows.map((r) => {
    const label = wrap(r.label || '—', actW - 8, CF, 'F2');
    const location = wrap(r.location || '', locW - 8, CF);
    const runs = [];
    for (const e of r.events) {
      const a = index.get(e.start < days[0] ? days[0] : e.start);
      const b = index.get(e.end > days[days.length - 1] ? days[days.length - 1] : e.end);
      if (a == null || b == null || b < a) continue;
      runs.push({ e, a, b, text: wrap(e.text, (b - a + 1) * dayW - 6, CF, 'F2') });
    }
    const lines = Math.max(label.length, location.length, ...runs.map((x) => x.text.length), 1);
    return { label, location, runs, h: Math.max(MIN_ROW, lines * CL + 7) };
  });

  const scenes = [];
  const pageOf = (slice) => {
    const items = [];
    // The month band, a label per run of days.
    let start = 0;
    for (let i = 1; i <= days.length; i++) {
      if (i < days.length && monthLabel(days[i]) === monthLabel(days[start])) continue;
      const x = metaW + start * dayW;
      items.push({ type: 'rect', x, y: 0, w: (i - start) * dayW, h: MONTH_H, fill: INK.band });
      items.push({ type: 'text', x: x + 4, y: MONTH_H - 3.5, text: monthLabel(days[start]), size: CF, weight: 700, fill: INK.muted });
      start = i;
    }
    items.push({ type: 'text', x: 4, y: headH - 4, text: 'Activity', size: CF, weight: 700, fill: INK.muted });
    items.push({ type: 'text', x: actW + 4, y: headH - 4, text: 'Location', size: CF, weight: 700, fill: INK.muted });
    days.forEach((d, i) => {
      const x = metaW + i * dayW;
      const isToday = d === today;
      if (isToday) items.push({ type: 'rect', x, y: MONTH_H, w: dayW, h: headH - MONTH_H, fill: INK.todayWash });
      else if (isWeekend(d)) items.push({ type: 'rect', x, y: MONTH_H, w: dayW, h: headH - MONTH_H, fill: INK.weekend });
      items.push({ type: 'text', x: x + dayW / 2, y: MONTH_H + NUM_H - 3, text: String(Number(d.slice(8, 10))), size: CF + 0.4, weight: 700, anchor: 'middle', fill: isToday ? INK.today : INK.text });
      items.push({ type: 'text', x: x + dayW / 2, y: headH - 3.5, text: isToday ? 'Today' : weekdayLetter(d), size: CF - 0.6, anchor: 'middle', fill: isToday ? INK.today : INK.muted });
    });

    let y = headH;
    for (const row of slice) {
      days.forEach((d, i) => {
        const fill = d === today ? INK.todayWash : isWeekend(d) ? INK.weekend : null;
        if (fill) items.push({ type: 'rect', x: metaW + i * dayW, y, w: dayW, h: row.h, fill });
      });
      row.label.forEach((t, n) => items.push({ type: 'text', x: 4, y: y + 4 + (n + 1) * CL - 1.6, text: t, size: CF, weight: 700, fill: INK.text }));
      row.location.forEach((t, n) => items.push({ type: 'text', x: actW + 4, y: y + 4 + (n + 1) * CL - 1.6, text: t, size: CF, fill: INK.muted }));
      for (const run of row.runs) {
        const x = metaW + run.a * dayW;
        const w = (run.b - run.a + 1) * dayW;
        const paint = runPaint(run.e.kind, run.e.party, red);
        box(items, x + 1, y + 1, w - 2, row.h - 2, paint, 1.2);
        const block = run.text.length * CL;
        run.text.forEach((t, n) => {
          const ty = y + (row.h - block) / 2 + (n + 1) * CL - 1.8;
          items.push({ type: 'text', x: x + w / 2, y: ty, text: t, size: CF, weight: 700, anchor: 'middle', fill: paint.textInk });
          // The codes struck out of work that went ahead are drawn through, as on screen.
          if (n === 0 && run.e.kind === 'support') {
            const codes = t.replace(/ cancelled$/, '');
            const tw = textWidth(t, CF, 'F2');
            const cw = textWidth(codes, CF, 'F2');
            const x0 = x + w / 2 - tw / 2;
            items.push({ type: 'line', x1: x0, y1: ty - CF * 0.3, x2: x0 + cw, y2: ty - CF * 0.3, stroke: paint.textInk, strokeWidth: 0.8 });
          }
        });
      }
      y += row.h;
      items.push({ type: 'line', x1: 0, y1: y, x2: width, y2: y, stroke: INK.rule, strokeWidth: 0.4 });
    }
    const bottom = y;
    if (!slice.length) {
      items.push({ type: 'text', x: 4, y: y + 14, text: 'Nothing cancelled in these days.', size: CF + 0.6, fill: INK.muted });
    }
    // The rules: a hairline a day, stronger on Mondays and under the heads.
    days.forEach((d, i) => {
      const x = metaW + i * dayW;
      const monday = weekdayLetter(d).toUpperCase() === 'M';
      items.push({ type: 'line', x1: x, y1: MONTH_H, x2: x, y2: bottom, stroke: monday ? INK.ruleStrong : INK.rule, strokeWidth: monday ? 0.6 : 0.3 });
    });
    items.push({ type: 'line', x1: width, y1: 0, x2: width, y2: bottom, stroke: INK.rule, strokeWidth: 0.3 });
    items.push({ type: 'line', x1: actW, y1: MONTH_H, x2: actW, y2: bottom, stroke: INK.rule, strokeWidth: 0.4 });
    items.push({ type: 'line', x1: 0, y1: headH, x2: width, y2: headH, stroke: INK.ruleStrong, strokeWidth: 0.7 });

    // What each colour says, in words beside it.
    const keyTop = Math.max(bottom, headH) + (slice.length ? 10 : 24);
    let kx = 0;
    const key = [
      [runPaint('activity', 'BART', red), 'BART'],
      [runPaint('activity', 'Hitachi', red), 'Hitachi'],
      [runPaint('activity', 'Other', red), 'Other'],
      [runPaint('activity', null, red), 'No reason yet'],
      [{ fill: null, outline: INK.muted }, 'Outlined: a BART resource struck out, the activity went ahead'],
    ];
    for (const [paint, said] of key) {
      box(items, kx, keyTop, 12, 8, paint, 1);
      items.push({ type: 'text', x: kx + 16, y: keyTop + 7, text: said, size: CF, fill: INK.text });
      kx += 16 + textWidth(said, CF) + 14;
    }
    return { width, height: keyTop + KEY_H - 10, items, meta: { palette: PALETTE } };
  };

  let slice = [];
  let used = headH + KEY_H;
  for (const row of laid) {
    if (slice.length && used + row.h > room) {
      scenes.push(pageOf(slice));
      slice = [];
      used = headH + KEY_H;
    }
    slice.push(row);
    used += row.h;
  }
  scenes.push(pageOf(slice));
  return scenes;
}

/* ── The PDFs ──────────────────────────────────────────────────────────── */

/**
 * The list as the Cancellations tab draws it, as a PDF — on as many pages as
 * it needs, every one at full size. Returns a Blob, for `saveFile()`.
 *
 * @param {object[]} lines      `logLines()`
 * @param {object} [o]
 * @param {object} [o.stats]    `logStats()`, drawn as the tab's chips
 * @param {string} [o.note]
 * @param {string} [o.title]
 * @param {string} [o.subtitle]
 * @param {string} [o.pageSize] a key of `PAGE_SIZES`
 * @param {string} [o.footer]
 */
export function cancellationListPdf(lines, { stats, note = '', title = 'Cancellation log', subtitle = '', pageSize = 'a4', footer } = {}) {
  const page = { pageSize, orientation: 'landscape', title };
  const scenes = listScenes(lines, { stats, note, page });
  return fitPagesToPdf(scenes.map((scene) => ({ scene, maxScale: 1 })), { ...page, subtitle, footer, author: 'CX Timeline' });
}

/**
 * The delay log as a PDF: the list first, then the same events as a calendar
 * of the days it covers. Returns a Blob.
 *
 * @param {object} o
 * @param {object[]} o.events     `cancellationLog()` events, as listed
 * @param {string[]} o.days       the days the log covers
 * @param {string} [o.red]        the legend's cancellation colour, `RRGGBB`
 * @param {string} [o.today]      an ISO date to mark on the calendar
 * @param {(id: any) => string} [o.who]  an author's name from its id
 * @param {string} [o.title]
 * @param {string} [o.subtitle]   the span in words; the dates when not given
 * @param {string} [o.note]       a line under the counts saying what is listed
 * @param {string} [o.pageSize]   a key of `PAGE_SIZES`
 * @param {string} [o.footer]
 */
export function delayLogPdf({ events, days, red = 'FF0000', today = null, who, title = 'Delay log', subtitle = '', note = '', pageSize = 'a4', footer }) {
  const page = { pageSize, orientation: 'landscape', title };
  const list = listScenes(logLines(events, { who }), { stats: logStats(events), note, page });
  const calendar = calendarScenes(calendarCells(events), { days, red, today, page });
  const span = days.length ? `${dayText(days[0])} to ${dayText(days[days.length - 1])}` : '';
  return fitPagesToPdf([
    ...list.map((scene) => ({ scene, maxScale: 1, subtitle: `${subtitle || span}  ·  As a list` })),
    ...calendar.map((scene) => ({ scene, maxScale: 1, subtitle: `${subtitle || span}  ·  As a calendar` })),
  ], { ...page, footer, author: 'CX Timeline' });
}
