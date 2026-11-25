import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrganizationOverviewService } from './organization-overview.service';
import { SastVulnerabilityDetections } from '../../entities/sast-vulnerability-detections.entity';
import { IacVulnerabilityDetections } from '../../entities/iac-vulnerability-detections.entity';
import { ScaVulnerabilityDetections } from '../../entities/sca-vulnerability-detections.entity';
import { VulnerabilityDetectionsContainer } from '../../entities/container_vulnerability_detections.entity';
import { CicdVulnerabilityDetections } from '../../entities/cicd-vulnerability-detections.entity';
import { SecretVulnerabilityDetections } from '../../entities/secret-vulnerability-detections.entity';
import { AutoFixRecord } from '../../entities/autofix-record.entity';
import { ScaDetectedPackages } from '../../entities/sca-detected-packages.entity';
import {
  MockType,
  createMockRepository,
} from '../../test-utils/typeorm-mock.util';
import {
  GetOrganizationOverviewRequest,
  OrganizationOverviewFilter,
} from '@grpc/analysis-reporting/result';
import { of } from 'rxjs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { ProjectCyberRiskRepository } from '../cyber-risk/repositories/project-cyber-risk.repository';
import { CyberiskRecomputeEnqueuer } from '../cyber-risk/cyberisk-recompute.enqueuer';
import { OverviewCacheService } from './overview-cache.service';

// Mock project data returned from GlobalManagement service
const mockProjectsResponse = {
  projects: [
    {
      projectId: 'project-1',
      name: 'Frontend App',
      teamId: 'team-1',
      teamName: 'Web Team',
    },
    {
      projectId: 'project-2',
      name: 'Backend API',
      teamId: 'team-1',
      teamName: 'Web Team',
    },
    {
      projectId: 'project-3',
      name: 'Mobile App',
      teamId: 'team-2',
      teamName: 'Mobile Team',
    },
  ],
};

describe('OrganizationOverviewService', () => {
  let service: OrganizationOverviewService;

  // Repositories
  let sastRepo: MockType<any>;
  let iacRepo: MockType<any>;
  let scaRepo: MockType<any>;
  let containerRepo: MockType<any>;
  let cicdRepo: MockType<any>;
  let secretRepo: MockType<any>;
  let autofixRepo: MockType<any>;

  // Mock gRPC client
  let mockGetAllFromOrganization: jest.Mock;
  let mockGetReadableProjects: jest.Mock;

  const provideRepo = (token: any, repo: MockType<any>) => ({
    provide: getRepositoryToken(token),
    useValue: repo,
  });

  beforeEach(async () => {
    // Initialize mocks
    sastRepo = createMockRepository();
    iacRepo = createMockRepository();
    scaRepo = createMockRepository();
    containerRepo = createMockRepository();
    cicdRepo = createMockRepository();
    secretRepo = createMockRepository();
    autofixRepo = createMockRepository();

    // Mock gRPC client for GlobalManagement service. The overview resolves
    // its scope through the readable-projects projection; the home-page
    // loader (getAllFromOrganization) is kept here only so a test can assert
    // that it is never called.
    mockGetAllFromOrganization = jest
      .fn()
      .mockReturnValue(of(mockProjectsResponse));
    mockGetReadableProjects = jest
      .fn()
      .mockReturnValue(of(mockProjectsResponse));

    const mockGlobalManagementClient = {
      getService: jest.fn().mockReturnValue({
        getAllFromOrganization: mockGetAllFromOrganization,
        getReadableProjectsInOrganization: mockGetReadableProjects,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationOverviewService,
        provideRepo(SastVulnerabilityDetections, sastRepo),
        provideRepo(IacVulnerabilityDetections, iacRepo),
        provideRepo(ScaVulnerabilityDetections, scaRepo),
        provideRepo(VulnerabilityDetectionsContainer, containerRepo),
        provideRepo(CicdVulnerabilityDetections, cicdRepo),
        provideRepo(SecretVulnerabilityDetections, secretRepo),
        provideRepo(AutoFixRecord, autofixRepo),
        {
          provide: getRepositoryToken(ScaDetectedPackages),
          useValue: {
            ...createMockRepository(),
            find: jest.fn().mockResolvedValue([]),
            createQueryBuilder: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              groupBy: jest.fn().mockReturnThis(),
              addGroupBy: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([]),
              getRawOne: jest.fn().mockResolvedValue(null),
              getCount: jest.fn().mockResolvedValue(0),
            }),
          },
        },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: mockGlobalManagementClient,
        },
        // Stub the persisted-score repo + backfill enqueuer so the
        // test doesn't need DB fixtures for the project_cyber_risk rows.
        {
          provide: ProjectCyberRiskRepository,
          useValue: {
            findByProjectId: jest.fn().mockResolvedValue(null),
            findByProjectIds: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: CyberiskRecomputeEnqueuer,
          useValue: { enqueue: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: OverviewCacheService,
          useValue: {
            getOrSet: jest.fn((_b, _o, _u, _p, _f, producer) => producer()),
            bumpGeneration: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(OrganizationOverviewService);
    // Manually call onModuleInit to initialize the gRPC client
    service.onModuleInit();
  });

  // Helper function to create a mock query builder
  const createMockQueryBuilder = (results: any[] = []) => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(results),
    getRawOne: jest.fn().mockResolvedValue(results[0] || null),
    getCount: jest.fn().mockResolvedValue(results.length),
  });

  describe('getOrganizationOverview', () => {
    beforeEach(() => {
      // Setup default mock behavior for all repositories
      const emptyResults: any[] = [];
      sastRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder(emptyResults));
      iacRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder(emptyResults));
      scaRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder(emptyResults));
      containerRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder(emptyResults));
      cicdRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder(emptyResults));
      secretRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder(emptyResults));
      autofixRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder(emptyResults));

      // Mock query method for raw SQL queries (used by optimized UNION ALL queries)
      sastRepo.query = jest.fn().mockResolvedValue([]);
      iacRepo.query = jest.fn().mockResolvedValue([]);
      scaRepo.query = jest.fn().mockResolvedValue([]);
      containerRepo.query = jest.fn().mockResolvedValue([]);
      cicdRepo.query = jest.fn().mockResolvedValue([]);
      secretRepo.query = jest.fn().mockResolvedValue([]);

      // Mock count methods
      sastRepo.count = jest.fn().mockResolvedValue(0);
      iacRepo.count = jest.fn().mockResolvedValue(0);
      scaRepo.count = jest.fn().mockResolvedValue(0);
      containerRepo.count = jest.fn().mockResolvedValue(0);
      cicdRepo.count = jest.fn().mockResolvedValue(0);
      secretRepo.count = jest.fn().mockResolvedValue(0);
    });

    it('should return organization overview with default parameters', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.organizationId).toBe('org-123');
      expect(result.totalProjects).toBeGreaterThanOrEqual(0);
      expect(result.totalByAnalysisType).toBeDefined();
    });

    it('should return empty response when no projects found', async () => {
      // Override mock to return empty projects
      mockGetReadableProjects.mockReturnValue(of({ projects: [] }));

      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result.totalProjects).toBe(0);
      expect(result.projectsSummary).toEqual([]);
      expect(result.teamsSummary).toEqual([]);
    });

    it('should filter by specific project IDs', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: ['project-1', 'project-2'],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.appliedFilters?.projectIds).toEqual([
        'project-1',
        'project-2',
      ]);
    });

    it('should filter by severity levels', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: ['CRITICAL', 'HIGH'],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.appliedFilters?.severityFilter).toContain('CRITICAL');
      expect(result.appliedFilters?.severityFilter).toContain('HIGH');
    });

    it('should filter by analysis types', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: ['SAST', 'SCA'],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.appliedFilters?.analysisTypes).toEqual(['SAST', 'SCA']);
    });

    it('should filter by date range', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        dateFrom: '2024-01-01T00:00:00Z',
        dateTo: '2024-12-31T23:59:59Z',
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.appliedFilters?.dateFrom).toBeDefined();
      expect(result.appliedFilters?.dateTo).toBeDefined();
    });

    it('should include resolved vulnerabilities when includeResolved is true', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        includeResolved: true,
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.appliedFilters?.includeResolved).toBe(true);
    });

    it('should apply pagination to projects summary', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        projectsPage: 1,
        projectsPageSize: 10,
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.projectsPagination).toBeDefined();
      expect(result.projectsPagination?.currentPage).toBe(1);
      expect(result.projectsPagination?.pageSize).toBe(10);
    });

    it('should apply pagination to teams summary', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        teamsPage: 1,
        teamsPageSize: 25,
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.teamsPagination).toBeDefined();
      expect(result.teamsPagination?.currentPage).toBe(1);
      expect(result.teamsPagination?.pageSize).toBe(25);
    });

    it('should limit top vulnerable projects', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        topVulnerableLimit: 5,
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.topVulnerableProjects.length).toBeLessThanOrEqual(5);
    });

    it('should include trend data when trendPeriodDays is set', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        trendPeriodDays: 30,
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.trendPeriodDays).toBe(30);
    });

    it('should include comparison data when comparisonPeriod is set', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        comparisonPeriod: 'week',
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
    });

    it('should exclude projects summary when includeProjectsSummary is false', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        includeProjectsSummary: false,
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.projectsSummary).toEqual([]);
    });

    it('should exclude teams summary when includeTeamsSummary is false', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        includeTeamsSummary: false,
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.teamsSummary).toEqual([]);
    });

    it('should exclude over time data when includeOverTimeData is false', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        includeOverTimeData: false,
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
    });

    it('should filter by team IDs', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: ['team-1'],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.appliedFilters?.teamIds).toEqual(['team-1']);
    });

    it('should ignore languages filter (deprecated - not relevant for org overview)', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: ['javascript', 'typescript'],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      // Languages filter is deprecated and ignored - should return empty
      expect(result.appliedFilters?.languages).toEqual([]);
    });

    it('should filter by branch', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: ['main'],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      // Branch filter is now active and filters vulnerabilities by branch
      expect(result.appliedFilters?.branches).toContain('main');
    });

    it('should search projects by name', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: 'Frontend',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      // The filtering should be applied
    });

    it('should search teams by name', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: 'Web',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      // The filtering should be applied
    });

    it('should return correct severity breakdown', async () => {
      // Mock severity aggregation results
      const severityResults = [
        { severity: 'CRITICAL', count: '5' },
        { severity: 'HIGH', count: '10' },
        { severity: 'MEDIUM', count: '15' },
        { severity: 'LOW', count: '20' },
      ];

      sastRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(createMockQueryBuilder(severityResults));

      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: ['SAST'],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
    });

    it('should return correct state breakdown', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
    });

    it('should return correct analysis type breakdown', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.totalByAnalysisType).toBeDefined();
    });

    it('should calculate risk distribution correctly', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(typeof result.highRiskProjects).toBe('number');
      expect(typeof result.mediumRiskProjects).toBe('number');
      expect(typeof result.lowRiskProjects).toBe('number');
    });

    it('should return language distribution', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.languageDistribution).toBeDefined();
      expect(Array.isArray(result.languageDistribution)).toBe(true);
    });

    it('should return vulnerabilities by branch', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      expect(result.vulnerabilitiesByBranch).toBeDefined();
      expect(Array.isArray(result.vulnerabilitiesByBranch)).toBe(true);
    });

    it('should calculate mean time to remediate', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
      // meanTimeToRemediate can be undefined if no resolved vulns
      expect(
        result.meanTimeToRemediate === undefined ||
          typeof result.meanTimeToRemediate === 'number',
      ).toBe(true);
    });

    it('should sort projects by total_vulnerabilities DESC by default', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        sortBy: 'total_vulnerabilities',
        sortOrder: 'DESC',
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
    });

    it('should sort projects by critical_count', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        sortBy: 'critical_count',
        sortOrder: 'DESC',
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
    });

    it('should sort projects by name ASC', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
        sortBy: 'name',
        sortOrder: 'ASC',
      };

      const result = await service.getOrganizationOverview(request);

      expect(result).toBeDefined();
    });

    it('generates project-level UNION ALL stats query compatible with only_full_group_by', async () => {
      // Regression: MySQL 8 with sql_mode=only_full_group_by rejected the query
      // because SELECT used UPPER(COALESCE(effective_severity, currentSeverity)) while
      // GROUP BY only used COALESCE(...) — every nonaggregated SELECT expression must
      // match a GROUP BY expression. Keep these two clauses textually equivalent.
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      await service.getOrganizationOverview(request);

      const projectStatsCalls = (sastRepo.query as jest.Mock).mock.calls.filter(
        ([sql]) =>
          typeof sql === 'string' &&
          sql.includes('as vulnType') &&
          sql.includes('as severity') &&
          sql.includes('as state'),
      );

      expect(projectStatsCalls.length).toBeGreaterThan(0);

      const sql: string = projectStatsCalls[0][0];
      const unionParts = sql.split(/\bUNION ALL\b/);
      expect(unionParts.length).toBeGreaterThan(0);

      for (const part of unionParts) {
        // Severity is now the live env-derived CASE wrapped in UPPER(...).
        // Capture it from the SELECT and require the GROUP BY to repeat it
        // verbatim (MySQL only_full_group_by).
        const selectMatch = part.match(
          /(UPPER\(\(CASE\b[\s\S]+?END\)\))\s+as\s+severity/i,
        );
        if (!selectMatch) continue;
        const severityExpr = selectMatch[1];
        // Must derive from the live env score, not the stale stored column.
        expect(severityExpr).toMatch(/cvss4_environmental_score/i);

        const groupByMatch = part.match(/GROUP BY\s+([\s\S]+?)(?:$|UNION)/i);
        expect(groupByMatch).not.toBeNull();
        expect(groupByMatch![1]).toContain(severityExpr);
      }
    });

    it('aggregates totalBySeverity by the live env-derived band, not the stored column', async () => {
      const request: GetOrganizationOverviewRequest = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        projectNameSearch: '',
        teamNameSearch: '',
        severityFilter: [],
        statusFilter: [],
        priorityFilter: [],
        analysisTypes: [],
        cyberRiskLevels: [],
        languages: [],
        branches: [],
      };

      await service.getOrganizationOverview(request);

      // The totalBySeverity aggregation selects "... as severity, COUNT(*) as
      // cnt" (and, unlike the project-level stats query, has no "as vulnType").
      const severityAggCalls = (sastRepo.query as jest.Mock).mock.calls.filter(
        ([sql]) =>
          typeof sql === 'string' &&
          /as\s+severity/i.test(sql) &&
          /as\s+cnt/i.test(sql) &&
          !/as\s+vulnType/i.test(sql),
      );
      expect(severityAggCalls.length).toBeGreaterThan(0);
      for (const [sql] of severityAggCalls) {
        // Derive the band live from the env/base CVSS scores, never the stale
        // effective_severity column (which showed 12 Critical for env-High rows).
        expect(sql).toMatch(/cvss4_environmental_score/i);
      }
    });
  });

  describe('split distribution endpoints', () => {
    const baseFilter = {
      organizationId: 'org-1',
      userId: 'user-1',
      projectIds: [],
      teamIds: [],
      severityFilter: [],
      statusFilter: [],
      analysisTypes: [],
      branches: [],
    };

    it('getOrganizationSeverityDistribution returns totalBySeverity', async () => {
      jest
        .spyOn(service as any, 'aggregateSeverityByProjects')
        .mockResolvedValue([{ severity: 'CRITICAL', count: 4 }]);

      const res = await service.getOrganizationSeverityDistribution({
        filter: baseFilter,
      } as any);

      expect(res.totalBySeverity).toEqual([{ severity: 'CRITICAL', count: 4 }]);
    });

    it('getOrganizationStateDistribution returns totalByState', async () => {
      jest
        .spyOn(service as any, 'aggregateStateByProjects')
        .mockResolvedValue([{ state: 'confirmed', count: 2 }]);

      const res = await service.getOrganizationStateDistribution({
        filter: baseFilter,
      } as any);

      expect(res.totalByState).toEqual([{ state: 'confirmed', count: 2 }]);
    });

    it('getOrganizationVulnerabilitiesOverTime returns the series', async () => {
      jest
        .spyOn(service as any, 'aggregateVulnerabilitiesOverTime')
        .mockResolvedValue([
          { date: '2026-06-01', severity: 'HIGH', count: 1 },
        ]);

      const res = await service.getOrganizationVulnerabilitiesOverTime({
        filter: baseFilter,
        trendPeriodDays: 30,
      } as any);

      expect(res.vulnerabilitiesOverTime).toEqual([
        { date: '2026-06-01', severity: 'HIGH', count: 1 },
      ]);
    });

    it('returns empty blocks when the org has no accessible projects', async () => {
      jest
        .spyOn(service as any, 'fetchOrganizationProjects')
        .mockResolvedValue([]);

      const res = await service.getOrganizationSeverityDistribution({
        filter: baseFilter,
      } as any);

      expect(res.totalBySeverity).toEqual([]);
    });
  });

  describe('main overview is slimmed', () => {
    beforeEach(() => {
      const emptyResults: any[] = [];
      const mockQb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(emptyResults),
        getRawOne: jest.fn().mockResolvedValue(null),
        getCount: jest.fn().mockResolvedValue(0),
      };
      for (const repo of [
        sastRepo,
        iacRepo,
        scaRepo,
        containerRepo,
        cicdRepo,
        secretRepo,
        autofixRepo,
      ]) {
        repo.createQueryBuilder = jest.fn().mockReturnValue(mockQb);
        repo.query = jest.fn().mockResolvedValue([]);
        repo.count = jest.fn().mockResolvedValue(0);
      }
    });

    it('keeps severity scalars but omits the 3 detailed arrays', async () => {
      const res = await service.getOrganizationOverview({
        organizationId: 'org-1',
        userId: 'user-1',
      } as any);

      expect(res).toHaveProperty('criticalIssues');
      expect(res).toHaveProperty('highIssues');
      expect(res).toHaveProperty('totalVulnerabilities');
      expect((res as any).totalBySeverity).toBeUndefined();
      expect((res as any).totalByState).toBeUndefined();
      expect((res as any).vulnerabilitiesOverTime).toBeUndefined();
      expect((res as any).severityComparison).toBeUndefined();
      expect((res as any).totalComparison).toBeUndefined();
      expect(res).toHaveProperty('totalByAnalysisType');
    });

    it('does not run the state or over-time aggregations on the main path', async () => {
      const stateSpy = jest.spyOn(service as any, 'aggregateStateByProjects');
      const overTimeSpy = jest.spyOn(
        service as any,
        'aggregateVulnerabilitiesOverTime',
      );

      await service.getOrganizationOverview({
        organizationId: 'org-1',
        userId: 'user-1',
      } as any);

      expect(stateSpy).not.toHaveBeenCalled();
      expect(overTimeSpy).not.toHaveBeenCalled();
    });
  });

  describe('New Issues trend excludes resolved/ignored/not_exploitable', () => {
    // The "New Issues" KPI (data.newIssuesLast7Days) used to count every
    // detection created in the window regardless of its current state, so
    // already resolved / not-exploitable / ignored findings inflated it far
    // past the open-vulnerability total. Every
    // new-issues count must exclude those states, exactly like
    // aggregateSeverityByProjects — unless includeResolved is set.
    const EXCLUDED = ['resolved', 'not_exploitable', 'ignored'];

    type RecorderCall = { sql: string; params?: any };
    type Recorder = { calls: RecorderCall[] };

    const makeRecorder = (bucket: Recorder[]) => {
      const rec: Recorder = { calls: [] };
      bucket.push(rec);
      const qb: any = {};
      qb.where = jest.fn((sql: string, params?: any) => {
        rec.calls.push({ sql, params });
        return qb;
      });
      qb.andWhere = jest.fn((sql: string, params?: any) => {
        rec.calls.push({ sql, params });
        return qb;
      });
      qb.getCount = jest.fn().mockResolvedValue(0);
      return qb;
    };

    const baseCtx = {
      projectIds: ['p1'],
      teamIds: [],
      severityFilter: [],
      statusFilter: [],
      analysisTypes: ['SAST'],
      branches: [],
      projectBranchMap: new Map(),
      trendPeriodDays: 7,
    };

    it('adds a currentState NOT IN exclusion to every new-issues query', async () => {
      const recorders: Recorder[] = [];
      sastRepo.createQueryBuilder = jest.fn(() => makeRecorder(recorders));
      sastRepo.count = jest.fn().mockResolvedValue(0);

      await (service as any).getTrendStatistics({
        ...baseCtx,
        includeResolved: false,
      });

      // Queries that filter by createdAt are the "new issues in period" counts.
      const newInPeriodQbs = recorders.filter((r) =>
        r.calls.some((c) => /\.createdAt\b/.test(c.sql)),
      );
      expect(newInPeriodQbs.length).toBeGreaterThan(0);
      for (const r of newInPeriodQbs) {
        const exclusion = r.calls.find((c) =>
          /currentState NOT IN/i.test(c.sql),
        );
        expect(exclusion).toBeDefined();
        expect(exclusion?.params?.excludedStates).toEqual(EXCLUDED);
      }

      // The all-time "total new" count (no createdAt filter) must exclude the
      // same states too, so the newIssues scalar stays consistent.
      const totalNewQb = recorders.find(
        (r) =>
          r.calls.some((c) => /currentState NOT IN/i.test(c.sql)) &&
          !r.calls.some((c) => /\.createdAt\b/.test(c.sql)),
      );
      expect(totalNewQb).toBeDefined();
    });

    it('counts every state for new issues when includeResolved is true', async () => {
      const recorders: Recorder[] = [];
      sastRepo.createQueryBuilder = jest.fn(() => makeRecorder(recorders));
      sastRepo.count = jest.fn().mockResolvedValue(0);

      await (service as any).getTrendStatistics({
        ...baseCtx,
        includeResolved: true,
      });

      const newInPeriodQbs = recorders.filter((r) =>
        r.calls.some((c) => /\.createdAt\b/.test(c.sql)),
      );
      expect(newInPeriodQbs.length).toBeGreaterThan(0);
      for (const r of newInPeriodQbs) {
        expect(r.calls.some((c) => /currentState NOT IN/i.test(c.sql))).toBe(
          false,
        );
      }
    });
  });

  describe('over-time severities are UPPERCASE (dashboard chart matches on UPPER)', () => {
    // effectiveSeveritySql() yields lowercase ('critical'/'high'/...). The
    // dashboard over-time chart only buckets severities in the UPPERCASE set
    // ["CRITICAL","HIGH","MEDIUM","LOW"], so a lowercase series is silently
    // dropped → a flat zero chart. Every sibling severity query wraps the
    // expression in UPPER(); the over-time created/resolved selects must too.
    const captureSeveritySelects = (): string[] => {
      const selects: string[] = [];
      const makeQb = () => {
        const qb: any = {};
        for (const m of [
          'select',
          'where',
          'andWhere',
          'groupBy',
          'addGroupBy',
          'orderBy',
          'addOrderBy',
        ]) {
          qb[m] = jest.fn().mockReturnValue(qb);
        }
        qb.addSelect = jest.fn((sql: string, alias?: string) => {
          if (alias === 'severity') selects.push(sql);
          return qb;
        });
        qb.getRawMany = jest.fn().mockResolvedValue([]);
        return qb;
      };
      for (const repo of [
        sastRepo,
        iacRepo,
        scaRepo,
        containerRepo,
        cicdRepo,
        secretRepo,
      ]) {
        repo.createQueryBuilder = jest.fn(() => makeQb());
      }
      return selects;
    };

    it('wraps the created/resolved over-time severity selects in UPPER(...)', async () => {
      const selects = captureSeveritySelects();

      await (service as any).aggregateVulnerabilitiesOverTime({
        projectIds: ['p1'],
        teamIds: [],
        severityFilter: [],
        statusFilter: [],
        analysisTypes: [],
        branches: [],
        projectBranchMap: new Map(),
        includeResolved: false,
        trendPeriodDays: 30,
      });

      // 6 types × (created + resolved) = 12 severity selects, all UPPER-wrapped.
      expect(selects.length).toBeGreaterThan(0);
      for (const sql of selects) {
        expect(sql).toMatch(/UPPER\(/);
      }
    });
  });

  describe('trend "new" counters exclude non-open states', () => {
    // The overview "Total vulnerabilities" card carries a 7-day trend badge.
    // The total counts only OPEN vulnerabilities (currentState NOT IN
    // resolved/not_exploitable/ignored — see aggregateSeverityByProjects), but
    // getTrendStatistics counted EVERY state as "new in the period". A freshly
    // scanned org therefore reported an increase larger than the total itself
    // (the reported case: a "+2054" badge against a 427 total). The "new"
    // counters must apply the same open-state filter the total uses.

    // A trend query builder whose getCount() reflects the WHERE clauses it was
    // handed: 2054 rows were created in the last period, but only 427 are still
    // in an open state.
    const ALL_NEW_IN_PERIOD = 2054;
    const OPEN_NEW_IN_PERIOD = 427;

    const makeTrendQb = () => {
      const conditions: string[] = [];
      const qb: any = {
        where: jest.fn((c: string) => {
          conditions.push(c);
          return qb;
        }),
        andWhere: jest.fn((c: string) => {
          conditions.push(c);
          return qb;
        }),
        getCount: jest.fn(async () => {
          const has = (frag: string) =>
            conditions.some((c) => c.includes(frag));
          // solved-in-period / solved-in-previous-period
          if (has('currentState IN')) return 0;
          // new-in-previous-period (bounded above by createdAt < periodStart)
          if (has('createdAt <')) return 0;
          // new-in-current-period
          if (has('createdAt >=')) {
            return has('currentState NOT IN')
              ? OPEN_NEW_IN_PERIOD
              : ALL_NEW_IN_PERIOD;
          }
          return 0;
        }),
      };
      return qb;
    };

    const baseCtx = {
      projectIds: ['p1'],
      teamIds: [],
      severityFilter: [],
      statusFilter: [],
      analysisTypes: [] as string[],
      branches: [] as string[],
      projectBranchMap: new Map<string, string[]>(),
      includeResolved: false,
      trendPeriodDays: 7,
    };

    beforeEach(() => {
      // Only SAST carries data; the other types answer 0 to every trend query.
      sastRepo.createQueryBuilder = jest.fn(() => makeTrendQb());
      sastRepo.count = jest.fn().mockResolvedValue(0);
      for (const repo of [
        iacRepo,
        scaRepo,
        containerRepo,
        cicdRepo,
        secretRepo,
      ]) {
        repo.createQueryBuilder = jest.fn(() => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getCount: jest.fn().mockResolvedValue(0),
        }));
        repo.count = jest.fn().mockResolvedValue(0);
      }
    });

    it('counts only currently-open vulnerabilities as new in the last period', async () => {
      const trend = await (service as any).getTrendStatistics({ ...baseCtx });

      // Before the fix this was ALL_NEW_IN_PERIOD (2054) — larger than the open
      // total — the exact "increase > total" inconsistency.
      expect(trend.newIssuesLastPeriod).toBe(OPEN_NEW_IN_PERIOD);
    });

    it('counts every state when includeResolved is set (stays consistent with the total)', async () => {
      const trend = await (service as any).getTrendStatistics({
        ...baseCtx,
        includeResolved: true,
      });

      // With includeResolved the total counts all states, so the "new" count
      // must not be narrowed to open-only.
      expect(trend.newIssuesLastPeriod).toBe(ALL_NEW_IN_PERIOD);
    });

    it('applies the open-state filter to the per-project "new in period" query', async () => {
      const captured: { sql: string; params: any[] }[] = [];
      sastRepo.query = jest.fn(async (sql: string, params: any[]) => {
        captured.push({ sql, params });
        return [];
      });

      await (service as any).fetchProjectTrendStatsOptimized({ ...baseCtx }, 7);

      const newQuery = captured.find((q) => q.sql.includes('as newCount'));
      const resolvedQuery = captured.find((q) =>
        q.sql.includes('as resolvedCount'),
      );
      expect(newQuery).toBeDefined();
      // The per-project "new" count must exclude non-open states, exactly like
      // the total it is compared against.
      expect(newQuery!.sql).toContain('currentState NOT IN');
      expect(newQuery!.params).toEqual(
        expect.arrayContaining(['resolved', 'not_exploitable', 'ignored']),
      );
      // The "resolved" count intentionally keeps counting the resolved states.
      expect(resolvedQuery!.sql).toContain(
        "currentState IN ('resolved', 'not_exploitable')",
      );
    });

    it('does not narrow the per-project "new" query when includeResolved is set', async () => {
      const captured: { sql: string; params: any[] }[] = [];
      sastRepo.query = jest.fn(async (sql: string, params: any[]) => {
        captured.push({ sql, params });
        return [];
      });

      await (service as any).fetchProjectTrendStatsOptimized(
        { ...baseCtx, includeResolved: true },
        7,
      );

      const newQuery = captured.find((q) => q.sql.includes('as newCount'));
      expect(newQuery!.sql).not.toContain('currentState NOT IN');
    });
  });

  describe('getIssueTrend: the home cards count like the overview', () => {
    // The home cards counted only `to_verify` findings of four types (no
    // CI/CD, no secret) since `now - 7 days`, while the overview counts every
    // open finding of the six types since the start of the day seven days
    // ago: after a scan the home said 18 new findings, the overview 24.
    const makeCountingQb = () => {
      const conditions: string[] = [];
      const qb: any = {
        where: jest.fn((c: string) => {
          conditions.push(c);
          return qb;
        }),
        andWhere: jest.fn((c: string) => {
          conditions.push(c);
          return qb;
        }),
        getCount: jest.fn(async () => {
          const has = (frag: string) =>
            conditions.some((c) => c.includes(frag));
          if (has('createdAt <') || has('updatedAt <') || has('updateAt <')) {
            return 0;
          }
          // One open finding created in the period per type, one solved in
          // the period per type.
          if (has('currentState NOT IN')) return 1;
          if (has('currentState IN')) return 1;
          return 0;
        }),
      };
      return qb;
    };

    beforeEach(() => {
      for (const repo of [
        sastRepo,
        iacRepo,
        scaRepo,
        containerRepo,
        cicdRepo,
        secretRepo,
      ]) {
        repo.createQueryBuilder = jest.fn(() => makeCountingQb());
        repo.count = jest.fn().mockResolvedValue(2);
      }
    });

    it('counts open findings of all six types, new and solved, all time and over seven days', async () => {
      const trend = await service.getIssueTrend(['p1']);

      expect(trend).toEqual(
        expect.objectContaining({
          newIssues: 6,
          newIssuesLastPeriod: 6,
          solvedIssues: 12,
          solvedIssuesLastPeriod: 6,
        }),
      );
    });

    it('answers what the overview answers for the same projects and no filter', async () => {
      const home = await service.getIssueTrend(['p1']);
      const overview = await (service as any).getTrendStatistics({
        projectIds: ['p1'],
        teamIds: [],
        severityFilter: [],
        statusFilter: [],
        analysisTypes: [],
        branches: [],
        projectBranchMap: new Map<string, string[]>(),
        includeResolved: false,
        trendPeriodDays: 7,
      });

      expect(home).toEqual(overview);
    });

    it('answers zeros without a query when there is no project', async () => {
      const trend = await service.getIssueTrend([]);

      expect(trend).toEqual({
        newIssues: 0,
        newIssuesLastPeriod: 0,
        newIssuesPreviousPeriod: 0,
        solvedIssues: 0,
        solvedIssuesLastPeriod: 0,
        solvedIssuesPreviousPeriod: 0,
      });
      expect(sastRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('over-time series shows what was open at each date', () => {
    // The cumulative "Vulnerability Trends" line is built ONLY from the created
    // series (accumulateCreatedOverTime ignores resolved rows), so if the
    // created queries count every detection ever opened the chart shows totals
    // far above the open backlog. The created
    // queries must exclude resolved / not_exploitable / ignored — exactly like
    // the sibling severity counts (aggregateSeverityByProjects) — unless the
    // caller opts in via includeResolved.
    type CapturedQb = {
      selects: string[];
      wheres: { sql: string; params?: Record<string, unknown> }[];
    };

    const captureOverTimeQbs = (): CapturedQb[] => {
      const qbs: CapturedQb[] = [];
      const makeQb = () => {
        const rec: CapturedQb = { selects: [], wheres: [] };
        const qb: any = {};
        qb.select = jest.fn((sql: string) => {
          rec.selects.push(sql);
          return qb;
        });
        qb.addSelect = jest.fn().mockReturnValue(qb);
        qb.where = jest.fn((sql: string, params?: Record<string, unknown>) => {
          rec.wheres.push({ sql, params });
          return qb;
        });
        qb.andWhere = jest.fn(
          (sql: string, params?: Record<string, unknown>) => {
            rec.wheres.push({ sql, params });
            return qb;
          },
        );
        for (const m of ['groupBy', 'addGroupBy', 'orderBy', 'addOrderBy']) {
          qb[m] = jest.fn().mockReturnValue(qb);
        }
        qb.getRawMany = jest.fn().mockResolvedValue([]);
        qbs.push(rec);
        return qb;
      };
      for (const repo of [
        sastRepo,
        iacRepo,
        scaRepo,
        containerRepo,
        cicdRepo,
        secretRepo,
      ]) {
        repo.createQueryBuilder = jest.fn(() => makeQb());
      }
      return qbs;
    };

    // The created series selects DATE_FORMAT(<alias>.createdAt, ...); the
    // resolved series selects on updateAt/updatedAt. That distinguishes them.
    const createdQbsFrom = (qbs: CapturedQb[]) =>
      qbs.filter((q) => q.selects.some((s) => /createdAt/.test(s)));

    const baseFilter = (includeResolved: boolean) => ({
      projectIds: ['p1'],
      teamIds: [],
      severityFilter: [],
      statusFilter: [],
      analysisTypes: [],
      branches: [],
      projectBranchMap: new Map(),
      includeResolved,
      trendPeriodDays: 30,
    });

    // the line shows what was OPEN at the end of each
    // day. The created series keeps EVERY state (a resolved finding must stay
    // on the dates it was open) and a CLOSED series — dated by resolved_at /
    // triaged_at, updateAt as a legacy fallback, restricted to resolved /
    // ignored / not_exploitable — is subtracted day by day, so the last point
    // equals the open backlog without erasing the history.
    const closedQbsFrom = (qbs: CapturedQb[]) =>
      qbs.filter((q) => q.selects.some((s) => /resolvedAt/.test(s)));

    it('keeps every state in the created series (nothing is filtered out) when includeResolved is false', async () => {
      const qbs = captureOverTimeQbs();
      await (service as any).aggregateVulnerabilitiesOverTime(
        baseFilter(false),
      );
      const createdQbs = createdQbsFrom(qbs);
      expect(createdQbs.length).toBe(6);
      for (const qb of createdQbs) {
        const stateClause = qb.wheres.find((w) => /currentState/i.test(w.sql));
        expect(stateClause).toBeUndefined();
      }
    });

    it('fetches a closed series dated by resolved_at / triaged_at (updateAt fallback) for resolved, ignored and not_exploitable', async () => {
      const qbs = captureOverTimeQbs();
      await (service as any).aggregateVulnerabilitiesOverTime(
        baseFilter(false),
      );
      const closedQbs = closedQbsFrom(qbs);
      expect(closedQbs.length).toBe(6);
      for (const qb of closedQbs) {
        const dateSelect = qb.selects.find((s) => /resolvedAt/.test(s))!;
        expect(dateSelect).toMatch(/COALESCE\(/);
        expect(dateSelect).toMatch(/triagedAt/);
        expect(dateSelect).toMatch(/updat(e|ed)At/);
        const stateClause = qb.wheres.find((w) =>
          /currentState\s+IN/i.test(w.sql),
        );
        expect(stateClause).toBeDefined();
        expect(stateClause!.params?.states).toEqual(
          expect.arrayContaining(['resolved', 'ignored', 'not_exploitable']),
        );
      }
    });

    it('subtracts the closings day by day: a finding resolved later stays on the dates it was open and leaves the last point', async () => {
      const qbs = captureOverTimeQbs();
      // Only SAST returns rows: one HIGH created on 06-01, closed on 06-10.
      let call = 0;
      sastRepo.createQueryBuilder = jest.fn(() => {
        const rec: CapturedQb = { selects: [], wheres: [] };
        const qb: any = {};
        qb.select = jest.fn((sql: string) => {
          rec.selects.push(sql);
          return qb;
        });
        qb.addSelect = jest.fn().mockReturnValue(qb);
        qb.where = jest.fn().mockReturnValue(qb);
        qb.andWhere = jest.fn().mockReturnValue(qb);
        for (const m of ['groupBy', 'addGroupBy', 'orderBy', 'addOrderBy']) {
          qb[m] = jest.fn().mockReturnValue(qb);
        }
        qb.getRawMany = jest
          .fn()
          .mockImplementation(async () =>
            rec.selects.some((s) => /createdAt/.test(s))
              ? [{ date: '2026-06-01', severity: 'HIGH', count: '1' }]
              : [{ date: '2026-06-10', severity: 'HIGH', count: '1' }],
          );
        call += 1;
        qbs.push(rec);
        return qb;
      });
      const series = await (service as any).aggregateVulnerabilitiesOverTime(
        baseFilter(false),
      );
      const high = series.filter((p: any) => p.severity === 'HIGH');
      expect(high.find((p: any) => p.date === '2026-06-01')?.count).toBe(1);
      expect(high.find((p: any) => p.date === '2026-06-10')?.count).toBe(0);
      expect(high[high.length - 1].count).toBe(0);
      expect(call).toBeGreaterThanOrEqual(2);
    });

    // A caller-supplied statusFilter narrows the created series,
    // so the closed series must be narrowed to the SAME states — otherwise
    // closings of states absent from the created series get subtracted from
    // nothing and the balance is floored to zero for every later date.
    it('does not fetch a closed series when the statusFilter keeps only open states', async () => {
      const qbs = captureOverTimeQbs();
      await (service as any).aggregateVulnerabilitiesOverTime({
        ...baseFilter(false),
        statusFilter: ['to_verify', 'confirmed'],
      });
      expect(createdQbsFrom(qbs).length).toBe(6);
      expect(closedQbsFrom(qbs).length).toBe(0);
    });

    it('narrows the closed series to the closed states of the statusFilter', async () => {
      const qbs = captureOverTimeQbs();
      await (service as any).aggregateVulnerabilitiesOverTime({
        ...baseFilter(false),
        statusFilter: ['RESOLVED', 'ignored', 'to_verify'],
      });
      const closedQbs = closedQbsFrom(qbs);
      expect(closedQbs.length).toBe(6);
      for (const qb of closedQbs) {
        const stateClause = qb.wheres.find((w) =>
          /currentState\s+IN/i.test(w.sql),
        );
        expect(stateClause!.params?.states).toEqual(['resolved', 'ignored']);
      }
    });

    it('keeps the discovered total when includeResolved is true: created series only, no closed series', async () => {
      const qbs = captureOverTimeQbs();
      await (service as any).aggregateVulnerabilitiesOverTime(baseFilter(true));
      const createdQbs = createdQbsFrom(qbs);
      expect(createdQbs.length).toBe(6);
      for (const qb of createdQbs) {
        const excludeClause = qb.wheres.find((w) =>
          /currentState\s+NOT IN/i.test(w.sql),
        );
        expect(excludeClause).toBeUndefined();
      }
      expect(closedQbsFrom(qbs).length).toBe(0);
    });
  });

  /**
   * Every block of the organization overview (the main
   * overview and the three split distributions) resolved its scope through
   * GetAllFromOrganization, the dashboard's home-page loader: page size
   * 10 000, then scan status, branch ingestion, batch vulnerability counts
   * (back into this service) and integration link status, all to read a
   * project's id, name and team. GetReadableProjectsInOrganization is the same
   * principal filter as one projection SELECT.
   */
  describe('scope through the readable projects projection', () => {
    const request = {
      organizationId: 'org-123',
      userId: 'user-456',
    } as GetOrganizationOverviewRequest;

    beforeEach(() => {
      for (const repo of [
        sastRepo,
        iacRepo,
        scaRepo,
        containerRepo,
        cicdRepo,
        secretRepo,
        autofixRepo,
      ]) {
        repo.createQueryBuilder = jest
          .fn()
          .mockReturnValue(createMockQueryBuilder([]));
        repo.query = jest.fn().mockResolvedValue([]);
        repo.count = jest.fn().mockResolvedValue(0);
      }
    });

    it('resolves every block through getReadableProjectsInOrganization, never the home-page loader', async () => {
      const filter: OrganizationOverviewFilter = {
        organizationId: 'org-123',
        userId: 'user-456',
        projectIds: [],
        teamIds: [],
        severityFilter: [],
        statusFilter: [],
        analysisTypes: [],
        branches: [],
        includeResolved: false,
      };

      await service.getOrganizationOverview(request);
      await service.getOrganizationSeverityDistribution({ filter });
      await service.getOrganizationStateDistribution({ filter });
      await service.getOrganizationVulnerabilitiesOverTime({
        filter,
        trendPeriodDays: 30,
      });

      expect(mockGetReadableProjects).toHaveBeenCalledTimes(4);
      for (const [arg] of mockGetReadableProjects.mock.calls) {
        expect(arg).toEqual({
          organizationId: 'org-123',
          userId: 'user-456',
        });
      }
      expect(mockGetAllFromOrganization).not.toHaveBeenCalled();
    });

    it('groups and filters by the team the projection carries', async () => {
      const all = await service.getOrganizationOverview(request);

      expect(all.totalProjects).toBe(3);
      expect(all.totalTeams).toBe(2);
      expect(
        all.teamsSummary
          .map((t) => [t.teamId, t.teamName, t.projectCount])
          .sort(),
      ).toEqual([
        ['team-1', 'Web Team', 2],
        ['team-2', 'Mobile Team', 1],
      ]);

      const filtered = await service.getOrganizationOverview({
        ...request,
        teamIds: ['team-2'],
      });
      expect(filtered.projectsSummary.map((p) => p.projectId)).toEqual([
        'project-3',
      ]);
    });

    // The home-page loader returned its projects ordered by CybeRisk score,
    // then name, then id; the summary sort is stable, so that order broke
    // every tie. The projection has no order: the overview restores it from
    // the scores it reads itself, or equal totals would come out (and be
    // paginated) in whatever order the database returns.
    it('keeps the former order between projects that tie on the sort key', async () => {
      mockGetReadableProjects.mockReturnValue(
        of({
          projects: [
            { projectId: 'p-c', name: 'Charlie', teamId: 't', teamName: 'T' },
            { projectId: 'p-b', name: 'bravo', teamId: 't', teamName: 'T' },
            { projectId: 'p-a', name: 'Alpha', teamId: 't', teamName: 'T' },
            { projectId: 'p-r', name: 'Zulu', teamId: 't', teamName: 'T' },
          ],
        }),
      );
      (
        service as unknown as {
          projectCyberRiskRepo: { findByProjectIds: jest.Mock };
        }
      ).projectCyberRiskRepo.findByProjectIds = jest
        .fn()
        .mockResolvedValue([{ projectId: 'p-r', score: 40, level: 'medium' }]);

      const res = await service.getOrganizationOverview(request);

      // Every total is 0: the riskiest first, then by name, case-insensitive.
      expect(res.projectsSummary.map((p) => p.projectId)).toEqual([
        'p-r',
        'p-a',
        'p-b',
        'p-c',
      ]);
    });
  });

  describe('getReadableProjectIds', () => {
    it("answers the ids of the caller's readable projects, resolved for that caller", async () => {
      mockGetReadableProjects.mockReturnValue(
        of({ projects: [{ projectId: 'p-a' }, { projectId: 'p-b' }] }),
      );

      const ids = await service.getReadableProjectIds('org-123', 'user-456');

      expect(ids).toEqual(['p-a', 'p-b']);
      expect(mockGetReadableProjects).toHaveBeenCalledWith({
        organizationId: 'org-123',
        userId: 'user-456',
      });
      expect(mockGetAllFromOrganization).not.toHaveBeenCalled();
    });
  });

  /**
   * The license distribution loaded every
   * `sca_detected_packages` row of the scope (all branches, 19 009 rows
   * locally) and ranked each one in JS, ignoring the branch filter every other
   * block applies. It is now one GROUP BY: each distinct license list is
   * ranked once (its riskiest license) and weighted by its count.
   */
  describe('license distribution aggregated in SQL', () => {
    let dataSource: DataSource;
    let emitted: Array<{ sql: string; params: unknown[] }>;
    let groupedRows: Array<{ licenses: string | null; cnt: number | string }>;
    let pkgRepo: { find: jest.Mock; createQueryBuilder: jest.Mock };

    const request = {
      organizationId: 'org-123',
      userId: 'user-456',
    } as GetOrganizationOverviewRequest;

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'mysql',
        database: 'unused',
        entities: [join(__dirname, '../../**/*.entity.ts')],
      });
      // Builds the entity metadata the query builders need; never connects.
      await (
        dataSource as unknown as { buildMetadatas(): Promise<void> }
      ).buildMetadatas();
    });

    beforeEach(() => {
      emitted = [];
      groupedRows = [];
      for (const repo of [
        sastRepo,
        iacRepo,
        scaRepo,
        containerRepo,
        cicdRepo,
        secretRepo,
        autofixRepo,
      ]) {
        repo.createQueryBuilder = jest
          .fn()
          .mockReturnValue(createMockQueryBuilder([]));
        repo.query = jest.fn().mockResolvedValue([]);
        repo.count = jest.fn().mockResolvedValue(0);
      }
      pkgRepo = (
        service as unknown as { scaDetectedPackagesRepository: typeof pkgRepo }
      ).scaDetectedPackagesRepository;
      pkgRepo.find = jest.fn().mockResolvedValue([]);
      pkgRepo.createQueryBuilder = jest.fn((alias: string) => {
        const qb = dataSource
          .getRepository(ScaDetectedPackages)
          .createQueryBuilder(alias);
        qb.getRawMany = jest.fn(async () => {
          const [sql, params] = qb.getQueryAndParameters();
          emitted.push({ sql, params });
          return groupedRows;
        }) as typeof qb.getRawMany;
        return qb;
      });
    });

    it('never loads the package rows: one GROUP BY on the license list', async () => {
      await service.getOrganizationOverview(request);

      expect(pkgRepo.find).not.toHaveBeenCalled();
      expect(emitted).toHaveLength(1);
      const { sql, params } = emitted[0];
      // Grouped byte-exactly: a plain GROUP BY on the utf8mb4_0900_ai_ci
      // column would merge ["Ruby"] with ["RUBY"], which rank differently.
      expect(sql).toMatch(/GROUP BY MD5\(`pkg`\.`licenses`\)/);
      expect(sql).toMatch(/COUNT\(\*\)/);
      expect(sql).toMatch(/`pkg`\.`projectId` IN \(\?, \?, \?\)/);
      expect(params).toEqual(['project-1', 'project-2', 'project-3']);
      // No branch chosen: no block filters the branch, this one neither.
      expect(sql).not.toMatch(/branch/);
    });

    it('applies the branch filter the user picked, like every other block', async () => {
      await service.getOrganizationOverview({
        ...request,
        branches: ['project-1::main'],
      });

      const { sql, params } = emitted[0];
      expect(sql).toMatch(
        /\(`pkg`\.`projectId` = \? AND `pkg`\.`branch` IN \(\?\)\)/,
      );
      expect(params).toEqual(expect.arrayContaining(['project-1', 'main']));
    });

    it('weights each distinct list by its count; NULL and [] count as unknown', async () => {
      groupedRows = [
        { licenses: '["MIT"]', cnt: 2 },
        { licenses: '["GPL-3.0"]', cnt: 1 },
        { licenses: null, cnt: 4 },
      ];

      const res = await service.getOrganizationOverview(request);

      expect(res.licenseTotalPackages).toBe(7);
      expect(res.licensePackagesWithLicenses).toBe(3);
      expect(res.licensePermissiveCount).toBe(2);
      expect(res.licenseWeakCopyleftCount).toBe(0);
      expect(res.licenseStrongCopyleftCount).toBe(1);
      expect(res.licenseUnknownCount).toBe(4);
    });

    it('ranks a list by its riskiest license, and reads counts handed back as strings', async () => {
      // mysql2 returns COUNT(*) as a string (TypeORM sets bigNumberStrings).
      groupedRows = [
        { licenses: '["MIT","GPL-3.0-only"]', cnt: '3' },
        { licenses: '["Apache-2.0","LGPL-2.1-only"]', cnt: '2' },
        { licenses: '["MIT","NOT-A-LICENSE"]', cnt: '5' },
        { licenses: '[]', cnt: '1' },
        { licenses: '', cnt: '1' },
      ];

      const res = await service.getOrganizationOverview(request);

      expect(res.licenseTotalPackages).toBe(12);
      expect(res.licensePackagesWithLicenses).toBe(10);
      expect(res.licensePermissiveCount).toBe(0);
      expect(res.licenseStrongCopyleftCount).toBe(3);
      expect(res.licenseWeakCopyleftCount).toBe(2);
      // An unresolvable license ranks above every known category.
      expect(res.licenseUnknownCount).toBe(7);
    });
  });
});
