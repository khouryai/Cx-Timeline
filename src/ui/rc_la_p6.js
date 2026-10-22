/**
 * Look-ahead → P6 activities: the schedule's IDs, imported from an extract,
 * and the reasons a row has none — with the picker the editor links a row by.
 *
 * The look-ahead's Activity ID column is how a row is joined to the schedule
 * and to anything else keyed on P6, so it is filled from the schedule's own
 * list rather than typed from memory. This module reads that list in from
 * whatever extract the scheduler sends (`.xlsx`, `.csv` or P6's own `.xer`),
 * shows what an import would change before writing anything, and keeps the
 * short list of reasons a row may give instead — Troubleshooting, Regression,
 * Support. The rules are `core/la_p6.js`; this is where they meet a person.
 *
 * Imports: util, rc, core/la_p6, core/la_edit, io/lookahead, icons,
 *          components, rc_util, rc_la_state, rc_ingest.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import * as p6 from '../core/la_p6.js';
import { newId } from '../core/la_edit.js';
import { readZip, readSheets, parseSheet } from '../io/lookahead.js';
import { icon } from './icons.js';
import { textInput, toast, emptyState, openModal, checkbox, badge, field } from './components.js';
import { notifyChanged, formModal } from './rc_util.js';
import { la, table } from './rc_la_state.js';
import { EDITOR_SOURCE } from './rc_ingest.js';

/* ══════════════════════════════════════════════════════════════════════════
   The register, as everything here reads it
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The activities and the reasons, with their lookups (`p6Index()`).
 *
 * `available` is false on a database that has not had `rc_schema.sql` run
 * since P6 activities arrived: the reads are refused, and every P6 control
 * stands down and says what to run, rather than offering an empty list as if
 * nothing had ever been imported.
 */
export async function loadP6() {
  try {
    const [entries, flags] = await Promise.all([rc.listP6Activities(), rc.listP6Flags({ includeRetired: true })]);
    return { available: true, entries, flags, index: p6.p6Index(entries, flags) };
  } catch (err) {
    return { available: false, error: err, entries: [], flags: [], index: p6.p6Index([], []) };
  }
}

const SCHEMA_BEHIND = 'This database has no P6 tables yet. Run supabase/rc_schema.sql — Organisation → Settings says '
  + 'which version the database is at.';

/** A row's Activity ID in words, for the hover — the same wording in the editor and the read view. */
export function p6Words(value, status) {
  if (status.kind === 'linked') {
    const e = status.entry;
    return `${e.activity_id} — ${e.name}${e.wbs ? ` (${e.wbs})` : ''}${e.missing ? ' · not in the latest P6 extract' : ''}`;
  }
  if (status.kind === 'flagged') {
    return `Not in P6: ${status.flag.label}${status.flag.active === false ? ' (a retired reason)' : ''}`;
  }
  if (status.kind === 'unknown') return `${String(value).trim()} is not in the P6 list`;
  return '';
}

/* ══════════════════════════════════════════════════════════════════════════
   Importing an extract
   ═══════════════════════════════════════════════════════════════════════ */

/** A text file's characters: UTF-8 where it is, Windows' own encoding where it is not — as an .xer often is. */
async function textOf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * The activities in an extract, and where in it they were found.
 *
 * A workbook is read sheet by sheet until one has an Activity ID and an
 * Activity Name column — TASK first, which is where P6's own spreadsheet
 * export puts them — so a cover sheet or a sheet of relationships in front of
 * the activities does not stop it. Hidden sheets are passed over.
 */
async function readExtract(file) {
  const kind = p6.p6FileKind(file.name);
  if (!kind) {
    throw new Error(`${file.name} is not a file this reads. Export the activities from P6, or save them from Excel, `
      + 'as .xlsx, .csv or .xer.');
  }
  if (kind === 'xer') return { ...p6.readXer(await textOf(file)), from: 'its TASK table' };
  if (kind === 'text') return { ...p6.readP6Rows(p6.splitTable(await textOf(file))), from: 'the file' };
  const buffer = await file.arrayBuffer();
  const sheets = readSheets(readZip(buffer)).filter((s) => s.state === 'visible' && s.zipPath);
  const ordered = [...sheets.filter((s) => /^task$/i.test(s.name)), ...sheets.filter((s) => !/^task$/i.test(s.name))];
  let first = null;
  for (const sheet of ordered) {
    const read = p6.readP6Rows(p6.gridRows(parseSheet(buffer, sheet.name)));
    if (read.headerRow >= 0) return { ...read, from: `the "${sheet.name}" sheet` };
    first = first || read;
  }
  return first || { activities: [], warnings: ['That workbook has no visible sheet to read.'], from: '' };
}

const count = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Pick an extract, see what importing it would change, and import it.
 *
 * Nothing is written until the preview is confirmed: how many activities were
 * read and from where, the first few as they were read (so a column mapped
 * wrongly is caught before it is imported), how many are new or renamed, and —
 * said out loud — how many in the register this extract leaves out, which are
 * marked missing rather than deleted. `host` holds the file input while it is
 * open; `onDone` runs once the import has landed.
 *
 * @param {{ host?: HTMLElement | null, onDone?: Function | null }} [options]
 */
export function openP6Import({ host = null, onDone = null } = {}) {
  const where = host || document.body;
  for (const old of where.querySelectorAll(':scope > input.p6-file')) old.remove();
  const input = el('input', { class: 'p6-file', type: 'file', accept: '.xlsx,.xlsm,.csv,.tsv,.txt,.xer', hidden: true });
  where.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    let read;
    let register;
    try {
      [read, register] = await Promise.all([readExtract(file), rc.listP6Activities()]);
    } catch (err) {
      toast({ tone: 'bad', message: err.message, timeout: 12000 });
      return;
    }
    if (!read.activities.length) {
      toast({ tone: 'bad', message: `Nothing to import from ${file.name}: ${read.warnings.join(' ') || 'no activities in it.'}`, timeout: 12000 });
      return;
    }
    previewImport(file, read, register, onDone);
  });
  input.click();
  return input;
}

function previewImport(file, read, register, onDone) {
  const diff = p6.p6Diff(register, read.activities);
  const lines = [
    `${count(read.activities.length, 'activity', 'activities')} read from ${read.from}.`,
    register.length
      ? [
        diff.added.length ? `${count(diff.added.length, 'new one')}` : null,
        diff.changed.length ? `${diff.changed.length.toLocaleString()} renamed or moved in the WBS` : null,
        diff.back.length ? `${diff.back.length.toLocaleString()} back after a previous extract left them out` : null,
        diff.unchanged ? `${diff.unchanged.toLocaleString()} unchanged` : null,
      ].filter(Boolean).join(' · ') + '.'
      : 'The first import: the list is empty until this one.',
  ];
  const sample = read.activities.slice(0, 5);
  openP6Preview({
    title: `Import ${file.name}`,
    lines,
    missing: diff.missing,
    warnings: read.warnings || [],
    sample,
    confirmLabel: `Import ${count(read.activities.length, 'activity', 'activities')}`,
    onConfirm: async () => {
      const done = await rc.importP6Activities(read.activities, { importId: newId() });
      toast({
        tone: 'good',
        message: `Imported ${count(done.written, 'P6 activity', 'P6 activities')}`
          + (done.missing ? ` — ${count(done.missing, 'activity', 'activities')} no longer in the extract ${done.missing === 1 ? 'was' : 'were'} kept and marked.` : '.'),
        timeout: 7000,
      });
      notifyChanged('p6');
      if (onDone) await onDone(done);
    },
  });
}

function openP6Preview({ title, lines, missing, warnings, sample, confirmLabel, onConfirm }) {
  formModal({
    title,
    confirmLabel,
    body: el('div', { class: 'lae-form p6-preview' }, [
      ...lines.map((text) => el('p', { class: 'p6-preview-line', text })),
      missing.length
        ? el('p', {
          class: 'rc-hint rc-warn',
          text: `${count(missing.length, 'activity', 'activities')} in the calendar's list ${missing.length === 1 ? 'is' : 'are'} not in this extract `
            + `(${missing.slice(0, 4).map((a) => a.activity_id).join(', ')}${missing.length > 4 ? '…' : ''}). `
            + 'They are kept and marked, never deleted — a row of the look-ahead may still name one.',
        })
        : null,
      ...warnings.map((text) => el('p', { class: 'rc-hint', text })),
      el('div', { class: 'rc-eyebrow', text: 'As read — check the columns are the right ones' }),
      table(['Activity ID', 'Activity name', 'WBS'], sample.map((a) => el('tr', {}, [
        el('td', { class: 'rc-mono', text: a.activity_id }),
        el('td', { text: a.name }),
        el('td', { class: 'rc-hint', text: a.wbs || '—' }),
      ]))),
    ]),
    onConfirm,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Choosing one
   ═══════════════════════════════════════════════════════════════════════ */

const SHOWN = 60;

/**
 * Choose what an Activity ID says: a P6 activity, found by typing any part of
 * its name, its ID or its WBS, or a reason the row has none.
 *
 * Before anything is typed it lists the activities the look-ahead already
 * names, most-named first — linking the next line of a week of work to the
 * activity the last line went to is the common case. Each says how many rows
 * name it, so linking another is a choice made knowingly, never refused.
 *
 * `onPick` gets `{ value, entry, flag, fill }`: the text to write, the
 * activity or reason it is, and whether to fill a blank description with the
 * activity's name. `onClear` offers taking the ID off; `onImport` offers an
 * import when the list is empty.
 *
 * @param {{ title: string, subtitle?: string, p6: any, uses?: Map<string, number>, query?: string,
 *   current?: string | null, onPick: Function, onClear?: Function | null, onImport?: Function | null }} options
 */
export function openP6Picker({
  title, subtitle = '', p6: ctx, uses = new Map(), query = '', current = null, onPick, onClear = null, onImport = null,
}) {
  let handle = null;
  let found = [];
  let cursor = 0;
  const fill = checkbox({ label: 'Fill a blank description with the P6 name', checked: true });
  fill.classList.add('p6-fill');
  const search = textInput({
    value: query,
    placeholder: ctx.entries.length
      ? `Search ${count(ctx.entries.length, 'activity', 'activities')} — name, ID or WBS`
      : 'No P6 activities imported yet',
    'aria-label': 'Search P6 activities',
  });
  search.classList.add('p6-search');
  const note = el('div', { class: 'rc-hint p6-picker-note' });
  const list = el('div', { class: 'cx-picker-list p6-picker-list', role: 'listbox', 'aria-label': 'P6 activities' });

  const take = (choice) => {
    handle?.close();
    onPick({ ...choice, fill: fill.querySelector('input').checked });
  };

  const draw = () => {
    clear(list);
    const q = search.value.trim();
    if (!ctx.entries.length) {
      list.appendChild(emptyState({
        iconName: 'upload',
        title: 'No P6 activities yet',
        message: 'Import an extract from P6 — an .xlsx, .csv or .xer with Activity ID and Activity Name columns — and '
          + 'its activities are offered here.',
        action: onImport ? { label: 'Import a P6 extract…', onClick: () => { handle?.close(); onImport(); } } : null,
      }));
      note.textContent = '';
      return;
    }
    if (q) {
      found = p6.searchP6(ctx.entries, q, { limit: SHOWN + 1 });
      note.textContent = found.length
        ? (found.length > SHOWN ? `The first ${SHOWN} — keep typing to narrow it.` : '')
        : `Nothing in P6 matches "${q}". Try fewer words, or part of the ID.`;
      found = found.slice(0, SHOWN);
    } else {
      found = [...uses.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }))
        .map(([id]) => ctx.index.byId.get(id))
        .filter(Boolean)
        .slice(0, SHOWN);
      note.textContent = found.length
        ? 'Already on the look-ahead — or type to search them all.'
        : `Type any part of an activity's name, its ID or its WBS.`;
    }
    cursor = Math.min(cursor, Math.max(0, found.length - 1));
    found.forEach((entry, i) => {
      const n = uses.get(entry.activity_id) || 0;
      list.appendChild(el('div', {
        class: `cx-picker-item p6-item${i === cursor ? ' on' : ''}${entry.activity_id === current ? ' p6-current' : ''}`,
        role: 'option',
        'aria-selected': String(i === cursor),
        dataset: { id: entry.activity_id },
        onClick: () => take({ value: entry.activity_id, entry }),
      }, [
        el('span', { class: 'p6-id', text: entry.activity_id }),
        el('span', { class: 'p6-name', text: entry.name }),
        el('span', { class: 'p6-meta' }, [
          entry.wbs ? el('span', { text: entry.wbs }) : null,
          n ? el('span', { class: 'p6-uses', text: `on ${count(n, 'row')}` }) : null,
          entry.activity_id === current ? el('span', { class: 'p6-uses', text: 'this row' }) : null,
          entry.missing ? badge('Not in the latest extract', 'warn') : null,
        ].filter(Boolean)),
      ]));
    });
    list.querySelector('.p6-item.on')?.scrollIntoView({ block: 'nearest' });
  };

  search.addEventListener('input', () => { cursor = 0; draw(); });
  search.addEventListener('keydown', (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && found.length) {
      e.preventDefault();
      cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
      draw();
    } else if (e.key === 'Enter' && found[cursor]) {
      e.preventDefault();
      take({ value: found[cursor].activity_id, entry: found[cursor] });
    }
  });

  const flags = ctx.flags.filter((f) => f.active !== false);
  const reasons = el('div', { class: 'p6-reasons' }, [
    el('div', { class: 'rc-eyebrow', text: 'Not in P6 — say why' }),
    flags.length
      ? el('div', { class: 'p6-reason-list' }, flags.map((flag) => el('button', {
        class: `cx-btn mini p6-reason${String(current || '').trim().toLowerCase() === flag.label.toLowerCase() ? ' primary' : ''}`,
        type: 'button',
        text: flag.label,
        title: `No P6 activity: ${flag.label}`,
        onClick: () => take({ value: flag.label, flag }),
      })))
      : el('p', { class: 'rc-hint', text: 'No reasons on the list. Add them under Look-ahead → P6 activities.' }),
  ]);

  draw();
  handle = openModal({
    title,
    subtitle,
    size: 'wide',
    body: el('div', { class: 'p6-picker' }, [search, fill, note, list, reasons]),
    actions: [
      { label: 'Cancel' },
      onClear ? { label: 'Take the Activity ID off', onClick: () => onClear() } : null,
    ].filter(Boolean),
  });
  setTimeout(() => {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }, 40);
  return handle;
}

/* ══════════════════════════════════════════════════════════════════════════
   The section
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Look-ahead → P6 activities.
 *
 * What was imported and when, how the look-ahead's activities stand against
 * it — linked, flagged, or still to do, one press from the editor — a search
 * over the whole list, and the reasons a row may give instead of an ID.
 */
export async function renderP6(host) {
  const [ctx, rows, people] = await Promise.all([
    loadP6(),
    rc.listLaRows().catch(() => []),
    rc.listPeople({ includeInactive: true }).catch(() => []),
  ]);
  const written = la.source === EDITOR_SOURCE;

  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'P6 activities' }),
    ctx.available ? el('button', {
      class: 'cx-btn mini primary p6-import',
      type: 'button',
      html: icon('upload', { size: 12 }) + '<span>Import a P6 extract…</span>',
      title: 'An .xlsx, .csv or .xer from P6 with Activity ID and Activity Name columns',
      onClick: () => openP6Import({ host }),
    }) : null,
  ].filter(Boolean)));

  if (!ctx.available) {
    host.appendChild(emptyState({ iconName: 'warning', title: 'Not set up in this database yet', message: SCHEMA_BEHIND }));
    return;
  }

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'The schedule\'s activity IDs and names, read from a P6 extract. In Edit, typing in a row\'s Activity ID '
      + 'searches them by name or ID, and Alt+K links every selected activity at once — several rows may name one '
      + 'activity. A row with no P6 activity says why, from the list at the bottom. Importing again brings names up to '
      + 'date and adds new activities; one a later extract leaves out is kept and marked, never deleted.',
  }));

  if (!ctx.entries.length) {
    host.appendChild(emptyState({
      iconName: 'upload',
      title: 'Nothing imported yet',
      message: 'Export the activities from P6 — Activity ID and Activity Name are all it needs; WBS is used if it is '
        + 'there — as .xlsx, .csv or .xer, and import it here.',
      action: { label: 'Import a P6 extract…', onClick: () => openP6Import({ host }) },
    }));
  } else {
    const newest = ctx.entries.reduce((a, b) => (String(a.imported_at || '') > String(b.imported_at || '') ? a : b));
    const who = people.find((p) => p.user_id && p.user_id === newest.imported_by)?.name;
    const missing = ctx.entries.filter((e) => e.missing).length;
    host.appendChild(el('div', { class: 'p6-summary' }, [
      el('span', { class: 'p6-summary-count', text: count(ctx.entries.length, 'activity', 'activities') }),
      el('span', {
        class: 'rc-hint',
        style: 'margin:0',
        text: [
          newest.imported_at ? `last imported ${new Date(newest.imported_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : null,
          who ? `by ${who}` : null,
          missing ? `${missing.toLocaleString()} not in the latest extract` : null,
        ].filter(Boolean).join(' · '),
      }),
    ]));
  }

  /* ── How the look-ahead stands ─────────────────────────────────────── */
  const coverage = p6.p6Coverage(rows, ctx.index);
  if (written && coverage.activities) {
    host.appendChild(el('div', { style: 'height:20px' }));
    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'The look-ahead\'s activities' }),
      el('button', {
        class: 'cx-btn mini',
        type: 'button',
        html: icon('edit', { size: 12 }) + '<span>Link them in the editor</span>',
        onClick: () => { la.section = 'calendar'; la.editing = true; notifyChanged('lookahead'); },
      }),
    ]));
    const todo = coverage.empty + coverage.unknown;
    host.appendChild(el('div', { class: 'p6-coverage' }, [
      stat('Linked to P6', coverage.linked, 'good'),
      stat('Not in P6, with a reason', coverage.flagged, 'info'),
      stat('Still to link', todo, todo ? 'warn' : 'good'),
    ]));
    const said = [
      coverage.byFlag.size ? `Reasons given: ${[...coverage.byFlag.entries()].map(([label, n]) => `${label} ${n}`).join(', ')}.` : null,
      coverage.unknown ? `${count(coverage.unknown, 'activity', 'activities')} ${coverage.unknown === 1 ? 'carries' : 'carry'} an ID the P6 list does not have `
        + `(${[...new Set(rows.filter((r) => r.kind === 'activity' && !r.archived && p6.p6Status(r.activity_id, ctx.index).kind === 'unknown').map((r) => r.activity_id.trim()))].slice(0, 5).join(', ')}) — `
        + 'a typo, or an activity from an older extract.' : null,
    ].filter(Boolean).join(' ');
    if (said) host.appendChild(el('p', { class: 'rc-hint', text: said }));
  } else if (!written) {
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Rows are linked in the look-ahead editor. The look-ahead is still read from the workbook here, so there is '
        + 'nothing to link yet — the list can be imported ahead of that.',
    }));
  }

  /* ── The list ──────────────────────────────────────────────────────── */
  if (ctx.entries.length) {
    host.appendChild(el('div', { style: 'height:20px' }));
    host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Find an activity' })]));
    const find = textInput({ placeholder: 'Name, ID or WBS — "ixl regression", "1040"', mini: true, 'aria-label': 'Find a P6 activity' });
    find.classList.add('p6-find');
    const results = el('div');
    /* The results are redrawn, never the box: rebuilding a field under the
       caret is the trap this project keeps relearning. */
    const drawResults = () => {
      clear(results);
      const q = find.value.trim();
      const shown = q
        ? p6.searchP6(ctx.entries, q, { limit: 101 })
        : [...coverage.uses.keys()].map((id) => ctx.index.byId.get(id)).filter(Boolean)
          .sort((a, b) => a.activity_id.localeCompare(b.activity_id, undefined, { numeric: true }));
      if (!shown.length) {
        results.appendChild(el('p', {
          class: 'rc-hint',
          text: q ? `Nothing matches "${q}".` : 'No row of the look-ahead names a P6 activity yet. Type above to search the list.',
        }));
        return;
      }
      if (!q) results.appendChild(el('p', { class: 'rc-hint', style: 'margin:0 0 6px', text: 'The activities the look-ahead names. Type to search them all.' }));
      const t = table(['Activity ID', 'Name', 'WBS', 'Rows'], shown.slice(0, 100).map((e) => el('tr', {
        class: e.missing ? 'rc-inactive' : '',
      }, [
        el('td', { class: 'rc-mono', text: e.activity_id }),
        el('td', {}, [e.name, e.missing ? el('span', { style: 'margin-left:6px' }, [badge('Not in the latest extract', 'warn')]) : null].filter(Boolean)),
        el('td', { class: 'rc-hint', text: e.wbs || '—' }),
        el('td', { class: 'rc-num', text: String(coverage.uses.get(e.activity_id) || '') }),
      ])));
      t.querySelector('table').dataset.plain = '1';
      results.appendChild(t);
      if (shown.length > 100) results.appendChild(el('p', { class: 'rc-hint', text: 'The first hundred — keep typing to narrow it.' }));
    };
    find.addEventListener('input', drawResults);
    host.appendChild(el('div', { style: 'max-width:340px;margin-bottom:10px' }, [find]));
    host.appendChild(results);
    drawResults();
  }

  /* ── Reasons ───────────────────────────────────────────────────────── */
  host.appendChild(el('div', { style: 'height:24px' }));
  await reasonsAdmin(host, ctx, rows);
}

function stat(label, n, tone) {
  return el('div', { class: `p6-stat p6-stat-${tone}` }, [
    el('span', { class: 'p6-stat-n', text: n.toLocaleString() }),
    el('span', { class: 'p6-stat-label', text: label }),
  ]);
}

/**
 * Why a row has no P6 activity: the reasons the editor offers beside the
 * activities. Written into the row as the Activity ID, so a reason is reworded
 * only while no row carries it — reworded under them, those rows would stop
 * matching it — and retired rather than deleted, so the rows that give it keep
 * saying so.
 */
async function reasonsAdmin(host, ctx, rows) {
  const flags = ctx.flags;
  const usedBy = (flag) => rows.filter((r) => r.kind === 'activity'
    && String(r.activity_id || '').trim().toLowerCase() === flag.label.trim().toLowerCase()).length;
  const wrap = el('div', { class: 'p6-flags-admin' });
  wrap.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'Rows with no P6 activity' }),
    el('button', {
      class: 'cx-btn mini primary',
      type: 'button',
      html: icon('plus', { size: 12 }) + '<span>Add a reason</span>',
      onClick: () => editFlag(null, ctx),
    }),
  ]));
  wrap.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Work the schedule does not carry still goes on the look-ahead — it says why instead of an ID. The editor '
      + 'offers these beside the P6 activities, and the reason is written in the Activity ID column, so the export and '
      + 'everything else reading the look-ahead carry it too.',
  }));
  if (!flags.length) {
    wrap.appendChild(el('p', { class: 'rc-hint', text: 'No reasons yet.' }));
  } else {
    wrap.appendChild(table(['Reason', 'Rows', ''], flags.map((f) => {
      const used = usedBy(f);
      return el('tr', { class: f.active === false ? 'rc-inactive' : '' }, [
        el('td', { text: f.label }),
        el('td', { class: 'rc-num', text: used ? String(used) : '' }),
        el('td', { style: 'text-align:right;white-space:nowrap' }, [
          used ? null : el('button', { class: 'cx-btn mini ghost', type: 'button', text: 'Edit', onClick: () => editFlag(f, ctx) }),
          el('button', {
            class: 'cx-btn mini ghost',
            type: 'button',
            text: f.active === false ? 'Restore' : 'Retire',
            title: f.active === false ? 'Offer it again' : 'Stop offering it. Rows already flagged with it keep saying so.',
            onClick: async () => {
              try {
                await rc.updateP6Flag(f.id, { active: f.active === false });
                notifyChanged('p6');
              } catch (err) {
                toast({ tone: 'bad', message: err.message });
              }
            },
          }),
        ].filter(Boolean)),
      ]);
    })));
  }
  host.appendChild(wrap);
}

function editFlag(existing, ctx) {
  const label = textInput({ value: existing?.label || '', placeholder: 'Troubleshooting', maxlength: '60' });
  formModal({
    title: existing ? `Reason: ${existing.label}` : 'Add a reason',
    confirmLabel: existing ? 'Save' : 'Add',
    body: el('div', { class: 'lae-form' }, [
      field('Reason, as the row will say it', label, 'Written in the Activity ID column of a row with no P6 activity.'),
    ]),
    onConfirm: async () => {
      const value = label.value.trim().replace(/\s+/g, ' ');
      if (!value) throw new Error('Say what the reason is.');
      if (value.length > 60) throw new Error('Sixty characters at most — it sits in the Activity ID column.');
      const clash = ctx.flags.find((f) => f.label.trim().toLowerCase() === value.toLowerCase() && f.id !== existing?.id);
      if (clash) throw new Error(`"${clash.label}" is already on the list${clash.active === false ? ' (retired — restore it instead)' : ''}.`);
      if (ctx.index.byFold.get(value.toLowerCase()) || ctx.index.byId.get(value)) {
        throw new Error(`${value} is a P6 activity ID, so a row carrying it would read as linked to that activity.`);
      }
      if (existing) await rc.updateP6Flag(existing.id, { label: value });
      else await rc.addP6Flag({ label: value, active: true, sort: Math.max(0, ...ctx.flags.map((f) => f.sort || 0)) + 10 });
      notifyChanged('p6');
    },
  });
}
