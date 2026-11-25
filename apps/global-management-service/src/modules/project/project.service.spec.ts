import { PROJECT_SETTINGS_COMMUNITY_BINDINGS } from 'src/edition/community/project-settings.binding';
import { of, Observable, throwError } from 'rxjs';
import { dialectApi } from '@cybedefend/db-dialect';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { Not } from 'typeorm';
import { ENTITLEMENTS_PORT } from 'src/edition/ports/entitlements.port';
import { status as grpcStatus } from '@grpc/grpc-js';
import { ProjectService } from './project.service';
import { Project } from 'src/entities/project.entity';
import { ProjectBranchIngestion } from 'src/entities/project-branch-ingestion.entity';
import { ArchivedBranch } from 'src/entities/archived-branch.entity';
import { Organization } from 'src/entities/organization.entity';
import {
  ProjectSecurityContext,
  ProjectEnvironment,
  InternetExposure,
  DeploymentType,
  DataClassification,
  BusinessCriticality,
  UserBaseSize,
  NetworkSegmentation,
} from 'src/entities/project-security-context.entity';
import { Team } from 'src/entities/team.entity';
import { User } from 'src/entities/user.entity';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from 'src/test-utils/typeorm-mock.util';
import { Logger } from 'nestjs-pino';
import { AuthorizationService } from '../authorization/authorization.service';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { DataPurgeLedger } from '../data-purge/data-purge.ledger';
import { DataPurgeRunner } from '../data-purge/data-purge.runner';
import {
  CapturedStatement,
  CaptureResponder,
  createSqlCaptureDataSource,
  rawRow,
  selectedAliases,
  selects,
} from 'src/test-utils/sql-capture.util';

describe('ProjectService', () => {
  let service: ProjectService;
  let projectRepo: MockType<any>;
  let branchIngestionRepo: MockType<any>;
  let archivedBranchRepo: MockType<any>;
  let securityContextRepo: MockType<any>;
  let teamRepo: MockType<any>;
  let userRepo: MockType<any>;
  let dataSource: {
    transaction: jest.Mock;
  };
  // Captures the calls made to the EntityManager passed into the
  // transaction callback. Tests can read this to assert ordering / lock
  // acquisition / count-inside-transaction guarantees.
  let managerCalls: {
    findOne: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let purgeLedger: { enqueueProject: jest.Mock };
  let purgeRunner: { kick: jest.Mock };
  // Concurrent count override used by the race-condition test. When set,
  // the EntityManager.count() returns this value instead of the
  // projectRepo.count default — letting us simulate a sibling tx that
  // already inserted a project while ours was waiting on the lock.
  let inTransactionProjectCountOverride: number | null;
  let realtimePublisher: { publish: jest.Mock };

  // Get, update and delete read the project with a QueryBuilder
  // getOne (findProjectWithTeamOrg). Its getOne answers the project the store
  // holds for the test.
  const projectRead = () =>
    projectRepo.createQueryBuilder!() as unknown as { getOne: jest.Mock };
  const storeProject = (project: unknown) =>
    projectRead().getOne.mockResolvedValue(project);

  const wrapGrpc = (payload: any = {}) => of(payload);
  const resultClient = {
    getVulnerabilitiesCount: jest.fn(() =>
      wrapGrpc({ critical: 0, high: 0, medium: 0, low: 0, analyses: [] }),
    ),
    getProjectRiskSummary: jest.fn(() =>
      wrapGrpc({
        projectId: 'p1',
        cyberRisk: { score: 0, level: 'none', computedAt: '' },
        detectedLanguages: [],
      }),
    ),
    getMainStatistics: jest.fn(() =>
      wrapGrpc({
        highRiskProjects: 0,
        highRiskProjectsInLast7Days: 0,
        solvedIssues: 0,
        solvedIssuesInLast7Days: 0,
        newIssues: 0,
        newIssuesInLast7Days: 0,
        criticalIssues: 0,
        highIssues: 0,
        mediumIssues: 0,
        lowIssues: 0,
      }),
    ),
    getOrganizationStatistics: jest.fn(() =>
      wrapGrpc({
        criticalRiskProjects: 0,
        criticalIssues: 0,
        highIssues: 0,
        newIssues: 0,
      }),
    ),
    deleteProjectVulnerabilityDetections: jest.fn(() => wrapGrpc({})),
    notifySecurityContextUpdated: jest.fn(() =>
      wrapGrpc({ success: true, message: 'ok' }),
    ),
    recomputeCyberRisk: jest.fn(() => wrapGrpc({ enqueued: true })),
    getBatchVulnerabilitiesCount: jest.fn(() => wrapGrpc({ counts: [] })),
  };
  const scanClient = {
    getLastScanStatus: jest.fn(() => wrapGrpc({ state: 'idle' })),
    getProjectsScanStatus: jest.fn(() => wrapGrpc({ statuses: [] })),
  };
  const ghClient = { deleteProject: jest.fn(() => wrapGrpc({})) };
  const glClient = { deleteProject: jest.fn(() => wrapGrpc({})) };
  const agentClient = { deleteProject: jest.fn(() => wrapGrpc({})) };
  const jiraClient = {
    removeProjectJiraConfig: jest.fn(() =>
      wrapGrpc({ success: true, message: 'ok' }),
    ),
  };
  const slackClient = {
    removeProjectChannel: jest.fn(() =>
      wrapGrpc({ success: true, message: 'ok' }),
    ),
  };
  const containerRegistryClient = {
    deleteProjectCredentials: jest.fn(() => wrapGrpc({ deletedCount: 0 })),
  };
  const projectIntegrationStatusClient = {
    getProjectIntegrationLinkStatus: jest.fn(() =>
      wrapGrpc({
        isGithubLinked: false,
        isGitlabLinked: false,
        isJiraLinked: false,
      }),
    ),
    getBatchProjectIntegrationLinkStatus: jest.fn(() =>
      wrapGrpc({ statuses: [], isJiraLinked: false }),
    ),
  };

  beforeEach(async () => {
    projectRepo = createMockRepository<Project>();
    branchIngestionRepo = createMockRepository<ProjectBranchIngestion>();
    archivedBranchRepo = createMockRepository<ArchivedBranch>();
    securityContextRepo = createMockRepository<ProjectSecurityContext>();
    teamRepo = createMockRepository<Team>();
    userRepo = createMockRepository<User>();
    realtimePublisher = { publish: jest.fn().mockResolvedValue(undefined) };

    inTransactionProjectCountOverride = null;
    // Mock DataSource.transaction so it invokes its callback with a fake
    // EntityManager that routes save() to the existing repo mocks based on
    // the entity class passed in. We additionally expose findOne / count
    // through `managerCalls` so tests can assert the quota check happens
    // INSIDE the transaction (and that the org row was locked with
    // pessimistic_write before counting).
    managerCalls = {
      findOne: jest.fn(async (entityClass: any) => {
        if (entityClass === Organization) {
          return { id: 'o1' };
        }
        return null;
      }),
      count: jest.fn(async (entityClass: any, opts: any) => {
        if (entityClass === Project) {
          if (inTransactionProjectCountOverride !== null) {
            return inTransactionProjectCountOverride;
          }
          return projectRepo.count!(opts);
        }
        return 0;
      }),
      save: jest.fn(async (entityClass: any, data: any) => {
        if (entityClass === Project) {
          return projectRepo.save!(data);
        }
        if (entityClass === ProjectSecurityContext) {
          return securityContextRepo.save!(data);
        }
        return data;
      }),
      update: jest.fn(async () => ({ affected: 1 })),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    purgeLedger = { enqueueProject: jest.fn(async () => 'job-1') };
    purgeRunner = { kick: jest.fn() };
    dataSource = {
      transaction: jest.fn(async (fn: any) => fn(managerCalls)),
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
          useValue: { getService: () => resultClient },
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: { getService: () => scanClient },
        },
        {
          provide: 'EXTERNAL_INTEGRATIONS_SERVICE',
          useValue: {
            getService: (serviceName: string) => {
              if (serviceName === 'GithubService') return ghClient;
              if (serviceName === 'GitlabService') return glClient;
              if (serviceName === 'JiraService') return jiraClient;
              if (serviceName === 'SlackService') return slackClient;
              if (serviceName === 'ProjectIntegrationStatusService')
                return projectIntegrationStatusClient;
              return containerRegistryClient;
            },
          },
        },
        {
          provide: ENTITLEMENTS_PORT,
          // The community answers of the port: no plan limit.
          useValue: {
            getSubscription: jest.fn(async () => ({ projectLimit: -1 })),
          },
        },
        ...PROJECT_SETTINGS_COMMUNITY_BINDINGS,
        {
          provide: 'AGENT_SERVICE',
          useValue: {
            // getService ignores service name and returns our mock client with needed methods
            getService: () => agentClient,
          },
        },
        {
          provide: Logger,
          useValue: createLoggerMock(),
        },
        {
          provide: RealtimeEventPublisher,
          useValue: realtimePublisher,
        },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
    service.onModuleInit();

    jest.clearAllMocks();
    // Restore defaults after clearAllMocks
    (scanClient.getLastScanStatus as jest.Mock).mockReturnValue(
      wrapGrpc({ state: 'idle' }),
    );
    (
      resultClient.deleteProjectVulnerabilityDetections as jest.Mock
    ).mockReturnValue(wrapGrpc({}));
    (resultClient.notifySecurityContextUpdated as jest.Mock).mockReturnValue(
      wrapGrpc({ success: true, message: 'ok' }),
    );
    (ghClient.deleteProject as jest.Mock).mockReturnValue(wrapGrpc({}));
    (glClient.deleteProject as jest.Mock).mockReturnValue(wrapGrpc({}));
    (jiraClient.removeProjectJiraConfig as jest.Mock).mockReturnValue(
      wrapGrpc({ success: true, message: 'ok' }),
    );
    (slackClient.removeProjectChannel as jest.Mock).mockReturnValue(
      wrapGrpc({ success: true, message: 'ok' }),
    );
    (
      containerRegistryClient.deleteProjectCredentials as jest.Mock
    ).mockReturnValue(wrapGrpc({ deletedCount: 0 }));
    (agentClient.deleteProject as jest.Mock).mockReturnValue(wrapGrpc({}));
  });

  it('getProject returns mapped project', async () => {
    storeProject({
      id: 'p1',
      name: 'P',
      team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    branchIngestionRepo.find!.mockResolvedValue([]);
    securityContextRepo.findOne!.mockResolvedValue(null);
    const res = await service.getProject({ projectId: 'p1' } as any);
    expect(res.projectId).toBe('p1');
    expect(res.teamName).toBe('T');
  });

  it('getProject maps parsedBranch status string enum to numeric gRPC enum', async () => {
    storeProject({
      id: 'p1',
      name: 'P',
      team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    branchIngestionRepo.find!.mockResolvedValue([
      {
        id: 'b1',
        projectId: 'p1',
        branch: 'main',
        status: 'parsed', // TypeORM string enum value
        lastParsedScanId: 'scan-1',
        lastParsedAt: new Date('2026-01-01'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    securityContextRepo.findOne!.mockResolvedValue(null);
    const res = await service.getProject({ projectId: 'p1' } as any);
    expect(res.parsedBranches).toHaveLength(1);
    // BRANCH_INGESTION_STATUS_PARSED = 2 (numeric protobuf enum)
    expect(res.parsedBranches[0].status).toBe(2);
  });

  // `Get` resolves the project's git default branch from the
  // integration-status RPC and exposes it so analysis-reporting can scope the
  // cyberisk score to the real default branch when no referenceBranch is set.
  it('getProject exposes the git default branch from the integration status', async () => {
    storeProject({
      id: 'p1',
      name: 'P',
      team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
      referenceBranch: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    branchIngestionRepo.find!.mockResolvedValue([]);
    securityContextRepo.findOne!.mockResolvedValue(null);
    (
      projectIntegrationStatusClient.getProjectIntegrationLinkStatus as jest.Mock
    ).mockReturnValueOnce(
      wrapGrpc({
        isGithubLinked: true,
        isGitlabLinked: false,
        isJiraLinked: false,
        defaultBranch: 'develop',
      }),
    );

    const res = await service.getProject({ projectId: 'p1' } as any);

    expect(res.defaultBranch).toBe('develop');
  });

  // The dashboard reads the linked repository's branches with this id instead
  // of listing every repository of the organization to find it.
  it('getProject exposes the linked repository from the integration status', async () => {
    storeProject({
      id: 'p1',
      name: 'P',
      team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    branchIngestionRepo.find!.mockResolvedValue([]);
    securityContextRepo.findOne!.mockResolvedValue(null);
    (
      projectIntegrationStatusClient.getProjectIntegrationLinkStatus as jest.Mock
    ).mockReturnValueOnce(
      wrapGrpc({
        isGithubLinked: true,
        isGitlabLinked: false,
        isJiraLinked: false,
        defaultBranch: 'main',
        linkedRepository: { provider: 'github', repositoryId: 'gh-row' },
      }),
    );

    const res = await service.getProject({ projectId: 'p1' } as any);

    expect(res.linkedRepository).toEqual({
      provider: 'github',
      repositoryId: 'gh-row',
    });
  });

  it('getProject has no linked repository when the project is not linked', async () => {
    storeProject({
      id: 'p1',
      name: 'P',
      team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    branchIngestionRepo.find!.mockResolvedValue([]);
    securityContextRepo.findOne!.mockResolvedValue(null);

    const res = await service.getProject({ projectId: 'p1' } as any);

    expect(res.linkedRepository).toBeUndefined();
  });

  // Linear is organisation-scoped like Jira: external-integrations
  // answers whether the organisation holds a Linear connection.
  it('getProject exposes isLinearLinked from the link status', async () => {
    storeProject({
      id: 'p1',
      name: 'P',
      team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    branchIngestionRepo.find!.mockResolvedValue([]);
    securityContextRepo.findOne!.mockResolvedValue(null);
    (
      projectIntegrationStatusClient.getProjectIntegrationLinkStatus as jest.Mock
    ).mockReturnValueOnce(
      wrapGrpc({
        isGithubLinked: false,
        isGitlabLinked: false,
        isJiraLinked: false,
        isLinearLinked: true,
      }),
    );

    const res = await service.getProject({ projectId: 'p1' } as any);

    expect(res.isLinearLinked).toBe(true);
    expect(res.isJiraLinked).toBe(false);
  });

  it('isLinearLinked is false when the status read fails', async () => {
    storeProject({
      id: 'p1',
      name: 'P',
      team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    branchIngestionRepo.find!.mockResolvedValue([]);
    securityContextRepo.findOne!.mockResolvedValue(null);
    (
      projectIntegrationStatusClient.getProjectIntegrationLinkStatus as jest.Mock
    ).mockReturnValueOnce(
      new Observable((subscriber) => subscriber.error(new Error('down'))),
    );

    const res = await service.getProject({ projectId: 'p1' } as any);

    expect(res.isLinearLinked).toBe(false);
    expect(res.isJiraLinked).toBe(false);
  });

  // The second product's surface switch and the assistant flag are settings
  // of closed features: the community answer carries neither, whatever the
  // row holds.
  it('getProject answers no closed setting of the row', async () => {
    storeProject({
      id: 'p1',
      name: 'P',
      team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
      createdAt: new Date(),
      updatedAt: new Date(),
      vibedefendEnabled: false,
      securityChampionEnabled: true,
    });
    branchIngestionRepo.find!.mockResolvedValue([]);
    securityContextRepo.findOne!.mockResolvedValue(null);
    const res = await service.getProject({ projectId: 'p1' } as any);
    expect(res).not.toHaveProperty('vibedefendEnabled');
    expect(res).not.toHaveProperty('securityChampionEnabled');
  });

  it('getProject returns the persisted scanOnCommitEnabled value (false)', async () => {
    storeProject({
      id: 'p1',
      name: 'P',
      team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
      createdAt: new Date(),
      updatedAt: new Date(),
      scanOnCommitEnabled: false,
    });
    branchIngestionRepo.find!.mockResolvedValue([]);
    securityContextRepo.findOne!.mockResolvedValue(null);
    const res = await service.getProject({ projectId: 'p1' } as any);
    expect(res.scanOnCommitEnabled).toBe(false);
  });

  // Rows created before the migration have no column value; the mapper must
  // fail open (scan on commit stays on) rather than silently stop scanning.
  it('getProject defaults scanOnCommitEnabled to true when unset', async () => {
    storeProject({
      id: 'p1',
      name: 'P',
      team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    branchIngestionRepo.find!.mockResolvedValue([]);
    securityContextRepo.findOne!.mockResolvedValue(null);
    const res = await service.getProject({ projectId: 'p1' } as any);
    expect(res.scanOnCommitEnabled).toBe(true);
  });

  // ProjectService/Get is the project page's read, and almost
  // every internal caller reads only the project's own settings. The full read
  // now takes the score and languages from GetProjectRiskSummary, and internal
  // callers opt out of what they do not read.
  describe('getProject reads', () => {
    const fullEntity = () => ({
      id: 'p1',
      name: 'Payments',
      team: { id: 't1', name: 'Team', organization: { id: 'o1', name: 'Org' } },
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
      sastEnabled: true,
      iacEnabled: true,
      scaEnabled: true,
      secretEnabled: true,
      aibomEnabled: true,
      containerEnabled: true,
      sastFastScanEnabled: true,
      sastSeverities: ['critical', 'high'],
      iacSeverities: ['high'],
      scaSeverities: ['critical'],
      secretSeverities: ['medium'],
      containerSeverities: ['low'],
      scaDevelopmentDependenciesEnabled: true,
      scaTransitiveDependenciesEnabled: true,
      improvingResultsEnabled: true,
      securityChampionEnabled: true,
      scaReachabilityPriorityEnabled: false,
      scaReachabilityStatusEnabled: false,
      scanOnCommitEnabled: false,
      referenceBranch: 'develop',
      diffScanMinSeverity: 'high',
    });
    const parsedRow = {
      id: 'b1',
      projectId: 'p1',
      branch: 'develop',
      status: 'parsed',
      lastParsedScanId: 's1',
      lastParsedAt: new Date('2026-01-03'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // The tracing wrapper adds a metadata argument: read the request only.
    const requestOf = (fn: unknown) => (fn as jest.Mock).mock.calls[0]?.[0];
    let logger: { warn: jest.Mock; debug: jest.Mock };
    const lean = {
      skipVulnerabilityStats: true,
      skipIntegrationStatus: true,
      skipSecurityContext: true,
    };

    beforeEach(() => {
      storeProject(fullEntity());
      branchIngestionRepo.find!.mockResolvedValue([parsedRow]);
      securityContextRepo.findOne!.mockResolvedValue(null);
      logger = (service as any).logger;
    });

    it('takes the score and languages from GetProjectRiskSummary, not from the vulnerability counts', async () => {
      (resultClient.getProjectRiskSummary as jest.Mock).mockReturnValueOnce(
        wrapGrpc({
          projectId: 'p1',
          cyberRisk: { score: 37, level: 'high', computedAt: 'x' },
          detectedLanguages: ['Go', 'Python'],
        }),
      );

      const res = await service.getProject({ projectId: 'p1' });

      expect(requestOf(resultClient.getProjectRiskSummary)).toEqual({
        projectId: 'p1',
      });
      expect(resultClient.getVulnerabilitiesCount).not.toHaveBeenCalled();
      expect(res.cyberRiskScore).toBe(37);
      expect(res.cyberRiskLevel).toBe('high');
      expect(res.detectedLanguages).toEqual(['Go', 'Python']);
    });

    it('falls back to GetVulnerabilitiesCount when analysis-reporting predates GetProjectRiskSummary (UNIMPLEMENTED)', async () => {
      (resultClient.getProjectRiskSummary as jest.Mock).mockReturnValueOnce(
        throwError(() => ({
          code: grpcStatus.UNIMPLEMENTED,
          details: 'The server does not implement the method',
        })),
      );
      (resultClient.getVulnerabilitiesCount as jest.Mock).mockReturnValueOnce(
        wrapGrpc({
          critical: 1,
          high: 0,
          medium: 0,
          low: 0,
          analyses: [],
          cyberRisk: { score: 9, level: 'medium', computedAt: 'x' },
          detectedLanguages: ['Java'],
        }),
      );

      const res = await service.getProject({ projectId: 'p1' });

      expect(requestOf(resultClient.getVulnerabilitiesCount)).toEqual({
        projectId: 'p1',
      });
      expect(res.cyberRiskScore).toBe(9);
      expect(res.cyberRiskLevel).toBe('medium');
      expect(res.detectedLanguages).toEqual(['Java']);
      // The fallback is expected during a rollout: traced, not warned.
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('GetVulnerabilitiesCount'),
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('warns with the gRPC code when the fallback fails too', async () => {
      (resultClient.getProjectRiskSummary as jest.Mock).mockReturnValueOnce(
        throwError(() => ({
          code: grpcStatus.UNIMPLEMENTED,
          details: 'The server does not implement the method',
        })),
      );
      (resultClient.getVulnerabilitiesCount as jest.Mock).mockReturnValueOnce(
        throwError(() => ({
          code: grpcStatus.DEADLINE_EXCEEDED,
          details: 'slow',
        })),
      );

      const res = await service.getProject({ projectId: 'p1' });

      expect(res.cyberRiskScore).toBe(0);
      expect(res.detectedLanguages).toEqual([]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(`p1.*gRPC code ${grpcStatus.DEADLINE_EXCEEDED}`),
        ),
      );
    });

    it('answers no score on any other analysis-reporting failure, without a second call', async () => {
      (resultClient.getProjectRiskSummary as jest.Mock).mockReturnValueOnce(
        throwError(() => ({ code: grpcStatus.UNAVAILABLE, details: 'down' })),
      );

      const res = await service.getProject({ projectId: 'p1' });

      expect(resultClient.getVulnerabilitiesCount).not.toHaveBeenCalled();
      expect(res.cyberRiskScore).toBe(0);
      expect(res.cyberRiskLevel).toBe('none');
      expect(res.detectedLanguages).toEqual([]);
      expect(res.name).toBe('Payments');
      // Not silent: the score reads 0 on the project page, say why.
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(`p1.*gRPC code ${grpcStatus.UNAVAILABLE}`),
        ),
      );
    });

    it('without option, still reads the score, the integration status and the security context', async () => {
      await service.getProject({ projectId: 'p1' });

      expect(resultClient.getProjectRiskSummary).toHaveBeenCalledTimes(1);
      expect(
        requestOf(
          projectIntegrationStatusClient.getProjectIntegrationLinkStatus,
        ),
      ).toEqual({ projectId: 'p1', organizationId: 'o1' });
      expect(securityContextRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('lean read: no call to analysis-reporting, external-integrations nor security-scanning, no security context read', async () => {
      const res = await service.getProject({ projectId: 'p1', ...lean });

      expect(resultClient.getProjectRiskSummary).not.toHaveBeenCalled();
      expect(resultClient.getVulnerabilitiesCount).not.toHaveBeenCalled();
      expect(
        projectIntegrationStatusClient.getProjectIntegrationLinkStatus,
      ).not.toHaveBeenCalled();
      expect(scanClient.getLastScanStatus).not.toHaveBeenCalled();
      expect(securityContextRepo.findOne).not.toHaveBeenCalled();
      // Only the project row and its branch ingestions are read.
      expect(projectRead().getOne).toHaveBeenCalledTimes(1);
      expect(branchIngestionRepo.find).toHaveBeenCalledTimes(1);
      // What was skipped reads as absent, not as an error.
      expect(res.cyberRiskScore).toBe(0);
      expect(res.detectedLanguages).toEqual([]);
      expect(res.isGithubLinked).toBe(false);
      expect(res.defaultBranch).toBeUndefined();
      expect(res.securityContext).toBeUndefined();
    });

    it('integration status kept (defaultBranch): external-integrations only', async () => {
      (
        projectIntegrationStatusClient.getProjectIntegrationLinkStatus as jest.Mock
      ).mockReturnValueOnce(
        wrapGrpc({
          // Both link flags set: /branches/list reads each of them, so a
          // value equal to the default would prove nothing.
          isGithubLinked: true,
          isGitlabLinked: true,
          isJiraLinked: false,
          defaultBranch: 'trunk',
        }),
      );

      const res = await service.getProject({
        projectId: 'p1',
        skipVulnerabilityStats: true,
        skipSecurityContext: true,
      });

      expect(
        projectIntegrationStatusClient.getProjectIntegrationLinkStatus,
      ).toHaveBeenCalledTimes(1);
      expect(resultClient.getProjectRiskSummary).not.toHaveBeenCalled();
      expect(resultClient.getVulnerabilitiesCount).not.toHaveBeenCalled();
      expect(securityContextRepo.findOne).not.toHaveBeenCalled();
      expect(res.defaultBranch).toBe('trunk');
      expect(res.isGithubLinked).toBe(true);
      expect(res.isGitlabLinked).toBe(true);
      expect(res.referenceBranch).toBe('develop');
      expect(res.organizationId).toBe('o1');
    });

    // The fields each migrated caller reads, all served by the lean read: a
    // caller moved to it by mistake would read 0, false or [] without error.
    it.each([
      [
        'security-scanning getProjectInformation (createScan, startScan, queued and container paths)',
        [
          'sastEnabled',
          'iacEnabled',
          'scaEnabled',
          'secretEnabled',
          'containerEnabled',
          'sastSeverities',
          'iacSeverities',
          'scaSeverities',
          'secretSeverities',
          'containerSeverities',
          'sastFastScanEnabled',
          'scaDevelopmentDependenciesEnabled',
          'scaTransitiveDependenciesEnabled',
          'organizationId',
          'scaReachabilityPriorityEnabled',
          'scaReachabilityStatusEnabled',
          'parsedBranches',
        ],
      ],
      [
        'external-integrations push webhooks',
        ['scanOnCommitEnabled', 'sastEnabled', 'iacEnabled', 'scaEnabled'],
      ],
      [
        'analysis-reporting processScaBatch',
        ['scaReachabilityPriorityEnabled', 'scaReachabilityStatusEnabled'],
      ],
      ['analysis-reporting sca-autofix', ['organizationId']],
      ['analysis-reporting report project name', ['name']],
      ['policy-management (GM before teamId)', ['teamId']],
      [
        'gateway scan starts',
        [
          'sastEnabled',
          'iacEnabled',
          'scaEnabled',
          'secretEnabled',
          'diffScanMinSeverity',
        ],
      ],
    ])('lean read serves what %s reads', async (_caller, fields) => {
      const entity = fullEntity();
      const res = await service.getProject({ projectId: 'p1', ...lean });

      const expected: Record<string, unknown> = {
        ...entity,
        organizationId: 'o1',
        teamId: 't1',
        parsedBranches: [
          expect.objectContaining({ branch: 'develop', status: 2 }),
        ],
      };
      for (const field of fields as string[]) {
        expect({ [field]: res[field] }).toEqual({ [field]: expected[field] });
      }
    });
  });

  // `findOne` with relations makes TypeORM run a
  // `SELECT DISTINCT distinctAlias` pre-query before the read itself (it pages
  // the joined rows to honour the implicit `take: 1`). The project, its team and
  // its organization are many-to-one: one row, which one SELECT reads. These
  // tests run the real TypeORM SQL against a recording query runner.
  describe('project read in one SELECT', () => {
    let statements: CapturedStatement[];
    let setResponder: (next: CaptureResponder) => void;
    // The stored row, by column alias of the read (the QueryBuilder aliases are
    // project / team / organization) or, failing that, by column name.
    const storedRow: Record<string, unknown> = {
      project_id: 'p1',
      project_name: 'Payments',
      team_id: 't1',
      team_name: 'Team',
      organization_id: 'o1',
      organization_name: 'Org',
      id: 'p1',
      name: 'Payments',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    };
    const lean = {
      skipVulnerabilityStats: true,
      skipIntegrationStatus: true,
      skipSecurityContext: true,
    };

    beforeEach(async () => {
      const capture = await createSqlCaptureDataSource((s) =>
        /^\s*SELECT/i.test(s.sql) ? [rawRow(s.sql, storedRow)] : [],
      );
      statements = capture.statements;
      setResponder = capture.setResponder;
      const real = capture.dataSource.getRepository(Project);
      projectRepo.findOne = jest.fn((options) => real.findOne(options));
      projectRepo.createQueryBuilder = jest.fn((alias?: string) =>
        real.createQueryBuilder(alias),
      );
      projectRepo.save!.mockImplementation(async (entity) => entity);
      branchIngestionRepo.find!.mockResolvedValue([]);
      securityContextRepo.findOne!.mockResolvedValue(null);
    });

    it('getProject reads the project, its team and its organization with one SELECT', async () => {
      const res = await service
        .getProject({ projectId: 'p1', ...lean })
        .catch(() => undefined);

      expect(selects(statements)).toHaveLength(1);
      const [read] = selects(statements);
      expect(read.sql).not.toMatch(/DISTINCT/);
      expect(read.sql).toMatch(/LEFT JOIN `team`/);
      expect(read.sql).toMatch(/LEFT JOIN `organization`/);
      expect(read.params).toEqual(['p1']);
      expect(res).toMatchObject({
        projectId: 'p1',
        name: 'Payments',
        teamId: 't1',
        teamName: 'Team',
        organizationId: 'o1',
      });
    });

    it('getProject still answers NOT_FOUND for an unknown project', async () => {
      setResponder(() => []);

      const thrown = await service
        .getProject({ projectId: 'unknown', ...lean })
        .catch((e) => e);

      expect(thrown).toBeInstanceOf(RpcException);
      expect(thrown.getError()).toEqual({
        code: grpcStatus.NOT_FOUND,
        message: 'Project not found',
      });
      expect(selects(statements)).toHaveLength(1);
    });

    it('updateProject reads the project with one SELECT before saving it', async () => {
      const res = await service
        .updateProject({ projectId: 'p1', applicationType: 'web' } as any)
        .catch(() => undefined);

      expect(selects(statements)).toHaveLength(1);
      expect(selects(statements)[0].sql).not.toMatch(/DISTINCT/);
      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'p1',
          applicationType: 'web',
          team: expect.objectContaining({
            id: 't1',
            organization: expect.objectContaining({ id: 'o1' }),
          }),
        }),
      );
      expect(res?.success).toBe(true);
    });

    // A rename adds one read: is the name free in the project's team?
    it('updateProject renaming reads the project, then checks the name in its team', async () => {
      // The name check finds no other project.
      setResponder((s) =>
        /^\s*SELECT/i.test(s.sql) && !s.params.includes('Renamed')
          ? [rawRow(s.sql, storedRow)]
          : [],
      );

      const res = await service
        .updateProject({ projectId: 'p1', name: 'Renamed' } as any)
        .catch(() => undefined);

      expect(selects(statements)).toHaveLength(2);
      const [read, nameCheck] = selects(statements);
      expect(read.sql).not.toMatch(/DISTINCT/);
      expect(nameCheck.params).toEqual(
        expect.arrayContaining(['Renamed', 't1', 'p1']),
      );
      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'p1',
          name: 'Renamed',
          team: expect.objectContaining({
            id: 't1',
            organization: expect.objectContaining({ id: 'o1' }),
          }),
        }),
      );
      expect(res?.success).toBe(true);
    });

    it('deleteProject reads the project with one SELECT', async () => {
      (scanClient.getLastScanStatus as jest.Mock).mockReturnValue(
        of({ state: 'running' }),
      );

      const thrown = await service
        .deleteProject({ projectId: 'p1' } as any)
        .catch((e) => e);

      expect(selects(statements)).toHaveLength(1);
      expect(selects(statements)[0].sql).not.toMatch(/DISTINCT/);
      // The read succeeded: the refusal is the running scan's, not NOT_FOUND.
      expect(thrown.getError()).toMatchObject({
        code: grpcStatus.FAILED_PRECONDITION,
      });
    });
  });

  it('updateProject updates booleans and arrays', async () => {
    storeProject({
      id: 'p1',
      team: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    projectRepo.save!.mockImplementation(async (p: any) => p);
    const res = await service.updateProject({
      projectId: 'p1',
      name: 'NP',
      sastEnabled: true,
      scaEnabled: true,
      iacEnabled: false,
      containerEnabled: false,
      sastSeverities: ['high'],
      scaSeverities: ['low'],
      iacSeverities: ['medium'],
      containerSeverities: ['critical'],
    } as any);
    expect(res.success).toBe(true);
  });

  // The issue-creation branches are a repeated field: an empty list cannot be
  // told from an absent one, and every caller that does not mean to touch the
  // setting (a scan updating lastScanSourceType, a PATCH of another field)
  // sends one. Clearing is therefore explicit.
  describe('updateProject issue-creation branches', () => {
    const stored = () => ({
      id: 'p1',
      team: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      issueCreationBranches: ['main', 'release'],
    });

    beforeEach(() => {
      projectRepo.save!.mockImplementation(async (p: any) => p);
    });

    it('keeps the stored branches when the update carries an empty list', async () => {
      storeProject(stored());

      await service.updateProject({
        projectId: 'p1',
        lastScanSourceType: 'github',
        issueCreationBranches: [],
      } as any);

      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ issueCreationBranches: ['main', 'release'] }),
      );
    });

    it('replaces the stored branches with a non-empty list', async () => {
      storeProject(stored());

      await service.updateProject({
        projectId: 'p1',
        issueCreationBranches: ['develop'],
      } as any);

      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ issueCreationBranches: ['develop'] }),
      );
    });

    it('clears the stored branches only when asked explicitly', async () => {
      storeProject(stored());

      await service.updateProject({
        projectId: 'p1',
        issueCreationBranches: [],
        clearIssueCreationBranches: true,
      } as any);

      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ issueCreationBranches: null }),
      );
    });
  });

  // The CI/CD agent categories are a repeated field too, with a default set at
  // creation: an empty list cannot mean "disable", or the first scan of a
  // project (which sends one) switches the CI/CD analysis off.
  describe('updateProject CI/CD agent categories', () => {
    const stored = () => ({
      id: 'p1',
      team: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      agentCategoriesCicd: ['cicd_security'],
    });

    beforeEach(() => {
      projectRepo.save!.mockImplementation(async (p: any) => p);
    });

    it('keeps the stored categories when the update carries an empty list', async () => {
      storeProject(stored());

      await service.updateProject({
        projectId: 'p1',
        lastScanSourceType: 'github',
        agentCategoriesCicd: [],
      } as any);

      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ agentCategoriesCicd: ['cicd_security'] }),
      );
    });

    it('replaces the stored categories with a non-empty list, normalised', async () => {
      storeProject(stored());

      await service.updateProject({
        projectId: 'p1',
        agentCategoriesCicd: [' Secrets_Exposure ', 'secrets_exposure'],
      } as any);

      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ agentCategoriesCicd: ['secrets_exposure'] }),
      );
    });

    it('disables the CI/CD analysis only when asked explicitly', async () => {
      storeProject(stored());

      await service.updateProject({
        projectId: 'p1',
        agentCategoriesCicd: [],
        clearAgentCategoriesCicd: true,
      } as any);

      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ agentCategoriesCicd: null }),
      );
    });

    it('refuses a list of blank categories instead of disabling the analysis', async () => {
      storeProject(stored());

      const thrown = await service
        .updateProject({ projectId: 'p1', agentCategoriesCicd: ['  '] } as any)
        .catch((e) => e);

      expect(thrown).toBeInstanceOf(RpcException);
      expect(thrown.getError()).toMatchObject({
        code: grpcStatus.INVALID_ARGUMENT,
      });
      expect(projectRepo.save).not.toHaveBeenCalled();
    });
  });

  // A rename follows the rule of creation: two projects of a team never share
  // a name. The check is in the service because the gateway is not its only
  // caller.
  describe('updateProject rename', () => {
    beforeEach(() => {
      storeProject({
        id: 'p1',
        name: 'Payments',
        team: { id: 't1', organization: { id: 'o1' } },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      projectRepo.save!.mockImplementation(async (p: any) => p);
    });

    it('refuses a name another project of the team already uses', async () => {
      projectRepo.findOne!.mockResolvedValue({ id: 'p2', name: 'Billing' });

      const thrown = await service
        .updateProject({ projectId: 'p1', name: 'Billing' } as any)
        .catch((e) => e);

      expect(thrown).toBeInstanceOf(RpcException);
      expect(thrown.getError()).toMatchObject({
        code: grpcStatus.ALREADY_EXISTS,
      });
      expect(projectRepo.findOne).toHaveBeenCalledWith({
        where: { name: 'Billing', team: { id: 't1' }, id: Not('p1') },
      });
      expect(projectRepo.save).not.toHaveBeenCalled();
    });

    it('accepts a name no other project of the team uses', async () => {
      projectRepo.findOne!.mockResolvedValue(null);

      const res = await service.updateProject({
        projectId: 'p1',
        name: 'Billing',
      } as any);

      expect(res.success).toBe(true);
      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Billing' }),
      );
    });

    it('does not look for a duplicate when the name is unchanged', async () => {
      await service.updateProject({ projectId: 'p1', name: 'Payments' } as any);

      expect(projectRepo.findOne).not.toHaveBeenCalled();
      expect(projectRepo.save).toHaveBeenCalled();
    });
  });

  // Scan-on-commit: opting a VCS-linked project out of the automatic scan that
  // fires on every push. Defaults to enabled, so an absent column (rows created
  // before the migration) must still read back as true.
  it('updateProject updates scanOnCommitEnabled when provided', async () => {
    storeProject({
      id: 'p1',
      team: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      scanOnCommitEnabled: true,
    });
    projectRepo.save!.mockImplementation(async (p: any) => p);
    const res = await service.updateProject({
      projectId: 'p1',
      scanOnCommitEnabled: false,
    } as any);
    expect(res.projectInformations?.scanOnCommitEnabled).toBe(false);
  });

  it('updateProject leaves scanOnCommitEnabled unchanged when not provided', async () => {
    storeProject({
      id: 'p1',
      team: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      scanOnCommitEnabled: false,
    });
    projectRepo.save!.mockImplementation(async (p: any) => p);
    const res = await service.updateProject({
      projectId: 'p1',
      name: 'NP',
    } as any);
    expect(res.projectInformations?.scanOnCommitEnabled).toBe(false);
  });

  // The CyberRisk score is branch-scoped, so changing a project's
  // reference branch makes the persisted score stale and MUST trigger a recompute
  // in analysis-reporting. global-management owns referenceBranch, so it fires the
  // recompute RPC (best-effort) when the normalized value actually changes.
  it('updateProject triggers a CyberRisk recompute when referenceBranch changes', async () => {
    storeProject({
      id: 'p1',
      team: {},
      referenceBranch: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    projectRepo.save!.mockImplementation(async (p: any) => p);

    await service.updateProject({
      projectId: 'p1',
      referenceBranch: 'develop',
    } as any);

    expect(resultClient.recomputeCyberRisk).toHaveBeenCalledWith(
      {
        projectId: 'p1',
        trigger: 'reference_branch_update',
      },
      expect.anything(),
    );
  });

  it('updateProject does NOT recompute CyberRisk when referenceBranch is unchanged', async () => {
    storeProject({
      id: 'p1',
      team: {},
      referenceBranch: 'main',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    projectRepo.save!.mockImplementation(async (p: any) => p);

    await service.updateProject({
      projectId: 'p1',
      referenceBranch: 'main',
    } as any);

    expect(resultClient.recomputeCyberRisk).not.toHaveBeenCalled();
  });

  it('updateProject does NOT recompute CyberRisk when referenceBranch is not part of the update', async () => {
    storeProject({
      id: 'p1',
      team: {},
      referenceBranch: 'main',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    projectRepo.save!.mockImplementation(async (p: any) => p);

    await service.updateProject({ projectId: 'p1', name: 'NP' } as any);

    expect(resultClient.recomputeCyberRisk).not.toHaveBeenCalled();
  });

  // The reference branch reached the SQL of the project-list counts.
  // The gateway refuses a malformed one; this service refuses it too, for any
  // caller that does not go through the gateway's DTO.
  describe('updateProject reference branch format', () => {
    beforeEach(() => {
      storeProject({
        id: 'p1',
        team: {},
        referenceBranch: 'main',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      projectRepo.save!.mockImplementation(async (p: any) => p);
    });

    it.each([
      ['an apostrophe', "main' OR '1'='1"],
      ['a double quote', 'ma"in'],
      ['a backslash', 'ma\\in'],
      ['two consecutive dots', 'feature/..'],
      ['a control character', 'ma\u0000in'],
      ['more than 191 characters', 'b'.repeat(192)],
    ])(
      'refuses a reference branch with %s and saves nothing',
      async (_case, referenceBranch) => {
        const thrown = await service
          .updateProject({ projectId: 'p1', referenceBranch } as any)
          .catch((e) => e);

        expect(thrown).toBeInstanceOf(RpcException);
        expect(thrown.getError()).toMatchObject({
          code: grpcStatus.INVALID_ARGUMENT,
        });
        expect(projectRepo.save).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['feature/x.y', 'feature/x.y'],
      ['  release-1.2  ', 'release-1.2'],
      ['', null],
    ])('stores the reference branch %p as %p', async (input, stored) => {
      const res = await service.updateProject({
        projectId: 'p1',
        referenceBranch: input,
      } as any);

      expect(res.success).toBe(true);
      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ referenceBranch: stored }),
      );
    });
  });

  it('deleteProject forbids when scan running', async () => {
    storeProject({
      id: 'p1',
      team: { id: 't1', organization: { id: 'o1' } },
    });
    (scanClient.getLastScanStatus as any).mockReturnValue(
      of({ state: 'running' }),
    );
    await expect(
      service.deleteProject({ projectId: 'p1' } as any),
    ).rejects.toBeInstanceOf(RpcException);
  });

  // ========== Security Context Tests ==========

  it('getProjectSecurityContext returns context for existing project', async () => {
    const ctx: Partial<ProjectSecurityContext> = {
      id: 'ctx1',
      projectId: 'p1',
      environment: ProjectEnvironment.PRODUCTION,
      internetExposure: InternetExposure.PUBLIC,
      deploymentType: DeploymentType.SAAS,
      dataClassification: DataClassification.CONFIDENTIAL,
      handlesPii: false,
      handlesPaymentData: false,
      businessCriticality: BusinessCriticality.MEDIUM,
      userBaseSize: UserBaseSize.MEDIUM,
      complianceFrameworks: [],
      safetyCritical: false,
      networkSegmentation: NetworkSegmentation.FLAT,
      isCustomized: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    securityContextRepo.findOne!.mockResolvedValue(ctx);
    const res = await service.getProjectSecurityContext({ projectId: 'p1' });
    expect(res.securityContext).toBeDefined();
    expect(res.securityContext!.projectId).toBe('p1');
  });

  it('getProjectSecurityContext throws NOT_FOUND when missing', async () => {
    securityContextRepo.findOne!.mockResolvedValue(null);
    await expect(
      service.getProjectSecurityContext({ projectId: 'p999' }),
    ).rejects.toBeInstanceOf(RpcException);
  });

  it('updateProjectSecurityContext updates only provided fields', async () => {
    const existingCtx: Partial<ProjectSecurityContext> = {
      id: 'ctx1',
      projectId: 'p1',
      environment: ProjectEnvironment.PRODUCTION,
      internetExposure: InternetExposure.PUBLIC,
      deploymentType: DeploymentType.SAAS,
      dataClassification: DataClassification.CONFIDENTIAL,
      handlesPii: false,
      handlesPaymentData: false,
      businessCriticality: BusinessCriticality.MEDIUM,
      userBaseSize: UserBaseSize.MEDIUM,
      complianceFrameworks: [],
      safetyCritical: false,
      networkSegmentation: NetworkSegmentation.FLAT,
      isCustomized: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    securityContextRepo.findOne!.mockResolvedValue({ ...existingCtx });
    securityContextRepo.save!.mockImplementation(async (c: any) => c);

    const res = await service.updateProjectSecurityContext({
      projectId: 'p1',
      environment: 3, // DEVELOPMENT in proto enum
    } as any);

    expect(res.success).toBe(true);
    expect(securityContextRepo.save).toHaveBeenCalled();
    const saved = securityContextRepo.save!.mock.calls[0][0];
    expect(saved.environment).toBe(ProjectEnvironment.DEVELOPMENT);
    expect(saved.isCustomized).toBe(true);
    // Unchanged field should stay the same
    expect(saved.internetExposure).toBe(InternetExposure.PUBLIC);
  });

  // ========== Dirty-check: avoid bumping updatedAt on no-op updates ==========

  const customizedCtx = (): Partial<ProjectSecurityContext> => ({
    id: 'ctx1',
    projectId: 'p1',
    environment: ProjectEnvironment.PRODUCTION,
    internetExposure: InternetExposure.PUBLIC,
    deploymentType: DeploymentType.SAAS,
    dataClassification: DataClassification.CONFIDENTIAL,
    handlesPii: false,
    handlesPaymentData: false,
    businessCriticality: BusinessCriticality.MEDIUM,
    userBaseSize: UserBaseSize.MEDIUM,
    complianceFrameworks: ['GDPR', 'HIPAA'],
    safetyCritical: false,
    networkSegmentation: NetworkSegmentation.FLAT,
    isCustomized: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('updateProjectSecurityContext skips save and notify when no semantic field changes', async () => {
    securityContextRepo.findOne!.mockResolvedValue(customizedCtx());
    securityContextRepo.save!.mockImplementation(async (c: any) => c);

    const res = await service.updateProjectSecurityContext({
      projectId: 'p1',
      environment: 1, // PRODUCTION (same)
      internetExposure: 1, // PUBLIC (same)
      handlesPii: false, // same
    } as any);

    expect(res.success).toBe(true);
    expect(securityContextRepo.save).not.toHaveBeenCalled();
    expect(resultClient.notifySecurityContextUpdated).not.toHaveBeenCalled();
  });

  it('updateProjectSecurityContext saves and notifies when a semantic field actually changes', async () => {
    securityContextRepo.findOne!.mockResolvedValue(customizedCtx());
    securityContextRepo.save!.mockImplementation(async (c: any) => c);

    await service.updateProjectSecurityContext({
      projectId: 'p1',
      internetExposure: 2, // INTERNAL (different)
    } as any);

    expect(securityContextRepo.save).toHaveBeenCalledTimes(1);
    expect(resultClient.notifySecurityContextUpdated).toHaveBeenCalledWith(
      { projectId: 'p1' },
      expect.anything(),
    );
  });

  it('updateProjectSecurityContext treats reordered complianceFrameworks as no-op', async () => {
    securityContextRepo.findOne!.mockResolvedValue(customizedCtx());
    securityContextRepo.save!.mockImplementation(async (c: any) => c);

    await service.updateProjectSecurityContext({
      projectId: 'p1',
      complianceFrameworks: ['HIPAA', 'GDPR'], // same set, reordered
    } as any);

    expect(securityContextRepo.save).not.toHaveBeenCalled();
    expect(resultClient.notifySecurityContextUpdated).not.toHaveBeenCalled();
  });

  it('updateProjectSecurityContext saves when isCustomized transitions from false to true', async () => {
    // Defaults (factory) context: never customized yet. User opens wizard and saves
    // without changing any semantic field. The transition false→true is a real
    // state change and must trigger save + notify so downstream consumers know
    // the context is now explicitly user-confirmed.
    const fresh = { ...customizedCtx(), isCustomized: false };
    securityContextRepo.findOne!.mockResolvedValue(fresh);
    securityContextRepo.save!.mockImplementation(async (c: any) => c);

    await service.updateProjectSecurityContext({
      projectId: 'p1',
      environment: 1, // PRODUCTION (same)
    } as any);

    expect(securityContextRepo.save).toHaveBeenCalledTimes(1);
    const saved = securityContextRepo.save!.mock.calls[0][0];
    expect(saved.isCustomized).toBe(true);
    expect(resultClient.notifySecurityContextUpdated).toHaveBeenCalledWith(
      { projectId: 'p1' },
      expect.anything(),
    );
  });

  it('getProject includes securityContext in response', async () => {
    const ctx: Partial<ProjectSecurityContext> = {
      id: 'ctx1',
      projectId: 'p1',
      environment: ProjectEnvironment.STAGING,
      internetExposure: InternetExposure.INTERNAL,
      deploymentType: DeploymentType.ONPREM,
      dataClassification: DataClassification.REGULATED,
      handlesPii: true,
      handlesPaymentData: true,
      businessCriticality: BusinessCriticality.MISSION_CRITICAL,
      userBaseSize: UserBaseSize.LARGE,
      complianceFrameworks: ['SOC2', 'GDPR'],
      safetyCritical: true,
      networkSegmentation: NetworkSegmentation.MICROSEGMENTED,
      isCustomized: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    storeProject({
      id: 'p1',
      name: 'P',
      team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    branchIngestionRepo.find!.mockResolvedValue([]);
    securityContextRepo.findOne!.mockResolvedValue(ctx);

    const res = await service.getProject({ projectId: 'p1' } as any);
    expect(res.securityContext).toBeDefined();
    expect(res.securityContext!.environment).toBeDefined();
    expect(res.securityContext!.isCustomized).toBe(true);
  });

  describe('deleteProject records a purge job', () => {
    const baseProject = {
      id: 'p1',
      team: { id: 't1', organization: { id: 'o1' } },
    };
    // The transaction the deletes and the job insert share: a callback that
    // throws rolls it back, so nothing it wrote is kept.
    let tx: { committed: boolean; rolledBack: boolean };

    beforeEach(() => {
      storeProject(baseProject);
      tx = { committed: false, rolledBack: false };
      dataSource.transaction.mockImplementation(async (fn: any) => {
        try {
          const result = await fn(managerCalls);
          tx.committed = true;
          return result;
        } catch (err) {
          tx.rolledBack = true;
          throw err;
        }
      });
    });

    it('deleting a project records its purge job in the same transaction as the deletes', async () => {
      const result = await service.deleteProject({ projectId: 'p1' } as any);

      expect(result.message).toContain('p1');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(tx.committed).toBe(true);
      expect(managerCalls.delete).toHaveBeenCalledWith(ProjectBranchIngestion, {
        projectId: 'p1',
      });
      expect(managerCalls.delete).toHaveBeenCalledWith(Project, 'p1');
      expect(purgeLedger.enqueueProject).toHaveBeenCalledWith(managerCalls, {
        projectId: 'p1',
        organizationId: 'o1',
      });
      // The job is inserted after the rows it stands for are deleted.
      expect(
        purgeLedger.enqueueProject.mock.invocationCallOrder[0],
      ).toBeGreaterThan(
        Math.max(...managerCalls.delete.mock.invocationCallOrder),
      );
      // Nothing is deleted outside that transaction.
      expect(projectRepo.delete).not.toHaveBeenCalled();
      expect(branchIngestionRepo.delete).not.toHaveBeenCalled();
    });

    it('kicks the purge runner with its job once the transaction is committed', async () => {
      // Recorded here, asserted below: the service's own try/catch around
      // the kick would swallow a failing expect.
      let committedAtKick: boolean | null = null;
      purgeRunner.kick.mockImplementation(() => {
        committedAtKick = tx.committed;
      });

      await service.deleteProject({ projectId: 'p1' } as any);

      expect(purgeRunner.kick).toHaveBeenCalledTimes(1);
      // Never inside the transaction: a failing kick cannot undo it.
      expect(committedAtKick).toBe(true);
      expect(purgeRunner.kick).toHaveBeenCalledWith(['job-1']);
    });

    it('a kick that throws never undoes the deletion', async () => {
      purgeRunner.kick.mockImplementation(() => {
        throw new Error('runner down');
      });

      const result = await service.deleteProject({ projectId: 'p1' } as any);

      expect(result.message).toContain('p1');
      expect(tx.committed).toBe(true);
    });

    it('a failing job insert rejects the call and keeps the project', async () => {
      purgeLedger.enqueueProject.mockRejectedValue(
        new Error('ER_LOCK_DEADLOCK'),
      );

      await expect(
        service.deleteProject({ projectId: 'p1' } as any),
      ).rejects.toThrow('ER_LOCK_DEADLOCK');

      expect(tx.rolledBack).toBe(true);
      expect(tx.committed).toBe(false);
      expect(purgeRunner.kick).not.toHaveBeenCalled();
      expect(projectRepo.delete).not.toHaveBeenCalled();
      expect(realtimePublisher.publish).not.toHaveBeenCalled();
    });

    it('a failing Permify removal deletes nothing and enqueues nothing', async () => {
      const authz = (service as any).authorizationService;
      authz.removeProjectFromTeam.mockRejectedValueOnce(
        new Error('permify down'),
      );

      const thrown = await service
        .deleteProject({ projectId: 'p1' } as any)
        .catch((e) => e);

      expect(thrown.getError()).toMatchObject({ code: grpcStatus.INTERNAL });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(managerCalls.delete).not.toHaveBeenCalled();
      expect(purgeLedger.enqueueProject).not.toHaveBeenCalled();
    });

    it('a scan in progress deletes nothing and enqueues nothing', async () => {
      (scanClient.getLastScanStatus as jest.Mock).mockReturnValue(
        of({ state: 'queued' }),
      );

      await expect(
        service.deleteProject({ projectId: 'p1' } as any),
      ).rejects.toBeInstanceOf(RpcException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(purgeLedger.enqueueProject).not.toHaveBeenCalled();
    });

    it('no longer calls the downstream services directly', async () => {
      branchIngestionRepo.find!.mockResolvedValue([
        { projectId: 'p1', branch: 'main' },
      ]);

      await service.deleteProject({ projectId: 'p1' } as any);
      // Drain anything a setImmediate could still have scheduled.
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setTimeout(r, 20));

      expect(
        resultClient.deleteProjectVulnerabilityDetections,
      ).not.toHaveBeenCalled();
      expect(ghClient.deleteProject).not.toHaveBeenCalled();
      expect(glClient.deleteProject).not.toHaveBeenCalled();
      expect(jiraClient.removeProjectJiraConfig).not.toHaveBeenCalled();
      expect(slackClient.removeProjectChannel).not.toHaveBeenCalled();
      expect(
        containerRegistryClient.deleteProjectCredentials,
      ).not.toHaveBeenCalled();
      expect(agentClient.deleteProject).not.toHaveBeenCalled();
    });

    it('still announces the deletion once it is committed', async () => {
      await service.deleteProject({ projectId: 'p1' } as any);

      expect(realtimePublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PROJECT_STATE_CHANGED',
          scope: { organizationId: 'o1', projectId: 'p1' },
          payload: {
            projectStateChanged: { projectId: 'p1', changeType: 'deleted' },
          },
        }),
      );
    });
  });

  describe('realtime events', () => {
    it('updateProject publishes PROJECT_STATE_CHANGED with changeType updated', async () => {
      storeProject({
        id: 'p1',
        team: { id: 't1', organization: { id: 'o1' } },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      projectRepo.save!.mockImplementation(async (p: any) => p);

      await service.updateProject({ projectId: 'p1', name: 'NewName' } as any);

      expect(realtimePublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PROJECT_STATE_CHANGED',
          scope: expect.objectContaining({ projectId: 'p1' }),
          payload: expect.objectContaining({
            projectStateChanged: expect.objectContaining({
              changeType: 'updated',
            }),
          }),
        }),
      );
    });
  });

  describe('getProjectsOrganization — tri par CybeRisk score', () => {
    const ENTITY = (id: string, name: string) => ({
      id,
      name,
      referenceBranch: '',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
    });

    const callList = (pageSizeNumber = 10, pageNumber = 1) =>
      service.getProjectsOrganization({
        teamId: 'o1',
        userId: 'u1',
        pageNumber,
        pageSizeNumber,
        searchQuery: '',
      } as any);

    beforeEach(() => {
      branchIngestionRepo.find!.mockResolvedValue([]);
    });

    it('orders by the denormalized cyberRiskScore DESC, then name ASC, id ASC — in SQL', async () => {
      const qb = projectRepo.createQueryBuilder!();
      // The database returns the page already ordered; the service must not
      // re-sort in memory. Hand back a pre-ordered slice + the org total.
      (qb.getManyAndCount as jest.Mock).mockResolvedValue([
        [ENTITY('p2', 'Bravo'), ENTITY('p3', 'Charlie'), ENTITY('p1', 'Alpha')],
        3,
      ]);

      const res = await callList();

      // Sort key + deterministic tiebreak are pushed down to SQL.
      expect(qb.orderBy).toHaveBeenCalledWith('project.cyberRiskScore', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('project.name', 'ASC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('project.id', 'ASC');
      // Output preserves the DB order verbatim.
      expect(res.projects.map((p: any) => p.projectId)).toEqual([
        'p2',
        'p3',
        'p1',
      ]);
      expect(res.totalProjects).toBe(3);
    });

    it('paginates in SQL via skip/take (page-bounded, no whole-org fetch)', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getManyAndCount as jest.Mock).mockResolvedValue([
        [ENTITY('p2', 'Bravo'), ENTITY('p3', 'Charlie')],
        5,
      ]);

      const res = await callList(2, 2); // page 2, size 2

      expect(qb.skip).toHaveBeenCalledWith(2); // (2 - 1) * 2
      expect(qb.take).toHaveBeenCalledWith(2);
      expect(res.projects.map((p: any) => p.projectId)).toEqual(['p2', 'p3']);
      expect(res.totalProjects).toBe(5);
      expect(res.totalPages).toBe(3); // ceil(5 / 2)
    });

    // The pills of the list are counted on the branches the CybeRisk is
    // scoped on, which analysis-reporting resolves from each project's
    // reference branch and git default branch. A project without a reference
    // branch must still be sent its default branch, or it would be counted on
    // every branch.
    it("asks the counts with every project's reference and git default branch", async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getManyAndCount as jest.Mock).mockResolvedValue([
        [
          ENTITY('p1', 'Alpha'),
          { ...ENTITY('p2', 'Bravo'), referenceBranch: 'release' },
        ],
        2,
      ]);
      projectIntegrationStatusClient.getBatchProjectIntegrationLinkStatus.mockReturnValueOnce(
        wrapGrpc({
          statuses: [
            {
              projectId: 'p1',
              isGithubLinked: true,
              isGitlabLinked: false,
              defaultBranch: 'develop',
            },
            {
              projectId: 'p2',
              isGithubLinked: true,
              isGitlabLinked: false,
              defaultBranch: 'main',
            },
          ],
          isJiraLinked: false,
        }),
      );

      await callList();

      expect(resultClient.getBatchVulnerabilitiesCount).toHaveBeenCalledWith(
        {
          projectIds: ['p1', 'p2'],
          referenceBranches: [
            { projectId: 'p1', referenceBranch: '', defaultBranch: 'develop' },
            {
              projectId: 'p2',
              referenceBranch: 'release',
              defaultBranch: 'main',
            },
          ],
        },
        expect.anything(),
      );
    });

    it('still asks the counts when the git default branches cannot be read', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getManyAndCount as jest.Mock).mockResolvedValue([
        [ENTITY('p1', 'Alpha')],
        1,
      ]);
      projectIntegrationStatusClient.getBatchProjectIntegrationLinkStatus.mockReturnValueOnce(
        new Observable((subscriber) => subscriber.error(new Error('down'))),
      );

      const res = await callList();

      // analysis-reporting then falls back to main/master, never every branch.
      expect(resultClient.getBatchVulnerabilitiesCount).toHaveBeenCalledWith(
        {
          projectIds: ['p1'],
          referenceBranches: [
            { projectId: 'p1', referenceBranch: '', defaultBranch: '' },
          ],
        },
        expect.anything(),
      );
      expect(res.projects.map((p: any) => p.projectId)).toEqual(['p1']);
    });

    // Linear, like Jira, is organisation-scoped: one answer for the
    // whole batch, copied on every project of the page.
    it("the project lists expose the organisation's isLinearLinked", async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getManyAndCount as jest.Mock).mockResolvedValue([
        [ENTITY('p1', 'Alpha'), ENTITY('p2', 'Bravo')],
        2,
      ]);
      projectIntegrationStatusClient.getBatchProjectIntegrationLinkStatus.mockReturnValueOnce(
        wrapGrpc({
          statuses: [],
          isJiraLinked: false,
          isLinearLinked: true,
        }),
      );

      const res = await callList();

      expect(res.projects.map((p: any) => p.isLinearLinked)).toEqual([
        true,
        true,
      ]);
      expect(res.projects.map((p: any) => p.isJiraLinked)).toEqual([
        false,
        false,
      ]);
    });

    it('isLinearLinked is false on the list when the batch status read fails', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getManyAndCount as jest.Mock).mockResolvedValue([
        [ENTITY('p1', 'Alpha')],
        1,
      ]);
      projectIntegrationStatusClient.getBatchProjectIntegrationLinkStatus.mockReturnValueOnce(
        new Observable((subscriber) => subscriber.error(new Error('down'))),
      );

      const res = await callList();

      expect(res.projects.map((p: any) => p.isLinearLinked)).toEqual([false]);
    });

    it('returns an empty page (no fan-out) when the org has no projects', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getManyAndCount as jest.Mock).mockResolvedValue([[], 0]);

      const res = await callList();

      expect(res.projects).toEqual([]);
      expect(res.totalProjects).toBe(0);
      expect(res.totalPages).toBe(0);
    });
  });

  describe('getProjectsTeam — Linear link status', () => {
    const TEAM = {
      id: 't1',
      name: 'T',
      organization: { id: 'o1', name: 'O' },
      projects: [
        {
          id: 'p1',
          name: 'Alpha',
          referenceBranch: '',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          team: { id: 't1', name: 'T', organization: { id: 'o1', name: 'O' } },
        },
      ],
    };

    const callTeamList = () =>
      service.getProjectsTeam({
        teamId: 't1',
        userId: 'u1',
        pageNumber: 1,
        pageSizeNumber: 10,
        searchQuery: '',
      } as any);

    it("the project lists expose the organisation's isLinearLinked", async () => {
      teamRepo.findOne!.mockResolvedValue(TEAM);
      projectIntegrationStatusClient.getBatchProjectIntegrationLinkStatus.mockReturnValueOnce(
        wrapGrpc({
          statuses: [],
          isJiraLinked: false,
          isLinearLinked: true,
        }),
      );

      const res = await callTeamList();

      expect(res.projects.map((p: any) => p.isLinearLinked)).toEqual([true]);
      expect(res.projects.map((p: any) => p.isJiraLinked)).toEqual([false]);
    });

    it('isLinearLinked is false on the team list when the batch status read fails', async () => {
      teamRepo.findOne!.mockResolvedValue(TEAM);
      projectIntegrationStatusClient.getBatchProjectIntegrationLinkStatus.mockReturnValueOnce(
        new Observable((subscriber) => subscriber.error(new Error('down'))),
      );

      const res = await callTeamList();

      expect(res.projects.map((p: any) => p.isLinearLinked)).toEqual([false]);
    });
  });

  /**
   * The GRC findings export resolves the readable project set on EVERY page.
   * `getProjectsOrganization` is the dashboard home-page loader — one SELECT
   * plus a four-way fan-out (scan status, branch ingestion, batch vulnerability
   * counts back into analysis-reporting, integration link status) — and it is
   * capped at the caller's page size. Running it per page of 50 findings turns
   * a nightly compliance pull into org-wide load, and the cap silently drops
   * the projects past it. This projection exists so the export pays neither.
   */
  describe('getReadableProjectsInOrganization', () => {
    const call = (organizationId = 'o1', userId = 'u1') =>
      service.getReadableProjectsInOrganization({
        organizationId,
        userId,
      } as any);

    it('refuses without a principal rather than returning the whole org', async () => {
      for (const args of [
        ['o1', ''],
        ['', 'u1'],
      ] as const) {
        let thrown: any;
        await call(args[0], args[1]).catch((e) => {
          thrown = e;
        });
        expect(thrown).toBeInstanceOf(RpcException);
        expect(thrown.getError()).toMatchObject({
          code: grpcStatus.INVALID_ARGUMENT,
        });
      }
    });

    it('narrows to the organization AND to what the user may read', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getRawMany as jest.Mock).mockResolvedValue([]);

      await call();

      expect(qb.innerJoin).toHaveBeenCalledWith(
        'team.organization',
        'org',
        'org.id = :organizationId',
        { organizationId: 'o1' },
      );

      // The principal filter is a Brackets callback, so replay it and read the
      // conditions it emits: a narrowing that narrows nothing is the classic
      // vacuous guard.
      const brackets = (qb.andWhere as jest.Mock).mock.calls
        .map(([arg]) => arg)
        .find((arg) => typeof arg?.whereFactory === 'function');
      expect(brackets).toBeDefined();
      const emitted: string[] = [];
      brackets.whereFactory({
        where: (c: string) => emitted.push(c),
        orWhere: (c: string) => emitted.push(c),
      });
      expect(emitted.join(' | ')).toContain('users_organizations_members');
      expect(emitted.join(' | ')).toContain('teams_members');
      expect(qb.setParameters).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          privilegedRoles: ['creator', 'administrator'],
        }),
      );
    });

    // `referenceBranch` joined the projection so the GRC export can scope each
    // project to one branch. It is a plain column, so the point of this test —
    // that the narrow query fans out to NOBODY — is unchanged.
    it('selects a narrow column set and fans out to nobody', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getRawMany as jest.Mock).mockResolvedValue([
        { projectId: 'p1', name: 'API', referenceBranch: 'develop' },
        { projectId: 'p2', name: 'Web', referenceBranch: null },
      ]);

      const res = await call();

      expect(res.projects).toEqual([
        expect.objectContaining({
          projectId: 'p1',
          name: 'API',
          referenceBranch: 'develop',
        }),
        // null becomes '' on the wire: proto3 has no null, and the consumer's
        // cascade reads empty as "not configured".
        expect.objectContaining({
          projectId: 'p2',
          name: 'Web',
          referenceBranch: '',
        }),
      ]);
      expect(resultClient.getBatchVulnerabilitiesCount).not.toHaveBeenCalled();
      expect(scanClient.getProjectsScanStatus).not.toHaveBeenCalled();
      expect(
        projectIntegrationStatusClient.getBatchProjectIntegrationLinkStatus,
      ).not.toHaveBeenCalled();
      expect(branchIngestionRepo.find).not.toHaveBeenCalled();
    });

    it('is not paginated, so no project can fall off the end', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getRawMany as jest.Mock).mockResolvedValue([]);

      await call();

      expect(qb.skip).not.toHaveBeenCalled();
      expect(qb.take).not.toHaveBeenCalled();
    });

    it('tolerates a project with no name and no reference branch', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getRawMany as jest.Mock).mockResolvedValue([
        { projectId: 'p1', name: null, referenceBranch: null },
      ]);

      const res = await call();

      expect(res.projects).toEqual([
        {
          projectId: 'p1',
          name: '',
          referenceBranch: '',
          teamId: '',
          teamName: '',
        },
      ]);
    });

    // Two teams of an organisation may share a name: the second product's map keys
    // its teams by id, and the team row is already joined.
    it('carries the id of each project team', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getRawMany as jest.Mock).mockResolvedValue([
        {
          projectId: 'p1',
          name: 'API',
          referenceBranch: null,
          teamId: 't-1',
          teamName: 'Core',
          vibedefendEnabled: 1,
        },
        {
          projectId: 'p2',
          name: 'Web',
          referenceBranch: null,
          teamId: 't-2',
          teamName: 'Core',
          vibedefendEnabled: 1,
        },
      ]);

      const res = await call();

      expect(qb.addSelect).toHaveBeenCalledWith('team.id', 'teamId');
      expect(res.projects).toEqual([
        expect.objectContaining({
          projectId: 'p1',
          teamId: 't-1',
          teamName: 'Core',
        }),
        expect.objectContaining({
          projectId: 'p2',
          teamId: 't-2',
          teamName: 'Core',
        }),
      ]);
    });

    // The team name is on the row the query already joins. The edition's own
    // columns (none in the Community Edition) are neither selected nor
    // answered.
    it('carries the team name of each project, and no closed column', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getRawMany as jest.Mock).mockResolvedValue([
        {
          projectId: 'p1',
          name: 'API',
          referenceBranch: null,
          teamName: 'Platform',
        },
      ]);

      const res = await call();

      expect(qb.addSelect).toHaveBeenCalledWith('team.name', 'teamName');
      expect(
        (qb.addSelect as jest.Mock).mock.calls.map(
          ([expression]) => expression,
        ),
      ).not.toContain('project.vibedefendEnabled');
      expect(res.projects).toEqual([
        {
          projectId: 'p1',
          name: 'API',
          referenceBranch: '',
          teamId: '',
          teamName: 'Platform',
        },
      ]);
    });

    // The organization overview groups its projects by team and
    // filters them by team id. It used to read the team from the home-page
    // loader (GetAllFromOrganization and its fan-out); the id is on the team
    // row this query already joins, so it needs no other read.
    it('carries the team id of each project, from the same single SELECT', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getRawMany as jest.Mock).mockResolvedValue([
        { projectId: 'p1', name: 'API', teamId: 't1', teamName: 'Platform' },
        { projectId: 'p2', name: 'Web', teamId: null, teamName: null },
      ]);
      (projectRepo.createQueryBuilder as jest.Mock).mockClear();

      const res = await call();

      expect(projectRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(qb.getRawMany).toHaveBeenCalledTimes(1);
      expect(qb.addSelect).toHaveBeenCalledWith('team.id', 'teamId');
      expect(res.projects).toEqual([
        expect.objectContaining({
          projectId: 'p1',
          teamId: 't1',
          teamName: 'Platform',
        }),
        expect.objectContaining({ projectId: 'p2', teamId: '', teamName: '' }),
      ]);
    });
  });

  // Analysis-reporting's backfill pushes every persisted
  // score: the previous code read the whole projects (~110 columns, with their
  // team and organization) to compare one number, then wrote them one UPDATE
  // per changed project. These tests run the real TypeORM SQL against a
  // recording query
  // runner: 3 columns per batch of at most 100 projects, one UPDATE ... CASE
  // per batch.
  describe('setProjectCyberRiskScores', () => {
    let statements: CapturedStatement[];
    // projectId → [stored score, organization]
    let stored: Map<string, [number, string | null]>;
    // The id MySQL hands back for a pushed one, when it is not byte for byte
    // the pushed id: a _ci collation matches 'P1' with an IN ('p1').
    let returnedAs: Map<string, string>;
    const updates = () => statements.filter((s) => /^\s*UPDATE/i.test(s.sql));

    beforeEach(async () => {
      stored = new Map();
      returnedAs = new Map();
      const capture = await createSqlCaptureDataSource(({ sql, params }) => {
        if (/^\s*UPDATE/i.test(sql))
          return {
            affected: new Set(params.filter((p) => stored.has(String(p)))).size,
          };
        if (!/FROM `project`/.test(sql)) return [];
        return params
          .filter((p) => stored.has(String(p)))
          .map((pushed) => {
            const [score, organizationId] = stored.get(String(pushed));
            const id = returnedAs.get(String(pushed)) ?? pushed;
            return rawRow(sql, {
              id,
              project_id: id,
              Project_id: id,
              score,
              organizationId,
            });
          });
      });
      statements = capture.statements;
      const real = capture.dataSource.getRepository(Project);
      for (const method of ['find', 'update', 'createQueryBuilder'] as const) {
        projectRepo[method] = jest.fn((...args: unknown[]) =>
          (real[method] as (...a: unknown[]) => unknown).apply(real, args),
        );
      }
    });

    it('reads three columns per batch of at most 100 projects, no relation', async () => {
      const items = Array.from({ length: 250 }, (_, i) => ({
        projectId: `p${i}`,
        score: i,
      }));
      for (const { projectId } of items) stored.set(projectId, [0, 'org-1']);

      await service.setProjectCyberRiskScores({ items });

      const reads = selects(statements);
      expect(reads.map((r) => r.params.length)).toEqual([100, 100, 50]);
      for (const read of reads) {
        expect(selectedAliases(read.sql).sort()).toEqual([
          'id',
          'organizationId',
          'score',
        ]);
        expect(read.sql).not.toMatch(/`organization`/);
      }
    });

    it('writes the changed scores of a batch with one UPDATE ... CASE', async () => {
      stored.set('p1', [0, 'org-1']);
      stored.set('p2', [7, 'org-1']);
      stored.set('p3', [1, 'org-2']);

      const res = await service.setProjectCyberRiskScores({
        items: [
          { projectId: 'p1', score: 42 },
          { projectId: 'p2', score: 7 },
          { projectId: 'p3', score: 9 },
        ],
      });

      expect(updates()).toHaveLength(1);
      const [update] = updates();
      // db-dialect's MySQL text: the score is cast to an integer, so the
      // CASE is typed on PostgreSQL too.
      const score = dialectApi('mysql').castInt('?').text;
      expect(update.sql).toContain(
        `SET \`cyber_risk_score\` = CASE \`id\` WHEN ? THEN ${score} WHEN ? THEN ${score} ELSE \`cyber_risk_score\` END`,
      );
      // Only the changed rows are matched: the WHERE bounds the UPDATE to
      // them (without it, the ELSE branch would rewrite the whole table).
      expect(update.sql).toMatch(/ WHERE `id` IN \(\?, \?\)$/);
      // p2 is unchanged: neither in the CASE nor in the WHERE.
      expect(update.params).toEqual(['p1', 42, 'p3', 9, 'p1', 'p3']);
      expect(res.updated).toBe(2);
    });

    it('publishes a realtime event per changed score, scoped to its organization', async () => {
      stored.set('p1', [0, 'org-1']);
      stored.set('p2', [0, 'org-2']);

      await service.setProjectCyberRiskScores({
        items: [
          { projectId: 'p1', score: 42 },
          { projectId: 'p2', score: 7 },
        ],
      });

      // Home "/" project-list stream refresh: one PROJECT_STATE_CHANGED per
      // changed score, scoped to the project's organization.
      expect(realtimePublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PROJECT_STATE_CHANGED',
          scope: { organizationId: 'org-1', projectId: 'p1' },
          payload: {
            projectStateChanged: {
              projectId: 'p1',
              changeType: 'cyberrisk_updated',
            },
          },
        }),
      );
      expect(realtimePublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { organizationId: 'org-2', projectId: 'p2' },
        }),
      );
      expect(realtimePublisher.publish).toHaveBeenCalledTimes(2);
    });

    it('skips no-op updates: no DB write and no realtime event when unchanged', async () => {
      stored.set('p1', [42, 'org-1']);

      const res = await service.setProjectCyberRiskScores({
        items: [{ projectId: 'p1', score: 42 }],
      });

      expect(updates()).toHaveLength(0);
      expect(realtimePublisher.publish).not.toHaveBeenCalled();
      expect(res.updated).toBe(0);
    });

    it('skips items without a projectId, unknown projects, and defaults a missing score to 0', async () => {
      stored.set('p3', [5, 'org-1']);

      const res = await service.setProjectCyberRiskScores({
        items: [
          { projectId: '', score: 10 },
          { projectId: 'p3' },
          { projectId: 'gone', score: 4 },
        ],
      } as any);

      expect(updates()).toHaveLength(1);
      expect(updates()[0].params).toEqual(expect.arrayContaining(['p3', 0]));
      expect(updates()[0].params).not.toContain('gone');
      expect(res.updated).toBe(1);
    });

    it('never writes a NULL score for a row whose id is not the pushed one byte for byte', async () => {
      stored.set('p1', [0, 'org-1']);
      stored.set('p2', [0, 'org-1']);
      returnedAs.set('p1', 'P1');

      const res = await service.setProjectCyberRiskScores({
        items: [
          { projectId: 'p1', score: 42 },
          { projectId: 'p2', score: 7 },
        ],
      });

      // Only p2 is written: there is no score for 'P1', and a CASE branch
      // without one would set the NOT NULL column to NULL.
      expect(updates()).toHaveLength(1);
      const [update] = updates();
      expect(update.params).not.toContain('P1');
      expect(update.params).not.toContain(undefined);
      expect(update.params).not.toContain(null);
      expect(update.params).toEqual(['p2', 7, 'p2']);
      expect(res.updated).toBe(1);
      expect(realtimePublisher.publish).toHaveBeenCalledTimes(1);
    });

    it('returns updated=0 for an empty batch without touching the database', async () => {
      const res = await service.setProjectCyberRiskScores({ items: [] });

      expect(statements).toHaveLength(0);
      expect(res.updated).toBe(0);
    });
  });

  describe('getOrganizationMainStatistics', () => {
    it('reads the caller-scoped stats from analysis-reporting and maps them', async () => {
      resultClient.getOrganizationStatistics.mockReturnValueOnce(
        wrapGrpc({
          criticalRiskProjects: 3,
          criticalIssues: 12,
          highIssues: 2,
          newIssues: 5,
        }),
      );

      const res = await service.getOrganizationMainStatistics({
        organizationId: 'org-1',
        userId: 'u1',
      } as any);

      // The caller is forwarded: without it analysis-reporting serves the
      // organization-wide row, figures from projects the caller may not read.
      expect(
        (resultClient.getOrganizationStatistics as jest.Mock).mock.calls[0][0],
      ).toEqual({ organizationId: 'org-1', userId: 'u1' });
      expect(res.criticalRiskProjects).toBe(3);
      expect(res.criticalIssues).toBe(12);
      expect(res.highIssues).toBe(2);
      expect(res.newIssues).toBe(5);
    });

    it('maps a zeroed response (cold org)', async () => {
      resultClient.getOrganizationStatistics.mockReturnValueOnce(wrapGrpc({}));

      const res = await service.getOrganizationMainStatistics({
        organizationId: 'org-1',
        userId: 'u1',
      } as any);

      expect(res.criticalIssues).toBe(0);
      expect(res.criticalRiskProjects).toBe(0);
    });
  });

  describe('getOrganizationProjectIds', () => {
    it('returns every project ID in the org (system-scope, no user filter)', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getRawMany as jest.Mock).mockResolvedValue([
        { id: 'p1' },
        { id: 'p2' },
      ]);

      const res = await service.getOrganizationProjectIds({
        organizationId: 'org-1',
      } as any);

      expect(res.projectIds).toEqual(['p1', 'p2']);
    });
  });

  /**
   * `validate-plan-transition` answered 503 "dependency unavailable" for every
   * Developer target while Team worked. Nothing was down: billing-service has
   * no user context, so it called this RPC with `userId: ''`, which the guard
   * below rejects as INVALID_ARGUMENT — and billing's fail-closed catch
   * relabelled it as UNAVAILABLE, hiding the real cause.
   *
   * Passing a real userId would have been worse than the 503. The per-user
   * visibility filter counts only what THAT user can see, so an org with ten
   * projects reports two to a caller who sees two — and sails past the
   * Developer cap of three. A capacity check has to count everything.
   *
   * `orgWide` is opt-in rather than "empty userId means all": a caller that
   * simply forgets the userId keeps failing loudly instead of silently
   * receiving a different number.
   */
  describe('countProjectsInOrganization — org-wide capacity counting', () => {
    const ORG = 'org-1';

    // Billing's AppSec plan capacity check is the one org-wide caller: it
    // counts AppSec projects only (second-product projects
    // never weigh on the AppSec plan), still with no user filter.
    it('counts the AppSec projects when orgWide is set, with no user filter', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getCount as jest.Mock).mockResolvedValue(10);
      (qb.andWhere as jest.Mock).mockClear();

      const res = await service.countProjectsInOrganization({
        organizationId: ORG,
        userId: '',
        orgWide: true,
      });

      expect(res).toEqual({ totalProjects: 10 });
      const conditions = (qb.andWhere as jest.Mock).mock.calls;
      expect(conditions).toHaveLength(1);
      expect(conditions[0][0]).toBe('project.appsec_enabled_at IS NOT NULL');
    });

    it('still applies the per-user filter for a user-scoped count', async () => {
      const qb = projectRepo.createQueryBuilder!();
      (qb.getCount as jest.Mock).mockResolvedValue(2);
      (qb.andWhere as jest.Mock).mockClear();

      const res = await service.countProjectsInOrganization({
        organizationId: ORG,
        userId: 'user-1',
      });

      expect(res).toEqual({ totalProjects: 2 });
      expect(qb.andWhere as jest.Mock).toHaveBeenCalled();
    });

    it('still refuses a missing userId when the caller did not ask for org-wide', async () => {
      await expect(
        service.countProjectsInOrganization({
          organizationId: ORG,
          userId: '',
        }),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: grpcStatus.INVALID_ARGUMENT }),
      });
    });

    it('still refuses a missing organizationId, org-wide or not', async () => {
      await expect(
        service.countProjectsInOrganization({
          organizationId: '',
          userId: '',
          orgWide: true,
        }),
      ).rejects.toMatchObject({
        error: expect.objectContaining({ code: grpcStatus.INVALID_ARGUMENT }),
      });
    });
  });

  describe('a failed branch-archive statement', () => {
    // The caller (and through the gateway, the client) gets a stable message;
    // the statement's error, which can quote the branch name or other values,
    // is only logged, through the serializer.
    const VALUE = 'feature/private-value-7f3';
    const dbError = () =>
      new Error(`Duplicate entry 'p1-${VALUE}' for key 'archived_branch.UQ'`);

    it.each([
      [
        'archiveBranch',
        'findOne',
        () => service.archiveBranch({ projectId: 'p1', branchName: VALUE }),
      ],
      [
        'unarchiveBranch',
        'delete',
        () => service.unarchiveBranch({ projectId: 'p1', branchName: VALUE }),
      ],
      [
        'getArchivedBranches',
        'find',
        () => service.getArchivedBranches({ projectId: 'p1' }),
      ],
    ])(
      '%s answers INTERNAL with a stable message and logs the error',
      async (_name, method, call) => {
        archivedBranchRepo[method].mockRejectedValueOnce(dbError());
        const logger = (service as unknown as { logger: { error: jest.Mock } })
          .logger;

        const thrown = await (call as () => Promise<unknown>)().catch(
          (e: unknown) => e,
        );

        expect(thrown).toBeInstanceOf(RpcException);
        const answer = (thrown as RpcException).getError();
        expect(answer).toEqual(
          expect.objectContaining({ code: grpcStatus.INTERNAL }),
        );
        expect(JSON.stringify(answer)).not.toContain(VALUE);
        expect(JSON.stringify(answer)).not.toContain('Duplicate entry');
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
        );
      },
    );
  });
});
