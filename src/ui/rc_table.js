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

import { el } from '../core/util.js';
import { icon } from './icons.js';
import { saveFile } from '../io/exporters.js';

/** Tables drawn as a grid, where reordering rows would change what they say. */
const POSITIONAL = ['la-grid', 'rc-pto-grid', 'rc-huddle', 'rc-resources'];

/** Taller than this and the frame scrolls on its own, so the header can stay. */
const TALL_ROWS = 14;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Enhance every eligible table under `root`. Safe to call repeatedly. */
export function enhanceTables(root) {
  for (const table of root.querySelectorAll('table.rc-table:not([data-enhanced])')) {
    enhanceTable(table);
  }
}

export function enhanceTable(table) {
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
