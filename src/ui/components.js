/**
 * Reusable UI primitives: modals, toasts, context menus, tooltips, popovers
 * and the small form builders the inspector and dialogs are assembled from.
 *
 * Every widget here is imperative and self-contained — call it, get a handle
 * back, close it when done. Nothing in this module knows about the document
 * model, which keeps it reusable across the whole app.
 *
 * Imports: util, events, icons.
 */

import { el, clear, escapeHtml, uid, IS_MAC, clamp } from '../core/util.js';
import { on, EV } from '../core/events.js';
import { icon, searchIcons, hasIcon } from './icons.js';

/* ══════════════════════════════════════════════════════════════════════════
   Modal
   ═══════════════════════════════════════════════════════════════════════ */

const modalStack = [];

/**
 * Open a modal dialog.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.subtitle]
 * @param {HTMLElement|string} opts.body   Element or HTML string.
 * @param {Array}  [opts.actions]          [{label, kind, onClick, autofocus}]
 * @param {string} [opts.size]             '' | 'wide' | 'xl'
 * @param {Function} [opts.onClose]
 * @returns {{close:Function, root:HTMLElement, body:HTMLElement}}
 */
export function openModal(opts) {
  const overlay = el('div', { class: 'cx-modal-overlay', role: 'presentation' });
  const dialog = el('div', {
    class: 'cx-modal' + (opts.size ? ' ' + opts.size : ''),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': opts.title || 'Dialog',
  });

  const head = el('div', { class: 'cx-modal-head' }, [
    el('div', {}, [
      el('div', { class: 'cx-modal-title', text: opts.title || '' }),
      opts.subtitle ? el('div', { class: 'cx-modal-sub', text: opts.subtitle }) : null,
    ]),
    el('button', {
      class: 'cx-btn icon mini ghost',
      'aria-label': 'Close dialog',
      html: icon('x', { size: 15 }),
      onClick: () => handle.close(),
    }),
  ]);

  const body = el('div', { class: 'cx-modal-body' });
  if (typeof opts.body === 'string') body.innerHTML = opts.body;
  else if (opts.body) body.appendChild(opts.body);

  dialog.append(head, body);

  if (opts.actions && opts.actions.length) {
    const foot = el('div', { class: 'cx-modal-foot' });
    for (const action of opts.actions) {
      if (action === 'spacer') {
        foot.appendChild(el('div', { class: 'spacer' }));
        continue;
      }
      const button = el('button', {
        class: 'cx-btn' + (action.kind ? ' ' + action.kind : ''),
        text: action.label,
        onClick: () => {
          const result = action.onClick ? action.onClick(handle) : undefined;
          if (result !== false && action.keepOpen !== true) handle.close();
        },
      });
      if (action.autofocus) setTimeout(() => button.focus(), 30);
      foot.appendChild(button);
    }
    dialog.appendChild(foot);
  }

  overlay.appendChild(dialog);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay && opts.dismissible !== false) handle.close();
  });

  const onKey = (e) => {
    if (modalStack[modalStack.length - 1] !== handle) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (opts.dismissible !== false) handle.close();
    }
    if (e.key === 'Tab') trapFocus(e, dialog);
  };

  const handle = {
    root: overlay,
    dialog,
    body,
    close(result) {
      if (!overlay.isConnected) return;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      const i = modalStack.indexOf(handle);
      if (i >= 0) modalStack.splice(i, 1);
      if (opts.onClose) opts.onClose(result);
      const previous = modalStack[modalStack.length - 1];
      if (previous) focusFirst(previous.dialog);
    },
  };

  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  modalStack.push(handle);
  setTimeout(() => focusFirst(dialog), 20);
  return handle;
}

function focusFirst(root) {
  const target = root.querySelector('[autofocus], input:not([type=hidden]), select, textarea, button.primary, button');
  if (target) target.focus();
}

function trapFocus(e, root) {
  const focusable = Array.from(
    root.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
  ).filter((n) => n.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** True when any modal is currently open — shortcuts check this. */
export function modalOpen() {
  return modalStack.length > 0;
}

/* ── Confirm / prompt ──────────────────────────────────────────────────── */

export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    openModal({
      title,
      body: el('div', { style: { fontSize: 'var(--fs-small)', color: 'var(--text-muted)', lineHeight: '1.55' }, text: message }),
      actions: [
        { label: cancelLabel, onClick: () => { settled = true; resolve(false); } },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', autofocus: true, onClick: () => { settled = true; resolve(true); } },
      ],
      onClose: () => {
        if (!settled) resolve(false);
      },
    });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', multiline = false, confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    const input = multiline
      ? el('textarea', { class: 'cx-textarea', placeholder, rows: 5 })
      : el('input', { class: 'cx-input', type: 'text', placeholder, value });
    if (multiline) input.value = value;

    let settled = false;
    const modal = openModal({
      title,
      body: el('div', { class: 'cx-field' }, [label ? el('label', { class: 'cx-label', text: label }) : null, input]),
      actions: [
        { label: 'Cancel', onClick: () => { settled = true; resolve(null); } },
        { label: confirmLabel, kind: 'primary', onClick: () => { settled = true; resolve(input.value); } },
      ],
      onClose: () => {
        if (!settled) resolve(null);
      },
    });

    setTimeout(() => {
      input.focus();
      input.select?.();
    }, 30);
    if (!multiline) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          settled = true;
          resolve(input.value);
          modal.close();
        }
      });
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Toasts
   ═══════════════════════════════════════════════════════════════════════ */

let toastHost = null;

function ensureToastHost() {
  if (!toastHost) {
    toastHost = el('div', { id: 'cx-toasts' });
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

const TOAST_ICONS = { good: 'check-circle', warn: 'warning', bad: 'x-circle', info: 'info' };

/**
 * Show a transient notification.
 * @param {{tone?:string, title?:string, message?:string, timeout?:number, sticky?:boolean, action?:{label,onClick}}} opts
 */
export function toast(opts) {
  const tone = opts.tone || 'info';
  const host = ensureToastHost();
  const node = el('div', { class: `cx-toast ${tone}`, role: 'status' }, [
    el('span', { class: 't-icon', html: icon(TOAST_ICONS[tone] || 'info', { size: 16 }) }),
    el('div', { class: 't-body' }, [
      opts.title ? el('div', { class: 't-title', text: opts.title }) : null,
      opts.message ? el('div', { class: 't-msg', text: opts.message }) : null,
    ]),
    opts.action
      ? el('button', {
          class: 'cx-btn mini',
          text: opts.action.label,
          onClick: () => {
            opts.action.onClick();
            dismiss();
          },
        })
      : null,
    el('button', { class: 'cx-btn icon mini ghost', 'aria-label': 'Dismiss', html: icon('x', { size: 13 }), onClick: () => dismiss() }),
  ]);

  function dismiss() {
    node.classList.add('out');
    setTimeout(() => node.remove(), 240);
  }

  host.appendChild(node);
  if (!opts.sticky) setTimeout(dismiss, opts.timeout || 3600);
  return { dismiss };
}

// Anything in the app can raise a toast by emitting an event, which keeps
// low-level modules (storage, exporters) free of UI imports.
on(EV.TOAST, (payload) => toast(payload || {}));

/* ══════════════════════════════════════════════════════════════════════════
   Context menu
   ═══════════════════════════════════════════════════════════════════════ */

let openMenu = null;

/**
 * Show a context menu at a screen position.
 * Items: {label, icon, key, onClick, disabled, danger} | 'sep' | {heading}
 */
export function contextMenu(x, y, items) {
  closeMenu();
  const menu = el('div', { class: 'cx-menu', role: 'menu' });

  for (const item of items) {
    if (!item) continue;
    if (item === 'sep') {
      menu.appendChild(el('div', { class: 'cx-menu-sep' }));
      continue;
    }
    if (item.heading) {
      menu.appendChild(el('div', { class: 'cx-menu-head', text: item.heading }));
      continue;
    }
    const button = el('button', {
      class: 'cx-menu-item' + (item.danger ? ' danger' : ''),
      role: 'menuitem',
      disabled: !!item.disabled,
      onClick: () => {
        closeMenu();
        item.onClick?.();
      },
    }, [
      item.icon ? el('span', { html: icon(item.icon, { size: 14 }), style: { display: 'flex', opacity: '0.8' } }) : el('span', { style: { width: '14px' } }),
      el('span', { class: 'mi-label', text: item.label }),
      item.key ? el('span', { class: 'mi-key', text: keyHint(item.key) }) : null,
    ]);
    menu.appendChild(button);
  }

  document.body.appendChild(menu);

  // Keep the menu inside the viewport, flipping rather than clipping.
  const rect = menu.getBoundingClientRect();
  const left = x + rect.width > window.innerWidth - 8 ? Math.max(8, x - rect.width) : x;
  const top = y + rect.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - rect.height - 8) : y;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  openMenu = menu;
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onMenuKey, true);
    window.addEventListener('blur', closeMenu);
  }, 0);
  return { close: closeMenu };
}

function onOutside(e) {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
}

function onMenuKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeMenu();
    return;
  }
  if (!openMenu) return;
  const items = Array.from(openMenu.querySelectorAll('.cx-menu-item:not(:disabled)'));
  if (!items.length) return;
  const current = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    items[(current + 1) % items.length].focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    items[(current - 1 + items.length) % items.length].focus();
  }
}

export function closeMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onMenuKey, true);
  window.removeEventListener('blur', closeMenu);
}

/** 'mod+z' → '⌘Z' on macOS, 'Ctrl+Z' elsewhere. */
export function keyHint(spec) {
  return String(spec)
    .split('+')
    .map((part) => {
      const p = part.trim().toLowerCase();
      if (p === 'mod') return IS_MAC ? '⌘' : 'Ctrl';
      if (p === 'shift') return IS_MAC ? '⇧' : 'Shift';
      if (p === 'alt') return IS_MAC ? '⌥' : 'Alt';
      if (p === 'del' || p === 'delete') return IS_MAC ? '⌫' : 'Del';
      if (p === 'enter') return IS_MAC ? '↵' : 'Enter';
      if (p === 'esc') return 'Esc';
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(IS_MAC ? '' : '+');
}

/* ══════════════════════════════════════════════════════════════════════════
   Tooltip
   ═══════════════════════════════════════════════════════════════════════ */

let tooltipNode = null;
let tooltipTimer = null;

/**
 * Show a tooltip near a point. `content` may be a string or an element.
 * Tooltips never take pointer events, so they cannot interfere with a drag.
 */
export function showTooltip(x, y, content, { delay = 0, html = false } = {}) {
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(() => {
    hideTooltip();
    tooltipNode = el('div', { class: 'cx-tooltip' });
    if (typeof content === 'string') {
      if (html) tooltipNode.innerHTML = content;
      else tooltipNode.textContent = content;
    } else if (content) {
      tooltipNode.appendChild(content);
    }
    document.body.appendChild(tooltipNode);

    const rect = tooltipNode.getBoundingClientRect();
    let left = x + 14;
    let top = y + 16;
    if (left + rect.width > window.innerWidth - 10) left = Math.max(10, x - rect.width - 14);
    if (top + rect.height > window.innerHeight - 10) top = Math.max(10, y - rect.height - 14);
    tooltipNode.style.left = `${left}px`;
    tooltipNode.style.top = `${top}px`;
  }, delay);
}

export function hideTooltip() {
  clearTimeout(tooltipTimer);
  if (tooltipNode) {
    tooltipNode.remove();
    tooltipNode = null;
  }
}

/** Attach a simple hover tooltip to an element. */
export function attachTooltip(node, text, delay = 420) {
  node.addEventListener('mouseenter', (e) => showTooltip(e.clientX, e.clientY, text, { delay }));
  node.addEventListener('mouseleave', hideTooltip);
  node.addEventListener('mousedown', hideTooltip);
}

/* ══════════════════════════════════════════════════════════════════════════
   Popover — anchored panel (colour pickers, icon picker, quick filters)
   ═══════════════════════════════════════════════════════════════════════ */

let openPopover = null;

export function popover(anchor, content, { width = 260, align = 'start' } = {}) {
  closePopover();
  const panel = el('div', {
    class: 'cx-menu',
    style: { width: `${width}px`, padding: '10px' },
    onMousedown: (e) => e.stopPropagation(),
  });
  if (typeof content === 'string') panel.innerHTML = content;
  else panel.appendChild(content);
  document.body.appendChild(panel);

  const rect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  let left = align === 'end' ? rect.right - panelRect.width : rect.left;
  left = clamp(left, 8, window.innerWidth - panelRect.width - 8);
  let top = rect.bottom + 6;
  if (top + panelRect.height > window.innerHeight - 8) top = Math.max(8, rect.top - panelRect.height - 6);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;

  openPopover = panel;
  setTimeout(() => {
    document.addEventListener('mousedown', onPopoverOutside, true);
    document.addEventListener('keydown', onPopoverKey, true);
  }, 0);
  return { close: closePopover, root: panel };
}

function onPopoverOutside(e) {
  if (openPopover && !openPopover.contains(e.target)) closePopover();
}

function onPopoverKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closePopover();
  }
}

export function closePopover() {
  if (openPopover) {
    openPopover.remove();
    openPopover = null;
  }
  document.removeEventListener('mousedown', onPopoverOutside, true);
  document.removeEventListener('keydown', onPopoverKey, true);
}

/* ══════════════════════════════════════════════════════════════════════════
   Form builders
   ═══════════════════════════════════════════════════════════════════════ */

/** Labelled control wrapper. */
export function field(label, control, hint) {
  return el('div', { class: 'cx-field' }, [
    label ? el('label', { class: 'cx-label', text: label }) : null,
    control,
    hint ? el('div', { class: 'cx-hint', text: hint }) : null,
  ]);
}

export function textInput({ value = '', placeholder = '', type = 'text', onInput, onChange, mini = false, ...rest }) {
  const input = el('input', {
    class: 'cx-input' + (mini ? ' mini' : ''),
    type,
    placeholder,
    ...rest,
  });
  input.value = value ?? '';
  if (onInput) input.addEventListener('input', () => onInput(input.value, input));
  if (onChange) input.addEventListener('change', () => onChange(input.value, input));
  return input;
}

export function numberInput({ value = 0, min, max, step = 1, onChange, mini = false }) {
  const input = el('input', { class: 'cx-input' + (mini ? ' mini' : ''), type: 'number', min, max, step });
  input.value = value;
  if (onChange) input.addEventListener('change', () => onChange(Number(input.value), input));
  return input;
}

export function selectInput({ value, options, onChange, mini = false, placeholder }) {
  const select = el('select', { class: 'cx-select' + (mini ? ' mini' : '') });
  if (placeholder) select.appendChild(el('option', { value: '', text: placeholder }));
  for (const opt of options) {
    const { value: v, label } = typeof opt === 'string' ? { value: opt, label: opt } : opt;
    select.appendChild(el('option', { value: v, text: label }));
  }
  select.value = value ?? '';
  if (onChange) select.addEventListener('change', () => onChange(select.value, select));
  return select;
}

export function colorInput({ value = '#5b93f5', onChange }) {
  const input = el('input', { class: 'cx-color', type: 'color', value: value || '#5b93f5' });
  if (onChange) input.addEventListener('input', () => onChange(input.value));
  return input;
}

export function checkbox({ label, checked = false, onChange }) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked;
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'cx-check' }, [input, el('span', { text: label })]);
}

export function toggle({ label, checked = false, onChange }) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked;
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'cx-switch' }, [input, el('span', { text: label })]);
}

export function rangeInput({ value = 0, min = 0, max = 100, step = 1, onInput, onChange }) {
  const input = el('input', { class: 'cx-range', type: 'range', min, max, step });
  input.value = value;
  if (onInput) input.addEventListener('input', () => onInput(Number(input.value)));
  if (onChange) input.addEventListener('change', () => onChange(Number(input.value)));
  return input;
}

/** Segmented button row. `options` = [{value, label, icon, title}] */
export function segmented({ value, options, onChange, stretch = false }) {
  const wrap = el('div', { class: 'cx-seg' + (stretch ? ' stretch' : ''), role: 'group' });
  for (const opt of options) {
    const button = el('button', {
      class: opt.value === value ? 'active' : '',
      title: opt.title || opt.label,
      'aria-pressed': String(opt.value === value),
      onClick: () => {
        for (const child of wrap.children) child.classList.remove('active');
        button.classList.add('active');
        onChange(opt.value);
      },
    }, [opt.icon ? el('span', { html: icon(opt.icon, { size: 13 }), style: { display: 'flex' } }) : null, opt.label ? el('span', { text: opt.label }) : null]);
    wrap.appendChild(button);
  }
  return wrap;
}

/** Collapsible section for the inspector and dock panes. */
export function section(title, children, { collapsed = false, actions = null, id = null } = {}) {
  const body = el('div', { class: 'cx-section-body' }, [].concat(children).filter(Boolean));
  const wrap = el('div', { class: 'cx-section' + (collapsed ? ' collapsed' : ''), dataset: id ? { section: id } : {} });
  const head = el('button', {
    class: 'cx-section-head',
    type: 'button',
    'aria-expanded': String(!collapsed),
    onClick: (e) => {
      if (e.target.closest('[data-section-action]')) return;
      wrap.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!wrap.classList.contains('collapsed')));
    },
  }, [
    el('span', { class: 'sec-caret', html: icon('chevron-down', { size: 12 }), style: { display: 'flex' } }),
    el('span', { class: 'sec-title', text: title }),
    actions,
  ]);
  wrap.append(head, body);
  return wrap;
}

/** Empty-state block. */
export function emptyState({ iconName = 'inbox', title, message, action }) {
  return el('div', { class: 'cx-empty' }, [
    hasIcon(iconName) ? el('div', { class: 'ce-icon', html: icon(iconName, { size: 26 }) }) : null,
    title ? el('div', { class: 'ce-title', text: title }) : null,
    message ? el('div', { class: 'ce-msg', text: message }) : null,
    action ? el('button', { class: 'cx-btn mini', text: action.label, onClick: action.onClick }) : null,
  ]);
}

/** Status/tone badge. */
export function badge(label, tone = 'neutral', { dot = true } = {}) {
  return el('span', { class: `cx-badge ${tone}` + (dot ? '' : ' nodot'), text: label });
}

/** KPI chip — the shared stat vocabulary. */
export function chipStat(label, value, tone = 'muted') {
  return el('span', { class: `cx-chipstat ${tone}` }, [
    el('span', { class: 'cs-label', text: label }),
    el('span', { class: 'cs-value', text: String(value) }),
  ]);
}

/* ── Icon picker ───────────────────────────────────────────────────────── */

/**
 * Searchable icon grid. Calls `onPick(name)` and returns the panel element,
 * ready to drop into a popover or modal.
 */
export function iconPicker({ value, onPick }) {
  const search = el('input', { class: 'cx-input mini', type: 'search', placeholder: 'Search icons…' });
  const grid = el('div', { class: 'cx-iconpick' });

  function render(query) {
    clear(grid);
    const names = searchIcons(query);
    if (!names.length) {
      grid.appendChild(el('div', { class: 'cx-hint', style: { gridColumn: '1 / -1', textAlign: 'center', padding: '12px' }, text: 'No icons match that search.' }));
      return;
    }
    for (const name of names.slice(0, 240)) {
      grid.appendChild(
        el('button', {
          class: name === value ? 'active' : '',
          title: name,
          'aria-label': name,
          html: icon(name, { size: 16 }),
          onClick: () => onPick(name),
        })
      );
    }
  }

  search.addEventListener('input', () => render(search.value));
  render('');

  return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
    search,
    grid,
    el('button', { class: 'cx-btn mini', text: 'No icon', onClick: () => onPick('') }),
  ]);
}

/* ── Colour swatches ───────────────────────────────────────────────────── */

/** The shared palette offered wherever a colour is chosen. */
export const PALETTE = [
  '#e60012', '#f97316', '#e0900b', '#eab308', '#16a571', '#0d9488', '#0ea5e9', '#3a76e8', '#6366f1', '#9333d9',
  '#f2555b', '#fb923c', '#fbbf24', '#facc15', '#4ade80', '#2dd4bf', '#38bdf8', '#60a5fa', '#818cf8', '#c084fc',
  '#7f1d1d', '#7c2d12', '#78350f', '#713f12', '#14532d', '#134e4a', '#0c4a6e', '#1e3a8a', '#312e81', '#4c1d95',
  '#ffffff', '#e5e7eb', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#111827', '#0b0f1a', '#000000',
];

export function swatchGrid({ value, onPick, colors = PALETTE }) {
  const grid = el('div', { class: 'cx-swatches' });
  for (const color of colors) {
    grid.appendChild(
      el('button', {
        class: 'cx-swatch' + (color.toLowerCase() === String(value).toLowerCase() ? ' active' : ''),
        style: { background: color },
        title: color,
        'aria-label': color,
        onClick: () => onPick(color),
      })
    );
  }
  return grid;
}

/** Colour control: swatch input plus the shared palette in a popover. */
export function colorControl({ value, onChange, allowInherit = false }) {
  const swatch = el('input', { class: 'cx-color', type: 'color', value: value || '#5b93f5' });
  swatch.addEventListener('input', () => onChange(swatch.value));

  const more = el('button', {
    class: 'cx-btn mini icon',
    'aria-label': 'Colour palette',
    html: icon('palette', { size: 13 }),
  });
  more.addEventListener('click', () => {
    popover(more, el('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, [
      el('div', { class: 'cx-label', text: 'Palette' }),
      swatchGrid({ value, onPick: (c) => { swatch.value = c; onChange(c); closePopover(); } }),
      allowInherit
        ? el('button', { class: 'cx-btn mini', text: 'Use default', onClick: () => { onChange(''); closePopover(); } })
        : null,
    ]), { width: 268 });
  });

  return el('div', { class: 'cx-inline' }, [swatch, more]);
}

/* ── Misc ──────────────────────────────────────────────────────────────── */

/** Skeleton placeholder rows. */
export function skeleton(rows = 3) {
  return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', padding: '10px' } },
    Array.from({ length: rows }, (_, i) => el('div', { class: 'cx-skel', style: { width: `${100 - i * 12}%` } })));
}

/** Progress bar with an optional accent colour. */
export function progressBar(percent, color) {
  return el('div', { class: 'cx-progress' }, [
    el('span', { style: { width: `${clamp(percent, 0, 100)}%`, background: color || 'var(--good)' } }),
  ]);
}

/** Render a tag chip. */
export function tagChip(label, color) {
  return el('span', { class: 'cx-tag', style: color ? { color, background: 'transparent', boxShadow: `inset 0 0 0 1px ${color}55` } : {} }, [
    el('span', { text: label }),
  ]);
}

/** Unique DOM id helper for label/control pairs. */
export function domId(prefix = 'f') {
  return uid(prefix).replace(/[^\w-]/g, '');
}
