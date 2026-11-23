/* eslint-disable @typescript-eslint/no-unused-vars -- the Community
   implementations ignore their port's arguments on purpose */
import type {
  EntitlementsPort,
  WritableState,
} from '../ports/entitlements.port';

/**
 * The Community Edition has no entitlement limits: every organization is
 * writable and non-trial, and every feature is present.
 */
export class CommunityEntitlements implements EntitlementsPort {
  async isWritable(_organizationId: string): Promise<WritableState> {
    return { writable: true, trial: false };
  }

  async hasFeature(
    _organizationId: string,
    _feature: string,
  ): Promise<boolean> {
    return true;
  }
}
