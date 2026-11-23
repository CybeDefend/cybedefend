import { EntitlementsCommunity } from './entitlements.community';
import type { AnalysisReportingEntitlementsPort } from '../ports/entitlements.port';

/**
 * The Community Edition has no billing: everything is writable, every feature
 * is on, no organisation is AppSec-off and no quota applies (-1 = unlimited).
 */
describe('EntitlementsCommunity', () => {
  it('allows everything with no quota', async () => {
    const port: AnalysisReportingEntitlementsPort = new EntitlementsCommunity();

    await expect(port.isWritable('o')).resolves.toEqual({
      writable: true,
      trial: false,
    });
    await expect(port.hasFeature('o', 'sbom')).resolves.toBe(true);
    await expect(port.getProductsForOrganizations(['o'])).resolves.toEqual({
      off: new Set(),
      failed: false,
    });
    await expect(port.getEntitlements('o')).resolves.toEqual({
      maxStoredReports: -1,
      reportRetentionDays: -1,
    });
  });
});
