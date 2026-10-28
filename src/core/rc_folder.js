/**
 * Where the calendar's database lives, and whose turn it is to write it.
 *
 * `core/rc_db.js` keeps its tables in files and knows nothing about where they
 * are. This hands it `calendar/` in the shared folder — the same folder the
 * plan is in, reached through `core/filestore.js`, which is the only module
 * that may touch it — and keeps the calendar's **pen**: one person writes the
 * calendar at a time, and everybody else reads it.
 *
 * The pen is the plan's, with the plan's rules (`core/folder_rules.js`): every
 * window states a claim in a file only it writes, the earliest claim still
 * beating holds the pen, a takeover outranks that, and a claim that stops
 * beating for four minutes has gone. It is a separate pen from the plan's, so
 * one person can hold the timeline while the other holds the calendar.
 *
 * Two differences, both because the claim here is per window rather than per
 * machine. A claim from this machine that has stopped beating for a minute is
 * a window that has closed or crashed — its file is on this disk, so a stale
 * beat means gone rather than slow — and is not waited out. And two windows on
 * one machine settle like two people do, rather than sharing one claim.
 *
 * The pen is courtesy, as the plan's is. What protects the work is the guard
 * in `core/rc_db.js`: a file another computer saved is never written over.
 *
 * Imports: events, filestore, folder_rules.
 */

import { emit, EV } from './events.js';
import * as filestore from './filestore.js';
import { parseClaim, penHolder, isStale } from './folder_rules.js';

/** The calendar's folder, inside the shared one. */
export const ROOT = 'calendar';
const PEN_DIR = `${ROOT}/pen`;

const HEARTBEAT_MS = 30000;
const SETTLE_MS = 15000;
/** This machine's own claim, not restated for this long, is a window that has gone. */
const OWN_GONE_MS = HEARTBEAT_MS * 2 + 5000;
/** A claim file this old is deleted rather than ignored. */
const ABANDONED_MS = 6 * 3600000;
/** An editor who has written nothing for this long hands the pen back. */
const IDLE_RELEASE_MS = 3600000;

/* ── The files ─────────────────────────────────────────────────────────── */

/**
 * The storage `core/rc_db.js` reads and writes through: paths relative to
 * `calendar/`, text in and out, the guard in the write.
 */
export function storage() {
  const at = (path) => (path ? `${ROOT}/${path}` : ROOT);
  return {
    read: (path) => filestore.dataRead(at(path)),
    stat: (path) => filestore.dataStat(at(path)),
    write: (path, text, expected) => filestore.dataWrite(at(path), text, expected),
    list: (dir) => filestore.dataList(at(dir)),
    remove: (path) => filestore.dataRemove(at(path)),
  };
}

/** A file kept beside the tables as bytes — BART's blank TAWR form. */
export async function readBytes(path) {
  try {
    return new Uint8Array(await filestore.intakeRead(`${ROOT}/${path}`));
  } catch {
    return null;
  }
}

export function writeBytes(path, bytes) {
  return filestore.intakeWrite(`${ROOT}/${path}`, bytes);
}

/* ── The pen ───────────────────────────────────────────────────────────── */

let role = null; // 'editor' | 'viewer' | null while nothing is open
let holder = '';
let holderSavedMs = null;
let since = 0;
let takeover = 0;
let lastWriteAt = 0;
let beatTimer = null;
let settleTimer = null;
let started = false;
/* Handed back: this window states no claim and stays read-only until it is
   taken again, whether or not anybody else is waiting. Without this, handing
   back with nobody else in the folder restated a claim that won at once — the
   pen came straight back and the header still said Editing. */
let yielded = false;

const claimFile = () => {
  const me = filestore.identity();
  return `${PEN_DIR}/${me.device}-${me.session}.json`.replace(/[^A-Za-z0-9_./-]/g, '_');
};

/** Who holds it, and whether that is this window. */
export function penState() {
  return {
    role,
    editing: role === 'editor',
    holder,
    holderIdleMs: holderSavedMs,
    since,
    yielded,
  };
}

/** True while this window may write the calendar. */
export function holdsPen() {
  return role === 'editor';
}

/** Said whenever the calendar is written, so an idle pen can be handed back. */
export function noteWrite() {
  lastWriteAt = Date.now();
}

async function writeClaim() {
  if (yielded) return;
  const me = filestore.identity();
  const claim = {
    id: me.session,
    device: me.device,
    holder: me.name,
    since,
    beat: Date.now(),
    ...(lastWriteAt ? { saved: lastWriteAt } : {}),
    ...(takeover ? { takeover } : {}),
  };
  try {
    await filestore.dataWrite(claimFile(), JSON.stringify(claim, null, 1), null);
  } catch (err) {
    console.warn('[cx-timeline] could not write the calendar\'s claim:', err.message);
  }
}

async function readClaims() {
  const me = filestore.identity();
  const out = [];
  for (const f of await filestore.dataList(PEN_DIR)) {
    if (!/\.json$/i.test(f.name)) continue;
    const read = await filestore.dataRead(`${PEN_DIR}/${f.name}`).catch(() => null);
    const claim = parseClaim(read?.text);
    if (!claim) continue;
    // A window that has handed back has no claim, whatever a slow sync still shows.
    if (yielded && claim.id === me.session) continue;
    // Another window of this machine that has stopped beating has closed.
    if (claim.device === me.device && claim.id !== me.session && Date.now() - (claim.beat || 0) > OWN_GONE_MS) {
      continue;
    }
    out.push({ ...claim, file: f.name });
  }
  return out;
}

/** Read the claims and settle who holds the pen. Announces itself only on a change. */
export async function settle() {
  if (!started) return penState();
  const me = filestore.identity();
  const claims = await readClaims();
  const winner = penHolder(claims);
  const next = !yielded && (!winner || winner.id === me.session) ? 'editor' : 'viewer';
  // A viewer with nobody else holding it is a window that handed back: holder is ''.
  const nextHolder = next === 'editor' || !winner ? ''
    : (winner.device === me.device ? 'another window of yours' : winner.holder || 'Someone');
  holderSavedMs = next === 'viewer' && winner?.saved ? Date.now() - winner.saved : null;
  if (next === role && nextHolder === holder) return penState();
  role = next;
  holder = nextHolder;
  emit(EV.RC_PEN, penState());
  return penState();
}

/**
 * State this window's claim and start keeping it — called when the calendar
 * opens. Claiming before reading, so two windows opening together both end
 * up in the list and settle on the same holder.
 */
export async function startPen() {
  if (started) return penState();
  started = true;
  yielded = false;
  since = Date.now();
  takeover = 0;
  lastWriteAt = Date.now();
  await writeClaim();
  await settle();
  sweep();
  beatTimer = setInterval(() => {
    if (role === 'editor' && lastWriteAt && Date.now() - lastWriteAt > IDLE_RELEASE_MS) {
      releasePen().then(() => emit(EV.RC_PEN, { ...penState(), idle: true }));
      return;
    }
    writeClaim();
  }, HEARTBEAT_MS);
  settleTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    settle().catch(() => {});
  }, SETTLE_MS);
  return penState();
}

/** Take the pen. Never refused: the guard is what keeps the work safe. */
export async function takePen() {
  if (!started) await startPen();
  yielded = false;
  takeover = Date.now();
  lastWriteAt = Date.now();
  await writeClaim();
  role = 'editor';
  holder = '';
  holderSavedMs = null;
  emit(EV.RC_PEN, penState());
  return penState();
}

/**
 * Hand the pen back and read on: the claim is withdrawn, so whoever has been
 * waiting longest holds it on their next settle, and this window states no
 * claim until it takes the pen again (`takePen()`).
 */
export async function releasePen() {
  if (!started) return penState();
  yielded = true;
  await filestore.dataRemove(claimFile()).catch(() => false);
  takeover = 0;
  role = 'viewer';
  holder = '';
  await settle();
  emit(EV.RC_PEN, penState());
  return penState();
}

/** Withdraw the claim on the way out. Best effort: unload cannot wait. */
export function stopPen() {
  if (!started) return;
  started = false;
  clearInterval(beatTimer);
  clearInterval(settleTimer);
  filestore.dataRemove(claimFile()).catch(() => false);
  role = null;
}

/** Claims nobody has restated for hours, from machines that are gone. */
async function sweep() {
  try {
    for (const claim of await readClaims()) {
      if (claim.id === filestore.identity().session) continue;
      if (isStale(claim) && Date.now() - (claim.beat || 0) > ABANDONED_MS) {
        await filestore.dataRemove(`${PEN_DIR}/${claim.file}`);
      }
    }
  } catch {
    /* tidying is never worth failing anything over */
  }
}
