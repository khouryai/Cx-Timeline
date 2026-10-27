/**
 * The timeline's read-only state, said out loud.
 *
 * A plan in the shared folder is read-only while a colleague holds its pen
 * (`core/filestore.js`), and the store refuses edits then (`core/store.js`).
 * This is the part a person sees: the `body.read-only` styles, the bar across
 * the top saying who has it and when they last saved, and the button that asks
 * them for it. It explains the state; it does not create it.
 *
 * Imports: util, events, filestore, access, icons, components.
 */

import { el } from '../core/util.js';
import { on, EV } from '../core/events.js';
import * as filestore from '../core/filestore.js';
import * as access from '../core/access.js';
import { icon } from './icons.js';
import { toast } from './components.js';

export function installAccessMode() {
  const apply = () => {
    /* Two things can make a session read-only, and the interface says the
       same thing for both — only the reason differs, and only the reason
       decides whether there is anything the reader can do about it. A
       colleague holding the pen on the plan: wait, ask, or take it. And a
       session that may not edit the plan at all, which outranks the pen —
       there is nobody to ask, so the banner says why and offers nothing. */
    const locked = access.planLocked();
    const viewingFolder = !locked && filestore.isViewer();
    const readOnly = locked || viewingFolder;
    document.body.classList.toggle('read-only', readOnly);
    renderBanner(readOnly, viewingFolder ? filestore.state() : null);
  };

  on(EV.ACCESS_CHANGED, apply);
  on(EV.FILE_STATE, apply);

  // One notice per burst — a viewer holding an arrow key would otherwise
  // stack up a notification per repeat.
  let lastRefusal = 0;
  on(EV.EDIT_REFUSED, () => {
    const now = Date.now();
    if (now - lastRefusal < 4000) return;
    lastRefusal = now;
    toast({
      tone: 'warn',
      title: 'Read-only',
      message: access.planLocked()
        ? access.lockReason()
        : 'A colleague has the pen on this plan. Ask for it, or take over editing in Import / export.',
    });
  });

  apply();
}

/**
 * How long ago, in words somebody can act on.
 *
 * Deliberately coarse: the difference between eleven and twelve minutes
 * changes nobody's mind, and a ticking number in a banner reads as something
 * that needs watching.
 */
function since(ms) {
  if (!Number.isFinite(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

function renderBanner(readOnly, folder = null) {
  const existing = document.getElementById('cx-readonly-bar');
  if (!readOnly) {
    existing?.remove();
    return;
  }
  // The message can change while the bar is up — a colleague closing the plan
  // hands the pen over — so rebuild rather than bail out on an existing bar.
  existing?.remove();

  const holder = folder?.holder || '';
  /* What they are doing with it, not merely that they have it. "Dana has this
     plan open" is a fact; "Dana has this plan open, last saved 40 minutes ago"
     is a decision — wait, ask, or take it. */
  const idle = folder && Number.isFinite(folder.holderIdleMs)
    ? ` Last saved ${since(folder.holderIdleMs)}.`
    : '';
  const message = access.planLocked()
    ? `Read-only — ${access.lockReason()}`
    : holder
      ? `Read-only — ${holder} has this plan open.${idle}`
      : 'Read-only — this plan cannot be edited here.';

  const kids = [
    el('span', { class: 'ro-icon', html: icon('eye', { size: 13 }) }),
    el('span', { text: message }),
  ];

  /* The third option. Waiting had no end and taking over is destructive by
     design, so people took over by habit; asking costs the holder one toast
     and costs the asker nothing. Only while somebody else really has it. */
  if (holder && holder !== 'another window of yours') {
    kids.push(folder.asked
      ? el('span', { class: 'ro-asked', text: `Asked ${holder} — you will get it when they hand over.` })
      : el('button', {
        class: 'cx-btn mini',
        text: 'Ask for the pen',
        title: `Let ${holder} know you are waiting. They decide; nothing is taken.`,
        onClick: async (event) => {
          event.currentTarget.disabled = true;
          await filestore.requestPen();
        },
      }));
  }

  const bar = el('div', { id: 'cx-readonly-bar', class: 'cx-readonly-bar', role: 'status' }, kids);
  document.getElementById('main')?.prepend(bar);
}
