import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// These cases describe the cloud's behaviour; the Community Edition's is pinned
// by useOnboardingProgress.community.test.tsx.
vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  EDITION: 'cloud',
}));

// --- Mocks ---

let mockState: Record<string, any> = {};
const mockDispatch = vi.fn();

vi.mock('react-redux', () => ({
  useSelector: (fn: (state: any) => any) => fn(mockState),
  useDispatch: () => mockDispatch,
  useStore: () => ({ getState: () => mockState }),
}));

vi.mock('../services/userService', () => ({
  completeOnboardingStep: vi.fn().mockResolvedValue(undefined),
}));

import { useOnboardingProgress, ONBOARDING_STEPS } from './useOnboardingProgress';

/**
 * Builds the redux-shaped state the hook reads from.
 * `progress` = onboarding steps already completed (persisted checklist state).
 * `persona`/`usage` = the two profiling answers (verbatim allowlist values).
 * `usage` is now multi-valued (string[] | null), consistent with the backend
 * CSV-string persistence parsed upstream by userSlice.
 */
function buildState(opts: {
  progress?: string[];
  persona?: string | null;
  usage?: string[] | null;
  hasOrgs?: boolean;
} = {}) {
  const { progress = [], persona = null, usage = null, hasOrgs = true } = opts;
  return {
    user: {
      onboardingProgress: progress,
      onboardingPersona: persona,
      onboardingUsage: usage,
      myOrganizations: hasOrgs ? [{ id: 'org-1' }] : [],
    },
  };
}

describe('useOnboardingProgress', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
  });

  it('sanity-checks the full unfiltered checklist has 10 known steps', () => {
    // Guards the fixture math below (6 / 9 / 10) against silent drift.
    expect(ONBOARDING_STEPS.length).toBe(10);
  });

  it('solo_dev + [vibecoding] excludes team_created, report_generated, policy_created AND integration_linked -> total 6', () => {
    mockState = buildState({ persona: 'solo_dev', usage: ['vibecoding'] });
    const { result } = renderHook(() => useOnboardingProgress());

    expect(result.current.totalCount).toBe(6);
    const ids = result.current.steps.map((s) => s.id);
    expect(ids).not.toContain('team_created');
    expect(ids).not.toContain('report_generated');
    expect(ids).not.toContain('policy_created');
    expect(ids).not.toContain('integration_linked');
  });

  it('tech_lead (no exclusion rule matches) keeps all 10 steps', () => {
    mockState = buildState({ persona: 'tech_lead', usage: ['unspecified'] });
    const { result } = renderHook(() => useOnboardingProgress());

    expect(result.current.totalCount).toBe(10);
    expect(result.current.steps).toHaveLength(10);
  });

  it('solo_dev + [compliance] keeps report_generated/policy_created, only drops team_created -> total 9', () => {
    mockState = buildState({ persona: 'solo_dev', usage: ['compliance'] });
    const { result } = renderHook(() => useOnboardingProgress());

    expect(result.current.totalCount).toBe(9);
    const ids = result.current.steps.map((s) => s.id);
    expect(ids).not.toContain('team_created');
    expect(ids).toContain('report_generated');
    expect(ids).toContain('policy_created');
  });

  it('ignores a completed step that falls outside the filtered list when counting', () => {
    // solo_dev filters out 'team_created', but the persisted progress still
    // contains it (e.g. completed before the persona was set, or from a
    // stale snapshot). It must not inflate completedCount.
    mockState = buildState({
      persona: 'solo_dev',
      usage: ['compliance'],
      progress: ['org_created', 'first_project', 'team_created'],
    });
    const { result } = renderHook(() => useOnboardingProgress());

    expect(result.current.totalCount).toBe(9);
    expect(result.current.completedCount).toBe(2);
    expect(result.current.steps.some((s) => s.id === 'team_created')).toBe(false);
  });

  it('derives percentage as round(completedCount / totalCount * 100) purely from the filtered length', () => {
    mockState = buildState({
      persona: 'solo_dev',
      usage: ['vibecoding'], // total 6
      progress: ['org_created', 'first_project'], // 2/6
    });
    const { result } = renderHook(() => useOnboardingProgress());

    expect(result.current.totalCount).toBe(6);
    expect(result.current.completedCount).toBe(2);
    expect(result.current.percentage).toBe(Math.round((2 / 6) * 100));
  });

  it('marks the checklist fully completed (completedCount === totalCount) once every visible step is done, without any hardcoded count', () => {
    mockState = buildState({ persona: 'solo_dev', usage: ['vibecoding'] }); // total 6
    const visibleIds = ONBOARDING_STEPS.filter(
      (id) => !['team_created', 'report_generated', 'policy_created', 'integration_linked'].includes(id)
    );
    mockState = buildState({ persona: 'solo_dev', usage: ['vibecoding'], progress: [...visibleIds] });

    const { result } = renderHook(() => useOnboardingProgress());

    expect(result.current.totalCount).toBe(6);
    expect(result.current.completedCount).toBe(6);
    expect(result.current.completedCount === result.current.totalCount).toBe(true);
    expect(result.current.percentage).toBe(100);
  });

  it('changing persona/usage changes totalCount (N) without any change to the hook implementation', () => {
    mockState = buildState({ persona: 'solo_dev', usage: ['vibecoding'] });
    const solo = renderHook(() => useOnboardingProgress());
    expect(solo.result.current.totalCount).toBe(6);

    mockState = buildState({ persona: 'tech_lead', usage: ['unspecified'] });
    const lead = renderHook(() => useOnboardingProgress());
    expect(lead.result.current.totalCount).toBe(10);

    expect(solo.result.current.totalCount).not.toBe(lead.result.current.totalCount);
  });

  // ── Multi-value (union/inclusive) semantics ────────────────────────────
  describe('multi-value usage union semantics', () => {
    it('solo_dev + [vibecoding] hides report/policy AND integration_linked (vibecoding-only)', () => {
      mockState = buildState({ persona: 'solo_dev', usage: ['vibecoding'] });
      const { result } = renderHook(() => useOnboardingProgress());
      const ids = result.current.steps.map((s) => s.id);

      expect(ids).not.toContain('report_generated');
      expect(ids).not.toContain('policy_created');
      expect(ids).not.toContain('integration_linked');
      expect(result.current.totalCount).toBe(6);
    });

    it('solo_dev + [vibecoding, compliance] shows report/policy (compliance present) AND integration_linked (not vibecoding-only)', () => {
      mockState = buildState({ persona: 'solo_dev', usage: ['vibecoding', 'compliance'] });
      const { result } = renderHook(() => useOnboardingProgress());
      const ids = result.current.steps.map((s) => s.id);

      expect(ids).toContain('report_generated');
      expect(ids).toContain('policy_created');
      expect(ids).toContain('integration_linked');
      // Only team_created is dropped (solo_dev), so total is 9.
      expect(result.current.totalCount).toBe(9);
    });

    it('solo_dev + [team_security] shows integration_linked (not vibecoding-only) but still hides report/policy (no compliance)', () => {
      mockState = buildState({ persona: 'solo_dev', usage: ['team_security'] });
      const { result } = renderHook(() => useOnboardingProgress());
      const ids = result.current.steps.map((s) => s.id);

      expect(ids).toContain('integration_linked');
      expect(ids).not.toContain('report_generated');
      expect(ids).not.toContain('policy_created');
      // team_created + report_generated + policy_created dropped -> 7.
      expect(result.current.totalCount).toBe(7);
    });

    it('null usage falls back to current defaults (no usage-driven exclusions)', () => {
      mockState = buildState({ persona: 'solo_dev', usage: null });
      const { result } = renderHook(() => useOnboardingProgress());
      const ids = result.current.steps.map((s) => s.id);

      // solo_dev drops team_created (persona rule) and, with no 'compliance'
      // among the usages, report_generated/policy_created too. integration_linked
      // stays because usage is not vibecoding-only (null = no vibecoding).
      expect(ids).not.toContain('team_created');
      expect(ids).not.toContain('report_generated');
      expect(ids).not.toContain('policy_created');
      expect(ids).toContain('integration_linked');
      expect(result.current.totalCount).toBe(7);
    });
  });
});
