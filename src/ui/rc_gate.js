/**
 * The resource calendar's front door: the states that are not the calendar.
 *
 * No backend in this build, the sign-in and sign-up form, and an account that is
 * not on the team. They lived in `ui/rc.js`, and they moved out when the phone
 * app arrived — that module imports every tab, and through them the folder and
 * the exporters, none of which a phone may carry. Two copies of a sign-in form
 * would be two answers to "how does somebody join", so there is one, and each
 * interface hands it the sentence that is true of where it is drawn.
 *
 * Nothing here is the control. Who may create an account is
 * `rc_enforce_invitation()` on `auth.users`, and who may see what is the
 * policies; this explains the state to the person looking at it.
 *
 * Imports: util, rc, icons, components.
 */

import { el } from '../core/util.js';
import * as rc from '../core/rc.js';
import { icon } from './icons.js';
import { textInput } from './components.js';

/**
 * No backend in this build.
 *
 * Not an error. A build can legitimately have the timeline and not the calendar
 * — that is what every build had until the calendar existed — so it says what is
 * missing and where it is configured rather than pretending something broke.
 */
export function notConfigured({
  message = 'The timeline works as it always has. The resource calendar needs a '
    + 'Supabase project, named in config.js as rcSupabaseUrl and '
    + 'rcSupabaseAnonKey — separate from the timeline, which stays in your folder.',
} = {}) {
  return el('div', { class: 'rc-state' }, [
    el('div', { class: 'rc-state-icon', html: icon('database', { size: 32 }) }),
    el('h2', { text: 'No resource calendar in this build' }),
    el('p', { text: message }),
  ]);
}

/**
 * Signed in to nothing yet.
 *
 * The form writes to the calendar's own client, which keeps its own session
 * under its own storage key. `onDone` runs once a session exists; `blurb` is
 * the line under the title when signing in, because what is true about the
 * rest of the application depends on which application this is.
 */
export function signInForm({
  onDone = () => {},
  blurb = 'The timeline needs no account and is already open behind this. Only the calendar does.',
} = {}) {
  /* An invitation link carries the address it was sent to, so somebody
     following one does not have to remember which of their addresses was
     invited — and lands on the right half of the form. */
  const invited = joiningAs();
  let joining = Boolean(invited);

  const email = textInput({ placeholder: 'you@example.com', type: 'email', value: invited || '' });
  const password = textInput({ placeholder: 'Password', type: 'password' });
  email.autocomplete = 'username';
  const error = el('div', { class: 'rc-error', hidden: true });
  const note = el('div', { class: 'rc-hint', hidden: true });
  const button = el('button', { class: 'cx-btn primary' });
  const swap = el('button', { class: 'cx-btn ghost mini' });
  const title = el('h2');
  const lead = el('p');

  const paint = () => {
    title.textContent = joining ? 'Create your account' : 'Sign in to the resource calendar';
    lead.textContent = joining
      ? 'Only an address an administrator has invited can create an account — the database '
        + 'refuses the rest, so there is nothing to guess at here.'
      : blurb;
    button.textContent = joining ? 'Create account' : 'Sign in';
    password.placeholder = joining ? 'Choose a password' : 'Password';
    password.autocomplete = joining ? 'new-password' : 'current-password';
    swap.textContent = joining ? 'I already have an account' : 'I was invited — create my account';
  };

  const submit = async () => {
    error.hidden = true;
    note.hidden = true;
    button.disabled = true;
    button.textContent = joining ? 'Creating…' : 'Signing in…';
    try {
      if (joining) {
        const { live } = await rc.signUp(email.value, password.value);
        if (!live) {
          // The project has email confirmation on, so the account exists but
          // the session does not. Saying so beats a form that looks stuck.
          note.textContent = 'Account created. Confirm your address from the email just sent, '
            + 'then sign in.';
          note.hidden = false;
          joining = false;
          paint();
          button.disabled = false;
          return;
        }
      } else {
        await rc.signIn(email.value, password.value);
      }
      onDone();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
      paint();
    }
  };

  button.addEventListener('click', submit);
  swap.addEventListener('click', () => { joining = !joining; error.hidden = true; paint(); });
  for (const field of [email, password]) {
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }
  paint();

  return el('div', { class: 'rc-state' }, [
    el('div', { class: 'rc-state-icon', html: icon('users', { size: 32 }) }),
    title,
    lead,
    el('div', { class: 'rc-signin' }, [email, password, error, note, button, swap]),
  ]);
}

/** The address an invitation link was sent to, from `#join=…`. */
export function joiningAs() {
  const match = /[#&?]join=([^&]+)/.exec(window.location.hash + window.location.search);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return '';
  }
}

/** An account that is not on the team. A real answer, not a failure. */
export function notOnTheTeam() {
  return el('div', { class: 'rc-state' }, [
    el('div', { class: 'rc-state-icon', html: icon('user', { size: 32 }) }),
    el('h2', { text: 'You are signed in, but not on this team' }),
    el('p', {
      text: 'An administrator adds people in Organisation. Until your account is '
        + 'linked to a team record, the database will not show you anything.',
    }),
    el('button', { class: 'cx-btn ghost', text: 'Sign out', onClick: () => rc.signOut() }),
  ]);
}
