/*!
 * CX Timeline — the resource calendar, loaded on first use.
 * GENERATED FILE — built by tools/build.js alongside app.bundle.js.
 * Modules: 16   Built: 2026-09-26T07:21:07.310Z
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
   * Imports: util, events, dates, components.
   */

  const { el } = __req("core/util.js");
  const { emit, EV } = __req("core/events.js");
  const { toISO, todayMs, fmtDate, addDays, MS_DAY } = __req("core/dates.js");
  const { resourceNames, readGrid, locationColumnOf, absencesFrom, ABSENCE_LABELS, ABSENCE_KINDS } = __req("core/lookahead.js");


  const { applyLegend } = __req("io/lookahead.js");
  const rc = __req("core/rc.js");
  const { openModal } = __req("ui/components.js");

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
  function notifyChanged(what) {
    emit(EV.RC_CHANGED, { what });
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

  const SHIFTS = [
    { id: 'day', label: 'Day' },
    { id: 'night', label: 'Night' },
    { id: 'possession', label: 'Possession' },
  ];

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
    const legend = (legendRows || []).map((r) => ({
      argb: r.argb, meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from,
    }));
    const key = `${snapshot.id}|${snapshot.taken_at}|${JSON.stringify(legend)}`;
    if (parsed?.key === key) return parsed.view;
    const grid = applyLegend(snapshot.grid, legend);
    // The colours the legend could not place ride along: they are a fact about
    // this grid under this legend, which is exactly what the key says.
    const view = { ...readGrid(grid, { anchorISO: snapshot.taken_at }), unknown: grid.unknown || [] };
    parsed = { key, view };
    return view;
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

    const laRows = newestPerKey(stored, new Map(snapshots.map((s, i) => [s.id, i])));
    if (!snapshot?.grid) return { rows: laRows, absences: [] };

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
    return { rows, absences };
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

  Object.defineProperty(__x, "formModal", { get: () => formModal, enumerable: true });
  Object.defineProperty(__x, "weekStart", { get: () => weekStart, enumerable: true });
  Object.defineProperty(__x, "weekDays", { get: () => weekDays, enumerable: true });
  Object.defineProperty(__x, "allWeekDays", { get: () => allWeekDays, enumerable: true });
  Object.defineProperty(__x, "todayISO", { get: () => todayISO, enumerable: true });
  Object.defineProperty(__x, "isoToMs", { get: () => isoToMs, enumerable: true });
  Object.defineProperty(__x, "dayLabel", { get: () => dayLabel, enumerable: true });
  Object.defineProperty(__x, "byId", { get: () => byId, enumerable: true });
  Object.defineProperty(__x, "groupBy", { get: () => groupBy, enumerable: true });
  Object.defineProperty(__x, "notifyChanged", { get: () => notifyChanged, enumerable: true });
  Object.defineProperty(__x, "STATUSES", { get: () => STATUSES, enumerable: true });
  Object.defineProperty(__x, "STATUS_BY_ID", { get: () => STATUS_BY_ID, enumerable: true });
  Object.defineProperty(__x, "SHIFTS", { get: () => SHIFTS, enumerable: true });
  Object.defineProperty(__x, "foldName", { get: () => foldName, enumerable: true });
  Object.defineProperty(__x, "nameRegister", { get: () => nameRegister, enumerable: true });
  Object.defineProperty(__x, "nameDistance", { get: () => nameDistance, enumerable: true });
  Object.defineProperty(__x, "nearestName", { get: () => nearestName, enumerable: true });
  Object.defineProperty(__x, "locationRegister", { get: () => locationRegister, enumerable: true });
  Object.defineProperty(__x, "unmatchedLocations", { get: () => unmatchedLocations, enumerable: true });
  Object.defineProperty(__x, "uniqueFirstNames", { get: () => uniqueFirstNames, enumerable: true });
  Object.defineProperty(__x, "ambiguousFirstNames", { get: () => ambiguousFirstNames, enumerable: true });
  Object.defineProperty(__x, "newestPerKey", { get: () => newestPerKey, enumerable: true });
  Object.defineProperty(__x, "parsedView", { get: () => parsedView, enumerable: true });
  Object.defineProperty(__x, "lookaheadWithResources", { get: () => lookaheadWithResources, enumerable: true });
  Object.defineProperty(__x, "graftLocations", { get: () => graftLocations, enumerable: true });
  Object.defineProperty(__x, "graftResources", { get: () => graftResources, enumerable: true });
  Object.defineProperty(__x, "resourceAssignments", { get: () => resourceAssignments, enumerable: true });
  Object.defineProperty(__x, "absenceAssignments", { get: () => absenceAssignments, enumerable: true });
  Object.defineProperty(__x, "shiftFor", { get: () => shiftFor, enumerable: true });
  Object.defineProperty(__x, "assignmentIndex", { get: () => assignmentIndex, enumerable: true });
  Object.defineProperty(__x, "availability", { get: () => availability, enumerable: true });
};

// ui/rc_roster.js
__mods["ui/rc_roster.js"] = function (__x, __req) {
  /**
   * Organisation — the roster, locations, categories and leave.
   *
   * Reference data before transactional data: nothing else in the calendar means
   * anything until there are people to schedule and places to send them.
   *
   * Two decisions run through it. **Nothing anybody has used is ever deleted** —
   * a leaver's history has to stay for the reports while they drop out of every
   * picker, which is what Retire does and why it is the first answer offered.
   * Delete is the second, and it is for the row that was never meant: somebody
   * added twice, a location typed wrong. Postgres decides which is which —
   * `rc_delete_person()` and its siblings count what points at the row and refuse
   * with the number — because only the database can see everything that does.
   * And **every vocabulary is a table**, because the reports group by them and
   * "doc" typed one week against "documentation" the next are two categories to a
   * database and one to a person.
   *
   * Imports: util, events, dates, rc, icons, components, rc_util.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, selectInput, toast, confirmDialog, promptDialog, field, badge, checkbox, emptyState } = __req("ui/components.js");


  const { notifyChanged, byId, dayLabel, todayISO, formModal } = __req("ui/rc_util.js");

  const SECTIONS = ['people', 'locations', 'categories', 'leave', 'accounts', 'problems'];
  // Readable by an administrator alone, in the policies as well as here.
  const ADMIN_SECTIONS = new Set(['accounts', 'problems']);
  let section = 'people';

  /**
   * The three roles, in one place, worded as the consequence rather than the
   * name. Somebody choosing between them is deciding what a colleague can do,
   * not picking a label, and "viewer" on its own does not say that a viewer
   * cannot even record their own day.
   */
  const ROLES = [
    { value: 'viewer', label: 'Viewer — reads the schedule, writes nothing' },
    { value: 'member', label: 'Member — records their own daily outcomes' },
    { value: 'admin', label: 'Administrator — plans, and sees the KPIs' },
  ];

  // Only the administrator badge is coloured. A member and a viewer are both
  // ordinary states, and the word is the information — tinting one of them would
  // read as a warning about somebody who is simply on the team.
  const ROLE_TONE = { admin: 'info', member: 'neutral', viewer: 'neutral' };

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
      onClick: async () => {
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
      },
    });
  }

  async function render(root) {
    // Accounts is administrators-only in the database — `rc_list_invitations()`
    // returns nothing to anybody else — so a viewer is offered a tab that opens
    // onto a wall. It comes out of the row rather than explaining itself.
    const visible = rc.isAdmin() ? SECTIONS : SECTIONS.filter((id) => !ADMIN_SECTIONS.has(id));
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

    if (section === 'people') await renderPeople(host);
    else if (section === 'locations') await renderLocations(host);
    else if (section === 'categories') await renderCategories(host);
    else if (section === 'accounts') await renderAccounts(host);
    else if (section === 'problems') await renderProblems(host);
    else await renderLeave(host);
  }

  /* ── People ────────────────────────────────────────────────────────────── */

  async function renderPeople(host) {
    const people = await rc.listPeople({ includeInactive: true });
    const admin = rc.isAdmin();

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
      el('td', {}, [roleBadge(p.role)]),
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
          text: p.active ? 'Retire' : 'Restore',
          title: p.active
            ? 'Removes them from every picker. Their history stays — the reports still need it.'
            : 'Puts them back in the pickers.',
          onClick: async () => {
            await rc.updatePerson(p.id, { active: !p.active });
            notifyChanged('people');
          },
        }),
        deleteButton({
          label: `Delete ${p.name}?`,
          message: 'Their aliases and any leave booked for them go too. If anything has been '
            + 'planned or recorded against them this is refused, and retiring them is the answer '
            + '— that keeps every outcome and takes them out of the pickers just the same.',
          run: () => rc.deletePerson(p.id),
          after: 'people',
        }),
      ] : []),
    ]));

    host.appendChild(table(['Name', 'Title', 'Subsystem', 'Role', 'In the huddle', 'Days', ''], rows));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Retiring somebody keeps every outcome they ever recorded, which is why it is the first '
        + 'answer for anybody who has been here. Delete is for a row that was never meant — the same '
        + 'person added twice — and the database refuses it, with a count, the moment anything has '
        + 'been planned or recorded against them. "In the huddle" is a separate question '
        + 'from what somebody may do: a manager administers the calendar without being assigned to '
        + 'a location, and an administrator who does take shifts stays in the meeting.',
    }));
  }

  function editPerson(person) {
    const name = textInput({ value: person?.name || '', placeholder: 'Full name' });
    const email = textInput({ value: person?.email || '', placeholder: 'you@example.com', type: 'email' });
    const title = textInput({ value: person?.title || '', placeholder: 'Test Engineer' });
    const subsystem = textInput({ value: person?.subsystem || '', placeholder: 'ATS / IXL / SCADA' });
    const role = selectInput({ value: person?.role || 'member', options: ROLES });
    /* Whether they are scheduled, kept apart from what they may do. A manager
       administers the calendar and is never assigned to a location; an
       administrator who does take shifts must not drop out of the meeting
       because of their permissions. */
    const scheduled = checkbox({
      label: 'Takes shifts — appears in the daily huddle and the week plan',
      checked: person ? person.scheduled !== false : true,
    });
    if (!person) {
      /* A suggestion for somebody new, not a rule: an administrator is usually
         the person running the meeting. It stays a switch, because the two facts
         are separate and somebody has to be able to say so. */
      role.addEventListener('change', () => {
        scheduled.querySelector('input').checked = role.value !== 'admin';
      });
    }

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
        field('Email', email, 'Only needed if they will sign in. Scheduling somebody never requires an account.'),
        field('Title', title),
        field('Subsystem', subsystem),
        field('Role', role, 'What they may do once they have an account. It changes nothing '
          + 'until one exists — scheduling somebody never requires a login.'),
        field('Scheduling', scheduled, 'Turn this off for somebody who runs the meeting rather '
          + 'than taking work from it. They keep every permission they had.'),
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
          // The role goes through `rc_set_role()` rather than in the patch, so
          // the last-administrator guard applies. A plain UPDATE that a policy
          // refuses matches nothing and reports success — the demotion that
          // leaves nobody able to administer anything is exactly the one that
          // must not be reported as having worked.
          if (role.value !== person.role) await changeRole(person, role.value);
        } else {
          await rc.addPerson({ ...patch, role: role.value });
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
      onClick: async () => {
        const name = await promptDialog({ title: 'Add location', label: 'Name', confirmLabel: 'Add' });
        if (!name) return;
        await rc.addLocation({ name: name.trim() });
        notifyChanged('locations');
      },
    } : null));

    const rows = locations.map((l) => el('tr', { class: l.active ? '' : 'rc-inactive' }, [
      el('td', { text: l.name }),
      el('td', { text: l.code || '—' }),
      el('td', {}, [
        el('div', { class: 'rc-hint', text: (byLocation.get(l.id) || []).join(', ') || 'no other spellings' }),
      ]),
      el('td', {}, admin ? [
        el('button', {
          class: 'cx-btn mini ghost',
          text: 'Rename',
          title: 'Every alias, SAR and look-ahead row stays pointed at it — only the name changes.',
          onClick: async () => {
            const name = await promptDialog({
              title: `Rename ${l.name}`,
              label: 'Name',
              value: l.name,
              confirmLabel: 'Rename',
            });
            if (!name || name.trim() === l.name) return;
            await rc.updateLocation(l.id, { name: name.trim() });
            notifyChanged('locations');
          },
        }),
        el('button', {
          class: 'cx-btn mini ghost',
          text: l.active ? 'Retire' : 'Restore',
          title: l.active
            ? 'Drops it from every picker. Everything already recorded against it stays.'
            : 'Puts it back in the pickers.',
          onClick: async () => {
            await rc.updateLocation(l.id, { active: !l.active });
            notifyChanged('locations');
          },
        }),
        deleteButton({
          label: `Delete ${l.name}?`,
          message: 'Its other spellings go with it. If any plan, outcome, look-ahead row or SAR '
            + 'names this place the delete is refused — retire it instead, which drops it from the '
            + 'pickers and keeps everything already recorded there.',
          run: () => rc.deleteLocation(l.id),
          after: 'locations',
        }),
        el('button', {
          class: 'cx-btn mini ghost',
          text: 'Add spelling',
          title: 'Another way this place is written in the look-ahead or on a SAR.',
          onClick: async () => {
            const alias = await promptDialog({
              title: `Another spelling for ${l.name}`,
              label: 'As it appears in the look-ahead or the SAR',
              confirmLabel: 'Add',
            });
            if (!alias) return;
            await rc.addLocationAlias(l.id, alias.trim());
            notifyChanged('locations');
          },
        }),
      ] : []),
    ]));

    host.appendChild(table(['Location', 'Code', 'Also written as', ''], rows));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Every match against the look-ahead and the SARs keys on location, never on '
        + 'activity text — the descriptions are not reliable enough to carry evidence. '
        + 'So a place written "TPSS 12" in one and "Traction Power 12" in the other needs '
        + 'both spellings here, or the match silently fails on exactly the rows that matter. '
        + 'Case and punctuation are folded automatically; wording is not.',
    }));
  }

  /* ── Categories and parties ────────────────────────────────────────────── */

  async function renderCategories(host) {
    const [categories, parties] = await Promise.all([
      rc.listCategories({ includeInactive: true }),
      rc.listParties(),
    ]);
    const admin = rc.isAdmin();

    host.appendChild(sectionHead('Task categories', admin ? {
      label: 'Add category',
      onClick: async () => {
        const name = await promptDialog({ title: 'Add category', label: 'Name', confirmLabel: 'Add' });
        if (!name) return;
        await rc.addCategory({ name: name.trim(), sort: (categories.length + 1) * 10 });
        notifyChanged('categories');
      },
    } : null));

    host.appendChild(table(['Category', ''], categories.map((c) => el('tr', {
      class: c.active ? '' : 'rc-inactive',
    }, [
      el('td', { text: c.name }),
      el('td', {}, admin ? [
        el('button', {
          class: 'cx-btn mini ghost',
          text: c.active ? 'Retire' : 'Restore',
          onClick: async () => {
            await rc.updateCategory(c.id, { active: !c.active });
            notifyChanged('categories');
          },
        }),
        deleteButton({
          label: `Delete ${c.name}?`,
          message: 'Refused if anything has been grouped under it, because the reports would lose '
            + 'the grouping with it. Retiring takes it out of the pickers and leaves every rollup '
            + 'reading as it does today.',
          run: () => rc.deleteCategory(c.id),
          after: 'categories',
        }),
      ] : []),
    ]))));

    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Categories are a table rather than free text because every rollup groups by '
        + 'them. "Doc" one week and "Documentation" the next would be two categories to '
        + 'the database and one to everybody reading the report.',
    }));

    host.appendChild(el('div', { style: 'height:24px' }));
    host.appendChild(sectionHead('Responsible parties', admin ? {
      label: 'Add party',
      onClick: async () => {
        const name = await promptDialog({ title: 'Add party', label: 'Name', confirmLabel: 'Add' });
        if (!name) return;
        await rc.addParty(name.trim());
        notifyChanged('parties');
      },
    } : null));

    host.appendChild(table(['Party'], parties.map((p) => el('tr', {}, [el('td', { text: p.name })]))));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Who a block or a cancellation is down to. A table for the same reason, and a '
        + 'sharper one: "blocked by BART" is a number somebody may eventually have to defend.',
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
              onClick: async () => {
                const ok = await confirmDialog({
                  title: 'Cancel this leave?',
                  message: 'It stays on the record as cancelled rather than disappearing.',
                  confirmLabel: 'Cancel leave',
                });
                if (!ok) return;
                await rc.updateLeave(l.id, { status: 'cancelled' });
                notifyChanged('leave');
              },
            }),
          ] : []),
        ]))
      ));
    }

    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Leave is why the huddle can tell "away" apart from "carried over". Without it, '
        + 'somebody being off gets quietly spread across the performance statuses and their '
        + 'numbers suffer for a week they were not even there.',
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

  /* ── Accounts ──────────────────────────────────────────────────────────── */

  /**
   * The link to send somebody.
   *
   * Nothing is emailed from here, and that is a limitation rather than a choice:
   * the application has no server of its own and a browser cannot send mail. So
   * it produces the link and you send it however you already talk to people —
   * which in practice beats an email that a corporate scanner opens before they
   * do, burning the token on the way past.
   *
   * The address rides along so somebody following it lands on the create-account
   * form with the right one of their addresses already in it. It is not a
   * credential: the database still refuses anybody who was not invited, so a
   * forwarded link gets a stranger precisely nowhere.
   */
  function joinLink(email) {
    /* Where the person is being invited *to*, which is not always where this
       window is running.
       Inside the desktop shell `location.origin` is `tauri.localhost` — the
       application's own internal address — so an invitation generated from the
       installed app copied a link that means nothing in anybody else's browser,
       and the only way to find that out was to send it to somebody. The shell
       knows the deployment it follows for updates, and that deployment is the
       site being joined. In a browser there is no shell and the address bar is
       already the right answer. */
    const channel = String(window.CX_SHELL?.channel || '').replace(/\/+$/, '');
    const base = channel ? `${channel}/` : window.location.origin + window.location.pathname;
    return `${base}#join=${encodeURIComponent(String(email || '').trim())}`;
  }

  /**
   * True when the link we would produce is one nobody else can open.
   *
   * Only reachable in a desktop build with no update channel configured: there
   * is no deployment to point at and `tauri.localhost` is not one. Saying so
   * beats copying something broken to the clipboard.
   */
  function linkIsLocal() {
    return !window.CX_SHELL?.channel && /^tauri\.localhost$/i.test(window.location.hostname);
  }

  async function copyJoinLink(email) {
    if (linkIsLocal()) {
      toast({
        tone: 'warn',
        title: 'This build has no site to link to',
        message: `${email} is invited and can sign up on the deployed site — but this desktop `
          + 'build has no update channel configured, so there is no address to send them.',
        timeout: 12000,
      });
      return;
    }
    const link = joinLink(email);
    try {
      await navigator.clipboard.writeText(link);
      toast({ tone: 'good', message: `Link for ${email} copied — send it however you like.` });
    } catch {
      // A denied clipboard is not a failure to produce the link. Show it so it
      // can be copied by hand rather than reporting nothing happened.
      await promptDialog({
        title: `Invitation link for ${email}`,
        label: 'Copy this and send it to them',
        value: link,
        confirmLabel: 'Done',
      });
    }
  }

  /**
   * Who may sign in, and what they may do once they have.
   *
   * The whole point of this section is that adding somebody to the team never
   * needs the SQL editor. An administrator invites an address, the person signs
   * up, and the trigger attaches the new account to the roster row the
   * invitation named with the role it carried — so by the time they first open
   * the calendar they are already on the team with the right permissions.
   *
   * Supabase Auth still holds the password, and that is deliberate rather than a
   * gap: `auth.uid()` is what every policy in the schema keys on, so the
   * permission model *is* the authentication. What is managed from here is the
   * part that is genuinely ours — who is allowed an account at all, which person
   * it belongs to, and what that person may do.
   */
  async function renderAccounts(host) {
    const [people, invitations] = await Promise.all([
      rc.listPeople({ includeInactive: true }),
      rc.listInvitations(),
    ]);

    host.appendChild(sectionHead('Accounts', {
      label: 'Invite somebody',
      onClick: () => invitePerson(people),
    }));

    const withAccount = people.filter((p) => p.user_id);
    const without = people.filter((p) => !p.user_id && p.active);

    host.appendChild(table(
      ['Person', 'Signs in as', 'Role', ''],
      people.filter((p) => p.active || p.user_id).map((p) => el('tr', {
        class: p.active ? '' : 'rc-inactive',
      }, [
        el('td', { text: p.name }),
        el('td', {}, p.user_id
          ? [el('span', { text: p.email || 'account linked' })]
          : [el('span', { class: 'rc-hint', text: 'no account — scheduled only' })]),
        el('td', {}, [
          // The role is live rather than behind a dialog: this is the table
          // somebody opens *because* they want to change one.
          selectInput({
            value: p.role,
            options: ROLES,
            mini: true,
            onChange: async (value) => {
              try {
                await changeRole(p, value);
                notifyChanged('people');
                toast({ message: `${p.name} is now ${roleWord(value)}.` });
              } catch (err) {
                toast({ message: err.message, tone: 'bad' });
                notifyChanged('people');
              }
            },
          }),
        ]),
        el('td', {}, p.user_id ? [] : [
          el('button', {
            class: 'cx-btn mini ghost',
            text: 'Link account',
            title: 'Point an address at this row. It works before they have signed up: an open '
              + 'invitation is aimed here instead, and the account lands on this row when it exists.',
            onClick: () => linkAccount(p, people),
          }),
        ]),
      ]))
    ));

    host.appendChild(el('p', {
      class: 'rc-hint',
      text: `${withAccount.length} of ${withAccount.length + without.length} people can sign in. `
        + 'The rest are scheduled without an account, which is the normal case for the '
        + 'field team — being on the roster must never require a login.',
    }));

    /* ── Pending ─────────────────────────────────────────────────────────── */

    host.appendChild(el('div', { style: 'height:24px' }));
    host.appendChild(sectionHead('Pending invitations', null));

    if (!invitations.length) {
      host.appendChild(el('p', { class: 'rc-hint', text: 'Nobody is waiting to join.' }));
    } else {
      const peopleById = byId(people);
      host.appendChild(table(
        ['Address', 'Role', 'For', 'Sent', 'Expires', ''],
        invitations.map((inv) => el('tr', {}, [
          el('td', { text: inv.pending_email }),
          el('td', {}, [roleBadge(inv.pending_role)]),
          el('td', {
            text: peopleById.get(inv.pending_person)?.name || 'a new team record',
          }),
          el('td', { text: dayLabel(inv.pending_created.slice(0, 10)) }),
          el('td', {}, [
            inv.pending_expired
              ? badge('Expired', 'bad')
              : el('span', { text: dayLabel(inv.pending_expires.slice(0, 10)) }),
          ]),
          el('td', {}, [
            el('button', {
              class: 'cx-btn mini',
              text: 'Copy link',
              title: 'The link that takes them to the create-account form with their address in it.',
              onClick: () => copyJoinLink(inv.pending_email),
            }),
            el('button', {
              class: 'cx-btn mini ghost',
              text: inv.pending_expired ? 'Send again' : 'Revoke',
              onClick: async () => {
                if (inv.pending_expired) {
                  await rc.invite(inv.pending_email, inv.pending_role, inv.pending_person, inv.pending_note);
                  toast({ message: `${inv.pending_email} invited again.` });
                } else {
                  const ok = await confirmDialog({
                    title: `Revoke the invitation to ${inv.pending_email}?`,
                    message: 'They will not be able to create an account until they are invited again.',
                    confirmLabel: 'Revoke',
                    danger: true,
                  });
                  if (!ok) return;
                  await rc.revokeInvitation(inv.pending_email);
                  toast({ message: 'Invitation revoked.' });
                }
                notifyChanged('invitations');
              },
            }),
          ]),
        ]))
      ));
    }

    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Sign-up is closed: an address that was never invited is refused by the database, not '
        + 'by hiding a form — so the link is a convenience, not a key, and forwarding it gets a '
        + 'stranger nowhere. Nothing is emailed from here; the application has no server of its '
        + 'own. Send the link however you already talk to people, which also sidesteps the '
        + 'corporate mail scanner that opens a confirmation link before the person does. '
        + 'Invitations lapse after thirty days, and inviting somebody again reopens the one that '
        + 'lapsed.',
    }));
  }

  function invitePerson(people) {
    const email = textInput({ placeholder: 'them@example.com', type: 'email' });
    const role = selectInput({ value: 'viewer', options: ROLES });
    const free = people.filter((p) => !p.user_id && p.active);
    const person = selectInput({
      value: '',
      options: [
        { value: '', label: 'Create a new team record for them' },
        ...free.map((p) => ({ value: p.id, label: p.name })),
      ],
    });
    const note = textInput({ placeholder: 'Optional — what they do' });

    formModal({
      title: 'Invite somebody',
      body: el('div', { class: 'cx-form' }, [
        field('Email', email, 'The address they will sign in with. Nothing is sent from here — '
          + 'send the invitation from Supabase, or just tell them to sign up.'),
        field('Role', role),
        field('Team record', person, 'Attach the account to somebody already on the roster, '
          + 'so their history and their login are the same person.'),
        field('Note', note),
      ]),
      confirmLabel: 'Invite',
      onConfirm: async () => {
        const address = email.value.trim();
        if (!address) throw new Error('An email address is needed.');
        await rc.invite(address, role.value, person.value || null, note.value.trim() || null);
        notifyChanged('invitations');
        await copyJoinLink(address);
      },
    });
  }

  /**
   * Point an address at a roster row.
   *
   * Three outcomes, and only one of them used to be handled. The account exists
   * and is linked; the address is *invited* and has not signed up yet, in which
   * case the invitation is aimed at this row and the trigger finishes the job when
   * they arrive; or there is neither, which is the only case where there is
   * genuinely nothing to do — so that is the only case that refuses, and it offers
   * the invitation rather than just saying no.
   *
   * The middle one is why this changed. "no account exists for them@example.com —
   * invite them first" was the commonest answer by a wide margin and it was wrong:
   * they *had* been invited, and there was nothing the administrator could do
   * about the rest. A refusal that names no action the reader can take reads as a
   * broken button.
   */
  function linkAccount(person, people) {
    const email = textInput({ value: person.email || '', placeholder: 'them@example.com', type: 'email' });
    formModal({
      title: `Link an account to ${person.name}`,
      body: el('div', { class: 'cx-form' }, [
        field('Email', email, 'The address they sign in with. It does not have to exist yet — if it '
          + 'has been invited and they have not signed up, the invitation is pointed at '
          + `${person.name} instead and the account lands on this row the moment they do.`),
      ]),
      confirmLabel: 'Link',
      onConfirm: async () => {
        const address = email.value.trim();
        if (!address) throw new Error('An email address is needed.');
        let linked;
        try {
          linked = await rc.linkAccount(person.id, address);
        } catch (err) {
          /* Nothing to link and nothing on its way. The next step is an
             invitation, so offer it rather than making somebody find the button. */
          if (/no account and no open invitation/i.test(err.message)) {
            throw new Error(`${address} has no account and no open invitation. Close this and use `
              + '"Invite somebody" — pick this person as the team record, and their account will '
              + 'attach to it when they sign up.');
          }
          throw err;
        }
        notifyChanged('people');
        toast({
          tone: 'good',
          message: linked
            ? `${address} now signs in as ${person.name}.`
            : `${address} is invited but has not signed up yet — the invitation now points at `
              + `${person.name}, and the account will attach to this row when they do.`,
          timeout: linked ? undefined : 10000,
        });
      },
    });
  }

  /**
   * Change somebody's role, through the function rather than the table.
   *
   * `rc_set_role()` refuses the demotion that would leave nobody able to
   * administer anything — and refuses it by raising, because a plain UPDATE that
   * a policy excludes matches no rows and reports success. Changing your own
   * role then re-reads it, so the interface stops offering what the database has
   * already started refusing.
   */
  async function changeRole(person, role) {
    await rc.setRole(person.id, role);
    if (person.id === rc.me()?.id) await rc.refreshMe();
  }

  function roleWord(role) {
    return role === 'admin' ? 'an administrator' : `a ${role}`;
  }

  function roleBadge(role) {
    const label = role ? role[0].toUpperCase() + role.slice(1) : '—';
    return badge(label === 'Admin' ? 'Administrator' : label, ROLE_TONE[role] || 'muted');
  }

  /* ── Problems ──────────────────────────────────────────────────────────── */

  /**
   * What the calendar ran into, on whose screen, and when.
   *
   * Each of these used to be a toast on one person's screen and a console line
   * nobody saw, so the first anybody heard was "the huddle didn't save on
   * Tuesday". `rc.reportError()` writes a row from a handful of named places —
   * a tab that failed to load, an offline outcome the server refused, a read of
   * the look-ahead that went wrong — and this lists them. It holds no plan data
   * by construction: nothing on the timeline's side ever reports here.
   */
  async function renderProblems(host) {
    const [rows, people] = await Promise.all([
      rc.listClientErrors(200),
      rc.listPeople({ includeInactive: true }),
    ]);
    const byAccount = new Map(people.filter((p) => p.user_id).map((p) => [p.user_id, p.name]));

    host.appendChild(sectionHead('Problems reported'));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Things the calendar could not do, as they happened on somebody\'s screen: a tab that did '
        + 'not load, an entry made offline that the database later refused, a look-ahead read that '
        + 'went wrong. Each is reported once per page load. Nothing from the timeline is ever sent here.',
    }));

    if (!rows.length) {
      host.appendChild(emptyState({
        iconName: 'check-circle',
        title: 'Nothing reported',
        message: 'When the calendar cannot do something on anybody\'s screen, it is listed here.',
      }));
      return;
    }

    const log = table(['When', 'Who', 'Where', 'What happened', 'Version'], rows.map((r) => el('tr', {}, [
      el('td', { class: 'rc-nowrap', text: new Date(r.created_at).toLocaleString(), dataset: { sort: r.created_at, csv: r.created_at } }),
      el('td', { text: byAccount.get(r.created_by) || (r.created_by ? 'An account not on the roster' : '—') }),
      el('td', { class: 'rc-mono', text: r.area }),
      el('td', { text: r.message }),
      el('td', { class: 'rc-mono', text: r.app_version || '—', title: r.user_agent || '' }),
    ])));
    log.querySelector('table').dataset.csv = 'calendar-problems';
    host.appendChild(log);

    const clearOlder = async (days, label) => {
      const before = new Date(Date.now() - days * 86400000).toISOString();
      const ok = await confirmDialog({
        title: label,
        message: days
          ? `Removes every problem reported more than ${days} days ago. They are not kept anywhere else.`
          : 'Removes every problem in the list. They are not kept anywhere else.',
        confirmLabel: 'Clear',
        danger: true,
      });
      if (!ok) return;
      try {
        const n = await rc.clearClientErrors(before);
        toast({ tone: 'good', message: `Cleared ${n} problem${n === 1 ? '' : 's'}.` });
        notifyChanged('problems');
      } catch (err) {
        toast({ tone: 'bad', message: err?.message || String(err) });
      }
    };
    host.appendChild(el('div', { class: 'rc-actions', style: 'margin-top:12px;display:flex;gap:8px' }, [
      el('button', { class: 'cx-btn mini ghost', type: 'button', text: 'Clear older than 30 days',
        onClick: () => clearOlder(30, 'Clear older problems') }),
      el('button', { class: 'cx-btn mini ghost danger', type: 'button', text: 'Clear all',
        onClick: () => clearOlder(0, 'Clear every problem') }),
    ]));
  }

  /* ── Shared bits ───────────────────────────────────────────────────────── */

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

// ui/rc_huddle.js
__mods["ui/rc_huddle.js"] = function (__x, __req) {
  /**
   * The daily huddle.
   *
   * **An administrator's screen.** It is the meeting: it asks a whole team, one
   * after another, how yesterday went, and it is where an outcome is entered. A
   * member has nothing to run and nothing to enter here but their own day, and
   * what they need from it — the status and the note recorded against their work —
   * is in the week plan, where they can also see the rest of their week. So the
   * tab is not offered to them, for the reason Reports and Organisation are not:
   * a section somebody cannot use is a door onto a wall.
   *
   * The week plan used to live in this file, behind the meeting, and it is now
   * `ui/rc_week.js` — one tab rather than the two that drew the same table twice.
   *
   * One screen, everyone side by side, all subsystems in one meeting: yesterday's
   * plan, yesterday's outcome, tomorrow's plan. It is used live, at a fixed time,
   * in front of the whole team — which sets every constraint here.
   *
   * **It must not rebuild while somebody is typing into it.** Panes elsewhere in
   * this application write to the store on every keystroke and rebuild on the
   * resulting change event, which replaces the input under the caret; CLAUDE.md
   * records that shipping three times. This screen is nothing *but* dense live
   * text entry, so it takes the opposite approach: nothing is written until a
   * field is left or Enter is pressed, and a save redraws one row rather than the
   * screen.
   *
   * **It must work with no network.** The meeting happens at 3pm whether or not
   * the wifi does. Every outcome is stamped with a uuid generated here, queued in
   * localStorage, and replayed when the connection returns — `rc_record_actual`
   * is idempotent on that uuid, so replaying one twice is harmless.
   *
   * Imports: util, events, dates, rc, icons, components, rc_util.
   */

  const { el, clear } = __req("core/util.js");
  const { emit, EV } = __req("core/events.js");
  const { toISO, addDays, todayMs } = __req("core/dates.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { selectInput, textInput, toast, badge, checkbox } = __req("ui/components.js");
  /* The digest is a download like every other export in the application, so it
     announces itself the same way — a file that lands somewhere the page cannot
     see is the one action with no visible result. */
  const { saveFile } = __req("io/exporters.js");
  const { STATUSES, STATUS_BY_ID, SHIFTS, weekStart, todayISO, isoToMs, dayLabel, byId, availability, notifyChanged, formModal, nameRegister, lookaheadWithResources, assignmentIndex } = __req("ui/rc_util.js");





  /* ══════════════════════════════════════════════════════════════════════════
     The offline queue
     ═══════════════════════════════════════════════════════════════════════ */

  const QUEUE_KEY = 'cxrc.queue';

  function readQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function writeQueue(rows) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(rows));
    } catch {
      /* A full or disabled localStorage must not lose the meeting; the entry
         still went to the server if the server was reachable. */
    }
    emit(EV.RC_QUEUE_CHANGED, { pending: rows.length });
  }

  function pendingCount() {
    return readQueue().length;
  }

  /**
   * Send one outcome, queueing it if that fails.
   *
   * The uuid is generated before the attempt rather than by the database, which
   * is the whole trick: a queued entry and the row it eventually becomes are the
   * same row, so a flush can run twice and the second pass changes nothing.
   */
  async function record(entry) {
    try {
      await rc.recordActual(entry);
      return { sent: true };
    } catch (err) {
      const queue = readQueue();
      queue.push(entry);
      writeQueue(queue);
      return { sent: false, error: err };
    }
  }

  /**
   * Push whatever is queued. Safe to call at any time, including twice at once.
   *
   * Entries that still fail stay queued in order. One that the server actively
   * rejects — a category that has since been retired, say — would otherwise
   * block everything behind it forever, so a refusal that is not a network
   * problem is dropped with a toast rather than retried until the end of time.
   */
  async function flushQueue() {
    const queue = readQueue();
    if (!queue.length || !rc.isSignedIn()) return 0;

    const remaining = [];
    let sent = 0;
    for (const entry of queue) {
      try {
        await rc.recordActual(entry);
        sent++;
      } catch (err) {
        if (/fetch|network/i.test(String(err.message))) remaining.push(entry);
        else {
          console.warn('[cx-timeline] a queued outcome was refused and dropped:', err.message);
          // The one failure here that loses somebody's words: it goes on the record.
          rc.reportError('huddle:queue-dropped', `${entry.date}: ${err.message}`);
          toast({ tone: 'warn', message: `An entry from ${entry.date} was refused: ${err.message}` });
        }
      }
    }
    writeQueue(remaining);
    if (sent) notifyChanged('actuals');
    return sent;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     The huddle
     ═══════════════════════════════════════════════════════════════════════ */

  /** Which day is being reviewed. Defaults to today; the arrows move it. */
  let onDate = null;
  /**
   * Whether the meeting is being *run* rather than filled in.
   *
   * The table is a form for the person holding the keyboard; presenter mode is
   * the same data drawn for the room — one person at a time, large enough to
   * read across a table, with the question asked the way somebody would say it.
   * Both write to exactly the same place.
   */
  let presenting = false;

  /*
   * Who is in front of the room. `null` means "nobody chosen yet", which is not
   * the same as the first person: a meeting resumed after somebody stepped out
   * should open on the first person who has *not* answered, and starting at zero
   * makes the facilitator page past everybody already done to find them.
   */
  let atPerson = null;

  function currentDate() {
    return onDate || todayISO();
  }

  /**
   * Does anybody on the team work this day at all?
   *
   * Not a fixed Monday-to-Friday: commissioning runs weekend possessions, and a
   * team with somebody on a Saturday rota has a Saturday worth reviewing. The
   * roster is the authority, so this asks it.
   */
  function anybodyWorks(iso, people) {
    const weekday = new Date(isoToMs(iso)).getUTCDay() || 7;
    return people.some((p) => (p.working_days || [1, 2, 3, 4, 5]).includes(weekday));
  }

  /**
   * The day whose outcomes are being captured.
   *
   * The previous *working* day, not literally yesterday. On a Monday the meeting
   * reviews Friday — asking a team what they achieved on Sunday would produce a
   * screen of blanks and, worse, would tempt somebody into recording "carried
   * over" for a day nobody was there.
   */
  function reviewDate(iso, people) {
    let ms = addDays(isoToMs(iso), -1);
    for (let i = 0; i < 7 && !anybodyWorks(toISO(ms), people); i++) ms = addDays(ms, -1);
    return toISO(ms);
  }

  /** The next working day. On a Friday the meeting plans Monday. */
  function planDate(iso, people) {
    let ms = addDays(isoToMs(iso), 1);
    for (let i = 0; i < 7 && !anybodyWorks(toISO(ms), people); i++) ms = addDays(ms, 1);
    return toISO(ms);
  }

  async function render(root) {
    await flushQueue();

    const date = currentDate();

    // The roster decides which days count, so it is read before the window that
    // depends on it. One extra round trip, and it is what keeps a Monday meeting
    // pointed at Friday.
    const people = await rc.listPeople({ scheduledOnly: true });
    const review = reviewDate(date, people);
    const plan = planDate(date, people);

    const [categories, locations, parties, leave, planRows, actuals, chains, everybody, blockers, sheet,
      aliases] =
      await Promise.all([
        rc.listCategories(),
        rc.listLocations(),
        rc.listParties(),
        rc.listLeave(review, plan),
        rc.listPlan(review, plan),
        rc.listActuals(review, review),
        // "This is the fourth day running" is the sentence that changes the
        // conversation, and it was only ever in a report the field team cannot
        // open. It is derived from outcomes everybody can already read.
        rc.listCarryChains().catch(() => []),
        /* Everybody, not just the people taking shifts. Whoever chases a
           released possession is usually the manager — who is stood down from
           the huddle precisely because they do not take work from it — so
           filtering this list the way the roster is filtered would leave the
           most likely owner unselectable. */
        rc.listPeople().catch(() => []),
        // Every blocker still open, whoever raised it and whenever. This is the
        // standing item the meeting keeps returning to until somebody clears it.
        rc.listBlockers().catch(() => []),
        /* Only an administrator can read these; a member simply gets none and
           the block dialog offers nothing to link, which is correct.
           Both weeks, not just the reviewed one: on a Friday the day being planned
           is in the *next* week, and a look-ahead read for one week cannot say who
           BART wants on the other. */
        lookaheadWithResources(
          toISO(weekStart(isoToMs(review))),
          toISO(addDays(weekStart(isoToMs(plan)), 6))
        ),
        // Which spellings in the workbook are whose. Nothing is matched without
        // them beyond an exact fold of somebody's own name.
        rc.listPersonAliases().catch(() => []),
      ]);

    const chainByeId = new Map();
    for (const c of chains) chainByeId.set(c.carry_chain_id, c);

    const cats = byId(categories);
    const locs = byId(locations);
    const actualByPerson = new Map();
    for (const a of actuals) actualByPerson.set(a.person_id, a);

    /* What somebody is doing on a day: the plan where there is one, and the 4WLA
       where there is not. The Resource row names people, so it *is* the plan for
       those days — derived, never written — and a stored entry is somebody
       overriding it or planning a day the sheet says nothing about. Until this
       existed the meeting asked half the team what they had been planned for and
       answered "nothing", while the workbook said exactly what. */
    const laRows = sheet.rows;
    const index = assignmentIndex({
      planRows,
      laRows,
      absences: sheet.absences,
      // So an office day off the sheet lands in the Office category, and the
      // outcome recorded against it files there too.
      categories,
      register: nameRegister(everybody.length ? everybody : people, aliases),
    });
    const planFor = (personId, iso) => index.at(personId, iso);
    /* Everything planned for a day, which is what gets *shown*. `planFor` stays
       the single entry an outcome points at — one day, one answer to "how did it
       go" — but a shift is routinely two jobs and the meeting has to name both. */
    const plannedOn = (personId, iso) => index.on(personId, iso);
    /* Whether the sheet says somebody is off, which is a different question from
       what they were planned to do. The meeting must not ask a person on holiday
       how their day went, and most days the workbook is the only place the
       absence is written down at all. */
    const absentOn = (personId, iso) => index.absent(personId, iso);

    /* One context, handed to the table, the meeting and the digest alike. They
       are three readings of one day and the moment they are given different
       data they start disagreeing on screen, in front of the room. */
    const ctx = {
      people, review, plan, planFor, plannedOn, absentOn, actualByPerson, cats, locs,
      categories, locations, parties, leave, root, chainByeId, laRows, blockers, everybody,
      // What is typed in each person's "what they did" fields, read when a status
      // is pressed — see `workFields()`.
      drafts: new Map(),
    };

    root.appendChild(dateBar(date, review, plan, root, ctx));

    if (!people.length) {
      root.appendChild(el('p', { class: 'rc-hint', text: 'Add people in Organisation first.' }));
      return;
    }

    const body = el('tbody');
    for (const person of people) {
      body.appendChild(personRow({ ...ctx, person }));
    }

    root.appendChild(openBlockers(blockers, { people: everybody, locs, parties, root }));

    /* Running the meeting rather than filling it in. Same data, same writes —
       one person at a time, big enough to read from across the table, with the
       question asked the way somebody would ask it out loud. */
    if (presenting) {
      root.appendChild(presenter(ctx));
      return;
    }

    root.appendChild(el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table rc-huddle' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Person' }),
            el('th', { text: `Was planned — ${dayLabel(review)}` }),
            el('th', { text: 'What happened' }),
            el('th', { text: `Tomorrow — ${dayLabel(plan)}` }),
          ]),
        ]),
        body,
      ]),
    ]));

    root.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Nothing is written until you leave a field or press Enter, and saving redraws '
        + 'one row rather than the screen — otherwise the meeting would keep losing the box '
        + 'you were typing into. Entries made with no connection queue and go up on their own.',
    }));
    root.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Click a row and the meeting runs from the keyboard: ↑ ↓ down the team, then '
        + STATUSES.filter((st) => st.id !== 'absent').map((st) => `${st.key} ${st.label.toLowerCase()}`).join(', ')
        + '. Away is answered from the leave record rather than asked for.',
    }));
  }

  /**
   * What is still in the way, standing above the meeting.
   *
   * A blocked outcome says a day was lost; it never said who was chasing it, by
   * when, or whether it was still true this morning. So the list only ever grew,
   * and a list that only grows is one nobody reads. These stay on screen until
   * somebody closes them, which is the entire mechanism.
   *
   * Ordered by age, worst first: a blocker on its ninth day is a different
   * conversation from one raised yesterday, and the meeting should open on it.
   */
  function openBlockers(blockers, ctx) {
    const wrap = el('div', { class: 'rc-blockers' });
    if (!blockers.length) {
      wrap.appendChild(el('p', { class: 'rc-hint', text: 'Nothing outstanding. Nobody is waiting on anybody.' }));
      return wrap;
    }

    const people = byId(ctx.people);
    const sorted = [...blockers].sort((a, b) => (b.age_days || 0) - (a.age_days || 0));

    wrap.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: `${sorted.length} still in the way` }),
    ]));

    for (const b of sorted) {
      const overdue = b.due_date && b.due_date < todayISO();
      wrap.appendChild(el('div', { class: 'rc-blocker' + (overdue ? ' overdue' : '') }, [
        el('div', { class: 'rc-blocker-main' }, [
          el('div', { class: 'rc-blocker-what', text: b.summary }),
          el('div', { class: 'rc-hint', text: [
            people.get(b.person_id)?.name,
            ctx.locs.get(b.location_id)?.name,
            byId(ctx.parties).get(b.party_id)?.name ? `down to ${byId(ctx.parties).get(b.party_id).name}` : null,
            b.last_note,
          ].filter(Boolean).join(' · ') }),
        ]),
        el('div', { class: 'rc-blocker-state' }, [
          // The two facts that turn a grievance into an obstacle.
          b.owner_id
            ? badge(`${people.get(b.owner_id)?.name || 'somebody'} chasing`, 'info')
            : badge('nobody chasing', 'bad'),
          b.due_date
            ? badge(overdue ? `overdue since ${dayLabel(b.due_date)}` : `by ${dayLabel(b.due_date)}`,
              overdue ? 'bad' : 'muted')
            : null,
          badge(`day ${Number(b.age_days || 0) + 1}`, Number(b.age_days || 0) >= 4 ? 'bad' : 'warn'),
        ].filter(Boolean)),
        rc.isAdmin() || rc.canWrite()
          ? el('button', {
            class: 'cx-btn mini',
            text: 'Update',
            onClick: () => updateBlocker(b, ctx),
          })
          : null,
      ].filter(Boolean)));
    }

    wrap.appendChild(el('p', {
      class: 'rc-hint',
      text: 'These stay here until somebody closes them. Nothing is edited — taking one on, '
        + 'moving the date and closing it are each a row, because "we told them on the 4th and '
        + 'chased on the 9th" is the sentence a claim is built from.',
    }));
    return wrap;
  }

  /** Take one on, move it, chase it, or close it. Always by appending. */
  function updateBlocker(blocker, ctx) {
    const owner = selectInput({
      value: blocker.owner_id || '',
      placeholder: '— nobody yet —',
      options: ctx.people.map((p) => ({ value: p.id, label: p.name })),
    });
    const due = el('input', { type: 'date', class: 'cx-input', value: blocker.due_date || '' });
    const note = textInput({ placeholder: 'What has happened since' });
    const done = checkbox({ label: 'Cleared — take it off the list', checked: false });

    formModal({
      title: blocker.summary,
      body: el('div', { class: 'cx-form' }, [
        el('div', { class: 'cx-field' }, [
          el('label', { class: 'cx-label', text: 'Who is chasing it' }), owner,
          el('div', { class: 'cx-hint', text: 'The field a blocked day has never carried, and the '
            + 'one that decides whether anything happens about it.' }),
        ]),
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Expected by' }), due]),
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Update' }), note]),
        el('div', { class: 'cx-field' }, [done]),
      ]),
      confirmLabel: 'Add it',
      onConfirm: async () => {
        await rc.updateBlocker({
          blocker_id: blocker.id,
          state: done.querySelector('input').checked ? 'resolved' : 'open',
          owner_id: owner.value || null,
          due_date: due.value || null,
          note: note.value.trim() || null,
        });
        notifyChanged('blockers');
        clear(ctx.root);
        render(ctx.root);
      },
    });
  }

  /**
   * The meeting, run rather than filled in.
   *
   * One person, in focus, large enough to read from the other side of a table.
   * The room is the second audience and it needs different things from the
   * person answering: not the detail of the task but where it sits — which
   * look-ahead row it feeds, how many days it has been running, whether access
   * is confirmed. All of that is already recorded and none of it was ever in the
   * meeting.
   *
   * The question is asked the way somebody would say it out loud, because the
   * plan text is right there and using it as the question rather than as a
   * column is what makes this an interview instead of a form.
   *
   * Every write goes through exactly the same path as the table. This is a view,
   * not a second way of recording things.
   */
  /**
   * The question, in the words somebody would actually use.
   *
   * The plan text is usually written with the place in it — "Cable pull at TPSS
   * 12" — so appending the location unconditionally reads back as "at TPSS 12 at
   * TPSS 12". Say it only when the sentence does not already.
   */
  function askFor(planned, locs) {
    if (!planned) return 'Nothing was planned for you — what did you end up doing?';
    const task = planned.task || 'this';
    const where = locs.get(planned.location_id)?.name || '';
    const said = where && task.toLowerCase().includes(where.toLowerCase());
    return `Yesterday you were on ${task}${where && !said ? ` at ${where}` : ''} — how did it go?`;
  }

  function presenter(ctx) {
    const { people, review, plan, planFor, plannedOn, absentOn, actualByPerson, locs, cats,
      leave, root } = ctx;
    const wrap = el('div', { class: 'rc-present', tabindex: '0' });

    const asked = people.filter((p) => availability(p, review, leave, absentOn?.(p.id, review)).state === 'available');
    const queue = asked.length ? asked : people;
    if (atPerson === null) {
      const waiting = queue.findIndex((p) => !actualByPerson.get(p.id));
      atPerson = waiting < 0 ? 0 : waiting;
    }
    atPerson = Math.max(0, Math.min(atPerson, queue.length - 1));
    const person = queue[atPerson];

    const move = (by) => {
      atPerson = Math.max(0, Math.min(atPerson + by, queue.length - 1));
      clear(root);
      render(root);
    };
    const leaveMode = () => {
      presenting = false;
      clear(root);
      render(root);
    };

    /* Space and the arrows walk the room; Escape puts the table back. The keys
       are the ones a hand already on the table would reach for, and the status
       letters stay exactly what they are in the table. */
    wrap.addEventListener('keydown', (event) => {
      if (/^(input|textarea|select)$/i.test(event.target?.tagName || '')) return;
      if (event.key === ' ' || event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        leaveMode();
      } else {
        const status = STATUSES.find((st) => st.key === event.key.toLowerCase() && st.id !== 'absent');
        const button = status && [...wrap.querySelectorAll('button')].find((b) => b.textContent === status.label);
        if (button) {
          event.preventDefault();
          button.click();
        }
      }
    });
    setTimeout(() => wrap.focus(), 0);

    if (!person) {
      wrap.appendChild(el('p', { class: 'rc-hint', text: 'Nobody is working that day.' }));
      return wrap;
    }

    const wasPlanned = planFor(person.id, review);
    const actual = actualByPerson.get(person.id) || null;
    const tomorrow = planFor(person.id, plan);
    const chain = wasPlanned ? ctx.chainByeId?.get(carryChainFor(wasPlanned)) : null;
    const laRow = wasPlanned?.lookahead_row_id
      ? (ctx.laRows || []).find((r) => r.id === wasPlanned.lookahead_row_id)
      : null;
    const theirs = (ctx.blockers || []).filter((b) => b.person_id === person.id);

    wrap.appendChild(el('div', { class: 'rc-present-top' }, [
      el('span', { class: 'rc-eyebrow', text: `${atPerson + 1} of ${queue.length}` }),
      el('button', { class: 'cx-btn mini ghost', text: 'Back to the table', onClick: leaveMode }),
    ]));

    wrap.appendChild(el('h2', { class: 'rc-present-who', text: person.name }));
    wrap.appendChild(el('div', { class: 'rc-hint', text: [person.title, person.subsystem].filter(Boolean).join(' · ') }));

    /* The question, in the words somebody would use. */
    wrap.appendChild(el('p', { class: 'rc-present-ask', text: askFor(wasPlanned, locs) }));

    /* What the room needs, which is not what the person needs. */
    const context = el('div', { class: 'rc-present-context' });
    if (laRow) {
      context.appendChild(badge(`BART: ${(laRow.raw_label || '').slice(0, 40)}`, 'info'));
    }
    if (chain && chain.carries >= 1) {
      context.appendChild(badge(`${ordinal(chain.carries + 1)} day on it`,
        chain.carries >= 4 ? 'bad' : 'warn'));
    }
    if (wasPlanned && !laRow) {
      context.appendChild(badge('not against a look-ahead row', 'muted'));
    }
    /* The rest of the day. The question above names the first task; a shift with
       three jobs on it and only one of them said out loud is how the other two
       stop being asked about. */
    for (const also of (plannedOn ? plannedOn(person.id, review) : []).slice(1)) {
      context.appendChild(badge(`also: ${(also.task || '—').slice(0, 36)}`, 'info'));
    }
    // Flagged only where a person typed the day in. The workbook is the default
    // and needs no announcing.
    const byHand = manualEntry(wasPlanned);
    if (byHand) context.appendChild(byHand);
    for (const b of theirs) {
      context.appendChild(badge(`blocked: ${b.summary.slice(0, 36)}`, 'bad'));
    }
    if (cats.get(wasPlanned?.category_id)?.name) {
      context.appendChild(badge(cats.get(wasPlanned.category_id).name, 'muted'));
    }
    if (context.children.length) wrap.appendChild(context);

    /* The answer. */
    const answer = el('div', { class: 'rc-present-answer' });
    const away = availability(person, review, leave, absentOn?.(person.id, review));
    if (away.state === 'leave') {
      // "On leave" whether somebody booked it or the workbook says it. The
      // distinction belongs in PTO, where it can be acted on; in the middle of a
      // meeting it is the same fact.
      answer.appendChild(badge('On leave', 'muted'));
    } else if (actual) {
      const status = STATUS_BY_ID.get(actual.status);
      answer.appendChild(badge(status?.label || actual.status, status?.tone || 'muted'));
      for (const node of outcomeDetail(actual, ctx, person)) answer.appendChild(node);
      /* Recorded is not final, and in the room least of all: the pick just made
         stays pressable, and there is a box for a note whatever the status. Both
         write a correction — a new row pointing at this one — through the same
         path the table uses, so nothing can be said here that the table would
         read differently. */
      if (rc.isAdmin() || (person.id === rc.me()?.id && rc.canWrite())) {
        const redrawRoom = () => { clear(root); render(root); };
        answer.appendChild(workFields({
          ctx, person, date: review, plannedEntry: wasPlanned, current: actual, redraw: redrawRoom,
        }));
        answer.appendChild(statusButtons(ctx, person, review, wasPlanned, redrawRoom, actual));
        answer.appendChild(notesBox({
          ctx, person, date: review, plannedEntry: wasPlanned, current: actual, redraw: redrawRoom,
        }));
      }
    } else if (rc.isAdmin() || (person.id === rc.me()?.id && rc.canWrite())) {
      const redrawRoom = () => { clear(root); render(root); };
      /* What they did and what kind of work it was, typed as they say it — and on
         a day with nothing planned, the only statement of the work there is. The
         status pressed next records it with the outcome. */
      answer.appendChild(workFields({ ctx, person, date: review, plannedEntry: wasPlanned, redraw: redrawRoom }));
      answer.appendChild(statusButtons(ctx, person, review, wasPlanned, redrawRoom));
    }
    wrap.appendChild(answer);

    wrap.appendChild(el('div', { class: 'rc-present-next' }, [
      el('span', { class: 'rc-eyebrow', text: `Tomorrow — ${dayLabel(plan)}` }),
      tomorrow
        ? el('div', { text: tomorrow.task || '—' })
        : el('div', { class: 'rc-hint', text: 'nothing set yet' }),
      manualEntry(tomorrow),
    ].filter(Boolean)));

    wrap.appendChild(el('div', { class: 'rc-present-move' }, [
      el('button', { class: 'cx-btn ghost', text: '← Back', onClick: () => move(-1), disabled: atPerson === 0 }),
      el('button', {
        class: 'cx-btn primary',
        text: atPerson === queue.length - 1 ? 'Done' : 'Next →',
        onClick: () => (atPerson === queue.length - 1 ? leaveMode() : move(1)),
      }),
    ]));

    wrap.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Space or → for the next person, ← to go back, Escape for the table. The status '
        + 'letters work here too.',
    }));

    return wrap;
  }

  /**
   * The meeting, written down.
   *
   * A huddle answers three questions and then evaporates: what happened, what is
   * next, and what is still in the way. The answers are all in the database
   * afterwards, which is not the same as anybody having read them — the people
   * who most need them are the ones who were not in the room.
   *
   * So the same three questions, as text somebody can paste into whatever their
   * project actually talks in. Plain text on purpose: a PDF nobody opens is
   * worse than four lines in a message, and this has to survive being forwarded.
   *
   * It carries no KPI and no rate. Those are a different audience and a
   * different permission, and the moment a digest carries a percentage against
   * somebody's name it stops being a summary and starts being a review.
   */
  function digestText(ctx) {
    const { people, review, plan, planFor, plannedOn, absentOn, actualByPerson, locs, leave,
      blockers, chainByeId } = ctx;
    const lines = [];
    const bullet = { completed: '✓', partial: '~', carried: '→', blocked: '!', reassigned: '↔' };

    lines.push(`Huddle — ${dayLabel(plan, 'medium')}`);
    lines.push('');
    lines.push(`What happened — ${dayLabel(review, 'medium')}`);

    const silent = [];
    for (const person of people) {
      const away = availability(person, review, leave, absentOn?.(person.id, review));
      if (away.state === 'leave') {
        lines.push(`  · ${person.name} — on leave`);
        continue;
      }
      if (away.state === 'non-working') continue;

      const actual = actualByPerson.get(person.id);
      if (!actual) {
        silent.push(person.name);
        continue;
      }
      const status = STATUS_BY_ID.get(actual.status);
      const said = [actual.task, actual.blocked_reason, actual.note].filter(Boolean).join(' — ');
      const where = locs.get(actual.location_id)?.name;
      lines.push(`  ${bullet[actual.status] || '·'} ${person.name} — ${status?.label || actual.status}`
        + `${where ? ` at ${where}` : ''}${said ? `: ${said}` : ''}`);
    }
    // Named rather than silently missing. "Nobody said" is a fact about the
    // meeting, and leaving it out is how a gap becomes a claim that everything
    // went fine.
    if (silent.length) lines.push(`  · nothing recorded for ${silent.join(', ')}`);

    lines.push('');
    lines.push(`What is next — ${dayLabel(plan, 'medium')}`);
    const unset = [];
    for (const person of people) {
      if (availability(person, plan, leave, absentOn?.(person.id, plan)).state !== 'available') continue;
      const tasks = plannedOn ? plannedOn(person.id, plan) : [planFor(person.id, plan)].filter(Boolean);
      if (!tasks.length) {
        unset.push(person.name);
        continue;
      }
      // Every task, one line each, with the name only on the first — a digest is
      // read aloud, and "Priya — X. Priya — Y" is somebody reading a table out.
      tasks.forEach((next, i) => {
        const chain = next.carry_chain_id ? chainByeId?.get(next.carry_chain_id) : null;
        const where = locs.get(next.location_id)?.name;
        const who = i === 0 ? `${person.name} — ` : `${' '.repeat(person.name.length)}   `;
        lines.push(`  ${who}${next.task || '—'}${where ? ` at ${where}` : ''}`
          + `${chain && chain.carries >= 1 ? ` (${ordinal(chain.carries + 1)} day on it)` : ''}`);
      });
    }
    if (unset.length) lines.push(`  · nothing set yet for ${unset.join(', ')}`);

    const open = (blockers || []).filter((b) => b.state !== 'resolved');
    lines.push('');
    lines.push(open.length ? `What is in the way — ${open.length}` : 'What is in the way — nothing');
    for (const b of open) {
      const who = (ctx.everybody || people).find((p) => p.id === b.owner_id)?.name;
      lines.push(`  ${b.summary} — ${(people.find((p) => p.id === b.person_id) || {}).name || 'the team'}`
        + `${who ? ` · ${who} chasing` : ' · nobody chasing it'}`
        + `${b.due_date ? ` · expected by ${dayLabel(b.due_date)}` : ''}`
        + ` · day ${Math.max(1, Number(b.age_days) || 1)}`);
    }

    return lines.join('\n');
  }

  /**
   * Show it before it is sent.
   *
   * Copy *and* save, because the two go to different places — a message to the
   * team, and a file beside the week's evidence — and neither is a good default
   * for the other. The text is editable in the box: somebody about to send this
   * to a client knows something the database does not.
   */
  function openDigest(ctx) {
    const text = digestText(ctx);
    const box = el('textarea', { class: 'cx-textarea', rows: 18, spellcheck: 'false' });
    box.value = text;

    const copy = el('button', {
      class: 'cx-btn mini',
      text: 'Copy it',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(box.value);
          toast({ tone: 'good', message: 'Copied — paste it wherever the team talks.' });
        } catch {
          // A denied clipboard is not a failure to produce the digest. It is
          // already on screen and selectable, so say that rather than nothing.
          box.select();
          toast({ tone: 'warn', message: 'The clipboard was refused — it is selected, copy it by hand.' });
        }
      },
    });
    const save = el('button', {
      class: 'cx-btn mini ghost',
      text: 'Save it',
      onClick: () => saveFile(`huddle-${ctx.plan}.txt`, box.value, 'text/plain'),
    });

    formModal({
      title: 'The meeting, written down',
      body: el('div', { class: 'cx-form' }, [
        el('p', {
          class: 'rc-hint',
          text: 'What happened, what is next, and what is still in the way — for the people who '
            + 'were not in the room. No rates and no scores: those are a different audience.',
        }),
        box,
        el('div', { style: 'display:flex;gap:6px' }, [copy, save]),
      ]),
      confirmLabel: 'Done',
      onConfirm: () => {},
    });
  }

  function dateBar(date, review, plan, root, ctx) {
    const move = (days) => {
      onDate = toISO(addDays(isoToMs(date), days));
      clear(root);
      render(root);
    };

    return el('div', { class: 'rc-section-head' }, [
      el('button', {
        class: 'cx-btn icon mini ghost',
        'aria-label': 'Previous day',
        html: icon('chevron-left', { size: 13 }),
        onClick: () => move(-1),
      }),
      el('h3', { text: `Huddle — ${dayLabel(date, 'medium')}` }),
      el('button', {
        class: 'cx-btn icon mini ghost',
        'aria-label': 'Next day',
        html: icon('chevron-right', { size: 13 }),
        onClick: () => move(1),
      }),
      el('button', {
        class: 'cx-btn mini',
        text: 'Run the meeting',
        title: 'One person at a time, large enough for the room. Space or → for the next.',
        onClick: () => {
          presenting = true;
          atPerson = null;
          clear(root);
          render(root);
        },
      }),
      el('button', {
        class: 'cx-btn mini ghost',
        text: 'Digest',
        title: 'What happened, what is next and what is in the way — as text to paste.',
        onClick: () => openDigest(ctx),
      }),
      date === todayISO() ? null : el('button', {
        class: 'cx-btn mini ghost',
        text: 'Today',
        onClick: () => {
          onDate = null;
          clear(root);
          render(root);
        },
      }),
    ].filter(Boolean));
  }

  /**
   * One person's row.
   *
   * Rebuilt in place on save — `replaceWith` on this node only — so the rest of
   * the table, including any field somebody else is mid-way through, is left
   * exactly alone.
   */
  /**
   * Where a day's plan came from, when it did not come from the workbook.
   *
   * The badge used to run the other way — "From 4WLA" against every derived day —
   * and it was on nearly every cell on the screen, which is the definition of a
   * badge saying nothing. The 4WLA *is* the plan: that is the assumption now, and
   * an assumption does not need announcing a hundred times.
   *
   * What is worth a flag is the exception. A stored `rc_plan_entries` row is
   * somebody typing a day in by hand — overriding the sheet, or planning a day it
   * says nothing about — and that is the one case a reader should stop on,
   * because it is the only thing on the screen the workbook cannot account for.
   * `id` is what tells them apart: a derived day carries `id: null` by design.
   */
  function manualEntry(entry) {
    if (!entry || entry.from_lookahead || !entry.id) return null;
    return badge('Manual', 'warn');
  }

  function personRow(ctx) {
    const { person, review, plan, planFor, absentOn, actualByPerson, cats, locs, leave, root, chainByeId } = ctx;

    // Focusable, so the whole meeting can be run from the keyboard: down the
    // roster with the arrows, one letter per outcome. Fifteen people at a fixed
    // time is a lot of clicking otherwise.
    const row = el('tr', { tabindex: '-1', class: 'rc-huddle-row' });

    /* One letter per outcome, on the row that has focus. The keys are the ones
       already published beside each button (`c`, `p`, `x`, `b`, `r`), so the
       shortcut is the label rather than a second thing to learn. Arrows walk the
       roster. A field that is being typed into keeps its keystrokes. */
    row.addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const inField = /^(input|textarea|select)$/i.test(event.target?.tagName || '');
      if (inField) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const next = event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
        if (next) {
          event.preventDefault();
          next.focus();
        }
        return;
      }

      const status = STATUSES.find((st) => st.key === event.key.toLowerCase() && st.id !== 'absent');
      if (!status) return;
      const button = [...row.querySelectorAll('button')].find((b) => b.textContent === status.label);
      if (!button) return;
      event.preventDefault();
      button.click();
    });
    const redraw = () => {
      const next = personRow(ctx);
      row.replaceWith(next);
    };

    const away = availability(person, review, leave, absentOn?.(person.id, review));
    const wasPlanned = planFor(person.id, review);
    const actual = actualByPerson.get(person.id) || null;
    const tomorrow = planFor(person.id, plan);
    const admin = rc.isAdmin();
    // A viewer has a person row, so "is this my row" is true for them too. Asking
    // whether they may write at all is the difference between read-only and not,
    // and it is the same question `rc_can_act_for()` answers in the database.
    const mine = person.id === rc.me()?.id && rc.canWrite();

    /* Name, and why they are not being asked for a goal.
       `data-label` is what the header row becomes on a narrow screen, where the
       table is stacked into a card per person — see the 620px rule. */
    row.appendChild(el('td', {}, [
      el('div', { text: person.name }),
      el('div', { class: 'rc-hint', text: person.subsystem || person.title || '' }),
    ]));

    /* What they were supposed to be doing — the promise the outcome answers.
       The chain age rides with it: a task on its fourth day is a different
       conversation from one on its first, and that was only visible in a report
       the field team cannot open. */
    const chain = wasPlanned ? chainByeId?.get(carryChainFor(wasPlanned)) : null;
    const plannedDay = ctx.plannedOn ? ctx.plannedOn(person.id, review) : [wasPlanned].filter(Boolean);
    row.appendChild(el('td', { 'data-label': 'Was planned' },
      plannedDay.length
        ? plannedDay.map((task, i) => el('div', { class: i ? 'rc-day-next' : '' }, [
          el('div', { text: task.task || '—' }),
          el('div', { class: 'rc-hint' }, [
            el('span', { text: [locs.get(task.location_id)?.name,
              cats.get(task.category_id)?.name,
              task.shift !== 'day' ? task.shift : null].filter(Boolean).join(' · ') }),
          ]),
          // The chain belongs to the task it was carried on, which is the first.
          i === 0 && chain && chain.carries >= 2
            ? badge(`${ordinal(chain.carries + 1)} day`, chain.carries >= 4 ? 'bad' : 'warn')
            : null,
          manualEntry(task),
        ].filter(Boolean)))
        : [el('span', { class: 'rc-hint', text: 'nothing planned' })]));

    /* What happened. Absence is answered from the leave record rather than
       asked for — somebody on leave did not carry anything over, and letting
       that fall into a performance status is exactly what the five-way split
       exists to prevent. */
    const outcome = { 'data-label': 'What happened' };
    if (away.state === 'leave') {
      row.appendChild(el('td', outcome, [badge('On leave', 'muted')]));
    } else if (away.state === 'non-working') {
      row.appendChild(el('td', outcome, [el('span', { class: 'rc-hint', text: 'not a working day' })]));
    } else if (actual) {
      const status = STATUS_BY_ID.get(actual.status);
      const cell = el('td', outcome, [
        badge(status?.label || actual.status, status?.tone || 'muted'),
        ...outcomeDetail(actual, ctx, person),
      ]);
      /* Recorded is not final. The status can be changed and a note added or
         edited afterwards — as a correction, a new row pointing at this one —
         by whoever could have recorded it in the first place. */
      if (admin || mine) {
        cell.appendChild(el('button', {
          class: 'cx-btn mini ghost rc-edit-outcome',
          text: 'Edit',
          title: 'Change the status or the note. The first answer stays on the record.',
          onClick: () => {
            clear(cell);
            cell.appendChild(workFields({ ctx, person, date: review, plannedEntry: wasPlanned, current: actual, redraw }));
            cell.appendChild(statusButtons(ctx, person, review, wasPlanned, redraw, actual));
            cell.appendChild(notesBox({ ctx, person, date: review, plannedEntry: wasPlanned, current: actual, redraw }));
          },
        }));
      }
      row.appendChild(cell);
    } else if (admin || mine) {
      row.appendChild(el('td', outcome, [
        workFields({ ctx, person, date: review, plannedEntry: wasPlanned, redraw }),
        statusButtons(ctx, person, review, wasPlanned, redraw),
      ]));
    } else {
      row.appendChild(el('td', outcome, [el('span', { class: 'rc-hint', text: '—' })]));
    }

    /* Tomorrow. */
    row.appendChild(el('td', { 'data-label': 'Tomorrow' }, [
      tomorrow
        ? el('div', {}, [
          el('div', { text: tomorrow.task || '—' }),
          el('div', { class: 'rc-hint', text: locs.get(tomorrow.location_id)?.name || '' }),
          tomorrow.carry_chain_id ? badge('Carried over', 'warn') : null,
          manualEntry(tomorrow),
        ].filter(Boolean))
        : admin
          ? el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap;align-items:center' }, [
            el('button', {
              class: 'cx-btn mini ghost',
              text: 'Set goal',
              onClick: () => setGoal(ctx, person, plan, root),
            }),
            /* Most days most people are on the same task at the same place. One
               button beats four fields, and it is the difference between a
               fifteen-minute meeting and a forty-minute one. */
            wasPlanned ? el('button', {
              class: 'cx-btn mini ghost',
              text: 'Same again',
              title: `Repeat "${wasPlanned.task || 'yesterday\u2019s task'}" tomorrow.`,
              onClick: async () => {
                await rollForward(wasPlanned, person, plan, null);
                notifyChanged('plan');
                clear(root);
                render(root);
              },
            }) : null,
          ].filter(Boolean))
          : el('span', { class: 'rc-hint', text: '—' }),
    ]));

    return row;
  }

  /**
   * Everything an outcome says, once it has been recorded.
   *
   * One function because the table and the meeting must never read differently —
   * the room is looking at one of them while somebody types into the other.
   *
   * Two of these are new and both answer questions that used to be asked out
   * loud. **Who recorded it** matters because most days somebody speaks and
   * somebody else types, and an outcome attributed to the person who entered it
   * is how a record stops being trusted; it is shown only when the two differ,
   * which is the only case anybody wonders about. And **the photograph** is the
   * whole reason evidence was worth attaching in the first place — a link that
   * is signed when it is clicked rather than when the page is drawn, so a huddle
   * left open all morning does not accumulate expiring URLs.
   */
  function outcomeDetail(actual, ctx, person) {
    const out = [];
    if (actual.task) out.push(el('div', { class: 'rc-outcome-task', text: actual.task }));
    const category = ctx.cats?.get(actual.category_id)?.name;
    if (category) out.push(el('div', { class: 'rc-hint rc-outcome-cat', text: category }));
    if (actual.blocked_reason) out.push(el('div', { class: 'rc-hint', text: actual.blocked_reason }));
    if (actual.note) out.push(el('div', { class: 'rc-hint', text: actual.note }));

    if (actual.evidence_path) {
      out.push(el('button', {
        class: 'cx-btn mini ghost rc-evidence',
        html: `${icon('paperclip', { size: 11 })}<span>Photo</span>`,
        title: 'Open the photograph taken with this outcome',
        onClick: async (event) => {
          event.stopPropagation();
          try {
            window.open(await rc.evidenceUrl(actual.evidence_path), '_blank', 'noopener');
          } catch (err) {
            toast({ tone: 'bad', message: `That photograph could not be opened — ${err.message}` });
          }
        },
      }));
    }

    const by = (ctx.everybody || ctx.people || []).find((p) => p.user_id && p.user_id === actual.created_by);
    if (by && by.id !== person?.id) {
      out.push(el('div', { class: 'rc-hint', text: `recorded by ${by.name}` }));
    }
    // A changed answer says so. The first one is still on the record underneath.
    if (actual.supersedes_id) out.push(el('div', { class: 'rc-hint', text: 'corrected' }));
    return out;
  }

  /**
   * What somebody did that day, and what kind of work it was — typed in the room.
   *
   * The plan says what they were asked to do; this is what the day was actually
   * spent on, and on a day with nothing planned it is the only statement of the
   * work there is. It starts from the plan's own words and category, so the
   * common case is no typing at all, and the category is what the reports group
   * the outcome under.
   *
   * Before an outcome is recorded the fields are a draft: `commitOutcome()` reads
   * them (through `ctx.drafts`) when a status is pressed, so pressing "Completed"
   * records the words and the category with it. After, they edit what was said —
   * Enter in the box, a new category, or Save writes a correction, the same
   * superseding row every other change to an outcome is. Not on leaving the box:
   * the status buttons sit beside it, and a correction written on the way to
   * pressing one would be corrected again a moment later, which the database
   * rightly refuses.
   */
  function workFields({ ctx, person, date, plannedEntry, current = null, redraw }) {
    const selected = current ? (current.category_id || '') : (plannedEntry?.category_id || '');
    const task = textInput({
      value: current ? (current.task ?? plannedEntry?.task ?? '') : (plannedEntry?.task || ''),
      placeholder: plannedEntry ? 'What they did' : 'Nothing was planned — what did they do?',
    });
    task.setAttribute('aria-label', `What ${person.name} did`);
    task.classList.add('rc-work-task');
    const category = selectInput({
      value: selected,
      placeholder: 'Category…',
      options: (ctx.categories || [])
        .filter((c) => c.active !== false || c.id === selected)
        .map((c) => ({ value: c.id, label: c.name })),
    });
    category.setAttribute('aria-label', `What kind of work ${person.name} did`);
    category.classList.add('rc-work-cat');

    // Nothing once the row has been redrawn without these fields: a draft left in
    // the map must never speak for a box that is no longer on screen.
    const read = () => (task.isConnected
      ? { task: task.value.trim() || null, categoryId: category.value || null }
      : null);
    ctx.drafts?.set(person.id, read);

    const wrap = el('div', { class: 'rc-work' }, [
      el('span', { class: 'rc-eyebrow', text: 'What they did' }),
      task,
      category,
    ]);

    if (current) {
      const save = () => {
        const next = read();
        if (!next) return;
        if (next.task === (current.task || null) && next.categoryId === (current.category_id || null)) return;
        commitOutcome({
          ctx, person, date, plannedEntry, redraw,
          status: STATUS_BY_ID.get(current.status),
          note: current.note || null,
          supersedes: current,
        });
      };
      task.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        save();
      });
      category.addEventListener('change', save);
      wrap.appendChild(el('button', { class: 'cx-btn mini', text: 'Save', onClick: save }));
    } else {
      // Enter here is not "next person" or "record": a status has not been chosen.
      task.addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault(); });
    }
    return wrap;
  }

  /**
   * The words and category an outcome is recorded with: what is typed in its
   * fields where they are on screen, and otherwise what the outcome being
   * corrected said, then what the plan said.
   */
  function workOf(ctx, person, plannedEntry, supersedes) {
    const draft = ctx.drafts?.get(person.id)?.();
    if (draft) return draft;
    return {
      task: supersedes?.task ?? null,
      categoryId: supersedes?.category_id || plannedEntry?.category_id || null,
    };
  }

  /**
   * One button per status, so a whole team can be gone through at speed.
   *
   * A dropdown would be two clicks and a read; this is one click. Blocked opens a
   * dialog because it is the one status that cannot be recorded without more —
   * a reason and somebody answerable — and the database refuses it otherwise.
   */
  function statusButtons(ctx, person, date, plannedEntry, redraw, current = null) {
    const wrap = el('div', { style: 'display:flex;gap:3px;flex-wrap:wrap' });

    for (const status of STATUSES) {
      if (status.id === 'absent') continue;
      const chosen = current?.status === status.id;
      wrap.appendChild(el('button', {
        /* The pick already made is shown pressed and stays pressable: pressing
           a *different* one changes the answer, and pressing the same one opens
           the line underneath to edit what was said with it. Nothing here is
           un-pressable — an outcome that could not be changed once pressed
           taught people to hesitate over the one button that matters. */
        class: chosen ? 'cx-btn mini' : 'cx-btn mini ghost',
        'aria-pressed': String(chosen),
        text: status.label,
        title: (status.family === 'health'
          ? 'Project health — never counted against the individual'
          : 'Counts toward individual efficiency')
          + `  ·  press ${status.key} with this row selected`
          + (chosen ? '  ·  recorded — press to edit the note' : ''),
        onClick: () => {
          if (status.id === 'blocked') {
            blockedDialog(ctx, person, date, plannedEntry, redraw, current);
            return;
          }
          /* A finished task has nothing left to say about it, so it stays one
             click. Anything else does — "partial" with no note is a number
             nobody can act on in the morning — so the buttons give way to a
             line asking for it, pre-filled with the plan so it is an edit
             rather than a retype. Re-pressing the pick already made is the one
             case "completed" does open the line: that is somebody wanting to
             say something about it after all. */
          if (status.id === 'completed' && !chosen) {
            commitOutcome({ ctx, person, date, plannedEntry, status, redraw, supersedes: current });
            return;
          }
          clear(wrap);
          wrap.appendChild(sayMore({
            ctx, person, date, plannedEntry, status, redraw, host: wrap, current,
          }));
        },
      }));
    }
    return wrap;
  }

  /**
   * A note on an outcome, whatever its status.
   *
   * "Completed" stays one click because a finished task has nothing left to say
   * about it — until it does. This is the box for that, and for every other
   * status too: what somebody said about a day is worth writing down whether or
   * not the status asked for it. Saving writes a correction (a new row pointing
   * at the old one — the table has no UPDATE) with the same status and the new
   * words, and only if the words changed: a save that changed nothing would be a
   * row on the record saying nothing.
   */
  function notesBox({ ctx, person, date, plannedEntry, current, redraw }) {
    const wrap = el('div', { class: 'rc-notes' });
    const box = el('textarea', {
      class: 'cx-textarea rc-notes-box',
      rows: 2,
      placeholder: 'Anything to add about this day',
      'aria-label': `Notes for ${person.name}`,
    });
    box.value = current?.note || '';
    const save = el('button', {
      class: 'cx-btn mini',
      text: 'Save note',
      onClick: () => {
        const note = box.value.trim() || null;
        if (note === (current?.note || null)) { redraw(); return; }
        commitOutcome({
          ctx, person, date, plannedEntry, redraw, note,
          status: STATUS_BY_ID.get(current.status),
          supersedes: current,
        });
      },
    });
    wrap.appendChild(el('span', { class: 'rc-eyebrow', text: 'Notes' }));
    wrap.appendChild(box);
    wrap.appendChild(save);
    return wrap;
  }

  /**
   * The line between pressing a status and it being recorded.
   *
   * Two things go on it: what is left of the task, pre-filled with the plan
   * text, and a photograph. Neither is required and neither can lose the
   * outcome — pressing the status *was* the record, so every way out of here
   * writes it, including Escape and walking away to the next person. What
   * changes is only whether anything was said with it.
   *
   * That is the opposite of a dialog, deliberately. A dialog somebody dismisses
   * loses the answer, and the one thing this meeting cannot afford is an outcome
   * that looks recorded and is not.
   */
  function sayMore({ ctx, person, date, plannedEntry, status, redraw, host, current = null }) {
    const strip = el('div', { class: 'rc-saymore' });
    let done = false;

    /* Editing what was already said starts from what was said; a fresh answer
       starts from the plan, so it is an edit rather than a retype. */
    const opening = current?.note
      || (status.id === 'carried' || status.id === 'partial' ? (plannedEntry?.task || '') : '');
    const note = textInput({
      value: opening,
      placeholder: status.id === 'reassigned' ? 'What they did instead' : 'What is left',
    });
    const photo = el('input', {
      type: 'file',
      accept: 'image/*',
      // Opens the camera on a phone rather than the file browser, which is the
      // device this meeting is actually run from.
      capture: 'environment',
      class: 'rc-saymore-photo',
      'aria-label': 'Attach a photograph',
    });

    const commit = ({ cancel = false } = {}) => {
      if (done) return;
      done = true;
      const said = note.value.trim() || null;
      const file = photo.files?.[0] || null;
      /* A correction that changes nothing is a row on the record saying nothing,
         so editing and then walking away, or pressing Escape, writes nothing.
         A *first* answer is different: pressing the status was the record, and
         every way out of here has to keep it. */
      if (current && (cancel || (said === (current.note || null) && status.id === current.status && !file))) {
        redraw();
        return;
      }
      commitOutcome({
        ctx, person, date, plannedEntry, status, redraw,
        note: said,
        file,
        supersedes: current,
      });
    };

    strip.appendChild(el('span', { class: 'rc-eyebrow', text: status.label }));
    strip.appendChild(note);
    strip.appendChild(el('label', { class: 'cx-btn mini ghost rc-saymore-clip', title: 'Attach a photograph' }, [
      el('span', { html: icon('paperclip', { size: 12 }) }),
      photo,
    ]));
    strip.appendChild(el('button', { class: 'cx-btn mini primary', text: 'Record', onClick: commit }));

    strip.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') {
          if (current) { commit({ cancel: true }); return; }
          note.value = '';
        }
        commit();
      }
    });
    // Moving on records it. Somebody who presses "partial" and goes straight to
    // the next person has answered the question; the note was the optional part.
    strip.addEventListener('focusout', (event) => {
      if (!strip.contains(event.relatedTarget)) commit();
    });

    setTimeout(() => {
      note.focus();
      note.setSelectionRange(note.value.length, note.value.length);
    }, 0);
    if (host) host.classList.add('rc-saymore-host');
    return strip;
  }

  /**
   * Write one outcome, and the photograph that goes with it.
   *
   * The picture goes up *first*, under the uuid the row is about to carry:
   * `rc_actuals` has no UPDATE grant, so a path attached afterwards would need a
   * second row superseding the first. An upload that fails is said out loud and
   * the outcome is still recorded — losing what somebody said because a
   * photograph did not upload would be the wrong way round.
   */
  async function commitOutcome({
    ctx, person, date, plannedEntry, status, redraw, note = null, file = null, supersedes = null,
  }) {
    const clientUuid = newUuid();
    /* A day the 4WLA planned has no stored row, so there is no id to chain on —
       and a chain has to start somewhere. It starts at the first carry, which is
       exactly when something first became stuck: before that nothing had been
       carried at all. */
    const chainId = status.id === 'carried'
      ? (carryChainFor(plannedEntry) || (plannedEntry ? newUuid() : null))
      : null;

    let evidencePath = null;
    if (file) {
      const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase();
      try {
        evidencePath = await rc.uploadEvidence(`${clientUuid}.${ext}`, file);
      } catch (err) {
        toast({ tone: 'warn', message: `The outcome is recorded; the photograph is not — ${err.message}` });
      }
    }

    /* A correction keeps what the first answer knew that this one does not: the
       look-ahead row it was recorded against, and — where the status is still
       blocked — the reason and the party, which the database refuses a block
       without. The photograph carries over inside the function itself, so a
       replayed queue entry keeps it too. */
    const keep = supersedes && supersedes.status === status.id ? supersedes : null;
    const work = workOf(ctx, person, plannedEntry, supersedes);
    const { sent, error } = await record({
      clientUuid,
      personId: person.id,
      date,
      status: status.id,
      note,
      task: work.task,
      categoryId: work.categoryId,
      locationId: plannedEntry?.location_id || supersedes?.location_id || null,
      planEntryId: plannedEntry?.id || supersedes?.plan_entry_id || null,
      carryChainId: chainId,
      evidencePath,
      lookaheadRowId: supersedes?.lookahead_row_id || null,
      blockedReason: keep?.blocked_reason || null,
      blockedPartyId: keep?.blocked_party_id || null,
      supersedesId: supersedes?.id || null,
    });
    if (!sent) toast({ tone: 'warn', message: `Saved locally — ${error.message}` });

    /* A carried task is going to be done tomorrow, and re-typing it is both slow
       and how the chain used to get broken. Rolling it forward here is the only
       place that knows both the outcome and the entry it came from. */
    if (chainId && plannedEntry && !ctx.planFor(person.id, ctx.plan)?.id) {
      try {
        await rollForward(plannedEntry, person, ctx.plan, chainId);
        notifyChanged('plan');
        clear(ctx.root);
        render(ctx.root);
        return;
      } catch (err) {
        toast({ tone: 'warn', message: `Recorded, but tomorrow was not set — ${err.message}` });
      }
    }
    notifyChanged('actuals');
    redraw();
  }

  /**
   * The chain a carried task belongs to.
   *
   * Keyed on the plan entry it came from, so five days of the same stuck job are
   * one chain rather than five separate failures charged to one person. What
   * makes the report useful is the chain's *age*, not the count.
   */
  function carryChainFor(plannedEntry) {
    if (!plannedEntry) return null;
    // The chain the entry already belongs to, or a new one starting here. Taking
    // the id blindly is what made a five-day stuck job read as five separate
    // failures: rolling it forward makes a new entry, and the next carry would
    // have started over.
    return plannedEntry.carry_chain_id || plannedEntry.id;
  }

  /**
   * Put a task on tomorrow.
   *
   * `chainId` carries a carry chain across the roll — that is the whole reason
   * this is one function rather than two: repeating a task and carrying one over
   * write the same row, and only the chain tells them apart afterwards.
   */
  async function rollForward(from, person, date, chainId) {
    await rc.addPlanEntries([{
      person_id: person.id,
      work_date: date,
      shift: from?.shift || 'day',
      location_id: from?.location_id || null,
      task: from?.task || null,
      category_id: from?.category_id || null,
      lookahead_row_id: from?.lookahead_row_id || null,
      carry_chain_id: chainId,
    }]);
  }

  /** 1st, 2nd, 3rd, 4th — for "the fourth day running". */
  function ordinal(n) {
    const rest = n % 100;
    if (rest >= 11 && rest <= 13) return `${n}th`;
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
  }

  function blockedDialog(ctx, person, date, plannedEntry, redraw, current = null) {
    const reason = textInput({ placeholder: 'What stopped it', value: current?.blocked_reason || '' });
    const owner = selectInput({
      value: rc.me()?.id || '',
      placeholder: '— nobody yet —',
      options: (ctx.everybody || ctx.people || []).map((p) => ({ value: p.id, label: p.name })),
    });
    const due = el('input', { type: 'date', class: 'cx-input' });
    const party = selectInput({
      value: ctx.parties[0]?.id,
      options: ctx.parties.map((p) => ({ value: p.id, label: p.name })),
    });

    /* Which look-ahead row this was blocked against.
       Optional, and offered rather than chosen: "blocked by BART" is an
       assertion, and "blocked on the row BART themselves scheduled for that
       location that week" is a document. The list is narrowed to the location
       already on the plan where there is one — matching on date and location,
       never on the activity text, which is the rule everywhere in this module. */
    const candidates = (ctx.laRows || []).filter((r) => (
      !plannedEntry?.location_id || !r.location_id || r.location_id === plannedEntry.location_id
    ));
    const laRow = candidates.length
      ? selectInput({
        value: plannedEntry?.lookahead_row_id || '',
        placeholder: '— not against a look-ahead row —',
        options: candidates.map((r) => ({
          value: r.id,
          label: [r.raw_location, r.raw_label].filter(Boolean).join(' · ').slice(0, 70) || `row ${r.sheet_row}`,
        })),
      })
      : null;

    /* A photograph of what stopped it. The single most useful thing in the file
       a year later, and the moment it can be taken is now — the same upload path
       an outcome uses, so there is one bucket and one rule. */
    const photo = el('input', {
      type: 'file', accept: 'image/*', capture: 'environment', class: 'cx-input',
    });

    formModal({
      title: `${person.name} — blocked`,
      body: el('div', { class: 'cx-form' }, [
        el('p', {
          class: 'rc-hint',
          text: 'A block is project health, not a mark against anyone — which is exactly '
            + 'why it needs a reason and somebody answerable. The database refuses it without both.',
        }),
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Reason' }), reason]),
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Down to' }), party]),
        /* The two fields that decide whether anything happens about it. Asked
           here because this is the only moment somebody is definitely thinking
           about it — a blocker raised without an owner is a grievance, and the
           list of those only ever grows. */
        el('div', { class: 'cx-field' }, [
          el('label', { class: 'cx-label', text: 'Who will chase it' }), owner,
          el('div', { class: 'cx-hint', text: 'It stays on the huddle until somebody closes it.' }),
        ]),
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Expected by' }), due]),
        el('div', { class: 'cx-field' }, [
          el('label', { class: 'cx-label', text: 'Photograph' }), photo,
          el('div', { class: 'cx-hint', text: 'Optional. It is what the reason will rest on later.' }),
        ]),
        laRow
          ? el('div', { class: 'cx-field' }, [
            el('label', { class: 'cx-label', text: 'Against which look-ahead row' }),
            laRow,
            el('div', {
              class: 'cx-hint',
              text: 'Optional, and never guessed. Naming it is what turns a note in a meeting '
                + 'into evidence somebody can stand behind a year later.',
            }),
          ])
          : null,
      ].filter(Boolean)),
      confirmLabel: 'Record',
      onConfirm: async () => {
        if (!reason.value.trim()) throw new Error('A reason is needed.');
        const clientUuid = newUuid();

        // Before the row, under the uuid it is about to carry: the table has no
        // UPDATE grant, so a path attached afterwards would need a second row.
        let evidencePath = null;
        const file = photo.files?.[0] || null;
        if (file) {
          const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase();
          try {
            evidencePath = await rc.uploadEvidence(`${clientUuid}.${ext}`, file);
          } catch (err) {
            toast({ tone: 'warn', message: `The block is recorded; the photograph is not — ${err.message}` });
          }
        }

        const entry = {
          clientUuid,
          personId: person.id,
          date,
          status: 'blocked',
          ...(() => {
            const work = workOf(ctx, person, plannedEntry, current);
            return { task: work.task, categoryId: work.categoryId };
          })(),
          locationId: plannedEntry?.location_id || null,
          planEntryId: plannedEntry?.id || null,
          blockedReason: reason.value.trim(),
          blockedPartyId: party.value,
          lookaheadRowId: laRow?.value || null,
          evidencePath,
          supersedesId: current?.id || null,
        };
        const { sent, error } = await record(entry);
        if (!sent) toast({ tone: 'warn', message: `Saved locally — ${error.message}` });

        /* The outcome says a day was lost; the blocker is the thing somebody has
           to do about it. Raised separately and after, so a failure here leaves
           the outcome standing rather than losing both — the meeting has moved
           on by the time anything is retried. Not raised twice: a day that was
           already blocked already has its blocker on the list. */
        if (sent && current?.status !== 'blocked') {
          try {
            const raised = await rc.raiseBlocker({
              person_id: person.id,
              location_id: plannedEntry?.location_id || null,
              lookahead_row_id: laRow?.value || null,
              summary: reason.value.trim(),
              party_id: party.value || null,
              raised_on: date,
            });
            if (owner.value || due.value) {
              await rc.updateBlocker({
                blocker_id: raised.id,
                state: 'open',
                owner_id: owner.value || null,
                due_date: due.value || null,
              });
            }
          } catch (err) {
            toast({
              tone: 'warn',
              message: `Recorded, but it is not on the blocker list — ${err.message}`,
              timeout: 10000,
            });
          }
        }

        notifyChanged('actuals');
        redraw();
      },
    });
  }

  function setGoal(ctx, person, date, root) {
    const task = textInput({ placeholder: 'What they will do' });
    const location = selectInput({
      value: '',
      placeholder: '— location —',
      options: ctx.locations.map((l) => ({ value: l.id, label: l.name })),
    });
    const category = selectInput({
      value: '',
      placeholder: '— category —',
      options: ctx.categories.map((c) => ({ value: c.id, label: c.name })),
    });
    const shift = selectInput({ value: 'day', options: SHIFTS.map((s) => ({ value: s.id, label: s.label })) });

    formModal({
      title: `${person.name} — ${dayLabel(date, 'medium')}`,
      body: el('div', { class: 'cx-form' }, [
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Task' }), task]),
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Location' }), location]),
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Category' }), category]),
        el('div', { class: 'cx-field' }, [
          el('label', { class: 'cx-label', text: 'Shift' }), shift,
          el('div', { class: 'cx-hint', text: 'A night shift belongs to the day it starts on.' }),
        ]),
      ]),
      confirmLabel: 'Set',
      onConfirm: async () => {
        if (!task.value.trim()) throw new Error('A task is needed.');
        await rc.addPlanEntries([{
          person_id: person.id,
          work_date: date,
          shift: shift.value,
          location_id: location.value || null,
          task: task.value.trim(),
          category_id: category.value || null,
        }]);
        notifyChanged('plan');
        clear(root);
        render(root);
      },
    });
  }

  /** A v4-shaped uuid. The database column is a uuid and will not take anything else. */
  function newUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    const hex = () => Math.floor(Math.random() * 16).toString(16);
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) =>
      c === 'x' ? hex() : ((Math.floor(Math.random() * 4) + 8).toString(16)));
  }

  Object.defineProperty(__x, "pendingCount", { get: () => pendingCount, enumerable: true });
  Object.defineProperty(__x, "flushQueue", { get: () => flushQueue, enumerable: true });
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
  const { marksOf, ABSENCE_LABELS } = __req("core/lookahead.js");

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
     * Whether rows nobody highlighted are drawn. Off by default: most of the sheet
     * is activities carried for reference with nothing scheduled against them.
     */
    showQuietRows: false,
    /** Whether the names on each activity's Resource row are drawn. */
    showResources: true,
    /** How much of the calendar to show, in weeks from this one; 0 is everything. */
    calendarWeeks: 4,
  };

  const WEEK_CHOICES = [
    { weeks: 2, label: '2 weeks' },
    { weeks: 3, label: '3 weeks' },
    { weeks: 4, label: '4 weeks' },
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

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const filestore = __req("core/filestore.js");
  const { parseSheet, applyLegend, readLegend, isDark } = __req("io/lookahead.js");
  const { calendarPdf, calendarFit, PAGE_CHOICES } = __req("io/rc_pdf.js");
  const { saveFile } = __req("io/exporters.js");
  const { keyRows, classify, relinkCandidates, countable, describe, readGrid, rowsFrom, marksOf, reassignments, ABSENCE_LABELS, cancellationEvents, attachCancellationNotes } = __req("core/lookahead.js");



  const { icon } = __req("ui/icons.js");
  const { selectInput, textInput, toast, badge, emptyState, field, checkbox, confirmDialog, chipStat } = __req("ui/components.js");


  const { notifyChanged, byId, dayLabel, todayISO, formModal, parsedView, isoToMs, nameRegister, foldName } = __req("ui/rc_util.js");



  const { toISO, addDays } = __req("core/dates.js");

  const { la, table, WEEK_CHOICES } = __req("ui/rc_la_state.js");

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
   */
  async function ingest({ sheetName, legend, silent = false } = {}) {
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
      if (previous && previous.file_hash === hash) {
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

      const snapshot = await rc.addSnapshot({
        file_hash: hash,
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
        /* A column this project has and that project has not.
           `create table if not exists` does nothing to a table that already
           exists, so a database built before the Resource row went in has no
           `resources` column — and PostgREST refuses the whole insert over it.
           The rest of the row is still worth having, so it goes without that one
           field and the gap is *said*, rather than costing the read. */
        const missingColumn = /resources/.test(err.message)
          && /(column|schema cache)/i.test(err.message);
        if (missingColumn) {
          try {
            const rows = (await lookaheadRows(snapshot.id, grid))
              .map(({ resources, ...rest }) => rest);
            if (rows.length) written = await rc.addSnapshotRows(rows);
            rowTrouble = 'This database has no rc_lookahead_rows.resources column, so who the '
              + 'Resource row names was not stored. Run supabase/migrate.sql and then '
              + 'supabase/rc_schema.sql. The calendar still shows the names — it re-reads the '
              + 'snapshot — but the Resources tab and the week plan read the stored column.';
          } catch (second) {
            rowTrouble = second.message;
          }
        } else {
          rowTrouble = err.message;
        }
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

      /* And move the days the sheet has handed to somebody else.
         A stored entry pointing at a look-ahead row is somebody confirming or
         overriding what that row said; when this read names a different person on
         it, the task has moved. Done here rather than at paint time because it is
         a *write*, and because this is the one moment somebody deliberately asked
         the sheet what it says now. */
      let moved = [];
      try {
        moved = await applyReassignments(written);
      } catch (err) {
        // Same reasoning as the rows and the events: the snapshot is stored, so a
        // failure here costs a re-derivation on the next read rather than a read.
        console.warn('[cx-timeline] reassignments not applied:', err.message);
        rc.reportError('lookahead:reassign', err);
      }

      run.outcome = 'snapshot';
      run.note = [
        grid.unknown.length ? `${grid.unknown.length} colour(s) not in the legend` : null,
        events.length ? `${countable(events).length} change(s) that count` : null,
        moved.length ? `${moved.length} task(s) moved to somebody else` : null,
        rowTrouble ? `rows: ${rowTrouble}` : null,
      ].filter(Boolean).join('; ') || null;
      await rc.addIngestRun(run);

      if (!silent && moved.length) {
        toast({
          tone: 'warn',
          message: `${moved.length} planned task(s) moved to the person this read names on the row `
            + '— flagged "Reassigned" in the week plan, with who had it before.',
          timeout: 12000,
        });
      }

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

      notifyChanged('lookahead');
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
  /**
   * Move every planned day the sheet has just handed to somebody else.
   *
   * `reassignments()` decides *which*, and refuses to decide unless it is certain
   * — the row has to name exactly one person the roster knows on that day, and
   * somebody other than whoever has it. This does the writing:
   * `rc_reassign_plan()` supersedes the entry with one against the new person and
   * records where it came from, so the outgoing row stays and the week plan can
   * badge the new one "Reassigned from Dana".
   *
   * Each move is attempted on its own and a refusal is logged rather than thrown.
   * The function refuses an entry somebody has already revised, and one refusal
   * must not stop the other nine: they are independent facts about independent
   * days, and the next read will offer the failed one again.
   *
   * Returns what actually moved, which is what the toast and the ingest note say.
   */
  async function applyReassignments(rows) {
    if (!rows || !rows.length) return [];

    const weeks = [...new Set(rows.map((r) => r.week_start).filter(Boolean))].sort();
    if (!weeks.length) return [];
    const from = weeks[0];
    const to = toISO(addDays(isoToMs(weeks[weeks.length - 1]), 6));

    const [planRows, people, aliases] = await Promise.all([
      rc.listPlan(from, to),
      rc.listPeople(),
      rc.listPersonAliases().catch(() => []),
    ]);

    const register = nameRegister(people, aliases);
    const moves = reassignments({
      planRows,
      laRows: rows,
      // The register, as the lookup the derivation takes. Exact, like everywhere
      // else: a near miss is reported on the week plan and answered with an
      // alias, never used to move somebody's shift.
      resolve: (name) => register.get(foldName(name)) || null,
    });
    if (!moves.length) return [];

    const done = [];
    for (const move of moves) {
      try {
        await rc.reassignPlan(move.entry.id, move.to);
        done.push(move);
      } catch (err) {
        /* Already revised, already withdrawn, or already theirs. None of them is
           a fault and none of them should stop the rest — the next read offers
           this one again. */
        console.warn('[cx-timeline] a task could not be moved:', err.message);
      }
    }
    if (done.length) notifyChanged('plan');
    return done;
  }

  async function recordChanges(previous, snapshot, rows, legend) {
    if (!previous || !rows.length) return [];

    const priorRows = await rc.listSnapshotRows(previous.id).catch(() => []);
    if (!priorRows.length) return [];

    // `classify()` keys on the row key and reads `cells` and `marks`; the
    // database columns are named for what they are on disk.
    const shape = (r) => ({
      rowKey: r.row_key,
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
    await rc.addChangeEvents(events.map((e) => ({
      from_snapshot: previous.id,
      to_snapshot: snapshot.id,
      kind: e.kind,
      week_start: e.weekStart || null,
      row_key: e.rowKey || null,
      location_id: byKey.get(e.rowKey)?.location_id || null,
      before: sideOf(e, 'before'),
      after: sideOf(e, 'after'),
    })));

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
  Object.defineProperty(__x, "checkNowButton", { get: () => checkNowButton, enumerable: true });
};

// ui/rc_la_legend.js
__mods["ui/rc_la_legend.js"] = function (__x, __req) {
  /**
   * Look-ahead → Legend: the register of what each colour means and does.
   *
   * Imports: util, rc, io/lookahead, core/lookahead, icons, components, rc_util,
   *          rc_la_state, rc_ingest.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const filestore = __req("core/filestore.js");
  const { parseSheet, applyLegend, readLegend, isDark } = __req("io/lookahead.js");
  const { calendarPdf, calendarFit, PAGE_CHOICES } = __req("io/rc_pdf.js");
  const { saveFile } = __req("io/exporters.js");
  const { keyRows, classify, relinkCandidates, countable, describe, readGrid, rowsFrom, marksOf, reassignments, ABSENCE_LABELS, cancellationEvents, attachCancellationNotes } = __req("core/lookahead.js");



  const { icon } = __req("ui/icons.js");
  const { selectInput, textInput, toast, badge, emptyState, field, checkbox, confirmDialog, chipStat } = __req("ui/components.js");


  const { notifyChanged, byId, dayLabel, todayISO, formModal, parsedView, isoToMs, nameRegister, foldName } = __req("ui/rc_util.js");



  const { toISO, addDays } = __req("core/dates.js");

  const { la, table, WEEK_CHOICES } = __req("ui/rc_la_state.js");
  const { checkNowButton } = __req("ui/rc_ingest.js");

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


  Object.defineProperty(__x, "renderLegend", { get: () => renderLegend, enumerable: true });
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
  const filestore = __req("core/filestore.js");
  const { parseSheet, applyLegend, readLegend, isDark } = __req("io/lookahead.js");
  const { calendarPdf, calendarFit, PAGE_CHOICES } = __req("io/rc_pdf.js");
  const { saveFile } = __req("io/exporters.js");
  const { keyRows, classify, relinkCandidates, countable, describe, readGrid, rowsFrom, marksOf, reassignments, ABSENCE_LABELS, cancellationEvents, attachCancellationNotes } = __req("core/lookahead.js");



  const { icon } = __req("ui/icons.js");
  const { selectInput, textInput, toast, badge, emptyState, field, checkbox, confirmDialog, chipStat } = __req("ui/components.js");


  const { notifyChanged, byId, dayLabel, todayISO, formModal, parsedView, isoToMs, nameRegister, foldName } = __req("ui/rc_util.js");



  const { toISO, addDays } = __req("core/dates.js");

  const { la, table, WEEK_CHOICES } = __req("ui/rc_la_state.js");
  const { checkNowButton } = __req("ui/rc_ingest.js");

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

  async function renderChanges(host) {
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

    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'What the look-ahead did' }),
      checkNowButton(),
    ]));

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
      el('span', { text: `${events.length - counted.length} window movement(s) that do not.` }),
    ]));

    const rows = events.map((e) => el('tr', {}, [
      el('td', { text: e.week_start || '—' }),
      el('td', {}, [badge(kindLabel(e.kind), kindTone(e.kind))]),
      el('td', { text: describe({ ...e, weekStart: e.week_start, rowKey: e.row_key }) }),
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

    host.appendChild(table(['Week', 'Kind', 'What', 'Seen', 'Down to'], rows));

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
        el('td', { class: 'rc-num', text: String(s.row_count ?? 0) }),
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

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const filestore = __req("core/filestore.js");
  const { parseSheet, applyLegend, readLegend, isDark } = __req("io/lookahead.js");
  const { calendarPdf, calendarFit, PAGE_CHOICES } = __req("io/rc_pdf.js");
  const { saveFile } = __req("io/exporters.js");
  const { keyRows, classify, relinkCandidates, countable, describe, readGrid, rowsFrom, marksOf, reassignments, ABSENCE_LABELS, cancellationEvents, attachCancellationNotes } = __req("core/lookahead.js");



  const { icon } = __req("ui/icons.js");
  const { selectInput, textInput, toast, badge, emptyState, field, checkbox, confirmDialog, chipStat } = __req("ui/components.js");


  const { notifyChanged, byId, dayLabel, todayISO, formModal, parsedView, isoToMs, nameRegister, foldName } = __req("ui/rc_util.js");



  const { toISO, addDays } = __req("core/dates.js");

  const { la, table, WEEK_CHOICES } = __req("ui/rc_la_state.js");
  const { checkNowButton } = __req("ui/rc_ingest.js");

  /* ══════════════════════════════════════════════════════════════════════════
     Cancellations
     ═══════════════════════════════════════════════════════════════════════ */

  /** Whose cancellation it can be. The contract's three answers, as the schema checks them. */
  const CANCEL_PARTIES = ['BART', 'Hitachi', 'Other'];
  const PARTY_TONE = { BART: 'warn', Hitachi: 'bad', Other: 'neutral' };

  /** The span the log covers, when somebody has changed it on screen. A blank end is no end. */
  let cancellationsFrom = null;
  let cancellationsTo = '';
  let cancellationsUnansweredOnly = false;

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

    const [days, notes] = await Promise.all([
      rc.listCancelledDays(from).catch((err) => { toast({ tone: 'bad', title: 'Could not read the cancellations', message: err.message }); return []; }),
      rc.listCancellationNotes().catch(() => []),
    ]);
    const to = cancellationsTo && cancellationsTo >= from ? cancellationsTo : '';
    /* An event is in the span when it starts inside it. One that runs past the
       end is kept whole rather than cut at the boundary: a cancelled week is one
       event, and half of it in a report is a different claim. */
    const events = attachCancellationNotes(cancellationEvents(days, { from }), notes)
      .filter((e) => !to || e.start <= to);

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
      text: `Every run of red cells any read of the look-ahead has shown ${span}. Cells side by `
        + 'side on one activity are one event, and red on a Resource row is never a cancellation. '
        + 'A cancellation stays in the log after the sheet moves on — it was red when those reads '
        + 'were taken.',
    }));

    if (!events.length) {
      host.appendChild(emptyState({
        iconName: 'calendar',
        title: 'No cancellations',
        message: `No read of the look-ahead ${span} has a cell painted in the colour the Legend calls a cancellation.`,
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
    host.appendChild(el('div', { class: 'cx-chipstats', style: 'margin:0 0 12px' }, [
      chipStat('Events', events.length, 'info'),
      chipStat('Days', dayCount, 'muted'),
      ...CANCEL_PARTIES.map((p) => chipStat(p, tally[p], tally[p] ? PARTY_TONE[p] : 'muted')),
      chipStat('No reason yet', open, open ? 'bad' : 'muted'),
    ]));

    host.appendChild(checkbox({
      label: 'Only the ones with no reason yet',
      checked: cancellationsUnansweredOnly,
      onChange: (on) => { cancellationsUnansweredOnly = on; notifyChanged('cancellations'); },
    }));

    const shown = cancellationsUnansweredOnly ? events.filter((e) => !e.note) : events;

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
    const rows = shown.map((e) => el('tr', { class: 'rc-cancel-row', dataset: { start: e.start, label: e.label } }, [
      el('td', {}, [
        el('div', { class: 'rc-cancel-cells', 'aria-hidden': 'true' },
          [...Array(Math.min(e.days, 14))].map(() => el('span', { class: 'rc-cancel-cell' }))),
      ]),
      el('td', {}, [
        el('div', { text: e.label || '—' }),
        e.location ? el('div', { class: 'rc-hint', text: e.location }) : null,
      ].filter(Boolean)),
      el('td', { text: e.start === e.end ? dayLabel(e.start) : `${dayLabel(e.start)} – ${dayLabel(e.end)}` }),
      el('td', { text: `${e.days} day${e.days === 1 ? '' : 's'}` }),
      el('td', {
        class: 'rc-hint',
        title: 'How many reads of the sheet showed any of these days red, and when it was first seen',
        text: `${e.reads} read${e.reads === 1 ? '' : 's'}${e.firstSeen ? ` · first ${dayLabel(String(e.firstSeen).slice(0, 10))}` : ''}`,
      }),
      el('td', {}, [e.note ? badge(e.note.party, PARTY_TONE[e.note.party] || 'neutral') : el('span', { class: 'rc-hint', text: '—' })]),
      el('td', {}, [
        e.note?.reason ? el('div', { text: e.note.reason }) : null,
        e.history.length > 1
          ? el('div', { class: 'rc-hint', text: `Corrected ${e.history.length - 1} time(s)`, title: e.history.map((n) => `${n.party}: ${n.reason || ''}`).join('\n') })
          : null,
      ].filter(Boolean)),
      el('td', {}, [
        el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
          el('button', {
            class: 'cx-btn mini' + (e.note ? ' ghost' : ' primary'),
            text: e.note ? 'Correct' : 'Add reason',
            title: e.note ? 'A correction is a new entry that supersedes this one. Nothing is edited away.' : '',
            onClick: () => recordCancellation(e),
          }),
          el('button', {
            class: 'cx-btn mini ghost',
            text: 'Show cells',
            title: 'Open the calendar on this activity, over the whole sheet',
            onClick: () => {
              la.calendarFilter = e.label;
              la.calendarWeeks = 0;
              la.showQuietRows = true;
              la.section = 'calendar';
              notifyChanged('cancellations');
            },
          }),
        ]),
      ]),
    ]));

    host.appendChild(table(['', 'Activity', 'Cancelled', 'Length', 'Seen', 'Responsible', 'Reason', ''], rows));
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
        if (!snapshot?.grid) continue;
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
  function recordCancellation(event) {
    const current = event.note;
    const party = selectInput({
      value: current?.party || CANCEL_PARTIES[0],
      options: CANCEL_PARTIES,
    });
    const reason = el('textarea', { class: 'cx-input', rows: 3, placeholder: 'Why it was cancelled' });
    reason.value = current?.reason || '';

    formModal({
      title: current ? 'Correct the cancellation' : 'Why was this cancelled?',
      body: el('div', { class: 'cx-form' }, [
        el('p', {
          class: 'rc-hint',
          text: `${event.label}${event.location ? ` at ${event.location}` : ''}, `
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
          start_date: event.start,
          end_date: event.end,
          party: party.value,
          reason: said || null,
          supersedes_id: current?.id || null,
        });
        notifyChanged('cancellations');
      },
    });
  }

  function cancellationCsv(events) {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['activity', 'location', 'start', 'end', 'days', 'reads', 'first_seen', 'last_seen', 'responsible', 'reason', 'recorded_at'].join(',')];
    for (const e of events) {
      lines.push([
        e.label, e.location, e.start, e.end, e.days, e.reads,
        e.firstSeen || '', e.lastSeen || '', e.note?.party || '', e.note?.reason || '', e.note?.created_at || '',
      ].map(q).join(','));
    }
    return lines.join('\n') + '\n';
  }


  Object.defineProperty(__x, "renderCancellations", { get: () => renderCancellations, enumerable: true });
};

// ui/rc_la_sars.js
__mods["ui/rc_la_sars.js"] = function (__x, __req) {
  /**
   * Look-ahead → Site access: SARs, filed and linked to the rows they cover.
   *
   * Imports: util, rc, filestore, components, rc_util, rc_la_state.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const filestore = __req("core/filestore.js");
  const { parseSheet, applyLegend, readLegend, isDark } = __req("io/lookahead.js");
  const { calendarPdf, calendarFit, PAGE_CHOICES } = __req("io/rc_pdf.js");
  const { saveFile } = __req("io/exporters.js");
  const { keyRows, classify, relinkCandidates, countable, describe, readGrid, rowsFrom, marksOf, reassignments, ABSENCE_LABELS, cancellationEvents, attachCancellationNotes } = __req("core/lookahead.js");



  const { icon } = __req("ui/icons.js");
  const { selectInput, textInput, toast, badge, emptyState, field, checkbox, confirmDialog, chipStat } = __req("ui/components.js");


  const { notifyChanged, byId, dayLabel, todayISO, formModal, parsedView, isoToMs, nameRegister, foldName } = __req("ui/rc_util.js");



  const { toISO, addDays } = __req("core/dates.js");

  const { la, table, WEEK_CHOICES } = __req("ui/rc_la_state.js");

  const SAR_INBOX = 'sars/inbox';
  /** Where a recorded SAR is filed, under the week it authorised. */
  const SAR_ARCHIVE = 'sars';

  /* ══════════════════════════════════════════════════════════════════════════
     Site access
     ═══════════════════════════════════════════════════════════════════════ */

  async function renderSars(host) {
    const [sars, locations, without, unlinked, waiting] = await Promise.all([
      rc.listSars(),
      rc.listLocations(),
      rc.listRowsWithoutSar(),
      rc.listSarsWithoutRows(),
      // What is sitting in the inbox, unrecorded. The folder is the front door
      // for these — somebody saves the PDF from an email and that is the whole
      // filing step they should have to do.
      filestore.hasFolder()
        ? filestore.intakeList(SAR_INBOX).catch(() => [])
        : Promise.resolve([]),
    ]);
    const locs = byId(locations);

    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'Site access requests' }),
      el('button', {
        class: 'cx-btn mini primary',
        html: icon('plus', { size: 12 }) + '<span>Record a SAR</span>',
        onClick: () => recordSar(locations, null, host),
      }),
    ]));

    /* The inbox. Left first because it is the only thing here that is a task. */
    const pdfs = waiting.filter((f) => /\.pdf$/i.test(f.name));
    if (pdfs.length) {
      host.appendChild(table(
        [`${pdfs.length} PDF(s) waiting in ${SAR_INBOX}/`, 'Dropped', ''],
        pdfs.map((f) => el('tr', {}, [
          el('td', { text: f.name }),
          el('td', { class: 'rc-hint', text: new Date(f.modified).toISOString().slice(0, 10) }),
          el('td', {}, [
            el('button', {
              class: 'cx-btn mini primary',
              text: 'Record it',
              onClick: () => recordSar(locations, f, host),
            }),
          ]),
        ]))
      ));
      host.appendChild(el('div', { style: 'height:20px' }));
    } else if (filestore.hasFolder()) {
      host.appendChild(el('p', { class: 'rc-hint', text: `Nothing waiting in ${SAR_INBOX}/.` }));
    }

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
      const links = await rc.listSarLinks().catch(() => []);
      const covers = new Map();
      for (const k of links) covers.set(k.sar_id, (covers.get(k.sar_id) || 0) + 1);

      host.appendChild(table(
        ['SAR', 'Rev', 'Location', 'Week', 'Hours', 'Covers', ''],
        sars.map((s) => el('tr', {}, [
          el('td', { text: s.sar_number }),
          el('td', { class: 'rc-num', text: String(s.revision) }),
          el('td', { text: locs.get(s.location_id)?.name || s.raw_location || '—' }),
          el('td', { text: s.week_start || '—' }),
          el('td', { class: 'rc-num', text: s.authorized_hours ?? '—' }),
          el('td', { class: 'rc-num', text: covers.get(s.id) ? `${covers.get(s.id)} row(s)` : '—' }),
          el('td', {}, [
            el('button', {
              class: 'cx-btn mini ghost',
              text: 'What it covers',
              title: 'Confirm which look-ahead rows this access is for. Offered by date and '
                + 'location; never matched on the activity text.',
              onClick: () => linkSar(s, host),
            }),
            s.storage_path ? el('button', {
              class: 'cx-btn mini ghost',
              text: 'Open',
              onClick: async () => {
                try {
                  window.open(await rc.sarUrl(s.storage_path), '_blank', 'noopener');
                } catch (err) {
                  toast({ tone: 'bad', message: err.message });
                }
              },
            }) : null,
          ].filter(Boolean)),
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

  /**
   * Record a SAR, and file the PDF that came with it.
   *
   * Three things happen and all three can fail independently, so they are done
   * in the order that leaves the least mess: the row first, then the upload,
   * then the move out of the inbox. A PDF that uploaded but could not be moved
   * is a duplicate somebody sees; a PDF moved before the row existed would be a
   * file nobody can find.
   *
   * The number and week are read off the filename where it says them, because
   * "SAR-12345 W36.pdf" is what these are actually called — but only as a
   * *suggestion* in a field somebody confirms. Nothing here is matched on
   * activity text, which is the rule everywhere in this module.
   */
  function recordSar(locations, file, root) {
    const guess = /(?:SAR[-_ ]?)?(\d{4,})/i.exec(file?.name || '')?.[1] || '';
    const number = textInput({ placeholder: 'SAR-12345', value: guess ? `SAR-${guess}` : '' });
    const location = selectInput({
      value: locations[0]?.id,
      options: locations.map((l) => ({ value: l.id, label: l.name })),
    });
    const week = el('input', { type: 'date', class: 'cx-input' });
    const hours = el('input', { type: 'number', class: 'cx-input', step: '0.5', min: '0' });

    formModal({
      title: file ? `Record ${file.name}` : 'Record a SAR',
      body: el('div', { class: 'cx-form' }, [
        file ? el('p', {
          class: 'rc-hint',
          text: 'The PDF goes up so it opens in a browser — it has to be readable by whoever is '
            + 'asked about it later — and the file is then moved out of the inbox into its week. '
            + 'The look-ahead workbook is deliberately not uploaded; this is.',
        }) : null,
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Number' }), number]),
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Location' }), location]),
        el('div', { class: 'cx-field' }, [
          el('label', { class: 'cx-label', text: 'Week beginning' }), week,
          el('div', { class: 'cx-hint', text: 'The Monday, matching how the look-ahead is keyed.' }),
        ]),
        el('div', { class: 'cx-field' }, [el('label', { class: 'cx-label', text: 'Authorised hours' }), hours]),
      ].filter(Boolean)),
      confirmLabel: 'Record',
      onConfirm: async () => {
        if (!number.value.trim()) throw new Error('A SAR number is needed.');
        if (file && !week.value) throw new Error('A week is needed to file it under.');

        const row = await rc.addSar({
          sar_number: number.value.trim(),
          location_id: location.value || null,
          week_start: week.value || null,
          authorized_hours: hours.value ? Number(hours.value) : null,
        });

        if (file) {
          const rel = `${SAR_INBOX}/${file.name}`;
          const filed = `${SAR_ARCHIVE}/${week.value}/${file.name}`;
          try {
            const bytes = await filestore.intakeRead(rel);
            await rc.uploadSar(`${week.value}/${row.id}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
            await rc.updateSar(row.id, { storage_path: `${week.value}/${row.id}.pdf` });
            await filestore.intakeMove(rel, filed);
          } catch (err) {
            // The record exists either way, which is the part that matters. Say
            // what did not happen rather than rolling back a row somebody has
            // already been told about.
            toast({
              tone: 'warn',
              message: `${number.value.trim()} recorded, but the PDF was not filed — ${err.message}`,
              timeout: 10000,
            });
          }
        }

        notifyChanged('sars');
        if (root) {
          // Straight on to the question the SAR exists to answer.
          linkSar(row, root);
        }
      },
    });
  }

  /**
   * Which look-ahead rows this access covers.
   *
   * Offered by **date and location only**. The activity text is worded
   * differently on the two sides and is not reliable enough to carry evidence —
   * that rule is why the alias register exists — so the candidates are every row
   * at that location in that week and a person confirms. One SAR covering
   * several rows is expected rather than an ambiguity, so this is checkboxes and
   * not a radio.
   */
  async function linkSar(sar, root) {
    const [rows, links] = await Promise.all([
      sar.week_start ? rc.lookaheadForWeek(sar.week_start).catch(() => []) : Promise.resolve([]),
      rc.listSarLinks().catch(() => []),
    ]);
    const already = new Set(links.filter((k) => k.sar_id === sar.id).map((k) => k.lookahead_row_id));
    const candidates = rows.filter((r) => !sar.location_id || !r.location_id || r.location_id === sar.location_id);

    if (!candidates.length) {
      toast({
        message: sar.week_start
          ? 'No look-ahead rows read for that week and location yet — read the look-ahead first.'
          : 'This SAR has no week against it, so there is nothing to match it to.',
        timeout: 8000,
      });
      return;
    }

    const boxes = candidates.map((r) => {
      const box = checkbox({
        label: [r.raw_location, r.raw_label].filter(Boolean).join(' · ').slice(0, 78),
        checked: already.has(r.id),
      });
      box.querySelector('input').dataset.row = r.id;
      return box;
    });
    const wrap = el('div', { style: 'display:grid;gap:6px;max-height:40vh;overflow:auto' }, boxes);

    formModal({
      title: `${sar.sar_number} — what it covers`,
      body: el('div', { class: 'cx-form' }, [
        el('p', {
          class: 'rc-hint',
          text: 'Every row at this location in this week. Matched on date and location, never on '
            + 'the activity text — the two sides word it differently, and a wrong match here would '
            + 'be a claim that access was granted for work it was not.',
        }),
        wrap,
      ]),
      confirmLabel: 'Confirm',
      onConfirm: async () => {
        const picked = [...wrap.querySelectorAll('input:checked')].map((b) => b.dataset.row);
        const added = picked.filter((id) => !already.has(id));
        if (added.length) {
          await rc.addSarLinks(added.map((id) => ({ sar_id: sar.id, lookahead_row_id: id })));
        }
        notifyChanged('sars');
        toast({
          tone: 'good',
          message: `${sar.sar_number} covers ${picked.length} look-ahead row(s).`,
        });
      },
    });
  }


  Object.defineProperty(__x, "renderSars", { get: () => renderSars, enumerable: true });
};

// ui/rc_lookahead.js
__mods["ui/rc_lookahead.js"] = function (__x, __req) {
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

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const filestore = __req("core/filestore.js");
  const { parseSheet, applyLegend, readLegend, isDark } = __req("io/lookahead.js");
  const { calendarPdf, calendarFit, PAGE_CHOICES } = __req("io/rc_pdf.js");
  const { saveFile } = __req("io/exporters.js");
  const { keyRows, classify, relinkCandidates, countable, describe, readGrid, rowsFrom, marksOf, reassignments, ABSENCE_LABELS, cancellationEvents, attachCancellationNotes } = __req("core/lookahead.js");



  const { icon } = __req("ui/icons.js");
  const { selectInput, textInput, toast, badge, emptyState, field, checkbox, confirmDialog, chipStat } = __req("ui/components.js");


  const { notifyChanged, byId, dayLabel, todayISO, formModal, parsedView, isoToMs, nameRegister, foldName } = __req("ui/rc_util.js");



  const { toISO, addDays } = __req("core/dates.js");

  const { la, table, WEEK_CHOICES } = __req("ui/rc_la_state.js");
  const { checkNowButton } = __req("ui/rc_ingest.js");
  const { renderLegend } = __req("ui/rc_la_legend.js");
  const { renderChanges, renderSnapshots } = __req("ui/rc_la_changes.js");
  const { renderCancellations } = __req("ui/rc_la_cancellations.js");
  const { renderSars } = __req("ui/rc_la_sars.js");

  const SECTIONS = ['calendar', 'cancellations', 'changes', 'snapshots', 'legend', 'sars'];

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
    const sections = admin ? SECTIONS : ['calendar'];
    if (!sections.includes(la.section)) la.section = sections[0];

    const nav = el('div', { class: 'rc-tabs', style: 'margin:0 0 16px' });
    for (const id of sections) {
      nav.appendChild(el('button', {
        class: 'rc-tab',
        type: 'button',
        text: {
          calendar: 'Calendar', cancellations: 'Cancellations', changes: 'Changes', snapshots: 'Snapshots',
          legend: 'Legend', sars: 'Site access',
        }[id],
        'aria-pressed': String(id === la.section),
        onClick: () => { la.section = id; clear(root); render(root); },
      }));
    }
    if (sections.length > 1) root.appendChild(nav);

    const host = el('div');
    root.appendChild(host);

    if (la.section === 'calendar') await renderCalendar(host);
    else if (la.section === 'cancellations') await renderCancellations(host);
    else if (la.section === 'changes') await renderChanges(host);
    else if (la.section === 'snapshots') await renderSnapshots(host);
    else if (la.section === 'legend') await renderLegend(host);
    else await renderSars(host);
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
    const [snapshot, legendRows] = await Promise.all([
      rc.latestSnapshot(),
      rc.listLegend(),
    ]);

    /* Reading the workbook is an administrator's job — it needs the folder, and
       ingestion writes the register. Everybody else is looking at the snapshot,
       which is the whole reason it is a snapshot. */
    const admin = rc.isAdmin();
    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'The look-ahead' }),
      admin ? checkNowButton() : null,
    ].filter(Boolean)));

    if (!snapshot?.grid?.rows?.length) {
      host.appendChild(emptyState({
        iconName: 'calendar',
        title: 'Nothing read yet',
        message: admin
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
    const grid = { unknown: view.unknown };

    if (!view.days.length) {
      host.appendChild(emptyState({
        iconName: 'warning',
        title: 'No date axis found on that sheet',
        message: 'The calendar is located by finding the row of weekday letters — M, Tu, W and '
          + 'the rest — and this sheet has none that are visible. Check the sheet name in Legend, '
          + 'and that the week columns are not hidden.',
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

    const body = el('div');
    const draw = () => {
      clear(body);
      const shown = drawn(windowed(view, today), la.calendarFilter, la.showQuietRows);
      clear(strip);
      strip.appendChild(legendStrip(legend, grid.unknown, paintOn(shown)));
      body.appendChild(grid_(shown, today));
    };
    // Redraw the rows only, never the input: rebuilding the field under the
    // caret is the trap this project has already been bitten by three times.
    search.addEventListener('input', () => { la.calendarFilter = search.value; draw(); });

    host.appendChild(strip);
    host.appendChild(el('div', {
      style: 'display:flex;align-items:center;gap:16px;margin-bottom:10px;flex-wrap:wrap',
    }, [
      el('div', { style: 'flex:1;min-width:240px;max-width:340px' }, [search]),
      dated ? range : null,
      quiet,
      resources,
      /* The whole view, not the windowed one: the dialog picks its own weeks, and
         handing it what is on screen would quietly cap the export at whatever the
         range buttons were last set to. */
      exportButton({ view, legendRows, today, sheetName: snapshot.sheet_name }),
    ].filter(Boolean)));
    host.appendChild(body);
    draw();

    const inWindow = windowed(view, today);
    const scheduled = inWindow.activities.filter((a) => a.highlighted && a.named).length;
    const headings = view.activities.filter((a) => a.heading).length;
    const named = view.activities.filter((a) => a.resource).length;
    const away = view.activities.filter((a) => a.absence).length;
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: `${scheduled} of ${view.activities.length} activities have something scheduled in the `
        + `weeks on screen. The workbook holds `
        + `${view.days.length} days, from the snapshot taken `
        + `${snapshot.taken_at ? snapshot.taken_at.slice(0, 16).replace('T', ' ') : 'earlier'}`
        + `${headings ? `, under ${headings} section heading(s)` : ''}. `
        + 'The rest are either carried for reference with no shift against them, or were worked in '
        + 'weeks that have already gone; both are hidden unless you ask for them. Only the rows and '
        + 'columns that were visible in the workbook are here at all — a hidden row is not work '
        + 'anybody was being asked to look at.',
    }));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: dated
        ? `The sheet carries months and day numbers but no year, so the axis is dated from the `
          + `snapshot's own timestamp and then checked against the workbook's weekday letters — `
          + `only one candidate year makes M, Tu and W land where the file says they do. It reads `
          + `as ${view.days[0].date} to ${view.days[view.days.length - 1].date}. `
          + `Today is ${today}.`
        : 'No year could be resolved from this sheet — the weekday letters did not agree with any '
          + 'candidate, so no today line is drawn and the week filters stand down. A today line on '
          + 'the wrong column would be worse than none.',
    }));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'A row counts as scheduled when one of the days on screen carries paint the legend does '
        + 'not call shading — so narrowing to four weeks drops the rows whose work was in the '
        + 'weeks before it. A colour nobody has mapped counts too: until somebody says what it is, '
        + 'it might be work, and hiding it would bury exactly the rows that need looking at. '
        + 'Weekends are counted like any other day: possession work lands on them. A section '
        + 'heading is only drawn when something under it is: a title over nothing is not an answer, '
        + 'and headings used to be exempt from the switch entirely — which is how a whole workbook '
        + 'came back on screen the moment one stray colour went unmapped.',
    }));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: named
        ? `${named} activity(ies) carry a Resource row — the line the workbook writes underneath `
          + 'with the names typed against each day. It is drawn as part of the activity above it, '
          + 'taking that line\'s location and work hours, because that is what leaving them blank '
          + 'means. "Show resource names" hides the names and never the activities.'
        : 'No Resource rows on this sheet yet. Add a row under an activity whose description reads '
          + '"Resource", leave its location and work hours blank so they carry down from the '
          + 'activity, and type the names into the day cells.',
    }));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: away
        ? `${away} row(s) say who is away rather than what is happening — "PTO" and "Other Group / `
          + 'Project", with the names typed into the day cells. They stand on their own rather than '
          + 'under an activity, because what they say is about the person; they are never counted as '
          + 'scope, and they hide with "Show resource names" like every other row of names. Those '
          + 'days reach the week plan, Resources and PTO against the people they name.'
        : 'Nothing on this sheet says who is away. Add a row at the bottom whose description reads '
          + '"PTO", or "Other Group / Project", and type the names into the day cells — those days '
          + 'then show against those people in the week plan, Resources and PTO instead of reading '
          + 'as a day nobody planned.',
    }));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'The key above the grid lists only the colours actually on screen. A legend of thirty '
        + 'entries for a window carrying four of them is a key to somebody else\'s calendar; the '
        + 'full register is in Legend.',
    }));
  }

  /**
   * Narrow the axis to the weeks worth looking at.
   *
   * The past is dropped rather than scrolled past: this sheet carries a quarter
   * of finished weeks to the left of today, and a look-ahead that opens on
   * March is not a look-ahead. "Everything" is one click away for the times the
   * question really is what happened.
   *
   * If the dates could not be resolved — the weekday letters did not agree —
   * nothing is narrowed, because narrowing on a reading that might be a year out
   * would hide real work. Same if the window turns out to be empty: a calendar
   * showing nothing is not an answer.
   */
  function windowed(view, today, weeks = la.calendarWeeks) {
    const narrowed = (() => {
      if (!weeks || !view.days.some((d) => d.date)) return view.days;
      const ms = new Date(`${today}T00:00:00Z`).getTime();
      const monday = ms - ((new Date(ms).getUTCDay() + 6) % 7) * 86400000;
      const from = new Date(monday).toISOString().slice(0, 10);
      const to = new Date(monday + (weeks * 7 - 1) * 86400000).toISOString().slice(0, 10);
      const days = view.days.filter((d) => !d.date || (d.date >= from && d.date <= to));
      // A window with nothing in it is not an answer; fall back to the sheet.
      return days.length ? days : view.days;
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
  function drawn(view, filter, showQuiet, withResources = la.showResources) {
    const terms = String(filter || '').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
    let rows = view.activities;

    if (!showQuiet) {
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
           this box, and it would find nothing if only the activity line counted. */
        const hay = [...a.meta, ...(a.resource?.marks || []).map((m) => m.value),
          ...(a.absence ? a.marks.map((m) => m.value) : [])]
          .join(' ').toLowerCase();
        return terms.some((t) => hay.includes(t));
      });
    }

    return { ...view, activities: rows };
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

  /** The grid itself. Split out so the filter can redraw it without the header. */
  function grid_(view, today) {
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
    const line = (meta, marks, { klass = '', what = '', resource = false }) => el('tr', {
      class: klass,
    }, [
      ...meta.map((value, i) => el('td', {
        class: 'la-meta' + (i === meta.length - 1 ? ' la-last' : ''),
        text: value,
        title: value,
      })),
      ...view.days.map((d) => {
        const mark = marks.get(d.col);
        const classes = ['la-day'];
        if (resource) classes.push('la-resource');
        if (d.weekend) classes.push('la-weekend');
        if (d.date && d.date === today) classes.push('la-today');
        if (mark?.hex) {
          classes.push('la-painted');
          if (isDark(mark.hex)) classes.push('la-dark');
          if (!mark.meaning) classes.push('la-unmapped');
        }
        return el('td', {
          class: classes.join(' '),
          style: mark?.hex ? `background:#${mark.hex}` : '',
          text: mark?.value || '',
          title: [what, d.date || `${d.month} ${d.day} ${d.weekday}`.trim(),
            mark?.meaning || (mark?.hex ? `unmapped colour #${mark.hex}` : null), mark?.value]
            .filter(Boolean).join(' · '),
        });
      }),
    ]);

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

    /* The frozen columns have to be told where they start, and only the browser
       knows how wide the content made them. Measured once the table is in the
       document, on the next frame. */
    requestAnimationFrame(() => {
      freezeHead(head);
      const firstRow = table_.querySelector('tbody tr');
      if (!firstRow) return;
      let left = 0;
      const widths = [...firstRow.querySelectorAll('.la-meta')].map((td) => td.getBoundingClientRect().width);
      widths.forEach((width, i) => {
        /* Every cell in that column, heading included — the heading row now has
           one cell per column rather than one spanning the lot, so it has to be
           frozen at the same offsets or the names slide out from over their
           values. The two rows that still span everything are pinned at zero,
           which is where a cell covering all of them starts. */
        for (const cell of table_.querySelectorAll(`.la-meta:nth-child(${i + 1})`)) {
          if (!cell.classList.contains('la-meta-all')) cell.style.left = `${left}px`;
        }
        left += width;
      });
      for (const th of table_.querySelectorAll('thead .la-meta-all')) th.style.left = '0px';
      // The month label pins just past the frozen columns; only the browser
      // knows how wide the content made them.
      table_.style.setProperty('--la-meta-w', `${left}px`);
    });

    /* A header row can change height after the first frame — a font arriving, a
       heading wrapping — and a stale offset lets one row slide under another. */
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => freezeHead(head)).observe(head);

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
  function exportDialog({ view, legendRows, today, sheetName }) {
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
    const title = textInput({ value: `${sheetName || '4WLA'} — look-ahead` });

    const withResources = checkbox({ label: 'Resource names, and who is away', checked: la.showResources });
    const withQuiet = checkbox({ label: 'Rows with nothing scheduled', checked: la.showQuietRows });
    const withLegend = checkbox({ label: 'The key for the colours on it', checked: true });
    const withFilter = checkbox({
      label: la.calendarFilter ? `Only rows matching "${la.calendarFilter}"` : 'Apply the filter on screen',
      checked: Boolean(la.calendarFilter),
    });

    const on = (box) => box.querySelector('input').checked;
    const readout = el('p', { class: 'rc-hint' });

    /* What is actually going to be drawn, from the same two functions the screen
       draws through — so the export cannot show a different set of rows from the
       grid it was started from. */
    const chosen = () => {
      const narrowed = windowed(view, today, Number(weeks.value) || 0);
      const rows = drawn(narrowed, on(withFilter) ? la.calendarFilter : '', on(withQuiet), on(withResources));
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
            Number(weeks.value) ? `${weeks.value} weeks from ${dayLabel(today, 'medium')}` : 'whole sheet',
          ].join('  ·  '),
        },
      };
    };

    const refresh = () => {
      const { view: shown, opts } = chosen();
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
    for (const box of [withResources, withQuiet, withLegend, withFilter]) {
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
        const { view: shown, opts } = chosen();
        if (!shown.activities.length) throw new Error('There is nothing to draw with those choices.');
        const blob = calendarPdf(shown, opts);
        saveFile(`lookahead-${today}.pdf`, blob, 'application/pdf', 'Look-ahead');
      },
    });
  }

  function exportButton(context) {
    return el('button', {
      class: 'cx-btn mini ghost',
      html: icon('download', { size: 12 }) + '<span>Export PDF</span>',
      title: 'Draw this calendar on one page — weeks, names and paper size are all choices.',
      onClick: () => exportDialog(context),
    });
  }


  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
};

// ui/rc_week.js
__mods["ui/rc_week.js"] = function (__x, __req) {
  /**
   * The week plan — who is where, what they are on, and how it went.
   *
   * One tab, and it used to be two. "Week plan" drew the team's week from the
   * plan's side; "Resources" drew the same rows the other way round, per person,
   * with what the 4WLA asked for beside them. They were people down and days
   * across in both cases, over the same `rc_plan_entries`, through the same
   * `assignmentIndex()` — the same table drawn twice with a different subtitle,
   * and each one missing something the other had. Whichever you opened, the answer
   * you wanted was on the other.
   *
   * So there is one. It carries every part that was load-bearing in either:
   *
   * **What each person is on, per day**, every task and not the first of them,
   * because a shift is routinely two jobs.
   *
   * **What the 4WLA asked for**, where a stored entry disagrees with it. That is
   * a decision somebody took against the workbook and it is the one case worth
   * drawing twice; where they agree — the normal case, since the sheet *is* the
   * plan — there is nothing to reconcile and one line is drawn.
   *
   * **How yesterday went.** The huddle records an outcome against a day, and the
   * meeting is an administrator's screen. Without it here a member had no way to
   * see what was said about their own work: the status, the note, the photograph,
   * whether it was carried over. It is read-only in this view — recording is the
   * meeting's job and there must be one recording path — but it is *shown*, and
   * that is most of why a member needs to open this at all.
   *
   * **Who can actually be staffed each day**, on the bottom row. The number that
   * stops work being promised for a day that cannot be covered.
   *
   * **The names and places the registers cannot resolve.** A view that is
   * incomplete and says so is usable; one that is quietly wrong is not.
   *
   * **A member's own row is theirs.** They create, revise and withdraw tasks on
   * it and on no other, which is `rc_can_act_for()` in Postgres — this only
   * stops offering what the database would refuse. Withdrawing is a tombstone
   * rather than a delete, because `rc_plan_entries` has no DELETE grant and a
   * plan that changed the evening before a shift is delay evidence.
   *
   * Everything written here is an `rc_plan_entries` row — the same rows the huddle
   * reads and the reports group by. There is one place a day is planned and
   * several places it is read.
   *
   * Imports: util, dates, rc, icons, components, rc_util.
   */

  const { el, clear } = __req("core/util.js");
  const { toISO, addDays, todayMs } = __req("core/dates.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, selectInput, toast, badge, checkbox, field, emptyState, promptDialog, confirmDialog } = __req("ui/components.js");



  const { SHIFTS, STATUS_BY_ID, weekStart, allWeekDays, todayISO, dayLabel, byId, availability, notifyChanged, formModal, nameRegister, foldName, ambiguousFirstNames, lookaheadWithResources, assignmentIndex, locationRegister, unmatchedLocations } = __req("ui/rc_util.js");






  /** Which week is on screen. Null means the one containing today. */
  let weekOf = null;

  /**
   * Whether the days nobody works are drawn.
   *
   * Off by default: a seven-column grid where two columns are dots for most of the
   * team is two columns of nothing. It is a switch rather than a rule because
   * commissioning runs weekend possessions, and the weekend is where some of the
   * most expensive work happens.
   */
  let showQuietDays = false;

  async function render(root) {
    const startMs = weekOf ?? weekStart(todayMs());
    const days = allWeekDays(startMs);
    const from = days[0];
    const to = days[days.length - 1];
    const today = todayISO();

    /* The look-ahead is administrators-only in the database, so a member gets
       nothing back and the view simply has no BART column — which is correct, and
       is why `lookaheadWithResources()` catches rather than a permission test up
       here. It is also the one place the three views ask, so they cannot disagree
       about where somebody is. */
    const [people, locations, categories, leave, planRows, actuals, aliases, locAliases, sheet, everybody] =
      await Promise.all([
        /* The people who take shifts, which is what this view is a reading of.
           A manager administers the calendar and is never assigned to a location,
           so a row of seven dots against their name is a row of noise in the middle
           of the one screen that answers "who is where". It is `scheduled` that
           decides and never the role — an administrator who *does* take shifts
           stays here, which is the whole reason the column exists — and it is the
           same filter the week plan and the huddle already make. */
        rc.listPeople({ scheduledOnly: true }),
        rc.listLocations(),
        rc.listCategories(),
        /* Three weeks past the end of this one, not one. You find out somebody is
           off when you try to staff the day, which is a fortnight too late to do
           anything about it — so the window for leave is wider than the window
           for the grid, and what falls outside it is named underneath. */
        rc.listLeave(from, toISO(addDays(startMs, 27))),
        rc.listPlan(from, to),
        /* How it went, from the huddle. Read-only here: recording is the
           meeting's job and there is one recording path. Shown because the
           meeting is an administrator's screen, so without this a member had
           nowhere to see what was said about their own week. */
        rc.listActuals(from, to).catch(() => []),
        rc.listPersonAliases().catch(() => []),
        rc.listLocationAliases().catch(() => []),
        lookaheadWithResources(from, to),
        /* Everybody, for the register only. A name in the workbook belongs to
           whoever it belongs to, and matching it against the scheduled roster alone
           would report a real person — a manager the sheet happens to name — as a
           spelling nobody could place. */
        rc.listPeople().catch(() => []),
      ]);
    const laRows = sheet.rows;

    const locs = byId(locations);
    const cats = byId(categories);
    const register = nameRegister(everybody.length ? everybody : people, aliases);
    /* The 4WLA's Resource row *is* the plan for the days it names — derived, never
       written — and a stored entry is somebody overriding it or planning a day the
       sheet says nothing about. The same reading the week plan and the huddle
       make, from the same function. */
    const index = assignmentIndex({ planRows, laRows, absences: sheet.absences, categories, register });
    const { byPerson, unmatched, near } = index;
    /* "Nobody is called that" and "two people are, and I will not choose" are
       different problems with different fixes, and a list that ran them together
       would send somebody looking for a person who is already on the roster
       twice. */
    const shared = ambiguousFirstNames(people);
    /* Where the sheet says the work is. The same answer as a name it cannot place:
       the spelling is kept and shown, never discarded and never guessed at. */
    const strangeLocations = unmatchedLocations(laRows, locationRegister(locations, locAliases));

    /* How each day went, indexed two ways.
       An outcome points at one plan entry where there was one to point at, and at
       nothing but a person and a date where the day was derived from the sheet —
       so both keys are needed or the derived days, which are most of them, would
       show no outcome at all. The entry wins: two people can be planned on one
       day and the note belongs to the task it was recorded against. */
    const outcomeByEntry = new Map();
    const outcomeByDay = new Map();
    for (const row of actuals) {
      if (row.plan_entry_id) outcomeByEntry.set(row.plan_entry_id, row);
      const key = `${row.person_id}|${row.work_date}`;
      if (!outcomeByDay.has(key)) outcomeByDay.set(key, []);
      outcomeByDay.get(key).push(row);
    }
    /* The outcome for one drawn task. A stored entry is matched on its id; a
       derived day takes whichever outcome was recorded against the person and the
       date, because there is no row for it to point at. */
    const outcomeFor = (entry, personId, iso) => {
      if (entry?.id && outcomeByEntry.has(entry.id)) return outcomeByEntry.get(entry.id);
      if (entry?.id) return null;
      const day = outcomeByDay.get(`${personId}|${iso}`) || [];
      return day.find((a_) => !a_.plan_entry_id) || day[0] || null;
    };

    const thisWeek = leave.filter((l) => l.start_date <= to && l.end_date >= from);
    const soon = leave.filter((l) => l.start_date > to
      && l.status !== 'cancelled' && l.status !== 'declined');

    /* Only the days somebody works, unless asked otherwise. `showQuietDays` is
       about the columns; a person who works none of them still has a row, because
       a row that vanishes is a person nobody remembers to plan. */
    const shown = showQuietDays
      ? days
      : days.filter((iso) => people.some((p) => availability(p, iso, thisWeek).state !== 'non-working'));
    const columns = shown.length ? shown : days;

    const redraw = () => { clear(root); render(root); };

    root.appendChild(el('div', { class: 'rc-section-head' }, [
      el('button', {
        class: 'cx-btn icon mini ghost',
        'aria-label': 'Previous week',
        html: icon('chevron-left', { size: 13 }),
        onClick: () => { weekOf = startMs - 7 * 86400000; redraw(); },
      }),
      el('h3', { text: `Week of ${dayLabel(from, 'medium')}` }),
      weekOf === null ? null : el('button', {
        class: 'cx-btn mini ghost',
        text: 'This week',
        onClick: () => { weekOf = null; redraw(); },
      }),
      el('button', {
        class: 'cx-btn icon mini ghost',
        'aria-label': 'Next week',
        html: icon('chevron-right', { size: 13 }),
        onClick: () => { weekOf = startMs + 7 * 86400000; redraw(); },
      }),
      rc.canWrite()
        ? el('button', {
          class: 'cx-btn mini primary',
          html: icon('plus', { size: 12 }) + '<span>Assign work</span>',
          title: 'Anything, including a day that is not in the 4WLA at all — office, another '
            + 'project, training.',
          onClick: () => assign({
            people, locations, categories, laRows, locs, days, redraw, person: null, iso: null,
          }),
        })
        : null,
    ].filter(Boolean)));

    if (!people.length) {
      root.appendChild(emptyState({
        iconName: 'users',
        title: 'Nobody on the team yet',
        message: 'Add people in Organisation first. Being on the roster never requires an account.',
      }));
      return;
    }

    root.appendChild(el('div', {
      style: 'display:flex;align-items:center;gap:16px;margin:0 0 10px;flex-wrap:wrap',
    }, [
      checkbox({
        label: 'Show days nobody works',
        checked: showQuietDays,
        onChange: (on) => { showQuietDays = on; redraw(); },
      }),
    ]));

    /* ── The grid ─────────────────────────────────────────────────────────── */

    const body = el('tbody');
    for (const person of people) {
      const wanted = byPerson.get(person.id) || new Map();
      const cells = columns.map((iso) => {
        const state = availability(person, iso, thisWeek, index.absent(person.id, iso));
        const asked = wanted.get(iso) || [];
        const classes = ['rc-res-cell'];
        if (iso === today) classes.push('rc-res-today');

        if (state.state === 'leave') {
          return el('td', { class: classes.join(' '), 'data-label': dayLabel(iso) }, [
            // Booked, or only on the 4WLA's PTO row: one day off either way, and
            // which of the two wrote it down is the PTO tab's question.
            badge('Leave', 'muted'),
          ]);
        }
        const planned = index.on(person.id, iso);
        if (state.state === 'non-working' && !planned.length && !asked.length) {
          return el('td', {
            class: `${classes.join(' ')} rc-inactive`,
            'data-label': dayLabel(iso),
          }, [el('span', { text: '·' })]);
        }

        /* Whose day this is decides whether it can be changed. A member plans,
           revises and withdraws their own and nobody else's; an administrator does
           anybody's. That is `rc_can_act_for()` in Postgres — this only stops
           offering what the database would refuse. */
        const mayPlan = rc.canWrite() && (rc.isAdmin() || person.id === rc.me()?.id);

        const parts = [];
        // Every task on the day, not the first of them. A shift is routinely two
        // jobs, and drawing one was how the other went missing.
        for (const entry of planned) {
          const outcome = outcomeFor(entry, person.id, iso);
          const status = outcome ? STATUS_BY_ID.get(outcome.status) : null;
          parts.push(el('div', {
            class: ['rc-res-job', entry.absence ? 'rc-res-away' : '',
              outcome ? `rc-res-done rc-res-${outcome.status}` : ''].filter(Boolean).join(' '),
          }, [
            el('div', { class: 'rc-res-task', text: entry.task || '—' }),
            el('div', { class: 'rc-hint', text: [
              locs.get(entry.location_id)?.name || entry.raw_location,
              cats.get(entry.category_id)?.name,
              entry.shift !== 'day' ? entry.shift : null,
            ].filter(Boolean).join(' · ') }),
            el('div', { class: 'rc-res-flags' }, [
              /* The workbook is the assumption, so only a day somebody typed in
                 carries a flag. A derived day has `id: null` by design, which is
                 what tells the two apart. */
              !entry.from_lookahead && entry.id ? badge('Manual', 'warn') : null,
              /* Moved, because a later read of the sheet named somebody else on
                 the row this was written against. Drawn on the person who has it
                 now and naming the one who had it, which is the only version of
                 this that answers "why am I on this". */
              entry.reassigned_from
                ? badge(`Reassigned from ${nameOf(everybody, people, entry.reassigned_from)}`, 'info')
                : null,
              entry.supersedes_id && !entry.reassigned_from ? badge('Revised', 'warn') : null,
              entry.carry_chain_id ? badge('Carried over', 'warn') : null,
            ].filter(Boolean)),
            /* How it went, from the huddle — the whole reason a member opens this.
               Read-only: the meeting is where an outcome is recorded and there is
               one recording path, so this states it and offers nothing. */
            outcome
              ? el('div', { class: 'rc-res-outcome' }, [
                /* An eyebrow, because this is a different *kind* of thing from
                   the flags above it: those say what the plan is, this says what
                   happened. Without it the status badge read as a fourth flag. */
                el('span', { class: 'rc-eyebrow', text: 'Recorded' }),
                badge(status?.label || outcome.status, status?.tone || 'muted'),
                outcome.blocked_reason
                  ? el('div', { class: 'rc-hint', text: outcome.blocked_reason })
                  : null,
                outcome.note ? el('div', { class: 'rc-hint', text: outcome.note }) : null,
                outcome.evidence_path
                  ? el('button', {
                    class: 'cx-btn mini ghost rc-evidence',
                    html: `${icon('paperclip', { size: 11 })}<span>Photo</span>`,
                    title: 'Open the photograph taken with this outcome',
                    onClick: async () => {
                      try {
                        window.open(await rc.evidenceUrl(outcome.evidence_path), '_blank', 'noopener');
                      } catch (err) {
                        toast({ tone: 'bad', message: `That photograph could not be opened — ${err.message}` });
                      }
                    },
                  })
                  : null,
                outcome.supersedes_id ? el('div', { class: 'rc-hint', text: 'corrected' }) : null,
              ].filter(Boolean))
              : null,
            /* Changing it. A derived day has no row to revise, so revising it *is*
               writing the first one — which is what overriding the sheet means, and
               is labelled as that. Withdrawing is only ever offered for a stored
               row: there is nothing to withdraw from a day the sheet is asserting,
               and the honest answer there is to override it. */
            mayPlan
              ? el('div', { class: 'rc-res-acts' }, [
                /* Icons rather than words. Seven columns of "Edit" and "Delete"
                   is more chrome than content in a cell that already carries a
                   task, a place, its flags and how it went — and the actions are
                   the least interesting thing in it. Labelled for a screen reader
                   and titled for a pointer, which is what an icon-only button
                   owes anybody. */
                el('button', {
                  class: 'cx-btn icon mini ghost',
                  'aria-label': entry.from_lookahead
                    ? `Override the sheet for ${person.name} on ${dayLabel(iso)}`
                    : `Revise ${entry.task || 'this task'}`,
                  html: icon(entry.from_lookahead ? 'refresh' : 'edit', { size: 11 }),
                  title: entry.from_lookahead
                    ? 'Override the sheet. The 4WLA plans this day, so changing it writes the first '
                      + 'plan entry against it.'
                    : 'Revise this — the outgoing version stays on the record.',
                  onClick: () => (entry.from_lookahead
                    ? overrideSheet({
                      person, iso, laRows, locations, categories, locs, redraw,
                      row: laRows.find((r) => r.id === entry.lookahead_row_id) || null,
                    })
                    : revisePlan(entry, person, { locations, categories, locs, redraw })),
                }),
                entry.id
                  ? el('button', {
                    class: 'cx-btn icon mini ghost danger',
                    'aria-label': `Remove ${entry.task || 'this task'} from ${dayLabel(iso)}`,
                    html: icon('trash', { size: 11 }),
                    title: 'Takes the day off the schedule. The record keeps it — a plan that '
                      + 'changed the evening before a shift is itself evidence — so this writes a '
                      + 'withdrawal rather than removing anything.',
                    onClick: () => withdraw(entry, person, redraw),
                  })
                  : null,
              ].filter(Boolean))
              : null,
          ].filter(Boolean)));
        }
        const entry = planned[0] || null;

        /* The one case worth drawing twice: a stored entry that overrides what the
           sheet asks for. That is a decision somebody took against the workbook,
           and seeing the two side by side is the whole reason this view exists.
           Where they agree — which is now the normal case, because the sheet *is*
           the plan — there is nothing to reconcile and only one line is drawn. */
        if (entry && !entry.from_lookahead) {
          const linked = new Set(planned.map((e) => e.lookahead_row_id).filter(Boolean));
          for (const row of asked) {
            if (linked.has(row.id)) continue;
            parts.push(el('div', {
              class: 'rc-res-asked',
              title: 'The 4WLA names this person here and the plan for the day says otherwise.',
            }, [
              el('span', { class: 'rc-eyebrow', text: '4WLA' }),
              el('div', { text: (row.raw_label || `row ${row.sheet_row}`).slice(0, 44) }),
              el('div', {
                class: 'rc-hint',
                /* The place the register knows, and the sheet's own spelling only
                   where it does not know one. It read the other way round, which
                   put "T12" on screen for a location the application can name — the
                   code is what the workbook types, not what anybody calls it. */
                text: locs.get(row.location_id)?.name || row.raw_location || '',
              }),
            ]));
          }
        }

        /* A day off somebody has asked for and nobody has answered.
           Not leave — the day is still staffable and an administrator still has a
           decision to make — but drawn, because a request nobody can see while
           they are staffing the week is a request that gets scheduled straight
           over. PTO is where it is answered. */
        if (state.asked) {
          parts.push(el('div', { class: 'rc-res-asked-off' }, [
            badge('Leave requested', 'warn'),
          ]));
        }

        if (!mayPlan) {
          return el('td', { class: classes.join(' '), 'data-label': dayLabel(iso) },
            parts.length ? parts : [el('span', { class: 'rc-hint', text: '—' })]);
        }
        /* The button is there whether or not the day already has something on it:
           a shift is often more than one job, and a day that could only ever hold
           one task is how somebody ends up with one of the three things they were
           asked for. */
        parts.push(el('button', {
          class: 'cx-btn mini ghost rc-res-add',
          text: parts.length ? '+ task' : '+',
          'aria-label': `Assign ${person.name} on ${dayLabel(iso)}`,
          title: parts.length ? 'Add another task to this day' : 'Plan this day',
          onClick: () => assign({
            people, locations, categories, laRows, locs, days, redraw, person, iso,
          }),
        }));
        return el('td', { class: classes.join(' '), 'data-label': dayLabel(iso) }, parts);
      });

      body.appendChild(el('tr', {}, [
        el('td', {}, [
          el('div', { text: person.name }),
          el('div', { class: 'rc-hint', text: [person.title, person.subsystem].filter(Boolean).join(' · ') }),
          person.scheduled === false ? badge('Not scheduled', 'neutral') : null,
        ].filter(Boolean)),
        ...cells,
      ]));
    }

    /* How many people can actually be staffed each day.
       The number that stops work being promised for a day it cannot be covered,
       and the one part of the old week-plan tab that had no counterpart here. */
    const coverage = columns.map((iso) => people.filter((p) =>
      availability(p, iso, thisWeek, index.absent(p.id, iso)).state === 'available').length);

    body.appendChild(el('tr', { class: 'rc-res-coverage' }, [
      el('td', {}, [el('strong', { text: 'Can be staffed' })]),
      ...coverage.map((n, i) => el('td', {
        class: ['rc-num', columns[i] === today ? 'rc-res-today' : ''].filter(Boolean).join(' '),
        'data-label': dayLabel(columns[i]),
      }, [el('span', { text: `${n} of ${people.length}` })])),
    ]));

    root.appendChild(el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table rc-resources' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Resource' }),
            ...columns.map((iso) => el('th', {
              /* Today, marked on the column rather than on one cell. A week grid
                 is read by running a finger down a day, and the day somebody is
                 nearly always looking for is this one — it used to be a two-pixel
                 rule on the left edge of the cells, which is invisible against a
                 table that has borders anyway. */
              class: iso === today ? 'rc-res-today rc-res-today-head' : '',
              html: iso === today
                ? `${dayLabel(iso)}<span class="rc-today-tag">Today</span>`
                : undefined,
              text: iso === today ? undefined : dayLabel(iso),
            })),
          ]),
        ]),
        body,
      ]),
    ]));

    /* Leave that has not started yet. Three weeks past the end of the grid,
       because finding out when you try to staff the day is a fortnight too late
       to do anything about it. */
    if (soon.length) {
      const peopleById = byId(people);
      root.appendChild(el('p', {
        class: 'rc-hint',
        text: 'Coming up: ' + soon
          .sort((a_, b_) => a_.start_date.localeCompare(b_.start_date))
          .slice(0, 6)
          .map((l) => `${peopleById.get(l.person_id)?.name || 'somebody'} from ${dayLabel(l.start_date)}`
            + `${l.status === 'requested' ? ' (requested)' : ''}`)
          .join(', ')
          + '. Requests are in PTO, where an administrator answers them.',
      }));
    }

    /* ── Where everybody is ───────────────────────────────────────────────── */

    const atLocation = new Map();
    for (const entry of planRows) {
      const name = locs.get(entry.location_id)?.name || 'no location recorded';
      if (!atLocation.has(name)) atLocation.set(name, new Set());
      atLocation.get(name).add(entry.person_id);
    }
    if (atLocation.size) {
      const peopleById = byId(people);
      root.appendChild(el('div', { style: 'height:20px' }));
      root.appendChild(el('div', { class: 'rc-section-head' }, [
        el('h3', { text: 'Where the week puts people' }),
      ]));
      root.appendChild(el('div', { class: 'rc-scroll' }, [
        el('table', { class: 'rc-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Location' }), el('th', { text: 'Who' }), el('th', { text: 'People' }),
          ])]),
          el('tbody', {}, [...atLocation.entries()]
            .sort((a, b) => b[1].size - a[1].size)
            .map(([name, ids]) => el('tr', {}, [
              el('td', { text: name }),
              el('td', { text: [...ids].map((id) => peopleById.get(id)?.name || '—').sort().join(', ') }),
              el('td', { class: 'rc-num', text: String(ids.size) }),
            ]))),
        ]),
      ]));
    }

    /* ── Names the roster does not know ───────────────────────────────────── */

    if (unmatched.length) {
      root.appendChild(el('div', { style: 'height:20px' }));
      root.appendChild(el('div', { class: 'rc-section-head' }, [
        el('h3', { text: 'Named in the 4WLA, not on the roster' }),
      ]));
      root.appendChild(el('div', { class: 'rc-scroll' }, [
        el('table', { class: 'rc-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'As written' }), el('th', { text: 'Days' }),
            el('th', { text: 'On' }), el('th', { text: '' }),
          ])]),
          el('tbody', {}, unmatched.map((u) => el('tr', {}, [
            el('td', {}, [
              el('div', { text: u.name }),
              shared.has(foldName(u.name))
                ? el('div', {
                  class: 'rc-hint',
                  text: 'more than one person is called that — say which',
                })
                : null,
            ].filter(Boolean)),
            el('td', { class: 'rc-num', text: String(u.days.size) }),
            el('td', { class: 'rc-hint', text: u.rows.map((r) => r.raw_label || '').filter(Boolean).join(', ').slice(0, 60) }),
            el('td', {}, rc.isAdmin() ? [
              el('button', {
                class: 'cx-btn mini',
                text: 'That is somebody',
                title: 'Record this spelling against a person. Nothing is guessed from a surname — '
                  + 'a shift against the wrong engineer is worse than one against nobody.',
                onClick: () => mapName(u, people, redraw),
              }),
              el('button', {
                class: 'cx-btn mini ghost',
                text: 'Add to the team',
                title: 'Somebody on site who is not on the roster yet.',
                onClick: () => addFromName(u, redraw),
              }),
            ] : []),
          ]))),
        ]),
      ]));
      root.appendChild(el('p', {
        class: 'rc-hint',
        text: 'These are the names the 4WLA has that the roster cannot place, so the rows above are '
          + 'missing them. A bare first name does match, where exactly one person on the roster '
          + 'answers to it — that is what the Resource row is filled in with. Nothing is matched on '
          + 'a surname or a set of initials, and a first name two people share matches neither: '
          + 'picking one would put a shift against the wrong engineer, silently, because both '
          + 'answers look equally right on screen. Either way the answer is an alias, once.',
      }));
    }

    /* ── Names placed by correcting a spelling ────────────────────────────── */

    if (near.length) {
      const peopleById = byId(people);
      root.appendChild(el('div', { style: 'height:20px' }));
      root.appendChild(el('div', { class: 'rc-section-head' }, [
        el('h3', { text: 'Matched by correcting a spelling' }),
      ]));
      root.appendChild(el('div', { class: 'rc-scroll' }, [
        el('table', { class: 'rc-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'As written' }), el('th', { text: 'Read as' }),
            el('th', { text: 'Days' }), el('th', { text: '' }),
          ])]),
          el('tbody', {}, near.map((u) => el('tr', {}, [
            el('td', { text: u.name }),
            el('td', {}, [
              el('span', { text: peopleById.get(u.person_id)?.name || '—' }),
              badge('near miss', 'warn'),
            ]),
            el('td', { class: 'rc-num', text: String(u.days.size) }),
            el('td', {}, rc.isAdmin() ? [
              el('button', {
                class: 'cx-btn mini ghost',
                text: 'Record the spelling',
                title: 'Keeps this spelling against that person for good, so nothing has to be '
                  + 'corrected on the next read.',
                onClick: () => mapName(u, people, redraw),
              }),
            ] : []),
          ]))),
        ]),
      ]));
      root.appendChild(el('p', {
        class: 'rc-hint',
        text: 'These spellings are not on the roster and are one or two characters away from exactly '
          + 'one name that is, so they are read as that person rather than dropped — a transposed pair '
          + 'of letters used to cost somebody a whole week of shifts. It is listed because it is a '
          + 'correction rather than a match: a short name is still matched exactly, and a spelling '
          + 'equally close to two people is matched to neither. Recording it as an alias turns the '
          + 'judgement into a fact.',
      }));
    }

    /* ── Places the register does not know ────────────────────────────────── */

    if (strangeLocations.length) {
      root.appendChild(el('div', { style: 'height:20px' }));
      root.appendChild(el('div', { class: 'rc-section-head' }, [
        el('h3', { text: 'Where the 4WLA says, and the register cannot place' }),
      ]));
      root.appendChild(el('div', { class: 'rc-scroll' }, [
        el('table', { class: 'rc-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'As written' }), el('th', { text: 'Rows' }),
            el('th', { text: 'On' }), el('th', { text: '' }),
          ])]),
          el('tbody', {}, strangeLocations.map((u) => el('tr', {}, [
            el('td', { text: u.name }),
            el('td', { class: 'rc-num', text: String(u.rows.length) }),
            el('td', {
              class: 'rc-hint',
              text: u.rows.map((r) => r.raw_label || '').filter(Boolean).join(', ').slice(0, 60),
            }),
            el('td', {}, rc.isAdmin() ? [
              el('button', {
                class: 'cx-btn mini',
                text: 'That is a place we have',
                title: 'Record this spelling against a location on the register.',
                onClick: () => mapLocation(u, locations, redraw),
              }),
              el('button', {
                class: 'cx-btn mini ghost',
                text: 'Add as a location',
                title: 'A place the register has never carried.',
                onClick: () => addFromLocation(u, redraw),
              }),
            ] : []),
          ]))),
        ]),
      ]));
      root.appendChild(el('p', {
        class: 'rc-hint',
        text: 'The location comes off the 4WLA\u2019s own Location column, and it is kept whether or '
          + 'not the register knows the spelling \u2014 which is what puts these here to be answered '
          + 'rather than dropping them. A code matches, where a location on the register carries it: '
          + 'that column is filled in with "W30", not the full name. Until one of these is mapped the '
          + 'days it covers still show the place as written, and the reports simply cannot group them.',
      }));
    }

    /* ── What this view is ────────────────────────────────────────────────── */

    root.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Everything here is a plan entry — the same rows the daily huddle reads and the reports '
        + 'group by — so anybody assigned here is in tomorrow\'s meeting with their scope against '
        + 'their name. This was two tabs, "Week plan" and "Resources", drawing the same table twice '
        + 'with a different subtitle; whichever you opened, the part you wanted was on the other.',
    }));
    root.appendChild(el('p', {
      class: 'rc-hint',
      text: rc.isAdmin()
        ? 'A member sees all of this and can create, change and remove tasks on their own row and '
          + 'nowhere else — the rule `rc_plan_entries` makes in Postgres, not something this screen '
          + 'decides. Removing one writes a withdrawal rather than deleting anything, so the record '
          + 'still holds the day as planned.'
        : 'Your own row is yours: add a task, change one, or take one off. Everybody else\'s is '
          + 'read-only, and the database says so rather than this screen. What the huddle recorded '
          + 'against a day is shown here because that meeting is where it is entered — this is where '
          + 'you can read it back.',
    }));
    root.appendChild(el('p', {
      class: 'rc-hint',
      text: laRows.length
        ? `The 4WLA names people on ${laRows.filter((r) => Object.keys(r.resources || {}).length).length} `
          + 'row(s) in these weeks, and where it names somebody that is their plan for the day — '
          + 'derived from the sheet rather than written down, so it follows the workbook instead of '
          + 'going stale beside it. That is the assumption everywhere and it carries no badge. What '
          + 'is flagged "Manual" is a plan entry: somebody overriding the sheet, or planning a day it '
          + 'says nothing about. Where an override disagrees with the sheet both are drawn, because '
          + 'that is the case worth seeing.'
        : 'No look-ahead rows read for this week yet, so nothing here can say what BART asked for. '
          + 'Read it in Look-ahead → Check now.',
    }));
    root.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Work that is not commissioning work belongs here too — a day in the office, a day on '
        + 'another project, training. Without somewhere for those to go the huddle has a blank '
        + 'against a name and no way to tell "nothing planned" from "nothing said".',
    }));
  }

  /**
   * A roster name from an id, whoever they are.
   *
   * Looked up in *everybody* before the scheduled roster, because the person a
   * task was reassigned away from may be a manager or somebody who has since been
   * stood down — and "Reassigned from —" is worse than not saying it at all.
   */
  function nameOf(everybody, people, id) {
    if (!id) return 'somebody';
    const found = (everybody || []).find((p) => p.id === id)
      || (people || []).find((p) => p.id === id);
    return found?.name || 'somebody';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Changing a day that is already planned
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Revise a stored entry.
   *
   * Never an update. The outgoing row stays and the new one points at it, so "the
   * plan changed the evening before the shift" is a thing the record can still say
   * a year later — which is the whole reason the table is append-only.
   * `rc_supersede_plan()` refuses to revise an entry that has already been
   * revised, so two people editing the same day get a refusal rather than one of
   * them silently winning.
   *
   * The history is shown because it is the point: a revision nobody can see is an
   * edit with extra steps.
   */
  async function revisePlan(entry, person, { locations, categories, locs, redraw }) {
    const history = await rc.planHistory(person.id, entry.work_date).catch(() => []);

    const task = textInput({ value: entry.task || '', placeholder: 'What they will do' });
    const location = selectInput({
      value: entry.location_id || '',
      placeholder: '— location —',
      options: locations.map((l) => ({ value: l.id, label: l.name })),
    });
    const category = selectInput({
      value: entry.category_id || '',
      placeholder: '— category —',
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    });
    const shift = selectInput({
      value: entry.shift || 'day',
      options: SHIFTS.map((sh) => ({ value: sh.id, label: sh.label })),
    });

    formModal({
      title: `${person.name} — ${dayLabel(entry.work_date, 'medium')}`,
      body: el('div', { class: 'cx-form' }, [
        field('Task', task),
        field('Location', location),
        field('Category', category),
        field('Shift', shift),
        history.length > 1
          ? el('div', { class: 'cx-field' }, [
            el('label', { class: 'cx-label', text: `Already revised ${history.length - 1} time(s)` }),
            el('div', { class: 'rc-hint' }, history.map((h) => el('div', {
              text: `${(h.created_at || '').slice(0, 16).replace('T', ' ')} — ${h.task || '—'}`
                + `${locs.get(h.location_id)?.name ? ` · ${locs.get(h.location_id).name}` : ''}`,
            }))),
          ])
          : null,
        el('p', {
          class: 'rc-hint',
          text: 'The version you are replacing stays on the record. A plan that changed the '
            + 'evening before a shift is itself delay evidence, so nothing here overwrites '
            + 'anything — and an entry somebody else has already revised is refused rather than '
            + 'quietly losing one of the two changes.',
        }),
      ].filter(Boolean)),
      confirmLabel: 'Revise',
      onConfirm: async () => {
        if (!task.value.trim()) throw new Error('A task is needed.');
        await rc.supersedePlan(entry.id, {
          locationId: location.value || null,
          task: task.value.trim(),
          categoryId: category.value || null,
          shift: shift.value,
        });
        notifyChanged('plan');
        redraw();
      },
    });
  }

  /**
   * Take a day off the schedule.
   *
   * "Delete my task", and it is a *write*: `rc_plan_entries` has no DELETE grant,
   * because a plan that changed the evening before the shift is what a delay claim
   * is built from and a row that can be removed is a record that can be edited. So
   * `rc_withdraw_plan()` writes a tombstone superseding the original and
   * `rc_plan_current` drops the pair — the day leaves the schedule and the table
   * still says it was planned and then withdrawn, by whom and when.
   *
   * Asked first, because it is the one action here with no visible result other
   * than something disappearing, and said plainly afterwards.
   */
  async function withdraw(entry, person, redraw) {
    const ok = await confirmDialog({
      title: `Remove this from ${person.name}’s ${dayLabel(entry.work_date, 'medium')}?`,
      message: 'It comes off the schedule. Nothing is deleted: the record keeps the day as planned '
        + 'and then withdrawn, because a plan that changed the evening before a shift is itself '
        + 'evidence. An outcome already recorded against it stays on the record too.',
      confirmLabel: 'Remove it',
      danger: true,
    });
    if (!ok) return;
    try {
      await rc.withdrawPlan(entry.id);
      notifyChanged('plan');
      toast({ tone: 'good', message: 'Off the schedule, and still on the record.' });
      redraw();
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
  }

  /**
   * Write the first stored row for a day the 4WLA planned.
   *
   * A derived day has no row to revise, so revising it *is* writing the first one
   * — and what that means is a decision taken against the workbook, which is why
   * the button says "Override the sheet" rather than "Plan it". The sheet's own
   * row is prefilled and the link is kept, which is what later lets a block be
   * recorded against the row BART themselves scheduled.
   */
  function overrideSheet({ person, iso, laRows, locations, categories, locs, redraw, row = null }) {
    const wanted = laRows.filter((r) => !r.cells || !Object.keys(r.cells).length || r.cells[iso]);
    const rows = wanted.length ? wanted : laRows;

    const pick = selectInput({
      value: row && rows.some((r) => r.id === row.id) ? row.id : '',
      placeholder: '— nothing from the look-ahead —',
      options: rows.map((r) => ({
        value: r.id,
        label: [locs.get(r.location_id)?.name || r.raw_location, r.raw_label]
          .filter(Boolean).join(' · ').slice(0, 70) || `row ${r.sheet_row}`,
      })),
    });
    // Prefilled from the chosen row where there is one, because `change` only
    // fires when a person picks — a row selected for them would otherwise sit
    // above three empty fields it already knows the answers to.
    const task = textInput({ placeholder: 'What they will do', value: row?.raw_label || '' });
    const location = selectInput({
      value: row?.location_id || '',
      placeholder: '— location —',
      options: locations.map((l) => ({ value: l.id, label: l.name })),
    });
    const category = selectInput({
      value: '',
      placeholder: '— category —',
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    });
    const shiftFrom = (meaning) => {
      const said = String(meaning || '').toLowerCase();
      if (/night/.test(said)) return 'night';
      if (/possession|blanket/.test(said)) return 'possession';
      return 'day';
    };
    const shift = selectInput({
      value: shiftFrom(row?.cells?.[iso]),
      options: SHIFTS.map((sh) => ({ value: sh.id, label: sh.label })),
    });

    // Choosing a row fills the rest in. It is a starting point, not a lock —
    // what the look-ahead calls an activity and what you would tell somebody to
    // do are rarely the same sentence.
    pick.addEventListener('change', () => {
      const chosen = rows.find((r) => r.id === pick.value);
      if (!chosen) return;
      if (!task.value.trim()) task.value = chosen.raw_label || '';
      if (chosen.location_id) location.value = chosen.location_id;
      shift.value = shiftFrom(chosen.cells?.[iso]);
    });

    formModal({
      title: `${person.name} — ${dayLabel(iso, 'medium')}`,
      body: el('div', { class: 'cx-form' }, [
        field('From the look-ahead', pick,
          'What BART asked for on this day. Choosing one fills the rest in and keeps the link, '
          + 'which is what later lets a block be recorded against the row BART themselves '
          + 'scheduled.'),
        field('Task', task),
        field('Location', location),
        field('Category', category),
        field('Shift', shift),
      ]),
      confirmLabel: 'Override the sheet',
      onConfirm: async () => {
        if (!task.value.trim()) throw new Error('A task is needed.');
        await rc.addPlanEntries([{
          person_id: person.id,
          work_date: iso,
          shift: shift.value,
          location_id: location.value || null,
          task: task.value.trim(),
          category_id: category.value || null,
          lookahead_row_id: pick.value || null,
        }]);
        notifyChanged('plan');
        redraw();
      },
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Assigning
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Plan somebody onto a span of days.
   *
   * A span rather than a day, because that is how the off-project days arrive:
   * nobody is in the office for one Tuesday, they are in the office Monday to
   * Wednesday. Every day still becomes its own `rc_plan_entries` row — the grain
   * the huddle reads and the reports group by — so this is a convenience over the
   * same write, never a second shape of assignment.
   *
   * **A day can carry more than one task**, which is the normal shape of a shift:
   * a test to witness in the morning and a cable pull after it. It used to skip a
   * day that already had an entry, on the grounds that two current rows would
   * show the person twice — but the answer to that was for the views to read a
   * day as a list, not for the plan to hold one task and lose the rest. Leave and
   * non-working days are still skipped, because those are days somebody is not
   * there at all.
   *
   * **A member assigns themselves and nobody else.** `rc_plan_entries` says the
   * same in Postgres — `rc_can_act_for(person_id)`, the rule an outcome already
   * follows — so this is the interface agreeing with the database rather than
   * enforcing anything: the select simply holds the one name they could write.
   */
  function assign({ people, locations, categories, laRows, locs, days, redraw, person, iso, row = null }) {
    const mine = rc.me()?.id || null;
    const canPlan = rc.isAdmin() ? people : people.filter((p) => p.id === mine);
    const who = selectInput({
      value: person?.id || canPlan[0]?.id,
      options: canPlan.map((p) => ({ value: p.id, label: p.name })),
      disabled: canPlan.length <= 1,
    });
    const from = el('input', { type: 'date', class: 'cx-input' });
    const to = el('input', { type: 'date', class: 'cx-input' });
    from.value = iso || days[0];
    to.value = iso || days[0];

    /* What the look-ahead asks for, offered rather than assumed — it says what and
       where and never who, because it has no idea who is on the team. */
    const named = laRows.filter((r) => !iso || !Object.keys(r.cells || {}).length || r.cells[iso]);
    const pick = selectInput({
      value: row?.id || '',
      placeholder: '— not from the look-ahead —',
      options: named.map((r) => ({
        value: r.id,
        label: [locs.get(r.location_id)?.name || r.raw_location, r.raw_label]
          .filter(Boolean).join(' · ').slice(0, 70) || `row ${r.sheet_row}`,
      })),
    });
    const task = textInput({ value: row?.raw_label || '', placeholder: 'What they will do' });
    const location = selectInput({
      value: row?.location_id || '',
      placeholder: '— nowhere on site —',
      options: locations.map((l) => ({ value: l.id, label: l.name })),
    });
    const category = selectInput({
      value: '',
      placeholder: '— category —',
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    });
    const shift = selectInput({ value: 'day', options: SHIFTS.map((sh) => ({ value: sh.id, label: sh.label })) });

    pick.addEventListener('change', () => {
      const chosen = named.find((r) => r.id === pick.value);
      if (!chosen) return;
      if (!task.value.trim()) task.value = chosen.raw_label || '';
      if (chosen.location_id) location.value = chosen.location_id;
    });

    formModal({
      title: person ? `Assign ${person.name}` : 'Assign work',
      body: el('div', { class: 'cx-form' }, [
        field('Resource', who),
        field('From', from),
        field('To', to, 'Inclusive. Days they do not work and days they are on leave are skipped, '
          + 'and it says how many. A day that already has a task gets this one as well — a shift '
          + 'is often more than one job.'),
        field('From the look-ahead', pick, 'Optional. Choosing a row fills the rest in and keeps the '
          + 'link, which is what later lets a block be recorded against the row BART themselves '
          + 'scheduled. Leave it alone for work the 4WLA has never heard of.'),
        field('What', task),
        field('Where', location, 'Optional — a day in the office or on another project is not at a '
          + 'commissioning location, and pretending otherwise would put it in the site reports.'),
        field('Category', category),
        field('Shift', shift),
      ]),
      confirmLabel: 'Assign',
      onConfirm: async () => {
        if (!task.value.trim()) throw new Error('Say what they will be doing.');
        if (!from.value || !to.value) throw new Error('Both dates are needed.');
        if (to.value < from.value) throw new Error('The end is before the start.');

        const personRow = canPlan.find((p) => p.id === who.value);
        if (!personRow) {
          throw new Error(rc.isAdmin()
            ? 'Pick a person.'
            : 'You can plan your own days. An administrator plans everybody else’s.');
        }

        /* Leave and the plan are re-read here rather than passed in: this dialog
           can stay open while somebody else writes, and the skip has to be about
           what is true now. */
        const [leave, existing] = await Promise.all([
          rc.listLeave(from.value, to.value),
          rc.listPlan(from.value, to.value),
        ]);

        const rows = [];
        let alsoOn = 0;
        const skipped = { leave: 0, nonWorking: 0 };
        for (let ms = Date.parse(`${from.value}T00:00:00Z`);
          ms <= Date.parse(`${to.value}T00:00:00Z`); ms = addDays(ms, 1)) {
          const day = toISO(ms);
          const state = availability(personRow, day, leave);
          if (state.state === 'leave') { skipped.leave++; continue; }
          if (state.state === 'non-working') { skipped.nonWorking++; continue; }
          /* A day already planned is *added to*, not skipped. What it used to do
             was drop the task on the floor with a count in a toast, which is how
             somebody ends up with one of the three things they were asked for. */
          if (existing.some((e) => e.person_id === personRow.id && e.work_date === day)) {
            alsoOn++;
          }
          rows.push({
            person_id: personRow.id,
            work_date: day,
            shift: shift.value,
            location_id: location.value || null,
            task: task.value.trim(),
            category_id: category.value || null,
            lookahead_row_id: pick.value || null,
          });
        }

        if (!rows.length) {
          throw new Error('Every day in that span is non-working or on leave — there is no day '
            + 'there to plan.');
        }

        await rc.addPlanEntries(rows);
        notifyChanged('plan');
        const notes = [
          alsoOn ? `${alsoOn} alongside what was already there` : null,
          skipped.leave ? `${skipped.leave} on leave` : null,
          skipped.nonWorking ? `${skipped.nonWorking} not a working day` : null,
        ].filter(Boolean);
        toast({
          tone: 'good',
          message: `${personRow.name} assigned for ${rows.length} day(s)`
            + `${notes.length ? ` — ${notes.join(', ')}` : ''}.`,
          timeout: 8000,
        });
        redraw();
      },
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Names
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Record which person a spelling in the workbook is.
   *
   * The same shape as another spelling for a location, and for the same reason:
   * the match has to be exact, so the only way a new spelling starts matching is
   * that somebody says it does. Once.
   */
  function mapName(unmatchedName, people, redraw) {
    const who = selectInput({
      value: people[0]?.id,
      options: people.map((p) => ({ value: p.id, label: p.name })),
    });
    formModal({
      title: `"${unmatchedName.name}" is…`,
      body: el('div', { class: 'cx-form' }, [
        field('Person', who),
        el('p', {
          class: 'rc-hint',
          text: 'This records the spelling against them, so every week from now on matches without '
            + 'anybody being asked again. It is not a guess and never becomes one: nothing here '
            + 'matches on a surname, initials or a near miss.',
        }),
      ]),
      confirmLabel: 'That is them',
      onConfirm: async () => {
        await rc.addPersonAlias(who.value, unmatchedName.name);
        notifyChanged('people');
        toast({ tone: 'good', message: `"${unmatchedName.name}" now matches.` });
        redraw();
      },
    });
  }

  /**
   * Somebody on site who is not on the roster at all.
   *
   * The spelling in the workbook becomes an alias immediately, so the row they
   * were named on stops being unmatched. Their name is the spelling until somebody
   * tidies it in Organisation — a person on the roster under an odd spelling is
   * still on the roster, and an empty roster row would be worse.
   */
  async function addFromName(unmatchedName, redraw) {
    const name = await promptDialog({
      title: 'Add them to the team',
      label: 'Name, as you would write it',
      value: unmatchedName.name,
      confirmLabel: 'Add',
    });
    if (!name || !name.trim()) return;
    try {
      const person = await rc.addPerson({ name: name.trim(), role: 'member', scheduled: true });
      if (foldName(name) !== foldName(unmatchedName.name)) {
        await rc.addPersonAlias(person.id, unmatchedName.name);
      }
      notifyChanged('people');
      toast({ tone: 'good', message: `${name.trim()} is on the team, and "${unmatchedName.name}" matches them.` });
      redraw();
    } catch (err) {
      toast({ tone: 'bad', message: err.message });
    }
  }

  /**
   * Record which place a spelling in the workbook is.
   *
   * The counterpart of `mapName()`, and the same rule: exact or nothing, so the
   * only way a new spelling starts matching is that somebody says it does. Once,
   * and every week afterwards is answered.
   */
  function mapLocation(unmatched, locations, redraw) {
    const where = selectInput({
      value: locations[0]?.id,
      options: locations.map((l) => ({
        value: l.id, label: l.code ? `${l.name} (${l.code})` : l.name,
      })),
    });
    formModal({
      title: `"${unmatched.name}" is…`,
      body: el('div', { class: 'cx-form' }, [
        field('Location', where),
        el('p', {
          class: 'rc-hint',
          text: 'This records the spelling against that location, so every week from now on resolves '
            + 'without anybody being asked again \u2014 in the reports and the activity log as well as '
            + 'here. Nothing is matched on a near miss.',
        }),
      ]),
      confirmLabel: 'That is the place',
      onConfirm: async () => {
        await rc.addLocationAlias(where.value, unmatched.name);
        notifyChanged('locations');
        toast({ tone: 'good', message: `"${unmatched.name}" now resolves.` });
        redraw();
      },
    });
  }

  /**
   * A place the register has never carried.
   *
   * The spelling becomes the code rather than an alias: it is what the workbook
   * writes and what somebody will type next week, and a code is the field
   * `rc_resolve_location()` reads it out of. The name is the spelling until
   * somebody gives it a fuller one in Organisation — a location under a short
   * name is still a location, and rows filed nowhere are worse.
   */
  async function addFromLocation(unmatched, redraw) {
    const name = await promptDialog({
      title: 'Add it to the register',
      label: 'Location name, as you would write it',
      value: unmatched.name,
      confirmLabel: 'Add',
    });
    if (!name || !name.trim()) return;
    try {
      const created = await rc.addLocation({ name: name.trim(), code: unmatched.name, active: true });
      if (foldName(name) !== foldName(unmatched.name) && created?.id) {
        await rc.addLocationAlias(created.id, unmatched.name).catch(() => {});
      }
      notifyChanged('locations');
      toast({ tone: 'good', message: `${name.trim()} is on the register, and "${unmatched.name}" resolves to it.` });
      redraw();
    } catch (err) {
      toast({ tone: 'bad', message: err.message });
    }
  }

  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
};

// ui/rc_pto.js
__mods["ui/rc_pto.js"] = function (__x, __req) {
  /**
   * PTO — who is off, what is booked, and where the two disagree.
   *
   * Leave already had a home: a list in Organisation, admin-only, sorted by start
   * date. That is the *record* and it stays there. It is not a view anybody can
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
   * down: somebody types a name into the workbook and never opens Organisation.
   * Reading it is what stops the huddle asking a person on holiday how their day
   * went, and what stops the week plan drawing their week as days nobody filled
   * in.
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
   * matters. `scheduled` is what the week plan and Resources filter on because
   * those are about work; this is about people.
   *
   * Imports: util, dates, rc, icons, components, rc_util.
   */

  const { el, clear } = __req("core/util.js");
  const { toISO, addDays, todayMs } = __req("core/dates.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, selectInput, toast, badge, field, emptyState } = __req("ui/components.js");


  const { ABSENCE_LABELS } = __req("core/lookahead.js");
  const { weekStart, todayISO, dayLabel, byId, availability, isoToMs, notifyChanged, formModal, nameRegister, absenceAssignments, lookaheadWithResources } = __req("ui/rc_util.js");




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

    /* Everybody active, managers included — see the header comment. The
       look-ahead is administrators-only in the database, so a member gets nothing
       back from it and simply sees the booked side, which is correct. */
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
    const away = absenceAssignments(sheet.absences, register);
    const redraw = () => { clear(root); render(root); };
    const admin = rc.isAdmin();

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
      /* Asking is a member's; answering is an administrator's.
         It was administrators-only, which made the commonest thing anybody wants
         from this module a thing they had to get somebody else to type — so it
         went into the 4WLA instead, or nowhere at all, and "the sheet says they
         are off and nothing is booked" became the normal case. A member's press
         writes the same single `rc_leave` row with `status: 'requested'`; a second
         table for requests would be a second answer to "is Dana off on Tuesday". */
      rc.canWrite() ? el('button', {
        class: 'cx-btn mini primary',
        text: admin ? 'Book leave' : 'Request leave',
        onClick: () => bookLeave({ people, kinds, redraw, admin }),
      }) : null,
    ].filter(Boolean)));

    if (!people.length) {
      host.appendChild(emptyState({ title: 'Nobody on the roster yet.' }));
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
        if (sheetSays === 'office' || sheetSays === 'other') {
          classes.push('rc-pto-elsewhere');
          return el('td', {
            class: classes.join(' '),
            'data-label': dayLabel(iso),
            title: `The 4WLA has ${person.name} ${kinds.map((k) => ABSENCE_LABELS[k].toLowerCase())
              .join(' and ')} that day. That is work, not leave — they are in the huddle with it `
              + 'against their name.',
          });
        }

        /* Asked for and not answered. Hatched rather than filled, because it is
           not leave yet — the day is still staffable and the administrator still
           has a decision to make. Drawn at all because a request nobody can see
           on the calendar is a request that gets scheduled straight over. */
        if (state.asked) {
          classes.push('rc-pto-asked');
          return el('td', {
            class: classes.join(' '),
            'data-label': dayLabel(iso),
            title: `${person.name} has asked for this day off and nobody has answered yet. `
              + 'It is not leave until somebody does, so the day can still be staffed.',
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
      key('rc-pto-asked', 'Asked for, not answered'),
      key('rc-pto-elsewhere', 'Off the project, not off work'),
    ]));

    host.appendChild(el('p', {
      class: 'rc-hint',
      text: `${bookedDays} booked day(s) in this window, and ${sheetOnly} the 4WLA says are PTO with `
        + 'nothing booked against them. The second number is not a fault: the workbook is where '
        + 'most absences on this project are written down, and everything — the huddle, the week '
        + 'plan, Resources — already reads it as leave. Booking one makes a record that survives '
        + 'the sheet being edited, and an administrator can do it by clicking the day.',
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
            el('th', { text: 'As written' }), el('th', { text: 'Days' }), el('th', { text: 'On' }),
          ])]),
          el('tbody', {}, away.unmatched.map((u) => el('tr', {}, [
            el('td', { text: u.name }),
            el('td', { class: 'rc-num', text: String(u.days.size) }),
            el('td', { class: 'rc-hint', text: [...u.kinds].map((k) => ABSENCE_LABELS[k] || k).join(', ') }),
          ]))),
        ]),
      ]));
      host.appendChild(el('p', {
        class: 'rc-hint',
        text: 'These spellings are on the sheet’s PTO and Other Group rows and the roster cannot '
          + 'place them, so those days are not showing against anybody. It is the same answer a name '
          + 'on a Resource row gets and the same place to give it: Resources maps a spelling to a '
          + 'person in one click, and it is settled for both rows at once.',
      }));
    }

    /* ── Waiting on an answer ─────────────────────────────────────────────── */

    /* The point of a member being able to ask is that somebody answers.
       So the requests are a section of their own, above the record and not
       buried in it, and it is the *whole* register rather than the four weeks on
       screen: a request for October made today is a thing to answer today, and a
       window that only covered the weeks in view would hide it until it was too
       late to matter. An administrator answers here; the person who asked can
       withdraw while nobody has. */
    const pending = await rc.pendingLeave().catch(() => []);
    if (pending.length) {
      const peopleById = byId(people);
      host.appendChild(el('div', { style: 'height:20px' }));
      host.appendChild(el('div', { class: 'rc-section-head' }, [
        el('h3', { text: `Waiting on an answer (${pending.length})` }),
      ]));
      host.appendChild(el('div', { class: 'rc-scroll rc-pto-asks' }, [
        el('table', { class: 'rc-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Person' }), el('th', { text: 'From' }), el('th', { text: 'To' }),
            el('th', { text: 'Kind' }), el('th', { text: 'Asked' }), el('th', { text: '' }),
          ])]),
          el('tbody', {}, pending.map((l) => el('tr', {}, [
            el('td', {}, [
              el('div', { text: peopleById.get(l.person_id)?.name || '—' }),
              l.note ? el('div', { class: 'rc-hint', text: l.note }) : null,
            ].filter(Boolean)),
            el('td', { text: dayLabel(l.start_date, 'medium') }),
            el('td', { text: dayLabel(l.end_date, 'medium') }),
            el('td', { text: kindsById.get(l.kind_id)?.name || '—' }),
            el('td', { class: 'rc-hint', text: (l.created_at || '').slice(0, 10) }),
            el('td', {}, answerButtons(l, redraw, admin)),
          ]))),
        ]),
      ]));
      host.appendChild(el('p', {
        class: 'rc-hint',
        text: admin
          ? 'Approving one makes it leave everywhere at once — the calendar above, the week plan, '
            + 'the huddle — because it is the same row the whole time and the status is the only '
            + 'thing that changes. Nothing is copied into the 4WLA by this: put it on the sheet '
            + 'when the time comes, and the PTO row will then agree with the record.'
          : 'Yours are here until somebody answers them. Withdrawing one is the only change you '
            + 'can make to it, which is what stops a request approving itself.',
      }));
    }

    /* ── What is booked ───────────────────────────────────────────────────── */

    const booked = leave
      .filter((l) => l.status !== 'cancelled' && l.status !== 'declined')
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
            el('th', { text: 'Kind' }), el('th', { text: 'State' }), el('th', { text: '' }),
          ])]),
          el('tbody', {}, booked.map((l) => el('tr', {}, [
            el('td', { text: peopleById.get(l.person_id)?.name || '—' }),
            el('td', { text: dayLabel(l.start_date, 'medium') }),
            el('td', { text: dayLabel(l.end_date, 'medium') }),
            el('td', { text: kindsById.get(l.kind_id)?.name || '—' }),
            el('td', {}, [badge(l.status === 'approved' ? 'Approved'
              : l.status === 'requested' ? 'Requested' : l.status,
            l.status === 'approved' ? 'good' : 'warn')]),
            el('td', { class: 'rc-hint', text: l.note || '' }),
          ]))),
        ]),
      ]));
    }

    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'Leave is why the huddle can tell "away" apart from "carried over", and why absence is '
        + 'not silently distributed across the performance statuses. The full record, including '
        + 'cancelled leave and every kind, is in Organisation → Leave; this is the four weeks '
        + 'anybody is actually staffing.',
    }));
  }

  /**
   * What can be done about a request, by whoever is looking at it.
   *
   * An administrator answers it: approve or decline, one update either way. The
   * person who asked can withdraw it while nobody has answered, and that is the
   * only change they can make — the update policy pins a member to writing
   * `cancelled`, which is what stops a request approving itself. Anybody else gets
   * nothing, because there is nothing for them to do.
   *
   * Declining rather than deleting: "we said no on the 4th" is a thing the record
   * should be able to say, and a row that disappears cannot say it.
   */
  function answerButtons(row, redraw, admin) {
    const answer = async (status, said) => {
      try {
        await rc.updateLeave(row.id, { status });
        notifyChanged('leave');
        toast({ tone: 'good', message: said });
        redraw();
      } catch (err) {
        toast({ tone: 'bad', message: err?.message || String(err) });
      }
    };

    if (admin) {
      return [
        el('button', {
          class: 'cx-btn mini primary',
          text: 'Approve',
          title: 'It becomes leave everywhere at once — the same row, with the status changed.',
          onClick: () => answer('approved', 'Approved.'),
        }),
        el('button', {
          class: 'cx-btn mini ghost',
          text: 'Decline',
          title: 'Stays on the record as declined rather than disappearing.',
          onClick: () => answer('declined', 'Declined, and on the record as declined.'),
        }),
      ];
    }
    if (row.person_id === rc.me()?.id) {
      return [
        el('button', {
          class: 'cx-btn mini ghost',
          text: 'Withdraw',
          title: 'Takes the question back. Possible only while nobody has answered it.',
          onClick: () => answer('cancelled', 'Withdrawn.'),
        }),
      ];
    }
    return [];
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
  function bookLeave({ people, kinds, redraw, admin = rc.isAdmin(), person = null, from = '', to = '' }) {
    /* A member asks for their own days and nobody else's, which is what the
       insert policy checks — so the select holds the one name they could write
       rather than offering a list the database would refuse. */
    const mine = rc.me()?.id || null;
    const canAsk = admin ? people : people.filter((p) => p.id === mine);
    const who = selectInput({
      value: person?.id || canAsk[0]?.id,
      options: canAsk.map((p) => ({ value: p.id, label: p.name })),
      disabled: canAsk.length <= 1,
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
      title: admin
        ? (person ? `Book leave for ${person.name}` : 'Book leave')
        : 'Request leave',
      body: el('div', { class: 'cx-form' }, [
        field('Person', who),
        field('From', start),
        field('To', end, 'Inclusive, as a calendar is.'),
        field('Kind', kind),
        field('Note', note),
        el('p', {
          class: 'rc-hint',
          text: admin
            ? 'Everything already reads the 4WLA’s PTO row as leave. Booking it makes a record '
              + 'that survives somebody editing the sheet, and gives the day a kind and a status.'
            : 'This goes up as a request and shows as one until an administrator answers it. It is '
              + 'the same row either way — there is no separate list of requests, because that '
              + 'would be a second answer to whether you are off. You can withdraw it while it is '
              + 'still unanswered.',
        }),
      ]),
      confirmLabel: admin ? 'Book' : 'Request it',
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
        if (admin) await rc.addLeave(row);
        else await rc.requestLeave(row);
        notifyChanged('leave');
        toast({
          tone: 'good',
          message: admin
            ? 'Leave booked.'
            : 'Asked for. It shows as a request until an administrator answers it.',
        });
        redraw();
      },
    });
  }

  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
};

// ui/rc_reports.js
__mods["ui/rc_reports.js"] = function (__x, __req) {
  /**
   * Reports.
   *
   * Every record carries its own date, person, category and location, so a report
   * is a filter and an aggregation and nothing more. Arbitrary date ranges rather
   * than fixed monthly buckets — "back one year from today" has to be as easy as
   * "this month", which is what the relational store bought.
   *
   * Two things are deliberate and neither is a detail.
   *
   * **Nothing here is stored.** No efficiency column, no cached rollup. Every
   * number is computed on the way out, so refining a definition never means a
   * migration and no figure can go stale against the rows it came from.
   *
   * **Performance and project health are never averaged together.** Completed,
   * partial and carried are what somebody did; blocked and reassigned are what
   * was done to them. A possession released late is not underperformance, and
   * folding it in would make the number worse than useless — people would simply
   * stop saying they were blocked.
   *
   * Imports: util, rc, icons, components, rc_util.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { toast, badge, chipStat, emptyState, selectInput } = __req("ui/components.js");
  const { byId, dayLabel, todayISO, isoToMs, STATUS_BY_ID } = __req("ui/rc_util.js");
  const { saveFile } = __req("io/exporters.js");

  /** Ranges people actually ask for, plus the one that matters most: any. */
  const RANGES = [
    { id: '7', label: 'Last 7 days', days: 7 },
    { id: '30', label: 'Last 30 days', days: 30 },
    { id: '90', label: 'Last quarter', days: 90 },
    { id: '365', label: 'Last year', days: 365 },
    { id: 'custom', label: 'Custom…', days: 0 },
  ];

  let range = '30';
  let customFrom = '';
  let customTo = '';
  let groupBy = 'person';

  function window_() {
    const to = customTo || todayISO();
    if (range === 'custom' && customFrom) return { from: customFrom, to };
    const days = RANGES.find((r) => r.id === range)?.days || 30;
    const fromMs = isoToMs(todayISO()) - days * 86400000;
    return { from: new Date(fromMs).toISOString().slice(0, 10), to };
  }

  async function render(root) {
    if (!rc.isAdmin()) {
      // Not a hidden menu item: the view itself returns nothing to a member,
      // enforced by the policy. This only explains why.
      root.appendChild(emptyState({
        iconName: 'lock',
        title: 'Administrators only',
        message: 'Reports are restricted in the database. A member reading the view directly '
          + 'gets nothing back, so this is an explanation rather than the control.',
      }));
      return;
    }

    const { from, to } = window_();
    const [effort, people, categories, locations, chains, events] = await Promise.all([
      rc.listEffort(from, to),
      rc.listPeople({ includeInactive: true }),
      rc.listCategories({ includeInactive: true }),
      rc.listLocations({ includeInactive: true }),
      rc.listCarryChains(),
      rc.listChangeEvents(`${from}T00:00:00Z`, `${to}T23:59:59Z`),
    ]);

    root.appendChild(controls(root, from, to));

    /* The report is about the people who take shifts.
       A manager runs the meeting rather than taking work from it, so their own
       handful of rows sits in the middle of a table about field delivery,
       flattering or damning a number that was never about them. It is `scheduled`
       that decides and never the role — an administrator who *does* take shifts
       is in here exactly as before, which is the whole reason that column is
       separate from permission.
       The name lookup stays complete: filtering it as well would print "—"
       against a row rather than removing it. And the count of what was left out is
       said out loud, because a narrowed report that does not say it is narrowed
       reads as a report of everything. */
    const takesShifts = new Set(people.filter((p) => p.scheduled !== false).map((p) => p.id));
    const shown = effort.filter((r) => takesShifts.has(r.person_id));
    const setAside = effort.length - shown.length;

    if (!shown.length) {
      root.appendChild(el('p', {
        class: 'rc-hint',
        text: effort.length
          ? 'Nothing recorded in that range by anybody who takes shifts.'
          : 'Nothing recorded in that range.',
      }));
    } else {
      root.appendChild(summary(shown));
      root.appendChild(breakdown(shown, people, categories, locations));
    }

    if (setAside) {
      root.appendChild(el('p', {
        class: 'rc-hint',
        text: `${setAside} row(s) are not counted here: they belong to people who are not `
          + 'scheduled — the managers who run the calendar rather than take work from it. '
          + 'Somebody who does both is counted normally; Organisation is where that is set.',
      }));
    }

    root.appendChild(carryOver(chains.filter((c) => takesShifts.has(c.person_id)), people));
    root.appendChild(lookaheadNumbers(events));

    root.appendChild(el('p', {
      class: 'rc-hint',
      text: 'The two families are reported apart on purpose. Completed, partial and carried are '
        + 'what somebody did; blocked and reassigned are what was done to them. Averaging them '
        + 'together would flatter or damn the wrong party — and would teach people not to say '
        + 'when they were blocked.',
    }));
  }

  function controls(root, from, to) {
    const picker = selectInput({
      value: range,
      options: RANGES.map((r) => ({ value: r.id, label: r.label })),
      onChange: (v) => { range = v; clear(root); render(root); },
    });

    const grouping = selectInput({
      value: groupBy,
      options: [
        { value: 'person', label: 'By person' },
        { value: 'category', label: 'By category' },
        { value: 'location', label: 'By location' },
        { value: 'subsystem', label: 'By subsystem' },
      ],
      onChange: (v) => { groupBy = v; clear(root); render(root); },
    });

    const head = el('div', { class: 'rc-section-head' }, [
      el('h3', { text: `${dayLabel(from)} – ${dayLabel(to)}` }),
      picker,
      grouping,
      el('button', {
        class: 'cx-btn mini ghost',
        html: icon('download', { size: 12 }) + '<span>CSV</span>',
        onClick: () => exportCsv(from, to),
      }),
      rc.isAdmin() ? el('button', {
        class: 'cx-btn mini ghost',
        text: 'Back it up',
        title: 'Every table this account may read, as one JSON file.',
        onClick: () => backItUp(),
      }) : null,
    ].filter(Boolean));

    if (range === 'custom') {
      const fromEl = el('input', { type: 'date', class: 'cx-input mini', value: customFrom || from });
      const toEl = el('input', { type: 'date', class: 'cx-input mini', value: customTo || to });
      const apply = () => {
        customFrom = fromEl.value;
        customTo = toEl.value;
        clear(root);
        render(root);
      };
      fromEl.addEventListener('change', apply);
      toEl.addEventListener('change', apply);
      head.append(fromEl, toEl);
    }
    return head;
  }

  /* ── The numbers ───────────────────────────────────────────────────────── */

  function summary(effort) {
    const performance = effort.filter((e) => e.signal === 'performance');
    const health = effort.filter((e) => e.signal === 'health');
    const done = performance.filter((e) => e.status === 'completed').length;

    // A rate over the performance family only. Including blocked days would make
    // a team look worse for a possession somebody else lost.
    const rate = performance.length ? Math.round((done / performance.length) * 100) : 0;

    return el('div', { class: 'rc-section', style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      chipStat('Completed', `${rate}%`, rate >= 70 ? 'good' : rate >= 40 ? 'warn' : 'bad'),
      chipStat('Days recorded', performance.length, 'muted'),
      chipStat('Blocked', health.filter((e) => e.status === 'blocked').length, 'bad'),
      chipStat('Reassigned', health.filter((e) => e.status === 'reassigned').length, 'info'),
    ]);
  }

  function breakdown(effort, people, categories, locations) {
    const peopleById = byId(people);
    const catsById = byId(categories);
    const locsById = byId(locations);

    const keyOf = (row) => {
      if (groupBy === 'person') return peopleById.get(row.person_id)?.name || row.person_name || '—';
      if (groupBy === 'category') return catsById.get(row.category_id)?.name || 'Uncategorised';
      if (groupBy === 'location') return locsById.get(row.location_id)?.name || 'No location';
      return row.subsystem || '—';
    };

    const groups = new Map();
    for (const row of effort) {
      const key = keyOf(row);
      const g = groups.get(key) || { key, completed: 0, partial: 0, carried: 0, blocked: 0, reassigned: 0, total: 0 };
      if (g[row.status] !== undefined) g[row.status]++;
      if (row.signal === 'performance') g.total++;
      groups.set(key, g);
    }

    const rows = [...groups.values()]
      .sort((a, b) => b.total - a.total)
      .map((g) => el('tr', {}, [
        el('td', { text: g.key }),
        el('td', { class: 'rc-num', text: String(g.completed) }),
        el('td', { class: 'rc-num', text: String(g.partial) }),
        el('td', { class: 'rc-num', text: String(g.carried) }),
        el('td', { class: 'rc-num', text: g.total ? `${Math.round((g.completed / g.total) * 100)}%` : '—' }),
        el('td', { class: 'rc-num', text: String(g.blocked) }),
        el('td', { class: 'rc-num', text: String(g.reassigned) }),
      ]));

    return el('div', { class: 'rc-section' }, [
      el('div', { class: 'rc-scroll' }, [
        el('table', { class: 'rc-table rc-report', dataset: { csv: `outcomes-by-${groupBy}` } }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: groupBy[0].toUpperCase() + groupBy.slice(1) }),
              el('th', { text: 'Done' }), el('th', { text: 'Partial' }), el('th', { text: 'Carried' }),
              el('th', { text: 'Rate' }),
              el('th', { text: 'Blocked' }), el('th', { text: 'Reassigned' }),
            ]),
          ]),
          el('tbody', {}, rows),
        ]),
      ]),
    ]);
  }

  /**
   * Carried tasks, oldest first.
   *
   * The count is not the story — the *age* is. A chain counts once however many
   * days it ran, so one stuck job cannot produce five marks against one person,
   * and a task on its fifth day is the most informative line in the report.
   */
  function carryOver(chains, people) {
    const peopleById = byId(people);
    const section = el('div', { class: 'rc-section' }, [
      el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Still carrying' })]),
    ]);

    if (!chains.length) {
      section.appendChild(el('p', { class: 'rc-hint', text: 'Nothing carried over.' }));
      return section;
    }

    section.appendChild(el('div', { class: 'rc-scroll' }, [
      el('table', { class: 'rc-table rc-report', dataset: { csv: 'still-carrying' } }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Person' }), el('th', { text: 'First seen' }),
          el('th', { text: 'Days old' }), el('th', { text: 'Times carried' }),
        ])]),
        el('tbody', {}, chains.map((c) => el('tr', {}, [
          el('td', { text: peopleById.get(c.person_id)?.name || '—' }),
          el('td', { text: c.first_seen ? dayLabel(c.first_seen) : '—' }),
          el('td', {}, [badge(String(c.age_days), c.age_days >= 5 ? 'bad' : c.age_days >= 3 ? 'warn' : 'muted')]),
          el('td', { class: 'rc-num', text: String(c.carries) }),
        ]))),
      ]),
    ]));
    section.appendChild(el('p', {
      class: 'rc-hint',
      text: 'One chain per stuck task, however many days it ran — five days of the same job is one '
        + 'problem, not five failures. Ranked by age, which is the number worth acting on.',
    }));
    return section;
  }

  /**
   * The look-ahead's own numbers, kept apart from the team's.
   *
   * One measures BART's behaviour and one measures this team's. Reporting them
   * in one figure would attribute somebody else's cancellations to the people
   * who turned up for them.
   */
  function lookaheadNumbers(events) {
    const count = (kind) => events.filter((e) => e.kind === kind).length;
    return el('div', { class: 'rc-section' }, [
      el('div', { class: 'rc-section-head' }, [el('h3', { text: 'The look-ahead, same range' })]),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
        chipStat('Scope added', count('scope_added'), 'info'),
        chipStat('Scope removed', count('scope_removed'), 'warn'),
        chipStat('Cancelled', count('cancellation'), 'bad'),
        chipStat('Resources changed', count('resource_changed'), 'muted'),
      ]),
      el('p', {
        class: 'rc-hint',
        text: 'Weeks entering and leaving the four-week window are excluded — they are the window '
          + 'rolling forward, not scope moving, and counting them would add a batch of phantom '
          + 'changes every single week.',
      }),
    ]);
  }

  /* ── Export ────────────────────────────────────────────────────────────── */

  /**
   * The range, as CSV.
   *
   * Through `saveFile()` like every other export in the application, so the
   * download announces itself — a file that lands somewhere the page cannot see
   * is the one action with no visible result.
   */
  /**
   * Every table this account may read, as one file.
   *
   * The calendar's value is being the record a year from now, and there was no
   * way to get it out — a project deleted by accident left the provider's
   * point-in-time recovery and nothing else. Through `saveFile()` like every
   * other export here, so the download announces itself: a file that lands
   * somewhere the page cannot see is the one action with no visible result.
   */
  async function backItUp() {
    try {
      const data = await rc.exportEverything();
      const rows = Object.values(data.tables).reduce(
        (n, t) => n + (Array.isArray(t) ? t.length : 0), 0);
      saveFile(
        `resource-calendar-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(data, null, 2),
        'application/json',
        `${rows} rows across ${Object.keys(data.tables).length} tables`
      );
    } catch (err) {
      toast({ tone: 'bad', message: err.message });
    }
  }

  async function exportCsv(from, to) {
    try {
      const [effort, people, categories, locations] = await Promise.all([
        rc.listEffort(from, to),
        rc.listPeople({ includeInactive: true }),
        rc.listCategories({ includeInactive: true }),
        rc.listLocations({ includeInactive: true }),
      ]);
      const peopleById = byId(people);
      const catsById = byId(categories);
      const locsById = byId(locations);
      /* The same narrowing the screen makes. A CSV that disagreed with the table
         it was exported from would be the worse of the two to find out about. */
      const takesShifts = new Set(people.filter((p) => p.scheduled !== false).map((p) => p.id));

      const esc = (v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ['Date', 'Person', 'Subsystem', 'Status', 'Signal', 'Category', 'Location'];
      const lines = [header.join(',')];
      const rows = effort.filter((r) => takesShifts.has(r.person_id));
      for (const row of rows) {
        lines.push([
          row.work_date,
          peopleById.get(row.person_id)?.name || row.person_name || '',
          row.subsystem || '',
          STATUS_BY_ID.get(row.status)?.label || row.status,
          row.signal,
          catsById.get(row.category_id)?.name || '',
          locsById.get(row.location_id)?.name || '',
        ].map(esc).join(','));
      }

      saveFile(
        `resource-calendar-${from}-to-${to}.csv`,
        lines.join('\n'),
        'text/csv;charset=utf-8',
        `${rows.length} record(s)`
      );
    } catch (err) {
      toast({ tone: 'error', message: err.message });
    }
  }

  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
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
   * Imports: util, icons, exporters.
   */

  const { el } = __req("core/util.js");
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
      if (!x || !y) return (!x) - (!y);
      const cmp = collator.compare(x, y);
      return ascending ? cmp : -cmp;
    });
    body.append(...rows);
  }

  function csvCell(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCsv(table) {
    const lines = [];
    lines.push([...table.tHead.rows[0].cells].map((c) => csvCell(c.textContent)).join(','));
    for (const row of table.tBodies[0].rows) {
      lines.push([...row.cells].map((c) => csvCell(c.dataset.csv ?? c.textContent)).join(','));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const name = String(table.dataset.csv).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    saveFile(`${name}-${stamp}.csv`, lines.join('\r\n') + '\r\n', 'text/csv', 'Table');
  }

  Object.defineProperty(__x, "enhanceTables", { get: () => enhanceTables, enumerable: true });
  Object.defineProperty(__x, "enhanceTable", { get: () => enhanceTable, enumerable: true });
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
   * The account gate lives here rather than in `main.js`, and that is the point.
   * The timeline needs no account and must open with no network at all; only
   * this module does. So signing in is something that happens when you arrive at
   * the calendar, not something that happens before the application starts.
   *
   * Imports: util, events, rc, icons, components, and the tab modules.
   */

  const { el, clear } = __req("core/util.js");
  const { on, EV } = __req("core/events.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, toast, emptyState } = __req("ui/components.js");
  const roster = __req("ui/rc_roster.js");
  const huddle = __req("ui/rc_huddle.js");
  const lookahead = __req("ui/rc_lookahead.js");
  const week = __req("ui/rc_week.js");
  const pto = __req("ui/rc_pto.js");
  const reports = __req("ui/rc_reports.js");
  const { enhanceTables } = __req("ui/rc_table.js");

  /**
   * The tabs, in the order the work actually happens: run today's meeting, plan
   * the week, see who is off, see what the look-ahead did to it, then the numbers.
   *
   * **"Resources" is gone, folded into "Week plan".** They were people down and
   * days across in both cases, over the same `rc_plan_entries`, through the same
   * `assignmentIndex()` — the same table drawn twice with a different subtitle,
   * and each one missing something the other had.
   */
  const TABS = [
    { id: 'huddle', label: 'Daily huddle' },
    { id: 'week', label: 'Week plan' },
    { id: 'pto', label: 'PTO' },
    { id: 'lookahead', label: 'Look-ahead' },
    { id: 'reports', label: 'Reports' },
    { id: 'org', label: 'Organisation' },
  ];

  const RENDERERS = {
    huddle: huddle.render,
    week: week.render,
    pto: pto.render,
    lookahead: lookahead.render,
    reports: reports.render,
    org: roster.render,
  };

  let frame = null;
  let bodyEl = null;
  let headEl = null;
  let active = 'huddle';
  let started = false;

  /* ── Build ─────────────────────────────────────────────────────────────── */

  /**
   * Build the stage. Called once, by the workspace switch, on first use.
   *
   * Deliberately synchronous: it paints something immediately and then loads.
   * A blank rectangle while a network call decides what to draw is worse than a
   * message that says what is happening.
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
    // ui/rc_table.js. Watched rather than called, because tabs draw in stages
    // and a table can arrive long after render() has returned.
    let pendingEnhance = false;
    new MutationObserver(() => {
      if (pendingEnhance) return;
      pendingEnhance = true;
      queueMicrotask(() => {
        pendingEnhance = false;
        enhanceTables(bodyEl);
      });
    }).observe(bodyEl, { childList: true, subtree: true });

    // A row written anywhere reloads whatever is on screen. There is no document
    // and no diff here, so the cheapest correct thing is to re-read — the
    // volumes are a fortnight of one small team, not a project's worth of bars.
    on(EV.RC_CHANGED, () => render());
    on(EV.RC_AUTH_CHANGED, () => render());
    on(EV.RC_QUEUE_CHANGED, () => renderHead());

    render();
    init();
  }

  async function init() {
    try {
      await rc.init();
    } catch (err) {
      console.warn('[cx-timeline] resource calendar init failed:', err.message);
    }
    render();
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

    if (!rc.isConfigured()) {
      bodyEl.appendChild(notConfigured());
      return;
    }
    if (!rc.isSignedIn()) {
      bodyEl.appendChild(signInForm());
      return;
    }
    if (!rc.me()) {
      bodyEl.appendChild(notOnTheTeam());
      return;
    }

    const view = el('div');
    bodyEl.append(schemaBanner(), view);
    Promise.resolve(RENDERERS[active](view)).catch((err) => {
      rc.reportError(`tab:${active}`, err);
      clear(view);
      view.appendChild(loadFailed(err));
    });
  }

  function renderHead() {
    if (!headEl) return;
    clear(headEl);

    headEl.append(
      el('span', { class: 'rc-eyebrow', text: 'Resource Calendar' })
    );

    if (rc.isSignedIn() && rc.me()) {
      const tabs = el('div', { class: 'rc-tabs' });
      // Look-ahead and Reports are administrators-only in the database and
      // already say so. Showing them to a viewer offers a door that opens onto a
      // wall, so they come out of the row entirely.
      /* Reports and Organisation are an administrator's: the KPIs are a different
         audience and a different permission, and the roster, the locations and
         the accounts are the calendar's administration rather than its use. Both
         are restricted in the database as well — this only stops offering a door
         that opens onto a wall.
         The **look-ahead stays**, for everybody. It is what the field team is
         being asked to do, and while it was hidden the people named on it were
         the only people who could not look at it; they asked their manager to
         screenshot it instead. What they get is the calendar, read-only — the
         change register, the snapshots and the SARs are still the claim evidence
         and still administrators-only, in the policies. */
      /* The **daily huddle** joins them. It is the meeting: it asks a whole team
         in turn how yesterday went, and it is where an outcome is entered. A
         member has nothing to run and nothing to enter there but their own day,
         and what they need out of it — the status and the note recorded against
         their work — is now in the week plan, beside the rest of their week. */
      const ADMIN_ONLY = new Set(['huddle', 'reports', 'org']);
      const visible = rc.isAdmin() ? TABS : TABS.filter((t) => !ADMIN_ONLY.has(t.id));
      if (!visible.some((t) => t.id === active)) active = visible[0].id;
      for (const tab of visible) {
        tabs.appendChild(el('button', {
          class: 'rc-tab',
          type: 'button',
          text: tab.label,
          'aria-pressed': String(tab.id === active),
          onClick: () => showTab(tab.id),
        }));
      }
      headEl.appendChild(tabs);

      /* Leave waiting on an answer. The whole point of a member being able to ask
         is that somebody answers, and a request nobody is told about is a request
         that sits there — so it is on the chrome rather than only inside the tab,
         and it says how many and where to go. */
      if (rc.isAdmin()) headEl.appendChild(pendingLeaveChip());

      const pending = huddle.pendingCount();
      headEl.appendChild(el('span', {
        class: 'rc-queue',
        hidden: pending === 0,
        text: `${pending} unsynced`,
        title: 'Entered while offline. They will go up on their own when the connection returns.',
      }));

      if (rc.isViewer()) {
        headEl.appendChild(el('span', {
          class: 'rc-queue',
          style: 'background:var(--info-light);border-color:var(--info-border);color:var(--info)',
          text: 'Read only',
          title: 'You can see the schedule and what happened. Changing it is restricted in the database, not just here.',
        }));
      }

      headEl.appendChild(el('button', {
        class: 'cx-btn mini ghost',
        text: rc.accountLabel(),
        title: 'Sign out of the resource calendar',
        onClick: async () => {
          await rc.signOut();
          toast({ message: 'Signed out of the resource calendar.' });
        },
      }));
    }
  }

  /**
   * "Two people are waiting on you", on the chrome.
   *
   * A member can ask for leave now, and asking is only worth anything if somebody
   * answers — a request that nobody is told about is a request that sits in a tab
   * an administrator had no reason to open. So it is counted on the header, next
   * to the offline queue, and pressing it goes where the answer is given.
   *
   * Built empty and filled when the count arrives. The header is drawn
   * synchronously on every render and this is a network read: waiting for it would
   * hold up the tabs, and a chip that appears a moment later is exactly as useful.
   * A read that fails leaves it hidden, which is the same as none waiting — it is
   * a prompt, not a control, and the PTO tab is the record either way.
   */
  function pendingLeaveChip() {
    const chip = el('button', {
      class: 'rc-queue rc-queue-ask',
      hidden: true,
      type: 'button',
      title: 'Leave your team has asked for and nobody has answered. Answer it in PTO.',
      onClick: () => showTab('pto'),
    });
    rc.pendingLeave()
      .then((rows) => {
        const n = (rows || []).length;
        if (!n) return;
        chip.textContent = `${n} leave request${n === 1 ? '' : 's'}`;
        chip.hidden = false;
      })
      .catch(() => {});
    return chip;
  }

  /**
   * "The database is older than the application", said once, at the top.
   *
   * The site deploys on a push and the SQL is run by hand, so the two drift — and
   * the drift used to surface as a refused write on one screen weeks later,
   * worded as whatever that screen happened to be doing. `rc.schemaStatus()`
   * compares the stamp `rc_schema.sql` writes last with the version this build
   * expects. An administrator is told the two files to run and in what order,
   * because they are the one who can; everybody else is told that something may
   * not work and who can fix it, because a member cannot act on a filename.
   *
   * Built empty and filled when the answer arrives, like the leave chip, and
   * dismissible for the rest of the session — it is a notice, not a gate.
   */
  let schemaDismissed = false;
  function schemaBanner() {
    const box = el('div', { class: 'rc-schema-banner', role: 'status', hidden: true });
    rc.schemaStatus().then(({ state, expected, found }) => {
      if (state === 'current' || state === 'unknown') return;
      const behind = state === 'behind';
      // Hiding puts away "run the SQL", which somebody may reasonably defer; a
      // page older than its database is a different problem and is said again.
      if (behind && schemaDismissed) return;
      const title = behind
        ? `The calendar's database is behind this version of the application (database ${found || 'unversioned'}, application ${expected}).`
        : `This page is older than the calendar's database (page ${expected}, database ${found}).`;
      const detail = !behind
        ? 'Reload to pick up the newer version. On the desktop application, close and reopen it.'
        : rc.isAdmin()
          ? 'In the Supabase SQL editor, run supabase/migrate.sql and then supabase/rc_schema.sql. Both are safe to run more than once. Until then, some changes may be refused.'
          : 'Some changes may be refused until an administrator updates the database. Nothing you have entered is lost.';
      box.append(
        el('span', { class: 'rc-schema-icon', html: icon('warning', { size: 16 }) }),
        el('div', { class: 'rc-schema-text' }, [el('strong', { text: title }), el('span', { text: ` ${detail}` })]),
        el('button', {
          class: 'cx-btn mini ghost',
          type: 'button',
          text: behind ? 'Hide for now' : 'Reload',
          onClick: () => {
            if (!behind) {
              location.reload();
              return;
            }
            schemaDismissed = true;
            box.hidden = true;
          },
        })
      );
      box.hidden = false;
    }).catch(() => {});
    return box;
  }

  /* ── The states that are not the calendar ──────────────────────────────── */

  /**
   * No backend in this build.
   *
   * Not an error. A build can legitimately have the timeline and not this — that
   * is what every build has had until now — so it says what is missing and where
   * it is configured rather than pretending something broke.
   */
  function notConfigured() {
    return el('div', { class: 'rc-state' }, [
      el('div', { class: 'rc-state-icon', html: icon('database', { size: 32 }) }),
      el('h2', { text: 'No resource calendar in this build' }),
      el('p', {
        text: 'The timeline works as it always has. The resource calendar needs a '
          + 'Supabase project, named in config.js as rcSupabaseUrl and '
          + 'rcSupabaseAnonKey — separate from the timeline, which stays in your folder.',
      }),
    ]);
  }

  /**
   * Signed in to nothing yet.
   *
   * The form writes to the calendar's own client, which keeps its own session
   * under its own storage key. Signing in here does not sign you in to anything
   * the timeline uses, because the timeline uses nothing.
   */
  function signInForm() {
    /* An invitation link carries the address it was sent to, so somebody
       following one does not have to remember which of their addresses was
       invited — and lands on the right half of the form. */
    const invited = joiningAs();
    let joining = Boolean(invited);

    const email = textInput({ placeholder: 'you@example.com', type: 'email', value: invited || '' });
    const password = textInput({ placeholder: 'Password', type: 'password' });
    const error = el('div', { class: 'rc-error', hidden: true });
    const note = el('div', { class: 'rc-hint', hidden: true });
    const button = el('button', { class: 'cx-btn primary' });
    const swap = el('button', { class: 'cx-btn ghost mini' });
    const title = el('h2');
    const blurb = el('p');

    const paint = () => {
      title.textContent = joining ? 'Create your account' : 'Sign in to the resource calendar';
      blurb.textContent = joining
        ? 'Only an address an administrator has invited can create an account — the database '
          + 'refuses the rest, so there is nothing to guess at here.'
        : 'The timeline needs no account and is already open behind this. Only the calendar does.';
      button.textContent = joining ? 'Create account' : 'Sign in';
      password.placeholder = joining ? 'Choose a password' : 'Password';
      swap.textContent = joining ? 'I already have an account' : 'I was invited — create my account';
    };

    const submit = async () => {
      error.hidden = true;
      note.hidden = true;
      button.disabled = true;
      button.textContent = joining ? 'Creating…' : 'Signing in…';
      try {
        if (joining) {
          const { live } = await rc.signUp(email.value, password.value);
          if (!live) {
            // The project has email confirmation on, so the account exists but
            // the session does not. Saying so beats a form that looks stuck.
            note.textContent = 'Account created. Confirm your address from the email just sent, '
              + 'then sign in.';
            note.hidden = false;
            joining = false;
            paint();
            button.disabled = false;
            return;
          }
        } else {
          await rc.signIn(email.value, password.value);
        }
        render();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        button.disabled = false;
        paint();
      }
    };

    button.addEventListener('click', submit);
    swap.addEventListener('click', () => { joining = !joining; error.hidden = true; paint(); });
    for (const field of [email, password]) {
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
    }
    paint();

    return el('div', { class: 'rc-state' }, [
      el('div', { class: 'rc-state-icon', html: icon('users', { size: 32 }) }),
      title,
      blurb,
      el('div', { class: 'rc-signin' }, [email, password, error, note, button, swap]),
    ]);
  }

  /** The address an invitation link was sent to, from `#join=…`. */
  function joiningAs() {
    const match = /[#&?]join=([^&]+)/.exec(window.location.hash + window.location.search);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1]).trim();
    } catch {
      return '';
    }
  }

  /** An account that is not on the team. A real answer, not a failure. */
  function notOnTheTeam() {
    return el('div', { class: 'rc-state' }, [
      el('div', { class: 'rc-state-icon', html: icon('user', { size: 32 }) }),
      el('h2', { text: 'You are signed in, but not on this team' }),
      el('p', {
        text: 'An administrator adds people in Organisation. Until your account is '
          + 'linked to a team record, the database will not show you anything.',
      }),
      el('button', { class: 'cx-btn ghost', text: 'Sign out', onClick: () => rc.signOut() }),
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
