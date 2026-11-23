import type { LinkScanDecision } from '../core/products/repository-link-product';
import type { PushScanDecision } from '../core/products/push-scan-product';
import type {
  EntitlementsPort,
  WritableState,
} from '../edition/ports/entitlements.port';

/**
 * An ENTITLEMENTS_PORT double that answers the Community Edition's answers
 * by default; pass overrides (usually the jest.fn a spec asserts on) to
 * reuse them: entitlementsMock({ assertWritable: m.assertWritable }).
 *
 * The product decisions default to the AppSec path (`{ scan: 'appsec' }`), so
 * the core blocks that remain on the port keep today's behaviour; the
 * Community Edition's own answers are on CommunityEntitlements.
 */
export function entitlementsMock(
  overrides: Partial<jest.Mocked<EntitlementsPort>> = {},
): jest.Mocked<EntitlementsPort> {
  return {
    isWritable: jest.fn<Promise<WritableState>, [organizationId: string]>(
      async () => ({ writable: true, trial: false }),
    ),
    hasFeature: jest.fn<
      Promise<boolean>,
      [organizationId: string, feature: string]
    >(async () => true),
    assertWritable: jest.fn<Promise<void>, [organizationId: string]>(
      async () => undefined,
    ),
    assertFeatureAllowed: jest.fn<
      Promise<void>,
      [organizationId: string, feature: string]
    >(async () => undefined),
    projectProductMark: jest.fn<boolean | undefined, [project: object]>(
      () => true,
    ),
    decidePushScan: jest.fn<
      Promise<PushScanDecision>,
      [organizationId: string | undefined, appsecProject: boolean | undefined]
    >(async () => ({ scan: 'appsec' })),
    decideLinkScan: jest.fn<LinkScanDecision, [product: string | undefined]>(
      () => ({ scan: 'appsec' }),
    ),
    ...overrides,
  };
}
