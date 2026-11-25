import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { throwError } from 'rxjs';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { GlobalExceptionFilter } from 'src/core/exceptions';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from 'src/core/validation/global-validation-pipe-options';
import { UserController } from 'src/modules/user/user.controller';
import { UserService } from 'src/modules/user/user.service';

/**
 * In the Community Edition, global-management's identity-provider binding
 * refuses the generic token creation (FAILED_PRECONDITION, PAT_PASSWORD_REQUIRED:
 * it carries no password). The shared route POST /user/personal-access-tokens
 * answers that refusal as a client error naming the route that asks for the
 * password, never a 500 and never a token.
 */
const REASON =
  'PAT_PASSWORD_REQUIRED: create personal access tokens with POST /me/personal-access-tokens, which asks for the account password';

describe('POST /user/personal-access-tokens, Community Edition', () => {
  const saved = process.env.CYBEDEFEND_EDITION;
  let app: NestFastifyApplication;
  const createPersonalAccessToken = jest.fn((..._args: unknown[]) =>
    throwError(() =>
      Object.assign(new Error(`9 FAILED_PRECONDITION: ${REASON}`), {
        code: GrpcStatus.FAILED_PRECONDITION,
        details: REASON,
      }),
    ),
  );

  beforeAll(async () => {
    process.env.CYBEDEFEND_EDITION = 'community';
    const moduleRef = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        UserService,
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => ({ createPersonalAccessToken }) },
        },
        { provide: Logger, useValue: { log: jest.fn(), error: jest.fn() } },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => Record<string, unknown> };
        }) => {
          context.switchToHttp().getRequest().user = {
            sub: 'u1',
            via: 'jwt',
          };
          return true;
        },
      })
      .overrideGuard(FeatureGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = saved;
  });

  it('answers 400 with the reason that names the password route, and no token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/user/personal-access-tokens',
      payload: { name: 'ci' },
    });

    expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(res.json().message).toBe(REASON);
    expect(res.body).not.toContain('cdp_');
    expect(createPersonalAccessToken).toHaveBeenCalledWith(
      { userId: 'u1', name: 'ci', expiresAt: 0 },
      expect.anything(),
    );
  });
});
