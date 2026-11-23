import { PermissionsGuard } from './permissions.guard';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import SecretsService from 'src/core/secrets/secrets.service';
import { Logger } from 'nestjs-pino';
import * as permify from '@permify/permify-node';
jest.mock('@permify/permify-node', () => {
  const base = {
    CheckResult: { CHECK_RESULT_ALLOWED: 1, CHECK_RESULT_DENIED: 0 },
  };
  return { grpc: { newClient: jest.fn(), base } };
});
import {
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { PermifyDeadlineExceededError } from 'src/core/utils/permify-call-options';

describe('PermissionsGuard', () => {
  const makeCtx = (
    params: any,
    userOverride: any = { user: { sub: 'u1' } },
  ) => {
    const req: any = { params, ...userOverride };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
    } as unknown as ExecutionContext;
  };

  const baseDeps = () => {
    const reflector = {
      get: jest.fn(),
    } as any as Reflector;
    const config = new ConfigService();
    const secrets = { getSecret: jest.fn(() => 'v1') } as any as SecretsService;
    const logger = { error: jest.fn() } as any as Logger;
    return { reflector, config, secrets, logger };
  };

  it('should be defined', () => {
    const d = baseDeps();
    const guard = new PermissionsGuard(
      d.reflector,
      d.config,
      d.secrets,
      d.logger,
    );
    expect(guard).toBeDefined();
  });

  it('allows when permify check returns ALLOWED', async () => {
    const d = baseDeps();
    // metadata
    (d.reflector.get as any)
      .mockReturnValueOnce(['organization'])
      .mockReturnValueOnce(['read']);

    // mock permify client
    const allowed =
      (permify.grpc.base.CheckResult as any).CHECK_RESULT_ALLOWED ?? 1;
    const mockClient = {
      permission: {
        check: jest.fn().mockResolvedValue({ can: allowed }),
      },
    };
    (permify.grpc.newClient as unknown as jest.Mock).mockReturnValue(
      mockClient as any,
    );

    const guard = new PermissionsGuard(
      d.reflector,
      d.config,
      d.secrets,
      d.logger,
    );
    await expect(
      guard.canActivate(makeCtx({ organizationId: 'o1' })),
    ).resolves.toBe(true);
    expect(mockClient.permission.check).toHaveBeenCalled();
  });

  it('denies when ids missing for subject type', async () => {
    const d = baseDeps();
    (d.reflector.get as any)
      .mockReturnValueOnce(['team'])
      .mockReturnValueOnce(['read']);
    const guard = new PermissionsGuard(
      d.reflector,
      d.config,
      d.secrets,
      d.logger,
    );
    await expect(guard.canActivate(makeCtx({}))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws when subjectTypes and permissions lengths mismatch', async () => {
    const d = baseDeps();
    (d.reflector.get as any)
      .mockReturnValueOnce(['organization'])
      .mockReturnValueOnce(['read', 'write']);
    const guard = new PermissionsGuard(
      d.reflector,
      d.config,
      d.secrets,
      d.logger,
    );
    await expect(
      guard.canActivate(makeCtx({ organizationId: 'o1' })),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('propagates error from permify client as 500', async () => {
    const d = baseDeps();
    (d.reflector.get as any)
      .mockReturnValueOnce(['organization'])
      .mockReturnValueOnce(['read']);
    const mockClient = {
      permission: {
        check: jest.fn().mockRejectedValue(new Error('permify down')),
      },
    };
    (permify.grpc.newClient as unknown as jest.Mock).mockReturnValue(
      mockClient as any,
    );
    const guard = new PermissionsGuard(
      d.reflector,
      d.config,
      d.secrets,
      d.logger,
    );
    await expect(
      guard.canActivate(makeCtx({ organizationId: 'o1' })),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(d.logger.error).toHaveBeenCalled();
  });

  describe('Permify call deadline', () => {
    const ALLOWED = 1;

    afterEach(() => {
      jest.useRealTimers();
    });

    const guardWithCheck = (check: jest.Mock) => {
      const d = baseDeps();
      (d.reflector.get as jest.Mock)
        .mockReturnValueOnce(['organization'])
        .mockReturnValueOnce(['read']);
      (permify.grpc.newClient as unknown as jest.Mock).mockReturnValue({
        permission: { check },
      });
      return {
        d,
        guard: new PermissionsGuard(d.reflector, d.config, d.secrets, d.logger),
      };
    };

    /** A check that hangs, exactly like a Permify starved of DB connections. */
    const hangingCheck = () =>
      jest.fn(
        (_request, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(options.signal.reason),
            );
          }),
      );

    it('passes the options as the second argument', async () => {
      const check = jest.fn().mockResolvedValue({ can: ALLOWED });
      const { guard } = guardWithCheck(check);

      await expect(
        guard.canActivate(makeCtx({ organizationId: 'o1' })),
      ).resolves.toBe(true);

      // nice-grpc client methods are (request, options) — the deadline rides
      // on `options.signal`, the only cancellation nice-grpc honours.
      expect(check).toHaveBeenCalledWith(
        expect.objectContaining({ permission: 'read' }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('aborts a hanging check after 2s and answers 503', async () => {
      jest.useFakeTimers();
      const check = hangingCheck();
      const { guard } = guardWithCheck(check);

      const pending = guard.canActivate(makeCtx({ organizationId: 'o1' }));
      const expectation = expect(pending).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      const { signal } = check.mock.calls[0][1];
      await jest.advanceTimersByTimeAsync(1999);
      expect(signal.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(signal.aborted).toBe(true);
      expect(signal.reason.code).toBe(status.DEADLINE_EXCEEDED);

      await expectation;
    });

    it('arms no timer once the check has come back', async () => {
      jest.useFakeTimers();
      const check = jest.fn().mockResolvedValue({ can: ALLOWED });
      const { guard } = guardWithCheck(check);

      await guard.canActivate(makeCtx({ organizationId: 'o1' }));

      expect(jest.getTimerCount()).toBe(0);
    });

    it('honours PERMIFY_RPC_DEADLINE_MS', async () => {
      jest.useFakeTimers();
      const check = hangingCheck();
      const d = baseDeps();
      jest
        .spyOn(d.config, 'get')
        .mockImplementation((key: string) =>
          key === 'PERMIFY_RPC_DEADLINE_MS' ? '300' : undefined,
        );
      (d.reflector.get as jest.Mock)
        .mockReturnValueOnce(['organization'])
        .mockReturnValueOnce(['read']);
      (permify.grpc.newClient as unknown as jest.Mock).mockReturnValue({
        permission: { check },
      });
      const guard = new PermissionsGuard(
        d.reflector,
        d.config,
        d.secrets,
        d.logger,
      );

      const pending = guard.canActivate(makeCtx({ organizationId: 'o1' }));
      const expectation = expect(pending).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      const { signal } = check.mock.calls[0][1];
      await jest.advanceTimersByTimeAsync(299);
      expect(signal.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(signal.aborted).toBe(true);

      await expectation;
    });

    it.each([
      ['DEADLINE_EXCEEDED', new PermifyDeadlineExceededError(2000)],
      [
        'UNAVAILABLE',
        Object.assign(new Error('permify unreachable'), {
          code: status.UNAVAILABLE,
        }),
      ],
      [
        'a bare AbortSignal.timeout rejection (DOMException, code 23)',
        Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
          code: 23,
        }),
      ],
    ])('maps %s to 503 rather than 500', async (_label, error) => {
      const check = jest.fn().mockRejectedValue(error);
      const { guard } = guardWithCheck(check);

      await expect(
        guard.canActivate(makeCtx({ organizationId: 'o1' })),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('still maps INTERNAL to 500', async () => {
      const check = jest.fn().mockRejectedValue(
        Object.assign(new Error('boom'), {
          code: status.INTERNAL,
        }),
      );
      const { guard } = guardWithCheck(check);

      await expect(
        guard.canActivate(makeCtx({ organizationId: 'o1' })),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});
