/**
 * The four-week look-ahead, and the SARs against it.
 *
 * The look-ahead is the contractual source of truth; the resource calendar is
 * the execution record. This tab is where the two meet: it reads the workbook
 * out of the OneDrive folder, snapshots it, works out what changed since last
 * time, and lets somebody annotate the judgements the system cannot make.
 *
 * Ingestion is desktop-only in practice, and the reason is worth stating: a
 * browser cannot watch a file in a synced folder. It can be granted one, but it
 * cannot poll for changes in the background. So coverage has gaps whenever
 * nobody has the application open — and a gap that is not recorded looks
 * exactly like a week in which nothing changed. Every attempt therefore writes
 * an `rc_ingest_runs` row, and the change log renders the gaps rather than
 * showing a smooth history that is not true.
 *
 * Imports: util, events, dates, rc, filestore, io/lookahead, core/lookahead,
 *          icons, components, rc_util.
 */

import { el, clear } from '../core/util.js';
import * as rc from '../core/rc.js';
import * as filestore from '../core/filestore.js';
import { parseSheet, applyLegend } from '../io/lookahead.js';
import { keyRows, classify, relinkCandidates, countable, describe } from '../core/lookahead.js';
import { icon } from './icons.js';
import { selectInput, textInput, toast, badge, emptyState } from './components.js';
import { notifyChanged, byId, dayLabel, todayISO, formModal } from './rc_util.js';

/** Where the workbook lives, relative to the folder the plan is in. */
const LOOKAHEAD_DIR = 'lookahead';
const SAR_INBOX = 'sars/inbox';

const SECTIONS = ['changes', 'snapshots', 'sars'];
let section = 'changes';

export async function render(root) {
  if (!rc.isAdmin()) {
    root.appendChild(emptyState({
      iconName: 'lock',
      title: 'Administrators only',
      message: 'The look-ahead register is the evidence base for delay claims, and it is '
        + 'restricted in the database rather than by hiding this tab.',
    }));
    return;
  }

  const nav = el('div', { class: 'rc-tabs', style: 'margin:0 0 16px' });
  for (const id of SECTIONS) {
    nav.appendChild(el('button', {
      class: 'rc-tab',
      type: 'button',
      text: { changes: 'Changes', snapshots: 'Snapshots', sars: 'Site access' }[id],
      'aria-pressed': String(id === section),
      onClick: () => { section = id; clear(root); render(root); },
    }));
  }
  root.appendChild(nav);

  const host = el('div');
  root.appendChild(host);

  if (section === 'changes') await renderChanges(host);
  else if (section === 'snapshots') await renderSnapshots(host);
  else await renderSars(host);
}

/* ══════════════════════════════════════════════════════════════════════════
   Ingest
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Read the workbook, snapshot it if it has moved, and classify the difference.
 *
 * Deduped by content hash rather than by modified time, because OneDrive
 * re-stamps a file when it syncs whether or not anybody edited it — so
 * timestamps alone would manufacture a snapshot, and therefore a change event,
 * out of a sync.
 */
export async function ingest({ sheetName, legend, silent = false } = {}) {
  const run = { ran_at: new Date().toISOString(), outcome: 'error', note: null, file_hash: null, file_mtime: null };

  let file = null;
  try {
    /* No folder at all is a different problem from an empty one, and until
       they were told apart both said "no workbook in lookahead/" — which sent
       somebody looking in the folder for a file that was already there, on a
       machine that had never been given the folder. */
    if (!filestore.hasFolder()) {
      run.outcome = 'missing';
      run.note = 'No folder is connected on this device.';
      await rc.addIngestRun(run).catch(() => {});
      throw new Error(
        'No folder is connected on this device, so there is nowhere to read the look-ahead '
        + 'from. Open the plan folder first. A browser has to be given the folder by hand '
        + 'and cannot watch it in the background, which is why ingestion belongs in the '
        + 'desktop application.'
      );
    }

    const files = await filestore.intakeList(LOOKAHEAD_DIR);
    const workbooks = files.filter((f) => /\.xlsx$/i.test(f.name));

    // Two versions of the look-ahead means somebody's edits are about to be
    // lost. Ingesting one of them silently would be the worst possible answer.
    const conflicted = workbooks.filter((f) => f.conflict);
    if (conflicted.length) {
      run.outcome = 'conflict';
      run.note = `OneDrive kept a second copy: ${conflicted[0].name}`;
      await rc.addIngestRun(run).catch(() => {});
      throw new Error(
        `${conflicted[0].name} is a OneDrive conflict copy — two people edited the look-ahead `
        + 'and one set of changes is about to be lost. Sort that out in the folder first.'
      );
    }

    const legacy = files.filter((f) => /\.xls$|\.xlsb$/i.test(f.name));
    if (!workbooks.length && legacy.length) {
      throw new Error(`${legacy[0].name} is not a .xlsx — open it in Excel and Save As → Excel Workbook.`);
    }
    file = workbooks[0];
    if (!file) {
      /* By far the most common way to get here is dropping the workbook beside
         the plan rather than into the subfolder, so look there before saying
         there is nothing: naming the file somebody can see is the difference
         between an answer and a denial. */
      const stray = (await filestore.intakeList('').catch(() => []))
        .filter((f) => /\.xlsx$/i.test(f.name));

      run.outcome = 'missing';
      run.note = stray.length
        ? `Nothing in ${LOOKAHEAD_DIR}/, but ${stray.length} workbook(s) beside the plan`
        : `Nothing in ${LOOKAHEAD_DIR}/`;
      await rc.addIngestRun(run).catch(() => {});

      throw new Error(
        stray.length
          ? `No workbook in ${LOOKAHEAD_DIR}/, but ${stray.map((f) => f.name).join(', ')} `
            + `${stray.length === 1 ? 'is' : 'are'} sitting beside the plan. Move it into a `
            + `subfolder called "${LOOKAHEAD_DIR}" — the look-ahead is only ever read from there, `
            + 'so that nothing else in your folder can be snapshotted by accident.'
          : `No workbook in ${LOOKAHEAD_DIR}/ — create that subfolder beside the plan and put `
            + 'the .xlsx in it. Absence is recorded, not treated as "no change".'
      );
    }

    const rel = `${LOOKAHEAD_DIR}/${file.name}`;
    const hash = await filestore.intakeHash(rel);
    run.file_hash = hash;
    run.file_mtime = new Date(file.modified).toISOString();

    const snapshots = await rc.listSnapshots({ limit: 1 });
    if (snapshots[0] && snapshots[0].file_hash === hash) {
      run.outcome = 'unchanged';
      await rc.addIngestRun(run);
      if (!silent) toast({ message: 'The look-ahead has not changed since the last snapshot.' });
      return { changed: false, events: [] };
    }

    const buffer = await filestore.intakeRead(rel);
    const grid = applyLegend(parseSheet(buffer, sheetName), legend);

    if (grid.conditional.length && !grid.rows.some((r) => r.cells.some((c) => c.hex))) {
      throw new Error(
        'That sheet has conditional formatting and no readable cell fills, so the shift '
        + 'colours are coming from rules rather than from the cells. They cannot be read '
        + 'from the style table — the ingestion design needs revisiting before this can work.'
      );
    }

    const snapshot = await rc.addSnapshot({
      file_hash: hash,
      file_mtime: run.file_mtime,
      sheet_name: grid.sheet,
      grid: { rows: grid.rows, merges: grid.merges, hiddenColumns: grid.hiddenColumns, unknown: grid.unknown },
    });

    run.outcome = 'snapshot';
    run.note = grid.unknown.length ? `${grid.unknown.length} colour(s) not in the legend` : null;
    await rc.addIngestRun(run);

    if (!silent && grid.unknown.length) {
      toast({
        tone: 'warn',
        message: `${grid.unknown.length} colour(s) are not in the legend and were left unmapped — `
          + 'nothing was guessed.',
      });
    }

    notifyChanged('lookahead');
    return { changed: true, snapshot, grid };
  } catch (err) {
    if (run.outcome === 'error') {
      run.note = err.message;
      await rc.addIngestRun(run).catch(() => {});
    }
    throw err;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Changes
   ═══════════════════════════════════════════════════════════════════════ */

async function renderChanges(host) {
  const today = todayISO();
  const from = `${Number(today.slice(0, 4)) - 1}-01-01`;
  const [events, runs, parties] = await Promise.all([
    rc.listChangeEvents(from, `${today}T23:59:59Z`),
    rc.listIngestRuns({ limit: 60 }),
    rc.listParties(),
  ]);

  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'What the look-ahead did' }),
    el('button', {
      class: 'cx-btn mini primary',
      html: icon('refresh', { size: 12 }) + '<span>Check now</span>',
      onClick: async () => {
        try {
          await ingest({ sheetName: '4WLA', legend: [] });
        } catch (err) {
          // 'bad' — not 'error', which is not a tone and fell back to the
          // neutral info styling, so a refusal looked like a notification.
          // These messages say what to go and do, so they get longer than the
          // default three and a half seconds to be read.
          toast({ tone: 'bad', message: err.message, timeout: 12000 });
        }
      },
    }),
  ]));

  /* Coverage before content. Ingestion only happens when somebody has the
     application open, so the history has holes — and a hole that is not drawn
     reads as a quiet week. */
  host.appendChild(coverageNote(runs));

  if (!events.length) {
    host.appendChild(el('p', { class: 'rc-hint', text: 'No changes recorded yet.' }));
    return;
  }

  const partyById = byId(parties);
  const counted = countable(events);
  host.appendChild(el('p', { class: 'rc-hint' }, [
    el('span', { text: `${counted.length} change(s) that count, ` }),
    el('span', { text: `${events.length - counted.length} window movement(s) that do not.` }),
  ]));

  const rows = events.map((e) => el('tr', {}, [
    el('td', { text: e.week_start || '—' }),
    el('td', {}, [badge(kindLabel(e.kind), kindTone(e.kind))]),
    el('td', { text: describe({ ...e, weekStart: e.week_start, rowKey: e.row_key }) }),
    el('td', { class: 'rc-hint', text: e.detected_at ? dayLabel(e.detected_at.slice(0, 10)) : '' }),
    el('td', {}, e.kind === 'cancellation' ? [
      el('button', {
        class: 'cx-btn mini ghost',
        text: 'Whose?',
        title: 'Red says a shift was cancelled. It cannot say by whom.',
        onClick: () => attribute(e, parties),
      }),
    ] : []),
  ]));

  host.appendChild(table(['Week', 'Kind', 'What', 'Seen', ''], rows));

  const pairs = relinkCandidates(events.map((e) => ({
    kind: e.kind, weekStart: e.week_start, rowKey: e.row_key, before: e.before, after: e.after,
  })));
  if (pairs.length) {
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: `${pairs.length} removal/addition pair(s) share the same requested resources, which `
        + 'usually means a crew finished early and moved rather than anything being cancelled. '
        + 'That cannot be told apart automatically — the activity text is not reliable enough to '
        + 'match on — so it is offered rather than assumed.',
    }));
  }
}

/**
 * Say where the history has holes.
 *
 * This is the honest half of "ingestion runs when the application is open".
 * Without it the change log would look continuous and somebody would read a
 * silent fortnight as a fortnight in which nothing moved.
 */
function coverageNote(runs) {
  if (!runs.length) {
    return el('p', { class: 'rc-hint', text: 'The look-ahead has never been read on this account.' });
  }
  const last = runs[0];
  const age = Math.floor((Date.now() - new Date(last.ran_at).getTime()) / 86400000);
  const stale = age >= 7;

  return el('p', {
    class: stale ? 'rc-error' : 'rc-hint',
    text: stale
      ? `The look-ahead has not been read for ${age} days. Anything that changed and changed `
        + 'back in that time is not in the log below — the gap is real, not a quiet spell.'
      : `Last read ${age === 0 ? 'today' : `${age} day(s) ago`} — ${last.outcome}.`,
  });
}

function attribute(event, parties) {
  const party = selectInput({
    value: parties[0]?.id,
    options: parties.map((p) => ({ value: p.id, label: p.name })),
  });
  const note = textInput({ placeholder: 'What happened' });

  formModal({
    title: 'Who was this down to?',
    body: el('div', { class: 'cx-form' }, [
      el('p', {
        class: 'rc-hint',
        text: 'This is the record a claim gets challenged on, so it is attributed and dated, '
          + 'and it cannot be edited afterwards — a correction is a new entry that supersedes '
          + 'this one.',
      }),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Down to' }), party]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Note' }), note]),
    ]),
    confirmLabel: 'Record',
    onConfirm: async () => {
      await rc.addAnnotation({
        change_event_id: event.id,
        kind: 'responsibility',
        party_id: party.value,
        note: note.value.trim() || null,
      });
      notifyChanged('annotations');
    },
  });
}

const KIND_LABELS = {
  scope_added: 'Scope added', scope_removed: 'Scope removed', cancellation: 'Cancelled',
  shift_changed: 'Shift changed', resource_changed: 'Resources', location_shift: 'Moved site',
  window_advanced: 'Window advanced', window_retired: 'Window retired',
};
const kindLabel = (k) => KIND_LABELS[k] || k;
const kindTone = (k) => ({
  cancellation: 'bad', scope_removed: 'warn', scope_added: 'info',
  window_advanced: 'muted', window_retired: 'muted',
}[k] || 'neutral');

/* ══════════════════════════════════════════════════════════════════════════
   Snapshots
   ═══════════════════════════════════════════════════════════════════════ */

async function renderSnapshots(host) {
  const snapshots = await rc.listSnapshots({ limit: 40 });

  host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Snapshots' })]));

  if (!snapshots.length) {
    host.appendChild(el('p', { class: 'rc-hint', text: 'Nothing captured yet.' }));
    return;
  }

  host.appendChild(table(
    ['Seen', 'File changed', 'Sheet', 'Rows', 'Unmapped colours'],
    snapshots.map((s) => el('tr', {}, [
      el('td', { text: s.taken_at ? s.taken_at.slice(0, 16).replace('T', ' ') : '—' }),
      el('td', { text: s.file_mtime ? s.file_mtime.slice(0, 16).replace('T', ' ') : '—' }),
      el('td', { text: s.sheet_name }),
      el('td', { class: 'rc-num', text: String(s.grid?.rows?.length ?? 0) }),
      el('td', { class: 'rc-num', text: String(s.grid?.unknown?.length ?? 0) }),
    ]))
  ));

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'Two times, deliberately. "File changed" is what OneDrive stamped, which is when it '
      + 'synced rather than when anybody edited it; "seen" is when this application read it. '
      + 'For evidence the difference matters, so neither stands in for the other.',
  }));
  host.appendChild(el('p', {
    class: 'rc-hint',
    text: 'The parsed grid is stored, not the workbook. A .xlsx carries every other tab, hidden '
      + 'row and forgotten pasted sheet along with the part that was wanted — the original bytes '
      + 'stay in the folder archive instead.',
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
   Site access
   ═══════════════════════════════════════════════════════════════════════ */

async function renderSars(host) {
  const [sars, locations, without, unlinked] = await Promise.all([
    rc.listSars(),
    rc.listLocations(),
    rc.listRowsWithoutSar(),
    rc.listSarsWithoutRows(),
  ]);
  const locs = byId(locations);

  host.appendChild(el('div', { class: 'rc-section-head' }, [
    el('h3', { text: 'Site access requests' }),
    el('button', {
      class: 'cx-btn mini primary',
      html: icon('plus', { size: 12 }) + '<span>Record a SAR</span>',
      onClick: () => recordSar(locations),
    }),
  ]));

  /* The alert the spec did not ask for and that nothing else surfaces: work
     planned into a week with no access confirmed against it. */
  if (without.length) {
    host.appendChild(el('p', { class: 'rc-error' }, [
      el('strong', { text: `${without.length} look-ahead row(s) have no SAR. ` }),
      el('span', { text: 'That is work planned without confirmed access.' }),
    ]));
  }
  if (unlinked.length) {
    host.appendChild(el('p', { class: 'rc-hint', text:
      `${unlinked.length} SAR(s) match no look-ahead row — access booked for work that has gone.` }));
  }

  if (!sars.length) {
    host.appendChild(el('p', { class: 'rc-hint', text: 'No SARs recorded.' }));
  } else {
    host.appendChild(table(
      ['SAR', 'Rev', 'Location', 'Week', 'Hours'],
      sars.map((s) => el('tr', {}, [
        el('td', { text: s.sar_number }),
        el('td', { class: 'rc-num', text: String(s.revision) }),
        el('td', { text: locs.get(s.location_id)?.name || s.raw_location || '—' }),
        el('td', { text: s.week_start || '—' }),
        el('td', { class: 'rc-num', text: s.authorized_hours ?? '—' }),
      ]))
    ));
  }

  host.appendChild(el('p', {
    class: 'rc-hint',
    text: `Drop a SAR PDF into ${SAR_INBOX}/ and record it here; it is then filed under its week. `
      + 'Matching to look-ahead rows is by date and location only — never by activity text, which '
      + 'is worded differently on the two sides and is not reliable enough to carry evidence. '
      + 'One SAR covering several rows at a location is expected, not an ambiguity.',
  }));
}

function recordSar(locations) {
  const number = textInput({ placeholder: 'SAR-12345' });
  const location = selectInput({
    value: locations[0]?.id,
    options: locations.map((l) => ({ value: l.id, label: l.name })),
  });
  const week = el('input', { type: 'date', class: 'cx-input' });
  const hours = el('input', { type: 'number', class: 'cx-input', step: '0.5', min: '0' });

  formModal({
    title: 'Record a SAR',
    body: el('div', { class: 'cx-form' }, [
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Number' }), number]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Location' }), location]),
      el('div', { class: 'cx-field' }, [
        el('label', { class: 'cx-label', text: 'Week beginning' }), week,
        el('div', { class: 'cx-hint', text: 'The Monday, matching how the look-ahead is keyed.' }),
      ]),
      el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Authorised hours' }), hours]),
    ]),
    confirmLabel: 'Record',
    onConfirm: async () => {
      if (!number.value.trim()) throw new Error('A SAR number is needed.');
      await rc.addSar({
        sar_number: number.value.trim(),
        location_id: location.value || null,
        week_start: week.value || null,
        authorized_hours: hours.value ? Number(hours.value) : null,
      });
      notifyChanged('sars');
    },
  });
}

/* ── Shared ────────────────────────────────────────────────────────────── */

function table(headers, rows) {
  return el('div', { class: 'rc-scroll' }, [
    el('table', { class: 'rc-table' }, [
      el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { text: h })))]),
      el('tbody', {}, rows),
    ]),
  ]);
}
