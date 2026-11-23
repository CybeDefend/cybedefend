import { PROJECT_SETTINGS_COMMUNITY_BINDINGS } from 'src/edition/community/project-settings.binding';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { FindOperator, IsNull } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { of } from 'rxjs';
import { ProjectService } from './project.service';
import { Project } from 'src/entities/project.entity';
import { ProjectBranchIngestion } from 'src/entities/project-branch-ingestion.entity';
import { ArchivedBranch } from 'src/entities/archived-branch.entity';
import { Organization } from 'src/entities/organization.entity';
import { ProjectSecurityContext } from 'src/entities/project-security-context.entity';
import { Team } from 'src/entities/team.entity';
import { User } from 'src/entities/user.entity';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from 'src/test-utils/typeorm-mock.util';
import { AuthorizationService } from '../authorization/authorization.service';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { DataPurgeLedger } from '../data-purge/data-purge.ledger';
import { DataPurgeRunner } from '../data-purge/data-purge.runner';
import {
  ENTITLEMENTS_PORT,
  GlobalManagementEntitlementsPort,
} from 'src/edition/ports/entitlements.port';

/**
 * Community edition: the plan project limit goes through ENTITLEMENTS_PORT,
 * and the community port answers `projectLimit: -1` (no limit), which
 * `resolvePlanProjectLimit` maps to +∞ — so a project is always created, and
 * `markProjectAppsec` always answers `limitReached: false`.
 */
describe('ProjectService: plan project limit (community)', () => {
  let service: ProjectService;
  let projectRepo: MockType<any>;
  let teamRepo: MockType<any>;
  let userRepo: MockType<any>;
  let securityContextRepo: MockType<any>;
  let managerCalls: {
    findOne: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
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
          { product: 'appsec', status: 'active', trialUsed: false },
        ]),
        getProductsForOrganizations: jest.fn(async () => new Map()),
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

  const wrapGrpc = (payload: unknown = {}) => of(payload);

  beforeEach(async () => {
    projectRepo = createMockRepository<Project>();
    const branchIngestionRepo = createMockRepository<ProjectBranchIngestion>();
    const archivedBranchRepo = createMockRepository<ArchivedBranch>();
    securityContextRepo = createMockRepository<ProjectSecurityContext>();
    teamRepo = createMockRepository<Team>();
    userRepo = createMockRepository<User>();
    const purgeLedger = { enqueueProject: jest.fn(async () => 'job-1') };
    const purgeRunner = { kick: jest.fn() };
    const realtimePublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    entitlements = communityEntitlements();

    managerCalls = {
      findOne: jest.fn(async (entityClass: unknown) => {
        if (entityClass === Organization) return { id: 'o1' };
        return null;
      }),
      count: jest.fn(async (entityClass: unknown, opts: unknown) => {
        if (entityClass === Project) return projectRepo.count!(opts as never);
        return 0;
      }),
      save: jest.fn(async (entityClass: unknown, data: unknown) => {
        if (entityClass === Project) return projectRepo.save!(data as never);
        if (entityClass === ProjectSecurityContext)
          return securityContextRepo.save!(data as never);
        return data;
      }),
      update: jest.fn(async () => ({ affected: 1 })),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    const dataSource = {
      transaction: jest.fn(async (fn: (em: unknown) => Promise<unknown>) =>
        fn(managerCalls),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: getRepositoryToken(Project), useValue: projectRepo },
        {
          provide: getRepositoryToken(ProjectBranchIngestion),
          useValue: branchIngestionRepo,
        },
        {
          provide: getRepositoryToken(ArchivedBranch),
          useValue: archivedBranchRepo,
        },
        {
          provide: getRepositoryToken(ProjectSecurityContext),
          useValue: securityContextRepo,
        },
        { provide: getRepositoryToken(Team), useValue: teamRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: DataPurgeLedger, useValue: purgeLedger },
        { provide: DataPurgeRunner, useValue: purgeRunner },
        {
          provide: AuthorizationService,
          useValue: {
            addProjectRelation: jest.fn().mockResolvedValue(undefined),
            removeProjectFromTeam: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: 'ANALYSIS_REPORTING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => ({}) },
        },
        {
          provide: 'EXTERNAL_INTEGRATIONS_SERVICE',
          useValue: { getService: () => ({}) },
        },
        { provide: 'AGENT_SERVICE', useValue: { getService: () => ({}) } },
        { provide: ENTITLEMENTS_PORT, useValue: entitlements },
        ...PROJECT_SETTINGS_COMMUNITY_BINDINGS,
        { provide: Logger, useValue: createLoggerMock() },
        { provide: RealtimeEventPublisher, useValue: realtimePublisher },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
    service.onModuleInit();
    void wrapGrpc;
  });

  it('creates a project with no plan limit', async () => {
    projectRepo.findOne!.mockResolvedValue(null);
    teamRepo.findOne!.mockResolvedValue({
      id: 't1',
      organization: { id: 'o1' },
    });
    projectRepo.count!.mockResolvedValue(0);
    userRepo.findOne!.mockResolvedValue({ id: 'u1' });
    projectRepo.save!.mockImplementation(async (p: any) => ({
      id: 'p2',
      ...p,
    }));

    const res = await service.createProject({
      name: 'P',
      teamId: 't1',
      creatorId: 'u1',
      product: 'appsec',
    } as any);

    // The community port answered projectLimit -1, mapped to +∞: the project
    // is saved without any RESOURCE_EXHAUSTED.
    expect(entitlements.getSubscription).toHaveBeenCalledWith('o1');
    expect(res.projectId).toBe('p2');
    expect(projectRepo.save).toHaveBeenCalled();
  });

  it('marks a project AppSec without a limit', async () => {
    projectRepo.findOne!.mockResolvedValue({
      id: 'p1',
      appsecEnabledAt: null, // not AppSec yet
      team: { id: 't1', organization: { id: 'o1' } },
    });
    // 499 AppSec projects already: this mark is the 500th.
    projectRepo.count!.mockResolvedValue(499);

    const res = await service.markProjectAppsec({ projectId: 'p1' } as any);

    expect(res).toEqual({
      appsec: true,
      alreadyAppsec: false,
      limitReached: false,
      projectLimit: -1,
      appsecProjectCount: 500,
    });
    // The conditional UPDATE writes appsecEnabledAt only on a project not yet
    // AppSec.
    expect(managerCalls.update).toHaveBeenCalledWith(
      Project,
      { id: 'p1', appsecEnabledAt: IsNull() },
      { appsecEnabledAt: expect.any(Date) },
    );
    expect(managerCalls.update.mock.calls[0][1].appsecEnabledAt).toBeInstanceOf(
      FindOperator,
    );
  });
});
