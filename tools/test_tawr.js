#!/usr/bin/env node
/**
 * Track access work requests — the reading of a look-ahead week into requests,
 * and the PDF form they are written into. No browser, no network.
 *
 * Every rule agreed for the form is here as a check: one request per location
 * and shift, hours combined, support added across activities with the busiest
 * day asked for, witnesses left off, ROC on the OCC line, SSWP numbers on the
 * bottom line, an unknown location or colour stopping approval. And the form
 * itself: filled, read back through the same parser, its appearances made to
 * fit, the signature drawn, and the original bytes left untouched.
 *
 *   node tools/test_tawr.js
 */

import path from 'node:path';
import url from 'node:url';
import { buildFormPdf } from './fixtures/tawr_fixture.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const tawr = await import(path.join(ROOT, 'src/core/tawr.js'));
const pdf = await import(path.join(ROOT, 'src/io/tawr_pdf.js'));
const ed = await import(path.join(ROOT, 'src/core/la_edit.js'));
const la = await import(path.join(ROOT, 'src/io/lookahead.js'));
const cls = await import(path.join(ROOT, 'src/core/lookahead.js'));

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  const line = `${name}${detail ? ` — ${detail}` : ''}`;
  if (ok) {
    passed++;
    console.log(`  ✓ ${line}`);
  } else {
    failures.push(line);
    console.log(`  ✗ ${line}`);
  }
}

const LEGEND = [
  { argb: 'FFFF00', meaning: 'Day Shift', role: 'shift' },
  { argb: '0070C0', meaning: 'Night Shift', role: 'shift' },
  { argb: '000000', meaning: 'Blanket Shift', role: 'shift' },
  { argb: 'FF0000', meaning: 'Cancellation', role: 'shift' },
  { argb: '7F7F7F', meaning: 'Weekend', role: 'ignore' },
];
const CODES = [
  { code: 'X', name: 'EIC', party: 'BART', sort: 10, tawr_line: 'systems' },
  { code: 'WIT', name: 'BART witness', party: 'BART', sort: 20, tawr_line: 'none' },
  { code: 'TCE', name: 'TCE', party: 'BART', sort: 30, tawr_line: 'systems' },
  { code: 'ROC', name: 'ROC', party: 'BART', sort: 40, tawr_line: 'occ' },
];
const LOCATIONS = [
  { id: 'l-w34', name: 'W34', tawr_area: 'Train Control Room, W34' },
  { id: 'l-y10', name: 'Y10', tawr_area: '' },
];
const resolveLocation = (raw) => LOCATIONS.find((l) => tawr.fold(l.name) === tawr.fold(raw)) || null;

const MON = '2026-10-19';
const day = (n) => tawr.addDaysISO(MON, n);

/** A look-ahead, written the way the editor writes one, read the way every screen reads it. */
function viewOf(rows, cells) {
  const model = ed.makeModel(rows, cells);
  const days = ed.windowDays(MON, 2);
  return cls.readGrid(la.applyLegend(ed.gridFromModel(model, days), LEGEND), { anchorISO: '2026-10-02' });
}

function sample() {
  const rows = [
    ed.blankRow('section', { id: 's1', sort: 1, description: 'W34 — Testing' }),
    ed.blankRow('activity', { id: 'ixl', sort: 2, description: 'IXL SIM Testing', location: 'W34', sswp: '660', work_hours: '0700-1500' }),
    ed.blankRow('resource', { id: 'ixl-r', parent_id: 'ixl', sort: 3 }),
    ed.blankRow('activity', { id: 'dcs', sort: 4, description: 'DCS Testing', location: 'W34', work_hours: '0900-1700' }),
    ed.blankRow('activity', { id: 'night', sort: 5, description: 'Cable pull', location: 'W34', work_hours: '' }),
    ed.blankRow('activity', { id: 'y10', sort: 6, description: 'Track bonding', location: 'Y10', sswp: '671', work_hours: 'TBD' }),
    ed.blankRow('activity', { id: 'blanket', sort: 7, description: 'Signal test', location: 'Y10', work_hours: '' }),
    ed.blankRow('activity', { id: 'nowhere', sort: 8, description: 'Survey', location: 'Mystery Yard', work_hours: '0800-1200' }),
    ed.blankRow('activity', { id: 'noloc', sort: 9, description: 'Walkdown', location: '', work_hours: '' }),
    ed.blankRow('activity', { id: 'odd', sort: 10, description: 'Odd colour', location: 'Y10', work_hours: '' }),
    ed.blankRow('absence', { id: 'pto', sort: 11, description: 'PTO', absence_kind: 'pto' }),
  ];
  const cells = [
    // IXL Mon–Fri day shift, an EIC and a witness Mon, two EICs on Wed, cancelled Thu.
    { row_id: 'ixl', day: day(0), color: 'FFFF00', text: 'X.WIT' },
    { row_id: 'ixl', day: day(1), color: 'FFFF00', text: '' },
    { row_id: 'ixl', day: day(2), color: 'FFFF00', text: 'X.X' },
    { row_id: 'ixl', day: day(3), color: 'FF0000', text: 'X' },
    { row_id: 'ixl', day: day(4), color: 'FFFF00', text: 'X.~WIT' },
    { row_id: 'ixl-r', day: day(0), color: null, text: 'Victor, Rosa' },
    // DCS Mon–Tue day shift at the same place, its own EIC on Mon, a TCE Tue.
    { row_id: 'dcs', day: day(0), color: 'FFFF00', text: 'X' },
    { row_id: 'dcs', day: day(1), color: 'FFFF00', text: 'TCE' },
    // Night shift at the same place: a request of its own. Painted on the week after too.
    { row_id: 'night', day: day(1), color: '0070C0', text: 'ROC' },
    { row_id: 'night', day: day(8), color: '0070C0', text: 'X' },
    // Y10: unreadable hours, day shift; a blanket the next day.
    { row_id: 'y10', day: day(2), color: 'FFFF00', text: 'X.ZZ' },
    { row_id: 'blanket', day: day(5), color: '000000', text: 'X' },
    { row_id: 'nowhere', day: day(0), color: 'FFFF00', text: '' },
    { row_id: 'noloc', day: day(0), color: 'FFFF00', text: '' },
    { row_id: 'odd', day: day(3), color: 'ABCDEF', text: '' },
    { row_id: 'pto', day: day(1), color: null, text: 'Dana' },
  ];
  return viewOf(rows, cells);
}

const DESCRIPTIONS = [
  { activity: 'ixl sim testing', description: 'IXL team will perform functional testing using CBTC equipment only within the train control room.' },
];

const { groups, columns } = tawr.extractWeek(sample(), MON, {
  resolveLocation, codes: CODES, descriptions: DESCRIPTIONS, shiftHours: tawr.DEFAULT_SHIFT_HOURS,
});
const byKey = (loc, shift) => groups.find((g) => (g.locationId === loc || g.rawLocation === loc) && g.shift === shift);

/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\nThe field list');
{
  const names = tawr.TAWR_FIELDS.map((f) => f[0]);
  check('every field on the form is listed once', names.length === 141 && new Set(names).size === names.length);
  check('the seven date rows are all there', [1, 2, 3, 4, 5, 6, 7].every((n) => names.includes(`row${n}_date`) && names.includes(`row${n}_time_end`)));
  check('the two signatures are known as signatures', tawr.FIELD_KIND.get('requestor_signature') === 'sig');
}

console.log('\nOne request per location and shift');
{
  check('the columns are found off the sheet\'s own headings',
    columns.location >= 0 && columns.hours >= 0 && columns.sswp >= 0 && columns.description >= 0);
  const w34day = byKey('l-w34', 'day');
  check('two activities at one place on one shift are one request', !!w34day && w34day.activities.length === 2,
    w34day?.activities.map((a) => a.title).join(', '));
  check('the same place on a night shift is a second request', !!byKey('l-w34', 'night'));
  check('a blanket at another place is its own request', !!byKey('l-y10', 'possession'));
  check('a place nobody registered still gets a request — flagged', !!byKey('Mystery Yard', 'day'));
  check('a colour the legend does not know is not assumed to be a day shift', !!groups.find((g) => g.shift === 'unmapped'));
  check('PTO is never a request', !groups.some((g) => /pto/i.test(g.rawLocation)));
  check('requests are listed by place, then shift',
    groups.map((g) => g.locationName).join('|') === [...groups.map((g) => g.locationName)].sort((a, b) => a.localeCompare(b)).join('|'));
}

console.log('\nDays and hours');
{
  const g = byKey('l-w34', 'day');
  check('each day worked is one row, Monday first', g.days.map((d) => d.date).join() === [day(0), day(1), day(2), day(4)].join());
  check('a cancelled day asks for nothing', !g.days.some((d) => d.date === day(3)));
  const mon = g.days[0];
  check('hours combine: earliest start, latest finish', mon.start === '0700' && mon.end === '1700', `${mon.start}-${mon.end}`);
  const wed = g.days.find((d) => d.date === day(2));
  check('a day only one activity works has that activity\'s hours', wed.start === '0700' && wed.end === '1500');
  const night = byKey('l-w34', 'night');
  check('missing hours on a night shift are the night shift\'s', night.days[0].start === '2200' && night.days[0].end === '0600' && night.days[0].fromShift);
  check('days outside the week are not on its request', night.days.length === 1);
  const blanket = byKey('l-y10', 'possession');
  check('a blanket with no hours is 0000-0800', blanket.days[0].start === '0000' && blanket.days[0].end === '0800');
  const y10 = byKey('l-y10', 'day');
  check('hours nobody can read fall back to the shift, and say so',
    y10.days[0].start === '0700' && y10.flags.some((f) => f.kind === 'hours_unreadable' && !f.blocking));
  check('the first day is the first day worked', g.firstDay === day(0));
}

console.log('\nCombining hours');
{
  const h = tawr.parseHours;
  check('"0700-1500", "07:00 – 15:30" and "7:00-15:00" all read',
    h('0700-1500').start === 420 && h('07:00 – 15:30').end === 930 && h('7:00-15:00').start === 420);
  check('words are not hours', h('TBD') === null && h('') === null && h('days') === null);
  const n = tawr.combineHours([h('2200-0600'), h('2300-0700')], 'night');
  check('a night that runs later wins, past midnight', tawr.hhmm(n.start) === '2200' && tawr.hhmm(n.end) === '0700');
  const s = tawr.combineHours([h('0100-0500'), h('2200-0400')], 'night');
  check('a start in the small hours is the same night, not the morning before', tawr.hhmm(s.start) === '2200' && tawr.hhmm(s.end) === '0500');
  check('shift hours are by shift, not colour', tawr.shiftOfMeaning('Night Shift') === 'night'
    && tawr.shiftOfMeaning('Blanket') === 'possession' && tawr.shiftOfMeaning('Day Shift') === 'day'
    && tawr.shiftOfMeaning(null) === null);
}

console.log('\nSupport');
{
  const g = byKey('l-w34', 'day');
  const x = g.support.find((s) => s.code === 'X');
  check('an EIC on IXL and an EIC on DCS the same day is two', x?.count === 2, String(x?.count));
  check('a witness is never on the form', !g.support.some((s) => s.code === 'WIT'));
  const struck = tawr.extractWeek(viewOf([
    ed.blankRow('activity', { id: 'a', sort: 1, description: 'A', location: 'W34' }),
  ], [{ row_id: 'a', day: day(0), color: 'FFFF00', text: 'X.~X.~TCE' }]), MON, { resolveLocation, codes: CODES }).groups[0];
  check('a struck-out code is not asked for', struck.support.length === 1 && struck.support[0].count === 1);
  const tce = g.support.find((s) => s.code === 'TCE');
  check('every other BART code goes on Technical Support (Systems)', tce?.line === 'systems' && x.line === 'systems');
  const night = byKey('l-w34', 'night');
  check('ROC goes on the OCC line', night.support.length === 1 && night.support[0].line === 'occ');
  const solo = tawr.extractWeek(viewOf([
    ed.blankRow('activity', { id: 'a', sort: 1, description: 'A', location: 'W34' }),
    ed.blankRow('activity', { id: 'b', sort: 2, description: 'B', location: 'W34' }),
  ], [
    { row_id: 'a', day: day(0), color: 'FFFF00', text: 'X' },
    { row_id: 'b', day: day(1), color: 'FFFF00', text: 'X' },
  ]), MON, { resolveLocation, codes: CODES }).groups[0];
  check('one EIC on different days is one EIC', solo.support[0].count === 1);
  const values = tawr.formValues(solo);
  check('…written "EIC"', values.maint_systems_tech_support_details === 'EIC' && values.maint_systems_tech_support_req === true);
  const fields = tawr.formValues(g);
  check('two are written "2 x EIC", the other codes after', fields.maint_systems_tech_support_details === '2 x EIC, TCE',
    fields.maint_systems_tech_support_details);
  const y10 = byKey('l-y10', 'day');
  check('a code not in the register is listed and flagged, never dropped',
    y10.support.some((s) => s.code === 'ZZ') && y10.flags.some((f) => f.kind === 'code_unknown'));
  check('codes the register has never been told about land where agreed',
    tawr.lineOfCode('WIT', new Map()) === 'none' && tawr.lineOfCode('ROC', new Map()) === 'occ' && tawr.lineOfCode('X', new Map()) === 'systems');
  check('names on a Resource row are never codes', !g.support.some((s) => /VICTOR|ROSA/.test(s.code)));
}

console.log('\nWhat cannot be guessed');
{
  const lost = byKey('Mystery Yard', 'day');
  check('a location not in the list stops approval', tawr.blockers(lost).some((f) => f.kind === 'location_unmatched'));
  const none = groups.find((g) => !g.rawLocation);
  check('an activity with no location stops approval', tawr.blockers(none).some((f) => f.kind === 'no_location'));
  const odd = groups.find((g) => g.shift === 'unmapped');
  check('an unmapped colour stops approval, and names the colour',
    tawr.blockers(odd).some((f) => f.kind === 'colour_unmapped' && /ABCDEF/.test(f.message)));
  check('a clean request has nothing stopping it', tawr.blockers(byKey('l-w34', 'day')).length === 0);
}

console.log('\nThe form values');
{
  const g = byKey('l-w34', 'day');
  const v = tawr.formValues(g, {
    settings: { person_in_charge_name: 'Pat Lee', person_in_charge_cell_phone: '555-0101', project_rep_name: 'Rae Kim', project_rep_cell_phone: '555-0102' },
    profile: { requestor_name: 'Alex Morgan', cell_phone: '555-0100' },
  });
  check('the description is the activity with its expanded wording',
    v.work_description.startsWith('IXL SIM Testing — IXL team will perform functional testing') && v.work_description.includes('\nDCS Testing'));
  check('an activity with no wording mapped is listed by name, and said to be', g.unexpanded.join() === 'DCS Testing');
  check('rows carry date, day, hours and area', v.row1_date === '10/19/2026' && v.row1_day === 'MON'
    && v.row1_time_start === '0700' && v.row1_time_end === '1700' && v.row1_area === 'Train Control Room, W34');
  check('the form\'s own day spellings', tawr.formDay(day(1)) === 'TUES' && tawr.formDay(day(3)) === 'THURS' && tawr.formDay(day(6)) === 'SUN');
  check('an unused row stays empty', v.row5_date === undefined);
  check('power is N/A on every row used', v.row1_power_na && v.row4_power_na && !v.row5_power_na);
  check('the Yes/No questions are No by default', v.work_in_track_zone_no && v.clearance_verification_no && v.track_inspection_first_train_no
    && !v.work_in_track_zone_yes);
  check('Category of Work is F by default', v.category_of_work === 'F');
  check('contacts come from settings, the requestor from the administrator raising it',
    v.person_in_charge_name === 'Pat Lee' && v.project_rep_cell_phone === '555-0102' && v.requestor_name === 'Alex Morgan' && v.requestor_cell_phone === '555-0100');
  check('an SSWP ticks the box and goes on the bottom line', v.trans_sswp_iop_required_req === true && v.trans_adverse_impact_blanket_details === 'SSWP# 660');
  check('without one, both stay empty', !tawr.formValues(byKey('l-w34', 'night')).trans_sswp_iop_required_req);
  check('a location with no TAWR area uses its name', byKey('l-y10', 'day').area === 'Y10');
  check('approval signatures are never filled', !Object.keys(v).some((k) => k.startsWith('appr_')));
}

console.log('\nThe deadline');
{
  check('seventeen days before the first day', tawr.tawrDeadline('2026-10-19') === '2026-10-02');
  const s = tawr.deadlineState('2026-10-19', '2026-09-30');
  check('two days out is a warning', s.daysLeft === 2 && s.tone === 'warn' && s.label === 'Due in 2 days');
  check('passed is overdue', tawr.deadlineState('2026-10-19', '2026-10-04').tone === 'bad'
    && tawr.deadlineState('2026-10-19', '2026-10-04').label === 'Overdue by 2 days');
  check('the weeks a reading covers are its Mondays', tawr.weeksIn(sample()).join() === `${MON},${day(7)}`);
}

console.log('\nEditing, regenerating, approving');
{
  const fresh = tawr.formValues(byKey('l-w34', 'day'));
  const fields = { ...fresh, category_of_work: 'C', row1_time_end: '1800' };
  check('what was changed by hand is known', tawr.editedKeys(fields, fresh).join() === 'category_of_work,row1_time_end');
  const moved = { ...fresh, row1_time_end: '1900', row2_time_end: '1600' };
  const merged = tawr.mergeRegenerated({ fields, generated: fresh }, moved);
  check('a regenerated draft keeps every edit', merged.fields.category_of_work === 'C' && merged.fields.row1_time_end === '1800');
  check('and takes the new value wherever nobody edited', merged.fields.row2_time_end === '1600');
  check('an edit the look-ahead moved under is named', merged.conflicts.join() === 'row1_time_end');
  check('the look-ahead changing after approval is seen', tawr.changedSince(fresh, moved).join() === 'row1_time_end,row2_time_end');
  check('contacts changing in settings is not a look-ahead change',
    tawr.changedSince(fresh, { ...fresh, person_in_charge_name: 'Someone' }).length === 0);
  check('the file is named for the week, place and shift',
    tawr.tawrFileName({ weekStart: MON, locationName: 'W34 / Yard', shift: 'possession' }) === 'TAWR 2026-10-19 W34 - Yard Blanket.pdf');
}

/* ══════════════════════════════════════════════════════════════════════════
   The PDF form
   ═══════════════════════════════════════════════════════════════════════ */

const fieldSpecs = tawr.TAWR_FIELDS.map(([name, kind]) => ({ name, kind }));

for (const variant of ['classic', 'compressed']) {
  console.log(`\nThe form (${variant === 'classic' ? 'a classic cross-reference table' : 'object and cross-reference streams'})`);
  const blank = buildFormPdf(fieldSpecs, { compressed: variant === 'compressed' });
  const form = pdf.readForm(blank);
  check('every field is found by name', form.fields.length === 141, String(form.fields.length));
  const missing = pdf.missingFields(form, tawr.TAWR_FIELDS.map((f) => f[0]));
  check('a template with every field passes the check', missing.length === 0, missing.join(', '));
  check('a checkbox knows its on state', form.fields.find((f) => f.name === 'row1_power_na')?.onState === 'Yes');
  check('a dropdown knows its options', form.fields.find((f) => f.name === 'row1_day')?.options?.includes('THURS'));

  const g = byKey('l-w34', 'day');
  const values = tawr.formValues(g, { settings: { person_in_charge_name: 'Pat Lee' }, profile: { requestor_name: 'Alex Morgan', cell_phone: '555-0100' } });
  values.work_description = `${values.work_description}\n${'A long line of further detail about the work. '.repeat(18)}`;
  const signature = { width: 300, height: 100, strokes: [[[10, 50], [60, 20], [120, 80], [200, 30], [290, 60]]] };
  const { bytes: out, report } = pdf.fillForm(blank, values, { signature: { field: 'requestor_signature', ...signature } });
  check('the original bytes are kept, and the fill appended after them',
    out.length > blank.length && Buffer.from(out.subarray(0, blank.length)).equals(Buffer.from(blank)));

  const back = pdf.readForm(out);
  const val = (name) => back.fields.find((f) => f.name === name)?.value;
  check('a text field reads back', val('row1_area') === 'Train Control Room, W34' && val('requestor_name') === 'Alex Morgan');
  check('a checkbox reads back on', val('row1_power_na') === 'Yes' && val('work_in_track_zone_no') === 'Yes');
  check('an untouched checkbox stays off', val('row5_power_na') === 'Off' || !val('row5_power_na'));
  check('a dropdown reads back', val('row1_day') === 'MON' && val('category_of_work') === 'F');
  check('a multi-line description reads back whole', String(val('work_description')).includes('\nDCS Testing'));
  check('the approval signature lines stay empty', !val('appr_ops_planning_signature'));

  const desc = report.fields.work_description;
  check('a long description is shrunk to fit its box', desc && desc.size < 14 && desc.fits, JSON.stringify(desc));
  check('nothing reported as not fitting', !Object.values(report.fields).some((r) => !r.fits),
    Object.entries(report.fields).filter(([, r]) => !r.fits).map(([k]) => k).join(', '));
  check('every filled text field has its own appearance', report.appearances >= Object.values(values).filter((v) => typeof v === 'string' && v).length);
  check('the signature is drawn on the page', report.signature === true);
  const text = Buffer.from(out).toString('latin1');
  check('the appearance uses the form\'s own font resource', /\/Helv [\d.]+ Tf/.test(text.slice(blank.length)));
  check('the form stays fillable', !/\/Ff\s+1\b/.test(text.slice(blank.length)) && back.fields.length === 141);
  check('the output ends as a PDF does', /%%EOF\s*$/.test(text));

  const tail = Buffer.from(out.subarray(blank.length)).toString('latin1');
  check('no field is left to auto size — a viewer redraws those at 4 pt', !/\/Helv 0 Tf/.test(tail));
  const area = report.fields.row1_area;
  check('a one-line box is drawn as large as its height allows', area && area.size >= 8.2, JSON.stringify(area));
  check('and declares that size, so a viewer redrawing it draws the same',
    new RegExp(`/Helv ${Math.round(area.size * 10000) / 10000} Tf`).test(tail));

  const uniform = pdf.fillForm(blank, { ...values, work_description: 'IXL SIM Testing', row1_day: 'MON' }, { textSize: 'requestor_name' });
  const sizes = Object.entries(uniform.report.fields);
  check('with one size asked for, every filled box is printed at the Requestor\'s size',
    sizes.length > 10 && sizes.every(([, r]) => r.size === 9),
    sizes.filter(([, r]) => r.size !== 9).map(([k, r]) => `${k}:${r.size}`).join(', '));
  const grown = pdf.readForm(uniform.bytes).fields.find((f) => f.name === 'row1_area');
  const before = form.fields.find((f) => f.name === 'row1_area');
  check('a box too short for it is made taller, upwards, keeping the line it sits on',
    grown.rect[1] === before.rect[1] && grown.rect[3] - grown.rect[1] >= 9 * 0.93 && before.rect[3] - before.rect[1] < 9,
    `${before.rect} → ${grown.rect}`);
  check('and declares the size, so a viewer redrawing it draws the same',
    /\/Helv 9 Tf/.test(Buffer.from(uniform.bytes.subarray(blank.length)).toString('latin1'))
      && !/\/Helv (?!9 )[\d.]+ Tf/.test(Buffer.from(uniform.bytes.subarray(blank.length)).toString('latin1').replace(/\/Helv 14 Tf/g, '')));
  const crowded = pdf.fillForm(blank, { row1_area: 'Train Control Room, Lake Merritt, Tracks M1 and M2' }, { textSize: 9 });
  check('only text too wide for its box is shrunk', crowded.report.fields.row1_area.size < 9 && crowded.report.fields.row1_area.fits);

  const dated = pdf.readForm(pdf.fillForm(blank, { row1_date: '10/19/26', row2_date: '2026-10-20', row3_date: 'TBD' }).bytes);
  const dv = (name) => dated.fields.find((f) => f.name === name)?.value;
  check('a date is written the way the box\'s own date check asks — 10/19/26 would show blank',
    dv('row1_date') === '10/19/2026' && dv('row2_date') === '10/20/2026', `${dv('row1_date')} ${dv('row2_date')}`);
  check('and anything that is not a date is left as typed', dv('row3_date') === 'TBD');

  const refilled = pdf.readForm(pdf.fillForm(out, { row1_area: 'Changed' }).bytes);
  check('a filled form can be filled again', refilled.fields.find((f) => f.name === 'row1_area').value === 'Changed'
    && refilled.fields.find((f) => f.name === 'requestor_name').value === 'Alex Morgan');
}

console.log('\nDates in the form\'s own format');
{
  check('mm/dd/yyyy from a short year', pdf.formatDateAs('10/19/26', 'mm/dd/yyyy') === '10/19/2026');
  check('from an ISO date', pdf.formatDateAs('2026-01-05', 'mm/dd/yyyy') === '01/05/2026');
  check('into a short format too', pdf.formatDateAs('01/05/2026', 'm/d/yy') === '1/5/26');
  check('not a date is not touched', pdf.formatDateAs('13/45/26', 'mm/dd/yyyy') === '13/45/26');
}

console.log('\nChecking a template');
{
  const partial = buildFormPdf(fieldSpecs.filter((f) => f.name !== 'row7_area' && f.name !== 'work_description'));
  const missing = pdf.missingFields(pdf.readForm(partial), tawr.TAWR_FIELDS.map((f) => f[0]));
  check('a revised form that lost fields is reported by name', [...missing].sort().join() === 'row7_area,work_description', missing.join());
  let refused = null;
  try { pdf.readForm(new TextEncoder().encode('not a pdf at all')); } catch (err) { refused = err; }
  check('a file that is not a PDF is refused with a reason', !!refused && /PDF/.test(refused.message));
  const plain = buildFormPdf([]);
  check('a PDF with no form says so', pdf.readForm(plain).fields.length === 0);
  check('non-ASCII text is written, not dropped', (() => {
    const out = pdf.readForm(pdf.fillForm(buildFormPdf(fieldSpecs), { row1_area: 'Café – Yard “B”' }).bytes);
    return out.fields.find((f) => f.name === 'row1_area').value === 'Café – Yard “B”';
  })());
}

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
