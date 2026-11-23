import type { Organization } from 'src/entities/organization.entity';

/**
 * The entitlements port: every synchronous question the core asks the
 * closed billing service. Each service owns its copy of this file, starting
 * from a shared shape. global-management extends it with the billing RPCs its
 * call sites used directly.
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
}

export interface ProductStatus {
  product: string;
  status: string;
  /** Whether the organisation used its trial; an edition without trials leaves it out. */
  trialUsed?: boolean;
}

export interface OrganizationCreationState {
  isActive: boolean;
  writesBlocked: boolean;
  vibedefendActive: boolean;
  memberProducts: boolean;
}

export interface GlobalManagementEntitlementsPort extends EntitlementsPort {
  /** CanInviteUser. Community: { allowed: true, reason: '' }. Cloud: 5,000 ms, rejects on timeout or error. */
  canInviteUser(
    organizationId: string,
    activeUsers: number,
  ): Promise<{ allowed: boolean; reason: string }>;
  /** GetEntitlements { membersChanged }. Community: resolves. Cloud: rejects on error (callers log). */
  getEntitlements(
    organizationId: string,
    options: { membersChanged: boolean },
  ): Promise<void>;
  /** GetOrganizationProducts. Community: [{ product: 'appsec', status: 'active' }]. Cloud: 5,000 ms, rejects. */
  getOrganizationProducts(organizationId: string): Promise<ProductStatus[]>;
  /** GetProductsForOrganizations. Community: every id → [appsec active]. Cloud: rejects on error. */
  getProductsForOrganizations(
    organizationIds: string[],
  ): Promise<Map<string, ProductStatus[]>>;
  /** SubscriptionsService.GetSubscription. Community: { projectLimit: -1 }. Cloud: { projectLimit: sub.projectLimit ?? -1 }, rejects. */
  getSubscription(organizationId: string): Promise<{ projectLimit: number }>;
  /** SubscriptionsService.GetSubscription, mapped as the profile's `subscription` summary, a message only the closed edition's proto carries. Community: undefined (no subscription). Cloud: the summary, undefined when billing answers success=false; rejects on error, the caller keeps its NOT_FOUND handling. */
  getSubscriptionSummary(organizationId: string): Promise<object | undefined>;
  /**
   * The organisation's billing profile, saved: handed to the billing
   * service. With `previous` (the row before the update), only when a field
   * the profile is built from changed. Answers whether it was sent.
   * Community: false, nothing sent. Cloud: rejects on error (callers log).
   */
  syncBillingProfile(
    organization: Organization,
    previous?: Organization,
  ): Promise<boolean>;
  /** What a new organisation starts with (no billing RPC). Community: true/false/false/false. Cloud: false/false/false/true. */
  organizationCreationState(): OrganizationCreationState;
}
