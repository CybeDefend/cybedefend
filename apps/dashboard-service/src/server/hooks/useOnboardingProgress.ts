import { useCallback, useEffect, useMemo } from 'react';
import { useSelector, useDispatch, useStore } from 'react-redux';
import { RootState } from '../store';
import { addOnboardingStep } from '../store/userSlice';
import { completeOnboardingStep } from '../services/userService';
import { EDITION } from '@/edition/edition';

export const ONBOARDING_STEPS = [
  'org_created',
  'first_project',
  'integration_linked',
  'first_scan_completed',
  'first_vuln_viewed',
  'cybe_chat_used',
  'first_autofix',
  'team_created',
  'report_generated',
  'policy_created',
] as const;

export type OnboardingStepId = typeof ONBOARDING_STEPS[number];

export interface OnboardingStepInfo {
  id: OnboardingStepId;
  labelKey: string;
  completed: boolean;
}

const STEP_LABELS: Record<OnboardingStepId, string> = {
  org_created: 'components.cybeGuide.steps.orgCreated',
  first_project: 'components.cybeGuide.steps.firstProject',
  integration_linked: 'components.cybeGuide.steps.integrationLinked',
  first_scan_completed: 'components.cybeGuide.steps.firstScanCompleted',
  first_vuln_viewed: 'components.cybeGuide.steps.firstVulnViewed',
  cybe_chat_used: 'components.cybeGuide.steps.cybeChatUsed',
  first_autofix: 'components.cybeGuide.steps.firstAutofix',
  team_created: 'components.cybeGuide.steps.teamCreated',
  report_generated: 'components.cybeGuide.steps.reportGenerated',
  policy_created: 'components.cybeGuide.steps.policyCreated',
};

/**
 * Persona/usage-based visibility rules (verbatim allowlist values:
 * persona ∈ solo_dev | tech_lead | security_pro | unspecified;
 * usage ∈ vibecoding | team_security | compliance | unspecified, now
 * MULTI-select — `usage` is `string[] | null`).
 *
 * Usage rules are INCLUSIVE / union: a step required by any one of the
 * selected usages stays visible.
 *
 * - `team_created` is hidden for solo_dev (no team to create) — unaffected
 *   by usage.
 * - `report_generated` / `policy_created` are hidden for solo_dev, UNLESS
 *   the selected usages include compliance (a solo dev tracking compliance
 *   still needs reports/policies). A null/empty usage means "no compliance
 *   selected", so the steps stay hidden — same as the previous scalar
 *   default.
 * - `integration_linked` is hidden ONLY when vibecoding is the sole
 *   selected usage (`usages.length > 0 && usages.every(u => u ===
 *   'vibecoding')`). Picking team_security or compliance alongside (or
 *   instead of) vibecoding keeps it visible, since those personas do need a
 *   repo integration even if vibecoding was also picked.
 *
 * Anything not matched by a rule stays visible - so the checklist total is
 * always `ONBOARDING_STEPS` minus whatever these rules exclude, never a
 * hardcoded number.
 */
function isStepVisible(
  stepId: OnboardingStepId,
  persona: string | null,
  usage: string[] | null
): boolean {
  const usages = usage ?? [];
  // The Cybe chat and AutoFix are closed: no step for them in the
  // Community Edition.
  if (EDITION === 'community' && (stepId === 'cybe_chat_used' || stepId === 'first_autofix')) return false;
  if (stepId === 'team_created' && persona === 'solo_dev') return false;
  if (
    (stepId === 'report_generated' || stepId === 'policy_created') &&
    persona === 'solo_dev' &&
    !usages.includes('compliance')
  ) {
    return false;
  }
  if (
    stepId === 'integration_linked' &&
    usages.length > 0 &&
    usages.every((u) => u === 'vibecoding')
  ) {
    return false;
  }
  return true;
}

export function useOnboardingProgress() {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const progress = useSelector((state: RootState) => state.user.onboardingProgress) || [];
  const userProfile = useSelector((state: RootState) => state.user);
  const persona = useSelector((state: RootState) => state.user.onboardingPersona);
  const usage = useSelector((state: RootState) => state.user.onboardingUsage);
  const hasOrgs = userProfile.myOrganizations && userProfile.myOrganizations.length > 0;

  const isCompleted = useCallback(
    (stepId: OnboardingStepId) => progress.includes(stepId),
    [progress]
  );

  // Decided on the live store, not on the progress of this instance's
  // render: the shell mounts the checklist several times (header, sidebar,
  // page), and each instance saw the step still missing and sent its own
  // PATCH /user/profile. The first one marks the step; the others find it.
  const complete = useCallback(
    async (stepId: OnboardingStepId) => {
      const liveProgress = store.getState().user.onboardingProgress || [];
      if (liveProgress.includes(stepId)) return;
      dispatch(addOnboardingStep(stepId));
      try {
        await completeOnboardingStep(stepId);
      } catch (err) {
        console.error('Failed to persist onboarding step:', err);
      }
    },
    [dispatch, store]
  );

  // Auto-detect org_created if user already has organizations
  useEffect(() => {
    if (hasOrgs && !progress.includes('org_created')) {
      complete('org_created');
    }
  }, [hasOrgs, progress, complete]);

  // The filtered list IS the config this hook's counts derive from: adding,
  // removing or reordering entries in ONBOARDING_STEPS (or changing the
  // persona/usage rules above) changes totalCount/percentage automatically,
  // with zero edits required here.
  const visibleStepIds = useMemo(
    () => ONBOARDING_STEPS.filter((id) => isStepVisible(id, persona, usage)),
    [persona, usage]
  );

  const steps: OnboardingStepInfo[] = visibleStepIds.map((id) => ({
    id,
    // The Community Edition runs no scanner: its first « scan » is an import.
    labelKey:
      EDITION === 'community' && id === 'first_scan_completed'
        ? 'components.cybeGuide.steps.firstImportCompleted'
        : STEP_LABELS[id],
    completed: progress.includes(id),
  }));

  // Steps completed while a step was visible but later filtered out (e.g. a
  // persona change) are ignored: completedCount only ever sums over `steps`,
  // which already excludes them.
  const completedCount = steps.filter(s => s.completed).length;
  const totalCount = visibleStepIds.length;
  const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return { steps, isCompleted, complete, completedCount, totalCount, percentage };
}
