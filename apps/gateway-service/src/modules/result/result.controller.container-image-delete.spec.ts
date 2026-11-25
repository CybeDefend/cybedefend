import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import * as permify from '@permify/permify-node';
import SecretsService from 'src/core/secrets/secrets.service';
import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { ResultController } from './result.controller';

jest.mock('@permify/permify-node', () => {
  const base = {
    CheckResult: { CHECK_RESULT_ALLOWED: 1, CHECK_RESULT_DENIED: 2 },
  };
  return { grpc: { newClient: jest.fn(), base } };
});

const ALLOWED = 1;
const DENIED = 2;

interface CheckRequest {
  entity: { type: string; id: string };
  permission: string;
  subject: { type: string; id: string };
}

/**
 * Deleting a scanned container image removes the image, all its findings and
 * their triage history for good. It is a destructive write: it needs the
 * project `delete` permission (team manager, organisation creator or
 * administrator) AND `change_vulnerability_state`, which carries the
 * organisation's « writes allowed » gate that `delete` lacks. Reading the
 * findings is never enough.
 */
describe('ResultController — deleting a container image', () => {
  const handler = ResultController.prototype.deleteContainerImage;

  it('asks delete and change_vulnerability_state on the project', () => {
    expect(Reflect.getMetadata('subjectTypes', handler)).toEqual([
      'project',
      'project',
    ]);
    expect(Reflect.getMetadata('permissions', handler)).toEqual([
      'delete',
      'change_vulnerability_state',
    ]);
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler);
    expect(guards.indexOf(PermissionsGuard)).toBeGreaterThanOrEqual(0);
    expect(guards.indexOf(PermissionsGuard)).toBeLessThan(
      guards.indexOf(FeatureGuard),
    );
  });

  describe('with the real permission guard', () => {
    /** A fake Permify that grants the caller exactly `held` on the project. */
    const guardGranting = (held: string[]) => {
      const check = jest.fn(async (request: CheckRequest) => ({
        can:
          request.subject.type === 'user' &&
          request.entity.type === 'project' &&
          held.includes(request.permission)
            ? ALLOWED
            : DENIED,
      }));
      (permify.grpc.newClient as unknown as jest.Mock).mockReturnValue({
        permission: { check },
      });
      const secrets = {
        getSecret: jest.fn(() => 'v1'),
      } as unknown as SecretsService;
      const logger = { error: jest.fn() } as unknown as Logger;
      const guard = new PermissionsGuard(
        new Reflector(),
        new ConfigService(),
        secrets,
        logger,
      );
      return { guard, check };
    };

    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          params: { projectId: 'project-1', imageId: 'image-1' },
          user: { sub: 'user-1' },
        }),
      }),
      getHandler: () => handler,
    } as unknown as ExecutionContext;

    it('refuses a caller who only reads and triages the findings', async () => {
      const { guard } = guardGranting([
        'read_scan_result',
        'change_vulnerability_state',
      ]);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses a caller who may delete the project while writes are blocked', async () => {
      const { guard } = guardGranting(['read_scan_result', 'delete']);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('allows a caller holding both permissions', async () => {
      const { guard, check } = guardGranting([
        'read_scan_result',
        'delete',
        'change_vulnerability_state',
      ]);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(
        check.mock.calls.map(([r]) => (r as CheckRequest).permission),
      ).toEqual(['delete', 'change_vulnerability_state']);
    });
  });
});
