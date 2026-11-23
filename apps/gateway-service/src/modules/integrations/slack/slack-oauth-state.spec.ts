import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';
import { SlackCallbackInstallBodyDto } from './dto/body/callback-install-body.dto';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';

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

describe('SlackController OAuth state (CSRF protection)', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000';
  const otherOrgId = '660e8400-e29b-41d4-a716-446655440000';
  const req = { user: { sub: 'user-123' } };
  const otherReq = { user: { sub: 'user-456' } };
  const code = 'slack-code-123';
  const redirectUri = 'https://app.example.com/integrations/slack/callback';

  let controller: SlackController;
  let redis: ReturnType<typeof createRedisDouble>;
  let slackService: { callbackInstall: jest.Mock };

  beforeEach(async () => {
    redis = createRedisDouble();
    slackService = {
      callbackInstall: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SlackController],
      providers: [
        { provide: SlackService, useValue: slackService },
        {
          provide: Logger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        { provide: 'REDIS_CLIENT', useValue: redis },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(FeatureGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SlackController>(SlackController);
  });

  const body = (state: string) =>
    ({ code, redirectUri, state }) as SlackCallbackInstallBodyDto;

  describe('issueInstallState', () => {
    it('stores {organizationId, userId} under slack_oauth_state:<state> for 600 s and returns a 64-hex state', async () => {
      const { state } = await controller.issueInstallState(req, orgId);

      expect(state).toMatch(/^[a-f0-9]{64}$/);
      expect(redis.set).toHaveBeenCalledTimes(1);
      const [key, value, ex, ttl] = redis.set.mock.calls[0] as unknown[];
      expect(key).toBe(`slack_oauth_state:${state}`);
      expect(JSON.parse(value as string)).toEqual({
        organizationId: orgId,
        userId: 'user-123',
      });
      expect(ex).toBe('EX');
      expect(ttl).toBe(600);
    });

    it('issues a different state on each call (two tabs do not overwrite each other)', async () => {
      const a = await controller.issueInstallState(req, orgId);
      const b = await controller.issueInstallState(req, orgId);
      expect(a.state).not.toBe(b.state);
      expect(redis.store.size).toBe(2);
    });
  });

  describe('callbackInstall', () => {
    it('forwards to external-integrations with a valid state and consumes it', async () => {
      const { state } = await controller.issueInstallState(req, orgId);

      await controller.callbackInstall(req, body(state), orgId);

      expect(slackService.callbackInstall).toHaveBeenCalledWith({
        organizationId: orgId,
        userId: 'user-123',
        code,
        redirectUri,
      });
      expect(redis.store.has(`slack_oauth_state:${state}`)).toBe(false);
    });

    it('refuses an unknown or expired state', async () => {
      await expect(
        controller.callbackInstall(req, body('a'.repeat(64)), orgId),
      ).rejects.toThrow(BadRequestException);
      expect(slackService.callbackInstall).not.toHaveBeenCalled();
    });

    it('refuses a missing state', async () => {
      await expect(
        controller.callbackInstall(req, body(undefined as any), orgId),
      ).rejects.toThrow(BadRequestException);
      expect(slackService.callbackInstall).not.toHaveBeenCalled();
    });

    it('refuses a state issued for another organization, and still deletes it', async () => {
      const { state } = await controller.issueInstallState(req, otherOrgId);

      await expect(
        controller.callbackInstall(req, body(state), orgId),
      ).rejects.toThrow(BadRequestException);
      expect(slackService.callbackInstall).not.toHaveBeenCalled();
      expect(redis.store.has(`slack_oauth_state:${state}`)).toBe(false);
    });

    it('refuses a state issued for another user', async () => {
      const { state } = await controller.issueInstallState(otherReq, orgId);

      await expect(
        controller.callbackInstall(req, body(state), orgId),
      ).rejects.toThrow(BadRequestException);
      expect(slackService.callbackInstall).not.toHaveBeenCalled();
      expect(redis.store.has(`slack_oauth_state:${state}`)).toBe(false);
    });

    it('refuses a state whose stored value is unreadable', async () => {
      const state = 'b'.repeat(64);
      redis.store.set(`slack_oauth_state:${state}`, '{not json');

      await expect(
        controller.callbackInstall(req, body(state), orgId),
      ).rejects.toThrow(BadRequestException);
      expect(slackService.callbackInstall).not.toHaveBeenCalled();
    });

    it('refuses a state used a second time', async () => {
      const { state } = await controller.issueInstallState(req, orgId);
      await controller.callbackInstall(req, body(state), orgId);

      await expect(
        controller.callbackInstall(req, body(state), orgId),
      ).rejects.toThrow(BadRequestException);
      expect(slackService.callbackInstall).toHaveBeenCalledTimes(1);
    });

    it('reads and deletes the state in one MULTI transaction', async () => {
      const { state } = await controller.issueInstallState(req, orgId);
      await controller.callbackInstall(req, body(state), orgId);

      expect(redis.multi).toHaveBeenCalledTimes(1);
      const chain = redis.multi.mock.results[0].value;
      expect(chain.get).toHaveBeenCalledWith(`slack_oauth_state:${state}`);
      expect(chain.del).toHaveBeenCalledWith(`slack_oauth_state:${state}`);
      expect(chain.exec).toHaveBeenCalledTimes(1);
    });
  });

  describe('SlackCallbackInstallBodyDto', () => {
    const errorsFor = (plain: Record<string, unknown>) =>
      validate(plainToInstance(SlackCallbackInstallBodyDto, plain));

    it('accepts a 64-hex state', async () => {
      expect(
        await errorsFor({ code, redirectUri, state: 'c'.repeat(64) }),
      ).toEqual([]);
    });

    it('rejects a missing state', async () => {
      const errors = await errorsFor({ code, redirectUri });
      expect(errors.map((e) => e.property)).toContain('state');
    });

    it('rejects a non-hex state', async () => {
      const errors = await errorsFor({
        code,
        redirectUri,
        state: orgId,
      });
      expect(errors.map((e) => e.property)).toContain('state');
    });

    it('rejects an oversized code', async () => {
      const errors = await errorsFor({
        code: 'x'.repeat(2049),
        redirectUri,
        state: 'c'.repeat(64),
      });
      expect(errors.map((e) => e.property)).toContain('code');
    });
  });
});
