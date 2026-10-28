/**
 * The 4WLA on a schedule: `4WLA_Latest.xlsx`, `4WLA_Latest.pdf` and
 * `4WLA_Latest.png` in `exports/` in the shared folder, each replacing the last.
 *
 * It belongs to Export to Excel, not to the master export: the master export
 * is the record (`LookAhead_Latest.xlsx`, a sheet per question), and this is
 * the 4WLA itself, for the people it is sent to — the workbook in its own
 * layout, the next four weeks on one A3 page, and the same four weeks as a
 * picture that opens in an email on a phone. A flow on the folder (Power
 * Automate, say) watches the files and sends them on; nothing is emailed from
 * here, and that is structural.
 *
 * The schedule runs in the page on this computer, while the calendar is open,
 * and a slot missed while it was closed runs once (`core/export_schedule.js`)
 * — the same rule as the master export's, with settings of its own, because
 * the two go to different people at different times.
 *
 * What is drawn comes from the screens that draw it — the workbook from the
 * editor (`lookaheadFileNow()`), the PDF and PNG from the look-ahead
 * (`lookaheadSheetsNow()`). Both import this module for the dialog, so they
 * hand their builders over (`provide4wla()`) rather than being imported back,
 * which the build would refuse as a cycle.
 *
 * Imports: util, rc, filestore, export_schedule, exporters, components.
 */

import { el } from '../core/util.js';
import * as rc from '../core/rc.js';
import * as filestore from '../core/filestore.js';
import { cleanSchedule, isDue, nextSlot } from '../core/export_schedule.js';
import { saveFile } from '../io/exporters.js';
import { toast, checkbox, selectInput, field } from './components.js';

/** The one name all three are filed under. */
export const LATEST = '4WLA_Latest';
export const EXPORT_DIR = 'exports';
const STORE_KEY = 'cx.rc.4wlaExport';
const RETRY_MS = 30 * 60000;
const TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  png: 'image/png',
};

/** @typedef {{ name: string, bytes: Uint8Array } | null} Drawn */
/**
 * @type {{
 *   xlsx: null | (() => Promise<Drawn>),
 *   sheets: null | ((what: { pdf?: boolean, png?: boolean }) => Promise<{ pdf: Drawn, png: Drawn }>),
 * }}
 */
const builders = { xlsx: null, sheets: null };

/** Called by the editor (the workbook) and the look-ahead (the PDF and PNG) as they load. */
export function provide4wla(part) {
  Object.assign(builders, part);
}

/* ── This computer's settings ─────────────────────────────────────────── */

function defaults() {
  return {
    xlsx: true,
    pdf: true,
    png: true,
    schedule: cleanSchedule({ every: 'off', at: '06:00', weekday: 1, hours: 24 }),
    since: null,
    lastRun: null,
    failedAt: null,
    last: null,
  };
}

export function loadSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
  } catch {
    stored = {};
  }
  return { ...defaults(), ...stored, schedule: cleanSchedule(stored.schedule || defaults().schedule) };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    // No storage: it still exports now, it just cannot be remembered.
  }
}

/* ── Building and filing ──────────────────────────────────────────────── */

/**
 * The files the settings ask for, `{ files: [{ name, bytes, type }], failed }`.
 * Each is drawn on its own, so one that cannot be never costs the others.
 */
export async function build4wla(settings = loadSettings()) {
  const files = [];
  const failed = [];
  if (settings.xlsx) {
    try {
      const book = builders.xlsx ? await builders.xlsx() : null;
      if (book) files.push({ name: `${LATEST}.xlsx`, bytes: book.bytes, type: TYPES.xlsx });
      else failed.push({ what: 'the 4WLA workbook', message: 'the look-ahead is not written in the calendar yet' });
    } catch (err) {
      failed.push({ what: 'the 4WLA workbook', message: err.message });
    }
  }
  if (settings.pdf || settings.png) {
    try {
      const drawn = builders.sheets
        ? await builders.sheets({ pdf: Boolean(settings.pdf), png: Boolean(settings.png) })
        : { pdf: null, png: null };
      if (drawn.pdf) files.push({ name: `${LATEST}.pdf`, bytes: drawn.pdf.bytes, type: TYPES.pdf });
      if (drawn.png) files.push({ name: `${LATEST}.png`, bytes: drawn.png.bytes, type: TYPES.png });
      if ((settings.pdf && !drawn.pdf) || (settings.png && !drawn.png)) {
        failed.push({ what: 'the 4WLA PDF and PNG', message: 'there is nothing on the look-ahead in the next four weeks' });
      }
    } catch (err) {
      failed.push({ what: 'the 4WLA PDF and PNG', message: err.message });
    }
  }
  return { files, failed };
}

/**
 * Into `exports/` in the shared folder, each replacing the last — or
 * downloaded, with no folder connected. Answers what went where.
 */
async function deliver(files) {
  if (filestore.hasFolder?.()) {
    for (const f of files) {
      try {
        await filestore.intakeWrite(`${EXPORT_DIR}/${f.name}`, f.bytes);
      } catch (err) {
        // Windows will not replace a file somebody has open, and says nothing of the sort.
        throw new Error(`${EXPORT_DIR}/${f.name} could not be replaced — if it is open, close it and export again `
          + `(a scheduled export tries again by itself). ${err.message}`);
      }
    }
    return { where: 'folder', paths: files.map((f) => `${EXPORT_DIR}/${f.name}`) };
  }
  for (const f of files) saveFile(f.name, f.bytes, f.type, '4WLA');
  return { where: 'download', paths: files.map((f) => f.name) };
}

/** Build, file, and remember how it went. */
export async function run4wla(settings = loadSettings()) {
  const { files, failed } = await build4wla(settings);
  if (!files.length) throw new Error(failed.map((f) => `${f.what}: ${f.message}`).join('; ') || 'nothing was asked for');
  const went = await deliver(files);
  saveSettings({ ...loadSettings(), last: { at: Date.now(), ...went, failed: failed.length } });
  return { ...went, failed };
}

function said(out) {
  const where = out.where === 'folder' ? 'Saved to the shared folder — ' : 'Downloaded — ';
  const missing = out.failed.length ? ` · not made: ${out.failed.map((f) => `${f.what} (${f.message})`).join('; ')}` : '';
  return where + out.paths.join(', ') + missing;
}

/* ── The schedule ─────────────────────────────────────────────────────── */

let started = false;
let running = false;

/** Look once a minute, while the calendar is open on this computer. */
export function startSchedule4wla() {
  if (started) return;
  started = true;
  setTimeout(() => { tick4wla(); }, 25000);
  setInterval(() => { tick4wla(); }, 60000);
}

export async function tick4wla(now = Date.now()) {
  if (running || !rc.isSignedIn()) return false;
  const s = loadSettings();
  if (!isDue(s.schedule, { lastRun: s.lastRun, since: s.since }, now)) return false;
  if (s.failedAt && now - s.failedAt < RETRY_MS) return false;
  // Claimed before it runs, so a second window a moment later finds it done.
  saveSettings({ ...s, lastRun: now });
  running = true;
  try {
    const out = await run4wla(s);
    saveSettings({ ...loadSettings(), lastRun: now, failedAt: null });
    toast({ tone: out.failed.length ? 'warn' : 'info', title: 'Scheduled 4WLA export', message: said(out), timeout: 6000 });
    return true;
  } catch (err) {
    saveSettings({ ...loadSettings(), lastRun: s.lastRun, failedAt: now });
    rc.reportError('4wla:scheduled', err);
    toast({ tone: 'bad', title: 'The scheduled 4WLA export failed', message: `${err.message} — it is tried again in half an hour.`, timeout: 12000 });
    return false;
  } finally {
    running = false;
  }
}

/* ── In the Export to Excel dialog ────────────────────────────────────── */

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function when(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * The part of Export to Excel that files `4WLA_Latest` — which files, how
 * often, and its own Save schedule and Export now, so the one-off download
 * above it is untouched.
 */
export function scheduleSection() {
  const s = loadSettings();
  const box = (key, label) => {
    const b = checkbox({ label, checked: s[key] });
    b.dataset.latest = key;
    return b;
  };
  const xlsx = box('xlsx', `${LATEST}.xlsx — the 4WLA in its own layout, every week written`);
  const pdf = box('pdf', `${LATEST}.pdf — the next four weeks on one A3 page`);
  const png = box('png', `${LATEST}.png — the same four weeks as a picture`);

  const every = selectInput({
    value: s.schedule.every,
    options: [
      { value: 'off', label: 'Only when I press Export now' },
      { value: 'day', label: 'Every day' },
      { value: 'week', label: 'Every week' },
      { value: 'hours', label: 'Every few hours' },
    ],
  });
  every.classList.add('la-latest-every');
  const at = el('input', { type: 'time', class: 'cx-input la-latest-at', value: s.schedule.at });
  const day = selectInput({ value: String(s.schedule.weekday), options: WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d })) });
  const hours = el('input', { type: 'number', class: 'cx-input', min: '1', max: '168', value: String(s.schedule.hours) });
  const atField = field('At', at);
  const dayField = field('On', day);
  const hoursField = field('Every how many hours', hours);
  const status = el('p', { class: 'rc-hint la-latest-status' });

  const read = () => ({
    ...loadSettings(),
    xlsx: xlsx.querySelector('input').checked,
    pdf: pdf.querySelector('input').checked,
    png: png.querySelector('input').checked,
    schedule: cleanSchedule({ every: every.value, at: at.value, weekday: Number(day.value), hours: Number(hours.value) }),
  });
  const show = () => {
    atField.hidden = every.value !== 'day' && every.value !== 'week';
    dayField.hidden = every.value !== 'week';
    hoursField.hidden = every.value !== 'hours';
    const now = Date.now();
    const cur = loadSettings();
    const next = read();
    const last = cur.last ? `Last ${when(cur.last.at)} — ${cur.last.where === 'folder' ? 'into the shared folder' : 'downloaded'}. ` : 'Not exported from this computer yet. ';
    status.textContent = last + (next.schedule.every === 'off' ? '' : `Next ${when(nextSlot(next.schedule, cur.lastRun ?? cur.since ?? now, now))}.`);
  };
  for (const c of [every, at, day, hours]) c.addEventListener('change', show);
  show();

  const save = () => {
    const next = read();
    const was = loadSettings();
    // Switched on or changed now: the first export is at the next slot, not this minute.
    if (JSON.stringify(was.schedule) !== JSON.stringify(next.schedule)) {
      next.since = Date.now();
      next.lastRun = null;
      next.failedAt = null;
    }
    saveSettings(next);
    show();
    return next;
  };

  const folder = filestore.hasFolder?.();
  return el('div', { class: 'cx-field la-latest' }, [
    el('span', { class: 'cx-label', text: `${LATEST} — on a schedule, for sending on` }),
    el('p', {
      class: 'rc-hint',
      text: folder
        ? `Saved into ${EXPORT_DIR}/ in the shared folder, replacing the last each time, so a flow watching the folder always sends the newest.`
        : `Downloaded to this computer. Open the shared folder to have them saved into ${EXPORT_DIR}/ there, replacing the last.`,
    }),
    xlsx, pdf, png,
    field('How often', every),
    el('div', { class: 'rc-mx-when' }, [dayField, atField, hoursField]),
    el('p', {
      class: 'rc-hint',
      text: 'It runs on this computer while the calendar is open on it. A time missed while it was closed is exported once, the next time it opens.',
    }),
    status,
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      el('button', {
        class: 'cx-btn mini', type: 'button', text: 'Save schedule', dataset: { action: 'latest-save' },
        onClick: () => {
          const next = save();
          toast({ message: next.schedule.every === 'off' ? `Saved. ${LATEST} is not exported on a schedule.` : `Saved. ${LATEST} is exported on a schedule while the calendar is open here.` });
        },
      }),
      el('button', {
        class: 'cx-btn mini primary', type: 'button', text: `Export ${LATEST} now`, dataset: { action: 'latest-now' },
        onClick: async (e) => {
          const btn = e.currentTarget;
          const next = save();
          btn.disabled = true;
          try {
            const out = await run4wla(next);
            toast({ tone: out.failed.length ? 'warn' : 'good', title: `${LATEST} exported`, message: said(out), timeout: 9000 });
            show();
          } catch (err) {
            rc.reportError('4wla', err);
            toast({ tone: 'bad', message: `${LATEST} could not be exported — ${err.message}`, timeout: 12000 });
          } finally {
            btn.disabled = false;
          }
        },
      }),
    ]),
  ]);
}
