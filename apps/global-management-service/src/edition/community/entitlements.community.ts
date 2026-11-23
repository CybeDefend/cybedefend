import { Injectable } from '@nestjs/common';
import type {
  GlobalManagementEntitlementsPort,
  OrganizationCreationState,
  ProductStatus,
  WritableState,
} from '../ports/entitlements.port';

/**
 * AppSec, active, for every organisation of the instance: the Community
 * Edition has one product and no billing service to ask.
 */
const APPSEC_ACTIVE: ProductStatus = {
  product: 'appsec',
  status: 'active',
};

/**
 * The Community Edition's entitlements: everything is allowed, AppSec is
 * active everywhere, no trial, no project limit, and a new organisation
 * starts active, without the per-member-products switch, without the second
 * product.
 */
@Injectable()
export class CommunityEntitlements implements GlobalManagementEntitlementsPort {
  // Unused parameters are omitted, not `_`-prefixed: an interface method may
  // be implemented with fewer parameters than it declares.
  async isWritable(): Promise<WritableState> {
    return { writable: true, trial: false };
  }

  async hasFeature(): Promise<boolean> {
    return true;
  }

  async canInviteUser(): Promise<{ allowed: boolean; reason: string }> {
    return { allowed: true, reason: '' };
  }

  async getEntitlements(): Promise<void> {
    // No billing service: nothing to refresh.
  }

  async getOrganizationProducts(): Promise<ProductStatus[]> {
    return [{ ...APPSEC_ACTIVE }];
  }

  async getProductsForOrganizations(
    organizationIds: string[],
  ): Promise<Map<string, ProductStatus[]>> {
    return new Map(organizationIds.map((id) => [id, [{ ...APPSEC_ACTIVE }]]));
  }

  async getSubscription(): Promise<{ projectLimit: number }> {
    return { projectLimit: -1 };
  }

  async getSubscriptionSummary(): Promise<object | undefined> {
    // No subscription in the Community Edition: the profile carries none.
    return undefined;
  }

  async syncBillingProfile(): Promise<boolean> {
    // No billing service: nothing to sync.
    return false;
  }

  organizationCreationState(): OrganizationCreationState {
    return {
      isActive: true,
      writesBlocked: false,
      vibedefendActive: false,
      memberProducts: false,
    };
  }
}
