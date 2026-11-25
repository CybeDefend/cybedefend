import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, of, throwError } from 'rxjs';

import { ResultService } from './result.service';
import {
  RESULT_SERVICE_NAME,
  ResultServiceClient,
} from '@grpc/analysis-reporting/analysis_reporting';
import {
  DeleteContainerImageRequest,
  EnqueueBatchUpdateRequest,
  EnqueueBatchUpdateResponse,
  GetProjectContainerImagesRequest,
  GetProjectContainerImagesResponse,
  GetProjectContainerVulnerabilitiesRequest,
  GetProjectContainerVulnerabilitiesResponse,
  GetProjectContainerVulnerabilityByIdRequest,
  GetProjectContainerVulnerabilityByIdResponse,
  GetProjectIacVulnerabilitiesRequest,
  GetProjectIacVulnerabilitiesResponse,
  GetProjectOverviewRequest,
  GetProjectOverviewResponse,
  GetProjectPackagesResponse,
  GetProjectSastVulnerabilitiesRequest,
  GetProjectSastVulnerabilitiesResponse,
  GetProjectScaVulnerabilitiesRequest,
  GetProjectScaVulnerabilitiesResponse,
  GetProjectVulnerabilityByIdRequest,
  GetProjectVulnerabilityByIdResponse,
  ProjectDeleteResponse,
  UpdateProjectVulnerabilityResponse,
  UpdateResultRequest,
} from '@grpc/analysis-reporting/result';

describe('ResultService', () => {
  let service: ResultService;
  let clientMock: jest.Mocked<ClientGrpc>;
  let globalManagementClientMock: jest.Mocked<ClientGrpc>;
  let externalIntegrationsClientMock: jest.Mocked<ClientGrpc>;
  let securityScanningClientMock: jest.Mocked<ClientGrpc>;
  let grpcStub: jest.Mocked<ResultServiceClient>;
  let projectGrpcStub: {
    get: jest.Mock;
    validateProjectsInOrganization: jest.Mock;
    getReadableProjectsInOrganization: jest.Mock;
    getArchivedBranches: jest.Mock;
  };
  let githubGrpcStub: { getRepositoryBranchesPaginated: jest.Mock };
  let gitlabGrpcStub: { getGitlabRepositoryBranchesPaginated: jest.Mock };
  let scanGrpcStub: { getProjectBranchesFromScansPaginated: jest.Mock };

  beforeEach(async () => {
    grpcStub = {
      getProjectContainerVulnerabilities: jest.fn(),
      getProjectContainerPackages: jest.fn(),
      getProjectContainerImages: jest.fn(),
      getGroupedContainerImages: jest.fn(),
      getContainerVulnerabilityById: jest.fn(),
      getProjectSastVulnerabilities: jest.fn(),
      getGroupedSastVulnerabilities: jest.fn(),
      getProjectIacVulnerabilities: jest.fn(),
      getProjectScaVulnerabilities: jest.fn(),
      getProjectScaPackages: jest.fn(),
      getScaVulnerabilityById: jest.fn(),
      getSastVulnerabilityById: jest.fn(),
      getIacVulnerabilityById: jest.fn(),
      updateScanResult: jest.fn(),
      getProjectOverview: jest.fn(),
      deleteContainerImage: jest.fn(),
      getProjectBranches: jest.fn(),
      getGeneratedReport: jest.fn(),
      deleteGeneratedReport: jest.fn(),
      deleteAggregatedReport: jest.fn(),
      listGeneratedReports: jest.fn(),
      listAggregatedReports: jest.fn(),
      getReportUsage: jest.fn(),
      enqueueBatchUpdate: jest.fn(),
    } as any;

    projectGrpcStub = {
      // Default: a native project (no git integration). Tests routing to
      // GitHub/GitLab override this per test.
      get: jest.fn().mockImplementation(() =>
        of({
          isGithubLinked: false,
          isGitlabLinked: false,
          defaultBranch: '',
          organizationId: 'org-default',
        }),
      ),
      // Default: every requested projectId belongs to the supplied org. Tests
      // exercising the cross-organization fence override this.
      validateProjectsInOrganization: jest
        .fn()
        .mockImplementation(({ projectIds }: any) =>
          of({ valid: true, notFoundIds: [], invalidIds: [] }, projectIds),
        ),
      // Default: the caller reads p1, p2 and p3. Tests exercising the
      // readable-project fence override this.
      getReadableProjectsInOrganization: jest.fn().mockImplementation(() =>
        of({
          projects: ['p1', 'p2', 'p3'].map((projectId) => ({
            projectId,
            name: projectId,
          })),
        }),
      ),
      // Default: no archived branches. Tests exercising archived fan-out
      // override this per projectId.
      getArchivedBranches: jest
        .fn()
        .mockImplementation(() => of({ branches: [] })),
    };

    githubGrpcStub = { getRepositoryBranchesPaginated: jest.fn() };
    gitlabGrpcStub = { getGitlabRepositoryBranchesPaginated: jest.fn() };
    scanGrpcStub = { getProjectBranchesFromScansPaginated: jest.fn() };

    clientMock = {
      getService: jest.fn().mockReturnValue(grpcStub),
    } as any;

    globalManagementClientMock = {
      getService: jest.fn().mockReturnValue(projectGrpcStub),
    } as any;

    // The external-integrations ClientGrpc serves two services (GitHub +
    // GitLab); route getService() by the requested service name.
    externalIntegrationsClientMock = {
      getService: jest
        .fn()
        .mockImplementation((name: string) =>
          name === 'GitlabService' ? gitlabGrpcStub : githubGrpcStub,
        ),
    } as any;

    securityScanningClientMock = {
      getService: jest.fn().mockReturnValue(scanGrpcStub),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultService,
        { provide: 'ANALYSIS_REPORTING_SERVICE', useValue: clientMock },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: globalManagementClientMock,
        },
        {
          provide: 'EXTERNAL_INTEGRATIONS_SERVICE',
          useValue: externalIntegrationsClientMock,
        },
        {
          provide: 'SECURITY_SCANNING_SERVICE',
          useValue: securityScanningClientMock,
        },
      ],
    }).compile();

    service = module.get(ResultService);
    service.onModuleInit();
  });

  it('initializes gRPC client with RESULT_SERVICE_NAME', () => {
    expect(clientMock.getService).toHaveBeenCalledWith(RESULT_SERVICE_NAME);
  });

  it('findAllContainer defaults page/limit and delegates', async () => {
    const req: GetProjectContainerVulnerabilitiesRequest = {
      projectId: 'p1',
    } as any;
    const res: GetProjectContainerVulnerabilitiesResponse = {
      vulnerabilities: [],
      total: 0,
    } as any;
    grpcStub.getProjectContainerVulnerabilities.mockReturnValue(of(res) as any);
    const out = await service.findAllContainer({ ...req });
    expect(out).toEqual(res);
    expect(grpcStub.getProjectContainerVulnerabilities).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 10 }),
      expect.anything(),
    );
  });

  it('findAllContainerPackages defaults page/limit and delegates', async () => {
    const req: GetProjectScaVulnerabilitiesRequest = {
      projectId: 'p1',
    } as any;
    const res: GetProjectPackagesResponse = { packages: [], total: 0 } as any;
    grpcStub.getProjectContainerPackages.mockReturnValue(of(res) as any);
    const out = await service.findAllContainerPackages({ ...req });
    expect(out).toEqual(res);
    expect(grpcStub.getProjectContainerPackages).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 10 }),
      expect.anything(),
    );
  });

  it(
    'findAllContainerImages delegates',
    async () => {
      const req: GetProjectContainerImagesRequest = { projectId: 'p1' } as any;
      const res: GetProjectContainerImagesResponse = { images: [] } as any;
      grpcStub.getProjectContainerImages.mockReturnValue(of(res) as any);
      await expect(service.findAllContainerImages(req)).resolves.toEqual(res);
      expect(grpcStub.getProjectContainerImages).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    },
    expect.anything(),
  );

  // Like the other container lists, the image list gets its
  // paging defaults at the gateway instead of relying on analysis-reporting.
  it('findAllContainerImages sets page=1 and limit=20 when they are absent', async () => {
    grpcStub.getProjectContainerImages.mockReturnValue(
      of({ images: [] }) as any,
    );

    await service.findAllContainerImages({ projectId: 'p1' });

    const sent: GetProjectContainerImagesRequest =
      grpcStub.getProjectContainerImages.mock.calls[0][0];
    expect(sent.page).toBe(1);
    expect(sent.limit).toBe(20);
  });

  it('findAllContainerImages keeps the page and limit it is given', async () => {
    grpcStub.getProjectContainerImages.mockReturnValue(
      of({ images: [] }) as any,
    );

    await service.findAllContainerImages({
      projectId: 'p1',
      page: 3,
      limit: 50,
    });

    const sent: GetProjectContainerImagesRequest =
      grpcStub.getProjectContainerImages.mock.calls[0][0];
    expect(sent.page).toBe(3);
    expect(sent.limit).toBe(50);
  });

  it(
    'getGroupedContainerImages delegates to gRPC service',
    async () => {
      const req = { projectId: 'p1', page: 1, limit: 20 };
      const res = {
        projectName: 'Test Project',
        groupedImages: [],
        totalRepositories: 0,
        totalTags: 0,
        totalPages: 0,
        currentPage: 1,
        pageSize: 20,
      } as any;
      grpcStub.getGroupedContainerImages.mockReturnValue(of(res) as any);
      await expect(service.getGroupedContainerImages(req)).resolves.toEqual(
        res,
      );
      expect(grpcStub.getGroupedContainerImages).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    },
    expect.anything(),
  );

  it('findOneContainer delegates', async () => {
    const req: GetProjectContainerVulnerabilityByIdRequest = {
      projectId: 'p1',
      vulnerabilityId: 'v1',
    } as any;
    const res: GetProjectContainerVulnerabilityByIdResponse = {
      vulnerability: {} as any,
    } as any;
    grpcStub.getContainerVulnerabilityById.mockReturnValue(of(res) as any);
    await expect(service.findOneContainer(req)).resolves.toEqual(res);
    expect(grpcStub.getContainerVulnerabilityById).toHaveBeenCalledWith(
      req,
      expect.anything(),
    );
  });

  it('findAllSast defaults pageNumber/pageSizeNumber and delegates', async () => {
    const req: GetProjectSastVulnerabilitiesRequest = {
      projectId: 'p1',
    } as any;
    const res: GetProjectSastVulnerabilitiesResponse = {
      vulnerabilities: [],
      total: 0,
    } as any;
    grpcStub.getProjectSastVulnerabilities.mockReturnValue(of(res) as any);
    await expect(service.findAllSast({ ...req })).resolves.toEqual(res);
    expect(grpcStub.getProjectSastVulnerabilities).toHaveBeenCalledWith(
      expect.objectContaining({ pageNumber: 1, pageSizeNumber: 10 }),
      expect.anything(),
    );
  });

  // The dashboard flags an agent analysis from a previous scan on
  // each grouped occurrence; the gateway must hand those fields over as is.
  it('getGroupedSastVulnerabilities passes the occurrence staleness inputs through untouched', async () => {
    const occurrence = {
      id: 'det-1',
      exploitabilitySource: 'agent',
      exploitabilityUpdatedAt: '2026-06-26T13:19:10.000Z',
      exploitabilityStale: false,
    };
    const res = {
      groupedVulnerabilities: [{ ruleId: 'r1', occurrences: [occurrence] }],
    } as any;
    grpcStub.getGroupedSastVulnerabilities.mockReturnValue(of(res) as any);

    const out = await service.getGroupedSastVulnerabilities({
      projectId: 'p1',
    } as any);

    expect(out.groupedVulnerabilities[0].occurrences[0]).toEqual(occurrence);
  });

  it('findAllIac defaults pageNumber/pageSizeNumber and delegates', async () => {
    const req: GetProjectIacVulnerabilitiesRequest = {
      projectId: 'p1',
    } as any;
    const res: GetProjectIacVulnerabilitiesResponse = {
      vulnerabilities: [],
      total: 0,
    } as any;
    grpcStub.getProjectIacVulnerabilities.mockReturnValue(of(res) as any);
    await expect(service.findAllIac({ ...req })).resolves.toEqual(res);
    expect(grpcStub.getProjectIacVulnerabilities).toHaveBeenCalledWith(
      expect.objectContaining({ pageNumber: 1, pageSizeNumber: 10 }),
      expect.anything(),
    );
  });

  it('findAllSca defaults page/limit and delegates', async () => {
    const req: GetProjectScaVulnerabilitiesRequest = {
      projectId: 'p1',
    } as any;
    const res: GetProjectScaVulnerabilitiesResponse = {
      vulnerabilities: [],
      total: 0,
    } as any;
    grpcStub.getProjectScaVulnerabilities.mockReturnValue(of(res) as any);
    await expect(service.findAllSca({ ...req })).resolves.toEqual(res);
    expect(grpcStub.getProjectScaVulnerabilities).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 10 }),
      expect.anything(),
    );
  });

  // analysis-reporting paginates the SCA list on
  // pageNumber/pageSizeNumber only. Without them it received 0/0 (the proto
  // default) and returned every detection of the project, unpaginated.
  describe('findAllSca pagination aliases', () => {
    const sent = (): GetProjectScaVulnerabilitiesRequest =>
      grpcStub.getProjectScaVulnerabilities.mock.calls[0][0];

    beforeEach(() => {
      grpcStub.getProjectScaVulnerabilities.mockReturnValue(
        of({ vulnerabilities: [], total: 0 }) as any,
      );
    });

    it('sends pageNumber=1 and pageSizeNumber=10 when neither is given', async () => {
      await service.findAllSca({ projectId: 'p1' } as any);

      expect(sent().pageNumber).toBe(1);
      expect(sent().pageSizeNumber).toBe(10);
    });

    it('maps page=2, limit=50 onto pageNumber=2, pageSizeNumber=50', async () => {
      await service.findAllSca({ projectId: 'p1', page: 2, limit: 50 } as any);

      expect(sent().pageNumber).toBe(2);
      expect(sent().pageSizeNumber).toBe(50);
    });

    it('keeps pageNumber/pageSizeNumber when both names are given', async () => {
      await service.findAllSca({
        projectId: 'p1',
        page: 2,
        limit: 50,
        pageNumber: 3,
        pageSizeNumber: 25,
      } as any);

      expect(sent().pageNumber).toBe(3);
      expect(sent().pageSizeNumber).toBe(25);
    });
  });

  it(
    'findAllScaPackages delegates',
    async () => {
      const req: GetProjectScaVulnerabilitiesRequest = {
        projectId: 'p1',
        page: 2,
        limit: 5,
      } as any;
      const res: GetProjectPackagesResponse = { packages: [], total: 0 } as any;
      grpcStub.getProjectScaPackages.mockReturnValue(of(res) as any);
      await expect(service.findAllScaPackages(req)).resolves.toEqual(res);
      expect(grpcStub.getProjectScaPackages).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    },
    expect.anything(),
  );

  it(
    'findOneSca delegates',
    async () => {
      const req: GetProjectVulnerabilityByIdRequest = {
        projectId: 'p1',
        vulnerabilityId: 'v1',
      } as any;
      const res: GetProjectVulnerabilityByIdResponse = {
        vulnerability: {} as any,
      } as any;
      grpcStub.getScaVulnerabilityById.mockReturnValue(of(res) as any);
      await expect(service.findOneSca(req)).resolves.toEqual(res);
      expect(grpcStub.getScaVulnerabilityById).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    },
    expect.anything(),
  );

  it(
    'findOneSast delegates',
    async () => {
      const req: GetProjectVulnerabilityByIdRequest = {
        projectId: 'p1',
        vulnerabilityId: 'v1',
      } as any;
      const res: GetProjectVulnerabilityByIdResponse = {
        vulnerability: {} as any,
      } as any;
      grpcStub.getSastVulnerabilityById.mockReturnValue(of(res) as any);
      await expect(service.findOneSast(req)).resolves.toEqual(res);
      expect(grpcStub.getSastVulnerabilityById).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    },
    expect.anything(),
  );

  it(
    'findOneIac delegates',
    async () => {
      const req: GetProjectVulnerabilityByIdRequest = {
        projectId: 'p1',
        vulnerabilityId: 'v1',
      } as any;
      const res: GetProjectVulnerabilityByIdResponse = {
        vulnerability: {} as any,
      } as any;
      grpcStub.getIacVulnerabilityById.mockReturnValue(of(res) as any);
      await expect(service.findOneIac(req)).resolves.toEqual(res);
      expect(grpcStub.getIacVulnerabilityById).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    },
    expect.anything(),
  );

  it(
    'update delegates',
    async () => {
      const req: UpdateResultRequest = {
        projectId: 'p1',
        vulnerabilityId: 'v1',
        status: 'OPEN',
        priority: 'MEDIUM',
        comment: 'c',
        userId: 'u1',
      } as any;
      const res: UpdateProjectVulnerabilityResponse = { message: 'ok' } as any;
      grpcStub.updateScanResult.mockReturnValue(of(res) as any);
      await expect(service.update(req)).resolves.toEqual(res);
      expect(grpcStub.updateScanResult).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    },
    expect.anything(),
  );

  it(
    'getProjectOverview delegates',
    async () => {
      const req: GetProjectOverviewRequest = { projectId: 'p1' } as any;
      const res: GetProjectOverviewResponse = { total: 0 } as any;
      grpcStub.getProjectOverview.mockReturnValue(of(res) as any);
      await expect(service.getProjectOverview(req)).resolves.toEqual(res);
      expect(grpcStub.getProjectOverview).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    },
    expect.anything(),
  );

  it(
    'deleteContainerImage delegates',
    async () => {
      const req: DeleteContainerImageRequest = {
        projectId: 'p1',
        imageId: 'i1',
      } as any;
      const res: ProjectDeleteResponse = { message: 'deleted' } as any;
      grpcStub.deleteContainerImage.mockReturnValue(of(res) as any);
      await expect(service.deleteContainerImage(req)).resolves.toEqual(res);
      expect(grpcStub.deleteContainerImage).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    },
    expect.anything(),
  );

  it(
    'getProjectBranches delegates to gRPC service',
    async () => {
      const projectId = 'p1';
      const res = { projectId, branches: ['main', 'develop', 'feature/test'] };
      grpcStub.getProjectBranches.mockReturnValue(of(res) as any);
      await expect(service.getProjectBranches(projectId)).resolves.toEqual(res);
      expect(grpcStub.getProjectBranches).toHaveBeenCalledWith(
        { projectId },
        expect.anything(),
      );
    },
    expect.anything(),
  );

  describe('getBatchProjectsBranches', () => {
    // Server-side fan-out so the OrganizationOverview page can pull
    // branches for 20+ projects in one HTTP request. Each project still
    // gets its own gRPC call to analysis-reporting (which itself queries
    // security-scanning) — but they run in parallel and the response
    // shape is flat so the frontend doesn't choreograph the fan-out.

    it('fans out one gRPC call per projectId in parallel and returns a flat list', async () => {
      grpcStub.getProjectBranches.mockImplementation(
        ({ projectId }: any) =>
          of({ projectId, branches: [`main-${projectId}`] }) as any,
      );

      const res = await service.getBatchProjectsBranches('org-1', 'user-1', [
        'p1',
        'p2',
        'p3',
      ]);

      expect(grpcStub.getProjectBranches).toHaveBeenCalledTimes(3);
      expect(res.projects).toEqual([
        {
          projectId: 'p1',
          branches: ['main-p1'],
          archivedBranches: [],
          defaultBranch: '',
        },
        {
          projectId: 'p2',
          branches: ['main-p2'],
          archivedBranches: [],
          defaultBranch: '',
        },
        {
          projectId: 'p3',
          branches: ['main-p3'],
          archivedBranches: [],
          defaultBranch: '',
        },
      ]);
    });

    it('returns each project default branch from global-management so the org selector can pick the reference branch', async () => {
      grpcStub.getProjectBranches.mockImplementation(
        ({ projectId }: any) =>
          of({ projectId, branches: ['main', 'develop'] }) as any,
      );
      projectGrpcStub.get.mockImplementation(({ projectId }: any) =>
        of({
          projectId,
          defaultBranch: projectId === 'p1' ? 'develop' : '',
          organizationId: 'org-1',
        }),
      );
      const res = await service.getBatchProjectsBranches('org-1', 'user-1', [
        'p1',
        'p2',
      ]);
      expect(projectGrpcStub.get).toHaveBeenCalledTimes(2);
      expect(res.projects).toEqual([
        {
          projectId: 'p1',
          branches: ['main', 'develop'],
          archivedBranches: [],
          defaultBranch: 'develop',
        },
        {
          projectId: 'p2',
          branches: ['main', 'develop'],
          archivedBranches: [],
          defaultBranch: '',
        },
      ]);
    });

    // defaultBranch comes from the integration status; the
    // vulnerability stats and the security context are not read.
    it('reads each project without its vulnerability stats nor security context', async () => {
      grpcStub.getProjectBranches.mockImplementation(
        ({ projectId }: any) => of({ projectId, branches: ['main'] }) as any,
      );
      projectGrpcStub.get.mockImplementation(({ projectId }: any) =>
        of({ projectId, defaultBranch: 'develop', organizationId: 'org-1' }),
      );

      const res = await service.getBatchProjectsBranches('org-1', 'user-1', [
        'p1',
        'p2',
      ]);

      expect(projectGrpcStub.get.mock.calls.map((c: any[]) => c[0])).toEqual([
        {
          projectId: 'p1',
          skipVulnerabilityStats: true,
          skipSecurityContext: true,
        },
        {
          projectId: 'p2',
          skipVulnerabilityStats: true,
          skipSecurityContext: true,
        },
      ]);
      expect(res.projects.map((p) => p.defaultBranch)).toEqual([
        'develop',
        'develop',
      ]);
    });

    it('degrades defaultBranch to "" when the project lookup fails, without dropping the branches', async () => {
      grpcStub.getProjectBranches.mockImplementation(
        ({ projectId }: any) => of({ projectId, branches: ['main'] }) as any,
      );
      projectGrpcStub.get.mockImplementation(() =>
        throwError(() => new Error('gm down')),
      );
      const res = await service.getBatchProjectsBranches('org-1', 'user-1', [
        'p1',
      ]);
      expect(res.projects).toEqual([
        {
          projectId: 'p1',
          branches: ['main'],
          archivedBranches: [],
          defaultBranch: '',
        },
      ]);
    });

    it('fans out the archived-branches gRPC per project (global-management) and includes them per entry', async () => {
      grpcStub.getProjectBranches.mockImplementation(
        ({ projectId }: any) =>
          of({ projectId, branches: [`main-${projectId}`] }) as any,
      );
      projectGrpcStub.getArchivedBranches.mockImplementation(
        ({ projectId }: any) =>
          of({ branches: [`legacy-${projectId}`] }) as any,
      );

      const res = await service.getBatchProjectsBranches('org-1', 'user-1', [
        'p1',
        'p2',
      ]);

      expect(projectGrpcStub.getArchivedBranches).toHaveBeenCalledTimes(2);
      expect(res.projects).toEqual([
        {
          projectId: 'p1',
          branches: ['main-p1'],
          archivedBranches: ['legacy-p1'],
          defaultBranch: '',
        },
        {
          projectId: 'p2',
          branches: ['main-p2'],
          archivedBranches: ['legacy-p2'],
          defaultBranch: '',
        },
      ]);
    });

    it('degrades archivedBranches to [] when the archived gRPC fails, without dropping active branches', async () => {
      grpcStub.getProjectBranches.mockImplementation(
        ({ projectId }: any) => of({ projectId, branches: ['main'] }) as any,
      );
      projectGrpcStub.getArchivedBranches.mockImplementation(
        ({ projectId }: any) => {
          if (projectId === 'p2') {
            return new Observable((subscriber) => {
              subscriber.error(new Error('archived store down'));
            }) as any;
          }
          return of({ branches: ['legacy'] }) as any;
        },
      );

      const res = await service.getBatchProjectsBranches('org-1', 'user-1', [
        'p1',
        'p2',
        'p3',
      ]);

      expect(res.projects).toEqual([
        {
          projectId: 'p1',
          branches: ['main'],
          archivedBranches: ['legacy'],
          defaultBranch: '',
        },
        {
          projectId: 'p2',
          branches: ['main'],
          archivedBranches: [],
          defaultBranch: '',
        },
        {
          projectId: 'p3',
          branches: ['main'],
          archivedBranches: ['legacy'],
          defaultBranch: '',
        },
      ]);
    });

    it('preserves request order in the response even when gRPC calls resolve out of order', async () => {
      grpcStub.getProjectBranches.mockImplementation(
        ({ projectId }: any) =>
          new Observable((subscriber) => {
            // First-in resolves last; last-in resolves first.
            const delay = projectId === 'p1' ? 20 : projectId === 'p2' ? 10 : 0;
            setTimeout(() => {
              subscriber.next({ projectId, branches: [`b-${projectId}`] });
              subscriber.complete();
            }, delay);
          }) as any,
      );

      const res = await service.getBatchProjectsBranches('org-1', 'user-1', [
        'p1',
        'p2',
        'p3',
      ]);

      expect(res.projects.map((p) => p.projectId)).toEqual(['p1', 'p2', 'p3']);
    });

    it('returns an empty branches array for projects whose gRPC call fails (no whole-batch failure)', async () => {
      grpcStub.getProjectBranches.mockImplementation(({ projectId }: any) => {
        if (projectId === 'p2') {
          return new Observable((subscriber) => {
            subscriber.error(new Error('boom'));
          }) as any;
        }
        return of({ projectId, branches: ['main'] }) as any;
      });

      const res = await service.getBatchProjectsBranches('org-1', 'user-1', [
        'p1',
        'p2',
        'p3',
      ]);

      expect(res.projects).toEqual([
        {
          projectId: 'p1',
          branches: ['main'],
          archivedBranches: [],
          defaultBranch: '',
        },
        {
          projectId: 'p2',
          branches: [],
          archivedBranches: [],
          defaultBranch: '',
        },
        {
          projectId: 'p3',
          branches: ['main'],
          archivedBranches: [],
          defaultBranch: '',
        },
      ]);
    });

    it('returns an empty payload when the projectIds list is empty', async () => {
      const res = await service.getBatchProjectsBranches('org-1', 'user-1', []);
      expect(res.projects).toEqual([]);
      expect(grpcStub.getProjectBranches).not.toHaveBeenCalled();
      expect(projectGrpcStub.getArchivedBranches).not.toHaveBeenCalled();
      expect(
        projectGrpcStub.getReadableProjectsInOrganization,
      ).not.toHaveBeenCalled();
    });

    // ====== Readable-project fence ======
    // The route authorises only organization:read on the path org, so every
    // body projectId must be a project the CALLER may read there (the project
    // list's rule, one global-management query). An id outside that set is
    // refused, never silently dropped, with one message that does not say
    // which id or why.

    it('asks global-management for the caller readable projects once, not one check per project', async () => {
      grpcStub.getProjectBranches.mockImplementation(
        ({ projectId }: any) => of({ projectId, branches: ['main'] }) as any,
      );

      await service.getBatchProjectsBranches('org-1', 'user-1', ['p1', 'p2']);

      expect(
        projectGrpcStub.getReadableProjectsInOrganization,
      ).toHaveBeenCalledTimes(1);
      expect(
        projectGrpcStub.getReadableProjectsInOrganization.mock.calls[0][0],
      ).toEqual({ organizationId: 'org-1', userId: 'user-1' });
    });

    it('serves a team member the branches of the projects of their team', async () => {
      projectGrpcStub.getReadableProjectsInOrganization.mockReturnValue(
        of({ projects: [{ projectId: 'p-team', name: 'team project' }] }),
      );
      grpcStub.getProjectBranches.mockImplementation(
        ({ projectId }: any) => of({ projectId, branches: ['main'] }) as any,
      );

      const res = await service.getBatchProjectsBranches('org-1', 'member', [
        'p-team',
      ]);

      expect(res.projects.map((p) => p.projectId)).toEqual(['p-team']);
      expect(res.projects[0].branches).toEqual(['main']);
    });

    it('refuses an organisation member outside the project team, before any fan-out', async () => {
      // A member in no team reads no project of the organisation.
      projectGrpcStub.getReadableProjectsInOrganization.mockReturnValue(
        of({ projects: [] }),
      );

      await expect(
        service.getBatchProjectsBranches('org-1', 'outsider', ['p-team']),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(grpcStub.getProjectBranches).not.toHaveBeenCalled();
      expect(projectGrpcStub.getArchivedBranches).not.toHaveBeenCalled();
      expect(projectGrpcStub.get).not.toHaveBeenCalled();
    });

    it('refuses a mixed list as a whole, with a message naming no id', async () => {
      projectGrpcStub.getReadableProjectsInOrganization.mockReturnValue(
        of({ projects: [{ projectId: 'p1', name: 'p1' }] }),
      );

      const call = service.getBatchProjectsBranches('org-1', 'user-1', [
        'p1',
        'p-other-team',
        'p-other-org',
      ]);

      await expect(call).rejects.toBeInstanceOf(ForbiddenException);
      await call.catch((err: ForbiddenException) => {
        const text = JSON.stringify(err.getResponse());
        expect(text).not.toContain('p-other-team');
        expect(text).not.toContain('p-other-org');
        expect(text).not.toContain('p1');
      });
      expect(grpcStub.getProjectBranches).not.toHaveBeenCalled();
    });

    it('fails closed: when the readable set cannot be read, nothing is fanned out', async () => {
      projectGrpcStub.getReadableProjectsInOrganization.mockImplementation(
        () => throwError(() => new Error('gm down')) as any,
      );

      await expect(
        service.getBatchProjectsBranches('org-1', 'user-1', ['p1']),
      ).rejects.toBeDefined();
      expect(grpcStub.getProjectBranches).not.toHaveBeenCalled();
      expect(projectGrpcStub.getArchivedBranches).not.toHaveBeenCalled();
    });

    it('refuses without a caller, without asking global-management', async () => {
      await expect(
        service.getBatchProjectsBranches('org-1', '', ['p1']),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        projectGrpcStub.getReadableProjectsInOrganization,
      ).not.toHaveBeenCalled();
    });
  });
  describe('revealSecret', () => {
    beforeEach(() => {
      grpcStub.revealSecret = jest.fn();
    });

    it('calls revealSecret on gRPC client and returns response', async () => {
      const grpcRes = {
        secret: 'ghp_supersecret',
        revealedAt: '2026-04-09T12:00:00Z',
      };
      grpcStub.revealSecret.mockReturnValue(of(grpcRes) as any);
      const req = {
        projectId: 'proj-1',
        vulnerabilityId: 'vuln-1',
        userId: 'user-1',
      };
      const result = await service.revealSecret(req);
      expect(result).toEqual(grpcRes);
      expect(grpcStub.revealSecret).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    });
  });

  describe('rotateSecret', () => {
    beforeEach(() => {
      grpcStub.rotateSecret = jest.fn();
    });

    it('calls rotateSecret on gRPC client and returns response', async () => {
      const grpcRes = { state: 'resolved' };
      grpcStub.rotateSecret.mockReturnValue(of(grpcRes) as any);
      const req = {
        projectId: 'proj-1',
        vulnerabilityId: 'vuln-1',
        userId: 'user-1',
      };
      const result = await service.rotateSecret(req);
      expect(result).toEqual(grpcRes);
      expect(grpcStub.rotateSecret).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    });
  });

  describe('getGeneratedReport', () => {
    it('delegates to the gRPC client with projectId + reportId', async () => {
      const grpcRes = {
        reportId: 'rep-1',
        status: 'ready',
        downloadUrl: 'https://signed/fresh',
      };
      grpcStub.getGeneratedReport.mockReturnValue(of(grpcRes) as any);

      const result = await service.getGeneratedReport('proj-1', 'rep-1');

      expect(result).toEqual(grpcRes);
      expect(grpcStub.getGeneratedReport).toHaveBeenCalledWith(
        { projectId: 'proj-1', reportId: 'rep-1' },
        expect.anything(),
      );
    });
  });

  // Delete proxies
  describe('deleteGeneratedReport', () => {
    it('delegates to the gRPC client with projectId + reportId', async () => {
      grpcStub.deleteGeneratedReport.mockReturnValue(
        of({ success: true }) as any,
      );

      const result = await service.deleteGeneratedReport('proj-1', 'rep-1');

      expect(result).toEqual({ success: true });
      expect(grpcStub.deleteGeneratedReport).toHaveBeenCalledWith(
        { projectId: 'proj-1', reportId: 'rep-1' },
        expect.anything(),
      );
    });
  });

  describe('deleteAggregatedReport', () => {
    it('delegates scope + org + reportId to the gRPC client', async () => {
      grpcStub.deleteAggregatedReport.mockReturnValue(
        of({ success: true }) as any,
      );

      const result = await service.deleteAggregatedReport(
        'organization',
        'org-1',
        'org-1',
        'rep-1',
      );

      expect(result).toEqual({ success: true });
      expect(grpcStub.deleteAggregatedReport).toHaveBeenCalledWith(
        {
          scopeType: 'organization',
          scopeId: 'org-1',
          organizationId: 'org-1',
          reportId: 'rep-1',
        },
        expect.anything(),
      );
    });
  });

  describe('listGeneratedReports', () => {
    it('delegates projectId + pagination to the gRPC client', async () => {
      grpcStub.listGeneratedReports.mockReturnValue(
        of({ items: [], total: 0, page: 1, pageSize: 20 }) as any,
      );

      const result = await service.listGeneratedReports('proj-1', 2, 50);

      expect(result.total).toBe(0);
      expect(grpcStub.listGeneratedReports).toHaveBeenCalledWith(
        { projectId: 'proj-1', page: 2, pageSize: 50 },
        expect.anything(),
      );
    });
  });

  describe('listAggregatedReports', () => {
    it('delegates scope + org + pagination to the gRPC client', async () => {
      grpcStub.listAggregatedReports.mockReturnValue(
        of({ items: [], total: 0, page: 1, pageSize: 20 }) as any,
      );

      const result = await service.listAggregatedReports(
        'organization',
        'org-1',
        'org-1',
        1,
        20,
      );

      expect(result.total).toBe(0);
      expect(grpcStub.listAggregatedReports).toHaveBeenCalledWith(
        {
          scopeType: 'organization',
          scopeId: 'org-1',
          organizationId: 'org-1',
          page: 1,
          pageSize: 20,
        },
        expect.anything(),
      );
    });
  });

  describe('getReportUsage', () => {
    it('defaults the missing identifier to "" (query by projectId)', async () => {
      grpcStub.getReportUsage.mockReturnValue(
        of({ used: 3, limit: 500 }) as any,
      );

      const result = await service.getReportUsage({ projectId: 'p1' });

      expect(result).toEqual({ used: 3, limit: 500 });
      expect(grpcStub.getReportUsage).toHaveBeenCalledWith(
        { organizationId: '', projectId: 'p1' },
        expect.anything(),
      );
    });

    it('defaults the missing identifier to "" (query by organizationId)', async () => {
      grpcStub.getReportUsage.mockReturnValue(
        of({ used: 7, limit: 1000 }) as any,
      );

      const result = await service.getReportUsage({ organizationId: 'org-1' });

      expect(result).toEqual({ used: 7, limit: 1000 });
      expect(grpcStub.getReportUsage).toHaveBeenCalledWith(
        { organizationId: 'org-1', projectId: '' },
        expect.anything(),
      );
    });
  });

  describe('getProjectBranchesList', () => {
    // The list reads organizationId, the link flags and defaultBranch. A
    // full ProjectService/Get would also count vulnerabilities in
    // analysis-reporting, the slow part. The integration status, which carries the link flags and
    // defaultBranch, is kept.
    it('reads the project without its vulnerability stats nor security context', async () => {
      projectGrpcStub.get.mockReturnValue(
        of({
          isGithubLinked: false,
          isGitlabLinked: false,
          defaultBranch: 'develop',
          organizationId: 'org-1',
        }) as any,
      );
      projectGrpcStub.getArchivedBranches.mockReturnValue(
        of({ branches: [] }) as any,
      );
      scanGrpcStub.getProjectBranchesFromScansPaginated.mockReturnValue(
        of({ branches: [], total: 0 }) as any,
      );

      const result = await service.getProjectBranchesList('proj-1', {});

      expect(projectGrpcStub.get).toHaveBeenCalledTimes(1);
      expect(projectGrpcStub.get.mock.calls[0][0]).toEqual({
        projectId: 'proj-1',
        skipVulnerabilityStats: true,
        skipSecurityContext: true,
      });
      expect(result.defaultBranch).toBe('develop');
    });

    it('routes a GitHub-linked project to the github client, passes archivedNames, maps branches and computes hasMore', async () => {
      projectGrpcStub.get.mockReturnValue(
        of({
          isGithubLinked: true,
          isGitlabLinked: false,
          defaultBranch: 'main',
          organizationId: 'org-1',
        }) as any,
      );
      projectGrpcStub.getArchivedBranches.mockReturnValue(
        of({ branches: ['old-branch'] }) as any,
      );
      githubGrpcStub.getRepositoryBranchesPaginated.mockReturnValue(
        of({
          branches: [
            {
              name: 'main',
              isDefault: true,
              isProtected: true,
              archived: false,
            },
            {
              name: 'feature/x',
              isDefault: false,
              isProtected: false,
              archived: false,
            },
          ],
          total: 50,
          defaultBranch: 'main',
          scanBranch: 'main',
        }) as any,
      );

      const result = await service.getProjectBranchesList('proj-1', {
        search: 'feat',
        page: 1,
        pageSize: 30,
        includeArchived: false,
      });

      expect(
        githubGrpcStub.getRepositoryBranchesPaginated,
      ).toHaveBeenCalledWith(
        {
          organizationId: 'org-1',
          projectId: 'proj-1',
          search: 'feat',
          page: 1,
          pageSize: 30,
          includeArchived: false,
          archivedNames: ['old-branch'],
        },
        expect.anything(),
      );
      expect(
        scanGrpcStub.getProjectBranchesFromScansPaginated,
      ).not.toHaveBeenCalled();
      expect(result.branches).toEqual([
        { name: 'main', isDefault: true, isProtected: true, archived: false },
        {
          name: 'feature/x',
          isDefault: false,
          isProtected: false,
          archived: false,
        },
      ]);
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 30,
        total: 50,
        // 1 * 30 < 50 → more pages remain
        hasMore: true,
      });
      expect(result.defaultBranch).toBe('main');
      expect(result.scanBranch).toBe('main');
    });

    it('routes a native project to the scan client, passes defaultBranch, maps rows with isProtected:false and hasMore:false', async () => {
      projectGrpcStub.get.mockReturnValue(
        of({
          isGithubLinked: false,
          isGitlabLinked: false,
          defaultBranch: 'develop',
          organizationId: 'org-2',
        }) as any,
      );
      projectGrpcStub.getArchivedBranches.mockReturnValue(
        of({ branches: [] }) as any,
      );
      scanGrpcStub.getProjectBranchesFromScansPaginated.mockReturnValue(
        of({
          branches: [
            { name: 'develop', isDefault: true, archived: false },
            { name: 'staging', isDefault: false, archived: false },
          ],
          total: 2,
        }) as any,
      );

      const result = await service.getProjectBranchesList('proj-2', {
        search: '',
        page: 1,
        pageSize: 30,
        includeArchived: false,
      });

      expect(
        scanGrpcStub.getProjectBranchesFromScansPaginated,
      ).toHaveBeenCalledWith(
        {
          projectId: 'proj-2',
          search: '',
          page: 1,
          pageSize: 30,
          includeArchived: false,
          archivedNames: [],
          defaultBranch: 'develop',
        },
        expect.anything(),
      );
      expect(
        githubGrpcStub.getRepositoryBranchesPaginated,
      ).not.toHaveBeenCalled();
      expect(result.branches).toEqual([
        {
          name: 'develop',
          isDefault: true,
          isProtected: false,
          archived: false,
        },
        {
          name: 'staging',
          isDefault: false,
          isProtected: false,
          archived: false,
        },
      ]);
      // total (2) <= pageSize (30) → no further pages
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 30,
        total: 2,
        hasMore: false,
      });
      expect(result.defaultBranch).toBe('develop');
      expect(result.scanBranch).toBe('');
    });

    it('routes a GitLab-linked project to the gitlab client', async () => {
      projectGrpcStub.get.mockReturnValue(
        of({
          isGithubLinked: false,
          isGitlabLinked: true,
          defaultBranch: 'main',
          organizationId: 'org-3',
        }) as any,
      );
      gitlabGrpcStub.getGitlabRepositoryBranchesPaginated.mockReturnValue(
        of({
          branches: [
            {
              name: 'main',
              isDefault: true,
              isProtected: true,
              archived: false,
            },
          ],
          total: 1,
          defaultBranch: 'main',
          scanBranch: 'release',
        }) as any,
      );

      const result = await service.getProjectBranchesList('proj-3', {
        page: 1,
        pageSize: 30,
      });

      expect(
        gitlabGrpcStub.getGitlabRepositoryBranchesPaginated,
      ).toHaveBeenCalledWith(
        {
          organizationId: 'org-3',
          projectId: 'proj-3',
          search: '',
          page: 1,
          pageSize: 30,
          includeArchived: false,
          archivedNames: [],
        },
        expect.anything(),
      );
      expect(result.scanBranch).toBe('release');
      expect(result.pagination.hasMore).toBe(false);
    });
  });

  describe('batchUpdate (async enqueue)', () => {
    it('calls enqueueBatchUpdate with mapped request and returns taskId/status/total', async () => {
      const grpcResponse: EnqueueBatchUpdateResponse = {
        taskId: 't1',
        total: 3,
      };
      grpcStub.enqueueBatchUpdate.mockReturnValue(of(grpcResponse) as any);

      const items = [
        { vulnerabilityId: 'v1', status: 'resolved' },
        { vulnerabilityId: 'v2', priority: 'high' },
        { vulnerabilityId: 'v3', comment: 'ok' },
      ];
      const result = await service.batchUpdate('proj-1', items, 'user-42');

      const expectedRequest: EnqueueBatchUpdateRequest = {
        projectId: 'proj-1',
        userId: 'user-42',
        items: items.map((i) => ({
          vulnerabilityId: i.vulnerabilityId,
          status: i.status,
          priority: i.priority,
          comment: i.comment,
        })),
        agentToolCallId: '',
        agentConversationId: '',
        agentStreamId: '',
      };
      expect(grpcStub.enqueueBatchUpdate).toHaveBeenCalledWith(
        expectedRequest,
        expect.anything(),
      );
      expect(result).toEqual({ taskId: 't1', status: 'queued', total: 3 });
    });

    it('always sends empty assistant audit fields', async () => {
      grpcStub.enqueueBatchUpdate.mockReturnValue(
        of({ taskId: 'task-abc', total: 1 }) as any,
      );

      await service.batchUpdate('proj-2', [{ vulnerabilityId: 'v1' }], 'u1');

      expect(grpcStub.enqueueBatchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          agentToolCallId: '',
          agentConversationId: '',
          agentStreamId: '',
        }),
        expect.anything(),
      );
    });

    // The per-item reason has to survive this mapping.
    // The batch item is a SEPARATE proto message; dropping the field here makes
    // bulk dismissal impossible once `assertDismissalReason` lands, because the
    // async worker rebuilds each UpdateResultRequest from exactly these items.
    it('maps the per-item dismissalReason into the enqueue request', async () => {
      grpcStub.enqueueBatchUpdate.mockReturnValue(
        of({ taskId: 't2', total: 1 }) as any,
      );

      await service.batchUpdate(
        'proj-3',
        [
          {
            vulnerabilityId: 'v9',
            status: 'ignored',
            dismissalReason: 'compensating control in place',
          },
        ],
        'u1',
      );

      expect(grpcStub.enqueueBatchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              vulnerabilityId: 'v9',
              status: 'ignored',
              dismissalReason: 'compensating control in place',
            }),
          ],
        }),
        expect.anything(),
      );
    });
  });

  describe('split overview methods', () => {
    it('maps filters into the shared OrganizationOverviewFilter for severity', async () => {
      const grpcMock = jest
        .fn()
        .mockReturnValue(
          of({ totalBySeverity: [{ severity: 'CRITICAL', count: 1 }] }),
        );
      (service as any).resultServiceClient.getOrganizationSeverityDistribution =
        grpcMock;

      const res = await service.getOrganizationSeverityDistribution(
        'org-1',
        'user-1',
        {
          severityFilter: ['CRITICAL'],
          branches: ['main'],
        },
      );

      expect(grpcMock).toHaveBeenCalledWith(
        {
          filter: expect.objectContaining({
            organizationId: 'org-1',
            userId: 'user-1',
            severityFilter: ['CRITICAL'],
            branches: ['main'],
          }),
        },
        expect.anything(),
      );
      expect(res.totalBySeverity).toEqual([{ severity: 'CRITICAL', count: 1 }]);
    });
  });
});
