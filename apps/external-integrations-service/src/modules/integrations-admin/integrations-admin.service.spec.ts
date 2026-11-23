import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { IntegrationsAdminService } from './integrations-admin.service';
import { JiraIntegration } from '../../entities/jira-integration.entity';
import { LinearIntegration } from '../../entities/linear-integration.entity';
import { GithubIntegration } from '../../entities/github-integration.entity';
import { GitlabIntegration } from '../../entities/gitlab-integration.entity';
import { SlackIntegration } from '../../entities/slack-integration.entity';
import {
  CONTAINER_REGISTRIES_ADMIN_PORT,
  type ContainerRegistriesAdminPort,
} from '../../edition/ports/container-registries-admin.port';
import { createLoggerMock } from '../../test-utils/mocks';

function makeRepo(): Partial<Repository<any>> {
  const qb = {
    select: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  return {
    count: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(() => qb) as any,
  };
}

/** Rows the repo's DISTINCT organizationId query resolves to. */
function distinctRows(repo: Partial<Repository<any>>, rows: unknown[]) {
  (repo.createQueryBuilder as jest.Mock)().getRawMany.mockResolvedValue(rows);
}

function distinctRejects(repo: Partial<Repository<any>>, err: Error) {
  (repo.createQueryBuilder as jest.Mock)().getRawMany.mockRejectedValue(err);
}

describe('IntegrationsAdminService', () => {
  let service: IntegrationsAdminService;
  let jiraRepo: ReturnType<typeof makeRepo>;
  let linearRepo: ReturnType<typeof makeRepo>;
  let githubRepo: ReturnType<typeof makeRepo>;
  let gitlabRepo: ReturnType<typeof makeRepo>;
  let slackRepo: ReturnType<typeof makeRepo>;
  let registries: jest.Mocked<ContainerRegistriesAdminPort>;

  const orgId = 'org-1';

  beforeEach(async () => {
    jiraRepo = makeRepo();
    linearRepo = makeRepo();
    githubRepo = makeRepo();
    gitlabRepo = makeRepo();
    slackRepo = makeRepo();
    registries = {
      listOrganizationIds: jest.fn().mockResolvedValue([]),
      countForOrg: jest.fn().mockResolvedValue(0),
      deleteForOrg: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsAdminService,
        { provide: Logger, useValue: createLoggerMock() },
        { provide: getRepositoryToken(JiraIntegration), useValue: jiraRepo },
        {
          provide: getRepositoryToken(LinearIntegration),
          useValue: linearRepo,
        },
        {
          provide: getRepositoryToken(GithubIntegration),
          useValue: githubRepo,
        },
        {
          provide: getRepositoryToken(GitlabIntegration),
          useValue: gitlabRepo,
        },
        { provide: getRepositoryToken(SlackIntegration), useValue: slackRepo },
        {
          provide: CONTAINER_REGISTRIES_ADMIN_PORT,
          useValue: registries,
        },
      ],
    }).compile();

    service = module.get(IntegrationsAdminService);
  });

  describe('countIntegrationsForOrg', () => {
    it('counts jira integrations', async () => {
      (jiraRepo.count as jest.Mock).mockResolvedValue(2);
      const result = await service.countIntegrationsForOrg(orgId, 'jira');
      expect(result).toBe(2);
      expect(jiraRepo.count).toHaveBeenCalledWith({
        where: { organizationId: orgId },
      });
    });

    it('counts linear integrations (LinearIntegration)', async () => {
      (linearRepo.count as jest.Mock).mockResolvedValue(1);
      const result = await service.countIntegrationsForOrg(orgId, 'linear');
      expect(result).toBe(1);
      expect(linearRepo.count).toHaveBeenCalledWith({
        where: { organizationId: orgId },
      });
    });

    it('counts github_issues integrations (GithubIntegration)', async () => {
      (githubRepo.count as jest.Mock).mockResolvedValue(3);
      const result = await service.countIntegrationsForOrg(
        orgId,
        'github_issues',
      );
      expect(result).toBe(3);
      expect(githubRepo.count).toHaveBeenCalledWith({
        where: { organizationId: orgId },
      });
    });

    it('counts gitlab_issues integrations (GitlabIntegration)', async () => {
      (gitlabRepo.count as jest.Mock).mockResolvedValue(1);
      const result = await service.countIntegrationsForOrg(
        orgId,
        'gitlab_issues',
      );
      expect(result).toBe(1);
    });

    it('counts slack integrations', async () => {
      (slackRepo.count as jest.Mock).mockResolvedValue(4);
      const result = await service.countIntegrationsForOrg(orgId, 'slack');
      expect(result).toBe(4);
    });

    it('counts container_registry through the admin port', async () => {
      registries.countForOrg.mockResolvedValue(7);

      const result = await service.countIntegrationsForOrg(
        orgId,
        'container_registry',
      );
      expect(result).toBe(7);
      expect(registries.countForOrg).toHaveBeenCalledWith(orgId);
    });

    it('answers 0 when the admin port fails (fail-soft)', async () => {
      registries.countForOrg.mockRejectedValue(new Error('boom'));

      const result = await service.countIntegrationsForOrg(
        orgId,
        'container_registry',
      );
      expect(result).toBe(0);
    });

    it('returns 0 for unknown type', async () => {
      const result = await service.countIntegrationsForOrg(orgId, 'unknown');
      expect(result).toBe(0);
    });
  });

  describe('deleteIntegrationsForOrg', () => {
    it('deletes jira integrations and returns count', async () => {
      (jiraRepo.delete as jest.Mock).mockResolvedValue({ affected: 2 });
      const result = await service.deleteIntegrationsForOrg(orgId, ['jira']);
      expect(result).toEqual({ jira: 2 });
      expect(jiraRepo.delete).toHaveBeenCalledWith({ organizationId: orgId });
    });

    // The Linear project settings go with the installation through the foreign
    // key (ON DELETE CASCADE). The issue links (vulnerability_issue_mapping)
    // have no foreign key to it and are not deleted here.
    it('deleteIntegrationsForOrg deletes the Linear integration', async () => {
      (linearRepo.delete as jest.Mock).mockResolvedValue({ affected: 1 });
      const result = await service.deleteIntegrationsForOrg(orgId, ['linear']);
      expect(result).toEqual({ linear: 1 });
      expect(linearRepo.delete).toHaveBeenCalledWith({
        organizationId: orgId,
      });
      expect(jiraRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes multiple types', async () => {
      (jiraRepo.delete as jest.Mock).mockResolvedValue({ affected: 1 });
      (githubRepo.delete as jest.Mock).mockResolvedValue({ affected: 2 });
      (gitlabRepo.delete as jest.Mock).mockResolvedValue({ affected: 0 });

      const result = await service.deleteIntegrationsForOrg(orgId, [
        'jira',
        'github_issues',
        'gitlab_issues',
      ]);

      expect(result).toEqual({
        jira: 1,
        github_issues: 2,
        gitlab_issues: 0,
      });
    });

    it('deletes container_registry through the admin port', async () => {
      registries.deleteForOrg.mockResolvedValue(4);

      const result = await service.deleteIntegrationsForOrg(orgId, [
        'container_registry',
      ]);
      expect(result).toEqual({ container_registry: 4 });
      expect(registries.deleteForOrg).toHaveBeenCalledWith(orgId, {});
    });

    it('continues with other types when one fails (fail-soft)', async () => {
      (jiraRepo.delete as jest.Mock).mockRejectedValue(new Error('boom'));
      (slackRepo.delete as jest.Mock).mockResolvedValue({ affected: 1 });
      registries.deleteForOrg.mockRejectedValue(new Error('registry boom'));

      const result = await service.deleteIntegrationsForOrg(orgId, [
        'jira',
        'slack',
        'container_registry',
      ]);

      // Failed type reports 0; successful type reports its count
      expect(result).toEqual({ jira: 0, slack: 1, container_registry: 0 });
    });

    // The organization purge must not answer "complete" over rows a failed
    // delete left behind: it asks for the first failure to be thrown.
    it('throws the first failure when asked to fail closed', async () => {
      (jiraRepo.delete as jest.Mock).mockRejectedValue(new Error('boom'));
      (slackRepo.delete as jest.Mock).mockResolvedValue({ affected: 1 });

      await expect(
        service.deleteIntegrationsForOrg(orgId, ['jira', 'slack'], {
          failClosed: true,
        }),
      ).rejects.toThrow('boom');
      expect(slackRepo.delete).not.toHaveBeenCalled();
    });

    it('rethrows a container_registry failure when asked to fail closed', async () => {
      registries.deleteForOrg.mockRejectedValue(new Error('registry boom'));

      await expect(
        service.deleteIntegrationsForOrg(orgId, ['container_registry'], {
          failClosed: true,
        }),
      ).rejects.toThrow('registry boom');
      expect(registries.deleteForOrg).toHaveBeenCalledWith(orgId, {
        failClosed: true,
      });
    });

    it('skips unknown types silently', async () => {
      const result = await service.deleteIntegrationsForOrg(orgId, ['unknown']);
      expect(result).toEqual({ unknown: 0 });
    });
  });

  describe('ALL_TYPES', () => {
    it('ALL_TYPES includes linear', () => {
      expect(IntegrationsAdminService.ALL_TYPES).toContain('linear');
    });

    it('ALL_TYPES keeps container_registry, owned by the admin port', () => {
      expect(IntegrationsAdminService.ALL_TYPES).toContain(
        'container_registry',
      );
    });
  });

  // Needed to find integration rows whose organization no longer
  // exists in global-management (orphans left by org deletions that predate
  // the cleanup wired into deleteOrganization).
  describe('listOrganizationIdsWithIntegrations', () => {
    it('returns the distinct organization ids across every integration table', async () => {
      distinctRows(jiraRepo, [
        { organizationId: 'org-a' },
        { organizationId: 'org-b' },
      ]);
      distinctRows(slackRepo, [{ organizationId: 'org-b' }]);
      registries.listOrganizationIds.mockResolvedValue(['org-c']);

      const result = await service.listOrganizationIdsWithIntegrations();

      expect([...result].sort()).toEqual(['org-a', 'org-b', 'org-c']);
    });

    it('includes the organisations that only have a Linear integration', async () => {
      distinctRows(linearRepo, [{ organizationId: 'org-linear' }]);

      const result = await service.listOrganizationIdsWithIntegrations();

      expect(result).toEqual(['org-linear']);
    });

    it('ignores rows with an empty organizationId', async () => {
      distinctRows(jiraRepo, [
        { organizationId: 'org-a' },
        { organizationId: null },
        { organizationId: '' },
      ]);

      const result = await service.listOrganizationIdsWithIntegrations();

      expect(result).toEqual(['org-a']);
    });

    it('keeps scanning the other tables when one query fails', async () => {
      distinctRejects(jiraRepo, new Error('boom'));
      distinctRows(slackRepo, [{ organizationId: 'org-b' }]);

      const result = await service.listOrganizationIdsWithIntegrations();

      expect(result).toEqual(['org-b']);
    });

    it('keeps the registry organization ids out when the port fails (fail-soft)', async () => {
      registries.listOrganizationIds.mockRejectedValue(new Error('boom'));
      distinctRows(slackRepo, [{ organizationId: 'org-b' }]);

      const result = await service.listOrganizationIdsWithIntegrations();

      expect(result).toEqual(['org-b']);
    });
  });
});
