/**
 * The property inspector.
 *
 * Renders the full editable surface of whatever is selected: one object, many
 * objects (common properties only), a dependency, or — with nothing selected —
 * the project itself. Edits are written straight to the store, so every change
 * is undoable and autosaved without the panel having to manage a draft.
 *
 * Imports: util, events, dates, model, store, analysis, viewport, renderer,
 *          icons, components, notes, attachments.
 */

import { el, clear, debounce, clamp } from '../core/util.js';
import { on, emit, EV } from '../core/events.js';
import { toISO, toMs, fmtDate, fmtDuration, daysBetween, MS_DAY } from '../core/dates.js';
import {
  TYPES,
  STATUSES,
  STATUS_IDS,
  SEVERITIES,
  APPROVALS,
  SUBSYSTEMS,
  TEST_KINDS,
  LINK_TYPES,
  CONNECTOR_STYLES,
  durationDays,
  remainingDays,
  statusOf,
  effectiveToday,
} from '../core/model.js';
import * as store from '../core/store.js';
import { objectHealth } from '../core/analysis.js';
import * as renderer from '../timeline/renderer.js';
import { icon } from './icons.js';
import {
  field,
  textInput,
  numberInput,
  selectInput,
  checkbox,
  toggle,
  rangeInput,
  segmented,
  section,
  colorControl,
  iconPicker,
  popover,
  closePopover,
  emptyState,
  badge,
  chipStat,
  confirmDialog,
  contextMenu,
} from './components.js';
import { openNoteEditor, renderNote, notePreview } from './notes.js';
import { attachmentList } from './attachments.js';

let host = null;
let headEl = null;
let bodyEl = null;
/** Section collapse state survives re-renders so the panel does not jump. */
const collapsed = new Set(['appearance', 'text', 'arrange']);
/** Set when a rebuild was suppressed because the user was mid-edit. */
let pendingRender = false;

/**
 * True when focus is in a text-entry control inside this panel.
 *
 * Every keystroke writes to the store, which publishes `doc:changed`, which
 * would otherwise rebuild the panel and destroy the very input being typed
 * into — dropping focus and the caret after each character. While the user is
 * typing, the panel holds still; the deferred rebuild runs once focus leaves.
 *
 * Selects, checkboxes, ranges and colour wells are deliberately excluded:
 * those are discrete choices that may change which fields apply, so the panel
 * should refresh immediately.
 */
function isTypingInPanel() {
  const active = document.activeElement;
  if (!host || !active || !host.contains(active)) return false;
  const tag = active.tagName.toLowerCase();
  if (tag === 'textarea' || active.isContentEditable) return true;
  return tag === 'input' && !['checkbox', 'radio', 'color', 'range', 'file'].includes(active.type);
}

export function buildInspector() {
  host = document.getElementById('inspector');
  clear(host);

  headEl = el('div', { class: 'insp-head' });
  bodyEl = el('div', { class: 'insp-body' });
  host.append(headEl, bodyEl);

  // Once focus leaves the panel, run any rebuild that was held back.
  host.addEventListener('focusout', () => {
    setTimeout(() => {
      if (pendingRender && !isTypingInPanel()) render();
    }, 0);
  });

  on(EV.SELECTION_CHANGED, render);
  on(EV.DOC_CHANGED, (p) => {
    if (p?.transient) return;
    scheduleRender();
  });
  on(EV.DOC_REPLACED, render);
  on('link:select', ({ link }) => {
    renderer.setSelectedLinks([link.id]);
    store.clearSelection();
    render();
  });

  render();
}

const scheduleRender = debounce(() => {
  if (isTypingInPanel()) {
    pendingRender = true;
    return;
  }
  render();
}, 60);

/* ══════════════════════════════════════════════════════════════════════════
   Router
   ═══════════════════════════════════════════════════════════════════════ */

export function render() {
  if (!host) return;
  pendingRender = false;

  const selection = store.selectedObjects();
  const links = renderer.getSelectedLinks();
  // Rebuilding replaces the scrolled content, so put the reader back where
  // they were rather than snapping to the top of the panel.
  const scroll = bodyEl.scrollTop;

  clear(headEl);
  clear(bodyEl);

  if (selection.length === 1) renderSingle(selection[0]);
  else if (selection.length > 1) renderMulti(selection);
  else if (links.length === 1) renderLink(links[0]);
  else renderProject();

  bodyEl.scrollTop = scroll;
}

function headerFor(kind, name, actions = []) {
  headEl.appendChild(
    el('div', { class: 'ih-title' }, [
      el('div', { class: 'ih-kind', text: kind }),
      el('div', { class: 'ih-name', text: name, title: name }),
    ])
  );
  for (const action of actions) headEl.appendChild(action);
}

/* ══════════════════════════════════════════════════════════════════════════
   Single object
   ═══════════════════════════════════════════════════════════════════════ */

function renderSingle(obj) {
  const def = TYPES[obj.type] || TYPES.activity;
  const lane = store.getLane(obj.lane);

  headerFor(def.label, obj.title, [
    el('button', {
      class: 'cx-btn icon mini ghost',
      title: obj.locked ? 'Unlock' : 'Lock',
      'aria-label': obj.locked ? 'Unlock object' : 'Lock object',
      html: icon(obj.locked ? 'lock' : 'unlock', { size: 13 }),
      onClick: () => set(obj.id, { locked: !obj.locked }, obj.locked ? 'Unlock' : 'Lock'),
    }),
    el('button', {
      class: 'cx-btn icon mini ghost',
      title: 'More actions',
      'aria-label': 'More actions',
      html: icon('more', { size: 13 }),
      onClick: (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        emit('canvas:contextmenu', { target: 'object', id: obj.id, clientX: rect.left, clientY: rect.bottom + 4 });
      },
    }),
  ]);

  bodyEl.append(
    healthStrip(obj),
    sectionOf('identity', 'Identity', identityFields(obj, def, lane)),
    sectionOf('schedule', 'Schedule', scheduleFields(obj, def)),
    def.fields.length ? sectionOf('details', 'Details', detailFields(obj, def)) : null,
    sectionOf('notes', 'Notes', notesFields(obj)),
    sectionOf('attachments', 'Attachments', [attachmentList(obj.id).root]),
    sectionOf('links', 'Dependencies', linkFields(obj)),
    sectionOf('appearance', 'Appearance', appearanceFields(obj)),
    sectionOf('text', 'Text', textFields(obj)),
    sectionOf('arrange', 'Arrange', arrangeFields(obj))
  );
}

function sectionOf(id, title, children) {
  if (!children) return null;
  const node = section(title, children, { collapsed: collapsed.has(id), id });
  node.querySelector('.cx-section-head').addEventListener('click', () => {
    if (node.classList.contains('collapsed')) collapsed.add(id);
    else collapsed.delete(id);
  });
  return node;
}

function set(id, patch, label, opts) {
  store.updateObject(id, patch, label || 'Edit object', opts);
  renderer.requestRender();
}

/* ── Health strip ──────────────────────────────────────────────────────── */

function healthStrip(obj) {
  const today = effectiveToday(store.getDoc());
  const health = objectHealth(obj, today);
  const tone =
    health.state === 'done' ? 'good'
    : health.state === 'overdue' || health.state === 'behind' || health.state === 'late' ? 'bad'
    : health.state === 'ahead' ? 'good'
    : health.state === 'ontrack' ? 'info'
    : 'muted';

  const chips = [chipStat('Status', statusOf(obj.status).label, tone)];
  if (TYPES[obj.type]?.duration) {
    chips.push(chipStat('Dur', fmtDuration(durationDays(obj)), 'muted'));
    if (TYPES[obj.type]?.progress) {
      chips.push(chipStat('Done', `${Math.round(obj.progress)}%`, tone));
      chips.push(chipStat('Left', fmtDuration(remainingDays(obj)), 'muted'));
    }
  }

  return el('div', { style: { padding: '11px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: '6px' } }, [
    ...chips,
    el('div', { class: 'cx-hint', style: { width: '100%', marginTop: '2px' }, text: healthMessage(health) }),
  ]);
}

function healthMessage(health) {
  switch (health.state) {
    case 'overdue': return `Overdue by ${fmtDuration(health.days || 0)} — finish date has passed.`;
    case 'behind': return `${Math.abs(health.variance)}% behind the straight-line plan (${health.expected}% expected).`;
    case 'ahead': return `${health.variance}% ahead of the straight-line plan.`;
    case 'ontrack': return `Tracking to plan (${health.expected}% expected, ${health.actual}% reported).`;
    case 'done': return 'Complete.';
    case 'late': return `Planned date passed ${fmtDuration(health.days || 0)} ago.`;
    default: return 'Not started yet.';
  }
}

/* ── Identity ──────────────────────────────────────────────────────────── */

function identityFields(obj, def, lane) {
  const iconButton = el('button', {
    class: 'cx-btn mini',
    html: (obj.icon ? icon(obj.icon, { size: 14 }) : icon('plus', { size: 13 })) + `<span>${obj.icon || 'Choose'}</span>`,
    onClick: (e) => {
      popover(e.currentTarget, iconPicker({
        value: obj.icon,
        onPick: (name) => {
          set(obj.id, { icon: name }, 'Change icon');
          closePopover();
        },
      }), { width: 280 });
    },
  });

  return [
    field('Title', textInput({
      value: obj.title,
      onInput: (v) => set(obj.id, { title: v }, 'Rename object', { mergeKey: `title:${obj.id}` }),
    })),
    field('Subtitle', textInput({
      value: obj.subtitle,
      placeholder: 'Optional second line',
      onInput: (v) => set(obj.id, { subtitle: v }, 'Edit subtitle', { mergeKey: `sub:${obj.id}` }),
    })),
    el('div', { class: 'cx-row' }, [
      field('Type', selectInput({
        value: obj.type,
        options: Object.entries(TYPES).map(([id, t]) => ({ value: id, label: t.label })),
        onChange: (v) => set(obj.id, { type: v }, 'Change type'),
      })),
      field('Lane', selectInput({
        value: obj.lane || '',
        options: store.orderedLanes().map((l) => ({ value: l.id, label: l.name })),
        onChange: (v) => set(obj.id, { lane: v, row: 0 }, 'Move to lane'),
      })),
    ]),
    field('Icon', iconButton),
    field('Tags', textInput({
      value: (obj.tags || []).join(', '),
      placeholder: 'comma, separated',
      onChange: (v) => set(obj.id, { tags: v.split(',').map((t) => t.trim()).filter(Boolean) }, 'Edit tags'),
    })),
  ];
}

/* ── Schedule ──────────────────────────────────────────────────────────── */

function scheduleFields(obj, def) {
  const fields = [];

  if (def.duration) {
    fields.push(
      el('div', { class: 'cx-row' }, [
        field('Start', textInput({
          type: 'date',
          value: toISO(obj.start),
          onChange: (v) => {
            const ms = toMs(v);
            if (!Number.isFinite(ms)) return;
            const shift = ms - obj.start;
            set(obj.id, { start: ms, end: obj.end + shift }, 'Change start date');
          },
        })),
        field('Finish', textInput({
          type: 'date',
          value: toISO(obj.end),
          onChange: (v) => {
            const ms = toMs(v);
            if (Number.isFinite(ms)) set(obj.id, { end: Math.max(ms, obj.start + MS_DAY) }, 'Change finish date');
          },
        })),
      ]),
      el('div', { class: 'cx-row' }, [
        field('Duration (days)', numberInput({
          value: durationDays(obj),
          min: 1,
          onChange: (v) => set(obj.id, { end: obj.start + Math.max(1, v) * MS_DAY }, 'Change duration'),
        })),
        field('Remaining', el('div', {
          class: 'cx-input mini',
          style: { display: 'flex', alignItems: 'center', color: 'var(--text-muted)', cursor: 'default' },
          text: fmtDuration(remainingDays(obj)),
        })),
      ])
    );
  } else {
    fields.push(
      field('Date', textInput({
        type: 'date',
        value: toISO(obj.start),
        onChange: (v) => {
          const ms = toMs(v);
          if (Number.isFinite(ms)) set(obj.id, { start: ms, end: ms }, 'Change date');
        },
      }))
    );
  }

  fields.push(
    field('Status', selectInput({
      value: obj.status,
      options: STATUS_IDS.map((id) => ({ value: id, label: STATUSES[id].label })),
      onChange: (v) => set(obj.id, { status: v }, 'Change status'),
    }))
  );

  if (def.progress) {
    const readout = el('span', { class: 'mono', style: { minWidth: '38px', textAlign: 'right', fontSize: 'var(--fs-tiny)' }, text: `${Math.round(obj.progress)}%` });
    fields.push(
      field('Percent complete', el('div', { class: 'cx-inline' }, [
        rangeInput({
          value: obj.progress,
          min: 0,
          max: 100,
          step: 5,
          onInput: (v) => {
            readout.textContent = `${v}%`;
          },
          onChange: (v) => set(obj.id, { progress: v }, 'Change progress', { mergeKey: `prog:${obj.id}` }),
        }),
        readout,
      ]))
    );
  }

  return fields;
}

/* ── Type-specific details ─────────────────────────────────────────────── */

function detailFields(obj, def) {
  const out = [];
  const data = obj.data || {};
  const setData = (key, value, label) => set(obj.id, { data: { [key]: value } }, label || 'Edit details');

  const has = (name) => def.fields.includes(name);

  if (has('owner')) {
    out.push(field('Owner', textInput({
      value: obj.owner,
      placeholder: 'Responsible engineer',
      onInput: (v) => set(obj.id, { owner: v }, 'Change owner', { mergeKey: `owner:${obj.id}` }),
    })));
  }

  if (has('subsystem') || has('area')) {
    out.push(
      el('div', { class: 'cx-row' }, [
        has('subsystem')
          ? field('Subsystem', selectInput({
              value: obj.subsystem,
              placeholder: '—',
              options: SUBSYSTEMS.map((s) => ({ value: s.id, label: s.label })),
              onChange: (v) => set(obj.id, { subsystem: v }, 'Change subsystem'),
            }))
          : null,
        has('area')
          ? field('Area', textInput({
              value: obj.area,
              placeholder: 'Section / zone',
              onInput: (v) => set(obj.id, { area: v }, 'Change area', { mergeKey: `area:${obj.id}` }),
            }))
          : null,
      ].filter(Boolean))
    );
  }

  if (has('version') || has('releaseNumber')) {
    out.push(
      el('div', { class: 'cx-row' }, [
        field('Version', textInput({ value: data.version || '', placeholder: '2.5.0', onInput: (v) => setData('version', v, 'Change version') })),
        field('Release no.', textInput({ value: data.releaseNumber || '', placeholder: 'REL-025', onInput: (v) => setData('releaseNumber', v, 'Change release number') })),
      ])
    );
  }
  if (has('buildNumber')) {
    out.push(field('Build', textInput({ value: data.buildNumber || '', placeholder: '2.5.0-rc3', onInput: (v) => setData('buildNumber', v, 'Change build number') })));
  }
  if (has('approval')) {
    out.push(field('Approval', selectInput({
      value: data.approval || 'none',
      options: Object.entries(APPROVALS).map(([id, a]) => ({ value: id, label: a.label })),
      onChange: (v) => setData('approval', v, 'Change approval'),
    })));
  }

  if (has('testPackage')) {
    out.push(field('Test package', textInput({ value: data.testPackage || '', placeholder: 'TP-DYN-01', onInput: (v) => setData('testPackage', v, 'Change test package') })));
  }
  if (has('testKind')) {
    out.push(field('Test type', selectInput({
      value: data.testKind || '',
      placeholder: '—',
      options: TEST_KINDS.map((t) => ({ value: t.id, label: t.label })),
      onChange: (v) => setData('testKind', v, 'Change test type'),
    })));
  }

  if (has('actualStart') || has('actualEnd')) {
    out.push(
      el('div', { class: 'cx-row' }, [
        field('Actual start', textInput({
          type: 'date',
          value: data.actualStart ? toISO(toMs(data.actualStart)) : '',
          onChange: (v) => setData('actualStart', v, 'Set actual start'),
        })),
        field('Actual finish', textInput({
          type: 'date',
          value: data.actualEnd ? toISO(toMs(data.actualEnd)) : '',
          onChange: (v) => setData('actualEnd', v, 'Set actual finish'),
        })),
      ])
    );
  }

  if (has('severity')) {
    out.push(
      el('div', { class: 'cx-row' }, [
        field('Severity', selectInput({
          value: data.severity || 'medium',
          options: Object.entries(SEVERITIES).map(([id, s]) => ({ value: id, label: s.label })),
          onChange: (v) => setData('severity', v, 'Change severity'),
        })),
        has('likelihood')
          ? field('Likelihood', selectInput({
              value: data.likelihood || 'medium',
              options: Object.entries(SEVERITIES).map(([id, s]) => ({ value: id, label: s.label })),
              onChange: (v) => setData('likelihood', v, 'Change likelihood'),
            }))
          : null,
      ].filter(Boolean))
    );
  }
  if (has('mitigation')) {
    out.push(field('Mitigation', el('textarea', {
      class: 'cx-textarea',
      rows: 3,
      placeholder: 'How the risk is being managed',
      onChange: (e) => setData('mitigation', e.target.value, 'Edit mitigation'),
      text: data.mitigation || '',
    })));
  }
  if (has('reference')) {
    out.push(field('Reference', textInput({ value: data.reference || '', placeholder: 'IXL-1184', onInput: (v) => setData('reference', v, 'Change reference') })));
  }

  return out;
}

/* ── Notes ─────────────────────────────────────────────────────────────── */

function notesFields(obj) {
  const preview = obj.notes
    ? renderNote(obj.notes, { max: 160 })
    : el('div', { class: 'cx-hint', text: 'No notes yet.' });

  return [
    preview,
    el('div', { class: 'cx-inline' }, [
      el('button', {
        class: 'cx-btn mini',
        html: icon('edit', { size: 12 }) + `<span>${obj.notes ? 'Edit notes' : 'Add notes'}</span>`,
        onClick: () =>
          openNoteEditor({
            title: obj.title,
            value: obj.notes,
            onSave: (html) => {
              set(obj.id, { notes: html }, 'Edit notes');
              render();
            },
          }),
      }),
      obj.notes
        ? el('button', {
            class: 'cx-btn mini danger',
            html: icon('trash', { size: 12 }),
            title: 'Clear notes',
            'aria-label': 'Clear notes',
            onClick: async () => {
              const ok = await confirmDialog({ title: 'Clear notes', message: 'Remove the notes on this object?', confirmLabel: 'Clear', danger: true });
              if (ok) {
                set(obj.id, { notes: '' }, 'Clear notes');
                render();
              }
            },
          })
        : null,
    ]),
  ];
}

/* ── Dependencies ──────────────────────────────────────────────────────── */

function linkFields(obj) {
  const links = store.linksFor([obj.id]);
  const out = [];

  if (!links.length) {
    out.push(el('div', { class: 'cx-hint', text: 'No dependencies. Drag from an object’s round anchor to another object to create one.' }));
    return out;
  }

  for (const link of links) {
    const outgoing = link.from === obj.id;
    const other = store.getObject(outgoing ? link.to : link.from);
    if (!other) continue;

    out.push(
      el('div', { class: 'cx-listrow' }, [
        el('span', { style: { display: 'flex', color: 'var(--text-subtle)' }, html: icon(outgoing ? 'arrow' : 'arrow-left', { size: 12 }) }),
        el('div', { class: 'lr-main' }, [
          el('div', { class: 'lr-title', text: other.title }),
          el('div', { class: 'lr-meta', text: `${LINK_TYPES[link.type]?.short || link.type}${link.lag ? ` ${link.lag > 0 ? '+' : ''}${link.lag}d` : ''} · ${outgoing ? 'successor' : 'predecessor'}` }),
        ]),
        el('div', { class: 'lr-actions' }, [
          el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Select dependency',
            'aria-label': 'Select dependency',
            html: icon('sliders', { size: 11 }),
            onClick: () => {
              renderer.setSelectedLinks([link.id]);
              store.clearSelection();
              render();
            },
          }),
          el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Delete dependency',
            'aria-label': 'Delete dependency',
            html: icon('unlink', { size: 11 }),
            onClick: () => {
              store.removeLinks([link.id]);
              renderer.requestRender();
              render();
            },
          }),
        ]),
      ])
    );
  }
  return out;
}

/* ── Appearance ────────────────────────────────────────────────────────── */

function appearanceFields(obj) {
  const style = obj.style || {};
  const setStyle = (patch, label) => set(obj.id, { style: patch }, label || 'Change appearance');

  return [
    el('div', { class: 'cx-row' }, [
      field('Fill', colorControl({ value: style.fill || '#5b93f5', allowInherit: true, onChange: (v) => setStyle({ fill: v }, 'Change fill') })),
      field('Border', colorControl({ value: style.stroke || '#000000', allowInherit: true, onChange: (v) => setStyle({ stroke: v }, 'Change border') })),
    ]),
    el('div', { class: 'cx-row' }, [
      field('Border width', numberInput({ value: style.strokeWidth ?? 1, min: 0, max: 8, onChange: (v) => setStyle({ strokeWidth: v }, 'Change border width') })),
      field('Corner radius', numberInput({ value: style.radius ?? 6, min: 0, max: 30, onChange: (v) => setStyle({ radius: v }, 'Change corner radius') })),
    ]),
    field('Opacity', rangeInput({
      value: (style.opacity ?? 1) * 100,
      min: 15,
      max: 100,
      onChange: (v) => setStyle({ opacity: v / 100 }, 'Change opacity'),
    })),
    field('Pattern', segmented({
      value: style.pattern || 'none',
      stretch: true,
      options: [
        { value: 'none', label: 'None' },
        { value: 'stripes', label: 'Stripes' },
        { value: 'hatch', label: 'Hatch' },
        { value: 'dots', label: 'Dots' },
        { value: 'grid', label: 'Grid' },
      ],
      onChange: (v) => setStyle({ pattern: v }, 'Change pattern'),
    })),
    el('div', { class: 'cx-inline wrap' }, [
      checkbox({ label: 'Gradient', checked: !!style.gradient, onChange: (v) => setStyle({ gradient: v }, 'Toggle gradient') }),
      checkbox({ label: 'Shadow', checked: !!style.shadow, onChange: (v) => setStyle({ shadow: v }, 'Toggle shadow') }),
    ]),
    field('Rotation', rangeInput({
      value: style.rotation || 0,
      min: -45,
      max: 45,
      onChange: (v) => setStyle({ rotation: v }, 'Rotate'),
    }), 'Applies to notes, callouts, text boxes and shapes.'),
  ];
}

/* ── Text ──────────────────────────────────────────────────────────────── */

const FONT_OPTIONS = [
  { value: '', label: 'Interface (default)' },
  { value: "'Archivo', system-ui, sans-serif", label: 'Archivo' },
  { value: "'Roboto Mono', monospace", label: 'Roboto Mono' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Times New Roman', serif", label: 'Times New Roman' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: "'Courier New', monospace", label: 'Courier New' },
];

function textFields(obj) {
  const style = obj.style || {};
  const setStyle = (patch, label) => set(obj.id, { style: patch }, label || 'Change text style');

  return [
    field('Font', selectInput({
      value: style.font || '',
      options: FONT_OPTIONS,
      onChange: (v) => setStyle({ font: v }, 'Change font'),
    })),
    el('div', { class: 'cx-row' }, [
      field('Size', numberInput({ value: style.fontSize || 12, min: 7, max: 44, onChange: (v) => setStyle({ fontSize: v }, 'Change font size') })),
      field('Colour', colorControl({ value: style.textColor || '#ffffff', allowInherit: true, onChange: (v) => setStyle({ textColor: v }, 'Change text colour') })),
    ]),
    field('Style', el('div', { class: 'cx-inline' }, [
      styleToggle('B', 'Bold', style.bold, (v) => setStyle({ bold: v }, 'Toggle bold'), { fontWeight: '800' }),
      styleToggle('I', 'Italic', style.italic, (v) => setStyle({ italic: v }, 'Toggle italic'), { fontStyle: 'italic' }),
      styleToggle('U', 'Underline', style.underline, (v) => setStyle({ underline: v }, 'Toggle underline'), { textDecoration: 'underline' }),
    ])),
    field('Alignment', segmented({
      value: style.align || 'left',
      stretch: true,
      options: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Centre' },
        { value: 'right', label: 'Right' },
      ],
      onChange: (v) => setStyle({ align: v }, 'Change alignment'),
    })),
  ];
}

function styleToggle(label, title, active, onChange, extraStyle) {
  return el('button', {
    class: 'cx-btn icon mini' + (active ? ' active' : ''),
    title,
    'aria-label': title,
    'aria-pressed': String(!!active),
    style: extraStyle,
    text: label,
    onClick: () => onChange(!active),
  });
}

/* ── Arrange ───────────────────────────────────────────────────────────── */

function arrangeFields(obj) {
  const ids = [obj.id];
  return [
    el('div', { class: 'cx-inline wrap' }, [
      el('button', { class: 'cx-btn mini', html: icon('chevron-up', { size: 12 }) + '<span>Front</span>', onClick: () => { store.bringToFront(ids); renderer.requestRender(); } }),
      el('button', { class: 'cx-btn mini', html: icon('chevron-down', { size: 12 }) + '<span>Back</span>', onClick: () => { store.sendToBack(ids); renderer.requestRender(); } }),
      el('button', { class: 'cx-btn mini', text: 'Raise', onClick: () => { store.raise(ids); renderer.requestRender(); } }),
      el('button', { class: 'cx-btn mini', text: 'Lower', onClick: () => { store.lower(ids); renderer.requestRender(); } }),
    ]),
    el('div', { class: 'cx-inline wrap' }, [
      toggle({ label: 'Locked', checked: obj.locked, onChange: (v) => set(obj.id, { locked: v }, v ? 'Lock' : 'Unlock') }),
      toggle({ label: 'Hidden', checked: obj.hidden, onChange: (v) => set(obj.id, { hidden: v }, v ? 'Hide' : 'Show') }),
    ]),
    field('Stacking row', numberInput({
      value: obj.row || 0,
      min: 0,
      max: 12,
      onChange: (v) => set(obj.id, { row: clamp(v, 0, 12) }, 'Change row'),
    }), 'Row 0 lets the packer place this object automatically.'),
    obj.groupId
      ? el('button', {
          class: 'cx-btn mini',
          html: icon('unlink', { size: 12 }) + '<span>Ungroup</span>',
          onClick: () => { store.ungroupObjects([obj.id]); renderer.requestRender(); },
        })
      : null,
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   Multiple selection
   ═══════════════════════════════════════════════════════════════════════ */

function renderMulti(objects) {
  const ids = objects.map((o) => o.id);
  headerFor('Selection', `${objects.length} objects`);

  const first = objects[0];
  const allSameType = objects.every((o) => o.type === first.type);

  bodyEl.append(
    el('div', { style: { padding: '11px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: '6px' } }, [
      chipStat('Objects', objects.length, 'info'),
      chipStat('Lanes', new Set(objects.map((o) => o.lane)).size, 'muted'),
      chipStat('Types', new Set(objects.map((o) => o.type)).size, 'muted'),
    ]),
    section('Bulk edit', [
      field('Lane', selectInput({
        value: '',
        placeholder: 'Move all to…',
        options: store.orderedLanes().map((l) => ({ value: l.id, label: l.name })),
        onChange: (v) => {
          if (v) {
            store.updateObjects(ids, { lane: v, row: 0 }, 'Move to lane');
            renderer.requestRender();
          }
        },
      })),
      field('Status', selectInput({
        value: '',
        placeholder: 'Set status…',
        options: STATUS_IDS.map((id) => ({ value: id, label: STATUSES[id].label })),
        onChange: (v) => {
          if (v) {
            store.updateObjects(ids, { status: v }, 'Set status');
            renderer.requestRender();
          }
        },
      })),
      field('Owner', textInput({
        value: '',
        placeholder: 'Set owner for all…',
        onChange: (v) => {
          store.updateObjects(ids, { owner: v }, 'Set owner');
          renderer.requestRender();
        },
      })),
      field('Subsystem', selectInput({
        value: '',
        placeholder: 'Set subsystem…',
        options: SUBSYSTEMS.map((s) => ({ value: s.id, label: s.label })),
        onChange: (v) => {
          if (v) {
            store.updateObjects(ids, { subsystem: v }, 'Set subsystem');
            renderer.requestRender();
          }
        },
      })),
      field('Progress', rangeInput({
        value: Math.round(objects.reduce((sum, o) => sum + o.progress, 0) / objects.length),
        min: 0,
        max: 100,
        step: 5,
        onChange: (v) => {
          store.updateObjects(ids, { progress: v }, 'Set progress');
          renderer.requestRender();
        },
      })),
      field('Fill colour', colorControl({
        value: '#5b93f5',
        onChange: (v) => {
          store.updateObjects(ids, { style: { fill: v } }, 'Set fill');
          renderer.requestRender();
        },
      })),
    ]),
    section('Arrange', [
      el('div', { class: 'cx-inline wrap' }, [
        el('button', { class: 'cx-btn mini', text: 'Align starts', onClick: () => alignStarts(objects) }),
        el('button', { class: 'cx-btn mini', text: 'Align finishes', onClick: () => alignFinishes(objects) }),
        el('button', { class: 'cx-btn mini', text: 'Chain (FS)', onClick: () => chainSelection(objects) }),
        el('button', { class: 'cx-btn mini', text: 'Distribute', onClick: () => distribute(objects) }),
      ]),
      el('div', { class: 'cx-inline wrap' }, [
        el('button', { class: 'cx-btn mini', html: icon('layers', { size: 12 }) + '<span>Group</span>', onClick: () => { store.groupObjects(ids); renderer.requestRender(); } }),
        el('button', { class: 'cx-btn mini', html: icon('unlink', { size: 12 }) + '<span>Ungroup</span>', onClick: () => { store.ungroupObjects(ids); renderer.requestRender(); } }),
        el('button', { class: 'cx-btn mini', text: 'Bring to front', onClick: () => { store.bringToFront(ids); renderer.requestRender(); } }),
        el('button', { class: 'cx-btn mini', text: 'Send to back', onClick: () => { store.sendToBack(ids); renderer.requestRender(); } }),
      ]),
      el('button', {
        class: 'cx-btn mini danger',
        html: icon('trash', { size: 12 }) + `<span>Delete ${objects.length} objects</span>`,
        onClick: async () => {
          const ok = await confirmDialog({
            title: `Delete ${objects.length} objects`,
            message: 'This also removes any dependencies attached to them. You can undo this.',
            confirmLabel: 'Delete',
            danger: true,
          });
          if (ok) {
            store.removeObjects(ids);
            renderer.requestRender();
          }
        },
      }),
    ])
  );
}

function alignStarts(objects) {
  const target = Math.min(...objects.map((o) => o.start));
  store.updateObjects(objects.map((o) => o.id), (obj) => {
    const shift = target - obj.start;
    return TYPES[obj.type]?.duration ? { start: target, end: obj.end + shift } : { start: target };
  }, 'Align starts');
  renderer.requestRender();
}

function alignFinishes(objects) {
  const target = Math.max(...objects.map((o) => (TYPES[o.type]?.duration ? o.end : o.start)));
  store.updateObjects(objects.map((o) => o.id), (obj) => {
    if (!TYPES[obj.type]?.duration) return { start: target };
    const shift = target - obj.end;
    return { start: obj.start + shift, end: target };
  }, 'Align finishes');
  renderer.requestRender();
}

/** Lay the selection end-to-end in date order and link them finish-to-start. */
function chainSelection(objects) {
  const ordered = objects.slice().sort((a, b) => a.start - b.start);
  let cursor = ordered[0].start;
  for (const obj of ordered) {
    const duration = TYPES[obj.type]?.duration ? obj.end - obj.start : 0;
    store.updateObject(obj.id, { start: cursor, end: cursor + duration }, 'Chain objects');
    cursor += duration || MS_DAY;
  }
  for (let i = 1; i < ordered.length; i++) {
    store.addLink({ from: ordered[i - 1].id, to: ordered[i].id, type: 'FS' });
  }
  renderer.requestRender();
}

/** Even out the gaps between the selection's start dates. */
function distribute(objects) {
  const ordered = objects.slice().sort((a, b) => a.start - b.start);
  if (ordered.length < 3) return;
  const first = ordered[0].start;
  const last = ordered[ordered.length - 1].start;
  const step = (last - first) / (ordered.length - 1);
  ordered.forEach((obj, i) => {
    const target = first + step * i;
    const shift = target - obj.start;
    store.updateObject(obj.id, TYPES[obj.type]?.duration ? { start: target, end: obj.end + shift } : { start: target }, 'Distribute');
  });
  renderer.requestRender();
}

/* ══════════════════════════════════════════════════════════════════════════
   Dependency
   ═══════════════════════════════════════════════════════════════════════ */

function renderLink(linkId) {
  const link = store.getDoc().links.find((l) => l.id === linkId);
  if (!link) {
    renderProject();
    return;
  }
  const from = store.getObject(link.from);
  const to = store.getObject(link.to);

  headerFor('Dependency', `${from?.title || '?'} → ${to?.title || '?'}`, [
    el('button', {
      class: 'cx-btn icon mini ghost',
      title: 'Delete dependency',
      'aria-label': 'Delete dependency',
      html: icon('trash', { size: 13 }),
      onClick: () => {
        store.removeLinks([link.id]);
        renderer.setSelectedLinks([]);
        renderer.requestRender();
        render();
      },
    }),
  ]);

  bodyEl.appendChild(
    section('Relationship', [
      field('Type', selectInput({
        value: link.type,
        options: Object.entries(LINK_TYPES).map(([id, t]) => ({ value: id, label: t.label })),
        onChange: (v) => {
          store.updateLink(link.id, { type: v });
          renderer.requestRender();
        },
      })),
      field('Lag (days)', numberInput({
        value: link.lag || 0,
        onChange: (v) => {
          store.updateLink(link.id, { lag: v });
          renderer.requestRender();
        },
      }), 'Negative values create a lead (overlap).'),
      field('Connector style', selectInput({
        value: link.style || '',
        placeholder: 'Project default',
        options: CONNECTOR_STYLES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })),
        onChange: (v) => {
          store.updateLink(link.id, { style: v });
          renderer.requestRender();
        },
      })),
      field('Label', textInput({
        value: link.label || '',
        placeholder: 'Optional label',
        onInput: (v) => {
          store.updateLink(link.id, { label: v });
          renderer.requestRender();
        },
      })),
      field('Colour', colorControl({
        value: link.color || '#8b93a3',
        allowInherit: true,
        onChange: (v) => {
          store.updateLink(link.id, { color: v });
          renderer.requestRender();
        },
      })),
    ])
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Project (nothing selected)
   ═══════════════════════════════════════════════════════════════════════ */

function renderProject() {
  const doc = store.getDoc();
  headerFor('Project', doc.name);

  bodyEl.append(
    section('Project details', [
      field('Name', textInput({ value: doc.name, onInput: (v) => store.setMeta({ name: v }, 'Rename project', { mergeKey: 'projname' }) })),
      field('Client', textInput({ value: doc.client, placeholder: 'Metro Authority', onInput: (v) => store.setMeta({ client: v }, 'Change client') })),
      field('Programme', textInput({ value: doc.programme, placeholder: 'CBTC Deployment · Phase 2', onInput: (v) => store.setMeta({ programme: v }, 'Change programme') })),
      field('Description', el('textarea', {
        class: 'cx-textarea',
        rows: 3,
        text: doc.description,
        onChange: (e) => store.setMeta({ description: e.target.value }, 'Change description'),
      })),
    ]),
    section('Planning date', [
      field('Simulate "today" as', textInput({
        type: 'date',
        value: doc.settings.todayOverride || '',
        onChange: (v) => {
          store.setSetting('todayOverride', v || null, 'Change planning date');
          renderer.requestRender();
        },
      }), 'Leave empty to follow the system clock. Useful for what-if reviews.'),
      doc.settings.todayOverride
        ? el('button', {
            class: 'cx-btn mini',
            html: icon('refresh', { size: 12 }) + '<span>Back to real today</span>',
            onClick: () => {
              store.setSetting('todayOverride', null, 'Use system date');
              renderer.requestRender();
              render();
            },
          })
        : null,
    ]),
    emptyState({
      iconName: 'cursor',
      title: 'Nothing selected',
      message: 'Click an object to edit it, drag on empty canvas to marquee-select, or use Add to place something new.',
    })
  );
}
