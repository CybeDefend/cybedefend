import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { McpProjectController } from './mcp-project.controller';
import { ProjectService } from './project.service';

function buildController() {
  const projectService = { getProjectsOrganization: jest.fn() };
  const controller = new McpProjectController(
    projectService as unknown as ProjectService,
  );
  return { controller, projectService };
}

describe('McpProjectController', () => {
  it('builds the request from query + user and returns a slim list', async () => {
    const { controller, projectService } = buildController();
    projectService.getProjectsOrganization.mockResolvedValue({
      projects: [
        {
          projectId: 'p1',
          name: 'api',
          teamName: 'Backend',
          cyberRiskLevel: 'critical',
          cyberRiskScore: 100,
          issuesCount: { critical: 1, high: 2, medium: 3, low: 4 },
          analyses: [{ type: 'SAST' }],
          isGithubLinked: true,
        },
      ],
      totalProjects: 1,
      totalPages: 1,
      mainStatistics: { x: 1 },
    });

    const result = await controller.getProjects(
      'org1',
      { page: 1, pageSize: 10, search: 'api' } as never,
      { user: { sub: 'u1' } },
    );

    expect(projectService.getProjectsOrganization).toHaveBeenCalledWith({
      teamId: 'org1',
      pageNumber: 1,
      pageSizeNumber: 10,
      searchQuery: 'api',
      userId: 'u1',
    });

    expect(result).toEqual({
      projects: [
        {
          projectId: 'p1',
          name: 'api',
          teamName: 'Backend',
          cyberRiskLevel: 'critical',
          cyberRiskScore: 100,
          issuesCount: { critical: 1, high: 2, medium: 3, low: 4 },
        },
      ],
      totalProjects: 1,
      totalPages: 1,
    });
    expect(result.projects[0]).not.toHaveProperty('analyses');
    expect(result).not.toHaveProperty('mainStatistics');
  });

  it('defaults an empty search to an empty string', async () => {
    const { controller, projectService } = buildController();
    projectService.getProjectsOrganization.mockResolvedValue({
      projects: [],
      totalProjects: 0,
      totalPages: 0,
    });

    await controller.getProjects('org1', { page: 1, pageSize: 10 } as never, {
      user: { sub: 'u1' },
    });

    expect(
      projectService.getProjectsOrganization.mock.calls[0][0].searchQuery,
    ).toBe('');
  });

  describe('authorization posture (regression guard)', () => {
    it('guards getProjects with organization:read + PermissionsGuard', () => {
      const fn = McpProjectController.prototype.getProjects;
      expect(Reflect.getMetadata('permissions', fn)).toEqual(
        expect.arrayContaining(['read']),
      );
      expect(Reflect.getMetadata('subjectTypes', fn)).toEqual(
        expect.arrayContaining(['organization']),
      );
      expect(Reflect.getMetadata(GUARDS_METADATA, fn) ?? []).toContain(
        PermissionsGuard,
      );
    });

    it('applies the auth + rate-limit guard at the controller class level', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, McpProjectController),
      ).toContain(CombinedAuthRateLimitGuard);
    });
  });
});
