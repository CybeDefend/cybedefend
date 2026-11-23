import { Test, TestingModule } from '@nestjs/testing';
import { ClientGrpc } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';

import { UserService } from './user.service';
import {
  USER_SERVICE_NAME,
  UserServiceClient,
} from '@grpc/global-management/global_management';
import {
  GetUserProfileRequest,
  UpdateUserProfileRequest,
  UserUpdateResponse,
} from '@grpc/global-management/user';

describe('UserService', () => {
  let service: UserService;
  let clientMock: jest.Mocked<ClientGrpc>;
  let grpcStub: jest.Mocked<UserServiceClient>;

  beforeEach(async () => {
    grpcStub = {
      getUserProfile: jest.fn(),
      updateUser: jest.fn(),
    } as any;

    clientMock = {
      getService: jest.fn().mockReturnValue(grpcStub),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: 'GLOBAL_MANAGEMENT_SERVICE', useValue: clientMock },
      ],
    }).compile();

    service = module.get(UserService);
    service.onModuleInit();
  });

  it(
    'should init gRPC client',
    () => {
      expect(clientMock.getService).toHaveBeenCalledWith(USER_SERVICE_NAME);
    },
    expect.anything(),
  );

  it('getProfile returns the organizations, and adds no subscription of its own', async () => {
    const req: GetUserProfileRequest = { userId: 'u1' };
    const res: any = {
      id: 'u1',
      firstName: 'Jane',
      email: 'jane@doe.tld',
      lastName: 'Doe',
      picture: '',
      notification: true,
      isOnboardingCompleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      myOrganizations: [
        {
          id: 'o1',
          name: 'Org',
          country: 'FR',
          industry: 'Tech',
          isActive: true,
          myTeams: [],
          myRole: 'member',
        },
        {
          id: 'o2',
          name: 'Org2',
          country: 'FR',
          industry: 'Tech',
          isActive: true,
          myTeams: [],
          myRole: 'member',
          // no subscription provided
        },
      ],
    };
    grpcStub.getUserProfile.mockReturnValue(of(res) as any);

    const out = await service.getProfile(req);
    expect(out.myOrganizations?.[0]?.id).toBe('o1');
    // The core names no subscription: an organisation without one has
    // none in the answer.
    expect(out.myOrganizations?.[1]).not.toHaveProperty('subscription');
  });

  it('getProfile passes each organisation products through, [] (unknown) when absent', async () => {
    const products = [
      {
        product: 'appsec',
        status: 'inactive',
        trialUsed: false,
        activatedAt: '',
        deactivatedAt: '',
      },
      {
        product: 'closed-product',
        status: 'active',
        trialUsed: false,
        activatedAt: '2026-10-05T10:00:00.000Z',
        deactivatedAt: '',
      },
    ];
    grpcStub.getUserProfile.mockReturnValue(
      of({
        id: 'u1',
        myOrganizations: [
          // A closed-product-only organisation: no AppSec subscription.
          { id: 'o1', myTeams: [], products },
          // Billing was unreachable: GM sends no products.
          { id: 'o2', myTeams: [] },
        ],
      }) as any,
    );

    const out = await service.getProfile({ userId: 'u1' });

    expect(out.myOrganizations[0].products).toEqual(products);
    expect(out.myOrganizations[0]).not.toHaveProperty('subscription');
    expect(out.myOrganizations[1].products).toEqual([]);
  });

  // Per-member products: the current member's own products
  // in each organisation. Empty means unknown (an older global-management),
  // never « no access »: the dashboard then keeps today's behaviour.
  it('getProfile passes each organisation myProducts through, [] (unknown) when absent', async () => {
    grpcStub.getUserProfile.mockReturnValue(
      of({
        id: 'u1',
        myOrganizations: [
          { id: 'o1', myTeams: [], myProducts: ['closed-product'] },
          { id: 'o2', myTeams: [], myProducts: ['appsec', 'closed-product'] },
          // An older global-management sends no myProducts.
          { id: 'o3', myTeams: [] },
        ],
      }) as any,
    );

    const out = await service.getProfile({ userId: 'u1' });

    expect(out.myOrganizations.map((o) => o.myProducts)).toEqual([
      ['closed-product'],
      ['appsec', 'closed-product'],
      [],
    ]);
  });

  // myProductsKnown: proto3 cannot tell an empty myProducts
  // from an absent one, and an older global-management sends neither. Only
  // `true` says global-management computed myProducts: true with [] is « no
  // product »; absent is unknown, which the dashboard reads as today.
  describe('getProfile passes myProductsKnown through', () => {
    const profileWith = (org: Record<string, unknown>) =>
      grpcStub.getUserProfile.mockReturnValue(
        of({
          id: 'u1',
          myOrganizations: [{ id: 'o1', myTeams: [], ...org }],
        }) as any,
      );

    it('known, with no product: true and []', async () => {
      profileWith({ myProducts: [], myProductsKnown: true });

      const [org] = (await service.getProfile({ userId: 'u1' }))
        .myOrganizations;

      expect(org.myProductsKnown).toBe(true);
      expect(org.myProducts).toEqual([]);
    });

    it('absent (an older global-management): false, never undefined', async () => {
      profileWith({});

      const [org] = (await service.getProfile({ userId: 'u1' }))
        .myOrganizations;

      expect(org.myProductsKnown).toBe(false);
      expect(org.myProducts).toEqual([]);
    });

    it('known, with products: true and the list', async () => {
      profileWith({ myProducts: ['closed-product'], myProductsKnown: true });

      const [org] = (await service.getProfile({ userId: 'u1' }))
        .myOrganizations;

      expect(org.myProductsKnown).toBe(true);
      expect(org.myProducts).toEqual(['closed-product']);
    });
  });

  // The members page reads the per-member products switch from the profile.
  describe('getProfile passes the products switch through', () => {
    it('keeps memberProducts as sent, and absent when an older global-management sends none', async () => {
      grpcStub.getUserProfile.mockReturnValue(
        of({
          id: 'u1',
          myOrganizations: [
            { id: 'o1', myTeams: [], memberProducts: false },
            { id: 'o2', myTeams: [], memberProducts: true },
            { id: 'o3', myTeams: [] },
          ],
        }) as any,
      );

      const orgs = (await service.getProfile({ userId: 'u1' })).myOrganizations;

      expect(orgs[0].memberProducts).toBe(false);
      expect(orgs[1].memberProducts).toBe(true);
      // Unknown stays unknown: never coerced to « off ».
      expect('memberProducts' in orgs[2]).toBe(false);
    });
  });

  it('getProfile propagates error', async () => {
    grpcStub.getUserProfile.mockReturnValue(
      throwError(() => new Error('boom')) as any,
    );
    await expect(service.getProfile({ userId: 'u1' })).rejects.toThrow('boom');
  });

  it(
    'updateProfile returns success',
    async () => {
      const req: UpdateUserProfileRequest = {
        userId: 'u1',
        notification: true,
        isOnboardingCompleted: true,
      } as any;
      const res: UserUpdateResponse = { message: 'ok', userId: 'u1' };
      grpcStub.updateUser.mockReturnValue(of(res) as any);
      await expect(service.updateProfile(req)).resolves.toEqual(res);
      expect(grpcStub.updateUser).toHaveBeenCalledWith(req, expect.anything());
    },
    expect.anything(),
  );
});
