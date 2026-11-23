import { HttpException } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { of, throwError } from 'rxjs';
import { LINEAR_SERVICE_NAME } from '@grpc/external-integrations/external_integrations';
import { LINEAR_ISSUE_SERVICE_NAME } from '@grpc/external-integrations/issue';
import { LinearService } from './linear.service';

describe('LinearService', () => {
  let linearClient: Record<string, jest.Mock>;
  let issueClient: Record<string, jest.Mock>;
  let service: LinearService;

  beforeEach(() => {
    linearClient = {
      generateOAuthUrl: jest.fn(() => of({ installUrl: 'https://x' })),
      callbackInstall: jest.fn(() => of({ returnUri: 'https://x' })),
      getInstallationForOrga: jest.fn(() => of({ isConfigured: true })),
      disconnect: jest.fn(() => of({ success: true })),
      listTeams: jest.fn(() => of({ teams: [] })),
      getTeamOptions: jest.fn(() => of({ projects: [] })),
      setProjectLinearConfig: jest.fn(() => of({ success: true })),
      getProjectLinearConfig: jest.fn(() => of({ isConfigured: true })),
      removeProjectLinearConfig: jest.fn(() => of({ success: true })),
      handleWebhook: jest.fn(() => of({ success: true })),
    };
    issueClient = {
      createIssues: jest.fn(() => of({ success: true })),
      linkExistingIssue: jest.fn(() => of({ success: true })),
      getProjectIssues: jest.fn(() => of({ success: true })),
      syncIssueStatus: jest.fn(() => of({ success: true, updated: 2 })),
    };

    const grpc = {
      getService: jest.fn((name: string) => {
        if (name === LINEAR_SERVICE_NAME) return linearClient;
        if (name === LINEAR_ISSUE_SERVICE_NAME) return issueClient;
        throw new Error(`unexpected gRPC service ${name}`);
      }),
    } as unknown as ClientGrpc;

    service = new LinearService(grpc);
    service.onModuleInit();
  });

  it.each([
    ['generateOAuthUrl', { redirectUri: 'https://a', state: 's' }],
    [
      'callbackInstall',
      { organizationId: 'o', userId: 'u', code: 'c', redirectUri: 'r' },
    ],
    ['getInstallationForOrga', { organizationId: 'o' }],
    ['disconnect', { organizationId: 'o' }],
    ['listTeams', { organizationId: 'o' }],
    ['getTeamOptions', { organizationId: 'o', teamId: 't' }],
    ['getProjectLinearConfig', { organizationId: 'o', projectId: 'p' }],
    ['removeProjectLinearConfig', { organizationId: 'o', projectId: 'p' }],
    ['handleWebhook', { rawBody: '{"type":"Issue"}', signature: 'abc' }],
  ] as const)(
    '%s calls LinearService with the request unchanged',
    async (method, dto) => {
      await (service[method] as (d: unknown) => Promise<unknown>)(dto);

      expect(linearClient[method]).toHaveBeenCalledTimes(1);
      expect(linearClient[method].mock.calls[0][0]).toEqual(dto);
    },
  );

  it('setProjectLinearConfig calls LinearService with the request unchanged', async () => {
    const dto = {
      organizationId: 'o',
      projectId: 'p',
      teamId: 't',
      linearProjectId: '',
      labelIds: [],
      allowedBranches: [],
      autoCreateEnabled: false,
    };

    await service.setProjectLinearConfig(dto);

    expect(linearClient.setProjectLinearConfig.mock.calls[0][0]).toEqual(dto);
  });

  it.each([
    [
      'getProjectIssues',
      {
        organizationId: 'o',
        projectId: 'p',
        state: 'all',
        vulnerabilityIds: [],
      },
    ],
    ['syncIssueStatus', { organizationId: 'o', projectId: 'p' }],
  ] as const)(
    '%s calls LinearIssueService with the request unchanged',
    async (method, dto) => {
      await (service[method] as (d: unknown) => Promise<unknown>)(dto);

      expect(issueClient[method]).toHaveBeenCalledTimes(1);
      expect(issueClient[method].mock.calls[0][0]).toEqual(dto);
    },
  );

  it('createIssues and linkExistingIssue call LinearIssueService', async () => {
    await service.createIssues({
      organizationId: 'o',
      projectId: 'p',
      scanId: '',
      mode: 1,
      vulnerabilities: [],
      cybedefendBaseUrl: 'https://app.example.com',
      teamId: '',
      linearProjectId: '',
      labelIds: [],
      assigneeId: '',
    });
    await service.linkExistingIssue({
      organizationId: 'o',
      projectId: 'p',
      issueRef: 'ENG-1',
      vulnerabilityIds: ['v'],
      scannerType: 'sast',
      vulnerabilities: [],
      cybedefendBaseUrl: '',
    });

    expect(issueClient.createIssues).toHaveBeenCalledTimes(1);
    expect(issueClient.linkExistingIssue).toHaveBeenCalledTimes(1);
  });

  it('returns what the service answered', async () => {
    await expect(
      service.syncIssueStatus({ organizationId: 'o', projectId: 'p' }),
    ).resolves.toEqual({ success: true, updated: 2 });
  });

  describe('a closed-list refusal reaches the client by its message', () => {
    it.each([
      ['LINEAR_NOT_CONNECTED', GrpcStatus.FAILED_PRECONDITION, 400],
      ['LINEAR_NEEDS_RECONNECT', GrpcStatus.FAILED_PRECONDITION, 400],
      ['LINEAR_WORKSPACE_TAKEN', GrpcStatus.ALREADY_EXISTS, 409],
      ['LINEAR_TEAM_NOT_FOUND', GrpcStatus.NOT_FOUND, 404],
      ['LINEAR_ISSUE_NOT_FOUND', GrpcStatus.NOT_FOUND, 404],
    ])('%s', async (code, grpcCode, httpStatus) => {
      issueClient.createIssues.mockReturnValue(
        throwError(() =>
          Object.assign(new Error(`${grpcCode} ${code}`), {
            code: grpcCode,
            details: code,
          }),
        ),
      );

      const failure = service
        .createIssues({
          organizationId: 'o',
          projectId: 'p',
          scanId: '',
          mode: 1,
          vulnerabilities: [],
          cybedefendBaseUrl: '',
          teamId: '',
          linearProjectId: '',
          labelIds: [],
          assigneeId: '',
        })
        .catch((e: unknown) => e);

      const error = await failure;
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).message).toBe(code);
      expect((error as HttpException).getStatus()).toBe(httpStatus);
    });
  });
});
