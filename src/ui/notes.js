/**
 * Rich notes editor.
 *
 * A contenteditable surface with a compact toolbar covering the formats the
 * brief asks for: headings, bold/italic/underline, bullet and numbered lists,
 * checklists, tables, links and inline images. Content is stored as sanitised
 * HTML on the object, which keeps it portable through JSON export and
 * renderable in the hover preview and PDF output.
 *
 * Everything written back to the document passes through `sanitiseHtml` —
 * notes can arrive from an imported file, and a plan should never be able to
 * execute script because someone pasted it into a note.
 *
 * Imports: util, icons, components.
 */

import { el, clear, debounce, stripHtml, readFileAsDataURL, pickFiles, bytes } from '../core/util.js';
import { icon } from './icons.js';
import { openModal, toast, popover, closePopover, promptDialog } from './components.js';

/* ══════════════════════════════════════════════════════════════════════════
   Sanitiser
   ═══════════════════════════════════════════════════════════════════════ */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'CODE', 'PRE',
  'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'IMG', 'INPUT', 'LABEL',
]);

const ALLOWED_ATTRS = {
  A: ['href', 'title', 'target', 'rel'],
  IMG: ['src', 'alt', 'width', 'height'],
  INPUT: ['type', 'checked', 'disabled'],
  TD: ['colspan', 'rowspan'],
  TH: ['colspan', 'rowspan'],
  SPAN: ['class'],
  LI: ['class'],
  DIV: ['class'],
  P: ['class'],
};

/**
 * Strip everything that is not on the allow-list. Runs over a detached
 * document so nothing in the markup can load, execute or observe anything.
 */
export function sanitiseHtml(html) {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const body = parsed.body;

  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        continue;
      }
      if (!ALLOWED_TAGS.has(child.tagName)) {
        // Keep the text, drop the wrapper — losing formatting beats losing
        // the user's words.
        const text = parsed.createTextNode(child.textContent || '');
        child.replaceWith(text);
        continue;
      }
      const allowed = ALLOWED_ATTRS[child.tagName] || [];
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        if (!allowed.includes(name)) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (name === 'href' || name === 'src') {
          const value = attr.value.trim().toLowerCase();
          const safe =
            value.startsWith('http://') ||
            value.startsWith('https://') ||
            value.startsWith('mailto:') ||
            value.startsWith('data:image/') ||
            value.startsWith('file:///') ||
            value.startsWith('#');
          if (!safe) child.removeAttribute(attr.name);
        }
      }
      if (child.tagName === 'A') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      if (child.tagName === 'INPUT' && child.getAttribute('type') !== 'checkbox') {
        child.remove();
        continue;
      }
      walk(child);
    }
  };

  walk(body);
  return body.innerHTML;
}

/** Plain-text preview of a note, for tooltips and search results. */
export function notePreview(html, max = 220) {
  const text = stripHtml(html);
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/* ══════════════════════════════════════════════════════════════════════════
   Editor
   ═══════════════════════════════════════════════════════════════════════ */

const TOOLBAR = [
  [
    { cmd: 'formatBlock', arg: 'h3', icon: 'type', title: 'Heading' },
    { cmd: 'bold', icon: 'type', title: 'Bold', label: 'B' },
    { cmd: 'italic', icon: 'type', title: 'Italic', label: 'I' },
    { cmd: 'underline', icon: 'type', title: 'Underline', label: 'U' },
    { cmd: 'strikeThrough', title: 'Strikethrough', label: 'S' },
  ],
  [
    { cmd: 'insertUnorderedList', icon: 'list', title: 'Bullet list' },
    { cmd: 'insertOrderedList', icon: 'checklist', title: 'Numbered list' },
    { custom: 'checklist', icon: 'check-circle', title: 'Checklist item' },
    { cmd: 'formatBlock', arg: 'blockquote', icon: 'comment', title: 'Quote' },
  ],
  [
    { custom: 'table', icon: 'table', title: 'Insert table' },
    { custom: 'link', icon: 'link', title: 'Insert link' },
    { custom: 'image', icon: 'image', title: 'Insert image' },
    { custom: 'rule', icon: 'minus', title: 'Horizontal rule' },
  ],
  [{ cmd: 'removeFormat', icon: 'eraser', title: 'Clear formatting', label: '✕' }],
];

/**
 * Build an editor surface.
 * @returns {{root:HTMLElement, getHtml:Function, setHtml:Function, focus:Function}}
 */
export function noteEditor({ value = '', onChange = null, minHeight = 220 } = {}) {
  const surface = el('div', {
    class: 'note-surface',
    contenteditable: 'true',
    role: 'textbox',
    'aria-multiline': 'true',
    style: { minHeight: `${minHeight}px` },
  });
  surface.innerHTML = sanitiseHtml(value);

  const emitChange = debounce(() => {
    if (onChange) onChange(getHtml());
  }, 260);

  const exec = (cmd, arg) => {
    surface.focus();
    document.execCommand(cmd, false, arg);
    emitChange();
  };

  const toolbar = el('div', { class: 'note-toolbar' });
  TOOLBAR.forEach((group, i) => {
    if (i > 0) toolbar.appendChild(el('div', { class: 'note-tb-sep' }));
    for (const item of group) {
      const button = el('button', {
        class: 'cx-btn icon mini ghost',
        type: 'button',
        title: item.title,
        'aria-label': item.title,
        html: item.label ? `<span style="font-weight:700">${item.label}</span>` : icon(item.icon, { size: 13 }),
        onMousedown: (e) => e.preventDefault(), // keep the selection alive
        onClick: () => {
          if (item.custom) runCustom(item.custom, surface, exec, emitChange);
          else exec(item.cmd, item.arg);
        },
      });
      toolbar.appendChild(button);
    }
  });

  surface.addEventListener('input', emitChange);

  // Paste as plain text unless the clipboard carries HTML we can sanitise.
  surface.addEventListener('paste', (e) => {
    const html = e.clipboardData?.getData('text/html');
    if (html) {
      e.preventDefault();
      document.execCommand('insertHTML', false, sanitiseHtml(html));
      emitChange();
    }
  });

  // Checkbox toggles inside the note.
  surface.addEventListener('click', (e) => {
    if (e.target.matches('input[type=checkbox]')) {
      // execCommand does not track this, so mirror the state into the markup.
      if (e.target.checked) e.target.setAttribute('checked', '');
      else e.target.removeAttribute('checked');
      emitChange();
    }
  });

  function getHtml() {
    return sanitiseHtml(surface.innerHTML);
  }

  function setHtml(html) {
    surface.innerHTML = sanitiseHtml(html);
  }

  const root = el('div', { class: 'note-editor' }, [toolbar, surface]);
  return { root, getHtml, setHtml, focus: () => surface.focus(), surface };
}

async function runCustom(kind, surface, exec, emitChange) {
  surface.focus();
  switch (kind) {
    case 'checklist':
      document.execCommand('insertHTML', false, '<div class="note-check"><input type="checkbox"> <span>To do</span></div>');
      emitChange();
      break;

    case 'rule':
      document.execCommand('insertHorizontalRule');
      emitChange();
      break;

    case 'link': {
      const selection = window.getSelection();
      const text = selection ? String(selection) : '';
      const url = await promptDialog({ title: 'Insert link', label: 'URL', value: 'https://', placeholder: 'https://…' });
      if (!url) return;
      surface.focus();
      if (text) document.execCommand('createLink', false, url);
      else document.execCommand('insertHTML', false, `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
      emitChange();
      break;
    }

    case 'table': {
      const size = await promptDialog({ title: 'Insert table', label: 'Columns × rows', value: '3x3', placeholder: '3x3' });
      if (!size) return;
      const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size.trim());
      const cols = Math.min(10, Math.max(1, match ? +match[1] : 3));
      const rows = Math.min(20, Math.max(1, match ? +match[2] : 3));
      let html = '<table><thead><tr>';
      for (let c = 0; c < cols; c++) html += `<th>Column ${c + 1}</th>`;
      html += '</tr></thead><tbody>';
      for (let r = 0; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) html += '<td>&nbsp;</td>';
        html += '</tr>';
      }
      html += '</tbody></table><p><br></p>';
      surface.focus();
      document.execCommand('insertHTML', false, html);
      emitChange();
      break;
    }

    case 'image': {
      const files = await pickFiles({ accept: 'image/*' });
      if (!files.length) return;
      const file = files[0];
      // Notes travel inside the document, so a huge inline image would bloat
      // every autosave. Point large files at the attachment store instead.
      if (file.size > 1_500_000) {
        toast({
          tone: 'warn',
          title: 'Image too large to inline',
          message: `${bytes(file.size)} — add it as an attachment instead so the project stays fast.`,
        });
        return;
      }
      const dataUrl = await readFileAsDataURL(file);
      surface.focus();
      document.execCommand('insertHTML', false, `<img src="${dataUrl}" alt="${file.name}" style="max-width:100%">`);
      emitChange();
      break;
    }

    default:
      break;
  }
}

/**
 * Open the full-screen note editor for an object.
 * `onSave(html)` is called when the user confirms.
 */
export function openNoteEditor({ title, value, onSave }) {
  const editor = noteEditor({ value, minHeight: 320 });
  let current = value;
  editor.root.addEventListener('input', () => {
    current = editor.getHtml();
  });

  openModal({
    title: `Notes — ${title}`,
    subtitle: 'Rich text, checklists, tables, links and inline images.',
    size: 'wide',
    body: editor.root,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save notes',
        kind: 'primary',
        onClick: () => onSave(editor.getHtml()),
      },
    ],
  });

  setTimeout(() => editor.focus(), 60);
}

/** Read-only render of a note, used in hover previews and print output. */
export function renderNote(html, { max = 0 } = {}) {
  const node = el('div', { class: 'note-render' });
  node.innerHTML = sanitiseHtml(html);
  if (max) node.style.maxHeight = `${max}px`;
  // Checkboxes are display-only outside the editor.
  node.querySelectorAll('input[type=checkbox]').forEach((box) => {
    box.setAttribute('disabled', '');
  });
  return node;
}
