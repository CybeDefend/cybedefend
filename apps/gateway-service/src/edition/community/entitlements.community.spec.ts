import { CommunityEntitlements } from './entitlements.community';
import type { EntitlementsPort } from '../ports/entitlements.port';

/**
 * The Community Edition has no billing: every organisation is writable,
 * every feature is allowed, and nothing is ever a trial.
 */
describe('CommunityEntitlements', () => {
  it('allows every feature', async () => {
    const port: EntitlementsPort = new CommunityEntitlements();

    await expect(port.checkFeatureAccess('o', 'reports')).resolves.toEqual({
      allowed: true,
    });
    await expect(port.hasFeature('o', 'reports')).resolves.toBe(true);
  });

  it('is writable and never a trial', async () => {
    const port: EntitlementsPort = new CommunityEntitlements();

    await expect(port.isWritable('o')).resolves.toEqual({
      writable: true,
      trial: false,
    });
  });
});
