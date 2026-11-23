import { PermissionsGuard } from './permissions.guard';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import SecretsService from 'src/core/secrets/secrets.service';
import { Logger } from 'nestjs-pino';
import * as permify from '@permify/permify-node';
jest.mock('@permify/permify-node', () => {
  const base = {
    CheckResult: { CHECK_RESULT_ALLOWED: 1, CHECK_RESULT_DENIED: 2 },
  };
  return { grpc: { newClient: jest.fn(), base } };
});
import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { status } from '@grpc/grpc-js';

/**
 * A route that names an organization AND one of its children (a project or a
 * team) acts on the child with the organization's settings. Each permission
 * is checked on its own id, so the guard must also prove that the child
 * belongs to that organization: otherwise a user pairs an organization of
 * their own with a project of another organization.
 */

const ALLOWED = 1;
const DENIED = 2;

interface CheckRequest {
  entity: { type: string; id: string };
  permission: string;
  subject: { type: string; id: string };
}

/** Which organization owns each child in the fake Permify. */
const OWNER: Record<string, string> = {
  'project-a': 'org-a',
  'project-b': 'org-b',
  'team-a': 'org-a',
  'team-b': 'org-b',
};

/** The user holds every permission; the tree is the one above. */
const fakeCheck = () =>
  jest.fn(async (request: CheckRequest) => {
    if (request.subject.type === 'user') return { can: ALLOWED };
    if (
      request.permission === 'organization' &&
      request.subject.type === 'organization' &&
      OWNER[request.entity.id] === request.subject.id
    ) {
      return { can: ALLOWED };
    }
    return { can: DENIED };
  });

const makeCtx = (params: Record<string, string>) => {
  const req = { params, user: { sub: 'u1' } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
  } as unknown as ExecutionContext;
};

const guardFor = (
  subjectTypes: string[],
  permissions: string[],
  check: jest.Mock,
): PermissionsGuard => {
  const reflector = {
    get: jest.fn((key: string) =>
      key === 'subjectTypes' ? subjectTypes : permissions,
    ),
  } as unknown as Reflector;
  const secrets = {
    getSecret: jest.fn(() => 'v1'),
  } as unknown as SecretsService;
  const logger = { error: jest.fn() } as unknown as Logger;
  (permify.grpc.newClient as unknown as jest.Mock).mockReturnValue({
    permission: { check },
  });
  return new PermissionsGuard(reflector, new ConfigService(), secrets, logger);
};

const calls = (check: jest.Mock): CheckRequest[] =>
  check.mock.calls.map(([request]) => request as CheckRequest);

describe('PermissionsGuard — child of the path organization', () => {
  describe('organization + project', () => {
    const route = (check: jest.Mock) =>
      guardFor(
        ['organization', 'project'],
        ['manage_integration', 'start_scan'],
        check,
      );

    it('allows a project of the path organization, after checking both permissions and the membership', async () => {
      const check = fakeCheck();

      await expect(
        route(check).canActivate(
          makeCtx({ organizationId: 'org-a', projectId: 'project-a' }),
        ),
      ).resolves.toBe(true);

      expect(calls(check)).toEqual([
        expect.objectContaining({
          entity: { type: 'organization', id: 'org-a' },
          permission: 'manage_integration',
          subject: { type: 'user', id: 'u1' },
        }),
        expect.objectContaining({
          entity: { type: 'project', id: 'project-a' },
          permission: 'start_scan',
          subject: { type: 'user', id: 'u1' },
        }),
        expect.objectContaining({
          entity: { type: 'project', id: 'project-a' },
          permission: 'organization',
          subject: { type: 'organization', id: 'org-a' },
        }),
      ]);
    });

    it('refuses a project of another organization with the plain 403, though both permissions are held', async () => {
      const check = fakeCheck();

      const outcome = route(check).canActivate(
        makeCtx({ organizationId: 'org-a', projectId: 'project-b' }),
      );

      await expect(outcome).rejects.toBeInstanceOf(ForbiddenException);
      await expect(outcome).rejects.toThrow('Permission denied');
      expect(calls(check)).toContainEqual(
        expect.objectContaining({
          entity: { type: 'project', id: 'project-b' },
          permission: 'organization',
          subject: { type: 'organization', id: 'org-a' },
        }),
      );
    });

    it('answers 503, never allows, when Permify fails during the membership check', async () => {
      const check = jest.fn(async (request: CheckRequest) => {
        if (request.subject.type === 'organization') {
          throw Object.assign(new Error('permify unreachable'), {
            code: status.UNAVAILABLE,
          });
        }
        return { can: ALLOWED };
      });

      await expect(
        route(check).canActivate(
          makeCtx({ organizationId: 'org-a', projectId: 'project-a' }),
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('organization + team', () => {
    const route = (check: jest.Mock) =>
      guardFor(['organization', 'team'], ['read', 'manage'], check);

    it('allows a team of the path organization', async () => {
      const check = fakeCheck();

      await expect(
        route(check).canActivate(
          makeCtx({ organizationId: 'org-a', teamId: 'team-a' }),
        ),
      ).resolves.toBe(true);
      expect(calls(check)).toContainEqual(
        expect.objectContaining({
          entity: { type: 'team', id: 'team-a' },
          permission: 'organization',
          subject: { type: 'organization', id: 'org-a' },
        }),
      );
    });

    it('refuses a team of another organization', async () => {
      const check = fakeCheck();

      await expect(
        route(check).canActivate(
          makeCtx({ organizationId: 'org-a', teamId: 'team-b' }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('single subject routes', () => {
    it.each([
      ['organization', { organizationId: 'org-a', projectId: 'project-b' }],
      ['project', { organizationId: 'org-a', projectId: 'project-b' }],
      ['team', { organizationId: 'org-a', teamId: 'team-b' }],
    ])(
      'a %s route makes exactly one check, as before',
      async (subjectType, params) => {
        const check = fakeCheck();

        await expect(
          guardFor([subjectType], ['read'], check).canActivate(makeCtx(params)),
        ).resolves.toBe(true);
        expect(check).toHaveBeenCalledTimes(1);
        expect(calls(check)[0].subject).toEqual({ type: 'user', id: 'u1' });
      },
    );
  });
});
