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

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** `[{ name, data }]` → the bytes of a ZIP holding them, uncompressed. */
export function zipStore(files) {
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
export async function zipDeflate(files) {
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

export function xmlEscape(s) {
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
export function styleBook({ font = 'Arial', size = 10 } = {}) {
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
export function sheetNameFor(name) {
  const clean = String(name ?? '').replace(/[[\]:*?/\\]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^'+|'+$/g, '').slice(0, 31).trim();
  return clean || 'Sheet1';
}

export function workbookParts({ sheetName, sheetXml, stylesXml, printTitles = null, title = '' }) {
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
export const CELL_LIMIT = 32767;
/** Rows on one sheet, the heading included. */
export const ROW_LIMIT = 1048576;

/** A, B, … Z, AA, AB … — the letters of a column, 0-based. */
export function columnLetters(i) {
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
export function dateSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569;
}

/**
 * An instant as Excel's day number and fraction, in this computer's time —
 * a spreadsheet has no time zones, and the person opening it reads the clock
 * on their wall, not Greenwich's.
 */
export function dateTimeSerial(value) {
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
export async function tableWorkbook({ sheets, title = '' }) {
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
