/**
 * The entitlements port (one copy per service, this one is the gateway's).
 * The core asks the edition layer what an organisation may do; the closed
 * billing domain answers in the cloud, the Community Edition answers yes.
 */
export const ENTITLEMENTS_PORT = 'ENTITLEMENTS_PORT';

export interface WritableState {
  writable: boolean;
  trial: boolean;
  reason?: string;
}

export interface FeatureAccess {
  allowed: boolean;
  requiredPlan?: string;
}

export interface EntitlementsPort {
  isWritable(organizationId: string): Promise<WritableState>;
  hasFeature(organizationId: string, feature: string): Promise<boolean>;
  /**
   * Replaces billing's `CheckFeatureAccess` (the gateway's method).
   * Community: `{ allowed: true }`.
   */
  checkFeatureAccess(
    organizationId: string,
    feature: string,
  ): Promise<FeatureAccess>;
}
