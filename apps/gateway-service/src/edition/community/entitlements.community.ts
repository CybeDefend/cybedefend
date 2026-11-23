import { Injectable } from '@nestjs/common';
import type {
  EntitlementsPort,
  FeatureAccess,
  WritableState,
} from '../ports/entitlements.port';

/**
 * The Community Edition has no billing: every organisation is writable, every
 * feature is allowed, and nothing is ever a trial.
 */
@Injectable()
export class CommunityEntitlements implements EntitlementsPort {
  async isWritable(): Promise<WritableState> {
    return { writable: true, trial: false };
  }

  async hasFeature(): Promise<boolean> {
    return true;
  }

  async checkFeatureAccess(): Promise<FeatureAccess> {
    return { allowed: true };
  }
}
