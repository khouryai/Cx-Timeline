/**
 * Focused editor dialogs.
 *
 * The inspector is always-on and shallow; this is the deep, deliberate edit —
 * opened by double-click or Enter — with the object's schedule, details,
 * notes and attachments on one surface.
 *
 * Imports: util, dates, model, store, renderer, icons, components, notes,
 *          attachments.
 */

import { el, clear } from '../core/util.js';
import { toISO, toMs, fmtDate, fmtDuration, MS_DAY } from '../core/dates.js';
import {
  TYPES,
  STATUSES,
  STATUS_IDS,
  SEVERITIES,
  APPROVALS,
  SUBSYSTEMS,
  TEST_KINDS,
  durationDays,
} from '../core/model.js';
import * as store from '../core/store.js';
import * as renderer from '../timeline/renderer.js';
import { icon } from './icons.js';
import { openModal, field, textInput, numberInput, selectInput, rangeInput, toast, badge } from './components.js';
import { noteEditor } from './notes.js';
import { attachmentList } from './attachments.js';

/**
 * Open the full editor for an object.
 * Edits apply live (so the timeline updates as you type) and the dialog's
 * Cancel restores the pre-edit state via a single undo.
 */
export function openObjectDialog(id) {
  const obj = store.getObject(id);
  if (!obj) return;
  const def = TYPES[obj.type] || TYPES.activity;

  const historyDepthBefore = store.historyState().depth;

  const tabs = el('div', { class: 'cx-seg stretch', style: { marginBottom: '14px' } });
  const panes = el('div');
  const paneMap = new Map();

  const addTab = (key, label, iconName, build) => {
    const button = el('button', {
      dataset: { tab: key },
      onClick: () => selectTab(key),
      html: icon(iconName, { size: 12 }) + `<span>${label}</span>`,
    });
    tabs.appendChild(button);
    const pane = el('div', { style: { display: 'none', flexDirection: 'column', gap: '13px' } });
    build(pane);
    panes.appendChild(pane);
    paneMap.set(key, { button, pane });
  };

  function selectTab(key) {
    for (const [k, entry] of paneMap) {
      entry.button.classList.toggle('active', k === key);
      entry.pane.style.display = k === key ? 'flex' : 'none';
    }
  }

  addTab('details', 'Details', 'sliders', (pane) => buildDetails(pane, obj, def));
  addTab('notes', 'Notes', 'comment', (pane) => buildNotes(pane, obj));
  addTab('files', 'Attachments', 'paperclip', (pane) => pane.appendChild(attachmentList(obj.id).root));
  addTab('links', 'Dependencies', 'link', (pane) => buildLinks(pane, obj));

  selectTab('details');

  openModal({
    title: obj.title || def.label,
    subtitle: `${def.label} · ${store.getLane(obj.lane)?.name || 'No lane'}`,
    size: 'wide',
    body: el('div', {}, [tabs, panes]),
    actions: [
      {
        label: 'Revert changes',
        onClick: () => {
          // Roll back exactly the edits this dialog made.
          const steps = store.historyState().depth - historyDepthBefore;
          for (let i = 0; i < steps; i++) store.undo();
          renderer.requestRender();
        },
      },
      'spacer',
      { label: 'Done', kind: 'primary', autofocus: true },
    ],
  });
}

/* ── Details tab ───────────────────────────────────────────────────────── */

function buildDetails(pane, obj, def) {
  const set = (patch, label, opts) => {
    store.updateObject(obj.id, patch, label || 'Edit object', opts);
    renderer.requestRender();
  };

  pane.append(
    field('Title', textInput({
      value: obj.title,
      onInput: (v) => set({ title: v }, 'Rename object', { mergeKey: `dlg-title:${obj.id}` }),
    })),
    field('Subtitle', textInput({
      value: obj.subtitle,
      placeholder: 'Optional second line',
      onInput: (v) => set({ subtitle: v }, 'Edit subtitle', { mergeKey: `dlg-sub:${obj.id}` }),
    })),
    el('div', { class: 'cx-row three' }, [
      field('Lane', selectInput({
        value: obj.lane || '',
        options: store.orderedLanes().map((l) => ({ value: l.id, label: l.name })),
        onChange: (v) => set({ lane: v, row: 0 }, 'Move to lane'),
      })),
      field('Status', selectInput({
        value: obj.status,
        options: STATUS_IDS.map((s) => ({ value: s, label: STATUSES[s].label })),
        onChange: (v) => set({ status: v }, 'Change status'),
      })),
      field('Owner', textInput({
        value: obj.owner,
        placeholder: 'Responsible engineer',
        onInput: (v) => set({ owner: v }, 'Change owner', { mergeKey: `dlg-owner:${obj.id}` }),
      })),
    ])
  );

  if (def.duration) {
    const durationOut = el('span', { class: 'mono', style: { fontSize: 'var(--fs-tiny)', color: 'var(--text-muted)' }, text: fmtDuration(durationDays(obj)) });
    pane.appendChild(
      el('div', { class: 'cx-row three' }, [
        field('Start', textInput({
          type: 'date',
          value: toISO(obj.start),
          onChange: (v) => {
            const ms = toMs(v);
            if (!Number.isFinite(ms)) return;
            const shift = ms - obj.start;
            set({ start: ms, end: obj.end + shift }, 'Change start date');
          },
        })),
        field('Finish', textInput({
          type: 'date',
          value: toISO(obj.end),
          onChange: (v) => {
            const ms = toMs(v);
            if (Number.isFinite(ms)) set({ end: Math.max(ms, obj.start + MS_DAY) }, 'Change finish date');
          },
        })),
        field('Duration', el('div', { class: 'cx-inline' }, [
          numberInput({
            value: durationDays(obj),
            min: 1,
            onChange: (v) => {
              set({ end: obj.start + Math.max(1, v) * MS_DAY }, 'Change duration');
              durationOut.textContent = fmtDuration(Math.max(1, v));
            },
          }),
          durationOut,
        ])),
      ])
    );
  } else {
    pane.appendChild(
      field('Date', textInput({
        type: 'date',
        value: toISO(obj.start),
        onChange: (v) => {
          const ms = toMs(v);
          if (Number.isFinite(ms)) set({ start: ms, end: ms }, 'Change date');
        },
      }))
    );
  }

  if (def.progress) {
    const readout = el('span', { class: 'mono', style: { minWidth: '40px', textAlign: 'right' }, text: `${Math.round(obj.progress)}%` });
    pane.appendChild(
      field('Percent complete', el('div', { class: 'cx-inline' }, [
        rangeInput({
          value: obj.progress,
          min: 0,
          max: 100,
          step: 5,
          onInput: (v) => {
            readout.textContent = `${v}%`;
          },
          onChange: (v) => set({ progress: v }, 'Change progress'),
        }),
        readout,
      ]))
    );
  }

  /* Type-specific block */
  const data = obj.data || {};
  const setData = (key, value, label) => set({ data: { [key]: value } }, label || 'Edit details');
  const has = (name) => def.fields.includes(name);
  const extra = [];

  if (has('version')) {
    extra.push(
      el('div', { class: 'cx-row three' }, [
        field('Version', textInput({ value: data.version || '', placeholder: '2.5.0', onInput: (v) => setData('version', v, 'Change version') })),
        field('Release number', textInput({ value: data.releaseNumber || '', placeholder: 'REL-025', onInput: (v) => setData('releaseNumber', v, 'Change release number') })),
        field('Build number', textInput({ value: data.buildNumber || '', placeholder: '2.5.0-rc3', onInput: (v) => setData('buildNumber', v, 'Change build number') })),
      ]),
      field('Approval', selectInput({
        value: data.approval || 'none',
        options: Object.entries(APPROVALS).map(([id, a]) => ({ value: id, label: a.label })),
        onChange: (v) => setData('approval', v, 'Change approval'),
      }))
    );
  }

  if (has('testPackage') || has('testKind') || has('area') || has('subsystem')) {
    extra.push(
      el('div', { class: 'cx-row three' }, [
        has('subsystem')
          ? field('Subsystem', selectInput({
              value: obj.subsystem,
              placeholder: '—',
              options: SUBSYSTEMS.map((s) => ({ value: s.id, label: s.label })),
              onChange: (v) => set({ subsystem: v }, 'Change subsystem'),
            }))
          : null,
        has('area')
          ? field('Area', textInput({ value: obj.area, placeholder: 'Section / zone', onInput: (v) => set({ area: v }, 'Change area', { mergeKey: `dlg-area:${obj.id}` }) }))
          : null,
        has('testPackage')
          ? field('Test package', textInput({ value: data.testPackage || '', placeholder: 'TP-DYN-01', onInput: (v) => setData('testPackage', v, 'Change test package') }))
          : null,
        has('testKind')
          ? field('Test type', selectInput({
              value: data.testKind || '',
              placeholder: '—',
              options: TEST_KINDS.map((t) => ({ value: t.id, label: t.label })),
              onChange: (v) => setData('testKind', v, 'Change test type'),
            }))
          : null,
      ].filter(Boolean))
    );
  }

  if (has('actualStart')) {
    extra.push(
      el('div', { class: 'cx-row' }, [
        field('Actual start', textInput({ type: 'date', value: data.actualStart || '', onChange: (v) => setData('actualStart', v, 'Set actual start') })),
        field('Actual finish', textInput({ type: 'date', value: data.actualEnd || '', onChange: (v) => setData('actualEnd', v, 'Set actual finish') })),
      ])
    );
  }

  if (has('severity')) {
    extra.push(
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
          : field('Reference', textInput({ value: data.reference || '', onInput: (v) => setData('reference', v, 'Change reference') })),
      ])
    );
  }

  if (has('mitigation')) {
    const area = el('textarea', { class: 'cx-textarea', rows: 3, placeholder: 'How the risk is being managed' });
    area.value = data.mitigation || '';
    area.addEventListener('change', () => setData('mitigation', area.value, 'Edit mitigation'));
    extra.push(field('Mitigation', area));
  }

  if (extra.length) {
    pane.appendChild(el('div', { class: 'eyebrow', style: { marginTop: '4px' }, text: def.label + ' fields' }));
    pane.append(...extra);
  }

  pane.appendChild(
    field('Tags', textInput({
      value: (obj.tags || []).join(', '),
      placeholder: 'comma, separated',
      onChange: (v) => set({ tags: v.split(',').map((t) => t.trim()).filter(Boolean) }, 'Edit tags'),
    }))
  );
}

/* ── Notes tab ─────────────────────────────────────────────────────────── */

function buildNotes(pane, obj) {
  const editor = noteEditor({
    value: obj.notes,
    minHeight: 300,
    onChange: (html) => {
      store.updateObject(obj.id, { notes: html }, 'Edit notes', { mergeKey: `notes:${obj.id}` });
      renderer.requestRender();
    },
  });
  pane.appendChild(editor.root);
}

/* ── Dependencies tab ──────────────────────────────────────────────────── */

function buildLinks(pane, obj) {
  const list = el('div', { class: 'cx-list' });

  function refresh() {
    clear(list);
    const links = store.linksFor([obj.id]);
    if (!links.length) {
      list.appendChild(el('div', { class: 'cx-hint', text: 'No dependencies yet.' }));
      return;
    }
    for (const link of links) {
      const outgoing = link.from === obj.id;
      const other = store.getObject(outgoing ? link.to : link.from);
      if (!other) continue;
      list.appendChild(
        el('div', { class: 'cx-listrow' }, [
          el('span', { style: { display: 'flex', color: 'var(--text-subtle)' }, html: icon(outgoing ? 'arrow' : 'arrow-left', { size: 12 }) }),
          el('div', { class: 'lr-main' }, [
            el('div', { class: 'lr-title', text: other.title }),
            el('div', { class: 'lr-meta', text: `${link.type}${link.lag ? ` ${link.lag > 0 ? '+' : ''}${link.lag}d` : ''} · ${fmtDate(other.start, 'medium')}` }),
          ]),
          el('button', {
            class: 'cx-btn icon mini ghost',
            title: 'Remove',
            'aria-label': 'Remove dependency',
            html: icon('unlink', { size: 12 }),
            onClick: () => {
              store.removeLinks([link.id]);
              renderer.requestRender();
              refresh();
            },
          }),
        ])
      );
    }
  }

  const candidates = store.getDoc().objects.filter((o) => o.id !== obj.id);
  const picker = selectInput({
    value: '',
    placeholder: 'Add a successor…',
    options: candidates.map((o) => ({ value: o.id, label: `${o.title} (${fmtDate(o.start, 'compact')})` })),
    onChange: (v) => {
      if (!v) return;
      const created = store.addLink({ from: obj.id, to: v, type: 'FS' });
      if (!created) toast({ tone: 'warn', title: 'Not linked', message: 'That link exists already or would create a loop.' });
      renderer.requestRender();
      refresh();
      picker.value = '';
    },
  });

  refresh();
  pane.append(list, field('Add dependency', picker, 'Creates a finish-to-start link. Change the type in the inspector.'));
}

/* ══════════════════════════════════════════════════════════════════════════
   Lane editor
   ═══════════════════════════════════════════════════════════════════════ */

export function openLaneDialog(id) {
  const lane = store.getLane(id);
  if (!lane) return;
  const set = (patch, label) => {
    store.updateLane(id, patch, label || 'Edit lane');
    renderer.requestRender();
  };

  openModal({
    title: `Lane — ${lane.name}`,
    body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } }, [
      field('Name', textInput({ value: lane.name, onInput: (v) => set({ name: v }, 'Rename lane') })),
      field('Description', textInput({ value: lane.description, placeholder: 'Optional', onInput: (v) => set({ description: v }, 'Edit lane description') })),
      el('div', { class: 'cx-row' }, [
        field('Colour', el('input', {
          class: 'cx-color',
          type: 'color',
          value: lane.color,
          onInput: (e) => set({ color: e.target.value }, 'Change lane colour'),
        })),
        field('Height (px)', numberInput({ value: lane.height, min: 28, max: 480, step: 4, onChange: (v) => set({ height: v }, 'Resize lane') })),
      ]),
      field('Group', textInput({ value: lane.group, placeholder: 'Optional grouping label', onInput: (v) => set({ group: v }, 'Change lane group') })),
    ]),
    actions: [{ label: 'Done', kind: 'primary' }],
  });
}
