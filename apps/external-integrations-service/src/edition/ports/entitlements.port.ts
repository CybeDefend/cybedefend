import type { LinkScanDecision } from '../../core/products/repository-link-product';
import type { PushScanDecision } from '../../core/products/push-scan-product';

/**
 * The entitlements port (each service has its own copy). Every write gate external-integrations needs goes
 * through it: the Community Edition answers "everything allowed", the cloud
 * delegates to the billing services.
 */
export const ENTITLEMENTS_PORT = 'ENTITLEMENTS_PORT';

export interface WritableState {
  writable: boolean;
  trial: boolean;
  reason?: string;
}

export interface EntitlementsPort {
  isWritable(organizationId: string): Promise<WritableState>;
  hasFeature(organizationId: string, feature: string): Promise<boolean>;
  /**
   * Throws RpcException(PERMISSION_DENIED, 'WRITES_BLOCKED') when the
   * organisation is in read-only mode. Community: never refuses.
   */
  assertWritable(organizationId: string): Promise<void>;
  /**
   * Throws RpcException(PERMISSION_DENIED, plan message) when the plan does
   * not include the feature. Community: never refuses.
   */
  assertFeatureAllowed(organizationId: string, feature: string): Promise<void>;
  /**
   * What a push on a linked repository starts. Community: it follows the
   * scan capability cache (ScanCapabilityCache, whether security-scanning
   * runs scans on a connected cluster): `true` ⇒ `{ scan: 'appsec' }`;
   * `false`, or no cache, ⇒ `{ scan: 'none', reason: 'community_edition' }`;
   * unknown ⇒ `{ scan: 'none', reason: 'products_unknown' }`. The
   * per-project « scan on every commit » check runs before it.
   */
  /**
   * Whether a project, as global-management's lean read answers it, is an
   * AppSec project, handed to decidePushScan. Community: true, every project
   * is one. Cloud: the read's AppSec mark, undefined when the read carries
   * none (an older global-management: unknown).
   */
  projectProductMark(project: object): boolean | undefined;
  decidePushScan(
    organizationId: string | undefined,
    appsecProject: boolean | undefined,
  ): Promise<PushScanDecision>;
  /**
   * What the scan of a repository link (or a re-analysis from that product)
   * is. Community, for `undefined` | `''` | `'appsec'`: `{ scan: 'appsec' }`
   * when the scan capability cache says a cluster runs scans, otherwise
   * `{ scan: 'none', reason: 'community_edition' }` (unknown included); any
   * other value is refused RpcException(INVALID_ARGUMENT, 'Unknown
   * product'), as in the cloud.
   */
  decideLinkScan(product: string | undefined): LinkScanDecision;
}
