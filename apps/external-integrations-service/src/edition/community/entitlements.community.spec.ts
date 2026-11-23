import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  ENTITLEMENTS_PORT,
  EntitlementsPort,
} from '../ports/entitlements.port';
import { ENTITLEMENTS_COMMUNITY_BINDINGS } from './entitlements.binding';
import { CommunityEntitlements } from './entitlements.community';
import type { ScanCapabilityCache } from '../../core/scan-capability/scan-capability.cache';

function withCluster(answer: boolean | null): EntitlementsPort {
  const cache = { current: () => answer } as unknown as ScanCapabilityCache;
  return new CommunityEntitlements(cache);
}

function refusal(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('CommunityEntitlements', () => {
  const e: EntitlementsPort = new CommunityEntitlements();

  // Every Community project is an AppSec project, whatever its row says.
  it('reads every project as an AppSec project', () => {
    expect(e.projectProductMark({ appsecEnabled: false })).toBe(true);
    expect(e.projectProductMark({})).toBe(true);
  });

  it('every organisation is writable and never a trial', async () => {
    expect(await e.isWritable('org-1')).toEqual({
      writable: true,
      trial: false,
    });
  });

  it('every feature the Community Edition ships is allowed', async () => {
    expect(await e.hasFeature('org-1', 'jira')).toBe(true);
  });

  it('assertWritable and assertFeatureAllowed never refuse', async () => {
    await expect(e.assertWritable('org-1')).resolves.toBeUndefined();
    await expect(
      e.assertFeatureAllowed('org-1', 'jira_issues'),
    ).resolves.toBeUndefined();
  });

  it('without a scan capability cache, a push never starts a scan', async () => {
    expect(await e.decidePushScan('org-1', true)).toEqual({
      scan: 'none',
      reason: 'community_edition',
    });
    expect(await e.decidePushScan('org-1', undefined)).toEqual({
      scan: 'none',
      reason: 'community_edition',
    });
    expect(await e.decidePushScan(undefined, undefined)).toEqual({
      scan: 'none',
      reason: 'community_edition',
    });
  });

  it('without a scan capability cache, a link never starts a scan', () => {
    expect(e.decideLinkScan(undefined)).toEqual({
      scan: 'none',
      reason: 'community_edition',
    });
    expect(e.decideLinkScan('')).toEqual({
      scan: 'none',
      reason: 'community_edition',
    });
    expect(e.decideLinkScan('appsec')).toEqual({
      scan: 'none',
      reason: 'community_edition',
    });
  });

  it('an unknown product is refused, as in the cloud', () => {
    let thrown: unknown;
    try {
      e.decideLinkScan('vibedefend');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RpcException);
    expect((thrown as RpcException).getError()).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'Unknown product',
    });
  });

  describe('with the scan capability cache', () => {
    it('a push starts an AppSec scan when a cluster runs scans', async () => {
      expect(await withCluster(true).decidePushScan('org-1', true)).toEqual({
        scan: 'appsec',
      });
      expect(
        await withCluster(true).decidePushScan(undefined, undefined),
      ).toEqual({ scan: 'appsec' });
    });

    it('a push starts nothing when no cluster runs scans', async () => {
      expect(await withCluster(false).decidePushScan('org-1', true)).toEqual({
        scan: 'none',
        reason: 'community_edition',
      });
    });

    it('a push starts nothing, products_unknown, while the capability is unknown', async () => {
      expect(await withCluster(null).decidePushScan('org-1', true)).toEqual({
        scan: 'none',
        reason: 'products_unknown',
      });
    });

    it('a link starts an AppSec scan when a cluster runs scans', () => {
      for (const product of [undefined, '', 'appsec']) {
        expect(withCluster(true).decideLinkScan(product)).toEqual({
          scan: 'appsec',
        });
      }
    });

    it('a link starts nothing when no cluster runs scans', () => {
      for (const product of [undefined, '', 'appsec']) {
        expect(withCluster(false).decideLinkScan(product)).toEqual({
          scan: 'none',
          reason: 'community_edition',
        });
      }
    });

    it('a link starts nothing while the capability is unknown', () => {
      for (const product of [undefined, '', 'appsec']) {
        expect(withCluster(null).decideLinkScan(product)).toEqual({
          scan: 'none',
          reason: 'community_edition',
        });
      }
    });

    it("an unknown product is still refused INVALID_ARGUMENT 'Unknown product'", () => {
      for (const answer of [true, false, null]) {
        const thrown = refusal(() =>
          withCluster(answer).decideLinkScan('vibedefend'),
        );
        expect(thrown).toBeInstanceOf(RpcException);
        expect((thrown as RpcException).getError()).toEqual({
          code: status.INVALID_ARGUMENT,
          message: 'Unknown product',
        });
      }
    });
  });

  it('is the community binding of ENTITLEMENTS_PORT', () => {
    expect(ENTITLEMENTS_COMMUNITY_BINDINGS).toEqual([
      { provide: ENTITLEMENTS_PORT, useClass: CommunityEntitlements },
    ]);
  });
});
