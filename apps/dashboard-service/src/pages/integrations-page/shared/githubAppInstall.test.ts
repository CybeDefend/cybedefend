import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ createState: vi.fn() }));

vi.mock('@/server/services/integrations/githubIntegrationsService', () => ({
  createGithubInstallState: (...args: unknown[]) => h.createState(...args),
}));

import { githubAppInstallUrl, openGithubAppInstall } from './githubAppInstall';

const STATE = 'b'.repeat(64);
const APP = 'https://github.com/apps/acme/installations/new';

describe('githubAppInstallUrl', () => {
  it('adds the state as a query parameter', () => {
    expect(githubAppInstallUrl(APP, STATE)).toBe(`${APP}?state=${STATE}`);
  });

  it('keeps the query parameters the URL already has', () => {
    const url = new URL(githubAppInstallUrl(`${APP}?suggested_target_id=1`, STATE));
    expect(url.searchParams.get('suggested_target_id')).toBe('1');
    expect(url.searchParams.get('state')).toBe(STATE);
  });

  it('replaces a state the configured URL already carries', () => {
    const url = new URL(githubAppInstallUrl(`${APP}?state=old`, STATE));
    expect(url.searchParams.getAll('state')).toEqual([STATE]);
  });
});

describe('openGithubAppInstall', () => {
  let tab: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> };
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    h.createState.mockReset();
    tab = { opener: window, location: { href: '' }, close: vi.fn() };
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => tab as unknown as Window);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('opens the tab at once, then sends it to the GitHub URL carrying a state issued for the organization', async () => {
    h.createState.mockResolvedValue(STATE);

    await openGithubAppInstall('org-1', APP);

    expect(h.createState).toHaveBeenCalledWith('org-1');
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe(`${APP}?state=${STATE}`);
  });

  it('opens the URL with the state when the browser gives no tab handle', async () => {
    h.createState.mockResolvedValue(STATE);
    openSpy.mockImplementation(() => null);

    await openGithubAppInstall('org-1', APP);

    expect(openSpy).toHaveBeenLastCalledWith(`${APP}?state=${STATE}`, '_blank', 'noopener,noreferrer');
  });

  it('closes the tab and rethrows when no state can be issued', async () => {
    h.createState.mockRejectedValue(new Error('403'));

    await expect(openGithubAppInstall('org-1', APP)).rejects.toThrow('403');
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe('');
  });
});
