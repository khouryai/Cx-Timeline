/*!
 * CX Timeline — the resource calendar, loaded on first use.
 * GENERATED FILE — built by tools/build.js alongside app.bundle.js.
 * Modules: 25   Built: 2026-09-30T16:04:45.689Z
 */
(function () {
  'use strict';
  var registry = typeof window !== 'undefined' && window.__CX_MODULES;
  if (!registry) throw new Error('CX Timeline: calendar.bundle.js has to load after app.bundle.js');
  var __mods = registry.mods;

// ui/rc_gate.js
__mods["ui/rc_gate.js"] = function (__x, __req) {
  /**
   * The resource calendar's front door: the states that are not the calendar.
   *
   * No backend in this build, the sign-in and sign-up form, and an account that is
   * not on the team. They lived in `ui/rc.js`, and they moved out when the phone
   * app arrived — that module imports every tab, and through them the folder and
   * the exporters, none of which a phone may carry. Two copies of a sign-in form
   * would be two answers to "how does somebody join", so there is one, and each
   * interface hands it the sentence that is true of where it is drawn.
   *
   * Nothing here is the control. Who may create an account is
   * `rc_enforce_invitation()` on `auth.users`, and who may see what is the
   * policies; this explains the state to the person looking at it.
   *
   * Imports: util, rc, icons, components.
   */

  const { el } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { textInput } = __req("ui/components.js");

  /**
   * No backend in this build.
   *
   * Not an error. A build can legitimately have the timeline and not the calendar
   * — that is what every build had until the calendar existed — so it says what is
   * missing and where it is configured rather than pretending something broke.
   */
  function notConfigured({
    message = 'The timeline works as it always has. The resource calendar needs a '
      + 'Supabase project, named in config.js as rcSupabaseUrl and '
      + 'rcSupabaseAnonKey — separate from the timeline, which stays in your folder.',
  } = {}) {
    return el('div', { class: 'rc-state' }, [
      el('div', { class: 'rc-state-icon', html: icon('database', { size: 32 }) }),
      el('h2', { text: 'No resource calendar in this build' }),
      el('p', { text: message }),
    ]);
  }

  /**
   * Signed in to nothing yet.
   *
   * The form writes to the calendar's own client, which keeps its own session
   * under its own storage key. `onDone` runs once a session exists; `blurb` is
   * the line under the title when signing in, because what is true about the
   * rest of the application depends on which application this is.
   */
  function signInForm({
    onDone = () => {},
    blurb = 'The timeline needs no account and is already open behind this. Only the calendar does.',
  } = {}) {
    /* An invitation link carries the address it was sent to, so somebody
       following one does not have to remember which of their addresses was
       invited — and lands on the right half of the form. */
    const invited = joiningAs();
    let joining = Boolean(invited);

    const email = textInput({ placeholder: 'you@example.com', type: 'email', value: invited || '' });
    const password = textInput({ placeholder: 'Password', type: 'password' });
    email.autocomplete = 'username';
    const error = el('div', { class: 'rc-error', hidden: true });
    const note = el('div', { class: 'rc-hint', hidden: true });
    const button = el('button', { class: 'cx-btn primary' });
    const swap = el('button', { class: 'cx-btn ghost mini' });
    const title = el('h2');
    const lead = el('p');

    const paint = () => {
      title.textContent = joining ? 'Create your account' : 'Sign in to the resource calendar';
      lead.textContent = joining
        ? 'Only an address an administrator has invited can create an account — the database '
          + 'refuses the rest, so there is nothing to guess at here.'
        : blurb;
      button.textContent = joining ? 'Create account' : 'Sign in';
      password.placeholder = joining ? 'Choose a password' : 'Password';
      password.autocomplete = joining ? 'new-password' : 'current-password';
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
        onDone();
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
      lead,
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

  Object.defineProperty(__x, "notConfigured", { get: () => notConfigured, enumerable: true });
  Object.defineProperty(__x, "signInForm", { get: () => signInForm, enumerable: true });
  Object.defineProperty(__x, "joiningAs", { get: () => joiningAs, enumerable: true });
  Object.defineProperty(__x, "notOnTheTeam", { get: () => notOnTheTeam, enumerable: true });
};

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
  Object.defineProperty(__x, "lookaheadWithResources", { get: () => lookaheadWithResources, enumerable: true });
  Object.defineProperty(__x, "graftLocations", { get: () => graftLocations, enumerable: true });
  Object.defineProperty(__x, "graftResources", { get: () => graftResources, enumerable: true });
  Object.defineProperty(__x, "resourceAssignments", { get: () => resourceAssignments, enumerable: true });
  Object.defineProperty(__x, "nameResolver", { get: () => nameResolver, enumerable: true });
  Object.defineProperty(__x, "absenceAssignments", { get: () => absenceAssignments, enumerable: true });
  Object.defineProperty(__x, "shiftFor", { get: () => shiftFor, enumerable: true });
  Object.defineProperty(__x, "assignmentIndex", { get: () => assignmentIndex, enumerable: true });
  Object.defineProperty(__x, "outcomeLookup", { get: () => outcomeLookup, enumerable: true });
  Object.defineProperty(__x, "availability", { get: () => availability, enumerable: true });
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

  const { absenceKind, ABSENCE_LABELS, resourceNames } = __req("core/lookahead.js");

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
    return String(text ?? '')
      .split('.')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
  }

  function parseSupport(text, codes) {
    const known = new Set((codes || []).filter((c) => c.active !== false).map((c) => String(c.code).toUpperCase()));
    const tokens = supportTokens(text).map((code) => ({ code, known: known.has(code) }));
    return { tokens, unknown: [...new Set(tokens.filter((t) => !t.known).map((t) => t.code))] };
  }

  /** Tidy what was typed into the form the sheet writes: "x . wit" → "X.WIT". */
  function normaliseSupport(text) {
    const tokens = supportTokens(text);
    return tokens.length ? tokens.join('.') : '';
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
   */
  function cancellationKey(row) {
    const meta = metaValues(row);
    return {
      raw_label: meta.filter(Boolean).join(' · '),
      raw_location: row.location || '',
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
    const rows = model.rows.filter((r) => want.has(r.id)).sort((a, b) => (b.kind === 'resource') - (a.kind === 'resource'));
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

    const creates = restoreRows.sort((a, b) => ((a.set.kind === 'resource') - (b.set.kind === 'resource')));
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
      rows.push({ row: r, label: '', cells });
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
    return /^[A-Za-z]{1,6}(\s*\.\s*[A-Za-z]{1,6})*\.?$/.test(t) ? normaliseSupport(t) : t;
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
   */
  function describeCellValue(value, meaningOf = () => '') {
    if (!value) return 'empty';
    const colour = value.color ? (meaningOf(value.color) || `#${value.color}`) : '';
    return [colour, value.text].filter(Boolean).join(' · ') || 'empty';
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
  Object.defineProperty(__x, "staffingIssues", { get: () => staffingIssues, enumerable: true });
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

// ui/rc_inbox.js
__mods["ui/rc_inbox.js"] = function (__x, __req) {
  /**
   * The administrator's inbox — everything waiting on an administrator, in one
   * list.
   *
   * None of it is new information. Leave requests are in PTO, names the roster
   * cannot place are in the week plan, unmapped colours in Legend, cancellations
   * without a reason in the log, unowned blockers in the huddle, unanswered
   * invitations in Accounts. Five screens, each of which somebody had to think to
   * open. This reads the same sources and lists what is outstanding, each item a
   * press from the screen that answers it — and a leave request is answered
   * right here, because that is one button either way.
   *
   * Every source is read on its own and a failed read is reported as a line of
   * its own, never as an empty inbox: "nothing is waiting" and "I could not
   * look" are different answers, and only one of them lets somebody stop
   * worrying.
   *
   * Reads only, apart from answering leave. What an administrator may do is
   * still decided in Postgres; this is where they are told there is something
   * to do.
   *
   * Imports: util, rc, core/lookahead, core/la_edit, icons, components, rc_util,
   *          rc_la_state.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { cancellationEvents, attachCancellationNotes, changesForMe } = __req("core/lookahead.js");
  const ed = __req("core/la_edit.js");
  const { icon } = __req("ui/icons.js");
  const { toast, badge, emptyState } = __req("ui/components.js");
  const { notifyChanged, goToTab, dayLabel, todayISO, orgNav, nameRegister, resourceAssignments, absenceAssignments, lookaheadWithResources, locationRegister, unmatchedLocations, personMatcher } = __req("ui/rc_util.js");



  const { la } = __req("ui/rc_la_state.js");

  /* ── Where each item is answered ───────────────────────────────────────── */

  function openOrg(section) {
    orgNav.section = section;
    goToTab('org');
  }

  function openLookahead(section) {
    la.section = section;
    la.sectionChosen = true;
    goToTab('lookahead');
  }

  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  /* ── Reading ───────────────────────────────────────────────────────────── */

  /**
   * What is waiting, as `[{ id, area, tone, title, detail, actions }]` — each
   * action `{ label, run, primary? }`. Grouped where one answer settles many
   * (every unplaceable name is one visit to the week plan), itemised where each
   * is its own decision (every leave request).
   */
  async function inboxItems() {
    const today = todayISO();
    const monday = ed.mondayOf(today);
    const horizon = ed.addDaysISO(monday, 5 * 7 - 1);
    const items = [];
    const failed = [];
    const attempt = async (area, fn) => {
      try {
        await fn();
      } catch (err) {
        failed.push({ area, message: err?.message || String(err) });
      }
    };

    const [people, kinds] = await Promise.all([
      rc.listPeople({ includeInactive: true }).catch(() => []),
      rc.listLeaveKinds().catch(() => []),
    ]);
    const personName = (id) => people.find((p) => p.id === id)?.name || 'Somebody';
    const kindName = (id) => kinds.find((k) => k.id === id)?.name || 'leave';

    await Promise.all([
      /* Leave asked for. Each one is a decision, so each one is an item. */
      attempt('Leave requests', async () => {
        for (const l of await rc.pendingLeave()) {
          const span = l.start_date === l.end_date
            ? dayLabel(l.start_date)
            : `${dayLabel(l.start_date)} – ${dayLabel(l.end_date)}`;
          items.push({
            id: `leave:${l.id}`,
            area: 'Leave',
            tone: 'warn',
            title: `${personName(l.person_id)} asked for ${kindName(l.kind_id)}`,
            detail: [span, l.note].filter(Boolean).join(' · '),
            actions: [
              { label: 'Approve', primary: true, run: () => answerLeave(l, 'approved') },
              { label: 'Decline', run: () => answerLeave(l, 'declined') },
            ],
          });
        }
      }),

      /* Names and places on the look-ahead the registers cannot place. */
      attempt('Names and locations', async () => {
        const [aliases, locations, locAliases, sheet] = await Promise.all([
          rc.listPersonAliases().catch(() => []),
          rc.listLocations({ includeInactive: true }).catch(() => []),
          rc.listLocationAliases().catch(() => []),
          lookaheadWithResources(monday, horizon),
        ]);
        const register = nameRegister(people, aliases);
        const names = [
          ...resourceAssignments(sheet.rows, register).unmatched,
          ...absenceAssignments(sheet.absences, register).unmatched,
        ];
        const unique = [...new Map(names.map((n) => [n.name.toLowerCase(), n])).values()];
        if (unique.length) {
          items.push({
            id: 'names',
            area: 'Look-ahead',
            tone: 'warn',
            title: `${plural(unique.length, 'name')} on the look-ahead ${unique.length === 1 ? 'matches' : 'match'} nobody on the roster`,
            detail: unique.slice(0, 8).map((n) => `"${n.name}"`).join(', ') + (unique.length > 8 ? ` and ${unique.length - 8} more` : '')
              + ' — say who each one is once, and it is settled.',
            actions: [{ label: 'Answer in Week plan', primary: true, run: () => goToTab('week') }],
          });
        }
        const places = unmatchedLocations(sheet.rows, locationRegister(locations, locAliases));
        if (places.length) {
          items.push({
            id: 'locations',
            area: 'Look-ahead',
            tone: 'info',
            title: `${plural(places.length, 'location')} on the look-ahead ${places.length === 1 ? 'is' : 'are'} not on the register`,
            detail: places.slice(0, 8).map((p) => `"${p.name}"`).join(', ') + ' — add each as a location, or as another spelling of one.',
            actions: [{ label: 'Open Locations', primary: true, run: () => openOrg('locations') }],
          });
        }
      }),

      /* Colours on the sheet the legend does not explain. */
      attempt('Legend', async () => {
        const [meta] = await rc.listSnapshotMeta({ limit: 1 });
        const n = Number(meta?.unmapped_count || 0);
        if (n) {
          items.push({
            id: 'colours',
            area: 'Look-ahead',
            tone: 'warn',
            title: `${plural(n, 'colour')} on the look-ahead ${n === 1 ? 'means' : 'mean'} nothing yet`,
            detail: 'Until the legend says what it is, a painted day in that colour is drawn as possible work and counted as nothing.',
            actions: [{ label: 'Open Legend', primary: true, run: () => openLookahead('legend') }],
          });
        }
      }),

      /* Support codes typed that nobody registered — the editor's own sheet. */
      attempt('Support codes', async () => {
        const settings = await rc.listSettings().catch(() => []);
        if (settings.find((r) => r.key === 'lookahead_source')?.value !== 'editor') return;
        const [rows, cells, codes] = await Promise.all([
          rc.listLaRows(),
          rc.listLaCells(monday, horizon),
          rc.listSupportCodes({ includeRetired: true }),
        ]);
        const activities = new Set(rows.filter((r) => r.kind === 'activity' && !r.archived).map((r) => r.id));
        const unknown = new Set();
        for (const c of cells) {
          if (!activities.has(c.row_id) || !c.text) continue;
          if (!/^[A-Za-z0-9]{1,8}(\.[A-Za-z0-9]{1,8})*$/.test(String(c.text).trim())) continue;
          for (const u of ed.parseSupport(c.text, codes).unknown) unknown.add(u);
        }
        if (unknown.size) {
          items.push({
            id: 'codes',
            area: 'Look-ahead',
            tone: 'info',
            title: `${plural(unknown.size, 'support code')} on the look-ahead ${unknown.size === 1 ? 'is' : 'are'} not registered`,
            detail: `${[...unknown].join(', ')} — kept exactly as typed, and marked in the editor until somebody says what ${unknown.size === 1 ? 'it asks' : 'they ask'} for.`,
            actions: [{ label: 'Open Legend', primary: true, run: () => openLookahead('legend') }],
          });
        }
      }),

      /* Cancellations nobody has said anything about. */
      attempt('Cancellations', async () => {
        const settings = await rc.listSettings().catch(() => []);
        const from = settings.find((x) => x.key === 'cancellation_log_from')?.value || `${today.slice(0, 4)}-09-01`;
        const [days, notes] = await Promise.all([rc.listCancelledDays(from), rc.listCancellationNotes().catch(() => [])]);
        const open = attachCancellationNotes(cancellationEvents(days, { from }), notes).filter((e) => !e.note);
        if (open.length) {
          items.push({
            id: 'cancellations',
            area: 'Look-ahead',
            tone: 'bad',
            title: `${plural(open.length, 'cancellation')} with no reason yet`,
            detail: open.slice(0, 4).map((e) => `${e.label || 'An activity'} (${dayLabel(e.start)})`).join('; ')
              + (open.length > 4 ? `; and ${open.length - 4} more` : '')
              + ' — the log is the claim, and a cancellation with no party is one nobody can argue.',
            actions: [{ label: 'Open the log', primary: true, run: () => openLookahead('cancellations') }],
          });
        }
      }),

      /* Blocked days nobody has taken on. */
      attempt('Blockers', async () => {
        const blockers = (await rc.listBlockers()).filter((b) => !b.owner_id);
        for (const b of blockers.slice(0, 10)) {
          items.push({
            id: `blocker:${b.id}`,
            area: 'Huddle',
            tone: 'bad',
            title: `Blocked, and nobody owns it: ${b.summary || 'no summary'}`,
            detail: `Raised by ${personName(b.person_id)} ${b.age_days != null ? `${plural(Number(b.age_days), 'day')} ago` : ''}`.trim(),
            actions: [{ label: 'Open the huddle', primary: true, run: () => goToTab('huddle') }],
          });
        }
      }),

      /* Invitations sent and not yet taken up. */
      attempt('Invitations', async () => {
        const pending = await rc.listInvitations();
        const expired = pending.filter((i) => i.pending_expired);
        const waiting = pending.filter((i) => !i.pending_expired);
        if (expired.length) {
          items.push({
            id: 'invites:expired',
            area: 'Accounts',
            tone: 'warn',
            title: `${plural(expired.length, 'invitation')} expired before ${expired.length === 1 ? 'it was' : 'they were'} used`,
            detail: expired.map((i) => i.pending_email).join(', '),
            actions: [{ label: 'Open Accounts', primary: true, run: () => openOrg('accounts') }],
          });
        }
        if (waiting.length) {
          items.push({
            id: 'invites:waiting',
            area: 'Accounts',
            tone: 'info',
            title: `${plural(waiting.length, 'invitation')} not accepted yet`,
            detail: waiting.map((i) => i.pending_email).join(', '),
            actions: [{ label: 'Open Accounts', run: () => openOrg('accounts') }],
          });
        }
      }),

      /* Changes to somebody's days they have not seen yet. My day shows each
         person what changed for them since their last "Got it"; this is the
         other side of it — who has not looked. Only people with an account can
         look, and an administrator is the one making the changes. */
      attempt('Changes to people\'s days', async () => {
        const [latest] = await rc.listSnapshotMeta({ limit: 1 });
        if (!latest) return;
        const [seenRows, aliases] = await Promise.all([rc.listSeen(), rc.listPersonAliases().catch(() => [])]);
        const team = people.filter((p) => p.active && p.user_id && p.role !== 'admin');
        if (!team.length) return;
        const newest = new Map();
        for (const row of seenRows) {
          const held = newest.get(row.person_id);
          if (!held || String(row.seen_at) > String(held.seen_at)) newest.set(row.person_id, row);
        }
        const register = nameRegister(people, aliases);
        const rowsOf = new Map();
        const rowsFor = async (id) => {
          if (!rowsOf.has(id)) rowsOf.set(id, await rc.snapshotRows(id));
          return rowsOf.get(id);
        };
        const after = await rowsFor(latest.id);
        const to = ed.addDaysISO(today, 27);
        const behind = [];
        const never = [];
        for (const p of team) {
          const seen = newest.get(p.id);
          if (!seen) { never.push(p.name); continue; }
          if (!seen.snapshot_id || seen.snapshot_id === latest.id) continue;
          const before = await rowsFor(seen.snapshot_id);
          if (!before.length) continue;
          const n = changesForMe(before, after, personMatcher(register, p.id), { from: today, to }).length;
          if (n) behind.push({ name: p.name, n });
        }
        if (behind.length) {
          items.push({
            id: 'unseen',
            area: 'Team',
            tone: 'warn',
            title: `${plural(behind.length, 'person has', 'people have')} changes to their days they have not seen`,
            detail: behind.map((b) => `${b.name} (${b.n})`).join(', ')
              + ' — they see them at the top of My day, with Got it.',
            actions: [],
          });
        }
        if (never.length) {
          items.push({
            id: 'unseen:never',
            area: 'Team',
            tone: 'info',
            title: `${plural(never.length, 'person has', 'people have')} not opened My day yet`,
            detail: never.join(', '),
            actions: [],
          });
        }
      }),

      /* Something broke on somebody's screen in the last week. */
      attempt('Problems', async () => {
        const since = Date.now() - 7 * 86400000;
        const recent = (await rc.listClientErrors(50)).filter((e) => Date.parse(e.created_at) >= since);
        if (recent.length) {
          items.push({
            id: 'problems',
            area: 'Problems',
            tone: 'info',
            title: `${plural(recent.length, 'problem')} reported this week`,
            detail: [...new Set(recent.map((e) => e.area))].slice(0, 5).join(', '),
            actions: [{ label: 'Open Problems', run: () => openOrg('problems') }],
          });
        }
      }),

      /* The database older than the application. */
      attempt('Database', async () => {
        const { state, expected, found } = await rc.schemaStatus();
        if (state === 'behind') {
          items.push({
            id: 'schema',
            area: 'Database',
            tone: 'bad',
            title: 'The calendar\'s database needs updating',
            detail: `Database ${found || 'unversioned'}, application ${expected}. In the Supabase SQL editor, run supabase/migrate.sql and then supabase/rc_schema.sql.`,
            actions: [],
          });
        }
      }),
    ]);

    const order = { bad: 0, warn: 1, info: 2 };
    items.sort((a, b) => order[a.tone] - order[b.tone]);
    return { items, failed };
  }

  async function answerLeave(row, status) {
    try {
      await rc.updateLeave(row.id, { status });
      toast({ tone: 'good', message: status === 'approved' ? 'Approved.' : 'Declined, and on the record as declined.' });
      notifyChanged('leave');
    } catch (err) {
      toast({ tone: 'bad', message: err?.message || String(err) });
    }
  }

  /**
   * How many things are waiting — for the badge on the Organisation tab.
   *
   * The header is redrawn on every write, and the inbox reads a dozen sources;
   * so the count is remembered for a minute. Opening the inbox itself always
   * reads afresh, and refreshes this.
   */
  let counted = null; // { at, n }
  async function inboxCount() {
    if (counted && Date.now() - counted.at < 60000) return counted.n;
    const { items } = await inboxItems();
    counted = { at: Date.now(), n: items.length };
    return counted.n;
  }

  /* ── Drawing ───────────────────────────────────────────────────────────── */

  async function renderInbox(host) {
    host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Waiting on you' })]));
    const body = el('div', { class: 'rc-inbox', 'aria-busy': 'true' }, [
      el('p', { class: 'rc-hint', text: 'Looking through leave, the look-ahead, blockers and accounts…' }),
    ]);
    host.appendChild(body);

    const { items, failed } = await inboxItems();
    counted = { at: Date.now(), n: items.length };
    clear(body);
    body.removeAttribute('aria-busy');

    if (!items.length && !failed.length) {
      body.appendChild(emptyState({
        iconName: 'check',
        title: 'Nothing is waiting on you',
        message: 'No leave to answer, nothing on the look-ahead the registers cannot place, no cancellation without a reason and no blocker without an owner.',
      }));
      return;
    }

    const list = el('ul', { class: 'rc-inbox-list', 'aria-label': 'Waiting on you' });
    for (const item of items) {
      list.appendChild(el('li', { class: `rc-inbox-item rc-inbox-${item.tone}`, dataset: { id: item.id } }, [
        el('span', { class: 'rc-inbox-area' }, [badge(item.area, item.tone)]),
        el('div', { class: 'rc-inbox-text' }, [
          el('div', { class: 'rc-inbox-title', text: item.title }),
          item.detail ? el('div', { class: 'rc-inbox-detail', text: item.detail }) : null,
        ].filter(Boolean)),
        el('div', { class: 'rc-inbox-actions' }, item.actions.map((a) => el('button', {
          class: `cx-btn mini${a.primary ? ' primary' : ' ghost'}`,
          type: 'button',
          text: a.label,
          onClick: () => a.run(),
        }))),
      ]));
    }
    body.appendChild(list);

    for (const f of failed) {
      body.appendChild(el('p', { class: 'rc-hint rc-inbox-failed' }, [
        el('span', { html: icon('alert', { size: 12 }), 'aria-hidden': 'true' }),
        el('span', { text: ` Could not check ${f.area.toLowerCase()}: ${f.message}` }),
      ]));
    }
  }

  Object.defineProperty(__x, "inboxItems", { get: () => inboxItems, enumerable: true });
  Object.defineProperty(__x, "inboxCount", { get: () => inboxCount, enumerable: true });
  Object.defineProperty(__x, "renderInbox", { get: () => renderInbox, enumerable: true });
};

// ui/rc_settings.js
__mods["ui/rc_settings.js"] = function (__x, __req) {
  /**
   * Organisation → Settings: the calendar's settings, changed on screen.
   *
   * They were always rows in `rc_settings`, and some could only be changed in the
   * SQL editor — which meant they were not changed. Each is one field and a Save,
   * written through `rc.setSetting()`, and the policy on `rc_settings` is what
   * lets only an administrator write them; this screen is only shown to one.
   *
   * Switching the look-ahead's source is the one setting with consequences, so
   * it is not a field: going back to the workbook asks first, exactly as the
   * editor's own menu does, and adopting the editor goes to the editor, which
   * has to import something before there is anything to write in.
   *
   * Imports: util, rc, components, rc_util, rc_la_state.
   */

  const { el } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { textInput, toast, confirmDialog, badge } = __req("ui/components.js");
  const { notifyChanged, goToTab, dayLabel } = __req("ui/rc_util.js");
  const { la } = __req("ui/rc_la_state.js");

  /** How long an editor-published reading is kept whole, unless somebody says otherwise. */
  const DEFAULT_KEEP_DAYS = 60;

  const value = (settings, key) => settings.find((r) => r.key === key)?.value ?? null;

  async function renderSettings(host) {
    const settings = await rc.listSettings().catch(() => []);
    const source = value(settings, 'lookahead_source') || 'workbook';

    host.appendChild(el('div', { class: 'rc-section-head' }, [el('h3', { text: 'Settings' })]));
    host.appendChild(el('p', {
      class: 'rc-hint',
      text: 'What the calendar is set to. Only an administrator can change these — the database refuses anybody else.',
    }));

    const list = el('div', { class: 'rc-settings' });
    host.appendChild(list);

    /* ── The look-ahead ─────────────────────────────────────────────────── */
    list.appendChild(group('The look-ahead'));

    list.appendChild(row({
      label: 'Where it is written',
      hint: source === 'editor'
        ? 'In the calendar\'s own editor. "Check now" does not read the workbook while this is set.'
        : 'In the Excel workbook, read on "Check now". Start writing it in the calendar from Look-ahead → Calendar → Edit.',
      control: el('div', { class: 'rc-settings-inline' }, [
        badge(source === 'editor' ? 'The editor' : 'The workbook', source === 'editor' ? 'good' : 'neutral'),
        source === 'editor'
          ? el('button', {
            class: 'cx-btn mini ghost danger', type: 'button', text: 'Go back to the workbook…',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Go back to reading the workbook?',
                message: 'The calendar will read the .xlsx again the next time somebody presses Check now. '
                  + 'Nothing written in the editor is deleted — it stays for the record, and you can come back to it.',
                confirmLabel: 'Go back to the workbook',
                danger: true,
              });
              if (!ok) return;
              await save('lookahead_source', 'workbook', 'The look-ahead is read from the workbook again.');
              la.source = 'workbook';
              la.section = 'calendar';
              la.editing = false;
            },
          })
          : el('button', {
            class: 'cx-btn mini', type: 'button', text: 'Open the editor',
            onClick: () => {
              la.section = 'calendar';
              la.editing = true;
              la.sectionChosen = true;
              goToTab('lookahead');
            },
          }),
      ]),
    }));

    list.appendChild(textRow({
      key: 'lookahead_title',
      label: 'Title on the export',
      hint: 'Printed across the top of the Excel export.',
      current: value(settings, 'lookahead_title') || '',
      placeholder: 'Four Week Look-Ahead',
      said: (v) => (v ? `The export is titled "${v}".` : 'The export has no title.'),
    }));

    list.appendChild(textRow({
      key: 'lookahead_sheet',
      label: 'Sheet in the workbook',
      hint: 'The tab the grid is on, when the look-ahead is read from the workbook. Never guessed.',
      current: value(settings, 'lookahead_sheet') || '4WLA',
      placeholder: '4WLA',
      required: true,
      said: (v) => `The workbook is read from the "${v}" sheet.`,
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
      hint: 'The editor publishes a reading whenever it goes quiet. Older than this, only the last reading of each day is kept; '
        + 'every workbook read, every reading a SAR or a cancellation points at, and the change register are kept regardless.',
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

    /* ── What this is ───────────────────────────────────────────────────── */
    list.appendChild(group('About'));
    const status = await rc.schemaStatus().catch(() => ({ state: 'unknown' }));
    list.appendChild(row({
      label: 'Database version',
      hint: status.state === 'behind'
        ? 'Behind this application. Run supabase/migrate.sql and then supabase/rc_schema.sql in the Supabase SQL editor.'
        : 'Set by rc_schema.sql when it is run.',
      control: el('div', { class: 'rc-settings-inline' }, [
        el('span', { class: 'rc-settings-mono', text: String(status.found ?? value(settings, 'schema_version') ?? '—') }),
        status.state === 'behind' ? badge('Needs updating', 'bad') : null,
      ].filter(Boolean)),
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
   * Imports: util, events, dates, rc, icons, components, rc_util, rc_inbox,
   *          rc_settings.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { textInput, selectInput, toast, confirmDialog, promptDialog, field, badge, checkbox, emptyState } = __req("ui/components.js");


  const { notifyChanged, byId, dayLabel, todayISO, formModal, orgNav } = __req("ui/rc_util.js");
  const { renderInbox } = __req("ui/rc_inbox.js");
  const { renderSettings } = __req("ui/rc_settings.js");

  const SECTIONS = ['inbox', 'people', 'locations', 'categories', 'leave', 'accounts', 'problems', 'settings'];
  // Readable by an administrator alone, in the policies as well as here.
  const ADMIN_SECTIONS = new Set(['inbox', 'accounts', 'problems', 'settings']);
  // An administrator opens Organisation on what is waiting for them.
  let section = null;

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

    if (section === 'inbox') await renderInbox(host);
    else if (section === 'settings') await renderSettings(host);
    else if (section === 'people') await renderPeople(host);
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
  const { STATUSES, STATUS_BY_ID, SHIFTS, shiftLabel, weekStart, todayISO, isoToMs, dayLabel, byId, availability, notifyChanged, formModal, nameRegister, lookaheadWithResources, assignmentIndex } = __req("ui/rc_util.js");





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
      // Refused because an administrator is only previewing: nothing to replay.
      if (err?.preview) return { sent: false, error: err };
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
              task.shift && task.shift !== 'day' ? shiftLabel(task.shift) : null].filter(Boolean).join(' · ') }),
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
    if (!sent) toast({ tone: 'warn', message: error?.preview ? error.message : `Saved locally — ${error.message}` });

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
        if (!sent) toast({ tone: 'warn', message: error?.preview ? error.message : `Saved locally — ${error.message}` });

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

// ui/rc_myday.js
__mods["ui/rc_myday.js"] = function (__x, __req) {
  /**
   * My day — the calendar for one person: today, the next working day, and the
   * rest of the week at a glance.
   *
   * Everything else in the calendar is about the team: a grid of people down and
   * days across, a meeting that goes round the room. Somebody opening it on a
   * phone at six in the morning wants one answer — where am I today, on what,
   * with whom, and what about tomorrow — and had to find their own row to get it.
   *
   * It is a reading, not a second plan. The day comes from `assignmentIndex()`,
   * the same function the week plan and the huddle read, so the 4WLA's names rows
   * are the plan for the days they name and a stored entry is somebody overriding
   * it. **Outcomes are shown, not recorded:** the huddle is the one path an
   * outcome is entered through, and a second one here would be two that could
   * disagree on screen. What was recorded against your last day is shown, as the
   * week plan shows it.
   *
   * Imports: util, dates, rc, core/lookahead, icons, components, rc_util,
   *          rc_activity.
   */

  const { el } = __req("core/util.js");
  const { toISO, addDays } = __req("core/dates.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { badge, emptyState } = __req("ui/components.js");
  const { openActivity } = __req("ui/rc_activity.js");
  const { byId, dayLabel, todayISO, isoToMs, weekStart, goToTab, STATUS_BY_ID, SHIFTS, nameRegister, assignmentIndex, availability, lookaheadWithResources, meMatcher, notifyChanged } = __req("ui/rc_util.js");



  const { changesForMe } = __req("core/lookahead.js");

  const ABSENCE_WORDS = { pto: 'Off — on the PTO row', office: 'In the office', other: 'On another project' };

  /** The next day this person works, after `iso`. */
  function nextWorkingDay(person, iso) {
    const working = Array.isArray(person?.working_days) ? person.working_days : [1, 2, 3, 4, 5];
    let ms = addDays(isoToMs(iso), 1);
    for (let i = 0; i < 14; i++) {
      const weekday = new Date(ms).getUTCDay() || 7;
      if (working.includes(weekday)) return toISO(ms);
      ms = addDays(ms, 1);
    }
    return toISO(addDays(isoToMs(iso), 1));
  }

  async function render(root) {
    const who = rc.me();
    const today = todayISO();
    const monday = toISO(weekStart(isoToMs(today)));

    const [everybody, aliases] = await Promise.all([
      rc.listPeople({ includeInactive: true }).catch(() => []),
      rc.listPersonAliases().catch(() => []),
    ]);
    const person = everybody.find((p) => p.id === who?.id) || who;
    const next = nextWorkingDay(person, today);
    // The week and whatever the next working day reaches into.
    const until = [toISO(addDays(isoToMs(monday), 6)), next].sort().pop();

    const [planRows, sheet, leave, actuals, locations, categories, blockers] = await Promise.all([
      rc.listPlan(monday, until).catch(() => []),
      lookaheadWithResources(monday, toISO(addDays(weekStart(isoToMs(until)), 6))).catch(() => ({ rows: [], absences: [] })),
      rc.listLeave(monday, until).catch(() => []),
      rc.listActuals(toISO(addDays(isoToMs(today), -14)), today).catch(() => []),
      rc.listLocations({ includeInactive: true }).catch(() => []),
      rc.listCategories().catch(() => []),
      rc.listBlockers().catch(() => []),
    ]);

    const index = assignmentIndex({
      planRows,
      laRows: sheet.rows,
      absences: sheet.absences,
      categories,
      register: nameRegister(everybody, aliases),
    });
    const locs = byId(locations);
    const names = byId(everybody);

    const laRowById = new Map((sheet.rows || []).map((r) => [r.id, r]));
    const ctx = { person, index, leave, locs, names, planRows, laRowById };

    /* ── Greeting ─────────────────────────────────────────────────────── */
    const first = String(person?.name || '').trim().split(/\s+/)[0] || 'there';
    root.appendChild(el('div', { class: 'rc-myday-head' }, [
      el('div', {}, [
        el('div', { class: 'rc-eyebrow', text: dayLabel(today, 'dayFull') }),
        el('h2', { class: 'rc-myday-hello', text: `${greeting()}, ${first}` }),
      ]),
      el('button', {
        class: 'cx-btn mini ghost', type: 'button',
        html: `${icon('calendar', { size: 12 })}<span>My week plan</span>`,
        onClick: () => goToTab('week'),
      }),
    ]));

    root.appendChild(changesPanel());

    const cards = el('div', { class: 'rc-myday-cards' }, [
      dayCard(ctx, today, 'Today'),
      dayCard(ctx, next, next === toISO(addDays(isoToMs(today), 1)) ? 'Tomorrow' : `Next working day`),
    ]);
    root.appendChild(cards);

    /* ── The week at a glance ─────────────────────────────────────────── */
    root.appendChild(weekStrip(ctx, monday, today));

    /* ── What was said about your last day ────────────────────────────── */
    const mine = actuals
      .filter((a) => a.person_id === person?.id)
      .sort((a, b) => String(b.work_date).localeCompare(String(a.work_date)));
    const last = mine[0];
    const owned = blockers.filter((b) => b.owner_id === person?.id);
    root.appendChild(el('div', { class: 'rc-myday-foot' }, [
      el('section', { class: 'rc-myday-note', 'aria-label': 'Your last recorded day' }, [
        el('h3', { text: 'Your last recorded day' }),
        last
          ? el('div', { class: 'rc-myday-outcome' }, [
            badge(STATUS_BY_ID.get(last.status)?.label || last.status, STATUS_BY_ID.get(last.status)?.tone || 'neutral'),
            el('span', { text: dayLabel(String(last.work_date).slice(0, 10)) }),
            last.task ? el('span', { class: 'rc-hint', text: last.task }) : null,
            last.note ? el('div', { class: 'rc-myday-said', text: `“${last.note}”` }) : null,
          ].filter(Boolean))
          : el('p', { class: 'rc-hint', text: 'Nothing recorded in the last fortnight.' }),
        el('p', { class: 'rc-hint', text: 'Outcomes are recorded in the daily huddle.' }),
      ]),
      owned.length
        ? el('section', { class: 'rc-myday-note', 'aria-label': 'Blockers you are chasing' }, [
          el('h3', { text: 'You are chasing' }),
          ...owned.map((b) => el('div', { class: 'rc-myday-blocker' }, [
            badge('Blocked', 'bad'),
            el('span', { text: b.summary || 'A blocked day' }),
            b.due_date ? el('span', { class: 'rc-hint', text: `due ${dayLabel(String(b.due_date).slice(0, 10))}` }) : null,
          ].filter(Boolean))),
        ])
        : null,
    ].filter(Boolean)));
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  /**
   * One day, for one person: every task on it, where, on which shift and with
   * whom — or that they are off, and why.
   */
  function dayCard({ person, index, leave, locs, names, planRows, laRowById }, iso, title) {
    const card = el('section', { class: 'rc-myday-card', 'aria-label': `${title}, ${dayLabel(iso)}`, dataset: { day: iso } });
    card.appendChild(el('div', { class: 'rc-myday-card-head' }, [
      el('h3', { text: title }),
      el('span', { class: 'rc-hint', text: dayLabel(iso, 'day') }),
    ]));

    const absent = index.absent(person.id, iso);
    const state = availability(person, iso, leave, absent);
    if (state.state === 'leave') {
      card.appendChild(el('div', { class: 'rc-myday-off' }, [
        el('span', { html: icon('sun', { size: 18 }), 'aria-hidden': 'true' }),
        el('span', { text: state.leave ? 'On leave' : 'Off — on the PTO row' }),
      ]));
      return card;
    }
    if (state.state === 'non-working') {
      card.appendChild(el('p', { class: 'rc-hint', text: 'Not one of your working days.' }));
      return card;
    }

    const tasks = index.on(person.id, iso);
    if (!tasks.length) {
      card.appendChild(emptyState({
        iconName: 'calendar',
        title: 'Nothing planned yet',
        message: 'The look-ahead does not name you on this day and nobody has planned it. Ask in the huddle, or plan it in your week plan.',
      }));
    }
    for (const t of tasks) {
      if (t.absence) {
        card.appendChild(el('div', { class: 'rc-myday-task' }, [
          el('div', { class: 'rc-myday-task-title', text: ABSENCE_WORDS[t.absence] || t.task || 'Away from the project' }),
        ]));
        continue;
      }
      const where = locs.get(t.location_id)?.name || t.raw_location || '';
      const shift = SHIFTS.find((s) => s.id === t.shift)?.label || '';
      const others = withWhom({ index, names, planRows }, person.id, iso, t);
      const content = [
        el('div', { class: 'rc-myday-task-title', text: t.task || 'A task with no description' }),
        el('div', { class: 'rc-myday-facts' }, [
          where ? fact('pin', where) : null,
          shift ? fact('clock', `${shift} shift`) : null,
          others.length ? fact('users', `With ${others.join(', ')}`) : fact('user', 'On your own'),
          t.from_lookahead ? null : fact('edit', 'Planned by hand'),
        ].filter(Boolean)),
      ];
      /* A task on the look-ahead opens the whole activity: every column, every
         day from this week on, and who is on each. One planned by hand has no
         activity behind it, so it is not a button. */
      if (t.lookahead_row_id) {
        content.push(el('span', { class: 'rc-myday-more', text: 'Details', 'aria-hidden': 'true' }));
        card.appendChild(el('button', {
          class: 'rc-myday-task rc-myday-task-open',
          type: 'button',
          'aria-label': `${t.task || 'Task'} — open the whole activity`,
          onClick: async () => {
            const row = laRowById.get(t.lookahead_row_id)
              || (await rc.lookaheadRowsByIds([t.lookahead_row_id]).catch(() => []))[0]
              || null;
            openActivity({ row, task: t.task });
          },
        }, content));
      } else {
        card.appendChild(el('div', { class: 'rc-myday-task' }, content));
      }
    }
    if (state.asked) {
      card.appendChild(el('p', { class: 'rc-hint', text: 'You have asked for leave on this day; nobody has answered yet.' }));
    }
    return card;
  }

  function weekdayOf(iso) {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function fact(iconName, text) {
    return el('span', { class: 'rc-myday-fact' }, [
      el('span', { html: icon(iconName, { size: 12 }), 'aria-hidden': 'true' }),
      el('span', { text }),
    ]);
  }

  /**
   * Who else is on the same piece of work that day: everybody the look-ahead's
   * names row puts on the same row, and anybody planned against the same row by
   * hand. Matched on the row, never on the wording of a task.
   */
  function withWhom({ index, names, planRows }, meId, iso, task) {
    const rowId = task.lookahead_row_id;
    if (!rowId) return [];
    const ids = new Set();
    for (const [personId, days] of index.byPerson) {
      if (personId === meId) continue;
      if ((days.get(iso) || []).some((r) => r.id === rowId)) ids.add(personId);
    }
    for (const p of planRows) {
      if (p.person_id !== meId && p.work_date === iso && p.lookahead_row_id === rowId) ids.add(p.person_id);
    }
    return [...ids].map((id) => names.get(id)?.name).filter(Boolean).sort();
  }

  /** Monday to Sunday: where you are each day, in a word. */
  function weekStrip({ person, index, leave, locs }, monday, today) {
    const strip = el('ol', { class: 'rc-myday-week', 'aria-label': 'Your week' });
    for (let i = 0; i < 7; i++) {
      const iso = toISO(addDays(isoToMs(monday), i));
      const state = availability(person, iso, leave, index.absent(person.id, iso));
      const tasks = state.state === 'available' ? index.on(person.id, iso) : [];
      let text = '';
      if (state.state === 'leave') text = 'Off';
      else if (state.state === 'non-working') text = '—';
      else if (!tasks.length) text = 'Nothing yet';
      else {
        text = [...new Set(tasks.map((t) => (t.absence ? (ABSENCE_WORDS[t.absence] || 'Away').split(' ')[0]
          : locs.get(t.location_id)?.code || locs.get(t.location_id)?.name || t.raw_location || 'Task')))].join(', ');
      }
      strip.appendChild(el('li', {
        class: `rc-myday-day${iso === today ? ' rc-myday-today' : ''}${state.state !== 'available' ? ' rc-myday-quiet' : ''}`,
        'aria-current': iso === today ? 'date' : null,
        title: tasks.map((t) => t.task).filter(Boolean).join('\n'),
      }, [
        el('span', { class: 'rc-myday-wd', text: weekdayOf(iso) }),
        el('span', { class: 'rc-myday-where', text }),
      ]));
    }
    return el('section', { class: 'rc-myday-weekwrap' }, [el('h3', { text: 'This week' }), strip]);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     What changed for you

     The look-ahead as it reads now against the reading this person last said
     "Got it" to, for the days that name them from today on — `changesForMe()`
     in `core/lookahead.js`. "Got it" is a row in `rc_la_seen`, append-only, and
     it is what the administrator's inbox reads to say who has changes they have
     not seen.

     The first time, there is nothing to compare with, so the reading on screen
     is recorded quietly as the starting point. A new reading that changes none
     of this person's days is recorded quietly too — there was nothing to see.
     Neither is recorded while an administrator is only previewing.
     ═══════════════════════════════════════════════════════════════════════ */

  const HORIZON_DAYS = 27;

  /** What changed for the person looking: `{ state, latest, seen, changes }`. */
  async function myChanges() {
    const who = rc.me();
    if (!who) return { state: 'none', changes: [] };
    const [latest] = await rc.listSnapshotMeta({ limit: 1 });
    if (!latest) return { state: 'none', changes: [] };
    let seen;
    try {
      seen = await rc.lastSeen(who.id);
    } catch {
      // An older database with nowhere to record it: say nothing rather than fail.
      return { state: 'unavailable', changes: [] };
    }
    if (!seen) return { state: 'first', latest, changes: [] };
    if (seen.snapshot_id === latest.id) return { state: 'current', latest, seen, changes: [] };
    const today = todayISO();
    const to = toISO(addDays(isoToMs(today), HORIZON_DAYS));
    const [before, after, isMe] = await Promise.all([
      seen.snapshot_id ? rc.snapshotRows(seen.snapshot_id) : Promise.resolve([]),
      rc.snapshotRows(latest.id),
      meMatcher(),
    ]);
    if (!before.length) return { state: 'first', latest, seen, changes: [] };
    const changes = changesForMe(before, after, isMe || (() => false), { from: today, to });
    return { state: changes.length ? 'changed' : 'quiet', latest, seen, changes };
  }

  let unseen = null; // { at, n } — for the count on the tab
  /** How many changes are waiting on the person looking, remembered for a minute. */
  async function unseenCount() {
    if (unseen && Date.now() - unseen.at < 60000) return unseen.n;
    const { changes } = await myChanges();
    unseen = { at: Date.now(), n: changes.length };
    return unseen.n;
  }

  /** Put the count on the My day tab as it now stands — the header drew it from memory. */
  function showCount(n) {
    unseen = { at: Date.now(), n };
    const tab = document.querySelector('#rc-frame .rc-head .rc-tab[data-tab="myday"]');
    if (!tab) return;
    tab.querySelector('.rc-tab-count')?.remove();
    if (!n) return;
    tab.appendChild(el('span', { class: 'rc-tab-count rc-tab-count-info', text: String(n), 'aria-label': `${n} change${n === 1 ? '' : 's'} to your days` }));
  }

  function record(latest, changes) {
    if (rc.previewing()) return Promise.resolve(null);
    return rc.markSeen({ snapshotId: latest.id, takenAt: latest.taken_at, changes }).catch(() => null);
  }

  const KIND = {
    added: { label: 'Added', tone: 'good' },
    reinstated: { label: 'Back on', tone: 'good' },
    moved: { label: 'Moved', tone: 'warn' },
    shift: { label: 'Shift changed', tone: 'warn' },
    cancelled: { label: 'Cancelled', tone: 'bad' },
    removed: { label: 'Taken off', tone: 'bad' },
    given: { label: 'Given to somebody else', tone: 'bad' },
  };

  function sentence(c) {
    const on = (iso) => dayLabel(iso, 'day');
    const where = c.location && !c.label.includes(c.location) ? ` (${c.location})` : '';
    const what = `${c.label}${where}`;
    switch (c.kind) {
      case 'added': return `${on(c.date)} — ${what}${c.now ? `, ${c.now}` : ''}`;
      case 'reinstated': return `${on(c.date)} — ${what} is back on${c.now ? `, ${c.now}` : ''}`;
      case 'moved': return `${on(c.from)} → ${on(c.date)} — ${what}`;
      case 'shift': return `${on(c.date)} — ${what}: now ${c.now} (was ${c.was})`;
      case 'cancelled': return `${on(c.date)} — ${what}`;
      case 'removed': return `${on(c.date)} — ${what}: you are no longer on it`;
      case 'given': return `${on(c.date)} — ${what}: now ${c.names.join(', ')}`;
      default: return `${on(c.date)} — ${what}`;
    }
  }

  function changesPanel() {
    const box = el('section', { class: 'rc-myday-changes', hidden: true, 'aria-live': 'polite', 'aria-label': 'What changed for you' });
    const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    myChanges()
      .then(async ({ state, latest, seen, changes }) => {
        if (state === 'none' || state === 'unavailable') return;
        if (state === 'first' || state === 'quiet') {
          await record(latest, 0);
          showCount(0);
          box.append(el('p', {
            class: 'rc-hint rc-myday-uptodate',
            text: state === 'first'
              ? 'From now on, whenever the look-ahead changes one of your days, it shows here first.'
              : `Nothing on the look-ahead has changed for you since ${when(seen.snapshot_taken_at)}.`,
          }));
          box.hidden = false;
          return;
        }
        if (state === 'current') {
          box.append(el('p', { class: 'rc-hint rc-myday-uptodate', text: `You are up to date with the look-ahead as of ${when(latest.taken_at)}.` }));
          box.hidden = false;
          return;
        }
        showCount(changes.length);
        box.classList.add('rc-myday-changes-open');
        box.append(
          el('div', { class: 'rc-myday-changes-head' }, [
            el('h3', { text: `${changes.length} change${changes.length === 1 ? '' : 's'} to your days` }),
            el('span', { class: 'rc-hint', text: `since you last looked, ${when(seen.snapshot_taken_at)}` }),
          ]),
          el('ul', { class: 'rc-myday-change-list' }, changes.map((c) => el('li', { class: `rc-myday-change rc-myday-change-${c.kind}` }, [
            badge(c.kind === 'given' ? `Given to ${c.names[0]}${c.names.length > 1 ? ' +' : ''}` : KIND[c.kind]?.label || c.kind, KIND[c.kind]?.tone || 'neutral'),
            el('span', { text: sentence(c) }),
          ]))),
          el('div', { class: 'rc-myday-changes-foot' }, [
            el('button', {
              class: 'cx-btn mini primary',
              type: 'button',
              text: 'Got it',
              title: 'Say you have seen these. Your administrator can see who has not.',
              onClick: async (e) => {
                e.currentTarget.disabled = true;
                if (rc.previewing()) {
                  box.replaceChildren(el('p', { class: 'rc-hint', text: 'Preview only — nothing is recorded while you are seeing the calendar as somebody else.' }));
                  return;
                }
                try {
                  await rc.markSeen({ snapshotId: latest.id, takenAt: latest.taken_at, changes: changes.length });
                  showCount(0);
                  notifyChanged('seen');
                } catch (err) {
                  e.currentTarget.disabled = false;
                  box.append(el('p', { class: 'rc-error', text: err?.message || String(err) }));
                }
              },
            }),
            el('span', { class: 'rc-hint', text: 'Your days below already show the look-ahead as it reads now.' }),
          ]),
        );
        box.hidden = false;
      })
      .catch(() => {});
    return box;
  }

  Object.defineProperty(__x, "render", { get: () => render, enumerable: true });
  Object.defineProperty(__x, "myChanges", { get: () => myChanges, enumerable: true });
  Object.defineProperty(__x, "unseenCount", { get: () => unseenCount, enumerable: true });
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
  const { gridFromModel, windowDays, addDaysISO, mondayOf, SECTION_BAND } = __req("core/la_edit.js");
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
    const previous = await rc.latestSnapshot();
    if (previous && previous.file_hash === hash) return { changed: false, events: [] };
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
    const parts = [];
    const central = [];
    let offset = 0;
    // 1 January 2026, 00:00 — a fixed stamp, so the same content is the same file.
    const dosTime = 0;
    const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

    for (const file of files) {
      const name = enc.encode(file.name);
      const data = typeof file.data === 'string' ? enc.encode(file.data) : file.data;
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), name, data);

      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true);
      dir.setUint16(6, 20, true);
      dir.setUint16(8, 0x0800, true);
      dir.setUint16(10, 0, true);
      dir.setUint16(12, dosTime, true);
      dir.setUint16(14, dosDate, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, data.length, true);
      dir.setUint32(24, data.length, true);
      dir.setUint16(28, name.length, true);
      dir.setUint32(42, offset, true);
      central.push(new Uint8Array(dir.buffer), name);

      offset += 30 + name.length + data.length;
    }

    const dirSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
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
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  }

  /* ══════════════════════════════════════════════════════════════════════════
     Styles
     ═══════════════════════════════════════════════════════════════════════ */

  /**
   * The style table, built from what the sheet asks for.
   *
   * A style is described as `{ bold, size, color, fill, border, h, v, wrap,
   * shrink }` and `id()` returns its index in `cellXfs`, adding it the first time
   * — so the workbook carries exactly the styles its cells use and no more.
   */
  function styleBook({ font = 'Arial', size = 10 } = {}) {
    const fonts = [];
    const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const borders = [];
    const xfs = [];
    const index = new Map();

    const fontId = (s) => {
      const xml = `<font>${s.bold ? '<b/>' : ''}<sz val="${s.size || size}"/>`
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
      xfs.push(`<xf numFmtId="0" fontId="${f}" fillId="${fi}" borderId="${b}" xfId="0"`
        + ` applyFont="1"${fi ? ' applyFill="1"' : ''}${b ? ' applyBorder="1"' : ''}`
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
  function workbookParts({ sheetName, sheetXml, stylesXml, printTitles = null, title = '' }) {
    const name = xmlEscape(sheetName);
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

  Object.defineProperty(__x, "crc32", { get: () => crc32, enumerable: true });
  Object.defineProperty(__x, "zipStore", { get: () => zipStore, enumerable: true });
  Object.defineProperty(__x, "xmlEscape", { get: () => xmlEscape, enumerable: true });
  Object.defineProperty(__x, "styleBook", { get: () => styleBook, enumerable: true });
  Object.defineProperty(__x, "workbookParts", { get: () => workbookParts, enumerable: true });
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

  const { FIELDS, LAYOUT, SECTION_BAND, rowsWithWork, getCell, metaValues, colLetters, isWeekend, weekdayLetter, monthLabel } = __req("core/la_edit.js");



  const { zipStore, xmlEscape, styleBook, workbookParts } = __req("io/xlsx_write.js");
  const { isDark } = __req("io/lookahead.js");

  const WEEKEND = '7F7F7F';
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
   */
  function lookaheadWorkbook({ model, days, legend = [], codes = [], title = '', sheetName = '4WLA' }) {
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
    const dayCell = (col, row, cell, { names = false } = {}, iso) => {
      if (cell?.color) return str(col, row, cell.text || '', paint(cell.color));
      if (isWeekend(iso)) return str(col, row, cell?.text || '', S.weekend);
      return str(col, row, cell?.text || '', names ? S.names : S.day);
    };
    const height = (texts) => {
      let n = 1;
      for (const [text, width] of texts) n = Math.max(n, lines(text, width));
      return n > 1 ? +(n * LINE + 1.5).toFixed(2) : null;
    };

    for (const row of rowsWithWork(model, days)) {
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
    const safe = String(sheetName || '4WLA').replace(/[\\/:*?"<>|]+/g, ' ').trim() || '4WLA';
    return `${safe} ${days[0]} to ${days[days.length - 1]}.xlsx`;
  }

  Object.defineProperty(__x, "lookaheadWorkbook", { get: () => lookaheadWorkbook, enumerable: true });
  Object.defineProperty(__x, "lookaheadFileName", { get: () => lookaheadFileName, enumerable: true });
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
   * Imports: util, rc, core/la_edit, core/lookahead, io/lookahead, io/la_xlsx,
   *          io/exporters, filestore, icons, components, rc_util, rc_ingest,
   *          rc_la_state.
   */

  const { el, clear } = __req("core/util.js");
  const rc = __req("core/rc.js");
  const filestore = __req("core/filestore.js");
  const ed = __req("core/la_edit.js");
  const { readGrid, isCancelMeaning } = __req("core/lookahead.js");
  const { parseSheet, applyLegend, readLegend, isDark } = __req("io/lookahead.js");
  const { lookaheadWorkbook, lookaheadFileName } = __req("io/la_xlsx.js");
  const { saveFile } = __req("io/exporters.js");
  const { icon } = __req("ui/icons.js");
  const { toast, confirmDialog, contextMenu, openModal, textInput, selectInput, segmented, emptyState, attachTooltip } = __req("ui/components.js");



  const { notifyChanged, todayISO, nameRegister, foldName } = __req("ui/rc_util.js");
  const { publishFromEditor, publishDays, EDITOR_SOURCE } = __req("ui/rc_ingest.js");
  const { la } = __req("ui/rc_la_state.js");

  /* ══════════════════════════════════════════════════════════════════════════
     State
     ═══════════════════════════════════════════════════════════════════════ */

  const META = ed.FIELDS.length; // six activity columns, then the days
  const SAVE_BATCH = 400;
  const POLL_MS = 20000;
  const PUBLISH_QUIET_MS = 2500;

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
    filter: '',
    showArchived: false,
    collapsed: new Set(),
    anchor: { r: 0, c: META },
    focus: { r: 0, c: META },
    undo: [],
    redo: [],
    queue: [],
    saving: false,
    status: 'saved', // saved | saving | retry | conflict
    retryIn: 0,
    server: new Map(), // 'row:<id>' | 'cell:<row>|<day>' → the version the server holds
    revision: 0,
    dirtySincePublish: false,
    publishTimer: null,
    publishing: null, // the publish under way, so a flush can wait for it
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

    const [settings, legend, codes, people, aliases, leaveKinds] = await Promise.all([
      rc.listSettings().catch(() => []),
      rc.listLegend().catch(() => []),
      rc.listSupportCodes({ includeRetired: true }).catch(() => []),
      rc.listPeople().catch(() => []),
      rc.listPersonAliases().catch(() => []),
      rc.listLeaveKinds().catch(() => []),
    ]);
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
    E.legendAll = legend.map((r) => ({ argb: String(r.argb).toUpperCase(), meaning: r.meaning, role: r.role || 'shift', valid_from: r.valid_from }));
    const inForce = new Map();
    for (const r of E.legendAll) {
      const held = inForce.get(r.argb);
      if (!held || String(r.valid_from || '') > String(held.valid_from || '')) inForce.set(r.argb, r);
    }
    E.legend = [...inForce.values()].filter((r) => r.role === 'shift' && r.meaning);
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

  /**
   * Save, then publish, now — called before another section is opened so it
   * reads the look-ahead as it stands rather than as it stood a few seconds ago.
   */
  async function flushEditor() {
    await drain();
    /* Always through `publish()`, which waits for one already under way. Only
       starting a publish when one was pending let the calendar open while the
       previous publish was still writing — and it drew the reading from before
       the edit, so a row taken off stayed on. */
    await publish();
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
    E.model = ed.makeModel(rows.map(cleanRow), cells.map(cleanCell));
    E.loaded = { from, to };
    E.server = new Map();
    for (const r of E.model.rows) E.server.set(`row:${r.id}`, r.version || 0);
    for (const c of ed.cellList(E.model)) E.server.set(`cell:${c.row_id}|${c.day}`, c.version || 0);
    E.revision = await rc.lookaheadRevision().catch(() => E.revision);
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
    for (const c of cells.map(cleanCell)) {
      const key = ed.cellKey(c.row_id, c.day);
      if (!E.model.cells.has(key)) {
        E.model.cells.set(key, c);
        E.server.set(`cell:${key}`, c.version || 0);
      }
    }
    E.loaded = { from: lo, to: hi };
    await loadLeave();
  }

  function cleanRow(r) {
    return {
      ...ed.blankRow(r.kind, {}),
      ...r,
      sort: Number(r.sort) || 0,
      level: Number(r.level) || 0,
      archived: !!r.archived,
    };
  }

  function cleanCell(c) {
    return {
      row_id: c.row_id,
      day: String(c.day).slice(0, 10),
      color: c.color ? String(c.color).toUpperCase() : null,
      text: c.text || '',
      version: c.version || 0,
    };
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
    const text = (r) => [r.activity_id, r.description, r.location, r.sswp, r.party, r.work_hours].join(' ').toLowerCase();
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

    host.append(toolbar(days), grid(rows, days));
    const scroller = host.querySelector('.lae-scroll');
    scroller.scrollLeft = E.scroll.left;
    scroller.scrollTop = E.scroll.top;
    paintSelection();
    if (refocus) scroller.focus({ preventScroll: true });
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

    bar.append(range, add, palette, support, search, right);
    return bar;
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
    table.appendChild(el('tfoot', {}, [foot]));

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
      tr.appendChild(td);
    });

    days.forEach((d, i) => {
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
      }
      if (cell?.color) {
        const meaning = E.legendAll.find((e) => e.argb === cell.color)?.meaning;
        if (meaning) title = [meaning, title].filter(Boolean).join(' · ');
      }
      // Names are wider than a day; the whole list is one hover away.
      if (!title && cell?.text) title = cell.text;
      const clashes = E.staff.byCell.get(ed.cellKey(row.id, d));
      if (clashes?.length) {
        cls.push('lae-clash');
        title = [...new Set(clashes.map((x) => x.detail))].join('\n') + (title ? `\n${title}` : '');
      }
      const td = el('td', { class: cls.join(' '), dataset: { c: String(c) }, text: cell?.text || '', title });
      if (cell?.color) td.style.backgroundColor = `#${cell.color}`;
      if (!editable(row, c)) td.classList.add('lae-fixed');
      tr.appendChild(td);
    });
    return tr;
  }

  function codeName(code) {
    const c = E.codes.find((x) => String(x.code).toUpperCase() === code);
    return c ? (c.name || c.code) : code;
  }

  function looksLikeCodes(text) {
    return /^[A-Za-z0-9]{1,8}(\.[A-Za-z0-9]{1,8})*$/.test(String(text).trim());
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

    E.editing = { input, hint, r, c, row };
    input.focus();
    if (initial == null) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);

    input.addEventListener('keydown', (e) => {
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
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(); select(Math.min(r + (e.shiftKey ? -1 : 1), E.view.rows.length - 1), c); focusGrid(); }
      else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); select(r, Math.min(Math.max(0, c + (e.shiftKey ? -1 : 1)), E.view.cols - 1)); focusGrid(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); focusGrid(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => { if (E.editing?.input === input) commitEdit(); });
  }

  function focusGrid() {
    E.root?.querySelector('.lae-scroll')?.focus({ preventScroll: true });
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
    const { input, r, c, row } = E.editing;
    let value = input.value;
    cancelEdit();
    if (!E.model.rows.some((x) => x.id === row.id)) return;
    if (c < META) {
      const key = row.kind === 'activity' ? ed.FIELDS[c].key : 'description';
      if ((row[key] ?? '') === value) return;
      commit([{ op: 'row', id: row.id, set: { [key]: value } }]);
      return;
    }
    const day = E.view.days[c - META];
    const cell = ed.getCell(E.model, row.id, day);
    if (row.kind === 'activity' && looksLikeCodes(value.replace(/\s+/g, ''))) value = ed.normaliseSupport(value);
    value = value.trim();
    if ((cell?.text || '') === value) return;
    commit([{ op: 'cell', row_id: row.id, day, color: cell?.color || null, text: value }]);
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
  function commit(ops, { keepRedo = false } = {}) {
    const useful = ops.filter((op) => {
      if (op.op !== 'cell') return true;
      const was = ed.getCell(E.model, op.row_id, op.day);
      return (was?.color || null) !== (op.color ? String(op.color).toUpperCase() : null) || (was?.text || '') !== String(op.text ?? '');
    });
    if (!useful.length) return;
    const inverse = ed.applyOps(E.model, useful);
    E.undo.push({ ops: useful, inverse });
    if (E.undo.length > 200) E.undo.shift();
    if (!keepRedo) E.redo = [];
    enqueue(useful);
    draw();
  }

  function undo() {
    const entry = E.undo.pop();
    if (!entry) return;
    cancelEdit();
    const again = ed.applyOps(E.model, entry.inverse);
    E.redo.push({ ops: entry.inverse, inverse: again });
    enqueue(entry.inverse);
    draw();
  }

  function redo() {
    const entry = E.redo.pop();
    if (!entry) return;
    const again = ed.applyOps(E.model, entry.inverse);
    E.undo.push({ ops: entry.inverse, inverse: again });
    enqueue(entry.inverse);
    draw();
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
    const list = el('ul', { class: 'lae-cancel-runs' }, runs.map((r) => el('li', {
      text: `${r.row.description || 'Activity'}${r.row.location ? ` at ${r.row.location}` : ''} — `
        + `${r.start === r.end ? fmt(r.start) : `${fmt(r.start)} – ${fmt(r.end)}`}`,
    })));
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
                await rc.addCancellationNote({
                  ...ed.cancellationKey(r.row),
                  start_date: r.start,
                  end_date: r.end,
                  party: party.value,
                  reason: reason.value.trim() || null,
                });
              }
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
      const tokens = ed.supportTokens(cell?.text || '');
      if (direction > 0) tokens.push(code);
      else {
        const at = tokens.lastIndexOf(code);
        if (at < 0) continue;
        tokens.splice(at, 1);
      }
      ops.push({ op: 'cell', row_id: s.row.id, day: s.day, color: cell?.color || null, text: tokens.join('.') });
    }
    if (!ops.length) {
      toast({ message: 'Select an activity\'s days first — support is asked for on activities.' });
      return;
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

  function insertRow(kind, where = 'below', extra = {}) {
    cancelEdit();
    const { before, after } = insertionPoint(where);
    const id = ed.newId();
    const set = { kind, sort: ed.sortBetween(before, after), ...extra };
    if (kind === 'section') set.description = extra.description ?? 'New section';
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
      one && one.kind !== 'section' && days
        ? { label: 'History of this day…', icon: 'history', onClick: () => historyDialog(one, E.view.days[E.focus.c - META]) }
        : null,
      one ? { label: 'History of this row…', icon: 'history', onClick: () => historyDialog(one, null) } : null,
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
      form.appendChild(el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: f.heading }), inputs[f.key]]));
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
    const who = new Map(people.filter((p) => p.user_id).map((p) => [p.user_id, p.name]));
    const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const meaning = (hex) => E.legendAll.find((e) => e.argb === hex)?.meaning || '';
    const name = ed.metaValues(row).filter(Boolean)[0] || (row.kind === 'resource' ? 'Names row' : 'Row');
    const list = el('ol', { class: 'lae-history', 'aria-label': 'Changes, newest first' });

    if (day) {
      for (const h of ed.cellHistory(edits, row.id, day)) {
        list.appendChild(el('li', { class: 'lae-history-item' }, [
          el('span', { class: 'lae-history-when', text: when(h.at) }),
          el('span', { class: 'lae-history-who', text: who.get(h.by) || 'Somebody' }),
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
          el('span', { class: 'lae-history-who', text: who.get(h.by) || 'Somebody' }),
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
    const who = new Map(people.filter((p) => p.user_id).map((p) => [p.user_id, p.name]));
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
          el('span', { text: who.get(p.by) || 'Somebody' }),
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
    const thisMonday = ed.mondayOf(todayISO());
    const starts = [-7, 0, 7, 14].map((d) => ed.addDaysISO(thisMonday, d));
    const start = selectInput({
      value: thisMonday,
      options: starts.map((d, i) => ({ value: d, label: `${['Last week', 'This week', 'Next week', 'In two weeks'][i]} — from ${fmt(d)}` })),
    });
    let weeks = E.weeks;
    const size = segmented({
      value: weeks,
      options: ed.WINDOW_WEEKS.map((w) => ({ value: w, label: `${w} weeks` })),
      onChange: (w) => { weeks = w; update(); },
    });
    const summary = el('div', { class: 'rc-hint' });
    const update = () => {
      const days = ed.windowDays(start.value, weeks);
      const rows = ed.rowsWithWork(E.model, days);
      const n = rows.filter((r) => r.kind === 'activity').length;
      summary.textContent = `${n} activit${n === 1 ? 'y' : 'ies'} with work between ${fmt(days[0])} and ${fmt(days[days.length - 1])}, `
        + 'with their sections, names rows and the PTO / Office rows — in the 4WLA layout, ready to copy into the master file.';
    };
    start.addEventListener('change', update);
    update();

    const canFolder = filestore.hasFolder?.();
    const build = async () => {
      const days = ed.windowDays(start.value, weeks);
      await ensureWindow(days);
      const settings = await rc.listSettings().catch(() => []);
      const sheetName = settings.find((r) => r.key === 'lookahead_sheet')?.value || '4WLA';
      const bytes = lookaheadWorkbook({
        model: E.model, days, legend: E.legend, codes: E.codes.filter((c) => c.active !== false), title: E.title, sheetName,
      });
      return { bytes, name: lookaheadFileName(days, sheetName) };
    };
    openModal({
      title: 'Export to Excel',
      subtitle: 'The same columns, merged headings and colours as the 4WLA',
      body: el('div', { class: 'lae-form' }, [
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Starting' }), start]),
        el('div', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Weeks' }), size]),
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
    for (const c of cells.map(cleanCell)) {
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
      if (!E.queue.length && E.status !== 'conflict') E.status = 'saved';
      refreshStatus();
      E.revision = await rc.lookaheadRevision().catch(() => E.revision);
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
    if (!E.model || E.queue.length || !E.dirtySincePublish) return;
    E.dirtySincePublish = false;
    try {
      await publishFromEditor({ model: E.model, title: E.title, silent: true });
    } catch (err) {
      E.dirtySincePublish = true;
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

  /** Look for the other editor's changes, quietly, while nobody is mid-edit. */
  function startPolling() {
    if (E.pollTimer) return;
    const tick = async () => {
      if (!E.root?.isConnected || document.hidden || E.editing || E.queue.length || E.saving) return;
      try {
        const rev = await rc.lookaheadRevision();
        if (rev > E.revision) {
          await reload();
          toast({ message: 'The look-ahead was updated with changes made by the other editor.', timeout: 4000 });
        }
      } catch {
        /* the next tick will ask again */
      }
    };
    E.pollTimer = setInterval(tick, POLL_MS);
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
        ['Code', 'Asks for', 'Party', ''],
        codes.map((c) => el('tr', { class: c.active === false ? 'rc-inactive' : '' }, [
          el('td', {}, [el('span', { class: 'lae-code', text: String(c.code).toUpperCase() })]),
          el('td', { text: c.name || '—' }),
          el('td', { text: c.party || '—' }),
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
    formModal({
      title: existing ? `Support code ${String(existing.code).toUpperCase()}` : 'Add a support code',
      confirmLabel: existing ? 'Save' : 'Add',
      body: el('div', { class: 'lae-form' }, [
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Code, as typed on the sheet' }), code]),
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'What it asks for' }), name]),
        el('label', { class: 'cx-field' }, [el('span', { class: 'cx-label', text: 'Who provides it' }), party]),
      ]),
      onConfirm: async () => {
        const value = code.value.trim().toUpperCase();
        if (!/^[A-Z0-9]{1,8}$/.test(value)) throw new Error('A code is one to eight letters or digits, with no dots — the dots separate codes.');
        const clash = codes.find((c) => String(c.code).toUpperCase() === value && c.id !== existing?.id);
        if (clash) throw new Error(`${value} is already a code${clash.active === false ? ' (retired — restore it instead)' : ''}.`);
        const row = { code: value, name: name.value.trim(), party: party.value };
        if (existing) await rc.updateSupportCode(existing.id, row);
        else await rc.addSupportCode({ ...row, active: true, sort: Math.max(0, ...codes.map((c) => c.sort || 0)) + 10 });
        notifyChanged('support-codes');
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
  const { keyRows, classify, relinkCandidates, countable, describe, readGrid, rowsFrom, marksOf, reassignments, ABSENCE_LABELS, cancellationEvents, attachCancellationNotes, isCancelMeaning, rowsNaming, resourceNames } = __req("core/lookahead.js");




  const { icon } = __req("ui/icons.js");
  const { selectInput, textInput, toast, badge, emptyState, field, checkbox, confirmDialog, chipStat } = __req("ui/components.js");


  const { notifyChanged, byId, dayLabel, todayISO, formModal, parsedView, isoToMs, nameRegister, foldName, meMatcher } = __req("ui/rc_util.js");



  const { toISO, addDays } = __req("core/dates.js");

  const { la, table, WEEK_CHOICES } = __req("ui/rc_la_state.js");
  const { checkNowButton, lookaheadSource, EDITOR_SOURCE } = __req("ui/rc_ingest.js");
  const { renderEditor, flushEditor } = __req("ui/rc_la_editor.js");
  const { renderLegend } = __req("ui/rc_la_legend.js");
  const { renderChanges, renderSnapshots } = __req("ui/rc_la_changes.js");
  const { renderCancellations } = __req("ui/rc_la_cancellations.js");
  const { renderSars } = __req("ui/rc_la_sars.js");
  const { openActivity } = __req("ui/rc_activity.js");

  const SECTIONS = ['calendar', 'cancellations', 'changes', 'snapshots', 'legend', 'sars'];

  /** How often an open calendar asks whether a newer reading has been published. */
  const WATCH_MS = 10000;

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
          snapshots: 'Snapshots', legend: 'Legend', sars: 'Site access',
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
    else await renderSars(host);
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
        btn.disabled = true;
        try {
          if (on) await flushEditor();
        } catch (err) {
          rc.reportError('lookahead:publish', err);
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
      editSwitch(),
    ]));
    const body = el('div');
    host.appendChild(body);
    await renderEditor(body);
  }

  /**
   * Redraw the calendar when somebody publishes a newer reading — the other
   * administrator editing, or this one in another window. Asked every few
   * seconds while it is on screen, and never while somebody is typing into its
   * filter or has a dialog open, because redrawing takes the field away.
   */
  function watchForNewReading(host, seenId) {
    const timer = setInterval(async () => {
      if (!host.isConnected) { clearInterval(timer); return; }
      if (document.hidden || document.querySelector('.cx-modal-overlay')) return;
      const active = document.activeElement;
      if (active && host.contains(active)
        && active.matches('input:not([type=checkbox]):not([type=radio]), textarea, select')) return;
      try {
        const id = await rc.newestSnapshotId();
        if (id == null || id === seenId || !host.isConnected) return;
        clearInterval(timer);
        rc.forgetReads();
        notifyChanged('lookahead');
      } catch {
        /* the next tick asks again */
      }
    }, WATCH_MS);
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
    const [snapshot, legendRows, isMe] = await Promise.all([
      rc.latestSnapshot(),
      rc.listLegend(),
      meMatcher(),
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
    host.appendChild(el('div', { class: 'rc-section-head' }, [
      el('h3', { text: 'The look-ahead' }),
      // Once it is written here there is nothing to check; Edit is the way in.
      admin && !written ? checkNowButton() : null,
      admin ? editSwitch() : null,
    ].filter(Boolean)));
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
    const grid = { unknown: view.unknown };

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

    const body = el('div');
    const draw = () => {
      clear(body);
      const onlyMine = Boolean(isMe && la.onlyMine);
      const shown = drawn(windowed(view, today), la.calendarFilter, la.showQuietRows, la.showResources, onlyMine ? isMe : null);
      clear(strip);
      strip.appendChild(legendStrip(legend, grid.unknown, paintOn(shown)));
      if (onlyMine && !shown.activities.length) {
        body.appendChild(emptyState({
          iconName: 'calendar',
          title: 'You are not on anything in these weeks',
          message: 'No names row on the look-ahead puts you on a day in the weeks on screen. Widen the window, or see the whole sheet.',
          action: { label: 'Show every row', onClick: () => { la.onlyMine = false; mine.querySelector('input').checked = false; draw(); } },
        }));
        return;
      }
      body.appendChild(grid_(shown, today, isMe, snapshot.id));
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
      mine,
      quiet,
      resources,
      /* The whole view, not the windowed one: the dialog picks its own weeks, and
         handing it what is on screen would quietly cap the export at whatever the
         range buttons were last set to. */
      exportButton({ view, legendRows, today, sheetName: snapshot.sheet_name, isMe }),
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
  function drawn(view, filter, showQuiet, withResources = la.showResources, isMe = null) {
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
  function grid_(view, today, isMe = null, snapshotId = null) {
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
    const line = (meta, marks, { klass = '', what = '', resource = false, open = null }) => el('tr', {
      class: klass,
    }, [
      ...meta.map((value, i) => el('td', {
        class: 'la-meta' + (i === meta.length - 1 ? ' la-last' : '') + (open ? ' la-openable' : ''),
        text: value,
        title: open ? `${value}${value ? ' — ' : ''}open the whole activity` : value,
        // The first column is the one keyboard stop for the row.
        tabindex: open && i === 0 ? '0' : null,
        role: open && i === 0 ? 'button' : null,
        onClick: open || null,
        onKeydown: open && i === 0 ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : null,
      })),
      ...view.days.map((d) => {
        const mark = marks.get(d.col);
        const classes = ['la-day'];
        if (resource) classes.push('la-resource');
        if (d.weekend) classes.push('la-weekend');
        if (d.date && d.date === today) classes.push('la-today');
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
          text: mark?.value || '',
          title: [what, d.date || `${d.month} ${d.day} ${d.weekday}`.trim(),
            mark?.meaning || (mark?.hex ? `unmapped colour #${mark.hex}` : null), mark?.value,
            yours ? 'you are on this day' : null]
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
        open: a.heading || a.absence ? null
          : () => openActivity({ row: { raw_label: a.meta.filter(Boolean).join(' · '), snapshot_id: snapshotId, sheet_row: a.row } }),
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
  function exportDialog({ view, legendRows, today, sheetName, isMe = null }) {
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

    /* What is actually going to be drawn, from the same two functions the screen
       draws through — so the export cannot show a different set of rows from the
       grid it was started from. */
    const chosen = () => {
      const narrowed = windowed(view, today, Number(weeks.value) || 0);
      const rows = drawn(narrowed, on(withFilter) ? la.calendarFilter : '', on(withQuiet), on(withResources),
        withMine && on(withMine) ? isMe : null);
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
        const { view: shown, opts } = chosen();
        if (!shown.activities.length) throw new Error('There is nothing to draw with those choices.');
        const blob = calendarPdf(shown, opts);
        const whose = withMine && on(withMine) ? `-${foldName(rc.me()?.name || 'mine') || 'mine'}` : '';
        saveFile(`lookahead${whose}-${today}.pdf`, blob, 'application/pdf', 'Look-ahead');
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



  const { SHIFTS, STATUS_BY_ID, weekStart, allWeekDays, todayISO, dayLabel, byId, availability, notifyChanged, formModal, nameRegister, foldName, goToTab, ambiguousFirstNames, lookaheadWithResources, assignmentIndex, locationRegister, unmatchedLocations, outcomeLookup, shiftLabel } = __req("ui/rc_util.js");






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

    /* How each day went — the one rule for matching an outcome to a drawn task,
       shared with the phone's week so the two cannot disagree. */
    const outcomeFor = outcomeLookup(actuals);

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
        action: rc.isAdmin() ? { label: 'Open Organisation', onClick: () => goToTab('org') } : null,
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
              entry.shift && entry.shift !== 'day' ? shiftLabel(entry.shift) : null,
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
      host.appendChild(emptyState({
        iconName: 'users',
        title: 'Nobody on the roster yet',
        message: 'Leave is booked against people on the roster. Being on it never requires an account.',
        action: rc.isAdmin() ? { label: 'Add people in Organisation', onClick: () => goToTab('org') } : null,
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
   * Imports: util, events, rc, components, rc_gate, and the tab modules.
   */

  const { el, clear } = __req("core/util.js");
  const { on, EV } = __req("core/events.js");
  const rc = __req("core/rc.js");
  const { icon } = __req("ui/icons.js");
  const { toast, emptyState, openPicker } = __req("ui/components.js");
  const { notConfigured, signInForm, notOnTheTeam } = __req("ui/rc_gate.js");
  const roster = __req("ui/rc_roster.js");
  const huddle = __req("ui/rc_huddle.js");
  const myday = __req("ui/rc_myday.js");
  const lookahead = __req("ui/rc_lookahead.js");
  const week = __req("ui/rc_week.js");
  const pto = __req("ui/rc_pto.js");
  const reports = __req("ui/rc_reports.js");
  const { enhanceTables } = __req("ui/rc_table.js");
  const { inboxCount } = __req("ui/rc_inbox.js");

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
    { id: 'myday', label: 'My day' },
    { id: 'huddle', label: 'Daily huddle' },
    { id: 'week', label: 'Week plan' },
    { id: 'pto', label: 'PTO' },
    { id: 'lookahead', label: 'Look-ahead' },
    { id: 'reports', label: 'Reports' },
    { id: 'org', label: 'Organisation' },
  ];

  const RENDERERS = {
    myday: myday.render,
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
    on(EV.RC_SHOW_TAB, ({ tab }) => showTab(tab));

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
      bodyEl.appendChild(signInForm({ onDone: () => render() }));
      return;
    }
    if (!rc.me()) {
      bodyEl.appendChild(notOnTheTeam());
      return;
    }

    const view = el('div');
    bodyEl.append(previewBanner(), schemaBanner(), view);
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
        const button = el('button', {
          class: 'rc-tab',
          type: 'button',
          text: tab.label,
          dataset: { tab: tab.id },
          'aria-pressed': String(tab.id === active),
          onClick: () => showTab(tab.id),
        });
        if (tab.id === 'org' && rc.isAdmin()) inboxBadge(button);
        if (tab.id === 'myday') unseenBadge(button);
        tabs.appendChild(button);
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

      if (rc.isRealAdmin() && !rc.previewing()) {
        headEl.appendChild(el('button', {
          class: 'cx-btn mini ghost',
          type: 'button',
          html: `${icon('eye', { size: 12 })}<span>View as…</span>`,
          title: 'See the calendar as a member or a viewer sees it. Nothing is saved while you do.',
          onClick: () => chooseViewAs(),
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
   * Pick somebody to see the calendar as. Members and viewers only: an
   * administrator sees what you already see.
   */
  async function chooseViewAs() {
    let people;
    try {
      people = await rc.listPeople();
    } catch (err) {
      toast({ tone: 'bad', message: err.message });
      return;
    }
    const choices = people.filter((p) => p.role !== 'admin' && p.id !== rc.me()?.id);
    if (!choices.length) {
      toast({ message: 'Nobody on the team is a member or a viewer yet.' });
      return;
    }
    openPicker({
      title: 'View the calendar as…',
      subtitle: 'Everything is drawn as they would see it. Nothing you press is saved.',
      placeholder: 'Search the team…',
      items: choices.map((p) => ({ value: p.id, label: p.name, meta: `${p.role === 'viewer' ? 'Viewer' : 'Member'}${p.title ? ` · ${p.title}` : ''}` })),
      empty: 'Nobody matches.',
      onPick: (id) => {
        const who = choices.find((p) => p.id === id);
        if (!who) return;
        try {
          active = 'myday';
          rc.previewAs(who); // redraws, through RC_AUTH_CHANGED
        } catch (err) {
          toast({ tone: 'bad', message: err.message });
        }
      },
    });
  }

  /** "You are seeing this as Priya", with the way back, above every tab while it is true. */
  function previewBanner() {
    const who = rc.previewing();
    if (!who) return el('span', { hidden: true });
    return el('div', { class: 'rc-preview-banner', role: 'status' }, [
      el('span', { html: icon('eye', { size: 16 }), 'aria-hidden': 'true' }),
      el('div', { class: 'rc-preview-text' }, [
        el('strong', { text: `You are seeing the calendar as ${who.name} (${who.role === 'viewer' ? 'viewer' : 'member'}).` }),
        el('span', { text: ' Nothing you press is saved. The database still answers as you, so this shows their screens, not their permissions.' }),
      ]),
      el('button', {
        class: 'cx-btn mini primary',
        type: 'button',
        text: 'Back to my view',
        onClick: () => {
          active = 'org';
          rc.previewAs(null); // redraws, through RC_AUTH_CHANGED
        },
      }),
    ]);
  }

  /**
   * How much is waiting in the administrator's inbox, on the Organisation tab.
   * Filled when the count arrives, and absent when nothing is waiting or the
   * count could not be read — it is a prompt, and the inbox is the record.
   */
  function inboxBadge(button) {
    inboxCount()
      .then((n) => {
        if (!n) return;
        button.appendChild(el('span', { class: 'rc-tab-count', text: String(n), 'aria-label': `${n} waiting on you` }));
        button.title = `${n} thing${n === 1 ? '' : 's'} waiting on you — see Organisation → Inbox`;
      })
      .catch(() => {});
  }

  /** How many changes to your own days you have not seen yet, on the My day tab. */
  function unseenBadge(button) {
    myday.unseenCount()
      .then((n) => {
        if (!n) return;
        button.appendChild(el('span', { class: 'rc-tab-count rc-tab-count-info', text: String(n), 'aria-label': `${n} change${n === 1 ? '' : 's'} to your days` }));
        button.title = `${n} change${n === 1 ? '' : 's'} to your days since you last looked`;
      })
      .catch(() => {});
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

  /* No backend, the sign-in form and an account that is not on the team live in
     `ui/rc_gate.js`, because the phone app draws the same three and cannot
     import this module — it imports every tab, and through them the folder. */

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
