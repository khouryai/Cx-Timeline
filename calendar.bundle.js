/*!
 * CX Timeline — the resource calendar, loaded on first use.
 * GENERATED FILE — built by tools/build.js alongside app.bundle.js.
 * Modules: 28   Built: 2026-10-28T16:41:21.764Z
 */
(function () {
  'use strict';
  var registry = typeof window !== 'undefined' && window.__CX_MODULES;
  if (!registry) throw new Error('CX Timeline: calendar.bundle.js has to load after app.bundle.js');
  var __mods = registry.mods;

// ui/rc_util.js
__mods["ui/rc_util.js"] = function (__x, __req) {
  /**
   * Small shared helpers for the resource calendar's tabs.
   *
   * These live in a leaf of their own rather than in `ui/rc.js` because `rc.js`
   * imports the tabs and the tabs need the helpers — putting them together would
   * be a cycle, and the build rejects those outright rather than letting one
   * quietly half-initialise.
   *
   * Imports: util, events, dates, components, icons.
   */

  const { el } = __req("core/util.js");
  const { emit, EV } = __req("core/events.js");
  const { toISO, todayMs, fmtDate, addDays, MS_DAY } = __req("core/dates.js");
  const { resourceNames, readGrid, locationColumnOf, absencesFrom, ABSENCE_LABELS, ABSENCE_KINDS, cellTokens, cancellationEvents, supportCancellationEvents, attachCancellationNotes, bartCodes, isCancelMeaning } = __req("core/lookahead.js");



  const { applyLegend } = __req("io/lookahead.js");
  const rc = __req("core/rc.js");
  const { openModal, confirmDialog, toast } = __req("ui/components.js");
  const { icon } = __req("ui/icons.js");

  /**
   * A modal whose confirm button does something that can fail.
   *
   * `openModal` closes on click unless the handler returns false, which is right
   * for a menu and wrong for a form that writes to a database over a network.
   * Here the dialog stays open, the button says what is happening, and a refusal
   * is shown in place rather than as a toast over a form that has already gone —
   * every write in this module can be refused by a policy, so that case is the
   * normal one rather than the exception.
   */
  function formModal({ title, body, confirmLabel = 'Save', onConfirm }) {
    const error = el('div', { class: 'rc-error', hidden: true });
    const wrap = el('div', {}, [body, error]);
    let busy = false;

    const modal = openModal({
      title,
      body: wrap,
      actions: [
        { label: 'Cancel' },
        {
          label: confirmLabel,
          kind: 'primary',
          keepOpen: true,
          autofocus: true,
          onClick: async (handle) => {
            if (busy) return;
            busy = true;
            error.hidden = true;
            try {
              await onConfirm();
              handle.close();
            } catch (err) {
              error.textContent = err?.message || String(err);
              error.hidden = false;
            } finally {
              busy = false;
            }
          },
        },
      ],
    });
    return modal;
  }

  /**
   * The Monday of the week containing `ms`.
   *
   * Mondays because that is what the look-ahead is keyed on, and matching the
   * source's idea of a week is what lets a plan row and a look-ahead row be
   * compared at all. `getUTCDay()` and not `getDay()`: a calendar date must not
   * move because of a timezone.
   */
  function weekStart(ms) {
    const day = new Date(ms).getUTCDay();
    return ms - ((day + 6) % 7) * MS_DAY;
  }

  /** The five working days of a week, as ISO strings. */
  function weekDays(startMs) {
    return [0, 1, 2, 3, 4].map((n) => toISO(addDays(startMs, n)));
  }

  /** The seven days, for a view that has to show a weekend possession. */
  function allWeekDays(startMs) {
    return [0, 1, 2, 3, 4, 5, 6].map((n) => toISO(addDays(startMs, n)));
  }

  function todayISO() {
    return toISO(todayMs());
  }

  /** An ISO date back to the millisecond scale the rest of the app uses. */
  function isoToMs(iso) {
    return new Date(`${iso}T00:00:00Z`).getTime();
  }

  function dayLabel(iso, preset = 'short') {
    return fmtDate(isoToMs(iso), preset);
  }

  /** Index rows by id, so a join costs one pass rather than a query per row. */
  function byId(rows) {
    const map = new Map();
    for (const row of rows || []) map.set(row.id, row);
    return map;
  }

  /**
   * Who wrote something, from the id it was stamped with.
   *
   * Three kinds of id are in the record: the account a person had in the old
   * calendar (kept on their roster row as `user_id`, so their history stays
   * theirs), `local:<roster id>` for somebody who never had one, and
   * `name:<what they typed>` for somebody not on the roster at all. A TAWR is
   * stamped with the roster id itself. Answers '' for nobody.
   */
  function authorNames(people) {
    const names = new Map();
    for (const p of people || []) {
      names.set(p.id, p.name);
      names.set(`local:${p.id}`, p.name);
      if (p.user_id) names.set(p.user_id, p.name);
    }
    return (id) => {
      if (!id) return '';
      const key = String(id);
      return names.get(key) || (key.startsWith('name:') ? key.slice(5) : '');
    };
  }

  /** Group rows under a key, for a grid that is people down and days across. */
  function groupBy(rows, key) {
    const map = new Map();
    for (const row of rows || []) {
      const k = typeof key === 'function' ? key(row) : row[key];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(row);
    }
    return map;
  }

  /** A row was written. Whatever is on screen reloads. */
  /**
   * A day's codes as nodes, with every struck-out code ("~WIT") in a span of its
   * own so it can be drawn struck through in red — the calendar's grid and the
   * editor's both draw a cell this way. Text with no tilde is returned as it is:
   * names, notes, anything that is not codes. `reasonFor(code)`, when given,
   * adds the reason logged for that code's cancellation to its hover.
   */
  function codeNodes(value, klass = 'rc-code-cancelled', reasonFor = null) {
    const text = String(value ?? '');
    if (!text.includes('~') || !/^[\s~A-Za-z0-9.]+$/.test(text)) return [text];
    const parts = [];
    cellTokens(text).forEach((t, i) => {
      if (i) parts.push('.');
      parts.push(t.cancelled
        ? el('span', {
          class: klass,
          text: t.code,
          title: [`${t.code} — cancelled`, reasonFor?.(t.code)].filter(Boolean).join(': '),
        })
        : t.code);
    });
    return parts;
  }

  /**
   * The cancellation log from `from` on: days cancelled outright and BART
   * resources struck out of activities that went ahead, as one list oldest
   * first, each with its note. The log and the administrator's inbox both read
   * it here, so they cannot count differently. A database from before resource
   * cancellations were derived simply has none of them.
   */
  async function cancellationLog(from) {
    const [days, support, notes, codes] = await Promise.all([
      rc.listCancelledDays(from),
      rc.listCancelledSupportDays(from).catch(() => []),
      rc.listCancellationNotes().catch(() => []),
      rc.listSupportCodes({ includeRetired: true }).catch(() => []),
    ]);
    /* BART's resources only: a cancelled day lists what BART had been asked for
       with it, and a struck-out code is in the log only when it was BART's. A
       Hitachi resource taken off an activity is not a BART cancellation. */
    const events = [...cancellationEvents(days, { from }), ...supportCancellationEvents(support, { from })]
      .map((e) => ({ ...e, resources: bartCodes(e.resources, codes) }))
      .filter((e) => e.kind !== 'support' || e.resources.size)
      .sort((a, b) => a.start.localeCompare(b.start) || a.label.localeCompare(b.label) || a.kind.localeCompare(b.kind));
    return attachCancellationNotes(events, notes);
  }

  function notifyChanged(what) {
    emit(EV.RC_CHANGED, { what });
  }

  /** How often a screen drawn from the look-ahead asks whether a newer reading has been published. */
  const WATCH_MS = 10000;
  /** While the bell is connected (`rc.lookaheadLive()`), a poll is only a check on it. */
  const WATCH_LIVE_MS = 120000;
  /** The watch each host has running, so drawing it again replaces it rather than adding one. */
  const watching = new WeakMap();

  /**
   * Redraw a screen drawn from the look-ahead when somebody publishes a newer
   * reading — an administrator painting a cancellation in the editor, a workbook
   * read, this one in another window. Told the moment it happens by the bell
   * (`rc.onLookaheadChange()`), and asked every few seconds as well while the bell
   * is not connected; never while somebody is typing into a field of the screen or
   * has a dialog open, because redrawing takes the field away. A ring that lands
   * then is not lost: the next poll asks again.
   *
   * `seenId` is the reading the screen was drawn from. A ring that is only an
   * edit — the editor publishes once the typing stops — finds the same reading
   * and changes nothing. One watch per host: a screen that redraws itself in
   * place (the week plan stepping a week) stops the one it started before.
   */
  function watchForNewReading(host, seenId) {
    watching.get(host)?.();
    let asked = 0;
    let done = false;
    const stop = () => {
      done = true;
      clearInterval(timer);
      unring();
      if (watching.get(host) === stop) watching.delete(host);
    };
    const look = async () => {
      if (done) return;
      if (!host.isConnected) { stop(); return; }
      if (document.hidden || document.querySelector('.cx-modal-overlay')) return;
      const active = document.activeElement;
      if (active && host.contains(active)
        && active.matches('input:not([type=checkbox]):not([type=radio]), textarea, select')) return;
      asked = Date.now();
      try {
        const id = await rc.newestSnapshotId();
        if (done || id == null || id === seenId || !host.isConnected) return;
        stop();
        rc.forgetReads();
        notifyChanged('lookahead');
      } catch {
        /* the next tick asks again */
      }
    };
    const timer = setInterval(() => {
      if (rc.lookaheadLive() && Date.now() - asked < WATCH_LIVE_MS) return;
      look();
    }, WATCH_MS);
    const unring = rc.onLookaheadChange(look);
    watching.set(host, stop);
    return stop;
  }

  /**
   * Go to another calendar tab. A tab cannot import the router — `ui/rc.js`
   * imports every tab — so it asks, the way a dock pane asks for another pane.
   * This is what lets an empty screen point at the place its data comes from.
   */
  /**
   * Which Organisation section to open next — set by whoever sends somebody
   * there (the inbox), read once by the tab. A tab cannot import another tab.
   */
  const orgNav = { section: null };

  function goToTab(tab) {
    emit(EV.RC_SHOW_TAB, { tab });
  }

  /**
   * The five statuses, split into the two families that must never be averaged.
   *
   * Performance is what an individual did. Health is what was done to them — a
   * possession released late is not underperformance, and counting it as such
   * would make the number worse than useless, because people would stop saying
   * they were blocked.
   */
  const STATUSES = [
    { id: 'completed', label: 'Completed', key: 'c', family: 'performance', tone: 'good' },
    { id: 'partial', label: 'Partial', key: 'p', family: 'performance', tone: 'warn' },
    { id: 'carried', label: 'Carried over', key: 'x', family: 'performance', tone: 'warn' },
    { id: 'blocked', label: 'Blocked', key: 'b', family: 'health', tone: 'bad' },
    { id: 'reassigned', label: 'Reassigned', key: 'r', family: 'health', tone: 'info' },
    { id: 'absent', label: 'Away', key: 'a', family: 'absence', tone: 'muted' },
  ];

  const STATUS_BY_ID = new Map(STATUSES.map((s) => [s.id, s]));

  /**
   * The three shifts, in the words the team uses.
   *
   * The third is a **blanket** — the possession the track is handed over for. It
   * is stored as `possession`, because that is the value `rc_plan_entries` and
   * `rc_actuals` check for and a rename would be a migration of every row ever
   * written for nothing a reader can see; it is *called* Blanket everywhere it
   * is drawn. `shiftFor()` already reads "blanket" on the workbook as this one.
   */
  const SHIFTS = [
    { id: 'day', label: 'Day' },
    { id: 'night', label: 'Night' },
    { id: 'possession', label: 'Blanket' },
  ];

  /** What a stored shift is called on screen. One place, so three views cannot differ. */
  function shiftLabel(id) {
    return SHIFTS.find((s) => s.id === id)?.label || id || '';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Names written in a spreadsheet, and the people they are
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Fold a name so spelling noise cannot decide whether it matches.
   *
   * Case and punctuation only. Nothing about the *words* is loosened: "R. Okafor"
   * and "r okafor" are the same name written twice, while "Okafor" is a different
   * string and matches only because somebody said so in the alias register.
   */
  function foldName(text) {
    return String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * A lookup from a written name to a person id.
   *
   * Three sources and no fourth: somebody's own full name, an alias somebody
   * recorded, and a **first name that belongs to exactly one person** — which is
   * what the 4WLA's Resource row is actually filled in with. There is still no
   * surname match: "Okafor" is a different string from "Rita Okafor" and matches
   * only because somebody said so in the alias register.
   *
   * The register itself is exact. A misspelling is answered separately, by
   * `nearestName()`, and only after this has failed — bounded by the length of
   * what was written, refused where two registered spellings are equally close,
   * and reported to the Resources tab when it does answer. That division is the
   * point: everything that reads this Map gets an exact answer, and the one place
   * that corrects a spelling says out loud that it did.
   *
   * They are added weakest first so the stronger answer wins. A full name beats an
   * alias pointing elsewhere — a name that *is* somebody's is theirs — and both
   * beat a first name, which is the loosest of the three.
   */
  function nameRegister(people, aliases = []) {
    const map = new Map();

    /* Weakest first, so the stronger answer overwrites it. A first name is the
       loosest of the three and an alias somebody typed is worth more than it;
       somebody's own full name is worth more than either. */
    for (const [key, id] of uniqueFirstNames(people)) map.set(key, id);
    for (const a of aliases || []) {
      const key = foldName(a.alias);
      if (key) map.set(key, a.person_id);
    }
    for (const p of people || []) {
      const key = foldName(p.name);
      if (key) map.set(key, p.id);
    }
    return map;
  }

  /**
   * How far apart two folded names are, giving up once they are further than
   * `limit`.
   *
   * Ordinary Levenshtein over two rows, with the whole row abandoned the moment
   * every cell in it is past the limit — which is what keeps this cheap against a
   * roster: almost every pair is obviously different and is dropped on the first
   * row. A transposition ("Okonwko") costs two here rather than one, which is
   * deliberate: a cheaper transposition would let a two-letter difference through
   * at a distance the caller thinks is one.
   */
  function nameDistance(a, b, limit = 2) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        if (row[j] < best) best = row[j];
      }
      if (best > limit) return limit + 1;
      prev = row;
    }
    return prev[b.length];
  }

  /**
   * How much misspelling a name of this length is allowed to carry.
   *
   * One character in a short name and two in a long one. Scaled because a fixed
   * allowance is wrong at both ends: two edits turn "Ana" into "Eve", while one
   * edit is barely a typo in "Kowalczyk". Below five folded characters nothing is
   * allowed at all — at that length half the roster is within one edit of the
   * other half.
   */
  function slackFor(key) {
    if (key.length < 5) return 0;
    return key.length >= 8 ? 2 : 1;
  }

  /**
   * The one person a misspelling can only have meant.
   *
   * The register matches exactly, and that stays the rule wherever an exact answer
   * exists — this is only ever asked after one has failed. What it adds is the
   * case the exact rule handled badly: a name typed into a spreadsheet at speed,
   * where "Okonkwo" arrives as "Okonwko" and a whole week of somebody's shifts
   * lands in the unmatched list for a transposed pair of letters.
   *
   * Two guards keep it from becoming the guessing the rest of this module
   * refuses. The distance is bounded by the length of what was written, so a
   * short name is still matched exactly. And a near miss that is near **two**
   * registered spellings at the same distance matches neither, for the reason two
   * people called Victor match neither: picking one would put a shift against the
   * wrong engineer, and it would look exactly as right on screen as the correct
   * answer.
   *
   * The answer is still *reported*. `resourceAssignments()` returns every name it
   * placed this way, and the Resources tab lists them, because a spelling matched
   * approximately is a spelling worth an alias — after which it is settled for
   * good and nothing is being inferred at all.
   */
  function nearestName(key, register) {
    const limit = slackFor(key);
    if (!limit) return null;
    let best = null;
    let bestAt = limit + 1;
    let tied = false;
    for (const [candidate, id] of register) {
      const d = nameDistance(key, candidate, limit);
      if (d > limit) continue;
      if (d < bestAt) { bestAt = d; best = { key: candidate, id }; tied = false; }
      else if (d === bestAt && best && best.id !== id) tied = true;
    }
    return tied ? null : best;
  }

  /**
   * "Is this written name me?" — the same register the week plan reads names
   * with (full name, alias, a first name only one person has, and the one
   * unambiguous near miss), so what it picks out is what the week plan puts
   * the person on. Resolves to null for an account with no person on the team.
   */
  async function meMatcher() {
    const me = rc.me();
    if (!me) return null;
    const [people, aliases] = await Promise.all([
      rc.listPeople({ includeInactive: true }).catch(() => []),
      rc.listPersonAliases().catch(() => []),
    ]);
    return personMatcher(nameRegister(people.length ? people : [me], aliases), me.id);
  }

  /** "Is this written name this person?" against a register — see `meMatcher()`. */
  function personMatcher(register, personId) {
    const memo = new Map();
    return (written) => {
      const key = foldName(written);
      if (!key) return false;
      if (!memo.has(key)) memo.set(key, (register.get(key) || nearestName(key, register)?.id || null) === personId);
      return memo.get(key);
    };
  }

  /**
   * A lookup from a spelling of a place to a location id.
   *
   * The same three-source, exact-fold rule the names get, and the same fold —
   * `rc_resolve_location()` in Postgres folds case and punctuation and nothing
   * else, and this has to agree with it or a location would resolve on the server
   * and not on screen. Weakest first: a code, then an alias somebody recorded,
   * then the location's own name.
   *
   * The code is in here because it is what the 4WLA is actually filled in with.
   * That sheet's Location column says "W30", not "Wayside 30", and a register
   * that only knew names and hand-written aliases matched none of it — which is
   * the same failure a roster of full names had against a Resource row of first
   * names. It is not a guess: `rc_locations.code` is a field somebody typed for
   * this location and no other.
   */
  function locationRegister(locations, aliases = []) {
    const map = new Map();
    for (const l of locations || []) {
      const key = foldName(l.code);
      if (key) map.set(key, l.id);
    }
    for (const a of aliases || []) {
      const key = foldName(a.alias);
      if (key) map.set(key, a.location_id);
    }
    for (const l of locations || []) {
      const key = foldName(l.name);
      if (key) map.set(key, l.id);
    }
    return map;
  }

  /**
   * The spellings of a place the look-ahead uses that the register cannot place.
   *
   * The other half of pulling the location off the sheet. Keeping an unresolved
   * spelling is only worth doing if somebody is shown it, and this is what the
   * Resources tab lists — one click from "add it as a location" or "that is one we
   * already have", exactly as an unmatched name and an unmapped colour are. A
   * location nobody has mapped is work whose place is written down and not
   * grouped, which is the one thing that makes a report quietly wrong rather than
   * visibly incomplete.
   */
  function unmatchedLocations(laRows, register) {
    const seen = new Map();
    for (const row of laRows || []) {
      if (row.location_id) continue;
      const written = String(row.raw_location || '').trim();
      const key = foldName(written);
      if (!key || register?.get(key)) continue;
      const held = seen.get(key) || { name: written, rows: [], weeks: new Set() };
      if (!held.rows.some((r) => r.id === row.id)) held.rows.push(row);
      if (row.week_start) held.weeks.add(row.week_start);
      seen.set(key, held);
    }
    return [...seen.values()].sort((a, b) => b.rows.length - a.rows.length);
  }

  /**
   * First name to person, for the names that belong to exactly one of them.
   *
   * The 4WLA's Resource row is filled in by hand at speed and it says "Victor",
   * not "Victor Okonkwo" — so a register that only knew full names matched almost
   * nothing on a real sheet. A first name is a deliberate convention here rather
   * than a guess at a spelling, which is what makes this different from matching
   * on a surname or a near miss.
   *
   * **Only where it is unambiguous.** Two people called Victor and the name maps
   * to neither: picking one would put a shift against the wrong engineer, which is
   * the one outcome this module is built to avoid, and it would do it silently
   * because both answers look equally plausible on screen. The pair goes to the
   * unmatched list instead, where `ambiguousFirstNames()` lets the interface say
   * *why* it could not place the name — the answer is an alias, once, and then it
   * is settled for good.
   *
   * A roster name that is already one word registers as a full name anyway, so
   * this only ever adds keys; it never changes what a complete name means.
   */
  function uniqueFirstNames(people) {
    const seen = new Map();
    for (const person of people || []) {
      const first = foldName(String(person.name || '').trim().split(/\s+/)[0]);
      if (!first) continue;
      if (seen.has(first)) seen.get(first).push(person.id);
      else seen.set(first, [person.id]);
    }
    return [...seen.entries()]
      .filter(([, ids]) => ids.length === 1)
      .map(([key, ids]) => [key, ids[0]]);
  }

  /**
   * The first names more than one person answers to.
   *
   * Reported rather than resolved. "Nobody on the roster is called that" and "two
   * people are, and I will not choose between them" are different problems with
   * different fixes, and a list that ran them together would send somebody looking
   * for a missing person who is already there twice.
   */
  function ambiguousFirstNames(people) {
    const seen = new Map();
    for (const person of people || []) {
      const first = foldName(String(person.name || '').trim().split(/\s+/)[0]);
      if (!first) continue;
      seen.set(first, (seen.get(first) || 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key));
  }

  /**
   * The newest read of each week, whole — one row per (week, row key).
   *
   * `rc_lookahead_rows` keeps every read, so asking for a span of weeks returns
   * the same activity once per snapshot, and drawn straight out that is the same
   * person at the same place four times over. `rank` maps a snapshot id to its
   * position in `listSnapshots()` output, which is newest first, so the lowest
   * rank wins. A row whose snapshot is not in the map is treated as oldest rather
   * than dropped: it is still a read that happened.
   *
   * **The unit is the week, not the row.** Taking the newest copy of each row key
   * independently keeps a row that only an *older* snapshot carries — so an
   * activity somebody deleted from the workbook went on being somebody's plan for
   * ever, and the symptom was the one that is impossible to argue with: a person
   * booked in the week plan onto an activity that is not in the 4WLA. A snapshot
   * is a complete statement of the weeks it covers, so the newest one to mention a
   * week is that week's answer and a row missing from it was removed. Older reads
   * of the same week are still on the record; they are simply not the plan.
   * A week the newest file no longer reaches keeps the newest read that did cover
   * it, which is what makes a rolled-forward window show last month at all.
   */
  function newestPerKey(rows, rank) {
    const at = (row) => (rank.has(row.snapshot_id) ? rank.get(row.snapshot_id) : Number.MAX_SAFE_INTEGER);

    // The newest read that says anything about each week.
    const newestFor = new Map();
    for (const row of rows || []) {
      const held = newestFor.get(row.week_start);
      if (held === undefined || at(row) < held) newestFor.set(row.week_start, at(row));
    }

    const best = new Map();
    for (const row of rows || []) {
      if (at(row) !== newestFor.get(row.week_start)) continue;
      const key = `${row.week_start}|${row.row_key}`;
      if (!best.has(key)) best.set(key, row);
    }
    return [...best.values()];
  }

  /**
   * The newest snapshot, read as a calendar — once.
   *
   * `applyLegend()` and `readGrid()` are pure over the grid and the legend, and
   * they are not cheap: a hundred and forty rows by a hundred days, resolved
   * against the legend and then walked for the date axis, the headings, the
   * Resource rows and the absence rows. Five screens were doing that on every
   * visit, over the same snapshot and the same legend, and each one paid for it
   * in the gap between the click and the table.
   *
   * So the parse is remembered against what it was made from — the snapshot's id
   * and the legend as it stands — and handed back whole to the next caller. The
   * legend is part of the key on purpose: mapping a colour has to change what is
   * on screen at once, which is the rule the whole legend design rests on, and a
   * memo that ignored it would show the old reading until the next reload. One
   * entry, because there is one newest snapshot; a new read replaces it.
   */
  let parsed = null;

  function parsedView(snapshot, legendRows) {
    const key = `${snapshot.id}|${snapshot.taken_at}|${JSON.stringify(legendOf(legendRows))}`;
    if (parsed?.key === key) return parsed.view;
    const view = viewOfSnapshot(snapshot, legendRows);
    parsed = { key, view };
    return view;
  }

  function legendOf(legendRows) {
    return (legendRows || []).map((r) => ({
      argb: r.argb, meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from,
    }));
  }

  /**
   * A reading's grid as a view, parsed every time and remembered nowhere — for an
   * older reading the calendar pages back to, which must not push the newest one
   * out of `parsedView()`'s single slot that every other tab shares.
   */
  function viewOfSnapshot(snapshot, legendRows) {
    const grid = applyLegend(snapshot.grid, legendOf(legendRows));
    // The colours the legend could not place ride along: they are a fact about
    // this grid under this legend, which is exactly what the key says.
    return { ...readGrid(grid, { anchorISO: snapshot.taken_at }), unknown: grid.unknown || [] };
  }

  /**
   * The look-ahead for a span of weeks: `{ rows, absences }`.
   *
   * Two answers rather than one, because the sheet says two things. `rows` is the
   * work — one per activity per week, with who is on it and where. `absences` is
   * the "PTO" and "Other Group / Project" rows, which are about people rather than
   * about work and are therefore never rows of scope.
   *
   * The one place the three views ask, so they cannot disagree about where
   * somebody is — the week plan, the Resources tab and the huddle all come
   * through here.
   *
   * **The names are taken from the snapshot, not from the stored column.** They
   * are stored too, in `rc_lookahead_rows.resources`, and that is what a join
   * wants — but a database built before that column existed refuses the insert
   * over it, and the only symptom was three screens quietly reporting that the
   * workbook named nobody while the calendar, which re-reads the snapshot, showed
   * the names perfectly well. So the snapshot is the authority here for the same
   * reason it is for the legend: it is re-read at paint time, so it is right the
   * moment somebody edits the sheet rather than at the next successful write.
   *
   * **And where the sheet says the work is**, for the same reason and out of the
   * same grid — see `graftLocations()`. Between them they are why a derived day
   * arrives in the week plan, the Resources tab and the huddle with both a person
   * and a place against it, and why recording an outcome on one files it at that
   * place rather than nowhere.
   *
   * Grafted onto the stored rows rather than replacing them, because those carry
   * the id a plan entry links to and the location the alias register resolved.
   * The join is `sheet_row` within a week, which is a position in one file — so it
   * is only offered the rows that came out of *this* snapshot. Across two reads a
   * row inserted mid-sheet shifts every row below it, and the graft would then
   * hand an activity another activity's names and another activity's place. It
   * fills a gap rather than overruling one, which is what the stored column is for
   * once a project has it.
   */
  async function lookaheadWithResources(fromISO, toISO) {
    /* The snapshot *list* is read without its grids — that is what `newestPerKey`
       ranks on, and it only needs the ids in order. The one grid anybody draws is
       fetched on its own. Reading twenty grids to use one was most of the wait
       between tabs. */
    const [stored, snapshots, snapshot, legendRows, locations, locAliases] = await Promise.all([
      rc.lookaheadBetween(fromISO, toISO).catch(() => []),
      rc.listSnapshotMeta({ limit: 20 }).catch(() => []),
      rc.latestSnapshot().catch(() => null),
      rc.listLegend().catch(() => []),
      rc.listLocations({ includeInactive: true }).catch(() => []),
      rc.listLocationAliases().catch(() => []),
    ]);

    const laRows = namedCancellations(
      newestPerKey(stored, new Map(snapshots.map((s, i) => [s.id, i]))),
      legendRows
    );
    /* Which reading this is, so a screen drawn from it can tell when a newer one
       has been published — see `watchForNewReading()`. */
    const snapshotId = snapshot?.id ?? null;
    if (!snapshot?.grid) return { rows: laRows, absences: [], snapshotId };

    const view = parsedView(snapshot, legendRows);
    const rows = graftLocations(
      graftResources(laRows, view, snapshot.id),
      view,
      locationRegister(locations, locAliases),
      snapshot.id
    );
    /* Narrowed to the window that was asked for, because the snapshot carries the
       whole four-to-six weeks and a caller asking about one week must not be told
       who is off in another. */
    const absences = absencesFrom(view).filter((a) => a.date >= fromISO && a.date <= toISO);
    return { rows, absences, snapshotId };
  }

  /**
   * Give a day stored as a bare colour the legend's word for it, where that word
   * is a cancellation.
   *
   * A day read before red was mapped is stored as `#hex`, and it is cancelled all
   * the same once the legend says what the colour is — which is the rule
   * `rc_cancelled_days` reads the log by. Without this the log would list the day
   * as cancelled while the week plan still drew the team on it. Only cancellation
   * is named here: what any other colour means is the legend's to say when the
   * sheet is next read, and the shift a day is drawn as stays what it was.
   */
  function namedCancellations(laRows, legendRows) {
    const cancel = new Map((legendRows || [])
      .filter((l) => isCancelMeaning(l.meaning))
      .map((l) => [`#${l.argb}`, l.meaning]));
    if (!cancel.size) return laRows;
    return (laRows || []).map((row) => {
      let cells = null;
      for (const [date, said] of Object.entries(row.cells || {})) {
        if (!cancel.has(said)) continue;
        cells = cells || { ...row.cells };
        cells[date] = cancel.get(said);
      }
      return cells ? { ...row, cells } : row;
    });
  }

  /**
   * Did the look-ahead cancel this activity on this day? The activity line's own
   * paint — a Resource row's red is somebody marking names and never reaches
   * `cells` (see `rowsFrom()`). One test, so the week plan, the phone and the
   * cancellation log cannot disagree about which days were called off.
   */
  function cancelledOn(row, iso) {
    return isCancelMeaning(row?.cells?.[iso]);
  }

  /**
   * Fill in each row's location from the grid's own Location column.
   *
   * Here for the reason the names are: a row written by a deployment that read
   * the location differently — or could not resolve it and therefore kept nothing
   * — carries no place at all, and the snapshot on screen says exactly where the
   * work is. The sheet is re-read at paint time, so this is right the moment
   * somebody corrects the workbook rather than at the next successful ingest.
   *
   * **It fills gaps and overrules nothing.** A stored `location_id` is a spelling
   * the register resolved when the row was written and is left alone; the raw text
   * is only supplied where there is none. The resolve is the same folded lookup
   * the server does, so a place resolves identically whether it arrived through
   * the ingest or through here.
   */
  function graftLocations(laRows, view, register, snapshotId) {
    const column = locationColumnOf(view);
    if (column < 0) return laRows;

    const bySheetRow = new Map();
    for (const activity of view?.activities || []) {
      const text = String(activity.meta?.[column] || '').trim();
      if (text) bySheetRow.set(activity.row, text);
    }
    if (!bySheetRow.size) return laRows;

    return (laRows || []).map((row) => {
      if (!fromSnapshot(row, snapshotId)) return row;
      const written = bySheetRow.get(row.sheet_row);
      if (!written) return row;
      const raw = row.raw_location || written;
      const id = row.location_id || register?.get(foldName(raw)) || null;
      if (raw === row.raw_location && id === (row.location_id || null)) return row;
      return { ...row, raw_location: raw, location_id: id };
    });
  }

  /**
   * Is this stored row one of the rows the grid in hand was read from?
   *
   * Both grafts join on `sheet_row`, which is a position in *one* file: rows 42 of
   * two different reads are two different activities the moment anybody inserts a
   * line. A week the newest snapshot no longer covers is served by an older read,
   * so its rows sit beside the newest ones in the same array — and joining the
   * newest grid onto them by position is how somebody ends up with another
   * activity's names and another activity's location. With no snapshot named the
   * guard stands down, because a caller that has not said which file the grid came
   * from is asking for the old behaviour.
   */
  function fromSnapshot(row, snapshotId) {
    return !snapshotId || !row.snapshot_id || row.snapshot_id === snapshotId;
  }

  /** Fill in each row's `resources` from the grid, where the sheet still says so. */
  function graftResources(laRows, view, snapshotId) {
    const dayByCol = new Map((view?.days || []).map((d) => [d.col, d]));

    const bySheetRow = new Map();
    for (const activity of view?.activities || []) {
      if (!activity.resource) continue;
      const perDay = {};
      for (const mark of activity.resource.marks) {
        if (!mark.value) continue;
        const day = dayByCol.get(mark.col);
        if (day?.date) perDay[day.date] = mark.value;
      }
      if (Object.keys(perDay).length) bySheetRow.set(activity.row, perDay);
    }
    if (!bySheetRow.size) return laRows;

    const mondayOf = (iso) => toISO(weekStart(isoToMs(iso)));
    return (laRows || []).map((row) => {
      if (!fromSnapshot(row, snapshotId)) return row;
      const perDay = bySheetRow.get(row.sheet_row);
      if (!perDay) return row;
      // A row belongs to one week; a name on a day in another week belongs to that
      // week's copy of the row, not to this one.
      const mine = {};
      for (const [date, names] of Object.entries(perDay)) {
        if (mondayOf(date) === row.week_start) mine[date] = names;
      }
      return Object.keys(mine).length
        ? { ...row, resources: { ...(row.resources || {}), ...mine } }
        : row;
    });
  }

  /**
   * Who the look-ahead's Resource rows put where, per day.
   *
   * Returns `byPerson` — a person id to a map of date to the rows naming them —
   * `unmatched`, the spellings the register cannot place at all, and `near`, the
   * ones it placed by correcting a misspelling. The second and third halves are
   * the point as much as the first: a name nobody has mapped is a person missing
   * from the picture, and a name matched approximately is one placed on a judgement
   * somebody should get the chance to confirm. Reporting both is the difference
   * between a view that is incomplete and one that is quietly wrong.
   */
  function resourceAssignments(laRows, register) {
    const byPerson = new Map();
    const unmatched = new Map();
    const near = new Map();
    const resolve = nameResolver(register);

    for (const row of laRows || []) {
      for (const [date, text] of Object.entries(row.resources || {})) {
        for (const written of resourceNames(text)) {
          const key = foldName(written);
          if (!key) continue;
          const { id: personId, corrected } = resolve(key);
          if (!personId) {
            const seen = unmatched.get(key) || { name: written, days: new Set(), rows: [] };
            seen.days.add(date);
            if (!seen.rows.some((r) => r.id === row.id)) seen.rows.push(row);
            unmatched.set(key, seen);
            continue;
          }
          if (corrected) {
            const seen = near.get(key)
              || { name: written, person_id: personId, days: new Set(), rows: [] };
            seen.days.add(date);
            if (!seen.rows.some((r) => r.id === row.id)) seen.rows.push(row);
            near.set(key, seen);
          }
          if (!byPerson.has(personId)) byPerson.set(personId, new Map());
          const days = byPerson.get(personId);
          if (!days.has(date)) days.set(date, []);
          if (!days.get(date).some((r) => r.id === row.id)) days.get(date).push(row);
        }
      }
    }

    return { byPerson, unmatched: [...unmatched.values()], near: [...near.values()] };
  }

  /**
   * The register's answer for one folded spelling: exact where it has one, the
   * nearest unambiguous misspelling where it does not.
   *
   * A closure rather than a bare function because the near-miss scan walks the
   * whole register, and a hundred days of a real sheet ask about the same handful
   * of spellings over and over — memoising is what keeps that one pass rather than
   * thousands. `corrected` says which of the two answers it is, so a caller can
   * report a name it only matched approximately instead of quietly absorbing it.
   */
  function nameResolver(register) {
    const memo = new Map();
    return (key) => {
      if (memo.has(key)) return memo.get(key);
      const exact = register.get(key);
      const answer = exact
        ? { id: exact, corrected: null }
        : (() => {
          const guess = nearestName(key, register);
          return guess ? { id: guess.id, corrected: guess.key } : { id: null, corrected: null };
        })();
      memo.set(key, answer);
      return answer;
    };
  }

  /**
   * Who the sheet says is away, matched to the roster.
   *
   * The same shape and the same rules as `resourceAssignments()` — exact fold,
   * full name over alias over a first name exactly one person answers to, and an
   * unmatched spelling reported rather than guessed at. A name typed on the PTO
   * row is the same kind of thing as a name typed on a Resource row, so there is
   * one register and not a second one that could disagree about who "Victor" is.
   *
   * **Being off outranks everything else.** Somebody written on the PTO row and
   * on a work row for the same day is the sheet contradicting itself about one
   * person, and the stronger claim is the one saying they were not there at all:
   * on another project or at their desk they are working and can be asked how it
   * went, and on leave they cannot.
   *
   * Two *work* rows on one day are not a contradiction, though — a morning at the
   * desk and an afternoon on somebody else's project is an ordinary day — so the
   * answer is a list, the same shape the plan itself now has. It is a list per
   * day rather than a single kind for exactly that reason: collapsing them would
   * drop one of the two things the sheet plainly said.
   */
  function absenceAssignments(absences, register) {
    const byPerson = new Map();
    const unmatched = new Map();
    const near = new Map();
    const resolve = nameResolver(register);

    for (const entry of absences || []) {
      for (const written of resourceNames(entry.written)) {
        const key = foldName(written);
        if (!key) continue;
        const { id: personId, corrected } = resolve(key);
        if (corrected && personId) {
          const seen = near.get(key)
            || { name: written, person_id: personId, days: new Set(), rows: [] };
          seen.days.add(entry.date);
          near.set(key, seen);
        }
        if (!personId) {
          const seen = unmatched.get(key) || { name: written, days: new Set(), kinds: new Set() };
          seen.days.add(entry.date);
          seen.kinds.add(entry.kind);
          unmatched.set(key, seen);
          continue;
        }
        if (!byPerson.has(personId)) byPerson.set(personId, new Map());
        const days = byPerson.get(personId);
        const kinds = days.get(entry.date) || [];
        if (kinds.includes(entry.kind)) continue;
        if (entry.kind === 'pto') days.set(entry.date, ['pto']);
        else if (!kinds.includes('pto')) days.set(entry.date, [...kinds, entry.kind]);
      }
    }

    return { byPerson, unmatched: [...unmatched.values()], near: [...near.values()] };
  }

  /**
   * What the workbook's wording says the shift is.
   *
   * The meaning is the legend's word for the colour, so "Night Shift" and
   * "Blanket" are the sheet's own vocabulary rather than ours. Anything it does
   * not recognise is a day shift, which is what an unlabelled cell has always
   * meant on this project.
   */
  function shiftFor(meaning) {
    const said = String(meaning || '').toLowerCase();
    if (/night/.test(said)) return 'night';
    if (/possession|blanket/.test(said)) return 'possession';
    return 'day';
  }

  /**
   * What somebody is doing on a day: the plan where there is one, the 4WLA where
   * there is not.
   *
   * **The look-ahead used to propose and a person assigned.** That rule existed
   * for one reason — the sheet said what and where and *never who*, so a plan
   * entry had to supply the missing fact, and inventing it would have been the
   * guess this module refuses everywhere. The Resource row says who. There is no
   * missing fact left, so asking somebody to press a button is asking them to
   * re-type what the workbook already states, once per person per day.
   *
   * So the 4WLA assignment **is** the plan for that day. It is *derived*, not
   * written: `rc_plan_entries` is append-only evidence of what somebody decided,
   * and materialising the sheet into it would store a derivation — the one thing
   * this codebase is most consistent about not doing — while making the
   * workbook's authorship indistinguishable from a decision anybody took. It
   * would also go stale the moment the sheet changed, and need superseding to
   * correct, which is a revision of something nobody ever revised.
   *
   * A stored entry always wins. That is the whole meaning of one existing: it is
   * somebody overriding the sheet, or planning a day the sheet says nothing about
   * — an office day, another project, a task carried over. The sheet is the
   * default; a row is a decision.
   */
  function assignmentIndex({ planRows, laRows, register, absences = [], categories = [] }) {
    const { byPerson, unmatched, near } = resourceAssignments(laRows, register);
    const away = absenceAssignments(absences, register);

    /* Which seeded category an off-project day belongs to.
       A day in the office is a day somebody worked, and a report that could not
       say *what* they worked on is the blank the `Office` and `Other project`
       categories were seeded to fill. Matched on the name the schema seeds,
       folded; a renamed category stops matching and the day arrives
       uncategorised, which is ungrouped rather than grouped wrongly. */
    const categoryFor = (kind) => {
      const want = ABSENCE_KINDS[kind]?.category;
      if (!want) return null;
      return (categories || []).find((c) => foldName(c.name) === foldName(want))?.id || null;
    };

    /* A day is a **list**. A shift is routinely more than one job — a test to
       witness in the morning and a cable pull after it — and a day that could
       only hold one task is how somebody ends up with one of the three things
       they were asked for. Every view reads it as a list; the one place a single
       entry is still wanted is an outcome, which points at one row, and `at()`
       answers that with the first. */
    const stored = new Map();
    for (const row of planRows || []) {
      const key = `${row.person_id}|${row.work_date}`;
      if (!stored.has(key)) stored.set(key, []);
      stored.get(key).push(row);
    }

    /* Who is away, before who is on what.
       A day on the PTO row and a day on an activity's Resource row are the same
       sheet contradicting itself, and the answer has to be one of them: a person
       recorded as being at a location on a day they were off is exactly the kind
       of thing that gets found a year later in a claim. The row about the *person*
       wins, because it is the more specific statement — and a stored entry still
       beats both, since that is somebody deciding against the sheet. */
    const derived = new Map();
    for (const [personId, days] of away.byPerson) {
      for (const [iso, kinds] of days) {
        const key = `${personId}|${iso}`;
        if (stored.has(key)) continue;
        // One entry per kind: a day at the desk and a day on another group's
        // project are two things the sheet said, not one to choose between.
        derived.set(key, kinds.map((kind) => ({
          id: null,
          from_lookahead: true,
          absence: kind,
          person_id: personId,
          work_date: iso,
          task: ABSENCE_LABELS[kind],
          location_id: null,
          raw_location: null,
          category_id: categoryFor(kind),
          cancelled: false,
          shift: 'day',
          lookahead_row_id: null,
          carry_chain_id: null,
        })));
      }
    }

    for (const [personId, days] of byPerson) {
      for (const [iso, rows] of days) {
        const key = `${personId}|${iso}`;
        if (stored.has(key) || derived.has(key)) continue;
        /* **Every** row the sheet names them on, not the first with a count
           beside it. The workbook putting somebody on two activities in one day
           is the same fact as a scheduler planning two tasks, and reading only
           the first lost the rest with nothing on screen to say so. */
        derived.set(key, rows.map((row) => ({
          // Null, and load-bearing: every caller that writes an outcome or rolls a
          // task forward reads this to decide whether there is a row to point at.
          id: null,
          from_lookahead: true,
          absence: null,
          person_id: personId,
          work_date: iso,
          task: row.raw_label || null,
          location_id: row.location_id || null,
          raw_location: row.raw_location || null,
          category_id: null,
          /* The sheet still names them, and the day is still drawn — a day called
             off is something the person needs to see, not a blank — but as
             cancelled, never as work they are expected at. */
          cancelled: cancelledOn(row, iso),
          shift: shiftFor(row.cells?.[iso]),
          lookahead_row_id: row.id || null,
          carry_chain_id: null,
        })));
      }
    }

    const on = (personId, iso) =>
      stored.get(`${personId}|${iso}`) || derived.get(`${personId}|${iso}`) || [];

    return {
      /* Everything planned for that day, in order. The shape every view reads. */
      on,
      /* The first of them, for the one caller that needs a single row: an outcome
         points at one plan entry, and rolling a task forward carries one chain.
         Null when the day is empty, which is what those callers test. */
      at: (personId, iso) => on(personId, iso)[0] || null,
      /* What the *sheet* says about somebody being away, whatever anybody has
         stored over the top of it. `availability()` takes this, so a person the
         workbook puts on PTO is not asked in the huddle how their day went. */
      absent: (personId, iso) => {
        const kinds = away.byPerson.get(personId)?.get(iso) || [];
        // Leave first: it is the only one `availability()` acts on, and a day
        // carrying it carries nothing else.
        return kinds.includes('pto') ? 'pto' : (kinds[0] || null);
      },
      byPerson,
      unmatched,
      /* Spellings placed by correcting a misspelling rather than by matching one.
         Carried out so the Resources tab can list them: the answer stands, and an
         alias is what turns it from a judgement into a fact. */
      near: [...near, ...away.near],
      awayUnmatched: away.unmatched,
      derived: derived.size,
    };
  }

  /**
   * How each drawn task went, from the huddle's outcomes.
   *
   * Returns `(entry, personId, iso) => outcome | null`. Indexed two ways because
   * an outcome points at one plan entry where there was one to point at, and at
   * nothing but a person and a date where the day was derived from the sheet — so
   * both keys are needed or the derived days, which are most of them, would show
   * no outcome at all. A stored entry is matched on its id and on nothing else:
   * two tasks on one day each carry their own note. A derived day takes whichever
   * outcome was recorded against the person and the date, preferring one that
   * points at no entry, because there is no row for it to point at.
   *
   * One function because the week plan and the phone's week both draw "how it
   * went" against a task, and two readings of one outcome is two answers.
   */
  function outcomeLookup(actuals) {
    const byEntry = new Map();
    const byDay = new Map();
    for (const row of actuals || []) {
      if (row.plan_entry_id) byEntry.set(row.plan_entry_id, row);
      const key = `${row.person_id}|${row.work_date}`;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(row);
    }
    return (entry, personId, iso) => {
      if (entry?.id && byEntry.has(entry.id)) return byEntry.get(entry.id);
      if (entry?.id) return null;
      const day = byDay.get(`${personId}|${iso}`) || [];
      return day.find((a) => !a.plan_entry_id) || day[0] || null;
    };
  }

  /**
   * Whether somebody is available on a date.
   *
   * Leave is the reason this exists. Absence is a different fact from "carried
   * over" or "reassigned", and without somewhere for it to go it gets silently
   * distributed across the performance statuses — which is precisely what the
   * five-status split is designed to prevent.
   *
   * Returns `{ state, leave?, sheet?, asked? }`. `asked` is a leave row nobody
   * has answered yet and it never changes the state: a member asking for a day
   * off must not take themselves out of the schedule, or the administrator would
   * be answering a question that had already answered itself.
   */
  function availability(person, iso, leaveRows, absent = null) {
    const ms = isoToMs(iso);
    const weekday = new Date(ms).getUTCDay() || 7; // ISO: Monday 1 … Sunday 7
    const working = Array.isArray(person?.working_days) ? person.working_days : [1, 2, 3, 4, 5];

    const mine = (leaveRows || []).filter(
      (l) => l.person_id === person.id && l.start_date <= iso && l.end_date >= iso
        && l.status !== 'cancelled' && l.status !== 'declined'
    );
    /* **A request is not leave yet**, and that distinction is the whole point of
       a member being able to ask. An unanswered request used to count here — the
       filter only dropped `cancelled` and `declined` — which would have taken
       somebody out of the schedule the moment they asked and left the
       administrator answering a question that had already answered itself. So it
       is carried alongside instead: the state stays `available`, and `asked` lets
       a screen say the question is open. */
    const leave = mine.find((l) => l.status !== 'requested');
    const asked = mine.find((l) => l.status === 'requested') || null;
    if (leave) return { state: 'leave', leave, asked };
    /* The 4WLA's PTO row, where nobody booked the leave. Most days it is the only
       place the absence is written down at all — somebody types a name into the
       workbook and never opens Organisation — and without reading it the huddle
       asks a person on holiday how their day went, and the week plan shows them as
       a day nobody bothered to fill in. The office and another group's project are
       *not* leave: those are days somebody worked, they can be asked how it went,
       and where they were is the assignment. `ABSENCE_KINDS[kind].leave` is the
       one place that distinction lives. */
    if (absent && ABSENCE_KINDS[absent]?.leave) return { state: 'leave', sheet: absent, asked };
    if (!working.includes(weekday)) return { state: 'non-working', asked };
    return { state: 'available', asked };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The pen, as a button
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Take over editing, or hand it back — the calendar's version of the
   * timeline's *Take over editing* in Import / export. One button, drawn in the
   * banner and beside Edit on the look-ahead, so the two never disagree.
   *
   * Taking it from somebody asks first; taking it when nobody holds it (it was
   * handed back) does not, since there is nobody's work to interrupt.
   */
  function penButton({ primary = false } = {}) {
    const pen = rc.penState();
    if (pen.editing) {
      return el('button', {
        class: 'cx-btn mini ghost rc-pen-btn',
        type: 'button',
        dataset: { action: 'hand-back' },
        title: 'Stop editing, so a colleague can. You go on reading it, read-only, until you take it again.',
        html: icon('eye', { size: 12 }) + '<span>Hand back</span>',
        onClick: async () => {
          await rc.releasePen();
          toast({ message: 'Handed back. The calendar is read-only here until you take over editing again.' });
        },
      });
    }
    return el('button', {
      class: `cx-btn mini${primary ? ' primary' : ''} rc-pen-btn`,
      type: 'button',
      dataset: { action: 'take-over' },
      title: pen.holder ? `Take the calendar from ${pen.holder}` : 'Nobody is editing the calendar — take it to edit',
      html: icon('refresh', { size: 12 }) + '<span>Take over editing</span>',
      onClick: () => takeOverEditing(),
    });
  }

  /** The take-over itself, asking first only when somebody holds the pen. */
  async function takeOverEditing() {
    const { holder } = rc.penState();
    if (holder) {
      const ok = await confirmDialog({
        title: `Take the calendar from ${holder}?`,
        message: 'Do this when they have finished, or have left it open. Anything they had not saved yet '
          + 'is refused when they try, rather than written over what you do.',
        confirmLabel: 'Take over',
      });
      if (!ok) return false;
    }
    await rc.takePen();
    toast({ tone: 'good', message: 'You are editing the calendar.' });
    return true;
  }

  Object.defineProperty(__x, "formModal", { get: () => formModal, enumerable: true });
  Object.defineProperty(__x, "weekStart", { get: () => weekStart, enumerable: true });
  Object.defineProperty(__x, "weekDays", { get: () => weekDays, enumerable: true });
  Object.defineProperty(__x, "allWeekDays", { get: () => allWeekDays, enumerable: true });
  Object.defineProperty(__x, "todayISO", { get: () => todayISO, enumerable: true });
  Object.defineProperty(__x, "isoToMs", { get: () => isoToMs, enumerable: true });
  Object.defineProperty(__x, "dayLabel", { get: () => dayLabel, enumerable: true });
  Object.defineProperty(__x, "byId", { get: () => byId, enumerable: true });
  Object.defineProperty(__x, "authorNames", { get: () => authorNames, enumerable: true });
  Object.defineProperty(__x, "groupBy", { get: () => groupBy, enumerable: true });
  Object.defineProperty(__x, "codeNodes", { get: () => codeNodes, enumerable: true });
  Object.defineProperty(__x, "cancellationLog", { get: () => cancellationLog, enumerable: true });
  Object.defineProperty(__x, "notifyChanged", { get: () => notifyChanged, enumerable: true });
  Object.defineProperty(__x, "watchForNewReading", { get: () => watchForNewReading, enumerable: true });
  Object.defineProperty(__x, "orgNav", { get: () => orgNav, enumerable: true });
  Object.defineProperty(__x, "goToTab", { get: () => goToTab, enumerable: true });
  Object.defineProperty(__x, "STATUSES", { get: () => STATUSES, enumerable: true });
  Object.defineProperty(__x, "STATUS_BY_ID", { get: () => STATUS_BY_ID, enumerable: true });
  Object.defineProperty(__x, "SHIFTS", { get: () => SHIFTS, enumerable: true });
  Object.defineProperty(__x, "shiftLabel", { get: () => shiftLabel, enumerable: true });
  Object.defineProperty(__x, "foldName", { get: () => foldName, enumerable: true });
  Object.defineProperty(__x, "nameRegister", { get: () => nameRegister, enumerable: true });
  Object.defineProperty(__x, "nameDistance", { get: () => nameDistance, enumerable: true });
  Object.defineProperty(__x, "nearestName", { get: () => nearestName, enumerable: true });
  Object.defineProperty(__x, "meMatcher", { get: () => meMatcher, enumerable: true });
  Object.defineProperty(__x, "personMatcher", { get: () => personMatcher, enumerable: true });
  Object.defineProperty(__x, "locationRegister", { get: () => locationRegister, enumerable: true });
  Object.defineProperty(__x, "unmatchedLocations", { get: () => unmatchedLocations, enumerable: true });
  Object.defineProperty(__x, "uniqueFirstNames", { get: () => uniqueFirstNames, enumerable: true });
  Object.defineProperty(__x, "ambiguousFirstNames", { get: () => ambiguousFirstNames, enumerable: true });
  Object.defineProperty(__x, "newestPerKey", { get: () => newestPerKey, enumerable: true });
  Object.defineProperty(__x, "parsedView", { get: () => parsedView, enumerable: true });
  Object.defineProperty(__x, "viewOfSnapshot", { get: () => viewOfSnapshot, enumerable: true });
  Object.defineProperty(__x, "lookaheadWithResources", { get: () => lookaheadWithResources, enumerable: true });
  Object.defineProperty(__x, "cancelledOn", { get: () => cancelledOn, enumerable: true });
  Object.defineProperty(__x, "graftLocations", { get: () => graftLocations, enumerable: true });
  Object.defineProperty(__x, "graftResources", { get: () => graftResources, enumerable: true });
  Object.defineProperty(__x, "resourceAssignments", { get: () => resourceAssignments, enumerable: true });
  Object.defineProperty(__x, "nameResolver", { get: () => nameResolver, enumerable: true });
  Object.defineProperty(__x, "absenceAssignments", { get: () => absenceAssignments, enumerable: true });
  Object.defineProperty(__x, "shiftFor", { get: () => shiftFor, enumerable: true });
  Object.defineProperty(__x, "assignmentIndex", { get: () => assignmentIndex, enumerable: true });
  Object.defineProperty(__x, "outcomeLookup", { get: () => outcomeLookup, enumerable: true });
  Object.defineProperty(__x, "availability", { get: () => availability, enumerable: true });
  Object.defineProperty(__x, "penButton", { get: () => penButton, enumerable: true });
  Object.defineProperty(__x, "takeOverEditing", { get: () => takeOverEditing, enumerable: true });
};

// core/rc_import.js
__mods["core/rc_import.js"] = function (__x, __req) {
  /**
   * The old calendar, brought into the folder.
   *
   * The calendar lived in Supabase until it moved to the shared folder. Its
   * "Back it up" file — `exportEverything()`, every table as rows, BART's blank
   * TAWR form as base64 — is what is read here, once, into an empty folder.
   * Every id is kept, so a cell still points at its row, an edit at what it
   * changed, a reading's rows at the reading, a reason at its cancellation and a
   * TAWR at the request it revised; an account id in `by` or `author` is still
   * named, because a person's roster row still carries the account it had.
   *
   * Only the tables the calendar still keeps come across. The daily huddle, the
   * week plan, the SARs and "Got it" are not carried, and the summary says so,
   * so nobody wonders where they went.
   *
   * Pure — no folder, no DOM — so `tools/test_rc_import.js` holds it in Node.
   *
   * Imports: rc_db.
   */

  const { TABLE_NAMES } = __req("core/rc_db.js");

  /** What the old calendar kept that this one does not, and why it is not needed. */
  const DROPPED = {
    rc_plan_entries: 'the week plan',
    rc_actuals: 'the daily huddle\'s outcomes',
    rc_blockers: 'the huddle\'s blockers',
    rc_blocker_updates: 'the huddle\'s blockers',
    rc_sars: 'SARs',
    rc_sar_links: 'SARs',
    rc_la_seen: 'My day\'s "Got it"',
    rc_client_errors: 'problems reported to the server',
  };

  const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}(:?\d{2})?|Z)$/;

  /**
   * One instant in the one spelling this calendar writes. Postgres answered
   * `2026-10-15T14:02:11.123456+00:00`; this calendar writes `…11.123Z`, and the
   * log is ordered by comparing them as text, so they have to agree.
   */
  function normaliseInstant(value) {
    if (typeof value !== 'string' || !INSTANT.test(value)) return value;
    const ms = Date.parse(value.replace(' ', 'T'));
    return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
  }

  function normaliseRow(row) {
    if (!row || typeof row !== 'object') return row;
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = normaliseInstant(v);
    return out;
  }

  /**
   * Read a backup of the old calendar into rows for `createCalendar()`.
   *
   * Answers `{ tables, files, summary, warnings }`. Throws when the file is not
   * a backup of the calendar at all, and when a table it keeps could not be read
   * when the backup was taken: the calendar is made from this file once, and one
   * made without its readings would hold rows, changes and cancellations that
   * point at nothing — so the answer is a new backup, never an import of this one.
   * Warns, and does not refuse, when it only may be incomplete.
   *
   * @param {any} backup  the parsed JSON
   */
  function readBackup(backup) {
    if (!backup || typeof backup !== 'object' || !backup.tables || typeof backup.tables !== 'object') {
      throw new Error('That file is not a backup of the resource calendar — it has no tables in it.');
    }
    const known = Object.keys(backup.tables).filter((t) => TABLE_NAMES.includes(t) || DROPPED[t]);
    if (!known.length) throw new Error('That file holds no table the calendar knows.');

    const tables = {};
    const summary = [];
    const warnings = [];
    const unread = TABLE_NAMES
      .filter((name) => backup.tables[name] !== undefined && !Array.isArray(backup.tables[name]))
      .map((name) => `${name} (${backup.tables[name]?.error || 'no rows'})`);
    if (unread.length) {
      throw new Error(`This backup is incomplete, so nothing has been written: ${unread.join('; ')} could not be read `
        + 'when it was taken. Take the backup again on the old calendar and import that one.');
    }
    for (const name of TABLE_NAMES) {
      const held = backup.tables[name];
      if (held === undefined) continue;
      tables[name] = held.map(normaliseRow);
      summary.push({ table: name, rows: held.length });
      // PostgREST answered a thousand rows at most, and the backup read each table
      // once until the fix that pages through them.
      if (held.length === 1000) {
        warnings.push(`${name} has exactly 1,000 rows, which is where the old backup stopped. `
          + 'Take a new backup from the old calendar and import that instead.');
      }
    }
    if (!('rc_cancellation_notes' in backup.tables)) {
      warnings.push('This backup has no cancellation reasons in it — it was taken before they were included. '
        + 'Take a new one from the old calendar to keep them.');
    }
    for (const name of Object.keys(backup.tables)) {
      if (!DROPPED[name] || !Array.isArray(backup.tables[name]) || !backup.tables[name].length) continue;
      summary.push({ table: name, rows: backup.tables[name].length, dropped: DROPPED[name] });
    }

    /* A reading's grid can say it was compacted; anything else that is not an
       object is a reading this calendar cannot draw, and is said rather than
       dropped. */
    for (const s of tables.rc_lookahead_snapshots || []) {
      if (s.grid !== null && typeof s.grid !== 'object') {
        warnings.push(`Reading ${s.id} has no grid that can be read.`);
        s.grid = { rows: [], merges: [], hiddenColumns: [], unknown: [], missing: true };
      }
    }

    const files = {};
    const form = backup.files?.['tawr/template.pdf'];
    if (typeof form === 'string' && form) {
      const binary = atob(form);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      files['tawr/template.pdf'] = bytes;
    } else if ((tables.rc_tawrs || []).length) {
      warnings.push('BART\'s blank TAWR form is not in this backup. Put it in under TAWR → Settings before downloading a form.');
    }

    return { tables, files, summary, warnings, exportedAt: backup.exported_at || null, exportedBy: backup.exported_by || null };
  }

  Object.defineProperty(__x, "DROPPED", { get: () => DROPPED, enumerable: true });
  Object.defineProperty(__x, "readBackup", { get: () => readBackup, enumerable: true });
};

// ui/rc_gate.js
__mods["ui/rc_gate.js"] = function (__x, __req) {
  /**
   * The resource calendar's front door: the states that are not the calendar.
   *
   * The calendar lives in the shared folder the plan is in, under `calendar/`.
   * Before it can be drawn there has to be a folder, and the folder has to hold
   * a calendar — so the door is those two questions, and the one-time answer to
   * the second: bring the old calendar in from its backup, or start an empty one.
   *
   * Nothing here is a permission. Whoever can open the folder can open the
   * calendar; the folder's sharing is who may.
   *
   * Imports: util, events, rc, rc_import, filestore, icons, components, commands.
   */

  const { el } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const filestore = __req("core/filestore.js");
  const { readBackup } = __req("core/rc_import.js");
  const { writeBytes } = __req("core/rc_folder.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, toast, openModal } = __req("ui/components.js");
  const { connectFolder, reconnectFolder } = __req("ui/commands.js");

  /** The registers a new calendar starts with — what `rc_schema.sql` seeded. */
  function starterTables(today) {
    return {
      rc_parties: ['Hitachi', 'BART', 'Other team', 'Vendor'].map((name) => ({ name })),
      rc_leave_kinds: [
        ['Annual leave', '#3a76e8', true], ['Sick', '#e0803a', false], ['TOIL', '#16a571', true],
        ['Training', '#9333d9', false], ['Parental', '#0d9488', false], ['Unpaid', '#6b7280', false],
      ].map(([name, color, counts]) => ({ name, color, counts_against_entitlement: counts })),
      rc_support_codes: [['X', 'EIC', 10], ['WIT', 'BART witness', 20], ['TCE', 'TCE', 30]]
        .map(([code, name, sort]) => ({ code, name, party: 'BART', sort })),
      rc_p6_flags: [['Troubleshooting', 10], ['Regression', 20], ['Support', 30]].map(([label, sort]) => ({ label, sort })),
      rc_settings: [
        { key: 'lookahead_sheet', value: '4WLA' },
        { key: 'lookahead_source', value: 'editor' },
        { key: 'cancellation_log_from', value: today },
      ],
    };
  }

  /** This build cannot open a folder at all: a browser without the File System Access API. */
  function notConfigured() {
    return el('div', { class: 'rc-state' }, [
      el('div', { class: 'rc-state-icon', html: icon('database', { size: 32 }) }),
      el('h2', { text: 'The calendar needs a folder' }),
      el('p', {
        text: 'The resource calendar is kept in the shared folder beside the plan. Opening a folder '
          + 'needs the CX Timeline desktop application, or Edge or Chrome.',
      }),
    ]);
  }

  /** Who you are: the name the pen shows and the calendar stamps what you write with. */
  function nameField() {
    const input = textInput({ value: rc.displayName(), placeholder: 'Your name, as the roster has it' });
    input.setAttribute('aria-label', 'Your name');
    input.dataset.field = 'your-name';
    return input;
  }

  function saveName(input) {
    const name = input.value.trim();
    if (!name) throw new Error('Say who you are first — your name, as the roster has it.');
    if (name !== rc.displayName()) filestore.setDisplayName(name);
  }

  /** No folder connected yet. */
  function noFolder({ onDone = () => {} } = {}) {
    const remembered = el('div');
    filestore.storedFolder().then((last) => {
      if (!last?.folder || filestore.state().desktop) return;
      remembered.appendChild(el('button', {
        class: 'cx-btn ghost', type: 'button', text: `Reconnect to ${last.folder}`,
        onClick: async () => { if (await reconnectFolder()) onDone(); },
      }));
    }).catch(() => {});
    return el('div', { class: 'rc-state' }, [
      el('div', { class: 'rc-state-icon', html: icon('folder', { size: 32 }) }),
      el('h2', { text: 'Open the shared folder' }),
      el('p', {
        text: 'The calendar is kept in the same OneDrive folder as the plan, under calendar/. '
          + 'Open that folder and the calendar opens with it — nothing is kept anywhere else.',
      }),
      el('div', { class: 'rc-signin' }, [
        el('button', {
          class: 'cx-btn primary', type: 'button', text: 'Open the folder…',
          onClick: async () => { if (await connectFolder()) onDone(); },
        }),
        remembered,
      ]),
    ]);
  }

  /**
   * A folder with no calendar in it: bring the old one in, or start empty.
   *
   * The import is offered first because it is the one that matters: the old
   * calendar's backup carries every reading, edit, reason and TAWR, and an
   * empty calendar started by mistake would have to be cleared before it could
   * be brought in.
   */
  function emptyFolder({ onDone = () => {} } = {}) {
    const name = nameField();
    const error = el('div', { class: 'rc-error', hidden: true });
    const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileInput.dataset.field = 'backup';

    const say = (err) => {
      error.textContent = err?.message || String(err);
      error.hidden = false;
    };

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        saveName(name);
        const parsed = readBackup(JSON.parse(await file.text()));
        await confirmImport(parsed, file.name, onDone);
      } catch (err) {
        say(err);
      }
    });

    return el('div', { class: 'rc-state' }, [
      el('div', { class: 'rc-state-icon', html: icon('database', { size: 32 }) }),
      el('h2', { text: 'This folder has no calendar yet' }),
      el('p', {
        text: `${filestore.state().folder || 'The folder'} is open, and there is no calendar/ in it. `
          + 'Bring the old calendar in from its backup — taken in the old calendar under Reports → Back it up — '
          + 'or start an empty one.',
      }),
      el('div', { class: 'rc-signin' }, [
        name,
        error,
        el('button', {
          class: 'cx-btn primary', type: 'button', text: 'Import the old calendar…',
          dataset: { action: 'import' },
          onClick: () => {
            try {
              saveName(name);
              fileInput.click();
            } catch (err) {
              say(err);
            }
          },
        }),
        el('button', {
          class: 'cx-btn ghost', type: 'button', text: 'Start an empty calendar',
          dataset: { action: 'start-empty' },
          onClick: async () => {
            try {
              saveName(name);
              await rc.createCalendar(starterTables(new Date().toISOString().slice(0, 10)), { source: 'new' });
              toast({ tone: 'good', message: 'An empty calendar is ready in calendar/.' });
              onDone();
            } catch (err) {
              say(err);
            }
          },
        }),
        fileInput,
      ]),
    ]);
  }

  /** What is in the backup, and what is not coming, before anything is written. */
  function confirmImport(parsed, fileName, onDone) {
    return new Promise((resolve) => {
      const kept = parsed.summary.filter((s) => !s.dropped);
      const dropped = parsed.summary.filter((s) => s.dropped);
      const total = kept.reduce((n, s) => n + s.rows, 0);
      const list = (items, render) => el('ul', { class: 'rc-import-list' }, items.map((s) => el('li', { text: render(s) })));
      const body = el('div', { class: 'cx-form' }, [
        el('p', {
          text: `${fileName}${parsed.exportedAt ? `, taken ${new Date(parsed.exportedAt).toLocaleString()}` : ''}`
            + `${parsed.exportedBy ? ` by ${parsed.exportedBy}` : ''}: ${total} rows in ${kept.length} tables.`,
        }),
        parsed.warnings.length
          ? el('div', { class: 'rc-error', role: 'alert' }, [list(parsed.warnings.map((w) => ({ w })), (x) => x.w)])
          : null,
        list(kept, (s) => `${s.table.replace(/^rc_/, '').replace(/_/g, ' ')} — ${s.rows}`),
        dropped.length
          ? el('p', {
            class: 'rc-hint',
            text: `Not brought across, because the calendar no longer has them: ${[...new Set(dropped.map((d) => d.dropped))].join(', ')}.`,
          })
          : null,
      ].filter(Boolean));
      let settled = false;
      const done = (value) => { if (!settled) { settled = true; resolve(value); } };
      openModal({
        title: 'Bring the old calendar in?',
        body,
        onClose: () => done(false),
        actions: [
          { label: 'Cancel', onClick: () => done(false) },
          {
            label: 'Import',
            kind: 'primary',
            keepOpen: true,
            onClick: async (handle) => {
              try {
                await rc.createCalendar(parsed.tables, { source: 'import' });
                for (const [path, bytes] of Object.entries(parsed.files)) await writeBytes(path, bytes);
                done(true);
                handle.close();
                toast({ tone: 'good', title: 'The old calendar is in the folder', message: `${total} rows, every id kept.` });
                onDone();
              } catch (err) {
                toast({ tone: 'bad', title: 'The import did not finish', message: err?.message || String(err) });
              }
            },
          },
        ],
      });
    });
  }

  /** The folder could not be read — half-synced, or written by a newer version. */
  function readFailed(message, { onDone = () => {} } = {}) {
    return el('div', { class: 'rc-state' }, [
      el('div', { class: 'rc-state-icon', html: icon('warning', { size: 32 }) }),
      el('h2', { text: 'The calendar could not be read' }),
      el('p', { text: message || 'Something in calendar/ could not be read.' }),
      el('button', {
        class: 'cx-btn', type: 'button', text: 'Try again',
        onClick: async () => { await rc.init(); onDone(); },
      }),
    ]);
  }

  Object.defineProperty(__x, "starterTables", { get: () => starterTables, enumerable: true });
  Object.defineProperty(__x, "notConfigured", { get: () => notConfigured, enumerable: true });
  Object.defineProperty(__x, "noFolder", { get: () => noFolder, enumerable: true });
  Object.defineProperty(__x, "emptyFolder", { get: () => emptyFolder, enumerable: true });
  Object.defineProperty(__x, "readFailed", { get: () => readFailed, enumerable: true });
};

// ui/rc_settings.js
__mods["ui/rc_settings.js"] = function (__x, __req) {
  /**
   * Lists → Settings: the calendar's settings, changed on screen.
   *
   * Each is one row in `rc_settings`, one field and a Save, written through
   * `rc.setSetting()`. The calendar is in the shared folder, so a setting
   * changed here is changed for everybody who opens it.
   *
   * Imports: util, rc, components, rc_util, io/exporters.
   */

  const { el } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { textInput, toast } = __req("ui/components.js");
  const { notifyChanged, dayLabel, todayISO } = __req("ui/rc_util.js");
  const { saveFile } = __req("io/exporters.js");

  /** How long an editor-published reading is kept whole, unless somebody says otherwise. */
  const DEFAULT_KEEP_DAYS = 60;

  const value = (settings, key) => settings.find((r) => r.key === key)?.value ?? null;

  async function renderSettings(host) {
    const settings = await rc.listSettings().catch(() => []);

    host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Settings' })]));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'What the calendar is set to. They are kept in the shared folder, so they are the same for everybody who opens it.',
    }));

    const list = el('div', { class: 'rc-settings' });
    host.appendChild(list);

    /* ── The look-ahead ─────────────────────────────────────────────────── */
    list.appendChild(group('The look-ahead'));

    list.appendChild(textRow({
      key: 'lookahead_title',
      label: 'Title on the export',
      hint: 'Printed across the top of the Excel export.',
      current: value(settings, 'lookahead_title') || '',
      placeholder: 'Four Week Look-Ahead',
      said: (v) => (v ? `The export is titled "${v}".` : 'The export has no title.'),
    }));

    list.appendChild(textRow({
      key: 'cancellation_log_from',
      label: 'Cancellation log starts on',
      hint: 'The first day the cancellation log counts — a date from the contract, not from the code.',
      current: value(settings, 'cancellation_log_from') || '',
      type: 'date',
      required: true,
      said: (v) => `The cancellation log starts on ${dayLabel(v)}.`,
    }));

    /* ── Keeping the record tidy ────────────────────────────────────────── */
    list.appendChild(group('Housekeeping'));
    list.appendChild(textRow({
      key: 'snapshot_keep_days',
      label: 'Keep every editor reading for',
      hint: 'The editor takes a reading when you finish editing, and when it has been quiet a while. Older than this, only the last reading of each day keeps its grid; '
        + 'every workbook read, every reading\'s rows and the change register are kept regardless.',
      current: value(settings, 'snapshot_keep_days') || String(DEFAULT_KEEP_DAYS),
      type: 'number',
      suffix: 'days',
      required: true,
      check: (v) => (Number.isInteger(Number(v)) && Number(v) >= 14 ? null : 'At least 14 days, in whole days.'),
      said: (v) => `Editor readings are kept whole for ${v} days.`,
    }));

    list.appendChild(row({
      label: 'Tidy the readings now',
      hint: 'The editor does this once a day on its own. Only the grids of superseded editor readings go — the readings, their rows and every link to them stay.',
      control: el('div', { class: 'rc-settings-inline' }, [
        el('button', {
          class: 'cx-btn mini', type: 'button', text: 'Tidy now',
          onClick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              const n = await rc.compactSnapshots();
              toast({
                tone: 'good',
                message: n ? `${n} older reading${n === 1 ? '' : 's'} compacted.` : 'Nothing to tidy — every reading is within the keep period or the last of its day.',
              });
            } catch (err) {
              toast({ tone: 'bad', message: err?.message || String(err) });
            } finally {
              e.currentTarget.disabled = false;
            }
          },
        }),
      ]),
    }));

    /* ── Where it is ─────────────────────────────────────────────────────── */
    list.appendChild(group('Where it is'));
    list.appendChild(row({
      label: 'Folder',
      hint: 'The calendar is the calendar/ folder inside the shared folder the plan is in. '
        + 'OneDrive keeps every version of every file in it, under Version history.',
      control: el('span', { class: 'rc-settings-mono', text: `${rc.status().folder || '—'}/calendar` }),
    }));
    list.appendChild(row({
      label: 'A copy of everything',
      hint: 'Every table as one file, with BART\'s blank TAWR form. It opens in an empty folder through the same import the old calendar came in by.',
      control: el('button', {
        class: 'cx-btn mini', type: 'button', text: 'Back it up',
        onClick: async () => {
          try {
            const data = await rc.exportEverything();
            const rows = Object.values(data.tables).reduce((n, t) => n + (Array.isArray(t) ? t.length : 0), 0);
            saveFile(`resource-calendar-${todayISO()}.json`, JSON.stringify(data), 'application/json',
              `${rows} rows across ${Object.keys(data.tables).length} tables`);
          } catch (err) {
            toast({ tone: 'bad', message: err?.message || String(err) });
          }
        },
      }),
    }));
  }

  function group(title) {
    return el('div', { class: 'rc-settings-group', text: title });
  }

  function row({ label, hint, control }) {
    return el('div', { class: 'rc-settings-row' }, [
      el('div', { class: 'rc-settings-label' }, [
        el('div', { class: 'rc-settings-name', text: label }),
        hint ? el('div', { class: 'rc-hint', text: hint }) : null,
      ].filter(Boolean)),
      el('div', { class: 'rc-settings-control' }, [control]),
    ]);
  }

  /**
   * A setting that is a piece of text, a date or a number: the field, and a Save
   * that stays greyed until something changed. Enter saves too.
   */
  function textRow({ key, label, hint, current, placeholder = '', type = 'text', suffix = '', required = false, check = null, said }) {
    const input = textInput({ value: current, placeholder });
    input.type = type;
    input.setAttribute('aria-label', label);
    input.dataset.setting = key;
    if (type === 'number') { input.min = '14'; input.step = '1'; input.style.width = '90px'; }
    const button = el('button', { class: 'cx-btn mini', type: 'button', text: 'Save', disabled: true });
    const sync = () => { button.disabled = input.value.trim() === String(current).trim(); };
    input.addEventListener('input', sync);
    const commit = async () => {
      const v = input.value.trim();
      if (v === String(current).trim()) return;
      if (required && !v) {
        toast({ tone: 'warn', message: `${label} cannot be empty.` });
        return;
      }
      const problem = check?.(v);
      if (problem) {
        toast({ tone: 'warn', message: problem });
        return;
      }
      if (await save(key, v, said(v))) {
        current = v;
        sync();
      }
    };
    button.addEventListener('click', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    return row({
      label,
      hint,
      control: el('div', { class: 'rc-settings-inline' }, [
        input,
        suffix ? el('span', { class: 'rc-hint', style: 'margin:0', text: suffix }) : null,
        button,
      ].filter(Boolean)),
    });
  }

  async function save(key, v, message) {
    try {
      await rc.setSetting(key, v);
      toast({ tone: 'good', message });
      notifyChanged('settings');
      return true;
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
      return false;
    }
  }

  Object.defineProperty(__x, "DEFAULT_KEEP_DAYS", { get: () => DEFAULT_KEEP_DAYS, enumerable: true });
  Object.defineProperty(__x, "renderSettings", { get: () => renderSettings, enumerable: true });
};

// ui/rc_roster.js
__mods["ui/rc_roster.js"] = function (__x, __req) {
  /**
   * Lists — the roster, locations, parties, leave and the calendar's settings.
   *
   * Reference data before transactional data: nothing else in the calendar means
   * anything until there are people to schedule and places to send them.
   *
   * Two decisions run through it. **Nothing anybody has used is ever deleted** —
   * a leaver's history has to stay while they drop out of every picker, which is
   * what Retire does and why it is the first answer offered. Delete is the
   * second, and it is for the row that was never meant: somebody added twice, a
   * location typed wrong. The database decides which is which —
   * `rc_delete_location()` counts what points at the row and refuses with the
   * number. And **every vocabulary is a table**, because "T12" one week and
   * "TPSS 12" the next are two places to a computer and one to a person.
   *
   * Imports: util, rc, icons, components, rc_util, rc_settings.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, selectInput, toast, confirmDialog, promptDialog, field, badge, checkbox } = __req("ui/components.js");


  const { notifyChanged, byId, dayLabel, todayISO, formModal, orgNav } = __req("ui/rc_util.js");
  const { renderSettings } = __req("ui/rc_settings.js");

  const SECTIONS = ['people', 'locations', 'parties', 'leave', 'settings'];
  let section = null;

  /**
   * The Delete button that sits beside Retire.
   *
   * It asks first, and then it lets the database answer. Nothing here works out
   * whether a row is safe to remove: the interface cannot see every table that
   * might point at it, and a check written twice is a check that will one day
   * disagree with itself. The refusal Postgres raises already names the number of
   * records in the way and says to retire instead, so it is shown as it comes.
   */
  function deleteButton({ label, message, run, after }) {
    return el('button', {
      class: 'cx-btn mini ghost danger',
      text: 'Delete',
      title: 'Removes it for good. Refused, with a count, if anything has been recorded against it '
        + '— retire it in that case, which keeps the history.',
      onClick: safely(async () => {
        const ok = await confirmDialog({
          title: label,
          message,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        try {
          await run();
          toast({ tone: 'good', message: 'Deleted.' });
          notifyChanged(after);
        } catch (err) {
          toast({ tone: 'bad', message: err?.message || String(err) });
        }
      }),
    });
  }

  async function render(root) {
    const visible = SECTIONS;
    if (orgNav.section) {
      section = orgNav.section;
      orgNav.section = null;
    }
    if (!visible.includes(section)) section = visible[0];

    const nav = el('div', { class: 'rc-tabs', style: 'margin:0 0 16px' });
    for (const id of visible) {
      nav.appendChild(el('button', {
        class: 'rc-tab',
        type: 'button',
        text: id[0].toUpperCase() + id.slice(1),
        'aria-pressed': String(id === section),
        onClick: () => {
          section = id;
          clear(root);
          render(root);
        },
      }));
    }
    root.appendChild(nav);

    const host = el('div');
    root.appendChild(host);

    if (section === 'settings') await renderSettings(host);
    else if (section === 'people') await renderPeople(host);
    else if (section === 'locations') await renderLocations(host);
    else if (section === 'parties') await renderParties(host);
    else await renderLeave(host);
  }

  /* ── People ────────────────────────────────────────────────────────────── */

  async function renderPeople(host) {
    const [people, aliases] = await Promise.all([
      rc.listPeople({ includeInactive: true }),
      rc.listPersonAliases().catch(() => []),
    ]);
    const admin = rc.isAdmin();
    const spellings = new Map();
    for (const a of aliases) {
      if (!spellings.has(a.person_id)) spellings.set(a.person_id, []);
      spellings.get(a.person_id).push(a.alias);
    }

    host.appendChild(sectionHead('Team', admin ? {
      label: 'Add person',
      onClick: () => editPerson(null),
    } : null));

    if (!people.length) {
      host.appendChild(el('p', { class: 'rc-hint', text: 'Nobody on the team yet.' }));
      return;
    }

    const rows = people.map((p) => el('tr', { class: p.active ? '' : 'rc-inactive' }, [
      el('td', {}, [
        el('div', { text: p.name }),
        p.email ? el('div', { class: 'rc-hint', text: p.email }) : null,
      ].filter(Boolean)),
      el('td', { text: p.title || '—' }),
      el('td', { text: p.subsystem || '—' }),
      el('td', {}, [el('div', { class: 'rc-hint', text: (spellings.get(p.id) || []).join(', ') || 'no other spellings' })]),
      el('td', {}, [p.scheduled === false ? badge('Not scheduled', 'neutral') : badge('Scheduled', 'good')]),
      // A four-day contract is a fact the scheduler needs, and showing it here is
      // what stops somebody being planned onto a Friday they never work.
      el('td', { class: 'rc-num', text: (p.working_days || []).length + '/wk' }),
      el('td', {}, admin ? [
        el('button', {
          class: 'cx-btn mini ghost', text: 'Edit', onClick: () => editPerson(p),
        }),
        el('button', {
          class: 'cx-btn mini ghost',
          text: 'Add spelling',
          title: 'Another way their name is written on the look-ahead — "R. Okafor" for Rosa Okafor.',
          onClick: safely(async () => {
            const alias = await promptDialog({
              title: `Another spelling for ${p.name}`,
              label: 'As it appears on the look-ahead',
              confirmLabel: 'Add',
            });
            if (!alias || !alias.trim()) return;
            try {
              await rc.addPersonAlias(p.id, alias.trim());
              notifyChanged('people');
            } catch (err) {
              toast({ tone: 'bad', message: err?.message || String(err) });
            }
          }),
        }),
        el('button', {
          class: 'cx-btn mini ghost',
          text: p.active ? 'Retire' : 'Restore',
          title: p.active
            ? 'Removes them from every picker. Their history stays — the reports still need it.'
            : 'Puts them back in the pickers.',
          onClick: safely(async () => {
            await rc.updatePerson(p.id, { active: !p.active });
            notifyChanged('people');
          }),
        }),
        deleteButton({
          label: `Delete ${p.name}?`,
          message: 'Their aliases, any leave booked for them and their TAWR details go too. '
            + 'Retiring them instead keeps all of it and takes them out of the pickers just the same.',
          run: () => rc.deletePerson(p.id),
          after: 'people',
        }),
      ] : []),
    ]));

    host.appendChild(table(['Name', 'Title', 'Subsystem', 'Also written as', 'Takes shifts', 'Days', ''], rows));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Retiring somebody takes them out of every picker and keeps everything that names them, '
        + 'which is why it is the first answer for anybody who has been here. Delete is for a row that '
        + 'was never meant — the same person added twice — and takes their aliases, leave and TAWR '
        + 'details with them. Who you are in the calendar is the name set in the application, matched '
        + 'to this list.',
    }));
  }

  function editPerson(person) {
    const name = textInput({ value: person?.name || '', placeholder: 'Full name' });
    const email = textInput({ value: person?.email || '', placeholder: 'you@example.com', type: 'email' });
    const title = textInput({ value: person?.title || '', placeholder: 'Test Engineer' });
    const subsystem = textInput({ value: person?.subsystem || '', placeholder: 'ATS / IXL / SCADA' });
    /* Whether they are scheduled, kept apart from what they may do. A manager
       administers the calendar and is never assigned to a location; an
       administrator who does take shifts must not drop out of the meeting
       because of their permissions. */
    const scheduled = checkbox({
      label: 'Takes shifts — appears in the PTO calendar and the staffing checks',
      checked: person ? person.scheduled !== false : true,
    });

    // Which days they work at all. Scheduling somebody onto a day they do not
    // work is the same class of mistake as scheduling them while on leave, and
    // both are caught from this one field.
    const days = [1, 2, 3, 4, 5, 6, 7].map((n) => {
      const set = new Set(person?.working_days || [1, 2, 3, 4, 5]);
      const box = el('input', { type: 'checkbox', checked: set.has(n) });
      box.dataset.day = String(n);
      return el('label', { class: 'cx-check', style: 'margin-right:10px' }, [
        box, el('span', { text: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][n - 1] }),
      ]);
    });
    const daysWrap = el('div', {}, days);

    formModal({
      title: person ? 'Edit person' : 'Add person',
      body: el('div', { class: 'cx-form' }, [
        field('Name', name),
        field('Email', email, 'For reference only — nobody signs in to the calendar.'),
        field('Title', title),
        field('Subsystem', subsystem),
        field('Scheduling', scheduled, 'Turn this off for somebody who manages rather than '
          + 'taking shifts.'),
        field('Working days', daysWrap),
      ]),
      confirmLabel: person ? 'Save' : 'Add',
      onConfirm: async () => {
        const working = [...daysWrap.querySelectorAll('input:checked')].map((b) => Number(b.dataset.day));
        const patch = {
          name: name.value.trim(),
          email: email.value.trim() || null,
          title: title.value.trim() || null,
          subsystem: subsystem.value.trim() || null,
          scheduled: scheduled.querySelector('input').checked,
          working_days: working,
        };
        if (!patch.name) throw new Error('A name is needed.');
        if (person) {
          await rc.updatePerson(person.id, patch);
        } else {
          await rc.addPerson(patch);
        }
        notifyChanged('people');
        toast({ message: person ? `${patch.name} updated.` : `${patch.name} added.` });
      },
    });
  }

  /* ── Locations ─────────────────────────────────────────────────────────── */

  async function renderLocations(host) {
    const [locations, aliases] = await Promise.all([
      rc.listLocations({ includeInactive: true }),
      rc.listLocationAliases(),
    ]);
    const admin = rc.isAdmin();
    const byLocation = new Map();
    for (const a of aliases) {
      if (!byLocation.has(a.location_id)) byLocation.set(a.location_id, []);
      byLocation.get(a.location_id).push(a.alias);
    }

    host.appendChild(sectionHead('Locations', admin ? {
      label: 'Add location',
      onClick: safely(async () => {
        const name = await promptDialog({ title: 'Add location', label: 'Name', confirmLabel: 'Add' });
        if (!name) return;
        await rc.addLocation({ name: name.trim() });
        notifyChanged('locations');
      }),
    } : null));

    const rows = locations.map((l) => el('tr', { class: l.active ? '' : 'rc-inactive' }, [
      el('td', { text: l.name }),
      el('td', { text: l.code || '—' }),
      el('td', {}, [
        el('div', { class: 'rc-hint', text: (byLocation.get(l.id) || []).join(', ') || 'no other spellings' }),
      ]),
      el('td', {}, [
        el('div', { class: 'rc-hint', text: l.tawr_area || 'its name' }),
      ]),
      el('td', {}, admin ? [
        el('button', {
          class: 'cx-btn mini ghost',
          text: 'Rename',
          title: 'Every alias, TAWR and look-ahead row stays pointed at it — only the name changes.',
          onClick: safely(async () => {
            const name = await promptDialog({
              title: `Rename ${l.name}`,
              label: 'Name',
              value: l.name,
              confirmLabel: 'Rename',
            });
            if (!name || name.trim() === l.name) return;
            await rc.updateLocation(l.id, { name: name.trim() });
            notifyChanged('locations');
          }),
        }),
        el('button', {
          class: 'cx-btn mini ghost',
          text: l.active ? 'Retire' : 'Restore',
          title: l.active
            ? 'Drops it from every picker. Everything already recorded against it stays.'
            : 'Puts it back in the pickers.',
          onClick: safely(async () => {
            await rc.updateLocation(l.id, { active: !l.active });
            notifyChanged('locations');
          }),
        }),
        deleteButton({
          label: `Delete ${l.name}?`,
          message: 'Its other spellings go with it. If a look-ahead reading, a change or an approved '
            + 'TAWR names this place the delete is refused — retire it instead, which drops it from the '
            + 'pickers and keeps everything already recorded there.',
          run: () => rc.deleteLocation(l.id),
          after: 'locations',
        }),
        el('button', {
          class: 'cx-btn mini ghost',
          text: 'TAWR area',
          title: 'What a track access work request\'s Area column says for this place. Blank uses its name.',
          dataset: { action: 'tawr-area' },
          onClick: safely(async () => {
            const area = await promptDialog({
              title: `Area for ${l.name} on a TAWR`,
              label: 'Tracks, mileposts, gates or stations, as the form should say it',
              value: l.tawr_area || '',
              confirmLabel: 'Save',
            });
            if (area == null || area.trim() === (l.tawr_area || '')) return;
            try {
              await rc.updateLocation(l.id, { tawr_area: area.trim() || null });
              notifyChanged('locations');
            } catch (err) {
              toast({ tone: 'bad', message: err?.message || String(err) });
            }
          }),
        }),
        el('button', {
          class: 'cx-btn mini ghost',
          text: 'Add spelling',
          title: 'Another way this place is written in the look-ahead.',
          onClick: safely(async () => {
            const alias = await promptDialog({
              title: `Another spelling for ${l.name}`,
              label: 'As it appears in the look-ahead',
              confirmLabel: 'Add',
            });
            if (!alias) return;
            await rc.addLocationAlias(l.id, alias.trim());
            notifyChanged('locations');
          }),
        }),
      ] : []),
    ]));

    host.appendChild(table(['Location', 'Code', 'Also written as', 'TAWR area', ''], rows));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Every match against the look-ahead keys on location, never on activity text — the '
        + 'descriptions are not reliable enough to carry evidence. So a place written "TPSS 12" one '
        + 'week and "Traction Power 12" the next needs both spellings here. Case and punctuation are '
        + 'folded automatically; wording is not.',
    }));
  }

  /* ── Parties ───────────────────────────────────────────────────────────── */

  async function renderParties(host) {
    const parties = await rc.listParties();
    const admin = rc.isAdmin();

    host.appendChild(sectionHead('Responsible parties', admin ? {
      label: 'Add party',
      onClick: safely(async () => {
        const name = await promptDialog({ title: 'Add party', label: 'Name', confirmLabel: 'Add' });
        if (!name) return;
        await rc.addParty(name.trim());
        notifyChanged('parties');
      }),
    } : null));

    host.appendChild(table(['Party'], parties.map((p) => el('tr', {}, [el('td', { text: p.name })]))));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Who a change on the look-ahead is down to. A table rather than free text, because '
        + '"down to BART" is a number somebody may eventually have to defend.',
    }));
  }

  /* ── Leave ─────────────────────────────────────────────────────────────── */

  async function renderLeave(host) {
    const today = todayISO();
    const [people, kinds, leave] = await Promise.all([
      rc.listPeople(),
      rc.listLeaveKinds(),
      // A year either side: enough to see the balance and what is booked ahead.
      rc.listLeave(`${today.slice(0, 4)}-01-01`, `${Number(today.slice(0, 4)) + 1}-12-31`),
    ]);
    const admin = rc.isAdmin();
    const peopleById = byId(people);
    const kindsById = byId(kinds);

    host.appendChild(sectionHead('Leave', admin ? {
      label: 'Book leave',
      onClick: () => bookLeave(people, kinds),
    } : null));

    if (!leave.length) {
      host.appendChild(el('p', { class: 'rc-hint', text: 'Nothing booked.' }));
    } else {
      const sorted = [...leave].sort((a, b) => a.start_date.localeCompare(b.start_date));
      host.appendChild(table(
        ['Person', 'From', 'To', 'Kind', 'Status', ''],
        sorted.map((l) => el('tr', {}, [
          el('td', { text: peopleById.get(l.person_id)?.name || '—' }),
          el('td', { text: dayLabel(l.start_date) }),
          el('td', { text: dayLabel(l.end_date) }),
          el('td', { text: kindsById.get(l.kind_id)?.name || '—' }),
          el('td', {}, [badge(l.status, l.status === 'approved' ? 'good' : 'muted')]),
          el('td', {}, admin && l.status !== 'cancelled' ? [
            el('button', {
              class: 'cx-btn mini ghost',
              text: 'Cancel',
              onClick: safely(async () => {
                const ok = await confirmDialog({
                  title: 'Cancel this leave?',
                  message: 'It stays on the record as cancelled rather than disappearing.',
                  confirmLabel: 'Cancel leave',
                });
                if (!ok) return;
                await rc.updateLeave(l.id, { status: 'cancelled' });
                notifyChanged('leave');
              }),
            }),
          ] : []),
        ]))
      ));
    }

    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Leave booked here is the same leave the PTO calendar books, and the editor\'s staffing '
        + 'check reads it: somebody named on a day they are off is flagged before the week arrives.',
    }));
  }

  function bookLeave(people, kinds) {
    const person = selectInput({
      value: people[0]?.id,
      options: people.map((p) => ({ value: p.id, label: p.name })),
    });
    const from = el('input', { type: 'date', class: 'cx-input' });
    const to = el('input', { type: 'date', class: 'cx-input' });
    const kind = selectInput({
      value: kinds[0]?.id,
      options: kinds.map((k) => ({ value: k.id, label: k.name })),
    });
    const note = textInput({ placeholder: 'Optional' });

    formModal({
      title: 'Book leave',
      body: el('div', { class: 'cx-form' }, [
        field('Person', person),
        field('From', from),
        field('To', to, 'Inclusive, as a calendar is.'),
        field('Kind', kind),
        field('Note', note),
      ]),
      confirmLabel: 'Book',
      onConfirm: async () => {
        if (!from.value || !to.value) throw new Error('Both dates are needed.');
        if (to.value < from.value) throw new Error('The end is before the start.');
        await rc.addLeave({
          person_id: person.value,
          start_date: from.value,
          end_date: to.value,
          kind_id: kind.value,
          note: note.value.trim() || null,
        });
        notifyChanged('leave');
        toast({ message: 'Leave booked.' });
      },
    });
  }

  /* ── Shared bits ───────────────────────────────────────────────────────── */

  /**
   * A button's work, with its failure said. Every write here can be refused —
   * somebody else holding the pen, a file another computer saved — and a refusal
   * nobody is told about reads as a button that does nothing.
   */
  function safely(fn) {
    return async (...args) => {
      try {
        await fn(...args);
      } catch (err) {
        toast({ tone: 'bad', message: err?.message || String(err), timeout: 8000 });
      }
    };
  }

  function sectionHead(title, action) {
    return el('div', { class: 'rc-section-head' }, [
      el('h3', { text: title }),
      action
        ? el('button', {
          class: 'cx-btn mini primary',
          html: icon('plus', { size: 12 }) + `<span>${action.label}</span>`,
          onClick: action.onClick,
        })
        : null,
    ].filter(Boolean));
  }

  function table(headers, rows) {
    return el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table' }, [
        el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { text: h })))]),
        el('tbody', {}, rows),
      ]),
    ]);
  }

  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
};

// io/rc_pdf.js
__mods["io/rc_pdf.js"] = function (__x, __req) {
  /**
   * The look-ahead calendar, drawn for print.
   *
   * A screenshot of the grid is what people were doing instead, and it is a poor
   * document: the frozen columns come out twice, the scroll clips the weeks
   * nobody happened to be looking at, and the colours are whatever the monitor
   * did to them. This draws the same calendar as vector geometry, at whatever
   * scale puts it on **one sheet**, because a four-week look-ahead reassembled
   * from four pages on a meeting-room table is not a four-week look-ahead.
   *
   * Two rules shape the whole module.
   *
   * **It draws the window it is given, not the one on screen.** Every choice the
   * dialog offers — how many weeks, whether the resource names come, whether the
   * rows with nothing scheduled come — is an argument here. The screen's own
   * switches are only the *defaults* the dialog opens with, so exporting cannot
   * quietly depend on what somebody last clicked.
   *
   * **Nothing is truncated to make it fit.** A description too long for its
   * column wraps and the row grows, the same answer the timeline gives. What
   * gives instead is the scale, and `fitScale()` says what that came to before
   * anything is written — a print at 40% is a decision somebody should make
   * knowingly, by choosing a bigger sheet or fewer weeks, not a surprise in a
   * downloads folder.
   *
   * No DOM and no network: it takes a parsed view and returns bytes, which is
   * what lets `tools/test_lookahead.js` check the geometry without a browser.
   *
   * Imports: io/pdf, io/lookahead, core/lookahead.
   */

  const { fitToPdf, fitScale, pageBox, textWidth, PAGE_SIZES } = __req("io/pdf.js");
  const { isDark } = __req("io/lookahead.js");
  const { ABSENCE_LABELS } = __req("core/lookahead.js");

  /* ── Metrics, in points at scale 1 ─────────────────────────────────────── */

  const META_FONT = 7.2;
  const DAY_FONT = 6.2;
  const HEAD_FONT = 6.4;
  const LINE_H = 8.6;
  const ROW_PAD = 3.4;
  const MIN_ROW_H = 12;
  const MONTH_H = 11;
  const NUM_H = 10;
  const WEEKDAY_H = 11;
  const LEGEND_H = 13;

  /** The whole activity block, however many columns the sheet keeps it in. */
  const META_W = 208;
  const MIN_COL_W = 24;

  const INK = {
    text: '#1a1a1a',
    subtle: '#6b6b6b',
    rule: '#d8d8d8',
    weekRule: '#9a9a9a',
    band: '#eeeeee',
    heading: '#e4e4e4',
    weekend: '#f5f5f5',
    today: '#e60012',
    onDark: '#ffffff',
  };

  /** Greedy word wrap. Returns the lines a string needs at this width. */
  function wrap(text, width, size) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size) <= width || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
      /* A single word wider than the column — a part number, a path — is broken
         on characters rather than left to run over its neighbour. Nothing is
         dropped; the row grows instead. */
      while (textWidth(line, size) > width && line.length > 1) {
        let cut = line.length;
        while (cut > 1 && textWidth(line.slice(0, cut), size) > width) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /**
   * How wide each activity column gets.
   *
   * Proportional to what is actually in it, so the description — the column
   * anybody reads — is not given the same strip as a four-character CDRL code.
   * A floor per column, because a column squeezed to nothing still costs a
   * vertical rule and looks like a mistake.
   */
  function metaWidths(rows, meta) {
    if (!meta.length) return [];
    const longest = meta.map((_, i) =>
      Math.max(12, ...rows.map((r) => textWidth(String(r.meta[i] || ''), META_FONT))));
    const total = longest.reduce((a, b) => a + b, 0) || 1;
    const spare = Math.max(0, META_W - MIN_COL_W * meta.length);
    return longest.map((w) => MIN_COL_W + (w / total) * spare);
  }

  /**
   * Which rows the export draws, and in what shape.
   *
   * Deliberately a separate pass from `readGrid()`: the same activity is one row
   * on screen and one or two here depending on whether the names were asked for,
   * and working that out while drawing is how the two get out of step.
   */
  function linesOf(view, { showResources, showAway }) {
    const out = [];
    for (const a of view.activities) {
      if (a.absence && !showAway) continue;
      out.push({
        meta: a.meta,
        marks: a.marks,
        heading: Boolean(a.heading),
        muted: Boolean(a.absence),
        label: a.absence ? ABSENCE_LABELS[a.absence] : null,
      });
      if (a.resource && showResources) {
        out.push({ meta: a.resource.meta, marks: a.resource.marks, heading: false, muted: true });
      }
    }
    return out;
  }

  /**
   * The calendar as scene items: `{ width, height, items, meta }`.
   *
   * The same shape `io/scene.js` produces for the timeline, so it goes through
   * the same writer and gets the same true-vector output — selectable text and
   * no raster anywhere.
   */
  function calendarScene(view, {
    showResources = true,
    showAway = true,
    legend = [],
    showLegend = true,
    today = null,
    rowPad = 0,
    dayPad = 0,
  } = {}) {
    const items = [];
    const days = view.days || [];
    const rows = linesOf(view, { showResources, showAway });
    const meta = view.meta || [];
    const headings = view.headings || [];
    const widths = metaWidths(rows, meta);
    const metaW = widths.reduce((a, b) => a + b, 0);

    /* A day column is as wide as the widest *word* anybody writes in one, not the
       widest cell. The marks are "X", "X.WIT", "X.TCE"; the Resource row's cells
       are "Priya, Dan", which is three times as wide and would either set the
       whole grid's column width or run over its neighbours. Sizing on the word
       and wrapping the rest is what lets a name sit in a day column at all. */
    const widestWord = Math.max(0, ...rows.flatMap((r) =>
      String(r.marks.map((m) => m.value || '').join(' '))
        .split(/[\s,;/&+]+/).filter(Boolean)
        .map((w) => textWidth(w, DAY_FONT))));
    const dayW = Math.max(12, Math.min(30, widestWord + 5)) + dayPad;

    const headH = MONTH_H + NUM_H + WEEKDAY_H;
    const width = metaW + days.length * dayW;

    const colX = new Map();
    days.forEach((d, i) => colX.set(d.col, metaW + i * dayW));

    /* ── Header ─────────────────────────────────────────────────────────── */

    // The month band, one label per run of days, which is what the merged cell in
    // the workbook meant.
    let runStart = 0;
    for (let i = 0; i <= days.length; i++) {
      if (i < days.length && days[i].month === days[runStart].month) continue;
      const x = metaW + runStart * dayW;
      const w = (i - runStart) * dayW;
      items.push({ type: 'rect', x, y: 0, w, h: MONTH_H, fill: INK.band });
      const label = days[runStart].month || '';
      if (label && textWidth(label, HEAD_FONT) < w - 4) {
        items.push({
          type: 'text', x: x + w / 2, y: MONTH_H - 3, text: label,
          size: HEAD_FONT, fill: INK.subtle, anchor: 'middle', weight: 700,
        });
      }
      runStart = i;
    }

    /* What the workbook calls its own columns. `readGrid()` already reads these
       to find the Location column, so printing "Activity" over all of them would
       be throwing away a heading the sheet supplies. */
    widths.forEach((w, i) => {
      const x = widths.slice(0, i).reduce((a, b) => a + b, 0);
      const label = String(headings[i] || (i === 0 ? 'Activity' : ''));
      if (!label) return;
      const lines = wrap(label, w - 4, HEAD_FONT - 0.4);
      lines.slice(0, 2).forEach((line, n) => {
        items.push({
          type: 'text', x: x + 2, y: MONTH_H + NUM_H - 2 + n * (HEAD_FONT + 0.8),
          text: line, size: HEAD_FONT - 0.4, fill: INK.subtle, weight: 700,
        });
      });
    });

    for (const d of days) {
      const x = colX.get(d.col);
      if (d.weekend) {
        items.push({ type: 'rect', x, y: MONTH_H, w: dayW, h: headH - MONTH_H, fill: INK.weekend });
      }
      const isToday = Boolean(d.date) && d.date === today;
      items.push({
        type: 'text', x: x + dayW / 2, y: MONTH_H + NUM_H - 2.5, text: String(d.day || ''),
        size: HEAD_FONT, fill: isToday ? INK.today : INK.text, anchor: 'middle', weight: 700,
      });
      items.push({
        type: 'text', x: x + dayW / 2, y: headH - 3, text: String(d.weekday || ''),
        size: HEAD_FONT - 0.6, fill: isToday ? INK.today : INK.subtle, anchor: 'middle',
      });
    }

    /* ── Rows ───────────────────────────────────────────────────────────── */

    const dayLineH = DAY_FONT + 1.6;
    const laid = rows.map((row) => {
      const cells = widths.map((w, i) => wrap(row.meta[i], w - 4, META_FONT));
      const inDay = new Map();
      for (const m of row.marks) {
        if (!m.value) continue;
        inDay.set(m.col, wrap(String(m.value), dayW - 2.5, DAY_FONT));
      }
      /* The row is as tall as its tallest cell, wherever that cell is. Measuring
         only the description is what let a Resource row's names run across three
         days of somebody else's work. */
      const metaLines = Math.max(1, ...cells.map((c) => c.length));
      const dayLines = Math.max(1, ...[...inDay.values()].map((l) => l.length), 1);
      return {
        ...row,
        cells,
        inDay,
        h: Math.max(MIN_ROW_H, metaLines * LINE_H + ROW_PAD, dayLines * dayLineH + ROW_PAD) + rowPad,
      };
    });

    let y = headH;
    const bodyTop = y;

    for (const row of laid) {
      // Weekend tint first, so a painted cell sits on top of it rather than
      // under it.
      for (const d of days) {
        if (d.weekend) {
          items.push({ type: 'rect', x: colX.get(d.col), y, w: dayW, h: row.h, fill: INK.weekend });
        }
      }
      if (row.heading) {
        items.push({ type: 'rect', x: 0, y, w: width, h: row.h, fill: INK.heading });
      }

      row.cells.forEach((lines, i) => {
        const x = widths.slice(0, i).reduce((a, b) => a + b, 0);
        lines.forEach((line, n) => {
          items.push({
            type: 'text', x: x + 2, y: y + ROW_PAD + (n + 1) * LINE_H - 2.4, text: line,
            size: META_FONT, fill: row.muted ? INK.subtle : INK.text,
            weight: row.heading ? 700 : 400,
          });
        });
      });

      for (const mark of row.marks) {
        const x = colX.get(mark.col);
        if (x == null) continue;                       // a day outside the window
        if (!mark.hex && !mark.value) continue;        // an empty cell draws nothing
        if (mark.hex) {
          items.push({ type: 'rect', x, y, w: dayW, h: row.h, fill: `#${mark.hex}` });
        }
        const lines = row.inDay.get(mark.col);
        if (lines?.length) {
          const fill = mark.hex && isDark(mark.hex) ? INK.onDark : INK.text;
          const block = lines.length * dayLineH;
          lines.forEach((line, n) => {
            items.push({
              type: 'text', x: x + dayW / 2,
              y: y + (row.h - block) / 2 + (n + 1) * dayLineH - 1.8,
              text: line, size: DAY_FONT, fill, anchor: 'middle',
            });
          });
        }
      }

      y += row.h;
      items.push({ type: 'line', x1: 0, y1: y, x2: width, y2: y, stroke: INK.rule, strokeWidth: 0.3 });
    }

    const bodyBottom = y;

    /* ── Rules ──────────────────────────────────────────────────────────── */

    // A hairline per day makes it a calendar rather than a block of colour; the
    // Monday rules are what let somebody count weeks across a hundred columns.
    for (const d of days) {
      const x = colX.get(d.col);
      const monday = String(d.weekday || '').toUpperCase() === 'M';
      items.push({
        type: 'line', x1: x, y1: MONTH_H, x2: x, y2: bodyBottom,
        stroke: monday ? INK.weekRule : INK.rule, strokeWidth: monday ? 0.5 : 0.25,
      });
    }
    items.push({
      type: 'line', x1: metaW, y1: 0, x2: metaW, y2: bodyBottom,
      stroke: INK.weekRule, strokeWidth: 0.7,
    });
    items.push({
      type: 'line', x1: 0, y1: bodyTop, x2: width, y2: bodyTop,
      stroke: INK.weekRule, strokeWidth: 0.7,
    });
    items.push({
      type: 'line', x1: width, y1: 0, x2: width, y2: bodyBottom,
      stroke: INK.rule, strokeWidth: 0.25,
    });

    // Today, where the window carries it. Drawn last so nothing paints over it.
    const todayCol = days.find((d) => d.date && d.date === today);
    if (todayCol) {
      const x = colX.get(todayCol.col) + dayW / 2;
      /* Through the body only. Run up into the header it strikes out the very
         date it is marking, so the column head says "today" by going red and the
         rule says where it falls. */
      items.push({
        type: 'line', x1: x, y1: bodyTop, x2: x, y2: bodyBottom,
        stroke: INK.today, strokeWidth: 0.9,
      });
    }

    /* ── The key ────────────────────────────────────────────────────────── */

    let height = bodyBottom;
    if (showLegend && legend.length) {
      const top = bodyBottom + 7;
      let x = 0;
      let line = 0;
      for (const entry of legend) {
        const label = String(entry.meaning || '');
        const w = 11 + textWidth(label, HEAD_FONT) + 12;
        if (x + w > width && x > 0) { x = 0; line++; }
        const ly = top + line * LEGEND_H;
        items.push({
          type: 'rect', x, y: ly, w: 7, h: 7, fill: `#${entry.argb}`,
          stroke: INK.rule, strokeWidth: 0.3,
        });
        items.push({
          type: 'text', x: x + 10, y: ly + 6, text: label,
          size: HEAD_FONT, fill: INK.text,
        });
        x += w;
      }
      height = top + (line + 1) * LEGEND_H;
    }

    return {
      width,
      height,
      items,
      meta: { palette: { bg: '#ffffff', text: INK.text, textSubtle: INK.subtle, brand: INK.today } },
      // What the caller needs to describe what it just made, without counting the
      // items itself.
      // `bodyH` is what the rows came to naturally, which is what lets the
      // filling pass cap its padding at "twice as tall" rather than at a
      // number that means nothing on a sheet of two-line descriptions.
      counts: { rows: rows.length, days: days.length, bodyH: bodyBottom - bodyTop },
    };
  }

  /**
   * The calendar laid out to *fill* the page it is going on.
   *
   * Fitting alone is not enough. A four-week window is much wider than it is
   * tall, so the scale is set by the width and the drawing stops less than half
   * way down the sheet — a page that is two-thirds white, which reads as
   * something that went wrong rather than as a document. What is left over is
   * spent on the axis that is not binding: taller rows when the width binds,
   * wider day columns when the height does.
   *
   * Two passes, because the answer depends on the layout and the layout depends
   * on the answer. The first measures; the second is built knowing what there is
   * to fill. It cannot overshoot: the padding is worked out from the scale the
   * first pass already proved fits, and the type never changes size — the rows
   * simply get more air, which is the difference between a cramped print and a
   * comfortable one.
   */
  function calendarLayout(view, opts = {}) {
    const first = calendarScene(view, opts);
    const scale = fitScale(first, opts);
    const box = pageBox(opts);
    const margin = opts.margin ?? 26;
    const contentW = box.w - margin * 2;
    const contentH = box.h - margin * 2 - ((opts.title || opts.subtitle) ? 34 : 12) - 18;

    const rows = Math.max(1, first.counts.rows);
    const days = Math.max(1, first.counts.days);

    /* How much scene there is room for at this scale, against how much there is.
       A row is given at most twice its natural height: past that the grid stops
       being a calendar and becomes a list with coloured gaps in it. */
    const spareH = Math.max(0, contentH / scale - first.height);
    const spareW = Math.max(0, contentW / scale - first.width);
    const rowPad = Math.min(spareH / rows, (first.counts.bodyH || MIN_ROW_H * rows) / rows);
    const dayPad = Math.min(spareW / days, 14);

    if (rowPad < 0.4 && dayPad < 0.4) return { scene: first, scale };

    const scene = calendarScene(view, { ...opts, rowPad, dayPad });
    // Re-measured rather than assumed: wrapping can change with a wider column.
    return { scene, scale: fitScale(scene, opts) };
  }

  /**
   * The calendar as a PDF, on one page. Returns a Blob.
   *
   * The caller hands it to `saveFile()`, which is what announces it — a download
   * is the one action with no visible result, and a second quiet path is exactly
   * the bug that rule exists to prevent.
   */
  function calendarPdf(view, opts = {}) {
    const { scene } = calendarLayout(view, opts);
    return fitToPdf(scene, {
      pageSize: opts.pageSize || 'a3',
      orientation: opts.orientation || 'landscape',
      margin: opts.margin,
      title: opts.title || 'Four-week look-ahead',
      subtitle: opts.subtitle || '',
      author: opts.author || 'CX Timeline',
      footer: opts.footer,
    });
  }

  /**
   * What the export would come out at, before anything is written.
   *
   * `{ scale, pt, width, height, rows, days }` — `pt` being the size the marks in
   * the cells actually print at, which is the number the dialog puts on screen.
   * "It fits on one page" is true of anything if you shrink it far enough; what
   * somebody needs to know is whether they will be able to read it.
   */
  function calendarFit(view, opts = {}) {
    const { scene, scale } = calendarLayout(view, opts);
    return {
      scale,
      pt: DAY_FONT * scale,
      width: scene.width,
      height: scene.height,
      rows: scene.counts.rows,
      days: scene.counts.days,
      page: pageBox(opts).label,
    };
  }

  /** The page sizes the dialog offers, landscape or portrait. */
  const PAGE_CHOICES = Object.entries(PAGE_SIZES)
    .map(([id, size]) => ({ id, label: size.label.replace(' landscape', '') }));

  Object.defineProperty(__x, "calendarScene", { get: () => calendarScene, enumerable: true });
  Object.defineProperty(__x, "calendarLayout", { get: () => calendarLayout, enumerable: true });
  Object.defineProperty(__x, "calendarPdf", { get: () => calendarPdf, enumerable: true });
  Object.defineProperty(__x, "calendarFit", { get: () => calendarFit, enumerable: true });
  Object.defineProperty(__x, "PAGE_CHOICES", { get: () => PAGE_CHOICES, enumerable: true });
};

// core/la_edit.js
__mods["core/la_edit.js"] = function (__x, __req) {
  /**
   * The look-ahead, edited in the application rather than in Excel.
   *
   * The workbook used to be the source of truth and the calendar read it. Now the
   * calendar *is* the source: two administrators edit rows and cells here, and
   * an Excel file is something the calendar produces for whoever copies the rows
   * into the project's master look-ahead. This module is the whole of that model
   * with nothing attached — no DOM, no network — so every rule in it is tested in
   * Node (`tools/test_lookahead.js`).
   *
   * The model is two lists, mirroring the two tables in `rc_schema.sql`:
   *
   *   rows   { id, kind, parent_id, sort, level, activity_id, description,
   *            location, sswp, party, work_hours, absence_kind, archived, version }
   *   cells  { row_id, day, color, text, version }       (keyed `row_id|day`)
   *
   * `kind` is one of four things a row on the 4WLA has always been:
   *
   *   section   a heading band ("W40 — Testing and Commissioning")
   *   activity  a line of work, painted by day, with the support it needs typed
   *             in the cell ("X.WIT")
   *   resource  the names under an activity — `parent_id` is that activity, and
   *             it moves with it
   *   absence   a PTO / Office / Other group row of names, belonging to nobody
   *
   * **The editor publishes the same shape the workbook used to produce.**
   * `gridFromModel()` writes a grid exactly as `parseSheet()` would have read it
   * from an .xlsx — heading row, month band, day numbers, weekday letters, then
   * the rows — so the calendar, the week plan, the huddle, PTO, the cancellation
   * log and the change register all keep reading what they always read. Nothing
   * downstream had to learn that the workbook went away.
   *
   * Every edit is an *op*, and every op has an inverse (`applyOps()` returns it),
   * which is the whole of undo. The same ops go to the database through
   * `rc_la_apply()`, stamped with the versions they expect (`stamp()`), so two
   * people changing one cell at once get a refusal rather than a silent winner.
   *
   * Imports: core/lookahead (a leaf).
   */

  const { absenceKind, ABSENCE_LABELS, resourceNames, cellTokens } = __req("core/lookahead.js");

  /* ══════════════════════════════════════════════════════════════════════════
     Days
     ═══════════════════════════════════════════════════════════════════════ */

  const MS_DAY = 86400000;
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const WEEKDAY_LETTERS = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa'];

  /** The editor shows four weeks by default and five at most. */
  const WINDOW_WEEKS = [4, 5];

  const isoMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
  const msIso = (ms) => new Date(ms).toISOString().slice(0, 10);

  function addDaysISO(iso, n) {
    return msIso(isoMs(iso) + n * MS_DAY);
  }

  /** The Monday on or before a date. */
  function mondayOf(iso) {
    const dow = new Date(isoMs(iso)).getUTCDay();
    return addDaysISO(iso, -((dow + 6) % 7));
  }

  /** Seven days a week for `weeks` weeks, from the Monday of `fromISO`. */
  function windowDays(fromISO, weeks = 4) {
    const start = mondayOf(fromISO);
    return Array.from({ length: weeks * 7 }, (_, i) => addDaysISO(start, i));
  }

  function isWeekend(iso) {
    const dow = new Date(isoMs(iso)).getUTCDay();
    return dow === 0 || dow === 6;
  }

  function weekdayLetter(iso) {
    return WEEKDAY_LETTERS[new Date(isoMs(iso)).getUTCDay()];
  }

  function monthLabel(iso) {
    return MONTHS[new Date(isoMs(iso)).getUTCMonth()];
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Rows
     ═══════════════════════════════════════════════════════════════════════ */

  const KINDS = ['section', 'activity', 'resource', 'absence'];

  /** The six columns left of the calendar, in the order the 4WLA prints them. */
  const FIELDS = [
    { key: 'activity_id', heading: 'Activity ID', width: 20.5703125 },
    { key: 'description', heading: 'Description of Work Activity', width: 57.140625 },
    { key: 'location', heading: 'Location', width: 28.5703125 },
    { key: 'sswp', heading: 'SSWP#', width: 8.140625 },
    { key: 'party', heading: 'Party to Action', width: 8.140625 },
    { key: 'work_hours', heading: 'Work Hours', width: 15.5703125 },
  ];

  function blankRow(kind, extra = {}) {
    return {
      id: extra.id || newId(),
      kind,
      parent_id: null,
      sort: 0,
      level: 0,
      activity_id: '',
      description: kind === 'resource' ? 'Resource' : '',
      location: '',
      sswp: '',
      party: '',
      work_hours: '',
      absence_kind: null,
      archived: false,
      version: 0,
      ...extra,
    };
  }

  /** A uuid made here, so a row exists — and can be undone — before the server has it. */
  function newId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
  }

  /**
   * The rows in the order the sheet shows them.
   *
   * Top-level rows by `sort`, and each activity followed by its Resource rows —
   * so moving an activity carries its names with it without anybody having to
   * move them too, which is the mistake the workbook invited every week.
   */
  function orderedRows(rows, { archived = false } = {}) {
    /* A names row goes with its activity: archiving the activity archives what
       is written under it too, or its names would surface as a loose row on the
       published sheet — still on the calendar after the work was taken off. */
    const gone = new Set(rows.filter((r) => r.archived).map((r) => r.id));
    const live = rows.filter((r) => archived || !(r.archived || (r.kind === 'resource' && gone.has(r.parent_id))));
    const bySort = (a, b) => (a.sort - b.sort) || String(a.id).localeCompare(String(b.id));
    const children = new Map();
    for (const r of live) {
      if (r.kind === 'resource' && r.parent_id) {
        if (!children.has(r.parent_id)) children.set(r.parent_id, []);
        children.get(r.parent_id).push(r);
      }
    }
    const top = live.filter((r) => !(r.kind === 'resource' && r.parent_id && live.some((p) => p.id === r.parent_id)));
    const out = [];
    for (const r of top.sort(bySort)) {
      out.push(r);
      for (const c of (children.get(r.id) || []).sort(bySort)) out.push(c);
    }
    return out;
  }

  /**
   * A section and everything under it, as indexes into `ordered`.
   *
   * Down to the next section at the same level or above. That is what "the rows
   * in this section" has always meant on the sheet, and it is what moving,
   * collapsing and deleting a section act on.
   */
  function sectionBlock(ordered, index) {
    const head = ordered[index];
    if (!head || head.kind !== 'section') return [index, index];
    let end = index;
    for (let i = index + 1; i < ordered.length; i++) {
      const r = ordered[i];
      if (r.kind === 'section' && (r.level || 0) <= (head.level || 0)) break;
      end = i;
    }
    return [index, end];
  }

  /** An activity with its Resource rows; any other row alone. */
  function rowBlock(ordered, index) {
    const row = ordered[index];
    if (!row) return [index, index];
    if (row.kind === 'section') return sectionBlock(ordered, index);
    let end = index;
    if (row.kind === 'activity') {
      while (ordered[end + 1]?.kind === 'resource' && ordered[end + 1].parent_id === row.id) end++;
    }
    return [index, end];
  }

  /**
   * A sort key between two neighbours.
   *
   * Plain numbers, midpoints between them. A thousand inserts at one spot would
   * run out of precision, which is what `respace()` is for — the editor calls it
   * when two neighbours come within a hair of each other.
   */
  function sortBetween(before, after) {
    if (before == null && after == null) return 1024;
    if (before == null) return after - 1024;
    if (after == null) return before + 1024;
    return (before + after) / 2;
  }

  function needsRespace(ordered) {
    const top = ordered.filter((r) => r.kind !== 'resource');
    for (let i = 1; i < top.length; i++) {
      if (Math.abs(top[i].sort - top[i - 1].sort) < 1e-6) return true;
    }
    return false;
  }

  /** Evenly spaced sort keys for every top-level row, as ops. */
  function respace(ordered) {
    let n = 0;
    const ops = [];
    for (const r of ordered) {
      if (r.kind === 'resource') continue;
      n += 1024;
      if (r.sort !== n) ops.push({ op: 'row', id: r.id, set: { sort: n } });
    }
    return ops;
  }

  /**
   * The rows worth printing for a window of days, in sheet order.
   *
   * An activity with a colour, a code or a name on one of those days — its own
   * cells or its Resource row's — with its Resource rows whatever they hold,
   * because the pair is one thing on the sheet; the sections that have such an
   * activity under them, nested sections included; and the PTO / Office / Other
   * group rows always, because they are the frame the track allocation manager
   * copies. This is what "only the current data" means for the export.
   */
  function rowsWithWork(model, days) {
    const ordered = orderedRows(model.rows);
    const inDays = new Set(days);
    const busy = new Set(cellList(model).filter((c) => inDays.has(c.day) && (c.text || c.color)).map((c) => c.row_id));
    const keep = new Array(ordered.length).fill(false);
    let liveBelow = false;
    for (let i = ordered.length - 1; i >= 0; i--) {
      const r = ordered[i];
      if (r.kind === 'resource') continue;
      if (r.kind === 'absence') { keep[i] = true; continue; }
      if (r.kind === 'activity') {
        const kids = ordered.filter((k) => k.kind === 'resource' && k.parent_id === r.id);
        keep[i] = busy.has(r.id) || kids.some((k) => busy.has(k.id));
        if (keep[i]) liveBelow = true;
        continue;
      }
      keep[i] = liveBelow || (ordered[i + 1]?.kind === 'section' && keep[i + 1]);
      liveBelow = false;
    }
    return ordered.filter((r, i) => (r.kind === 'resource'
      ? keep[ordered.findIndex((p) => p.id === r.parent_id)]
      : keep[i]));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Support codes
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The support written in one cell: "X.WIT" is an EIC and a BART witness,
   * "X.X" is two EICs.
   *
   * The workbook's own convention, read as it is typed: pieces between dots,
   * spacing ignored, case ignored. A piece nobody has registered is still
   * returned — marked, never dropped and never guessed at, because an unknown
   * code is a request nobody can staff until somebody says what it is.
   */
  function supportTokens(text) {
    // A struck-out code ("~WIT") is no longer asked for: never counted, never
    // staffed, never an unknown code to chase.
    return cellTokens(text).filter((t) => !t.cancelled).map((t) => t.code);
  }

  /** The codes struck out of a cell — "X.~WIT" → ["WIT"]. */
  function cancelledTokens(text) {
    return cellTokens(text).filter((t) => t.cancelled).map((t) => t.code);
  }

  /** Tokens back into the sheet's form: `[{code:'X'},{code:'WIT',cancelled:true}]` → "X.~WIT". */
  function writeTokens(tokens) {
    return tokens.map((t) => `${t.cancelled ? '~' : ''}${t.code}`).join('.');
  }

  /**
   * Strike codes out of a cell rather than remove them: each code in `codes`
   * turns one of its live occurrences into "~CODE", and a code no longer live in
   * the text is added struck out — the removal already happened, and this is
   * the record that it was a cancellation. "X" with ["WIT"] → "X.~WIT".
   */
  function strikeCodes(text, codes) {
    const tokens = cellTokens(text);
    for (const code of codes) {
      const live = tokens.find((t) => t.code === code && !t.cancelled);
      if (live) live.cancelled = true;
      else tokens.push({ code, cancelled: true });
    }
    return writeTokens(tokens);
  }

  /** Put struck-out codes back: "X.~WIT" → "X.WIT". */
  function reinstateCodes(text) {
    return writeTokens(cellTokens(text).map((t) => ({ ...t, cancelled: false })));
  }

  /**
   * What a change to one cell took away: the live codes in `before` with no
   * live counterpart in `after`, one per occurrence ("X.X" → "X" removed one X).
   * A code that was struck out rather than deleted is in the answer too, with
   * `struck: true` — it was cancelled by typing the tilde.
   */
  function removedCodes(before, after) {
    const left = new Map();
    for (const code of supportTokens(after)) left.set(code, (left.get(code) || 0) + 1);
    const struck = new Map();
    for (const code of cancelledTokens(after)) struck.set(code, (struck.get(code) || 0) + 1);
    const was = new Map();
    for (const code of cancelledTokens(before)) was.set(code, (was.get(code) || 0) + 1);
    const out = [];
    for (const code of supportTokens(before)) {
      if (left.get(code)) { left.set(code, left.get(code) - 1); continue; }
      // Struck out in this edit: more struck occurrences now than before.
      const newlyStruck = (struck.get(code) || 0) - (was.get(code) || 0);
      if (newlyStruck > 0) {
        was.set(code, (was.get(code) || 0) + 1);
        out.push({ code, struck: true });
      } else out.push({ code, struck: false });
    }
    return out;
  }

  function parseSupport(text, codes) {
    const known = new Set((codes || []).filter((c) => c.active !== false).map((c) => String(c.code).toUpperCase()));
    const tokens = supportTokens(text).map((code) => ({ code, known: known.has(code) }));
    return { tokens, unknown: [...new Set(tokens.filter((t) => !t.known).map((t) => t.code))] };
  }

  /** Tidy what was typed into the form the sheet writes: "x . wit" → "X.WIT". */
  function normaliseSupport(text) {
    return writeTokens(cellTokens(text));
  }

  /**
   * How much of each kind of support is asked for.
   *
   * Counted over activity rows only — a Resource row holds names, not codes — and
   * per day, per code; `byRow` gives the same count for each activity across the
   * whole window, which is what the activity's own panel shows.
   */
  function supportTotals(model, days) {
    const daySet = new Set(days);
    const byDay = new Map(days.map((d) => [d, new Map()]));
    const byRow = new Map();
    const kinds = new Map(model.rows.map((r) => [r.id, r]));
    for (const cell of cellList(model)) {
      const row = kinds.get(cell.row_id);
      if (!row || row.kind !== 'activity' || row.archived || !daySet.has(cell.day)) continue;
      for (const code of supportTokens(cell.text)) {
        const day = byDay.get(cell.day);
        day.set(code, (day.get(code) || 0) + 1);
        if (!byRow.has(row.id)) byRow.set(row.id, new Map());
        const r = byRow.get(row.id);
        r.set(code, (r.get(code) || 0) + 1);
      }
    }
    return { byDay, byRow };
  }

  /** "2 X · 1 WIT", in the order the register lists the codes. */
  function describeCounts(counts, codes) {
    if (!counts || !counts.size) return '';
    const order = (codes || []).map((c) => String(c.code).toUpperCase());
    return [...counts.entries()]
      .sort((a, b) => {
        const ia = order.indexOf(a[0]);
        const ib = order.indexOf(b[0]);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a[0].localeCompare(b[0]);
      })
      .map(([code, n]) => `${n} ${code}`)
      .join(' · ');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Cancellations, as the log will know them
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The label and location the cancellation log will give this row's days.
   *
   * The log is derived from what is published (`rowsFrom()` → `rc_lookahead_rows`
   * → `rc_cancelled_days`), and a note is matched to an event by exactly these
   * two strings — so a note recorded at the moment somebody paints a day red has
   * to be keyed the way the log will key the event, or it will never be found.
   * `tools/test_la_edit.js` holds this to what `rowsFrom()` actually produces.
   *
   * And the row itself (`la_row_id`), which the published reading carries too:
   * the words change when somebody fills in the Activity ID or corrects the
   * description, and a note found only by them fell out of the log when they did.
   */
  function cancellationKey(row) {
    const meta = metaValues(row);
    return {
      raw_label: meta.filter(Boolean).join(' · '),
      raw_location: row.location || '',
      la_row_id: row.id || null,
    };
  }

  /**
   * Runs of consecutive days per row, from a list of `{ row, day }` — "Monday to
   * Wednesday on the IXL row" is one cancellation, as the log counts it.
   */
  function dayRuns(items) {
    const byRow = new Map();
    for (const { row, day } of items) {
      if (!byRow.has(row.id)) byRow.set(row.id, { row, days: new Set() });
      byRow.get(row.id).days.add(day);
    }
    const runs = [];
    for (const { row, days } of byRow.values()) {
      const sorted = [...days].sort();
      let start = sorted[0];
      let prev = sorted[0];
      for (const d of sorted.slice(1)) {
        if (d === addDaysISO(prev, 1)) { prev = d; continue; }
        runs.push({ row, start, end: prev });
        start = d;
        prev = d;
      }
      if (start) runs.push({ row, start, end: prev });
    }
    return runs;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Names from the roster
     ═══════════════════════════════════════════════════════════════════════ */

  const foldWord = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /**
   * What to write for each person on the roster.
   *
   * The sheet is written in first names — "Adam, Jimmy" — and the calendar's
   * name register matches a first name only when exactly one person answers to
   * it. So a suggestion writes the first name where that is unambiguous and the
   * full name where two people share it: what is written is always something the
   * register will place, which is the point of suggesting it.
   */
  function nameChoices(people) {
    const live = (people || []).filter((p) => p && p.name && p.active !== false);
    const firsts = new Map();
    for (const p of live) {
      const first = foldWord(p.name).split(' ')[0];
      firsts.set(first, (firsts.get(first) || 0) + 1);
    }
    return live
      .map((p) => {
        const first = String(p.name).trim().split(/\s+/)[0];
        const unique = firsts.get(foldWord(first)) === 1;
        return { insert: unique ? first : String(p.name).trim(), full: String(p.name).trim() };
      })
      .sort((a, b) => a.insert.localeCompare(b.insert));
  }

  /** The name being typed: whatever follows the last separator. */
  function currentToken(text) {
    const pieces = String(text ?? '').split(/,|\/|&|\+|\n|\band\b/i);
    return pieces[pieces.length - 1].replace(/^\s+/, '');
  }

  /**
   * Roster names that fit what is being typed, best first — a first name or a
   * surname starting with it — leaving out anybody already in the cell.
   */
  function suggestNames(text, choices, limit = 6) {
    const token = foldWord(currentToken(text));
    if (!token) return [];
    const already = new Set(String(text ?? '').split(/[,/&+\n]|\band\b/i).map(foldWord).filter(Boolean));
    const scored = [];
    for (const c of choices || []) {
      if (already.has(foldWord(c.insert)) || already.has(foldWord(c.full))) continue;
      const words = foldWord(c.full).split(' ');
      let score = -1;
      if (foldWord(c.insert).startsWith(token)) score = 0;
      else if (words.some((w) => w.startsWith(token))) score = 1;
      else if (foldWord(c.full).includes(token)) score = 2;
      if (score >= 0) scored.push({ ...c, score });
    }
    return scored.sort((a, b) => a.score - b.score || a.insert.localeCompare(b.insert)).slice(0, limit);
  }

  /** The cell's text with the name being typed replaced by a chosen one. */
  function acceptName(text, insert) {
    const t = String(text ?? '');
    const token = currentToken(t);
    const head = t.slice(0, t.length - token.length);
    return `${head}${head && !/[\s]$/.test(head) ? ' ' : ''}${insert}`;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The model and its ops
     ═══════════════════════════════════════════════════════════════════════ */

  const cellKey = (rowId, day) => `${rowId}|${day}`;

  function makeModel(rows = [], cells = []) {
    const map = new Map();
    for (const c of cells) map.set(cellKey(c.row_id, c.day), { ...c });
    return { rows: rows.map((r) => ({ ...r })), cells: map };
  }

  function cellList(model) {
    return [...model.cells.values()];
  }

  /** A row as `rc_la_rows` answers it, in the model's shape: numbers as numbers, flags as booleans. */
  function cleanRow(r) {
    return {
      ...blankRow(r.kind, {}),
      ...r,
      sort: Number(r.sort) || 0,
      level: Number(r.level) || 0,
      archived: !!r.archived,
    };
  }

  /** A cell as `rc_la_cells` answers it: the day as a date, the colour in capitals. */
  function cleanCell(c) {
    return {
      row_id: c.row_id,
      day: String(c.day).slice(0, 10),
      color: c.color ? String(c.color).toUpperCase() : null,
      text: c.text || '',
      version: c.version || 0,
    };
  }

  function getCell(model, rowId, day) {
    return model.cells.get(cellKey(rowId, day)) || null;
  }

  const ROW_FIELDS = ['kind', 'parent_id', 'sort', 'level', 'activity_id', 'description', 'location',
    'sswp', 'party', 'work_hours', 'absence_kind', 'archived'];

  /**
   * Apply ops to the model in place, and return the ops that undo them.
   *
   *   { op: 'row', id, set: {…fields} }          create (with `kind`) or change a row
   *   { op: 'delete_row', id }                    remove a row (its cells go with it)
   *   { op: 'cell', row_id, day, color, text }    set a cell; blank both to clear it
   *
   * The inverse of a batch is its ops' inverses in reverse order, so an undo puts
   * back exactly what was there — a deleted activity returns with its cells, its
   * Resource rows and their names, because deleting it was all of those ops.
   */
  function applyOps(model, ops) {
    const inverse = [];
    for (const op of ops) {
      if (op.op === 'row') {
        const at = model.rows.findIndex((r) => r.id === op.id);
        if (at < 0) {
          const row = { ...blankRow(op.set?.kind || 'activity', { id: op.id }), ...op.set, version: 0 };
          model.rows.push(row);
          inverse.push({ op: 'delete_row', id: op.id });
        } else {
          const row = model.rows[at];
          const before = {};
          for (const k of Object.keys(op.set || {})) {
            if (!ROW_FIELDS.includes(k)) continue;
            before[k] = row[k];
          }
          model.rows[at] = { ...row, ...pick(op.set, ROW_FIELDS) };
          inverse.push({ op: 'row', id: op.id, set: before });
        }
      } else if (op.op === 'delete_row') {
        const at = model.rows.findIndex((r) => r.id === op.id);
        if (at < 0) continue;
        const row = model.rows[at];
        // The cells first, so undoing recreates the row before it refills them.
        const cells = cellList(model).filter((c) => c.row_id === op.id);
        for (const c of cells) model.cells.delete(cellKey(c.row_id, c.day));
        model.rows.splice(at, 1);
        /** @type {object[]} */
        const restore = [{ op: 'row', id: row.id, set: pick(row, ROW_FIELDS) }];
        for (const c of cells) restore.push({ op: 'cell', row_id: c.row_id, day: c.day, color: c.color || null, text: c.text || '' });
        inverse.push(...restore.reverse());
      } else if (op.op === 'cell') {
        const key = cellKey(op.row_id, op.day);
        const was = model.cells.get(key) || null;
        const color = op.color ? String(op.color).toUpperCase() : null;
        const text = String(op.text ?? '');
        if (!color && !text) model.cells.delete(key);
        else model.cells.set(key, { row_id: op.row_id, day: op.day, color, text, version: was?.version || 0 });
        inverse.push({ op: 'cell', row_id: op.row_id, day: op.day, color: was?.color || null, text: was?.text || '' });
      }
    }
    return inverse.reverse();
  }

  function pick(obj, keys) {
    const out = {};
    for (const k of keys) if (obj && k in obj) out[k] = obj[k];
    return out;
  }

  /**
   * The versions each op expects to find, from the model *before* it is applied.
   *
   * Done at send time rather than when the op was made, because an undo is sent
   * long after it was recorded, against whatever the row has become since.
   */
  function stamp(model, ops) {
    return ops.map((op) => {
      if (op.op === 'cell') return { ...op, expect: getCell(model, op.row_id, op.day)?.version || 0 };
      const row = model.rows.find((r) => r.id === op.id);
      return { ...op, expect: row ? row.version || 0 : 0 };
    });
  }

  /** Record the versions the server answered with. */
  function acknowledge(model, results) {
    for (const r of results || []) {
      if (r.kind === 'cell') {
        const c = model.cells.get(cellKey(r.row_id, r.day));
        if (c) c.version = r.version;
      } else if (r.kind === 'row') {
        const row = model.rows.find((x) => x.id === r.id);
        if (row) row.version = r.version;
      }
    }
  }

  /** Ops that delete a row and everything that belongs to it, cells first. */
  function deleteOps(model, ids) {
    const want = new Set(ids);
    for (const r of model.rows) if (r.kind === 'resource' && want.has(r.parent_id)) want.add(r.id);
    const ops = [];
    for (const c of cellList(model)) {
      if (want.has(c.row_id)) ops.push({ op: 'cell', row_id: c.row_id, day: c.day, color: null, text: '' });
    }
    // Children before parents: a Resource row points at its activity.
    const rows = model.rows.filter((r) => want.has(r.id)).sort((a, b) => Number(b.kind === 'resource') - Number(a.kind === 'resource'));
    for (const r of rows) ops.push({ op: 'delete_row', id: r.id });
    return ops;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Going back to an earlier moment
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The ops that put the look-ahead back the way it was before `edits`.
   *
   * `edits` are rows of `rc_la_edits` — everything recorded from some moment on,
   * in any order. For each row and each day they touched, the *earliest* of them
   * says what was there before: its `before`, or nothing at all if it was an
   * insert. The result is ordinary ops, so a restore is itself an edit — saved,
   * recorded in the log, and undone with one Ctrl+Z like anything else — rather
   * than a rewrite of history, which the log does not allow anyway.
   *
   * Ordered so every op is legal when it runs: rows that come back (parents
   * before their names rows), then cells, then rows that go (names rows first,
   * with their cells cleared ahead of them). Nothing that is already as it was is
   * touched.
   */
  function restoreOps(model, edits) {
    const first = new Map();
    for (const e of [...(edits || [])].sort((a, b) => Number(a.id) - Number(b.id))) {
      const key = e.target === 'cell' ? `cell:${e.row_id}|${String(e.day).slice(0, 10)}` : `row:${e.row_id}`;
      if (!first.has(key)) first.set(key, e);
    }
    const rowsNow = new Map(model.rows.map((r) => [r.id, r]));
    const restoreRows = [];
    const removeRows = [];
    const cells = [];
    const willExist = new Set(model.rows.map((r) => r.id));

    for (const [key, e] of first) {
      if (!key.startsWith('row:')) continue;
      const was = e.action === 'insert' ? null : e.before;
      const now = rowsNow.get(e.row_id) || null;
      if (!was) {
        if (now) { removeRows.push(now); willExist.delete(now.id); }
        continue;
      }
      willExist.add(e.row_id);
      const set = pick(was, ROW_FIELDS);
      if (set.sort != null) set.sort = Number(set.sort);
      if (set.level != null) set.level = Number(set.level);
      if (now) {
        const changed = Object.keys(set).filter((k) => String(now[k] ?? '') !== String(set[k] ?? ''));
        if (changed.length) restoreRows.push({ op: 'row', id: e.row_id, set: Object.fromEntries(changed.map((k) => [k, set[k]])) });
      } else {
        restoreRows.push({ op: 'row', id: e.row_id, set });
      }
    }

    for (const [key, e] of first) {
      if (!key.startsWith('cell:')) continue;
      if (!willExist.has(e.row_id)) continue; // goes with its row
      const day = String(e.day).slice(0, 10);
      const was = e.action === 'insert' ? null : e.before;
      const color = was?.color ? String(was.color).toUpperCase() : null;
      const text = was?.text || '';
      const now = getCell(model, e.row_id, day);
      if ((now?.color || null) === color && (now?.text || '') === text) continue;
      cells.push({ op: 'cell', row_id: e.row_id, day, color, text });
    }

    const creates = restoreRows.sort((a, b) => Number(a.set.kind === 'resource') - Number(b.set.kind === 'resource'));
    const removals = deleteOps(model, removeRows.map((r) => r.id));
    return [...creates, ...cells, ...removals];
  }

  /**
   * Restore points: the log grouped into the saves that made it, newest first —
   * "Tuesday 16:02, Dana, 12 changes" — which is how anybody remembers an edit.
   */
  function restorePoints(edits) {
    const batches = new Map();
    for (const e of edits || []) {
      const b = batches.get(e.batch) || { batch: e.batch, firstId: Number(e.id), at: e.at, by: e.by, count: 0, rows: new Set() };
      b.count++;
      b.rows.add(e.row_id);
      if (Number(e.id) < b.firstId) { b.firstId = Number(e.id); b.at = e.at; }
      batches.set(e.batch, b);
    }
    return [...batches.values()].sort((a, b) => b.firstId - a.firstId).map((b) => ({ ...b, rows: b.rows.size }));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Selections: fill and clipboard
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Repeat a block of cells across a larger area, the way Excel's fill handle
   * does: the pattern tiles, so dragging "X.WIT on yellow, blank, blank" along a
   * row repeats it every three days.
   */
  function tile(source, height, width) {
    const h = source.length;
    const w = source[0]?.length || 0;
    if (!h || !w) return [];
    return Array.from({ length: height }, (_, r) =>
      Array.from({ length: width }, (_, c) => ({ ...source[r % h][c % w] })));
  }

  /** A block of `{ color, text }` as tab-separated text, which every spreadsheet reads. */
  function toTSV(block) {
    return block.map((row) => row.map((c) => String(c.text ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n');
  }

  function fromTSV(text) {
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    return lines.map((line) => line.split('\t').map((t) => ({ color: null, text: t.trim() })));
  }

  const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /**
   * The same block as an HTML table, colours included — which is what Excel
   * reads on paste, so painted cells arrive painted.
   */
  function toHTML(block) {
    const rows = block.map((row) => `<tr>${row.map((c) => {
      const bg = c.color ? ` style="background:#${c.color};mso-pattern:#${c.color} none"` : '';
      return `<td${bg}>${escapeHtml(c.text)}</td>`;
    }).join('')}</tr>`).join('');
    return `<table>${rows}</table>`;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The published grid — the shape the rest of the calendar reads
     ═══════════════════════════════════════════════════════════════════════ */

  /** Spreadsheet column letters. */
  function colLetters(n) {
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /** The grey the section bands are painted in, on the sheet and on the grid. */
  const SECTION_BAND = 'D9D9D9';

  /** Where things go on the sheet — shared by the published grid and the export. */
  const LAYOUT = {
    firstMetaCol: 2, // B
    firstDayCol: 8, // H
    titleRow: 1,
    headingRow: 2, // B2:B6 … G2:G6, merged
    monthRow: 4,
    dayRow: 5,
    weekdayRow: 6,
    firstBodyRow: 7,
  };

  /**
   * The model as a parsed workbook.
   *
   * Laid out as the 4WLA is — headings on row 2, the month band on 4, day numbers
   * on 5, weekday letters on 6, rows from 7 — so `readGrid()` finds it exactly the
   * way it found the file: by the weekday letters, not by a column number. A
   * section band is painted across its six activity columns, which is how
   * `readGrid()` has always told a heading from work, and never across the days,
   * where paint would read as a shift.
   */
  function gridFromModel(model, days, { title = '' } = {}) {
    const L = LAYOUT;
    const rows = [];
    const cell = (row, col, value, hex = null) => ({ col, ref: `${colLetters(col)}${row}`, value: value ?? '', hex });
    const merges = [];

    rows.push({ row: L.titleRow, label: '', cells: [cell(L.titleRow, L.firstMetaCol, title)] });
    rows.push({
      row: L.headingRow, label: '',
      cells: FIELDS.map((f, i) => cell(L.headingRow, L.firstMetaCol + i, f.heading)),
    });
    FIELDS.forEach((_, i) => {
      const col = colLetters(L.firstMetaCol + i);
      merges.push(`${col}${L.headingRow}:${col}${L.weekdayRow}`);
    });

    const monthCells = [];
    let lastMonth = null;
    let runStart = 0;
    days.forEach((d, i) => {
      const m = monthLabel(d);
      if (m !== lastMonth) {
        if (lastMonth !== null && i - 1 > runStart) {
          merges.push(`${colLetters(L.firstDayCol + runStart)}${L.monthRow}:${colLetters(L.firstDayCol + i - 1)}${L.monthRow}`);
        }
        monthCells.push(cell(L.monthRow, L.firstDayCol + i, m));
        lastMonth = m;
        runStart = i;
      }
    });
    if (days.length && days.length - 1 > runStart) {
      merges.push(`${colLetters(L.firstDayCol + runStart)}${L.monthRow}:${colLetters(L.firstDayCol + days.length - 1)}${L.monthRow}`);
    }
    rows.push({ row: L.monthRow, label: '', cells: monthCells });
    rows.push({
      row: L.dayRow, label: '',
      cells: days.map((d, i) => cell(L.dayRow, L.firstDayCol + i, String(Number(d.slice(8, 10))))),
    });
    rows.push({
      row: L.weekdayRow, label: '',
      cells: days.map((d, i) => cell(L.weekdayRow, L.firstDayCol + i, weekdayLetter(d))),
    });

    let r = L.firstBodyRow;
    for (const row of orderedRows(model.rows)) {
      const cells = [];
      const meta = metaValues(row);
      const band = row.kind === 'section' ? SECTION_BAND : null;
      meta.forEach((value, i) => {
        if (value || band) cells.push(cell(r, L.firstMetaCol + i, value, band));
      });
      if (row.kind !== 'section') {
        days.forEach((d, i) => {
          const c = getCell(model, row.id, d);
          if (c && (c.text || c.color)) cells.push(cell(r, L.firstDayCol + i, c.text || '', c.color || null));
        });
      }
      /* The row's own id rides along, unseen. A workbook has no such thing, so
         a reading of one matches rows by where they sit; a reading published from
         here can match them by what they are, and so name who changed them. */
      rows.push({ row: r, label: '', id: row.id, cells });
      r++;
    }

    return { sheet: '4WLA', rows, merges, hiddenColumns: [], conditional: [], unknown: [] };
  }

  /** The six activity-column values a row prints, in `FIELDS` order. */
  function metaValues(row) {
    if (row.kind === 'resource') return ['', 'Resource', '', '', '', ''];
    if (row.kind === 'absence') {
      const label = row.description || ABSENCE_LABELS[row.absence_kind] || 'PTO';
      return ['', label, '', '', '', ''];
    }
    if (row.kind === 'section') return ['', row.description || '', '', '', '', ''];
    return FIELDS.map((f) => String(row[f.key] ?? ''));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Starting from the workbook
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Which of the sheet's activity columns is which field.
   *
   * By column where the sheet uses the 4WLA's own columns — B is the Activity ID
   * and G the work hours whatever is filled in, and BART's file hides the heading
   * row, so there is often no heading to read — and by heading otherwise.
   */
  function fieldIndexes(headings, metaCols) {
    const cols = metaCols || [];
    if (cols.length && cols.every((c) => c >= LAYOUT.firstMetaCol && c < LAYOUT.firstMetaCol + FIELDS.length)) {
      const out = {};
      FIELDS.forEach((f, i) => {
        const at = cols.indexOf(LAYOUT.firstMetaCol + i);
        if (at >= 0) out[f.key] = at;
      });
      return out;
    }
    return fieldIndexesByHeading(headings);
  }

  function fieldIndexesByHeading(headings) {
    const tests = {
      activity_id: /activity\s*id/i,
      description: /descr|activity/i,
      location: /location/i,
      sswp: /sswp/i,
      party: /party/i,
      work_hours: /hour/i,
    };
    const out = {};
    const used = new Set();
    for (const key of ['activity_id', 'location', 'sswp', 'party', 'work_hours', 'description']) {
      const i = (headings || []).findIndex((h, idx) => !used.has(idx) && tests[key].test(String(h || '')));
      if (i >= 0) { out[key] = i; used.add(i); }
    }
    FIELDS.forEach((f, pos) => {
      if (out[f.key] == null && !used.has(pos) && pos < (headings || []).length) { out[f.key] = pos; used.add(pos); }
    });
    return out;
  }

  /**
   * The editor's first contents, from a reading of the old workbook.
   *
   * `view` is `readGrid()` of a legend-applied grid, dated. What comes across is
   * what is still ahead: an activity with a shift, a support code or a name from
   * `fromISO` on; the sections that have such activities under them; the
   * PTO / Office / Other group rows always, because they are the frame of the
   * sheet. The past, the hidden rows and columns and the weekend shading stay
   * behind with the old file.
   *
   * Only paint the legend calls a **shift** is carried — Day, Swing, Night,
   * Blanket, Cancellation — because the editor paints with nothing else. Shading,
   * section bands and colours nobody has named are counted in the report and
   * left behind, never guessed at.
   *
   * @param {object} view
   * @param {{ fromISO?: string, toISO?: string | null, legend?: any[] }} [options]
   */
  function modelFromView(view, { fromISO, toISO = null, legend = [] } = {}) {
    const shift = new Map();
    for (const e of legend || []) {
      if ((e.role || 'shift') === 'shift' && e.meaning) shift.set(String(e.argb).toUpperCase(), e.meaning);
    }
    const report = { activities: 0, sections: 0, resources: 0, absences: 0, cells: 0, droppedColours: 0, past: 0 };
    const dayOf = new Map((view.days || []).filter((d) => d.date).map((d) => [d.col, d.date]));
    const inWindow = (date) => date && date >= fromISO && (!toISO || date <= toISO);
    const idx = fieldIndexes(view.headings, view.meta);

    /** @type {any[]} */
    const pending = []; // rows in sheet order, each with its cells
    const cellsOf = (marks, keepColour) => {
      const out = [];
      for (const m of marks || []) {
        const day = dayOf.get(m.col);
        if (!day) continue;
        if (!inWindow(day)) { report.past++; continue; }
        let color = m.hex ? String(m.hex).toUpperCase() : null;
        if (color && (!keepColour || !shift.has(color))) {
          report.droppedColours++;
          color = null;
        }
        const text = String(m.value ?? '').trim();
        if (!color && !text) continue;
        out.push({ day, color, text });
      }
      return out;
    };

    for (const a of view.activities || []) {
      if (a.heading) {
        pending.push({ kind: 'section', description: a.meta.find(Boolean) || '', cells: [] });
        continue;
      }
      if (a.absence) {
        pending.push({
          kind: 'absence',
          absence_kind: a.absence,
          description: a.meta.find((v) => absenceKind(v)) || ABSENCE_LABELS[a.absence],
          cells: cellsOf(a.marks, false),
        });
        continue;
      }
      const fields = {};
      for (const f of FIELDS) fields[f.key] = idx[f.key] != null ? (a.meta[idx[f.key]] || '') : '';
      const cells = cellsOf(a.marks, true);
      const names = a.resource ? cellsOf(a.resource.marks, false) : [];
      pending.push({ kind: 'activity', ...fields, cells, resource: a.resource ? names : null, live: cells.length > 0 || names.length > 0 });
    }

    /* Which sections stay: those with a live activity under them, and a section
       directly above another kept section — the workbook nests "PHASE 2" over
       "W40 — Testing" over "IXL (W40)", and keeping only the innermost would
       orphan the others. Walked backwards, as `drawn()` does. */
    const keep = new Array(pending.length).fill(false);
    let liveBelow = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (p.kind === 'activity') {
        keep[i] = p.live;
        if (p.live) liveBelow = true;
      } else if (p.kind === 'absence') {
        keep[i] = true;
      } else {
        keep[i] = liveBelow || (pending[i + 1]?.kind === 'section' && keep[i + 1]);
        liveBelow = false;
      }
    }

    const rows = [];
    const cells = [];
    let sort = 0;
    pending.forEach((p, i) => {
      if (!keep[i]) return;
      sort += 1024;
      const row = blankRow(p.kind, {
        sort,
        description: p.description || '',
        absence_kind: p.absence_kind || null,
      });
      if (p.kind === 'activity') for (const f of FIELDS) row[f.key] = p[f.key] || '';
      rows.push(row);
      report[{ section: 'sections', activity: 'activities', absence: 'absences' }[p.kind]]++;
      for (const c of p.cells) {
        const text = p.kind === 'activity' ? normaliseSupportIfCodes(c.text) : c.text;
        cells.push({ row_id: row.id, day: c.day, color: c.color, text, version: 0 });
      }
      if (p.resource) {
        const res = blankRow('resource', { parent_id: row.id, sort: sort + 1 });
        rows.push(res);
        report.resources++;
        for (const c of p.resource) cells.push({ row_id: res.id, day: c.day, color: null, text: c.text, version: 0 });
      }
    });
    report.cells = cells.length;
    return { model: makeModel(rows, cells), report };
  }

  /** "X " → "X", "x.wit" → "X.WIT" — but only when it *looks* like codes, so a note survives. */
  function normaliseSupportIfCodes(text) {
    const t = String(text).trim();
    return /^~?\s*[A-Za-z]{1,6}(\s*\.\s*~?\s*[A-Za-z]{1,6})*\.?$/.test(t) ? normaliseSupport(t) : t;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     What happened to one cell, and to one row

     `rc_la_edits` already says who changed what and when; these read it for one
     place on the sheet, newest first. A cell's value is its colour and its text,
     and the log keeps both sides of every change, so a history is the log
     filtered — nothing is reconstructed.
     ═══════════════════════════════════════════════════════════════════════ */

  /** A cell's value as the log holds it: `{ color, text }`, or null for an empty day. */
  function cellValue(v) {
    if (!v) return null;
    const color = v.color ? String(v.color).toUpperCase() : null;
    const text = String(v.text ?? '');
    return color || text ? { color, text } : null;
  }

  /** The changes to one day of one row, newest first: `[{ id, at, by, before, after }]`. */
  function cellHistory(edits, rowId, day) {
    const want = String(day).slice(0, 10);
    return (edits || [])
      .filter((e) => e.target === 'cell' && e.row_id === rowId && String(e.day).slice(0, 10) === want)
      .sort((a, b) => Number(b.id) - Number(a.id))
      .map((e) => ({
        id: e.id,
        at: e.at,
        by: e.by || null,
        before: e.action === 'insert' ? null : cellValue(e.before),
        after: e.action === 'delete' ? null : cellValue(e.after),
      }));
  }

  const HISTORY_FIELDS = [
    ...FIELDS.map((f) => ({ key: f.key, label: f.heading })),
    { key: 'archived', label: 'Archived' },
    { key: 'absence_kind', label: 'Kind' },
  ];

  /**
   * The changes to one row's own fields, newest first:
   * `[{ id, at, by, action, changes: [{ field, from, to }] }]`. Moving a row
   * (its `sort`) is left out: it is where the row sits, not what it says.
   */
  function rowHistory(edits, rowId) {
    return (edits || [])
      .filter((e) => e.target === 'row' && e.row_id === rowId)
      .sort((a, b) => Number(b.id) - Number(a.id))
      .map((e) => {
        const before = e.before || {};
        const after = e.after || {};
        const changes = e.action === 'update'
          ? HISTORY_FIELDS
            .filter((f) => String(before[f.key] ?? '') !== String(after[f.key] ?? ''))
            .map((f) => ({ field: f.label, from: before[f.key] ?? '', to: after[f.key] ?? '' }))
          : [];
        return { id: e.id, at: e.at, by: e.by || null, action: e.action, changes };
      })
      .filter((h) => h.action !== 'update' || h.changes.length);
  }

  /**
   * A cell's value in words: the legend's meaning for its colour, then its text.
   * `meaningOf(hex)` is injected — the legend lives with the calendar.
   *
   * @param {{ color?: string | null, text?: string } | null} value
   * @param {(hex: string) => string} [meaningOf]
   */
  function describeCellValue(value, meaningOf = () => '') {
    if (!value) return 'empty';
    const colour = value.color ? (meaningOf(value.color) || `#${value.color}`) : '';
    return [colour, value.text].filter(Boolean).join(' · ') || 'empty';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Who changed what

     The edit log read across the whole look-ahead rather than for one place:
     every change as a line somebody can read ("Mon 12 Oct: Day → Cancelled"),
     and, for each change found between two readings, the edits that made it.
     Nothing here is stored — `rc_la_edits` keeps both sides of every change,
     and a reading published from the editor carries each row's id, which is
     the whole join.
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Every row the log mentions, by id: the rows as they are now, and — for one
   * since deleted — the last thing the log saw of it. A deleted activity is
   * still somebody's change, and "Row" is no way to describe it.
   */
  function rowsKnown(rows, edits) {
    const known = new Map((rows || []).map((r) => [r.id, r]));
    const current = new Set(known.keys());
    for (const e of [...(edits || [])].sort((a, b) => Number(a.id) - Number(b.id))) {
      if (e.target !== 'row' || current.has(e.row_id)) continue;
      const seen = e.after || e.before;
      if (seen) known.set(e.row_id, { ...seen, id: e.row_id, gone: e.action === 'delete' });
    }
    return known;
  }

  /** What a row is called in a sentence about it. */
  function rowTitle(row, known = new Map()) {
    if (!row) return 'A row since deleted';
    if (row.kind === 'resource') {
      const parent = known.get(row.parent_id);
      return parent ? `Names under ${rowTitle(parent, known)}` : 'Names row';
    }
    if (row.kind === 'absence') return row.description || ABSENCE_LABELS[row.absence_kind] || 'PTO';
    if (row.kind === 'section') return `Section: ${row.description || 'untitled'}`;
    return row.description || row.activity_id || 'Untitled activity';
  }

  /**
   * Who joined a day and who left it, between two ways a names cell was written.
   * Names are compared as `resourceNames()` reads them, case aside, so "Jimmy,
   * Viktor" becoming "Viktor, Jimmy" is nobody joining and nobody leaving.
   */
  function namesDiff(was, now) {
    const before = resourceNames(was);
    const after = resourceNames(now);
    const has = (list, name) => list.some((n) => n.toLowerCase() === name.toLowerCase());
    return {
      added: after.filter((n) => !has(before, n)),
      removed: before.filter((n) => !has(after, n)),
    };
  }

  /**
   * How the support codes on a day changed: codes asked for and taken off, and
   * codes struck out ("X.~WIT" — cancelled while the work went ahead) or put
   * back. Counted, because "X.X" is two EICs and one of them going is a change.
   */
  function codesDiff(was, now) {
    const count = (text, cancelled) => {
      const m = new Map();
      for (const t of cellTokens(text)) if (t.cancelled === cancelled) m.set(t.code, (m.get(t.code) || 0) + 1);
      return m;
    };
    const askedBefore = count(was, false);
    const askedAfter = count(now, false);
    const struckBefore = count(was, true);
    const struckAfter = count(now, true);
    const codes = [...new Set([...askedBefore.keys(), ...askedAfter.keys(), ...struckBefore.keys(), ...struckAfter.keys()])];
    const out = { added: [], removed: [], struck: [], reinstated: [] };
    const push = (list, code, n) => { if (n > 0) list.push(n > 1 ? `${n} × ${code}` : code); };
    for (const code of codes) {
      const asked = (askedAfter.get(code) || 0) - (askedBefore.get(code) || 0);
      const struck = (struckAfter.get(code) || 0) - (struckBefore.get(code) || 0);
      // Asked-for becoming struck out is one change, not a removal and a strike.
      const nowStruck = Math.min(Math.max(-asked, 0), Math.max(struck, 0));
      const putBack = Math.min(Math.max(asked, 0), Math.max(-struck, 0));
      push(out.struck, code, nowStruck);
      push(out.reinstated, code, putBack);
      push(out.added, code, asked - putBack);
      push(out.removed, code, -asked - nowStruck);
      push(out.struck, code, struck - nowStruck);
      push(out.reinstated, code, -struck - putBack);
    }
    return out;
  }

  /** "Added Jimmy, Viktor · Took off Adam" — or null when nothing differs. */
  function namesSentence(was, now) {
    const { added, removed } = namesDiff(was, now);
    const parts = [];
    if (added.length) parts.push(`Added ${added.join(', ')}`);
    if (removed.length) parts.push(`Took off ${removed.join(', ')}`);
    return parts.length ? parts.join(' · ') : null;
  }

  /**
   * What one edit to an activity's day did, in words: the shift and the support
   * codes, each only if it changed. `{ what, detail }` — `what` is the short
   * name for the column, `detail` the sentence.
   */
  function dayChange(before, after, meaningOf) {
    const colour = (v) => (v?.color ? (meaningOf(v.color) || `#${v.color}`) : '');
    const text = (v) => String(v?.text ?? '');
    const parts = [];
    const shiftMoved = colour(before) !== colour(after);
    if (shiftMoved) {
      if (!colour(before)) parts.push(`Painted ${colour(after)}`);
      else if (!colour(after)) parts.push(`Cleared ${colour(before)}`);
      else parts.push(`Shift ${colour(before)} → ${colour(after)}`);
    }
    const codesMoved = text(before) !== text(after);
    if (codesMoved) {
      const d = codesDiff(text(before), text(after));
      const said = [];
      if (d.added.length) said.push(`support added ${d.added.join(', ')}`);
      if (d.removed.length) said.push(`support taken off ${d.removed.join(', ')}`);
      if (d.struck.length) said.push(`${d.struck.join(', ')} struck out`);
      if (d.reinstated.length) said.push(`${d.reinstated.join(', ')} put back`);
      // Text that is not codes, or the same codes written differently.
      if (!said.length) said.push(`text "${text(before) || 'empty'}" → "${text(after) || 'empty'}"`);
      parts.push(...said);
    }
    const what = shiftMoved && codesMoved ? 'Shift and support' : shiftMoved ? 'Shift' : codesMoved ? 'Support' : 'Day';
    const detail = parts.join(' · ').replace(/^./, (c) => c.toUpperCase());
    return { what, detail: detail || 'Rewritten unchanged' };
  }

  /**
   * The edit log as lines somebody can read, oldest first.
   *
   * One line per thing that changed: a row update that touched three fields is
   * three lines, so "who changed the location" has an answer of its own. Moving a
   * row (`sort`) or indenting it (`level`) is left out — it is where the row
   * sits, not what it says, the rule `rowHistory()` already keeps.
   *
   * `{ id, at, by, batch, rowId, activityId, title, location, day, what, detail, from, to }`
   * — `what` is the kind of change (Names, Shift, Support, a field's heading),
   * `detail` says exactly what differs ("Added Oleksii · Took off Viktor",
   * "Shift Day Shift → Cancellation · WIT struck out"), and `activityId` is the
   * activity a names row sits under, so filtering on an activity finds who was
   * put on it too. `meaningOf(hex)` is the legend's.
   */
  function editLines(edits, { rows = [], meaningOf = () => '' } = {}) {
    const known = rowsKnown(rows, edits);
    const out = [];
    for (const e of [...(edits || [])].sort((a, b) => Number(a.id) - Number(b.id))) {
      const row = known.get(e.row_id) || null;
      const activityId = row?.kind === 'resource' && row.parent_id ? row.parent_id : e.row_id;
      const base = {
        id: e.id, at: e.at, by: e.by || null, batch: e.batch || null, rowId: e.row_id, activityId,
        title: rowTitle(row, known), location: known.get(activityId)?.location || '',
        day: e.day ? String(e.day).slice(0, 10) : null,
      };
      if (e.target === 'cell') {
        const was = e.action === 'insert' ? null : cellValue(e.before);
        const now = e.action === 'delete' ? null : cellValue(e.after);
        /* A names row — under an activity, or the PTO / Office / Other rows at
           the bottom — holds people, never a shift: its cells are names. */
        const names = row?.kind === 'resource' || row?.kind === 'absence';
        const change = names
          ? { what: 'Names', detail: namesSentence(was?.text, now?.text) || `"${was?.text || 'empty'}" → "${now?.text || 'empty'}"` }
          : dayChange(was, now, meaningOf);
        out.push({
          ...base,
          ...change,
          from: names ? (was?.text || 'empty') : describeCellValue(was, meaningOf),
          to: names ? (now?.text || 'empty') : describeCellValue(now, meaningOf),
        });
        continue;
      }
      if (e.action === 'insert') { out.push({ ...base, what: 'Added', detail: `Added ${base.title}`, from: '', to: base.title }); continue; }
      if (e.action === 'delete') { out.push({ ...base, what: 'Deleted', detail: `Deleted ${base.title}`, from: base.title, to: '' }); continue; }
      const before = e.before || {};
      const after = e.after || {};
      for (const f of HISTORY_FIELDS) {
        const was = before[f.key] ?? '';
        const now = after[f.key] ?? '';
        if (String(was) === String(now)) continue;
        if (f.key === 'archived') {
          const what = now ? 'Taken off the look-ahead' : 'Put back';
          out.push({ ...base, what, detail: what, from: '', to: '' });
        } else {
          out.push({
            ...base, what: f.label, from: String(was), to: String(now),
            detail: `${f.label} ${String(was) || 'empty'} → ${String(now) || 'empty'}`,
          });
        }
      }
    }
    return out;
  }

  function dayOfEvent(event) {
    return String(event.before?.date || event.after?.date || event.date || '').slice(0, 10) || null;
  }

  function inWeek(day, weekStart) {
    if (!day || !weekStart) return false;
    const start = Date.parse(`${String(weekStart).slice(0, 10)}T00:00:00Z`);
    const at = Date.parse(`${String(day).slice(0, 10)}T00:00:00Z`);
    return at >= start && at < start + 7 * 86400000;
  }

  /**
   * The edits that made one change, found between two readings.
   *
   * `event` is a stored change (`rc_change_events`): it names the editor's row
   * (`la_row_id`), the week, and — for a day — the date. The edits are the ones
   * written after the earlier reading was taken and no later than the later one
   * (`fromAt`, `toAt`), on that row, narrowed to what the change was about: the
   * day itself for a shift, the names row underneath for who is on it, the
   * row's own fields for a move or a new description. A change between two
   * workbook reads has no row id, and nothing is guessed for it.
   */
  function editsBehind(event, edits, { rows = [], fromAt = null, toAt = null } = {}) {
    const rowId = event?.la_row_id;
    if (!rowId) return [];
    const from = fromAt ? Date.parse(fromAt) : -Infinity;
    const to = toAt ? Date.parse(toAt) : Infinity;
    const known = rowsKnown(rows, edits);
    const children = new Set([...known.values()]
      .filter((r) => r.kind === 'resource' && r.parent_id === rowId).map((r) => r.id));
    const day = dayOfEvent(event);
    const week = event.week_start;
    const names = Boolean(event.before?.resources || event.after?.resources);

    const wanted = (e) => {
      const cell = e.target === 'cell';
      const ownCell = cell && e.row_id === rowId;
      switch (event.kind) {
        case 'shift_changed':
        case 'cancellation':
          return ownCell && String(e.day).slice(0, 10) === day;
        case 'resource_changed':
          return names
            ? cell && children.has(e.row_id) && inWeek(e.day, week)
            : ownCell && inWeek(e.day, week);
        case 'scope_added':
        case 'scope_removed':
          return (e.target === 'row' && e.row_id === rowId) || (ownCell && inWeek(e.day, week));
        case 'location_shift':
        case 'details_changed':
          return e.target === 'row' && e.row_id === rowId && e.action === 'update';
        default:
          return false;
      }
    };

    return (edits || [])
      .filter((e) => {
        const at = Date.parse(e.at);
        return at > from && at <= to && wanted(e);
      })
      .sort((a, b) => Number(a.id) - Number(b.id));
  }

  /** Who made a set of edits, in the order they first did, without repeats. */
  function editors(edits) {
    const out = [];
    for (const e of edits || []) if (!out.includes(e.by || null)) out.push(e.by || null);
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Is everybody named where they can be?

     Only the people on the team — the names rows and the PTO / Office rows, read
     against the roster. What an activity *asks for* (its support codes) is the
     support's business and is not counted here. A name the roster does not know
     is somebody else's person and is left alone: the check is about the team.

     Three clashes, each a contradiction in the plan rather than a judgement:
       leave   named on work on a day they have leave booked in the calendar
       pto     named on work on a day the sheet's own PTO row has them off
       shifts  named on two activities that day painted as different shifts —
               a day shift and a night shift, say. Two activities on one shift
               is an ordinary day, and is not flagged.
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * `resolve(written)` answers `{ id, name }` for a name on the roster, or null —
   * injected, because the register lives with the calendar. `leave` is
   * `[{ person_id, start_date, end_date, status, kind }]` (cancelled and
   * declined are ignored). `isShift(hex)` says whether a colour is a shift at all
   * (a cancellation is not), and `shiftOf(hex)` which shift it is.
   *
   * Returns `{ issues, byCell }`: every clash as
   * `{ row_id, day, person_id, name, kind, detail }`, and the same keyed by
   * `row_id|day` for drawing.
   *
   * @param {object} model
   * @param {string[]} days
   * @param {{ resolve?: (written: string) => any, leave?: any[], isShift?: (hex: string) => boolean, shiftOf?: (hex: string) => string }} [options]
   */
  function staffingIssues(model, days, {
    resolve, leave = [], isShift = (hex) => !!hex, shiftOf = (hex) => hex,
  } = {}) {
    const issues = [];
    const byCell = new Map();
    if (!model || typeof resolve !== 'function') return { issues, byCell };
    const rows = model.rows.filter((r) => !r.archived);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const namesRows = rows.filter((r) => r.kind === 'resource' && byId.get(r.parent_id)?.kind === 'activity');
    const ptoRows = rows.filter((r) => r.kind === 'absence' && (r.absence_kind || 'pto') === 'pto');
    const liveLeave = (leave || []).filter((l) => l && !['cancelled', 'declined'].includes(l.status));

    const add = (issue) => {
      issues.push(issue);
      const key = cellKey(issue.row_id, issue.day);
      if (!byCell.has(key)) byCell.set(key, []);
      byCell.get(key).push(issue);
    };

    for (const day of days) {
      const off = new Set();
      for (const r of ptoRows) {
        for (const w of resourceNames(getCell(model, r.id, day)?.text)) {
          const p = resolve(w);
          if (p) off.add(p.id);
        }
      }
      const onDay = new Map(); // person id → [{ row, shift, activity }]
      for (const r of namesRows) {
        const text = getCell(model, r.id, day)?.text;
        if (!text) continue;
        const activity = byId.get(r.parent_id);
        const colour = getCell(model, activity.id, day)?.color || null;
        for (const w of resourceNames(text)) {
          const p = resolve(w);
          if (!p) continue; // not one of ours
          const title = activity.description || activity.activity_id || 'an activity';
          if (!onDay.has(p.id)) onDay.set(p.id, []);
          onDay.get(p.id).push({ row: r, colour, title, name: p.name || w });
          if (off.has(p.id)) {
            add({ row_id: r.id, day, person_id: p.id, name: p.name || w, kind: 'pto', detail: `${p.name || w} is on the PTO row that day` });
          }
          const away = liveLeave.find((l) => l.person_id === p.id
            && String(l.start_date).slice(0, 10) <= day && String(l.end_date).slice(0, 10) >= day);
          if (away) {
            const asked = away.status === 'requested' || away.status === 'pending';
            add({
              row_id: r.id, day, person_id: p.id, name: p.name || w, kind: 'leave',
              detail: `${p.name || w} has ${away.kind || 'leave'} ${asked ? 'requested' : 'booked'} that day`,
            });
          }
        }
      }
      for (const [personId, spots] of onDay) {
        const shifts = new Map();
        for (const s of spots) {
          if (!s.colour || !isShift(s.colour)) continue;
          const which = shiftOf(s.colour);
          if (!shifts.has(which)) shifts.set(which, s);
        }
        if (shifts.size < 2) continue;
        const list = [...shifts.entries()].map(([which, s]) => `${which} on ${s.title}`).join(' and ');
        for (const s of spots) {
          if (!s.colour || !isShift(s.colour)) continue;
          add({ row_id: s.row.id, day, person_id: personId, name: s.name, kind: 'shifts', detail: `${s.name} is on two shifts that day: ${list}` });
        }
      }
    }
    return { issues, byCell };
  }

  Object.defineProperty(__x, "WINDOW_WEEKS", { get: () => WINDOW_WEEKS, enumerable: true });
  Object.defineProperty(__x, "addDaysISO", { get: () => addDaysISO, enumerable: true });
  Object.defineProperty(__x, "mondayOf", { get: () => mondayOf, enumerable: true });
  Object.defineProperty(__x, "windowDays", { get: () => windowDays, enumerable: true });
  Object.defineProperty(__x, "isWeekend", { get: () => isWeekend, enumerable: true });
  Object.defineProperty(__x, "weekdayLetter", { get: () => weekdayLetter, enumerable: true });
  Object.defineProperty(__x, "monthLabel", { get: () => monthLabel, enumerable: true });
  Object.defineProperty(__x, "KINDS", { get: () => KINDS, enumerable: true });
  Object.defineProperty(__x, "FIELDS", { get: () => FIELDS, enumerable: true });
  Object.defineProperty(__x, "blankRow", { get: () => blankRow, enumerable: true });
  Object.defineProperty(__x, "newId", { get: () => newId, enumerable: true });
  Object.defineProperty(__x, "orderedRows", { get: () => orderedRows, enumerable: true });
  Object.defineProperty(__x, "sectionBlock", { get: () => sectionBlock, enumerable: true });
  Object.defineProperty(__x, "rowBlock", { get: () => rowBlock, enumerable: true });
  Object.defineProperty(__x, "sortBetween", { get: () => sortBetween, enumerable: true });
  Object.defineProperty(__x, "needsRespace", { get: () => needsRespace, enumerable: true });
  Object.defineProperty(__x, "respace", { get: () => respace, enumerable: true });
  Object.defineProperty(__x, "rowsWithWork", { get: () => rowsWithWork, enumerable: true });
  Object.defineProperty(__x, "supportTokens", { get: () => supportTokens, enumerable: true });
  Object.defineProperty(__x, "cancelledTokens", { get: () => cancelledTokens, enumerable: true });
  Object.defineProperty(__x, "writeTokens", { get: () => writeTokens, enumerable: true });
  Object.defineProperty(__x, "strikeCodes", { get: () => strikeCodes, enumerable: true });
  Object.defineProperty(__x, "reinstateCodes", { get: () => reinstateCodes, enumerable: true });
  Object.defineProperty(__x, "removedCodes", { get: () => removedCodes, enumerable: true });
  Object.defineProperty(__x, "parseSupport", { get: () => parseSupport, enumerable: true });
  Object.defineProperty(__x, "normaliseSupport", { get: () => normaliseSupport, enumerable: true });
  Object.defineProperty(__x, "supportTotals", { get: () => supportTotals, enumerable: true });
  Object.defineProperty(__x, "describeCounts", { get: () => describeCounts, enumerable: true });
  Object.defineProperty(__x, "cancellationKey", { get: () => cancellationKey, enumerable: true });
  Object.defineProperty(__x, "dayRuns", { get: () => dayRuns, enumerable: true });
  Object.defineProperty(__x, "nameChoices", { get: () => nameChoices, enumerable: true });
  Object.defineProperty(__x, "currentToken", { get: () => currentToken, enumerable: true });
  Object.defineProperty(__x, "suggestNames", { get: () => suggestNames, enumerable: true });
  Object.defineProperty(__x, "acceptName", { get: () => acceptName, enumerable: true });
  Object.defineProperty(__x, "cellKey", { get: () => cellKey, enumerable: true });
  Object.defineProperty(__x, "makeModel", { get: () => makeModel, enumerable: true });
  Object.defineProperty(__x, "cellList", { get: () => cellList, enumerable: true });
  Object.defineProperty(__x, "cleanRow", { get: () => cleanRow, enumerable: true });
  Object.defineProperty(__x, "cleanCell", { get: () => cleanCell, enumerable: true });
  Object.defineProperty(__x, "getCell", { get: () => getCell, enumerable: true });
  Object.defineProperty(__x, "applyOps", { get: () => applyOps, enumerable: true });
  Object.defineProperty(__x, "stamp", { get: () => stamp, enumerable: true });
  Object.defineProperty(__x, "acknowledge", { get: () => acknowledge, enumerable: true });
  Object.defineProperty(__x, "deleteOps", { get: () => deleteOps, enumerable: true });
  Object.defineProperty(__x, "restoreOps", { get: () => restoreOps, enumerable: true });
  Object.defineProperty(__x, "restorePoints", { get: () => restorePoints, enumerable: true });
  Object.defineProperty(__x, "tile", { get: () => tile, enumerable: true });
  Object.defineProperty(__x, "toTSV", { get: () => toTSV, enumerable: true });
  Object.defineProperty(__x, "fromTSV", { get: () => fromTSV, enumerable: true });
  Object.defineProperty(__x, "toHTML", { get: () => toHTML, enumerable: true });
  Object.defineProperty(__x, "colLetters", { get: () => colLetters, enumerable: true });
  Object.defineProperty(__x, "SECTION_BAND", { get: () => SECTION_BAND, enumerable: true });
  Object.defineProperty(__x, "LAYOUT", { get: () => LAYOUT, enumerable: true });
  Object.defineProperty(__x, "gridFromModel", { get: () => gridFromModel, enumerable: true });
  Object.defineProperty(__x, "metaValues", { get: () => metaValues, enumerable: true });
  Object.defineProperty(__x, "modelFromView", { get: () => modelFromView, enumerable: true });
  Object.defineProperty(__x, "cellHistory", { get: () => cellHistory, enumerable: true });
  Object.defineProperty(__x, "rowHistory", { get: () => rowHistory, enumerable: true });
  Object.defineProperty(__x, "describeCellValue", { get: () => describeCellValue, enumerable: true });
  Object.defineProperty(__x, "rowsKnown", { get: () => rowsKnown, enumerable: true });
  Object.defineProperty(__x, "rowTitle", { get: () => rowTitle, enumerable: true });
  Object.defineProperty(__x, "namesDiff", { get: () => namesDiff, enumerable: true });
  Object.defineProperty(__x, "codesDiff", { get: () => codesDiff, enumerable: true });
  Object.defineProperty(__x, "editLines", { get: () => editLines, enumerable: true });
  Object.defineProperty(__x, "editsBehind", { get: () => editsBehind, enumerable: true });
  Object.defineProperty(__x, "editors", { get: () => editors, enumerable: true });
  Object.defineProperty(__x, "staffingIssues", { get: () => staffingIssues, enumerable: true });
};

// core/la_p6.js
__mods["core/la_p6.js"] = function (__x, __req) {
  /**
   * P6 activities for the look-ahead: the schedule's own IDs, read from an
   * extract, searched by name, and what a row's Activity ID says about it.
   *
   * The look-ahead's first column has always been the Activity ID, and the IDs
   * are P6's — typed by hand, when they were typed at all. A row carrying its P6
   * ID can be joined to the schedule and to anything else keyed on it; a row with
   * a typo in it can be joined to nothing, and looks exactly like one that can.
   * So the calendar keeps the schedule's own list (`rc_p6_activities`), imported
   * from whatever extract the scheduler sends, and the editor offers it as the
   * column is typed into.
   *
   * Not every row is in P6. Troubleshooting, a regression run, support for
   * somebody else — real work the schedule does not carry. Those rows say why
   * instead, with a word from a short list (`rc_p6_flags`) written in the same
   * column, so the column always answers one of three ways: a P6 activity, a
   * stated reason, or — marked, never guessed at — neither yet. Several rows may
   * name one activity; one commissioning activity is routinely a week of lines on
   * the sheet.
   *
   * No DOM and no network, so every rule here is tested in Node
   * (`tools/test_la_edit.js`).
   *
   * Imports: nothing (a leaf).
   */

  /* ══════════════════════════════════════════════════════════════════════════
     Reading an extract
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Lower case, accents off, everything that is not a letter or a digit one
   * space — so "(*)Activity ID", "activity_id" and "Activity  ID" are one heading,
   * and "Réglage" is found by typing "reglage".
   */
  function foldP6(text) {
    return String(text ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /**
   * The headings each field answers to, folded, most specific first.
   *
   * P6 names a column after whatever the layout called it, and its own
   * spreadsheet export writes the database names above the labels — `task_code`
   * over "Activity ID", `task_name` over "Activity Name". "Activity Code" is left
   * out on purpose: in P6 an activity code is a classification ("Phase", "Area"),
   * and reading one as the ID would link every row to the wrong thing.
   */
  const HEADINGS = {
    activity_id: [/^activity id$/, /^act(ivity)? (id|no|number)$/, /^task (id|code)$/, /^id$/],
    name: [/^activity name$/, /^act(ivity)? (name|description|title)$/, /^task name$/, /^description$/, /^name$/],
    wbs: [/^wbs$/, /^wbs (code|path|name|id|short name)$/, /^work breakdown/],
  };

  const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

  /** Which column is which: an index per field, or -1. */
  function mapP6Columns(headerRow) {
    const headings = (headerRow || []).map(foldP6);
    const used = new Set();
    /** @type {Object<string, number>} */
    const found = {};
    for (const [field, patterns] of Object.entries(HEADINGS)) {
      found[field] = -1;
      for (const pattern of patterns) {
        const at = headings.findIndex((h, i) => !used.has(i) && pattern.test(h));
        if (at >= 0) {
          found[field] = at;
          used.add(at);
          break;
        }
      }
    }
    return found;
  }

  /**
   * The header is the first row, within the top twenty-five, with both an ID and
   * a name column. P6 puts a title, a filter description and a blank line above
   * its headings, so the first row is rarely the one.
   */
  function findHeader(rows) {
    const limit = Math.min((rows || []).length, 25);
    for (let i = 0; i < limit; i++) {
      const m = mapP6Columns(rows[i]);
      if (m.activity_id >= 0 && m.name >= 0) return i;
    }
    return -1;
  }

  const isIdHeading = (value) => HEADINGS.activity_id.some((p) => p.test(foldP6(value)));

  /**
   * An extract's rows of cells, as activities: `{ activity_id, name, wbs }`.
   *
   * Every activity once, by its ID — the only thing P6 gives that survives a
   * rename. A row with an ID and no name is left out and counted: in a layout
   * exported grouped by WBS those are the group bands, and a P6 activity always
   * has a name. A heading repeated further down (each group's, or the labels P6
   * writes under its field names) is skipped without comment.
   *
   * @returns {{ activities: Array<{ activity_id: string, name: string, wbs: string }>,
   *   headerRow: number, mapping: Object<string, number>, duplicates: string[], unnamed: number,
   *   warnings: string[] }}
   */
  function readP6Rows(rows) {
    const headerRow = findHeader(rows);
    if (headerRow < 0) {
      return {
        activities: [], headerRow, mapping: {}, duplicates: [], unnamed: 0,
        warnings: ['No "Activity ID" and "Activity Name" columns were found in the first 25 rows.'],
      };
    }
    const mapping = mapP6Columns(rows[headerRow]);
    const byId = new Map();
    const duplicates = new Set();
    let unnamed = 0;
    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const id = clean(row[mapping.activity_id]);
      if (!id || isIdHeading(id)) continue;
      const name = clean(row[mapping.name]);
      if (!name) {
        unnamed++;
        continue;
      }
      if (byId.has(id)) {
        duplicates.add(id);
        continue;
      }
      byId.set(id, { activity_id: id, name, wbs: mapping.wbs >= 0 ? clean(row[mapping.wbs]) : '' });
    }
    const warnings = [];
    if (unnamed) {
      warnings.push(`${unnamed} row${unnamed === 1 ? '' : 's'} with an ID and no name ${unnamed === 1 ? 'was' : 'were'} left out — group headings, most likely.`);
    }
    if (duplicates.size) {
      const some = [...duplicates].slice(0, 3).join(', ');
      warnings.push(`${duplicates.size} ID${duplicates.size === 1 ? '' : 's'} appeared more than once (${some}${duplicates.size > 3 ? '…' : ''}); `
        + 'the first of each was kept. An extract of several projects can repeat an ID.');
    }
    return { activities: [...byId.values()], headerRow, mapping, duplicates: [...duplicates], unnamed, warnings };
  }

  /**
   * A delimited text file as rows of cells: commas, semicolons or tabs, whichever
   * the first lines use most, with quoted fields as a spreadsheet writes them.
   */
  function splitTable(text) {
    let s = String(text ?? '');
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    const head = s.split(/\r\n|\n|\r/).slice(0, 30);
    const count = (ch) => head.reduce((n, line) => n + line.split(ch).length - 1, 0);
    // Ties go left to right: a tab is never in a name, a comma often is.
    const delimiter = ['\t', ';', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), '\t');
    const sep = count(delimiter) ? delimiter : ',';

    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c !== '"') field += c;
        else if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else if (c === '"' && field === '') {
        quoted = true;
      } else if (c === sep) {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  /**
   * P6's own export format, a `.xer`: tables of tab-separated records. The
   * activities are the TASK table — `task_code` is the Activity ID, `task_name`
   * its name — and the WBS is written out from PROJWBS as P6 shows its code,
   * every level's short name joined by dots.
   */
  function readXer(text) {
    const tables = new Map();
    let table = null;
    let fields = null;
    for (const line of String(text ?? '').split(/\r\n|\n|\r/)) {
      if (line.startsWith('%T\t')) {
        table = line.slice(3).trim();
        fields = null;
        if (!tables.has(table)) tables.set(table, []);
      } else if (line.startsWith('%F\t')) {
        fields = line.slice(3).split('\t');
      } else if (line.startsWith('%R\t') && table && fields) {
        const values = line.slice(3).split('\t');
        const record = {};
        fields.forEach((f, i) => { record[f] = values[i] ?? ''; });
        tables.get(table).push(record);
      }
    }
    const tasks = tables.get('TASK') || [];
    if (!tasks.length) {
      return {
        activities: [], headerRow: -1, mapping: {}, duplicates: [], unnamed: 0,
        warnings: ['That .xer file has no TASK table, so there are no activities in it.'],
      };
    }
    const wbs = new Map((tables.get('PROJWBS') || []).map((w) => [w.wbs_id, w]));
    const code = (id) => {
      const parts = [];
      const seen = new Set();
      for (let w = wbs.get(id); w && !seen.has(w.wbs_id); w = wbs.get(w.parent_wbs_id)) {
        seen.add(w.wbs_id);
        parts.unshift(w.wbs_short_name || w.wbs_name || '');
      }
      return parts.filter(Boolean).join('.');
    };
    return readP6Rows([
      ['Activity ID', 'Activity Name', 'WBS'],
      ...tasks.map((t) => [t.task_code, t.task_name, code(t.wbs_id)]),
    ]);
  }

  /**
   * A parsed worksheet (`parseSheet()` in `io/lookahead.js`) as rows of cells,
   * each value at its column — the shape `readP6Rows()` reads.
   */
  function gridRows(grid) {
    return (grid?.rows || [])
      .slice()
      .sort((a, b) => a.row - b.row)
      .map((r) => {
        const out = [];
        for (const c of r.cells || []) out[c.col - 1] = c.value;
        return Array.from(out, (v) => v ?? '');
      });
  }

  /** What kind of file an extract is, by its name: 'xlsx', 'xer', 'text', or null. */
  function p6FileKind(name) {
    const n = String(name || '').toLowerCase();
    if (/\.(xlsx|xlsm)$/.test(n)) return 'xlsx';
    if (/\.xer$/.test(n)) return 'xer';
    if (/\.(csv|tsv|txt)$/.test(n)) return 'text';
    return null;
  }

  /**
   * What importing would do to the register, before anything is written:
   * activities new to it, ones whose name or WBS moved, ones a previous extract
   * left out that are back, and ones this extract leaves out — which are marked
   * `missing`, never deleted, because a row of the look-ahead may still name one.
   */
  function p6Diff(register, incoming) {
    const before = new Map((register || []).map((a) => [a.activity_id, a]));
    const present = new Set();
    const added = [];
    const changed = [];
    const back = [];
    let unchanged = 0;
    for (const a of incoming || []) {
      present.add(a.activity_id);
      const was = before.get(a.activity_id);
      if (!was) {
        added.push(a);
        continue;
      }
      if (was.missing) back.push(a);
      if ((was.name || '') !== (a.name || '') || (was.wbs || '') !== (a.wbs || '')) changed.push({ ...a, from: was.name || '' });
      else if (!was.missing) unchanged++;
    }
    const missing = (register || []).filter((a) => !present.has(a.activity_id) && !a.missing);
    return { total: (incoming || []).length, added, changed, back, unchanged, missing };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Finding one
     ═══════════════════════════════════════════════════════════════════════ */

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  /**
   * The activities that fit what was typed, best first.
   *
   * Every word typed has to be somewhere in the ID, the name or the WBS, in any
   * order — "regression ixl" finds "IXL Regression Testing" — and the ID is also
   * read with its punctuation gone, so "cx1040" finds "CX-1040". Then the ID typed
   * whole, an ID starting with it, a name whose words start with every word
   * typed, and the rest; an activity the latest extract left out comes after all
   * of those, and ties go in the ID's own order. Nothing typed finds nothing:
   * fifteen hundred activities in ID order is not an answer.
   */
  function searchP6(entries, query, { limit = 50 } = {}) {
    const q = foldP6(query);
    const terms = q.split(' ').filter(Boolean);
    if (!terms.length) return [];
    const compactQ = q.replace(/ /g, '');
    const scored = [];
    for (const e of entries || []) {
      const id = foldP6(e.activity_id);
      const name = foldP6(e.name);
      const hay = `${id} ${name} ${foldP6(e.wbs)}`;
      const compact = hay.replace(/ /g, '');
      if (!terms.every((t) => hay.includes(t) || compact.includes(t))) continue;
      const idCompact = id.replace(/ /g, '');
      const words = name.split(' ');
      let score = 5;
      if (idCompact === compactQ) score = 0;
      else if (idCompact.startsWith(compactQ)) score = 1;
      else if (terms.every((t) => words.some((w) => w.startsWith(t)))) score = 2;
      else if (idCompact.includes(compactQ)) score = 3;
      else if (name.includes(q)) score = 4;
      if (e.missing) score += 10;
      scored.push({ e, score });
    }
    scored.sort((a, b) => a.score - b.score || collator.compare(a.e.activity_id, b.e.activity_id));
    return scored.slice(0, limit).map((x) => x.e);
  }

  /** The reasons on the list that fit what was typed — every live one when nothing was. */
  function matchFlags(flags, query) {
    const q = foldP6(query);
    return (flags || []).filter((f) => f.active !== false && (!q || foldP6(f.label).includes(q)));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     What a row's Activity ID says
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The register and the reasons, as lookups. An ID is matched exactly, or — when
   * only one activity has it in any case — whatever the case it was typed in;
   * two IDs that differ only in case are both left to the exact match.
   */
  function p6Index(entries = [], flags = []) {
    const byId = new Map();
    const byFold = new Map();
    for (const e of entries || []) {
      byId.set(e.activity_id, e);
      const k = String(e.activity_id).toLowerCase();
      byFold.set(k, byFold.has(k) ? null : e);
    }
    const byFlag = new Map();
    for (const f of flags || []) byFlag.set(String(f.label).trim().toLowerCase(), f);
    return { byId, byFold, flags: byFlag, size: byId.size };
  }

  /**
   * One of four answers about what is written in a row's Activity ID:
   * `linked` (a P6 activity — `entry`), `flagged` (a reason it has none —
   * `flag`), `unknown` (something neither list has), or `empty`.
   */
  function p6Status(value, index) {
    const v = String(value ?? '').trim();
    if (!v) return { kind: 'empty' };
    const entry = index?.byId.get(v) || index?.byFold.get(v.toLowerCase()) || null;
    if (entry) return { kind: 'linked', entry };
    const flag = index?.flags.get(v.toLowerCase()) || null;
    if (flag) return { kind: 'flagged', flag };
    return { kind: 'unknown' };
  }

  /**
   * What to write for what was typed: the register's own spelling of an ID it
   * has, or the list's spelling of a reason — "cx-1040 " is written "CX-1040" —
   * and anything else exactly as typed.
   */
  function p6Canonical(value, index) {
    const status = p6Status(value, index);
    if (status.kind === 'linked') return status.entry.activity_id;
    if (status.kind === 'flagged') return status.flag.label;
    return String(value ?? '').trim();
  }

  /**
   * How the look-ahead's activities stand against the register: how many are
   * linked, flagged, carry something neither list has, or carry nothing — and
   * how many rows name each activity and each reason. Archived rows are off the
   * sheet and are not counted.
   */
  function p6Coverage(rows, index) {
    const out = { activities: 0, linked: 0, flagged: 0, unknown: 0, empty: 0, uses: new Map(), byFlag: new Map() };
    for (const r of rows || []) {
      if (r.kind !== 'activity' || r.archived) continue;
      out.activities++;
      const status = p6Status(r.activity_id, index);
      out[status.kind]++;
      if (status.kind === 'linked') {
        const id = status.entry.activity_id;
        out.uses.set(id, (out.uses.get(id) || 0) + 1);
      } else if (status.kind === 'flagged') {
        const label = status.flag.label;
        out.byFlag.set(label, (out.byFlag.get(label) || 0) + 1);
      }
    }
    return out;
  }

  Object.defineProperty(__x, "foldP6", { get: () => foldP6, enumerable: true });
  Object.defineProperty(__x, "mapP6Columns", { get: () => mapP6Columns, enumerable: true });
  Object.defineProperty(__x, "readP6Rows", { get: () => readP6Rows, enumerable: true });
  Object.defineProperty(__x, "splitTable", { get: () => splitTable, enumerable: true });
  Object.defineProperty(__x, "readXer", { get: () => readXer, enumerable: true });
  Object.defineProperty(__x, "gridRows", { get: () => gridRows, enumerable: true });
  Object.defineProperty(__x, "p6FileKind", { get: () => p6FileKind, enumerable: true });
  Object.defineProperty(__x, "p6Diff", { get: () => p6Diff, enumerable: true });
  Object.defineProperty(__x, "searchP6", { get: () => searchP6, enumerable: true });
  Object.defineProperty(__x, "matchFlags", { get: () => matchFlags, enumerable: true });
  Object.defineProperty(__x, "p6Index", { get: () => p6Index, enumerable: true });
  Object.defineProperty(__x, "p6Status", { get: () => p6Status, enumerable: true });
  Object.defineProperty(__x, "p6Canonical", { get: () => p6Canonical, enumerable: true });
  Object.defineProperty(__x, "p6Coverage", { get: () => p6Coverage, enumerable: true });
};

// ui/rc_la_state.js
__mods["ui/rc_la_state.js"] = function (__x, __req) {
  /**
   * What the look-ahead tab is showing, shared by its sections.
   *
   * The tab was one 2,400-line module, and its sections reached into each other's
   * `let`s — "Show cells" in the cancellation log set the calendar's filter and
   * section directly. Split into a module per section, that state lives here as
   * one object, because an ES module cannot reassign another's binding and the
   * linker forbids `export let` anyway. Also the one table helper they share.
   *
   * Imports: util.
   */

  const { el } = __req("core/util.js");

  const la = {
    /** Which section is on screen. */
    section: 'calendar',
    /** Free text filter on the calendar, kept across a redraw of the section. */
    calendarFilter: '',
    /**
     * One row the calendar is narrowed to — "Show cells" in the cancellation log:
     * the editor's row id where the reading carries one, and the row's words
     * (`raw_label`) where it does not. Null is every row.
     * @type {{ id: string | null, label: string } | null}
     */
    calendarRow: null,
    /**
     * Whether rows nobody highlighted are drawn. Off by default: most of the sheet
     * is activities carried for reference with nothing scheduled against them.
     */
    showQuietRows: false,
    /** Whether the names on each activity's Resource row are drawn. */
    showResources: true,
    /** How much of the calendar to show, in weeks from `calendarStart`; 0 is everything. */
    calendarWeeks: 4,
    /** The Monday the calendar's window starts on, paged a week at a time; null is this week's. */
    calendarStart: null,
    /** 'workbook' until the look-ahead is written in the calendar, then 'editor'. */
    source: 'workbook',
    /**
     * Whether the calendar is switched to editing. The editor used to be a
     * section of its own, drawing the same four weeks as the calendar beside it;
     * it is the calendar's Edit switch now, an administrator's, off by default.
     */
    editing: false,
    /** Whether somebody picked a section, so the tab stops choosing one for them. */
    sectionChosen: false,
    /** How many weeks the editor shows: four, or five to see one more ahead. */
    editorWeeks: 4,
    /** Whether the Excel export carries the names rows and the PTO / Office / Other rows. */
    exportResources: true,
    /**
     * Only the rows that name the person looking. Null until somebody chooses:
     * then it is on for the team and off for an administrator, who is usually
     * reading the whole sheet.
     */
    onlyMine: null,
    /** Whose choice `onlyMine` is. */
    onlyMineFor: null,
  };

  const WEEK_CHOICES = [
    { weeks: 2, label: '2 weeks' },
    { weeks: 3, label: '3 weeks' },
    { weeks: 4, label: '4 weeks' },
    { weeks: 5, label: '5 weeks' },
    { weeks: 0, label: 'Everything' },
  ];

  /* ── Shared ────────────────────────────────────────────────────────────── */

  function table(headers, rows) {
    return el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table' }, [
        el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { text: h })))]),
        el('tbody', {}, rows),
      ]),
    ]);
  }

  Object.defineProperty(__x, "la", { get: () => la, enumerable: true });
  Object.defineProperty(__x, "WEEK_CHOICES", { get: () => WEEK_CHOICES, enumerable: true });
  Object.defineProperty(__x, "table", { get: () => table, enumerable: true });
};

// core/la_register.js
__mods["core/la_register.js"] = function (__x, __req) {
  /**
   * The register: the rows a reading of the look-ahead is stored as, and the
   * changes between two readings.
   *
   * The look-ahead is the contractual source of truth and the resource calendar
   * is the execution record; the difference between two snapshots is what a
   * delay claim is eventually built from. So the rules here are about being
   * *honest* rather than clever — the system logs what it can see and asks a
   * person about what it cannot.
   *
   * Two rules do most of the work, and both exist because the obvious version
   * produces numbers that flatter or damn the wrong party.
   *
   * **Only weeks in both snapshots are compared.** A four-week window rolls
   * forward, so a week appearing at the far edge is not scope being added and a
   * week dropping off the back is not scope being removed. Counting them as such
   * would book a batch of phantom additions every single week, and would count
   * finished work as deleted scope — inflating exactly the number you would most
   * want to defend.
   *
   * **A crew moving site is not inferred.** When work finishes early and a team
   * moves, one row disappears and another appears with the same resources. The
   * activity text is not reliable enough to match on — the spec says so and it is
   * right — so it is logged honestly as a removal and an addition, and a person
   * can relink the pair afterwards. Guessing would be the one failure mode
   * nobody could audit.
   *
   * Reading a sheet — its grid, its marks, who it names, what it offers the
   * timeline — is `core/lookahead.js`, which all three bundles carry. This is the
   * part only the calendar does, so it lives in calendar.bundle.js and the
   * timeline's and the phone's pages never download it.
   *
   * Imports: core/lookahead.
   */
  const { resourceNames, locationColumnOf, isCancelMeaning } = __req("core/lookahead.js");

  /** The Monday of an ISO date's week, in UTC. A calendar date must not shift. */
  function mondayOf(iso) {
    const ms = Date.parse(`${iso}T00:00:00Z`);
    const back = (new Date(ms).getUTCDay() + 6) % 7;
    return new Date(ms - back * 86400000).toISOString().slice(0, 10);
  }

  /**
   * Stored days whose look-ahead row now names somebody else.
   *
   * The 4WLA's Resource row is the plan for the days it names, so a stored
   * `rc_plan_entries` row carrying a `lookahead_row_id` is somebody having
   * confirmed or overridden what that row said. When a later read of the sheet
   * puts a different name on the same row for the same day, the work has moved —
   * and until this existed the entry stayed against whoever it was first written
   * for. The visible cost is somebody turning up for a shift that is not theirs
   * any more while the person who now has it has a blank against their name.
   *
   * `resolve` is the name lookup, **injected** for the reason `rowsFrom()` takes
   * `locate`: the register lives two layers up, this module is a leaf, and the
   * whole pipeline has to be testable with no browser and no network. It answers
   * a person id for a written name, or null.
   *
   * Returns `[{ entry, from, to }]`, and returns nothing at all unless it is
   * certain:
   *
   * **The row has to say something about that day.** A day the sheet no longer
   * names anybody on is not a reassignment — it is the sheet going quiet, which
   * happens whenever an activity is rescheduled, and moving a task to nobody is
   * not a thing that can be written.
   *
   * **It has to name exactly one person the roster knows.** Two names on a day is
   * a crew, and a crew is not "this task moved to Victor" — it is several entries,
   * which is a decision somebody takes rather than one this can derive. An
   * unmatched spelling stops it too: those are reported and answered with an
   * alias, and guessing here would be the near-miss matching the register refuses.
   *
   * **It has to be somebody else.** A re-read that changed nothing must produce
   * nothing, or every ingest would supersede every linked entry with a revision
   * saying the same thing. `rc_reassign_plan()` refuses that case as well, so it
   * is checked on both sides on purpose.
   */
  function reassignments({ planRows, laRows, resolve }) {
    const byRow = new Map();
    for (const row of laRows || []) {
      if (row?.id) byRow.set(row.id, row);
    }

    const out = [];
    for (const entry of planRows || []) {
      if (!entry?.id || !entry.lookahead_row_id) continue;
      const row = byRow.get(entry.lookahead_row_id);
      if (!row) continue;
      const written = resourceNames(row.resources?.[entry.work_date] || '');
      if (!written.length) continue;

      const ids = new Set();
      let unknown = false;
      for (const name of written) {
        const id = resolve ? resolve(name) : null;
        if (id) ids.add(id);
        else unknown = true;
      }
      // One person, and every name on the day accounted for. Anything else is a
      // crew or a spelling nobody has mapped, and neither is a move.
      if (unknown || ids.size !== 1) continue;
      const [to] = [...ids];
      if (to === entry.person_id) continue;
      out.push({ entry, from: entry.person_id, to });
    }
    return out;
  }

  /* ── Row identity ──────────────────────────────────────────────────────── */

  /**
   * A key for a row that survives the file being edited.
   *
   * The look-ahead has no activity IDs — no P6 numbers, nothing stable — and its
   * descriptions are not matchable. Location, week and subsystem are what remain,
   * plus an ordinal to separate two rows that share all three.
   *
   * The ordinal is the weak part, and knowingly so: inserting a row in the middle
   * of a group shifts everything below it and produces a false removed/added
   * pair. That is tolerable only because the manual relink exists to fix it, and
   * because the alternative — matching on text — would produce *wrong* answers
   * rather than noisy ones.
   */
  function rowKey({ weekStart, location, subsystem = '', ordinal = 0 }) {
    return [weekStart, String(location || '').trim(), String(subsystem || '').trim(), ordinal].join('|');
  }

  /** Assign ordinals within each (week, location, subsystem) group. */
  function keyRows(rows) {
    const seen = new Map();
    return rows.map((row) => {
      const group = [row.weekStart, row.location, row.subsystem || ''].join('|');
      const ordinal = seen.get(group) || 0;
      seen.set(group, ordinal + 1);
      return { ...row, rowKey: rowKey({ ...row, ordinal }) };
    });
  }

  /**
   * A read grid, as rows something else can point at.
   *
   * One row per activity per *week*, because that is the grain the look-ahead is
   * maintained at and the grain a plan is made at. Two rules, both of which hold
   * everywhere else in this module:
   *
   * **The location is read from the column the sheet keeps it in, and kept
   * whether or not it resolves.** `locationColumnOf()` finds that column by its
   * heading; `locate` — the alias register, injected so this stays testable
   * without a network — turns the spelling into an id where it knows it. Nothing
   * is matched on the description: the wording differs on the two sides and is
   * not reliable enough to carry evidence, which is what the alias list is for.
   *
   * The text surviving an unresolved spelling is the part that was missing. The
   * location used to be recorded *only* where the register already knew it, so a
   * column full of "W30" and "Y10" was discarded on every deployment that had not
   * registered them — and with nothing kept there was nothing for anybody to map,
   * which is the one state this module is built to make impossible. An unresolved
   * spelling is exactly like an unmapped colour or an unmatched name: shown, and
   * one click from being answered.
   *
   * **A row with nothing scheduled that week is not a row.** The sheet carries
   * activities for reference with no shift against them, and writing those would
   * make the register mostly noise — and, worse, make every one of them look
   * like scope the first time it *did* get a shift.
   *
   * @param {object} view
   * @param {{ snapshotId?: string | null, locate?: (raw: string) => Promise<string | null>, locationColumn?: number | null }} [options]
   */
  async function rowsFrom(view, {
    snapshotId = null, locate = async () => null, locationColumn = null,
  } = {}) {
    if (!view?.days?.length) return [];

    // Told which column, or read off the sheet's own heading. `null` is "work it
    // out"; `-1` is "there is no heading", which is the register scan below.
    const locCol = Number.isInteger(locationColumn) ? locationColumn : locationColumnOf(view);

    const dayByCol = new Map(view.days.map((d) => [d.col, d]));
    const out = [];
    const ordinals = new Map();

    for (const activity of view.activities) {
      if (activity.heading) continue;
      /* Not work, so not a row. Emitting one would put "PTO" in the register as an
         activity at no location, and `classify()` would then book it as scope
         added the first week it appeared and scope removed the week it did not. */
      if (activity.absence) continue;

      // Group this activity's marks by the week they fall in.
      const weeks = new Map();
      const bucketFor = (date) => {
        const week = mondayOf(date);
        if (!weeks.has(week)) weeks.set(week, { cells: {}, marks: {}, resources: {} });
        return weeks.get(week);
      };
      for (const mark of activity.marks) {
        if (!mark.hex || mark.role === 'ignore') continue;
        const day = dayByCol.get(mark.col);
        if (!day?.date) continue;
        const bucket = bucketFor(day.date);
        bucket.cells[day.date] = mark.meaning || `#${mark.hex}`;
        if (mark.value) bucket.marks[day.date] = mark.value;
      }
      /* The Resource row's own paint, which the workbook sometimes uses for the
         shift instead of the activity line. It fills a day the activity line left
         unpainted and never overrides one — the activity line is what the day *is*.
         And it never says a day was cancelled: red on a Resource row is somebody
         marking the names, not the work, so a cancellation colour there — or a
         colour nobody has named, which might turn out to be one — is left out of
         `cells` entirely, and with it out of `rc_cancelled_days`. */
      for (const mark of activity.resource?.marks || []) {
        if (!mark.hex || mark.role === 'ignore' || !mark.meaning || isCancelMeaning(mark.meaning)) continue;
        const day = dayByCol.get(mark.col);
        if (!day?.date) continue;
        const bucket = bucketFor(day.date);
        if (!(day.date in bucket.cells)) bucket.cells[day.date] = mark.meaning;
      }
      if (!weeks.size) continue;

      /* Who the Resource row names, per day, in the words the workbook used.
         Only into weeks that already have a shift in them: a name typed against a
         day nobody is scheduled on is the same kind of stray as a colour on an
         empty row, and writing it would invent a week of scope. Nothing is
         matched to a person here — that happens against the roster, where an
         unmatched name can be shown to somebody rather than guessed at. */
      for (const mark of activity.resource?.marks || []) {
        if (!mark.value) continue;
        const day = dayByCol.get(mark.col);
        const week = day?.date ? mondayOf(day.date) : null;
        if (!week || !weeks.has(week)) continue;
        weeks.get(week).resources[day.date] = mark.value;
      }

      /* Where the work is, from the column the sheet keeps it in.
         **The text is kept whether or not it resolves.** It used to be recorded
         only when the alias register already knew it, so a location column full of
         "W30" and "Y10" was *discarded* on a deployment that had not registered
         them yet — and with nothing kept there was nothing for anybody to map,
         which is the one state this design is supposed to make impossible. An
         unresolved spelling is exactly like an unmapped colour or an unmatched
         name: shown, and one click from being answered. */
      let locationId = null;
      let rawLocation = null;
      if (locCol >= 0) {
        rawLocation = activity.meta[locCol] || null;
        locationId = rawLocation ? await locate(rawLocation) : null;
      } else {
        // Nobody has said which column it is, so the register decides: the first
        // cell it recognises is the location. Still never the *description* —
        // that is matched on nothing, here or anywhere else in this module.
        for (const value of activity.meta) {
          const hit = await locate(value);
          if (hit) { locationId = hit; rawLocation = value; break; }
        }
      }
      const label = activity.meta.filter(Boolean).join(' · ');

      for (const [week, bucket] of weeks) {
        const groupKey = [week, rawLocation || '', ''].join('|');
        const ordinal = ordinals.get(groupKey) || 0;
        ordinals.set(groupKey, ordinal + 1);
        out.push({
          snapshot_id: snapshotId,
          week_start: week,
          sheet_row: activity.row,
          row_key: rowKey({ weekStart: week, location: rawLocation || '', subsystem: '', ordinal }),
          /* The editor's id for the activity, when the reading was published from
             the editor; null for a workbook read. `row_key` is still written —
             links made before ids existed point at it — but two readings that
             both carry ids are compared on the id, so a row inserted mid-group
             no longer shifts the ones under it into a removal and an addition. */
          la_row_id: activity.id || null,
          location_id: locationId,
          raw_location: rawLocation,
          raw_label: label,
          cells: bucket.cells,
          bart_marks: bucket.marks,
          resources: bucket.resources,
        });
      }
    }

    return out;
  }

  /* ── The window ────────────────────────────────────────────────────────── */

  /**
   * The weeks a snapshot actually covers, read from the snapshot itself.
   *
   * Deliberately not a constant. The spec calls it a four-week look-ahead and
   * says it is maintained four to six weeks out, so a hard-coded 4 would
   * misclassify the sixth week every time it appeared.
   */
  function windowOf(rows) {
    const weeks = [...new Set(rows.map((r) => r.weekStart))].sort();
    return { weeks, first: weeks[0] || null, last: weeks[weeks.length - 1] || null };
  }

  /* ── Comparing ─────────────────────────────────────────────────────────── */

  /**
   * Classify the difference between two keyed snapshots.
   *
   * `before` and `after` are arrays of `{ rowKey, weekStart, location, subsystem,
   * label, cells, marks }`, where `cells` maps a date to a shift meaning and
   * `marks` holds BART's own resource requests.
   *
   * Returns a list of `{ kind, weekStart, rowKey, before, after }`.
   *
   * **A read that started recording the location is not a read where everything
   * moved.** The row key is built from the week and the location, so the first read
   * after the location began coming off the sheet's own column — rather than only
   * where the alias register already knew the spelling — keys every row
   * differently. Compared naively that is every row removed and every row added:
   * a batch of phantom scope on the one screen somebody reads a year later, booked
   * into the KPIs, over a change that is about the *keying* and not the work. It is
   * the same judgement the window rule makes, and drawn as narrowly as it can be —
   * one side recording no location at all, the other recording one, and not a
   * single key in common. A crew genuinely moving site is still a removal and an
   * addition, which is what `relinkCandidates()` is for.
   */
  function classify(before, after, { cancelledMeaning = 'cancelled' } = {}) {
    const beforeWindow = windowOf(before);
    const afterWindow = windowOf(after);

    /* **Two readings that both carry the editor's ids are compared on them.**
       A row is then the same row wherever it sits and whatever it says, so
       inserting one mid-group no longer turns every row under it into a removal
       and an addition, and an activity moved to another site is one event rather
       than two. Only when *every* row on both sides has an id: the first reading
       published after ids began is compared with one that had none, and mixing
       the two keyings would book every row as moved. That one comparison goes by
       position, as every comparison did before. */
    const byId = before.length > 0 && after.length > 0
      && before.every((r) => r.rowId) && after.every((r) => r.rowId);
    const keyOf = byId ? (r) => `${r.weekStart}|id:${r.rowId}` : (r) => r.rowKey;

    if (!byId && before.length && after.length) {
      const keys = new Set(after.map((r) => r.rowKey));
      const located = (rows) => rows.filter((r) => String(r.location || '').trim()).length;
      const sided = located(before) === 0 !== (located(after) === 0);
      if (sided && !before.some((r) => keys.has(r.rowKey))) return [];
    }

    // Only weeks present on both sides can be compared at all. Everything else
    // is the window moving, which is recorded and kept out of the KPIs.
    const shared = new Set(beforeWindow.weeks.filter((w) => afterWindow.weeks.includes(w)));

    const events = [];
    const beforeByKey = new Map(before.map((r) => [keyOf(r), r]));
    const afterByKey = new Map(after.map((r) => [keyOf(r), r]));
    const idOf = (r) => r.rowId || null;

    /* Weeks entering and leaving the window. Not scope, and named so. */
    for (const week of afterWindow.weeks) {
      if (!beforeWindow.weeks.includes(week)) {
        events.push({ kind: 'window_advanced', weekStart: week, rowKey: null, before: null, after: null });
      }
    }
    for (const week of beforeWindow.weeks) {
      if (!afterWindow.weeks.includes(week)) {
        events.push({ kind: 'window_retired', weekStart: week, rowKey: null, before: null, after: null });
      }
    }

    /* Rows added to, and removed from, a week that was already in view. */
    for (const row of after) {
      if (!shared.has(row.weekStart)) continue;
      if (!beforeByKey.has(keyOf(row))) {
        events.push({ kind: 'scope_added', weekStart: row.weekStart, rowKey: row.rowKey, rowId: idOf(row), before: null, after: row });
      }
    }
    for (const row of before) {
      if (!shared.has(row.weekStart)) continue;
      if (!afterByKey.has(keyOf(row))) {
        events.push({ kind: 'scope_removed', weekStart: row.weekStart, rowKey: row.rowKey, rowId: idOf(row), before: row, after: null });
      }
    }

    /* What an activity says about itself, once per activity rather than once per
       week it spans. Only visible when rows are matched on their ids: matched by
       position, a row whose location changed was a different row, and a changed
       description was never compared at all. */
    const described = new Set();

    /* Rows present on both sides: what changed inside them. */
    for (const row of after) {
      const prior = beforeByKey.get(keyOf(row));
      if (!prior || !shared.has(row.weekStart)) continue;
      const rowId = idOf(row);

      if (byId && !described.has(rowId)) {
        described.add(rowId);
        const where = (r) => String(r.location || '').trim();
        if (where(prior) !== where(row)) {
          events.push({ kind: 'location_shift', weekStart: row.weekStart, rowKey: row.rowKey, rowId, before: prior, after: row });
        } else if (String(prior.label || '') !== String(row.label || '')) {
          events.push({ kind: 'details_changed', weekStart: row.weekStart, rowKey: row.rowKey, rowId, before: prior, after: row });
        }
      }

      const dates = [...new Set([...Object.keys(prior.cells || {}), ...Object.keys(row.cells || {})])].sort();
      for (const date of dates) {
        const was = (prior.cells || {})[date] || null;
        const now = (row.cells || {})[date] || null;
        if (was === now) continue;

        // A shift turning red is a cancellation, and the colour alone cannot say
        // whose. Whoever reviews it is asked; nothing is assumed.
        const kind = now === cancelledMeaning && was && was !== cancelledMeaning
          ? 'cancellation'
          : 'shift_changed';

        events.push({
          kind,
          weekStart: row.weekStart,
          rowKey: row.rowKey,
          rowId,
          date,
          before: was,
          after: now,
          needsResponsibility: kind === 'cancellation',
        });
      }

      // BART's own resource marks — an EIC added to an otherwise unchanged
      // shift. The shift did not move, and the request still changed, so it is
      // logged rather than folded into the row above.
      const marksBefore = JSON.stringify(prior.marks || {});
      const marksAfter = JSON.stringify(row.marks || {});
      if (marksBefore !== marksAfter) {
        events.push({
          kind: 'resource_changed',
          field: 'marks',
          weekStart: row.weekStart,
          rowKey: row.rowKey,
          rowId,
          before: prior.marks || {},
          after: row.marks || {},
        });
      }

      /* And the Resource row underneath: who is on it.
         The same kind as a mark changing rather than a kind of its own, because
         it is the same fact — the request against this activity moved without the
         shift moving — and a new kind would need the `rc_change_events` check
         constraint widened in every project that already has one. `field` is what
         tells the two apart when somebody reads the row back. */
      const whoBefore = JSON.stringify(prior.resources || {});
      const whoAfter = JSON.stringify(row.resources || {});
      if (whoBefore !== whoAfter) {
        events.push({
          kind: 'resource_changed',
          field: 'resources',
          weekStart: row.weekStart,
          rowKey: row.rowKey,
          rowId,
          before: prior.resources || {},
          after: row.resources || {},
        });
      }
    }

    return events;
  }

  /**
   * Removals and additions in the same week that could be one crew moving site.
   *
   * Only ever a *suggestion*, surfaced for somebody to confirm. Work finishing
   * early at one location and starting at another is not a cancellation, but the
   * only evidence is that the same BART resources appear on both — and the
   * activity text, which cannot be trusted. So the pairing is a human judgement
   * by design, and the system's job is to make it easy rather than to guess.
   */
  function relinkCandidates(events) {
    const removed = events.filter((e) => e.kind === 'scope_removed');
    const added = events.filter((e) => e.kind === 'scope_added');
    const out = [];

    for (const gone of removed) {
      for (const arrived of added) {
        if (gone.weekStart !== arrived.weekStart) continue;
        const a = JSON.stringify(gone.before?.marks || {});
        const b = JSON.stringify(arrived.after?.marks || {});
        if (a !== '{}' && a === b) {
          out.push({ removed: gone, added: arrived, because: 'the same resources were requested' });
        }
      }
    }
    return out;
  }

  /**
   * Which events count toward the change KPIs.
   *
   * The window moving is real and recorded, and it is not a change of scope.
   * Keeping the two apart is what stops the scope-added figure being meaningless
   * within a month.
   */
  const KPI_KINDS = ['scope_added', 'scope_removed', 'cancellation', 'resource_changed', 'shift_changed'];

  function countable(events) {
    return events.filter((e) => KPI_KINDS.includes(e.kind));
  }

  /** A short, plain description of an event, for the change log. */
  /**
   * One line saying what an event was.
   *
   * Reads the *stored* shape: `before` and `after` are jsonb, because the table
   * has no column for a date and a row-level change needs one. `sideOf()` in
   * `ui/rc_lookahead.js` is what writes them, and the two have to agree — a
   * mismatch here shows up as "undefined → undefined" on the one screen somebody
   * reads a year later.
   */
  function describe(event) {
    const day = event.date || event.after?.date || event.before?.date || 'a day';
    switch (event.kind) {
      case 'scope_added': return `Added: ${event.after?.label || event.rowKey}`;
      case 'scope_removed': return `Removed: ${event.before?.label || event.rowKey}`;
      case 'cancellation': return `Cancelled on ${day}: was ${event.before?.value ?? event.before}`;
      case 'shift_changed':
        return `${day}: ${event.before?.value || 'nothing'} → ${event.after?.value || 'nothing'}`;
      case 'resource_changed': {
        /* The *stored* shape decides which of the two this was: `sideOf()` writes
           `{ resources }` for the Resource row and `{ marks }` for a mark on the
           activity line. A row written before Resource rows existed carries only
           the latter, and it still prints the sentence it always did rather than
           "undefined → undefined" on the one screen somebody reads a year later. */
        const who = (side) => {
          const map = side?.resources;
          if (!map || typeof map !== 'object') return null;
          return [...new Set(Object.values(map).flatMap((v) => resourceNames(v)))].join(', ');
        };
        const was = who(event.before);
        const now = who(event.after);
        if (was === null && now === null) return 'BART resource request changed';
        return `Resource: ${was || 'nobody'} → ${now || 'nobody'}`;
      }
      case 'window_advanced': return `Week ${event.weekStart} came into the window`;
      case 'window_retired': return `Week ${event.weekStart} left the window`;
      case 'location_shift':
        // Matched on the editor's id, the row itself says where it went. Linked
        // by hand from a removal and an addition, it does not.
        if (event.before?.location !== undefined || event.after?.location !== undefined) {
          return `${event.after?.label || event.before?.label || 'Activity'}: moved from `
            + `${event.before?.location || 'no location'} to ${event.after?.location || 'no location'}`;
        }
        return 'Relinked as one crew moving site';
      case 'details_changed':
        return `Details: ${event.before?.label || 'nothing'} → ${event.after?.label || 'nothing'}`;
      default: return event.kind;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     What changed for me

     Somebody on the team opens the calendar and wants to know one thing before
     anything else: has my week moved since I last looked? This compares two
     readings of the look-ahead — the one they last said "got it" to, and the
     latest — for the days that name them, and says what happened in the words a
     person would use: a day added, a day taken away, a day moved, a day given
     to somebody else, a day cancelled, a shift changed.

     Both sides come from the stored rows (`rc_lookahead_rows`), which are never
     compacted, so an old reading can always be compared. A reading is a complete
     statement of the weeks it covers, so each side is one reading, whole.
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The days a set of stored rows names somebody on, between `from` and `to`
   * (ISO, inclusive): a map of `date|label` → `{ date, label, location, meaning,
   * cancelled }`.
   */
  function myLookaheadDays(rows, isMe, { from = null, to = null } = {}) {
    const out = new Map();
    for (const row of rows || []) {
      for (const [date, text] of Object.entries(row.resources || {})) {
        const day = String(date).slice(0, 10);
        if ((from && day < from) || (to && day > to)) continue;
        if (!resourceNames(text).some((n) => isMe(n))) continue;
        const meaning = row.cells?.[day] || row.cells?.[date] || '';
        out.set(`${day}|${row.raw_label || ''}`, {
          date: day,
          label: row.raw_label || '',
          location: row.raw_location || '',
          meaning,
          cancelled: isCancelMeaning(meaning),
        });
      }
    }
    return out;
  }

  /** How far apart a removed and an added day of one activity may be and still be one day moved. */
  const MOVED_WITHIN_DAYS = 14;

  /**
   * What changed between two readings for the days that name this person:
   * `[{ kind, date, label, location, from?, was?, now?, names? }]`, by date.
   *
   *   added      named on a day they were not before
   *   removed    no longer named on a day they were, and nobody else took it
   *   given      no longer named, and the row names somebody else that day
   *   moved      removed from one day and added to another of the same activity
   *   cancelled  still named, and the day is now painted as a cancellation
   *   reinstated a day that was cancelled is back on
   *   shift      still named, and the day is painted as a different shift
   */
  function changesForMe(beforeRows, afterRows, isMe, { from = null, to = null } = {}) {
    const before = myLookaheadDays(beforeRows, isMe, { from, to });
    const after = myLookaheadDays(afterRows, isMe, { from, to });
    const afterRow = new Map();
    for (const row of afterRows || []) {
      for (const date of new Set([...Object.keys(row.resources || {}), ...Object.keys(row.cells || {})])) {
        afterRow.set(`${String(date).slice(0, 10)}|${row.raw_label || ''}`, row);
      }
    }

    const added = [...after.entries()].filter(([k]) => !before.has(k)).map(([, v]) => v);
    const removed = [...before.entries()].filter(([k]) => !after.has(k)).map(([, v]) => v);
    const out = [];

    /* A day taken off and another of the same activity put on, close together,
       is one day moved — nearest first, each day used once. */
    const usedAdded = new Set();
    const stillRemoved = [];
    for (const r of removed.sort((a, b) => a.date.localeCompare(b.date))) {
      /** @type {number | null} */
      let best = null;
      let bestGap = Infinity;
      added.forEach((a, i) => {
        if (usedAdded.has(i) || a.label !== r.label) return;
        const gap = Math.abs(Date.parse(`${a.date}T00:00:00Z`) - Date.parse(`${r.date}T00:00:00Z`)) / 86400000;
        if (gap <= MOVED_WITHIN_DAYS && gap < bestGap) { best = i; bestGap = gap; }
      });
      if (best == null) { stillRemoved.push(r); continue; }
      usedAdded.add(best);
      const a = added[best];
      out.push({ kind: 'moved', date: a.date, from: r.date, label: a.label, location: a.location, now: a.meaning, was: r.meaning });
    }

    added.forEach((a, i) => {
      if (!usedAdded.has(i)) out.push({ kind: 'added', date: a.date, label: a.label, location: a.location, now: a.meaning });
    });
    for (const r of stillRemoved) {
      const row = afterRow.get(`${r.date}|${r.label}`);
      const names = resourceNames(row?.resources?.[r.date] || '').filter((n) => !isMe(n));
      if (names.length) out.push({ kind: 'given', date: r.date, label: r.label, location: r.location, names });
      else out.push({ kind: 'removed', date: r.date, label: r.label, location: r.location, was: r.meaning });
    }
    for (const [k, now] of after) {
      const was = before.get(k);
      if (!was) continue;
      if (now.cancelled && !was.cancelled) {
        out.push({ kind: 'cancelled', date: now.date, label: now.label, location: now.location, was: was.meaning });
      } else if (was.cancelled && !now.cancelled) {
        out.push({ kind: 'reinstated', date: now.date, label: now.label, location: now.location, now: now.meaning });
      } else if (!now.cancelled && now.meaning !== was.meaning && now.meaning && was.meaning) {
        out.push({ kind: 'shift', date: now.date, label: now.label, location: now.location, was: was.meaning, now: now.meaning });
      }
    }

    return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
  }

  Object.defineProperty(__x, "reassignments", { get: () => reassignments, enumerable: true });
  Object.defineProperty(__x, "rowKey", { get: () => rowKey, enumerable: true });
  Object.defineProperty(__x, "keyRows", { get: () => keyRows, enumerable: true });
  Object.defineProperty(__x, "rowsFrom", { get: () => rowsFrom, enumerable: true });
  Object.defineProperty(__x, "windowOf", { get: () => windowOf, enumerable: true });
  Object.defineProperty(__x, "classify", { get: () => classify, enumerable: true });
  Object.defineProperty(__x, "relinkCandidates", { get: () => relinkCandidates, enumerable: true });
  Object.defineProperty(__x, "KPI_KINDS", { get: () => KPI_KINDS, enumerable: true });
  Object.defineProperty(__x, "countable", { get: () => countable, enumerable: true });
  Object.defineProperty(__x, "describe", { get: () => describe, enumerable: true });
  Object.defineProperty(__x, "myLookaheadDays", { get: () => myLookaheadDays, enumerable: true });
  Object.defineProperty(__x, "changesForMe", { get: () => changesForMe, enumerable: true });
};

// ui/rc_ingest.js
__mods["ui/rc_ingest.js"] = function (__x, __req) {
  /**
   * Reading the look-ahead workbook into the calendar: snapshot, rows, changes.
   *
   * Split out of `ui/rc_lookahead.js` so every section that needs "Check now" can
   * have it without importing the tab that draws them.
   *
   * Imports: util, rc, filestore, io/lookahead, core/lookahead, icons,
   *          components, rc_util.
   */

  const { el } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const filestore = __req("core/filestore.js");
  const { parseSheet, applyLegend, readLegend } = __req("io/lookahead.js");
  const { readGrid } = __req("core/lookahead.js");
  const { classify, countable, rowsFrom } = __req("core/la_register.js");
  const { icon } = __req("ui/icons.js");
  const { toast } = __req("ui/components.js");
  const { notifyChanged, todayISO } = __req("ui/rc_util.js");

  const { la } = __req("ui/rc_la_state.js");
  const { gridFromModel, windowDays, addDaysISO, mondayOf, SECTION_BAND, makeModel, cleanRow, cleanCell } = __req("core/la_edit.js");


  const { hash64 } = __req("core/folder_rules.js");

  /** Where the workbook lives, relative to the folder the plan is in. */
  const LOOKAHEAD_DIR = 'lookahead';

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
   *
   * @param {{ sheetName?: string, legend?: any[], silent?: boolean }} [options]
   */
  async function ingest({ sheetName, legend, silent = false } = {}) {
    /* Once the look-ahead is written in the calendar, the workbook is the old
       copy: reading it again would overwrite a week of edits with whatever the
       file said when it was archived. */
    if ((await lookaheadSource()) === EDITOR_SOURCE) {
      throw new Error('The look-ahead is written in the calendar now, so the workbook is no longer read. '
        + 'Edit it under Look-ahead → Editor, and use Export to Excel for a copy.');
    }

    /* Neither of these is a constant any more. The tab gets renamed by whoever
       maintains the workbook, and the legend is BART's to change — a redeploy is
       the wrong answer to either. Both are read from the database, and the
       arguments survive only so a test can pin them. */
    if (sheetName === undefined) {
      const settings = await rc.listSettings().catch(() => []);
      sheetName = settings.find((r) => r.key === 'lookahead_sheet')?.value || '4WLA';
    }
    if (legend === undefined) {
      legend = (await rc.listLegend().catch(() => []))
        .map((r) => ({ argb: r.argb, meaning: r.meaning, role: r.role || 'shift' }));
    }

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

      const previous = await rc.latestSnapshot();
      if (previous && sameContent(previous.file_hash, hash)) {
        run.outcome = 'unchanged';
        await rc.addIngestRun(run);
        if (!silent) toast({ message: 'The look-ahead has not changed since the last snapshot.' });
        return { changed: false, events: [] };
      }

      const buffer = await filestore.intakeRead(rel);
      const parsed = parseSheet(buffer, sheetName);

      /* The workbook writes down what its own colours mean. Adopting that the
         first time is not the same as guessing one: it is the authors' sentence,
         read off the page. It is only ever adopted into an *empty* register —
         once somebody has mapped a colour by hand the file does not get to
         overrule them, and a disagreement is surfaced instead. */
      const declared = readLegend(parsed);
      if (declared.length && !legend.length) {
        await rc.addLegend(declared.map((d) => ({ argb: d.argb, meaning: d.meaning })));
        legend = declared;
        if (!silent) {
          toast({
            tone: 'good',
            message: `Read ${declared.length} colours from the workbook's own key: `
              + `${declared.map((d) => d.meaning).join(', ')}.`,
            timeout: 9000,
          });
        }
      }

      const grid = applyLegend(parsed, legend);

      if (grid.conditional.length && !grid.rows.some((r) => r.cells.some((c) => c.hex))) {
        throw new Error(
          'That sheet has conditional formatting and no readable cell fills, so the shift '
          + 'colours are coming from rules rather than from the cells. They cannot be read '
          + 'from the style table — the ingestion design needs revisiting before this can work.'
        );
      }

      return await publishGrid({ grid, legend, declared, hash, run, previous, silent });
    } catch (err) {
      if (run.outcome === 'error') {
        run.note = err.message;
        await rc.addIngestRun(run).catch(() => {});
      }
      throw err;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The editor as the source
     ═══════════════════════════════════════════════════════════════════════ */

  /** `rc_settings.lookahead_source`: 'workbook' until the editor takes over. */
  const EDITOR_SOURCE = 'editor';

  async function lookaheadSource() {
    const settings = await rc.listSettings().catch(() => []);
    return settings.find((r) => r.key === 'lookahead_source')?.value || 'workbook';
  }

  /**
   * The days a published read covers: the week just gone, this week and the
   * five after it. The week behind is there because the huddle reviews
   * yesterday — on a Monday that is last week — and a read that started today
   * would leave it asking about a day the look-ahead no longer mentions.
   */
  function publishDays(todayIso) {
    return windowDays(addDaysISO(mondayOf(todayIso), -7), 7);
  }

  /**
   * Publish what the editor holds, so every other screen reads it.
   *
   * Deduplicated on the content, like a workbook read is on its bytes: the
   * editor calls this whenever it has saved and gone quiet, and most of those
   * calls find nothing new. The section band's grey is put in the legend as a
   * divider the first time, because that is how `readGrid()` knows a heading.
   *
   * @param {{ model?: object, title?: string, silent?: boolean }} [options]  `model` is the editor's.
   */
  async function publishFromEditor({ model, title = '', silent = true } = {}) {
    let legend = (await rc.listLegend().catch(() => []))
      .map((r) => ({ argb: r.argb, meaning: r.meaning, role: r.role || 'shift' }));
    if (!legend.some((e) => String(e.argb).toUpperCase() === SECTION_BAND)) {
      await rc.addLegend([{ argb: SECTION_BAND, meaning: 'Section band', role: 'divider' }]).catch(() => {});
      legend = [...legend, { argb: SECTION_BAND, meaning: 'Section band', role: 'divider' }];
    }
    const days = publishDays(todayISO());
    const grid = applyLegend(gridFromModel(model, days, { title }), legend);
    const hash = `editor:${hash64(JSON.stringify(grid.rows.map((r) => r.cells.map((c) => [c.col, c.value, c.hex]))))}`;
    /* Compared against the newest reading as the server has it now, never a
       remembered one: matching an older reading's hash is how a day put back the
       way it was a minute ago went unpublished. */
    rc.forgetReads();
    const previous = await rc.latestSnapshot();
    if (previous && sameContent(previous.file_hash, hash)) return { changed: false, events: [] };
    const run = {
      ran_at: new Date().toISOString(),
      outcome: 'error',
      note: null,
      file_hash: hash,
      file_mtime: new Date().toISOString(),
    };
    return publishGrid({ grid, legend, declared: [], hash, run, previous, silent, notify: false });
  }

  /**
   * The look-ahead as written in the editor, for days no reading covers.
   *
   * A reading covers the week just gone and the five ahead, and the editor's
   * tables hold every day ever written — so paging the calendar back past the
   * reading, or asking it for everything, is answered from those. Drawn through
   * the steps a publish takes — `gridFromModel()`, the legend, `readGrid()` — so
   * a week drawn this way and the same week drawn from a reading are one picture
   * (archived rows are off both). Nothing is stored: it is a view, and the
   * reading is still what every other screen reads.
   *
   * @param {string} fromISO
   * @param {string} toISO
   * @param {any[]} legendRows  `rc.listLegend()`, as the reading is drawn against.
   */
  async function writtenView(fromISO, toISO, legendRows) {
    const [rows, cells, settings] = await Promise.all([
      rc.listLaRows(),
      rc.listLaCells(fromISO, toISO),
      rc.listSettings().catch(() => []),
    ]);
    const days = [];
    for (let d = fromISO; d <= toISO; d = addDaysISO(d, 1)) days.push(d);
    const legend = (legendRows || []).map((r) => ({ argb: r.argb, meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from }));
    // The band is how a heading is told from work; a publish puts it in the register the first time.
    if (!legend.some((e) => String(e.argb).toUpperCase() === SECTION_BAND)) {
      legend.push({ argb: SECTION_BAND, meaning: 'Section band', role: 'divider', valid_from: '' });
    }
    const title = settings.find((r) => r.key === 'lookahead_title')?.value || '';
    const grid = applyLegend(gridFromModel(makeModel(rows.map(cleanRow), cells.map(cleanCell)), days, { title }), legend);
    return { ...readGrid(grid, { anchorISO: fromISO }), unknown: grid.unknown || [] };
  }

  /**
   * A reading's stored fingerprint: what its contents hash to, and when it was
   * taken. `rc_lookahead_snapshots.file_hash` is unique, and a look-ahead put
   * back the way an earlier reading had it — a day painted cancelled, then
   * yellow again — hashes to that earlier reading: stored bare, the database
   * refused the reading, every publish after it failed the same way, and the
   * calendar went on drawing the cancellation. The content is still what is
   * compared (`sameContent()`), so an unchanged look-ahead is still not read twice.
   */
  function storedHash(hash) {
    return `${hash}#${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  /** Whether a stored fingerprint is these contents — with or without the stamp `storedHash()` adds. */
  function sameContent(stored, hash) {
    return String(stored ?? '').split('#')[0] === hash;
  }

  /**
   * Store a read of the look-ahead and derive everything that hangs off it.
   *
   * The second half of what "Check now" always did, taken out so the editor can
   * do it too: the editor's model becomes a grid (`gridFromModel()`) and arrives
   * here exactly as a workbook did — snapshot, rows keyed by week and location,
   * change events against the previous read, tasks moved to whoever the sheet
   * now names. Everything downstream therefore reads one kind of record whether
   * the look-ahead was typed into Excel or into the calendar.
   */
  async function publishGrid({ grid, legend, declared = [], hash, run, previous, silent = false, notify = true }) {
    try {
      const snapshot = await rc.addSnapshot({
        file_hash: storedHash(hash),
        file_mtime: run.file_mtime,
        sheet_name: grid.sheet,
        grid: {
          rows: grid.rows,
          merges: grid.merges,
          hiddenColumns: grid.hiddenColumns,
          unknown: grid.unknown,
          // What the file said about itself, kept beside what it was read
          // against — so a legend that changed under a snapshot is visible
          // rather than something somebody has to remember.
          declared,
          legend,
        },
      });

      /* Write the rows, not just the grid.
         The snapshot holds the whole sheet as it was read, which is what the
         calendar draws; the rows are the same thing keyed by week and location,
         which is what the plan and the change log can *join* to. Until now only
         the grid was written, so `rc_lookahead_rows` was a well-designed table
         with nothing in it and nothing downstream could reference a row. */
      let written = [];
      let rowTrouble = null;
      try {
        const rows = await lookaheadRows(snapshot.id, grid);
        if (rows.length) written = await rc.addSnapshotRows(rows);
      } catch (err) {
        rowTrouble = err.message;
        /* The snapshot is the record; the rows are a convenience over it and can
           be rebuilt from it. Losing them must not lose the read — but it must
           not be silent either, which it was: a `console.warn` is a message to
           nobody, and the feature it takes out simply reads as empty. */
        console.warn('[cx-timeline] look-ahead rows:', err.message);
      }

      /* And then say what changed.
         This is the point of snapshotting at all — the difference between two
         reads is what a delay claim is eventually built from — and until now
         nothing produced it: `classify()` was written, tested and never called,
         so `rc_change_events` stayed empty and the Changes tab had nothing to
         draw. */
      let events = [];
      try {
        events = await recordChanges(previous, snapshot, written, legend);
      } catch (err) {
        // Same reasoning as the rows: both are derived from snapshots that are
        // safely stored, so a failure here costs a re-derivation and not a read.
        console.warn('[cx-timeline] change events not written:', err.message);
        rc.reportError('lookahead:changes', err);
      }

      run.outcome = 'snapshot';
      run.note = [
        grid.unknown.length ? `${grid.unknown.length} colour(s) not in the legend` : null,
        events.length ? `${countable(events).length} change(s) that count` : null,
        rowTrouble ? `rows: ${rowTrouble}` : null,
      ].filter(Boolean).join('; ') || null;
      await rc.addIngestRun(run);

      /* Said out loud, and at length. Something downstream of this read is now
         empty, and "empty" and "it could not be written" must not look alike — a
         read that half worked and reported success is how somebody concludes a
         feature does not work. */
      if (!silent && rowTrouble) {
        toast({ tone: 'bad', message: `Read, but: ${rowTrouble}`, timeout: 20000 });
      }

      if (!silent && grid.unknown.length) {
        toast({
          tone: 'warn',
          message: `${grid.unknown.length} colour(s) are not in the legend and were left unmapped — `
            + 'nothing was guessed.',
        });
      }

      if (!silent && events.length) {
        const counted = countable(events).length;
        toast({
          tone: counted ? 'warn' : 'info',
          message: counted
            ? `${counted} change(s) since the last read — see Changes.`
            : 'Read. The only difference was the window rolling forward.',
          timeout: 8000,
        });
      }

      // The editor publishes quietly: a redraw of the whole tab every time it
      // saves would throw away the cell somebody is typing in.
      if (notify) notifyChanged('lookahead');
      return { changed: true, snapshot, grid, events };
    } catch (err) {
      if (run.outcome === 'error') {
        run.note = err.message;
        await rc.addIngestRun(run).catch(() => {});
      }
      throw err;
    }
  }

  /**
   * The snapshot, as rows something else can point at.
   *
   * The derivation lives in `core/lookahead.js`, which knows nothing about
   * Supabase and can therefore be tested without a browser; this is the part
   * that needs the network — resolving a spelling through the alias register.
   */
  async function lookaheadRows(snapshotId, grid) {
    const resolved = new Map();
    return rowsFrom(readGrid(grid), {
      snapshotId,
      // Cached, because a hundred and forty rows share a handful of spellings
      // and each miss is a round trip.
      locate: async (text) => {
        const key = String(text || '').trim();
        if (!key) return null;
        if (!resolved.has(key)) resolved.set(key, await rc.resolveLocation(key).catch(() => null));
        return resolved.get(key);
      },
    });
  }

  /**
   * What changed between two reads, written down.
   *
   * The rows of both snapshots are put in the shape `classify()` expects and the
   * difference is stored. Three things about it are load-bearing and all three
   * are in `core/lookahead.js` rather than here — this function's only job is to
   * feed it honestly:
   *
   *   * only weeks in *both* snapshots are compared, so the window rolling
   *     forward is recorded as itself rather than as a batch of scope additions
   *     every Monday and a pile of deletions every Friday;
   *   * a crew moving site is logged as a removal and an addition, never
   *     inferred, because the activity text is not reliable enough to match on;
   *   * a shift turning the cancellation colour is flagged as needing somebody
   *     to say whose cancellation it was. Nothing is assumed.
   *
   * Returns the events, so the caller can say how many of them count.
   */
  async function recordChanges(previous, snapshot, rows, legend) {
    if (!previous || !rows.length) return [];

    const priorRows = await rc.listSnapshotRows(previous.id).catch(() => []);
    if (!priorRows.length) return [];

    // `classify()` keys on the row key and reads `cells` and `marks`; the
    // database columns are named for what they are on disk.
    const shape = (r) => ({
      rowKey: r.row_key,
      rowId: r.la_row_id || null,
      weekStart: r.week_start,
      location: r.raw_location || '',
      subsystem: r.subsystem || '',
      label: r.raw_label || '',
      cells: r.cells || {},
      marks: r.bart_marks || {},
      resources: r.resources || {},
      locationId: r.location_id || null,
    });

    /* Which meaning counts as a cancellation is the legend's to say, not this
       module's. A deployment that words it differently — "Cancelled", "Cancel" —
       should not silently stop producing cancellation events, so the register is
       asked and only an exact match counts. */
    const cancelled = legend.find((l) => /cancel/i.test(l.meaning))?.meaning || 'cancelled';

    const events = classify(priorRows.map(shape), rows.map(shape), { cancelledMeaning: cancelled });
    if (!events.length) return [];

    const byKey = new Map(rows.map((r) => [r.row_key, r]));
    const records = events.map((e) => ({
      from_snapshot: previous.id,
      to_snapshot: snapshot.id,
      kind: e.kind,
      week_start: e.weekStart || null,
      row_key: e.rowKey || null,
      // The editor's id for the row, which is what Changes reads the edit log by
      // to say who did it. Null for a change between two workbook reads.
      la_row_id: e.rowId || null,
      location_id: byKey.get(e.rowKey)?.location_id || null,
      before: sideOf(e, 'before'),
      after: sideOf(e, 'after'),
    }));

    if (records.length) await rc.addChangeEvents(records);
    return events;
  }

  /**
   * One side of a change, in the shape the table stores and `describe()` reads.
   *
   * The two have to agree, and there is no column for a date — the table keys on
   * the week — so a change to one day carries its own. What a reviewer needs a
   * year later is what it said before and what it says now, so both sides are
   * kept whole rather than summarised into a sentence that cannot be re-read.
   */
  function sideOf(event, which) {
    const value = event[which];
    if (value === null || value === undefined) return null;

    // A whole row arrived or left: what it was is the useful part.
    if (event.kind === 'scope_added' || event.kind === 'scope_removed') {
      return { label: value.label || null, location: value.location || null, week: value.weekStart || null };
    }
    /* What the activity said about itself, before and after — the whole label
       and where it was, so a moved activity reads "from W30 to Y10". */
    if (event.kind === 'location_shift' || event.kind === 'details_changed') {
      return { label: value.label || null, location: value.location || '' };
    }
    /* A resource request, as a map of date to what was asked for. Two shapes,
       because there are two places it can be written: a mark on the activity line
       itself, and the names on the Resource row underneath. `describe()` reads
       which by the key, so the two must not be collapsed into one. */
    if (event.kind === 'resource_changed') {
      return event.field === 'resources' ? { resources: value } : { marks: value };
    }

    return { date: event.date || null, value };
  }

  function checkNowButton() {
    /* Once the look-ahead is written in the calendar there is nothing to check:
       the button that read the workbook becomes the way to the editor. */
    if (la.source === EDITOR_SOURCE) {
      return el('button', {
        class: 'cx-btn mini primary',
        html: icon('edit', { size: 12 }) + '<span>Edit the look-ahead</span>',
        onClick: () => { la.section = 'calendar'; la.editing = true; notifyChanged('lookahead'); },
      });
    }
    return el('button', {
      class: 'cx-btn mini primary',
      html: icon('refresh', { size: 12 }) + '<span>Check now</span>',
      onClick: async () => {
        try {
          await ingest();
        } catch (err) {
          // 'bad' — not 'error', which is not a tone and fell back to the
          // neutral info styling, so a refusal looked like a notification.
          // These messages say what to go and do, so they get longer than the
          // default three and a half seconds to be read.
          toast({ tone: 'bad', message: err.message, timeout: 12000 });
          rc.reportError('lookahead:read', err);
        }
      },
    });
  }


  Object.defineProperty(__x, "ingest", { get: () => ingest, enumerable: true });
  Object.defineProperty(__x, "EDITOR_SOURCE", { get: () => EDITOR_SOURCE, enumerable: true });
  Object.defineProperty(__x, "lookaheadSource", { get: () => lookaheadSource, enumerable: true });
  Object.defineProperty(__x, "publishDays", { get: () => publishDays, enumerable: true });
  Object.defineProperty(__x, "publishFromEditor", { get: () => publishFromEditor, enumerable: true });
  Object.defineProperty(__x, "writtenView", { get: () => writtenView, enumerable: true });
  Object.defineProperty(__x, "checkNowButton", { get: () => checkNowButton, enumerable: true });
};

// io/xlsx_write.js
__mods["io/xlsx_write.js"] = function (__x, __req) {
  /**
   * Writing an .xlsx: a ZIP of XML parts, and a style table built as it is used.
   *
   * The reading side (`io/lookahead.js`) has always had its own ZIP reader, so a
   * workbook never needed a library to open; this is the other direction, for
   * the same reason — the application has no build-time dependencies and a
   * spreadsheet is small enough not to need one. The ZIP is written *stored*
   * (no compression): every spreadsheet program reads it, the look-ahead is a
   * few hundred kilobytes at most, and it keeps this module to arithmetic that
   * can be checked by reading the result straight back in.
   *
   * No DOM, so `tools/test_la_edit.js` writes a workbook and parses it again
   * without a browser.
   *
   * Imports: nothing.
   */

  /* ══════════════════════════════════════════════════════════════════════════
     ZIP (stored)
     ═══════════════════════════════════════════════════════════════════════ */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** `[{ name, data }]` → the bytes of a ZIP holding them, uncompressed. */
  function zipStore(files) {
    const enc = new TextEncoder();
    return zipEntries(files.map((file) => ({
      name: file.name,
      data: typeof file.data === 'string' ? enc.encode(file.data) : file.data,
    })));
  }

  /**
   * The same ZIP, deflated — for a workbook big enough for it to matter.
   *
   * The master export carries a year of the look-ahead day by day, and stored
   * that is tens of megabytes landing in a synced folder every day; spreadsheet
   * XML deflates to a tenth of that. The browser's own `CompressionStream` does
   * the work (Node has it too, which keeps this testable), and where it is
   * missing the file is simply written stored — bigger, never broken.
   */
  async function zipDeflate(files) {
    const enc = new TextEncoder();
    const entries = files.map((file) => ({
      name: file.name,
      data: typeof file.data === 'string' ? enc.encode(file.data) : file.data,
    }));
    try {
      for (const entry of entries) {
        const stream = new Blob([entry.data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        entry.packed = new Uint8Array(await new Response(stream).arrayBuffer());
      }
    } catch {
      for (const entry of entries) delete entry.packed;
    }
    return zipEntries(entries);
  }

  /** `[{ name, data, packed? }]` → a ZIP; an entry with `packed` is stored deflated. */
  function zipEntries(entries) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    // 1 January 2026, 00:00 — a fixed stamp, so the same content is the same file.
    const dosTime = 0;
    const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

    for (const entry of entries) {
      const name = enc.encode(entry.name);
      const { data } = entry;
      const body = entry.packed || data;
      const method = entry.packed ? 8 : 0;
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, method, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, body.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, body);

      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true);
      dir.setUint16(6, 20, true);
      dir.setUint16(8, 0x0800, true);
      dir.setUint16(10, method, true);
      dir.setUint16(12, dosTime, true);
      dir.setUint16(14, dosDate, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, body.length, true);
      dir.setUint32(24, data.length, true);
      dir.setUint16(28, name.length, true);
      dir.setUint32(42, offset, true);
      central.push(new Uint8Array(dir.buffer), name);

      offset += 30 + name.length + body.length;
    }

    const dirSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, dirSize, true);
    end.setUint32(16, offset, true);

    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of all) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     XML
     ═══════════════════════════════════════════════════════════════════════ */

  function xmlEscape(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Characters XML 1.0 cannot carry at all; a pasted control character would
      // otherwise make the whole file unreadable.
      // eslint-disable-next-line no-control-regex -- matching them is the point
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Styles
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The style table, built from what the sheet asks for.
   *
   * A style is described as `{ bold, italic, size, color, fill, border, h, v,
   * wrap, shrink, numFmt }` and `id()` returns its index in `cellXfs`, adding it the first time
   * — so the workbook carries exactly the styles its cells use and no more.
   */
  function styleBook({ font = 'Arial', size = 10 } = {}) {
    const fonts = [];
    const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const borders = [];
    const xfs = [];
    const index = new Map();

    const fontId = (s) => {
      const xml = `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}<sz val="${s.size || size}"/>`
        + `<color rgb="FF${s.color || '000000'}"/><name val="${font}"/><family val="2"/></font>`;
      let at = fonts.indexOf(xml);
      if (at < 0) { fonts.push(xml); at = fonts.length - 1; }
      return at;
    };
    const fillId = (hex) => {
      if (!hex) return 0;
      const xml = `<fill><patternFill patternType="solid"><fgColor rgb="FF${hex}"/><bgColor indexed="64"/></patternFill></fill>`;
      let at = fills.indexOf(xml);
      if (at < 0) { fills.push(xml); at = fills.length - 1; }
      return at;
    };
    const borderId = (b = '') => {
      const side = (name) => (b.includes(name[0])
        ? `<${name} style="thin"><color indexed="64"/></${name}>` : `<${name}/>`);
      const xml = `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>`;
      let at = borders.indexOf(xml);
      if (at < 0) { borders.push(xml); at = borders.length - 1; }
      return at;
    };

    // Index 0 is the default every unstyled cell falls back to.
    fontId({});
    borderId('');
    xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');

    function id(s = {}) {
      const key = JSON.stringify(s);
      if (index.has(key)) return index.get(key);
      const align = (s.h || s.v || s.wrap || s.shrink)
        ? `<alignment${s.h ? ` horizontal="${s.h}"` : ''}${s.v ? ` vertical="${s.v}"` : ''}`
          + `${s.wrap ? ' wrapText="1"' : ''}${s.shrink ? ' shrinkToFit="1"' : ''}/>`
        : '';
      const f = fontId(s);
      const fi = fillId(s.fill);
      const b = borderId(s.border);
      // A built-in number format by its id (14 a date, 22 a date and time) —
      // built-ins need no <numFmts> entry, and every program reads them.
      const nf = s.numFmt || 0;
      xfs.push(`<xf numFmtId="${nf}" fontId="${f}" fillId="${fi}" borderId="${b}" xfId="0"`
        + ` applyFont="1"${nf ? ' applyNumberFormat="1"' : ''}${fi ? ' applyFill="1"' : ''}${b ? ' applyBorder="1"' : ''}`
        + `${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`);
      index.set(key, xfs.length - 1);
      return xfs.length - 1;
    }

    function xml() {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + `<fonts count="${fonts.length}">${fonts.join('')}</fonts>`
        + `<fills count="${fills.length}">${fills.join('')}</fills>`
        + `<borders count="${borders.length}">${borders.join('')}</borders>`
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '</styleSheet>';
    }

    return { id, xml };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     A workbook of one sheet
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The package around one worksheet: content types, relationships, the
   * workbook part (with its print titles) and a minimal core-properties part.
   */
  /**
   * A name Excel will open a sheet under. It refuses a workbook whose sheet is
   * named with `[ ] : * ? / \`, starts or ends with an apostrophe, or runs past
   * 31 characters — "We found a problem with some content" — and the name here
   * is an administrator's setting (`lookahead_sheet`), free text, so
   * "4WLA 10/12" or a long revision title made a file nobody could open.
   */
  function sheetNameFor(name) {
    const clean = String(name ?? '').replace(/[[\]:*?/\\]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^'+|'+$/g, '').slice(0, 31).trim();
    return clean || 'Sheet1';
  }

  function workbookParts({ sheetName, sheetXml, stylesXml, printTitles = null, title = '' }) {
    const name = xmlEscape(sheetNameFor(sheetName));
    const defined = printTitles
      ? `<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${name.replace(/'/g, "''")}'!${printTitles}</definedName></definedNames>`
      : '';
    return [
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          + '<Default Extension="xml" ContentType="application/xml"/>'
          + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
          + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
          + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
          + '</Types>',
      },
      {
        name: '_rels/.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
          + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
          + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
          + '</Relationships>',
      },
      {
        name: 'docProps/core.xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
          + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
          + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
          + `<dc:title>${xmlEscape(title)}</dc:title><dc:creator>CX Timeline</dc:creator>`
          + '</cp:coreProperties>',
      },
      {
        name: 'xl/workbook.xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
          + '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15000"/></bookViews>'
          + `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>${defined}`
          + '</workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
          + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
          + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
          + '</Relationships>',
      },
      { name: 'xl/styles.xml', data: stylesXml },
      { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
    ];
  }

  /* ══════════════════════════════════════════════════════════════════════════
     A workbook of tables
     ═══════════════════════════════════════════════════════════════════════ */

  /** The most a cell may hold; Excel refuses to open a file with more. */
  const CELL_LIMIT = 32767;
  /** Rows on one sheet, the heading included. */
  const ROW_LIMIT = 1048576;

  /** A, B, … Z, AA, AB … — the letters of a column, 0-based. */
  function columnLetters(i) {
    let n = i + 1;
    let out = '';
    while (n > 0) {
      const r = (n - 1) % 26;
      out = String.fromCharCode(65 + r) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  /** A `YYYY-MM-DD` as Excel's day number, or null when it is not one. */
  function dateSerial(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569;
  }

  /**
   * An instant as Excel's day number and fraction, in this computer's time —
   * a spreadsheet has no time zones, and the person opening it reads the clock
   * on their wall, not Greenwich's.
   */
  function dateTimeSerial(value) {
    if (value == null || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())
      / 86400000 + 25569;
  }

  /**
   * Several tables as one .xlsx — a sheet each, for reading and filtering.
   *
   * `sheets` is `[{ name, columns: [{ heading, kind?, width?, wrap? }], rows:
   * [[value, …]], empty? }]`. A column's `kind` says what its values are, so
   * Excel can sort and sum them: `number`, `date` (`YYYY-MM-DD`), `datetime`
   * (an instant) or text, the default. A value that is not what its column says
   * is written as text rather than lost. Every sheet opens with its heading row
   * frozen and a filter on it; `empty` is the line written under the headings
   * when there are no rows, so a blank sheet says why.
   *
   * Text is written inline and is never a formula, whatever it starts with —
   * the spreadsheet trap a CSV has (`csvField()`) does not arise here.
   *
   * Returns a promise of the bytes, deflated (`zipDeflate()`).
   */
  async function tableWorkbook({ sheets, title = '' }) {
    const styles = styleBook({ size: 10 });
    const st = {
      head: styles.id({ bold: true, color: 'FFFFFF', fill: 'E60012', border: 'lrtb', v: 'center' }),
      text: styles.id({}),
      wrap: styles.id({ wrap: true, v: 'top' }),
      date: styles.id({ numFmt: 14, h: 'left' }),
      datetime: styles.id({ numFmt: 22, h: 'left' }),
      number: styles.id({}),
      note: styles.id({ italic: true, color: '666666' }),
    };
    const used = new Set();
    const named = sheets.map((sheet) => {
      let name = sheetNameFor(sheet.name);
      for (let n = 2; used.has(name.toLowerCase()); n++) name = sheetNameFor(`${sheetNameFor(sheet.name).slice(0, 27)} (${n})`);
      used.add(name.toLowerCase());
      return { ...sheet, name };
    });

    const textCell = (ref, value, style) => {
      const s = String(value).slice(0, CELL_LIMIT);
      return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(s)}</t></is></c>`;
    };
    const cell = (ref, value, column) => {
      if (value == null || value === '') return '';
      if (typeof value === 'boolean') return textCell(ref, value ? 'Yes' : 'No', st.text);
      const kind = column?.kind || 'text';
      if (kind === 'number' && typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${ref}" s="${st.number}"><v>${value}</v></c>`;
      }
      if (kind === 'date') {
        const serial = dateSerial(value);
        if (serial != null) return `<c r="${ref}" s="${st.date}"><v>${serial}</v></c>`;
      }
      if (kind === 'datetime') {
        const serial = dateTimeSerial(value);
        if (serial != null) return `<c r="${ref}" s="${st.datetime}"><v>${serial.toFixed(6)}</v></c>`;
      }
      return textCell(ref, value, column?.wrap ? st.wrap : st.text);
    };

    const widthOf = (column, i, rows) => {
      if (column.width) return column.width;
      if (column.kind === 'date') return 12;
      if (column.kind === 'datetime') return 17;
      let longest = String(column.heading || '').length;
      for (const row of rows.slice(0, 300)) longest = Math.max(longest, String(row[i] ?? '').length);
      return Math.min(60, Math.max(8, longest + 2));
    };

    const sheetXml = named.map((sheet) => {
      const columns = sheet.columns || [];
      const rows = (sheet.rows || []).slice(0, ROW_LIMIT - 1);
      const last = columnLetters(Math.max(0, columns.length - 1));
      const out = [];
      out.push(`<row r="1">${columns.map((c, i) => textCell(`${columnLetters(i)}1`, c.heading || '', st.head)).join('')}</row>`);
      rows.forEach((row, r) => {
        const n = r + 2;
        out.push(`<row r="${n}">${columns.map((c, i) => cell(`${columnLetters(i)}${n}`, row[i], c)).join('')}</row>`);
      });
      if (!rows.length && sheet.empty) out.push(`<row r="2">${textCell('A2', sheet.empty, st.note)}</row>`);
      const lastRow = Math.max(1, rows.length + 1);
      const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${widthOf(c, i, rows)}" customWidth="1"/>`).join('');
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + `<dimension ref="A1:${last}${lastRow}"/>`
        + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
        + '<sheetFormatPr defaultRowHeight="15"/>'
        + (cols ? `<cols>${cols}</cols>` : '')
        + `<sheetData>${out.join('')}</sheetData>`
        + (columns.length ? `<autoFilter ref="A1:${last}${lastRow}"/>` : '')
        + '</worksheet>';
    });

    const quoted = (name) => `'${xmlEscape(name).replace(/'/g, "''")}'`;
    const defined = named.map((sheet, i) => {
      const columns = sheet.columns || [];
      if (!columns.length) return '';
      const lastRow = Math.max(1, Math.min(ROW_LIMIT, (sheet.rows || []).length + 1));
      const last = columnLetters(columns.length - 1);
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${quoted(sheet.name)}!$A$1:$${last}$${lastRow}</definedName>`;
    }).join('');

    const files = [
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          + '<Default Extension="xml" ContentType="application/xml"/>'
          + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          + named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
          + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
          + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
          + '</Types>',
      },
      {
        name: '_rels/.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
          + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
          + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
          + '</Relationships>',
      },
      {
        name: 'docProps/core.xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
          + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
          + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
          + `<dc:title>${xmlEscape(title)}</dc:title><dc:creator>CX Timeline</dc:creator>`
          + '</cp:coreProperties>',
      },
      {
        name: 'xl/workbook.xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
          + '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15000"/></bookViews>'
          + `<sheets>${named.map((sheet, i) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
          + (defined ? `<definedNames>${defined}</definedNames>` : '')
          + '</workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
          + named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
          + `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
          + '</Relationships>',
      },
      // Built last: every style a cell asked for is in the book by now.
      { name: 'xl/styles.xml', data: styles.xml() },
      ...sheetXml.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml })),
    ];
    return zipDeflate(files);
  }

  Object.defineProperty(__x, "crc32", { get: () => crc32, enumerable: true });
  Object.defineProperty(__x, "zipStore", { get: () => zipStore, enumerable: true });
  Object.defineProperty(__x, "zipDeflate", { get: () => zipDeflate, enumerable: true });
  Object.defineProperty(__x, "xmlEscape", { get: () => xmlEscape, enumerable: true });
  Object.defineProperty(__x, "styleBook", { get: () => styleBook, enumerable: true });
  Object.defineProperty(__x, "sheetNameFor", { get: () => sheetNameFor, enumerable: true });
  Object.defineProperty(__x, "workbookParts", { get: () => workbookParts, enumerable: true });
  Object.defineProperty(__x, "CELL_LIMIT", { get: () => CELL_LIMIT, enumerable: true });
  Object.defineProperty(__x, "ROW_LIMIT", { get: () => ROW_LIMIT, enumerable: true });
  Object.defineProperty(__x, "columnLetters", { get: () => columnLetters, enumerable: true });
  Object.defineProperty(__x, "dateSerial", { get: () => dateSerial, enumerable: true });
  Object.defineProperty(__x, "dateTimeSerial", { get: () => dateTimeSerial, enumerable: true });
  Object.defineProperty(__x, "tableWorkbook", { get: () => tableWorkbook, enumerable: true });
};

// io/la_xlsx.js
__mods["io/la_xlsx.js"] = function (__x, __req) {
  /**
   * The look-ahead as an .xlsx, laid out the way the 4WLA has always been.
   *
   * Whoever keeps the project's master look-ahead copies rows out of this file
   * and pastes them into theirs, so the layout is not a matter of taste: the six
   * activity columns B to G with their headings merged down B2:B6 … G2:G6, the
   * month band on row 4 merged across each month, day numbers on 5, weekday
   * letters on 6, Arial 10 with a thin border on every cell, section headings
   * bold on the grey band, weekends shaded darker, and each PTO / Office / Other
   * group written as a grey label band over its row of names — every one of
   * those measured off BART's own workbook. Painted days carry the legend colour
   * and their support codes ("X.WIT"), bold and centred.
   *
   * Only the window asked for, and only the rows with something in it
   * (`rowsWithWork()`): no hidden columns, no history, nothing the reader has to
   * scroll past.
   *
   * No DOM — `tools/test_la_edit.js` writes one and reads it back through
   * `parseSheet()`, the same reader that reads BART's file.
   *
   * Imports: core/la_edit, io/xlsx_write, io/lookahead.
   */

  const { FIELDS, LAYOUT, SECTION_BAND, rowsWithWork, getCell, metaValues, colLetters, isWeekend, weekdayLetter, monthLabel, cancelledTokens } = __req("core/la_edit.js");



  const { zipStore, xmlEscape, styleBook, workbookParts } = __req("io/xlsx_write.js");
  const { isDark } = __req("io/lookahead.js");
  const { cellTokens } = __req("core/lookahead.js");

  const WEEKEND = '7F7F7F';
  /* The cancellation log's colours, as `--la-cancel-*` draws them on screen:
     a fill per answer for a day cancelled outright (BART's is the legend's red,
     passed in), and writing a white sheet can carry for a resource struck out. */
  const CANCEL_FILL = { Hitachi: '0070C0', Other: 'FFC000', open: 'E4D7F5' };
  const CANCEL_INK = { BART: 'FF0000', Hitachi: '0070C0', Other: 'C55A11', open: '7030A0' };
  const DAY_WIDTH = 12.7109375;
  const LINE = 12.75;

  /**
   * How many lines some text wraps to in a column `width` characters wide.
   * Excel does not grow a row to fit wrapped text when it opens a file, so the
   * height is worked out here — otherwise three names in a day cell show as one.
   */
  function lines(text, width) {
    const per = Math.max(1, Math.floor(width * 1.15));
    let count = 0;
    for (const para of String(text ?? '').split(/\r?\n/)) {
      let line = 0;
      count++;
      for (const word of para.split(/(?<=[ ,])/)) {
        if (line && line + word.length > per) { count++; line = 0; }
        line += word.length;
        while (line > per) { count++; line -= per; }
      }
    }
    return count;
  }

  /**
   * The workbook's bytes.
   *
   * @param {object} o
   * @param {object} o.model     the editor's model
   * @param {string[]} o.days    ISO dates, Monday first
   * @param {object[]} o.legend  `{ argb, meaning, role }` — the shift colours are keyed at the bottom
   * @param {object[]} o.codes   `{ code, name, party }` — the support codes, keyed too
   * @param {string} o.title
   * @param {string} o.sheetName
   * @param {boolean} [o.resources]  Write each activity's names row under it (default true).
   */
  function lookaheadWorkbook({ model, days, legend = [], codes = [], title = '', sheetName = '4WLA', resources = true }) {
    const L = LAYOUT;
    const styles = styleBook();
    const all = 'lrtb';
    const S = {
      title: styles.id({ bold: true, size: 16, color: 'FF0000', v: 'center' }),
      headTop: styles.id({ border: 'lrt', h: 'center', v: 'center', wrap: true }),
      headMid: styles.id({ border: 'lr', h: 'center', v: 'center', wrap: true }),
      headBottom: styles.id({ border: 'lrb', h: 'center', v: 'center', wrap: true }),
      monthFirst: styles.id({ border: 'ltb', h: 'center', v: 'center' }),
      monthMid: styles.id({ border: 'tb', h: 'center', v: 'center' }),
      monthLast: styles.id({ border: 'rtb', h: 'center', v: 'center' }),
      monthOnly: styles.id({ border: all, h: 'center', v: 'center' }),
      dayNum: styles.id({ border: all, h: 'center', v: 'top' }),
      weekday: styles.id({ border: all, h: 'center', v: 'center', wrap: true }),
      metaCenter: styles.id({ border: all, h: 'center', v: 'center', wrap: true }),
      metaLeft: styles.id({ border: all, h: 'left', v: 'center', wrap: true }),
      metaShrink: styles.id({ border: all, h: 'center', v: 'center', shrink: true }),
      band: styles.id({ border: all, fill: SECTION_BAND, h: 'center', v: 'center', wrap: true }),
      bandTitle: styles.id({ border: all, fill: SECTION_BAND, bold: true, h: 'left', v: 'center', wrap: true }),
      day: styles.id({ border: all, h: 'left', v: 'top' }),
      names: styles.id({ border: all, h: 'left', v: 'top', wrap: true }),
      weekend: styles.id({ border: all, fill: WEEKEND, h: 'center', v: 'center', wrap: true }),
      keyHead: styles.id({ bold: true, h: 'left', v: 'center' }),
      keyText: styles.id({ h: 'left', v: 'center' }),
      code: styles.id({ border: all, bold: true, h: 'center', v: 'center' }),
    };
    const paint = (hex) => styles.id({
      border: all, fill: hex, bold: true, color: isDark(hex) ? 'FFFFFF' : '000000', h: 'center', v: 'center', wrap: true,
    });

    const lastCol = L.firstDayCol + days.length - 1;
    const rowsXml = [];
    const merges = [];
    const str = (col, row, text, s) => (text === '' || text == null
      ? `<c r="${colLetters(col)}${row}" s="${s}"/>`
      : `<c r="${colLetters(col)}${row}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`);
    /* A day with a struck-out resource ("X.~WIT") is written as rich text: the
       live codes in the cell's own font, each cancelled one — tilde kept, so the
       file reads back as cancelled — struck through in red, as the calendar
       draws it. Whoever pastes the row into the master sees what was taken off. */
    const struckRun = (text, dark) => `<r><rPr><b/><strike/><sz val="10"/><color rgb="${dark ? 'FFFFFFFF' : 'FFFF0000'}"/>`
      + `<rFont val="Arial"/><family val="2"/></rPr><t xml:space="preserve">${xmlEscape(text)}</t></r>`;
    const plainRun = (text) => `<r><t xml:space="preserve">${xmlEscape(text)}</t></r>`;
    const codesCell = (col, row, text, s, dark = false) => {
      const runs = [];
      let pending = '';
      cellTokens(text).forEach((t, i) => {
        if (i) pending += '.';
        if (t.cancelled) {
          if (pending) runs.push(plainRun(pending));
          pending = '';
          runs.push(struckRun(`~${t.code}`, dark));
        } else pending += t.code;
      });
      if (pending) runs.push(plainRun(pending));
      return `<c r="${colLetters(col)}${row}" s="${s}" t="inlineStr"><is>${runs.join('')}</is></c>`;
    };
    const num = (col, row, n, s) => `<c r="${colLetters(col)}${row}" s="${s}"><v>${n}</v></c>`;
    const blank = (col, row, s) => `<c r="${colLetters(col)}${row}" s="${s}"/>`;
    const addRow = (r, cells, { ht = null, hidden = false } = {}) => {
      rowsXml.push(`<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}${hidden ? ' hidden="1"' : ''}>${cells.join('')}</row>`);
    };

    /* ── The header: title, headings, month band, day numbers, weekday letters ── */
    addRow(L.titleRow, [str(L.firstMetaCol, L.titleRow, title, S.title)], { ht: 20.25 });

    const headStyle = (r) => (r === L.headingRow ? S.headTop : r === L.weekdayRow ? S.headBottom : S.headMid);
    for (let r = L.headingRow; r <= L.weekdayRow; r++) {
      const cells = FIELDS.map((f, i) => (r === L.headingRow
        ? str(L.firstMetaCol + i, r, f.heading, headStyle(r))
        : blank(L.firstMetaCol + i, r, headStyle(r))));
      if (r === L.monthRow) {
        days.forEach((d, i) => {
          const first = i === 0 || monthLabel(days[i - 1]) !== monthLabel(d);
          const last = i === days.length - 1 || monthLabel(days[i + 1]) !== monthLabel(d);
          const s = first && last ? S.monthOnly : first ? S.monthFirst : last ? S.monthLast : S.monthMid;
          cells.push(first ? str(L.firstDayCol + i, r, monthLabel(d), s) : blank(L.firstDayCol + i, r, s));
        });
      } else if (r === L.dayRow) {
        days.forEach((d, i) => cells.push(num(L.firstDayCol + i, r, Number(d.slice(8, 10)), S.dayNum)));
      } else if (r === L.weekdayRow) {
        days.forEach((d, i) => cells.push(str(L.firstDayCol + i, r, weekdayLetter(d), S.weekday)));
      }
      // The heading block's own two rows are hidden, as on BART's sheet: the
      // merged headings then show against the three visible header rows.
      const ht = { 2: 102, 3: 89.25, 4: 38.25, 6: 25.5 }[r] || null;
      addRow(r, cells, { ht, hidden: r === 2 || r === 3 });
    }
    FIELDS.forEach((_, i) => {
      const c = colLetters(L.firstMetaCol + i);
      merges.push(`${c}${L.headingRow}:${c}${L.weekdayRow}`);
    });
    let runStart = 0;
    days.forEach((d, i) => {
      const last = i === days.length - 1 || monthLabel(days[i + 1]) !== monthLabel(d);
      if (!last) return;
      if (i > runStart) merges.push(`${colLetters(L.firstDayCol + runStart)}${L.monthRow}:${colLetters(L.firstDayCol + i)}${L.monthRow}`);
      runStart = i + 1;
    });

    /* ── The body ── */
    let r = L.firstBodyRow;
    const metaStyle = [S.metaCenter, S.metaLeft, S.metaCenter, S.metaShrink, S.metaCenter, S.metaCenter];
    let anyStruck = false;
    const dayCell = (col, row, cell, { names = false } = {}, iso) => {
      if (!names && cell?.text && cancelledTokens(cell.text).length) {
        anyStruck = true;
        if (cell.color) return codesCell(col, row, cell.text, paint(cell.color), isDark(cell.color));
        return codesCell(col, row, cell.text, isWeekend(iso) ? S.weekend : S.day);
      }
      if (cell?.color) return str(col, row, cell.text || '', paint(cell.color));
      if (isWeekend(iso)) return str(col, row, cell?.text || '', S.weekend);
      return str(col, row, cell?.text || '', names ? S.names : S.day);
    };
    const height = (texts) => {
      let n = 1;
      for (const [text, width] of texts) n = Math.max(n, lines(text, width));
      return n > 1 ? +(n * LINE + 1.5).toFixed(2) : null;
    };

    /* Without resources the sheet is the work alone: no names rows under the
       activities, and none of the rows that are about people rather than work —
       PTO, Office, Other group / project. */
    for (const row of rowsWithWork(model, days)) {
      if (!resources && (row.kind === 'resource' || row.kind === 'absence')) continue;
      if (row.kind === 'section') {
        const cells = FIELDS.map((f, i) => str(L.firstMetaCol + i, r, i === 1 ? row.description : '', i === 1 ? S.bandTitle : S.band));
        days.forEach((d, i) => cells.push(blank(L.firstDayCol + i, r, isWeekend(d) ? S.weekend : S.band)));
        addRow(r, cells, { ht: height([[row.description, FIELDS[1].width]]) });
        r++;
        continue;
      }
      if (row.kind === 'absence') {
        /* BART's sheet writes each of these as two rows: a grey band carrying
           the label, and under it the names. */
        const label = metaValues(row)[1];
        const band = FIELDS.map((f, i) => str(L.firstMetaCol + i, r, i === 1 ? label : '', i === 1 ? S.bandTitle : S.band));
        days.forEach((d, i) => band.push(blank(L.firstDayCol + i, r, isWeekend(d) ? S.weekend : S.band)));
        addRow(r, band);
        r++;
      }
      const meta = metaValues(row);
      const cells = meta.map((value, i) => str(L.firstMetaCol + i, r, value, metaStyle[i]));
      const texts = meta.map((value, i) => [value, FIELDS[i].width]);
      const names = row.kind !== 'activity';
      days.forEach((d, i) => {
        const cell = getCell(model, row.id, d);
        cells.push(dayCell(L.firstDayCol + i, r, cell, { names }, d));
        if (cell?.text) texts.push([cell.text, DAY_WIDTH]);
      });
      addRow(r, cells, { ht: height(texts) });
      r++;
    }

    /* ── The key: what each colour and each code means ── */
    const shifts = (legend || []).filter((e) => (e.role || 'shift') === 'shift' && e.meaning);
    if (shifts.length || codes.length) {
      r++;
      if (shifts.length) {
        addRow(r, [str(L.firstMetaCol + 1, r, 'Legend', S.keyHead)]);
        r++;
        for (const e of shifts) {
          addRow(r, [
            blank(L.firstMetaCol, r, paint(String(e.argb).toUpperCase())),
            str(L.firstMetaCol + 1, r, e.meaning, S.keyText),
          ]);
          r++;
        }
      }
      const live = (codes || []).filter((c) => c.active !== false);
      if (live.length) {
        r++;
        addRow(r, [str(L.firstMetaCol + 1, r, 'Support requested', S.keyHead)]);
        r++;
        for (const c of live) {
          addRow(r, [
            str(L.firstMetaCol, r, String(c.code).toUpperCase(), S.code),
            str(L.firstMetaCol + 1, r, [c.name, c.party ? `(${c.party})` : ''].filter(Boolean).join(' '), S.keyText),
          ]);
          r++;
        }
        if (anyStruck) {
          addRow(r, [
            codesCell(L.firstMetaCol, r, '~WIT', S.code),
            str(L.firstMetaCol + 1, r, 'Struck through in red, with a ~: cancelled — asked for, then taken off', S.keyText),
          ]);
          r++;
        }
      }
    }

    const colsXml = [
      '<col min="1" max="1" width="7.85546875" hidden="1" customWidth="1"/>',
      ...FIELDS.map((f, i) => `<col min="${L.firstMetaCol + i}" max="${L.firstMetaCol + i}" width="${f.width}" customWidth="1"/>`),
      days.length ? `<col min="${L.firstDayCol}" max="${lastCol}" width="${DAY_WIDTH}" customWidth="1"/>` : '',
    ].join('');

    const lastRef = `${colLetters(Math.max(lastCol, L.firstMetaCol + FIELDS.length - 1))}${Math.max(r - 1, L.weekdayRow)}`;
    const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
      + `<dimension ref="A1:${lastRef}"/>`
      + '<sheetViews><sheetView tabSelected="1" zoomScale="80" zoomScaleNormal="80" workbookViewId="0">'
      + `<pane xSplit="${L.firstDayCol - 1}" ySplit="${L.weekdayRow}" topLeftCell="${colLetters(L.firstDayCol)}${L.firstBodyRow}" activePane="bottomRight" state="frozen"/>`
      + '<selection pane="topRight"/><selection pane="bottomLeft"/>'
      + `<selection pane="bottomRight" activeCell="${colLetters(L.firstDayCol)}${L.firstBodyRow}" sqref="${colLetters(L.firstDayCol)}${L.firstBodyRow}"/>`
      + '</sheetView></sheetViews>'
      + `<sheetFormatPr defaultRowHeight="${LINE}"/>`
      + `<cols>${colsXml}</cols>`
      + `<sheetData>${rowsXml.join('')}</sheetData>`
      + (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '')
      + '<pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
      + '<pageSetup paperSize="17" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
      + '</worksheet>';

    return zipStore(workbookParts({
      sheetName,
      sheetXml,
      stylesXml: styles.xml(),
      printTitles: `$${L.titleRow}:$${L.weekdayRow}`,
      title,
    }));
  }

  /** "4WLA 2026-09-21 to 2026-10-18.xlsx" — the window is in the name, so two exports never look alike. */
  function lookaheadFileName(days, sheetName = '4WLA') {
    return `${safeSheetName(sheetName)} ${days[0]} to ${days[days.length - 1]}.xlsx`;
  }

  /**
   * The name the master export files the 4WLA under: one name, replaced by every
   * export, as the workbook beside it is. Named for its dates it was a new file
   * every day the record grew, and the folder filled with yesterday's copies.
   */
  function lookaheadLatestName(sheetName = '4WLA') {
    return `${safeSheetName(sheetName)}_Latest.xlsx`;
  }

  function safeSheetName(sheetName) {
    return String(sheetName || '4WLA').replace(/[\\/:*?"<>|]+/g, ' ').trim() || '4WLA';
  }

  /**
   * The cancellations as a calendar workbook: one row per activity, the days of
   * the period across, and each cancelled run one merged cell carrying what was
   * cancelled, who was responsible and why.
   *
   * `rows` is `[{ label, location, events: [{ start, end, kind, party, text }] }]` —
   * `kind` 'activity' for a day cancelled outright (filled) or 'support' for a
   * BART resource struck out of an activity that went ahead (coloured writing,
   * no fill, because the work itself went ahead). The colour is whose it was:
   * `party` 'BART' red, 'Hitachi' blue, 'Other' amber, and null — nobody has
   * said — lavender with purple writing. `text` is what the cell says. Weekends
   * are the sheet's grey, like the look-ahead export.
   *
   * @param {object} o
   * @param {string[]} o.days     ISO dates, both ends inclusive
   * @param {object[]} o.rows
   * @param {string} o.title
   * @param {string} o.subtitle
   * @param {string} o.red        the legend's cancellation colour, `RRGGBB`
   */
  function cancellationWorkbook({ days, rows, title = 'Cancellations', subtitle = '', red = 'FF0000' }) {
    const styles = styleBook();
    const all = 'lrtb';
    const S = {
      title: styles.id({ bold: true, size: 14, v: 'center' }),
      sub: styles.id({ v: 'center' }),
      head: styles.id({ border: all, bold: true, h: 'left', v: 'center', wrap: true }),
      month: styles.id({ border: all, bold: true, h: 'left', v: 'center' }),
      num: styles.id({ border: all, h: 'center', v: 'center' }),
      meta: styles.id({ border: all, h: 'left', v: 'top', wrap: true }),
      day: styles.id({ border: all }),
      weekend: styles.id({ border: all, fill: WEEKEND }),
      keyText: styles.id({ h: 'left', v: 'center' }),
    };
    const who = (party) => (party == null ? 'open' : party in CANCEL_INK ? party : 'Other');
    const fill = (party) => (who(party) === 'BART' ? red : CANCEL_FILL[who(party)]);
    const cancelled = (party) => styles.id({
      border: all, fill: fill(party), bold: true, italic: who(party) === 'open',
      color: isDark(fill(party)) ? 'FFFFFF' : '000000', h: 'center', v: 'center', wrap: true,
    });
    const support = (party) => styles.id({
      border: all, bold: true, italic: who(party) === 'open', color: CANCEL_INK[who(party)], h: 'center', v: 'center', wrap: true,
    });
    const META = [{ heading: 'Activity', width: 44 }, { heading: 'Location', width: 14 }];
    const first = META.length + 1;
    const str = (col, row, text, s) => (text === '' || text == null
      ? `<c r="${colLetters(col)}${row}" s="${s}"/>`
      : `<c r="${colLetters(col)}${row}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`);
    const num = (col, row, n, s) => `<c r="${colLetters(col)}${row}" s="${s}"><v>${n}</v></c>`;
    const rowsXml = [];
    const merges = [];
    const addRow = (r, cells, ht = null) => rowsXml.push(`<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells.join('')}</row>`);

    addRow(1, [str(1, 1, title, S.title)], 21);
    addRow(2, [str(1, 2, subtitle, S.sub)]);

    // The month band, day numbers and weekday letters, as the look-ahead has them.
    const monthCells = [str(1, 4, '', S.head), str(2, 4, '', S.head)];
    let runStart = 0;
    days.forEach((d, i) => {
      const head = i === 0 || monthLabel(days[i - 1]) !== monthLabel(d);
      monthCells.push(head ? str(first + i, 4, monthLabel(d), S.month) : str(first + i, 4, '', S.month));
      const last = i === days.length - 1 || monthLabel(days[i + 1]) !== monthLabel(d);
      if (last) {
        if (i > runStart) merges.push(`${colLetters(first + runStart)}4:${colLetters(first + i)}4`);
        runStart = i + 1;
      }
    });
    addRow(4, monthCells);
    addRow(5, [str(1, 5, META[0].heading, S.head), str(2, 5, META[1].heading, S.head),
      ...days.map((d, i) => num(first + i, 5, Number(d.slice(8, 10)), S.num))]);
    addRow(6, [str(1, 6, '', S.head), str(2, 6, '', S.head),
      ...days.map((d, i) => str(first + i, 6, weekdayLetter(d), S.num))]);
    merges.push('A5:A6', 'B5:B6');

    let r = 7;
    const index = new Map(days.map((d, i) => [d, i]));
    for (const row of rows) {
      const cells = [str(1, r, row.label, S.meta), str(2, r, row.location || '', S.meta)];
      let height = Math.max(lines(row.label, META[0].width), lines(row.location, META[1].width));
      const covered = new Map(); // day index → { event, startIndex, endIndex }
      for (const e of row.events) {
        const a = index.get(e.start < days[0] ? days[0] : e.start);
        const b = index.get(e.end > days[days.length - 1] ? days[days.length - 1] : e.end);
        if (a == null || b == null || b < a) continue;
        for (let i = a; i <= b; i++) covered.set(i, { e, a, b });
        if (b > a) merges.push(`${colLetters(first + a)}${r}:${colLetters(first + b)}${r}`);
        height = Math.max(height, lines(e.text, DAY_WIDTH * (b - a + 1)));
      }
      days.forEach((d, i) => {
        const hit = covered.get(i);
        if (hit) {
          const s = hit.e.kind === 'support' ? support(hit.e.party) : cancelled(hit.e.party);
          cells.push(i === hit.a ? str(first + i, r, hit.e.text, s) : str(first + i, r, '', s));
        } else cells.push(str(first + i, r, '', isWeekend(d) ? S.weekend : S.day));
      });
      addRow(r, cells, height > 1 ? +(height * LINE + 1.5).toFixed(2) : null);
      r++;
    }

    for (const [party, said] of [
      ['BART', 'Day cancelled, BART responsible — the activity did not go ahead'],
      ['Hitachi', 'Day cancelled, Hitachi responsible'],
      ['Other', 'Day cancelled, another party responsible'],
      [null, 'Day cancelled, no reason recorded yet'],
    ]) {
      r++;
      addRow(r, [str(first, r, '', cancelled(party)), str(first + 1, r, said, S.keyText)]);
    }
    r++;
    addRow(r, [str(first, r, 'WIT', support('BART')),
      str(first + 1, r, 'BART resource cancelled — the activity went ahead without it; written in the responsible party\'s colour', S.keyText)]);

    const lastCol = first + Math.max(days.length, 2) - 1;
    const colsXml = [
      ...META.map((m, i) => `<col min="${i + 1}" max="${i + 1}" width="${m.width}" customWidth="1"/>`),
      days.length ? `<col min="${first}" max="${first + days.length - 1}" width="${DAY_WIDTH}" customWidth="1"/>` : '',
    ].join('');
    const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
      + `<dimension ref="A1:${colLetters(lastCol)}${r}"/>`
      + '<sheetViews><sheetView tabSelected="1" zoomScale="80" zoomScaleNormal="80" workbookViewId="0">'
      + `<pane xSplit="${first - 1}" ySplit="6" topLeftCell="${colLetters(first)}7" activePane="bottomRight" state="frozen"/>`
      + '</sheetView></sheetViews>'
      + `<sheetFormatPr defaultRowHeight="${LINE}"/>`
      + `<cols>${colsXml}</cols>`
      + `<sheetData>${rowsXml.join('')}</sheetData>`
      + (merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '')
      + '<pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
      + '<pageSetup paperSize="17" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
      + '</worksheet>';

    return zipStore(workbookParts({ sheetName: 'Cancellations', sheetXml, stylesXml: styles.xml(), printTitles: '$4:$6', title }));
  }

  Object.defineProperty(__x, "lookaheadWorkbook", { get: () => lookaheadWorkbook, enumerable: true });
  Object.defineProperty(__x, "lookaheadFileName", { get: () => lookaheadFileName, enumerable: true });
  Object.defineProperty(__x, "lookaheadLatestName", { get: () => lookaheadLatestName, enumerable: true });
  Object.defineProperty(__x, "cancellationWorkbook", { get: () => cancellationWorkbook, enumerable: true });
};

// ui/rc_la_p6.js
__mods["ui/rc_la_p6.js"] = function (__x, __req) {
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

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const p6 = __req("core/la_p6.js");
  const { newId } = __req("core/la_edit.js");
  const { readZip, readSheets, parseSheet } = __req("io/lookahead.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, toast, emptyState, openModal, checkbox, badge, field } = __req("ui/components.js");
  const { notifyChanged, formModal, authorNames } = __req("ui/rc_util.js");
  const { la, table } = __req("ui/rc_la_state.js");
  const { EDITOR_SOURCE } = __req("ui/rc_ingest.js");

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
  async function loadP6() {
    try {
      const [entries, flags] = await Promise.all([rc.listP6Activities(), rc.listP6Flags({ includeRetired: true })]);
      return { available: true, entries, flags, index: p6.p6Index(entries, flags) };
    } catch (err) {
      return { available: false, error: err, entries: [], flags: [], index: p6.p6Index([], []) };
    }
  }

  const UNREADABLE = 'The P6 list in calendar/p6.json could not be read. Try again once OneDrive has finished syncing the folder.';

  /** A row's Activity ID in words, for the hover — the same wording in the editor and the read view. */
  function p6Words(value, status) {
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
  function openP6Import({ host = null, onDone = null } = {}) {
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
  function openP6Picker({
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
  async function renderP6(host) {
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
      host.appendChild(emptyState({ iconName: 'warning', title: 'The P6 list could not be read', message: ctx.error?.message || UNREADABLE }));
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
      const who = authorNames(people)(newest.imported_by);
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

  Object.defineProperty(__x, "loadP6", { get: () => loadP6, enumerable: true });
  Object.defineProperty(__x, "p6Words", { get: () => p6Words, enumerable: true });
  Object.defineProperty(__x, "openP6Import", { get: () => openP6Import, enumerable: true });
  Object.defineProperty(__x, "openP6Picker", { get: () => openP6Picker, enumerable: true });
  Object.defineProperty(__x, "renderP6", { get: () => renderP6, enumerable: true });
};

// ui/rc_la_editor.js
__mods["ui/rc_la_editor.js"] = function (__x, __req) {
  /**
   * The look-ahead editor: the 4WLA, written in the calendar.
   *
   * It looks like the calendar grid it replaces the workbook for, and it behaves
   * like a spreadsheet, because that is what the two people who keep it are used
   * to: click a day and type "X.WIT", drag across a week and press a colour, drag
   * the corner to repeat it, copy a block and paste it — into Excel as well,
   * colours included — undo anything, insert a row or a section where it goes and
   * drag rows to where they belong. Five weeks at most, from any Monday; next week
   * simply appears when this one ends.
   *
   * Everything it does is an op from `core/la_edit.js`: applied here at once,
   * so typing never waits on the network, then saved in order through
   * `rc_la_apply()`. Every op expects the version it last saw, so when the other
   * administrator changes the same day at the same moment the save is refused and
   * the sheet reloads with their version, rather than one of them silently
   * losing. Once saves go quiet the look-ahead is published
   * (`publishFromEditor()`), which is what the calendar, the week plan, the huddle,
   * PTO and the cancellation log read.
   *
   * Only an administrator reaches it; `rc_la_apply()` refuses anybody else.
   *
   * The Activity ID column is filled from P6 rather than from memory: typing in
   * it searches the schedule's activities by name or ID, Alt+K links every
   * selected activity at once, and a row with no P6 activity says why from a
   * short list (`ui/rc_la_p6.js`, `core/la_p6.js`).
   *
   * Imports: util, rc, core/la_edit, core/la_p6, core/lookahead, io/lookahead,
   *          io/la_xlsx, io/exporters, filestore, icons, components, rc_util,
   *          rc_ingest, rc_la_state, rc_la_p6.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const filestore = __req("core/filestore.js");
  const ed = __req("core/la_edit.js");
  const p6 = __req("core/la_p6.js");
  const { readGrid, isCancelMeaning, countCodes, describeCodeCounts, cellTokens, cancellationNoteFor, cancellationReasonText } = __req("core/lookahead.js");



  const { parseSheet, applyLegend, readLegend, isDark } = __req("io/lookahead.js");
  const { lookaheadWorkbook, lookaheadFileName, lookaheadLatestName } = __req("io/la_xlsx.js");
  const { saveFile } = __req("io/exporters.js");
  const { icon } = __req("ui/icons.js");
  const { toast, confirmDialog, contextMenu, openModal, textInput, selectInput, segmented, emptyState, attachTooltip, checkbox } = __req("ui/components.js");



  const { notifyChanged, todayISO, nameRegister, foldName, codeNodes, authorNames } = __req("ui/rc_util.js");
  const { publishFromEditor, publishDays, EDITOR_SOURCE } = __req("ui/rc_ingest.js");
  const { la } = __req("ui/rc_la_state.js");
  const { loadP6, openP6Picker, openP6Import, p6Words } = __req("ui/rc_la_p6.js");

  /* ══════════════════════════════════════════════════════════════════════════
     State
     ═══════════════════════════════════════════════════════════════════════ */

  const META = ed.FIELDS.length; // six activity columns, then the days
  const SAVE_BATCH = 400;
  const POLL_MS = 20000;
  /** While the bell is connected (`rc.lookaheadLive()`), a poll is only a check on it. */
  const POLL_LIVE_MS = 120000;
  /**
   * How long the editor waits, quiet, before it takes a reading on its own.
   *
   * Done editing, and leaving the editor for another section, take one at once
   * (`flushEditor()`); this only catches an editor left open. It was two and a
   * half seconds while other people read the database live — every pause was a
   * reading — and each reading is now a file in the shared folder that OneDrive
   * uploads, so a reading is taken when somebody has finished, not when they
   * stopped to think. The edit log keeps the fine detail either way.
   */
  const PUBLISH_QUIET_MS = 120000;

  /**
   * The editor's state, kept for the life of the page so a redraw of the tab —
   * which any calendar write causes — never loses the selection, the undo
   * history or unsaved work.
   */
  const E = {
    model: null,
    loaded: null, // { from, to } — the days whose cells are in the model
    legend: [], // shift colours only: what the palette paints with
    legendAll: [],
    codes: [],
    title: '',
    start: null, // the Monday the window starts on
    weeks: 4,
    firstWritten: null, // the first day anything is written here — the editor holds nothing before its week
    filter: '',
    showArchived: false,
    collapsed: new Set(),
    anchor: { r: 0, c: META },
    focus: { r: 0, c: META },
    undo: [],
    redo: [],
    queue: [],
    saving: null, // the save under way, if any
    status: 'saved', // saved | saving | retry | conflict
    retryIn: 0,
    server: new Map(), // 'row:<id>' | 'cell:<row>|<day>' → the version the server holds
    revision: 0,
    dirtySincePublish: false,
    publishTimer: null,
    publishing: null, // the publish under way, so a flush can wait for it
    publishError: null, // why the last publish failed, so Done editing can say so
    pollTimer: null,
    clip: null,
    editing: null,
    root: null,
    view: null, // what is drawn: { rows, days, cols }
    // Who is on the team, for the staffing check: a lookup from a written name to
    // a person, and the leave booked in the calendar across the loaded days.
    resolveName: null,
    leave: [],
    leaveKinds: new Map(),
    staff: { issues: [], byCell: new Map() },
    scroll: { left: 0, top: 0 },
    // The schedule's activities and the reasons a row has none (`loadP6()`).
    p6: { available: false, entries: [], flags: [], index: p6.p6Index() },
  };

  /* ══════════════════════════════════════════════════════════════════════════
     Entry
     ═══════════════════════════════════════════════════════════════════════ */

  async function renderEditor(host) {
    E.root = host;
    if (!rc.isAdmin()) {
      host.appendChild(emptyState({
        iconName: 'lock',
        title: 'Administrators only',
        message: 'The look-ahead is written by its two owners. Everybody else sees it with Edit switched off.',
      }));
      return;
    }

    const [settings, legend, codes, people, aliases, leaveKinds, notes, schedule] = await Promise.all([
      rc.listSettings().catch(() => []),
      rc.listLegend().catch(() => []),
      rc.listSupportCodes({ includeRetired: true }).catch(() => []),
      rc.listPeople().catch(() => []),
      rc.listPersonAliases().catch(() => []),
      rc.listLeaveKinds().catch(() => []),
      // The reasons logged for cancellations, shown when a cancelled day is hovered.
      rc.listCancellationNotes().catch(() => []),
      loadP6(),
    ]);
    E.notes = notes;
    E.p6 = schedule;
    /* The same exact register the week plan reads names with — full name, alias,
       or a first name only one person has. A name it cannot place is somebody
       else's person, and the staffing check leaves it alone. */
    const register = nameRegister(people, aliases);
    const byId = new Map(people.map((p) => [p.id, p]));
    E.resolveName = (written) => {
      const id = register.get(foldName(written));
      return id ? { id, name: byId.get(id)?.name || String(written).trim() } : null;
    };
    E.leaveKinds = new Map(leaveKinds.map((k) => [k.id, k.name]));
    ({ all: E.legendAll, shifts: E.legend } = legendInForce(legend));
    E.codes = codes;
    E.names = ed.nameChoices(people);
    E.title = settings.find((r) => r.key === 'lookahead_title')?.value || '';
    if (!E.start) E.start = ed.mondayOf(todayISO());
    E.weeks = ed.WINDOW_WEEKS.includes(la.editorWeeks) ? la.editorWeeks : 4;

    if (la.source !== EDITOR_SOURCE) {
      await renderStart(host);
      return;
    }

    const first = !E.model;
    if (!E.model) await load();
    else await ensureLoaded();
    if (first) {
      // The caret starts on the first day of the first activity — the cell
      // somebody opening the look-ahead is most likely to want.
      const rows = visibleRows();
      const at = Math.max(0, rows.findIndex((r) => r.kind === 'activity'));
      const today = windowDays().indexOf(todayISO());
      E.anchor = { r: at, c: META + Math.max(0, today) };
      E.focus = { ...E.anchor };
    }
    draw();
    startPolling();
  }

  /** The legend as the editor paints with it: every row, and the shifts in force. */
  function legendInForce(rows) {
    const all = rows.map((r) => ({ argb: String(r.argb).toUpperCase(), meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from }));
    const inForce = new Map();
    for (const r of all) {
      const held = inForce.get(r.argb);
      if (!held || String(r.valid_from || '') > String(held.valid_from || '')) inForce.set(r.argb, r);
    }
    return { all, shifts: [...inForce.values()].filter((r) => r.role === 'shift' && r.meaning) };
  }

  /**
   * Save, then publish, now — called before another section is opened so it
   * reads the look-ahead as it stands rather than as it stood a few seconds ago.
   */
  async function flushEditor() {
    // A day still being typed into is part of what was meant.
    if (E.editing) commitEdit();
    /* Until nothing is queued and nothing is on its way: a save that was
       finishing when an edit arrived used to end with that edit still queued,
       and this returned with it unsent. */
    while (E.queue.length || E.saving) {
      await drain();
      if (E.status === 'conflict') break;
      if (E.status === 'retry') throw new Error('The look-ahead could not be saved — check the connection and try again.');
    }
    /* Always through `publish()`, which waits for one already under way. Only
       starting a publish when one was pending let the calendar open while the
       previous publish was still writing — and it drew the reading from before
       the edit, so a row taken off stayed on. */
    await publish();
    if (E.publishError) throw E.publishError;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Loading
     ═══════════════════════════════════════════════════════════════════════ */

  function windowDays() {
    return ed.windowDays(E.start, E.weeks);
  }

  /** The days the model must hold: what is on screen, and what a publish covers. */
  function neededRange() {
    const pub = publishDays(todayISO());
    const view = windowDays();
    const from = [pub[0], view[0]].sort()[0];
    const to = [pub[pub.length - 1], view[view.length - 1]].sort().reverse()[0];
    return { from, to };
  }

  async function load() {
    const { from, to } = neededRange();
    const [rows, cells] = await Promise.all([rc.listLaRows(), rc.listLaCells(from, to)]);
    E.model = ed.makeModel(rows.map(ed.cleanRow), cells.map(ed.cleanCell));
    E.loaded = { from, to };
    E.server = new Map();
    for (const r of E.model.rows) E.server.set(`row:${r.id}`, r.version || 0);
    for (const c of ed.cellList(E.model)) E.server.set(`cell:${c.row_id}|${c.day}`, c.version || 0);
    E.revision = await rc.lookaheadRevision().catch(() => E.revision);
    E.firstWritten = (await rc.laCellSpan().catch(() => ({ first: null }))).first;
    await loadLeave();
  }

  /** Leave booked across the loaded days — what the staffing check reads. */
  async function loadLeave() {
    if (!E.loaded) return;
    const rows = await rc.listLeave(E.loaded.from, E.loaded.to).catch(() => []);
    E.leave = rows.map((l) => ({ ...l, kind: E.leaveKinds.get(l.kind_id) || 'leave' }));
  }

  /** Widen what is loaded when somebody pages back or forward past it. */
  async function ensureLoaded() {
    const { from, to } = neededRange();
    if (E.loaded && from >= E.loaded.from && to <= E.loaded.to) return;
    const lo = E.loaded ? [from, E.loaded.from].sort()[0] : from;
    const hi = E.loaded ? [to, E.loaded.to].sort().reverse()[0] : to;
    const fetchFrom = E.loaded && from >= E.loaded.from ? ed.addDaysISO(E.loaded.to, 1) : lo;
    const fetchTo = E.loaded && to <= E.loaded.to ? ed.addDaysISO(E.loaded.from, -1) : hi;
    const cells = await rc.listLaCells(fetchFrom, fetchTo);
    for (const c of cells.map(ed.cleanCell)) {
      const key = ed.cellKey(c.row_id, c.day);
      if (!E.model.cells.has(key)) {
        E.model.cells.set(key, c);
        E.server.set(`cell:${key}`, c.version || 0);
      }
    }
    E.loaded = { from: lo, to: hi };
    await loadLeave();
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Starting: from the workbook, from a file, or from nothing
     ═══════════════════════════════════════════════════════════════════════ */

  async function renderStart(host) {
    const snapshot = await rc.latestSnapshot().catch(() => null);
    const existing = await rc.listLaRows().catch(() => []);

    const card = el('div', { class: 'lae-start' });
    card.append(
      el('div', { class: 'lae-start-icon', html: icon('edit', { size: 28 }) }),
      el('h2', { text: 'Write the look-ahead here' }),
      el('p', {
        class: 'rc-hint',
        text: 'Edit activities, sections, shifts and support codes directly in the calendar, and export an Excel '
          + 'copy in the 4WLA layout whenever the track allocation manager needs one. The workbook stops being read: '
          + 'from here on, the calendar is the look-ahead.',
      }),
    );

    const options = el('div', { class: 'lae-start-options' });
    if (existing.length) {
      options.appendChild(startOption({
        title: 'Carry on with the look-ahead already here',
        detail: `${plural(existing.filter((r) => r.kind === 'activity').length, 'activity', 'activities')} were written here before.`,
        label: 'Open the editor',
        primary: true,
        run: () => adopt(null),
      }));
    }
    if (snapshot?.grid?.rows?.length) {
      const preview = importPreview(snapshot.grid, snapshot.taken_at);
      options.appendChild(startOption({
        title: 'Start from the last reading of the workbook',
        detail: `${describeImport(preview.report)} — read ${new Date(snapshot.taken_at).toLocaleDateString()}.`,
        label: 'Start from it',
        primary: !existing.length,
        run: () => adopt(preview.model),
      }));
    }
    const file = el('input', { type: 'file', accept: '.xlsx', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const settings = await rc.listSettings().catch(() => []);
        const sheet = settings.find((r) => r.key === 'lookahead_sheet')?.value || '4WLA';
        const grid = parseSheet(await f.arrayBuffer(), sheet);
        const legend = await legendFor(grid);
        const preview = importPreview(applyLegend(grid, legend), new Date().toISOString(), legend);
        const ok = await confirmDialog({
          title: `Start from ${f.name}`,
          message: `${describeImport(preview.report)}. Past weeks, hidden rows and columns, and `
            + 'shading stay behind in the file.',
          confirmLabel: 'Start from it',
        });
        if (ok) await adopt(preview.model, titleOf(grid));
      } catch (err) {
        toast({ tone: 'bad', message: err.message, timeout: 12000 });
      }
    });
    options.appendChild(startOption({
      title: 'Start from a workbook',
      detail: 'Pick the current .xlsx. Only what is still ahead comes across.',
      label: 'Choose a file…',
      run: () => file.click(),
    }));
    options.appendChild(startOption({
      title: 'Start with an empty look-ahead',
      detail: 'Build it up from sections and activities.',
      label: 'Start empty',
      run: () => adopt(ed.makeModel([ed.blankRow('section', { sort: 1024, description: 'Section' })], [])),
    }));
    card.append(options, file);
    host.appendChild(card);
  }

  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  /** "12 activities in 4 sections, 90 filled days" — what a start would carry across. */
  function describeImport(report) {
    return `${plural(report.activities, 'activity', 'activities')} in ${plural(report.sections, 'section')}, `
      + `${plural(report.cells, 'filled day')} from this week on`;
  }

  function startOption({ title, detail, label, run, primary = false }) {
    let busy = false;
    return el('div', { class: 'lae-start-option' }, [
      el('div', {}, [el('strong', { text: title }), el('div', { class: 'rc-hint', text: detail })]),
      el('button', {
        class: `cx-btn mini${primary ? ' primary' : ''}`,
        type: 'button',
        text: label,
        onClick: async (e) => {
          if (busy) return;
          busy = true;
          e.currentTarget.disabled = true;
          try {
            await run();
          } catch (err) {
            toast({ tone: 'bad', message: err.message, timeout: 12000 });
            rc.reportError('lookahead:editor-start', err);
          } finally {
            busy = false;
          }
        },
      }),
    ]);
  }

  /** The legend a file is read against: the register, or the file's own key. */
  async function legendFor(grid) {
    const rows = await rc.listLegend().catch(() => []);
    if (rows.length) return rows.map((r) => ({ argb: r.argb, meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from }));
    return readLegend(grid).map((d) => ({ argb: d.argb, meaning: d.meaning, role: 'shift' }));
  }

  function titleOf(grid) {
    const first = (grid.rows || []).find((r) => r.row === 1);
    return first?.label || first?.cells?.find((c) => c.value)?.value || '';
  }

  function importPreview(grid, takenAt, legend = null) {
    const lg = legend || (grid.legend || []);
    const view = readGrid(grid, { anchorISO: String(takenAt || '').slice(0, 10) || null });
    return ed.modelFromView(view, { fromISO: ed.mondayOf(todayISO()), legend: lg.length ? lg : E.legendAll });
  }

  /** Make the editor the source: write the starting rows, flip the setting, publish. */
  async function adopt(model, title = null) {
    if (model) {
      const ops = [];
      for (const r of ed.orderedRows(model.rows, { archived: true })) {
        const { id, version, ...set } = r;
        ops.push({ op: 'row', id, set, expect: 0 });
      }
      for (const c of ed.cellList(model)) {
        ops.push({ op: 'cell', row_id: c.row_id, day: c.day, color: c.color, text: c.text, expect: 0 });
      }
      for (let i = 0; i < ops.length; i += SAVE_BATCH) await rc.applyLookaheadOps(ops.slice(i, i + SAVE_BATCH));
    }
    if (title) await rc.setSetting('lookahead_title', title).catch(() => {});
    await rc.setSetting('lookahead_source', EDITOR_SOURCE);
    la.source = EDITOR_SOURCE;
    la.section = 'calendar';
    la.editing = true;
    E.model = null;
    await load();
    E.dirtySincePublish = true;
    await publish();
    toast({ tone: 'good', message: 'The look-ahead is written here now. The workbook is no longer read.' });
    notifyChanged('lookahead');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Drawing
     ═══════════════════════════════════════════════════════════════════════ */

  function visibleRows() {
    const ordered = ed.orderedRows(E.model.rows, { archived: E.showArchived });
    const needle = E.filter.trim().toLowerCase();
    const out = [];
    let hiddenUntilLevel = null;
    for (let i = 0; i < ordered.length; i++) {
      const r = ordered[i];
      if (hiddenUntilLevel != null) {
        if (r.kind === 'section' && (r.level || 0) <= hiddenUntilLevel) hiddenUntilLevel = null;
        else continue;
      }
      out.push(r);
      if (r.kind === 'section' && E.collapsed.has(r.id)) hiddenUntilLevel = r.level || 0;
    }
    if (!needle) return out;
    // A filter keeps the rows that match, the names under them and the sections above.
    // The P6 name of the activity a row names counts too: the row may word it differently.
    const text = (r) => [r.activity_id, r.description, r.location, r.sswp, r.party, r.work_hours,
      p6.p6Status(r.activity_id, E.p6.index).entry?.name || ''].join(' ').toLowerCase();
    const keep = new Set();
    out.forEach((r) => {
      if (r.kind !== 'resource' && text(r).includes(needle)) keep.add(r.id);
    });
    for (const r of out) if (r.kind === 'resource' && keep.has(r.parent_id)) keep.add(r.id);
    let section = [];
    const result = [];
    for (const r of out) {
      if (r.kind === 'section') {
        section = section.filter((s) => (s.level || 0) < (r.level || 0));
        section.push(r);
        continue;
      }
      if (!keep.has(r.id)) continue;
      for (const s of section) if (!result.includes(s)) result.push(s);
      result.push(r);
    }
    return result.length ? result : [];
  }

  /** The reason logged for a cancelled day on a row, or one struck-out code. */
  function reasonFor(row, day, codes = '') {
    const key = ed.cancellationKey(row);
    return cancellationReasonText(cancellationNoteFor(E.notes, {
      label: key.raw_label, meta: [key.raw_location], day, codes, rowId: key.la_row_id,
    }));
  }

  /** A note just written, kept so the hover says it before the next load. */
  function rememberNote(note) {
    if (note) E.notes = [...(E.notes || []), note];
  }

  function draw() {
    const host = E.root;
    if (!host) return;
    const days = windowDays();
    const rows = visibleRows();
    E.view = { rows, days, cols: META + days.length };
    clampSelection();
    E.staff = staffing(days);

    const prevScroll = host.querySelector('.lae-scroll');
    if (prevScroll) E.scroll = { left: prevScroll.scrollLeft, top: prevScroll.scrollTop };
    /* A redraw replaces the grid, and with it whatever had the keyboard. Unless
       somebody is in a dialog or the search box, the keyboard goes back to the
       grid — otherwise every edit would leave the next shortcut talking to
       nothing, and Ctrl+Z straight after a paste would do nothing at all. */
    const active = document.activeElement;
    const refocus = !active || active === document.body || (host.contains(active) && !active.classList.contains('lae-search'));
    clear(host);

    host.append(toolbar(days));
    /* Before the first week written here the editor holds nothing: it was
       started from the workbook from the week it was adopted. Said, rather than
       shown as empty rows, with where those days are. */
    if (E.firstWritten && days[0] < ed.mondayOf(E.firstWritten)) {
      host.appendChild(el('p', {
        class: 'rc-hint lae-before-note',
        text: `Nothing is written here before ${fmtLong(ed.mondayOf(E.firstWritten))}: the look-ahead was brought across `
          + 'from the workbook from that week on. What the workbook said for the days before it is in the calendar — '
          + 'switch Edit off and page back.',
      }));
    }
    host.appendChild(grid(rows, days));
    const scroller = host.querySelector('.lae-scroll');
    scroller.scrollLeft = E.scroll.left;
    scroller.scrollTop = E.scroll.top;
    paintSelection();
    if (refocus) scroller.focus({ preventScroll: true });
  }

  /**
   * Redraw after an edit — only the days it touched, where that is all it changed.
   *
   * Painting a week, typing a code, a paste, a fill, an undo of any of those:
   * nearly every edit is cell ops alone, and none of them can change which rows
   * are shown (the filter reads a row's own fields, never its days), so the
   * grid's structure is what it was. Rebuilding it anyway cost a five-week sheet
   * thousands of nodes per keystroke, and dropped the keyboard with them (see
   * the trap in CLAUDE.md). Here the touched days are drawn again in place, with
   * every day whose staffing clash came or went — a name typed on one day can
   * clash another — and the support totals beneath. Anything else — a row op,
   * a clash count that changed the toolbar, a grid not on screen — is `draw()`.
   */
  function redrawAfter(ops) {
    const host = E.root;
    const body = host?.querySelector('.lae-grid tbody');
    if (!body || !E.view || E.editing || !ops.every((op) => op.op === 'cell')) { draw(); return; }
    const clashCount = (staff) => new Set(staff.issues.map((i) => `${i.person_id}|${i.day}|${i.kind}`)).size;
    const before = E.staff;
    const after = staffing(E.view.days);
    if (clashCount(after) !== clashCount(before)) { draw(); return; }
    E.staff = after;

    const said = (byCell, key) => (byCell.get(key) || []).map((x) => x.detail).join('\n');
    const keys = new Set(ops.map((op) => ed.cellKey(op.row_id, op.day)));
    for (const key of new Set([...before.byCell.keys(), ...after.byCell.keys()])) {
      if (said(before.byCell, key) !== said(after.byCell, key)) keys.add(key);
    }

    const active = document.activeElement;
    const refocus = !active || active === document.body;
    redrawDays(keys);
    host.querySelector('.lae-grid tfoot tr')?.replaceWith(totalsRow(E.view.days, todayISO()));
    paintSelection();
    refreshStatus();
    if (refocus) host.querySelector('.lae-scroll')?.focus({ preventScroll: true });
  }

  /** Draw these days (`cellKey()`s) again where they stand, and nothing else. */
  function redrawDays(keys) {
    const body = E.root?.querySelector('.lae-grid tbody');
    if (!body || !E.view) return;
    const today = todayISO();
    const rowsById = new Map(E.view.rows.map((r) => [r.id, r]));
    const column = new Map(E.view.days.map((d, i) => [d, i]));
    for (const key of keys) {
      const [rowId, day] = key.split('|');
      const row = rowsById.get(rowId);
      const i = column.get(day);
      if (!row || i == null) continue; // folded away, filtered out or off the window
      const td = body.querySelector(`tr[data-id="${CSS.escape(rowId)}"] td[data-c="${META + i}"]`);
      if (td) td.replaceWith(dayCell(row, day, i, today));
    }
  }

  /**
   * Draw the days a note was just logged against again, so hovering them says
   * the reason — in place, as an edit does. The note lands when the network
   * answers, and by then somebody may be typing in the next cell: redrawing the
   * whole grid here took the box they were typing in away with the old one.
   */
  function redrawNoted(runs) {
    const keys = new Set();
    for (const run of runs) {
      // A note is found by its row, so another row worded the same does not show it.
      const rows = (E.view?.rows || []).filter((r) => r.id === run.row.id);
      for (const row of rows) {
        for (let d = run.start; d <= run.end; d = ed.addDaysISO(d, 1)) keys.add(ed.cellKey(row.id, d));
      }
    }
    const active = document.activeElement;
    redrawDays(keys);
    paintSelection();
    // The dialog that asked has gone, and took the keyboard with it.
    if (!active || active === document.body) E.root?.querySelector('.lae-scroll')?.focus({ preventScroll: true });
  }

  /**
   * Is everybody on the team named where they can be? Only the names rows and
   * the PTO row, against the roster and the leave booked in the calendar — never
   * the support an activity asks for (`staffingIssues()` in `core/la_edit.js`).
   */
  function staffing(days) {
    if (!E.resolveName) return { issues: [], byCell: new Map() };
    const meaning = (hex) => E.legendAll.find((e) => e.argb === hex)?.meaning || '';
    return ed.staffingIssues(E.model, days, {
      resolve: E.resolveName,
      leave: E.leave,
      isShift: (hex) => !!meaning(hex) && !isCancelMeaning(meaning(hex)),
      shiftOf: (hex) => meaning(hex) || `#${hex}`,
    });
  }

  /** Every clash in the window, by day, each one a click from its cell. */
  function clashesDialog() {
    const issues = E.staff.issues;
    const rowsOnScreen = E.view.rows;
    const body = el('div', { class: 'lae-form lae-clashes' });
    const byDay = new Map();
    for (const i of issues) {
      if (!byDay.has(i.day)) byDay.set(i.day, []);
      byDay.get(i.day).push(i);
    }
    let handle = null;
    for (const [day, list] of [...byDay.entries()].sort()) {
      body.appendChild(el('div', { class: 'lae-clash-day', text: fmtLong(day) }));
      const seen = new Set();
      for (const i of list) {
        const key = `${i.person_id}|${i.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const r = rowsOnScreen.findIndex((row) => row.id === i.row_id);
        const c = META + E.view.days.indexOf(day);
        body.appendChild(el('div', { class: 'lae-clash-item' }, [
          el('span', { class: `cx-badge ${i.kind === 'shifts' ? 'warn' : 'bad'}`, text: CLASH_LABELS[i.kind] }),
          el('span', { class: 'lae-clash-detail', text: i.detail }),
          r >= 0 && c >= META
            ? el('button', {
              class: 'cx-btn mini ghost', type: 'button', text: 'Show',
              onClick: () => { handle?.close(); select(r, c); focusGrid(); },
            })
            : el('span', { class: 'rc-hint', text: 'in a folded section' }),
        ]));
      }
    }
    handle = openModal({
      title: 'Who is named where they cannot be',
      subtitle: 'Your team only: names rows against the PTO row, the leave booked in the calendar, and one shift a day. Support requested is not counted.',
      body,
      actions: [{ label: 'Close' }],
    });
  }

  const CLASH_LABELS = { leave: 'On leave', pto: 'On PTO', shifts: 'Two shifts' };

  function fmtLong(iso) {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function toolbar(days) {
    const bar = el('div', { class: 'lae-toolbar' });

    /* The window: which Monday, and four weeks or five. */
    const range = el('div', { class: 'lae-group' }, [
      iconButton('chevron-left', 'Previous week', () => moveWindow(-7)),
      el('button', {
        class: 'cx-btn mini ghost', type: 'button', text: 'This week',
        title: 'Start the window on this week\'s Monday', onClick: () => { E.start = ed.mondayOf(todayISO()); redrawWindow(); },
      }),
      iconButton('chevron-right', 'Next week', () => moveWindow(7)),
      el('span', { class: 'lae-range', text: `${fmt(days[0])} – ${fmt(days[days.length - 1])}` }),
      segmented({
        value: E.weeks,
        options: ed.WINDOW_WEEKS.map((w) => ({ value: w, label: `${w} weeks` })),
        onChange: (w) => { E.weeks = w; la.editorWeeks = w; redrawWindow(); },
      }),
    ]);

    const add = el('div', { class: 'lae-group' }, [
      el('button', {
        class: 'cx-btn mini primary', type: 'button', html: icon('plus', { size: 12 }) + '<span>Activity</span>',
        title: 'Add an activity below the selected row', onClick: () => insertRow('activity'),
      }),
      el('button', {
        class: 'cx-btn mini', type: 'button', html: icon('plus', { size: 12 }) + '<span>Section</span>',
        title: 'Add a section heading below the selected row', onClick: () => insertRow('section'),
      }),
    ]);

    /* Paint: the legend's shift colours, and nothing else. */
    const palette = el('div', { class: 'lae-group lae-palette', role: 'group', 'aria-label': 'Paint the selected days' });
    E.legend.forEach((entry, i) => {
      const swatch = el('button', {
        class: 'lae-swatch', type: 'button',
        style: `background-color:#${entry.argb}`,
        'aria-label': `Paint ${entry.meaning}`,
        onClick: () => paint(entry.argb),
      });
      attachTooltip(swatch, `${entry.meaning}${i < 9 ? `  ·  Alt+${i + 1}` : ''}`);
      palette.appendChild(swatch);
    });
    const eraser = el('button', {
      class: 'lae-swatch lae-swatch-none', type: 'button', 'aria-label': 'Remove the colour',
      html: icon('x', { size: 12 }), onClick: () => paint(null),
    });
    attachTooltip(eraser, 'No colour  ·  Alt+0');
    palette.appendChild(eraser);

    /* Support: one press adds a code to every selected day. */
    const support = el('div', { class: 'lae-group lae-codes', role: 'group', 'aria-label': 'Add support to the selected days' });
    for (const code of E.codes.filter((c) => c.active !== false)) {
      const chip = el('button', {
        class: 'lae-code', type: 'button', text: String(code.code).toUpperCase(),
        'aria-label': `Add ${code.name || code.code}`,
        onClick: (e) => addCode(String(code.code).toUpperCase(), e.shiftKey ? -1 : 1),
      });
      attachTooltip(chip, `${code.name || code.code}${code.party ? ` (${code.party})` : ''} — click to add, Shift+click to take one away`);
      support.appendChild(chip);
    }

    const status = el('span', { class: `lae-status lae-status-${E.status}`, role: 'status', 'aria-live': 'polite' }, [
      el('span', { class: 'lae-status-dot' }),
      el('span', { text: statusText() }),
    ]);

    const clashCount = new Set(E.staff.issues.map((i) => `${i.person_id}|${i.day}|${i.kind}`)).size;
    const right = el('div', { class: 'lae-group lae-right' }, [
      clashCount
        ? el('button', {
          class: 'cx-btn mini lae-clash-btn', type: 'button',
          html: icon('alert', { size: 12 }) + `<span>${clashCount} staffing clash${clashCount === 1 ? '' : 'es'}</span>`,
          title: 'People on your team named on a day they are off, or on two shifts',
          onClick: () => clashesDialog(),
        })
        : null,
      iconButton('undo', 'Undo  (Ctrl+Z)', () => undo(), !E.undo.length),
      iconButton('redo', 'Redo  (Ctrl+Y)', () => redo(), !E.redo.length),
      status,
      el('button', {
        class: 'cx-btn mini primary', type: 'button', html: icon('download', { size: 12 }) + '<span>Export to Excel</span>',
        onClick: () => openExport(),
      }),
      iconButton('settings', 'More', (e) => moreMenu(e)),
    ].filter(Boolean));

    const search = textInput({
      value: E.filter,
      placeholder: 'Find a row…',
      mini: true,
      'aria-label': 'Find a row',
      onInput: (v) => {
        E.filter = v;
        // Only the grid is redrawn, never the box being typed in.
        const old = E.root.querySelector('.lae-scroll');
        const days2 = windowDays();
        const rows = visibleRows();
        E.view = { rows, days: days2, cols: META + days2.length };
        clampSelection();
        old.replaceWith(grid(rows, days2));
        paintSelection();
      },
    });
    search.classList.add('lae-search');

    bar.append(...[range, add, palette, support, p6Group(), search, right].filter(Boolean));
    return bar;
  }

  /**
   * P6: link the selected activities, and how many are still to do — one press
   * from the next of them. Before anything is imported it is the way to import.
   */
  function p6Group() {
    if (!E.p6.available) return null;
    if (!E.p6.entries.length) {
      return el('div', { class: 'lae-group lae-p6-group' }, [
        el('button', {
          class: 'cx-btn mini lae-p6-import', type: 'button', html: icon('upload', { size: 12 }) + '<span>Import P6 activities</span>',
          title: 'Read the schedule\'s activity IDs and names from a P6 extract, so rows can be linked to them',
          onClick: () => importP6(),
        }),
      ]);
    }
    const coverage = p6.p6Coverage(E.model.rows, E.p6.index);
    const todo = coverage.empty + coverage.unknown;
    const why = [
      coverage.empty ? `${coverage.empty} with no Activity ID` : null,
      coverage.unknown ? `${coverage.unknown} with an ID the P6 list does not have` : null,
    ].filter(Boolean).join(' · ');
    return el('div', { class: 'lae-group lae-p6-group' }, [
      el('button', {
        class: 'cx-btn mini lae-p6-link', type: 'button', html: icon('link', { size: 12 }) + '<span>Link to P6</span>',
        title: 'Link the selected activities to a P6 activity, or say why they have none  (Alt+K)',
        onClick: () => linkSelection(),
      }),
      coverage.activities
        ? el('button', {
          class: `cx-btn mini ghost lae-p6-todo${todo ? ' lae-p6-open' : ''}`, type: 'button',
          text: todo ? `${todo} not linked` : 'All linked',
          title: todo ? `${why} — go to the next one` : 'Every activity names a P6 activity or says why it has none',
          disabled: !todo,
          onClick: () => nextUnlinked(),
        })
        : null,
    ].filter(Boolean));
  }

  function statusText() {
    if (E.status === 'saving') return 'Saving…';
    if (E.status === 'retry') return `Not saved — retrying${E.retryIn ? ` in ${E.retryIn}s` : ''}`;
    if (E.status === 'conflict') return 'Reloaded';
    return 'All changes saved';
  }

  function refreshStatus() {
    const node = E.root?.querySelector('.lae-status');
    if (!node) return;
    node.className = `lae-status lae-status-${E.status}`;
    node.lastChild.textContent = statusText();
    const buttons = E.root.querySelectorAll('.lae-right .cx-btn.icon');
    if (buttons[0]) buttons[0].disabled = !E.undo.length;
    if (buttons[1]) buttons[1].disabled = !E.redo.length;
  }

  function iconButton(name, label, onClick, disabled = false) {
    return el('button', {
      class: 'cx-btn mini ghost icon', type: 'button', 'aria-label': label, title: label,
      html: icon(name, { size: 14 }), disabled, onClick,
    });
  }

  function fmt(iso) {
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  async function moveWindow(delta) {
    E.start = ed.addDaysISO(E.start, delta);
    await redrawWindow();
  }

  async function redrawWindow() {
    await ensureLoaded();
    draw();
  }

  function grid(rows, days) {
    const today = todayISO();
    const table = el('table', { class: 'lae-grid', role: 'grid', 'aria-label': 'Look-ahead editor' });

    /* Three header rows, as on the sheet: the month band, day numbers, weekday letters. */
    const h1 = el('tr');
    const h2 = el('tr');
    const h3 = el('tr');
    h1.appendChild(el('th', { class: 'lae-handle-head', rowspan: '3' }));
    ed.FIELDS.forEach((f, i) => h1.appendChild(el('th', {
      class: `lae-meta lae-meta-${f.key}${i === META - 1 ? ' lae-meta-last' : ''}`, rowspan: '3', text: f.heading,
    })));
    let i = 0;
    while (i < days.length) {
      let j = i;
      while (j + 1 < days.length && ed.monthLabel(days[j + 1]) === ed.monthLabel(days[i])) j++;
      h1.appendChild(el('th', { class: 'lae-month', colspan: String(j - i + 1), text: ed.monthLabel(days[i]) }));
      i = j + 1;
    }
    days.forEach((d) => {
      const cls = `${ed.isWeekend(d) ? 'lae-weekend' : ''}${d === today ? ' lae-today' : ''}`;
      h2.appendChild(el('th', { class: `lae-num ${cls}`, text: String(Number(d.slice(8, 10))) }));
      h3.appendChild(el('th', { class: `lae-wd ${cls}`, text: ed.weekdayLetter(d), title: d === today ? 'Today' : '' }));
    });
    table.appendChild(el('thead', {}, [h1, h2, h3]));

    const body = el('tbody');
    rows.forEach((row, r) => body.appendChild(bodyRow(row, r, days, today)));
    table.appendChild(body);

    /* What is asked for, day by day. */
    table.appendChild(el('tfoot', {}, [totalsRow(days, today)]));

    const scroller = el('div', { class: 'lae-scroll', tabindex: '0', 'aria-label': 'Look-ahead editor grid' }, [table]);
    if (!rows.length) {
      scroller.appendChild(emptyState({
        iconName: E.filter ? 'search' : 'list',
        title: E.filter ? 'No rows match' : 'Nothing here yet',
        message: E.filter ? 'Try other words, or clear the search.' : 'Add a section, then the activities under it.',
        action: E.filter ? null : { label: 'Add a section', onClick: () => insertRow('section') },
      }));
    }
    wire(scroller);
    return scroller;
  }

  function bodyRow(row, r, days, today) {
    const tr = el('tr', { class: `lae-row lae-${row.kind}${row.archived ? ' lae-archived' : ''}`, dataset: { r: String(r), id: row.id } });
    const handle = el('td', { class: 'lae-handle', title: 'Drag to move · right-click for more' }, [
      el('span', { class: 'lae-grip', html: icon('move', { size: 12 }), 'aria-label': 'Move row' }),
    ]);
    if (row.kind === 'section') {
      const open = !E.collapsed.has(row.id);
      handle.appendChild(el('button', {
        class: 'lae-fold', type: 'button', 'aria-expanded': String(open),
        'aria-label': open ? 'Fold this section' : 'Unfold this section',
        html: icon(open ? 'chevron-down' : 'chevron-right', { size: 12 }),
        onClick: (e) => {
          e.stopPropagation();
          if (open) E.collapsed.add(row.id);
          else E.collapsed.delete(row.id);
          draw();
        },
      }));
    }
    tr.appendChild(handle);

    const meta = ed.metaValues(row);
    meta.forEach((value, c) => {
      const td = el('td', {
        class: `lae-cell lae-meta lae-meta-${ed.FIELDS[c].key}${c === META - 1 ? ' lae-meta-last' : ''}`,
        dataset: { c: String(c) },
        text: value,
      });
      if (row.kind === 'section' && c === 1) td.style.paddingLeft = `${8 + (row.level || 0) * 14}px`;
      if (!editable(row, c)) td.classList.add('lae-fixed');
      if (c === 0 && row.kind === 'activity') markP6(td, value);
      tr.appendChild(td);
    });

    days.forEach((d, i) => tr.appendChild(dayCell(row, d, i, today)));
    return tr;
  }

  /**
   * What an activity's Activity ID says, on its cell: a P6 activity (its name on
   * the hover), a reason it has none, something neither list has — marked, never
   * corrected — or nothing yet. Before anything is imported every ID is simply
   * what was typed, and only a reason is recognised.
   */
  function markP6(td, value) {
    if (!E.p6.available) return;
    const status = p6.p6Status(value, E.p6.index);
    if (!E.p6.entries.length && status.kind !== 'flagged') return;
    td.classList.add(`lae-p6-${status.kind}`);
    if (status.kind === 'linked' && status.entry.missing) td.classList.add('lae-p6-missing');
    // A reason is a word, not an ID: drawn on a pill, so the column reads at a glance.
    if (status.kind === 'flagged') td.replaceChildren(el('span', { class: 'lae-p6-pill', text: value }));
    td.title = status.kind === 'empty' ? 'No P6 activity yet — type to search P6, or Alt+K'
      : status.kind === 'unknown' ? `${p6Words(value, status)} — type to search P6, or Alt+K`
        : p6Words(value, status);
  }

  /** The support asked for, day by day: the grid's last row. */
  function totalsRow(days, today) {
    const totals = ed.supportTotals(E.model, days);
    const foot = el('tr', { class: 'lae-totals' });
    foot.appendChild(el('td', { class: 'lae-handle' }));
    foot.appendChild(el('td', {
      class: 'lae-meta lae-meta-last lae-totals-label', colspan: String(META),
      text: 'Support requested',
      title: 'Every support code on every activity, counted per day',
    }));
    days.forEach((d) => {
      const counts = totals.byDay.get(d);
      const text = counts && counts.size ? ed.describeCounts(counts, E.codes).replace(/ · /g, '\n') : '';
      foot.appendChild(el('td', {
        class: `lae-total${ed.isWeekend(d) ? ' lae-weekend' : ''}${d === today ? ' lae-today' : ''}`,
        text,
        title: text ? `${d}: ${ed.describeCounts(counts, E.codes)}` : '',
      }));
    });
    return foot;
  }

  /** One day of one row, as drawn — the unit an edit that only touches cells redraws. */
  function dayCell(row, d, i, today) {
    const c = META + i;
    const cell = row.kind === 'section' ? null : ed.getCell(E.model, row.id, d);
    const cls = ['lae-cell', 'lae-day'];
    if (ed.isWeekend(d)) cls.push('lae-weekend');
    if (d === today) cls.push('lae-today');
    if (cell?.color) {
      cls.push('lae-painted');
      if (isDark(cell.color)) cls.push('lae-dark');
      const known = E.legendAll.find((e) => e.argb === cell.color);
      if (known && /cancel/i.test(known.meaning || '')) cls.push('lae-cancel');
    }
    let title = '';
    if (row.kind === 'activity' && cell?.text) {
      const parsed = ed.parseSupport(cell.text, E.codes);
      if (parsed.unknown.length && looksLikeCodes(cell.text)) {
        cls.push('lae-unknown-code');
        title = `Not a support code yet: ${parsed.unknown.join(', ')} — add it under Legend → Support codes`;
      } else if (parsed.tokens.length && looksLikeCodes(cell.text)) {
        title = parsed.tokens.map((t) => codeName(t.code)).join(' + ');
      }
      const struck = ed.cancelledTokens(cell.text);
      if (struck.length && looksLikeCodes(cell.text)) {
        title = [title, `Cancelled: ${struck.map(codeName).join(' + ')}`, reasonFor(row, d, struck.join('.'))]
          .filter(Boolean).join(' · ');
      }
    }
    if (cell?.color) {
      const meaning = E.legendAll.find((e) => e.argb === cell.color)?.meaning;
      const why = cls.includes('lae-cancel') ? reasonFor(row, d) : '';
      if (meaning) title = [meaning, why, title].filter(Boolean).join(' · ');
    }
    // Names are wider than a day; the whole list is one hover away.
    if (!title && cell?.text) title = cell.text;
    const clashes = E.staff.byCell.get(ed.cellKey(row.id, d));
    if (clashes?.length) {
      cls.push('lae-clash');
      title = [...new Set(clashes.map((x) => x.detail))].join('\n') + (title ? `\n${title}` : '');
    }
    const td = el('td', {
      class: cls.join(' '), dataset: { c: String(c) }, title,
    }, row.kind === 'activity'
      ? codeNodes(cell?.text || '', 'lae-code-cancelled', (code) => reasonFor(row, d, code))
      : [cell?.text || '']);
    if (cell?.color) td.style.backgroundColor = `#${cell.color}`;
    if (!editable(row, c)) td.classList.add('lae-fixed');
    return td;
  }

  function codeName(code) {
    const c = E.codes.find((x) => String(x.code).toUpperCase() === code);
    return c ? (c.name || c.code) : code;
  }

  function looksLikeCodes(text) {
    return /^~?[A-Za-z0-9]{1,8}(\.~?[A-Za-z0-9]{1,8})*$/.test(String(text).trim());
  }

  /** What may be typed where. */
  function editable(row, c) {
    if (!row) return false;
    if (c < META) {
      if (row.kind === 'activity') return true;
      if (row.kind === 'section' || row.kind === 'absence') return c === 1;
      return false; // a Resource row's left-hand side is its activity's
    }
    return row.kind !== 'section';
  }

  function paintable(row, c) {
    return row?.kind === 'activity' && c >= META;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Selection
     ═══════════════════════════════════════════════════════════════════════ */

  function clampSelection() {
    const maxR = Math.max(0, (E.view?.rows.length || 1) - 1);
    const maxC = Math.max(0, (E.view?.cols || 1) - 1);
    for (const p of [E.anchor, E.focus]) {
      p.r = Math.min(Math.max(0, p.r), maxR);
      p.c = Math.min(Math.max(0, p.c), maxC);
    }
  }

  function rect() {
    return {
      r0: Math.min(E.anchor.r, E.focus.r),
      r1: Math.max(E.anchor.r, E.focus.r),
      c0: Math.min(E.anchor.c, E.focus.c),
      c1: Math.max(E.anchor.c, E.focus.c),
    };
  }

  function tdAt(r, c) {
    return E.root?.querySelector(`.lae-grid tbody tr[data-r="${r}"] td[data-c="${c}"]`) || null;
  }

  function paintSelection() {
    const root = E.root;
    if (!root) return;
    for (const n of root.querySelectorAll('.lae-sel, .lae-cur, .lae-sel-row')) n.classList.remove('lae-sel', 'lae-cur', 'lae-sel-row');
    root.querySelector('.lae-fill-handle')?.remove();
    if (!E.view?.rows.length) return;
    const { r0, r1, c0, c1 } = rect();
    for (let r = r0; r <= r1; r++) {
      const tr = root.querySelector(`.lae-grid tbody tr[data-r="${r}"]`);
      if (!tr) continue;
      if (c0 === 0 && c1 === E.view.cols - 1) tr.classList.add('lae-sel-row');
      for (let c = c0; c <= c1; c++) tr.querySelector(`td[data-c="${c}"]`)?.classList.add('lae-sel');
    }
    const cur = tdAt(E.focus.r, E.focus.c);
    cur?.classList.add('lae-cur');
    const corner = tdAt(r1, c1);
    if (corner) {
      corner.appendChild(el('span', { class: 'lae-fill-handle', title: 'Drag to repeat the selection', 'aria-hidden': 'true' }));
    }
    E.root.querySelector('.lae-range-info')?.remove();
  }

  function select(r, c, extend = false) {
    E.focus = { r, c };
    if (!extend) E.anchor = { r, c };
    clampSelection();
    paintSelection();
    tdAt(E.focus.r, E.focus.c)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** The selected cells as `{ row, c, day }`. */
  function selectedCells() {
    const { r0, r1, c0, c1 } = rect();
    const out = [];
    for (let r = r0; r <= r1; r++) {
      const row = E.view.rows[r];
      for (let c = c0; c <= c1; c++) out.push({ row, r, c, day: c >= META ? E.view.days[c - META] : null });
    }
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Input
     ═══════════════════════════════════════════════════════════════════════ */

  function wire(scroller) {
    scroller.addEventListener('scroll', () => { E.scroll = { left: scroller.scrollLeft, top: scroller.scrollTop }; });
    scroller.addEventListener('keydown', onKey);

    let dragging = null;
    scroller.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (E.editing && !E.editing.input.contains(e.target)) commitEdit();
      if (e.target.closest('.lae-fold')) return;

      if (e.target.classList.contains('lae-fill-handle')) {
        e.preventDefault();
        dragging = { kind: 'fill', from: rect(), to: { ...E.focus } };
        scroller.focus({ preventScroll: true });
        return;
      }
      const handle = e.target.closest('td.lae-handle');
      if (handle) {
        const tr = handle.closest('tr[data-r]');
        if (!tr) return;
        e.preventDefault();
        const r = Number(tr.dataset.r);
        E.anchor = { r, c: 0 };
        E.focus = { r, c: E.view.cols - 1 };
        paintSelection();
        scroller.focus({ preventScroll: true });
        dragging = { kind: 'row', from: r, over: r, moved: false, y: e.clientY };
        return;
      }
      const td = e.target.closest('td[data-c]');
      const tr = td?.closest('tr[data-r]');
      if (!td || !tr) return;
      e.preventDefault();
      scroller.focus({ preventScroll: true });
      select(Number(tr.dataset.r), Number(td.dataset.c), e.shiftKey);
      dragging = { kind: 'select' };
    });

    scroller.addEventListener('mouseover', (e) => {
      if (!dragging) return;
      const td = e.target.closest('td[data-c], td.lae-handle');
      const tr = td?.closest('tr[data-r]');
      if (!tr) return;
      const r = Number(tr.dataset.r);
      if (dragging.kind === 'select' && td.dataset.c != null) {
        E.focus = { r, c: Number(td.dataset.c) };
        paintSelection();
      } else if (dragging.kind === 'fill' && td.dataset.c != null) {
        dragging.to = { r, c: Number(td.dataset.c) };
        showFillPreview(dragging);
      } else if (dragging.kind === 'row') {
        dragging.over = r;
        dragging.moved = dragging.moved || r !== dragging.from;
        showDropLine(r > dragging.from ? r + 1 : r);
      }
    });

    const end = () => {
      if (!dragging) return;
      const d = dragging;
      dragging = null;
      E.root?.querySelector('.lae-drop-line')?.remove();
      for (const n of E.root?.querySelectorAll('.lae-fill-preview') || []) n.classList.remove('lae-fill-preview');
      if (d.kind === 'fill') applyFill(d.from, d.to);
      if (d.kind === 'row' && d.moved) moveRowTo(d.from, d.over);
    };
    document.addEventListener('mouseup', end);

    scroller.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td[data-c]');
      const tr = td?.closest('tr[data-r]');
      if (!td || !tr) return;
      select(Number(tr.dataset.r), Number(td.dataset.c));
      startEdit(null);
    });

    scroller.addEventListener('contextmenu', (e) => {
      const td = e.target.closest('td[data-c], td.lae-handle');
      const tr = td?.closest('tr[data-r]');
      if (!tr) return;
      e.preventDefault();
      const r = Number(tr.dataset.r);
      const c = td.dataset.c != null ? Number(td.dataset.c) : null;
      const { r0, r1, c0, c1 } = rect();
      const inside = r >= r0 && r <= r1 && (c == null || (c >= c0 && c <= c1));
      if (!inside) {
        if (c == null) {
          E.anchor = { r, c: 0 };
          E.focus = { r, c: E.view.cols - 1 };
          paintSelection();
        } else {
          select(r, c);
        }
      }
      cellMenu(e.clientX, e.clientY, E.view.rows[r]);
    });

    /* The clipboard, through the events every browser raises — no permission
       prompt, and the HTML flavour is what carries colours to and from Excel. */
    const mine = () => E.root && document.activeElement === scroller && !E.editing;
    const onCopy = (e) => { if (mine()) { e.preventDefault(); copy(e.clipboardData, false); } };
    const onCut = (e) => { if (mine()) { e.preventDefault(); copy(e.clipboardData, true); } };
    const onPaste = (e) => { if (mine()) { e.preventDefault(); paste(e.clipboardData); } };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    // A redraw replaces the scroller; the old one's document listeners go with it.
    const stop = new MutationObserver(() => {
      if (!scroller.isConnected) {
        document.removeEventListener('copy', onCopy);
        document.removeEventListener('cut', onCut);
        document.removeEventListener('paste', onPaste);
        document.removeEventListener('mouseup', end);
        stop.disconnect();
      }
    });
    if (E.root) stop.observe(E.root, { childList: true, subtree: true });
  }

  function onKey(e) {
    if (E.editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const { rows, cols } = E.view;
    if (!rows.length) return;
    const move = (dr, dc, extend) => {
      e.preventDefault();
      const base = E.focus;
      select(Math.min(Math.max(0, base.r + dr), rows.length - 1), Math.min(Math.max(0, base.c + dc), cols - 1), extend);
    };

    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === 'a') {
      e.preventDefault();
      E.anchor = { r: 0, c: 0 };
      E.focus = { r: rows.length - 1, c: cols - 1 };
      paintSelection();
      return;
    }
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); fillDown(); return; }
    if (mod && k.toLowerCase() === 'r') { e.preventDefault(); fillRight(); return; }
    if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); nudgeRow(k === 'ArrowUp' ? -1 : 1); return; }
    if (e.altKey && /^[0-9]$/.test(k)) {
      e.preventDefault();
      if (k === '0') paint(null);
      else if (E.legend[Number(k) - 1]) paint(E.legend[Number(k) - 1].argb);
      return;
    }
    if (e.altKey && /^Digit[0-9]$/.test(e.code)) {
      // Alt+digit types a symbol on some layouts; the physical key still says which.
      e.preventDefault();
      const n = Number(e.code.slice(5));
      if (n === 0) paint(null);
      else if (E.legend[n - 1]) paint(E.legend[n - 1].argb);
      return;
    }
    // Alt+K links the selection to P6 — Ctrl+K is the whole application's "go to".
    if (e.altKey && !mod && (e.code === 'KeyK' || k.toLowerCase() === 'k')) {
      e.preventDefault();
      linkSelection();
      return;
    }

    switch (k) {
      case 'ArrowUp': return move(-1, 0, e.shiftKey);
      case 'ArrowDown': return move(1, 0, e.shiftKey);
      case 'ArrowLeft': return move(0, -1, e.shiftKey);
      case 'ArrowRight': return move(0, 1, e.shiftKey);
      case 'Tab': return move(0, e.shiftKey ? -1 : 1, false);
      case 'Enter': return move(e.shiftKey ? -1 : 1, 0, false);
      case 'Home': return move(0, -E.focus.c + (mod ? 0 : 0), e.shiftKey);
      case 'End': return move(0, cols - 1 - E.focus.c, e.shiftKey);
      case 'F2': e.preventDefault(); startEdit(null); return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        clearSelection({ colour: e.shiftKey });
        return;
      case 'Escape':
        E.clip = null;
        E.root?.querySelectorAll('.lae-clip').forEach((n) => n.classList.remove('lae-clip'));
        return;
      default:
        break;
    }
    // Typing starts an edit, replacing what was there — as a spreadsheet does.
    if (!mod && !e.altKey && k.length === 1) {
      e.preventDefault();
      startEdit(k);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Editing a cell in place
     ═══════════════════════════════════════════════════════════════════════ */

  function startEdit(initial) {
    const { r, c } = E.focus;
    const row = E.view.rows[r];
    if (!editable(row, c)) {
      if (row?.kind === 'section' && c >= META) toast({ message: 'A section heading has no days — type its title instead.' });
      return;
    }
    const td = tdAt(r, c);
    const scroller = E.root.querySelector('.lae-scroll');
    if (!td || !scroller) return;
    const current = c < META ? String(row[ed.FIELDS[c].key] ?? (row.kind === 'section' || row.kind === 'absence' ? row.description : ''))
      : (ed.getCell(E.model, row.id, E.view.days[c - META])?.text || '');
    const value = initial != null ? initial : (c === 1 && row.kind !== 'activity' ? row.description : current);

    const box = td.getBoundingClientRect();
    const host = scroller.getBoundingClientRect();
    const wide = c < META ? Math.max(box.width, 160) : Math.max(box.width, 120);
    const input = el('input', {
      class: 'lae-editor',
      type: 'text',
      value,
      'aria-label': c < META ? ed.FIELDS[c].heading : `${row.description || 'Row'} on ${E.view.days[c - META]}`,
      style: `left:${box.left - host.left + scroller.scrollLeft}px;top:${box.top - host.top + scroller.scrollTop}px;`
        + `width:${wide}px;height:${box.height}px`,
    });
    input.value = value;
    scroller.appendChild(input);

    // Support codes, one press each, while typing into an activity's day.
    let hint = null;
    if (row.kind === 'activity' && c >= META && E.codes.length) {
      hint = el('div', {
        class: 'lae-edit-hint',
        style: `left:${box.left - host.left + scroller.scrollLeft}px;top:${box.bottom - host.top + scroller.scrollTop + 2}px`,
      }, E.codes.filter((x) => x.active !== false).map((x) => el('button', {
        class: 'lae-code', type: 'button', text: String(x.code).toUpperCase(),
        title: x.name || x.code,
        onMouseDown: (ev) => {
          ev.preventDefault();
          const code = String(x.code).toUpperCase();
          input.value = ed.normaliseSupport(input.value ? `${input.value}.${code}` : code);
          input.focus();
        },
      })));
      scroller.appendChild(hint);
    }

    /* Names from the roster, while typing into a row of names. The sheet is
       written in first names, and what is suggested is what the name register
       will place — a first name where only one person has it, the full name
       where two do — so a name typed here is never one somebody has to correct
       on the week plan later. */
    let names = null;
    let pick = -1;
    let found = [];
    if ((row.kind === 'resource' || row.kind === 'absence') && c >= META && E.names?.length) {
      names = el('div', {
        class: 'lae-edit-hint lae-names', role: 'listbox', 'aria-label': 'People on the roster',
        style: `left:${box.left - host.left + scroller.scrollLeft}px;top:${box.bottom - host.top + scroller.scrollTop + 2}px`,
      });
      scroller.appendChild(names);
      hint = names;
      const drawNames = () => {
        found = ed.suggestNames(input.value, E.names);
        pick = found.length ? Math.min(Math.max(pick, 0), found.length - 1) : -1;
        clear(names);
        names.hidden = !found.length;
        found.forEach((n, i) => names.appendChild(el('button', {
          class: `lae-name${i === pick ? ' lae-name-on' : ''}`, type: 'button', role: 'option',
          'aria-selected': String(i === pick), text: n.insert, title: n.full,
          onMouseDown: (ev) => { ev.preventDefault(); take(i); },
        })));
      };
      const take = (i) => {
        input.value = ed.acceptName(input.value, found[i].insert);
        pick = -1;
        drawNames();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      };
      input.addEventListener('input', () => { pick = 0; drawNames(); });
      names.take = take;
      drawNames();
    }

    // Save and move on, as Enter and Tab do — down, or across.
    const finish = (key, shift) => {
      commitEdit();
      if (key === 'Tab') select(r, Math.min(Math.max(0, c + (shift ? -1 : 1)), E.view.cols - 1));
      else select(Math.max(0, Math.min(r + (shift ? -1 : 1), E.view.rows.length - 1)), c);
      focusGrid();
    };

    /* P6, while typing into an activity's Activity ID: the schedule's activities
       that fit what is typed — any of the name, the ID or the WBS — and the
       reasons a row may give instead. Arrows choose; Enter or Tab takes one and
       moves on; Escape puts the list away and keeps what was typed, which is
       written as typed (in the list's own spelling where it is an ID the list
       has). Opened on what is already there, nothing is chosen until something
       is typed, so Enter leaves the cell as it was. */
    let p6List = null;
    let p6Found = [];
    let p6Pick = -1;
    if (row.kind === 'activity' && c === 0 && E.p6.available && (E.p6.entries.length || E.p6.flags.length)) {
      p6List = el('div', {
        class: 'lae-edit-hint lae-p6-hint', role: 'listbox', 'aria-label': 'P6 activities',
        style: `left:${box.left - host.left + scroller.scrollLeft}px;top:${box.bottom - host.top + scroller.scrollTop + 2}px`,
      });
      scroller.appendChild(p6List);
      hint = p6List;
      const uses = p6.p6Coverage(E.model.rows, E.p6.index).uses;
      const choose = (i) => {
        p6Pick = i;
        for (const [k, b] of [...p6List.querySelectorAll('.lae-p6-opt')].entries()) {
          b.classList.toggle('lae-p6-on', k === p6Pick);
          b.setAttribute('aria-selected', String(k === p6Pick));
        }
        p6List.querySelector('.lae-p6-on')?.scrollIntoView({ block: 'nearest' });
      };
      const takeP6 = (i, key = 'Enter', shift = false) => {
        const o = p6Found[i];
        if (!o) return;
        if (o.kind === 'more') {
          const query = input.value;
          cancelEdit();
          linkRows([row], query);
          return;
        }
        input.value = o.kind === 'p6' ? o.entry.activity_id : o.flag.label;
        finish(key, shift);
      };
      const drawP6 = () => {
        p6Found = p6Options(input.value);
        p6Pick = p6Found.length ? Math.min(p6Pick, p6Found.length - 1) : -1;
        // Nothing matched: Enter writes what was typed rather than opening the list.
        if (p6Pick >= 0 && p6Found[p6Pick].kind === 'more') p6Pick = -1;
        clear(p6List);
        p6List.hidden = !p6Found.length;
        if (!input.value.trim() && E.p6.entries.length) {
          p6List.appendChild(el('div', { class: 'lae-p6-help', text: 'Type a name or an ID to search P6 — or say why there is none' }));
        }
        p6Found.forEach((o, i) => p6List.appendChild(p6Option(o, i === p6Pick, uses, () => takeP6(i))));
        placeHint(p6List, box, host, scroller);
      };
      p6List.choose = choose;
      p6List.take = takeP6;
      input.addEventListener('input', () => { p6Pick = 0; drawP6(); });
      if (initial != null) p6Pick = 0;
      drawP6();
    }

    E.editing = { input, hint, r, c, row };
    input.focus();
    if (initial == null) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);

    input.addEventListener('keydown', (e) => {
      const p6Open = p6List && !p6List.hidden && p6Found.length;
      if (p6Open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const down = e.key === 'ArrowDown';
        p6List.choose(p6Pick < 0 ? (down ? 0 : p6Found.length - 1) : (p6Pick + (down ? 1 : -1) + p6Found.length) % p6Found.length);
        e.stopPropagation();
        return;
      }
      if (p6Open && p6Pick >= 0 && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault();
        p6List.take(p6Pick, e.key, e.shiftKey);
        e.stopPropagation();
        return;
      }
      if (p6Open && e.key === 'Escape') {
        e.preventDefault();
        p6List.hidden = true;
        p6Pick = -1;
        e.stopPropagation();
        return;
      }
      // With a name on offer, the arrows choose and Enter or Tab takes it;
      // with none, they do what they always do.
      if (names && found.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        pick = (pick + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
        for (const [i, b] of [...names.children].entries()) {
          b.classList.toggle('lae-name-on', i === pick);
          b.setAttribute('aria-selected', String(i === pick));
        }
        e.stopPropagation();
        return;
      }
      if (names && found.length && pick >= 0 && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault();
        names.take(pick);
        e.stopPropagation();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); finish(e.key, e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); focusGrid(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => { if (E.editing?.input === input) commitEdit(); });
  }

  function focusGrid() {
    E.root?.querySelector('.lae-scroll')?.focus({ preventScroll: true });
  }

  /** Below the cell, or above it where below would run off the bottom of the grid. */
  function placeHint(node, box, host, scroller) {
    if (node.hidden) return;
    const height = node.offsetHeight;
    const above = box.bottom + height + 4 > host.bottom && box.top - height - 4 > host.top;
    node.style.top = `${(above ? box.top - height - 2 : box.bottom + 2) - host.top + scroller.scrollTop}px`;
  }

  /**
   * What the Activity ID cell offers for what is typed: the P6 activities that
   * fit it, the reasons that fit it (every reason, before anything is typed), and
   * the whole list a press away.
   */
  function p6Options(text) {
    const q = String(text ?? '').trim();
    const out = [];
    if (q) for (const entry of p6.searchP6(E.p6.entries, q, { limit: 7 })) out.push({ kind: 'p6', entry });
    for (const flag of p6.matchFlags(E.p6.flags, q).slice(0, q ? 3 : 8)) out.push({ kind: 'flag', flag });
    if (q && E.p6.entries.length) out.push({ kind: 'more' });
    return out;
  }

  function p6Option(o, on, uses, take) {
    const n = o.kind === 'p6' ? uses.get(o.entry.activity_id) || 0 : 0;
    const kids = o.kind === 'p6'
      ? [
        el('span', { class: 'lae-p6-id', text: o.entry.activity_id }),
        el('span', { class: 'lae-p6-name', text: o.entry.name }),
        n ? el('span', { class: 'lae-p6-uses', text: `${n} row${n === 1 ? '' : 's'}` }) : null,
        o.entry.missing ? el('span', { class: 'lae-p6-uses', text: 'not in the latest extract' }) : null,
      ]
      : o.kind === 'flag'
        ? [el('span', { class: 'lae-p6-id', text: 'Not in P6' }), el('span', { class: 'lae-p6-name', text: o.flag.label })]
        : [el('span', { class: 'lae-p6-more', html: `${icon('search', { size: 11 })}<span>Search all P6 activities…</span>` })];
    return el('button', {
      class: `lae-p6-opt lae-p6-opt-${o.kind}${on ? ' lae-p6-on' : ''}`, type: 'button', role: 'option',
      'aria-selected': String(on),
      title: o.kind === 'p6' ? p6Words(o.entry.activity_id, { kind: 'linked', entry: o.entry }) : '',
      onMouseDown: (ev) => { ev.preventDefault(); take(); },
    }, kids.filter(Boolean));
  }

  function cancelEdit() {
    if (!E.editing) return;
    // Cleared first: removing a focused input fires its blur, and the blur
    // handler must find nothing left to commit.
    const { input, hint } = E.editing;
    E.editing = null;
    input.remove();
    hint?.remove();
  }

  function commitEdit() {
    if (!E.editing) return;
    const { input, c, row } = E.editing;
    let value = input.value;
    cancelEdit();
    if (!E.model.rows.some((x) => x.id === row.id)) return;
    if (c < META) {
      const key = row.kind === 'activity' ? ed.FIELDS[c].key : 'description';
      if (key === 'activity_id' && E.p6.available) {
        commit(linkOps([E.model.rows.find((x) => x.id === row.id)], p6.p6Canonical(value, E.p6.index)));
        return;
      }
      if ((row[key] ?? '') === value) return;
      commit([{ op: 'row', id: row.id, set: { [key]: value } }]);
      return;
    }
    const day = E.view.days[c - META];
    const cell = ed.getCell(E.model, row.id, day);
    if (row.kind === 'activity' && looksLikeCodes(value.replace(/\s+/g, ''))) value = ed.normaliseSupport(value);
    value = value.trim();
    if ((cell?.text || '') === value) return;
    commit([{ op: 'cell', row_id: row.id, day, color: cell?.color || null, text: value }], { ask: true });
    if (row.kind === 'activity') warnUnknown([value]);
  }

  function warnUnknown(texts) {
    const unknown = new Set();
    for (const t of texts) {
      if (!looksLikeCodes(t)) continue;
      for (const code of ed.parseSupport(t, E.codes).unknown) unknown.add(code);
    }
    if (unknown.size) {
      toast({
        tone: 'warn',
        message: `${[...unknown].join(', ')} ${unknown.size === 1 ? 'is' : 'are'} not a support code yet. It is kept as typed and `
          + 'marked on the grid — add it under Legend → Support codes to count it.',
        timeout: 9000,
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Commands
     ═══════════════════════════════════════════════════════════════════════ */

  /** Apply ops here, remember how to undo them, and queue them for saving. */
  function commit(ops, { keepRedo = false, ask = false } = {}) {
    const useful = ops.filter((op) => {
      if (op.op !== 'cell') return true;
      const was = ed.getCell(E.model, op.row_id, op.day);
      return (was?.color || null) !== (op.color ? String(op.color).toUpperCase() : null) || (was?.text || '') !== String(op.text ?? '');
    });
    if (!useful.length) return;
    // Only a targeted edit asks — typing in a day, or taking a code off with
    // its button. A paste, a fill or a cleared week is not somebody deciding a
    // witness is no longer needed; "Cancel BART resources…" is the way to say so.
    const removed = ask ? resourcesRemovedBy(useful) : [];
    const inverse = ed.applyOps(E.model, useful);
    E.undo.push({ ops: useful, inverse });
    if (E.undo.length > 200) E.undo.shift();
    if (!keepRedo) E.redo = [];
    enqueue(useful);
    redrawAfter(useful);
    if (removed.length) askAboutRemovedResources(removed);
  }

  /**
   * The BART resources a set of cell edits takes off activities that still go
   * ahead — a registered code gone from a day, or struck out by typing its tilde.
   *
   * Only registered codes: a typo corrected is not a witness withdrawn. Only
   * activity rows, and never a day these edits paint as cancelled — that day's
   * resources go with it and the cancellation question covers them.
   */
  function resourcesRemovedBy(ops) {
    const rows = new Map(E.model.rows.map((r) => [r.id, r]));
    const registered = new Set(E.codes.map((c) => String(c.code).toUpperCase()));
    const cancelColour = (hex) => {
      const meaning = hex ? E.legendAll.find((e) => e.argb === String(hex).toUpperCase())?.meaning : null;
      return !!meaning && isCancelMeaning(meaning);
    };
    const out = [];
    for (const op of ops) {
      if (op.op !== 'cell') continue;
      const row = rows.get(op.row_id);
      if (!row || row.kind !== 'activity' || cancelColour(op.color)) continue;
      const was = ed.getCell(E.model, op.row_id, op.day);
      for (const r of ed.removedCodes(was?.text || '', op.text || '')) {
        if (registered.has(r.code)) out.push({ row, day: op.day, code: r.code, struck: r.struck });
      }
    }
    return out;
  }

  /**
   * A resource came off an activity: was it cancelled, or simply taken off?
   *
   * Both are real answers and the difference matters to a claim. **Cancel and
   * log** strikes the code back into the day ("X.~WIT"), drawn through in red on
   * every screen, and records who and why against the cancellation log, where
   * it is listed beside the days that were cancelled outright. **Just remove**
   * leaves the day as it was edited — a correction, a plan that changed before
   * anybody was booked — and nothing is tracked. A code struck out by typing
   * the tilde was already cancelled; only the why is asked.
   */
  function askAboutRemovedResources(removed, { chosen = null } = {}) {
    // One line per activity, code and run of days, as the log will list it.
    const byCode = new Map();
    for (const r of removed) {
      const key = `${r.row.id}|${r.code}`;
      if (!byCode.has(key)) byCode.set(key, { code: r.code, items: [] });
      byCode.get(key).items.push(r);
    }
    const runs = [];
    for (const { code, items } of byCode.values()) {
      for (const run of ed.dayRuns(items)) {
        const inRun = items.filter((i) => i.day >= run.start && i.day <= run.end);
        runs.push({ ...run, code, items: inRun });
      }
    }
    const pending = removed.filter((r) => !r.struck);
    const party = selectInput({ value: 'BART', options: ['BART', 'Hitachi', 'Other'] });
    const reason = el('textarea', { class: 'cx-input', rows: 3, placeholder: 'Why — e.g. witness not required for testing' });
    const list = el('ul', { class: 'lae-cancel-runs' }, runs.map((r) => el('li', {}, [
      el('span', { class: 'lae-code-cancelled', text: `${r.items.length > 1 ? `${r.items.length} × ` : ''}${r.code}` }),
      ` ${codeName(r.code) !== r.code ? `(${codeName(r.code)}) ` : ''}— ${r.row.description || 'Activity'}`
        + `${r.row.location ? ` at ${r.row.location}` : ''}, `
        + `${r.start === r.end ? fmt(r.start) : `${fmt(r.start)} – ${fmt(r.end)}`}`,
    ])));
    /* From the menu nothing has been removed yet: somebody picks which of the
       codes on those days to cancel, and the rest stay as they are. */
    const picks = chosen
      ? [...new Set(removed.map((r) => r.code))].map((code) => {
        const box = el('input', { type: 'checkbox', checked: true, value: code });
        return { code, box, label: el('label', { class: 'lae-code-pick' }, [box, ` ${code}${codeName(code) !== code ? ` — ${codeName(code)}` : ''}`]) };
      })
      : [];
    const record = async () => {
      if (chosen) {
        const keep = new Set(picks.filter((p) => p.box.checked).map((p) => p.code));
        if (!keep.size) {
          toast({ message: 'Tick at least one resource to cancel.' });
          return false;
        }
        for (let i = removed.length - 1; i >= 0; i--) if (!keep.has(removed[i].code)) removed.splice(i, 1);
        for (let i = runs.length - 1; i >= 0; i--) if (!keep.has(runs[i].code)) runs.splice(i, 1);
        for (let i = pending.length - 1; i >= 0; i--) if (!keep.has(pending[i].code)) pending.splice(i, 1);
      }
      try {
        if (pending.length) {
          const byCell = new Map();
          for (const r of pending) {
            const key = ed.cellKey(r.row.id, r.day);
            if (!byCell.has(key)) byCell.set(key, { r, codes: [] });
            byCell.get(key).codes.push(r.code);
          }
          const ops = [];
          for (const { r, codes } of byCell.values()) {
            const cell = ed.getCell(E.model, r.row.id, r.day);
            ops.push({ op: 'cell', row_id: r.row.id, day: r.day, color: cell?.color || null, text: ed.strikeCodes(cell?.text || '', codes) });
          }
          commit(ops);
        }
        for (const run of runs) {
          rememberNote(await rc.addCancellationNote({
            ...ed.cancellationKey(run.row),
            start_date: run.start,
            end_date: run.end,
            codes: run.code,
            party: party.value,
            reason: reason.value.trim() || null,
          }));
        }
        redrawNoted(runs);
        toast({ tone: 'good', message: `Cancelled and logged — ${[...new Set(runs.map((r) => r.code))].join(', ')}, ${party.value}.` });
      } catch (err) {
        toast({ tone: 'bad', message: err.message, timeout: 10000 });
        rc.reportError('lookahead:resource-note', err);
      }
    };
    const n = runs.length;
    openModal({
      title: chosen
        ? 'Cancel BART resources'
        : pending.length
          ? (n === 1 ? 'A BART resource came off this activity' : `${n} BART resources came off activities`)
          : (n === 1 ? 'Why was this resource cancelled?' : `Why were these ${n} resources cancelled?`),
      subtitle: chosen
        ? 'Each one stays on its day struck through in red, and goes in the cancellation log'
        : pending.length
          ? 'Cancel it to keep it on the day struck through and in the cancellation log — or just remove it'
          : 'Recorded in the cancellation log, attributed and dated',
      body: el('div', { class: 'lae-form lae-cancel-form lae-resource-form' }, [
        chosen ? el('div', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Which resources' }), el('div', { class: 'lae-code-picks' }, picks.map((p) => p.label))]) : list,
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Responsible party' }), party]),
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Reason' }), reason]),
      ]),
      actions: [
        { label: chosen ? 'Close' : pending.length ? 'Just remove — not tracked' : 'Not now' },
        { label: chosen || pending.length ? 'Cancel and log' : 'Record', kind: 'primary', autofocus: true, onClick: record },
      ],
    });
  }

  /** Right-click → "Cancel BART resources…": strike chosen codes off the selected days. */
  function cancelResourcesOnSelection() {
    const items = [];
    for (const s of selectedCells()) {
      if (s.row?.kind !== 'activity' || s.c < META) continue;
      const cell = ed.getCell(E.model, s.row.id, s.day);
      for (const code of ed.supportTokens(cell?.text || '')) items.push({ row: s.row, day: s.day, code, struck: false });
    }
    if (!items.length) {
      toast({ message: 'Select activity days that ask for support first.' });
      return;
    }
    askAboutRemovedResources(items, { chosen: true });
  }

  function undo() {
    const entry = E.undo.pop();
    if (!entry) return;
    cancelEdit();
    const again = ed.applyOps(E.model, entry.inverse);
    E.redo.push({ ops: entry.inverse, inverse: again });
    enqueue(entry.inverse);
    redrawAfter(entry.inverse);
  }

  function redo() {
    const entry = E.redo.pop();
    if (!entry) return;
    const again = ed.applyOps(E.model, entry.inverse);
    E.undo.push({ ops: entry.inverse, inverse: again });
    enqueue(entry.inverse);
    redrawAfter(entry.inverse);
  }

  function paint(color) {
    const ops = [];
    let skipped = 0;
    for (const s of selectedCells()) {
      if (s.c < META) continue;
      if (!paintable(s.row, s.c)) { if (s.row?.kind !== 'section') skipped++; continue; }
      const cell = ed.getCell(E.model, s.row.id, s.day);
      ops.push({ op: 'cell', row_id: s.row.id, day: s.day, color, text: cell?.text || '' });
    }
    if (!ops.length) {
      toast({ message: skipped ? 'Only an activity\'s days take a colour — names and PTO rows stay plain.' : 'Select the days to paint first.' });
      return;
    }
    // Only the days that were not already this colour are newly cancelled.
    const fresh = ops.filter((o) => (ed.getCell(E.model, o.row_id, o.day)?.color || null) !== color);
    commit(ops);
    const meaning = color ? E.legendAll.find((e) => e.argb === color)?.meaning : null;
    if (meaning && isCancelMeaning(meaning) && fresh.length) {
      const rows = new Map(E.model.rows.map((r) => [r.id, r]));
      askWhyCancelled(ed.dayRuns(fresh.map((o) => ({ row: rows.get(o.row_id), day: o.day })).filter((x) => x.row)));
    }
  }

  /**
   * Who cancelled it, and why — asked at the moment the day turns red.
   *
   * The cancellation log used to be filled in afterwards, from a list, by
   * whoever remembered; by then "BART pulled the possession on Tuesday night" is
   * a guess. So painting a day in the cancellation colour asks, there and then,
   * and writes the same note the log's own dialog writes — keyed the way the log
   * will key the event (`cancellationKey()`), so it is waiting there when the
   * look-ahead is published. "Not now" is always an answer: the log still lists
   * the event, unexplained, for later.
   */
  function askWhyCancelled(runs) {
    if (!runs.length) return;
    const party = selectInput({ value: 'BART', options: ['BART', 'Hitachi', 'Other'] });
    const reason = el('textarea', { class: 'cx-input', rows: 3, placeholder: 'What happened — e.g. possession withdrawn by BART' });
    /* What BART had been asked for on those days goes with them — said here so
       nobody has to work out afterwards that a witness was cancelled too. */
    const resourcesOf = (r) => {
      const texts = [];
      for (let d = r.start; d <= r.end; d = ed.addDaysISO(d, 1)) texts.push(ed.getCell(E.model, r.row.id, d)?.text || '');
      return describeCodeCounts(countCodes(texts));
    };
    const list = el('ul', { class: 'lae-cancel-runs' }, runs.map((r) => {
      const resources = resourcesOf(r);
      return el('li', {
        text: `${r.row.description || 'Activity'}${r.row.location ? ` at ${r.row.location}` : ''} — `
          + `${r.start === r.end ? fmt(r.start) : `${fmt(r.start)} – ${fmt(r.end)}`}`
          + `${resources ? ` · BART resources cancelled with it: ${resources}` : ''}`,
      });
    }));
    openModal({
      title: runs.length === 1 ? 'Why was this cancelled?' : `Why were these ${runs.length} cancelled?`,
      subtitle: 'Recorded in the cancellation log, attributed and dated',
      body: el('div', { class: 'lae-form lae-cancel-form' }, [
        list,
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Responsible party' }), party]),
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Reason' }), reason]),
      ]),
      actions: [
        { label: 'Not now' },
        {
          label: 'Record', kind: 'primary', autofocus: true, onClick: async () => {
            try {
              for (const r of runs) {
                rememberNote(await rc.addCancellationNote({
                  ...ed.cancellationKey(r.row),
                  start_date: r.start,
                  end_date: r.end,
                  party: party.value,
                  reason: reason.value.trim() || null,
                }));
              }
              redrawNoted(runs);
              toast({ tone: 'good', message: `Recorded in the cancellation log — ${party.value}.` });
            } catch (err) {
              toast({ tone: 'bad', message: err.message, timeout: 10000 });
              rc.reportError('lookahead:cancel-note', err);
            }
          },
        },
      ],
    });
  }

  function addCode(code, direction) {
    const ops = [];
    for (const s of selectedCells()) {
      if (!paintable(s.row, s.c)) continue;
      const cell = ed.getCell(E.model, s.row.id, s.day);
      const tokens = cellTokens(cell?.text || '');
      if (direction > 0) tokens.push({ code, cancelled: false });
      else {
        const at = tokens.map((t) => (t.cancelled ? null : t.code)).lastIndexOf(code);
        if (at < 0) continue;
        tokens.splice(at, 1);
      }
      ops.push({ op: 'cell', row_id: s.row.id, day: s.day, color: cell?.color || null, text: ed.writeTokens(tokens) });
    }
    if (!ops.length) {
      toast({ message: 'Select an activity\'s days first — support is asked for on activities.' });
      return;
    }
    commit(ops, { ask: direction < 0 });
  }

  /**
   * Put struck-out resources back on the selected days: "X.~WIT" → "X.WIT". The
   * cancellation log keeps the days it was struck out on — it was cancelled when
   * those readings were taken — and says so if the reason no longer applies.
   */
  function reinstateSelection() {
    const ops = [];
    for (const s of selectedCells()) {
      if (s.row?.kind !== 'activity' || s.c < META) continue;
      const cell = ed.getCell(E.model, s.row.id, s.day);
      if (!cell || !ed.cancelledTokens(cell.text).length) continue;
      ops.push({ op: 'cell', row_id: s.row.id, day: s.day, color: cell.color || null, text: ed.reinstateCodes(cell.text) });
    }
    commit(ops);
  }

  function clearSelection({ colour = false } = {}) {
    const ops = [];
    for (const s of selectedCells()) {
      if (!editable(s.row, s.c)) continue;
      if (s.c < META) {
        const key = s.row.kind === 'activity' ? ed.FIELDS[s.c].key : 'description';
        if (s.row[key]) ops.push({ op: 'row', id: s.row.id, set: { [key]: '' } });
        continue;
      }
      const cell = ed.getCell(E.model, s.row.id, s.day);
      if (!cell) continue;
      ops.push({ op: 'cell', row_id: s.row.id, day: s.day, color: colour ? null : cell.color, text: '' });
    }
    commit(ops);
  }

  /* ── P6 ────────────────────────────────────────────────────────────────── */

  /**
   * The ops that write one Activity ID onto activities — and, on any that has no
   * description yet, the P6 activity's name as its description, so a row begun
   * from its activity reads as that activity at once. A description somebody
   * wrote is never replaced.
   *
   * @param {object[]} rows
   * @param {string} value
   * @param {{ fill?: boolean }} [options]
   */
  function linkOps(rows, value, { fill = true } = {}) {
    const status = p6.p6Status(value, E.p6.index);
    const ops = [];
    for (const row of rows.filter(Boolean)) {
      const set = {};
      if ((row.activity_id ?? '') !== value) set.activity_id = value;
      if (fill && status.kind === 'linked' && status.entry.name && !String(row.description ?? '').trim()) {
        set.description = status.entry.name;
      }
      if (Object.keys(set).length) ops.push({ op: 'row', id: row.id, set });
    }
    return ops;
  }

  /** The activities a set of rows is about: a names row stands for the activity above it. */
  function activitiesIn(rows) {
    const out = [];
    for (const r of rows) {
      const a = r?.kind === 'resource' ? E.model.rows.find((x) => x.id === r.parent_id) : r;
      if (a?.kind === 'activity' && !out.includes(a)) out.push(a);
    }
    return out;
  }

  /** Alt+K: link every selected activity to one P6 activity, or give them all one reason. */
  function linkSelection(query = '') {
    if (!E.p6.available) {
      toast({ tone: 'warn', message: 'The P6 list could not be read from the folder — try again once OneDrive has synced it.', timeout: 8000 });
      return;
    }
    const rows = activitiesIn(selectedRows());
    if (!rows.length) {
      toast({ message: 'Select the activities to link first — a P6 activity is linked to an activity\'s row.' });
      return;
    }
    linkRows(rows, query);
  }

  function linkRows(rows, query = '') {
    const one = rows.length === 1 ? rows[0] : null;
    openP6Picker({
      title: one ? 'Link to a P6 activity' : `Link ${rows.length} activities to one P6 activity`,
      subtitle: one ? (one.description || one.activity_id || 'An activity with no description yet')
        : 'Several rows may name one activity — a week of work is often one P6 activity',
      p6: E.p6,
      uses: p6.p6Coverage(E.model.rows, E.p6.index).uses,
      query,
      current: one ? one.activity_id : null,
      onPick: ({ value, entry, flag, fill }) => {
        const current = rows.map((r) => E.model.rows.find((x) => x.id === r.id));
        const ops = linkOps(current, value, { fill });
        commit(ops);
        if (!ops.length) return;
        toast({
          tone: 'good',
          message: entry
            ? `${current.length === 1 ? 'Linked' : `Linked ${current.length} activities`} to ${entry.activity_id} — ${entry.name}.`
            : `${current.length === 1 ? 'Flagged' : `Flagged ${current.length} activities`} as not in P6: ${flag?.label || value}.`,
          action: { label: 'Undo', onClick: () => undo() },
          timeout: 6000,
        });
      },
      onClear: rows.some((r) => r.activity_id) ? () => {
        commit(rows.filter((r) => r.activity_id).map((r) => ({ op: 'row', id: r.id, set: { activity_id: '' } })));
      } : null,
      onImport: () => importP6(),
    });
  }

  /** The next activity with no P6 activity and no reason, after the caret — wrapping round. */
  function nextUnlinked() {
    const rows = E.view.rows;
    const open = (row) => row?.kind === 'activity' && ['empty', 'unknown'].includes(p6.p6Status(row.activity_id, E.p6.index).kind);
    for (let k = 1; k <= rows.length; k++) {
      const r = (E.focus.r + k) % rows.length;
      if (open(rows[r])) {
        select(r, 0);
        focusGrid();
        return;
      }
    }
    toast({ message: 'The ones still to link are in folded sections, archived, or hidden by the search.' });
  }

  function importP6() {
    openP6Import({
      host: E.root,
      onDone: async () => {
        E.p6 = await loadP6();
        draw();
      },
    });
  }

  /** The selection as a block of `{ color, text }`, for copying and filling. */
  function block(sel = rect()) {
    const out = [];
    for (let r = sel.r0; r <= sel.r1; r++) {
      const row = E.view.rows[r];
      const line = [];
      for (let c = sel.c0; c <= sel.c1; c++) {
        if (c < META) {
          const v = ed.metaValues(row)[c];
          line.push({ color: null, text: v });
        } else {
          const cell = row.kind === 'section' ? null : ed.getCell(E.model, row.id, E.view.days[c - META]);
          line.push({ color: cell?.color || null, text: cell?.text || '' });
        }
      }
      out.push(line);
    }
    return out;
  }

  /** Write a block into the grid from (r, c), within what each cell allows. */
  function writeBlock(data, r0, c0) {
    const ops = [];
    let droppedColour = 0;
    const shift = new Set(E.legend.map((e) => e.argb));
    data.forEach((line, dr) => {
      const row = E.view.rows[r0 + dr];
      if (!row) return;
      line.forEach((v, dc) => {
        const c = c0 + dc;
        if (c >= E.view.cols || !editable(row, c)) return;
        if (c < META) {
          const key = row.kind === 'activity' ? ed.FIELDS[c].key : 'description';
          if ((row[key] ?? '') !== v.text) ops.push({ op: 'row', id: row.id, set: { [key]: v.text } });
          return;
        }
        let color = v.color ? String(v.color).toUpperCase() : null;
        if (color && (!paintable(row, c) || !shift.has(color))) { droppedColour++; color = null; }
        let text = String(v.text ?? '');
        if (row.kind === 'activity' && looksLikeCodes(text.replace(/\s+/g, ''))) text = ed.normaliseSupport(text);
        ops.push({ op: 'cell', row_id: row.id, day: E.view.days[c - META], color, text });
      });
    });
    // Several ops on one row's fields collapse into the last, so undo is one step.
    commit(ops);
    if (droppedColour) {
      toast({
        tone: 'warn',
        message: `${droppedColour} colour${droppedColour === 1 ? '' : 's'} left off: only the legend's shift colours are `
          + 'painted, and only on an activity\'s days. The text came across.',
        timeout: 8000,
      });
    }
    return ops;
  }

  function copy(data, cut) {
    const b = block();
    E.clip = { block: b, tsv: ed.toTSV(b) };
    data?.setData('text/plain', E.clip.tsv);
    data?.setData('text/html', ed.toHTML(b));
    E.root?.querySelectorAll('.lae-clip').forEach((n) => n.classList.remove('lae-clip'));
    for (const n of E.root?.querySelectorAll('.lae-sel') || []) n.classList.add('lae-clip');
    if (cut) clearSelection({ colour: true });
    const n = b.length * (b[0]?.length || 0);
    toast({ message: `${cut ? 'Cut' : 'Copied'} ${n} cell${n === 1 ? '' : 's'} — paste here or into Excel.`, timeout: 2500 });
  }

  function paste(data) {
    const html = data?.getData('text/html') || '';
    const text = data?.getData('text/plain') || '';
    let incoming = null;
    if (E.clip && text && text === E.clip.tsv) incoming = E.clip.block;
    else if (/<table/i.test(html)) incoming = fromHtml(html);
    if (!incoming && text) incoming = ed.fromTSV(text);
    if (!incoming?.length) return;
    const sel = rect();
    const h = incoming.length;
    const w = incoming[0].length;
    // A single value, or a block that divides the selection evenly, fills it.
    const selH = sel.r1 - sel.r0 + 1;
    const selW = sel.c1 - sel.c0 + 1;
    const fill = (selH > h || selW > w) && selH % h === 0 && selW % w === 0;
    writeBlock(fill ? ed.tile(incoming, selH, selW) : incoming, sel.r0, sel.c0);
    const lastR = Math.min(sel.r0 + (fill ? selH : h) - 1, E.view.rows.length - 1);
    const lastC = Math.min(sel.c0 + (fill ? selW : w) - 1, E.view.cols - 1);
    E.anchor = { r: sel.r0, c: sel.c0 };
    E.focus = { r: lastR, c: lastC };
    paintSelection();
  }

  /** An HTML table from Excel or anywhere else: text, and each cell's fill as hex. */
  function fromHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return null;
    // Excel puts the fills in a stylesheet keyed by class.
    const classFill = new Map();
    for (const style of doc.querySelectorAll('style')) {
      for (const m of style.textContent.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
        const bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(m[2]);
        if (bg) classFill.set(m[1], bg[1].trim());
      }
    }
    const probe = el('span');
    document.body.appendChild(probe);
    const toHex = (value) => {
      if (!value) return null;
      const v = value.trim().replace(/\s+none$/i, '');
      if (/^#?[0-9a-f]{6}$/i.test(v)) return v.replace('#', '').toUpperCase();
      probe.style.color = '';
      probe.style.color = v;
      if (!probe.style.color) return null;
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color);
      return m ? [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
    };
    const out = [];
    for (const tr of table.querySelectorAll('tr')) {
      const line = [];
      for (const td of tr.querySelectorAll('td, th')) {
        const inline = /background(?:-color)?\s*:\s*([^;]+)/i.exec(td.getAttribute('style') || '')?.[1]
          || td.getAttribute('bgcolor')
          || [...td.classList].map((c) => classFill.get(c)).find(Boolean)
          || null;
        let color = toHex(inline);
        if (color === 'FFFFFF') color = null; // white is no fill, on the sheet as here
        const span = Number(td.getAttribute('colspan')) || 1;
        for (let i = 0; i < span; i++) line.push({ color, text: td.textContent.replace(/\s+/g, ' ').trim() });
      }
      out.push(line);
    }
    probe.remove();
    const width = Math.max(...out.map((l) => l.length));
    return out.map((l) => [...l, ...Array.from({ length: width - l.length }, () => ({ color: null, text: '' }))]);
  }

  function showFillPreview(d) {
    for (const n of E.root.querySelectorAll('.lae-fill-preview')) n.classList.remove('lae-fill-preview');
    const target = fillTarget(d.from, d.to);
    if (!target) return;
    for (let r = target.r0; r <= target.r1; r++) {
      for (let c = target.c0; c <= target.c1; c++) tdAt(r, c)?.classList.add('lae-fill-preview');
    }
  }

  /** Drag the corner: across or down, whichever the pointer went further. */
  function fillTarget(from, to) {
    const down = to.r - from.r1;
    const up = from.r0 - to.r;
    const right = to.c - from.c1;
    const left = from.c0 - to.c;
    const vertical = Math.max(down, up);
    const horizontal = Math.max(right, left);
    if (vertical <= 0 && horizontal <= 0) return null;
    if (horizontal >= vertical) {
      return right > 0
        ? { r0: from.r0, r1: from.r1, c0: from.c1 + 1, c1: to.c }
        : { r0: from.r0, r1: from.r1, c0: to.c, c1: from.c0 - 1 };
    }
    return down > 0
      ? { r0: from.r1 + 1, r1: to.r, c0: from.c0, c1: from.c1 }
      : { r0: to.r, r1: from.r0 - 1, c0: from.c0, c1: from.c1 };
  }

  function applyFill(from, to) {
    const target = fillTarget(from, to);
    if (!target) return;
    const source = block(from);
    const tiled = ed.tile(source, target.r1 - target.r0 + 1, target.c1 - target.c0 + 1);
    writeBlock(tiled, target.r0, target.c0);
    E.anchor = { r: Math.min(from.r0, target.r0), c: Math.min(from.c0, target.c0) };
    E.focus = { r: Math.max(from.r1, target.r1), c: Math.max(from.c1, target.c1) };
    paintSelection();
  }

  function fillDown() {
    const sel = rect();
    if (sel.r1 === sel.r0) return;
    const top = block({ ...sel, r1: sel.r0 });
    writeBlock(ed.tile(top, sel.r1 - sel.r0, sel.c1 - sel.c0 + 1), sel.r0 + 1, sel.c0);
  }

  function fillRight() {
    const sel = rect();
    if (sel.c1 === sel.c0) return;
    const left = block({ ...sel, c1: sel.c0 });
    writeBlock(ed.tile(left, sel.r1 - sel.r0 + 1, sel.c1 - sel.c0), sel.r0, sel.c0 + 1);
  }

  /* ── Rows ───────────────────────────────────────────────────────────────── */

  /** Where a new row goes: after the selected row's block, or at the end. */
  function insertionPoint(where = 'below') {
    const ordered = ed.orderedRows(E.model.rows, { archived: true });
    const row = E.view.rows[E.focus.r];
    if (!row) {
      const last = ordered.filter((r) => r.kind !== 'resource').pop();
      return { before: last ? last.sort : null, after: null };
    }
    const idx = ordered.findIndex((r) => r.id === (row.kind === 'resource' ? row.parent_id : row.id));
    const top = ordered.filter((r) => r.kind !== 'resource');
    if (where === 'above') {
      const at = top.findIndex((r) => r.id === ordered[idx].id);
      return { before: top[at - 1]?.sort ?? null, after: top[at].sort };
    }
    // Below: past the whole block — an activity's names, or a section's rows
    // when the section itself is what is selected and folded.
    const [, end] = row.kind === 'section' && E.collapsed.has(row.id) ? ed.sectionBlock(ordered, idx) : ed.rowBlock(ordered, idx);
    const lastTop = [...ordered.slice(idx, end + 1)].reverse().find((r) => r.kind !== 'resource');
    const at = top.findIndex((r) => r.id === lastTop.id);
    return { before: top[at].sort, after: top[at + 1]?.sort ?? null };
  }

  /**
   * @param {string} kind
   * @param {string} [where]
   * @param {Object<string, any>} [extra]  Fields the new row starts with.
   */
  function insertRow(kind, where = 'below', extra = {}) {
    cancelEdit();
    const { before, after } = insertionPoint(where);
    const id = ed.newId();
    /** @type {Object<string, any>} */
    const set = { kind, sort: ed.sortBetween(before, after), ...extra };
    if (kind === 'section') set.description = extra.description ?? 'New section';
    /** @type {object[]} */
    const ops = [{ op: 'row', id, set }];
    if (kind === 'activity') ops.push({ op: 'row', id: ed.newId(), set: { kind: 'resource', parent_id: id, sort: set.sort + 0.001 } });
    commit(ops);
    respaceIfNeeded();
    const r = E.view.rows.findIndex((x) => x.id === id);
    if (r >= 0) {
      select(r, 1);
      focusGrid();
      startEdit(null);
    }
  }

  function addNamesRow(row) {
    if (E.model.rows.some((r) => r.kind === 'resource' && r.parent_id === row.id)) return;
    commit([{ op: 'row', id: ed.newId(), set: { kind: 'resource', parent_id: row.id, sort: row.sort + 0.001 } }]);
  }

  function duplicateRow(row) {
    const ordered = ed.orderedRows(E.model.rows, { archived: true });
    const top = ordered.filter((r) => r.kind !== 'resource');
    const at = top.findIndex((r) => r.id === row.id);
    const sort = ed.sortBetween(row.sort, top[at + 1]?.sort ?? null);
    const id = ed.newId();
    const { id: _, version, ...fields } = row;
    /** @type {object[]} */
    const ops = [{ op: 'row', id, set: { ...fields, sort } }];
    for (const c of ed.cellList(E.model).filter((x) => x.row_id === row.id)) {
      ops.push({ op: 'cell', row_id: id, day: c.day, color: c.color, text: c.text });
    }
    for (const kid of E.model.rows.filter((r) => r.kind === 'resource' && r.parent_id === row.id)) {
      const kidId = ed.newId();
      ops.push({ op: 'row', id: kidId, set: { kind: 'resource', parent_id: id, sort: sort + 0.001 } });
      for (const c of ed.cellList(E.model).filter((x) => x.row_id === kid.id)) {
        ops.push({ op: 'cell', row_id: kidId, day: c.day, color: c.color, text: c.text });
      }
    }
    commit(ops);
    respaceIfNeeded();
  }

  function deleteRows(rows) {
    const ids = [...new Set(rows.filter(Boolean).map((r) => (r.kind === 'resource' ? r.id : r.id)))];
    if (!ids.length) return;
    const ops = ed.deleteOps(E.model, ids);
    commit(ops);
    toast({
      message: `Deleted ${ids.length} row${ids.length === 1 ? '' : 's'}.`,
      action: { label: 'Undo', onClick: () => undo() },
      timeout: 6000,
    });
  }

  function archiveRows(rows, archived) {
    const ops = rows.filter((r) => r && r.kind !== 'resource').map((r) => ({ op: 'row', id: r.id, set: { archived } }));
    commit(ops);
    if (archived && ops.length) {
      toast({
        message: `Archived ${ops.length} row${ops.length === 1 ? '' : 's'} — off the sheet and out of the export, `
          + 'kept for the record. "Show archived rows" brings them back.',
        action: { label: 'Undo', onClick: () => undo() },
        timeout: 7000,
      });
    }
  }

  /**
   * Move a row — with everything that belongs to it — to where another is.
   *
   * An activity carries its names; a section carries its whole block. The
   * block lands before the target row when moving up and after it when moving
   * down, which is where the drop line said it would.
   */
  function moveRowTo(fromR, toR) {
    const rows = E.view.rows;
    const moving = rows[fromR];
    const target = rows[toR];
    if (!moving || !target || moving.id === target.id) return;
    const ordered = ed.orderedRows(E.model.rows, { archived: true });
    const head = moving.kind === 'resource' ? ordered.find((r) => r.id === moving.parent_id) : moving;
    const idx = ordered.findIndex((r) => r.id === head.id);
    const [s, e] = head.kind === 'section' ? ed.sectionBlock(ordered, idx) : ed.rowBlock(ordered, idx);
    const blockRows = ordered.slice(s, e + 1).filter((r) => r.kind !== 'resource');
    if (blockRows.some((r) => r.id === (target.kind === 'resource' ? target.parent_id : target.id))) return;

    const rest = ordered.filter((r, i) => (i < s || i > e) && r.kind !== 'resource');
    const tHead = target.kind === 'resource' ? rest.find((r) => r.id === target.parent_id) : target;
    let at = rest.findIndex((r) => r.id === tHead.id);
    if (toR > fromR) {
      // After the target's own block.
      const tIdx = ordered.findIndex((r) => r.id === tHead.id);
      const [, te] = tHead.kind === 'section' && E.collapsed.has(tHead.id) ? ed.sectionBlock(ordered, tIdx) : ed.rowBlock(ordered, tIdx);
      const lastTop = [...ordered.slice(tIdx, te + 1)].reverse().find((r) => r.kind !== 'resource');
      at = rest.findIndex((r) => r.id === lastTop.id) + 1;
    }
    const before = rest[at - 1]?.sort ?? null;
    const after = rest[at]?.sort ?? null;
    const n = blockRows.length;
    const lo = before ?? (after != null ? after - 1024 * (n + 1) : 0);
    const hi = after ?? lo + 1024 * (n + 1);
    const ops = blockRows.map((r, i) => ({ op: 'row', id: r.id, set: { sort: lo + ((hi - lo) * (i + 1)) / (n + 1) } }));
    // Names follow their activity by `parent_id`; their own sort just keeps them in order.
    for (const kid of ordered.slice(s, e + 1).filter((r) => r.kind === 'resource')) {
      const parentOp = ops.find((o) => o.id === kid.parent_id);
      if (parentOp) ops.push({ op: 'row', id: kid.id, set: { sort: parentOp.set.sort + 0.001 } });
    }
    commit(ops);
    respaceIfNeeded();
    const r = E.view.rows.findIndex((x) => x.id === moving.id);
    if (r >= 0) {
      E.anchor = { r, c: 0 };
      E.focus = { r, c: E.view.cols - 1 };
      paintSelection();
    }
  }

  function nudgeRow(direction) {
    const r = E.focus.r;
    const rows = E.view.rows;
    const row = rows[r];
    if (!row) return;
    // The next row that is not one of this row's own, in that direction.
    let t = r + direction;
    while (rows[t] && (rows[t].parent_id === row.id || (row.kind === 'resource' && rows[t].id === row.parent_id))) t += direction;
    if (!rows[t]) return;
    moveRowTo(r, t);
  }

  function respaceIfNeeded() {
    const ordered = ed.orderedRows(E.model.rows, { archived: true });
    if (ed.needsRespace(ordered)) {
      const ops = ed.respace(ordered);
      for (const kid of ordered.filter((r) => r.kind === 'resource')) {
        const parent = ops.find((o) => o.id === kid.parent_id);
        if (parent) ops.push({ op: 'row', id: kid.id, set: { sort: parent.set.sort + 0.001 } });
      }
      commit(ops, { keepRedo: true });
    }
  }

  function showDropLine(r) {
    const scroller = E.root.querySelector('.lae-scroll');
    let line = scroller.querySelector('.lae-drop-line');
    if (!line) {
      line = el('div', { class: 'lae-drop-line' });
      scroller.appendChild(line);
    }
    const tr = E.root.querySelector(`.lae-grid tbody tr[data-r="${Math.min(r, E.view.rows.length - 1)}"]`);
    if (!tr) return;
    const host = scroller.getBoundingClientRect();
    const box = tr.getBoundingClientRect();
    const y = (r >= E.view.rows.length ? box.bottom : box.top) - host.top + scroller.scrollTop;
    line.style.top = `${y - 1}px`;
  }

  /* ── Menus ─────────────────────────────────────────────────────────────── */

  function selectedRows() {
    const { r0, r1 } = rect();
    return E.view.rows.slice(r0, r1 + 1);
  }

  function cellMenu(x, y, row) {
    const rows = selectedRows();
    const one = rows.length === 1 ? rows[0] : null;
    const days = E.focus.c >= META;
    const items = [
      { label: 'Cut', icon: 'copy', key: 'mod+x', onClick: () => clipboardCommand('cut') },
      { label: 'Copy', icon: 'copy', key: 'mod+c', onClick: () => clipboardCommand('copy') },
      E.clip ? { label: 'Paste', icon: 'clipboard', key: 'mod+v', onClick: () => pasteInternal() } : null,
      days ? { label: 'Clear text', icon: 'x', key: 'del', onClick: () => clearSelection() } : null,
      days ? { label: 'Clear text and colour', icon: 'x', onClick: () => clearSelection({ colour: true }) } : null,
      days && selectedCells().some((c) => c.row?.kind === 'activity' && ed.cancelledTokens(ed.getCell(E.model, c.row.id, c.day)?.text || '').length)
        ? { label: 'Reinstate cancelled resources', icon: 'refresh', onClick: () => reinstateSelection() } : null,
      days && selectedCells().some((c) => c.row?.kind === 'activity' && ed.supportTokens(ed.getCell(E.model, c.row.id, c.day)?.text || '').length)
        ? { label: 'Cancel BART resources…', icon: 'x', onClick: () => cancelResourcesOnSelection() } : null,
      one && one.kind !== 'section' && days
        ? { label: 'History of this day…', icon: 'history', onClick: () => historyDialog(one, E.view.days[E.focus.c - META]) }
        : null,
      one ? { label: 'History of this row…', icon: 'history', onClick: () => historyDialog(one, null) } : null,
      E.p6.available && activitiesIn(rows).length
        ? {
          label: activitiesIn(rows).length > 1 ? `Link ${activitiesIn(rows).length} activities to P6…` : 'Link to P6…',
          icon: 'link', key: 'alt+k', onClick: () => linkSelection(),
        }
        : null,
      'sep',
      { heading: 'Row' },
      { label: 'Insert activity above', icon: 'plus', onClick: () => insertRow('activity', 'above') },
      { label: 'Insert activity below', icon: 'plus', onClick: () => insertRow('activity', 'below') },
      { label: 'Insert section above', icon: 'layers', onClick: () => insertRow('section', 'above') },
      { label: 'Insert section below', icon: 'layers', onClick: () => insertRow('section', 'below') },
      one?.kind === 'activity' && !E.model.rows.some((r) => r.kind === 'resource' && r.parent_id === one.id)
        ? { label: 'Add a names row', icon: 'users', onClick: () => addNamesRow(one) } : null,
      { label: 'Add a PTO / Office row', icon: 'calendar', onClick: () => insertRow('absence', 'below', { absence_kind: 'pto', description: 'PTO' }) },
      one && one.kind !== 'resource' ? { label: 'Duplicate', icon: 'copy', onClick: () => duplicateRow(one) } : null,
      one && one.kind !== 'resource' ? { label: 'Move up', icon: 'chevron-up', key: 'alt+↑', onClick: () => nudgeRow(-1) } : null,
      one && one.kind !== 'resource' ? { label: 'Move down', icon: 'chevron-down', key: 'alt+↓', onClick: () => nudgeRow(1) } : null,
      one?.kind === 'section' ? { label: 'Indent', icon: 'chevron-right', disabled: (one.level || 0) >= 3, onClick: () => commit([{ op: 'row', id: one.id, set: { level: (one.level || 0) + 1 } }]) } : null,
      one?.kind === 'section' ? { label: 'Outdent', icon: 'chevron-left', disabled: !(one.level > 0), onClick: () => commit([{ op: 'row', id: one.id, set: { level: one.level - 1 } }]) } : null,
      one?.kind === 'absence' ? { label: 'Kind…', icon: 'calendar', onClick: () => absenceKindDialog(one) } : null,
      one?.kind === 'activity' ? { label: 'Details and support…', icon: 'list', onClick: () => detailsDialog(one) } : null,
      'sep',
      rows.some((r) => r.archived)
        ? { label: 'Restore', icon: 'eye', onClick: () => archiveRows(rows, false) }
        : { label: 'Archive', icon: 'eye-off', onClick: () => archiveRows(rows, true) },
      { label: rows.length > 1 ? `Delete ${rows.length} rows` : 'Delete row', icon: 'trash', danger: true, onClick: () => deleteRows(rows) },
    ];
    contextMenu(x, y, items);
  }

  /**
   * Copy or cut from the menu. Through the browser's own command where it will
   * run one — so the system clipboard gets the HTML Excel pastes — and straight
   * into the editor's clipboard where it will not.
   */
  function clipboardCommand(kind) {
    focusGrid();
    let done = false;
    try {
      done = document.execCommand(kind);
    } catch {
      done = false;
    }
    if (!done) copy(null, kind === 'cut');
  }

  function pasteInternal() {
    if (!E.clip) return;
    const sel = rect();
    writeBlock(E.clip.block, sel.r0, sel.c0);
  }

  function moreMenu(e) {
    const box = e.currentTarget.getBoundingClientRect();
    contextMenu(box.left, box.bottom + 4, [
      { label: E.showArchived ? 'Hide archived rows' : 'Show archived rows', icon: E.showArchived ? 'eye-off' : 'eye', onClick: () => { E.showArchived = !E.showArchived; draw(); } },
      { label: 'Fold every section', icon: 'chevron-up', onClick: () => { for (const r of E.model.rows) if (r.kind === 'section') E.collapsed.add(r.id); draw(); } },
      { label: 'Unfold every section', icon: 'chevron-down', onClick: () => { E.collapsed.clear(); draw(); } },
      { label: 'Sheet title…', icon: 'type', onClick: () => titleDialog() },
      E.p6.available ? { label: 'Import P6 activities…', icon: 'upload', onClick: () => importP6() } : null,
      { label: 'Keyboard and mouse…', icon: 'help', onClick: () => helpDialog() },
      'sep',
      { label: 'Take me back to an earlier moment…', icon: 'history', onClick: () => restoreDialog() },
      { label: 'Reload from the server', icon: 'refresh', onClick: async () => { await drain(); await reload(); } },
      { label: 'Go back to reading the workbook…', icon: 'unlink', danger: true, onClick: () => revertDialog() },
    ]);
  }

  /* ── Dialogs ───────────────────────────────────────────────────────────── */

  function detailsDialog(row) {
    const inputs = {};
    const form = el('div', { class: 'lae-form' });
    for (const f of ed.FIELDS) {
      inputs[f.key] = textInput({ value: row[f.key] || '' });
      const control = f.key === 'activity_id' && E.p6.available
        ? el('div', { class: 'lae-p6-field' }, [inputs[f.key], el('button', {
          class: 'cx-btn mini', type: 'button', html: icon('link', { size: 12 }) + '<span>Find in P6…</span>',
          onClick: () => openP6Picker({
            title: 'Link to a P6 activity',
            subtitle: inputs.description.value || row.description || '',
            p6: E.p6,
            uses: p6.p6Coverage(E.model.rows, E.p6.index).uses,
            current: inputs.activity_id.value,
            onPick: ({ value, entry, fill }) => {
              inputs.activity_id.value = value;
              if (fill && entry?.name && !inputs.description.value.trim()) inputs.description.value = entry.name;
            },
            onImport: () => importP6(),
          }),
        })])
        : inputs[f.key];
      form.appendChild(el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: f.heading }), control]));
    }
    const days = E.view.days;
    const totals = ed.supportTotals(E.model, days).byRow.get(row.id);
    const kids = E.model.rows.filter((r) => r.kind === 'resource' && r.parent_id === row.id);
    const lines = days.map((d) => {
      const cell = ed.getCell(E.model, row.id, d);
      const names = kids.map((k) => ed.getCell(E.model, k.id, d)?.text).filter(Boolean).join('; ');
      if (!cell && !names) return null;
      const meaning = cell?.color ? E.legendAll.find((e) => e.argb === cell.color)?.meaning || `#${cell.color}` : '';
      const codes = cell?.text && looksLikeCodes(cell.text)
        ? ed.supportTokens(cell.text).map((t) => codeName(t)).join(' + ') : (cell?.text || '');
      return el('tr', {}, [
        el('td', { text: fmt(d) + ' ' + ed.weekdayLetter(d) }),
        el('td', {}, [cell?.color ? el('span', { class: 'la-swatch', style: `background:#${cell.color}` }) : null, meaning].filter(Boolean)),
        el('td', { text: codes }),
        el('td', { text: names }),
      ]);
    }).filter(Boolean);
    const summary = el('div', { class: 'lae-summary' }, [
      el('div', { class: 'rc-eyebrow', text: `Support requested, ${fmt(days[0])} – ${fmt(days[days.length - 1])}` }),
      el('div', { class: 'lae-summary-total', text: totals ? ed.describeCounts(totals, E.codes).replace(/(\d+) (\w+)/g, (_, n, c) => `${n} × ${codeName(c)}`) : 'None asked for in these weeks.' }),
      lines.length
        ? el('div', { class: 'rc-scroll' }, [el('table', { class: 'rc-table', dataset: { plain: '1' } }, [
          el('thead', {}, [el('tr', {}, ['Day', 'Shift', 'Support', 'Names'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, lines),
        ])])
        : null,
    ].filter(Boolean));
    openModal({
      title: row.description || 'Activity',
      subtitle: 'Its columns on the sheet, and what it asks for',
      size: 'wide',
      body: el('div', {}, [form, summary]),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save', kind: 'primary', onClick: () => {
            if (E.p6.available) inputs.activity_id.value = p6.p6Canonical(inputs.activity_id.value, E.p6.index);
            const set = {};
            for (const f of ed.FIELDS) if ((row[f.key] || '') !== inputs[f.key].value) set[f.key] = inputs[f.key].value;
            if (Object.keys(set).length) commit([{ op: 'row', id: row.id, set }]);
          },
        },
      ],
    });
  }

  function absenceKindDialog(row) {
    const kind = selectInput({
      value: row.absence_kind || 'pto',
      options: [
        { value: 'pto', label: 'PTO — away' },
        { value: 'office', label: 'Office — at their desk' },
        { value: 'other', label: 'Other group / project' },
      ],
    });
    const label = textInput({ value: row.description || '' });
    openModal({
      title: 'What this row records',
      body: el('div', { class: 'lae-form' }, [
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Kind' }), kind]),
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Label on the sheet' }), label]),
      ]),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save', kind: 'primary', onClick: () => {
            const set = {};
            if (kind.value !== row.absence_kind) set.absence_kind = kind.value;
            const words = { pto: 'PTO', office: 'Office', other: 'Other Group / Project' };
            const text = label.value.trim() || words[kind.value];
            if (text !== row.description) set.description = text;
            if (Object.keys(set).length) commit([{ op: 'row', id: row.id, set }]);
          },
        },
      ],
    });
  }

  function titleDialog() {
    const input = textInput({ value: E.title });
    openModal({
      title: 'Sheet title',
      subtitle: 'Printed across the top of the exported workbook',
      body: input,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save', kind: 'primary', onClick: async () => {
            try {
              await rc.setSetting('lookahead_title', input.value.trim());
              E.title = input.value.trim();
              toast({ tone: 'good', message: 'Title saved.' });
            } catch (err) {
              toast({ tone: 'bad', message: err.message });
            }
          },
        },
      ],
    });
  }

  function helpDialog() {
    const rows = [
      ['Click, then Shift+click or drag', 'Select a range of days'],
      ['Type', 'Replace what is in the cell'],
      ['F2 or double-click', 'Edit what is in the cell'],
      ['Enter / Tab', 'Save and move down / right'],
      ['Delete', 'Clear the text (Shift+Delete: the colour too)'],
      ['Alt+1 … Alt+9', 'Paint with a legend colour (Alt+0 clears it)'],
      ['Code buttons', 'Add support to every selected day (Shift+click takes one away)'],
      ['Type in Activity ID', 'Search P6 by name or ID — Enter takes the match, Escape keeps what you typed'],
      ['Alt+K', 'Link every selected activity to one P6 activity, or say why they have none'],
      ['Drag the square at the corner', 'Repeat the selection across or down'],
      ['Ctrl+D / Ctrl+R', 'Fill down / fill right'],
      ['Ctrl+C, Ctrl+X, Ctrl+V', 'Copy, cut and paste — to and from Excel, colours included'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
      ['Drag the grip on the left', 'Move a row — an activity takes its names, a section its rows'],
      ['Alt+↑ / Alt+↓', 'Move the selected row'],
      ['Right-click', 'Insert, duplicate, archive, delete, details'],
    ];
    openModal({
      title: 'Editing the look-ahead',
      size: 'wide',
      body: el('div', { class: 'rc-scroll' }, [el('table', { class: 'rc-table', dataset: { plain: '1' } }, [
        el('tbody', {}, rows.map(([k, v]) => el('tr', {}, [el('td', { class: 'rc-mono', text: k }), el('td', { text: v })]))),
      ])]),
      actions: [{ label: 'Close', kind: 'primary' }],
    });
  }

  async function revertDialog() {
    const ok = await confirmDialog({
      title: 'Go back to reading the workbook?',
      message: 'The calendar will read the .xlsx in the look-ahead folder again, the next time somebody presses Check now. '
        + 'Nothing written here is deleted — it stays for the record, and you can come back to it.',
      confirmLabel: 'Go back to the workbook',
      danger: true,
    });
    if (!ok) return;
    await drain();
    await rc.setSetting('lookahead_source', 'workbook');
    la.source = 'workbook';
    la.section = 'calendar';
    la.editing = false;
    notifyChanged('lookahead');
  }

  /* ── Going back ─────────────────────────────────────────────────────────── */

  /**
   * "Put it back the way it was at 9:00 on Monday."
   *
   * The edit log already holds every change with what was there before it, so
   * any moment it covers can be returned to: pick the save to go back to before,
   * see how much that undoes, and the editor writes the difference as ordinary
   * edits (`restoreOps()`). Nothing is erased — the log keeps the changes being
   * reversed and the reversal itself — and one Ctrl+Z takes the restore back.
   */
  /**
   * Who changed this — one day of a row, or the row's own fields — read from
   * the edit log. The log is only ever appended to, so this is the whole story.
   */
  async function historyDialog(row, day) {
    await drain();
    let edits;
    let people;
    try {
      [edits, people] = await Promise.all([
        rc.listLaEditsForRow(row.id),
        rc.listPeople({ includeInactive: true }).catch(() => []),
      ]);
    } catch (err) {
      toast({ tone: 'bad', message: err.message });
      return;
    }
    const nameOf = authorNames(people);
    const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const meaning = (hex) => E.legendAll.find((e) => e.argb === hex)?.meaning || '';
    const name = ed.metaValues(row).filter(Boolean)[0] || (row.kind === 'resource' ? 'Names row' : 'Row');
    const list = el('ol', { class: 'lae-history', 'aria-label': 'Changes, newest first' });

    if (day) {
      for (const h of ed.cellHistory(edits, row.id, day)) {
        list.appendChild(el('li', { class: 'lae-history-item' }, [
          el('span', { class: 'lae-history-when', text: when(h.at) }),
          el('span', { class: 'lae-history-who', text: nameOf(h.by) || 'Somebody' }),
          el('span', { class: 'lae-history-what' }, [
            el('span', { class: 'lae-history-from', text: ed.describeCellValue(h.before, meaning) }),
            el('span', { class: 'lae-history-arrow', html: icon('chevron-right', { size: 11 }), 'aria-label': 'became' }),
            el('span', { class: 'lae-history-to', text: ed.describeCellValue(h.after, meaning) }),
          ]),
        ]));
      }
    } else {
      for (const h of ed.rowHistory(edits, row.id)) {
        const what = h.action === 'insert' ? 'Added'
          : h.action === 'delete' ? 'Deleted'
            : h.changes.map((c) => `${c.field}: ${c.from === '' ? 'empty' : c.from} → ${c.to === '' ? 'empty' : c.to}`).join('; ');
        list.appendChild(el('li', { class: 'lae-history-item' }, [
          el('span', { class: 'lae-history-when', text: when(h.at) }),
          el('span', { class: 'lae-history-who', text: nameOf(h.by) || 'Somebody' }),
          el('span', { class: 'lae-history-what', text: what }),
        ]));
      }
    }
    const body = list.childElementCount
      ? list
      : el('p', { class: 'rc-hint', text: day ? 'Nothing has been written on this day yet.' : 'This row has not been changed since it was added.' });
    openModal({
      title: day ? `History of ${fmtLong(day)}` : 'History of this row',
      subtitle: name,
      body: el('div', { class: 'lae-form' }, [body]),
      actions: [{ label: 'Close' }],
    });
  }

  async function restoreDialog() {
    await drain();
    let edits;
    let people;
    try {
      [edits, people] = await Promise.all([rc.listLaEdits({ limit: 3000 }), rc.listPeople({ includeInactive: true }).catch(() => [])]);
    } catch (err) {
      toast({ tone: 'bad', message: err.message });
      return;
    }
    const nameOf = authorNames(people);
    const points = ed.restorePoints(edits).slice(0, 60);
    if (!points.length) {
      toast({ message: 'Nothing has been changed here yet, so there is nowhere to go back to.' });
      return;
    }
    const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    let chosen = points[0];
    const summary = el('div', { class: 'rc-hint' });
    const listEl = el('div', { class: 'lae-restore-list', role: 'listbox', 'aria-label': 'Saves' });
    const drawList = () => {
      clear(listEl);
      for (const p of points) {
        listEl.appendChild(el('button', {
          class: `lae-restore-point${p === chosen ? ' on' : ''}`, type: 'button', role: 'option',
          'aria-selected': String(p === chosen),
          onClick: () => { chosen = p; drawList(); },
        }, [
          el('span', { class: 'lae-restore-when', text: when(p.at) }),
          el('span', { text: nameOf(p.by) || 'Somebody' }),
          el('span', { class: 'rc-hint', text: `${p.count} change${p.count === 1 ? '' : 's'} on ${p.rows} row${p.rows === 1 ? '' : 's'}` }),
        ]));
      }
      const since = points.filter((p) => p.firstId >= chosen.firstId);
      const n = since.reduce((t, p) => t + p.count, 0);
      summary.textContent = `Goes back to just before ${when(chosen.at)}: reverses ${n} change${n === 1 ? '' : 's'} in `
        + `${since.length} save${since.length === 1 ? '' : 's'}. Nothing is erased — the reversal is itself a change you can undo.`;
    };
    drawList();
    openModal({
      title: 'Take me back to an earlier moment',
      subtitle: 'Choose the save to go back to before',
      body: el('div', { class: 'lae-form lae-restore' }, [listEl, summary]),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Go back', kind: 'primary', onClick: async () => {
            try {
              const later = edits.filter((e) => Number(e.id) >= chosen.firstId);
              const days = later.filter((e) => e.day).map((e) => String(e.day).slice(0, 10)).sort();
              if (days.length) await ensureWindow([days[0], days[days.length - 1]]);
              const ops = ed.restoreOps(E.model, later);
              if (!ops.length) {
                toast({ message: 'The look-ahead is already as it was then.' });
                return;
              }
              commit(ops);
              toast({
                tone: 'good',
                message: `Back to how it was before ${when(chosen.at)} — ${ops.length} change${ops.length === 1 ? '' : 's'} made.`,
                action: { label: 'Undo', onClick: () => undo() },
                timeout: 8000,
              });
            } catch (err) {
              toast({ tone: 'bad', message: err.message, timeout: 10000 });
              rc.reportError('lookahead:restore', err);
            }
          },
        },
      ],
    });
  }

  /* ── Export ────────────────────────────────────────────────────────────── */

  function openExport() {
    openExcelExport();
  }

  /**
   * What an export is built from. The editor's own state when it is open — it
   * holds exactly what was just typed — and otherwise the same rows and cells
   * read afresh, so the calendar's read view offers the identical workbook
   * without opening the editor, to anybody who can see the look-ahead.
   */
  async function exportSource() {
    if (E.model) {
      return { model: E.model, legend: E.legend, codes: E.codes, title: E.title, weeks: E.weeks, ensure: ensureWindow };
    }
    const [settings, legend, codes, rows] = await Promise.all([
      rc.listSettings().catch(() => []),
      rc.listLegend().catch(() => []),
      rc.listSupportCodes({ includeRetired: true }).catch(() => []),
      rc.listLaRows(),
    ]);
    const src = {
      model: ed.makeModel(rows.map(ed.cleanRow), []),
      legend: legendInForce(legend).shifts,
      codes,
      title: settings.find((r) => r.key === 'lookahead_title')?.value || '',
      weeks: ed.WINDOW_WEEKS.includes(la.editorWeeks) ? la.editorWeeks : 4,
      loaded: null,
    };
    src.ensure = async (days) => {
      const from = days[0];
      const to = days[days.length - 1];
      if (src.loaded && from >= src.loaded.from && to <= src.loaded.to) return;
      const cells = await rc.listLaCells(from, to);
      src.model = ed.makeModel(rows.map(ed.cleanRow), cells.map(ed.cleanCell));
      src.loaded = { from, to };
    };
    return src;
  }

  /**
   * The 4WLA as an .xlsx, built without asking — names rows included — for the
   * master export to file beside its workbook: every week written here, from the
   * first day anything was (`laCellSpan()`) to the last, and never less than this
   * week and the next three. `from` and `to` are the export's own dates, and
   * narrow it; weeks nothing was ever written in are never drawn, however far
   * back the dates reach. It used to be this week and the next three only, so
   * the record of what the look-ahead said went out of the file as each week
   * passed. Null until the look-ahead is written here: before that the workbook
   * in the folder is the 4WLA, and the editor's tables would be an old copy of
   * it — and null when the dates asked for hold nothing written.
   */
  async function lookaheadFileNow({ from = null, to = null } = {}) {
    const settings = await rc.listSettings().catch(() => []);
    const said = (key) => settings.find((r) => r.key === key)?.value;
    if (said('lookahead_source') !== EDITOR_SOURCE) return null;
    const span = await rc.laCellSpan().catch(() => ({ first: null, last: null }));
    const thisMonday = ed.mondayOf(todayISO());
    const first = [span.first, thisMonday].filter(Boolean).sort()[0];
    const last = [span.last, ed.addDaysISO(thisMonday, 27)].filter(Boolean).sort().pop();
    const start = ed.mondayOf(from && from > first ? from : first);
    const end = to && to < last ? to : last;
    if (end < start) return null;
    const weeks = Math.floor((Date.parse(end) - Date.parse(start)) / (7 * 864e5)) + 1;
    const days = ed.windowDays(start, weeks);
    const src = await exportSource();
    await src.ensure(days);
    const sheetName = said('lookahead_sheet') || '4WLA';
    const bytes = lookaheadWorkbook({
      model: src.model, days, legend: src.legend, codes: src.codes.filter((c) => c.active !== false), title: src.title, sheetName,
      resources: true,
    });
    return { bytes, name: lookaheadLatestName(sheetName), from: days[0], to: days[days.length - 1] };
  }

  /** The 4WLA as an .xlsx — from the editor, or from the calendar's read view. */
  async function openExcelExport() {
    let src;
    try {
      src = await exportSource();
    } catch (err) {
      toast({ tone: 'bad', message: err.message, timeout: 10000 });
      rc.reportError('lookahead:export', err);
      return;
    }
    const thisMonday = ed.mondayOf(todayISO());
    const starts = [-7, 0, 7, 14].map((d) => ed.addDaysISO(thisMonday, d));
    const start = selectInput({
      value: thisMonday,
      options: starts.map((d, i) => ({ value: d, label: `${['Last week', 'This week', 'Next week', 'In two weeks'][i]} — from ${fmt(d)}` })),
    });
    let weeks = src.weeks;
    const size = segmented({
      value: weeks,
      options: ed.WINDOW_WEEKS.map((w) => ({ value: w, label: `${w} weeks` })),
      onChange: (w) => { weeks = w; update(); },
    });
    const summary = el('div', { class: 'rc-hint' });
    const update = async () => {
      const days = ed.windowDays(start.value, weeks);
      await src.ensure(days).catch(() => {});
      const rows = ed.rowsWithWork(src.model, days);
      const n = rows.filter((r) => r.kind === 'activity').length;
      summary.textContent = `${n} activit${n === 1 ? 'y' : 'ies'} with work between ${fmt(days[0])} and ${fmt(days[days.length - 1])}, `
        + (la.exportResources
          ? 'with their sections, names rows and the PTO / Office / Other group rows'
          : 'with their sections — no names rows, and no PTO / Office / Other group rows')
        + ' — in the 4WLA layout, ready to copy into the master file.';
    };
    const resourcesBox = checkbox({
      label: 'Show resources — names under each activity, and the PTO, Office and Other group / project rows',
      checked: la.exportResources,
      onChange: (on) => { la.exportResources = on; update(); },
    });
    resourcesBox.classList.add('lae-export-resources');
    start.addEventListener('change', update);
    await update();

    const canFolder = filestore.hasFolder?.();
    const build = async () => {
      const days = ed.windowDays(start.value, weeks);
      await src.ensure(days);
      const settings = await rc.listSettings().catch(() => []);
      const sheetName = settings.find((r) => r.key === 'lookahead_sheet')?.value || '4WLA';
      const bytes = lookaheadWorkbook({
        model: src.model, days, legend: src.legend, codes: src.codes.filter((c) => c.active !== false), title: src.title, sheetName,
        resources: la.exportResources,
      });
      return { bytes, name: lookaheadFileName(days, sheetName) };
    };
    openModal({
      title: 'Export to Excel',
      subtitle: 'The same columns, merged headings and colours as the 4WLA',
      body: el('div', { class: 'lae-form' }, [
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Starting' }), start]),
        el('div', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Weeks' }), size]),
        resourcesBox,
        summary,
      ]),
      actions: [
        { label: 'Cancel' },
        canFolder ? {
          label: 'Save to the shared folder', onClick: async () => {
            try {
              const { bytes, name } = await build();
              await filestore.intakeWrite(`lookahead/${name}`, bytes);
              toast({ tone: 'good', title: 'Saved to the shared folder', message: `lookahead/${name}` });
            } catch (err) {
              toast({ tone: 'bad', message: err.message, timeout: 10000 });
            }
          },
        } : null,
        {
          label: 'Download', kind: 'primary', autofocus: true, onClick: async () => {
            try {
              const { bytes, name } = await build();
              saveFile(name, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Look-ahead');
            } catch (err) {
              toast({ tone: 'bad', message: err.message, timeout: 10000 });
              rc.reportError('lookahead:export', err);
            }
          },
        },
      ].filter(Boolean),
    });
  }

  /** Make sure the cells of a window outside the one on screen are loaded. */
  async function ensureWindow(days) {
    const from = days[0];
    const to = days[days.length - 1];
    if (E.loaded && from >= E.loaded.from && to <= E.loaded.to) return;
    const cells = await rc.listLaCells(from, to);
    for (const c of cells.map(ed.cleanCell)) {
      const key = ed.cellKey(c.row_id, c.day);
      if (!E.model.cells.has(key)) {
        E.model.cells.set(key, c);
        E.server.set(`cell:${key}`, c.version || 0);
      }
    }
    E.loaded = { from: [from, E.loaded?.from || from].sort()[0], to: [to, E.loaded?.to || to].sort().reverse()[0] };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Saving, publishing and noticing the other editor
     ═══════════════════════════════════════════════════════════════════════ */

  function enqueue(ops) {
    E.queue.push(...ops);
    E.dirtySincePublish = true;
    clearTimeout(E.publishTimer);
    setTimeout(() => drain(), 0);
  }

  /**
   * Send what is queued, in order, stamped with the versions the server holds.
   *
   * Stamped here rather than when the edit was made, and simulated forward op by
   * op, so two quick edits to one cell expect 0 and then 1 — not 0 twice.
   */
  async function drain() {
    if (E.saving) return E.saving;
    E.saving = (async () => {
      /* Round again if an edit arrived while the last round was finishing —
         asking the revision is a wait too, and an edit made during it would
         otherwise sit in the queue until the next one came along. */
      for (;;) {
        while (E.queue.length) {
          const batch = E.queue.slice(0, SAVE_BATCH);
          const shadow = new Map(E.server);
          const stamped = batch.map((op) => {
            const key = op.op === 'cell' ? `cell:${op.row_id}|${op.day}` : `row:${op.id}`;
            const expect = shadow.get(key) || 0;
            if (op.op === 'delete_row') shadow.delete(key);
            else if (op.op === 'cell' && !op.color && !op.text) shadow.delete(key);
            else shadow.set(key, expect + 1);
            return { ...op, expect };
          });
          E.status = 'saving';
          refreshStatus();
          try {
            const results = await rc.applyLookaheadOps(stamped);
            E.queue.splice(0, batch.length);
            for (const r of results || []) {
              if (r.kind === 'cell') {
                const key = `cell:${r.row_id}|${String(r.day).slice(0, 10)}`;
                if (r.version) E.server.set(key, r.version);
                else E.server.delete(key);
              } else if (r.deleted) E.server.delete(`row:${r.id}`);
              else E.server.set(`row:${r.id}`, r.version);
            }
            ed.acknowledge(E.model, (results || []).map((r) => ({ ...r, day: r.day ? String(r.day).slice(0, 10) : r.day })));
            E.retryIn = 0;
          } catch (err) {
            if (/conflict/i.test(err.message)) {
              await onConflict(err);
              break;
            }
            E.status = 'retry';
            E.retryIn = Math.min(30, (E.retryIn || 2) * 2);
            refreshStatus();
            rc.reportError('lookahead:save', err);
            const wait = E.retryIn;
            setTimeout(() => { E.saving = null; drain(); }, wait * 1000);
            return;
          }
        }
        if (E.status === 'conflict') break;
        E.revision = await rc.lookaheadRevision().catch(() => E.revision);
        if (!E.queue.length) break;
      }
      if (!E.queue.length && E.status !== 'conflict') E.status = 'saved';
      refreshStatus();
      schedulePublish();
    })().finally(() => { E.saving = null; });
    return E.saving;
  }

  async function onConflict(err) {
    E.queue = [];
    E.undo = [];
    E.redo = [];
    await reload();
    E.status = 'conflict';
    refreshStatus();
    toast({
      tone: 'warn',
      title: 'Somebody else changed the same thing',
      message: 'The look-ahead was reloaded with their version, and your last change was not saved. Make it again if it still needs making.',
      timeout: 12000,
    });
    rc.reportError('lookahead:conflict', err);
  }

  async function reload() {
    cancelEdit();
    E.model = null;
    await load();
    draw();
  }

  function schedulePublish() {
    clearTimeout(E.publishTimer);
    if (!E.dirtySincePublish) return;
    E.publishTimer = setTimeout(() => { publish(); }, PUBLISH_QUIET_MS);
  }

  /**
   * Publish what the model holds, one publish at a time: a second waits for the
   * first, then publishes only if something changed since it began. Two running
   * at once could land out of order and leave the older sheet as the newest
   * reading.
   */
  function publish() {
    clearTimeout(E.publishTimer);
    const run = (E.publishing || Promise.resolve()).catch(() => {}).then(publishNow);
    E.publishing = run;
    run.finally(() => { if (E.publishing === run) E.publishing = null; }).catch(() => {});
    return run;
  }

  async function publishNow() {
    E.publishError = null;
    // Published only once it is saved: the reading must be what the server holds.
    if (E.queue.length || E.saving) await drain();
    if (!E.model || E.queue.length || !E.dirtySincePublish) return;
    E.dirtySincePublish = false;
    try {
      await publishFromEditor({ model: E.model, title: E.title, silent: true });
    } catch (err) {
      E.dirtySincePublish = true;
      E.publishError = err;
      rc.reportError('lookahead:publish', err);
      return;
    }
    tidyOnceADay();
  }

  /**
   * Compact superseded editor readings past the keep period — at most once a day
   * from this browser, quietly, after a publish. The rules, and why nothing is
   * deleted, are in `rc_compact_snapshots()`; Organisation → Settings runs it on
   * demand too. Browser storage only remembers that it ran today: if it cannot,
   * it runs again, which changes nothing the second time.
   */
  function tidyOnceADay() {
    const key = 'cx.rc.compactedOn';
    const today = todayISO();
    try {
      if (localStorage.getItem(key) === today) return;
      localStorage.setItem(key, today);
    } catch {
      // No storage: running it again is harmless.
    }
    rc.compactSnapshots().catch((err) => rc.reportError('lookahead:compact', err));
  }

  /**
   * Look for the other editor's changes, quietly, while nobody is mid-edit — the
   * moment the bell rings (`rc.onLookaheadChange()`), and on a poll that slows
   * to a check while the bell is connected. A ring that lands mid-edit is not
   * lost: the next poll, the window's focus or the next ring asks again.
   */
  function startPolling() {
    if (E.pollTimer) return;
    let asked = 0;
    const tick = async () => {
      if (!E.root?.isConnected || document.hidden || E.editing || E.queue.length || E.saving) return;
      asked = Date.now();
      try {
        // The folder first: another computer's save is only in memory once it is read in.
        await rc.checkFolder();
        if (E.editing || E.queue.length || E.saving) return;
        const rev = await rc.lookaheadRevision();
        // Asked again after the wait: an edit made meanwhile is not the other editor's.
        if (E.editing || E.queue.length || E.saving) return;
        if (rev > E.revision) {
          // Somebody else wrote: whatever this page remembers reading is from
          // before it, and a reload served from memory would draw the old sheet.
          rc.forgetReads();
          await reload();
          toast({ message: 'The look-ahead was updated with changes made by the other editor.', timeout: 4000 });
        }
      } catch {
        /* the next tick will ask again */
      }
    };
    E.pollTimer = setInterval(() => {
      if (rc.lookaheadLive() && Date.now() - asked < POLL_LIVE_MS) return;
      tick();
    }, POLL_MS);
    rc.onLookaheadChange(tick);
    window.addEventListener('focus', tick);
    window.addEventListener('beforeunload', (e) => {
      if (E.queue.length) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  Object.defineProperty(__x, "renderEditor", { get: () => renderEditor, enumerable: true });
  Object.defineProperty(__x, "flushEditor", { get: () => flushEditor, enumerable: true });
  Object.defineProperty(__x, "lookaheadFileNow", { get: () => lookaheadFileNow, enumerable: true });
  Object.defineProperty(__x, "openExcelExport", { get: () => openExcelExport, enumerable: true });
};

// core/tawr.js
__mods["core/tawr.js"] = function (__x, __req) {
  /**
   * Track access work requests (TAWRs), derived from the look-ahead.
   *
   * BART wants a System Access / Track Allocation Work Request for every place
   * the team works, seventeen days before the work. Everything the form needs is
   * already on the 4WLA — where, which days, which shift, what hours, what BART
   * support — so a request is *read off the reading the calendar draws*, never
   * typed again. This module is that reading: one look-ahead week in, one request
   * per place and shift out, each with the values its form fields take.
   *
   * **One request is one location, one shift, one week (Monday to Sunday).** Two
   * activities at the same place on the same shift are one request listing both;
   * the same place on a day shift and a night shift is two. A form has seven date
   * rows, which is why the week is the unit: each day the place is worked is one
   * row, and an activity running five days is one request with five rows.
   *
   * **Hours combine, support adds.** A day's hours are the earliest start and the
   * latest finish of the activities working there that day, read off the Work
   * Hours column — or the shift's own hours where the sheet says nothing. Support
   * is counted per day, adding the activities together (an EIC on IXL and an EIC
   * on DCS the same day is two), and the busiest day is what is asked for: "EIC"
   * for one, "2 x EIC" for two. A witness is never on the form; ROC goes on the
   * OCC line and every other code on Technical Support (Systems), as the support
   * code register says (`tawr_line`).
   *
   * **Nothing is guessed.** A location the register does not know, a colour the
   * legend does not know and an activity with no location are carried onto the
   * request as flags that stop it being approved until somebody fixes the
   * register or the sheet — the same answer the rest of the calendar gives.
   *
   * Pure: no DOM, no network, so `tools/test_tawr.js` runs it in Node.
   *
   * Imports: lookahead.
   */

  const { cellTokens, isCancelMeaning, locationColumnOf } = __req("core/lookahead.js");

  /** How many days before the work the request has to be in. */
  const TAWR_LEAD_DAYS = 17;

  /**
   * Every field on BART's form, by the name it carries in the PDF:
   * `[name, kind, label]`, kind being text, check, choice or sig. The template an
   * administrator uploads is checked against this list, so a revised form that
   * renamed a box is reported rather than filled half way.
   */
  const TAWR_FIELDS = [
    ['advisory_no_work_clearance', 'check', 'Advisory (No Work Clearance)'],
    ['clearance_verification_no', 'check', 'Clearance Verification: No'],
    ['clearance_verification_yes', 'check', 'Clearance Verification: Yes'],
    ['coordinate_hirail_passage', 'check', 'Coordinate Hi-Rail Passage'],
    ['no_passage_hirail_vehicles', 'check', 'No Passage of Hi-Rail Vehicles'],
    ['police_advisory_threat_of_theft', 'check', 'Police Advisory (Threat of Theft)'],
    ['schedule_number', 'text', 'Schedule Number'],
    ['track_inspection_first_train_no', 'check', 'Track Inspection (with 1st Train): No'],
    ['track_inspection_first_train_yes', 'check', 'Track Inspection (with 1st Train): Yes'],
    ['work_in_track_zone_no', 'check', 'Work/Activity in Track Zone: No'],
    ['work_in_track_zone_yes', 'check', 'Work/Activity in Track Zone: Yes'],
    ['person_in_charge_cell_phone', 'text', 'Person in Charge Cell Phone'],
    ['person_in_charge_name', 'text', 'Person in Charge'],
    ['project_rep_cell_phone', 'text', 'Project Representative Cell Phone'],
    ['project_rep_name', 'text', 'Project Representative'],
    ['project_rep_signature', 'sig', 'Project Representative Signature'],
    ['requestor_cell_phone', 'text', 'Requestor Cell Phone'],
    ['requestor_name', 'text', 'Requestor'],
    ['requestor_signature', 'sig', 'Requestor Signature'],
    ['category_of_work', 'choice', 'Category of Work (A, B, C, F, P, BL, Y)'],
    ['work_description', 'text', 'Work Description'],
    ['row1_area', 'text', 'Row 1 Area (Tracks, Mileposts, Gates, Stations)'],
    ['row1_date', 'text', 'Row 1 Date'],
    ['row1_day', 'choice', 'Row 1 Day'],
    ['row1_power_na', 'check', 'Row 1 Power Status: N/A'],
    ['row1_power_off', 'check', 'Row 1 Power Status: OFF'],
    ['row1_power_on', 'check', 'Row 1 Power Status: ON'],
    ['row1_safe_clear_rail_sections', 'text', 'Row 1 Safe Clear Rail Section(s)'],
    ['row1_time_end', 'text', 'Row 1 End Time'],
    ['row1_time_start', 'text', 'Row 1 Start Time'],
    ['row2_area', 'text', 'Row 2 Area (Tracks, Mileposts, Gates, Stations)'],
    ['row2_date', 'text', 'Row 2 Date'],
    ['row2_day', 'choice', 'Row 2 Day'],
    ['row2_power_na', 'check', 'Row 2 Power Status: N/A'],
    ['row2_power_off', 'check', 'Row 2 Power Status: OFF'],
    ['row2_power_on', 'check', 'Row 2 Power Status: ON'],
    ['row2_safe_clear_rail_sections', 'text', 'Row 2 Safe Clear Rail Section(s)'],
    ['row2_time_end', 'text', 'Row 2 End Time'],
    ['row2_time_start', 'text', 'Row 2 Start Time'],
    ['row3_area', 'text', 'Row 3 Area (Tracks, Mileposts, Gates, Stations)'],
    ['row3_date', 'text', 'Row 3 Date'],
    ['row3_day', 'choice', 'Row 3 Day'],
    ['row3_power_na', 'check', 'Row 3 Power Status: N/A'],
    ['row3_power_off', 'check', 'Row 3 Power Status: OFF'],
    ['row3_power_on', 'check', 'Row 3 Power Status: ON'],
    ['row3_safe_clear_rail_sections', 'text', 'Row 3 Safe Clear Rail Section(s)'],
    ['row3_time_end', 'text', 'Row 3 End Time'],
    ['row3_time_start', 'text', 'Row 3 Start Time'],
    ['row4_area', 'text', 'Row 4 Area (Tracks, Mileposts, Gates, Stations)'],
    ['row4_date', 'text', 'Row 4 Date'],
    ['row4_day', 'choice', 'Row 4 Day'],
    ['row4_power_na', 'check', 'Row 4 Power Status: N/A'],
    ['row4_power_off', 'check', 'Row 4 Power Status: OFF'],
    ['row4_power_on', 'check', 'Row 4 Power Status: ON'],
    ['row4_safe_clear_rail_sections', 'text', 'Row 4 Safe Clear Rail Section(s)'],
    ['row4_time_end', 'text', 'Row 4 End Time'],
    ['row4_time_start', 'text', 'Row 4 Start Time'],
    ['row5_area', 'text', 'Row 5 Area (Tracks, Mileposts, Gates, Stations)'],
    ['row5_date', 'text', 'Row 5 Date'],
    ['row5_day', 'choice', 'Row 5 Day'],
    ['row5_power_na', 'check', 'Row 5 Power Status: N/A'],
    ['row5_power_off', 'check', 'Row 5 Power Status: OFF'],
    ['row5_power_on', 'check', 'Row 5 Power Status: ON'],
    ['row5_safe_clear_rail_sections', 'text', 'Row 5 Safe Clear Rail Section(s)'],
    ['row5_time_end', 'text', 'Row 5 End Time'],
    ['row5_time_start', 'text', 'Row 5 Start Time'],
    ['row6_area', 'text', 'Row 6 Area (Tracks, Mileposts, Gates, Stations)'],
    ['row6_date', 'text', 'Row 6 Date'],
    ['row6_day', 'choice', 'Row 6 Day'],
    ['row6_power_na', 'check', 'Row 6 Power Status: N/A'],
    ['row6_power_off', 'check', 'Row 6 Power Status: OFF'],
    ['row6_power_on', 'check', 'Row 6 Power Status: ON'],
    ['row6_safe_clear_rail_sections', 'text', 'Row 6 Safe Clear Rail Section(s)'],
    ['row6_time_end', 'text', 'Row 6 End Time'],
    ['row6_time_start', 'text', 'Row 6 Start Time'],
    ['row7_area', 'text', 'Row 7 Area (Tracks, Mileposts, Gates, Stations)'],
    ['row7_date', 'text', 'Row 7 Date'],
    ['row7_day', 'choice', 'Row 7 Day'],
    ['row7_power_na', 'check', 'Row 7 Power Status: N/A'],
    ['row7_power_off', 'check', 'Row 7 Power Status: OFF'],
    ['row7_power_on', 'check', 'Row 7 Power Status: ON'],
    ['row7_safe_clear_rail_sections', 'text', 'Row 7 Safe Clear Rail Section(s)'],
    ['row7_time_end', 'text', 'Row 7 End Time'],
    ['row7_time_start', 'text', 'Row 7 Start Time'],
    ['maint_operating_bulletin_details', 'text', 'Operating Bulletin # (details)'],
    ['maint_operating_bulletin_req', 'check', 'Operating Bulletin # (checkbox)'],
    ['maint_physical_barrier_details', 'text', 'Physical Barrier Req. (Please Attach) (details)'],
    ['maint_physical_barrier_req', 'check', 'Physical Barrier Req. (Please Attach) (checkbox)'],
    ['maint_power_tech_support_details', 'text', 'Technical Support (Power & Mechanical) (details)'],
    ['maint_power_tech_support_req', 'check', 'Technical Support (Power & Mechanical) (checkbox)'],
    ['maint_rail_bond_cbond_details', 'text', 'Rail Bond/C-Bond (details)'],
    ['maint_rail_bond_cbond_req', 'check', 'Rail Bond/C-Bond (checkbox)'],
    ['maint_route_prohibit_details', 'text', 'Route Prohibit (details)'],
    ['maint_route_prohibit_req', 'check', 'Route Prohibit (checkbox)'],
    ['maint_safe_clearance_details', 'text', 'Safe Clearance (details)'],
    ['maint_safe_clearance_req', 'check', 'Safe Clearance (checkbox)'],
    ['maint_safety_dept_details', 'text', 'Safety Dept. (details)'],
    ['maint_safety_dept_req', 'check', 'Safety Dept. (checkbox)'],
    ['maint_safety_monitor_details', 'text', 'Safety Monitor (details)'],
    ['maint_safety_monitor_req', 'check', 'Safety Monitor (checkbox)'],
    ['maint_speed_restriction_details', 'text', 'Speed Restriction (details)'],
    ['maint_speed_restriction_req', 'check', 'Speed Restriction (checkbox)'],
    ['maint_systems_tech_support_details', 'text', 'Technical Support (Systems) (details)'],
    ['maint_systems_tech_support_req', 'check', 'Technical Support (Systems) (checkbox)'],
    ['maint_vehicle_equipment_details', 'text', 'Vehicle Equipment (details)'],
    ['maint_vehicle_equipment_req', 'check', 'Vehicle Equipment (checkbox)'],
    ['maint_vehicle_tech_support_details', 'text', 'Technical Support (Vehicle) (details)'],
    ['maint_vehicle_tech_support_req', 'check', 'Technical Support (Vehicle) (checkbox)'],
    ['trans_adverse_impact_blanket_details', 'text', 'Adverse Impact to Blanket (details)'],
    ['trans_adverse_impact_blanket_req', 'check', 'Adverse Impact to Blanket (checkbox)'],
    ['trans_occ_support_details', 'text', 'OCC Support (details)'],
    ['trans_occ_support_req', 'check', 'OCC Support (checkbox)'],
    ['trans_passenger_bulletin_req', 'check', 'Passenger Bulletin (checkbox)'],
    ['trans_public_notice', 'text', 'Public Notice'],
    ['trans_single_tracking_details', 'text', 'Single Tracking (details)'],
    ['trans_single_tracking_req', 'check', 'Single Tracking (checkbox)'],
    ['trans_sswp_iop_required_req', 'check', 'SSWP/IOP Required (Please Attach) (checkbox)'],
    ['trans_train_operators_details', 'text', 'Train Operator(s) (details)'],
    ['trans_train_operators_req', 'check', 'Train Operator(s) (checkbox)'],
    ['trans_train_required_details', 'text', 'Train Required (details)'],
    ['trans_train_required_req', 'check', 'Train Required (checkbox)'],
    ['trans_yard_line_support_details', 'text', 'Yard/Line Support (details)'],
    ['trans_yard_line_support_req', 'check', 'Yard/Line Support (checkbox)'],
    ['appr_ops_planning_date', 'text', 'Operations Planning Date'],
    ['appr_ops_planning_signature', 'text', 'Operations Planning Signature'],
    ['appr_power_mech_date', 'text', 'Power & Mechanical Support Date'],
    ['appr_power_mech_signature', 'text', 'Power & Mechanical Support Signature'],
    ['appr_safety_dept_date', 'text', 'Safety Department Date'],
    ['appr_safety_dept_signature', 'text', 'Safety Department Signature'],
    ['appr_safety_monitor_supv_date', 'text', 'Safety Monitor Supervisor Date'],
    ['appr_safety_monitor_supv_signature', 'text', 'Safety Monitor Supervisor Signature'],
    ['appr_systems_maint_date', 'text', 'Systems Maintenance Support Date'],
    ['appr_systems_maint_signature', 'text', 'Systems Maintenance Support Signature'],
    ['appr_ta_committee_chair_date', 'text', 'TA Committee Chairperson Date'],
    ['appr_ta_committee_chair_signature', 'text', 'TA Committee Chairperson Signature'],
    ['appr_transportation_occ_date', 'text', 'Transportation OCC Date'],
    ['appr_transportation_occ_signature', 'text', 'Transportation OCC Signature'],
    ['appr_way_facilities_date', 'text', 'Way & Facilities Support Date'],
    ['appr_way_facilities_signature', 'text', 'Way & Facilities Support Signature'],
    ['appr_yard_admin_line_mgr_date', 'text', 'Yard Administrator / Line Mgr. Date'],
    ['appr_yard_admin_line_mgr_signature', 'text', 'Yard Administrator / Line Mgr. Signature'],
  ];

  const FIELD_KIND = new Map(TAWR_FIELDS.map(([name, kind]) => [name, kind]));
  const FIELD_LABEL = new Map(TAWR_FIELDS.map(([name, , label]) => [name, label]));

  /** The rows the form has for dates. */
  const FORM_ROWS = 7;

  /** The shifts a request is split by, in the order they are listed. */
  const TAWR_SHIFTS = [
    { id: 'day', label: 'Day' },
    { id: 'swing', label: 'Swing' },
    { id: 'night', label: 'Night' },
    { id: 'possession', label: 'Blanket' },
    { id: 'unmapped', label: 'Unmapped colour' },
  ];

  function tawrShiftLabel(id) {
    return TAWR_SHIFTS.find((s) => s.id === id)?.label || id || '';
  }

  /**
   * The hours a shift works when the sheet does not say. By the shift, not the
   * colour: a colour is re-mapped in Legend, and the hours must not move with it.
   */
  const DEFAULT_SHIFT_HOURS = {
    day: '0700-1500',
    swing: '1500-2300',
    night: '2200-0600',
    possession: '0000-0800',
  };

  /**
   * Which shift a legend meaning names. Null for a colour the legend does not
   * know — that is a fact to report, not a day shift to assume.
   */
  function shiftOfMeaning(meaning) {
    if (meaning == null || meaning === '') return null;
    const said = String(meaning).toLowerCase();
    if (/night/.test(said)) return 'night';
    if (/blanket|possession/.test(said)) return 'possession';
    if (/swing/.test(said)) return 'swing';
    return 'day';
  }

  /* ── Hours ─────────────────────────────────────────────────────────────── */

  /**
   * "0700-1500", "07:00 – 15:30", "7:00-15:00", "2200-0600" → minutes from
   * midnight, `{ start, end }`; null for anything else. An end before the start
   * is the next morning, which is what a night shift writes.
   */
  function parseHours(text) {
    const m = String(text ?? '').trim().match(/^(\d{1,2}):?(\d{2})\s*(?:-|–|—|to)\s*(\d{1,2}):?(\d{2})$/i);
    if (!m) return null;
    const [h1, m1, h2, m2] = m.slice(1).map(Number);
    if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59) return null;
    return { start: (h1 % 24) * 60 + m1, end: (h2 % 24) * 60 + m2 };
  }

  /** Minutes from midnight as the form writes a time: 420 → "0700". */
  function hhmm(minutes) {
    const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;
  }

  /**
   * The earliest start and latest finish of several ranges on one day.
   *
   * Each range is laid on a line that runs past midnight, so 2200–0600 ends at
   * 30:00 and outlasts 2300–0500. On a night shift a start in the small hours is
   * that same night continuing, not the morning before it.
   */
  function combineHours(ranges, shift) {
    let start = Infinity;
    let end = -Infinity;
    for (const r of ranges || []) {
      if (!r) continue;
      let s = r.start;
      let e = r.end <= r.start ? r.end + 1440 : r.end;
      if (shift === 'night' && s < 720) { s += 1440; e += 1440; }
      if (s < start) start = s;
      if (e > end) end = e;
    }
    if (!Number.isFinite(start)) return null;
    return { start: start % 1440, end: end % 1440 };
  }

  /* ── Dates ─────────────────────────────────────────────────────────────── */

  const DAY_MS = 86400000;
  const msOf = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

  function addDaysISO(iso, n) {
    return isoOf(msOf(iso) + n * DAY_MS);
  }

  function mondayOf(iso) {
    const ms = msOf(iso);
    return isoOf(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS);
  }

  /** The Mondays of every week the reading covers, in order. */
  function weeksIn(view) {
    const out = new Set();
    for (const d of view?.days || []) if (d.date) out.add(mondayOf(d.date));
    return [...out].sort();
  }

  /** The form's own spelling of a weekday, as its Day dropdown offers them. */
  const FORM_DAYS = ['SUN', 'MON', 'TUES', 'WED', 'THURS', 'FRI', 'SAT'];

  function formDay(iso) {
    return FORM_DAYS[new Date(msOf(iso)).getUTCDay()];
  }

  /** "2026-10-19" → "10/19/2026" — the mm/dd/yyyy BART's date boxes check for. */
  function formDate(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${m}/${d}/${y}`;
  }

  /** The last day the request can go in: seventeen calendar days before its first day. */
  function tawrDeadline(firstISO) {
    return addDaysISO(firstISO, -TAWR_LEAD_DAYS);
  }

  /**
   * How the deadline stands today: `{ deadline, daysLeft, tone, label }`. Tone
   * is `bad` once it has passed, `warn` inside three days, `ok` otherwise.
   */
  function deadlineState(firstISO, todayISO) {
    const deadline = tawrDeadline(firstISO);
    const daysLeft = Math.round((msOf(deadline) - msOf(todayISO)) / DAY_MS);
    const tone = daysLeft < 0 ? 'bad' : daysLeft <= 3 ? 'warn' : 'ok';
    const label = daysLeft < 0
      ? `Overdue by ${-daysLeft} day${daysLeft === -1 ? '' : 's'}`
      : daysLeft === 0 ? 'Due today' : `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    return { deadline, daysLeft, tone, label };
  }

  /* ── Reading a week ────────────────────────────────────────────────────── */

  /** Case and punctuation only — the fold every register in the calendar uses. */
  function fold(text) {
    return String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** Which of the activity columns says what: found off the sheet's own headings. */
  function columnsOf(view) {
    const headings = view?.headings || [];
    const find = (re) => headings.findIndex((h) => re.test(String(h || '')));
    const location = locationColumnOf(view);
    let description = find(/description/i);
    if (description < 0) description = headings.findIndex((_, i) => i !== location && i !== find(/activity\s*id/i));
    return {
      activityId: find(/activity\s*id/i),
      description,
      location,
      sswp: find(/sswp/i),
      hours: find(/work\s*hours?/i) >= 0 ? find(/work\s*hours?/i) : find(/hours?/i),
    };
  }

  /** The lines of the form a support code can go on, as the register offers them. */
  const TAWR_LINES = [
    { value: 'systems', label: 'Technical Support (Systems)' },
    { value: 'occ', label: 'OCC Support' },
    { value: 'none', label: 'Not on the form' },
  ];

  /** Which form line a support code goes on: `systems`, `occ` or `none`. */
  function lineOfCode(code, register) {
    const entry = register?.get(String(code).toUpperCase());
    if (entry?.tawr_line) return entry.tawr_line;
    if (String(code).toUpperCase() === 'WIT') return 'none';
    if (String(code).toUpperCase() === 'ROC') return 'occ';
    return 'systems';
  }

  function codeRegister(codes) {
    const map = new Map();
    for (const c of codes || []) if (c?.code) map.set(String(c.code).toUpperCase(), c);
    return map;
  }

  /**
   * Every request a week of the look-ahead calls for.
   *
   *   view           the parsed reading — `parsedView()` of the newest snapshot
   *   weekStart      the Monday, as an ISO date
   *   resolveLocation(raw) → `{ id, name, tawr_area }` or null, off the register
   *   codes          the support code register
   *   descriptions   `[{ activity, description }]` — the expanded wording
   *   shiftHours     `{ day, swing, night, possession }` — "0700-1500"
   *
   * Answers `{ groups, columns }`. Each group is one request: its key (location
   * and shift), the location, the activities with their days, one entry per day
   * worked with its combined hours, the support asked for, the SSWP numbers, the
   * work description, and its flags.
   *
   * @param {object} view
   * @param {string} weekStart
   * @param {{ resolveLocation?: (raw: string) => any, codes?: any[], descriptions?: any[], shiftHours?: object }} [options]
   */
  function extractWeek(view, weekStart, {
    resolveLocation = () => null, codes = [], descriptions = [], shiftHours = DEFAULT_SHIFT_HOURS,
  } = {}) {
    const columns = columnsOf(view);
    const register = codeRegister(codes);
    const expanded = new Map((descriptions || []).map((d) => [fold(d.activity), String(d.description || '').trim()]));
    const weekEnd = addDaysISO(weekStart, 6);
    const dayByCol = new Map();
    for (const d of view?.days || []) {
      if (d.date && d.date >= weekStart && d.date <= weekEnd) dayByCol.set(d.col, d.date);
    }
    const cell = (activity, i) => (i >= 0 ? String(activity.meta?.[i] || '').trim() : '');

    const groups = new Map();
    for (const activity of view?.activities || []) {
      if (activity.heading || activity.absence || !activity.named) continue;
      const title = cell(activity, columns.description) || cell(activity, columns.activityId);
      const rawLocation = cell(activity, columns.location);
      const hoursText = cell(activity, columns.hours);
      const sswp = cell(activity, columns.sswp);

      /* Day by day: the paint says the shift, the text on the activity line says
         the support. The workbook sometimes paints the Resource row instead of
         the activity, so either one's paint counts; its text never does — those
         are names, not codes. */
      const paintAt = new Map();
      for (const mark of [...(activity.resource?.marks || []), ...activity.marks]) {
        if (!dayByCol.has(mark.col) || !mark.hex || mark.role !== 'shift') continue;
        paintAt.set(mark.col, mark); // the activity line's own paint wins, being last
      }
      const textAt = new Map(activity.marks.filter((m) => m.value).map((m) => [m.col, m.value]));

      for (const [col, mark] of paintAt) {
        if (isCancelMeaning(mark.meaning)) continue; // a cancelled day asks for nothing
        const date = dayByCol.get(col);
        const shift = shiftOfMeaning(mark.meaning) || 'unmapped';
        const location = rawLocation ? resolveLocation(rawLocation) : null;
        const locKey = location?.id ? `loc:${location.id}` : `raw:${fold(rawLocation)}`;
        const key = `${locKey}|${shift}`;
        if (!groups.has(key)) {
          groups.set(key, {
            key, weekStart, shift, location: location || null, rawLocation,
            activities: new Map(), days: new Map(), unmappedColours: new Set(),
          });
        }
        const group = groups.get(key);
        if (shift === 'unmapped') group.unmappedColours.add(mark.hex);
        if (!group.activities.has(activity.row)) {
          group.activities.set(activity.row, {
            row: activity.row, title, activityId: cell(activity, columns.activityId),
            sswp, hoursText, days: [],
          });
        }
        group.activities.get(activity.row).days.push(date);
        if (!group.days.has(date)) group.days.set(date, []);
        const counts = new Map();
        for (const t of cellTokens(textAt.get(col) || '')) {
          if (!t.cancelled) counts.set(t.code, (counts.get(t.code) || 0) + 1);
        }
        group.days.get(date).push({ row: activity.row, hoursText, counts });
      }
    }

    const out = [...groups.values()].map((g) => finish(g, { register, expanded, shiftHours }));
    const SHIFT_ORDER = TAWR_SHIFTS.map((s) => s.id);
    out.sort((a, b) => a.locationName.localeCompare(b.locationName)
      || SHIFT_ORDER.indexOf(a.shift) - SHIFT_ORDER.indexOf(b.shift));
    return { groups: out, columns };
  }

  function finish(g, { register, expanded, shiftHours }) {
    const flags = [];
    const activities = [...g.activities.values()].sort((a, b) => a.row - b.row);
    for (const a of activities) a.days = [...new Set(a.days)].sort();

    if (!g.rawLocation) {
      flags.push({ kind: 'no_location', blocking: true,
        message: 'An activity here has no location on the look-ahead. Add one to the sheet.' });
    } else if (!g.location) {
      flags.push({ kind: 'location_unmatched', blocking: true,
        message: `"${g.rawLocation}" is not in the location list. Add it (or an alias) in Organisation → Locations, or correct it on the look-ahead.` });
    }
    if (g.shift === 'unmapped') {
      flags.push({ kind: 'colour_unmapped', blocking: true,
        message: `Painted in a colour the legend does not know (${[...g.unmappedColours].map((h) => `#${h}`).join(', ')}). Say what it is in Legend.` });
    }

    /* Hours, a day at a time. */
    const unreadable = new Set();
    const fallback = parseHours(shiftHours?.[g.shift] || DEFAULT_SHIFT_HOURS[g.shift] || '');
    const days = [...g.days.keys()].sort().map((date) => {
      const entries = g.days.get(date);
      let fromShift = false;
      const ranges = entries.map((e) => {
        const read = parseHours(e.hoursText);
        if (read) return read;
        if (e.hoursText) unreadable.add(e.hoursText);
        fromShift = true;
        return fallback;
      });
      const hours = combineHours(ranges, g.shift);
      return {
        date,
        start: hours ? hhmm(hours.start) : '',
        end: hours ? hhmm(hours.end) : '',
        fromShift,
        rows: entries.map((e) => e.row),
      };
    });
    for (const text of unreadable) {
      flags.push({ kind: 'hours_unreadable', blocking: false,
        message: `Could not read the work hours "${text}"; the shift's hours were used instead.` });
    }
    if (days.some((d) => !d.start)) {
      flags.push({ kind: 'hours_missing', blocking: false,
        message: 'No hours for some days — the shift has no default hours. Fill them in.' });
    }

    /* Support: per day, the activities added together; the busiest day is asked for. */
    const peak = new Map();
    for (const entries of g.days.values()) {
      const day = new Map();
      for (const e of entries) for (const [code, n] of e.counts) day.set(code, (day.get(code) || 0) + n);
      for (const [code, n] of day) peak.set(code, Math.max(peak.get(code) || 0, n));
    }
    const support = [];
    const unknownCodes = [];
    for (const [code, count] of peak) {
      const line = lineOfCode(code, register);
      if (!register.has(code)) unknownCodes.push(code);
      if (line === 'none') continue;
      const entry = register.get(code);
      support.push({ code, count, line, label: String(entry?.name || '').trim() || code });
    }
    support.sort((a, b) => (register.get(a.code)?.sort ?? 999) - (register.get(b.code)?.sort ?? 999) || a.code.localeCompare(b.code));
    if (unknownCodes.length) {
      flags.push({ kind: 'code_unknown', blocking: false,
        message: `Support code${unknownCodes.length === 1 ? '' : 's'} not in the register: ${unknownCodes.join(', ')} — listed under Technical Support. Add ${unknownCodes.length === 1 ? 'it' : 'them'} in Legend → Support codes.` });
    }

    const sswp = [...new Set(activities.map((a) => a.sswp).filter(Boolean))];

    /* The description of work: each activity once, with the wording mapped to it. */
    const seen = new Set();
    const lines = [];
    const unexpanded = [];
    for (const a of activities) {
      const k = fold(a.title);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const more = expanded.get(k);
      if (more) lines.push(`${a.title} — ${more}`);
      else { lines.push(a.title); unexpanded.push(a.title); }
    }

    const locationName = g.location?.name || g.rawLocation || '(no location)';
    return {
      key: g.key,
      weekStart: g.weekStart,
      shift: g.shift,
      locationId: g.location?.id || null,
      locationName,
      rawLocation: g.rawLocation,
      area: String(g.location?.tawr_area || '').trim() || locationName,
      activities,
      days,
      firstDay: days[0]?.date || g.weekStart,
      support,
      sswp,
      description: lines.join('\n'),
      unexpanded,
      flags,
    };
  }

  /* ── The form ──────────────────────────────────────────────────────────── */

  const supportText = (items) => items.map((s) => (s.count > 1 ? `${s.count} x ${s.label}` : s.label)).join(', ');

  /**
   * The value of every field the request fills, `{ field: string | boolean }`.
   *
   * `settings` carries the contacts that are the same on every request (person
   * in charge, project representative); `profile` is the administrator raising
   * it — their name and cell phone go in as the requestor, and their signature is
   * drawn at export, not stored as a field. What the look-ahead cannot say is set
   * to the answer agreed for it: the three Yes/No questions No, Category of Work
   * F, power N/A. Everything left out stays blank for a person to fill.
   *
   * @param {object} group
   * @param {{ settings?: Object<string, any>, profile?: Object<string, any> }} [options]
   */
  function formValues(group, { settings = {}, profile = {} } = {}) {
    const v = {
      work_in_track_zone_no: true,
      clearance_verification_no: true,
      track_inspection_first_train_no: true,
      category_of_work: String(settings.category_default || 'F'),
      work_description: group.description,
      requestor_name: String(profile.requestor_name || ''),
      requestor_cell_phone: String(profile.cell_phone || ''),
      person_in_charge_name: String(settings.person_in_charge_name || ''),
      person_in_charge_cell_phone: String(settings.person_in_charge_cell_phone || ''),
      project_rep_name: String(settings.project_rep_name || ''),
      project_rep_cell_phone: String(settings.project_rep_cell_phone || ''),
    };
    group.days.slice(0, FORM_ROWS).forEach((d, i) => {
      const n = i + 1;
      v[`row${n}_date`] = formDate(d.date);
      v[`row${n}_day`] = formDay(d.date);
      v[`row${n}_time_start`] = d.start;
      v[`row${n}_time_end`] = d.end;
      v[`row${n}_area`] = group.area;
      v[`row${n}_power_na`] = true;
    });
    const systems = group.support.filter((s) => s.line === 'systems');
    const occ = group.support.filter((s) => s.line === 'occ');
    if (systems.length) {
      v.maint_systems_tech_support_req = true;
      v.maint_systems_tech_support_details = supportText(systems);
    }
    if (occ.length) {
      v.trans_occ_support_req = true;
      v.trans_occ_support_details = supportText(occ);
    }
    if (group.sswp.length) {
      v.trans_sswp_iop_required_req = true;
      // The SSWP box has no line of its own; the one beside it is the bottom line.
      v.trans_adverse_impact_blanket_details = `SSWP# ${group.sswp.map((s) => s.replace(/^sswp\s*#?\s*/i, '')).join(', ')}`;
    }
    return v;
  }

  /** The fields the look-ahead decides — what "changed since approval" compares. */
  function fromLookahead(name) {
    return /^row\d_/.test(name)
      || ['work_description', 'maint_systems_tech_support_req', 'maint_systems_tech_support_details',
        'trans_occ_support_req', 'trans_occ_support_details', 'trans_sswp_iop_required_req',
        'trans_adverse_impact_blanket_details'].includes(name);
  }

  const same = (a, b) => (a ?? '') === (b ?? '') || (a === false && b == null) || (a == null && b === false);

  /** The fields somebody changed by hand: where the value is not what was generated. */
  function editedKeys(fields, generated) {
    const keys = new Set([...Object.keys(fields || {}), ...Object.keys(generated || {})]);
    return [...keys].filter((k) => !same(fields?.[k], generated?.[k])).sort();
  }

  /**
   * A draft brought up to date with a fresh reading: every field nobody edited
   * takes the new value, every edit is kept, and an edit whose generated value
   * moved underneath it is named in `conflicts` so the review can say so.
   */
  function mergeRegenerated({ fields = {}, generated = {} }, fresh) {
    const edited = new Set(editedKeys(fields, generated));
    const next = {};
    const conflicts = [];
    for (const k of new Set([...Object.keys(fresh), ...Object.keys(fields)])) {
      if (edited.has(k)) {
        next[k] = fields[k];
        if (!same(generated[k], fresh[k])) conflicts.push(k);
      } else if (fresh[k] !== undefined && fresh[k] !== '' && fresh[k] !== false) next[k] = fresh[k];
    }
    return { fields: next, generated: fresh, conflicts: conflicts.sort() };
  }

  /** What the look-ahead now says differently from what was approved. */
  function changedSince(generated, fresh) {
    const keys = new Set([...Object.keys(generated || {}), ...Object.keys(fresh || {})]);
    return [...keys].filter((k) => fromLookahead(k) && !same(generated?.[k], fresh?.[k])).sort();
  }

  /** Whether a request may be approved: no blocking flag. */
  function blockers(group) {
    return (group?.flags || []).filter((f) => f.blocking);
  }

  /** "TAWR 2026-10-19 Train Control Room Day.pdf" — safe on every file system. */
  function tawrFileName({ weekStart, locationName, shift }) {
    const name = `TAWR ${weekStart} ${locationName} ${tawrShiftLabel(shift)}`;
    return `${name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()}.pdf`;
  }

  Object.defineProperty(__x, "TAWR_LEAD_DAYS", { get: () => TAWR_LEAD_DAYS, enumerable: true });
  Object.defineProperty(__x, "TAWR_FIELDS", { get: () => TAWR_FIELDS, enumerable: true });
  Object.defineProperty(__x, "FIELD_KIND", { get: () => FIELD_KIND, enumerable: true });
  Object.defineProperty(__x, "FIELD_LABEL", { get: () => FIELD_LABEL, enumerable: true });
  Object.defineProperty(__x, "FORM_ROWS", { get: () => FORM_ROWS, enumerable: true });
  Object.defineProperty(__x, "TAWR_SHIFTS", { get: () => TAWR_SHIFTS, enumerable: true });
  Object.defineProperty(__x, "tawrShiftLabel", { get: () => tawrShiftLabel, enumerable: true });
  Object.defineProperty(__x, "DEFAULT_SHIFT_HOURS", { get: () => DEFAULT_SHIFT_HOURS, enumerable: true });
  Object.defineProperty(__x, "shiftOfMeaning", { get: () => shiftOfMeaning, enumerable: true });
  Object.defineProperty(__x, "parseHours", { get: () => parseHours, enumerable: true });
  Object.defineProperty(__x, "hhmm", { get: () => hhmm, enumerable: true });
  Object.defineProperty(__x, "combineHours", { get: () => combineHours, enumerable: true });
  Object.defineProperty(__x, "addDaysISO", { get: () => addDaysISO, enumerable: true });
  Object.defineProperty(__x, "mondayOf", { get: () => mondayOf, enumerable: true });
  Object.defineProperty(__x, "weeksIn", { get: () => weeksIn, enumerable: true });
  Object.defineProperty(__x, "formDay", { get: () => formDay, enumerable: true });
  Object.defineProperty(__x, "formDate", { get: () => formDate, enumerable: true });
  Object.defineProperty(__x, "tawrDeadline", { get: () => tawrDeadline, enumerable: true });
  Object.defineProperty(__x, "deadlineState", { get: () => deadlineState, enumerable: true });
  Object.defineProperty(__x, "fold", { get: () => fold, enumerable: true });
  Object.defineProperty(__x, "columnsOf", { get: () => columnsOf, enumerable: true });
  Object.defineProperty(__x, "TAWR_LINES", { get: () => TAWR_LINES, enumerable: true });
  Object.defineProperty(__x, "lineOfCode", { get: () => lineOfCode, enumerable: true });
  Object.defineProperty(__x, "extractWeek", { get: () => extractWeek, enumerable: true });
  Object.defineProperty(__x, "formValues", { get: () => formValues, enumerable: true });
  Object.defineProperty(__x, "fromLookahead", { get: () => fromLookahead, enumerable: true });
  Object.defineProperty(__x, "editedKeys", { get: () => editedKeys, enumerable: true });
  Object.defineProperty(__x, "mergeRegenerated", { get: () => mergeRegenerated, enumerable: true });
  Object.defineProperty(__x, "changedSince", { get: () => changedSince, enumerable: true });
  Object.defineProperty(__x, "blockers", { get: () => blockers, enumerable: true });
  Object.defineProperty(__x, "tawrFileName", { get: () => tawrFileName, enumerable: true });
};

// ui/rc_la_legend.js
__mods["ui/rc_la_legend.js"] = function (__x, __req) {
  /**
   * Look-ahead → Legend: the register of what each colour means and does.
   *
   * Imports: util, rc, io/lookahead, core/lookahead, core/tawr, icons, components, rc_util,
   *          rc_la_state, rc_ingest.
   */

  const { el } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { selectInput, textInput, toast, badge, field, confirmDialog } = __req("ui/components.js");
  const { notifyChanged, formModal, parsedView } = __req("ui/rc_util.js");
  const { lineOfCode, TAWR_LINES } = __req("core/tawr.js");

  const { table } = __req("ui/rc_la_state.js");

  /* ══════════════════════════════════════════════════════════════════════════
     The legend
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * What the colours mean, and which sheet to read.
   *
   * The register is the authority, not the workbook: the file's own key is
   * adopted once into an empty register and never again, so a colour somebody
   * has mapped by hand cannot be silently reinterpreted by an edit to the
   * spreadsheet. Where the two disagree, both are shown and the person decides.
   */
  async function renderLegend(host) {
    const [legend, snapshot, settings] = await Promise.all([
      rc.listLegend({ includeInactive: true }),
      rc.latestSnapshot(),
      rc.listSettings().catch(() => []),
    ]);
    const sheet = settings.find((r) => r.key === 'lookahead_sheet')?.value || '4WLA';

    /* ── Which sheet ─────────────────────────────────────────────────────── */
    host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Which sheet' })]));
    const sheetField = textInput({ value: sheet, placeholder: '4WLA' });
    host.appendChild(el('div', { style: 'display:flex;gap:8px;max-width:420px' }, [
      sheetField,
      el('button', {
        class: 'cx-btn mini',
        text: 'Save',
        onClick: async () => {
          try {
            await rc.setSetting('lookahead_sheet', sheetField.value.trim());
            toast({ tone: 'good', message: `The look-ahead will be read from "${sheetField.value.trim()}".` });
          } catch (err) {
            toast({ tone: 'bad', message: err.message });
          }
        },
      }),
    ]));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'The tab the grid is on. It is never guessed: if no sheet by this name is visible, the '
        + 'read stops and says so, because falling back to the first sheet would report a cover '
        + 'page as a week of no work.',
    }));

    /* ── Support codes ───────────────────────────────────────────────────── */
    host.appendChild(el('div', { style: 'height:24px' }));
    await supportCodes(host);

    /* ── The register ────────────────────────────────────────────────────── */
    host.appendChild(el('div', { style: 'height:24px' }));
    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'What the colours mean' }),
      el('button', {
        class: 'cx-btn mini primary',
        html: icon('plus', { size: 12 }) + '<span>Add colour</span>',
        onClick: () => editLegend(null),
      }),
    ]));

    if (!legend.length) {
      host.appendChild(el('p', {
        class: 'rc-hint',
        text: 'Nothing mapped yet. The first read adopts the key the workbook writes down about '
          + 'itself, if it has one — a block of rows painted one colour each with a label beside '
          + 'them. After that the register is the authority and the file cannot overrule it.',
      }));
    } else {
      host.appendChild(table(
        ['', 'Colour', 'Means', 'Counts as', 'In force from', ''],
        legend.map((entry) => el('tr', { class: entry.active ? '' : 'rc-inactive' }, [
          el('td', {}, [el('span', { class: 'la-swatch', style: `background:#${entry.argb}` })]),
          el('td', { class: 'rc-num', text: `#${entry.argb}` }),
          el('td', { text: entry.meaning }),
          el('td', {}, [roleBadge(entry.role || 'shift')]),
          el('td', { text: entry.valid_from || '—' }),
          el('td', {}, [
            el('button', { class: 'cx-btn mini ghost', text: 'Edit', onClick: () => editLegend(entry) }),
            el('button', {
              class: 'cx-btn mini ghost',
              text: entry.active ? 'Retire' : 'Restore',
              title: 'Retiring keeps it against every snapshot already read with it.',
              onClick: async () => {
                await rc.updateLegend(entry.id, { active: !entry.active });
                notifyChanged('legend');
              },
            }),
            /* Delete, beside Retire, because the two differ on one thing and it
               matters here more than anywhere. A retired row still *shadows* an
               older row for the same colour — `inForce()` picks the newest before
               the active filter is applied on some paths — so retiring a mistake
               leaves the mistake deciding what the colour means. Deleting it puts
               the colour back where a wrong answer belongs: in the "not in the
               legend" list, one click from being answered again. */
            el('button', {
              class: 'cx-btn mini ghost danger',
              text: 'Delete',
              title: 'Removes the mapping outright. The colour goes back to unmapped, and every '
                + 'snapshot is re-read against the register at paint time, so nothing is lost.',
              onClick: async () => {
                const ok = await confirmDialog({
                  title: `Delete the mapping for #${entry.argb}?`,
                  message: `"${entry.meaning}" stops being what that colour means. It goes back into `
                    + '"Seen in the workbook, not in the legend", where it can be mapped again. '
                    + 'Retire it instead if you want the mapping kept on the record.',
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (!ok) return;
                try {
                  await rc.deleteLegend(entry.id);
                  toast({ tone: 'good', message: 'Deleted.' });
                  notifyChanged('legend');
                } catch (err) {
                  toast({ tone: 'bad', message: err?.message || String(err) });
                }
              },
            }),
          ]),
        ]))
      ));
    }

    /* ── What is not mapped ──────────────────────────────────────────────── */
    const unknown = snapshot?.grid
      ? parsedView(snapshot, legend.filter((l) => l.active)).unknown
      : [];

    host.appendChild(el('div', { style: 'height:24px' }));
    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'Seen in the workbook, not in the legend' }),
    ]));

    if (!unknown.length) {
      host.appendChild(el('p', {
        class: 'rc-hint',
        text: snapshot ? 'Every colour on the last snapshot is accounted for.' : 'Nothing read yet.',
      }));
    } else {
      host.appendChild(table(
        ['', 'Colour', 'Cells', 'For example', ''],
        unknown.map((u) => el('tr', {}, [
          el('td', {}, [el('span', { class: 'la-swatch', style: `background:#${u.hex}` })]),
          el('td', { class: 'rc-num', text: `#${u.hex}` }),
          el('td', { class: 'rc-num', text: String(u.count) }),
          el('td', { text: (u.samples || []).join(', ') }),
          el('td', {}, [
            /* One click, no dialog. The common case by a wide margin is a grey
               the spreadsheet shades its layout with, and making somebody name
               it before they can dismiss it is why forty rows of shading sat on
               screen counting as work. */
            el('button', {
              class: 'cx-btn mini',
              text: 'Just shading',
              title: 'Structure in the spreadsheet, not somebody on site. Rows whose only paint is '
                + 'this will drop out of the calendar.',
              onClick: async () => {
                try {
                  await rc.addLegend([{ argb: u.hex, meaning: 'Shading', role: 'ignore' }]);
                  notifyChanged('legend');
                  toast({ tone: 'good', message: `#${u.hex} is shading — rows painted only with it are out.` });
                } catch (err) {
                  toast({ tone: 'bad', message: err.message });
                }
              },
            }),
            el('button', {
              class: 'cx-btn mini primary',
              text: 'Say what it means',
              onClick: () => editLegend({ argb: u.hex }),
            }),
          ]),
        ]))
      ));
      host.appendChild(el('p', {
        class: 'rc-hint',
        text: 'Nothing here was guessed, and that is deliberate — guessing would classify a shift '
          + 'wrongly with nothing on screen to show it happened. Until somebody says, a colour '
          + 'counts as work and keeps its rows on the calendar, drawn with a hatch. Most of these '
          + 'are one of two things: a grey the spreadsheet shades its layout with, which is what '
          + '"Just shading" is for, or a near miss of a legend colour picked out of Excel’s recent '
          + 'colours, which wants naming properly.',
      }));
    }
  }

  /**
   * What a colour *does*, as opposed to what it is called.
   *
   * The distinction exists because this workbook greys most of its calendar for
   * structure: forty-odd rows are shaded right across the window with no work in
   * them at all. Reading that as a shift made every row look busy every day, and
   * no wording of the meaning would have fixed it — "not scheduled" is still a
   * meaning. So the register says what to *do* with the colour, separately.
   */
  const LEGEND_ROLES = [
    { value: 'shift', label: 'Work — somebody is on site that day' },
    { value: 'ignore', label: 'Shading — structure, not work' },
    { value: 'divider', label: 'Section band' },
  ];

  function roleBadge(role) {
    if (role === 'ignore') return badge('Shading', 'neutral');
    if (role === 'divider') return badge('Section', 'neutral');
    return badge('Work', 'info');
  }

  function editLegend(entry) {
    const argb = textInput({
      value: entry?.argb || '',
      placeholder: 'FFFF00',
    });
    const meaning = textInput({ value: entry?.meaning || '', placeholder: 'Day Shift' });
    const role = selectInput({ value: entry?.role || 'shift', options: LEGEND_ROLES });
    const swatch = el('span', { class: 'la-swatch', style: `background:#${entry?.argb || 'ffffff'}` });
    argb.addEventListener('input', () => {
      swatch.style.background = `#${argb.value.replace(/[^0-9a-f]/gi, '')}`;
    });

    formModal({
      title: entry?.id ? 'Edit what this colour means' : 'Map a colour',
      body: el('div', { class: 'cx-form' }, [
        field('Colour', el('div', { style: 'display:flex;align-items:center;gap:8px' }, [swatch, argb]),
          'The six hex digits, as the workbook painted it. Every notation Excel uses — a literal '
          + 'value, a theme colour with a tint, the legacy palette — is resolved to this one form '
          + 'before it is looked up, so the legend is keyed on the colour rather than on how it '
          + 'happened to be written.'),
        field('Means', meaning, 'In the words the look-ahead uses: Day Shift, Cancellation, Blanket.'),
        field('Counts as', role, 'Whether a day painted this colour is work. The look-ahead greys '
          + 'most of its calendar for structure rather than for shifts, and counting that as work '
          + 'would make every row look busy on every day.'),
      ]),
      confirmLabel: entry?.id ? 'Save' : 'Map it',
      onConfirm: async () => {
        const hex = argb.value.replace(/[^0-9a-f]/gi, '').toUpperCase();
        if (hex.length !== 6) throw new Error('Six hex digits, like FFFF00.');
        if (!meaning.value.trim()) throw new Error('Say what it means.');
        const patch = { argb: hex, meaning: meaning.value.trim(), role: role.value };
        if (entry?.id) await rc.updateLegend(entry.id, patch);
        else await rc.addLegend([patch]);
        notifyChanged('legend');
        toast({ tone: 'good', message: `#${hex} means "${meaning.value.trim()}".` });
      },
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Support codes
     ═══════════════════════════════════════════════════════════════════════ */

  const PARTIES = ['BART', 'Hitachi', 'Other'];

  /**
   * What each code typed into a day asks for.
   *
   * "X.WIT" on a day is one EIC and one BART witness; "X.X" is two EICs. The
   * register lives here, beside the colours, because it is the same kind of
   * thing: the sheet's shorthand, written down once so the editor can count it,
   * the export can key it and nobody has to remember what "TCE" stood for. A
   * code is retired rather than deleted — days already written with it keep
   * meaning what they meant.
   */
  async function supportCodes(host) {
    const codes = await rc.listSupportCodes({ includeRetired: true }).catch(() => []);
    const wrap = el('div', { class: 'lae-codes-admin' });
    wrap.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'Support codes' }),
      el('button', {
        class: 'cx-btn mini primary',
        html: icon('plus', { size: 12 }) + '<span>Add a code</span>',
        onClick: () => editCode(null, codes),
      }),
    ]));
    wrap.appendChild(el('p', {
      class: 'rc-hint',
      text: 'What the letters typed into a day ask for: "X.WIT" is one of each, "X.X" is two. The editor offers '
        + 'these as one-press buttons, totals them per day and per activity, and the Excel export prints this key '
        + 'under the sheet. A code nobody has registered is kept as typed and marked, never guessed at.',
    }));
    if (!codes.length) {
      wrap.appendChild(el('p', { class: 'rc-hint', text: 'No codes yet.' }));
    } else {
      wrap.appendChild(table(
        ['Code', 'Asks for', 'Party', 'On a TAWR', ''],
        codes.map((c) => el('tr', { class: c.active === false ? 'rc-inactive' : '' }, [
          el('td', {}, [el('span', { class: 'lae-code', text: String(c.code).toUpperCase() })]),
          el('td', { text: c.name || '—' }),
          el('td', { text: c.party || '—' }),
          el('td', { text: TAWR_LINES.find((l) => l.value === lineOfCode(c.code, new Map([[String(c.code).toUpperCase(), c]])))?.label || '—' }),
          el('td', { style: 'text-align:right;white-space:nowrap' }, [
            el('button', { class: 'cx-btn mini ghost', text: 'Edit', onClick: () => editCode(c, codes) }),
            el('button', {
              class: 'cx-btn mini ghost',
              text: c.active === false ? 'Restore' : 'Retire',
              title: c.active === false ? 'Offer it again' : 'Stop offering it. Days already written with it are left as they are.',
              onClick: async () => {
                try {
                  await rc.updateSupportCode(c.id, { active: c.active === false });
                  notifyChanged('support-codes');
                } catch (err) {
                  toast({ tone: 'bad', message: err.message });
                }
              },
            }),
          ]),
        ])),
      ));
    }
    host.appendChild(wrap);
  }

  function editCode(existing, codes) {
    const code = textInput({ value: existing?.code || '', placeholder: 'X', maxlength: '8' });
    const name = textInput({ value: existing?.name || '', placeholder: 'EIC' });
    const party = selectInput({ value: existing?.party || 'BART', options: PARTIES });
    const line = selectInput({ value: existing ? lineOfCode(existing.code, new Map([[String(existing.code).toUpperCase(), existing]])) : 'systems', options: TAWR_LINES });
    // Offered only once the database has the column — an older one refuses the field.
    const hasLine = codes.some((c) => 'tawr_line' in c);
    formModal({
      title: existing ? `Support code ${String(existing.code).toUpperCase()}` : 'Add a support code',
      confirmLabel: existing ? 'Save' : 'Add',
      body: el('div', { class: 'lae-form' }, [
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Code, as typed on the sheet' }), code]),
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'What it asks for' }), name]),
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Who provides it' }), party]),
        hasLine ? el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Where it goes on a TAWR' }), line]) : null,
      ]),
      onConfirm: async () => {
        const value = code.value.trim().toUpperCase();
        if (!/^[A-Z0-9]{1,8}$/.test(value)) throw new Error('A code is one to eight letters or digits, with no dots — the dots separate codes.');
        const clash = codes.find((c) => String(c.code).toUpperCase() === value && c.id !== existing?.id);
        if (clash) throw new Error(`${value} is already a code${clash.active === false ? ' (retired — restore it instead)' : ''}.`);
        const row = { code: value, name: name.value.trim(), party: party.value, ...(hasLine ? { tawr_line: line.value } : {}) };
        if (existing) await rc.updateSupportCode(existing.id, row);
        else await rc.addSupportCode({ ...row, active: true, sort: Math.max(0, ...codes.map((c) => c.sort || 0)) + 10 });
        notifyChanged('support-codes');
      },
    });
  }

  Object.defineProperty(__x, "renderLegend", { get: () => renderLegend, enumerable: true });
};

// ui/rc_table.js
__mods["ui/rc_table.js"] = function (__x, __req) {
  /**
   * One behaviour for every table in the calendar.
   *
   * Fifteen tables were built in eight modules, and each behaved slightly
   * differently: some numbers right-aligned under left-aligned headings, none
   * could be sorted, and the header scrolled away on a long list so a column of
   * figures was a column of figures with no name. Rather than a sixteenth way of
   * building a table, this takes the ones that exist as they are drawn and gives
   * each the same three things:
   *
   *   · the header stays in view while the rows scroll under it;
   *   · a click on a heading sorts by that column — numbers as numbers, blanks
   *     last, a second click reverses — and `aria-sort` says which;
   *   · a table marked `data-csv="<name>"` carries an Export CSV button, and the
   *     file holds exactly the rows on screen, in the order on screen.
   *
   * `ui/rc.js` runs it over whatever a tab draws, so a new table gets it without
   * asking. Grids whose position *is* the meaning — the look-ahead, PTO, the
   * week plan, the huddle — are left alone, and so is any table with a spanning
   * cell, where a row is not a record and sorting would tear it apart.
   *
   * Imports: util, dates, icons, exporters.
   */

  const { el, csvField } = __req("core/util.js");
  const { toISO, todayMs } = __req("core/dates.js");
  const { icon } = __req("ui/icons.js");
  const { saveFile } = __req("io/exporters.js");

  /** Tables drawn as a grid, where reordering rows would change what they say. */
  const POSITIONAL = ['la-grid', 'rc-pto-grid', 'rc-huddle', 'rc-resources'];

  /** Taller than this and the frame scrolls on its own, so the header can stay. */
  const TALL_ROWS = 14;

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  /** Enhance every eligible table under `root`. Safe to call repeatedly. */
  function enhanceTables(root) {
    for (const table of root.querySelectorAll('table.rc-table:not([data-enhanced])')) {
      enhanceTable(table);
    }
  }

  function enhanceTable(table) {
    table.dataset.enhanced = '1';
    if (POSITIONAL.some((c) => table.classList.contains(c)) || table.dataset.plain != null) return;

    const head = table.tHead?.rows[0];
    const body = table.tBodies[0];
    if (!head || !body) return;
    const spans = body.querySelector('td[colspan], td[rowspan], th[colspan], th[rowspan]');

    // A heading sits over its figures: where every cell in a column is a number,
    // the heading takes the numbers' alignment rather than floating over the gap
    // between two columns.
    [...head.cells].forEach((th, index) => {
      const cells = [...body.rows].map((r) => r.cells[index]).filter(Boolean);
      if (cells.length && cells.every((c) => c.classList.contains('rc-num'))) th.classList.add('rc-num');
    });

    const frame = table.closest('.rc-scroll');
    if (frame && body.rows.length > TALL_ROWS) frame.classList.add('rc-scroll-tall');

    if (!spans && body.rows.length > 1) {
      [...head.cells].forEach((th, index) => {
        if (!th.textContent.trim()) return;
        th.classList.add('rc-sortable');
        th.tabIndex = 0;
        th.setAttribute('aria-sort', 'none');
        th.title = 'Sort by this column';
        const sort = () => sortBy(table, index);
        th.addEventListener('click', sort);
        th.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            sort();
          }
        });
      });
    }

    if (table.dataset.csv && body.rows.length) {
      const button = el('button', {
        class: 'cx-btn mini ghost rc-table-csv',
        type: 'button',
        html: icon('download', { size: 12 }) + '<span>Export CSV</span>',
        title: 'Download these rows, in this order',
        onClick: () => exportCsv(table),
      });
      (frame || table).before(el('div', { class: 'rc-table-tools' }, [button]));
    }
  }

  /** What a cell sorts by: `data-sort` if the builder gave one, else its words. */
  function keyOf(cell) {
    if (!cell) return '';
    if (cell.dataset.sort != null) return cell.dataset.sort;
    const text = cell.textContent.trim();
    return text === '—' ? '' : text;
  }

  function sortBy(table, index) {
    const th = table.tHead.rows[0].cells[index];
    const ascending = th.getAttribute('aria-sort') !== 'ascending';
    for (const other of table.tHead.rows[0].cells) {
      if (other.classList.contains('rc-sortable')) other.setAttribute('aria-sort', 'none');
    }
    th.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');

    const body = table.tBodies[0];
    const rows = [...body.rows];
    rows.sort((a, b) => {
      const x = keyOf(a.cells[index]);
      const y = keyOf(b.cells[index]);
      // Blanks last whichever way round — an empty cell is not the smallest value.
      if (!x || !y) return Number(!x) - Number(!y);
      const cmp = collator.compare(x, y);
      return ascending ? cmp : -cmp;
    });
    body.append(...rows);
  }

  function csvCell(value) {
    return csvField(String(value ?? '').replace(/\s+/g, ' ').trim());
  }

  function exportCsv(table) {
    const lines = [];
    lines.push([...table.tHead.rows[0].cells].map((c) => csvCell(c.textContent)).join(','));
    for (const row of table.tBodies[0].rows) {
      lines.push([...row.cells].map((c) => csvCell(c.dataset.csv ?? c.textContent)).join(','));
    }
    const stamp = toISO(todayMs());
    const name = String(table.dataset.csv).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    saveFile(`${name}-${stamp}.csv`, lines.join('\r\n') + '\r\n', 'text/csv', 'Table');
  }

  Object.defineProperty(__x, "enhanceTables", { get: () => enhanceTables, enumerable: true });
  Object.defineProperty(__x, "enhanceTable", { get: () => enhanceTable, enumerable: true });
};

// ui/rc_la_changes.js
__mods["ui/rc_la_changes.js"] = function (__x, __req) {
  /**
   * Look-ahead → Changes and Snapshots: what moved between reads, and the reads.
   *
   * Imports: util, rc, core/lookahead, icons, components, rc_util, rc_la_state,
   *          rc_ingest.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { relinkCandidates, countable, describe } = __req("core/la_register.js");
  const { selectInput, textInput, badge, emptyState, checkbox, segmented, openModal } = __req("ui/components.js");


  const { notifyChanged, byId, dayLabel, todayISO, formModal, parsedView, isoToMs, authorNames } = __req("ui/rc_util.js");


  const { toISO, addDays } = __req("core/dates.js");

  const { table } = __req("ui/rc_la_state.js");
  const { checkNowButton } = __req("ui/rc_ingest.js");
  const { enhanceTable } = __req("ui/rc_table.js");
  const { editLines, editsBehind, editors } = __req("core/la_edit.js");

  /* ══════════════════════════════════════════════════════════════════════════
     Changes
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The weeks a change is worth reading about.
   *
   * From the Monday a week back, to the last day the calendar covers. Everything
   * outside that is either finished — a shift that moved in July cannot be
   * planned around now — or beyond what the workbook has been filled in to, which
   * is nothing at all. The register keeps the lot either way; this is which of it
   * gets drawn, and "Everything recorded" is one click away for the times the
   * question really is what happened in March.
   *
   * The far end comes from the calendar rather than from a constant, for the same
   * reason `windowOf()` does: the look-ahead is maintained four to six weeks out,
   * and a fixed four would hide the sixth week every time it appeared.
   */
  function changeWindow(view, today) {
    const ms = new Date(`${today}T00:00:00Z`).getTime();
    const monday = ms - ((new Date(ms).getUTCDay() + 6) % 7) * 86400000;
    const from = new Date(monday - 7 * 86400000).toISOString().slice(0, 10);

    const dated = (view?.days || []).map((d) => d.date).filter(Boolean);
    // No axis, or no year resolved from it: fall back to six weeks out rather
    // than to nothing, which would hide every change there is.
    const to = dated.length
      ? dated[dated.length - 1]
      : new Date(monday + 42 * 86400000).toISOString().slice(0, 10);

    return { from, to };
  }

  /** Whether the changes list is narrowed to that window. It is, by default. */
  let changesInWindow = true;

  /** Which of the two the Changes section shows: the summary, or every edit. */
  let changesView = 'summary';

  async function renderChanges(host) {
    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'What the look-ahead did' }),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end' }, [
        segmented({
          value: changesView,
          options: [
            { value: 'summary', label: 'Summary', title: 'What changed between one reading and the next, and who changed it' },
            { value: 'edits', label: 'Every edit', title: 'Every change made in the editor, one line each — who, when, from what to what' },
          ],
          onChange: (v) => { changesView = v; notifyChanged('changes'); },
        }),
        checkNowButton(),
      ]),
    ]));
    if (changesView === 'edits') {
      await renderEditLog(host);
      return;
    }

    const today = todayISO();
    const from = `${Number(today.slice(0, 4)) - 1}-01-01`;
    const [all, runs, parties, snapshot, legendRows] = await Promise.all([
      rc.listChangeEvents(from, `${today}T23:59:59Z`),
      rc.listIngestRuns({ limit: 60 }),
      rc.listParties(),
      rc.latestSnapshot(),
      rc.listLegend(),
    ]);

    /* The window is read off the calendar the last snapshot draws, so the two
       screens cannot disagree about where the look-ahead ends. */
    const view = snapshot?.grid ? parsedView(snapshot, legendRows) : null;
    const window_ = changeWindow(view, today);
    const events = changesInWindow
      ? all.filter((e) => !e.week_start || (e.week_start >= window_.from && e.week_start <= window_.to))
      : all;

    /* The judgements somebody has already made. These were being written and
       never read: an attribution recorded in a meeting was invisible the moment
       the dialog closed, so the same cancellation got asked about every week and
       the record it was creating could not be checked. Superseded rather than
       edited, so the newest row for an event is the answer and the ones under it
       are the history. */
    const annotations = events.length
      ? await rc.listAnnotations(events.map((e) => e.id)).catch(() => [])
      : [];
    const saidOf = new Map();
    for (const a of [...annotations].sort((x, y) => String(x.created_at).localeCompare(y.created_at))) {
      saidOf.set(a.change_event_id, a);
    }

    /* Coverage before content. Ingestion only happens when somebody has the
       application open, so the history has holes — and a hole that is not drawn
       reads as a quiet week. */
    host.appendChild(coverageNote(runs));

    /* What span this is a list of, and the way out of it. Said before the rows
       rather than under them: a list that has been narrowed and does not say so
       reads as a list of everything, which is how somebody concludes nothing
       happened in a fortnight that was simply out of view. */
    host.appendChild(el('div', {
      style: 'display:flex;align-items:center;gap:16px;margin:0 0 10px;flex-wrap:wrap',
    }, [
      el('span', {
        class: 'rc-hint',
        style: 'margin:0',
        text: changesInWindow
          ? `Weeks ${window_.from} to ${window_.to} — from a week back to the end of the calendar `
            + `as it was last read${all.length - events.length
              ? `. ${all.length - events.length} older or further-out change(s) are not listed`
              : ''}.`
          : `Everything recorded — ${all.length} change(s), whatever week they are about.`,
      }),
      checkbox({
        label: 'Everything recorded',
        checked: !changesInWindow,
        onChange: (on) => { changesInWindow = !on; notifyChanged('changes'); },
      }),
    ]));

    if (!events.length) {
      host.appendChild(el('p', {
        class: 'rc-hint',
        text: all.length
          ? `Nothing changed in the weeks on the calendar. ${all.length} change(s) are recorded `
            + 'outside that window — tick "Everything recorded" to see them.'
          : 'No changes recorded yet.',
      }));
      return;
    }

    const partyById = byId(parties);
    const counted = countable(events);
    host.appendChild(el('p', { class: 'rc-hint' }, [
      el('span', { text: `${counted.length} change(s) that count, ` }),
      el('span', { text: `${events.length - counted.length} that do not — the window moving, an activity `
        + 'moving site or its wording changing.' }),
    ]));

    /* Who made each change, from the edit log. Read only for changes found
       between two readings the editor published — they name the row — and a
       failure here costs the column, never the list. */
    const by = await whoMadeThem(events, legendRows).catch((err) => {
      console.warn('[cx-timeline] who made the changes:', err.message);
      return null;
    });

    const rows = events.map((e) => el('tr', {}, [
      el('td', { text: e.week_start || '—' }),
      el('td', {}, [badge(kindLabel(e.kind), kindTone(e.kind))]),
      el('td', { text: describe({ ...e, weekStart: e.week_start, rowKey: e.row_key }) }),
      byCell(e, by),
      el('td', { class: 'rc-hint', text: e.detected_at ? dayLabel(e.detected_at.slice(0, 10)) : '' }),
      el('td', {}, [(() => {
        const said = saidOf.get(e.id);
        if (said) {
          return el('div', {}, [
            el('div', { text: partyById.get(said.party_id)?.name || said.note || 'Recorded' }),
            said.note && said.party_id ? el('div', { class: 'rc-hint', text: said.note }) : null,
            el('button', {
              class: 'cx-btn mini ghost',
              text: 'Correct it',
              title: 'A correction is a new row that supersedes this one. Nothing is edited away.',
              onClick: () => attribute(e, parties),
            }),
          ].filter(Boolean));
        }
        return e.kind === 'cancellation'
          ? el('button', {
            class: 'cx-btn mini ghost',
            text: 'Whose?',
            title: 'Red says a shift was cancelled. It cannot say by whom.',
            onClick: () => attribute(e, parties),
          })
          : el('span', { class: 'rc-hint', text: '' });
      })()]),
    ]));

    host.appendChild(table(['Week', 'Kind', 'What', 'By', 'Seen', 'Down to'], rows));
    if (events.some((e) => !e.la_row_id && KPI_SHOWN.includes(e.kind))) {
      host.appendChild(el('p', {
        class: 'rc-hint',
        text: 'A change with no name against it was found before readings carried the editor\'s row '
          + 'ids, so the edit log cannot be joined to it. Every change from now on names who made it.',
      }));
    }

    const unanswered = events.filter((e) => e.kind === 'cancellation' && !saidOf.has(e.id)).length;
    if (unanswered) {
      host.appendChild(el('p', {
        class: 'rc-hint',
        text: `${unanswered} cancellation(s) have nobody against them yet. Red says a shift was `
          + 'cancelled and cannot say by whom — and a cancellation with no party is the one row '
          + 'in here that cannot be used for anything later.',
      }));
    }

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
    details_changed: 'Details', window_advanced: 'Window advanced', window_retired: 'Window retired',
  };

  /** The kinds a person makes — the window moving is the calendar's, not anybody's. */
  const KPI_SHOWN = ['scope_added', 'scope_removed', 'cancellation', 'shift_changed',
    'resource_changed', 'location_shift', 'details_changed'];

  /* ══════════════════════════════════════════════════════════════════════════
     Who made each change
     ═══════════════════════════════════════════════════════════════════════ */

  /** How a timestamp reads in the log: "Fri 2 Oct, 14:05". */
  const whenLabel = (iso) => new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  /** The legend's meaning for a colour, newest row for it first. */
  function meaningLookup(legendRows) {
    const byHex = new Map();
    for (const r of [...(legendRows || [])].sort((a, b) => String(a.valid_from || '').localeCompare(String(b.valid_from || '')))) {
      byHex.set(String(r.argb).toUpperCase(), r.meaning || '');
    }
    return (hex) => byHex.get(String(hex || '').toUpperCase()) || '';
  }

  /** A person's name for the id an edit was stamped with, from the roster (including people who have left). */
  function nameLookup(people) {
    const names = authorNames(people);
    return (id) => (id ? names(id) || 'An account no longer on the roster' : 'Unknown');
  }

  /**
   * For every change that names an editor row, the edits that made it.
   *
   * The edges are the two readings' own times: an edit after the earlier one
   * was taken and no later than the later one is between them. One read of the
   * log covers the lot — from the earliest edge to the latest.
   */
  async function whoMadeThem(events, legendRows) {
    const named = events.filter((e) => e.la_row_id && e.from_snapshot && e.to_snapshot);
    if (!named.length) return null;
    const [metas, laRows, people] = await Promise.all([
      rc.snapshotMetaByIds(named.flatMap((e) => [e.from_snapshot, e.to_snapshot])),
      rc.listLaRows().catch(() => []),
      rc.listPeople({ includeInactive: true }).catch(() => []),
    ]);
    const takenAt = new Map(metas.map((m) => [m.id, m.taken_at]));
    const spans = named
      .map((e) => ({ e, from: takenAt.get(e.from_snapshot), to: takenAt.get(e.to_snapshot) }))
      .filter((x) => x.from && x.to);
    if (!spans.length) return null;
    const earliest = spans.map((x) => x.from).sort()[0];
    const latest = spans.map((x) => x.to).sort().pop();
    const edits = await rc.listLaEditsBetween(earliest, latest);

    const behind = new Map();
    for (const { e, from, to } of spans) {
      behind.set(e.id, editsBehind(e, edits, { rows: laRows, fromAt: from, toAt: to }));
    }
    return { behind, rows: laRows, nameOf: nameLookup(people), meaningOf: meaningLookup(legendRows) };
  }

  /** The "By" cell: who made the change, and the edits themselves one press away. */
  function byCell(event, by) {
    const edits = by?.behind.get(event.id);
    if (!edits || !edits.length) {
      return el('td', {
        class: 'rc-hint',
        text: '—',
        title: !event.la_row_id
          ? 'Found before readings carried the editor\'s row ids — the edit log cannot be joined to it'
          : 'No edit between these two readings matched this change',
      });
    }
    const people = editors(edits).map(by.nameOf);
    return el('td', { dataset: { sort: people.join(', '), csv: people.join(', ') } }, [
      el('div', { text: people.join(', ') }),
      el('button', {
        class: 'cx-btn mini ghost',
        text: edits.length === 1 ? 'The edit' : `The ${edits.length} edits`,
        title: 'Exactly what was changed, by whom and when',
        onClick: () => showEdits(event, edits, by),
      }),
    ]);
  }

  function showEdits(event, edits, by) {
    const lines = editLines(edits, { rows: by.rows, meaningOf: by.meaningOf });
    openModal({
      title: 'What was changed',
      subtitle: describe({ ...event, weekStart: event.week_start, rowKey: event.row_key }),
      body: el('div', { class: 'lae-form' }, [editList(lines, by.nameOf)]),
      actions: [{ label: 'Close' }],
    });
  }

  /** Edit lines as a list, newest first — the shape the editor's own history uses. */
  function editList(lines, nameOf) {
    const list = el('ol', { class: 'lae-history', 'aria-label': 'Edits, newest first' });
    for (const line of [...lines].reverse()) {
      list.appendChild(el('li', { class: 'lae-history-item' }, [
        el('span', { class: 'lae-history-when', text: whenLabel(line.at) }),
        el('span', { class: 'lae-history-who', text: nameOf(line.by) }),
        el('span', { class: 'lae-history-what', text: sentence(line) }),
      ]));
    }
    return list;
  }

  /** One edit as one sentence: "IXL Regression Testing, Mon 12 Oct: Shift Day Shift → Cancellation". */
  function sentence(line) {
    const where = line.day ? `, ${dayLabel(line.day)}` : '';
    return `${line.title}${where}: ${line.detail}`;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Every edit
     ═══════════════════════════════════════════════════════════════════════ */

  /** The edit log's span and filters — kept while the calendar is open. */
  const editLog = { from: null, to: null, person: '', text: '' };

  /**
   * Every change made in the editor, one line each.
   *
   * The summary says what moved between two readings; this is what was done to
   * get there — a cell painted and painted back again inside one save is two
   * lines here and nothing there. Read straight from `rc_la_edits`, which keeps
   * both sides of every change, so nothing is reconstructed. An administrator's,
   * like the log itself.
   */
  async function renderEditLog(host) {
    const today = todayISO();
    if (!editLog.from) editLog.from = toISO(addDays(isoToMs(today), -13));
    const from = editLog.from;
    const to = editLog.to && editLog.to >= from ? editLog.to : today;

    let edits;
    let laRows;
    let people;
    let legendRows;
    try {
      [edits, laRows, people, legendRows] = await Promise.all([
        rc.listLaEditsBetween(`${from}T00:00:00Z`, `${to}T23:59:59.999Z`),
        rc.listLaRows().catch(() => []),
        rc.listPeople({ includeInactive: true }).catch(() => []),
        rc.listLegend().catch(() => []),
      ]);
    } catch (err) {
      host.appendChild(el('p', { class: 'rc-error', text: `The edit log could not be read: ${err.message}` }));
      return;
    }

    const nameOf = nameLookup(people);
    const lines = editLines(edits, { rows: laRows, meaningOf: meaningLookup(legendRows) }).reverse();

    const dateBox = (value, label, onPick) => {
      const box = el('input', { type: 'date', class: 'cx-input mini', value, 'aria-label': label, style: 'width:150px' });
      box.addEventListener('change', () => onPick(box.value));
      return box;
    };
    const authors = [...new Set(lines.map((l) => l.by))];
    if (editLog.person && !authors.includes(editLog.person)) editLog.person = '';
    const person = selectInput({
      value: editLog.person,
      mini: true,
      options: [
        { value: '', label: 'Everybody' },
        ...authors.map((id) => ({ value: id || '', label: nameOf(id) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      ],
      onChange: (v) => { editLog.person = v; drawRows(); },
    });
    person.style.width = '200px';
    person.setAttribute('aria-label', 'Edits made by');
    const search = textInput({
      value: editLog.text,
      mini: true,
      placeholder: 'Activity, location, day…',
      'aria-label': 'Find edits mentioning',
      style: 'width:260px',
      onInput: (v) => { editLog.text = typeof v === 'string' ? v : search.value; drawRows(); },
    });

    host.appendChild(el('div', {
      style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px',
    }, [
      el('span', { class: 'rc-hint', style: 'margin:0', text: 'From' }),
      dateBox(from, 'Edits made from', (v) => { if (v) { editLog.from = v; notifyChanged('changes'); } }),
      el('span', { class: 'rc-hint', style: 'margin:0', text: 'To' }),
      dateBox(to, 'Edits made up to', (v) => { editLog.to = v; notifyChanged('changes'); }),
      person,
      search,
    ]));

    if (!lines.length) {
      host.appendChild(emptyState({
        iconName: 'edit',
        title: 'Nothing was edited',
        message: `No change was made in the look-ahead editor between ${dayLabel(from)} and ${dayLabel(to)}. `
          + 'Widen the dates to look further back.',
      }));
      return;
    }

    const summary = el('p', { class: 'rc-hint' });
    const holder = el('div');
    host.append(summary, holder);
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'One line for each thing changed, newest first. "Exactly" says what differs — who was added '
        + 'to a day or taken off it, the shift painted or cleared, a support code asked for, taken off or '
        + 'struck out — and From and To are the whole cell before and after. A row moved up or down, or '
        + 'indented, is left out: that is where it sits, not what it says.',
    }));

    /* Only the rows are redrawn as the filters change — the search box stays put,
       so typing in it never loses the caret. */
    function drawRows() {
      const words = String(editLog.text || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
      const shown = lines.filter((l) => {
        if (editLog.person && (l.by || '') !== editLog.person) return false;
        if (!words.length) return true;
        const hay = [l.title, l.location, l.what, l.detail, l.from, l.to, l.day, l.day ? dayLabel(l.day) : '']
          .join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      const people = new Set(shown.map((l) => l.by)).size;
      summary.textContent = `${shown.length} edit(s) by ${people} ${people === 1 ? 'person' : 'people'}`
        + ` between ${dayLabel(from)} and ${dayLabel(to)}${shown.length < lines.length ? ` — ${lines.length} in all` : ''}.`;
      clear(holder);
      const t = table(['When', 'Who', 'Activity', 'Location', 'Day', 'Changed', 'Exactly', 'From', 'To'], shown.map((l) => el('tr', {}, [
        el('td', { text: whenLabel(l.at), dataset: { sort: l.at, csv: l.at } }),
        el('td', { text: nameOf(l.by) }),
        el('td', { text: l.title }),
        el('td', { text: l.location || '—' }),
        el('td', { text: l.day ? dayLabel(l.day) : '—', dataset: { sort: l.day || '', csv: l.day || '' } }),
        el('td', { text: l.what }),
        el('td', { class: 'rc-edit-detail', text: l.detail }),
        el('td', { class: 'rc-hint', text: l.from || '—' }),
        el('td', { class: 'rc-hint', text: l.to || '—' }),
      ])));
      const tableEl = t.querySelector('table');
      tableEl.dataset.csv = 'lookahead-edits';
      holder.appendChild(t);
      enhanceTable(tableEl);
    }
    drawRows();
  }
  const kindLabel = (k) => KIND_LABELS[k] || k;
  const kindTone = (k) => ({
    cancellation: 'bad', scope_removed: 'warn', scope_added: 'info',
    window_advanced: 'muted', window_retired: 'muted',
  }[k] || 'neutral');

  /* ══════════════════════════════════════════════════════════════════════════
     Snapshots
     ═══════════════════════════════════════════════════════════════════════ */

  async function renderSnapshots(host) {
    /* Forty rows of metadata, not forty grids: the two numbers this table prints
       off each snapshot are computed in the database by the view. */
    const snapshots = await rc.listSnapshotMeta({ limit: 40 });

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
        el('td', { class: 'rc-num', text: String(s.row_count ?? 0) }, [
          s.compacted
            ? el('span', {
              class: 'rc-hint', style: 'margin:0 0 0 6px',
              text: '· compacted',
              title: 'A superseded editor reading past the keep period. Its grid can be rebuilt from the edit log; its rows and every link to them are kept.',
            })
            : null,
        ]),
        el('td', { class: 'rc-num', text: String(s.unmapped_count ?? 0) }),
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


  Object.defineProperty(__x, "renderChanges", { get: () => renderChanges, enumerable: true });
  Object.defineProperty(__x, "KIND_LABELS", { get: () => KIND_LABELS, enumerable: true });
  Object.defineProperty(__x, "renderSnapshots", { get: () => renderSnapshots, enumerable: true });
};

// ui/rc_la_cancellations.js
__mods["ui/rc_la_cancellations.js"] = function (__x, __req) {
  /**
   * Look-ahead → Cancellations: every red run since the log's start.
   *
   * Imports: util, dates, rc, io/lookahead, core/lookahead, icons, components,
   *          rc_util, rc_la_state, rc_ingest.
   */

  const { el, csvField } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { applyLegend, isDark } = __req("io/lookahead.js");
  const { saveFile } = __req("io/exporters.js");
  const { readGrid, describeCodeCounts, isCancelMeaning } = __req("core/lookahead.js");
  const { rowsFrom } = __req("core/la_register.js");
  const { cancellationWorkbook } = __req("io/la_xlsx.js");
  const { monthLabel, weekdayLetter, isWeekend, mondayOf } = __req("core/la_edit.js");
  const { icon } = __req("ui/icons.js");
  const { selectInput, toast, badge, emptyState, checkbox, confirmDialog, chipStat } = __req("ui/components.js");


  const { notifyChanged, dayLabel, todayISO, formModal, isoToMs, cancellationLog } = __req("ui/rc_util.js");


  const { toISO, addDays } = __req("core/dates.js");

  const { la, table } = __req("ui/rc_la_state.js");
  const { checkNowButton } = __req("ui/rc_ingest.js");

  /* ══════════════════════════════════════════════════════════════════════════
     Cancellations
     ═══════════════════════════════════════════════════════════════════════ */

  /** Whose cancellation it can be. The contract's three answers, as the schema checks them. */
  const CANCEL_PARTIES = ['BART', 'Hitachi', 'Other'];
  /**
   * One colour per answer, the same in the list, the calendar and its Excel:
   * BART red, Hitachi blue, another party amber — and purple while nobody has
   * said, so an unanswered cancellation never reads as anybody's.
   */
  const PARTY_TONE = { BART: 'bad', Hitachi: 'info', Other: 'warn' };
  const OPEN_TONE = 'pending';

  /** Whose an event is, as the class its colour hangs on: `by-bart`, `by-hitachi`, `by-other` or `open`. */
  function whose(e) {
    if (!e.note) return 'open';
    return `by-${CANCEL_PARTIES.includes(e.note.party) ? e.note.party.toLowerCase() : 'other'}`;
  }

  /** The span the log covers, when somebody has changed it on screen. A blank end is no end. */
  let cancellationsFrom = null;
  let cancellationsTo = '';
  let cancellationsUnansweredOnly = false;
  /** Whether cancellations somebody removed from the log are listed too. */
  let cancellationsShowRemoved = false;
  /** Which kind of cancellation is listed: everything, whole days, or BART resources. */
  let cancellationsKind = 'all';
  /** The log as a list, or as a calendar of the period like the look-ahead. */
  let cancellationsView = 'list';

  const KIND_LABEL = { activity: 'Activity cancelled', support: 'BART support cancelled' };

  /**
   * Every red run the look-ahead has shown, since the log's start, with whose it
   * was and why.
   *
   * The events are derived — `rc_cancelled_days` reads the rows every ingest
   * already wrote, and `cancellationEvents()` joins side-by-side days on one
   * activity into one event — so a week cancelled on the sheet is one line here
   * however many reads showed it, and a week that was red and later turned back
   * is still here, because it was cancelled when those reads were taken. What is
   * stored is only the judgement: a party (BART, Hitachi or Other) and a reason,
   * append-only, corrected by superseding.
   *
   * This is the whole history rather than the Changes list's per-day
   * transitions, which only catch a cell turning red *between* two reads — a
   * cell already red the first time the sheet was read was never an event there.
   */
  async function renderCancellations(host) {
    const settings = await rc.listSettings().catch(() => []);
    const configured = settings.find((x) => x.key === 'cancellation_log_from')?.value;
    const from = cancellationsFrom || configured || `${new Date().getUTCFullYear()}-09-01`;

    const all = await cancellationLog(from)
      .catch((err) => { toast({ tone: 'bad', title: 'Could not read the cancellations', message: err.message }); return []; });
    const to = cancellationsTo && cancellationsTo >= from ? cancellationsTo : '';
    /* An event is in the span when it starts inside it. One that runs past the
       end is kept whole rather than cut at the boundary: a cancelled week is one
       event, and half of it in a report is a different claim. */
    const inSpan = all.filter((e) => !to || e.start <= to);
    /* Removed from the log — "this was never a cancellation" — is a judgement
       like any other: kept, and listed again when somebody asks to see them. */
    const removedCount = inSpan.filter((e) => e.dismissed).length;
    const events = inSpan.filter((e) => cancellationsShowRemoved || !e.dismissed);

    const dateBox = (value, label, onPick) => {
      const box = el('input', {
        type: 'date', class: 'cx-input mini', value, 'aria-label': label, style: 'width:150px',
      });
      box.addEventListener('change', () => onPick(box.value));
      return box;
    };
    const fromInput = dateBox(from, 'Log starts on', (v) => {
      if (!v) return;
      cancellationsFrom = v;
      notifyChanged('cancellations');
    });
    const toInput = dateBox(to, 'Log ends on', (v) => {
      cancellationsTo = v;
      notifyChanged('cancellations');
    });
    const span = to ? `${dayLabel(from)} to ${dayLabel(to)}` : `since ${dayLabel(from)}`;

    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'Cancellation log' }),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end' }, [
        el('span', { class: 'rc-hint', style: 'margin:0;white-space:nowrap', text: 'From' }),
        fromInput,
        el('span', { class: 'rc-hint', style: 'margin:0;white-space:nowrap', text: 'To' }),
        toInput,
        el('button', {
          class: 'cx-btn mini ghost',
          html: `${icon('refresh', { size: 12 })}<span>Re-read saved snapshots</span>`,
          title: 'Apply today\'s rules — Resource rows are never cancellations — to every read the log covers',
          onClick: () => rederiveCancellations(from),
        }),
        checkNowButton(),
      ].filter(Boolean)),
    ]));

    host.appendChild(el('p', {
      class: 'rc-hint',
      text: `Every red cell the look-ahead currently has ${span}, with the BART resources those days `
        + 'had asked for — and every BART resource currently struck out of an activity that still goes '
        + 'ahead ("X.~WIT": the witness cancelled, the EIC still wanted). Only what the look-ahead says '
        + 'now: a day turned back from red, a row taken off the sheet or a resource reinstated drops '
        + 'out. For a day the window has rolled past, it is what the last reading to show that day '
        + 'said. Cells side by side on one activity are one event; red on a Resource row is never a '
        + 'cancellation; only resources BART provides are listed; and a resource removed in the '
        + 'editor with "Just remove" is not tracked.',
    }));

    if (!events.length) {
      host.appendChild(emptyState({
        iconName: 'calendar',
        title: 'No cancellations',
        message: `No read of the look-ahead ${span} has a cell painted in the colour the Legend calls a `
          + 'cancellation, or a BART resource struck out of an activity.',
      }));
      return;
    }

    const tally = { BART: 0, Hitachi: 0, Other: 0 };
    let open = 0;
    let dayCount = 0;
    for (const e of events) {
      dayCount += e.days;
      if (e.note) tally[e.note.party] = (tally[e.note.party] || 0) + 1;
      else open++;
    }
    const resourceEvents = events.filter((e) => e.kind === 'support').length;
    host.appendChild(el('div', { class: 'cx-chipstats', style: 'margin:0 0 12px' }, [
      chipStat('Events', events.length, 'info'),
      chipStat('Cancelled activities', events.length - resourceEvents, 'muted'),
      chipStat('BART support', resourceEvents, resourceEvents ? 'warn' : 'muted'),
      chipStat('Days', dayCount, 'muted'),
      ...CANCEL_PARTIES.map((p) => chipStat(p, tally[p], tally[p] ? PARTY_TONE[p] : 'muted')),
      chipStat('No reason yet', open, open ? OPEN_TONE : 'muted'),
    ]));

    host.appendChild(el('div', { style: 'display:flex;gap:18px;flex-wrap:wrap' }, [
      checkbox({
        label: 'Only the ones with no reason yet',
        checked: cancellationsUnansweredOnly,
        onChange: (on) => { cancellationsUnansweredOnly = on; notifyChanged('cancellations'); },
      }),
      removedCount || cancellationsShowRemoved ? checkbox({
        label: `Show the ${removedCount} removed from the log`,
        checked: cancellationsShowRemoved,
        onChange: (on) => { cancellationsShowRemoved = on; notifyChanged('cancellations'); },
      }) : null,
    ].filter(Boolean)));

    const tabs = (klass, choices, current, pick) => el('div', { class: `rc-tabs ${klass}`, style: 'margin:0' },
      choices.map(([id, label]) => el('button', {
        class: 'rc-tab',
        type: 'button',
        text: label,
        'aria-pressed': String(current === id),
        onClick: () => { pick(id); notifyChanged('cancellations'); },
      })));
    host.appendChild(el('div', { style: 'display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:8px 0 0' }, [
      tabs('la-cancel-kinds',
        [['all', 'Everything'], ['activity', 'Cancelled activities'], ['support', 'BART support only']],
        cancellationsKind, (id) => { cancellationsKind = id; }),
      tabs('la-cancel-views', [['list', 'As a list'], ['calendar', 'As a calendar']],
        cancellationsView, (id) => { cancellationsView = id; }),
    ]));

    const shown = events
      .filter((e) => cancellationsKind === 'all' || e.kind === cancellationsKind)
      .filter((e) => !cancellationsUnansweredOnly || !e.note);

    if (cancellationsView === 'calendar') {
      host.appendChild(await cancellationCalendar(shown, from, to));
      return;
    }

    /* The extract is what is on screen: the span above, and the "no reason yet"
       narrowing when it is ticked. The file says which span in its name, because
       a log that is quietly a fortnight of a quarter reads as the whole quarter. */
    host.appendChild(el('div', { style: 'margin:8px 0 10px' }, [
      el('button', {
        class: 'cx-btn mini',
        html: `${icon('download', { size: 12 })}<span>Export ${shown.length} to CSV</span>`,
        onClick: () => saveFile(
          `cancellations-${from}-to-${to || todayISO()}.csv`,
          cancellationCsv(shown),
          'text/csv',
          'Cancellation log',
        ),
      }),
    ]));
    const rows = shown.map((e) => el('tr', {
      class: `rc-cancel-row rc-cancel-${e.kind}${e.dismissed ? ' rc-cancel-removed' : ''}`,
      dataset: { start: e.start, label: e.label, kind: e.kind, codes: e.codes || '' },
    }, [
      el('td', {}, [
        el('div', { class: 'rc-cancel-cells', 'aria-hidden': 'true' },
          [...Array(Math.min(e.days, 14))].map(() => el('span', {
            class: `rc-cancel-cell rc-cancel-${whose(e)}${e.kind === 'support' ? ' rc-cancel-cell-support' : ''}`,
          }))),
      ]),
      el('td', {}, [
        el('div', { text: e.label || '—' }),
        e.location ? el('div', { class: 'rc-hint', text: e.location }) : null,
      ].filter(Boolean)),
      el('td', {}, [
        badge(KIND_LABEL[e.kind], e.kind === 'support' ? 'warn' : 'bad'),
      ]),
      /* What BART had been asked for and lost. On a cancelled day, everything the
         day asked for; on an activity that went ahead, the codes struck out —
         drawn struck through, as the grid draws them. */
      el('td', {}, e.resources?.size
        ? [el('span', {
          class: e.kind === 'support' ? 'rc-code-cancelled' : '',
          text: describeCodeCounts(e.resources),
          title: e.kind === 'support'
            ? 'Struck out of the day while the activity went ahead'
            : 'What those days had asked BART for — cancelled with them',
        })]
        : [el('span', { class: 'rc-hint', text: '—' })]),
      el('td', { text: e.start === e.end ? dayLabel(e.start) : `${dayLabel(e.start)} – ${dayLabel(e.end)}` }),
      el('td', { text: `${e.days} day${e.days === 1 ? '' : 's'}` }),
      el('td', {
        class: 'rc-hint',
        title: 'How many reads of the sheet showed any of these days red, and when it was first seen',
        text: `${e.reads} read${e.reads === 1 ? '' : 's'}${e.firstSeen ? ` · first ${dayLabel(String(e.firstSeen).slice(0, 10))}` : ''}`,
      }),
      el('td', {}, [e.note ? badge(e.note.party, PARTY_TONE[e.note.party] || 'neutral') : badge('No reason yet', OPEN_TONE)]),
      el('td', {}, [
        e.note?.reason ? el('div', { text: e.note.reason }) : null,
        e.history.length > 1
          ? el('div', { class: 'rc-hint', text: `Corrected ${e.history.length - 1} time(s)`, title: e.history.map((n) => `${n.party}: ${n.reason || ''}`).join('\n') })
          : null,
      ].filter(Boolean)),
      el('td', {}, [
        el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, e.dismissed ? [
          badge('Removed from the log', 'neutral'),
          rc.isAdmin() ? el('button', {
            class: 'cx-btn mini ghost',
            text: 'Put back',
            title: 'Count it as a cancellation again. The removal stays in its history.',
            onClick: () => restoreCancellation(e),
          }) : null,
        ].filter(Boolean) : [
          el('button', {
            class: 'cx-btn mini' + (e.note ? ' ghost' : ' primary'),
            text: e.note ? 'Correct' : 'Add reason',
            title: e.note ? 'A correction is a new entry that supersedes this one. Nothing is edited away.' : '',
            onClick: () => recordCancellation(e),
          }),
          rc.isAdmin() ? el('button', {
            class: 'cx-btn mini ghost danger rc-cancel-remove',
            text: 'Remove from log',
            title: 'It should never have been here — a names row, a cell painted red by mistake',
            onClick: () => removeCancellation(e),
          }) : null,
          el('button', {
            class: 'cx-btn mini ghost',
            text: 'Show cells',
            title: 'Open the calendar on this row alone, in the weeks it was cancelled',
            onClick: () => showCells(e),
          }),
        ].filter(Boolean)),
      ]),
    ]));

    host.appendChild(table(['', 'Activity', 'What', 'BART resources', 'Cancelled', 'Length', 'Seen', 'Responsible', 'Reason', ''], rows));
  }

  /**
   * Open the calendar on the one row a cancellation was logged against, in the
   * weeks it ran — not a filter typed for it. The log's label is the row's cells
   * joined with " · ", which no filter term ever matched (the box searches the
   * cells joined by spaces, and splits on commas), and "the whole sheet" was the
   * newest reading's, which a row cancelled weeks ago is often no longer on. The
   * row is found by the editor's id where the reading carries one, else by its
   * words; the window is the Mondays the event spans, paged from there.
   */
  function showCells(e) {
    const today = todayISO();
    const first = mondayOf(e.start);
    la.calendarRow = { id: e.laRowId || null, label: e.label };
    la.calendarFilter = '';
    la.calendarStart = first === mondayOf(today) ? null : first;
    la.calendarWeeks = Math.max(1, Math.round((isoToMs(mondayOf(e.end)) - isoToMs(first)) / (7 * 86400000)) + 1);
    la.onlyMine = false;
    la.section = 'calendar';
    la.sectionChosen = true;
    notifyChanged('cancellations');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The cancellations as a calendar
     ═══════════════════════════════════════════════════════════════════════ */

  /** What one cancelled run says on the calendar and in its Excel cell. */
  function runText(e) {
    const what = e.kind === 'support'
      ? `${describeCodeCounts(e.resources)} cancelled`
      : describeCodeCounts(e.resources);
    const why = e.note ? `${e.note.party}${e.note.reason ? `: ${e.note.reason}` : ''}` : 'No reason yet';
    return [what, why].filter(Boolean).join('\n');
  }

  /** The same as nodes: only the struck-out codes are drawn through, never the reason. */
  function runNodes(e) {
    const [what, ...why] = runText(e).split('\n');
    return [
      e.kind === 'support'
        ? el('div', {}, [el('span', { class: 'la-code-cancelled', text: describeCodeCounts(e.resources) }), ' cancelled'])
        : el('div', { text: what }),
      ...why.map((line) => el('div', { class: 'la-cancel-why', text: line })),
    ].filter((n) => n.textContent);
  }

  /**
   * The log drawn like the look-ahead: one row per activity, the days of the
   * period across, each cancelled run one cell spanning its days — red for a day
   * cancelled outright, red writing for a BART resource struck out of work that
   * went ahead — carrying who was responsible and why. Exactly what is listed
   * (the period, the kind, "no reason yet"), and exportable to Excel as it is.
   */
  async function cancellationCalendar(events, from, to) {
    const wrap = el('div', { class: 'la-cancel-calendar' });
    const legendRows = await rc.listLegend().catch(() => []);
    const red = String(legendRows.find((l) => isCancelMeaning(l.meaning || ''))?.argb || 'FF0000').toUpperCase();
    const last = to || events.reduce((m, e) => (e.end > m ? e.end : m), from);
    const days = [];
    for (let d = from; d <= last && days.length < 400; d = toISO(addDays(isoToMs(d), 1))) days.push(d);

    const byActivity = new Map();
    for (const e of events) {
      const activity = e.laRowId || e.key;
      if (!byActivity.has(activity)) byActivity.set(activity, { label: e.label, location: e.location, events: [] });
      byActivity.get(activity).events.push(e);
    }
    const rows = [...byActivity.values()].sort((a, b) => a.label.localeCompare(b.label) || a.location.localeCompare(b.location));

    const span = `${dayLabel(from)} to ${dayLabel(last)}`;
    wrap.appendChild(el('div', { style: 'display:flex;gap:8px;align-items:center;margin:8px 0 10px;flex-wrap:wrap' }, [
      el('button', {
        class: 'cx-btn mini primary la-cancel-xlsx',
        type: 'button',
        html: `${icon('download', { size: 12 })}<span>Export to Excel</span>`,
        title: 'This calendar as an .xlsx: one row per activity, each cancelled run one cell with who and why',
        onClick: () => {
          const bytes = cancellationWorkbook({
            days,
            red,
            title: 'Cancellation log',
            subtitle: `${span} · ${events.length} cancellation(s)`,
            rows: rows.map((r) => ({
              ...r,
              events: r.events.map((e) => ({ start: e.start, end: e.end, kind: e.kind, party: e.note?.party || null, text: runText(e) })),
            })),
          });
          saveFile(`cancellations ${from} to ${last}.xlsx`, bytes,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Cancellation calendar');
        },
      }),
      el('span', { class: 'rc-hint', style: 'margin:0', text: `${rows.length} activit${rows.length === 1 ? 'y' : 'ies'}, ${span}` }),
    ]));

    if (!rows.length) {
      wrap.appendChild(emptyState({ iconName: 'calendar', title: 'Nothing cancelled in this period', message: 'Widen the dates above, or show every kind.' }));
      return wrap;
    }

    /* What each colour says, in words beside it — the cell says the party too,
       so the colour is never the only way to read it. */
    const swatch = (klass, text, style = '') => el('span', { class: 'la-cancel-key-item' }, [
      el('span', { class: `la-cancel-swatch ${klass}`, style, 'aria-hidden': 'true' }), el('span', { text }),
    ]);
    wrap.appendChild(el('div', { class: 'la-cancel-key', role: 'note', 'aria-label': 'What the colours mean' }, [
      swatch('la-cancel-by-bart', 'BART', `background-color:#${red}`),
      swatch('la-cancel-by-hitachi', 'Hitachi'),
      swatch('la-cancel-by-other', 'Other'),
      swatch('la-cancel-open', 'No reason yet'),
      swatch('la-cancel-support', 'Outlined: a BART resource struck out, the activity went ahead'),
    ]));

    const head = el('thead', {}, [
      el('tr', {}, [
        el('th', { class: 'la-cancel-meta', text: '' }),
        el('th', { class: 'la-cancel-meta', text: '' }),
        ...days.map((d, i) => el('th', {
          class: 'la-month',
          text: i === 0 || monthLabel(days[i - 1]) !== monthLabel(d) ? monthLabel(d) : '',
        })),
      ]),
      el('tr', {}, [
        el('th', { class: 'la-cancel-meta', text: 'Activity' }),
        el('th', { class: 'la-cancel-meta', text: 'Location' }),
        ...days.map((d) => el('th', {
          class: `la-num${isWeekend(d) ? ' la-weekend' : ''}`,
          html: `${Number(d.slice(8, 10))}<br>${weekdayLetter(d)}`,
          title: dayLabel(d),
        })),
      ]),
    ]);
    const body = el('tbody');
    for (const r of rows) {
      const tr = el('tr', { class: 'la-cancel-line' }, [
        el('td', { class: 'la-cancel-meta', text: r.label }),
        el('td', { class: 'la-cancel-meta rc-hint', text: r.location || '' }),
      ]);
      const at = new Map();
      for (const e of r.events) {
        const a = days.indexOf(e.start < from ? from : e.start);
        const b = days.indexOf(e.end > last ? last : e.end);
        if (a >= 0 && b >= a) at.set(a, { e, b });
      }
      for (let i = 0; i < days.length; i++) {
        const hit = at.get(i);
        if (!hit) {
          tr.appendChild(el('td', { class: `la-day${isWeekend(days[i]) ? ' la-weekend' : ''}` }));
          continue;
        }
        const { e, b } = hit;
        /* BART's day is the legend's own red, painted inline like any legend
           colour; every other answer's fill is a class (see `--la-cancel-*`). */
        const bart = e.kind === 'activity' && whose(e) === 'by-bart';
        tr.appendChild(el('td', {
          class: `la-day la-cancel-run la-cancel-run-${e.kind} la-cancel-${whose(e)}${bart ? ` la-painted${isDark(red) ? ' la-dark' : ''}` : ''}`,
          colSpan: String(b - i + 1),
          style: bart ? `background-color:#${red}` : '',
          title: `${e.label}${e.location ? ` at ${e.location}` : ''} — ${e.start === e.end ? dayLabel(e.start) : `${dayLabel(e.start)} – ${dayLabel(e.end)}`}\n${runText(e)}`
            + (rc.isAdmin() ? '\nClick to give or correct the reason.' : ''),
          dataset: { kind: e.kind, start: e.start, party: e.note?.party || '' },
          onClick: rc.isAdmin() ? () => recordCancellation(e) : null,
        }, runNodes(e)));
        i = b;
      }
      body.appendChild(tr);
    }
    wrap.appendChild(el('div', { class: 'rc-scroll', style: 'max-height:65vh' }, [
      el('table', { class: 'rc-table la-grid la-cancel-grid', dataset: { plain: '1' } }, [head, body]),
    ]));
    return wrap;
  }

  /**
   * Re-derive what every read since the log's start said each day was painted as.
   *
   * `rc_cancelled_days` reads the cells each ingest wrote, and those were written
   * under the rules of the day. Red on a Resource row used to go in with the rest
   * of the row's paint — and over the activity line's own colour — so a week of
   * names marked in red read as a week cancelled. The rule is fixed in
   * `rowsFrom()`; this applies it to the reads already taken. The snapshot is the
   * durable record and `cells` is derived from it, so this rewrites a derivation
   * and nothing else: rows are matched on `row_key` within their own snapshot,
   * and a row the new reading does not produce is left exactly as it was.
   *
   * Reads up to six weeks before the start are included, because a sheet read in
   * August already shows the first weeks of September.
   */
  async function rederiveCancellations(from) {
    const ok = await confirmDialog({
      title: 'Re-read the saved snapshots?',
      message: 'Every read since six weeks before the log starts is read again under today\'s rules, '
        + 'and what each stored row says about each day is rewritten to match. Nothing else changes — '
        + 'not the snapshots, not the change log, not any reason already recorded.',
      confirmLabel: 'Re-read',
    });
    if (!ok) return;

    try {
      const since = toISO(addDays(isoToMs(from), -42));
      const [metas, legendRows] = await Promise.all([rc.listSnapshotMeta({ limit: 1000 }), rc.listLegend()]);
      const legend = legendRows.map((r) => ({ argb: r.argb, meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from }));
      const wanted = metas.filter((m) => String(m.taken_at || '').slice(0, 10) >= since);
      const same = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());

      let changed = 0;
      for (const meta of wanted) {
        const snapshot = await rc.snapshotById(meta.id);
        // A compacted editor reading has no grid to re-read; its rows stand as written.
        if (!snapshot?.grid || snapshot.grid.compacted) continue;
        const view = readGrid(applyLegend(snapshot.grid, legend), { anchorISO: snapshot.taken_at });
        const fresh = new Map((await rowsFrom(view, { snapshotId: snapshot.id })).map((r) => [r.row_key, r]));
        for (const row of await rc.listSnapshotRows(snapshot.id)) {
          const again = fresh.get(row.row_key);
          if (!again || same(again.cells, row.cells)) continue;
          await rc.updateLookaheadRowCells(row.id, again.cells);
          changed++;
        }
      }
      toast({
        tone: 'good',
        title: 'Saved snapshots re-read',
        message: `${wanted.length} read(s) checked, ${changed} row(s) corrected.`,
      });
      notifyChanged('cancellations');
    } catch (err) {
      toast({ tone: 'bad', title: 'Could not re-read the snapshots', message: err.message });
    }
  }

  /** Say whose it was and why — or correct what was said. */
  /**
   * Take a cancellation out of the log — it should never have been in it.
   *
   * The log is derived from the look-ahead, so there is nothing to delete; what
   * is written is a note saying so, attributed and dated, and the event drops out
   * of the list, the calendar, the counts, the exports and the inbox. "Show the
   * removed" lists it again with "Put back".
   */
  function removeCancellation(event) {
    const reason = el('textarea', { class: 'cx-input', rows: 3, placeholder: 'Why it is not a cancellation — e.g. a names row read as an activity' });
    formModal({
      title: 'Remove from the cancellation log?',
      body: el('div', { class: 'cx-form' }, [
        el('p', {
          class: 'rc-hint',
          text: `${event.kind === 'support' ? `${describeCodeCounts(event.resources)} struck out of ` : ''}`
            + `${event.label}${event.location ? ` at ${event.location}` : ''}, `
            + `${event.start === event.end ? dayLabel(event.start) : `${dayLabel(event.start)} – ${dayLabel(event.end)}`}. `
            + 'It leaves the log, the calendar, the counts and the exports. Nothing on the look-ahead changes, '
            + 'and it can be put back.',
        }),
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Why (optional)' }), reason]),
      ]),
      confirmLabel: 'Remove from log',
      onConfirm: async () => {
        await rc.addCancellationNote({
          raw_label: event.label,
          raw_location: event.location,
          la_row_id: event.laRowId || null,
          start_date: event.start,
          end_date: event.end,
          party: event.note?.party || 'Other',
          reason: reason.value.trim() || 'Removed from the log: not a cancellation',
          codes: event.kind === 'support' ? event.codes : null,
          dismissed: true,
          supersedes_id: event.note?.id || null,
        });
        notifyChanged('cancellations');
      },
    });
  }

  /** Count a removed cancellation again: a note superseding the removal. */
  async function restoreCancellation(event) {
    const before = event.history.filter((n) => !n.dismissed).slice(-1)[0] || null;
    await rc.addCancellationNote({
      raw_label: event.label,
      raw_location: event.location,
      la_row_id: event.laRowId || null,
      start_date: event.start,
      end_date: event.end,
      party: before?.party || event.note?.party || 'Other',
      reason: before?.reason || null,
      codes: event.kind === 'support' ? event.codes : null,
      dismissed: false,
      supersedes_id: event.note?.id || null,
    });
    notifyChanged('cancellations');
  }

  function recordCancellation(event) {
    const current = event.note;
    const party = selectInput({
      value: current?.party || CANCEL_PARTIES[0],
      options: CANCEL_PARTIES,
    });
    const reason = el('textarea', { class: 'cx-input', rows: 3, placeholder: 'Why it was cancelled' });
    reason.value = current?.reason || '';

    const support = event.kind === 'support';
    formModal({
      title: current ? 'Correct the cancellation' : support ? `Why was ${event.codes} cancelled?` : 'Why was this cancelled?',
      body: el('div', { class: 'cx-form' }, [
        el('p', {
          class: 'rc-hint',
          text: `${support ? `${describeCodeCounts(event.resources)} struck out of ` : ''}`
            + `${event.label}${event.location ? ` at ${event.location}` : ''}, `
            + `${event.start === event.end ? dayLabel(event.start) : `${dayLabel(event.start)} – ${dayLabel(event.end)}`}. `
            + 'This is the record a claim gets challenged on, so it is attributed and dated and cannot '
            + 'be edited afterwards — a correction is a new entry that supersedes this one.',
        }),
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Responsible party' }), party]),
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Reason' }), reason]),
      ]),
      confirmLabel: current ? 'Record correction' : 'Record',
      onConfirm: async () => {
        const said = reason.value.trim();
        // A correction that says what is already said writes nothing.
        if (current && current.party === party.value && (current.reason || '') === said) return;
        await rc.addCancellationNote({
          raw_label: event.label,
          raw_location: event.location,
          la_row_id: event.laRowId || null,
          start_date: event.start,
          end_date: event.end,
          party: party.value,
          reason: said || null,
          codes: support ? event.codes : null,
          supersedes_id: current?.id || null,
        });
        notifyChanged('cancellations');
      },
    });
  }

  function cancellationCsv(events) {
    const q = (v) => csvField(v, { quote: true });
    const lines = [['activity', 'location', 'kind', 'bart_resources', 'start', 'end', 'days', 'reads', 'first_seen', 'last_seen', 'responsible', 'reason', 'recorded_at'].join(',')];
    for (const e of events) {
      lines.push([
        e.label, e.location, e.kind === 'support' ? 'bart resource' : 'day', describeCodeCounts(e.resources),
        e.start, e.end, e.days, e.reads,
        e.firstSeen || '', e.lastSeen || '', e.note?.party || '', e.note?.reason || '', e.note?.created_at || '',
      ].map(q).join(','));
    }
    return lines.join('\n') + '\n';
  }


  Object.defineProperty(__x, "renderCancellations", { get: () => renderCancellations, enumerable: true });
};

// ui/rc_activity.js
__mods["ui/rc_activity.js"] = function (__x, __req) {
  /**
   * One activity, whole — what opens when somebody taps a task.
   *
   * My day says "IXL Regression Testing, W40, day shift, with Rosa". That is the
   * day; this is the work: every column of the activity's line under the sheet's
   * own headings (Activity ID, Location, SSWP#, Party to Action, Work Hours),
   * and every day from this week on that it carries anything — which shift the
   * paint means, whether it was cancelled, what is written in the cell, and who
   * the names row puts on it, with your own days marked.
   *
   * Read off the latest reading of the look-ahead, the same one the calendar
   * draws. A task is found on it by its row where it can be (the reading and
   * the sheet row it was recorded against) and by the row's exact words where
   * it cannot; one that is no longer on the sheet says so rather than showing
   * something else.
   *
   * Why a day was cancelled is claim evidence and is only readable by an
   * administrator (`rc_cancellation_notes`), so the team sees that it was, and
   * an administrator sees who and why too.
   *
   * Imports: util, rc, core/lookahead, icons, components, rc_util, rc_la_state.
   */

  const { el } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { activityTitle, activityDays } = __req("core/lookahead.js");
  const { openModal, badge, emptyState } = __req("ui/components.js");
  const { parsedView, dayLabel, todayISO, weekStart, isoToMs, goToTab, meMatcher } = __req("ui/rc_util.js");
  const { toISO } = __req("core/dates.js");
  const { la } = __req("ui/rc_la_state.js");

  /** The label a stored look-ahead row carries for an activity: its columns, joined. */
  const labelOf = (activity) => (activity?.meta || []).filter(Boolean).join(' · ');

  /**
   * Open an activity.
   *
   * `row` is an `rc_lookahead_rows` row (or anything with `raw_label`, and
   * `snapshot_id` / `sheet_row` where known). `task` is the fallback wording.
   */
  async function openActivity({ row = null, task = '' } = {}) {
    const [snapshot, legendRows, isMe, notes] = await Promise.all([
      rc.latestSnapshot().catch(() => null),
      rc.listLegend().catch(() => []),
      meMatcher().catch(() => null),
      rc.isAdmin() ? rc.listCancellationNotes().catch(() => []) : Promise.resolve([]),
    ]);
    const label = row?.raw_label || task || '';

    if (!snapshot?.grid?.rows?.length) {
      return openModal({
        title: label || 'Activity',
        body: emptyState({ iconName: 'calendar', title: 'No look-ahead to read', message: 'The look-ahead has not been published yet.' }),
        actions: [{ label: 'Close' }],
      });
    }

    const view = parsedView(snapshot, legendRows);
    /* By its row in this reading where the task was recorded against it — and
       only when that row still says the same thing, so a row number that no
       longer lines up can never open somebody else's activity — then by the
       row's exact words. */
    const byRow = row?.snapshot_id === snapshot.id && row?.sheet_row != null
      ? view.activities.find((a) => a.row === row.sheet_row && !a.heading && !a.absence)
      : null;
    const activity = (byRow && (!label || labelOf(byRow) === label) ? byRow : null)
      || view.activities.find((a) => !a.heading && !a.absence && labelOf(a) === label);

    if (!activity) {
      return openModal({
        title: label || 'Activity',
        body: emptyState({
          iconName: 'calendar',
          title: 'No longer on the look-ahead',
          message: 'This activity is not on the latest reading of the look-ahead. It may have been reworded, finished or removed — the Look-ahead tab has the sheet as it stands.',
        }),
        actions: [{ label: 'Close' }],
      });
    }

    const title = activityTitle(view, activity);
    const from = toISO(weekStart(isoToMs(todayISO())));
    const days = activityDays(view, activity, { fromISO: from, isMe: isMe || (() => false) });
    const today = todayISO();

    /* The columns, under the sheet's own headings. */
    const facts = el('dl', { class: 'rc-activity-facts' });
    activity.meta.forEach((value, i) => {
      if (!value) return;
      const heading = String(view.headings?.[i] || '').trim() || `Column ${i + 1}`;
      facts.append(el('dt', { text: heading }), el('dd', { text: value }));
    });

    /* Why, for the days an administrator has explained. */
    const current = notes.filter((n) => !notes.some((m) => m.supersedes_id === n.id));
    const why = (iso) => current.filter((n) => n.raw_label === labelOf(activity) && iso
      && String(n.start_date).slice(0, 10) <= iso && String(n.end_date).slice(0, 10) >= iso)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;

    const list = el('ol', { class: 'rc-activity-days', 'aria-label': 'Days on this activity' });
    for (const d of days) {
      const note = d.cancelled ? why(d.date) : null;
      list.appendChild(el('li', {
        class: `rc-activity-day${d.mine ? ' rc-activity-mine' : ''}${d.cancelled ? ' rc-activity-cancelled' : ''}${d.date === today ? ' rc-activity-today' : ''}`,
        'aria-current': d.date === today ? 'date' : null,
      }, [
        el('span', { class: 'rc-activity-when', text: d.date ? dayLabel(d.date, 'day') : d.label }),
        el('span', { class: 'rc-activity-shift' }, [
          d.hex ? el('span', { class: 'rc-activity-swatch', style: `background-color:#${d.hex}`, 'aria-hidden': 'true' }) : null,
          el('span', { text: d.cancelled ? 'Cancelled' : (d.meaning || (d.hex ? 'Unexplained colour' : 'Not painted')) }),
        ].filter(Boolean)),
        el('span', { class: 'rc-activity-who' }, [
          d.names.length
            ? el('span', { text: d.names.join(', ') })
            : el('span', { class: 'rc-hint', text: 'Nobody named' }),
          d.mine ? badge('You', 'info') : null,
        ].filter(Boolean)),
        d.text ? el('span', { class: 'rc-activity-text', title: 'Written in the cell', text: d.text }) : null,
        note
          ? el('span', { class: 'rc-activity-why', text: `${note.party}${note.reason ? ` — ${note.reason}` : ''}` })
          : null,
      ].filter(Boolean)));
    }

    const mineCount = days.filter((d) => d.mine).length;
    const body = el('div', { class: 'rc-activity' }, [
      facts,
      el('div', { class: 'rc-activity-sub' }, [
        el('h4', { text: 'From this week on' }),
        el('span', {
          class: 'rc-hint',
          text: days.length
            ? `${days.length} day${days.length === 1 ? '' : 's'}${mineCount ? ` · you are on ${mineCount}` : ''}`
            : '',
        }),
      ]),
      days.length
        ? list
        : el('p', { class: 'rc-hint', text: 'Nothing on this activity from this week on.' }),
    ]);

    return openModal({
      title: title || label || 'Activity',
      subtitle: `As the look-ahead reads now — ${dayLabel(String(snapshot.taken_at).slice(0, 10), 'day')}`,
      size: 'wide',
      body,
      actions: [
        {
          label: 'Show on the look-ahead',
          onClick: () => {
            la.calendarFilter = title;
            la.calendarRow = null;
            la.onlyMine = false;
            la.section = 'calendar';
            la.sectionChosen = true;
            goToTab('lookahead');
          },
        },
        { label: 'Close', kind: 'primary' },
      ],
    });
  }

  Object.defineProperty(__x, "openActivity", { get: () => openActivity, enumerable: true });
};

// core/export_schedule.js
__mods["core/export_schedule.js"] = function (__x, __req) {
  /**
   * When a repeating export is due — the rule alone, no DOM and no clock of its
   * own, so `tools/test_la_edit.js` can walk it across days in Node.
   *
   * A schedule is `{ every, at, weekday, hours }`:
   *   - `every: 'off'`   — never;
   *   - `every: 'day'`   — each day at `at` ("HH:MM", this computer's time);
   *   - `every: 'week'`  — each week on `weekday` (1 Monday … 7 Sunday) at `at`;
   *   - `every: 'hours'` — every `hours` hours since the last run.
   *
   * **A slot missed is run late, once.** The export runs in the page, so it runs
   * only while the calendar is open; a computer that was off at six in the
   * morning exports when somebody opens the calendar at eight, and a week
   * closed does not come back as seven files. What is compared is the latest
   * slot that has passed against the last run: one run covers every slot
   * before it.
   *
   * Imports: nothing.
   */

  const EVERY = ['off', 'day', 'week', 'hours'];

  /** "06:30" → [6, 30], or the fallback when it is not a time. */
  function hoursMinutes(at, fallback = [6, 0]) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(at ?? '').trim());
    if (!m) return fallback;
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h < 24 && min < 60 ? [h, min] : fallback;
  }

  /** A schedule with every field present and in range — what is stored and compared. */
  function cleanSchedule(s = {}) {
    const every = EVERY.includes(s.every) ? s.every : 'off';
    const [h, m] = hoursMinutes(s.at);
    const weekday = Number.isInteger(Number(s.weekday)) && s.weekday >= 1 && s.weekday <= 7 ? Number(s.weekday) : 1;
    const hours = Math.min(168, Math.max(1, Math.round(Number(s.hours) || 24)));
    return { every, at: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, weekday, hours };
  }

  /**
   * The most recent slot at or before `now` (ms), or null for a schedule that
   * has no fixed slots ('off', 'hours'). Local time: "six in the morning" is the
   * clock on this computer's wall, not Greenwich's.
   */
  function lastSlot(schedule, now) {
    const s = cleanSchedule(schedule);
    if (s.every !== 'day' && s.every !== 'week') return null;
    const [h, m] = hoursMinutes(s.at);
    const d = new Date(now);
    const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
    if (s.every === 'day') {
      if (slot.getTime() > now) slot.setDate(slot.getDate() - 1);
      return slot.getTime();
    }
    const weekday = slot.getDay() || 7; // 1 Monday … 7 Sunday
    slot.setDate(slot.getDate() - ((weekday - s.weekday + 7) % 7));
    if (slot.getTime() > now) slot.setDate(slot.getDate() - 7);
    return slot.getTime();
  }

  /** The next slot after `now` (ms) — what the dialog says is coming. Null when off. */
  function nextSlot(schedule, lastRun, now) {
    const s = cleanSchedule(schedule);
    if (s.every === 'off') return null;
    if (s.every === 'hours') return (lastRun ?? now) + s.hours * 3600000;
    const last = lastSlot(s, now);
    const step = new Date(last);
    step.setDate(step.getDate() + (s.every === 'day' ? 1 : 7));
    return step.getTime();
  }

  /**
   * Whether an export is due now: a slot has passed since the last run (or, for
   * 'hours', that many hours have). `lastRun` null means never — and a schedule
   * that has never run waits for its first slot rather than firing the moment
   * it is saved, so `since` (when it was switched on) stands in for it.
   */
  function isDue(schedule, { lastRun = null, since = null } = {}, now) {
    const s = cleanSchedule(schedule);
    if (s.every === 'off') return false;
    const from = lastRun ?? since;
    if (s.every === 'hours') return from == null || now - from >= s.hours * 3600000;
    const slot = lastSlot(s, now);
    return slot != null && (from == null || from < slot);
  }

  Object.defineProperty(__x, "EVERY", { get: () => EVERY, enumerable: true });
  Object.defineProperty(__x, "cleanSchedule", { get: () => cleanSchedule, enumerable: true });
  Object.defineProperty(__x, "lastSlot", { get: () => lastSlot, enumerable: true });
  Object.defineProperty(__x, "nextSlot", { get: () => nextSlot, enumerable: true });
  Object.defineProperty(__x, "isDue", { get: () => isDue, enumerable: true });
};

// ui/rc_master_export.js
__mods["ui/rc_master_export.js"] = function (__x, __req) {
  /**
   * The master export: everything useful the calendar holds, as one Excel
   * workbook — and the same workbook on a schedule, into the shared folder.
   *
   * One sheet per question somebody takes the record away to answer: what the
   * look-ahead said each day, who it names on which shift, what was cancelled
   * and why, what moved between readings and why, the leave, P6, the TAWRs, and
   * the registers that explain the rest. Each sheet is read the way the screen
   * that shows it reads — the same views, the same `assignmentIndex()`, the same
   * `cancellationLog()` — so the workbook and the calendar cannot tell two
   * stories. A sheet that cannot be read is written empty and named in About,
   * never left out silently.
   *
   * It is also how the look-ahead reaches the team: `LookAhead_Latest.xlsx`, the
   * 4WLA beside it (`4WLA_Latest.xlsx`) and the next four weeks on one page
   * (`4WLA_Latest.pdf`) are what a flow on the shared folder (Power Automate,
   * say) picks up and sends on, so nobody needs the application to read it.
   *
   * **The schedule runs here, in the page.** There is no server to run it and
   * nothing is emailed from this application (that is structural), so it runs
   * on the computer the calendar is open on — a browser tab or the desktop app —
   * and a slot missed while it was closed is run once when it next opens
   * (`core/export_schedule.js`). The file goes into `exports/` in the shared
   * folder through the folder's intake door (`filestore.intakeWrite()`); with
   * no folder connected it is downloaded.
   * Its settings are this computer's, because the folder and the clock are.
   */

  const { el } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const filestore = __req("core/filestore.js");
  const { tableWorkbook } = __req("io/xlsx_write.js");
  const { saveFile } = __req("io/exporters.js");
  const { isCancelMeaning, countCodes, describeCodeCounts, ABSENCE_LABELS, absencesFrom } = __req("core/lookahead.js");


  const { p6Index, p6Status } = __req("core/la_p6.js");
  const { FIELDS, addDaysISO, mondayOf } = __req("core/la_edit.js");
  const { describe: describeChange, rowsFrom } = __req("core/la_register.js");
  const { cleanSchedule, isDue, nextSlot } = __req("core/export_schedule.js");
  const { icon } = __req("ui/icons.js");
  const { openModal, toast, checkbox, selectInput, field } = __req("ui/components.js");
  const { todayISO, nameRegister, assignmentIndex, availability, shiftLabel, shiftFor, cancellationLog, parsedView, authorNames } = __req("ui/rc_util.js");



  const { KIND_LABELS } = __req("ui/rc_la_changes.js");
  const { lookaheadFileNow } = __req("ui/rc_la_editor.js");
  const { writtenView } = __req("ui/rc_ingest.js");

  /** The folder, inside the shared one, the workbooks are filed in. */
  const EXPORT_DIR = 'exports';
  /**
   * One name, replaced by every export: a workbook somebody links to — a
   * Power BI source, a SharePoint page, a pivot in another file — keeps working
   * and is always the newest. When it was made is on its About sheet.
   */
  const EXPORT_NAME = 'LookAhead_Latest.xlsx';

  /* The 4WLA as a PDF is drawn by the look-ahead (`lookaheadPdfNow()` in
     `ui/rc_lookahead.js`), which imports this module for its button — so it
     hands the function over when it loads rather than being imported back,
     which the build would refuse as a cycle. */
  /** @type {null | (() => Promise<{ name: string, bytes: Uint8Array } | null>)} */
  let lookaheadPdf = null;
  function provideLookaheadPdf(fn) {
    lookaheadPdf = fn;
  }
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const STORE_KEY = 'cx.rc.masterExport';
  /** How long a scheduled export that failed waits before it is tried again. */
  const RETRY_MS = 30 * 60000;

  /** What can go in, in the order the workbook has it. `reference` is four small sheets. */
  const SHEETS = [
    { id: 'lookahead', label: 'The look-ahead, day by day', hint: 'every activity and day — shift, support asked for and cancelled, who was named, and its P6 activity' },
    { id: 'shifts', label: 'Who is on what', hint: 'who the look-ahead names on which shift, on what and where, and who is away' },
    { id: 'cancellations', label: 'Cancellations', hint: 'every day and BART resource cancelled, with the party responsible and the reason' },
    { id: 'changes', label: 'Changes', hint: 'what moved between readings, and the reason given for it' },
    { id: 'leave', label: 'Leave', hint: 'leave booked' },
    { id: 'p6', label: 'P6 activities', hint: 'the list, and how many look-ahead rows name each activity' },
    { id: 'tawrs', label: 'TAWRs', hint: 'track access work requests' },
    { id: 'reference', label: 'The registers', hint: 'the team, the locations, the legend and the support codes' },
  ];

  const RANGES = [
    { id: 'all', label: 'Everything recorded', weeks: null },
    { id: '4', label: 'The last 4 weeks and everything ahead', weeks: 4 },
    { id: '13', label: 'The last 13 weeks and everything ahead', weeks: 13 },
    { id: '26', label: 'The last 26 weeks and everything ahead', weeks: 26 },
    { id: '52', label: 'The last 52 weeks and everything ahead', weeks: 52 },
    { id: 'custom', label: 'Between two dates', weeks: null },
  ];

  /* ══════════════════════════════════════════════════════════════════════════
     This computer's settings
     ═══════════════════════════════════════════════════════════════════════ */

  /** The defaults: every sheet, everything recorded, the 4WLA beside it, no schedule. */
  function defaults() {
    return {
      sheets: SHEETS.map((s) => s.id),
      range: 'all',
      from: '',
      to: '',
      companion: true,
      pdf: true,
      schedule: cleanSchedule({ every: 'off', at: '06:00', weekday: 1, hours: 24 }),
      since: null,
      lastRun: null,
      failedAt: null,
      last: null,
    };
  }

  function loadSettings() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
    } catch {
      stored = {};
    }
    const base = defaults();
    return {
      ...base,
      ...stored,
      sheets: Array.isArray(stored.sheets) ? stored.sheets.filter((id) => SHEETS.some((s) => s.id === id)) : base.sheets,
      schedule: cleanSchedule(stored.schedule || base.schedule),
    };
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch {
      // No storage: the export still runs now, it just cannot be remembered.
    }
  }

  /** The dates a range asks for; null at either end is "as far as the record goes". */
  function rangeDates(settings, today = todayISO()) {
    const choice = RANGES.find((r) => r.id === settings.range) || RANGES[0];
    if (choice.id === 'custom') {
      return { from: settings.from || null, to: settings.to || null, label: `${settings.from || 'the start'} to ${settings.to || 'the end'}` };
    }
    if (!choice.weeks) return { from: null, to: null, label: 'Everything recorded' };
    return { from: addDaysISO(mondayOf(today), -7 * choice.weeks), to: null, label: choice.label };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Building the workbook
     ═══════════════════════════════════════════════════════════════════════ */

  const weekday = (iso) => (iso
    ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })
    : '');

  /** Every day from one ISO date to another, inclusive. */
  function daysBetween(from, to) {
    const out = [];
    for (let d = from; d && to && d <= to && out.length < 4000; d = addDaysISO(d, 1)) out.push(d);
    return out;
  }


  /**
   * The context every sheet reads from — the registers, read once, and the two
   * heavy reads the look-ahead and shifts sheets share, each made once and only
   * if a sheet asks for it.
   */
  async function context(range) {
    const [people, aliases, locations, categories, parties, legendRows, codes, entries, flags, laRows, settings, leaveKinds] = await Promise.all([
      rc.listPeople({ includeInactive: true }).catch(() => []),
      rc.listPersonAliases().catch(() => []),
      rc.listLocations({ includeInactive: true }).catch(() => []),
      rc.listCategories({ includeInactive: true }).catch(() => []),
      rc.readAll('rc_parties').catch(() => []),
      rc.listLegend({ includeInactive: true }).catch(() => []),
      rc.listSupportCodes({ includeRetired: true }).catch(() => []),
      rc.listP6Activities().catch(() => []),
      rc.listP6Flags({ includeRetired: true }).catch(() => []),
      rc.listLaRows().catch(() => []),
      rc.listSettings().catch(() => []),
      rc.readAll('rc_leave_kinds').catch(() => []),
    ]);
    const once = (fn) => {
      let p = null;
      return () => (p = p || fn());
    };
    const ctx = {
      ...range,
      people,
      locations,
      categories,
      parties,
      legendRows,
      codes,
      p6Entries: entries,
      p6: p6Index(entries, flags),
      laRows,
      settings,
      personById: new Map(people.map((p) => [p.id, p])),
      personByUser: new Map(people.filter((p) => p.user_id).map((p) => [p.user_id, p])),
      locationById: new Map(locations.map((l) => [l.id, l])),
      categoryById: new Map(categories.map((c) => [c.id, c])),
      partyById: new Map(parties.map((p) => [p.id, p])),
      leaveKindById: new Map(leaveKinds.map((k) => [k.id, k])),
      register: nameRegister(people, aliases),
      roleOf: new Map(legendRows.map((l) => [String(l.meaning || ''), l.role || 'shift'])),
      cancelHex: new Set(legendRows.filter((l) => isCancelMeaning(l.meaning)).map((l) => `#${String(l.argb).toUpperCase()}`)),
    };
    ctx.days = once(async () => {
      const read = await rc.lookaheadDays(range.from, range.to);
      if (ctx.source !== 'editor') return read;
      const written = await writtenOnlyDays(ctx, read, range);
      return written.length ? [...read, ...written].sort((a, b) => a.day.localeCompare(b.day)) : read;
    });
    ctx.who = authorNames(people);
    ctx.name = (personId) => (personId ? ctx.personById.get(personId)?.name || '' : '');
    ctx.place = (locationId, raw = '') => (locationId ? ctx.locationById.get(locationId)?.name || raw || '' : raw || '');
    ctx.source = settings.find((r) => r.key === 'lookahead_source')?.value || 'workbook';
    return ctx;
  }

  /**
   * The days written in the calendar that no reading holds, shaped as
   * `rc_lookahead_days` rows.
   *
   * A reading covers the week just gone and the five ahead, so a week written
   * further back than that — the history filled in after the fact — is in the
   * editor's tables and in no reading, and the export left it out. Those weeks,
   * and only those, are drawn through the publish path (`writtenView()` →
   * `rowsFrom()`), the derivation every reading's rows come from, so a week
   * from here and a week from a reading say the same thing in the same words. A
   * week any reading holds is still read from the newest of them. Nothing is
   * stored, and `taken_at` is null: no reading was taken of these.
   */
  async function writtenOnlyDays(ctx, read, range) {
    const span = await rc.laCellSpan().catch(() => ({ first: null, last: null }));
    if (!span.first || !span.last) return [];
    const from = mondayOf(range.from && range.from > span.first ? range.from : span.first);
    const to = range.to && range.to < span.last ? range.to : span.last;
    const covered = new Set(read.map((d) => String(d.week_start).slice(0, 10)));
    const missing = [];
    for (let w = from; w <= to && missing.length < 520; w = addDaysISO(w, 7)) if (!covered.has(w)) missing.push(w);
    if (!missing.length) return [];
    const view = await writtenView(missing[0], addDaysISO(missing[missing.length - 1], 6), ctx.legendRows);
    const resolved = new Map();
    const rows = await rowsFrom(view, {
      locate: async (text) => {
        const key = String(text || '').trim();
        if (!key) return null;
        if (!resolved.has(key)) resolved.set(key, await rc.resolveLocation(key).catch(() => null));
        return resolved.get(key);
      },
    });
    const wanted = new Set(missing);
    const out = [];
    for (const r of rows) {
      if (!wanted.has(r.week_start)) continue;
      for (const day of new Set([...Object.keys(r.cells), ...Object.keys(r.bart_marks), ...Object.keys(r.resources)])) {
        if ((range.from && day < range.from) || (range.to && day > range.to)) continue;
        out.push({
          // One row of the look-ahead in one week, as a reading's row is — the shifts sheet groups by it.
          row_id: `written:${r.la_row_id || r.row_key}:${r.week_start}`,
          snapshot_id: null, taken_at: null, week_start: r.week_start, row_key: r.row_key, sheet_row: r.sheet_row,
          location_id: r.location_id, raw_location: r.raw_location, raw_label: r.raw_label, subsystem: null,
          la_row_id: r.la_row_id, day,
          paint: r.cells[day] ?? null, marks: r.bart_marks[day] ?? null, names: r.resources[day] ?? null,
        });
      }
    }
    return out;
  }

  /** The P6 activity a row names — its Activity ID, or any part of the label as read. */
  function p6Of(ctx, activityId, label) {
    const candidates = [activityId, ...String(label || '').split(' · ')].map((v) => String(v || '').trim()).filter(Boolean);
    for (const c of candidates) {
      const status = p6Status(c, ctx.p6);
      if (status.kind === 'linked' || status.kind === 'flagged') return status;
    }
    return null;
  }

  /** The sections an editor row sits under, outermost first: "Phase 2 › Signals". */
  function sectionsOf(byId, row) {
    const out = [];
    let at = row ? byId.get(row.parent_id) : null;
    for (let guard = 0; at && guard < 10; guard++) {
      if (at.kind === 'section') out.unshift(at.description);
      at = byId.get(at.parent_id);
    }
    return out.filter(Boolean).join(' › ');
  }

  /** Which colour a day was painted, in words — and whether it is a shift, a cancellation or neither. */
  function paintOf(ctx, paint) {
    const said = String(paint || '');
    if (!said) return { words: '', cancelled: false, shift: '' };
    if (said.startsWith('#')) {
      const cancelled = ctx.cancelHex.has(said.toUpperCase());
      return { words: cancelled ? `Cancelled (${said})` : `Colour ${said}, not in the legend`, cancelled, shift: '' };
    }
    const cancelled = isCancelMeaning(said);
    const role = ctx.roleOf.get(said) || 'shift';
    return { words: said, cancelled, shift: !cancelled && role === 'shift' ? shiftLabel(shiftFor(said)) : '' };
  }

  const BUILDERS = {
    async lookahead(ctx) {
      const days = await ctx.days();
      const byId = new Map(ctx.laRows.map((r) => [r.id, r]));
      const fields = FIELDS.map((f) => ({ heading: f.heading, key: f.key }));
      return [{
        name: 'Look-ahead',
        columns: [
          { heading: 'Date', kind: 'date' }, { heading: 'Day' }, { heading: 'Week starting', kind: 'date' },
          { heading: 'Section' },
          ...fields.map((f) => ({ heading: f.heading, wrap: f.key === 'description', width: f.key === 'description' ? 48 : undefined })),
          { heading: 'Activity, as read', width: 48 },
          { heading: 'P6 activity ID' }, { heading: 'P6 activity name', width: 40 }, { heading: 'P6 WBS' },
          { heading: 'Not in P6 — reason' },
          { heading: 'Location (register)' }, { heading: 'Subsystem' },
          { heading: 'Painted as' }, { heading: 'Shift' }, { heading: 'Cancelled' },
          { heading: 'Support asked for' }, { heading: 'Support cancelled' },
          { heading: 'Names on the day', width: 32 },
          { heading: 'From the reading of', kind: 'datetime' },
          { heading: 'Source' },
        ],
        rows: days.map((d) => {
          const row = d.la_row_id ? byId.get(d.la_row_id) : null;
          const p6 = p6Of(ctx, row?.activity_id, d.raw_label);
          const paint = paintOf(ctx, d.paint);
          return [
            d.day, weekday(d.day), d.week_start, row ? sectionsOf(byId, row) : '',
            ...fields.map((f) => (row ? row[f.key] || '' : '')),
            d.raw_label || '',
            p6?.kind === 'linked' ? p6.entry.activity_id : '',
            p6?.kind === 'linked' ? p6.entry.name : '',
            p6?.kind === 'linked' ? p6.entry.wbs || '' : '',
            p6?.kind === 'flagged' ? p6.flag.label : '',
            ctx.place(d.location_id, ''), d.subsystem || '',
            paint.words, paint.shift, paint.words ? paint.cancelled : '',
            describeCodeCounts(countCodes([d.marks || ''])),
            describeCodeCounts(countCodes([d.marks || ''], { cancelled: true })),
            d.names || '',
            d.taken_at || '',
            d.taken_at ? 'A reading' : 'The calendar as written — no reading has this week',
          ];
        }),
        empty: 'No reading covers these dates.',
      }];
    },

    async shifts(ctx) {
      const [leave, latest, days] = await Promise.all([
        rc.readAll('rc_leave', { column: 'start_date' }),
        rc.latestSnapshot().catch(() => null),
        ctx.days(),
      ]);
      /* The look-ahead's rows, rebuilt from the days: what `assignmentIndex()`
         takes, a day stored as the bare red of a cancellation named as one. */
      const rows = new Map();
      for (const d of days) {
        const row = rows.get(d.row_id) || {
          id: d.row_id, raw_label: d.raw_label, raw_location: d.raw_location, location_id: d.location_id,
          week_start: d.week_start, cells: {}, resources: {}, bart_marks: {},
        };
        if (d.paint) row.cells[d.day] = ctx.cancelHex.has(String(d.paint).toUpperCase()) ? 'Cancellation' : d.paint;
        if (d.names) row.resources[d.day] = d.names;
        if (d.marks) row.bart_marks[d.day] = d.marks;
        rows.set(d.row_id, row);
      }
      // The PTO row is read off the latest reading only, as the PTO calendar reads it.
      const absences = latest?.grid ? absencesFrom(parsedView(latest, ctx.legendRows)) : [];
      const index = assignmentIndex({ planRows: [], laRows: [...rows.values()], register: ctx.register, absences, categories: ctx.categories });

      const dates = days.map((d) => d.day).filter(Boolean).sort();
      const from = ctx.from || dates[0];
      const to = ctx.to || [dates[dates.length - 1], todayISO()].filter(Boolean).sort().pop();
      const out = [];
      for (const iso of daysBetween(from, to)) {
        for (const person of ctx.people) {
          const entries = index.on(person.id, iso);
          for (const entry of entries) {
            out.push([
              iso, weekday(iso), person.name, person.subsystem || '',
              entry.absence ? '' : shiftLabel(entry.shift || 'day'),
              entry.task || (entry.absence ? ABSENCE_LABELS[entry.absence] : ''),
              ctx.place(entry.location_id, entry.raw_location),
              entry.absence ? 'The look-ahead\'s PTO / Office / Other row' : 'The look-ahead',
              Boolean(entry.cancelled),
            ]);
          }
          if (entries.length) continue;
          const free = availability(person, iso, leave);
          if (free.state === 'leave' && free.leave) {
            out.push([iso, weekday(iso), person.name, person.subsystem || '', '',
              `Leave — ${ctx.leaveKindById.get(free.leave.kind_id)?.name || 'leave'}`, '', 'Booked leave', false]);
          }
        }
      }
      return [{
        name: 'Who is on what',
        columns: [
          { heading: 'Date', kind: 'date' }, { heading: 'Day' }, { heading: 'Person' }, { heading: 'Subsystem' },
          { heading: 'Shift' }, { heading: 'Activity or task', width: 48 }, { heading: 'Location' },
          { heading: 'From' }, { heading: 'Cancelled' },
        ],
        rows: out,
        empty: 'Nobody is named on the look-ahead in these dates.',
      }];
    },

    async cancellations(ctx) {
      const events = (await cancellationLog(ctx.from || '2000-01-01')).filter((e) => !ctx.to || e.start <= ctx.to);
      return [{
        name: 'Cancellations',
        columns: [
          { heading: 'From', kind: 'date' }, { heading: 'To', kind: 'date' }, { heading: 'Days', kind: 'number' },
          { heading: 'What' }, { heading: 'Activity', width: 48 }, { heading: 'Location' },
          { heading: 'Resources cancelled' }, { heading: 'Responsible party' }, { heading: 'Reason', width: 48, wrap: true },
          { heading: 'Logged by' }, { heading: 'Logged at', kind: 'datetime' },
          { heading: 'Readings that showed it', kind: 'number' }, { heading: 'First seen', kind: 'datetime' }, { heading: 'Last seen', kind: 'datetime' },
          { heading: 'Removed from the log' },
        ],
        rows: events.map((e) => [
          e.start, e.end, e.days, e.kind === 'support' ? 'BART resource cancelled' : 'Activity cancelled',
          e.label || '', e.location || '', describeCodeCounts(e.resources), e.note?.party || '', e.note?.reason || '',
          ctx.who(e.note?.author), e.note?.created_at || '', e.reads || 0, e.firstSeen || '', e.lastSeen || '', Boolean(e.dismissed),
        ]),
        empty: 'Nothing was cancelled in these dates.',
      }];
    },

    async changes(ctx) {
      const [events, notes] = await Promise.all([
        rc.readAll('rc_change_events', { column: 'detected_at', from: ctx.from, to: ctx.to ? `${ctx.to}T23:59:59` : null }),
        rc.readAll('rc_change_annotations').catch(() => []),
      ]);
      // The newest annotation for each event is the answer; the ones under it are its history.
      const said = new Map();
      for (const a of [...notes].sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))) said.set(a.change_event_id, a);
      return [{
        name: 'Changes',
        columns: [
          { heading: 'Detected', kind: 'datetime' }, { heading: 'Week starting', kind: 'date' }, { heading: 'Kind' },
          { heading: 'What changed', width: 60, wrap: true }, { heading: 'Location' },
          { heading: 'Reason given', width: 48, wrap: true }, { heading: 'Party' }, { heading: 'Noted as' }, { heading: 'Noted by' },
        ],
        rows: events.map((e) => {
          const a = said.get(e.id);
          return [
            e.detected_at, e.week_start || '', KIND_LABELS[e.kind] || e.kind,
            describeChange({ ...e, weekStart: e.week_start, rowKey: e.row_key }), ctx.place(e.location_id, ''),
            a?.note || '', a?.party_id ? ctx.partyById.get(a.party_id)?.name || '' : '', a?.kind || '', ctx.who(a?.author),
          ];
        }),
        empty: 'No change was recorded in these dates.',
      }];
    },

    async leave(ctx) {
      const rows = (await rc.readAll('rc_leave', { column: 'start_date' }))
        .filter((l) => (!ctx.from || l.end_date >= ctx.from) && (!ctx.to || l.start_date <= ctx.to));
      const span = (l) => Math.round((Date.parse(l.end_date) - Date.parse(l.start_date)) / 86400000) + 1;
      return [{
        name: 'Leave',
        columns: [
          { heading: 'Person' }, { heading: 'Kind' }, { heading: 'From', kind: 'date' }, { heading: 'To', kind: 'date' },
          { heading: 'Calendar days', kind: 'number' }, { heading: 'Status' }, { heading: 'First day' }, { heading: 'Last day' },
          { heading: 'Note', width: 40, wrap: true }, { heading: 'Booked', kind: 'datetime' },
        ],
        rows: rows.map((l) => [
          ctx.name(l.person_id), ctx.leaveKindById.get(l.kind_id)?.name || '', l.start_date, l.end_date, span(l),
          l.status || '', l.start_portion || '', l.end_portion || '', l.note || '', l.created_at,
        ]),
        empty: 'No leave in these dates.',
      }];
    },

    async p6(ctx) {
      const uses = new Map();
      for (const r of ctx.laRows) {
        if (r.kind !== 'activity' || r.archived) continue;
        const status = p6Status(r.activity_id, ctx.p6);
        if (status.kind === 'linked') uses.set(status.entry.activity_id, (uses.get(status.entry.activity_id) || 0) + 1);
      }
      return [{
        name: 'P6 activities',
        columns: [
          { heading: 'Activity ID' }, { heading: 'Activity name', width: 48 }, { heading: 'WBS', width: 32 },
          { heading: 'In the latest extract' }, { heading: 'Look-ahead rows naming it', kind: 'number' },
          { heading: 'Imported', kind: 'datetime' },
        ],
        rows: ctx.p6Entries.map((e) => [e.activity_id, e.name || '', e.wbs || '', !e.missing, uses.get(e.activity_id) || 0, e.imported_at || '']),
        empty: 'No P6 extract has been imported — Look-ahead → P6 activities.',
      }];
    },

    async tawrs(ctx) {
      const rows = (await rc.listTawrsFrom(ctx.from || '2000-01-01')).filter((t) => !ctx.to || t.week_start <= ctx.to);
      return [{
        name: 'TAWRs',
        columns: [
          { heading: 'Week starting', kind: 'date' }, { heading: 'First day', kind: 'date' }, { heading: 'Location' },
          { heading: 'Shift' }, { heading: 'Status' }, { heading: 'Created', kind: 'datetime' }, { heading: 'Created by' },
          { heading: 'Approved', kind: 'datetime' }, { heading: 'Approved by' },
        ],
        rows: rows.map((t) => [
          t.week_start, t.first_day || '', t.location_name || ctx.place(t.location_id, ''), shiftLabel(t.shift), t.status || '',
          t.created_at, ctx.who(t.created_by), t.approved_at || '', ctx.who(t.approved_by),
        ]),
        empty: 'No TAWR in these dates.',
      }];
    },

    async reference(ctx) {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return [
        {
          name: 'Team',
          columns: [
            { heading: 'Name' }, { heading: 'Email' }, { heading: 'Title' }, { heading: 'Subsystem' },
            { heading: 'Takes shifts' }, { heading: 'Active' }, { heading: 'Working days' },
          ],
          rows: ctx.people.map((p) => [
            p.name, p.email || '', p.title || '', p.subsystem || '', p.scheduled !== false, p.active !== false,
            (Array.isArray(p.working_days) ? p.working_days : [1, 2, 3, 4, 5]).map((d) => days[d - 1]).filter(Boolean).join(' '),
          ]),
        },
        {
          name: 'Locations',
          columns: [{ heading: 'Name' }, { heading: 'Code' }, { heading: 'Active' }],
          rows: ctx.locations.map((l) => [l.name, l.code || '', l.active !== false]),
        },
        {
          name: 'Legend',
          columns: [{ heading: 'Colour' }, { heading: 'Meaning' }, { heading: 'Role' }, { heading: 'In force from', kind: 'date' }, { heading: 'Active' }],
          rows: ctx.legendRows.map((l) => [`#${l.argb}`, l.meaning || '', l.role || 'shift', l.valid_from || '', l.active !== false]),
        },
        {
          name: 'Support codes',
          columns: [{ heading: 'Code' }, { heading: 'Name' }, { heading: 'Party' }, { heading: 'Active' }],
          rows: ctx.codes.map((c) => [c.code, c.name || '', c.party || 'BART', c.active !== false]),
        },
      ];
    },
  };

  const NAMES = {
    lookahead: ['Look-ahead'], shifts: ['Who is on what'], cancellations: ['Cancellations'], changes: ['Changes'],
    leave: ['Leave'], p6: ['P6 activities'], tawrs: ['TAWRs'], reference: ['Team', 'Locations', 'Legend', 'Support codes'],
  };

  /**
   * The workbook, from what `settings` asks for. Returns `{ bytes, name,
   * sheets, failed, companion }`: `sheets` is what went in and how many rows
   * each has, `failed` what could not be read and why, and `companion` the 4WLA
   * in its own layout when it was asked for and the look-ahead is written here.
   */
  async function buildMasterExport(settings = loadSettings(), { now = new Date() } = {}) {
    const range = rangeDates(settings);
    const ctx = await context(range);
    const wanted = SHEETS.filter((s) => settings.sheets.includes(s.id));
    const sheets = [];
    const failed = [];
    /* One at a time, in order, and each on its own: a sheet that cannot be
       read is written empty and named, never allowed to lose the rest. */
    for (const want of wanted) {
      try {
        sheets.push(...await BUILDERS[want.id](ctx));
      } catch (err) {
        failed.push({ id: want.id, label: want.label, message: err.message });
        for (const name of NAMES[want.id]) sheets.push({ name, columns: [{ heading: name }], rows: [], empty: `Could not be read: ${err.message}` });
      }
    }

    const about = {
      name: 'About',
      columns: [{ heading: 'Item', width: 28 }, { heading: 'Value', width: 40 }, { heading: 'Detail', width: 90, wrap: true }],
      rows: [
        ['Exported', now.toLocaleString(), now.toISOString()],
        ['Exported by', rc.me()?.name || '', ''],
        ['Dates', range.label, range.from || range.to ? `${range.from || 'the start'} to ${range.to || 'the end'}` : ''],
        ['The look-ahead is written in', ctx.source === 'editor' ? 'The calendar (Edit)' : 'The workbook', ''],
        ['How a day of the look-ahead is read', 'The newest reading of its week', 'Each week comes from the newest reading taken of it — '
          + 'so a week the window has rolled past keeps the last reading that had it, and older readings '
          + 'of the same week are still on the record in the calendar. A week written in the calendar that no reading has — '
          + 'further back than the week just gone, filled in afterwards — comes from the calendar as written, and says so in its Source column.'],
        ['', '', ''],
        ['Sheet', 'Rows', 'What it holds'],
        ...sheets.map((s) => {
          const meta = SHEETS.find((x) => NAMES[x.id].includes(s.name));
          const fail = failed.find((f) => NAMES[f.id].includes(s.name));
          return [s.name, fail ? 'Could not be read' : String(s.rows.length), fail ? fail.message : meta?.hint || ''];
        }),
      ],
    };
    const bytes = await tableWorkbook({ sheets: [about, ...sheets], title: 'CX Timeline — master export' });

    let companion = null;
    if (settings.companion) companion = await lookaheadFileNow({ from: range.from, to: range.to }).catch(() => null);

    /* The next four weeks on one page, for whoever it is sent to. A PDF that
       cannot be drawn never costs the workbook; it is named among what failed. */
    let pdf = null;
    if (settings.pdf && lookaheadPdf) {
      try {
        pdf = await lookaheadPdf();
      } catch (err) {
        failed.push({ id: 'pdf', label: 'the 4WLA PDF', message: err.message });
      }
    }

    return {
      bytes,
      name: EXPORT_NAME,
      sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length })),
      failed,
      companion,
      pdf,
    };
  }

  /**
   * Put the workbook — and the 4WLA beside it — where it goes: `exports/` in
   * the shared folder when one is connected, the downloads folder otherwise.
   */
  async function deliver(result) {
    if (filestore.hasFolder?.()) {
      /* Written under the same name, so the last export is replaced, not kept
         beside. Windows will not replace a workbook somebody has open in Excel,
         and the error it gives says nothing of the sort — so it is said here. */
      const replace = async (name, bytes) => {
        try {
          await filestore.intakeWrite(`${EXPORT_DIR}/${name}`, bytes);
        } catch (err) {
          throw new Error(`${EXPORT_DIR}/${name} could not be replaced — if it is open in Excel, close it and export again `
            + `(a scheduled export tries again by itself). ${err.message}`);
        }
      };
      await replace(result.name, result.bytes);
      if (result.companion) await replace(result.companion.name, result.companion.bytes);
      if (result.pdf) await replace(result.pdf.name, result.pdf.bytes);
      return { where: 'folder', path: `${EXPORT_DIR}/${result.name}`, pdfPath: result.pdf ? `${EXPORT_DIR}/${result.pdf.name}` : null };
    }
    saveFile(result.name, result.bytes, XLSX, 'Master export');
    if (result.companion) saveFile(result.companion.name, result.companion.bytes, XLSX, '4WLA');
    if (result.pdf) saveFile(result.pdf.name, result.pdf.bytes, 'application/pdf', '4WLA PDF');
    return { where: 'download', path: result.name, pdfPath: result.pdf ? result.pdf.name : null };
  }

  /** Build, deliver, and remember how it went. */
  async function runMasterExport(settings = loadSettings()) {
    const result = await buildMasterExport(settings);
    const went = await deliver(result);
    const rows = result.sheets.reduce((n, s) => n + s.rows, 0);
    saveSettings({ ...loadSettings(), last: { at: Date.now(), ...went, rows, failed: result.failed.length } });
    return { ...result, ...went, rows };
  }

  function saidWhere(out) {
    const also = out.pdfPath ? `, and ${out.pdfPath}` : '';
    return out.where === 'folder' ? `Saved to the shared folder — ${out.path}${also}` : `Downloaded — ${out.path}${also}`;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The schedule
     ═══════════════════════════════════════════════════════════════════════ */

  let started = false;
  let running = false;

  /**
   * Look once a minute for an export that is due, on this computer. Started
   * when the calendar starts, and acting only while it is open — which is the
   * whole of what a page can promise. Holding the pen is not needed: the export
   * reads the calendar and writes only into `exports/`.
   */
  function startScheduledExports() {
    if (started) return;
    started = true;
    setTimeout(() => { scheduledTick(); }, 20000);
    setInterval(() => { scheduledTick(); }, 60000);
  }

  async function scheduledTick(now = Date.now()) {
    if (running || !rc.isSignedIn()) return false;
    const s = loadSettings();
    if (!isDue(s.schedule, { lastRun: s.lastRun, since: s.since }, now)) return false;
    if (s.failedAt && now - s.failedAt < RETRY_MS) return false;
    /* Claimed before it runs, so a second tab looking a moment later finds it
       done rather than exporting the same thing twice. */
    saveSettings({ ...s, lastRun: now });
    running = true;
    try {
      const out = await runMasterExport(s);
      saveSettings({ ...loadSettings(), lastRun: now, failedAt: null });
      toast({ tone: out.failed.length ? 'warn' : 'info', title: 'Scheduled master export', message: saidWhere(out), timeout: 6000 });
      return true;
    } catch (err) {
      saveSettings({ ...loadSettings(), lastRun: s.lastRun, failedAt: now });
      rc.reportError('master-export:scheduled', err);
      toast({ tone: 'bad', title: 'The scheduled master export failed', message: `${err.message} — it is tried again in half an hour.`, timeout: 12000 });
      return false;
    } finally {
      running = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The dialog
     ═══════════════════════════════════════════════════════════════════════ */

  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  function when(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function openMasterExport() {
    const s = loadSettings();
    const boxes = SHEETS.map((sheet) => {
      const box = checkbox({ label: `${sheet.label} — ${sheet.hint}`, checked: s.sheets.includes(sheet.id) });
      box.dataset.sheet = sheet.id;
      box.classList.add('rc-mx-sheet');
      return box;
    });
    const range = selectInput({ value: s.range, options: RANGES.map((r) => ({ value: r.id, label: r.label })) });
    const from = el('input', { type: 'date', class: 'cx-input', value: s.from || '' });
    const to = el('input', { type: 'date', class: 'cx-input', value: s.to || '' });
    const dates = el('div', { class: 'rc-mx-dates' }, [field('From', from), field('To', to)]);
    const companion = checkbox({ label: 'Also the 4WLA in its own layout — every week written in these dates, as Export to Excel makes it', checked: s.companion });
    const pdf = checkbox({
      label: 'Also the 4WLA as a PDF — the next four weeks on one A3 page, as Export PDF draws it, saved as 4WLA_Latest.pdf',
      checked: s.pdf,
    });
    pdf.classList.add('rc-mx-pdf');

    const every = selectInput({
      value: s.schedule.every,
      options: [
        { value: 'off', label: 'Only when I press Export now' },
        { value: 'day', label: 'Every day' },
        { value: 'week', label: 'Every week' },
        { value: 'hours', label: 'Every few hours' },
      ],
    });
    every.classList.add('rc-mx-every');
    const at = el('input', { type: 'time', class: 'cx-input rc-mx-at', value: s.schedule.at });
    const day = selectInput({ value: String(s.schedule.weekday), options: WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d })) });
    const hours = el('input', { type: 'number', class: 'cx-input rc-mx-hours', min: '1', max: '168', value: String(s.schedule.hours) });
    const atField = field('At', at);
    const dayField = field('On', day);
    const hoursField = field('Every how many hours', hours);
    const status = el('p', { class: 'rc-hint rc-mx-status' });

    const read = () => ({
      ...loadSettings(),
      sheets: boxes.filter((b) => b.querySelector('input').checked).map((b) => b.dataset.sheet),
      range: range.value,
      from: from.value,
      to: to.value,
      companion: companion.querySelector('input').checked,
      pdf: pdf.querySelector('input').checked,
      schedule: cleanSchedule({ every: every.value, at: at.value, weekday: Number(day.value), hours: Number(hours.value) }),
    });
    const show = () => {
      dates.hidden = range.value !== 'custom';
      atField.hidden = every.value !== 'day' && every.value !== 'week';
      dayField.hidden = every.value !== 'week';
      hoursField.hidden = every.value !== 'hours';
      const now = Date.now();
      const next = read();
      const last = s.last ? `Last export ${when(s.last.at)} — ${s.last.where === 'folder' ? `into the shared folder, ${s.last.path}` : 'downloaded'}. ` : 'Not exported from this computer yet. ';
      const coming = next.schedule.every === 'off' ? ''
        : `Next ${when(nextSlot(next.schedule, s.lastRun ?? s.since ?? now, now))}.`;
      status.textContent = last + coming;
    };
    for (const c of [range, every, at, day, hours]) c.addEventListener('change', show);
    show();

    const save = () => {
      const next = read();
      const was = loadSettings();
      const changed = JSON.stringify(was.schedule) !== JSON.stringify(next.schedule);
      // Switched on or changed now: the first export is at the next slot, not this minute.
      if (changed) { next.since = Date.now(); next.lastRun = null; next.failedAt = null; }
      saveSettings(next);
      return next;
    };

    const folder = filestore.hasFolder?.();
    openModal({
      title: 'Master export',
      subtitle: 'Everything useful the calendar holds, as one Excel workbook',
      body: el('div', { class: 'cx-form rc-mx-form' }, [
        el('div', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'What goes in — a sheet each' }), el('div', { class: 'rc-mx-sheets' }, boxes)]),
        field('Dates', range),
        dates,
        companion,
        pdf,
        el('p', {
          class: 'rc-hint rc-mx-where',
          text: folder
            ? `Saved as ${EXPORT_DIR}/${EXPORT_NAME} in the shared folder, replacing the last one — on a synced folder it reaches everybody who has it.`
            : `Downloaded to this computer as ${EXPORT_NAME}. A browser never overwrites a download, so a second one arrives as `
              + `"LookAhead_Latest (1).xlsx" — open the shared folder in the timeline and it is saved into ${EXPORT_DIR}/ there, replacing the last.`,
        }),
        field('On a schedule', every),
        el('div', { class: 'rc-mx-when' }, [dayField, atField, hoursField]),
        el('p', {
          class: 'rc-hint',
          text: 'A schedule runs on this computer, while the calendar is open on it — in a browser tab or the desktop app. '
            + 'A time missed while it was closed is exported once, the next time it opens.',
        }),
        status,
      ]),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Save', onClick: () => {
            const next = save();
            toast({ message: next.schedule.every === 'off' ? 'Saved. Nothing is exported on a schedule.' : 'Saved. The schedule runs while the calendar is open here.' });
          },
        },
        {
          label: 'Export now', kind: 'primary', autofocus: true, onClick: () => {
            const next = save();
            if (!next.sheets.length) {
              toast({ message: 'Tick at least one sheet to export.' });
              return false;
            }
            toast({ message: 'Building the master export…', timeout: 3000 });
            runMasterExport(next).then((out) => {
              toast({
                tone: out.failed.length ? 'warn' : 'good',
                title: `Master export — ${out.rows.toLocaleString()} rows on ${out.sheets.length} sheets`,
                message: saidWhere(out) + (out.failed.length ? ` · could not read: ${out.failed.map((f) => f.label).join(', ')}` : ''),
                timeout: 9000,
              });
            }).catch((err) => {
              rc.reportError('master-export', err);
              toast({ tone: 'bad', message: `The master export failed — ${err.message}`, timeout: 12000 });
            });
            return undefined;
          },
        },
      ],
    });
  }

  /** The button that opens it — the same everywhere it is offered. */
  function masterExportButton() {
    return el('button', {
      class: 'cx-btn mini primary rc-master-export',
      type: 'button',
      html: icon('download', { size: 12 }) + '<span>Master export</span>',
      title: 'Everything useful the calendar holds, as one Excel workbook — now, or on a schedule',
      onClick: () => openMasterExport(),
    });
  }

  Object.defineProperty(__x, "EXPORT_DIR", { get: () => EXPORT_DIR, enumerable: true });
  Object.defineProperty(__x, "EXPORT_NAME", { get: () => EXPORT_NAME, enumerable: true });
  Object.defineProperty(__x, "provideLookaheadPdf", { get: () => provideLookaheadPdf, enumerable: true });
  Object.defineProperty(__x, "SHEETS", { get: () => SHEETS, enumerable: true });
  Object.defineProperty(__x, "RANGES", { get: () => RANGES, enumerable: true });
  Object.defineProperty(__x, "loadSettings", { get: () => loadSettings, enumerable: true });
  Object.defineProperty(__x, "rangeDates", { get: () => rangeDates, enumerable: true });
  Object.defineProperty(__x, "buildMasterExport", { get: () => buildMasterExport, enumerable: true });
  Object.defineProperty(__x, "runMasterExport", { get: () => runMasterExport, enumerable: true });
  Object.defineProperty(__x, "startScheduledExports", { get: () => startScheduledExports, enumerable: true });
  Object.defineProperty(__x, "scheduledTick", { get: () => scheduledTick, enumerable: true });
  Object.defineProperty(__x, "openMasterExport", { get: () => openMasterExport, enumerable: true });
  Object.defineProperty(__x, "masterExportButton", { get: () => masterExportButton, enumerable: true });
};

// ui/rc_lookahead.js
__mods["ui/rc_lookahead.js"] = function (__x, __req) {
  /**
   * The four-week look-ahead, and everything read against it.
   *
   * The look-ahead is written here, in the editor, and every reading of it is
   * kept: the calendar draws the newest, the cancellation log and the Changes
   * list compare them, and the legend and the P6 list are what they are read
   * against. All of it is in the shared folder (`core/rc.js`).
   *
   * Imports: util, events, dates, rc, filestore, io/lookahead, core/lookahead,
   *          core/la_edit, core/la_p6, icons, components, rc_util.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { isDark } = __req("io/lookahead.js");
  const { calendarPdf, calendarFit, PAGE_CHOICES } = __req("io/rc_pdf.js");
  const { saveFile } = __req("io/exporters.js");
  const { marksOf, ABSENCE_LABELS, isCancelMeaning, rowsNaming, resourceNames, cancellationNoteFor, cancellationReasonText, mergeViews } = __req("core/lookahead.js");



  const { mondayOf, addDaysISO } = __req("core/la_edit.js");
  const { p6Index, p6Status } = __req("core/la_p6.js");
  const { icon } = __req("ui/icons.js");
  const { selectInput, textInput, toast, emptyState, field, checkbox } = __req("ui/components.js");
  const { notifyChanged, dayLabel, todayISO, formModal, parsedView, viewOfSnapshot, foldName, meMatcher, codeNodes, watchForNewReading, penButton } = __req("ui/rc_util.js");




  const { la, WEEK_CHOICES } = __req("ui/rc_la_state.js");
  const { checkNowButton, lookaheadSource, EDITOR_SOURCE, writtenView } = __req("ui/rc_ingest.js");
  const { renderEditor, flushEditor, openExcelExport } = __req("ui/rc_la_editor.js");
  const { renderLegend } = __req("ui/rc_la_legend.js");
  const { renderChanges, renderSnapshots } = __req("ui/rc_la_changes.js");
  const { renderCancellations } = __req("ui/rc_la_cancellations.js");
  const { renderP6, p6Words } = __req("ui/rc_la_p6.js");
  const { openActivity } = __req("ui/rc_activity.js");
  const { masterExportButton, provideLookaheadPdf } = __req("ui/rc_master_export.js");

  const SECTIONS = ['calendar', 'cancellations', 'changes', 'snapshots', 'legend', 'p6'];

  async function render(root) {
    /* The calendar is the team's; the register around it is not.
       The 4WLA is what the field team is being asked to do, and this whole tab
       used to be administrators-only — so the people named on it were the only
       people who could not look at it, and asked their manager for a screenshot.
       They get the calendar, and read-only: the Changes list, the snapshot
       history and the SARs are the evidence base for a delay claim, they are
       restricted in the *policies* rather than here, and a section that would
       come back empty is a door onto a wall. */
    const admin = rc.isAdmin();
    la.source = await lookaheadSource();
    /* The editor is the calendar with Edit switched on, not a section beside it.
       Two grids of the same four weeks meant an edit had to be carried from one
       to the other, and the calendar could be looked at before it arrived. The
       editor is an administrator's — the look-ahead is written by the two people
       who own it — so for anybody else the switch is not there and never on. */
    if (la.section === 'editor') { la.section = 'calendar'; la.editing = true; }
    if (!admin) la.editing = false;
    const sections = admin ? SECTIONS : ['calendar'];
    if (!sections.includes(la.section)) la.section = sections[0];

    const nav = el('div', { class: 'rc-tabs', style: 'margin:0 0 16px' });
    for (const id of sections) {
      nav.appendChild(el('button', {
        class: 'rc-tab',
        type: 'button',
        text: {
          calendar: 'Calendar', cancellations: 'Cancellations', changes: 'Changes',
          snapshots: 'Snapshots', legend: 'Legend', p6: 'P6 activities',
        }[id],
        'aria-pressed': String(id === la.section),
        onClick: async () => {
          // Leaving the editor publishes what it holds first, so the section
          // being opened reads the look-ahead as it now stands.
          if (la.section === 'calendar' && la.editing && id !== 'calendar') await flushEditor();
          la.section = id;
          la.sectionChosen = true;
          clear(root);
          render(root);
        },
      }));
    }
    if (sections.length > 1) root.appendChild(nav);

    const host = el('div');
    root.appendChild(host);

    if (la.section === 'calendar') await (la.editing ? renderEditing(host) : renderCalendar(host));
    else if (la.section === 'cancellations') await renderCancellations(host);
    else if (la.section === 'changes') await renderChanges(host);
    else if (la.section === 'snapshots') await renderSnapshots(host);
    else if (la.section === 'legend') await renderLegend(host);
    else await renderP6(host);
  }

  /**
   * The switch between reading the calendar and writing it.
   *
   * Switching off saves and publishes first and waits for both, so the calendar
   * it opens onto is the one just written — never the reading from a moment
   * before, which is how a row taken off in the editor stayed on the calendar.
   */
  function editSwitch() {
    const on = la.editing;
    return el('button', {
      class: `cx-btn mini${on ? ' primary' : ''} la-edit-switch`,
      type: 'button',
      'aria-pressed': String(on),
      title: on ? 'Save, publish, and go back to reading the calendar' : 'Edit the look-ahead in place',
      html: icon(on ? 'check' : 'edit', { size: 12 }) + `<span>${on ? 'Done editing' : 'Edit'}</span>`,
      onClick: async (e) => {
        const btn = e.currentTarget;
        /* Writing the look-ahead needs the pen. Somebody else holding it is
           said here, where it is wanted; Take over editing sits beside this. */
        if (!on && !rc.canWrite()) {
          const { holder } = rc.penState();
          toast({
            tone: 'warn',
            message: holder
              ? `${holder} is editing the calendar. Press Take over editing beside Edit to edit it here.`
              : 'The calendar is read-only here because you handed it back. Press Take over editing beside Edit first.',
            timeout: 8000,
          });
          return;
        }
        btn.disabled = true;
        try {
          if (on) await flushEditor();
        } catch (err) {
          /* Stay in the editor: switching to the calendar now would draw an
             older reading than the one on screen, as if the edits were lost. */
          rc.reportError('lookahead:publish', err);
          toast({ tone: 'bad', message: `Not published yet — ${err.message}`, timeout: 10000 });
          btn.disabled = false;
          return;
        }
        la.editing = !on;
        notifyChanged('lookahead');
      },
    });
  }

  /** The calendar with Edit on: the same heading, then the editor in full. */
  async function renderEditing(host) {
    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'The look-ahead' }),
      el('div', { class: 'rc-section-actions' }, [penButton(), editSwitch()]),
    ]));
    const body = el('div');
    host.appendChild(body);
    await renderEditor(body);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The calendar
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The look-ahead as it looks: activities down, days across, cells in the
   * colours the workbook painted them.
   *
   * This draws the *snapshot*, not the file — the file is in a folder the
   * browser may not have, and the whole point of snapshotting was that the
   * record has to survive without it. The legend is re-applied here rather than
   * being read from the snapshot, so mapping a colour changes what is on screen
   * straight away instead of at the next ingest.
   */
  async function renderCalendar(host) {
    const [snapshot, legendRows, isMe, notes] = await Promise.all([
      rc.latestSnapshot(),
      rc.listLegend(),
      meMatcher(),
      // The reasons logged for cancellations, shown on hover. A database that
      // cannot give them still draws the grid.
      rc.listCancellationNotes().catch(() => []),
    ]);
    // The choice belongs to whoever made it: a different person looking — an
    // administrator previewing a member — starts from their own default.
    const who = rc.me()?.id || null;
    if (la.onlyMine === null || la.onlyMineFor !== who) {
      la.onlyMine = Boolean(isMe) && !rc.isAdmin();
      la.onlyMineFor = who;
    }

    /* Reading the workbook is an administrator's job — it needs the folder, and
       ingestion writes the register. Everybody else is looking at the snapshot,
       which is the whole reason it is a snapshot. */
    const admin = rc.isAdmin();
    const written = la.source === EDITOR_SOURCE;
    /* One group at the right: who has the pen, Edit, and the master export
       beside it — each button used to push itself to the right on its own, which
       spread them across the whole row. */
    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'The look-ahead' }),
      el('div', { class: 'rc-section-actions' }, [
        // Once it is written here there is nothing to check; Edit is the way in.
        admin && !written ? checkNowButton() : null,
        penButton(),
        admin ? editSwitch() : null,
        // Everything the calendar holds, as one workbook — the look-ahead is where it is looked for first.
        admin ? masterExportButton() : null,
      ].filter(Boolean)),
    ]));
    watchForNewReading(host, snapshot?.id ?? null);

    if (!snapshot?.grid?.rows?.length) {
      host.appendChild(emptyState({
        iconName: 'calendar',
        title: 'Nothing read yet',
        message: written ? 'Nothing has been written yet. Press Edit to write the look-ahead; it is drawn '
          + 'here as soon as it is saved.' : admin
          ? 'Put the workbook in the lookahead folder beside your plan and press Check now. '
            + 'This draws the snapshot rather than the file, so once it has been read once it stays '
            + 'readable on any machine — including the ones that have never been given the folder.'
          : 'Nobody has read the workbook yet. It is drawn from the last read rather than from the '
            + 'file, so once an administrator has pressed Check now it is here for everybody.',
      }));
      return;
    }

    // `role` matters as much as the meaning here: it is what separates a shift
    // from the shading the workbook greys most of its calendar with.
    const legend = legendRows.map((r) => ({ argb: r.argb, meaning: r.meaning, role: r.role || 'shift' }));
    /* One parse, shared with every other screen that reads the sheet — see
       `parsedView()`. The snapshot's own timestamp is what pins the axis to a
       year (`datePlease()`); the weekday letters on the sheet then check it. */
    const view = parsedView(snapshot, legendRows);

    if (!view.days.length) {
      host.appendChild(emptyState({
        iconName: 'warning',
        title: 'No date axis found on that sheet',
        message: 'The calendar is located by finding the row of weekday letters — M, Tu, W and '
          + 'the rest — and this sheet has none that are visible. Check the sheet name in Legend, '
          + 'and that the week columns are not hidden.',
        action: admin ? { label: 'Open Legend', onClick: () => { la.section = 'legend'; notifyChanged('legend'); } } : null,
      }));
      return;
    }

    /* The key sits above the grid and is redrawn with it, because it describes
       what is on screen. */
    const strip = el('div');

    /* A filter, because a hundred and forty rows is a spreadsheet and the reason
       to look at it here is usually one subsystem or one location. */
    const search = textInput({
      value: la.calendarFilter,
      placeholder: 'Filter activities — description, location, party…',
      mini: true,
    });
    const quiet = checkbox({
      label: 'Show rows with nothing scheduled',
      checked: la.showQuietRows,
      onChange: (on) => { la.showQuietRows = on; draw(); },
    });
    const resources = checkbox({
      label: 'Show resource names',
      checked: la.showResources,
      onChange: (on) => { la.showResources = on; draw(); },
    });
    /* Only the activities whose names row puts me on a day on screen — drawn
       with the activity line above the names, since that line is the work the
       names land on, and under the sections they sit in. */
    const mine = isMe
      ? checkbox({
        label: 'Only my rows',
        checked: la.onlyMine,
        onChange: (on) => { la.onlyMine = on; draw(); },
      })
      : null;
    if (mine) mine.classList.add('la-only-mine');

    const dated = view.days.some((d) => d.date);
    const today = todayISO();
    const range = el('div', { class: 'rc-tabs', style: 'margin:0' });
    const drawRange = () => {
      clear(range);
      for (const choice of WEEK_CHOICES) {
        range.appendChild(el('button', {
          class: 'rc-tab',
          type: 'button',
          text: choice.label,
          'aria-pressed': String(choice.weeks === la.calendarWeeks),
          onClick: () => { la.calendarWeeks = choice.weeks; drawRange(); draw(); },
        }));
      }
    };
    drawRange();

    /* Which weeks can be shown: the reading's, and — once the look-ahead is
       written here — every week anything was ever written in, and every week the
       workbook's readings hold from before then. A reading covers only the week
       just gone and the five ahead, so "Everything" used to stop a week back;
       the weeks before it are drawn from what the editor holds, and the weeks
       before the editor from the workbook readings that had them. */
    const reading = readingSpan(view);
    const history = await historyOf(written);
    const reach = reachOf(reading, history);
    const viewFor = viewChooser({ view, reading, reach, written, legendRows, today, history });
    const p6Of = p6Chooser();

    /* Back and forward a week at a time, as Edit does, and back to this week. */
    const pager = el('div', { class: 'la-pager' });
    const turn = (delta) => {
      const next = addDaysISO(la.calendarStart || mondayOf(today), delta);
      la.calendarStart = next === mondayOf(today) ? null : next;
      draw();
    };
    const drawPager = (days) => {
      clear(pager);
      const all = !la.calendarWeeks;
      const start = la.calendarStart || mondayOf(today);
      const dates = days.filter((d) => d.date).map((d) => d.date);
      pager.append(
        pagerButton('chevron-left', 'Previous week', all || !reach.first || start <= mondayOf(reach.first), () => turn(-7)),
        el('button', {
          class: 'cx-btn mini ghost', type: 'button', text: 'This week',
          title: 'Start the window on this week\'s Monday', disabled: all || !la.calendarStart,
          onClick: () => { la.calendarStart = null; draw(); },
        }),
        pagerButton('chevron-right', 'Next week', all || !reach.last || addDaysISO(start, 7) > reach.last, () => turn(7)),
        el('span', {
          class: 'la-pager-range',
          text: dates.length ? `${dayLabel(dates[0], 'medium')} – ${dayLabel(dates[dates.length - 1], 'medium')}` : '',
        }),
      );
    };

    const body = el('div');
    let drawing = 0;
    const draw = async () => {
      const turnNo = ++drawing;
      /** @type {{ view: any, from: string | null, to: string | null, kind: string, snapshotId?: string | null, takenAt?: string | null }[]} */
      let parts = [{ view, from: null, to: null, kind: 'latest' }];
      try {
        parts = await viewFor.parts(la.calendarWeeks, la.calendarStart);
      } catch (err) {
        rc.reportError('lookahead:past-weeks', err);
        toast({ tone: 'bad', message: `The weeks before the reading could not be read — ${err.message}`, timeout: 10000 });
      }
      /* One calendar, however many sources the window is drawn from — the
         weeks before the editor from the workbook reading that had them, the
         rest from the editor or the reading — laid side by side on one set of
         rows (`mergeViews()`). It used to be a grid per source, one under the
         other, and "Everything" was a stack of calendars. */
      const merged = oneView(parts, today, la.calendarWeeks, la.calendarStart);
      const p6 = await p6Of(parts.length === 1 ? parts[0].view : merged);
      if (turnNo !== drawing) return;
      clear(body);
      const onlyMine = Boolean(isMe && la.onlyMine);
      /* One row pinned from the cancellation log is drawn whether or not it
         has anything scheduled — red is a cancellation, not a shift. */
      const pin = la.calendarRow;
      const shown = pinnedTo(drawn(merged, la.calendarFilter, la.showQuietRows || Boolean(pin), la.showResources,
        onlyMine ? isMe : null, p6?.names), pin);
      drawPager(shown.days);
      if (pin) {
        body.appendChild(el('div', { class: 'la-pinned', role: 'status' }, [
          el('span', { text: `Showing one row, from the cancellation log: ${pin.label}` }),
          el('button', {
            class: 'cx-btn mini ghost', type: 'button', text: 'Show every row',
            onClick: () => { la.calendarRow = null; draw(); },
          }),
        ]));
      }
      clear(strip);
      strip.appendChild(legendStrip(legend, [...new Set(parts.flatMap((part) => part.view.unknown || []))], paintOn(shown)));
      if (onlyMine && !shown.activities.length) {
        body.appendChild(emptyState({
          iconName: 'calendar',
          title: 'You are not on anything in these weeks',
          message: 'No names row on the look-ahead puts you on a day in the weeks on screen. Widen the window, or see the whole sheet.',
          action: { label: 'Show every row', onClick: () => { la.onlyMine = false; mine.querySelector('input').checked = false; draw(); } },
        }));
        return;
      }
      if (pin && shown.days.length && !shown.activities.length) {
        body.appendChild(emptyState({
          iconName: 'calendar',
          title: 'That row is not on the look-ahead for these weeks',
          message: 'Nothing the calendar holds for the weeks on screen has the row this cancellation was '
            + 'logged against — it may have been taken off the sheet since. Page a week either way, or '
            + 'show every row.',
          action: { label: 'Show every row', onClick: () => { la.calendarRow = null; draw(); } },
        }));
        return;
      }
      if (!shown.days.length) {
        body.appendChild(emptyState({
          iconName: 'calendar',
          title: 'Nothing on the look-ahead in these weeks',
          message: pin
            ? 'The look-ahead holds nothing for the weeks this cancellation was logged in — no reading '
              + 'or edit kept them.'
            : 'The look-ahead says nothing for the weeks on screen.',
          action: { label: 'Back to this week', onClick: () => { la.calendarStart = null; la.calendarRow = null; draw(); } },
        }));
        return;
      }
      /* Said whenever the weeks on screen were not drawn from the newest
         reading: a reading is evidence of what the look-ahead said that day;
         the editor is what it says now; an older reading is what it said then.
         A line per source, above the one grid, where the grid marks the day
         each hands over to the next. */
      /* Neighbouring stretches of the look-ahead as written are one source, and one line. */
      const sources = parts.reduce((out, part) => {
        const last = out[out.length - 1];
        if (last && last.kind === 'written' && part.kind === 'written') out[out.length - 1] = { ...last, to: part.to };
        else out.push(part);
        return out;
      }, []);
      for (const part of sources) {
        const note = partNote(part, parts.length);
        if (note) body.appendChild(el('p', { class: `rc-hint ${part.kind === 'reading' ? 'la-reading-note' : 'la-written-note'}`, text: note }));
      }
      const only = parts.length === 1 ? parts[0] : null;
      body.appendChild(grid_(shown, today, isMe,
        only ? (only.kind === 'written' ? null : only.view === view ? snapshot.id : only.snapshotId ?? null) : null, notes, p6));
    };
    // Redraw the rows only, never the input: rebuilding the field under the
    // caret is the trap this project has already been bitten by three times.
    // Typing a filter is a different question from the one row "Show cells" pinned.
    search.addEventListener('input', () => { la.calendarFilter = search.value; la.calendarRow = null; draw(); });

    host.appendChild(strip);
    host.appendChild(el('div', {
      style: 'display:flex;align-items:center;gap:16px;margin-bottom:10px;flex-wrap:wrap',
    }, [
      el('div', { style: 'flex:1;min-width:240px;max-width:340px' }, [search]),
      dated ? pager : null,
      dated ? range : null,
      mine,
      quiet,
      resources,
      /* What chooses the view, not the view on screen: the dialog picks its own
         weeks, and handing it what is drawn would quietly cap the export at
         whatever the range buttons were last set to. */
      exportButton({ viewFor, p6Of, legendRows, today, sheetName: snapshot.sheet_name, isMe }),
      /* The editor's own export, offered here too: the same workbook in the 4WLA
         layout, built from what the editor holds rather than from this reading.
         Only once the look-ahead is written here — before that, the workbook in
         the folder is the file, and the editor's tables would be an old copy. */
      written ? el('button', {
        class: 'cx-btn mini primary la-export-xlsx',
        type: 'button',
        html: icon('download', { size: 12 }) + '<span>Export to Excel</span>',
        title: 'The look-ahead as an .xlsx in the 4WLA layout — the same export as in Edit.',
        onClick: () => openExcelExport(),
      }) : null,
    ].filter(Boolean)));
    host.appendChild(body);
    await draw();
  }

  function pagerButton(name, label, disabled, onClick) {
    return el('button', {
      class: 'cx-btn mini ghost icon', type: 'button', 'aria-label': label, title: label,
      html: icon(name, { size: 14 }), disabled, onClick,
    });
  }

  /** The first and last dated day a reading covers, or nulls where its dates could not be read. */
  function readingSpan(view) {
    const dates = view.days.filter((d) => d.date).map((d) => d.date);
    return { first: dates[0] || null, last: dates[dates.length - 1] || null };
  }

  /**
   * What the calendar can page back through besides the newest reading: the days
   * written here (`laCellSpan()`), and each week the workbook's readings hold
   * with the newest reading that has it (`rc.workbookWeeks()`). Nothing for a
   * look-ahead still read from the workbook, whose reading is the whole sheet;
   * and an older database, without the list of workbook weeks, simply pages no
   * further back than the editor.
   */
  async function historyOf(written) {
    if (!written) return { span: { first: null, last: null }, weeks: [] };
    const [span, weeks] = await Promise.all([
      rc.laCellSpan().catch(() => ({ first: null, last: null })),
      rc.workbookWeeks().catch(() => []),
    ]);
    return {
      span,
      weeks: weeks.map((w) => ({ ...w, week_start: String(w.week_start).slice(0, 10) }))
        .sort((a, b) => a.week_start.localeCompare(b.week_start)),
    };
  }

  /**
   * How far the calendar can page: the reading's own days, and — once the
   * look-ahead is written here — from the first week a workbook reading or the
   * editor holds to the last day written.
   */
  function reachOf(reading, history) {
    let { first, last } = reading;
    const earliest = [history.weeks[0]?.week_start, history.span.first].filter(Boolean).sort()[0];
    if (earliest && (!first || earliest < first)) first = earliest;
    if (history.span.last && (!last || history.span.last > last)) last = history.span.last;
    return { first, last };
  }

  /**
   * Where each stretch of a window is drawn from.
   *
   * The newest reading, wherever it covers every day of the window — the four
   * weeks from today, nearly always. Otherwise the window is cut where the
   * editor starts (the Monday of the first day written here): from there on it
   * is the look-ahead as written (`writtenView()`), as one stretch so one grid
   * never mixes the two; before it, each week comes from the newest workbook
   * reading that has it (`rc.workbookWeeks()`), the rule the week plan and the
   * master export read the history by, and weeks that share a reading are one
   * stretch. Those weeks were never in the editor: it was started from the
   * workbook from the week it was adopted, and calendar paging used to stop
   * there, with Edit showing the weeks before it empty.
   *
   * `parts(weeks, start)` answers `[{ view, from, to, kind, snapshotId, takenAt }]`
   * in date order, `kind` one of 'latest', 'written' or 'reading'. Called as a
   * function it answers the one view an export draws — every source of the
   * window as one calendar (`oneView()`), as the screen draws it. Each view is
   * read once per drawing of the tab; a newer reading redraws the tab afresh.
   */
  function viewChooser({ view, reading, reach, written, legendRows, today, history = { span: {}, weeks: [] } }) {
    const made = new Map();
    const once = (key, fn) => {
      if (!made.has(key)) made.set(key, fn().catch((err) => { made.delete(key); throw err; }));
      return made.get(key);
    };
    const writtenFor = (from, to) => once(`w|${from}|${to}`, () => writtenView(from, to, legendRows));
    const readingFor = (id) => once(`r|${id}`, async () => {
      const snap = await rc.snapshotById(id);
      if (!snap?.grid?.rows?.length) throw new Error('that reading has no grid to draw');
      return viewOfSnapshot(snap, legendRows);
    });
    const editorStart = history.span?.first ? mondayOf(history.span.first) : null;
    const byWeek = new Map((history.weeks || []).map((w) => [w.week_start, w]));

    const bounds = (weeks, start) => {
      if (!weeks) {
        if (!reach.first) return null;
        const firstMonday = mondayOf(reach.first);
        const lastSunday = addDaysISO(mondayOf(reach.last), 6);
        return {
          from: reading.first && reading.first < firstMonday ? reading.first : firstMonday,
          to: reading.last && reading.last > lastSunday ? reading.last : lastSunday,
        };
      }
      const from = start || mondayOf(today);
      return { from, to: addDaysISO(from, weeks * 7 - 1) };
    };

    const parts = async (weeks, start) => {
      if (!written || !reading.first) return [{ view, from: null, to: null, kind: 'latest' }];
      const span = bounds(weeks, start);
      if (!span) return [{ view, from: null, to: null, kind: 'latest' }];
      const { from, to } = span;
      if (from >= reading.first && to <= reading.last) return [{ view, from: null, to: null, kind: 'latest' }];
      const out = [];
      const cut = editorStart && from < editorStart && byWeek.size ? editorStart : null;
      if (cut) {
        const before = to < cut ? to : addDaysISO(cut, -1);
        const runs = [];
        for (let w = mondayOf(from); w <= before; w = addDaysISO(w, 7)) {
          const hit = byWeek.get(w);
          const lo = w < from ? from : w;
          const hi = addDaysISO(w, 6) > before ? before : addDaysISO(w, 6);
          const last = runs[runs.length - 1];
          if (last && last.snapshotId === (hit?.snapshot_id || null)) last.to = hi;
          else runs.push({ snapshotId: hit?.snapshot_id || null, takenAt: hit?.taken_at || null, from: lo, to: hi });
        }
        for (const run of runs) {
          out.push(run.snapshotId
            ? { ...run, kind: 'reading', view: await readingFor(run.snapshotId) }
            // A week no reading of the workbook has: the editor's answer, which is that nothing was written.
            : { ...run, kind: 'written', view: await writtenFor(run.from, run.to) });
        }
      }
      const after = cut ? cut : from;
      if (after <= to) out.push({ kind: 'written', from: after, to, view: await writtenFor(after, to) });
      return out;
    };

    const choose = async (weeks, start) => {
      const all = await parts(weeks, start);
      if (all.length === 1 && all[0].kind === 'latest') return view;
      // The one calendar the screen draws for that window, never one of its sources.
      return oneView(all, today, weeks, start);
    };
    choose.parts = parts;
    return choose;
  }

  /**
   * A window's stretches as the one calendar they are drawn as: each narrowed to
   * its own days, then laid side by side on one set of rows (`mergeViews()`).
   * A window the newest reading covers alone is that reading, narrowed.
   */
  function oneView(parts, today, weeks, start) {
    return mergeViews(parts.map((part) => ({
      view: windowed(part.view, today, weeks, start, part),
      snapshotId: part.kind === 'reading' ? part.snapshotId ?? null : null,
    })));
  }

  /** What a stretch of the calendar says about where it came from, or nothing for the newest reading on its own. */
  function partNote(part, count) {
    const span = part.from && part.to ? `${dayLabel(part.from, 'medium')} – ${dayLabel(part.to, 'medium')}: ` : '';
    if (part.kind === 'reading') {
      const when = part.takenAt ? new Date(part.takenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'an earlier date';
      return `${span}from the workbook as it was read on ${when} — these weeks come from before the look-ahead was written here.`;
    }
    if (part.kind === 'written') {
      return `${count > 1 ? span : ''}These weeks are drawn from the look-ahead as it is written now, not from a reading taken at the time.`;
    }
    return '';
  }

  /** Which of a view's activity columns is the Activity ID: by its heading, as the sheet writes it. */
  function activityIdColumn(view) {
    return (view.headings || []).findIndex((h) => /activity\s*id/i.test(String(h || '')));
  }

  /**
   * The P6 names for the activities a view names, and the reasons a row may give
   * instead — read once per view, and only the IDs on it, never the whole list.
   * Null where the sheet has no Activity ID column. A database without the P6
   * tables simply has no names to give.
   */
  function p6Chooser() {
    const seen = new WeakMap();
    return (view) => {
      if (!seen.has(view)) {
        seen.set(view, (async () => {
          const col = activityIdColumn(view);
          if (col < 0) return null;
          const ids = [...new Set(view.activities.filter((a) => !a.heading && !a.absence)
            .map((a) => String(a.meta[col] || '').trim()).filter(Boolean))];
          const [entries, flags] = await Promise.all([
            ids.length ? rc.p6ActivitiesByIds(ids).catch(() => []) : [],
            rc.listP6Flags({ includeRetired: true }).catch(() => []),
          ]);
          return { col, index: p6Index(entries, flags), names: new Map(entries.map((e) => [e.activity_id, e.name])) };
        })());
      }
      return seen.get(view);
    };
  }

  /**
   * Narrow the axis to the weeks worth looking at.
   *
   * The past is dropped rather than scrolled past: this sheet carries a quarter
   * of finished weeks to the left of today, and a look-ahead that opens on
   * March is not a look-ahead. The window pages back and forward a week at a
   * time from this one (`start`, a Monday), and "Everything" is one click away
   * for the times the question really is what happened.
   *
   * If the dates could not be resolved — the weekday letters did not agree —
   * nothing is narrowed, because narrowing on a reading that might be a year out
   * would hide real work. Same if this week's window turns out to be empty: a
   * calendar showing nothing is not an answer. A window somebody paged to is
   * shown as it is, empty or not — falling back to the whole sheet there would
   * look like the buttons doing something else.
   */
  function windowed(view, today, weeks = la.calendarWeeks, start = la.calendarStart, part = null) {
    const narrowed = (() => {
      // A stretch of a window drawn from one source: exactly its own days.
      if (part?.from && part?.to) return view.days.filter((d) => d.date && d.date >= part.from && d.date <= part.to);
      if (!weeks || !view.days.some((d) => d.date)) return view.days;
      const from = start || mondayOf(today);
      const to = addDaysISO(from, weeks * 7 - 1);
      const days = view.days.filter((d) => !d.date || (d.date >= from && d.date <= to));
      return days.length || start ? days : view.days;
    })();

    /* Whether a row has anything scheduled is a question about *the weeks on
       screen*, not about the workbook.
       This is what was wrong: the flag was worked out once across the whole
       sheet, so a row painted in June survived into a four-week window showing
       nothing at all — and this file has thirty-eight of those. A row earns its
       place by carrying work in the days actually being drawn. */
    const shown = new Set(narrowed.map((d) => d.col));
    const activities = view.activities.map((a) => ({
      ...a,
      // `role === 'shift'`, the same question `readGrid()` asks — a divider or a
      // weekend band is paint, not work, and a row carrying only those has
      // nothing scheduled in the weeks on screen.
      highlighted: marksOf(a).some((m) => m.hex && m.role === 'shift' && shown.has(m.col)),
    }));

    return { ...view, days: narrowed, activities };
  }

  /**
   * Which rows are actually drawn: unscheduled ones out, then the filter.
   *
   * **A heading is not exempt from the switch.** It used to be — headings were
   * kept whatever, and only the ones left dangling at the very end were trimmed —
   * so a workbook whose activity columns carry any paint at all, or one stray
   * colour that turned up unmapped after a read, put its entire contents back on
   * screen with the box still unticked. What the switch says is what happens: a
   * row with nothing scheduled is hidden, and a title over nothing is a row with
   * nothing scheduled.
   *
   * The nesting is still respected, which is why this walks backwards. The
   * workbook nests its sections — "PHASE 2" sits above "W40 — Testing and
   * Commissioning", which sits above the work — so a heading is kept when the
   * section under it has work *or* when the row immediately below it is a heading
   * that was itself kept. That second clause is the parent case, and dropping it
   * would throw away the outer level of every section that has rows.
   */
  function drawn(view, filter, showQuiet, withResources = la.showResources, isMe = null, p6Names = null) {
    const terms = String(filter || '').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
    let rows = view.activities;

    /* Only my rows: every activity whose names row names me on a day on
       screen, with the sections above it — see `rowsNaming()`. It replaces the
       "nothing scheduled" rule rather than adding to it: a row that names you
       is yours whether or not anybody painted it yet. */
    if (isMe) {
      rows = rowsNaming(rows, isMe, new Set(view.days.map((d) => d.col)));
    } else if (!showQuiet) {
      /* A heading that carries work is work.
         `heading` is a fact about paint in the activity columns, and a workbook
         that bands *every* row's description would make every row one — at which
         point a rule that only ever kept a heading for the sake of the rows under
         it would empty the grid completely, which is worse than the problem it is
         here to fix. So a title is a heading with nothing scheduled on it, and
         anything with a shift on it is judged as work like any other row. */
      const isTitle = (a) => a.heading && !a.highlighted;
      const keep = new Array(rows.length).fill(false);
      let sectionHasWork = false;
      let belowIsKeptTitle = false;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].absence) {
          /* Not work, and not a title either. "Nothing scheduled" is a question
             about an activity, and these rows have no activity — asking it of them
             would hide the one row that says why somebody has no work this week,
             which is the opposite of what the switch is for. They answer to the
             resource-names switch instead, below, because that is what they are:
             names. */
          keep[i] = true;
          continue;
        }
        if (isTitle(rows[i])) {
          keep[i] = sectionHasWork || belowIsKeptTitle;
          // This title closes the section beneath it; anything above belongs to a
          // different one.
          sectionHasWork = false;
          belowIsKeptTitle = keep[i];
        } else {
          keep[i] = rows[i].highlighted && rows[i].named;
          if (keep[i]) sectionHasWork = true;
          // A row of work between two titles means the upper one is not the
          // lower one's parent.
          belowIsKeptTitle = false;
        }
      }
      rows = rows.filter((_, i) => keep[i]);
    }

    /* "Show resource names" covers every row of names, not only the ones tucked
       under an activity. Switching the names off to read the activities alone and
       being left with two rows of people would be the switch half working. */
    if (!withResources) rows = rows.filter((a) => !a.absence);

    if (terms.length) {
      rows = rows.filter((a) => {
        /* The names on the Resource row are part of the haystack: looking for
           where somebody is this week is one of the two reasons anybody types in
           this box, and it would find nothing if only the activity line counted.
           So is the P6 name of the activity a row names, which the row itself
           may word differently. */
        const hay = [...a.meta, ...(a.resource?.marks || []).map((m) => m.value),
          ...(a.absence ? a.marks.map((m) => m.value) : []),
          ...(p6Names ? a.meta.map((v) => p6Names.get(String(v || '').trim()) || '') : [])]
          .join(' ').toLowerCase();
        return terms.some((t) => hay.includes(t));
      });
    }

    return { ...view, activities: rows };
  }

  /**
   * Only the row "Show cells" pinned (`la.calendarRow`): by the editor's id where
   * this part of the window carries ids, else by the words the log stored for it
   * — the row's cells joined with " · ", exactly as `rowsFrom()` wrote them.
   */
  function pinnedTo(view, row) {
    if (!row) return view;
    const byId = row.id && view.activities.some((a) => a.id === row.id);
    const words = (a) => a.meta.filter(Boolean).join(' · ');
    return {
      ...view,
      activities: view.activities.filter((a) => !a.absence && (byId ? a.id === row.id : words(a) === row.label)),
    };
  }

  /** Every colour actually painted on the days being drawn, as a set of hexes. */
  function paintOn(view) {
    const shown = new Set(view.days.map((d) => d.col));
    const hexes = new Set();
    for (const activity of view.activities) {
      for (const mark of marksOf(activity)) {
        if (mark.hex && shown.has(mark.col)) hexes.add(String(mark.hex).toUpperCase());
      }
    }
    return hexes;
  }

  /**
   * Stretch the grid's frame down to the bottom of whatever scrolls it, so the
   * table is as long as the screen allows. Measured, because only the browser
   * knows how much sits above it; re-measured when that container resizes.
   */
  function fitToBottom(wrap) {
    const scroller = () => {
      for (let node = wrap.parentElement; node; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.clientHeight) return node;
      }
      return document.scrollingElement || document.documentElement;
    };
    let observer = null;
    const fit = () => {
      if (!wrap.isConnected) { observer?.disconnect(); return; }
      const box = scroller();
      const boxTop = box === document.scrollingElement ? 0 : box.getBoundingClientRect().top;
      const boxHeight = box === document.scrollingElement ? window.innerHeight : box.clientHeight;
      const top = wrap.getBoundingClientRect().top - boxTop + box.scrollTop;
      const pad = parseFloat(getComputedStyle(box).paddingBottom) || 0;
      wrap.style.maxHeight = `${Math.max(240, Math.floor(boxHeight - top - pad - 4))}px`;
    };
    requestAnimationFrame(() => {
      fit();
      if (typeof ResizeObserver === 'function' && wrap.isConnected) {
        observer = new ResizeObserver(fit);
        observer.observe(scroller());
      }
    });
  }

  /**
   * The grid itself. Split out so the filter can redraw it without the header.
   * `p6` (from `p6Chooser()`) names the P6 activity an Activity ID points at,
   * on its hover, and marks a reason given instead.
   */
  function grid_(view, today, isMe = null, snapshotId = null, notes = [], p6 = null) {
    const rows = view.activities;

    /* The month band. Each label spans its own run of days, which is what the
       merged cell in the workbook meant. */
    const months = [];
    for (const day of view.days) {
      const last = months[months.length - 1];
      if (last && last.month === day.month) last.span++;
      else months.push({ month: day.month, span: 1 });
    }

    const dayClass = (d, extra = '') => [
      extra,
      d.weekend ? 'la-weekend' : '',
      d.date && d.date === today ? 'la-today' : '',
      // The first day drawn from another source than the day before it (`mergeViews()`).
      d.sourceStart ? 'la-source-start' : '',
    ].filter(Boolean).join(' ');

    /* What the workbook calls each of the frozen columns.
       `readGrid()` already reads them — it has to, because one of them is the
       Location and the rows depend on knowing which — and they were being thrown
       away here: the header said "Activity" across all of them, so a grid whose
       left-hand side is Location, SSWP, Party to action and work hours arrived on
       screen as four anonymous columns of text. The printed calendar has read them
       since it was written, so this is the same answer in the same words —
       `io/rc_pdf.js` falls back to "Activity" over the first column and to nothing
       over a column the sheet never labelled, and a heading that differed between
       the screen and the print would be a heading nobody could trust. */
    const headings = view.meta.map((_, i) => {
      const said = String(view.headings?.[i] || '').trim();
      return said || (i === 0 ? 'Activity' : '');
    });

    const head = el('thead', {}, [
      el('tr', {}, [
        el('th', { class: 'la-meta la-meta-all la-last', colSpan: view.meta.length, text: '' }),
        /* The label is a sticky span inside the band rather than text in it.
           A month spans thirty columns, so once you scroll past its first day
           the label itself has scrolled away and the band above you is
           anonymous — which is exactly when you want to know what month it is. */
        ...months.map((m) => el('th', { class: 'la-month', colSpan: m.span }, [
          el('span', { class: 'la-month-label', text: m.month || '' }),
        ])),
      ]),
      el('tr', {}, [
        ...headings.map((text, i) => el('th', {
          class: `la-meta la-meta-head${i === headings.length - 1 ? ' la-last' : ''}`,
          text,
          title: text,
        })),
        ...view.days.map((d) => el('th', { class: dayClass(d, 'la-num'), text: d.day })),
      ]),
      el('tr', {}, [
        el('th', { class: 'la-meta la-meta-all la-last', colSpan: view.meta.length, text: '' }),
        ...view.days.map((d) => el('th', { class: dayClass(d), text: d.weekday })),
      ]),
    ]);

    const byCol = (marks) => {
      const map = new Map();
      for (const m of marks) map.set(m.col, m);
      return map;
    };

    /**
     * One line of the grid: the activity columns frozen on the left, then a cell
     * per day. Used for the activity and for its Resource row alike, because the
     * two are the same shape and drawing them twice is how they drift apart.
     */
    const line = (meta, marks, { klass = '', what = '', resource = false, open = null, rowId = null }) => {
      const label = meta.filter(Boolean).join(' · ');
      // Why it was cancelled, as logged — for the day, or for one struck-out code.
      const reason = (date, codes = '') => (date && !resource
        ? cancellationReasonText(cancellationNoteFor(notes, { label, meta, day: date, codes, rowId }))
        : '');
      return el('tr', {
      class: klass,
    }, [
      ...meta.map((value, i) => {
        /* The Activity ID says which P6 activity it is, or why there is none.
           An ID the list does not have is left saying only itself: this view
           reads the IDs on screen, not the whole list, so it cannot tell a typo
           from an import nobody has run. */
        const status = p6 && open && i === p6.col ? p6Status(value, p6.index) : null;
        const said = status && (status.kind === 'linked' || status.kind === 'flagged') ? p6Words(value, status) : value;
        return el('td', {
          class: 'la-meta' + (i === meta.length - 1 ? ' la-last' : '') + (open ? ' la-openable' : '')
            + (status?.kind === 'flagged' ? ' la-p6-flag' : ''),
          text: value,
          title: open ? `${said}${said ? ' — ' : ''}open the whole activity` : value,
          // The first column is the one keyboard stop for the row.
          tabindex: open && i === 0 ? '0' : null,
          role: open && i === 0 ? 'button' : null,
          onClick: open || null,
          onKeydown: open && i === 0 ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : null,
        });
      }),
      ...view.days.map((d) => {
        const mark = marks.get(d.col);
        const classes = ['la-day'];
        if (resource) classes.push('la-resource');
        if (d.weekend) classes.push('la-weekend');
        if (d.date && d.date === today) classes.push('la-today');
        if (d.sourceStart) classes.push('la-source-start');
        // Your own name, wherever it is written — the day you are on.
        const yours = resource && isMe && mark?.value && resourceNames(mark.value).some(isMe);
        if (yours) classes.push('la-mine');
        if (mark?.hex) {
          classes.push('la-painted');
          if (isDark(mark.hex)) classes.push('la-dark');
          if (!mark.meaning) classes.push('la-unmapped');
          // Struck through as well as red: a cancellation must not be a fact
          // only somebody who can tell red from green can read. Never on a
          // Resource row — red there marks names, not the work.
          else if (!resource && isCancelMeaning(mark.meaning)) classes.push('la-cancel');
        }
        return el('td', {
          class: classes.join(' '),
          style: mark?.hex ? `background-color:#${mark.hex}` : '',
          title: [what, d.date || `${d.month} ${d.day} ${d.weekday}`.trim(),
            mark?.meaning || (mark?.hex ? `unmapped colour #${mark.hex}` : null), mark?.value,
            classes.includes('la-cancel') ? reason(d.date) || null : null,
            yours ? 'you are on this day' : null]
            .filter(Boolean).join(' · '),
        }, resource ? [mark?.value || '']
          : codeNodes(mark?.value || '', 'la-code-cancelled', (code) => reason(d.date, code)));
      }),
    ]);
    };

    const tbody = el('tbody');
    for (const a of rows) {
      const what = a.meta.filter(Boolean)[0] || '';
      tbody.appendChild(line(a.meta, byCol(a.marks), {
        klass: [a.heading ? 'la-head-row' : '', a.absence ? 'la-resource-row la-absence-row' : '']
          .filter(Boolean).join(' '),
        what: a.absence ? `${ABSENCE_LABELS[a.absence]} — who is away` : what,
        // Styled as names, because that is what the cells hold. The paint on an
        // absence row means nothing the legend knows about.
        resource: Boolean(a.absence),
        rowId: a.id || null,
        open: a.heading || a.absence ? null
          : () => openActivity({
            row: { raw_label: a.meta.filter(Boolean).join(' · '), snapshot_id: a.snapshotId !== undefined ? a.snapshotId : snapshotId, sheet_row: a.row },
          }),
      }));
      /* The Resource row, drawn under the activity it belongs to and never on its
         own — it has no location or hours of its own, only the ones it inherited,
         so away from that line it would be a row of names about nothing. */
      if (a.resource && la.showResources) {
        tbody.appendChild(line(a.resource.meta, byCol(a.resource.marks), {
          klass: 'la-resource-row',
          what: what ? `${what} — who is on it` : 'who is on it',
          resource: true,
        }));
      }
    }

    const table_ = el('table', { class: 'rc-table la-grid' }, [head, tbody]);
    const wrap = el('div', { class: 'rc-scroll', style: 'max-height:60vh' }, [table_]);
    fitToBottom(wrap);

    /* The frozen columns have to be told where they start, and only the browser
       knows how wide the content made them. Measured once the table is in the
       document, on the next frame — and again whenever it changes size: a font
       arriving, a zoom or a heading wrapping moves the columns, and a stale
       offset lets one frozen column slide over the next, or a header row under
       another. */
    const freeze = () => {
      freezeHead(head);
      freezeSide(table_);
    };
    requestAnimationFrame(freeze);
    if (typeof ResizeObserver === 'function') new ResizeObserver(freeze).observe(table_);

    if (!rows.length) {
      return el('p', {
        class: 'rc-hint',
        text: 'Nothing scheduled in these weeks matches. Widen the window, clear the filter, or '
          + 'tick "Show rows with nothing scheduled" to see what the workbook is carrying for '
          + 'reference.',
      });
    }
    return wrap;
  }

  /**
   * Pin the activity columns at the widths the content made them. Every cell in
   * a column, heading included — the heading row has one cell per column rather
   * than one spanning the lot, so it has to be frozen at the same offsets or the
   * names slide out from over their values. The two rows that still span
   * everything are pinned at zero, which is where a cell covering all of them
   * starts. A table not laid out yet (hidden, or not in the document) measures
   * nothing and is left until it is.
   */
  function freezeSide(table) {
    const firstRow = table.querySelector('tbody tr');
    if (!firstRow) return;
    const widths = [...firstRow.querySelectorAll('.la-meta')].map((td) => td.getBoundingClientRect().width);
    if (!widths.some((w) => w > 0)) return;
    let left = 0;
    widths.forEach((width, i) => {
      for (const cell of table.querySelectorAll(`.la-meta:nth-child(${i + 1})`)) {
        if (!cell.classList.contains('la-meta-all')) cell.style.left = `${left}px`;
      }
      left += width;
    });
    for (const th of table.querySelectorAll('thead .la-meta-all')) th.style.left = '0px';
    // The month label pins just past the frozen columns.
    table.style.setProperty('--la-meta-w', `${left}px`);
  }

  /**
   * Pin the three header rows — month, day number, weekday — one under the other.
   *
   * Every header cell was `position: sticky; top: 0`, so all three rows pinned to
   * the same line and scrolling down stacked them on top of each other: the
   * weekday letters covered the day numbers and the month, and the one thing a
   * reader scrolling a hundred rows needs — which date this column is — was gone.
   * Each row is now pinned at the height of the rows above it, measured, because
   * only the browser knows how tall the content made them.
   */
  function freezeHead(head) {
    let top = 0;
    for (const tr of head.rows) {
      for (const cell of tr.cells) cell.style.top = `${top}px`;
      top += tr.getBoundingClientRect().height;
    }
  }

  /**
   * The key, for the calendar actually on screen.
   *
   * `onScreen` is the set of colours the drawn rows and days carry, and only
   * those are listed. The register is the whole project's — five shifts, three
   * kinds of shading, whatever a previous year needed — and printing all of it
   * over a four-week window is a key to somebody else's calendar: the reader
   * checks a colour against it, finds three entries that are not here, and stops
   * trusting the strip. The full register is one click away in Legend, which says
   * so underneath.
   *
   * Pass no set at all and everything is listed, which is what a caller with
   * nothing drawn yet wants.
   */
  function legendStrip(legend, unknown, onScreen = null) {
    const showing = (hex) => !onScreen || onScreen.has(String(hex).toUpperCase());
    const strip = el('div', { class: 'la-legend' });
    const listed = legend.filter((entry) => showing(entry.argb));
    for (const entry of listed) {
      strip.append(el('span', {}, [
        el('span', { class: 'la-swatch', style: `background:#${entry.argb}` }),
        el('span', { text: entry.meaning }),
      ]));
    }
    if (onScreen && legend.length > listed.length) {
      strip.append(el('span', {
        class: 'rc-hint',
        text: `${legend.length - listed.length} more colour(s) in the register are not on screen.`,
        title: 'The key lists what this window actually carries. Legend has the register in full.',
      }));
    }
    unknown = (unknown || []).filter((u) => showing(u.hex));
    // The way out of an unmapped colour is the Legend register, which only an
    // administrator can write. Offering the button to everybody else would be a
    // door onto a wall.
    if (unknown.length && rc.isAdmin()) {
      /* Show the swatches, not just a count. A colour nobody has explained keeps
         its rows on screen — an unmapped colour counts as work, deliberately —
         so "five unmapped" and "these five, and one of them is the grey your
         spreadsheet shades everything with" are very different messages. */
      strip.append(el('span', { class: 'la-unknown' }, [
        ...unknown.slice(0, 6).map((u) => el('span', {
          class: 'la-swatch la-swatch-unmapped',
          style: `background:#${u.hex}`,
          title: `#${u.hex} — ${u.count} cell(s), nobody has said what it means`,
        })),
        el('button', {
          class: 'cx-btn mini ghost',
          text: `${unknown.length} colour(s) unmapped — say what they mean`,
          title: 'Nothing is guessed. Until somebody says, they count as work and keep their rows '
            + 'on screen.',
          onClick: () => { la.section = 'legend'; notifyChanged('legend'); },
        }),
      ]));
    }
    return strip;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Exporting the calendar
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Put the look-ahead on one sheet of paper.
   *
   * What people were doing instead was a screenshot, and a screenshot of this
   * grid is a poor document: the frozen columns come out twice, the scroll clips
   * whichever weeks nobody happened to be looking at, and the shift colours are
   * whatever the monitor made of them. This is the same calendar as vector
   * geometry — selectable text, true colours, one page.
   *
   * **Every switch is asked rather than inherited.** The dialog opens on what is
   * on screen, because that is nearly always what somebody means, and then each
   * choice is its own argument to `calendarScene()`. An export that silently
   * depended on the last thing anybody clicked is the sort of document that turns
   * up in a claim bundle missing a fortnight.
   *
   * And it says what the print will come out at *before* writing anything.
   * "Fits on one page" is true of anything if you shrink it far enough; the
   * question somebody can act on is whether they will be able to read it, and the
   * answers — a bigger sheet, fewer weeks, the names off — are all in this
   * dialog.
   */
  function exportDialog({ viewFor, p6Of, legendRows, today, sheetName, isMe = null }) {
    const weeks = selectInput({
      value: String(la.calendarWeeks || 0),
      options: [
        ...WEEK_CHOICES.map((c) => ({ value: String(c.weeks), label: c.label })),
        { value: '0', label: 'Everything the sheet covers' },
      ],
    });
    const page = selectInput({
      value: 'a3',
      options: PAGE_CHOICES.map((c) => ({ value: c.id, label: c.label })),
    });
    const orientation = selectInput({
      value: 'landscape',
      options: [{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }],
    });
    const onlyMine = Boolean(isMe && la.onlyMine);
    const title = textInput({ value: onlyMine ? `${rc.me()?.name || 'My'} — look-ahead` : `${sheetName || '4WLA'} — look-ahead` });
    const withMine = isMe
      ? checkbox({ label: 'Only my rows', checked: onlyMine })
      : null;

    const withResources = checkbox({ label: 'Resource names, and who is away', checked: la.showResources });
    const withQuiet = checkbox({ label: 'Rows with nothing scheduled', checked: la.showQuietRows });
    const withLegend = checkbox({ label: 'The key for the colours on it', checked: true });
    const withFilter = checkbox({
      label: la.calendarFilter ? `Only rows matching "${la.calendarFilter}"` : 'Apply the filter on screen',
      checked: Boolean(la.calendarFilter),
    });

    const on = (box) => box.querySelector('input').checked;
    const readout = el('p', { class: 'rc-hint' });

    /* What is actually going to be drawn, from the same functions the screen
       draws through — the same view for the same weeks, from the Monday on
       screen — so the export cannot show a different set of rows from the grid
       it was started from. */
    const chosen = async () => {
      const count = Number(weeks.value) || 0;
      const source = await viewFor(count, la.calendarStart);
      const p6 = await p6Of(source);
      const narrowed = windowed(source, today, count);
      const rows = drawn(narrowed, on(withFilter) ? la.calendarFilter : '', on(withQuiet), on(withResources),
        withMine && on(withMine) ? isMe : null, p6?.names);
      return {
        view: rows,
        opts: {
          showResources: on(withResources),
          showAway: on(withResources),
          showLegend: on(withLegend),
          legend: on(withLegend)
            ? legendRows
              .map((r) => ({ argb: r.argb, meaning: r.meaning }))
              .filter((e) => paintOn(rows).has(String(e.argb).toUpperCase()))
            : [],
          today,
          pageSize: page.value,
          orientation: orientation.value,
          title: title.value.trim() || 'Look-ahead',
          subtitle: [
            `${sheetName || '4WLA'}`,
            count ? `${count} weeks from ${dayLabel(la.calendarStart || mondayOf(today), 'medium')}` : 'whole sheet',
          ].join('  ·  '),
        },
      };
    };

    let asked = 0;
    const refresh = async () => {
      const mine = ++asked;
      let picked;
      try {
        picked = await chosen();
      } catch (err) {
        readout.className = 'rc-hint rc-warn';
        readout.textContent = `Those weeks could not be read — ${err.message}`;
        return;
      }
      if (mine !== asked) return;
      const { view: shown, opts } = picked;
      if (!shown.activities.length) {
        readout.className = 'rc-hint rc-warn';
        readout.textContent = 'Nothing to draw with those choices — widen the weeks, or bring the '
          + 'rows with nothing scheduled in.';
        return;
      }
      const fit = calendarFit(shown, opts);
      const tight = fit.pt < 4.6;
      readout.className = tight ? 'rc-hint rc-warn' : 'rc-hint';
      readout.textContent = `${fit.days} day column(s) and ${fit.rows} row(s) on ${fit.page}, at `
        + `${Math.round(fit.scale * 100)}% — the marks in the cells print at about `
        + `${fit.pt.toFixed(1)} pt.`
        + (tight ? ' That is small to read on paper: try a bigger sheet, or fewer weeks.' : '');
    };

    for (const control of [weeks, page, orientation]) control.addEventListener('change', refresh);
    for (const box of [withResources, withQuiet, withLegend, withFilter, withMine].filter(Boolean)) {
      box.querySelector('input').addEventListener('change', refresh);
    }
    refresh();

    formModal({
      title: 'Export the look-ahead',
      body: el('div', { class: 'cx-form' }, [
        field('Weeks', weeks),
        el('div', { style: 'display:flex;gap:8px' }, [
          el('div', { style: 'flex:1' }, [field('Paper', page)]),
          el('div', { style: 'flex:1' }, [field('Orientation', orientation)]),
        ]),
        field('Title', title),
        withMine,
        withResources,
        withQuiet,
        withLegend,
        la.calendarFilter ? withFilter : null,
        readout,
        el('p', {
          class: 'rc-hint',
          text: 'One page, always. A four-week look-ahead reassembled from four sheets on a '
            + 'meeting-room table is not a four-week look-ahead — so what gives is the scale, '
            + 'and nothing is ever cut off the side.',
        }),
      ].filter(Boolean)),
      confirmLabel: 'Export PDF',
      onConfirm: async () => {
        const { view: shown, opts } = await chosen();
        if (!shown.activities.length) throw new Error('There is nothing to draw with those choices.');
        const blob = calendarPdf(shown, opts);
        const whose = withMine && on(withMine) ? `-${foldName(rc.me()?.name || 'mine') || 'mine'}` : '';
        saveFile(`lookahead${whose}-${today}.pdf`, blob, 'application/pdf', 'Look-ahead');
      },
    });
  }

  /**
   * The 4WLA as a PDF, with nobody at the screen — what the master export files
   * as `exports/4WLA_Latest.pdf`, on its schedule or when Export now is pressed.
   *
   * It is the Export PDF dialog with its defaults, never the screen's state:
   * four weeks from this week's Monday, every row with work in them (none
   * filtered, none "only mine"), the names and who is away, the key, on one A3
   * landscape sheet. Drawn through the same functions — the same view for the
   * same weeks — so a scheduled PDF and one exported by hand never disagree.
   * Null when there is nothing to draw.
   */
  async function lookaheadPdfNow({ weeks = 4, today = todayISO() } = {}) {
    const [snapshot, legendRows, sourceSetting] = await Promise.all([rc.latestSnapshot(), rc.listLegend(), lookaheadSource()]);
    if (!snapshot?.grid?.rows?.length) return null;
    const view = parsedView(snapshot, legendRows);
    if (!view.days.length) return null;
    const written = sourceSetting === EDITOR_SOURCE;
    const reading = readingSpan(view);
    const history = await historyOf(written);
    const viewFor = viewChooser({ view, reading, reach: reachOf(reading, history), written, legendRows, today, history });
    const start = mondayOf(today);
    const source = await viewFor(weeks, start);
    const p6 = await p6Chooser()(source);
    const rows = drawn(windowed(source, today, weeks, start), '', false, true, null, p6?.names);
    if (!rows.activities.length) return null;
    const sheet = snapshot.sheet_name || '4WLA';
    const blob = calendarPdf(rows, {
      showResources: true,
      showAway: true,
      showLegend: true,
      legend: legendRows.map((r) => ({ argb: r.argb, meaning: r.meaning }))
        .filter((e) => paintOn(rows).has(String(e.argb).toUpperCase())),
      today,
      pageSize: 'a3',
      orientation: 'landscape',
      title: `${sheet} — look-ahead`,
      subtitle: `${sheet}  ·  ${weeks} weeks from ${dayLabel(start, 'medium')}`,
    });
    return { name: LOOKAHEAD_PDF, bytes: new Uint8Array(await blob.arrayBuffer()) };
  }

  /** The one name it is filed under, replaced each time. */
  const LOOKAHEAD_PDF = '4WLA_Latest.pdf';

  // The master export files it; this module imports that one, so it is handed over rather than imported back.
  provideLookaheadPdf(lookaheadPdfNow);

  function exportButton(context) {
    return el('button', {
      class: 'cx-btn mini primary la-export-pdf',
      type: 'button',
      html: icon('download', { size: 12 }) + '<span>Export PDF</span>',
      title: 'Draw this calendar on one page — weeks, names and paper size are all choices.',
      onClick: () => exportDialog(context),
    });
  }


  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
  Object.defineProperty(__x, "lookaheadPdfNow", { get: () => lookaheadPdfNow, enumerable: true });
  Object.defineProperty(__x, "LOOKAHEAD_PDF", { get: () => LOOKAHEAD_PDF, enumerable: true });
};

// ui/rc_pto.js
__mods["ui/rc_pto.js"] = function (__x, __req) {
  /**
   * PTO — who is off, what is booked, and where the two disagree.
   *
   * Leave already had a home: a list in Lists → Leave, sorted by start date.
   * That is the *record* and it stays there. It is not a view anybody can
   * plan around, because the question a scheduler actually asks is "who is off in
   * the weeks I am staffing", and a list of date ranges does not answer it —
   * you find out somebody is away when you try to put them somewhere.
   *
   * So this is a calendar. It reads two things into each cell, for the reason the
   * Resources tab draws two — though both come out the same colour, because on
   * this screen they are the same fact:
   *
   * **What somebody booked**, from `rc_leave` — a record, with a kind and a
   * status, that survives the workbook being edited.
   *
   * **What the 4WLA says**, from the "PTO" row at the bottom of the sheet — names
   * typed into day cells, derived at paint time and never written anywhere. On
   * this project that row is usually the *only* place an absence is written
   * down: somebody types a name into the 4WLA and never opens Lists. Reading it
   * is what stops the editor's staffing check putting a person on holiday on a
   * shift.
   *
   * **They are drawn as one colour, and that is deliberate.** Which of the two
   * wrote a day down is bookkeeping; the question this screen answers is who is
   * away, and a reader scanning four weeks of the team should not have to learn
   * three swatches to answer it. The distinction is still there to be had — in the
   * cell's title, in the counts under the grid, and in the fact that a day only
   * the sheet knows about can be clicked to book it — but it is not what the
   * colour is for.
   *
   * **Nothing here is derived from a role.** Managers take leave too, and a PTO
   * calendar that quietly dropped them would be wrong on exactly the weeks it
   * matters. `scheduled` is what the staffing checks filter on because those
   * are about work; this is about people.
   *
   * **Leave is booked, never asked for.** Everybody with the application is an
   * editor, so there is nothing to approve: whoever holds the calendar's pen
   * books it, and anybody else reads it.
   *
   * Imports: util, dates, rc, icons, components, rc_util.
   */

  const { el, clear } = __req("core/util.js");
  const { toISO, addDays, todayMs } = __req("core/dates.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, selectInput, toast, field, emptyState } = __req("ui/components.js");


  const { ABSENCE_LABELS } = __req("core/lookahead.js");
  const { weekStart, todayISO, dayLabel, byId, availability, isoToMs, notifyChanged, formModal, nameRegister, absenceAssignments, lookaheadWithResources, goToTab } = __req("ui/rc_util.js");




  /** Which four weeks are on screen. Null means the one containing today. */
  let weekOf = null;

  /**
   * Four weeks, not one.
   *
   * Leave is arranged weeks ahead and the whole point of drawing it is to see it
   * coming; a one-week window shows you the holiday that started yesterday. Four
   * is also what the look-ahead is maintained to, so the sheet's own PTO row has
   * something to say across the whole view rather than only the first column of it.
   */
  const WEEKS = 4;

  async function render(root) {
    const startMs = weekOf ?? weekStart(todayMs());
    const days = [];
    for (let i = 0; i < WEEKS * 7; i++) days.push(toISO(addDays(startMs, i)));
    const from = days[0];
    const to = days[days.length - 1];
    const today = todayISO();

    /* Everybody active, managers included — see the header comment. */
    const [people, kinds, leave, sheet, aliases] = await Promise.all([
      rc.listPeople(),
      rc.listLeaveKinds().catch(() => []),
      rc.listLeave(from, to),
      lookaheadWithResources(from, to).catch(() => ({ rows: [], absences: [] })),
      rc.listPersonAliases().catch(() => []),
    ]);

    const kindsById = byId(kinds);
    const register = nameRegister(people, aliases);
    /* The same register and the same matching rules the Resource row gets: a name
       on the PTO row is the same kind of thing as a name on a Resource row, so
       there is one answer to "who is Victor" and not two that could differ. */
    /* PTO and work somewhere else — never the Office row. A day in the office
       is a day on this project's work, scheduled like any other; drawn here it
       read as somebody lent to another group, and filled the calendar with
       people who were exactly where the look-ahead put them. */
    const away = absenceAssignments((sheet.absences || []).filter((a) => a.kind !== 'office'), register);
    const redraw = () => { clear(root); render(root); };
    const admin = rc.canWrite();

    const host = el('div', { class: 'rc-pto' });
    root.appendChild(host);

    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('button', {
        class: 'cx-btn icon mini ghost',
        'aria-label': 'Previous week',
        html: icon('chevron-left', { size: 13 }),
        onClick: () => { weekOf = startMs - 7 * 86400000; redraw(); },
      }),
      el('h3', { text: `PTO — ${dayLabel(from, 'medium')} to ${dayLabel(to, 'medium')}` }),
      el('button', {
        class: 'cx-btn icon mini ghost',
        'aria-label': 'Next week',
        html: icon('chevron-right', { size: 13 }),
        onClick: () => { weekOf = startMs + 7 * 86400000; redraw(); },
      }),
      el('button', {
        class: 'cx-btn mini ghost',
        text: 'This week',
        onClick: () => { weekOf = null; redraw(); },
      }),
      admin ? el('button', {
        class: 'cx-btn mini primary',
        text: 'Book leave',
        onClick: () => bookLeave({ people, kinds, redraw }),
      }) : null,
    ].filter(Boolean)));

    if (!people.length) {
      host.appendChild(emptyState({
        iconName: 'users',
        title: 'Nobody on the roster yet',
        message: 'Leave is booked against people on the roster. Being on it never requires an account.',
        action: { label: 'Add people in Lists', onClick: () => goToTab('org') },
      }));
      return;
    }

    /* ── The calendar ─────────────────────────────────────────────────────── */

    const headCells = [el('th', { class: 'rc-pto-name', text: 'Person' })];
    for (const iso of days) {
      const ms = isoToMs(iso);
      const weekend = [0, 6].includes(new Date(ms).getUTCDay());
      headCells.push(el('th', {
        class: ['rc-pto-day', weekend ? 'rc-pto-weekend' : '', iso === today ? 'rc-pto-today' : '']
          .filter(Boolean).join(' '),
        // The weekday letter and the date, which is as much as a 28-column header
        // has room for and all anybody reads off it.
        html: `${'MTWTFSS'[(new Date(ms).getUTCDay() + 6) % 7]}<br>${iso.slice(8)}`,
        title: dayLabel(iso, 'medium'),
      }));
    }

    const body = el('tbody');
    let bookedDays = 0;
    let sheetOnly = 0;

    for (const person of people) {
      const mine = away.byPerson.get(person.id) || new Map();
      const cells = days.map((iso) => {
        /* A day carries a *list* of what the sheet said — PTO alone, or the
           work rows it names somebody on. Leave is what `availability()` acts
           on; the rest are drawn as what they are. */
        const kinds = mine.get(iso) || [];
        const state = availability(person, iso, leave, kinds.includes('pto') ? 'pto' : null);
        const sheetSays = kinds.includes('pto') ? 'pto' : (kinds[0] || null);
        const booked = state.leave || null;
        const classes = ['rc-pto-cell'];
        if (iso === today) classes.push('rc-pto-today');
        if ([0, 6].includes(new Date(isoToMs(iso)).getUTCDay())) classes.push('rc-pto-weekend');

        if (booked) {
          bookedDays++;
          classes.push('rc-pto-booked');
          if (sheetSays === 'pto') classes.push('rc-pto-agreed');
          return el('td', {
            class: classes.join(' '),
            'data-label': dayLabel(iso),
            /* The colour says "off"; the title says where that came from. That is
               the whole of what splitting the swatch used to buy, and it costs
               nothing to read it here instead. */
            title: [kindsById.get(booked.kind_id)?.name || 'Leave',
              'booked',
              booked.status !== 'approved' ? booked.status : null,
              sheetSays === 'pto' ? 'and the 4WLA says so too' : 'not on the 4WLA',
              booked.note].filter(Boolean).join(' · '),
            text: '',
          });
        }

        if (sheetSays === 'pto') {
          sheetOnly++;
          classes.push('rc-pto-sheet');
          /* Nothing booked, and the workbook says they are off. Not an error —
             it is how almost every absence on this project is recorded — so the
             cell offers to make it a record rather than complaining about it. */
          return el('td', {
            class: `${classes.join(' ')}${admin ? ' rc-clickable' : ''}`,
            'data-label': dayLabel(iso),
            title: `The 4WLA says ${person.name} is off on ${dayLabel(iso, 'medium')}, and nothing is `
              + 'booked. Everything reads it as leave either way; booking it makes a record that '
              + 'survives the sheet being edited.',
            onClick: admin
              ? () => bookLeave({ people, kinds, redraw, person, from: iso, to: iso })
              : null,
          });
        }

        /* Off the project but not off. Drawn so a day the sheet accounted for
           does not read as a blank here, and in a colour of its own rather than a
           shade of the leave one, so the two can never be mistaken: these are days
           somebody worked. */
        if (sheetSays === 'other') {
          classes.push('rc-pto-elsewhere');
          return el('td', {
            class: classes.join(' '),
            'data-label': dayLabel(iso),
            title: `The 4WLA has ${person.name} ${kinds.map((k) => ABSENCE_LABELS[k].toLowerCase())
              .join(' and ')} that day. That is work, not leave.`,
          });
        }

        if (state.state === 'non-working') classes.push('rc-pto-off');
        return el('td', { class: classes.join(' '), 'data-label': dayLabel(iso) });
      });

      body.appendChild(el('tr', {}, [
        el('td', { class: 'rc-pto-name', text: person.name }),
        ...cells,
      ]));
    }

    host.appendChild(el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table rc-pto-grid' }, [el('thead', {}, [el('tr', {}, headCells)]), body]),
    ]));

    /* Two swatches, because there are two facts.
       Leave is one colour however it was written down: booked in the application
       and typed into the 4WLA's PTO row are the same day off, and drawing them
       apart made a reader learn three swatches to answer one question. Where it
       came from is still said — in the cell's title, in the counts below, and in
       whether the day can be clicked to book it. */
    host.appendChild(el('div', { class: 'rc-pto-key' }, [
      key('rc-pto-booked', 'PTO — booked or on the 4WLA'),
      key('rc-pto-elsewhere', 'Other group / project — off this project, not off work'),
    ]));

    host.appendChild(el('p', {
      class: 'rc-hint',
      text: `${bookedDays} booked day(s) in this window, and ${sheetOnly} the 4WLA says are PTO with `
        + 'nothing booked against them. The second number is not a fault: the 4WLA is where '
        + 'most absences on this project are written down, and everything already reads it as leave. '
        + 'Booking one makes a record that survives the sheet being edited — click the day to do it.',
    }));

    /* ── Names the PTO row uses that the roster cannot place ──────────────── */

    if (away.unmatched.length) {
      host.appendChild(el('div', { style: 'height:20px' }));
      host.appendChild(el('div', { class: 'rc-section-head' }, [
        el('h3', { text: 'Named as away, not on the roster' }),
      ]));
      host.appendChild(el('div', { class: 'rc-scroll' }, [
        el('table', { class: 'rc-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'As written' }), el('th', { text: 'Days' }), el('th', { text: 'On' }), el('th', { text: 'Who it is' }),
          ])]),
          el('tbody', {}, away.unmatched.map((u) => el('tr', {}, [
            el('td', { text: u.name }),
            el('td', { class: 'rc-num', text: String(u.days.size) }),
            el('td', { class: 'rc-hint', text: [...u.kinds].map((k) => ABSENCE_LABELS[k] || k).join(', ') }),
            el('td', {}, admin ? [spellingPicker(u.name, people, redraw)] : []),
          ]))),
        ]),
      ]));
      host.appendChild(el('p', {
        class: 'rc-hint',
        text: 'These spellings are on the sheet’s PTO and Other Group rows and the roster cannot '
          + 'place them, so those days are not showing against anybody. Say who each is and the spelling '
          + 'is kept as theirs — the same register every name on the look-ahead is read through, so it is '
          + 'settled everywhere at once. Lists → People keeps every spelling.',
      }));
    }

    /* ── What is booked ───────────────────────────────────────────────────── */

    const booked = leave
      .filter((l) => l.status !== 'cancelled' && l.status !== 'declined' && l.status !== 'requested')
      .sort((a_, b_) => a_.start_date.localeCompare(b_.start_date));

    host.appendChild(el('div', { style: 'height:20px' }));
    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'Booked in this window' }),
    ]));

    if (!booked.length) {
      host.appendChild(el('p', {
        class: 'rc-hint',
        text: 'Nothing booked in these four weeks. Where the 4WLA names somebody on its PTO row the '
          + 'calendar above still shows it, and everything else still reads it as leave.',
      }));
    } else {
      const peopleById = byId(people);
      host.appendChild(el('div', { class: 'rc-scroll' }, [
        el('table', { class: 'rc-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Person' }), el('th', { text: 'From' }), el('th', { text: 'To' }),
            el('th', { text: 'Kind' }), el('th', { text: 'Note' }), el('th', { text: '' }),
          ])]),
          el('tbody', {}, booked.map((l) => el('tr', {}, [
            el('td', { text: peopleById.get(l.person_id)?.name || '—' }),
            el('td', { text: dayLabel(l.start_date, 'medium') }),
            el('td', { text: dayLabel(l.end_date, 'medium') }),
            el('td', { text: kindsById.get(l.kind_id)?.name || '—' }),
            el('td', { class: 'rc-hint', text: l.note || '' }),
            el('td', {}, admin ? [el('button', {
              class: 'cx-btn mini ghost',
              text: 'Cancel',
              title: 'It stays on the record as cancelled rather than disappearing.',
              onClick: async () => {
                try {
                  await rc.updateLeave(l.id, { status: 'cancelled' });
                  notifyChanged('leave');
                  toast({ message: 'Cancelled, and kept on the record as cancelled.' });
                  redraw();
                } catch (err) {
                  toast({ tone: 'bad', message: err?.message || String(err) });
                }
              },
            })] : []),
          ]))),
        ]),
      ]));
    }

    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Leave is why the editor can tell somebody away from somebody free. The full record, '
        + 'including cancelled leave, is in Lists → Leave; this is the four weeks anybody is actually staffing.',
    }));
  }

  /**
   * "This is Victor": map a spelling the sheet uses to somebody on the roster.
   * Kept as an alias of theirs, so it is matched exactly from then on — never a
   * guess, and settled for every row that writes it.
   */
  function spellingPicker(spelling, people, redraw) {
    const pick = selectInput({
      value: '',
      placeholder: 'Who is this?',
      options: people.map((p) => ({ value: p.id, label: p.name })),
      onChange: async (id) => {
        if (!id) return;
        try {
          await rc.addPersonAlias(id, spelling.trim());
          notifyChanged('people');
          toast({ tone: 'good', message: `"${spelling}" is ${people.find((p) => p.id === id)?.name || 'them'} from now on.` });
          redraw();
        } catch (err) {
          toast({ tone: 'bad', message: err?.message || String(err) });
        }
      },
    });
    pick.setAttribute('aria-label', `Who "${spelling}" is`);
    return pick;
  }

  /** One swatch and its meaning. The key is four cells, so it is drawn as cells. */
  function key(klass, label) {
    return el('span', { class: 'rc-pto-key-item' }, [
      el('span', { class: `rc-pto-swatch ${klass}` }),
      el('span', { text: label }),
    ]);
  }

  /**
   * Book leave, optionally already knowing whose and when.
   *
   * The same write Organisation makes — one `rc_leave` row — because a second way
   * of recording leave is a second answer to "is Dana off on Tuesday". Prefilled
   * when it is opened from a day on the calendar, so turning what the workbook
   * says into a record is a confirmation rather than a retype.
   */
  function bookLeave({ people, kinds, redraw, person = null, from = '', to = '' }) {
    const who = selectInput({
      value: person?.id || people[0]?.id,
      options: people.map((p) => ({ value: p.id, label: p.name })),
    });
    const start = el('input', { type: 'date', class: 'cx-input', value: from });
    const end = el('input', { type: 'date', class: 'cx-input', value: to });
    const kind = selectInput({
      value: kinds[0]?.id || '',
      placeholder: kinds.length ? undefined : '— no kinds set up —',
      options: kinds.map((k) => ({ value: k.id, label: k.name })),
    });
    const note = textInput({ placeholder: 'Optional', value: person && from ? 'From the 4WLA' : '' });

    formModal({
      title: person ? `Book leave for ${person.name}` : 'Book leave',
      body: el('div', { class: 'cx-form' }, [
        field('Person', who),
        field('From', start),
        field('To', end, 'Inclusive, as a calendar is.'),
        field('Kind', kind),
        field('Note', note),
        el('p', {
          class: 'rc-hint',
          text: 'Everything already reads the 4WLA’s PTO row as leave. Booking it makes a record '
            + 'that survives somebody editing the sheet, and gives the day a kind.',
        }),
      ]),
      confirmLabel: 'Book',
      onConfirm: async () => {
        if (!start.value || !end.value) throw new Error('Both dates are needed.');
        if (end.value < start.value) throw new Error('The end is before the start.');
        const row = {
          person_id: who.value,
          start_date: start.value,
          end_date: end.value,
          kind_id: kind.value || null,
          note: note.value.trim() || null,
        };
        await rc.addLeave(row);
        notifyChanged('leave');
        toast({ tone: 'good', message: 'Leave booked.' });
        redraw();
      },
    });
  }

  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
};

// io/tawr_pdf.js
__mods["io/tawr_pdf.js"] = function (__x, __req) {
  /**
   * Filling BART's TAWR form — a fillable PDF, read and written here.
   *
   * Why by hand, like `io/pdf.js`: the job is narrow. Find the form's fields by
   * name, give each a value and an appearance, draw one signature, and leave the
   * rest of the file exactly as it was. That is a PDF reader good enough to walk
   * the cross-reference and the field tree, and an *incremental update*: the
   * changed objects appended after the original bytes, with a new
   * cross-reference pointing at them. The original is never rewritten, so the
   * form stays a form — fillable in Acrobat afterwards, its two signature boxes
   * still signable — and nothing a library would have to bring with it is in the
   * calendar's bundle.
   *
   * **Every value gets its own appearance.** A field's value and what it looks
   * like are separate in a PDF, and a viewer that does not rebuild appearances
   * (most of them, and every printer) shows only the second. So each filled text
   * box is drawn here, at the size that fits it: a single line shrinks until it
   * fits across and down its box, the work description wraps and shrinks until
   * every line fits. What still does not fit at the smallest legible size is
   * reported, so the review can say so instead of the form quietly losing words.
   *
   * Reads both shapes a form arrives in: a classic cross-reference table (how
   * the template was saved) and cross-reference and object streams (how Acrobat
   * re-saves one). An encrypted file is refused with a reason.
   *
   * No DOM, so `tools/test_tawr.js` fills a form and reads it back in Node.
   *
   * Imports: inflate, pdf.
   */

  const { inflateRaw } = __req("io/inflate.js");
  const { textWidth } = __req("io/pdf.js");

  /* ══════════════════════════════════════════════════════════════════════════
     Reading objects
     ═══════════════════════════════════════════════════════════════════════ */

  /*
   * Values, as this module holds them:
   *   number, true/false, null      as themselves
   *   name   /Helv                  { n: 'Helv' }
   *   string (text) or <hex>        { s: '…' } — one char per byte
   *   array                         [ … ]
   *   dict                          { d: { Key: value } }
   *   reference 12 0 R              { r: 12, g: 0 }
   *   stream                        { d: {…}, stream: Uint8Array } (raw bytes)
   */

  const WS = new Set([0, 9, 10, 12, 13, 32]);
  const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

  function latin1(bytes, from = 0, to = bytes.length) {
    let out = '';
    for (let i = from; i < to; i += 8192) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(to, i + 8192)));
    }
    return out;
  }

  function bytesOf(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  class Lexer {
    constructor(bytes, pos = 0) {
      this.b = bytes;
      this.pos = pos;
    }

    skip() {
      const b = this.b;
      for (;;) {
        while (this.pos < b.length && WS.has(b[this.pos])) this.pos++;
        if (b[this.pos] === 37) { // % comment, to end of line
          while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
          continue;
        }
        return;
      }
    }

    /** The next bare word or number, without consuming it. */
    peekWord() {
      const save = this.pos;
      this.skip();
      const w = this.word();
      this.pos = save;
      return w;
    }

    word() {
      const b = this.b;
      const start = this.pos;
      while (this.pos < b.length && !WS.has(b[this.pos]) && !DELIM.has(b[this.pos])) this.pos++;
      return latin1(b, start, this.pos);
    }

    value() {
      this.skip();
      const b = this.b;
      const c = b[this.pos];
      if (c === 47) { // /Name
        this.pos++;
        const raw = this.word();
        return { n: raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
      }
      if (c === 40) return { s: this.literal() };
      if (c === 60 && b[this.pos + 1] === 60) {
        this.pos += 2;
        const d = {};
        for (;;) {
          this.skip();
          if (b[this.pos] === 62 && b[this.pos + 1] === 62) { this.pos += 2; break; }
          if (this.pos >= b.length) throw new Error('This PDF is damaged: a dictionary never ends.');
          const key = this.value();
          if (!key || key.n === undefined) throw new Error('This PDF is damaged: a dictionary key is not a name.');
          d[key.n] = this.value();
        }
        return { d };
      }
      if (c === 60) { // <hex>
        this.pos++;
        let hex = '';
        while (this.pos < b.length && b[this.pos] !== 62) {
          const ch = String.fromCharCode(b[this.pos++]);
          if (/[0-9a-fA-F]/.test(ch)) hex += ch;
        }
        this.pos++;
        if (hex.length % 2) hex += '0';
        let s = '';
        for (let i = 0; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        return { s };
      }
      if (c === 91) {
        this.pos++;
        const arr = [];
        for (;;) {
          this.skip();
          if (b[this.pos] === 93) { this.pos++; break; }
          if (this.pos >= b.length) throw new Error('This PDF is damaged: an array never ends.');
          arr.push(this.value());
        }
        return arr;
      }
      const w = this.word();
      if (w === 'true') return true;
      if (w === 'false') return false;
      if (w === 'null') return null;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) {
        const n = Number(w);
        // "12 0 R" is a reference: two integers and the letter R.
        if (/^\d+$/.test(w)) {
          const save = this.pos;
          this.skip();
          const g = this.word();
          if (/^\d+$/.test(g)) {
            this.skip();
            if (this.b[this.pos] === 82 && (this.pos + 1 >= this.b.length || WS.has(this.b[this.pos + 1]) || DELIM.has(this.b[this.pos + 1]))) {
              this.pos++;
              return { r: n, g: Number(g) };
            }
          }
          this.pos = save;
        }
        return n;
      }
      if (!w) throw new Error(`This PDF is damaged: unexpected byte ${c} at ${this.pos}.`);
      return { op: w };
    }

    literal() {
      const b = this.b;
      this.pos++;
      let depth = 1;
      let out = '';
      while (this.pos < b.length) {
        const c = b[this.pos++];
        if (c === 92) { // backslash
          const e = b[this.pos++];
          const map = { 110: '\n', 114: '\r', 116: '\t', 98: '\b', 102: '\f', 40: '(', 41: ')', 92: '\\' };
          if (map[e] !== undefined) out += map[e];
          else if (e >= 48 && e <= 55) {
            let oct = String.fromCharCode(e);
            for (let k = 0; k < 2 && b[this.pos] >= 48 && b[this.pos] <= 55; k++) oct += String.fromCharCode(b[this.pos++]);
            out += String.fromCharCode(parseInt(oct, 8) & 0xff);
          } else if (e === 13) { if (b[this.pos] === 10) this.pos++; } // line continuation
          else if (e === 10) { /* line continuation */ } else out += String.fromCharCode(e);
          continue;
        }
        if (c === 40) depth++;
        if (c === 41 && --depth === 0) break;
        out += String.fromCharCode(c);
      }
      return out;
    }
  }

  /* ── Streams ───────────────────────────────────────────────────────────── */

  function zlibInflate(data) {
    // A zlib stream is a two-byte header, raw DEFLATE, and a checksum the
    // inflater stops before reaching.
    return inflateRaw(data.subarray(2));
  }

  function unpredict(data, parms) {
    const predictor = parms?.Predictor || 1;
    if (predictor < 10) return data;
    const colors = parms.Colors || 1;
    const bpc = parms.BitsPerComponent || 8;
    const columns = parms.Columns || 1;
    const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
    const rowLen = Math.ceil((colors * bpc * columns) / 8);
    const rows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(rows * rowLen);
    let prev = new Uint8Array(rowLen);
    for (let r = 0; r < rows; r++) {
      const type = data[r * (rowLen + 1)];
      const row = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
      const cur = new Uint8Array(rowLen);
      for (let i = 0; i < rowLen; i++) {
        const left = i >= bpp ? cur[i - bpp] : 0;
        const up = prev[i];
        const ul = i >= bpp ? prev[i - bpp] : 0;
        let v = row[i];
        if (type === 1) v += left;
        else if (type === 2) v += up;
        else if (type === 3) v += (left + up) >> 1;
        else if (type === 4) {
          const p = left + up - ul;
          const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - ul);
          v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
        }
        cur[i] = v & 0xff;
      }
      out.set(cur, r * rowLen);
      prev = cur;
    }
    return out;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The document
     ═══════════════════════════════════════════════════════════════════════ */

  class Doc {
    constructor(bytes) {
      this.bytes = bytes;
      this.entries = new Map(); // num → { type: 1, offset, gen } | { type: 2, stm, idx }
      this.cache = new Map();
      this.objStreams = new Map();
      const head = latin1(bytes, 0, Math.min(bytes.length, 1024));
      if (!/%PDF-\d/.test(head)) throw new Error('That file is not a PDF.');
      const tail = latin1(bytes, Math.max(0, bytes.length - 2048));
      const at = tail.lastIndexOf('startxref');
      if (at < 0) throw new Error('This PDF is damaged: it has no cross-reference.');
      this.startxref = Number(tail.slice(at + 9).trim().split(/\s+/)[0]);
      this.trailer = null;
      this.xrefIsStream = false;
      const seen = new Set();
      let offset = this.startxref;
      let first = true;
      while (Number.isFinite(offset) && !seen.has(offset)) {
        seen.add(offset);
        const t = this.readXref(offset, first);
        if (first) this.trailer = t;
        first = false;
        if (t.d.XRefStm != null) this.readXref(t.d.XRefStm, false);
        offset = t.d.Prev;
      }
      if (!this.trailer) throw new Error('This PDF is damaged: it has no trailer.');
      if (this.trailer.d.Encrypt) {
        throw new Error('This PDF is password-protected or encrypted. Save a copy without security in Acrobat and upload that.');
      }
    }

    setEntry(num, entry) {
      if (!this.entries.has(num)) this.entries.set(num, entry);
    }

    readXref(offset, first) {
      const lx = new Lexer(this.bytes, offset);
      lx.skip();
      if (lx.peekWord() === 'xref') {
        lx.word();
        for (;;) {
          lx.skip();
          const w = lx.peekWord();
          if (w === 'trailer') { lx.word(); break; }
          const start = Number(lx.word());
          lx.skip();
          const count = Number(lx.word());
          if (!Number.isFinite(start) || !Number.isFinite(count)) throw new Error('This PDF is damaged: its cross-reference table cannot be read.');
          for (let i = 0; i < count; i++) {
            lx.skip();
            const off = Number(lx.word()); lx.skip();
            const gen = Number(lx.word()); lx.skip();
            const kind = lx.word();
            if (kind === 'n' && off > 0) this.setEntry(start + i, { type: 1, offset: off, gen });
            else this.setEntry(start + i, { type: 0 });
          }
        }
        return lx.value();
      }
      // A cross-reference stream: "N G obj << /Type /XRef … >> stream".
      const obj = this.parseIndirectAt(offset);
      if (obj?.d?.Type?.n !== 'XRef') throw new Error('This PDF is damaged: its cross-reference cannot be found.');
      if (first) this.xrefIsStream = true;
      const data = this.decode(obj);
      const W = obj.d.W;
      const index = obj.d.Index || [0, obj.d.Size];
      const width = W[0] + W[1] + W[2];
      let p = 0;
      const field = (n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + data[p++]; return v; };
      for (let s = 0; s < index.length; s += 2) {
        for (let i = 0; i < index[s + 1]; i++) {
          if (p + width > data.length) break;
          const type = W[0] ? field(W[0]) : 1;
          const a = field(W[1]);
          const b = field(W[2]);
          const num = index[s] + i;
          if (type === 1) this.setEntry(num, { type: 1, offset: a, gen: b });
          else if (type === 2) this.setEntry(num, { type: 2, stm: a, idx: b });
          else this.setEntry(num, { type: 0 });
        }
      }
      return obj;
    }

    parseIndirectAt(offset) {
      const lx = new Lexer(this.bytes, offset);
      lx.skip(); lx.word(); lx.skip(); lx.word(); lx.skip();
      const kw = lx.word();
      if (kw !== 'obj') throw new Error(`This PDF is damaged: no object at offset ${offset}.`);
      const value = lx.value();
      lx.skip();
      if (value && value.d && lx.peekWord() === 'stream') {
        lx.word();
        if (this.bytes[lx.pos] === 13) lx.pos++;
        if (this.bytes[lx.pos] === 10) lx.pos++;
        let length = value.d.Length;
        if (length && length.r !== undefined) length = this.get(length);
        if (!Number.isFinite(length)) {
          // A length nobody wrote: find the end marker instead.
          const rest = latin1(this.bytes, lx.pos, Math.min(this.bytes.length, lx.pos + 10_000_000));
          length = rest.indexOf('endstream');
          while (length > 0 && /[\r\n]/.test(rest[length - 1])) length--;
        }
        return { d: value.d, stream: this.bytes.subarray(lx.pos, lx.pos + length) };
      }
      return value;
    }

    /** The object a reference points at, or the value itself if it is not one. */
    get(ref) {
      if (!ref || ref.r === undefined) return ref;
      if (this.cache.has(ref.r)) return this.cache.get(ref.r);
      const entry = this.entries.get(ref.r);
      let value = null;
      if (entry?.type === 1) value = this.parseIndirectAt(entry.offset);
      else if (entry?.type === 2) value = this.fromObjStream(entry.stm, entry.idx, ref.r);
      this.cache.set(ref.r, value);
      return value;
    }

    fromObjStream(stmNum, idx, num) {
      let held = this.objStreams.get(stmNum);
      if (!held) {
        const stm = this.get({ r: stmNum, g: 0 });
        const data = this.decode(stm);
        const lx = new Lexer(data, 0);
        const offsets = new Map();
        for (let i = 0; i < stm.d.N; i++) {
          const n = lx.value();
          const off = lx.value();
          offsets.set(n, off);
        }
        held = { data, first: stm.d.First, offsets };
        this.objStreams.set(stmNum, held);
      }
      const off = held.offsets.get(num);
      if (off === undefined) return null;
      return new Lexer(held.data, held.first + off).value();
    }

    decode(stream) {
      let data = stream.stream;
      const filters = [].concat(stream.d.Filter || []).map((f) => f.n);
      const parms = [].concat(stream.d.DecodeParms || []);
      filters.forEach((f, i) => {
        if (f !== 'FlateDecode') throw new Error(`This PDF uses a compression this form filler does not read (${f}).`);
        data = unpredict(zlibInflate(data), this.get(parms[i])?.d);
      });
      return data;
    }

    size() {
      return Math.max(Number(this.trailer.d.Size) || 0, ...[...this.entries.keys()].map((n) => n + 1));
    }
  }

  /* ── Text strings ──────────────────────────────────────────────────────── */

  /** A PDF text string, as text: UTF-16 where it says so, else one byte per character. */
  function textOf(value) {
    if (value == null) return null;
    if (value.n !== undefined) return value.n;
    if (value.s === undefined) return null;
    const s = value.s;
    if (s.charCodeAt(0) === 0xfe && s.charCodeAt(1) === 0xff) {
      let out = '';
      for (let i = 2; i + 1 < s.length; i += 2) out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
      return out;
    }
    return s;
  }

  /** Text as a PDF string: plain where it is plain, UTF-16 with a byte-order mark where not. */
  function pdfText(text) {
    const t = String(text ?? '');
    if (/^[\x20-\x7e\n\r\t]*$/.test(t)) return { s: t };
    let s = '\xfe\xff';
    for (const ch of t) {
      const code = ch.codePointAt(0);
      if (code > 0xffff) {
        const v = code - 0x10000;
        const hi = 0xd800 + (v >> 10); const lo = 0xdc00 + (v & 0x3ff);
        s += String.fromCharCode(hi >> 8, hi & 0xff, lo >> 8, lo & 0xff);
      } else s += String.fromCharCode(code >> 8, code & 0xff);
    }
    return { s };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The form
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Which version of this filler wrote a PDF — stamped into every form it fills
   * (`/CxTimelineFiller` on the AcroForm) and shown in TAWR → Setup, so a download
   * that looks wrong can be traced to the code that made it. Raise it whenever
   * what this module writes changes.
   */
  const FILLER_VERSION = 5;

  const KIND = { Tx: 'text', Btn: 'check', Ch: 'choice', Sig: 'sig' };

  /**
   * The date format a field's own script insists on — `AFDate_FormatEx("mm/dd/yyyy")`
   * on BART's date boxes — or null.
   *
   * Acrobat runs that script whenever it shows the field, and a value it cannot
   * read as a date in that format is shown as *nothing*: "10/19/26" in an
   * mm/dd/yyyy box was a blank date until somebody clicked into it. So a date is
   * written the way the box asks for it.
   */
  function dateFormatOf(doc, aaRef) {
    const aa = doc.get(aaRef);
    const action = doc.get(aa?.d?.F);
    let js = doc.get(action?.d?.JS);
    if (js?.stream) js = { s: latin1(doc.decode(js)) };
    const text = textOf(js) || '';
    return (text.match(/AFDate_FormatEx\(\s*"([^"]+)"\s*\)/) || [])[1] || null;
  }

  /**
   * A date written as "10/19/26", "10/19/2026" or "2026-10-19", in a format
   * spelled the Acrobat way (mm, m, dd, d, yyyy, yy). Anything that is not a
   * date is left exactly as it was typed.
   */
  function formatDateAs(value, format) {
    const t = String(value ?? '').trim();
    let y; let m; let d;
    let hit = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (hit) [, y, m, d] = hit.map(Number);
    else if ((hit = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
      [, m, d, y] = hit.map(Number);
      if (hit[3].length === 2) y += 2000;
    } else return t;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return t;
    const pad = (n) => String(n).padStart(2, '0');
    return format.replace(/yyyy|yy|mm|m|dd|d/g, (tok) => ({
      yyyy: String(y), yy: pad(y % 100), mm: pad(m), m: String(m), dd: pad(d), d: String(d),
    })[tok]);
  }

  function walkFields(doc) {
    const catalog = doc.get(doc.trailer.d.Root);
    const acro = doc.get(catalog?.d?.AcroForm);
    const out = [];
    if (!acro?.d?.Fields) return { acro: null, fields: out, catalog };

    // Which page each widget sits on, for widgets that do not say.
    const pageOf = new Map();
    const pages = [];
    const visit = (ref, depth = 0) => {
      const node = doc.get(ref);
      if (!node?.d || depth > 50) return;
      if (node.d.Type?.n === 'Pages' || node.d.Kids) {
        for (const kid of doc.get(node.d.Kids) || []) visit(kid, depth + 1);
        return;
      }
      pages.push(ref);
      for (const a of doc.get(node.d.Annots) || []) if (a?.r !== undefined) pageOf.set(a.r, ref);
    };
    visit(catalog.d.Pages);

    const walk = (ref, parentName, inherited, depth = 0) => {
      const node = doc.get(ref);
      if (!node?.d || depth > 50) return;
      const d = node.d;
      const partial = textOf(d.T);
      const name = partial == null ? parentName : (parentName ? `${parentName}.${partial}` : partial);
      const inh = {
        FT: d.FT || inherited.FT, Ff: d.Ff ?? inherited.Ff, DA: d.DA || inherited.DA,
        Q: d.Q ?? inherited.Q, Opt: d.Opt || inherited.Opt, V: d.V !== undefined ? d.V : inherited.V,
        MaxLen: d.MaxLen ?? inherited.MaxLen,
      };
      const kids = (doc.get(d.Kids) || []).filter((k) => k?.r !== undefined);
      const kidFields = kids.filter((k) => doc.get(k)?.d?.T !== undefined);
      if (kidFields.length) {
        for (const k of kids) walk(k, name, inh, depth + 1);
        return;
      }
      // A terminal field: itself a widget, or the parent of widgets with no names.
      const widgets = kids.length ? kids : [ref];
      const ff = Number(doc.get(inh.Ff) || 0);
      let kind = KIND[inh.FT?.n] || 'other';
      if (kind === 'check' && ff & (1 << 16)) kind = 'button';
      if (kind === 'check' && ff & (1 << 15)) kind = 'radio';
      const first = doc.get(widgets[0]);
      const onStates = new Set();
      for (const w of widgets) {
        const n = doc.get(doc.get(doc.get(w)?.d?.AP)?.d?.N);
        for (const key of Object.keys(n?.d || {})) if (key !== 'Off') onStates.add(key);
      }
      const options = (doc.get(inh.Opt) || []).map((o) => {
        const v = doc.get(o);
        return Array.isArray(v) ? textOf(doc.get(v[1])) : textOf(v);
      }).filter((o) => o != null);
      out.push({
        name,
        kind,
        ref,
        value: textOf(doc.get(inh.V)),
        onState: [...onStates][0] || null,
        options,
        multiline: kind === 'text' && Boolean(ff & (1 << 12)),
        da: textOf(doc.get(inh.DA)) || textOf(doc.get(acro.d.DA)) || '/Helv 9 Tf 0 g',
        q: Number(doc.get(inh.Q) || 0),
        widgets: widgets.map((w) => ({
          ref: w,
          // A box may state its own size apart from its field — Acrobat splits
          // them when a form is edited — and the box's own word wins.
          da: textOf(doc.get(doc.get(w)?.d?.DA)) || null,
          rect: (doc.get(doc.get(w)?.d?.Rect) || [0, 0, 0, 0]).map((x) => Number(doc.get(x))),
          page: doc.get(w)?.d?.P || pageOf.get(w.r) || null,
        })),
        readOnly: Boolean(ff & 1),
        dateFormat: dateFormatOf(doc, d.AA || first?.d?.AA),
        rect: (doc.get(first?.d?.Rect) || [0, 0, 0, 0]).map((x) => Number(doc.get(x))),
      });
    };
    for (const f of doc.get(acro.d.Fields) || []) walk(f, '', {});
    return { acro, fields: out, catalog, pages };
  }

  /**
   * The fields of a fillable PDF: `{ fields: [{ name, kind, value, onState,
   * options, multiline, rect }] }`. Throws, with a sentence somebody can act on,
   * for a file that is not a PDF, is damaged, or is encrypted.
   */
  function readForm(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const doc = new Doc(data);
    const { fields, acro } = walkFields(doc);
    return {
      filler: textOf(doc.get(acro?.d?.CxTimelineFiller)) || null,
      needAppearances: doc.get(acro?.d?.NeedAppearances) === true,
      fields: fields.map(({ name, kind, value, onState, options, multiline, rect, da, widgets }) => ({
        name, kind, value, onState, options, multiline, rect, da,
        // The size each of its boxes says it is, where a box says one of its own.
        widgetDa: widgets.map((w) => w.da),
      })),
    };
  }

  /** The names asked for that the form does not have. */
  function missingFields(form, names) {
    const have = new Set((form?.fields || []).map((f) => f.name));
    return names.filter((n) => !have.has(n));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Writing
     ═══════════════════════════════════════════════════════════════════════ */

  function num(n) {
    if (Number.isInteger(n)) return String(n);
    return (Math.round(n * 10000) / 10000).toFixed(4).replace(/\.?0+$/, '');
  }

  function nameOut(n) {
    return `/${String(n).replace(/[^\x21-\x7e]|[#()<>[\]{}/%]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}`;
  }

  function stringOut(s) {
    if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
    let hex = '';
    for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(2, '0');
    return `<${hex}>`;
  }

  function serialize(v) {
    if (v === null || v === undefined) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') return num(v);
    if (Array.isArray(v)) return `[${v.map(serialize).join(' ')}]`;
    if (v.r !== undefined) return `${v.r} ${v.g || 0} R`;
    if (v.n !== undefined) return nameOut(v.n);
    if (v.s !== undefined) return stringOut(v.s);
    if (v.d) return `<<${Object.entries(v.d).map(([k, x]) => `${nameOut(k)} ${serialize(x)}`).join(' ')}>>`;
    if (v.op) return v.op;
    return 'null';
  }

  /* ── Fonts and text ────────────────────────────────────────────────────── */

  /* WinAnsi, for the characters past ASCII that a description is likely to hold. */
  const WINANSI = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
    0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
    0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
  };

  function winAnsi(text) {
    let out = '';
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      if (c >= 0x20 && c <= 0x7e) out += ch;
      else if (c >= 0xa0 && c <= 0xff) out += String.fromCharCode(c);
      else if (WINANSI[c]) out += String.fromCharCode(WINANSI[c]);
      else if (c === 9) out += ' ';
      else out += '?';
    }
    return out;
  }

  const widthOf = (text, size) => textWidth(text, size, 'F1');

  /** "/Helv 9 Tf 0 g" → { font, size, color } */
  function parseDA(da) {
    const font = (da.match(/\/([^\s/]+)\s+[\d.]+\s+Tf/) || [])[1] || 'Helv';
    const size = Number((da.match(/\/[^\s/]+\s+([\d.]+)\s+Tf/) || [])[1] || 0);
    const rgb = da.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
    const gray = da.match(/([\d.]+)\s+g\b/);
    const color = rgb ? `${rgb[1]} ${rgb[2]} ${rgb[3]} rg` : gray ? `${gray[1]} g` : '0 g';
    return { font, size, color };
  }

  /** A DA with its font size set — added if the DA names none. Never 0, which is "auto". */
  function sizedDA(da, size) {
    const text = String(da || '/Helv 9 Tf 0 g');
    return /\/[^\s/]+\s+[\d.]+\s+Tf/.test(text)
      ? text.replace(/(\/[^\s/]+\s+)[\d.]+(\s+Tf)/, `$1${num(size)}$2`)
      : `/Helv ${num(size)} Tf ${text}`.trim();
  }

  /** Lines of text that fit `width` at `size`, keeping the line breaks that were typed. */
  function wrap(text, size, width) {
    const lines = [];
    for (const para of String(text).split(/\r\n|\r|\n/)) {
      const words = para.split(/(\s+)/).filter((w) => w !== '');
      let line = '';
      for (const w of words) {
        const next = line + w;
        if (!line || widthOf(next.trimEnd(), size) <= width) { line = next; continue; }
        lines.push(line.trimEnd());
        line = w.trimStart();
        // A single word wider than the box is broken where it has to be.
        while (widthOf(line, size) > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && widthOf(line.slice(0, cut), size) > width) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  const MIN_SIZE = 4;

  /**
   * The appearance of a filled text box, and whether it fits.
   *
   * Single line: the form's own size, shrunk until the text fits across the box
   * and its glyphs fit inside it top to bottom. Multi-line: wrapped, and shrunk a
   * quarter point at a time until every line is inside the box.
   */
  function layoutText(text, field, w, h, size0 = null) {
    const { size: daSize } = parseDA(field.da);
    const start = size0 || daSize || 12;
    const pad = 2;
    if (field.multiline) {
      for (let size = start; size >= MIN_SIZE; size -= 0.25) {
        const lines = wrap(text, size, w - pad * 2);
        if (lines.length * size * 1.15 <= h - pad) return { size, lines, fits: true, h };
      }
      return { size: MIN_SIZE, lines: wrap(text, MIN_SIZE, w - pad * 2), fits: false, h };
    }
    const flat = String(text).replace(/\s*[\r\n]+\s*/g, ' ');
    /* Letters top to tail are 0.93 of the size. With a size asked for, a box too
       short for it is made taller (upwards, so the text stays on its line);
       without one, the text shrinks to the box. Width only ever shrinks it. */
    let size = size0 ? start : Math.min(start, Math.max(MIN_SIZE, (h - 0.2) / 0.9));
    const avail = w - pad * 2;
    const full = widthOf(flat, size);
    if (full > avail) size = Math.max(MIN_SIZE, Math.floor((size * avail / full) * 4) / 4);
    const tall = size0 ? Math.max(h, size * 0.93 + 0.4) : h;
    return { size, lines: [flat], fits: widthOf(flat, size) <= avail + 0.01, h: tall };
  }

  function textAppearance(text, field, w, h0, fontName, size0 = null) {
    const { color } = parseDA(field.da);
    const layout = layoutText(text, field, w, h0, size0);
    const { size, lines, h } = layout;
    const pad = 2;
    // A single line is clipped to the box itself: its boxes are barely taller
    // than the text, and an inset clip cuts the tops and tails off the letters.
    const clip = field.multiline
      ? `1 1 ${num(Math.max(0, w - 2))} ${num(Math.max(0, h - 2))} re W n`
      : `0 0 ${num(w)} ${num(h)} re W n`;
    const ops = ['/Tx BMC', 'q', clip, 'BT', `/${fontName} ${num(size)} Tf`, color];
    const lead = size * 1.15;
    let y = field.multiline ? h - pad - size * 0.8 : 0.21 * size + (h - 0.93 * size) / 2;
    lines.forEach((line, i) => {
      const encoded = winAnsi(line);
      const lw = widthOf(encoded, size);
      const x = field.q === 1 ? (w - lw) / 2 : field.q === 2 ? w - pad - lw : pad;
      ops.push(`1 0 0 1 ${num(x)} ${num(y - (field.multiline ? i * lead : 0))} Tm`);
      ops.push(`${stringOut(encoded)} Tj`);
    });
    ops.push('ET', 'Q', 'EMC');
    return { content: ops.join('\n'), size: layout.size, fits: layout.fits, daSize: parseDA(field.da).size, h };
  }

  /* ── The signature ─────────────────────────────────────────────────────── */

  /**
   * Strokes drawn on a pad, `{ width, height, strokes: [[[x, y], …], …] }` with y
   * running down, fitted into a box on the page and drawn as lines — a vector
   * signature, a few hundred bytes, as sharp printed as on screen.
   */
  function signatureContent(sig, [x1, y1, x2, y2]) {
    const bw = Math.abs(x2 - x1);
    const bh = Math.abs(y2 - y1);
    const left = Math.min(x1, x2);
    const bottom = Math.min(y1, y2);
    const pts = sig.strokes.flat();
    if (!pts.length) return null;
    const minX = Math.min(...pts.map((p) => p[0])); const maxX = Math.max(...pts.map((p) => p[0]));
    const minY = Math.min(...pts.map((p) => p[1])); const maxY = Math.max(...pts.map((p) => p[1]));
    const sw = Math.max(1, maxX - minX);
    const sh = Math.max(1, maxY - minY);
    const pad = 1;
    const scale = Math.min((bw - pad * 2) / sw, (bh - pad * 2) / sh);
    const ox = left + (bw - sw * scale) / 2;
    const oy = bottom + (bh - sh * scale) / 2;
    const at = ([px, py]) => `${num(ox + (px - minX) * scale)} ${num(oy + (maxY - py) * scale)}`;
    const ops = ['q', '0 0 0 RG', '1 J', '1 j', `${num(Math.max(0.5, Math.min(1.2, bh / 14)))} w`];
    for (const stroke of sig.strokes) {
      if (!stroke.length) continue;
      ops.push(`${at(stroke[0])} m`);
      if (stroke.length === 1) ops.push(`${at(stroke[0])} l`);
      for (const p of stroke.slice(1)) ops.push(`${at(p)} l`);
      ops.push('S');
    }
    ops.push('Q');
    return ops.join('\n');
  }

  /* ── Filling ───────────────────────────────────────────────────────────── */

  /**
   * Fill a form and answer `{ bytes, report }`.
   *
   *   values     `{ field: string | boolean }` — a string for a text box or a
   *              dropdown, true or false for a checkbox. A field not named is
   *              left exactly as it was.
   *   signature  `{ field, width, height, strokes }` — drawn in that field's box.
   *   textSize   one size for every box — a number, or the name of a field whose
   *              size to match. Every text box and dropdown is set to it, filled or
   *              blank, and so is the form's default, so nothing is left on auto.
   *              A box too short for it is made taller, upwards; only text too wide
   *              for its box is shrunk.
   *
   * `report.fields[name]` says, for every text box filled, the size it was drawn
   * at and whether it fitted; `report.unknown` names values for fields the form
   * does not have.
   */
  function fillForm(bytes, values, { signature = null, textSize = null } = {}) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const doc = new Doc(data);
    const { acro, fields } = walkFields(doc);
    if (!acro) throw new Error('This PDF has no fillable fields.');
    const byName = new Map(fields.map((f) => [f.name, f]));
    // One size for every filled box: a number, or the size another field is set at.
    const size0 = typeof textSize === 'string'
      ? (parseDA(byName.get(textSize)?.da || '').size || null)
      : (Number(textSize) || null);

    let next = doc.size();
    const changed = new Map(); // num → { gen, value }
    const added = [];          // { num, value }
    const objectOf = (ref) => {
      if (changed.has(ref.r)) return changed.get(ref.r).value;
      const v = doc.get(ref);
      const copy = { d: { ...(v?.d || {}) } };
      if (v?.stream) copy.stream = v.stream;
      changed.set(ref.r, { gen: ref.g || 0, value: copy });
      return copy;
    };
    const addObject = (value) => {
      const n = next++;
      added.push({ num: n, value });
      return { r: n, g: 0 };
    };

    // One Helvetica of our own for every appearance: WinAnsi, so a dash or a
    // curly quote is drawn as itself whatever the form's own font resource says.
    const font = addObject({ d: { Type: { n: 'Font' }, Subtype: { n: 'Type1' }, BaseFont: { n: 'Helvetica' }, Encoding: { n: 'WinAnsiEncoding' } } });

    const report = { fields: {}, unknown: [], appearances: 0, signature: false };

    for (const [name, value] of Object.entries(values || {})) {
      const field = byName.get(name);
      if (!field) { report.unknown.push(name); continue; }
      const fieldObj = objectOf(field.ref);

      if (field.kind === 'check' || field.kind === 'radio') {
        const on = field.onState || 'Yes';
        const state = value === true || value === on || value === 'Yes' ? on : 'Off';
        fieldObj.d.V = { n: state };
        for (const w of field.widgets) {
          const wo = objectOf(w.ref);
          const states = Object.keys(doc.get(doc.get(doc.get(w.ref)?.d?.AP)?.d?.N)?.d || {});
          wo.d.AS = { n: states.includes(state) ? state : 'Off' };
        }
        continue;
      }
      if (field.kind !== 'text' && field.kind !== 'choice') continue;

      const text = field.dateFormat ? formatDateAs(value, field.dateFormat) : String(value ?? '');
      fieldObj.d.V = pdfText(text);
      for (const w of field.widgets) {
        const wo = objectOf(w.ref);
        const da = w.da || field.da;
        const { font: fontName } = parseDA(da);
        const [x1, y1, x2, y2] = w.rect;
        const bw = Math.abs(x2 - x1);
        const bh = Math.abs(y2 - y1);
        const ap = textAppearance(text, { ...field, da }, bw, bh, fontName, size0);
        if (ap.h > bh + 0.001) {
          // Taller upwards from its bottom edge — the line the text sits on.
          const left = Math.min(x1, x2); const bottom = Math.min(y1, y2);
          wo.d.Rect = [left, bottom, left + bw, bottom + ap.h];
        }
        const stream = addObject({
          d: {
            Type: { n: 'XObject' }, Subtype: { n: 'Form' }, BBox: [0, 0, bw, ap.h],
            Resources: { d: { Font: { d: { [fontName]: font } } } },
          },
          stream: bytesOf(ap.content),
        });
        wo.d.AP = { d: { N: stream } };
        /* The size it was drawn at is written into the field as well. Acrobat
           redraws a field from its own declared size whenever it saves or edits
           the form, so a field left at the form's 9 pt redrew too big for its box,
           and one set to auto size — tried once — redrew at 4 pt. Declaring the
           size drawn here makes the two agree. */
        if (text || size0) {
          wo.d.DA = { s: sizedDA(da, text ? ap.size : size0) };
          if (fieldObj !== wo && fieldObj.d.DA) fieldObj.d.DA = { s: sizedDA(textOf(fieldObj.d.DA), text ? ap.size : size0) };
        }
        report.appearances++;
        if (text) report.fields[name] = { size: ap.size, fits: ap.fits };
      }
    }

    /* With one size asked for, every box on the form says it — filled or not, on
       the box, on its field, and as the form's own default. BART's form defaults
       to auto (0), and Acrobat falls back to that default for any box that does
       not state a size of its own; a box filled later by hand in Acrobat then came
       out in whatever size auto chose. */
    if (size0) {
      for (const field of fields) {
        if (field.kind !== 'text' && field.kind !== 'choice') continue;
        const filled = Object.prototype.hasOwnProperty.call(values || {}, field.name) && String(values[field.name] ?? '') !== '';
        if (filled) continue;
        const fieldObj = objectOf(field.ref);
        for (const w of field.widgets) {
          const wo = objectOf(w.ref);
          wo.d.DA = { s: sizedDA(w.da || field.da, size0) };
        }
        if (fieldObj.d.DA) fieldObj.d.DA = { s: sizedDA(textOf(fieldObj.d.DA), size0) };
      }
    }

    /* The form itself. NeedAppearances is switched off: every filled box has its
       appearance drawn here, at the size asked for, and a viewer told to redraw
       them all (BART's re-saved template says so) draws them its own way instead.
       And which filler wrote the file is stamped in it, so a download can say. */
    const rootRef = doc.trailer.d.Root;
    const acroRef = doc.get(rootRef)?.d?.AcroForm;
    const acroObj = acroRef?.r !== undefined
      ? objectOf(acroRef)
      : (objectOf(rootRef).d.AcroForm = { d: { ...(acroRef?.d || {}) } });
    const formDA = textOf(doc.get(acroObj.d.DA));
    // Never left on auto (0): the form's default is what a box without a size of its own uses.
    if (size0 || !parseDA(formDA || '').size) acroObj.d.DA = { s: sizedDA(formDA, size0 || 9) };
    acroObj.d.NeedAppearances = false;
    acroObj.d.CxTimelineFiller = { s: `TAWR filler ${FILLER_VERSION}` };

    if (signature?.strokes?.length) {
      const field = byName.get(signature.field);
      const widget = field?.widgets?.[0];
      const pageRef = widget?.page;
      if (widget && pageRef) {
        const content = signatureContent(signature, widget.rect);
        if (content) {
          const page = objectOf(pageRef);
          const c = page.d.Contents;
          let existing = [];
          if (Array.isArray(c)) existing = c;
          else if (c != null) {
            const resolved = doc.get(c);
            existing = Array.isArray(resolved) ? resolved : [c];
          }
          // Wrapped, so whatever state the page's own drawing leaves behind cannot
          // move or recolour the signature.
          const open = addObject({ d: {}, stream: bytesOf('q') });
          const close = addObject({ d: {}, stream: bytesOf('Q') });
          const sig = addObject({ d: {}, stream: bytesOf(content) });
          page.d.Contents = [open, ...existing, close, sig];
          report.signature = true;
        }
      }
    }

    return { bytes: writeIncrement(doc, data, changed, added, next), report };
  }

  function writeIncrement(doc, data, changed, added, size) {
    const parts = [];
    let offset = data.length;
    const offsets = new Map();
    const push = (str) => {
      const b = typeof str === 'string' ? bytesOf(str) : str;
      parts.push(b);
      offset += b.length;
    };
    push('\n');
    const objects = [
      ...[...changed.entries()].map(([n, { gen, value }]) => ({ num: n, gen, value })),
      ...added.map((a) => ({ num: a.num, gen: 0, value: a.value })),
    ].sort((a, b) => a.num - b.num);
    for (const o of objects) {
      offsets.set(o.num, { offset, gen: o.gen });
      if (o.value.stream) {
        const d = { ...o.value.d, Length: o.value.stream.length };
        push(`${o.num} ${o.gen} obj\n${serialize({ d })}\nstream\n`);
        push(o.value.stream);
        push('\nendstream\nendobj\n');
      } else {
        push(`${o.num} ${o.gen} obj\n${serialize(o.value)}\nendobj\n`);
      }
    }

    const t = doc.trailer.d;
    const trailer = { Size: size, Root: t.Root, Prev: doc.startxref };
    if (t.Info) trailer.Info = t.Info;
    if (t.ID) trailer.ID = t.ID;

    // Runs of consecutive object numbers, as both kinds of cross-reference want them.
    const nums = [...offsets.keys()].sort((a, b) => a - b);
    const runs = [];
    for (const n of nums) {
      const last = runs[runs.length - 1];
      if (last && last.start + last.list.length === n) last.list.push(n);
      else runs.push({ start: n, list: [n] });
    }

    const xrefAt = offset;
    if (doc.xrefIsStream) {
      // The original's cross-reference is a stream; so is this one, uncompressed.
      const rows = [];
      const index = [];
      for (const run of runs) {
        index.push(run.start, run.list.length);
        for (const n of run.list) rows.push([1, offsets.get(n).offset, offsets.get(n).gen]);
      }
      index.push(size, 1);
      rows.push([1, xrefAt, 0]);
      const bin = new Uint8Array(rows.length * 7);
      rows.forEach(([type, off, gen], i) => {
        const p = i * 7;
        bin[p] = type;
        bin[p + 1] = (off >>> 24) & 0xff; bin[p + 2] = (off >>> 16) & 0xff;
        bin[p + 3] = (off >>> 8) & 0xff; bin[p + 4] = off & 0xff;
        bin[p + 5] = (gen >>> 8) & 0xff; bin[p + 6] = gen & 0xff;
      });
      const d = { ...trailer, Size: size + 1, Type: { n: 'XRef' }, W: [1, 4, 2], Index: index, Length: bin.length };
      push(`${size} 0 obj\n${serialize({ d })}\nstream\n`);
      push(bin);
      push('\nendstream\nendobj\n');
    } else {
      let table = 'xref\n';
      for (const run of runs) {
        table += `${run.start} ${run.list.length}\n`;
        for (const n of run.list) {
          const { offset: off, gen } = offsets.get(n);
          table += `${String(off).padStart(10, '0')} ${String(gen).padStart(5, '0')} n \n`;
        }
      }
      push(`${table}trailer\n${serialize({ d: trailer })}\n`);
    }
    push(`startxref\n${xrefAt}\n%%EOF\n`);

    const out = new Uint8Array(offset);
    out.set(data, 0);
    let p = data.length;
    for (const part of parts) { out.set(part, p); p += part.length; }
    return out;
  }

  Object.defineProperty(__x, "FILLER_VERSION", { get: () => FILLER_VERSION, enumerable: true });
  Object.defineProperty(__x, "formatDateAs", { get: () => formatDateAs, enumerable: true });
  Object.defineProperty(__x, "readForm", { get: () => readForm, enumerable: true });
  Object.defineProperty(__x, "missingFields", { get: () => missingFields, enumerable: true });
  Object.defineProperty(__x, "fillForm", { get: () => fillForm, enumerable: true });
};

// ui/rc_tawr.js
__mods["ui/rc_tawr.js"] = function (__x, __req) {
  /**
   * TAWR — track access work requests, raised from the look-ahead.
   *
   * Pick a week; every place the look-ahead works that week becomes a request,
   * one per location and shift, read off the reading every other screen draws
   * (`core/tawr.js` decides what goes in each). An administrator reviews each
   * draft, changes what needs changing, and approves it; an approved request is
   * downloaded as BART's own form, filled and signed (`io/tawr_pdf.js`), and is
   * final — changing it afterwards is a revision.
   *
   * **The look-ahead stays the source.** Creating the requests again after the
   * sheet changes brings every draft up to date without losing what anybody
   * typed: a field nobody touched takes the new value, an edit is kept, and an
   * edit the sheet has since moved underneath is named. An approved request is
   * never touched; it is marked as no longer matching the sheet.
   *
   * Administrators only, in the policies and therefore here: the tab is not
   * offered to anybody else (`ui/rc.js`), and this module says so if reached.
   *
   * Two sections: **Requests** (the week) and **Setup** (BART's blank form, your
   * name and signature, the contacts on every request, the shift hours, and the
   * expanded wording for activities).
   *
   * Imports: util, rc, tawr, tawr_pdf, xlsx_write, exporters, icons, components,
   * rc_util.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const T = __req("core/tawr.js");
  const { readForm, missingFields, fillForm, FILLER_VERSION } = __req("io/tawr_pdf.js");
  const { zipStore } = __req("io/xlsx_write.js");
  const { saveFile } = __req("io/exporters.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, selectInput, toast, badge, emptyState, confirmDialog, openModal } = __req("ui/components.js");
  const { parsedView, locationRegister, foldName, todayISO, notifyChanged, goToTab, orgNav, formModal } = __req("ui/rc_util.js");



  /* Dates as a request talks about them: "Mon 12 Oct", and the year where it matters. */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const utc = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  function dayLabel(iso) {
    const d = utc(iso);
    return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }
  function dateLabel(iso) {
    const d = utc(iso);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  const state = { section: 'requests', week: null };

  /* ── BART's blank form, once per session ───────────────────────────────── */

  let template = null; // { user, bytes }

  async function getTemplate() {
    const user = rc.currentUser()?.id || null;
    if (template && template.user === user) return template.bytes;
    const bytes = await rc.downloadTawrTemplate();
    template = bytes ? { user, bytes } : null;
    return bytes;
  }

  /* ── Everything a request is made from ─────────────────────────────────── */

  async function loadContext() {
    const [snapshot, legend, locations, aliases, codes, descriptions, settingsRows, profiles] = await Promise.all([
      rc.latestSnapshot().catch(() => null),
      rc.listLegend().catch(() => []),
      rc.listLocations({ includeInactive: true }).catch(() => []),
      rc.listLocationAliases().catch(() => []),
      rc.listSupportCodes({ includeRetired: true }).catch(() => []),
      rc.listTawrDescriptions().catch(() => []),
      rc.listTawrSettings().catch(() => []),
      rc.listTawrProfiles().catch(() => []),
    ]);
    const view = snapshot?.grid ? parsedView(snapshot, legend) : null;
    const byId = new Map(locations.map((l) => [l.id, l]));
    const register = locationRegister(locations, aliases);
    const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
    const shiftHours = {};
    for (const s of ['day', 'swing', 'night', 'possession']) {
      shiftHours[s] = settings[`hours_${s}`] || T.DEFAULT_SHIFT_HOURS[s];
    }
    return {
      snapshot,
      view,
      settings,
      settingsRows,
      shiftHours,
      codes,
      descriptions,
      profiles: new Map(profiles.map((p) => [p.person_id, p])),
      resolveLocation: (raw) => byId.get(register.get(foldName(raw))) || null,
    };
  }

  function extract(ctx, week) {
    if (!ctx.view) return [];
    return T.extractWeek(ctx.view, week, {
      resolveLocation: ctx.resolveLocation,
      codes: ctx.codes,
      descriptions: ctx.descriptions,
      shiftHours: ctx.shiftHours,
    }).groups;
  }

  /** The form values for a group, as the administrator who raised it would have them. */
  function freshValues(ctx, group, raisedBy) {
    return T.formValues(group, { settings: ctx.settings, profile: ctx.profiles.get(raisedBy) || {} });
  }

  function sourceOf(group) {
    return {
      activities: group.activities.map((a) => ({ title: a.title, activityId: a.activityId, days: a.days })),
      days: group.days,
      support: group.support,
      sswp: group.sswp,
      flags: group.flags,
      unexpanded: group.unexpanded,
      area: group.area,
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The tab
     ═══════════════════════════════════════════════════════════════════════ */

  async function render(root) {
    if (!rc.isAdmin()) {
      root.appendChild(emptyState({
        iconName: 'lock',
        title: 'Administrators only',
        message: 'Track access work requests are raised and approved by an administrator.',
      }));
      return;
    }
    const nav = el('div', { class: 'rc-tabs', style: 'margin:0 0 16px' });
    for (const [id, label] of [['requests', 'Requests'], ['setup', 'Setup']]) {
      nav.appendChild(el('button', {
        class: 'rc-tab',
        type: 'button',
        text: label,
        dataset: { tawrSection: id },
        'aria-pressed': String(state.section === id),
        onClick: () => { state.section = id; clear(root); render(root); },
      }));
    }
    root.appendChild(nav);
    const host = el('div', { class: 'rc-tawr' });
    root.appendChild(host);
    if (state.section === 'setup') await renderSetup(host);
    else await renderRequests(host);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Requests
     ═══════════════════════════════════════════════════════════════════════ */

  async function renderRequests(host) {
    const today = todayISO();
    const [ctx, recent] = await Promise.all([
      loadContext(),
      rc.listTawrsFrom(T.addDaysISO(T.mondayOf(today), -28)).catch(() => []),
    ]);

    host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Track access work requests' })]));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: `One request per location and shift for the week, read off the look-ahead. Each is due ${T.TAWR_LEAD_DAYS} days before its first day of work.`,
    }));

    const me = rc.me();
    const mine = ctx.profiles.get(me?.id);
    const templateInfo = parseJson(ctx.settings.template_info);
    if (!templateInfo) {
      host.appendChild(notice('warning', 'BART\'s blank form has not been uploaded yet.',
        'Requests can be created and approved, but not downloaded until it is. Upload it in Setup.', 'Open Setup'));
    } else if (!mine?.signature?.strokes?.length || !mine?.requestor_name) {
      host.appendChild(notice('info', 'Your name, cell phone or signature is not saved yet.',
        'Requests you raise go out with them as the requestor. Save them in Setup.', 'Open Setup'));
    }

    if (!ctx.view) {
      host.appendChild(emptyState({
        iconName: 'calendar',
        title: 'No look-ahead to read',
        message: 'Requests are read off the look-ahead. Publish it from the editor, or read the workbook, first.',
        action: { label: 'Go to the look-ahead', onClick: () => goToTab('lookahead') },
      }));
      return;
    }

    const weeks = [...new Set([...T.weeksIn(ctx.view), ...recent.map((r) => r.week_start)])].sort();
    if (!weeks.includes(state.week)) {
      state.week = weeks.find((w) => T.tawrDeadline(w) >= today) || weeks[weeks.length - 1];
    }
    const week = state.week;
    const counts = new Map();
    for (const r of recent) counts.set(r.week_start, (counts.get(r.week_start) || 0) + 1);

    const picker = el('div', { class: 'rc-tabs rc-tawr-weeks', role: 'group', 'aria-label': 'Week' });
    for (const w of weeks) {
      const n = counts.get(w) || 0;
      picker.appendChild(el('button', {
        class: 'rc-tab',
        type: 'button',
        dataset: { week: w },
        'aria-pressed': String(w === week),
        title: `${dayLabel(w)} to ${dayLabel(T.addDaysISO(w, 6))}`,
        onClick: () => { state.week = w; notifyChanged('tawr-week'); },
      }, [
        `Week of ${dateLabel(w).replace(/ \d{4}$/, '')}`,
        n ? el('span', { class: 'rc-tab-count rc-tab-count-info', text: String(n), 'aria-label': `${n} saved` }) : null,
      ]));
    }
    host.appendChild(picker);

    const groups = extract(ctx, week);
    const saved = await rc.listTawrs(week);
    const items = groups.map((g) => ({ group: g, record: saved.find((r) => r.group_key === g.key) || null }));
    for (const r of saved) if (!groups.some((g) => g.key === r.group_key)) items.push({ group: null, record: r });

    const due = T.deadlineState(week, today);
    const approved = items.filter((i) => i.record?.status === 'approved');
    const toolbar = el('div', { class: 'rc-tawr-toolbar' }, [
      el('div', { class: 'rc-tawr-week-line' }, [
        el('strong', { text: `${dayLabel(week)} – ${dayLabel(T.addDaysISO(week, 6))} ${utc(week).getUTCFullYear()}` }),
        el('span', { class: 'rc-hint', style: 'margin:0', text: ` · first-day requests due ${dayLabel(due.deadline)}` }),
      ]),
      el('div', { class: 'rc-tawr-actions' }, [
        groups.length ? el('button', {
          class: 'cx-btn mini primary',
          type: 'button',
          dataset: { action: 'tawr-create' },
          html: `${icon('refresh', { size: 12 })}<span>${saved.length ? 'Update drafts from the look-ahead' : 'Create TAWRs for this week'}</span>`,
          title: 'One draft per location and shift. Drafts already made keep every change typed into them; approved requests are left alone.',
          onClick: (e) => createDrafts(e.currentTarget, ctx, items),
        }) : null,
        approved.length ? el('button', {
          class: 'cx-btn mini',
          type: 'button',
          dataset: { action: 'tawr-download-all' },
          html: `${icon('download', { size: 12 })}<span>Download approved (${approved.length})</span>`,
          onClick: () => downloadAll(ctx, week, approved.map((i) => i.record)),
        }) : null,
      ]),
    ]);
    host.appendChild(toolbar);

    if (!items.length) {
      host.appendChild(emptyState({
        iconName: 'calendar',
        title: 'Nothing painted this week',
        message: 'The look-ahead has no shifts painted between this Monday and Sunday, so there is nothing to request.',
      }));
      return;
    }

    const list = el('div', { class: 'rc-tawr-list' });
    for (const item of items) list.appendChild(card(ctx, item, today));
    host.appendChild(list);
  }

  function notice(tone, title, detail, action) {
    return el('div', { class: `rc-tawr-notice rc-tawr-notice-${tone}`, role: 'status' }, [
      el('span', { html: icon(tone === 'warning' ? 'warning' : 'info', { size: 16 }), 'aria-hidden': 'true' }),
      el('div', {}, [el('strong', { text: title }), el('span', { text: ` ${detail}` })]),
      action ? el('button', {
        class: 'cx-btn mini ghost', type: 'button', text: action,
        onClick: () => { state.section = 'setup'; notifyChanged('tawr-section'); },
      }) : null,
    ]);
  }

  const STATUS = {
    none: ['Not created', 'neutral'],
    draft: ['Draft', 'warn'],
    approved: ['Approved', 'good'],
  };

  function card(ctx, { group, record }, today) {
    const status = record?.status || 'none';
    const name = group?.locationName || record?.location_name || '(no location)';
    const shift = group?.shift || record?.shift;
    const firstDay = group?.firstDay || record?.first_day || record?.week_start;
    const due = T.deadlineState(firstDay, today);
    const fresh = group ? freshValues(ctx, group, record?.created_by || rc.me()?.id) : null;
    const flags = group ? group.flags : [{ kind: 'gone', blocking: true, message: 'No longer on the look-ahead for this week. Discard the draft, or check the sheet.' }];
    const blocking = flags.filter((f) => f.blocking);
    const edited = record ? T.editedKeys(record.fields, record.generated) : [];
    const conflicts = record?.source?.conflicts || [];
    const changed = record?.status === 'approved' && fresh ? T.changedSince(record.generated, fresh) : [];

    const days = group?.days || record?.source?.days || [];
    const activities = group?.activities || record?.source?.activities || [];
    const support = group?.support || record?.source?.support || [];
    const sswp = group?.sswp || record?.source?.sswp || [];

    const node = el('article', {
      class: `rc-tawr-card rc-tawr-${status}`,
      dataset: { tawrKey: group?.key || record?.group_key || '', tawrStatus: status },
      'aria-label': `${name}, ${T.tawrShiftLabel(shift)} shift — ${STATUS[status][0]}`,
    });
    node.appendChild(el('header', { class: 'rc-tawr-card-head' }, [
      el('h4', { text: name }),
      badge(T.tawrShiftLabel(shift), 'info', { dot: false }),
      badge(STATUS[status][0], STATUS[status][1]),
      status === 'approved' ? null : badge(due.label, due.tone === 'ok' ? 'neutral' : due.tone),
    ]));

    node.appendChild(el('dl', { class: 'rc-tawr-facts' }, [
      el('dt', { text: 'Days' }),
      el('dd', { text: days.map((d) => `${dayLabel(d.date)} ${d.start || '?'}–${d.end || '?'}${d.fromShift ? ' (shift hours)' : ''}`).join(' · ') || '—' }),
      el('dt', { text: 'Work' }),
      el('dd', { text: activities.map((a) => a.title).join(' · ') || '—' }),
      el('dt', { text: 'BART support' }),
      el('dd', {
        text: [
          support.filter((s) => s.line === 'systems').map((s) => (s.count > 1 ? `${s.count} x ${s.label}` : s.label)).join(', '),
          support.filter((s) => s.line === 'occ').map((s) => `OCC: ${s.label}`).join(', '),
        ].filter(Boolean).join(' · ') || 'None',
      }),
      sswp.length ? el('dt', { text: 'SSWP' }) : null,
      sswp.length ? el('dd', { text: sswp.join(', ') }) : null,
    ]));

    const notes = el('ul', { class: 'rc-tawr-flags' });
    for (const f of flags) {
      notes.appendChild(el('li', { class: f.blocking ? 'rc-tawr-flag-block' : 'rc-tawr-flag-note' }, [
        el('span', { html: icon(f.blocking ? 'warning' : 'info', { size: 12 }), 'aria-hidden': 'true' }),
        el('span', { text: f.message }),
      ]));
    }
    if (changed.length) {
      notes.appendChild(el('li', { class: 'rc-tawr-flag-block' }, [
        el('span', { html: icon('warning', { size: 12 }), 'aria-hidden': 'true' }),
        el('span', { text: `The look-ahead has changed since this was approved (${changed.map(label).join(', ')}). Revise it if the request should follow.` }),
      ]));
    }
    if (record?.status === 'draft' && conflicts.length) {
      notes.appendChild(el('li', { class: 'rc-tawr-flag-note' }, [
        el('span', { html: icon('info', { size: 12 }), 'aria-hidden': 'true' }),
        el('span', { text: `Kept your change where the look-ahead now says something else: ${conflicts.map(label).join(', ')}.` }),
      ]));
    }
    if (group?.unexpanded?.length) {
      notes.appendChild(el('li', { class: 'rc-tawr-flag-note' }, [
        el('span', { html: icon('info', { size: 12 }), 'aria-hidden': 'true' }),
        el('span', { text: `No expanded wording for: ${group.unexpanded.join(', ')}. Add it in Setup.` }),
      ]));
    }
    if (notes.childNodes.length) node.appendChild(notes);

    const meta = [];
    if (record) {
      const who = ctx.profiles.get(record.created_by)?.requestor_name;
      meta.push(`Raised ${who ? `by ${who} ` : ''}${dateLabel(record.created_at)}`);
      if (edited.length) meta.push(`${edited.length} field${edited.length === 1 ? '' : 's'} changed by hand`);
      if (record.status === 'approved' && record.approved_at) {
        const by = ctx.profiles.get(record.approved_by)?.requestor_name;
        meta.push(`approved${by ? ` by ${by}` : ''} ${dateLabel(record.approved_at)}`);
      }
    } else meta.push('Not created yet — "Create TAWRs" makes the draft.');
    node.appendChild(el('p', { class: 'rc-hint rc-tawr-meta', text: meta.join(' · ') }));

    const actions = el('div', { class: 'rc-tawr-card-actions' });
    if (record?.status === 'draft') {
      actions.append(
        button('Review', 'edit', () => openReview(ctx, record, group), 'tawr-review'),
        button('Approve', 'check', () => approve(record, blocking), 'tawr-approve', {
          primary: true,
          disabled: blocking.length > 0,
          title: blocking.length ? `Cannot be approved yet: ${blocking.map((f) => f.message).join(' ')}` : 'Approve as final. It can be revised later, not edited.',
        }),
        button('Preview PDF', 'document', () => downloadOne(ctx, record, { draft: true }), 'tawr-preview'),
        button('Discard', 'trash', () => discard(record), 'tawr-discard', { danger: true }),
      );
    } else if (record?.status === 'approved') {
      actions.append(
        button('Download PDF', 'download', () => downloadOne(ctx, record), 'tawr-download', { primary: true }),
        button('View', 'eye', () => openReview(ctx, record, group, { readOnly: true }), 'tawr-view'),
        button('Revise', 'edit', () => revise(record), 'tawr-revise'),
      );
    }
    if (actions.childNodes.length) node.appendChild(actions);
    return node;
  }

  function button(text, iconName, onClick, action, { primary = false, danger = false, disabled = false, title = '' } = {}) {
    return el('button', {
      class: `cx-btn mini${primary ? ' primary' : ' ghost'}${danger ? ' danger' : ''}`,
      type: 'button',
      disabled,
      title: title || null,
      dataset: { action },
      html: `${icon(iconName, { size: 12 })}<span>${text}</span>`,
      onClick,
    });
  }

  const label = (name) => T.FIELD_LABEL.get(name) || name;

  function parseJson(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  /* ── Creating, approving, revising ─────────────────────────────────────── */

  async function createDrafts(btn, ctx, items) {
    btn.disabled = true;
    let made = 0;
    let updated = 0;
    let kept = 0;
    try {
      for (const { group, record } of items) {
        if (!group) continue;
        const source = sourceOf(group);
        const common = {
          location_id: group.locationId,
          location_name: group.locationName,
          snapshot_id: ctx.snapshot?.id || null,
          first_day: group.firstDay,
        };
        if (!record) {
          const values = freshValues(ctx, group, rc.me()?.id);
          await rc.addTawr({
            week_start: group.weekStart, group_key: group.key, shift: group.shift,
            fields: values, generated: values, source: { ...source, conflicts: [] }, ...common,
          });
          made++;
        } else if (record.status === 'draft') {
          const values = freshValues(ctx, group, record.created_by);
          const merged = T.mergeRegenerated(record, values);
          await rc.updateTawr(record.id, {
            fields: merged.fields, generated: merged.generated, source: { ...source, conflicts: merged.conflicts }, ...common,
          });
          updated++;
        } else kept++;
      }
      const said = [
        made ? `${made} created` : '',
        updated ? `${updated} brought up to date` : '',
        kept ? `${kept} approved left as they are` : '',
      ].filter(Boolean).join(', ');
      toast({ tone: 'good', message: `TAWRs: ${said || 'nothing to do'}.` });
    } catch (err) {
      rc.reportError('tawr:create', err);
      toast({ tone: 'bad', message: err?.message || String(err) });
    } finally {
      btn.disabled = false;
      notifyChanged('tawr');
    }
  }

  async function approve(record, blocking) {
    if (blocking.length) return;
    const ok = await confirmDialog({
      title: `Approve the ${record.location_name} request?`,
      message: 'Approved is final: it is downloaded as it stands and cannot be edited. If it has to change, revise it — the approved version is kept.',
      confirmLabel: 'Approve',
    });
    if (!ok) return;
    try {
      await rc.updateTawr(record.id, { status: 'approved' });
      toast({ tone: 'good', message: `${record.location_name} approved.` });
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
    notifyChanged('tawr');
  }

  async function revise(record) {
    const ok = await confirmDialog({
      title: `Revise the ${record.location_name} request?`,
      message: 'A new draft takes its place, carrying everything it said. The approved version is kept on record as superseded.',
      confirmLabel: 'Revise',
    });
    if (!ok) return;
    try {
      await rc.reviseTawr(record.id);
      toast({ tone: 'good', message: 'A draft revision is ready to review.' });
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
    notifyChanged('tawr');
  }

  async function discard(record) {
    const ok = await confirmDialog({
      title: `Discard the ${record.location_name} draft?`,
      message: 'Changes typed into it go with it. "Create TAWRs" makes a fresh one from the look-ahead.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (!ok) return;
    try {
      await rc.discardTawr(record.id);
      toast({ message: 'Draft discarded.' });
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
    notifyChanged('tawr');
  }

  /* ── The PDF ───────────────────────────────────────────────────────────── */

  /* Every box is printed at 9 pt — the Requestor's size on BART's form — so the
     form reads as one hand. A number, not read off the template: an uploaded
     copy whose boxes were left on auto must not decide it. */
  const TEXT_SIZE = 9;

  function filled(ctx, bytes, record) {
    const profile = ctx.profiles.get(record.created_by);
    const signature = profile?.signature?.strokes?.length
      ? { field: 'requestor_signature', ...profile.signature }
      : null;
    return { ...fillForm(bytes, record.fields || {}, { signature, textSize: TEXT_SIZE }), signed: Boolean(signature), profile };
  }

  async function templateOrSay() {
    let bytes = null;
    try {
      bytes = await getTemplate();
    } catch (err) {
      toast({ tone: 'bad', message: `Could not fetch BART's form: ${err?.message || err}` });
      return null;
    }
    if (!bytes) {
      toast({ tone: 'warn', message: 'Upload BART\'s blank form in TAWR → Setup first.' });
      return null;
    }
    return bytes;
  }

  async function downloadOne(ctx, record, { draft = false } = {}) {
    const bytes = await templateOrSay();
    if (!bytes) return;
    try {
      const out = filled(ctx, bytes, record);
      const name = T.tawrFileName({ weekStart: record.week_start, locationName: record.location_name, shift: record.shift });
      saveFile(draft ? `DRAFT ${name}` : name, out.bytes, 'application/pdf', draft ? 'TAWR preview' : 'TAWR');
      warnAbout(out);
    } catch (err) {
      rc.reportError('tawr:pdf', err);
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
  }

  async function downloadAll(ctx, week, records) {
    const bytes = await templateOrSay();
    if (!bytes) return;
    try {
      const files = records.map((record) => {
        const out = filled(ctx, bytes, record);
        warnAbout(out, record.location_name);
        return { name: T.tawrFileName({ weekStart: record.week_start, locationName: record.location_name, shift: record.shift }), data: out.bytes };
      });
      saveFile(`TAWRs ${week}.zip`, zipStore(files), 'application/zip', `${files.length} TAWR${files.length === 1 ? '' : 's'}`);
    } catch (err) {
      rc.reportError('tawr:pdf', err);
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
  }

  function warnAbout(out, where = '') {
    const overflow = Object.entries(out.report.fields).filter(([, r]) => !r.fits).map(([k]) => label(k));
    if (overflow.length) {
      toast({ tone: 'warn', message: `${where ? `${where}: ` : ''}too long to fit even at the smallest size — ${overflow.join(', ')}. Shorten it in Review.` });
    }
    if (!out.signed) {
      toast({ tone: 'warn', message: `${where ? `${where}: ` : ''}no signature — ${out.profile?.requestor_name || 'the administrator who raised it'} has not saved one in Setup.` });
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Review: every field on the form, as it will be printed
     ═══════════════════════════════════════════════════════════════════════ */

  const DAY_OPTIONS = ['', 'MON', 'TUES', 'WED', 'THURS', 'FRI', 'SAT', 'SUN'];
  const CATEGORY_OPTIONS = ['', 'A', 'B', 'C', 'F', 'P', 'BL', 'Y'];

  const MAINT_LINES = [
    ['maint_route_prohibit', 'Route Prohibit'],
    ['maint_speed_restriction', 'Speed Restriction'],
    ['maint_systems_tech_support', 'Technical Support (Systems)'],
    ['maint_safe_clearance', 'Safe Clearance'],
    ['maint_rail_bond_cbond', 'Rail Bond / C-Bond'],
    ['maint_power_tech_support', 'Technical Support (Power & Mechanical)'],
    ['maint_vehicle_equipment', 'Vehicle Equipment'],
    ['maint_vehicle_tech_support', 'Technical Support (Vehicle)'],
    ['maint_safety_dept', 'Safety Dept.'],
    ['maint_operating_bulletin', 'Operating Bulletin #'],
    ['maint_physical_barrier', 'Physical Barrier Req. (attach)'],
    ['maint_safety_monitor', 'Safety Monitor'],
  ];
  const TRANS_LINES = [
    ['trans_yard_line_support', 'Yard / Line Support'],
    ['trans_train_required', 'Train Required'],
    ['trans_train_operators', 'Train Operator(s)'],
    ['trans_single_tracking', 'Single Tracking'],
    ['trans_occ_support', 'OCC Support'],
  ];

  function openReview(ctx, record, group, { readOnly = false } = {}) {
    const editor = formEditor(record, { readOnly });
    const fitBox = el('div', { class: 'rc-tawr-fit', 'aria-live': 'polite' });
    const body = el('div', { class: 'rc-tawr-review' }, [
      group?.flags?.some((f) => f.blocking)
        ? el('div', { class: 'rc-error' }, group.flags.filter((f) => f.blocking).map((f) => el('div', { text: f.message })))
        : null,
      fitBox,
      editor.node,
    ]);

    // Whether what is typed fits, against BART's real form — drawn the way the
    // download will draw it, so the answer is the download's answer.
    let timer = null;
    const checkFit = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        let bytes = null;
        try { bytes = await getTemplate(); } catch { /* said on download */ }
        if (!bytes) { fitBox.textContent = ''; return; }
        try {
          const { report } = fillForm(bytes, editor.read(), { textSize: TEXT_SIZE });
          const over = Object.entries(report.fields).filter(([, r]) => !r.fits).map(([k]) => label(k));
          const shrunk = report.fields.work_description;
          fitBox.className = `rc-tawr-fit${over.length ? ' rc-warn' : ''}`;
          fitBox.textContent = over.length
            ? `Too long to fit the form even at the smallest size: ${over.join(', ')}.`
            : shrunk ? `Fits the form. The work description prints at ${Math.round(shrunk.size * 4) / 4} pt.` : 'Fits the form.';
        } catch (err) {
          fitBox.textContent = '';
        }
      }, 250);
    };
    editor.node.addEventListener('input', checkFit);
    editor.node.addEventListener('change', checkFit);
    checkFit();

    const save = async (handle, { andApprove = false } = {}) => {
      try {
        await rc.updateTawr(record.id, { fields: editor.read() });
        if (andApprove) {
          const blocking = (group?.flags || [{ blocking: true }]).filter((f) => f.blocking);
          if (blocking.length) throw new Error('Saved, but it cannot be approved until what is flagged is fixed.');
          await rc.updateTawr(record.id, { status: 'approved' });
        }
        toast({ tone: 'good', message: andApprove ? `${record.location_name} approved.` : 'Draft saved.' });
        handle.close();
      } catch (err) {
        toast({ tone: 'bad', message: err?.message || String(err) });
      }
      notifyChanged('tawr');
    };

    openModal({
      title: `${record.location_name} — ${T.tawrShiftLabel(record.shift)} shift`,
      subtitle: readOnly
        ? 'Approved. Revise it to change anything.'
        : 'Every field as it will be printed. Fields changed by hand are marked; the rest follow the look-ahead.',
      size: 'xl',
      body,
      actions: readOnly
        ? [{ label: 'Close' }, { label: 'Download PDF', kind: 'primary', onClick: () => { downloadOne(ctx, record); } }]
        : [
          { label: 'Cancel' },
          { label: 'Save draft', keepOpen: true, onClick: (h) => { save(h); } },
          { label: 'Save and approve', kind: 'primary', keepOpen: true, onClick: (h) => { save(h, { andApprove: true }); } },
        ],
    });
  }

  /**
   * The form as controls. `read()` answers the fields object to store: strings
   * for text and dropdowns, true for a ticked box, and nothing at all for what
   * is blank, so a field nobody filled stays blank on the PDF.
   */
  function formEditor(record, { readOnly = false } = {}) {
    const fields = record.fields || {};
    const generated = record.generated || {};
    const getters = new Map();

    const mark = (wrap, names) => {
      const changed = names.some((n) => !sameValue(fields[n], generated[n]));
      if (changed) {
        wrap.classList.add('rc-tawr-edited');
        wrap.title = `Changed by hand. The look-ahead says: ${names.map((n) => display(generated[n])).join(' / ') || 'nothing'}`;
      }
      return wrap;
    };

    const text = (name, { multiline = false, placeholder = '', width = null } = {}) => {
      const input = multiline
        ? el('textarea', { class: 'cx-input rc-tawr-textarea', rows: '4', placeholder })
        : textInput({ value: fields[name] ?? '', placeholder });
      if (multiline) input.value = fields[name] ?? '';
      input.dataset.field = name;
      input.setAttribute('aria-label', label(name));
      if (width) input.style.width = width;
      if (readOnly) input.readOnly = true;
      getters.set(name, () => input.value.trim());
      return mark(el('span', { class: 'rc-tawr-ctl' }, [input]), [name]);
    };
    const check = (name, caption = '') => {
      const input = el('input', { type: 'checkbox', 'aria-label': label(name) });
      input.checked = fields[name] === true;
      input.dataset.field = name;
      if (readOnly) input.disabled = true;
      getters.set(name, () => input.checked);
      return mark(el('label', { class: 'rc-tawr-ctl rc-tawr-check' }, [input, caption ? el('span', { text: caption }) : null]), [name]);
    };
    const choice = (name, options) => {
      const select = selectInput({ value: fields[name] ?? '', options: options.map((o) => ({ value: o, label: o || '—' })) });
      select.dataset.field = name;
      select.setAttribute('aria-label', label(name));
      if (readOnly) select.disabled = true;
      getters.set(name, () => select.value);
      return mark(el('span', { class: 'rc-tawr-ctl' }, [select]), [name]);
    };
    // A Yes/No question is two boxes on the form; here it is one answer.
    const yesNo = (base, caption) => {
      const yes = `${base}_yes`;
      const no = `${base}_no`;
      const value = fields[yes] ? 'Yes' : fields[no] ? 'No' : '';
      const select = selectInput({ value, options: [{ value: '', label: '—' }, 'Yes', 'No'] });
      select.setAttribute('aria-label', caption);
      select.dataset.field = base;
      if (readOnly) select.disabled = true;
      getters.set(yes, () => select.value === 'Yes');
      getters.set(no, () => select.value === 'No');
      return el('div', { class: 'rc-tawr-q' }, [el('span', { text: caption }), mark(el('span', { class: 'rc-tawr-ctl' }, [select]), [yes, no])]);
    };
    const power = (n) => {
      const names = ['on', 'off', 'na'].map((p) => `row${n}_power_${p}`);
      const value = fields[names[0]] ? 'ON' : fields[names[1]] ? 'OFF' : fields[names[2]] ? 'N/A' : '';
      const select = selectInput({ value, options: [{ value: '', label: '—' }, 'ON', 'OFF', 'N/A'] });
      select.setAttribute('aria-label', `Row ${n} power status`);
      select.dataset.field = `row${n}_power`;
      if (readOnly) select.disabled = true;
      getters.set(names[0], () => select.value === 'ON');
      getters.set(names[1], () => select.value === 'OFF');
      getters.set(names[2], () => select.value === 'N/A');
      return mark(el('span', { class: 'rc-tawr-ctl' }, [select]), names);
    };

    const section = (title, children) => el('fieldset', { class: 'rc-tawr-section' }, [el('legend', { text: title }), ...children]);
    const pair = (caption, control) => el('label', { class: 'rc-tawr-pair' }, [el('span', { text: caption }), control]);

    const rows = [];
    for (let n = 1; n <= T.FORM_ROWS; n++) {
      rows.push(el('tr', {}, [
        el('td', {}, [text(`row${n}_date`, { placeholder: 'MM/DD/YYYY', width: '96px' })]),
        el('td', {}, [choice(`row${n}_day`, DAY_OPTIONS)]),
        el('td', {}, [text(`row${n}_time_start`, { placeholder: '0700', width: '60px' })]),
        el('td', {}, [text(`row${n}_time_end`, { placeholder: '1500', width: '60px' })]),
        el('td', {}, [text(`row${n}_area`)]),
        el('td', {}, [power(n)]),
        el('td', {}, [text(`row${n}_safe_clear_rail_sections`, { width: '110px' })]),
      ]));
    }

    const supportLine = ([base, caption]) => el('div', { class: 'rc-tawr-line' }, [
      check(`${base}_req`, caption),
      T.FIELD_KIND.has(`${base}_details`) ? text(`${base}_details`) : el('span'),
    ]);

    const node = el('div', { class: 'rc-tawr-form' }, [
      section('Work and clearances', [
        el('div', { class: 'rc-tawr-qs' }, [
          yesNo('work_in_track_zone', 'Work/Activity in Track Zone'),
          yesNo('clearance_verification', 'Clearance Verification'),
          yesNo('track_inspection_first_train', 'Track Inspection (with 1st Train)'),
        ]),
        el('div', { class: 'rc-tawr-checks' }, [
          check('police_advisory_threat_of_theft', 'Police Advisory (Threat of Theft)'),
          check('advisory_no_work_clearance', 'Advisory (No Work Clearance)'),
          check('no_passage_hirail_vehicles', 'No Passage of Hi-Rail Vehicles'),
          check('coordinate_hirail_passage', 'Coordinate Hi-Rail Passage'),
        ]),
        el('div', { class: 'rc-tawr-grid2' }, [
          pair('Category of Work', choice('category_of_work', CATEGORY_OPTIONS)),
          pair('Schedule Number', text('schedule_number')),
        ]),
        pair('Work Description', text('work_description', { multiline: true })),
      ]),
      section('Contacts', [
        el('div', { class: 'rc-tawr-grid2' }, [
          pair('Requestor', text('requestor_name')),
          pair('Cell phone', text('requestor_cell_phone')),
          pair('Person in charge', text('person_in_charge_name')),
          pair('Cell phone', text('person_in_charge_cell_phone')),
          pair('Project representative', text('project_rep_name')),
          pair('Cell phone', text('project_rep_cell_phone')),
        ]),
      ]),
      section('Dates, times and area', [
        el('div', { class: 'rc-scroll' }, [
          el('table', { class: 'rc-table rc-tawr-rows' }, [
            el('thead', {}, [el('tr', {}, ['Date', 'Day', 'Start', 'End', 'Area (tracks, mileposts, gates, stations)', 'Power', 'Safe clear'].map((h) => el('th', { text: h })))]),
            el('tbody', {}, rows),
          ]),
        ]),
      ]),
      section('Maintenance support', MAINT_LINES.map(supportLine)),
      section('Transportation support', [
        ...TRANS_LINES.map(supportLine),
        el('div', { class: 'rc-tawr-line' }, [check('trans_passenger_bulletin_req', 'Passenger Bulletin'), pair('Public notice', text('trans_public_notice', { width: '80px' }))]),
        el('div', { class: 'rc-tawr-line' }, [check('trans_sswp_iop_required_req', 'SSWP/IOP Required (attach)'), el('span')]),
        el('div', { class: 'rc-tawr-line' }, [check('trans_adverse_impact_blanket_req', 'Adverse Impact to Blanket'), text('trans_adverse_impact_blanket_details', { placeholder: 'SSWP numbers print on this line' })]),
      ]),
      el('p', { class: 'rc-hint', text: 'The approval clearance signatures are left blank for BART. Your signature is drawn on the requestor line at download.' }),
    ]);

    return {
      node,
      read() {
        const out = {};
        for (const [name, get] of getters) {
          const v = get();
          if (v === true || (typeof v === 'string' && v)) out[name] = v;
        }
        return out;
      },
    };
  }

  function sameValue(a, b) {
    const blank = (v) => v == null || v === '' || v === false;
    return (blank(a) && blank(b)) || a === b;
  }

  function display(v) {
    if (v === true) return 'ticked';
    if (v == null || v === '' || v === false) return 'blank';
    return String(v);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Setup
     ═══════════════════════════════════════════════════════════════════════ */

  async function renderSetup(host) {
    const ctx = await loadContext();
    const me = rc.me();
    const mine = ctx.profiles.get(me?.id) || {};

    host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Setup' })]));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'What every request is filled from besides the look-ahead. All of it is visible to administrators only — the database refuses anybody else.',
    }));

    const list = el('div', { class: 'rc-settings' });
    host.appendChild(list);

    /* ── BART's form ────────────────────────────────────────────────────── */
    list.appendChild(group('BART\'s form'));
    const info = parseJson(ctx.settings.template_info);
    const fileInput = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, dataset: { action: 'tawr-template-file' } });
    fileInput.addEventListener('change', () => uploadTemplate(fileInput.files?.[0]));
    list.appendChild(row({
      label: 'The blank fillable form',
      hint: info
        ? `${info.name || 'tawr.pdf'} · ${info.fields} fields · uploaded ${dateLabel(info.uploaded_at)}${info.uploaded_by ? ` by ${info.uploaded_by}` : ''}. Kept in private storage, never published with the site.`
        : 'Not uploaded yet. Kept in private storage that only an administrator can open, and never published with the site.',
      control: el('div', { class: 'rc-settings-inline' }, [
        info ? badge('Uploaded', 'good') : badge('Missing', 'warn'),
        el('button', {
          class: 'cx-btn mini', type: 'button', dataset: { action: 'tawr-template' },
          html: `${icon('upload', { size: 12 })}<span>${info ? 'Replace…' : 'Upload…'}</span>`,
          onClick: () => fileInput.click(),
        }),
        fileInput,
      ]),
    }));

    /* ── You ────────────────────────────────────────────────────────────── */
    list.appendChild(group('You, as the requestor'));
    list.appendChild(profileRow('Your name on the form', 'requestor_name', mine.requestor_name ?? me?.name ?? '', 'Printed as the Requestor on every request you raise.'));
    list.appendChild(profileRow('Your cell phone', 'cell_phone', mine.cell_phone ?? '', 'Printed beside it.'));
    list.appendChild(row({
      label: 'Your signature',
      hint: 'Drawn once, here, and signed onto the requestor line of every request you raise when it is downloaded. Drawn as lines, so it prints sharp.',
      control: signaturePad(mine.signature),
    }));

    /* ── Every request ──────────────────────────────────────────────────── */
    list.appendChild(group('The same on every request'));
    list.appendChild(settingRow('Person in charge', 'person_in_charge_name', ctx.settings));
    list.appendChild(settingRow('Person in charge — cell phone', 'person_in_charge_cell_phone', ctx.settings));
    list.appendChild(settingRow('Project representative', 'project_rep_name', ctx.settings));
    list.appendChild(settingRow('Project representative — cell phone', 'project_rep_cell_phone', ctx.settings));
    list.appendChild(settingRow('Category of Work, unless changed', 'category_default', ctx.settings, {
      options: CATEGORY_OPTIONS.filter(Boolean), fallback: 'F',
    }));

    list.appendChild(group('Shift hours, where the look-ahead gives none'));
    for (const [id, caption] of [['day', 'Day shift'], ['swing', 'Swing shift'], ['night', 'Night shift'], ['possession', 'Blanket']]) {
      list.appendChild(settingRow(caption, `hours_${id}`, ctx.settings, {
        fallback: T.DEFAULT_SHIFT_HOURS[id],
        placeholder: T.DEFAULT_SHIFT_HOURS[id],
        check: (v) => (!v || T.parseHours(v) ? null : 'Write the hours as 0700-1500.'),
        hint: 'By the shift, not the colour — re-mapping a colour in Legend does not move these.',
      }));
    }

    list.appendChild(row({
      label: 'Form filler',
      hint: 'The version of the code that fills the form, stamped inside every PDF it writes. If a download looks wrong, check this matches — an older number means this page or the desktop app has not picked up the latest version yet (reload, or close and reopen the app twice).',
      control: el('span', { class: 'rc-settings-mono', dataset: { tawrFiller: String(FILLER_VERSION) }, text: `TAWR filler ${FILLER_VERSION}` }),
    }));

    list.appendChild(group('Where each place is'));
    list.appendChild(row({
      label: 'Area wording',
      hint: 'What the form\'s Area column says for each location ("Train Control Room, A-Line MP 12.3") is set on the location itself. Blank uses its name.',
      control: el('button', {
        class: 'cx-btn mini ghost', type: 'button', text: 'Open Locations',
        onClick: () => { orgNav.section = 'locations'; goToTab('org'); },
      }),
    }));
    list.appendChild(row({
      label: 'Which line each support code goes on',
      hint: 'Set on the support code: Technical Support (Systems), OCC Support, or not on the form. A witness is not on the form; ROC is OCC.',
      control: el('button', {
        class: 'cx-btn mini ghost', type: 'button', text: 'Open support codes',
        onClick: () => goToTab('lookahead'),
      }),
    }));

    /* ── Expanded wording ───────────────────────────────────────────────── */
    host.appendChild(descriptionsSection(ctx));
  }

  function group(title) {
    return el('div', { class: 'rc-settings-group', text: title });
  }

  function row({ label: caption, hint, control }) {
    return el('div', { class: 'rc-settings-row' }, [
      el('div', { class: 'rc-settings-label' }, [
        el('div', { class: 'rc-settings-name', text: caption }),
        hint ? el('div', { class: 'rc-hint', text: hint }) : null,
      ]),
      el('div', { class: 'rc-settings-control' }, [control]),
    ]);
  }

  function inlineSave({ input, current, commit }) {
    const button = el('button', { class: 'cx-btn mini', type: 'button', text: 'Save', disabled: true });
    const sync = () => { button.disabled = input.value.trim() === String(current ?? '').trim(); };
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    const go = async () => {
      if (button.disabled) return;
      if (await commit(input.value.trim())) { current = input.value.trim(); sync(); }
    };
    button.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return el('div', { class: 'rc-settings-inline' }, [input, button]);
  }

  function settingRow(caption, key, settings, { options = null, fallback = '', placeholder = '', check = null, hint = '' } = {}) {
    const current = settings[key] ?? fallback;
    const input = options
      ? selectInput({ value: current, options })
      : textInput({ value: current, placeholder });
    input.setAttribute('aria-label', caption);
    input.dataset.tawrSetting = key;
    return row({
      label: caption,
      hint,
      control: inlineSave({
        input,
        current,
        commit: async (v) => {
          const problem = check?.(v);
          if (problem) { toast({ tone: 'warn', message: problem }); return false; }
          try {
            await rc.setTawrSetting(key, v);
            toast({ tone: 'good', message: `${caption} saved.` });
            return true;
          } catch (err) {
            toast({ tone: 'bad', message: err?.message || String(err) });
            return false;
          }
        },
      }),
    });
  }

  function profileRow(caption, key, current, hint) {
    const input = textInput({ value: current });
    input.setAttribute('aria-label', caption);
    input.dataset.tawrProfile = key;
    return row({
      label: caption,
      hint,
      control: inlineSave({
        input,
        current: null, // never saved until somebody saves it, even when prefilled
        commit: async (v) => {
          try {
            await rc.saveTawrProfile({ [key]: v });
            toast({ tone: 'good', message: `${caption} saved.` });
            return true;
          } catch (err) {
            toast({ tone: 'bad', message: err?.message || String(err) });
            return false;
          }
        },
      }),
    });
  }

  async function uploadTemplate(file) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const form = readForm(bytes);
      const missing = missingFields(form, T.TAWR_FIELDS.map((f) => f[0]));
      if (!form.fields.length) throw new Error('That PDF has no fillable fields. Upload the fillable version of the form.');
      if (missing.length) {
        throw new Error(`That form is missing ${missing.length} field${missing.length === 1 ? '' : 's'} the requests fill: `
          + `${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}. Was it revised? Nothing was uploaded.`);
      }
      await rc.uploadTawrTemplate(new Blob([bytes], { type: 'application/pdf' }));
      await rc.setTawrSetting('template_info', JSON.stringify({
        name: file.name, size: bytes.length, fields: form.fields.length,
        uploaded_at: new Date().toISOString(), uploaded_by: rc.me()?.name || null,
      }));
      template = { user: rc.currentUser()?.id || null, bytes };
      toast({ tone: 'good', message: `BART's form uploaded — all ${T.TAWR_FIELDS.length} fields found.` });
      notifyChanged('tawr-template');
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
  }

  /* ── The signature pad ─────────────────────────────────────────────────── */

  const PAD_W = 360;
  const PAD_H = 120;

  function signaturePad(saved) {
    const canvas = el('canvas', {
      class: 'rc-tawr-pad', width: String(PAD_W), height: String(PAD_H),
      'aria-label': 'Signature pad — draw your signature with the mouse, a pen or a finger',
      role: 'img', dataset: { action: 'tawr-signature-pad' },
    });
    let strokes = (saved?.strokes || []).map((s) => s.map((p) => [...p]));
    let live = null;
    const ctx2d = canvas.getContext('2d');
    const scaleOf = () => {
      const sw = saved?.width || PAD_W;
      const sh = saved?.height || PAD_H;
      return Math.min(PAD_W / sw, PAD_H / sh);
    };
    // A signature saved at another size is redrawn to fit, then kept at this one.
    if (saved?.width && saved.width !== PAD_W) {
      const s = scaleOf();
      strokes = strokes.map((st) => st.map(([x, y]) => [x * s, y * s]));
    }

    const draw = () => {
      ctx2d.clearRect(0, 0, PAD_W, PAD_H);
      const css = getComputedStyle(canvas);
      ctx2d.strokeStyle = css.color || 'black';
      ctx2d.lineWidth = 2;
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';
      for (const st of strokes) {
        if (!st.length) continue;
        ctx2d.beginPath();
        ctx2d.moveTo(st[0][0], st[0][1]);
        for (const [x, y] of st.slice(1)) ctx2d.lineTo(x, y);
        if (st.length === 1) ctx2d.lineTo(st[0][0] + 0.1, st[0][1]);
        ctx2d.stroke();
      }
    };
    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      return [
        Math.round(((e.clientX - r.left) / r.width) * PAD_W * 10) / 10,
        Math.round(((e.clientY - r.top) / r.height) * PAD_H * 10) / 10,
      ];
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      live = [at(e)];
      strokes.push(live);
      draw();
      sync();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!live) return;
      const p = at(e);
      const last = live[live.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return;
      live.push(p);
      draw();
    });
    const end = () => { live = null; sync(); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    const saveBtn = el('button', { class: 'cx-btn mini primary', type: 'button', text: 'Save signature', dataset: { action: 'tawr-signature-save' } });
    const clearBtn = el('button', { class: 'cx-btn mini ghost', type: 'button', text: 'Clear', dataset: { action: 'tawr-signature-clear' } });
    let dirty = false;
    const sync = () => {
      dirty = true;
      saveBtn.disabled = !strokes.length;
    };
    saveBtn.disabled = true;
    clearBtn.addEventListener('click', () => { strokes = []; draw(); dirty = true; saveBtn.disabled = false; });
    saveBtn.addEventListener('click', async () => {
      if (!dirty) return;
      try {
        const signature = strokes.length ? { width: PAD_W, height: PAD_H, strokes: strokes.filter((s) => s.length) } : null;
        await rc.saveTawrProfile({ signature });
        dirty = false;
        saveBtn.disabled = true;
        toast({ tone: 'good', message: signature ? 'Signature saved.' : 'Signature removed.' });
      } catch (err) {
        toast({ tone: 'bad', message: err?.message || String(err) });
      }
    });
    requestAnimationFrame(draw);
    return el('div', { class: 'rc-tawr-signature' }, [
      canvas,
      el('div', { class: 'rc-settings-inline' }, [clearBtn, saveBtn]),
    ]);
  }

  /* ── Expanded wording ──────────────────────────────────────────────────── */

  function descriptionsSection(ctx) {
    const wrap = el('div', { class: 'rc-tawr-descriptions' });
    wrap.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'Expanded wording for activities' }),
      el('button', {
        class: 'cx-btn mini primary', type: 'button', dataset: { action: 'tawr-description-add' },
        html: `${icon('plus', { size: 12 })}<span>Add wording</span>`,
        onClick: () => editDescription(null, ctx.descriptions),
      }),
    ]));
    wrap.appendChild(el('p', {
      class: 'rc-hint',
      text: 'What the Work Description says about an activity, after its name. Matched on the activity\'s name as the look-ahead writes it (case and punctuation ignored, nothing else).',
    }));

    if (ctx.descriptions.length) {
      wrap.appendChild(el('div', { class: 'rc-scroll' }, [
        el('table', { class: 'rc-table' }, [
          el('thead', {}, [el('tr', {}, ['Activity', 'Wording', ''].map((h) => el('th', { text: h })))]),
          el('tbody', {}, ctx.descriptions.map((d) => el('tr', {}, [
            el('td', { text: d.activity }),
            el('td', { text: d.description || '—' }),
            el('td', { style: 'text-align:right;white-space:nowrap' }, [
              el('button', { class: 'cx-btn mini ghost', type: 'button', text: 'Edit', onClick: () => editDescription(d, ctx.descriptions) }),
              el('button', {
                class: 'cx-btn mini ghost danger', type: 'button', text: 'Remove',
                onClick: async () => {
                  if (!(await confirmDialog({ title: `Remove the wording for ${d.activity}?`, message: 'Requests already approved keep what they say.', confirmLabel: 'Remove', danger: true }))) return;
                  try { await rc.deleteTawrDescription(d.id); notifyChanged('tawr-descriptions'); } catch (err) { toast({ tone: 'bad', message: err.message }); }
                },
              }),
            ]),
          ]))),
        ]),
      ]));
    } else {
      wrap.appendChild(el('p', { class: 'rc-hint', text: 'None yet.' }));
    }

    // The activities the look-ahead is working that nothing describes yet.
    const known = new Set(ctx.descriptions.map((d) => foldName(d.activity)));
    const titles = new Map();
    if (ctx.view) {
      const cols = T.columnsOf(ctx.view);
      for (const a of ctx.view.activities) {
        if (a.heading || a.absence || !a.named || !a.highlighted) continue;
        const title = String(a.meta?.[cols.description] || '').trim();
        const key = foldName(title);
        if (title && !known.has(key) && !titles.has(key)) titles.set(key, title);
      }
    }
    if (titles.size) {
      wrap.appendChild(el('p', { class: 'rc-hint', text: 'On the look-ahead with no wording yet:' }));
      const sorted = [...titles.values()].sort((a, b) => a.localeCompare(b));
      wrap.appendChild(el('div', { class: 'rc-tawr-chips' }, sorted.map((t) => el('button', {
        class: 'cx-btn mini ghost', type: 'button', dataset: { action: 'tawr-describe' },
        onClick: () => editDescription({ activity: t, description: '' }, ctx.descriptions, { isNew: true }),
      }, [el('span', { html: icon('plus', { size: 11 }), 'aria-hidden': 'true' }), t]))));
    }
    return wrap;
  }

  function editDescription(existing, all, { isNew = false } = {}) {
    const creating = !existing?.id || isNew;
    const activity = textInput({ value: existing?.activity || '', placeholder: 'IXL SIM Testing' });
    const wording = el('textarea', { class: 'cx-input rc-tawr-textarea', rows: '4', placeholder: 'IXL team will perform functional testing using CBTC equipment only within the train control room.' });
    wording.value = existing?.description || '';
    formModal({
      title: creating ? 'Add wording for an activity' : `Wording for ${existing.activity}`,
      confirmLabel: creating ? 'Add' : 'Save',
      body: el('div', { class: 'lae-form' }, [
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Activity, as the look-ahead names it' }), activity]),
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'What the Work Description adds' }), wording]),
      ]),
      onConfirm: async () => {
        const name = activity.value.trim();
        if (!name) throw new Error('Name the activity.');
        const clash = all.find((d) => foldName(d.activity) === foldName(name) && d.id !== existing?.id);
        if (clash) throw new Error(`"${clash.activity}" already has wording — edit that one.`);
        if (creating) await rc.addTawrDescription({ activity: name, description: wording.value.trim() });
        else await rc.updateTawrDescription(existing.id, { activity: name, description: wording.value.trim() });
        notifyChanged('tawr-descriptions');
      },
    });
  }

  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
};

// ui/rc.js
__mods["ui/rc.js"] = function (__x, __req) {
  /**
   * The Resource Calendar interface.
   *
   * A peer of the timeline canvas rather than a dock pane: it is a different
   * interface over different data, reached by the workspace switch in the
   * sidebar. Nothing here runs until somebody switches to it — see
   * `ui/workspace.js` for why boot must not touch it.
   *
   * The calendar is kept in the shared folder beside the plan (`core/rc.js`), so
   * the door is the folder: open it, and bring the old calendar in or start one
   * (`ui/rc_gate.js`). Once it is open, the header says who holds the pen — the
   * one person writing it — and offers to take it over or hand it back.
   *
   * Imports: util, events, rc, icons, components, rc_gate, and the tab modules.
   */

  const { el, clear } = __req("core/util.js");
  const { on, EV } = __req("core/events.js");
  const rc = __req("core/rc.js");
  const filestore = __req("core/filestore.js");
  const { icon } = __req("ui/icons.js");
  const { toast, emptyState, promptDialog } = __req("ui/components.js");
  const { penButton } = __req("ui/rc_util.js");
  const { notConfigured, noFolder, emptyFolder, readFailed } = __req("ui/rc_gate.js");
  const roster = __req("ui/rc_roster.js");
  const lookahead = __req("ui/rc_lookahead.js");
  const pto = __req("ui/rc_pto.js");
  const tawr = __req("ui/rc_tawr.js");
  const { enhanceTables } = __req("ui/rc_table.js");
  const { startScheduledExports } = __req("ui/rc_master_export.js");

  /**
   * The tabs: the look-ahead and everything hanging off it — the calendar and
   * its editor, cancellations, changes, the legend, P6 — then who is away, the
   * track access requests, and the lists everything is read against.
   */
  const TABS = [
    { id: 'lookahead', label: 'Look-ahead' },
    { id: 'pto', label: 'PTO' },
    { id: 'tawr', label: 'TAWR' },
    { id: 'org', label: 'Lists' },
  ];

  const RENDERERS = {
    lookahead: lookahead.render,
    pto: pto.render,
    tawr: tawr.render,
    org: roster.render,
  };

  let frame = null;
  let bodyEl = null;
  let headEl = null;
  let active = 'lookahead';
  let started = false;

  /* ── Build ─────────────────────────────────────────────────────────────── */

  /**
   * Build the stage. Called once, by the workspace switch, on first use.
   *
   * Deliberately synchronous: it paints something immediately and then loads.
   */
  function build() {
    if (started) return;
    frame = document.getElementById('rc-frame');
    if (!frame) return;
    started = true;

    clear(frame);
    frame.hidden = false;

    headEl = el('div', { class: 'rc-head' });
    bodyEl = el('div', { class: 'rc-body' });
    frame.append(headEl, bodyEl);

    // Every table a tab draws gets the same header, sorting and export — see
    // ui/rc_table.js. Watched rather than called, because tabs draw in stages.
    let pendingEnhance = false;
    new MutationObserver(() => {
      if (pendingEnhance) return;
      pendingEnhance = true;
      queueMicrotask(() => {
        pendingEnhance = false;
        enhanceTables(bodyEl);
      });
    }).observe(bodyEl, { childList: true, subtree: true });

    on(EV.RC_CHANGED, () => render());
    on(EV.RC_AUTH_CHANGED, () => render());
    on(EV.RC_SHOW_TAB, ({ tab }) => showTab(tab));
    // The pen moving changes what may be pressed; the view is drawn again for it.
    on(EV.RC_PEN, (st) => {
      if (st?.idle) {
        toast({
          tone: 'info',
          title: 'Calendar handed back',
          message: 'Nothing was written for an hour, so the pen went back for whoever is waiting. Press Take over editing when you want it again.',
          timeout: 12000,
        });
      }
      render();
    });

    render();
    init();
  }

  async function init() {
    try {
      await rc.enterCalendar();
    } catch (err) {
      console.warn('[cx-timeline] resource calendar init failed:', err.message);
    }
    render();
    // A master export on a schedule runs on this computer while the calendar is open.
    startScheduledExports();
  }

  /* ── Router ────────────────────────────────────────────────────────────── */

  function showTab(id) {
    if (!RENDERERS[id]) return;
    active = id;
    render();
  }

  function render() {
    if (!frame) return;
    renderHead();
    clear(bodyEl);

    const after = () => { init(); };
    if (!rc.isConfigured()) {
      bodyEl.appendChild(notConfigured());
      return;
    }
    const { state, problem } = rc.status();
    if (state === 'no-folder') {
      bodyEl.appendChild(noFolder({ onDone: after }));
      return;
    }
    if (state === 'empty') {
      bodyEl.appendChild(emptyFolder({ onDone: after }));
      return;
    }
    if (state === 'failed') {
      bodyEl.appendChild(readFailed(problem, { onDone: after }));
      return;
    }
    if (!rc.isSignedIn()) {
      bodyEl.appendChild(emptyState({ iconName: 'database', title: 'Opening the calendar…', message: 'Reading calendar/ in the shared folder.' }));
      return;
    }

    const view = el('div');
    bodyEl.append(penBanner(), view);
    if (!RENDERERS[active]) active = 'lookahead';
    Promise.resolve(RENDERERS[active](view)).catch((err) => {
      rc.reportError(`tab:${active}`, err);
      clear(view);
      view.appendChild(loadFailed(err));
    });
  }

  function renderHead() {
    if (!headEl) return;
    clear(headEl);

    headEl.append(el('span', { class: 'rc-eyebrow', text: 'Resource Calendar' }));
    if (!rc.isSignedIn()) return;

    const tabs = el('div', { class: 'rc-tabs' });
    for (const tab of TABS) {
      tabs.appendChild(el('button', {
        class: 'rc-tab',
        type: 'button',
        text: tab.label,
        dataset: { tab: tab.id },
        'aria-pressed': String(tab.id === active),
        onClick: () => showTab(tab.id),
      }));
    }
    headEl.appendChild(tabs);

    const pen = rc.penState();
    headEl.appendChild(el('span', {
      class: 'rc-queue',
      style: pen.editing
        ? 'background:var(--good-light);border-color:var(--good-border);color:var(--good)'
        : 'background:var(--info-light);border-color:var(--info-border);color:var(--info)',
      text: pen.editing ? 'Editing' : 'Read only',
      dataset: { pen: pen.editing ? 'editing' : 'read-only' },
      title: pen.editing
        ? 'You hold the calendar\'s pen: what you change is saved to the shared folder. Anybody else who opens it reads it.'
        : pen.holder ? `${pen.holder} is editing the calendar.` : 'Nobody is editing the calendar. Take over editing to change it.',
    }));
    // Read-only, the way to take it is the banner under the tabs, on every tab.
    if (pen.editing) headEl.appendChild(penButton());

    headEl.appendChild(el('button', {
      class: 'cx-btn mini ghost',
      type: 'button',
      text: rc.accountLabel() || 'Set your name',
      title: 'The name the calendar stamps what you write with, and shows a colleague while you are editing.',
      dataset: { action: 'your-name' },
      onClick: async () => {
        const name = await promptDialog({
          title: 'Your name',
          label: 'As the roster has it — the calendar matches it to the list of people',
          value: rc.displayName(),
          confirmLabel: 'Save',
        });
        if (!name || !name.trim()) return;
        filestore.setDisplayName(name.trim());
        await rc.refreshMe();
        toast({ message: `You are ${name.trim()} in the calendar.` });
      },
    }));
  }

  /**
   * "Dana is editing the calendar", with the way to take it — above every tab
   * while it is true. Taking over never refuses: the folder's guard means that
   * if they save after you take it, their save is the one refused, not yours.
   */
  function penBanner() {
    const pen = rc.penState();
    if (pen.editing) return el('span', { hidden: true });
    const idle = pen.holderIdleMs != null ? ` They last saved ${Math.max(1, Math.round(pen.holderIdleMs / 60000))} min ago.` : '';
    const words = pen.holder
      ? [el('strong', { text: `${pen.holder} is editing the calendar.` }),
        el('span', { text: ` You can read everything; changes are theirs to make until they finish or you take over.${idle}` })]
      : [el('strong', { text: 'You handed the calendar back.' }),
        el('span', { text: ' Nobody is editing it. It stays read-only here until you take over editing.' })];
    return el('div', { class: 'rc-preview-banner', role: 'status', dataset: { pen: 'viewer' } }, [
      el('span', { html: icon('eye', { size: 16 }), 'aria-hidden': 'true' }),
      el('div', { class: 'rc-preview-text' }, words),
      penButton({ primary: true }),
    ]);
  }

  function loadFailed(err) {
    return emptyState({
      iconName: 'warning',
      title: 'Could not load',
      message: String(err?.message || err),
    });
  }

  /* The shared helpers the tabs use live in `ui/rc_util.js`, not here — this
     module imports the tabs, so anything they needed back from it would be a
     cycle, and the build rejects those. */

  Object.defineProperty(__x, "build", { get: () => build, enumerable: true });
  Object.defineProperty(__x, "showTab", { get: () => showTab, enumerable: true });
};
})();
