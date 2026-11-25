import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { User } from 'src/entities/user.entity';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';
import { Team } from 'src/entities/team.entity';
import { MailService } from 'src/modules/mail/mail.service';
import { ENTITLEMENTS_PORT } from 'src/edition/ports/entitlements.port';
import { IDENTITY_PROVIDER_PORT } from 'src/edition/ports/identity-provider.port';
import { MEMBER_PRODUCTS_COMMUNITY_BINDINGS } from 'src/edition/community/member-products.binding';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from 'src/test-utils/typeorm-mock.util';
import { identityProviderMock } from '../organization/organization.service.fixtures';
import {
  ONBOARDING_PROGRESS_MAX_REQUEST_LENGTH,
  ONBOARDING_PROGRESS_MAX_STEPS,
  UserService,
} from './user.service';

describe('UserService.update onboardingProgress', () => {
  let service: UserService;
  let userRepo: MockType<any>;
  let stored: { id: string; onboardingProgress: string[] | null };

  beforeEach(async () => {
    userRepo = createMockRepository<User>();
    stored = { id: 'u1', onboardingProgress: ['org_created'] };
    userRepo.findOne!.mockImplementation(async () => stored);
    userRepo.save!.mockImplementation(async (u: typeof stored) => u);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(Organization),
          useValue: createMockRepository<Organization>(),
        },
        {
          provide: getRepositoryToken(Project),
          useValue: createMockRepository<Project>(),
        },
        {
          provide: getRepositoryToken(Team),
          useValue: createMockRepository<Team>(),
        },
        { provide: MailService, useValue: { sendWelcomeEmail: jest.fn() } },
        { provide: IDENTITY_PROVIDER_PORT, useValue: identityProviderMock() },
        {
          provide: ENTITLEMENTS_PORT,
          useValue: {
            getProductsForOrganizations: jest.fn(async () => []),
            getSubscriptionSummary: jest.fn(async () => undefined),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
        ...MEMBER_PRODUCTS_COMMUNITY_BINDINGS,
      ],
    }).compile();
    service = module.get(UserService);
  });

  const update = (onboardingProgress: string) =>
    service.update({ userId: 'u1', onboardingProgress } as any);

  it('merges valid step ids into the stored ones', async () => {
    await update(JSON.stringify(['first_project', 'product_choice_v1']));
    expect(stored.onboardingProgress).toEqual([
      'org_created',
      'first_project',
      'product_choice_v1',
    ]);
  });

  it(`refuses a value longer than ${ONBOARDING_PROGRESS_MAX_REQUEST_LENGTH} characters, and stores nothing`, async () => {
    expect(ONBOARDING_PROGRESS_MAX_REQUEST_LENGTH).toBe(4096);
    const big = JSON.stringify(
      Array.from({ length: 2000 }, (_, i) => `step_${i}`),
    );
    expect(big.length).toBeGreaterThan(ONBOARDING_PROGRESS_MAX_REQUEST_LENGTH);
    const error = await update(big).catch((e) => e);
    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toEqual(
      expect.objectContaining({ code: status.INVALID_ARGUMENT }),
    );
    expect(userRepo.save).not.toHaveBeenCalled();
    expect(stored.onboardingProgress).toEqual(['org_created']);
  });

  it('keeps only strings shaped like a step id', async () => {
    await update(
      JSON.stringify([
        'first_scan_completed',
        'x'.repeat(65),
        'Has Space',
        '<script>',
        42,
        { a: 1 },
        ['nested'],
        null,
        '',
      ]),
    );
    expect(stored.onboardingProgress).toEqual([
      'org_created',
      'first_scan_completed',
    ]);
  });

  it(`stores at most ${ONBOARDING_PROGRESS_MAX_STEPS} step ids, keeping the ones already recorded`, async () => {
    expect(ONBOARDING_PROGRESS_MAX_STEPS).toBe(100);
    for (let round = 0; round < 10; round++) {
      await update(
        JSON.stringify(Array.from({ length: 30 }, (_, i) => `s${round}_${i}`)),
      );
    }
    expect(stored.onboardingProgress).toHaveLength(
      ONBOARDING_PROGRESS_MAX_STEPS,
    );
    expect(stored.onboardingProgress?.[0]).toBe('org_created');
  });

  it('cleans a stored value that is already over the bounds', async () => {
    stored.onboardingProgress = [
      'org_created',
      'y'.repeat(70_000),
      ...Array.from({ length: 500 }, (_, i) => `old_${i}`),
    ];
    await update(JSON.stringify(['first_project']));
    expect(stored.onboardingProgress).toHaveLength(
      ONBOARDING_PROGRESS_MAX_STEPS,
    );
    expect(stored.onboardingProgress).not.toContain('y'.repeat(70_000));
    expect(stored.onboardingProgress?.[0]).toBe('org_created');
  });

  it('still ignores a value that is not a JSON array', async () => {
    await update('{"a":1}');
    await update('not json');
    expect(stored.onboardingProgress).toEqual(['org_created']);
  });
});
