/**
 * Track access work requests, driven in a browser — part of `smoke_calendar.js`,
 * which calls it with a signed-in administrator's page and the stubbed backend.
 *
 * The whole flow an administrator walks: a week of the look-ahead becomes one
 * draft per location and shift; BART's form is checked and uploaded into the
 * private bucket; a name, a phone and a signature are saved once; the wording
 * for an activity is mapped; drafts follow the look-ahead without losing an
 * edit; a request is approved, downloaded as a filled PDF that reads back field
 * for field, revised, and a draft discarded.
 */

import path from 'node:path';
import url from 'node:url';
import { buildFormPdf } from './fixtures/tawr_fixture.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ed = await import(path.join(ROOT, 'src/core/la_edit.js'));
const tawr = await import(path.join(ROOT, 'src/core/tawr.js'));
const pdf = await import(path.join(ROOT, 'src/io/tawr_pdf.js'));

const FIELD_SPECS = tawr.TAWR_FIELDS.map(([name, kind]) => ({ name, kind }));

export async function tawrRequests(page, { check, shot = null }) {
  console.log('\nTrack access work requests');
  const snap = async (name) => { if (shot) await page.screenshot({ path: shot.replace(/\.png$/, `-${name}.png`), fullPage: true }); };
  const monday = ed.mondayOf(new Date().toISOString().slice(0, 10));
  const week = ed.addDaysISO(monday, 21);
  const day = (n) => ed.addDaysISO(week, n);
  const rows = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__rc.rows.rc_tawrs)));
  const live = async () => (await rows()).filter((r) => r.status !== 'superseded');
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.cx-toast')].map((t) => t.textContent).join(' | '));
  const cardFor = (name, shift) => page.locator('#rc-frame .rc-tawr-card', {
    has: page.locator('h4', { hasText: new RegExp(`^${name}$`) }),
  }).filter({ has: page.locator('.cx-badge', { hasText: new RegExp(`^${shift}$`) }) });
  const confirm = async (label) => {
    await page.waitForSelector('.cx-modal');
    await page.locator('.cx-modal .cx-modal-foot button', { hasText: label }).last().click();
    await page.waitForTimeout(300);
  };
  const settle = () => page.waitForTimeout(450);

  /* A reading: IXL and DCS at TPSS 12 (one through its alias) on day shift,
     a night shift at the same place, and a place nobody registered. */
  const model = ed.makeModel([
    ed.blankRow('section', { id: 'ts', sort: 1, description: 'TAWR week' }),
    ed.blankRow('activity', { id: 'ixl', sort: 2, description: 'IXL SIM Testing', location: 'TPSS 12', sswp: '660', work_hours: '0700-1500' }),
    ed.blankRow('activity', { id: 'dcs', sort: 3, description: 'DCS Testing', location: 'Traction Power 12', work_hours: '0900-1700' }),
    ed.blankRow('activity', { id: 'night', sort: 4, description: 'Cable pull', location: 'TPSS 12' }),
    ed.blankRow('activity', { id: 'lost', sort: 5, description: 'Survey', location: 'Mystery Yard', work_hours: '0800-1200' }),
  ], [
    { row_id: 'ixl', day: day(0), color: 'FFFF00', text: 'X.WIT' },
    { row_id: 'ixl', day: day(1), color: 'FFFF00', text: 'X.X' },
    { row_id: 'dcs', day: day(0), color: 'FFFF00', text: 'X' },
    { row_id: 'dcs', day: day(1), color: 'FFFF00', text: 'TCE' },
    { row_id: 'night', day: day(2), color: '0070C0', text: 'ROC' },
    { row_id: 'lost', day: day(3), color: 'FFFF00', text: '' },
  ]);
  const grid = ed.gridFromModel(model, ed.windowDays(monday, 4));
  const taken = new Date(Date.now() + 60_000).toISOString();
  await page.evaluate(({ grid: g, taken: t }) => {
    window.__rc.rows.rc_lookahead_snapshots.push({ id: 'snap-tawr', taken_at: t, file_hash: 'editor:tawr', sheet_name: '4WLA', grid: g });
    window.__rc.rows.rc_legend.push({ id: 'lg-night', argb: '0070C0', meaning: 'Night Shift', role: 'shift', valid_from: '2026-01-01', active: true });
  }, { grid, taken });

  await page.keyboard.press('Escape');
  if (!(await page.locator('#rc-frame').isVisible())) {
    await page.locator('.ws-btn', { hasText: 'Calendar' }).click();
    await page.waitForSelector('#rc-frame .rc-tabs', { timeout: 10000 });
  }
  const tab = page.locator('#rc-frame .rc-head .rc-tab', { hasText: /^TAWR$/ });
  check('an administrator is offered TAWR', (await tab.count()) === 1);
  await tab.click();
  await page.waitForSelector('#rc-frame .rc-tawr-weeks', { timeout: 10000 });
  await settle();

  check('a missing form is said before anything else',
    /blank form has not been uploaded/.test(await page.locator('#rc-frame .rc-tawr-notice').innerText().catch(() => '')));
  check('the week chosen is the first whose deadline has not passed',
    (await page.locator(`#rc-frame .rc-tawr-weeks .rc-tab[data-week="${week}"]`).getAttribute('aria-pressed')) === 'true');
  check('one card per location and shift', (await page.locator('#rc-frame .rc-tawr-card').count()) === 3,
    String(await page.locator('#rc-frame .rc-tawr-card').count()));
  const dayCard = cardFor('TPSS 12', 'Day');
  check('two activities at one place, one written by its alias, are one request',
    (await dayCard.count()) === 1 && /IXL SIM Testing · DCS Testing/.test(await dayCard.innerText()));
  check('support adds across activities, the busiest day asked for, the witness left off',
    /2 x EIC, TCE/.test(await dayCard.innerText()) && !/witness/i.test(await dayCard.innerText()));
  check('hours combine to the earliest start and the latest finish', /0700–1700/.test(await dayCard.innerText()));
  check('the night shift at the same place is its own request, ROC on the OCC line',
    /OCC: ROC/.test(await cardFor('TPSS 12', 'Night').innerText()));
  check('a night with no hours takes the night shift\'s', /2200–0600 \(shift hours\)/.test(await cardFor('TPSS 12', 'Night').innerText()));
  const lost = cardFor('Mystery Yard', 'Day');
  check('a place not in the location list is flagged, not guessed',
    /not in the location list/.test(await lost.innerText()));
  check('nothing is saved until somebody creates them', (await rows()).length === 0);
  await snap('week');

  /* ── Create ─────────────────────────────────────────────────────────── */
  await page.locator('#rc-frame [data-action="tawr-create"]').click();
  await settle();
  let saved = await live();
  check('creating makes one draft per request', saved.length === 3 && saved.every((r) => r.status === 'draft'),
    saved.map((r) => `${r.location_name}/${r.shift}/${r.status}`).join(', '));
  const dayRow = () => live().then((list) => list.find((r) => r.location_name === 'TPSS 12' && r.shift === 'day'));
  let d = await dayRow();
  check('the draft is filled from the look-ahead',
    d.fields.row1_date === tawr.formDate(day(0)) && d.fields.row1_day === 'MON' && d.fields.row1_time_end === '1700'
      && d.fields.maint_systems_tech_support_details === '2 x EIC, TCE' && d.fields.row1_power_na === true,
    JSON.stringify(d.fields).slice(0, 200));
  check('with the agreed defaults: No, No, No, Category F',
    d.fields.work_in_track_zone_no && d.fields.clearance_verification_no && d.fields.track_inspection_first_train_no
      && d.fields.category_of_work === 'F');
  check('an SSWP ticks its box and is written on the bottom line',
    d.fields.trans_sswp_iop_required_req === true && d.fields.trans_adverse_impact_blanket_details === 'SSWP# 660');
  check('a flagged request cannot be approved',
    await lost.locator('[data-action="tawr-approve"]').isDisabled());

  /* ── Setup ──────────────────────────────────────────────────────────── */
  await page.locator('#rc-frame [data-tawr-section="setup"]').click();
  await page.waitForSelector('#rc-frame [data-action="tawr-template"]');
  const fileInput = page.locator('#rc-frame input[data-action="tawr-template-file"]');
  const broken = buildFormPdf(FIELD_SPECS.filter((f) => f.name !== 'work_description' && f.name !== 'row7_area'));
  await fileInput.setInputFiles({ name: 'revised.pdf', mimeType: 'application/pdf', buffer: Buffer.from(broken) });
  await settle();
  check('a form missing fields is refused, naming them',
    /missing 2 fields.*work_description/.test(await toasts())
      && !(await page.evaluate(() => (window.__rc.uploads || []).some((u) => u.startsWith('tawr/')))));
  const blank = buildFormPdf(FIELD_SPECS);
  await fileInput.setInputFiles({ name: 'BART_TAWR.pdf', mimeType: 'application/pdf', buffer: Buffer.from(blank) });
  await settle();
  check('BART\'s form goes into the private bucket, never the site',
    await page.evaluate(() => (window.__rc.uploads || []).includes('tawr/template/tawr.pdf')));
  check('and what was uploaded is recorded', await page.evaluate(() => {
    const info = window.__rc.rows.rc_tawr_settings.find((r) => r.key === 'template_info');
    return info && JSON.parse(info.value).fields === 141;
  }));

  const profile = (key) => page.locator(`#rc-frame [data-tawr-profile="${key}"]`);
  await profile('requestor_name').fill('Alex Morgan');
  await profile('requestor_name').press('Enter');
  await settle();
  await profile('cell_phone').fill('(510) 555-0100');
  await profile('cell_phone').press('Enter');
  await settle();
  const pad = page.locator('#rc-frame canvas[data-action="tawr-signature-pad"]');
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 80);
  await page.mouse.down();
  for (const [x, y] of [[60, 30], [100, 90], [150, 40], [210, 85], [300, 50]]) await page.mouse.move(box.x + x, box.y + y, { steps: 4 });
  await page.mouse.up();
  await page.locator('#rc-frame [data-action="tawr-signature-save"]').click();
  await settle();
  const me = await page.evaluate(() => JSON.parse(JSON.stringify(window.__rc.rows.rc_tawr_profiles[0] || null)));
  check('an administrator saves their own name, phone and signature, once',
    me?.person_id === 'p1' && me.requestor_name === 'Alex Morgan' && me.cell_phone === '(510) 555-0100'
      && me.signature?.strokes?.[0]?.length > 5, JSON.stringify(me).slice(0, 160));

  const setting = page.locator('#rc-frame [data-tawr-setting="person_in_charge_name"]');
  await setting.fill('Pat Lee');
  await setting.press('Enter');
  await settle();
  check('the contacts on every request are settings',
    await page.evaluate(() => window.__rc.rows.rc_tawr_settings.some((r) => r.key === 'person_in_charge_name' && r.value === 'Pat Lee')));
  const hours = page.locator('#rc-frame [data-tawr-setting="hours_day"]');
  await hours.fill('daytime');
  await hours.press('Enter');
  await settle();
  check('shift hours that cannot be read are refused',
    !(await page.evaluate(() => window.__rc.rows.rc_tawr_settings.some((r) => r.key === 'hours_day'))));

  const chip = page.locator('#rc-frame [data-action="tawr-describe"]', { hasText: 'IXL SIM Testing' });
  check('activities on the look-ahead with no wording are offered', (await chip.count()) === 1);
  await chip.click();
  await page.waitForSelector('.cx-modal textarea');
  await page.locator('.cx-modal textarea').fill('IXL team will perform functional testing using CBTC equipment only within the train control room.');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Add' }).click();
  await settle();
  check('wording is mapped to an activity',
    await page.evaluate(() => window.__rc.rows.rc_tawr_descriptions.some((r) => r.activity === 'IXL SIM Testing')));
  await snap('setup');

  /* ── Drafts follow the look-ahead, edits survive ────────────────────── */
  await page.locator('#rc-frame [data-tawr-section="requests"]').click();
  await page.waitForSelector('#rc-frame [data-action="tawr-create"]');
  await page.locator('#rc-frame [data-action="tawr-create"]').click();
  await settle();
  d = await dayRow();
  check('updating a draft brings in the wording, the requestor and the contacts',
    d.fields.work_description.startsWith('IXL SIM Testing — IXL team will perform functional testing')
      && d.fields.requestor_name === 'Alex Morgan' && d.fields.person_in_charge_name === 'Pat Lee');

  await dayCard.locator('[data-action="tawr-review"]').click();
  await page.waitForSelector('.cx-modal .rc-tawr-form');
  await page.locator('.cx-modal select[data-field="category_of_work"]').selectOption('C');
  await page.locator('.cx-modal input[data-field="row1_time_end"]').fill('1800');
  await page.waitForTimeout(400);
  check('the review says whether it fits BART\'s form',
    /Fits the form/.test(await page.locator('.cx-modal .rc-tawr-fit').innerText()));
  await snap('review');
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Save draft' }).click();
  await settle();
  d = await dayRow();
  check('a draft is edited in review', d.fields.category_of_work === 'C' && d.fields.row1_time_end === '1800');

  await page.locator('#rc-frame [data-action="tawr-create"]').click();
  await settle();
  d = await dayRow();
  check('updating from the look-ahead again keeps every edit',
    d.fields.category_of_work === 'C' && d.fields.row1_time_end === '1800' && d.fields.row2_time_end === '1700');
  check('and the card says how many fields were changed by hand', /2 fields changed by hand/.test(await dayCard.innerText()));

  await dayCard.locator('[data-action="tawr-review"]').click();
  await page.waitForSelector('.cx-modal .rc-tawr-form');
  check('a changed field is marked as changed, in words as well as by outline',
    (await page.locator('.cx-modal .rc-tawr-edited').count()) >= 2
      && /Changed by hand/.test(await page.locator('.cx-modal .rc-tawr-edited').first().getAttribute('title')));
  await page.locator('.cx-modal .cx-modal-foot button', { hasText: 'Cancel' }).click();
  await page.waitForTimeout(200);

  /* ── Approve, download, revise, discard ─────────────────────────────── */
  await dayCard.locator('[data-action="tawr-approve"]').click();
  await confirm('Approve');
  await settle();
  d = await dayRow();
  check('approving makes it final, recording who and when', d.status === 'approved' && d.approved_by === 'p1' && !!d.approved_at);
  check('an approved request offers download and revision, not editing',
    (await dayCard.locator('[data-action="tawr-download"]').count()) === 1
      && (await dayCard.locator('[data-action="tawr-review"]').count()) === 0);

  await page.evaluate(() => { window.__saved = null; });
  await dayCard.locator('[data-action="tawr-download"]').click();
  await page.waitForFunction(() => window.__saved?.pdf, null, { timeout: 8000 }).catch(() => {});
  const savedName = await page.evaluate(() => window.__saved?.name);
  check('the PDF is named for the week, place and shift', savedName === `TAWR ${week} TPSS 12 Day.pdf`, savedName);
  const b64 = await page.evaluate(async () => {
    const buf = new Uint8Array(await window.__lastBlob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    return btoa(s);
  });
  const out = new Uint8Array(Buffer.from(b64, 'base64'));
  const back = pdf.readForm(out);
  const v = (name) => back.fields.find((f) => f.name === name)?.value;
  check('the downloaded form reads back field for field',
    v('row1_area') === 'TPSS 12' && v('category_of_work') === 'C' && v('row1_time_end') === '1800'
      && v('requestor_name') === 'Alex Morgan' && v('person_in_charge_name') === 'Pat Lee' && v('row1_power_na') === 'Yes',
    `${v('row1_area')} ${v('category_of_work')} ${v('requestor_name')}`);
  check('it is BART\'s form with the fill appended, not a new document',
    Buffer.from(out.subarray(0, blank.length)).equals(Buffer.from(blank)));
  check('and it carries the signature, drawn on the requestor line',
    /1 J\n1 j/.test(Buffer.from(out.subarray(blank.length)).toString('latin1')));

  await dayCard.locator('[data-action="tawr-revise"]').click();
  await confirm('Revise');
  await settle();
  const all = await rows();
  const revision = all.find((r) => r.location_name === 'TPSS 12' && r.shift === 'day' && r.status === 'draft');
  check('revising keeps the approved one as superseded and opens a draft carrying it',
    all.some((r) => r.id === d.id && r.status === 'superseded') && revision?.supersedes === d.id
      && revision.fields.category_of_work === 'C');

  const nightCard = cardFor('TPSS 12', 'Night');
  await nightCard.locator('[data-action="tawr-discard"]').click();
  await confirm('Discard');
  await settle();
  check('a draft can be discarded', !(await live()).some((r) => r.shift === 'night'));

  // Put the shared stub back the way the rest of the suite found it.
  await page.evaluate(() => {
    const S = window.__rc;
    S.rows.rc_lookahead_snapshots = S.rows.rc_lookahead_snapshots.filter((s) => s.id !== 'snap-tawr');
    S.rows.rc_legend = S.rows.rc_legend.filter((l) => l.id !== 'lg-night');
  });
}
