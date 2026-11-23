/**
 * HTTP-level test of the Linear routes with the gateway's real
 * ValidationPipe options (main.ts: transform, whitelist, implicit
 * conversion). A DTO field without a class-validator decorator is silently
 * STRIPPED by `whitelist`, which a plain `validate()` call never shows, so
 * the per-ticket choices are followed from the wire to the service call.
 */
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { LinearController } from './linear.controller';
import { LinearService } from './linear.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const PROJECT_ID = '660e8400-e29b-41d4-a716-446655440001';
const TEAM_ID = '8f14e45f-ceea-467a-9575-1ae4b1c3d2a1';
const LINEAR_PROJECT_ID = '2c9d1b0e-47aa-4b61-8c52-7de3f2a90b14';
const LABEL_ID = '0b6f4d2e-1c3a-4e8b-9d7f-5a2c8e1f3b60';
const ASSIGNEE_ID = '9e2a7c14-6b3d-4f58-a1c0-3d8b5e7f2a96';

describe('Linear routes (HTTP, production ValidationPipe)', () => {
  let app: NestFastifyApplication;
  const linearService: Record<string, jest.Mock> = {
    createIssues: jest.fn(),
    linkExistingIssue: jest.fn(),
    setProjectLinearConfig: jest.fn(),
    getTeamOptions: jest.fn(),
    callbackInstall: jest.fn(),
  };
  const redis = { set: jest.fn(), get: jest.fn(), del: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LinearController],
      providers: [
        { provide: LinearService, useValue: linearService },
        {
          provide: ConfigService,
          useValue: { get: () => 'https://app.example.com' },
        },
        {
          provide: Logger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        { provide: 'REDIS_CLIENT', useValue: redis },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({
        canActivate: (context) => {
          context.switchToHttp().getRequest().user = { sub: 'user-123' };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    Object.values(linearService).forEach((fn) =>
      fn.mockReset().mockResolvedValue({ success: true }),
    );
  });

  const issuesUrl = `/organization/${ORG_ID}/project/${PROJECT_ID}/linear/issues`;
  const vulnerabilities = [
    {
      vulnerabilityId: 'vuln-1',
      scannerType: 'sast',
      severity: 'high',
      name: 'SQL Injection',
    },
  ];

  it('carries every per-ticket choice from the body to the service', async () => {
    const response = await app.inject({
      method: 'POST',
      url: issuesUrl,
      payload: {
        scanId: 'scan-1',
        mode: 2,
        vulnerabilities,
        cybedefendBaseUrl: 'https://client-provided.example.com',
        teamId: TEAM_ID,
        linearProjectId: LINEAR_PROJECT_ID,
        assigneeId: ASSIGNEE_ID,
        labelIds: [LABEL_ID],
        priority: 3,
        injected: 'dropped by whitelist',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(linearService.createIssues).toHaveBeenCalledTimes(1);
    const sent = linearService.createIssues.mock.calls[0][0];
    expect(sent).toMatchObject({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      linearProjectId: LINEAR_PROJECT_ID,
      assigneeId: ASSIGNEE_ID,
      labelIds: [LABEL_ID],
      priority: 3,
    });
    expect(sent).not.toHaveProperty('injected');
  });

  it('refuses a priority of 5 with 400 before any service call', async () => {
    const response = await app.inject({
      method: 'POST',
      url: issuesUrl,
      payload: {
        mode: 1,
        vulnerabilities,
        cybedefendBaseUrl: 'https://client-provided.example.com',
        priority: 5,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(linearService.createIssues).not.toHaveBeenCalled();
  });

  it('refuses 21 labelIds with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: issuesUrl,
      payload: {
        mode: 1,
        vulnerabilities,
        cybedefendBaseUrl: 'https://client-provided.example.com',
        labelIds: Array.from({ length: 21 }, () => LABEL_ID),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(linearService.createIssues).not.toHaveBeenCalled();
  });

  it('refuses a javascript: issueRef with 400 and links a linear.app URL', async () => {
    const url = `${issuesUrl}/link`;
    const body = { vulnerabilityIds: ['vuln-1'], scannerType: 'sast' };

    const refused = await app.inject({
      method: 'POST',
      url,
      payload: { ...body, issueRef: 'javascript:alert(1)' },
    });
    const accepted = await app.inject({
      method: 'POST',
      url,
      payload: {
        ...body,
        issueRef: 'https://linear.app/acme/issue/ENG-142/fix',
      },
    });

    expect(refused.statusCode).toBe(400);
    expect(accepted.statusCode).toBe(201);
    expect(linearService.linkExistingIssue).toHaveBeenCalledTimes(1);
    expect(linearService.linkExistingIssue.mock.calls[0][0].issueRef).toBe(
      'https://linear.app/acme/issue/ENG-142/fix',
    );
  });

  it('carries the config body to the service and refuses a team that is not a UUID', async () => {
    const url = `/organization/${ORG_ID}/project/${PROJECT_ID}/linear/config`;

    const refused = await app.inject({
      method: 'POST',
      url,
      payload: { teamId: 'ENG' },
    });
    const accepted = await app.inject({
      method: 'POST',
      url,
      payload: {
        teamId: TEAM_ID,
        linearProjectId: LINEAR_PROJECT_ID,
        labelIds: [LABEL_ID],
        allowedBranches: ['main'],
        autoCreateEnabled: true,
      },
    });

    expect(refused.statusCode).toBe(400);
    expect(accepted.statusCode).toBe(201);
    expect(linearService.setProjectLinearConfig).toHaveBeenCalledTimes(1);
    expect(linearService.setProjectLinearConfig).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      linearProjectId: LINEAR_PROJECT_ID,
      labelIds: [LABEL_ID],
      allowedBranches: ['main'],
      autoCreateEnabled: true,
    });
  });

  it('refuses a teamId path parameter that is not a UUID', async () => {
    const bad = await app.inject({
      method: 'GET',
      url: `/organization/${ORG_ID}/linear/teams/not-a-uuid/options`,
    });
    const good = await app.inject({
      method: 'GET',
      url: `/organization/${ORG_ID}/linear/teams/${TEAM_ID}/options`,
    });

    expect(bad.statusCode).toBe(400);
    expect(good.statusCode).toBe(200);
    expect(linearService.getTeamOptions).toHaveBeenCalledTimes(1);
    expect(linearService.getTeamOptions).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      teamId: TEAM_ID,
    });
  });

  it('refuses an organizationId that is not a UUID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/organization/not-a-uuid/linear/teams',
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses the install callback without a stored state, before any service call', async () => {
    redis.get.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: `/organization/${ORG_ID}/linear/install/callback`,
      payload: {
        code: 'abc',
        redirectUri: 'https://app.example.com/integrations/linear/callback',
        state: 'forged',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(linearService.callbackInstall).not.toHaveBeenCalled();
  });
});
