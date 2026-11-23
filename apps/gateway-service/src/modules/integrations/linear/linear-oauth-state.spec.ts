import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { LinearController } from './linear.controller';
import { LinearService } from './linear.service';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_ORG_ID = '660e8400-e29b-41d4-a716-446655440001';
const ADMIN = { user: { sub: 'user-123' } };
const OTHER_ADMIN = { user: { sub: 'user-456' } };
const stateKey = (state: string): string => `linear_oauth_state:${state}`;

/**
 * A Redis double whose MULTI runs its queued commands in one go, as Redis
 * does: nothing else touches the store between the GET and the DEL.
 */
function buildRedis(store: Map<string, string>) {
  return {
    set: jest.fn(async (key: string, value: string, ..._expiry: unknown[]) => {
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    multi: jest.fn(() => {
      const queued: Array<() => [null, unknown]> = [];
      const chain = {
        get(key: string) {
          queued.push(() => [null, store.get(key) ?? null]);
          return chain;
        },
        del(key: string) {
          queued.push(() => [null, store.delete(key) ? 1 : 0]);
          return chain;
        },
        exec: jest.fn(async () => queued.map((command) => command())),
      };
      return chain;
    }),
  };
}

describe('LinearController OAuth State (CSRF Protection)', () => {
  let redisStore: Map<string, string>;
  let redisClient: ReturnType<typeof buildRedis>;
  let linearService: {
    callbackInstall: jest.Mock;
    generateOAuthUrl: jest.Mock;
  };

  async function buildController(
    frontendUrl = 'https://app.example.com',
  ): Promise<LinearController> {
    redisStore = new Map();
    redisClient = buildRedis(redisStore);

    linearService = {
      callbackInstall: jest
        .fn()
        .mockResolvedValue({ returnUri: 'https://app.example.com' }),
      generateOAuthUrl: jest.fn().mockImplementation(async (dto) => ({
        installUrl: `https://linear.app/oauth/authorize?client_id=test-client-id&redirect_uri=${encodeURIComponent(dto.redirectUri)}&response_type=code&scope=read%2Cwrite&state=${dto.state}&actor=app&prompt=consent`,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LinearController],
      providers: [
        { provide: LinearService, useValue: linearService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => ({ FRONTEND_URL: frontendUrl })[key],
          },
        },
        {
          provide: Logger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        { provide: 'REDIS_CLIENT', useValue: redisClient },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    return module.get(LinearController);
  }

  /** Starts an installation and returns the state handed to Linear. */
  async function startInstall(
    controller: LinearController,
    req = ADMIN,
    organizationId = ORG_ID,
  ): Promise<string> {
    await controller.generateInstallUrl(req, organizationId);
    const calls = linearService.generateOAuthUrl.mock.calls;
    return calls[calls.length - 1][0].state;
  }

  // ==================== generateInstallUrl ====================

  describe('generateInstallUrl', () => {
    it('stores the state for 600 s under its own key, with the organization and the user who started it', async () => {
      const controller = await buildController();

      await controller.generateInstallUrl(ADMIN, ORG_ID);

      expect(redisClient.set).toHaveBeenCalledTimes(1);
      const [key, value, ex, ttl] = redisClient.set.mock.calls[0];
      const state = linearService.generateOAuthUrl.mock.calls[0][0].state;
      // 32 random bytes, hex encoded
      expect(state).toMatch(/^[0-9a-f]{64}$/);
      expect(key).toBe(stateKey(state));
      expect(JSON.parse(value)).toEqual({
        organizationId: ORG_ID,
        userId: 'user-123',
      });
      expect(ex).toBe('EX');
      expect(ttl).toBe(600);
    });

    it('keeps the state of an installation another admin (or another tab) started for the same organization', async () => {
      const controller = await buildController();

      const first = await startInstall(controller, ADMIN);
      const second = await startInstall(controller, OTHER_ADMIN);

      expect(first).not.toBe(second);
      expect(redisStore.has(stateKey(first))).toBe(true);
      expect(redisStore.has(stateKey(second))).toBe(true);

      await controller.callbackInstall(
        ADMIN,
        { code: 'code-1', redirectUri: 'r', state: first },
        ORG_ID,
      );
      expect(linearService.callbackInstall).toHaveBeenCalledTimes(1);
    });

    it('hands the same state to Linear as the one it stored', async () => {
      const controller = await buildController();

      const result = await controller.generateInstallUrl(ADMIN, ORG_ID);

      const state = linearService.generateOAuthUrl.mock.calls[0][0].state;
      expect(linearService.generateOAuthUrl).toHaveBeenCalledWith({
        redirectUri: 'https://app.example.com/integrations/linear/callback',
        state,
      });
      expect(result.installUrl).toContain(`state=${state}`);
    });

    it('returns only the install URL', async () => {
      const controller = await buildController();

      const result = await controller.generateInstallUrl(ADMIN, ORG_ID);

      expect(Object.keys(result)).toEqual(['installUrl']);
    });

    it('never uses a local FRONTEND_URL for the redirect', async () => {
      const controller = await buildController(
        'http://localhost:3000, http://dev.local:3000 ,https://app.example.com',
      );

      await controller.generateInstallUrl(ADMIN, ORG_ID);

      expect(linearService.generateOAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUri: 'https://app.example.com/integrations/linear/callback',
        }),
      );
    });

    it('falls back to the first URL only when every FRONTEND_URL is local (local dev, as Jira)', async () => {
      const controller = await buildController(
        'http://localhost:3000,http://127.0.0.1:3000',
      );

      await controller.generateInstallUrl(ADMIN, ORG_ID);

      expect(linearService.generateOAuthUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUri: 'http://localhost:3000/integrations/linear/callback',
        }),
      );
    });
  });

  // ==================== callbackInstall ====================

  describe('callbackInstall - state validation', () => {
    const dto = (state: string) => ({
      code: 'auth-code-123',
      redirectUri: 'https://app.example.com/integrations/linear/callback',
      state,
    });

    it('refuses a state that is not 64 hex characters with 400, without reading Redis', async () => {
      const controller = await buildController();

      const attempt = controller.callbackInstall(
        ADMIN,
        dto('valid-state-token'),
        ORG_ID,
      );

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toMatchObject({ status: 400 });
      expect(redisClient.multi).not.toHaveBeenCalled();
      expect(linearService.callbackInstall).not.toHaveBeenCalled();
    });

    it('refuses an unknown or expired state with 400', async () => {
      const controller = await buildController();

      await expect(
        controller.callbackInstall(ADMIN, dto('a'.repeat(64)), ORG_ID),
      ).rejects.toMatchObject({ status: 400 });
      expect(linearService.callbackInstall).not.toHaveBeenCalled();
    });

    it('refuses a state issued for another organization', async () => {
      const controller = await buildController();
      const state = await startInstall(controller, ADMIN, OTHER_ORG_ID);

      await expect(
        controller.callbackInstall(ADMIN, dto(state), ORG_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(linearService.callbackInstall).not.toHaveBeenCalled();
    });

    it('refuses a state another user of the organization started', async () => {
      const controller = await buildController();
      const state = await startInstall(controller, OTHER_ADMIN);

      await expect(
        controller.callbackInstall(ADMIN, dto(state), ORG_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(linearService.callbackInstall).not.toHaveBeenCalled();
    });

    it('refuses a stored value that is not the expected record', async () => {
      const controller = await buildController();
      const state = 'b'.repeat(64);
      redisStore.set(stateKey(state), 'not json');

      await expect(
        controller.callbackInstall(ADMIN, dto(state), ORG_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(linearService.callbackInstall).not.toHaveBeenCalled();
    });

    it('forwards the install once the state matches the organization and the user', async () => {
      const controller = await buildController();
      const state = await startInstall(controller);

      await controller.callbackInstall(ADMIN, dto(state), ORG_ID);

      expect(linearService.callbackInstall).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        userId: 'user-123',
        code: 'auth-code-123',
        redirectUri: 'https://app.example.com/integrations/linear/callback',
      });
    });

    it('reads and deletes the state in one transaction, before the install, so it cannot be replayed', async () => {
      const controller = await buildController();
      const state = await startInstall(controller);

      await controller.callbackInstall(ADMIN, dto(state), ORG_ID);

      expect(redisClient.multi).toHaveBeenCalledTimes(1);
      expect(redisClient.get).not.toHaveBeenCalled();
      expect(redisClient.del).not.toHaveBeenCalled();
      expect(redisStore.has(stateKey(state))).toBe(false);

      // Second use of the same state: refused, nothing forwarded again.
      await expect(
        controller.callbackInstall(ADMIN, dto(state), ORG_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(linearService.callbackInstall).toHaveBeenCalledTimes(1);
    });

    it('lets one of two concurrent callbacks with the same state through', async () => {
      const controller = await buildController();
      const state = await startInstall(controller);

      const results = await Promise.allSettled([
        controller.callbackInstall(ADMIN, dto(state), ORG_ID),
        controller.callbackInstall(ADMIN, dto(state), ORG_ID),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(linearService.callbackInstall).toHaveBeenCalledTimes(1);
    });

    it('burns a state presented for the wrong organization', async () => {
      const controller = await buildController();
      const state = await startInstall(controller);

      await expect(
        controller.callbackInstall(ADMIN, dto(state), OTHER_ORG_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(redisStore.has(stateKey(state))).toBe(false);
    });
  });
});
