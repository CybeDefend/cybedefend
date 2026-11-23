import { Test, TestingModule } from '@nestjs/testing';
import { ClientGrpc } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';

import { ProjectService } from './project.service';
import {
  PROJECT_SERVICE_NAME,
  ProjectServiceClient,
} from '@grpc/global-management/global_management';

import {
  ProjectGetAllRequest,
  ProjectGetRequest,
  ProjectCreateRequest,
  ProjectUpdateRequest,
  ProjectDeleteRequest,
  PaginatedProjectsAllInformationsResponse,
  PaginatedProjectsResponse,
  ProjectInformationsResponse,
  ProjectUpdateResponse,
  ProjectDeleteResponse,
} from '@grpc/global-management/project';

describe('ProjectService', () => {
  let service: ProjectService;
  let clientMock: jest.Mocked<ClientGrpc>;
  let grpcStub: jest.Mocked<ProjectServiceClient>;
  let resultStub: { getOrganizationStatistics: jest.Mock };

  beforeEach(async () => {
    grpcStub = {
      getAllFromOrganization: jest.fn(),
      getAllFromTeam: jest.fn(),
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as any;

    clientMock = {
      getService: jest.fn().mockReturnValue(grpcStub),
    } as any;
    resultStub = { getOrganizationStatistics: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: 'GLOBAL_MANAGEMENT_SERVICE', useValue: clientMock },
        {
          provide: 'ANALYSIS_REPORTING_SERVICE',
          useValue: { getService: jest.fn().mockReturnValue(resultStub) },
        },
      ],
    }).compile();

    service = module.get(ProjectService);
    service.onModuleInit();
  });

  it(
    'should init gRPC client',
    () => {
      expect(clientMock.getService).toHaveBeenCalledWith(PROJECT_SERVICE_NAME);
    },
    expect.anything(),
  );

  it(
    'getProjectsOrganization returns data',
    async () => {
      const req: ProjectGetAllRequest = {
        teamId: 'org1',
        pageNumber: 1,
        pageSizeNumber: 10,
        searchQuery: '',
        userId: 'u1',
      };
      const res: PaginatedProjectsAllInformationsResponse = {
        projects: [],
        totalProjects: 0,
        totalPages: 0,
      } as any;
      grpcStub.getAllFromOrganization.mockReturnValue(of(res) as any);
      await expect(service.getProjectsOrganization(req)).resolves.toEqual(res);
      expect(grpcStub.getAllFromOrganization).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    },
    expect.anything(),
  );

  it('getProjectsOrganization propagates error', async () => {
    grpcStub.getAllFromOrganization.mockReturnValue(
      throwError(() => new Error('boom')) as any,
    );
    await expect(
      service.getProjectsOrganization({
        teamId: 'org',
        pageNumber: 1,
        pageSizeNumber: 10,
        searchQuery: '',
        userId: 'u1',
      }),
    ).rejects.toThrow('boom');
  });

  it(
    'getProjectsTeam returns data',
    async () => {
      const req: ProjectGetAllRequest = {
        teamId: 't1',
        pageNumber: 2,
        pageSizeNumber: 5,
        searchQuery: 'q',
        userId: 'u1',
      };
      const res: PaginatedProjectsResponse = {
        projects: [],
        totalProjects: 0,
        totalPages: 0,
      } as any;
      grpcStub.getAllFromTeam.mockReturnValue(of(res) as any);
      await expect(service.getProjectsTeam(req)).resolves.toEqual(res);
      expect(grpcStub.getAllFromTeam).toHaveBeenCalledWith(
        req,
        expect.anything(),
      );
    },
    expect.anything(),
  );

  it(
    'getProject returns data',
    async () => {
      const req: ProjectGetRequest = { projectId: 'p1' };
      const res: ProjectInformationsResponse = {
        id: 'p1',
        name: 'Proj',
        teamId: 't1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any;
      grpcStub.get.mockReturnValue(of(res) as any);
      await expect(service.getProject(req)).resolves.toMatchObject(res);
      expect(grpcStub.get).toHaveBeenCalledWith(req, expect.anything());
    },
    expect.anything(),
  );

  it(
    'createProject returns response',
    async () => {
      const req: ProjectCreateRequest = {
        name: 'New',
        teamId: 't1',
        creatorId: 'u1',
      } as any;
      const res: ProjectInformationsResponse = {
        id: 'p1',
        name: 'New',
        teamId: 't1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any;
      grpcStub.create.mockReturnValue(of(res) as any);
      await expect(service.createProject(req)).resolves.toEqual(res);
      expect(grpcStub.create).toHaveBeenCalledWith(req, expect.anything());
    },
    expect.anything(),
  );

  it(
    'updateProject returns response',
    async () => {
      const req: ProjectUpdateRequest = { projectId: 'p1', name: 'N' } as any;
      const res: ProjectUpdateResponse = {
        message: 'updated',
        updatedProject: {
          id: 'p1',
          name: 'N',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      } as any;
      grpcStub.update.mockReturnValue(of(res) as any);
      await expect(service.updateProject(req)).resolves.toEqual(res);
      expect(grpcStub.update).toHaveBeenCalledWith(req, expect.anything());
    },
    expect.anything(),
  );

  it(
    'deleteProject returns response',
    async () => {
      const req: ProjectDeleteRequest = { projectId: 'p1' };
      const res: ProjectDeleteResponse = { message: 'deleted' } as any;
      grpcStub.delete.mockReturnValue(of(res) as any);
      await expect(service.deleteProject(req)).resolves.toEqual(res);
      expect(grpcStub.delete).toHaveBeenCalledWith(req, expect.anything());
    },
    expect.anything(),
  );

  // global-management only relayed main-statistics to analysis-reporting,
  // an extra hop for no work. The gateway reads it there itself, and keeps the zero
  // fallback global-management applied.
  describe('getOrganizationMainStatistics', () => {
    it('reads the persisted org statistics from analysis-reporting, not through global-management', async () => {
      resultStub.getOrganizationStatistics.mockReturnValue(
        of({
          projectIds: ['p1', 'p2'],
          criticalRiskProjects: 3,
          criticalRiskProjectsInLast7Days: 1,
          highRiskProjects: 4,
          solvedIssues: 9,
          newIssues: 2,
          criticalIssues: 12,
          highIssues: 5,
          mediumIssues: 7,
          lowIssues: 1,
          agentAnalysesCount: 20,
          agentFalsePositiveCount: 6,
        }),
      );
      (grpcStub as any).getOrganizationMainStatistics = jest.fn();

      const res = await service.getOrganizationMainStatistics({
        organizationId: 'org-1',
        userId: 'u1',
      });

      // The caller is forwarded: analysis-reporting narrows the figures to
      // the projects this user may read.
      expect(resultStub.getOrganizationStatistics).toHaveBeenCalledWith(
        { organizationId: 'org-1', userId: 'u1' },
        expect.anything(),
      );
      expect(
        (grpcStub as any).getOrganizationMainStatistics,
      ).not.toHaveBeenCalled();
      // The KPI cards only: the project ids of the persisted row stay in
      // analysis-reporting, and a missing counter reads 0.
      expect(res).toEqual({
        criticalRiskProjects: 3,
        criticalRiskProjectsInLast7Days: 1,
        highRiskProjects: 4,
        highRiskProjectsInLast7Days: 0,
        solvedIssues: 9,
        solvedIssuesInLast7Days: 0,
        newIssues: 2,
        newIssuesInLast7Days: 0,
        criticalIssues: 12,
        highIssues: 5,
        mediumIssues: 7,
        lowIssues: 1,
        agentAnalysesCount: 20,
        agentAutofixCount: 0,
        agentTriageCount: 0,
        agentFalsePositiveCount: 6,
      });
    });

    it('answers zeros when analysis-reporting fails, as global-management did', async () => {
      resultStub.getOrganizationStatistics.mockReturnValue(
        throwError(() => ({ code: 14, details: 'unavailable' })),
      );

      const res = await service.getOrganizationMainStatistics({
        organizationId: 'org-1',
        userId: 'u1',
      });

      expect(res).toEqual({
        criticalRiskProjects: 0,
        criticalRiskProjectsInLast7Days: 0,
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
        agentAnalysesCount: 0,
        agentAutofixCount: 0,
        agentTriageCount: 0,
        agentFalsePositiveCount: 0,
      });
    });
  });
});
