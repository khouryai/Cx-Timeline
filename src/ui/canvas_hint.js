/**
 * What to do when the canvas is empty.
 *
 * An empty plan and a plan whose every object is hidden looked exactly the
 * same: a ruler over a blank field. The first wants something added, the
 * second wants a filter cleared — and a date window set yesterday, or a filter
 * in hide mode, is precisely the thing somebody has forgotten they set. So
 * when nothing is laid out, the canvas says which case it is and offers the one
 * or two actions that end it. Every action is an existing command.
 *
 * It reads the layout the renderer just drew (`RENDER_DONE` carries how many
 * objects were packed) rather than working out visibility for itself, so it
 * cannot disagree with what is on screen.
 *
 * Imports: util, events, store, access, icons, commands, pane_util.
 */

import { el } from '../core/util.js';
import { on, EV } from '../core/events.js';
import * as store from '../core/store.js';
import { planLocked } from '../core/access.js';
import { icon } from './icons.js';
import * as cmd from './commands.js';
import { goToPane } from './pane_util.js';
import * as renderer from '../timeline/renderer.js';

let box = null;
let shown = '';

export function installCanvasHint(frame) {
  box = el('div', { class: 'canvas-hint', hidden: true, role: 'status' });
  frame.appendChild(box);
  on(EV.RENDER_DONE, ({ objects } = {}) => update(objects));
}

function action(label, iconName, run, primary = false) {
  return el('button', {
    class: `cx-btn mini${primary ? ' primary' : ''}`,
    type: 'button',
    html: icon(iconName, { size: 12 }) + `<span>${label}</span>`,
    onClick: run,
  });
}

function update(laidOut) {
  if (!box) return;
  const doc = store.getDoc();
  if (laidOut > 0 || !doc) {
    if (!box.hidden) { box.hidden = true; shown = ''; }
    return;
  }

  const locked = planLocked();
  const filters = store.getFilters();
  const hidden = doc.objects.filter((o) => o.hidden).length;
  const windowSet = Boolean(filters.from || filters.to);
  const filtering = store.hasActiveFilters();

  let key;
  let title;
  let message;
  const actions = [];

  if (!doc.objects.length) {
    key = `empty:${locked}:${doc.lanes.length}`;
    title = 'An empty plan';
    message = locked
      ? 'Nothing has been added to this plan yet, and this account may only read it.'
      : 'Add the first activity, or bring a plan in from a file or a P6 export.';
    if (!locked) {
      if (doc.lanes.length) actions.push(action('Add an activity', 'plus', () => cmd.createObject('activity'), true));
      else actions.push(action('Add a lane', 'layers', () => cmd.addLane(), true));
      actions.push(action('Import…', 'upload', () => goToPane('io')));
    }
  } else {
    key = `hidden:${windowSet}:${hidden}:${filtering}`;
    title = 'Nothing in view';
    const reasons = [];
    if (windowSet) reasons.push('a date range is set');
    if (filtering && !windowSet) reasons.push('the filter hides everything');
    if (hidden) reasons.push(`${hidden} object${hidden === 1 ? ' is' : 's are'} hidden`);
    message = reasons.length
      ? `The plan has ${doc.objects.length} object${doc.objects.length === 1 ? '' : 's'}, but ${reasons.join(' and ')}.`
      : `The plan has ${doc.objects.length} object${doc.objects.length === 1 ? '' : 's'}, none of them here.`;
    // Setting the range framed the view on it, so clearing it here frames the
    // plan again — otherwise the objects come back somewhere off screen.
    if (windowSet) actions.push(action('Clear the date range', 'calendar', () => { cmd.clearDateWindow(); cmd.fitAll(); }, true));
    if (filtering && !windowSet) {
      actions.push(action('Clear the filter', 'filter', () => {
        store.resetFilters();
        renderer.requestRender();
      }, !windowSet));
    }
    if (hidden) actions.push(action(`Show ${hidden} hidden`, 'eye', () => cmd.showAllHidden(), !filtering));
    actions.push(action('Fit the whole plan', 'maximize', () => cmd.fitAll()));
  }

  if (key === shown && !box.hidden) return;
  shown = key;
  box.replaceChildren(el('div', { class: 'canvas-hint-card' }, [
    el('div', { class: 'ch-title', text: title }),
    el('div', { class: 'ch-msg', text: message }),
    actions.length ? el('div', { class: 'ch-actions' }, actions) : null,
  ].filter(Boolean)));
  box.hidden = false;
}
