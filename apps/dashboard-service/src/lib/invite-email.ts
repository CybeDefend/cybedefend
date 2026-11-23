/**
 * The invitation mail links to `/invite/<token>?…&email=<invited address>`.
 * The invitation page compares that address with the account the invitee is
 * signed in with and warns before they accept with the wrong one. The address
 * is personal data, so it rides the URL no further than this capture, which
 * wipes it from the address bar at once. `invite-email-capture.ts` runs it as
 * the first import of index.tsx, before an analytics tracker can record the
 * URL; it never reaches the localStorage-persisted `pendingInviteUrl` or the
 * Referer either. It is kept for this tab only — sessionStorage survives the
 * Logto round trip and dies with the tab — and bound to the token it came with.
 *
 * In the Community Edition that token alone accepts the invitation (a name and
 * a password, no e-mail), so it is never written: the address is bound to the
 * token's `shortDigest` instead. Its mail links to `/invite#token=<token>&email=…`
 * (the fragment, which no server receives): the address is captured from the
 * fragment the same way, and the whole fragment leaves the address bar here,
 * the token held in memory only (`invite-token.ts`).
 */
import { EDITION } from '@/edition/edition';
import { shortDigest } from '@/utils/shortDigest';
import { forgetInviteToken, inviteFragmentParams, takeInviteTokenFromHash } from './invite-token';

export const INVITE_EMAIL_PARAM = 'email';
export const INVITE_EMAIL_STORAGE_KEY = 'cybe_invite_email';

const INVITE_PATH_RE = /^\/invite\/([^/]+)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const MAX_EMAIL_LENGTH = 320;

/**
 * Read `?email` on the invitation page, keep it for its token, and wipe it
 * from the address bar — whatever it held. Elsewhere (`/sso?email=`) the
 * param is the page's own input and is left alone.
 */
export function captureInviteEmail(): void {
  if (typeof window === 'undefined') return;
  if (EDITION === 'community') {
    const fragment = inviteFragmentParams();
    if (fragment) {
      captureFragmentInviteEmail(fragment);
      return;
    }
  }
  const token = INVITE_PATH_RE.exec(window.location.pathname)?.[1];
  if (!token) return;
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get(INVITE_EMAIL_PARAM);
    if (raw === null) return;
    const email = normalisedEmail(raw);
    if (email) {
      try {
        const binding = EDITION === 'community' ? { tokenDigest: shortDigest(token) } : { token };
        window.sessionStorage.setItem(INVITE_EMAIL_STORAGE_KEY, JSON.stringify({ ...binding, email }));
      } catch {
        // Storage blocked: the page just shows no invited address and no warning.
      }
    }
    url.searchParams.delete(INVITE_EMAIL_PARAM);
    // Same entry, same state — this is a cosmetic rewrite, not a navigation.
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // No History API / opaque origin: nothing downstream depends on the wipe.
  }
}

/** An address as the mail carries it, or null when it is not one. */
function normalisedEmail(raw: string): string | null {
  // An address holds no space: one here is a `+` that a link rewriter decoded.
  const email = raw.trim().replace(/ /g, '+');
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email) ? email : null;
}

/** The Community fragment link: the address bound to the token's digest, then the fragment wiped. */
function captureFragmentInviteEmail(fragment: URLSearchParams): void {
  const raw = fragment.get(INVITE_EMAIL_PARAM);
  const token = takeInviteTokenFromHash();
  if (raw === null || !token) return;
  const email = normalisedEmail(raw);
  if (!email) return;
  try {
    window.sessionStorage.setItem(INVITE_EMAIL_STORAGE_KEY, JSON.stringify({ tokenDigest: shortDigest(token), email }));
  } catch {
    // Storage blocked: the page just shows no invited address and no warning.
  }
}

/** The address the invitation `token` was sent to, or null when unknown. */
export function readInviteEmail(token: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(INVITE_EMAIL_STORAGE_KEY) ?? 'null');
    if (typeof stored?.email !== 'string') return null;
    const bound = EDITION === 'community' ? stored.tokenDigest === shortDigest(token) : stored.token === token;
    return bound ? stored.email : null;
  } catch {
    return null;
  }
}

/** Forget the invited address, and a fragment link's token, once the invitation is settled. */
export function clearInviteEmail(): void {
  forgetInviteToken();
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(INVITE_EMAIL_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was stored either.
  }
}
