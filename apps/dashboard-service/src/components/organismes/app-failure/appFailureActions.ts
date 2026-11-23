import { authClient } from '@/edition/auth/useAuth';

/**
 * The two ways out of every failure page (`AppFailurePage`: session,
 * workspace, crash), kept in one place so the pages cannot drift apart.
 */

/**
 * Sign in again, with no network call: the failure being escaped may be the
 * sign-in service itself being unreachable (Logto, in the cloud), which would
 * make `signOut()` hang too. Clears the stored session (the edition's client
 * forgets it) and the chosen organisation, then goes to /login.
 */
export function escapeToSignIn(): void {
  authClient.forgetSession?.();
  localStorage.removeItem('selectedOrganization');
  window.location.assign('/login');
}

/** Try again by reloading the page (the workspace and crash pages). */
export function reloadPage(): void {
  window.location.reload();
}
