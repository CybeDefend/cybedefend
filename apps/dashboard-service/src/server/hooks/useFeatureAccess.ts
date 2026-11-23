import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import { ACTIVE_EXTENSIONS } from '@/edition/active';

/** The feature names the core checks itself. */
export type CoreFeatureName =
  | 'policies'
  | 'reports'
  | 'issues'
  | 'container_scanning'
  | 'pat'
  | 'team_management';

/**
 * Any feature name: the core's own, or one a closed area checks (the SBOM,
 * per-scanner and AI-BOM gates live in the closed extension) — the union keeps
 * the core names autocompleted while accepting the closed ones as plain strings.
 */
export type FeatureName = CoreFeatureName | (string & {});

export interface FeatureAccessResult {
  /** true when the feature is available on the org's plan */
  allowed: boolean;
  /** true while the API call is in-flight (first load) */
  loading: boolean;
  /** Human-readable reason when blocked */
  reason: string;
  /** Minimum plan required to unlock (e.g. "pro") */
  requiredPlan: string;
}

// ─── Per-session in-memory cache ──────────────────────────────────
// Key = `${orgId}:${feature}`, value = API response.
const cache = new Map<string, { allowed: boolean; reason: string; requiredPlan: string }>();

/**
 * Hook that checks whether a feature is enabled for the current organization.
 *
 * The result is cached in memory so repeated renders do not trigger extra
 * API calls. If the org changes the cache is automatically invalidated by
 * virtue of the key including `orgId`.
 *
 * @example
 * ```tsx
 * const { allowed, loading } = useFeatureAccess('container_scanning');
 * if (!allowed && !loading) return <UpgradeBanner />;
 * ```
 */
export function useFeatureAccess(feature: FeatureName): FeatureAccessResult {
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization,
  );
  const orgId = selectedOrganization?.id;

  // Server-driven feature gating: the subscription carries a CSV of disabled
  // feature names set by the billing service. When the field is absent or empty
  // (legacy Developer plans) no feature is blocked client-side.
  const featuresDisabledCsv =
    selectedOrganization?.subscription?.featuresDisabled ?? '';

  const disabledFeatures = useMemo(
    () =>
      new Set(
        featuresDisabledCsv
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    [featuresDisabledCsv],
  );

  const clientSideBlocked = disabledFeatures.has(feature);

  // The edition's plan answers the feature checks; without one (the Community
  // Edition) every feature is available, at once.
  const checkFeatureAccess = ACTIVE_EXTENSIONS.billing?.checkFeatureAccess ?? null;

  const [result, setResult] = useState<FeatureAccessResult>(() => {
    if (!checkFeatureAccess) return { allowed: true, loading: false, reason: '', requiredPlan: '' };
    // If we already have a cached result, use it immediately.
    if (orgId) {
      const cached = cache.get(`${orgId}:${feature}`);
      if (cached) return { ...cached, loading: false };
    }
    // Client-side pre-check avoids a flash of "allowed" → "blocked".
    if (clientSideBlocked) {
      return {
        allowed: false,
        loading: false,
        reason: 'Feature not available on your current plan.',
        requiredPlan: 'team_v3',
      };
    }
    return { allowed: true, loading: true, reason: '', requiredPlan: '' };
  });

  const abortRef = useRef<AbortController | null>(null);

  const fetchAccess = useCallback(async () => {
    if (!orgId || !checkFeatureAccess) return;

    // Client-side fast-path for Developer plan — skip network entirely
    if (clientSideBlocked) {
      const entry = {
        allowed: false,
        reason: 'Feature not available on your current plan.',
        requiredPlan: 'team_v3',
      };
      cache.set(`${orgId}:${feature}`, entry);
      setResult({ ...entry, loading: false });
      return;
    }

    const key = `${orgId}:${feature}`;
    const cached = cache.get(key);
    if (cached) {
      setResult({ ...cached, loading: false });
      return;
    }

    try {
      const resp = await checkFeatureAccess(orgId, feature);
      const entry = {
        allowed: resp.allowed,
        reason: resp.reason ?? '',
        requiredPlan: resp.requiredPlan ?? '',
      };
      cache.set(key, entry);
      setResult({ ...entry, loading: false });
    } catch {
      // On error, fail-open so users are not blocked by a transient failure.
      setResult({ allowed: true, loading: false, reason: '', requiredPlan: '' });
    }
  }, [orgId, feature, clientSideBlocked, checkFeatureAccess]);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    fetchAccess();
    return () => abortRef.current?.abort();
  }, [fetchAccess]);

  return result;
}

/**
 * Imperatively clear the feature-access cache — useful after a plan change
 * or addon purchase so that the UI reflects the new state immediately.
 */
export function clearFeatureAccessCache(): void {
  cache.clear();
}

export default useFeatureAccess;
