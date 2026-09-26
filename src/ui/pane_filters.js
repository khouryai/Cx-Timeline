/**
 * Search and Filters.
 *
 * Split out of `ui/panels.js`; see `ui/pane_util.js` for how a pane reaches the dock.
 */

import { el, clear, debounce, bytes, download } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import { fmtDate, fmtTimestamp, fmtDuration, toISO, toMs, MS_DAY, DATE_ORDERS } from '../core/dates.js';
import {
  TYPES,
  listOptions,
  typeGroups,
  statusOf,
  subsystemOf,
  durationDays,
  effectiveToday,
  makeBaseline,
  makeProject,
  isDerivedBaseline,
} from '../core/model.js';
import * as store from '../core/store.js';
import { listBackups, loadBackup, deleteBackup, makeBackup, usage, refreshBackupSchedule, isFallback, collectGarbage, switchProject, createCloudProject, isHosted, isFileMode, purgeLocalCopy } from '../core/storage.js';
import * as cloud from '../core/cloud.js';
import * as filestore from '../core/filestore.js';
import * as access from '../core/access.js';
import { search, summarise, facet, filterPredicate } from '../core/query.js';
import { criticalPath, compareBaseline, projectHealth, objectHealth, slipByLane, linkViolations, evaluateLink } from '../core/analysis.js';
import * as viewport from '../timeline/viewport.js';
import * as renderer from '../timeline/renderer.js';
import { icon } from './icons.js';
import {
  field,
  textInput,
  numberInput,
  selectInput,
  checkbox,
  toggle,
  segmented,
  section,
  emptyState,
  badge,
  chipStat,
  confirmDialog,
  promptDialog,
  skeleton,
  toast,
  openModal,
  progressBar,
  contextMenu,
} from './components.js';
import * as cmd from './commands.js';
import { listEditor } from './lists.js';
import { openShareDialog, paneTeam } from './auth.js';
import { paneP6 } from './p6.js';
import { paneLookahead } from './lookahead.js';
import { openObjectDialog, openLaneDialog } from './dialogs.js';
import { THEMES, applyTheme, getTheme } from './theme.js';
import * as exporters from '../io/exporters.js';
import { importFile, buildDocFromRows } from '../io/importers.js';
import { pickFiles } from '../core/util.js';

import { refreshPane, goToPane, iconBtn, statRow } from './pane_util.js';

/* ══════════════════════════════════════════════════════════════════════════
   Search
   ═══════════════════════════════════════════════════════════════════════ */

export function paneSearch(root) {
  const input = textInput({
    value: '',
    placeholder: 'Titles, notes, owners, versions… commas for several',
    type: 'search',
  });
  input.dataset.searchInput = '1';

  const results = el('div', { style: { marginTop: '10px' } });

  const run = debounce(() => {
    clear(results);
    const query = input.value.trim();
    if (!query) {
      results.appendChild(el('div', { class: 'cx-hint', text: 'Searches every object title, note, owner, subsystem, area, tag, version, build and reference in the project.' }));
      return;
    }

    const hits = search(store.getDoc(), query);
    if (!hits.length) {
      results.appendChild(emptyState({ iconName: 'search', title: 'No matches', message: `Nothing in this project matches “${query}”.` }));
      return;
    }

    results.appendChild(el('div', { class: 'eyebrow', style: { marginBottom: '6px' }, text: `${hits.length} result${hits.length === 1 ? '' : 's'}` }));
    const list = el('div', { class: 'cx-list' });
    for (const hit of hits) {
      list.appendChild(
        el('div', {
          class: 'cx-listrow',
          onClick: () => {
            if (hit.kind === 'lane') goToPane('lanes');
            else cmd.revealObject(hit.id);
          },
          onDblclick: () => hit.kind === 'object' && openObjectDialog(hit.id),
        }, [
          el('span', { class: 'cx-dot', style: { background: TYPES[hit.type]?.accent || 'var(--neutral)' } }),
          el('div', { class: 'lr-main' }, [
            el('div', { class: 'lr-title', text: hit.title }),
            el('div', { class: 'lr-meta', text: `${hit.typeLabel}${hit.lane ? ' · ' + hit.lane : ''} · matched in ${hit.matchedIn}` }),
            hit.excerpt ? el('div', { style: { fontSize: 'var(--fs-tiny)', color: 'var(--text-subtle)', marginTop: '2px' }, text: hit.excerpt }) : null,
          ]),
        ])
      );
    }
    results.appendChild(list);
  }, 160);

  input.addEventListener('input', run);
  root.append(input, results);
  run();
  setTimeout(() => input.focus(), 40);
}

/* ══════════════════════════════════════════════════════════════════════════
   Filters
   ═══════════════════════════════════════════════════════════════════════ */

export function paneFilters(root) {
  const doc = store.getDoc();
  const filters = store.getFilters();

  root.appendChild(
    el('div', { style: { display: 'flex', gap: '6px', marginBottom: '11px' } }, [
      el('button', {
        class: 'cx-btn mini',
        html: icon('refresh', { size: 12 }) + '<span>Clear all</span>',
        disabled: !store.hasActiveFilters(),
        onClick: () => {
          store.resetFilters();
          renderer.requestRender();
          refreshPane();
        },
      }),
      el('button', {
        class: 'cx-btn mini',
        html: icon('cursor', { size: 12 }) + '<span>Select matches</span>',
        disabled: !store.hasActiveFilters(),
        onClick: selectFiltered,
      }),
    ])
  );

  // What a filter does to everything else. Dimming keeps the shape of the plan
  // legible and nothing moves; hiding closes the rows up around what is left,
  // which reads better when you are down to a handful of objects.
  root.appendChild(
    field(
      'Non-matching objects',
      segmented({
        value: doc.settings.filterMode || 'dim',
        stretch: true,
        options: [
          { value: 'dim', label: 'Dim' },
          { value: 'hide', label: 'Hide' },
        ],
        onChange: (v) => {
          store.setSetting('filterMode', v, 'Change filter display');
          renderer.invalidateAll();
          renderer.requestRender();
        },
      }),
      'Hiding reflows the lanes around what is left. Exports always hide.'
    )
  );

  root.appendChild(field('Text contains', textInput({
    value: filters.text,
    placeholder: 'e.g. power-up, cable pull',
    onInput: debounce((v) => {
      store.setFilters({ text: v });
      renderer.requestRender();
    }, 200),
  }), 'Separate several with commas — anything matching any of them is kept.'));

  /* The date window. Unlike the rest of the filter it always *hides* what is
     outside it, whatever the switch above says — "show me 15 September to 25
     November" is a request not to see the rest. Nothing is removed, and the
     toolbar says a window is in force for as long as it is. */
  root.appendChild(
    el('div', { class: 'cx-row', style: { marginTop: '10px' } }, [
      field('Show only from', textInput({
        type: 'date',
        value: filters.from || '',
        onChange: (v) => {
          cmd.setDateWindow(v || null, store.getFilters().to, { frame: false });
          refreshPane();
        },
      })),
      field('To', textInput({
        type: 'date',
        value: filters.to || '',
        onChange: (v) => {
          cmd.setDateWindow(store.getFilters().from, v || null, { frame: false });
          refreshPane();
        },
      })),
    ])
  );
  if (filters.from || filters.to) {
    root.appendChild(el('div', { style: { display: 'flex', gap: '6px', margin: '-4px 0 10px' } }, [
      el('button', {
        class: 'cx-btn mini',
        html: icon('x', { size: 12 }) + '<span>Clear dates</span>',
        onClick: () => { cmd.clearDateWindow(); refreshPane(); },
      }),
      el('span', { class: 'cx-hint', text: 'Outside these dates is hidden, not removed.' }),
    ]));
  }

  /* What somebody hid by hand, each one click from coming back. A hidden
     object is not drawn, so this is the only place it can be reached. */
  const hidden = doc.objects.filter((o) => o.hidden);
  if (hidden.length) {
    root.appendChild(section(`Hidden objects (${hidden.length})`, [
      el('div', { class: 'cx-list' }, hidden.map((obj) => el('div', { class: 'cx-listrow', style: { cursor: 'default' } }, [
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: obj.title }),
          el('div', { class: 'lr-meta', text: fmtDate(obj.start, 'numeric') }),
        ]),
        el('button', {
          class: 'cx-btn mini',
          html: icon('eye', { size: 12 }) + '<span>Show</span>',
          'aria-label': `Show ${obj.title}`,
          onClick: () => { cmd.showObjects([obj.id]); refreshPane(); },
        }),
      ]))),
      el('button', {
        class: 'cx-btn mini',
        style: { marginTop: '6px' },
        html: icon('eye', { size: 12 }) + '<span>Show all</span>',
        onClick: () => { cmd.showAllHidden(); refreshPane(); },
      }),
    ]));
  }

  root.appendChild(checkGroup('Type', 'types', Object.entries(TYPES).map(([id, t]) => ({ value: id, label: t.label })), filters.types));
  root.appendChild(checkGroup('Status', 'statuses', listOptions('status').map((o) => ({ value: o.id, label: o.label })), filters.statuses));
  root.appendChild(checkGroup('Lane', 'lanes', store.orderedLanes().map((l) => ({ value: l.id, label: l.name })), filters.lanes));
  root.appendChild(checkGroup('Subsystem', 'subsystems', listOptions('subsystem').map((s) => ({ value: s.id, label: s.label })), filters.subsystems));

  const owners = facet(doc, 'owner');
  if (owners.length) {
    root.appendChild(checkGroup('Owner', 'owners', owners.map((o) => ({ value: o.value, label: `${o.value} (${o.count})` })), filters.owners));
  }
  const areas = facet(doc, 'area');
  if (areas.length) {
    root.appendChild(checkGroup('Area', 'areas', areas.map((a) => ({ value: a.value, label: `${a.value} (${a.count})` })), filters.areas));
  }
  const tags = facet(doc, 'tag');
  if (tags.length) {
    root.appendChild(checkGroup('Tag', 'tags', tags.map((t) => ({ value: t.value, label: `${t.value} (${t.count})` })), filters.tags));
  }
}

function checkGroup(title, dimension, options, selected) {
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } });
  for (const option of options) {
    wrap.appendChild(
      checkbox({
        label: option.label,
        checked: selected.includes(option.value),
        onChange: (on_) => {
          const current = store.getFilters()[dimension] || [];
          const next = on_ ? [...current, option.value] : current.filter((v) => v !== option.value);
          store.setFilters({ [dimension]: next });
          renderer.requestRender();
        },
      })
    );
  }
  return section(`${title}${selected.length ? ` (${selected.length})` : ''}`, [wrap], { collapsed: !selected.length });
}

/** Select every object that passes the active filters. */
function selectFiltered() {
  const doc = store.getDoc();
  const predicate = filterPredicate(doc, store.getFilters());
  store.setSelection(doc.objects.filter(predicate).map((o) => o.id));
  renderer.requestRender();
}

