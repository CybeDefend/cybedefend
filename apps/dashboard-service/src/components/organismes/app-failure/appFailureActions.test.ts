import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ purge: vi.fn() }));
vi.mock('@/edition/auth/useAuth', () => ({ authClient: { forgetSession: h.purge } }));

import { escapeToSignIn, reloadPage } from './appFailureActions';

/**
 * The two ways out of every failure page (session, workspace, crash), in one
 * place so they cannot drift apart: the sign-in escape makes no network call,
 * because what it escapes may be Logto itself being unreachable, where
 * signOut() would hang too.
 */
describe('appFailureActions', () => {
  const realLocation = Object.getOwnPropertyDescriptor(window, 'location');
  const location = { assign: vi.fn(), reload: vi.fn() };

  beforeEach(() => {
    h.purge.mockReset();
    location.assign.mockReset();
    location.reload.mockReset();
    // jsdom's location cannot be spied on: an assignable stand-in.
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: location });
  });

  afterEach(() => {
    if (realLocation) Object.defineProperty(window, 'location', realLocation);
    localStorage.clear();
  });

  it('signs in again by clearing the stored session and the chosen organisation, then going to /login', () => {
    localStorage.setItem('selectedOrganization', JSON.stringify({ id: 'org-1' }));
    localStorage.setItem('theme', 'dark');

    escapeToSignIn();

    expect(h.purge).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('selectedOrganization')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(location.assign).toHaveBeenCalledWith('/login');
    expect(h.purge.mock.invocationCallOrder[0]).toBeLessThan(location.assign.mock.invocationCallOrder[0]);
  });

  it('tries again by reloading the page, and nothing else', () => {
    reloadPage();

    expect(location.reload).toHaveBeenCalledTimes(1);
    expect(location.assign).not.toHaveBeenCalled();
    expect(h.purge).not.toHaveBeenCalled();
  });
});
