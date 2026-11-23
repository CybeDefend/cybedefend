import { useEditionEntitlements } from '@/edition/entitlements';

/**
 * The features the selected organisation's plan leaves out, by key, as the
 * edition's entitlements answer them (`useEditionEntitlements`): none in an
 * edition without plans.
 *
 * @example
 * ```tsx
 * const disabled = useDisabledFeatures();
 * const isContainerLocked = disabled.has('container_scanning');
 * ```
 */
export function useDisabledFeatures(): ReadonlySet<string> {
  return useEditionEntitlements().disabledFeatures;
}

export default useDisabledFeatures;
