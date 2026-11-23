import React from 'react';
import { useFeatureAccess, FeatureName } from '../../../server/hooks/useFeatureAccess';
import { ACTIVE_EXTENSIONS } from '@/edition/active';

export interface FeatureGateProps {
  /** The feature key to check (must match billing service feature names). */
  feature: FeatureName;
  /**
   * Content rendered when the feature is **allowed** on the current plan.
   */
  children: React.ReactNode;
  /**
   * Optional content rendered when the feature is **blocked**.
   * When omitted the component renders nothing (`null`).
   */
  fallback?: React.ReactNode;
  /**
   * If `true` the component renders `null` (hides content) when the
   * API call is still in-flight. Otherwise children are shown optimistically.
   * @default false
   */
  hideWhileLoading?: boolean;
  /**
   * When `true` and the feature is blocked, the children are shown as a
   * blurred/dimmed preview and a compact upgrade banner is overlaid on top
   * instead of completely replacing the content.
   * @default false
   */
  preview?: boolean;
  /** Human-readable feature name shown in the upgrade banner (preview mode). */
  featureLabel?: string;
  /**
   * The plan key to unlock with (`team_v3`, `enterprise`), named in the
   * banner until billing answers (preview mode). Billing's `requiredPlan`
   * wins once it is known.
   */
  requiredPlan?: string;
}

/**
 * Declarative feature gate — renders children only when the feature is
 * available on the organisation's plan.
 *
 * @example
 * ```tsx
 * <FeatureGate feature="container_scanning" fallback={<UpgradeBanner />}>
 *   <ContainerScanButton />
 * </FeatureGate>
 * ```
 *
 * Preview mode — keep the page content visible as a dimmed preview and
 * overlay a compact upgrade banner at the top:
 * ```tsx
 * <FeatureGate feature="reports" preview featureLabel="Reports">
 *   <ReportsPage />
 * </FeatureGate>
 * ```
 */
export const FeatureGate: React.FC<FeatureGateProps> = ({
  feature,
  children,
  fallback = null,
  hideWhileLoading = false,
  preview = false,
  featureLabel,
  requiredPlan,
}) => {
  const { allowed, loading, requiredPlan: billingPlan } = useFeatureAccess(feature);
  // The edition's upgrade banner names the plan that unlocks the feature: the
  // one billing named when it knows it, the page's guess otherwise.
  const UpgradeBanner = ACTIVE_EXTENSIONS.billing?.UpgradeBanner ?? null;

  if (loading && hideWhileLoading) return null;
  if (loading) return <>{children}</>; // optimistic render

  if (allowed) return <>{children}</>;

  // Preview mode: show blurred content + compact upgrade banner overlay
  if (preview) {
    return (
      <div className="relative">
        {/* Compact upgrade banner pinned at the top */}
        {UpgradeBanner && <UpgradeBanner featureLabel={featureLabel} billingPlan={billingPlan} requiredPlan={requiredPlan} />}
        {/* Page content dimmed and non-interactive as a preview */}
        <div className="pointer-events-none select-none blur-[2px] opacity-40 overflow-hidden max-h-[70vh]">
          {children}
        </div>
      </div>
    );
  }

  return <>{fallback}</>;
};

export default FeatureGate;
