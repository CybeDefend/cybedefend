import { Injectable, Optional } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import type { LinkScanDecision } from '../../core/products/repository-link-product';
import type { PushScanDecision } from '../../core/products/push-scan-product';
import { ScanCapabilityCache } from '../../core/scan-capability/scan-capability.cache';
import type {
  EntitlementsPort,
  WritableState,
} from '../ports/entitlements.port';

/**
 * Community Edition: every organisation is writable and every feature the
 * edition ships is allowed. The write gates (assertWritable,
 * assertFeatureAllowed) never refuse. The methods take no parameter: a
 * class method with fewer parameters still satisfies EntitlementsPort, and
 * the specs call them through the port type.
 */
@Injectable()
export class CommunityEntitlements implements EntitlementsPort {
  /**
   * The scan capability cache (ScanCapabilityModule, loaded in the API and
   * worker contexts). Absent (the cron context, or a test): no push or link
   * scan.
   */
  constructor(
    @Optional() private readonly scanCapability?: ScanCapabilityCache,
  ) {}

  async isWritable(): Promise<WritableState> {
    return { writable: true, trial: false };
  }

  async hasFeature(): Promise<boolean> {
    return true;
  }

  async assertWritable(): Promise<void> {
    // The Community Edition never blocks writes.
  }

  async assertFeatureAllowed(): Promise<void> {
    // Every feature the Community Edition ships is allowed.
  }

  /** Every Community project is an AppSec project. */
  projectProductMark(): boolean {
    return true;
  }

  /**
   * A push scans when security-scanning runs scans on a connected cluster:
   * `true` ⇒ an AppSec scan; `false` (or no cache) ⇒ none,
   * `community_edition`; unknown ⇒ none, `products_unknown` (a deferred
   * rescan is then kept and tried again). The per-project « scan on every
   * commit » check runs before this, in the GitHub and GitLab services.
   */
  async decidePushScan(): Promise<PushScanDecision> {
    const clusterScans = this.clusterScans();
    if (clusterScans === true) {
      return { scan: 'appsec' };
    }
    if (clusterScans === null) {
      return { scan: 'none', reason: 'products_unknown' };
    }
    return { scan: 'none', reason: 'community_edition' };
  }

  /**
   * A link scans when a cluster runs scans, otherwise it starts none
   * (`community_edition`, unknown included). The product list is still
   * validated, as in the cloud: any other value is refused INVALID_ARGUMENT
   * 'Unknown product'.
   */
  decideLinkScan(product: string | undefined): LinkScanDecision {
    if (product === undefined || product === '' || product === 'appsec') {
      return this.clusterScans() === true
        ? { scan: 'appsec' }
        : { scan: 'none', reason: 'community_edition' };
    }
    throw new RpcException({
      code: status.INVALID_ARGUMENT,
      message: 'Unknown product',
    });
  }

  /** `false` without a cache: the decision stays `community_edition`. */
  private clusterScans(): boolean | null {
    return this.scanCapability ? this.scanCapability.current() : false;
  }
}
