/**
 * PTO, looking further ahead: two, four, eight or thirteen weeks from any
 * Monday; the month over its days and today as a column; a stretch of leave
 * one bar with its kind written in it; a quarter on one screen; and the list
 * under it holding every record — these weeks, everything from today on, or
 * everything ever booked, cancelled too when asked.
 *
 * `ptoViews()` runs inside `smoke_calendar.js` straight after the PTO checks,
 * while the look-ahead is still read from the workbook; `ptoPastTheReading()`
 * runs after the editor has adopted it, and writes a name on the editor's PTO
 * row two months out — past the newest reading — to see it read from there.
 * Every date is worked out from "today": CI runs this on a Wednesday and on a
 * Monday.
 */

const DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

async function openPto(page) {
  await page.locator('#rc-frame .rc-head .rc-tab', { hasText: 'PTO' }).click();
  await page.waitForSelector('#rc-frame .rc-pto-grid', { timeout: 10000 });
}

async function span(page, label) {
  await page.locator('#rc-frame .rc-pto-spans .rc-tab', { hasText: label }).click();
  await page.waitForFunction((l) => document.querySelector('#rc-frame .rc-pto-spans .rc-tab[aria-pressed="true"]')?.textContent === l,
    label, { timeout: 8000 });
}

/** The days the grid draws, and the days of one person's row that a class covers. */
const gridState = (page, who = null, klass = null) => page.evaluate(([w, k]) => {
  const days = [...document.querySelectorAll('#rc-frame .rc-pto-grid thead th.rc-pto-day')].length;
  const frame = document.querySelector('#rc-frame .rc-pto-grid')?.closest('.rc-scroll');
  const row = w ? [...document.querySelectorAll('#rc-frame .rc-pto-grid tbody tr')]
    .find((tr) => tr.querySelector('.rc-pto-person')?.textContent === w) : null;
  const runs = row && k ? [...row.querySelectorAll(`td.${k}`)].map((td) => ({
    from: td.dataset.from, to: td.dataset.to, span: Number(td.colSpan), text: td.textContent, title: td.title,
  })) : [];
  return {
    days,
    fits: frame ? frame.scrollWidth <= frame.clientWidth + 1 : false,
    rows: [...document.querySelectorAll('#rc-frame .rc-pto-grid tbody tr .rc-pto-person')].map((n) => n.textContent),
    runs,
    range: document.querySelector('#rc-frame .rc-pto-range')?.textContent || '',
  };
}, [who, klass]);

export async function ptoViews(page, { check }) {
  console.log('\nPTO, further ahead');
  await openPto(page);
  const today = await page.evaluate(() => window.__CX_MODULES.req('ui/rc_util.js').todayISO());
  const todayMs = Date.parse(`${today}T00:00:00Z`);

  /* Leave booked two months out, a month gone, and one cancelled — what a
     four-week window and a list of only that window could never show. */
  const booked = await page.evaluate(async ([a, b, c, d]) => {
    const rc = window.__CX_MODULES.req('core/rc.js');
    const far = await rc.addLeave({ person_id: 'p3', kind_id: 'k1', start_date: a, end_date: b, note: 'Far ahead' });
    const gone = await rc.addLeave({ person_id: 'p6', kind_id: 'k1', start_date: c, end_date: c, note: 'Long gone' });
    const off = await rc.addLeave({ person_id: 'p5', kind_id: 'k1', start_date: d, end_date: d, note: 'Called off' });
    await rc.updateLeave(off.id, { status: 'cancelled' });
    return { far: far.id, gone: gone.id, off: off.id };
  }, [iso(todayMs + 60 * DAY), iso(todayMs + 66 * DAY), iso(todayMs - 30 * DAY), iso(todayMs + 5 * DAY)]);
  // Redrawn by opening the tab again, as anybody switching back to it would.
  await page.locator('#rc-frame .rc-head .rc-tab', { hasText: 'Lists' }).click();
  await openPto(page);

  const pressed = await page.locator('#rc-frame .rc-pto-spans .rc-tab[aria-pressed="true"]').innerText();
  check('the calendar offers 2, 4, 8 and 13 weeks, and opens on four',
    JSON.stringify(await page.locator('#rc-frame .rc-pto-spans .rc-tab').allInnerTexts()) === JSON.stringify(['2 weeks', '4 weeks', '8 weeks', '13 weeks'])
      && pressed === '4 weeks', pressed);
  check('the month is written over its days', (await page.locator('#rc-frame .rc-pto-grid thead th.rc-pto-month').count()) >= 1);
  const todayCol = await page.evaluate(() => {
    const th = document.querySelector('#rc-frame .rc-pto-grid thead th.rc-pto-today');
    const td = document.querySelector('#rc-frame .rc-pto-grid tbody td.rc-pto-today');
    const wash = (n) => (n ? getComputedStyle(n).backgroundColor : '');
    return { head: wash(th), cell: wash(td), line: td ? getComputedStyle(td).borderLeftWidth : '' };
  });
  check('today is a column, washed down the grid — not a hairline',
    Boolean(todayCol.cell) && !/rgba\(0, 0, 0, 0\)|transparent/.test(todayCol.cell) && todayCol.line !== '2px', JSON.stringify(todayCol));
  const uma = await gridState(page, 'Uma', 'rc-pto-booked');
  check('a stretch of leave is one bar with its kind written in it',
    uma.runs.length === 1 && uma.runs[0].span >= 2 && /Annual leave/.test(uma.runs[0].text) && /booked/.test(uma.runs[0].title),
    JSON.stringify(uma.runs));
  const priyaNow = await gridState(page, 'Priya', 'rc-pto-booked');
  check('leave two months out is past the four weeks shown', !priyaNow.runs.some((r) => r.from >= iso(todayMs + 60 * DAY)));

  // The list holds every record, not only the window's.
  const listed = () => page.locator('#rc-frame .rc-pto-leave tbody tr').evaluateAll((rows) => rows.map((r) => r.dataset.leave));
  check('the list opens on everything from today on — leave two months out included',
    (await page.locator('#rc-frame .rc-pto-scopes .rc-tab[aria-pressed="true"]').innerText()) === 'From today on'
      && (await listed()).includes(booked.far) && !(await listed()).includes(booked.gone));
  await page.locator('#rc-frame .rc-pto-scopes .rc-tab', { hasText: 'In these weeks' }).click();
  await page.waitForSelector('#rc-frame .rc-pto-scopes .rc-tab[aria-pressed="true"]:has-text("In these weeks")');
  check('"In these weeks" is the window alone, as the list used to be', !(await listed()).includes(booked.far));
  await page.locator('#rc-frame .rc-pto-scopes .rc-tab', { hasText: 'Everything' }).click();
  await page.waitForSelector('#rc-frame .rc-pto-scopes .rc-tab[aria-pressed="true"]:has-text("Everything")');
  const everything = await listed();
  check('"Everything" reaches the leave already taken, and says it was taken',
    everything.includes(booked.gone) && everything.includes(booked.far) && !everything.includes(booked.off)
      && /Taken/.test(await page.locator(`#rc-frame tr[data-leave="${booked.gone}"]`).innerText()));
  await page.locator('#rc-frame .rc-pto-list .cx-check', { hasText: 'Show cancelled' }).locator('input').check();
  await page.waitForFunction((id) => Boolean(document.querySelector(`#rc-frame tr[data-leave="${id}"]`)), booked.off, { timeout: 8000 }).catch(() => {});
  check('and "Show cancelled" makes it the whole record, cancelled leave marked so',
    /Cancelled/.test(await page.locator(`#rc-frame tr[data-leave="${booked.off}"]`).innerText().catch(() => '')));
  await page.locator('#rc-frame .rc-pto-list-who').selectOption('p3');
  await page.waitForFunction(() => [...document.querySelectorAll('#rc-frame .rc-pto-leave tbody tr td:first-child')].every((td) => td.textContent === 'Priya'), null, { timeout: 8000 }).catch(() => {});
  const priyas = await page.locator('#rc-frame .rc-pto-leave tbody tr td:first-child').allInnerTexts();
  check('one person\'s leave can be listed alone', priyas.length >= 1 && priyas.every((n) => n === 'Priya'), priyas.join(', '));
  check('each record says how many working days it takes', /\b5\b/.test(await page.locator(`#rc-frame tr[data-leave="${booked.far}"] td.rc-num`).innerText()));

  // "Show" puts the calendar on the weeks the leave starts in.
  await page.locator(`#rc-frame tr[data-leave="${booked.far}"] button`, { hasText: 'Show' }).click();
  await page.waitForFunction((d) => (document.querySelector('#rc-frame .rc-pto-grid tbody tr td.rc-pto-booked[data-from]') && [...document.querySelectorAll('#rc-frame td.rc-pto-booked')].some((t) => t.dataset.from === d)),
    iso(todayMs + 60 * DAY), { timeout: 8000 }).catch(() => {});
  const shown = await gridState(page, 'Priya', 'rc-pto-booked');
  check('"Show" puts the calendar on the weeks that leave starts in',
    shown.runs.some((r) => r.from === iso(todayMs + 60 * DAY)) && (await page.locator('#rc-frame .la-pager button', { hasText: 'This week' }).isEnabled()),
    `${shown.range}: ${JSON.stringify(shown.runs)}`);
  await page.locator('#rc-frame .la-pager button', { hasText: 'This week' }).click();
  await page.waitForFunction(() => !document.querySelector('#rc-frame .la-pager button:enabled[title^="Start on"]'), null, { timeout: 8000 }).catch(() => {});

  // A month or two at once.
  await span(page, '8 weeks');
  const eight = await gridState(page, 'Priya', 'rc-pto-booked');
  check('eight weeks is the next two months, at a glance — every day on screen, nothing to scroll',
    eight.days === 56 && eight.fits, `${eight.days} days, fits: ${eight.fits}`);
  await span(page, '13 weeks');
  const quarter = await gridState(page, 'Priya', 'rc-pto-booked');
  check('thirteen weeks is a quarter, still on one screen — and reaches the leave two months out',
    quarter.days === 91 && quarter.fits && quarter.runs.some((r) => r.from === iso(todayMs + 60 * DAY)),
    `${quarter.days} days, fits: ${quarter.fits}, ${JSON.stringify(quarter.runs)}`);
  check('its weeks dated by their Mondays, every day still saying its date when pointed at',
    await page.evaluate(() => {
      const heads = [...document.querySelectorAll('#rc-frame .rc-pto-grid thead th.rc-pto-day')];
      return heads.every((th) => /\d/.test(th.title)) && heads.filter((th) => /\d/.test(th.textContent)).length < heads.length / 3;
    }));

  // Only the people with something on.
  const everybody = (await gridState(page)).rows.length;
  await page.locator('#rc-frame .rc-pto-options .cx-check', { hasText: 'Only people with time off' }).locator('input').check();
  await page.waitForFunction((n) => document.querySelectorAll('#rc-frame .rc-pto-grid tbody .rc-pto-person').length < n, everybody, { timeout: 8000 }).catch(() => {});
  const some = (await gridState(page)).rows;
  check('"Only people with time off" leaves out the empty rows',
    some.length < everybody && some.includes('Priya') && some.includes('Uma'), `${everybody} → ${some.join(', ')}`);

  // From any date: the week it falls in.
  const target = iso(todayMs + 40 * DAY);
  await page.locator('#rc-frame .rc-pto-jump').fill(target);
  await page.locator('#rc-frame .rc-pto-jump').dispatchEvent('change');
  await page.waitForTimeout(400);
  const jumped = await page.locator('#rc-frame .rc-pto-jump').inputValue();
  const dow = new Date(`${jumped}T00:00:00Z`).getUTCDay();
  check('"From" a date starts the calendar on its Monday', dow === 1 && jumped <= target && jumped > iso(todayMs + 33 * DAY), `${target} → ${jumped}`);

  // Back as it was, for whatever comes next.
  await page.locator('#rc-frame .rc-pto-options .cx-check', { hasText: 'Only people with time off' }).locator('input').uncheck();
  await page.waitForTimeout(300);
  await span(page, '4 weeks');
  await page.locator('#rc-frame .la-pager button', { hasText: 'This week' }).click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('#rc-frame .rc-pto-list-who').selectOption('');
  await page.waitForTimeout(300);
  await page.locator('#rc-frame .rc-pto-list .cx-check', { hasText: 'Show cancelled' }).locator('input').uncheck();
  await page.waitForTimeout(300);
  await page.locator('#rc-frame .rc-pto-scopes .rc-tab', { hasText: 'From today on' }).click();
  await page.waitForTimeout(300);
}

/**
 * Once the look-ahead is written here, a name on the editor's PTO row two
 * months out — past what the newest reading covers — is drawn on PTO, read
 * from the editor's tables the way the look-ahead's own read view pages past
 * its reading.
 */
export async function ptoPastTheReading(page, { check }) {
  console.log('\nPTO past the reading');
  const today = await page.evaluate(() => window.__CX_MODULES.req('ui/rc_util.js').todayISO());
  const day = iso(Date.parse(`${today}T00:00:00Z`) + 55 * DAY);
  const wrote = await page.evaluate((d) => {
    const S = window.__rc.rows;
    const row = (S.rc_la_rows || []).find((r) => r.kind === 'absence' && (r.absence_kind || 'pto') === 'pto' && !r.archived);
    if (!row) return null;
    S.rc_la_cells.push({ row_id: row.id, day: d, color: null, text: 'Rosa', version: 1 });
    // Written behind the client's back, so what it remembers reading is forgotten.
    window.__CX_MODULES.req('core/rc.js').forgetReads();
    return row.id;
  }, day);
  check('the editor holds a PTO row to write a name on', Boolean(wrote));
  await openPto(page);
  await span(page, '13 weeks');
  const rosa = await gridState(page, 'Rosa', 'rc-pto-sheet');
  check('a name on the editor\'s PTO row two months out is on PTO — read past the newest reading',
    rosa.runs.some((r) => r.from <= day && r.to >= day), `${day}: ${JSON.stringify(rosa.runs)}`);
  check('and nothing says the sheet stops short, because it does not',
    (await page.locator('#rc-frame .rc-pto-coverage').count()) === 0);
  await span(page, '4 weeks');
}
