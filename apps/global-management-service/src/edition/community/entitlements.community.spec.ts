import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { GlobalManagementEntitlementsPort } from '../ports/entitlements.port';
import { ENTITLEMENTS_PORT } from '../ports/entitlements.port';
import { ENTITLEMENTS_COMMUNITY_BINDINGS } from './entitlements.binding';
import { CommunityEntitlements } from './entitlements.community';

describe('CommunityEntitlements (ENTITLEMENTS_PORT, community edition)', () => {
  let module: TestingModule;
  let port: GlobalManagementEntitlementsPort;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [...ENTITLEMENTS_COMMUNITY_BINDINGS],
    }).compile();
    port = module.get<GlobalManagementEntitlementsPort>(ENTITLEMENTS_PORT);
  });

  afterEach(async () => {
    await module.close();
  });

  it('binds ENTITLEMENTS_PORT to CommunityEntitlements', () => {
    expect(port).toBeInstanceOf(CommunityEntitlements);
  });

  it('is always writable, never on trial', async () => {
    expect(await port.isWritable('o')).toEqual({
      writable: true,
      trial: false,
    });
  });

  it('allows every feature', async () => {
    expect(await port.hasFeature('o', 'reports')).toBe(true);
  });

  it('allows every invitation', async () => {
    expect(await port.canInviteUser('o', 999)).toEqual({
      allowed: true,
      reason: '',
    });
  });

  it('reports AppSec active for every organisation', async () => {
    expect([
      ...(await port.getProductsForOrganizations(['a', 'b'])).entries(),
    ]).toEqual([
      ['a', [{ product: 'appsec', status: 'active' }]],
      ['b', [{ product: 'appsec', status: 'active' }]],
    ]);
  });

  it('lists AppSec as the active product of one organisation', async () => {
    expect(await port.getOrganizationProducts('o')).toEqual([
      { product: 'appsec', status: 'active' },
    ]);
  });

  it('has no project limit', async () => {
    expect(await port.getSubscription('o')).toEqual({ projectLimit: -1 });
  });

  it('resolves the entitlement refresh and the billing profile sync', async () => {
    await expect(
      port.getEntitlements('o', { membersChanged: true }),
    ).resolves.toBeUndefined();
    // No billing service: the profile is never sent.
    await expect(port.syncBillingProfile({ id: 'o' } as never)).resolves.toBe(
      false,
    );
  });

  it('starts an organisation active, unswitched, without the second product', () => {
    expect(port.organizationCreationState()).toEqual({
      isActive: true,
      writesBlocked: false,
      vibedefendActive: false,
      memberProducts: false,
    });
  });
});
