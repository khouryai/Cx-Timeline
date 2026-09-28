/**
 * The look-ahead, one day at a time.
 *
 * On a laptop the 4WLA is drawn the way the workbook is — a hundred days across,
 * a hundred and forty rows down — because somebody has the spreadsheet open
 * beside it and the two must be recognisably the same thing. On a phone that is
 * a spreadsheet through a letterbox. So this asks the question somebody on site
 * actually has, "what is on, and who is on it", and answers it for one day:
 * `agendaFor()` in `core/lookahead.js`, over the same parse every other screen
 * reads (`parsedView()`), against the same legend.
 *
 * The strip across the top is the four weeks from this Monday — the window the
 * look-ahead is maintained for — with the day's count of work under each date.
 * "Only mine" narrows to the activities whose Resource row names the person
 * signed in, matched through the same register the week plan uses, so a first
 * name and a recorded alias count and a guess does not.
 *
 * Read-only for everybody, as the calendar is. Nothing here writes.
 *
 * Imports: util, dates, rc, core/lookahead, icons, components, rc_util.
 */

import { el, clear } from '../core/util.js';
import { toISO, addDays, DAYS_SHORT } from '../core/dates.js';
import * as rc from '../core/rc.js';
import { agendaFor } from '../core/lookahead.js';
import { icon } from '../ui/icons.js';
import { textInput, badge, emptyState } from '../ui/components.js';
import {
  parsedView, todayISO, weekStart, isoToMs, dayLabel, byId, foldName,
  nameRegister, nameResolver, locationRegister,
} from '../ui/rc_util.js';

let selected = null;
let mineOnly = false;
let filterText = '';

export async function render(root) {
  const me = rc.me();
  const [snapshot, legendRows, everybody, aliases, locations, locAliases] = await Promise.all([
    rc.latestSnapshot(),
    rc.listLegend(),
    rc.listPeople().catch(() => []),
    rc.listPersonAliases().catch(() => []),
    rc.listLocations({ includeInactive: true }).catch(() => []),
    rc.listLocationAliases().catch(() => []),
  ]);

  if (!snapshot?.grid?.rows?.length) {
    root.appendChild(emptyState({
      iconName: 'calendar',
      title: 'Nothing read yet',
      message: 'Nobody has read the look-ahead workbook into the calendar yet. Once an administrator '
        + 'has, it is here for everybody.',
    }));
    return;
  }

  const view = parsedView(snapshot, legendRows);
  const dated = view.days.filter((d) => d.date);
  if (!dated.length) {
    root.appendChild(emptyState({
      iconName: 'warning',
      title: 'No dates on this sheet',
      message: 'The workbook’s days could not be pinned to a year, so there is no "today" to '
        + 'show. The full calendar on a computer still draws it as the sheet writes it.',
    }));
    return;
  }

  /* The four weeks from this Monday, which is what a four-week look-ahead is
     for. A sheet wholly outside that — last month's, or one read far ahead —
     is shown whole rather than as nothing. */
  const today = todayISO();
  const monday = toISO(weekStart(isoToMs(today)));
  const last = toISO(addDays(isoToMs(monday), 27));
  const inWindow = dated.filter((d) => d.date >= monday && d.date <= last);
  const dates = (inWindow.length ? inWindow : dated).map((d) => d.date);
  if (!selected || !dates.includes(selected)) selected = dates.includes(today) ? today : dates[0];

  const resolve = nameResolver(nameRegister(everybody, aliases));
  const isMine = (name) => Boolean(me) && resolve(foldName(name)).id === me.id;
  const places = locationRegister(locations, locAliases);
  const locById = byId(locations);
  /* A place by the name the register gives it; the sheet's code where the
     register does not know it. The code is what the workbook types, not what
     anybody calls the site. */
  const placeName = (written) => {
    const found = locById.get(places.get(foldName(written)));
    return found ? found.name : written;
  };

  const agendas = new Map(dates.map((iso) => [iso, agendaFor(view, iso)]));
  const terms = () => filterText.toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
  const shows = (item) => {
    if (mineOnly && !item.names.some(isMine)) return false;
    const wanted = terms();
    if (!wanted.length) return true;
    const hay = [item.title, item.location, placeName(item.location), item.section, item.meaning,
      item.value, ...item.names, ...item.details.map((d) => d.value)].join(' ').toLowerCase();
    return wanted.some((t) => hay.includes(t));
  };

  /* ── Controls: drawn once, never rebuilt under the caret ──────────────── */

  root.appendChild(el('p', {
    class: 'm-note m-sheet-age',
    text: `From the workbook as read ${readAt(snapshot.taken_at)}.`,
  }));

  const strip = el('div', { class: 'm-strip', role: 'tablist', 'aria-label': 'Day' });
  const search = textInput({ value: filterText, placeholder: 'Filter this day', type: 'search' });
  search.setAttribute('aria-label', 'Filter the look-ahead');
  search.addEventListener('input', () => { filterText = search.value; draw(); });
  const mine = el('button', {
    class: 'm-chip m-mine-toggle',
    type: 'button',
    'aria-pressed': String(mineOnly),
    html: `${icon('user', { size: 14 })}<span>Only mine</span>`,
    onClick: () => {
      mineOnly = !mineOnly;
      mine.setAttribute('aria-pressed', String(mineOnly));
      draw();
    },
  });
  const agenda = el('div', { class: 'm-agenda' });

  root.append(
    strip,
    el('div', { class: 'm-la-controls' }, [search, me ? mine : null]),
    agenda,
  );

  /* A sideways swipe moves a day, which is how a phone expects to page. Only a
     clearly horizontal one: a vertical scroll that drifts must stay a scroll. */
  let touch = null;
  agenda.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    touch = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  agenda.addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return;
    const at = dates.indexOf(selected) + (dx < 0 ? 1 : -1);
    if (at >= 0 && at < dates.length) choose(dates[at]);
  }, { passive: true });

  function choose(iso) {
    selected = iso;
    draw();
    strip.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  function draw() {
    drawStrip();
    drawAgenda();
  }

  function drawStrip() {
    clear(strip);
    for (const iso of dates) {
      const ms = isoToMs(iso);
      const count = (agendas.get(iso)?.items || []).filter(shows).length;
      const d = new Date(ms);
      strip.appendChild(el('button', {
        class: ['m-strip-day', d.getUTCDay() === 1 ? 'm-strip-monday' : '', iso === today ? 'm-strip-today' : '',
          d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 'm-strip-weekend' : ''].filter(Boolean).join(' '),
        type: 'button',
        role: 'tab',
        'aria-selected': String(iso === selected),
        'aria-label': `${dayLabel(iso, 'dayFull')}, ${count} activit${count === 1 ? 'y' : 'ies'}`,
        onClick: () => choose(iso),
      }, [
        el('span', { class: 'm-strip-dow', text: DAYS_SHORT[d.getUTCDay()] }),
        el('span', { class: 'm-strip-num', text: String(d.getUTCDate()) }),
        el('span', { class: 'm-strip-count', text: count ? String(count) : '' }),
      ]));
    }
  }

  function drawAgenda() {
    clear(agenda);
    const day = agendas.get(selected);
    agenda.appendChild(el('h2', {
      class: 'm-agenda-title',
      text: dayLabel(selected, 'dayFull') + (selected === today ? ' · Today' : ''),
    }));

    const items = (day?.items || []).filter(shows);
    if (!items.length) {
      agenda.appendChild(el('p', {
        class: 'm-empty-day',
        text: mineOnly
          ? 'The look-ahead does not name you on anything this day.'
          : terms().length ? 'Nothing this day matches the filter.' : 'Nothing scheduled this day.',
      }));
    }

    let section = null;
    for (const item of items) {
      if (item.section && item.section !== section) {
        section = item.section;
        agenda.appendChild(el('div', { class: 'rc-eyebrow m-section', text: section }));
      }
      agenda.appendChild(itemCard(item));
    }

    const away = (day?.away || []).filter((a) => !mineOnly || a.names.some(isMine));
    if (away.length) {
      agenda.appendChild(el('div', { class: 'rc-eyebrow m-section', text: 'Not on site' }));
      agenda.appendChild(el('div', { class: 'm-away' }, away.map((a) => el('div', { class: 'm-away-row' }, [
        el('span', { class: `m-away-kind m-away-${a.kind}`, text: a.label }),
        el('span', { class: 'm-names' }, a.names.map(nameChip)),
      ]))));
    }
  }

  function nameChip(name) {
    return el('span', { class: 'm-name' + (isMine(name) ? ' m-name-me' : ''), text: name });
  }

  function itemCard(item) {
    const where = item.location ? placeName(item.location) : '';
    return el('article', {
      class: ['m-la-item', item.cancelled ? 'm-cancelled' : '', item.names.some(isMine) ? 'm-mine' : '']
        .filter(Boolean).join(' '),
    }, [
      /* The workbook's own colour, which is data rather than a theme value —
         the same thing the grid on a computer paints its cells with. */
      el('span', {
        class: 'm-swatch' + (item.hex ? '' : ' m-swatch-none'),
        style: item.hex ? `background:#${item.hex}` : null,
        'aria-hidden': 'true',
      }),
      el('div', { class: 'm-la-body' }, [
        el('div', { class: 'm-la-title', text: item.title || '—' }),
        el('div', { class: 'm-task-meta' }, [
          where ? el('span', { class: 'm-where', html: icon('pin', { size: 13 }) }, [where]) : null,
          item.cancelled
            ? badge(item.meaning || 'Cancelled', 'bad')
            : item.meaning ? el('span', { text: item.meaning })
              : item.hex ? el('span', { class: 'm-hint', text: 'Colour not in the legend' }) : null,
          item.value && !/^x$/i.test(item.value) ? el('span', { class: 'm-mono', text: item.value }) : null,
        ]),
        item.names.length ? el('div', { class: 'm-names' }, item.names.map(nameChip)) : null,
        item.details.length
          ? el('details', { class: 'm-details' }, [
            el('summary', { text: 'Details' }),
            el('dl', {}, item.details.flatMap((d) => [
              el('dt', { text: d.heading || '—' }),
              el('dd', { text: d.value }),
            ])),
          ])
          : null,
      ]),
    ]);
  }

  draw();
  requestAnimationFrame(() => {
    strip.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
}

/**
 * How stale the sheet is, as an age rather than a clock time. An age needs no
 * timezone, and "read 3 days ago" is the fact somebody on site can act on.
 */
function readAt(takenAt) {
  const ms = Date.parse(takenAt || '');
  if (!Number.isFinite(ms)) return 'earlier';
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
