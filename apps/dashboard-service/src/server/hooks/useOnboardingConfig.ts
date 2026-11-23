import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useAuthorization, useRebac } from 'react-rebac';
import { RootState } from '../store';
import { useEditionEntitlements } from '@/edition/entitlements';
import { selectProductStatus } from '../store/selectors';
import { appsecPath } from '@/utils/product';
import { appsecProjectListPath } from '@/utils/appsecProjectList';

/**
 * Onboarding step definition
 */
export interface OnboardingStepConfig {
  /** Unique identifier for this step */
  id: string;
  /** Path where this step is shown */
  path: string;
  /** Translation key prefix for title/subtitle */
  translationKey: string;
  /** Required roles to see this step - empty array means all roles */
  requiredRoles: string[];
  /** Minimum plan required - 'pro' means not shown on developer plan */
  requiredPlan?: 'pro' | 'enterprise';
  /** Feature that must be enabled for this step to appear (checked via featuresDisabled CSV) */
  requiredFeature?: string;
  /** Next path to navigate to after this step - calculated dynamically based on filtered steps */
  nextPath?: string;
}

/**
 * The guided tour is AppSec's: it starts and ends on the AppSec project list,
 * visits the AppSec pages at their `/appsec` URLs, and the settings pages
 * common to both spaces where they are. Never the root `/`, which only sends
 * the account to the home of its preferred space. The list is the AppSec home
 * in the cloud, and `/appsec/projects` in the Community Edition, whose home is
 * « Get started »: on it AnalysisTable mounts the steps « projects » and
 * « createProject » (the « New project » button).
 */
const APPSEC_PROJECT_LIST = appsecProjectListPath();

/**
 * All possible onboarding steps in order.
 * Steps are filtered by the user's role, subscription plan, enabled features,
 * AND the persona/usage answers collected at onboarding.
 *
 * Flow by role (Pro+), before the persona filter:
 * - Member/Developer: Projects (1 step — createProject needs manager+, see below)
 * - Manager: Projects → Org Settings → Teams → Integrations → Create project (5 steps)
 * - Admin/Creator: Projects → Reports → Overview → Org Settings → Teams → Integrations → Create project (7 steps)
 *
 * Persona/usage veto (applied on top, only removes steps):
 * - solo_dev: drops reports (unless usage=compliance), organizationSettings, teamsSettings
 * - usage=vibecoding: drops integrationsSettings
 * - createProject is never removed by persona (role filter still applies).
 *   unspecified persona = tech_lead behaviour.
 */
const ALL_ONBOARDING_STEPS: OnboardingStepConfig[] = [
  {
    id: 'projects',
    path: APPSEC_PROJECT_LIST,
    translationKey: 'components.analysisTable.onboarding',
    requiredRoles: [], // All roles
  },
  {
    id: 'reports',
    path: appsecPath('/reports'),
    translationKey: 'components.onboarding.reports',
    requiredRoles: ['creator', 'administrator'], // Admin only
    requiredPlan: 'pro', // Not available on Developer plan
  },
  {
    id: 'organizationOverview',
    path: appsecPath('/organization/overview'),
    translationKey: 'components.onboarding.organizationOverview',
    requiredRoles: ['creator', 'administrator'], // Admin only
  },
  {
    id: 'organizationSettings',
    path: '/organization/settings',
    translationKey: 'pages.settingsOrganization.onboarding',
    requiredRoles: ['creator', 'administrator', 'manager'], // Manager+ only
    requiredFeature: 'team_management',
  },
  {
    id: 'teamsSettings',
    path: '/organization/settings/teams',
    translationKey: 'pages.settingsTeams.onboarding',
    requiredRoles: ['creator', 'administrator', 'manager'], // Manager+ only
    requiredPlan: 'pro', // Not available on Developer plan
    requiredFeature: 'team_management',
  },
  {
    id: 'integrationsSettings',
    path: '/organization/settings/integrations',
    translationKey: 'pages.settingsIntegration.onboarding',
    requiredRoles: ['creator', 'administrator', 'manager'], // Manager+ only
  },
  {
    // Step 7 — always the last step. Lives on the project list,
    // where AnalysisTable spotlights the "New project" button; Finish opens the
    // CreateProjectModal.
    // Manager+ only: the anchor (New-project button) renders only when
    // canCreateProject (creator/administrator/manager). Giving this step to a
    // member would strand their tour with no mounted step and no Finish button.
    // Never persona-filtered out.
    id: 'createProject',
    path: APPSEC_PROJECT_LIST,
    translationKey: 'components.analysisTable.onboarding.createProject',
    requiredRoles: ['creator', 'administrator', 'manager'], // Mirrors canCreateProject
  },
];

const NO_STEPS: OnboardingStepConfig[] = [];

/**
 * Return type for useOnboardingConfig hook
 */
export interface OnboardingConfigResult {
  /** All steps available for current user's role */
  steps: OnboardingStepConfig[];
  /** Total number of steps for this user */
  totalSteps: number;
  /** Get step number (1-based) for a given step ID */
  getStepNumber: (stepId: string) => number;
  /** Get the next path after a given step ID */
  getNextPath: (stepId: string) => string | undefined;
  /** Check if a step is the last step */
  isLastStep: (stepId: string) => boolean;
  /** Check if user has access to a specific step */
  hasAccessToStep: (stepId: string) => boolean;
  /** Whether the config is ready (entities loaded) */
  isReady: boolean;
}

/**
 * Hook to get onboarding configuration based on user's role
 * Filters steps and calculates proper step numbers dynamically
 */
export function useOnboardingConfig(): OnboardingConfigResult {
  const { userEntities } = useRebac();
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );

  // Persona/usage answers. null = not answered yet → treated as
  // "unspecified" (= tech_lead behaviour, no steps removed).
  const onboardingPersona = useSelector(
    (state: RootState) => state.user?.onboardingPersona
  );
  const onboardingUsage = useSelector(
    (state: RootState) => state.user?.onboardingUsage
  );

  const areUserEntitiesLoaded = userEntities && userEntities.length > 0;

  const { disabledFeatures, planIncludes } = useEditionEntitlements();

  // Check various role levels
  const isAdmin = useAuthorization(
    selectedOrganization?.id ?? '',
    'organization',
    ['creator', 'administrator']
  );

  const isManager = useAuthorization(
    selectedOrganization?.id ?? '',
    'organization',
    ['creator', 'administrator', 'manager']
  );

  // The tour is AppSec's: none for an organisation whose AppSec is known not
  // to be active. Unknown products (billing unavailable) keep the tour.
  const appsecStatus = useSelector((state: RootState) => selectProductStatus('appsec')(state));
  const appsecInactive = appsecStatus === 'inactive' || appsecStatus === 'deactivated';

  // Filter steps based on user's role and subscription plan
  const steps = useMemo(() => {
    if (appsecInactive) return NO_STEPS;
    if (!selectedOrganization?.id || !areUserEntitiesLoaded) {
      // Return all steps initially, will be filtered once loaded
      return ALL_ONBOARDING_STEPS;
    }

    return ALL_ONBOARDING_STEPS.filter((step) => {
      // Persona/usage adaptive filter, applied on top of the
      // role/plan/feature filters. A veto: the step is shown only if it passes
      // every filter. `onboardingUsage` is now multi-valued (string[] | null),
      // so the checks are inclusive: `compliance` (if selected among others)
      // forces the reports step back on; `vibecoding` drops integrations only
      // when it is the ONLY expectation the user picked.
      const usages: string[] = Array.isArray(onboardingUsage) ? onboardingUsage : [];
      if (onboardingPersona === 'solo_dev') {
        if (step.id === 'reports' && !usages.includes('compliance')) return false;
        if (step.id === 'organizationSettings') return false;
        if (step.id === 'teamsSettings') return false;
      }
      if (
        step.id === 'integrationsSettings' &&
        usages.length > 0 &&
        usages.every((u) => u === 'vibecoding')
      ) {
        return false;
      }

      // Filter by feature: skip steps whose required feature is disabled
      if (step.requiredFeature && disabledFeatures.has(step.requiredFeature)) return false;

      // Filter by plan: skip steps that require Pro when on Developer plan
      if (step.requiredPlan && !planIncludes(step.requiredPlan)) return false;

      // If no required roles, available to all
      if (step.requiredRoles.length === 0) return true;

      // Check if user has any of the required roles
      const requiresAdmin = step.requiredRoles.some(r => 
        ['creator', 'administrator'].includes(r)
      );
      const requiresManager = step.requiredRoles.some(r => 
        ['creator', 'administrator', 'manager'].includes(r)
      );

      // If step requires admin roles only
      if (requiresAdmin && !step.requiredRoles.includes('manager')) {
        return isAdmin;
      }

      // If step requires manager+ roles
      if (requiresManager) {
        return isManager;
      }

      return true;
    });
  }, [appsecInactive, selectedOrganization?.id, areUserEntitiesLoaded, isAdmin, isManager, planIncludes, disabledFeatures, onboardingPersona, onboardingUsage]);

  const totalSteps = steps.length;

  const getStepNumber = (stepId: string): number => {
    const index = steps.findIndex((s) => s.id === stepId);
    return index === -1 ? 1 : index + 1;
  };

  const getNextPath = (stepId: string): string | undefined => {
    const currentIndex = steps.findIndex((s) => s.id === stepId);
    if (currentIndex === -1 || currentIndex >= steps.length - 1) {
      return undefined; // Last step or not found
    }
    const nextStep = steps[currentIndex + 1];
    return nextStep.path;
  };

  const isLastStep = (stepId: string): boolean => {
    const index = steps.findIndex((s) => s.id === stepId);
    return index === steps.length - 1;
  };

  const hasAccessToStep = (stepId: string): boolean => {
    return steps.some((s) => s.id === stepId);
  };

  return {
    steps,
    totalSteps,
    getStepNumber,
    getNextPath,
    isLastStep,
    hasAccessToStep,
    isReady: Boolean(areUserEntitiesLoaded && selectedOrganization?.id),
  };
}

export default useOnboardingConfig;
