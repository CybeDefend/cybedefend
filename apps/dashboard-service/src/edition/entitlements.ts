import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '@/server/store';
import { PRODUCTS } from '@/utils/product';
import { ACTIVE_EXTENSIONS } from './active';
import type { EditionEntitlements } from './extensions';

/** Nothing blocked, every feature available, every plan reached: an edition without plans. */
export const NEUTRAL_ENTITLEMENTS: EditionEntitlements = Object.freeze({
  writesBlocked: false,
  writableAny: true,
  disabledFeatures: new Set<string>(),
  planIncludes: () => true,
});

const selectSelectedOrganization = (state: RootState) => state.organization?.selectedOrganization ?? null;

/**
 * What the selected organisation's plan allows (`EditionEntitlements`), as
 * the edition's billing extension answers it; NEUTRAL_ENTITLEMENTS without
 * one. The answer keeps its identity, its feature set included, while what it
 * says does not change, so it can sit in an effect's dependencies.
 */
export function useEditionEntitlements(): EditionEntitlements {
  const organization = useSelector(selectSelectedOrganization);
  const billing = ACTIVE_EXTENSIONS.billing;
  const answer = useMemo(
    () => (billing ? billing.entitlementsOf(organization, PRODUCTS) : NEUTRAL_ENTITLEMENTS),
    [billing, organization],
  );
  const featuresKey = [...answer.disabledFeatures].sort().join(',');
  const { writesBlocked, writableAny } = answer;
  // What planIncludes answers for the plans the core's pages name, so a new answer
  // that says the same keeps the former identity.
  const planKey = (['pro', 'enterprise'] as const).map((plan) => (answer.planIncludes(plan) ? '1' : '0')).join('');
  return useMemo(
    () => (billing ? { writesBlocked, writableAny, disabledFeatures: answer.disabledFeatures, planIncludes: answer.planIncludes } : NEUTRAL_ENTITLEMENTS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [billing, writesBlocked, writableAny, featuresKey, planKey],
  );
}

export default useEditionEntitlements;
