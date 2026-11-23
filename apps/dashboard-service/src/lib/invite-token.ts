/**
 * The token of a Community invitation link, `/invite#token=<64 hex>`.
 *
 * In the Community Edition that token alone accepts the invitation (a name and
 * a password), so it rides the fragment, which no server receives: no nginx or
 * proxy access log, no `Referer`. It leaves the address bar at once, through
 * `history.replaceState` with the router's state kept (`invite-email-capture.ts`
 * does it at boot, before any other module; the invitation page again, for a
 * client-side navigation), and is then held in this module's memory only:
 * never in a storage, never in a URL, never logged. It survives a strict-mode
 * remount and the in-app sign-in round trip (`/login?returnTo=/invite`), and
 * dies with the page. `clearInviteEmail` forgets it once the invitation is
 * settled.
 *
 * The former `/invite/<token>` path (links already sent) goes through the same
 * holder (`takeInviteTokenFromPath`): the address bar is rewritten to `/invite`
 * at once, so the token leaves the history too (its first request already
 * reached the server; nothing in the browser can take that back).
 */

/** An invitation token, as global-management issues it: 32 random bytes in hex. */
const INVITATION_TOKEN = /^[0-9a-f]{64}$/;
/** The fragment form's path, one trailing slash allowed. */
export const INVITE_FRAGMENT_PATH_RE = /^\/invite\/?$/;

let remembered: string | null = null;

/** The fragment's parameters on `/invite`, or null on another path or without `token`. */
function fragmentParams(): URLSearchParams | null {
  if (typeof window === 'undefined') return null;
  const { pathname, hash } = window.location;
  if (!INVITE_FRAGMENT_PATH_RE.test(pathname) || !hash) return null;
  const params = new URLSearchParams(hash.slice(1));
  return params.has('token') ? params : null;
}

/**
 * On `/invite#token=…`: remember the token when well-formed (forget any earlier
 * one otherwise) and drop the whole fragment from the address bar, the history
 * entry's state kept. Returns the token held in memory, or null.
 */
export function takeInviteTokenFromHash(): string | null {
  const params = fragmentParams();
  if (params) {
    const token = params.get('token') ?? '';
    remembered = INVITATION_TOKEN.test(token) ? token : null;
    try {
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, '', `${pathname}${search}`);
    } catch {
      // No History API: nothing else depends on the wipe.
    }
  }
  return remembered;
}

const INVITE_PATH_TOKEN_RE = /^\/invite\/([^/]+)\/?$/;

/**
 * On the former `/invite/<token>` path, as the router reads it: remember the
 * token when well-formed (forget any earlier one otherwise), and, while the
 * address bar still shows that path, rewrite it to `/invite` (query and
 * fragment dropped: the Community page reads neither), the history entry's
 * state kept. On `/invite` itself, the token held in memory. Returns it, or null.
 */
export function takeInviteTokenFromPath(routerPathname: string): string | null {
  if (INVITE_FRAGMENT_PATH_RE.test(routerPathname)) return takeInviteTokenFromHash();
  const segment = INVITE_PATH_TOKEN_RE.exec(routerPathname)?.[1];
  if (segment === undefined) return null;
  remembered = INVITATION_TOKEN.test(segment) ? segment : null;
  if (typeof window !== 'undefined' && INVITE_PATH_TOKEN_RE.exec(window.location.pathname)?.[1] === segment) {
    try {
      window.history.replaceState(window.history.state, '', '/invite');
    } catch {
      // No History API: nothing else depends on the rewrite.
    }
  }
  return remembered;
}

/** The fragment's other parameters (`email`), read before the token is taken; null without a fragment link. */
export function inviteFragmentParams(): URLSearchParams | null {
  return fragmentParams();
}

/** The token a fragment link brought to this page, or null. */
export function rememberedInviteToken(): string | null {
  return remembered;
}

/** Forget the token: the invitation is settled, or left. */
export function forgetInviteToken(): void {
  remembered = null;
}

/**
 * The invitation page, in either link form: `/invite` (the fragment link) or
 * `/invite/<token>`. The guards that must not send an invitee away (onboarding,
 * a pending invitation) test with it, never with `startsWith('/invite/')` alone.
 */
export function isInvitationPagePath(pathname: string): boolean {
  return INVITE_FRAGMENT_PATH_RE.test(pathname) || pathname.startsWith('/invite/');
}
