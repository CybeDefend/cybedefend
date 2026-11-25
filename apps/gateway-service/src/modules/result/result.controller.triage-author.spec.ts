import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { Logger } from 'nestjs-pino';
import request from 'supertest';

import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from 'src/core/validation/global-validation-pipe-options';
import { ResultController } from './result.controller';
import { ResultService } from './result.service';

/**
 * Who triaged a finding is recorded by the gateway from the authenticated
 * caller, never from the request body: the person who changes a status
 * cannot record the change under another user, nor as a decision taken by
 * the assistant (the assistant fields of the history). The public bodies do
 * not declare those fields, so the global pipe (`whitelist`, no
 * `forbidNonWhitelisted`) strips them and the request still succeeds.
 */
describe('ResultController — the triage author comes from the caller', () => {
  const PROJECT = '00000000-0000-4000-8000-0000000000a1';
  const VULN = '00000000-0000-4000-8000-0000000000b1';
  const CALLER = '00000000-0000-4000-8000-0000000000c1';
  const SOMEONE_ELSE = '00000000-0000-4000-8000-0000000000d1';
  const FORGED = {
    userId: SOMEONE_ELSE,
    agentToolCallId: 'forged-call',
    agentConversationId: 'forged-conversation',
    agentStreamId: 'forged-stream',
  };

  let app: NestFastifyApplication;
  const service = {
    update: jest.fn().mockResolvedValue({}),
    batchUpdate: jest
      .fn()
      .mockResolvedValue({ taskId: 't1', status: 'queued', total: 1 }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ResultController],
      providers: [
        { provide: ResultService, useValue: service },
        {
          provide: Logger,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
        { provide: HttpService, useValue: { get: jest.fn() } },
        {
          provide: PermissionsGuard,
          useValue: { canActivate: () => true, checkPermission: jest.fn() },
        },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = { sub: CALLER };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(FeatureGuard)
      .useValue({ canActivate: () => true })
      .compile();

    // The gateway's own HTTP adapter: it routes `/results/batch` to the batch
    // handler before the `/results/:vulnerabilityId` one.
    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('a single update records the caller and no assistant fields', async () => {
    await request(app.getHttpServer())
      .patch(`/project/${PROJECT}/results/${VULN}`)
      .send({
        status: 'ignored',
        dismissalReason: 'Not reachable from any entry point',
        ...FORGED,
      })
      .expect(200);

    expect(service.update).toHaveBeenCalledTimes(1);
    expect(service.update.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        projectId: PROJECT,
        vulnerabilityId: VULN,
        status: 'ignored',
        userId: CALLER,
        agentToolCallId: '',
        agentConversationId: '',
        agentStreamId: '',
      }),
    );
  });

  it('a batch update records the caller and no assistant fields', async () => {
    await request(app.getHttpServer())
      .patch(`/project/${PROJECT}/results/batch`)
      .send({
        items: [{ vulnerabilityId: VULN, status: 'confirmed', ...FORGED }],
        ...FORGED,
      })
      .expect(202);

    expect(service.batchUpdate).toHaveBeenCalledTimes(1);
    const [projectId, items, userId, ...rest] =
      service.batchUpdate.mock.calls[0];
    expect(projectId).toBe(PROJECT);
    expect(userId).toBe(CALLER);
    expect(items).toEqual([{ vulnerabilityId: VULN, status: 'confirmed' }]);
    // No assistant attribution is handed to the service.
    expect(rest).toEqual([]);
  });
});
