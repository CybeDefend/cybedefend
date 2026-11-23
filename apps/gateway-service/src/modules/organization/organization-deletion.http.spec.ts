import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { of, throwError } from 'rxjs';
import request from 'supertest';

import { ORGANIZATION_SERVICE_NAME } from '@grpc/global-management/global_management';
import { GlobalExceptionFilter } from 'src/core/exceptions/global-exception.filter';
import { CombinedAuthRateLimitGuard } from 'src/core/guards/combined-auth-rate-limit.guard';
import { PermissionsGuard } from 'src/core/guards/permissions/permissions.guard';

import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

const ORG = '0b9c8f3e-2f8f-4a43-9a43-6f5f0d6c9a11';

/**
 * Organization deletion confirmation: only the creator deletes
 * an organization, with the 6-digit code e-mailed to them. Every rule is
 * global-management's; the gateway checks membership (organization `read`),
 * forwards the caller and the code, and answers global-management's closed
 * list of refusals with `body.code`. Through the real gateway service down to
 * the gRPC request, with the pipe of src/main.ts and the global filter.
 */
describe('Organization deletion confirmation (HTTP → gRPC)', () => {
  let app: INestApplication;
  const gm = {
    // The former RPC: an older global-management deletes on it whatever the
    // request carries, so the gateway must never call it again.
    delete: jest.fn(),
    confirmOrganizationDeletion: jest.fn(),
    requestOrganizationDeletionCode: jest.fn(),
  };
  const grpc = {
    getService: jest.fn((name: string) =>
      name === ORGANIZATION_SERVICE_NAME ? gm : {},
    ),
  };
  const checks: Array<{ subjectTypes: unknown; permissions: unknown }> = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OrganizationController],
      providers: [
        OrganizationService,
        { provide: 'GLOBAL_MANAGEMENT_SERVICE', useValue: grpc },
        { provide: Logger, useValue: { log: jest.fn(), error: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    })
      .overrideGuard(CombinedAuthRateLimitGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = { sub: 'u1' };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const handler = context.getHandler();
          checks.push({
            subjectTypes: Reflect.getMetadata('subjectTypes', handler),
            permissions: Reflect.getMetadata('permissions', handler),
          });
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    gm.delete.mockReset();
    gm.confirmOrganizationDeletion.mockReset();
    gm.requestOrganizationDeletionCode.mockReset();
    checks.length = 0;
  });

  const sent = (fn: jest.Mock) => fn.mock.calls[0][0];
  const refusal = (code: number, details: string) =>
    throwError(() =>
      Object.assign(new Error(`${code} X: ${details}`), { code, details }),
    );

  const REFUSALS: Array<[string, number, number]> = [
    ['NOT_ORGANIZATION_CREATOR', GrpcStatus.PERMISSION_DENIED, 403],
    ['DELETION_CODE_INVALID', GrpcStatus.INVALID_ARGUMENT, 400],
    ['DELETION_CODE_ATTEMPTS_EXCEEDED', GrpcStatus.FAILED_PRECONDITION, 400],
    ['DELETION_CODE_RATE_LIMITED', GrpcStatus.RESOURCE_EXHAUSTED, 429],
    ['DELETION_LOCKED', GrpcStatus.RESOURCE_EXHAUSTED, 429],
  ];

  const guardsOf = (method: keyof OrganizationController) =>
    Reflect.getMetadata(
      GUARDS_METADATA,
      OrganizationController.prototype[method],
    );

  describe('POST /organization/:organizationId/deletion-code', () => {
    const url = `/organization/${ORG}/deletion-code`;

    it('202 with the expiry, the caller from the token, never from the body', async () => {
      gm.requestOrganizationDeletionCode.mockReturnValue(
        of({ expiresAt: '2026-10-27T10:10:00.000Z' }),
      );
      const res = await request(app.getHttpServer())
        .post(url)
        .send({ requestedBy: 'someone-else', email: 'other@example.test' })
        .expect(202);
      expect(res.body).toEqual({ expiresAt: '2026-10-27T10:10:00.000Z' });
      expect(sent(gm.requestOrganizationDeletionCode)).toEqual({
        organizationId: ORG,
        requestedBy: 'u1',
      });
    });

    it('is checked as organisation read (membership), by PermissionsGuard', async () => {
      gm.requestOrganizationDeletionCode.mockReturnValue(
        of({ expiresAt: 'x' }),
      );
      await request(app.getHttpServer()).post(url).expect(202);
      expect(checks).toEqual([
        { subjectTypes: ['organization'], permissions: ['read'] },
      ]);
      expect(guardsOf('requestOrganizationDeletionCode')).toEqual([
        PermissionsGuard,
      ]);
    });

    it('400 on a non-UUID organization, global-management never asked', async () => {
      await request(app.getHttpServer())
        .post('/organization/not-a-uuid/deletion-code')
        .expect(400);
      expect(gm.requestOrganizationDeletionCode).not.toHaveBeenCalled();
    });

    it.each(REFUSALS)(
      'a refusal %s (gRPC %i) answers %i with body.code',
      async (code, grpcCode, httpStatus) => {
        gm.requestOrganizationDeletionCode.mockReturnValue(
          refusal(grpcCode, code),
        );
        const res = await request(app.getHttpServer())
          .post(url)
          .expect(httpStatus);
        expect(res.body.code).toBe(code);
        expect(res.body.message).toBe(code);
      },
    );

    it('DELETION_CODE_RATE_LIMITED says when to retry (Retry-After: 60); DELETION_LOCKED does not', async () => {
      gm.requestOrganizationDeletionCode.mockReturnValue(
        refusal(GrpcStatus.RESOURCE_EXHAUSTED, 'DELETION_CODE_RATE_LIMITED'),
      );
      const limited = await request(app.getHttpServer()).post(url).expect(429);
      expect(limited.headers['retry-after']).toBe('60');

      gm.requestOrganizationDeletionCode.mockReturnValue(
        refusal(GrpcStatus.RESOURCE_EXHAUSTED, 'DELETION_LOCKED'),
      );
      const locked = await request(app.getHttpServer()).post(url).expect(429);
      expect(locked.headers['retry-after']).toBeUndefined();
    });

    it('a mail that could not be sent is a 503 with no code', async () => {
      gm.requestOrganizationDeletionCode.mockReturnValue(
        refusal(GrpcStatus.UNAVAILABLE, 'The deletion code could not be sent'),
      );
      const res = await request(app.getHttpServer()).post(url).expect(503);
      expect(res.body.code).toBeUndefined();
    });
  });

  describe('DELETE /organization/:organizationId', () => {
    const url = `/organization/${ORG}`;

    it('forwards the caller and the code to ConfirmOrganizationDeletion, never to Delete', async () => {
      gm.confirmOrganizationDeletion.mockReturnValue(
        of({ message: 'deleted' }),
      );
      await request(app.getHttpServer())
        .delete(url)
        .send({ code: '012345' })
        .expect(200);
      expect(gm.delete).not.toHaveBeenCalled();
      expect(sent(gm.confirmOrganizationDeletion)).toEqual({
        organizationId: ORG,
        requestedBy: 'u1',
        confirmationCode: '012345',
      });
    });

    it('is checked as organisation read (membership), no longer manage', async () => {
      gm.confirmOrganizationDeletion.mockReturnValue(
        of({ message: 'deleted' }),
      );
      await request(app.getHttpServer())
        .delete(url)
        .send({ code: '012345' })
        .expect(200);
      expect(checks).toEqual([
        { subjectTypes: ['organization'], permissions: ['read'] },
      ]);
      expect(guardsOf('deleteOrganization')).toEqual([PermissionsGuard]);
    });

    it.each([
      [undefined],
      [{}],
      [{ code: '' }],
      [{ code: '12345' }],
      [{ code: '1234567' }],
      [{ code: '12345a' }],
      [{ code: 12345 }],
      [{ code: ['123456'] }],
    ])('400 on body %j, global-management never asked', async (body) => {
      const call = request(app.getHttpServer()).delete(url);
      await (body === undefined ? call : call.send(body)).expect(400);
      expect(gm.confirmOrganizationDeletion).not.toHaveBeenCalled();
      expect(gm.delete).not.toHaveBeenCalled();
    });

    // The pipe of src/main.ts converts implicitly: a JSON number of six
    // digits is the same code as a string, global-management decides.
    it('a six-digit JSON number is converted to the same code', async () => {
      gm.confirmOrganizationDeletion.mockReturnValue(
        of({ message: 'deleted' }),
      );
      await request(app.getHttpServer())
        .delete(url)
        .send({ code: 123456 })
        .expect(200);
      expect(sent(gm.confirmOrganizationDeletion).confirmationCode).toBe(
        '123456',
      );
    });

    it.each(REFUSALS)(
      'a refusal %s (gRPC %i) answers %i with body.code',
      async (code, grpcCode, httpStatus) => {
        gm.confirmOrganizationDeletion.mockReturnValue(refusal(grpcCode, code));
        const res = await request(app.getHttpServer())
          .delete(url)
          .send({ code: '012345' })
          .expect(httpStatus);
        expect(res.body.code).toBe(code);
        expect(res.body.message).toBe(code);
      },
    );

    // A global-management older than ConfirmOrganizationDeletion answers it
    // UNIMPLEMENTED: an error, never a deletion (it would have ignored the
    // code on Delete and deleted).
    it('an older global-management (UNIMPLEMENTED) is a 501 error, and Delete is never tried', async () => {
      gm.confirmOrganizationDeletion.mockReturnValue(
        refusal(
          GrpcStatus.UNIMPLEMENTED,
          'The server does not implement the method',
        ),
      );
      const res = await request(app.getHttpServer())
        .delete(url)
        .send({ code: '012345' })
        .expect(501);
      expect(res.body.code).toBeUndefined();
      expect(gm.delete).not.toHaveBeenCalled();
    });

    it('any other failure keeps its answer (NOT_FOUND → 404, no code)', async () => {
      gm.confirmOrganizationDeletion.mockReturnValue(
        refusal(GrpcStatus.NOT_FOUND, 'Organization not found'),
      );
      const res = await request(app.getHttpServer())
        .delete(url)
        .send({ code: '012345' })
        .expect(404);
      expect(res.body.code).toBeUndefined();
    });
  });
});
