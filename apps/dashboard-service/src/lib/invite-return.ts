/**
 * Signing out from the invitation page, to switch to the invited account,
 * goes through Logto's end-session endpoint, which can only come back to
 * `/login`: the one post-logout redirect URI registered for the dashboard
 * (`logto-service/scripts/setup.ts`). This one-shot marker sends the invitee
 * from there back to the invitation, where the invited address is shown while
 * they pick an account. sessionStorage: it survives that round trip in this
 * tab and nothing else. Only an invitation path is ever stored or followed,
 * so the marker cannot turn into an open redirect.
 */
export const INVITE_RETURN_STORAGE_KEY = 'cybe_invite_return';

const INVITE_PATH_RE = /^\/invite\/[^/?#\s]+(\?[^#\s]*)?$/;

/** Remember the invitation to come back to after the sign-out. */
export function rememberInviteToReturnTo(path: string): void {
  if (typeof window === 'undefined' || !INVITE_PATH_RE.test(path)) return;
  try {
    window.sessionStorage.setItem(INVITE_RETURN_STORAGE_KEY, path);
  } catch {
    // Storage blocked: the invitee lands on /login, and the pending
    // invitation still brings them back once signed in.
  }
}

/** The invitation to return to, handed back once; null when there is none. */
export function takeInviteToReturnTo(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const path = window.sessionStorage.getItem(INVITE_RETURN_STORAGE_KEY);
    window.sessionStorage.removeItem(INVITE_RETURN_STORAGE_KEY);
    return path && INVITE_PATH_RE.test(path) ? path : null;
  } catch {
    return null;
  }
}

/** Drop the marker when the sign-out did not happen. */
export function forgetInviteToReturnTo(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(INVITE_RETURN_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was stored either.
  }
}
