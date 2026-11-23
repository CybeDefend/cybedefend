import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';
import { CallbackInstallBodyDto } from './dto/body/callback-install-body.dto';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from 'src/core/validation/global-validation-pipe-options';

/**
 * In-memory Redis double: enough of ioredis for SET ... EX and a
 * MULTI GET + DEL transaction, so single use is actually exercised.
 */
function createRedisDouble() {
  const store = new Map<string, string>();
  const set = jest.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  });
  const multi = jest.fn(() => {
    const ops: Array<() => [null, unknown]> = [];
    const chain = {
      get: jest.fn((key: string) => {
        ops.push(() => [null, store.has(key) ? store.get(key) : null]);
        return chain;
      }),
      del: jest.fn((key: string) => {
        ops.push(() => [null, store.delete(key) ? 1 : 0]);
        return chain;
      }),
      exec: jest.fn(async () => ops.map((op) => op())),
    };
    return chain;
  });
  return { store, set, multi };
}

describe('GithubController installation state (CSRF protection)', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000';
  const otherOrgId = '660e8400-e29b-41d4-a716-446655440000';
  const req = { user: { sub: 'user-123' } };
  const otherReq = { user: { sub: 'user-456' } };
  const code = 'github-code-123';
  const installationId = 4242;

  let controller: GithubController;
  let redis: ReturnType<typeof createRedisDouble>;
  let githubService: { callbackInstall: jest.Mock };

  beforeEach(async () => {
    redis = createRedisDouble();
    githubService = {
      callbackInstall: jest.fn().mockResolvedValue({ returnUri: '/x' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GithubController],
      providers: [
        { provide: GithubService, useValue: githubService },
        {
          provide: Logger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        { provide: PermissionsGuard, useValue: { canActivate: () => true } },
        { provide: 'REDIS_CLIENT', useValue: redis },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<GithubController>(GithubController);
  });

  const body = (state: string) =>
    ({ code, installationId, state }) as CallbackInstallBodyDto;

  const expectRefused = async (promise: Promise<unknown>) => {
    await expect(promise).rejects.toThrow(BadRequestException);
    await expect(promise).rejects.toThrow(
      /restart the GitHub installation from the dashboard/,
    );
  };

  describe('issueInstallState', () => {
    it('stores {organizationId, userId} under github_install_state:<state> for 600 s and returns a 64-hex state', async () => {
      const { state } = await controller.issueInstallState(req, orgId);

      expect(state).toMatch(/^[a-f0-9]{64}$/);
      expect(redis.set).toHaveBeenCalledTimes(1);
      const [key, value, ex, ttl] = redis.set.mock.calls[0] as unknown[];
      expect(key).toBe(`github_install_state:${state}`);
      expect(JSON.parse(value as string)).toEqual({
        organizationId: orgId,
        userId: 'user-123',
      });
      expect(ex).toBe('EX');
      expect(ttl).toBe(600);
    });

    it('issues a different state on each call', async () => {
      const a = await controller.issueInstallState(req, orgId);
      const b = await controller.issueInstallState(req, orgId);
      expect(a.state).not.toBe(b.state);
      expect(redis.store.size).toBe(2);
    });
  });

  describe('callbackInstall', () => {
    it('forwards to external-integrations once with the right state, and consumes it', async () => {
      const { state } = await controller.issueInstallState(req, orgId);

      await controller.callbackInstall(req, body(state), orgId);

      expect(githubService.callbackInstall).toHaveBeenCalledWith({
        installationId,
        organizationId: orgId,
        userId: 'user-123',
        code,
      });
      expect(redis.store.has(`github_install_state:${state}`)).toBe(false);
    });

    it('refuses a missing state', async () => {
      await expectRefused(
        controller.callbackInstall(req, body(undefined as never), orgId),
      );
      expect(githubService.callbackInstall).not.toHaveBeenCalled();
    });

    it('refuses a malformed state without reading Redis', async () => {
      await expectRefused(
        controller.callbackInstall(req, body('not-a-state'), orgId),
      );
      expect(redis.multi).not.toHaveBeenCalled();
      expect(githubService.callbackInstall).not.toHaveBeenCalled();
    });

    it('refuses an unknown or expired state', async () => {
      await expectRefused(
        controller.callbackInstall(req, body('a'.repeat(64)), orgId),
      );
      expect(githubService.callbackInstall).not.toHaveBeenCalled();
    });

    it('refuses a state issued for another organization, and deletes it', async () => {
      const { state } = await controller.issueInstallState(req, otherOrgId);

      await expectRefused(controller.callbackInstall(req, body(state), orgId));
      expect(githubService.callbackInstall).not.toHaveBeenCalled();
      expect(redis.store.has(`github_install_state:${state}`)).toBe(false);
    });

    it('refuses a state issued for another user', async () => {
      const { state } = await controller.issueInstallState(otherReq, orgId);

      await expectRefused(controller.callbackInstall(req, body(state), orgId));
      expect(githubService.callbackInstall).not.toHaveBeenCalled();
    });

    it('refuses a state whose stored value is unreadable', async () => {
      const state = 'b'.repeat(64);
      redis.store.set(`github_install_state:${state}`, '{not json');

      await expectRefused(controller.callbackInstall(req, body(state), orgId));
      expect(githubService.callbackInstall).not.toHaveBeenCalled();
    });

    it('refuses a state used a second time', async () => {
      const { state } = await controller.issueInstallState(req, orgId);
      await controller.callbackInstall(req, body(state), orgId);

      await expectRefused(controller.callbackInstall(req, body(state), orgId));
      expect(githubService.callbackInstall).toHaveBeenCalledTimes(1);
    });

    it('does not share keys with the Slack installation state', async () => {
      const state = 'c'.repeat(64);
      redis.store.set(
        `slack_oauth_state:${state}`,
        JSON.stringify({ organizationId: orgId, userId: 'user-123' }),
      );

      await expectRefused(controller.callbackInstall(req, body(state), orgId));
      expect(githubService.callbackInstall).not.toHaveBeenCalled();
    });
  });

  describe('CallbackInstallBodyDto through the global ValidationPipe', () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const validateBody = (plain: Record<string, unknown>) =>
      pipe.transform(plain, {
        type: 'body',
        metatype: CallbackInstallBodyDto,
      });

    it('keeps the state of a well-formed body', async () => {
      const state = 'd'.repeat(64);
      const out = await validateBody({ code, installationId, state });
      expect(out).toMatchObject({ code, installationId, state });
    });

    it('rejects a body without a state', async () => {
      await expect(validateBody({ code, installationId })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a non-hex state', async () => {
      await expect(
        validateBody({ code, installationId, state: orgId }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
