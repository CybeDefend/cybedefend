import { Test, TestingModule } from '@nestjs/testing';
import { MEMBER_PRODUCTS_COMMUNITY_BINDINGS } from 'src/edition/community/member-products.binding';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { UserService } from './user.service';
import { User } from 'src/entities/user.entity';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';
import { Team } from 'src/entities/team.entity';
import { MailService } from 'src/modules/mail/mail.service';
import { IDENTITY_PROVIDER_PORT } from 'src/edition/ports/identity-provider.port';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from 'src/test-utils/typeorm-mock.util';
import {
  ENTITLEMENTS_PORT,
  GlobalManagementEntitlementsPort,
} from 'src/edition/ports/entitlements.port';

/**
 * Community edition: `getProfile` reads the organisations' products through
 * ENTITLEMENTS_PORT, and the community port reports AppSec active for every
 * organisation (one product, no billing service to ask).
 */
describe('UserService.getProfile: products of each organisation (community)', () => {
  let service: UserService;
  let userRepo: MockType<Repository<User>>;
  let orgRepo: MockType<Repository<Organization>>;
  let entitlements: jest.Mocked<GlobalManagementEntitlementsPort>;

  /** The community answers of the port, as the edition layer binds them. */
  const communityEntitlements =
    (): jest.Mocked<GlobalManagementEntitlementsPort> =>
      ({
        isWritable: jest.fn(async () => ({ writable: true, trial: false })),
        hasFeature: jest.fn(async () => true),
        canInviteUser: jest.fn(async () => ({ allowed: true, reason: '' })),
        getEntitlements: jest.fn(async () => undefined),
        getOrganizationProducts: jest.fn(async () => [
          { product: 'appsec', status: 'active' },
        ]),
        getProductsForOrganizations: jest.fn(
          async (organizationIds: string[]) =>
            new Map(
              organizationIds.map((id) => [
                id,
                [{ product: 'appsec', status: 'active' }],
              ]),
            ),
        ),
        getSubscription: jest.fn(async () => ({ projectLimit: -1 })),
        getSubscriptionSummary: jest.fn(async () => undefined),
        syncBillingProfile: jest.fn(async () => false),
        organizationCreationState: jest.fn(() => ({
          isActive: true,
          writesBlocked: false,
          vibedefendActive: false,
          memberProducts: false,
        })),
      }) as unknown as jest.Mocked<GlobalManagementEntitlementsPort>;

  beforeEach(async () => {
    userRepo = createMockRepository<User>();
    orgRepo = createMockRepository<Organization>();
    const teamRepo = createMockRepository<Team>();
    (teamRepo.createQueryBuilder!() as any).getRawMany.mockResolvedValue([]);
    const projectRepo = createMockRepository<Project>();
    projectRepo.createQueryBuilder = jest.fn(() => ({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    }));
    entitlements = communityEntitlements();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        ...MEMBER_PRODUCTS_COMMUNITY_BINDINGS,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Organization), useValue: orgRepo },
        { provide: getRepositoryToken(Project), useValue: projectRepo },
        { provide: getRepositoryToken(Team), useValue: teamRepo },
        { provide: MailService, useValue: { sendWelcomeEmail: jest.fn() } },
        { provide: IDENTITY_PROVIDER_PORT, useValue: {} },
        { provide: ENTITLEMENTS_PORT, useValue: entitlements },
        { provide: Logger, useValue: createLoggerMock() },
      ],
    }).compile();

    service = module.get(UserService);

    userRepo.findOne!.mockResolvedValue({
      id: 'u1',
      firstName: 'A',
      email: 'a@a',
      notification: true,
      isOnboardingCompleted: true,
    });
    // One membership row of the caller (a raw row read).
    (orgRepo.createQueryBuilder!() as any).getRawMany.mockResolvedValue([
      {
        id: 'o1',
        name: 'Org o1',
        country: 'FR',
        industry: 'IT',
        isActive: 0,
        role: 'creator',
      },
    ]);
  });

  it('profile organisations carry AppSec active', async () => {
    const res = await service.getProfile({ userId: 'u1' });

    expect(entitlements.getProductsForOrganizations).toHaveBeenCalledTimes(1);
    expect(entitlements.getProductsForOrganizations).toHaveBeenCalledWith([
      'o1',
    ]);
    expect(res.myOrganizations[0].products).toEqual([
      { product: 'appsec', status: 'active' },
    ]);
  });
});
