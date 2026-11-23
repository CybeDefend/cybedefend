import { Test, TestingModule } from '@nestjs/testing';
import { ClientGrpc } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import { IntegrationOverviewService } from './integration-overview.service';
import {
  GITHUB_SERVICE_NAME,
  GITLAB_SERVICE_NAME,
  SLACK_SERVICE_NAME,
  JIRA_SERVICE_NAME,
  LINEAR_SERVICE_NAME,
} from '@grpc/external-integrations/external_integrations';
import {
  CONTAINER_REGISTRIES_OVERVIEW_PORT,
  type ContainerRegistriesOverviewPort,
} from '../../../edition/ports/container-registries-overview.port';

// Mock safeGrpcCall to return the observable value directly
jest.mock('@grpc/wrapper-grpc', () => ({
  safeGrpcCall: jest.fn((observable) => {
    return new Promise((resolve, reject) => {
      observable.subscribe({
        next: (value: any) => resolve(value),
        error: (err: any) => reject(err),
      });
    });
  }),
}));

// Mock wrapGrpcClientWithTracing to return the service as-is
jest.mock('@grpc/traced-grpc-client', () => ({
  wrapGrpcClientWithTracing: jest.fn((service) => service),
}));

// The count code over the container registries is cloud only and is tested
// with the cloud edition. Here the port is a mock, so this spec holds only the cases the exported
// core can run.
describe('IntegrationOverviewService', () => {
  let service: IntegrationOverviewService;
  let externalIntegrationsClientMock: jest.Mocked<ClientGrpc>;
  let registries: jest.Mocked<ContainerRegistriesOverviewPort>;
  let githubServiceStub: any;
  let gitlabServiceStub: any;
  let slackServiceStub: any;
  let jiraServiceStub: any;
  let linearServiceStub: any;

  const mockOrganizationId = 'org-123';

  const mockGithubInstallation = {
    id: 'github-install-1',
    installationId: 12345678,
    userId: 'user-1',
    organizationId: mockOrganizationId,
    createdAt: '2024-01-15T10:30:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
  };

  const mockGitlabInstallation = {
    id: 'gitlab-install-1',
    userId: 'user-1',
    organizationId: mockOrganizationId,
    gitlabUserId: 987654,
    gitlabGroupId: 123456,
    createdAt: '2024-01-15T10:30:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
  };

  const mockJiraInstallation = {
    id: 'jira-install-1',
    cloudId: 'cloud-12345',
    siteName: 'mycompany.atlassian.net',
    siteUrl: 'https://mycompany.atlassian.net',
    organizationId: mockOrganizationId,
    installedByUserId: 'user-1',
    createdAt: '2024-01-15T10:30:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
  };

  // GetLinearInstallationForOrgaResponse as external-integrations answers it
  // for a connected workspace.
  const mockLinearInstallation = {
    isConfigured: true,
    id: 'linear-install-1',
    linearOrganizationId: 'lin-org-1',
    workspaceName: 'Acme',
    workspaceUrlKey: 'acme',
    organizationId: mockOrganizationId,
    installedByUserId: 'user-1',
    needsReconnect: false,
    createdAt: '2024-01-15T10:30:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
  };

  beforeEach(async () => {
    githubServiceStub = {
      getInstallationForOrga: jest.fn(),
    };

    gitlabServiceStub = {
      getInstallationForOrga: jest.fn(),
    };

    slackServiceStub = {
      getInstallationForOrga: jest.fn(),
    };

    jiraServiceStub = {
      getInstallationForOrga: jest.fn(),
    };

    linearServiceStub = {
      getInstallationForOrga: jest.fn(),
    };

    registries = {
      collectStats: jest.fn().mockResolvedValue({ total: 0, byType: [] }),
    };

    externalIntegrationsClientMock = {
      getService: jest.fn().mockImplementation((serviceName: string) => {
        switch (serviceName) {
          case GITHUB_SERVICE_NAME:
            return githubServiceStub;
          case GITLAB_SERVICE_NAME:
            return gitlabServiceStub;
          case SLACK_SERVICE_NAME:
            return slackServiceStub;
          case JIRA_SERVICE_NAME:
            return jiraServiceStub;
          case LINEAR_SERVICE_NAME:
            return linearServiceStub;
          default:
            return {};
        }
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationOverviewService,
        {
          provide: 'EXTERNAL_INTEGRATIONS_SERVICE',
          useValue: externalIntegrationsClientMock,
        },
        {
          provide: CONTAINER_REGISTRIES_OVERVIEW_PORT,
          useValue: registries,
        },
      ],
    }).compile();

    service = module.get<IntegrationOverviewService>(
      IntegrationOverviewService,
    );
    service.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getIntegrationOverview', () => {
    it('should return complete integration overview with all data', async () => {
      githubServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGithubInstallation),
      );
      gitlabServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGitlabInstallation),
      );
      registries.collectStats.mockResolvedValue({
        total: 4,
        byType: [
          { type: 'gitlab', count: 2 },
          { type: 'dockerhub', count: 1 },
          { type: 'github', count: 1 },
        ],
      });

      const result = await service.getIntegrationOverview(mockOrganizationId);

      expect(result).toBeDefined();
      expect(result.github).toEqual(mockGithubInstallation);
      expect(result.gitlab).toEqual({
        ...mockGitlabInstallation,
        reconnectRequired: false,
      });
      expect(result.containerRegistry.total).toBe(4);
    });

    it('should return null for github when not installed', async () => {
      githubServiceStub.getInstallationForOrga.mockReturnValue(
        throwError(() => new Error('Not found')),
      );
      gitlabServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGitlabInstallation),
      );

      const result = await service.getIntegrationOverview(mockOrganizationId);

      expect(result.github).toBeNull();
      expect(result.gitlab).toEqual({
        ...mockGitlabInstallation,
        reconnectRequired: false,
      });
    });

    it('should return null for gitlab when not connected', async () => {
      githubServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGithubInstallation),
      );
      gitlabServiceStub.getInstallationForOrga.mockReturnValue(
        throwError(() => new Error('Not found')),
      );

      const result = await service.getIntegrationOverview(mockOrganizationId);

      expect(result.github).toEqual(mockGithubInstallation);
      expect(result.gitlab).toBeNull();
    });

    it('should return null for gitlab when gRPC returns empty response (default values)', async () => {
      // gRPC returns empty/default values instead of throwing error
      const emptyGitlabResponse = {
        id: '',
        userId: '',
        organizationId: '',
        gitlabUserId: 0,
        gitlabGroupId: 0,
        createdAt: '',
        updatedAt: '',
      };

      githubServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGithubInstallation),
      );
      gitlabServiceStub.getInstallationForOrga.mockReturnValue(
        of(emptyGitlabResponse),
      );

      const result = await service.getIntegrationOverview(mockOrganizationId);

      expect(result.github).toEqual(mockGithubInstallation);
      expect(result.gitlab).toBeNull();
    });

    it('should return null for github when gRPC returns empty response (default values)', async () => {
      const emptyGithubResponse = {
        id: '',
        installationId: 0,
        userId: '',
        organizationId: '',
        createdAt: '',
        updatedAt: '',
      };

      githubServiceStub.getInstallationForOrga.mockReturnValue(
        of(emptyGithubResponse),
      );
      gitlabServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGitlabInstallation),
      );

      const result = await service.getIntegrationOverview(mockOrganizationId);

      expect(result.github).toBeNull();
      expect(result.gitlab).toEqual({
        ...mockGitlabInstallation,
        reconnectRequired: false,
      });
    });

    it('should return null for both github and gitlab when neither is installed', async () => {
      githubServiceStub.getInstallationForOrga.mockReturnValue(
        throwError(() => new Error('Not found')),
      );
      gitlabServiceStub.getInstallationForOrga.mockReturnValue(
        throwError(() => new Error('Not found')),
      );

      const result = await service.getIntegrationOverview(mockOrganizationId);

      expect(result.github).toBeNull();
      expect(result.gitlab).toBeNull();
      expect(result.containerRegistry.total).toBe(0);
      expect(result.containerRegistry.byType).toEqual([]);
    });

    it('asks the admin port for the registry stats, GitHub installation in hand', async () => {
      githubServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGithubInstallation),
      );
      gitlabServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGitlabInstallation),
      );

      await service.getIntegrationOverview(mockOrganizationId);

      expect(registries.collectStats).toHaveBeenCalledTimes(1);
      expect(registries.collectStats.mock.calls[0][0]).toBe(mockOrganizationId);
      // The installation read is passed along, not awaited here.
      await expect(registries.collectStats.mock.calls[0][1]).resolves.toEqual(
        mockGithubInstallation,
      );
    });

    it('still answers the overview when the registry stats fail', async () => {
      githubServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGithubInstallation),
      );
      gitlabServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGitlabInstallation),
      );
      registries.collectStats.mockRejectedValue(
        new Error('Service unavailable'),
      );

      const result = await service.getIntegrationOverview(mockOrganizationId);

      expect(result.github).toEqual(mockGithubInstallation);
      expect(result.gitlab).toEqual({
        ...mockGitlabInstallation,
        reconnectRequired: false,
      });
    });

    it('should call GitHub and GitLab services with correct organization ID', async () => {
      githubServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGithubInstallation),
      );
      gitlabServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGitlabInstallation),
      );

      await service.getIntegrationOverview(mockOrganizationId);

      expect(githubServiceStub.getInstallationForOrga).toHaveBeenCalledWith({
        organizationId: mockOrganizationId,
      });
      expect(gitlabServiceStub.getInstallationForOrga).toHaveBeenCalledWith({
        organizationId: mockOrganizationId,
      });
    });

    it('should fetch all data in parallel', async () => {
      githubServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGithubInstallation),
      );
      gitlabServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockGitlabInstallation),
      );

      await service.getIntegrationOverview(mockOrganizationId);

      // All sources should be called: the five core integrations, the
      // registries through the port.
      expect(githubServiceStub.getInstallationForOrga).toHaveBeenCalled();
      expect(gitlabServiceStub.getInstallationForOrga).toHaveBeenCalled();
      expect(registries.collectStats).toHaveBeenCalled();
    });

    it('returns Jira installation when present so callers can skip /jira/installation', async () => {
      githubServiceStub.getInstallationForOrga.mockReturnValue(
        throwError(() => new Error('Not found')),
      );
      gitlabServiceStub.getInstallationForOrga.mockReturnValue(
        throwError(() => new Error('Not found')),
      );
      slackServiceStub.getInstallationForOrga.mockReturnValue(
        throwError(() => new Error('Not found')),
      );
      jiraServiceStub.getInstallationForOrga.mockReturnValue(
        of(mockJiraInstallation),
      );

      const result = await service.getIntegrationOverview(mockOrganizationId);

      expect(result.jira).toEqual(mockJiraInstallation);
      expect(jiraServiceStub.getInstallationForOrga).toHaveBeenCalledWith({
        organizationId: mockOrganizationId,
      });
    });

    it('returns null jira when no Jira installation exists for the org', async () => {
      githubServiceStub.getInstallationForOrga.mockReturnValue(
        throwError(() => new Error('Not found')),
      );
      gitlabServiceStub.getInstallationForOrga.mockReturnValue(
        throwError(() => new Error('Not found')),
      );
      slackServiceStub.getInstallationForOrga.mockReturnValue(
        throwError(() => new Error('Not found')),
      );
      jiraServiceStub.getInstallationForOrga.mockReturnValue(
        throwError(() => new Error('Not found')),
      );

      const result = await service.getIntegrationOverview(mockOrganizationId);

      expect(result.jira).toBeNull();
    });

    describe('linear', () => {
      function stubEveryOtherSource() {
        githubServiceStub.getInstallationForOrga.mockReturnValue(
          throwError(() => new Error('Not found')),
        );
        gitlabServiceStub.getInstallationForOrga.mockReturnValue(
          throwError(() => new Error('Not found')),
        );
        slackServiceStub.getInstallationForOrga.mockReturnValue(
          throwError(() => new Error('Not found')),
        );
        jiraServiceStub.getInstallationForOrga.mockReturnValue(
          throwError(() => new Error('Not found')),
        );
      }

      it('includes the Linear installation, without the isConfigured flag', async () => {
        stubEveryOtherSource();
        linearServiceStub.getInstallationForOrga.mockReturnValue(
          of(mockLinearInstallation),
        );

        const result = await service.getIntegrationOverview(mockOrganizationId);

        expect(linearServiceStub.getInstallationForOrga).toHaveBeenCalledWith({
          organizationId: mockOrganizationId,
        });
        expect(result.linear).toEqual({
          id: 'linear-install-1',
          linearOrganizationId: 'lin-org-1',
          workspaceName: 'Acme',
          workspaceUrlKey: 'acme',
          organizationId: mockOrganizationId,
          installedByUserId: 'user-1',
          needsReconnect: false,
          createdAt: '2024-01-15T10:30:00.000Z',
          updatedAt: '2024-01-15T10:30:00.000Z',
        });
      });

      it('says when the workspace must be connected again', async () => {
        stubEveryOtherSource();
        linearServiceStub.getInstallationForOrga.mockReturnValue(
          of({ ...mockLinearInstallation, needsReconnect: true }),
        );

        const result = await service.getIntegrationOverview(mockOrganizationId);

        expect(result.linear.needsReconnect).toBe(true);
      });

      it('is null when the organization has no Linear installation', async () => {
        stubEveryOtherSource();
        // external-integrations answers a normal 200 with isConfigured=false
        // and default values for the rest.
        linearServiceStub.getInstallationForOrga.mockReturnValue(
          of({
            isConfigured: false,
            id: '',
            linearOrganizationId: '',
            workspaceName: '',
            workspaceUrlKey: '',
            organizationId: '',
            installedByUserId: '',
            needsReconnect: false,
            createdAt: '',
            updatedAt: '',
          }),
        );

        const result = await service.getIntegrationOverview(mockOrganizationId);

        expect(result.linear).toBeNull();
      });

      it('is null, and the rest of the overview still answers, when the Linear read fails', async () => {
        stubEveryOtherSource();
        githubServiceStub.getInstallationForOrga.mockReturnValue(
          of(mockGithubInstallation),
        );
        linearServiceStub.getInstallationForOrga.mockReturnValue(
          throwError(() => new Error('UNAVAILABLE')),
        );

        const result = await service.getIntegrationOverview(mockOrganizationId);

        expect(result.linear).toBeNull();
        expect(result.github).toEqual(mockGithubInstallation);
      });
    });

    describe('gitlab.reconnectRequired', () => {
      function stubEveryOtherSource() {
        githubServiceStub.getInstallationForOrga.mockReturnValue(
          of(mockGithubInstallation),
        );
      }

      it('says when GitLab must be reconnected', async () => {
        stubEveryOtherSource();
        gitlabServiceStub.getInstallationForOrga.mockReturnValue(
          of({ ...mockGitlabInstallation, reconnectRequired: true }),
        );

        const result = await service.getIntegrationOverview(mockOrganizationId);

        expect(result.gitlab.reconnectRequired).toBe(true);
      });

      it('reads an older external-integrations without the field as healthy', async () => {
        stubEveryOtherSource();
        gitlabServiceStub.getInstallationForOrga.mockReturnValue(
          of(mockGitlabInstallation),
        );

        const result = await service.getIntegrationOverview(mockOrganizationId);

        expect(result.gitlab.reconnectRequired).toBe(false);
      });
    });
  });

  describe('onModuleInit', () => {
    it('should initialize the core gRPC service clients', () => {
      expect(externalIntegrationsClientMock.getService).toHaveBeenCalledWith(
        GITHUB_SERVICE_NAME,
      );
      expect(externalIntegrationsClientMock.getService).toHaveBeenCalledWith(
        GITLAB_SERVICE_NAME,
      );
      expect(externalIntegrationsClientMock.getService).toHaveBeenCalledWith(
        SLACK_SERVICE_NAME,
      );
      expect(externalIntegrationsClientMock.getService).toHaveBeenCalledWith(
        JIRA_SERVICE_NAME,
      );
      expect(externalIntegrationsClientMock.getService).toHaveBeenCalledWith(
        LINEAR_SERVICE_NAME,
      );
    });
  });
});
