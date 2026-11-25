import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { type Observable, of, throwError } from 'rxjs';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { GlobalExceptionFilter } from 'src/core/exceptions';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from 'src/core/validation/global-validation-pipe-options';
import {
  LocalAuthRateLimitGuard,
  PASSWORD_CHANGE_USER_LIMIT,
} from './local-auth-rate-limit.guard';
import { LocalAuthService } from './local-auth.service';
import { PasswordChangeController } from './password-change.controller';
import { PersonalAccessTokensController } from './personal-access-tokens.controller';

/**
 * Creating a personal access token checks the account password, so it is a
 * password proof like a password change: both routes count in ONE per-user
 * budget (LocalAuthRateLimitGuard's `password-change` kind, 10 per user per
 * 15 min). A stolen session therefore gets no second budget of guesses, and a
 * refused request reaches neither global-management nor the password
 * verifier. Every attempt counts, a right password included.
 *
 * The real guard runs on an in-memory Redis with the same SET NX EX + INCR
 * semantics.
 */

/** The commands the guard uses, kept in memory. */
function memoryRedis() {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    counts,
    multi() {
      const ops: Array<() => [null, unknown]> = [];
      const chain = {
        set(key: string, value: number, _ex: string, seconds: number) {
          ops.push(() => {
            if (!counts.has(key)) {
              counts.set(key, value);
              ttls.set(key, seconds);
              return [null, 'OK'];
            }
            return [null, null];
          });
          return chain;
        },
        incr(key: string) {
          ops.push(() => {
            const next = (counts.get(key) ?? 0) + 1;
            counts.set(key, next);
            return [null, next];
          });
          return chain;
        },
        async exec() {
          return ops.map((op) => op());
        },
      };
      return chain;
    },
    async ttl(key: string) {
      return ttls.get(key) ?? -2;
    },
  };
}

const SECRET = `cdp_${'C'.repeat(43)}`;
const TOKEN = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'ci',
  lastFour: 'CCCC',
  createdAt: '1730000000000',
  lastUsedAt: '0',
  expiresAt: '0',
};
const SESSION = {
  accessToken: 'a',
  accessTokenExpiresAt: '1730000900000',
  refreshToken: 'r',
  refreshTokenExpiresAt: '1732592000000',
  userId: 'u1',
  email: 'u@x.io',
  name: 'U',
};

type Fake = Record<string, jest.Mock<Observable<unknown>>>;

describe('Password proofs share one per-user budget', () => {
  let app: NestFastifyApplication;
  let client: Fake;
  let redis: ReturnType<typeof memoryRedis>;
  let passwordIsRight: boolean;

  beforeEach(async () => {
    passwordIsRight = false;
    redis = memoryRedis();
    const refusal = () =>
      throwError(() =>
        Object.assign(new Error('3 X: CURRENT_PASSWORD_INVALID'), {
          code: GrpcStatus.INVALID_ARGUMENT,
          details: 'CURRENT_PASSWORD_INVALID',
        }),
      );
    client = {
      createPersonalAccessToken: jest.fn(() =>
        passwordIsRight ? of({ token: TOKEN, value: SECRET }) : refusal(),
      ),
      changePassword: jest.fn(() =>
        passwordIsRight ? of({ session: SESSION }) : refusal(),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [PersonalAccessTokensController, PasswordChangeController],
      providers: [
        LocalAuthService,
        LocalAuthRateLimitGuard,
        { provide: ConfigService, useValue: new ConfigService({}) },
        { provide: 'REDIS_CLIENT', useValue: redis },
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: { getService: () => client },
        },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => {
              headers: Record<string, string>;
              user?: unknown;
            };
          };
        }) => {
          const req = context.switchToHttp().getRequest();
          req.user = { sub: req.headers['x-test-user'] ?? 'u1', via: 'jwt' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const create = (user = 'u1', currentPassword = 'a-guess') =>
    app.inject({
      method: 'POST',
      url: '/me/personal-access-tokens',
      headers: { 'x-test-user': user },
      payload: { name: 'ci', currentPassword },
    });

  const change = (user = 'u1') =>
    app.inject({
      method: 'POST',
      url: '/auth/password/change',
      headers: { 'x-test-user': user },
      payload: { currentPassword: 'a-guess', newPassword: 'a-new-password-1' },
    });

  it('refuses the 11th creation in the window with 429, before any password check', async () => {
    for (let i = 0; i < PASSWORD_CHANGE_USER_LIMIT; i += 1) {
      expect((await create()).statusCode).toBe(400);
    }
    const refused = await create();

    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(refused.headers['retry-after']).toBeDefined();
    expect(client.createPersonalAccessToken).toHaveBeenCalledTimes(
      PASSWORD_CHANGE_USER_LIMIT,
    );
  });

  it('counts a right password too: the budget is attempts, not failures', async () => {
    passwordIsRight = true;
    for (let i = 0; i < PASSWORD_CHANGE_USER_LIMIT; i += 1) {
      expect((await create()).statusCode).toBe(201);
    }
    expect((await create()).statusCode).toBe(429);
  });

  it('leaves another user unaffected', async () => {
    for (let i = 0; i < PASSWORD_CHANGE_USER_LIMIT; i += 1) await create();
    expect((await create()).statusCode).toBe(429);

    expect((await create('u2')).statusCode).toBe(400);
    expect(client.createPersonalAccessToken).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'u2' }),
    );
  });

  it('shares the budget with a password change', async () => {
    for (let i = 0; i < PASSWORD_CHANGE_USER_LIMIT / 2; i += 1) {
      expect((await change()).statusCode).toBe(400);
      expect((await create()).statusCode).toBe(400);
    }
    expect((await create()).statusCode).toBe(429);
    expect((await change()).statusCode).toBe(429);
    expect(client.createPersonalAccessToken).toHaveBeenCalledTimes(
      PASSWORD_CHANGE_USER_LIMIT / 2,
    );
    expect(client.changePassword).toHaveBeenCalledTimes(
      PASSWORD_CHANGE_USER_LIMIT / 2,
    );
  });
});
