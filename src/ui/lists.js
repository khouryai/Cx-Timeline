/**
 * Editable dropdown vocabularies.
 *
 * Two things live here: `managedSelect()`, a dropdown that can edit its own
 * options, and the manager dialog behind it. Every list the user can change —
 * status, subsystem, test type, severity, approval, fonts, and the owner and
 * area suggestion lists — is reached through these, so adding a status from
 * the inspector and adding one from the Lists pane run the same code.
 *
 * Imports: util, events, model, query, store, renderer, icons, components.
 */

import { el, clear } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { LIST_DEFS, LIST_IDS, TONES, listOptions, listOption } from '../core/model.js';
import * as store from '../core/store.js';
import * as renderer from '../timeline/renderer.js';
import { icon } from './icons.js';
import { facet } from '../core/query.js';
import {
  openModal,
  domId,
  field,
  textInput,
  selectInput,
  colorControl,
  confirmDialog,
  toast,
  emptyState,
} from './components.js';

/**
 * Sentinel values for the two action rows at the foot of every managed
 * dropdown. A leading NUL cannot occur in a real option id, so a
 * user-defined option can never collide with them.
 */
const ADD = '\u0000add';
const MANAGE = '\u0000manage';

/* ══════════════════════════════════════════════════════════════════════════
   The dropdown
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A `<select>` bound to an editable list, with "Add option…" and "Manage
 * list…" at the bottom.
 *
 * A value that is not in the list (imported data, or an option someone else
 * deleted) is still shown and still selected, marked so it is obvious why it
 * looks different — silently dropping it would silently change the object.
 *
 * @param {object}   opts
 * @param {string}   opts.listId
 * @param {string}   opts.value
 * @param {Function} opts.onChange
 * @param {string}   [opts.placeholder]  Shown as the empty choice.
 * @param {boolean}  [opts.mini]
 * @param {boolean}  [opts.allowEmpty]   Offer a blank choice (default: true
 *                                       unless the list def says required).
 */
export function managedSelect({ listId, value, onChange, placeholder, mini = false, allowEmpty = null }) {
  const def = LIST_DEFS[listId] || { label: listId };
  const select = el('select', { class: 'cx-select' + (mini ? ' mini' : ''), dataset: { list: listId } });

  const rebuild = (current) => {
    clear(select);
    const empty = allowEmpty == null ? !def.required : allowEmpty;
    if (empty) select.appendChild(el('option', { value: '', text: placeholder || '—' }));

    const options = listOptions(listId);
    for (const option of options) {
      if (option.id === '' && empty) continue; // already covered by the blank row
      select.appendChild(el('option', { value: option.id, text: option.label }));
    }

    // Keep an unknown value visible rather than snapping the field to blank.
    if (current && !options.some((o) => o.id === current)) {
      select.appendChild(el('option', { value: current, text: `${current} — not in list` }));
    }

    select.appendChild(el('option', { value: '\u0000sep', text: '──────────', disabled: true }));
    select.appendChild(el('option', { value: ADD, text: `＋  Add ${def.label.toLowerCase()}…` }));
    select.appendChild(el('option', { value: MANAGE, text: `⚙  Manage ${def.label.toLowerCase()}…` }));

    select.value = current ?? '';
  };

  let last = value ?? '';
  rebuild(last);

  select.addEventListener('change', () => {
    const picked = select.value;

    if (picked === ADD || picked === MANAGE) {
      // Never let a command leak out as a value.
      select.value = last;
      const done = (chosenId) => {
        rebuild(chosenId ?? last);
        if (chosenId != null && chosenId !== last) {
          last = chosenId;
          select.value = chosenId;
          onChange(chosenId);
        }
      };
      if (picked === ADD) promptNewOption(listId, done);
      else openListManager(listId, () => done(null));
      return;
    }

    if (picked === '\u0000sep') {
      select.value = last;
      return;
    }

    last = picked;
    onChange(picked);
  });

  return select;
}

/**
 * A text input backed by a suggestion list (owner, area).
 *
 * These stay free text — a plan should never block you from typing a name
 * that is not yet on a list — but the list is offered through a `datalist`,
 * and the manager is one click away.
 */
export function suggestInput({ listId, value, onInput, onChange, placeholder, mini = false }) {
  // The inspector and the object dialog can both be showing an Owner field at
  // once, so the datalist needs an id of its own — a duplicate would silently
  // hand one of them the wrong suggestions.
  const listElementId = domId(`sg-${listId}`);
  const input = textInput({ value, placeholder, mini, onInput, onChange });
  input.setAttribute('list', listElementId);

  const datalist = el('datalist', { id: listElementId });
  for (const suggestion of suggestions(listId)) {
    datalist.appendChild(el('option', { value: suggestion }));
  }

  const manage = el('button', {
    class: 'cx-btn icon mini ghost',
    title: `Manage ${LIST_DEFS[listId]?.label.toLowerCase() || listId} suggestions`,
    'aria-label': `Manage ${LIST_DEFS[listId]?.label || listId} suggestions`,
    html: icon('list', { size: 12 }),
    onClick: () => openListManager(listId),
  });

  return el('div', { class: 'cx-inline' }, [
    el('div', { style: { flex: '1', minWidth: '0' } }, [input, datalist]),
    manage,
  ]);
}

/**
 * Suggestions for a free-text field: the curated list plus whatever the plan
 * already uses. Typing a new owner should make that owner offerable on the
 * next object without anyone having to curate a list first.
 */
function suggestions(listId) {
  const out = [];
  const seen = new Set();
  for (const option of listOptions(listId)) {
    if (option.id && !seen.has(option.id)) { seen.add(option.id); out.push(option.id); }
  }
  const def = LIST_DEFS[listId];
  if (def?.field) {
    for (const entry of facet(store.getDoc(), def.field)) {
      if (entry.value && !seen.has(entry.value)) { seen.add(entry.value); out.push(entry.value); }
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   Add an option
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Ask for a new option and add it.
 * `onDone(id|null)` reports the id that was created, so the dropdown that
 * launched this can select it straight away.
 */
export function promptNewOption(listId, onDone = () => {}) {
  const def = LIST_DEFS[listId] || { label: listId };
  const labelInput = textInput({ value: '', placeholder: `New ${def.label.toLowerCase()}` });

  let color = '#5b93f5';
  let tone = 'neutral';

  const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } }, [
    field('Name', labelInput),
    def.color ? field('Colour', colorControl({ value: color, onChange: (v) => { color = v; } })) : null,
    def.tone
      ? field('Tone', selectInput({
          value: tone,
          options: TONES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })),
          onChange: (v) => { tone = v; },
        }), 'Controls the badge colour where this value is shown as a chip.')
      : null,
    el('div', { class: 'cx-hint', text: def.hint || '' }),
  ].filter(Boolean));

  let settled = false;
  const modal = openModal({
    title: `Add ${def.label.toLowerCase()}`,
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Add',
        kind: 'primary',
        onClick: () => {
          settled = true;
          onDone(commit());
        },
      },
    ],
    onClose: () => {
      if (!settled) onDone(null);
    },
  });

  function commit() {
    const label = labelInput.value.trim();
    if (!label) return null;
    // The id is what every object stores, so derive a stable one from the
    // name rather than letting it drift with later renames.
    const id = listId === 'font' ? label : slugify(label, listId);
    const created = store.addListOption(listId, {
      id,
      label,
      color: def.color ? color : undefined,
      tone: def.tone ? tone : undefined,
    });
    if (!created) {
      toast({ tone: 'warn', title: 'Already on the list', message: `"${label}" is already a ${def.label.toLowerCase()} option.` });
      return null;
    }
    renderer.requestRender();
    return created;
  }

  labelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      settled = true;
      const id = commit();
      modal.close();
      onDone(id);
    }
  });

  setTimeout(() => labelInput.focus(), 40);
}

/** A url-safe id, unique within the list. */
function slugify(label, listId) {
  const base =
    String(label)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'option';

  const taken = new Set(listOptions(listId).map((o) => o.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   The editor
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Which list the editor last showed.
 *
 * Every mutation writes to the store, and the dock rebuilds its pane on
 * `doc:changed` — so without this, deleting an option would drop the reader
 * back on the first tab mid-task.
 */
let lastList = LIST_IDS[0];

/**
 * The list editor, as a detached node.
 *
 * The modal and the Lists dock pane are the same widget — building it once
 * means "add a status" behaves identically wherever it is reached, and there
 * is only one place to change when a list grows a new property.
 *
 * @param {object}   [opts]
 * @param {string}   [opts.listId]  Start on this list (default: the first).
 * @param {boolean}  [opts.tabs]    Offer the list picker (default: true).
 * @returns {{node: HTMLElement, refresh: Function, active: Function}}
 */
export function listEditor({ listId = null, tabs: showTabs = true } = {}) {
  let active = listId && LIST_DEFS[listId] ? listId : lastList;

  const tabs = el('div', { class: 'cx-seg', style: { flexWrap: 'wrap', marginBottom: '13px' } });
  const body = el('div');
  const node = el('div', {}, showTabs ? [tabs, body] : [body]);

  if (showTabs) {
    for (const id of LIST_IDS) {
      tabs.appendChild(
        el('button', { dataset: { list: id }, text: LIST_DEFS[id].label, onClick: () => selectTab(id) })
      );
    }
  }

  function selectTab(id) {
    active = id;
    lastList = id;
    for (const button of tabs.children) button.classList.toggle('active', button.dataset.list === id);
    renderList();
  }

  function renderList() {
    clear(body);
    const def = LIST_DEFS[active];
    const options = listOptions(active);

    body.appendChild(el('div', { class: 'cx-hint', style: { marginBottom: '10px' }, text: def.hint || '' }));

    if (!options.length) {
      body.appendChild(
        emptyState({
          iconName: 'list',
          title: 'No options yet',
          message: `Add the ${def.label.toLowerCase()} values this programme uses.`,
        })
      );
    } else {
      const rows = el('div', { class: 'cx-list' });
      options.forEach((option, index) => rows.appendChild(optionRow(active, def, option, index, options.length)));
      body.appendChild(rows);
    }

    body.appendChild(
      el('div', { style: { display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' } }, [
        el('button', {
          class: 'cx-btn mini primary',
          html: icon('plus', { size: 12 }) + '<span>Add option</span>',
          onClick: () => promptNewOption(active, () => renderList()),
        }),
        el('button', {
          class: 'cx-btn mini',
          html: icon('refresh', { size: 12 }) + '<span>Restore defaults</span>',
          title: 'Re-add the shipped options, keeping any custom one still in use',
          onClick: async () => {
            const ok = await confirmDialog({
              title: `Restore ${def.label.toLowerCase()} defaults`,
              message: 'The shipped options come back. Custom options still used by an object are kept; unused ones are removed.',
              confirmLabel: 'Restore',
            });
            if (ok) {
              store.resetList(active);
              changed();
              renderList();
            }
          },
        }),
      ])
    );
  }

  function optionRow(listId_, def, option, index, total) {
    const usage = store.listOptionUsage(listId_, option.id);

    const label = textInput({
      value: option.label,
      mini: true,
      onChange: (v) => {
        store.updateListOption(listId_, option.id, { label: v.trim() || option.id });
        changed();
      },
    });
    label.setAttribute('aria-label', `Name for ${option.label}`);

    return el('div', { class: 'list-opt', dataset: { option: option.id } }, [
      def.color
        ? el('input', {
            class: 'cx-color lo-swatch',
            type: 'color',
            value: toHex(option.color),
            title: 'Option colour',
            'aria-label': `Colour for ${option.label}`,
            // `change`, not `input`: the dock pane rebuilds on doc:changed and
            // a colour input is not covered by the typing guard, so a live
            // stream of edits would pull the picker out from under the drag.
            onChange: (e) => {
              store.updateListOption(listId_, option.id, { color: e.target.value });
              changed();
            },
          })
        : el('span', { class: 'cx-dot lo-swatch', style: { background: 'var(--text-subtle)' } }),

      el('div', { class: 'lo-name' }, [label]),

      el('div', { class: 'lo-actions' }, [
        iconButton('chevron-up', 'Move up', index === 0, () => {
          store.moveListOption(listId_, option.id, -1);
          changed();
          renderList();
        }),
        iconButton('chevron-down', 'Move down', index === total - 1, () => {
          store.moveListOption(listId_, option.id, 1);
          changed();
          renderList();
        }),
        iconButton('trash', 'Remove option', false, () => confirmRemoval(listId_, def, option, usage)),
      ]),

      el('div', { class: 'lo-foot' }, [
        el('div', { class: 'lo-meta', text: `${option.id || '(blank)'} · ${usage ? `used by ${usage}` : 'unused'}` }),
        def.tone
          ? el('div', { class: 'lo-tone' }, [
              selectInput({
                value: option.tone || 'neutral',
                mini: true,
                options: TONES.map((t) => ({ value: t, label: t })),
                onChange: (v) => {
                  store.updateListOption(listId_, option.id, { tone: v });
                  changed();
                },
              }),
            ])
          : null,
      ].filter(Boolean)),
    ].filter(Boolean));
  }

  function confirmRemoval(listId_, def, option, usage) {
    if (!usage) {
      store.removeListOption(listId_, option.id);
      changed();
      renderList();
      return;
    }

    // Something still points at it, so ask what those objects should become
    // rather than leaving them referencing an option that no longer exists.
    const replacements = listOptions(listId_).filter((o) => o.id !== option.id);
    let reassignTo = '';

    let settled = false;
    openModal({
      title: `Remove "${option.label}"`,
      body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '13px' } }, [
        el('div', { style: { fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }, text: `${usage} object${usage === 1 ? '' : 's'} currently use this ${def.label.toLowerCase()}.` }),
        field('Move them to', selectInput({
          value: '',
          placeholder: '— leave blank —',
          options: replacements.map((o) => ({ value: o.id, label: o.label })),
          onChange: (v) => { reassignTo = v; },
        }), 'Leaving it blank clears the field on those objects.'),
      ]),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Remove',
          kind: 'danger',
          onClick: () => {
            settled = true;
            const target = reassignTo ? listOption(listId_, reassignTo)?.label : '';
            store.removeListOption(listId_, option.id, { reassignTo });
            changed();
            renderList();
            toast({
              tone: 'good',
              title: `"${option.label}" removed`,
              message: target
                ? `${usage} object${usage === 1 ? '' : 's'} moved to "${target}".`
                : `${usage} object${usage === 1 ? '' : 's'} had the field cleared.`,
            });
          },
        },
      ],
      onClose: () => {
        if (!settled) renderList();
      },
    });
  }

  /** One announcement for every mutation: repaint, then tell the UI. */
  function changed() {
    renderer.requestRender();
    emit(EV.LISTS_CHANGED, { listId: active });
  }

  selectTab(active);
  return { node, refresh: renderList, active: () => active };
}

/* ══════════════════════════════════════════════════════════════════════════
   The manager dialog
   ═══════════════════════════════════════════════════════════════════════ */

/** Open the manager for one list, or the whole set when `listId` is omitted. */
export function openListManager(listId = null, onClose = () => {}) {
  const editor = listEditor({ listId });

  return openModal({
    title: 'Manage lists',
    subtitle: 'Options are saved with the project, and every change is undoable.',
    size: 'wide',
    body: editor.node,
    actions: [{ label: 'Done', kind: 'primary' }],
    onClose: () => {
      emit(EV.LISTS_CHANGED, { listId: editor.active() });
      onClose();
    },
  });
}

function iconButton(name, title, disabled, onClick) {
  return el('button', {
    class: 'cx-btn icon mini ghost',
    title,
    'aria-label': title,
    disabled,
    html: icon(name, { size: 11 }),
    onClick,
  });
}

/** Colour inputs need a concrete hex; theme tokens resolve to one. */
function toHex(color) {
  if (!color) return '#5b93f5';
  const value = String(color).trim();
  if (value.startsWith('#')) return value.length === 4
    ? '#' + value.slice(1).split('').map((c) => c + c).join('')
    : value.slice(0, 7);

  if (value.startsWith('var(')) {
    try {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(value.slice(4, -1).trim()).trim();
      if (resolved.startsWith('#')) return resolved.length === 4
        ? '#' + resolved.slice(1).split('').map((c) => c + c).join('')
        : resolved.slice(0, 7);
    } catch {
      /* fall through to the default */
    }
  }
  return '#5b93f5';
}
