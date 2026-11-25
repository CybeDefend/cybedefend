import { EntitlementsCommunity } from './entitlements.community';
import type { AnalysisReportingEntitlementsPort } from '../ports/entitlements.port';

/**
 * The Community Edition has no billing: everything is writable, every feature
 * is on and no organisation is AppSec-off. Stored reports are bounded per
 * organisation (500 by default, REPORTS_MAX_STORED_PER_ORG), and reports never
 * expire unless REPORTS_RETENTION_DAYS sets a retention.
 */
const community = (): AnalysisReportingEntitlementsPort =>
  new EntitlementsCommunity();

describe('EntitlementsCommunity', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('allows everything, with a finite stored-report quota and no expiry by default', async () => {
    delete process.env.REPORTS_MAX_STORED_PER_ORG;
    delete process.env.REPORTS_RETENTION_DAYS;
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
      maxStoredReports: 500,
      reportRetentionDays: -1,
    });
  });

  it('reads the quota and the retention from the environment', async () => {
    process.env.REPORTS_MAX_STORED_PER_ORG = '50';
    process.env.REPORTS_RETENTION_DAYS = '30';
    await expect(community().getEntitlements('o')).resolves.toEqual({
      maxStoredReports: 50,
      reportRetentionDays: 30,
    });
  });

  it('keeps the defaults on a value that is not a positive integer', async () => {
    process.env.REPORTS_MAX_STORED_PER_ORG = '0';
    process.env.REPORTS_RETENTION_DAYS = 'soon';
    await expect(community().getEntitlements('o')).resolves.toEqual({
      maxStoredReports: 500,
      reportRetentionDays: -1,
    });
  });

  it('accepts -1 as an explicit unlimited quota', async () => {
    process.env.REPORTS_MAX_STORED_PER_ORG = '-1';
    await expect(community().getEntitlements('o')).resolves.toMatchObject({
      maxStoredReports: -1,
    });
  });
});
