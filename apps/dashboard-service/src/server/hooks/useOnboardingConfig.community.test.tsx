import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The guided tour's project steps per edition. In the cloud the AppSec home
 * is the project list; in the Community Edition the home is « Get started »
 * and the list is `/appsec/projects`, where AnalysisTable mounts the steps
 * « projects » and « createProject » (its « New project » button). On `/appsec`
 * the last step had nothing to point at. The step list is built at load, so
 * each case re-imports the hook.
 */
const ed = vi.hoisted(() => ({ edition: 'community' as string }));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return ed.edition;
  },
}));
const state = {
  organization: { selectedOrganization: { id: 'org-1', subscription: { plan: 'enterprise' } } },
  user: { onboardingPersona: 'unspecified', onboardingUsage: null },
};
vi.mock('react-redux', () => ({
  useSelector: (fn: (s: unknown) => unknown) => fn(state),
}));
vi.mock('react-rebac', () => ({
  useRebac: () => ({ userEntities: [{ id: 'org-1', type: 'organization' }] }),
  useAuthorization: () => true,
}));
vi.mock('@/server/hooks/useDisabledFeatures', () => ({
  useDisabledFeatures: () => new Set<string>(),
}));

const pathsIn = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  const { useOnboardingConfig } = await import('./useOnboardingConfig');
  const { result } = renderHook(() => useOnboardingConfig());
  const pathOf = (id: string) => result.current.steps.find((s) => s.id === id)?.path;
  return { projects: pathOf('projects'), createProject: pathOf('createProject') };
};

describe('useOnboardingConfig project steps per edition', () => {
  it('the Community Edition shows them on the project list', async () => {
    expect(await pathsIn('community')).toEqual({
      projects: '/appsec/projects',
      createProject: '/appsec/projects',
    });
  });

  it('the cloud shows them on the AppSec home, which is the list', async () => {
    expect(await pathsIn('cloud')).toEqual({ projects: '/appsec', createProject: '/appsec' });
  });
});
