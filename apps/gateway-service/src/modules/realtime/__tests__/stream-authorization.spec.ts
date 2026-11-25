import 'reflect-metadata';
import {
  BadRequestException,
  ExecutionContext,
  RequestMethod,
} from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Observable } from 'rxjs';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';
import { AsyncTaskOwnerGuard } from '../async-task-owner.guard';
import { MembershipRegistry } from '../membership.registry';
import { OrgsRealtimeController } from '../orgs-realtime.controller';
import { ProjectsRealtimeController } from '../projects-realtime.controller';
import { RealtimeModule } from '../realtime.module';
import { RealtimeStreamFactory } from '../realtime-stream.factory';
import {
  StreamAuthorizer,
  streamPermissionChecks,
} from '../stream-authorization';
import { TeamsRealtimeController } from '../teams-realtime.controller';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const VULN = '22222222-2222-4222-8222-222222222222';

/** The stream handlers of a controller, with their metadata. */
function streamHandlers(controller: new (...args: never[]) => object) {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => ({ name, handler: proto[name] as object }))
    .filter(
      ({ handler }) =>
        typeof handler === 'function' &&
        Reflect.getMetadata('method', handler) === RequestMethod.GET &&
        Reflect.getMetadata('__sse__', handler) === true,
    );
}

describe('stream authorization', () => {
  describe('streamPermissionChecks', () => {
    it('reads the checks PermissionsGuard ran, from the same metadata and params', () => {
      const handler = ProjectsRealtimeController.prototype.issuesStream;
      expect(streamPermissionChecks(handler, { projectId: PROJECT })).toEqual([
        {
          subjectType: 'project',
          subjectId: PROJECT,
          permission: 'read_scan_result',
        },
      ]);
    });

    it('yields no check when the path parameter of the subject is missing', () => {
      const handler = ProjectsRealtimeController.prototype.issuesStream;
      expect(streamPermissionChecks(handler, {})).toEqual([]);
    });
  });

  it.each([
    ['ProjectsRealtimeController', ProjectsRealtimeController],
    ['OrgsRealtimeController', OrgsRealtimeController],
    ['TeamsRealtimeController', TeamsRealtimeController],
  ])(
    'every Permify-guarded stream route of %s hands its checks to the factory',
    (_name, controller) => {
      const handlers = streamHandlers(controller);
      expect(handlers.length).toBeGreaterThan(0);
      for (const { name, handler } of handlers) {
        expect({
          name,
          permissions: Reflect.getMetadata('permissions', handler),
        }).toEqual({ name, permissions: expect.any(Array) });
        const args = Reflect.getMetadata(
          ROUTE_ARGS_METADATA,
          controller,
          name,
        ) as Record<string, unknown>;
        const custom = Object.keys(args ?? {}).filter((key) =>
          key.includes('__customRouteArgs__'),
        );
        expect({ name, custom: custom.length }).toEqual({ name, custom: 1 });
      }
    },
  );

  describe('through Nest, on the real route', () => {
    let app: NestFastifyApplication;
    const factory = {
      createScopedStream: jest.fn(() => new Observable(() => {})),
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [ProjectsRealtimeController],
        providers: [{ provide: RealtimeStreamFactory, useValue: factory }],
      })
        .overrideGuard(CombinedAuthRateLimitGuard)
        .useValue({
          canActivate: (ctx: ExecutionContext) => {
            ctx.switchToHttp().getRequest().user = { sub: 'u1' };
            return true;
          },
        })
        .overrideGuard(PermissionsGuard)
        .useValue({ canActivate: () => true })
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
        { logger: false },
      );
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('passes the per-vulnerability stream the project check of its route', async () => {
      const res = app.inject({
        method: 'GET',
        url: `/v1/realtime/projects/${PROJECT}/issues/${VULN}/stream`,
      });
      for (
        let i = 0;
        i < 100 && !factory.createScopedStream.mock.calls.length;
        i++
      ) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(factory.createScopedStream).toHaveBeenCalledWith(
        expect.objectContaining({
          channels: [`cybe:event:project:${PROJECT}:vuln:${VULN}`],
          authorization: [
            {
              subjectType: 'project',
              subjectId: PROJECT,
              permission: 'read_scan_result',
            },
          ],
        }),
      );
      void res.catch(() => undefined);
    });
  });

  describe('StreamAuthorizer', () => {
    const checks = [
      { subjectType: 'organization', subjectId: 'o1', permission: 'read' },
      {
        subjectType: 'project',
        subjectId: 'p1',
        permission: 'read_scan_result',
      },
    ];

    it('allows only when every check still holds, for the stream user', async () => {
      const checkPermission = jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const authorizer = new StreamAuthorizer({
        checkPermission,
      } as unknown as PermissionsGuard);
      await expect(authorizer.isAllowed('u1', checks)).resolves.toBe(false);
      expect(checkPermission.mock.calls).toEqual([
        ['o1', 'organization', 'read', 'u1', 'user'],
        ['p1', 'project', 'read_scan_result', 'u1', 'user'],
      ]);
    });

    it('never allows a stream without a check or without a user', async () => {
      const checkPermission = jest.fn().mockResolvedValue(true);
      const authorizer = new StreamAuthorizer({
        checkPermission,
      } as unknown as PermissionsGuard);
      await expect(authorizer.isAllowed('u1', [])).resolves.toBe(false);
      await expect(authorizer.isAllowed('', checks)).resolves.toBe(false);
      expect(checkPermission).not.toHaveBeenCalled();
    });
  });

  describe('a membership change', () => {
    it('re-checks the open streams of that user, besides closing its scope', async () => {
      const handlers: Record<string, (c: string, p: string) => void> = {};
      const sub = {
        subscribe: jest.fn().mockResolvedValue(1),
        on: jest.fn((event: string, fn: (c: string, p: string) => void) => {
          handlers[event] = fn;
        }),
      };
      const registry = new MembershipRegistry();
      const recheck = jest.fn();
      const kick = jest.spyOn(registry, 'kick');
      registry.registerRecheck('u1', 'c1', recheck);
      const mod = new RealtimeModule(sub as never, registry);
      await mod.onModuleInit();
      handlers.message(
        'cybe:event:membership',
        JSON.stringify({
          type: 'MEMBERSHIP_CHANGED',
          payload: {
            membershipChanged: {
              userId: 'u1',
              changeType: 'removed',
              scopeType: 'team',
              scopeId: 't1',
            },
          },
        }),
      );
      expect(kick).toHaveBeenCalledWith({
        userId: 'u1',
        scopeType: 'team',
        scopeId: 't1',
      });
      expect(recheck).toHaveBeenCalledTimes(1);
    });
  });

  describe('the task stream', () => {
    const ctx = (taskId: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ params: { taskId }, user: { sub: 'u1' } }),
        }),
      }) as unknown as ExecutionContext;

    it.each([
      'user:u2',
      '../x',
      'abc',
      '01J9ZK3Q7X8Y9Z0A1B2C3D4E5F6', // 27 characters
      `${PROJECT}x`,
    ])(
      'refuses %p before reading Redis: the id is not a task id',
      async (taskId) => {
        const redis = { get: jest.fn() };
        const guard = new AsyncTaskOwnerGuard(redis as never);
        await expect(guard.canActivate(ctx(taskId))).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(redis.get).not.toHaveBeenCalled();
      },
    );

    it.each(['01J9ZK3Q7X8Y9Z0A1B2C3D4E5F', PROJECT])(
      'reads the task of a ULID or a UUID (%p)',
      async (taskId) => {
        const redis = {
          get: jest.fn().mockResolvedValue(JSON.stringify({ userId: 'u1' })),
        };
        const guard = new AsyncTaskOwnerGuard(redis as never);
        await expect(guard.canActivate(ctx(taskId))).resolves.toBe(true);
        expect(redis.get).toHaveBeenCalledWith(`cybe:asynctask:${taskId}`);
      },
    );
  });
});
