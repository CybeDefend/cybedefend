import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The « Getting started » checklist per edition: « Chat with Cybe » and
 * « Auto-fix a vulnerability » are closed features, so the Community
 * Edition does not list them. The hook reads `EDITION` once at load, so each
 * case re-imports it.
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
  user: { onboardingProgress: [], onboardingPersona: 'unspecified', onboardingUsage: null, myOrganizations: [{ id: 'org-1' }] },
};
vi.mock('react-redux', () => ({
  useSelector: (fn: (s: unknown) => unknown) => fn(state),
  useDispatch: () => vi.fn(),
  useStore: () => ({ getState: () => state }),
}));
vi.mock('../services/userService', () => ({ completeOnboardingStep: vi.fn().mockResolvedValue(undefined) }));

const stepsIn = async (edition: string) => {
  ed.edition = edition;
  vi.resetModules();
  const { useOnboardingProgress } = await import('./useOnboardingProgress');
  const { result } = renderHook(() => useOnboardingProgress());
  return {
    ids: result.current.steps.map((s) => s.id),
    total: result.current.totalCount,
    scanLabel: result.current.steps.find((s) => s.id === 'first_scan_completed')?.labelKey,
  };
};

describe('useOnboardingProgress per edition', () => {
  it('the Community Edition lists neither the Cybe chat nor the autofix step', async () => {
    const { ids, total } = await stepsIn('community');
    expect(ids).not.toContain('cybe_chat_used');
    expect(ids).not.toContain('first_autofix');
    expect(ids).toContain('first_scan_completed');
    expect(total).toBe(8);
  });

  it('the Community Edition names the first scan step for an import', async () => {
    const { scanLabel } = await stepsIn('community');
    expect(scanLabel).toBe('components.cybeGuide.steps.firstImportCompleted');
  });

  it('the cloud names the first scan step for a scan', async () => {
    const { scanLabel } = await stepsIn('cloud');
    expect(scanLabel).toBe('components.cybeGuide.steps.firstScanCompleted');
  });

  it('the cloud lists every step', async () => {
    const { ids, total } = await stepsIn('cloud');
    expect(ids).toContain('cybe_chat_used');
    expect(ids).toContain('first_autofix');
    expect(total).toBe(10);
  });
});
