import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Observable, of } from 'rxjs';
import { GlobalExceptionFilter } from 'src/core/exceptions';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from 'src/core/validation/global-validation-pipe-options';
import { LocalAuthController } from './local-auth.controller';
import {
  AUTH_ORIGIN_FORBIDDEN,
  LOCAL_AUTH_GATEWAY_REFUSALS,
} from './local-auth-errors';
import { LocalAuthRateLimitGuard } from './local-auth-rate-limit.guard';
import { LocalAuthService } from './local-auth.service';
import { LoginAccountLimiter } from './login-account-limiter';
import { LoginInFlightLimiter } from './login-in-flight-limiter';

/**
 * POST /auth/refresh and /auth/logout are authenticated by the `cd_refresh`
 * cookie alone, and SameSite=Strict is per site: a sibling subdomain of the
 * instance could post to them. In the Community edition both routes take
 * the request only from the instance's own origin (FRONTEND_URL, the CORS
 * allow-list): `Origin`, else the origin of `Referer`, else refused. 403
 * AUTH_ORIGIN_FORBIDDEN, no call, the cookie untouched. The cloud case (no
 * origin check) is tested with the cloud edition.
 */
const TRUST = jest.fn(async () => undefined);
const NOW = 1_730_000_000_000;
const SESSION = {
  accessToken: 'a',
  accessTokenExpiresAt: String(NOW + 900_000) as unknown as number,
  refreshToken: 'r2',
  refreshTokenExpiresAt: String(NOW + 30 * 86_400_000) as unknown as number,
  userId: 'u1',
  email: 'user@x.io',
  name: 'User',
};
const PUBLIC = 'https://cd.example.test';

type Fake = Record<string, jest.Mock<Observable<unknown>>>;

async function makeApp(client: Fake) {
  const moduleRef = await Test.createTestingModule({
    controllers: [LocalAuthController],
    providers: [
      LocalAuthService,
      {
        // The per-account login limit has its own spec.
        provide: LoginAccountLimiter,
        useValue: {
          reserve: async () => ({
            succeeded: async () => undefined,
            refund: async () => undefined,
          }),
          trust: TRUST,
        },
      },
      {
        provide: LoginInFlightLimiter,
        useValue: { acquire: async () => async () => undefined },
      },
      {
        provide: ConfigService,
        useValue: new ConfigService({
          FRONTEND_URL: `${PUBLIC}/, http://localhost:3002`,
        }),
      },
      {
        provide: 'GLOBAL_MANAGEMENT_SERVICE',
        useValue: { getService: () => client },
      },
    ],
  })
    .overrideGuard(LocalAuthRateLimitGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('LocalAuthController refresh and logout origin (Community)', () => {
  let app: NestFastifyApplication;
  let client: Fake;
  const saved = process.env.CYBEDEFEND_EDITION;

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    process.env.CYBEDEFEND_EDITION = 'community';
    client = {
      refresh: jest.fn(() => of({ session: SESSION })),
      logout: jest.fn(() => of({})),
    };
    app = await makeApp(client);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = saved;
    await app.close();
  });

  const post = (url: string, headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie: 'cd_refresh=r1', ...headers },
    });

  it('lists AUTH_ORIGIN_FORBIDDEN as a 403 gateway refusal', () => {
    expect(LOCAL_AUTH_GATEWAY_REFUSALS).toEqual({ AUTH_ORIGIN_FORBIDDEN: 403 });
  });

  describe.each([
    ['/auth/refresh', 'refresh', 200],
    ['/auth/logout', 'logout', 204],
  ] as const)('%s', (url, method, ok) => {
    it.each([
      ['Origin of the instance', { origin: PUBLIC }],
      ['a second listed origin', { origin: 'http://localhost:3002' }],
      [
        'no Origin, the Referer of the instance',
        { referer: `${PUBLIC}/login?x=1` },
      ],
    ])('serves %s', async (_what, headers) => {
      const res = await post(url, headers);
      expect(res.statusCode).toBe(ok);
      expect(client[method]).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a sibling subdomain', { origin: 'https://evil.example.test' }],
      ['another port', { origin: 'https://cd.example.test:8443' }],
      ['another scheme', { origin: 'http://cd.example.test' }],
      ['an opaque origin', { origin: 'null' }],
      ['a foreign Referer', { referer: 'https://evil.example.test/' }],
      ['an unreadable Referer', { referer: 'not a url' }],
      ['neither header', {}],
      [
        'a foreign Origin with the instance Referer',
        { origin: 'https://evil.example.test', referer: `${PUBLIC}/` },
      ],
    ])(
      'refuses %s with no call and no cookie change',
      async (_what, headers) => {
        const res = await post(url, headers);
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({
          code: AUTH_ORIGIN_FORBIDDEN,
          message: AUTH_ORIGIN_FORBIDDEN,
        });
        expect(client[method]).not.toHaveBeenCalled();
        expect(res.headers['set-cookie']).toBeUndefined();
      },
    );
  });
});
